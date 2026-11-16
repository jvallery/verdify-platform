#!/usr/bin/env python3
"""
setpoint-server.py — HTTP setpoint delivery server for ESP32 + grow light control.

Exposes simple endpoints for the ESP32 to toggle grow lights without needing
HA auth tokens in the firmware. Also tracks light state and runtime.

Endpoints:
    GET  /lights              — current state of both lights
    POST /lights/main/on      — turn on greenhouse main
    POST /lights/main/off     — turn off greenhouse main
    POST /lights/grow/on      — turn on greenhouse grow
    POST /lights/grow/off     — turn off greenhouse grow
    GET  /health              — service health check

Listens on 0.0.0.0:8200 (accessible from ESP32 at 192.168.10.111).
Writes state changes to equipment_state table.

Usage:
    setpoint-server.py           # run as foreground service (systemd)
"""

import asyncio
import json
import logging
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import asyncpg

REPO_ROOT = Path(__file__).resolve().parents[1]
INGESTOR_DIR = REPO_ROOT / "ingestor"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(INGESTOR_DIR) not in sys.path:
    sys.path.insert(0, str(INGESTOR_DIR))

# --- Configuration ---
HA_URL = "http://192.168.30.107:8123"
HA_TOKEN_FILE = os.environ.get("HA_TOKEN_FILE", "/var/run/secrets/verdify/ha_token.txt")
LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 8200

LIGHTS = {
    "main": {"ha_entity": "switch.greenhouse_main", "equipment": "grow_light_main"},
    "grow": {"ha_entity": "switch.greenhouse_grow", "equipment": "grow_light_grow"},
}
# The HTTP light route may only call these Lutron switches. In particular, an
# ESPHome climate switch or an Alarm.com light wrapper is never a fallback.
AUTHORIZED_LIGHT_ENTITIES = frozenset({"switch.greenhouse_main", "switch.greenhouse_grow"})

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [setpoint-server] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# Global state
_db_pool = None
_ha_token = None
_main_loop: asyncio.AbstractEventLoop | None = None
_light_state = {"main": None, "grow": None}  # True=on, False=off, None=unknown


def load_token() -> str:
    with open(HA_TOKEN_FILE) as f:
        return f.read().strip()


