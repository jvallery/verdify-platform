"""The climate law's reads: API-30 ``law()`` (what the controller's law is doing now and why) and API-31
``history()`` (its decisions over time).

The controller decides climate alone with the band-edge law (``firmware/lib/climate_law.h``); the host only reads
what it publishes. The law's state record (``system_state`` ``climate_law_state``) carries its latch bits, its
request bits, why drying is not running, the drying cost and its limit, whether the band check repaired the band,
and the band in force. Every threshold, minimum time and the release hash below come from the generated constants
module (``verdify_schemas.climate_law_constants``), never from a literal; the record is decoded by the existing
``verdify_services.reads`` decoder (``law_state()`` and its latch and request name tables).

The current view follows ``Now.law``: the law's decisions are served only while its newest record is fresh
(``control_proof.law_fresh``, at most 120 s old). Otherwise they are null, relays are unknown and drying is
``unknown``, and ``observed_at`` still names the newest record. Unknown is never off and null is never 0.

The history decodes the record in SQL, keeps only the rows where it changes (window functions) and returns change
intervals. Any span of more than 180 s with no record is ``unknown``. The drying cost and the band are bucketed with
the API-04 ladder at most 1,500 points. Every hypertable predicate is ``entity = ... AND ts`` bounded.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Hashable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, get_args

import asyncpg
from pydantic import BaseModel, ConfigDict, Field

from verdify_schemas import climate_law_constants as law_constants
from verdify_schemas.control_proof import LAW_HEARTBEAT_MAX_AGE_S, LAW_STATE_ENTITY
from verdify_schemas.telemetry import LAW_CONSTANTS_HASH, ClimateDryingMeter, ClimateLawState
from verdify_schemas.tunable_registry import DRY_COST_LIMIT_PARAM
from verdify_schemas.vpd_envelope import outdoor_dewpoint_f
from verdify_services import reads, series

# ── Constants ───────────────────────────────────────────────────────────────

DRYING_METER_ENTITY = "climate_drying_meter"
CONSTANTS_ENTITY = "climate_law_constants"
OUTDOOR_SOURCE_ENTITY = "outdoor_source"
LEAD_FAN_ENTITY = "lead_fan"
FOG_BLOCK_REASON_ENTITY = "fog_block_reason"

# The newest law record, drying meter and constants hash are looked up over this window: the record beats every
# 60 s, the meter at least every 300 s and the hash every 3600 s, so a day bounds each lookup to the newest chunk.
NEWEST_WINDOW = timedelta(days=1)
# The outdoor source is unknown after this long with no row (reads.OUTDOOR_SOURCE_FRESH, Now's rule too).
OUTDOOR_SOURCE_FRESH = reads.OUTDOOR_SOURCE_FRESH
# API-31: a span of more than this with no law record is unknown (the record beats every 60 s).
LAW_RECORD_GAP = timedelta(seconds=180)
# The first law record (API-31's first_record_at, API-32's law_started) is searched from here on, so the scan is
# bounded by ts and the answer never moves: no law record predates the climate refactor's plan of 2026-11-15 (the
# first law build reached the controller on 2026-11-16).
LAW_RECORDS_FROM = datetime(2026, 11, 15, tzinfo=UTC)
# API-31's cost and band columns: the API-04 bucket ladder, at most this many points.
HISTORY_POINTS = series.POINTS_DEFAULT

# The band_device_db_divergence rule (ingestor/tasks/coverage_alerts.py LAW_BAND_TEMP_F and LAW_BAND_VPD_KPA, the
# OBS-47 tolerance): the controller's band differs from the host's by more than this on any edge. The ingestor is not
# part of the operator API's image; tests/test_verdify_services_law.py holds the two values equal.
BAND_DIFFERS_TEMP_F = 1.0
BAND_DIFFERS_VPD_KPA = 0.10

# The relays' minimum times as the relay layer applies them (climate_law.h relay_step). The heaters, fans and vent
# share one minimum on and one minimum off time today; the timing block serves that value and a test holds the three
# equal. The furnace waits one minimum off time after every boot (ruling G4).
RELAY_MIN_TIMES: Mapping[str, tuple[int, int]] = {
    "heat1": (law_constants.HEAT_MIN_ON_S, law_constants.HEAT_MIN_OFF_S),
    "heat2": (law_constants.HEAT_MIN_ON_S, law_constants.HEAT_MIN_OFF_S),
    "fan1": (law_constants.FAN_MIN_ON_S, law_constants.FAN_MIN_OFF_S),
    "fan2": (law_constants.FAN_MIN_ON_S, law_constants.FAN_MIN_OFF_S),
    "vent": (law_constants.VENT_MIN_ON_S, law_constants.VENT_MIN_OFF_S),
    "fog": (law_constants.FOG_MIN_ON_S, law_constants.FOG_MIN_OFF_S),
}
FURNACE_BOOT_WAIT_S = law_constants.HEAT_MIN_OFF_S
# The fogger keeps its minimum times at a protection limit (ruling G1a); the other relays do not (G1).
KEEPS_MIN_TIMES_AT_LIMITS = frozenset({"fog"})

# The equipment_state keys of the relays the law drives. mister_any is the controller's "any mister running" flag.
LAW_RELAYS = ("heat1", "heat2", "vent", "fan1", "fan2", "fog", "mister_any")
# A manual run holds relays outside the law (docs/firmware-fsm-spec.md section 5, climate_law_glue.h relay_pass()):
# a fan run (vent open or kept closed) runs the fans, keeps the vent where it puts it and stops both heaters; a fogger
# press runs the fogger. While one runs, or its flag is not known, the host cannot prove a minimum-time hold on them.
MANUAL_RUN_RELAYS: Mapping[str, tuple[str, ...]] = {
    "fan_burst_active": ("fan1", "fan2", "vent", "heat1", "heat2"),
    "vent_bypass_active": ("fan1", "fan2", "vent", "heat1", "heat2"),
    "fog_burst_active": ("fog",),
}
assert set(MANUAL_RUN_RELAYS) == set(reads.BURSTS), MANUAL_RUN_RELAYS
# The fog_block_reason word the controller publishes while the fogger waits out its minimum off time; any other hold
# (occupancy, the drips, the budgets, the dew margin) keeps the fogger off for its own reason.
FOG_MIN_OFF_REASON = "relay_min_off"
LEAD_FANS: Mapping[str, str] = {"Fan 1": "fan1", "Fan 2": "fan2", "fan1": "fan1", "fan2": "fan2"}

RuleId = Literal["heat1", "heat2", "cooling", "second_fan", "fog", "mist", "drying", "hot_limit", "cold_limit"]
RelayKey = Literal["heat1", "heat2", "vent", "fan1", "fan2", "fog", "mister_any"]
RelayState = Literal["on", "off", "unknown"]
DryingState = Literal["running", "refused", "not_wanted", "unknown"]
RefusedReason = Literal[
    "none", "no_outdoor", "cooling", "furnace", "not_drier", "too_cold", "cost", "humidity_invalid", "no_temperature"
]
BandSource = Literal["onchip_curve", "corridor", "dispatcher_legacy"]
OutdoorSource = Literal["station", "intake", "none"]
GapLog = Literal["armed", "not_armed_yet", "nvs_small", "nvs_full", "nvs_slow", "nvs_error"]
# The drying checks in the order the law refuses (climate_law.h step(): humidity, then cooling, the furnace, the
# outdoor air, the temperature and the cost), so the first failing check is the refusal reason.
CheckId = Literal["humid", "not_cooling", "furnace_off", "outdoor_drier", "warm_enough", "worth_it"]
LaneKey = Literal[
    "request.heat1",
    "request.heat2",
    "request.vent",
    "request.fog",
    "request.mist",
    "request.fan1",
    "request.fan2",
    "request.cooling",
    "request.drying",
    "request.hot",
    "request.cold",
    "latch.h1",
    "latch.h2",
    "latch.cool",
    "latch.cool2",
    "latch.wet",
    "latch.mist",
    "latch.dry",
    "latch.air",
    "latch.run",
]
# The lanes in the fixed order: each request bit, then each latch bit, in bit order (reads.LAW_REQUESTS and
# reads.LAW_LATCHES are the firmware's bit order, climate_law.h request_bits and latch_bits).
LANES: tuple[tuple[str, Literal["request", "latch"], int], ...] = (
    *((f"request.{name}", "request", bit) for bit, name in enumerate(reads.LAW_REQUESTS)),
    *((f"latch.{name}", "latch", bit) for bit, name in enumerate(reads.LAW_LATCHES)),
)
assert tuple(key for key, _, _ in LANES) == get_args(LaneKey), LANES

_LATCH = {name: 1 << bit for bit, name in enumerate(reads.LAW_LATCHES)}
_REQUEST = {name: 1 << bit for bit, name in enumerate(reads.LAW_REQUESTS)}
_REFUSALS = frozenset(get_args(RefusedReason))
_GAP_LOG_OFF = "off: "


# ── Response models ─────────────────────────────────────────────────────────


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HostBandEdges(_Model):
    """The host's band now (``fn_band_setpoints(now())``): an edge it cannot compute is null."""

    temp_low_f: float | None
    temp_high_f: float | None
    vpd_low_kpa: float | None
    vpd_high_kpa: float | None


