"""Product metrics for the estate Prometheus (package 6, contracts/metrics-coverage.md, RULINGS V1 to V5).

The operator API's ``/metrics`` is the one place where database facts become Prometheus metrics. A background timer
refreshes fixed query groups (60 s and 300 s; compliance and utilities read what migration 312 grants) into an in-memory snapshot; ``/metrics`` renders that snapshot and never
queries. Each group runs on its own pooled connection checkout with a 5 s statement timeout, so a slow or failing group
drops only its own series while ``verdify_metrics_refresh_age_seconds{group}`` keeps growing; the other groups keep
serving.

Every label value comes from a fixed list in this module (or the verdify_schemas alert registry); anything else maps to
``other``. No label carries free text, an id, a message, a host or a secret. The release pins are read once from the
``verdify-release-pins`` ConfigMap file the overlay mounts; the firmware pin comes from the ingestor's
``ingestor_counters`` row.

Cost of each statement (EXPLAIN ANALYZE, BUFFERS on production, read-only, one at a time, 2026-11-16; planning +
execution, shared buffers hit, none read from disk):

  group       period  statement              planning  execution  buffers
  alerts      60 s    alerts._OPEN_SQL          6.7 ms     8.9 ms      772
  controller  60 s    CONTROLLER_SQL           11.5 ms     0.2 ms    1,230
  devices     60 s    DEVICES_SQL, ENGINE_SQL, LEAD_FAN_SQL   index lookups of equipment_state/system_state
  tables      900 s   TABLES_SQL              about 0.5 s execution (hypertable_size over six tables)
  health      60 s    HEALTH_SQL               the nine migration 314 and three 315 columns; same 15-minute range of diagnostics_ts_idx
                                                as CONTROLLER_SQL, measured on a private database (columns not live)
  state       60 s    STATE_SQL                10.2 ms    10.5 ms    1,076
  relays      60 s    RELAYS_SQL               11.0 ms     0.8 ms    1,175
  house       60 s    HOUSE_SQL                 8.0 ms     0.2 ms      984
  freshness   60 s    FRESHNESS_SQL            33.3 ms     1.3 ms    2,570
  delivery    60 s    DELIVERY_SQL             14.1 ms     2.6 ms    1,068
                      OLDEST_UNCONFIRMED_SQL    9.4 ms     0.3 ms    1,148
  probes      300 s   PROBES_SQL               14.5 ms     0.8 ms    1,125
  flow        300 s   FLOW_SQL                 29.0 ms     2.2 ms    2,445
                      GAPS_SQL                  5.2 ms     0.4 ms      541
  compliance  300 s   COMPLIANCE_SQL            4.3 ms     0.1 ms      509
  utilities   300 s   METER_SQL                 9.0 ms     0.2 ms      848  (on energy; the view is a projection)
                      DAILY_RECORD_SQL          primary-key lookup of one row; daily_record arrives with 310, so
                                                tests/test_dashboard_db_metrics_312.py runs it on a private database

About 130 ms of database time a minute plus about 65 ms every 5 minutes, all from shared buffers; planning (chunk
exclusion over the hypertables) is most of it. For comparison v_sensor_staleness costs 1.45 s planning + 2.1 s
execution and 152,786 buffers, which is why the probe ages read climate directly.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from verdify_schemas.alerts import ALERT_TYPES
from verdify_services import alerts

log = logging.getLogger("verdify.product_metrics")

QUERY_TIMEOUT_S = 5.0
STATEMENT_TIMEOUT_SQL = "SET statement_timeout = '5s'"
OTHER = "other"
RELEASE_PINS_PATH = Path("/etc/verdify/release-pins/release-pins.yaml")

# ── fixed label vocabularies ────────────────────────────────────────────────

SEVERITIES = frozenset({"critical", "warning", "info"})
KNOWN_ALERT_TYPES = frozenset(ALERT_TYPES)
# firmware/greenhouse/hardware.yaml "Reset Reason"
RESET_REASONS = {
    "Power-on": "power_on",
    "External reset": "external",
    "Software reset": "software",
    "Guru/Panic": "panic",
    "Interrupt WDT": "int_wdt",
    "Task WDT": "task_wdt",
    "Other WDT": "other_wdt",
    "Deep-sleep wake": "deep_sleep",
    "Brown-out": "brownout",
    "SDIO reset": "sdio",
}
BAND_SOURCES = frozenset({"onchip_curve", "corridor", "served", "fallback", "none"})
# firmware/lib/greenhouse_types.h MODE_NAMES and the composed mist stages the host stores.
GREENHOUSE_STATES = frozenset(
    {
        "SENSOR_FAULT",
        "SAFETY_COOL",
        "SAFETY_HEAT",
        "SEALED_MIST",
        "SEALED_MIST_FOG",
        "SEALED_MIST_S1",
        "SEALED_MIST_S2",
        "THERMAL_RELIEF",
        "VENTILATE",
        "DEHUM_VENT",
        "IDLE",
    }
)
OUTDOOR_SOURCES = frozenset({"station", "intake", "none"})
# contracts/phase3-entities.md climate_law_state
LAW_LATCHES = ("heat1", "heat2", "cool", "cool2", "wet", "mist", "dry", "air", "run")
LAW_REQUESTS = ("heat1", "heat2", "vent", "fog", "mist", "fan1", "fan2", "cooling", "drying", "hot", "cold")
DRYING_REFUSALS = frozenset(
    {"none", "no_temperature", "humidity_invalid", "no_outdoor", "cooling", "furnace", "not_drier", "too_cold", "cost"}
)
BAND_EDGES = ("temp_low", "temp_high", "vpd_low", "vpd_high")
DRYING_COST_UNAVAILABLE = 1e9
# contracts/phase2-entities.md relay_counters: starts per relay, ON seconds per fan
RELAY_START_KEYS = {"h1": "heat1", "h2": "heat2", "f1": "fan1", "f2": "fan2", "fg": "fog", "vt": "vent"}
RELAY_SECONDS_KEYS = {"f1s": "fan1", "f2s": "fan2"}
# contracts/phase3-entities.md climate_drying_meter
DRYING_METER = {
    "s": "verdify_drying_seconds_total",
    "g": "verdify_drying_water_grams_total",
    "wh": "verdify_drying_heat_wh_total",
    "rw": "verdify_drying_refused_seconds_total",
}
STATE_ENTITIES = (
    "greenhouse_state",
    "outdoor_source",
    "relay_counters",
    "climate_law_state",
    "climate_drying_meter",
    "ingestor_counters",
    "ingestor_heartbeat",
)
RELAYS = (
    "heat1",
    "heat2",
    "fan1",
    "fan2",
    "fog",
    "vent",
    "grow_light_main",
    "grow_light_grow",
    "drip_wall",
    "drip_center",
    "mister_south",
    "mister_west",
    "mister_center",
    "water_flowing",
)
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
DELIVERY_STATUSES = frozenset({"pending", "confirmed", "observed", "superseded", "failed", "expired"})
SETPOINT_SOURCES = frozenset({"band", "plan", "manual", "esp32"})
GAP_STATUSES = frozenset({"none", "pending", "partial", "replayed", "not_applicable"})
# ingestor/shared.py row-rejection tables (ingestor_counters "rj" keys)
COMPLIANCE_WINDOWS = ("today", "yesterday")
COMPLIANCE_AXES = ("temp", "vpd", "both")
METER_CHANNELS = ("ch0", "ch1")
METER_QUALITIES = frozenset({"ok", "stale", "future", "unavailable", "invalid", "nonfinite"})
REJECTED_TABLES = frozenset(
    {
        "climate",
        "equipment_state",
        "system_state",
        "diagnostics",
        "setpoint_changes",
        "setpoint_snapshot",
        "override_events",
        "climate_action_log",
        "daily_summary",
    }
)
RELEASE_IMAGES = frozenset(
    {
        "verdify-api",
        "verdify-mcp",
        "verdify-ingestor",
        "verdify-migrate",
        "verdify-experiment-v2-orchestrator",
    }
)
_DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
_FIRMWARE_VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")


def bounded(value: object, allowed: Iterable[str]) -> str:
    """The value when it is in the fixed list, else ``other``."""
    return value if isinstance(value, str) and value in allowed else OTHER


def firmware_label(value: object) -> str:
    return value if isinstance(value, str) and _FIRMWARE_VERSION.fullmatch(value) else OTHER


# ── families ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Family:
    type: str
    help: str


FAMILIES: dict[str, Family] = {
    # controller (diagnostics)
    "verdify_controller_sample_age_seconds": Family(
        "gauge", "Seconds since the newest diagnostics row (15 min window)."
    ),
    "verdify_controller_heap_free_bytes": Family(
        "gauge", "Controller free heap (diagnostics.heap_bytes, stored in KB)."
    ),
    "verdify_controller_heap_min_free_bytes": Family("gauge", "Controller lowest free heap since boot."),
    "verdify_controller_heap_largest_free_block_bytes": Family("gauge", "Controller largest free heap block."),
    "verdify_controller_wifi_rssi_dbm": Family("gauge", "Controller WiFi signal."),
    "verdify_controller_uptime_seconds": Family("gauge", "Controller uptime; a drop is a restart."),
    "verdify_controller_sntp_valid": Family("gauge", "1 when the controller clock is SNTP-confirmed."),
    "verdify_controller_sntp_sync_age_seconds": Family("gauge", "Seconds since the controller's last SNTP sync."),
    "verdify_controller_sntp_misses": Family("gauge", "Controller SNTP miss count."),
    "verdify_controller_active_probes": Family("gauge", "Probes the controller reports active."),
    "verdify_controller_reset_reason": Family("gauge", "1 for the controller's last reset reason."),
    "verdify_controller_firmware_info": Family("gauge", "1 for the firmware version the controller reports."),
    "verdify_controller_band_source": Family("gauge", "1 for the band source the controller uses."),
    # irrigation and lighting state, lead fan, table sizes (RULINGS AF9(a); contracts/metrics-coverage.md 2.2, 2.7, 2.9)
    "verdify_irrigation_zone_on": Family("gauge", "1 while an irrigation valve is on (newest equipment_state, 30 d)."),
    "verdify_irrigation_engine_ok": Family("gauge", "1 when this connection's firmware has the irrigation engine."),
    "verdify_lights_on": Family("gauge", "1 while a grow-light circuit is on (newest equipment_state, 30 d)."),
    "verdify_lead_fan": Family(
        "gauge", "1 for the lead fan: the controller's Lead Fan entity when fresh, else the newest one-fan start."
    ),
    "verdify_table_bytes": Family("gauge", "Size of a product hypertable (hypertable_size, 15 min)."),
    # controller hardware budget (diagnostics, migration 314; contracts/metrics-coverage.md section 2.1a)
    "verdify_controller_heap_min_free_window_bytes": Family(
        "gauge", "Controller lowest free heap in its last one-minute window."
    ),
    "verdify_controller_heap_largest_free_block_window_bytes": Family(
        "gauge", "Controller smallest largest-free-block in its last one-minute window."
    ),
    "verdify_controller_loop_worst_seconds": Family("gauge", "Controller worst control-loop pass in its last minute."),
    "verdify_controller_restarts_total": Family(
        "counter", "Controller restarts, counted and persisted by the firmware."
    ),
    "verdify_controller_nvs_entries": Family("gauge", "Controller NVS entries (32 B) by state: used or free."),
    "verdify_controller_nvs_write_worst_seconds": Family(
        "gauge", "Controller worst NVS write in its last minute (0 = no write)."
    ),
    "verdify_controller_gap_log_armed": Family("gauge", "1 when the controller's gap log is armed."),
    "verdify_controller_gap_log_state": Family("gauge", "1 for the controller's gap log state."),
    "verdify_controller_sensor_degraded_active": Family(
        "gauge", "1 when the controller does not run on the wall averages with a valid humidity."
    ),
    # third-flash counters (diagnostics, migration 315; RULINGS AF9(b), contracts/metrics-coverage.md section 2.1a)
    "verdify_controller_loop_stack_free_min_bytes": Family(
        "gauge", "Lowest free stack of the controller's loop task since boot."
    ),
    "verdify_controller_wifi_disconnects_total": Family(
        "counter", "Controller WiFi disconnects since boot (a reset marks a boot)."
    ),
    "verdify_controller_api_clients": Family("gauge", "Native API connections open on the controller."),
    # control (system_state, equipment_state, climate)
    "verdify_state_age_seconds": Family(
        "gauge", "Seconds since the newest system_state row of an entity (7 d window)."
    ),
    "verdify_greenhouse_state": Family("gauge", "1 for the controller's current state machine state."),
    "verdify_outdoor_source": Family("gauge", "1 for the outdoor source the controller uses."),
    "verdify_law_latch": Family("gauge", "The climate law's latches (climate_law_state l)."),
    "verdify_law_request": Family(
        "gauge", "The climate law's requests before relay minimum times (climate_law_state o)."
    ),
    "verdify_law_drying_refusal": Family("gauge", "1 for why drying is not running (climate_law_state dr)."),
    "verdify_law_drying_cost_kwh_per_kg": Family("gauge", "Drying cost now; absent with no outdoor data or no gain."),
    "verdify_law_drying_cost_limit_kwh_per_kg": Family("gauge", "Drying cost limit in force."),
    "verdify_law_band_adjusted": Family("gauge", "1 when the controller's band check changed the band it received."),
    "verdify_band_edge": Family("gauge", "Band edges the law uses (temp in F, VPD in kPa)."),
    "verdify_relay_starts_total": Family("counter", "Relay starts counted from the controller's lifetime counters."),
    "verdify_relay_on_seconds_total": Family("counter", "Fan ON seconds counted from the controller's counters."),
    "verdify_drying_seconds_total": Family("counter", "Seconds with a drying run on and the vent open."),
    "verdify_drying_water_grams_total": Family("counter", "Water carried out by drying runs."),
    "verdify_drying_heat_wh_total": Family("counter", "Heat carried out by drying runs."),
    "verdify_drying_refused_seconds_total": Family("counter", "Seconds drying was wanted but refused."),
    "verdify_relay_on": Family("gauge", "1 when the relay's newest equipment_state row is ON."),
    "verdify_relay_state_age_seconds": Family("gauge", "Seconds since the relay's newest equipment_state row."),
    "verdify_house_temperature_fahrenheit": Family("gauge", "House air temperature (climate.temp_avg)."),
    "verdify_house_vpd_kpa": Family("gauge", "House VPD (climate.vpd_avg)."),
    "verdify_house_rh_percent": Family("gauge", "House relative humidity (climate.rh_avg)."),
    "verdify_house_sample_age_seconds": Family("gauge", "Seconds since the newest climate row with temp and VPD."),
    # sensors
    "verdify_sensor_age_seconds": Family("gauge", "Seconds since a probe's last non-null reading (7200 = not in 2 h)."),
    # data flow
    "verdify_table_last_row_age_seconds": Family("gauge", "Seconds since the newest row of a table (1 d window)."),
    "verdify_table_rows_5m": Family("gauge", "Rows written to a table in the last 5 minutes."),
    "verdify_data_gaps_7d": Family(
        "gauge",
        "Unreplayed data_gaps pieces (v_data_gaps_unreplayed) started in the last 7 days, by backfill status.",
    ),
    "verdify_data_gap_seconds_7d": Family(
        "gauge", "Seconds of unreplayed data_gaps pieces (v_data_gaps_unreplayed) started in the last 7 days."
    ),
    "verdify_ingestor_reconnects_total": Family("counter", "ESP32 reconnects since the ingestor process started."),
    "verdify_ingestor_rows_rejected_total": Family("counter", "Device rows dropped by schema validation, by table."),
    "verdify_ingestor_payloads_rejected_total": Family("counter", "Versioned controller payloads rejected."),
    "verdify_ingestor_counters_age_seconds": Family("gauge", "Seconds since the ingestor's newest counters row."),
    # delivery of settings
    "verdify_setpoint_rows_24h": Family(
        "gauge", "setpoint_changes rows of the last 24 h by delivery status and source."
    ),
    "verdify_setpoint_oldest_unconfirmed_seconds": Family(
        "gauge", "Age of the oldest unconfirmed, unsuperseded setpoint row of the last 24 h (0 when none)."
    ),
    # compliance (daily_band_compliance, 290/311; SELECT by 312)
    "verdify_band_compliance_ratio": Family(
        "gauge", "Share of graded minutes in the served band, per local day (today so far, yesterday) and axis."
    ),
    "verdify_band_compliance_graded_minutes": Family("gauge", "Graded minutes behind the ratio, per day and axis."),
    # utilities (daily_record, 310; v_dashboard_energy, 312)
    "verdify_utility_today": Family("gauge", "Use today so far: metered electricity (kWh today on the meter)."),
    "verdify_utility_yesterday": Family(
        "gauge", "Use yesterday from the daily record: metered kWh, estimated furnace therms, metered gallons."
    ),
    "verdify_meter_coverage_ratio": Family("gauge", "Share of yesterday the power meter reported (daily record)."),
    "verdify_daily_record_complete": Family("gauge", "1 when yesterday's daily record row is complete."),
    "verdify_meter_age_seconds": Family("gauge", "Seconds since a power-meter channel's source sample (1 h window)."),
    "verdify_meter_quality": Family("gauge", "1 for the quality of a power-meter channel's newest row."),
    # deployment
    "verdify_release_pin_info": Family("gauge", "1 per image digest release-pins.yaml pins."),
    "verdify_firmware_pin_info": Family("gauge", "1 for the firmware version the ingestor's pin expects."),
    # the exporter itself
    "verdify_metrics_refresh_success": Family("gauge", "1 when the group's last refresh succeeded."),
    "verdify_metrics_refresh_age_seconds": Family("gauge", "Seconds since the group's last successful refresh."),
    "verdify_metrics_refresh_duration_seconds": Family("gauge", "Duration of the group's last refresh."),
}

Sample = tuple[str, tuple[tuple[str, str], ...], float]


def sample(name: str, value: float, **labels: str) -> Sample:
    assert name in FAMILIES, name
    return (name, tuple(sorted(labels.items())), float(value))


def _label(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _value(value: float) -> str:
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "+Inf" if value > 0 else "-Inf"
    return repr(value) if not value.is_integer() else str(int(value))


def render(samples: Iterable[Sample]) -> str:
    by_family: dict[str, list[Sample]] = {}
    for item in samples:
        by_family.setdefault(item[0], []).append(item)
    lines: list[str] = []
    for name in sorted(by_family):
        family = FAMILIES[name]
        lines += [f"# HELP {name} {family.help}", f"# TYPE {name} {family.type}"]
        for _, labels, value in sorted(by_family[name]):
            body = ",".join(f'{key}="{_label(val)}"' for key, val in labels)
            lines.append(f"{name}{{{body}}} {_value(value)}" if body else f"{name} {_value(value)}")
    return "\n".join(lines) + "\n" if lines else ""


# ── counters from controller lifetime values ────────────────────────────────


class Accumulator:
    """Turns the controller's lifetime counters into Prometheus counters that start at 0 with this process.

    A lifetime counter is persisted hourly, so after a controller restart it may step BACK by up to an hour; a negative
    step counts 0 (contracts/phase2-entities.md), never a reset that would add the whole lifetime value."""

    def __init__(self) -> None:
        self._last: dict[tuple[str, str], float] = {}
        self._total: dict[tuple[str, str], float] = {}

    def advance(self, name: str, label: str, raw: float) -> float:
        key = (name, label)
        last = self._last.get(key)
        if last is not None and raw > last:
            self._total[key] = self._total.get(key, 0.0) + (raw - last)
        self._last[key] = raw
        return self._total.setdefault(key, 0.0)


# ── statements ──────────────────────────────────────────────────────────────

# Each column the newest non-NULL value of the last 15 minutes (release 3 review ALERTS-5): readings are stored on
# change, so the newest diagnostics row alone often lacks them. Index range scan of diagnostics_ts_idx.
CONTROLLER_SQL = """
SELECT extract(epoch FROM now() - max(ts))::float8 AS age_s,
       (array_agg(heap_bytes ORDER BY ts DESC) FILTER (WHERE heap_bytes IS NOT NULL))[1] AS heap_bytes,
       (array_agg(heap_min_free_kb ORDER BY ts DESC) FILTER (WHERE heap_min_free_kb IS NOT NULL))[1] AS heap_min_free_kb,
       (array_agg(heap_largest_free_block_kb ORDER BY ts DESC) FILTER (WHERE heap_largest_free_block_kb IS NOT NULL))[1] AS heap_largest_free_block_kb,
       (array_agg(wifi_rssi ORDER BY ts DESC) FILTER (WHERE wifi_rssi IS NOT NULL))[1] AS wifi_rssi,
       (array_agg(uptime_s ORDER BY ts DESC) FILTER (WHERE uptime_s IS NOT NULL))[1] AS uptime_s,
       (array_agg(reset_reason ORDER BY ts DESC) FILTER (WHERE reset_reason IS NOT NULL))[1] AS reset_reason,
       (array_agg(firmware_version ORDER BY ts DESC) FILTER (WHERE firmware_version IS NOT NULL))[1] AS firmware_version,
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
       (array_agg(heap_largest_block_minute_low_kb ORDER BY ts DESC)
            FILTER (WHERE heap_largest_block_minute_low_kb IS NOT NULL))[1] AS heap_largest_block_minute_low_kb,
       (array_agg(loop_worst_ms ORDER BY ts DESC) FILTER (WHERE loop_worst_ms IS NOT NULL))[1] AS loop_worst_ms,
       (array_agg(restart_count ORDER BY ts DESC) FILTER (WHERE restart_count IS NOT NULL))[1] AS restart_count,
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

