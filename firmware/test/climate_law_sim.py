#!/usr/bin/env python3
"""The closed-loop simulation in CI: the firmware's law is the simulated law (plan section 13, phase 3; #1671).

Builds the review's simulator (docs/reviews/control-review-2026-11-15/sim/closed_loop2.cpp) twice:

  reference  as committed, with the reference law band_edge_controller.h and the simulator's relay layer;
  port       the same source with the law replaced by firmware/lib/climate_law.h (climate_law::step) and the relay
             layer replaced by climate_law::relay_step.

and runs both over the weather year 2025-11-16 to 2026-11-15 for both house models (A and B, each with its winter
and summer parameters), at the default drying cost limit and its range, with one, three and no mister zones, and in
the degraded conditions (no outdoor data, no clock, a clock 117 minutes fast). The reference is given the generated
constants (verdify_schemas/climate_law.yaml) as its edge.* and dwell.* settings, so a changed constant is compared
like for like. Every output row of the port must equal the reference's, character for character.

It also runs the reference with its own defaults and compares the law's monthly rows with the published results
(docs/reviews/control-review-2026-11-15/results/plan_scenarios.csv): both in band within 0.5 point and relay starts
within 5 %. That ties this harness and its forcing file to the figures in the plan.

The forcing (firmware/test/data/climate_law_forcing.f32.xz) is the review's forcing.bin with the columns the
simulator reads for these runs, stored as float32 (lossless for every column: the source values are float32) and the
time column as a start and a 60 s step. The recorded relay columns, which only the replay mode reads, are zero.

Rulings G1 and G4 (2026-11-16) changed the firmware's relay layer after the plan's figures were made. G4 (the furnace
waits one minimum off time after any boot) is applied to the reference copy compared here as well (one line: the
furnace's last switch-off is set one step before the start). G1 (no minimum time at a protection limit) is not
transcribed: instead every compared run must stay strictly between the two limits, which the harness asserts, so the
rule never acts. The published-figures check uses the simulator exactly as committed.

Heavy: about 80 simulated years (3 to 6 minutes of one core). CI asks for it explicitly (ci/gha/validate.sh sets
CLIMATE_LAW_SIM=full for the validate-containment-firmware part and fails without the run's receipt); a workstation
`make ci` runs it with --quick.
Full-year runs also print per-fan runtime and imbalance for each firmware-port scenario.

Usage: python3 firmware/test/climate_law_sim.py (--full [--receipt PATH] | --quick)
"""

from __future__ import annotations

import argparse
import csv
import io
import lzma
import os
import struct
import subprocess
import sys
import tempfile
from array import array
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SIM = REPO / "docs" / "reviews" / "control-review-2026-11-15" / "sim"
RESULTS = REPO / "docs" / "reviews" / "control-review-2026-11-15" / "results" / "plan_scenarios.csv"
FORCING = REPO / "firmware" / "test" / "data" / "climate_law_forcing.f32.xz"
LIB = REPO / "firmware" / "lib"

sys.path.insert(0, str(REPO))
from verdify_schemas import climate_law_constants as K  # noqa: E402

