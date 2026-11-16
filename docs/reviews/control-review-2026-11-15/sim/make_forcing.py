#!/usr/bin/env python
"""Write the closed-loop forcing file: one row per minute, float64 columns, column-major binary.

Layout: int64 n, int64 ncol, then ncol arrays of n float64. Column order = COLS below.
Weather gaps are filled (interpolate up to 30 min, then forward/backward fill) because a closed-loop run
needs continuous forcing; `wx_ok` marks minutes whose weather was measured or interpolated across <=30 min.
"""

import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
g = pd.read_pickle(os.path.join(HERE, "grid_1min.pkl"))  # noqa: S301 - locally built intermediate (prep.py)
alt = g["solar_altitude_deg"].interpolate(limit=30)
S = g["solar_irradiance_w_m2"].copy()
S[(S.isna()) & (alt < 0)] = 0.0
S = S.interpolate(limit=30, limit_area="inside")
cot = 1.0 / np.tan(np.radians(alt.clip(lower=5.0)))
Scot = S * np.minimum(3.0, cot).where(alt > 5.0, 0.0)
o = pd.DataFrame(index=g.index)
o["epoch_s"] = (g.index - pd.Timestamp("1970-01-01", tz="UTC")).total_seconds()
To = g["T_out_C"].interpolate(limit=30, limit_area="inside")
wo = g["w_out"].interpolate(limit=30, limit_area="inside")
o["wx_ok"] = (To.notna() & wo.notna() & S.notna()).astype(float)
o["To"] = To.ffill().bfill()
o["wo"] = wo.ffill().bfill()
o["S"] = S.ffill().bfill()
o["Scot"] = Scot.ffill().bfill().fillna(0.0)
o["wind"] = g["wind_speed_mph"].interpolate(limit=30, limit_area="inside").ffill().bfill().fillna(3.0)
o["P"] = g["pressure_hpa"].interpolate(limit=120).ffill().bfill().fillna(840.0) * 100.0
o["alt"] = alt.ffill().bfill()
o["glm"] = g["d_grow_light_main"].fillna(0.0)
o["glg"] = g["d_grow_light_grow"].fillna(0.0)
o["Tmeas"] = g["T_in_C"]
o["wmeas"] = g["w_in"]
o["in_ok"] = (g["T_in_C"].notna() & g["w_in"].notna()).astype(float)
for k, c in [
    ("o_h1", "d_heat1"),
    ("o_h2", "d_heat2"),
    ("o_vent", "d_vent"),
    ("o_f1", "d_fan1"),
    ("o_f2", "d_fan2"),
    ("o_fog", "d_fog"),
    ("o_mc", "d_mister_center"),
    ("o_ms", "d_mister_south"),
    ("o_mw", "d_mister_west"),
]:
    o[k] = g[c]
o["o_ok"] = o[["o_h1", "o_h2", "o_vent", "o_f1", "o_f2", "o_fog", "o_mc"]].notna().all(axis=1).astype(float)
o = o.fillna(0.0)
COLS = list(o.columns)
with open(os.path.join(HERE, "forcing.bin"), "wb") as f:
    np.array([len(o), len(COLS)], dtype=np.int64).tofile(f)
    for c in COLS:
        np.ascontiguousarray(o[c].values, dtype=np.float64).tofile(f)
json.dump(COLS, open(os.path.join(HERE, "forcing_cols.json"), "w"))
print(len(o), COLS)
print("first", g.index[0], "last", g.index[-1], "wx_ok", o.wx_ok.mean().round(3), "in_ok", o.in_ok.mean().round(3))