# Irrigation valves and light circuits: newest equipment_state row each within 30 days (irrigation changes rarely).
DEVICES_SQL = """
SELECT e.equipment, s.state
  FROM unnest($1::text[]) AS e(equipment)
  CROSS JOIN LATERAL (
        SELECT state FROM equipment_state
         WHERE equipment = e.equipment AND ts > now() - interval '30 days'
         ORDER BY ts DESC
         LIMIT 1) s
"""
ENGINE_SQL = """
SELECT value FROM system_state WHERE entity = 'irr_engine' AND ts > now() - interval '30 days' ORDER BY ts DESC LIMIT 1
"""
# The lead fan: the controller's Lead Fan entity when it reported within 2 days (the third flash publishes it; today's
# firmware never does, verification finding TEL-F8), else the fan of the newest start in 7 days made while the other
# fan was off (that start is the lead's).
LEAD_FAN_SQL = """
WITH e AS (
    SELECT equipment, ts, state FROM equipment_state
     WHERE equipment IN ('fan1', 'fan2') AND ts > now() - interval '7 days'
), single AS (
    SELECT e.equipment, e.ts FROM e
     WHERE e.state
       AND NOT COALESCE((SELECT o.state FROM e o
                          WHERE o.equipment <> e.equipment AND o.ts <= e.ts
                          ORDER BY o.ts DESC LIMIT 1), false)
)
SELECT COALESCE(
         (SELECT value FROM system_state WHERE entity = 'lead_fan' AND ts > now() - interval '2 days'
           ORDER BY ts DESC LIMIT 1),
         (SELECT equipment FROM single ORDER BY ts DESC LIMIT 1)) AS fan
"""
# hypertable_size() of the six flow tables, every 15 minutes: about 0.5 s on production (2026-11-16), readable as
# verdify_dashboard_runtime (checked in a read-only transaction). A plain table falls back to pg_total_relation_size.
TABLES_SQL = """
SELECT t AS tbl, COALESCE(hypertable_size(('public.' || t)::regclass), pg_total_relation_size(('public.' || t)::regclass))
           AS bytes
  FROM unnest($1::text[]) AS t
 WHERE to_regclass('public.' || t) IS NOT NULL
"""

