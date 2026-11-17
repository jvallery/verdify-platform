"""
ingestor.py — Verdify ESP32 → TimescaleDB data ingestor

Connects directly to the greenhouse ESP32 via aioesphomeapi (native encrypted
protocol). No Home Assistant dependency. Writes to 6 TimescaleDB tables.

Usage:
    python3 ingestor.py

Environment: loads from .env in same directory.
"""

import asyncio
import hmac
import json
import logging
import math
import os
import sys
import time
import unicodedata
import urllib.request
import zlib
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import asyncpg
import gap_replay
import shared
from aioesphomeapi import APIClient, APIConnectionError, LogLevel
from aioesphomeapi.model import (
    BinarySensorInfo,
    NumberInfo,
    SensorInfo,
    SwitchInfo,
    TextSensorInfo,
)
from dotenv import load_dotenv
from entity_map import (
    C1_OBSERVATION_SLUGS,
    CFG_READBACK_MAP,
    CLIMATE_MAP,
    DAILY_ACCUM_MAP,
    DIAGNOSTIC_MAP,
    EQUIPMENT_BINARY_MAP,
    EQUIPMENT_SWITCH_MAP,
    ESPHOME_FEEDBACK_MAP,
    FEEDBACK_VALUE_RANGES,
    SETPOINT_MAP,
    STATE_MAP,
    normalize_feedback_value,
)
from fixed_panel_source import NativeProbeTracker
from mqtt_fanout import (
    FanoutPublisher,
    assert_modes_consistent,
    decode_payload,
    publish_all_enabled,
    subscribe_mode_enabled,
    subscribe_topic_filter,
)
from observation_spool import ObservationSpool
from occupancy import refresh_latest_occupancy_state
from occupancy_lights import activity_loop as occupancy_light_activity_loop
from occupancy_lights import observe_state as observe_occupancy_light_state
from occupancy_mqtt import occupancy_mqtt_loop
from pydantic import ValidationError
from soil_saturation import saturation_evaluation_status
from source_spool import SourceSpool
from tasks import (
    BAND_DRIVEN_PARAMS,
    alert_monitor,
    daily_review,
    daily_summary_live,
    forecast_sync,
    grow_light_daily,
    ha_sensor_sync,
    hydro_probe_sync,
    ingestor_heartbeat,
    irrigation_sync,
    matview_refresh,
    readback_abs_tolerance,
    record_engine_capability,
    setpoint_confirmation_monitor,
    setpoint_dispatcher,
    shelly_sync,
    site_content_refresh,
    water_flowing_sync,
    water_meter_materialize,
)
from writer_lease import WriterLease

from verdify_schemas import (
    CLIMATE_INTENT_CONTRACT_VERSION,
    ClimateActionLogRow,
    ClimateRow,
    DailySummaryRow,
    Diagnostics,
    EquipmentStateEvent,
    ESP32LogRow,
    HAEntityState,
    OverrideEvent,
    SetpointChange,
    SetpointSnapshot,
    SystemStateRow,
    normalize_moisture_exchange_telemetry,
)
from verdify_schemas.experiment_config import (
    POLICY_VECTOR_MODE_OFF,
    policy_device_id,
    policy_vector_mode,
)
from verdify_schemas.policy_transport import POLICY_IDENTITY_SENSOR
from verdify_schemas.policy_vector import live_wire_fields
from verdify_schemas.telemetry import LAW_CONSTANTS_HASH, VERSIONED_TEXT_PAYLOADS, expand_moisture_exchange_wire
from verdify_schemas.tunable_registry import get as get_tunable

# ──────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────
load_dotenv(Path(__file__).parent / ".env")

GREENHOUSE_ID = os.environ.get("GREENHOUSE_ID", "vallery")
STATE_DIR = Path(os.environ.get("STATE_DIR", "/srv/verdify/state"))
CLIMATE_SPOOL_PATH = Path(os.environ.get("CLIMATE_SPOOL_PATH", str(STATE_DIR / "spool" / "climate.jsonl")))
CLIMATE_SPOOL_MAX_ROWS = int(os.environ.get("CLIMATE_SPOOL_MAX_ROWS", "2880"))

# ESP32 config: loaded from DB in main(), fallback to .env
ESP32_HOST = os.environ.get("ESP32_HOST", "192.168.10.111")
ESP32_PORT = int(os.environ.get("ESP32_PORT", 6053))
ESP32_API_KEY = os.environ.get("ESP32_API_KEY", "")

DB_DSN = (
    f"postgresql://{os.environ['DB_USER']}:{os.environ['DB_PASSWORD']}"
    f"@{os.environ['DB_HOST']}:{os.environ['DB_PORT']}/{os.environ['DB_NAME']}"
)
INGESTOR_RUNTIME_DB_ROLE_REQUIRED_ENV = "VERDIFY_INGESTOR_RUNTIME_DB_ROLE_REQUIRED"
INGESTOR_RUNTIME_DB_LOGIN = "verdify_ingestor_runtime_login"

_ORDINARY_RUNTIME_ROLE_ATTESTATION_SQL = """
SELECT current_user = session_user
   AND pg_catalog.current_setting('search_path') =
       'pg_catalog, public, pg_temp'
   AND public.fn_runtime_attest_ordinary_login()
"""


