"""Package 6 (contracts/metrics-coverage.md, RULINGS V1 to V5): the operator API's product metrics.

One exposure point: a background timer refreshes fixed query groups into a cache and ``/metrics`` renders the cache.
These tests hold the contract: labels come from fixed lists (unknown -> ``other``) so cardinality is bounded; a slow
or failed group drops only its own series and shows its age; a scrape never queries; the lifetime counters never
count a controller restart's step back; the release pins come from the mounted file.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "api"
if str(API) not in sys.path:
    sys.path.insert(0, str(API))

import operator_api  # noqa: E402
import product_metrics as pm  # noqa: E402

from verdify_schemas.telemetry import INGESTOR_REJECTED_TABLES, IngestorCounters  # noqa: E402

SETTINGS = operator_api.Settings(
    token="operator-api-test-token-not-a-secret-0001",  # noqa: S106
    db_host="verdify-db",
    db_name="verdify",
    db_user=operator_api.DASHBOARD_LOGIN,
    db_password="dashboard-login-test-password",  # noqa: S106
    source_revision="0123456789abcdef0123456789abcdef01234567",
)

DIAG = {
    "age_s": 12.0,
    "heap_bytes": 67.8359375,
    "heap_min_free_kb": 8.47265625,
    "heap_largest_free_block_kb": 36.0,
    "wifi_rssi": -53.0,
    "uptime_s": 804193.1875,
    "reset_reason": "Software reset",
    "firmware_version": "2026.11.7.0133.9517acb6",
    "sntp_valid": 1,
    "sntp_miss_count": 0,
    "last_sntp_sync_age_s": 30,
    "active_probe_count": 6,
    "band_source": "onchip_curve",
}
LAW = '{"v":1,"l":5,"o":1028,"dr":"not_drier","e":2.345,"lim":3.5,"br":0,"b":[60.0,78.0,0.6,1.2]}'
STATE_ROWS = [
    {"entity": "greenhouse_state", "age_s": 30.0, "value": "DEHUM_VENT"},
    {"entity": "outdoor_source", "age_s": 40.0, "value": "station"},
    {"entity": "climate_law_state", "age_s": 20.0, "value": LAW},
    {
        "entity": "relay_counters",
        "age_s": 50.0,
        "value": '{"v":1,"h1":100,"h2":50,"f1":10,"f2":5,"fg":7,"vt":9,"f1s":3600,"f2s":60}',
    },
    {"entity": "climate_drying_meter", "age_s": 70.0, "value": '{"v":1,"s":10,"g":20,"wh":30,"rw":40}'},
    {
        "entity": "ingestor_counters",
        "age_s": 15.0,
        "value": IngestorCounters(rc=2, pr=1, rj={"climate": 3}, fw="2026.11.7.0133.9517acb6").compact(),
    },
    {"entity": "ingestor_heartbeat", "age_s": 15.0, "value": "alive"},
]


def lines(text: str) -> dict[str, float]:
    return {
        line.rsplit(" ", 1)[0]: float(line.rsplit(" ", 1)[1])
        for line in text.splitlines()
        if line and not line.startswith("#")
    }


class Clock:
    def __init__(self, now: float = 1_000_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class Conn:
    """Answers every statement of every group from fixed rows; ``fail`` and ``slow`` name statements to break."""

    def __init__(self, pool: Pool) -> None:
        self.pool = pool

    async def _maybe(self, sql: str) -> None:
        self.pool.queries.append(sql)
        if sql in self.pool.fail:
            raise OSError("boom")
        if sql in self.pool.slow:
            await asyncio.sleep(10)

    async def execute(self, sql, *args):
        assert sql in (operator_api.SETUP_SQL, pm.STATEMENT_TIMEOUT_SQL)
        return "SET"

    async def fetchval(self, sql, *args):
        if sql == operator_api.ATTEST_SQL:
            return True
        await self._maybe(sql)
        assert sql == pm.OLDEST_UNCONFIRMED_SQL
        return 125.0

    async def fetchrow(self, sql, *args):
        await self._maybe(sql)
        if sql == pm.CONTROLLER_SQL:
            return DIAG
        if sql == pm.HOUSE_SQL:
            return {"age_s": 30.0, "temp_avg": 70.5, "vpd_avg": 0.9, "rh_avg": 65.0}
        if sql == pm.PROBES_SQL:
            return {probe: (None if probe == "co2_ppm" else 45.0) for probe in pm.PROBES}
        if sql == pm.FRESHNESS_SQL:
            return {table: 20.0 for table in pm.FLOW_TABLES}
        if sql == pm.FLOW_SQL:
            return {table: 5 for table in pm.FLOW_TABLES}
        raise AssertionError(sql)

    async def fetch(self, sql, *args):
        await self._maybe(sql)
        if sql == pm.STATE_SQL:
            assert args == (list(pm.STATE_ENTITIES),)
            return STATE_ROWS
        if sql == pm.RELAYS_SQL:
            assert args == (list(pm.RELAYS),)
            return [
                {"equipment": "heat1", "age_s": 100.0, "state": True},
                {"equipment": "vent", "age_s": 5.0, "state": False},
            ]
        if sql == pm.DELIVERY_SQL:
            return [
                {"status": "confirmed", "source": "band", "n": 300},
                {"status": "confirmed", "source": "plan", "n": 250},
                {"status": "weird", "source": "someone", "n": 2},
            ]
        if sql == pm.GAPS_SQL:
            return [{"status": "replayed", "n": 2, "seconds": 400.0}, {"status": "none", "n": 1, "seconds": 130.0}]
        from verdify_services import alerts

        if sql == alerts._OPEN_SQL:
            return []
        raise AssertionError(sql)


class Pool:
    def __init__(self, fail=(), slow=()) -> None:
        self.fail, self.slow = set(fail), set(slow)
        self.queries: list[str] = []
        self.acquires = 0

    @contextlib.asynccontextmanager
    async def acquire(self):
        self.acquires += 1
        yield Conn(self)

    async def close(self):
        pass


def metrics(clock=None, pins: Path | None = None) -> pm.ProductMetrics:
    return pm.ProductMetrics(clock=clock or Clock(), release_pins_path=pins or Path("/nonexistent/release-pins.yaml"))


def test_every_group_serves_and_reports_its_age():
    cache = metrics()
    asyncio.run(cache.refresh_due(Pool()))
    got = lines(cache.render())
    for group in pm.GROUPS:
        assert got[f'verdify_metrics_refresh_success{{group="{group.name}"}}'] == 1
        assert got[f'verdify_metrics_refresh_age_seconds{{group="{group.name}"}}'] == 0
    assert got["verdify_controller_heap_free_bytes"] == pytest.approx(67.8359375 * 1024)  # heap_bytes holds KB
    assert got["verdify_controller_heap_min_free_bytes"] == pytest.approx(8.47265625 * 1024)
    assert got["verdify_controller_heap_largest_free_block_bytes"] == 36 * 1024
    assert got['verdify_controller_reset_reason{reason="software"}'] == 1
    assert got['verdify_controller_firmware_info{version="2026.11.7.0133.9517acb6"}'] == 1
    assert got['verdify_greenhouse_state{state="DEHUM_VENT"}'] == 1
    assert got['verdify_outdoor_source{source="station"}'] == 1
    assert got['verdify_relay_on{relay="heat1"}'] == 1 and got['verdify_relay_on{relay="vent"}'] == 0
    assert got['verdify_sensor_age_seconds{sensor="co2_ppm"}'] == pm.PROBE_WINDOW_S
    assert got['verdify_sensor_age_seconds{sensor="temp_case"}'] == 45
    assert got['verdify_setpoint_rows_24h{source="other",status="other"}'] == 2
    assert got["verdify_setpoint_oldest_unconfirmed_seconds"] == 125
    assert got['verdify_data_gaps_7d{status="replayed"}'] == 2
    assert got['verdify_table_rows_5m{table="climate"}'] == 5
    assert got['verdify_ingestor_rows_rejected_total{table="climate"}'] == 3
    assert got["verdify_ingestor_reconnects_total"] == 2
    assert got['verdify_firmware_pin_info{version="2026.11.7.0133.9517acb6"}'] == 1


def test_the_law_state_decodes_its_masks_band_and_refusal():
    got = lines(pm.render(pm._law_samples(json.loads(LAW))))
    assert got['verdify_law_latch{latch="heat1"}'] == 1 and got['verdify_law_latch{latch="cool"}'] == 1  # l=5
    assert got['verdify_law_latch{latch="heat2"}'] == 0
    assert got['verdify_law_request{request="vent"}'] == 1 and got['verdify_law_request{request="cold"}'] == 1  # o=1028
    assert got['verdify_law_drying_refusal{reason="not_drier"}'] == 1
    assert got['verdify_band_edge{edge="vpd_high"}'] == 1.2
    assert got["verdify_law_drying_cost_kwh_per_kg"] == 2.345
    no_gain = pm._law_samples(
        {"v": 1, "l": 0, "o": 0, "dr": "new_reason", "e": 1000000000, "lim": 3.5, "br": 1, "b": []}
    )
    got = lines(pm.render(no_gain))
    assert "verdify_law_drying_cost_kwh_per_kg" not in got  # the 1e9 "no gain" sentinel is not a cost
    assert got['verdify_law_drying_refusal{reason="other"}'] == 1


def test_a_failed_group_drops_only_its_series_and_its_age_grows():
    clock, logged = Clock(), []
    cache = metrics(clock)
    cache.on_failure = lambda group, error: logged.append((group, error))
    asyncio.run(cache.refresh_due(Pool()))
    clock.now += 60
    broken = Pool(fail={pm.CONTROLLER_SQL})
    asyncio.run(cache.refresh_due(broken))
    clock.now += 60
    asyncio.run(cache.refresh_due(broken))  # still failing: logged once only
    got = lines(cache.render())
    assert not any(name.startswith("verdify_controller_") for name in got)
    assert got['verdify_metrics_refresh_success{group="controller"}'] == 0
    assert got['verdify_metrics_refresh_age_seconds{group="controller"}'] == 120
    assert got['verdify_metrics_refresh_age_seconds{group="state"}'] == 0
    assert got['verdify_greenhouse_state{state="DEHUM_VENT"}'] == 1
    assert logged == [("controller", "OSError")]


def test_a_slow_group_times_out_without_holding_the_others(monkeypatch):
    monkeypatch.setattr(pm, "QUERY_TIMEOUT_S", 0.05)
    cache = metrics()
    asyncio.run(cache.refresh_due(Pool(slow={pm.PROBES_SQL})))
    got = lines(cache.render())
    assert got['verdify_metrics_refresh_success{group="probes"}'] == 0
    assert got['verdify_metrics_refresh_duration_seconds{group="probes"}'] == 0  # the fake clock does not move
    assert not any(name.startswith("verdify_sensor_age_seconds") for name in got)
    assert got['verdify_metrics_refresh_success{group="flow"}'] == 1


def test_groups_run_on_their_own_periods():
    clock = Clock()
    cache = metrics(clock)
    pool = Pool()
    asyncio.run(cache.refresh_due(pool))
    first = len(pool.queries)
    clock.now += 60
    asyncio.run(cache.refresh_due(pool))
    again = pool.queries[first:]
    assert pm.CONTROLLER_SQL in again and pm.PROBES_SQL not in again and pm.FLOW_SQL not in again
    clock.now += 240
    asyncio.run(cache.refresh_due(pool))
    assert pm.PROBES_SQL in pool.queries[first + len(again) :]


def test_a_scrape_never_queries():
    pool = Pool()
    app = operator_api.create_app(settings=SETTINGS, pool=pool)
    with TestClient(app) as client:
        cache = app.state.product_metrics
        client.portal.call(cache.refresh_due, pool)
        cache.due = lambda now: []  # stop the background timer from running anything further
        before = (pool.acquires, len(pool.queries))
        for _ in range(3):
            response = client.get("/metrics")
            assert response.status_code == 200
        assert (pool.acquires, len(pool.queries)) == before
    assert "verdify_alert_metrics_up 1" in response.text
    assert "verdify_controller_uptime_seconds" in response.text


def test_the_alert_gauge_goes_down_when_its_read_is_stale():
    clock = Clock()
    cache = metrics(clock)
    asyncio.run(cache.refresh_due(Pool()))
    assert cache.alert_tally() == {}
    clock.now += pm.ALERTS_FRESH_S + 1
    assert cache.alert_tally() is None  # verdify_alert_metrics_up 0


def test_alert_labels_are_bounded():
    tally = pm.alert_tally({("critical", "sensor_offline"): 1, ("loud", "made_up_type"): 2, ("warning", "x"): 1})
    assert tally == {("critical", "sensor_offline"): 1, ("other", "other"): 2, ("warning", "other"): 1}


def test_lifetime_counters_never_count_a_restart_step_back():
    acc = pm.Accumulator()
    assert acc.advance("starts", "heat1", 1000) == 0  # starts at 0 with this process
    assert acc.advance("starts", "heat1", 1010) == 10
    assert acc.advance("starts", "heat1", 1004) == 10  # the hourly persist stepped back: no count, no reset
    assert acc.advance("starts", "heat1", 1006) == 12


def test_unknown_values_map_to_other_and_cardinality_is_bounded():
    garbage = [
        {"entity": "greenhouse_state", "age_s": 1.0, "value": "HACKED\nstate"},
        {"entity": "outdoor_source", "age_s": 1.0, "value": "a token=abc"},
        {"entity": "not_ours", "age_s": 1.0, "value": "x"},
        {
            "entity": "ingestor_counters",
            "age_s": 1.0,
            "value": '{"v":1,"rc":1,"pr":0,"rj":{"made_up":5},"fw":"bad pin!"}',
        },
    ]
    got = lines(pm.render(pm.state_samples(garbage, pm.Accumulator())))
    assert got['verdify_greenhouse_state{state="other"}'] == 1
    assert got['verdify_outdoor_source{source="other"}'] == 1
    assert got['verdify_ingestor_rows_rejected_total{table="other"}'] == 5
    assert got['verdify_firmware_pin_info{version="other"}'] == 1
    assert not any("not_ours" in name for name in got)
    diag = dict(DIAG, reset_reason="7", band_source="mystery", firmware_version="x y")
    got = lines(pm.render(pm.controller_samples(diag)))
    assert got['verdify_controller_reset_reason{reason="other"}'] == 1
    assert got['verdify_controller_band_source{source="other"}'] == 1
    assert got['verdify_controller_firmware_info{version="other"}'] == 1
    # The worst case from the fixed lists stays well under the 400 series of the design.
    worst = (
        len(pm.FAMILIES)
        + len(pm.RESET_REASONS)
        + len(pm.BAND_SOURCES)
        + len(pm.GREENHOUSE_STATES)
        + len(pm.OUTDOOR_SOURCES)
        + 4
        + len(pm.LAW_LATCHES)
        + len(pm.LAW_REQUESTS)
        + len(pm.DRYING_REFUSALS)
        + len(pm.BAND_EDGES)
        + len(pm.STATE_ENTITIES)
        + 2 * len(pm.RELAYS)
        + len(pm.RELAY_START_KEYS)
        + len(pm.RELAY_SECONDS_KEYS)
        + len(pm.PROBES)
        + 2 * len(pm.FLOW_TABLES)
        + 2 * (len(pm.GAP_STATUSES) + 1)
        + (len(pm.DELIVERY_STATUSES) + 1) * (len(pm.SETPOINT_SOURCES) + 1)
        + len(pm.REJECTED_TABLES)
        + 1
        + len(pm.RELEASE_IMAGES)
        + 3 * len(pm.GROUPS)
        + (len(pm.SEVERITIES) + 1) * (len(pm.KNOWN_ALERT_TYPES) + 1)
    )
    assert worst < 800  # alert pairs dominate; in practice one severity per type


def test_the_rejected_tables_agree_with_the_ingestor_schema():
    assert set(INGESTOR_REJECTED_TABLES) == pm.REJECTED_TABLES


def test_no_label_value_carries_free_text():
    cache = metrics()
    asyncio.run(cache.refresh_due(Pool()))
    for line in cache.render().splitlines():
        for value in re.findall(r'="([^"]*)"', line):
            assert re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", value), line


def test_every_statement_is_time_bounded():
    for sql in (
        pm.CONTROLLER_SQL,
        pm.STATE_SQL,
        pm.RELAYS_SQL,
        pm.HOUSE_SQL,
        pm.PROBES_SQL,
        pm.FRESHNESS_SQL,
        pm.FLOW_SQL,
        pm.GAPS_SQL,
        pm.DELIVERY_SQL,
        pm.OLDEST_UNCONFIRMED_SQL,
    ):
        tables = re.findall(r"\bFROM (\w+)", sql)
        bounds = re.findall(r"\b(?:ts|start_ts) > now\(\) - interval", sql)
        sources = [t for t in tables if t not in ("unnest", "now")]
        assert sources and len(bounds) >= len(sources), sql


def test_release_pins_come_from_the_mounted_file(tmp_path):
    overlay = (ROOT / "deploy/k8s/overlays/prod/release-pins.yaml").read_text()
    pins = tmp_path / "release-pins.yaml"
    pins.write_text(overlay)
    got = lines(pm.render(pm.read_release_pins(pins)))
    images = {re.search(r'image="([^"]+)"', name).group(1) for name in got}
    assert {"verdify-api", "verdify-mcp", "verdify-ingestor", "verdify-migrate"} <= images
    assert all(re.search(r'digest="sha256:[0-9a-f]{64}"', name) for name in got)
    assert pm.read_release_pins(tmp_path / "missing.yaml") == []
