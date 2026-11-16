"""Build the markdown tables of the review from the result files in ../results.

Usage: report_tables.py <results dir> <output dir>
"""

import os
import sys

import pandas as pd

SIM = sys.argv[1]
OUT = sys.argv[2]
R = pd.concat(
    [pd.read_csv(os.path.join(SIM, f)) for f in ["scenarios_base.csv", "scenarios_matrix.csv"]], ignore_index=True
).drop_duplicates(["scenario", "set", "period"])


def g(sc, per, col, st):
    x = R[(R.scenario == sc) & (R.period == per) & (R.set == st)]
    assert len(x) == 1, (sc, per, st, len(x))
    return float(x[col].iloc[0])


def ab(sc, per, col, nd=1):
    return f"{g(sc, per, col, 'A'):.{nd}f} / {g(sc, per, col, 'B'):.{nd}f}"


def sg(x, nd=1):
    """Signed number; zero is printed without a sign."""
    t = f"{x:+.{nd}f}"
    return t[1:] if float(t) == 0 else t


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "|".join(["---"] + ["---:"] * (len(head) - 1)) + "|"]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(out) + "\n"


T = {}
HL = [
    ("Current firmware, today's settings", "fw_live"),
    ("Current firmware without the night dry-out", "fw_no_dryout"),
    ("Current firmware, July settings held all year", "fw_fixed_summer"),
    ("Current firmware, today's autumn settings held all year", "fw_fixed_autumn"),
    ("Step 1a: dry-out pulse 600 s, rest 300 s", "fw_dryout_600_300"),
    (
        "Wetting constants alone: fog escalation 0.1 kPa, direct-wet margin 0.25 kPa, mister budget 300 gal",
        "fw_wet3_300",
    ),
    ("Step 1: both of the above", "fw_settings_300"),
    ("Step 1 with the planner's other settings held at their July values", "fw_settings_300_fixed"),
    ("Step 1 with the July values and no mister budget (needs a firmware change)", "fw_settings_all"),
    ("Patch: pulse-end interlock fix", "fw_interlock_fix"),
    ("Patch: furnace on at low + 0.5 °F, off at low + 3.0 °F (with interlock fix)", "fwp_furnace_fix"),
    ("Patch: dry-out from low + 0.5 °F, near-continuous (with interlock fix)", "fwp_dryout_cont"),
    ("Patch: all three", "fwp_all"),
    ("Patch: all three, dry-out by day as well", "fwp_all_day"),
    ("Patch: all of the above, the wetting constants, the July values, mister budget 300 gal", "fwp_all_day_best_300"),
    ("Step 2: the same with no mister budget", "fwp_all_day_best"),
    ("Two-axis controller, fixed constants", "kiss_strict_minabove0.5"),
    ("Two-axis controller without dehumidification", "kiss_strict_no_dehum"),
]
cols = [
    ("Both in band %", "both_in_pct", 1),
    ("Temp in band %", "temp_in_pct", 1),
    ("VPD below band %", "vpd_below_pct", 1),
    ("VPD above band %", "vpd_above_pct", 1),
    ("kWh/day", "kwh_day", 1),
    ("Therms/day", "therms_day", 1),
    ("Gal/day", "gal_day", 0),
]
T["HEADLINE"] = table(
    ["Scenario (model A / B)"] + [c[0] for c in cols],
    [[lab] + [ab(sc, "year", c, nd) for _, c, nd in cols] for lab, sc in HL],
)
SE = [
    ("Current firmware, today's settings", "fw_live"),
    ("Step 1: settings", "fw_settings_300"),
    ("Step 2: patched firmware", "fwp_all_day_best"),
    ("Two-axis controller", "kiss_strict_minabove0.5"),
]
T["SEASON"] = table(
    [
        "Scenario (model A / B)",
        "Oct-Apr both %",
        "Oct-Apr temp below %",
        "Oct-Apr VPD below %",
        "Oct-Apr therms/day",
        "Oct-Apr kWh/day",
        "May-Sep both %",
        "May-Sep temp above %",
        "May-Sep VPD above %",
        "May-Sep gal/day",
    ],
    [
        [
            lab,
            ab(sc, "winter", "both_in_pct"),
            ab(sc, "winter", "temp_below_pct"),
            ab(sc, "winter", "vpd_below_pct"),
            ab(sc, "winter", "therms_day"),
            ab(sc, "winter", "kwh_day"),
            ab(sc, "summer", "both_in_pct"),
            ab(sc, "summer", "temp_above_pct"),
            ab(sc, "summer", "vpd_above_pct"),
            ab(sc, "summer", "gal_day", 0),
        ]
        for lab, sc in SE
    ],
)


