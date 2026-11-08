"""build.yml builds verdify-timescaledb but never auto-pins it (#1458).

Repinning verdify-db restarts the database, so its digest stays a hand-edited,
attended release step: the pin job must not depend on or reference the build.
"""

import importlib.util
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
HAND_PINNED = {
    "grafana-image-renderer": "verdify-grafana-image-renderer",
    "hermes-agent": "verdify-hermes-agent",
    "timescaledb": "verdify-timescaledb",
}


def _jobs():
    return yaml.safe_load((ROOT / ".github/workflows/build.yml").read_text())["jobs"]


def _profiles():
    spec = importlib.util.spec_from_file_location("verdify_path_impact", ROOT / "ci/gha/verdify_path_impact.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.PROFILES


def test_timescaledb_builds_on_path_impact_from_its_dockerfile():
    jobs = _jobs()
    job = jobs["timescaledb"]
    assert job["needs"] == ["impact"]
    assert job["if"] == "${{ needs.impact.outputs.timescaledb == 'true' }}"
    assert job["with"] == {
        "image": "verdifyconsultancy/verdify-timescaledb",
        "dockerfile": "db/Dockerfile.timescaledb",
        "push": True,
    }
    assert job["uses"] == jobs["hermes-agent"]["uses"]
    assert jobs["impact"]["outputs"]["timescaledb"] == "${{ steps.impact.outputs.timescaledb }}"
    assert _profiles()["timescaledb"] == "db/Dockerfile.timescaledb"


def test_hand_pinned_images_stay_out_of_the_pin_job():
    pin = _jobs()["pin"]
    for job, image in HAND_PINNED.items():
        assert job not in pin["needs"]
        assert image not in pin["with"]["pins"]
