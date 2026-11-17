"""Single-writer snapshot publication: real ordering with only in-memory fakes."""

from __future__ import annotations

import ast
import asyncio
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
INGESTOR_SOURCE = ROOT / "ingestor/ingestor.py"
sys.path.insert(0, str(ROOT / "ingestor"))
for name, value in {
    "DB_USER": "test",
    "DB_PASSWORD": "test",
    "DB_HOST": "127.0.0.1",
    "DB_PORT": "5432",
    "DB_NAME": "test",
}.items():
    os.environ.setdefault(name, value)

import shared  # noqa: E402

import ingestor  # noqa: E402
from verdify_schemas.policy_vector import live_wire_fields  # noqa: E402


def test_publisher_second_executemany_is_exact_reviewed_fw4_confirmation_sql():
    module = ast.parse(INGESTOR_SOURCE.read_text())
    publisher = next(
        node
        for node in module.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "_publish_setpoint_snapshot"
    )
    calls = sorted(
        [
            node
            for node in ast.walk(publisher)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "executemany"
        ],
        key=lambda node: node.lineno,
    )
    assert len(calls) == 2
    query = ast.literal_eval(calls[1].args[0])
    assert "SET confirmed_at = now()," in query
    assert "delivery_status = 'confirmed'" in query
    assert "COALESCE(sc.delivery_status, 'pending') IN ('sent', 'pending')" in query
    assert "sc.ts > now() - interval '7 days'" in query
    assert "NOT EXISTS" in query and "newer.ts > sc.ts" in query
    expected = json.loads((ROOT / "tests/fixtures/setpoint-snapshot-confirmation.json").read_text())
    assert query == expected["confirmation_sql"]
    assert isinstance(calls[1].args[1], ast.ListComp)
    assert isinstance(calls[1].args[1].generators[0].iter, ast.Name)
    assert calls[1].args[1].generators[0].iter.id == "snapshot_rows"


class Connection:
    def __init__(self):
        self.events = []
        self.rows = []
        self.confirmations = []
        self.active = False
        self.fail_confirmation = False
        self.after_insert = None
        self.during_fetch = None
        self.writes = []  # (parameter, at) rows the write lookup returns
        self.passes = []  # (ts, entity, value) pass markers
        self.fail_writes = False
        self.newest_rows = []  # what CONFIRMED_NOW_SQL returns
        self.restored = []

    def is_in_transaction(self):
        return self.active

    def transaction(self):
        connection = self

        class Transaction:
            async def __aenter__(self):
                connection.active = True
                connection.events.append("begin")
                self.rows = list(connection.rows)
                self.confirmations = list(connection.confirmations)

            async def __aexit__(self, kind, *_args):
                connection.active = False
                connection.events.append("rollback" if kind else "commit")
                if kind:
                    connection.rows = self.rows
                    connection.confirmations = self.confirmations

        return Transaction()

    async def executemany(self, query, rows):
        if "VALUES (now(), $1, $2, 'esp32', now(), 'observed')" in query:
            assert self.active, "the restored row commits with the confirmation"
            self.restored = list(rows)
            return
        if "INSERT INTO v_runtime_setpoint_snapshot_write" in query:
            self.events.append("insert")
            self.rows = list(rows)
            if self.after_insert:
                self.after_insert()
        else:
            assert "UPDATE v_runtime_setpoint_changes_write sc" in query
            assert "SET confirmed_at = now()," in query and "delivery_status = 'confirmed'" in query
            assert "NOT EXISTS" in query and "sc.value - $2::double precision" in query
            self.events.append("confirm")
            if self.fail_confirmation:
                raise RuntimeError("in-memory confirmation failure")
            self.confirmations = list(rows)

    async def execute(self, query, *args):
        assert "INSERT INTO v_runtime_system_state_write (ts, entity, value)" in query
        self.events.append("pass")
        self.passes.append(args)

    async def fetch(self, query, *_args):
        if query == ingestor._READBACK_WRITES_SQL:
            assert not self.active  # read before the publication transaction
            if self.fail_writes:
                raise RuntimeError("in-memory write lookup failure")
            return [{"parameter": name, "at": at} for name, at in self.writes]
        if query == ingestor.CONFIRMED_NOW_SQL:
            assert self.active
            return self.newest_rows
        assert "FROM setpoint_snapshot" in query
        if self.during_fetch:
            self.during_fetch()
        names = {field.name for field in live_wire_fields()}
        return [{"ts": ts, "parameter": name, "value": value} for ts, name, value in self.rows if name in names]