def hu(x, nd=1):
    """Round half up."""
    from decimal import ROUND_HALF_UP, Decimal

    return str(Decimal(f"{x:.4f}").quantize(Decimal(1).scaleb(-nd), rounding=ROUND_HALF_UP))


MEAS = pd.read_csv(os.path.join(SIM, "measured_monthly.csv"))
NOTE = {"2026-05": " (25th to 31st)", "2026-11": " (to the 15th)"}
OBS = {r["month"]: hu(r["both%"]) + NOTE.get(r["month"], "") for _, r in MEAS.iterrows()}
months = [
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
    "2026-11",
]
T["MONTH"] = table(
    [
        "Month",
        "Measured (served band of the time)",
        "Current firmware A / B",
        "Step 1 A / B",
        "Step 2 A / B",
        "Two-axis A / B",
        "Furnace h/day, current A / B",
        "Therms/day, current A / B",
    ],
    [
        [
            m,
            OBS.get(m, "no served-band record"),
            ab("fw_live", m, "both_in_pct"),
            ab("fw_settings_300", m, "both_in_pct"),
            ab("fwp_all_day_best", m, "both_in_pct"),
            ab("kiss_strict_minabove0.5", m, "both_in_pct"),
            ab("fw_live", m, "heat2_h_day"),
            ab("fw_live", m, "therms_day"),
        ]
        for m in months
    ],
)


# the summary ladder
def lad(sc):
    return ab(sc, "year", "both_in_pct")


def dry(sc):
    return ab(sc, "winter", "dryout_pass_pct", 0)


