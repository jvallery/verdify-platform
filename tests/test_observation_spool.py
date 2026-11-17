"""Offline acceptance/restart/unknown-commit contracts for historical observations."""

import asyncio
import json
import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ingestor"))
for key, value in {
    "DB_USER": "test",
    "DB_PASSWORD": "test",
    "DB_HOST": "127.0.0.1",
    "DB_PORT": "5432",
    "DB_NAME": "test",
}.items():
    os.environ.setdefault(key, value)
from observation_spool import ObservationSpool

import ingestor

TS = datetime(2000, 1, 1, tzinfo=UTC)
EVENTS = [
    ("system_state", {"entity": "greenhouse_state", "value": "HEAT"}),
    ("override", {"override_type": "fog_gate_rh", "mode": "HEAT"}),
    ("setpoint_observed", {"parameter": "mister_min_off_s", "value": 45}),
    ("esp32_log", {"level": "WARN", "tag": "test", "message": "original"}),
    ("diagnostics", {"uptime_s": 30}),
]


class Pool:
    def __init__(self, failure=None):
        self.failure = failure
        self.calls = []
        self.committed = {}

    def acquire(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def fetchval(self, sql, *args):
        assert sql.startswith("SELECT public.fn_record_observational_source_event(")
        self.calls.append(args)
        if self.failure:
            raise self.failure
        if args[0] in self.committed:
            assert self.committed[args[0]] == args
            return False
        self.committed[args[0]] = args
        return True


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("VERDIFY_OBSERVATION_SPOOL_ENABLED", "1")
    monkeypatch.setattr(ingestor, "STATE_DIR", tmp_path)
    monkeypatch.setattr(ingestor, "_observation_spool", None)
    monkeypatch.setattr(ingestor, "_observation_accept_failures", 0)
    monkeypatch.setattr(ingestor, "state", ingestor.State())
    monkeypatch.setattr(ingestor.shared, "transport_generation", 7)
    yield
    if ingestor._observation_spool is not None:
        ingestor._observation_spool.queue.close()


def test_all_five_survive_process_exit_with_original_lineage_and_fifo(tmp_path):
    program = """
import sys,os,json
from pathlib import Path
from datetime import datetime
from observation_spool import ObservationSpool
q=ObservationSpool(Path(sys.argv[1]))
q.accept(json.loads(sys.argv[2]),datetime.fromisoformat('2000-01-01T00:00:00+00:00'),'old-runtime',7,'vallery')
os._exit(23)
"""
    path = tmp_path / "subprocess.sqlite"
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "ingestor")}
    result = subprocess.run([sys.executable, "-c", program, str(path), json.dumps(EVENTS)], env=env, check=False)
    assert result.returncode == 23
    q = ObservationSpool(path)
    rows = q.queue.rows()
    assert [r[0] for r in rows] == [e[0] for e in EVENTS]
    assert all(r[2]["runtime_instance_id"] == "old-runtime" and r[2]["connection_generation"] == 7 for r in rows)
    pool = Pool()
    asyncio.run(q.drain(pool))
    assert [c[0] for c in pool.calls] == [r[1] for r in rows]
    assert all(c[2] == TS for c in pool.calls)
    assert q.queue.rows() == []
    q.queue.close()


@pytest.mark.parametrize("failure", [OSError("DB unavailable"), asyncio.CancelledError()])
def test_db_failure_or_cancellation_keeps_every_identity(failure):
    q = ingestor._get_observation_spool()
    q.accept(EVENTS, TS, "old", 7, "vallery")
    original = q.queue.rows()
    with pytest.raises(type(failure)):
        asyncio.run(q.drain(Pool(failure)))
    assert q.queue.rows() == original


def test_unknown_commit_ack_failure_replays_exact_uuid_without_new_confirmation(monkeypatch):
    q = ingestor._get_observation_spool()
    q.accept(EVENTS, TS, "old", 7, "vallery")
    pool = Pool()
    ack = q.queue.acknowledge
    monkeypatch.setattr(q.queue, "acknowledge", lambda _: (_ for _ in ()).throw(OSError("ack failed")))
    with pytest.raises(OSError):
        asyncio.run(q.drain(pool))
    original = pool.calls[0]
    monkeypatch.setattr(q.queue, "acknowledge", ack)
    ingestor.shared.transport_generation = 99
    asyncio.run(q.drain(pool))
    assert pool.calls[1] == original
    assert len(pool.committed) == 5
    assert ingestor.state.cfg_readback == {}
    assert ingestor.state.system == {}
    assert ingestor.state.setpoints == {}


