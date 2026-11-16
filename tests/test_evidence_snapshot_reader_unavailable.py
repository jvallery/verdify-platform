"""GET /api/v1/public/evidence-snapshot survives missing evidence relations (#1649).

Retiring the experiment generations may later drop relations the three
crop-band and fixed-panel route readers query. Each reader must report
"unavailable" (reader_unavailable) on UndefinedTable, and the route must still
answer HTTP 200 with its full set of top-level keys. No database or network.
"""

from __future__ import annotations

from datetime import UTC, datetime
from importlib import util
from pathlib import Path

import asyncpg
from fastapi.testclient import TestClient

from verdify_schemas import fixed_panel_native_route, route_only_crop_band_reader

_SPEC = util.spec_from_file_location(
    "verdify_api_main_evidence_snapshot", Path(__file__).parents[1] / "api" / "main.py"
)
assert _SPEC and _SPEC.loader
main = util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(main)

READER_STATEMENTS = (
    route_only_crop_band_reader.READER_SQL,
    fixed_panel_native_route.MEASUREMENT_READER_SQL,
    fixed_panel_native_route.ROUTE_DAY_READER_SQL,
)

TOP_LEVEL_KEYS = {
    "generated_at",
    "timezone",
    "greenhouse_id",
    "data_health_status",
    "climate_age_seconds",
    "open_critical_high_alerts",
    "planner_score_today",
    "planner_score_scope",
    "planner_score_resource_weight_pct",
    "planner_score_resource_terms_available",
    "physical_crop_band_evidence",
    "route_only_crop_band_evidence",
    "native_fixed_panel_route_evidence",
    "temp_compliance_pct",
    "vpd_compliance_pct",
    "both_axis_compliance_pct",
    "stress_axis_hours",
    "stress_breakdown",
    "metric_semantics",
    "active_plan_id",
    "active_plan_status",
    "last_plan_id",
    "last_validated_plan_id",
    "cost_today_usd",
    "water_today_gal",
    "water_today_house_gal",
    "resource_accounting",
    "active_relays",
    "active_control_crops",
    "public_plan_records",
    "climate_rows",
    "lesson_rows_active",
    "controller_mode",
    "planner_health",
    "planning_quality",
    "operations",
}


class _Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False


class _Connection:
    """Every evidence relation is missing; every other read is empty."""

    def __init__(self):
        self.reader_calls = 0

    def transaction(self):
        return _Transaction()

    async def execute(self, *_args, **_kwargs):
        return None

    def _reader(self, statement: str) -> bool:
        return "fn_physical_crop_band_evidence" in statement or statement in READER_STATEMENTS

    async def fetchrow(self, statement, *_args, **_kwargs):
        if self._reader(statement):
            self.reader_calls += 1
            raise asyncpg.UndefinedTableError("relation does not exist")
        return None

    async def fetch(self, *_args, **_kwargs):
        return []

    async def fetchval(self, statement, *_args, **_kwargs):
        if statement == "SELECT now()":
            return datetime(2026, 11, 16, 18, 0, tzinfo=UTC)
        return None


class _Acquire:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *_exc):
        return False


class _Pool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        return _Acquire(self.conn)


def test_missing_evidence_relations_report_unavailable_and_keep_the_shape(monkeypatch):
    conn = _Connection()
    monkeypatch.setattr(main, "pool", _Pool(conn))

    response = TestClient(main.app).get("/api/v1/public/evidence-snapshot")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == TOP_LEVEL_KEYS
    # physical, route-only, and the native route's measurement reader each hit UndefinedTable.
    assert conn.reader_calls == 3
    for key in (
        "physical_crop_band_evidence",
        "route_only_crop_band_evidence",
        "native_fixed_panel_route_evidence",
    ):
        evidence = body[key]
        assert evidence["availability"] == "unavailable", key
        assert evidence["unavailable_reason"] == "reader_unavailable", key
