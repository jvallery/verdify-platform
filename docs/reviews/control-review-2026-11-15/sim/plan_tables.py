"""Markdown tables for the climate refactor plan, generated from the simulation result files.

Every figure is simulated on the weather year 2025-11-16..2026-11-15 and printed as "A / B" (the two fitted model variants).
Usage: plan_tables.py <results dir> <out dir>      writes one <name>.md per table"""

import os
import sys

import pandas as pd

RES, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
FILES = ["plan_scenarios.csv", "plan_robustness.csv"]
frames = []
for f in FILES:
    p = os.path.join(RES, f)
    if os.path.exists(p):
        d = pd.read_csv(p)
        if "perturbation" not in d.columns:
            d["perturbation"] = "-"
        frames.append(d)
D = pd.concat(frames, ignore_index=True).drop_duplicates(["scenario", "set", "period", "perturbation"], keep="last")
D["mist_starts_day"] = D["mister_starts_day"] + D["mister_s_starts_day"] + D["mister_w_starts_day"]
D["mist_h_day"] = D["mister_h_day"] + D["mister_s_h_day"] + D["mister_w_h_day"]
D["fans_h_day"] = D["fan1_h_day"] + D["fan2_h_day"]
D["fans_starts_day"] = D["fan1_starts_day"] + D["fan2_starts_day"]
D["other_h_day"] = D["run_h_day"] - D["heat1_h_day"]
# the simulator's utility accounting (closed_loop2.cpp): kWh = 1.436 heater + 0.113 per fan + 0.710 fog + 0.010 vent; gal = 34.8 fog + misters
D["kwh_heat1"] = 1.436 * D["heat1_h_day"]
D["kwh_fans"] = 0.113 * D["fans_h_day"]
D["kwh_fog"] = 0.710 * D["fog_h_day"]
D["kwh_vent"] = 0.010 * D["vent_h_day"]
D["gal_fog"] = 34.8 * D["fog_h_day"]
D["gal_mist"] = D["gal_day"] - D["gal_fog"]


def val(scn, per, col, st, pert="-"):
    r = D[(D.scenario == scn) & (D.period == per) & (D.set == st) & (D.perturbation == pert)]
    if r.empty:
        raise KeyError((scn, per, col, st, pert))
    return float(r.iloc[0][col])


def plain(x, nd):
    s = f"{x:.{nd}f}"
    return s.lstrip("-") if float(s) == 0 else s


def ab(scn, per, col, nd=1, pert="-"):
    return f"{plain(val(scn, per, col, 'A', pert), nd)} / {plain(val(scn, per, col, 'B', pert), nd)}"


def signed(x, nd):
    s = f"{x:+.{nd}f}"
    return s[1:] if float(s) == 0 else s  # a difference that rounds to zero is printed without a sign


def dab(scn, base, per, col, nd=1, pert="-"):
    a = val(scn, per, col, "A", pert) - val(base, per, col, "A", pert)
    b = val(scn, per, col, "B", pert) - val(base, per, col, "B", pert)
    return f"{signed(a, nd)} / {signed(b, nd)}"


def table(name, header, rows):
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join(["---"] + ["---:"] * (len(header) - 1)) + "|"]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    open(os.path.join(OUT, name + ".md"), "w").write("\n".join(lines) + "\n")


CTRL = [
    ("fw_live", "Today's firmware and settings"),
    ("fw_settings_300", "Review step 1 (five settings, no code)"),
    ("fwp_all_day_best", "Review step 2 (patched firmware)"),
    ("kiss_strict_minabove0.5", "Review step 4 (the review's two-axis controller)"),
    ("law", "**The law** (drying cost limit 0)"),
    ("law_e0.7", "The law with the drying cost limit at 0.7 kWh/kg (decision 1)"),
]
COLS = [
    ("both_in_pct", "Both in band %", 1),
    ("dryout_pass_pct", "Nights dried %", 0),
    ("starts_day", "Relay starts/day", 0),
    ("run_h_day", "Run hours/day", 1),
    ("kwh_day", "kWh/day", 1),
    ("therms_day", "Therms/day", 2),
    ("gal_day", "Gallons/day", 0),
]

# headline, by period
for per in ("year", "winter", "summer"):
    table(
        f"headline_{per}",
        ["Controller"] + [c[1] for c in COLS],
        [[label] + [ab(s, per, c, nd) for c, _, nd in COLS] for s, label in CTRL],
    )