def test_atomic_related_acceptance_capacity_rejects_whole_group(monkeypatch):
    monkeypatch.setenv("OBSERVATION_SPOOL_MAX_ROWS", "1")
    assert not ingestor._accept_observations(EVENTS[:2], TS)
    assert ingestor._get_observation_spool().queue.rows() == []
    assert ingestor._observation_accept_failures == 1


def test_sqlite_full_keeps_previously_accepted(monkeypatch):
    q = ingestor._get_observation_spool()
    q.accept(EVENTS[:1], TS, "old", 7, "vallery")
    original = q.queue.rows()
    page_count = q.queue.conn.execute("PRAGMA page_count").fetchone()[0]
    q.queue.conn.execute(f"PRAGMA max_page_count={page_count}")
    with pytest.raises(Exception, match="full"):
        q.accept([("esp32_log", {"message": "x" * 200000})], TS, "old", 7, "vallery")
    assert q.queue.rows() == original


def test_same_timestamp_distinct_uuids_are_not_deduplicated():
    q = ingestor._get_observation_spool()
    first = q.accept(EVENTS[:1], TS, "old", 7, "vallery")
    second = q.accept(EVENTS[:1], TS, "old", 7, "vallery")
    assert first != second
    pool = Pool()
    asyncio.run(q.drain(pool))
    assert len(pool.committed) == 2


def test_invalid_kind_clock_generation_no_durable_acceptance():
    q = ingestor._get_observation_spool()
    for events, ts, gen in [([("control", {})], TS, 1), (EVENTS, TS.replace(tzinfo=None), 1), (EVENTS, TS, -1)]:
        with pytest.raises(ValueError):
            q.accept(events, ts, "old", gen, "vallery")
    assert q.queue.rows() == []


def test_callback_failure_does_not_update_state_or_override_cache(monkeypatch):
    ingestor.state.key_to_object_id[1] = "test_override"
    ingestor.state.key_to_type[1] = "text"
    monkeypatch.setitem(ingestor.STATE_MAP, "test_override", "overrides_active")
    monkeypatch.setattr(ingestor, "_equipment_source_now", lambda: TS)
    monkeypatch.setenv("OBSERVATION_SPOOL_MAX_ROWS", "1")
    ingestor.on_state_change(SimpleNamespace(key=1, state="fog_gate_rh"))
    assert ingestor.state.system == {}
    assert ingestor.state.last_override_set == set()
    assert ingestor._get_observation_spool().queue.rows() == []


def test_callback_state_and_override_share_original_observation_and_atomic_commit(monkeypatch):
    ingestor.state.key_to_object_id[1] = "test_override"
    ingestor.state.key_to_type[1] = "text"
    monkeypatch.setitem(ingestor.STATE_MAP, "test_override", "overrides_active")
    monkeypatch.setattr(ingestor, "_equipment_source_now", lambda: TS)
    ingestor.on_state_change(SimpleNamespace(key=1, state="fog_gate_rh"))
    rows = ingestor._get_observation_spool().queue.rows()
    assert [r[0] for r in rows] == ["system_state", "override"]
    assert all(r[2]["observed_at"] == TS.isoformat() for r in rows)
    assert ingestor.state.system["overrides_active"] == "fog_gate_rh"
    assert ingestor.state.pending_states == [] and ingestor.state.pending_override_events == []


def test_diagnostics_failed_drain_retains_frozen_snapshot_then_original_ts(monkeypatch):
    monkeypatch.setattr(ingestor.shared, "transport_generation", 7)
    monkeypatch.setitem(ingestor.shared.esp32, "state_subscription_generation", 7)
    ingestor.state.diagnostics["uptime_s"] = 30
    ingestor.state.diagnostic_observations["uptime_s"] = (TS, 7)
    asyncio.run(ingestor.write_diagnostics(Pool(OSError("DB unavailable")), TS))
    with pytest.raises(OSError):
        asyncio.run(ingestor._get_observation_spool().drain(Pool(OSError("DB unavailable"))))
    ingestor.state.diagnostics["uptime_s"] = 999
    pool = Pool()
    asyncio.run(ingestor._get_observation_spool().drain(pool))
    assert pool.calls[0][2] == TS
    assert json.loads(pool.calls[0][6])["uptime_s"] == 30


