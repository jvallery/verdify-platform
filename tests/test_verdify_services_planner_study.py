"""#1360: the planner study's run with no database: placement (start, pause, resume, stop, finish), the hold plan for
each arm, API-28's checks and one runner sweep. The service writes only through ``settings.write``/``release`` and
``activity.recorded_write``, which these tests replace with recorders."""

import asyncio
import json
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest
import yaml

from verdify_schemas.activity import ACTIVITY_ACTION_PATTERN
from verdify_schemas.planner_study import (
    STUDY_DIR,
    STUDY_FILES,
    arm_order,
    baseline_sha256,
    parse_study,
    schedule_sha256,
)
from verdify_services import planner_study as ps
from verdify_services import settings
from verdify_services.problems import ServiceError, problem

SEED = 1360
TEXT = (STUDY_DIR / STUDY_FILES["planner-ab-winter-2026"]).read_text()
# A baseline inside every field's current bounds (Start checks it): each field's lower bound, else 0.
BASELINE = {name: settings.bounds(name)[0] or 0.0 for name in ps.FIELDS}


def study(pairs: int = 30):
    data = yaml.safe_load(TEXT)
    data["schedule"].update(seed=SEED, schedule_sha256=schedule_sha256(SEED, pairs), pairs=pairs)
    data["baseline_vector"]["sha256"] = baseline_sha256(BASELINE)
    data["analysis"]["looks"] = [{"pairs": pairs, "purpose": "final"}]
    return parse_study(yaml.safe_dump(data, sort_keys=False))


STUDY = study()
SHORT = study(pairs=2)
RUN_ID = "00000000-0000-4000-8000-000000001360"


def at(day: int, hour: int = 12, month: int = 11) -> datetime:
    """A local time on 2026-<month>-<day> (MST, UTC-7)."""
    return datetime(2026, month, day, hour + 7, tzinfo=UTC)


def start(first: date, when: datetime, pairs: int = 30) -> ps.Control:
    detail = {
        "run_id": RUN_ID,
        "first_day": first.isoformat(),
        "pairs": pairs,
        "seed": SEED,
        "schedule_sha256": schedule_sha256(SEED, pairs),
        "baseline_sha256": baseline_sha256(BASELINE),
    }
    return ps.Control("start", when, detail, "jason")


def control(action, when, reason=None):
    return ps.Control(action, when, {"run_id": RUN_ID}, "jason", reason)


# ── placement ───────────────────────────────────────────────────────────────


def test_no_start_is_no_run():
    assert ps.place(STUDY, [], at(10)) is None


def test_a_started_run_is_scheduled_until_day_one_then_places_pairs_back_to_back():
    controls = [start(date(2026, 11, 10), at(8))]
    run = ps.place(STUDY, controls, at(9))
    assert run.status == "scheduled" and run.day_at(at(9)) is None
    assert run.next_boundary(at(9)) == at(10, 11)
    assert len(run.days) == 60 and run.days[0].date == date(2026, 11, 10) and run.days[-1].date == date(2027, 1, 8)
    order = arm_order(SEED, 30)
    assert [(day.arm) for day in run.days[:4]] == [*order[0], *order[1]]
    # Each day runs 11:00 to 11:00 local.
    assert run.days[0].starts_at == at(10, 11) and run.days[0].ends_at == at(11, 11)
    running = ps.place(STUDY, controls, at(11, 12))
    assert running.status == "running"
    assert [day.status for day in running.days[:3]] == ["done", "active", "scheduled"]
    assert running.day_at(at(11, 12)).arm == order[0][1]


def test_a_pause_mid_pair_voids_the_pair_and_the_resume_runs_it_again_in_its_own_order():
    controls = [start(date(2026, 11, 10), at(8)), control("pause", at(11, 15))]
    paused = ps.place(STUDY, controls, at(12))
    assert paused.status == "paused" and paused.day_at(at(12)) is None
    assert [(day.date, day.status, day.reason) for day in paused.days] == [
        (date(2026, 11, 10), "void", "paused"),
        (date(2026, 11, 11), "void", "paused"),
    ]
    resumed = ps.place(STUDY, [*controls, control("resume", at(13, 12))], at(14, 12))
    # The resume at 12:00 on the 13th starts at the next boundary, 11:00 on the 14th, with pair 0 again.
    live = [day for day in resumed.days if day.status != "void"]
    assert live[0].date == date(2026, 11, 14) and live[0].pair_index == 0
    assert [day.arm for day in live[:2]] == list(arm_order(SEED, 30)[0])
    assert resumed.status == "running" and resumed.day_at(at(14, 12)).pair_index == 0
    assert len(live) == 60