class Pool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        connection = self.connection

        class Acquire:
            async def __aenter__(self):
                return connection

            async def __aexit__(self, *_args):
                return False

        return Acquire()


@pytest.fixture
def context(monkeypatch):
    values = {field.name: 0.0 for field in live_wire_fields()}
    values["mister_water_budget_gal"] = 125.0
    values["fallback_window_s"] = 100.0  # Existing noncanonical rows must survive.
    monkeypatch.setattr(shared, "cfg_readback", values)
    monkeypatch.setattr(ingestor.state, "cfg_readback", values)
    monkeypatch.setattr(shared, "cfg_readback_generation", dict.fromkeys(values, 3))
    monkeypatch.setattr(shared, "transport_generation", 3)
    monkeypatch.setattr(shared, "transport_readbacks_generation", 3)
    monkeypatch.setattr(shared, "transport_expected_cfg_readbacks", frozenset(values))
    monkeypatch.setattr(shared, "transport_observed_cfg_readbacks", set(values))
    monkeypatch.setattr(shared, "_setpoint_snapshot_publisher", None)
    monkeypatch.setattr(shared, "_setpoint_snapshot_publication", None)
    monkeypatch.setattr(shared, "setpoint_snapshot_requested", asyncio.Event())
    monkeypatch.setattr(shared, "_setpoint_snapshot_completed", asyncio.Event())
    monkeypatch.setattr(shared, "writer_lease_strictly_held", lambda: True)
    monkeypatch.setattr(shared, "is_shadow_mode", lambda: False)
    monkeypatch.setenv("VERDIFY_DEVICE_WRITE_ENABLED", "1")
    monkeypatch.setattr(ingestor, "_readback_store", ingestor.ReadbackStore())
    # These passes model a connected controller (#1666: a pass needs a controller value since the last one);
    # test_setpoint_snapshot_on_change.py tests the silent case with the real rule.
    monkeypatch.setattr(ingestor, "device_value_since", lambda _at, _seen: True)
    connection = Connection()

    def fanout(_table, _row):
        assert not connection.active and connection.events[-1] in ("commit", "fanout")
        connection.events.append("fanout")

    monkeypatch.setattr(ingestor, "_fanout_publish", fanout)

    # These tests cannot open a real database or create another pool.
    def forbidden(*_args, **_kwargs):
        raise AssertionError("no real connection/pool in snapshot fakes")

    monkeypatch.setattr(ingestor.asyncpg, "connect", forbidden)
    monkeypatch.setattr(ingestor.asyncpg, "create_pool", forbidden)
    return values, connection, Pool(connection)


@pytest.mark.asyncio
async def test_snapshot_confirmation_and_fanout_use_one_committed_immutable_map(context):
    values, connection, pool = context
    shared.register_setpoint_snapshot_publisher()
    connection.after_insert = lambda: values.update(mister_water_budget_gal=150.0)
    await ingestor._publish_setpoint_snapshot(pool, datetime.now(UTC))
    snapshot = {name: value for _ts, name, value in connection.rows}
    confirmed = {name: value for name, value, _tolerance in connection.confirmations}
    assert snapshot == confirmed and snapshot["mister_water_budget_gal"] == 125.0
    assert snapshot["fallback_window_s"] == 100.0
    assert len({ts for ts, _name, _value in connection.rows}) == 1
    assert connection.events[:5] == ["begin", "insert", "confirm", "pass", "commit"]
    assert connection.events[5:] == ["fanout"] * len(snapshot)
    assert not shared.setpoint_snapshot_is_current(3)  # Live values advanced during INSERT.


@pytest.mark.asyncio
async def test_confirmation_failure_rolls_back_and_never_fanouts_or_acknowledges(context):
    _values, connection, pool = context
    shared.register_setpoint_snapshot_publisher()
    connection.fail_confirmation = True
    with pytest.raises(RuntimeError, match="in-memory confirmation failure"):
        await ingestor._publish_setpoint_snapshot(pool, datetime.now(UTC))
    assert connection.events == ["begin", "insert", "confirm", "rollback"]
    assert connection.rows == connection.confirmations == []
    assert shared._setpoint_snapshot_publication is None


