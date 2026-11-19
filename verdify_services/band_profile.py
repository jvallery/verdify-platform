"""The house band editor (#1334): API-23, the profile preview, and API-24, its one atomic Save.

API-23 reads the 24 house anchors as ``fn_crop_band_value`` resolves them, overlays a draft (simple profile fields,
which recompile their axis with midpoint shoulders, and Advanced raw anchors) and evaluates both with the harmonic
the controller runs at 10-min steps of the day's ``fn_solar_phase``, so the preview is the device's curve. It adds
the guardrails, the checks of ``verdify_schemas.band_profile.findings``, an expected night VPD ribbon and the night
heat estimate.

The edge form: the law reads only the low and high edges, so a draft may also give them directly, as the low and high
at solar noon (``*_day``) and at solar midnight (``*_night``) of either axis. Each low or high series given at least
one edge compiles with sunrise and sunset at the midpoint of noon and midnight, an edge left out keeping the band's own
value, all on the push step; a series given no edge keeps its four anchors. People no longer edit that axis's target:
a stored target whose curve stays between the new edges' curves all day stays as it is, and one whose curve would
leave them moves to the midpoint of the edges at all four anchors in the same draft, so the stored rows never
contradict the band. One axis may not be given in both forms. Both states carry their eight edges and whether each axis is simple in edges, and
the preview carries the law's switching offsets (``law_lines``) from the generated law constants.

API-24 stores the anchors a Save changes through the settings writer, one ``desired_state`` row and its
``crop_band_anchors`` rows per anchor, under one ``activity_log`` row (``band.write``) in one transaction. The
``desired_state`` insert trigger wakes the dispatcher, whose anchor sync (``ingestor/tasks/band_anchors.py``) pushes
the changed anchors; nothing here talks to the controller. Iris may not write the band (``read_only``).

Expected (achievable) night VPD (docs/research/w5/vpd-band.md §3; the pure model is ``verdify_schemas.vpd_envelope``,
shared with API-06's achievable band, #1433): indoor dewpoint is fitted as ``a + b·T_in + c·T_out + e·Td_out``
on the trailing 14 days' deep-night hours (sun below -6°) with no vent, fan, fog or mister running; the ribbon is
``es(T_target) - es(Td_in)`` at ±0.674·RMSE of dewpoint (p25-p75), from the forecast's outdoor values, at night steps
only. Night heat is 0.19 kW/°F × (target - outdoor) over the forecast's night hours.

Overlays (#1334 follow-up): the last 24 h of measured house temperature and VPD (``climate.temp_avg`` and ``vpd_avg``
as 10-min averages, API-04's read) placed on the preview's steps by America/Denver clock time, so a step before now
shows today's value and a later step yesterday's; and the day's outdoor forecast (``weather_forecast`` temperature and
VPD, the newest issue per hour, the read the expected-VPD ribbon already makes).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

import asyncpg
from pydantic import BaseModel, ConfigDict, Field

from verdify_schemas import climate_law_constants as K
from verdify_schemas.activity import ActivityLogRow
from verdify_schemas.band_profile import (
    BAND_MIN_WIDTH_F,
    BAND_MIN_WIDTH_KPA,
    DRY_ON_ABOVE_VPD_LOW_KPA,
    GUARDRAIL_TEMP_MAX_F,
    GUARDRAIL_TEMP_MIN_F,
    GUARDRAIL_VPD_MAX_KPA,
    GUARDRAIL_VPD_MIN_KPA,
    HOUSE_PARAMS,
    NIGHT_VPD_FLOOR_MIN_KPA,
    SAFETY_MARGIN_F,
    Axis,
    BandProfile,
    Finding,
    axis_of,
    compile_profile,
    curve_extremes,
    curve_min_at,
    decompose,
    findings,
    harmonic,
    is_night,
    is_simple,
    overshoot,
    param,
    series_points,
    snap,
    unchanged,
)
from verdify_schemas.band_rows import ANCHOR_KEYS, HOUSE_CROP, HOUSE_SERIES
from verdify_schemas.vpd_envelope import (
    DEEP_NIGHT_ALTITUDE_DEG,
    ENVELOPE_DAYS,
    MOISTURE_EQUIPMENT,
    DewpointFit,
    dewpoint_f,
    es_kpa,
    fit_dewpoint,
)
from verdify_schemas.vpd_envelope import expected_vpd as expected_ribbon
from verdify_services import activity, series, settings, vpd_envelope
from verdify_services.activity import WriteResult
from verdify_services.actor import Actor
from verdify_services.problems import ServiceError, problem
from verdify_services.series import BandCurve

GREENHOUSE_ID = "vallery"
HEAT_LOSS_KW_PER_F = 0.19  # research §3, measured
ACTION = "band.write"
TARGET = "house band"

_TEMP_FIELDS = ("temp_day", "temp_night", "temp_width_day", "temp_width_night")
_VPD_FIELDS = ("vpd_day", "vpd_night", "vpd_below_day", "vpd_above_day", "vpd_below_night", "vpd_above_night")
_TEMP_EDGES = ("temp_low_day", "temp_high_day", "temp_low_night", "temp_high_night")
_VPD_EDGES = ("vpd_low_day", "vpd_high_day", "vpd_low_night", "vpd_high_night")
EDGE_FIELDS = _TEMP_EDGES + _VPD_EDGES
# Each axis with its profile fields and its edge fields.
_AXES: tuple[tuple[Axis, tuple[str, ...], tuple[str, ...]], ...] = (
    ("temp", _TEMP_FIELDS, _TEMP_EDGES),
    ("vpd", _VPD_FIELDS, _VPD_EDGES),
)
# Day is the solar noon anchor, night the solar midnight anchor.
_EDGE_ANCHOR = {"day": "sm", "night": "mid"}

ENVELOPE_SQL = vpd_envelope.ENVELOPE_RANGE_SQL
FORECAST_SQL = series.forecast_rows_sql(["temp_f", "dew_point_f", "vpd_kpa"])
MEASURED_WINDOW = timedelta(hours=24)
# API-04's gap-filled raw read of the house average: a0 is temp_avg, a1 vpd_avg.
MEASURED_SQL = series.raw_series_sql("climate", ["temp_avg", "vpd_avg"], day_buckets=False)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BandProfilePatch(_Model):
    """Simple profile fields or edges to change; a field left out keeps the band's own value. Any temperature field
    recompiles the temperature series with midpoint shoulders, any VPD field the VPD series. An axis is given either
    as a target with its width or as edges, never both."""

    temp_day: float | None = Field(default=None, allow_inf_nan=False)
    temp_night: float | None = Field(default=None, allow_inf_nan=False)
    temp_width_day: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    temp_width_night: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    vpd_day: float | None = Field(default=None, allow_inf_nan=False)
    vpd_night: float | None = Field(default=None, allow_inf_nan=False)
    vpd_below_day: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    vpd_above_day: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    vpd_below_night: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    vpd_above_night: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    temp_low_day: float | None = Field(
        default=None, allow_inf_nan=False, description="Edge form: the low edge at solar noon, °F"
    )
    temp_high_day: float | None = Field(
        default=None, allow_inf_nan=False, description="Edge form: the high edge at solar noon, °F"
    )
    temp_low_night: float | None = Field(
        default=None, allow_inf_nan=False, description="Edge form: the low edge at solar midnight, °F"
    )
    temp_high_night: float | None = Field(
        default=None, allow_inf_nan=False, description="Edge form: the high edge at solar midnight, °F"
    )
    vpd_low_day: float | None = Field(
        default=None, allow_inf_nan=False, description="Edge form: the VPD low edge at solar noon, kPa"
    )
    vpd_high_day: float | None = Field(
        default=None, allow_inf_nan=False, description="Edge form: the VPD high edge at solar noon, kPa"
    )
    vpd_low_night: float | None = Field(
        default=None, allow_inf_nan=False, description="Edge form: the VPD low edge at solar midnight, kPa"
    )
    vpd_high_night: float | None = Field(
        default=None, allow_inf_nan=False, description="Edge form: the VPD high edge at solar midnight, kPa"
    )


class BandProfileEdges(_Model):
    """The band's low and high edges at solar noon (day) and solar midnight (night), as the anchors hold them."""

    temp_low_day: float = Field(description="temp_low at solar noon, °F")
    temp_high_day: float = Field(description="temp_high at solar noon, °F")
    temp_low_night: float = Field(description="temp_low at solar midnight, °F")
    temp_high_night: float = Field(description="temp_high at solar midnight, °F")
    vpd_low_day: float = Field(description="vpd_low at solar noon, kPa")
    vpd_high_day: float = Field(description="vpd_high at solar noon, kPa")
    vpd_low_night: float = Field(description="vpd_low at solar midnight, kPa")
    vpd_high_night: float = Field(description="vpd_high at solar midnight, kPa")


