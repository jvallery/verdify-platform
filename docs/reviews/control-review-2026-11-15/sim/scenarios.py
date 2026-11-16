"""Scenario matrix for the closed-loop study (firmware-in-the-loop, today's house and band, weather year 2025-11-16..2026-11-15).

Two physics sets bracket the sim-to-real validation:
  A: Oct-Apr: joint winter fit W2 (winter 2025-26 with the unpowered electric heater + autumn 2026), moisture-source
     scale 0.95 (matches October 2026); May-Sep: autumn-2026 fit W1 (closest to July-August 2026 in closed loop)
  B: Oct-Apr: W2 with moisture-source scale 1.4 (matches 6-15 November 2026); May-Sep: summer fit S1 (hot/dry side)
Each scenario is run once per season configuration over the whole year; months May-Sep are taken from the summer run and the
rest from the winter run. Single process, sequential, about 2 s per run.
Usage: scenarios.py <tag> [group ...]"""

import os
import sys
import time

SIM = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SIM)
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import runner  # noqa: E402

YEAR = dict(start="2025-11-16", end="2026-11-15", score_from="2025-11-17")
SETS = {
    "A": {"winter": ("params_W2.json", 0.95), "summer": ("params_W1.json", 1.0)},
    "B": {"winter": ("params_W2.json", 1.4), "summer": ("params_S1.json", 1.0)},
}
SUMMER_M = {"05", "06", "07", "08", "09"}
# time-weighted medians of what the planner had on the device (setpoint_changes): 2026-10-15..11-15 and 2026-07-12..07-25
AUTUMN = dict(
    sp__fog_escalation_kpa=0.35,
    mister__pulse_on_s=30,
    mister__pulse_gap_s=60,
    sp__vpd_hysteresis=0.208,
    mister__water_budget_gal=120,
    dwell__fog_on=52,
    dwell__fog_off=108,
    sp__vpd_watch_dwell_s=67,
    mister__engage_delay_s=49,
    sp__mister_all_delay_s=98,
    sp__temp_hysteresis=1.96,
    sp__dwell_gate_ms=270000,
    sp__cool_stage2_over_high_f=1.9,
    sp__cool_exit_hysteresis_f=1.96,
    sp__cool_all_fans_at_high_enabled=0,
    sp__cold_vent_guard_delta_f=9,
)
SUMMER = dict(
    sp__fog_escalation_kpa=0.2,
    mister__pulse_on_s=90,
    mister__pulse_gap_s=30,
    sp__vpd_hysteresis=0.197,
    mister__water_budget_gal=300,
    dwell__fog_on=62,
    dwell__fog_off=60,
    sp__vpd_watch_dwell_s=60,
    mister__engage_delay_s=42,
    sp__mister_all_delay_s=84,
    sp__temp_hysteresis=1.78,
    sp__dwell_gate_ms=240000,
    sp__cool_stage2_over_high_f=0,
    sp__cool_exit_hysteresis_f=1.78,
    sp__cool_all_fans_at_high_enabled=1,
    sp__cold_vent_guard_delta_f=8,
)
KISS_BASE = dict(mister__pulse_on_s=60, mister__pulse_gap_s=45, mister__water_budget_gal=100000)


def S(name, controller="fw", season_cfg="seasonal", **kv):
    return (name, controller, season_cfg, kv)