class LawBand(_Model):
    """The band the controller is using now (record field ``b``), against the host's band at the same moment."""

    temp_low_f: float | None
    temp_high_f: float | None
    vpd_low_kpa: float | None
    vpd_high_kpa: float | None
    repaired: bool | None
    source: BandSource | None
    host: HostBandEdges | None
    differs: bool | None


class OutdoorInput(_Model):
    source: OutdoorSource | None
    temp_f: float | None
    rh_pct: float | None
    dew_point_f: float | None


class LawInputs(_Model):
    temp_f: float | None
    vpd_kpa: float | None
    rh_pct: float | None
    dew_point_f: float | None
    outdoor: OutdoorInput
    observed_at: datetime | None


class LawRelay(_Model):
    equipment: RelayKey
    state: RelayState
    since: datetime | None


class LawHold(_Model):
    kind: Literal["min_off", "min_on"]
    remaining_s: int


class LawRule(_Model):
    id: RuleId
    signal: Literal["temp", "vpd"]
    direction: Literal["below", "above"]
    on_at: float | None
    off_at: float | None
    latched: bool | None
    requested: bool | None
    relays: list[LawRelay]
    hold: LawHold | None


class DryingCheck(_Model):
    id: CheckId
    ok: bool | None


class DryingMeter(_Model):
    seconds: float | None
    water_g: float | None
    heat_wh: float | None
    refused_seconds: float | None
    observed_at: datetime | None


class DryingToday(_Model):
    seconds: float | None
    runs: int | None
    water_g: float | None
    heat_wh: float | None
    lower_bound: bool | None


class LawDrying(_Model):
    state: DryingState
    wanted: bool | None
    outdoor_drier: bool | None
    refused_reason: RefusedReason | None
    cost_kwh_per_kg: float | None
    limit_kwh_per_kg: float | None
    limit_source: Literal["owner", "default"]
    wanted_below_kpa: float | None
    stop_above_kpa: float | None
    min_temp_f: float | None
    checks: list[DryingCheck]
    meter: DryingMeter
    today: DryingToday | None


class LawTiming(_Model):
    relay_min_on_s: int
    relay_min_off_s: int
    fog_min_on_s: int
    fog_min_off_s: int
    furnace_boot_wait_s: int
    mist_pulse_s: int
    mist_gap_s: int
    hot_limit_f: float
    cold_limit_f: float


class AloneClock(_Model):
    valid: bool | None
    sync_age_s: float | None


class AloneProbes(_Model):
    active: int | None
    degraded: bool | None


class AloneHost(_Model):
    connected: bool | None
    heartbeat_age_s: float | None


class LawAlone(_Model):
    clock: AloneClock
    probes: AloneProbes
    host: AloneHost
    gap_log: GapLog | None


class LawConstants(_Model):
    hash: str | None
    release_hash: str
    matches: bool | None
    observed_at: datetime | None


class LawView(_Model):
    server_time: datetime
    observed_at: datetime | None
    reporting: bool
    band: LawBand
    inputs: LawInputs
    rules: list[LawRule]
    drying: LawDrying
    timing: LawTiming
    lead_fan: Literal["fan1", "fan2"] | None
    alone: LawAlone
    constants: LawConstants


class LawInterval(_Model):
    start: datetime
    end: datetime
    state: RelayState


class LawLane(_Model):
    key: LaneKey
    group: Literal["request", "latch"]
    intervals: list[LawInterval]


class DryingInterval(_Model):
    start: datetime
    end: datetime
    state: DryingState
    reason: str | None


class OutdoorSourceInterval(_Model):
    start: datetime
    end: datetime
    source: Literal["station", "intake", "none", "unknown"]


class Span(_Model):
    start: datetime
    end: datetime


BucketS = Literal[60, 300, 900, 3600, 10800, 86400]  # the API-04 ladder (series.BUCKETS_S)
assert get_args(BucketS) == series.BUCKETS_S


class CostColumns(_Model):
    bucket_s: BucketS
    t: list[int]
    cost_kwh_per_kg: list[float | None]
    limit_kwh_per_kg: list[float | None]


class LawBandColumns(_Model):
    bucket_s: BucketS
    t: list[int]
    temp_low_f: list[float | None]
    temp_high_f: list[float | None]
    vpd_low_kpa: list[float | None]
    vpd_high_kpa: list[float | None]


class LawHistory(_Model):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: datetime = Field(alias="from")
    to: datetime
    first_record_at: datetime | None
    lanes: list[LawLane]
    drying: list[DryingInterval]
    outdoor_source: list[OutdoorSourceInterval]
    band_repaired: list[Span]
    cost: CostColumns
    band: LawBandColumns


# ── The rules (climate_law.h step(); docs/firmware-fsm-spec.md section 4.2) ─────