class BandEdgesSimple(_Model):
    """Per axis, true when the sunrise and sunset anchors of its low and high series are the midpoint of their noon
    and midnight values on the push step, so the eight edges describe the band in full."""

    temp: bool
    vpd: bool


class ProfileState(_Model):
    profile: BandProfile
    anchors: dict[str, float]
    simple: bool = Field(description="True when sunrise and sunset are the midpoint of noon and midnight")
    edges: BandProfileEdges
    edges_simple: BandEdgesSimple


class SunTimes(_Model):
    sunrise: int | None
    solar_noon: int | None
    sunset: int | None
    solar_midnight: int | None


class AxisPreview(_Model):
    current: BandCurve
    draft: BandCurve


class VpdPreview(AxisPreview):
    expected_low: list[float | None] = Field(
        description="Achievable night VPD (verdify_schemas.vpd_envelope), p25; null by day or without a forecast"
    )
    expected_high: list[float | None] = Field(description="Achievable night VPD, p75")


class Guardrails(_Model):
    temp_min_f: float = GUARDRAIL_TEMP_MIN_F
    temp_max_f: float = GUARDRAIL_TEMP_MAX_F
    margin_f: float = SAFETY_MARGIN_F
    vpd_min_kpa: float = GUARDRAIL_VPD_MIN_KPA
    vpd_max_kpa: float = GUARDRAIL_VPD_MAX_KPA
    night_vpd_floor_kpa: float = NIGHT_VPD_FLOOR_MIN_KPA
    min_width_f: float = BAND_MIN_WIDTH_F
    min_width_kpa: float = BAND_MIN_WIDTH_KPA
    dry_on_above_vpd_low_kpa: float = DRY_ON_ABOVE_VPD_LOW_KPA


