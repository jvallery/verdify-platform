#!/usr/bin/env bash
# Aggregate check: each argument is name=result (a GitHub Actions needs.<job>.result).
# Fails unless every listed job finished "success" (skipped/failure/cancelled fail).
# The literal result "not-impacted" passes: ci.yml writes it in place of a shard
# matrix's result only when the path-impact job's light class skips that matrix,
# and lists path-impact=<result> beside it, which must itself be "success".
set -euo pipefail
(( $# )) || { echo 'no shard results given' >&2; exit 2; }
failed=0
for pair in "$@"; do
  echo "$pair"
  case "${pair#*=}" in
    success) ;;
    not-impacted) echo "${pair%%=*}: not impacted by this change" ;;
    *)
      echo "::error::CI shard ${pair%%=*} finished ${pair#*=}"
      failed=1 ;;
  esac
done
exit "$failed"