def test_a_pause_at_a_pair_boundary_voids_nothing():
    controls = [start(date(2026, 11, 10), at(8)), control("pause", at(12, 11))]
    run = ps.place(STUDY, controls, at(12, 12))
    assert [day.status for day in run.days] == ["done", "done"]
    assert run.pairs_done == 1 and run.pairs_left == 29


def test_a_stop_ends_the_run_and_drops_the_days_not_run():
    controls = [start(date(2026, 11, 10), at(8)), control("stop", at(10, 15), "frost week")]
    run = ps.place(STUDY, controls, at(20))
    assert run.status == "stopped" and run.stop_reason == "frost week" and run.day_at(at(20)) is None
    assert [(day.date, day.status) for day in run.days] == [(date(2026, 11, 10), "void")]
    assert run.next_boundary(at(20)) is None


def test_the_run_finishes_after_its_last_pair():
    controls = [start(date(2026, 11, 10), at(8), pairs=2)]
    run = ps.place(SHORT, controls, at(14, 12))
    assert run.status == "finished" and run.pairs_done == 2 and run.day_at(at(14, 12)) is None


def test_a_dst_day_still_runs_boundary_to_boundary():
    run = ps.place(STUDY, [start(date(2026, 10, 31), at(30, 12, month=10))], at(5))
    first = run.days[0]  # 2026-10-31 11:00 MDT to 2026-11-01 11:00 MST spans the fall-back: 25 hours
    assert first.date == date(2026, 10, 31) and first.ends_at - first.starts_at == timedelta(hours=25)


# ── the hold plan ───────────────────────────────────────────────────────────


def desired(value, manual=True, source="system", actor="planner_study", row_id=1):
    return ps.Desired(row_id, value, manual, source, actor, at(10))


def test_a_baseline_day_holds_every_field_not_already_held_and_leaves_anothers_hold():
    current = {
        "dwell_gate_ms": desired(BASELINE["dwell_gate_ms"]),  # already held at the baseline value
        "mister_engage_kpa": desired(2.0, source="dashboard", actor="jason"),  # Jason holds it
        "vpd_hysteresis": desired(0.5, manual=False, source="iris", actor="iris"),  # not manual: overwritten
    }
    plan = ps.hold_plan("baseline", BASELINE, current)
    assert set(plan.hold) == set(ps.FIELDS) - {"dwell_gate_ms", "mister_engage_kpa"}
    assert plan.foreign == {"mister_engage_kpa": "dashboard:jason"} and plan.release == {}


def test_an_ai_day_releases_only_the_studys_own_holds():
    current = {
        "dwell_gate_ms": desired(BASELINE["dwell_gate_ms"], row_id=7),
        "mister_engage_kpa": desired(2.0, source="dashboard", actor="jason"),
        "vpd_hysteresis": desired(None, manual=False, row_id=8),  # already released
    }
    for arm in ("ai", None):
        plan = ps.hold_plan(arm, BASELINE, current)
        assert plan.release == {"dwell_gate_ms": 7} and plan.hold == {} and plan.foreign == {}


def test_request_keys_are_stable_per_run_day_and_field():
    one = ps.request_key(RUN_ID, "hold", date(2026, 11, 10), "dwell_gate_ms")
    assert one == ps.request_key(RUN_ID, "hold", date(2026, 11, 10), "dwell_gate_ms")
    assert one != ps.request_key(RUN_ID, "hold", date(2026, 11, 12), "dwell_gate_ms")


