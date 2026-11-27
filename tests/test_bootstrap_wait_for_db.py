"""The bootstrap hooks' wait-for-db must name a database user.

The migrate image runs as UID 1000, which has no passwd entry. Without -U,
pg_isready cannot resolve a user name and exits 3 ("no attempt") without
contacting the server, so the wait loop never succeeds and the PreSync hook
fails every full sync of verdify-prod-dark (seen 2026-11-27).
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
HOOKS = [
    "deploy/k8s/components/experiment-v2-credential-bootstrap/bootstrap-job.yaml",
    "deploy/k8s/components/runtime-role-boundary/bootstrap-job.yaml",
    "deploy/k8s/components/runtime-role-boundary/maintenance-bootstrap-job.yaml",
    "deploy/k8s/components/runtime-role-boundary/mcp-bootstrap-job.yaml",
    "deploy/k8s/components/runtime-role-boundary/six-workload-bootstrap-job.yaml",
]


@pytest.mark.parametrize("path", HOOKS)
def test_wait_for_db_names_a_user(path):
    docs = [d for d in yaml.safe_load_all((ROOT / path).read_text()) if d and d.get("kind") == "Job"]
    assert docs, path
    for job in docs:
        inits = job["spec"]["template"]["spec"].get("initContainers", [])
        wait = [c for c in inits if c["name"] == "wait-for-db"]
        assert len(wait) == 1, path
        script = " ".join(wait[0].get("command", []) + wait[0].get("args", []))
        lines = [ln for ln in script.splitlines() if "pg_isready" in ln]
        assert lines, path
        for line in lines:
            assert " -U " in line, f"{path}: pg_isready without -U: {line.strip()}"
