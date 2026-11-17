"""api/operator_routes/system.py: API-35 to API-37 against fake services and the committed OpenAPI.

The routes only map REST onto verdify_services.system_health. Each test mounts the router under /v1 with the
operator API's error handlers (request validation is 400 invalid_request), swaps the service for a recorder, and
checks the operation ids, the query values passed and refused, and that the bodies validate against the contract.
"""

from __future__ import annotations

import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import jsonschema
import pytest
import yaml
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from verdify_services import system_health as sh
from verdify_services.problems import ServiceError, problem

ROOT = Path(__file__).resolve().parents[1]
OPENAPI = yaml.safe_load((ROOT / "docs/design/dashboard/openapi/dashboard-api.v1.yaml").read_text())
API = ROOT / "api"
if str(API) not in sys.path:
    sys.path.insert(0, str(API))

import operator_api  # noqa: E402
from operator_routes import reads as read_routes  # noqa: E402
from operator_routes import system as routes  # noqa: E402

AT = datetime(2026, 11, 17, 16, 0, tzinfo=UTC)
OPERATIONS = {"/system/controller": "API-35", "/system/data": "API-36", "/system/delivery": "API-37"}


def client() -> TestClient:
    app = FastAPI()
    app.state.pool = object()
    app.include_router(routes.router, prefix="/v1")

    async def fake_connection():
        yield object()

    app.dependency_overrides[read_routes.connection] = fake_connection
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

    monkeypatch.setattr(sh, name, fake)
    return calls


def schema_errors(path: str, body) -> list[str]:
    schema = OPENAPI["paths"][f"/v1{path}"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    validator = jsonschema.Draft202012Validator({**schema, "components": OPENAPI["components"]})
    return [f"{list(e.absolute_path)}: {e.message}" for e in validator.iter_errors(body)]


HEALTH = sh.controller_health(AT, None, None, None, None)
DATA = sh.DataContinuity(
    from_=AT - timedelta(days=1),
    to=AT,
    gap_log="armed",
    outages=[],
    replayed=[],
    by_day=[sh.ContinuityDay(date=date(2026, 11, 17), outage_s=0, replayed_min=15)],
    tables=sh.table_flows(None, None),
    probes=sh.probe_ages(None),
    ingestor=sh.ingestor(AT, None, None),
)
DELIVERY = sh.Delivery(
    from_=AT - timedelta(hours=24),
    to=AT,
    by_status=[sh.StatusCount(source="band", status="failed", count=141)],
    oldest_unconfirmed_s=0.0,
    latency=sh.Latency(p50_s=None, p95_s=None, confirmed=0),
    failing=sh.failing_rows(
        [{"param": "gl_main_lux_threshold", "failed": 141, "last_failed_at": AT, "last_confirmed_at": None}]
    ),
    dispatcher_stage="ordinary",
    readback_pass=sh.readback_pass({"ts": AT, "value": "stored=2 of=102"}),
)


def test_the_operation_ids_match_the_contract_and_the_app_includes_the_router():
    served = {route.path: route.operation_id for route in routes.router.routes}
    assert served == OPERATIONS
    for path, operation in OPERATIONS.items():
        assert OPENAPI["paths"][f"/v1{path}"]["get"]["operationId"] == operation
    assert routes in operator_api.ROUTE_MODULES


@pytest.mark.parametrize(
    ("path", "name", "result", "params", "kwargs"),
    [
        ("/system/controller", "controller", HEALTH, {}, {}),
        ("/system/data", "data", DATA, {}, {"days": 1}),
        ("/system/data", "data", DATA, {"days": "30"}, {"days": 30}),
        ("/system/delivery", "delivery", DELIVERY, {}, {"hours": 24}),
        ("/system/delivery", "delivery", DELIVERY, {"hours": "168"}, {"hours": 168}),
    ],
)
def test_each_route_passes_its_window_and_answers_the_contract(monkeypatch, path, name, result, params, kwargs):
    calls = recorder(monkeypatch, name, result)
    with client() as http:
        answer = http.get(f"/v1{path}", params=params)
    assert answer.status_code == 200, answer.text
    assert schema_errors(path, answer.json()) == []
    assert len(calls) == 1 and calls[0][1] == kwargs


@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("/system/data", {"days": "2"}),
        ("/system/data", {"days": "1.5"}),
        ("/system/data", {"days": "true"}),
        ("/system/delivery", {"hours": "48"}),
        ("/system/delivery", {"hours": "x"}),
    ],
)
def test_a_window_outside_the_contract_is_400_and_nothing_is_read(monkeypatch, path, params):
    calls = recorder(monkeypatch, path.rsplit("/", 1)[1], DATA)
    with client() as http:
        answer = http.get(f"/v1{path}", params=params)
    assert answer.status_code == 400 and answer.json()["code"] == "invalid_request"
    assert calls == []


def test_a_timeout_is_the_services_problem(monkeypatch):
    recorder(monkeypatch, "controller", ServiceError(problem("query_timeout", "This window took too long.")))
    with client() as http:
        answer = http.get("/v1/system/controller")
    assert answer.status_code == 503 and answer.json()["code"] == "query_timeout"
    assert answer.headers["content-type"].startswith("application/problem+json")