def test_all_five_schema_acceptance_and_original_setpoint_observation():
    assert ingestor._accept_observations(EVENTS, TS)
    rows = ingestor._get_observation_spool().queue.rows()
    assert [r[0] for r in rows] == [e[0] for e in EVENTS]
    assert rows[2][2]["payload"] == {"parameter": "mister_min_off_s", "value": 45}
    pool = Pool()
    asyncio.run(ingestor._get_observation_spool().drain(pool))
    assert pool.calls[2][2] == TS
    assert ingestor.state.cfg_readback == {}


def test_duplicate_batch_uuid_collision_rolls_back_every_row():
    q = ingestor._get_observation_spool().queue
    with pytest.raises(ValueError, match="different immutable"):
        q.put_many([("system_state", "same", {"value": "first"}), ("system_state", "same", {"value": "changed"})])
    assert q.rows() == []


def test_callback_setpoint_is_accepted_before_cache_change(monkeypatch):
    ingestor.state.key_to_object_id[1] = "test_number"
    ingestor.state.key_to_type[1] = "number"
    monkeypatch.setitem(ingestor.SETPOINT_MAP, "test_number", "mister_min_off_s")
    monkeypatch.setattr(ingestor, "_equipment_source_now", lambda: TS)
    monkeypatch.setattr(ingestor, "_mirror_irrigation_number_readback", lambda *_: None)
    ingestor.on_state_change(SimpleNamespace(key=1, state=45))
    assert ingestor.state.pending_setpoints == []
    assert ingestor.state.setpoints["mister_min_off_s"] == 45
    row = ingestor._get_observation_spool().queue.rows()[0]
    assert row[0] == "setpoint_observed" and row[2]["observed_at"] == TS.isoformat()


def test_log_acceptance_preserves_callback_time_and_rejects_empty(monkeypatch):
    monkeypatch.setattr(ingestor, "ESP32_LOG_LEVEL", ingestor.LogLevel.LOG_LEVEL_WARN)
    ingestor.on_log_message(
        SimpleNamespace(level=ingestor.LogLevel.LOG_LEVEL_WARN, tag=b"test", message=b"\x1b[0mwarn")
    )
    rows = ingestor._get_observation_spool().queue.rows()
    assert rows[0][2]["payload"] == {"level": "WARN", "tag": "test", "message": "warn"}
    assert ingestor.state.pending_logs == []
    ingestor.on_log_message(SimpleNamespace(level=ingestor.LogLevel.LOG_LEVEL_WARN, tag=b"test", message=b"\x1b[0m"))
    assert ingestor._get_observation_spool().queue.rows() == rows


def test_connection_lost_after_db_commit_keeps_same_uuid_until_false_retry():
    class UnknownCommitPool(Pool):
        async def fetchval(self, query, *args):
            inserted = await super().fetchval(query, *args)
            if inserted:
                raise OSError("connection lost after commit")
            return inserted

    q = ingestor._get_observation_spool()
    q.accept(EVENTS[:1], TS, "old", 7, "vallery")
    original = q.queue.rows()
    pool = UnknownCommitPool()
    with pytest.raises(OSError):
        asyncio.run(q.drain(pool))
    assert q.queue.rows() == original
    published = []
    asyncio.run(q.drain(pool, on_insert=lambda *x: published.append(x)))
    assert pool.calls[0] == pool.calls[1]
    assert len(pool.committed) == 1 and q.queue.rows() == [] and published == []


def test_new_insert_fanout_keeps_original_time_and_retry_does_not_repeat():
    q = ingestor._get_observation_spool()
    q.accept(EVENTS[:1], TS, "old", 7, "vallery")
    pool = Pool()
    published = []
    asyncio.run(q.drain(pool, on_insert=lambda *x: published.append(x)))
    assert published == [("system_state", TS, EVENTS[0][1])]
    asyncio.run(q.drain(pool, on_insert=lambda *x: published.append(x)))
    assert len(published) == 1


