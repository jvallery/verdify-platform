"""HEALTH_SQL (api/product_metrics.py) against a private PostgreSQL with the nine controller-health columns that
migration 314 adds (contracts h3-health-columns, RULINGS AE3). Needs VERDIFY_ISOLATED_TEST_DSN; without it this file
skips. diagnostics comes from db/schema.sql's DDL; the nine columns are added after a table-level SELECT grant, as
314 will, to show the reading role needs no new grant."""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import product_metrics as pm  # noqa: E402

asyncpg = pytest.importorskip("asyncpg")

pytestmark = pytest.mark.skipif(
    not os.environ.get("VERDIFY_ISOLATED_TEST_DSN"),
    reason="needs the campaign step's private PostgreSQL (VERDIFY_ISOLATED_TEST_DSN)",
)

SCHEMA = "metrics_health"
ROLE = "metrics_health_reader"
MIN = timedelta(minutes=1)
COLUMNS_314 = (
    ("heap_min_free_minute_kb", "double precision"),
    ("heap_largest_block_minute_low_kb", "double precision"),
    ("loop_worst_ms", "double precision"),
    ("nvs_write_worst_ms", "double precision"),
    ("restart_count", "integer"),
    ("nvs_used_entries", "integer"),
    ("nvs_free_entries", "integer"),
    ("sensor_degraded_active", "integer"),
    ("gap_log_state", "text"),
)


def ddl() -> list[str]:
    schema = (ROOT / "db/schema.sql").read_text()
    start = "CREATE TABLE public.diagnostics ("
    assert schema.count(start) == 1
    begin = schema.index(start)
    table = schema[begin : schema.index(");\n", begin) + 2].replace("public.", f"{SCHEMA}.")
    return [
        table,
        f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{ROLE}') THEN CREATE ROLE {ROLE}; END IF; END $$",
        f"GRANT USAGE ON SCHEMA {SCHEMA} TO {ROLE}",
        f"GRANT SELECT ON {SCHEMA}.diagnostics TO {ROLE}",
        *(f"ALTER TABLE {SCHEMA}.diagnostics ADD COLUMN {name} {kind}" for name, kind in COLUMNS_314),
    ]


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
    asyncio.run(run([f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE", f"DROP ROLE IF EXISTS {ROLE}"]))


def scenario(dsn, body):
    async def run():
        conn = await asyncpg.connect(dsn)
        try:
            await conn.execute(f"SET search_path = {SCHEMA}")
            await conn.execute("TRUNCATE diagnostics")
            t0 = await conn.fetchval("SELECT now()")
            await body(conn, t0)
        finally:
            await conn.close()

    asyncio.run(run())


async def read_as_role(conn):
    await conn.execute(f"SET ROLE {ROLE}")
    try:
        return await conn.fetchrow(pm.HEALTH_SQL)
    finally:
        await conn.execute("RESET ROLE")


def test_rows_before_the_third_flash_give_no_sample(dsn):
    async def body(conn, t0):
        for m in range(1, 6):
            await conn.execute("INSERT INTO diagnostics (ts, uptime_s, heap_bytes) VALUES ($1, 100, 70)", t0 - m * MIN)
        row = await read_as_role(conn)
        assert all(row[name] is None for name, _ in COLUMNS_314)
        assert pm.health_samples(row) == []

    scenario(dsn, body)


def test_each_reading_is_its_newest_non_null_value_in_15_minutes(dsn):
    async def body(conn, t0):
        insert = (
            "INSERT INTO diagnostics (ts, heap_min_free_minute_kb, loop_worst_ms, restart_count, nvs_used_entries,"
            " nvs_free_entries, nvs_write_worst_ms, gap_log_state, sensor_degraded_active,"
            " heap_largest_block_minute_low_kb) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
        )
        await conn.execute(insert, t0 - 20 * MIN, 5.0, 900.0, 1, 1, 1, 900.0, "off: nvs_full", 1, 5.0)  # too old
        await conn.execute(insert, t0 - 3 * MIN, 22.0, 140.0, 6, 800, 2600, 12.0, "armed", 0, 31.0)
        await conn.execute(insert, t0 - 1 * MIN, 18.0, None, 7, None, None, 0.0, None, None, None)  # partial flush
        row = await read_as_role(conn)
        got = {(n, labels): v for n, labels, v in pm.health_samples(row)}
        assert got[("verdify_controller_heap_min_free_window_bytes", ())] == 18.0 * 1024
        assert got[("verdify_controller_heap_largest_free_block_window_bytes", ())] == 31.0 * 1024
        assert got[("verdify_controller_loop_worst_seconds", ())] == pytest.approx(0.14)
        assert got[("verdify_controller_restarts_total", ())] == 7
        assert got[("verdify_controller_nvs_entries", (("state", "free"),))] == 2600
        assert got[("verdify_controller_nvs_write_worst_seconds", ())] == 0.0
        assert got[("verdify_controller_gap_log_armed", ())] == 1
        assert got[("verdify_controller_sensor_degraded_active", ())] == 0

    scenario(dsn, body)


def test_device_reads_take_the_newest_state_and_the_lead_from_a_one_fan_start(dsn):
    async def body(conn, t0):
        await conn.execute("CREATE TABLE IF NOT EXISTS equipment_state (ts timestamptz, equipment text, state boolean)")
        await conn.execute("CREATE TABLE IF NOT EXISTS system_state (ts timestamptz, entity text, value text)")
        await conn.execute("TRUNCATE equipment_state, system_state")
        eq = "INSERT INTO equipment_state (ts, equipment, state) VALUES ($1, $2, $3)"
        await conn.execute(eq, t0 - 60 * MIN, "fan2", True)  # fan2 alone: the lead
        await conn.execute(eq, t0 - 50 * MIN, "fan1", True)  # second fan joins
        await conn.execute(eq, t0 - 40 * MIN, "fan1", False)
        await conn.execute(eq, t0 - 40 * MIN, "fan2", False)
        await conn.execute(eq, t0 - 10 * MIN, "drip_wall", True)
        await conn.execute(eq, t0 - 5 * MIN, "drip_wall", False)
        rows = await conn.fetch(pm.DEVICES_SQL, [*pm.IRRIGATION_ZONES, *pm.LIGHT_CIRCUITS])
        assert [(r["equipment"], r["state"]) for r in rows] == [("drip_wall", False)]
        assert (await conn.fetchrow(pm.LEAD_FAN_SQL))["fan"] == "fan2"
        await conn.execute(
            "INSERT INTO system_state (ts, entity, value) VALUES ($1, 'lead_fan', 'Fan 1')", t0 - 3 * MIN
        )
        assert (await conn.fetchrow(pm.LEAD_FAN_SQL))["fan"] == "Fan 1"  # the entity wins once it reports
        await conn.execute("INSERT INTO system_state (ts, entity, value) VALUES ($1, 'irr_engine', 'true')", t0)
        assert (await conn.fetchrow(pm.ENGINE_SQL))["value"] == "true"

    scenario(dsn, body)