T["LADDER"] = table(
    [
        "Step",
        "What changes",
        "Both in band over a year, simulated, A / B",
        "Nights that dry out, October to April, simulated, A / B (%)",
    ],
    [
        ["Today", "Current firmware and settings, with every fault above absent", lad("fw_live"), dry("fw_live")],
        [
            "1a. Two operator settings",
            "Dry-out pulse 600 s and rest 300 s. Operator-owned settings: an operator write, reversible in a minute.",
            lad("fw_dryout_600_300"),
            dry("fw_dryout_600_300"),
        ],
        [
            "1b. Three wetting settings",
            "Fog escalation 0.1 kPa, direct-wet margin 0.25 kPa and the mister budget at its 300-gallon maximum, written as manual "
            "rows so that the planner's plans stop moving them. Operator writes; no code.",
            lad("fw_settings_300"),
            dry("fw_settings_300"),
        ],
        [
            "2. One firmware release",
            "Stop forcing the electric heater off at each pulse end; start the furnace at band low + 0.5 °F; run the dry-out from band "
            "low + 0.5 °F for as long as needed, by day as well; take the mister budget and the planner's other actuator settings out of the planner's hands.",
            lad("fwp_all_day_best"),
            dry("fwp_all_day_best"),
        ],
        ["3. Remove what does not run", "No change to control behaviour", "unchanged", "unchanged"],
        [
            "4. Two-axis controller",
            "About 22 fixed constants in place of the mode arbitration and its tunables",
            lad("kiss_strict_minabove0.5"),
            dry("kiss_strict_minabove0.5"),
        ],
        [
            "Option: a stronger dry-out",
            "The dry-out aims above its floor (recommended): with a 0.05 kPa constant in the step 2 release. An "
            "existing setting, `night_vpd_bias_kpa` 0.10 from October to April, does the same on that release and is optional before it "
            "(a manual operator write, no code; 2 / 17 more nights of 195 before step 2). Next, both fans in a pulse instead of one (firmware). Up to 0.5 therms a day from October to April; the "
            "both-fans gain depends on a fan flow that is poorly known (section 9.7). Jason's decision (section 11, decision 2).",
            f"{lad('fw_settings_300_nbias+0.10_oct-apr')} with the setting after step 1; {lad('fwp_all_day_best_nbias+0.10_oct-apr')} with it "
            f"after step 2; {lad('fwp_all_day_best_target+0.05')} with the constant; {lad('fwp_all_day_best_target+0.05_fans2')} with the "
            "constant and both fans",
            f"{dry('fw_settings_300_nbias+0.10_oct-apr')} with the setting after step 1; {dry('fwp_all_day_best_nbias+0.10_oct-apr')} with it "
            f"after step 2; {dry('fwp_all_day_best_target+0.05')} with the constant; {dry('fwp_all_day_best_target+0.05_fans2')} with the "
            "constant and both fans",
        ],
        [
            "Option: a warmer night",
            "The temperature low edge 2 °F higher at the solar-midnight and sunrise anchors (62.7 and 64.5 °F). A band edit, "
            "no code; 0.25 to 0.4 therms a day from October to April; less certain than the rows above (section 9.7). Jason's decision "
            "(section 11, decision 2).",
            f"{lad('fw_settings_300_tlow_night+2')} after step 1; {lad('fwp_all_day_best_tlow_night+2')} after step 2",
            f"{dry('fw_settings_300_tlow_night+2')} after step 1; {dry('fwp_all_day_best_tlow_night+2')} after step 2",
        ],
        [
            "For comparison: a lower night VPD edge",
            "The VPD low edge 0.10 kPa lower at the sunset, solar-midnight and sunrise anchors. It moves the grade, "
            "not the air: the dry-out keeps its 0.74 kPa floor, which was set on purpose on 2026-11-05.",
            f"{lad('fw_settings_300_vpdlow_not_noon-0.10')} after step 1; {lad('fwp_all_day_best_vpdlow_not_noon-0.10')} after step 2",
            f"{dry('fw_settings_300_vpdlow_not_noon-0.10')} after step 1; {dry('fwp_all_day_best_vpdlow_not_noon-0.10')} after step 2",
        ],
    ],
)
T["LADDER"] = T["LADDER"].replace("|---|---:|---:|---:|", "|---|---|---:|---:|")
# the nightly dry-out goal of 2026-11-05: at least 240 of the 360 minutes from 00:00 to 06:00 at or above max(served vpd_low, 0.74 kPa)
RPL = pd.read_csv(os.path.join(SIM, "replay_monthly.csv")).set_index("period")


def rec(mm):
    return f"{RPL.loc[mm, 'dryout_pass_pct'] * RPL.loc[mm, 'dryout_nights'] / 100:.0f} of {RPL.loc[mm, 'dryout_nights']:.0f}"


