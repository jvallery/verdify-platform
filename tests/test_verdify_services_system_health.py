"""verdify_services.system_health: API-35 to API-37 on a fake connection, the shared statements and the limits.

The statements are the operator API's product metrics' own (one definition, imported by api/product_metrics.py), so
these tests hold that both read the same text, that every new statement is bounded by time, that the replayed
quarters come from v_dashboard_gap_replay and never gap_replay_quarters, and that each hardware-budget limit equals
its one definition in the firmware. The rows are live-shaped (verdify-db, 2026-11-17). The SQL itself runs on the
in-cluster campaign database only.
"""

from __future__ import annotations

import asyncio
import re
import sys
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import jsonschema
import pytest
import yaml

from verdify_services import system_health as sh

ROOT = Path(__file__).resolve().parents[1]
OPENAPI = yaml.safe_load((ROOT / "docs/design/dashboard/openapi/dashboard-api.v1.yaml").read_text())
API = ROOT / "api"
if str(API) not in sys.path:
    sys.path.insert(0, str(API))

import product_metrics as pm  # noqa: E402

NOW = datetime(2026, 11, 17, 16, 0, tzinfo=UTC)
FW = "2026.11.17.0609.8c5cd3bf"
COUNTERS = '{"v":1,"rc":0,"pr":0,"rj":{"climate":3},"fw":"' + FW + '","gr":0}'

CONTROLLER_ROW = {
    "age_s": 12.0,
    "heap_bytes": 91.48,
    "heap_min_free_kb": 70.48,
    "heap_largest_free_block_kb": 88,
    "wifi_rssi": -60,
    "uptime_s": 35163,
    "reset_reason": "Software reset",
    "firmware_version": FW,
    "sntp_valid": 1,
    "sntp_miss_count": 0,
    "last_sntp_sync_age_s": 691,
    "active_probe_count": 4,
    "band_source": "onchip_curve",
}
HEALTH_ROW = {
    "heap_min_free_minute_kb": 89.94,
    "heap_largest_block_minute_low_kb": 80,
    "loop_worst_ms": 11.40,
    "restart_count": 2,
    "nvs_used_entries": 1711,
    "nvs_free_entries": 12023,
    "nvs_write_worst_ms": 3.88,
    "gap_log_state": "armed",
    "sensor_degraded_active": 0,
    "loop_stack_high_water_b": 1848,
    "wifi_disconnect_count": 2,
    "api_client_count": 2,
}
EXTRA_ROW = {"uptime_s": 35163, "uptime_at": NOW - timedelta(seconds=20), "probe_health": "OK"}


def run(coro):
    return asyncio.run(coro)


def schema_errors(name: str, instance) -> list[str]:
    validator = jsonschema.Draft202012Validator(
        {"$ref": f"#/components/schemas/{name}", "components": OPENAPI["components"]},
        format_checker=jsonschema.FormatChecker(),
    )
    return [f"{list(error.absolute_path)}: {error.message}" for error in validator.iter_errors(instance)]


class FakeConn:
    """Answers each statement by identity; an unknown statement fails the test."""

    def __init__(self, rows: dict[str, object], vals: dict[str, object] | None = None):
        self.rows = rows
        self.vals = {sh.NOW_SQL: NOW, **(vals or {})}
        self.calls: list[tuple[str, tuple]] = []
        self.readonly: list[bool] = []
        self.isolation: list[str | None] = []
        self.executed: list[str] = []

    @asynccontextmanager
    async def _tx(self, readonly=False):
        self.readonly.append(readonly)
        yield

    def transaction(self, readonly=False, **kwargs):
        self.isolation.append(kwargs.get("isolation"))
        return self._tx(readonly)

    async def execute(self, sql, *args):
        self.executed.append(sql)

    def _answer(self, table, sql, args):
        self.calls.append((sql, args))
        if sql not in table:
            raise AssertionError(f"unexpected statement: {sql[:120]}")
        return table[sql]

    async def fetchval(self, sql, *args):
        return self._answer(self.vals, sql, args)

    async def fetchrow(self, sql, *args):
        return self._answer(self.rows, sql, args)

    async def fetch(self, sql, *args):
        answer = self._answer(self.rows, sql, args)
        if sql == sh.STATE_ROWS_SQL:
            return [row for row in answer if row["entity"] in args[0]]
        return answer


