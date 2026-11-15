"""DailySummaryRow — 1:1 onto the daily_summary DB row.

61-field rollup written by daily-summary-snapshot.py at 00:05 UTC. Mirrors
the schema so vault-daily-writer, generate-daily-plan, and the website
renderer all read the same typed shape.
"""

from __future__ import annotations

from datetime import date as DateType

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class DailySummaryRow(BaseModel):
    model_config = ConfigDict(extra="ignore")  # Tolerate new columns without breaking old readers

    date: DateType
    greenhouse_id: str = "vallery"
    captured_at: AwareDatetime | None = None

    # Climate aggregates
    temp_min: float | None = None
    temp_avg: float | None = None
    temp_max: float | None = None
    rh_min: float | None = None
    rh_avg: float | None = None
    rh_max: float | None = None
    vpd_min: float | None = None
    vpd_avg: float | None = None
    vpd_max: float | None = None
    co2_avg: float | None = None
    outdoor_temp_min: float | None = None
    outdoor_temp_max: float | None = None

    # Hours below/above the served house band (migration 290; the database writes them). No eligible
    # samples are unavailable, not measured zero.
    stress_hours_heat: float | None = Field(default=None, ge=0, le=24, allow_inf_nan=False)
    stress_hours_cold: float | None = Field(default=None, ge=0, le=24, allow_inf_nan=False)
    stress_hours_vpd_high: float | None = Field(default=None, ge=0, le=24, allow_inf_nan=False)
    stress_hours_vpd_low: float | None = Field(default=None, ge=0, le=24, allow_inf_nan=False)

    # ── Served-band compliance: the only temp/VPD measurement basis (#1623)
    compliance_pct: float | None = Field(default=None, ge=0, le=100)
    temp_compliance_pct: float | None = Field(default=None, ge=0, le=100)
    vpd_compliance_pct: float | None = Field(default=None, ge=0, le=100)

    # Equipment cycles
    cycles_fan1: int = 0
    cycles_fan2: int = 0
    cycles_heat1: int = 0
    cycles_heat2: int = 0
    cycles_fog: int = 0
    cycles_vent: int = 0
    cycles_grow_light: int | None = None
    cycles_mister_south: int | None = Field(default=None, ge=0)
    cycles_mister_west: int | None = Field(default=None, ge=0)
    cycles_mister_center: int | None = Field(default=None, ge=0)
    cycles_drip_wall: int | None = Field(default=None, ge=0)
    cycles_drip_center: int | None = Field(default=None, ge=0)

    # Mister fairness watchdog (sprint-24-alignment — firmware sprint-2 feature)
    mister_fairness_overrides_today: int | None = Field(default=None, ge=0)

    # Equipment runtime (minutes)
    runtime_fan1_min: float = 0.0
    runtime_fan2_min: float = 0.0
    runtime_heat1_min: float = 0.0
    runtime_heat2_min: float = 0.0
    runtime_fog_min: float = 0.0
    runtime_vent_min: float = 0.0
    runtime_grow_light_min: float = 0.0

    # Mister + drip runtime (hours)
    runtime_mister_south_h: float | None = None
    runtime_mister_west_h: float | None = None
    runtime_mister_center_h: float | None = None
    runtime_drip_wall_h: float | None = None
    runtime_drip_center_h: float | None = None

    # Water: water_used_gal is the quality-filtered meter total (reporting); water cost is planning
    # water only (climate wetting + wall irrigation + wall fertigation, #1623).
    water_used_gal: float | None = None
    mister_water_gal: float | None = None

    # Costs + energy
    kwh_estimated: float | None = None
    therms_estimated: float | None = None
    peak_kw: float | None = None
    cost_electric: float | None = None
    cost_gas: float | None = None
    cost_water: float | None = None
    cost_total: float | None = None