class BandLawLines(_Model):
    """Where the law's rules switch on, as offsets from the band's edges, for the preview to draw (the generated
    law constants)."""

    heat1_on_above_low_f: float = Field(
        default=K.HEAT1_ON_ABOVE_LOW_F, description="The electric heater comes on below temp_low plus this, °F"
    )
    heat2_on_above_low_f: float = Field(
        default=K.HEAT2_ON_ABOVE_LOW_F, description="The furnace comes on below temp_low plus this, °F"
    )
    cool_on_above_high_f: float = Field(
        default=K.COOL_ON_ABOVE_HIGH_F, description="Cooling comes on above temp_high plus this, °F"
    )
    fan2_on_above_high_f: float = Field(
        default=K.FAN2_ON_ABOVE_HIGH_F, description="The second fan comes on above temp_high plus this, °F"
    )
    dry_on_above_vpd_low_kpa: float = Field(
        default=K.DRY_ON_ABOVE_VPD_LOW_KPA, description="Drying is wanted below vpd_low plus this, kPa"
    )
    fog_on_above_vpd_high_kpa: float = Field(
        default=K.FOG_ON_ABOVE_VPD_HIGH_KPA, description="The fogger comes on above vpd_high plus this, kPa"
    )
    mist_on_above_vpd_high_kpa: float = Field(
        default=K.MIST_ON_ABOVE_VPD_HIGH_KPA, description="The misters join above vpd_high plus this, kPa"
    )


class NightHeat(_Model):
    current: float | None
    draft: float | None


class EnvelopeFit(_Model):
    hours: int
    days: int
    rmse_f: float
    dewpoint_p10_f: float


class ProfileFinding(_Model):
    code: str
    severity: Literal["error", "warning"]
    field: str
    detail: str


class MeasuredOverlay(_Model):
    """The last 24 h of the house average on the preview's steps, by America/Denver clock time."""

    window_start: int = Field(description="Epoch seconds: the oldest 10-min bucket read (24 h before window_end)")
    window_end: int = Field(description="Epoch seconds: the end of the bucket holding now")
    at: list[int | None] = Field(description="Per step, the start of the bucket its values come from; null if none")
    temp: list[float | None] = Field(description="Measured house temperature (climate.temp_avg), °F; null in a gap")
    vpd: list[float | None] = Field(description="Measured house VPD (climate.vpd_avg), kPa; null in a gap")


class ForecastOverlay(_Model):
    """The day's outdoor forecast on the preview's steps: each hour's newest issue on every step of that hour."""

    temp: list[float | None] = Field(description="Outdoor forecast temperature, °F; null without a forecast hour")
    vpd: list[float | None] = Field(description="Outdoor forecast VPD, kPa; null without a forecast hour")
    issued_at: datetime | None = Field(description="The newest fetched_at behind the values; null with none")


class BandProfilePreview(_Model):
    day: date
    step_s: Literal[600]
    t: list[int]
    sun: SunTimes
    current: ProfileState
    draft: ProfileState
    changed: list[str]
    temp: AxisPreview
    vpd: VpdPreview
    guardrails: Guardrails
    law_lines: BandLawLines
    overshoot: dict[str, float]
    night_heat_kwh: NightHeat
    envelope: EnvelopeFit | None
    findings: list[ProfileFinding]
    measured: MeasuredOverlay
    forecast: ForecastOverlay


class BandWrite(_Model):
    """API-24's answer: the stored row of every anchor the Save changed, in anchor order."""

    changed: list[settings.DesiredSetting]


# ── pure ────────────────────────────────────────────────────────────────────


def anchors_from_rows(rows: Iterable[Any]) -> dict[str, float]:
    """The house anchors as ``fn_crop_band_value`` resolves them (current season over ``all``), by param."""
    resolved = series.resolve_anchors(rows)
    return {
        f"band_{series_name}_{anchor}": float(value)
        for (series_name, anchor), value in resolved.items()
        if series_name in HOUSE_SERIES and anchor in ANCHOR_KEYS and value is not None
    }


def parse_anchor_overrides(items: Iterable[str]) -> dict[str, float]:
    """``band_temp_low_sr:62.5`` items as {param: value}; anything else is 400 or 422."""
    out: dict[str, float] = {}
    for item in items:
        name, sep, raw = item.partition(":")
        if not sep:
            raise ServiceError(problem("invalid_request", "anchor is param:value", field="anchor"))
        try:
            out[name] = float(raw)
        except ValueError:
            raise ServiceError(problem("invalid_request", f"{name}'s value is not a number", field="anchor")) from None
    return out