STATE = [
    {"entity": "ingestor_counters", "ts": NOW - timedelta(seconds=30), "value": COUNTERS},
    {"entity": "ingestor_heartbeat", "ts": NOW - timedelta(seconds=9), "value": "alive"},
    {"entity": "dispatcher_stage", "ts": NOW - timedelta(minutes=1), "value": "ordinary"},
    {"entity": "setpoint_snapshot_pass", "ts": NOW - timedelta(seconds=40), "value": "stored=2 of=102"},
]


# ── one definition each ──────────────────────────────────────────────────────


def test_the_product_metrics_run_the_same_statements():
    for name in (
        "CONTROLLER_SQL",
        "HEALTH_SQL",
        "PROBES_SQL",
        "FRESHNESS_SQL",
        "FLOW_SQL",
        "GAPS_SQL",
        "UNREPLAYED_SQL",
        "DELIVERY_SQL",
        "OLDEST_UNCONFIRMED_SQL",
        "PROBES",
        "PROBE_WINDOW_S",
        "FLOW_TABLES",
    ):
        assert getattr(pm, name) is getattr(sh, name), name
    assert sh.DELIVERY_STATEMENTS[24]["delivery"] == pm.DELIVERY_SQL
    assert sh.DELIVERY_STATEMENTS[24]["oldest"] == pm.OLDEST_UNCONFIRMED_SQL
    for hours in (24, 168):
        for sql in sh.DELIVERY_STATEMENTS[hours].values():
            assert f"ts > now() - interval '{hours} hours'" in sql


def test_the_oldest_unconfirmed_push_waits_on_no_ended_push_and_keeps_its_index():
    """A cancelled push read as 21 h of waiting (live, 2026-11-17): every ended status is left out, and the WHERE
    keeps idx_setpoint_changes_unconfirmed's predicate and its time bound."""
    for hours in (24, 168):
        sql = sh.DELIVERY_STATEMENTS[hours]["oldest"]
        assert "confirmed_at IS NULL" in sql and f"ts > now() - interval '{hours} hours'" in sql
        excluded = re.search(r"NOT IN \(([^)]*)\)", sql)
        assert excluded is not None
        statuses = {item.strip().strip("'") for item in excluded.group(1).split(",")}
        assert statuses == {"superseded", "failed", "expired", "cancelled", "observed"}


def test_every_new_statement_is_bounded_by_time():
    for sql in (
        sh.CONTROLLER_EXTRA_SQL,
        sh.STATE_ROWS_SQL,
        sh.OUTAGES_SQL,
        sh.REPLAYED_SQL,
        *sh.DELIVERY_STATEMENTS[24].values(),
        *sh.DELIVERY_STATEMENTS[168].values(),
    ):
        # A relation follows FROM at a line's start; extract(epoch FROM x) is an expression, not a source.
        sources = re.findall(r"^\s*FROM ([\w.]+)", sql, re.M) + re.findall(r"SELECT ts, value FROM (\w+)", sql)
        sources = [t for t in sources if t not in ("unnest", "now")]
        bounds = re.findall(r"\b(?:ts|start_ts|end_ts|last_ts) > now\(\) - (?:interval|make_interval)", sql)
        assert sources and len(bounds) >= len(sources), sql
    by_day = sh.BY_DAY_SQL
    assert "FROM v_data_gaps_unreplayed\n     WHERE end_ts > now() - make_interval(days => $1::int)" in by_day
    assert "FROM public.v_dashboard_gap_replay\n     WHERE last_ts > now() - make_interval(days => $1::int)" in by_day


def test_the_replayed_quarters_come_from_the_dashboard_view_only():
    source = (ROOT / "verdify_services/system_health.py").read_text()
    assert "FROM public.v_dashboard_gap_replay" in sh.REPLAYED_SQL
    assert re.search(r"FROM\s+(public\.)?gap_replay_quarters", source) is None


