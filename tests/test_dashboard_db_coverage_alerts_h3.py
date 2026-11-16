"""The SQL of the host release 3 coverage alerts on a private PostgreSQL (contracts/alert-coverage.md, RULINGS Q4).

The campaign step starts a fresh server for each tests/test_dashboard_db_*.py file and sets
VERDIFY_ISOLATED_TEST_DSN; without it this file skips. Tables come from db/schema.sql's DDL and daily_record from
migration 310; schema_migrations and fn_crop_band_value are minimal stand-ins. Rows sit relative to now().
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INGESTOR_PATH = str(ROOT / "ingestor")
if INGESTOR_PATH not in sys.path:
    sys.path.insert(0, INGESTOR_PATH)

from tasks import coverage_alerts as cov  # noqa: E402

asyncpg = pytest.importorskip("asyncpg")

pytestmark = pytest.mark.skipif(
    not os.environ.get("VERDIFY_ISOLATED_TEST_DSN"),
    reason="needs the campaign step's private PostgreSQL (VERDIFY_ISOLATED_TEST_DSN)",
)

SCHEMA = "coverage_alerts_h3"
TABLES = ("equipment_state", "system_state", "climate", "diagnostics", "setpoint_changes", "setpoint_snapshot")
MIN = timedelta(minutes=1)
YESTERDAY = "(now() AT TIME ZONE 'America/Denver')::date - 1"


def extract(text: str, start: str, end: str) -> str:
    assert text.count(start) == 1, start
    begin = text.index(start)
    return text[begin : text.index(end, begin) + len(end)].replace("public.", f"{SCHEMA}.")


def ddl() -> list[str]:
    schema = (ROOT / "db/schema.sql").read_text()
    out = [extract(schema, f"CREATE TABLE public.{t} (", ");\n") for t in TABLES]
    out.append(f"CREATE TABLE {SCHEMA}.greenhouses (id text PRIMARY KEY)")
    out.append(f"INSERT INTO {SCHEMA}.greenhouses VALUES ('vallery')")
    out.append(
        extract((ROOT / "db/migrations/310-daily-record.sql").read_text(), "CREATE TABLE public.daily_record (", ");")
    )
    out.append(
        f"CREATE TABLE {SCHEMA}.schema_migrations (filename text, source text, seq integer, applied_at timestamptz)"
    )
    out.append(
        f"CREATE FUNCTION {SCHEMA}.fn_crop_band_value(text, text, timestamptz) RETURNS double precision "
        "LANGUAGE sql AS $$ SELECT CASE $2 WHEN 'vpd_low' THEN 0.6 END $$"
    )
    return out


@pytest.fixture(scope="module")
def dsn():
    from conftest import isolated_mutation_test_dsn

    value = isolated_mutation_test_dsn()

    async def run(statements):
        conn = await asyncpg.connect(value)
        try:
            for s in statements:
                await conn.execute(s)
        finally:
            await conn.close()

    asyncio.run(run([f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE", f"CREATE SCHEMA {SCHEMA}", *ddl()]))
    yield value
    asyncio.run(run([f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"]))


def scenario(dsn, body):
    async def run():
        conn = await asyncpg.connect(dsn)
        try:
            await conn.execute(f"SET search_path = {SCHEMA}")
            await conn.execute(f"TRUNCATE {', '.join(TABLES)}, daily_record, schema_migrations")
            await body(conn, await conn.fetchval("SELECT now()"))
        finally:
            await conn.close()

    asyncio.run(run())


async def state(conn, ts, entity, value):
    await conn.execute("INSERT INTO system_state (ts, entity, value) VALUES ($1, $2, $3)", ts, entity, value)


async def change(conn, ts, parameter, value, source, confirmed_at=None):
    await conn.execute(
        "INSERT INTO setpoint_changes (ts, parameter, value, source, confirmed_at) VALUES ($1, $2, $3, $4, $5)",
        ts,
        parameter,
        value,
        source,
        confirmed_at,
    )


def test_reviewer_write_is_judged_only_after_312_plus_the_grace(dsn):
    async def body(conn, t0):
        await change(conn, t0 - 5 * MIN, "vpd_high", 1.2, "iris")
        row = await conn.fetchrow(cov.REVIEWER_WRITE_SQL)
        assert row["cutover"] is None and cov.reviewer_write_alert(row) is None  # before H3: nothing judged
        await conn.execute(
            "INSERT INTO schema_migrations (source, seq, applied_at) VALUES ('db/migrations', 312, $1)", t0 - 60 * MIN
        )
        await change(conn, t0 - 55 * MIN, "temp_high", 80.0, "plan")  # inside the 10 min grace: the old pods
        await change(conn, t0 - 3 * MIN, "fan_stage", 2.0, "band")
        await change(conn, t0 - 2 * MIN, "mister_min_off_s", 30.0, "manual")
        env = cov.reviewer_write_alert(await conn.fetchrow(cov.REVIEWER_WRITE_SQL))
        assert env["severity"] == "critical" and env["details"]["rows"] == 1
        assert env["details"]["sources"] == ["iris"] and env["details"]["parameters"] == ["vpd_high"]
        await conn.execute("DELETE FROM setpoint_changes WHERE source = 'iris'")
        assert cov.reviewer_write_alert(await conn.fetchrow(cov.REVIEWER_WRITE_SQL)) is None

    scenario(dsn, body)


def test_law_state_stale_needs_the_law_installed_and_the_controller_connected(dsn):
    async def body(conn, t0):
        await conn.execute("INSERT INTO diagnostics (ts, uptime_s) VALUES ($1, 3600)", t0 - MIN)
        assert cov.law_state_alert(await conn.fetchrow(cov.LAW_STATE_SQL)) is None  # law firmware never seen
        await state(conn, t0 - 5 * MIN, "climate_law_state", '{"v":1,"l":0}')
        env = cov.law_state_alert(await conn.fetchrow(cov.LAW_STATE_SQL))
        assert env is not None and 290 < env["details"]["age_s"] < 310
        await state(conn, t0 - MIN, "climate_law_state", '{"v":1,"l":0}')
        assert cov.law_state_alert(await conn.fetchrow(cov.LAW_STATE_SQL)) is None

    scenario(dsn, body)


def test_wetting_below_the_band_reads_relays_held_and_every_vpd_row(dsn):
    async def body(conn, t0):
        await conn.execute("INSERT INTO equipment_state (ts, equipment, state) VALUES ($1, 'fog', true)", t0 - 8 * MIN)
        for m in range(5):
            await conn.execute("INSERT INTO climate (ts, vpd_avg) VALUES ($1, 0.45)", t0 - m * MIN)
        row = await conn.fetchrow(cov.WETTING_SQL, cov.WETTING_RELAYS, cov.WETTING_HELD_S)
        assert cov.wetting_alert(row)["details"]["relays"] == ["fog"]
        await conn.execute("INSERT INTO climate (ts, vpd_avg) VALUES ($1, 0.7)", t0 - 30 * timedelta(seconds=1))
        assert cov.wetting_alert(await conn.fetchrow(cov.WETTING_SQL, cov.WETTING_RELAYS, cov.WETTING_HELD_S)) is None

    scenario(dsn, body)


def test_counter_reads_and_a_restart(dsn):
    async def body(conn, t0):
        for m, h1 in ((20, 10), (15, 12), (10, 3)):
            await state(conn, t0 - m * MIN, "relay_counters", json.dumps({"v": 1, "h1": h1}))
        await conn.execute("INSERT INTO diagnostics (ts, uptime_s) VALUES ($1, 5000)", t0 - 9 * MIN)
        boots = await conn.fetch(cov._BOOTS_SQL)
        rows = await conn.fetch(cov.RELAY_COUNTERS_SQL)
        assert cov.relay_counters_alert(rows, boots)["details"]["backsteps"] == {"h1": [12, 3]}
        await conn.execute("INSERT INTO diagnostics (ts, uptime_s) VALUES ($1, 200)", t0 - 8 * MIN)
        assert cov.relay_counters_alert(rows, await conn.fetch(cov._BOOTS_SQL)) is None

        await state(conn, t0 - 4 * MIN, "climate_drying_meter", json.dumps({"v": 1, "s": 50}))
        rows = await conn.fetch(cov.DRYING_SQL)
        assert {r["entity"] for r in rows} == {"climate_drying_meter"}

    scenario(dsn, body)


def test_utilities_drying_refusal_probes_and_owner_held(dsn):
    async def body(conn, t0):
        for d in range(2, 22):
            await conn.execute(
                f"INSERT INTO daily_record (date, complete, kwh_metered_24h, therms_est, water_gal, "
                f"meter_coverage_pct, drying_s, drying_runs, furnace_starts_after_drying) "
                f"VALUES ({YESTERDAY} - {d - 1}, true, 20, 2.0, 100, 99, 0, 0, 0)"
            )
        await conn.execute(
            "INSERT INTO daily_record (date, complete, kwh_metered_24h, therms_est, water_gal, meter_coverage_pct, "
            f"drying_s, drying_runs, furnace_starts_after_drying) VALUES ({YESTERDAY}, true, 21, 9.0, 90, 60, 0, 0, 0)"
        )
        rows = await conn.fetch(cov.UTILITY_SQL)
        assert len(rows) == 21 and rows[-1]["date"] == rows[-1]["yesterday"]
        if rows[-1]["after_six"]:
            env = cov.utility_alert(rows)
            assert env["details"]["over"] == {"gas_therm": [9.0, 3.0]} and env["details"]["meter_coverage_pct"] == 60

        day_start = await conn.fetchval(f"SELECT ({YESTERDAY})::timestamp AT TIME ZONE 'America/Denver'")
        for i in range(61):
            await state(conn, day_start + i * MIN, "climate_law_state", '{"v":1,"l":64,"dr":"cost"}')
        await state(conn, day_start + 70 * MIN, "climate_law_state", '{"v":1,"l":0,"dr":"none"}')
        row = await conn.fetchrow(cov.DRYING_REFUSED_SQL)
        assert (row["wanted"], row["cost"]) == (61, 61) and cov.drying_refused_alert(row) is not None

        for m in range(25):
            await conn.execute(
                "INSERT INTO climate (ts, temp_north, temp_south, temp_east, temp_west) VALUES ($1, 70, 70.5, 71, 83)",
                t0 - m * MIN,
            )
        assert cov.probes_alert(await conn.fetch(cov.PROBES_SQL))["details"]["off_median"] == ["temp_west"]

        await change(conn, t0 - 3 * 24 * 60 * MIN, "mister_min_off_s", 30.0, "manual", t0 - 3 * 24 * 60 * MIN)
        await change(conn, t0 - 60 * MIN, "mister_min_off_s", 30.0, "esp32")  # observations are not desired rows
        for m in range(10):
            await conn.execute(
                "INSERT INTO setpoint_snapshot (ts, parameter, value) VALUES ($1, 'mister_min_off_s', 45)",
                t0 - m * MIN,
            )
        rows = await conn.fetch(cov.OWNER_HELD_SQL)
        assert cov.owner_held_alert(rows)["details"]["changed"] == {"mister_min_off_s": [30.0, 45.0]}
        await change(conn, t0 - 20 * MIN, "mister_min_off_s", 45.0, "band", t0 - 19 * MIN)
        assert cov.owner_held_alert(await conn.fetch(cov.OWNER_HELD_SQL)) is None  # newest desired is not the owner's

    scenario(dsn, body)
