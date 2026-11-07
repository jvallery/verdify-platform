"""Migration 308 (#1184) on a private TimescaleDB: interior DLI from canopy PPFD.

jvallery/agents#5994's campaign step starts a fresh server for each tests/test_dashboard_db_*.py file and sets
VERDIFY_ISOLATED_TEST_DSN; without it this file skips. The chain after db/schema.sql cannot replay here, so the test
loads db/schema.sql (195's ledger and views), creates the dashboard duty and login with 282's attributes, adds 307's
climate column from that migration's own text, and runs the statements between 308's $predecessor$ and $successor$
blocks (those compare production digests; the rolled-back native qualification proves them). 308 opens
dli-validity-v2-par at its own now(), so the test moves that row's valid_from back before its fixture days. Each day
below is 60 s climate rows from local midnight; PPFD is a 12-hour half-sine peaking at 1,000 µmol/m²/s from 06:00
local (zero at night), whose integral is 1000 x (2/pi) x 43,200 s = 27.50 mol/m²/d:

  2026-11-01 (fall back, 25 h)   whole day                 -> available, 27.5
  2026-11-03                     lux and dli_today only    -> unavailable, source_reading_missing
  2026-11-04                     whole day                 -> available, 27.5
  2026-11-05                     10 minutes missing at 09:00 -> available (coverage 99.4 %)
  2026-11-06                     1 hour missing at 09:00   -> unavailable, source_coverage_low (95.8 %)
"""

import asyncio
import math
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import asyncpg
import pytest
from test_dashboard_db_band_compliance import OWNER, PRODUCTION_ROLES, as_admin, connect, private_dsn, schema_script

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "db/migrations/308-dli-canopy-ppfd.sql"
LOGIN = "verdify_dashboard_runtime_login"
DAYS = {
    date(2026, 11, 1): (datetime(2026, 11, 1, 6, tzinfo=UTC), 25),  # 00:00 MDT; the clocks fall back at 02:00
    date(2026, 11, 3): (datetime(2026, 11, 3, 7, tzinfo=UTC), 24),
    date(2026, 11, 4): (datetime(2026, 11, 4, 7, tzinfo=UTC), 24),
    date(2026, 11, 5): (datetime(2026, 11, 5, 7, tzinfo=UTC), 24),
    date(2026, 11, 6): (datetime(2026, 11, 6, 7, tzinfo=UTC), 24),
}
NO_PPFD, GAP_10_MIN, GAP_1_H = date(2026, 11, 3), date(2026, 11, 5), date(2026, 11, 6)
HALF_SINE = 1000 * (2 / math.pi) * 43200 / 1e6  # 27.502 mol/m²/d

# Migration 282's dashboard duty and login.
DASHBOARD = """
DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verdify_dashboard_runtime') THEN
        CREATE ROLE verdify_dashboard_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
            NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verdify_dashboard_runtime_login') THEN
        CREATE ROLE verdify_dashboard_runtime_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
            NOBYPASSRLS CONNECTION LIMIT 8;
    END IF;
END $roles$;
GRANT verdify_dashboard_runtime TO verdify_dashboard_runtime_login;
GRANT USAGE ON SCHEMA public TO verdify_dashboard_runtime;
"""


def run(coroutine):
    return asyncio.run(coroutine)


def migration_body() -> str:
    sql = MIGRATION.read_text()
    assert sql.count("END $predecessor$;") == 1 and sql.count("DO $successor$") == 1
    return sql.split("END $predecessor$;", 1)[1].split("DO $successor$", 1)[0]


def climate_column_307() -> str:
    text = (ROOT / "db/migrations/307-climate-ppfd-column.sql").read_text()
    statement = "ALTER TABLE public.climate ADD COLUMN ppfd_umol_m2_s double precision;"
    assert statement in text
    return statement


def ppfd(start: datetime, ts: datetime) -> float:
    x = (ts - start - timedelta(hours=6)).total_seconds() / 43200
    return 1000 * math.sin(math.pi * x) if 0 <= x <= 1 else 0.0


def readings() -> list[tuple[datetime, float | None]]:
    rows = []
    for day, (start, hours) in DAYS.items():
        for minute in range(hours * 60):
            ts = start + timedelta(minutes=minute)
            if day == GAP_10_MIN and timedelta(hours=9) <= ts - start < timedelta(hours=9, minutes=10):
                continue
            if day == GAP_1_H and timedelta(hours=9) <= ts - start < timedelta(hours=10):
                continue
            rows.append((ts, None if day == NO_PPFD else ppfd(start, ts)))
    return rows


async def install(dsn: str) -> None:
    admin = await connect(dsn)
    try:
        if await admin.fetchval(
            "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.climate') "
            "AND attname = 'ppfd_umol_m2_s')"
        ):
            pytest.fail("test_dashboard_db_dli_par_308 needs a fresh database")
    finally:
        await admin.close()
    await as_admin(dsn, PRODUCTION_ROLES)
    await as_admin(dsn, schema_script())
    await as_admin(dsn, DASHBOARD)
    owner = await connect(dsn, OWNER)
    try:
        await owner.execute(climate_column_307())
        async with owner.transaction():
            await owner.execute("SET LOCAL search_path = pg_catalog, public, pg_temp;\n" + migration_body())
        # db/schema.sql carries no ledger rows; a v1 row, if one were there, ends where v2 now starts.
        await owner.execute(
            "UPDATE public.dli_validity_intervals SET valid_to = '2026-10-01 00:00:00+00' "
            "WHERE validity_revision = 'dli-validity-v1'"
        )
        await owner.execute(
            "UPDATE public.dli_validity_intervals SET valid_from = '2026-10-01 00:00:00+00' "
            "WHERE validity_revision = 'dli-validity-v2-par'"
        )
        await owner.execute(
            "INSERT INTO public.greenhouses (id, name) VALUES ('vallery', 'Vallery') ON CONFLICT (id) DO NOTHING"
        )
        await owner.executemany(
            "INSERT INTO public.climate (ts, greenhouse_id, ppfd_umol_m2_s, lux, dli_today) "
            "VALUES ($1, 'vallery', $2, 500.0, 12.0)",
            readings(),
        )
        await owner.executemany(
            "INSERT INTO public.daily_summary (date, greenhouse_id, dli_final) VALUES ($1, 'vallery', 12.0)",
            [(day,) for day in DAYS],
        )
    finally:
        await owner.close()


