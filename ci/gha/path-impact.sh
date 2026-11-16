#!/usr/bin/env bash
# GHA path-impact: run the native classifier on the exact checkout.
#
#   ci/gha/path-impact.sh          PR/dispatch classification (check flags)
#   ci/gha/path-impact.sh --push   main-push classification (build profiles, pin-only skip)
#
# ci/gha/verdify_path_impact.py started as a copy of the native pipeline's
# impact.py (jvallery/agents 2f2ea19bad7c436aa6bc5460d9ecc9b1cb845a57). The native
# pipeline is retired (#1397), so this repository's copy is the only one.
#
# Prints VERDIFY_PATH_IMPACT=<receipt>. When GITHUB_OUTPUT is set, appends mode,
# every profile flag, every check flag and the light-path outputs (light,
# validate-parts, full), so build.yml selects its builds and ci.yml its checks.
. "$(dirname "$0")/lib.sh"
ci_fetch_history
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
ci_classify "$out" "$@"
for flag in dashboard-check firmware-check full; do
  case "$(cat "$out/$flag")" in
    true|false) ;;
    *) echo "path impact wrote no boolean ${flag}" >&2; exit 1 ;;
  esac
done
case "$(cat "$out/light")" in
  none|docs|pins) echo "path impact light class: $(cat "$out/light")" ;;
  *) echo "path impact wrote no light class" >&2; exit 1 ;;
esac
# validate-parts feeds fromJSON in ci.yml: exactly one of the three known lists.
case "$(cat "$out/light"):$(cat "$out/validate-parts")" in
  'none:["containment-firmware","pure-logic-1","pure-logic-2","rest"]'|'pins:["pins"]'|'docs:[]') ;;
  *) echo "path impact wrote an unexpected validate-parts for its light class" >&2; exit 1 ;;
esac
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  for f in "$out"/*; do
    name="$(basename "$f")"
    [ "$name" = receipt.json ] && continue
    printf '%s=%s\n' "$name" "$(cat "$f")" >> "$GITHUB_OUTPUT"
  done
fi
