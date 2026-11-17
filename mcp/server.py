#!/usr/bin/env python3
"""
Verdify MCP Server — Greenhouse control tools for Agent Iris.

Gives Iris direct access to greenhouse data, planner control,
and setpoint management through the standard MCP protocol.

Run: python mcp/server.py
Transport: streamable-http on port 8400
"""

import asyncio
import functools
import hmac
import ipaddress
import json
import logging
import os
import re
import stat
import sys
import time
import urllib.parse
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import asyncpg
from mcp.server.fastmcp import FastMCP
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError

# verdify_schemas lives one level up from this server file in every worktree.
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))
import verdify_schemas.embeddings as _embeddings  # noqa: E402
from verdify_schemas import (  # noqa: E402
    ALL_TUNABLES,
    AlertEnvelope,
    AlertResolvePayload,
    ClimateSnapshot,
    CropCreate,
    CropUpdate,
    EquipmentStateRow,
    EventCreate,
    ForecastSummaryRow,
    HarvestCreate,
    LessonCreate,
    LessonSummary,
    LessonSupersede,
    LessonUpdate,
    LessonValidate,
    ObservationCreate,
    OutcomeKpiActionRow,
    OutcomeKpiCoverage,
    OutcomeKpiResponse,
    ScorecardResponse,
    SetpointSummary,
    TreatmentCreate,
    derive_lesson_state,
    is_legal_lesson_transition,
)
from verdify_schemas.fixed_panel_native_route import read_native_fixed_panel_route_evidence  # noqa: E402
from verdify_schemas.irrigation import LineId, StartKind, Weekday  # noqa: E402
from verdify_schemas.realized_dryout import (  # noqa: E402
    RealizedDryoutEvidence,
    project_realized_solar_night_dryout,
    read_realized_dryout_evidence,
)
from verdify_schemas.route_only_crop_band_reader import read_route_only_crop_band_evidence  # noqa: E402
from verdify_schemas.telemetry import DliEvidence  # noqa: E402
from verdify_schemas.tunable_registry import (  # noqa: E402
    TIER1_REG,
)
from verdify_services import activity as activity_service  # noqa: E402
from verdify_services import alerts as alerts_service  # noqa: E402
from verdify_services import crops as crop_service  # noqa: E402
from verdify_services import reads as reads_service  # noqa: E402
from verdify_services import settings as settings_service  # noqa: E402
from verdify_services import soil as soil_service  # noqa: E402
from verdify_services.actor import Actor as ServiceActor  # noqa: E402
from verdify_services.problems import Problem, ServiceError, problem  # noqa: E402

# ── Config ──
# Read DB password from .env
_env_path = Path("/srv/verdify/.env")
_db_pass = "verdify"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        if line.startswith("POSTGRES_PASSWORD="):
            _db_pass = line.split("=", 1)[1].strip().strip('"').strip("'")
# #24: the MCP server is already DSN-native — it connects via asyncpg against
# DB_DSN, never `docker exec psql`. This IS the VERDIFY_DB_BACKEND=dsn path of
# the shared scripts/lib/psql-verdify.sh contract: setting DB_DSN to an
# in-cluster Postgres endpoint moves this service off the VM with no code change.
# Default below preserves the live VM connection (localhost:5432).
DB_DSN = os.environ.get("DB_DSN", f"postgresql://verdify:{_db_pass}@localhost:5432/verdify")
MCP_RUNTIME_DB_ROLE_REQUIRED_ENV = "VERDIFY_MCP_RUNTIME_DB_ROLE_REQUIRED"
MCP_RUNTIME_DB_LOGIN = "verdify_mcp_runtime_login"
_MCP_RUNTIME_DB_ATTESTATION_SQL = """
SELECT current_user = session_user
   AND current_user = 'verdify_mcp_runtime_login'
   AND pg_catalog.current_setting('search_path') =
       'pg_catalog, public, pg_temp'
   AND public.fn_mcp_runtime_attest_ordinary_login()
"""


def _mcp_runtime_db_role_required() -> bool:
    return os.environ.get(MCP_RUNTIME_DB_ROLE_REQUIRED_ENV, "").strip() == "1"


def _validate_mcp_runtime_dsn() -> None:
    if not _mcp_runtime_db_role_required():
        return
    try:
        dsn_user = urllib.parse.unquote(urllib.parse.urlsplit(DB_DSN).username or "")
        dsn_password = urllib.parse.urlsplit(DB_DSN).password
    except ValueError as exc:
        raise RuntimeError("MCP ordinary database DSN is malformed") from exc
    if (
        not hmac.compare_digest(dsn_user, MCP_RUNTIME_DB_LOGIN)
        or not hmac.compare_digest(os.environ.get("DB_USER", ""), MCP_RUNTIME_DB_LOGIN)
        or not dsn_password
        or not os.environ.get("DB_PASSWORD")
        or os.environ.get("POSTGRES_PASSWORD")
        or os.environ.get("DB_PASS")
    ):
        raise RuntimeError("MCP ordinary database login contract failed")


async def _attest_mcp_runtime_connection(conn: asyncpg.Connection) -> None:
    if _mcp_runtime_db_role_required() and await conn.fetchval(_MCP_RUNTIME_DB_ATTESTATION_SQL) is not True:
        raise RuntimeError("MCP ordinary database attestation failed")


_validate_mcp_runtime_dsn()
SITE_PUBLISH_TRIGGER_PATH = os.environ.get(
    "VERDIFY_SITE_PUBLISH_TRIGGER_PATH",
    "/var/local/verdify/state/plan-publish-trigger",
).strip()
MCP_DB_STATEMENT_TIMEOUT_MS = max(
    1000,
    int(os.environ.get("VERDIFY_MCP_DB_STATEMENT_TIMEOUT_MS", "15000")),
)
# The single-day action scorecard performs four historical setpoint lookups per
# decision. Keep its read bounded without widening every MCP query's DB budget.
KPI_ACTION_SCORECARD_TIMEOUT_MS = 30_000
# The planner writes no setting (climate refactor 4.2). PLAN_REQUIRED_PARAMS stays assigned because the public
# site's AI tunables generator parses it from this file (plan section 8.10).
PLAN_REQUIRED_PARAMS = TIER1_REG


def _json(obj):
    """JSON serialize with asyncpg/Decimal support."""
    import decimal

    def default(o):
        if isinstance(o, decimal.Decimal):
            return float(o)
        if isinstance(o, datetime | date):
            return o.isoformat()
        return str(o)

    return json.dumps(obj, default=default)


# ═══════════════════════════════════════════════════════════════
# SERVER-SIDE AUDIENCE AUTHORIZATION (#585, audit §8.8)
# ═══════════════════════════════════════════════════════════════
# Before this layer the ONLY boundary in front of the 27 registered tools was
# the NetworkPolicy ingress allowlist: the `Authorization: Bearer
# ${VERDIFY_MCP_TOKEN}` header Hermes already sends
# (deploy/k8s/components/hermes-iris/hermes-config.yaml) was never validated.
# The controlled planner experiment's treatment firewall requires
# audience-scoped tool enforcement IN the MCP layer, not just a client-side
# `tools.include` list.
#
# Modes (VERDIFY_MCP_AUTH_MODE):
#   off     — explicit development-only bypass; authorization is fully
#             disabled, byte-identical to the pre-#585 behavior.
#   log     — every would-be denial is emitted as one structured JSON log line
#             (never the token value) and the call proceeds. Prod runs this
#             first to prove the token registry before any blocking.
#   enforce — denials reject the tool call with a clear error. FAIL-CLOSED: a
#             missing or unknown bearer token denies every tool.
# Any unrecognized mode value is treated as "enforce" — a typo must fail
# closed, never silently disable authorization.
#
# Token registry (audience → bearer token) is env-driven, matching the flat
# VERDIFY_MCP_* env config style of this file:
#   VERDIFY_MCP_TOKEN_IRIS       — the current Hermes Iris profile credential
#                                  (same value hermes-config.yaml sends as
#                                  ${VERDIFY_MCP_TOKEN}).
#   VERDIFY_MCP_TOKEN_EXPERIMENT — the experiment-arm planner profile
#                                  (wired in Lane C/D tranche 2).
#   VERDIFY_MCP_TOKEN_ADMIN      — operator/debug credential; all tools.
#   VERDIFY_MCP_TOKEN_OBSERVER   — protocol-only availability probe; no tools.
# Tokens must be distinct per audience and valid RFC 6750 bearer credentials.
# Invalid and duplicate entries are excluded from the registry. Token values
# are never logged, never echoed in errors, and never surfaced by /readyz
# (environment-variable names only).
#
# Named agents (VD-59, architecture §5.6) are the fifth audience, `agent`. Their
# keys never come from the environment: each agent is one file in the mounted
# Secret verdify-mcp-agents (agent_key_registry below), so VERDIFY_MCP_TOKEN_AGENT
# stays an unrecognized variable and a nameless agent cannot exist.

VERDIFY_MCP_AUTH_MODE_ENV = "VERDIFY_MCP_AUTH_MODE"
VERDIFY_MCP_AUTH_MODES = ("off", "log", "enforce")
_AUDIENCE_TOKEN_ENV_PREFIX = "VERDIFY_MCP_TOKEN_"
AGENT_AUDIENCE = "agent"
KNOWN_AUDIENCES = frozenset({"iris", "experiment", "admin", "observer", AGENT_AUDIENCE})
# The environment-token parser keeps its four audiences.
_AUDIENCE_TOKEN_ENV_NAMES = {
    f"{_AUDIENCE_TOKEN_ENV_PREFIX}{audience.upper()}": audience for audience in KNOWN_AUDIENCES - {AGENT_AUDIENCE}
}
# RFC 6750 b64token. Besides empty/whitespace/control values, this rejects
# characters that cannot be represented as one unambiguous Bearer credential.
_BEARER_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9._~+/\-]+=*")

_TOOL_AUTH_LOGGER = logging.getLogger("verdify.mcp.auth")
_TOOL_AUDIT_LOGGER = logging.getLogger("verdify.mcp.audit")
_TOOL_AUDIT_LOGGER.setLevel(logging.INFO)
_MCP_PATH = "/mcp"


class ToolAccessDenied(Exception):
    """Raised in enforce mode; surfaces to the MCP client as a tool error."""


def auth_mode() -> str:
    """Resolve the authorization mode from the environment.

    Absent, empty, or unrecognized values fail CLOSED to ``enforce``. Only an
    explicit supported value can select the development ``off`` bypass.
    """
    raw = os.environ.get(VERDIFY_MCP_AUTH_MODE_ENV, "").strip().lower()
    if not raw:
        return "enforce"
    return raw if raw in VERDIFY_MCP_AUTH_MODES else "enforce"


def audience_token_configuration() -> tuple[dict[str, str], list[str], list[str], list[str]]:
    """Read and validate VERDIFY_MCP_TOKEN_<AUDIENCE> env vars.

    Returns (unambiguous audience → token, unrecognized env var NAMES,
    duplicate-token env var NAMES, invalid-token env var NAMES). Duplicate
    values remove every affected audience from the matchable registry, so an
    accidentally shared admin credential can never resolve by lexical
    ordering. Values never leave this function except in the validated
    registry and are never logged/readied.
    """
    candidates: dict[str, tuple[str, str]] = {}
    unrecognized: list[str] = []
    invalid: list[str] = []
    for key in sorted(os.environ):
        if not key.startswith(_AUDIENCE_TOKEN_ENV_PREFIX):
            continue
        audience = _AUDIENCE_TOKEN_ENV_NAMES.get(key)
        if audience is None:
            unrecognized.append(key)
            continue
        token = os.environ[key]
        if _BEARER_TOKEN_PATTERN.fullmatch(token) is None:
            invalid.append(key)
            continue
        candidates[audience] = (key, token)

    audiences_by_token: dict[str, list[str]] = {}
    for audience, (_key, token) in candidates.items():
        audiences_by_token.setdefault(token, []).append(audience)
    duplicate_audiences = {
        audience for audiences in audiences_by_token.values() if len(audiences) > 1 for audience in audiences
    }
    duplicate_env_names = sorted(candidates[audience][0] for audience in duplicate_audiences)
    registry = {
        audience: token for audience, (_key, token) in candidates.items() if audience not in duplicate_audiences
    }
    return registry, unrecognized, duplicate_env_names, invalid


def audience_token_registry() -> tuple[dict[str, str], list[str]]:
    """Compatibility view of only the unambiguous audience token registry."""
    registry, unrecognized, _duplicate_env_names, _invalid_token_env_names = audience_token_configuration()
    return registry, unrecognized


def resolve_token_audience(token: str | None, registry: dict[str, str]) -> str | None:
    """Map a presented bearer token to an audience, or None.

    hmac.compare_digest gives a constant-time comparison per candidate, and the
    loop always scans the full registry (no early exit) so response timing does
    not reveal which audience matched. ``audience_token_configuration`` removes
    duplicate values before this function can match them.
    """
    if not token:
        return None
    token_bytes = token.encode()
    matched: str | None = None
    for audience in sorted(registry):
        if hmac.compare_digest(token_bytes, registry[audience].encode()) and matched is None:
            matched = audience
    return matched


# ── Named agent keys (VD-59) ──
# Secret verdify-mcp-agents holds one key per named in-cluster agent: the key is
# the agent's name and its value the agent's bearer token. The Deployment mounts
# it read-only and optional, without subPath (a subPath mount never sees Secret
# updates), so the kubelet's atomic `..data` swap delivers every add, removal or
# rotation into the running pods. MCP re-reads the directory at most every
# AGENT_KEYS_REFRESH_SECONDS: no restart and no device-gated sync admits or cuts
# off one agent. Names and values are validated here; values never leave the
# returned registry.
VERDIFY_MCP_AGENT_KEYS_DIR_ENV = "VERDIFY_MCP_AGENT_KEYS_DIR"
DEFAULT_MCP_AGENT_KEYS_DIR = "/etc/verdify/mcp-agents"
AGENT_KEYS_REFRESH_SECONDS = 60.0
# The OpenAPI Actor source pattern (agent:<name>), capped at 63 characters.
_AGENT_NAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]{0,62}")
# `admin` is the environment admin credential's actor name (agent:admin).
_RESERVED_AGENT_NAMES = frozenset({"admin"})
_AGENT_KEY_MAX_BYTES = 4096
_AGENT_KEY_WHITESPACE = " \t\n\r\x0b\x0c"


@dataclass(frozen=True)
class _AgentKeyScan:
    directory: str
    loaded_at: float
    keys: dict[str, str]
    rejected: frozenset[str]


_agent_key_scan: _AgentKeyScan | None = None


def _agent_keys_clock() -> float:
    """The agent-key cache clock: time.monotonic(), a seam for the cache tests."""
    return time.monotonic()


def _read_agent_key(path: str) -> str | None:
    """One key file's token, or None when the file is not one bearer token.

    Raises FileNotFoundError for a name that vanished: between the kubelet's
    `..data` swap and its cleanup, a removed key's top-level link dangles.
    """
    info = os.stat(path)  # follows the kubelet's `<name> -> ..data/<name>` link
    if not stat.S_ISREG(info.st_mode) or info.st_size > _AGENT_KEY_MAX_BYTES:
        return None
    with open(path, "rb") as handle:
        raw = handle.read(_AGENT_KEY_MAX_BYTES + 1)
    if len(raw) > _AGENT_KEY_MAX_BYTES:
        return None
    try:
        token = raw.decode("ascii").strip(_AGENT_KEY_WHITESPACE)
    except UnicodeDecodeError:
        return None
    return token if _BEARER_TOKEN_PATTERN.fullmatch(token) else None


def _scan_agent_key_directory(directory: str) -> tuple[dict[str, str], set[str]]:
    """Read every agent key file in ``directory``; reject by name, never by value."""
    try:
        names = sorted(os.listdir(directory))
    except (FileNotFoundError, NotADirectoryError):
        return {}, set()  # no Secret mounted: no agents
    except OSError as exc:
        _TOOL_AUTH_LOGGER.warning(
            "%s", _json({"event": "mcp_agent_keys_unreadable", "error_class": type(exc).__name__})
        )
        return {}, set()
    tokens: dict[str, str] = {}
    rejected: set[str] = set()
    for name in names:
        if name.startswith("."):
            continue  # the kubelet's `..data` link and its timestamped payload directory
        if _AGENT_NAME_PATTERN.fullmatch(name) is None or name in _RESERVED_AGENT_NAMES:
            rejected.add(name)
            continue
        try:
            token = _read_agent_key(os.path.join(directory, name))
        except FileNotFoundError:
            continue  # removed mid-swap: absent, not rejected
        except OSError:
            token = None
        if token is None:
            rejected.add(name)
        else:
            tokens[name] = token
    names_by_token: dict[str, list[str]] = {}
    for name, token in tokens.items():
        names_by_token.setdefault(token, []).append(name)
    shared = {name for sharing in names_by_token.values() if len(sharing) > 1 for name in sharing}
    return {name: token for name, token in tokens.items() if name not in shared}, rejected | shared


def agent_key_registry() -> tuple[dict[str, str], list[str]]:
    """Named agent keys: (agent name → token, rejected agent names).

    Reads the directory in VERDIFY_MCP_AGENT_KEYS_DIR (default
    /etc/verdify/mcp-agents) and caches the scan for 60 s on time.monotonic(),
    so a key added to or removed from the mounted Secret is seen within a minute
    of its file changing. One file per agent: the file name is the agent name,
    the content its token with surrounding whitespace stripped; names starting
    with `.` are skipped and a missing or empty directory means no agents.

    Rejected by name only, never touching the environment audiences: names
    outside the Actor source pattern, the reserved name admin, a token that is
    not one RFC 6750 bearer credential, a token shared by two names (both
    dropped) and a token equal to an environment audience's token (the agent
    key dropped). Rejections never change readiness.
    """
    global _agent_key_scan
    directory = os.environ.get(VERDIFY_MCP_AGENT_KEYS_DIR_ENV, "").strip() or DEFAULT_MCP_AGENT_KEYS_DIR
    now = _agent_keys_clock()
    scan = _agent_key_scan
    if scan is None or scan.directory != directory or now - scan.loaded_at >= AGENT_KEYS_REFRESH_SECONDS:
        keys, scan_rejected = _scan_agent_key_directory(directory)
        scan = _AgentKeyScan(directory=directory, loaded_at=now, keys=keys, rejected=frozenset(scan_rejected))
        _agent_key_scan = scan
    environment_registry, _unrecognized, _duplicates, _invalid = audience_token_configuration()
    environment_tokens = [token.encode() for token in environment_registry.values()]
    registry: dict[str, str] = {}
    rejected = set(scan.rejected)
    for name, token in scan.keys.items():
        token_bytes = token.encode()
        collides = False
        for environment_token in environment_tokens:
            collides = hmac.compare_digest(token_bytes, environment_token) or collides
        if collides:
            rejected.add(name)
        else:
            registry[name] = token
    return registry, sorted(rejected)


def resolve_caller(token: str | None) -> tuple[str | None, str | None]:
    """Map a presented bearer token to (audience, agent name), or (None, None).

    The environment audiences resolve first through resolve_token_audience,
    then the named agent keys through the same full-scan hmac.compare_digest
    loop. Both registries are always scanned in full, so timing does not reveal
    which side (if any) matched; agent_key_registry() drops an agent key equal
    to an environment token, so at most one side can match. A removed key
    resolves to nothing once the cache refreshes, at the transport and at
    dispatch alike.
    """
    registry, _unrecognized, _duplicate_env_names, _invalid_token_env_names = audience_token_configuration()
    agents, _rejected = agent_key_registry()
    audience = resolve_token_audience(token, registry)
    agent_name = resolve_token_audience(token, agents)
    if audience is not None:
        return audience, None
    if agent_name is not None:
        return AGENT_AUDIENCE, agent_name
    return None, None


# ── Request actor (VD-59, architecture §5.6) ──
@dataclass(frozen=True)
class McpActor:
    """Who called: the R4 source string and the actor's name.

    iris → (iris, iris); a named agent → (agent:<name>, <name>); the admin
    credential → (agent:admin, admin). Writes build verdify_services.Actor
    (source, name, None) from it.
    """

    source: str
    name: str


_REQUEST_ACTOR: ContextVar[McpActor | None] = ContextVar("verdify_mcp_request_actor", default=None)


def request_actor(audience: str | None, agent_name: str | None = None) -> McpActor | None:
    """The actor a resolved caller writes as; None for experiment, observer or no caller."""
    if audience == "iris":
        return McpActor(source="iris", name="iris")
    if audience == AGENT_AUDIENCE and agent_name:
        return McpActor(source=f"agent:{agent_name}", name=agent_name)
    if audience == "admin":
        return McpActor(source="agent:admin", name="admin")
    return None


def current_actor() -> McpActor | None:
    """The in-flight tool call's actor, or None (auth mode off, or no resolved caller).

    The only way a tool learns who called: no tool argument sets a source, an
    actor or a *_by column. A write that records an actor refuses with
    `forbidden` when this is None.
    """
    return _REQUEST_ACTOR.get()


def _bearer_token_from_authorization(value: str | None) -> str | None:
    """Parse one Authorization header without ever retaining or logging it."""
    scheme, separator, credential = (value or "").partition(" ")
    if not separator or scheme.lower() != "bearer":
        return None
    return credential.strip() or None


def _transport_request_denial(token: str | None) -> dict[str, str | None] | None:
    """Return a transport-authentication denial, or None for a known caller."""
    _registry, _unrecognized, duplicate_env_names, _invalid_token_env_names = audience_token_configuration()
    if duplicate_env_names:
        return {"audience": None, "reason": "duplicate_token_configuration"}
    audience, _agent_name = resolve_caller(token)
    if audience is not None:
        return None
    return {
        "audience": None,
        "reason": "missing_token" if not token else "unknown_token",
    }


def _transport_bearer_token(scope) -> str | None:
    """Extract exactly one bearer credential from raw ASGI request headers."""
    authorization_values = [
        value.decode("latin-1") for name, value in scope.get("headers", []) if name.lower() == b"authorization"
    ]
    if len(authorization_values) != 1:
        return None
    return _bearer_token_from_authorization(authorization_values[0])


