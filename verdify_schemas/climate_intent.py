"""Climate-intent controller contract.

This is the narrow AI-facing surface for the next controller architecture:
planner emits bounded semantic intent; firmware keeps relay truth, safety,
interlocks, and candidate-action selection.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .tunable_registry import REGISTRY, TIER1_REG, registry_value_error

CLIMATE_INTENT_CONTRACT_VERSION = "2026-05-25"

ClimateAction = Literal[
    "SENSOR_FAULT",
    "SAFETY_HEAT",
    "SAFETY_COOL",
    "HEAT",
    "IDLE",
    "VENT_COOL",
    "VENT_COOL_MIST_ASSIST",
    "VENT_COOL_FOG_ASSIST",
    "SEALED_HUMIDIFY",
    "SEALED_FOG",
    "DEHUM_VENT",
]

ClimatePriorityAxis = Literal["safety", "temp", "vpd", "resource"]
MoistureAssistState = Literal["inactive", "engage_delay", "pulse_on", "pulse_gap", "blocked", "served"]
MoistureZone = Literal["none", "south", "west", "center", "all"]
FogBlockReason = Literal[
    "none",
    "below_threshold",
    "time_window",
    "dew_margin",
    "rh_ceiling",
    "temp_low",
    "occupancy",
    "relay_min_off",
    "resource_budget",
]

CLIMATE_ACTIONS: tuple[str, ...] = (
    "SENSOR_FAULT",
    "SAFETY_HEAT",
    "SAFETY_COOL",
    "HEAT",
    "IDLE",
    "VENT_COOL",
    "VENT_COOL_MIST_ASSIST",
    "VENT_COOL_FOG_ASSIST",
    "SEALED_HUMIDIFY",
    "SEALED_FOG",
    "DEHUM_VENT",
)

CLIMATE_PRIORITY_ORDER: tuple[str, ...] = ("safety", "temp", "vpd", "resource")

CLIMATE_INTENT_FIELDS: tuple[str, ...] = (
    "forecast_temp_bias_f",
    "forecast_vpd_bias_kpa",
    "solar_precool_gain_f",
    "thermal_lead_time_min",
    "economizer_temp_advantage_f",
    "economizer_dewpoint_advantage_f",
    "moisture_engage_vpd_excess_kpa",
    "all_zone_vpd_excess_kpa",
    "mist_duty_limit_pct",
    "fog_escalate_vpd_excess_kpa",
    "dew_margin_floor_f",
    "wet_cutoff_hour",
    "daily_mist_budget_gal",
    "resource_sensitivity",
    "relay_churn_penalty",
)


@dataclass(frozen=True)
class ClimateIntentFieldDoc:
    name: str
    meaning: str
    bounds: str
    firmware_impact: str
    materialized_knobs: tuple[str, ...] = ()
    planner_guidance: str = ""


CLIMATE_INTENT_FIELD_DOCS: tuple[ClimateIntentFieldDoc, ...] = (
    ClimateIntentFieldDoc(
        "forecast_temp_bias_f",
        "Forecast-backed hot-air pressure signal for the segment.",
        "-4..4F",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Use positive values when forecast or recent misses imply heat will outrun the band; use 0 when no hot miss is expected.",
    ),
    ClimateIntentFieldDoc(
        "forecast_vpd_bias_kpa",
        "Forecast-backed dry/wet pressure signal for the segment.",
        "-0.4..0.4 kPa",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Use positive values for dry forecast error or dry-air ventilation risk; use 0 or negative when dew/RH risk dominates.",
    ),
    ClimateIntentFieldDoc(
        "solar_precool_gain_f",
        "Solar ramp pressure that justifies cooling lead before peak heat.",
        "0..4F",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Raise during steep solar ramps or known lag; lower after shade/clouds or evening recovery.",
    ),
    ClimateIntentFieldDoc(
        "thermal_lead_time_min",
        "How early forecast preconditioning may begin.",
        "0..90 min",
        "Planner audit context for lead timing; firmware safety and dispatcher timing still gate actuation.",
        (),
        "Set to the intended lead window for the segment hypothesis; it documents forecast timing even when no direct Tier 1 knob changes.",
    ),
    ClimateIntentFieldDoc(
        "economizer_temp_advantage_f",
        "Outdoor temperature advantage needed before vent cooling is attractive.",
        "1..15F",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Lower when outside air can cool without cold shock; raise when cold-slug or oscillation risk is high.",
    ),
    ClimateIntentFieldDoc(
        "economizer_dewpoint_advantage_f",
        "Outdoor dewpoint advantage needed before dry-air decisions are attractive.",
        "1..15F",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Lower when outdoor air is safely drier and dehumidification is needed; raise when dry ventilation would worsen VPD stress.",
    ),
    ClimateIntentFieldDoc(
        "moisture_engage_vpd_excess_kpa",
        "How far above dispatcher-owned vpd_high VPD may rise before mister assist is eligible.",
        "0..0.5 kPa",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Keep near 0.05 kPa when VPD compliance is the bottleneck; raise only to conserve water after recovery is proven.",
    ),
    ClimateIntentFieldDoc(
        "all_zone_vpd_excess_kpa",
        "How far above dispatcher-owned vpd_high VPD may rise before all-zone mister rotation is eligible.",
        "0.05..0.8 kPa",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Keep near 0.20-0.30 kPa during hot/dry recovery; raise when water use is high without VPD improvement or wetting risk is active.",
    ),
    ClimateIntentFieldDoc(
        "mist_duty_limit_pct",
        "Maximum climate-misting duty allowed during the segment.",
        "0..100%",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Raise during hot/dry recovery windows with safe dew margin; lower for disease risk, occupancy, or resource conservation.",
    ),
    ClimateIntentFieldDoc(
        "fog_escalate_vpd_excess_kpa",
        "How far above dispatcher-owned vpd_high VPD may rise before fog assist is eligible.",
        "0.1..0.8 kPa",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Use lower values when VPD is repeatedly above band during ventilation and fog is safe; use higher values when fog overshoot or disease risk is the constraint.",
    ),
    ClimateIntentFieldDoc(
        "dew_margin_floor_f",
        "Minimum indoor air temperature minus dew point for wet climate actions.",
        "3..15F",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Keep conservative at night or near leaf-wetness risk; do not lower it just to chase VPD compliance.",
    ),
    ClimateIntentFieldDoc(
        "wet_cutoff_hour",
        "Latest local hour for climate wetting in this segment.",
        "17..24",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Extend only when dry recovery is worth evening wetting risk and dew margin remains healthy.",
    ),
    ClimateIntentFieldDoc(
        "daily_mist_budget_gal",
        "Daily climate-water budget for mister use.",
        "0..300 gal",
        "Materializes the firmware mister water budget.",
        ("mister_water_budget_gal",),
        "Budget water according to forecast stress and recent usage; use 0 only when wet actions should be unavailable.",
    ),
    ClimateIntentFieldDoc(
        "resource_sensitivity",
        "Preference for conserving water/electricity after safety and band compliance.",
        "0..1",
        "Audit context only since release 4: the settings it materialized left with the third flash.",
        (),
        "Raise only after safety and compliance are stable; lower when temp or VPD is outside band.",
    ),
    ClimateIntentFieldDoc(
        "relay_churn_penalty",
        "Preference for holding stable actions instead of changing modes frequently.",
        "0..1",
        "Materializes the mister engage delay (the hysteresis and dwell settings it also drove left with the third flash).",
        ("mister_engage_delay_s",),
        "Raise when mode churn or relay wear is the observed failure; lower when response lag is missing compliance windows.",
    ),
)

CLIMATE_RELAY_FIELD_DENYLIST: frozenset[str] = frozenset(
    {
        "heat1",
        "heat2",
        "vent",
        "fan1",
        "fan2",
        "fog",
        "mister_south",
        "mister_west",
        "mister_center",
        "drip_wall",
        "drip_center",
        "fert_master",
    }
)

# Authoritative fog-block-reason vocabulary. MUST be a superset of every value
# the firmware can publish to climate_action_log.fog_block_reason, or the strict
# ClimateActionDecision validator rejects real persisted rows (B16/M8: ~3104
# stored rows across `served`/`vent_interlock`/`irrigation`/`time_invalid` were
# latently un-decodable). Source of truth is the shared C++ logic
# (firmware/lib/greenhouse_logic.h `climate_fog_assist_block_reason()` →
# `feed_hold`/`dusk_cutoff`/`below_threshold`/`dew_margin`/`time_window`/
# `rh_ceiling`/`temp_low`/`occupancy`) plus the ESPHome manual/safety + interlock
# path (firmware/greenhouse/controls.yaml → `served`/`vent_interlock`/
# `relay_min_off`, plus the fog force-off words of greenhouse_logic.h
# `fog_force_off_reason()`: `sensor_fault`/`occupancy`/`fert_master`/
# `irrigation`/`resource_budget`/`water_ceiling`/`time_invalid`, #1161).
# `wet_taper` is retained for historical rows written by the pre-curve-only
# firmware even though the current shared-logic taper is inert, and
# `leak_detected` for rows from before the engine release (Q-05: the leak
# signal no longer holds fog).
# test_climate_intent.test_fog_block_reasons_cover_stored_db_values guards this
# against the live climate_action_log column.
FOG_BLOCK_REASONS: tuple[str, ...] = (
    "none",
    "below_threshold",
    "time_window",
    "dew_margin",
    "rh_ceiling",
    "temp_low",
    "occupancy",
    "relay_min_off",
    "resource_budget",
    # B16/M8 additions — firmware-emitted + DB-stored, previously rejected:
    "served",  # served band already satisfied (no fog demand)
    "irrigation",  # mutual-exclusion with an active irrigation job
    "vent_interlock",  # vent open → fog suppressed (SAF interlock)
    "time_invalid",  # controller clock not yet valid (RTC/NTP unsynced)
    "leak_detected",  # historical: the leak lock before the engine release (Q-05)
    "feed_hold",  # FRT-6 absorption hold after a feed
    "dusk_cutoff",  # SAF-3 VPD-independent dusk cutoff rail
    "wet_taper",  # historical pre-curve-only firmware observation truth
    # #1161 (F9): the fog force-off reports every term that holds fog.
    "sensor_fault",  # SENSOR_FAULT relay lock
    "fert_master",  # SAF-5: L03 open or about to open
    "water_ceiling",  # the SAF-4 daily ceiling (outside SAFETY_COOL)
)


class ClimateIntent(BaseModel):
    """Bounded semantic intent emitted by AI/planner for a forecast segment."""

    model_config = ConfigDict(extra="forbid")

    forecast_temp_bias_f: float = Field(0.0, ge=-4.0, le=4.0)
    forecast_vpd_bias_kpa: float = Field(0.0, ge=-0.4, le=0.4)
    solar_precool_gain_f: float = Field(0.0, ge=0.0, le=4.0)
    thermal_lead_time_min: float = Field(0.0, ge=0.0, le=90.0)
    economizer_temp_advantage_f: float = Field(2.0, ge=1.0, le=15.0)
    economizer_dewpoint_advantage_f: float = Field(2.0, ge=1.0, le=15.0)
    moisture_engage_vpd_excess_kpa: float = Field(0.05, ge=0.0, le=0.5)
    all_zone_vpd_excess_kpa: float = Field(0.25, ge=0.05, le=0.8)
    mist_duty_limit_pct: float = Field(25.0, ge=0.0, le=100.0)
    fog_escalate_vpd_excess_kpa: float = Field(0.25, ge=0.1, le=0.8)
    dew_margin_floor_f: float = Field(8.0, ge=3.0, le=15.0)
    wet_cutoff_hour: float = Field(19.0, ge=17.0, le=24.0)
    daily_mist_budget_gal: float = Field(300.0, ge=0.0, le=300.0)
    resource_sensitivity: float = Field(0.5, ge=0.0, le=1.0)
    relay_churn_penalty: float = Field(0.5, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _validate_moisture_ladder(self) -> ClimateIntent:
        if self.all_zone_vpd_excess_kpa < self.moisture_engage_vpd_excess_kpa:
            raise ValueError("all_zone_vpd_excess_kpa must be >= moisture_engage_vpd_excess_kpa")
        return self


class ClimateCandidateProjection(BaseModel):
    """Firmware/replay-evaluator projection for one candidate action."""

    model_config = ConfigDict(extra="forbid")

    action: ClimateAction
    safety_ok: bool
    blocked_reasons: tuple[str, ...] = ()
    projected_temp_error_f: float = Field(..., ge=0.0)
    projected_vpd_error_kpa: float = Field(..., ge=0.0)
    resource_cost: float = Field(..., ge=0.0)
    relay_churn_cost: float = Field(..., ge=0.0)
    confidence: float = Field(..., ge=0.0, le=1.0)
    prior_action_hold_preference: float = Field(0.0, ge=0.0, le=1.0)


class ClimateResourceCostEstimate(BaseModel):
    """Estimated resource cost for the selected climate action."""

    model_config = ConfigDict(extra="forbid")

    water_gal: float = Field(0.0, ge=0.0)
    electric_kwh: float = Field(0.0, ge=0.0)
    gas_therm: float = Field(0.0, ge=0.0)


class ClimateActionDecision(BaseModel):
    """Published controller/replay decision observability record."""

    model_config = ConfigDict(extra="forbid")

    climate_action: ClimateAction
    priority_axis: ClimatePriorityAxis
    temp_error_f: float = Field(..., ge=0.0)
    vpd_error_kpa: float = Field(..., ge=0.0)
    candidate_summary: str = Field(..., min_length=1)
    moisture_assist_state: MoistureAssistState
    moisture_zone: MoistureZone = "none"
    next_mist_eligible_s: float | None = Field(None, ge=0.0)
    fog_margin_kpa: float | None = None
    fog_block_reason: str = "none"
    resource_cost_estimate: ClimateResourceCostEstimate = Field(default_factory=ClimateResourceCostEstimate)

    @field_validator("fog_block_reason")
    @classmethod
    def _validate_fog_block_reason(cls, value: str) -> str:
        reasons = [part.strip() for part in value.split(",") if part.strip()]
        if not reasons:
            raise ValueError("fog_block_reason must name at least one reason")
        unknown = sorted(set(reasons) - set(FOG_BLOCK_REASONS))
        if unknown:
            raise ValueError(f"unknown fog_block_reason values: {unknown}")
        if "none" in reasons and len(reasons) > 1:
            raise ValueError("fog_block_reason='none' cannot be combined with other reasons")
        return ",".join(reasons)


def climate_candidate_sort_key(candidate: ClimateCandidateProjection) -> tuple[float, float, float, float, float]:
    """Return the strict priority key for eligible candidate selection."""

    return (
        candidate.projected_temp_error_f,
        candidate.projected_vpd_error_kpa,
        candidate.resource_cost,
        candidate.relay_churn_cost,
        -candidate.prior_action_hold_preference,
    )


def choose_climate_candidate(candidates: Sequence[ClimateCandidateProjection]) -> ClimateCandidateProjection:
    """Choose the best safe candidate with lexicographic climate priority."""

    eligible = [candidate for candidate in candidates if candidate.safety_ok]
    if not eligible:
        raise ValueError("no safety-ok climate candidates")
    return min(eligible, key=climate_candidate_sort_key)


def _finite_number(value: object) -> float | None:
    if isinstance(value, bool):
        numeric = 1.0 if value else 0.0
    elif isinstance(value, (int, float)):
        numeric = float(value)
    else:
        return None
    return numeric if math.isfinite(numeric) else None


def _clamp_tier1_value(parameter: str, value: float) -> float:
    spec = REGISTRY[parameter]
    if spec.kind == "switch":
        return 1.0 if value >= 0.5 else 0.0

    lo = spec.fw_clamp_lo if spec.fw_clamp_lo is not None else spec.min
    hi = spec.fw_clamp_hi if spec.fw_clamp_hi is not None else spec.max
    if lo is not None:
        value = max(float(lo), value)
    if hi is not None:
        value = min(float(hi), value)
    return float(value)


def _tier1_base_params(base_params: Mapping[str, object] | None = None) -> dict[str, float]:
    params = {name: float(REGISTRY[name].default) for name in TIER1_REG}
    for name, raw_value in (base_params or {}).items():
        if name not in TIER1_REG:
            continue
        numeric = _finite_number(raw_value)
        if numeric is not None:
            params[name] = _clamp_tier1_value(name, numeric)
    return params


def _base_registry_value(parameter: str, base_params: Mapping[str, object] | None = None) -> float:
    numeric = _finite_number((base_params or {}).get(parameter))
    if numeric is None:
        numeric = float(REGISTRY[parameter].default)
    return _clamp_tier1_value(parameter, numeric)


def _climate_intent_pressure_context(
    intent: ClimateIntent,
    base_params: Mapping[str, object] | None = None,
) -> dict[str, float | bool]:
    temp_high = _base_registry_value("temp_high", base_params)
    vpd_high = _base_registry_value("vpd_high", base_params)
    current_temp = _finite_number((base_params or {}).get("temp_actual_f"))
    current_vpd = _finite_number((base_params or {}).get("vpd_actual_kpa"))
    current_dew_margin = _finite_number((base_params or {}).get("dew_margin_f"))
    temp_above_high = _finite_number((base_params or {}).get("temp_above_high_f"))
    vpd_above_high = _finite_number((base_params or {}).get("vpd_above_high_kpa"))
    if temp_above_high is None and current_temp is not None:
        temp_above_high = max(0.0, current_temp - temp_high)
    if vpd_above_high is None and current_vpd is not None:
        vpd_above_high = max(0.0, current_vpd - vpd_high)
    temp_above_high = max(0.0, temp_above_high or 0.0)
    vpd_above_high = max(0.0, vpd_above_high or 0.0)
    dew_margin_safe = current_dew_margin is None or current_dew_margin >= intent.dew_margin_floor_f
    dry_forecast_pressure = max(0.0, min(1.0, intent.forecast_vpd_bias_kpa / 0.4))
    return {
        "temp_above_high_f": temp_above_high,
        "vpd_above_high_kpa": vpd_above_high,
        "dew_margin_safe": dew_margin_safe,
        "dry_forecast_pressure": dry_forecast_pressure,
        "compliance_wet_required": vpd_above_high > 0.0 and dew_margin_safe,
        "forecast_wet_required": dry_forecast_pressure >= 0.75 and dew_margin_safe,
    }


def climate_intent_materialization_guardrails(
    intent: ClimateIntent,
    base_params: Mapping[str, object] | None = None,
    materialized_params: Mapping[str, object] | None = None,
) -> list[dict[str, object]]:
    """Return audit annotations when the materializer overrides contradictory intent.

    These annotations are deliberately advisory: the materializer still produces
    one bounded Tier 1 plan, but the plan journal records when compliance pressure
    forced wet-assist availability despite resource- or churn-heavy intent.
    """

    ctx = _climate_intent_pressure_context(intent, base_params)
    annotations: list[dict[str, object]] = []
    del materialized_params  # release 4: no materialized setting feeds these annotations any more

    if ctx["compliance_wet_required"] and (
        intent.mist_duty_limit_pct < 25.0
        or intent.daily_mist_budget_gal < 120.0
        or intent.resource_sensitivity > 0.35
        or intent.relay_churn_penalty > 0.5
        or intent.moisture_engage_vpd_excess_kpa > 0.05
        or intent.all_zone_vpd_excess_kpa > 0.25
        or intent.wet_cutoff_hour < 19.0
    ):
        annotations.append(
            {
                "code": "live_vpd_compliance_wet_assist_forced",
                "severity": "info",
                "reason": "VPD is above dispatcher-owned band and dew margin is safe; materializer keeps wet assist available before resource minimization.",
                "vpd_above_high_kpa": round(float(ctx["vpd_above_high_kpa"]), 3),
            }
        )

    if ctx["forecast_wet_required"] and (
        intent.mist_duty_limit_pct < 15.0
        or intent.daily_mist_budget_gal < 60.0
        or intent.resource_sensitivity > 0.6
        or intent.relay_churn_penalty > 0.75
        or intent.moisture_engage_vpd_excess_kpa > 0.1
        or intent.all_zone_vpd_excess_kpa > 0.3
        or intent.wet_cutoff_hour < 19.0
    ):
        annotations.append(
            {
                "code": "forecast_vpd_wet_assist_guard",
                "severity": "info",
                "reason": "High positive forecast VPD pressure requires keeping climate wet assist available unless a safety rail blocks it.",
                "forecast_vpd_bias_kpa": round(intent.forecast_vpd_bias_kpa, 3),
            }
        )

    if (
        ctx["temp_above_high_f"] > 0.0
        and ctx["vpd_above_high_kpa"] > 0.0
        and ctx["dew_margin_safe"]
        and intent.resource_sensitivity > 0.6
    ):
        annotations.append(
            {
                "code": "dual_axis_resource_sensitivity_capped",
                "severity": "info",
                "reason": "Both temp and VPD are above band; resource sensitivity is capped below compliance priority.",
                "temp_above_high_f": round(float(ctx["temp_above_high_f"]), 2),
                "vpd_above_high_kpa": round(float(ctx["vpd_above_high_kpa"]), 3),
            }
        )

    return annotations


def materialize_climate_intent_tier1(
    intent: ClimateIntent,
    base_params: Mapping[str, object] | None = None,
) -> dict[str, float]:
    """Translate semantic ClimateIntent into the current Tier 1 firmware knobs.

    The end-state controller should consume ClimateIntent directly. Until that
    path replaces every legacy setpoint route, this adapter is the single bridge
    from the compact AI surface to the existing dispatcher/ESP32 contract.
    """

    params = _tier1_base_params(base_params)
    churn = max(0.0, min(1.0, intent.relay_churn_penalty))
    ctx = _climate_intent_pressure_context(intent, base_params)
    if ctx["compliance_wet_required"]:
        churn = min(churn, 0.5)
    elif ctx["forecast_wet_required"]:
        churn = min(churn, 0.75)
    daily_mist_budget_gal = intent.daily_mist_budget_gal
    if ctx["forecast_wet_required"]:
        daily_mist_budget_gal = max(daily_mist_budget_gal, 60.0)
    if ctx["compliance_wet_required"]:
        daily_mist_budget_gal = max(daily_mist_budget_gal, 120.0)

    # Release 4 (#1633, coordinator shape B): the intent materializes only settings that still exist. The 43 policy
    # wire slots it used to drive (hysteresis, dwell, fog, mister thresholds and pulses, vent preferences) left with
    # the third flash; their derivations are deleted. The other intent fields are audit context for the guardrails.
    params.update(
        {
            "mister_engage_delay_s": 15.0 + (45.0 * churn),
            "mister_water_budget_gal": daily_mist_budget_gal,
        }
    )

    materialized = {name: _clamp_tier1_value(name, params[name]) for name in TIER1_REG}
    errors = [error for name, value in materialized.items() if (error := registry_value_error(name, value))]
    if errors:
        raise ValueError("ClimateIntent materialization produced registry violations: " + "; ".join(errors))
    return {name: materialized[name] for name in sorted(materialized)}