# the law minus each alternative
for per in ("year", "winter", "summer"):
    table(
        f"delta_{per}",
        ["Difference"] + [c[1] for c in COLS],
        [
            [label] + [dab("law", s, per, c, max(nd, 1) if c != "therms_day" else 2) for c, _, nd in COLS]
            for s, label in [
                ("fw_live", "The law minus today's firmware"),
                ("fwp_all_day_best", "The law minus review step 2"),
            ]
        ],
    )

# where the law's electricity and water go
table(
    "split",
    [
        "The law",
        "Electric heater kWh/day",
        "Fans kWh/day",
        "Fogger kWh/day",
        "Vent kWh/day",
        "Fog gallons/day",
        "Mister gallons/day",
    ],
    [
        [
            label,
            ab("law", per, "kwh_heat1", 1),
            ab("law", per, "kwh_fans", 2),
            ab("law", per, "kwh_fog", 2),
            ab("law", per, "kwh_vent", 2),
            ab("law", per, "gal_fog", 0),
            ab("law", per, "gal_mist", 1),
        ]
        for per, label in [
            ("year", "Year"),
            ("winter", "Winter (October to April)"),
            ("summer", "Summer (May to September)"),
        ]
    ],
)

# where the band is lost
LOSS = [
    ("temp_below_pct", "Too cold %"),
    ("temp_above_pct", "Too hot %"),
    ("vpd_below_pct", "Too humid %"),
    ("vpd_above_pct", "Too dry %"),
]
for per in ("year", "winter", "summer"):
    table(
        f"loss_{per}",
        ["Controller"] + [c[1] for c in LOSS],
        [[label] + [ab(s, per, c, 1) for c, _ in LOSS] for s, label in CTRL],
    )

# per relay: starts and hours, today's firmware against the law
# the two fans are shown together: the simulation of today's firmware fixes fan 1 as the lead, so its split between the fans is not meaningful
REL = [
    ("heat1", "Electric heater"),
    ("heat2", "Gas furnace"),
    ("vent", "Vent"),
    ("fans", "Fans (both)"),
    ("fog", "Fogger"),
    ("mist", "Misters (all zones)"),
]
for per in ("year", "winter", "summer"):
    rows = []
    for key, label in REL:
        rows.append(
            [
                label,
                ab("fw_live", per, key + "_starts_day", 1),
                ab("law", per, key + "_starts_day", 1),
                ab("fw_live", per, key + "_h_day", 2),
                ab("law", per, key + "_h_day", 2),
            ]
        )
    rows.append(
        [
            "**All relays**",
            ab("fw_live", per, "starts_day", 1),
            ab("law", per, "starts_day", 1),
            ab("fw_live", per, "run_h_day", 1),
            ab("law", per, "run_h_day", 1),
        ]
    )
    table(f"relays_{per}", ["Relay", "Starts/day today", "Starts/day law", "Hours/day today", "Hours/day law"], rows)

# C8: the drying cost cap
EM = [
    ("law_nodry", "Never dry with outdoor air"),
    ("law", "**Limit 0: drying starts on spare heat only (proposed)**"),
    ("law_e0.5", "Limit 0.5 kWh/kg"),
    ("law_e0.7", "Limit 0.7 kWh/kg"),
    ("law_e1.0", "Limit 1.0 kWh/kg"),
    ("law_eall", "No limit"),
]
for per in ("year", "winter"):
    table(
        f"emax_{per}",
        [
            "Drying rule",
            "Both in band %",
            "Nights dried %",
            "Therms/day",
            "kWh/day",
            "Furnace starts/day",
            "Vent starts/day",
            "Drying hours/day",
            "Water carried out kg/day",
            "Heat carried out kWh/day",
        ],
        [
            [
                label,
                ab(s, per, "both_in_pct"),
                ab(s, per, "dryout_pass_pct", 0),
                ab(s, per, "therms_day", 2),
                ab(s, per, "kwh_day", 1),
                ab(s, per, "heat2_starts_day", 1),
                ab(s, per, "vent_starts_day", 1),
                ab(s, per, "dry_h_day", 2),
                ab(s, per, "dry_kg_day", 1),
                ab(s, per, "dry_kwh_day", 1),
            ]
            for s, label in EM
        ],
    )