def test_suppressed_number_echo_updates_native_cache_without_acceptance(monkeypatch):
    ingestor.state.key_to_object_id[1] = "test_number"
    ingestor.state.key_to_type[1] = "number"
    monkeypatch.setitem(ingestor.SETPOINT_MAP, "test_number", "mister_min_off_s")
    monkeypatch.setattr(ingestor, "_accept_setpoint", lambda *_: True)
    monkeypatch.setattr(ingestor, "_mirror_irrigation_number_readback", lambda *_: None)
    monkeypatch.setattr(ingestor, "_same_pushed_value", lambda *_: True)
    monkeypatch.setitem(ingestor.shared.recently_pushed, "mister_min_off_s", __import__("time").time())
    ingestor.on_state_change(SimpleNamespace(key=1, state=45))
    assert ingestor.state.setpoints["mister_min_off_s"] == 45
    assert ingestor._get_observation_spool().queue.rows() == []


@pytest.mark.parametrize("etype", ["number", "sensor"])
def test_dispatcher_08_a_pre_push_report_after_the_push_is_not_recorded(monkeypatch, etype):
    """DISPATCHER-08, the law boot's order: connect, the dispatcher pushes 30, the controller then reports its boot
    value 45 (sampled before the push), then the pushed value. The ledger's newest row stays the push; a report of
    another value after the race window is a real change and is recorded."""
    import time as time_module

    param = "mister_engage_delay_s"
    clock = {"now": 1_000.0}
    monkeypatch.setattr(time_module, "time", lambda: clock["now"])
    ingestor.state.key_to_object_id[1] = "test_setting"
    ingestor.state.key_to_type[1] = etype
    monkeypatch.setitem(ingestor.SETPOINT_MAP, "test_setting", param)
    monkeypatch.setattr(ingestor, "_accept_setpoint", lambda *_: True)
    monkeypatch.setattr(ingestor, "_mirror_irrigation_number_readback", lambda *_: None)
    monkeypatch.setattr(ingestor.shared, "esp32_connected_at", 1_000.0)
    monkeypatch.setitem(ingestor.state.setpoints, param, 30.0)  # the value held before the reboot
    clock["now"] = 1_120.0  # the reconnect dispatch pushes 30
    monkeypatch.setitem(ingestor.shared.recently_pushed, param, clock["now"])
    monkeypatch.setitem(ingestor.shared.recently_pushed_values, param, 30.0)
    clock["now"] = 1_122.0  # the boot value, sampled before the push, arrives after it
    ingestor.on_state_change(SimpleNamespace(key=1, state=45.0))
    assert ingestor._get_observation_spool().queue.rows() == []
    assert ingestor.state.setpoints[param] == 30.0
    clock["now"] = 1_180.0  # the controller holds the pushed value: nothing new to record
    ingestor.on_state_change(SimpleNamespace(key=1, state=30.0))
    assert ingestor._get_observation_spool().queue.rows() == []
    clock["now"] = 1_200.0  # past the race window, a different value is a real change
    ingestor.on_state_change(SimpleNamespace(key=1, state=45.0))
    [row] = ingestor._get_observation_spool().queue.rows()
    assert row[2]["payload"] == {"parameter": param, "value": 45.0}
    assert ingestor._report_races_push(param, 45.0, now=1_121.0)
    assert not ingestor._report_races_push(param, 30.0, now=1_121.0)
    monkeypatch.setattr(ingestor.shared, "esp32_connected_at", 1_130.0)  # a push from an earlier connection
    assert not ingestor._report_races_push(param, 45.0, now=1_131.0)


