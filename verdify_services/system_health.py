"""System health: API-35 (the controller's hardware budget), API-36 (data continuity) and API-37 (delivery).

These reads and the operator API's ``/metrics`` (``api/product_metrics.py``) share one definition of each number:
the statements below are the ones the metrics timer runs, and ``product_metrics`` imports them from here, so the
dashboard and the estate Prometheus dashboard can never disagree. Each read runs in one read-only repeatable-read
transaction, so all its statements see one snapshot (``series._read_transaction``: the dashboard login's 10 s timeout,
a timeout is 503 ``query_timeout``), every
hypertable predicate is bounded by time, ``diagnostics`` values are the newest non-null value per column over
15 minutes, and a value nothing reported is null, never 0.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Literal

import asyncpg
from pydantic import AwareDatetime, BaseModel, BeforeValidator, ConfigDict, Field

from verdify_schemas.setting_help import setting_label
from verdify_schemas.tunable_registry import REGISTRY
from verdify_services import law, series
from verdify_services.reads import _int_from_query

# ── the shared statements (api/product_metrics.py runs the same text) ─────────

# Probe-backed climate columns (sensor_registry source_table climate). Derived columns (averages, targets, deltas)
# are not probes and are left out.
PROBES = (
    "temp_north",
    "temp_south",
    "temp_east",
    "temp_west",
    "temp_case",
    "temp_intake",
    "rh_north",
    "rh_south",
    "rh_east",
    "rh_west",
    "rh_case",
    "intake_rh",
    "outdoor_temp_f",
    "outdoor_rh_pct",
    "co2_ppm",
    "lux",
    "soil_moisture_south_1",
    "soil_moisture_south_2",
    "soil_moisture_west",
    "soil_temp_south_1",
    "soil_temp_south_2",
    "soil_temp_west",
    "soil_ec_south_1",
)
PROBE_WINDOW_S = 7200  # an age of 7200 means "not seen in the 2 h window"
FLOW_TABLES = ("climate", "equipment_state", "system_state", "diagnostics", "setpoint_snapshot", "setpoint_changes")

# Each column the newest non-NULL value of the last 15 minutes (release 3 review ALERTS-5): readings are stored on
# change, so the newest diagnostics row alone often lacks them. Index range scan of diagnostics_ts_idx.
# With the same non-NULL filter, max(ts) is the chosen value's receipt time, including when rows share that time.
CONTROLLER_SQL = """
SELECT extract(epoch FROM now() - max(ts))::float8 AS age_s,
       (array_agg(heap_bytes ORDER BY ts DESC) FILTER (WHERE heap_bytes IS NOT NULL))[1] AS heap_bytes,
       (array_agg(heap_min_free_kb ORDER BY ts DESC) FILTER (WHERE heap_min_free_kb IS NOT NULL))[1] AS heap_min_free_kb,
       (array_agg(heap_largest_free_block_kb ORDER BY ts DESC) FILTER (WHERE heap_largest_free_block_kb IS NOT NULL))[1] AS heap_largest_free_block_kb,
       (array_agg(wifi_rssi ORDER BY ts DESC) FILTER (WHERE wifi_rssi IS NOT NULL))[1] AS wifi_rssi,
       (array_agg(uptime_s ORDER BY ts DESC) FILTER (WHERE uptime_s IS NOT NULL))[1] AS uptime_s,
       date_part('epoch', max(ts) FILTER (WHERE uptime_s IS NOT NULL))::float8 AS uptime_s_observed_epoch,
       (array_agg(reset_reason ORDER BY ts DESC) FILTER (WHERE reset_reason IS NOT NULL))[1] AS reset_reason,
       (array_agg(firmware_version ORDER BY ts DESC) FILTER (WHERE firmware_version IS NOT NULL))[1] AS firmware_version,
       date_part('epoch', max(ts) FILTER (WHERE firmware_version IS NOT NULL))::float8 AS firmware_version_observed_epoch,
       (array_agg(sntp_valid ORDER BY ts DESC) FILTER (WHERE sntp_valid IS NOT NULL))[1] AS sntp_valid,
       (array_agg(sntp_miss_count ORDER BY ts DESC) FILTER (WHERE sntp_miss_count IS NOT NULL))[1] AS sntp_miss_count,
       (array_agg(last_sntp_sync_age_s ORDER BY ts DESC) FILTER (WHERE last_sntp_sync_age_s IS NOT NULL))[1] AS last_sntp_sync_age_s,
       (array_agg(active_probe_count ORDER BY ts DESC) FILTER (WHERE active_probe_count IS NOT NULL))[1] AS active_probe_count,
       (array_agg(band_source ORDER BY ts DESC) FILTER (WHERE band_source IS NOT NULL))[1] AS band_source
  FROM diagnostics
 WHERE ts > now() - interval '15 minutes'
