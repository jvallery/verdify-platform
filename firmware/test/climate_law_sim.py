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
import json
import lzma
import math
import os
import struct
import subprocess
import sys
import tempfile
from array import array
from collections import defaultdict
from itertools import groupby, pairwise
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
# Full-year scaled-runtime outliers with opposite signed gaps (#1725).
FAN_TRACE_CASES = {("law", "B", "winter"), ("law_e0", "A", "summer")}
WEAR_WINDOW_S = 3600  # Qualification-only comparison horizon, not a release setting.
WEAR_REVIEW_PCT = 5.0


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
    for header in ("physics.h", "fan_wear_experiment.h"):
        (port_dir / header).write_text((SIM / header).read_text())
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
    fan_events: Path | None = None,
    fan_start_shadow: Path | None = None,
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
        # The simulator reads booleans as numbers through cfgb/cfgd.
        args.append("precise_fan_runtime=1")
    if trace is not None:
        args.append(f"trace={trace}")
    if fan_events is not None:
        args.append(f"fan_events={fan_events}")
    if fan_start_shadow is not None:
        args.append(f"fan_start_shadow={fan_start_shadow}")
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


def fan_trace_report(trace: Path, name: str, set_name: str, season: str) -> tuple[str, tuple[int, int]]:
    # The full runs use the simulator default of 5 s per tick. Its trace prints each fan's
    # minute duty to two decimals, enough to distinguish all 13 possible tick counts.
    ticks_per_minute = 12
    duty_ticks = {f"{ticks / ticks_per_minute:.2f}": ticks for ticks in range(ticks_per_minute + 1)}
    scored_minutes = both_positive_minutes = ambiguous_overlap_minutes = 0
    fan1_ticks = fan2_ticks = overlap_min_ticks = overlap_max_ticks = one_positive_gap_ticks = 0
    with trace.open(newline="") as source:
        for row in csv.DictReader(source):
            if row["scored"] == "0":
                continue
            if row["scored"] != "1":
                raise ValueError("unknown scored-minute value")
            fan1, fan2 = (duty_ticks[row[fan]] for fan in ("fan1", "fan2"))
            scored_minutes += 1
            fan1_ticks += fan1
            fan2_ticks += fan2
            if not (fan1 and fan2):
                one_positive_gap_ticks += fan1 - fan2
                continue
            both_positive_minutes += 1
            overlap_min = max(0, fan1 + fan2 - ticks_per_minute)
            overlap_max = min(fan1, fan2)
            overlap_min_ticks += overlap_min
            overlap_max_ticks += overlap_max
            ambiguous_overlap_minutes += overlap_min != overlap_max
    if not scored_minutes:
        raise ValueError("no scored minutes")

    def hours(ticks: int) -> str:
        return f"{ticks / (ticks_per_minute * 60):.3f}"

    gap_ticks = fan1_ticks - fan2_ticks
    report = (
        f"fan trace {name} set={set_name} parameters={season}: scored_minutes={scored_minutes}, "
        f"both_positive_minutes={both_positive_minutes}, ambiguous_overlap_minutes={ambiguous_overlap_minutes}, "
        f"fan1_total_h={hours(fan1_ticks)}, fan2_total_h={hours(fan2_ticks)}, "
        f"overlap_h=[{hours(overlap_min_ticks)},{hours(overlap_max_ticks)}], "
        f"fan1_only_h=[{hours(fan1_ticks - overlap_max_ticks)},{hours(fan1_ticks - overlap_min_ticks)}], "
        f"fan2_only_h=[{hours(fan2_ticks - overlap_max_ticks)},{hours(fan2_ticks - overlap_min_ticks)}], "
        f"fan1_minus_fan2_h={hours(gap_ticks)}, one_fan_positive_minute_gap_h={hours(one_positive_gap_ticks)}, "
        f"both_fans_positive_minute_gap_h={hours(gap_ticks - one_positive_gap_ticks)}; "
        "minute totals alone do not identify episode order, escalation, or handoffs"
    )
    return report, (fan1_ticks * 5, fan2_ticks * 5)