@pytest.mark.asyncio
async def test_committed_same_content_and_generation_coalesce_without_retiming(context):
    _values, connection, pool = context
    shared.register_setpoint_snapshot_publisher()
    batch_at = datetime.now(UTC)
    await ingestor._publish_setpoint_snapshot(pool, batch_at)
    before = list(connection.events)
    shared.setpoint_snapshot_requested.set()
    assert shared.coalesce_setpoint_snapshot_request(3)
    assert await shared.request_setpoint_snapshot(3)
    assert connection.events == before
    assert shared._setpoint_snapshot_publication[2] == batch_at
    assert not shared.setpoint_snapshot_requested.is_set()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["generation", "stale", "future", "content", "incomplete"])
async def test_bad_publication_cannot_be_reused(context, change):
    values, _connection, pool = context
    shared.register_setpoint_snapshot_publisher()
    await ingestor._publish_setpoint_snapshot(pool, datetime.now(UTC))
    generation, published, stamp = shared._setpoint_snapshot_publication
    if change == "generation":
        generation -= 1
    elif change == "stale":
        stamp -= timedelta(seconds=121)
    elif change == "future":
        stamp += timedelta(seconds=20)
    elif change == "content":
        values["mister_water_budget_gal"] += 10.0
    else:
        shared.transport_readbacks_generation = 0
    shared._setpoint_snapshot_publication = (generation, published, stamp)
    assert not shared.setpoint_snapshot_is_current(3)


@pytest.mark.asyncio
async def test_generation_change_during_commit_does_not_acknowledge_old_batch(context):
    _values, connection, pool = context
    shared.register_setpoint_snapshot_publisher()
    connection.after_insert = lambda: setattr(shared, "transport_generation", 4)
    await ingestor._publish_setpoint_snapshot(pool, datetime.now(UTC))
    assert shared._setpoint_snapshot_publication is None


@pytest.mark.asyncio
async def test_missing_canonical_field_never_acknowledges_even_if_other_rows_commit(context):
    values, _connection, pool = context
    shared.register_setpoint_snapshot_publisher()
    values.pop("mister_water_budget_gal")
    await ingestor._publish_setpoint_snapshot(pool, datetime.now(UTC))
    assert shared._setpoint_snapshot_publication is None


@pytest.mark.asyncio
async def test_shadow_publisher_writes_and_fanouts_nothing(context, monkeypatch):
    _values, connection, pool = context
    monkeypatch.setattr(shared, "is_shadow_mode", lambda: True)
    await ingestor._publish_setpoint_snapshot(pool, datetime.now(UTC))
    assert connection.events == [] and shared._setpoint_snapshot_publication is None


@pytest.mark.asyncio
async def test_existing_flush_loop_demand_retimes_periodic_batch_and_coalesces(context, monkeypatch):
    values, connection, pool = context
    clock = SimpleNamespace(value=0)
    ticks = iter([60, 65, 70, 120, 125])
    publications = []
    diagnostics = []
    connection.after_insert = lambda: publications.append(clock.value)

    async def tick(seconds):
        assert seconds == 5
        try:
            clock.value = next(ticks)
        except StopIteration:
            raise asyncio.CancelledError from None
        if clock.value == 65:
            values["mister_water_budget_gal"] = 150.0
            shared.setpoint_snapshot_requested.set()
        elif clock.value == 70:
            shared.setpoint_snapshot_requested.set()  # Same committed content.

    async def noop(*_args):
        return False

    async def diagnostic(*_args):
        diagnostics.append(clock.value)

    monkeypatch.setattr(
        ingestor,
        "asyncio",
        SimpleNamespace(
            sleep=tick, get_event_loop=lambda: SimpleNamespace(time=lambda: clock.value), timeout=asyncio.timeout
        ),
    )
    monkeypatch.setattr(ingestor, "_report_spool_health", lambda: None)
    monkeypatch.setattr(ingestor, "_observation_spool_enabled", lambda: False)
    monkeypatch.setattr(
        ingestor.state, "fixed_panel_native", SimpleNamespace(ledger_enabled=False, drain=lambda _ts: {})
    )
    for name in ("pending_states", "pending_override_events", "pending_setpoints", "pending_logs"):
        monkeypatch.setattr(ingestor.state, name, [])
    for name in ("write_climate", "write_climate_action_log", "write_legacy_equipment_events", "write_daily_summary"):
        monkeypatch.setattr(ingestor, name, noop)
    monkeypatch.setattr(ingestor, "write_diagnostics", diagnostic)
    with pytest.raises(asyncio.CancelledError):
        await ingestor.flush_loop(pool)
    assert publications == [60, 65, 125]  # No redundant original-periodic batch at120.
    assert diagnostics == [60, 120]