async def _send_transport_unauthorized(send) -> None:
    """Send a deliberately generic 401 without exposing token or inventory data."""
    body = b'{"error":"unauthorized"}'
    await send(
        {
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"www-authenticate", b"Bearer"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class MCPTransportAuthMiddleware:
    """Authenticate every MCP HTTP request before FastMCP creates a session.

    This is raw ASGI middleware rather than ``BaseHTTPMiddleware`` so streaming
    request/response channels are not buffered or replaced. The plain
    ``/readyz`` custom route intentionally stays public for Kubernetes probes.
    Per-tool audience authorization remains the second enforcement layer after
    a known audience reaches the protocol endpoint.
    """

    def __init__(self, app, *, mcp_path: str = _MCP_PATH) -> None:
        self.app = app
        self.mcp_path = mcp_path.rstrip("/") or "/"

    async def __call__(self, scope, receive, send) -> None:
        path = str(scope.get("path", "")).rstrip("/") or "/"
        if scope.get("type") != "http" or path != self.mcp_path:
            await self.app(scope, receive, send)
            return

        mode = auth_mode()
        if mode == "off":
            await self.app(scope, receive, send)
            return

        denial = _transport_request_denial(_transport_bearer_token(scope))
        if denial is None:
            await self.app(scope, receive, send)
            return

        enforced = mode == "enforce" or denial["reason"] == "duplicate_token_configuration"
        _TOOL_AUTH_LOGGER.warning(
            "%s",
            _json(
                {
                    "event": "mcp_transport_authn_denial",
                    "mode": mode,
                    "enforced": enforced,
                    **denial,
                }
            ),
        )
        if enforced:
            await _send_transport_unauthorized(send)
            return
        await self.app(scope, receive, send)


def _tool_call_denial(name: str, token: str | None, caller: tuple[str | None, str | None] | None = None) -> dict | None:
    """Return a denial record for this (tool, token), or None when allowed.

    ``caller`` is the token's resolve_caller() result when the dispatcher
    already holds it, so authorization and attribution share one resolution.
    """
    _registry, _unrecognized, duplicate_env_names, _invalid_token_env_names = audience_token_configuration()
    if duplicate_env_names:
        return {
            "tool": name,
            "audience": None,
            "reason": "duplicate_token_configuration",
        }
    audience, agent_name = resolve_caller(token) if caller is None else caller
    if audience is None:
        return {
            "tool": name,
            "audience": None,
            "reason": "missing_token" if not token else "unknown_token",
        }
    # A named agent's denial also names the agent (never its token).
    caller_fields = {"audience": audience, **({"agent": agent_name} if agent_name else {})}
    allowed_audiences = TOOL_AUDIENCES.get(name)
    if allowed_audiences is None:
        # A tool outside the inventory is never authorizable — the startup
        # assertion makes this unreachable in a correctly built image, but a
        # denial here keeps the layer fail-closed regardless.
        return {"tool": name, **caller_fields, "reason": "tool_not_in_audience_registry"}
    if audience not in allowed_audiences:
        return {"tool": name, **caller_fields, "reason": "tool_not_in_audience"}
    return None


def authorize_tool_call(name: str, token: str | None, caller: tuple[str | None, str | None] | None = None) -> None:
    """Gatekeeper for every tool dispatch. Raises ToolAccessDenied in enforce mode."""
    mode = auth_mode()
    if mode == "off":
        return
    denial = _tool_call_denial(name, token, caller)
    if denial is None:
        return
    # Structured, grep-able denial record. Contains audience/tool/reason —
    # NEVER the presented token.
    enforced = mode == "enforce" or denial["reason"] == "duplicate_token_configuration"
    _TOOL_AUTH_LOGGER.warning(
        "%s",
        _json({"event": "mcp_tool_authz_denial", "mode": mode, "enforced": enforced, **denial}),
    )
    if enforced:
        audience = denial["audience"] or "none (unknown or missing bearer token)"
        raise ToolAccessDenied(
            f"unauthorized: tool '{name}' is not available to this credential "
            f"(audience: {audience}). Server-side audience authorization is in "
            f"fail-closed mode (#585)."
        )


def _request_bearer_token(server) -> str | None:
    """Extract the bearer token of the in-flight MCP request, if any.

    The streamable-http transport attaches the originating Starlette Request to
    every message (ServerMessageMetadata.request_context), and the low-level
    server publishes it through the request_ctx contextvar for the duration of
    each handler call — so this is per-request-correct even on a long-lived
    session. Absent context (stdio, in-process calls, import stubs) resolves to
    None, which under enforce mode denies: fail closed.
    """
    lowlevel = getattr(server, "_mcp_server", None)
    if lowlevel is None:
        return None
    try:
        ctx = lowlevel.request_context
    except LookupError:
        return None
    headers = getattr(getattr(ctx, "request", None), "headers", None)
    if headers is None:
        return None
    return _bearer_token_from_authorization(headers.get("authorization"))


# Conservative capability classification: mixed-action tools remain write-capable.
_TOOL_READ_ONLY = frozenset(
    {
        "climate",
        "scorecard",
        "outcome_kpi",
        "equipment_state",
        "forecast",
        "get_setpoints",
        "history",
        "lessons",
        "lessons_search",
        "knowledge_search",
        "topology",
        "position_current",
        "crop_history",
        "crop_lifecycle",
        "irrigation_status",
        "irrigation_schedule",
        "irrigation_history",
        "get_greenhouse_snapshot",
        "settings",
        "activity",
        "band_profile",
        "band_profile_preview",
        "soil_targets",
    }
)


def _tool_transport_peer(server):
    """Record only the transport peer; forwarded claims are never promoted to identity."""
    try:
        request = server._mcp_server.request_context.request
    except (AttributeError, LookupError):
        return None
    host = getattr(getattr(request, "client", None), "host", None)
    try:
        return str(ipaddress.ip_address(host))
    except (TypeError, ValueError):
        return None


def _tool_edge_request_id_claim(server):
    """Bounded opaque correlation only; a CF-Ray claim never supplies identity.

    A trusted join also needs the isolated edge router/entrypoint and this
    event's actual transport peer matching that proxy. Internal clients can
    supply this header, so neither its presence nor its shape proves provenance.
    """
    try:
        headers = server._mcp_server.request_context.request.headers
    except (AttributeError, LookupError):
        return None
    if not callable(getattr(headers, "get", None)):
        return None
    getlist = getattr(headers, "getlist", None)
    values = getlist("cf-ray") if callable(getlist) else [headers.get("cf-ray")]
    if len(values) != 1:
        return None
    value = values[0]
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-fA-F]{16,32}-[A-Z]{3}", value) is None:
        return None
    return value


class AudienceAuthorizedFastMCP(FastMCP):
    """FastMCP with server-side audience authorization at the dispatch choke point.

    FastMCP.call_tool is the single public method the low-level MCP server
    invokes for every tool call, so overriding it covers every registered
    tool without touching any tool body or signature (and without a
    per-tool decorator or ASGI-middleware fallback). A raised ToolAccessDenied is
    converted by the low-level server into an isError tool result with this
    message — the session stays healthy.

    The caller is resolved once per call (resolve_caller) and drives both the
    authorization decision and the request actor (current_actor), which is set
    for the duration of the tool body and reset afterwards (VD-59).
    """

    async def call_tool(self, name, arguments):
        token = _request_bearer_token(self)
        caller: tuple[str | None, str | None] = (None, None)
        if auth_mode() != "off":
            caller = resolve_caller(token)
        authorize_tool_call(name, token, caller)
        audience, agent_name = caller
        actor = request_actor(audience, agent_name)
        peer = _tool_transport_peer(self)
        started = time.monotonic()
        outcome = "exception"
        actor_reset = _REQUEST_ACTOR.set(actor)
        try:
            result = await super().call_tool(name, arguments)
            # Completed is a dispatch outcome, never a claim that a business action succeeded.
            outcome = "tool_error" if getattr(result, "isError", False) is True else "completed"
            return result
        except asyncio.CancelledError:
            outcome = "cancelled"
            raise
        finally:
            _REQUEST_ACTOR.reset(actor_reset)
            _TOOL_AUDIT_LOGGER.info(
                "%s",
                _json(
                    {
                        "event": "mcp_tool_call",
                        "audience": audience,
                        # The R4 source string only; never a token.
                        "actor": actor.source if actor is not None else None,
                        "tool": name if name in TOOL_AUDIENCES else "unregistered",
                        "capability": "read" if name in _TOOL_READ_ONLY else "write_capable",
                        "result": outcome,
                        "duration_ms": round((time.monotonic() - started) * 1000, 3),
                        "peer_ip": peer,
                        "client_ip_source": "transport_peer" if peer else "unavailable",
                        "edge_request_id_claim": _tool_edge_request_id_claim(self),
                        "auth_mode": auth_mode(),
                    }
                ),
            )

    async def list_tools_unfiltered(self):
        """Internal inventory for readiness/registry checks, never protocol dispatch."""
        return await super().list_tools()

    async def list_tools(self):
        """Expose only the in-flight request audience's authorized inventory."""
        tools = await self.list_tools_unfiltered()
        mode = auth_mode()
        if mode == "off":
            return tools
        _registry, _unrecognized, duplicate_env_names, _invalid_token_env_names = audience_token_configuration()
        if duplicate_env_names:
            return []
        audience, _agent_name = resolve_caller(_request_bearer_token(self))
        if audience is None:
            return []
        allowed = audience_allowlist(audience)
        return [tool for tool in tools if tool.name in allowed]

    def streamable_http_app(self):
        """Wrap the entire protocol endpoint before initialize/list dispatch."""
        return MCPTransportAuthMiddleware(
            super().streamable_http_app(),
            mcp_path=self.settings.streamable_http_path,
        )


# Every backticked tool name here must be registered: tests/test_mcp_irrigation_read_tools.py fails on one that
# tools/list for admin does not return, so the paragraph grows with each tool.
SERVER_INSTRUCTIONS = """Verdify greenhouse tools. Use these to read the climate, the record and the
    forecast, and to run the water program. The controller runs the climate law on its own: no tool writes a
    climate value. Iris is the daily reviewer: once a day and on a manual request it reads the record and stores
    one review with `review_write` (its run id is the trigger_id of the wake-up). A review may propose a band edit;
    only the owner applies it, in the dashboard's band editor.

    `set_setting` changes an operator switch (occupancy, a light circuit out of service) within the registry and
    stores the `manual` flag it carries (default false); any other setting is refused with `forbidden`, the band
    rows and the drying cost limit included. `settings` and `activity` read the catalog, history and every write.

    The house band is operator-owned and has no write tool: `band_profile` reads its profile,
    anchors and day curve with the last 24 h measured, and `band_profile_preview` evaluates a
    draft without saving it. The dashboard saves the band.

    Irrigation: `irrigation_status`, `irrigation_schedule` and `irrigation_history` only read
    the water program, in the operator API's JSON, with unknown as null, never 0. Iris, named
    agents and admin share the writes, with the dashboard's checks: `irrigation_schedule_set`,
    `irrigation_line_set`, `irrigation_run`, `irrigation_stop` and `irrigation_clear_fault`.
    Before the irrigation firmware, run works on L01 only, clear-fault waits for it, schedule and
    line writes are stored for the first program push, and irrigation_stop always works. `manual`:
    MCP creates and definition edits store false unless you pass true; pause, resume, run, stop
    and clear-fault never change it; only Iris is refused with `manual` on a manual item.
    `check_required`: only a person records a line's check, on the dashboard. `request_id` makes
    a write safe to retry: the same id and payload returns the stored result with `replayed: true`.
    A refusal is the Problem JSON with isError: its code is from the OpenAPI ProblemCode list, and
    `retryable` is true only where waiting helps. A value outside a tool's schema is refused before
    the tool runs, with isError and a plain message. Each irrigation write changes watering only."""

mcp = AudienceAuthorizedFastMCP(
    "verdify",
    instructions=SERVER_INSTRUCTIONS,
    # Bind explicitly so MCP_HTTP_HOST/PORT env vars actually take effect.
    # FastMCP only auto-reads FASTMCP_-prefixed env vars, so the
    # os.environ.setdefault block in __main__ was dead code. Reading the env
    # here lets a systemd drop-in (Environment=MCP_HTTP_HOST=0.0.0.0) make
    # the server reachable from the hermes-iris Docker container via the
    # docker0 / verdify-internal bridge IP. Default stays 127.0.0.1:8000.
    host=os.environ.get("MCP_HTTP_HOST", "127.0.0.1"),
    port=int(os.environ.get("MCP_HTTP_PORT", "8000")),
    # MCP Python SDK 1.27 supports stateless Streamable HTTP for legacy clients.
    # Verdify uses no server-initiated sampling/roots/elicitation, so every
    # authenticated request can safely land on either prod replica without an
    # in-memory Mcp-Session-Id and cross-pod 404s.
    stateless_http=True,
)

HERMES_REQUIRED_TOOLS = frozenset(
    {
        "activity",
        "alerts",
        "climate",
        "crop_history",
        "crop_lifecycle",
        "crops",
        "equipment_state",
        "forecast",
        "get_setpoints",
        "history",
        "irrigation_clear_fault",
        "irrigation_history",
        "irrigation_line_set",
        "irrigation_run",
        "irrigation_schedule",
        "irrigation_schedule_set",
        "irrigation_status",
        "irrigation_stop",
        "knowledge_search",
        "lessons",
        "lessons_manage",
        "lessons_search",
        "observations",
        "position_current",
        "review_write",
        "scorecard",
        "settings",
        "topology",
    }
)

# ── Tool inventory as data (#585) ──
# EVERY @mcp.tool() registered in this file must have an entry here — the
# module-bottom _assert_tool_audience_registry_complete() fails startup on any
# drift, so a new tool cannot silently skip authorization.
#
# Audiences:
#   iris       — the Hermes Iris profile, the daily reviewer. Exactly the 28 tools of
#                hermes-config.yaml tools.include (== HERMES_REQUIRED_TOOLS);
#                tests/test_mcp_audience_auth.py holds the three surfaces in
#                lockstep. Reads, its irrigation tools, lessons and review_write;
#                no setting, plan or band write.
#   experiment — the blinded experiment planner arm (audit §8.8): qualified
#                climate/forecast/crop/topology READS only (trigger
#                acknowledgement retired with the plan cycle). Treatment-revealing reads
#                (get_setpoints, history, scorecard, outcome_kpi,
#                lessons*) and all ordinary writes are denied. Wired but
#                unused until Lane C/D tranche 2 issues its credential.
#   agent      — named in-cluster agents (VD-59, architecture §5.6), one key
#                each in Secret verdify-mcp-agents (agent_key_registry). The
#                live greenhouse reads plus alerts, settings, activity, set_setting,
#                every irrigation tool and the planting tools (#1328). Never the
#                planner, lessons or the legacy crops/observations tools.
#                Calls are attributed agent:<name>.
#   admin      — operator/debug credential; every tool. Its writes are
#                attributed agent:admin.
#   observer   — protocol-only availability probe; no tools.
TOOL_AUDIENCES: dict[str, frozenset[str]] = {
    # Monitoring
    "climate": frozenset({"iris", "experiment", "agent", "admin"}),
    "scorecard": frozenset({"iris", "agent", "admin"}),
    "outcome_kpi": frozenset({"admin"}),
    "equipment_state": frozenset({"iris", "agent", "admin"}),
    "forecast": frozenset({"iris", "experiment", "agent", "admin"}),
    "get_setpoints": frozenset({"iris", "agent", "admin"}),
    "history": frozenset({"iris", "agent", "admin"}),
    "alerts": frozenset({"iris", "agent", "admin"}),
    "settings": frozenset({"iris", "agent", "admin"}),
    "activity": frozenset({"iris", "agent", "admin"}),
    # Irrigation reads (VD-60, #1173): the REST JSON of API-IRR-01, -02, -10 and -11.
    "irrigation_status": frozenset({"iris", "agent", "admin"}),
    "irrigation_schedule": frozenset({"iris", "agent", "admin"}),
    "irrigation_history": frozenset({"iris", "agent", "admin"}),
    # #1346: the greenhouse snapshot (Now's AI-written summary). Never Iris or the experiment arm: the snapshot is
    # never an input to a plan.
    "get_greenhouse_snapshot": frozenset({"agent", "admin"}),
    # Knowledge
    "lessons": frozenset({"iris", "admin"}),
    "lessons_search": frozenset({"iris", "admin"}),
    "knowledge_search": frozenset({"iris", "admin"}),
    # Crops + topology (read-only crop context is experiment-safe; the
    # action-verb crops/observations tools carry writes, so they are not)
    "crops": frozenset({"iris", "admin"}),
    "observations": frozenset({"iris", "admin"}),
    "topology": frozenset({"iris", "experiment", "agent", "admin"}),
    "position_current": frozenset({"iris", "experiment", "agent", "admin"}),
    "crop_history": frozenset({"iris", "experiment", "admin"}),
    "crop_lifecycle": frozenset({"iris", "experiment", "admin"}),
    # Writes. The planner writes no setting (climate refactor 4.2): set_setting is for named agents and admin, and
    # the service refuses an agent anything but an operator switch.
    "set_setting": frozenset({"agent", "admin"}),
    # The daily review (5.1): Iris stores its review; admin requests a manual one.
    "review_write": frozenset({"iris", "admin"}),
    "lessons_manage": frozenset({"iris", "admin"}),
    # Operator-only surfaces (never in the Hermes include list)
    "review_run": frozenset({"admin"}),
    "query": frozenset({"admin"}),
    # Irrigation writes (VD-64, #1177; VD-61, #1174): one surface for every agent, Iris included (D-IRP-21).
    # trigger_id only annotates the activity log; the review passes its own run id.
    "irrigation_schedule_set": frozenset({"iris", "agent", "admin"}),
    "irrigation_line_set": frozenset({"iris", "agent", "admin"}),
    "irrigation_run": frozenset({"iris", "agent", "admin"}),
    "irrigation_stop": frozenset({"iris", "agent", "admin"}),
    "irrigation_clear_fault": frozenset({"iris", "agent", "admin"}),
    # Plantings (#1328): records only (no setting, band or target), over verdify_services.crops. Named agents and
    # admin; Iris stays read-only on plantings and the experiment arm gets none.
    "crop_locations": frozenset({"agent", "admin"}),
    "resolve_positions": frozenset({"agent", "admin"}),
    "record_planting": frozenset({"agent", "admin"}),
    "record_plantings": frozenset({"agent", "admin"}),
    "move_planting": frozenset({"agent", "admin"}),
    "harvest_planting": frozenset({"agent", "admin"}),
    "remove_planting": frozenset({"agent", "admin"}),
    "annotate_planting": frozenset({"agent", "admin"}),
    "planting_history": frozenset({"agent", "admin"}),
    # The house band (#1334): API-23's read for named agents and admin. No band write tool exists (the band is
    # operator-owned; API-24 is the dashboard's), and Iris is left out so its profile stays the Hermes include list.
    "band_profile": frozenset({"agent", "admin"}),
    "band_profile_preview": frozenset({"agent", "admin"}),
    # Soil-moisture targets (#1345): API-SOIL-01/02's twins for named agents and admin. Iris is left out: a target
    # moves the soil_dryout page, which is an operator setting, not a plan.
    "soil_targets": frozenset({"agent", "admin"}),
    "soil_target_set": frozenset({"agent", "admin"}),
}

# Registry entries for tools that are DESIGNED but not yet registered. Each
# moves into TOOL_AUDIENCES when its @mcp.tool() lands; until then the startup
# assertion keeps the two maps disjoint so a pending entry cannot mask a
# registered tool that skipped authorization.
PENDING_TOOL_AUDIENCES: dict[str, frozenset[str]] = {}


def audience_allowlist(audience: str) -> frozenset[str]:
    """The set of registered tools an audience may call."""
    return frozenset(name for name, audiences in TOOL_AUDIENCES.items() if audience in audiences)


async def _db() -> asyncpg.Connection:
    # Hermes's MCP client timeout is intentionally longer than the database
    # query budget. A server-side fence prevents a timed-out tool call from
    # leaving a PostgreSQL backend consuming memory until it reaches a send
    # boundary.
    conn = await asyncpg.connect(
        DB_DSN,
        server_settings={
            "application_name": "verdify-mcp",
            "statement_timeout": f"{MCP_DB_STATEMENT_TIMEOUT_MS}ms",
        },
    )
    try:
        await _attest_mcp_runtime_connection(conn)
    except Exception:
        await conn.close()
        raise
    return conn


# ── Service-layer tools (architecture §5.6) ──
# Thin adapters over verdify_services: the REST JSON from the same Pydantic
# models, a refusal as its Problem JSON with isError, and the actor only from
# the request. The new tools carry no return annotation, so FastMCP passes the
# CallToolResult through unchanged.


def _tool_result(body: dict[str, Any], *, is_error: bool = False):
    # Imported here: CI loads this module under a FastMCP stub without the MCP runtime.
    import mcp.types as mcp_types

    return mcp_types.CallToolResult(
        content=[mcp_types.TextContent(type="text", text=json.dumps(body))],
        isError=is_error,
    )


def _tool_ok(model, replayed: bool = False):
    """The REST JSON of ``model``, with a top-level ``replayed: true`` on a replay (MCP has no headers)."""
    body = model.model_dump(mode="json")
    return _tool_result({**body, "replayed": True} if replayed else body)


def _tool_problem(refusal: Problem):
    """The Problem JSON REST sends as application/problem+json, with isError."""
    return _tool_result(refusal.body(), is_error=True)


def _answers_problems(tool):
    """Answer a service refusal, a query over the database's limit or a database outage as Problem JSON."""

    @functools.wraps(tool)
    async def answered(*args, **kwargs):
        try:
            return await tool(*args, **kwargs)
        except ServiceError as refused:
            return _tool_problem(refused.problem)
        except asyncpg.QueryCanceledError:
            limit_s = MCP_DB_STATEMENT_TIMEOUT_MS // 1000
            return _tool_problem(problem("query_timeout", f"The database stopped the query at its {limit_s} s limit."))
        except (
            OSError,
            asyncpg.PostgresConnectionError,
            asyncpg.InterfaceError,
            # Starting up or shutting down (57P0x), out of connections or memory (53xxx).
            asyncpg.OperatorInterventionError,
            asyncpg.InsufficientResourcesError,
        ):
            return _tool_problem(problem("unavailable", "The database could not answer. Try again."))

    return answered


@asynccontextmanager
async def _service_connection() -> AsyncIterator[asyncpg.Connection]:
    conn = await _db()
    try:
        yield conn
    finally:
        await conn.close()


def _service_actor() -> ServiceActor | None:
    """The request's actor as verdify_services takes it: never an argument of the tool."""
    actor = current_actor()
    return None if actor is None else ServiceActor(source=actor.source, name=actor.name)


def _uuid_argument(name: str, value: str | None) -> str | None:
    """A UUID string argument in its canonical form; ``invalid_request`` when it is not one."""
    if value is None:
        return None
    try:
        return str(UUID(value))
    except (AttributeError, TypeError, ValueError) as exc:
        raise ServiceError(problem("invalid_request", f"{name} must be a UUID", field=name)) from exc


def _time_argument(name: str, value: str | None) -> datetime | None:
    """An ISO-8601 time argument with its UTC offset; ``invalid_request`` when it is not one."""
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ServiceError(
            problem("invalid_request", f"{name} must be an ISO-8601 time with its UTC offset", field=name)
        ) from exc
    if parsed.utcoffset() is None:
        raise ServiceError(problem("invalid_request", f"{name} needs its UTC offset", field=name))
    return parsed


_KPI_FANOUT_POOL_MAX_SIZE = 4
# Annotations quoted: schema-only CI imports this module with a lightweight
# asyncpg stub that has no Pool attribute (see _install_mcp_runtime_import_stubs).
_kpi_fanout_pool: "asyncpg.Pool | None" = None
_kpi_fanout_pool_lock = asyncio.Lock()


async def _kpi_fanout_pool_get() -> "asyncpg.Pool":
    global _kpi_fanout_pool
    if _kpi_fanout_pool is None:
        async with _kpi_fanout_pool_lock:
            if _kpi_fanout_pool is None:
                pool_options = {"init": _attest_mcp_runtime_connection} if _mcp_runtime_db_role_required() else {}
                _kpi_fanout_pool = await asyncpg.create_pool(
                    DB_DSN,
                    min_size=0,
                    max_size=_KPI_FANOUT_POOL_MAX_SIZE,
                    max_inactive_connection_lifetime=60.0,
                    server_settings={
                        "application_name": "verdify-mcp",
                        "statement_timeout": f"{MCP_DB_STATEMENT_TIMEOUT_MS}ms",
                    },
                    **pool_options,
                )
    return _kpi_fanout_pool


async def _fetch_kpi_action_scorecard(conn: asyncpg.Connection, sql: str, target_day: date, greenhouse_id: str):
    # SET LOCAL expires on both commit and rollback, including cancellation.
    # The following moisture/policy reads on this pooled connection retain the
    # normal 15 s session setting.
    async with conn.transaction(readonly=True):
        await conn.execute(f"SET LOCAL statement_timeout = '{KPI_ACTION_SCORECARD_TIMEOUT_MS}ms'")
        return await conn.fetch(sql, target_day, greenhouse_id)


def _custom_route(path: str, *, methods: list[str]):
    """Register a FastMCP route while keeping schema-only import stubs usable."""
    custom_route = getattr(mcp, "custom_route", None)
    if custom_route is None:
        return lambda func: func
    return custom_route(path, methods=methods)


@_custom_route("/readyz", methods=["GET"])
async def mcp_ready(_request):
    """Tool-level readiness used by Hermes and release acceptance.

    A listening TCP socket is insufficient: required tools can disappear from
    registration while the process remains healthy.  Readiness also proves a
    minimal DB round trip because every control tool depends on that store.
    """
    # Starlette is a runtime dependency of the MCP package, but schema-only CI
    # intentionally imports this module with lightweight MCP stubs.  Keep the
    # response dependency off that import path.
    from starlette.responses import JSONResponse

    # Readiness validates the complete server registry, not the current probe's
    # unauthenticated protocol view. Protocol tools/list is audience-filtered.
    registered = {tool.name for tool in await mcp.list_tools_unfiltered()}
    missing = sorted(HERMES_REQUIRED_TOOLS - registered)
    db_error: str | None = None
    conn: asyncpg.Connection | None = None
    try:
        conn = await _db()
        await conn.fetchval("SELECT 1")
    except Exception as exc:
        db_error = type(exc).__name__
    finally:
        if conn is not None:
            await conn.close()
    # #585: operators must be able to SEE the authorization rollout state
    # (off → log → enforce) on the same surface release acceptance already
    # reads. Names only — never token values. Enforce mode with an empty token
    # registry would fail-closed every tool call, so that misconfiguration
    # reports not-ready instead of serving a fully bricked tool surface.
    mode = auth_mode()
    token_registry, unrecognized_token_envs, duplicate_token_envs, invalid_token_envs = audience_token_configuration()
    auth_misconfigured = bool(unrecognized_token_envs or duplicate_token_envs or invalid_token_envs) or (
        mode == "enforce" and "iris" not in token_registry
    )
    # VD-59: named agents are reported by name only and never change `ready`.
    # The readiness probe's failureThreshold is 1, and one bad agent key must
    # not take Iris's tool surface out of service.
    agent_keys, rejected_agent_keys = agent_key_registry()
    ready = not missing and db_error is None and not auth_misconfigured
    return JSONResponse(
        {
            "ready": ready,
            "required_tools": sorted(HERMES_REQUIRED_TOOLS),
            "missing_tools": missing,
            "db": "ok" if db_error is None else "unavailable",
            "db_error_class": db_error,
            "auth_mode": mode,
            "auth_audiences_configured": sorted(token_registry),
            "auth_unrecognized_token_envs": unrecognized_token_envs,
            "auth_duplicate_token_envs": duplicate_token_envs,
            "auth_invalid_token_envs": invalid_token_envs,
            "auth_misconfigured": auth_misconfigured,
            "auth_agents_configured": sorted(agent_keys),
            "auth_agent_keys_rejected": rejected_agent_keys,
        },
        status_code=200 if ready else 503,
    )


# ═══════════════════════════════════════════════════════════════
# MONITORING TOOLS
# ═══════════════════════════════════════════════════════════════


@mcp.tool()
async def climate() -> str:
    """Get current greenhouse climate readings (temp, VPD, RH, dew point, zone sensors, outdoor)."""
    conn = await _db()
    try:
        row = await conn.fetchrow("""
            SELECT round(temp_avg::numeric,1) as temp_f,
                   round(vpd_avg::numeric,2) as vpd_kpa,
                   round(rh_avg::numeric,0) as rh_pct,
                   round(dew_point::numeric,1) as dew_point_f,
                   round((temp_avg - dew_point)::numeric,1) as dp_margin_f,
                   round(vpd_south::numeric,2) as vpd_south,
                   round(vpd_west::numeric,2) as vpd_west,
                   round(vpd_east::numeric,2) as vpd_east,
                   round(outdoor_temp_f::numeric,1) as outdoor_temp,
                   round(outdoor_rh_pct::numeric,0) as outdoor_rh,
                   round(lux::numeric,0) as lux,
                   round(solar_irradiance_w_m2::numeric,0) as solar_w,
                   round(solar_irradiance_w_m2::numeric,0) as solar_w_m2,
                   extract(epoch FROM now() - ts)::int as age_seconds
            FROM climate ORDER BY ts DESC LIMIT 1
        """)
        mode = await conn.fetchval(
            "SELECT value FROM system_state WHERE entity = 'greenhouse_state' ORDER BY ts DESC LIMIT 1"
        )
        # Sprint 23+: validate-on-emit through ClimateSnapshot. Schema drift
        # in the SELECT (e.g. a renamed column) fails here, not silently in
        # Iris's downstream parse.
        snap = ClimateSnapshot.model_validate({**dict(row), "mode": mode})
        return snap.model_dump_json()
    finally:
        await conn.close()


async def read_physical_crop_band_evidence(conn, day, greenhouse_id="vallery"):
    """Read only trusted-owner published revisions; invalid latest rows fail closed."""
    from verdify_schemas.physical_crop_band import PhysicalCropBandEvidence

    try:
        async with conn.transaction():
            await conn.execute("SET LOCAL statement_timeout = '3000ms'")
            row = await conn.fetchrow(
                "SELECT reader_contract_version,day,greenhouse_id,served_at,revision_id,recorded_at,"
                "diagnostic,unavailable_reason FROM public.fn_physical_crop_band_evidence($1::date,$2::text)",
                day,
                greenhouse_id,
                timeout=3.5,
            )
        data = dict(row)
        if data["day"] != day or data["greenhouse_id"] != greenhouse_id:
            raise ValueError("physical evidence scope mismatch")
        if isinstance(data.get("diagnostic"), str):
            data["diagnostic"] = json.loads(data["diagnostic"])
        data["availability"] = "available" if data["unavailable_reason"] is None else "unavailable"
        return PhysicalCropBandEvidence.model_validate(data)
    except (asyncpg.QueryCanceledError, TimeoutError):
        reason = "db_statement_timeout"
    except (asyncpg.UndefinedFunctionError, asyncpg.UndefinedTableError, asyncpg.InsufficientPrivilegeError):
        reason = "reader_unavailable"
    except (ValidationError, ValueError, TypeError, KeyError, OverflowError):
        reason = "invalid_diagnostic"
    return PhysicalCropBandEvidence(day=day, greenhouse_id=greenhouse_id, unavailable_reason=reason)


@mcp.tool()
async def scorecard(target_date: str = "", include_realized_dryout: bool = False) -> str:
    """Get a daily scorecard; pass YYYY-MM-DD or omit for today.

    Inspect scorecard_contract_version and metric_semantics first. Contract 3
    (migration 309, #1623) has ONE temperature/VPD measurement basis: the dynamic
    served house band (band_house_* audit rows). compliance_pct /
    temp_compliance_pct / vpd_compliance_pct are the shares of 5-minute
    house-average buckets inside that band (migration 290's daily_band_compliance;
    the database writes them). Stress hours are the hours below or above that band
    per axis and can overlap. They are not fixed-panel crop outcomes; coverage is
    unverified and no center probe is measured. Never widen the served band to
    improve the score.

    planner_score = compliance_pct at 100% weight, always:
    planner_score_resource_weight_pct and resource_terms_available are 0. kwh,
    therms, water_gal and cost_* are informational nominal-model estimates,
    never an objective; electric heat1 is the primary heat by design, so its
    runtime and cost are not something to minimise. water_gal is planning water
    (climate wetting + wall irrigation + wall fertigation); house/hose water is
    not planning information. Null means unavailable, not zero or perfect.
    Composite outcome fields remain null until their physical evidence contract
    is implemented.

    native_fixed_panel_route_evidence exposes actual source-route axis/joint
    eligible 15-minute bins, high/low distance and severity, worst source route
    and explicit future/undeclared/missing bins under a prospective target and
    exact firmware/collector binding. Availability route_measurement is sampled
    host-received callback evidence; physical serial, Modbus poll time and crop
    placement remain unverified. Partial windows are explicit. It is not a
    physical crop outcome, controller credit or experiment endpoint. Keep
    physical_crop_band_evidence unavailable until its own qualification exists.

    For ordinary Iris outcome review, explicitly call scorecard with a single
    target_date (YYYY-MM-DD) and include_realized_dryout=true for the prior
    completed solar night. target_date is both the scalar scorecard calendar day
    and the separate dry-out night START date; that night crosses local midnight.
    The opt-in adds one read under the existing DB budget, at most 500 episodes
    and 64 KiB of dry-out evidence. Ordinary calls do not run this query. Reuse
    the returned result within a planning cycle; do not poll or retry unavailable
    evidence. Inspect availability, evidence_status, confound_reasons, relay
    truth and observed AH/VPD response before using any disposition. Safety pass
    alone is not effectiveness; empty episodes or missing daylight evidence
    cannot prove zero admission, complete coverage or a causal crop benefit.

    Response is validated through verdify_schemas.ScorecardResponse. Partial days
    may contain null metrics; inspect evidence limitations before using a score."""
    conn = await _db()
    try:
        if target_date:
            d = datetime.strptime(target_date, "%Y-%m-%d").date()
        else:
            d = await conn.fetchval("SELECT (now() AT TIME ZONE 'America/Denver')::date")
        try:
            rows = await conn.fetch("SELECT * FROM fn_planner_scorecard($1::date)", d)
        except asyncpg.QueryCanceledError:
            return _json(
                {
                    "availability": "unavailable",
                    "reason": "db_statement_timeout",
                    "query_budget_ms": MCP_DB_STATEMENT_TIMEOUT_MS,
                    "guidance": "Do not infer zero performance; continue from fresh climate and forecast evidence.",
                }
            )
        try:
            sc = ScorecardResponse.from_metric_rows(rows)
        except ValidationError as e:
            return _json(
                {
                    "error": "ScorecardResponse validation failed — DB may have new metrics",
                    "details": json.loads(e.json()),
                    "raw": {r["metric"]: (float(r["value"]) if r["value"] is not None else None) for r in rows},
                }
            )
        sc.physical_crop_band_evidence = await read_physical_crop_band_evidence(conn, d)
        sc.route_only_crop_band_evidence = await read_route_only_crop_band_evidence(conn, d)
        sc.native_fixed_panel_route_evidence = await read_native_fixed_panel_route_evidence(conn, d)
        if include_realized_dryout:
            sc.realized_solar_night_dryout = (
                await read_realized_dryout_evidence(conn, d, MCP_DB_STATEMENT_TIMEOUT_MS)
                if target_date
                else RealizedDryoutEvidence(unavailable_reason="explicit_night_date_required")
            )
        return sc.model_dump_json(by_alias=True)
    finally:
        await conn.close()


# #389: the transition-derived runtime contract lives in
# v_equipment_runtime_daily, but its single-day evaluation costs 11-40+ s in
# prod (O(days x transitions), migration-199/200 headers) — over the MCP
# statement fence — so outcome_kpi reads the migration-200 materialized
# snapshot (mv_equipment_runtime_daily, refreshed every 10 min) and reconciles:
# a completed local day must be complete in the snapshot, otherwise the read
# falls back to the live view so completed-day truth never silently degrades
# to a stale snapshot. Rows for the snapshot window bound come from
# migration 199.
_EQUIPMENT_RUNTIME_SNAPSHOT_WINDOW_DAYS = 45


def _cycle_day_status(target_day: date, today_local: date) -> str:
    """Deploy-gate day classification for the cycle/runtime axis (#389).

    Only completed local days are comparable across an OTA; the current local
    day is mid-flight (its transition counts are honest but partial) and a
    future-dated day has no evidence at all.
    """
    if target_day > today_local:
        return "future_date_excluded"
    if target_day == today_local:
        return "partial_day_excluded"
    return "complete"


def _cycle_snapshot_is_stale(cycle_rows, target_day: date, today_local: date) -> bool:
    """True when the materialized runtime snapshot cannot serve a completed day.

    A completed local day inside the migration-199 window must exist in the
    snapshot and be marked complete; a missing or still-partial row means the
    10-minute refresh has not run since local midnight (or the snapshot never
    covered the day), so the caller must re-read the live view instead of
    serving mid-day counts as completed-day truth. Partial (current) and
    future-dated targets never trigger the fallback — they are excluded from
    deploy-gate comparison regardless of snapshot freshness — and neither do
    days older than the operational window, where both surfaces are empty by
    design.
    """
    if target_day >= today_local:
        return False
    if target_day < today_local - timedelta(days=_EQUIPMENT_RUNTIME_SNAPSHOT_WINDOW_DAYS):
        return False
    if not cycle_rows:
        return True
    return any(not row["is_complete_day"] for row in cycle_rows)


@mcp.tool()
async def outcome_kpi(target_date: str = "") -> str:
    """Get ADR-0004 outcome KPIs for a day.

    This is the read-only outcome surface for floating-corridor control: served
    corridor compliance, VPD misses, transition-derived actuator cycles/runtime,
    dew margin, water
    use, availability-bearing DLI evidence, moisture-estimator decisions,
    fog/dehum ping-pong sequences,
    heat-dehum episodes, and per-action effectiveness from the daily climate-
    action scorecard. ADR-0004 means these are outcome and resource guardrails,
    not an instruction to target-hug while the crop is already inside the
    served corridor.

    DIF and solar-phase buckets are computed on demand from one-minute climate
    samples against the served house band. Moisture-estimator buckets are computed from
    climate_action_log.source_system_state->climate_moisture_exchange when the
    OTA/deploy path has produced rows; #327 makes that context first-class:
    per-(action, reason) buckets now include the #410 held-temp fields
    (vent_held_vpd_gain_kpa, hold_required), the selected/expected VPD gain,
    and outdoor age, and vpd_policy carries episode counters by estimator
    reason (episodes_by_mx_reason; pre-#385 rows bucket as estimator_absent).
    Migration 187's v_moisture_estimator_telemetry view is the equivalent
    typed SQL surface.  Raw equipment transitions, not firmware daily counters,
    are the cycle/runtime authority; the counters remain diagnostic context.
    Cycle/runtime rows are read from the migration-200 materialized snapshot
    (mv_equipment_runtime_daily, refreshed every 10 minutes) with a live-view
    fallback whenever the snapshot cannot serve a completed day; only
    completed local days participate in deploy-gate cycle comparison —
    the current (partial) day and future-dated targets are explicitly
    excluded (vpd_policy.cycle_source.deploy_gate).
    Realized solar-night dry-out episodes distinguish effective, ineffective,
    blocked, and insufficient-evidence outcomes. Pass date as YYYY-MM-DD or
    omit for today.

    Single-day, cache-friendly surface: one call covers exactly one
    Denver-local day (multi-day ranges are not accepted), and completed days
    are stable reads — identical inputs return identical content — so a
    looping LLM caller (e.g. the planner) should reuse prior responses for
    finished dates instead of re-polling. The independent section fetches run
    concurrently on a small bounded connection pool and the shared 1-minute
    resolved-samples scan is computed once, so repeated calls queue on the
    pool instead of fanning out unbounded database load."""
    greenhouse_id = "vallery"
    conn = await _db()
    try:
        # today_local comes from the DB clock (the same clock that stamps
        # equipment_state and the runtime views) so the #389 partial/future
        # classification below can never disagree with the SQL surfaces.
        today_local = await conn.fetchval("SELECT (now() AT TIME ZONE 'America/Denver')::date")
        if target_date:
            try:
                d = datetime.strptime(target_date, "%Y-%m-%d").date()
            except ValueError:
                return _json({"error": "target_date must be YYYY-MM-DD"})
        else:
            d = today_local

        summary_sql = """
            SELECT date, greenhouse_id,
                   compliance_pct,
                   temp_compliance_pct,
                   vpd_compliance_pct,
                   stress_hours_heat,
                   stress_hours_cold,
                   stress_hours_vpd_high,
                   stress_hours_vpd_low,
                   cycles_fan1,
                   cycles_fan2,
                   cycles_heat1,
                   cycles_heat2,
                   cycles_fog,
                   cycles_vent,
                   cycles_mister_south,
                   cycles_mister_west,
                   cycles_mister_center,
                   cycles_grow_light,
                   runtime_fan1_min,
                   runtime_fan2_min,
                   runtime_heat1_min,
                   runtime_heat2_min,
                   runtime_fog_min,
                   runtime_vent_min,
                   runtime_mister_south_h,
                   runtime_mister_west_h,
                   runtime_mister_center_h,
                   runtime_grow_light_min,
                   water_used_gal,
                   mister_water_gal,
                   irrigation_water_gal,
                   fertigation_water_gal,
                   min_dp_margin_f,
                   dp_risk_hours,
                   kwh_estimated,
                   therms_estimated,
                   cost_electric,
                   cost_gas,
                   cost_water,
                   cost_total
            FROM daily_summary
            WHERE date = $1::date AND greenhouse_id = $2
            """
        dli_sql = """
            SELECT crop_dli_mol_m2_day AS value_mol_m2_day,
                   availability,
                   unavailable_reason,
                   provenance,
                   validity_revision,
                   valid_from,
                   valid_to
            FROM v_dli_daily
            WHERE date = $1::date AND greenhouse_id = $2
            """
        dli_validity_sql = """
                SELECT NULL::double precision AS value_mol_m2_day,
                       COALESCE(availability, 'unavailable') AS availability,
                       COALESCE(unavailable_reason, 'validity_contract_missing') AS unavailable_reason,
                       COALESCE(provenance, 'unknown_unvalidated_source') AS provenance,
                       COALESCE(validity_revision, 'missing') AS validity_revision,
                       COALESCE(valid_from, '2024-01-01 00:00:00+00'::timestamptz) AS valid_from,
                       valid_to
                FROM (SELECT 1) anchor
                LEFT JOIN LATERAL fn_dli_validity(
                    ($1::date::timestamp + interval '12 hours') AT TIME ZONE 'America/Denver',
                    $2
                ) ON true
                """
        water_sql = """
            SELECT *
            FROM v_water_attribution_daily
            WHERE date = $1::date AND greenhouse_id = $2
            """
        energy_sql = """
            SELECT *
            FROM v_energy_estimate_reconciliation
            WHERE date = $1::date AND greenhouse_id = $2
            """
        # #389: one shared column list, two sources. The materialized snapshot
        # (migration 200, refreshed every 10 min) is the fast path; the live
        # view is the reconciliation fallback when the snapshot cannot serve a
        # completed day (see _cycle_snapshot_is_stale). Both carry the
        # identical migration-190/199 transition-derived contract.
        cycles_columns = """
            SELECT equipment,
                   on_minutes::double precision AS on_minutes,
                   starts,
                   cycles_under_1m,
                   cycles_1m_to_5m,
                   short_cycles_under_5m,
                   cycles_5m_to_15m,
                   cycles_15m_plus,
                   open_pulses_at_cutoff,
                   peak_transitions_per_hour,
                   is_complete_day,
                   start_state_known,
                   open_at_end,
                   is_deploy_gate_eligible,
                   quality,
                   quality_flags,
                   raw_event_rows,
                   normalized_transition_count,
                   same_timestamp_duplicate_rows,
                   redundant_state_rows,
                   conflicting_timestamp_count
            """
        cycles_snapshot_sql = (
            cycles_columns
            + """
            FROM mv_equipment_runtime_daily
            WHERE day = $1::date AND greenhouse_id = $2
            ORDER BY equipment
            """
        )
        cycles_live_sql = (
            cycles_columns
            + """
            FROM v_equipment_runtime_daily
            WHERE day = $1::date AND greenhouse_id = $2
            ORDER BY equipment
            """
        )
        dryout_sql = """
            SELECT *
            FROM fn_realized_solar_night_dryout($1::date, $1::date, $2)
            ORDER BY episode_started_at
            """
        # #498: the migration-202 single-day function, not the whole-window
        # view — v_climate_action_daily_scorecard evaluates the effectiveness
        # fan-out (fn_equip_at/fn_setpoint_at per action row) at ~6 min of DB
        # CPU per call; the function is byte-identical for one Denver-local
        # date and prunes to that day's chunks (~5 s measured in prod).
        actions_sql = """
            SELECT climate_action,
                   decisions,
                   avg_abs_temp_error_before_f,
                   avg_abs_vpd_error_before_kpa,
                   avg_temp_abs_error_delta_15m_f,
                   avg_vpd_abs_error_delta_15m_kpa,
                   avg_wet_relay_duty_pct,
                   avg_vent_fan_duty_pct,
                   mister_water_delta_gal,
                   wet_blocked_decisions,
                   fog_blocked_decisions
            FROM fn_climate_action_daily_scorecard($1::date)
            WHERE greenhouse_id = $2
            ORDER BY decisions DESC, climate_action
            """
        phase_sql = """
            WITH bounds AS (
                SELECT
                    ($1::date::timestamp AT TIME ZONE 'America/Denver') AS start_ts,
                    (($1::date + 1)::timestamp AT TIME ZONE 'America/Denver') AS end_ts
            ),
            -- #387: ONE 1-minute climate scan and ONE LATERAL band resolution feed the solar-phase
            -- section; its rows require solar_phase IS NOT NULL per row, which the FILTERed ph_*
            -- averages and the ph_sample_rows guard reproduce exactly.
            samples AS (
                SELECT
                    time_bucket('1 minute', c.ts) AS bucket,
                    avg(c.temp_avg)::double precision AS temp_avg,
                    avg(c.vpd_avg)::double precision AS vpd_avg,
                    avg(c.house_temp_target_f)::double precision AS temp_target_f,
                    avg(c.house_vpd_target)::double precision AS vpd_target_kpa,
                    avg(c.solar_phase)::double precision AS solar_phase,
                    count(c.solar_phase)::int AS ph_sample_rows,
                    (avg(c.temp_avg) FILTER (WHERE c.solar_phase IS NOT NULL)
                        )::double precision AS ph_temp_avg,
                    (avg(c.vpd_avg) FILTER (WHERE c.solar_phase IS NOT NULL)
                        )::double precision AS ph_vpd_avg,
                    (avg(c.dew_point) FILTER (WHERE c.solar_phase IS NOT NULL)
                        )::double precision AS ph_dew_point,
                    (avg(c.solar_irradiance_w_m2) FILTER (WHERE c.solar_phase IS NOT NULL)
                        )::double precision AS ph_solar_w_m2,
                    (avg(c.house_temp_target_f) FILTER (WHERE c.solar_phase IS NOT NULL)
                        )::double precision AS ph_temp_target_f,
                    (avg(c.house_vpd_target) FILTER (WHERE c.solar_phase IS NOT NULL)
                        )::double precision AS ph_vpd_target_kpa
                FROM climate c
                CROSS JOIN bounds b
                WHERE c.greenhouse_id = $2
                  AND c.ts >= b.start_ts
                  AND c.ts < b.end_ts
                  AND c.temp_avg IS NOT NULL
                  AND c.vpd_avg IS NOT NULL
                GROUP BY 1
            ),
            -- The corridor edges are the served house band (band_house_* audit rows, #1623), with the
            -- served-band functions as the fallback for a bucket before the first audit row.
            resolved_samples AS (
                SELECT
                    s.*,
                    COALESCE(temp_low.value, band.temp_low) AS temp_low_f,
                    COALESCE(temp_high.value, band.temp_high) AS temp_high_f,
                    COALESCE(vpd_low.value, band.vpd_low) AS vpd_low_kpa,
                    COALESCE(vpd_high.value, band.vpd_high) AS vpd_high_kpa
                FROM samples s
                CROSS JOIN LATERAL fn_band_setpoints(s.bucket) AS band
                LEFT JOIN LATERAL (
                    SELECT value FROM setpoint_snapshot
                    WHERE greenhouse_id = $2 AND parameter = 'band_house_temp_low' AND zone = 'house'
                      AND ts <= s.bucket
                    ORDER BY ts DESC LIMIT 1
                ) temp_low ON true
                LEFT JOIN LATERAL (
                    SELECT value FROM setpoint_snapshot
                    WHERE greenhouse_id = $2 AND parameter = 'band_house_temp_high' AND zone = 'house'
                      AND ts <= s.bucket
                    ORDER BY ts DESC LIMIT 1
                ) temp_high ON true
                LEFT JOIN LATERAL (
                    SELECT value FROM setpoint_snapshot
                    WHERE greenhouse_id = $2 AND parameter = 'band_house_vpd_low' AND zone = 'house'
                      AND ts <= s.bucket
                    ORDER BY ts DESC LIMIT 1
                ) vpd_low ON true
                LEFT JOIN LATERAL (
                    SELECT value FROM setpoint_snapshot
                    WHERE greenhouse_id = $2 AND parameter = 'band_house_vpd_high' AND zone = 'house'
                      AND ts <= s.bucket
                    ORDER BY ts DESC LIMIT 1
                ) vpd_high ON true
            ),
            phase_resolved AS (
                SELECT
                    s.bucket,
                    s.ph_temp_avg AS temp_avg,
                    s.ph_vpd_avg AS vpd_avg,
                    s.ph_dew_point AS dew_point,
                    s.ph_solar_w_m2 AS solar_w_m2,
                    s.solar_phase,
                    s.ph_temp_target_f AS temp_target_f,
                    s.ph_vpd_target_kpa AS vpd_target_kpa,
                    CASE
                        WHEN s.solar_phase < 1.0 THEN 'sunrise_to_noon'
                        WHEN s.solar_phase < 2.0 THEN 'noon_to_sunset'
                        WHEN s.solar_phase < 3.0 THEN 'sunset_to_midnight'
                        ELSE 'midnight_to_sunrise'
                    END AS phase_bucket,
                    CASE
                        WHEN s.solar_phase < 1.0 THEN 0
                        WHEN s.solar_phase < 2.0 THEN 1
                        WHEN s.solar_phase < 3.0 THEN 2
                        ELSE 3
                    END AS phase_order,
                    s.temp_low_f,
                    s.temp_high_f,
                    s.vpd_low_kpa,
                    s.vpd_high_kpa
                FROM resolved_samples s
                WHERE s.ph_sample_rows > 0
            ),
            phase_scored AS (
                SELECT *
                FROM phase_resolved
                WHERE temp_target_f IS NOT NULL
                  AND vpd_target_kpa IS NOT NULL
                  AND temp_low_f IS NOT NULL
                  AND temp_high_f IS NOT NULL
                  AND vpd_low_kpa IS NOT NULL
                  AND vpd_high_kpa IS NOT NULL
            ),
            phase AS (
                SELECT
                    phase_bucket,
                    phase_order,
                count(*)::int AS sample_min,
                round(min(solar_phase)::numeric, 2)::double precision AS phase_min,
                round(max(solar_phase)::numeric, 2)::double precision AS phase_max,
                round(avg(temp_avg)::numeric, 2)::double precision AS temp_avg_f,
                round(avg(vpd_avg)::numeric, 3)::double precision AS vpd_avg_kpa,
                round(min(temp_avg - dew_point)::numeric, 2)::double precision AS min_dp_margin_f,
                round(avg(solar_w_m2)::numeric, 1)::double precision AS avg_solar_w_m2,
                round((100.0 * count(*) FILTER (
                        WHERE temp_avg BETWEEN temp_low_f AND temp_high_f
                          AND vpd_avg BETWEEN vpd_low_kpa AND vpd_high_kpa
                    ) / NULLIF(count(*), 0))::numeric, 2)::double precision AS served_both_pct,
                round((100.0 * count(*) FILTER (
                        WHERE vpd_avg > vpd_high_kpa
                    ) / NULLIF(count(*), 0))::numeric, 2)::double precision AS vpd_high_miss_pct,
                round((100.0 * count(*) FILTER (
                        WHERE vpd_avg < vpd_low_kpa
                    ) / NULLIF(count(*), 0))::numeric, 2)::double precision AS vpd_low_miss_pct
                FROM phase_scored
                GROUP BY phase_order, phase_bucket
            )
            SELECT
                phase_bucket,
                sample_min,
                phase_min,
                phase_max,
                temp_avg_f,
                vpd_avg_kpa,
                min_dp_margin_f,
                avg_solar_w_m2,
                served_both_pct,
                vpd_high_miss_pct,
                vpd_low_miss_pct
            FROM phase
            ORDER BY phase_order
            """
        dif_sql = """
            WITH bounds AS (
                SELECT
                    ($1::date::timestamp AT TIME ZONE 'America/Denver') AS start_ts,
                    (($1::date + 1)::timestamp AT TIME ZONE 'America/Denver') AS end_ts
            ),
            samples AS (
                SELECT
                    time_bucket('1 minute', c.ts) AS bucket,
                    avg(c.temp_avg)::double precision AS temp_avg,
                    avg(c.solar_phase)::double precision AS solar_phase
                FROM climate c
                CROSS JOIN bounds b
                WHERE c.greenhouse_id = $2
                  AND c.ts >= b.start_ts
                  AND c.ts < b.end_ts
                  AND c.temp_avg IS NOT NULL
                  AND c.solar_phase IS NOT NULL
                GROUP BY 1
            )
            SELECT
                count(*) FILTER (WHERE solar_phase < 2.0)::int AS day_sample_min,
                count(*) FILTER (WHERE solar_phase >= 2.0)::int AS night_sample_min,
                round((avg(temp_avg) FILTER (WHERE solar_phase < 2.0))::numeric, 2)::double precision
                    AS day_temp_avg_f,
                round((avg(temp_avg) FILTER (WHERE solar_phase >= 2.0))::numeric, 2)::double precision
                    AS night_temp_avg_f,
                round((
                    avg(temp_avg) FILTER (WHERE solar_phase < 2.0)
                    - avg(temp_avg) FILTER (WHERE solar_phase >= 2.0)
                )::numeric, 2)::double precision AS day_night_temp_delta_f
            FROM samples
            """
        moisture_sql = """
            WITH bounds AS (
                SELECT
                    ($1::date::timestamp AT TIME ZONE 'America/Denver') AS start_ts,
                    (($1::date + 1)::timestamp AT TIME ZONE 'America/Denver') AS end_ts
            ),
            estimator AS (
                SELECT
                    source_system_state -> 'climate_moisture_exchange' AS mx
                FROM climate_action_log
                CROSS JOIN bounds b
                WHERE greenhouse_id = $2
                  AND ts >= b.start_ts
                  AND ts < b.end_ts
                  AND jsonb_typeof(source_system_state -> 'climate_moisture_exchange') = 'object'
            ),
            parsed AS (
                SELECT
                    COALESCE(NULLIF(mx ->> 'action', ''), 'unknown') AS action,
                    COALESCE(NULLIF(mx ->> 'reason', ''), 'unknown') AS reason,
                    NULLIF(mx ->> 'vent_vpd_gain_kpa', '')::double precision
                        AS vent_vpd_gain_kpa,
                    NULLIF(mx ->> 'heat_vpd_gain_kpa', '')::double precision
                        AS heat_vpd_gain_kpa,
                    -- #327/#410 fields (settled names; NULL from pre-#410
                    -- emitters). typeof-guarded like migration 187's
                    -- v_moisture_estimator_telemetry so raw/odd payloads
                    -- degrade to NULL instead of erroring.
                    CASE WHEN jsonb_typeof(mx -> 'vent_held_vpd_gain_kpa') = 'number'
                        THEN (mx ->> 'vent_held_vpd_gain_kpa')::double precision
                    END AS vent_held_vpd_gain_kpa,
                    CASE WHEN mx ->> 'hold_required' IN ('true', 'false')
                        THEN (mx ->> 'hold_required')::boolean
                    END AS hold_required,
                    CASE WHEN jsonb_typeof(mx -> 'expected_vpd_gain_kpa') = 'number'
                        THEN (mx ->> 'expected_vpd_gain_kpa')::double precision
                    END AS expected_vpd_gain_kpa_raw,
                    COALESCE(
                        CASE WHEN jsonb_typeof(mx -> 'outdoor_age_s') = 'number'
                            THEN (mx ->> 'outdoor_age_s')::double precision
                        END,
                        CASE WHEN jsonb_typeof(mx -> 'outdoor_data_age_s') = 'number'
                            THEN (mx ->> 'outdoor_data_age_s')::double precision
                        END
                    ) AS outdoor_age_s,
                    CASE WHEN mx ->> 'outdoor_fresh' IN ('true', 'false')
                        THEN (mx ->> 'outdoor_fresh')::boolean
                    END AS outdoor_fresh,
                    CASE WHEN mx ->> 'vent_overcools' IN ('true', 'false')
                        THEN (mx ->> 'vent_overcools')::boolean
                    END AS vent_overcools,
                    CASE WHEN mx ->> 'heat_assist_corun' IN ('true', 'false')
                        THEN (mx ->> 'heat_assist_corun')::boolean
                    END AS heat_assist_corun,
                    CASE WHEN mx ->> 'heat_assist_active' IN ('true', 'false')
                        THEN (mx ->> 'heat_assist_active')::boolean
                    END AS heat_assist_active,
                    NULLIF(mx ->> 'heat_assist_timer_s', '')::double precision
                        AS heat_assist_timer_s
                FROM estimator
            ),
            enriched AS (
                -- Selected/expected gain: explicit emitter value if present,
                -- else the selected path's own projection (held-temp gain for
                -- the #410 vent_plus_heat_hold / hold_required co-run).
                SELECT parsed.*,
                    COALESCE(
                        expected_vpd_gain_kpa_raw,
                        CASE
                            WHEN reason = 'vent_plus_heat_hold'
                                 OR COALESCE(hold_required, false)
                                THEN COALESCE(vent_held_vpd_gain_kpa, vent_vpd_gain_kpa)
                            WHEN action IN ('vent_dehum', 'vent_humidify')
                                THEN vent_vpd_gain_kpa
                            WHEN action = 'heat_assist' THEN heat_vpd_gain_kpa
                        END
                    ) AS expected_vpd_gain_kpa
                FROM parsed
            )
            SELECT
                action,
                reason,
                count(*)::int AS decisions,
                round(avg(vent_vpd_gain_kpa)::numeric, 3)::double precision
                    AS avg_vent_vpd_gain_kpa,
                round(avg(heat_vpd_gain_kpa)::numeric, 3)::double precision
                    AS avg_heat_vpd_gain_kpa,
                round(avg(vent_held_vpd_gain_kpa)::numeric, 3)::double precision
                    AS avg_vent_held_vpd_gain_kpa,
                round(avg(expected_vpd_gain_kpa)::numeric, 3)::double precision
                    AS avg_expected_vpd_gain_kpa,
                count(*) FILTER (WHERE hold_required)::int AS hold_required_decisions,
                count(*) FILTER (WHERE outdoor_fresh)::int AS outdoor_fresh_decisions,
                round(avg(outdoor_age_s)::numeric, 0)::double precision
                    AS avg_outdoor_age_s,
                count(*) FILTER (WHERE vent_overcools)::int AS vent_overcool_decisions,
                count(*) FILTER (WHERE heat_assist_corun)::int AS heat_assist_corun_decisions,
                count(*) FILTER (WHERE heat_assist_active)::int AS heat_assist_active_decisions,
                round(avg(heat_assist_timer_s)::numeric, 0)::double precision
                    AS avg_heat_assist_timer_s
            FROM enriched
            GROUP BY action, reason
            ORDER BY decisions DESC, action, reason
            """
        vpd_policy_sql = """
            WITH bounds AS (
                SELECT
                    ($1::date::timestamp AT TIME ZONE 'America/Denver') AS start_ts,
                    (($1::date + 1)::timestamp AT TIME ZONE 'America/Denver') AS end_ts
            ),
            ordered AS (
                SELECT
                    l.ts,
                    l.climate_action,
                    l.priority_axis,
                    l.candidate_summary,
                    l.source_system_state,
                    lag(l.climate_action) OVER (ORDER BY l.ts) AS prev_action
                FROM climate_action_log l
                CROSS JOIN bounds b
                WHERE l.greenhouse_id = $2
                  AND l.ts >= b.start_ts
                  AND l.ts < b.end_ts
            ),
            tagged AS (
                SELECT
                    *,
                    sum(CASE WHEN prev_action IS DISTINCT FROM climate_action THEN 1 ELSE 0 END)
                        OVER (ORDER BY ts ROWS UNBOUNDED PRECEDING) AS episode_id
                FROM ordered
            ),
            episodes AS (
                SELECT
                    episode_id,
                    min(ts) AS started_at,
                    max(ts) AS ended_at,
                    climate_action,
                    count(*)::int AS sample_count,
                    bool_or(priority_axis = 'vpd') AS vpd_priority,
                    bool_or(COALESCE(candidate_summary, '') ILIKE '%heat-assist dehum%')
                        AS heat_dehum_summary,
                    bool_or(
                        source_system_state -> 'climate_moisture_exchange' ->> 'action'
                            = 'heat_assist'
                    ) AS mx_heat_assist,
                    bool_or(
                        source_system_state -> 'climate_moisture_exchange' ->> 'heat_assist_active'
                            = 'true'
                    ) AS mx_heat_assist_active
                FROM tagged
                GROUP BY episode_id, climate_action
            ),
            sequenced AS (
                SELECT
                    *,
                    lag(climate_action) OVER (ORDER BY started_at) AS prev_episode_action,
                    lag(ended_at) OVER (ORDER BY started_at) AS prev_episode_ended_at
                FROM episodes
            ),
            classified AS (
                SELECT
                    *,
                    climate_action IN (
                        'SEALED_HUMIDIFY',
                        'SEALED_FOG',
                        'VENT_COOL_MIST_ASSIST',
                        'VENT_COOL_FOG_ASSIST'
                    ) AS is_wetting,
                    climate_action = 'DEHUM_VENT' AS is_dehum,
                    climate_action = 'HEAT'
                        AND (vpd_priority OR heat_dehum_summary OR mx_heat_assist OR mx_heat_assist_active)
                        AS is_heat_dehum,
                    started_at - prev_episode_ended_at AS prev_gap
                FROM sequenced
            )
            SELECT
                count(*)::int AS total_episodes,
                COALESCE(sum(sample_count), 0)::int AS total_samples,
                count(*) FILTER (WHERE is_wetting)::int AS wetting_episodes,
                count(*) FILTER (WHERE is_dehum)::int AS vent_dehum_episodes,
                count(*) FILTER (WHERE is_heat_dehum)::int AS heat_dehum_episodes,
                count(*) FILTER (
                    WHERE is_dehum
                      AND prev_episode_action IN (
                          'SEALED_HUMIDIFY',
                          'SEALED_FOG',
                          'VENT_COOL_MIST_ASSIST',
                          'VENT_COOL_FOG_ASSIST'
                      )
                      AND prev_gap <= interval '30 minutes'
                )::int AS wet_to_dehum_episodes_30m,
                count(*) FILTER (
                    WHERE is_wetting
                      AND prev_episode_action = 'DEHUM_VENT'
                      AND prev_gap <= interval '30 minutes'
                )::int AS dehum_to_wet_episodes_30m,
                round((
                    avg(extract(epoch FROM prev_gap) / 60.0) FILTER (
                        WHERE is_dehum
                          AND prev_episode_action IN (
                              'SEALED_HUMIDIFY',
                              'SEALED_FOG',
                              'VENT_COOL_MIST_ASSIST',
                              'VENT_COOL_FOG_ASSIST'
                          )
                          AND prev_gap <= interval '30 minutes'
                    )
                )::numeric, 1)::double precision AS avg_wet_to_dehum_gap_min,
                round((
                    avg(extract(epoch FROM prev_gap) / 60.0) FILTER (
                        WHERE is_wetting
                          AND prev_episode_action = 'DEHUM_VENT'
                          AND prev_gap <= interval '30 minutes'
                    )
                )::numeric, 1)::double precision AS avg_dehum_to_wet_gap_min
            FROM classified
            """
        # #327: VPD-policy episode counters by estimator reason (mx_reason).
        # One row per modal estimator reason across the day's action episodes;
        # pre-#385 rows (no parsed object) land in 'estimator_absent' so the
        # counters stay meaningful across the fw 995c9b3 -> #385 -> #410
        # rollout. This is the #371 grading surface for "did the cycle take
        # vent_plus_heat_hold or heat_assist?".
        vpd_policy_reason_sql = """
            WITH bounds AS (
                SELECT
                    ($1::date::timestamp AT TIME ZONE 'America/Denver') AS start_ts,
                    (($1::date + 1)::timestamp AT TIME ZONE 'America/Denver') AS end_ts
            ),
            ordered AS (
                SELECT
                    l.ts,
                    l.climate_action,
                    l.priority_axis,
                    lag(l.climate_action) OVER (ORDER BY l.ts) AS prev_action,
                    CASE WHEN jsonb_typeof(
                             l.source_system_state -> 'climate_moisture_exchange'
                         ) = 'object'
                        THEN NULLIF(
                            l.source_system_state -> 'climate_moisture_exchange' ->> 'reason',
                            ''
                        )
                    END AS mx_reason
                FROM climate_action_log l
                CROSS JOIN bounds b
                WHERE l.greenhouse_id = $2
                  AND l.ts >= b.start_ts
                  AND l.ts < b.end_ts
            ),
            tagged AS (
                SELECT
                    *,
                    sum(CASE WHEN prev_action IS DISTINCT FROM climate_action THEN 1 ELSE 0 END)
                        OVER (ORDER BY ts ROWS UNBOUNDED PRECEDING) AS episode_id
                FROM ordered
            ),
            episodes AS (
                SELECT
                    episode_id,
                    climate_action,
                    count(*)::int AS sample_count,
                    bool_or(priority_axis = 'vpd') AS vpd_priority,
                    COALESCE(
                        mode() WITHIN GROUP (ORDER BY mx_reason),
                        'estimator_absent'
                    ) AS mx_reason
                FROM tagged
                GROUP BY episode_id, climate_action
            )
            SELECT
                mx_reason,
                count(*)::int AS episodes,
                COALESCE(sum(sample_count), 0)::int AS samples,
                count(*) FILTER (WHERE climate_action = 'DEHUM_VENT')::int
                    AS vent_dehum_episodes,
                count(*) FILTER (WHERE climate_action = 'HEAT' AND vpd_priority)::int
                    AS heat_dehum_episodes,
                count(*) FILTER (
                    WHERE climate_action IN (
                        'SEALED_HUMIDIFY',
                        'SEALED_FOG',
                        'VENT_COOL_MIST_ASSIST',
                        'VENT_COOL_FOG_ASSIST'
                    )
                )::int AS wetting_episodes
            FROM episodes
            GROUP BY mx_reason
            ORDER BY episodes DESC, mx_reason
            """

        # #387: the fetches above are mutually independent single-day reads.
        # They used to run as ~13 serial awaits (~27-30 s cold on prod, ~12 s
        # of it the duplicated phase scan); they now run concurrently,
        # grouped per connection so queries over the same base table share a
        # warm buffer cache. asyncpg connections cannot multiplex queries, so
        # the fan-out borrows from the small bounded module pool
        # (_kpi_fanout_pool_get) while the heaviest unit — the combined
        # solar-phase statement — runs on this call's own
        # connection. Response content is byte-identical to the serial
        # version; this is a latency-only change (see the PR #387 golden
        # equivalence runs for the warm-cache benchmark).
        async def _phase_task(c: asyncpg.Connection):
            # The solar-phase bucket rows, in the historical column order (visible in the response).
            return [dict(row) for row in await c.fetch(phase_sql, d, greenhouse_id)]

        async def _summary_resources_task(c: asyncpg.Connection):
            summary_row = await c.fetchrow(summary_sql, d, greenhouse_id)
            dli_row = await c.fetchrow(dli_sql, d, greenhouse_id)
            if dli_row:
                dli_evidence = DliEvidence.model_validate(dict(dli_row))
            else:
                validity_row = await c.fetchrow(dli_validity_sql, d, greenhouse_id)
                dli_evidence = DliEvidence.model_validate(dict(validity_row))
            water_resource_row = await c.fetchrow(water_sql, d, greenhouse_id)
            energy_resource_row = await c.fetchrow(energy_sql, d, greenhouse_id)
            return summary_row, dli_evidence, water_resource_row, energy_resource_row

        async def _equipment_task(c: asyncpg.Connection):
            cycle_rows = await c.fetch(cycles_snapshot_sql, d, greenhouse_id)
            cycle_read_path = "mv_equipment_runtime_daily"
            if _cycle_snapshot_is_stale(cycle_rows, d, today_local):
                # Completed in-window day the snapshot cannot serve — re-read
                # the live transition derivation rather than presenting stale
                # partial counts as completed-day truth. Bounded by the
                # statement fence: if the live view exceeds it, the tool fails
                # loud instead of lying.
                cycle_rows = await c.fetch(cycles_live_sql, d, greenhouse_id)
                cycle_read_path = "v_equipment_runtime_daily_stale_snapshot_fallback"
            dryout_rows = await c.fetch(dryout_sql, d, greenhouse_id)
            return cycle_rows, cycle_read_path, dryout_rows

        async def _dif_task(c: asyncpg.Connection):
            return await c.fetchrow(dif_sql, d, greenhouse_id)

        async def _action_log_task(c: asyncpg.Connection):
            action_rows = await _fetch_kpi_action_scorecard(c, actions_sql, d, greenhouse_id)
            moisture_rows = await c.fetch(moisture_sql, d, greenhouse_id)
            vpd_policy_row = await c.fetchrow(vpd_policy_sql, d, greenhouse_id)
            vpd_policy_reason_rows = await c.fetch(vpd_policy_reason_sql, d, greenhouse_id)
            return action_rows, moisture_rows, vpd_policy_row, vpd_policy_reason_rows

        pool = await _kpi_fanout_pool_get()

        async def _on_pool(task):
            async with pool.acquire() as pooled_conn:
                return await task(pooled_conn)

        # return_exceptions=True so every branch runs to completion (each is
        # bounded by the per-connection statement timeout) and no cancelled
        # sibling leaks a mid-flight query; the first failure is then
        # re-raised to keep the serial version's fail-loud behavior.
        results = await asyncio.gather(
            _phase_task(conn),
            _on_pool(_summary_resources_task),
            _on_pool(_equipment_task),
            _on_pool(_dif_task),
            _on_pool(_action_log_task),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, BaseException):
                raise result
        (
            phase_rows,
            (summary_row, dli_evidence, water_resource_row, energy_resource_row),
            (cycle_rows, cycle_read_path, dryout_rows),
            dif_row,
            (action_rows, moisture_rows, vpd_policy_row, vpd_policy_reason_rows),
        ) = results

        summary = dict(summary_row) if summary_row else {}
        water_resource = dict(water_resource_row) if water_resource_row else None
        energy_resource = dict(energy_resource_row) if energy_resource_row else None
        if energy_resource and isinstance(energy_resource.get("coefficient_revisions"), str):
            energy_resource["coefficient_revisions"] = json.loads(energy_resource["coefficient_revisions"])
        dif = dict(dif_row) if dif_row else {}

        moisture_sample_count = sum(row["decisions"] for row in moisture_rows)
        moisture_estimator = {
            "sample_count": moisture_sample_count,
            "coverage": "available" if moisture_sample_count else "pending_live_rows",
            "by_action_reason": [dict(row) for row in moisture_rows],
        }
        vpd_policy = dict(vpd_policy_row) if vpd_policy_row else {}
        if vpd_policy:
            vpd_policy["transition_window_min"] = 30
            vpd_policy["episodes_by_mx_reason"] = [dict(row) for row in vpd_policy_reason_rows]

        cycle_by_equipment = {row["equipment"]: dict(row) for row in cycle_rows}
        actuator_cycles = {
            equipment: cycle_by_equipment.get(equipment, {}).get("starts")
            for equipment in (
                "fan1",
                "fan2",
                "heat1",
                "heat2",
                "fog",
                "vent",
                "mister_south",
                "mister_west",
                "mister_center",
                "drip_wall",
                "drip_center",
                "drip_wall_fert",
                "drip_center_fert",
                "mister_south_fert",
                "mister_west_fert",
                "fert_master_valve",
                "grow_light_main",
                "grow_light_grow",
            )
        }
        light_cycle_values = [
            actuator_cycles[name]
            for name in ("grow_light_main", "grow_light_grow")
            if actuator_cycles[name] is not None
        ]
        actuator_cycles["grow_light"] = sum(light_cycle_values) if light_cycle_values else None

        actuator_runtime = {
            f"{equipment}_min": cycle_by_equipment.get(equipment, {}).get("on_minutes")
            for equipment in actuator_cycles
            if equipment != "grow_light"
        }
        light_runtime_values = [
            actuator_runtime[f"{name}_min"]
            for name in ("grow_light_main", "grow_light_grow")
            if actuator_runtime[f"{name}_min"] is not None
        ]
        actuator_runtime["grow_light_min"] = sum(light_runtime_values) if light_runtime_values else None
        for mister in ("mister_south", "mister_west", "mister_center"):
            minutes = actuator_runtime[f"{mister}_min"]
            actuator_runtime[f"{mister}_h"] = round(minutes / 60.0, 3) if minutes is not None else None

        dryout = [dict(row) for row in dryout_rows]
        cycle_quality = [
            {
                key: row[key]
                for key in (
                    "equipment",
                    "is_complete_day",
                    "start_state_known",
                    "open_at_end",
                    "is_deploy_gate_eligible",
                    "quality",
                    "quality_flags",
                    "cycles_under_1m",
                    "cycles_1m_to_5m",
                    "short_cycles_under_5m",
                    "cycles_5m_to_15m",
                    "cycles_15m_plus",
                    "open_pulses_at_cutoff",
                    "peak_transitions_per_hour",
                    "raw_event_rows",
                    "normalized_transition_count",
                    "same_timestamp_duplicate_rows",
                    "redundant_state_rows",
                    "conflicting_timestamp_count",
                )
            }
            for row in cycle_rows
        ]
        firmware_counter_diagnostics = {
            "semantics": (
                "Legacy firmware daily counters are diagnostic only; release "
                "comparisons use v_equipment_runtime_daily raw transitions."
            ),
            "cycles": {key.removeprefix("cycles_"): summary.get(key) for key in summary if key.startswith("cycles_")},
            "runtime": {
                key.removeprefix("runtime_"): summary.get(key) for key in summary if key.startswith("runtime_")
            },
        }
        cycle_day_status = _cycle_day_status(d, today_local)
        vpd_policy["cycle_source"] = {
            "authority": "v_equipment_runtime_daily",
            "read_path": cycle_read_path,
            "semantics": "raw equipment_state transition derivation",
            "all_rows_deploy_gate_eligible": bool(cycle_rows)
            and all(row["is_deploy_gate_eligible"] for row in cycle_rows),
            # #389: only completed local days participate in deploy-gate cycle
            # comparison; the current (partial) day's transition counts stay
            # readable — honest undercounts, never firmware-counter inflation —
            # but are excluded from gates, and future-dated targets carry no
            # evidence at all.
            "deploy_gate": {
                "eligible_days": "completed local days with is_deploy_gate_eligible rows only",
                "target_day_status": cycle_day_status,
                "excluded_from_deploy_gate": cycle_day_status != "complete"
                or not cycle_rows
                or not all(row["is_deploy_gate_eligible"] for row in cycle_rows),
            },
            "equipment": cycle_quality,
        }
        vpd_policy["firmware_counter_diagnostics"] = firmware_counter_diagnostics
        vpd_policy["realized_solar_night_dryout"] = project_realized_solar_night_dryout(dryout)
        pending_metrics = []
        if not moisture_sample_count:
            pending_metrics.append("moisture_estimator: source path wired; waiting for OTA/deploy/live rows")
        if cycle_day_status == "future_date_excluded":
            pending_metrics.append(
                "actuator_cycles_runtime: target date is future-dated; excluded from deploy-gate cycle comparison"
            )
        elif cycle_day_status == "partial_day_excluded":
            pending_metrics.append(
                "actuator_cycles_runtime: current local day is partial; counts are honest "
                "mid-day undercounts and excluded from deploy-gate cycle comparison"
            )
        elif not cycle_rows:
            pending_metrics.append("actuator_cycles_runtime: no transition-derived rows for date")
        elif any(not row["is_deploy_gate_eligible"] for row in cycle_rows):
            pending_metrics.append(
                "actuator_cycles_runtime: transition evidence is partial or quarantined; not deploy-gate eligible"
            )
        if not dryout:
            pending_metrics.append("solar_night_dryout: no eligible opportunity or admitted-action episodes for date")
        elif any(row["dryout_disposition"] != "effective" for row in dryout):
            pending_metrics.append(
                "solar_night_dryout: ineffective, blocked, or insufficient-evidence "
                "episodes remain unresolved; this is not a completed control fix"
            )
        try:
            actions = [OutcomeKpiActionRow.model_validate(dict(row)) for row in action_rows]
            response = OutcomeKpiResponse(
                date=summary.get("date", d),
                greenhouse_id=summary.get("greenhouse_id", greenhouse_id),
                semantics=(
                    "ADR-0004 outcome view: float inside the served house band and act at its edges. "
                    "The served band (band_house_* audit rows) is the only temperature/VPD basis. "
                    "Energy, water and cost are informational estimates, never a reward term; "
                    "planning water is climate wetting + wall irrigation + wall fertigation, and "
                    "house/hose water is reported separately as house_water."
                ),
                coverage=OutcomeKpiCoverage(
                    dli="unavailable",
                    actuator_cycles_runtime=(
                        "available"
                        if cycle_day_status == "complete"
                        and cycle_rows
                        and all(row["is_deploy_gate_eligible"] for row in cycle_rows)
                        else "unavailable"
                        if cycle_day_status == "future_date_excluded"
                        else "pending"
                    ),
                    moisture_estimator="available" if moisture_sample_count else "pending",
                    water_use=(
                        "available"
                        if water_resource and water_resource.get("available_for_scoring")
                        else "degraded"
                        if water_resource
                        else "unavailable"
                    ),
                    resource_accounting=(
                        "available"
                        if water_resource
                        and water_resource.get("available_for_scoring")
                        and energy_resource
                        and energy_resource.get("modeled_available_for_scoring")
                        else "degraded"
                        if water_resource or energy_resource
                        else "unavailable"
                    ),
                ),
                # The served house band (band_house_* rows, migration 290 grade) is the only basis.
                served_corridor={
                    "both_pct": summary.get("compliance_pct"),
                    "temp_pct": summary.get("temp_compliance_pct"),
                    "vpd_pct": summary.get("vpd_compliance_pct"),
                    "below_temp_h": summary.get("stress_hours_cold"),
                    "above_temp_h": summary.get("stress_hours_heat"),
                    "below_vpd_h": summary.get("stress_hours_vpd_low"),
                    "above_vpd_h": summary.get("stress_hours_vpd_high"),
                },
                vpd_misses_h={
                    "high_stress_h": summary.get("stress_hours_vpd_high"),
                    "low_stress_h": summary.get("stress_hours_vpd_low"),
                },
                actuator_cycles=actuator_cycles,
                actuator_runtime=actuator_runtime,
                water_use_gal={
                    # Planning water excludes house/hose use (#1623); house water is reported on every day.
                    "planning": (
                        water_resource.get("planning_water_gal")
                        if water_resource and water_resource.get("available_for_scoring")
                        else None
                    ),
                    "house_water": (water_resource.get("house_water_gal") if water_resource else None),
                    "quality_filtered_total": (
                        water_resource.get("quality_filtered_meter_gal")
                        if water_resource and water_resource.get("available_for_scoring")
                        else None
                    ),
                    "meter_attributed": (
                        water_resource.get("attributed_gal")
                        if water_resource and water_resource.get("available_for_scoring")
                        else None
                    ),
                    "ambiguous": (
                        water_resource.get("ambiguous_gal")
                        if water_resource and water_resource.get("available_for_scoring")
                        else None
                    ),
                    "manual_or_unattributed": (
                        water_resource.get("manual_or_unattributed_gal")
                        if water_resource and water_resource.get("available_for_scoring")
                        else None
                    ),
                },
                dli=dli_evidence,
                dif={
                    "day_night_temp_delta_f": dif.get("day_night_temp_delta_f"),
                    "day_temp_avg_f": dif.get("day_temp_avg_f"),
                    "night_temp_avg_f": dif.get("night_temp_avg_f"),
                    "day_sample_min": dif.get("day_sample_min"),
                    "night_sample_min": dif.get("night_sample_min"),
                },
                dew_margin={
                    "min_f": summary.get("min_dp_margin_f"),
                    "risk_h": summary.get("dp_risk_hours"),
                },
                energy_cost={
                    "runtime_modeled_kwh": (
                        energy_resource.get("kwh_estimated")
                        if energy_resource and energy_resource.get("modeled_available_for_scoring")
                        else None
                    ),
                    "partial_measured_kwh": (
                        energy_resource.get("measured_kwh")
                        if energy_resource and energy_resource.get("measured_available_for_scoring")
                        else None
                    ),
                    "electric_usd": (
                        summary.get("cost_electric")
                        if energy_resource and energy_resource.get("modeled_available_for_scoring")
                        else None
                    ),
                    "water_usd": (
                        summary.get("cost_water")
                        if water_resource and water_resource.get("available_for_scoring")
                        else None
                    ),
                    "total_usd": (
                        summary.get("cost_total")
                        if water_resource
                        and water_resource.get("available_for_scoring")
                        and energy_resource
                        and energy_resource.get("modeled_available_for_scoring")
                        else None
                    ),
                },
                resource_evidence={
                    "water": water_resource,
                    "energy": energy_resource,
                    "contract": (
                        "accepted meter gallons are conserved across attributed, ambiguous, "
                        "and manual_or_unattributed; command-only runs have null gallons; "
                        "runtime-modeled energy and partial Shelly energy are separate scopes"
                    ),
                },
                action_scorecard=actions,
                solar_phase_buckets=[dict(row) for row in phase_rows],
                moisture_estimator=moisture_estimator,
                vpd_policy=vpd_policy,
                pending_metrics=pending_metrics,
                source_tables=[
                    "daily_summary",
                    "mv_equipment_runtime_daily",
                    "v_equipment_runtime_daily",
                    "fn_realized_solar_night_dryout",
                    "fn_climate_action_daily_scorecard",
                    "v_water_attribution_daily",
                    "v_energy_estimate_reconciliation",
                    "v_resource_accounting_health",
                    "v_dli_daily",
                    "dli_validity_intervals",
                    "climate",
                    "climate_action_log",
                    "setpoint_snapshot",
                    "setpoint_changes",
                ],
            )
        except ValidationError as e:
            return _json(
                {
                    "error": "OutcomeKpiResponse validation failed",
                    "details": json.loads(e.json()),
                    "raw": {
                        "summary": summary,
                        "dif": dif,
                        "solar_phase_buckets": [dict(row) for row in phase_rows],
                        "action_scorecard": [dict(row) for row in action_rows],
                    },
                }
            )
        return response.model_dump_json()
    finally:
        await conn.close()


@mcp.tool()
async def equipment_state() -> str:
    """Get current state of all greenhouse equipment (relays, misters, heaters, fans, vent)."""
    conn = await _db()
    try:
        rows = await conn.fetch("""
            SELECT equipment, state, to_char(ts AT TIME ZONE 'America/Denver', 'HH24:MI:SS') as since
            FROM (SELECT DISTINCT ON (equipment) equipment, state, ts
                  FROM equipment_state ORDER BY equipment, ts DESC) sub
            WHERE equipment IN ('fan1','fan2','vent','fog','heat1','heat2',
                'mister_south','mister_west','mister_center')
            ORDER BY equipment
        """)
        validated = [EquipmentStateRow.model_validate(dict(r)).model_dump(mode="json") for r in rows]
        return json.dumps(validated)
    finally:
        await conn.close()


@mcp.tool()
async def forecast(hours: int = 72) -> str:
    """Get weather forecast summary for the next N hours (default 72).
    Returns hourly temp, RH, VPD, cloud cover, solar radiation."""
    try:
        hours = max(1, min(int(hours), 168))
    except (TypeError, ValueError):
        return json.dumps({"error": "hours must be an integer between 1 and 168"})
    conn = await _db()
    try:
        try:
            rows = await conn.fetch(
                """
            SELECT to_char(ts AT TIME ZONE 'America/Denver', 'Dy HH24:MI') as time,
                   round(temp_f::numeric,0) as temp, round(rh_pct::numeric,0) as rh,
                   round(vpd_kpa::numeric,2) as vpd, round(cloud_cover_pct::numeric,0) as cloud,
                   round(GREATEST(COALESCE(direct_radiation_w_m2,0),0)::numeric,0) as solar
            FROM (
                SELECT DISTINCT ON (ts) ts, temp_f, rh_pct, vpd_kpa, cloud_cover_pct,
                       direct_radiation_w_m2
                FROM weather_forecast
                WHERE ts > now() AND ts < now() + ($1::int * interval '1 hour')
                ORDER BY ts, fetched_at DESC
            ) sub
            ORDER BY ts
            LIMIT $1
                """,
                hours,
            )
        except asyncpg.QueryCanceledError:
            return _json(
                {
                    "availability": "unavailable",
                    "reason": "db_statement_timeout",
                    "query_budget_ms": MCP_DB_STATEMENT_TIMEOUT_MS,
                    "guidance": "Do not infer benign weather from an unavailable forecast.",
                }
            )
        validated = [ForecastSummaryRow.model_validate(dict(r)).model_dump(mode="json") for r in rows]
        return json.dumps(validated)
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# SETPOINT TOOLS
# ═══════════════════════════════════════════════════════════════


_SERVED_BAND_PARAMETERS = ("temp_low", "temp_high", "vpd_low", "vpd_high", "temp_target", "vpd_target")


@mcp.tool()
async def get_setpoints() -> str:
    """Get all current active setpoints: the served band now (source band) and each other setting's newest value."""
    conn = await _db()
    try:
        # The band has one source, fn_band_setpoints (RULINGS AF2): the settings ledger's band rows are not it.
        rows = await conn.fetch(
            """
            WITH band AS (
                SELECT p.parameter, p.value, 'band'::text AS source, now() AS ts
                  FROM fn_band_setpoints(now()) b,
                       LATERAL (VALUES ('temp_low', b.temp_low), ('temp_high', b.temp_high),
                                       ('vpd_low', b.vpd_low), ('vpd_high', b.vpd_high),
                                       ('temp_target', b.temp_target), ('vpd_target', b.vpd_target)) p(parameter, value)
            ), ledger AS (
                SELECT DISTINCT ON (parameter) parameter, value, source, ts
                  FROM setpoint_changes
                 WHERE parameter <> ALL($2::text[])
                 ORDER BY parameter, ts DESC
            )
            SELECT parameter, round(value::numeric,3) as value, source,
                   to_char(ts AT TIME ZONE 'America/Denver', 'HH24:MI') as updated
            FROM (SELECT * FROM band WHERE value IS NOT NULL UNION ALL SELECT * FROM ledger) sub
            WHERE parameter = ANY($1::text[])
            ORDER BY parameter
            """,
            sorted(ALL_TUNABLES),
            list(_SERVED_BAND_PARAMETERS),
        )
        validated = [SetpointSummary.model_validate(dict(r)).model_dump(mode="json") for r in rows]
        return json.dumps(validated)
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# REVIEW REQUEST AND MEMORY
# ═══════════════════════════════════════════════════════════════


_DENVER_TZ = ZoneInfo("America/Denver")


@mcp.tool()
async def review_run(
    review_date: Annotated[
        str,
        Field(description="America/Denver day to review, YYYY-MM-DD; default yesterday. Today or earlier."),
    ] = "",
):
    """Request a manual review (the manual trigger). The ingestor delivers it to Iris within a minute; Iris reads
    the record of that day and writes one review with review_write. Returns the review's run_id."""
    from verdify_schemas.review import ReviewRequested

    caller = current_actor()
    if caller is None:
        return _tool_problem(problem("forbidden", "A review request needs a resolved caller"))
    today = datetime.now(_DENVER_TZ).date()
    if review_date:
        try:
            day = date.fromisoformat(review_date)
        except ValueError:
            return _tool_problem(problem("invalid_request", "review_date must be YYYY-MM-DD", field="review_date"))
        if day > today:
            return _tool_problem(problem("invalid_request", "review_date is in the future", field="review_date"))
    else:
        day = today - timedelta(days=1)
    run_id = str(uuid4())
    conn = await _db()
    try:
        await conn.execute(
            "INSERT INTO planner_review (run_id, kind, review_date, requested_by) VALUES ($1::uuid, 'manual', $2, $3)",
            run_id,
            day,
            caller.source,
        )
    finally:
        await conn.close()
    return _tool_ok(ReviewRequested(run_id=run_id, review_date=day))


@mcp.tool()
async def lessons() -> str:
    """Get active planner lessons (accumulated operational knowledge)."""
    conn = await _db()
    try:
        rows = await conn.fetch("""
            SELECT category, condition, lesson, confidence, times_validated
            FROM planner_lessons WHERE is_active = true AND superseded_by IS NULL
            ORDER BY CASE confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                     times_validated DESC
            LIMIT 10
        """)
        validated = [LessonSummary.model_validate(dict(r)).model_dump(mode="json") for r in rows]
        return json.dumps(validated)
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# DATA QUERY TOOL
# ═══════════════════════════════════════════════════════════════


@mcp.tool()
async def query(sql: str) -> str:
    """Run a read-only SQL query against the Verdify database.
    Returns up to 100 rows as JSON. Only SELECT queries allowed."""
    sql_stripped = sql.strip()
    sql_upper = sql_stripped.upper()
    if not (sql_upper.startswith("SELECT") or sql_upper.startswith("WITH")):
        return json.dumps({"error": "Only SELECT/WITH queries are allowed"})
    # Keep this as a simple one-statement diagnostic path. The DB transaction is
    # read-only below, but rejecting multi-statement text avoids surprising
    # behavior and keeps tool output bounded.
    if ";" in sql_stripped.rstrip(";"):
        return json.dumps({"error": "Only a single read-only statement is allowed"})

    conn = await _db()
    try:
        async with conn.transaction(readonly=True):
            await conn.execute("SET LOCAL statement_timeout = '5s'")
            rows = await conn.fetch(sql_stripped.rstrip(";"))
        return _json([dict(r) for r in rows[:100]])
    except asyncpg.ReadOnlySQLTransactionError:
        return json.dumps({"error": "Query attempted a write and was rejected by the read-only transaction"})
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# REVIEW TOOL (climate refactor 5.1: the planner is a daily reviewer)
# ═══════════════════════════════════════════════════════════════


@mcp.tool()
async def review_write(
    trigger_id: Annotated[str, Field(description="The review's run id, from the audit header of the wake-up")],
    summary: Annotated[str, Field(min_length=1, max_length=4000, description="The review, plain text")],
    band_proposal: Annotated[
        dict[str, Any] | None,
        Field(
            description=(
                "Optional band edit proposal: {anchors: {band row: value}, price: the price-list rows you quote, "
                "reason}. A proposal only: the owner applies it in the band editor or does not."
            )
        ),
    ] = None,
):
    """Store the review for this wake-up (once). It writes no setting, no band and no plan."""
    from verdify_schemas.review import ReviewWrite, ReviewWritten

    if current_actor() is None:
        return _tool_problem(problem("forbidden", "A review needs a resolved caller"))
    try:
        run_id = str(UUID(trigger_id))
    except (TypeError, ValueError):
        return _tool_problem(problem("invalid_request", "trigger_id must be the review's run id", field="trigger_id"))
    try:
        review = ReviewWrite.model_validate({"summary": summary, "band_proposal": band_proposal})
    except ValidationError as exc:
        first = exc.errors()[0]
        return _tool_problem(problem("invalid_request", str(first.get("msg"))[:300], field="band_proposal"))
    proposal = review.band_proposal.model_dump(mode="json") if review.band_proposal else None
    conn = await _db()
    try:
        row = await conn.fetchrow(
            """
            UPDATE planner_review
               SET status = 'written', written_at = now(), summary = $2, band_proposal = $3::jsonb
             WHERE run_id = $1::uuid AND status IN ('requested', 'delivered') AND written_at IS NULL
            RETURNING kind, review_date
            """,
            run_id,
            review.summary,
            json.dumps(proposal) if proposal is not None else None,
        )
    finally:
        await conn.close()
    if row is None:
        return _tool_problem(problem("not_found", "No open review has this run id (already written or unknown)"))
    return _tool_ok(ReviewWritten(run_id=run_id, kind=row["kind"], review_date=row["review_date"]))


# ═══════════════════════════════════════════════════════════════
# HISTORY TOOL
# ═══════════════════════════════════════════════════════════════


@mcp.tool()
async def history(metric: str = "climate", hours: int = 24, resolution_min: int = 15) -> str:
    """Get historical time-bucketed data for any sensor domain.
    metric: 'climate' (temp, vpd, rh, dew_point), 'equipment' (relay state durations),
            'energy' (power watts), 'outdoor' (weather station), 'diagnostics' (ESP32 health)
    hours: lookback window (default 24)
    resolution_min: bucket size in minutes (default 15)
    Returns JSON array of time-bucketed records."""
    queries = {
        "climate": """
            SELECT time_bucket($1::interval, ts) AS time,
                   round(avg(temp_avg)::numeric, 1) AS temp_f,
                   round(avg(vpd_avg)::numeric, 2) AS vpd_kpa,
                   round(avg(rh_avg)::numeric, 0) AS rh_pct,
                   round(avg(dew_point)::numeric, 1) AS dew_point_f,
                   round(avg(outdoor_temp_f)::numeric, 1) AS outdoor_temp,
                   round(avg(outdoor_rh_pct)::numeric, 0) AS outdoor_rh
            FROM climate WHERE ts > now() - $2::interval AND temp_avg IS NOT NULL
            GROUP BY 1 ORDER BY 1""",
        "energy": """
            SELECT time_bucket($1::interval, ts) AS time,
                   round(avg(watts_total)::numeric, 0) AS watts
            FROM energy WHERE ts > now() - $2::interval
            GROUP BY 1 ORDER BY 1""",
        "outdoor": """
            SELECT time_bucket($1::interval, ts) AS time,
                   round(avg(outdoor_temp_f)::numeric, 1) AS temp_f,
                   round(avg(outdoor_rh_pct)::numeric, 0) AS rh_pct,
                   round(avg(solar_irradiance_w_m2)::numeric, 0) AS solar_w
            FROM climate WHERE ts > now() - $2::interval AND outdoor_temp_f IS NOT NULL
            GROUP BY 1 ORDER BY 1""",
        "equipment": """
            SELECT time_bucket($1::interval, e.ts) AS time,
                   e.equipment,
                   round(sum(CASE WHEN e.state THEN 1.0 ELSE 0.0 END) / count(*)::numeric * 100, 0) AS on_pct
            FROM equipment_state e
            WHERE e.ts > now() - $2::interval
              AND e.equipment IN ('fan1','fan2','vent','fog','heat1','heat2','mister_south','mister_west','mister_center')
            GROUP BY 1, 2 ORDER BY 1, 2""",
        "diagnostics": """
            SELECT time_bucket($1::interval, ts) AS time,
                   round(avg(wifi_rssi)::numeric, 0) AS wifi_rssi,
                   round(avg(heap_bytes)::numeric, 0) AS heap_bytes,
                   round(max(uptime_s)::numeric, 0) AS uptime_s
            FROM diagnostics WHERE ts > now() - $2::interval
            GROUP BY 1 ORDER BY 1""",
    }

    template = queries.get(metric)
    if not template:
        return json.dumps({"error": f"Unknown metric '{metric}'. Use: {', '.join(queries.keys())}"})

    # Inline interval values (asyncpg needs timedelta for interval params)
    sql = template.replace("$1::interval", f"'{resolution_min} minutes'::interval").replace(
        "$2::interval", f"'{hours} hours'::interval"
    )

    conn = await _db()
    try:
        rows = await conn.fetch(sql)
        return _json([dict(r) for r in rows[:500]])
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# CROP MANAGEMENT TOOLS
# ═══════════════════════════════════════════════════════════════


def _crops_legacy_write_refusal() -> str | None:
    """Iris stays read-only on plantings (#1328): its crops create and deactivate are refused."""
    caller = current_actor()
    if caller is None or caller.source == "iris":
        return json.dumps(
            {
                "error": "Iris does not record plantings; a person (dashboard Crops) or a named agent does (record_planting)"
            }
        )
    return None


async def _crops_legacy_write(write) -> str:
    """The crops tool's create and deactivate through verdify_services.crops, answered in the tool's old JSON
    style: the planting, or {"error", "problem"}."""
    caller = current_actor()
    actor = ServiceActor(source=caller.source, name=caller.name)
    conn = await _db()
    try:
        result = await write(conn, actor)
    except ServiceError as refused:
        return json.dumps({"error": refused.problem.detail, "problem": refused.problem.body()})
    finally:
        await conn.close()
    return json.dumps(result.value.model_dump(mode="json"))


@mcp.tool()
async def crops(action: str, crop_id: int = 0, data: str = "") -> str:
    """Manage greenhouse crops. Actions: list, get, create, update, deactivate.
    list: all active crops with zone, stage, recent health
    get: full detail for one crop including its nutrient recipe(s), observations,
         and events. For the Vanda (crop_id 5) this surfaces `vanda_orchid_active`
         (MSU 13-3-15, 50 ppm N, ec 0.40 ABSOLUTE on RO; is_active=FALSE until the
         operator confirms it). Dose to target_ec — NOT 2-part A/B ml/L math (SAF-2).
    create: data = {"name", "variety", "zone", "position", "planted_date", "stage", ...}
    update: data = {"name"?, "stage"?, "zone"?, "expected_harvest"?, "notes"?, ...}
    deactivate: soft-delete by crop_id"""
    d = json.loads(data) if data else {}
    conn = await _db()
    try:
        if action == "list":
            rows = await conn.fetch("""
                SELECT c.id, c.name, c.variety, c.zone, c.position, c.stage, c.planted_date,
                       c.expected_harvest, c.is_active,
                       (SELECT round(avg(health_score)::numeric, 2) FROM observations o
                        WHERE o.crop_id = c.id AND o.health_score IS NOT NULL
                        AND o.ts > now() - interval '7 days') AS health_7d
                FROM crops c WHERE c.is_active = true AND c.greenhouse_id = 'vallery'
                ORDER BY c.zone, c.position""")
            return _json([dict(r) for r in rows])

        elif action == "get" and crop_id:
            row = await conn.fetchrow("SELECT * FROM crops WHERE id = $1", crop_id)
            if not row:
                return json.dumps({"error": f"Crop {crop_id} not found"})
            obs = await conn.fetch(
                "SELECT ts, obs_type, notes, health_score FROM observations WHERE crop_id = $1 ORDER BY ts DESC LIMIT 10",
                crop_id,
            )
            events = await conn.fetch(
                "SELECT ts, event_type, old_stage, new_stage, notes FROM crop_events WHERE crop_id = $1 ORDER BY ts DESC LIMIT 10",
                crop_id,
            )
            # N1 (FRT-1): surface this crop's nutrient recipe(s) so the planner can
            # reason about feed without blind A/B dose math. For the Vanda (crop_id 5)
            # this exposes `vanda_orchid_active` (MSU 13-3-15, 50 ppm N, ec 0.40
            # ABSOLUTE on RO). The recipe ships is_active=FALSE until the operator
            # confirms it physically — `is_active` tells the planner whether the feed
            # is live or provisional; the notes carry the SAF-2 dosing guardrails
            # (single-salt, dose-to-EC not A/B ml/L, AM-only, absorption hold).
            recipes = await conn.fetch(
                """SELECT name, stage, is_active, target_ec, target_ph_low, target_ph_high,
                          n_ppm, p_ppm, k_ppm, ca_ppm, mg_ppm, fe_ppm,
                          stock_a_ml_per_l, stock_b_ml_per_l, notes
                     FROM nutrient_recipes WHERE crop_id = $1 ORDER BY is_active DESC, name""",
                crop_id,
            )
            return _json(
                {
                    "crop": dict(row),
                    "nutrient_recipes": [dict(r) for r in recipes],
                    "recent_observations": [dict(o) for o in obs],
                    "recent_events": [dict(e) for e in events],
                }
            )

        elif action == "create":
            # #1328: create goes through the planting service (record_planting), so a planting always occupies its
            # place and is attributed; the old INSERT dropped position_id and left the row nowhere.
            try:
                payload = CropCreate.model_validate(d)
            except ValidationError as e:
                return json.dumps({"error": "CropCreate validation failed", "details": json.loads(e.json())})
            refused = _crops_legacy_write_refusal()
            if refused:
                return refused
            control = sorted(
                name
                for name in ("target_dli", "target_vpd_low", "target_vpd_high", "base_temp_f")
                if name in payload.model_fields_set
            )
            if control:
                return json.dumps(
                    {
                        "error": "Plantings are records only; these fields set control targets and are not taken here",
                        "fields": control,
                    }
                )
            place = payload.position_label or payload.position
            if payload.position_id is not None:
                place = await conn.fetchval("SELECT label FROM positions WHERE id = $1", payload.position_id) or place
            body = {
                "crop": payload.crop_catalog_slug or payload.name,
                "variety": payload.variety,
                "positions": [place],
                "count": payload.count,
                "planted_at": payload.planted_date.isoformat(),
                "stage": payload.stage,
                "notes": payload.notes,
            }
            return await _crops_legacy_write(lambda c, actor: crop_service.plant(c, actor, body))

        elif action == "update" and crop_id:
            try:
                patch = CropUpdate.model_validate(d)
            except ValidationError as e:
                return json.dumps({"error": "CropUpdate validation failed", "details": json.loads(e.json())})
            set_fields = patch.model_dump(exclude_unset=True)
            if not set_fields:
                return json.dumps({"error": "No fields to update"})
            moving = sorted(set(set_fields) & {"zone", "position", "position_id", "zone_id"})
            if moving:
                return json.dumps(
                    {
                        "error": "A planting's place changes with move_planting, which keeps its history",
                        "fields": moving,
                    }
                )
            sets = [f"{k} = ${i}" for i, k in enumerate(set_fields, start=2)]
            sets.append("updated_at = now()")
            vals = [crop_id, *set_fields.values()]
            row = await conn.fetchrow(f"UPDATE crops SET {', '.join(sets)} WHERE id = $1 RETURNING *", *vals)
            return _json(dict(row)) if row else json.dumps({"error": "Crop not found"})

        elif action == "deactivate" and crop_id:
            # #1328: ends the planting through the service, so its places close and it is attributed.
            refused = _crops_legacy_write_refusal()
            if refused:
                return refused
            body = {"end_reason": "removed", "reason": d.get("reason")}
            return await _crops_legacy_write(lambda c, actor: crop_service.end(c, actor, crop_id, body))

        return json.dumps({"error": f"Unknown action '{action}'. Use: list, get, create, update, deactivate"})
    finally:
        await conn.close()


@mcp.tool()
async def observations(action: str, crop_id: int = 0, data: str = "") -> str:
    """Record and query crop observations, events, harvests, and treatments.
    Actions: list_observations, record_observation, list_events, record_event,
             record_harvest, list_harvests, record_treatment, list_treatments.
    data: JSON with fields appropriate to the action. Envelopes:
      record_observation -> ObservationCreate (obs_type, notes, severity, ...)
      record_event       -> EventCreate (event_type, old_stage, new_stage, ...)
      record_harvest     -> HarvestCreate (weight_kg, unit_count, quality_grade,
                            zone, destination, unit_price, revenue, operator, notes)
      record_treatment   -> TreatmentCreate (product, active_ingredient,
                            concentration, rate, rate_unit, method, zone,
                            target_pest, phi_days, rei_hours, applicator,
                            observation_id, followup_due_at,
                            followup_completed_at, outcome, notes)"""
    d = json.loads(data) if data else {}
    conn = await _db()
    try:
        if action == "list_observations":
            rows = await conn.fetch(
                """
                SELECT o.id, o.ts, o.greenhouse_id, o.crop_id, c.name,
                       o.position_id, o.zone_id, o.zone, o.position, o.obs_type,
                       o.notes, o.health_score, o.severity, o.observer
                FROM observations o
                JOIN crops c ON o.crop_id = c.id AND c.greenhouse_id = 'vallery'
                WHERE o.greenhouse_id = 'vallery'
                  AND ($1::int = 0 OR o.crop_id = $1)
                ORDER BY o.ts DESC LIMIT 50""",
                crop_id,
            )
            return _json([dict(r) for r in rows])

        elif action == "record_observation" and crop_id:
            crop = await conn.fetchrow(
                "SELECT zone, position, zone_id, position_id FROM crops WHERE id = $1 AND greenhouse_id = 'vallery'",
                crop_id,
            )
            if not crop:
                return json.dumps({"error": f"Crop {crop_id} not found"})
            try:
                obs = ObservationCreate.model_validate({**d, "observer": d.get("observer") or "Iris"})
            except ValidationError as e:
                return json.dumps({"error": "ObservationCreate validation failed", "details": json.loads(e.json())})
            row = await conn.fetchrow(
                """
                INSERT INTO observations (
                    crop_id, greenhouse_id, zone, position, zone_id, position_id, obs_type, notes, severity,
                    observer, health_score, species, count, affected_pct, photo_path,
                    plant_height_cm, leaf_count, canopy_cover_pct, flowering_count,
                    fruit_count, root_condition, mortality_count, stress_tags, source
                )
                VALUES (
                    $1, 'vallery', $2, $3, $4, $5, $6, $7, $8,
                    $9, $10, $11, $12, $13, $14,
                    $15, $16, $17, $18, $19, $20, $21, $22, 'iris'
                ) RETURNING *""",
                crop_id,
                obs.zone or crop["zone"],
                obs.position or crop["position"],
                crop["zone_id"],
                crop["position_id"],
                obs.obs_type,
                obs.notes,
                obs.severity,
                obs.observer,
                obs.health_score,
                obs.species,
                obs.count,
                obs.affected_pct,
                obs.photo_path,
                obs.plant_height_cm,
                obs.leaf_count,
                obs.canopy_cover_pct,
                obs.flowering_count,
                obs.fruit_count,
                obs.root_condition,
                obs.mortality_count,
                obs.stress_tags,
            )
            return _json(dict(row))

        elif action == "list_events":
            rows = await conn.fetch(
                """
                SELECT e.id, e.ts, e.greenhouse_id, e.crop_id, c.name,
                       e.position_id, e.event_type, e.old_stage, e.new_stage,
                       e.count, e.operator, e.source, e.notes
                FROM crop_events e
                JOIN crops c ON e.crop_id = c.id AND c.greenhouse_id = 'vallery'
                WHERE e.greenhouse_id = 'vallery'
                  AND ($1::int = 0 OR e.crop_id = $1)
                ORDER BY e.ts DESC LIMIT 50""",
                crop_id,
            )
            return _json([dict(r) for r in rows])

        elif action == "record_event" and crop_id:
            crop = await conn.fetchrow(
                "SELECT position_id FROM crops WHERE id = $1 AND greenhouse_id = 'vallery'",
                crop_id,
            )
            if not crop:
                return json.dumps({"error": f"Crop {crop_id} not found"})
            try:
                ev = EventCreate.model_validate({**d, "operator": d.get("operator") or "Iris"})
            except ValidationError as e:
                return json.dumps({"error": "EventCreate validation failed", "details": json.loads(e.json())})
            row = await conn.fetchrow(
                """
                INSERT INTO crop_events (
                    crop_id, greenhouse_id, position_id, event_type, old_stage,
                    new_stage, count, operator, source, notes
                )
                VALUES ($1, 'vallery', $2, $3, $4, $5, $6, $7, 'iris', $8) RETURNING *""",
                crop_id,
                crop["position_id"],
                ev.event_type,
                ev.old_stage,
                ev.new_stage,
                ev.count,
                ev.operator,
                ev.notes,
            )
            return _json(dict(row))

        elif action == "record_harvest" and crop_id:
            crop = await conn.fetchrow(
                "SELECT zone, position_id FROM crops WHERE id = $1 AND greenhouse_id = 'vallery'",
                crop_id,
            )
            if not crop:
                return json.dumps({"error": f"Crop {crop_id} not found"})
            try:
                hv = HarvestCreate.model_validate({**d, "operator": d.get("operator") or "Iris"})
            except ValidationError as e:
                return json.dumps({"error": "HarvestCreate validation failed", "details": json.loads(e.json())})
            row = await conn.fetchrow(
                """
                INSERT INTO harvests (
                    crop_id, weight_kg, unit_count, quality_grade,
                    salable_weight_kg, cull_weight_kg, cull_reason, quality_reason,
                    zone, destination, unit_price, revenue, labor_minutes, operator,
                    position_id, greenhouse_id, notes
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'vallery', $16)
                RETURNING *""",
                crop_id,
                hv.weight_kg,
                hv.unit_count,
                hv.quality_grade,
                hv.salable_weight_kg,
                hv.cull_weight_kg,
                hv.cull_reason,
                hv.quality_reason,
                hv.zone or crop["zone"],
                hv.destination,
                hv.unit_price,
                hv.revenue,
                hv.labor_minutes,
                hv.operator,
                crop["position_id"],
                hv.notes,
            )
            return _json(dict(row))

        elif action == "list_harvests":
            rows = await conn.fetch(
                """
                SELECT h.id, h.ts, h.greenhouse_id, h.crop_id, c.name, h.position_id,
                       h.weight_kg, h.unit_count, h.quality_grade,
                       h.salable_weight_kg, h.cull_weight_kg, h.cull_reason,
                       h.quality_reason, h.zone, h.destination, h.unit_price,
                       h.revenue, h.labor_minutes, h.operator, h.notes
                FROM harvests h JOIN crops c ON h.crop_id = c.id
                WHERE h.greenhouse_id = 'vallery'
                  AND c.greenhouse_id = 'vallery'
                  AND ($1::int = 0 OR h.crop_id = $1)
                ORDER BY h.ts DESC LIMIT 50""",
                crop_id,
            )
            return _json([dict(r) for r in rows])

        elif action == "record_treatment" and crop_id:
            crop = await conn.fetchrow(
                "SELECT zone, position_id FROM crops WHERE id = $1 AND greenhouse_id = 'vallery'",
                crop_id,
            )
            if not crop:
                return json.dumps({"error": f"Crop {crop_id} not found"})
            try:
                tr = TreatmentCreate.model_validate({**d, "applicator": d.get("applicator") or "Iris"})
            except ValidationError as e:
                return json.dumps({"error": "TreatmentCreate validation failed", "details": json.loads(e.json())})
            row = await conn.fetchrow(
                """
                INSERT INTO treatments (
                    crop_id, product, active_ingredient, concentration, rate, rate_unit,
                    method, zone, target_pest, phi_days, rei_hours, applicator,
                    observation_id, position_id, greenhouse_id, followup_due_at,
                    followup_completed_at, outcome, notes
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'vallery', $15, $16, $17, $18)
                RETURNING *""",
                crop_id,
                tr.product,
                tr.active_ingredient,
                tr.concentration,
                tr.rate,
                tr.rate_unit,
                tr.method,
                tr.zone or crop["zone"],
                tr.target_pest,
                tr.phi_days,
                tr.rei_hours,
                tr.applicator,
                tr.observation_id,
                crop["position_id"],
                tr.followup_due_at,
                tr.followup_completed_at,
                tr.outcome,
                tr.notes,
            )
            return _json(dict(row))

        elif action == "list_treatments":
            rows = await conn.fetch(
                """
                SELECT t.id, t.ts, t.greenhouse_id, t.crop_id, c.name, t.position_id,
                       t.product, t.active_ingredient, t.concentration, t.rate,
                       t.rate_unit, t.method, t.zone, t.target_pest, t.phi_days,
                       t.rei_hours, t.applicator, t.observation_id,
                       t.followup_due_at, t.followup_completed_at, t.outcome,
                       t.notes
                FROM treatments t JOIN crops c ON t.crop_id = c.id
                WHERE t.greenhouse_id = 'vallery'
                  AND c.greenhouse_id = 'vallery'
                  AND ($1::int = 0 OR t.crop_id = $1)
                ORDER BY t.ts DESC LIMIT 50""",
                crop_id,
            )
            return _json([dict(r) for r in rows])

        return json.dumps({"error": f"Unknown action '{action}'"})
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# ALERT MANAGEMENT
# ═══════════════════════════════════════════════════════════════


def _alert_row(alert: alerts_service.Alert) -> dict[str, Any]:
    """A merged alert in the tool's row shape. ``acknowledged`` is false exactly while the merged status is open
    (a resolved row needs no acknowledgement), so the unacknowledged rows equal ``alerts.open_count()``."""
    seen = alert.last_seen_at or alert.first_seen_at
    return {
        "id": alert.id,
        "time": seen.astimezone(ZoneInfo("America/Denver")).strftime("%m-%d %H:%M"),
        "alert_type": alert.alert_type,
        "severity": alert.severity,
        "message": alert.message,
        "disposition": alert.status,
        "acknowledged": alert.status != "open",
        "resolved": alert.status == "resolved",
        "count": alert.count,
    }


async def _recent_alert_rows(conn: asyncpg.Connection) -> list[dict[str, Any]]:
    """Every page of ``alerts.list(status="recent")``: every open alert plus the last 24 h of resolved ones."""
    rows: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        page = await alerts_service.list(conn, status="recent", limit=alerts_service.LIMIT_MAX, cursor=cursor)
        rows.extend(_alert_row(alert) for alert in page.items)
        cursor = page.next_cursor
        if cursor is None:
            return rows


def _alert_refusal(alert_id: int, refused: ServiceError) -> str:
    if refused.problem.code == "unknown_target":
        return json.dumps({"error": f"alert_id {alert_id} not found"})
    return json.dumps({"error": refused.problem.detail})


@mcp.tool()
async def alerts(action: str = "list", alert_id: int = 0, data: str = "") -> str:
    """Manage greenhouse alerts. Actions: list, acknowledge, resolve.
    list: every open alert plus those resolved in the last 24 h, repeats merged into one row with their count;
    disposition is the merged status and the unacknowledged rows are the open-alert count
    acknowledge: mark every repeat as seen
    resolve: close every repeat with resolution notes (data can be JSON or plain text)
    acknowledge and resolve are recorded as the calling credential (iris,
    agent:<name> or agent:admin); acknowledged_by and resolved_by in data are ignored."""
    d: dict[str, Any] = {}
    if data:
        try:
            parsed = json.loads(data)
        except ValueError:
            parsed = None
        d = parsed if isinstance(parsed, dict) else {"resolution": data}
    conn = await _db()
    try:
        if action == "list":
            return _json(await _recent_alert_rows(conn))

        elif action == "acknowledge" and alert_id:
            # VD-59: the actor comes only from the request, never from data.
            actor = _service_actor()
            if actor is None:
                return json.dumps({"error": "forbidden: no resolved caller"})
            try:
                acknowledged = await alerts_service.ack(conn, actor, alert_id, None, None)
            except ServiceError as refused:
                return _alert_refusal(alert_id, refused)
            # ack touches only rows with resolved_at IS NULL: a resolved row's merged row reads resolved.
            done = "already_resolved" if acknowledged.value.status == "resolved" else "acknowledged"
            return json.dumps({"ok": True, "alert_id": alert_id, "action": done})

        elif action == "resolve" and alert_id:
            # alert_log.id is an integer, so an id beyond it is simply unknown, as the service answers.
            dependency = (
                await conn.fetchrow("SELECT alert_type, source FROM alert_log WHERE id=$1", alert_id)
                if abs(alert_id) < 2**31
                else None
            )
            if (
                dependency
                and dependency["alert_type"] == "planner_tool_dependency_failed"
                and dependency["source"] == "mcp"
            ):
                return json.dumps(
                    {"error": "semantic dependency alerts resolve only after successful same-tool retrieval"}
                )
            # VD-59: after the retrieval check, so a semantic dependency alert
            # keeps its own refusal; the actor never comes from data.
            actor = _service_actor()
            if actor is None:
                return json.dumps({"error": "forbidden: no resolved caller"})
            default_resolution = "Resolved by Iris" if actor.source == "iris" else f"Resolved by {actor.source}"
            try:
                res = AlertResolvePayload.model_validate(
                    {
                        "resolved_by": actor.source,
                        "resolution": d.get("resolution") or default_resolution,
                    }
                )
            except ValidationError as e:
                return json.dumps({"error": "AlertResolvePayload validation failed", "details": json.loads(e.json())})
            try:
                await alerts_service.resolve(conn, actor, alert_id, res.resolution, None)
            except ServiceError as refused:
                return _alert_refusal(alert_id, refused)
            return json.dumps({"ok": True, "alert_id": alert_id, "action": "resolved"})

        return json.dumps({"error": f"Unknown action '{action}'. Use: list, acknowledge, resolve"})
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# SETTINGS AND ACTIVITY (architecture §5.6)
# ═══════════════════════════════════════════════════════════════


@mcp.tool()
@_answers_problems
async def set_setting(
    param: Annotated[str, Field(description="The setting's registry name, as the settings tool lists it.")],
    value: Annotated[
        float | None, Field(description="The value to store, in the setting's unit. Omit it with release=true.")
    ] = None,
    release: Annotated[bool, Field(description="True, with no value: release the setting to its default.")] = False,
    manual: Annotated[bool, Field(description="Hold the value manual. Stored as passed.")] = False,
    reason: Annotated[str | None, Field(description="Why, at most 500 characters.")] = None,
    request_id: Annotated[
        str | None, Field(description="A UUID you generate; a retry with the same one and payload changes nothing.")
    ] = None,
    trigger_id: Annotated[
        str | None, Field(description="Optional review run id (UUID), kept only in the activity log.")
    ] = None,
    planner_instance: Annotated[
        Literal["local", "opus"] | None, Field(description="Optional planner instance, kept only in the activity log.")
    ] = None,
):
    """Change an operator switch within the registry, or release it. Any other setting is refused (`forbidden`).

    REST twins: API-10 `PUT /v1/settings/{param}` (a write: pass value) and API-11
    `DELETE /v1/settings/{param}` (a release: release=true and no value). Any other combination is
    `invalid_request`. The change reaches the controller through the dispatcher's next pass.

    manual defaults to false here; a write stores the flag it carries, so writing a manual setting without
    manual=true clears it (manual_before and the activity log say so).

    Returns the API-10 DesiredSetting: the snapped value, snapped_from when snapping changed it, manual,
    manual_before and state `requested`. The same request_id and payload return the stored JSON with a top-level
    replayed: true and append nothing.

    Refusals are Problem JSON with isError: `unknown_target`; `read_only` with the reason; `out_of_range` with min,
    max and current; `manual` when Iris writes or releases a setting whose newest row is manual (a person's value
    stays; other agents' writes win); `request_id_reused` when the same request_id carries another payload;
    `invalid_request` when request_id or trigger_id is not a UUID; `forbidden` when the call has no resolved caller,
    for an owner-only setting, which only the owner sets from the dashboard (the band rows, the zone VPD curves,
    the zone priorities, the manual override timeout and the drying cost limit), and for every setting that is not
    an operator switch: an agent writes no climate value.

    trigger_id and planner_instance only annotate the activity log."""
    actor = _service_actor()
    if actor is None:
        raise ServiceError(problem("forbidden", "set_setting needs a resolved caller"))
    if release:
        if value is not None:
            raise ServiceError(problem("invalid_request", "A release takes no value", field="value"))
        if manual:
            raise ServiceError(problem("invalid_request", "A release cannot be manual", field="manual"))
    elif value is None:
        raise ServiceError(problem("invalid_request", "Pass value, or release=true with no value", field="value"))
    request_key = _uuid_argument("request_id", request_id)
    trigger = _uuid_argument("trigger_id", trigger_id)
    # Only the activity detail: nothing here reads, locks or updates a planner delivery or trigger ledger row.
    extra_detail = {
        name: audit
        for name, audit in (("trigger_id", trigger), ("planner_instance", planner_instance))
        if audit is not None
    }
    async with _service_connection() as conn:
        if release:
            result = await settings_service.release(conn, actor, param, reason, request_key, extra_detail=extra_detail)
        else:
            result = await settings_service.write(
                conn, actor, param, value, manual, reason, request_key, extra_detail=extra_detail
            )
    return _tool_ok(result.value, replayed=result.replayed)


def _setting_selected(
    setting: settings_service.Setting,
    param: str | None,
    group: str | None,
    writable_only: bool,
    manual_only: bool,
) -> bool:
    return (
        (param is None or setting.param == param)
        and (group is None or setting.group == group)
        and (not writable_only or setting.writable)
        and (not manual_only or (setting.desired is not None and setting.desired.manual))
    )


@mcp.tool()
@_answers_problems
async def settings(
    param: Annotated[str | None, Field(description="One setting's registry name.")] = None,
    group: Annotated[
        settings_service.SettingGroup | None, Field(description="Only the rows of this Setting.group.")
    ] = None,
    writable_only: Annotated[bool, Field(description="Only the rows a write can change now.")] = False,
    manual_only: Annotated[bool, Field(description="Only the rows whose newest desired row is manual.")] = False,
    since: Annotated[
        str | None, Field(description="History start, ISO-8601 with its UTC offset (API-12's from).")
    ] = None,
    until: Annotated[str | None, Field(description="History end, ISO-8601 with its UTC offset (API-12's to).")] = None,
):
    """Read the settings catalog, or one setting's history.

    REST twins: API-09 `GET /v1/settings` and API-12 `GET /v1/settings/{param}/history`.

    With no window: API-09's `{items, server_time}`, filtered by param, group, writable_only and manual_only. Each
    row carries applied_from (whose value is in force: manual, desired, plan, band or default), min, max, step,
    its desired row, its plan value and its readback state, and `help`: what the setting is (summary), what the
    controller does with it (effect), what raising and lowering it does (raise, lower; for a switch, turning it on and
    off) and any caution, the same words the dashboard shows; a guardrail row has guardrail true. A read-only row
    carries read_only_kind, and a derived row source_params, the writable settings it is computed from. Explain a
    change with that text. Narrow it: the whole catalog is large.

    With param, since and until all given: API-12's SettingHistory over [since, until), the desired rows, plan
    values and readback change points; since and until map to API-12's from and to, and the other filters do not
    apply. since or until without the other two is `invalid_request`. An unknown param in a history read is
    `not_found`. Refusals are Problem JSON with isError."""
    if since is None and until is None:
        async with _service_connection() as conn:
            rows = await reads_service.settings_rows(conn)
        items = [row for row in rows.items if _setting_selected(row, param, group, writable_only, manual_only)]
        return _tool_ok(rows.model_copy(update={"items": items}))
    if param is None or since is None or until is None:
        raise ServiceError(
            problem(
                "invalid_request",
                "A history read needs param, since and until together",
                field="since" if since is None else "until" if until is None else "param",
            )
        )
    from_, to = _time_argument("since", since), _time_argument("until", until)
    async with _service_connection() as conn:
        return _tool_ok(await reads_service.setting_history(conn, param, from_, to))


@mcp.tool()
@_answers_problems
async def activity(
    source: Annotated[
        str | None, Field(description="dashboard, iris, system, agent (every agent) or agent:<name>.")
    ] = None,
    actor: Annotated[str | None, Field(description="The actor's exact name.")] = None,
    action: Annotated[str | None, Field(description="A prefix, such as setting.write or irrigation.")] = None,
    target: Annotated[str | None, Field(description="The exact target: a setting, plan id, alert id or line.")] = None,
    since: Annotated[
        str | None, Field(description="Oldest time, ISO-8601 with its UTC offset (API-17's from).")
    ] = None,
    limit: Annotated[int, Field(description="Rows per page, 1 to 200.")] = activity_service.LIMIT_DEFAULT,
    cursor: Annotated[str | None, Field(description="The previous page's next_cursor.")] = None,
):
    """Read every write by people, Iris, agents and the system, newest first: what happened to your writes and who
    changed the same target since.

    REST twin: API-17 `GET /v1/activity`. Returns ActivityPage `{items, next_cursor}`; each setting row carries its
    readback state and confirmed_at. since maps to API-17's from. Narrow it: a plan.write row lists every row its
    plan wrote, up to hundreds. A bad filter, limit, cursor or time is `invalid_request` as Problem JSON with
    isError."""
    from_ = _time_argument("since", since)
    async with _service_connection() as conn:
        return _tool_ok(
            await reads_service.activity_page(
                conn,
                source=source,
                actor=actor,
                action=action,
                target=target,
                from_=from_,
                limit=limit,
                cursor=cursor,
            )
        )


# ── The house band (#1334): API-23's read, never its Save ──
# The band is operator-owned (decisions 2026-11-05): there is no band write tool, and Iris is not in these reads'
# audience. API-24 (PUT /v1/band/profile) stays the dashboard's.

_BAND_DAY_DESCRIPTION = "America/Denver day, YYYY-MM-DD, at most 400 days from today; default today."


def _band_day(value: str | None) -> date | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ServiceError(problem("invalid_request", "day is a local date, YYYY-MM-DD", field="day")) from exc


def _band_temp(description: str, minimum: float | None = None):
    return Field(default=None, description=f"{description}, °F.", ge=minimum)


def _band_vpd(description: str, minimum: float | None = None):
    return Field(default=None, description=f"{description}, kPa.", ge=minimum)


@mcp.tool()
@_answers_problems
async def band_profile(day: Annotated[str | None, Field(description=_BAND_DAY_DESCRIPTION)] = None):
    """Read the house band: its profile, its 24 anchors and its curve over one day. REST twin: API-23
    (GET /v1/band/profile) with no draft; the same JSON (BandProfilePreview).

    It only reads. Returns current (profile: day and night targets, the temperature ± widths and the VPD range below
    and above; the 24 raw anchors; simple), the day's curve at 10-min steps of t (temp and vpd low, target and high,
    as the controller evaluates them), the sun times, the guardrails, overshoot, the night heat estimate, the expected night VPD ribbon and its fit, findings,
    measured (the last 24 h of house temp_avg and vpd_avg on t by local clock time: today's before now, yesterday's
    after) and forecast (the day's outdoor temperature and VPD). draft equals current and changed is empty. Unknown
    values are null, never 0.

    There is no band write tool: the band is operator-owned and is saved on the dashboard (Control → Band). Use
    band_profile_preview to evaluate a change. Refusals return the Problem JSON with isError: invalid_request (day),
    read_only (the house band has no complete anchor set), query_timeout and unavailable (both retryable)."""
    from verdify_services import band_profile as band_service

    parsed = _band_day(day)
    async with _service_connection() as conn:
        return _tool_ok(await band_service.preview(conn, None, None, parsed))


@mcp.tool()
@_answers_problems
async def band_profile_preview(
    temp_day: Annotated[float | None, _band_temp("Temperature target at solar noon")] = None,
    temp_night: Annotated[float | None, _band_temp("Temperature target at solar midnight")] = None,
    temp_width_day: Annotated[float | None, _band_temp("± around the day target", 0)] = None,
    temp_width_night: Annotated[float | None, _band_temp("± around the night target", 0)] = None,
    vpd_day: Annotated[float | None, _band_vpd("VPD target at solar noon")] = None,
    vpd_night: Annotated[float | None, _band_vpd("VPD target at solar midnight")] = None,
    vpd_below_day: Annotated[float | None, _band_vpd("Range below the day target", 0)] = None,
    vpd_above_day: Annotated[float | None, _band_vpd("Range above the day target", 0)] = None,
    vpd_below_night: Annotated[float | None, _band_vpd("Range below the night target", 0)] = None,
    vpd_above_night: Annotated[float | None, _band_vpd("Range above the night target", 0)] = None,
    anchors: Annotated[
        dict[str, float] | None,
        Field(description='Advanced: raw house anchors by param, such as {"band_temp_low_sr": 62.5}.'),
    ] = None,
    day: Annotated[str | None, Field(description=_BAND_DAY_DESCRIPTION)] = None,
):
    """Evaluate a draft of the house band without saving it. REST twin: API-23 (GET /v1/band/profile) with the same
    fields; the same JSON (BandProfilePreview).

    It only reads: nothing is stored and nothing reaches the controller. A field left out keeps the band's value; any
    temperature field recompiles the temperature series with sunrise and sunset at the midpoint of noon and midnight,
    any VPD field the VPD series; anchors then override single raw anchors. Returns current and draft (profile, anchors,
    simple), changed (the anchors a Save would write), both curves over the day at 10-min steps of t, findings (error: band_order, guardrail, band_width (narrower than the
    control law's minimum widths anywhere in the day), night_floor (the law's drying line, vpd_low plus its drying
    margin, under the night floor anywhere in the night; guardrails carries the numbers); warning: overshoot,
    dewpoint_unreached), the night heat estimate for both, the expected night VPD,
    measured (the last 24 h of the house average on t) and forecast (outdoor). Unknown values are null, never 0.

    There is no band write tool: the band is operator-owned and is saved on the dashboard (Control → Band). Refusals
    return the Problem JSON with isError: invalid_request (day), unknown_target (an anchor that is not a house band
    anchor), out_of_range (an anchor outside its registry bounds), read_only (the house band has no complete anchor
    set), query_timeout and unavailable (both retryable). A field outside its schema is refused before the tool runs."""
    from verdify_services import band_profile as band_service

    patch = band_service.BandProfilePatch(
        temp_day=temp_day,
        temp_night=temp_night,
        temp_width_day=temp_width_day,
        temp_width_night=temp_width_night,
        vpd_day=vpd_day,
        vpd_night=vpd_night,
        vpd_below_day=vpd_below_day,
        vpd_above_day=vpd_above_day,
        vpd_below_night=vpd_below_night,
        vpd_above_night=vpd_above_night,
    )
    parsed = _band_day(day)
    async with _service_connection() as conn:
        return _tool_ok(await band_service.preview(conn, patch, dict(anchors or {}), parsed))


# ═══════════════════════════════════════════════════════════════
# LESSON MANAGEMENT
# ═══════════════════════════════════════════════════════════════


async def _lesson_state_row(conn, lesson_id: int) -> dict | None:
    """Fetch the columns needed to derive a lesson's lifecycle state.

    `last_validated > created_at` is the authoritative "validated beyond
    creation" signal; `times_validated` is the fallback the derive helper uses
    when that flag is unavailable. Returns None if the lesson doesn't exist.
    """
    return await conn.fetchrow(
        """
        SELECT id, is_active, superseded_by, times_validated,
               (last_validated IS NOT NULL AND created_at IS NOT NULL
                AND last_validated > created_at) AS has_independent_validation
          FROM planner_lessons WHERE id = $1
        """,
        lesson_id,
    )


@mcp.tool()
async def lessons_manage(action: str, lesson_id: int = 0, data: str = "") -> str:
    """Manage planner lessons (accumulated operational knowledge).

    Actions: create, update, deactivate, validate, supersede.
    Lifecycle state machine (G8): proposed -> validated -> superseded/retired.
    State is derived from is_active/superseded_by/validation history; illegal
    transitions (e.g. validating a superseded or retired lesson) are rejected.

    create: data = {"category", "condition", "lesson", "confidence": "low|medium|high"}
    update: data = {"lesson"?, "condition"?, "confidence"?}
    validate: proposed/validated -> validated; increment times_validated, optionally upgrade confidence
    deactivate: proposed/validated -> retired (terminal)
    supersede: proposed/validated -> superseded by a newer lesson;
        data = {"new_id": <existing lesson id>} (terminal)"""
    d = json.loads(data) if data else {}
    conn = await _db()
    try:
        if action == "create":
            try:
                payload = LessonCreate.model_validate(d)
            except ValidationError as e:
                return json.dumps({"error": "LessonCreate validation failed", "details": json.loads(e.json())})
            row = await conn.fetchrow(
                """
                INSERT INTO planner_lessons (category, condition, lesson, confidence, times_validated, is_active, greenhouse_id)
                VALUES ($1, $2, $3, $4, 1, true, 'vallery') RETURNING *""",
                payload.category,
                payload.condition,
                payload.lesson,
                payload.confidence,
            )
            return _json(dict(row))

        elif action == "update" and lesson_id:
            try:
                patch = LessonUpdate.model_validate(d)
            except ValidationError as e:
                return json.dumps({"error": "LessonUpdate validation failed", "details": json.loads(e.json())})
            set_fields = patch.model_dump(exclude_unset=True)
            if not set_fields:
                return json.dumps({"error": "No fields to update"})
            sets = [f"{k} = ${i}" for i, k in enumerate(set_fields, start=2)]
            vals = [lesson_id, *set_fields.values()]
            row = await conn.fetchrow(f"UPDATE planner_lessons SET {', '.join(sets)} WHERE id = $1 RETURNING *", *vals)
            return _json(dict(row)) if row else json.dumps({"error": "Lesson not found"})

        elif action == "deactivate" and lesson_id:
            cur = await _lesson_state_row(conn, lesson_id)
            if cur is None:
                return json.dumps({"error": "Lesson not found"})
            state = derive_lesson_state(
                is_active=cur["is_active"],
                superseded_by=cur["superseded_by"],
                times_validated=cur["times_validated"] or 1,
                has_independent_validation=bool(cur["has_independent_validation"]),
            )
            if not is_legal_lesson_transition(state, "retired"):
                return json.dumps(
                    {"error": f"Illegal transition {state} -> retired", "lesson_id": lesson_id, "state": state}
                )
            if state == "retired":  # idempotent
                return json.dumps({"ok": True, "lesson_id": lesson_id, "action": "deactivated", "state": "retired"})
            await conn.execute("UPDATE planner_lessons SET is_active = false WHERE id = $1", lesson_id)
            return json.dumps({"ok": True, "lesson_id": lesson_id, "action": "deactivated", "state": "retired"})

        elif action == "validate" and lesson_id:
            try:
                val = LessonValidate.model_validate(d) if d else LessonValidate()
            except ValidationError as e:
                return json.dumps({"error": "LessonValidate validation failed", "details": json.loads(e.json())})
            cur = await _lesson_state_row(conn, lesson_id)
            if cur is None:
                return json.dumps({"error": "Lesson not found"})
            state = derive_lesson_state(
                is_active=cur["is_active"],
                superseded_by=cur["superseded_by"],
                times_validated=cur["times_validated"] or 1,
                has_independent_validation=bool(cur["has_independent_validation"]),
            )
            if not is_legal_lesson_transition(state, "validated"):
                return json.dumps(
                    {"error": f"Illegal transition {state} -> validated", "lesson_id": lesson_id, "state": state}
                )
            if val.confidence:
                await conn.execute(
                    "UPDATE planner_lessons SET times_validated = times_validated + 1, "
                    "last_validated = now(), confidence = $2 WHERE id = $1",
                    lesson_id,
                    val.confidence,
                )
            else:
                await conn.execute(
                    "UPDATE planner_lessons SET times_validated = times_validated + 1, last_validated = now() WHERE id = $1",
                    lesson_id,
                )
            return json.dumps({"ok": True, "lesson_id": lesson_id, "action": "validated", "state": "validated"})

        elif action == "supersede" and lesson_id:
            try:
                sup = LessonSupersede.model_validate(d)
            except ValidationError as e:
                return json.dumps({"error": "LessonSupersede validation failed", "details": json.loads(e.json())})
            if sup.new_id == lesson_id:
                return json.dumps({"error": "A lesson cannot supersede itself", "lesson_id": lesson_id})
            cur = await _lesson_state_row(conn, lesson_id)
            if cur is None:
                return json.dumps({"error": "Lesson not found", "lesson_id": lesson_id})
            new_exists = await conn.fetchval("SELECT 1 FROM planner_lessons WHERE id = $1", sup.new_id)
            if new_exists is None:
                return json.dumps({"error": f"Superseding lesson {sup.new_id} not found", "new_id": sup.new_id})
            state = derive_lesson_state(
                is_active=cur["is_active"],
                superseded_by=cur["superseded_by"],
                times_validated=cur["times_validated"] or 1,
                has_independent_validation=bool(cur["has_independent_validation"]),
            )
            if not is_legal_lesson_transition(state, "superseded"):
                return json.dumps(
                    {"error": f"Illegal transition {state} -> superseded", "lesson_id": lesson_id, "state": state}
                )
            # superseded lessons drop out of the live set (is_active=true AND
            # superseded_by IS NULL); also flip is_active=false for clarity.
            await conn.execute(
                "UPDATE planner_lessons SET superseded_by = $2, is_active = false WHERE id = $1",
                lesson_id,
                sup.new_id,
            )
            return json.dumps(
                {
                    "ok": True,
                    "lesson_id": lesson_id,
                    "action": "superseded",
                    "superseded_by": sup.new_id,
                    "state": "superseded",
                }
            )

        return json.dumps({"error": f"Unknown action '{action}'. Use: create, update, deactivate, validate, supersede"})
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# Sprint 23 — Topology + crop-history tools for Iris
# ═══════════════════════════════════════════════════════════════
#
# These expose the topology tables (zones/shelves/positions/equipment)
# and the crop-history views to Iris, so planning decisions can reference
# "what is currently at SOUTH-FLOOR-1" instead of opaque zone strings.


@mcp.tool()
async def topology() -> str:
    """Return the full greenhouse → zones → shelves → positions tree.

    Use this when you need to know the physical layout: what zones exist,
    what shelves each zone contains, and what position slots are
    defined. The planner uses this to validate setpoint scope (e.g.,
    per-zone VPD targets) and the website uses it for navigation.
    """
    conn = await _db()
    try:
        row = await conn.fetchrow(
            "SELECT greenhouse_id, greenhouse_name, zones FROM v_topology_tree WHERE greenhouse_id = 'vallery'"
        )
        if row is None:
            return _json({"error": "topology not available"})
        # asyncpg returns JSONB as str unless a codec is registered
        z = row["zones"]
        zones = json.loads(z) if isinstance(z, str) else z
        return _json(
            {
                "greenhouse_id": row["greenhouse_id"],
                "greenhouse_name": row["greenhouse_name"],
                "zones": zones,
            }
        )
    finally:
        await conn.close()


@mcp.tool()
async def position_current(zone_slug: str = "") -> str:
    """Return the current occupancy of every position (and which crop, if any).

    Args:
        zone_slug: optional — narrow to one zone (south, north, east, west, center).

    Each row: position_label, crop_name, crop_stage, crop_days_in_place, is_occupied.
    Use this to see "what is planted where right now."
    """
    conn = await _db()
    try:
        if zone_slug:
            rows = await conn.fetch(
                "SELECT * FROM v_position_current WHERE greenhouse_id = 'vallery' AND zone_slug = $1",
                zone_slug,
            )
        else:
            rows = await conn.fetch("SELECT * FROM v_position_current WHERE greenhouse_id = 'vallery'")
        return _json([dict(r) for r in rows])
    finally:
        await conn.close()


@mcp.tool()
async def crop_history(position_id: int = 0) -> str:
    """Return the chronological crop history at a given position.

    Args:
        position_id: the integer position_id. Use `position_current()` to find it.

    Returns every crop that has ever been at this position, newest first, with
    planted_date, cleared_at, final_stage, days_in_place, observation_count,
    and harvest_count. Includes both active and historical rows.
    """
    conn = await _db()
    try:
        if not position_id:
            return _json({"error": "position_id required"})
        rows = await conn.fetch(
            """
            SELECT * FROM v_crop_history
            WHERE position_id = $1 AND greenhouse_id = 'vallery'
            ORDER BY planted_date DESC
            """,
            position_id,
        )
        return _json([dict(r) for r in rows])
    finally:
        await conn.close()


@mcp.tool()
async def crop_lifecycle(crop_id: int) -> str:
    """Return a single crop's full lifecycle timeline.

    Args:
        crop_id: integer crop id.

    Returns: planted_date, cleared_at, current_stage, days_alive, event timeline
    (planted/stage_change/transplanted/removed/harvested), harvest totals
    (weight_kg, units, revenue), observation count + avg health score.
    The authoritative per-crop summary for planning decisions and
    retrospective evaluation.
    """
    conn = await _db()
    try:
        row = await conn.fetchrow(
            "SELECT * FROM v_crop_lifecycle WHERE crop_id = $1 AND greenhouse_id = 'vallery'",
            crop_id,
        )
        if row is None:
            return _json({"error": f"crop {crop_id} not found"})
        d = dict(row)
        # Unpack the JSONB events array
        ev = d.get("events")
        if isinstance(ev, str):
            d["events"] = json.loads(ev)
        return _json(d)
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# VECTORIZED RETRIEVAL (Cortex embed.main, migration 296, #1351)
# ═══════════════════════════════════════════════════════════════
#
# lessons_search and knowledge_search embed the query with local Cortex
# embed.main (2560-dim, #1351) and call fn_search_knowledge_embeddings()
# against knowledge_embeddings (migration 296). The provider, endpoint, model
# and key file come from config/ai.yaml models.embedding through
# verdify_schemas.embeddings, which refuses any host but Cortex. A missing key
# or config fails closed with a classified error instead of crashing.


class SemanticDependencyFailure(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


async def _semantic_dependency_lifecycle(tool: str, reason: str | None, started_at: datetime) -> None:
    """One canonical warning per tool; only successful retrieval recovers it.

    Lock and timestamps fence concurrent calls: a success that started before a
    newer failure cannot resolve that newer failure. No query or provider error
    text is retained. Existing MCP role grants cover this ordinary alert duty.
    """
    envelope = None
    if reason is not None:
        envelope = AlertEnvelope.model_validate(
            {
                "alert_type": "planner_tool_dependency_failed",
                "severity": "warning",
                "category": "system",
                "message": f"{tool} semantic dependency failed: {reason}",
                "details": {
                    "tool": tool,
                    "reason": reason,
                    "embedding_model": _embeddings.EMBEDDING_MODEL,
                    "embedding_dimensions": _embeddings.EMBEDDING_DIMENSIONS,
                },
            }
        )
    conn = await _db()
    try:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", "mcp.semantic_dependency." + tool)
            if envelope is not None:
                await conn.execute(
                    """WITH updated AS (
                        UPDATE public.alert_log SET severity='warning', message=$2, details=$3::jsonb,
                            updated_at=clock_timestamp()
                        WHERE alert_type='planner_tool_dependency_failed' AND source='mcp'
                          AND disposition IN ('open','acknowledged') AND resolved_at IS NULL
                          AND details->>'tool'=$1 RETURNING id
                    ) INSERT INTO public.alert_log (alert_type,severity,category,message,details,source)
                      SELECT 'planner_tool_dependency_failed','warning','system',$2,$3::jsonb,'mcp'
                      WHERE NOT EXISTS (SELECT 1 FROM updated)""",
                    tool,
                    envelope.message,
                    json.dumps(envelope.details),
                )
            else:
                await conn.execute(
                    """UPDATE public.alert_log SET disposition='resolved',resolved_at=clock_timestamp(),
                        resolved_by='mcp.semantic_retrieval',
                        resolution='auto-resolved: same semantic tool completed embedding and retrieval',
                        updated_at=clock_timestamp()
                        WHERE alert_type='planner_tool_dependency_failed' AND source='mcp'
                          AND disposition IN ('open','acknowledged') AND resolved_at IS NULL
                          AND details->>'tool'=$1 AND updated_at <= $2""",
                    tool,
                    started_at,
                )
    finally:
        await conn.close()


async def _semantic_failure_result(tool: str, reason: str, started_at: datetime) -> str:
    try:
        await _semantic_dependency_lifecycle(tool, reason, started_at)
        recorded = True
    except Exception as exc:
        print(f"[mcp.semantic_alert] unavailable: {type(exc).__name__}", file=sys.stderr)
        recorded = False
    return json.dumps(
        {"error": f"{tool} semantic dependency failed", "reason": reason, "canonical_alert_recorded": recorded}
    )


async def _embed_query(text: str) -> list[float]:
    """Embed a query with Cortex embed.main; raise a classified, credential-free dependency failure."""
    try:
        settings = _embeddings.load_embedding_settings()
        api_key = _embeddings.read_api_key(settings)
        return await _embeddings.embed_query(settings, text, api_key=api_key)
    except _embeddings.EmbeddingError as exc:
        print(f"[mcp.embed_query] failed: {exc.reason}", file=sys.stderr)
        reason = exc.reason if exc.reason in _EMBED_FAILURE_REASONS else "embedding_provider_failed"
        raise SemanticDependencyFailure(reason) from None


_EMBED_FAILURE_REASONS = frozenset(
    {
        "embedding_config_invalid",
        "embedding_credential_missing",
        "embedding_provider_failed",
        "embedding_invalid_response",
    }
)


@mcp.tool()
async def lessons_search(query: str, top_k: int = 10, min_confidence: str = "low") -> str:
    """Semantic search across planner_lessons.

    Use this to pull the lessons most relevant to a *forward-looking* condition
    (e.g. "hot dry day with 1100 W/m² solar peak") rather than relying on the
    static top-10-by-confidence list the prompt context surfaces by default.

    Args:
        query: free-text description of the conditions or topic you care about
        top_k: max results (default 10, cap 25)
        min_confidence: 'low' | 'medium' | 'high' — filter by minimum confidence
            of the underlying planner_lessons row. Most lessons are 'low' so
            the default is permissive.

    Returns: JSON array of {id, category, condition, lesson, confidence,
    times_validated, distance} sorted by ascending cosine distance.
    """
    top_k = max(1, min(int(top_k), 25))
    started_at = datetime.now(ZoneInfo("UTC"))
    try:
        embedding = await _embed_query(query)
    except SemanticDependencyFailure as exc:
        return await _semantic_failure_result("lessons_search", exc.reason, started_at)

    rank_floor = {"low": 1, "medium": 2, "high": 3}.get(min_confidence, 1)
    conn = None
    try:
        conn = await _db()
        rows = await conn.fetch(
            """
            WITH hits AS (
              SELECT source_id, content, metadata, distance
                FROM fn_search_knowledge_embeddings($1::halfvec, $2, ARRAY['lesson']::text[])
            )
            SELECT pl.id, pl.category, pl.condition, pl.lesson, pl.confidence,
                   pl.times_validated, pl.is_active, h.distance
              FROM hits h
              JOIN planner_lessons pl ON pl.id::text = h.source_id
             WHERE pl.is_active = true AND pl.superseded_by IS NULL
               AND NOT fn_dli_proxy_lesson_invalid(pl.condition, pl.lesson)
               AND CASE pl.confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END >= $3
             ORDER BY h.distance
            """,
            _embeddings.halfvec_literal(embedding),
            top_k,
            rank_floor,
        )
        result = _json([dict(r) for r in rows])
    except Exception:
        return await _semantic_failure_result("lessons_search", "semantic_query_failed", started_at)
    finally:
        if conn is not None:
            await conn.close()
    try:
        await _semantic_dependency_lifecycle("lessons_search", None, started_at)
    except Exception as exc:
        print(f"[mcp.semantic_alert] unavailable: {type(exc).__name__}", file=sys.stderr)
        return json.dumps(
            {
                "error": "semantic retrieval succeeded but canonical lifecycle unavailable",
                "canonical_alert_resolved": False,
            }
        )
    return result


@mcp.tool()
async def knowledge_search(
    query: str,
    top_k: int = 8,
    source_types: str = "lesson,plan,site_doc,playbook,observation",
) -> str:
    """Semantic search across docs, playbook, historical plans, lessons, and observations.

    Use this when you need reference-level knowledge: "what does the playbook
    say about vent oscillation?", "summarize the controller mode hierarchy",
    "have I seen a 1100 W/m² solar day before, and what did I try?". The
    source_types argument lets you scope the search:

      site_doc — public website Markdown plus operator-facing docs in docs/**/*.md
      playbook — the planner playbook + skills mirror (chunked by heading)
      plan     — past plan_journal hypotheses + actual_outcome rows
      lesson   — planner_lessons rows (same corpus as lessons_search)
      observation — historical crop observations, health notes, and stress tags

    Args:
        query: free-text query
        top_k: max results (default 8, cap 25)
        source_types: comma-separated subset of the five sources

    Returns: JSON array of {source_type, source_id, content, metadata, distance}.
    """
    top_k = max(1, min(int(top_k), 25))
    types = [s.strip() for s in source_types.split(",") if s.strip()]
    valid = {"lesson", "plan", "site_doc", "playbook", "observation"}
    types = [t for t in types if t in valid]
    if not types:
        return json.dumps(
            {"error": "source_types must include at least one of: lesson, plan, site_doc, playbook, observation"}
        )

    started_at = datetime.now(ZoneInfo("UTC"))
    try:
        embedding = await _embed_query(query)
    except SemanticDependencyFailure as exc:
        return await _semantic_failure_result("knowledge_search", exc.reason, started_at)

    conn = None
    try:
        conn = await _db()
        rows = await conn.fetch(
            """
            SELECT source_type, source_id, chunk_idx, content, metadata, distance
              FROM fn_search_knowledge_embeddings($1::halfvec, $2, $3::text[]) h
             WHERE h.source_type <> 'lesson'
                OR EXISTS (
                     SELECT 1
                       FROM planner_lessons pl
                      WHERE pl.id::text = h.source_id
                        AND pl.is_active = true
                        AND pl.superseded_by IS NULL
                        AND NOT fn_dli_proxy_lesson_invalid(pl.condition, pl.lesson)
                   )
            """,
            _embeddings.halfvec_literal(embedding),
            top_k,
            types,
        )
        result = _json([dict(r) for r in rows])
    except Exception:
        return await _semantic_failure_result("knowledge_search", "semantic_query_failed", started_at)
    finally:
        if conn is not None:
            await conn.close()
    try:
        await _semantic_dependency_lifecycle("knowledge_search", None, started_at)
    except Exception as exc:
        print(f"[mcp.semantic_alert] unavailable: {type(exc).__name__}", file=sys.stderr)
        return json.dumps(
            {
                "error": "semantic retrieval succeeded but canonical lifecycle unavailable",
                "canonical_alert_resolved": False,
            }
        )
    return result


# ═══════════════════════════════════════════════════════════════
# IRRIGATION WRITES (VD-64, #1177; VD-61, #1174)
# ═══════════════════════════════════════════════════════════════
# Thin adapters over verdify_services.irrigation.writes: the same validation, refusal codes and activity row as the
# operator API's API-IRR-03 to -08 and -13, and the same JSON. The actor comes only from current_actor(). None of them
# reads plan_delivery_log or planner_trigger_ledger, so a water write never satisfies or fails a trigger. verdify_services
# and mcp.types are imported inside the functions: CI loads this module under a FastMCP stub without the MCP runtime.

ScheduleLineId = Literal["L01", "L02", "L04", "L05", "L06", "L07", "L08", "L09", "L10"]
MisterLineId = Literal["L04", "L07", "L09"]
LineTarget = Literal[LineId, "all"]

_WaterReason = Annotated[str | None, Field(description="Why, at most 500 characters; shown in Activity.")]
_WaterRequestId = Annotated[
    str | None, Field(description="A UUID; the same one and arguments replay the stored result.")
]
_WaterTriggerId = Annotated[str | None, Field(description="Kept only in the activity log.")]
_WaterPlannerInstance = Annotated[str | None, Field(description="Kept only in the activity log.")]


class ScheduleStart(BaseModel):
    """The OpenAPI ScheduleStart: clock with a local HH:MM, or a solar kind with offset_min (0 when left out)."""

    model_config = ConfigDict(extra="forbid")

    kind: StartKind
    clock: Annotated[
        str | None,
        Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$", description="Local HH:MM, when kind is clock."),
    ] = None
    offset_min: Annotated[
        int | None, Field(ge=-240, le=240, description="Minutes from the solar event, when kind is not clock.")
    ] = None


async def _irrigation_write(tool: str, write):
    """Run one irrigation write as the request's actor (current_actor(), never an argument) on its own
    connection: the service's JSON, or the Problem JSON with isError."""
    from verdify_services.actor import Actor
    from verdify_services.problems import ServiceError, problem

    caller = current_actor()
    if caller is None:
        return _tool_problem(
            problem("forbidden", "A water write needs a resolved caller: Iris, a named agent or admin")
        )
    actor = Actor(source=caller.source, name=caller.name)
    conn = None
    try:
        conn = await _db()
        result = await write(conn, actor)
    except ServiceError as refused:
        return _tool_problem(refused.problem)
    except Exception as exc:  # the database or its connection; never a refusal
        print(f"[mcp.{tool}] failed: {type(exc).__name__}", file=sys.stderr)
        return _tool_problem(
            problem(
                "unavailable",
                "The irrigation service could not answer. Retry with the same request_id: it stores the "
                "write once and returns it if it was stored",
            )
        )
    finally:
        if conn is not None:
            await conn.close()
    return _tool_ok(result.value, replayed=result.replayed)


@mcp.tool()
async def irrigation_schedule_set(
    slot_id: Annotated[
        int | None,
        Field(ge=1, le=65535, description="The schedule to edit or delete; leave it out to create one."),
    ] = None,
    delete: Annotated[bool, Field(description="Delete the schedule slot_id names; send no schedule field.")] = False,
    line_id: Annotated[
        ScheduleLineId | None,
        Field(description="The relay: L01, L02 or L04-L10. To create, give it or circuit_id and variant."),
    ] = None,
    circuit_id: Annotated[
        Literal["wall_drip", "center_drip", "center_mister", "south_mister", "west_mister"] | None,
        Field(
            description="Instead of line_id (#1336): the physical line: wall_drip (every wall and shelf), center_drip, "
            "center_mister, south_mister or west_mister. Send variant with it."
        ),
    ] = None,
    variant: Annotated[
        Literal["clean", "fertilized"] | None,
        Field(
            description="With circuit_id: clean water, or fertilized (opens the fertilizer master valve L03; clean "
            "never does). A variant whose valve is not wired is unknown_target."
        ),
    ] = None,
    days: Annotated[list[Weekday] | None, Field(min_length=1, description="The weekdays. Needed to create.")] = None,
    start: Annotated[ScheduleStart | None, Field(description="When it starts each day. Needed to create.")] = None,
    on_s: Annotated[
        int | None,
        Field(ge=10, le=7200, description="Seconds per run or pulse; misters 10-90. Needed to create."),
    ] = None,
    count: Annotated[int | None, Field(ge=1, le=60, description="Pulses in a mist window; drips 1.")] = None,
    gap_s: Annotated[
        int | None, Field(ge=0, le=600, description="Seconds between pulses: misters 30-600; drips 0.")
    ] = None,
    prewet_s: Annotated[int | None, Field(ge=0, le=1800, description="Fertilizer lines: clean seconds before.")] = None,
    flush_s: Annotated[int | None, Field(ge=0, le=1800, description="Fertilizer lines: clean seconds after.")] = None,
    degraded_only: Annotated[
        bool | None, Field(description="L04, L07 and L09: run only while the zone's VPD sensor is degraded.")
    ] = None,
    enabled: Annotated[bool | None, Field(description="Whether it runs; a disabled schedule stays stored.")] = None,
    label: Annotated[str | None, Field(max_length=60, description="A short name, shown on Water.")] = None,
    manual: Annotated[bool, Field(description="Stored on a create or edit; false unless you pass true.")] = False,
    reason: _WaterReason = None,
    request_id: _WaterRequestId = None,
    trigger_id: _WaterTriggerId = None,
    planner_instance: _WaterPlannerInstance = None,
):
    """Changes watering only; it writes no climate value and is not a review.

    Create, edit or delete a schedule. REST twins: API-IRR-03 (POST /v1/irrigation/schedules), API-IRR-04 (PUT
    /v1/irrigation/schedules/{slot_id}) and API-IRR-05 (DELETE /v1/irrigation/schedules/{slot_id}). Returns the Schedule
    JSON with sync and manual_before; a delete returns {"slot_id": <id>, "deleted": true, "manual_before": <flag>}.

    No slot_id creates, and needs the line (line_id, or circuit_id and variant), days, start and on_s. An edit may send
    variant alone to switch clean and fertilized on the same physical line. A slot_id edits: omitted fields keep their value, except
    manual. delete true with a slot_id and no schedule field deletes. irrigation_schedule has the bounds per line kind
    and the limit of 24 schedules.

    manual stores false on every create and edit unless you pass true, so an edit clears a person's flag: manual_before
    says so and Activity shows "manual cleared". Only Iris is refused with manual, on an edit or a delete. Before the
    irrigation firmware the write is stored and reaches the controller with the first program push. The same request_id
    (a UUID) and arguments return the stored result with replayed: true.

    Refusals are the Problem JSON with isError: invalid_request, unknown_target, out_of_range (min and max are the bounds
    for the line kind), too_close (two starts on a line under 30 min apart), too_many_schedules, manual,
    request_id_reused, forbidden, and unavailable (the database; retry with the same request_id)."""
    from verdify_services.irrigation import writes
    from verdify_services.problems import problem

    fields = {
        name: value
        for name, value in (
            ("line_id", line_id),
            ("circuit_id", circuit_id),
            ("variant", variant),
            ("days", days),
            ("start", None if start is None else start.model_dump(exclude_none=True)),
            ("on_s", on_s),
            ("count", count),
            ("gap_s", gap_s),
            ("prewet_s", prewet_s),
            ("flush_s", flush_s),
            ("degraded_only", degraded_only),
            ("enabled", enabled),
            ("label", label),
        )
        if value is not None
    }
    audit = {
        "reason": reason,
        "request_id": request_id,
        "trigger_id": trigger_id,
        "planner_instance": planner_instance,
    }

    if delete:
        extra = next(iter(fields), "manual" if manual else None)
        if slot_id is None or extra is not None:
            detail = "delete needs a slot_id" if slot_id is None else f"delete takes no schedule field, not {extra}"
            return _tool_problem(problem("invalid_request", detail, field="slot_id" if slot_id is None else extra))

        async def write(conn, actor):
            return await writes.schedule_delete(conn, actor, slot_id, **audit)

    elif slot_id is None:

        async def write(conn, actor):
            return await writes.schedule_create(conn, actor, fields, manual=manual, **audit)

    else:

        async def write(conn, actor):
            return await writes.schedule_update(conn, actor, slot_id, fields, manual=manual, **audit)

    return await _irrigation_write("irrigation_schedule_set", write)


def _line_write_manual(line_id: str, definition: bool, pause: bool, manual: bool | None) -> bool | None:
    """What a line write passes as manual: REST's line_edit_manual with MCP's default, false (architecture §5.6). A
    definition edit stores the flag it carries. A pause or resume on one line passes none, so the flag stays, even with
    manual beside it. Anything else passes what it was sent: manual alone sets it, and the service refuses it on all."""
    if definition:
        return False if manual is None else manual
    return None if pause and line_id != "all" else manual


@mcp.tool()
async def irrigation_line_set(
    line_id: Annotated[LineTarget, Field(description="The line, L01-L11, or all to pause or resume every line.")],
    enabled: Annotated[
        bool | None, Field(description="Off stops everything on the line, VPD misting included.")
    ] = None,
    vpd_member: Annotated[
        bool | None,
        Field(
            description="L04, L07 and L09: VPD control. When the climate loop wants humidity and its safety gate "
            "passes, the controller may send this mister short mist pulses, one mister at a time by rank (center "
            "first unless another member's own VPD is further above its target), within the line's daily cap and the "
            "daily mist and fog limit. Needs the line enabled (line_disabled otherwise)."
        ),
    ] = None,
    schedule_member: Annotated[bool | None, Field(description="L04, L07 and L09: schedules and runs here.")] = None,
    daily_cap_min: Annotated[int | None, Field(ge=0, le=480, description="Minutes a day; 0 is no cap.")] = None,
    vpd_reserve_min: Annotated[
        int | None, Field(ge=0, le=480, description="Minutes of the cap kept for VPD; at most daily_cap_min.")
    ] = None,
    paused_until: Annotated[
        AwareDatetime | None,
        Field(
            description="ISO date-time with its UTC offset: no scheduled or run-now start until then, though VPD misting "
            "carries on. A time at or before now resumes the line."
        ),
    ] = None,
    manual: Annotated[
        bool | None,
        Field(description="A definition edit stores it, false when left out; alone it sets it; a pause ignores it."),
    ] = None,
    reason: _WaterReason = None,
    request_id: _WaterRequestId = None,
    trigger_id: _WaterTriggerId = None,
    planner_instance: _WaterPlannerInstance = None,
):
    """Changes watering only; it writes no climate value and is not a review.

    Change one line, or pause or resume every line. REST twin: API-IRR-08 (PUT /v1/irrigation/lines/{line_id}). Returns
    {"lines": [...]}: each changed line as irrigation_status shows it, with manual_before. Only the fields you send
    change; line_id all takes only paused_until and reason.

    manual: a definition edit (enabled, vpd_member, schedule_member, daily_cap_min or vpd_reserve_min) stores what you
    pass, false by default, so it clears a person's flag: manual_before says so and Activity shows "manual cleared". A
    pause or resume never changes it, even with manual beside it; manual alone sets it. Only Iris is refused with manual:
    on a manual line, a pause included, and on all while any line is manual.

    Only a person records a line's one-time check, on the dashboard: enabling a line with no recorded check, or turning
    schedule_member on with none, is check_required, and the same call succeeds once it is recorded. Before the
    irrigation firmware the write is stored and reaches the controller with the first program push. The same request_id
    (a UUID) and arguments return the stored result with replayed: true.

    Refusals are the Problem JSON with isError: out_of_range (min and max are the bounds), check_required,
    invalid_request (all with any field but paused_until, manual included; a mister flag off L04, L07 or L09),
    line_disabled (vpd_member true on a line that stays disabled), unknown_target, manual, request_id_reused, forbidden, and unavailable (the database; retry with the same
    request_id)."""
    from verdify_services.irrigation import writes

    definition = {
        name: value
        for name, value in (
            ("enabled", enabled),
            ("vpd_member", vpd_member),
            ("schedule_member", schedule_member),
            ("daily_cap_min", daily_cap_min),
            ("vpd_reserve_min", vpd_reserve_min),
        )
        if value is not None
    }
    fields = definition if paused_until is None else {**definition, "paused_until": paused_until}
    sent_manual = _line_write_manual(line_id, bool(definition), paused_until is not None, manual)

    async def write(conn, actor):
        return await writes.line_update(
            conn,
            actor,
            line_id,
            fields,
            manual=sent_manual,
            reason=reason,
            request_id=request_id,
            trigger_id=trigger_id,
            planner_instance=planner_instance,
        )

    return await _irrigation_write("irrigation_line_set", write)


@mcp.tool()
async def irrigation_run(
    line_id: Annotated[
        LineId | None,
        Field(
            description="The relay to run: L01, L02, L04-L10, or fog L11; L03 takes no runs. Or give circuit_id and "
            "variant instead. Before the firmware: L01."
        ),
    ] = None,
    circuit_id: Annotated[
        Literal["wall_drip", "center_drip", "center_mister", "south_mister", "west_mister"] | None,
        Field(
            description="Instead of line_id (#1336): the physical line: wall_drip (every wall and shelf), center_drip, "
            "center_mister, south_mister or west_mister. Send variant with it."
        ),
    ] = None,
    variant: Annotated[
        Literal["clean", "fertilized"] | None,
        Field(
            description="With circuit_id: clean water, or fertilized (opens the fertilizer master valve L03; clean "
            "never does). A variant whose valve is not wired is unknown_target."
        ),
    ] = None,
    minutes: Annotated[
        int | None,
        Field(
            ge=1,
            le=120,
            description="Drips L01, L02, L05, L06, and fog L11 (1-30). Before the irrigation firmware: L01, left out "
            "or exactly irrig_wall_duration_min.",
        ),
    ] = None,
    prewet_s: Annotated[
        int | None, Field(ge=0, le=1800, description="L02, L06, L08 and L10: clean seconds before the feed.")
    ] = None,
    flush_s: Annotated[
        int | None, Field(ge=0, le=1800, description="L02, L06, L08 and L10: clean seconds after the feed.")
    ] = None,
    on_s: Annotated[int | None, Field(ge=10, le=90, description="Misters L04, L07-L10: seconds per pulse.")] = None,
    count: Annotated[int | None, Field(ge=1, le=60, description="Misters L04, L07-L10: pulses.")] = None,
    gap_s: Annotated[
        int | None, Field(ge=30, le=600, description="Misters L04, L07-L10: seconds between pulses.")
    ] = None,
    reason: _WaterReason = None,
    request_id: _WaterRequestId = None,
    trigger_id: _WaterTriggerId = None,
    planner_instance: _WaterPlannerInstance = None,
):
    """Changes watering only; it writes no climate value and is not a review.

    Run one line now, or be refused; nothing is queued. REST twin: API-IRR-06 (POST /v1/irrigation/lines/{line_id}/run).
    Returns the Command JSON: status pending, then sent, or failed (not sent within 2 min, ended by a Stop, or the line
    already running). Whether water started shows on the line's relay in equipment_state within about 30 s, not here.

    Name the line by its relay (line_id) or as a physical line and variant (circuit_id and variant): a fertilized
    variant runs its fertilizer relay with the master valve, a clean one never opens it.

    Send exactly the fields of the line's kind. Fog L11: minutes, 1-30 (unavailable until the controller runs the
    firmware that takes it). Drips L01, L05: minutes. Fertilizer drips L02, L06: minutes, prewet_s,
    flush_s. Misters L04, L07, L09, Schedule on or off: on_s, count, gap_s. Fertilizer misters L08, L10: on_s,
    count, gap_s, prewet_s, flush_s, never minutes; a rinse needs the clean partner enabled, or the controller ends the
    run skipped.

    Before the irrigation firmware, run works on L01 only: the controller's "Wall Drips - RUN CLEAN" press, which runs
    the wall drip for its irrig_wall_duration_min. Leave minutes out, or send exactly that value.
    irrigation_stop always works and ends a run early.

    Run and stop never carry manual. The same request_id (a UUID) and arguments return the stored command with
    replayed: true.

    Refusals are the Problem JSON with isError: line_busy and manifold_busy (retryable, retry_after_s when known),
    cap_reached, line_disabled, line_paused, line_faulted, not_schedule_member (a mister with Schedule off, only until
    the controller runs the firmware that drops that rule), out_of_range (before the firmware, minutes
    is not irrig_wall_duration_min; min and max give it), invalid_request (a missing field or another kind's, such as
    minutes on L08), unknown_target (L03, or a variant whose valve is not wired), request_id_reused, forbidden, and unavailable (a line other than L01
    before the irrigation firmware, not retryable; the database, retryable with the same request_id)."""
    from verdify_services.irrigation import writes

    async def write(conn, actor):
        return await writes.run(
            conn,
            actor,
            line_id,
            minutes=minutes,
            reason=reason,
            request_id=request_id,
            trigger_id=trigger_id,
            planner_instance=planner_instance,
            prewet_s=prewet_s,
            flush_s=flush_s,
            on_s=on_s,
            count=count,
            gap_s=gap_s,
            circuit_id=circuit_id,
            variant=variant,
        )

    return await _irrigation_write("irrigation_run", write)


@mcp.tool()
async def irrigation_stop(
    line_id: Annotated[
        LineId | None, Field(description="The line to stop, L01-L11; leave it out to stop every wet line.")
    ] = None,
    reason: _WaterReason = None,
    request_id: _WaterRequestId = None,
):
    """Changes watering only; it writes no climate value and is not a review.

    Stop one line, or every wet line when line_id is left out. REST twin: API-IRR-07 (POST /v1/irrigation/stop). Returns
    the Command JSON (kind stop; line_id null for every line). Whether water stopped shows on the relays in
    equipment_state within about 30 s.

    irrigation_stop always works: it is never refused for the firmware, the controller's heap or a writes switch, and it
    goes out ahead of any run. Before the irrigation firmware it ends the wall drip job and switches every open wet relay
    in its scope (L01-L10) off; L11 fog stays with the climate controller.
    After a Stop, VPD misting may pulse again; to keep a line off, disable it. A Stop disables nothing: survival fog and
    the next scheduled run can still start.

    Run and stop never carry manual. The same request_id (a UUID) and arguments return the stored command with
    replayed: true. Refusals are the Problem JSON with isError: unknown_target, invalid_request, request_id_reused,
    forbidden, and unavailable (the database; retry with the same request_id)."""
    from verdify_services.irrigation import writes

    async def write(conn, actor):
        return await writes.stop(conn, actor, line_id, reason=reason, request_id=request_id)

    return await _irrigation_write("irrigation_stop", write)


@mcp.tool()
async def irrigation_clear_fault(
    line_id: Annotated[
        MisterLineId | None, Field(description="The mister to clear: L04, L07 or L09; leave it out for every mister.")
    ] = None,
    reason: _WaterReason = None,
    request_id: _WaterRequestId = None,
):
    """Changes watering only; it writes no climate value and is not a review.

    Clear a mister's watchdog latch, or every mister's when line_id is left out; harmless with nothing latched. REST
    twin: API-IRR-13 (POST /v1/irrigation/clear-fault). Returns the Command JSON (kind clear_fault; line_id null for every
    mister): pending, then sent, or failed when not sent within 2 min. The line's fault in irrigation_status shows whether
    the latch cleared.

    Clear-fault never carries or checks manual. The same request_id (a UUID) and arguments return the stored command with
    replayed: true. Refusals are the Problem JSON with isError: unknown_target (a line with no latch), request_id_reused,
    forbidden, and unavailable (before the irrigation firmware, not retryable, and nothing is stored; the database,
    retryable with the same request_id)."""
    from verdify_services.irrigation import writes

    async def write(conn, actor):
        return await writes.clear_fault(conn, actor, line_id, reason=reason, request_id=request_id)

    return await _irrigation_write("irrigation_clear_fault", write)


# ═══════════════════════════════════════════════════════════════
# IRRIGATION READS (VD-60, #1173)
# ═══════════════════════════════════════════════════════════════
# Thin adapters over verdify_services.irrigation.reads, the functions the operator API's API-IRR-01, -02, -10 and -11
# call: the same models, so the same JSON, and the same Problem JSON with isError on a refusal.

IrrigationCauseArgument = Literal["vpd", "schedule", "run_now", "feed", "prewet", "flush", "fallback", "unknown"]
RunOutcomeArgument = Literal["ok", "short", "stopped", "preempted", "skipped", "missed", "cap", "unknown"]
RunPurposeArgument = Literal["irrigation", "climate"]
# The REST names of the window arguments: `from` is a Python keyword, so the tool says since and until.
_HISTORY_WINDOW_FIELDS = {"from": "since", "to": "until"}


async def _irrigation_read(tool: str, read):
    """Run one irrigation read on its own connection: the REST JSON, or the Problem JSON with isError. The actor
    comes from the request (current_actor(), never an argument); a read records nothing, so it may be None."""
    from verdify_services.actor import Actor
    from verdify_services.problems import ServiceError, problem

    conn = None
    try:
        caller = current_actor()
        actor = None if caller is None else Actor(source=caller.source, name=caller.name)
        conn = await _db()
        model = await read(conn, actor)
    except ServiceError as refused:
        field = _HISTORY_WINDOW_FIELDS.get(refused.problem.field)
        return _tool_problem(refused.problem.model_copy(update={"field": field}) if field else refused.problem)
    except asyncpg.QueryCanceledError:
        return _tool_problem(
            problem(
                "query_timeout",
                f"The database stopped the query at its {MCP_DB_STATEMENT_TIMEOUT_MS // 1000} s limit. "
                "Narrow the window or retry.",
            )
        )
    except Exception as exc:  # the database or its connection; never a refusal
        print(f"[mcp.{tool}] failed: {type(exc).__name__}", file=sys.stderr)
        return _tool_problem(problem("unavailable", "The irrigation service could not answer. Retry."))
    finally:
        if conn is not None:
            await conn.close()
    return _tool_ok(model)


def _history_local_day(name: str, value: str) -> date:
    from verdify_services.problems import ServiceError, problem

    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ServiceError(
            problem("invalid_request", f"With view minutes, {name} is a local date, YYYY-MM-DD.", field=name)
        ) from exc


def _history_moment(name: str, value: str) -> datetime:
    from verdify_services.problems import ServiceError, problem

    try:
        moment = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        moment = None
    if moment is None or moment.utcoffset() is None:
        raise ServiceError(
            problem("invalid_request", f"With view runs, {name} is a date-time with its UTC offset.", field=name)
        )
    return moment


@mcp.tool()
async def irrigation_status():
    """Read the irrigation program as it is now. REST twin: API-IRR-01 (GET /v1/irrigation); the same JSON.

    It only reads and does not count as your plan for a trigger. Returns server_time, the engine flag and the
    program sync, every line (state with its cause and observed_at, flags, manual, pause, fault, today's minutes
    and gallons, next run, last water, last outcome), the active runs, today's minutes by zone, the limits, the leak
    state, occupancy and freshness. Unknown values are null, never 0; a line reads state unknown while the controller
    is not reporting.

    It takes no arguments, so invalid_request and window_too_large never apply. Refusals return the Problem JSON with
    isError: query_timeout (the database stopped the query) and unavailable (the database is out of reach); both are
    retryable."""
    from verdify_services.irrigation import reads

    return await _irrigation_read("irrigation_status", reads.status)


@mcp.tool()
async def get_greenhouse_snapshot():
    """Read the greenhouse snapshot: the 3-5 sentence summary at the top of the dashboard's Now page, written by the
    local Cortex model (llm.primary.longctx) from the current conditions. The same text Now shows (API-02's
    ``snapshot``).

    It only reads and does not count as your plan for a trigger. Returns server_time and snapshot: text,
    generated_at, as_of (the newest run that found the same conditions), model, stale with stale_reason (old: more
    than 30 min; failed: a later attempt failed), and outdated (a band verdict or the open alerts changed since;
    Now hides it). snapshot is null when none was written in the last 2 h. The text is a summary for people, never
    an input to a plan. Refusals: unavailable (the database is out of reach; retryable)."""
    from verdify_services import brief
    from verdify_services.problems import problem

    conn = None
    try:
        conn = await _db()
        model = await brief.read(conn)
    except Exception as exc:  # the database or its connection; never a refusal
        print(f"[mcp.get_greenhouse_snapshot] failed: {type(exc).__name__}", file=sys.stderr)
        return _tool_problem(problem("unavailable", "The greenhouse snapshot could not be read. Retry."))
    finally:
        if conn is not None:
            await conn.close()
    return _tool_ok(model)


@mcp.tool()
async def irrigation_schedule(
    days: Annotated[int, Field(ge=1, le=7, description="Days ahead, today included: 1-7.")] = 7,
    past_days: Annotated[int, Field(ge=0, le=7, description="Days back, planned against actual: 0-7.")] = 0,
):
    """Read the schedules and the week planned against actual. REST twin: API-IRR-02 (GET /v1/irrigation/schedules);
    the same JSON.

    It only reads and does not count as your plan for a trigger. Returns every schedule with its sync, each occurrence
    with its status, the solar times per day, the bounds per line kind (bounds: drip, fert_drip, mister, fert_mister)
    and counts: schedules stored, against max_schedules 24. Before the irrigation firmware a planned occurrence reads
    blocked, "arrives with the irrigation firmware". Unknown values are null, never 0.

    Refusals return the Problem JSON with isError: query_timeout and unavailable (the database; both retryable). days
    or past_days outside their ranges is the REST twin's invalid_request, refused before the tool runs with isError and
    a plain message. Both windows are bounded, so window_too_large never applies."""
    from verdify_services.irrigation import reads

    async def read(conn, actor):
        return await reads.agenda(conn, actor, days=days, past_days=past_days)

    return await _irrigation_read("irrigation_schedule", read)


@mcp.tool()
async def irrigation_history(
    view: Annotated[Literal["minutes", "runs"], Field(description="minutes per day, or the ended runs.")],
    since: Annotated[
        str,
        Field(description="The REST from. minutes: a local date, YYYY-MM-DD. runs: a date-time with its UTC offset."),
    ],
    until: Annotated[
        str,
        Field(
            description="The REST to. minutes: a local date, included. runs: a date-time with its UTC offset, "
            "not included."
        ),
    ],
    group_by: Annotated[
        Literal["zone", "line", "cause"], Field(description="minutes only: what each row totals by.")
    ] = "zone",
    line: Annotated[LineId | None, Field(description="runs only: one line, L01-L11.")] = None,
    cause: Annotated[IrrigationCauseArgument | None, Field(description="runs only: why water ran.")] = None,
    outcome: Annotated[RunOutcomeArgument | None, Field(description="runs only: how a run ended.")] = None,
    cursor: Annotated[str | None, Field(description="runs only: next_cursor of the page before.")] = None,
    purpose: Annotated[
        RunPurposeArgument | None,
        Field(
            description="irrigation (watering: schedule, run_now, feed, prewet, flush) or climate (VPD and fallback "
            "misting, and fog); omit for both."
        ),
    ] = None,
):
    """Read watering history. REST twins: view minutes is API-IRR-10 (GET /v1/irrigation/minutes) and view runs is
    API-IRR-11 (GET /v1/irrigation/runs); the same JSON.

    It only reads and does not count as your plan for a trigger. since and until are the REST from and to.

    View minutes: minutes, pulses and whole gallons per local day (America/Denver), up to 400 days, by group_by and
    always split by cause, purpose and chemistry. A day with coverage no_data has no rows: a gap, never 0.

    View runs: the ended runs, newest first, up to 31 days, 50 to a page, filtered by line, cause, outcome and
    purpose; pass next_cursor as cursor for the next page. The run in progress is in irrigation_status.

    Every row carries its purpose: irrigation (watering plants) or climate (VPD and fallback misting, and every fog
    run), which outnumbers irrigation many times over. purpose keeps one of them in either view; omitted, both are
    returned. "Did the plants get watered?" is purpose irrigation.

    Unknown values are null, never 0. Refusals return the Problem JSON with isError: window_too_large (a wider window;
    max gives the limit), invalid_request (a bad since, until or cursor, or an argument that does not belong to the
    view, such as outcome with minutes; field names it), query_timeout and unavailable (the database; both
    retryable). A value outside an enum is refused before the tool runs, with isError and a plain message."""
    from verdify_services.irrigation import reads
    from verdify_services.problems import ServiceError, problem

    try:
        if view == "minutes":
            other_view = {"line": line, "cause": cause, "outcome": outcome, "cursor": cursor}
            for name, value in other_view.items():
                if value is not None:
                    raise ServiceError(problem("invalid_request", f"{name} belongs to view runs.", field=name))
            first, last = _history_local_day("since", since), _history_local_day("until", until)

            async def read(conn, actor):
                return await reads.minutes(conn, actor, first, last, group_by, purpose=purpose)

        else:
            if group_by != "zone":
                raise ServiceError(problem("invalid_request", "group_by belongs to view minutes.", field="group_by"))
            start, end = _history_moment("since", since), _history_moment("until", until)

            async def read(conn, actor):
                return await reads.runs(
                    conn, actor, start, end, line=line, cause=cause, outcome=outcome, cursor=cursor, purpose=purpose
                )

    except ServiceError as refused:
        return _tool_problem(refused.problem)
    return await _irrigation_read("irrigation_history", read)


# ═══════════════════════════════════════════════════════════════
# PLANTING TOOLS (#1328): verdify_services.crops, the Crops page's service
# ═══════════════════════════════════════════════════════════════
# Records only: no tool here changes a setting, band or target. Open to named agents and admin; Iris stays read-only
# on plantings (its crops tool refuses create and deactivate). Each write returns the planting with its resolved cells
# and id, so undo is remove_planting(end_reason="removed").

_Positions = Annotated[
    list[str],
    Field(
        min_length=1,
        max_length=40,
        description=(
            "Places, each a label (EAST-HYDRO-12), a range (EAST-HYDRO-1..10, hydro 1-30), a rail (rail A top), "
            "shelf cells (west top 1-3), every cell of a place (all south shelves), a shelf (south floor, hanging) "
            "or a zone (center). Ambiguous text is refused with the candidates."
        ),
    ),
]
_PlantingId = Annotated[int, Field(ge=1, le=2**31 - 1, description="The planting id (crops.id).")]
_PlantingWhen = Annotated[
    str | None, Field(description="ISO 8601 time with offset, or a date (local midnight); default now.")
]
_PlantingReason = Annotated[str | None, Field(max_length=500, description="Why; shown in Activity.")]
_PlantingRequestId = Annotated[
    str | None, Field(description="A UUID; the same one and arguments replay the stored result.")
]


def _when(value: str | None):
    """An ISO time or date as the service takes it; text it cannot read is left for its validation."""
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value) if "T" in value or " " in value.strip() else date.fromisoformat(value)
    except ValueError:
        return value


async def _planting_read(tool: str, read, *, records: str = "The planting records"):
    conn = None
    try:
        conn = await _db()
        model = await read(conn)
    except ServiceError as refused:
        return _tool_problem(refused.problem)
    except asyncpg.QueryCanceledError:
        return _tool_problem(problem("query_timeout", "The database stopped the query at its limit. Retry."))
    except Exception as exc:  # the database or its connection; never a refusal
        print(f"[mcp.{tool}] failed: {type(exc).__name__}", file=sys.stderr)
        return _tool_problem(problem("unavailable", f"{records} could not be read. Retry."))
    finally:
        if conn is not None:
            await conn.close()
    return _tool_ok(model)


async def _planting_write(tool: str, write, *, kind: str = "planting"):
    """One planting (or other records) write as the request's actor (current_actor(), never an argument) on its own
    connection."""
    caller = current_actor()
    if caller is None:
        return _tool_problem(problem("forbidden", f"A {kind} write needs a resolved caller: a named agent or admin"))
    actor = ServiceActor(source=caller.source, name=caller.name)
    conn = None
    try:
        conn = await _db()
        result = await write(conn, actor)
    except ServiceError as refused:
        return _tool_problem(refused.problem)
    except Exception as exc:  # the database or its connection; never a refusal
        print(f"[mcp.{tool}] failed: {type(exc).__name__}", file=sys.stderr)
        return _tool_problem(
            problem(
                "unavailable",
                f"The {kind} service could not answer. Retry with the same request_id: it stores the write once",
            )
        )
    finally:
        if conn is not None:
            await conn.close()
    return _tool_ok(result.value, replayed=result.replayed)


def _body(**fields) -> dict[str, Any]:
    return {name: value for name, value in fields.items() if value is not None}


@mcp.tool()
async def crop_locations(
    zone: Annotated[str | None, Field(description="Keep one zone: center, east, north, south or west.")] = None,
):
    """Read the location tree and what each place holds now. REST twin: API-CROP-01 (GET /v1/crops/locations).

    Returns every zone, its shelves (wall, kind, tier, the irrigation lines that reach it) and their cells (layout
    group, row and column), with the plantings at zone and shelf level and each cell's occupant. A zone or shelf holds
    any number of plantings; a cell at most one. Reads only."""
    return await _planting_read("crop_locations", lambda conn: crop_service.locations(conn, zone=zone))


@mcp.tool()
async def resolve_positions(
    positions: _Positions,
    at: _PlantingWhen = None,
    planting_id: Annotated[
        int | None, Field(ge=1, description="Leave this planting out of the conflicts (its own cells on a move).")
    ] = None,
):
    """Preview what place text means, writing nothing. REST twin: API-CROP-06 (GET /v1/crops/resolve).

    Returns places (zone, shelf, cell), cells, where (compressed, e.g. EAST-HYDRO-1..10) and conflicts: the plantings
    holding those cells at `at`. Refusals: invalid_request (unreadable text), ambiguous_position (current lists the
    candidates)."""
    return await _planting_read(
        "resolve_positions",
        lambda conn: crop_service.resolve(conn, positions, at=_when(at), planting_id=planting_id),
    )


@mcp.tool()
async def record_planting(
    crop: Annotated[str, Field(min_length=1, max_length=200, description="Catalog slug or name (lettuce), or a name.")],
    positions: _Positions,
    variety: Annotated[str | None, Field(max_length=200)] = None,
    count: Annotated[int | None, Field(ge=0, description="Plants in the planting; leave it out when unknown.")] = None,
    count_per_cell: Annotated[int | None, Field(ge=0, description="Plants in each cell, when cells are named.")] = None,
    planted_at: _PlantingWhen = None,
    stage: Annotated[str | None, Field(description="seed (default), germination, seedling, vegetative, ...")] = None,
    notes: Annotated[str | None, Field(max_length=2000)] = None,
    replace: Annotated[
        bool, Field(description="End or trim whatever holds a requested cell instead of refusing.")
    ] = False,
    dry_run: Annotated[bool, Field(description="Resolve and show conflicts only; nothing is written.")] = False,
    reason: _PlantingReason = None,
    request_id: _PlantingRequestId = None,
):
    """Record one planting across the places named. REST twin: API-CROP-07 (POST /v1/crops/plantings).

    Records only: it changes no setting, band or target. Returns the planting with its id, cells and where; undo is
    remove_planting(end_reason="removed"). A cell already held is refused with position_occupied (current names the
    cells) unless replace. dry_run returns the API-CROP-06 preview instead. Refusals: invalid_request,
    ambiguous_position, position_occupied, request_id_reused, forbidden."""
    if dry_run:
        return await _planting_read(
            "record_planting", lambda conn: crop_service.resolve(conn, positions, at=_when(planted_at))
        )
    body = _body(
        crop=crop,
        positions=positions,
        variety=variety,
        count=count,
        count_per_cell=count_per_cell,
        planted_at=_when(planted_at),
        stage=stage,
        notes=notes,
        replace=replace,
        reason=reason,
    )
    return await _planting_write(
        "record_planting", lambda conn, actor: crop_service.plant(conn, actor, body, request_id=request_id)
    )


class PlantingItem(BaseModel):
    """One planting of a bulk re-plant: record_planting's arguments."""

    model_config = ConfigDict(extra="forbid")

    crop: str = Field(min_length=1, max_length=200)
    positions: list[str] = Field(min_length=1, max_length=40)
    variety: str | None = Field(default=None, max_length=200)
    count: int | None = Field(default=None, ge=0)
    count_per_cell: int | None = Field(default=None, ge=0)
    stage: str | None = None
    notes: str | None = Field(default=None, max_length=2000)


@mcp.tool()
async def record_plantings(
    items: Annotated[list[PlantingItem], Field(min_length=1, max_length=40, description="The plantings, in order.")],
    planted_at: _PlantingWhen = None,
    replace: Annotated[bool, Field(description="Each item ends or trims what holds its cells.")] = False,
    reason: _PlantingReason = None,
    request_id: _PlantingRequestId = None,
):
    """Bulk re-plant: record several plantings at one time, each as record_planting would. No REST twin (the
    dashboard sends API-CROP-07 per planting).

    Each item is its own write: one refused does not stop the rest. Returns {"results": [...]}, one per item in
    order, each the planting or {"problem": <Problem JSON>}. With request_id each item's key is derived from it and
    the item's index, so a retry replays what was stored."""
    from uuid import uuid5

    base = None
    if request_id is not None:
        try:
            base = UUID(request_id)
        except ValueError:
            return _tool_problem(problem("invalid_request", "request_id is a UUID", field="request_id"))
    caller = current_actor()
    if caller is None:
        return _tool_problem(problem("forbidden", "A planting write needs a resolved caller: a named agent or admin"))
    actor = ServiceActor(source=caller.source, name=caller.name)
    results: list[dict[str, Any]] = []
    conn = None
    try:
        conn = await _db()
        for index, item in enumerate(items):
            body = _body(**item.model_dump(), planted_at=_when(planted_at), replace=replace, reason=reason)
            key = None if base is None else uuid5(base, f"record_plantings:{index}")
            try:
                result = await crop_service.plant(conn, actor, body, request_id=key)
            except ServiceError as refused:
                results.append({"problem": refused.problem.body()})
                continue
            entry = result.value.model_dump(mode="json")
            results.append({**entry, "replayed": True} if result.replayed else entry)
    except Exception as exc:  # the database or its connection; never a refusal
        print(f"[mcp.record_plantings] failed: {type(exc).__name__}", file=sys.stderr)
        return _tool_problem(
            problem("unavailable", "The planting service could not answer. Retry with the same request_id")
        )
    finally:
        if conn is not None:
            await conn.close()
    return _tool_result({"results": results})


@mcp.tool()
async def move_planting(
    planting_id: _PlantingId,
    to_positions: _Positions,
    from_positions: Annotated[
        list[str] | None, Field(description="The places it leaves; default every place it is now.")
    ] = None,
    moved_at: _PlantingWhen = None,
    replace: Annotated[bool, Field(description="End or trim whatever holds a destination cell.")] = False,
    reason: _PlantingReason = None,
    request_id: _PlantingRequestId = None,
):
    """Move a planting; the old and new places both stay in its history. REST twin: API-CROP-08.

    Refusals: invalid_request, ambiguous_position, position_occupied, planting_ended, unknown_target,
    request_id_reused."""
    body = _body(
        to_positions=to_positions,
        from_positions=from_positions,
        moved_at=_when(moved_at),
        replace=replace,
        reason=reason,
    )
    return await _planting_write(
        "move_planting", lambda conn, actor: crop_service.move(conn, actor, planting_id, body, request_id=request_id)
    )


@mcp.tool()
async def harvest_planting(
    planting_id: _PlantingId,
    count: Annotated[int | None, Field(ge=0, description="Units harvested.")] = None,
    weight_kg: Annotated[float | None, Field(ge=0, le=10000)] = None,
    positions: Annotated[list[str] | None, Field(description="Cells cleared by this harvest; default none.")] = None,
    final: Annotated[bool, Field(description="The last harvest: the planting ends as harvested.")] = False,
    harvested_at: _PlantingWhen = None,
    notes: Annotated[str | None, Field(max_length=2000)] = None,
    reason: _PlantingReason = None,
    request_id: _PlantingRequestId = None,
):
    """Record a harvest; partial unless final. REST twin: API-CROP-09.

    Clearing every place it holds also ends the planting. Refusals: invalid_request, planting_ended, unknown_target,
    request_id_reused."""
    body = _body(
        count=count,
        weight_kg=weight_kg,
        positions=positions,
        final=final,
        harvested_at=_when(harvested_at),
        notes=notes,
        reason=reason,
    )
    return await _planting_write(
        "harvest_planting",
        lambda conn, actor: crop_service.harvest(conn, actor, planting_id, body, request_id=request_id),
    )


@mcp.tool()
async def remove_planting(
    planting_id: _PlantingId,
    end_reason: Annotated[Literal["failed", "removed", "reconciled"], Field(description="Why it ended.")],
    at: _PlantingWhen = None,
    note: Annotated[str | None, Field(max_length=2000)] = None,
    reason: _PlantingReason = None,
    request_id: _PlantingRequestId = None,
):
    """End a planting without a harvest; every open place closes. REST twin: API-CROP-10. Undo by recording it
    again. Refusals: invalid_request, planting_ended, unknown_target, request_id_reused."""
    body = _body(end_reason=end_reason, at=_when(at), note=note, reason=reason)
    return await _planting_write(
        "remove_planting",
        lambda conn, actor: crop_service.end(conn, actor, planting_id, body, request_id=request_id),
    )


@mcp.tool()
async def annotate_planting(
    planting_id: _PlantingId,
    note: Annotated[str, Field(min_length=1, max_length=2000)],
    reason: _PlantingReason = None,
    request_id: _PlantingRequestId = None,
):
    """Add a note to a planting's history (ended plantings too). Returns the event. Refusals: unknown_target,
    request_id_reused."""
    body = _body(note=note, reason=reason)
    return await _planting_write(
        "annotate_planting",
        lambda conn, actor: crop_service.annotate(conn, actor, planting_id, body, request_id=request_id),
    )


@mcp.tool()
async def planting_history(
    planting_id: Annotated[int | None, Field(ge=1, description="One planting: its places, events, harvests.")] = None,
    position: Annotated[str | None, Field(description="One cell label: who has held it, current first.")] = None,
    active: Annotated[
        bool | None, Field(description="With neither: true active (default), false ended, null both.")
    ] = True,
    zone: Annotated[str | None, Field(description="With neither: plantings ever in this zone.")] = None,
    limit: Annotated[int, Field(ge=1, le=500)] = 100,
):
    """Read plantings. REST twins: API-CROP-03 (planting_id), API-CROP-04 (position) and API-CROP-02 (list)."""
    if planting_id is not None:
        return await _planting_read("planting_history", lambda conn: crop_service.planting(conn, planting_id))
    if position is not None:
        return await _planting_read("planting_history", lambda conn: crop_service.position_history(conn, position))
    return await _planting_read(
        "planting_history", lambda conn: crop_service.plantings(conn, active=active, zone=zone, limit=limit)
    )


# Soil-moisture targets (#1345, migration 303): API-SOIL-01/02's twins over verdify_services.soil. wilt_pct is what
# the ingestor's soil_dryout rule pages on; the probe map is read-only here.
_SoilPct = Annotated[float | None, Field(ge=0, le=100, description="Percent volumetric water content.")]


@mcp.tool()
async def soil_targets():
    """Read every probe zone's soil-moisture target. REST twin: API-SOIL-01 (GET /v1/soil-targets).

    Each target has zone, wilt_pct (soil_dryout pages when the probe stays below it for more than 2 h in the day),
    min_pct, max_pct, saturation_pct, notes, the probe it reads (probe, sensor_id, occupancy_zone) and who last
    changed it. Targets are plant-agnostic: no crop is named. Reads only."""
    return await _planting_read("soil_targets", soil_service.targets, records="The soil targets")


@mcp.tool()
async def soil_target_set(
    zone: Annotated[str, Field(min_length=1, max_length=40, description="The probe zone: south_1, south_2 or west.")],
    wilt_pct: _SoilPct = None,
    min_pct: _SoilPct = None,
    max_pct: _SoilPct = None,
    saturation_pct: _SoilPct = None,
    notes: Annotated[str | None, Field(max_length=500)] = None,
    reason: _PlantingReason = None,
    request_id: _PlantingRequestId = None,
):
    """Change one zone's soil-moisture thresholds or note. REST twin: API-SOIL-02 (PUT /v1/soil-targets/{zone}).

    Give only the fields that change; the result must keep 0 <= wilt < min < max < saturation <= 100. A wilt_pct
    change moves the soil_dryout page on the ingestor's next cycle. Returns the stored target. Refusals: not_found
    (unknown zone), out_of_range (order or bounds), invalid_request (no field given)."""
    body = _body(wilt_pct=wilt_pct, min_pct=min_pct, max_pct=max_pct, saturation_pct=saturation_pct, notes=notes)
    return await _planting_write(
        "soil_target_set",
        lambda conn, actor: soil_service.set_target(conn, actor, zone, body, reason=reason, request_id=request_id),
        kind="soil target",
    )


# ═══════════════════════════════════════════════════════════════
# AUTHORIZATION INVENTORY GUARD (#585)
# ═══════════════════════════════════════════════════════════════


def _sync_registered_tool_names() -> frozenset[str] | None:
    """Unfiltered registered tool names, or None under CI import stubs.

    Startup deliberately reads the internal tool manager rather than the
    audience-filtered protocol ``list_tools`` override. Schema-only and logic
    CI import this module with a lightweight FastMCP stub that has no
    _tool_manager; the completeness guard then runs in
    tests/test_mcp_audience_auth.py against the stub's recorded registrations
    instead of here.
    """
    manager = getattr(mcp, "_tool_manager", None)
    if manager is None:
        return None
    return frozenset(tool.name for tool in manager.list_tools())


def _assert_tool_audience_registry_complete() -> None:
    """Fail startup if any registered tool could bypass audience authorization."""
    for name, audiences in TOOL_AUDIENCES.items():
        if not audiences or not audiences <= KNOWN_AUDIENCES:
            raise AssertionError(f"TOOL_AUDIENCES[{name!r}] must be a non-empty subset of {sorted(KNOWN_AUDIENCES)}")
        if "admin" not in audiences:
            raise AssertionError(f"TOOL_AUDIENCES[{name!r}] must include 'admin' (admin means ALL tools)")
    masked = sorted(set(TOOL_AUDIENCES) & set(PENDING_TOOL_AUDIENCES))
    if masked:
        raise AssertionError(f"tools present in both TOOL_AUDIENCES and PENDING_TOOL_AUDIENCES: {masked}")
    registered = _sync_registered_tool_names()
    if registered is None:
        return
    unauthorized = sorted(registered - set(TOOL_AUDIENCES))
    stale = sorted(set(TOOL_AUDIENCES) - registered)
    if unauthorized:
        raise AssertionError(
            f"registered MCP tools missing from TOOL_AUDIENCES (would bypass #585 authorization): {unauthorized}"
        )
    if stale:
        raise AssertionError(f"TOOL_AUDIENCES entries with no registered tool: {stale}")


_assert_tool_audience_registry_complete()


# ═══════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # One JSON line per allowed dispatch, independent of Uvicorn/root log levels.
    _audit_handler = logging.StreamHandler(sys.stdout)
    _audit_handler.setFormatter(logging.Formatter("%(message)s"))
    _TOOL_AUDIT_LOGGER.addHandler(_audit_handler)
    _TOOL_AUDIT_LOGGER.propagate = False
    os.environ.setdefault("MCP_HTTP_HOST", "127.0.0.1")
    os.environ.setdefault("MCP_HTTP_PORT", "8000")
    if _mcp_runtime_db_role_required():

        async def _startup_db_attestation() -> None:
            conn = await _db()
            await conn.close()

        asyncio.run(_startup_db_attestation())
    mcp.run(transport="streamable-http")
