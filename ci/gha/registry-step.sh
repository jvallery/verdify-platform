#!/usr/bin/env bash
# GHA registry steps: two validation steps, one per job. This script is the
# only source of these commands (#1397). The other three
# (platform-static, platform-tests, firmware-logic) duplicated the validate parts;
# since the CI audit (C2, #1716) their contexts aggregate the validate parts.
#
#   ci/gha/registry-step.sh campaign-qualification|firmware-secretless-compile
#
# Job images (estate-ci runners.yaml, repository jvallery/verdify-platform):
#   firmware-secretless-compile  verdify-platform-ci-esphome (verdify-esphome-ci)
#   campaign-qualification       verdify-platform-ci-tools (agents-ci-tools)
. "$(dirname "$0")/lib.sh"
step="${1:?usage: registry-step.sh <step>}"
# VERDIFY_IMPACTED (ci.yml, from the path-impact job's outputs): false passes the
# step as "not impacted" so its required context still reports; true or unset runs it.
case "${VERDIFY_IMPACTED:-true}" in
  true) ;;
  false) echo "path impact: ${step} not required for this change"; exit 0 ;;
  *) echo "VERDIFY_IMPACTED must be true or false" >&2; exit 2 ;;
esac
# A collection error in one file must not abort the rest of its pytest invocation
# (campaign-qualification's tool inherits this); the failure still fails the step.
export PYTEST_ADDOPTS="${PYTEST_ADDOPTS:+$PYTEST_ADDOPTS }--continue-on-collection-errors"
case "$step" in
  campaign-qualification)
    # The native report path (/workspace) does not exist on ARC; keep it private.
    export CI_TEST_REPORT="${CI_TEST_REPORT:-$HOME/ci-test-report.json}"
    # The tool's default qualification selection (never the campaign job's
    # dashboard-db one), optionally one CAMPAIGN_SHARD=i/n of it: the workflow's
    # campaign-qualification-shard matrix (#1535) runs every n-th file
    # from i, so the n shards together run every file exactly once.
    unset VERDIFY_CAMPAIGN_SELECT
    export PYTHONPATH="$PWD" && uv sync --python 3.12 --extra dev --extra api --extra planner && uv pip install --python .venv/bin/python -r ingestor/requirements-image.txt && python3 ci/gha/campaign_shard.py /usr/local/bin/verdify-campaign-ci
    ;;
  firmware-secretless-compile)
    # The registry's inline program in its own file (ruff-formatted only) (R2: no logic in YAML).
    # FIRMWARE_TARGET (the workflow's per-target matrix, #1535) compiles one target; unset compiles both.
    python3 ci/gha/firmware_secretless_compile.py
    ;;
  *)
    echo "unknown registry step ${step}" >&2
    exit 2
    ;;
esac