NG = [
    ("Current firmware without the night dry-out", "fw_no_dryout"),
    ("Current firmware, today's settings", "fw_live"),
    ("Step 1a: dry-out pulse 600 s, rest 300 s", "fw_dryout_600_300"),
    ("Step 1: all five settings", "fw_settings_300"),
    (
        "Step 1 and `night_vpd_bias_kpa` 0.10 from October to April (a sixth setting)",
        "fw_settings_300_nbias+0.10_oct-apr",
    ),
    ("Step 2: one firmware release", "fwp_all_day_best"),
    ("Step 2, dry-out aimed 0.05 kPa above the floor (a firmware constant)", "fwp_all_day_best_target+0.05"),
    ("Step 2 and `night_vpd_bias_kpa` 0.10 from October to April instead", "fwp_all_day_best_nbias+0.10_oct-apr"),
    ("the same, with the setting held all year", "fwp_all_day_best_nbias+0.10"),
    ("Step 2, both fans in the dry-out pulse", "fwp_all_day_best_fans2"),
    ("the same, with the second fan at its lower fitted flow", "fwp_all_day_best_fans2_lowflow"),
    ("Step 2, the 0.05 kPa target and both fans", "fwp_all_day_best_target+0.05_fans2"),
    ("the same, with the second fan at its lower fitted flow", "fwp_all_day_best_target+0.05_fans2_lowflow"),
    ("Step 2, night temperature low edge +2 °F", "fwp_all_day_best_tlow_night+2"),
    ("Step 2, the 0.05 kPa target and the night low edge +2 °F", "fwp_all_day_best_target+0.05_tlow_night+2"),
    ("Step 2, night temperature low edge +4 °F", "fwp_all_day_best_tlow_night+4"),
    ("Step 1, night temperature low edge +2 °F", "fw_settings_300_tlow_night+2"),
    ("Step 1, night temperature low edge +4 °F", "fw_settings_300_tlow_night+4"),
    ("Two-axis controller", "kiss_strict_minabove0.5"),
    ("Step 1, night VPD low edge 0.10 kPa lower", "fw_settings_300_vpdlow_not_noon-0.10"),
    ("Step 2, night VPD low edge 0.10 kPa lower", "fwp_all_day_best_vpdlow_not_noon-0.10"),
    ("Two-axis controller, night VPD low edge 0.10 kPa lower", "kiss_strict_minabove0.5_vpdlow_not_noon-0.10"),
]
T["NIGHTGOAL"] = table(
    [
        "Scenario (model A / B)",
        "Nights that dry out, October to April, %",
        "October 2026, %",
        "November 2026, %",
        "Minutes of 360 at or above the floor, October to April",
        "Both in band over the year, %",
        "Therms/day, October to April",
    ],
    [
        [
            "**The record, scored the same way**",
            "",
            rec("2026-10") + " nights",
            rec("2026-11") + " nights",
            f"{RPL.loc['2026-10', 'dryout_min_night']:.0f} in October, {RPL.loc['2026-11', 'dryout_min_night']:.0f} in November",
            "",
            "",
        ]
    ]
    + [
        [
            lab,
            ab(sc, "winter", "dryout_pass_pct", 0),
            ab(sc, "2026-10", "dryout_pass_pct", 0),
            ab(sc, "2026-11", "dryout_pass_pct", 0),
            ab(sc, "winter", "dryout_min_night", 0),
            ab(sc, "year", "both_in_pct"),
            ab(sc, "winter", "therms_day", 2),
        ]
        for lab, sc in NG
    ],
)
# planner-tuned parameters one at a time
rows = []
oat = [s for s in dict.fromkeys(R.scenario) if s.startswith("fw_") and "=" in s]
base = {st: g("fw_live", "year", "both_in_pct", st) for st in "AB"}
byp = {}
for s in oat:
    p, v = s[3:].split("=")
    byp.setdefault(p, []).append(
        (v, g(s, "year", "both_in_pct", "A") - base["A"], g(s, "year", "both_in_pct", "B") - base["B"])
    )
order = sorted(byp, key=lambda p: -max(max(abs(a), abs(b)) for _, a, b in byp[p]))
for p in order:
    (v1, a1, b1), (v2, a2, b2) = byp[p]
    rows.append([f"`{p}`", v1, f"{sg(a1, 2)} / {sg(b1, 2)}", v2, f"{sg(a2, 2)} / {sg(b2, 2)}"])