# Newest row per entity through idx_system_state_entity (entity, ts DESC), 7 d of chunks at most.
STATE_SQL = """
SELECT e.entity, extract(epoch FROM now() - s.ts)::float8 AS age_s, s.value
  FROM unnest($1::text[]) AS e(entity)
  CROSS JOIN LATERAL (
        SELECT ts, value FROM system_state
         WHERE entity = e.entity AND ts > now() - interval '7 days'
         ORDER BY ts DESC
         LIMIT 1) s
"""

# Newest row per relay through idx_equipment_state_equip (equipment, ts DESC), 7 d of chunks at most.
RELAYS_SQL = """
SELECT e.equipment, extract(epoch FROM now() - s.ts)::float8 AS age_s, s.state
  FROM unnest($1::text[]) AS e(equipment)
  CROSS JOIN LATERAL (
        SELECT ts, state FROM equipment_state
         WHERE equipment = e.equipment AND ts > now() - interval '7 days'
         ORDER BY ts DESC
         LIMIT 1) s
"""

HOUSE_SQL = """
SELECT extract(epoch FROM now() - ts)::float8 AS age_s, temp_avg, vpd_avg, rh_avg
  FROM climate
 WHERE ts > now() - interval '15 minutes' AND temp_avg IS NOT NULL AND vpd_avg IS NOT NULL
 ORDER BY ts DESC
 LIMIT 1
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

DELIVERY_SQL = """
SELECT coalesce(delivery_status, 'pending') AS status, coalesce(source, 'none') AS source, count(*) AS n
  FROM setpoint_changes
 WHERE ts > now() - interval '24 hours'
 GROUP BY 1, 2
