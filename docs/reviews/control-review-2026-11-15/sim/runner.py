"""Thin wrapper around ./closed_loop: run a scenario, return its metric rows as a DataFrame."""

import io
import os
import subprocess

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))


def ep(s):
    return int(pd.Timestamp(s, tz="UTC").timestamp())


def run(name, controller="fw", params="params_M1.json", start=None, end=None, score_from=None, trace=None, **kv):
    args = [
        os.path.join(HERE, kv.pop("binary", "closed_loop")),
        f"forcing={HERE}/forcing.bin",
        f"params={HERE}/{params}",
        f"controller={controller}",
        f"name={name}",
    ]
    if start:
        args.append(f"start={ep(start)}")
    if end:
        args.append(f"end={ep(end)}")
    if score_from:
        args.append(f"score_from={ep(score_from)}")
    if trace:
        args.append(f"trace={trace}")
    if "params_summer" in kv:
        kv["params_summer"] = f"{HERE}/{kv['params_summer']}"
    for k, v in kv.items():
        args.append(f"{k.replace('__', '.')}={v}")
    out = subprocess.run(args, capture_output=True, text=True, check=True).stdout
    df = pd.read_csv(io.StringIO(out))
    df["params"] = params.replace("params_", "").replace(".json", "")
    return df