T["OAT"] = table(
    ["Parameter", "Low value", "Change in both-in-band, A / B (points)", "High value", "Change, A / B (points)"], rows
)
rnd = R[R.scenario.str.startswith("fw_random_") & (R.period == "year")]
rr = []
for per in ["year", "winter", "summer"]:
    x = R[R.scenario.str.startswith("fw_random_") & (R.period == per)]
    for st in "AB":
        v = x[x.set == st].both_in_pct
        rr.append(
            [
                f"{per}, model {st}",
                f"{g('fw_live', per, 'both_in_pct', st):.1f}",
                f"{v.min():.1f}",
                f"{v.quantile(0.1):.1f}",
                f"{v.median():.1f}",
                f"{v.quantile(0.9):.1f}",
                f"{v.max():.1f}",
                f"{v.std():.2f}",
            ]
        )
T["RANDOM"] = table(
    ["Period and model", "Today's settings", "Min", "10th pct", "Median", "90th pct", "Max", "Std dev"], rr
)
B = [
    ("**Current firmware, today's band**", "fw_live"),
    ("VPD low edge -0.10 kPa at solar midnight only", "fw_vpdlow_mid-0.10"),
    ("VPD low edge -0.10 kPa at solar midnight and sunrise", "fw_vpdlow_mid_sr-0.10"),
    ("VPD low edge -0.10 kPa at night (sunset, midnight and sunrise anchors)", "fw_vpdlow_not_noon-0.10"),
    ("VPD low edge -0.10 kPa at all hours", "fw_vpdlow-0.10"),
    ("VPD low edge -0.20 kPa at all hours", "fw_vpdlow-0.20"),
    ("VPD low edge +0.10 kPa at all hours", "fw_vpdlow+0.10"),
    ("Temperature band +2 °F", "fw_band_temp+2"),
    ("Temperature band -2 °F", "fw_band_temp-2"),
    ("**Step 1, today's band**", "fw_settings_300"),
    ("VPD low edge -0.10 kPa at solar midnight only", "fw_settings_300_vpdlow_mid-0.10"),
    ("VPD low edge -0.10 kPa at night", "fw_settings_300_vpdlow_not_noon-0.10"),
    ("VPD low edge -0.10 kPa at all hours", "fw_settings_300_vpdlow-0.10"),
    ("**Step 2, today's band**", "fwp_all_day_best"),
    ("VPD low edge -0.10 kPa at solar midnight only", "fwp_all_day_best_vpdlow_mid-0.10"),
    ("VPD low edge -0.10 kPa at night", "fwp_all_day_best_vpdlow_not_noon-0.10"),
    ("VPD low edge -0.10 kPa at all hours", "fwp_all_day_best_vpdlow-0.10"),
    ("**Two-axis controller, today's band**", "kiss_strict_minabove0.5"),
    ("VPD low edge -0.10 kPa at all hours (guard at low + 1.0 °F)", "kiss_strict_vpdlow-0.10"),
    ("VPD low edge -0.20 kPa at all hours (guard at low + 1.0 °F)", "kiss_strict_vpdlow-0.20"),
]
T["BAND"] = table(
    [
        "Scenario (model A / B)",
        "Year both %",
        "Oct-Apr both %",
        "May-Sep both %",
        "VPD below band %",
        "kWh/day",
        "Therms/day",
    ],
    [
        [
            lab,
            ab(sc, "year", "both_in_pct"),
            ab(sc, "winter", "both_in_pct"),
            ab(sc, "summer", "both_in_pct"),
            ab(sc, "year", "vpd_below_pct"),
            ab(sc, "year", "kwh_day"),
            ab(sc, "year", "therms_day"),
        ]
        for lab, sc in B
    ],
)
rb = pd.read_csv(os.path.join(SIM, "robustness.csv"))
rb = rb[rb.period == "year"]


def rg(sc, p, st, col="both_in_pct"):
    return float(rb[(rb.scenario == sc) & (rb.perturbation == p) & (rb.set == st)][col].iloc[0])