@pytest.fixture(scope="module")
def dsn() -> str:
    dsn = private_dsn()
    run(install(dsn))
    return dsn


async def _fetch(dsn: str, sql: str, user: str = LOGIN):
    conn = await connect(dsn, user)
    try:
        return await conn.fetch(sql)
    finally:
        await conn.close()


def fetch(dsn: str, sql: str, user: str = LOGIN):
    return run(_fetch(dsn, sql, user))


def daily(dsn: str) -> dict[date, asyncpg.Record]:
    rows = fetch(
        dsn,
        "SELECT date, crop_dli_mol_m2_day, availability, unavailable_reason, provenance, validity_revision "
        "FROM public.v_dli_daily WHERE greenhouse_id = 'vallery'",
    )
    return {row["date"]: row for row in rows}


def test_a_whole_half_sine_day_reads_27_5_mol_with_par_provenance(dsn):
    days = daily(dsn)
    for day in (date(2026, 11, 4), date(2026, 11, 1)):  # an ordinary day and the 25-hour fall-back day
        row = days[day]
        assert (row["availability"], row["unavailable_reason"]) == ("available", None), day
        assert row["crop_dli_mol_m2_day"] == pytest.approx(HALF_SINE, abs=0.1), day
        assert (row["provenance"], row["validity_revision"]) == ("par_quantum_sensor_canopy", "dli-validity-v2-par")


def test_a_10_minute_gap_stays_available_and_an_hour_reads_coverage_low(dsn):
    days = daily(dsn)
    gap = days[GAP_10_MIN]
    assert gap["availability"] == "available" and gap["unavailable_reason"] is None
    # Each sample holds at most 120 s, so the gap loses 8 minutes of mid-morning light and is never filled.
    assert 26.5 < gap["crop_dli_mol_m2_day"] < HALF_SINE
    hour = days[GAP_1_H]
    assert (hour["crop_dli_mol_m2_day"], hour["availability"], hour["unavailable_reason"]) == (
        None,
        "unavailable",
        "source_coverage_low",
    )


def test_lux_and_dli_today_without_ppfd_stay_unavailable(dsn):
    row = daily(dsn)[NO_PPFD]
    assert (row["crop_dli_mol_m2_day"], row["availability"], row["unavailable_reason"]) == (
        None,
        "unavailable",
        "source_reading_missing",
    )
    # Today has no PPFD sample: the current view fails closed too, with the PAR provenance.
    (current,) = fetch(
        dsn,
        "SELECT crop_dli_mol_m2_day, availability, unavailable_reason, provenance FROM public.v_dli_current "
        "WHERE greenhouse_id = 'vallery'",
    )
    assert tuple(current) == (None, "unavailable", "source_reading_missing", "par_quantum_sensor_canopy")


def test_the_ledger_keeps_only_the_par_source_available(dsn):
    rows = fetch(
        dsn,
        "SELECT validity_revision, availability, operator_validated, created_by FROM public.dli_validity_intervals "
        "WHERE availability = 'available'",
        OWNER,
    )
    assert [tuple(row) for row in rows] == [("dli-validity-v2-par", "available", True, "migration_308")]

    async def refused():
        conn = await connect(dsn, OWNER)
        try:
            with pytest.raises(asyncpg.CheckViolationError, match="dli_validity_release_par_only"):
                await conn.execute(
                    "INSERT INTO public.dli_validity_intervals (valid_from, valid_to, availability, provenance, "
                    "validity_revision, operator_validated) VALUES ('2020-01-01', '2020-02-01', 'available', "
                    "'lux_proxy', 'dli-validity-x', true)"
                )
        finally:
            await conn.close()

    run(refused())


def test_the_dashboard_login_reads_both_views_and_their_dependents_still_resolve(dsn):
    assert len(daily(dsn)) == len(DAYS)
    (privileges,) = fetch(
        dsn,
        "SELECT has_table_privilege('verdify_dashboard_runtime', 'public.v_dli_current', 'SELECT') AS current_view, "
        "has_table_privilege('verdify_dashboard_runtime', 'public.v_dli_daily', 'SELECT') AS daily_view, "
        "has_function_privilege('verdify_dashboard_runtime', 'public.fn_dli_validity(timestamptz,text)', "
        "'EXECUTE') AS validity, "
        "has_column_privilege('verdify_dashboard_runtime', 'public.dli_validity_intervals', 'created_by', "
        "'SELECT') AS audit_column",
        OWNER,
    )
    assert tuple(privileges) == (True, True, True, False)
    # v_daily_kpi joins v_dli_daily: CREATE OR REPLACE kept its ten columns.
    (kpi,) = fetch(dsn, "SELECT count(*) FROM public.v_daily_kpi", OWNER)
    assert kpi[0] >= 0