def test_the_study_actions_are_activity_actions():
    import re

    for action in ("study.start", "study.pause", "study.resume", "study.stop", "study.boundary", "study.deviation"):
        assert re.fullmatch(ACTIVITY_ACTION_PATTERN, action)
    assert not re.fullmatch(ACTIVITY_ACTION_PATTERN, "study.reset")


# ── API-28 and the sweep, with recorders ────────────────────────────────────


class FakeConn:
    def __init__(self, now, rows=(), desired_rows=(), study_writes=()):
        self.now, self.rows, self.desired_rows = now, list(rows), list(desired_rows)
        self.study_writes = list(study_writes)

    async def fetchval(self, sql, *args):
        if "now()" in sql:
            return self.now
        return True

    async def fetch(self, sql, *args):
        if "FROM activity_log" in sql:
            return self.rows
        if "GROUP BY param" in sql:
            return self.study_writes
        if "v_desired_state_current" in sql and "source = $1" in sql:
            return [
                row for row in self.desired_rows if (row["source"], row["actor"]) == args and row["value"] is not None
            ]
        if "v_desired_state_current" in sql:
            return self.desired_rows
        raise AssertionError(sql)

    async def execute(self, sql, *args):
        return "SELECT 1"

    def log(self, action, when, detail, actor="jason", reason=None):
        self.rows.append(
            {
                "id": len(self.rows) + 1,
                "ts": when,
                "source": "dashboard",
                "actor": actor,
                "action": f"study.{action}",
                "target": STUDY.study_id,
                "detail": json.dumps(detail),
                "reason": reason,
            }
        )


@pytest.fixture
def recorded(monkeypatch):
    calls = []

    async def recorded_write(conn, actor, *, op, action, target, request, request_id, reason, perform, load, lock=None):
        if lock is not None:
            await lock(conn)
        value, detail = await perform(conn)
        calls.append((action, target, detail, reason))
        return SimpleNamespace(value=value, replayed=False)

    async def append(conn, actor, *, action, target, detail=None, reason=None, **_):
        # only ever called inside a recorded_write's perform: the same transaction as the row recorded after it
        calls.append((action, target, {**(detail or {}), "same_transaction_as_next": True}, reason))
        return len(calls)

    monkeypatch.setattr(ps.activity, "recorded_write", recorded_write)
    monkeypatch.setattr(ps.activity, "append", append)
    monkeypatch.setattr(ps, "load_study", lambda study_id: STUDY)
    monkeypatch.setattr(ps, "load_baseline", lambda study: dict(BASELINE))
    return calls


JASON = ps.Actor.person("jason", "operator")


def test_start_records_the_run_and_its_commitments(recorded):
    conn = FakeConn(at(8))
    result = asyncio.run(ps.control(conn, JASON, STUDY.study_id, "start", first_day=date(2026, 11, 10), reason="go"))
    ((action, target, detail, reason),) = recorded
    assert (action, target, reason) == ("study.start", "planner-ab-winter-2026", "go")
    assert detail["seed"] == SEED and detail["pairs"] == 30 and detail["ai_planner"] == "hermes"
    assert detail["schedule_sha256"] == schedule_sha256(SEED, 30) and detail["baseline_sha256"] == baseline_sha256(
        BASELINE
    )
    assert result.value.status == "scheduled" and result.value.first_day == date(2026, 11, 10)


@pytest.mark.parametrize(
    ("first_day", "desired_rows", "message"),
    [
        (date(2026, 11, 8), [], "has passed"),
        (None, [], "needs first_day"),
        (
            date(2026, 11, 10),
            [
                {
                    "id": 1,
                    "param": "dwell_gate_ms",
                    "value": 1.0,
                    "manual": True,
                    "source": "dashboard",
                    "actor": "jason",
                    "created_at": at(7),
                }
            ],
            "dwell_gate_ms (dashboard:jason)",
        ),
    ],
)
def test_start_refuses_a_past_day_no_day_and_a_held_setting(recorded, first_day, desired_rows, message):
    conn = FakeConn(at(8, 12), desired_rows=desired_rows)
    with pytest.raises(ServiceError) as raised:
        asyncio.run(ps.control(conn, JASON, STUDY.study_id, "start", first_day=first_day))
    assert message in (raised.value.problem.detail or "")
    assert recorded == []