LAB = {
    "nominal": "Fitted model",
    "moisture_source_x1.5": "Moisture source x 1.5",
    "moisture_source_x0.7": "Moisture source x 0.7",
    "fan_flow_x2": "Fan air flow x 2 (vent-only exchange unchanged)",
    "fan_flow_x0.5": "Fan air flow x 0.5 (vent-only exchange unchanged)",
    "furnace_x0.7": "Furnace output x 0.7",
    "envelope_loss_x1.25": "Envelope heat loss x 1.25",
    "infiltration_x0.5": "Closed-house infiltration x 0.5",
    "sorption_buffer_x2": "Sorption buffer x 2",
    "sensor_lag_x2": "Sensor lag x 2",
}
rn = pd.read_csv(os.path.join(SIM, "robustness_night.csv"))


def rng(sc, per, col, pert, nd=0):
    v = [
        float(rn[(rn.scenario == sc) & (rn.period == per) & (rn.perturbation == pert) & (rn.set == st)][col].iloc[0])
        for st in "AB"
    ]
    return f"{v[0]:.{nd}f} / {v[1]:.{nd}f}"


RN = [
    ("Today", "fw_live"),
    ("Step 1a", "fw_dryout_600_300"),
    ("Step 1", "fw_settings_300"),
    ("Step 2", "fwp_all_day_best"),
    ("Step 2 with the 0.05 kPa target", "fwp_all_day_best_target+0.05"),
    ("Step 2 with both fans in the pulse", "fwp_all_day_best_fans2"),
]
T["ROBUSTNIGHT"] = table(
    [
        "Scenario (model A / B)",
        "Nights that dry out, October to April, %: fan flow x 0.5",
        "fitted",
        "x 2",
        "Both in band over the year, %: fan flow x 0.5",
        "fitted",
        "x 2",
    ],
    [
        [lab]
        + [rng(sc, "winter", "dryout_pass_pct", p) for p in ("fan_flow_x0.5", "nominal", "fan_flow_x2")]
        + [rng(sc, "year", "both_in_pct", p, 1) for p in ("fan_flow_x0.5", "nominal", "fan_flow_x2")]
        for lab, sc in RN
    ],
)
T["ROBUST"] = table(
    [
        "Change to the physics",
        "Current firmware A / B",
        "Two-axis A / B",
        "Gain A / B (points)",
        "Extra therms/day A / B",
        "Extra kWh/day A / B",
    ],
    [
        [
            LAB[p],
            f"{rg('fw_live', p, 'A'):.1f} / {rg('fw_live', p, 'B'):.1f}",
            f"{rg('kiss_final', p, 'A'):.1f} / {rg('kiss_final', p, 'B'):.1f}",
            f"{sg(rg('kiss_final', p, 'A') - rg('fw_live', p, 'A'), 1)} / {sg(rg('kiss_final', p, 'B') - rg('fw_live', p, 'B'), 1)}",
            f"{sg(rg('kiss_final', p, 'A', 'therms_day') - rg('fw_live', p, 'A', 'therms_day'), 1)} / {sg(rg('kiss_final', p, 'B', 'therms_day') - rg('fw_live', p, 'B', 'therms_day'), 1)}",
            f"{sg(rg('kiss_final', p, 'A', 'kwh_day') - rg('fw_live', p, 'A', 'kwh_day'), 1)} / {sg(rg('kiss_final', p, 'B', 'kwh_day') - rg('fw_live', p, 'B', 'kwh_day'), 1)}",
        ]
        for p in LAB
    ],
)
v = pd.read_csv(os.path.join(SIM, "validation.csv"), header=[0, 1], index_col=0)
VR = [
    ("temp_in_pct", "Temperature in band %"),
    ("temp_above_pct", "Temperature above band %"),
    ("vpd_in_pct", "VPD in band %"),
    ("vpd_below_pct", "VPD below band %"),
    ("vpd_above_pct", "VPD above band %"),
    ("vpd_below_night_pct", "VPD below band at night %"),
    ("heat1_h_day", "Electric heater h/day"),
    ("heat2_h_day", "Furnace h/day"),
    ("vent_h_day", "Vent h/day"),
    ("fog_h_day", "Fog h/day"),
    ("kwh_day", "kWh/day"),
    ("therms_day", "Therms/day"),
    ("gal_day", "Gal/day"),
    ("temp_max_f", "Peak temperature °F"),
]
W = [("oct", "1 Oct - 6 Nov"), ("nov", "6 - 15 Nov"), ("jul", "12 - 24 Jul"), ("aug", "25 Jul - 12 Aug")]
T["VALID"] = table(
    ["Measure"] + [f"{lab}: measured / A / B" for _, lab in W],
    [[lab] + [" / ".join(f"{float(v.loc[k, (w, s)]):.1f}" for s in ["obs", "A", "B"]) for w, _ in W] for k, lab in VR],
)


