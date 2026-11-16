"""CI light paths (CI audit 2026-11-16): docs-only and pin-only changes run a narrow
check set, and every required context still reports.

The classifier (ci/gha/verdify_path_impact.py) runs on a throwaway git repository;
the workflow shape is read from .github/workflows/ci.yml. Nothing here runs CI.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
GHA = ROOT / "ci" / "gha"
spec = importlib.util.spec_from_file_location("verdify_path_impact_light", GHA / "verdify_path_impact.py")
IMPACT = importlib.util.module_from_spec(spec)
spec.loader.exec_module(IMPACT)

# The main branch rule's required contexts (docs/ci/ci-contexts.md).
REQUIRED = {
    "ci / trusted-precheck",
    "ci / path-impact",
    "ci / validate",
    "ci / dashboard",
    "ci / campaign",
    "ci / lint",
    "ci / platform-static",
    "ci / platform-tests",
    "ci / firmware-logic",
    "ci / firmware-secretless-compile",
    "ci / campaign-qualification",
    "ci / buildcheck",
}
D1, D2 = "sha256:" + "1" * 64, "sha256:" + "2" * 64
KUSTOMIZATION = f"""# pins
images:
  - name: ghcr.io/verdifyconsultancy/verdify-api
    newName: registry.vallery.net/verdifyconsultancy/verdify-api
    digest: {D1}
"""
RELEASE_PINS = f"""# Release 1
kind: ImageTagTransformer
imageTag:
  name: registry.vallery.net/verdifyconsultancy/verdify-api
  digest: {D1}
