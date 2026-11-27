#!/usr/bin/env bash
# GHA path-impact: run the classifier on the exact checkout.
#
#   ci/gha/path-impact.sh          PR/dispatch classification (check flags)
#   ci/gha/path-impact.sh --push   main-push classification (build profiles, pin-only skip;
#                                  carried inputs alone publish nothing)
#   ci/gha/path-impact.sh --push --include-carried   the same for a manual dispatch,
#                                  which also publishes carried inputs
#
# ci.yml (CI audit C1, #1716): every run logs VERDIFY_TESTED_TREE=<tree of the
# checkout>. With VERDIFY_VERIFY_ON_PR=true on a push to main, a full-class commit
# whose exact tree a successful pull_request run already tested
# (ci/gha/verified_on_pr.py) gets the light class "verified": no validate part,
# campaign shard, firmware compile or dashboard check runs again. A scheduled run
# (one per night) has no base, so it is always full.
#
# ci/gha/verdify_path_impact.py is the only classifier (#1397).
#
# Prints VERDIFY_PATH_IMPACT=<receipt>. When GITHUB_OUTPUT is set, appends mode,
# every profile flag, every check flag and the light-path outputs (light,
# validate-parts, full), so build.yml selects its builds and ci.yml its checks.
. "$(dirname "$0")/lib.sh"
ci_fetch_history
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
ci_classify "$out" "$@"
echo "VERDIFY_TESTED_TREE=$(git rev-parse 'HEAD^{tree}')"
if [ "${VERDIFY_VERIFY_ON_PR:-}" = true ] && [ "${GITHUB_EVENT_NAME:-}" = push ] \
  && [ "$(cat "$out/light")" = none ] \
  && [ "$(python3 ci/gha/verified_on_pr.py "$(git rev-parse HEAD)" || true)" = verified ]; then
  printf verified > "$out/light"
  printf '[]' > "$out/validate-parts"
  for flag in full firmware-check dashboard-check; do printf false > "$out/$flag"; done
fi
for flag in dashboard-check firmware-check full; do
  case "$(cat "$out/$flag")" in
    true|false) ;;
    *) echo "path impact wrote no boolean ${flag}" >&2; exit 1 ;;
  esac
done
case "$(cat "$out/light")" in
  none|docs|pins|verified) echo "path impact light class: $(cat "$out/light")" ;;
  *) echo "path impact wrote no light class" >&2; exit 1 ;;
esac
# validate-parts feeds fromJSON in ci.yml: exactly one of the known lists.
case "$(cat "$out/light"):$(cat "$out/validate-parts")" in
  'none:["containment-firmware","pure-logic-1","pure-logic-2","rest"]'|'pins:["pins"]'|'docs:[]'|'verified:[]') ;;
  *) echo "path impact wrote an unexpected validate-parts for its light class" >&2; exit 1 ;;
esac
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  for f in "$out"/*; do
    name="$(basename "$f")"
    [ "$name" = receipt.json ] && continue
    printf '%s=%s\n' "$name" "$(cat "$f")" >> "$GITHUB_OUTPUT"
  done
fi
