"""verdify-platform#1547 crit 4: verdify-db probe window and timeouts."""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
STS = ROOT / "deploy/k8s/base/db-statefulset.yaml"


def _postgres() -> dict:
    docs = [d for d in yaml.safe_load_all(STS.read_text()) if d]
    sts = next(d for d in docs if d["kind"] == "StatefulSet" and d["metadata"]["name"] == "verdify-db")
    return next(c for c in sts["spec"]["template"]["spec"]["containers"] if c["name"] == "postgres")


def test_startup_probe_window_is_at_least_30_minutes():
    probe = _postgres()["startupProbe"]
    assert probe["exec"]["command"][0] == "pg_isready"
    assert probe["periodSeconds"] * probe["failureThreshold"] >= 1800
    assert probe["timeoutSeconds"] >= 5


def test_liveness_and_readiness_timeouts_are_at_least_5s():
    container = _postgres()
    for name in ("livenessProbe", "readinessProbe"):
        assert container[name]["exec"]["command"][0] == "pg_isready"
        assert container[name]["timeoutSeconds"] >= 5