"""

# idx_setpoint_changes_unconfirmed (ts DESC) WHERE confirmed_at IS NULL
OLDEST_UNCONFIRMED_SQL = """
SELECT coalesce(extract(epoch FROM now() - min(ts)), 0)::float8
  FROM setpoint_changes
 WHERE ts > now() - interval '24 hours' AND confirmed_at IS NULL
   AND coalesce(delivery_status, 'pending') NOT IN ('superseded', 'failed', 'expired', 'observed')
"""


# daily_band_compliance PK (date): two rows. The local day is America/Denver, as the store writes it.
COMPLIANCE_SQL = """
SELECT CASE WHEN date = (now() AT TIME ZONE 'America/Denver')::date THEN 'today' ELSE 'yesterday' END AS day,
       temp_in_min, temp_graded_min, vpd_in_min, vpd_graded_min, both_in_min, both_graded_min
  FROM daily_band_compliance
 WHERE date BETWEEN (now() AT TIME ZONE 'America/Denver')::date - 1 AND (now() AT TIME ZONE 'America/Denver')::date
"""

# daily_record PK (date): one row.
DAILY_RECORD_SQL = """
SELECT complete, kwh_metered, therms_est, water_gal, meter_coverage_pct
  FROM daily_record
 WHERE date = (now() AT TIME ZONE 'America/Denver')::date - 1
