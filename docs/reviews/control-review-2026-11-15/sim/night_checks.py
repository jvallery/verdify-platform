"""Three checks behind section 9.7 of the review that need minute traces, not monthly totals. Single process, about
one minute. Usage: night_checks.py -> results_night_checks.csv (check, set, item, value)

failing_nights     The October 2026 nights that miss the dry-out goal after step 2, and what the vent and the heaters
                   were doing between 00:00 and 06:00 on those nights.
closed_house_heat  How far the indoor dew point follows the temperature when the night is held warmer with the dry-out
                   off: the same minutes of two runs, vent and fog off in both. The W5 research measured 0.53 F per F
                   over the year and 0.84 from September to November (docs/research/w5/vpd-band.md, section E).
outdoor_ceiling    The VPD the house would have at 63 F if its air were outdoor air, per October 2026 night.
"""

import os
import sys
import tempfile

SIM = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SIM)
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import runner  # noqa: E402
import scenarios as sc  # noqa: E402

TZ = "America/Denver"
FLOOR_KPA = 0.74  # the night floor of the nightly grade (migration 305)
PASS_MIN = 240  # minutes of 00:00-06:00 at or above the floor for a night to count as dried out
MIN_GRADED = 300


def es(temp_f):
    """Saturation vapour pressure, kPa."""
    tc = (temp_f - 32.0) / 1.8
    return 0.61094 * np.exp(17.625 * tc / (tc + 243.04))


def dewpoint_f(e_kpa):
    x = np.log(e_kpa / 0.61094)
    return 243.04 * x / (17.625 - x) * 1.8 + 32.0


def night_trace(set_name, ctrl, cfg, **span):
    """Run one scenario on the October-to-April parameters and return its scored minutes of 00:00-06:00 local."""
    params, canopy = sc.SETS[set_name]["winter"]
    fd, path = tempfile.mkstemp(suffix=".csv")
    os.close(fd)
    try:
        runner.run("x", ctrl, params, canopy=canopy, dryout_from=0, trace=path, **span, **cfg)
        t = pd.read_csv(path)
    finally:
        os.remove(path)
    t["ts"] = pd.to_datetime(t.epoch_s, unit="s", utc=True).dt.tz_convert(TZ)
    return t[(t.scored == 1) & (t.ts.dt.hour < 6)]


def failing_nights(name="fwp_all_day_best", group="patch", month="2026-10"):
    _, ctrl, season_cfg, kv = next(s for s in sc.GROUPS[group] if s[0] == name)
    rows = []
    for set_name in sc.SETS:
        cfg = dict(sc.SUMMER if season_cfg == "summer" else sc.AUTUMN)
        cfg.update(kv)
        n = night_trace(set_name, ctrl, cfg, **sc.YEAR)
        n = n[n.ts.dt.strftime("%Y-%m") == month]
        n = n.assign(ok=n.vpd >= np.maximum(n.vlo, FLOOR_KPA), above_low_f=n.temp_f - n.tlo)
        g = n.groupby(n.ts.dt.date).agg(
            minutes=("ok", "size"),
            ok=("ok", "sum"),
            vent=("vent", "mean"),
            heat1=("heat1", "mean"),
            heat2=("heat2", "mean"),
            vpd=("vpd", "mean"),
            above_low_f=("above_low_f", "mean"),
        )
        g = g[g.minutes >= MIN_GRADED]
        f = g[g.ok < PASS_MIN]
        rows += [
            ("failing_nights", set_name, "nights_graded", len(g)),
            ("failing_nights", set_name, "nights_failing", len(f)),
            ("failing_nights", set_name, "vent_duty_median", f.vent.median()),
            ("failing_nights", set_name, "vent_duty_min", f.vent.min()),
            ("failing_nights", set_name, "vent_duty_max", f.vent.max()),
            ("failing_nights", set_name, "heat1_duty_median", f.heat1.median()),
            ("failing_nights", set_name, "heat2_duty_median", f.heat2.median()),
            ("failing_nights", set_name, "vpd_kpa_mean", f.vpd.mean()),
            ("failing_nights", set_name, "vpd_kpa_median", f.vpd.median()),
            ("failing_nights", set_name, "above_band_low_f_median", f.above_low_f.median()),
            ("failing_nights", set_name, "minutes_ok_median", f.ok.median()),
            ("failing_nights", set_name, "nights_vent_above_half", int((f.vent > 0.5).sum())),
            ("failing_nights", set_name, "nights_heat1_at_90pct", int((f.heat1 >= 0.9).sum())),
            ("failing_nights", set_name, "nights_vent_and_heat1", int(((f.vent > 0.5) & (f.heat1 >= 0.9)).sum())),
        ]
    return rows


