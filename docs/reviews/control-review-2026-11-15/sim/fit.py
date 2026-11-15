#!/usr/bin/env python
"""Fit the lumped greenhouse physics model (physics.h) to one year of 1-minute data.

Prediction-error fit: the model is simulated open-loop with the RECORDED actuator duty and weather,
re-initialising only the measured states (air temp, humidity) every H minutes; the hidden states
(thermal mass, wet-surface reservoir, furnace lag) run free. Residuals are the simulated minus the
measured sensor temperature and humidity ratio inside each window. Weeks with index % 4 == 3 are held
out for validation.

Workload bound: single process, one core, < 1 GB RAM, a few minutes.
"""

import ctypes
import json
import os
import time

import numpy as np
import pandas as pd
from scipy.optimize import least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
H_FAST = int(os.environ.get("FIT_H_FAST", "20"))  # minutes between re-initialisations, fast pass
H_SLOW = int(os.environ.get("FIT_H_SLOW", "240"))  # slow pass
H = H_SLOW
SUB = int(os.environ.get("FIT_SUB", "3"))  # sub-steps per minute
SIG_T, SIG_W = 0.4, 0.4  # residual scales: degC, g/kg

NAMES = [
    "CA",
    "CI",
    "CM",
    "HAI",
    "HIM",
    "UA",
    "UAW",
    "UAM",
    "SOLA",
    "SOLI",
    "SOLM",
    "SOLALT",
    "QH1",
    "FH1I",
    "QH2",
    "TAUH2",
    "QLA",
    "MV_VENT",
    "MV_FAN1",
    "MV_FAN2",
    "MINF",
    "MA",
    "MB",
    "KB",
    "GFOG",
    "GMIST",
    "RFOG",
    "RMIST",
    "KRES",
    "RMAX",
    "TR0",
    "TRS",
    "E0",
    "KCOND",
    "GLAZE",
    "TAUS_T",
    "TAUS_W",
    "PLUME",
]
#            init      lo       hi     fit?
SPEC = {
    "CA": (1.1e6, 2.0e5, 2.5e6, True),
    "CI": (6e6, 1.0e6, 4e7, True),
    "CM": (5e7, 5e6, 6e8, True),
    "HAI": (1500, 100, 20000, True),
    "HIM": (300, 5, 3000, True),
    "UA": (250, 40, 1500, True),
    "UAW": (5, 1e-3, 80, True),
    "UAM": (20, 1e-2, 600, True),
    "SOLA": (5, 1e-2, 40, True),
    "SOLI": (3, 1e-2, 40, True),
    "SOLM": (3, 1e-2, 40, True),
    "SOLALT": (0.3, 1e-3, 3.0, True),
    "QH1": (1436, 1000, 1700, False),
    "FH1I": (0.5, 0.02, 0.98, True),
    "QH2": (6000, 2000, 22000, True),
    "TAUH2": (70, 10, 600, True),
    "QLA": (0.6, 1e-2, 1.0, True),
    "MV_VENT": (0.05, 1e-3, 2.5, True),
    "MV_FAN1": (0.3, 2e-2, 3.5, True),
    "MV_FAN2": (0.15, 1e-3, 3.5, True),
    "MINF": (0.05, 1e-3, 0.8, True),
    "MA": (110, 90, 400, True),
    "MB": (600, 20, 2e4, True),
    "KB": (0.3, 1e-3, 20, True),
    "GFOG": (2.0, 1e-2, 60, True),
    "GMIST": (2.0, 1e-3, 60, True),
    "RFOG": (0.5, 1e-3, 30, True),
    "RMIST": (20.0, 1e-3, 3000, True),
    "KRES": (1e-4, 1e-6, 0.1, True),
    "RMAX": (8000, 50, 3e5, True),
    "TR0": (0.01, 1e-5, 2.0, True),
    "TRS": (4e-4, 1e-7, 1e-2, True),
    "E0": (0.15, 1e-4, 2.0, True),
    "KCOND": (0.01, 1e-4, 10, True),
    "GLAZE": (0.3, 0.03, 0.95, True),
    "TAUS_T": (40, 5, 900, True),
    "TAUS_W": (40, 5, 900, True),
    "PLUME": (0.5, 0.01, 4.0, True),
}

