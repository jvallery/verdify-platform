"""Readbacks stored on change (#1662, package 4.4): the publisher's choice of rows, with in-memory fakes only.

The 60 s pass still confirms writes against the whole cache and fans it all out. A parameter's setpoint_snapshot row
is inserted when its value moved beyond the readback tolerance (float32 noise never counts), a write or desired row
for it is newer than its last stored row, the controller reconnected (a parameter with no row from the
current transport generation) or the ingestor restarted, or its staggered hourly keyframe is due. Every pass stores
one pass marker, and readers take freshness from it.
"""

from __future__ import annotations

import inspect
import struct
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from test_setpoint_snapshot_coherence import context  # noqa: F401  (pytest fixture; sets the ingestor path)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ingestor"))

import shared  # noqa: E402

import ingestor  # noqa: E402
from verdify_schemas.policy_vector import wire_fields  # noqa: E402

T0 = datetime(2026, 11, 20, 12, 0, 30, tzinfo=UTC)


def float32(value: float) -> float:
    return struct.unpack("f", struct.pack("f", value))[0]


def stored_names(connection) -> set[str]:
    return {name for _ts, name, _value in connection.rows}


async def publish(pool, at, reason="periodic"):
    shared.register_setpoint_snapshot_publisher()
    await ingestor._publish_setpoint_snapshot(pool, at, reason=reason)


# The pure rule.


def test_first_pass_and_a_restart_store_every_readback():
    frozen = {"temp_high": 80.0, "mister_all_kpa": 1.25}
    store = ingestor.ReadbackStore()
    chosen = ingestor.readbacks_to_store(frozen, store, now=T0, generation=3, written_at={})
    assert chosen == set(frozen)


def test_unchanged_values_are_not_stored_again():
    frozen = {"temp_high": 80.0, "mister_all_kpa": 1.25}
    store = ingestor.ReadbackStore({name: (value, T0, 3) for name, value in frozen.items()})
    chosen = ingestor.readbacks_to_store(frozen, store, now=T0 + timedelta(seconds=60), generation=3, written_at={})
    assert chosen == set()


def test_float32_noise_is_not_a_change_and_a_real_change_is():
    assert ingestor.readback_unchanged("mister_all_kpa", 1.6, float32(1.6))
    assert ingestor.readback_unchanged("temp_high", float32(80.3), 80.3)
    assert not ingestor.readback_unchanged("mister_all_kpa", 1.6, 1.7)
    assert not ingestor.readback_unchanged("temp_high", 80.0, 80.01)
    # Second-quantized readbacks keep their registry tolerance of one second.
    assert ingestor.readback_unchanged("mister_pulse_on_s", 10.0, 10.6)
    assert not ingestor.readback_unchanged("mister_pulse_on_s", 10.0, 11.5)
    store = ingestor.ReadbackStore({"mister_all_kpa": (1.6, T0, 3)})
    chosen = ingestor.readbacks_to_store(
        {"mister_all_kpa": float32(1.6)}, store, now=T0 + timedelta(minutes=1), generation=3, written_at={}
    )
    assert chosen == set()


def test_a_reconnect_stores_every_readback():
    frozen = {"temp_high": 80.0, "mister_all_kpa": 1.25}
    store = ingestor.ReadbackStore({name: (value, T0, 3) for name, value in frozen.items()})
    chosen = ingestor.readbacks_to_store(frozen, store, now=T0 + timedelta(seconds=60), generation=4, written_at={})
    assert chosen == set(frozen)


def test_a_write_newer_than_the_stored_row_gets_a_row_even_when_the_value_repeats():
    frozen = {"temp_high": 80.0, "mister_all_kpa": 1.25}
    store = ingestor.ReadbackStore({name: (value, T0, 3) for name, value in frozen.items()})
    written = {"mister_all_kpa": T0 + timedelta(seconds=20), "temp_high": T0 - timedelta(minutes=5)}
    chosen = ingestor.readbacks_to_store(
        frozen, store, now=T0 + timedelta(seconds=60), generation=3, written_at=written
    )
    assert chosen == {"mister_all_kpa"}


def test_the_write_lookup_reads_no_plan_and_has_no_dense_fallback():
    """DISPATCHER-06: plans are retired, and a failed lookup fails the pass instead of storing every readback."""
    assert "v_active_plan" not in ingestor._READBACK_WRITES_SQL
    source = inspect.getsource(ingestor._readback_writes)
    assert "except" not in source and "return None" not in source


