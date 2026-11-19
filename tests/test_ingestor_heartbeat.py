"""VD-54: the ingestor heartbeat (decisions Q-01).

One validated system_state row (entity ingestor_heartbeat) every 60 s from the
ingestor's own task loop, through the view the ingestor login already writes;
the tasks package re-exports the task without shadowing its submodule; the
dashboard's Now read looks for the same entity.
"""

from __future__ import annotations

import ast
import asyncio
import sys
import types
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
INGESTOR = ROOT / "ingestor"
if str(INGESTOR) not in sys.path:
    sys.path.insert(0, str(INGESTOR))

import shared  # noqa: E402
import tasks  # noqa: E402
import tasks.liveness as liveness  # noqa: E402

from verdify_services import reads  # noqa: E402

INSERT = "INSERT INTO v_runtime_system_state_write (ts, entity, value) VALUES ($1, 'ingestor_heartbeat', 'alive')"
COUNTERS_INSERT = "INSERT INTO v_runtime_system_state_write (ts, entity, value) VALUES ($1, $2, $3)"


class _Conn:
    def __init__(self):
        self.executes: list[tuple[str, tuple]] = []

    async def execute(self, query, *args):
        self.executes.append((query, args))
        return "INSERT 0 1"


class _Pool:
    def __init__(self):
        self.conn = _Conn()

    def acquire(self):
        conn = self.conn

        class _Ctx:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *exc):
                return False

        return _Ctx()


def test_one_heartbeat_row_through_the_ingestor_write_view():
    pool = _Pool()
    before = datetime.now(UTC)
    asyncio.run(liveness.ingestor_heartbeat(pool))
    [(query, (ts,)), (counters, (counters_ts, entity, _value))] = pool.conn.executes
    assert query == INSERT
    assert counters == COUNTERS_INSERT and counters_ts == ts and entity == "ingestor_counters"
    assert ts.tzinfo is not None and before <= ts <= datetime.now(UTC)


def test_the_row_validates_through_system_state_row_first(monkeypatch):
    built = []
    real = liveness.SystemStateRow

    def spy(**fields):
        built.append(fields)
        return real(**fields)

    monkeypatch.setattr(liveness, "SystemStateRow", spy)
    pool = _Pool()
    asyncio.run(liveness.ingestor_heartbeat(pool))
    assert [(fields["entity"], fields["value"]) for fields in built][0] == ("ingestor_heartbeat", "alive")
    assert [fields["entity"] for fields in built] == ["ingestor_heartbeat", "ingestor_counters"]
    assert pool.conn.executes[0][1] == (built[0]["ts"],)

    class _NaiveClock:
        @staticmethod
        def now(tz=None):
            return datetime(2026, 11, 2, 12, 0)  # no zone: SystemStateRow refuses it

    monkeypatch.setattr(liveness, "datetime", _NaiveClock)
    refused = _Pool()
    with pytest.raises(ValidationError):
        asyncio.run(liveness.ingestor_heartbeat(refused))
    assert refused.conn.executes == []


def test_a_shadow_ingestor_never_writes_a_heartbeat():
    # Shadow mode no-ops every write statement, so a shadow cannot stand in for a dead writer.
    assert shared._is_write_sql(INSERT)


def _task_loop_tasks() -> list[tuple]:
    tree = ast.parse((INGESTOR / "ingestor.py").read_text())
    [loop] = [node for node in ast.walk(tree) if isinstance(node, ast.AsyncFunctionDef) and node.name == "task_loop"]
    [assign] = [
        node
        for node in ast.walk(loop)
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "TASKS" for t in node.targets)
    ]
    return [
        tuple(ast.literal_eval(elt) if isinstance(elt, ast.Constant) else ast.unparse(elt) for elt in entry.elts)
        for entry in assign.value.elts
    ]


def test_the_task_loop_runs_the_heartbeat_every_60_s():
    assert ("ingestor_heartbeat", 60, "ingestor_heartbeat") in _task_loop_tasks()
    tree = ast.parse((INGESTOR / "ingestor.py").read_text())
    imported = {
        alias.name
        for node in tree.body
        if isinstance(node, ast.ImportFrom) and node.module == "tasks"
        for alias in node.names
    }
    assert "ingestor_heartbeat" in imported


def test_tasks_reexports_the_task_and_keeps_its_submodule():
    assert tasks.ingestor_heartbeat is liveness.ingestor_heartbeat
    assert isinstance(tasks.liveness, types.ModuleType)
    assert not hasattr(tasks, "ingestor_heartbeat") or not isinstance(tasks.ingestor_heartbeat, types.ModuleType)


def test_the_dashboard_reads_the_same_entity():
    assert liveness.HEARTBEAT_ENTITY == reads.HEARTBEAT_ENTITY == "ingestor_heartbeat"
    assert liveness.HEARTBEAT_VALUE == "alive"
    assert f"'{liveness.HEARTBEAT_ENTITY}'" in INSERT and f"'{liveness.HEARTBEAT_VALUE}'" in INSERT


# ── package 6 (RULINGS V2): the ingestor_counters row ──────────────────────


def test_the_counters_row_carries_the_process_counters_and_the_pin(monkeypatch):
    monkeypatch.setattr(shared, "esp32_reconnects", 3)
    monkeypatch.setattr(shared, "payload_rejections", 2)
    monkeypatch.setattr(shared, "rows_rejected", {"climate": 4, "diagnostics": 1})
    monkeypatch.setattr(liveness, "_expected_firmware_version", lambda: "2026.11.7.0133.9517acb6")
    monkeypatch.setattr(liveness.gap_replay.host, "failures", 5)
    pool = _Pool()
    asyncio.run(liveness.ingestor_heartbeat(pool))
    (_, (_, entity, value)) = pool.conn.executes[1]
    assert entity == "ingestor_counters"
    assert value == ('{"v":1,"rc":3,"pr":2,"rj":{"climate":4,"diagnostics":1},"fw":"2026.11.7.0133.9517acb6","gr":5}')


def test_an_odd_pin_is_left_out_not_a_lost_row(monkeypatch):
    monkeypatch.setattr(liveness, "_expected_firmware_version", lambda: "not a version; rm -rf")
    assert '"fw":""' in liveness.counters_value()
    monkeypatch.setattr(liveness, "_expected_firmware_version", lambda: None)
    assert '"fw":""' in liveness.counters_value()


def test_a_failed_counters_write_never_costs_the_heartbeat(monkeypatch):
    class _Failing(_Conn):
        async def execute(self, query, *args):
            if query == COUNTERS_INSERT:
                raise OSError("connection reset")
            return await super().execute(query, *args)

    pool = _Pool()
    pool.conn = _Failing()
    asyncio.run(liveness.ingestor_heartbeat(pool))  # no raise
    assert [query for query, _ in pool.conn.executes] == [INSERT]


def test_note_row_rejected_counts_per_table(monkeypatch):
    monkeypatch.setattr(shared, "rows_rejected", {})
    shared.note_row_rejected("climate")
    shared.note_row_rejected("climate")
    shared.note_row_rejected("system_state")
    assert shared.rows_rejected == {"climate": 2, "system_state": 1}


def test_every_device_rejection_site_counts_its_table():
    source = (INGESTOR / "ingestor.py").read_text()
    from verdify_schemas.telemetry import INGESTOR_REJECTED_TABLES

    for table in INGESTOR_REJECTED_TABLES:
        assert f'shared.note_row_rejected("{table}")' in source, table
    assert "shared.esp32_reconnects += 1" in source
    assert "shared.payload_rejections += 1" in source