GROUPS = {}
GROUPS["base"] = [
    S("fw_live"),  # current firmware, planner's seasonal settings
    S("fw_fixed_autumn", season_cfg="autumn"),  # current firmware, today's settings frozen all year
    S("fw_fixed_summer", season_cfg="summer"),  # current firmware, July settings frozen all year
    S("fw_no_dryout", sp__night_dryout_enabled=0),
    S("fw_no_dwell_gate", sp__sw_dwell_gate_enabled=0),
    S("fw_no_water_budget", mister__water_budget_gal=100000),
    S("kiss", "kiss"),  # two-axis controller, fixed constants, pulse dehumidify
    S("kiss_night_only", "kiss", kiss__dehum_day=0),
    S("kiss_continuous", "kiss", kiss__dehum_mode=2),
    S("kiss_no_dehum", "kiss", kiss__dehum_mode=0),
]
TUNED = {
    "sp__vpd_hysteresis": (0.1375, 0.3),
    "sp__temp_hysteresis": (1.0, 2.32),
    "sp__vpd_watch_dwell_s": (45, 82),
    "sp__mister_all_delay_s": (60, 300),
    "sp__fog_escalation_kpa": (0.1, 0.5),
    "sp__dwell_gate_ms": (180000, 330000),
    "sp__cool_stage2_over_high_f": (0.0, 2.07),
    "sp__cool_exit_hysteresis_f": (1.42, 2.32),
    "sp__cold_vent_guard_delta_f": (6, 15),
    "sp__cool_all_fans_at_high_enabled": (0, 1),
    "sp__direct_wet_stress_vpd_margin_kpa": (0.05, 0.25),
    "sp__direct_wet_stress_min_dew_margin_f": (8, 12),
    "sp__vent_prefer_temp_delta_f": (2, 15),
    "sp__vent_prefer_dp_delta_f": (2, 12),
    "dwell__fog_on": (32, 75),
    "dwell__fog_off": (35, 144),
    "mister__pulse_on_s": (30, 90),
    "mister__pulse_gap_s": (18, 60),
    "mister__water_budget_gal": (100, 300),
    "mister__engage_delay_s": (30, 56),
}
GROUPS["tuned_oat"] = [S(f"fw_{k.split('__')[1]}={v}", **{k: v}) for k, (lo, hi) in TUNED.items() for v in (lo, hi)]
rng = np.random.default_rng(20261115)
GROUPS["tuned_random"] = []
for i in range(30):
    kv = {}
    for k, (lo, hi) in TUNED.items():
        kv[k] = int(rng.integers(0, 2)) if k.endswith("enabled") else float(np.round(rng.uniform(lo, hi), 4))
    GROUPS["tuned_random"].append(S(f"fw_random_{i:02d}", **kv))