def test_keyframes_are_hourly_and_staggered_across_the_passes():
    names = sorted({spec.name for spec in wire_fields()} | {f"extra_{i}" for i in range(150)})
    frozen = dict.fromkeys(names, 1.0)
    store = ingestor.ReadbackStore({name: (1.0, T0, 3) for name in names})
    per_pass = []
    stored_count = dict.fromkeys(names, 0)
    for minute in range(1, 121):  # two hours of 60 s passes
        now = T0 + timedelta(minutes=minute)
        chosen = ingestor.readbacks_to_store(frozen, store, now=now, generation=3, written_at={})
        for name in chosen:
            store.stored[name] = (1.0, now, 3)
            stored_count[name] += 1
        per_pass.append(len(chosen))
    # Every parameter gets one keyframe an hour: two in two hours.
    assert set(stored_count.values()) == {2}
    # Spread: no pass stores more than a small share of the parameters.
    assert max(per_pass) <= 15 and sum(per_pass) == 2 * len(names)


# The publisher. Keyframes are tested above; here they are switched off so each pass stores only what the case causes.


@pytest.fixture(autouse=True)
def no_keyframes(request, monkeypatch):
    if "context" in request.fixturenames:
        monkeypatch.setattr(ingestor, "readback_keyframe_due", lambda *_args: False)


@pytest.mark.asyncio
async def test_unchanged_pass_stores_no_readback_but_confirms_all_and_marks_the_pass(context):  # noqa: F811
    values, connection, pool = context
    await publish(pool, T0)
    assert stored_names(connection) == set(values)
    connection.events.clear()
    await publish(pool, T0 + timedelta(seconds=60))
    assert connection.rows == []
    assert {name for name, _value, _tol in connection.confirmations} == set(values)
    assert connection.events[:5] == ["begin", "insert", "confirm", "pass", "commit"]
    marker = connection.passes[-1]
    assert marker[0] == T0 + timedelta(seconds=60) and marker[1] == ingestor.READBACK_PASS_ENTITY
    assert marker[2] == f"stored=0 of={len(values)}"
    # Everything is still fanned out.
    assert connection.events.count("fanout") == len(values)


@pytest.mark.asyncio
async def test_a_changed_value_is_stored_alone(context):  # noqa: F811
    values, connection, pool = context
    await publish(pool, T0)
    values["mister_all_kpa"] = 1.5
    await publish(pool, T0 + timedelta(seconds=60))
    assert connection.rows == [(T0 + timedelta(seconds=60), "mister_all_kpa", 1.5)]


@pytest.mark.asyncio
async def test_a_write_that_repeats_the_current_value_gets_its_confirming_row(context):  # noqa: F811
    values, connection, pool = context
    await publish(pool, T0)
    connection.writes = [("mister_all_kpa", T0 + timedelta(seconds=30))]
    await publish(pool, T0 + timedelta(seconds=60))
    assert connection.rows == [(T0 + timedelta(seconds=60), "mister_all_kpa", 1.25)]
    assert ("mister_all_kpa", 1.25, 0.0) in connection.confirmations
    # The next pass, with the same write still in the lookup, stores nothing: the row is newer than the write.
    await publish(pool, T0 + timedelta(seconds=120))
    assert connection.rows == []


@pytest.mark.asyncio
async def test_a_failed_write_lookup_fails_the_pass_and_stores_nothing(context):  # noqa: F811
    """DISPATCHER-06: no dense fallback. The pass fails like any DB error and the next pass retries."""
    _values, connection, pool = context
    await publish(pool, T0)
    connection.rows = []
    connection.fail_writes = True
    with pytest.raises(RuntimeError):
        await publish(pool, T0 + timedelta(seconds=60))
    assert stored_names(connection) == set()


@pytest.mark.asyncio
async def test_a_reconnect_stores_every_readback(context, monkeypatch):  # noqa: F811
    values, connection, pool = context
    await publish(pool, T0)
    monkeypatch.setattr(shared, "transport_generation", 4)
    monkeypatch.setattr(shared, "transport_readbacks_generation", 4)
    monkeypatch.setattr(shared, "cfg_readback_generation", dict.fromkeys(values, 4))
    await publish(pool, T0 + timedelta(seconds=60))
    assert stored_names(connection) == set(values)