# where drying on spare heat stops (limit 0)
DS = [
    ("law_nodry", "Never dry with outdoor air"),
    ("law", "**Stop at low+0.75 (proposed)**"),
    ("law_dstop1.5", "Stop at low+1.5"),
    ("law_dstop2.0", "Stop at low+2.0"),
    ("law_dstop3.0", "Stop at low+3.0, the furnace's off line"),
]
for per in ("year", "winter"):
    table(
        f"dstop_{per}",
        [
            "Drying on spare heat, limit 0",
            "Both in band %",
            "Nights dried %",
            "Therms/day",
            "Furnace starts/day",
            "Vent starts/day",
            "Drying hours/day",
        ],
        [
            [
                label,
                ab(s, per, "both_in_pct"),
                ab(s, per, "dryout_pass_pct", 0),
                ab(s, per, "therms_day", 3),
                ab(s, per, "heat2_starts_day", 1),
                ab(s, per, "vent_starts_day", 1),
                ab(s, per, "dry_h_day", 2),
            ]
            for s, label in DS
        ],
    )

# C5: electric first, and C6: fan wear
table(
    "electric_first",
    [
        "Winter (October to April)",
        "Electric heater h/day",
        "Furnace h/day",
        "kWh/day",
        "Therms/day",
        "Furnace starts/day",
        "All starts/day",
        "Both in band %",
    ],
    [
        [
            label,
            ab(s, "winter", "heat1_h_day", 1),
            ab(s, "winter", "heat2_h_day", 2),
            ab(s, "winter", "kwh_day", 1),
            ab(s, "winter", "therms_day", 2),
            ab(s, "winter", "heat2_starts_day", 1),
            ab(s, "winter", "starts_day", 0),
            ab(s, "winter", "both_in_pct", 1),
        ]
        for s, label in [
            ("fw_live", "Today's firmware"),
            ("law", "The law: electric heater first"),
            (
                "law_h1_not_first",
                "Reference: electric heater on at low+1.0, off at low+2.0 (not ahead of the furnace; drying still starts at low+3.5)",
            ),
        ]
    ],
)
table(
    "fan_wear",
    ["Year", "Fan 1 h/day", "Fan 2 h/day", "Fan 1 starts/day", "Fan 2 starts/day"],
    [
        [
            label,
            ab(s, "year", "fan1_h_day", 2),
            ab(s, "year", "fan2_h_day", 2),
            ab(s, "year", "fan1_starts_day", 1),
            ab(s, "year", "fan2_starts_day", 1),
        ]
        for s, label in [
            ("law", "The law: the fan with fewer run hours leads"),
            ("law_lead_fixed", "Reference: fan 1 always leads"),
        ]
    ],
)