"""

# The nine budget readings (migration 314) and the three third-flash counters (migration 315), each the newest non-NULL value of the last 15 minutes: a diagnostics row
# carries only the columns observed fresh in its flush, so the newest row alone can miss a published reading. One
# index range scan of diagnostics_ts_idx over about 15 to 60 rows.
HEALTH_SQL = """
SELECT (array_agg(heap_min_free_minute_kb ORDER BY ts DESC)
            FILTER (WHERE heap_min_free_minute_kb IS NOT NULL))[1] AS heap_min_free_minute_kb,
       date_part('epoch', max(ts) FILTER (WHERE heap_min_free_minute_kb IS NOT NULL))::float8 AS heap_min_free_minute_kb_observed_epoch,
       (array_agg(heap_largest_block_minute_low_kb ORDER BY ts DESC)
            FILTER (WHERE heap_largest_block_minute_low_kb IS NOT NULL))[1] AS heap_largest_block_minute_low_kb,
       date_part('epoch', max(ts) FILTER (WHERE heap_largest_block_minute_low_kb IS NOT NULL))::float8 AS heap_largest_block_minute_low_kb_observed_epoch,
       (array_agg(loop_worst_ms ORDER BY ts DESC) FILTER (WHERE loop_worst_ms IS NOT NULL))[1] AS loop_worst_ms,
       (array_agg(restart_count ORDER BY ts DESC) FILTER (WHERE restart_count IS NOT NULL))[1] AS restart_count,
       date_part('epoch', max(ts) FILTER (WHERE restart_count IS NOT NULL))::float8 AS restart_count_observed_epoch,
       (array_agg(nvs_used_entries ORDER BY ts DESC)
            FILTER (WHERE nvs_used_entries IS NOT NULL))[1] AS nvs_used_entries,
       (array_agg(nvs_free_entries ORDER BY ts DESC)
            FILTER (WHERE nvs_free_entries IS NOT NULL))[1] AS nvs_free_entries,
       (array_agg(nvs_write_worst_ms ORDER BY ts DESC)
            FILTER (WHERE nvs_write_worst_ms IS NOT NULL))[1] AS nvs_write_worst_ms,
       (array_agg(gap_log_state ORDER BY ts DESC) FILTER (WHERE gap_log_state IS NOT NULL))[1] AS gap_log_state,
       (array_agg(sensor_degraded_active ORDER BY ts DESC)
            FILTER (WHERE sensor_degraded_active IS NOT NULL))[1] AS sensor_degraded_active,
       (array_agg(loop_stack_high_water_b ORDER BY ts DESC)
            FILTER (WHERE loop_stack_high_water_b IS NOT NULL))[1] AS loop_stack_high_water_b,
       (array_agg(wifi_disconnect_count ORDER BY ts DESC)
            FILTER (WHERE wifi_disconnect_count IS NOT NULL))[1] AS wifi_disconnect_count,
       (array_agg(api_client_count ORDER BY ts DESC)
            FILTER (WHERE api_client_count IS NOT NULL))[1] AS api_client_count
  FROM diagnostics
 WHERE ts > now() - interval '15 minutes'
"""

# One pass over the last 2 h of climate rows (~120-240 rows).
PROBES_SQL = (
    "SELECT "
    + ", ".join(
        f"extract(epoch FROM now() - max(ts) FILTER (WHERE {column} IS NOT NULL))::float8 AS {column}"
        for column in PROBES
    )
    + f" FROM climate WHERE ts > now() - interval '{PROBE_WINDOW_S} seconds'"
)

FRESHNESS_SQL = "SELECT " + ", ".join(
    f"(SELECT extract(epoch FROM now() - max(ts))::float8 FROM {table} WHERE ts > now() - interval '1 day') AS {table}"
    for table in FLOW_TABLES
)

FLOW_SQL = "SELECT " + ", ".join(
    f"(SELECT count(*) FROM {table} WHERE ts > now() - interval '5 minutes') AS {table}" for table in FLOW_TABLES
)

# Outage only: 314's view cuts the minutes the gap log replayed out of each gap (a fully replayed gap has no row,
# a partly replayed one keeps its unreplayed pieces), so n counts gaps with an unreplayed piece and seconds the
# unreplayed seconds (#1633, release review READERS-3).
GAPS_SQL = """
SELECT coalesce(backfill_status, 'none') AS status, count(DISTINCT id) AS n,
       coalesce(sum(duration_s), 0)::float8 AS seconds
  FROM v_data_gaps_unreplayed
 WHERE start_ts > now() - interval '7 days'
 GROUP BY 1
