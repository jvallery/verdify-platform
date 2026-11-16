"""The SQL of the host release 2 coverage alerts on a private PostgreSQL (contracts/alert-coverage.md).

The campaign step starts a fresh server for each tests/test_dashboard_db_*.py file and sets
VERDIFY_ISOLATED_TEST_DSN; without it this file skips. Tables come from db/schema.sql's DDL (energy with migration
248's channel columns); daily_record, daily_band_compliance and fn_crop_band_value are minimal stand-ins. Rows sit relative to now().
"""

from __future__ import annotations

import asyncio
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

SCHEMA = "coverage_alerts_h2"
TABLES = ("equipment_state", "system_state", "climate", "diagnostics", "energy", "alert_log")
MIN = timedelta(minutes=1)


def extract(text: str, start: str, end: str) -> str:
    assert text.count(start) == 1, start
    begin = text.index(start)
    return text[begin : text.index(end, begin) + len(end)].replace("public.", f"{SCHEMA}.")


def ddl() -> list[str]:
    schema = (ROOT / "db/schema.sql").read_text()
    out = [extract(schema, f"CREATE TABLE public.{t} (", ");\n") for t in TABLES]
    out.append(
        extract(
            (ROOT / "db/migrations/248-shelly-source-interval-accounting.sql").read_text(),
            "ALTER TABLE public.energy\n",
            ";\n",
        )
    )
    out.append(f"CREATE TABLE {SCHEMA}.daily_band_compliance (date date NOT NULL)")
    out.append(f"CREATE TABLE {SCHEMA}.daily_record (date date NOT NULL)")  # migration 310's key column
    out.append(
        f"CREATE FUNCTION {SCHEMA}.fn_crop_band_value(text, text, timestamptz) RETURNS double precision "
        "LANGUAGE sql AS $$ SELECT CASE $2 WHEN 'temp_low' THEN 70.0 WHEN 'temp_high' THEN 83.0 END $$"
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
            await conn.execute(f"TRUNCATE {', '.join(TABLES)}, daily_band_compliance, daily_record")
            await body(conn, await conn.fetchval("SELECT now()"))
        finally:
            await conn.close()

    asyncio.run(run())


async def edge(conn, ts, equipment, state):
    await conn.execute("INSERT INTO equipment_state (ts, equipment, state) VALUES ($1, $2, $3)", ts, equipment, state)


async def state(conn, ts, entity, value):
    await conn.execute("INSERT INTO system_state (ts, entity, value) VALUES ($1, $2, $3)", ts, entity, value)


def test_forbidden_pair_reads_the_newest_edge_per_relay(dsn):
    async def body(conn, t0):
        await edge(conn, t0 - 60 * MIN, "vent", False)
        await edge(conn, t0 - 30 * MIN, "vent", True)
        await edge(conn, t0 - 20 * MIN, "heat2", True)
        await edge(conn, t0 - 40 * MIN, "fan1", True)
        await edge(conn, t0 - 35 * MIN, "fan1", False)
        env = cov.forbidden_pair_alert(await conn.fetch(cov.FORBIDDEN_PAIR_SQL, cov._PAIR_RELAYS))
        assert env["details"]["pairs"] == ["heat2+vent_open"] and 19 * 60 < env["details"]["held_s"] < 21 * 60
        await edge(conn, t0 - 3 * MIN, "heat2", False)
        assert cov.forbidden_pair_alert(await conn.fetch(cov.FORBIDDEN_PAIR_SQL, cov._PAIR_RELAYS)) is None

    scenario(dsn, body)


def test_outdoor_source_none_since_the_last_valid_source(dsn):
    async def body(conn, t0):
        await state(conn, t0 - 40 * MIN, "outdoor_source", "station")
        for m in (20, 15, 10, 5, 0):
            await state(conn, t0 - m * MIN, "outdoor_source", "none")
        row = await conn.fetchrow(cov.OUTDOOR_SOURCE_SQL)
        assert cov.outdoor_source_alert(row) is not None and 19 * 60 < row["none_age_s"] < 21 * 60
        await state(conn, t0 - 12 * MIN, "outdoor_source", "intake")
        assert cov.outdoor_source_alert(await conn.fetchrow(cov.OUTDOOR_SOURCE_SQL)) is None

    scenario(dsn, body)


def test_case_only_and_boot_stuck_read_climate_diagnostics_and_mode_reason(dsn):
    async def body(conn, t0):
        for m in range(10):
            await conn.execute("INSERT INTO climate (ts, temp_case) VALUES ($1, 71.0)", t0 - m * MIN)
        assert cov.case_only_alert(await conn.fetchrow(cov.CASE_ONLY_SQL)) is not None
        await conn.execute("INSERT INTO climate (ts, temp_north, temp_case) VALUES ($1, 70.0, 71.0)", t0 - 2 * MIN)
        assert cov.case_only_alert(await conn.fetchrow(cov.CASE_ONLY_SQL)) is None

        await state(conn, t0 - 8 * MIN, "mode_reason", "init")
        await conn.execute("INSERT INTO diagnostics (ts, uptime_s) VALUES ($1, 480)", t0 - MIN)
        assert cov.boot_stuck_alert(await conn.fetchrow(cov.BOOT_STUCK_SQL)) is not None
        await state(conn, t0 - 2 * MIN, "mode_reason", "law")
        assert cov.boot_stuck_alert(await conn.fetchrow(cov.BOOT_STUCK_SQL)) is None

    scenario(dsn, body)


def test_power_meter_liveness_counts_any_quality_but_unavailable(dsn):
    async def body(conn, t0):
        await conn.execute(
            "INSERT INTO energy (ts, ch0_source_ts, ch0_quality, ch1_source_ts, ch1_quality) VALUES "
            "($1, $1, 'future', $2, 'unavailable')",
            t0 - 2 * MIN,
            t0 - 2 * MIN,
        )
        await conn.execute("INSERT INTO energy (ts, ch1_source_ts, ch1_quality) VALUES ($1, $1, 'ok')", t0 - 50 * MIN)
        env = cov.power_meter_alert(await conn.fetchrow(cov.POWER_METER_SQL))
        assert env["details"]["channels"] == ["ch1"]

    scenario(dsn, body)


def test_daily_record_and_compliance_for_yesterday(dsn):
    async def body(conn, t0):
        row = await conn.fetchrow(cov.DAILY_RECORD_SQL)
        assert row["record"] is False and row["compliance"] is False
        await conn.execute(
            "INSERT INTO daily_band_compliance (date) VALUES ((now() AT TIME ZONE 'America/Denver')::date - 1)"
        )
        row = await conn.fetchrow(cov.DAILY_RECORD_SQL)
        assert row["compliance"] is True and row["record"] is False

    scenario(dsn, body)


def test_temp_band_and_relay_starts(dsn):
    async def body(conn, t0):
        for m in range(60):
            await conn.execute("INSERT INTO climate (ts, temp_avg) VALUES ($1, 64.0)", t0 - m * MIN)
        row = await conn.fetchrow(cov.TEMP_BAND_SQL, cov.TEMP_BAND_MARGIN_F)
        assert row["total"] == 60 and cov.temp_band_alert(row)["details"]["side"] == "cold"

        await edge(conn, t0 - 69 * MIN, "heat1", False)
        for i in range(13):
            await edge(conn, t0 - (58 - 4 * i) * MIN, "heat1", True)
            await edge(conn, t0 - (56 - 4 * i) * MIN, "heat1", False)
        rows = await conn.fetch(cov.RELAY_STARTS_SQL, sorted(cov.RELAY_START_LIMITS))
        assert {r["equipment"]: r["starts"] for r in rows} == {"heat1": 13}
        assert cov.relay_starts_alert(rows)["details"]["starts"] == {"heat1": 13}

    scenario(dsn, body)