# sensitivities around the law (year, difference from the law)
SENS = [
    ("s_furnace_off2.5_h1_3.0", "Furnace off at low+2.5 and electric heater 3.0/4.0 (narrower furnace swing)"),
    ("s_furnace_off3.5_h1_4.0", "Furnace off at low+3.5 and electric heater 4.0/5.0 (wider furnace swing)"),
    ("s_h1_4.0", "Electric heater 4.0/5.0, furnace unchanged"),
    ("s_h1_3.0", "Electric heater 3.0/4.0, furnace and drying start unchanged"),
    ("s_h1_2.5", "Electric heater 2.5/3.5, furnace and drying start unchanged"),
    ("s_furnace_on0.25", "Furnace on at low+0.25"),
    ("s_stack_low", "Whole heating stack 1 F lower: electric heater 2.5/3.5, furnace off at low+2.0"),
    ("s_h1_wide", "Electric heater on at low+1.5, off at low+3.5 (a 2 F swing; drying still starts at low+3.5)"),
    ("s_heat_min180", "Heaters minimum on/off 180 s"),
    ("law_h1_not_first", "Electric heater 1.0/2.0 (not ahead of the furnace; drying still starts at low+3.5)"),
    ("s_fog_exit0.10", "Fog exit margin 0.10 kPa"),
    ("s_fog_exit0.20", "Fog exit margin 0.20 kPa"),
    ("s_fog_min60", "Fog minimum on/off 60 s"),
    ("s_fog_min180", "Fog minimum on/off 180 s"),
    ("s_air_min180", "Fans and vent minimum on/off 180 s"),
    ("s_air_min120", "Fans and vent minimum on/off 120 s"),
    ("s_cool_exit1.5", "Cooling exit 1.5 F inside"),
    ("s_cool_exit3.0", "Cooling exit 3.0 F inside"),
    ("s_fan2_at0.5", "Second fan at high+0.5"),
    ("s_fan2_at3.0", "Second fan at high+3.0"),
    ("s_evap_cool1.5", "Add fog as a cooling stage above high+1.5"),
    ("s_evap_cool0.5", "Add fog as a cooling stage above high+0.5"),
    ("s_mist_at0.20", "Misters join at vpd_high+0.20"),
    ("s_mist_at0.40", "Misters join at vpd_high+0.40, leave at +0.15"),
    ("law_mist0", "No misters"),
    ("law_mist1", "Centre mister only (today's membership)"),
    ("s_no_fog_below_low", "No fog or mist below the low temperature edge"),
    ("s_dry_exit0.15", "Drying exit 0.15 kPa above the low edge"),
    ("s_dry_on0.10", "Drying starts 0.10 kPa above the low edge"),
    ("s_dry_on0.00", "Drying starts at the low edge"),
    ("s_dry_two_fans", "Second fan while drying, when VPD is more than 0.05 kPa below the low edge"),
    ("s_dewpoint_2_2", "Outdoor dew-point margin 2 F, no start/stop gap"),
    ("s_dewpoint_4_1", "Outdoor dew-point margin 4 F start, 1 F stop"),
]
SC = [
    ("both_in_pct", "Both in band", 1),
    ("dryout_pass_pct", "Nights dried", 0),
    ("starts_day", "Starts/day", 1),
    ("heat2_starts_day", "Furnace starts/day", 1),
    ("kwh_day", "kWh/day", 2),
    ("therms_day", "Therms/day", 2),
    ("gal_day", "Gallons/day", 1),
]
table(
    "sensitivity",
    ["Change to one rule (year, difference from the law)"] + [c[1] for c in SC],
    [[label] + [dab(s, "law", "year", c, nd) for c, _, nd in SC] for s, label in SENS if not D[D.scenario == s].empty],
)
# the same changes by season: one value has to serve the whole year
table(
    "sensitivity_seasons",
    [
        "Change to one rule (difference from the law)",
        "Both in band, winter",
        "Both in band, summer",
        "Starts/day, winter",
        "Starts/day, summer",
    ],
    [
        [
            label,
            dab(s, "law", "winter", "both_in_pct", 1),
            dab(s, "law", "summer", "both_in_pct", 1),
            dab(s, "law", "winter", "starts_day", 1),
            dab(s, "law", "summer", "starts_day", 1),
        ]
        for s, label in SENS
        if not D[D.scenario == s].empty
    ],
)

# outdoor data: wrong, or absent
OUTD = [
    ("law", "Outdoor data correct"),
    ("law_out_dp+2", "Outdoor dew point read 2 F too high"),
    ("law_out_dp-2", "Outdoor dew point read 2 F too low"),
    ("law_out_dp-4", "Outdoor dew point read 4 F too low"),
    ("law_offline", "No outdoor data: no drying with outdoor air"),
    ("law_offline_effect", "No outdoor data, with the effect check (studied, not adopted)"),
]
table(
    "outdoor",
    [
        "The law, condition held for the whole year",
        "Both in band %",
        "Nights dried %",
        "Drying hours/day",
        "Vent starts/day",
        "Relay starts/day",
        "kWh/day",
        "Therms/day",
    ],
    [
        [
            label,
            ab(s, "year", "both_in_pct"),
            ab(s, "year", "dryout_pass_pct", 0),
            ab(s, "year", "dry_h_day", 2),
            ab(s, "year", "vent_starts_day", 1),
            ab(s, "year", "starts_day", 0),
            ab(s, "year", "kwh_day", 1),
            ab(s, "year", "therms_day", 2),
        ]
        for s, label in OUTD
    ],
)

