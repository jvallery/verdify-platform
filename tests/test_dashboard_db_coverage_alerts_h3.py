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
        "LANGUAGE sql AS $$ SELECT CASE $2 WHEN 'vpd_low' THEN 0.6 WHEN 'temp_low' THEN 58.0 END $$"
    )
    out.append(
        f"CREATE FUNCTION {SCHEMA}.fn_band_setpoints(ts timestamptz, OUT temp_low double precision, "
        "OUT temp_high double precision, OUT vpd_low double precision, OUT vpd_high double precision, "
        "OUT temp_target double precision, OUT vpd_target double precision) LANGUAGE sql AS "
        "$$ SELECT 62.0::float8, CASE WHEN ts < now() - interval '30 seconds' THEN 80.0 ELSE 81.5 END, "
        "0.6::float8, 1.2::float8, 71.0::float8, 0.9::float8 $$"
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


def test_reviewer_write_is_judged_after_the_first_counters_row_plus_the_grace_as_the_ingestor_role(dsn):
    """ALERTS-1: the cutover is release 3's first ingestor_counters row plus 10 min, read with only what the
    ingestor runtime role holds in production (system_state and setpoint_changes, not schema_migrations)."""
    role = "coverage_h3_ingestor"

    async def read(conn):
        await conn.execute(f"SET ROLE {role}")
        try:
            return await conn.fetchrow(cov.REVIEWER_WRITE_SQL)
        finally:
            await conn.execute("RESET ROLE")

    async def body(conn, t0):
        if not await conn.fetchval("SELECT 1 FROM pg_roles WHERE rolname = $1", role):
            await conn.execute(f"CREATE ROLE {role} NOLOGIN")
        await conn.execute(f"GRANT USAGE ON SCHEMA {SCHEMA} TO {role}")
        await conn.execute(f"GRANT SELECT ON {SCHEMA}.system_state, {SCHEMA}.setpoint_changes TO {role}")
        try:
            await change(conn, t0 - 70 * MIN, "vpd_high", 1.1, "plan")  # the release 2 dispatcher
            row = await read(conn)
            assert row["cutover"] is None and cov.reviewer_write_alert(row) is None  # before release 3: nothing
            await state(conn, t0 - 60 * MIN, "ingestor_counters", '{"v":1,"rc":0,"pr":0}')
            await state(conn, t0 - 59 * MIN, "ingestor_counters", '{"v":1,"rc":1,"pr":0}')
            await change(conn, t0 - 55 * MIN, "temp_high", 80.0, "plan")  # inside the 10 min grace
            await change(conn, t0 - 5 * MIN, "vpd_high", 1.2, "iris")
            await change(conn, t0 - 3 * MIN, "fan_stage", 2.0, "band")
            await change(conn, t0 - 2 * MIN, "mister_min_off_s", 30.0, "manual")
            row = await read(conn)
            assert row["cutover"] == t0 - 50 * MIN
            env = cov.reviewer_write_alert(row)
            assert env["severity"] == "critical" and env["details"]["rows"] == 1
            assert env["details"]["sources"] == ["iris"] and env["details"]["parameters"] == ["vpd_high"]
            await conn.execute("DELETE FROM setpoint_changes WHERE source = 'iris'")
            assert cov.reviewer_write_alert(await read(conn)) is None
        finally:
            await conn.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA {SCHEMA} FROM {role}")
            await conn.execute(f"REVOKE USAGE ON SCHEMA {SCHEMA} FROM {role}")
            await conn.execute(f"DROP ROLE {role}")

    scenario(dsn, body)


def test_law_state_stale_needs_the_law_installed_and_the_controller_connected(dsn):
    async def body(conn, t0):
        diag = "INSERT INTO diagnostics (ts, uptime_s, firmware_version) VALUES ($1, $2, $3)"
        await conn.execute(diag, t0 - 30 * MIN, 1800.0, "law-1")
        await conn.execute("INSERT INTO diagnostics (ts, uptime_s) VALUES ($1, 3600)", t0 - MIN)
        assert cov.law_state_alert(await conn.fetchrow(cov.LAW_STATE_SQL)) is None  # law firmware never seen
        await state(conn, t0 - 5 * MIN, "climate_law_state", '{"v":1,"l":0}')
        env = cov.law_state_alert(await conn.fetchrow(cov.LAW_STATE_SQL))
        assert env is not None and 290 < env["details"]["age_s"] < 310
        await conn.execute(diag, t0 - 40 * MIN, 9000.0, "pre-law")  # ran before the law build
        await conn.execute(diag, t0 - 2 * MIN, 400.0, "pre-law")  # rolled back to a build without the law
        assert cov.law_state_alert(await conn.fetchrow(cov.LAW_STATE_SQL)) is None
        await conn.execute(diag, t0 - 90 * timedelta(seconds=1), 500.0, "law-1")
        assert cov.law_state_alert(await conn.fetchrow(cov.LAW_STATE_SQL)) is not None  # the law build is back
        await state(conn, t0 - MIN, "climate_law_state", '{"v":1,"l":0}')
        assert cov.law_state_alert(await conn.fetchrow(cov.LAW_STATE_SQL)) is None

    scenario(dsn, body)


def test_law_state_stale_raises_for_a_new_build_that_publishes_no_law_record(dsn):
    # #1734 C-2: a build first reported after the newest law record is judged once its uptime grace is over.
    async def body(conn, t0):
        diag = "INSERT INTO diagnostics (ts, uptime_s, firmware_version) VALUES ($1, $2, $3)"
        await conn.execute(diag, t0 - 30 * MIN, 1800.0, "law-1")
        await state(conn, t0 - 20 * MIN, "climate_law_state", '{"v":1,"l":0}')
        await conn.execute(diag, t0 - 10 * MIN, 30.0, "law-2")  # flashed; it never publishes a law record
        await conn.execute(diag, t0 - MIN, 200.0, "law-2")
        assert cov.law_state_alert(await conn.fetchrow(cov.LAW_STATE_SQL)) is None  # inside the 240 s uptime grace
        await conn.execute(diag, t0 - 30 * timedelta(seconds=1), 600.0, "law-2")
        env = cov.law_state_alert(await conn.fetchrow(cov.LAW_STATE_SQL))
        assert env is not None and env["alert_type"] == "law_state_stale" and env["details"]["uptime_s"] == 600.0

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
        snap = "INSERT INTO setpoint_snapshot (ts, parameter, value) VALUES ($1, 'mister_min_off_s', $2)"
        # readbacks stored on change (ALERTS-3): the held value, then one differing readback 40 minutes ago
        await conn.execute(snap, t0 - 2 * 24 * 60 * MIN, 30.0)
        await conn.execute(snap, t0 - 10 * MIN, 30.0)
        await conn.execute(snap, t0 - 5 * MIN, 45.0)
        assert cov.owner_held_alert(await conn.fetch(cov.OWNER_HELD_SQL)) is None  # differing for 5 minutes only
        await conn.execute("DELETE FROM setpoint_snapshot WHERE ts > $1", t0 - 60 * MIN)
        await conn.execute(snap, t0 - 40 * MIN, 45.0)
        rows = await conn.fetch(cov.OWNER_HELD_SQL)
        assert cov.owner_held_alert(rows)["details"]["changed"] == {"mister_min_off_s": [30.0, 45.0]}
        await change(conn, t0 - 20 * MIN, "mister_min_off_s", 45.0, "band", t0 - 19 * MIN)
        assert cov.owner_held_alert(await conn.fetch(cov.OWNER_HELD_SQL)) is None  # newest desired is not the owner's

    scenario(dsn, body)


def test_safeguard_two_reads_outdoor_source_probe_count_and_wall_columns(dsn):
    async def body(conn, t0):
        # Before the phase 2 flash: no outdoor_source row, so nothing opens.
        assert cov.outdoor_blind_alert(await conn.fetchrow(cov.OUTDOOR_BLIND_SQL)) is None
        for m in (25, 20, 15, 10, 5, 1):
            await state(conn, t0 - m * MIN, "outdoor_source", "intake" if m >= 20 else "none")
        for m in range(1, 10):
            await conn.execute("INSERT INTO diagnostics (ts, active_probe_count) VALUES ($1, 3)", t0 - m * MIN)
            await conn.execute("INSERT INTO climate (ts, temp_north, temp_case) VALUES ($1, 70, 71)", t0 - m * MIN)
        env = cov.outdoor_blind_alert(await conn.fetchrow(cov.OUTDOOR_BLIND_SQL))
        assert env["severity"] == "critical" and env["details"]["fewest_wall_probes"] == 3
        assert 890 < env["details"]["none_s"] < 960
        # One diagnostics row in the window with all four walls valid: not held, no page.
        await conn.execute(
            "INSERT INTO diagnostics (ts, active_probe_count) VALUES ($1, 4)", t0 - 30 * timedelta(seconds=1)
        )
        assert cov.outdoor_blind_alert(await conn.fetchrow(cov.OUTDOOR_BLIND_SQL)) is None
        # The intake leg: intake 25 and 20 minutes ago, then none, so no intake warning.
        assert cov.intake_only_alert(await conn.fetchrow(cov.INTAKE_ONLY_SQL)) is None

    scenario(dsn, body)


def test_intake_only_after_half_an_hour_and_not_on_a_stale_row(dsn):
    async def body(conn, t0):
        for m in (40, 35, 30, 25, 20, 15, 10, 5):
            await state(conn, t0 - m * MIN, "outdoor_source", "intake")
        await state(conn, t0 - 45 * MIN, "outdoor_source", "station")
        env = cov.intake_only_alert(await conn.fetchrow(cov.INTAKE_ONLY_SQL))
        assert env["severity"] == "warning" and 2390 < env["details"]["intake_s"] < 2460
        await conn.execute("DELETE FROM system_state WHERE ts > $1", t0 - 12 * MIN)  # receipts stopped: a reconnect
        assert cov.intake_only_alert(await conn.fetchrow(cov.INTAKE_ONLY_SQL)) is None

    scenario(dsn, body)


def test_furnace_saturation_integrates_heat2_from_the_row_before_the_hour(dsn):
    async def body(conn, t0):
        heat = "INSERT INTO equipment_state (ts, equipment, state) VALUES ($1, 'heat2', $2)"
        for m in range(1, 10):
            await conn.execute("INSERT INTO climate (ts, temp_avg) VALUES ($1, 56.0)", t0 - m * MIN)
        await conn.execute(heat, t0 - 30 * MIN, True)  # no row before the hour: state unknown
        assert cov.furnace_alert(await conn.fetchrow(cov.FURNACE_SQL)) is None
        await conn.execute(heat, t0 - 90 * MIN, True)
        await conn.execute(heat, t0 - 40 * MIN, False)
        await conn.execute(heat, t0 - 37 * MIN, True)  # off 3 of 60 minutes
        row = await conn.fetchrow(cov.FURNACE_SQL)
        env = cov.furnace_alert(row)
        assert env["severity"] == "warning" and 0.94 < env["details"]["on_fraction"] < 0.96
        assert env["details"]["band_low_f"] == 58.0
        await conn.execute(heat, t0 - 20 * MIN, False)
        await conn.execute(heat, t0 - 10 * MIN, True)  # off 13 of 60 minutes
        assert cov.furnace_alert(await conn.fetchrow(cov.FURNACE_SQL)) is None

    scenario(dsn, body)


def test_reboot_sql_finds_restarts_and_the_versions_around_them(dsn):
    async def body(conn, t0):
        diag = "INSERT INTO diagnostics (ts, uptime_s, firmware_version, reset_reason) VALUES ($1, $2, $3, $4)"
        # running on v1 for hours, a flash to v2 70 minutes ago (outside the window)
        await conn.execute(diag, t0 - 100 * MIN, 50000.0, "v1", "Power-on")
        await conn.execute(diag, t0 - 69 * MIN, 30.0, "v2", "Software reset")
        await conn.execute(diag, t0 - 41 * MIN, 1700.0, "v2", None)
        # a same-version restart 40 minutes ago (uptime 20 s), reported with its reason
        await conn.execute(diag, t0 - 40 * MIN, 20.0, None, None)
        await conn.execute(diag, t0 - 39 * MIN, 80.0, "v2", "Task WDT")
        await conn.execute(diag, t0 - 2 * MIN, 2300.0, None, None)
        rows = await conn.fetch(cov.REBOOT_SQL, cov.REBOOT_WINDOW_MIN)
        assert len(rows) == 1 and rows[0]["fw_before"] == "v2" and rows[0]["fw_after"] == "v2"
        env = cov.reboot_alert(rows)
        assert env["severity"] == "warning" and env["details"]["reset_reason"] == "Task WDT"
        # a long silence without a restart is not a restart: uptime grew with the gap
        await conn.execute(diag, t0 - 1 * MIN, 2360.0, None, None)
        assert len(await conn.fetch(cov.REBOOT_SQL, cov.REBOOT_WINDOW_MIN)) == 1

    scenario(dsn, body)


def test_law_band_sql_reads_the_newest_three_records_against_the_band_at_their_time(dsn):
    async def body(conn, t0):
        assert cov.law_band_alert(await conn.fetch(cov.LAW_BAND_SQL)) == (None, False)
        b = json.dumps({"v": 1, "l": 0, "b": [62.0, 80.0, 0.6, 1.2]})
        for minutes in (1, 2, 3, 20):  # the 20-minute record is outside the window
            await state(conn, t0 - minutes * MIN, "climate_law_state", b)
        rows = await conn.fetch(cov.LAW_BAND_SQL)
        assert [r["temp_high"] for r in rows] == [80.0, 80.0, 80.0]
        assert cov.law_band_alert(rows) == (None, True)
        # the band moved under the newest record only: one record off is not an alert
        await state(conn, t0 - 10 * timedelta(seconds=1), "climate_law_state", b)
        rows = await conn.fetch(cov.LAW_BAND_SQL)
        assert len(rows) == 3 and rows[0]["temp_high"] == 81.5
        assert cov.law_band_alert(rows) == (None, True)

    scenario(dsn, body)


def test_counter_reconcile_sql_reads_yesterdays_complete_rows(dsn):
    # A stand-in with the columns of migration 315's v_relay_counter_reconciliation_daily.
    async def body(conn, t0):
        await conn.execute("DROP VIEW IF EXISTS v_relay_counter_reconciliation_daily")
        await conn.execute(
            f"""CREATE VIEW v_relay_counter_reconciliation_daily AS
            SELECT d AS date, 'vallery'::text AS greenhouse_id, e AS equipment, 9::bigint AS counter_starts,
                   3::bigint AS record_starts, 6::bigint AS starts_difference, NULL::bigint AS counter_run_s,
                   NULL::double precision AS record_run_s, NULL::double precision AS run_s_difference,
                   60 AS counter_rows, c AS comparison
              FROM (VALUES ({YESTERDAY}, 'heat1', 'complete'), ({YESTERDAY}, 'heat2', 'no_record'),
                           ({YESTERDAY} - 1, 'fog', 'complete'), ({YESTERDAY} + 1, 'vent', 'partial')) v(d, e, c)"""
        )
        rows = await conn.fetch(cov.COUNTER_RECONCILE_SQL)
        assert [r["equipment"] for r in rows] == ["heat1"]
        assert [a["sensor_id"].split(".")[1] for a in cov.counter_mismatch_alerts(rows)] == ["heat1"]
        await conn.execute("DROP VIEW v_relay_counter_reconciliation_daily")

    scenario(dsn, body)
