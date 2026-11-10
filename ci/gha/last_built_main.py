#!/usr/bin/env python3
"""Print the last main commit whose push `build` run succeeded (#1534).

    python3 ci/gha/last_built_main.py <head-sha>

build.yml diffs each push build against this commit instead of HEAD^1, so the
changes of a build that GitHub displaced while it was pending (one pending run
per concurrency group) or of a build that failed are built by the next run.
Only a strict ancestor of <head-sha> counts. Prints nothing and exits 1 when no
such run is found or the API is unavailable; the caller then uses HEAD^1.
Needs GITHUB_TOKEN with actions: read, GITHUB_REPOSITORY and GITHUB_API_URL
(standard library only, so it runs in any job image).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request

SHA = re.compile(r"^[0-9a-f]{40}$")


def successful_build_shas(repo: str, token: str, api: str) -> list[str]:
    url = f"{api}/repos/{repo}/actions/workflows/build.yml/runs?branch=main&event=push&status=success&per_page=50"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        runs = json.load(response)["workflow_runs"]
    # Newest first; a commit can have several runs (re-runs), keep the first.
    shas = []
    for run in sorted(runs, key=lambda r: r["created_at"], reverse=True):
        sha = run.get("head_sha", "")
        if SHA.fullmatch(sha) and sha not in shas:
            shas.append(sha)
    return shas


def is_strict_ancestor(sha: str, head: str) -> bool:
    if sha == head:
        return False
    return subprocess.run(["git", "merge-base", "--is-ancestor", sha, head], capture_output=True).returncode == 0


def main() -> int:
    head = sys.argv[1] if len(sys.argv) > 1 else ""
    if not SHA.fullmatch(head):
        print("usage: last_built_main.py <head-sha>", file=sys.stderr)
        return 2
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    api = os.environ.get("GITHUB_API_URL", "https://api.github.com")
    if not repo or not token:
        print("last_built_main: GITHUB_REPOSITORY or GITHUB_TOKEN unset", file=sys.stderr)
        return 1
    try:
        shas = successful_build_shas(repo, token, api)
    except (OSError, ValueError, KeyError) as exc:
        print(f"last_built_main: build runs unavailable: {type(exc).__name__}", file=sys.stderr)
        return 1
    for sha in shas:
        if is_strict_ancestor(sha, head):
            print(f"last_built_main: base {sha} (last successful push build)", file=sys.stderr)
            print(sha)
            return 0
    print("last_built_main: no successful push build is an ancestor of HEAD", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