"""

# verdify_data_gaps_unreplayed: a gap the controller's gap log should have replayed and did not. Every data_gaps row
# is a recorder disconnect of more than 120 s (ingestor.py), and a quarter the recorder was not attached for is not
# live, so the log replays it once the recorder has been back 60 s; the quarter holding a gap's end closes at most
# 15 minutes after it. So 30 minutes after a gap ended its pieces are gone when the log was armed (its newest
# gap_log_state in the hour before the piece), and a piece of 120 s or more left then is a broken replay. Shorter
# pieces are left to clock skew between the host's gap times and the controller's record times.
UNREPLAYED_SQL = """
SELECT count(DISTINCT u.id)
  FROM v_data_gaps_unreplayed u
 WHERE u.duration_s >= 120
   AND u.end_ts > now() - interval '24 hours' AND u.end_ts <= now() - interval '30 minutes'
   AND (SELECT d.gap_log_state FROM diagnostics d
         WHERE d.gap_log_state IS NOT NULL AND d.ts <= u.start_ts AND d.ts > u.start_ts - interval '1 hour'
         ORDER BY d.ts DESC LIMIT 1) = 'armed'
"""

# setpoint_changes by delivery status and source over a window. The metrics timer runs the 24 h text (DELIVERY_SQL);
# API-37 runs the same text over its window. The window is a literal, so the plan's chunk exclusion stays constant.
_DELIVERY_TEMPLATE = """
SELECT coalesce(delivery_status, 'pending') AS status, coalesce(source, 'none') AS source, count(*) AS n
  FROM setpoint_changes
 WHERE ts > now() - interval '{window}'
 GROUP BY 1, 2
"""

# idx_setpoint_changes_unconfirmed (ts DESC) WHERE confirmed_at IS NULL: the predicate is the index's, and the
# delivery_status filter runs on its rows. A push that ended (superseded, failed, expired, cancelled) or a value the
# controller reported (observed) waits for nothing.
_OLDEST_UNCONFIRMED_TEMPLATE = """
SELECT coalesce(extract(epoch FROM now() - min(ts)), 0)::float8
  FROM setpoint_changes
 WHERE ts > now() - interval '{window}' AND confirmed_at IS NULL
   AND coalesce(delivery_status, 'pending') NOT IN ('superseded', 'failed', 'expired', 'cancelled', 'observed')
"""

DELIVERY_SQL = _DELIVERY_TEMPLATE.format(window="24 hours")
OLDEST_UNCONFIRMED_SQL = _OLDEST_UNCONFIRMED_TEMPLATE.format(window="24 hours")

# ── the controller hardware budget (package 2.4) ─────────────────────────────
# Each threshold has one definition, in the firmware or (for the loop stack, which the firmware does not guard) in
# the estate alert rule. Neither ships in the API image, so the numbers are copied here and
# tests/test_verdify_services_system_health.py reads each firmware source in the checkout and fails when one drifts.
HEAP_WARNING_KB = 25.0  # firmware/greenhouse.yaml bs_heap_pressure_warning: free heap under 25 KB for 2 min
HEAP_CRITICAL_KB = 15.0  # firmware/greenhouse.yaml bs_heap_pressure_critical: free heap under 15 KB
LARGEST_BLOCK_KB = 16.0  # firmware/lib/heap_diagnostics.h GH_PRE_OTA_MIN_LARGEST_BLOCK_KB (an update needs it)
OTA_FREE_KB = 32.0  # firmware/lib/heap_diagnostics.h GH_PRE_OTA_MIN_FREE_HEAP_KB
LOOP_WORST_MS = 250.0  # firmware/lib/heap_diagnostics.h GH_CONTROL_LOOP_WARN_US (250,000 us)
NVS_WRITE_MS = 200.0  # firmware/lib/gap_log.h SLOW_WRITE_US (200,000 us): slow writes stop the gap log
STACK_FREE_B = 1024.0  # jvallery/monitoring-stack alert VerdifyControllerLoopStackLow (under 1,024 B for 5 min)
NVS_ARM_FREE_PCT = 25.0  # firmware/lib/gap_log.h ARM_MIN_FREE_PCT
NVS_STOP_FREE_PCT = 15.0  # firmware/lib/gap_log.h STOP_FREE_PCT

# ── API-35 to API-37's own statements ──────────────────────────────────────

NOW_SQL = "SELECT now()"

# The newest uptime reading with its own time (booted_at comes from this one pair) and the probe summary, by
# CONTROLLER_SQL's rule.
CONTROLLER_EXTRA_SQL = """
SELECT (array_agg(uptime_s ORDER BY ts DESC) FILTER (WHERE uptime_s IS NOT NULL))[1] AS uptime_s,
       (array_agg(ts ORDER BY ts DESC) FILTER (WHERE uptime_s IS NOT NULL))[1] AS uptime_at,
       (array_agg(probe_health ORDER BY ts DESC) FILTER (WHERE probe_health IS NOT NULL))[1] AS probe_health
  FROM diagnostics
 WHERE ts > now() - interval '15 minutes'
