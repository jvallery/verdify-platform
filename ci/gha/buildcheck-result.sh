#!/usr/bin/env bash
# Aggregate "ci / buildcheck" (#1534). Arguments: impact=<result> images=<result>
# (GitHub Actions needs.<job>.result of buildcheck-impact and buildcheck-image).
#   impact skipped        -> not a PR, or VERDIFY_BUILDCHECK is not "true": pass
#   impact success        -> images must be success, or skipped (no image impacted)
#   anything else         -> fail
set -euo pipefail
impact="" images=""
for pair in "$@"; do
  case "$pair" in
    impact=*) impact="${pair#impact=}" ;;
    images=*) images="${pair#images=}" ;;
    *) echo "unknown argument ${pair}" >&2; exit 2 ;;
  esac
done
echo "buildcheck-impact=${impact} buildcheck-image=${images}"
case "$impact" in
  skipped)
    echo "image build-check not run (not a pull request, or VERDIFY_BUILDCHECK is off)"
    exit 0 ;;
  success)
    case "$images" in
      success) echo "every impacted image built"; exit 0 ;;
      skipped) echo "no image impacted"; exit 0 ;;
    esac ;;
esac
echo "::error::image build-check failed (impact ${impact}, images ${images})"
exit 1
