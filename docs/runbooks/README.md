# Runbooks

The current runbooks, and when to use each. Delivery itself is in [AGENTS.md](../../AGENTS.md).

| Runbook | Use it when |
|---|---|
| [prod-promotion.md](prod-promotion.md) | Releasing to `verdify-prod`: the image set, promotion steps, checks, rollback |
| [laptop-operator.md](laptop-operator.md) | The database queries, the full-sync procedure (section 2), exclusive-lock windows, the running firmware version (section 3) |
| [attended-convergence.md](attended-convergence.md) | `verdify-prod-dark` has many objects OutOfSync and a full sync does not converge them |
| [dashboard.md](dashboard.md) | Delivering, smoke-testing or switching off the dashboard web tier |
| [dashboard-access.md](dashboard-access.md) | Who can sign in to the dashboard, and with which role |
| [firmware-signed-artifacts.md](firmware-signed-artifacts.md) | Building, verifying, flashing and rolling back firmware; OTA password rotation |
| [k3s-operations.md](k3s-operations.md) | The operating model, the sources of truth and the manual firmware path (section 4) |
| [lab-content-pipeline.md](lab-content-pipeline.md) | The lab site publisher |
| [lab-serving-cache-redundancy.md](lab-serving-cache-redundancy.md) | The lab site's two serving caches |
| [../../deploy/k8s/descheduler/descheduler-arm.md](../../deploy/k8s/descheduler/descheduler-arm.md) | Changing or pausing the descheduler |
| [db-backup-pair-restore.md](db-backup-pair-restore.md) | The nightly logical backup, restoring a backup pair, the weekly restore drill |
| [phase4-drop-316-restore.md](phase4-drop-316-restore.md) | Restoring the objects migration 316 dropped |
| [portable-stateful-recovery.md](portable-stateful-recovery.md) | Moving or recovering a stateful pod |
| [ingestor-source-spool.md](ingestor-source-spool.md) | The ingestor's source spool |
| [writer-staged-reconcile.md](writer-staged-reconcile.md) | How the ingestor converges the controller to the desired values |
| [ha-grow-light-writer-ownership.md](ha-grow-light-writer-ownership.md) | The grow-light writer through Home Assistant |
| [outbound-boundary.md](outbound-boundary.md) | The `verdify-outbound` relay and egress |
| [verdify-tokenless-routing.md](verdify-tokenless-routing.md) | The inner `verdify-traefik` tier and its file provider |
| [mcp-client-attribution.md](mcp-client-attribution.md) | How MCP events are attributed to a client |
| [public-api-load-bounds.md](public-api-load-bounds.md) | The public API's request bounds |
| [grafana-saved-public.md](grafana-saved-public.md) | Public sharing of the product Grafana dashboards |
| [planner-semantic-dependency.md](planner-semantic-dependency.md) | The reviewer's search tools and their embedding provider |

Alert coverage is mapped in [../observability/alert-coverage-matrix.md](../observability/alert-coverage-matrix.md);
the rules themselves are kept outside this repository.

The other files in this directory and in `cnpg/` record finished work (qualifications, cutovers,
rehearsals, retired experiments). They are not procedures to follow. `ARGOCD.md`,
`docs/RELEASE-CHECKLIST.md` and `docs/agents/validation-boundaries.md` were removed as second copies
of the delivery description; their last version is at
[b6c0247a](https://github.com/jvallery/verdify-platform/tree/b6c0247a5796cd74fdcac0b18207d72558f582c7).
