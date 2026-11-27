#!/usr/bin/env bash
# Scheduled isolated restore drill (#1549, STD-DR-04). Selects the newest
# committed backup pair (its .sha256 marker exists), restores it with
# restore-backup-pair.sh into a socket-only PostgreSQL in emptyDir, and emits
# one receipt line with the achieved RPO and measured RTO. Never connects to
# the production database: the pod has no DB credential, no service-account
# token and a deny-all NetworkPolicy.
set -Eeuo pipefail
umask 077

: "${BACKUP_DIR:?}"
: "${RESTORE_SCRIPT:?}"
: "${DRILL_MAX_RPO_SECONDS:?}"
: "${DRILL_MAX_RTO_SECONDS:?}"

start_epoch="$(date -u +%s)"
# Busybox userland (Alpine TimescaleDB image): ls + grep, no find -printf.
stem="$(ls -1 "${BACKUP_DIR}" | grep -E '^verdify-[0-9]{8}T[0-9]{6}Z\.sha256$' | sort | tail -n 1 || true)"
stem="${stem%.sha256}"
if [ -z "${stem}" ]; then
  echo '[restore-drill] FATAL: no committed backup pair (.sha256 marker) found' >&2
  exit 1
fi
# The stem is the UTC time the dump started: the recovery point.
ts="${stem#verdify-}"
backup_epoch="$(date -u -d "${ts:0:4}-${ts:4:2}-${ts:6:2} ${ts:9:2}:${ts:11:2}:${ts:13:2}" +%s)"
rpo_seconds="$(( start_epoch - backup_epoch ))"
echo "[restore-drill] selected backup=${stem} age_seconds=${rpo_seconds}"

set +e
BACKUP_STEM="${stem}" /bin/bash "${RESTORE_SCRIPT}"
restore_rc="$?"
set -e

end_epoch="$(date -u +%s)"
rto_seconds="$(( end_epoch - start_epoch ))"
semantic_ok=false
if [ "${restore_rc}" -eq 0 ]; then semantic_ok=true; fi
rpo_ok=false
if [ "${rpo_seconds}" -le "${DRILL_MAX_RPO_SECONDS}" ]; then rpo_ok=true; fi
rto_ok=false
if [ "${rto_seconds}" -le "${DRILL_MAX_RTO_SECONDS}" ]; then rto_ok=true; fi
result=pass
if [ "${semantic_ok}" != true ] || [ "${rpo_ok}" != true ] || [ "${rto_ok}" != true ]; then
  result=fail
fi
receipt="$(printf '{"event":"verdify_restore_drill_receipt","result":"%s","source_tier":"nas-local:pvc/verdify-db-dumps","backup":"%s","backup_epoch":%s,"start_epoch":%s,"end_epoch":%s,"rpo_seconds":%s,"rto_seconds":%s,"max_rpo_seconds":%s,"max_rto_seconds":%s,"rpo_ok":%s,"rto_ok":%s,"restore_exit":%s,"semantic_ok":%s}' \
  "${result}" "${stem}" "${backup_epoch}" "${start_epoch}" "${end_epoch}" "${rpo_seconds}" "${rto_seconds}" \
  "${DRILL_MAX_RPO_SECONDS}" "${DRILL_MAX_RTO_SECONDS}" "${rpo_ok}" "${rto_ok}" "${restore_rc}" "${semantic_ok}")"
echo "${receipt}"
# Keep the receipt on the Pod status too (kubectl get pod -o jsonpath=...terminated.message).
printf '%s\n' "${receipt}" > /dev/termination-log 2>/dev/null || true
if [ "${result}" != pass ]; then
  echo "[restore-drill] FAIL: semantic_ok=${semantic_ok} rpo_ok=${rpo_ok} rto_ok=${rto_ok}" >&2
  exit 1
fi
echo '[restore-drill] PASS'