"""

# energy (ts DESC) through 312's projection: the newest row in the last hour.
METER_SQL = """
SELECT extract(epoch FROM now() - ts)::float8 AS row_age_s, kwh_today,
       extract(epoch FROM now() - ch0_source_ts)::float8 AS ch0_age_s, ch0_quality,
       extract(epoch FROM now() - ch1_source_ts)::float8 AS ch1_age_s, ch1_quality
  FROM public.v_dashboard_energy
 WHERE ts > now() - interval '1 hour'
 ORDER BY ts DESC
 LIMIT 1
"""


# ── collectors ──────────────────────────────────────────────────────────────


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def controller_samples(row: Mapping[str, Any] | None) -> list[Sample]:
    if row is None:
        return []
    out: list[Sample] = []

    def put(name: str, value: Any, scale: float = 1.0) -> None:
        number = _num(value)
        if number is not None:
            out.append(sample(name, number * scale))

    put("verdify_controller_sample_age_seconds", row["age_s"])
    put("verdify_controller_heap_free_bytes", row["heap_bytes"], 1024.0)
    put("verdify_controller_heap_min_free_bytes", row["heap_min_free_kb"], 1024.0)
    put("verdify_controller_heap_largest_free_block_bytes", row["heap_largest_free_block_kb"], 1024.0)
    put("verdify_controller_wifi_rssi_dbm", row["wifi_rssi"])
    put("verdify_controller_uptime_seconds", row["uptime_s"])
    put("verdify_controller_sntp_valid", row["sntp_valid"])
    put("verdify_controller_sntp_sync_age_seconds", row["last_sntp_sync_age_s"])
    put("verdify_controller_sntp_misses", row["sntp_miss_count"])
    put("verdify_controller_active_probes", row["active_probe_count"])
    if row["reset_reason"]:
        out.append(sample("verdify_controller_reset_reason", 1, reason=RESET_REASONS.get(row["reset_reason"], OTHER)))
    if row["firmware_version"]:
        out.append(sample("verdify_controller_firmware_info", 1, version=firmware_label(row["firmware_version"])))
    if row["band_source"]:
        out.append(sample("verdify_controller_band_source", 1, source=bounded(row["band_source"], BAND_SOURCES)))
    return out


# The irrigation valves and grow-light circuits as equipment_state stores them (fixed lists).
IRRIGATION_ZONES = (
    "drip_wall",
    "drip_wall_fert",
    "drip_center",
    "drip_center_fert",
    "mister_center",
    "mister_south",
    "mister_south_fert",
    "mister_west",
    "mister_west_fert",
    "fert_master_valve",
)
LIGHT_CIRCUITS = ("grow_light_main", "grow_light_grow")
LEAD_FANS = {"Fan 1": "fan1", "Fan 2": "fan2", "fan1": "fan1", "fan2": "fan2"}


def device_samples(
    rows: Sequence[Mapping[str, Any]], engine: Mapping[str, Any] | None, lead: Mapping[str, Any] | None
) -> list[Sample]:
    """Irrigation valves, light circuits, the irrigation engine and the lead fan; an unknown state gives no sample."""
    out: list[Sample] = []
    for row in rows:
        if row["state"] is None:
            continue
        if row["equipment"] in IRRIGATION_ZONES:
            out.append(sample("verdify_irrigation_zone_on", 1 if row["state"] else 0, zone=row["equipment"]))
        elif row["equipment"] in LIGHT_CIRCUITS:
            out.append(sample("verdify_lights_on", 1 if row["state"] else 0, circuit=row["equipment"]))
    if engine is not None and engine["value"] in ("true", "false"):
        out.append(sample("verdify_irrigation_engine_ok", 1 if engine["value"] == "true" else 0))
    fan = LEAD_FANS.get((lead or {}).get("fan") or "")
    if fan is not None:
        for name in ("fan1", "fan2"):
            out.append(sample("verdify_lead_fan", 1 if name == fan else 0, fan=name))
    return out


def table_samples(rows: Sequence[Mapping[str, Any]]) -> list[Sample]:
    return [
        sample("verdify_table_bytes", row["bytes"], table=row["tbl"])
        for row in rows
        if row["tbl"] in FLOW_TABLES and _num(row["bytes"]) is not None
    ]


# lib/gap_log.h gap_log_state_name(): the six values the firmware publishes.
GAP_LOG_STATES = frozenset(
    {"armed", "off: nvs_small", "off: nvs_full", "off: nvs_slow", "off: nvs_error", "off: not_armed_yet"}
)


def health_samples(row: Mapping[str, Any] | None) -> list[Sample]:
    """The nine budget readings (migration 314) and the three counters (315). A NULL column (every row before the third flash) gives no sample."""
    if row is None:
        return []
    out: list[Sample] = []

    def put(name: str, value: Any, scale: float = 1.0, **labels: str) -> None:
        number = _num(value)
        if number is not None:
            out.append(sample(name, number * scale, **labels))

    put("verdify_controller_heap_min_free_window_bytes", row["heap_min_free_minute_kb"], 1024.0)
    put("verdify_controller_heap_largest_free_block_window_bytes", row["heap_largest_block_minute_low_kb"], 1024.0)
    put("verdify_controller_loop_worst_seconds", row["loop_worst_ms"], 0.001)
    put("verdify_controller_restarts_total", row["restart_count"])
    put("verdify_controller_nvs_entries", row["nvs_used_entries"], state="used")
    put("verdify_controller_nvs_entries", row["nvs_free_entries"], state="free")
    put("verdify_controller_nvs_write_worst_seconds", row["nvs_write_worst_ms"], 0.001)
    put("verdify_controller_sensor_degraded_active", row["sensor_degraded_active"])
    put("verdify_controller_loop_stack_free_min_bytes", row["loop_stack_high_water_b"])
    put("verdify_controller_wifi_disconnects_total", row["wifi_disconnect_count"])
    put("verdify_controller_api_clients", row["api_client_count"])
    if row["gap_log_state"] is not None:
        state = bounded(row["gap_log_state"], GAP_LOG_STATES)
        out.append(sample("verdify_controller_gap_log_armed", 1 if state == "armed" else 0))
        out.append(sample("verdify_controller_gap_log_state", 1, state=state))
    return out


def _json(value: str | None, version: int = 1) -> dict | None:
    try:
        payload = json.loads(value) if value else None
    except ValueError:
        return None
    return payload if isinstance(payload, dict) and payload.get("v") == version else None


def state_samples(rows: Sequence[Mapping[str, Any]], counters: Accumulator) -> list[Sample]:
    out: list[Sample] = []
    latest = {row["entity"]: row for row in rows if row["entity"] in STATE_ENTITIES}
    for entity, row in latest.items():
        out.append(sample("verdify_state_age_seconds", row["age_s"], entity=entity))
    if (row := latest.get("greenhouse_state")) is not None:
        out.append(sample("verdify_greenhouse_state", 1, state=bounded(row["value"], GREENHOUSE_STATES)))
    if (row := latest.get("outdoor_source")) is not None:
        out.append(sample("verdify_outdoor_source", 1, source=bounded(row["value"], OUTDOOR_SOURCES)))
    if (row := latest.get("climate_law_state")) is not None and (law := _json(row["value"])) is not None:
        out += _law_samples(law)
    if (row := latest.get("relay_counters")) is not None and (relays := _json(row["value"])) is not None:
        for key, relay in RELAY_START_KEYS.items():
            if (raw := _num(relays.get(key))) is not None:
                total = counters.advance("starts", relay, raw)
                out.append(sample("verdify_relay_starts_total", total, relay=relay))
        for key, relay in RELAY_SECONDS_KEYS.items():
            if (raw := _num(relays.get(key))) is not None:
                total = counters.advance("on_seconds", relay, raw)
                out.append(sample("verdify_relay_on_seconds_total", total, relay=relay))
    if (row := latest.get("climate_drying_meter")) is not None and (meter := _json(row["value"])) is not None:
        for key, name in DRYING_METER.items():
            if (raw := _num(meter.get(key))) is not None:
                out.append(sample(name, counters.advance(name, "", raw)))
    if (row := latest.get("ingestor_counters")) is not None and (ingestor := _json(row["value"])) is not None:
        out += _ingestor_samples(ingestor, row["age_s"])
    return out


def _law_samples(law: Mapping[str, Any]) -> list[Sample]:
    out: list[Sample] = []
    for key, names, family, label in (
        ("l", LAW_LATCHES, "verdify_law_latch", "latch"),
        ("o", LAW_REQUESTS, "verdify_law_request", "request"),
    ):
        mask = law.get(key)
        if isinstance(mask, int) and not isinstance(mask, bool):
            for bit, name in enumerate(names):
                out.append(sample(family, (mask >> bit) & 1, **{label: name}))
    if isinstance(law.get("dr"), str):
        out.append(sample("verdify_law_drying_refusal", 1, reason=bounded(law["dr"], DRYING_REFUSALS)))
    cost = _num(law.get("e"))
    if cost is not None and cost < DRYING_COST_UNAVAILABLE:
        out.append(sample("verdify_law_drying_cost_kwh_per_kg", cost))
    if (limit := _num(law.get("lim"))) is not None:
        out.append(sample("verdify_law_drying_cost_limit_kwh_per_kg", limit))
    if (adjusted := _num(law.get("br"))) is not None:
        out.append(sample("verdify_law_band_adjusted", adjusted))
    band = law.get("b")
    if isinstance(band, list) and len(band) == len(BAND_EDGES):
        for edge, value in zip(BAND_EDGES, band, strict=True):
            if (number := _num(value)) is not None:
                out.append(sample("verdify_band_edge", number, edge=edge))
    return out


def _ingestor_samples(counters: Mapping[str, Any], age_s: float) -> list[Sample]:
    out = [sample("verdify_ingestor_counters_age_seconds", age_s)]
    if (reconnects := _num(counters.get("rc"))) is not None:
        out.append(sample("verdify_ingestor_reconnects_total", reconnects))
    if (payloads := _num(counters.get("pr"))) is not None:
        out.append(sample("verdify_ingestor_payloads_rejected_total", payloads))
    rejected: dict[str, float] = {}
    for table, count in (counters.get("rj") or {}).items():
        if (number := _num(count)) is not None:
            label = bounded(table, REJECTED_TABLES)
            rejected[label] = rejected.get(label, 0.0) + number
    for table, count in rejected.items():
        out.append(sample("verdify_ingestor_rows_rejected_total", count, table=table))
    if counters.get("fw"):
        out.append(sample("verdify_firmware_pin_info", 1, version=firmware_label(counters["fw"])))
    return out


def relay_samples(rows: Sequence[Mapping[str, Any]]) -> list[Sample]:
    out: list[Sample] = []
    for row in rows:
        if row["equipment"] not in RELAYS or row["state"] is None:
            continue
        out.append(sample("verdify_relay_on", 1 if row["state"] else 0, relay=row["equipment"]))
        out.append(sample("verdify_relay_state_age_seconds", row["age_s"], relay=row["equipment"]))
    return out


def house_samples(row: Mapping[str, Any] | None) -> list[Sample]:
    if row is None:
        return []
    out = [sample("verdify_house_sample_age_seconds", row["age_s"])]
    for name, column in (
        ("verdify_house_temperature_fahrenheit", "temp_avg"),
        ("verdify_house_vpd_kpa", "vpd_avg"),
        ("verdify_house_rh_percent", "rh_avg"),
    ):
        if (value := _num(row[column])) is not None:
            out.append(sample(name, value))
    return out


def probe_samples(row: Mapping[str, Any] | None) -> list[Sample]:
    out: list[Sample] = []
    for probe in PROBES:
        age = _num(row[probe]) if row is not None else None
        out.append(sample("verdify_sensor_age_seconds", PROBE_WINDOW_S if age is None else age, sensor=probe))
    return out


def freshness_samples(row: Mapping[str, Any] | None) -> list[Sample]:
    out: list[Sample] = []
    for table in FLOW_TABLES:
        if row is not None and (age := _num(row[table])) is not None:
            out.append(sample("verdify_table_last_row_age_seconds", age, table=table))
    return out


def flow_samples(row: Mapping[str, Any] | None, gaps: Sequence[Mapping[str, Any]]) -> list[Sample]:
    out: list[Sample] = []
    for table in FLOW_TABLES:
        if row is not None and (count := _num(row[table])) is not None:
            out.append(sample("verdify_table_rows_5m", count, table=table))
    by_status: dict[str, tuple[float, float]] = {}
    for gap in gaps:
        status = bounded(gap["status"], GAP_STATUSES)
        n, seconds = by_status.get(status, (0.0, 0.0))
        by_status[status] = (n + float(gap["n"]), seconds + float(gap["seconds"]))
    for status, (n, seconds) in by_status.items():
        out.append(sample("verdify_data_gaps_7d", n, status=status))
        out.append(sample("verdify_data_gap_seconds_7d", seconds, status=status))
    return out


def delivery_samples(rows: Sequence[Mapping[str, Any]], oldest_s: Any) -> list[Sample]:
    counts: dict[tuple[str, str], float] = {}
    for row in rows:
        key = (bounded(row["status"], DELIVERY_STATUSES), bounded(row["source"], SETPOINT_SOURCES))
        counts[key] = counts.get(key, 0.0) + float(row["n"])
    out = [
        sample("verdify_setpoint_rows_24h", n, status=status, source=source) for (status, source), n in counts.items()
    ]
    out.append(sample("verdify_setpoint_oldest_unconfirmed_seconds", _num(oldest_s) or 0.0))
    return out


def compliance_samples(rows: Sequence[Mapping[str, Any]]) -> list[Sample]:
    out: list[Sample] = []
    for row in rows:
        day = bounded(row["day"], COMPLIANCE_WINDOWS)
        for axis in COMPLIANCE_AXES:
            graded = _num(row[f"{axis}_graded_min"])
            inside = _num(row[f"{axis}_in_min"])
            if graded is None:
                continue
            out.append(sample("verdify_band_compliance_graded_minutes", graded, window=day, axis=axis))
            if graded > 0 and inside is not None:
                out.append(sample("verdify_band_compliance_ratio", inside / graded, window=day, axis=axis))
    return out


def utility_samples(record: Mapping[str, Any] | None, meter: Mapping[str, Any] | None) -> list[Sample]:
    out: list[Sample] = []
    if record is not None:
        out.append(sample("verdify_daily_record_complete", 1.0 if record["complete"] else 0.0))
        for utility, column in (
            ("electric_kwh", "kwh_metered"),
            ("gas_therm", "therms_est"),
            ("water_gal", "water_gal"),
        ):
            if (value := _num(record[column])) is not None:
                out.append(sample("verdify_utility_yesterday", value, utility=utility))
        if (coverage := _num(record["meter_coverage_pct"])) is not None:
            out.append(sample("verdify_meter_coverage_ratio", coverage / 100.0))
    if meter is not None:
        if (kwh := _num(meter["kwh_today"])) is not None:
            out.append(sample("verdify_utility_today", kwh, utility="electric_kwh"))
        for channel in METER_CHANNELS:
            age = _num(meter[f"{channel}_age_s"])
            out.append(sample("verdify_meter_age_seconds", 3600.0 if age is None else age, meter=channel))
            quality = bounded(meter[f"{channel}_quality"], METER_QUALITIES)
            out.append(sample("verdify_meter_quality", 1, meter=channel, quality=quality))
    else:
        for channel in METER_CHANNELS:
            out.append(sample("verdify_meter_age_seconds", 3600.0, meter=channel))
    return out


def alert_tally(by_type: Mapping[tuple[str, str], int]) -> dict[tuple[str, str], int]:
    """Severity and alert_type mapped to their fixed lists; unknown values add up under ``other``."""
    tally: dict[tuple[str, str], int] = {}
    for (severity, alert_type), count in by_type.items():
        key = (bounded(severity, SEVERITIES), bounded(alert_type, KNOWN_ALERT_TYPES))
        tally[key] = tally.get(key, 0) + count
    return tally


def read_release_pins(path: Path = RELEASE_PINS_PATH) -> list[Sample]:
    """``verdify_release_pin_info{image,digest}`` from the mounted release-pins.yaml (ImageTagTransformer documents).
    A missing or unreadable file gives no series; the other groups are unaffected."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    out: list[Sample] = []
    for document in text.split("\n---"):
        name = re.search(r"^\s+name:\s*\S*/([a-z0-9-]+)\s*$", document, re.MULTILINE)
        digest = re.search(r"^\s+digest:\s*(\S+)\s*$", document, re.MULTILINE)
        if name and digest and _DIGEST.fullmatch(digest.group(1)):
            image = bounded(name.group(1), RELEASE_IMAGES)
            if image != OTHER:
                out.append(sample("verdify_release_pin_info", 1, image=image, digest=digest.group(1)))
    return out


