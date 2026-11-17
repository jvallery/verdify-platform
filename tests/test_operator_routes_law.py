"""API-30 and API-31 adapters in api/operator_routes/law.py, against fake services.

The routes only map REST onto verdify_services.law. Each test mounts the router under /v1 as the operator API does,
with its error handlers, swaps the service function for a fake that records its call, and checks the operation ids,
the tag, the query parameters passed through, the response shape (the service's own models, ``from`` by its alias)
and the Problem mapping. Window refusals come from the real service, before any SQL.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import jsonschema
import yaml
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from verdify_services import law
from verdify_services.problems import ServiceError, problem

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "api"  # operator_routes imports as a top-level package, as in the image
if str(API) not in sys.path:
    sys.path.insert(0, str(API))

import operator_api  # noqa: E402
from operator_routes import law as routes  # noqa: E402

AT = datetime(2026, 11, 17, 16, 20, 30, tzinfo=UTC)
T0 = datetime(2026, 11, 17, 6, 0, tzinfo=UTC)
OPENAPI = yaml.safe_load((ROOT / "docs/design/dashboard/openapi/dashboard-api.v1.yaml").read_text())


def openapi_errors(path: str, instance) -> list[str]:
    schema = OPENAPI["paths"][path]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    validator = jsonschema.Draft202012Validator({**schema, "components": OPENAPI["components"]})
    return [f"{list(error.absolute_path)}: {error.message}" for error in validator.iter_errors(instance)]


class Conn:
    """A connection the real service refuses on before any statement; a statement fails the test."""

    def transaction(self, **_kwargs):
        raise AssertionError("unexpected transaction")


def app_with(conn=None) -> TestClient:
    app = FastAPI()
    app.include_router(routes.router, prefix="/v1")
    lent = conn if conn is not None else Conn()

    async def fake_connection():
        yield lent

    app.dependency_overrides[routes.connection] = fake_connection
    app.add_exception_handler(ServiceError, operator_api.on_service_error)
    app.add_exception_handler(RequestValidationError, operator_api.on_invalid_request)
    return TestClient(app)


def recorder(monkeypatch, name, result):
    calls = []

    async def fake(*args, **kwargs):
        calls.append((args, kwargs))
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(routes.service, name, fake)
    return calls


def view() -> law.LawView:
    row = {
        "at": AT,
        "law_value": '{"v":1,"l":128,"o":0,"dr":"none","e":0.633,"lim":0.7,"br":0,"b":[67.4,79.4,0.81,1.34]}',
        "law_at": AT - timedelta(seconds=20),
        "meter_value": '{"v":1,"s":120,"g":247,"wh":177,"rw":22440}',
        "meter_at": AT - timedelta(minutes=27),
        "constants_value": None,
        "constants_at": None,
        "outdoor_source": "station",
        "outdoor_source_at": AT - timedelta(seconds=87),
        "heartbeat_at": AT - timedelta(seconds=10),
        "climate_at": AT - timedelta(seconds=30),
        "temp_control": 70.65,
        "vpd_control": 0.914,
        "rh_avg": 64.3,
        "dew_point": 58.0,
        "outdoor_temp_f": 36.37,
        "outdoor_rh_pct": 80.6,
        "temp_intake": 37.04,
        "intake_rh": 79.0,
        "host_temp_low": 67.5,
        "host_temp_high": 79.5,
        "host_vpd_low": 0.81,
        "host_vpd_high": 1.34,
        "band_source": "onchip_curve",
        "sntp_valid": 1,
        "last_sntp_sync_age_s": 691,
        "active_probe_count": 4,
        "sensor_degraded_active": 0,
        "gap_log_state": "armed",
        "uptime_s": 35163,
        "uptime_at": AT,
        "lead_fan": "Fan 1",
        "fog_block_reason": "none",
        "today": None,
    }
    return law.law_view(row, {}, None, False)


def test_operation_ids_and_tag():
    served = {
        (route.path, method): (route.operation_id, route.tags)
        for route in routes.router.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    }
    assert served == {("/law", "GET"): ("API-30", ["law"]), ("/law/history", "GET"): ("API-31", ["law"])}


def test_the_operator_api_includes_the_law_routes():
    assert routes in operator_api.ROUTE_MODULES


def test_law_view(monkeypatch):
    calls = recorder(monkeypatch, "law", view())
    response = app_with().get("/v1/law")
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(calls) == 1
    assert law.LawView.model_validate(body) == view()
    assert openapi_errors("/v1/law", body) == []
    assert body["reporting"] is True and body["lead_fan"] == "fan1"
    assert [rule["id"] for rule in body["rules"]][:2] == ["heat1", "heat2"]
    # The outdoor dew point is served as a number, computed from the served outdoor pair (36.37 F, 80.6 %).
    assert isinstance(body["inputs"]["outdoor"]["dew_point_f"], float)
    assert body["constants"]["hash"] is None and body["constants"]["matches"] is None


def test_law_history_passes_the_window(monkeypatch):
    result = law.LawHistory(
        from_=T0,
        to=T0 + timedelta(hours=1),
        first_record_at=T0 - timedelta(days=1),
        lanes=law.history_lanes([(T0, T0 + timedelta(hours=1), law.RecordKey(l=449, o=293, dr="none", br=0))]),
        drying=[law.DryingInterval(start=T0, end=T0 + timedelta(hours=1), state="refused", reason="cost")],
        outdoor_source=[],
        band_repaired=[],
        cost=law.CostColumns(bucket_s=60, t=[], cost_kwh_per_kg=[], limit_kwh_per_kg=[]),
        band=law.LawBandColumns(bucket_s=60, t=[], temp_low_f=[], temp_high_f=[], vpd_low_kpa=[], vpd_high_kpa=[]),
    )
    calls = recorder(monkeypatch, "history", result)
    response = app_with().get("/v1/law/history", params={"from": "2026-11-17T06:00:00Z", "to": "2026-11-17T07:00:00Z"})
    assert response.status_code == 200, response.text
    (args, _kwargs) = calls[0]
    assert args[1:] == (T0, T0 + timedelta(hours=1))
    body = response.json()
    assert body["from"] == "2026-11-17T06:00:00Z" and "from_" not in body
    assert openapi_errors("/v1/law/history", body) == []
    assert body["drying"] == [
        {"start": "2026-11-17T06:00:00Z", "end": "2026-11-17T07:00:00Z", "state": "refused", "reason": "cost"}
    ]


def test_history_problems():
    client = app_with()
    too_large = client.get("/v1/law/history", params={"from": "2026-10-01T00:00:00Z", "to": "2026-11-17T00:00:00Z"})
    assert too_large.status_code == 422 and too_large.json()["code"] == "window_too_large"
    assert too_large.headers["content-type"].startswith("application/problem+json")
    missing = client.get("/v1/law/history", params={"from": "2026-11-17T06:00:00Z"})
    assert missing.status_code == 400 and missing.json()["code"] == "invalid_request"
    naive = client.get("/v1/law/history", params={"from": "2026-11-17T06:00:00", "to": "2026-11-17T07:00:00"})
    assert naive.status_code == 400 and naive.json()["code"] == "invalid_request"


def test_a_timeout_is_a_problem(monkeypatch):
    recorder(monkeypatch, "law", ServiceError(problem("query_timeout", "This window took too long. Narrow it.")))
    response = app_with().get("/v1/law")
    assert response.status_code == 503 and response.json()["code"] == "query_timeout"
