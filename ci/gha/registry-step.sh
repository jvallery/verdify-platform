#!/usr/bin/env bash
# GHA registry steps: the five validation steps that came from the native
# repo-validate profile in the jvallery/agents registry record, one per job.
# Since #1397 step 5 removed .agent-fleet/ci.yaml and gated the native record,
# this script is the only source of these commands.
#
#   ci/gha/registry-step.sh platform-static|platform-tests|campaign-qualification
#                           |firmware-logic|firmware-secretless-compile
#
# Job images (estate-ci runners.yaml, repository jvallery/verdify-platform):
#   firmware-secretless-compile  verdify-platform-ci-esphome (ESPHome 2026.6.5)
#   the other four               verdify-platform-ci-tools (agents-ci-tools)
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
  platform-static)
    uv sync --python 3.12 --extra dev --extra api --extra planner || exit 1
    # Both ruff passes run; the step fails at the end if either failed.
    rc=0
    uv run ruff check ingestor/ api/ mcp/ scripts/*.py tests/ verdify_schemas/ || rc=1
    uv run ruff format --check ingestor/ api/ mcp/ scripts/*.py tests/ verdify_schemas/ || rc=1
    exit "$rc"
    ;;
  platform-tests)
    ci_require_runner_tools  # two tests run `kustomize build`
    export PYTHONPATH="$PWD" && uv sync --python 3.12 --extra dev --extra api --extra planner && uv pip install --python .venv/bin/python -r ingestor/requirements-image.txt || exit 1
    # Setup stops at its first failure; both pytest invocations then run, and the
    # step fails at the end if either failed (one run shows every failure).
    rc=0
    uv run pytest -q verdify_schemas/tests/ --ignore=verdify_schemas/tests/test_climate_intent.py --ignore=verdify_schemas/tests/test_drift_guards.py --ignore=verdify_schemas/tests/test_mcp_responses.py --ignore=verdify_schemas/tests/test_relationships.py --ignore=verdify_schemas/tests/test_tunables.py --ignore=verdify_schemas/tests/test_vault_writers.py --ignore=verdify_schemas/tests/test_views.py || { echo "::error::platform-tests: the verdify_schemas invocation failed"; rc=1; }
    uv run pytest -q tests/test_device_write_gate.py tests/test_migration_rollback_safety.py tests/test_14_site_doctor.py tests/test_climate_intent_replay_evaluator.py tests/test_generate_daily_plan.py tests/test_lab_generator_standardization.py tests/test_lab_publish_k3s_guard.py tests/test_mqtt_fanout.py tests/test_site_content_refresh.py tests/test_alert_delivery_local.py tests/test_soil_dryout_alert.py tests/test_tempest_sync.py tests/test_writer_lease_fence.py tests/test_gha_firmware_secretless_compile.py || { echo "::error::platform-tests: the tests/ invocation failed"; rc=1; }
    exit "$rc"
    ;;
  campaign-qualification)
    # The native report path (/workspace) does not exist on ARC; keep it private.
    export CI_TEST_REPORT="${CI_TEST_REPORT:-$HOME/ci-test-report.json}"
    # The tool's default qualification selection (never the campaign job's
    # dashboard-db one), optionally one CAMPAIGN_SHARD=i/n of it: the workflow's
    # campaign-qualification-shard matrix (#1535, STD-CI-03) runs every n-th file
    # from i, so the n shards together run every file exactly once.
    unset VERDIFY_CAMPAIGN_SELECT
    export PYTHONPATH="$PWD" && uv sync --python 3.12 --extra dev --extra api --extra planner && uv pip install --python .venv/bin/python -r ingestor/requirements-image.txt && python3 ci/gha/campaign_shard.py /usr/local/bin/verdify-campaign-ci
    ;;
  firmware-logic)
    # Setup stops at its first failure; then every test program builds and runs,
    # each failure prints under its name, and the step fails at the end if any failed.
    bash -lc '
      set -uo pipefail
      test -f firmware/test/data/replay_overrides.csv || gunzip -k firmware/test/data/replay_overrides.csv.gz || exit 1
      cd firmware || exit 1
      failed=""
      check() {
        local name="$1"; shift
        echo "== firmware-logic: ${name} =="
        "$@" || { echo "::error::firmware-logic: ${name} failed"; failed="${failed} ${name}"; }
      }
      greenhouse() { g++ -std=c++17 -I lib -o test/test_greenhouse test/test_greenhouse_logic.cpp && ./test/test_greenhouse; }
      running_alone() { g++ -std=c++17 -I lib -o test/test_running_alone test/test_running_alone.cpp && ./test/test_running_alone; }
      climate_law() { g++ -std=c++17 -I lib -I ../docs/reviews/control-review-2026-11-15/sim -o test/test_climate_law test/test_climate_law.cpp && ./test/test_climate_law; }
      replay_overrides() { g++ -std=c++17 -O2 -I lib -o test/replay_overrides test/replay_overrides.cpp && ./test/replay_overrides test/data/replay_overrides.csv | tail -30; }
      replay_invariants() {
        g++ -std=c++17 -O2 -I lib -o test/replay_invariants test/replay_invariants.cpp || return 1
        local rc=0
        ./test/replay_invariants test/data/replay_overrides.csv || rc=$?
        if [ "$rc" -eq 2 ]; then
          echo "replay corpus predates invariant schema; accepted legacy corpus"
          return 0
        fi
        return "$rc"
      }
      check test_greenhouse_logic greenhouse
      check test_running_alone running_alone
      check test_climate_law climate_law
      check replay_overrides replay_overrides
      check replay_invariants replay_invariants
      if [ -n "$failed" ]; then
        echo "== firmware-logic FAILED:${failed} =="
        exit 1
      fi
    '
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
