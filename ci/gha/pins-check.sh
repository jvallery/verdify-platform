#!/usr/bin/env bash
# The pin-only light path (CI audit 2026-11-16): ci.yml runs this as the only
# validate part when path impact classifies every change as a digest (or comment)
# change of a pin file (deploy/k8s/overlays/prod/kustomization.yaml,
# deploy/k8s/overlays/prod/release-pins.yaml, deploy/k8s/dashboard/kustomization.yaml).
# It proves what such a change can break: both renders, zero Secret in the prod
# render, the pin shape the pin job and promote-release-pins.py rely on, and
# non-zero digests.
# Called by ci/gha/validate.sh after the dependency bootstrap.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
PY="${PYTHON:-.venv/bin/python}"
command -v kustomize >/dev/null || { echo "pins check needs kustomize on the runner image" >&2; exit 1; }

printf '\n== prod overlay and dashboard render ==\n'
render="$(mktemp)"
trap 'rm -f "$render"' EXIT
kustomize build deploy/k8s/overlays/prod > "$render"
kustomize build deploy/k8s/dashboard > /dev/null

printf '\n== zero Secret in the prod render ==\n'
bash ci/gha/assert-no-secret.sh < "$render"

printf '\n== pin shape and release-pin contract ==\n'
tests=(
  tests/test_prod_release_pins.py
  tests/test_dashboard_manifests.py
  tests/test_operator_api_manifests.py
  tests/test_setpoint_server_db_backend.py
)
# The orchestrator's non-zero digest guard, while the component exists (the
# retirement removes the test with the component).
[ ! -f tests/test_experiment_v2_orchestrator_manifests.py ] ||
  tests+=(tests/test_experiment_v2_orchestrator_manifests.py)
"$PY" -m pytest -q -rs "${tests[@]}"

printf '\nPIN GATES GREEN\n'