def _ingestor_runtime_db_role_required() -> bool:
    return os.environ.get(INGESTOR_RUNTIME_DB_ROLE_REQUIRED_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


async def attest_ordinary_ingestor_runtime_role(pool: asyncpg.Pool) -> None:
    """Fail startup if the staged cutover is not the exact powerless login."""
    if not _ingestor_runtime_db_role_required():
        return
    if not hmac.compare_digest(os.environ.get("DB_USER", ""), INGESTOR_RUNTIME_DB_LOGIN):
        raise RuntimeError("runtime-role cutover requires the exact ingestor database login")
    async with pool.acquire() as conn:
        attested = await conn.fetchval(_ORDINARY_RUNTIME_ROLE_ATTESTATION_SQL)
    if attested is not True:
        raise RuntimeError("ordinary ingestor database role attestation failed")


CLIMATE_FLUSH_INTERVAL = 60  # seconds between climate row writes
CLIMATE_ACTION_LOG_INTERVAL = 60  # seconds between controller decision snapshots
DIAG_FLUSH_INTERVAL = 60  # seconds between diagnostics row writes
# DIAG-WINDOW (release 4): with the spool on, a row takes every observation of this connection that is newer than the
# one last written for its column, up to this age. A fixed 60 s window did not tile the 60.2-61.3 s ticks, so an
# observation landing between two windows was never written (a lost per-minute low is a lost minute).
DIAG_OBSERVATION_MAX_AGE_S = 180
DIAG_PENDING_PER_COLUMN = 4
LOG_FLUSH_INTERVAL = 10  # seconds between log batch writes
COUNTER_SAMPLE_BUFFER_MAX_ROWS = max(1, int(os.environ.get("EQUIPMENT_COUNTER_SAMPLE_BUFFER_MAX_ROWS", "50000")))
EQUIPMENT_STATE_EVENT_BUFFER_MAX_ROWS = max(1, int(os.environ.get("EQUIPMENT_STATE_EVENT_BUFFER_MAX_ROWS", "50000")))
EQUIPMENT_STATE_RECEIPT_BUFFER_MAX_ROWS = max(2, int(os.environ.get("EQUIPMENT_STATE_RECEIPT_BUFFER_MAX_ROWS", "5000")))
EQUIPMENT_SOURCE_RECEIPT_INTERVAL = timedelta(seconds=30)
# Protocol v2 is locked to the Vallery local-day definition; generic container
# TZ must not silently move reset/cutoff evidence to UTC.
COUNTER_SOURCE_TIMEZONE = ZoneInfo("America/Denver")
COUNTER_SOURCE_RUNTIME_INSTANCE_ID = str(uuid4())

# Firmware source units are intentionally explicit.  The three mister entity
# ids end in `_min`, but the deployed sensor YAML reports hours; silently
# treating those values as minutes would corrupt the endpoint by 60x.
_COUNTER_SOURCE_BY_DAILY_COLUMN: dict[str, tuple[str, str]] = {
    "runtime_heat1_min": ("heat1", "minutes"),
    "runtime_heat2_min": ("heat2", "minutes"),
    "runtime_vent_min": ("vent", "minutes"),
    "runtime_fan1_min": ("fan1", "minutes"),
    "runtime_fan2_min": ("fan2", "minutes"),
    "runtime_fog_min": ("fog", "minutes"),
    "runtime_mister_south_h": ("mister_south", "hours"),
    "runtime_mister_west_h": ("mister_west", "hours"),
    "runtime_mister_center_h": ("mister_center", "hours"),
}
_COUNTER_SOURCE_COLUMNS = frozenset(_COUNTER_SOURCE_BY_DAILY_COLUMN)
_COUNTER_INITIAL_BURST_MAX_SKEW = timedelta(seconds=60)
# Q-09 (VD-48): the controller's own grow-light switches record their intent
# beside the Lutron readback that ha_sensor_sync writes as grow_light_main/_grow.
# public.fn_record_equipment_state_source_receipt (migration 216) admits only
# its fixed stream list and raises on any other stream, which would stall the
# whole durable receipt queue. These streams carry no experiment evidence, so
# they are written through the ordinary telemetry view, with no continuity
# receipt, in both writer modes.
_ORDINARY_EQUIPMENT_STREAMS = frozenset({"grow_light_main_intent", "grow_light_grow_intent"})
_COUNTER_DIAGNOSTIC_MAX_AGE = timedelta(seconds=90)
_COUNTER_DEVICE_CLOCK_MAX_SKEW = timedelta(seconds=120)

# Loki push endpoint (nexus management VM)
LOKI_URL = os.environ.get("LOKI_URL", "")  # Empty = disabled

# Map aioesphomeapi LogLevel to string
LOG_LEVEL_MAP = {
    LogLevel.LOG_LEVEL_NONE: "NONE",
    LogLevel.LOG_LEVEL_ERROR: "ERROR",
    LogLevel.LOG_LEVEL_WARN: "WARN",
    LogLevel.LOG_LEVEL_INFO: "INFO",
    LogLevel.LOG_LEVEL_DEBUG: "DEBUG",
    LogLevel.LOG_LEVEL_VERBOSE: "VERBOSE",
    LogLevel.LOG_LEVEL_VERY_VERBOSE: "VERY_VERBOSE",
}
LOG_LEVEL_BY_NAME = {
    "NONE": LogLevel.LOG_LEVEL_NONE,
    "ERROR": LogLevel.LOG_LEVEL_ERROR,
    "WARN": LogLevel.LOG_LEVEL_WARN,
    "WARNING": LogLevel.LOG_LEVEL_WARN,
    "INFO": LogLevel.LOG_LEVEL_INFO,
    "DEBUG": LogLevel.LOG_LEVEL_DEBUG,
    "VERBOSE": LogLevel.LOG_LEVEL_VERBOSE,
    "VERY_VERBOSE": LogLevel.LOG_LEVEL_VERY_VERBOSE,
}
ESP32_LOG_LEVEL = LOG_LEVEL_BY_NAME.get(os.environ.get("ESP32_LOG_LEVEL", "NONE").strip().upper())
if ESP32_LOG_LEVEL is None:
    ESP32_LOG_LEVEL = LogLevel.LOG_LEVEL_NONE
ESP32_LOG_LEVEL_NAME = LOG_LEVEL_MAP.get(ESP32_LOG_LEVEL, "NONE")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("ingestor")

CLIMATE_ACTION_LOG_ENTITIES = frozenset(
    {
        "climate_action",
        "climate_priority_axis",
        "climate_candidate_summary",
        "climate_moisture_assist_state",
        "climate_moisture_zone",
        "climate_temp_error_f",
        "climate_vpd_error_kpa",
        "climate_fog_margin_kpa",
        "climate_fog_block_reason",
        "climate_resource_cost_estimate",
        "climate_next_mist_eligible_s",
        "climate_moisture_exchange",
        "moisture_block_reason",
        "vent_mist_assist_status",
        "direct_wet_zone_mask",
        "fog_block_reason",
        "greenhouse_state",
        "mode_reason",
    }
)
CLIMATE_WET_ACTIONS = frozenset(
    {
        "VENT_COOL_MIST_ASSIST",
        "VENT_COOL_FOG_ASSIST",
        "SEALED_HUMIDIFY",
        "SEALED_FOG",
        "SAFETY_COOL",
    }
)
CLIMATE_FOG_ACTIONS = frozenset({"VENT_COOL_FOG_ASSIST", "SEALED_FOG", "SAFETY_COOL"})
_NO_FOG_BLOCK_REASONS = {None, "", "none"}
_FOG_ALLOWED_REASONS = _NO_FOG_BLOCK_REASONS | {"served"}
CLIMATE_RELAY_EQUIPMENT = (
    "heat1",
    "heat2",
    "fan1",
    "fan2",
    "vent",
    "fog",
    "mister_south",
    "mister_west",
    "mister_center",
)


# ──────────────────────────────────────────────────────────────
# State
# ──────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class PendingEquipmentCounterSample:
    sample_id: str
    source_observed_at: datetime
    stream: str
    native_value: float
    native_unit: str
    counter_reset_epoch_id: str
    device_uptime_seconds: float
    source_runtime_instance_id: str
    source_connection_generation: int
    firmware_revision: str


@dataclass(frozen=True)
class PendingEquipmentStateEvent:
    source_observed_at: datetime
    equipment: str
    state: bool
    source_runtime_instance_id: str
    source_connection_generation: int
    firmware_revision: str
    event_id: str = field(default_factory=lambda: str(uuid4()))


@dataclass(frozen=True)
class PendingEquipmentStateReceipt:
    receipt_id: str
    source_observed_through: datetime
    events: tuple[PendingEquipmentStateEvent, ...]
    source_runtime_instance_id: str
    source_connection_generation: int
    firmware_revision: str
    gap_requested: bool
    gap_version: int


class State:
    """Mutable ingestor state shared across callbacks."""

    def __init__(self):
        # Fresh values received since last flush (cleared after each write)
        self.climate: dict[str, float] = {}
        # Last-known values with timestamps (never cleared, used as fallback)
        self.climate_latest: dict[str, tuple[float, datetime]] = {}
        self.climate_provenance: dict[str, dict[str, Any]] = {}
        self.climate_latest_provenance: dict[str, dict[str, Any]] = {}
        # Native callback receive evidence is separate from climate's 600 s
        # carry-forward cache. It grants no physical probe freshness.
        self.fixed_panel_native = NativeProbeTracker(
            COUNTER_SOURCE_RUNTIME_INSTANCE_ID,
            collector_revision=os.environ.get("VERDIFY_GIT_SHA", "unknown"),
            ledger_enabled=os.environ.get("VERDIFY_FIXED_PANEL_NATIVE_LEDGER_ENABLED") == "1",
        )
        self.equipment: dict[str, bool] = {}
        # RULINGS AF6: relay edges across a controller boot. The relays held ON when this connection began, each
        # relay's first state on it, and the last uptime seen on any connection.
        self.relay_generation = 0
        self.relays_on_before_connection: set[str] = set()
        self.relays_first_seen: dict[str, tuple[bool, datetime]] = {}
        self.relay_last_uptime_s: float | None = None
        self.system: dict[str, str] = {}
        self.setpoints: dict[str, float] = {}
        self.diagnostics: dict[str, Any] = {}
        self.diagnostic_observations: dict[str, tuple[datetime, int]] = {}
        self.diagnostic_accepted_observations: dict[str, tuple[datetime, int]] = {}
        # Values received since the last row, oldest first, so two publishes between ticks both reach a row.
        self.diagnostic_pending: dict[str, list[tuple[datetime, int, Any]]] = {}
        self.daily: dict[str, float] = {}

        # Raw device-counter evidence. Epoch ids rotate on local-day rollover,
        # device uptime regression (reboot), or process restart. A process
        # restart is conservatively treated as a source-continuity break even
        # if the device itself remained up.
        self.pending_counter_samples: list[PendingEquipmentCounterSample] = []
        self.counter_reset_epoch_id = str(uuid4())
        self.counter_reset_local_date = datetime.now(COUNTER_SOURCE_TIMEZONE).date()
        self.counter_last_device_uptime_seconds: float | None = None
        self.counter_source_connection_generation = 0
        self.counter_source_uptime_generation = 0
        self.counter_source_firmware_generation = 0
        self.counter_source_uptime_observed_at: datetime | None = None
        self.counter_source_firmware_observed_at: datetime | None = None
        self.counter_source_device_time_generation = 0
        self.counter_source_device_time_observed_at: datetime | None = None
        self.counter_source_device_time_epoch: int | None = None
        self.counter_source_local_hour_generation = 0
        self.counter_source_local_hour_observed_at: datetime | None = None
        self.counter_source_local_hour: int | None = None
        self.counter_source_sntp_generation = 0
        self.counter_source_sntp_observed_at: datetime | None = None
        self.counter_source_sntp_valid = False
        self.counter_source_device_local_date = None
        self.counter_last_native_values: dict[str, float] = {}
        self.counter_generation_observations: dict[str, tuple[float, datetime]] = {}
        self.counter_generation_ready = False
        self.equipment_source_last_receipt_at: datetime | None = None
        self.equipment_source_last_device_observed_at: datetime | None = None
        self.equipment_source_last_device_generation = 0
        self.pending_equipment_receipts: list[PendingEquipmentStateReceipt] = []
        # A monotonic generation makes source gaps sticky across async DB I/O.
        # Only a successfully committed receipt that captured a generation may
        # advance the committed watermark; a newer callback-side gap can never
        # be erased by an older in-flight transaction.
        self.equipment_source_gap_version = 0
        self.equipment_source_committed_gap_version = 0

        # ESP32 configured value readback (cfg_* sensors → setpoint_snapshot)
        self.cfg_readback: dict[str, float] = {}  # param → value

        # object_id → entity key from API enumeration
        self.key_to_object_id: dict[int, str] = {}
        self.key_to_type: dict[int, str] = {}  # 'sensor','binary','text','number','switch'

        # Pending setpoint changes to write
        self.pending_setpoints: list[tuple[str, float]] = []

        # Pending equipment events to write
        self.pending_equipment: list[PendingEquipmentStateEvent] = []
        # (ts, equipment, state) rows for _ORDINARY_EQUIPMENT_STREAMS, written
        # through the ordinary view without a receipt.
        self.pending_ordinary_equipment: list[tuple[datetime, str, bool]] = []

        # Pending state transitions to write
        self.pending_states: list[tuple[str, str]] = []

        # OBS-1e (Sprint 16): firmware override event audit.
        # Each tuple is (override_type, mode_str) — written per start event
        # to override_events. Populated in on_state_change when the
        # active_overrides text_sensor transitions to include new flags.
        self.pending_override_events: list[tuple[str, str | None]] = []
        # Last-seen active override set (for diff on next transition)
        self.last_override_set: set[str] = set()

        # Flag: daily snapshot taken today?
        self._daily_snapshot_date: str | None = None

        # Pending ESP32 log messages
        self.pending_logs: list[tuple[str, str, str]] = []  # (level, tag, message)


state = State()

# Enabled only with the reviewed durable mount. No import-time filesystem I/O.
_observation_spool: ObservationSpool | None = None
_observation_warning_at = 0.0
_observation_accept_failures = 0


def _observation_spool_enabled() -> bool:
    return os.environ.get("VERDIFY_OBSERVATION_SPOOL_ENABLED") == "1"


def _get_observation_spool() -> ObservationSpool:
    global _observation_spool
    if _observation_spool is None:
        _observation_spool = ObservationSpool(
            STATE_DIR / "spool" / "observational-events-v1.sqlite",
            max_rows=int(os.environ.get("OBSERVATION_SPOOL_MAX_ROWS", "30000")),
            max_bytes=int(os.environ.get("OBSERVATION_SPOOL_MAX_BYTES", "134217728")),
        )
    return _observation_spool


async def _drain_observations(pool: asyncpg.Pool) -> None:
    """Historical INSERT-only replay; retain existing best-effort bus/log sinks."""
    logs = []

    def inserted(kind: str, observed_at: datetime, payload: dict[str, Any]) -> None:
        if kind in {"system_state", "diagnostics"}:
            _fanout_publish(kind, {"ts": observed_at, **payload})
        elif kind == "esp32_log":
            logs.append(
                [
                    str(int(observed_at.timestamp() * 1e9)),
                    f"[{payload['level']}] [{payload.get('tag') or 'esp32'}] {payload['message']}",
                ]
            )

    try:
        await _get_observation_spool().drain(pool, on_insert=inserted)
    finally:
        # Best effort, unchanged delivery guarantee. Unknown commits do not
        # duplicate a sink emission; no historical replay becomes device state.
        if logs and LOKI_URL:
            try:
                payload = json.dumps(
                    {"streams": [{"stream": {"job": "esp32", "host": "greenhouse"}, "values": logs}]}
                ).encode()
                req = urllib.request.Request(LOKI_URL, data=payload, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=2):
                    pass
            except Exception:
                pass


def _accept_observations(events: list[tuple[str, dict[str, Any]]], observed_at: datetime) -> bool:
    """Commit validated immutable observations before callback cache acceptance."""
    global _observation_warning_at, _observation_accept_failures
    models = {
        "system_state": SystemStateRow,
        "override": OverrideEvent,
        "setpoint_observed": SetpointChange,
        "esp32_log": ESP32LogRow,
        "diagnostics": Diagnostics,
    }
    try:
        accepted = []
        for kind, payload in events:
            if kind == "setpoint_observed" and payload["parameter"] in BAND_DRIVEN_PARAMS:
                continue
            values = {"ts": observed_at, "greenhouse_id": GREENHOUSE_ID, **payload}
            if kind == "setpoint_observed":
                values["source"] = "esp32"
            models[kind].model_validate(values)
            accepted.append((kind, payload))
        if not accepted:
            return True
        spool = _get_observation_spool()
        spool.accept(
            accepted, observed_at, COUNTER_SOURCE_RUNTIME_INSTANCE_ID, shared.transport_generation, GREENHOUSE_ID
        )
    except Exception as exc:
        _observation_accept_failures += 1
        log.error(
            "observational durable acceptance rejected; existing queue retained failures=%d reason=%s",
            _observation_accept_failures,
            type(exc).__name__,
        )
        return False
    now = time.monotonic()
    try:
        depth, size = spool.queue.backlog()
        if now - _observation_warning_at >= 60 and (
            depth >= spool.queue.max_rows * 0.8 or size >= spool.queue.max_bytes * 0.8
        ):
            log.warning("observational spool backlog high rows=%d bytes=%d", depth, size)
            _observation_warning_at = now
    except Exception as exc:
        # Acceptance already committed. Never make its caller accept it again.
        log.error("observational backlog observation failed after acceptance: %s", type(exc).__name__)
    return True


_source_spool: SourceSpool | None = None
_source_spool_warning_at = 0.0


def _durable_source_spool() -> SourceSpool | None:
    global _source_spool
    if os.environ.get("VERDIFY_SOURCE_SPOOL_ENABLED") != "1":
        return None
    if _source_spool is None:
        _source_spool = SourceSpool(
            STATE_DIR / "spool" / "equipment-source-v1.sqlite",
            max_rows=int(os.environ.get("SOURCE_SPOOL_MAX_ROWS", "30000")),
            max_bytes=int(os.environ.get("SOURCE_SPOOL_MAX_BYTES", "134217728")),
        )
    return _source_spool


def _persist_source(kind: str, identity: str, value: object, *, replace: tuple[str, ...] = ()) -> bool:
    try:
        spool = _durable_source_spool()
        if spool is None:
            return True
        payload = json.loads(json.dumps(asdict(value), default=_json_safe_value))
        spool.put(kind, identity, payload, replace=replace)
    except Exception as exc:
        _mark_equipment_source_gap("durable_source_accept_failed")
        log.error("equipment source durable acceptance failed: %s", type(exc).__name__)
        return False
    try:
        global _source_spool_warning_at
        now = time.monotonic()
        if now - _source_spool_warning_at >= 60:
            depth, size = spool.backlog()
            if depth >= spool.max_rows * 0.8 or size >= spool.max_bytes * 0.8:
                log.warning("equipment source spool backlog high rows=%d bytes=%d", depth, size)
                _source_spool_warning_at = now
    except Exception as exc:
        log.error("equipment source backlog read failed after durable acceptance: %s", type(exc).__name__)
    return True


def _ack_source(identities: list[str]) -> None:
    spool = _durable_source_spool()
    if spool is not None:
        spool.acknowledge(identities)


def _restore_source_spool() -> None:
    spool = _durable_source_spool()
    if spool is None:
        return
    retired_snapshots: list[str] = []
    for kind, identity, payload in spool.rows():
        if kind == "event":
            payload["source_observed_at"] = _coerce_spooled_ts(payload["source_observed_at"])
            state.pending_equipment.append(PendingEquipmentStateEvent(**payload))
        elif kind == "counter":
            payload["source_observed_at"] = _coerce_spooled_ts(payload["source_observed_at"])
            state.pending_counter_samples.append(PendingEquipmentCounterSample(**payload))
        elif kind == "snapshot":
            # The experiment-v2 direct state snapshot is retired (#1649): drop
            # any record a previous release left in the spool.
            retired_snapshots.append(identity)
        elif kind == "receipt":
            payload["source_observed_through"] = _coerce_spooled_ts(payload["source_observed_through"])
            events = []
            for event in payload["events"]:
                event["source_observed_at"] = _coerce_spooled_ts(event["source_observed_at"])
                events.append(PendingEquipmentStateEvent(**event))
            payload["events"] = tuple(events)
            receipt = PendingEquipmentStateReceipt(**payload)
            state.pending_equipment_receipts.append(receipt)
            state.equipment_source_gap_version = max(state.equipment_source_gap_version, receipt.gap_version)
        else:
            raise ValueError("unsupported durable source record kind")
    if retired_snapshots:
        spool.acknowledge(retired_snapshots)
        log.warning("equipment source dropped retired direct snapshots rows=%d", len(retired_snapshots))
    # Replaying old receipts never establishes a fresh connection's continuity.
    _mark_equipment_source_gap("durable_source_process_start")
    log.warning("equipment source restored backlog rows=%d", len(spool.rows()))


# Telemetry fan-out publisher (#113). None unless VERDIFY_MQTT_PUBLISH_ALL=1
# (prod-only). Set up in main(); used by the flush path to re-emit every flushed
# row onto the cross-env bus. Never gates the local DB write.
_fanout_publisher: FanoutPublisher | None = None

# HA-3.2 single-writer fence (#240). The renew-or-die WriterLease. Constructed in
# main(), published to shared.writer_lease so the push path can gate on it, and
# acquired BEFORE the ESP32 connect in esp32_loop. INERT unless
# VERDIFY_WRITER_LEASE_ENABLED is set (then is_held() is the real gate).
_writer_lease: WriterLease | None = None


def _fanout_publish(table: str, row: dict[str, Any]) -> None:
    """Best-effort publish of one flushed row to the fan-out bus (#113).

    No-op unless the prod publish-all publisher is active. Bus errors are
    swallowed inside FanoutPublisher.publish_row — telemetry capture (the local
    DB write) is Track A and must never be blocked by a bus outage.
    """
    if _fanout_publisher is None:
        return
    _fanout_publisher.publish_row(table, GREENHOUSE_ID, row)


def _note_climate_provenance(column: str, transport: str) -> None:
    state.climate_provenance[column] = {
        "received_at": datetime.now(UTC).isoformat(),
        "runtime_instance_id": COUNTER_SOURCE_RUNTIME_INSTANCE_ID,
        "transport": transport,
        "connection_generation": shared.transport_generation if transport == "esphome" else None,
    }


def _record_climate_sensor(obj_id: str, value: Any) -> bool:
    """Record an ESPHome climate sensor, applying feedback range guards."""
    col = CLIMATE_MAP.get(obj_id) or ESPHOME_FEEDBACK_MAP.get(obj_id)
    if not col:
        return False
    if col in FEEDBACK_VALUE_RANGES:
        normalized = normalize_feedback_value(col, value)
        if normalized is None:
            log.warning("ESPHome feedback rejected invalid value: %s column=%s value=%r", obj_id, col, value)
            return True
        state.climate[col] = normalized
        _note_climate_provenance(col, "esphome")
        return True
    state.climate[col] = value
    _note_climate_provenance(col, "esphome")
    return True


def _parse_override_set(val: str) -> set[str]:
    """OBS-1e: parse "none" / "a,b,c" payload from active_overrides text_sensor."""
    if not val or val == "none":
        return set()
    return {t.strip() for t in val.split(",") if t.strip() and t.strip() != "none"}


# ──────────────────────────────────────────────────────────────
# DB helpers
# ──────────────────────────────────────────────────────────────
def _json_safe_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _coerce_spooled_ts(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    raise ValueError(f"invalid spooled climate timestamp: {value!r}")


def _encode_climate_spool_row(row: dict[str, Any]) -> str:
    return json.dumps({key: _json_safe_value(value) for key, value in row.items()}, sort_keys=True)


def _decode_climate_spool_row(line: str) -> dict[str, Any]:
    row = json.loads(line)
    if not isinstance(row, dict):
        raise ValueError("spooled climate row is not an object")
    row["ts"] = _coerce_spooled_ts(row.get("ts"))
    return row


def _read_climate_spool_rows() -> list[dict[str, Any]]:
    if not CLIMATE_SPOOL_PATH.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(CLIMATE_SPOOL_PATH.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        try:
            rows.append(_decode_climate_spool_row(line))
        except Exception as e:
            log.error("dropping corrupt climate spool row %s:%s: %s", CLIMATE_SPOOL_PATH, line_no, e)
    return rows


def _write_climate_spool_rows(rows: list[dict[str, Any]]) -> None:
    CLIMATE_SPOOL_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = CLIMATE_SPOOL_PATH.with_suffix(CLIMATE_SPOOL_PATH.suffix + ".tmp")
    if rows:
        tmp_path.write_text("".join(_encode_climate_spool_row(row) + "\n" for row in rows))
        tmp_path.replace(CLIMATE_SPOOL_PATH)
    else:
        tmp_path.unlink(missing_ok=True)
        CLIMATE_SPOOL_PATH.unlink(missing_ok=True)


def _spool_climate_row(row: dict[str, Any]) -> None:
    try:
        rows = _read_climate_spool_rows()
        rows.append(row)
        if len(rows) > CLIMATE_SPOOL_MAX_ROWS:
            dropped = len(rows) - CLIMATE_SPOOL_MAX_ROWS
            rows = rows[dropped:]
            log.error("climate spool exceeded %s rows; dropped %s oldest rows", CLIMATE_SPOOL_MAX_ROWS, dropped)
        _write_climate_spool_rows(rows)
        log.warning("spooled climate row at %s after DB write failure (spool_depth=%s)", row["ts"], len(rows))
    except Exception as e:
        log.error("failed to spool climate row at %s: %s", row.get("ts"), e)


async def _insert_climate_row(pool: asyncpg.Pool, row: dict[str, Any]) -> None:
    ts = _coerce_spooled_ts(row["ts"])
    cols = [col for col in row if col != "ts"]
    cols_sql = ", ".join(["ts"] + cols)
    placeholders = ", ".join([f"${i + 1}" for i in range(len(cols) + 1)])
    values = [ts] + [row.get(c) for c in cols]
    async with pool.acquire() as conn:
        await conn.execute(
            f"INSERT INTO v_runtime_climate_write ({cols_sql}) VALUES ({placeholders})",
            *values,
        )
    log.debug(f"climate row written ({len(cols)} columns)")
    # #113: re-emit the exact row we just persisted onto the fan-out bus so
    # dev/stage subscribers write the same climate row to their own DB.
    _fanout_publish("climate", {"ts": ts, **{col: row.get(col) for col in cols}})


_EQUIPMENT_SOURCE_COLLECTOR_LOGIN = "verdify_experiment_v2_equipment_source_collector_login"
_EQUIPMENT_SOURCE_COLLECTOR_DUTY = "verdify_experiment_equipment_source_collector"
_EQUIPMENT_SOURCE_COLLECTOR_FUNCTIONS = (
    "public.fn_record_equipment_counter_sample(uuid,timestamp with time zone,text,text,text,double precision,text,uuid,double precision,uuid,bigint,text)",
    "public.fn_record_equipment_state_source_receipt(uuid,timestamp with time zone,text,text,jsonb,boolean,uuid,bigint,text)",
)
# Retired with the experiment (#1633 release 4, contracts phase4-drops rule 5): nothing calls it, so it is no longer
# required, but the duty may still hold EXECUTE on it until a later release revokes and drops it.
_EQUIPMENT_SOURCE_COLLECTOR_TOLERATED_FUNCTIONS = (
    "public.fn_record_equipment_direct_state_snapshot(uuid,uuid,text,text,jsonb,double precision,uuid,bigint,text)",
)
_EQUIPMENT_SOURCE_ROLE_ATTESTATION_SQL = """
WITH login AS (
    SELECT oid, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
           rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles
     WHERE rolname = current_user
), duty AS (
    SELECT oid, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
           rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles
     WHERE rolname = $1::text
), required_functions(function_signature) AS (
    SELECT unnest($2::text[])
), allowed_functions(function_signature) AS (
    SELECT function_signature FROM required_functions
    UNION ALL
    SELECT unnest($3::text[])
)
SELECT current_user::text AS current_user_name,
       session_user::text AS session_user_name,
       current_user = session_user AS session_user_matches,
       pg_has_role(current_user, $1::text, 'member') AS duty_member,
       coalesce((
           SELECT NOT membership.admin_option
             FROM pg_auth_members membership
             CROSS JOIN login CROSS JOIN duty
            WHERE membership.member = login.oid
              AND membership.roleid = duty.oid
       ), false) AS duty_membership_non_admin,
       coalesce((SELECT rolcanlogin AND rolinherit FROM login), false)
           AS login_role_safe,
       coalesce((SELECT rolsuper FROM login), true) AS is_superuser,
       coalesce((
           SELECT database_row.datdba = login.oid
             FROM pg_database database_row CROSS JOIN login
            WHERE database_row.datname = current_database()
       ), true) AS is_database_owner,
       coalesce((
           SELECT rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
             FROM login
       ), true) AS has_elevated_role_attributes,
       coalesce((
           SELECT NOT duty.rolcanlogin AND NOT duty.rolinherit AND
                  NOT duty.rolsuper AND NOT duty.rolcreatedb AND
                  NOT duty.rolcreaterole AND NOT duty.rolreplication AND
                  NOT duty.rolbypassrls AND NOT EXISTS (
                      SELECT 1 FROM pg_roles inherited
                       WHERE inherited.oid <> duty.oid
                         AND pg_has_role(duty.oid, inherited.oid, 'member')
                  )
             FROM duty
       ), false) AS duty_role_safe,
       EXISTS (
           SELECT 1 FROM pg_roles inherited
            WHERE inherited.rolname NOT IN (current_user, $1::text)
              AND pg_has_role(current_user, inherited.oid, 'member')
       ) AS has_other_role_membership,
       EXISTS (
           SELECT 1
             FROM pg_roles candidate
             CROSS JOIN login
             CROSS JOIN duty
            WHERE candidate.oid NOT IN (login.oid, duty.oid)
              AND NOT candidate.rolsuper
              AND pg_has_role(candidate.oid, duty.oid, 'member')
       ) AS has_unexpected_duty_member,
       EXISTS (
           SELECT 1 FROM pg_namespace namespace CROSS JOIN login
            WHERE namespace.nspname = 'public' AND namespace.nspowner = login.oid
           UNION ALL
           SELECT 1 FROM pg_class owned
             JOIN pg_namespace namespace ON namespace.oid = owned.relnamespace
             CROSS JOIN login
            WHERE namespace.nspname = 'public' AND owned.relowner = login.oid
           UNION ALL
           SELECT 1 FROM pg_proc owned
             JOIN pg_namespace namespace ON namespace.oid = owned.pronamespace
             CROSS JOIN login
            WHERE namespace.nspname = 'public' AND owned.proowner = login.oid
       ) AS has_managed_object_ownership,
       has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
       has_schema_privilege(current_user, 'public', 'CREATE')
           AS has_public_schema_create,
       EXISTS (
           SELECT 1 FROM pg_class protected
             JOIN pg_namespace namespace ON namespace.oid = protected.relnamespace
            WHERE namespace.nspname = 'public'
              AND protected.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND (
                  has_table_privilege(
                      current_user, protected.oid,
                      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                  ) OR has_any_column_privilege(
                      current_user, protected.oid,
                      'SELECT,INSERT,UPDATE,REFERENCES'
                  )
              )
       ) AS has_protected_relation_privilege,
       EXISTS (
           SELECT 1 FROM pg_class protected
             JOIN pg_namespace namespace ON namespace.oid = protected.relnamespace
            WHERE namespace.nspname = 'public'
              AND protected.relkind = 'S'
              AND has_sequence_privilege(
                  current_user, protected.oid, 'USAGE,SELECT,UPDATE'
              )
       ) AS has_protected_sequence_privilege,
       EXISTS (
           SELECT 1 FROM pg_proc candidate
             JOIN pg_namespace namespace ON namespace.oid = candidate.pronamespace
            WHERE namespace.nspname = 'public'
              AND (
                  candidate.proname LIKE 'fn_experiment_v2_%'
                  OR candidate.proname LIKE 'fn_record_equipment_%'
                  OR candidate.prosecdef
              )
              AND has_function_privilege(current_user, candidate.oid, 'EXECUTE')
              AND NOT EXISTS (
                  SELECT 1 FROM allowed_functions allowed
                   WHERE to_regprocedure(allowed.function_signature) = candidate.oid
              )
       ) AS has_unexpected_function_execute,
       NOT EXISTS (
           SELECT 1 FROM required_functions required
            WHERE to_regprocedure(required.function_signature) IS NULL
               OR NOT has_function_privilege(
                   current_user,
                   to_regprocedure(required.function_signature),
                   'EXECUTE'
               )
       ) AS has_required_function_execute
"""


def _equipment_source_role_attestation_passes(
    row: Any,
    expected_user: str,
) -> bool:
    if row is None:
        return False
    try:
        return bool(
            row["current_user_name"] == expected_user
            and row["session_user_name"] == expected_user
            and row["session_user_matches"] is True
            and row["duty_member"] is True
            and row["duty_membership_non_admin"] is True
            and row["login_role_safe"] is True
            and row["is_superuser"] is False
            and row["is_database_owner"] is False
            and row["has_elevated_role_attributes"] is False
            and row["duty_role_safe"] is True
            and row["has_other_role_membership"] is False
            and row["has_unexpected_duty_member"] is False
            and row["has_managed_object_ownership"] is False
            and row["schema_usage"] is True
            and row["has_public_schema_create"] is False
            and row["has_protected_relation_privilege"] is False
            and row["has_protected_sequence_privilege"] is False
            and row["has_unexpected_function_execute"] is False
            and row["has_required_function_execute"] is True
        )
    except (KeyError, TypeError):
        return False


async def create_equipment_source_pool() -> asyncpg.Pool | None:
    """Create and attest the optional function-only raw-source connection.

    This credential is deliberately independent of the ordinary telemetry DB
    owner credential. Missing values leave experiment evidence unavailable but
    do not interrupt legacy telemetry capture or device safety loops.
    """
    user = os.environ.get("VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_USER", "")
    password = os.environ.get("VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_PASSWORD", "")
    if not user and not password:
        log.warning("equipment source collector credential unavailable; evidence is fail-closed")
        return None
    if not user or not password or user == os.environ.get("DB_USER"):
        log.error("equipment source collector credential is incomplete or shared")
        return None
    expected_user = _EQUIPMENT_SOURCE_COLLECTOR_LOGIN
    duty = _EQUIPMENT_SOURCE_COLLECTOR_DUTY
    if user != expected_user:
        log.error("equipment source collector login identity is not the locked login")
        return None

    pool = await asyncpg.create_pool(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        database=os.environ["DB_NAME"],
        user=user,
        password=password,
        min_size=1,
        max_size=1,
        server_settings={"application_name": "verdify-experiment-equipment-source-collector"},
    )
    try:
        async with pool.acquire() as conn:
            attestation = await conn.fetchrow(
                _EQUIPMENT_SOURCE_ROLE_ATTESTATION_SQL,
                duty,
                list(_EQUIPMENT_SOURCE_COLLECTOR_FUNCTIONS),
                list(_EQUIPMENT_SOURCE_COLLECTOR_TOLERATED_FUNCTIONS),
            )
        if not _equipment_source_role_attestation_passes(attestation, expected_user):
            raise RuntimeError("equipment source collector database authority mismatch")
    except BaseException:
        await pool.close()
        raise
    log.info("equipment source collector database authority attested")
    return pool


_climate_event_spool: SourceSpool | None = None


def _climate_event_spool_enabled() -> bool:
    return os.environ.get("VERDIFY_CLIMATE_EVENT_SPOOL_ENABLED") == "1"


def _get_climate_event_spool() -> SourceSpool:
    global _climate_event_spool
    if _climate_event_spool is None:
        if CLIMATE_SPOOL_PATH.exists() and CLIMATE_SPOOL_PATH.stat().st_size:
            raise RuntimeError("legacy climate JSONL lacks event identities; preserve and review before activation")
        _climate_event_spool = SourceSpool(
            STATE_DIR / "spool" / "climate-events-v1.sqlite",
            max_rows=CLIMATE_SPOOL_MAX_ROWS,
            max_bytes=int(os.environ.get("CLIMATE_EVENT_SPOOL_MAX_BYTES", "134217728")),
        )
    return _climate_event_spool


async def _drain_climate_event_spool(pool: asyncpg.Pool) -> None:
    spool = _get_climate_event_spool()
    for kind, identity, event in spool.rows():
        if kind != "climate":
            raise ValueError("unsupported climate event spool record")
        row = event["row"]
        ts = _coerce_spooled_ts(row["ts"])
        payload = {key: value for key, value in row.items() if key != "ts"}
        async with pool.acquire() as conn:
            inserted = await conn.fetchval(
                "SELECT public.fn_record_climate_source_event($1::uuid,$2::timestamptz,$3::text,$4::uuid,$5::bigint,$6::jsonb,$7::jsonb)",
                identity,
                ts,
                event["greenhouse_id"],
                event["runtime_instance_id"],
                event["connection_generation"],
                json.dumps(payload, sort_keys=True, allow_nan=False),
                json.dumps(event["sample_provenance"], sort_keys=True, allow_nan=False),
            )
        # Unknown DB commit retains the same UUID and immutable payload. A retry
        # returns false, so it cannot fan out a second row or grant confirmation.
        spool.acknowledge([identity])
        if inserted:
            _fanout_publish("climate", {"ts": ts, **payload})


def _accept_climate_event(ts: datetime, merged: dict[str, Any]) -> None:
    fresh = dict(state.climate)
    lineage = {
        column: state.climate_latest_provenance.get(column, {"received_at": None, "source": "unknown_legacy_cache"})
        for column in merged
    }
    lineage.update(
        {
            column: state.climate_provenance.get(column, {"received_at": None, "source": "unknown_legacy_cache"})
            for column in fresh
        }
    )
    event = {
        "row": {"ts": ts.isoformat(), **merged},
        "greenhouse_id": GREENHOUSE_ID,
        "runtime_instance_id": COUNTER_SOURCE_RUNTIME_INSTANCE_ID,
        "connection_generation": shared.transport_generation,
        "sample_provenance": lineage,
    }
    spool = _get_climate_event_spool()
    spool.put("climate", str(uuid4()), event)
    # No await occurs between snapshot, durable commit and clearing fresh data.
    # If capacity/fsync fails, the original fresh buffer remains unchanged.
    for column, value in fresh.items():
        state.climate_latest[column] = (value, ts)
        state.climate_latest_provenance[column] = lineage[column]
    state.climate.clear()
    state.climate_provenance.clear()
    depth, size = spool.backlog()
    if depth >= spool.max_rows * 0.8 or size >= spool.max_bytes * 0.8:
        log.warning("climate event spool backlog high rows=%d bytes=%d", depth, size)


async def _drain_climate_spool(pool: asyncpg.Pool) -> None:
    try:
        rows = _read_climate_spool_rows()
    except Exception as e:
        log.error("failed to read climate spool; live climate writes will continue: %s", e)
        return
    if not rows:
        return
    remaining: list[dict[str, Any]] = []
    drained = 0
    for idx, row in enumerate(rows):
        try:
            await _insert_climate_row(pool, row)
            drained += 1
        except Exception as e:
            remaining = rows[idx:]
            log.error("climate spool drain paused after %s/%s rows: %s", drained, len(rows), e)
            break
    else:
        remaining = []
    try:
        _write_climate_spool_rows(remaining)
    except Exception as e:
        log.error("failed to update climate spool after draining %s row(s): %s", drained, e)
        return
    if drained:
        log.warning("drained %s climate spool row(s); remaining=%s", drained, len(remaining))


async def write_climate(pool: asyncpg.Pool, ts: datetime) -> None:
    """Write a climate row using two-tier buffer: fresh + last-known.

    Strategy:
    - state.climate = values received since last flush (cleared after each write)
    - state.climate_latest = last known value + timestamp per sensor (persistent)

    On each flush:
    1. Start with last-known values (within 10 min staleness window)
    2. Overlay with fresh values (takes precedence)
    3. Update last-known with fresh values
    4. Clear fresh buffer

    This prevents phantom data (zombie ingestor stale values from hours ago)
    while preserving legitimate current values from sensors that publish on-change.
    """
    STALENESS_TIMEOUT = 600  # 10 minutes — sensors not seen in 10 min are excluded

    # Step 1: Build merged row from last-known (within timeout) + fresh
    merged = {}
    for col, (val, seen_at) in state.climate_latest.items():
        age = (ts - seen_at).total_seconds()
        if age < STALENESS_TIMEOUT:
            merged[col] = val

    # Step 2: Overlay fresh values (always take precedence)
    merged.update(state.climate)

    # Step 5: Validate + write merged row
    cols = list(merged.keys())
    if not cols:
        if _climate_event_spool_enabled():
            try:
                await _drain_climate_event_spool(pool)
            except Exception as exc:
                log.error("retained climate event awaits replay: %s", type(exc).__name__)
        return
    # Validate ranges on every known column (rh∈[0,100], vpd∈[0,20], etc.).
    # extra="ignore" means novel column names pass through to the INSERT —
    # the DB will surface those (column doesn't exist) if the entity map is wrong.
    try:
        ClimateRow.model_validate({"ts": ts, "greenhouse_id": GREENHOUSE_ID, **merged})
    except ValidationError as e:
        log.error(f"climate row failed schema validation: {e}")
        shared.note_row_rejected("climate")
        return

    # Sprint 23 Phase 4b: Pydantic validation at the asyncpg boundary.
    # Validates numeric ranges (rh 0-100, vpd 0-20, ts tz-aware, etc.).
    # Column-name drift is guarded separately by map/schema tests because
    # ClimateRow intentionally tolerates additive DB columns for older readers.
    if ClimateRow is not None:
        try:
            ClimateRow.model_validate({"ts": ts, **merged})
        except ValidationError as e:
            log.error("climate row failed Pydantic validation: %s", e)
            # Continue — the write still attempts. Validation is observability,
            # not a hard gate (yet). A future sprint will promote to fail-closed
            # once the known-false-positive-free baseline is proven.

    if _climate_event_spool_enabled():
        _accept_climate_event(ts, merged)
        try:
            await _drain_climate_event_spool(pool)
        except Exception as exc:
            log.error("durably accepted climate event awaits replay: %s", type(exc).__name__)
        return

    # Step 3: Update last-known with any fresh values
    for col, val in state.climate.items():
        state.climate_latest[col] = (val, ts)

    # Step 4: Clear fresh buffer
    state.climate.clear()

    await _drain_climate_spool(pool)
    row = {"ts": ts, **merged}
    try:
        await _insert_climate_row(pool, row)
    except Exception:
        _spool_climate_row(row)
        raise


async def write_fixed_panel_native_events(pool: asyncpg.Pool) -> None:
    """Persist one bounded batch without acknowledging an uncertain DB commit."""
    tracker = state.fixed_panel_native
    if not tracker.ledger_enabled:
        return
    batch = tracker.peek_events()
    if not batch:
        return
    async with pool.acquire() as conn, conn.transaction():
        for event in batch:
            await conn.fetchval(
                "SELECT public.fn_append_fixed_panel_native_event($1::jsonb)",
                json.dumps(event.model_dump(mode="json", by_alias=True), sort_keys=True),
            )
    tracker.acknowledge_through(batch[-1].source_sequence)


def _valid_source_firmware(value: object) -> bool:
    return bool(isinstance(value, str) and value and len(value) <= 512 and unicodedata.normalize("NFC", value) == value)


def _mark_equipment_source_gap(reason: str) -> None:
    """Make a continuity loss sticky until its exact generation is committed."""

    state.equipment_source_gap_version += 1
    log.error(
        "equipment source continuity gap marked reason=%s version=%d",
        reason,
        state.equipment_source_gap_version,
    )


def _equipment_source_gap_pending() -> bool:
    return state.equipment_source_gap_version > state.equipment_source_committed_gap_version


def _append_pending_equipment_event(event: PendingEquipmentStateEvent) -> bool:
    if len(state.pending_equipment) >= EQUIPMENT_STATE_EVENT_BUFFER_MAX_ROWS:
        _mark_equipment_source_gap("state_event_buffer_overflow")
        log.error(
            "equipment source state event rejected at bounded buffer rows=%d",
            EQUIPMENT_STATE_EVENT_BUFFER_MAX_ROWS,
        )
        return False
    if not _persist_source("event", event.event_id, event):
        return False
    state.pending_equipment.append(event)
    return True


def _new_equipment_receipt(
    *,
    source_observed_through: datetime,
    events: tuple[PendingEquipmentStateEvent, ...],
    source_runtime_instance_id: str,
    source_connection_generation: int,
    firmware_revision: str,
) -> PendingEquipmentStateReceipt:
    gap_version = state.equipment_source_gap_version
    return PendingEquipmentStateReceipt(
        receipt_id=str(uuid4()),
        source_observed_through=source_observed_through,
        events=events,
        source_runtime_instance_id=source_runtime_instance_id,
        source_connection_generation=source_connection_generation,
        firmware_revision=firmware_revision,
        gap_requested=gap_version > state.equipment_source_committed_gap_version,
        gap_version=gap_version,
    )


def _append_pending_equipment_receipt(receipt: PendingEquipmentStateReceipt) -> bool:
    if len(state.pending_equipment_receipts) >= EQUIPMENT_STATE_RECEIPT_BUFFER_MAX_ROWS:
        _mark_equipment_source_gap("state_receipt_buffer_overflow")
        log.error(
            "equipment source receipt rejected at bounded buffer rows=%d",
            EQUIPMENT_STATE_RECEIPT_BUFFER_MAX_ROWS,
        )
        return False
    if not _persist_source(
        "receipt", receipt.receipt_id, receipt, replace=tuple(event.event_id for event in receipt.events)
    ):
        return False
    state.pending_equipment_receipts.append(receipt)
    return True


async def write_equipment_events(pool: asyncpg.Pool, _ts: datetime) -> None:
    """Atomically persist exact callbacks and a fenced continuity receipt.

    The receipt is also emitted as a bounded heartbeat when there are no
    transitions. It proves that every callback observed before the barrier was
    durably drained; an unavailable/reconnected source cannot forge continuity
    merely because the relay happened not to change state.
    """
    generation = shared.transport_generation
    client = shared.esp32.get("state_subscription_client")
    source_now = _equipment_source_now()
    last_device_observed_at = state.equipment_source_last_device_observed_at
    if (
        last_device_observed_at is not None
        and state.equipment_source_last_device_generation == generation
        and source_now < last_device_observed_at
    ):
        _mark_equipment_source_gap("flush_clock_regression")
    live_source = client is not None and (
        generation >= 1
        and shared.esp32.get("state_subscription_generation") == generation
        and shared.esp32.get("client") is client
        and state.counter_generation_ready
        and last_device_observed_at is not None
        and state.equipment_source_last_device_generation == generation
        and source_now >= last_device_observed_at
        and source_now - last_device_observed_at <= _COUNTER_DIAGNOSTIC_MAX_AGE
        and _counter_lineage_is_fresh(generation, last_device_observed_at)
    )
    firmware_revision = state.diagnostics.get("firmware_version")
    if live_source and not _valid_source_firmware(firmware_revision):
        live_source = False

    # Seal callback batches with their original lineage and immutable UUIDs.
    # Old-generation callbacks are never relabeled after a reconnect. Their
    # conservative barrier is their final callback time; only the current live
    # device-origin callback can advance a continuity heartbeat beyond it.
    if state.pending_equipment:
        unsealed = state.pending_equipment.copy()
        state.pending_equipment.clear()
        start = 0
        while start < len(unsealed):
            first = unsealed[start]
            lineage = (
                first.source_runtime_instance_id,
                first.source_connection_generation,
                first.firmware_revision,
            )
            end = start + 1
            while (
                end < len(unsealed)
                and (
                    unsealed[end].source_runtime_instance_id,
                    unsealed[end].source_connection_generation,
                    unsealed[end].firmware_revision,
                )
                == lineage
                and end - start < 10000
            ):
                end += 1
            batch = tuple(unsealed[start:end])
            is_current = bool(
                live_source
                and lineage == (COUNTER_SOURCE_RUNTIME_INSTANCE_ID, generation, firmware_revision)
                and end == len(unsealed)
            )
            barrier = (
                last_device_observed_at
                if is_current and last_device_observed_at is not None
                else max(event.source_observed_at for event in batch)
            )
            sealed = _append_pending_equipment_receipt(
                _new_equipment_receipt(
                    source_observed_through=barrier,
                    events=batch,
                    source_runtime_instance_id=lineage[0],
                    source_connection_generation=lineage[1],
                    firmware_revision=lineage[2],
                )
            )
            if not sealed:
                state.pending_equipment[:0] = unsealed[start:]
                break
            start = end

    last_receipt = state.equipment_source_last_receipt_at
    heartbeat_due = bool(
        live_source
        and last_device_observed_at is not None
        and (
            _equipment_source_gap_pending()
            or last_receipt is None
            or last_device_observed_at - last_receipt >= EQUIPMENT_SOURCE_RECEIPT_INTERVAL
        )
        and not any(
            receipt.source_runtime_instance_id == COUNTER_SOURCE_RUNTIME_INSTANCE_ID
            and receipt.source_connection_generation == generation
            and receipt.firmware_revision == firmware_revision
            and receipt.source_observed_through == last_device_observed_at
            and (
                not _equipment_source_gap_pending()
                or receipt.gap_requested
                and receipt.gap_version == state.equipment_source_gap_version
            )
            for receipt in state.pending_equipment_receipts
        )
    )
    if heartbeat_due:
        assert last_device_observed_at is not None
        assert isinstance(firmware_revision, str)
        _append_pending_equipment_receipt(
            _new_equipment_receipt(
                source_observed_through=last_device_observed_at,
                events=(),
                source_runtime_instance_id=COUNTER_SOURCE_RUNTIME_INSTANCE_ID,
                source_connection_generation=generation,
                firmware_revision=firmware_revision,
            )
        )
    if not state.pending_equipment_receipts:
        return

    receipts = state.pending_equipment_receipts.copy()
    state.pending_equipment_receipts.clear()
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for receipt in receipts:
                    payload = [
                        {
                            "equipment": event.equipment,
                            "source_observed_at": event.source_observed_at.astimezone(UTC).strftime(
                                "%Y-%m-%dT%H:%M:%S.%fZ"
                            ),
                            "state": event.state,
                        }
                        for event in receipt.events
                    ]
                    for event in receipt.events:
                        EquipmentStateEvent(
                            ts=event.source_observed_at,
                            equipment=event.equipment,
                            state=event.state,
                            greenhouse_id=GREENHOUSE_ID,
                        )
                    await conn.fetchrow(
                        """
                        SELECT * FROM public.fn_record_equipment_state_source_receipt(
                            $1::uuid, $2::timestamptz, $3::text, $4::text,
                            $5::jsonb, $6::boolean, $7::uuid, $8::bigint,
                            $9::text)
                        """,
                        receipt.receipt_id,
                        receipt.source_observed_through,
                        GREENHOUSE_ID,
                        policy_device_id(GREENHOUSE_ID),
                        json.dumps(payload, sort_keys=True, separators=(",", ":")),
                        receipt.gap_requested,
                        receipt.source_runtime_instance_id,
                        receipt.source_connection_generation,
                        receipt.firmware_revision,
                    )
        _ack_source([receipt.receipt_id for receipt in receipts])
    except BaseException:
        combined = receipts + state.pending_equipment_receipts
        if (
            len(combined) > EQUIPMENT_STATE_RECEIPT_BUFFER_MAX_ROWS
            and os.environ.get("VERDIFY_SOURCE_SPOOL_ENABLED") != "1"
        ):
            dropped = len(combined) - EQUIPMENT_STATE_RECEIPT_BUFFER_MAX_ROWS
            combined = combined[:EQUIPMENT_STATE_RECEIPT_BUFFER_MAX_ROWS]
            _mark_equipment_source_gap("state_receipt_retry_overflow")
            log.error(
                "equipment source receipt retry queue dropped newer receipts rows=%d",
                dropped,
            )
        state.pending_equipment_receipts[:] = combined
        raise

    committed_gap_versions = [receipt.gap_version for receipt in receipts if receipt.gap_requested]
    if committed_gap_versions:
        state.equipment_source_committed_gap_version = max(
            state.equipment_source_committed_gap_version,
            max(committed_gap_versions),
        )

    current_receipts = [
        receipt
        for receipt in receipts
        if receipt.source_runtime_instance_id == COUNTER_SOURCE_RUNTIME_INSTANCE_ID
        and receipt.source_connection_generation == generation
        and receipt.firmware_revision == firmware_revision
    ]
    if current_receipts:
        state.equipment_source_last_receipt_at = max(receipt.source_observed_through for receipt in current_receipts)
    event_count = sum(len(receipt.events) for receipt in receipts)
    log.debug(
        "equipment_state: %d exact events and %d immutable receipt(s) written",
        event_count,
        len(receipts),
    )
    # #113: fan-out each equipment event to the bus.
    for receipt in receipts:
        for event in receipt.events:
            _fanout_publish(
                "equipment_state",
                {
                    "ts": event.source_observed_at,
                    "equipment": event.equipment,
                    "state": event.state,
                },
            )


async def write_ordinary_equipment_events(pool: asyncpg.Pool) -> None:
    """Write the _ORDINARY_EQUIPMENT_STREAMS rows through the ordinary view.

    These streams (the controller's grow-light intent, Q-09) are outside the
    receipt function's stream list, so they never enter a continuity receipt.
    A row that fails schema validation is dropped, not retried.
    """
    if not state.pending_ordinary_equipment:
        return
    pending = state.pending_ordinary_equipment.copy()
    state.pending_ordinary_equipment.clear()
    rows: list[tuple[datetime, str, bool]] = []
    for observed_at, equipment, equipment_state in pending:
        try:
            EquipmentStateEvent(ts=observed_at, equipment=equipment, state=equipment_state, greenhouse_id=GREENHOUSE_ID)
        except ValidationError as e:
            log.error("equipment_state skipped (validation failed: %s): equipment=%s", e, equipment)
            shared.note_row_rejected("equipment_state")
            continue
        rows.append((observed_at, equipment, equipment_state))
    if not rows:
        return
    try:
        async with pool.acquire() as conn:
            await conn.executemany(
                "INSERT INTO v_runtime_equipment_state_write (ts, equipment, state) VALUES ($1, $2, $3)",
                rows,
            )
    except BaseException:
        state.pending_ordinary_equipment[0:0] = rows
        raise
    for observed_at, equipment, equipment_state in rows:
        _fanout_publish(
            "equipment_state",
            {"ts": observed_at, "equipment": equipment, "state": equipment_state},
        )


async def write_legacy_equipment_events(pool: asyncpg.Pool) -> None:
    """Preserve ordinary telemetry when the experiment collector is absent.

    This path intentionally creates no continuity receipt and therefore can
    never satisfy the v2 endpoint. It exists only to keep the pre-experiment
    equipment_state surface operating while the optional sealed credential is
    provisioned or during a collector rollback.
    """
    if not state.pending_equipment:
        return
    events = state.pending_equipment.copy()
    state.pending_equipment.clear()
    rows: list[tuple[datetime, str, bool]] = []
    try:
        for event in events:
            EquipmentStateEvent(
                ts=event.source_observed_at,
                equipment=event.equipment,
                state=event.state,
                greenhouse_id=GREENHOUSE_ID,
            )
            rows.append((event.source_observed_at, event.equipment, event.state))
        async with pool.acquire() as conn:
            await conn.executemany(
                "INSERT INTO v_runtime_equipment_state_write (ts, equipment, state) VALUES ($1, $2, $3)",
                rows,
            )
    except BaseException:
        state.pending_equipment[0:0] = events
        raise
    for observed_at, equipment, equipment_state in rows:
        _fanout_publish(
            "equipment_state",
            {"ts": observed_at, "equipment": equipment, "state": equipment_state},
        )


async def write_state_transitions(pool: asyncpg.Pool, ts: datetime) -> set[str]:
    """Flush pending state machine transitions."""
    if _observation_spool_enabled():
        await _drain_observations(pool)
        return set()
    if not state.pending_states:
        return set()
    transitions = state.pending_states.copy()
    state.pending_states.clear()
    validated: list[tuple[datetime, str, str]] = []
    for entity, val in transitions:
        try:
            SystemStateRow(ts=ts, entity=entity, value=val, greenhouse_id=GREENHOUSE_ID)
        except ValidationError as e:
            log.error(f"system_state skipped (validation failed: {e}): entity={entity} value={val!r}")
            shared.note_row_rejected("system_state")
            continue
        validated.append((ts, entity, val))
    if not validated:
        return set()
    async with pool.acquire() as conn:
        await conn.executemany(
            "INSERT INTO v_runtime_system_state_write (ts, entity, value) VALUES ($1, $2, $3)",
            validated,
        )
    log.debug(f"system_state: {len(validated)} transitions written")
    # #113: fan-out each transition to the bus.
    for row_ts, entity, val in validated:
        _fanout_publish("system_state", {"ts": row_ts, "entity": entity, "value": val})
    return {entity for _, entity, _ in validated}


def _equipment_source_now() -> datetime:
    """Return the host observation clock used by raw equipment sources."""
    return datetime.now(UTC)


def _begin_counter_source_generation(connection_generation: int, observed_at: datetime) -> bool:
    """Fence raw counter lineage to one live ESPHome transport generation."""
    if not 1 <= connection_generation <= 9_007_199_254_740_991:
        if connection_generation != 0:
            _mark_equipment_source_gap("invalid_connection_generation")
        return False
    if connection_generation == state.counter_source_connection_generation:
        return True
    if state.counter_source_connection_generation >= 1:
        _mark_equipment_source_gap("connection_generation_change")
    state.counter_source_connection_generation = connection_generation
    state.counter_reset_epoch_id = str(uuid4())
    state.counter_reset_local_date = observed_at.astimezone(COUNTER_SOURCE_TIMEZONE).date()
    state.counter_last_device_uptime_seconds = None
    state.counter_source_uptime_generation = 0
    state.counter_source_firmware_generation = 0
    state.counter_source_uptime_observed_at = None
    state.counter_source_firmware_observed_at = None
    state.counter_source_device_time_generation = 0
    state.counter_source_device_time_observed_at = None
    state.counter_source_device_time_epoch = None
    state.counter_source_local_hour_generation = 0
    state.counter_source_local_hour_observed_at = None
    state.counter_source_local_hour = None
    state.counter_source_sntp_generation = 0
    state.counter_source_sntp_observed_at = None
    state.counter_source_sntp_valid = False
    state.counter_source_device_local_date = None
    state.counter_last_native_values.clear()
    state.counter_generation_observations.clear()
    state.counter_generation_ready = False
    state.equipment_source_last_receipt_at = None
    return True


def _invalidate_counter_epoch(observed_at: datetime) -> None:
    """Start a new unready epoch after a reset boundary or continuity break."""
    state.counter_reset_epoch_id = str(uuid4())
    state.counter_reset_local_date = observed_at.astimezone(COUNTER_SOURCE_TIMEZONE).date()
    state.counter_generation_observations.clear()
    state.counter_generation_ready = False
    state.counter_last_native_values.clear()


def _rotate_counter_epoch_if_needed(
    device_uptime_seconds: float,
    observed_at: datetime,
    connection_generation: int | None = None,
) -> None:
    """Keep one conservative firmware-counter reset epoch.

    The firmware resets every daily counter at local midnight and on reboot.
    A process restart and every reconnect start a new epoch. No sample from a
    new generation is accepted until fresh uptime, firmware, and all nine
    counters have arrived on that generation.
    """
    if not math.isfinite(device_uptime_seconds) or not 0 <= device_uptime_seconds <= 1_000_000_000:
        _mark_equipment_source_gap("invalid_counter_source_uptime")
        _invalidate_counter_epoch(observed_at)
        return
    generation = shared.transport_generation if connection_generation is None else connection_generation
    if not _begin_counter_source_generation(generation, observed_at):
        return
    local_date = observed_at.astimezone(COUNTER_SOURCE_TIMEZONE).date()
    previous_uptime = state.counter_last_device_uptime_seconds
    if local_date != state.counter_reset_local_date or (
        previous_uptime is not None and device_uptime_seconds + 1.0 < previous_uptime
    ):
        _invalidate_counter_epoch(observed_at)
    state.counter_last_device_uptime_seconds = device_uptime_seconds


def _counter_lineage_is_fresh(
    connection_generation: int,
    observed_at: datetime | None = None,
) -> bool:
    complete = (
        connection_generation >= 1
        and state.counter_source_connection_generation == connection_generation
        and state.counter_source_uptime_generation == connection_generation
        and state.counter_source_firmware_generation == connection_generation
        and state.counter_source_uptime_observed_at is not None
        and state.counter_source_firmware_observed_at is not None
        and state.counter_source_device_time_generation == connection_generation
        and state.counter_source_device_time_observed_at is not None
        and state.counter_source_device_time_epoch is not None
        and state.counter_source_local_hour_generation == connection_generation
        and state.counter_source_local_hour_observed_at is not None
        and state.counter_source_local_hour is not None
        and state.counter_source_sntp_generation == connection_generation
        and state.counter_source_sntp_observed_at is not None
        and state.counter_source_sntp_valid
    )
    if not complete or observed_at is None:
        return complete
    moments = (
        state.counter_source_uptime_observed_at,
        state.counter_source_firmware_observed_at,
        state.counter_source_device_time_observed_at,
        state.counter_source_local_hour_observed_at,
        state.counter_source_sntp_observed_at,
    )
    if any(moment is None or abs(observed_at - moment) > _COUNTER_DIAGNOSTIC_MAX_AGE for moment in moments):
        return False
    assert state.counter_source_device_time_epoch is not None
    device_at = datetime.fromtimestamp(state.counter_source_device_time_epoch, UTC)
    if abs(device_at - observed_at) > _COUNTER_DEVICE_CLOCK_MAX_SKEW:
        return False
    device_local = device_at.astimezone(COUNTER_SOURCE_TIMEZONE)
    return (
        device_local.date() == observed_at.astimezone(COUNTER_SOURCE_TIMEZONE).date()
        and device_local.date() == state.counter_source_device_local_date
        and device_local.hour == state.counter_source_local_hour
    )


def _append_equipment_counter_sample(
    daily_column: str,
    native_value: float,
    observed_at: datetime,
    connection_generation: int,
) -> None:
    source = _COUNTER_SOURCE_BY_DAILY_COLUMN.get(daily_column)
    if source is None or not _counter_lineage_is_fresh(connection_generation, observed_at):
        return
    try:
        device_uptime_seconds = float(state.diagnostics.get("uptime_s"))
    except (TypeError, ValueError):
        return
    firmware_revision = state.diagnostics.get("firmware_version")
    stream, native_unit = source
    maximum_native_value = 1_500.0 if native_unit == "minutes" else 25.0
    if (
        not math.isfinite(native_value)
        or not 0 <= native_value <= maximum_native_value
        or not math.isfinite(device_uptime_seconds)
        or not 0 <= device_uptime_seconds <= 1_000_000_000
        or not _valid_source_firmware(firmware_revision)
        or not 1 <= connection_generation <= 9_007_199_254_740_991
    ):
        _mark_equipment_source_gap("invalid_counter_source_sample")
        return

    if len(state.pending_counter_samples) >= COUNTER_SAMPLE_BUFFER_MAX_ROWS:
        _mark_equipment_source_gap("counter_sample_buffer_overflow")
        log.error(
            "equipment counter source sample rejected at bounded buffer rows=%d",
            COUNTER_SAMPLE_BUFFER_MAX_ROWS,
        )
        return
    sample = PendingEquipmentCounterSample(
        sample_id=str(uuid4()),
        source_observed_at=observed_at,
        stream=stream,
        native_value=native_value,
        native_unit=native_unit,
        counter_reset_epoch_id=state.counter_reset_epoch_id,
        device_uptime_seconds=device_uptime_seconds,
        source_runtime_instance_id=COUNTER_SOURCE_RUNTIME_INSTANCE_ID,
        source_connection_generation=connection_generation,
        firmware_revision=firmware_revision,
    )
    if not _persist_source("counter", sample.sample_id, sample):
        return
    state.pending_counter_samples.append(sample)
    state.counter_last_native_values[daily_column] = native_value


def _complete_counter_generation_if_ready() -> None:
    """Release the initial counter burst only after its lineage is complete."""
    generation = shared.transport_generation
    if (
        state.counter_generation_ready
        or not _counter_lineage_is_fresh(generation)
        or set(state.counter_generation_observations) != _COUNTER_SOURCE_COLUMNS
    ):
        return
    assert state.counter_source_uptime_observed_at is not None
    assert state.counter_source_firmware_observed_at is not None
    moments = [observed_at for _native_value, observed_at in state.counter_generation_observations.values()]
    moments.extend(
        (
            state.counter_source_uptime_observed_at,
            state.counter_source_firmware_observed_at,
        )
    )
    latest = max(moments)
    cutoff = latest - _COUNTER_INITIAL_BURST_MAX_SKEW
    if min(moments) < cutoff:
        state.counter_generation_observations = {
            column: observation
            for column, observation in state.counter_generation_observations.items()
            if observation[1] >= cutoff
        }
        if state.counter_source_uptime_observed_at < cutoff:
            state.counter_source_uptime_generation = 0
            state.counter_source_uptime_observed_at = None
        if state.counter_source_firmware_observed_at < cutoff:
            state.counter_source_firmware_generation = 0
            state.counter_source_firmware_observed_at = None
        return
    observations = tuple(sorted(state.counter_generation_observations.items()))
    moments.extend(
        (
            state.counter_source_device_time_observed_at,
            state.counter_source_local_hour_observed_at,
            state.counter_source_sntp_observed_at,
        )
    )
    if any(moment is None for moment in moments):
        return
    typed_moments = [moment for moment in moments if moment is not None]
    latest = max(typed_moments)
    cutoff = latest - _COUNTER_INITIAL_BURST_MAX_SKEW
    if min(typed_moments) < cutoff or not _counter_lineage_is_fresh(generation, latest):
        state.counter_generation_observations = {
            column: observation
            for column, observation in state.counter_generation_observations.items()
            if observation[1] >= cutoff
        }
        return
    state.counter_generation_ready = True
    state.counter_generation_observations.clear()
    for daily_column, (native_value, observed_at) in observations:
        _append_equipment_counter_sample(daily_column, native_value, observed_at, generation)


def _queue_equipment_counter_sample(
    daily_column: str,
    raw_value: object,
    observed_at: datetime | None = None,
) -> None:
    if daily_column not in _COUNTER_SOURCE_BY_DAILY_COLUMN:
        return
    _stream, native_unit = _COUNTER_SOURCE_BY_DAILY_COLUMN[daily_column]
    maximum_native_value = 1_500.0 if native_unit == "minutes" else 25.0
    try:
        native_value = float(raw_value)
    except (TypeError, ValueError):
        _mark_equipment_source_gap("invalid_counter_source_value")
        return
    if not math.isfinite(native_value) or not 0 <= native_value <= maximum_native_value:
        _mark_equipment_source_gap("invalid_counter_source_value")
        return

    observed_at = _equipment_source_now() if observed_at is None else observed_at
    generation = shared.transport_generation
    if not _begin_counter_source_generation(generation, observed_at):
        return
    if _counter_lineage_is_fresh(generation, observed_at):
        try:
            device_uptime_seconds = float(state.diagnostics.get("uptime_s"))
        except (TypeError, ValueError):
            _mark_equipment_source_gap("invalid_counter_source_uptime")
            return
        if not math.isfinite(device_uptime_seconds) or not 0 <= device_uptime_seconds <= 1_000_000_000:
            _mark_equipment_source_gap("invalid_counter_source_uptime")
            return
        _rotate_counter_epoch_if_needed(device_uptime_seconds, observed_at, generation)

    if state.counter_generation_ready and _counter_lineage_is_fresh(generation, observed_at):
        previous_native = state.counter_last_native_values.get(daily_column)
        if previous_native is not None and native_value + 1e-9 < previous_native:
            # Any observed per-stream decrease means the firmware reset or
            # wrapped its whole daily counter bank. Rotate the global epoch and
            # re-hold until a fresh all-nine/diagnostic burst is complete.
            _invalidate_counter_epoch(observed_at)
            state.counter_generation_observations[daily_column] = (
                native_value,
                observed_at,
            )
            return
        _append_equipment_counter_sample(daily_column, native_value, observed_at, generation)
        return
    state.counter_generation_observations[daily_column] = (native_value, observed_at)
    _complete_counter_generation_if_ready()


async def write_equipment_counter_samples(pool: asyncpg.Pool) -> None:
    """Persist queued raw counters atomically through the insert-only function.

    Exact sample UUIDs make a whole-batch retry safe after an unknown commit.
    On any failure the batch is restored ahead of newer samples; no summary or
    reconstructed value is substituted.
    """
    if not state.pending_counter_samples:
        return
    samples = state.pending_counter_samples.copy()
    state.pending_counter_samples.clear()
    rows = [
        (
            sample.sample_id,
            sample.source_observed_at,
            GREENHOUSE_ID,
            policy_device_id(GREENHOUSE_ID),
            sample.stream,
            sample.native_value,
            sample.native_unit,
            sample.counter_reset_epoch_id,
            sample.device_uptime_seconds,
            sample.source_runtime_instance_id,
            sample.source_connection_generation,
            sample.firmware_revision,
        )
        for sample in samples
    ]
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.executemany(
                    """
                    SELECT * FROM public.fn_record_equipment_counter_sample(
                        $1::uuid, $2::timestamptz, $3::text, $4::text,
                        $5::text, $6::double precision, $7::text, $8::uuid,
                        $9::double precision, $10::uuid, $11::bigint, $12::text)
                    """,
                    rows,
                )
        _ack_source([sample.sample_id for sample in samples])
    except BaseException:
        combined = samples + state.pending_counter_samples
        if len(combined) > COUNTER_SAMPLE_BUFFER_MAX_ROWS and os.environ.get("VERDIFY_SOURCE_SPOOL_ENABLED") != "1":
            dropped = len(combined) - COUNTER_SAMPLE_BUFFER_MAX_ROWS
            combined = combined[:COUNTER_SAMPLE_BUFFER_MAX_ROWS]
            _mark_equipment_source_gap("counter_sample_retry_overflow")
            log.error(
                "equipment counter source retry queue dropped newer samples rows=%d",
                dropped,
            )
        state.pending_counter_samples[:] = combined
        raise


def _observe_current_state_messages(client: APIClient, on_state) -> object:
    """Observe the just-requested initial subscription without sending a replay.

    The pinned API registers handlers synchronously. Directly awaiting backfill
    after subscribe_states, without an intervening await, installs this observer
    before the event loop can deliver initial responses. No prior cache is read.
    """
    from functools import partial

    from aioesphomeapi.client import SUBSCRIBE_STATES_MSG_TYPES
    from aioesphomeapi.client_base import on_state_msg

    connection = client._get_connection()  # noqa: SLF001 - pinned observer-only adapter
    return connection.add_message_callback(partial(on_state_msg, on_state, {}), SUBSCRIBE_STATES_MSG_TYPES)


def _request_current_state_burst(client: APIClient, on_state) -> object:
    """Request one current-state burst on the already fenced API connection.

    ``APIClient.subscribe_states`` discards the callback-removal handle.  Use
    the pinned client's underlying callback API so this one-shot reader can be
    removed after the complete snapshot without accumulating subscribers.  It
    sends only ``SubscribeStatesRequest``; no command/setter message exists in
    this path and no second device connection is opened.
    """
    from functools import partial

    from aioesphomeapi.api_pb2 import SubscribeStatesRequest
    from aioesphomeapi.client import SUBSCRIBE_STATES_MSG_TYPES
    from aioesphomeapi.client_base import on_state_msg

    connection = client._get_connection()  # noqa: SLF001 - bounded pinned-library adapter
    return connection.send_message_callback_response(
        SubscribeStatesRequest(),
        partial(on_state_msg, on_state, {}),
        SUBSCRIBE_STATES_MSG_TYPES,
    )


def _finite_state_float(value: str | None) -> float | None:
    """Parse a system_state string to a finite float, or None.

    Routes the parse through the shared ``HAEntityState.as_float()`` contract
    (handles unavailable / non-numeric values) and additionally rejects
    non-finite results (inf/nan), which must never reach DB float columns.
    """
    if value is None:
        return None
    parsed = HAEntityState(entity_id="system_state", state=value).as_float()
    if parsed is None or not math.isfinite(parsed):
        return None
    return parsed


def _parse_json_object(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {"raw": value}
    return parsed if isinstance(parsed, dict) else {"raw": parsed}


def _climate_wet_assist_status(action: str, moisture_state: str | None, fog_allowed: bool) -> tuple[bool, str | None]:
    if action not in CLIMATE_WET_ACTIONS:
        return False, None
    if moisture_state == "served":
        return True, None
    if fog_allowed:
        return True, None

    vent_status = state.system.get("vent_mist_assist_status") or ""
    blocked_reason = None
    if vent_status.startswith("blocked:"):
        blocked_reason = vent_status.split(":", 1)[1] or "blocked"

    if moisture_state in {"engage_delay", "pulse_on", "pulse_gap"}:
        if blocked_reason and blocked_reason not in {"engage_delay", "pulse_gap", "served", "none"}:
            return False, blocked_reason
        return True, None
    if blocked_reason:
        return False, blocked_reason
    if moisture_state == "blocked":
        return False, state.system.get("moisture_block_reason") or "blocked"

    block = state.system.get("moisture_block_reason")
    if block and block not in {"none", "served", "pulse_gap"}:
        return False, block
    return False, None


def _normalized_block_reason(value: object) -> str | None:
    if value is None:
        return None
    reason = str(value).strip()
    return reason or None


def _climate_fog_assist_status(
    action: str,
    climate_block_reason: object,
    final_block_reason: object,
) -> tuple[bool, str | None]:
    """Return final fog authority after candidate and relay-level gates."""

    climate_reason = _normalized_block_reason(climate_block_reason)
    final_reason = _normalized_block_reason(final_block_reason)
    reason = final_reason if final_reason not in _NO_FOG_BLOCK_REASONS else climate_reason
    fog_allowed = bool(action in CLIMATE_FOG_ACTIONS and reason in _FOG_ALLOWED_REASONS)
    return fog_allowed, reason


# Lane C (#584): one SQL template, two renderings. The LEGACY rendering (all
# policy_* slots empty) is the exact pre-experiment statement and remains the
# feature-off path; the POLICY rendering adds the device-confirmed vector
# identity join (latest policy_exposures interval covering the tick, falling
# back to the latest policy_device_snapshots echo at or before it) into the
# migration-208 nullable columns. The legacy plan_context heuristic keeps
# populating plan_id/trigger_id/planner_instance for continuity either way.
_CLIMATE_ACTION_LOG_INSERT_TEMPLATE = """
            WITH latest_climate AS (
                SELECT c.*
                  FROM climate c
                 WHERE COALESCE(c.greenhouse_id, $1) = $1
                   AND c.temp_avg IS NOT NULL
                   AND c.vpd_avg IS NOT NULL
                 ORDER BY c.ts DESC
                 LIMIT 1
            ),
            band AS (
                SELECT
                    -- RULINGS AF2(a): the four edges come from the one band source, fn_band_setpoints, as the
                    -- targets do; the settings ledger read is never a band source.
                    bs.temp_low  AS temp_low_f,
                    bs.temp_high AS temp_high_f,
                    bs.vpd_low   AS vpd_low_kpa,
                    bs.vpd_high  AS vpd_high_kpa,
                    -- ADR0003 §6.3 (BC-9): the band TARGET is the served device-truth curve
                    -- (fn_band_setpoints, mig 181) — NOT the (low+high)/2 midpoint, which is
                    -- wrong on the asymmetric house band (temp_target sm=84 vs midpoint 81).
                    bs.temp_target AS temp_target_f,
                    bs.vpd_target  AS vpd_target_kpa
                FROM fn_band_setpoints(COALESCE((SELECT ts FROM latest_climate), $2)) AS bs
            ),
            plan_context AS (
                SELECT sp.plan_id, sp.trigger_id, sp.planner_instance
                  FROM setpoint_plan sp
                 WHERE COALESCE(sp.greenhouse_id, $1) = $1
                   AND sp.is_active = true
                   AND sp.parameter <> 'plan_metadata'
                   AND sp.ts <= COALESCE((SELECT ts FROM latest_climate), $2)
                 ORDER BY sp.ts DESC, sp.created_at DESC
                 LIMIT 1
            ){policy_identity_ctes}
            INSERT INTO v_runtime_climate_action_log_write (
                ts,
                greenhouse_id,
                climate_action,
                priority_axis,
                temp_low_f,
                temp_target_f,
                temp_high_f,
                vpd_low_kpa,
                vpd_target_kpa,
                vpd_high_kpa,
                temp_target_delta_f,
                vpd_target_delta_kpa,
                temp_band_error_f,
                vpd_band_error_kpa,
                moisture_assist_state,
                moisture_zone,
                wet_assist_allowed,
                wet_assist_block_reason,
                fog_allowed,
                fog_block_reason,
                relay_truth,
                resource_cost_estimate,
                climate_intent_version,
                plan_id,
                trigger_id,
                planner_instance,
                sensor_status,
                candidate_summary,
                source_system_state{policy_identity_cols}
            )
            SELECT
                $2,
                $1,
                $3,
                $4,
                band.temp_low_f,
                band.temp_target_f,
                band.temp_high_f,
                band.vpd_low_kpa,
                band.vpd_target_kpa,
                band.vpd_high_kpa,
                CASE WHEN lc.temp_avg IS NULL OR band.temp_target_f IS NULL
                     THEN NULL ELSE lc.temp_avg - band.temp_target_f END,
                CASE WHEN lc.vpd_avg IS NULL OR band.vpd_target_kpa IS NULL
                     THEN NULL ELSE lc.vpd_avg - band.vpd_target_kpa END,
                CASE
                    WHEN lc.temp_avg IS NULL OR band.temp_low_f IS NULL OR band.temp_high_f IS NULL THEN $5
                    WHEN lc.temp_avg < band.temp_low_f THEN lc.temp_avg - band.temp_low_f
                    WHEN lc.temp_avg > band.temp_high_f THEN lc.temp_avg - band.temp_high_f
                    ELSE 0.0
                END,
                CASE
                    WHEN lc.vpd_avg IS NULL OR band.vpd_low_kpa IS NULL OR band.vpd_high_kpa IS NULL THEN $6
                    WHEN lc.vpd_avg < band.vpd_low_kpa THEN lc.vpd_avg - band.vpd_low_kpa
                    WHEN lc.vpd_avg > band.vpd_high_kpa THEN lc.vpd_avg - band.vpd_high_kpa
                    ELSE 0.0
                END,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12,
                $13::jsonb,
                $14::jsonb,
                $15,
                pc.plan_id,
                pc.trigger_id,
                pc.planner_instance,
                jsonb_strip_nulls(
                    $16::jsonb || jsonb_build_object(
                        'latest_climate_ts', lc.ts,
                        'latest_climate_age_s',
                            CASE
                                WHEN lc.ts IS NULL THEN NULL
                                ELSE greatest(0, extract(epoch FROM ($2 - lc.ts))::int)
                            END,
                        'temp_avg_present', lc.temp_avg IS NOT NULL,
                        'vpd_avg_present', lc.vpd_avg IS NOT NULL,
                        'band_context_complete',
                            band.temp_low_f IS NOT NULL
                            AND band.temp_high_f IS NOT NULL
                            AND band.vpd_low_kpa IS NOT NULL
                            AND band.vpd_high_kpa IS NOT NULL
                    )
                ),
                $17,
                $18::jsonb{policy_identity_vals}
            FROM band
            LEFT JOIN latest_climate lc ON true
            LEFT JOIN plan_context pc ON true{policy_identity_join}
            """

_CLIMATE_ACTION_LOG_INSERT_LEGACY = _CLIMATE_ACTION_LOG_INSERT_TEMPLATE.format(
    policy_identity_ctes="",
    policy_identity_cols="",
    policy_identity_vals="",
    policy_identity_join="",
)

_CLIMATE_ACTION_LOG_INSERT_POLICY = _CLIMATE_ACTION_LOG_INSERT_TEMPLATE.format(
    policy_identity_ctes=""",
            policy_exposure_identity AS (
                SELECT pe.vector_id, epv.device_generation, epv.activation_sha256
                  FROM policy_exposures pe
                  JOIN effective_policy_vectors epv ON epv.vector_id = pe.vector_id
                 WHERE pe.device_id = $19
                   AND pe.started_at <= $2
                   AND (pe.ended_at IS NULL OR pe.ended_at > $2)
                 ORDER BY pe.started_at DESC
                 LIMIT 1
            ),
            policy_snapshot_identity AS (
                SELECT epv.vector_id, s.device_generation, s.activation_sha256
                  FROM policy_device_snapshots s
                  LEFT JOIN effective_policy_vectors epv
                    ON epv.activation_sha256 = s.activation_sha256
                 WHERE s.device_id = $19
                   AND s.reported_at <= $2
                   AND s.activation_sha256 IS NOT NULL
                 ORDER BY s.reported_at DESC
                 LIMIT 1
            ),
            policy_identity AS (
                SELECT * FROM policy_exposure_identity
                UNION ALL
                SELECT * FROM policy_snapshot_identity
                 WHERE NOT EXISTS (SELECT 1 FROM policy_exposure_identity)
            )""",
    policy_identity_cols=""",
                policy_vector_id,
                policy_generation,
                policy_activation_sha256""",
    policy_identity_vals=""",
                pi.vector_id,
                pi.device_generation,
                pi.activation_sha256""",
    policy_identity_join="""
            LEFT JOIN policy_identity pi ON true""",
)

_POLICY_IDENTITY_FALLBACK_LOGGED = False


def _log_policy_identity_fallback_once(exc: Exception) -> None:
    global _POLICY_IDENTITY_FALLBACK_LOGGED
    if not _POLICY_IDENTITY_FALLBACK_LOGGED:
        _POLICY_IDENTITY_FALLBACK_LOGGED = True
        log.warning(
            "climate_action_log: policy-identity join unavailable (%s: %s); falling back to the legacy insert",
            type(exc).__name__,
            exc,
        )


async def write_climate_action_log(pool: asyncpg.Pool, ts: datetime) -> bool:
    """Persist one structured ClimateIntent controller decision snapshot."""
    action = state.system.get("climate_action")
    priority_axis = state.system.get("climate_priority_axis")
    if not action or not priority_axis:
        return False

    moisture_state = state.system.get("climate_moisture_assist_state")
    moisture_zone = state.system.get("climate_moisture_zone") or "none"
    fog_allowed, fog_block_reason = _climate_fog_assist_status(
        action,
        state.system.get("climate_fog_block_reason"),
        state.system.get("fog_block_reason"),
    )
    wet_assist_allowed, wet_block_reason = _climate_wet_assist_status(action, moisture_state, fog_allowed)
    relay_truth = {equipment: bool(state.equipment.get(equipment, False)) for equipment in CLIMATE_RELAY_EQUIPMENT}
    source_system_state = {entity: state.system.get(entity) for entity in sorted(CLIMATE_ACTION_LOG_ENTITIES)}
    moisture_exchange = _parse_json_object(state.system.get("climate_moisture_exchange"))
    if moisture_exchange:
        # #327: normalize through the shared JSON contract
        # (verdify_schemas.MoistureExchangeTelemetry) so migration 187's
        # v_moisture_estimator_telemetry view and the MCP outcome_kpi() parser
        # read consistent types. Tolerant by contract: normalization never
        # raises — payloads that don't validate (e.g. the {"raw": ...}
        # parse-failure fallback) pass through unchanged, unknown keys are
        # preserved (only non-finite numbers are dropped, keeping JSONB
        # castable), and the two #410 fields (vent_held_vpd_gain_kpa,
        # hold_required) are optional like everything else (live fw 995c9b3
        # emits none of these fields).
        moisture_exchange = normalize_moisture_exchange_telemetry(moisture_exchange)
        source_system_state["climate_moisture_exchange"] = moisture_exchange
    resource_cost = _parse_json_object(state.system.get("climate_resource_cost_estimate"))

    try:
        ClimateActionLogRow(
            ts=ts,
            greenhouse_id=GREENHOUSE_ID,
            climate_action=action,
            priority_axis=priority_axis,
            temp_band_error_f=_finite_state_float(state.system.get("climate_temp_error_f")),
            vpd_band_error_kpa=_finite_state_float(state.system.get("climate_vpd_error_kpa")),
            moisture_assist_state=moisture_state,
            moisture_zone=moisture_zone,
            wet_assist_allowed=wet_assist_allowed,
            wet_assist_block_reason=wet_block_reason,
            fog_allowed=fog_allowed,
            fog_block_reason=fog_block_reason,
            relay_truth=relay_truth,
            resource_cost_estimate=resource_cost,
            climate_intent_version=CLIMATE_INTENT_CONTRACT_VERSION,
            candidate_summary=state.system.get("climate_candidate_summary"),
            source_system_state=source_system_state,
        )
    except ValidationError as e:
        log.error("climate_action_log skipped (validation failed: %s): action=%s priority=%s", e, action, priority_axis)
        shared.note_row_rejected("climate_action_log")
        return False

    args = (
        GREENHOUSE_ID,
        ts,
        action,
        priority_axis,
        _finite_state_float(state.system.get("climate_temp_error_f")),
        _finite_state_float(state.system.get("climate_vpd_error_kpa")),
        moisture_state,
        moisture_zone,
        wet_assist_allowed,
        wet_block_reason,
        fog_allowed,
        fog_block_reason,
        json.dumps(relay_truth, sort_keys=True),
        json.dumps(resource_cost, sort_keys=True),
        CLIMATE_INTENT_CONTRACT_VERSION,
        json.dumps({"latest_climate_age_s": None}, sort_keys=True),
        state.system.get("climate_candidate_summary"),
        json.dumps(source_system_state, sort_keys=True),
    )
    async with pool.acquire() as conn:
        if policy_vector_mode() != POLICY_VECTOR_MODE_OFF:
            # Lane C (#584): stamp the device-confirmed vector identity onto
            # the tick. The join must NEVER fail the insert — any error (e.g.
            # migration 208 not applied yet in this environment) falls back to
            # the legacy statement, logged once.
            try:
                await conn.execute(_CLIMATE_ACTION_LOG_INSERT_POLICY, *args, policy_device_id(GREENHOUSE_ID))
            except Exception as exc:  # noqa: BLE001 — fallback must catch everything
                _log_policy_identity_fallback_once(exc)
                await conn.execute(_CLIMATE_ACTION_LOG_INSERT_LEGACY, *args)
        else:
            await conn.execute(_CLIMATE_ACTION_LOG_INSERT_LEGACY, *args)
    log.debug("climate_action_log: action=%s priority=%s wet_allowed=%s", action, priority_axis, wet_assist_allowed)
    return True


async def write_override_events(pool: asyncpg.Pool, ts: datetime) -> None:
    """OBS-1e (Sprint 16): flush pending firmware override start events.

    Writes one row per newly-started override to override_events so the
    planner can correlate compliance misses with firmware decisions she
    cannot see any other way. "End" events are not written — the
    active_overrides system_state transitions carry that info.
    """
    if _observation_spool_enabled():
        await _drain_observations(pool)
        return None
    if not state.pending_override_events:
        return
    events = state.pending_override_events.copy()
    state.pending_override_events.clear()
    validated: list[tuple[datetime, str, str | None]] = []
    for otype, mode in events:
        try:
            OverrideEvent(ts=ts, override_type=otype, mode=mode, greenhouse_id=GREENHOUSE_ID)
        except ValidationError as e:
            log.error(f"override_events skipped (validation failed: {e}): type={otype} mode={mode}")
            shared.note_row_rejected("override_events")
            continue
        validated.append((ts, otype, mode))
    if not validated:
        return
    async with pool.acquire() as conn:
        await conn.executemany(
            "INSERT INTO v_runtime_override_events_write (ts, override_type, mode) VALUES ($1, $2, $3)",
            validated,
        )
    log.info(f"override_events: {len(validated)} start events written")


async def write_setpoint_changes(pool: asyncpg.Pool, ts: datetime) -> None:
    """Flush pending setpoint change events.

    These rows originate from the ESP32 reporting a configured-value change
    (firmware local override, manual HA switch toggle, etc.) — not from the
    dispatcher's own pushes (those write directly in tasks.py::setpoint_dispatcher
    with source='plan' | 'band'). Tagged source='esp32' to preserve provenance
    per SetpointSource literal in verdify_schemas/setpoint.py.
    """
    if _observation_spool_enabled():
        await _drain_observations(pool)
        return None
    if not state.pending_setpoints:
        return
    changes = state.pending_setpoints.copy()
    state.pending_setpoints.clear()
    validated: list[tuple[datetime, str, float, str, datetime, str]] = []
    for param, val in changes:
        if param in BAND_DRIVEN_PARAMS:
            log.debug("setpoint_changes ignored dispatcher-owned ESP32 echo: %s=%s", param, val)
            continue
        try:
            SetpointChange(ts=ts, parameter=param, value=val, source="esp32", greenhouse_id=GREENHOUSE_ID)
        except ValidationError as e:
            log.error(f"setpoint_changes skipped (validation failed: {e}): param={param} value={val}")
            shared.note_row_rejected("setpoint_changes")
            continue
        validated.append((ts, param, val, "esp32", ts, "observed"))
    if not validated:
        return
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO v_runtime_setpoint_changes_write
                (ts, parameter, value, source, confirmed_at, delivery_status)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            validated,
        )
    log.debug(f"setpoint_changes: {len(validated)} changes written")


async def write_diagnostics(pool: asyncpg.Pool, ts: datetime) -> None:
    """Write a diagnostics row."""
    d = state.diagnostics
    if _observation_spool_enabled():
        generation = shared.transport_generation
        if generation < 1 or shared.esp32.get("state_subscription_generation") != generation:
            return
        # Retained caches are not current-generation native observations. Each value of this connection is
        # written once: only when it is newer than the one last written for its column (DIAG-WINDOW). Values
        # that arrived between two ticks become one row each, oldest first, so a tick never drops one.
        accepted = state.diagnostic_accepted_observations

        def unwritten(col: str, moment: datetime, gen: int) -> bool:
            return (
                gen == generation
                and 0 <= (ts - moment).total_seconds() <= DIAG_OBSERVATION_MAX_AGE_S
                and not (col in accepted and accepted[col][1] == gen and accepted[col][0] >= moment)
            )

        queues: dict[str, list[tuple[datetime, int, Any]]] = {}
        for col, (moment, gen) in state.diagnostic_observations.items():
            queue = [e for e in state.diagnostic_pending.get(col, ()) if e[0] < moment and unwritten(col, *e[:2])]
            if unwritten(col, moment, gen):
                queue.append((moment, gen, d.get(col)))
            if queue:
                queues[col] = queue
        if not queues:
            return
        rows = []
        for i in range(max(len(queue) for queue in queues.values())):
            fresh = {col: queue[i] for col, queue in queues.items() if i < len(queue)}
            row_ts = max(moment for moment, _, _ in fresh.values())
            # A state the controller publishes only when it changes is carried from its last receipt in this
            # connection into every row, so the newest row always holds it; a new connection starts without it.
            carried = {
                col: d.get(col)
                for col, (moment, gen) in state.diagnostic_observations.items()
                if col in CARRIED_DIAGNOSTIC_COLUMNS and col not in fresh and gen == generation and moment <= row_ts
            }
            values = {col: value for col, (_, _, value) in fresh.items()} | carried
            try:
                diag = Diagnostics.model_validate({"ts": row_ts, "greenhouse_id": GREENHOUSE_ID, **values})
            except ValidationError as e:
                log.error(f"diagnostics row failed schema validation: {e}")
                shared.note_row_rejected("diagnostics")
                diag = None
            rows.append((row_ts, fresh, diag))
        for row_ts, fresh, diag in rows:
            if diag is not None:
                payload = diag.model_dump(mode="json", exclude={"ts", "greenhouse_id"})
                if not _accept_observations([("diagnostics", payload)], row_ts):
                    raise OSError("diagnostics snapshot durable acceptance rejected")
            # Acceptance advances the snapshot cadence even while DB is down. The common FIFO drain retries it;
            # never regenerate its UUID/time. A rejected row is not retried either.
            accepted.update({col: (moment, gen) for col, (moment, gen, _) in fresh.items()})
        return
    if not d:
        return
    try:
        diag = Diagnostics.model_validate({"ts": ts, "greenhouse_id": GREENHOUSE_ID, **d})
    except ValidationError as e:
        log.error(f"diagnostics row failed schema validation: {e}")
        shared.note_row_rejected("diagnostics")
        return
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO v_runtime_diagnostics_write (
                   ts, wifi_rssi, heap_bytes, heap_min_free_kb, heap_largest_free_block_kb,
                   uptime_s, probe_health, reset_reason,
                   firmware_version, active_probe_count, relief_cycle_count, vent_latch_timer_s,
                   sealed_timer_s, vpd_watch_timer_s, mist_backoff_timer_s, vent_mist_assist_active,
                   effective_heat_target_f, effective_cool_stage2_delta_f,
                   effective_vpd_hysteresis_kpa, effective_dehum_aggressive_kpa,
                   controller_time_epoch, controller_local_hour, sntp_valid, sntp_miss_count,
                   last_sntp_sync_age_s, band_source, zone_wet_granted,
                   heap_min_free_minute_kb, heap_largest_block_minute_low_kb, loop_worst_ms, restart_count,
                   nvs_used_entries, nvs_free_entries, nvs_write_worst_ms, gap_log_state, sensor_degraded_active,
                   loop_stack_high_water_b, wifi_disconnect_count, api_client_count
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                       $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
                       $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39)""",
            ts,
            diag.wifi_rssi,
            diag.heap_bytes,
            diag.heap_min_free_kb,
            diag.heap_largest_free_block_kb,
            diag.uptime_s,
            diag.probe_health,
            diag.reset_reason,
            diag.firmware_version,
            diag.active_probe_count,
            diag.relief_cycle_count,
            diag.vent_latch_timer_s,
            diag.sealed_timer_s,
            diag.vpd_watch_timer_s,
            diag.mist_backoff_timer_s,
            diag.vent_mist_assist_active,
            diag.effective_heat_target_f,
            diag.effective_cool_stage2_delta_f,
            diag.effective_vpd_hysteresis_kpa,
            diag.effective_dehum_aggressive_kpa,
            diag.controller_time_epoch,
            diag.controller_local_hour,
            diag.sntp_valid,
            diag.sntp_miss_count,
            diag.last_sntp_sync_age_s,
            diag.band_source,
            diag.zone_wet_granted,
            diag.heap_min_free_minute_kb,
            diag.heap_largest_block_minute_low_kb,
            diag.loop_worst_ms,
            diag.restart_count,
            diag.nvs_used_entries,
            diag.nvs_free_entries,
            diag.nvs_write_worst_ms,
            diag.gap_log_state,
            diag.sensor_degraded_active,
            diag.loop_stack_high_water_b,
            diag.wifi_disconnect_count,
            diag.api_client_count,
        )
    log.debug("diagnostics row written")
    # #113: fan-out the diagnostics row. Use the explicit column list above so the
    # subscriber's generic INSERT writes the same columns (greenhouse_id excluded —
    # the subscriber stamps its own).
    _fanout_publish(
        "diagnostics",
        {
            "ts": ts,
            "wifi_rssi": diag.wifi_rssi,
            "heap_bytes": diag.heap_bytes,
            "heap_min_free_kb": diag.heap_min_free_kb,
            "heap_largest_free_block_kb": diag.heap_largest_free_block_kb,
            "uptime_s": diag.uptime_s,
            "probe_health": diag.probe_health,
            "reset_reason": diag.reset_reason,
            "firmware_version": diag.firmware_version,
            "active_probe_count": diag.active_probe_count,
            "relief_cycle_count": diag.relief_cycle_count,
            "vent_latch_timer_s": diag.vent_latch_timer_s,
            "sealed_timer_s": diag.sealed_timer_s,
            "vpd_watch_timer_s": diag.vpd_watch_timer_s,
            "mist_backoff_timer_s": diag.mist_backoff_timer_s,
            "vent_mist_assist_active": diag.vent_mist_assist_active,
            "effective_heat_target_f": diag.effective_heat_target_f,
            "effective_cool_stage2_delta_f": diag.effective_cool_stage2_delta_f,
            "effective_vpd_hysteresis_kpa": diag.effective_vpd_hysteresis_kpa,
            "effective_dehum_aggressive_kpa": diag.effective_dehum_aggressive_kpa,
            "controller_time_epoch": diag.controller_time_epoch,
            "controller_local_hour": diag.controller_local_hour,
            "sntp_valid": diag.sntp_valid,
            "sntp_miss_count": diag.sntp_miss_count,
            "last_sntp_sync_age_s": diag.last_sntp_sync_age_s,
            "band_source": diag.band_source,
            "zone_wet_granted": diag.zone_wet_granted,
        },
    )


async def write_daily_summary(pool: asyncpg.Pool) -> None:
    """Snapshot daily accumulator values. Called at 23:58 America/Denver each day.

    Two-writer contract for daily_summary (see tasks.py::daily_summary_live):
      - This function owns the midnight UPSERT of raw accumulators from the
        ESP32's cycle/runtime/water counters: cycles_*, runtime_*_min,
        runtime_mister_*_h, water_used_gal, mister_water_gal.
      - `daily_summary_live` refreshes every 30 min with the live-computed
        climate rollups + stress_hours_* + compliance_pct + cost_* + dp_risk_*
        and also rewrites runtimes/cycles from equipment_state transitions.
    Column ownership overlaps on cycles/runtimes; `daily_summary_live`'s values
    win for the current day because it runs after this snapshot.
    """
    # The greenhouse day is America/Denver; the container clock is UTC, so a UTC date stamped the
    # previous local day's counters onto the next day's row.
    today = datetime.now(COUNTER_SOURCE_TIMEZONE).date()
    today_str = str(today)
    if state._daily_snapshot_date == today_str:
        return  # already done today

    d = state.daily
    if not d:
        log.warning("daily_summary: no accumulator data available yet, skipping")
        return

    water_total = state.climate.get("water_total_gal")
    mister_water = state.climate.get("mister_water_today")

    # Validate the accumulated daily row through DailySummaryRow (range +
    # non-negative stress-hour invariants). The schema has extra="ignore" so
    # unrelated keys in state.daily (climate rollups computed elsewhere) are
    # dropped; out-of-range cycles/runtimes raise.
    try:
        DailySummaryRow.model_validate(
            {
                "date": today,
                **d,
                "water_used_gal": water_total,
                "mister_water_gal": mister_water,
            }
        )
    except ValidationError as e:
        log.error(f"daily_summary row failed schema validation: {e}")
        shared.note_row_rejected("daily_summary")
        return

    fairness = d.get("mister_fairness_overrides_today")
    zone_cycles = {
        "cycles_mister_south": d.get("cycles_mister_south"),
        "cycles_mister_west": d.get("cycles_mister_west"),
        "cycles_mister_center": d.get("cycles_mister_center"),
        "cycles_drip_wall": d.get("cycles_drip_wall"),
        "cycles_drip_center": d.get("cycles_drip_center"),
    }
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO daily_summary (
                date,
                cycles_fan1, cycles_fan2, cycles_heat1, cycles_heat2,
                cycles_fog, cycles_vent,
                cycles_mister_south, cycles_mister_west, cycles_mister_center,
                cycles_drip_wall, cycles_drip_center,
                runtime_fan1_min, runtime_fan2_min, runtime_heat1_min, runtime_heat2_min,
                runtime_fog_min, runtime_vent_min,
                runtime_mister_south_h, runtime_mister_west_h, runtime_mister_center_h,
                water_used_gal, mister_water_gal,
                mister_fairness_overrides_today
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14, $15, $16,
                $17, $18, $19, $20, $21, $22, $23, $24
            ) ON CONFLICT (date) DO UPDATE SET
                cycles_fan1 = EXCLUDED.cycles_fan1,
                cycles_fan2 = EXCLUDED.cycles_fan2,
                cycles_heat1 = EXCLUDED.cycles_heat1,
                cycles_heat2 = EXCLUDED.cycles_heat2,
                cycles_fog = EXCLUDED.cycles_fog,
                cycles_vent = EXCLUDED.cycles_vent,
                cycles_mister_south = EXCLUDED.cycles_mister_south,
                cycles_mister_west = EXCLUDED.cycles_mister_west,
                cycles_mister_center = EXCLUDED.cycles_mister_center,
                cycles_drip_wall = EXCLUDED.cycles_drip_wall,
                cycles_drip_center = EXCLUDED.cycles_drip_center,
                runtime_fan1_min = EXCLUDED.runtime_fan1_min,
                runtime_fan2_min = EXCLUDED.runtime_fan2_min,
                runtime_heat1_min = EXCLUDED.runtime_heat1_min,
                runtime_heat2_min = EXCLUDED.runtime_heat2_min,
                runtime_fog_min = EXCLUDED.runtime_fog_min,
                runtime_vent_min = EXCLUDED.runtime_vent_min,
                runtime_mister_south_h = EXCLUDED.runtime_mister_south_h,
                runtime_mister_west_h = EXCLUDED.runtime_mister_west_h,
                runtime_mister_center_h = EXCLUDED.runtime_mister_center_h,
                water_used_gal = EXCLUDED.water_used_gal,
                mister_water_gal = EXCLUDED.mister_water_gal,
                mister_fairness_overrides_today = EXCLUDED.mister_fairness_overrides_today,
                captured_at = NOW()
            """,
            today,
            int(d.get("cycles_fan1") or 0),
            int(d.get("cycles_fan2") or 0),
            int(d.get("cycles_heat1") or 0),
            int(d.get("cycles_heat2") or 0),
            int(d.get("cycles_fog") or 0),
            int(d.get("cycles_vent") or 0),
            int(zone_cycles["cycles_mister_south"]) if zone_cycles["cycles_mister_south"] is not None else None,
            int(zone_cycles["cycles_mister_west"]) if zone_cycles["cycles_mister_west"] is not None else None,
            int(zone_cycles["cycles_mister_center"]) if zone_cycles["cycles_mister_center"] is not None else None,
            int(zone_cycles["cycles_drip_wall"]) if zone_cycles["cycles_drip_wall"] is not None else None,
            int(zone_cycles["cycles_drip_center"]) if zone_cycles["cycles_drip_center"] is not None else None,
            d.get("runtime_fan1_min"),
            d.get("runtime_fan2_min"),
            d.get("runtime_heat1_min"),
            d.get("runtime_heat2_min"),
            d.get("runtime_fog_min"),
            d.get("runtime_vent_min"),
            d.get("runtime_mister_south_h"),
            d.get("runtime_mister_west_h"),
            d.get("runtime_mister_center_h"),
            water_total,
            mister_water,
            int(fairness) if fairness is not None else None,
        )
    state._daily_snapshot_date = today_str
    log.info(f"daily_summary written for {today}")


async def write_esp32_logs(pool: asyncpg.Pool) -> None:
    """Flush pending ESP32 log messages to esp32_logs table + Loki."""
    if _observation_spool_enabled():
        await _drain_observations(pool)
        return None
    if not state.pending_logs:
        return
    logs = state.pending_logs.copy()
    state.pending_logs.clear()
    ts = datetime.now(UTC)

    # Validate each row through ESP32LogRow before the INSERT. Schema enforces
    # message min_length=1 — empty-after-ANSI-strip payloads get dropped here
    # instead of landing in the DB as blank rows.
    validated: list[tuple[datetime, str, str | None, str]] = []
    for lvl, tag, msg in logs:
        try:
            ESP32LogRow(ts=ts, level=lvl, tag=tag, message=msg)
        except ValidationError:
            continue
        validated.append((ts, lvl, tag, msg))
    if not validated:
        return

    # Write to DB
    async with pool.acquire() as conn:
        await conn.executemany(
            "INSERT INTO v_runtime_esp32_logs_write (ts, level, tag, message) VALUES ($1, $2, $3, $4)",
            validated,
        )

        # M4 / B9: MEASURED A/B instrumentation for esp32_logs re-enable.
        # esp32_logs forwarding was disabled at the firmware to protect heap
        # (commit 90bc358). We do NOT auto-re-enable it — that is a firmware OTA
        # decision. But whenever logs ARE flowing (a controlled operator
        # re-enable), this records the concurrent heap state alongside the log
        # batch size so the heap impact is MEASURED rather than guessed. The
        # paired log-quiet baseline is every diagnostics row where no log batch
        # flushed; comparing largest-free-block in the two regimes is the A/B.
        heap_now = await conn.fetchrow(
            "SELECT heap_largest_free_block_kb, heap_min_free_kb, heap_bytes FROM diagnostics ORDER BY ts DESC LIMIT 1"
        )
        if heap_now is not None:
            log.info(
                "esp32_logs A/B: flushed %d msgs; concurrent heap largest_free=%.1fkB min_free=%.1fkB "
                "(log-active sample — compare vs log-quiet diagnostics baseline before re-enabling)",
                len(validated),
                float(heap_now["heap_largest_free_block_kb"] or 0.0),
                float(heap_now["heap_min_free_kb"] or 0.0),
            )

    # Push to Loki (best-effort, don't block on failure)
    try:
        loki_lines = []
        ts_ns = str(int(ts.timestamp() * 1e9))
        for _ts, lvl, tag, msg in validated:
            loki_lines.append([ts_ns, f"[{lvl}] [{tag or 'esp32'}] {msg}"])
        payload = json.dumps(
            {
                "streams": [
                    {
                        "stream": {"job": "esp32", "host": "greenhouse"},
                        "values": loki_lines,
                    }
                ]
            }
        ).encode()
        if LOKI_URL:
            req = urllib.request.Request(LOKI_URL, data=payload, headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=2)
    except Exception:
        pass  # Don't fail ingestor if Loki is down

    log.debug(f"esp32_logs: {len(validated)} messages written")


def on_log_message(msg) -> None:
    """Callback for ESP32 log messages via aioesphomeapi."""
    import re

    level = LOG_LEVEL_MAP.get(msg.level, "UNKNOWN")
    tag = msg.tag if hasattr(msg, "tag") else None
    raw = msg.message if hasattr(msg, "message") else str(msg)
    # Decode bytes if needed, strip ANSI escape codes
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    if isinstance(tag, bytes):
        tag = tag.decode("utf-8", errors="replace")
    message = re.sub(r"\x1b\[[0-9;]*m", "", raw)  # Strip ANSI colors
    if msg.level <= ESP32_LOG_LEVEL:
        if _observation_spool_enabled():
            _accept_observations([("esp32_log", {"level": level, "tag": tag, "message": message})], datetime.now(UTC))
        else:
            state.pending_logs.append((level, tag, message))


def _generation_log_callback(client, connection_generation: int):
    """Bind logs to the same live native subscription as state callbacks."""

    def on_generation_log(msg) -> None:
        if (
            shared.transport_generation != connection_generation
            or shared.esp32.get("client") is not client
            or shared.esp32.get("state_subscription_client") is not client
            or shared.esp32.get("state_subscription_generation") != connection_generation
        ):
            return
        on_log_message(msg)

    return on_generation_log


# ──────────────────────────────────────────────────────────────
# Setpoint validation — reject boot-time defaults and implausible values
# ──────────────────────────────────────────────────────────────
_SETPOINT_RANGES = {
    "temp_high": (50, 110),
    "temp_low": (35, 90),
    "vpd_high": (0.3, 4.0),
    "vpd_low": (0.1, 3.0),
}

_RECONCILABLE_CFG_PARAMS = frozenset(SETPOINT_MAP.values())

# Boot window: suppress ESP32 setpoint reports for 60s after connect
# to prevent firmware defaults from polluting the DB
_BOOT_WINDOW_S = 60

# ESPHome number entities often echo a direct push on their next state
# publish, which can arrive well after the command returns. Suppress those
# delayed echoes so they are not recorded as controller-side changes.
_PUSH_ECHO_SUPPRESS_S = 900


def _same_pushed_value(param: str, value: float) -> bool:
    pushed_value = shared.recently_pushed_values.get(param)
    if pushed_value is None:
        return False
    return abs(pushed_value - value) / max(abs(value), 1e-3) < 0.01


# DISPATCHER-08: after a reboot the controller can report a setting's pre-push value a few seconds after the dispatcher
# pushed it (law boot 2026-11-16 22:02:51Z: pushes at 22:04:51Z, old-value 'esp32' rows at 22:04:53-58Z, and the
# confirming echo then suppressed as a same-value echo), so the ledger's newest row named a value the controller no
# longer held. A report that differs from a value this connection pushed under _PUSH_RACE_S ago is that race: it is
# not recorded and does not update the comparison cache, so a later report of the same value still is.
_PUSH_RACE_S = 30


def _report_races_push(param: str, value: float, now: float | None = None) -> bool:
    pushed_at = shared.recently_pushed.get(param, 0.0)
    connected_at = shared.esp32_connected_at
    if not pushed_at or connected_at <= 0 or pushed_at < connected_at:
        return False
    if (time.time() if now is None else now) - pushed_at >= _PUSH_RACE_S:
        return False
    return not _same_pushed_value(param, value)


# F10 (Sprint 24-alignment): firmware emits mister_state + mister_selected_zone
# as numeric template sensors (state_class=measurement), not text. Map the int
# codes to human-readable names before routing to system_state so Grafana
# and the planner see "S1"/"south" not "1". Unknown codes fall through as
# "unknown(N)" so drift is visible.
# Source: firmware/greenhouse/controls.yaml (state machine) + greenhouse_types.h
# (MistStage enum).
_MISTER_STATE_NAMES = {
    0: "WATCH",
    1: "S1",
    2: "S2",
    3: "FOG",
}
_MISTER_ZONE_NAMES = {
    0: "none",
    1: "south",
    2: "west",
    3: "center",
}
_NUMERIC_STATE_DECODERS = {
    "mister_state": _MISTER_STATE_NAMES,
    "mister_zone": _MISTER_ZONE_NAMES,
}


def _decode_numeric_state(entity_name: str, val: float) -> str:
    """F10: translate a numeric state-machine code to a human label."""
    decoder = _NUMERIC_STATE_DECODERS.get(entity_name)
    if decoder is None:
        return str(val)
    code = int(val)
    return decoder.get(code, f"unknown({code})")


def _accept_setpoint(param: str, value: float) -> bool:
    """Return True if this setpoint value should be written to the DB."""
    import time as _time

    # Boot window: suppress ESP32-reported setpoints for first 60s
    if shared.esp32_connected_at > 0:
        elapsed = _time.time() - shared.esp32_connected_at
        if elapsed < _BOOT_WINDOW_S:
            log.debug("Boot window (%ds): suppressing %s=%.2f", int(elapsed), param, value)
            return False

    # Range validation: reject implausible values
    if param in _SETPOINT_RANGES:
        lo, hi = _SETPOINT_RANGES[param]
        if value < lo or value > hi:
            log.warning("Rejecting implausible setpoint %s=%.2f (valid range %.1f-%.1f)", param, value, lo, hi)
            return False

    return True


def _accept_outbound_setpoint(param: str, value: float) -> bool:
    """Return True if a DB-origin setpoint is inside registry bounds."""
    spec = get_tunable(param)
    if spec is None or spec.kind != "numeric":
        return True
    if spec.min is not None and value < spec.min:
        log.warning("Rejecting outbound setpoint %s=%.3f below registry min %.3f", param, value, spec.min)
        return False
    if spec.max is not None and value > spec.max:
        log.warning("Rejecting outbound setpoint %s=%.3f above registry max %.3f", param, value, spec.max)
        return False
    return True


INTEGER_DIAGNOSTIC_COLUMNS = {
    "controller_time_epoch",
    "controller_local_hour",
    "sntp_valid",
    "sntp_miss_count",
    "last_sntp_sync_age_s",
    "restart_count",
    "nvs_used_entries",
    "nvs_free_entries",
    "sensor_degraded_active",
    "loop_stack_high_water_b",
    "wifi_disconnect_count",
    "api_client_count",
}

# Diagnostics the controller publishes on change, not every minute (#1633 release 3): each row carries the last value
# received in this connection. Per-minute windows (the minute lows and worst times) are never carried.
CARRIED_DIAGNOSTIC_COLUMNS = frozenset(
    {"sensor_degraded_active", "gap_log_state", "restart_count", "nvs_used_entries", "nvs_free_entries"}
)

# The controller's own health (migration 314). A NaN (a failed nvs_get_stats) or another unusable reading is stored
# as NULL, never as the last value and never as 0, and never fails the whole diagnostics row.
HEALTH_DIAGNOSTIC_NUMERIC_COLUMNS = frozenset(
    {
        "heap_min_free_minute_kb",
        "heap_largest_block_minute_low_kb",
        "loop_worst_ms",
        "restart_count",
        "nvs_used_entries",
        "nvs_free_entries",
        "nvs_write_worst_ms",
        "sensor_degraded_active",
        "loop_stack_high_water_b",
        "wifi_disconnect_count",
        "api_client_count",
    }
)


def _coerce_integer_diagnostic(col: str, value: Any) -> int | None:
    try:
        decimal_value = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        log.warning("diagnostic rejected non-integer: %s=%r", col, value)
        return None
    if decimal_value != decimal_value.to_integral_value():
        log.warning("diagnostic rejected fractional integer: %s=%r", col, value)
        return None
    parsed = int(decimal_value)
    if parsed < 0:
        log.warning("diagnostic rejected negative integer: %s=%r", col, value)
        return None
    return parsed


def _record_diagnostic(
    obj_id: str,
    value: Any,
    observed_at: datetime | None = None,
    native_generation: int | None = None,
) -> bool:
    col = DIAGNOSTIC_MAP.get(obj_id)
    if not col:
        return False
    observed_at = _equipment_source_now() if observed_at is None else observed_at
    generation = shared.transport_generation
    state.diagnostic_observations.pop(col, None)

    def note_native_observation():
        if (
            native_generation == generation
            and generation >= 1
            and shared.esp32.get("state_subscription_generation") == generation
            and observed_at.tzinfo is not None
            and observed_at.utcoffset() is not None
        ):
            state.diagnostic_observations[col] = (observed_at, generation)
            pending = [e for e in state.diagnostic_pending.get(col, ()) if e[1] == generation and e[0] < observed_at]
            pending.append((observed_at, generation, state.diagnostics.get(col)))
            state.diagnostic_pending[col] = pending[-DIAG_PENDING_PER_COLUMN:]

    _begin_counter_source_generation(generation, observed_at)
    if col == "uptime_s":
        try:
            parsed_uptime = float(value)
        except (TypeError, ValueError):
            parsed_uptime = math.nan
        if math.isfinite(parsed_uptime) and 0 <= parsed_uptime <= 1_000_000_000:
            state.diagnostics[col] = parsed_uptime
            state.counter_source_uptime_generation = generation
            state.counter_source_uptime_observed_at = observed_at
            _relay_edges_across_boot(parsed_uptime, observed_at, generation)
            _rotate_counter_epoch_if_needed(parsed_uptime, observed_at, generation)
            _complete_counter_generation_if_ready()
            note_native_observation()
            return True
        if generation >= 1:
            _mark_equipment_source_gap("invalid_device_uptime")
            _invalidate_counter_epoch(observed_at)
        state.counter_source_uptime_generation = 0
        state.counter_source_uptime_observed_at = None
        return True
    if col == "firmware_version":
        previous_firmware = state.diagnostics.get(col)
        previous_is_current = state.counter_source_firmware_generation == generation
        if not _valid_source_firmware(value):
            if generation >= 1:
                _mark_equipment_source_gap("invalid_firmware_revision")
                state.counter_generation_ready = False
            state.counter_source_firmware_generation = 0
            state.counter_source_firmware_observed_at = None
            return True
        elif previous_is_current and previous_firmware != value:
            _mark_equipment_source_gap("firmware_revision_change")
            _invalidate_counter_epoch(observed_at)
    if col in HEALTH_DIAGNOSTIC_NUMERIC_COLUMNS:
        try:
            reading = float(value)
        except (TypeError, ValueError):
            reading = math.nan
        if not math.isfinite(reading) or reading < 0:
            state.diagnostics.pop(col, None)
            return True
        if col not in INTEGER_DIAGNOSTIC_COLUMNS:
            state.diagnostics[col] = reading
            note_native_observation()
            return True
    if col in INTEGER_DIAGNOSTIC_COLUMNS:
        parsed = _coerce_integer_diagnostic(col, value)
        if parsed is None and col in HEALTH_DIAGNOSTIC_NUMERIC_COLUMNS:
            state.diagnostics.pop(col, None)
            return True
        if parsed is None:
            if generation >= 1 and col in {
                "controller_time_epoch",
                "controller_local_hour",
                "sntp_valid",
            }:
                _mark_equipment_source_gap("invalid_device_clock_diagnostic")
            return True
        state.diagnostics[col] = parsed
        if col == "controller_time_epoch":
            previous_epoch = state.counter_source_device_time_epoch
            previous_date = state.counter_source_device_local_date
            device_at = datetime.fromtimestamp(parsed, UTC)
            device_local_date = device_at.astimezone(COUNTER_SOURCE_TIMEZONE).date()
            if state.counter_source_device_time_generation == generation and (
                (previous_epoch is not None and parsed + 5 < previous_epoch)
                or (previous_date is not None and device_local_date != previous_date)
            ):
                _mark_equipment_source_gap("device_clock_regression")
                _invalidate_counter_epoch(observed_at)
            state.counter_source_device_time_generation = generation
            state.counter_source_device_time_observed_at = observed_at
            state.counter_source_device_time_epoch = parsed
            state.counter_source_device_local_date = device_local_date
            _complete_counter_generation_if_ready()
        elif col == "controller_local_hour":
            if parsed > 23:
                _mark_equipment_source_gap("invalid_device_local_hour")
                _invalidate_counter_epoch(observed_at)
                state.counter_source_local_hour_generation = 0
                state.counter_source_local_hour_observed_at = None
                state.counter_source_local_hour = None
                return True
            previous_hour = state.counter_source_local_hour
            previous_epoch = state.counter_source_device_time_epoch
            if (
                state.counter_source_local_hour_generation == generation
                and previous_hour is not None
                and previous_epoch is not None
                and parsed != datetime.fromtimestamp(previous_epoch, UTC).astimezone(COUNTER_SOURCE_TIMEZONE).hour
            ):
                _invalidate_counter_epoch(observed_at)
            state.counter_source_local_hour_generation = generation
            state.counter_source_local_hour_observed_at = observed_at
            state.counter_source_local_hour = parsed
            _complete_counter_generation_if_ready()
        elif col == "sntp_valid":
            if parsed != 1:
                _mark_equipment_source_gap("device_clock_untrusted")
                _invalidate_counter_epoch(observed_at)
                state.counter_source_sntp_generation = 0
                state.counter_source_sntp_observed_at = None
                state.counter_source_sntp_valid = False
                state.counter_source_device_time_generation = 0
                state.counter_source_device_time_observed_at = None
                state.counter_source_device_time_epoch = None
                state.counter_source_local_hour_generation = 0
                state.counter_source_local_hour_observed_at = None
                state.counter_source_local_hour = None
                state.counter_source_device_local_date = None
                return True
            state.counter_source_sntp_generation = generation
            state.counter_source_sntp_observed_at = observed_at
            state.counter_source_sntp_valid = True
            _complete_counter_generation_if_ready()
    else:
        state.diagnostics[col] = value
    if col == "firmware_version" and _valid_source_firmware(value):
        state.counter_source_firmware_generation = generation
        state.counter_source_firmware_observed_at = observed_at
        _complete_counter_generation_if_ready()
    note_native_observation()
    return True


def _record_cfg_readback(obj_id: str, value: Any) -> bool:
    """Record a firmware cfg_* readback if this entity is part of that contract."""
    cfg_param = CFG_READBACK_MAP.get(obj_id)
    if not cfg_param:
        return False

    try:
        val = float(value)
    except (TypeError, ValueError):
        log.warning("cfg_readback rejected non-numeric: %s=%r", obj_id, value)
        return True
    if math.isnan(val):
        return True

    if cfg_param in _SETPOINT_RANGES:
        lo, hi = _SETPOINT_RANGES[cfg_param]
        if val < lo or val > hi:
            log.warning(
                "cfg_readback rejected out-of-range: %s=%.3f (valid %s-%s)",
                cfg_param,
                val,
                lo,
                hi,
            )
            return True

    generation = int(shared.transport_generation)
    prev = shared.cfg_readback.get(cfg_param)
    prev_generation = shared.cfg_readback_generation.get(cfg_param)
    replay_was_ready = shared.transport_readbacks_ready(generation)
    state.cfg_readback[cfg_param] = val
    replay_completed = shared.note_cfg_readback_observed(cfg_param, val, generation)
    if replay_completed:
        log.info(
            "writer_reconcile reason=transport_reconnect generation=%d action=readbacks_complete readback_count=%d",
            generation,
            len(shared.transport_observed_cfg_readbacks),
        )
    drift_version: int | None = None
    if (
        cfg_param in _RECONCILABLE_CFG_PARAMS
        and replay_was_ready
        and prev_generation == generation
        and prev is not None
        and not math.isclose(prev, val, rel_tol=0.01, abs_tol=0.001)
    ):
        drift_version = shared.note_cfg_drift(cfg_param)
        log.info(
            "writer_reconcile reason=cfg_drift param=%s generation=%d drift_version=%d",
            cfg_param,
            shared.transport_generation,
            drift_version,
        )
    return True


def _mirror_irrigation_number_readback(param: str, value: Any) -> None:
    """Treat ESP32 writable-entity state reports as current device truth.

    Most writable fields also expose cfg_* diagnostic sensors, but a small
    legacy set only has its native Number/Switch state. Mirroring every mapped
    writable entity closes that gap so reconnect never needs a blind restore.
    The historical helper name is retained for compatibility with source
    contract tests and callers.
    """
    if param not in _RECONCILABLE_CFG_PARAMS:
        return
    try:
        val = float(value)
    except (TypeError, ValueError):
        log.warning("writable entity readback rejected non-numeric: %s=%r", param, value)
        return
    if not math.isfinite(val):
        return
    if param in _SETPOINT_RANGES:
        lo, hi = _SETPOINT_RANGES[param]
        if not lo <= val <= hi:
            return
    generation = int(shared.transport_generation)
    prev = shared.cfg_readback.get(param)
    prev_generation = shared.cfg_readback_generation.get(param)
    replay_was_ready = shared.transport_readbacks_ready(generation)
    state.cfg_readback[param] = val
    shared.note_cfg_readback_observed(param, val, generation)
    if (
        replay_was_ready
        and prev_generation == generation
        and prev is not None
        and not math.isclose(prev, val, rel_tol=0.01, abs_tol=0.001)
    ):
        drift_version = shared.note_cfg_drift(param)
        log.info(
            "writer_reconcile reason=cfg_drift param=%s generation=%d drift_version=%d source=number_mirror",
            param,
            shared.transport_generation,
            drift_version,
        )


# ──────────────────────────────────────────────────────────────
# ESP32 callbacks
# ──────────────────────────────────────────────────────────────
def _record_ordinary_equipment_callback(
    equipment: str,
    value: object,
    observed_at: datetime,
    source_generation: int,
    source_clock_valid: bool,
) -> None:
    """Queue an on-change row for a stream the receipt function does not admit."""
    if type(value) is not bool:
        return
    old = state.equipment.get(equipment)
    state.equipment[equipment] = value
    if old == value or source_generation < 1 or not source_clock_valid:
        return
    if len(state.pending_ordinary_equipment) >= EQUIPMENT_STATE_EVENT_BUFFER_MAX_ROWS:
        log.error("ordinary equipment state event dropped at bounded buffer equipment=%s", equipment)
        return
    state.pending_ordinary_equipment.append((observed_at, equipment, value))


def _note_relay_generation(generation: int) -> None:
    """On the first callback of a new connection, keep the relays the previous one held ON (RULINGS AF6)."""
    if generation == state.relay_generation:
        return
    state.relay_generation = generation
    state.relays_on_before_connection = {
        equipment
        for equipment, value in state.equipment.items()
        if value is True and equipment not in _ORDINARY_EQUIPMENT_STREAMS
    }
    state.relays_first_seen = {}


def _relay_edges_across_boot(uptime_s: float, observed_at: datetime, generation: int) -> None:
    """RULINGS AF6 (TEL-F4, RLY-F4): when the controller's uptime resets, every relay the host held ON dropped at
    the boot. Write an OFF edge at the boot time (report time minus uptime) for each, an ON edge at its first report
    for a relay that came back ON (the cache swallowed it as no change), and clear the cache of relays not yet
    reported, so the first state after the boot is stored as an edge. The rows go through the ordinary view, as the
    reconnect snapshot's do: they predate this connection's receipts."""
    _note_relay_generation(generation)
    previous = state.relay_last_uptime_s
    state.relay_last_uptime_s = uptime_s
    if previous is None or uptime_s + 1.0 >= previous:
        return
    boot_at = observed_at - timedelta(seconds=uptime_s)
    held = state.relays_on_before_connection  # a boot always ends the API session, so a new connection came first
    edges = [(boot_at, equipment, False) for equipment in sorted(held)]
    for equipment in sorted(held):
        first = state.relays_first_seen.get(equipment)
        if first is not None and first[0] is True:
            edges.append((max(first[1], boot_at), equipment, True))
    for equipment in [e for e in state.equipment if e not in state.relays_first_seen]:
        if equipment not in _ORDINARY_EQUIPMENT_STREAMS:
            del state.equipment[equipment]
    state.relays_on_before_connection = set()
    room = EQUIPMENT_STATE_EVENT_BUFFER_MAX_ROWS - len(state.pending_ordinary_equipment)
    if len(edges) > room:
        log.error("relay boot edges dropped at bounded buffer: %d of %d", len(edges) - max(room, 0), len(edges))
        edges = edges[: max(room, 0)]
    state.pending_ordinary_equipment.extend(edges)
    log.info("controller boot at %s: %d relay edge(s) written for %s", boot_at.isoformat(), len(edges), sorted(held))


def _record_equipment_callback(
    equipment: str,
    value: object,
    observed_at: datetime,
    source_generation: int,
    source_clock_valid: bool,
) -> None:
    _note_relay_generation(source_generation)
    if type(value) is bool and equipment not in state.relays_first_seen:
        state.relays_first_seen[equipment] = (value, observed_at)
    # VD-64: the irrigation bridge reads the wet relays' live states (and when each last read OFF) from here,
    # before any dedupe, so a new transport generation re-labels an unchanged state.
    shared.note_wet_relay(equipment, value, source_generation, observed_at)
    if equipment in _ORDINARY_EQUIPMENT_STREAMS:
        _record_ordinary_equipment_callback(equipment, value, observed_at, source_generation, source_clock_valid)
        return
    if type(value) is not bool:
        if source_generation >= 1:
            _mark_equipment_source_gap("invalid_equipment_state_value")
        return
    old = state.equipment.get(equipment)
    state.equipment[equipment] = value
    if old == value or source_generation < 1:
        return
    if not source_clock_valid:
        return
    firmware_revision = state.diagnostics.get("firmware_version")
    if not _valid_source_firmware(firmware_revision) or state.counter_source_firmware_generation != source_generation:
        _mark_equipment_source_gap("equipment_event_lineage_unavailable")
        return
    _append_pending_equipment_event(
        PendingEquipmentStateEvent(
            observed_at,
            equipment,
            value,
            COUNTER_SOURCE_RUNTIME_INSTANCE_ID,
            source_generation,
            firmware_revision,
        )
    )


def _payload_rejected(obj_id: str, why: str) -> None:
    """Count a rejected versioned payload: the first of a run at WARNING, the rest at DEBUG (payload_rejected
    alerts on the run after 10 minutes)."""
    shared.payload_rejections += 1
    first, count = shared.payload_rejected_since.get(obj_id, (datetime.now(UTC), 0))
    shared.payload_rejected_since[obj_id] = (first, count + 1)
    (log.warning if count == 0 else log.debug)("%s payload rejected: %s", obj_id, why)


def on_state_change(entity_state, *, native_generation: int | None = None) -> None:
    """Called by aioesphomeapi on any entity state change."""
    source_observed_at = _equipment_source_now()
    source_generation = shared.transport_generation
    source_clock_valid = bool(
        isinstance(source_observed_at, datetime)
        and source_observed_at.tzinfo is not None
        and source_observed_at.utcoffset() is not None
    )
    if source_generation >= 1:
        previous_observed_at = state.equipment_source_last_device_observed_at
        previous_generation = state.equipment_source_last_device_generation
        if not source_clock_valid:
            _mark_equipment_source_gap("invalid_callback_timestamp")
        elif (
            previous_generation == source_generation
            and previous_observed_at is not None
            and source_observed_at < previous_observed_at
        ):
            # Never regress the barrier. The sticky gap survives subsequent
            # forward callbacks until a gap-marked receipt commits.
            _mark_equipment_source_gap("callback_clock_nonmonotonic")
            state.fixed_panel_native.mark_clock_gap(datetime.now(UTC))
            source_clock_valid = False
        else:
            if previous_generation >= 1 and previous_generation != source_generation:
                _mark_equipment_source_gap("connection_generation_change")
            state.equipment_source_last_device_observed_at = source_observed_at
            state.equipment_source_last_device_generation = source_generation
    key = entity_state.key
    obj_id = state.key_to_object_id.get(key)
    etype = state.key_to_type.get(key)
    if obj_id is None:
        return

    if obj_id in C1_OBSERVATION_SLUGS:
        return  # callback-only evidence; not a new climate DB column

    if etype == "sensor":
        val = entity_state.state
        if val is None or (isinstance(val, float) and math.isnan(val)):
            return

        if _record_cfg_readback(obj_id, val):
            return

        if _record_climate_sensor(obj_id, val):
            # Only the callback fenced by the current native subscription can
            # contribute. Direct callers and retained/old callbacks cannot.
            if native_generation is not None and source_clock_valid:
                firmware_revision = (
                    state.diagnostics.get("firmware_version")
                    if state.counter_source_firmware_generation == source_generation
                    else None
                )
                state.fixed_panel_native.observe(obj_id, val, source_observed_at, native_generation, firmware_revision)
            return

        if _record_diagnostic(obj_id, val, source_observed_at, native_generation if source_clock_valid else None):
            return

        col = DAILY_ACCUM_MAP.get(obj_id)
        if col:
            state.daily[col] = val
            _queue_equipment_counter_sample(col, val, source_observed_at)
            return

        param = SETPOINT_MAP.get(obj_id)
        if param:
            # Initial native replay is device truth even while the boot window
            # suppresses firmware defaults from the historical DB write path.
            _mirror_irrigation_number_readback(param, val)
            if not _accept_setpoint(param, val):
                return
            if _report_races_push(param, val):
                log.info("setpoint_changes: %s=%s races this connection's push; not recorded", param, val)
                return
            old = state.setpoints.get(param)
            if old != val:
                if _observation_spool_enabled():
                    if not _accept_observations(
                        [("setpoint_observed", {"parameter": param, "value": val})], source_observed_at
                    ):
                        return
                else:
                    state.pending_setpoints.append((param, val))
            state.setpoints[param] = val
            return

        # F10: numeric state-machine template sensors (mister_state,
        # mister_selected_zone) route to system_state as decoded strings.
        # These are diagnostic signals the planner uses to correlate VPD
        # outcomes with which zone was firing; without this route they
        # go stale in v_sensor_staleness within minutes.
        entity = STATE_MAP.get(obj_id)
        if entity:
            decoded = _decode_numeric_state(entity, val)
            old = state.system.get(entity)
            if old != decoded:
                if _observation_spool_enabled():
                    if not _accept_observations(
                        [("system_state", {"entity": entity, "value": decoded})], source_observed_at
                    ):
                        return
                else:
                    state.pending_states.append((entity, decoded))
            state.system[entity] = decoded
            if old != decoded:
                log.info(f"state: {entity} → {decoded}")
            return

    elif etype == "binary":
        val = entity_state.state
        equip = EQUIPMENT_BINARY_MAP.get(obj_id)
        if equip:
            _record_equipment_callback(
                equip,
                val,
                source_observed_at,
                source_generation,
                source_clock_valid,
            )
            return

    elif etype == "switch":
        val = entity_state.state
        if _record_cfg_readback(obj_id, 1.0 if val else 0.0):
            return

        param = SETPOINT_MAP.get(obj_id)
        if param:
            _mirror_irrigation_number_readback(param, 1.0 if val else 0.0)

        equip = EQUIPMENT_SWITCH_MAP.get(obj_id)
        if equip:
            _record_equipment_callback(
                equip,
                val,
                source_observed_at,
                source_generation,
                source_clock_valid,
            )
            return

    elif etype == "text":
        val = entity_state.state
        # VD-42: the irrigation engine's readbacks, for irrigation_sync's 5 s tick. Here "" is a reading (no token, no
        # outcome), so a run's last token leaving is never lost; only a sensor that has not published has no state.
        irrigation_text = obj_id in shared.IRRIGATION_TEXT_SENSORS
        if irrigation_text and getattr(entity_state, "missing_state", False):
            return
        if irrigation_text:
            val = val or ""
            shared.note_irrigation_readback(obj_id, val, source_generation, source_observed_at)
        elif not val:
            return

        # Lane C/E contract v2 (#586): the ONE aggregated policy-identity echo.
        # Its raw payload is cached in shared.policy_readback and never becomes
        # a climate column.
        if obj_id == POLICY_IDENTITY_SENSOR:
            shared.policy_readback[POLICY_IDENTITY_SENSOR] = val
            return

        # #1633 release 3: the gap-log replay lines (contracts gap-log section 9), never a system_state row.
        if obj_id == gap_replay.GAP_REPLAY_SENSOR:
            gap_replay.host.receive(val)
            return

        if _record_diagnostic(obj_id, val, source_observed_at, native_generation if source_clock_valid else None):
            return

        entity = STATE_MAP.get(obj_id)
        if entity:
            # #963: preserve old firmware's JSON and new firmware's separate
            # full-detail entity at the same canonical analytics key. A short
            # visible action must never replace that structured observation.
            if obj_id == "climate_moisture_exchange" and not val.lstrip().startswith("{"):
                entity = "climate_moisture_exchange_action"
            elif obj_id == "climate_moisture_exchange_details":
                try:
                    payload = json.loads(val)
                    if not isinstance(payload, dict):
                        raise ValueError("detail must be an object")
                    val = json.dumps(expand_moisture_exchange_wire(payload), separators=(",", ":"))
                except (ValueError, TypeError):
                    log.warning("Moisture-exchange detail has an unsupported wire shape")
                    val = '{"raw":"unsupported_moisture_exchange_detail"}'
            elif obj_id in VERSIONED_TEXT_PAYLOADS:
                try:
                    val = VERSIONED_TEXT_PAYLOADS[obj_id].model_validate_json(val).model_dump_json()
                except ValidationError:
                    _payload_rejected(obj_id, "not a version 1 object of its contract")
                    return
                shared.payload_rejected_since.pop(obj_id, None)
            elif obj_id == "climate_law_constants":
                val = val.strip()
                if not LAW_CONSTANTS_HASH.fullmatch(val):
                    _payload_rejected(obj_id, "not 64 lowercase hex characters")
                    return
                shared.payload_rejected_since.pop(obj_id, None)
            old = state.system.get(entity)
            # climate_law_state (60 s heartbeat), outdoor_source (every 300 s) and climate_law_constants (hourly)
            # are stored on every receipt: the newest row's age shows the law is running, how old the controller's
            # outdoor reading choice is, and that the constants hash belongs to the build running now. The two
            # grow-light reasons too (the light timer and resync read a reason within 120 s). The two grow-light
            # states are stored on change and on a 10-minute keyframe (#1662), inside the lighting views' 15 minutes.
            force_refresh = entity in {
                "gl_main_reason",
                "gl_grow_reason",
                "climate_law_state",
                "outdoor_source",
                "climate_law_constants",
            } or light_state_keyframe_due(entity, time.monotonic())
            if old != val or force_refresh:
                if _observation_spool_enabled():
                    events = [("system_state", {"entity": entity, "value": val})]
                    if entity == "overrides_active":
                        current = _parse_override_set(val)
                        events.extend(
                            ("override", {"override_type": kind, "mode": state.system.get("greenhouse_state")})
                            for kind in sorted(current - state.last_override_set)
                        )
                    if not _accept_observations(events, source_observed_at):
                        return
                else:
                    state.pending_states.append((entity, val))
                state.system[entity] = val
                if entity in LIGHT_STATE_KEYFRAME_ENTITIES:
                    _light_state_stored_at[entity] = time.monotonic()
                if old != val:
                    log.info(f"state: {entity} → {val}")
                    # #1370: activity rows for the controller's occupancy lights.
                    observe_occupancy_light_state(entity, state.system)
                # OBS-1e (Sprint 16): active_overrides is a comma-separated
                # list of firmware flags. Diff against last-seen set and
                # enqueue one override_events row per newly-started flag.
                if entity == "overrides_active":
                    current = _parse_override_set(val)
                    started = current - state.last_override_set
                    if started:
                        mode_str = state.system.get("greenhouse_state")
                        if not _observation_spool_enabled():
                            for otype in sorted(started):
                                state.pending_override_events.append((otype, mode_str))
                    state.last_override_set = current
            return

    elif etype == "number":
        val = entity_state.state
        if val is None or (isinstance(val, float) and math.isnan(val)):
            return

        param = SETPOINT_MAP.get(obj_id)
        if param:
            # Initial native replay is device truth even while the boot window
            # suppresses firmware defaults from the historical DB write path.
            _mirror_irrigation_number_readback(param, val)
            if not _accept_setpoint(param, val):
                return
            if _report_races_push(param, val):
                log.info("setpoint_changes: %s=%s races this connection's push; not recorded", param, val)
                return
            old = state.setpoints.get(param)
            if old != val:
                # Suppress same-value echoes from delayed ESPHome number-state publishes.
                import time as _time

                pushed_at = shared.recently_pushed.get(param, 0)
                if _time.time() - pushed_at < _PUSH_ECHO_SUPPRESS_S and _same_pushed_value(param, val):
                    state.setpoints[param] = val
                    return
                if _observation_spool_enabled():
                    if not _accept_observations(
                        [("setpoint_observed", {"parameter": param, "value": val})], source_observed_at
                    ):
                        return
                else:
                    state.pending_setpoints.append((param, val))
            state.setpoints[param] = val
            return


# ──────────────────────────────────────────────────────────────
# Flush loop
# ──────────────────────────────────────────────────────────────
def _report_spool_health() -> None:
    """Report enabled queues even when acceptance/draining has stopped."""
    queues = {
        "equipment": _source_spool,
        "climate": _climate_event_spool,
        "observational": _observation_spool.queue if _observation_spool is not None else None,
    }
    for name, queue in queues.items():
        if queue is None:
            continue
        try:
            report = {"queue": name, **queue.health()}
            level = (
                logging.WARNING
                if any(report[key] for key in ("backlog_high", "backlog_stale", "disk_headroom_low"))
                else logging.INFO
            )
            log.log(level, "ingestor_spool_health %s", json.dumps(report, sort_keys=True))
        except Exception as exc:
            # Metadata failure must not disrupt the sole writer or drop work.
            log.error("ingestor_spool_health_failed queue=%s reason=%s", name, type(exc).__name__)


# #1662 (package 4.4): readbacks are stored on change. The 60 s pass still reads the whole cache, confirms writes
# against all of it and fans all of it out; a parameter's setpoint_snapshot row is inserted only when its value moved
# beyond the readback tolerance (float32 noise never counts), a write or desired row for it is newer
# than its last stored row (so a write that repeats the value still gets a confirming row), the controller
# reconnected (a parameter with no row from the current transport generation) or the ingestor restarted, a writer
# admission asked for a complete batch (dormant: no production caller), or its hourly keyframe is due.
# Keyframes are staggered by a hash of the name so every pass stores a few. Each pass stores one system_state row
# (READBACK_PASS_ENTITY): readers take freshness from it, not from the newest readback.
READBACK_KEYFRAME_S = 3600
LIGHT_STATE_KEYFRAME_S = 600
LIGHT_STATE_KEYFRAME_ENTITIES = frozenset({"gl_main_state", "gl_grow_state"})
_light_state_stored_at: dict[str, float] = {}


def light_state_keyframe_due(entity: str, now: float) -> bool:
    """A grow-light state repeats into system_state once its last stored row is 10 minutes old (#1662)."""
    if entity not in LIGHT_STATE_KEYFRAME_ENTITIES:
        return False
    stored_at = _light_state_stored_at.get(entity)
    return stored_at is None or now - stored_at >= LIGHT_STATE_KEYFRAME_S


READBACK_PASS_ENTITY = "setpoint_snapshot_pass"
_READBACK_REL_TOLERANCE = 1e-6  # float32 carries about 7 significant digits

_READBACK_WRITES_SQL = """
SELECT parameter, max(at) AS at FROM (
    SELECT parameter, ts AS at FROM setpoint_changes
     WHERE ts > now() - interval '2 hours' AND COALESCE(source, '') <> 'esp32'
    UNION ALL
    SELECT param, created_at FROM v_desired_state_current
     WHERE greenhouse_id = $1 AND created_at > now() - interval '2 hours'
) AS w
 GROUP BY parameter
"""


@dataclass
class ReadbackStore:
    """What the publisher last stored per parameter: (value, batch time, transport generation of that row)."""

    stored: dict[str, tuple[float, datetime, int]] = field(default_factory=dict)


_readback_store = ReadbackStore()


def readback_unchanged(param: str, stored: float, value: float) -> bool:
    """Same readback: within the parameter's readback tolerance or float32 resolution."""
    return math.isclose(
        float(value), float(stored), rel_tol=_READBACK_REL_TOLERANCE, abs_tol=readback_abs_tolerance(param)
    )


def readback_keyframe_due(param: str, last_at: datetime, now: datetime) -> bool:
    """True once the parameter's staggered hourly slot has passed since its last stored row."""
    slot = zlib.crc32(param.encode()) % READBACK_KEYFRAME_S
    epoch = now.timestamp()
    boundary = math.floor((epoch - slot) / READBACK_KEYFRAME_S) * READBACK_KEYFRAME_S + slot
    return last_at.timestamp() < boundary


def readbacks_to_store(
    frozen: dict[str, float],
    store: ReadbackStore,
    *,
    now: datetime,
    generation: int,
    written_at: dict[str, datetime],
    complete: bool = False,
) -> set[str]:
    """The parameters whose readback row this pass inserts (#1662).

    A parameter with no row from the current transport generation is stored as soon as it is in the cache, so every
    parameter gets a post-boot row after a reconnect, including one the controller replays after the first pass.
    complete: a writer admission's demand publication stores every readback as one batch. Dormant: nothing in
    production calls shared.request_setpoint_snapshot; its reader is bounded_reconcile._fresh_readbacks through the
    drift probe, which needs an approval file and is deleted with the P1 deletions (#1662 review m5, m10).
    """
    if complete:
        return set(frozen)
    chosen = set()
    for param, value in frozen.items():
        previous = store.stored.get(param)
        if previous is None or previous[2] != generation:
            chosen.add(param)
            continue
        stored_value, stored_at, _generation = previous
        written = written_at.get(param)
        if (
            not readback_unchanged(param, stored_value, value)
            or (written is not None and written > stored_at)
            or readback_keyframe_due(param, stored_at, now)
        ):
            chosen.add(param)
    return chosen


async def _readback_writes(conn: asyncpg.Connection) -> dict[str, datetime]:
    """The newest write or desired row per parameter in the last two hours (plans are retired, #1633).

    A failed read raises: the pass fails and the next one retries. Confirmations ride the same transaction, so a
    pass that cannot read its writes stores nothing rather than every readback."""
    rows = await conn.fetch(_READBACK_WRITES_SQL, GREENHOUSE_ID)
    return {row["parameter"]: row["at"] for row in rows if row["at"] is not None}


# RULINGS AF1 (control-path F4): after a reboot the controller can report its stored value a few seconds after a push
# and before the push is confirmed, so the 'esp32' observed row lands later than the push it predates. A confirmation
# then leaves the ledger's newest row naming a value the controller no longer holds. The rows confirmed in this
# transaction (confirmed_at = now(), the transaction's time) are read with the newest row of their parameter.
CONFIRMED_NOW_SQL = """
SELECT DISTINCT ON (c.parameter)
       c.parameter, c.ts AS confirmed_ts, c.value AS confirmed_value,
       n.ts AS newest_ts, n.value AS newest_value, n.source AS newest_source
  FROM setpoint_changes c
  JOIN LATERAL (
        SELECT newest.ts, newest.value, newest.source
          FROM setpoint_changes newest
         WHERE newest.parameter = c.parameter
           AND COALESCE(newest.greenhouse_id, '') = COALESCE(c.greenhouse_id, '')
         ORDER BY newest.ts DESC
         LIMIT 1
       ) n ON true
 WHERE c.confirmed_at = now()
   AND c.delivery_status = 'confirmed'
   AND COALESCE(c.source, '') <> 'esp32'
   AND c.parameter = ANY($1::text[])
 ORDER BY c.parameter, c.ts DESC
"""


def observed_rows_to_restore(confirmed: list[Mapping[str, Any]]) -> list[tuple[str, float]]:
    """(parameter, value) for each confirmation whose parameter's newest row is a later 'esp32' observation of
    another value; the caller writes one observed row with the confirmed value at the confirmation time."""
    restore = []
    for row in confirmed:
        if row["newest_source"] != "esp32" or row["newest_ts"] <= row["confirmed_ts"]:
            continue
        held, newest = float(row["confirmed_value"]), float(row["newest_value"])
        if abs(newest - held) <= readback_abs_tolerance(row["parameter"]) or (
            abs(newest - held) / max(abs(held), 1e-3) < 0.01
        ):
            continue
        restore.append((row["parameter"], held))
    return restore


async def _restore_confirmed_value_as_newest(conn, params: list[str], ts: datetime) -> None:
    if not params:
        return
    restore = []
    for param, value in observed_rows_to_restore(await conn.fetch(CONFIRMED_NOW_SQL, params)):
        try:
            SetpointChange(
                ts=ts,
                parameter=param,
                value=value,
                source="esp32",
                confirmed_at=ts,
                delivery_status="observed",
                greenhouse_id=GREENHOUSE_ID,
            )
        except ValidationError as error:
            log.error(
                "setpoint_changes restore skipped (validation failed: %s): param=%s value=%s", error, param, value
            )
            shared.note_row_rejected("setpoint_changes")
            continue
        restore.append((param, value))
    if restore:
        await conn.executemany(
            "INSERT INTO v_runtime_setpoint_changes_write "
            "(ts, parameter, value, source, confirmed_at, delivery_status) "
            "VALUES (now(), $1, $2, 'esp32', now(), 'observed')",
            restore,
        )
        log.info("setpoint_changes: restored the confirmed value as newest for %s", ", ".join(p for p, _ in restore))


async def _publish_setpoint_snapshot(pool: asyncpg.Pool, ts: datetime, *, reason: str = "periodic") -> None:
    """Commit one immutable cached-readback batch before fanout or admission ACK."""
    if shared.is_shadow_mode():
        shared.fail_setpoint_snapshot_publication()
        return
    if not shared.owns_setpoint_snapshot_publication():
        raise RuntimeError("setpoint snapshot publication belongs to flush_loop")
    started = asyncio.get_event_loop().time()
    generation = int(shared.transport_generation)
    frozen = dict(state.cfg_readback)
    snapshot_rows: list[tuple[datetime, str, float]] = []
    for param, val in frozen.items():
        try:
            SetpointSnapshot(ts=ts, parameter=param, value=val, greenhouse_id=GREENHOUSE_ID)
        except ValidationError as error:
            log.error("setpoint_snapshot skipped (validation failed: %s): param=%s value=%s", error, param, val)
            shared.note_row_rejected("setpoint_snapshot")
            continue
        snapshot_rows.append((ts, param, val))
    try:
        async with asyncio.timeout(shared.SETPOINT_SNAPSHOT_WAIT_SECONDS):
            async with pool.acquire() as conn:
                written_at = await _readback_writes(conn)
                chosen = readbacks_to_store(
                    {param: val for _ts, param, val in snapshot_rows},
                    _readback_store,
                    now=ts,
                    generation=generation,
                    written_at=written_at,
                    complete=reason == "writer_admission",
                )
                stored_rows = [row for row in snapshot_rows if row[1] in chosen]
                async with conn.transaction():
                    await conn.executemany(
                        "INSERT INTO v_runtime_setpoint_snapshot_write (ts, parameter, value) VALUES ($1, $2, $3)",
                        stored_rows,
                    )
                    # FW-4 uses the SAME immutable values as this committed batch.
                    # Its existing tolerance and superseding-request predicates stay unchanged.
                    await conn.executemany(
                        """
                            UPDATE v_runtime_setpoint_changes_write sc
                               SET confirmed_at = now(),
                                   delivery_status = 'confirmed'
                             WHERE sc.parameter = $1
                               AND sc.confirmed_at IS NULL
                               AND COALESCE(sc.delivery_status, 'pending') IN ('sent', 'pending')
                               AND sc.ts > now() - interval '7 days'
                               AND (
                                   abs(sc.value - $2::double precision)
                                         / greatest(abs($2::double precision), 1e-3) < 0.01
                                   OR abs(sc.value - $2::double precision) <= $3::double precision
                               )
                               AND NOT EXISTS (
                                   SELECT 1
                                     FROM setpoint_changes newer
                                   WHERE newer.parameter = sc.parameter
                                     AND COALESCE(newer.greenhouse_id, '') = COALESCE(sc.greenhouse_id, '')
                                     AND COALESCE(newer.source, '') <> 'esp32'
                                     AND newer.ts > sc.ts
                                     AND NOT (
                                         abs(newer.value - $2::double precision)
                                               / greatest(abs($2::double precision), 1e-3) < 0.01
                                         OR abs(newer.value - $2::double precision) <= $3::double precision
                                     )
                               )
                            """,
                        [(param, val, readback_abs_tolerance(param)) for _ts, param, val in snapshot_rows],
                    )
                    await _restore_confirmed_value_as_newest(conn, [param for _ts, param, _val in snapshot_rows], ts)
                    marker = SystemStateRow(
                        ts=ts,
                        entity=READBACK_PASS_ENTITY,
                        value=f"stored={len(stored_rows)} of={len(snapshot_rows)}",
                        greenhouse_id=GREENHOUSE_ID,
                    )
                    await conn.execute(
                        "INSERT INTO v_runtime_system_state_write (ts, entity, value) VALUES ($1, $2, $3)",
                        marker.ts,
                        marker.entity,
                        marker.value,
                    )
    except BaseException:
        shared.fail_setpoint_snapshot_publication()
        raise
    for _ts, param, val in stored_rows:
        _readback_store.stored[param] = (val, ts, generation)
    # Both statements have committed. A confirmation failure cannot broadcast
    # rolled-back snapshots or acknowledge a batch that never became durable.
    for snap_ts, param, val in snapshot_rows:
        _fanout_publish("setpoint_snapshot", {"ts": snap_ts, "parameter": param, "value": val})
    published = {param: val for _ts, param, val in snapshot_rows}
    # A writer admission reads the canonical fields back as one stored batch: only a pass that stored all of them
    # can be reused for it (the demand publication stores every readback; dormant, see readbacks_to_store).
    shared.finish_setpoint_snapshot_publication(
        generation,
        published,
        ts,
        canonical_complete=shared.transport_readbacks_ready(generation)
        # Release 4: the live wire fields only; the 43 reserved slots have no entity and no readback.
        and {spec.name for spec in live_wire_fields()} <= {param for _ts, param, _val in stored_rows},
    )
    log.info(
        "setpoint_snapshot publication=committed reason=%s generation=%d rows=%d stored=%d "
        "batch_at=%s elapsed_ms=%.1f current_content=%s",
        reason,
        generation,
        len(snapshot_rows),
        len(stored_rows),
        ts.isoformat(),
        (asyncio.get_event_loop().time() - started) * 1000,
        shared.setpoint_snapshot_is_current(generation),
    )


async def flush_loop(
    pool: asyncpg.Pool,
    equipment_source_pool: asyncpg.Pool | None = None,
) -> None:
    """Periodically flush buffered data to the database."""
    if shared.is_shadow_mode():
        # Main never creates this pool in shadow mode. Keep the loop itself
        # fail-closed as well so a future/direct caller cannot inject a
        # separately credentialed source writer around the ordinary pool proxy.
        equipment_source_pool = None
    shared.register_setpoint_snapshot_publisher()
    last_snapshot_attempt = 0.0
    last_climate = 0.0
    last_climate_action_log = 0.0
    last_diag = 0.0
    last_fixed_panel_report = 0.0
    last_fixed_panel_db_error = 0.0
    last_spool_report = 0.0

    while True:
        await asyncio.sleep(5)
        now = asyncio.get_event_loop().time()
        ts = datetime.now(UTC)

        if now - last_spool_report >= 60:
            _report_spool_health()
            last_spool_report = now

        if _observation_spool_enabled():
            try:
                await _drain_observations(pool)
            except Exception as exc:
                log.error("observational spool drain paused: %s", type(exc).__name__)

        if state.fixed_panel_native.ledger_enabled:
            try:
                await write_fixed_panel_native_events(pool)
            except Exception as e:
                if now - last_fixed_panel_db_error >= 60:
                    log.error("fixed-panel native callback ledger write failed: %s", e)
                    last_fixed_panel_db_error = now

        # One compact source-side report per minute. This deliberately does
        # not relabel 60 s DB flush rows as fresh native observations. Logs are
        # an operational signal, not a durable 18 h evidence ledger.
        if now - last_fixed_panel_report >= 60:
            log.info(
                "fixed_panel_native_callbacks %s",
                json.dumps(state.fixed_panel_native.drain(ts), sort_keys=True),
            )
            last_fixed_panel_report = now

        # Climate row every 60s
        if now - last_climate >= CLIMATE_FLUSH_INTERVAL:
            try:
                await write_climate(pool, ts)
                last_climate = now
                if now - last_climate_action_log >= CLIMATE_ACTION_LOG_INTERVAL:
                    if await write_climate_action_log(pool, ts):
                        last_climate_action_log = now
            except Exception as e:
                log.error(f"climate write error: {e}")

        # Diagnostics every 60s
        if now - last_diag >= DIAG_FLUSH_INTERVAL:
            try:
                await write_diagnostics(pool, ts)
                last_diag = now
            except Exception as e:
                log.error(f"diagnostics write error: {e}")

        # Diagnostics keep their60s cadence. The same publisher additionally
        # services a bounded live-writer admission request on its existing loop.
        snapshot_due = now - last_snapshot_attempt >= DIAG_FLUSH_INTERVAL
        if state.cfg_readback and (snapshot_due or shared.setpoint_snapshot_requested.is_set()):
            generation = int(shared.transport_generation)
            if not snapshot_due and shared.coalesce_setpoint_snapshot_request(generation):
                pass  # Reuse the actual committed content; do not retime its batch.
            else:
                publication_reason = "writer_admission" if shared.setpoint_snapshot_requested.is_set() else "periodic"
                shared.setpoint_snapshot_requested.clear()
                # A demand publication also schedules the next periodic batch.
                # Failed attempts retain a bounded cadence without a busy retry.
                last_snapshot_attempt = now
                try:
                    await _publish_setpoint_snapshot(pool, ts, reason=publication_reason)
                except Exception as error:
                    shared.fail_setpoint_snapshot_publication()
                    log.error("setpoint_snapshot write error: %s", error)

        # Gap-log replay passes the controller finished sending (each quarter in its own transaction).
        if gap_replay.host.pending:
            try:
                await gap_replay.host.write_pending(pool)
            except Exception as e:
                log.error("gap replay write error: %s", e)

        # Equipment events (flush immediately)
        try:
            if equipment_source_pool is None:
                await write_legacy_equipment_events(pool)
            else:
                await write_equipment_events(equipment_source_pool, ts)
        except Exception as e:
            log.error(f"equipment_state write error: {e}")

        # Streams outside the receipt function's list (Q-09 grow-light intent)
        # use the ordinary view in both writer modes.
        if state.pending_ordinary_equipment:
            try:
                await write_ordinary_equipment_events(pool)
            except Exception as e:
                log.error("ordinary equipment_state write error: %s", e)

        # Raw device counters (flush immediately). These are source evidence,
        # not a derived daily summary; database errors retain the exact UUIDs
        # for a safe whole-batch retry.
        if equipment_source_pool is not None and state.pending_counter_samples:
            try:
                await write_equipment_counter_samples(equipment_source_pool)
            except Exception as e:
                log.error("equipment counter source write error: %s", type(e).__name__)

        # State transitions (flush immediately)
        if state.pending_states:
            try:
                changed_entities = await write_state_transitions(pool, ts)
                if changed_entities & CLIMATE_ACTION_LOG_ENTITIES and last_climate_action_log != now:
                    if await write_climate_action_log(pool, ts):
                        last_climate_action_log = now
            except Exception as e:
                log.error(f"system_state write error: {e}")

        # OBS-1e override events (Sprint 16) — flush immediately
        if state.pending_override_events:
            try:
                await write_override_events(pool, ts)
            except Exception as e:
                log.error(f"override_events write error: {e}")

        # Setpoint changes (flush immediately)
        if state.pending_setpoints:
            try:
                await write_setpoint_changes(pool, ts)
            except Exception as e:
                log.error(f"setpoint_changes write error: {e}")

        # ESP32 logs (flush every 10s)
        if state.pending_logs:
            try:
                await write_esp32_logs(pool)
            except Exception as e:
                log.error(f"esp32_logs write error: {e}")

        # Daily summary: snapshot the firmware day counters at 23:58 local, the last minute they still
        # hold the whole local day (they reset at local midnight). The container clock is UTC: a naive
        # datetime.now() fired this at 17:05 MST and stamped the next day's row.
        now_mt = datetime.now(COUNTER_SOURCE_TIMEZONE)
        if now_mt.hour == 23 and now_mt.minute == 58:
            try:
                await write_daily_summary(pool)
            except Exception as e:
                log.error(f"daily_summary write error: {e}")


# ──────────────────────────────────────────────────────────────
# ESP32 connection loop
# ──────────────────────────────────────────────────────────────
async def esp32_loop(pool: asyncpg.Pool = None) -> None:
    """Connect to ESP32 and subscribe to all entity states.

    aioesphomeapi owns transport liveness: native PingRequest deadlines and
    socket errors invoke on_stop. Any valid protobuf satisfies its keepalive.
    The writer lease is independently checked every two seconds.

    On disconnect, logs the gap duration and reconnects automatically.
    """
    last_disconnected_at: datetime | None = None
    # M6 / B11: in-process disconnects set last_disconnected_at, but a restart of
    # the ingestor PROCESS itself (systemd bounce, crash, deploy) loses that state
    # — the very first connect of a new process has last_disconnected_at=None, so
    # the gap between the last telemetry row written before the restart and the
    # first row after was silently NOT recorded as a data_gap (the under-report
    # bug). We detect the first connect of this process and reconstruct the gap
    # from the last persisted telemetry timestamp in the DB.
    first_connect = True

    while True:
        # HA-3.2 FENCE (#240): acquire the writer Lease BEFORE opening the ESP32
        # connection. A standby pod blocks here until the active holder stops
        # renewing for >= leaseDurationSeconds (15s) — so the two pods' device
        # connections never overlap. No-op (returns immediately) when the fence
        # is disabled/pre-arm. We poll in a bounded loop so a never-acquiring
        # standby still logs progress rather than blocking silently forever.
        if _writer_lease is not None and _writer_lease.enabled:
            while not await _writer_lease.acquire(timeout=30):
                log.info("Writer lease held by another writer — standing by (will not connect ESP32)")

        log.info(f"Connecting to ESP32 at {ESP32_HOST}:{ESP32_PORT}...")
        client = APIClient(
            address=ESP32_HOST,
            port=ESP32_PORT,
            password="",
            noise_psk=ESP32_API_KEY,
            # The gap log takes this connection for the recorder by its name (firmware/lib/gap_log.h
            # is_recorder_client); repository tools announce "verdify-tool" and are never the recorder.
            client_info="verdify-ingestor",
        )

        # Event that fires when native transport liveness fails (on_stop callback)
        connection_lost = asyncio.Event()
        disconnected_at: datetime | None = None
        connection_generation: int | None = None
        pending_gap: tuple[datetime, datetime, str] | None = None

        async def on_stop(expected_disconnect: bool) -> None:
            """Called by aioesphomeapi when connection drops."""
            nonlocal disconnected_at
            disconnected_at = datetime.now(UTC)
            _mark_equipment_source_gap("transport_connection_stopped")
            if expected_disconnect:
                log.info("ESP32 disconnected (expected)")
            else:
                log.warning("ESP32 connection lost (unexpected)")
            connection_lost.set()

        try:
            await client.connect(on_stop=on_stop, login=True)
            if connection_lost.is_set():
                raise APIConnectionError("ESP32 connection stopped before connect returned")
            connected_at = datetime.now(UTC)

            # Log reconnect gap and backfill if applicable. Use the actual
            # disconnect timestamp, not the previous connect timestamp, so
            # data_gaps represents missing telemetry rather than uptime.
            if last_disconnected_at:
                gap = (connected_at - last_disconnected_at).total_seconds()
                log.info(f"Connected to ESP32 (gap: {gap:.0f}s since disconnect)")
                if gap > 120:  # >2 min gap — record and backfill
                    pending_gap = (last_disconnected_at, connected_at, "ingestor_restart")
            elif first_connect:
                # M6 / B11: first connect of this process. last_disconnected_at is
                # None not because there was no gap, but because the prior
                # disconnect happened in a previous process (restart). Reconstruct
                # the restart gap from the last persisted telemetry timestamp so it
                # is no longer under-reported.
                try:
                    last_telemetry_ts = await _last_telemetry_ts(pool)
                except Exception as e:
                    last_telemetry_ts = None
                    log.error(f"Restart-gap lookup failed: {e}")
                if last_telemetry_ts is not None:
                    gap = (connected_at - last_telemetry_ts).total_seconds()
                    if gap > 120:
                        log.info(f"Connected to ESP32 (restart gap: {gap:.0f}s since last telemetry)")
                        pending_gap = (last_telemetry_ts, connected_at, "ingestor_process_restart")
                    else:
                        log.info("Connected to ESP32")
                else:
                    log.info("Connected to ESP32 (no prior telemetry; first run)")
            else:
                log.info("Connected to ESP32")
            if not first_connect:
                shared.esp32_reconnects += 1
            last_disconnected_at = None
            first_connect = False

            # Enumerate entities to build key→object_id map
            entities, services = await client.list_entities_services()
            if connection_lost.is_set():
                raise APIConnectionError("ESP32 connection stopped during entity enumeration")
            state.key_to_object_id.clear()
            state.key_to_type.clear()
            for e in entities:
                obj_id = e.object_id
                key = e.key
                state.key_to_object_id[key] = obj_id
                if isinstance(e, SensorInfo):
                    state.key_to_type[key] = "sensor"
                elif isinstance(e, BinarySensorInfo):
                    state.key_to_type[key] = "binary"
                elif isinstance(e, TextSensorInfo):
                    state.key_to_type[key] = "text"
                elif isinstance(e, NumberInfo):
                    state.key_to_type[key] = "number"
                elif isinstance(e, SwitchInfo):
                    state.key_to_type[key] = "switch"

            log.info(f"Enumerated {len(entities)} entities")

            # Share client reference for dispatcher push (U2)
            shared.esp32["client"] = client
            shared.esp32["keys"] = {obj_id: key for key, obj_id in state.key_to_object_id.items()}
            log.info("ESP32 client shared: %d entity keys for direct push", len(shared.esp32["keys"]))

            # firmware-v2 anchors-mode: cache the device's user-services so the
            # dispatcher can sync band/zone anchors via the set_band_anchor API
            # service (push_to_esp32 "service" etype). object_id == param name.
            shared.esp32["services"] = {s.name: s for s in (services or [])}
            log.info(
                "ESP32 client shared: %d user service(s): %s",
                len(shared.esp32["services"]),
                ", ".join(sorted(shared.esp32["services"])) or "none",
            )

            # Advance the transport generation exactly once for this successful
            # API connect. Reconciliation remains blocked until the native API
            # replays every writable field enumerated on this socket.
            # This prevents a replacement writer from comparing desired state
            # against the preceding generation's in-memory cache.
            import time as _time_mod

            expected_cfg_readbacks = frozenset(
                readback_param
                for entity in entities
                if (readback_param := SETPOINT_MAP.get(entity.object_id) or CFG_READBACK_MAP.get(entity.object_id))
                in _RECONCILABLE_CFG_PARAMS
            )
            connection_generation = shared.note_transport_connected(expected_cfg_readbacks)
            state.fixed_panel_native.mark_connected(connection_generation, datetime.now(UTC))
            state.cfg_readback.clear()
            # The grow-light states repeat after the firmware start, not up to 10 minutes later (#1662 review m2).
            _light_state_stored_at.clear()
            shared.esp32_connected_at = _time_mod.time()
            log.info(
                "writer_reconcile reason=transport_reconnect generation=%d "
                "action=awaiting_readbacks expected_readback_count=%d",
                connection_generation,
                len(expected_cfg_readbacks),
            )
            if pool is not None:
                # VD-64: whether this connection has the irrigation engine, as one irr_engine row on every
                # connect; the services read it to choose the L01 bridge, also after a firmware rollback.
                # Only after the generation advance above: nothing may await between sharing the new client
                # and that advance, or a task would write to it against the old generation's readbacks.
                try:
                    await asyncio.wait_for(record_engine_capability(pool, shared.esp32["services"]), timeout=10)
                except Exception as e:
                    log.warning("irr_engine capability row not written: %s", type(e).__name__)
                try:
                    await refresh_latest_occupancy_state(pool, "esp32_reconnect")
                except Exception as e:
                    log.warning("Occupancy reconnect refresh failed: %s", e)

            tracked = sum(
                1
                for obj_id in state.key_to_object_id.values()
                if obj_id in CLIMATE_MAP
                or obj_id in ESPHOME_FEEDBACK_MAP
                or obj_id in EQUIPMENT_BINARY_MAP
                or obj_id in EQUIPMENT_SWITCH_MAP
                or obj_id in STATE_MAP
                or obj_id in SETPOINT_MAP
                or obj_id in DIAGNOSTIC_MAP
                or obj_id in DAILY_ACCUM_MAP
                or obj_id in CFG_READBACK_MAP
            )
            log.info(f"Tracking {tracked} entities across all maps (incl {len(CFG_READBACK_MAP)} cfg readback)")

            # Fence the callback itself. A late callback from an old client
            # must never be relabeled with the new transport generation.
            def on_generation_state(entity_state) -> None:
                if (
                    shared.transport_generation != connection_generation
                    or shared.esp32.get("client") is not client
                    or shared.esp32.get("state_subscription_client") is not client
                    or shared.esp32.get("state_subscription_generation") != connection_generation
                ):
                    return
                on_state_change(entity_state, native_generation=connection_generation)

            shared.esp32["state_subscription_client"] = client
            shared.esp32["state_subscription_generation"] = connection_generation
            client.subscribe_states(on_generation_state)

            # A gap is only a complete snapshot after this connection has an
            # enumerated entity map and its own fresh, fenced state burst.
            if pending_gap is not None:
                try:
                    await backfill_gap(
                        pool,
                        *pending_gap,
                        client=client,
                        generation=connection_generation,
                        connection_lost=connection_lost,
                        observe_initial_subscription=True,
                    )
                except Exception as e:
                    log.error("Gap backfill failed: %s", e)
                finally:
                    pending_gap = None

            # Keep ESP32 log streaming opt-in. Heap pressure is covered by
            # binary sensors and diagnostics; a live API log stream costs heap.
            if ESP32_LOG_LEVEL != LogLevel.LOG_LEVEL_NONE:
                client.subscribe_logs(
                    _generation_log_callback(client, connection_generation), log_level=ESP32_LOG_LEVEL
                )
                log.info("Subscribed to ESP32 logs (%s+)", ESP32_LOG_LEVEL_NAME)
            else:
                log.info("ESP32 log subscription disabled")

            # Immediate setpoint re-push after reconnect (don't wait for 300s cycle)
            try:
                from tasks import setpoint_dispatcher

                await asyncio.sleep(2)
                if shared.setpoint_dispatch_lock.locked():
                    log.info(
                        "Post-reconnect setpoint dispatch queued; dispatcher already running for generation %d",
                        shared.transport_generation,
                    )
                else:
                    async with shared.setpoint_dispatch_lock:
                        shared.setpoint_dispatch_in_progress = True
                        try:
                            await setpoint_dispatcher(pool)
                        finally:
                            shared.setpoint_dispatch_in_progress = False
                    log.info("Post-reconnect setpoint dispatch complete")
            except Exception as e:
                log.error(f"Post-reconnect dispatch failed: {e}")

            # Native aioesphomeapi keepalive detects silent TCP death and invokes
            # on_stop; sensor callbacks also prove transport liveness. A separate
            # DeviceInfo RPC timeout is not evidence of a dead connection and can
            # disconnect a live stream. Keep lease loss independent and bounded
            # to two seconds, inside the 15s lease window.
            fenced = _writer_lease is not None and _writer_lease.enabled
            liveness_wait = 2.0 if fenced else 60.0
            while not connection_lost.is_set():
                # FENCE check FIRST: if we no longer hold the lease, self-fence
                # immediately (disconnect + stop pushing). Telemetry-read could
                # in principle continue, but the safe, simple action is a full
                # disconnect-and-reacquire — the standby has already taken over.
                if fenced and not _writer_lease.is_held():
                    log.warning("Writer lease LOST — SELF-FENCING: disconnecting ESP32 immediately")
                    if disconnected_at is None:
                        disconnected_at = datetime.now(UTC)
                    connection_lost.set()
                    break
                try:
                    # Wait up to liveness_wait — if connection_lost fires, break.
                    await asyncio.wait_for(connection_lost.wait(), timeout=liveness_wait)
                    break
                except TimeoutError:
                    # The timeout only schedules the next lease check. Native
                    # transport failure wakes the Event immediately via on_stop.
                    continue

            log.warning("Connection lost — will reconnect")
            _mark_equipment_source_gap("transport_connection_lost")
            state.fixed_panel_native.mark_disconnected(datetime.now(UTC))
            last_disconnected_at = disconnected_at or datetime.now(UTC)
            shared.esp32["client"] = None
            shared.esp32["state_subscription_client"] = None
            shared.esp32["state_subscription_generation"] = None

        except APIConnectionError as e:
            log.warning(f"ESP32 connection error: {e}. Reconnecting in 30s...")
            if last_disconnected_at is None:
                last_disconnected_at = datetime.now(UTC)
            await asyncio.sleep(30)
        except Exception as e:
            log.error(f"Unexpected error: {e}. Reconnecting in 30s...")
            if last_disconnected_at is None:
                last_disconnected_at = datetime.now(UTC)
            await asyncio.sleep(30)
        finally:
            if pending_gap is not None:
                # Enumeration/subscription failed before a current-state read.
                # Keep the detected outage visible without claiming a snapshot.
                connection_lost.set()
                try:
                    await backfill_gap(
                        pool,
                        *pending_gap,
                        client=client,
                        generation=connection_generation or 0,
                        connection_lost=connection_lost,
                    )
                except Exception as e:
                    log.error("Incomplete gap record failed: %s", e)
            if shared.esp32.get("state_subscription_client") is client:
                shared.esp32["state_subscription_client"] = None
                shared.esp32["state_subscription_generation"] = None
            if shared.esp32.get("client") is client:
                shared.esp32["client"] = None
            try:
                await client.disconnect()
            except Exception:
                pass


# ──────────────────────────────────────────────────────────────
# Task loop — periodic background tasks (replaces 10 cron jobs)
# ──────────────────────────────────────────────────────────────
_FORCED_TASK_RETRY_MIN_S = 30.0


async def _run_periodic_task(
    pool: asyncpg.Pool,
    name: str,
    coro_fn,
    timeout_s: float,
) -> None:
    """Run one named task without blocking the scheduler or another cadence."""
    try:
        if name == "setpoint_dispatch":
            async with shared.setpoint_dispatch_lock:
                shared.setpoint_dispatch_in_progress = True
                try:
                    await asyncio.wait_for(coro_fn(pool), timeout=timeout_s)
                finally:
                    shared.setpoint_dispatch_in_progress = False
        else:
            await asyncio.wait_for(coro_fn(pool), timeout=timeout_s)
    except TimeoutError:
        log.error("Task %s timed out (%ss)", name, timeout_s)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        log.error("Task %s failed: %s", name, e)


# vp#1547 (D-333): process-local liveness. The scheduler loop below touches this file every
# pass (about 1 s); the liveness probe checks only its age, so a wedged event loop restarts
# the writer while a database or climate outage does not. /tmp is the container's emptyDir.
LOOP_HEARTBEAT_FILE = os.environ.get("INGESTOR_LOOP_HEARTBEAT_FILE", "/tmp/verdify-ingestor-loop-heartbeat")


def touch_loop_heartbeat(path: str | None = None) -> bool:
    """Mark that the event loop made progress; False if the file could not be written."""
    target = LOOP_HEARTBEAT_FILE if path is None else path
    if not target:
        return False
    try:
        with open(target, "a"):
            pass
        os.utime(target, None)
        return True
    except OSError:
        return False


async def _writer_failure_monitor() -> None:
    """Turn a fail-closed writer lifecycle fault into a supervised restart."""
    await shared.writer_fatal_event.wait()
    raise RuntimeError(f"fatal device-writer state: {shared.writer_fatal_reason or 'unknown'}")


def _launch_due_tasks(
    pool: asyncpg.Pool,
    tasks,
    last_run: dict[str, float],
    running: dict[str, asyncio.Task[None]],
    now: float,
    task_timeouts: dict[str, float],
    force_names: set[str] | None = None,
) -> list[str]:
    """Launch due tasks concurrently and return their names for deterministic tests."""
    forced = force_names or set()
    for name, task in list(running.items()):
        if task.done():
            running.pop(name, None)

    started: list[str] = []
    for name, interval, coro_fn in tasks:
        forced_due = name in forced and (last_run[name] == 0.0 or now - last_run[name] >= _FORCED_TASK_RETRY_MIN_S)
        due = forced_due or now - last_run[name] >= interval
        if not due or name in running:
            continue
        if name == "setpoint_dispatch" and shared.setpoint_dispatch_lock.locked():
            log.info("Task setpoint_dispatch queued; dispatcher already running")
            continue
        last_run[name] = now
        running[name] = asyncio.create_task(
            _run_periodic_task(pool, name, coro_fn, task_timeouts.get(name, 120)),
            name=f"verdify-periodic-{name}",
        )
        started.append(name)
    return started


async def task_loop(pool: asyncpg.Pool) -> None:
    """Run periodic tasks concurrently so writer pacing cannot starve them."""
    task_timeouts = {
        # Reconnect reconciles can push 25+ values through heap-safe ESPHome
        # pacing, which intentionally exceeds the generic 120s watchdog.
        "setpoint_dispatch": 300,
        # Two full local days of daily_summary refresh; 600s stays well inside
        # the 1800s interval (the 2026-07-11 120s timeouts were the retired
        # graded per-reading loop, #1623).
        "daily_summary_live": 600,
        # The review's context reads and up to two 30 s Hermes POSTs, plus the run-status polls.
        "daily_review": 180,
        # VD-42: above push_policy_transaction's 120 s budget, so a timeout never cancels a program push between
        # irr_program_begin and irr_program_commit.
        "irrigation_sync": 150,
        # The hydro reader retries for up to 240 s inside its 300 s cadence (tasks/hydro.py).
        "hydro_probe_sync": 270,
    }
    TASKS = [
        # (name, interval_seconds, coroutine_factory)
        # VD-54 (Q-01): one system_state row every 60 s whether or not the ESP32
        # session is up, so the dashboard tells a dead ingestor from a
        # controller that stopped reporting.
        ("ingestor_heartbeat", 60, ingestor_heartbeat),
        ("water_flowing", 60, water_flowing_sync),
        ("water_meter_materialize", 60, water_meter_materialize),
        ("matview_refresh", 300, matview_refresh),
        ("shelly_sync", 300, shelly_sync),
        ("ha_sensor_sync", 300, ha_sensor_sync),
        # VD-70: read-only YINMIK hydro meter over Tuya local TCP 6668; idle until
        # the optional verdify-hydro-probe Secret is mounted.
        ("hydro_probe_sync", 300, hydro_probe_sync),
        ("alert_monitor", 300, alert_monitor),
        # #297: unavailable until measured saturation targets and alert adapter exist.
        ("soil_saturation_status", 3600, saturation_evaluation_status),
        # Daily RAG-snapshot refresh: re-materialize the vault/docs corpus into
        # site_content so Iris retrieval doesn't silently drift stale (#43).
        # Read/embed side only — no device path. 86400s = daily cadence.
        ("site_content_refresh", 86400, site_content_refresh),
        ("setpoint_dispatch", 300, setpoint_dispatcher),
        ("setpoint_confirmation", 300, setpoint_confirmation_monitor),
        # VD-42 (irrigation §6.1): commands every 5 s, which bounds their latency. NOTIFY irrigation_changed sets a
        # flag the pass reads itself: a forced launch could come only once per 30 s (_FORCED_TASK_RETRY_MIN_S).
        ("irrigation_sync", 5, irrigation_sync),
        ("forecast_sync", 3600, forecast_sync),
        ("daily_summary_live", 1800, daily_summary_live),
        ("grow_light_daily", 86400, grow_light_daily),
        # Climate refactor 5.1: the daily review (and the manual one MCP review_run requests) and the MCP probe.
        ("daily_review", 60, daily_review),
    ]
    last_run: dict[str, float] = {name: 0.0 for name, _, _ in TASKS}
    running: dict[str, asyncio.Task[None]] = {}

    # Stagger startup: wait 30s for ESP32 connection to establish first
    touch_loop_heartbeat()
    await asyncio.sleep(30)
    log.info("Task loop started: %d tasks registered", len(TASKS))

    try:
        while True:
            await asyncio.sleep(1)
            touch_loop_heartbeat()
            now = asyncio.get_running_loop().time()
            # Ordinary dispatch reads no approval file (VD-62).
            forced = {"setpoint_dispatch"} if shared.setpoint_dispatch_requested.is_set() else set()
            started = _launch_due_tasks(pool, TASKS, last_run, running, now, task_timeouts, forced)
            if started:
                log.debug("Task scheduler launched: %s", ", ".join(started))
    finally:
        for task in running.values():
            task.cancel()
        if running:
            await asyncio.gather(*running.values(), return_exceptions=True)


# ──────────────────────────────────────────────────────────────
# MQTT fan-out SUBSCRIBE mode (#114) — dev/stage ingest FROM prod's bus
# ──────────────────────────────────────────────────────────────
# Parse-time guard: timestamps arrive as ISO-8601 strings over MQTT.
def _coerce_fanout_value(key: str, val: Any) -> Any:
    if key.endswith("ts") or key == "ts":
        if isinstance(val, str):
            return datetime.fromisoformat(val)
    return val


async def write_fanout_row(pool: asyncpg.Pool, table: str, greenhouse_id: str, row: dict[str, Any]) -> None:
    """Write one fan-out row into THIS env's DB (#114 subscribe mode).

    The publisher already validated + persisted the row in prod; here we mirror
    it into the local per-env DB with a generic column-driven INSERT (same shape
    as write_climate). greenhouse_id comes from the envelope, not the row, so the
    subscriber stamps it consistently. NEVER touches any device — subscribe mode
    carries no ESP32 client.
    """
    cols = [c for c in row if c != "greenhouse_id"]
    if not cols:
        return
    values = [_coerce_fanout_value(c, row[c]) for c in cols]
    # All five fan-out tables carry greenhouse_id (migration 075). Stamp it.
    all_cols = [*cols, "greenhouse_id"]
    all_values = [*values, greenhouse_id]
    cols_sql = ", ".join(all_cols)
    placeholders = ", ".join(f"${i + 1}" for i in range(len(all_values)))
    async with pool.acquire() as conn:
        await conn.execute(
            f"INSERT INTO {table} ({cols_sql}) VALUES ({placeholders})",
            *all_values,
        )
    log.debug("fan-out subscribe: wrote %s row (%d cols) ghid=%s", table, len(cols), greenhouse_id)


async def mqtt_subscribe_loop(pool: asyncpg.Pool) -> None:
    """Subscribe to prod's fan-out bus and mirror rows into the local DB (#114).

    dev/stage only. No ESP32, no Home Assistant, no occupancy bridge — this is
    the entire ingest path for a subscriber env. Device writes are independently
    barred by the #79 gate (VERDIFY_DEVICE_WRITE_ENABLED), which dev/stage leave
    at 0; subscribe mode additionally carries no client capable of a write.
    """
    import paho.mqtt.client as paho_mqtt

    from config import (
        FANOUT_MQTT_HOST,
        FANOUT_MQTT_PASS,
        FANOUT_MQTT_PORT,
        FANOUT_MQTT_USER,
    )

    topic_filter = subscribe_topic_filter()
    event_loop = asyncio.get_event_loop()

    async def _persist(table: str, ghid: str, row: dict[str, Any]) -> None:
        try:
            await write_fanout_row(pool, table, ghid, row)
        except Exception as e:  # noqa: BLE001
            log.error("fan-out subscribe write failed (%s): %s", table, e)

    def on_connect(client, userdata, flags, rc):
        if rc == 0:
            client.subscribe(topic_filter, qos=0)
            log.info("fan-out subscribe: connected, subscribed to %s", topic_filter)
        else:
            log.error("fan-out subscribe: connect failed rc=%d", rc)

    def on_message(client, userdata, msg):
        try:
            table, ghid, row = decode_payload(msg.payload.decode(errors="replace"))
        except (ValueError, json.JSONDecodeError) as e:
            log.warning("fan-out subscribe: dropping malformed payload: %s", e)
            return
        asyncio.run_coroutine_threadsafe(_persist(table, ghid, row), event_loop)

    client = paho_mqtt.Client(client_id="verdify-fanout-sub")
    client.on_connect = on_connect
    client.on_message = on_message
    if FANOUT_MQTT_USER:
        client.username_pw_set(FANOUT_MQTT_USER, FANOUT_MQTT_PASS)

    while True:
        try:
            client.connect(FANOUT_MQTT_HOST, FANOUT_MQTT_PORT, 60)
            client.loop_start()
            log.info("fan-out subscribe: connected to %s:%d", FANOUT_MQTT_HOST, FANOUT_MQTT_PORT)
            while True:
                await asyncio.sleep(60)
                if not client.is_connected():
                    log.warning("fan-out subscribe: disconnected — reconnecting")
                    client.reconnect()
        except Exception as e:  # noqa: BLE001
            log.error("fan-out subscribe: %s — retry in 30s", e)
            try:
                client.loop_stop()
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(30)


# ──────────────────────────────────────────────────────────────
# Wake listener (LISTEN/NOTIFY → wake the dispatcher and irrigation_sync)
# ──────────────────────────────────────────────────────────────
# #1656: the setpoint_changed handler that pushed a pending setpoint_changes row
# outside the dispatcher pass is retired (its last producer, the forecast engine,
# went with climate refactor 4.2). Every device write goes through the fenced
# dispatcher; this listener only wakes it.


async def setpoint_listener(pool: asyncpg.Pool) -> None:
    """Keep LISTEN alive across DB recovery without replacing the ESP32 client."""

    def _on_irrigation_notify(_conn, _pid, _channel, _payload):
        # VD-64: an irrigation write committed; wake irrigation_sync. The payload is empty by design.
        shared.irrigation_sync_requested.set()

    def _on_desired_state_changed(_conn, _pid, _channel, _payload):
        # VD-33: a wake only. The payload is always empty and never read, and
        # nothing is pushed here: the next normal, fenced dispatcher pass reads
        # v_desired_state_current itself, and irrigation_sync its site values.
        shared.setpoint_dispatch_requested.set()
        shared.irrigation_sync_requested.set()

    connected_once = False
    while True:
        conn = None
        disconnected = asyncio.Event()

        def _on_disconnect(_conn):
            disconnected.set()

        try:
            # LISTEN needs a dedicated connection, not a pooled connection.
            conn = await asyncpg.connect(DB_DSN, timeout=10)
            conn.add_termination_listener(_on_disconnect)
            await conn.add_listener("irrigation_changed", _on_irrigation_notify)
            await conn.add_listener("desired_state_changed", _on_desired_state_changed)
            if connected_once:
                # NOTIFY is not durable. Wake both tasks for any desired_state or
                # irrigation write the gap hid.
                shared.setpoint_dispatch_requested.set()
                shared.irrigation_sync_requested.set()
            connected_once = True
            log.info("Wake listener: LISTEN on irrigation_changed and desired_state_changed channels")
            if conn.is_closed():
                disconnected.set()
            await disconnected.wait()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("Wake listener unavailable: %s", type(exc).__name__)
        finally:
            if conn is not None:
                conn.remove_termination_listener(_on_disconnect)
                if not conn.is_closed():
                    try:
                        await conn.close(timeout=5)
                    except Exception as exc:
                        log.warning("Wake listener close failed: %s", type(exc).__name__)
        await asyncio.sleep(1)


# ──────────────────────────────────────────────────────────────
# Gap detection and backfill on reconnect
# ──────────────────────────────────────────────────────────────
async def _last_telemetry_ts(pool: asyncpg.Pool) -> datetime | None:
    """Most recent persisted telemetry timestamp (for restart-gap detection, M6).

    Uses the climate hypertable — the canonical 1/min telemetry stream. Returns
    None when the table is empty (genuine first-ever run, no gap to record).
    """
    async with pool.acquire() as conn:
        return await conn.fetchval("SELECT max(ts) FROM climate")


async def backfill_gap(
    pool: asyncpg.Pool,
    gap_start: datetime,
    gap_end: datetime,
    reason: str,
    *,
    client: APIClient,
    generation: int,
    connection_lost: asyncio.Event,
    observe_initial_subscription: bool = False,
) -> None:
    """Persist newly received relay states with an honest gap status.

    Startup observes its already-requested initial stream. This option is valid
    only directly after primary subscribe_states with no intervening await.
    Other callers retain explicit replay. Neither path reads old cached states.
    """
    duration = (gap_end - gap_start).total_seconds()
    expected: dict[int, str] = {}
    for key, obj_id in state.key_to_object_id.items():
        entity_type = state.key_to_type.get(key)
        if entity_type == "binary":
            equipment = EQUIPMENT_BINARY_MAP.get(obj_id)
        elif entity_type == "switch":
            equipment = EQUIPMENT_SWITCH_MAP.get(obj_id)
        else:
            equipment = None
        if equipment is not None:
            expected[key] = equipment

    def current_connection() -> bool:
        return bool(
            not connection_lost.is_set()
            and shared.transport_generation == generation
            and shared.esp32.get("client") is client
            and shared.esp32.get("state_subscription_client") is client
            and shared.esp32.get("state_subscription_generation") == generation
        )

    observed: dict[int, tuple[bool, datetime]] = {}
    invalid: set[int] = set()
    complete = asyncio.Event()
    burst_failed = False

    def on_fresh_state(entity_state) -> None:
        if not current_connection():
            return
        key = entity_state.key
        if key not in expected:
            return
        value = entity_state.state
        if type(value) is not bool or (key in observed and observed[key][0] != value):
            invalid.add(key)
            observed.pop(key, None)
        elif key not in invalid:
            observed.setdefault(key, (value, _equipment_source_now()))
        if invalid or set(observed) == set(expected):
            complete.set()

    if expected and current_connection():
        remove_callback = None
        try:
            if observe_initial_subscription:
                remove_callback = _observe_current_state_messages(client, on_fresh_state)
            else:
                remove_callback = _request_current_state_burst(client, on_fresh_state)
            await asyncio.wait_for(complete.wait(), timeout=20)
            # Accept buffered same-key responses before declaring one coherent burst.
            await asyncio.sleep(0.1)
        except Exception as e:
            burst_failed = True
            log.warning("Gap equipment state burst incomplete: %s", e)
        finally:
            if callable(remove_callback):
                remove_callback()

    fenced = current_connection()
    if not fenced:
        observed.clear()
    snapshot_complete = bool(
        fenced and expected and not burst_failed and not invalid and set(observed) == set(expected)
    )
    rows = [(observed_at, expected[key], value) for key, (value, observed_at) in observed.items()]
    for observed_at, equipment, value in rows:
        EquipmentStateEvent(ts=observed_at, equipment=equipment, state=value, greenhouse_id=GREENHOUSE_ID)

    status = "snapshot_taken" if snapshot_complete else "snapshot_incomplete"
    async with pool.acquire() as conn:
        async with conn.transaction():
            if rows:
                await conn.executemany(
                    "INSERT INTO v_runtime_equipment_state_write (ts, equipment, state) VALUES ($1, $2, $3)",
                    rows,
                )
            await conn.execute(
                "INSERT INTO data_gaps (start_ts, end_ts, duration_s, reason, backfill_status) "
                "VALUES ($1, $2, $3, $4, $5)",
                gap_start,
                gap_end,
                duration,
                reason,
                status,
            )

    log.info(
        "Gap backfill: %.0fs gap recorded, %d/%d equipment states persisted, status=%s",
        duration,
        len(rows),
        len(expected),
        status,
    )


async def reconcile_interrupted_device_writes(pool: asyncpg.Pool) -> int:
    """Terminalize queue states left behind by a prior process generation.

    The in-memory writer queue cannot survive a process restart.  Therefore any
    unconfirmed ``requested``/``queued``/``retrying`` row present before this
    process starts can no longer complete.  Mark it failed, not sent/confirmed
    and not "cancelled before send": a process can die in the unavoidable gap
    between an ESPHome API return and durable Postgres acknowledgement, so the
    physical outcome is unknown.  Already-``sent`` rows remain eligible for
    later cfg confirmation.
    """
    if shared.is_shadow_mode():
        return 0
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            UPDATE v_runtime_setpoint_changes_write
               SET delivery_status = 'failed',
                   expired_at = COALESCE(expired_at, now())
             WHERE confirmed_at IS NULL
               AND COALESCE(source, '') <> 'esp32'
               AND delivery_status IN ('requested', 'queued', 'retrying')
            RETURNING parameter
            """
        )
    if rows:
        log.warning(
            "writer_delivery phase=persisted status=failed reason=process_restart_outcome_unknown "
            "count=%d generation=%d",
            len(rows),
            shared.transport_generation,
        )
    return len(rows)


async def create_dedicated_mutation_pools() -> asyncpg.Pool | None:
    """Create the separately attested equipment-source pool only outside shadow mode.

    ``VERDIFY_SHADOW_MODE`` is the process-wide zero-database-write contract.
    The ordinary pool is protected by :func:`shared.wrap_pool_for_shadow`, but
    the equipment-source collector intentionally uses separate credentials and
    therefore cannot be made safe by that wrapper. Refuse to create its
    connection here so valid dedicated credentials can never re-enable a write
    path in a shadow process.
    """
    if shared.is_shadow_mode():
        log.warning("SHADOW_MODE active: the dedicated equipment-source pool is disabled")
        return None

    try:
        equipment_source_pool = await create_equipment_source_pool()
    except Exception as exc:
        equipment_source_pool = None
        log.error(
            "equipment source collector startup authority unresolved error=%s",
            type(exc).__name__,
        )
    return equipment_source_pool


# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
async def main() -> None:
    global ESP32_HOST, ESP32_PORT, ESP32_API_KEY, GREENHOUSE_ID, _fanout_publisher, _writer_lease

    # Fail loudly if both fan-out modes are set (publisher + subscriber in one
    # process would re-emit what it consumes — a self-feeding topic storm).
    assert_modes_consistent()

    pool = await asyncpg.create_pool(DB_DSN, min_size=2, max_size=10)
    try:
        await attest_ordinary_ingestor_runtime_role(pool)
    except Exception:
        await pool.close()
        raise
    # SHADOW_MODE: wrap the pool so every acquired connection suppresses write
    # SQL while still serving reads (freshness probe, config load). Default-off
    # returns the pool unchanged — zero behavior change to the live writer.
    pool = shared.wrap_pool_for_shadow(pool)
    log.info("DB connection pool ready")

    # ── #114: subscribe mode (dev/stage) — ingest FROM prod's fan-out bus ─────
    # NO ESP32 loop, NO Home Assistant, NO occupancy bridge, NO setpoint listener.
    # The only ingest path is the fan-out subscriber writing into THIS env's DB.
    if subscribe_mode_enabled():
        log.info(
            "Verdify ingestor starting in MQTT-SUBSCRIBE mode (greenhouse: %s) — "
            "read-only telemetry mirror, no device/HA loops",
            GREENHOUSE_ID,
        )
        await asyncio.gather(
            mqtt_subscribe_loop(pool),
        )
        return

    if _observation_spool_enabled():
        _get_observation_spool()
        async with pool.acquire() as conn:
            if not await conn.fetchval(
                "SELECT to_regprocedure('public.fn_record_observational_source_event(uuid,text,timestamptz,text,uuid,bigint,jsonb)') IS NOT NULL"
            ):
                raise RuntimeError("observational spool requires migration 267 before device startup")
    if _climate_event_spool_enabled():
        _get_climate_event_spool()
        async with pool.acquire() as conn:
            if not await conn.fetchval(
                "SELECT to_regprocedure('public.fn_record_climate_source_event(uuid,timestamptz,text,uuid,bigint,jsonb,jsonb)') IS NOT NULL"
            ):
                raise RuntimeError("climate event spool requires migration 265 before device startup")
    equipment_source_pool = await create_dedicated_mutation_pools()
    if os.environ.get("VERDIFY_SOURCE_SPOOL_ENABLED") == "1" and equipment_source_pool is None:
        raise RuntimeError("durable equipment source spool requires its dedicated collector login")
    if equipment_source_pool is not None:
        _restore_source_spool()

    # ── Capture mode (prod, and the legacy VM single-writer) ──────────────────
    log.info("Verdify ingestor starting (greenhouse: %s)...", GREENHOUSE_ID)
    await reconcile_interrupted_device_writes(pool)

    # #113: prod-only publish-all. Set up the bus publisher; the flush path
    # re-emits every flushed row. Best-effort connect — a bus outage must never
    # block telemetry capture, so a failed connect leaves _fanout_publisher None
    # and the loop proceeds DB-only.
    if publish_all_enabled():
        from config import (
            FANOUT_MQTT_HOST,
            FANOUT_MQTT_PASS,
            FANOUT_MQTT_PORT,
            FANOUT_MQTT_USER,
        )

        pub = FanoutPublisher(
            FANOUT_MQTT_HOST,
            FANOUT_MQTT_PORT,
            user=FANOUT_MQTT_USER,
            password=FANOUT_MQTT_PASS,
        )
        try:
            pub.connect()
            _fanout_publisher = pub
            log.info("Fan-out publish-all ENABLED (#113) — re-emitting flushed rows to the bus")
        except Exception as e:  # noqa: BLE001
            log.error("Fan-out publisher connect failed: %s — continuing DB-only", e)
            _fanout_publisher = None

    # Load ESP32 config from greenhouses table (overrides .env)
    try:
        async with pool.acquire() as conn:
            gh = await conn.fetchrow(
                "SELECT esp32_host, esp32_port, esp32_api_key FROM greenhouses WHERE id = $1", GREENHOUSE_ID
            )
            if gh and gh["esp32_host"]:
                ESP32_HOST = gh["esp32_host"]
                ESP32_PORT = gh["esp32_port"] or 6053
                if gh["esp32_api_key"]:
                    ESP32_API_KEY = gh["esp32_api_key"]
                log.info("ESP32 config loaded from DB: %s:%d", ESP32_HOST, ESP32_PORT)
            else:
                log.info("ESP32 config from .env fallback: %s:%d", ESP32_HOST, ESP32_PORT)
    except Exception as e:
        log.warning("Could not load greenhouse config from DB: %s (using .env)", e)

    # HA-3.2 single-writer FENCE (#240). Construct the renew-or-die WriterLease
    # and publish it to shared so the push path (esp32_push.push_to_esp32) and
    # esp32_loop both gate on it. INERT unless VERDIFY_WRITER_LEASE_ENABLED is
    # set — until armed, is_held() always returns True and behaviour is identical
    # to the pre-fence ingestor. start() spawns the background renew loop (no-op
    # when disabled/off-cluster).
    _writer_lease = WriterLease()
    shared.writer_lease = _writer_lease
    await _writer_lease.start()

    # SIGTERM handler: on graceful eviction / drain / rollout, RELEASE the lease
    # (clears holderIdentity so a replacement acquires in seconds, not 15s) and
    # let the process exit. This turns a planned-disruption zero-writer gap from
    # ~15s into seconds. SIGTERM during a Recreate rollout: the old pod releases,
    # the new pod (already blocked in esp32_loop.acquire) takes over immediately.
    loop = asyncio.get_running_loop()
    _shutdown = asyncio.Event()

    async def _on_sigterm() -> None:
        # Do not release the cross-pod lease while a setter may still be
        # awaiting its acknowledgement. The shutdown branch cancels and joins
        # all writer tasks first, then releases for the replacement.
        log.warning("SIGTERM received — stopping writer tasks before lease release")
        _shutdown.set()

    try:
        import signal as _signal

        loop.add_signal_handler(_signal.SIGTERM, lambda: asyncio.create_task(_on_sigterm()))
        loop.add_signal_handler(_signal.SIGINT, lambda: asyncio.create_task(_on_sigterm()))
    except (NotImplementedError, RuntimeError):
        # add_signal_handler unsupported (e.g. non-main thread / Windows) — the
        # lease still expires within leaseDurationSeconds, so correctness holds;
        # only the fast graceful-release optimization is unavailable.
        log.info("Signal handlers unavailable; lease will expire on hard stop")

    main_tasks = asyncio.gather(
        esp32_loop(pool),
        flush_loop(pool, equipment_source_pool),
        task_loop(pool),
        setpoint_listener(pool),
        _writer_failure_monitor(),
        # #1370: Frigate person sightings over MQTT feed the occupancy latch in
        # real time (the 300 s Home Assistant poll stays the fallback), and the
        # controller's occupancy light changes get their activity rows.
        occupancy_mqtt_loop(pool),
        occupancy_light_activity_loop(pool),
    )

    # Race the worker gather against the shutdown signal so SIGTERM unwinds
    # promptly (releasing the lease) instead of waiting on the never-returning
    # loops. On shutdown, cancel the workers and return.
    shutdown_wait = asyncio.ensure_future(_shutdown.wait())
    done, pending = await asyncio.wait({main_tasks, shutdown_wait}, return_when=asyncio.FIRST_COMPLETED)
    if _shutdown.is_set():
        main_tasks.cancel()
        try:
            await main_tasks
        except (asyncio.CancelledError, Exception):
            pass
        try:
            await _writer_lease.release()
        except Exception as e:  # noqa: BLE001
            log.warning("Lease release on SIGTERM failed: %s", e)
        if equipment_source_pool is not None:
            await equipment_source_pool.close()
        return
    # If the gather itself returned/raised, propagate (surfaces fatal errors).
    shutdown_wait.cancel()
    await main_tasks


if __name__ == "__main__":
    asyncio.run(main())
