#!/usr/bin/env python
"""Build a unified 1-minute grid: climate (mean per minute) + actuator duty fractions.

Output: sim/grid_1min.pkl (pandas DataFrame indexed by UTC minute).
Single process, bounded memory (~1 GB peak).
"""

import os

import numpy as np
import pandas as pd

SP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(SP, "data")

CLIM_COLS = [
    "ts",
    "temp_avg",
    "temp_north",
    "temp_south",
    "temp_east",
    "temp_west",
    "temp_case",
    "temp_intake",
    "rh_avg",
    "vpd_avg",
    "vpd_south",
    "vpd_west",
    "vpd_east",
    "dew_point",
    "abs_humidity",
    "lux",
    "outdoor_temp_f",
    "outdoor_rh_pct",
    "pressure_hpa",
    "wind_speed_mph",
    "outdoor_lux",
    "solar_irradiance_w_m2",
    "solar_altitude_deg",
    "solar_phase",
    "intake_rh",
    "water_total_gal",
    "mister_water_today",
    "flow_gpm",
]
EQUIP = [
    "heat1",
    "heat2",
    "fan1",
    "fan2",
    "vent",
    "fog",
    "mister_south",
    "mister_west",
    "mister_center",
    "grow_light_main",
    "grow_light_grow",
    "drip_wall",
    "drip_center",
]


def main():
    c = pd.read_csv(os.path.join(D, "climate_raw.csv"), usecols=CLIM_COLS)
    c["ts"] = pd.to_datetime(c["ts"], utc=True, format="ISO8601")
    c = c.set_index("ts").sort_index()
    for col in c.columns:
        c[col] = c[col].astype("float32")
    g = c.resample("1min").mean()
    g["n_raw"] = c["temp_avg"].resample("1min").count().astype("int16")
    # raw cadence is ~70 s, so ~1 in 7 minute-bins is empty: fill gaps of up to 3 minutes
    cont = [x for x in g.columns if x not in ("n_raw", "water_total_gal", "mister_water_today")]
    g[cont] = g[cont].interpolate(limit=3, limit_area="inside")
    del c
    t0, t1 = g.index[0], g.index[-1]
    edges = pd.date_range(t0, t1 + pd.Timedelta(minutes=1), freq="1min")
    EPOCH = pd.Timestamp("1970-01-01", tz="UTC")
    edges_s = np.asarray((edges - EPOCH).total_seconds(), dtype="float64")

    e = pd.read_csv(os.path.join(D, "equipment_state.csv"))
    e = e[e["equipment"].isin(EQUIP)].copy()
    e["ts"] = pd.to_datetime(e["ts"], utc=True, format="ISO8601")
    e = e.sort_values(["equipment", "ts"])
    for name in EQUIP:
        x = e[e["equipment"] == name]
        if x.empty:
            g["d_" + name] = np.float32(np.nan)
            continue
        ts = np.asarray((pd.DatetimeIndex(x["ts"]) - EPOCH).total_seconds(), dtype="float64")
        st = x["state"].values.astype(np.int8)
        # drop repeated states
        keep = np.ones(len(st), dtype=bool)
        keep[1:] = st[1:] != st[:-1]
        ts, st = ts[keep], st[keep]
        # cumulative on-seconds function evaluated at transition times
        dt = np.diff(ts, append=ts[-1])
        on_seg = dt * st  # seconds on in the segment starting at ts[i]
        cum = np.concatenate([[0.0], np.cumsum(on_seg)])  # cum[i] = on-seconds before ts[i]; cum[-1] total
        # on-seconds up to time t: interpolate piecewise-linear
        tt = np.concatenate([ts, [ts[-1]]])
        cum_at_edges = np.interp(edges_s, tt, cum, left=0.0, right=cum[-1])
        duty = np.diff(cum_at_edges) / 60.0
        # before the first transition we do not know the state -> NaN
        first_known = ts[0]
        duty[edges_s[:-1] < first_known] = np.nan
        g["d_" + name] = duty.astype("float32")
    del e

    en = pd.read_csv(os.path.join(D, "energy_raw.csv"), usecols=["ts", "watts_total", "ch0_power_w", "ch1_power_w"])
    en["ts"] = pd.to_datetime(en["ts"], utc=True, format="ISO8601")
    en = en.set_index("ts").sort_index().astype("float32")
    g = g.join(en.resample("1min").mean(), how="left")

    # derived physical quantities (SI)
    tC = (g["temp_avg"] - 32.0) / 1.8
    toC = (g["outdoor_temp_f"] - 32.0) / 1.8
    P = g["pressure_hpa"].fillna(840.0) * 100.0  # Pa (site ~840 hPa)

    def esat(tc):  # Pa, Magnus over water
        return 610.94 * np.exp(17.625 * tc / (tc + 243.04))

    e_in = esat(tC) * g["rh_avg"] / 100.0
    e_out = esat(toC) * g["outdoor_rh_pct"] / 100.0
    g["T_in_C"] = tC.astype("float32")
    g["T_out_C"] = toC.astype("float32")
    g["w_in"] = (0.622 * e_in / (P - e_in) * 1000.0).astype("float32")  # g/kg dry air
    g["w_out"] = (0.622 * e_out / (P - e_out) * 1000.0).astype("float32")
    g["vpd_calc"] = ((esat(tC) - e_in) / 1000.0).astype("float32")
    g.to_pickle(os.path.join(os.path.dirname(os.path.abspath(__file__)), "grid_1min.pkl"))
    print("rows", len(g), "from", g.index[0], "to", g.index[-1])
    print(g.notna().mean().round(3).to_string())
    m = (
        g.notna()
        .groupby(g.index.to_period("M"))
        .mean()[
            [
                "temp_avg",
                "outdoor_temp_f",
                "solar_irradiance_w_m2",
                "outdoor_rh_pct",
                "solar_phase",
                "d_heat1",
                "d_fog",
                "watts_total",
                "ch1_power_w",
                "lux",
            ]
        ]
        .round(2)
    )
    print(m.to_string())
    print(g[["d_" + n for n in EQUIP]].mean().round(4).to_string())


if __name__ == "__main__":
    main()