CS_NAMES = [f"CS{i:02d}" for i in range(13)]  # canopy scale per calendar month 2025-11 .. 2026-11
for _k in CS_NAMES:
    SPEC.setdefault(
        _k,
        (
            1.0,
            0.05,
            20.0,
            (_k in os.environ["FIT_CS_FIT"].split(","))
            if os.environ.get("FIT_CS_FIT")
            else (_k not in ("CS11", "CS12") and not os.environ.get("FIT_NO_CS")),
        ),
    )

if os.environ.get("FIT_SPEC"):
    for _k, _v in json.load(open(os.environ["FIT_SPEC"])).items():
        if len(_v) == 1:
            SPEC[_k] = (
                min(max(float(_v[0]), SPEC[_k][1] * 1.001), SPEC[_k][2] * 0.999),
                SPEC[_k][1],
                SPEC[_k][2],
                SPEC[_k][3],
            )
        else:
            SPEC[_k] = (float(_v[0]), float(_v[1]), float(_v[2]), bool(_v[3]) if len(_v) > 3 else True)

lib = ctypes.CDLL(os.path.join(HERE, "libfit.dylib"))
DP = ctypes.POINTER(ctypes.c_double)
IP = ctypes.POINTER(ctypes.c_int)
lib.simulate_open.restype = None
assert lib.phys_nparams() == len(NAMES), (lib.phys_nparams(), len(NAMES))


