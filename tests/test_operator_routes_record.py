"""The API-32, API-33 and API-34 adapters in api/operator_routes/record.py, against fake services.

The routes only map REST onto verdify_services. Each test mounts the router under /v1 as the operator API does, with
the operator API's own error handlers (a ServiceError renders as its Problem, request validation as 400
invalid_request, both application/problem+json), swaps the service function for a fake that records what it was
called with, and checks the operation ids, the query parameters each adapter passes, the cursor passed through, the
Problem mapping and the JSON names (``from``, never ``from_``). Where the committed OpenAPI already carries the path,
the body is validated against it too.
"""

from __future__ import annotations

import re
import sys
from datetime import UTC, date, datetime
from pathlib import Path

import jsonschema
import pytest
import yaml
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from verdify_services import record, reviews
from verdify_services.problems import ServiceError, problem

ROOT = Path(__file__).resolve().parents[1]
OPENAPI = yaml.safe_load((ROOT / "docs/design/dashboard/openapi/dashboard-api.v1.yaml").read_text())
API = ROOT / "api"  # operator_routes imports as a top-level package, as in the image
if str(API) not in sys.path:
    sys.path.insert(0, str(API))

import operator_api  # noqa: E402
from operator_routes import record as routes  # noqa: E402

AT = datetime(2026, 11, 17, 16, 20, tzinfo=UTC)
OPERATIONS = {
    ("/record/days", "GET"): ("API-32", "record"),
    ("/record/relay-check", "GET"): ("API-33", "record"),
    ("/reviews", "GET"): ("API-34", "review"),
}


class FakePool:
    """Never used: every test overrides the connection dependency."""


class Conn:
    """A connection no statement may reach: the services are faked or refuse first."""

    def is_in_transaction(self):
        return False

    async def fetch(self, sql, *args):
        raise AssertionError(f"unexpected statement: {sql}")

    fetchrow = fetchval = fetch


def client() -> TestClient:
    app = FastAPI()
    app.state.pool = FakePool()
    app.include_router(routes.router, prefix="/v1")

    async def fake_connection():
        yield Conn()

    app.dependency_overrides[routes.connection] = fake_connection
    app.add_exception_handler(ServiceError, operator_api.on_service_error)
    app.add_exception_handler(RequestValidationError, operator_api.on_invalid_request)
    return TestClient(app)


def recorder(monkeypatch, module, name, result):
    calls = []

    async def fake(*args, **kwargs):
        calls.append((args[1:], kwargs))
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(module, name, fake)
    return calls