GROUPS["wet"] = (
    [
        S("fw_dryout_pulse240", sp__night_dryout_pulse_s=240, sp__night_dryout_rest_s=660),
        S("fw_dryout_rest390", sp__night_dryout_rest_s=390),
        S("fw_dryout_nocap", sp__night_dryout_kwh_cap=1000),
        S("kiss_pulse_240_660", "kiss", kiss__pulse_s=240, kiss__rest_s=660),
        S("kiss_pulse_120_300", "kiss", kiss__rest_s=300),
        S("kiss_pulse_60_240", "kiss", kiss__pulse_s=60, kiss__rest_s=240),
        S("kiss_cont_bothfans", "kiss", kiss__dehum_mode=2, kiss__both_fans_dehum=1),
        S("kiss_cont_dp1", "kiss", kiss__dehum_mode=2, kiss__dp_margin_f=1),
        S("kiss_cont_holdtarget", "kiss", kiss__dehum_mode=2, kiss__heat_hold_below_target=0),
        S("kiss_cont_exit0.10", "kiss", kiss__dehum_mode=2, kiss__wet_exit_kpa=0.10),
    ]
    + [S(f"kiss_cont_vpdlow{d:+.2f}", "kiss", kiss__dehum_mode=2, band__vpd_low_shift=d) for d in (-0.20, -0.10, 0.10)]
    + [S(f"fw_vpdlow{d:+.2f}", band__vpd_low_shift=d) for d in (-0.20, -0.10, 0.10)]
)
GROUPS["heat"] = (
    [
        S(
            "kiss_h2_on-1_off1.5",
            "kiss",
            kiss__dehum_mode=2,
            kiss__heat2_on_below_low=-1.0,
            kiss__heat2_off_above_low=1.5,
        ),
        S("kiss_h2_on0_off4", "kiss", kiss__dehum_mode=2, kiss__heat2_off_above_low=4.0),
        S("kiss_h2_on0_off1", "kiss", kiss__dehum_mode=2, kiss__heat2_off_above_low=1.0),
        S("kiss_h1_line2.5", "kiss", kiss__dehum_mode=2, kiss__heat1_above_low=2.5),
        S("kiss_h1_line5", "kiss", kiss__dehum_mode=2, kiss__heat1_above_low=5.0),
        S("kiss_heatdwell300", "kiss", kiss__dehum_mode=2, dwell__heat_on=300, dwell__heat_off=300),
        S("kiss_heatdwell60", "kiss", kiss__dehum_mode=2, dwell__heat_on=60, dwell__heat_off=60),
        S("fw_heatdwell300", dwell__heat_on=300, dwell__heat_off=300),
        S("fw_heat_hyst0.5", sp__heat_hysteresis=0.5),
        S("fw_heat_hyst2", sp__heat_hysteresis=2.0),
        S(
            "kiss_h2_on+0.5_off3",
            "kiss",
            kiss__dehum_mode=2,
            kiss__heat2_on_below_low=0.5,
            kiss__heat2_off_above_low=3.0,
        ),
        S(
            "kiss_h2_on+1_off3.5",
            "kiss",
            kiss__dehum_mode=2,
            kiss__heat2_on_below_low=1.0,
            kiss__heat2_off_above_low=3.5,
        ),
    ]
    + [S(f"kiss_night_setback{d:+.0f}", "kiss", kiss__dehum_mode=2, band__temp_low_night_shift=d) for d in (-2, -4)]
    + [S(f"fw_band_temp{d:+.0f}", band__temp_shift=d) for d in (-2, 2)]
)
GROUPS["cool"] = [
    S("kiss_cooler_out_check", "kiss", kiss__dehum_mode=2, kiss__vent_needs_cooler_out=1),
    S("kiss_fan2_over0", "kiss", kiss__dehum_mode=2, kiss__fan2_over_high=0.0),
    S("kiss_fan2_over3", "kiss", kiss__dehum_mode=2, kiss__fan2_over_high=3.0),
    S("kiss_fog_vent0", "kiss", kiss__dehum_mode=2, kiss__fog_over_high_vent=0.0),
    S("kiss_fog_vent0.3", "kiss", kiss__dehum_mode=2, kiss__fog_over_high_vent=0.3),
    S("kiss_sealed_fog_norest", "kiss", kiss__dehum_mode=2, kiss__sealed_fog_rest_s=0),
    S("kiss_cool_exit3", "kiss", kiss__dehum_mode=2, kiss__cool_exit=3.0),
    S("kiss_mister_30_60", "kiss", kiss__dehum_mode=2, mister__pulse_on_s=30, mister__pulse_gap_s=60),
    S("kiss_mister_90_45", "kiss", kiss__dehum_mode=2, mister__pulse_on_s=90, mister__pulse_gap_s=45),
    S("kiss_no_mister", "kiss", kiss__dehum_mode=2, mister__min_temp_f=200),
    S(
        "kiss_bestcase",
        "kiss",
        kiss__dehum_mode=2,
        kiss__both_fans_dehum=1,
        kiss__dp_margin_f=1,
        kiss__fan2_over_high=0.0,
        kiss__fog_over_high_vent=0.0,
        kiss__sealed_fog_rest_s=0,
        kiss__dry_dwell_s=0,
    ),
]