# degraded modes
DEG = [
    ("Everything available", "fw_live", "law"),
    ("No outdoor data", "fw_offline", "law_offline"),
    ("Clock 117 minutes fast", "fw_clock+117", "law_clock+117"),
    ("Clock 60 minutes fast", None, "law_clock+60"),
    ("Clock 60 minutes slow", None, "law_clock-60"),
    ("Clock 3 hours slow", "fw_clock-180", "law_clock-180"),
    ("Clock 6 hours slow", None, "law_clock-360"),
    ("No clock at all", "fw_frozen_noon", "law_noclock"),
    ("No clock and no outdoor data", "fw_frozen_noon_offline", "law_noclock_offline"),
]
rows = []
for label, fw, lw in DEG:
    rows.append(
        [
            label,
            ab(fw, "year", "both_in_pct") if fw else "not run",
            ab(lw, "year", "both_in_pct"),
            ab(fw, "year", "therms_day", 2) if fw else "not run",
            ab(lw, "year", "therms_day", 2),
            ab(fw, "year", "gal_day", 0) if fw else "not run",
            ab(lw, "year", "gal_day", 0),
            ab(fw, "year", "temp_min_f", 1) if fw else "not run",
            ab(lw, "year", "temp_min_f", 1),
            ab(fw, "year", "temp_max_f", 1) if fw else "not run",
            ab(lw, "year", "temp_max_f", 1),
        ]
    )
table(
    "degraded",
    [
        "Condition held for the whole year",
        "Both in band % today",
        "Both in band % law",
        "Therms/day today",
        "Therms/day law",
        "Gallons/day today",
        "Gallons/day law",
        "Coldest F today",
        "Coldest F law",
        "Hottest F today",
        "Hottest F law",
    ],
    rows,
)

# the band's price list
PRICE = [
    ("p_t_all-2", "Whole temperature band 2 F lower"),
    ("p_t_all+2", "Whole temperature band 2 F higher"),
    ("p_t_sr-2", "Band at sunrise 2 F lower"),
    ("p_t_sm-2", "Band at solar noon 2 F lower"),
    ("p_t_ss-2", "Band at sunset 2 F lower"),
    ("p_t_mid-2", "Band at solar midnight 2 F lower"),
    ("p_lo_sm-2", "Low edge only, solar noon 2 F lower"),
    ("p_lo_ss-2", "Low edge only, sunset 2 F lower"),
    ("p_lo_day-2", "Low edge only, noon and sunset 2 F lower"),
    ("p_lo_day-4", "Low edge only, noon and sunset 4 F lower"),
    ("p_lo_night+2", "Low edge only, sunrise and midnight 2 F higher"),
    ("p_hi_day+2", "High edge only, noon and sunset 2 F higher"),
    ("p_vhi_all+0.10", "VPD high edge 0.10 kPa higher, all day"),
    ("p_vhi_day+0.10", "VPD high edge 0.10 kPa higher, noon and sunset"),
    ("p_vhi_night+0.30", "VPD high edge 0.30 kPa higher, sunrise and midnight"),
]
PC = [
    ("therms_day", "Therms/day", 2),
    ("kwh_day", "kWh/day", 1),
    ("gal_day", "Gallons/day", 0),
    ("starts_day", "Starts/day", 1),
    ("run_h_day", "Run hours/day", 1),
    ("both_in_pct", "Both in own band", 1),
    ("dryout_pass_pct", "Nights dried", 0),
]
for per in ("year", "winter"):
    table(
        f"price_{per}",
        ["Band edit (difference from the law on today's band)"] + [c[1] for c in PC],
        [[label] + [dab(s, "law", per, c, nd) for c, _, nd in PC] for s, label in PRICE],
    )

# a slightly wider band: the law and today's firmware on the same edited band
ECON = [
    ("fw_live", "Today's firmware, today's band"),
    ("law", "The law, today's band"),
    ("econ1", "The law, band 1: day low edge 2 F lower, VPD high edge 0.10 kPa higher"),
    ("econ2", "The law, band 2: band 1 and day high edge 2 F higher"),
    ("econ3", "The law, band 3: band 2 with the day low edge 4 F lower"),
    ("fw_econ1", "Today's firmware, band 1"),
    ("fw_econ2", "Today's firmware, band 2"),
    ("fw_econ3", "Today's firmware, band 3"),
]
for per in ("year", "winter", "summer"):
    table(
        f"econ_{per}",
        ["Controller and band"] + [c[1].replace("Both in band", "Both in own band") for c in COLS],
        [[label] + [ab(s, per, c, nd) for c, _, nd in COLS] for s, label in ECON],
    )

