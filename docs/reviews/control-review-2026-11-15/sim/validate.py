"""Closed-loop sim-to-real validation with seasonal parameter sets and a canopy sweep."""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pandas as pd  # noqa: E402
import runner  # noqa: E402

pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 60)
WIN = {
    "oct": ("2026-10-01", "2026-11-06 18:00", 0),
    "nov": ("2026-11-06 18:00", "2026-11-15 17:00", 1),
    "julaug": ("2026-07-12", "2026-08-13", 0),
    "jun": ("2026-06-01", "2026-07-01", 0),
    "sep": ("2026-09-01", "2026-09-28", 0),
}
keep = [
    "temp_in_pct",
    "temp_below_pct",
    "temp_above_pct",
    "vpd_in_pct",
    "vpd_below_pct",
    "vpd_above_pct",
    "vpd_below_night_pct",
    "heat1_h_day",
    "heat2_h_day",
    "fan1_h_day",
    "fan2_h_day",
    "vent_h_day",
    "fog_h_day",
    "mister_h_day",
    "kwh_day",
    "therms_day",
    "gal_day",
    "temp_mean_f",
    "vpd_mean",
    "vpd_mean_night",
    "temp_max_f",
]


def val(win, params, label, **kv):
    a, b, dry = WIN[win]
    s0 = str(pd.Timestamp(a) - pd.Timedelta(days=3))
    f = runner.run("sim", "fw", params, start=s0, end=b, score_from=a, dryout_from=(0 if dry else 4e9), **kv)
    return f[f.period == "ALL"].iloc[0][keep].rename((win, label))


def obs(win, params="params_W1.json"):
    a, b, dry = WIN[win]
    o = runner.run("obs", "replay", params, start=a, end=b, score_from=a)
    return o[o.period == "ALL"].iloc[0][keep].rename((win, "obs"))


def replay_monthly(path):
    """Score the recorded climate by calendar month with the simulator's metric code and today's band (no simulation)."""
    o = runner.run(
        "record",
        "replay",
        "params_W1.json",
        start="2026-05-25 06:00",
        end="2026-11-15 17:00",
        score_from="2026-05-25 06:00",
    )
    o = o[
        ["scenario", "period", "days", "both_in_pct"] + keep + ["dryout_nights", "dryout_pass_pct", "dryout_min_night"]
    ]
    o.round(5).to_csv(path, index=False)
    print(
        o[
            [
                "period",
                "days",
                "both_in_pct",
                "temp_in_pct",
                "vpd_in_pct",
                "dryout_nights",
                "dryout_pass_pct",
                "dryout_min_night",
            ]
        ].to_string(index=False)
    )


if __name__ == "__main__":
    if sys.argv[1] == "replay":  # validate.py replay <out.csv>
        replay_monthly(sys.argv[2])
        sys.exit(0)
    spec = json.loads(sys.argv[1])  # list of [win, params, label, {kv}]
    cols = []
    seen = set()
    for win, params, label, kv in spec:
        if win not in seen:
            cols.append(obs(win))
            seen.add(win)
        cols.append(val(win, params, label, **kv))
    print(pd.concat(cols, axis=1).to_string())