# ── API-35 ────────────────────────────────────────────────────────────────────


def test_controller_health_from_live_rows():
    rows = {
        sh.CONTROLLER_SQL: CONTROLLER_ROW,
        sh.HEALTH_SQL: HEALTH_ROW,
        sh.CONTROLLER_EXTRA_SQL: EXTRA_ROW,
        sh.STATE_ROWS_SQL: STATE,
    }
    conn = FakeConn(rows)
    health = run(sh.controller(conn))
    # One snapshot for the whole read: the uptime reading and its time come from statements that must agree.
    assert conn.readonly == [True] and conn.isolation == ["repeatable_read"]
    assert health.observed_at == NOW - timedelta(seconds=12)
    assert health.firmware.model_dump() == {"version": FW, "pinned": FW, "matches": True}
    assert health.restarts.booted_at == NOW - timedelta(seconds=20 + 35163)
    assert health.restarts.count == 2 and health.restarts.reset_reason == "Software reset"
    assert health.heap.free_kb == 91.48 and health.heap.largest_block_minute_low_kb == 80.0
    assert health.loop.stack_free_min_b == 1848 and health.nvs.used_entries == 1711
    assert health.clock.valid is True and health.clock.misses == 0
    assert health.probes.model_dump() == {"active": 4, "degraded": False, "health": "OK"}
    assert health.band_source == "onchip_curve" and health.gap_log == "armed"
    body = health.model_dump(mode="json")
    assert schema_errors("ControllerHealth", body) == []
    assert body["limits"] == {
        "heap_warning_kb": 25.0,
        "heap_critical_kb": 15.0,
        "largest_block_kb": 16.0,
        "ota_free_kb": 32.0,
        "loop_worst_ms": 250.0,
        "nvs_write_ms": 200.0,
        "stack_free_b": 1024.0,
        "nvs_arm_free_pct": 25.0,
        "nvs_stop_free_pct": 15.0,
    }


def test_booted_at_comes_from_one_uptime_reading_and_its_own_time():
    # CONTROLLER_SQL's uptime_s is newer than the pair: booted_at still pairs the extra row's reading with its time.
    health = sh.controller_health(
        NOW, {**CONTROLLER_ROW, "uptime_s": 35223}, HEALTH_ROW, {**EXTRA_ROW, "uptime_s": 35163}, None
    )
    assert health.uptime_s == 35223
    assert health.restarts.booted_at == NOW - timedelta(seconds=20 + 35163)


def test_a_silent_controller_is_null_never_zero():
    empty = dict.fromkeys(CONTROLLER_ROW)
    health = sh.controller_health(
        NOW, empty, dict.fromkeys(HEALTH_ROW), {"uptime_s": None, "uptime_at": None, "probe_health": None}, None
    )
    body = health.model_dump(mode="json")
    assert schema_errors("ControllerHealth", body) == []
    assert body["observed_at"] is None and body["uptime_s"] is None
    assert body["firmware"] == {"version": None, "pinned": None, "matches": None}
    for group in ("restarts", "heap", "loop", "nvs", "wifi", "clock", "probes"):
        assert set(body[group].values()) == {None}, group
    # the firmware differs from the pin
    other = sh.controller_health(
        NOW, {**CONTROLLER_ROW, "firmware_version": "2026.11.16.0000.aaaaaaaa"}, None, None, {"value": COUNTERS}
    )
    assert other.firmware.matches is False and other.heap.minute_low_kb is None


@pytest.mark.parametrize(
    ("stored", "served"),
    [
        ("armed", "armed"),
        ("off: not_armed_yet", "not_armed_yet"),
        ("off: nvs_full", "nvs_full"),
        ("off: nvs_slow", "nvs_slow"),
        (None, None),
    ],
)
def test_the_gap_log_is_worded_as_law_alone(stored, served):
    assert sh.gap_log_name(stored) == served


def _firmware(path: str) -> str:
    return (ROOT / "firmware" / path).read_text()