YEAR_START, YEAR_END, SCORE_FROM = 1763251200, 1794700800, 1763337600  # 2025-11-16, 2026-11-15, 2025-11-17 UTC
SUMMER_MONTHS = {"05", "06", "07", "08", "09"}
SETS = {  # scenarios.py SETS: (params, moisture-source scale) by season
    "A": {"winter": ("params_W2.json", 0.95), "summer": ("params_W1.json", 1.0)},
    "B": {"winter": ("params_W2.json", 1.4), "summer": ("params_S1.json", 1.0)},
}
# Scenarios that do not change a compiled constant (the port compiles its constants; the reference takes them).
SCENARIOS = {
    "law": {},
    "law_e0": {"edge.e_max": 0},
    "law_e0.5": {"edge.e_max": 0.5},
    "law_e1.5": {"edge.e_max": 1.5},
    "law_mist0": {"edge.mist_zones": 0},
    "law_mist1": {"edge.mist_zones": 1},
    "law_no_outdoor": {"outdoor.ok": 0},
    "law_no_clock": {"clock.valid": 0},
    "law_clock_fast_117": {"clock.err_min": 117},
}
# The generated constants as the reference simulator's settings.
REFERENCE_CONSTANTS = {
    "edge.h1_on": K.HEAT1_ON_ABOVE_LOW_F,
    "edge.h1_off": K.HEAT1_OFF_ABOVE_LOW_F,
    "edge.h2_on": K.HEAT2_ON_ABOVE_LOW_F,
    "edge.h2_off": K.HEAT2_OFF_ABOVE_LOW_F,
    "edge.c_on": K.COOL_ON_ABOVE_HIGH_F,
    "edge.c_off": K.COOL_OFF_BELOW_HIGH_F,
    "edge.c2_on": K.FAN2_ON_ABOVE_HIGH_F,
    "edge.c2_off": K.FAN2_OFF_ABOVE_HIGH_F,
    "edge.w_on": K.FOG_ON_ABOVE_VPD_HIGH_KPA,
    "edge.w_off": K.FOG_OFF_BELOW_VPD_HIGH_KPA,
    "edge.m_on": K.MIST_ON_ABOVE_VPD_HIGH_KPA,
    "edge.m_off": K.MIST_OFF_ABOVE_VPD_HIGH_KPA,
    "edge.wet_tmin": K.WET_MIN_ABOVE_LOW_F,
    "edge.d_on": K.DRY_ON_ABOVE_VPD_LOW_KPA,
    "edge.d_off": K.DRY_OFF_ABOVE_VPD_LOW_KPA,
    "edge.dt_start_gas": K.DRY_START_ABOVE_LOW_F,
    "edge.dt_stop": K.DRY_STOP_ABOVE_LOW_F,
    "edge.dp_margin_f": K.DRY_DEWPOINT_START_MARGIN_F,
    "edge.dp_stop_f": K.DRY_DEWPOINT_STOP_MARGIN_F,
    "edge.e_max": K.DRY_COST_LIMIT_DEFAULT_KWH_PER_KG,
    "edge.safe_max": K.SAFETY_MAX_F,
    "edge.safe_min": K.SAFETY_MIN_F,
    "dwell.heat_on": K.HEAT_MIN_ON_S,
    "dwell.heat_off": K.HEAT_MIN_OFF_S,
    "dwell.fan_on": K.FAN_MIN_ON_S,
    "dwell.fan_off": K.FAN_MIN_OFF_S,
    "dwell.vent_on": K.VENT_MIN_ON_S,
    "dwell.vent_off": K.VENT_MIN_OFF_S,
    "dwell.fog_on": K.FOG_MIN_ON_S,
    "dwell.fog_off": K.FOG_MIN_OFF_S,
}

# band_edge_controller.h for the port build: the reference's structs, its controller renamed out of the way, and an
# EdgeController that runs climate_law::step with the drying cost limit the simulator passes.
SHIM = """#pragma once
#define EdgeController ReferenceEdgeController
#include "{reference}"
#undef EdgeController
#include "climate_law.h"

struct EdgeController {{
  EdgeConst k;
  climate_law::State st;
  climate_law::Output last;
  EdgeOut step(const EdgeIn& u, double) {{
    climate_law::Inputs in{{}};
    in.T = u.T; in.vpd = u.vpd; in.dp_f = u.dp_f;
    in.band = {{u.tlo, u.thi, u.vlo, u.vhi}};
    in.temp_valid = true; in.humidity_valid = true;
    in.out_ok = u.out_ok; in.out_T = u.out_T; in.out_dp_f = u.out_dp_f; in.w_in = u.w_in; in.w_out = u.w_out;
    in.dry_cost_limit = k.e_max;
    last = climate_law::step(st, in);
    EdgeOut q;
    q.heat1 = last.heat1; q.heat2 = last.heat2; q.vent = last.vent; q.fog = last.fog; q.mist = last.mist;
    q.fans = last.fans; q.cooling = last.cooling; q.drying = last.drying; q.dry_cost = last.dry_cost;
    return q;
  }}
}};
"""

