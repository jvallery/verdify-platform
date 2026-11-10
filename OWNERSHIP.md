# OWNERSHIP: jvallery/verdify-platform

Item-level detail for the **Verdify greenhouse product** lane: what this repository owns, where it runs, and how it is delivered, with health and dependencies for each item.

- **Central record:** the owner of record for every item is [ESTATE-INVENTORY.md](https://github.com/jvallery/agents/blob/main/docs/fleet-inventory/ESTATE-INVENTORY.md). It is rendered from `control-plane/agent-fleet-control/registry/policy/estate-ownership/` in jvallery/agents, and this repo's owner page is [estate/jvallery__verdify-platform.md](https://github.com/jvallery/agents/blob/main/docs/fleet-inventory/estate/jvallery__verdify-platform.md). Where this file and the central record disagree, the central record wins (R1). To add, move or retire an item, change the central entry and this file in the same change set.
- **Basis of this version:** a live read-only readback of cluster `vallery` on 2026-11-09 covering Argo Applications, workloads, Secret names (never values), PVCs, routes, NetworkPolicies, RBAC and PriorityClasses, combined with the central owner page and this repo at `main`. It replaces the 2026-10-19 snapshot tables ([#1533](https://github.com/jvallery/verdify-platform/issues/1533)); the snapshot and its retirement records (#990, #992, #993, #996, #997, #999) remain in this file's Git history.
- **Linked, not copied (R22):** device IPs and VLANs are in [network-infra `ipam/allocation.md`](https://github.com/jvallery/network-infra/blob/main/ipam/allocation.md). Hardware rows are in [proxmox-infrastructure `inventory/`](https://github.com/jvallery/proxmox-infrastructure/tree/main/inventory). Secret key contracts are in [`deploy/k8s/SECRETS.md`](deploy/k8s/SECRETS.md), and the Application and sync model is in [`ARGOCD.md`](ARGOCD.md).
- **Backlog:** GitHub issues in this repository ([#1556](https://github.com/jvallery/verdify-platform/issues/1556)).

## Argo CD Applications

The three Applications that sync this repository's paths are declared in jvallery/agents. Their declarations are planned to move to jvallery/estate-platform.

| Application | Destination | Source | Sync | Live 2026-11-09 |
|---|---|---|---|---|
| `verdify-prod-dark` | `verdify-prod` | `deploy/k8s/overlays/prod` @ `main` (in-cluster git mirror) | manual; the attended sync is the device-write gate | Healthy; OutOfSync between attended syncs by design |
| `verdify-dashboard` | `verdify-dashboard` | `deploy/k8s/dashboard` @ `main` | automated, self-heal, prune off | Synced, Healthy |
| `verdify-descheduler` | `verdify-descheduler` | `deploy/k8s/descheduler` @ exact commit `acb0969a` | manual, prune off | Synced, Healthy |

Three other Applications deliver into these namespaces. They are owned by jvallery/agents, not this repo: `verdify-prod-secrets-local-prod` and `verdify-dashboard-secrets` (central KSOPS Secret values), and `verdify-tenant-bounds` (quota and limits in `verdify-descheduler`).

## Namespaces

| Namespace | State | Source | Notes |
|---|---|---|---|
| `verdify-prod` | running | `deploy/k8s/overlays/prod` | The only product environment. `verdify-db` is the only database, and the ingestor is the only device writer. |
| `verdify-dashboard` | running | `deploy/k8s/dashboard` | The dashboard web tier (BFF) behind `dashboard.verdify.ai`; Pod Security restricted. |
| `verdify-descheduler` | running | `deploy/k8s/descheduler` | Hourly descheduler (#802). |
| `verdify-edge` | residue, retiring | Namespace object only | Held only the default ServiceAccount and `kube-root-ca.crt` on 2026-11-08. It is deleted after the AppProjects stop listing it ([#1001](https://github.com/jvallery/verdify-platform/issues/1001)). Add nothing there. |

`verdify-db-rehearsal` is retired (#992); its bucket and keys are storage-infra custody. Namespace `verdify-platform` belongs to jvallery/agents.

## Workloads

All rows below are delivered by `verdify-prod-dark` unless the row names another Application. Images come from `registry.vallery.net` and every container is pinned by digest. Release pins are in `deploy/k8s/overlays/prod/release-pins.yaml` and `kustomization.yaml`.

### verdify-prod Deployments and StatefulSet

| Workload | Replicas | Image | Role and hazards |
|---|---:|---|---|
| StatefulSet `verdify-db` | 1 | verdify-timescaledb | The only database (TimescaleDB, PG16). Never prune it or its PVC. Repinning it restarts the database and is an attended release. |
| `verdify-ingestor` | 1 | verdify-ingestor | **Only ESP32 writer**: `strategy: Recreate` and `VERDIFY_DEVICE_WRITE_ENABLED=1`. Holds the writer Lease (Role/RoleBinding `verdify-ingestor-writer-lease`). |
| `verdify-setpoint-server` | 1 | verdify-setpoint-server | Second device-affecting writer (Home Assistant grow lights); prod-only and hand-pinned. |
| `verdify-api` | 2 | verdify-api | Public and write API (`api.verdify.ai`). |
| `verdify-operator-api` | 1 | verdify-api | Operator API for the dashboard BFF. |
| `verdify-mcp` | 2 | verdify-mcp | MCP (`mcp.verdify.ai`). Uses the tokenless ServiceAccount `verdify-mcp` and NetworkPolicy `verdify-mcp-egress`. |
| `verdify-planner` | 1 | verdify-planner | Iris planner. |
| `verdify-cortex-planner` | 1 | verdify-ingestor | Cortex-backed planner path. |
| `experiment-v2-lifecycle`, `experiment-v2-selector`, `experiment-v2-freezer` | 1 each | verdify-experiment-v2-orchestrator | Experiment-v2 orchestrator; non-device. |
| `verdify-hermes-iris` | 1 | verdify-hermes-agent | Hermes agent; hand-pinned. |
| `verdify-grafana` | 1 | grafana 12.4.14 mirror + verdify-grafana-image-renderer | Product Grafana (`graphs.verdify.ai`); dashboards are generated from `grafana/dashboards/` (R13 product exception). |
| `verdify-grafana-render-cache` | 2 | nginx-unprivileged mirror | Render cache for public panels. |
| `verdify-lab`, `verdify-lab-cache-origin` | 2, 1 | nginx-unprivileged mirror (+ lab-publisher-k3s) | `lab.verdify.ai`/`labs.verdify.ai`; serves the validated Quartz cache PVC. |
| `verdify-outbound` | 2 | nginx-unprivileged mirror | Fixed-host egress relay (ConfigMap `verdify-outbound-config`). |
| `verdify-traefik` | 2 | traefik v3.7.17 mirror | Tier-2 app Traefik, limited to `verdify-prod`. |
| `verdify-mqtt` | 1 | eclipse-mosquitto 2 mirror | In-namespace MQTT. |
| `verdify-db-backup-exporter` | 1 | python 3.12-alpine mirror | Backup freshness metrics. |

### verdify-prod scheduled jobs

| CronJob | Schedule (UTC) | Image | Notes |
|---|---|---|---|
| `verdify-db-backup` | `17 2 * * *` | verdify-timescaledb | Logical dumps to PVC `verdify-db-dumps`. Restore: `docs/runbooks/db-backup-pair-restore.md`. |
| `verdify-band-curve-refresh` | `2,32 * * * *` | verdify-timescaledb | Materialized view refresh. |
| `verdify-fixed-panel-native-freezer` | `30 0 * * *` | verdify-timescaledb | |
| `verdify-greenhouse-brief` | `3-59/5 * * * *` | verdify-api | |
| `verdify-lab-publisher` | `5,35 * * * *` | verdify-lab-publisher-k3s | Lab content pipeline (`docs/runbooks/lab-content-pipeline.md`). |
| `verdify-vision` | `0 15,18,21,0 * * *` | verdify-ingestor | |
| `verdify-winter-feasibility` | `30 0 * * *` | verdify-api | Archive PVC `verdify-winter-feasibility-archive`. |
| `verdify-knowledge-embed` | suspended | verdify-ingestor | |
| `verdify-firmware-builder`, `verdify-firmware-flasher` | suspended (`0 0 31 2 *`) | cosign / ESPHome 2026.6.5 mirrors | Templates for the signed firmware path (`docs/runbooks/firmware-signed-artifacts.md`); run only as attended Jobs. |

Job `verdify-winter-archive-init` is a `BeforeHookCreation` Sync hook, recreated on every sync; it is not residue. The writer and DB watchdog CronJobs and `verdify-ha-gap-backfill` are no longer running.

### Other namespaces

| Workload | Namespace | Application | Notes |
|---|---|---|---|
| Deployment `verdify-dashboard-web` (1) | `verdify-dashboard` | `verdify-dashboard` | Web tier; digest pinned in `deploy/k8s/dashboard/kustomization.yaml`; runbook `docs/runbooks/dashboard.md`. |
| CronJob `descheduler` (`15 * * * *`) | `verdify-descheduler` | `verdify-descheduler` | descheduler v0.36.0 mirror; ClusterRole/ClusterRoleBinding `verdify-descheduler`. |

## Storage (verdify-prod PVCs)

| PVC | Class | Size | Notes |
|---|---|---:|---|
| `db-data-verdify-db-0` | longhorn-v1-workspace-rwo | 50Gi | Database data. Never prune it. |
| `verdify-db-dumps` | static NAS PV (storage-infra) | 100Gi | Dump custody. Never prune it. |
| `verdify-ingestor-state` | longhorn-v1-workspace-rwo | 2Gi | Ingestor spool and state. |
| `verdify-grafana-data` | longhorn-v1-workspace-rwo | 1Gi | |
| `verdify-hermes-iris-data-portable-20260801` | longhorn-v1-rebuildable-rwo | 5Gi | |
| `verdify-lab-site-cache` | longhorn-v1-rebuildable-rwo | 5Gi | RWO cohort with the lab publisher (`docs/runbooks/portable-stateful-recovery.md`). |
| `verdify-firmware-artifacts` | longhorn-v1-workspace-rwo | 5Gi | Signed firmware artifacts. |
| `verdify-winter-feasibility-archive` | longhorn-v1-workspace-rwo | 10Gi | |

StorageClasses, Longhorn, NAS shares and the static PV are owned by jvallery/storage-infra.

## Hostnames and routes

DNS, the Cloudflare tunnel and `traefik-apps` are owned by jvallery/network-infra (R2). The routes and backends below are this repo's (R3).

| Route (namespace) | Hosts | Backend |
|---|---|---|
| `verdify-tier1-forward` (verdify-prod, on traefik-apps) | every single-label `*.verdify.ai` host except the excluded ones (www, www-dev, proposals-hello, dashboard and others listed in the route) | `verdify-traefik` (tier 2) |
| `verdify-t2-api` | `api.verdify.ai` (camera paths rate-limited) | `verdify-api` |
| `verdify-t2-graphs` | `graphs.verdify.ai` | `verdify-grafana-render-cache`, `verdify-grafana` |
| `verdify-t2-lab` | `lab.verdify.ai`, `labs.verdify.ai` | `verdify-lab` |
| `verdify-t2-mcp`, `verdify-t2-mcp-tunnel`, `verdify-mcp-tunnel-forward` | `mcp.verdify.ai` `/mcp` | `verdify-mcp` |
| `verdify-dashboard-web` (verdify-dashboard, on traefik-apps) | `dashboard.verdify.ai` | `verdify-dashboard-web` |

The middlewares in `verdify-prod` are `verdify-api-inflight`, `verdify-api-rate-limit`, `verdify-camera-rate-limit`, `verdify-strip-client-headers` and `verdify-strip-identity-headers`.

## Policy, RBAC and cluster-scoped objects

- NetworkPolicies: 44 in `verdify-prod`, 4 in `verdify-dashboard` and 3 in `verdify-descheduler`, each delivered by that namespace's Application.
- PodDisruptionBudgets in `verdify-prod`: `verdify-api`, `verdify-grafana`, `verdify-grafana-render-cache`, `verdify-ingestor`, `verdify-lab`, `verdify-mcp`, `verdify-planner` and `verdify-traefik`.
- ServiceAccounts: `verdify-ingestor`, `verdify-mcp`, `verdify-outbound`, `verdify-traefik`, `verdify-dashboard-web` and `descheduler`. The Role and RoleBinding `verdify-ingestor-writer-lease` and the Role and RoleBinding `descheduler` are this repo's. The `kepler-estate-operations` Role and RoleBinding in each namespace belong to jvallery/kepler.
- PriorityClasses `verdify-batch` (1000), `verdify-serving` (100000), `verdify-data-critical` (800000000) and `verdify-device-writer` (900000000). They are cluster-scoped and owned here.

## Registered writers outside Argo (#1537, STD-IAC-01, README R21)

Argo (`verdify-prod-dark`, `verdify-dashboard`, `verdify-descheduler`) is the only writer of declared state in `verdify-prod`, `verdify-dashboard` and `verdify-descheduler`. Two writes are intended and registered here; managedFields on Argo-tracked objects may name only `argocd-controller`, cluster controllers (`k3s`, `kube-controller-manager`) and these two managers.

| Writer | Manager | What it writes | Source | Bound | Drift check |
|---|---|---|---|---|---|
| Firmware release Jobs (exception class) | `kubectl-create` | One-shot Jobs `fw-build-*`, `fw-verify-*`, `fw-flash-*` and the read-only `inspect` Pod, rendered from the Git-declared suspended CronJob templates `verdify-firmware-builder` and `verdify-firmware-flasher` (labels `app.kubernetes.io/component: firmware-builder` or `firmware-artifact-verifier`). They have no controller owner and are never Argo-tracked, because a sync must not re-apply a flash Job. | `scripts/firmware-release-job.py --submit` (procedure `docs/runbooks/firmware-signed-artifacts.md`) | `ttlSecondsAfterFinished: 172800` (48 h) from the templates; the release receipt keeps the audit record after the Job expires. A retained Job keeps its generated `verdify-firmware-release-tools-<hash>` ConfigMap mounted until it expires (#1536). | `kubectl -n verdify-prod get jobs -o name` shows no `fw-*` Job older than 48 h after completion. |
| Attended writer restarts | `kubectl-rollout` | Only `spec.template.metadata.annotations["kubectl.kubernetes.io/restartedAt"]` on `verdify-prod` Deployments, by `kubectl rollout restart` in an attended session (never on shared controllers). Git does not declare that field. | `docs/runbooks/k3s-operations.md` | One field per Deployment | managedFields entries for `kubectl-rollout` own no field other than that annotation. |

Every other manager found on these objects at T0 (`codex-ssa`, `kubectl`, `kubectl-client-side-apply`, `kubectl-patch`, `kubectl-annotate`, `kubectl-label`, `kubectl-create` on PVCs, `laptop-root`, `agent-verdify-hermes-cortex-mitigation`) is a stale past write, not a writer. #1537 removes each by exact target after confirming its fields match Git. `agent-fleet-sops-reconciler` on Secrets belongs to the central KSOPS lane that delivers those Secrets, not to this repo.

## Secrets (names only)

The values come from the central KSOPS lane in jvallery/agents (planned for jvallery/estate-platform). This repo owns the names and the key contract in [`deploy/k8s/SECRETS.md`](deploy/k8s/SECRETS.md), and never the values. Delivery comes from the live Argo tracking and reflector metadata on 2026-11-09.

| Namespace | Secret | Delivered by |
|---|---|---|
| verdify-prod | `ghcr-jvallery-readonly`, `verdify-agent-secrets`, `verdify-app-secrets`, `verdify-contact-turnstile`, `verdify-dashboard-runtime-db`, `verdify-embedding-cortex`, `verdify-experiment-v2-outcome-freezer-db`, `verdify-experiment-v2-randomizer-db`, `verdify-experiment-v2-selector-provider`, `verdify-experiment-v2-shadow-scheduler-db`, `verdify-firmware-ota`, `verdify-firmware-signing`, `verdify-firmware-wifi`, `verdify-frigate-vision-auth`, `verdify-grafana-oauth`, `verdify-grafana-runtime-db`, `verdify-grafana-secrets`, `verdify-ha-backfill-runtime-db`, `verdify-ha-token`, `verdify-hermes`, `verdify-lab-publisher-runtime-db`, `verdify-lab-publisher-s3`, `verdify-matview-refresh-runtime-db`, `verdify-mcp-agents`, `verdify-mcp-observer`, `verdify-mcp-runtime-db`, `verdify-operator-api`, `verdify-planner-cortex`, `verdify-planner-runtime-db`, `verdify-setpoint-server-runtime-db`, `verdify-vision-cortex`, `verdify-vision-key`, `verdify-vision-runtime-db`, `verdify-writer-watchdog-runtime-db` | `verdify-prod-secrets-local-prod` (central KSOPS) |
| verdify-prod, verdify-dashboard, verdify-descheduler | `zot-origin-cluster-pull` | reflector copy of the cluster pull credential (D-03) |
| verdify-dashboard | `verdify-dashboard-web` | `verdify-dashboard-secrets` (central KSOPS) |

## Devices and repositories

- The greenhouse ESP32 controller (ESPHome, `firmware/greenhouse.yaml`), its Modbus air and soil probes, and the two greenhouse Shelly Pro EM meters are used by this product. Their device-authority rows belong to jvallery/homeassistant (D-06), the hardware rows to jvallery/proxmox-infrastructure, and the IPs to network-infra IPAM. Firmware reaches the controller only through the signed path or `make firmware-deploy` (AGENTS.md).
- This repository is `jvallery/verdify-platform`. It moved from `VerdifyConsultancy/verdify-platform` on 2026-11-06, and older issue links under that name refer to this repository. `VerdifyConsultancy/verdify-agent-context`, `verdify-gravity` and `verdify-planner` are archived history.

## Open actions

Each action is tracked as a GitHub issue; the issue is canonical.

- Retire the `verdify-edge` namespace ([#1001](https://github.com/jvallery/verdify-platform/issues/1001)).
- `verdify-experiment-v2-selector-provider` is delivered but referenced by no manifest. Retire it in the central lane or wire a consumer.
- `verdify-writer-watchdog-runtime-db` outlived its CronJob. Retire it in the central lane once the monitoring-stack `verdify.writer-ownership` alerts are confirmed (R13).
- Keep this file in step with the central record and a fresh live readback whenever an Application, workload, Secret or route is added or retired.
