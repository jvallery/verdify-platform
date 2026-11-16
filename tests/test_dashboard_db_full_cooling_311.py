"""Migration 311 (#1667) on a private TimescaleDB: capacity-limited heat beside the grade, and the scorecard.

jvallery/agents#5994's campaign step starts a fresh server for each tests/test_dashboard_db_*.py file and sets
VERDIFY_ISOLATED_TEST_DSN; without it this file skips. The test builds 290 and 305 as
test_dashboard_db_band_dryout_305 does, writes one day (2026-11-04, 07:00Z to 07:00Z) at 80 F against a 60-70 F
band, so every 5-minute bucket is above the band, stores it with 305's store, then runs the statements between
311's $predecessor$ and $successor$ blocks. The relays, from the day's local midnight:

  vent  on from the day before, all day
  fan1  on from the day before, all day
  fan2  on from the day before; off at 06:02 local; on again at 12:00; off at 15:00
        -> full cooling 00:00-06:00 (06:00-06:05 is not whole) and 12:00-15:00: 360 + 180 = 540 minutes.

With one fan off nothing counts (#1667 acceptance), and a day at the band counts nothing.
"""

import asyncio
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import asyncpg
import pytest
from test_dashboard_db_band_compliance import (
    LOGIN,
    OWNER,
    PRODUCTION_ROLES,
    REFRESH_DUTY,
    as_admin,
    connect,
    fetch,
    private_dsn,
    schema_script,
)
from test_dashboard_db_band_compliance import migration_body as body_290

ROOT = Path(__file__).resolve().parents[1]
ROLES = ("temp_low", "temp_high", "vpd_low", "vpd_high")
BAND = {"temp_low": 60.0, "temp_high": 70.0, "vpd_low": 0.5, "vpd_high": 1.5}
DAY = date(2026, 11, 4)
OPENS = datetime(2026, 11, 4, 7, tzinfo=UTC)  # 00:00 MST
CLOSES = OPENS + timedelta(days=1)
COOL_DAY = date(2026, 11, 5)  # same relays, the house at 65 F: nothing above the band


def body(name: str) -> str:
    sql = (ROOT / "db/migrations" / name).read_text()
    assert sql.count("END $predecessor$;") == 1 and sql.count("DO $successor$") == 1
    return sql.split("END $predecessor$;", 1)[1].split("DO $successor$", 1)[0]


def readings() -> list[tuple[datetime, float, float]]:
    rows, ts = [], OPENS - timedelta(hours=1)
    while ts < CLOSES + timedelta(days=1):
        rows.append((ts, 80.0 if ts < CLOSES else 65.0, 1.0))
        ts += timedelta(seconds=20)
    return rows


def band_rows() -> list[tuple[datetime, str, float]]:
    rows, ts = [], OPENS - timedelta(minutes=10)
    while ts <= CLOSES + timedelta(days=1):
        rows.extend((ts + timedelta(seconds=17), role, BAND[role]) for role in ROLES)
        ts += timedelta(minutes=5)
    return rows


def relay_rows() -> list[tuple[datetime, str, bool]]:
    before = OPENS - timedelta(hours=3)
    return [
        (before, "vent", True),
        (before, "fan1", True),
        (before, "fan2", True),
        (OPENS + timedelta(hours=6, minutes=2), "fan2", False),
        (OPENS + timedelta(hours=12), "fan2", True),
        (OPENS + timedelta(hours=15), "fan2", False),
        # The next day fan1 is off: with one fan off nothing counts, whatever the temperature.
        (CLOSES, "fan1", False),
    ]