"""

# Newest row per entity through idx_system_state_entity (entity, ts DESC), 7 d of chunks at most (STATE_SQL's rule,
# with the row's time).
STATE_ROWS_SQL = """
SELECT e.entity, s.ts, s.value
  FROM unnest($1::text[]) AS e(entity)
  CROSS JOIN LATERAL (
        SELECT ts, value FROM system_state
         WHERE entity = e.entity AND ts > now() - interval '7 days'
         ORDER BY ts DESC
         LIMIT 1) s
"""

OUTAGE_LIMIT = 200
REPLAYED_LIMIT = 200
FAILING_LIMIT = 50

# The unreplayed pieces of every outage that overlaps the window (GAPS_SQL's view).
OUTAGES_SQL = f"""
SELECT start_ts, end_ts, round(duration_s::numeric)::int AS duration_s, coalesce(reason, 'unknown') AS reason,
       coalesce(backfill_status, 'none') AS status
  FROM v_data_gaps_unreplayed
 WHERE end_ts > now() - make_interval(days => $1::int)
 ORDER BY start_ts DESC, id DESC
 LIMIT {OUTAGE_LIMIT}
"""

# The replayed quarters (migration 320's projection of gap_replay_quarters); a quarter with no record has no span.
REPLAYED_SQL = f"""
SELECT boot, qseq, first_ts, last_ts, received_at, climate_rows, transition_rows
  FROM public.v_dashboard_gap_replay
 WHERE last_ts > now() - make_interval(days => $1::int)
 ORDER BY last_ts DESC, boot DESC, qseq DESC
 LIMIT {REPLAYED_LIMIT}
"""

# Per America/Denver day from the window's first local day: the unreplayed outage seconds inside the day, and the
# minutes the replayed quarters restored. A climate record covers 5 minutes in gap-log format 1 and 1 minute after
# (firmware/lib/gap_log.h SLOT_S; v_data_gaps_unreplayed uses the same rule).
BY_DAY_SQL = """
WITH days AS (
    SELECT d::date AS date, d AT TIME ZONE 'America/Denver' AS lo,
           (d + interval '1 day') AT TIME ZONE 'America/Denver' AS hi
      FROM generate_series(((now() - make_interval(days => $1::int)) AT TIME ZONE 'America/Denver')::date::timestamp,
                           (now() AT TIME ZONE 'America/Denver')::date::timestamp, interval '1 day') AS d
), outages AS (
    SELECT start_ts, end_ts FROM v_data_gaps_unreplayed
     WHERE end_ts > now() - make_interval(days => $1::int) - interval '1 day'
), quarters AS (
    SELECT first_ts, climate_rows, format_version FROM public.v_dashboard_gap_replay
     WHERE last_ts > now() - make_interval(days => $1::int) - interval '1 day'
)
SELECT days.date,
       coalesce((SELECT sum(extract(epoch FROM least(o.end_ts, days.hi) - greatest(o.start_ts, days.lo)))
                   FROM outages o WHERE o.start_ts < days.hi AND o.end_ts > days.lo), 0)::int AS outage_s,
       coalesce((SELECT sum(q.climate_rows * CASE q.format_version WHEN 1 THEN 5 ELSE 1 END)
                   FROM quarters q WHERE q.first_ts >= days.lo AND q.first_ts < days.hi), 0)::int AS replayed_min
  FROM days
 ORDER BY days.date
"""

# Push to readback confirmation for the pushes of the window that the controller confirmed.
_LATENCY_TEMPLATE = """
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM confirmed_at - ts))::float8 AS p50_s,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM confirmed_at - ts))::float8 AS p95_s,
       count(*) AS confirmed
  FROM setpoint_changes
 WHERE ts > now() - interval '{window}' AND delivery_status = 'confirmed' AND confirmed_at IS NOT NULL
"""

# Settings with a failed push in the window, the most failures first, with the window's newest confirmation.
_FAILING_TEMPLATE = """
SELECT parameter AS param,
       count(*) FILTER (WHERE delivery_status = 'failed') AS failed,
       max(ts) FILTER (WHERE delivery_status = 'failed') AS last_failed_at,
       max(confirmed_at) FILTER (WHERE delivery_status = 'confirmed') AS last_confirmed_at
  FROM setpoint_changes
 WHERE ts > now() - interval '{window}'
 GROUP BY parameter
HAVING count(*) FILTER (WHERE delivery_status = 'failed') > 0
 ORDER BY failed DESC, last_failed_at DESC, parameter
 LIMIT {limit}