def edge_axes(patch: BandProfilePatch | None) -> tuple[Axis, ...]:
    """The axes the patch gives in edge form."""
    fields = patch.model_dump(exclude_none=True) if patch is not None else {}
    return tuple(axis for axis, _, edge_names in _AXES if any(name in fields for name in edge_names))


def _edge_param(field: str) -> str:
    """``temp_low_day`` -> ``band_temp_low_sm``."""
    series_name, _, time = field.rpartition("_")
    return param(series_name, _EDGE_ANCHOR[time])


def _dips_below(lower: Sequence[float], upper: Sequence[float]) -> bool:
    """Does the curve of ``upper`` fall below the curve of ``lower`` anywhere in the day? The harmonic is linear in
    its anchors, so this is the gap curve's minimum, with the tolerance of ``findings``' order check."""
    gap = tuple(high - low for high, low in zip(upper, lower, strict=True))
    return curve_extremes(gap)[0] < -1e-9  # type: ignore[arg-type]


def compile_edges(anchors: Mapping[str, float], edges: Mapping[str, float]) -> dict[str, float]:
    """The anchors of every axis given in ``edges``. Each of its low and high series given at least one edge takes the
    given noon and midnight values (the band's own where an edge is left out) with sunrise and sunset at their
    midpoint, all snapped; a series given no edge keeps its anchors. Its target series stays when its curve lies
    between the new low and high curves all day, and otherwise moves, at all four anchors, to the snapped midpoint of
    the low and high: that series' curve is the midpoint of theirs, so it lies between them wherever they are ordered.
    """
    out: dict[str, float] = {}
    for axis, _, edge_names in _AXES:
        if not any(name in edges for name in edge_names):
            continue
        for side in ("low", "high"):
            series_name = f"{axis}_{side}"
            if not any(f"{series_name}_{time}" in edges for time in _EDGE_ANCHOR):
                continue
            noon = snap(edges.get(f"{series_name}_day", anchors[param(series_name, "sm")]), axis)
            midnight = snap(edges.get(f"{series_name}_night", anchors[param(series_name, "mid")]), axis)
            shoulder = snap((noon + midnight) / 2.0, axis)
            for anchor, value in zip(ANCHOR_KEYS, (shoulder, noon, shoulder, midnight), strict=True):
                out[param(series_name, anchor)] = value
        compiled = {**anchors, **out}
        low, high = series_points(compiled, f"{axis}_low"), series_points(compiled, f"{axis}_high")
        target = series_points(compiled, f"{axis}_target")
        if _dips_below(low, target) or _dips_below(target, high):
            for anchor, lo, hi in zip(ANCHOR_KEYS, low, high, strict=True):
                out[param(f"{axis}_target", anchor)] = snap((lo + hi) / 2.0, axis)
    return out


def _one_form_per_axis(fields: Mapping[str, float]) -> None:
    for axis, profile_names, edge_names in _AXES:
        edge = next((name for name in edge_names if name in fields), None)
        profile = next((name for name in profile_names if name in fields), None)
        if edge is not None and profile is not None:
            raise ServiceError(
                problem(
                    "invalid_request",
                    f"Give the {axis} band either as edges or as a target and width, not both ({edge} and {profile})",
                    field=edge,
                )
            )


def draft_anchors(
    current: Mapping[str, float], patch: BandProfilePatch | None, overrides: Mapping[str, float] | None
) -> dict[str, float]:
    """The anchors a Save would store: the band's own, the patched axes recompiled (from the profile or from the
    edges), then the raw overrides."""
    draft = dict(current)
    fields = patch.model_dump(exclude_none=True) if patch is not None else {}
    _one_form_per_axis(fields)
    profile_fields = {name: value for name, value in fields.items() if name not in EDGE_FIELDS}
    if profile_fields:
        profile = BandProfile.model_validate({**decompose(current).model_dump(), **profile_fields})
        compiled = compile_profile(profile)
        for axis_fields, axis in ((_TEMP_FIELDS, "temp"), (_VPD_FIELDS, "vpd")):
            if any(name in profile_fields for name in axis_fields):
                draft.update({name: value for name, value in compiled.items() if axis_of(name) == axis})
    draft.update(compile_edges(draft, {name: value for name, value in fields.items() if name in EDGE_FIELDS}))
    for name, value in (overrides or {}).items():
        if name not in HOUSE_PARAMS:
            raise ServiceError(problem("unknown_target", f"{name!r} is not a house band anchor", field="anchor"))
        if not math.isfinite(value):
            raise ServiceError(problem("out_of_range", f"{name} must be a finite number", field=name))
        settings.check_range(name, value)
        draft[name] = snap(value, axis_of(name))
    return draft


def changed_params(current: Mapping[str, float], draft: Mapping[str, float]) -> list[str]:
    return [name for name in HOUSE_PARAMS if not unchanged(current[name], draft[name], axis_of(name))]


def edges_of(anchors: Mapping[str, float]) -> BandProfileEdges:
    """The eight edges as the anchors hold them: each axis's low and high at solar noon and solar midnight."""
    return BandProfileEdges(**{name: float(anchors[_edge_param(name)]) for name in EDGE_FIELDS})