# Combined candidates for the report's headline table
FW_BEST = dict(sp__fog_escalation_kpa=0.1, sp__direct_wet_stress_vpd_margin_kpa=0.25, mister__water_budget_gal=100000)
KISS_REC = dict(
    kiss__dehum_mode=2, kiss__fog_over_high_vent=0.0, kiss__heat2_on_below_low=0.5, kiss__heat2_off_above_low=3.0
)
GROUPS["final"] = [
    S(
        "fw_best_constants", season_cfg="summer", **FW_BEST
    ),  # current firmware, three constants changed, no seasonal retune
    S("fw_best_constants_vpdlow-0.10", season_cfg="summer", band__vpd_low_shift=-0.10, **FW_BEST),
    S("kiss_recommended", "kiss", **KISS_REC),
    S("kiss_recommended_pulse", "kiss", **dict(KISS_REC, kiss__dehum_mode=1)),
    S("kiss_recommended_no_mister", "kiss", mister__min_temp_f=200, **KISS_REC),
    S("kiss_recommended_vpdlow-0.10", "kiss", band__vpd_low_shift=-0.10, **KISS_REC),
    S("kiss_recommended_vpdlow-0.20", "kiss", band__vpd_low_shift=-0.20, **KISS_REC),
    S("kiss_recommended_vpdhigh+0.10", "kiss", band__vpd_high_shift=0.10, **KISS_REC),
    S("kiss_recommended_h2+1", "kiss", **dict(KISS_REC, kiss__heat2_on_below_low=1.0, kiss__heat2_off_above_low=3.5)),
]

# Strict variant: the furnace is never requested while an air relay is on or wanted; dehumidifying waits for the furnace
STRICT = dict(kiss__gas_interlock=1)
GROUPS["strict"] = [
    S("kiss_strict_base", "kiss", **STRICT),
    S("kiss_strict_continuous", "kiss", kiss__dehum_mode=2, **STRICT),
    S("kiss_strict_recommended", "kiss", **dict(KISS_REC, **STRICT)),
    S("kiss_strict_recommended_pulse", "kiss", **dict(KISS_REC, kiss__dehum_mode=1, **STRICT)),
    S(
        "kiss_strict_h2+1",
        "kiss",
        **dict(KISS_REC, kiss__heat2_on_below_low=1.0, kiss__heat2_off_above_low=3.5, **STRICT),
    ),
    S(
        "kiss_strict_h2+0_off2.5",
        "kiss",
        **dict(KISS_REC, kiss__heat2_on_below_low=0.0, kiss__heat2_off_above_low=2.5, **STRICT),
    ),
    S("kiss_strict_h2+0.5_off4", "kiss", **dict(KISS_REC, kiss__heat2_off_above_low=4.0, **STRICT)),
    S("kiss_strict_minabove0.5", "kiss", **dict(KISS_REC, kiss__dehum_min_above_low=0.5, **STRICT)),
    S("kiss_strict_minabove2", "kiss", **dict(KISS_REC, kiss__dehum_min_above_low=2.0, **STRICT)),
    S("kiss_strict_vpdlow-0.10", "kiss", band__vpd_low_shift=-0.10, **dict(KISS_REC, **STRICT)),
    S("kiss_strict_vpdlow-0.20", "kiss", band__vpd_low_shift=-0.20, **dict(KISS_REC, **STRICT)),
    S("kiss_strict_no_mister", "kiss", mister__min_temp_f=200, **dict(KISS_REC, **STRICT)),
    S("kiss_strict_no_dehum", "kiss", **dict(KISS_REC, kiss__dehum_mode=0, **STRICT)),
]

