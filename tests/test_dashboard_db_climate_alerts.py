"""The SQL of the climate refactor's package 1.3 alerts on a private PostgreSQL (#1636, #1637, #1638).

The campaign step starts a fresh server for each tests/test_dashboard_db_*.py file and sets
VERDIFY_ISOLATED_TEST_DSN; without it this file skips. It builds a private schema from db/schema.sql's DDL for
the six tables the queries read (energy with migration 248's channel columns), runs each query as
``alert_monitor`` does, and checks the rows the pure functions of tests/test_climate_alerts_1_3.py receive.
Every fixture row is placed relative to the server's now().
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

from tasks import alerts  # noqa: E402

asyncpg = pytest.importorskip("asyncpg")

pytestmark = pytest.mark.skipif(
    not os.environ.get("VERDIFY_ISOLATED_TEST_DSN"),
    reason="needs the campaign step's private PostgreSQL (VERDIFY_ISOLATED_TEST_DSN)",
)

SCHEMA = "climate_alerts_13"
TABLES = ("setpoint_changes", "setpoint_snapshot", "setpoint_plan", "diagnostics", "energy", "equipment_state")
MIN = timedelta(minutes=1)
H = timedelta(hours=1)


def extract(text: str, start: str, end: str) -> str:
    assert text.count(start) == 1, start
    begin = text.index(start)
    return text[begin : text.index(end, begin) + len(end)].replace("public.", f"{SCHEMA}.")


def ddl() -> list[str]:
    schema = (ROOT / "db/schema.sql").read_text()
    statements = [extract(schema, f"CREATE TABLE public.{table} (", ");\n") for table in TABLES]
    statements.append(
        extract(
            (ROOT / "db/migrations/248-shelly-source-interval-accounting.sql").read_text(),
            "ALTER TABLE public.energy\n",
            ";\n",
        )
    )
    return statements


@pytest.fixture(scope="module")
def dsn():
    from conftest import isolated_mutation_test_dsn

    value = isolated_mutation_test_dsn()

    async def setup():
        conn = await asyncpg.connect(value)
        try:
            await conn.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE; CREATE SCHEMA {SCHEMA}")
            for statement in ddl():
                await conn.execute(statement)
        finally:
            await conn.close()

    async def teardown():
        conn = await asyncpg.connect(value)
        try:
            await conn.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE")
        finally:
            await conn.close()

    asyncio.run(setup())
    yield value
    asyncio.run(teardown())


def scenario(dsn, body):
    """Run ``body(conn, t0)`` on emptied tables; ``t0`` is the server's now()."""

    async def run():
        conn = await asyncpg.connect(dsn)
        try:
            await conn.execute(f"SET search_path = {SCHEMA}")
            await conn.execute(f"TRUNCATE {', '.join(TABLES)}")
            await body(conn, await conn.fetchval("SELECT now()"))
        finally:
            await conn.close()

    asyncio.run(run())


async def request(conn, ts, parameter, value, *, source="band", confirmed_at=None, status="sent"):
    await conn.execute(
        "INSERT INTO setpoint_changes (ts, parameter, value, source, confirmed_at, delivery_status) "
        "VALUES ($1, $2, $3, $4, $5, $6)",
        ts,
        parameter,
        value,
        source,
        confirmed_at,
        "confirmed" if confirmed_at is not None and status == "sent" else status,
    )


async def readbacks(conn, parameter, points):
    await conn.executemany(
        "INSERT INTO setpoint_snapshot (ts, parameter, value) VALUES ($1, $2, $3)",
        [(ts, parameter, value) for ts, value in points],
    )


def every(t0, start, end, step=5 * MIN):
    """Times from t0 - start to t0 - end, every step."""
    out, ts = [], t0 - start
    while ts <= t0 - end:
        out.append(ts)
        ts += step
    return out


async def delivery(conn) -> dict[str, float]:
    rows = await conn.fetch(alerts._SETPOINT_DELIVERY_SQL, sorted(alerts.SECOND_READBACK_ABS_TOLERANCE_PARAMS))
    return {row["parameter"]: row["age_s"] for row in rows}