def edges_simple(anchors: Mapping[str, float]) -> BandEdgesSimple:
    """Per axis: are the sunrise and sunset anchors of its low and high series the snapped midpoint of their noon and
    midnight values (within half a push step, as ``is_simple`` compares)?"""

    def simple(axis: Axis) -> bool:
        for side in ("low", "high"):
            sr, sm, ss, mid = series_points(anchors, f"{axis}_{side}")
            shoulder = snap((snap(sm, axis) + snap(mid, axis)) / 2.0, axis)
            if not (unchanged(sr, shoulder, axis) and unchanged(ss, shoulder, axis)):
                return False
        return True

    return BandEdgesSimple(temp=simple("temp"), vpd=simple("vpd"))


def state_of(anchors: Mapping[str, float]) -> ProfileState:
    return ProfileState(
        profile=decompose(anchors),
        anchors=dict(anchors),
        simple=is_simple(anchors),
        edges=edges_of(anchors),
        edges_simple=edges_simple(anchors),
    )


def edge_field(finding: Finding | ProfileFinding, anchors: Mapping[str, float], given: Iterable[str] = ()) -> str:
    """The edge field a band check's finding is about, for an axis the draft gives as edges. The checks name the
    profile fields; this names the edge the operator moves instead: the floor or ceiling that leaves a guardrail,
    the night low edge for the night floor, where the band is too narrow the edge given at that time of day (the high
    edge when both or neither are given), and where it is out of order the edge the target crossed (``findings``
    names the upper series: the target when it fell below the low edge, the high series when the target rose above
    it) at the time of day the crossing is deepest. Other findings keep their field."""
    code, field = finding.code, finding.field
    axis = axis_of(field)

    def at(series_name: str, anchor: str) -> float:
        return float(anchors[param(series_name, anchor)])

    def given_side(time: str) -> str:
        names = set(given)
        side = "low" if f"{axis}_low_{time}" in names and f"{axis}_high_{time}" not in names else "high"
        return f"{axis}_{side}_{time}"

    if code == "guardrail":
        floor = field in ("temp_width_night", "vpd_below_day")
        series_name = f"{axis}_{'low' if floor else 'high'}"
        noon, midnight = at(series_name, "sm"), at(series_name, "mid")
        night = midnight <= noon if floor else midnight >= noon
        return f"{series_name}_{'night' if night else 'day'}"
    if code == "band_width":
        return given_side("night" if field.endswith("_night") else "day")
    if code == "band_order":
        side, lower, upper = (
            ("low", "low", "target") if field == param(f"{axis}_target", "sm") else ("high", "target", "high")
        )
        upper_points, lower_points = (
            series_points(anchors, f"{axis}_{upper}"),
            series_points(anchors, f"{axis}_{lower}"),
        )
        gap = tuple(high - low for high, low in zip(upper_points, lower_points, strict=True))
        _, deepest = curve_min_at(gap)  # type: ignore[arg-type]
        return f"{axis}_{side}_{'night' if is_night(deepest) else 'day'}"
    if field == "vpd_below_night":
        return "vpd_low_night"
    return field


def _named_for_edges(
    items: Iterable[ProfileFinding], anchors: Mapping[str, float], patch: BandProfilePatch | None
) -> list[ProfileFinding]:
    """``items`` with each finding on an axis the patch gives as edges renamed to its edge field."""
    axes = edge_axes(patch)
    if not axes:
        return list(items)
    given = patch.model_dump(exclude_none=True) if patch is not None else {}
    return [
        item.model_copy(update={"field": edge_field(item, anchors, given)}) if axis_of(item.field) in axes else item
        for item in items
    ]


def axis_curve(anchors: Mapping[str, float], axis: str, phases: Sequence[float]) -> BandCurve:
    names = (f"{axis}_low", f"{axis}_target", f"{axis}_high")
    low, target, high = (
        [round(harmonic(*series_points(anchors, name), phase), 4) for phase in phases] for name in names
    )
    return BandCurve(low=low, target=target, high=high)


def sun_times(t: Sequence[int], phases: Sequence[float]) -> SunTimes:
    """When the day's phase crosses 1 (noon), 2 (sunset) and 3 (solar midnight), and wraps to 0 (sunrise)."""
    found: dict[str, int | None] = {"sunrise": None, "solar_noon": None, "sunset": None, "solar_midnight": None}
    marks = {1.0: "solar_noon", 2.0: "sunset", 3.0: "solar_midnight"}
    for index in range(1, len(phases)):
        before, after = phases[index - 1], phases[index]
        if after < before - 2.0:  # 3.99 -> 0.01: sunrise
            found["sunrise"] = t[index]
            continue
        for level, name in marks.items():
            if before < level <= after and after > before:
                fraction = (level - before) / (after - before)
                found[name] = round(t[index - 1] + fraction * (t[index] - t[index - 1]))
    return SunTimes(**found)


def _hour_key(epoch: int) -> int:
    return epoch - epoch % 3600


