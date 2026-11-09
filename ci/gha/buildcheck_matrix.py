#!/usr/bin/env python3
"""PR image build-check matrix (#1534): impacted profiles -> image-build inputs.

Reads a path-impact receipt (ci/gha/verdify_path_impact.py) and prints a compact
JSON list for `strategy.matrix.include` in ci.yml: one {image, dockerfile,
build-args} entry per impacted profile. IMAGES mirrors the image and build-args
of each build.yml job; it must name exactly the classifier's PROFILES with the
same Dockerfiles, or this script fails so the two cannot drift.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from verdify_path_impact import PROFILES

# profile -> (image, passes GIT_SHA like build.yml)
IMAGES = {
    "api": ("verdifyconsultancy/verdify-api", True),
    "mcp": ("verdifyconsultancy/verdify-mcp", True),
    "ingestor": ("verdifyconsultancy/verdify-ingestor", True),
    "migrate": ("verdifyconsultancy/verdify-migrate", False),
    "orchestrator": ("verdifyconsultancy/verdify-experiment-v2-orchestrator", True),
    "planner": ("verdifyconsultancy/verdify-planner", True),
    "setpoint-server": ("verdifyconsultancy/verdify-setpoint-server", False),
    "lab-publisher": ("verdifyconsultancy/verdify-lab-publisher-k3s", False),
    "dashboard-web": ("verdifyconsultancy/verdify-dashboard-web", True),
    "grafana-image-renderer": ("verdifyconsultancy/verdify-grafana-image-renderer", False),
    "hermes-agent": ("verdifyconsultancy/verdify-hermes-agent", False),
    "timescaledb": ("verdifyconsultancy/verdify-timescaledb", False),
    "esphome-ci": ("verdifyconsultancy/verdify-esphome-ci", False),
}


def matrix(receipt: dict, sha: str) -> list[dict]:
    if set(IMAGES) != set(PROFILES):
        raise SystemExit(f"buildcheck IMAGES and PROFILES differ: {sorted(set(IMAGES) ^ set(PROFILES))}")
    entries = []
    for name in receipt["profiles"]:
        image, git_sha = IMAGES[name]
        entries.append(
            {
                "profile": name,
                "image": image,
                "dockerfile": PROFILES[name],
                "build-args": f"GIT_SHA={sha}" if git_sha else "",
            }
        )
    return entries


def main() -> None:
    receipt = json.loads(Path(sys.argv[1]).read_text())
    print(json.dumps(matrix(receipt, receipt["source_revision"]), separators=(",", ":")))


if __name__ == "__main__":
    main()
