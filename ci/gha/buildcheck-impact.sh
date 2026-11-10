#!/usr/bin/env bash
# GHA PR build-check impact (#1534): classify the PR against its base on main
# with the same classifier build.yml uses, and print the impacted images as a
# JSON matrix (ci/gha/buildcheck_matrix.py). Writes images=<json> to
# GITHUB_OUTPUT when set. A missing base builds every image, as build.yml does.
. "$(dirname "$0")/lib.sh"
ci_fetch_history
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
ci_classify "$out"
images="$(python3 ci/gha/buildcheck_matrix.py "$out/receipt.json")"
echo "buildcheck images: ${images}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'images=%s\n' "$images" >> "$GITHUB_OUTPUT"
fi
