"""Climate refactor package 1.5: the host accepts and stores what the phase 2 firmware publishes, before the flash.

``relay_counters`` (one JSON object of lifetime counters) is validated and stored as a ``system_state`` row;
``outdoor_source`` and the new ``mode_reason`` values are stored as they come; ``band_source`` takes ``corridor``; and
the controller's SENSOR_FAULT state opens a critical ``sensor_fault`` alert after two minutes. No database.
"""

from __future__ import annotations

import ast
import asyncio
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ingestor"))
for key, value in {
    "DB_USER": "test",
    "DB_PASSWORD": "test",
    "DB_HOST": "localhost",
    "DB_PORT": "5432",
    "DB_NAME": "test",
}.items():
    os.environ.setdefault(key, value)

import ingestor  # noqa: E402
from verdify_schemas.alerts import AlertEnvelope  # noqa: E402

COUNTERS = {"v": 1, "h1": 120, "h2": 40, "f1": 300, "f2": 12, "fg": 900, "vt": 77, "f1s": 86400, "f2s": 3600}


@pytest.fixture(autouse=True)
def isolated_state(monkeypatch):
    monkeypatch.setattr(ingestor.shared, "transport_generation", 0)
    monkeypatch.setattr(ingestor, "_observation_spool_enabled", lambda: False)
    monkeypatch.setattr(ingestor.state, "system", {})
    monkeypatch.setattr(ingestor.state, "diagnostics", {})
    monkeypatch.setattr(ingestor.state, "pending_states", [])
    monkeypatch.setattr(ingestor.state, "key_to_object_id", {})
    monkeypatch.setattr(ingestor.state, "key_to_type", {})


def observe(object_id, value):
    ingestor.state.key_to_object_id[1] = object_id
    ingestor.state.key_to_type[1] = "text"
    ingestor.on_state_change(SimpleNamespace(key=1, state=value))


def test_relay_counters_are_stored_as_one_validated_system_state_row():
    observe("relay_counters", json.dumps(COUNTERS))
    assert len(ingestor.state.pending_states) == 1
    entity, value = ingestor.state.pending_states[0]
    assert entity == "relay_counters" and json.loads(value) == COUNTERS
    # The same counters again are no new row; a step back after a restart is stored as it comes.
    observe("relay_counters", json.dumps(COUNTERS, indent=1))
    observe("relay_counters", json.dumps({**COUNTERS, "h1": 119}))
    assert [json.loads(value)["h1"] for _, value in ingestor.state.pending_states] == [120, 119]


@pytest.mark.parametrize(
    "payload",
    [
        {**COUNTERS, "v": 2},
        {key: value for key, value in COUNTERS.items() if key != "f2s"},
        {**COUNTERS, "h1": -1},
        {**COUNTERS, "h1": 1.5},
        {**COUNTERS, "vt": 2**32},
        {**COUNTERS, "extra": 1},
        [1, 2, 3],
    ],
)
def test_a_relay_counter_payload_that_is_not_version_1_is_dropped(payload):
    observe("relay_counters", json.dumps(payload))
    observe("relay_counters", "not json")
    assert ingestor.state.pending_states == []
    assert "relay_counters" not in ingestor.state.system


@pytest.mark.parametrize(
    ("object_id", "value", "entity"),
    [
        ("outdoor_source", "intake", "outdoor_source"),
        ("outdoor_source", "none", "outdoor_source"),
        ("mode_reason", "no_indoor_heat", "mode_reason"),
        ("greenhouse_state", "SENSOR_FAULT", "greenhouse_state"),
    ],
)
def test_the_phase_2_text_values_are_stored(object_id, value, entity):
    observe(object_id, value)
    assert ingestor.state.pending_states == [(entity, value)]


def test_band_source_takes_the_corridor():
    observe("band_source", "corridor")
    assert ingestor.state.diagnostics["band_source"] == "corridor"


# ── the sensor_fault alert ──────────────────────────────────────────────────

NAMES = {"_IRR_NEWEST_STATE_WINDOW", "SENSOR_FAULT_ALERT_AFTER_S", "_SENSOR_FAULT_SQL", "_sensor_fault_alert"}


def _alert_fn():
    source = ast.parse((ROOT / "ingestor/tasks/alerts.py").read_text())
    body = [
        node
        for node in source.body
        if (isinstance(node, ast.AsyncFunctionDef) and node.name in NAMES)
        or (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in NAMES for t in node.targets))
    ]
    assert len(body) == len(NAMES)
    ns: dict = {}
    exec(compile(ast.Module(body=body, type_ignores=[]), "owning-sensor-fault", "exec"), ns)  # noqa: S102
    return ns


class Conn:
    def __init__(self, row):
        self.row, self.calls = row, []

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        return self.row


def test_sensor_fault_opens_a_critical_alert_naming_its_reason():
    ns = _alert_fn()
    since = datetime(2026, 11, 16, 5, 0, tzinfo=UTC)
    conn = Conn({"since": since, "mode_reason": "no_indoor_heat"})
    alert = asyncio.run(ns["_sensor_fault_alert"](conn))
    assert conn.calls[0][1] == (120,)
    assert "'SENSOR_FAULT'" in conn.calls[0][0] and "make_interval(secs => $1)" in conn.calls[0][0]
    assert (alert["alert_type"], alert["severity"]) == ("sensor_fault", "critical")
    assert "no_indoor_heat" in alert["message"]
    envelope = AlertEnvelope.model_validate(alert)
    assert envelope.alert_type == "sensor_fault"
    assert asyncio.run(ns["_sensor_fault_alert"](Conn(None))) is None