def ha_call(service: str, entity_id: str) -> bool:
    """Call HA REST API service. Returns True on success."""
    global _ha_token
    if service not in ("turn_on", "turn_off") or entity_id not in AUTHORIZED_LIGHT_ENTITIES:
        log.error("Rejected out-of-scope HA light command: %s %s", service, entity_id)
        return False
    if _ha_token is None:
        _ha_token = load_token()
    domain = entity_id.split(".", 1)[0]
    url = f"{HA_URL}/api/services/{domain}/{service}"
    body = json.dumps({"entity_id": entity_id}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {_ha_token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception as e:
        log.error("HA call failed: %s %s → %s", service, entity_id, e)
        return False


def ha_confirm_state(entity_id: str, expected: str, timeout_s: float = 8.0) -> bool:
    """Poll HA state after a service call; HTTP 200 alone does not prove Lutron moved."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if ha_get_state(entity_id) == expected:
            return True
        time.sleep(0.25)
    return False


def ha_get_state(entity_id: str) -> str | None:
    """Get current state of an HA entity. Returns 'on', 'off', or None."""
    global _ha_token
    if _ha_token is None:
        _ha_token = load_token()
    url = f"{HA_URL}/api/states/{entity_id}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {_ha_token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return data.get("state")
    except Exception as e:
        log.error("HA state fetch failed: %s → %s", entity_id, e)
        return None


async def record_state_change(equipment: str, is_on: bool) -> None:
    """Write state change to equipment_state table."""
    global _db_pool
    if _db_pool is None:
        return
    try:
        async with _db_pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO v_runtime_equipment_state_write (ts, equipment, state) VALUES ($1, $2, $3)",
                datetime.now(UTC),
                equipment,
                is_on,
            )
        log.info("State recorded: %s → %s", equipment, "ON" if is_on else "OFF")
    except Exception as e:
        log.error("DB write failed: %s", e)


def record_state_change_sync(equipment: str, is_on: bool) -> bool:
    """Record state changes from the HTTP server thread on the main asyncio loop."""
    if _main_loop is None:
        log.error("DB write skipped: main loop is not ready")
        return False
    try:
        future = asyncio.run_coroutine_threadsafe(record_state_change(equipment, is_on), _main_loop)
        future.result(timeout=5)
        return True
    except Exception as e:
        log.error("DB write failed: %s", e)
        return False


def get_db_url() -> str:
    # Env-first DSN (#118 §A1 code gate — the k3s prerequisite). Order:
    #   1. VERDIFY_DB_DSN / DATABASE_URL (a full DSN; ignored if it still
    #      carries unexpanded $(VAR) k8s references — envFrom vars are not
    #      available to $() expansion, so a composed spec value arrives raw)
    #   2. DB_HOST + friends (the verdify-config ConfigMap via envFrom +
    #      POSTGRES_PASSWORD via secretKeyRef — the in-cluster shape)
    #   3. legacy VM fallback: /srv/verdify/.env + localhost
    for var in ("VERDIFY_DB_DSN", "DATABASE_URL"):
        dsn = os.environ.get(var, "")
        if dsn and "$(" not in dsn:
            return dsn
    host = os.environ.get("DB_HOST")
    if host:
        user = os.environ.get("DB_USER", "verdify")
        pw = os.environ.get("POSTGRES_PASSWORD") or os.environ.get("DB_PASSWORD", "verdify")
        port = os.environ.get("DB_PORT", "5432")
        name = os.environ.get("DB_NAME", "verdify")
        return f"postgresql://{user}:{pw}@{host}:{port}/{name}"
    pw = "verdify"
    env_file = "/srv/verdify/.env"
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                if line.strip().startswith("POSTGRES_PASSWORD="):
                    pw = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    return f"postgresql://verdify:{pw}@localhost:5432/verdify"


class LutronHandler(BaseHTTPRequestHandler):
    """HTTP request handler for grow light control (#1656 retired the /setpoints route)."""

    def log_message(self, format, *args):
        log.info(format, *args)

    def _respond(self, code: int, body: dict):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_GET(self):
        if self.path == "/lights":
            # Fetch current state from HA
            result = {}
            for name, cfg in LIGHTS.items():
                state = ha_get_state(cfg["ha_entity"])
                result[name] = {"state": state, "entity": cfg["ha_entity"]}
                _light_state[name] = state == "on" if state else None
            self._respond(200, result)

        elif self.path == "/health":
            self._respond(200, {"status": "ok", "lights": dict(_light_state)})

        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        # Parse: /lights/{name}/{action}
        parts = self.path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "lights":
            self._respond(400, {"error": "use /lights/{main|grow}/{on|off}"})
            return

        name = parts[1]
        action = parts[2]

        if name not in LIGHTS:
            self._respond(400, {"error": f"unknown light: {name}. Use main or grow"})
            return
        if action not in ("on", "off"):
            self._respond(400, {"error": f"unknown action: {action}. Use on or off"})
            return

        cfg = LIGHTS[name]
        service = f"turn_{action}"
        success = ha_call(service, cfg["ha_entity"])

        if not success:
            self._respond(502, {"light": name, "action": action, "success": False, "error": "HA call failed"})
            return

        expected = "on" if action == "on" else "off"
        confirmed = ha_confirm_state(cfg["ha_entity"], expected)
        if not confirmed:
            actual = ha_get_state(cfg["ha_entity"])
            self._respond(
                504,
                {
                    "light": name,
                    "action": action,
                    "success": False,
                    "entity": cfg["ha_entity"],
                    "expected": expected,
                    "actual": actual,
                    "error": "HA state did not confirm requested Lutron state",
                },
            )
            log.error("Light %s %s not confirmed: expected=%s actual=%s", name, action.upper(), expected, actual)
            return

        is_on = action == "on"
        _light_state[name] = is_on
        db_recorded = record_state_change_sync(cfg["equipment"], is_on)
        self._respond(
            200,
            {
                "light": name,
                "action": action,
                "success": True,
                "entity": cfg["ha_entity"],
                "confirmed_state": expected,
                "db_recorded": db_recorded,
            },
        )
        log.info("Light %s → %s confirmed via %s", name, action.upper(), cfg["ha_entity"])


async def main():
    global _db_pool, _main_loop
    _main_loop = asyncio.get_running_loop()

    log.info("Starting Lutron proxy on %s:%d", LISTEN_HOST, LISTEN_PORT)

    # Connect to DB
    _db_pool = await asyncpg.create_pool(get_db_url(), min_size=1, max_size=3)
    log.info("DB pool ready")

    # Fetch initial light state
    for name, cfg in LIGHTS.items():
        state = ha_get_state(cfg["ha_entity"])
        _light_state[name] = state == "on" if state else None
        log.info("Initial state: %s = %s", name, state)

    # Run HTTP server in a thread
    server = HTTPServer((LISTEN_HOST, LISTEN_PORT), LutronHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    log.info("HTTP server listening on %s:%d", LISTEN_HOST, LISTEN_PORT)

    # Keep alive
    try:
        while True:
            await asyncio.sleep(60)
            # Periodically refresh HA token in case it was rotated
            global _ha_token
            try:
                _ha_token = load_token()
            except Exception:
                pass
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