GL = [
    ("both_in_pct", "Both in own band, points", 1),
    ("starts_day", "Relay starts/day", 0),
    ("run_h_day", "Run hours/day", 1),
    ("kwh_day", "kWh/day", 1),
    ("therms_day", "Therms/day", 2),
    ("gal_day", "Gallons/day", 0),
]
table(
    "econ_delta_year",
    ["Year, difference from today's firmware on today's band"] + [c[1] for c in GL],
    [[label] + [dab(s, "fw_live", "year", c, nd) for c, _, nd in GL] for s, label in ECON[1:5]],
)
PCT = [
    ("starts_day", "Relay starts"),
    ("run_h_day", "Run hours"),
    ("kwh_day", "Electricity"),
    ("therms_day", "Gas"),
    ("gal_day", "Water"),
]


def pct(scn, col):
    return " / ".join(
        f"{signed(100.0 * (val(scn, 'year', col, st) / val('fw_live', 'year', col, st) - 1.0), 0)} %"
        for st in ("A", "B")
    )


table(
    "econ_pct_year",
    ["Year, change from today's firmware on today's band"] + [c[1] for c in PCT],
    [[label] + [pct(s, c) for c, _ in PCT] for s, label in ECON[1:5]],
)

table(
    "glance",
    ["Year, simulated, model A / B"] + [c[1].replace("Both in band", "Both in own band") for c in COLS],
    [
        [label] + [ab(s, "year", c, nd) for c, _, nd in COLS]
        for s, label in [
            ("fw_live", "Today's firmware, today's band"),
            ("law", "The law, today's band"),
            ("fw_econ2", "Today's firmware, band 2"),
            ("econ2", "The law, band 2 (three small band edits, section 5.7)"),
        ]
    ],
)

# the same band under both controllers: what holding the band costs
SB = [
    ("Today's band", "fw_live", "law"),
    ("Band 1", "fw_econ1", "econ1"),
    ("Band 2", "fw_econ2", "econ2"),
    ("Band 3", "fw_econ3", "econ3"),
]
table(
    "same_band",
    ["Year, the law minus today's firmware on the same band"] + [c[1] for c in GL],
    [[label] + [dab(lw, fw, "year", c, nd) for c, _, nd in GL] for label, fw, lw in SB],
)

# month by month: today's firmware and the law
MONTHS = sorted(x for x in set(D[D.scenario == "law"].period) if x[:2] == "20")
MC = [
    ("both_in_pct", "Both in band %", 1),
    ("starts_day", "Relay starts/day", 0),
    ("heat2_starts_day", "Furnace starts/day", 1),
    ("vent_starts_day", "Vent starts/day", 1),
    ("fog_starts_day", "Fogger starts/day", 1),
    ("therms_day", "Therms/day", 2),
    ("gal_day", "Gallons/day", 0),
]
for scn, nm in (("fw_live", "today"), ("law", "law")):
    table(
        f"monthly_{nm}",
        ["Month"] + [c[1] for c in MC],
        [[mth] + [ab(scn, mth, c, nd) for c, _, nd in MC] for mth in MONTHS],
    )