# variations of the two-axis controller (strict interlock), year
def dab(sc, base, per="year", col="both_in_pct", nd=1):
    return f"{sg(g(sc, per, col, 'A') - g(base, per, col, 'A'), nd)} / {sg(g(sc, per, col, 'B') - g(base, per, col, 'B'), nd)}"


KV = [
    ("Recommended: dehumidify continuously while wet, from band low + 0.5 °F", "kiss_strict_minabove0.5"),
    ("No dehumidification", "kiss_strict_no_dehum"),
    ("Dehumidify only from band low + 1.0 °F", "kiss_strict_recommended"),
    ("Dehumidify only from band low + 2.0 °F", "kiss_strict_minabove2"),
    ("From low + 1.0 °F, in pulses of 120 s every 15 minutes", "kiss_strict_recommended_pulse"),
    (
        "From low + 1.0 °F, furnace on at band low and off at low + 2.5 °F (today's thresholds)",
        "kiss_strict_h2+0_off2.5",
    ),
    ("From low + 1.0 °F, furnace on at low + 1.0 °F and off at low + 3.5 °F", "kiss_strict_h2+1"),
    ("From low + 1.0 °F, furnace off at low + 4.0 °F (above the electric heater's line)", "kiss_strict_h2+0.5_off4"),
    ("From low + 1.0 °F, no misters (fog only)", "kiss_strict_no_mister"),
]
T["KISSVAR"] = table(
    [
        "Variation (model A / B)",
        "Both in band %",
        "Temp below band %",
        "VPD below band %",
        "kWh/day",
        "Therms/day",
        "Furnace starts/day",
        "Gal/day",
        "Peak °F",
    ],
    [
        [
            lab,
            ab(sc, "year", "both_in_pct"),
            ab(sc, "year", "temp_below_pct"),
            ab(sc, "year", "vpd_below_pct"),
            ab(sc, "year", "kwh_day"),
            ab(sc, "year", "therms_day"),
            ab(sc, "year", "heat2_starts_day", 0),
            ab(sc, "year", "gal_day", 0),
            ab(sc, "year", "temp_max_f"),
        ]
        for lab, sc in KV
    ],
)
# options tested and set aside: change against the baseline each was run on
SA = [
    ("Outdoor-cooler check on the cooling vent", "kiss_cooler_out_check", "kiss_continuous"),
    ("Temperature low edge 2 °F lower at solar midnight", "kiss_night_setback-2", "kiss_continuous"),
    ("Temperature low edge 4 °F lower at solar midnight", "kiss_night_setback-4", "kiss_continuous"),
    ("Heater minimum on and off time 60 s", "kiss_heatdwell60", "kiss_continuous"),
    ("Heater minimum on and off time 300 s", "kiss_heatdwell300", "kiss_continuous"),
    ("Electric heater line at band low + 2.5 °F", "kiss_h1_line2.5", "kiss_continuous"),
    ("Electric heater line at band low + 5.0 °F", "kiss_h1_line5", "kiss_continuous"),
    ("Second fan at the band high", "kiss_fan2_over0", "kiss_continuous"),
    ("Second fan at band high + 3 °F", "kiss_fan2_over3", "kiss_continuous"),
    ("Cooling exit 3 °F below the band high", "kiss_cool_exit3", "kiss_continuous"),
    ("No rest between sealed fog bursts", "kiss_sealed_fog_norest", "kiss_continuous"),
    ("Mister pulses 30 s on, 60 s off", "kiss_mister_30_60", "kiss_continuous"),
    ("Mister pulses 90 s on, 45 s off", "kiss_mister_90_45", "kiss_continuous"),
    ("Both fans while dehumidifying", "kiss_cont_bothfans", "kiss_continuous"),
    ("Dehumidify when outdoor dew point is 1 °F lower (not 3 °F)", "kiss_cont_dp1", "kiss_continuous"),
    ("Current firmware: electric heater hysteresis 0.5 °F", "fw_heat_hyst0.5", "fw_live"),
    ("Current firmware: electric heater hysteresis 2.0 °F", "fw_heat_hyst2", "fw_live"),
    ("Current firmware: heater minimum on and off time 300 s", "fw_heatdwell300", "fw_live"),
    ("Current firmware: dwell gate off", "fw_no_dwell_gate", "fw_live"),
    ("Current firmware: dry-out pulse 240 s, rest 660 s", "fw_dryout_pulse240", "fw_live"),
    ("Current firmware: dry-out energy cap 30 kWh a night (today 10)", "fw_dryout_nocap", "fw_live"),
]
T["SETASIDE"] = table(
    [
        "Option",
        "Change in both-in-band over the year, A / B (points)",
        "Change in kWh/day",
        "Change in therms/day",
        "Peak °F",
    ],
    [
        [lab, dab(sc, b), dab(sc, b, col="kwh_day"), dab(sc, b, col="therms_day"), ab(sc, "year", "temp_max_f")]
        for lab, sc, b in SA
    ],
)
# measured compliance by month
mr = []
for _, r in MEAS.iterrows():
    gm = r["graded_h"] * 60.0
    lab = {"2026-05": "2026-05 (25th to 31st)", "2026-11": "2026-11 (to the 15th)", "ALL": "**All**"}.get(
        r["month"], r["month"]
    )
    mr.append(
        [
            lab,
            f"{r['graded_h']:,.0f}",
            hu(r["T_in%"]),
            hu(r["V_in%"]),
            hu(r["both%"]),
            f"{100 * r['hot_min'] / gm:.1f}",
            f"{100 * r['cold_min'] / gm:.1f}",
            f"{100 * r['dry_min'] / gm:.1f}",
            f"{100 * r['wet_min'] / gm:.1f}",
            f"{r['T_out']:.0f}",
            f"{r['dp_out']:.0f}",
        ]
    )
