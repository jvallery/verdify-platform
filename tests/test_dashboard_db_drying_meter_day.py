"""The drying meter's day in migration 317's fn_daily_record_store, run on a private PostgreSQL (RLY-70).

The campaign step starts a fresh server for each tests/test_dashboard_db_*.py file and sets
VERDIFY_ISOLATED_TEST_DSN; without it this file skips. The test takes the function's meter CTEs (meter_raw to
meter_day) and its three meter columns verbatim from the migration, binds the day's bounds as parameters, and runs
them on minimal system_state and diagnostics tables. It covers the review findings on the meter: the base is the last
row before the day however old (a quiet day stores 0, not NULL and not the whole since-boot total), and a boot instant
computed from a stale uptime does not mark an ordinary boot as a lower bound.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

asyncpg = pytest.importorskip("asyncpg")

pytestmark = pytest.mark.skipif(
    not os.environ.get("VERDIFY_ISOLATED_TEST_DSN"),
    reason="needs the campaign step's private PostgreSQL (VERDIFY_ISOLATED_TEST_DSN)",
)

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = "drying_meter_day"
S = timedelta(seconds=1)
H = timedelta(hours=1)
DAY_START = datetime(2026, 11, 16, 7, tzinfo=UTC)  # local 2026-11-16 00:00 MST
DAY_END = DAY_START + 24 * H


def meter_sql() -> str:
    source = (ROOT / "db/migrations/317-served-band-readers-and-relay-record.sql").read_text()
    body = source.split("CREATE OR REPLACE FUNCTION public.fn_daily_record_store(p_day date)", 1)[1]
    ctes = body[body.index("meter_raw AS (") : body.index("    INSERT INTO public.daily_record AS t (")].rstrip()
    columns = body[body.index("(SELECT COALESCE(md.water_g, 0) FROM meter_day md)") :]
    columns = columns[: columns.index("now()\n")].rstrip().rstrip(",")
    sql = f"WITH {ctes}\nSELECT {columns}"
    return (
        sql.replace("public.", f"{SCHEMA}.").replace("v_start", "$1::timestamptz").replace("v_end", "$2::timestamptz")
    )


def run(body):
    from conftest import isolated_mutation_test_dsn

    async def go():
        conn = await asyncpg.connect(isolated_mutation_test_dsn())
        try:
            await conn.execute(
                f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE; CREATE SCHEMA {SCHEMA};"
                f"CREATE TABLE {SCHEMA}.system_state (ts timestamptz NOT NULL, entity text NOT NULL, value text NOT NULL);"
                f"CREATE TABLE {SCHEMA}.diagnostics (ts timestamptz NOT NULL, uptime_s double precision);"
            )
            await body(conn)
        finally:
            await conn.close()

    asyncio.run(go())


async def meter(conn, ts, g, wh, s=0, rw=0):
    value = json.dumps({"v": 1, "g": g, "wh": wh, "s": s, "rw": rw}, separators=(",", ":"))
    await conn.execute(f"INSERT INTO {SCHEMA}.system_state VALUES ($1, 'climate_drying_meter', $2)", ts, value)


async def law(conn, ts, bits):
    await conn.execute(
        f"INSERT INTO {SCHEMA}.system_state VALUES ($1, 'climate_law_state', $2)",
        ts,
        json.dumps({"v": 1, "l": bits}, separators=(",", ":")),
    )


async def uptime(conn, ts, uptime_s):
    await conn.execute(f"INSERT INTO {SCHEMA}.diagnostics VALUES ($1, $2)", ts, uptime_s)


async def day(conn):
    row = await conn.fetchrow(meter_sql(), DAY_START, DAY_END)
    return tuple(row) if row is not None else None


def test_no_meter_row_ever_is_null_and_a_quiet_day_after_one_is_zero():
    async def body(conn):
        assert await day(conn) == (None, None, None)
        # The last row is 9 days before the day (a quiet stretch): the day stores 0, not NULL.
        await meter(conn, DAY_START - 9 * 24 * H, 40000, 9000)
        assert await day(conn) == (0.0, 0.0, False)

    run(body)


def test_the_day_after_a_quiet_day_counts_its_steps_not_the_since_boot_total():
    async def body(conn):
        await meter(conn, DAY_START - 9 * 24 * H, 40000, 9000)
        await meter(conn, DAY_START + 10 * H, 40150, 9050)
        assert await day(conn) == (150.0, 50.0, False)

    run(body)


def test_an_ordinary_boot_with_a_late_uptime_is_counted_and_not_a_lower_bound():
    """2026-11-17: the first post-boot meter row came 155 ms before the diagnostics row whose uptime puts the boot."""

    async def body(conn):
        boot = DAY_START + 10 * H
        await meter(conn, DAY_START + 2 * H, 1000, 300)
        await meter(conn, boot - 36 * 60 * S, 1800, 566)  # no run since: the law shows no run bit before the boot
        for minutes in range(36, 0, -6):
            await law(conn, boot - minutes * 60 * S, 128)
        for ts, up in ((boot - 120 * S, 30000.0), (boot - 60 * S, 30060.0)):
            await uptime(conn, ts, up)
        first = boot + 30 * S  # the first post-boot meter row, totals since the boot
        await meter(conn, first, 0, 0)
        await law(conn, first - 0.01 * S, 449)  # post-boot law record with the run bit
        await uptime(conn, first + 0.155 * S, 2.896)  # stale uptime: computed boot 27 s after the true one
        await meter(conn, boot + H, 200, 60)
        water, heat, lower = await day(conn)
        # 1000 (the day's first row, no base: whole), +800, the post-boot row 0 (totals fell: whole), +200.
        assert (water, heat) == (2000.0, 626.0)
        assert lower is False

    run(body)


def test_a_drying_run_lost_to_a_boot_marks_the_day_a_lower_bound():
    async def body(conn):
        boot = DAY_START + 10 * H
        await meter(conn, DAY_START + 2 * H, 1000, 300)
        await law(conn, boot - 5 * 60 * S, 256)  # a run after the last meter row, before the boot
        await uptime(conn, boot - 600 * S, 30000.0)
        await meter(conn, boot + 12 * S, 0, 0)
        await uptime(conn, boot + 20 * S, 15.0)
        await meter(conn, boot + H, 100, 30)
        water, heat, lower = await day(conn)
        assert (water, heat) == (1100.0, 330.0)
        assert lower is True

    run(body)


def test_a_boot_hidden_in_a_long_gap_with_higher_totals_is_found_from_diagnostics():
    async def body(conn):
        await meter(conn, DAY_START + 1 * H, 500, 100)
        await uptime(conn, DAY_START + 1 * H, 50000.0)
        await uptime(conn, DAY_START + 6 * H, 3600.0)  # a boot at 05:00 local; the host was away until 06:00
        await meter(conn, DAY_START + 6 * H, 700, 150)  # since the boot, above the pre-boot totals
        water, heat, _ = await day(conn)
        assert (water, heat) == (500.0 + 700, 100.0 + 150)

    run(body)
