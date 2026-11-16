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
        "docs/notes/read-by-a-test.md": "# Read\n",
        "tests/test_reader.py": 'PATH = "docs/notes/read-by-a-test.md"\n',
        "docs/planner/playbook.md": "# Playbook\n",
        "docs/design/dashboard/openapi/notes.md": "# API\n",
        "research/planner-efficacy/notes.md": "# Protocol\n",
        "research/notes.md": "# Research\n",
        "planning/notes.md": "# Plan\n",
        "README.md": "# Repo\n",
        "cortex_planner/static/system.md": "# Prompt\n",
        "firmware/DESIGN.md": "# Design\n",
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

    def change(edits: dict[str, object], push: bool = False) -> dict:
        """Apply edits on base and classify: str writes, None deletes,
        ("symlink", target) replaces with a link, "+x" sets the executable bit."""
        git(tmp_path, "checkout", "-q", base)
        for name, edit in edits.items():
            path = tmp_path / name
            path.parent.mkdir(parents=True, exist_ok=True)
            if edit is None:
                path.unlink()
            elif edit == "+x":
                path.chmod(0o755)
            elif isinstance(edit, tuple):
                path.unlink(missing_ok=True)
                path.symlink_to(edit[1])
            else:
                path.write_text(edit)
        git(tmp_path, "add", "-A")
        git(tmp_path, "commit", "-qm", "change")
        head = git(tmp_path, "rev-parse", "HEAD")
        return (IMPACT.classify_push if push else IMPACT.classify)(tmp_path, base, head)

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
    assert repo({"docs/notes/read-by-a-test.md": "# Changed\n"})["light"] == "none"


@pytest.mark.parametrize(
    "path",
    ["README.md", "planning/notes.md", "research/notes.md", "docs/notes/new.md", "planning/new/deep.md"],
)
def test_documentation_roots_and_top_level_markdown_are_the_docs_class(repo, path):
    assert repo({path: "# Changed\n"})["light"] == "docs"


@pytest.mark.parametrize(
    "path",
    [
        "cortex_planner/static/system.md",  # an LLM prompt the planner loads
        "firmware/DESIGN.md",  # firmware Markdown a drift test scans
        "docs/planner/playbook.md",  # the Iris playbook and site-content playbook root
        "docs/design/dashboard/openapi/notes.md",
        "research/planner-efficacy/notes.md",
        "dashboard/NOTES.md",
        "deploy/k8s/NOTES.md",
        "site/docs/page.md",
    ],
)
def test_markdown_outside_the_documentation_roots_runs_everything(repo, path):
    assert repo({path: "# Changed\n" * 500})["light"] == "none"


def test_a_symlinked_or_executable_markdown_file_runs_everything(repo):
    assert repo({"docs/notes/link.md": ("symlink", "../../README.md")})["light"] == "none"
    assert repo({"docs/notes/free.md": "+x"})["light"] == "none"


def test_deleting_documentation_is_the_docs_class(repo):
    assert repo({"docs/notes/free.md": None})["light"] == "docs"


@pytest.mark.parametrize(
    "edit",
    [
        None,  # deleted
        ("symlink", "release-pins.yaml"),
        "+x",  # mode only
        KUSTOMIZATION.replace("images:", "transformers:\n# - release-pins.yaml\nimages:"),
    ],
)
def test_a_pin_file_deleted_linked_mode_changed_or_reshaped_runs_everything(repo, edit):
    assert repo({"deploy/k8s/overlays/prod/kustomization.yaml": edit})["light"] == "none"


def test_an_added_pin_file_runs_everything(tmp_path):
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.email", "ci")
    git(tmp_path, "config", "user.name", "ci")
    (tmp_path / "README.md").write_text("# Repo\n")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "base")
    base = git(tmp_path, "rev-parse", "HEAD")
    pins = tmp_path / "deploy/k8s/overlays/prod/release-pins.yaml"
    pins.parent.mkdir(parents=True)
    pins.write_text(RELEASE_PINS)
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "add")
    assert IMPACT.classify(tmp_path, base, git(tmp_path, "rev-parse", "HEAD"))["light"] == "none"


def test_main_push_classifies_a_pin_merge_as_skip_and_pins(repo):
    result = repo({"deploy/k8s/overlays/prod/kustomization.yaml": KUSTOMIZATION.replace(D1, D2)}, push=True)
    assert (result["mode"], result["light"]) == ("skip", "pins")
    result = repo({"docs/notes/free.md": "# Changed\n"}, push=True)
    assert (result["mode"], result["light"]) == ("validate", "docs")


def test_an_unknown_base_falls_back_to_the_full_run(repo, tmp_path):
    head = git(tmp_path, "rev-parse", "HEAD")
    result = IMPACT.classify(tmp_path, "f" * 40, head)
    assert result["light"] == "none" and "fallback" in result


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


@pytest.mark.parametrize(
    ("render", "code"),
    [
        ("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: a\n", 0),
        ("apiVersion: v1\nkind: ConfigMap\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: b\n", 1),
    ],
)
def test_the_pins_part_fails_on_a_rendered_secret(render, code):
    result = subprocess.run(["bash", str(GHA / "assert-no-secret.sh")], input=render, capture_output=True, text=True)
    assert result.returncode == code, result.stdout + result.stderr


def test_pins_check_uses_the_secret_guard_and_the_non_zero_digest_tests():
    text = (GHA / "pins-check.sh").read_text()
    assert "assert-no-secret.sh" in text
    assert "tests/test_prod_release_pins.py" in text
    assert "tests/test_experiment_v2_orchestrator_manifests.py" in text


@pytest.mark.parametrize(("covers", "code"), [(True, 0), (False, 1)])
def test_campaign_shard_refuses_a_tool_whose_selection_lacks_dashboard_db_files(tmp_path, covers, code):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_dashboard_db_a.py").write_text("")
    selected = '["tests/test_dashboard_db_a.py"]' if covers else '["tests/test_other.py"]'
    tool = tmp_path / "tool.py"
    tool.write_text(f"def selection(select=None):\n    return {selected}, []\n\ndef main():\n    return 0\n")
    result = subprocess.run(
        [sys.executable, str(GHA / "campaign_shard.py"), str(tool)], cwd=tmp_path, capture_output=True, text=True
    )
    assert result.returncode == code, result.stdout + result.stderr