"""


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path):
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.email", "ci")
    git(tmp_path, "config", "user.name", "ci")
    files = {
        "deploy/k8s/overlays/prod/kustomization.yaml": KUSTOMIZATION,
        "deploy/k8s/overlays/prod/release-pins.yaml": RELEASE_PINS,
        "deploy/k8s/dashboard/kustomization.yaml": KUSTOMIZATION,
        "docs/notes/free.md": "# Free\n",
        "docs/planner/read-by-a-test.md": "# Read\n",
        "tests/test_reader.py": 'PATH = "docs/planner/read-by-a-test.md"\n',
        "firmware/lib/logic.h": "int x;\n",
        "api/main.py": "x = 1\n",
        ".dockerignore": "\n",
    }
    for name, text in files.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(text)
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "base")
    base = git(tmp_path, "rev-parse", "HEAD")

    def change(edits: dict[str, str]) -> dict:
        git(tmp_path, "checkout", "-q", base)
        for name, text in edits.items():
            (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
            (tmp_path / name).write_text(text)
        git(tmp_path, "add", "-A")
        git(tmp_path, "commit", "-qm", "change")
        head = git(tmp_path, "rev-parse", "HEAD")
        return IMPACT.classify(tmp_path, base, head)

    return change


def test_digest_and_comment_changes_of_pin_files_are_the_pins_class(repo):
    result = repo(
        {
            "deploy/k8s/overlays/prod/kustomization.yaml": KUSTOMIZATION.replace(D1, D2),
            "deploy/k8s/overlays/prod/release-pins.yaml": RELEASE_PINS.replace(D1, D2).replace(
                "# Release 1", "# Release 2"
            ),
            "deploy/k8s/dashboard/kustomization.yaml": KUSTOMIZATION.replace(D1, D2),
        }
    )
    assert result["light"] == "pins"
    assert result["checks"]["firmware-check"] is False


@pytest.mark.parametrize(
    "edit",
    [
        KUSTOMIZATION.replace(D1, D2).replace("verdify-api\n    newName", "verdify-mcp\n    newName"),
        KUSTOMIZATION.replace(D1, "sha256:" + "3" * 63),
        KUSTOMIZATION + "  - name: extra\n",
    ],
)
def test_any_non_digest_change_of_a_pin_file_runs_everything(repo, edit):
    assert repo({"deploy/k8s/overlays/prod/kustomization.yaml": edit})["light"] == "none"


def test_a_pin_change_with_any_other_path_runs_everything(repo):
    result = repo(
        {"deploy/k8s/overlays/prod/kustomization.yaml": KUSTOMIZATION.replace(D1, D2), "docs/notes/free.md": "# x\n"}
    )
    assert result["light"] == "none"


def test_unreferenced_markdown_is_the_docs_class(repo):
    assert repo({"docs/notes/free.md": "# Changed\n", "docs/notes/new.md": "# New\n"})["light"] == "docs"


def test_markdown_a_test_reads_runs_everything(repo):
    assert repo({"docs/planner/read-by-a-test.md": "# Changed\n"})["light"] == "none"


@pytest.mark.parametrize("path", ["api/main.py", "docs/notes/free.yaml", "README"])
def test_code_or_non_markdown_runs_everything(repo, path):
    assert repo({path: "changed\n"})["light"] == "none"


def test_firmware_check_follows_the_firmware_tree_and_ci_plumbing(repo):
    assert repo({"firmware/lib/logic.h": "int y;\n"})["checks"]["firmware-check"] is True
    assert repo({"ci/gha/anything.sh": "#\n"})["checks"]["firmware-check"] is True
    assert repo({"api/main.py": "x = 2\n"})["checks"]["firmware-check"] is False


def test_missing_base_falls_back_to_the_full_run(tmp_path):
    git(tmp_path, "init", "-q")
    git(
        tmp_path,
        "-c",
        "user.email=ci",
        "-c",
        "user.name=ci",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "x",
    )
    result = IMPACT.classify(tmp_path, "", git(tmp_path, "rev-parse", "HEAD"))
    assert result["light"] == "none"
    assert result["checks"]["firmware-check"] is True


@pytest.mark.parametrize(
    ("light", "parts", "full"),
    [("none", IMPACT.FULL_VALIDATE_PARTS, "true"), ("pins", ["pins"], "false"), ("docs", [], "false")],
)
def test_outputs_select_the_validate_parts(tmp_path, monkeypatch, light, parts, full):
    receipt = {"mode": "validate", "profiles": [], "checks": dict.fromkeys(IMPACT.CHECKS, False), "light": light}
    monkeypatch.setattr(IMPACT, "classify", lambda *a: receipt)
    out = tmp_path / "out"
    monkeypatch.setattr(sys, "argv", ["x", "--root", ".", "--head", "a" * 40, "--output", str(out)])
    IMPACT.main()
    assert json.loads((out / "validate-parts").read_text()) == parts
    assert (out / "full").read_text() == full
    assert (out / "light").read_text() == light


def _workflow_jobs() -> dict:
    return yaml.safe_load((ROOT / ".github" / "workflows" / "ci.yml").read_text())["jobs"]


def _context(job: dict) -> str | None:
    if "uses" in job:
        return f"{job.get('name')} / {(job.get('with') or {}).get('name')}"
    return job.get("name")


def test_every_required_context_comes_from_a_job_that_always_reports():
    """A skipped reusable caller reports no "ci / <check>" context and blocks the merge."""
    produced = {}
    for job_id, job in _workflow_jobs().items():
        context = _context(job)
        if context in REQUIRED:
            produced[context] = job_id
            assert job.get("if") in (None, "${{ !cancelled() }}"), f"{job_id} must not be skipped by an if:"
            assert "matrix" not in (job.get("strategy") or {}), f"{job_id}: a matrix context is per shard"
    # "ci / lint" is the estate-ci lint workflow's own context (job workflow-lint).
    assert set(produced) == REQUIRED - {"ci / lint"}
    assert "if" not in _workflow_jobs()["workflow-lint"]


def test_skippable_jobs_are_shards_whose_aggregates_check_path_impact():
    jobs = _workflow_jobs()
    for job_id, job in jobs.items():
        condition = str(job.get("if") or "")
        if "path-impact.outputs" not in condition:
            continue
        assert _context(job) not in REQUIRED, job_id
        aggregates = [j for j in jobs.values() if job_id in (j.get("needs") or []) and _context(j) in REQUIRED]
        assert aggregates, f"{job_id} has no required aggregate"
        for aggregate in aggregates:
            run = aggregate["with"]["run"]
            assert "path-impact=${{ needs.path-impact.result }}" in run, run
            assert f"needs.{job_id}.result" in run, run


def test_campaign_aggregates_the_qualification_shards_instead_of_running_them_again():
    jobs = _workflow_jobs()
    assert "campaign-shard" not in jobs
    assert jobs["campaign"]["with"]["run"] == jobs["campaign-qualification"]["with"]["run"]


@pytest.mark.parametrize(
    ("args", "code"),
    [
        (["path-impact=success", "parts=success"], 0),
        (["path-impact=success", "parts=not-impacted"], 0),
        (["path-impact=failure", "parts=not-impacted"], 1),
        (["path-impact=success", "parts=skipped"], 1),
        (["path-impact=success", "parts=cancelled"], 1),
    ],
)
def test_require_success_passes_only_success_or_not_impacted(args, code):
    result = subprocess.run(["bash", str(GHA / "require-success.sh"), *args], capture_output=True, text=True)
    assert result.returncode == code, result.stdout + result.stderr


@pytest.mark.parametrize(("value", "code"), [("false", 0), ("maybe", 2)])
def test_registry_step_not_impacted_passes_before_any_work(tmp_path, value, code):
    result = subprocess.run(
        ["bash", str(GHA / "registry-step.sh"), "firmware-logic"],
        capture_output=True,
        text=True,
        env={"PATH": "/usr/bin:/bin", "VERDIFY_IMPACTED": value, "HOME": str(tmp_path)},
    )
    assert result.returncode == code, result.stdout + result.stderr