def test_diagnostic_snapshot_excludes_stale_old_generation_and_unfenced_cache(monkeypatch):
    monkeypatch.setattr(ingestor.shared, "transport_generation", 7)
    monkeypatch.setitem(ingestor.shared.esp32, "state_subscription_generation", 7)
    ingestor.state.diagnostics.update(uptime_s=30, wifi_rssi=-40, heap_bytes=100, firmware_version="old")
    ingestor.state.diagnostic_observations.update(
        uptime_s=(TS, 7), wifi_rssi=(TS, 6), heap_bytes=(TS - timedelta(seconds=ingestor.DIAG_OBSERVATION_MAX_AGE_S), 7)
    )
    asyncio.run(ingestor.write_diagnostics(Pool(), TS + timedelta(seconds=1)))
    row = ingestor._get_observation_spool().queue.rows()[0][2]
    assert row["observed_at"] == TS.isoformat()
    assert row["payload"]["uptime_s"] == 30
    assert all(row["payload"].get(k) is None for k in ("wifi_rssi", "heap_bytes", "firmware_version"))
    before = ingestor._get_observation_spool().queue.rows()
    asyncio.run(ingestor.write_diagnostics(Pool(), TS + timedelta(seconds=30)))
    assert ingestor._get_observation_spool().queue.rows() == before
    asyncio.run(ingestor.write_diagnostics(Pool(), TS + timedelta(seconds=62)))
    assert ingestor._get_observation_spool().queue.rows() == before


def test_a_61_s_tick_against_a_60_s_publisher_loses_and_repeats_nothing(monkeypatch):
    """DIAG-WINDOW: the tick runs 60 s plus the loop's work. Over 120 ticks every published value is written once."""
    monkeypatch.setattr(ingestor.shared, "transport_generation", 7)
    monkeypatch.setitem(ingestor.shared.esp32, "state_subscription_generation", 7)
    columns = {"test_rssi": "wifi_rssi", "test_heap_minute": "heap_min_free_minute_kb", "test_reset": "reset_reason"}
    for obj_id, col in columns.items():
        monkeypatch.setitem(ingestor.DIAGNOSTIC_MAP, obj_id, col)
    publishes = [
        (TS + timedelta(seconds=60 * k + 0.5 + i * 0.2), obj_id, k)
        for k in range(125)
        for i, obj_id in enumerate(columns)
    ]
    ticks = [TS + timedelta(seconds=61 * j + 1) for j in range(1, 121)]
    events = sorted([(at, 0, obj_id, k) for at, obj_id, k in publishes] + [(at, 1, "", 0) for at in ticks])
    published: dict[str, list] = {col: [] for col in columns.values()}
    for at, kind, obj_id, k in events:
        if at > ticks[-1]:
            break
        if kind == 0:
            col = columns[obj_id]
            value = f"reason {k}" if col == "reset_reason" else float(-40 - k % 50 if col == "wifi_rssi" else k)
            assert ingestor._record_diagnostic(obj_id, value, at, 7)
            published[col].append(value)
        else:
            asyncio.run(ingestor.write_diagnostics(Pool(), at))
    rows = [row[2] for row in ingestor._get_observation_spool().queue.rows()]
    assert len(rows) > len(ticks)  # the ticks that held two publishes wrote two rows
    assert [row["observed_at"] for row in rows] == sorted({row["observed_at"] for row in rows})
    for col in columns.values():
        written = [row["payload"][col] for row in rows if row["payload"].get(col) is not None]
        assert written == published[col], col  # every value once, in order


def test_diagnostic_rows_are_publish_batches_not_queue_positions():
    """#1734 C-10 (review R4DISPATCHER-07): heap publishes at t60 and t120, gap_log_state changes at t100. Pairing by
    queue index made {heap@t60, gap@t100} stamped t100; each row is now its own batch, stamped inside it."""
    t = TS
    queues = {
        "heap_min_free_minute_kb": [(t + timedelta(seconds=60), 7, 40.0), (t + timedelta(seconds=120), 7, 41.0)],
        "gap_log_state": [(t + timedelta(seconds=100), 7, "armed")],
        "wifi_rssi": [(t + timedelta(seconds=60.4), 7, -55.0)],  # the same batch as the t60 heap value
    }
    batches = ingestor._diagnostic_batches(queues)
    assert [{col: entry[0] - t for col, entry in batch.items()} for batch in batches] == [
        {"heap_min_free_minute_kb": timedelta(seconds=60), "wifi_rssi": timedelta(seconds=60.4)},
        {"gap_log_state": timedelta(seconds=100)},
        {"heap_min_free_minute_kb": timedelta(seconds=120)},
    ]