# pre-staging, perfect foresight
PRE = [
    (
        "pre_heat_d25_h12",
        "Pre-heat: electric heater lines 0.5 F higher, 12 h ahead of a night more than 25 F below the band",
    ),
    ("pre_heat_s5_d25_h12", "Pre-heat: electric heater lines 4.5 F higher, same trigger"),
    ("pre_heat_s5_d25_h12_err8", "The same with a forecast error of up to 8 F"),
    (
        "pre_cool_d5_h6",
        "Pre-cool: start cooling 4 F below the high edge, 6 h ahead of a day more than 5 F above the band",
    ),
    ("pre_cool_d0_h6", "Pre-cool: the same, 6 h ahead of a day above the band"),
    ("pre_cool_d-5_h8", "Pre-cool: the same, 8 h ahead of a day within 5 F of the band's high edge"),
    ("pre_cool_d0_h6_err8", "Pre-cool (day above the band) with a forecast error of up to 8 F"),
    ("pre_dry_d10_h6", "Pre-dry: dry 0.10 kPa earlier when the next 6 h turn 10 F colder outdoors"),
    ("pre_dry_d10_h10", "Pre-dry: the same, 10 h ahead"),
    ("pre_dry_d20_h10", "Pre-dry: when the next 10 h turn 20 F colder outdoors"),
    ("hold_sun_h0_f1_heater", "Hold back: electric heater lines 1 F lower while the sun is on the house (no forecast)"),
    (
        "hold_sun_h0_f1_stack",
        "Hold back: heater lines, drying start and furnace off line 1 F lower while the sun is on the house (no forecast)",
    ),
    ("hold_sun_h3_f0.5_heater", "Hold back: electric heater lines 0.5 F lower from 3 h ahead of sun"),
    ("hold_sun_h3_f1_heater", "Hold back: electric heater lines 1 F lower, 3 h ahead"),
    (
        "hold_sun_h3_f2",
        "Hold back: electric heater lines and drying start 2 F lower, 3 h ahead (inside the furnace's swing)",
    ),
    ("hold_sun_h3_f2_stack", "Hold back: the same with the furnace's off line 1.5 F lower"),
    ("hold_sun_h3_f1_stack", "Hold back: heater lines, drying start and furnace off line 1 F lower, 3 h ahead"),
    (
        "hold_sun_h6_f2_stack",
        "Hold back: heater lines and drying start 2 F and furnace off line 1.5 F lower, 6 h ahead",
    ),
]
PCOL = [
    ("prestage_pct", "Share of time active %", 1),
    ("both_in_pct", "Both in band", 2),
    ("therms_day", "Therms/day", 2),
    ("kwh_day", "kWh/day", 2),
    ("gal_day", "Gallons/day", 1),
    ("starts_day", "Starts/day", 1),
    ("heat2_starts_day", "Furnace starts/day", 1),
    ("run_h_day", "Run hours/day", 2),
]
table(
    "prestage",
    ["Pre-staging rule (year, difference from the law)"] + [c[1] for c in PCOL],
    [
        [label] + [ab(s, "year", PCOL[0][0], PCOL[0][2])] + [dab(s, "law", "year", c, nd) for c, _, nd in PCOL[1:]]
        for s, label in PRE
    ],
)

# robustness
if (D.perturbation != "-").any():
    PL = [
        ("nominal", "Fitted model"),
        ("moisture_source_x1.5", "Moisture source x 1.5"),
        ("moisture_source_x0.7", "Moisture source x 0.7"),
        ("fan_flow_x2", "Fan air flow x 2"),
        ("fan_flow_x0.5", "Fan air flow x 0.5"),
        ("furnace_x0.7", "Furnace heat x 0.7"),
        ("electric_heater_x0.8", "Electric heater heat x 0.8"),
        ("envelope_loss_x1.25", "Envelope heat loss x 1.25"),
        ("infiltration_x0.5", "Infiltration x 0.5"),
        ("fog_evaporation_x0.5", "Fog evaporation x 0.5"),
        ("fog_evaporation_x1.5", "Fog evaporation x 1.5"),
        ("sorption_buffer_x2", "Moisture buffer x 2"),
        ("sensor_lag_x2", "Sensor lag x 2"),
        ("electric_heater_dead", "Electric heater dead"),
        ("furnace_dead", "Furnace dead (gas outage)"),
    ]
    have = set(D.perturbation)
    rows = []
    for p, label in PL:
        if p not in have:
            continue
        rows.append(
            [
                label,
                ab("fw_live", "year", "both_in_pct", 1, p),
                ab("fwp_all_day_best", "year", "both_in_pct", 1, p),
                ab("law", "year", "both_in_pct", 1, p),
                ab("law_e0.7", "year", "both_in_pct", 1, p),
                ab("fw_live", "year", "starts_day", 0, p),
                ab("law", "year", "starts_day", 0, p),
                "relay time only" if p == "furnace_dead" else ab("law", "year", "therms_day", 2, p),
                ab("law", "year", "temp_min_f", 1, p),
            ]
        )
    table(
        "robust",
        [
            "Model changed by",
            "Both % today",
            "Both % step 2",
            "Both % law",
            "Both % law, limit 0.7",
            "Starts/day today",
            "Starts/day law",
            "Therms/day law",
            "Coldest F law",
        ],
        rows,
    )
print("tables ->", OUT)