@pytest.mark.asyncio
async def test_a_partial_cache_at_reconnect_still_gives_every_parameter_a_post_boot_row(context, monkeypatch):  # noqa: F811
    values, connection, pool = context
    await publish(pool, T0)
    # Reconnect: the cache is cleared and the controller replays its states over the next seconds.
    full = dict(values)
    late = sorted(full)[: len(full) // 2]
    monkeypatch.setattr(shared, "transport_generation", 4)
    monkeypatch.setattr(shared, "transport_readbacks_generation", 4)
    monkeypatch.setattr(shared, "cfg_readback_generation", dict.fromkeys(full, 4))
    for name in late:
        del values[name]
    await publish(pool, T0 + timedelta(seconds=60))
    assert stored_names(connection) == set(full) - set(late)
    # The rest arrive with the values they had before the reconnect: each still gets its post-boot row.
    values.update({name: full[name] for name in late})
    await publish(pool, T0 + timedelta(seconds=120))
    assert stored_names(connection) == set(late)
    await publish(pool, T0 + timedelta(seconds=180))
    assert connection.rows == []


@pytest.mark.asyncio
async def test_a_clamped_write_stores_what_the_controller_reads_back(context):  # noqa: F811
    values, connection, pool = context
    await publish(pool, T0)
    # Asked for 2.0; the controller clamps and keeps 1.25. The row after the write is the readback, and the
    # confirmation runs against 1.25, which the request's 2.0 does not match, so it stays unconfirmed.
    connection.writes = [("mister_all_kpa", T0 + timedelta(seconds=30))]
    await publish(pool, T0 + timedelta(seconds=60))
    assert connection.rows == [(T0 + timedelta(seconds=60), "mister_all_kpa", 1.25)]
    assert ("mister_all_kpa", 1.25, 0.0) in connection.confirmations
    # Clamped to a new value instead: stored at once as a change.
    values["mister_all_kpa"] = 1.75
    await publish(pool, T0 + timedelta(seconds=120))
    assert connection.rows == [(T0 + timedelta(seconds=120), "mister_all_kpa", 1.75)]


@pytest.mark.asyncio
async def test_only_a_pass_that_stored_every_canonical_field_serves_a_writer_admission(context):  # noqa: F811
    values, connection, pool = context
    now = datetime.now(UTC)
    await publish(pool, now - timedelta(seconds=60))  # first pass after a restart stores every readback
    assert shared.setpoint_snapshot_is_current(3)
    values["mister_all_kpa"] = 1.5
    await publish(pool, now)
    assert stored_names(connection) == {"mister_all_kpa"}
    assert not shared.setpoint_snapshot_is_current(3)  # a request would ask for a complete batch
    await publish(pool, now, reason="writer_admission")  # dormant in production (no caller)
    assert stored_names(connection) == set(values)
    assert shared.setpoint_snapshot_is_current(3)


# The readers.


def test_dashboard_freshness_is_the_pass_or_the_newest_readback():
    from verdify_services import reads

    clock = " ".join(reads._CLOCK_SQL.split())
    assert "GREATEST((SELECT max(ts) FROM setpoint_snapshot" in clock
    assert f"entity = '{ingestor.READBACK_PASS_ENTITY}' AND ts > now() - interval '1 day'" in clock
    assert ") AS readback_at" in clock


def test_smoke_reads_the_pass_and_the_newest_row_of_each_canonical_field():
    smoke = (ROOT / "scripts/k3s-smoke.sh").read_text()
    assert f"entity='{ingestor.READBACK_PASS_ENTITY}'" in smoke
    assert "SELECT DISTINCT ON (parameter) parameter FROM setpoint_snapshot" in smoke
    assert "ts>now()-interval '2 hours'" in smoke
    # Review F1: the expected count is the canonical fields the controller still reads back (the third flash keeps
    # THIRD_FLASH_INERT_WIRE_REG as inert wire slots with no readback), so the check passes on the law build and the
    # third flash alike.
    assert '[ "${snapshot_count}" = "${expected_fields}" ]' in smoke
    assert "if n not in THIRD_FLASH_INERT_WIRE_REG" in smoke
    assert '= "48" ]' not in smoke and "len(CANONICAL_FIELD_ORDER) == 48" not in smoke
    assert "HAVING count(DISTINCT parameter)=48" not in smoke


def test_replay_consumer_merges_batches():
    script = (ROOT / "scripts/export-replay-overrides.sh").read_text()
    assert 'config.update(json.loads(current_sp["config_payload"]))' in script
    assert 'config = json.loads(current_sp["config_payload"])' not in script


def test_grow_light_states_keyframe_every_ten_minutes(monkeypatch):
    monkeypatch.setattr(ingestor, "_light_state_stored_at", {})
    assert ingestor.light_state_keyframe_due("gl_main_state", 1000.0)
    ingestor._light_state_stored_at["gl_main_state"] = 1000.0
    assert not ingestor.light_state_keyframe_due("gl_main_state", 1599.0)
    assert ingestor.light_state_keyframe_due("gl_main_state", 1600.0)
    assert not ingestor.light_state_keyframe_due("gl_main_reason", 1000.0)  # reasons are forced, not keyframed
    source = (ROOT / "ingestor/ingestor.py").read_text()
    forced = source.split("force_refresh = entity in {", 1)[1].split("}", 1)[0]
    assert '"gl_main_reason"' in forced and '"gl_grow_reason"' in forced
    assert '"gl_main_state"' not in forced and '"gl_grow_state"' not in forced


def test_alert_windows_hold_sparse_readbacks():
    source = (ROOT / "ingestor/tasks/alerts.py").read_text()
    safety = source.split("# 8. Safety value sanity check", 1)[1].split('"""', 2)[1]
    assert "ts > now() - interval '2 hours'" in safety
    # Zero variance needs a week of keyframes (>= 24 rows, the oldest over 6 days), not 100 dense rows.
    assert "HAVING min(ts) < now() - interval '6 days' AND count(*) >= 24" in source
    assert "count(*) > 100" not in source
    zero = source.split("SELECT parameter, count(*) AS n, stddev(value) AS sd", 1)[1].split("alerts.append", 1)[0]
    # K1: the legacy band scalars are left out while the controller runs its own band; still a warning.
    assert "AND NOT (parameter = ANY($2::text[])" in zero and "list(LEGACY_BAND_SCALARS)" in zero
    assert "list(ONCHIP_BAND_SOURCES)" in zero and "band_role IS NULL" in zero
    # fn_heat_staging_inversion's 10-minute readback window is often empty now: its message tolerates no temp_low.
    assert 'if staging_row["temp_low"] is not None' in source


# The irrigation and lighting acceptance scripts on keyframe-only history (#1662 review MAJOR-2, MAJOR-3).


def _load_script(name: str):
    import importlib.util

    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _window_s(sql: str) -> float:
    import re

    number, unit = re.search(r"interval '(\d+) (minutes|hours)'", sql).groups()
    return int(number) * (60 if unit == "minutes" else 3600)


def test_lighting_audit_sees_a_readback_whose_keyframe_is_fifty_minutes_old(monkeypatch):
    audit = _load_script("audit-lighting-automation")
    ages = dict.fromkeys(audit.CFG_READBACK_PARAMS, 50 * 60)  # every row is a keyframe 50 min old
    ages[audit.CFG_READBACK_PARAMS[0]] = 3 * 3600  # one parameter has no row in the last keyframe gap

    def psql_json(sql, timeout=30):
        window = _window_s(sql)
        return [{"parameter": name} for name, age in ages.items() if age < window]

    monkeypatch.setattr(audit, "psql_json", psql_json)
    assert audit.live_cfg_readback_params() == set(audit.CFG_READBACK_PARAMS[1:])


def test_irrigation_stack_check_takes_freshness_from_the_pass_and_rows_from_two_hours():
    stack = _load_script("validate-irrigation-stack")
    n = str(len(stack.IRRIGATION_SCHEDULE_PARAMS))
    assert stack._schedule_cfg_readbacks_verdict(n, n, "a", "b", "-", "42").status == "pass"
    assert stack._schedule_cfg_readbacks_verdict(n, n, "a", "b", "-", "900").status == "fail"  # no pass for 15 min
    assert stack._schedule_cfg_readbacks_verdict(n, n, "a", "b", "-", "-").status == "fail"
    short = str(len(stack.IRRIGATION_SCHEDULE_PARAMS) - 1)
    assert stack._schedule_cfg_readbacks_verdict(n, short, "a", "b", "-", "42").status == "fail"


def test_irrigation_stack_check_reads_the_pass_marker_and_a_two_hour_window(monkeypatch):
    stack = _load_script("validate-irrigation-stack")
    seen = []

    def psql(sql, *, direct_db=False):
        seen.append(sql)
        n = str(len(stack.IRRIGATION_SCHEDULE_PARAMS))
        return [[n, n, "a", "b", "-", "30"]]

    monkeypatch.setattr(stack, "_psql", psql)
    assert stack._check_schedule_cfg_readbacks(True).status == "pass"
    assert "entity = 'setpoint_snapshot_pass'" in seen[0] and "l.ts >= now() - interval '2 hours'" in seen[0]
