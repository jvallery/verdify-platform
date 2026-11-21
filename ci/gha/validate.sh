#!/usr/bin/env bash
# GHA validate: the native `validate` step (jvallery/agents WorkflowTemplate
# verdify-platform-ci, template validate) on the exact checkout. Same image
# (python:3.13-bookworm, the job image of the verdify-platform-ci set), same
# dependency bootstrap, same gate: scripts/ci-local.sh with CI_BASE_REF set, so
# the diff gates (rules 6 and 7, firmware replay diff) run. VALIDATE_PART (set
# per matrix job in .github/workflows/ci.yml) selects one parallel part (#1459);
# VALIDATE_PART=pins is the pin-only light path (ci/gha/pins-check.sh), which
# ci.yml selects instead of the four parts when every change is a digest pin.
. "$(dirname "$0")/lib.sh"

# Assert instead of install: ci-local.sh skips the g++ gates when the compiler
# is absent, so a missing toolchain must fail here rather than drop a gate.
for tool in g++ git curl tar make; do
  command -v "$tool" >/dev/null || { echo "CI image is missing $tool" >&2; exit 1; }
done

ci_require_runner_tools

ci_fetch_history
impact="$(mktemp -d)"
if [ "${GITHUB_EVENT_NAME:-}" = push ]; then
  ci_classify "$impact" --push >/dev/null
else
  ci_classify "$impact" >/dev/null
fi
# A digest-only pin push to main skips the full parts, as natively; the pins
# part still proves the render and the pin shape.
if [ "$(cat "$impact/mode")" = skip ] && [ "${VALIDATE_PART:-}" != pins ]; then
  echo "path impact: digest-only pin diff; validation not required"
  exit 0
fi
base="$(ci_base)"
if [ -n "$base" ]; then
  export CI_BASE_REF="$base"
else
  unset CI_BASE_REF
fi

# No editable install (pyproject has no build-system); dependency lists come
# straight from pyproject, as in the native step.
python3 - <<'PY' > "$impact/reqs.txt"
import tomllib
d = tomllib.load(open("pyproject.toml", "rb"))
reqs = list(d["project"]["dependencies"])
opt = d["project"].get("optional-dependencies", {})
for grp in ("dev", "planner", "api"):
    reqs += opt.get(grp, [])
print("\n".join(reqs))
PY
python3 -m venv .venv
.venv/bin/pip -q install -r "$impact/reqs.txt" paho-mqtt 'mcp[cli]' pydantic-settings pytest pytest-asyncio
if [ "${VALIDATE_PART:-}" = pins ]; then
  bash ci/gha/pins-check.sh
else
  # G10: the closed-loop climate law simulation runs its full weather year here, asked for explicitly, and the
  # job fails unless the full run wrote its receipt.
  sim_full=0
  unset CLIMATE_LAW_SHADOW_RESEARCH CLIMATE_LAW_WEAR_SHADOW_RECEIPT
  case "${VALIDATE_PART:-all}" in all | containment-firmware) sim_full=1 ;; esac
  if [ "$sim_full" = 1 ]; then
    export CLIMATE_LAW_SIM=full CLIMATE_LAW_SIM_RECEIPT="$impact/climate_law_sim.receipt"
    # Observation-only selector for the reserved qualification PR.
    if [ "${VALIDATE_PART:-}" = containment-firmware ] &&
       [ "${GITHUB_EVENT_NAME:-}" = pull_request ] &&
       [ "${GITHUB_HEAD_REF:-}" = verdify-backlog/vp1725-wear-shadow-qualification ]; then
      export CLIMATE_LAW_SHADOW_RESEARCH=1 CLIMATE_LAW_WEAR_SHADOW_RECEIPT="$impact/fan_wear_shadow.json"
    fi
  fi
  bash scripts/ci-local.sh
  if [ "$sim_full" = 1 ]; then
    grep -q '^mode=full ' "$CLIMATE_LAW_SIM_RECEIPT" 2>/dev/null \
      || { echo "climate law simulation: the full-year run did not execute (no receipt)" >&2; exit 1; }
    cat "$CLIMATE_LAW_SIM_RECEIPT"
    if [ -n "${CLIMATE_LAW_WEAR_SHADOW_RECEIPT:-}" ]; then
      test -s "$CLIMATE_LAW_WEAR_SHADOW_RECEIPT" || { echo "fan wear shadow: no receipt" >&2; exit 1; }
      python3 - "$CLIMATE_LAW_WEAR_SHADOW_RECEIPT" <<'PYSHADOW'
import json
import sys

with open(sys.argv[1]) as source:
    receipt = json.load(source)
scored = receipt.get("scored_onsets")
if receipt.get("mode") != "fan-start-shadow" or type(scored) is not int or scored <= 0:
    raise SystemExit("fan wear shadow: receipt must contain a positive scored onset count")
PYSHADOW
      cat "$CLIMATE_LAW_WEAR_SHADOW_RECEIPT"
    fi
    if [ -n "${CLIMATE_LAW_WEAR_RECEIPT:-}" ]; then
      test -s "$CLIMATE_LAW_WEAR_RECEIPT" || { echo "fan wear qualification: no receipt" >&2; exit 1; }
      cat "$CLIMATE_LAW_WEAR_RECEIPT"
    fi
  fi
fi