def expected_vpd(
    fit: DewpointFit | None,
    t: Sequence[int],
    phases: Sequence[float],
    target: Sequence[float | None],
    forecast: Mapping[int, tuple[float, float]],
) -> tuple[list[float | None], list[float | None]]:
    """The expected night VPD ribbon (p25, p75) at the draft's temperature target; null by day or without data."""
    low: list[float | None] = []
    high: list[float | None] = []
    for at, phase, temp in zip(t, phases, target, strict=True):
        outdoor = forecast.get(_hour_key(at))
        if fit is None or temp is None or outdoor is None or phase < 2.0:
            low.append(None)
            high.append(None)
            continue
        p25, p75 = expected_ribbon(fit, temp, *outdoor)
        low.append(p25)
        high.append(p75)
    return low, high


def night_heat(
    t: Sequence[int],
    phases: Sequence[float],
    target: Sequence[float | None],
    forecast: Mapping[int, tuple[float, float]],
) -> float | None:
    """kWh over the day's night steps (sunset to sunrise) at 0.19 kW/°F; null without a forecast for them."""
    total = 0.0
    seen = 0
    night = 0
    for at, phase, temp in zip(t, phases, target, strict=True):
        if phase < 2.0 or temp is None:
            continue
        night += 1
        outdoor = forecast.get(_hour_key(at))
        if outdoor is None:
            continue
        seen += 1
        total += HEAT_LOSS_KW_PER_F * max(0.0, temp - outdoor[0]) * series.PREVIEW_STEP_S / 3600.0
    if night == 0 or seen < night / 2:
        return None
    return round(total * night / seen, 1)


def dewpoint_warning(anchors: Mapping[str, float], fit: DewpointFit | None) -> ProfileFinding | None:
    """``vpd_low`` at ``temp_low`` at solar midnight needs a dewpoint the house has not reached in 14 days."""
    if fit is None:
        return None
    temp = anchors["band_temp_low_mid"]
    vpd = anchors["band_vpd_low_mid"]
    vapour = es_kpa(temp) - vpd
    if vapour <= 0:
        return None
    needed = dewpoint_f(vapour)
    if needed >= fit.dewpoint_p10_f:
        return None
    return ProfileFinding(
        code="dewpoint_unreached",
        severity="warning",
        field="vpd_below_night",
        detail=(
            f"A {vpd:.2f} kPa night floor at {temp:.1f} °F needs an indoor dewpoint of {needed:.1f} °F; the driest "
            f"tenth of the last {ENVELOPE_DAYS} nights was {fit.dewpoint_p10_f:.1f} °F"
        ),
    )


def floor_warning(floor: Sequence[float | None], expected_high: Sequence[float | None]) -> ProfileFinding | None:
    """The draft's night floor sits above the achievable ribbon's p75 for at least half the night steps it covers:
    the house is not expected to hold that floor tonight without the dry-out (#1433)."""
    pairs = [
        (low, high) for low, high in zip(floor, expected_high, strict=True) if low is not None and high is not None
    ]
    above = [(low, high) for low, high in pairs if low > high]
    if not pairs or 2 * len(above) < len(pairs):
        return None
    reach = max(high for _, high in pairs)
    return ProfileFinding(
        code="night_floor_unachievable",
        severity="warning",
        field="vpd_below_night",
        detail=(
            f"Tonight the house is expected to reach at most {reach:.2f} kPa (p75 of the achievable band); the night "
            f"floor is above that for {round(100 * len(above) / len(pairs))}% of the night"
        ),
    )


def all_findings(
    anchors: Mapping[str, float],
    fit: DewpointFit | None,
    floor: Sequence[float | None] = (),
    expected_high: Sequence[float | None] = (),
) -> list[ProfileFinding]:
    out = [ProfileFinding(**vars(item)) for item in findings(anchors)]
    for warning in (dewpoint_warning(anchors, fit), floor_warning(floor, expected_high)):
        if warning is not None:
            out.append(warning)
    return out


def _forecast_map(rows: Iterable[Mapping[str, Any]]) -> dict[int, tuple[float, float]]:
    out: dict[int, tuple[float, float]] = {}
    for row in rows:
        temp, dew = row["temp_f"], row["dew_point_f"]
        if temp is not None and dew is not None:
            out[_hour_key(int(row["ts"].timestamp()))] = (float(temp), float(dew))
    return out


def measured_window(now: datetime) -> tuple[datetime, datetime]:
    """24 h of 10-min buckets ending with the one that holds now."""
    step = series.PREVIEW_STEP_S
    end_epoch = int(now.timestamp()) // step * step + step
    end = datetime.fromtimestamp(end_epoch, UTC)
    return end - MEASURED_WINDOW, end


def _clock(epoch: int) -> tuple[int, int]:
    local = datetime.fromtimestamp(epoch, series.DENVER)
    return local.hour, local.minute