def test_delivery_reads_each_requested_value_against_its_readback(dsn):
    async def body(conn, t0):
        # Not taken: confirmed at 62.4 two hours ago, asked for 67.4 50 minutes ago, still reads 62.4.
        await request(conn, t0 - 2 * H, "temp_low", 62.4, confirmed_at=t0 - 2 * H + MIN)
        await request(conn, t0 - 50 * MIN, "temp_low", 67.4)
        await readbacks(conn, "temp_low", [(ts, 62.4) for ts in every(t0, 2 * H, 1 * MIN)])
        # A moving target re-asked every 10 minutes and never taken: since the first unconfirmed request.
        await request(conn, t0 - 70 * MIN, "vpd_target_south", 0.9, confirmed_at=t0 - 69 * MIN)
        for minutes, value in ((40, 1.0), (30, 1.01), (20, 1.02), (10, 1.03)):
            await request(conn, t0 - minutes * MIN, "vpd_target_south", value)
        await readbacks(conn, "vpd_target_south", [(ts, 0.9) for ts in every(t0, 2 * H, 1 * MIN)])
        # Taken, then lost (a restart reverted it 46 minutes ago): since the first readback that differs.
        await request(conn, t0 - 3 * H, "gl_main_sunset_hour", 20.0, confirmed_at=t0 - 3 * H + MIN)
        await readbacks(
            conn,
            "gl_main_sunset_hour",
            [(ts, 20.0 if ts < t0 - 46 * MIN else 19.0) for ts in every(t0, 3 * H, 1 * MIN, step=MIN)],
        )
        # Matches by the confirmation's tolerances: a binary32 readback, and 1 s on a second-valued setting.
        await request(conn, t0 - 2 * H, "vpd_low", 0.8, confirmed_at=t0 - 2 * H + MIN)
        await readbacks(conn, "vpd_low", [(t0 - MIN, 0.800000011920929)])
        await request(conn, t0 - 2 * H, "mister_pulse_on_s", 30.0, confirmed_at=t0 - 2 * H + MIN)
        await readbacks(conn, "mister_pulse_on_s", [(t0 - MIN, 30.6)])
        # A superseded newest request is not what the host asks for; an esp32 row is the controller's own.
        await request(conn, t0 - 2 * H, "gl_grow_sunset_hour", 21.0, status="superseded")
        await readbacks(conn, "gl_grow_sunset_hour", [(t0 - MIN, 20.0)])
        await request(conn, t0 - 2 * H, "temp_high", 79.3, confirmed_at=t0 - 2 * H + MIN)
        await request(conn, t0 - 30 * MIN, "temp_high", 95.0, source="esp32", status="observed")
        await readbacks(conn, "temp_high", [(t0 - 20 * MIN, 79.3)])
        # No readback in the last day: not judged here.
        await request(conn, t0 - 3 * H, "fog_escalation_kpa", 0.4)

        ages = await delivery(conn)
        assert set(ages) == {"temp_low", "vpd_target_south", "gl_main_sunset_hour"}
        assert 49 * 60 <= ages["temp_low"] <= 51 * 60
        assert 39 * 60 <= ages["vpd_target_south"] <= 41 * 60
        assert 44 * 60 <= ages["gl_main_sunset_hour"] <= 47 * 60

        env = alerts._setpoint_delivery_stuck_alert(
            await conn.fetch(alerts._SETPOINT_DELIVERY_SQL, sorted(alerts.SECOND_READBACK_ABS_TOLERANCE_PARAMS))
        )
        assert env["severity"] == "critical" and env["details"]["differing"] == 3

        # Taken now: the readback matches, and nothing differs any more.
        await readbacks(conn, "temp_low", [(t0, 67.4)])
        assert "temp_low" not in await delivery(conn)

    scenario(dsn, body)


