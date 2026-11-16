"""Robustness to model error: perturb the fitted physics one factor at a time (both model variants) and re-run.
Single process, about 1 minute each.
Usage: robustness.py        -> results_robust.csv        the current firmware and the two-axis controller, ten perturbations
       robustness.py night  -> results_robust_night.csv  the steps to the overnight dry-out goal with the fan flow halved and doubled"""

import json
import os
import sys
import time

SIM = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SIM)
import pandas as pd  # noqa: E402
import scenarios as sc  # noqa: E402

PERTURB = {
    "nominal": {},
    "moisture_source_x1.5": {"_canopy": 1.5},
    "moisture_source_x0.7": {"_canopy": 0.7},
    "fan_flow_x2": {"MV_FAN1": 2.0, "MV_FAN2": 2.0},
    "fan_flow_x0.5": {"MV_FAN1": 0.5, "MV_FAN2": 0.5},
    "furnace_x0.7": {"QH2": 0.7},
    "envelope_loss_x1.25": {"UA": 1.25, "UAW": 1.25},
    "infiltration_x0.5": {"MINF": 0.5},
    "sorption_buffer_x2": {"MB": 2.0},
    "sensor_lag_x2": {"TAUS_T": 2.0, "TAUS_W": 2.0},
}
REC = dict(sc.KISS_REC, kiss__gas_interlock=1, kiss__dehum_min_above_low=0.5)
SCN = [sc.S("fw_live"), sc.S("kiss_final", "kiss", **REC)]
BASE_SETS = dict(sc.SETS)
TMP = set()  # perturbed parameter files, removed when the run ends


def scaled(params, mult, tag):
    p = json.load(open(f"{SIM}/{params}"))
    for k, m in mult.items():
        if not k.startswith("_"):
            p[k] = p[k] * m
    out = f"_tmp_{tag}_{params}"
    json.dump(p, open(f"{SIM}/{out}", "w"))
    TMP.add(f"{SIM}/{out}")
    return out


NIGHT_PERTURB = ["nominal", "fan_flow_x0.5", "fan_flow_x2"]
NIGHT_SCN = [
    "fw_live",
    "fw_dryout_600_300",
    "fw_settings_300",
    "fwp_all_day_best",
    "fwp_all_day_best_target+0.05",
    "fwp_all_day_best_fans2",
]


def find(name):
    return next(s for group in sc.GROUPS.values() for s in group if s[0] == name)


def run(perturbations, scenarios, periods, out_name):
    out = []
    t0 = time.time()
    for pname in perturbations:
        mult = PERTURB[pname]
        sets = {}
        for sname, sdef in BASE_SETS.items():
            sets[sname] = {
                season: (
                    scaled(params, mult, pname) if any(not k.startswith("_") for k in mult) else params,
                    cs * mult.get("_canopy", 1.0),
                )
                for season, (params, cs) in sdef.items()
            }
        sc.SETS = sets
        for name, ctrl, season_cfg, kv in scenarios:
            df = sc.run_scn(name, ctrl, season_cfg, kv)
            df.insert(1, "perturbation", pname)
            out.append(df)
    res = pd.concat(out, ignore_index=True)
    res = res[res.period.isin(periods)]
    res.to_csv(f"{SIM}/{out_name}", index=False)
    for f in TMP:
        os.remove(f)
    print(f"{len(out)} runs, {time.time() - t0:.0f} s -> {out_name}")


def main():
    if sys.argv[1:] == ["night"]:
        run(
            NIGHT_PERTURB,
            [find(n) for n in NIGHT_SCN],
            ["year", "winter", "2026-10", "2026-11"],
            "results_robust_night.csv",
        )
    else:
        run(list(PERTURB), SCN, ["year", "winter", "summer"], "results_robust.csv")


if __name__ == "__main__":
    main()