"""

DeliveryWindow = Literal[24, 168]
DataDays = Annotated[Literal[1, 7, 30], BeforeValidator(_int_from_query)]
DeliveryHours = Annotated[DeliveryWindow, BeforeValidator(_int_from_query)]


def _window_statements(hours: int) -> dict[str, str]:
    window = f"{hours} hours"
    return {
        "delivery": _DELIVERY_TEMPLATE.format(window=window),
        "oldest": _OLDEST_UNCONFIRMED_TEMPLATE.format(window=window),
        "latency": _LATENCY_TEMPLATE.format(window=window),
        "failing": _FAILING_TEMPLATE.format(window=window, limit=FAILING_LIMIT),
    }


DELIVERY_STATEMENTS: dict[int, dict[str, str]] = {hours: _window_statements(hours) for hours in (24, 168)}
assert DELIVERY_STATEMENTS[24]["delivery"] == DELIVERY_SQL
assert DELIVERY_STATEMENTS[24]["oldest"] == OLDEST_UNCONFIRMED_SQL

CONTROLLER_ENTITIES = ("ingestor_counters",)
DATA_ENTITIES = ("ingestor_heartbeat", "ingestor_counters")
DELIVERY_ENTITIES = ("dispatcher_stage", "setpoint_snapshot_pass")
_PASS = re.compile(r"stored=(\d+)\s+of=(\d+)")


# ── response models (the committed OpenAPI schemas) ─────────────────────────


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Firmware(_Model):
    version: str | None
    pinned: str | None
    matches: bool | None


class Restarts(_Model):
    count: int | None
    reset_reason: str | None
    booted_at: AwareDatetime | None


class Heap(_Model):
    free_kb: float | None
    min_free_kb: float | None
    largest_block_kb: float | None
    minute_low_kb: float | None
    largest_block_minute_low_kb: float | None


class Loop(_Model):
    worst_ms: float | None
    stack_free_min_b: float | None


class Nvs(_Model):
    used_entries: int | None
    free_entries: int | None
    write_worst_ms: float | None


class Wifi(_Model):
    rssi_dbm: float | None
    disconnects: int | None
    api_clients: int | None


class Clock(_Model):
    valid: bool | None
    sync_age_s: float | None
    misses: int | None


class Probes(_Model):
    active: int | None
    degraded: bool | None
    health: str | None


class ControllerLimits(_Model):
    heap_warning_kb: float
    heap_critical_kb: float
    largest_block_kb: float
    ota_free_kb: float
    loop_worst_ms: float
    nvs_write_ms: float
    stack_free_b: float
    nvs_arm_free_pct: float
    nvs_stop_free_pct: float


LIMITS = ControllerLimits(
    heap_warning_kb=HEAP_WARNING_KB,
    heap_critical_kb=HEAP_CRITICAL_KB,
    largest_block_kb=LARGEST_BLOCK_KB,
    ota_free_kb=OTA_FREE_KB,
    loop_worst_ms=LOOP_WORST_MS,
    nvs_write_ms=NVS_WRITE_MS,
    stack_free_b=STACK_FREE_B,
    nvs_arm_free_pct=NVS_ARM_FREE_PCT,
    nvs_stop_free_pct=NVS_STOP_FREE_PCT,
)


class ControllerHealth(_Model):
    """API-35: the controller's hardware budget against its limits."""

    observed_at: AwareDatetime | None
    firmware: Firmware
    uptime_s: float | None
    restarts: Restarts
    heap: Heap
    loop: Loop
    nvs: Nvs
    wifi: Wifi
    clock: Clock
    probes: Probes
    band_source: str | None
    gap_log: str | None
    limits: ControllerLimits


class Outage(_Model):
    start: AwareDatetime
    end: AwareDatetime
    duration_s: int
    reason: str
    status: str


class ReplayedQuarter(_Model):
    boot: int
    qseq: int
    first_at: AwareDatetime
    last_at: AwareDatetime
    received_at: AwareDatetime
    climate_rows: int
    transition_rows: int


class ContinuityDay(_Model):
    date: date
    outage_s: int
    replayed_min: int


class TableFlow(_Model):
    table: str
    last_row_age_s: float | None
    rows_5m: int | None


class ProbeAge(_Model):
    sensor: str
    age_s: float | None
    # Null inside the 2 h window (age_s says it); outside it, the newest reading in 30 days, null when there is none.
    last_seen_at: AwareDatetime | None


class Ingestor(_Model):
    heartbeat_age_s: float | None
    reconnects: int | None
    payloads_rejected: int | None
    replay_failures: int | None
    rows_rejected: dict[str, int] | None
    observed_at: AwareDatetime | None