@pytest.mark.asyncio
async def test_flush_loop_confirmation_matches_snapshot_when_callback_arrives_during_insert(context, monkeypatch):
    values, connection, pool = context
    ticks = 0
    connection.after_insert = lambda: values.update(mister_water_budget_gal=150.0)

    async def tick(_seconds):
        nonlocal ticks
        ticks += 1
        if ticks > 1:
            raise asyncio.CancelledError

    async def noop(*_args):
        return False

    monkeypatch.setattr(
        ingestor,
        "asyncio",
        SimpleNamespace(sleep=tick, get_event_loop=lambda: SimpleNamespace(time=lambda: 60), timeout=asyncio.timeout),
    )
    monkeypatch.setattr(ingestor, "_report_spool_health", lambda: None)
    monkeypatch.setattr(ingestor, "_observation_spool_enabled", lambda: False)
    monkeypatch.setattr(ingestor, "_fanout_publish", lambda *_args: None)
    monkeypatch.setattr(
        ingestor.state, "fixed_panel_native", SimpleNamespace(ledger_enabled=False, drain=lambda _ts: {})
    )
    for name in ("pending_states", "pending_override_events", "pending_setpoints", "pending_logs"):
        monkeypatch.setattr(ingestor.state, name, [])
    for name in (
        "write_climate",
        "write_climate_action_log",
        "write_diagnostics",
        "write_legacy_equipment_events",
        "write_daily_summary",
    ):
        monkeypatch.setattr(ingestor, name, noop)
    with pytest.raises(asyncio.CancelledError):
        await ingestor.flush_loop(pool)
    snapshots = {param: value for _ts, param, value in connection.rows}
    confirmed = {param: value for param, value, _tolerance in connection.confirmations}
    assert snapshots["mister_water_budget_gal"] == 125.0
    assert confirmed["mister_water_budget_gal"] == snapshots["mister_water_budget_gal"]


@pytest.mark.asyncio
async def test_af1_a_confirmation_after_a_later_boot_observation_restores_the_held_value_as_newest(context):
    """RULINGS AF1, today's sequence: gl_main_min_on_s 600 pushed 19:50:00, the rebooted controller reported its
    stored 120 at 19:50:26, the push was confirmed 19:50:35. The newest row must then say 600 again."""
    _values, connection, pool = context
    day = datetime(2026, 11, 16, tzinfo=UTC)
    pushed, observed = day.replace(hour=19, minute=50), day.replace(hour=19, minute=50, second=26)
    connection.newest_rows = [
        {
            "parameter": "gl_main_min_on_s",
            "confirmed_ts": pushed,
            "confirmed_value": 600.0,
            "newest_ts": observed,
            "newest_value": 120.0,
            "newest_source": "esp32",
        }
    ]
    shared.register_setpoint_snapshot_publisher()
    await ingestor._publish_setpoint_snapshot(pool, day.replace(hour=19, minute=50, second=35))
    assert connection.restored == [("gl_main_min_on_s", 600.0)]
    # Nothing to restore when the newest row already holds the value, is the push itself, or predates it.
    same = dict(connection.newest_rows[0], newest_value=600.0)
    own = dict(connection.newest_rows[0], newest_ts=pushed, newest_source="dispatcher")
    older = dict(connection.newest_rows[0], newest_ts=pushed - timedelta(seconds=5))
    assert ingestor.observed_rows_to_restore([same, own, older]) == []
    # DISPATCHER-05: the restored row validates through SetpointChange; a value outside the registry never lands.
    connection.restored = []
    connection.newest_rows = [dict(connection.newest_rows[0], confirmed_value=1e9)]
    await ingestor._publish_setpoint_snapshot(pool, day.replace(hour=19, minute=51, second=35))
    assert connection.restored == []