T["MEASURED"] = table(
    [
        "Month",
        "Graded hours",
        "Temp in band %",
        "VPD in band %",
        "Both in band %",
        "Too hot %",
        "Too cold %",
        "Too dry %",
        "Too wet %",
        "Outdoor mean °F",
        "Outdoor dew point °F",
    ],
    mr,
)
# simulated current firmware against the record, by month, on one definition (the simulator's scoring, today's band)
obs = {r["month"]: r["both%"] for _, r in MEAS.iterrows()}
rp = pd.read_csv(os.path.join(SIM, "replay_monthly.csv")).set_index("period")["both_in_pct"]
T["MONTHDIFF"] = table(
    [
        "Month",
        "Record, served band of the time %",
        "Record, today's band %",
        "Simulated current firmware, A / B",
        "Simulated minus record on today's band, A / B (points)",
    ],
    [
        [
            mm,
            hu(obs[mm]),
            f"{rp[mm]:.1f}",
            ab("fw_live", mm, "both_in_pct"),
            f"{sg(g('fw_live', mm, 'both_in_pct', 'A') - rp[mm], 1)} / {sg(g('fw_live', mm, 'both_in_pct', 'B') - rp[mm], 1)}",
        ]
        for mm in ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]
    ],
)
for k, t in T.items():
    open(os.path.join(OUT, k + ".md"), "w").write(t)
    print("==", k)
    print(t)
