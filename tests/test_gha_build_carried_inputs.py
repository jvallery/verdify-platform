"""Carried inputs: a main push publishes no image for files an image copies but never runs.

The classifier (ci/gha/verdify_path_impact.py) runs on a throwaway git repository
that holds this repository's real Dockerfiles and .dockerignore, so the test
follows the real COPY lines. Two directions are checked: a documentation or test
merge selects no image, so build.yml opens no pin pull request; and a change to
anything an image runs still selects it. Nothing here builds an image.
"""

from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
GHA = ROOT / "ci" / "gha"
spec = importlib.util.spec_from_file_location("verdify_path_impact_carried", GHA / "verdify_path_impact.py")
IMPACT = importlib.util.module_from_spec(spec)
spec.loader.exec_module(IMPACT)

# One file per kind of input. The Dockerfiles and .dockerignore are the real ones.
SOURCES = {
    "ingestor/ingestor.py": "x = 1\n",
    "ingestor/requirements-image.txt": "asyncpg\n",
    "verdify_schemas/__init__.py": "x = 1\n",
    "verdify_schemas/tests/test_schema.py": "def test_x():\n    assert True\n",
    "scripts/populate-site-content.py": "x = 1\n",
    "scripts/embed-corpora.py": "x = 1\n",
    "scripts/other-tool.py": "x = 1\n",
    "config/ai.yaml": "models: {}\n",
    "docs/notes/guide.md": "# Guide\n",
    "docs/reviews/sim/model.cpp": "int x;\n",
    "docs/planner/greenhouse-playbook.md": "# Playbook\n",
    "tests/test_something.py": "def test_x():\n    assert True\n",
    "mcp/server.py": "x = 1\n",
    "api/main.py": "x = 1\n",
    "deploy/k8s/base/api-deployment.yaml": "kind: Deployment\n",
    "README.md": "# Repo\n",
}


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path):
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.email", "ci")
    git(tmp_path, "config", "user.name", "ci")
    files = dict(SOURCES)
    files[".dockerignore"] = (ROOT / ".dockerignore").read_text()
    for dockerfile in IMPACT.PROFILES.values():
        files[dockerfile] = (ROOT / dockerfile).read_text()
    for name, text in files.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(text)
    git(tmp_path, "add", "-A", "-f")
    git(tmp_path, "commit", "-qm", "base")
    base = git(tmp_path, "rev-parse", "HEAD")

    def change(paths: list[str], *, push: bool = True, include_carried: bool = False) -> dict:
        git(tmp_path, "checkout", "-q", base)
        for name in paths:
            path = tmp_path / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text((path.read_text() if path.exists() else "") + "# changed\n")
        git(tmp_path, "add", "-A", "-f")
        git(tmp_path, "commit", "-qm", "change")
        head = git(tmp_path, "rev-parse", "HEAD")
        if push:
            return IMPACT.classify_push(tmp_path, base, head, include_carried=include_carried)
        return IMPACT.classify(tmp_path, base, head)

    return change


@pytest.mark.parametrize(
    "paths",
    [
        ["docs/notes/guide.md"],
        ["docs/notes/new-page.md", "docs/reviews/sim/model.cpp"],
        ["tests/test_something.py"],
        ["verdify_schemas/tests/test_schema.py"],
        ["README.md", "deploy/k8s/base/api-deployment.yaml"],
        ["docs/notes/guide.md", "tests/test_something.py", "verdify_schemas/tests/test_schema.py"],
    ],
)
def test_a_documentation_or_test_merge_publishes_no_image(repo, paths):
    result = repo(paths)
    assert "fallback" not in result
    assert (result["mode"], result["profiles"]) == ("validate", [])


def test_the_receipt_names_the_images_that_held_carried_inputs(repo):
    result = repo(["docs/notes/guide.md", "verdify_schemas/tests/test_schema.py"])
    assert result["carried"]["ingestor"] == 2
    assert set(result["carried"]) >= {"api", "mcp", "ingestor", "setpoint-server", "lab-publisher"}


@pytest.mark.parametrize(
    "path",
    [
        "ingestor/ingestor.py",
        "ingestor/requirements-image.txt",
        "ingestor/Dockerfile",
        "verdify_schemas/__init__.py",
        "scripts/populate-site-content.py",
        "config/ai.yaml",
        "docs/planner/greenhouse-playbook.md",
    ],
)
def test_a_change_to_what_the_ingestor_runs_still_publishes_it(repo, path):
    result = repo([path])
    assert result["mode"] == "build"
    assert "ingestor" in result["profiles"]
    assert path in result["reasons"]["ingestor"]


def test_a_source_change_beside_documentation_publishes_and_lists_both(repo):
    result = repo(["ingestor/ingestor.py", "docs/notes/guide.md"])
    assert "ingestor" in result["profiles"]
    assert result["reasons"]["ingestor"] == ["docs/notes/guide.md", "ingestor/ingestor.py"]
    assert "carried" not in result or "ingestor" not in result["carried"]


def test_other_images_follow_their_own_inputs(repo):
    assert repo(["mcp/server.py"])["profiles"] == ["mcp", "lab-publisher"]
    assert repo(["scripts/other-tool.py"])["profiles"] == ["lab-publisher"]
    assert repo(["api/main.py"])["profiles"] == ["api"]


def test_the_pull_request_build_check_still_builds_on_carried_inputs(repo):
    result = repo(["docs/notes/guide.md"], push=False)
    assert result["profiles"] == ["ingestor"]
    result = repo(["verdify_schemas/tests/test_schema.py"], push=False)
    assert {"api", "mcp", "ingestor"} <= set(result["profiles"])


def test_a_manual_dispatch_publishes_carried_inputs(repo):
    result = repo(["docs/notes/guide.md"], include_carried=True)
    assert (result["mode"], result["profiles"]) == ("build", ["ingestor"])


def test_build_workflow_counts_carried_inputs_only_on_dispatch():
    workflow = (ROOT / ".github/workflows/build.yml").read_text()
    assert workflow.count("ci/gha/path-impact.sh --push --include-carried") == 1
    assert workflow.count("ci/gha/path-impact.sh --push\n") == 1
    assert '"${GITHUB_EVENT_NAME}" = workflow_dispatch' in workflow


def test_the_planner_playbook_is_not_a_carried_input():
    assert IMPACT.carried("docs/notes/guide.md")
    assert IMPACT.carried("verdify_schemas/tests/fixtures/vectors.json")
    assert not IMPACT.carried("docs/planner/greenhouse-playbook.md")
    assert not IMPACT.carried("verdify_schemas/setpoint.py")
    assert not IMPACT.carried("ingestor/docs/readme.md")