# ── groups and the timer ────────────────────────────────────────────────────

Collect = Callable[[Any, "ProductMetrics"], Awaitable[Any]]


async def _collect_alerts(conn: Any, metrics: ProductMetrics) -> dict[tuple[str, str], int]:
    return alert_tally(await alerts.open_by_type(conn))


async def _collect_controller(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    return controller_samples(await conn.fetchrow(CONTROLLER_SQL))


async def _collect_devices(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    rows = await conn.fetch(DEVICES_SQL, [*IRRIGATION_ZONES, *LIGHT_CIRCUITS])
    return device_samples(rows, await conn.fetchrow(ENGINE_SQL), await conn.fetchrow(LEAD_FAN_SQL))


async def _collect_tables(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    return table_samples(await conn.fetch(TABLES_SQL, list(FLOW_TABLES)))


async def _collect_health(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    return health_samples(await conn.fetchrow(HEALTH_SQL))


async def _collect_state(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    return state_samples(await conn.fetch(STATE_SQL, list(STATE_ENTITIES)), metrics.counters)


async def _collect_relays(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    return relay_samples(await conn.fetch(RELAYS_SQL, list(RELAYS)))


async def _collect_house(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    return house_samples(await conn.fetchrow(HOUSE_SQL))


async def _collect_freshness(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    return freshness_samples(await conn.fetchrow(FRESHNESS_SQL))


async def _collect_delivery(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    rows = await conn.fetch(DELIVERY_SQL)
    return delivery_samples(rows, await conn.fetchval(OLDEST_UNCONFIRMED_SQL))


async def _collect_probes(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    return probe_samples(await conn.fetchrow(PROBES_SQL))


async def _collect_flow(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    row = await conn.fetchrow(FLOW_SQL)
    return flow_samples(row, await conn.fetch(GAPS_SQL))


async def _collect_compliance(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    return compliance_samples(await conn.fetch(COMPLIANCE_SQL))


async def _collect_utilities(conn: Any, metrics: ProductMetrics) -> list[Sample]:
    record = await conn.fetchrow(DAILY_RECORD_SQL)
    return utility_samples(record, await conn.fetchrow(METER_SQL))


@dataclass(frozen=True)
class Group:
    name: str
    period_s: float
    collect: Collect


ALERTS_GROUP = "alerts"
GROUPS: tuple[Group, ...] = (
    Group(ALERTS_GROUP, 60, _collect_alerts),
    Group("controller", 60, _collect_controller),
    Group("health", 60, _collect_health),
    Group("devices", 60, _collect_devices),
    Group("tables", 900, _collect_tables),
    Group("state", 60, _collect_state),
    Group("relays", 60, _collect_relays),
    Group("house", 60, _collect_house),
    Group("freshness", 60, _collect_freshness),
    Group("delivery", 60, _collect_delivery),
    Group("probes", 300, _collect_probes),
    Group("flow", 300, _collect_flow),
    Group("compliance", 300, _collect_compliance),
    Group("utilities", 300, _collect_utilities),
)
# verdify_alert_metrics_up is 1 only while the alert read is this fresh (3 periods), so the paging gauge never
# serves an old count as current.
ALERTS_FRESH_S = 180.0


@dataclass
class Snapshot:
    value: Any = None
    ok: bool = False
    succeeded_at: float | None = None
    duration_s: float = 0.0
    attempted_at: float | None = None
    failing: bool = False


@dataclass
class ProductMetrics:
    groups: tuple[Group, ...] = GROUPS
    clock: Callable[[], float] = time.time
    release_pins_path: Path = RELEASE_PINS_PATH
    counters: Accumulator = field(default_factory=Accumulator)
    snapshots: dict[str, Snapshot] = field(default_factory=dict)
    started_at: float = 0.0
    release_pins: list[Sample] = field(default_factory=list)
    on_failure: Callable[[str, str], None] | None = None
    # The file's identity when release_pins was read (#1734 C-5): the ConfigMap keeps its name across promotions and
    # the kubelet swaps the mounted file in place, so render() reads it again whenever it changes.
    _release_pins_stamp: tuple[int, int, int] | None = None

    def __post_init__(self) -> None:
        self.started_at = self.clock()
        self.snapshots = {group.name: Snapshot() for group in self.groups}
        self.current_release_pins()

    def current_release_pins(self) -> list[Sample]:
        """The release pins, read again when the mounted file's inode, size or mtime changed since the last read."""
        try:
            stat = self.release_pins_path.stat()
            stamp: tuple[int, int, int] | None = (stat.st_ino, stat.st_size, stat.st_mtime_ns)
        except OSError:
            stamp = None
        if stamp is None or stamp != self._release_pins_stamp:
            self.release_pins = read_release_pins(self.release_pins_path)
            self._release_pins_stamp = stamp
        return self.release_pins

    def due(self, now: float) -> list[Group]:
        return [
            group
            for group in self.groups
            if (attempted := self.snapshots[group.name].attempted_at) is None or now - attempted >= group.period_s
        ]

    async def refresh(self, pool: Any, group: Group) -> None:
        """One group on its own checkout. A failure or timeout drops the group's series and is logged by type only."""
        snapshot = self.snapshots[group.name]
        started = self.clock()
        snapshot.attempted_at = started
        try:
            async with asyncio.timeout(QUERY_TIMEOUT_S * 2):
                async with pool.acquire() as conn:
                    await conn.execute(STATEMENT_TIMEOUT_SQL)
                    value = await group.collect(conn, self)
        except Exception as failure:  # noqa: BLE001 - every failure is a failed group, never a failed scrape
            if not snapshot.failing:  # logged once per run of failures
                snapshot.failing = True
                if self.on_failure is not None:
                    self.on_failure(group.name, type(failure).__name__)
                else:
                    log.warning("metrics group %s failed: %s", group.name, type(failure).__name__)
            snapshot.ok, snapshot.value = False, None
        else:
            snapshot.ok, snapshot.value, snapshot.succeeded_at = True, value, self.clock()
            snapshot.failing = False
        snapshot.duration_s = self.clock() - started

    async def refresh_due(self, pool: Any) -> None:
        for group in self.due(self.clock()):
            await self.refresh(pool, group)

    async def run(self, pool: Any, tick_s: float = 1.0) -> None:
        """The lifespan task: groups run one at a time, so the timer holds at most one pooled connection."""
        while True:
            await self.refresh_due(pool)
            await asyncio.sleep(tick_s)

    def alert_tally(self) -> dict[tuple[str, str], int] | None:
        """The open-alert tally while it is fresh, else None (``verdify_alert_metrics_up 0``)."""
        snapshot = self.snapshots.get(ALERTS_GROUP)
        if snapshot is None or not snapshot.ok or snapshot.succeeded_at is None:
            return None
        if self.clock() - snapshot.succeeded_at > ALERTS_FRESH_S:
            return None
        return snapshot.value

    def render(self) -> str:
        """Everything except the alert lines, which operator_api.render_alert_metrics keeps in their #1352 form."""
        now = self.clock()
        out: list[Sample] = list(self.current_release_pins())
        for group in self.groups:
            snapshot = self.snapshots[group.name]
            since = snapshot.succeeded_at if snapshot.succeeded_at is not None else self.started_at
            out.append(sample("verdify_metrics_refresh_age_seconds", max(0.0, now - since), group=group.name))
            out.append(sample("verdify_metrics_refresh_success", 1 if snapshot.ok else 0, group=group.name))
            out.append(sample("verdify_metrics_refresh_duration_seconds", snapshot.duration_s, group=group.name))
            if group.name != ALERTS_GROUP and snapshot.ok and snapshot.value:
                out += snapshot.value
        return render(out)