RELAY_BEGIN = "          // ---- minimal relay layer:"
RELAY_END = "          R[R_FOG].set(now, e.fog, false, false);\n"
RELAY_PORT = """          // ---- the firmware's relay layer (climate_law::relay_step)
          static climate_law::RelayState LRS;
          const climate_law::RelayInputs lin{R[R_F1].on_s, R[R_F2].on_s, false, (uint32_t)std::lround(dt * 1000)};
          const climate_law::RelayStarts lst = climate_law::relay_step(LRS, E.last, lin);
          auto apply = [&](Relay& x, const climate_law::Relay& y, bool started) { if (started) ++x.starts; x.on = y.on; };
          apply(R[R_H1], LRS.heat1, lst.heat1); apply(R[R_H2], LRS.heat2, lst.heat2);
          apply(R[R_F1], LRS.fan1, lst.fan1); apply(R[R_F2], LRS.fan2, lst.fan2);
          apply(R[R_VENT], LRS.vent, lst.vent); apply(R[R_FOG], LRS.fog, lst.fog);
"""


def expand_forcing(dest: Path) -> None:
    raw = lzma.decompress(FORCING.read_bytes())
    magic, n, start, step, ncols = struct.unpack_from("<8sqqqq", raw)
    if magic != b"VFRC1\0\0\0" or ncols != 13:
        raise SystemExit("unexpected forcing file")
    if sys.byteorder != "little":
        raise SystemExit("the forcing file is little-endian")
    off = struct.calcsize("<8sqqqq")
    with dest.open("wb") as f:
        f.write(struct.pack("<qq", n, 24))
        array("d", (float(start + i * step) for i in range(n))).tofile(f)
        for c in range(ncols):
            col = array("f")
            col.frombytes(raw[off + c * n * 4 : off + (c + 1) * n * 4])
            array("d", col).tofile(f)
        zeros = array("d", bytes(8 * n))
        for _ in range(24 - 1 - ncols):
            zeros.tofile(f)


G4_ANCHOR = '  R[R_VENT].min_off = cfgd("dwell.vent_off", law_ctl ? LD.vent_off : 60);\n'
G4_LINE = "  if (law_ctl) R[R_H2].last_off = t_start - dt;   // ruling G4: the furnace waits one minimum off time after boot\n"


def with_g4(src: str) -> str:
    if src.count(G4_ANCHOR) != 1:
        raise SystemExit("G4 anchor not found in closed_loop2.cpp")
    return src.replace(G4_ANCHOR, G4_ANCHOR + G4_LINE)


def build(work: Path) -> tuple[Path, Path, Path]:
    """The simulator as committed (published), the reference with G4, and the port."""
    cxx = os.environ.get("CXX", "g++").split()
    flags = ["-std=c++17", "-O2", "-w"]
    published = work / "closed_loop2_published"
    subprocess.run(
        [*cxx, *flags, "-I", str(LIB), "-I", str(SIM), "-o", str(published), str(SIM / "closed_loop2.cpp")],
        check=True,
    )
    ref_dir = work / "ref"
    ref_dir.mkdir()
    (ref_dir / "closed_loop2.cpp").write_text(with_g4((SIM / "closed_loop2.cpp").read_text()))
    ref = work / "closed_loop2_ref"
    subprocess.run(
        [*cxx, *flags, "-I", str(LIB), "-I", str(SIM), "-o", str(ref), str(ref_dir / "closed_loop2.cpp")], check=True
    )
    port_dir = work / "port"
    port_dir.mkdir()
    src = with_g4((SIM / "closed_loop2.cpp").read_text())
    a, b = src.index(RELAY_BEGIN), src.index(RELAY_END)
    src = src[:a] + RELAY_PORT + src[b + len(RELAY_END) :]
    (port_dir / "closed_loop2.cpp").write_text(src)
    (port_dir / "physics.h").write_text((SIM / "physics.h").read_text())
    (port_dir / "band_edge_controller.h").write_text(SHIM.format(reference=SIM / "band_edge_controller.h"))
    port = work / "closed_loop2_port"
    subprocess.run([*cxx, *flags, "-I", str(LIB), "-o", str(port), str(port_dir / "closed_loop2.cpp")], check=True)
    return published, ref, port