def test_plan_not_delivered_waits_30_minutes_for_a_confirmed_write(dsn):
    async def plan(conn, created):
        await conn.execute(
            "INSERT INTO setpoint_plan (ts, parameter, value, plan_id, created_at, expires_at) "
            "VALUES ($1::timestamptz, 'temp_low', 62.0, 'p', $1::timestamptz, $1::timestamptz + interval '1 day')",
            created,
        )

    async def body(conn, t0):
        await request(conn, t0 - 2 * H, "temp_low", 62.4, confirmed_at=t0 - 2 * H + MIN)
        await plan(conn, t0 - 31 * MIN)
        row = await conn.fetchrow(alerts._PLAN_NOT_DELIVERED_SQL, alerts.PLAN_NOT_DELIVERED_AFTER_S)
        assert row is not None and row["plan_created_at"] == t0 - 31 * MIN
        assert row["last_confirmed_at"] == t0 - 2 * H + MIN
        # A plan or band write confirmed after the plan clears it.
        await request(conn, t0 - 25 * MIN, "vpd_target_south", 1.0, confirmed_at=t0 - 24 * MIN)
        assert await conn.fetchrow(alerts._PLAN_NOT_DELIVERED_SQL, alerts.PLAN_NOT_DELIVERED_AFTER_S) is None
        # A plan younger than 30 minutes waits.
        await plan(conn, t0 - 10 * MIN)
        assert await conn.fetchrow(alerts._PLAN_NOT_DELIVERED_SQL, alerts.PLAN_NOT_DELIVERED_AFTER_S) is None

    scenario(dsn, body)


async def diagnostics(conn, t0, *, minutes, offset_s, sntp_valid):
    await conn.executemany(
        "INSERT INTO diagnostics (ts, controller_time_epoch, sntp_valid) "
        "VALUES ($1, (EXTRACT(EPOCH FROM $1::timestamptz) + $2)::bigint, $3)",
        [(t0 - minute * MIN, offset_s, sntp_valid) for minute in range(minutes)],
    )


@pytest.mark.parametrize(
    ("minutes", "offset_s", "sntp_valid", "raised"),
    [(30, 690, 1, True), (30, -50, 1, False), (30, -30, 0, True), (10, -30, 0, False)],
)
def test_clock_offset_and_sync_from_diagnostics(dsn, minutes, offset_s, sntp_valid, raised):
    async def body(conn, t0):
        await diagnostics(conn, t0, minutes=minutes, offset_s=offset_s, sntp_valid=sntp_valid)
        row = await conn.fetchrow(alerts._CLOCK_SQL)
        assert abs(row["offset_s"] - offset_s) < 1.5
        assert (alerts._clock_unconfirmed_alert(row) is not None) is raised

    scenario(dsn, body)


async def heater(conn, t0, *, heat1, heat2=None, watts, source_ts=None):
    await conn.execute("INSERT INTO equipment_state (ts, equipment, state) VALUES ($1, 'heat1', $2)", *heat1)
    if heat2 is not None:
        await conn.execute("INSERT INTO equipment_state (ts, equipment, state) VALUES ($1, 'heat2', $2)", *heat2)
    await conn.executemany(
        "INSERT INTO energy (ts, ch1_power_w, ch1_source_ts, ch1_quality) VALUES ($1, $2, $3, 'ok')",
        [(t0 - minute * MIN, watts, source_ts or t0 - minute * MIN) for minute in (2, 7, 12)],
    )


@pytest.mark.parametrize(
    ("heat1_on", "watts", "frozen", "raised"),
    [
        (True, -19.0, False, "heat_no_power"),  # the clamp reads reversed: abs()
        (True, -1450.0, False, None),
        (False, -1450.0, False, "heat_manual_override"),
        (True, -19.0, True, None),
        (False, -1450.0, True, None),
    ],
)
def test_heater_power_against_its_relay(dsn, heat1_on, watts, frozen, raised):
    async def body(conn, t0):
        await heater(
            conn,
            t0,
            heat1=(t0 - 20 * MIN, heat1_on),
            heat2=(t0 - 3 * H, False),
            watts=watts,
            source_ts=t0 - 2 * H if frozen else None,
        )
        row = await conn.fetchrow(alerts._HEAT_SQL, alerts.HEAT_SETTLE)
        assert row["samples"] == (0 if frozen else 3)
        assert [alert["alert_type"] for alert in alerts._heat_power_alerts(row)] == ([raised] if raised else [])

    scenario(dsn, body)