class DataContinuity(_Model):
    """API-36: whether telemetry is flowing, what was lost and what the gap log restored."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)

    from_: AwareDatetime = Field(alias="from")
    to: AwareDatetime
    gap_log: str | None
    outages: list[Outage]
    replayed: list[ReplayedQuarter]
    by_day: list[ContinuityDay]
    tables: list[TableFlow]
    probes: list[ProbeAge]
    ingestor: Ingestor


class StatusCount(_Model):
    source: str
    status: str
    count: int


class Latency(_Model):
    p50_s: float | None
    p95_s: float | None
    confirmed: int


class Failing(_Model):
    param: str
    label: str
    failed: int
    last_failed_at: AwareDatetime
    last_confirmed_at: AwareDatetime | None


class ReadbackPass(_Model):
    at: AwareDatetime | None
    stored: int | None
    of: int | None


class Delivery(_Model):
    """API-37: whether the controller took what the host pushed."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)

    from_: AwareDatetime = Field(alias="from")
    to: AwareDatetime
    by_status: list[StatusCount]
    oldest_unconfirmed_s: float | None
    latency: Latency
    failing: list[Failing]
    dispatcher_stage: str | None
    readback_pass: ReadbackPass


# ── pure shaping ────────────────────────────────────────────────────────────


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _int(value: Any) -> int | None:
    number = _number(value)
    return None if number is None else int(round(number))


def _flag(value: Any) -> bool | None:
    number = _number(value)
    return None if number is None else number != 0


def _get(row: Mapping[str, Any] | None, key: str) -> Any:
    return None if row is None else row[key]


def _ago(at: datetime, age_s: Any) -> datetime | None:
    age = _number(age_s)
    return None if age is None else at - timedelta(seconds=age)


def _age(at: datetime, ts: datetime | None) -> float | None:
    return None if ts is None else max(0.0, (at - ts).total_seconds())


def counters_payload(value: str | None) -> dict | None:
    """An ``ingestor_counters`` value of version 1, else None."""
    try:
        payload = json.loads(value) if value else None
    except ValueError:
        return None
    return payload if isinstance(payload, dict) and payload.get("v") == 1 else None


def gap_log_name(value: Any) -> str | None:
    """The gap log state as LawAlone.gap_log words it (``law.gap_log_word``): ``armed``, or the reason it is off
    without the firmware's ``off: `` prefix (lib/gap_log.h gap_log_state_name())."""
    return law.gap_log_word(value) if isinstance(value, str) else None


def controller_health(
    at: datetime,
    controller: Mapping[str, Any] | None,
    health: Mapping[str, Any] | None,
    extra: Mapping[str, Any] | None,
    counters: Mapping[str, Any] | None,
) -> ControllerHealth:
    """Shape API-35 from CONTROLLER_SQL, HEALTH_SQL, CONTROLLER_EXTRA_SQL and the newest ingestor_counters row."""
    version = _get(controller, "firmware_version")
    pinned_payload = counters_payload(_get(counters, "value"))
    pinned = pinned_payload.get("fw") if pinned_payload else None
    pinned = pinned if isinstance(pinned, str) and pinned else None
    uptime_s = _number(_get(controller, "uptime_s"))
    # The boot time from one reading and its own row time, never a reading of one statement against the time of another.
    reading_s, reading_at = _number(_get(extra, "uptime_s")), _get(extra, "uptime_at")
    booted_at = reading_at - timedelta(seconds=reading_s) if reading_at is not None and reading_s is not None else None
    return ControllerHealth(
        observed_at=_ago(at, _get(controller, "age_s")),
        firmware=Firmware(
            version=version,
            pinned=pinned,
            matches=None if version is None or pinned is None else version == pinned,
        ),
        uptime_s=uptime_s,
        restarts=Restarts(
            count=_int(_get(health, "restart_count")),
            reset_reason=_get(controller, "reset_reason"),
            booted_at=booted_at,
        ),
        heap=Heap(
            free_kb=_number(_get(controller, "heap_bytes")),  # heap_bytes holds kB, as the controller reports it
            min_free_kb=_number(_get(controller, "heap_min_free_kb")),
            largest_block_kb=_number(_get(controller, "heap_largest_free_block_kb")),
            minute_low_kb=_number(_get(health, "heap_min_free_minute_kb")),
            largest_block_minute_low_kb=_number(_get(health, "heap_largest_block_minute_low_kb")),
        ),
        loop=Loop(
            worst_ms=_number(_get(health, "loop_worst_ms")),
            stack_free_min_b=_number(_get(health, "loop_stack_high_water_b")),
        ),
        nvs=Nvs(
            used_entries=_int(_get(health, "nvs_used_entries")),
            free_entries=_int(_get(health, "nvs_free_entries")),
            write_worst_ms=_number(_get(health, "nvs_write_worst_ms")),
        ),
        wifi=Wifi(
            rssi_dbm=_number(_get(controller, "wifi_rssi")),
            disconnects=_int(_get(health, "wifi_disconnect_count")),
            api_clients=_int(_get(health, "api_client_count")),
        ),
        clock=Clock(
            valid=_flag(_get(controller, "sntp_valid")),
            sync_age_s=_number(_get(controller, "last_sntp_sync_age_s")),
            misses=_int(_get(controller, "sntp_miss_count")),
        ),
        probes=Probes(
            active=_int(_get(controller, "active_probe_count")),
            degraded=_flag(_get(health, "sensor_degraded_active")),
            health=_get(extra, "probe_health"),
        ),
        band_source=_get(controller, "band_source"),
        gap_log=gap_log_name(_get(health, "gap_log_state")),
        limits=LIMITS,
    )