def measured_overlay(
    t: Sequence[int], rows: Iterable[Mapping[str, Any]], start: datetime, end: datetime
) -> MeasuredOverlay:
    """Each step takes the bucket of the last 24 h with its Denver clock time: today's up to now, yesterday's after.

    On the autumn DST night the repeated hour keeps its later bucket. A bucket with neither value is a gap (null)."""
    by_clock: dict[tuple[int, int], tuple[int, float | None, float | None]] = {}
    for row in sorted(rows, key=lambda row: row["bucket"]):
        temp, vpd = series._number(row["a0"]), series._number(row["a1"])
        if temp is None and vpd is None:
            continue
        at = series._epoch(row["bucket"])
        by_clock[_clock(at)] = (at, None if temp is None else round(temp, 2), None if vpd is None else round(vpd, 3))
    placed = [by_clock.get(_clock(step)) for step in t]
    return MeasuredOverlay(
        window_start=series._epoch(start),
        window_end=series._epoch(end),
        at=[None if item is None else item[0] for item in placed],
        temp=[None if item is None else item[1] for item in placed],
        vpd=[None if item is None else item[2] for item in placed],
    )


def forecast_overlay(t: Sequence[int], rows: Iterable[Mapping[str, Any]]) -> ForecastOverlay:
    """Every step of a forecast hour takes that hour's outdoor temperature and VPD."""
    hours: dict[int, tuple[float | None, float | None]] = {}
    issued: datetime | None = None
    for row in rows:
        temp, vpd = series._number(row["temp_f"]), series._number(row["vpd_kpa"])
        if temp is None and vpd is None:
            continue
        hours[_hour_key(int(row["ts"].timestamp()))] = (temp, vpd)
        issued = row["fetched_at"] if issued is None else max(issued, row["fetched_at"])
    placed = [hours.get(_hour_key(step)) for step in t]
    return ForecastOverlay(
        temp=[None if item is None or item[0] is None else round(item[0], 2) for item in placed],
        vpd=[None if item is None or item[1] is None else round(item[1], 3) for item in placed],
        issued_at=issued,
    )


# ── reads ───────────────────────────────────────────────────────────────────


async def _current_anchors(conn: asyncpg.Connection) -> dict[str, float]:
    rows = await conn.fetch(series.ANCHOR_ROWS_SQL, GREENHOUSE_ID, HOUSE_CROP, list(HOUSE_SERIES))
    anchors = anchors_from_rows(rows)
    missing = [name for name in HOUSE_PARAMS if name not in anchors]
    if missing:
        raise ServiceError(
            problem("read_only", f"the house band has no complete anchor set (missing {', '.join(missing)})")
        )
    return anchors


# One transaction-scoped advisory lock serializes every house band write: two writes to different anchors (or a
# single-anchor write and an editor Save) would otherwise each pass under READ COMMITTED without seeing the other and
# together leave a band the law cannot run on (write skew).
HOUSE_BAND_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('verdify.house_band'))"


async def check_stored(conn: asyncpg.Connection) -> None:
    """Refuse (``out_of_range``, field ``value``) when the house band as ``conn``'s transaction sees it has an
    ``error`` finding. A single-anchor write (API-10, MCP ``set_setting``) runs it after its update, so it is held to
    the editor's checks and rolls back with them. A store without the full anchor set has no curve to check (the
    editor refuses to open on it, ``read_only``), so nothing is refused for it here. It takes the house band lock
    first, so its read sees every band write committed before it."""
    await conn.execute(HOUSE_BAND_LOCK_SQL)
    anchors = anchors_from_rows(await conn.fetch(series.ANCHOR_ROWS_SQL, GREENHOUSE_ID, HOUSE_CROP, list(HOUSE_SERIES)))
    if any(name not in anchors for name in HOUSE_PARAMS):
        return
    for finding in findings(anchors):
        if finding.severity == "error":
            raise ServiceError(
                problem(
                    "out_of_range",
                    f"{finding.detail}. To move both edges at once, save the whole band in Control, Band",
                    field="value",
                )
            )


