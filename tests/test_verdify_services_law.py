"""API-30 and API-31 shaping (verdify_services.law), against the law's real records.

Pure unit tests: no database. The records are production samples (2026-11-16/17): the newest record
``{"v":1,"l":128,"o":0,"dr":"none","e":0.633,"lim":0.7,"br":0,"b":[67.4,79.4,0.81,1.34]}``, a drying run
(l=449, o=293, dr=none), a run refused on cost (l=193, o=1, dr=cost, e=0.82, lim=0.7), and the drying meter
``{"v":1,"s":120,"g":247,"wh":177,"rw":22440}``. The service reads run against a scripted connection that answers by
SQL fragment, so the tests also check every statement is bounded by entity and time.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import get_args

import pytest

from verdify_schemas import climate_law_constants as K
from verdify_services import law, reads, series
from verdify_services.problems import ServiceError

ROOT = Path(__file__).resolve().parents[1]
AT = datetime(2026, 11, 17, 16, 20, 30, tzinfo=UTC)
BAND = [67.4, 79.4, 0.81, 1.34]
HASH = "4250fb1da7d5460388c144f8124dfcc736e0e49077a5cb34496eff3a17120be6"


def record(l: int, o: int, dr: str = "none", e: float | None = 0.633, lim: float = 0.7, br: int = 0) -> str:  # noqa: E741
    return json.dumps({"v": 1, "l": l, "o": o, "dr": dr, "e": e, "lim": lim, "br": br, "b": BAND})


IDLE = record(128, 0)  # the newest production record: outdoor air drier, nothing requested
RUNNING = record(449, 293)  # run + air + dry + h1; heat1 + vent + one fan + drying
REFUSED_COST = record(193, 1, dr="cost", e=0.82)  # air + dry + h1; heat1; refused on cost
METER = '{"v":1,"s":120,"g":247,"wh":177,"rw":22440}'


def view_row(**overrides):
    row = {
        "at": AT,
        "law_value": IDLE,
        "law_at": AT - timedelta(seconds=30),
        "meter_value": METER,
        "meter_at": AT - timedelta(minutes=27),
        "constants_value": HASH,
        "constants_at": AT - timedelta(minutes=46),
        "outdoor_source": "station",
        "outdoor_source_at": AT - timedelta(seconds=87),
        "heartbeat_at": AT - timedelta(seconds=53),
        "climate_at": AT - timedelta(seconds=40),
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
        "host_vpd_low": 0.812,
        "host_vpd_high": 1.338,
        "band_source": "onchip_curve",
        "sntp_valid": 1,
        "last_sntp_sync_age_s": 691,
        "active_probe_count": 4,
        "sensor_degraded_active": 0,
        "gap_log_state": "armed",
        "uptime_s": 35163,
        "uptime_at": AT - timedelta(seconds=1),
        "lead_fan": None,
        "fog_block_reason": "none",
        "today": {
            "drying_s": 129.8,
            "drying_runs": 1,
            "drying_water_g": 247,
            "drying_heat_wh": 177,
            "drying_meter_lower_bound": False,
        },
    }
    row.update(overrides)
    return row


def track(*states):
    """An equipment track from (seconds ago, state) runs, oldest first."""
    runs = [(AT - timedelta(seconds=ago), state) for ago, state in states]
    return reads.Track(spans=tuple(reads.collapse(runs)), newest_at=runs[-1][0])


def tracks(**by_relay):
    base = {relay: track((7200, False)) for relay in (*law.LAW_RELAYS, *law.MANUAL_RUN_RELAYS)}
    base.update(by_relay)
    return base


def rule(view, rule_id):
    return next(item for item in view.rules if item.id == rule_id)


def checks(view):
    return {check.id: check.ok for check in view.drying.checks}


# ── the guards: constants, bit order and the divergence rule come from one source ──


def test_lane_bit_order_is_the_firmwares():
    header = (ROOT / "firmware/lib/climate_law.h").read_text()
    latches = re.search(r"latch_bits\(const State& s\).*?bits\(\{(.*?)\}\)", header, re.S).group(1)
    requests = re.search(r"request_bits\(const Output& q\).*?bits\(\{(.*?)\}\)", header, re.S).group(1)
    assert [name.strip().removeprefix("s.") for name in latches.split(",")] == list(reads.LAW_LATCHES)
    words = [" ".join(name.split()).removeprefix("q.") for name in requests.split(",")]
    assert words == ["heat1", "heat2", "vent", "fog", "mist", "fans >= 1", "fans >= 2", "cooling", "drying", "hot",
                     "cold"]  # fmt: skip
    assert [key for key, _, _ in law.LANES] == [f"request.{n}" for n in reads.LAW_REQUESTS] + [
        f"latch.{n}" for n in reads.LAW_LATCHES
    ]


def test_the_band_differs_tolerance_is_the_alerts():
    source = (ROOT / "ingestor/tasks/coverage_alerts.py").read_text()
    assert float(re.search(r"^LAW_BAND_TEMP_F = (.+)$", source, re.M).group(1)) == law.BAND_DIFFERS_TEMP_F
    assert float(re.search(r"^LAW_BAND_VPD_KPA = (.+)$", source, re.M).group(1)) == law.BAND_DIFFERS_VPD_KPA


def test_one_relay_minimum_time_for_heaters_fans_and_vent():
    assert K.HEAT_MIN_ON_S == K.FAN_MIN_ON_S == K.VENT_MIN_ON_S
    assert K.HEAT_MIN_OFF_S == K.FAN_MIN_OFF_S == K.VENT_MIN_OFF_S
    timing = law.timing()
    assert (timing.relay_min_on_s, timing.relay_min_off_s) == (K.HEAT_MIN_ON_S, K.HEAT_MIN_OFF_S)
    assert (timing.fog_min_on_s, timing.fog_min_off_s, timing.furnace_boot_wait_s) == (120, 120, 300)
    assert (timing.mist_pulse_s, timing.mist_gap_s, timing.hot_limit_f, timing.cold_limit_f) == (30, 60, 100.0, 40.0)


# ── API-30 ──────────────────────────────────────────────────────────────────


def test_the_newest_production_record_explained():
    view = law.law_view(view_row(), tracks(heat1=track((7200, False), (120, True))), None, False)
    assert view.reporting is True and view.observed_at == AT - timedelta(seconds=30)
    assert (view.band.temp_low_f, view.band.temp_high_f, view.band.vpd_low_kpa, view.band.vpd_high_kpa) == tuple(BAND)
    assert view.band.repaired is False and view.band.source == "onchip_curve" and view.band.differs is False
    assert [item.id for item in view.rules] == [
        "heat1", "heat2", "cooling", "second_fan", "fog", "mist", "drying", "hot_limit", "cold_limit"
    ]  # fmt: skip
    thresholds = {item.id: (item.on_at, item.off_at) for item in view.rules}
    assert thresholds["heat1"] == pytest.approx((70.9, 71.9))
    assert thresholds["heat2"] == pytest.approx((67.9, 70.4))
    assert thresholds["cooling"] == pytest.approx((79.4, 77.4))
    assert thresholds["second_fan"] == pytest.approx((80.9, 79.4))
    assert thresholds["fog"] == pytest.approx((1.34, 1.19))
    assert thresholds["mist"] == pytest.approx((1.64, 1.39))
    assert thresholds["drying"] == pytest.approx((0.86, 1.01))
    assert thresholds["hot_limit"] == (100.0, 100.0) and thresholds["cold_limit"] == (40.0, 40.0)
    assert all(item.latched is False and item.requested is False for item in view.rules)
    heat1 = rule(view, "heat1")
    assert heat1.relays[0].state == "on" and heat1.relays[0].since == AT - timedelta(seconds=120)
    # Not requested, on 120 s of its 300 s minimum on time: the host can prove 180 s more.
    assert heat1.hold == law.LawHold(kind="min_on", remaining_s=180)

    drying = view.drying
    assert (drying.state, drying.wanted, drying.outdoor_drier, drying.refused_reason) == (
        "not_wanted", False, True, "none"
    )  # fmt: skip
    assert (drying.cost_kwh_per_kg, drying.limit_kwh_per_kg, drying.limit_source) == (0.633, 0.7, "default")
    assert drying.wanted_below_kpa == pytest.approx(0.86) and drying.stop_above_kpa == pytest.approx(1.01)
    assert drying.min_temp_f == pytest.approx(68.9)
    assert checks(view) == {
        "humid": False,
        "outdoor_drier": True,
        "worth_it": True,
        "warm_enough": True,  # 70.65 F against 67.4 + 1.5
        "not_cooling": True,
        "furnace_off": True,
    }
    assert [check.id for check in drying.checks] == list(get_args(law.CheckId))
    assert drying.meter == law.DryingMeter(
        seconds=120.0, water_g=247.0, heat_wh=177.0, refused_seconds=22440.0, observed_at=AT - timedelta(minutes=27)
    )
    assert drying.today == law.DryingToday(seconds=129.8, runs=1, water_g=247.0, heat_wh=177.0, lower_bound=False)

    assert view.inputs.temp_f == 70.65 and view.inputs.vpd_kpa == 0.914 and view.inputs.dew_point_f == 58.0
    assert view.inputs.outdoor == law.OutdoorInput(source="station", temp_f=36.37, rh_pct=80.6, dew_point_f=None)
    assert view.alone == law.LawAlone(
        clock=law.AloneClock(valid=True, sync_age_s=691.0),
        probes=law.AloneProbes(active=4, degraded=False),
        host=law.AloneHost(connected=True, heartbeat_age_s=53.0),
        gap_log="armed",
    )
    assert view.constants.matches is True and view.constants.release_hash == K.CONSTANTS_SHA256
    assert view.lead_fan is None


def test_a_drying_run():
    view = law.law_view(
        view_row(law_value=RUNNING, lead_fan="Fan 2"),
        tracks(
            vent=track((7200, False), (200, True)),
            fan2=track((7200, False), (195, True)),
            heat1=track((7200, False), (900, True)),
        ),
        0.7,
        True,
    )
    drying_rule = rule(view, "drying")
    assert (drying_rule.latched, drying_rule.requested) == (True, True)
    assert [(relay.equipment, relay.state) for relay in drying_rule.relays] == [("vent", "on"), ("fan2", "on")]
    assert drying_rule.hold is None
    cooling = rule(view, "cooling")
    # Cooling is not requested, but the vent and the lead fan are wanted by the drying run: no hold to show.
    assert (cooling.latched, cooling.requested, cooling.hold) == (False, False, None)
    assert [relay.equipment for relay in rule(view, "second_fan").relays] == ["fan1"]
    assert rule(view, "heat1").requested is True  # electric heat may run during drying
    assert view.lead_fan == "fan2"
    assert view.drying.state == "running" and view.drying.limit_source == "owner"
    assert checks(view) == {
        "humid": True,
        "outdoor_drier": True,
        "worth_it": True,
        "warm_enough": True,
        "not_cooling": True,
        "furnace_off": True,
    }


def test_a_run_refused_on_cost():
    view = law.law_view(view_row(law_value=REFUSED_COST), tracks(), None, False)
    drying = view.drying
    assert (drying.state, drying.refused_reason, drying.cost_kwh_per_kg, drying.limit_kwh_per_kg) == (
        "refused", "cost", 0.82, 0.7
    )  # fmt: skip
    assert checks(view) == {
        "humid": True,
        "outdoor_drier": True,
        "worth_it": False,
        "warm_enough": True,  # the law reaches cost only at or above the start line
        "not_cooling": True,
        "furnace_off": True,
    }
    assert rule(view, "drying").latched is True and rule(view, "drying").requested is False


def test_refusals_settle_their_checks():
    too_cold = law.drying_checks(law.parse_record(record(193 | 2, 3, dr="too_cold")), None, fresh=True)
    assert {c.id: c.ok for c in too_cold} == {
        "humid": True,
        "outdoor_drier": True,
        "worth_it": True,
        "warm_enough": False,
        "not_cooling": True,
        "furnace_off": False,
    }
    no_outdoor = law.drying_checks(law.parse_record(record(64, 0, dr="no_outdoor", e=None)), 60.0, fresh=True)
    assert {c.id: c.ok for c in no_outdoor}["outdoor_drier"] is None
    assert {c.id: c.ok for c in no_outdoor}["worth_it"] is None
    not_drier = law.drying_checks(law.parse_record(record(64, 0, dr="not_drier", e=1e9)), 70.0, fresh=True)
    assert {c.id: c.ok for c in not_drier}["outdoor_drier"] is False
    assert {c.id: c.ok for c in not_drier}["worth_it"] is False
    invalid = law.drying_checks(law.parse_record(record(0, 0, dr="humidity_invalid")), 70.0, fresh=True)
    assert {c.id: c.ok for c in invalid}["humid"] is None
    off = law.drying_checks(law.parse_record(record(0, 0, dr="no_temperature", e=None)), 70.0, fresh=True)
    assert all(c.ok is None for c in off)
    cooling = law.drying_checks(law.parse_record(record(64 | 4, 4 | 32 | 128, dr="cooling")), 82.0, fresh=True)
    assert {c.id: c.ok for c in cooling}["not_cooling"] is False


# The check each refusal reason fails (no_outdoor leaves outdoor_drier unknown rather than false).
REFUSAL_CHECK = {
    "humidity_invalid": "humid",
    "no_outdoor": "outdoor_drier",
    "cooling": "not_cooling",
    "furnace": "furnace_off",
    "not_drier": "outdoor_drier",
    "too_cold": "warm_enough",
    "cost": "worth_it",
}


def test_the_checks_follow_the_laws_refusal_chain():
    header = (ROOT / "firmware/lib/climate_law.h").read_text()
    block = header[header.index("why drying is wanted and not running") :]
    block = block[: block.index("return q;")]
    chain = [name.lower() for name in re.findall(r"q\.dry_refusal = DRY_([A-Z_]+);", block)]
    assert chain == ["humidity_invalid", "no_outdoor", "cooling", "furnace", "not_drier", "too_cold", "cost"]
    assert set(REFUSAL_CHECK) | {"none", "no_temperature"} == set(get_args(law.RefusedReason))
    # The first appearance of each check down the chain, with no_outdoor shown as outdoor_drier unknown.
    order: list[str] = []
    for reason in chain:
        if reason != "no_outdoor" and REFUSAL_CHECK[reason] not in order:
            order.append(REFUSAL_CHECK[reason])
    assert order == list(get_args(law.CheckId))


DRY, AIR, H1, H2, COOL = 64, 128, 1, 2, 4


@pytest.mark.parametrize(
    "latches, requests, dr, e, temp_f",
    [
        (DRY | AIR, 0, "humidity_invalid", 0.633, 70.0),
        (DRY | AIR | COOL, 4 | 32 | 128, "cooling", 0.633, 81.0),
        (DRY | COOL, 4 | 32 | 128, "cooling", 1e9, 81.0),  # the outdoor air is not drier either: cooling comes first
        (DRY | AIR | H1 | H2, 1 | 2, "furnace", 0.9, 60.0),
        (DRY, 0, "not_drier", 1e9, 60.0),
        (DRY | AIR, 0, "not_drier", K.DRY_COST_NONE_KWH_PER_KG, 70.0),  # too small a moisture difference
        (DRY | AIR | H1, 1, "too_cold", 0.9, None),
        (DRY | AIR, 0, "cost", 0.82, 70.0),
    ],
)
def test_the_first_failing_check_is_the_refusal_reason(latches, requests, dr, e, temp_f):
    found = law.drying_checks(law.parse_record(record(latches, requests, dr=dr, e=e)), temp_f, fresh=True)
    first = next(check.id for check in found if check.ok is not True)
    assert first == REFUSAL_CHECK[dr]
    assert next(check for check in found if check.id == first).ok is (None if dr == "humidity_invalid" else False)


def test_no_outdoor_leaves_the_outdoor_checks_unknown():
    no_outdoor = law.parse_record(record(DRY, 0, "no_outdoor", e=None))
    found = {c.id: c.ok for c in law.drying_checks(no_outdoor, 70.0, fresh=True)}
    assert found["outdoor_drier"] is None and found["worth_it"] is None
    assert found["humid"] is True and found["not_cooling"] is True and found["furnace_off"] is True


def test_a_running_run_passes_the_start_only_checks():
    # The price rose past the limit and the house cooled below the start line: the law keeps the run (cost and
    # temperature decide only the start), so both checks pass while it runs.
    running = law.parse_record(record(449, 293, e=0.9))
    found = {c.id: c.ok for c in law.drying_checks(running, 67.9, fresh=True)}
    assert found == dict.fromkeys(get_args(law.CheckId), True)


def test_a_stale_record_says_nothing_about_now():
    view = law.law_view(view_row(law_at=AT - timedelta(seconds=300)), tracks(), None, False)
    assert view.reporting is False and view.observed_at == AT - timedelta(seconds=300)
    assert view.band.temp_low_f is None and view.band.repaired is None and view.band.differs is None
    assert view.band.host is not None  # the host band does not depend on the controller
    assert all(item.latched is None and item.requested is None and item.hold is None for item in view.rules)
    assert all(relay.state == "unknown" and relay.since is None for item in view.rules for relay in item.relays)
    assert rule(view, "heat1").on_at is None and rule(view, "hot_limit").on_at == K.SAFETY_MAX_F
    assert view.drying.state == "unknown" and view.drying.wanted is None and view.drying.limit_kwh_per_kg is None
    assert all(check.ok is None for check in view.drying.checks)
    assert view.drying.meter.water_g == 247.0  # the meter keeps its own time
    assert view.alone.host.connected is False  # the ingestor is alive and hears no record


def test_no_record_and_no_host():
    row = view_row(
        law_value=None,
        law_at=None,
        meter_value=None,
        meter_at=None,
        constants_value=None,
        constants_at=None,
        heartbeat_at=None,
        today=None,
        gap_log_state="off: nvs_small",
    )
    view = law.law_view(row, {}, None, False)
    assert view.observed_at is None and view.reporting is False and view.drying.state == "unknown"
    assert view.drying.today is None and view.drying.meter.seconds is None and view.drying.meter.observed_at is None
    assert view.constants == law.LawConstants(
        hash=None, release_hash=K.CONSTANTS_SHA256, matches=None, observed_at=None
    )
    assert view.alone.host == law.AloneHost(connected=None, heartbeat_age_s=None)
    assert view.alone.gap_log == "nvs_small"


def test_band_differs_and_constants_mismatch():
    row = view_row(host_temp_low=68.5, constants_value="0" * 64)
    view = law.law_view(row, tracks(), None, False)
    assert view.band.differs is True  # 1.1 F off on the low edge
    assert view.constants.hash == "0" * 64 and view.constants.matches is False
    assert law.band_differs((67.4, 79.4, 0.81, 1.34), law.HostBandEdges(
        temp_low_f=68.4, temp_high_f=79.4, vpd_low_kpa=0.91, vpd_high_kpa=1.34
    )) is False  # fmt: skip
    assert law.band_differs((67.4, 79.4, 0.81, 1.34), None) is None


def test_outdoor_source_and_small_words():
    intake = law.outdoor_input(view_row(outdoor_source="intake"), AT)
    assert (intake.source, intake.temp_f, intake.rh_pct) == ("intake", 37.04, 79.0)
    stale = law.outdoor_input(view_row(outdoor_source_at=AT - timedelta(minutes=11)), AT)
    assert (stale.source, stale.temp_f) == (None, None)
    none = law.outdoor_input(view_row(outdoor_source="none"), AT)
    assert (none.source, none.temp_f) == ("none", None)
    assert [law.gap_log_word(v) for v in ("armed", "off: nvs_full", "off: other", None)] == [
        "armed", "nvs_full", None, None
    ]  # fmt: skip
    assert [law.lead_fan(v) for v in ("Fan 1", "Fan 2", "fan2", "", None)] == ["fan1", "fan2", "fan2", None, None]


# ── LawRule.hold: only what the host can prove ──────────────────────────────

BOOTED = AT - timedelta(hours=1)


def relays(**states):
    return {name: law.RelayNow(on=on, since=AT - timedelta(seconds=ago)) for name, (on, ago) in states.items()}


def test_hold_min_off_and_min_on():
    # heat1 requested (o=1), relay off for 100 s of its 300 s minimum off time.
    assert law.rule_hold("heat1", True, 1, relays(heat1=(False, 100)), None, AT, BOOTED) == law.LawHold(
        kind="min_off", remaining_s=200
    )
    # Not requested and on for 60 s: 240 s of minimum on time left.
    assert law.rule_hold("heat1", False, 0, relays(heat1=(True, 60)), None, AT, BOOTED) == law.LawHold(
        kind="min_on", remaining_s=240
    )
    # Past the minimum time, or in the state the law asks for: nothing to prove.
    assert law.rule_hold("heat1", True, 1, relays(heat1=(False, 400)), None, AT, BOOTED) is None
    assert law.rule_hold("heat1", True, 1, relays(heat1=(True, 10)), None, AT, BOOTED) is None
    # The fogger's own times (120 s), while the controller says the fogger waits out its minimum off time.
    assert law.rule_hold(
        "fog", True, 8, relays(fog=(False, 30)), None, AT, BOOTED, fog_reason="relay_min_off"
    ) == law.LawHold(kind="min_off", remaining_s=90)


def test_hold_needs_proof():
    # A switch before the controller's last boot proves nothing; no boot time proves nothing.
    assert law.rule_hold("heat1", True, 1, relays(heat1=(False, 100)), None, AT, AT - timedelta(seconds=50)) is None
    assert law.rule_hold("heat1", True, 1, relays(heat1=(False, 100)), None, AT, None) is None
    # The misters have no minimum time here; the limits have no minimum times at all.
    assert law.rule_hold("mist", True, 16, relays(mister_any=(False, 5)), None, AT, BOOTED) is None
    assert law.rule_hold("hot_limit", True, 512 | 4 | 64 | 128, relays(vent=(False, 5)), None, AT, BOOTED) is None
    # At the hot limit the vent and fans skip their minimum times (ruling G1)...
    hot = 512 | 4 | 32 | 64 | 128
    assert law.rule_hold("cooling", True, hot, relays(vent=(False, 5)), None, AT, BOOTED) is None
    # ...and the fogger keeps them (G1a).
    assert law.rule_hold("fog", False, 512, relays(fog=(True, 30)), None, AT, BOOTED) == law.LawHold(
        kind="min_on", remaining_s=90
    )
    # A relay another rule still wants: cooling not requested but drying wants the vent.
    assert law.rule_hold("cooling", False, 4 | 32 | 256, relays(vent=(True, 10)), None, AT, BOOTED) is None
    # One fan requested and no lead known: which fan is wanted is not provable.
    assert law.rule_hold("cooling", True, 4 | 32 | 128, relays(vent=(True, 400), fan1=(False, 10)), None, AT,
                         BOOTED) is None  # fmt: skip
    assert law.rule_hold("cooling", True, 4 | 32 | 128, relays(vent=(True, 400), fan1=(False, 10)), "fan1", AT,
                         BOOTED) == law.LawHold(kind="min_off", remaining_s=290)  # fmt: skip


def test_the_relays_of_each_rule():
    assert law.rule_relays("hot_limit", None) == ("vent", "fan1", "fan2")
    assert law.rule_relays("cold_limit", "fan1") == ("heat1", "heat2")
    assert law.rule_relays("cooling", "fan2") == ("vent", "fan2")
    assert law.rule_relays("cooling", None) == ("vent", "fan1", "fan2")
    assert law.rule_relays("second_fan", "fan2") == ("fan1",) and law.rule_relays("mist", None) == ("mister_any",)


def bursts(**on):
    return {flag: law.RelayNow(on=on.get(flag, False), since=None) for flag in law.MANUAL_RUN_RELAYS}


def test_a_manual_run_proves_no_hold():
    fans_on = relays(vent=(True, 60), fan1=(True, 60), heat1=(False, 60))
    # Without a manual run, fan1 on 60 s with cooling not requested is inside its minimum on time...
    free = law.manual_held(bursts())
    assert free == frozenset()
    assert law.rule_hold("cooling", False, 0, fans_on, "fan1", AT, BOOTED, free) == law.LawHold(
        kind="min_on", remaining_s=240
    )
    # ...but 60 s into a manual fan run the run holds the fans and the vent, and stops the heaters.
    held = law.manual_held(bursts(fan_burst_active=True))
    assert {"fan1", "fan2", "vent", "heat1", "heat2"} == held
    assert law.rule_hold("cooling", False, 0, fans_on, "fan1", AT, BOOTED, held) is None
    assert law.rule_hold("heat1", True, 1, fans_on, "fan1", AT, BOOTED, held) is None
    assert law.manual_held(bursts(vent_bypass_active=True)) == held
    # A fogger press holds the fogger; a flag the host has not seen proves nothing either.
    assert law.manual_held(bursts(fog_burst_active=True)) == {"fog"}
    assert law.manual_held({}) == {relay for group in law.MANUAL_RUN_RELAYS.values() for relay in group}
    assert law.manual_held(bursts(fan_burst_active=None)) == held


def test_a_manual_run_in_the_view():
    view = law.law_view(
        view_row(),
        tracks(
            fan_burst_active=track((7200, False), (60, True)),
            vent=track((7200, False), (60, True)),
            fan1=track((7200, False), (60, True)),
        ),
        None,
        False,
    )
    assert rule(view, "cooling").requested is False and rule(view, "cooling").hold is None
    assert rule(view, "hot_limit").hold is None


def test_the_fogger_proves_only_what_the_controller_and_the_limits_settle():
    fog_off = relays(fog=(False, 30))
    # Requested and off: the controller names the hold; occupancy or the drips hold it for their own reasons.
    assert law.rule_hold("fog", True, 8, fog_off, None, AT, BOOTED, fog_reason="occupancy") is None
    assert law.rule_hold("fog", True, 8, fog_off, None, AT, BOOTED, fog_reason=None) is None
    # On and not requested: the irrigation engine's run may hold it, except at a protection limit.
    assert law.rule_hold("fog", False, 0, relays(fog=(True, 30)), None, AT, BOOTED) is None
    assert law.rule_hold("fog", False, 512, relays(fog=(True, 30)), None, AT, BOOTED) == law.LawHold(
        kind="min_on", remaining_s=90
    )


def test_the_furnace_boot_wait():
    booted = AT - timedelta(seconds=60)
    off_before_boot = {"heat2": law.RelayNow(on=False, since=None)}
    assert law.rule_hold("heat2", True, 2, off_before_boot, None, AT, booted) == law.LawHold(
        kind="min_off", remaining_s=240
    )
    # Not at the cold limit (G1b).
    assert law.rule_hold("heat2", True, 2 | 1024, off_before_boot, None, AT, booted) is None


# ── API-31 shaping ──────────────────────────────────────────────────────────

T0 = datetime(2026, 11, 17, 6, 0, tzinfo=UTC)
M = timedelta(minutes=1)


def key(l: int, o: int, dr: str = "none", br: int = 0) -> law.RecordKey:  # noqa: E741
    return law.RecordKey(l=l, o=o, dr=dr, br=br)


def test_segments_mark_every_silence_over_180_s_unknown():
    islands = [
        law.Island(T0 - M, T0 + 9 * M, T0 + 10 * M, key(128, 0)),
        law.Island(T0 + 10 * M, T0 + 20 * M, T0 + 25 * M, key(449, 293)),  # then 5 min with no record
        law.Island(T0 + 25 * M, T0 + 29 * M, None, key(193, 1, "cost")),
    ]
    pieces = law.segments(islands, T0, T0 + 40 * M, law.LAW_RECORD_GAP)
    assert pieces == [
        (T0, T0 + 10 * M, key(128, 0)),
        (T0 + 10 * M, T0 + 20 * M, key(449, 293)),
        (T0 + 20 * M, T0 + 25 * M, None),
        (T0 + 25 * M, T0 + 29 * M, key(193, 1, "cost")),
        (T0 + 29 * M, T0 + 40 * M, None),  # the newest record is 11 min before the end
    ]
    # Before the first record, and an empty window.
    late = [law.Island(T0 + 5 * M, T0 + 9 * M, None, key(128, 0))]
    assert law.segments(late, T0, T0 + 10 * M, law.LAW_RECORD_GAP)[0] == (T0, T0 + 5 * M, None)
    assert law.segments([], T0, T0 + M, law.LAW_RECORD_GAP) == [(T0, T0 + M, None)]
    # A newest record within 180 s of the end holds to the end.
    assert law.segments(late, T0 + 5 * M, T0 + 11 * M, law.LAW_RECORD_GAP) == [(T0 + 5 * M, T0 + 11 * M, key(128, 0))]


def test_lanes_drying_and_band_repairs():
    pieces = [
        (T0, T0 + 10 * M, key(128, 0)),
        (T0 + 10 * M, T0 + 20 * M, key(449, 293)),
        (T0 + 20 * M, T0 + 25 * M, None),
        (T0 + 25 * M, T0 + 29 * M, key(193, 1, "cost", br=1)),
        (T0 + 29 * M, T0 + 31 * M, key(193, 1, "cost", br=1)),
    ]
    lanes = {lane.key: lane for lane in law.history_lanes(pieces)}
    assert list(lanes) == [key for key, _, _ in law.LANES] and lanes["latch.h1"].group == "latch"
    drying = [(i.start, i.end, i.state) for i in lanes["request.drying"].intervals]
    assert drying == [
        (T0, T0 + 10 * M, "off"),
        (T0 + 10 * M, T0 + 20 * M, "on"),
        (T0 + 20 * M, T0 + 25 * M, "unknown"),
        (T0 + 25 * M, T0 + 31 * M, "off"),
    ]
    assert [(i.state) for i in lanes["latch.air"].intervals] == ["on", "unknown", "on"]
    assert [(i.state) for i in lanes["request.fan1"].intervals] == ["off", "on", "unknown", "off"]
    assert [(i.start, i.end, i.state, i.reason) for i in law.history_drying(pieces)] == [
        (T0, T0 + 10 * M, "not_wanted", None),
        (T0 + 10 * M, T0 + 20 * M, "running", None),
        (T0 + 20 * M, T0 + 25 * M, "unknown", None),
        (T0 + 25 * M, T0 + 31 * M, "refused", "cost"),
    ]
    assert law.history_band_repaired(pieces) == [law.Span(start=T0 + 25 * M, end=T0 + 31 * M)]
    # A reason only while refused: humidity_invalid holds drying without the house wanting it.
    assert law.drying_word(key(0, 0, "humidity_invalid")) == ("not_wanted", None)


def test_outdoor_source_intervals():
    pieces = [(T0, T0 + M, "station"), (T0 + M, T0 + 2 * M, "intake"), (T0 + 2 * M, T0 + 3 * M, None)]
    assert [(i.source) for i in law.history_outdoor(pieces)] == ["station", "intake", "unknown"]


def test_bucket_columns_place_rows_and_keep_gaps_null():
    axis = series.bucket_starts(T0, T0 + 3 * timedelta(hours=1), 3600)
    rows = [
        {"bucket": T0, "cost_kwh_per_kg": 0.633, "limit_kwh_per_kg": 0.7},
        {"bucket": T0 + 2 * timedelta(hours=1), "cost_kwh_per_kg": None, "limit_kwh_per_kg": 0.7},
    ]
    assert law.bucket_columns(axis, rows, ("cost_kwh_per_kg", "limit_kwh_per_kg")) == {
        "cost_kwh_per_kg": [0.633, None, None],
        "limit_kwh_per_kg": [0.7, None, 0.7],
    }


# ── the reads, against a scripted connection ────────────────────────────────


class Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class Conn:
    """Answers by first-matching SQL fragment and records every statement."""

    def __init__(self, responders):
        self.responders = responders
        self.calls: list[tuple[str, tuple]] = []
        self.isolation: list[str | None] = []

    def transaction(self, **kwargs):
        self.isolation.append(kwargs.get("isolation"))
        return Transaction()

    def is_in_transaction(self):
        return True

    def _answer(self, sql, args, default):
        self.calls.append((" ".join(sql.split()), args))
        for fragment, result in self.responders:
            if fragment in sql:
                return result
        return default

    async def execute(self, sql, *args):
        return self._answer(sql, args, "SET")

    async def fetchrow(self, sql, *args):
        return self._answer(sql, args, None)

    async def fetch(self, sql, *args):
        return self._answer(sql, args, [])

    async def fetchval(self, sql, *args):
        return self._answer(sql, args, None)


def test_the_view_read():
    row = view_row()
    today = row.pop("today")
    conn = Conn(
        [
            ("FROM (SELECT 1) AS anchor", row),
            ("FROM daily_record", today),
            ("v_desired_state_current", None),
            (
                "FROM equipment_state",
                [{"key": "heat1", "ts": AT - timedelta(seconds=120), "state": True, "newest_at": AT}],
            ),
        ]
    )
    view = asyncio.run(law.law(conn))
    assert view.drying.today is not None and view.drying.limit_source == "default"
    assert rule(view, "heat1").relays[0].state == "on"
    statements = [sql for sql, _ in conn.calls]
    assert statements[0].startswith("SET LOCAL statement_timeout")
    # One snapshot: the law record and the relay edges the holds compare it with describe the same moment.
    assert conn.isolation == ["repeatable_read"]
    view_sql, args = next((sql, args) for sql, args in conn.calls if "AS anchor" in sql)
    assert args[:4] == ("climate_law_state", "climate_drying_meter", "climate_law_constants", "outdoor_source")
    assert args[7:] == ("fog_block_reason", reads.NEWEST_ROW_WINDOW)
    tracked = next(args for sql, args in conn.calls if "FROM equipment_state" in sql)[0]
    assert set(law.MANUAL_RUN_RELAYS) <= set(tracked)
    # Every system_state, diagnostics, climate and equipment_state read is bounded by time.
    for table in ("system_state", "diagnostics", "climate", "equipment_state"):
        for match in re.finditer(rf"FROM {table}\b(.{{0,110}})", view_sql):
            assert "ts > now() -" in match.group(1), (table, match.group(1))


def test_the_history_read_and_its_window_rules():
    now = T0 + timedelta(hours=1)
    conn = Conn(
        [
            ("ORDER BY ts LIMIT 1", T0 - timedelta(hours=8)),
            (
                "ROW(lag(l)",
                [
                    {
                        "start_ts": T0 - M,
                        "last_ts": T0 + 29 * M,
                        "next_ts": T0 + 30 * M,
                        "l": 128,
                        "o": 0,
                        "dr": "none",
                        "br": 0,
                    },  # fmt: skip
                    {
                        "start_ts": T0 + 30 * M,
                        "last_ts": T0 + 59 * M,
                        "next_ts": None,
                        "l": 449,
                        "o": 293,
                        "dr": "none",
                        "br": 0,
                    },  # fmt: skip
                ],
            ),
            ("lag(value)", [{"start_ts": T0 - M, "last_ts": T0 + 59 * M, "next_ts": None, "value": "station"}]),
            (
                "time_bucket",
                [
                    {
                        "bucket": T0,
                        "cost_kwh_per_kg": 0.6,
                        "limit_kwh_per_kg": 0.7,
                        "temp_low_f": 67.4,
                        "temp_high_f": 79.4,
                        "vpd_low_kpa": 0.81,
                        "vpd_high_kpa": 1.34,
                    }
                ],
            ),  # fmt: skip
        ]
    )
    result = asyncio.run(law.history(conn, T0, T0 + timedelta(hours=2), now=now))
    assert result.first_record_at == T0 - timedelta(hours=8)
    assert result.cost.bucket_s == 60 and len(result.cost.t) == 120 and result.cost.cost_kwh_per_kg[0] == 0.6
    assert result.band.temp_low_f[0] == 67.4 and result.band.temp_low_f[1] is None
    drying = {lane.key: lane for lane in result.lanes}["request.drying"].intervals
    assert [(i.start, i.end, i.state) for i in drying] == [(T0, T0 + 30 * M, "off"), (T0 + 30 * M, now, "on")]
    assert [(i.start, i.end, i.source) for i in result.outdoor_source] == [(T0, now, "station")]
    body = result.model_dump(mode="json", by_alias=True)
    assert body["from"] == "2026-11-17T06:00:00Z" and "from_" not in body
    # Each statement: entity as a parameter, ts bounded on both sides.
    for sql, args in conn.calls:
        if "system_state" in sql and "LIMIT 1" not in sql:
            assert "entity = $1 AND ts >= $2::timestamptz AND ts < $3::timestamptz" in sql
            assert args[1] < args[2] <= now
    islands_args = next(args for sql, args in conn.calls if "ROW(lag(l)" in sql)
    assert islands_args == ("climate_law_state", T0 - law.LAW_RECORD_GAP, now, law.LAW_RECORD_GAP)
    first_args = next(args for sql, args in conn.calls if "ORDER BY ts LIMIT 1" in sql)
    assert first_args == ("climate_law_state", law.LAW_RECORDS_FROM)
    assert conn.isolation == ["repeatable_read"]


def test_history_reads_only_version_1_records():
    # A record of another version, or one without its bit fields, is no record: its span reads as unknown, as
    # API-30's parse_record treats it, and never fails the read.
    assert "value::jsonb ->> 'v' = '1'" in law.ISLANDS_SQL
    assert "jsonb_typeof(value::jsonb -> 'l') = 'number'" in law.ISLANDS_SQL
    assert "jsonb_typeof(value::jsonb -> 'o') = 'number'" in law.ISLANDS_SQL
    assert "value::jsonb ->> 'v' = '1'" in law.BUCKETS_SQL and "value::jsonb ->> 'v' = '1'" in law.DAY_BUCKETS_SQL


def test_history_window_rules():
    with pytest.raises(ServiceError) as too_large:
        asyncio.run(law.history(Conn([]), T0, T0 + timedelta(days=32), now=T0))
    assert too_large.value.problem.code == "window_too_large"
    with pytest.raises(ServiceError) as backwards:
        asyncio.run(law.history(Conn([]), T0, T0, now=T0))
    assert backwards.value.problem.code == "invalid_request"
    # A window wholly ahead of now: no intervals, null buckets, no interval read.
    conn = Conn([])
    ahead = asyncio.run(law.history(conn, T0 + timedelta(days=1), T0 + timedelta(days=2), now=T0))
    assert ahead.lanes[0].intervals == [] and all(value is None for value in ahead.cost.cost_kwh_per_kg)
    assert ahead.cost.bucket_s == 60 and len(ahead.cost.t) <= law.HISTORY_POINTS
    assert not [sql for sql, _ in conn.calls if "ROW(lag(l)" in sql]
    # 31 days stay within 1,500 points.
    month = asyncio.run(law.history(Conn([]), T0, T0 + timedelta(days=31), now=T0))
    assert month.cost.bucket_s == 3600 and len(month.band.t) <= law.HISTORY_POINTS
