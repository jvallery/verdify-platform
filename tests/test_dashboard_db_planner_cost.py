"""The Planner section's cost reads skip the retired shadow planner's calls (#1652, #1661).

The campaign step starts a fresh server for each tests/test_dashboard_db_*.py file and sets
VERDIFY_ISOLATED_TEST_DSN; without it this file skips. It builds a private schema with a minimal
planner_inference_runs table and migration 302's view shape (the whole row as ``attempt`` jsonb), and runs the three
cost queries as ``verdify_services.planner.history`` does.
"""

from __future__ import annotations

import asyncio
import os
from datetime import timedelta

import pytest

from verdify_services import planner

asyncpg = pytest.importorskip("asyncpg")

pytestmark = pytest.mark.skipif(
    not os.environ.get("VERDIFY_ISOLATED_TEST_DSN"),
    reason="needs the campaign step's private PostgreSQL (VERDIFY_ISOLATED_TEST_DSN)",
)

SCHEMA = "planner_cost"
DDL = f"""
DROP SCHEMA IF EXISTS {SCHEMA} CASCADE;
CREATE SCHEMA {SCHEMA};
CREATE TABLE {SCHEMA}.planner_inference_runs (
    run_id bigserial PRIMARY KEY,
    model_id text,
    started_at timestamptz NOT NULL,
    ended_at timestamptz,
    input_tokens bigint,
    output_tokens bigint,
    energy_wh numeric,
    trigger_id text,
    status text,
    latency_ms int,
    mode text,
    dispatched boolean
);
CREATE VIEW {SCHEMA}.v_planner_inference_runs AS
SELECT r.run_id, r.model_id, r.started_at, r.ended_at, r.input_tokens, r.output_tokens, r.energy_wh,
       to_jsonb(r) AS attempt
  FROM {SCHEMA}.planner_inference_runs r;
"""


def run(body):
    from conftest import isolated_mutation_test_dsn

    async def go():
        conn = await asyncpg.connect(isolated_mutation_test_dsn())
        try:
            await conn.execute(DDL)
            await conn.execute(f"SET search_path = {SCHEMA}")
            await body(conn, await conn.fetchval("SELECT now()"))
        finally:
            await conn.close()

    asyncio.run(go())


async def call(conn, ts, mode, trigger_id):
    await conn.execute(
        "INSERT INTO planner_inference_runs (model_id, started_at, ended_at, input_tokens, output_tokens, energy_wh, "
        "trigger_id, status, latency_ms, mode, dispatched) VALUES ('m', $1::timestamptz, $1::timestamptz + interval '2 s', 100, 10, 1.5, $2, "
        "'ok', 2000, $3, false)",
        ts,
        trigger_id,
        mode,
    )


def test_shadow_calls_are_not_the_planners_cost_and_set_no_recorded_from_date():
    async def body(conn, t0):
        day = t0.date()
        for minutes in range(3):
            await call(conn, t0 - timedelta(minutes=minutes), "shadow", f"s{minutes}")
        # Only shadow rows: no cost on any day, no plan cost and no "Cost recorded from" date.
        assert await conn.fetchval(planner._COST_FROM_SQL) is None
        assert await conn.fetch(planner._HISTORY_COST_SQL, day - timedelta(days=1), day + timedelta(days=1)) == []
        assert await conn.fetch(planner._PLAN_COST_SQL, ["s0", "s1"]) == []

        # A live call (a mode other than shadow, or none recorded) counts, and is where the cost starts.
        live_at = t0 - timedelta(minutes=1)
        await call(conn, live_at, "live", "p1")
        await call(conn, t0, None, "p2")
        assert await conn.fetchval(planner._COST_FROM_SQL) == live_at
        rows = await conn.fetch(planner._HISTORY_COST_SQL, day - timedelta(days=1), day + timedelta(days=1))
        assert sum(row["calls"] for row in rows) == 2
        assert {row["trigger_id"] for row in await conn.fetch(planner._PLAN_COST_SQL, ["s0", "p1", "p2"])} == {
            "p1",
            "p2",
        }

    run(body)