def load(Hwin=None):
    Hwin = Hwin or H
    g = pd.read_pickle(os.path.join(HERE, "grid_1min.pkl"))  # noqa: S301 - locally built intermediate (prep.py)
    alt = g["solar_altitude_deg"].interpolate(limit=30)
    S = g["solar_irradiance_w_m2"].copy()
    S[(S.isna()) & (alt < 0)] = 0.0  # the station reports no solar value at night
    S = S.interpolate(limit=30, limit_area="inside")
    cot = 1.0 / np.tan(np.radians(alt.clip(lower=5.0)))
    Scot = S * np.minimum(3.0, cot).where(alt > 5.0, 0.0)
    out = pd.DataFrame(index=g.index)
    out["Tmeas"] = g["T_in_C"]
    out["wmeas"] = g["w_in"]
    out["To"] = g["T_out_C"].interpolate(limit=30, limit_area="inside")
    out["wo"] = g["w_out"].interpolate(limit=30, limit_area="inside")
    out["S"] = S
    out["Scot"] = Scot
    out["wind"] = g["wind_speed_mph"].interpolate(limit=30, limit_area="inside").fillna(3.0)
    out["P"] = g["pressure_hpa"].interpolate(limit=120).fillna(840.0) * 100.0
    for k, col in [
        ("h1", "d_heat1"),
        ("h2", "d_heat2"),
        ("vent", "d_vent"),
        ("f1", "d_fan1"),
        ("f2", "d_fan2"),
        ("fog", "d_fog"),
        ("mc", "d_mister_center"),
        ("ms", "d_mister_south"),
        ("mw", "d_mister_west"),
        ("glm", "d_grow_light_main"),
        ("glg", "d_grow_light_grow"),
    ]:
        out[k] = g[col]
    if os.environ.get("FIT_H1_OFF_BEFORE"):  # the electric heater drew no power before this date (relay on, no load)
        out.loc[out.index < pd.Timestamp(os.environ["FIT_H1_OFF_BEFORE"], tz="UTC"), "h1"] = 0.0
    need = ["Tmeas", "wmeas", "To", "wo", "S", "Scot", "h1", "h2", "vent", "f1", "f2", "fog", "mc", "ms", "mw"]
    valid = out[need].notna().all(axis=1).values
    out["glm"] = out["glm"].fillna(0.0)
    out["glg"] = out["glg"].fillna(0.0)
    if os.environ.get("FIT_FROM"):
        lo_t = pd.Timestamp(os.environ["FIT_FROM"], tz="UTC")
        hi_t = pd.Timestamp(os.environ.get("FIT_TO", "2100-01-01"), tz="UTC")
        inwin = np.asarray((out.index >= lo_t) & (out.index < hi_t))
        if os.environ.get("FIT_FROM2"):
            lo2 = pd.Timestamp(os.environ["FIT_FROM2"], tz="UTC")
            hi2 = pd.Timestamp(os.environ.get("FIT_TO2", "2100-01-01"), tz="UTC")
            inwin = inwin | np.asarray((out.index >= lo2) & (out.index < hi2))
        valid = valid & inwin
    n = len(out)
    (np.arange(n) + int(out.index[0].value // 60_000_000_000 if out.index.unit == "ns" else 0))
    # absolute minute index since epoch for stable window boundaries
    epoch_min = ((out.index - pd.Timestamp("1970-01-01", tz="UTC")).total_seconds() // 60).astype(np.int64).values
    reset = np.zeros(n, dtype=np.int32)
    burn = np.zeros(n, dtype=bool)
    horizon = np.zeros(n, dtype=np.int32)
    gap = 10**9
    since_cold = 0
    hz = 0
    for i in range(n):
        if not valid[i]:
            reset[i] = -1
            gap += 1
            continue
        if gap > 30:
            reset[i] = 2
            since_cold = 0
            hz = 0
        elif gap > 0 or epoch_min[i] % Hwin == 0:
            reset[i] = 1
            hz = 0
        else:
            hz += 1
        gap = 0
        since_cold += 1
        burn[i] = since_cold <= 720
        horizon[i] = hz
    week = epoch_min // (7 * 1440)
    test = week % 4 == 3
    out = out.fillna(0.0)
    return out, valid, reset, burn, horizon, test


def cptr(a):
    return a.ctypes.data_as(DP)


class Model:
    def __init__(self):
        self.df, self.valid, self.reset, self.burn, self.horizon, self.test = load(H_SLOW)
        _, _, self.reset_f, _, self.horizon_f, _ = load(H_FAST)
        self.n = len(self.df)
        self.arr = {k: np.ascontiguousarray(self.df[k].values, dtype=np.float64) for k in self.df.columns}
        self.Tsim = np.empty(self.n)
        self.wsim = np.empty(self.n)
        self.Tm = np.empty(self.n)
        self.Ti = np.empty(self.n)
        use = self.valid & ~self.burn & (self.horizon > 0)
        self.train = use & ~self.test
        self.testm = use & self.test
        mT = pd.Series(self.arr["Tmeas"])
        self.hp_meas = (mT - mT.rolling(31, center=True, min_periods=20).mean()).values
        self.hp_ok = np.isfinite(self.hp_meas) & (self.horizon > 30) & (self.horizon < H_SLOW - 16)
        use_f = self.valid & ~self.burn & (self.horizon_f > 0)
        self.train_f = use_f & ~self.test
        self.test_f = use_f & self.test
        loc = self.df.index.tz_convert("America/Denver")
        self.month_idx = np.clip((loc.year - 2025) * 12 + loc.month - 11, 0, 12).astype(np.int64)
        self.cs = np.ones(self.n)
        self.fit_names = [k for k in NAMES + CS_NAMES if SPEC[k][3]]
        self.x0 = np.log([SPEC[k][0] for k in self.fit_names])
        self.lo = np.log([SPEC[k][1] for k in self.fit_names])
        self.hi = np.log([SPEC[k][2] for k in self.fit_names])

    def params(self, x):
        p = {k: SPEC[k][0] for k in NAMES + CS_NAMES}
        for k, v in zip(self.fit_names, x, strict=False):
            p[k] = float(np.exp(v))
        return p

    def simulate(self, p, reset=None):
        pv = np.array([p[k] for k in NAMES], dtype=np.float64)
        self.cs = np.ascontiguousarray(np.array([p[k] for k in CS_NAMES], dtype=np.float64)[self.month_idx])
        a = self.arr
        r = self.reset if reset is None else reset
        lib.simulate_open(
            cptr(pv),
            self.n,
            SUB,
            cptr(a["Tmeas"]),
            cptr(a["wmeas"]),
            cptr(a["To"]),
            cptr(a["wo"]),
            cptr(a["S"]),
            cptr(a["Scot"]),
            cptr(a["wind"]),
            cptr(a["P"]),
            cptr(a["h1"]),
            cptr(a["h2"]),
            cptr(a["vent"]),
            cptr(a["f1"]),
            cptr(a["f2"]),
            cptr(a["fog"]),
            cptr(a["mc"]),
            cptr(a["ms"]),
            cptr(a["mw"]),
            cptr(a["glm"]),
            cptr(a["glg"]),
            cptr(self.cs),
            r.ctypes.data_as(IP),
            cptr(self.Tsim),
            cptr(self.wsim),
            cptr(self.Ti),
            cptr(self.Tm),
        )
        return self.Tsim, self.wsim

    def residuals(self, x):
        p = self.params(x)
        T, w = self.simulate(p)
        m = self.train
        rT = (T[m] - self.arr["Tmeas"][m]) / SIG_T
        rw = (w[m] - self.arr["wmeas"][m]) / SIG_W
        T2, w2 = self.simulate(p, self.reset_f)
        m2 = self.train_f
        rT2 = (T2[m2] - self.arr["Tmeas"][m2]) / (SIG_T * 0.5)
        rw2 = (w2[m2] - self.arr["wmeas"][m2]) / (SIG_W * 0.5)
        # high-pass term (slow pass): keeps the furnace/vent cycle amplitude and phase honest
        hp_s = T - pd.Series(T).rolling(31, center=True, min_periods=20).mean().values
        mh = self.train & self.hp_ok
        rhp = np.nan_to_num((hp_s[mh] - self.hp_meas[mh]) / 0.12, nan=0.0, posinf=0.0, neginf=0.0)
        return np.concatenate([rT[::3], rw[::3], rT2[::3], rw2[::3], rhp[::3]])

    def report(self, p, label):
        T, w = self.simulate(p)
        rows = []
        for name, mask in [("train", self.train), ("test", self.testm)]:
            for lo_h, hi_h in [(1, 5), (6, 15), (16, 30), (31, 60), (61, 120), (121, 10**6)]:
                mm = mask & (self.horizon >= lo_h) & (self.horizon <= hi_h)
                if mm.sum() < 100:
                    continue
                eT = T[mm] - self.arr["Tmeas"][mm]
                ew = w[mm] - self.arr["wmeas"][mm]
                rows.append(
                    (
                        name,
                        f"{lo_h}-{min(hi_h, H)}",
                        int(mm.sum()),
                        np.sqrt(np.mean(eT**2)) * 1.8,
                        np.mean(eT) * 1.8,
                        np.sqrt(np.mean(ew**2)),
                        np.mean(ew),
                    )
                )
        T2, w2 = self.simulate(p, self.reset_f)
        for name, mask in [("train_fast", self.train_f), ("test_fast", self.test_f)]:
            for lo_h, hi_h in [(1, 5), (6, 19)]:
                mm = mask & (self.horizon_f >= lo_h) & (self.horizon_f <= hi_h)
                eT = T2[mm] - self.arr["Tmeas"][mm]
                ew = w2[mm] - self.arr["wmeas"][mm]
                rows.append(
                    (
                        name,
                        f"{lo_h}-{hi_h}",
                        int(mm.sum()),
                        np.sqrt(np.mean(eT**2)) * 1.8,
                        np.mean(eT) * 1.8,
                        np.sqrt(np.mean(ew**2)),
                        np.mean(ew),
                    )
                )
        rep = pd.DataFrame(
            rows, columns=["set", "horizon_min", "n", "rmse_T_F", "bias_T_F", "rmse_w_gkg", "bias_w_gkg"]
        )
        # cycle fidelity: high-pass (minus 31-min centred mean) amplitude while the furnace cycles, slow pass
        T, w = self.simulate(p)
        sT = pd.Series(T)
        mT = pd.Series(self.arr["Tmeas"])
        hp_s = (sT - sT.rolling(31, center=True, min_periods=20).mean()).values
        hp_m = (mT - mT.rolling(31, center=True, min_periods=20).mean()).values
        h2 = pd.Series(self.arr["h2"]).rolling(61, center=True, min_periods=30).mean().values
        cyc = (
            self.valid
            & ~self.burn
            & (h2 > 0.15)
            & (h2 < 0.85)
            & np.isfinite(hp_s)
            & np.isfinite(hp_m)
            & (self.horizon > 30)
        )
        if cyc.sum() > 1000:
            print(
                f"furnace-cycling minutes={cyc.sum()} highpass sd measured={np.std(hp_m[cyc]) * 1.8:.3f}F simulated={np.std(hp_s[cyc]) * 1.8:.3f}F corr={np.corrcoef(hp_m[cyc], hp_s[cyc])[0, 1]:.3f}"
            )
        print(f"== {label}")
        print(rep.round(3).to_string(index=False))
        return rep


def main():
    t0 = time.time()
    m = Model()
    print(
        f"n={m.n} valid={m.valid.mean():.3f} train={m.train.sum()} test={m.testm.sum()} cold_starts={(m.reset == 2).sum()} H={H_FAST}/{H_SLOW} SUB={SUB}"
    )
    p0 = m.params(m.x0)
    m.report(p0, "initial guess")
    start = os.environ.get("FIT_START")
    x0 = m.x0
    if start and os.path.exists(start):
        prev = json.load(open(start))
        x0 = np.clip(np.log([prev[k] for k in m.fit_names]), m.lo + 1e-6, m.hi - 1e-6)
    res = least_squares(
        m.residuals,
        x0,
        bounds=(m.lo, m.hi),
        loss="soft_l1",
        f_scale=2.0,
        x_scale=1.0,
        diff_step=1e-3,
        max_nfev=int(os.environ.get("FIT_NFEV", "60")),
        verbose=1,
    )
    p = m.params(res.x)
    rep = m.report(p, "fitted")
    # approximate parameter uncertainty from the Jacobian (log-space sd)
    J = res.jac
    try:
        cov = np.linalg.inv(J.T @ J) * (2 * res.cost / max(1, len(res.fun) - len(res.x)))
        sd = np.sqrt(np.diag(cov))
    except Exception:
        sd = np.full(len(res.x), np.nan)
    print("== parameters (value, log-sd, at-bound?)")
    for k, v, s, lo, hi in zip(m.fit_names, res.x, sd, m.lo, m.hi, strict=False):
        flag = "LO" if v - lo < 1e-3 else ("HI" if hi - v < 1e-3 else "")
        print(f"  {k:8s} {np.exp(v):12.5g}  sd_log={s:6.3f} {flag}")
    out = os.environ.get("FIT_OUT", os.path.join(HERE, "params.json"))
    json.dump(p, open(out, "w"), indent=1)
    rep.to_csv(out.replace(".json", "_report.csv"), index=False)
    print(f"cost={res.cost:.1f} nfev={res.nfev} status={res.status} secs={time.time() - t0:.1f} -> {out}")


if __name__ == "__main__":
    main()