def fan_event_report(events: Path, expected_fan_seconds: tuple[int, int], scenario: str) -> list[str]:
    def segments(source):
        rows = ((int(row["epoch_s"]), int(row["state"]), int(row["scored"])) for row in csv.DictReader(source))
        end = None
        for start, end in pairwise(rows):
            elapsed = end[0] - start[0]
            if start[1] not in (0, 1, 2, 3) or start[2] not in (0, 1) or elapsed <= 0 or elapsed % 5:
                raise ValueError("invalid fan event segment")
            yield start[1], bool(start[2]), elapsed, end[1] == -1
        if end is None or end[1:] != (-1, 0):
            raise ValueError("missing fan event end marker")

    counts = defaultdict(int)
    totals = defaultdict(lambda: [0, 0, 0])
    with events.open(newline="") as source:
        for active, episode in groupby(segments(source), key=lambda segment: segment[0] != 0):
            if not active:
                continue
            scored_seconds = [0, 0, 0]
            first = seen = 0
            paired = incomplete = unscored = False
            for state, scored, elapsed, terminal in episode:
                first = first or state
                seen |= state
                paired |= state == 3
                incomplete |= terminal
                unscored |= not scored
                if scored:
                    scored_seconds[state - 1] += elapsed
            if not sum(scored_seconds):
                continue
            if paired:
                kind = "paired-start" if first == 3 else "later-overlap"
            else:
                kind = "both-without-overlap" if seen == 3 else "solo"
            key = (kind, "partial" if incomplete or unscored else "fully-scored")
            counts[key] += 1
            for index, seconds in enumerate(scored_seconds):
                totals[key][index] += seconds

    exclusive1 = sum(row[0] for row in totals.values())
    exclusive2 = sum(row[1] for row in totals.values())
    shared = sum(row[2] for row in totals.values())
    if (exclusive1 + shared, exclusive2 + shared) != expected_fan_seconds:
        raise ValueError("fan-event totals do not reconcile to scored minute duties")
    return [
        f"fan episodes {scenario} type={kind} window={window}: count={counts[kind, window]}, "
        f"fan1_only_s={fan1}, fan2_only_s={fan2}, both_on_s={both}, fan1_minus_fan2_s={fan1 - fan2}"
        for (kind, window), (fan1, fan2, both) in sorted(totals.items())
    ]


def wear_qualification_case(
    scenario: str,
    baseline: str,
    alternative: str,
    baseline_paths: tuple[Path, Path],
    alternative_paths: tuple[Path, Path],
) -> dict:
    def collect(summary: str, paths: tuple[Path, Path]) -> dict:
        trace, events = paths
        _, seconds = fan_trace_report(trace, scenario, "-", "-")
        total = sum(seconds)
        if not total:
            raise ValueError("both fans idle in the scored window")
        rows = {row["period"]: row for row in csv.DictReader(io.StringIO(summary))}
        annual = rows.pop("ALL")
        metrics = (
            "fan1_starts_day",
            "fan2_starts_day",
            "starts_day",
            "both_in_pct",
            "temp_min_f",
            "temp_max_f",
            "kwh_day",
            "dry_kwh_day",
            "therms_day",
            "gal_day",
        )
        annual_metrics = {key: float(annual[key]) for key in metrics}
        monthly = {month: (float(row["starts_day"]), float(row["both_in_pct"])) for month, row in rows.items()}
        if not monthly or not all(
            math.isfinite(value) for value in (*annual_metrics.values(), *(n for row in monthly.values() for n in row))
        ):
            raise ValueError("missing or non-finite qualification metrics")
        return {
            **annual_metrics,
            "fan_seconds": seconds,
            "fan1_minus_fan2_seconds": seconds[0] - seconds[1],
            "wear_gap_pct": 200 * abs(seconds[0] - seconds[1]) / total,
            "episode_rows": fan_event_report(events, seconds, scenario),
            "monthly": monthly,
        }

    strict = collect(baseline, baseline_paths)
    rolling = collect(alternative, alternative_paths)
    strict_months = strict.pop("monthly")
    rolling_months = rolling.pop("monthly")
    if strict_months.keys() != rolling_months.keys():
        raise ValueError("qualification month coverage differs")
    max_starts_delta_pct = 100 * max(
        abs(rolling_months[m][0] - starts) / max(starts, 1e-9) for m, (starts, _) in strict_months.items()
    )
    max_in_band_delta_points = max(abs(rolling_months[m][1] - both) for m, (_, both) in strict_months.items())
    protection_problems = summary_problems(alternative)
    checks = {
        "wear_at_or_below_review_pct": rolling["wear_gap_pct"] <= WEAR_REVIEW_PCT,
        "wear_improved": rolling["wear_gap_pct"] < strict["wear_gap_pct"],
        "starts_within_5_percent_of_strict": max_starts_delta_pct <= 5 + 1e-9,
        "both_in_band_within_0_5_points_of_strict": max_in_band_delta_points <= 0.5 + 1e-9,
        "protection_limits_not_reached": not protection_problems,
    }
    return {
        "scenario": scenario,
        "strict": strict,
        "rolling": rolling,
        "months_compared": len(strict_months),
        "max_monthly_starts_delta_pct": max_starts_delta_pct,
        "max_monthly_both_in_band_delta_points": max_in_band_delta_points,
        "protection_problems": protection_problems,
        "checks": checks,
    }