async def preview(
    conn: asyncpg.Connection,
    patch: BandProfilePatch | None = None,
    overrides: Mapping[str, float] | None = None,
    day: date | None = None,
    *,
    now: datetime | None = None,
) -> BandProfilePreview:
    """API-23: the house band as stored and as drafted over one America/Denver day. Read-only."""
    now = series._now(now)
    day = series._preview_day(day, now)
    start = series.denver_midnight(day)
    end = series.denver_midnight(day + timedelta(days=1))
    last = end - timedelta(seconds=series.PREVIEW_STEP_S)
    async with series._read_transaction(conn):
        current = await _current_anchors(conn)
        phase_rows = await conn.fetch(series.PREVIEW_PHASES_SQL, start, last)
        envelope_rows = await conn.fetch(
            ENVELOPE_SQL,
            now - timedelta(days=ENVELOPE_DAYS),
            now,
            list(MOISTURE_EQUIPMENT),
            GREENHOUSE_ID,
            DEEP_NIGHT_ALTITUDE_DEG,
        )
        forecast_rows = await conn.fetch(FORECAST_SQL, start, end)
        measured_start, measured_end = measured_window(now)
        measured_rows = await conn.fetch(
            MEASURED_SQL, measured_start, measured_end, timedelta(seconds=series.PREVIEW_STEP_S)
        )
    draft = draft_anchors(current, patch, overrides)
    t = [series._epoch(row["ts"]) for row in phase_rows]
    phases = [float(row["phase"]) for row in phase_rows]
    fit = fit_dewpoint(envelope_rows)
    forecast = _forecast_map(forecast_rows)
    temp_current, temp_draft = axis_curve(current, "temp", phases), axis_curve(draft, "temp", phases)
    expected_low, expected_high = expected_vpd(fit, t, phases, temp_draft.target, forecast)
    vpd_draft = axis_curve(draft, "vpd", phases)
    return BandProfilePreview(
        day=day,
        step_s=series.PREVIEW_STEP_S,
        t=t,
        sun=sun_times(t, phases),
        current=state_of(current),
        draft=state_of(draft),
        changed=changed_params(current, draft),
        temp=AxisPreview(current=temp_current, draft=temp_draft),
        vpd=VpdPreview(
            current=axis_curve(current, "vpd", phases),
            draft=vpd_draft,
            expected_low=expected_low,
            expected_high=expected_high,
        ),
        guardrails=Guardrails(),
        law_lines=BandLawLines(),
        overshoot=overshoot(draft),
        night_heat_kwh=NightHeat(
            current=night_heat(t, phases, temp_current.target, forecast),
            draft=night_heat(t, phases, temp_draft.target, forecast),
        ),
        envelope=None
        if fit is None
        else EnvelopeFit(hours=fit.hours, days=ENVELOPE_DAYS, rmse_f=fit.rmse_f, dewpoint_p10_f=fit.dewpoint_p10_f),
        findings=_named_for_edges(all_findings(draft, fit, vpd_draft.low, expected_high), draft, patch),
        measured=measured_overlay(t, measured_rows, measured_start, measured_end),
        forecast=forecast_overlay(t, forecast_rows),
    )


# ── the write ───────────────────────────────────────────────────────────────


async def write(
    conn: asyncpg.Connection,
    actor: Actor,
    patch: BandProfilePatch | None,
    overrides: Mapping[str, float] | None,
    manual: bool,
    reason: str | None,
    request_id: Any,
) -> WriteResult[BandWrite]:
    """API-24: every anchor the draft changes, in one ``recorded_write`` transaction with one ``band.write`` row.

    Refusals: Iris (``read_only``: the band is operator-owned), one axis given both as edges and as a target and
    width (``invalid_request``), an ``error`` finding (``out_of_range`` with its field, the edge field for an axis
    given as edges), a draft that changes nothing (``invalid_request``), and each anchor's own settings checks. A
    target anchor the edges move is one more changed anchor: it is stored, checked and audited with the others.
    """
    if actor.source == "iris":
        raise ServiceError(problem("read_only", "The band is operator-owned; Iris may not write it", field="anchor"))
    flag = settings._manual_flag(manual)
    request = {
        "profile": patch.model_dump(exclude_none=True) if patch is not None else {},
        "anchors": {name: float(value) for name, value in sorted((overrides or {}).items())},
        "manual": flag,
        "reason": reason,
    }

    async def perform(tx: asyncpg.Connection) -> tuple[BandWrite, dict[str, Any]]:
        await tx.execute(HOUSE_BAND_LOCK_SQL)
        current = await _current_anchors(tx)
        draft = draft_anchors(current, patch, overrides)
        errors = [ProfileFinding(**vars(item)) for item in findings(draft) if item.severity == "error"]
        for finding in _named_for_edges(errors, draft, patch):
            raise ServiceError(problem("out_of_range", finding.detail, field=finding.field))
        names = changed_params(current, draft)
        if not names:
            raise ServiceError(problem("invalid_request", "The draft changes no anchor", field="anchor"))
        stored: list[settings.DesiredSetting] = []
        changes: list[dict[str, Any]] = []
        anchor_rows: list[int] = []
        for name in names:
            checked, row, rows, setting = await settings.write_in_transaction(
                tx, actor, name, draft[name], flag, reason
            )
            stored.append(setting)
            anchor_rows.extend(rows)
            changes.append({"param": name, "desired_id": row["id"], "before": current[name], "value": checked.value})
        detail: dict[str, Any] = {
            "ref": {"table": "desired_state", "id": stored[0].id},
            "desired_ids": [setting.id for setting in stored],
            "changes": changes,
            "anchor_rows": sorted(anchor_rows),
            "manual": {"after": flag},
            "profile": decompose(draft).model_dump(),
            "simple": is_simple(draft),
            "edges": edges_of(draft).model_dump(),
            "edges_simple": edges_simple(draft).model_dump(),
        }
        return BandWrite(changed=stored), detail

    async def load(tx: asyncpg.Connection, logged: ActivityLogRow) -> BandWrite:
        ids = [int(value) for value in logged.detail.get("desired_ids") or []]
        rows = await settings.desired_states(tx, ids)
        if any(value not in rows for value in ids):
            raise ServiceError(problem("not_found", "the stored band write is gone", field="anchor"))
        return BandWrite(changed=[rows[value] for value in ids])

    return await activity.recorded_write(
        conn,
        actor,
        op="API-24",
        action=ACTION,
        target=TARGET,
        request=request,
        request_id=request_id,
        reason=reason,
        perform=perform,
        load=load,
    )