def test_start_refuses_an_unregistered_study(recorded, monkeypatch):
    monkeypatch.setattr(ps, "load_study", lambda study_id: parse_study(TEXT))
    with pytest.raises(ServiceError) as raised:
        asyncio.run(ps.control(FakeConn(at(8)), JASON, STUDY.study_id, "start", first_day=date(2026, 11, 10)))
    assert raised.value.problem.code == "study_state" and "pre-registered" in raised.value.problem.detail


def test_pause_resume_and_stop_follow_the_run_state(recorded):
    conn = FakeConn(at(11, 12))
    conn.log("start", at(8), start(date(2026, 11, 10), at(8)).detail)
    with pytest.raises(ServiceError):
        asyncio.run(ps.control(conn, JASON, STUDY.study_id, "resume"))
    paused = asyncio.run(ps.control(conn, JASON, STUDY.study_id, "pause", reason="storm"))
    assert paused.value.status == "paused"
    conn.log("pause", at(11, 12), {"run_id": RUN_ID})
    with pytest.raises(ServiceError) as raised:
        asyncio.run(ps.control(conn, JASON, STUDY.study_id, "start", first_day=date(2026, 11, 20)))
    assert "stop it before" in raised.value.problem.detail
    stopped = asyncio.run(ps.control(conn, JASON, STUDY.study_id, "stop"))
    assert stopped.value.status == "stopped"
    assert [call[0] for call in recorded] == ["study.pause", "study.stop"]


@pytest.fixture
def writes(monkeypatch, recorded):
    calls = []

    refuse: dict[str, Exception] = {}

    async def write(conn, actor, param, value, manual, reason, key, extra_detail=None, expected_id=None):
        if param in refuse:
            raise refuse[param]
        calls.append(("hold", param, value, manual, actor.name, key, expected_id))

    async def release(conn, actor, param, reason, key, extra_detail=None, expected_id=None):
        if param in refuse:
            raise refuse[param]
        calls.append(("release", param, key))

    states = {}

    async def statuses(conn, params):
        return {name: SimpleNamespace(state=states.get(name, "confirmed")) for name in params}

    monkeypatch.setattr(ps.settings, "write", write)
    monkeypatch.setattr(ps.settings, "release", release)
    monkeypatch.setattr(ps.settings, "statuses", statuses)
    return SimpleNamespace(calls=calls, states=states, rows=recorded, refuse=refuse)


def baseline_day_conn(now):
    """A run whose first day (2026-11-10) is a baseline day for seed 1360, or the first AI day."""
    conn = FakeConn(now)
    conn.log("start", at(8), start(date(2026, 11, 10), at(8)).detail)
    return conn


def test_a_baseline_boundary_holds_all_48_then_records_it_confirmed(writes):
    order = arm_order(SEED, 30)
    day = 10 if order[0][0] == "baseline" else 11
    conn = baseline_day_conn(at(day, 11) + timedelta(minutes=1))
    result = asyncio.run(ps.sweep(conn, STUDY.study_id))
    assert result.arm == "baseline" and result.held == 48
    assert {call[3] for call in writes.calls} == {True} and {call[4] for call in writes.calls} == {"planner_study"}
    assert [row[0] for row in writes.rows] == ["study.boundary"] and writes.rows[0][2]["result"] == "confirmed"


def test_an_unsettled_boundary_waits_then_records_one_deviation(writes):
    order = arm_order(SEED, 30)
    day = 10 if order[0][0] == "baseline" else 11
    writes.states["dwell_gate_ms"] = "requested"
    early = asyncio.run(ps.sweep(baseline_day_conn(at(day, 11) + timedelta(minutes=5)), STUDY.study_id))
    assert early.boundary is None and writes.rows == []
    late = held_conn(day, at(day, 11) + timedelta(minutes=16), held=at(day, 11) + timedelta(minutes=1))
    assert asyncio.run(ps.sweep(late, STUDY.study_id)).boundary == "unconfirmed"
    # the deviation and its boundary commit in one transaction
    assert [row[0] for row in writes.rows] == ["study.deviation", "study.boundary"]
    assert writes.rows[0][2]["fields"] == ["dwell_gate_ms"] and writes.rows[0][2]["same_transaction_as_next"]