# Small patches to the existing firmware (built from a patched copy of firmware/lib; see README "patched binaries")
CONT = dict(sp__night_dryout_pulse_s=600, sp__night_dryout_rest_s=30, sp__night_dryout_kwh_cap=50)
GROUPS["patch"] = [
    S(
        "fw_dryout_600_300", sp__night_dryout_pulse_s=600, sp__night_dryout_rest_s=300
    ),  # tunables only, today's firmware
    S(
        "fw_dryout_600_300_nocap",
        sp__night_dryout_pulse_s=600,
        sp__night_dryout_rest_s=300,
        sp__night_dryout_kwh_cap=50,
    ),
    S("fw_interlock_fix", fw__rest_exempt=1),  # pulse-end heat1 force-off removed
    S("fwp_furnace", binary="closed_loop_p1"),  # furnace on at low+0.5 F, off at low+3.0 F
    S("fwp_furnace_fix", binary="closed_loop_p1", fw__rest_exempt=1),
    S("fwp_dryout_cont", binary="closed_loop_p0", fw__rest_exempt=1, **CONT),  # dry-out from low+0.5 F, near-continuous
    S("fwp_all", binary="closed_loop_p2", fw__rest_exempt=1, **CONT),  # furnace + dry-out + interlock fix
    S("fwp_all_day", binary="closed_loop_p3", fw__rest_exempt=1, **CONT),  # ... and dry-out allowed by day
    S("fwp_all_best", binary="closed_loop_p2", season_cfg="summer", fw__rest_exempt=1, **dict(CONT, **FW_BEST)),
    S("fwp_all_day_best", binary="closed_loop_p3", season_cfg="summer", fw__rest_exempt=1, **dict(CONT, **FW_BEST)),
]
# Everything that needs no firmware change, together: dry-out 600/300 and the fixed wetting constants (and with the band decision)
SET_ALL = dict(FW_BEST, sp__night_dryout_pulse_s=600, sp__night_dryout_rest_s=300)
GROUPS["settings"] = [
    S("fw_settings_all", season_cfg="summer", **SET_ALL),
    S("fw_settings_all_vpdlow-0.10", season_cfg="summer", band__vpd_low_shift=-0.10, **SET_ALL),
    S(
        "fwp_all_day_best_vpdlow-0.10",
        binary="closed_loop_p3",
        season_cfg="summer",
        fw__rest_exempt=1,
        band__vpd_low_shift=-0.10,
        **dict(CONT, **FW_BEST),
    ),
]

# What a settings change can reach on today's firmware. The registry and the firmware clamp the mister budget to
# 100-300 gal, so 300 is the most a setting can give; fw_settings_all above assumed no budget at all.
WET3 = dict(sp__fog_escalation_kpa=0.1, sp__direct_wet_stress_vpd_margin_kpa=0.25, mister__water_budget_gal=300)
SET_300 = dict(WET3, sp__night_dryout_pulse_s=600, sp__night_dryout_rest_s=300)
# VPD low edge 0.10 kPa lower at night only. Anchors: sunrise, solar noon, sunset, solar midnight (live 0.755, 0.862, 0.845, 0.738)
NIGHT = {
    "mid": "0.755,0.862,0.845,0.638",  # solar-midnight anchor only: tapers to no change at sunset and sunrise
    "mid_sr": "0.655,0.862,0.845,0.638",  # midnight and sunrise anchors: the second half of the night and the early morning
    "not_noon": "0.655,0.862,0.745,0.638",
}  # sunrise, sunset and midnight anchors: the whole night, tapering to no change at noon
P3 = dict(binary="closed_loop_p3", season_cfg="summer", fw__rest_exempt=1)
GROUPS["step1"] = (
    [
        S("fw_wet3_300", **WET3),  # three wetting settings; the planner keeps writing the rest
        S("fw_settings_300", **SET_300),  # ... and the dry-out at 600 s / 300 s
        S(
            "fw_settings_300_fixed", season_cfg="summer", **SET_300
        ),  # the same with every other planner setting frozen at its July value
        S("fw_settings_300_vpdlow-0.10", band__vpd_low_shift=-0.10, **SET_300),
        S("fwp_all_day_best_300", **dict(P3, **dict(CONT, **WET3))),  # patched firmware with the 300 gal budget kept
        # does the 10 kWh nightly energy cap bind once the pulses are five times longer? (it does not)
        S(
            "fw_dryout_600_300_cap30",
            sp__night_dryout_pulse_s=600,
            sp__night_dryout_rest_s=300,
            sp__night_dryout_kwh_cap=30,
        ),
        S("fw_settings_300_cap30", **dict(SET_300, sp__night_dryout_kwh_cap=30)),
    ]
    + [S(f"fw_vpdlow_{k}-0.10", band__vpd_low=v) for k, v in NIGHT.items()]
    + [S(f"fw_settings_300_vpdlow_{k}-0.10", band__vpd_low=v, **SET_300) for k, v in NIGHT.items()]
    + [
        S(f"fwp_all_day_best_vpdlow_{k}-0.10", band__vpd_low=v, **dict(P3, **dict(CONT, **FW_BEST)))
        for k, v in NIGHT.items()
    ]
)

