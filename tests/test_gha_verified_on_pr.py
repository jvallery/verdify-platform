"""CI audit C1 (#1716): a push to main skips the full suite only when the exact tree passed as a PR.

ci/gha/verified_on_pr.py reads the GitHub API; these tests give it a fake API, so they
need no network. Any mismatch, missing run or API error must mean "run the full suite".
"""

from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("verified_on_pr", ROOT / "ci" / "gha" / "verified_on_pr.py")
VERIFIED = importlib.util.module_from_spec(spec)
spec.loader.exec_module(VERIFIED)

PR_HEAD = "a" * 40


class FakeApi:
    def __init__(self, sha, tree, *, merged=True, conclusion="success", job="ci / path-impact", fail=None):
        self.sha, self.tree, self.merged = sha, tree, merged
        self.conclusion, self.job, self.fail = conclusion, job, fail

    def json(self, path):
        if self.fail:
            raise self.fail
        if path == f"commits/{self.sha}/pulls":
            return [
                {
                    "number": 7,
                    "merge_commit_sha": self.sha if self.merged else "b" * 40,
                    "merged_at": "2026-11-17T00:00:00Z" if self.merged else None,
                    "head": {"sha": PR_HEAD},
                }
            ]
        if path.startswith("actions/workflows/ci.yml/runs?"):
            assert f"head_sha={PR_HEAD}" in path and "event=pull_request" in path
            return {"workflow_runs": [{"id": 11, "head_sha": PR_HEAD, "conclusion": self.conclusion}]}
        if path.startswith("actions/runs/11/jobs"):
            return {"jobs": [{"id": 12, "name": self.job, "conclusion": "success"}]}
        raise AssertionError(path)

    def text(self, path):
        assert path == "actions/jobs/12/logs"
        return f"2026-11-17T00:00:00Z precheck ok\n2026-11-17T00:00:01Z VERDIFY_TESTED_TREE={self.tree}\n"


@pytest.fixture
def head():
    sha = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
    tree = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD^{tree}"], text=True).strip()
    return sha, tree


def run(api, sha, monkeypatch):
    monkeypatch.chdir(ROOT)
    return VERIFIED.main(["verified_on_pr.py", sha], api=api)


def test_the_same_tree_is_verified(head, monkeypatch, capsys):
    sha, tree = head
    assert run(FakeApi(sha, tree), sha, monkeypatch) == 0
    assert capsys.readouterr().out == "verified\n"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"tree": "f" * 40},  # main moved: the merged tree is not the one the PR tested
        {"merged": False},  # a direct push, not a merged pull request
        {"conclusion": "failure"},
        {"job": "ci / validate"},  # no path-impact log to read the tree from
        {"fail": OSError("api down")},
        {"fail": KeyError("workflow_runs")},
    ],
)
def test_anything_else_runs_the_full_suite(head, monkeypatch, capsys, kwargs):
    sha, tree = head
    kwargs.setdefault("tree", tree)
    assert run(FakeApi(sha, **kwargs), sha, monkeypatch) == 1
    assert capsys.readouterr().out == ""


def test_a_malformed_sha_is_refused(monkeypatch):
    assert run(None, "HEAD", monkeypatch) == 2


def test_path_impact_logs_the_tree_and_only_ci_yml_asks_for_verification():
    text = (ROOT / "ci" / "gha" / "path-impact.sh").read_text()
    assert "VERDIFY_TESTED_TREE=$(git rev-parse 'HEAD^{tree}')" in text
    assert '"${GITHUB_EVENT_NAME:-}" = push' in text
    assert 'VERDIFY_VERIFY_ON_PR: "true"' in (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    assert "VERDIFY_VERIFY_ON_PR" not in (ROOT / ".github" / "workflows" / "build.yml").read_text()