def test_a_recorded_boundary_is_not_recorded_again(writes):
    order = arm_order(SEED, 30)
    day = 10 if order[0][0] == "baseline" else 11
    conn = baseline_day_conn(at(day, 12))
    conn.rows.append(
        {
            "id": 99,
            "ts": at(day, 11),
            "source": "system",
            "actor": "planner_study",
            "action": "study.boundary",
            "target": STUDY.study_id,
            "reason": None,
            "detail": json.dumps(
                {"run_id": RUN_ID, "date": f"2026-11-{day}", "arm": "baseline", "result": "confirmed"}
            ),
        }
    )
    assert asyncio.run(ps.sweep(conn, STUDY.study_id)).boundary is None and writes.rows == []


def test_a_paused_run_releases_the_studys_holds(writes):
    conn = baseline_day_conn(at(12))
    conn.log("pause", at(11, 15), {"run_id": RUN_ID})
    conn.desired_rows = [
        {
            "id": 41,
            "param": "dwell_gate_ms",
            "value": 1.0,
            "manual": True,
            "source": "system",
            "actor": "planner_study",
            "created_at": at(10, 11),
        },
        {
            "id": 42,
            "param": "mister_engage_kpa",
            "value": 2.0,
            "manual": True,
            "source": "dashboard",
            "actor": "jason",
            "created_at": at(10, 12),
        },
    ]
    result = asyncio.run(ps.sweep(conn, STUDY.study_id))
    assert result.arm is None and result.released == 1
    assert writes.calls == [("release", "dwell_gate_ms", ps.request_key(ps.UUID(RUN_ID), "release", 41))]


def held_conn(day, now, *, held, extra_rows=()):
    """A baseline day whose 48 study holds went in at ``held``."""
    conn = baseline_day_conn(now)
    conn.desired_rows = [
        {
            "id": 100 + index,
            "param": name,
            "value": BASELINE[name],
            "manual": True,
            "source": "system",
            "actor": "planner_study",
            "created_at": held,
        }
        for index, name in enumerate(ps.FIELDS)
    ]
    conn.desired_rows = [row for row in conn.desired_rows if row["param"] not in {r["param"] for r in extra_rows}]
    conn.desired_rows += list(extra_rows)
    conn.study_writes = [{"param": name, "held_at": held, "wrote_at": held} for name in ps.FIELDS]
    return conn


def baseline_day():
    return 10 if arm_order(SEED, 30)[0][0] == "baseline" else 11


def ai_day():
    return 11 if baseline_day() == 10 else 10


# ── review fixes (#1495) ────────────────────────────────────────────────────


def test_the_studys_own_release_reads_released_and_settles_an_ai_day_only():
    """No statuses stub: settings.evaluate on the study's release row, and on a plan over a desired value."""
    spec = settings.REGISTRY["dwell_gate_ms"]
    release_row = {"id": 1, "value": None, "manual": False, "created_at": at(10)}
    state = settings.evaluate(spec, settings._Facts(desired=release_row), None).state
    assert state == "released"
    assert state in ps.settled_states("ai") and state not in ps.settled_states("baseline")
    assert "overridden" in ps.settled_states("ai") and "overridden" not in ps.settled_states("baseline")


def test_an_ai_day_with_its_holds_released_records_a_confirmed_boundary(writes):
    day = ai_day()
    conn = baseline_day_conn(at(day, 11) + timedelta(minutes=2))
    for name in ps.FIELDS:
        writes.states[name] = "released"
    result = asyncio.run(ps.sweep(conn, STUDY.study_id))
    assert result.arm == "ai" and result.boundary == "confirmed"
    assert [row[0] for row in writes.rows] == ["study.boundary"]


