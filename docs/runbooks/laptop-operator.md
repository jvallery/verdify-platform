# Operator runbook: query, deploy and check the firmware from any kubectl host

**Audience:** the operator and any kubectl-equipped operator host. The file keeps its old name because other
documents cite its sections.

Production (`verdify-prod`, Argo CD app `verdify-prod-dark`, manual sync behind the device-write gate) is the only
environment, and `main` is the only deploy branch. Production is advanced by release-pin commits in
`deploy/k8s/overlays/prod` (section 2) and then the gated sync. The operating model, the dev loop and the firmware
delivery notes are in [`k3s-operations.md`](./k3s-operations.md); read that first.

## 0. One-time host setup

```bash
make setup                     # repo-local .venv from pyproject.toml (Python 3.12 or later)
# plus kubectl with the cluster context, kustomize, jq and psql (libpq)
```

The Makefile prefers the repo-local `.venv`. Nothing on the host holds a credential for these steps: database and
firmware secrets stay in the cluster, and the signed firmware path needs no toolchain or secret on the host.

## 1. Database access (prod only)

```bash
scripts/verdify-db.sh prod -c "SELECT count(*) FROM climate;"   # one-shot
scripts/verdify-db.sh prod                                      # interactive psql
scripts/verdify-db.sh prod --tunnel        # localhost:5433 for asyncpg/psycopg/DBeaver
```

Credentials: k8s Secret `verdify-app-secrets`, key `POSTGRES_PASSWORD`, in `verdify-prod` (the script never prints
it; `--tunnel` prints the kubectl one-liner to export `PGPASSWORD` yourself). kubectl exec and port-forward ride the
API-server channel, so the in-cluster default-deny NetworkPolicies do not apply. There is no second database: heavy
analysis uses a dump or an explicitly provisioned disposable copy, not the live writer database.

Start every ad-hoc session with `SET statement_timeout = '5s'; SET default_transaction_read_only = on;`. Run
`EXPLAIN` on any query that is not a copy of one the API already runs, and filter the hypertables (`system_state`,
`climate`, `setpoint_changes`) by an exact indexed key with `ORDER BY ts DESC LIMIT n`, never by `ILIKE '%…%'` or
an unbounded `DISTINCT`. Killing the local `kubectl exec` does not stop the query on the server: find its pid in
`pg_stat_activity` and call `pg_cancel_backend`.

Reads worth knowing:

```bash
# Today's and the last week's record: compliance, relay starts and run hours, utilities, drying
scripts/verdify-db.sh prod -c "SELECT * FROM v_daily_record ORDER BY date DESC LIMIT 8;"
# The law's newest state record and the served band
scripts/verdify-db.sh prod -c "SELECT ts, value FROM system_state WHERE entity = 'climate_law_state' ORDER BY ts DESC LIMIT 1;"
scripts/verdify-db.sh prod -c "SELECT * FROM fn_band_setpoints(now());"
# The newest daily reviews
scripts/verdify-db.sh prod -c "SELECT kind, review_date, status, failure, written_at FROM planner_review ORDER BY requested_at DESC LIMIT 7;"
```

Historical derived-data reconciliation lives in [`derived-history-reconcile.md`](./derived-history-reconcile.md).
It dry-runs by default; a production apply requires its explicit apply flag and technical preflight.

## 2. CI/CD: merge builds, promotion pins, the gated sync deploys