def table_flows(freshness: Mapping[str, Any] | None, flow: Mapping[str, Any] | None) -> list[TableFlow]:
    """FRESHNESS_SQL and FLOW_SQL per table, in FLOW_TABLES order."""
    return [
        TableFlow(table=table, last_row_age_s=_number(_get(freshness, table)), rows_5m=_int(_get(flow, table)))
        for table in FLOW_TABLES
    ]


# API-36 only: when a probe is outside the 2 h window, the time of its newest reading in this many days.
PROBE_LAST_SEEN_DAYS = 30


def probe_last_seen_sql(columns: Sequence[str]) -> str:
    """One pass over the last 30 days of climate rows (about 43,000, one a minute; chunks older than 7 days are
    compressed, so only ts and the named columns are decompressed): the newest non-null reading of each named probe.

    The identifiers come from PROBES alone: a name that is not one of them is refused."""
    unknown = [column for column in columns if column not in PROBES]
    if not columns or unknown:
        raise ValueError(f"not probe columns: {unknown or columns}")
    return (
        "SELECT "
        + ", ".join(f"max(ts) FILTER (WHERE {column} IS NOT NULL) AS {column}" for column in columns)
        + f" FROM climate WHERE ts > now() - interval '{PROBE_LAST_SEEN_DAYS} days'"
    )


def unseen_probes(row: Mapping[str, Any] | None) -> list[str]:
    """The probes PROBES_SQL did not see in the 2 h window, in PROBES order."""
    return [probe for probe in PROBES if _number(_get(row, probe)) is None]


def probe_ages(row: Mapping[str, Any] | None, last_seen: Mapping[str, Any] | None = None) -> list[ProbeAge]:
    """PROBES_SQL per probe; a probe not seen in the 2 h window reads PROBE_WINDOW_S, as /metrics serves it, with
    its newest reading of the last 30 days from ``last_seen`` (probe_last_seen_sql's row)."""
    out = []
    for probe in PROBES:
        age = _number(_get(row, probe))
        out.append(
            ProbeAge(
                sensor=f"climate.{probe}",
                age_s=PROBE_WINDOW_S if age is None else age,
                last_seen_at=_get(last_seen, probe) if age is None else None,
            )
        )
    return out


def ingestor(at: datetime, heartbeat: Mapping[str, Any] | None, counters_row: Mapping[str, Any] | None) -> Ingestor:
    """The ingestor's heartbeat age and its counters (``ingestor_counters`` rc, pr, gr and rj)."""
    payload = counters_payload(_get(counters_row, "value"))
    rejected: dict[str, int] | None = None
    if payload is not None and isinstance(payload.get("rj"), dict):
        rejected = {str(table): count for table, raw in payload["rj"].items() if (count := _int(raw)) is not None}
    return Ingestor(
        heartbeat_age_s=_age(at, _get(heartbeat, "ts")),
        reconnects=_int(payload.get("rc")) if payload else None,
        payloads_rejected=_int(payload.get("pr")) if payload else None,
        replay_failures=_int(payload.get("gr")) if payload else None,
        rows_rejected=rejected,
        observed_at=_get(counters_row, "ts") if payload is not None else None,
    )


def readback_pass(row: Mapping[str, Any] | None) -> ReadbackPass:
    """``setpoint_snapshot_pass`` (``stored=2 of=102``) with its time; an unreadable value keeps only the time."""
    if row is None:
        return ReadbackPass(at=None, stored=None, of=None)
    match = _PASS.search(row["value"] or "")
    return ReadbackPass(
        at=row["ts"],
        stored=int(match.group(1)) if match else None,
        of=int(match.group(2)) if match else None,
    )


def label_of(param: str) -> str:
    """A registry setting's label; any other parameter (a retired name the ledger still holds) is its own name."""
    return setting_label(param) if param in REGISTRY else param


