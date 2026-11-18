#!/usr/bin/env python3
"""Was this main commit's exact tree already green as a pull request? (CI audit C1, #1716)

    python3 ci/gha/verified_on_pr.py <head-sha>

A push to main normally re-runs the full suite on a tree its pull request already
proved. This prints "verified" and exits 0 only when all of these hold:

  * the commit is the merge commit of a merged pull request (GET /commits/{sha}/pulls);
  * a pull_request run of this `ci` workflow for that pull request's head commit
    concluded "success" (every required context passed);
  * that run's "ci / path-impact" job logged VERDIFY_TESTED_TREE=<tree> and <tree>
    equals this commit's tree (git rev-parse HEAD^{tree}), so main holds byte for
    byte what the pull request run tested.

Anything else, including any API or log error, prints nothing and exits 1, and the
caller runs the full suite. ci.yml keeps one scheduled full run per night.
Needs GITHUB_TOKEN with actions: read and pull-requests: read, GITHUB_REPOSITORY
and GITHUB_API_URL (standard library only).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request

SHA = re.compile(r"^[0-9a-f]{40}$")
TREE_LINE = re.compile(r"VERDIFY_TESTED_TREE=([0-9a-f]{40})\b")
PATH_IMPACT_JOB = "ci / path-impact"


class Api:
    def __init__(self, repo: str, token: str, base: str):
        self.repo, self.token, self.base = repo, token, base.rstrip("/")

    def _get(self, path: str) -> bytes:
        request = urllib.request.Request(
            f"{self.base}/repos/{self.repo}/{path}",
            headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
        )
        # Not forwarded on the log download's redirect to blob storage.
        request.add_unredirected_header("Authorization", f"Bearer {self.token}")
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()

    def json(self, path: str):
        return json.loads(self._get(path))

    def text(self, path: str) -> str:
        return self._get(path).decode("utf-8", "replace")


def merged_pull(api, sha: str) -> dict | None:
    for pull in api.json(f"commits/{sha}/pulls"):
        if pull.get("merge_commit_sha") == sha and pull.get("merged_at"):
            return pull
    return None


def tested_trees(api, pr_head: str) -> list[str]:
    """Trees that successful pull_request runs of ci.yml tested for this PR head."""
    runs = api.json(f"actions/workflows/ci.yml/runs?event=pull_request&head_sha={pr_head}&status=success&per_page=20")[
        "workflow_runs"
    ]
    trees = []
    for run in runs:
        if run.get("conclusion") != "success" or run.get("head_sha") != pr_head:
            continue
        jobs = api.json(f"actions/runs/{int(run['id'])}/jobs?per_page=100")["jobs"]
        for job in jobs:
            if job.get("name") == PATH_IMPACT_JOB and job.get("conclusion") == "success":
                trees += TREE_LINE.findall(api.text(f"actions/jobs/{int(job['id'])}/logs"))
    return trees


def verified(api, sha: str, tree: str) -> bool:
    pull = merged_pull(api, sha)
    if pull is None:
        print(f"verified_on_pr: {sha} is not the merge commit of a merged pull request", file=sys.stderr)
        return False
    head = (pull.get("head") or {}).get("sha", "")
    if not SHA.fullmatch(head):
        return False
    trees = tested_trees(api, head)
    if tree in trees:
        print(f"verified_on_pr: tree {tree} passed as PR #{int(pull['number'])} at {head}", file=sys.stderr)
        return True
    print(
        f"verified_on_pr: PR #{int(pull['number'])} runs tested {sorted(set(trees)) or 'no tree'}, not {tree}",
        file=sys.stderr,
    )
    return False


def main(argv: list[str], api=None) -> int:
    sha = argv[1] if len(argv) > 1 else ""
    if not SHA.fullmatch(sha):
        print("usage: verified_on_pr.py <head-sha>", file=sys.stderr)
        return 2
    try:
        tree = subprocess.check_output(["git", "rev-parse", f"{sha}^{{tree}}"], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return 1
    if api is None:
        repo, token = os.environ.get("GITHUB_REPOSITORY", ""), os.environ.get("GITHUB_TOKEN", "")
        if not repo or not token:
            print("verified_on_pr: GITHUB_REPOSITORY or GITHUB_TOKEN unset", file=sys.stderr)
            return 1
        api = Api(repo, token, os.environ.get("GITHUB_API_URL", "https://api.github.com"))
    try:
        ok = verified(api, sha, tree)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"verified_on_pr: API unavailable ({type(exc).__name__}); running the full suite", file=sys.stderr)
        return 1
    if ok:
        print("verified")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
