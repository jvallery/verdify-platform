# Converging verdify-prod-dark after drift (full sync and its fallback)

Use this when `verdify-prod-dark` (source `deploy/k8s/overlays/prod`, production) has many
resources OutOfSync and a full sync does not converge them. Nothing here runs automatically.

## Why this exists

In August 2026 a submitted full-sync operation was rewritten to a stale two-resource selective
scope left by an earlier selective sync (#317): the PreSync migrate hook ran, the two
stale-scope resources synced and everything else stayed OutOfSync. The fix is not a bigger
timeout; it is clearing the stale selector and running one full sync.

## Preconditions (in order)

1. No in-flight operation on the Application
   (`kubectl -n argocd get app verdify-prod-dark -o jsonpath='{.status.operationState.phase}'`
   must be terminal/absent).
2. Target revision = current `main` HEAD (record the exact 40-char SHA).
3. Fresh DB backup exists (< 24 h; `verdify-db-backup` CronJob output).
4. Ingestor is Ready with a stable restart count; note the count.
5. The migration ledger is current: `scripts/verdify-db.sh prod -c "SELECT max(seq) FROM schema_migrations WHERE source = 'db/migrations';"`
   equals the newest migration in `db/migrations/` that the live release carries.

## The operation

For a prior full operation, submit a plain full sync (NO `--prune`, `resources`
**absent or empty**). If the prior completed operation was selective, use the
atomic status-clear full-sync patch in `docs/runbooks/laptop-operator.md` section 2;
Argo CD's merge-patch bug otherwise retains its stale resource selector
([upstream #28701](https://github.com/argoproj/argo-cd/issues/28701)).
Immediately verify the recorded operation:

- `kubectl -n argocd get app verdify-prod-dark -o jsonpath='{.status.operationState.operation.sync.resources}'`
  must be **absent or empty**.
- **If stale selectors appear or the result is narrow: STOP. Do not retry.**

Fallback only for a change proven independent of migrations and hooks:
the #317 explicit-resource-vector workaround. Generate the vector from source with
`scripts/gen-sync-resource-vector.sh` (renders the overlay; no cluster
access), review it, and submit the operation with that explicit `resources:`
list per `docs/runbooks/laptop-operator.md` section 2. Never include `--prune`.

## Success criteria (ALL required)

- Application at the **exact** recorded revision, **Synced + Healthy**.
- No in-flight operation remains.
- Broad result coverage: the operation result lists ~the full OutOfSync set,
  not a narrow subset.
- Single-writer invariant: exactly one ingestor pod (Recreate), writer lease
  held, ESP32 connection re-established.
- All workloads Ready; restart counts stable (allowing the expected one-time
  config-revision rollouts of api/mcp/ingestor/planner/setpoint-server onto
  the SAME image digests).
- PVC/Longhorn health: all PVCs Bound, no degraded Longhorn volumes.
- Public behavior: lab site + API endpoints respond normally.
- The next scheduled run of each periodic job (backup, watchdogs, backfill) succeeds.

Note the revision, the operation result and the smoke output on the release's issue.