def test_a_hold_carries_the_row_it_replaces_in_its_key_and_its_guard(writes):
    day = baseline_day()
    conn = baseline_day_conn(at(day, 11) + timedelta(minutes=1))
    conn.desired_rows = [
        {
            "id": 77,
            "param": "dwell_gate_ms",
            "value": None,
            "manual": False,
            "source": "dashboard",
            "actor": "jason",
            "created_at": at(day - 1),
        }
    ]
    asyncio.run(ps.sweep(conn, STUDY.study_id))
    hold = next(call for call in writes.calls if call[1] == "dwell_gate_ms")
    assert hold[6] == 77 and hold[5] == ps.request_key(
        ps.UUID(RUN_ID), "hold", date(2026, 11, day), "dwell_gate_ms", 77
    )
    other = next(call for call in writes.calls if call[1] == "vpd_hysteresis")
    assert other[6] == settings.NO_ROW


def test_a_write_over_the_days_hold_is_the_last_write_and_one_deviation(writes):
    day = baseline_day()
    held = at(day, 11) + timedelta(minutes=1)
    jason = {
        "id": 900,
        "param": "dwell_gate_ms",
        "value": None,
        "manual": False,
        "source": "dashboard",
        "actor": "jason",
        "created_at": held + timedelta(minutes=30),
    }
    conn = held_conn(day, at(day, 13), held=held, extra_rows=[jason])
    result = asyncio.run(ps.sweep(conn, STUDY.study_id))
    assert result.held == 0 and writes.calls == []
    deviations = [row for row in writes.rows if row[0] == "study.deviation"]
    assert [(row[2]["reason"], row[2]["field"]) for row in deviations] == [("released_by_other", "dwell_gate_ms")]
    # the boundary is judged on the fields the study still holds
    assert [row[0] for row in writes.rows][-1] == "study.boundary" and writes.rows[-1][2]["result"] == "confirmed"


def test_a_refused_or_superseded_hold_is_a_deviation_and_the_sweep_goes_on(writes):
    day = baseline_day()
    writes.refuse["dwell_gate_ms"] = settings.Superseded("dwell_gate_ms", settings.NO_ROW, None)
    writes.refuse["vpd_hysteresis"] = ServiceError(problem("out_of_range", "Must be 0.05 to 0.5", field="value"))
    result = asyncio.run(ps.sweep(baseline_day_conn(at(day, 11) + timedelta(minutes=1)), STUDY.study_id))
    assert result.held == 46 and sorted(result.refused) == ["dwell_gate_ms", "vpd_hysteresis"]
    reasons = sorted((row[2]["reason"], row[2]["field"]) for row in writes.rows if row[0] == "study.deviation")
    assert reasons == [("hold_refused", "dwell_gate_ms"), ("hold_refused", "vpd_hysteresis")]


def test_a_superseded_release_is_left_to_whoever_wrote_last(writes):
    conn = baseline_day_conn(at(12))
    conn.log("pause", at(11, 15), {"run_id": RUN_ID})
    conn.desired_rows = [
        {
            "id": 41,
            "param": "dwell_gate_ms",
            "value": BASELINE["dwell_gate_ms"],
            "manual": True,
            "source": "system",
            "actor": "planner_study",
            "created_at": at(10, 11),
        }
    ]
    writes.refuse["dwell_gate_ms"] = settings.Superseded("dwell_gate_ms", 41, None)
    result = asyncio.run(ps.sweep(conn, STUDY.study_id))
    assert result.released == 0 and result.refused == [] and writes.rows == []


def test_the_confirm_window_runs_from_the_days_newest_study_write(writes):
    day = baseline_day()
    start_at = at(day, 11)
    writes.states["dwell_gate_ms"] = "requested"
    late_hold = start_at + timedelta(minutes=10)
    waiting = held_conn(day, start_at + timedelta(minutes=20), held=late_hold)
    assert asyncio.run(ps.sweep(waiting, STUDY.study_id)).boundary is None and writes.rows == []
    done = held_conn(day, start_at + timedelta(minutes=26), held=late_hold)
    assert asyncio.run(ps.sweep(done, STUDY.study_id)).boundary == "unconfirmed"