def test_each_limit_equals_its_one_firmware_definition():
    yaml_text = _firmware("greenhouse.yaml")
    warning = yaml_text.split("id: bs_heap_pressure_warning", 1)[1].split("- platform:", 1)[0]
    critical = yaml_text.split("id: bs_heap_pressure_critical", 1)[1].split("# ──", 1)[0]
    assert f"heap_kb < {sh.HEAP_WARNING_KB}f" in warning and "> 120000" in warning
    assert f"heap_kb < {sh.HEAP_CRITICAL_KB}f" in critical
    heap = _firmware("lib/heap_diagnostics.h")
    assert f"GH_PRE_OTA_MIN_LARGEST_BLOCK_KB = {sh.LARGEST_BLOCK_KB}f;" in heap
    assert f"GH_PRE_OTA_MIN_FREE_HEAP_KB = {sh.OTA_FREE_KB}f;" in heap
    assert f"GH_CONTROL_LOOP_WARN_US = {int(sh.LOOP_WORST_MS * 1000)}u;" in heap
    gap_log = _firmware("lib/gap_log.h")
    assert f"SLOW_WRITE_US = {int(sh.NVS_WRITE_MS * 1000)}u;" in gap_log
    assert f"ARM_MIN_FREE_PCT = {int(sh.NVS_ARM_FREE_PCT)};" in gap_log
    assert f"STOP_FREE_PCT = {int(sh.NVS_STOP_FREE_PCT)};" in gap_log
    # The loop stack has no firmware guard: its one definition is the estate alert rule (monitoring-stack).
    assert sh.STACK_FREE_B == 1024.0


# ── API-36 ────────────────────────────────────────────────────────────────────


def test_data_continuity_from_live_rows():
    outages = [
        {
            "start_ts": NOW - timedelta(hours=3),
            "end_ts": NOW - timedelta(hours=3) + timedelta(seconds=184),
            "duration_s": 184,
            "reason": "ingestor_restart",
            "status": "snapshot_taken",
        }
    ]
    replayed = [
        {
            "boot": 2,
            "qseq": 55,
            "first_ts": datetime(2026, 11, 17, 15, 19, 40, tzinfo=UTC),
            "last_ts": datetime(2026, 11, 17, 15, 34, 12, tzinfo=UTC),
            "received_at": datetime(2026, 11, 17, 15, 34, 46, tzinfo=UTC),
            "climate_rows": 15,
            "transition_rows": 2,
        }
    ]
    by_day = [
        {"date": date(2026, 11, 16), "outage_s": 0, "replayed_min": 0},
        {"date": date(2026, 11, 17), "outage_s": 184, "replayed_min": 15},
    ]
    freshness = dict.fromkeys(sh.FLOW_TABLES, 4.0) | {"setpoint_changes": None}
    flow = dict.fromkeys(sh.FLOW_TABLES, 5) | {"setpoint_changes": 0}
    probes = dict.fromkeys(sh.PROBES, 30.0) | {"co2_ppm": None}
    rows = {
        sh.HEALTH_SQL: HEALTH_ROW | {"gap_log_state": "off: nvs_slow"},
        sh.OUTAGES_SQL: outages,
        sh.REPLAYED_SQL: replayed,
        sh.BY_DAY_SQL: by_day,
        sh.FRESHNESS_SQL: freshness,
        sh.FLOW_SQL: flow,
        sh.PROBES_SQL: probes,
        sh.probe_last_seen_sql(["co2_ppm"]): {"co2_ppm": NOW - timedelta(days=3)},
        sh.STATE_ROWS_SQL: STATE,
    }
    conn = FakeConn(rows)
    result = run(sh.data(conn, 7))
    assert conn.readonly == [True] and conn.isolation == ["repeatable_read"]
    assert [args for sql, args in conn.calls if sql in (sh.OUTAGES_SQL, sh.REPLAYED_SQL, sh.BY_DAY_SQL)] == [(7,)] * 3
    body = result.model_dump(mode="json")
    assert schema_errors("DataContinuity", body) == []
    assert body["from"] == "2026-11-10T16:00:00Z" and body["to"] == "2026-11-17T16:00:00Z"
    assert body["gap_log"] == "nvs_slow"
    assert body["outages"][0]["duration_s"] == 184 and body["replayed"][0]["climate_rows"] == 15
    assert [day["date"] for day in body["by_day"]] == ["2026-11-16", "2026-11-17"]
    assert [t["table"] for t in body["tables"]] == list(sh.FLOW_TABLES)
    assert body["tables"][-1] == {"table": "setpoint_changes", "last_row_age_s": None, "rows_5m": 0}
    probe = {p["sensor"]: p["age_s"] for p in body["probes"]}
    assert probe["climate.temp_north"] == 30.0 and probe["climate.co2_ppm"] == 7200
    seen = {p["sensor"]: p["last_seen_at"] for p in body["probes"]}
    assert seen["climate.temp_north"] is None and seen["climate.co2_ppm"] == "2026-11-14T16:00:00Z"
    assert conn.calls.index((sh.probe_last_seen_sql(["co2_ppm"]), ())) > conn.calls.index((sh.PROBES_SQL, ()))
    assert body["ingestor"] == {
        "heartbeat_age_s": 9.0,
        "reconnects": 0,
        "payloads_rejected": 0,
        "replay_failures": 0,
        "rows_rejected": {"climate": 3},
        "observed_at": "2026-11-17T15:59:30Z",
    }


