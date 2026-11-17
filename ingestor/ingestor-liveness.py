#!/usr/bin/env python3
"""ingestor-liveness.py: process-health liveness probe for the single writer (#1748).

Exits 0 when both heartbeats (the event loop and the task supervisor, see
process_liveness.py) are newer than ``--max-age`` seconds, else 1. It reads no
database and no climate row: a silent controller or a database outage must not
restart the writer. Data freshness is a metric and an alert, not a liveness input
(``ingestor-healthz.py`` remains as a manual climate-age check).

    livenessProbe:
      exec:
        command: ["python", "ingestor-liveness.py"]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from process_liveness import LIVENESS_DIR, beat_ages

DEFAULT_MAX_AGE_S = 90.0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingestor process-health liveness probe")
    parser.add_argument("--max-age", type=float, default=DEFAULT_MAX_AGE_S)
    parser.add_argument("--dir", type=Path, default=LIVENESS_DIR)
    args = parser.parse_args(argv)
    ages = beat_ages(args.dir)
    stale = {name: age for name, age in ages.items() if age is None or age > args.max_age}
    if stale:
        detail = ", ".join(f"{name}={'missing' if age is None else f'{age:.0f}s'}" for name, age in stale.items())
        print(f"ingestor-liveness: STALE {detail} (limit {args.max_age:.0f}s)", file=sys.stderr)
        return 1
    print("ingestor-liveness: OK " + ", ".join(f"{name}={age:.0f}s" for name, age in ages.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