def run(
    binary: Path,
    forcing: Path,
    name: str,
    params: str,
    canopy: float,
    span: tuple[int, int, int],
    kv: dict,
    trace: Path | None = None,
    *,
    precise_fan_runtime: bool = False,
) -> str:
    start, end, score_from = span
    args = [
        str(binary),
        f"forcing={forcing}",
        f"params={SIM / params}",
        "controller=edge",
        f"name={name}",
        f"start={start}",
        f"end={end}",
        f"score_from={score_from}",
        f"canopy={canopy}",
        "dryout_from=0",
    ]
    args += [f"{k}={v}" for k, v in kv.items()]
    if precise_fan_runtime:
        args.append("precise_fan_runtime=true")
    if trace is not None:
        args.append(f"trace={trace}")
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def summary_problems(text: str) -> list[str]:
    """An output that could match vacuously, or a run that reached a protection limit (G1 untranscribed)."""
    rows = list(csv.DictReader(io.StringIO(text)))
    months = [r for r in rows if r["period"] != "ALL"]
    problems = []
    if not months or not any(r["period"] == "ALL" for r in rows):
        problems.append(f"short output: {len(rows)} rows")
    for r in rows:
        if not (K.SAFETY_MIN_F < float(r["temp_min_f"]) and float(r["temp_max_f"]) < K.SAFETY_MAX_F):
            problems.append(f"reached a protection limit in {r['period']}: {r['temp_min_f']} to {r['temp_max_f']} F")
    return problems


def fan_runtime_report(summary: str, name: str, set_name: str, season: str) -> str:
    annual = next(row for row in csv.DictReader(io.StringIO(summary)) if row["period"] == "ALL")
    days = float(annual["days"])
    fan1_hours = float(annual["fan1_h_day"]) * days
    fan2_hours = float(annual["fan2_h_day"]) * days
    absolute_hours = abs(fan1_hours - fan2_hours)
    mean_hours = (fan1_hours + fan2_hours) / 2
    imbalance = f"{100 * absolute_hours / mean_hours:.3f}%" if mean_hours else "n/a (both fans idle)"
    return (
        f"fan runtime {name} set={set_name} parameters={season}: "
        f"fan1={fan1_hours:.3f} h, fan2={fan2_hours:.3f} h, absolute difference={absolute_hours:.3f} h, "
        f"difference / mean={imbalance}"
    )