async def install(dsn: str) -> None:
    admin = await connect(dsn)
    try:
        if await admin.fetchval("SELECT to_regclass('public.daily_band_compliance') IS NOT NULL"):
            pytest.fail("test_dashboard_db_full_cooling_311 needs a fresh database")
    finally:
        await admin.close()
    await as_admin(dsn, PRODUCTION_ROLES)
    await as_admin(dsn, schema_script())
    await as_admin(dsn, REFRESH_DUTY)
    owner = await connect(dsn, OWNER)
    try:
        await owner.execute("SET search_path = pg_catalog, public, pg_temp;\n" + body_290())
        await owner.execute("SET search_path = pg_catalog, public, pg_temp;\n" + body("305-band-nightly-dryout.sql"))
        await owner.execute(
            "INSERT INTO public.greenhouses (id, name) VALUES ('vallery', 'Vallery') ON CONFLICT (id) DO NOTHING"
        )
        await owner.executemany(
            "INSERT INTO public.climate (ts, greenhouse_id, temp_avg, vpd_avg) VALUES ($1, 'vallery', $2, $3)",
            readings(),
        )
        await owner.executemany(
            "INSERT INTO public.setpoint_snapshot (ts, parameter, value, greenhouse_id, zone, band_role) "
            "VALUES ($1, 'band_house_' || $2, $3, 'vallery', 'house', $2)",
            band_rows(),
        )
        await owner.executemany(
            "INSERT INTO public.equipment_state (ts, equipment, state, greenhouse_id) VALUES ($1, $2, $3, 'vallery')",
            relay_rows(),
        )
        await owner.executemany(
            "INSERT INTO public.daily_summary (date, greenhouse_id) VALUES ($1, 'vallery')", [(DAY,), (COOL_DAY,)]
        )
        # The day is stored before 311, as production's are; 311 must fill it.
        await owner.execute("SELECT public.fn_band_compliance_store($1)", DAY)
        await owner.execute(
            "SET search_path = pg_catalog, public, pg_temp;\n" + body("311-one-compliance-definition.sql")
        )
    finally:
        await owner.close()


@pytest.fixture(scope="module")
def dsn():
    value = private_dsn()
    asyncio.run(install(value))
    return value


def run(coroutine):
    return asyncio.run(coroutine)


def stored(dsn: str, day: date) -> asyncpg.Record:
    [row] = run(fetch(dsn, "SELECT * FROM public.daily_band_compliance WHERE date = $1", day))
    return row


def test_the_migration_fills_the_day_already_stored(dsn):
    row = stored(dsn, DAY)
    assert row["temp_above_min"] == 1440
    assert row["temp_above_full_cooling_min"] == 540


def test_only_whole_buckets_with_vent_and_both_fans_count(dsn):
    [row] = run(fetch(dsn, "SELECT public.fn_band_full_cooling_min($1) AS m", DAY))
    assert row["m"] == 540
    # With fan1 off all the next day nothing counts, and the house is inside the band anyway.
    [cool] = run(fetch(dsn, "SELECT public.fn_band_full_cooling_min($1) AS m", COOL_DAY))
    assert cool["m"] == 0


def test_with_one_fan_off_none_count(dsn):
    # The same hot day with fan1 off from its midnight: no bucket has full cooling.
    run(fetch(dsn, "INSERT INTO public.equipment_state (ts, equipment, state) VALUES ($1, 'fan1', false)", OPENS))
    try:
        [row] = run(fetch(dsn, "SELECT public.fn_band_full_cooling_min($1) AS m", DAY))
        assert row["m"] == 0
    finally:
        run(fetch(dsn, "DELETE FROM public.equipment_state WHERE ts = $1 AND equipment = 'fan1'", OPENS))


def test_the_store_writes_the_minutes_and_the_scorecard_shows_them(dsn):
    [again] = run(fetch(dsn, "SELECT * FROM public.fn_band_compliance_store($1)", COOL_DAY))
    assert again["temp_above_min"] == 0 and again["temp_above_full_cooling_min"] == 0
    rows = run(
        fetch(
            dsn,
            "SELECT date, temp_above_full_cooling_min, night_dryout_min FROM public.v_daily_scorecard "
            "WHERE date IN ($1, $2) ORDER BY date",
            DAY,
            COOL_DAY,
        )
    )
    assert [(r["date"], r["temp_above_full_cooling_min"]) for r in rows] == [(DAY, 540), (COOL_DAY, 0)]
    assert rows[0]["night_dryout_min"] == 360  # VPD 1.0 against a floor of max(0.5, 0.74) all night


def test_the_check_refuses_more_than_the_minutes_above(dsn):
    with pytest.raises(asyncpg.exceptions.CheckViolationError):
        run(
            fetch(
                dsn,
                "UPDATE public.daily_band_compliance SET temp_above_full_cooling_min = 1445 WHERE date = $1",
                DAY,
            )
        )


def test_the_refresh_duty_still_refreshes_and_cannot_call_the_function_directly(dsn):
    [row] = run(fetch(dsn, "SELECT verdify_matview_refresh_runtime.fn_refresh_band_compliance() AS n", user=LOGIN))
    assert row["n"] >= 2
    with pytest.raises(asyncpg.exceptions.InsufficientPrivilegeError):
        run(fetch(dsn, "SELECT public.fn_band_full_cooling_min($1)", DAY, user=LOGIN))