def test_start_refuses_a_desired_value_and_a_baseline_outside_the_bounds(recorded, monkeypatch):
    row = {
        "id": 3,
        "param": "vpd_hysteresis",
        "value": 0.2,
        "manual": False,
        "source": "iris",
        "actor": "iris",
        "created_at": at(7),
    }
    with pytest.raises(ServiceError) as raised:
        asyncio.run(
            ps.control(
                FakeConn(at(8), desired_rows=[row]), JASON, STUDY.study_id, "start", first_day=date(2026, 11, 10)
            )
        )
    assert "carry a desired value: vpd_hysteresis (iris:iris)" in raised.value.problem.detail
    monkeypatch.setattr(ps, "load_baseline", lambda study: {**BASELINE, "vpd_hysteresis": 9.0})
    with pytest.raises(ServiceError) as raised:
        asyncio.run(ps.control(FakeConn(at(8)), JASON, STUDY.study_id, "start", first_day=date(2026, 11, 10)))
    assert raised.value.problem.code == "study_state" and "vpd_hysteresis=9" in raised.value.problem.detail
    assert recorded == []


def test_release_stranded_releases_every_study_hold_not_kept(writes):
    conn = FakeConn(at(12))
    conn.desired_rows = [
        {
            "id": 5,
            "param": "dwell_gate_ms",
            "value": 1.0,
            "manual": True,
            "source": "system",
            "actor": "planner_study",
            "created_at": at(9),
        },
        {
            "id": 6,
            "param": "retired_field",
            "value": 1.0,
            "manual": True,
            "source": "system",
            "actor": "planner_study",
            "created_at": at(9),
        },
        {
            "id": 7,
            "param": "vpd_hysteresis",
            "value": 0.2,
            "manual": True,
            "source": "system",
            "actor": "planner_study",
            "created_at": at(9),
        },
        {
            "id": 8,
            "param": "mister_engage_kpa",
            "value": 2.0,
            "manual": True,
            "source": "dashboard",
            "actor": "jason",
            "created_at": at(9),
        },
    ]
    released = asyncio.run(ps.release_stranded(conn, {"vpd_hysteresis"}))
    assert released == ["dwell_gate_ms", "retired_field"]


def test_a_failed_study_sweep_keeps_nothing_so_its_holds_are_released(writes, monkeypatch):
    def broken(study_id):
        raise KeyError(study_id)

    monkeypatch.setattr(ps, "load_study", broken)
    conn = FakeConn(at(12))
    conn.desired_rows = [
        {
            "id": 5,
            "param": "dwell_gate_ms",
            "value": 1.0,
            "manual": True,
            "source": "system",
            "actor": "planner_study",
            "created_at": at(9),
        },
    ]
    results, stranded = asyncio.run(ps.locked_sweep_all(conn, [STUDY.study_id]))
    assert isinstance(results[STUDY.study_id], KeyError) and stranded == ["dwell_gate_ms"]


def test_the_runner_switch(monkeypatch):
    from api.operator_routes import planner_study_runner as runner

    monkeypatch.setenv(runner.ENABLED_ENV, "false")
    assert not runner.enabled()
    asyncio.run(asyncio.wait_for(runner.Runner().run(None, interval_s=0), 1))  # returns at once, sweeps nothing
    monkeypatch.delenv(runner.ENABLED_ENV)
    assert runner.enabled()


class GuardTx:
    def __init__(self, newest):
        self.newest, self.sql = newest, []

    async def execute(self, sql, *args):
        self.sql.append(sql)

    async def fetchrow(self, sql, *args):
        return self.newest


def test_a_guarded_desired_write_locks_the_setting_then_refuses_a_newer_row():
    tx = GuardTx({"id": 9, "source": "dashboard", "actor": "jason"})
    asyncio.run(settings._lock_and_guard(tx, "dwell_gate_ms", 9))
    assert "pg_advisory_xact_lock" in tx.sql[0]
    with pytest.raises(settings.Superseded):
        asyncio.run(settings._lock_and_guard(tx, "dwell_gate_ms", 8))
    asyncio.run(settings._lock_and_guard(GuardTx(None), "dwell_gate_ms", settings.NO_ROW))
    unguarded = GuardTx(None)
    asyncio.run(settings._lock_and_guard(unguarded, "dwell_gate_ms", None))
    assert len(unguarded.sql) == 1