@dataclass(frozen=True)
class RuleDef:
    """One rule: its signal and direction, its thresholds from the band in use, and its bits."""

    id: str
    signal: Literal["temp", "vpd"]
    direction: Literal["below", "above"]
    on_at: Callable[[tuple[float, float, float, float]], float]
    off_at: Callable[[tuple[float, float, float, float]], float]
    latch: str | None  # the latch bit; None for the limits, which have no latch and use their request bit
    request: str


C = law_constants
# The band is (temp low, temp high, VPD low, VPD high), the record's ``b``.
RULES: tuple[RuleDef, ...] = (
    RuleDef(
        "heat1",
        "temp",
        "below",
        lambda b: b[0] + C.HEAT1_ON_ABOVE_LOW_F,
        lambda b: b[0] + C.HEAT1_OFF_ABOVE_LOW_F,
        "h1",
        "heat1",
    ),
    RuleDef(
        "heat2",
        "temp",
        "below",
        lambda b: b[0] + C.HEAT2_ON_ABOVE_LOW_F,
        lambda b: b[0] + C.HEAT2_OFF_ABOVE_LOW_F,
        "h2",
        "heat2",
    ),
    RuleDef(
        "cooling",
        "temp",
        "above",
        lambda b: b[1] + C.COOL_ON_ABOVE_HIGH_F,
        lambda b: b[1] + C.COOL_ON_ABOVE_HIGH_F - C.COOL_OFF_BELOW_HIGH_F,
        "cool",
        "cooling",
    ),
    RuleDef(
        "second_fan",
        "temp",
        "above",
        lambda b: b[1] + C.FAN2_ON_ABOVE_HIGH_F,
        lambda b: b[1] + C.FAN2_OFF_ABOVE_HIGH_F,
        "cool2",
        "fan2",
    ),
    RuleDef(
        "fog",
        "vpd",
        "above",
        lambda b: b[3] + C.FOG_ON_ABOVE_VPD_HIGH_KPA,
        lambda b: b[3] - C.FOG_OFF_BELOW_VPD_HIGH_KPA,
        "wet",
        "fog",
    ),
    RuleDef(
        "mist",
        "vpd",
        "above",
        lambda b: b[3] + C.MIST_ON_ABOVE_VPD_HIGH_KPA,
        lambda b: b[3] + C.MIST_OFF_ABOVE_VPD_HIGH_KPA,
        "mist",
        "mist",
    ),
    RuleDef(
        "drying",
        "vpd",
        "below",
        lambda b: b[2] + C.DRY_ON_ABOVE_VPD_LOW_KPA,
        lambda b: b[2] + C.DRY_OFF_ABOVE_VPD_LOW_KPA,
        "dry",
        "drying",
    ),
    RuleDef("hot_limit", "temp", "above", lambda _b: C.SAFETY_MAX_F, lambda _b: C.SAFETY_MAX_F, None, "hot"),
    RuleDef("cold_limit", "temp", "below", lambda _b: C.SAFETY_MIN_F, lambda _b: C.SAFETY_MIN_F, None, "cold"),
)
assert tuple(rule.id for rule in RULES) == get_args(RuleId), RULES
_LIMIT_RULES = frozenset({"hot_limit", "cold_limit"})


def rule_relays(rule_id: str, lead: str | None) -> tuple[str, ...]:
    """The relays a rule drives (climate_law.h step() and relay_step()): cooling and drying open the vent and run the
    lead fan, the second fan is the other one, the limits drive the vent and both fans or both heaters. While the
    lead is not known, both fans are listed."""
    other = {"fan1": "fan2", "fan2": "fan1"}.get(lead or "")
    lead_fans = (lead,) if lead and other else ("fan1", "fan2")
    second = (other,) if other else ("fan1", "fan2")
    return {
        "heat1": ("heat1",),
        "heat2": ("heat2",),
        "cooling": ("vent", *lead_fans),
        "second_fan": second,
        "fog": ("fog",),
        "mist": ("mister_any",),
        "drying": ("vent", *lead_fans),
        "hot_limit": ("vent", "fan1", "fan2"),
        "cold_limit": ("heat1", "heat2"),
    }[rule_id]


def relay_wanted(relay: str, requests: int, lead: str | None) -> bool | None:
    """Whether the law's request asks for this relay (climate_law.h relay_step(): the lead fan for one fan, both for
    two); None for a fan while one fan is requested and the lead is not known."""
    if relay in ("fan1", "fan2"):
        one, two = bool(requests & _REQUEST["fan1"]), bool(requests & _REQUEST["fan2"])
        if two or not one:
            return two
        return None if lead not in ("fan1", "fan2") else relay == lead
    bit = {"heat1": "heat1", "heat2": "heat2", "vent": "vent", "fog": "fog", "mister_any": "mist"}[relay]
    return bool(requests & _REQUEST[bit])


# ── Pure shaping ────────────────────────────────────────────────────────────