def closed_house_heat():
    span = dict(start="2026-09-25", end="2026-11-15", score_from="2026-10-01")
    rows = []
    for set_name in sc.SETS:
        off = dict(sc.AUTUMN, sp__night_dryout_enabled=0)
        base = night_trace(set_name, "fw", off, **span).set_index("epoch_s")
        base = base.assign(td=dewpoint_f(es(base.temp_f) - base.vpd))
        for k, v in sc.TLOW.items():
            warm = night_trace(set_name, "fw", dict(off, band__temp_low=v), **span).set_index("epoch_s")
            warm = warm.assign(td=dewpoint_f(es(warm.temp_f) - warm.vpd))
            j = base.merge(warm, left_index=True, right_index=True, suffixes=("", "_w"))
            j = j[(j.vent == 0) & (j.vent_w == 0) & (j.fog == 0) & (j.fog_w == 0) & (j.temp_f_w - j.temp_f > 0.5)]
            d_t, d_td, d_v = (j.temp_f_w - j.temp_f).mean(), (j.td_w - j.td).mean(), (j.vpd_w - j.vpd).mean()
            tag = f"night_low{k}F"
            rows += [
                ("closed_house_heat", set_name, f"{tag}_minutes", len(j)),
                ("closed_house_heat", set_name, f"{tag}_dT_f", d_t),
                ("closed_house_heat", set_name, f"{tag}_dTd_f", d_td),
                ("closed_house_heat", set_name, f"{tag}_dTd_per_dT", d_td / d_t),
                ("closed_house_heat", set_name, f"{tag}_dVPD_kpa", d_v),
                ("closed_house_heat", set_name, f"{tag}_dVPD_kpa_per_f", d_v / d_t),
                ("closed_house_heat", set_name, f"{tag}_base_vpd_kpa", j.vpd.mean()),
                ("closed_house_heat", set_name, f"{tag}_base_temp_f", j.temp_f.mean()),
            ]
    return rows


def outdoor_ceiling(temp_f=63.0, month="2026-10"):
    g = pd.read_pickle(os.path.join(SIM, "grid_1min.pkl"))  # noqa: S301 - locally built intermediate (prep.py)
    o = g[["outdoor_temp_f", "outdoor_rh_pct"]].dropna().tz_convert(TZ)
    o = o[(o.index.strftime("%Y-%m") == month) & (o.index.hour < 6)]
    e = es(o.outdoor_temp_f) * o.outdoor_rh_pct / 100.0
    night = e.groupby(o.index.date).agg(["mean", "size"])
    night = night[night["size"] >= MIN_GRADED]
    vpd = es(temp_f) - night["mean"]
    return [
        ("outdoor_ceiling", "record", "nights", len(vpd)),
        ("outdoor_ceiling", "record", f"vpd_kpa_at_{temp_f:g}F_min", vpd.min()),
        ("outdoor_ceiling", "record", f"vpd_kpa_at_{temp_f:g}F_median", vpd.median()),
        ("outdoor_ceiling", "record", f"nights_below_floor_at_{temp_f:g}F", int((vpd < FLOOR_KPA).sum())),
    ]


def main():
    rows = failing_nights() + closed_house_heat() + outdoor_ceiling()
    out = pd.DataFrame(rows, columns=["check", "set", "item", "value"])
    out["value"] = out.value.astype(float).round(4)
    path = f"{SIM}/results_night_checks.csv"
    out.to_csv(path, index=False)
    print(out.to_string(index=False))
    print("->", path)


if __name__ == "__main__":
    main()