def failing_rows(rows: Sequence[Mapping[str, Any]]) -> list[Failing]:
    return [
        Failing(
            param=row["param"],
            label=label_of(row["param"]),
            failed=int(row["failed"]),
            last_failed_at=row["last_failed_at"],
            last_confirmed_at=row["last_confirmed_at"],
        )
        for row in rows
    ]


def _by_entity(rows: Sequence[Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    return {row["entity"]: row for row in rows}


# ── reads ───────────────────────────────────────────────────────────────────


async def controller(conn: asyncpg.Connection) -> ControllerHealth:
    """API-35: the newest non-null diagnostics value per column over 15 minutes, by /metrics' statements."""
    async with series._read_transaction(conn, "repeatable_read"):
        at = await conn.fetchval(NOW_SQL)
        controller_row = await conn.fetchrow(CONTROLLER_SQL)
        health_row = await conn.fetchrow(HEALTH_SQL)
        extra_row = await conn.fetchrow(CONTROLLER_EXTRA_SQL)
        state = _by_entity(await conn.fetch(STATE_ROWS_SQL, list(CONTROLLER_ENTITIES)))
    return controller_health(at, controller_row, health_row, extra_row, state.get("ingestor_counters"))


async def data(conn: asyncpg.Connection, days: DataDays = 1) -> DataContinuity:
    """API-36: outages the gap log did not restore, the quarters it did, table flow, probe ages and the ingestor."""
    async with series._read_transaction(conn, "repeatable_read"):
        at = await conn.fetchval(NOW_SQL)
        health_row = await conn.fetchrow(HEALTH_SQL)
        outages = await conn.fetch(OUTAGES_SQL, days)
        replayed = await conn.fetch(REPLAYED_SQL, days)
        by_day = await conn.fetch(BY_DAY_SQL, days)
        freshness = await conn.fetchrow(FRESHNESS_SQL)
        flow = await conn.fetchrow(FLOW_SQL)
        probes = await conn.fetchrow(PROBES_SQL)
        unseen = unseen_probes(probes)
        last_seen = await conn.fetchrow(probe_last_seen_sql(unseen)) if unseen else None
        state = _by_entity(await conn.fetch(STATE_ROWS_SQL, list(DATA_ENTITIES)))
    return DataContinuity(
        from_=at - timedelta(days=days),
        to=at,
        gap_log=gap_log_name(_get(health_row, "gap_log_state")),
        outages=[
            Outage(
                start=row["start_ts"],
                end=row["end_ts"],
                duration_s=int(row["duration_s"]),
                reason=row["reason"],
                status=row["status"],
            )
            for row in outages
        ],
        replayed=[
            ReplayedQuarter(
                boot=int(row["boot"]),
                qseq=int(row["qseq"]),
                first_at=row["first_ts"],
                last_at=row["last_ts"],
                received_at=row["received_at"],
                climate_rows=int(row["climate_rows"]),
                transition_rows=int(row["transition_rows"]),
            )
            for row in replayed
        ],
        by_day=[
            ContinuityDay(date=row["date"], outage_s=int(row["outage_s"]), replayed_min=int(row["replayed_min"]))
            for row in by_day
        ],
        tables=table_flows(freshness, flow),
        probes=probe_ages(probes, last_seen),
        ingestor=ingestor(at, state.get("ingestor_heartbeat"), state.get("ingestor_counters")),
    )


async def delivery(conn: asyncpg.Connection, hours: DeliveryHours = 24) -> Delivery:
    """API-37: pushes by source and status, the oldest still waiting, confirmation latency and the failing settings
    over the window, with the dispatcher's stage and the newest readback pass."""
    statements = DELIVERY_STATEMENTS[hours]
    async with series._read_transaction(conn, "repeatable_read"):
        at = await conn.fetchval(NOW_SQL)
        by_status = await conn.fetch(statements["delivery"])
        oldest = await conn.fetchval(statements["oldest"])
        latency = await conn.fetchrow(statements["latency"])
        failing = await conn.fetch(statements["failing"])
        state = _by_entity(await conn.fetch(STATE_ROWS_SQL, list(DELIVERY_ENTITIES)))
    stage = state.get("dispatcher_stage")
    return Delivery(
        from_=at - timedelta(hours=hours),
        to=at,
        by_status=sorted(
            (StatusCount(source=row["source"], status=row["status"], count=int(row["n"])) for row in by_status),
            key=lambda item: (-item.count, item.source, item.status),
        ),
        oldest_unconfirmed_s=_number(oldest),
        latency=Latency(
            p50_s=_number(_get(latency, "p50_s")),
            p95_s=_number(_get(latency, "p95_s")),
            confirmed=_int(_get(latency, "confirmed")) or 0,
        ),
        failing=failing_rows(failing),
        dispatcher_stage=_get(stage, "value"),
        readback_pass=readback_pass(state.get("setpoint_snapshot_pass")),
    )
