"""API-CROP-12: a planting note through MCP annotate_planting's function, answered with the planting.

The route maps REST onto ``crops.annotate`` (``op="API-CROP-12"``, ``answer="planting"``); the service keeps MCP's
answer (the event) by default and writes the same ``planting.note`` activity row either way. The database write
itself is exercised by tests/test_dashboard_db_crops_writes.py on the campaign database.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import UTC, date, datetime
from pathlib import Path

import jsonschema
import pytest
import yaml
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from verdify_services import activity, crops
from verdify_services.actor import Actor
from verdify_services.problems import ServiceError

ROOT = Path(__file__).resolve().parents[1]
OPENAPI = yaml.safe_load((ROOT / "docs/design/dashboard/openapi/dashboard-api.v1.yaml").read_text())
API = ROOT / "api"
if str(API) not in sys.path:
    sys.path.insert(0, str(API))

import operator_api  # noqa: E402
from operator_routes import crops as routes  # noqa: E402
from operator_routes import reads as read_routes  # noqa: E402

AT = datetime(2026, 11, 17, 16, 0, tzinfo=UTC)
PERSON = Actor.person("jason", "operator")
PLANTING = crops.Planting(id=7, crop="vanda", planted_date=date(2026, 3, 1), active=True, notes="Blue Vanda")
EVENT = crops.PlantingEvent(id=91, ts=AT, event_type="note", notes="Two new roots", source="dashboard")


def run(coro):
    return asyncio.run(coro)


def client() -> TestClient:
    app = FastAPI()
    app.state.pool = object()

    @app.middleware("http")
    async def signed_in(request: Request, call_next):
        request.state.actor = PERSON
        return await call_next(request)

    app.include_router(routes.router, prefix="/v1")

    async def fake_connection():
        yield object()

    app.dependency_overrides[read_routes.connection] = fake_connection
    app.add_exception_handler(ServiceError, operator_api.on_service_error)
    app.add_exception_handler(RequestValidationError, operator_api.on_invalid_request)
    return TestClient(app)


def test_the_route_matches_the_committed_contract():
    operation = OPENAPI["paths"]["/v1/crops/plantings/{planting_id}/notes"]["post"]
    assert operation["operationId"] == "API-CROP-12"
    body = operation["requestBody"]["content"]["application/json"]["schema"]
    assert body == {"$ref": "#/components/schemas/PlantingNote"}
    answer = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert answer == {"$ref": "#/components/schemas/Planting"}
    route = next(r for r in routes.router.routes if getattr(r, "operation_id", None) == "API-CROP-12")
    assert route.path == "/crops/plantings/{planting_id}/notes" and route.methods == {"POST"}


def test_the_route_calls_annotate_with_its_op_and_answers_the_planting(monkeypatch):
    calls = []

    async def fake(*args, **kwargs):
        calls.append((args, kwargs))
        return activity.WriteResult(value=PLANTING, replayed=len(calls) > 1, activity_id=5)

    monkeypatch.setattr(crops, "annotate", fake)
    key = uuid.UUID("3c0e8b1e-5f4a-4b8e-9a51-0d2f1c7a9e10")
    with client() as http:
        first = http.post(
            "/v1/crops/plantings/7/notes",
            json={"note": "Two new roots", "reason": "weekly check"},
            headers={"Idempotency-Key": str(key)},
        )
        again = http.post(
            "/v1/crops/plantings/7/notes", json={"note": "Two new roots"}, headers={"Idempotency-Key": str(key)}
        )
    assert first.status_code == 200 and "Idempotency-Replayed" not in first.headers
    assert again.status_code == 200 and again.headers["Idempotency-Replayed"] == "true"
    validator = jsonschema.Draft202012Validator(
        {"$ref": "#/components/schemas/Planting", "components": OPENAPI["components"]}
    )
    assert list(validator.iter_errors(first.json())) == []
    args, kwargs = calls[0]
    assert args[1] == PERSON and args[2] == 7
    assert args[3].note == "Two new roots" and args[3].reason == "weekly check"
    assert kwargs == {"request_id": key, "op": "API-CROP-12", "answer": "planting"}


@pytest.mark.parametrize(
    "body", [{"note": ""}, {"note": "x" * 2001}, {"note": "ok", "extra": 1}, {"note": "ok", "reason": "r" * 501}, {}]
)
def test_a_bad_body_is_400_and_nothing_is_called(monkeypatch, body):
    called = []

    async def fake(*args, **kwargs):
        called.append(args)

    monkeypatch.setattr(crops, "annotate", fake)
    with client() as http:
        answer = http.post("/v1/crops/plantings/7/notes", json=body)
    assert answer.status_code == 400 and answer.json()["code"] == "invalid_request"
    assert called == []


class NoteConn:
    """Answers annotate's own two statements; everything else goes through the patched helpers."""

    async def fetchval(self, sql, *args):
        if "FROM public.crops" in sql:
            return True
        if sql.strip() == "SELECT now()":
            return AT
        raise AssertionError(sql)


def captured_write(monkeypatch):
    seen: dict = {}

    async def recorded_write(conn, actor, **kwargs):
        seen.update(kwargs)
        value, detail = await kwargs["perform"](conn)
        seen["detail"] = detail
        return activity.WriteResult(value=value, activity_id=1)

    async def event(conn, actor, key, kind, now, **kwargs):
        seen["event"] = (key, kind, kwargs["notes"])
        return 91

    async def load_event(conn, event_id):
        return EVENT

    async def read_planting(conn, key):
        return PLANTING if key == 7 else None

    monkeypatch.setattr(activity, "recorded_write", recorded_write)
    monkeypatch.setattr(crops, "_event", event)
    monkeypatch.setattr(crops, "_load_event", load_event)
    monkeypatch.setattr(crops, "_read_planting", read_planting)
    return seen


@pytest.mark.parametrize(
    ("kwargs", "op", "value"),
    [
        ({}, "MCP-annotate_planting", EVENT),
        ({"op": "API-CROP-12", "answer": "planting"}, "API-CROP-12", PLANTING),
    ],
)
def test_annotate_keeps_the_mcp_answer_and_the_route_gets_the_planting(monkeypatch, kwargs, op, value):
    seen = captured_write(monkeypatch)
    result = run(crops.annotate(NoteConn(), PERSON, 7, {"note": "Two new roots"}, **kwargs))
    assert result.value == value
    assert seen["op"] == op and seen["action"] == "planting.note"
    assert seen["event"] == (7, "note", "Two new roots")
    assert seen["detail"] == {"ref": {"table": "crop_events", "id": 91}, "planting_id": 7}


def test_a_replay_loads_the_answer_the_write_gave(monkeypatch):
    seen = captured_write(monkeypatch)
    run(crops.annotate(NoteConn(), PERSON, 7, {"note": "Two new roots"}, op="API-CROP-12", answer="planting"))
    row = type("Row", (), {"detail": seen["detail"]})()
    assert run(seen["load"](NoteConn(), row)) == PLANTING