def read_fan_start_shadow(path: Path) -> dict:
    rows = []
    seen = set()
    with path.open(newline="") as source:
        for row in csv.DictReader(source):
            credit = row.pop("credit")
            entry = {column: int(value) for column, value in row.items()}
            key = (credit, *(value for column, value in entry.items() if column != "count"))
            if (
                credit not in {"expired", "never-observed", "tied", "favors-fan1", "favors-fan2"}
                or entry["request_fans"] not in (1, 2)
                or entry["due_fan"] not in (1, 2)
                or entry["actual_lead"] not in (1, 2)
                or entry["ready_mask"] not in (1, 2, 3)
                or entry["first_on_mask"] not in (1, 2, 3)
                or entry["first_on_mask"] & entry["ready_mask"] != entry["first_on_mask"]
                or not entry["first_on_mask"] & entry["actual_lead"]
                or entry["scored"] not in (0, 1)
                or entry["count"] <= 0
                or key in seen
            ):
                raise ValueError("invalid or duplicate shadow onset row")
            seen.add(key)
            rows.append({**entry, "credit": credit})
    if not rows:
        raise ValueError("no shadow onset rows")
    return {
        "mode": "fan-start-shadow",
        "scenario": "law_e0/A/summer",
        "window_s": WEAR_WINDOW_S,
        "scored_onsets": sum(row["count"] for row in rows if row["scored"]),
        "onsets": rows,
    }


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
    research = ap.add_mutually_exclusive_group()
    research.add_argument("--wear-receipt", type=Path, help="with --full: run the two #1725 research comparisons")
    research.add_argument("--wear-shadow-receipt", type=Path, help="with --full: observe strict law_e0/A/summer")
    args = ap.parse_args()
    if (args.wear_receipt or args.wear_shadow_receipt) and not args.full:
        ap.error("wear research requires --full")
    print(f"climate law closed-loop simulation: mode {'quick' if args.quick else 'full'}")
    winter_span = summer_span = (YEAR_START, YEAR_END, SCORE_FROM)
    if args.quick:
        winter_span = (YEAR_START, YEAR_START + 15 * 86400, SCORE_FROM)
        summer_span = (1781049600, 1781049600 + 15 * 86400, 1781049600 + 86400)  # 2026-06-10
    failures = 0
    wear_cases = []
    shadow_receipt = None
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
                    events = (
                        work / "fan_events.csv" if args.full and (name, set_name, season) in FAN_TRACE_CASES else None
                    )
                    strict_events = work / "fan_events_strict.csv" if events is not None and args.wear_receipt else None
                    shadow = (
                        work / "fan_start_shadow.csv"
                        if args.wear_shadow_receipt and (name, set_name, season) == ("law_e0", "A", "summer")
                        else None
                    )
                    a = run(
                        ref,
                        forcing,
                        name,
                        params,
                        canopy,
                        span,
                        ref_kv,
                        ta,
                        precise_fan_runtime=args.full,
                        fan_events=strict_events,
                        fan_start_shadow=shadow,
                    )
                    b = run(
                        port,
                        forcing,
                        name,
                        params,
                        canopy,
                        span,
                        ref_kv,
                        tb,
                        precise_fan_runtime=args.full,
                        fan_events=events,
                    )
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
                        if events is not None:
                            scenario = f"{name} set={set_name} parameters={season}"
                            try:
                                report, fan_seconds = fan_trace_report(tb, name, set_name, season)
                                print(report)
                                for row in fan_event_report(events, fan_seconds, scenario):
                                    print(row)
                            except (KeyError, OSError, ValueError) as exc:
                                print(f"fan diagnostics {scenario}: unavailable ({exc})")
                    if shadow is not None and not problems and a == b:
                        shadow_receipt = read_fan_start_shadow(shadow)
                    if strict_events is not None and not problems and a == b:
                        alt_trace, alt_events = work / "trace_rolling.csv", work / "fan_events_rolling.csv"
                        scenario = f"{name}/{set_name}/{season}"
                        try:
                            alt = run(
                                ref,
                                forcing,
                                name,
                                params,
                                canopy,
                                span,
                                {**ref_kv, "edge.fan_wear_window_s": WEAR_WINDOW_S},
                                alt_trace,
                                precise_fan_runtime=True,
                                fan_events=alt_events,
                            )
                            wear_cases.append(
                                wear_qualification_case(
                                    scenario,
                                    a,
                                    alt,
                                    (ta, strict_events),
                                    (alt_trace, alt_events),
                                )
                            )
                        except (KeyError, OSError, ValueError, subprocess.CalledProcessError) as exc:
                            print(f"fan wear qualification {scenario}: unavailable ({exc})")
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
    if args.wear_shadow_receipt and not failures:
        if shadow_receipt is None:
            print("fan wear shadow: no qualified strict scenario")
            return 1
        args.wear_shadow_receipt.write_text(json.dumps(shadow_receipt) + "\n")
    if args.wear_receipt:
        if len(wear_cases) != len(FAN_TRACE_CASES):
            print(f"fan wear qualification: incomplete ({len(wear_cases)}/{len(FAN_TRACE_CASES)} cases)")
            return 1
        qualified = all(all(case["checks"].values()) for case in wear_cases)
        args.wear_receipt.write_text(
            json.dumps(
                {
                    "mode": "fan-wear-research",
                    "status": "within-comparison-bounds" if qualified else "outside-comparison-bounds",
                    "baseline_ci_pass": not failures,
                    "window_s": WEAR_WINDOW_S,
                    "wear_review_pct": WEAR_REVIEW_PCT,
                    "cases": wear_cases,
                },
                allow_nan=False,
            )
            + "\n"
        )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
