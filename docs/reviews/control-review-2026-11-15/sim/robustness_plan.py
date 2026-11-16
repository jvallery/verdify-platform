"""Robustness of the band-edge law to model error: perturb the fitted physics one factor at a time (both model variants)
and re-run today's firmware, the step 2 patch and the law. Single process, about 15 s per perturbation and scenario.
Usage: robustness_plan.py [--only=<perturbation>] [scenario ...]   -> results_robust3.csv"""

import json
import os
import sys
import time

SIM = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SIM)
import pandas as pd  # noqa: E402
import scenarios as S2  # noqa: E402
import scenarios_plan as S3  # noqa: E402

PERTURB = {
    "nominal": {},
    "moisture_source_x1.5": {"_canopy": 1.5},
    "moisture_source_x0.7": {"_canopy": 0.7},
    "fan_flow_x2": {"MV_FAN1": 2.0, "MV_FAN2": 2.0},
    "fan_flow_x0.5": {"MV_FAN1": 0.5, "MV_FAN2": 0.5},
    "furnace_x0.7": {"QH2": 0.7},
    "electric_heater_x0.8": {"QH1": 0.8},
    "envelope_loss_x1.25": {"UA": 1.25, "UAW": 1.25},
    "infiltration_x0.5": {"MINF": 0.5},
    "fog_evaporation_x0.5": {"GFOG": 0.5},
    "fog_evaporation_x1.5": {"GFOG": 1.5},
    "sorption_buffer_x2": {"MB": 2.0},
    "sensor_lag_x2": {"TAUS_T": 2.0, "TAUS_W": 2.0},
    "electric_heater_dead": {"QH1": 0.0},
    "furnace_dead": {"QH2": 0.001},  # a gas outage: the physics divides by QH2, so 0.1 % stands for no heat
}
TMP = set()


def scaled(params, mult, tag):
    p = json.load(open(f"{SIM}/{params}"))
    for k, m in mult.items():
        if not k.startswith("_"):
            p[k] = p[k] * m
    out = f"_tmp3_{tag}_{params}"
    json.dump(p, open(f"{SIM}/{out}", "w"))
    TMP.add(f"{SIM}/{out}")
    return out


def find(name):
    return next(s for group in S3.GROUPS.values() for s in group if s[0] == name)


def main():
    only = [x.split("=", 1)[1] for x in sys.argv[1:] if x.startswith("--only=")]
    names = [x for x in sys.argv[1:] if not x.startswith("--")] or ["fw_live", "fwp_all_day_best", "law", "law_e0.7"]
    out = []
    t0 = time.time()
    for pname, mult in PERTURB.items():
        if only and pname not in only:
            continue
        sets = {}
        for sname, sdef in S2.SETS.items():
            sets[sname] = {
                season: (
                    scaled(params, mult, pname) if any(not k.startswith("_") for k in mult) else params,
                    cs * mult.get("_canopy", 1.0),
                )
                for season, (params, cs) in sdef.items()
            }
        for n in names:
            name, ctrl, season_cfg, kv = find(n)
            df = S3.run_scn(name, ctrl, season_cfg, dict(kv, sets=sets))
            df.insert(1, "perturbation", pname)
            out.append(df)
    res = pd.concat(out, ignore_index=True)
    res = res[res.period.isin(["year", "winter", "summer"])]
    if only:  # replace those perturbations in the existing file
        old = pd.read_csv(f"{SIM}/results_robust3.csv")
        res = pd.concat([old[~old.perturbation.isin(only)], res], ignore_index=True)
    res.to_csv(f"{SIM}/results_robust3.csv", index=False)
    for f in TMP:
        os.remove(f)
    print(f"{len(out)} runs, {time.time() - t0:.0f} s -> results_robust3.csv")


if __name__ == "__main__":
    main()