def season_rows(text: str, season: str) -> list[dict]:
    rows = list(csv.DictReader(io.StringIO(text)))
    keep = []
    for r in rows:
        if r["period"] == "ALL":
            continue
        summer = r["period"][-2:] in SUMMER_MONTHS
        if summer == (season == "summer"):
            keep.append(r)
    return keep


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--full", action="store_true", help="the weather year and the published-figures check (CI)")
    mode.add_argument("--quick", action="store_true", help="two weeks of each season: a smoke check of the harness")
    ap.add_argument("--receipt", type=Path, help="with --full: write a receipt here when the full run passes")
    args = ap.parse_args()
    print(f"climate law closed-loop simulation: mode {'quick' if args.quick else 'full'}")
    winter_span = summer_span = (YEAR_START, YEAR_END, SCORE_FROM)
    if args.quick:
        winter_span = (YEAR_START, YEAR_START + 15 * 86400, SCORE_FROM)
        summer_span = (1781049600, 1781049600 + 15 * 86400, 1781049600 + 86400)  # 2026-06-10
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        forcing = work / "forcing.bin"
        expand_forcing(forcing)
        published, ref, port = build(work)
        # 1. port == reference, row for row
        compared = 0
        traced_minutes = 0
        for name, kv in SCENARIOS.items():
            for set_name, sdef in SETS.items():
                for season in ("winter", "summer"):
                    params, canopy = sdef[season]
                    span = winter_span if season == "winter" else summer_span
                    ref_kv = {**REFERENCE_CONSTANTS, **kv}
                    ta, tb = work / "trace_ref.csv", work / "trace_port.csv"
                    a = run(ref, forcing, name, params, canopy, span, ref_kv, ta, precise_fan_runtime=args.full)
                    b = run(port, forcing, name, params, canopy, span, ref_kv, tb, precise_fan_runtime=args.full)
                    compared += 1
                    problems = summary_problems(a)
                    trace_a, trace_b = ta.read_bytes(), tb.read_bytes()
                    if trace_a.count(b"\n") < 2:
                        problems.append("empty relay trace")
                    if trace_a != trace_b:
                        problems.append("per-minute relay trajectories differ")
                        for la, lb in zip(trace_a.splitlines(), trace_b.splitlines(), strict=False):
                            if la != lb:
                                problems.append(f"  ref : {la.decode()}\n  port: {lb.decode()}")
                                break
                    traced_minutes += trace_a.count(b"\n") - 1
                    if problems:
                        failures += 1
                        print(f"FAIL {name} {set_name} {season}:")
                        for p in problems:
                            print(f"  {p}")
                    if args.full and not problems:
                        print(fan_runtime_report(b, name, set_name, season))
                    if a != b:
                        failures += 1
                        print(f"FAIL port != reference: {name} {set_name} {season}")
                        for la, lb in zip(a.splitlines(), b.splitlines(), strict=False):
                            if la != lb:
                                print(f"  ref : {la}\n  port: {lb}")
                                break
        print(f"port vs reference: {compared} runs compared ({traced_minutes} relay-trace minutes), {failures} fail")
        # 2. the reference with its own defaults reproduces the published monthly figures of the law
        if not args.quick:
            published_rows = {}
            with RESULTS.open() as f:
                for r in csv.DictReader(f):
                    if r["scenario"] == "law" and r["period"][:2] == "20":
                        published_rows[(r["set"], r["period"])] = r
            checked = 0
            for set_name, sdef in SETS.items():
                for season in ("winter", "summer"):
                    params, canopy = sdef[season]
                    out = run(published, forcing, "law", params, canopy, winter_span, {})
                    for r in season_rows(out, season):
                        p = published_rows.get((set_name, r["period"]))
                        if p is None:
                            continue
                        checked += 1
                        d_both = abs(float(r["both_in_pct"]) - float(p["both_in_pct"]))
                        s_ref = float(p["starts_day"])
                        d_starts = abs(float(r["starts_day"]) - s_ref) / max(s_ref, 1e-9)
                        if d_both > 0.5 or d_starts > 0.05:
                            failures += 1
                            print(
                                f"FAIL published {set_name} {r['period']}: both {r['both_in_pct']} vs "
                                f"{p['both_in_pct']}, starts {r['starts_day']} vs {p['starts_day']}"
                            )
            print(f"reference vs published monthly law rows: {checked} months checked")
            if checked < 24:
                failures += 1
                print("FAIL: too few published months matched")
    print("climate law closed-loop simulation:", "FAIL" if failures else "PASS")
    if args.full and args.receipt and not failures:
        args.receipt.write_text(f"mode=full runs={compared} months_checked={checked}\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