def committed_errors(path: str, body) -> list[str]:
    """The body against the committed response schema, once the contract carries the path; empty before."""
    item = OPENAPI["paths"].get(f"/v1{path}")
    if item is None:
        return []
    schema = item["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    validator = jsonschema.Draft202012Validator({**schema, "components": OPENAPI["components"]})
    return [f"{list(error.absolute_path)}: {error.message}" for error in validator.iter_errors(body)]


# ── fixtures built from the real models ─────────────────────────────────────


def daily_record() -> record.DailyRecord:
    day = record.record_day(
        date(2026, 11, 17),
        {
            "complete": False,
            "kwh_metered": 8.25,
            "kwh_metered_24h": None,
            "meter_coverage_pct": 31.9,
            "therms_est": 1.959,
            "water_gal": 1.0,
            "wetting_gal": 1.0,
            "planning_water_gal": 1.0,
            "house_water_gal": 0.0,
            "water_complete": False,
            "counter_sample_pct": 91.9,
            "drying_s": 129.8,
            "drying_runs": 1,
            "furnace_starts_after_drying": 1,
            "drying_water_g": 247.0,
            "drying_heat_wh": 177.0,
            "drying_meter_lower_bound": False,
            "dry_refusal": None,
        },
        None,
        [{"equipment": "heat1", "starts": 14, "run_s": 25061.0, "repaired_runs": 0}],
        None,
    )
    return record.DailyRecord(
        from_=date(2026, 11, 17),
        to=date(2026, 11, 17),
        days=[day],
        means=record.RecordMeansPair(d7=None, d30=None),
        law_started=date(2026, 11, 16),
        baseline=record.record_period([day], date(2026, 10, 17), date(2026, 11, 15), [date(2026, 11, 2)]),
        since_law=None,
        server_time=AT,
    )


def review_page() -> reviews.ReviewPage:
    return reviews.ReviewPage(
        items=[],
        next_cursor="WzJd",
        today=reviews.ReviewToday(review_date=date(2026, 11, 16), status="written", missed=False),
        tokens=reviews.token_use([355128, 185792]),
        proposal_waiting=None,
    )


# ── operations ──────────────────────────────────────────────────────────────


def test_the_routes_are_the_design_operations_with_their_tags():
    served = {
        (route.path, method): (route.operation_id, tuple(route.tags))
        for route in routes.router.routes
        for method in route.methods
    }
    assert served == {key: (operation, (tag,)) for key, (operation, tag) in OPERATIONS.items()}
    for (path, method), (operation, _) in OPERATIONS.items():
        committed = OPENAPI["paths"].get(f"/v1{path}")
        if committed is not None:
            assert committed[method.lower()]["operationId"] == operation


def test_the_route_module_carries_no_auth_and_no_sql():
    source = (API / "operator_routes/record.py").read_text()
    assert not re.search(r"\b(SELECT|INSERT|UPDATE|DELETE)\b", source)
    assert not re.search(r"(?i)bearer|session|role|security|authorization", source.split('"""', 2)[2])
    for route in routes.router.routes:
        assert {dependency.call for dependency in route.dependant.dependencies} == {routes.connection}, route.path


def test_the_operator_api_includes_the_module():
    assert routes in operator_api.ROUTE_MODULES


# ── API-32 ──────────────────────────────────────────────────────────────────


def test_record_days_passes_the_local_dates_and_answers_from_not_from_(monkeypatch):
    calls = recorder(monkeypatch, record, "record_days", daily_record())
    response = client().get("/v1/record/days", params={"from": "2026-11-17", "to": "2026-11-17"})
    assert response.status_code == 200
    assert calls == [((date(2026, 11, 17), date(2026, 11, 17)), {})]
    body = response.json()
    assert body["from"] == "2026-11-17" and "from_" not in body
    assert body["days"][0]["energy"] == {"kwh": None, "kwh_partial": 8.25, "coverage_pct": 31.9}
    assert body["days"][0]["relays"] == {"heat1": {"starts": 14, "run_s": 25061.0, "repaired_runs": 0}}
    assert committed_errors("/record/days", body) == []


def test_record_days_defaults_both_dates(monkeypatch):
    calls = recorder(monkeypatch, record, "record_days", daily_record())
    assert client().get("/v1/record/days").status_code == 200
    assert calls == [((None, None), {})]


def test_record_days_refuses_a_date_that_is_not_a_date(monkeypatch):
    recorder(monkeypatch, record, "record_days", daily_record())
    response = client().get("/v1/record/days", params={"from": "yesterday"})
    assert response.status_code == 400 and response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["code"] == "invalid_request"


def test_record_days_renders_the_services_refusal(monkeypatch):
    recorder(
        monkeypatch,
        record,
        "record_days",
        ServiceError(problem("window_too_large", "The window is at most 400 days", field="from", max=400)),
    )
    response = client().get("/v1/record/days", params={"from": "2025-01-01", "to": "2026-11-17"})
    assert response.status_code == 422
    assert response.json()["code"] == "window_too_large" and response.json()["max"] == 400


# ── API-33 ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("query, days", [({}, 7), ({"days": "14"}, 14), ({"days": "30"}, 30)])
def test_relay_check_passes_its_days(monkeypatch, query, days):
    calls = recorder(monkeypatch, record, "relay_check", record.RelayCheck(days=[]))
    response = client().get("/v1/record/relay-check", params=query)
    assert response.status_code == 200 and response.json() == {"days": []}
    assert calls == [((), {"days": days})]
    assert committed_errors("/record/relay-check", response.json()) == []


@pytest.mark.parametrize("days", ["10", "x", "0"])
def test_relay_check_refuses_other_days(monkeypatch, days):
    calls = recorder(monkeypatch, record, "relay_check", record.RelayCheck(days=[]))
    response = client().get("/v1/record/relay-check", params={"days": days})
    assert response.status_code == 400 and response.json()["code"] == "invalid_request" and calls == []


# ── API-34 ──────────────────────────────────────────────────────────────────


def test_reviews_pass_limit_and_cursor_through(monkeypatch):
    calls = recorder(monkeypatch, reviews, "page", review_page())
    response = client().get("/v1/reviews", params={"limit": "5", "cursor": "WzJd"})
    assert response.status_code == 200
    assert calls == [((), {"limit": 5, "cursor": "WzJd"})]
    body = response.json()
    assert body["next_cursor"] == "WzJd"
    assert body["today"] == {
        "review_date": "2026-11-16",
        "status": "written",
        "missed": False,
        "expected_after": "07:00",
        "late_after": "10:00",
    }
    assert body["tokens"] == {"last": 355128, "mean_7": 185792.0, "mean_30": 185792.0, "rise_pct": 91.1}
    assert committed_errors("/reviews", body) == []


def test_reviews_default_to_thirty_and_no_cursor(monkeypatch):
    calls = recorder(monkeypatch, reviews, "page", review_page())
    assert client().get("/v1/reviews").status_code == 200
    assert calls == [((), {"limit": 30, "cursor": None})]


def test_the_real_service_refuses_a_limit_over_sixty():
    response = client().get("/v1/reviews", params={"limit": "61"})
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request" and response.json()["max"] == 60


def test_reviews_render_unavailable_as_a_problem(monkeypatch):
    recorder(monkeypatch, reviews, "page", ServiceError(problem("unavailable", "not readable yet")))
    response = client().get("/v1/reviews")
    assert response.status_code == 503 and response.json()["code"] == "unavailable"