def test_a_silent_probe_says_when_it_last_answered():
    # Live-shaped: the seven soil probes silent since 2026-11-14, co2 out of the window an hour ago, the rest fresh.
    soil = [probe for probe in sh.PROBES if probe.startswith("soil_")]
    row = dict.fromkeys(sh.PROBES, 42.0) | dict.fromkeys([*soil, "co2_ppm"])
    assert sh.unseen_probes(row) == ["co2_ppm", *soil]  # PROBES order
    last_seen = dict.fromkeys(soil, NOW - timedelta(days=3)) | {
        "soil_ec_south_1": None,
        "co2_ppm": NOW - timedelta(hours=3),
    }
    ages = {probe.sensor: probe for probe in sh.probe_ages(row, last_seen)}
    assert len(ages) == len(sh.PROBES)
    assert ages["climate.temp_north"].model_dump() == {
        "sensor": "climate.temp_north",
        "age_s": 42.0,
        "last_seen_at": None,
    }
    assert ages["climate.co2_ppm"].model_dump() == {
        "sensor": "climate.co2_ppm",
        "age_s": 7200,
        "last_seen_at": NOW - timedelta(hours=3),
    }
    assert ages["climate.soil_temp_west"].last_seen_at == NOW - timedelta(days=3)
    assert ages["climate.soil_ec_south_1"].last_seen_at is None  # no reading in 30 days
    # A probe inside the window keeps a null last_seen_at even if the row names it.
    assert sh.probe_ages(row, last_seen | {"temp_north": NOW})[0].last_seen_at is None
    # No second row (none run, or nothing read): every probe outside the window is null.
    assert {probe.last_seen_at for probe in sh.probe_ages(None)} == {None}
    assert {probe.model_dump()["last_seen_at"] for probe in sh.probe_ages(row, None)} == {None}


def test_the_last_seen_statement_is_built_from_the_probes_alone_and_bounded():
    sql = sh.probe_last_seen_sql(["co2_ppm", "soil_ec_south_1"])
    assert sql == (
        "SELECT max(ts) FILTER (WHERE co2_ppm IS NOT NULL) AS co2_ppm, "
        "max(ts) FILTER (WHERE soil_ec_south_1 IS NOT NULL) AS soil_ec_south_1 "
        "FROM climate WHERE ts > now() - interval '30 days'"
    )
    for bad in ([], ["co2_ppm; DROP TABLE climate"], ["temp_avg"], ["co2_ppm", "ts"]):
        with pytest.raises(ValueError):
            sh.probe_last_seen_sql(bad)
    # PROBES_SQL, which /metrics runs too, is unchanged: one 2 h pass of ages.
    assert sh.PROBES_SQL.endswith(" FROM climate WHERE ts > now() - interval '7200 seconds'")
    assert "max(ts) FILTER" in sh.PROBES_SQL and "30 days" not in sh.PROBES_SQL


