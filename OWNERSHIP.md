# OWNERSHIP: jvallery/verdify-platform

Item-level detail for the **Verdify greenhouse product** lane: what this repository owns, where it runs, and how it is delivered, with health and dependencies for each item.

- **Central record:** the owner of record for every item is [ESTATE-INVENTORY.md](https://github.com/jvallery/estate-platform/blob/main/docs/estate/ESTATE-INVENTORY.md). It is rendered from `ownership/record/` in `jvallery/estate-platform`, and this repo's owner page is [inventory/jvallery__verdify-platform.md](https://github.com/jvallery/estate-platform/blob/main/docs/estate/inventory/jvallery__verdify-platform.md). Where this file and the central record disagree, the central record wins (R1). To add, move or retire an item, change the central entry and this file in the same change set.
- **Basis of this version:** the rendered desired state of this repo after the climate refactor ([#1633](https://github.com/jvallery/verdify-platform/issues/1633)): Argo Applications, workloads, Secret names (never values), PVCs, routes, NetworkPolicies, RBAC and PriorityClasses, on the live read-only readbacks of 2026-11-09 and 2026-11-17 (Secret and workload names only) and the central owner page. Retired items and their records remain in this file's Git history.
- **Linked, not copied (R22):** device IPs and VLANs are in [network-infra `ipam/allocation.md`](https://github.com/jvallery/network-infra/blob/main/ipam/allocation.md). Hardware rows are in [proxmox-infrastructure `inventory/`](https://github.com/jvallery/proxmox-infrastructure/tree/main/inventory). Secret key contracts are in [`deploy/k8s/SECRETS.md`](deploy/k8s/SECRETS.md), and the Application and sync model is in [`ARGOCD.md`](ARGOCD.md).
- **Backlog:** GitHub issues in this repository ([#1556](https://github.com/jvallery/verdify-platform/issues/1556)).

## Argo CD Applications

The three Applications that sync this repository's paths are declared in jvallery/estate-platform `gitops/applications/local-prod/` (the catalog moved from jvallery/agents on 2026-11-15) and read this repository through the in-cluster git mirror.

| Application | Destination | Source | Sync |
|---|---|---|---|
| `verdify-prod-dark` | `verdify-prod` | `deploy/k8s/overlays/prod` @ `main` (in-cluster git mirror) | manual, prune off; the sync is the device-write gate, so the app is OutOfSync between syncs by design |
| `verdify-dashboard` | `verdify-dashboard` | `deploy/k8s/dashboard` @ `main` | automated, self-heal, prune off |
| `verdify-descheduler` | `verdify-descheduler` | `deploy/k8s/descheduler` @ an exact commit (read the live `targetRevision`) | manual, prune off |

Three other Applications deliver into these namespaces, not owned by this repo: `verdify-prod-secrets-local-prod` and `verdify-dashboard-secrets` (central KSOPS Secret values, sourced from jvallery/agents `platform/gitops/secrets-ksops/`), and `verdify-tenant-bounds` (quota and limits in `verdify-descheduler`). Their declarations are in jvallery/estate-platform as well.

## Namespaces

| Namespace | State | Source | Notes |
|---|---|---|---|
| `verdify-prod` | running | `deploy/k8s/overlays/prod` | The only product environment. `verdify-db` is the only database, and the ingestor is the only device writer. |
| `verdify-dashboard` | running | `deploy/k8s/dashboard` | The dashboard web tier (BFF) behind `dashboard.verdify.ai`; Pod Security restricted. |
| `verdify-descheduler` | running | `deploy/k8s/descheduler` | Hourly descheduler (#802). |

`verdify-db-rehearsal` is retired (#992); its bucket and keys are storage-infra custody. Namespace `verdify-platform` belongs to jvallery/agents.

## Workloads

All rows below are delivered by `verdify-prod-dark` unless the row names another Application. Images come from `registry.vallery.net` and every container is pinned by digest. Release pins are in `deploy/k8s/overlays/prod/release-pins.yaml` and `kustomization.yaml`.

### verdify-prod Deployments and StatefulSet

| Workload | Replicas | Image | Role and hazards |
|---|---:|---|---|
| StatefulSet `verdify-db` | 1 | verdify-timescaledb | The only database (TimescaleDB, PG16). Never prune it or its PVC. Repinning it restarts the database and is an attended release. |
| `verdify-ingestor` | 1 | verdify-ingestor | **Only ESP32 writer**: `strategy: Recreate` and `VERDIFY_DEVICE_WRITE_ENABLED=1`. Holds the writer Lease (Role/RoleBinding `verdify-ingestor-writer-lease`). Pushes the band, the drying cost limit, the operator switches, lighting values and irrigation programs and confirms each by readback; stores telemetry, relay events and counters, the controller's health and its replayed gap log; writes the daily record; wakes the daily review. |
| `verdify-setpoint-server` | 1 | verdify-setpoint-server | Second device-affecting writer (Home Assistant grow lights); prod-only and hand-pinned. |
| `verdify-api` | 2 | verdify-api | Public and write API (`api.verdify.ai`). |
| `verdify-operator-api` | 1 | verdify-api | Operator API for the dashboard BFF. Also the one product metrics exposure point, `/metrics`, refreshed on a timer and scraped by monitoring-stack job `verdify-operator-api` (NetworkPolicy `allow-operator-api-metrics-scrape`). |
| `verdify-mcp` | 2 | verdify-mcp | MCP (`mcp.verdify.ai`). Uses the tokenless ServiceAccount `verdify-mcp` and NetworkPolicy `verdify-mcp-egress`. |
| `verdify-hermes-iris` | 1 | verdify-hermes-agent | Iris, the daily reviewer: woken once a day by the ingestor and on an admin request; reads the daily record and writes one row to `planner_review`. No climate write; it keeps its irrigation tools. Hand-pinned. |
| `verdify-grafana` | 1 | grafana 12.4.14 mirror + verdify-grafana-image-renderer | Product Grafana (`graphs.verdify.ai`); dashboards are generated from `grafana/dashboards/` (R13 product exception). Version policy (D-325): this instance pins its own Grafana version by digest and upgrades it here on its own schedule; no version parity with the estate Grafana applies. |
| `verdify-grafana-render-cache` | 2 | nginx-unprivileged mirror | Render cache for public panels. |
| `verdify-lab`, `verdify-lab-cache-origin` | 2, 1 | nginx-unprivileged mirror (+ lab-publisher-k3s) | `lab.verdify.ai`/`labs.verdify.ai`; serves the validated Quartz cache PVC. |
| `verdify-outbound` | 2 | nginx-unprivileged mirror | Fixed-host egress relay (ConfigMap `verdify-outbound-config`). |
| `verdify-traefik` | 2 | traefik v3.7.17 mirror | Tier-2 app Traefik, limited to `verdify-prod`. |
| `verdify-mqtt` | 1 | eclipse-mosquitto 2 mirror | In-namespace MQTT. |
| `verdify-db-exporter` | 1 | postgres-exporter v0.19.1 mirror (zot custody) | Store metrics for `verdify-db` (STD-OBS-27, [monitoring-stack#1597](https://github.com/jvallery/monitoring-stack/issues/1597)): a standalone Deployment (no DB restart) reading as user `verdify` with `verdify-app-secrets` by reference; Service `verdify-db-exporter:9187`, scraped by monitoring-stack job `app-postgres-exporter`. |

### verdify-prod scheduled jobs

| CronJob | Schedule (UTC) | Image | Notes |
|---|---|---|---|
| `verdify-db-backup` | `17 2 * * *` | verdify-timescaledb | Logical dumps to PVC `verdify-db-dumps`. Restore: `docs/runbooks/db-backup-pair-restore.md`. |
| `verdify-band-curve-refresh` | `2,32 * * * *` | verdify-timescaledb | Materialized view refresh (`mv_band_curve`) and the daily record store for today and the two days before (`fn_refresh_daily_record`), as login `verdify_matview_refresh_runtime_login`. |
| `verdify-greenhouse-brief` | `3-59/5 * * * *` | verdify-api | The dashboard's greenhouse snapshot. |
| `verdify-lab-publisher` | `5,35 * * * *` | verdify-lab-publisher-k3s | Lab content pipeline (`docs/runbooks/lab-content-pipeline.md`). |
| `verdify-vision` | `0 15,18,21,0 * * *` | verdify-ingestor | Plant vision. |
| `verdify-knowledge-embed` | suspended | verdify-ingestor | |
| `verdify-firmware-builder`, `verdify-firmware-flasher` | suspended (`0 0 31 2 *`) | cosign / ESPHome 2026.6.5 mirrors | Templates for the signed firmware path (`docs/runbooks/firmware-signed-artifacts.md`); run only as attended Jobs. |

PreSync hook Jobs in `verdify-prod`, recreated by every full sync: `verdify-migrate` (the ledgered migrations), `verdify-runtime-role-bootstrap`, `verdify-mcp-runtime-role-bootstrap`, `verdify-six-runtime-role-bootstrap`, `verdify-maintenance-runtime-role-bootstrap` and `verdify-experiment-v2-credential-bootstrap` (it installs only the equipment-source collector login).

### Other namespaces

| Workload | Namespace | Application | Notes |
|---|---|---|---|
| Deployment `verdify-dashboard-web` (1) | `verdify-dashboard` | `verdify-dashboard` | Web tier; digest pinned in `deploy/k8s/dashboard/kustomization.yaml`; runbook `docs/runbooks/dashboard.md`. |
| CronJob `descheduler` (`15 * * * *`) | `verdify-descheduler` | `verdify-descheduler` | descheduler v0.36.0 mirror; Role/RoleBinding `descheduler`. The cluster-scoped ClusterRole/ClusterRoleBinding `verdify-descheduler` belong to the fleet control plane. |

## Storage (verdify-prod PVCs)

| PVC | Class | Size | Notes |
|---|---|---:|---|
| `db-data-verdify-db-0` | longhorn-v1-workspace-rwo | 50Gi | Database data. Never prune it. |
| `verdify-db-dumps` | static NAS PV (storage-infra) | 100Gi | Dump custody: the nightly pairs and, under `archive/`, the archives of dropped history. Never prune it. |
| `verdify-ingestor-state` | longhorn-v1-workspace-rwo | 2Gi | Ingestor spool and state. |
| `verdify-grafana-data` | longhorn-v1-workspace-rwo | 1Gi | |
| `verdify-hermes-iris-data-portable-20260801` | longhorn-v1-rebuildable-rwo | 5Gi | |
| `verdify-lab-site-cache` | longhorn-v1-rebuildable-rwo | 5Gi | RWO cohort with the lab publisher (`docs/runbooks/portable-stateful-recovery.md`). |
| `verdify-firmware-artifacts` | longhorn-v1-workspace-rwo | 5Gi | Signed firmware artifacts. |
| `verdify-winter-feasibility-archive` | longhorn-v1-workspace-rwo | 10Gi | Day files of the winter feasibility study (#1634), last written 2026-11-14; no workload mounts it. Kept until the owner decides; `Prune=false,Delete=false`. |

StorageClasses, Longhorn, NAS shares and the static PV are owned by jvallery/storage-infra.

## Database records of the climate law (`verdify-db`)

The climate refactor ([#1633](https://github.com/jvallery/verdify-platform/issues/1633)) moved climate decisions onto the controller. The host keeps these records of it; each is written by the ingestor unless the row says otherwise.

| Record | Where | Written | Health and dependencies |
|---|---|---|---|
| Law state | `system_state` entity `climate_law_state` (compact JSON: the law's outputs and the band it used) | every receipt: a 60 s heartbeat and every change | Alert `law_state_stale` (no row while the controller is connected). Needs a law build on the controller and the ingestor connected. |
| Drying meter | `system_state` entity `climate_drying_meter` (lifetime seconds, water, heat) | on change | Alert `drying_meter_fault`. |
| Constants hash | `system_state` entity `climate_law_constants` | hourly | Alert `law_constants_mismatch` when it differs from the released `verdify_schemas/climate_law.yaml`. |
| Relay counters | `system_state` entity `relay_counters` (lifetime starts and fan run seconds) | on change | A check only; the stored relay events stay the source. `v_relay_counter_reconciliation_daily` (migration 315) compares the two per day; alert `relay_counter_mismatch`. |
| Daily record | `daily_record`, `daily_relay_record` (migration 310): cycles, run time, utilities, drying, compliance | `verdify-band-curve-refresh` CronJob (`fn_refresh_daily_record`) | Metric `verdify_daily_record_complete`. Read by the dashboard, the daily review and the product metrics. |
| Gap replay ledger | `gap_replay_quarters` (migration 314) and view `v_data_gaps_unreplayed`; the gap readers `v_data_trust_ledger` and `v_irrigation_day_coverage` read the view (migration 315) | after each reconnect, from the controller's gap log | Metrics `verdify_controller_gap_log_armed`, `verdify_controller_gap_log_state`; monitoring-stack alert `VerdifyControllerGapLogNotArmed`. |
| Controller health | `diagnostics` health columns: minute heap and largest-block lows, loop and NVS write worst times, NVS entries, restart count, degraded sensors and gap-log state (migration 314); loop stack high water, WiFi disconnects and API clients (migration 315) | each diagnostics row | monitoring-stack group `verdify.controller-health`. |
| Daily review | `planner_review` (migration 313), one row per review | the ingestor requests it after 07:00 local; Iris writes it through MCP `review_write` | Alerts `daily_review_missed` and `reviewer_wrote_climate`. |

Retired by the program: the plan cycle (Iris no longer writes plans; every `setpoint_plan` row is inactive), the settings cascade and the tunables the law replaced. Migration 309 (the one-band change) dropped the GPU power, OpenClaw and zone-band grading objects; migration 316 dropped the confirmed-component experiment v2 (40 tables, its views, 113 functions and 11 roles), the policy twin (three empty hypertables and two read roles), the planner graph and memory tables, `planner_pack` and `forecast_deviation_thresholds`, and revoked the MCP write on `setpoint_plan`. Each drop is archived first (below). The 48-slot policy wire layout stays frozen with 43 reserved slots until the next firmware change.

### Archive of dropped history

Before each drop migration a one-shot Job, `verdify-phase4-archive-<migration>` (attended, not in the render; the image and pod settings of `verdify-db-backup`), writes every dropped table, view, function and role definition to PVC `verdify-db-dumps` under `archive/phase4-drops-<migration>-<UTC date>/` with `counts.tsv` and `MANIFEST.sha256`; a second Job verifies it, and the drop migration refuses unless the live row counts still equal the archived ones. The nightly prune does not touch that subdirectory. Retention (two years) and the offsite copy are jvallery/storage-infra's ([jvallery/storage-infra#1935](https://github.com/jvallery/storage-infra/issues/1935)). Restore: schema then data from the archive, by a new numbered migration or a recorded hand restore; the nightly backup pair is the second copy.

## Alerts and metrics

- The ingestor's alert monitor (`ingestor/tasks/alerts.py`, `ingestor/tasks/coverage_alerts.py`) raises `alert_log` rows: the law and record alerts above, plus `sensor_fault`, `clock_unconfirmed`, `heat_no_power`, `setpoint_delivery_stuck`, `payload_rejected` and the irrigation and sensor alerts. The dashboard shows them; critical rows page through monitoring-stack `VerdifyGreenhouseAlertOpen` (group `verdify.greenhouse-alerts`, which also holds `VerdifyAlertFeedDown`).
- The product metrics are exposed at one point, the operator API's `/metrics` (`api/product_metrics.py`; controller health, law state, relays, utilities, meters, the daily record, table freshness and the refresh itself), scraped by monitoring-stack job `verdify-operator-api`. Rule group `verdify.controller-health` (monitoring-stack) alerts on them, including `VerdifyIngestorRestarted`, `VerdifyIngestorRowsRejected` and `VerdifyProductMetricsStale`.
- Writer and database liveness: monitoring-stack `verdify.writer-ownership`; store metrics: `verdify-db-exporter`.

## Hostnames and routes

DNS, the Cloudflare tunnel and `traefik-apps` are owned by jvallery/network-infra (R2). The routes and backends below are this repo's (R3).

| Route (namespace) | Hosts | Backend |
|---|---|---|
| `verdify-tier1-forward` (verdify-prod, on traefik-apps) | every single-label `*.verdify.ai` host except the excluded ones (www, www-dev, proposals-hello, dashboard and others listed in the route); api, lab, labs and mcp take the shared `network-infra/baseline-headers-app-csp` (HSTS) on a priority-60 rule | `verdify-traefik` (tier 2) |
| `verdify-t2-api` | `api.verdify.ai` (camera paths rate-limited) | `verdify-api` |
| `verdify-t2-api-tunnel`, `verdify-api-tunnel-forward` (tunnelclient, on traefik-apps) | `api.verdify.ai` from the Cloudflare tunnel, rate-limited per `Cf-Connecting-Ip` | `verdify-api` |
| `verdify-t2-graphs` | `graphs.verdify.ai` | `verdify-grafana-render-cache`, `verdify-grafana` |
| `verdify-t2-lab` | `lab.verdify.ai`, `labs.verdify.ai` | `verdify-lab` |
| `verdify-t2-mcp`, `verdify-t2-mcp-tunnel`, `verdify-mcp-tunnel-forward` | `mcp.verdify.ai` `/mcp` | `verdify-mcp` |
| `verdify-dashboard-web` (verdify-dashboard, on traefik-apps) | `dashboard.verdify.ai` | `verdify-dashboard-web` |

The middlewares in `verdify-prod` are `verdify-api-inflight`, `verdify-api-rate-limit`, `verdify-api-rate-limit-tunnel`, `verdify-camera-rate-limit`, `verdify-camera-rate-limit-tunnel`, `verdify-strip-client-headers` and `verdify-strip-identity-headers`.

## Policy, RBAC and cluster-scoped objects

- NetworkPolicies: 40 in `verdify-prod`, 4 in `verdify-dashboard` and 3 in `verdify-descheduler`, each delivered by that namespace's Application.
- PodDisruptionBudgets in `verdify-prod`: `verdify-api`, `verdify-grafana`, `verdify-grafana-render-cache`, `verdify-ingestor`, `verdify-lab`, `verdify-mcp` and `verdify-traefik`.
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

The values come from the central KSOPS lane in jvallery/agents (planned for jvallery/estate-platform). This repo owns the names and the key contract in [`deploy/k8s/SECRETS.md`](deploy/k8s/SECRETS.md), and never the values. Every Secret below is read by a workload or hook in this repo's render.

| Namespace | Secret | Delivered by |
|---|---|---|
| verdify-prod | `ghcr-jvallery-readonly`, `verdify-app-secrets`, `verdify-contact-turnstile`, `verdify-dashboard-runtime-db`, `verdify-embedding-cortex`, `verdify-firmware-ota`, `verdify-firmware-signing`, `verdify-firmware-wifi`, `verdify-frigate-vision-auth`, `verdify-grafana-oauth`, `verdify-grafana-runtime-db`, `verdify-grafana-secrets`, `verdify-ha-token`, `verdify-hermes`, `verdify-hydro-probe` (optional mount), `verdify-lab-publisher-runtime-db`, `verdify-lab-publisher-s3`, `verdify-matview-refresh-runtime-db`, `verdify-mcp-agents`, `verdify-mcp-observer`, `verdify-mcp-runtime-db`, `verdify-operator-api`, `verdify-planner-cortex`, `verdify-planner-runtime-db`, `verdify-setpoint-server-runtime-db`, `verdify-vision-cortex`, `verdify-vision-runtime-db` | `verdify-prod-secrets-local-prod` (central KSOPS) |
| verdify-prod, verdify-dashboard, verdify-descheduler | `zot-origin-cluster-pull` | reflector copy of the cluster pull credential (D-03) |
| verdify-dashboard | `verdify-dashboard-web` | `verdify-dashboard-secrets` (central KSOPS) |

## Devices and repositories

- The greenhouse ESP32 controller (ESPHome, `firmware/greenhouse.yaml`), its Modbus air and soil probes, and the two greenhouse Shelly Pro EM meters are used by this product. Their device-authority rows belong to jvallery/homeassistant (D-06), the hardware rows to jvallery/proxmox-infrastructure, and the IPs to network-infra IPAM. Firmware reaches the controller only through the signed path or `make firmware-deploy` (AGENTS.md).
- This repository is `jvallery/verdify-platform`. It moved from `VerdifyConsultancy/verdify-platform` on 2026-11-06, and older issue links under that name refer to this repository. `VerdifyConsultancy/verdify-agent-context`, `verdify-gravity` and `verdify-planner` are archived history.

## Open actions

Each action is tracked as a GitHub issue; the issue is canonical.

- `ghcr-jvallery-readonly` and `verdify-vision-key` were retired in the central lane (jvallery/agents#7013) and are absent live. `ghcr-jvallery-readonly` is still named in the `imagePullSecrets` of StatefulSet `verdify-db` (every image is pulled from the zot origin); the hunk that removes it restarts the database, so it ships with the next attended `verdify-timescaledb` release ([#1543](https://github.com/jvallery/verdify-platform/issues/1543)).
- Live Secrets with no reader in the render: `verdify-agent-secrets`, `verdify-experiment-v2-outcome-freezer-db`, `verdify-experiment-v2-randomizer-db`, `verdify-experiment-v2-shadow-scheduler-db`, `verdify-ha-backfill-runtime-db` and `verdify-writer-watchdog-runtime-db`. Retire them in the central lane and the central record; the logins behind the runtime-db ones go with a later drop.
- After the release 4 sync, delete the ConfigMaps `verdify-ingestor-gather-script` and `verdify-release-pins-hdhgg58gc4` by exact name (prune is off; never the fixed-name `verdify-release-pins`).
- `verdify-planner-runtime-db` is read only by the six-runtime-role bootstrap, which installs the planner login. It goes with the drop of the planner roles (drop package 4.5, group 1B, [#1695](https://github.com/jvallery/verdify-platform/issues/1695)), whose release edits the bootstrap; the central lane retires the Secret after that sync.
- The drop group 1C (the experiment tables behind embedded panels of the public site, about 3.1 GB) waits for the site sprint, as do the plan and forecast tables plan section 8.10 holds back.
- PVC `verdify-winter-feasibility-archive` is kept until the owner decides on the day files.
- Keep this file in step with the central record and a fresh live readback whenever an Application, workload, Secret or route is added or retired.