# A warmer night as the route to the overnight dry-out goal of 2026-11-05 (at least 240 minutes at or above
# max(vpd_low, 0.74 kPa) between 00:00 and 06:00): the temperature low edge raised at the solar-midnight and sunrise
# anchors (live 62.5, 73.79, 72.0, 60.7 at sunrise, solar noon, sunset, solar midnight); the furnace holds it.
TLOW = {"+2": "64.5,73.79,72.0,62.7", "+4": "66.5,73.79,72.0,64.7"}
GROUPS["night"] = (
    [S(f"fw_tlow_night{k}", band__temp_low=v) for k, v in TLOW.items()]
    + [S(f"fw_settings_300_tlow_night{k}", band__temp_low=v, **SET_300) for k, v in TLOW.items()]
    + [
        S(f"fwp_all_day_best_tlow_night{k}", band__temp_low=v, **dict(P3, **dict(CONT, **FW_BEST)))
        for k, v in TLOW.items()
    ]
    + [
        S(
            "kiss_strict_minabove0.5_vpdlow_not_noon-0.10",
            "kiss",
            band__vpd_low=NIGHT["not_noon"],  # the two-axis controller follows the edge
            **dict(KISS_REC, kiss__dehum_min_above_low=0.5, **STRICT),
        )
    ]
    + [  # the dry-out works to 0.05 or 0.10 kPa above the floor that the nightly grade counts against (a firmware constant)
        S("fwm_settings_300_target+0.05", binary="closed_loop_m05", **SET_300),
        S("fwp_all_day_best_target+0.05", **dict(P3, binary="closed_loop_p3m05", **dict(CONT, **FW_BEST))),
        S("fwp_all_day_best_target+0.10", **dict(P3, binary="closed_loop_p3m10", **dict(CONT, **FW_BEST))),
        S(
            "fwp_all_day_best_target+0.05_tlow_night+2",
            band__temp_low=TLOW["+2"],
            **dict(P3, binary="closed_loop_p3m05", **dict(CONT, **FW_BEST)),
        ),
    ]
)
# Both fans during the dry-out pulse instead of the lead fan alone. The second fan's flow is poorly identified in the
# cold-season fit (0.32 kg/s; 0.08 and 0.10 in the other two fits), so each scenario is repeated with the cool-season value.
FANS2 = [("", {}), ("_lowflow", {"winter_params": "params_W2_fan2low.json"})]
GROUPS["night"] += [
    S(f"fwp_all_day_best_fans2{tag}", **dict(P3, binary="closed_loop_p3f2", **dict(CONT, **FW_BEST), **extra))
    for tag, extra in FANS2
] + [
    S(
        f"fwp_all_day_best_target+0.05_fans2{tag}",
        **dict(P3, binary="closed_loop_p3m05f2", **dict(CONT, **FW_BEST), **extra),
    )
    for tag, extra in FANS2
]
# The same aim with no firmware change: night_vpd_bias_kpa (a planner-pushable setting, 0 to 0.25 kPa) raises the controller's
# own VPD band at night by a sin^2 bump (full at solar midnight, zero at sunset and sunrise) and the dry-out floor with it.
# The band the house is graded against is the dispatcher's audit band, which has no bias term, so the grade keeps 0.74.
NBIAS = {"+0.05": 0.05, "+0.10": 0.10, "+0.15": 0.15}
GROUPS["night"] += (
    [
        S(
            "fw_dryout_600_300_nbias+0.10",
            band__night_vpd_bias_kpa=0.10,
            sp__night_dryout_pulse_s=600,
            sp__night_dryout_rest_s=300,
        )
    ]
    + [S(f"fw_settings_300_nbias{k}", band__night_vpd_bias_kpa=v, **SET_300) for k, v in NBIAS.items()]
    + [
        S(f"fwp_all_day_best_nbias{k}", band__night_vpd_bias_kpa=v, **dict(P3, **dict(CONT, **FW_BEST)))
        for k, v in NBIAS.items()
    ]
)
# ... and as it would be used: 0.10 from October to April, 0 from May to September (it also delays night wetting in summer)
OCT_APR = dict(winter_cfg={"band__night_vpd_bias_kpa": 0.10})
GROUPS["night"] += [
    S("fw_settings_300_nbias+0.10_oct-apr", **dict(SET_300, **OCT_APR)),
    S("fwp_all_day_best_nbias+0.10_oct-apr", **dict(P3, **dict(CONT, **FW_BEST), **OCT_APR)),
]

