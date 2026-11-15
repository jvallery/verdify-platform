"""/health stays fast under probe traffic (jvallery/verdify-platform#1611).

The API latency SLO counts every api.verdify.ai request, and /health is most of
them. It used to read max(ts) over the whole climate hypertable (~0.8 s) and the
v_planner_performance view (~1 s) on every call.
"""

from __future__ import annotations

import asyncio
from importlib import util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_SPEC = util.spec_from_file_location("verdify_api_main_health_1611", ROOT / "api" / "main.py")
assert _SPEC and _SPEC.loader
main = util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(main)


class _Conn:
    def __init__(self, log, recent_climate_age=4):
        self.log, self.recent_climate_age = log, recent_climate_age

    async def fetchval(self, sql, *args):
        self.log.append(("fetchval", sql))
        if sql == main.CLIMATE_AGE_RECENT_SQL:
            return self.recent_climate_age
        if sql == main.CLIMATE_AGE_SQL:
            return 90000
        if "climate_action_log" in sql and "max(ts)" in sql:
            return 5
        if "count(*)" in sql:
            return 0
        if "setpoint_changes" in sql:
            return 30
        if "system_state" in sql:
            return "normal"
        return None  # proof-missing: nothing missing

    async def fetchrow(self, sql, *args):
        self.log.append(("fetchrow", sql))
        return {"compliance_pct": 91.5, "planner_score": 77.0}


class _Acquire:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *exc):
        return False


class _Pool:
    def __init__(self, recent_climate_age=4):
        self.log = []
        self.recent_climate_age = recent_climate_age

    def acquire(self):
        return _Acquire(_Conn(self.log, self.recent_climate_age))


def _fresh(pool):
    main.pool = pool
    main._health_scorecard.update(value=None, at=None, task=None)


def _scorecard_reads(pool):
    return sum(1 for kind, sql in pool.log if kind == "fetchrow" and sql == main.HEALTH_SCORECARD_SQL)


def test_climate_age_reads_the_last_day_only_and_never_the_whole_hypertable():
    pool = _Pool()
    _fresh(pool)
    body = asyncio.run(main.health())
    sqls = [sql for _, sql in pool.log]
    assert main.CLIMATE_AGE_RECENT_SQL in sqls
    assert main.CLIMATE_AGE_SQL not in sqls
    assert "interval '1 day'" in main.CLIMATE_AGE_RECENT_SQL
    assert body["checks"]["climate_age_seconds"] == 4


def test_a_stale_climate_feed_still_reports_its_true_age():
    pool = _Pool(recent_climate_age=None)
    _fresh(pool)
    body = asyncio.run(main.health())
    assert body["checks"]["climate_age_seconds"] == 90000
    assert body["status"] == "degraded"


def test_the_scorecard_view_is_read_once_per_ttl_not_per_request():
    pool = _Pool()
    _fresh(pool)

    async def three_calls():
        return [await main.health() for _ in range(3)]

    bodies = asyncio.run(three_calls())
    assert _scorecard_reads(pool) == 1
    for body in bodies:
        assert body["checks"]["compliance_pct"] == 91.5
        assert body["checks"]["planner_score"] == 77.0


def test_a_stale_scorecard_is_served_and_refreshed_in_the_background():
    pool = _Pool()
    _fresh(pool)

    async def run():
        await main.health()
        main._health_scorecard["at"] -= main.HEALTH_SCORECARD_TTL_SECONDS + 1
        body = await main.health()  # served from the cache; refresh scheduled
        assert body["checks"]["planner_score"] == 77.0
        await main._health_scorecard["task"]
        return body

    asyncio.run(run())
    assert _scorecard_reads(pool) == 2