def _finite(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _flag(value: object) -> bool | None:
    number = _finite(value)
    return None if number is None else number != 0


def _int(value: object) -> int | None:
    number = _finite(value)
    return None if number is None else int(number)


def _age_s(observed_at: datetime | None, at: datetime) -> float | None:
    return None if observed_at is None else max(0.0, (at - observed_at).total_seconds())


def parse_record(value: str | None) -> ClimateLawState | None:
    """The law's state record, or None when there is none or it does not parse (the ingestor stores only valid
    rows)."""
    if value is None:
        return None
    try:
        return ClimateLawState.model_validate_json(value)
    except ValueError:
        return None


def gap_log_word(value: str | None) -> str | None:
    """``armed``, or the reason of an ``off: <reason>`` gap log state (gap_log.h); None for anything else."""
    if value is None:
        return None
    word = value[len(_GAP_LOG_OFF) :] if value.startswith(_GAP_LOG_OFF) else value
    return word if word in get_args(GapLog) else None


def lead_fan(value: str | None) -> str | None:
    return LEAD_FANS.get(value or "")


def band_differs(band: tuple[float, ...] | None, host: HostBandEdges | None) -> bool | None:
    """The band_device_db_divergence test on one record: any edge off by more than 1.0 F or 0.10 kPa."""
    if band is None or host is None:
        return None
    edges = (host.temp_low_f, host.temp_high_f, host.vpd_low_kpa, host.vpd_high_kpa)
    if any(edge is None for edge in edges):
        return None
    temp = max(abs(band[0] - edges[0]), abs(band[1] - edges[1]))  # type: ignore[operator]
    vpd = max(abs(band[2] - edges[2]), abs(band[3] - edges[3]))  # type: ignore[operator]
    return temp > BAND_DIFFERS_TEMP_F or vpd > BAND_DIFFERS_VPD_KPA


def drying_checks(record: ClimateLawState | None, temp_f: float | None, *, fresh: bool) -> list[DryingCheck]:
    """The law's drying decision in the order it refuses (climate_law.h step(), the dry_refusal chain), so the first
    check that fails is the record's refusal reason (``no_outdoor`` shows as ``outdoor_drier`` unknown).

    ``humid`` is the dry latch; ``not_cooling`` neither the cooling latch nor the hot limit; ``furnace_off`` the
    furnace latch off; ``outdoor_drier`` the air latch with a moisture difference above the least one (the law prices
    a run only then, so a cost at its no-price value means the difference is too small); ``warm_enough`` the house at
    or above the start line: from the refusal reason where it settles it, else ``temp_f`` against the band's low edge;
    ``worth_it`` the cost against the limit. The temperature and the cost decide only the start: a running run passed
    both and the law stops it on neither, so both are true while it runs (as ``outdoor_drier``, which a run needs).
    Each is None when the record cannot say: no fresh record, no indoor temperature (the law is off), no indoor
    humidity for ``humid``, no outdoor data for the outdoor checks.
    """
    ids: tuple[str, ...] = get_args(CheckId)
    if record is None or not fresh or record.dr == "no_temperature":
        return [DryingCheck(id=check, ok=None) for check in ids]  # type: ignore[arg-type]
    latches, requests, dr = record.l, record.o, record.dr
    running = bool(latches & _LATCH["run"])
    no_price = record.e is None
    humid = None if dr == "humidity_invalid" else bool(latches & _LATCH["dry"])
    if running:
        outdoor_drier: bool | None = True
    elif no_price:
        outdoor_drier = None
    else:
        outdoor_drier = bool(latches & _LATCH["air"]) and record.e < law_constants.DRY_COST_NONE_KWH_PER_KG
    if running:
        worth_it: bool | None = True
    elif no_price:
        worth_it = None
    else:
        worth_it = record.e <= record.lim
    if running or dr == "cost":
        warm_enough: bool | None = True  # the refusal chain reaches cost only at or above the start line
    elif dr == "too_cold":
        warm_enough = False
    elif temp_f is None:
        warm_enough = None
    else:
        warm_enough = temp_f >= record.b[0] + law_constants.DRY_START_ABOVE_LOW_F
    not_cooling = not (latches & _LATCH["cool"] or requests & _REQUEST["hot"])
    furnace_off = not latches & _LATCH["h2"]
    values = (humid, not_cooling, furnace_off, outdoor_drier, warm_enough, worth_it)
    return [DryingCheck(id=check, ok=ok) for check, ok in zip(ids, values, strict=True)]  # type: ignore[arg-type]


@dataclass(frozen=True)
class RelayNow:
    """A relay's newest state and the start of its newest run (None when the window shows no switch)."""

    on: bool | None
    since: datetime | None


def relay_now(track: reads.Track | None) -> RelayNow:
    if track is None or not track.spans:
        return RelayNow(on=None, since=None)
    state = track.spans[-1].state
    return RelayNow(on=None if state is None else bool(state), since=reads.run_since(track.spans))


def manual_held(bursts: Mapping[str, RelayNow]) -> frozenset[str]:
    """The relays a manual run holds now, or may hold because its flag is not known (``MANUAL_RUN_RELAYS``)."""
    held: set[str] = set()
    for flag, relays in MANUAL_RUN_RELAYS.items():
        state = bursts.get(flag)
        if state is None or state.on is not False:
            held.update(relays)
    return frozenset(held)


def rule_hold(
    rule_id: str,
    requested: bool,
    requests: int,
    relays: Mapping[str, RelayNow],
    lead: str | None,
    at: datetime,
    booted_at: datetime | None,
    held: frozenset[str] = frozenset(),
    fog_reason: str | None = None,
) -> LawHold | None:
    """What the host can prove from the relay's newest switch and the law's minimum times (climate_law.h
    relay_step()): the rule is requested, the relay is wanted and off inside its minimum off time (or the furnace's
    boot wait); or the rule is not requested, the relay is not wanted and on inside its minimum on time. A switch
    before the controller's last boot proves nothing (every relay is free at boot but the furnace), nor does a relay
    with no minimum time (the misters). At a protection limit only the fogger keeps its minimum times. The longest
    hold of the rule's relays.

    Something other than the law can hold a relay, and then the host cannot prove the hold: a manual run holds the
    relays in ``held`` (``manual_held()``); the irrigation engine shares the fogger's line and can run it while the law
    does not ask, so the fogger proves a minimum on time only at a protection limit, where the engine's run and a
    press are both off (climate_law_glue.h relay_pass()); and the fogger's other holds keep it off for their own
    reasons, so it proves a minimum off time only while the controller says so (``fog_reason`` ``relay_min_off``)."""
    if rule_id in _LIMIT_RULES or booted_at is None:
        return None
    at_limit = bool(requests & (_REQUEST["hot"] | _REQUEST["cold"]))
    best: LawHold | None = None
    for relay in rule_relays(rule_id, lead):
        times = RELAY_MIN_TIMES.get(relay)
        now = relays.get(relay)
        if times is None or now is None or now.on is None or relay in held:
            continue
        if at_limit and relay not in KEEPS_MIN_TIMES_AT_LIMITS:
            continue
        wanted = relay_wanted(relay, requests, lead)
        min_on, min_off = times
        hold: LawHold | None = None
        if requested and wanted is True and not now.on:
            if relay == "fog" and fog_reason != FOG_MIN_OFF_REASON:
                continue
            remaining = 0.0
            if now.since is not None and now.since >= booted_at:
                remaining = min_off - (at - now.since).total_seconds()
            if relay == "heat2" and not requests & _REQUEST["cold"]:
                remaining = max(remaining, FURNACE_BOOT_WAIT_S - (at - booted_at).total_seconds())
            if remaining > 0:
                hold = LawHold(kind="min_off", remaining_s=math.ceil(remaining))
        elif (
            not requested
            and wanted is False
            and now.on
            and (relay != "fog" or at_limit)
            and now.since is not None
            and now.since >= booted_at
        ):
            remaining = min_on - (at - now.since).total_seconds()
            if remaining > 0:
                hold = LawHold(kind="min_on", remaining_s=math.ceil(remaining))
        if hold is not None and (best is None or hold.remaining_s > best.remaining_s):
            best = hold
    return best


def rules_now(
    record: ClimateLawState | None,
    *,
    fresh: bool,
    relays: Mapping[str, RelayNow],
    lead: str | None,
    at: datetime,
    booted_at: datetime | None,
    held: frozenset[str] = frozenset(),
    fog_reason: str | None = None,
) -> list[LawRule]:
    """The nine rules in their fixed order, with thresholds from the band in use and the record's bits; while the
    record is not fresh the bits are null, the relays unknown and no hold is shown. ``held`` and ``fog_reason`` are
    ``rule_hold()``'s."""
    use = record if fresh else None
    band = use.b if use is not None else None
    out = []
    for rule in RULES:
        requested = None if use is None else bool(use.o & _REQUEST[rule.request])
        if use is None:
            latched = None
        elif rule.latch is None:
            latched = requested
        else:
            latched = bool(use.l & _LATCH[rule.latch])
        relay_rows = []
        for relay in rule_relays(rule.id, lead):
            now = relays.get(relay, RelayNow(None, None))
            state: RelayState = "unknown" if use is None or now.on is None else ("on" if now.on else "off")
            relay_rows.append(LawRelay(equipment=relay, state=state, since=now.since if use is not None else None))  # type: ignore[arg-type]
        limit = rule.id in _LIMIT_RULES
        out.append(
            LawRule(
                id=rule.id,  # type: ignore[arg-type]
                signal=rule.signal,
                direction=rule.direction,
                on_at=rule.on_at(band) if band is not None or limit else None,  # type: ignore[arg-type]
                off_at=rule.off_at(band) if band is not None or limit else None,  # type: ignore[arg-type]
                latched=latched,
                requested=requested,
                relays=relay_rows,
                hold=None
                if use is None
                else rule_hold(rule.id, bool(requested), use.o, relays, lead, at, booted_at, held, fog_reason),
            )
        )
    return out


def timing() -> LawTiming:
    return LawTiming(
        relay_min_on_s=law_constants.HEAT_MIN_ON_S,
        relay_min_off_s=law_constants.HEAT_MIN_OFF_S,
        fog_min_on_s=law_constants.FOG_MIN_ON_S,
        fog_min_off_s=law_constants.FOG_MIN_OFF_S,
        furnace_boot_wait_s=FURNACE_BOOT_WAIT_S,
        mist_pulse_s=law_constants.MISTER_PULSE_S,
        mist_gap_s=law_constants.MISTER_GAP_S,
        hot_limit_f=law_constants.SAFETY_MAX_F,
        cold_limit_f=law_constants.SAFETY_MIN_F,
    )


def drying_meter(value: str | None, observed_at: datetime | None) -> DryingMeter:
    try:
        meter = ClimateDryingMeter.model_validate_json(value) if value is not None else None
    except ValueError:
        meter = None
    if meter is None:
        return DryingMeter(seconds=None, water_g=None, heat_wh=None, refused_seconds=None, observed_at=None)
    return DryingMeter(
        seconds=float(meter.s),
        water_g=float(meter.g),
        heat_wh=float(meter.wh),
        refused_seconds=float(meter.rw),
        observed_at=observed_at,
    )


def drying_today(row: Mapping[str, Any] | None) -> DryingToday | None:
    if row is None:
        return None
    lower = row["drying_meter_lower_bound"]
    return DryingToday(
        seconds=_finite(row["drying_s"]),
        runs=_int(row["drying_runs"]),
        water_g=_finite(row["drying_water_g"]),
        heat_wh=_finite(row["drying_heat_wh"]),
        lower_bound=None if lower is None else bool(lower),
    )


def outdoor_input(row: Mapping[str, Any], at: datetime) -> OutdoorInput:
    """The outdoor reading the law uses: the station first, the intake probe second (outdoor_source)."""
    source_at = row["outdoor_source_at"]
    source = row["outdoor_source"] if source_at is not None and at - source_at <= OUTDOOR_SOURCE_FRESH else None
    if source == "station":
        temp, rh = _finite(row["outdoor_temp_f"]), _finite(row["outdoor_rh_pct"])
    elif source == "intake":
        temp, rh = _finite(row["temp_intake"]), _finite(row["intake_rh"])
    else:
        temp = rh = None
    return OutdoorInput(
        source=source if source in get_args(OutdoorSource) else None,
        temp_f=temp,
        rh_pct=rh,
        dew_point_f=outdoor_dew_point(temp, rh),
    )


def outdoor_dew_point(temp_f: float | None, rh_pct: float | None) -> float | None:
    """The outdoor dew point from the served outdoor pair; no stored column holds it, so the host computes it.

    Null when either reading is missing or the humidity is not above zero. Served unrounded, as the indoor dew point
    beside it is served as stored.
    """
    if temp_f is None or rh_pct is None or rh_pct <= 0:
        return None
    return _finite(outdoor_dewpoint_f(temp_f, rh_pct))


def law_view(
    row: Mapping[str, Any], tracks: Mapping[str, reads.Track], limit_row_value: object | None, has_limit_row: bool
) -> LawView:
    """API-30 from the one snapshot row, the relays' tracks and the owner's drying cost limit row (pure)."""
    at: datetime = row["at"]
    law_at: datetime | None = row["law_at"]
    record = parse_record(row["law_value"])
    state = reads.law_state(row["law_value"], law_at, at)
    fresh = state is not None and record is not None
    use = record if fresh else None
    band = use.b if use is not None else None

    host_edges = (row["host_temp_low"], row["host_temp_high"], row["host_vpd_low"], row["host_vpd_high"])
    host = (
        None
        if all(edge is None for edge in host_edges)
        else HostBandEdges(
            temp_low_f=_finite(host_edges[0]),
            temp_high_f=_finite(host_edges[1]),
            vpd_low_kpa=_finite(host_edges[2]),
            vpd_high_kpa=_finite(host_edges[3]),
        )
    )
    band_source = row["band_source"]
    law_band = LawBand(
        temp_low_f=band[0] if band else None,
        temp_high_f=band[1] if band else None,
        vpd_low_kpa=band[2] if band else None,
        vpd_high_kpa=band[3] if band else None,
        repaired=bool(use.br) if use is not None else None,
        source=band_source if band_source in get_args(BandSource) else None,
        host=host,
        differs=band_differs(band, host),
    )

    climate_at: datetime | None = row["climate_at"]
    inputs = LawInputs(
        temp_f=_finite(row["temp_control"]),
        vpd_kpa=_finite(row["vpd_control"]),
        rh_pct=_finite(row["rh_avg"]),
        dew_point_f=_finite(row["dew_point"]),
        outdoor=outdoor_input(row, at),
        observed_at=climate_at,
    )

    lead = lead_fan(row["lead_fan"])
    relays = {key: relay_now(tracks.get(key)) for key in LAW_RELAYS}
    uptime, uptime_at = _finite(row["uptime_s"]), row["uptime_at"]
    booted_at = uptime_at - timedelta(seconds=uptime) if uptime is not None and uptime_at is not None else None
    held = manual_held({flag: relay_now(tracks.get(flag)) for flag in MANUAL_RUN_RELAYS})
    rules = rules_now(
        record,
        fresh=fresh,
        relays=relays,
        lead=lead,
        at=at,
        booted_at=booted_at,
        held=held,
        fog_reason=row["fog_block_reason"],
    )

    # The temperature the drying checks compare: the climate row of the record's moment (within the law's freshness).
    temp_for_checks = (
        inputs.temp_f
        if use is not None
        and climate_at is not None
        and abs((climate_at - law_at).total_seconds()) <= LAW_HEARTBEAT_MAX_AGE_S  # type: ignore[operator]
        else None
    )
    drying = LawDrying(
        state=state.drying if state is not None else "unknown",
        wanted=bool(use.l & _LATCH["dry"]) if use is not None else None,
        outdoor_drier=bool(use.l & _LATCH["air"]) if use is not None else None,
        refused_reason=use.dr if use is not None and use.dr in _REFUSALS else None,  # type: ignore[arg-type]
        cost_kwh_per_kg=state.drying_cost_kwh_per_kg if state is not None else None,
        limit_kwh_per_kg=state.drying_cost_limit_kwh_per_kg if state is not None else None,
        limit_source="owner" if has_limit_row and limit_row_value is not None else "default",
        wanted_below_kpa=band[2] + law_constants.DRY_ON_ABOVE_VPD_LOW_KPA if band else None,
        stop_above_kpa=band[2] + law_constants.DRY_OFF_ABOVE_VPD_LOW_KPA if band else None,
        min_temp_f=band[0] + law_constants.DRY_START_ABOVE_LOW_F if band else None,
        checks=drying_checks(record, temp_for_checks, fresh=fresh),
        meter=drying_meter(row["meter_value"], row["meter_at"]),
        today=drying_today(row.get("today")),
    )

    heartbeat_age = _age_s(row["heartbeat_at"], at)
    ingestor_alive = heartbeat_age is not None and heartbeat_age <= reads.HEARTBEAT_STALE_S
    alone = LawAlone(
        clock=AloneClock(valid=_flag(row["sntp_valid"]), sync_age_s=_finite(row["last_sntp_sync_age_s"])),
        probes=AloneProbes(active=_int(row["active_probe_count"]), degraded=_flag(row["sensor_degraded_active"])),
        # A fresh law record reached the host: it is connected. A live ingestor hearing none: it is not.
        host=AloneHost(connected=True if fresh else (False if ingestor_alive else None), heartbeat_age_s=heartbeat_age),
        gap_log=gap_log_word(row["gap_log_state"]),  # type: ignore[arg-type]
    )

    reported = row["constants_value"]
    reported = reported if reported is not None and LAW_CONSTANTS_HASH.fullmatch(reported) else None
    constants = LawConstants(
        hash=reported,
        release_hash=law_constants.CONSTANTS_SHA256,
        matches=None if reported is None else reported == law_constants.CONSTANTS_SHA256,
        observed_at=row["constants_at"] if reported is not None else None,
    )

    return LawView(
        server_time=at,
        observed_at=law_at,
        reporting=fresh,
        band=law_band,
        inputs=inputs,
        rules=rules,
        drying=drying,
        timing=timing(),
        lead_fan=lead,  # type: ignore[arg-type]
        alone=alone,
        constants=constants,
    )


# ── API-31 shaping ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Island:
    """A run of law records with one key: its first and last record, the record after it (None for the newest) and
    the key's decoded fields."""

    start: datetime
    last: datetime
    next: datetime | None
    key: Any


def segments(
    islands: Sequence[Island], start: datetime, end: datetime, max_gap: timedelta
) -> list[tuple[datetime, datetime, Any]]:
    """The window [start, end) as contiguous (start, end, key) pieces, ``key`` None where unknown (pure).

    An island holds from its first record until the next record; a span of more than ``max_gap`` with no record (the
    gap after an island, before the first record, or after the newest) is unknown in full."""
    pieces: list[tuple[datetime, datetime, Any]] = []

    def add(low: datetime, high: datetime, key: Any) -> None:
        low, high = max(low, start), min(high, end)
        if low < high:
            pieces.append((low, high, key))

    if not islands:
        add(start, end, None)
        return pieces
    add(start, islands[0].start, None)
    for island in islands:
        if island.next is not None:
            if island.next - island.last > max_gap:
                add(island.start, island.last, island.key)
                add(island.last, island.next, None)
            else:
                add(island.start, island.next, island.key)
        elif end - island.last > max_gap:
            add(island.start, island.last, island.key)
            add(island.last, end, None)
        else:
            add(island.start, end, island.key)
    return pieces


def merge(pieces: Sequence[tuple[datetime, datetime, Hashable]]) -> list[tuple[datetime, datetime, Hashable]]:
    """Join contiguous pieces with the same value (pure)."""
    out: list[tuple[datetime, datetime, Hashable]] = []
    for low, high, value in pieces:
        if out and out[-1][2] == value and out[-1][1] == low:
            out[-1] = (out[-1][0], high, value)
        else:
            out.append((low, high, value))
    return out


@dataclass(frozen=True)
class RecordKey:
    """The fields of a law record the history follows (the drying cost is bucketed separately)."""

    l: int  # noqa: E741 (the wire key)
    o: int
    dr: str | None
    br: int | None


def drying_word(key: RecordKey | None) -> tuple[DryingState, str | None]:
    """The drying state of a record as ``reads.law_state()`` words it, and the refusal reason while refused."""
    if key is None:
        return "unknown", None
    if key.l & _LATCH["run"]:
        return "running", None
    if not key.l & _LATCH["dry"]:
        return "not_wanted", None
    return "refused", key.dr if key.dr not in (None, "none") else None


def history_lanes(pieces: Sequence[tuple[datetime, datetime, RecordKey | None]]) -> list[LawLane]:
    lanes = []
    for key, group, bit in LANES:

        def state(record: RecordKey | None, group: str = group, bit: int = bit) -> RelayState:
            if record is None:
                return "unknown"
            return "on" if (record.o if group == "request" else record.l) >> bit & 1 else "off"

        intervals = merge([(low, high, state(record)) for low, high, record in pieces])
        lanes.append(
            LawLane(
                key=key,  # type: ignore[arg-type]
                group=group,
                intervals=[LawInterval(start=low, end=high, state=value) for low, high, value in intervals],  # type: ignore[arg-type]
            )
        )
    return lanes


def history_drying(pieces: Sequence[tuple[datetime, datetime, RecordKey | None]]) -> list[DryingInterval]:
    merged = merge([(low, high, drying_word(record)) for low, high, record in pieces])
    return [
        DryingInterval(start=low, end=high, state=word[0], reason=word[1])  # type: ignore[index]
        for low, high, word in merged
    ]


def history_band_repaired(pieces: Sequence[tuple[datetime, datetime, RecordKey | None]]) -> list[Span]:
    merged = merge([(low, high, record is not None and record.br == 1) for low, high, record in pieces])
    return [Span(start=low, end=high) for low, high, repaired in merged if repaired]


def history_outdoor(pieces: Sequence[tuple[datetime, datetime, str | None]]) -> list[OutdoorSourceInterval]:
    words = [(low, high, value if value in get_args(OutdoorSource) else "unknown") for low, high, value in pieces]
    return [OutdoorSourceInterval(start=low, end=high, source=word) for low, high, word in merge(words)]  # type: ignore[arg-type]


def bucket_columns(
    axis: Sequence[datetime], rows: Sequence[Mapping[str, Any]], names: Sequence[str]
) -> dict[str, list[float | None]]:
    """Place each bucket row's averages on the axis; an empty bucket is null (pure)."""
    index = {series._epoch(start): position for position, start in enumerate(axis)}
    columns: dict[str, list[float | None]] = {name: [None] * len(axis) for name in names}
    for row in rows:
        position = index.get(series._epoch(row["bucket"]))
        if position is None:
            continue
        for name in names:
            columns[name][position] = _finite(row[name])
    return columns


# ── SQL ─────────────────────────────────────────────────────────────────────

# API-30 in one statement: one now(), each entity's newest row through its (entity, ts) index inside a bounded
# window, diagnostics as the newest non-null value of each column over 15 minutes (api/product_metrics.py
# CONTROLLER_SQL and HEALTH_SQL), the newest climate row of the last day, the host band now, the controller's
# Lead Fan entity (null until the controller publishes it: no fan start is read as a lead) and its newest
# fog_block_reason (published on change, so looked up over Now's newest-row window).
VIEW_SQL = """
SELECT now() AS at,
       law.value AS law_value, law.ts AS law_at,
       meter.value AS meter_value, meter.ts AS meter_at,
       hash.value AS constants_value, hash.ts AS constants_at,
       outdoor.value AS outdoor_source, outdoor.ts AS outdoor_source_at,
       (SELECT max(ts) FROM system_state WHERE entity = $5 AND ts > now() - interval '1 day') AS heartbeat_at,
       c.ts AS climate_at, c.temp_control, c.vpd_control, c.rh_avg, c.dew_point,
       c.outdoor_temp_f, c.outdoor_rh_pct, c.temp_intake, c.intake_rh,
       host.temp_low AS host_temp_low, host.temp_high AS host_temp_high,
       host.vpd_low AS host_vpd_low, host.vpd_high AS host_vpd_high,
       d.band_source, d.sntp_valid, d.last_sntp_sync_age_s, d.active_probe_count, d.sensor_degraded_active,
       d.gap_log_state, d.uptime_s, d.uptime_at,
       (SELECT value FROM system_state WHERE entity = $6 AND ts > now() - $7::interval
         ORDER BY ts DESC LIMIT 1) AS lead_fan,
       (SELECT value FROM system_state WHERE entity = $8 AND ts > now() - $9::interval
         ORDER BY ts DESC LIMIT 1) AS fog_block_reason
  FROM (SELECT 1) AS anchor
  LEFT JOIN LATERAL (SELECT value, ts FROM system_state
                      WHERE entity = $1 AND ts > now() - $7::interval ORDER BY ts DESC LIMIT 1) AS law ON true
  LEFT JOIN LATERAL (SELECT value, ts FROM system_state
                      WHERE entity = $2 AND ts > now() - $7::interval ORDER BY ts DESC LIMIT 1) AS meter ON true
  LEFT JOIN LATERAL (SELECT value, ts FROM system_state
                      WHERE entity = $3 AND ts > now() - $7::interval ORDER BY ts DESC LIMIT 1) AS hash ON true
  LEFT JOIN LATERAL (SELECT value, ts FROM system_state
                      WHERE entity = $4 AND ts > now() - $7::interval ORDER BY ts DESC LIMIT 1) AS outdoor ON true
  LEFT JOIN LATERAL (SELECT ts, temp_control, vpd_control, rh_avg, dew_point, outdoor_temp_f, outdoor_rh_pct,
                            temp_intake, intake_rh
                       FROM climate WHERE ts > now() - interval '1 day' ORDER BY ts DESC LIMIT 1) AS c ON true
  LEFT JOIN LATERAL public.fn_band_setpoints(now()) AS host ON true
  LEFT JOIN LATERAL (
        SELECT (array_agg(band_source ORDER BY ts DESC) FILTER (WHERE band_source IS NOT NULL))[1] AS band_source,
               (array_agg(sntp_valid ORDER BY ts DESC) FILTER (WHERE sntp_valid IS NOT NULL))[1] AS sntp_valid,
               (array_agg(last_sntp_sync_age_s ORDER BY ts DESC)
                    FILTER (WHERE last_sntp_sync_age_s IS NOT NULL))[1] AS last_sntp_sync_age_s,
               (array_agg(active_probe_count ORDER BY ts DESC)
                    FILTER (WHERE active_probe_count IS NOT NULL))[1] AS active_probe_count,
               (array_agg(sensor_degraded_active ORDER BY ts DESC)
                    FILTER (WHERE sensor_degraded_active IS NOT NULL))[1] AS sensor_degraded_active,
               (array_agg(gap_log_state ORDER BY ts DESC) FILTER (WHERE gap_log_state IS NOT NULL))[1] AS gap_log_state,
               (array_agg(uptime_s ORDER BY ts DESC) FILTER (WHERE uptime_s IS NOT NULL))[1] AS uptime_s,
               (array_agg(ts ORDER BY ts DESC) FILTER (WHERE uptime_s IS NOT NULL))[1] AS uptime_at
          FROM diagnostics
         WHERE ts > now() - interval '15 minutes') AS d ON true
"""

# Today's daily_record row (America/Denver day), the drying columns.
TODAY_SQL = """
SELECT drying_s, drying_runs, drying_water_g, drying_heat_wh, drying_meter_lower_bound
  FROM daily_record
 WHERE greenhouse_id = $1 AND date = (now() AT TIME ZONE 'America/Denver')::date
"""

# The owner's drying cost limit, when a desired row holds one.
LIMIT_SQL = """
SELECT value FROM v_desired_state_current WHERE greenhouse_id = $1 AND param = $2
"""

# API-31: the law records of [$2, $3) decoded in SQL, cut where the followed fields change or a span of more than $4
# has no record, and returned one row per run: its first and last record and the record after it. One range scan of
# the (entity, ts) index over the window's chunks. Only version 1 records with both bit fields are read (the version
# API-30's parse_record accepts); any other row is no record, so its span reads as unknown.
ISLANDS_SQL = """
WITH d AS (
    SELECT ts, (value::jsonb ->> 'l')::bigint AS l, (value::jsonb ->> 'o')::bigint AS o,
           value::jsonb ->> 'dr' AS dr, (value::jsonb ->> 'br')::int AS br
      FROM system_state
     WHERE entity = $1 AND ts >= $2::timestamptz AND ts < $3::timestamptz
       AND value::jsonb ->> 'v' = '1'
       AND jsonb_typeof(value::jsonb -> 'l') = 'number' AND jsonb_typeof(value::jsonb -> 'o') = 'number'
), e AS (
    SELECT ts, l, o, dr, br, lead(ts) OVER w AS next_ts,
           CASE WHEN lag(ts) OVER w IS NULL OR ts - lag(ts) OVER w > $4::interval
                  OR ROW(lag(l) OVER w, lag(o) OVER w, lag(dr) OVER w, lag(br) OVER w) IS DISTINCT FROM ROW(l, o, dr, br)
                THEN 1 ELSE 0 END AS starts
      FROM d
    WINDOW w AS (ORDER BY ts, l, o, dr, br)
), i AS (
    SELECT ts, l, o, dr, br, next_ts, sum(starts) OVER (ORDER BY ts, l, o, dr, br) AS island FROM e
)
SELECT min(ts) AS start_ts, max(ts) AS last_ts, (array_agg(next_ts ORDER BY ts DESC))[1] AS next_ts,
       min(l) AS l, min(o) AS o, min(dr) AS dr, min(br) AS br
  FROM i
 GROUP BY island
 ORDER BY start_ts
"""

# The outdoor source's runs over [$2, $3), the same way.
SOURCE_ISLANDS_SQL = """
WITH e AS (
    SELECT ts, value, lead(ts) OVER w AS next_ts,
           CASE WHEN lag(ts) OVER w IS NULL OR ts - lag(ts) OVER w > $4::interval
                  OR lag(value) OVER w IS DISTINCT FROM value
                THEN 1 ELSE 0 END AS starts
      FROM system_state
     WHERE entity = $1 AND ts >= $2::timestamptz AND ts < $3::timestamptz
    WINDOW w AS (ORDER BY ts, value)
), i AS (
    SELECT ts, value, next_ts, sum(starts) OVER (ORDER BY ts, value) AS island FROM e
)
SELECT min(ts) AS start_ts, max(ts) AS last_ts, (array_agg(next_ts ORDER BY ts DESC))[1] AS next_ts,
       min(value) AS value
  FROM i
 GROUP BY island
 ORDER BY start_ts
"""

# The drying cost (without its no-price value), its limit and the band, averaged per bucket over [$2, $3).
BUCKETS_SQL = """
SELECT time_bucket($4::interval, ts) AS bucket,
       avg(CASE WHEN e < $5 THEN e END) AS cost_kwh_per_kg, avg(lim) AS limit_kwh_per_kg,
       avg(b0) AS temp_low_f, avg(b1) AS temp_high_f, avg(b2) AS vpd_low_kpa, avg(b3) AS vpd_high_kpa
  FROM (SELECT ts, (value::jsonb ->> 'e')::float8 AS e, (value::jsonb ->> 'lim')::float8 AS lim,
               (value::jsonb -> 'b' ->> 0)::float8 AS b0, (value::jsonb -> 'b' ->> 1)::float8 AS b1,
               (value::jsonb -> 'b' ->> 2)::float8 AS b2, (value::jsonb -> 'b' ->> 3)::float8 AS b3
          FROM system_state
         WHERE entity = $1 AND ts >= $2::timestamptz AND ts < $3::timestamptz
           AND value::jsonb ->> 'v' = '1') AS r
 GROUP BY 1
 ORDER BY 1
"""
# The same in America/Denver day buckets (the ladder's last step; a 31-day window never reaches it at 1,500 points).
DAY_BUCKETS_SQL = BUCKETS_SQL.replace(
    "time_bucket($4::interval, ts)", "time_bucket($4::interval, ts, 'America/Denver')"
)

# The first law record ever (LAW_RECORDS_FROM bounds the scan); API-32's law_started is its local day.
FIRST_RECORD_SQL = """
SELECT ts FROM system_state WHERE entity = $1 AND ts >= $2::timestamptz ORDER BY ts LIMIT 1
"""


# ── Reads ───────────────────────────────────────────────────────────────────


async def law(conn: asyncpg.Connection) -> LawView:
    """API-30 ``GET /v1/law``: what the controller's law is doing now and why, in one bounded read."""
    async with series._read_transaction(conn, "repeatable_read"):
        row = await conn.fetchrow(
            VIEW_SQL,
            LAW_STATE_ENTITY,
            DRYING_METER_ENTITY,
            CONSTANTS_ENTITY,
            OUTDOOR_SOURCE_ENTITY,
            reads.HEARTBEAT_ENTITY,
            LEAD_FAN_ENTITY,
            NEWEST_WINDOW,
            FOG_BLOCK_REASON_ENTITY,
            reads.NEWEST_ROW_WINDOW,
        )
        today = await conn.fetchrow(TODAY_SQL, reads.GREENHOUSE_ID)
        limit_row = await conn.fetchrow(LIMIT_SQL, reads.GREENHOUSE_ID, DRY_COST_LIMIT_PARAM)
        tracks = await reads.equipment_tracks(conn, (*LAW_RELAYS, *MANUAL_RUN_RELAYS))
    snapshot = {**dict(row), "today": today}
    return law_view(snapshot, tracks, limit_row["value"] if limit_row else None, limit_row is not None)


async def history(
    conn: asyncpg.Connection, from_: datetime, to: datetime, *, now: datetime | None = None
) -> LawHistory:
    """API-31 ``GET /v1/law/history``: the law's decisions over [from_, to), at most 31 days (API-05's window rules).

    Intervals end at the window's end or now. The cost and band columns cover the whole window on the API-04 ladder
    at most 1,500 points; buckets with no record (or ahead of now) are null.
    """
    now = series._now(now)
    from_, to = series._validate_window(from_, to, series.MAX_STATES_WINDOW)
    end = min(to, now)
    bucket_s = series.choose_bucket(from_, to, HISTORY_POINTS)
    axis = series.bucket_starts(from_, to, bucket_s)
    islands: list[Island] = []
    source_islands: list[Island] = []
    bucket_rows: list[Any] = []
    first_record_at: datetime | None = None
    async with series._read_transaction(conn, "repeatable_read"):
        first_record_at = await conn.fetchval(FIRST_RECORD_SQL, LAW_STATE_ENTITY, LAW_RECORDS_FROM)
        if from_ < end:
            rows = await conn.fetch(ISLANDS_SQL, LAW_STATE_ENTITY, from_ - LAW_RECORD_GAP, end, LAW_RECORD_GAP)
            islands = [
                Island(
                    row["start_ts"],
                    row["last_ts"],
                    row["next_ts"],
                    RecordKey(l=int(row["l"]), o=int(row["o"]), dr=row["dr"], br=row["br"]),
                )
                for row in rows
            ]
            rows = await conn.fetch(
                SOURCE_ISLANDS_SQL, OUTDOOR_SOURCE_ENTITY, from_ - OUTDOOR_SOURCE_FRESH, end, OUTDOOR_SOURCE_FRESH
            )
            source_islands = [Island(row["start_ts"], row["last_ts"], row["next_ts"], row["value"]) for row in rows]
            sql = DAY_BUCKETS_SQL if bucket_s == series.DAY_S else BUCKETS_SQL
            bucket_rows = await conn.fetch(
                sql,
                LAW_STATE_ENTITY,
                from_,
                end,
                timedelta(seconds=bucket_s),
                law_constants.DRY_COST_NONE_KWH_PER_KG,
            )
    pieces = segments(islands, from_, end, LAW_RECORD_GAP) if from_ < end else []
    source_pieces = segments(source_islands, from_, end, OUTDOOR_SOURCE_FRESH) if from_ < end else []
    cost = bucket_columns(axis, bucket_rows, ("cost_kwh_per_kg", "limit_kwh_per_kg"))
    band = bucket_columns(axis, bucket_rows, ("temp_low_f", "temp_high_f", "vpd_low_kpa", "vpd_high_kpa"))
    t = [series._epoch(start) for start in axis]
    return LawHistory(
        from_=from_,
        to=to,
        first_record_at=first_record_at,
        lanes=history_lanes(pieces),
        drying=history_drying(pieces),
        outdoor_source=history_outdoor(source_pieces),
        band_repaired=history_band_repaired(pieces),
        cost=CostColumns(bucket_s=bucket_s, t=t, **cost),
        band=LawBandColumns(bucket_s=bucket_s, t=t, **band),
    )