MINMAX = {"temp_min_f": "min", "temp_max_f": "max"}


def combine(wdf, sdf):
    w = wdf[(wdf.period != "ALL") & ~wdf.period.str[-2:].isin(SUMMER_M)]
    s = sdf[(sdf.period != "ALL") & sdf.period.str[-2:].isin(SUMMER_M)]
    m = pd.concat([w, s], ignore_index=True)
    num = [c for c in m.columns if c not in ("scenario", "period", "params") and pd.api.types.is_numeric_dtype(m[c])]

    def agg(x, label):
        d = {"period": label, "days": x.days.sum()}
        for c in num:
            if c == "days":
                continue
            if c == "dryout_nights":
                d[c] = x[c].sum()
            elif c in ("dryout_pass_pct", "dryout_min_night"):  # weighted by the nights each month graded
                w = x.dryout_nights
                d[c] = float(np.average(x[c][w > 0], weights=w[w > 0])) if (w > 0).any() else float("nan")
            else:
                d[c] = getattr(x[c], MINMAX[c])() if c in MINMAX else float(np.average(x[c], weights=x.days))
        return d

    rows = [agg(m, "year"), agg(w, "winter"), agg(s, "summer")]
    out = pd.concat([pd.DataFrame(rows), m[["period"] + num]], ignore_index=True)
    return out


def run_scn(name, ctrl, season_cfg, kv):
    res = []
    kv = dict(kv)
    winter_params = kv.pop("winter_params", None)  # a variant of the cold-season parameter file, same moisture scale
    winter_cfg = kv.pop(
        "winter_cfg", None
    )  # settings in force from October to April only (the months taken from the winter run)
    for set_name, sdef in SETS.items():
        dfs = {}
        for season in ("winter", "summer"):
            params, cs = sdef[season]
            if season == "winter" and winter_params:
                params = winter_params
            cfg = {}
            if ctrl == "fw":
                which = season if season_cfg == "seasonal" else ("winter" if season_cfg == "autumn" else "summer")
                cfg.update(AUTUMN if which == "winter" else SUMMER)
            else:
                cfg.update(KISS_BASE)
            cfg.update(kv)
            if season == "winter" and winter_cfg:
                cfg.update(winter_cfg)
            dfs[season] = runner.run(name, ctrl, params, **YEAR, canopy=cs, dryout_from=0, **cfg)
        c = combine(dfs["winter"], dfs["summer"])
        c.insert(0, "set", set_name)
        c.insert(0, "scenario", name)
        res.append(c)
    return pd.concat(res, ignore_index=True)


def main():
    tag = sys.argv[1]
    groups = sys.argv[2:] or list(GROUPS)
    out = []
    t0 = time.time()
    for grp in groups:
        for name, ctrl, season_cfg, kv in GROUPS[grp]:
            df = run_scn(name, ctrl, season_cfg, kv)
            df.insert(1, "group", grp)
            out.append(df)
    res = pd.concat(out, ignore_index=True)
    path = f"{SIM}/results_{tag}.csv"
    res.to_csv(path, index=False)
    print(f"{len(out)} scenarios, {time.time() - t0:.0f} s -> {path}")


if __name__ == "__main__":
    main()