def test_every_probe_in_the_window_runs_no_last_seen_statement():
    rows = {
        sh.HEALTH_SQL: HEALTH_ROW,
        sh.OUTAGES_SQL: [],
        sh.REPLAYED_SQL: [],
        sh.BY_DAY_SQL: [],
        sh.FRESHNESS_SQL: dict.fromkeys(sh.FLOW_TABLES, 4.0),
        sh.FLOW_SQL: dict.fromkeys(sh.FLOW_TABLES, 5),
        sh.PROBES_SQL: dict.fromkeys(sh.PROBES, 30.0),
        sh.STATE_ROWS_SQL: STATE,
    }
    conn = FakeConn(rows)  # an unexpected statement fails the read
    result = run(sh.data(conn, 1))
    assert {probe.last_seen_at for probe in result.probes} == {None}
    assert not any("30 days" in sql for sql, _ in conn.calls)


def test_an_ingestor_with_no_counters_is_null():
    out = sh.ingestor(NOW, None, {"ts": NOW, "value": "not json"})
    assert out.model_dump() == {
        "heartbeat_age_s": None,
        "reconnects": None,
        "payloads_rejected": None,
        "replay_failures": None,
        "rows_rejected": None,
        "observed_at": None,
    }


# ── API-37 ────────────────────────────────────────────────────────────────────


def test_delivery_from_live_rows():
    statements = sh.DELIVERY_STATEMENTS[168]
    failing = [
        {
            "param": "gl_main_lux_threshold",
            "failed": 141,
            "last_failed_at": datetime(2026, 11, 17, 11, 50, tzinfo=UTC),
            "last_confirmed_at": None,
        },
        {"param": "retired_knob", "failed": 1, "last_failed_at": NOW - timedelta(days=2), "last_confirmed_at": NOW},
    ]
    rows = {
        statements["delivery"]: [
            {"status": "confirmed", "source": "band", "n": 40},
            {"status": "failed", "source": "band", "n": 142},
        ],
        statements["latency"]: {"p50_s": 4.2, "p95_s": 31.0, "confirmed": 40},
        statements["failing"]: failing,
        sh.STATE_ROWS_SQL: STATE,
    }
    conn = FakeConn(rows, {statements["oldest"]: 0.0})
    result = run(sh.delivery(conn, 168))
    body = result.model_dump(mode="json")
    assert schema_errors("Delivery", body) == []
    assert body["from"] == "2026-11-10T16:00:00Z"
    assert body["by_status"][0] == {"source": "band", "status": "failed", "count": 142}
    assert body["oldest_unconfirmed_s"] == 0.0 and body["latency"] == {"p50_s": 4.2, "p95_s": 31.0, "confirmed": 40}
    assert [(f["param"], f["label"]) for f in body["failing"]] == [
        ("gl_main_lux_threshold", "GL Main Lux Threshold"),
        ("retired_knob", "retired_knob"),
    ]
    assert body["dispatcher_stage"] == "ordinary"
    assert body["readback_pass"] == {"at": "2026-11-17T15:59:20Z", "stored": 2, "of": 102}
    assert not any("24 hours" in sql for sql, _ in conn.calls)


def test_no_confirmations_and_no_state_are_null():
    statements = sh.DELIVERY_STATEMENTS[24]
    rows = {
        statements["delivery"]: [],
        statements["latency"]: {"p50_s": None, "p95_s": None, "confirmed": 0},
        statements["failing"]: [],
        sh.STATE_ROWS_SQL: [],
    }
    body = run(sh.delivery(FakeConn(rows, {statements["oldest"]: 0.0}))).model_dump(mode="json")
    assert schema_errors("Delivery", body) == []
    assert body["latency"] == {"p50_s": None, "p95_s": None, "confirmed": 0}
    assert body["dispatcher_stage"] is None and body["readback_pass"] == {"at": None, "stored": None, "of": None}
    assert sh.readback_pass({"ts": NOW, "value": "paused"}).model_dump() == {"at": NOW, "stored": None, "of": None}