def test_an_on_change_state_is_carried_into_every_row_of_its_connection(monkeypatch):
    """#1633 release 3: sensor_degraded_active and gap_log_state are published on change; every row carries them."""
    monkeypatch.setattr(ingestor.shared, "transport_generation", 7)
    monkeypatch.setitem(ingestor.shared.esp32, "state_subscription_generation", 7)
    ingestor.state.diagnostics.update(
        uptime_s=30, sensor_degraded_active=1, gap_log_state="armed", heap_min_free_minute_kb=40.0, restart_count=9
    )
    old = TS - timedelta(minutes=20)
    ingestor.state.diagnostic_observations.update(
        uptime_s=(TS, 7),
        sensor_degraded_active=(old, 7),
        gap_log_state=(old, 7),
        heap_min_free_minute_kb=(old, 7),  # a per-minute window: never carried
        restart_count=(old, 6),  # received in an earlier connection: not carried
    )
    asyncio.run(ingestor.write_diagnostics(Pool(), TS + timedelta(seconds=1)))
    row = ingestor._get_observation_spool().queue.rows()[0][2]
    assert row["observed_at"] == TS.isoformat()
    assert (row["payload"]["sensor_degraded_active"], row["payload"]["gap_log_state"]) == (1, "armed")
    assert row["payload"].get("heap_min_free_minute_kb") is None and row["payload"].get("restart_count") is None
    before = ingestor._get_observation_spool().queue.rows()
    asyncio.run(ingestor.write_diagnostics(Pool(), TS + timedelta(seconds=30)))
    assert ingestor._get_observation_spool().queue.rows() == before  # carried values alone never make a row


def test_diagnostic_provenance_requires_native_subscription_and_valid_callback(monkeypatch):
    monkeypatch.setattr(ingestor.shared, "transport_generation", 7)
    monkeypatch.setitem(ingestor.shared.esp32, "state_subscription_generation", 7)
    monkeypatch.setitem(ingestor.DIAGNOSTIC_MAP, "test_rssi", "wifi_rssi")
    assert ingestor._record_diagnostic("test_rssi", -40, TS, 6)
    assert "wifi_rssi" not in ingestor.state.diagnostic_observations
    assert ingestor._record_diagnostic("test_rssi", -40, TS, 7)
    assert ingestor.state.diagnostic_observations["wifi_rssi"] == (TS, 7)


def test_old_log_callback_cannot_be_relabelled_after_reconnect(monkeypatch):
    old_client, new_client = object(), object()
    monkeypatch.setattr(ingestor, "ESP32_LOG_LEVEL", 5)
    monkeypatch.setattr(ingestor.shared, "transport_generation", 7)
    for key in ("client", "state_subscription_client"):
        monkeypatch.setitem(ingestor.shared.esp32, key, old_client)
    monkeypatch.setitem(ingestor.shared.esp32, "state_subscription_generation", 7)
    old_callback = ingestor._generation_log_callback(old_client, 7)
    msg = SimpleNamespace(level=2, tag=b"native", message=b"original")
    old_callback(msg)
    first = ingestor._get_observation_spool().queue.rows()
    assert len(first) == 1 and first[0][2]["connection_generation"] == 7
    monkeypatch.setattr(ingestor.shared, "transport_generation", 8)
    old_callback(msg)  # Generation mismatch before replacement client installs.
    for key in ("client", "state_subscription_client"):
        monkeypatch.setitem(ingestor.shared.esp32, key, new_client)
    monkeypatch.setitem(ingestor.shared.esp32, "state_subscription_generation", 8)
    old_callback(msg)  # Late prior-client callback after reconnect.
    assert ingestor._get_observation_spool().queue.rows() == first
    current_callback = ingestor._generation_log_callback(new_client, 8)
    current_callback(msg)
    rows = ingestor._get_observation_spool().queue.rows()
    assert len(rows) == 2 and rows[1][2]["connection_generation"] == 8
    monkeypatch.setitem(ingestor.shared.esp32, "state_subscription_client", old_client)
    current_callback(msg)  # Same generation, wrong subscribed client.
    assert ingestor._get_observation_spool().queue.rows() == rows