- **Merge to `main`:** the GitHub Actions `build` workflow (`.github/workflows/build.yml`, ARC set
  `verdify-platform-build`) builds each path-impacted image with Kaniko into the zot origin, tagged `gha-<sha12>`
  and recorded by digest. Its `pin` job opens one pull request that records the api, mcp, ingestor and migrate
  digests in the `images:` block of `overlays/prod/kustomization.yaml` as build candidates, and moves the
  dashboard-web digest. The candidates do not render: `overlays/prod/release-pins.yaml`, a `transformers:` entry
  applied after `images:`, holds the digests production runs, so `main` keeps rendering what is live (#808). A
  merge is a Git change only.
- **Promote:** run `python3 scripts/promote-release-pins.py` (it copies the candidate
  digests into `release-pins.yaml`, all four by default: the migrate hook carries the schema the others expect),
  commit that digest-only change, merge it, then run the gated sync below. The setpoint-server and lab-publisher
  release pins are edited by hand in the `images:` block. Details: [`prod-promotion.md`](./prod-promotion.md).
  Check the rendered change first:
  ```bash
  kustomize build deploy/k8s/overlays/prod | grep -o 'verdify-[a-z0-9-]*@sha256:[0-9a-f]*' | sort -u
  ```
- **The gated prod sync (the ONLY step that touches the live writer):**
  Pre-check with `kustomize build deploy/k8s/overlays/prod | kubectl diff -f -` and confirm the ingestor Deployment
  (strategy Recreate, never two writers) changes only when you intend it. A sync applies every OutOfSync resource,
  not only yours. For **every new full sync**, submit the exact intended revision and clear the previous terminal
  operation state atomically, even when the previous operation was full and had no selectors:
  ```bash
  set -euo pipefail
  SYNC_REVISION='<exact-main-sha>'
  [[ "$SYNC_REVISION" =~ ^[0-9a-f]{40}$ ]]
  ARGO_OPERATION_SNAPSHOT="$(kubectl get application verdify-prod-dark -n argocd -o json)"
  printf '%s' "$ARGO_OPERATION_SNAPSHOT" | jq -e '
    .operation == null and
    (.status.operationState == null or
     (.status.operationState.phase | IN("Succeeded", "Failed", "Error")))'
  ARGO_OPERATION_RV="$(printf '%s' "$ARGO_OPERATION_SNAPSHOT" | jq -r '.metadata.resourceVersion')"
  kubectl patch application verdify-prod-dark -n argocd --type json -p "$(
    jq -n --arg rv "$ARGO_OPERATION_RV" --arg revision "$SYNC_REVISION" '
      [{op:"test",path:"/metadata/resourceVersion",value:$rv},
       {op:"add",path:"/status/operationState",value:null},
       {op:"add",path:"/operation",value:{
         initiatedBy:{username:"<operator>"},
         sync:{revision:$revision,prune:false}}}]'
  )"
  ```
  Stop if the precondition or resourceVersion test fails; inspect the current operation before submitting another
  one. The Application CRD has no status subresource, so status clearing and submission share the atomic patch. A
  prior selective operation can leak its resource scope ([#317](https://github.com/jvallery/verdify-platform/issues/317),
  [upstream #28701](https://github.com/argoproj/argo-cd/issues/28701)). A separate failure on 2026-10-02 reused a
  stale `syncResult` after a prior full operation: it reported Succeeded at the intended new revision while the
  migrate hook and running workloads still used the old digests. Revision and resource count alone are not
  deployment evidence.

  Immediately verify that a **new** operation started and that `.status.operationState.operation.sync.resources`
  is absent or empty. Inspect the migration and bootstrap hook Pod UIDs, start times and image digests against the
  promoted `release-pins.yaml`, then the running workload image IDs. Require the ledger and readiness hooks and the smoke
  checks (`prod-promotion.md`, Operator checks); do not accept cached hook results, Succeeded or Synced/Healthy as
  a substitute. If selectors, stale hook provenance, old running digests or too few resources appear, stop and
  preserve the outcome before a documented fix-forward operation.

  The app syncs with prune off. When a release removes a workload, its pull request lists the live objects by kind
  and exact name; delete those after the sync, and nothing else.

  The explicit `resources:` list (`scripts/gen-sync-resource-vector.sh`, reviewed first; see
  [`attended-convergence.md`](./attended-convergence.md)) is a fallback only: Argo CD skips every hook on a
  selective sync, including the `verdify-migrate` PreSync, and does not record it in history.

### Exclusive-lock windows: a migrate hook or a migration qualification

A migration that takes ACCESS EXCLUSIVE locks (view redefinitions, drops), whether it runs in the `verdify-migrate`
PreSync hook or under `scripts/qualify-migration-successor.py`, stalls production while it waits. The qualifier holds
its prelocks for 15 to 30 s on each run. Two things collide with it:

- The login attestation of MCP (`fn_mcp_runtime_attest_ordinary_login()`) and of the API
  (`fn_runtime_attest_ordinary_login()`; the operator API attests through its own login) reads the relations the
  prelocks hold and deadlocks with them, so the run loses its locks or a runtime loses its session.
- The ingestor refreshes its materialized views every 300 s (`fn_runtime_refresh_materialized_views()`), and its
  lifecycle persistence gives up after about 15 s of blocked writes, which restarts the ingestor.

The procedure:

1. Check live state before you scale a Deployment to zero: no sync operation is running on `verdify-prod-dark`,
   and no node is being drained (`kubectl get nodes` shows no worker cordoned).
2. Pre-check `pg_stat_activity`: no transaction open longer than 20 s and no lock wait. Start at least 15 minutes
   clear of the 02:29Z and 14:29Z compression jobs, off the ingestor's 5-minute view refresh and the :02/:32
   band-curve and daily-record refresh, outside 14:00-15:00Z (the daily review), outside 09:10-09:30Z (the nightly
   backup at 02:17 local, `verdify-db-backup`: its whole-database dump holds every table for about 4 minutes, longer
   than a migration's lock retry; in daylight time it runs an hour earlier, 08:10-08:30Z), and not during another
   sync.
3. Note the replica counts, then scale `verdify-mcp`, `verdify-api` and `verdify-operator-api` to 0 about 15 s after
   an ingestor view refresh, so that the run does not meet the next one:
   ```bash
   kubectl -n verdify-prod get deploy verdify-mcp verdify-api verdify-operator-api -o custom-columns=NAME:.metadata.name,REPLICAS:.spec.replicas
   kubectl -n verdify-prod scale deploy verdify-mcp verdify-api verdify-operator-api --replicas=0
   ```
4. Run the qualification, or submit the full sync. A full sync restores the replica counts in Git when it applies
   the Deployments after its PreSync hooks. After a qualification, or if a hook fails and the sync stops, scale the
   three back by hand first (to the counts noted in step 3), then investigate.
5. Health check right after: ingestor, planner, API and MCP pods Ready with no new restarts, and
   `scripts/k3s-smoke.sh smoke` and `device-monitor` passing.
6. Recreate the planner pod once MCP is back: its MCP client does not reconnect after MCP was away.
   ```bash
   kubectl -n verdify-prod delete pod -l app.kubernetes.io/component=hermes-iris
   ```

## 3. Firmware: what runs and how to check it

The controller runs the band-edge law. It is flashed through the signed path
([`firmware-signed-artifacts.md`](./firmware-signed-artifacts.md)); the `make firmware-deploy` alternative and the
preflight gates are in [`k3s-operations.md`](./k3s-operations.md) section 4. **Verify the running version from
`diagnostics.firmware_version`, not `firmware/artifacts/last-good.version`** (last-good is the rollback floor; it
lags until a release is promoted). The authoritative read from any kubectl host:

```bash
scripts/verdify-db.sh prod -c "SELECT firmware_version, max(ts) FROM diagnostics
  WHERE firmware_version IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 1;"
```

Then confirm the law is deciding and runs the released constants:

```bash
scripts/verdify-db.sh prod -c "SELECT entity, max(ts) FROM system_state
  WHERE entity IN ('climate_law_state', 'climate_law_constants', 'outdoor_source') GROUP BY 1;"
scripts/verdify-db.sh prod -c "SELECT alert_type, severity, ts FROM alert_log
  WHERE resolved_at IS NULL AND alert_type IN ('law_constants_mismatch', 'firmware_version_mismatch', 'clock_unconfirmed');"
```

The gates are real: no flash while `alert_log` has an unresolved critical or legacy-high row, climate telemetry
under 300 s old, the law's state record fresh, and a last-good or verified provisional rollback binary. There is
no bake, minimum-age or weekly gate (2026-11-05): ship new builds as often as needed. Overrides need the documented
reason-bearing environment values (see `scripts/firmware-deploy-preflight.sh`). There is one controller and no
test device.

## 4. Environment

| Surface | Current value |
|---|---|
| Namespace | `verdify-prod` (plus `verdify-dashboard` for the dashboard web) |
| Argo CD apps | `verdify-prod-dark` (manual sync, gated); `verdify-dashboard` (automated) |
| Public URLs | lab, labs, graphs, api, mcp and dashboard (.verdify.ai) |
| Database | `verdify-db` (TimescaleDB; single writer of device data: the ingestor) |
| Device | the ingestor is the only controller connection (replicas 1, Recreate); the setpoint server is the second device-affecting writer (Home Assistant grow lights) |
| Planner | Iris (`verdify-hermes-iris`), the daily reviewer; no climate writes |
| Grafana | graphs.verdify.ai |

Edge path: the Cloudflare tunnel (jvallery/network-infra) to the shared apps Traefik, then the tier-2
`verdify-traefik` in `verdify-prod`.

## 5. Where things are

- Argo CD Application declarations: kept outside this repository. Three Applications sync its paths:
  `verdify-prod-dark` (`deploy/k8s/overlays/prod`), `verdify-dashboard` (`deploy/k8s/dashboard`) and
  `verdify-descheduler` (`deploy/k8s/descheduler`); `AGENTS.md` says how each is delivered.
- Database dumps: NAS share `verdify`, subdirectory `db-dumps/prod`, through the static PV `verdify-db-dumps-prod`
  (RWX). jvallery/storage-infra declares the PV (storage-infra#574); this repository declares only the PVC
  `verdify-prod/verdify-db-dumps`.
