# Verdify paired logical backup restore

The `verdify-db-backup` CronJob writes three files with one timestamp stem:
`verdify-<UTC>.dump`, `verdify-<UTC>.roles.sql`, and
`verdify-<UTC>.sha256`. The last file is the commit marker. It records the
database owner and the SHA-256 of both artifacts. A dump without its matching
marker is incomplete for disaster recovery, even when `pg_restore -l` parses it.

The roles file comes from `pg_dumpall --roles-only --no-role-passwords
--no-comments --no-security-labels`. The backup fails closed if any role
setting other than `search_path` exists or if a password clause appears. It
never contains a runtime password or Kubernetes Secret value. Runtime
credentials must be provisioned separately through the authorized Secret
owner. The CronJob reads the production database and writes only the backup
PVC; it does not write production database rows.

Objects that migration 316 dropped are restored from their own archive, not from a pair:
[`phase4-drop-316-restore.md`](phase4-drop-316-restore.md).

## Restore a named pair

Use a committed source checkout and an exact stem from a completed backup Job.
The renderer creates a ConfigMap holding the source scripts, a deny-all
NetworkPolicy, and a one-shot Job. The Job mounts the backup PVC read-only,
runs a socket-only PostgreSQL in an `emptyDir`, and has no service-account
token or production DB credential.

```sh
python3 scripts/render-backup-pair-restore-job.py \
  --backup-stem verdify-YYYYMMDDTHHMMSSZ --run-id chosen-id \
  > /tmp/verdify-backup-pair-restore.yaml
kubectl --context vallery -n verdify-prod apply --dry-run=server \
  -f /tmp/verdify-backup-pair-restore.yaml
kubectl --context vallery -n verdify-prod apply \
  -f /tmp/verdify-backup-pair-restore.yaml
kubectl --context vallery -n verdify-prod wait \
  --for=condition=complete job/verdify-backup-pair-restore-chosen-id --timeout=60m
kubectl --context vallery -n verdify-prod logs job/verdify-backup-pair-restore-chosen-id
```

The order is deliberate: verify the exact pair and both hashes; initialize a
clean local cluster; replay the password-free role artifact (skipping only the
bootstrap owner role's duplicate `CREATE`); create the rehearsal database with
the recorded owner; create TimescaleDB; restore the database with owners and
ACLs; refresh materialized views; compare the restored password-free role
export byte for byte with its source; then run the aggregate data and bounded
privilege audit. A nonzero Job exit is a failed restore. Retain its Job, Pod,
and source coordinates for diagnosis; never retry against the production DB.

The restore now blocks if any TimescaleDB 2.25.2 internal regular or compressed
chunk has an owner different from its logical hypertable, or if a referenced
parent/chunk relation is missing. It then runs a rollback-only hostile fixture:
create an old compressed chunk and a current uncompressed chunk, transfer the
user-owned parent to a rogue role, verify Timescale propagates that owner to
both physical chunk forms, use `REASSIGN OWNED` twice to restore ownership,
and verify the SELECT grant survives. The fixture never directly alters an
internal chunk. If the read-only guard reports an unsupported state, preserve
the failed Job and inspect the logical parent and source owner. In a disposable
restore, repair an ordinary parent through `ALTER TABLE parent OWNER TO owner`
and rerun the guard; never issue `ALTER TABLE` against a Timescale chunk.
The blocking successor fixture also selects a real restored hypertable with
regular and compressed chunks and an explicit ACL. It changes only that
parent's owner, checks propagation to every physical chunk, repairs twice via
`REASSIGN OWNED`, and compares exact relation/column ACLs and both sealed C0
runtime login receipts before rolling back. No candidate or a changed catalog
fails the Job with an actionable error. The broad migration-217 fixture remains
separately advisory: rerunning that immutable migration against the current C0
sealed receipts fails before its owner poison, so treating the whole legacy
fixture as blocking would reject the qualified restore for a different reason.

This is logical recovery evidence. The C0 physical-clone receipt contract
deliberately includes database and role OIDs and is qualified separately.
For #670 completion, observe a **scheduled** CronJob publishing the pair,
then run this restore against that exact scheduled pair and record the Job UID,
source revision, hashes, role parity, data/schema counts, and current Argo
revision. A one-off candidate Job proves the mechanism but not the scheduled
delivery condition.

## Scheduled restore drill (#1549)

CronJob `verdify-prod/verdify-db-restore-drill` (component
`deploy/k8s/components/db-restore-drill`) runs the same restore every Monday at
02:47 UTC, 30 minutes after the nightly dump. At run time
`scripts/run-scheduled-restore-drill.sh` selects the newest stem that has its
`.sha256` commit marker, runs `restore-backup-pair.sh` (pair verification,
role replay, restore, Timescale chunk-ownership guard and fixtures, audit) and
logs one receipt line. The pod mounts `verdify-db-dumps` read-only, runs
PostgreSQL in `emptyDir` on a local socket, has no service-account token and no
DB credential, and a deny-all NetworkPolicy (`db-restore-drill` is excluded
from `egress-local-only`, so nothing else opens egress for it). Scripts reach
the pod through a generated ConfigMap from byte-identical copies in the
component's `src/` (`tests/test_db_restore_drill.py` checks drift).

Targets (storage-infra#996 app-database tier): **RPO 24 h, RTO 24 h**.
The drill enforces the database share of them and fails when either is
exceeded:

| Measure | Drill threshold | Variable |
|---|---|---|
| Achieved RPO: drill start minus the pair's stem time | 26 h (24 h plus dump schedule jitter) | `DRILL_MAX_RPO_SECONDS=93600` |
| Measured RTO: drill start to the end of restore and audit | 1 h | `DRILL_MAX_RTO_SECONDS=3600` |
| Drill interval | 7 days; `VerdifyDBRestoreDrillStale` (monitoring-stack) fires after 8 days without a successful run | CronJob schedule |

Read the receipt from the Job log or the Pod termination message:

```sh
kubectl --context vallery -n verdify-prod logs job/<verdify-db-restore-drill-job> | grep verdify_restore_drill_receipt
kubectl --context vallery -n verdify-prod get pod -l app.kubernetes.io/component=db-restore-drill \
  -o jsonpath='{.items[*].status.containerStatuses[0].state.terminated.message}'
```

Fields: `result`, `source_tier`, `backup` (stem), `backup_epoch`,
`start_epoch`, `end_epoch`, `rpo_seconds`, `rto_seconds`, the two thresholds
with `rpo_ok`/`rto_ok`, `restore_exit` and `semantic_ok`. Drill age reaches
Prometheus through kube-state-metrics CronJob status, the same channel as
`VerdifyDBBackupStale`. To run it now, `kubectl create job --from=cronjob/verdify-db-restore-drill <name>` and delete that Job by exact name after reading its receipt.

| Date (UTC) | Job | Backup | Achieved RPO | Measured RTO | Result |
|---|---|---|---|---|---|
| | | | | | first scheduled receipt pending |
