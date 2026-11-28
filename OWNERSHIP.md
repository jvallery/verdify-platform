# OWNERSHIP: jvallery/verdify-platform

Everything this repository owns, as listed in the estate ownership record in jvallery/estate-platform (`ownership/record/`). This file is a copy of the rendered page [docs/estate/inventory/jvallery__verdify-platform.md](https://github.com/jvallery/estate-platform/blob/main/docs/estate/inventory/jvallery__verdify-platform.md); the record is the authority.

When an item is added, moved or retired, change its row in the record, run `python3 ownership/render.py` there, and copy the rendered tables here in the same piece of work. How each item is built, deployed and checked is in [AGENTS.md](AGENTS.md).

## argo-app

| Id | Name | Summary | Location | State | Status | Renders for |
| --- | --- | --- | --- | --- | --- | --- |
| `argo-app:argocd/verdify-db-rehearsal-cluster` | verdify-db-rehearsal-cluster | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | k3s vallery ns argocd -> dest ns verdify-db-rehearsal | retired | `owned` | `jvallery/verdify-platform` |
| `argo-app:argocd/verdify-db-rehearsal-namespace` | verdify-db-rehearsal-namespace | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | k3s vallery ns argocd -> dest ns verdify-db-rehearsal | retired | `owned` | `jvallery/verdify-platform` |

## cluster-object

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `cluster-object:priorityclass/verdify-batch` | verdify-batch | PriorityClass value 1000, globalDefault False. | k3s vallery (cluster-scoped) | running | `owned` |
| `cluster-object:priorityclass/verdify-data-critical` | verdify-data-critical | PriorityClass value 800000000, globalDefault False. | k3s vallery (cluster-scoped) | running | `owned` |
| `cluster-object:priorityclass/verdify-device-writer` | verdify-device-writer | PriorityClass value 900000000, globalDefault False. | k3s vallery (cluster-scoped) | running | `owned` |
| `cluster-object:priorityclass/verdify-serving` | verdify-serving | PriorityClass value 100000, globalDefault False. | k3s vallery (cluster-scoped) | running | `owned` |
| `cluster-object:rbac/live-verdify-agent` | ClusterRoles/Bindings: live:verdify-agent | verdify-agent-cluster-readonly role+binding (seen only in 2026-06-07 audit inventory). 2 objects: Cluster:verdify-agent-cluster-readonly, Cluster:verdify-agent… | k3s vallery (cluster-scoped RBAC) | retired | `owned` |
| `cluster-object:verdify-db-rehearsal/barman-objectstore/verdify-cnpg-pitr-reader` | verdify-cnpg-pitr-reader | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | k8s ns verdify-db-rehearsal (barmancloud.cnpg.io ObjectStore) | retired | `owned` |
| `cluster-object:verdify-db-rehearsal/barman-objectstore/verdify-cnpg-rehearsal-backup` | verdify-cnpg-rehearsal-backup | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | k8s ns verdify-db-rehearsal (barmancloud.cnpg.io ObjectStore) | retired | `owned` |
| `cluster-object:verdify-db-rehearsal/networkpolicies-residue` | protected historical runtime policies in verdify-db-rehearsal (2) | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | k8s ns verdify-db-rehearsal | retired | `owned` |
| `cluster-object:verdify-prod/mcp-runtime-boundary` | verdify-mcp ServiceAccount and verdify-mcp-egress NetworkPolicy | Source-owned MCP tokenless identity and DNS/DB/public-IPv4-TLS boundary; no RBAC grant. Public TLS is not hostname enforcement; live acceptance tracked by #1011. | k8s ns verdify-prod | desired | `owned` |
| `cluster-object:verdify-prod/networkpolicies-hand-applied` | hand-applied NetworkPolicies in verdify-prod (1) | Restore-to-DB ingress allow-db-from-restore adopted with identical live spec; preserves db-restore selector and TCP5432. | k8s ns verdify-prod | running | `owned` |
| `cluster-object:verdify-prod/networkpolicies-residue` | hand-created qualification NetworkPolicies in verdify-prod (36) | All 36 exact inactive qualification policies were UID/version guarded and removed under Verdify #990; no active workload selector matched. | k8s ns verdify-prod | retired | `owned` |
| `middleware:verdify-prod/aggregate` | verdify-prod trivial middlewares (1) | Traefik headers/redirect/rateLimit/ipAllowList middlewares: verdify-strip-identity-headers(headers) | k8s ns verdify-prod | running | `owned` |

## cluster-scoped

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `cluster:priorityclass/verdifyconsultancy/verdify-platform` | PriorityClass owned by jvallery/verdify-platform | 4 objects |  |  | `owned` |

## configmap

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `configmap:verdify-prod/verdify-outbound-config` | verdify-outbound-config | Fixed-host OpenAI embeddings, Slack postMessage and Open-Meteo relay; product issues 1011/1022. | k8s ns verdify-prod | running | `owned` |

## deployment

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `deployment:verdify-prod/verdify-outbound` | verdify-outbound | Fixed-host OpenAI embeddings, Slack postMessage and Open-Meteo relay; product issues 1011/1022. | k8s ns verdify-prod | running | `owned` |

## endpoint

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `endpoint:api.verdify.ai` | api.verdify.ai | Hostname api.verdify.ai: backend owner jvallery/verdify-platform, route owner jvallery/verdify-platform, DNS owner jvallery/network-infra (… | verdify-prod/verdify-t2-api | running | `owned` |
| `endpoint:dashboard.verdify.ai` | dashboard.verdify.ai | Hostname dashboard.verdify.ai: backend owner jvallery/verdify-platform, route owner jvallery/verdify-platform, DNS owner jvallery/network-infra. The operator dashboard web tier, behind Authentik native OIDC (application verdify-dashboard, verdify-platform#1143): IngressRoute verdify-dashboard/verdify-dashboard-web, public via the proxied *.verdify.ai wildcard (302 to /auth/login), LAN record on both Pi-holes (network-infra#933). | verdify-dashboard/verdify-dashboard-web | running | `owned` |
| `endpoint:graphs.verdify.ai` | graphs.verdify.ai | Hostname graphs.verdify.ai: backend owner jvallery/verdify-platform, route owner jvallery/verdify-platform, DNS owner jvallery/network-infr… | verdify-prod/verdify-t2-graphs | running | `owned` |
| `endpoint:lab.verdify.ai` | lab.verdify.ai | Hostname lab.verdify.ai: backend owner jvallery/verdify-platform, route owner jvallery/verdify-platform, DNS owner jvallery/network-infra (… | verdify-prod/verdify-t2-lab | running | `owned` |
| `endpoint:labs.verdify.ai` | labs.verdify.ai | Hostname labs.verdify.ai: backend owner jvallery/verdify-platform, route owner jvallery/verdify-platform, DNS owner jvallery/network-infra … | verdify-prod/verdify-t2-lab | running | `owned` |
| `endpoint:mcp.verdify.ai` | mcp.verdify.ai | Hostname mcp.verdify.ai: backend owner jvallery/verdify-platform, route owner jvallery/verdify-platform, DNS owner jvallery/network-infra (… | verdify-prod/verdify-t2-mcp | running | `owned` |

## k8s-workload

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `k8s-workload:verdify-dashboard/deployment/verdify-dashboard-web` | verdify-dashboard-web | Deployment verdify-dashboard-web in namespace verdify-dashboard, declared in deploy/k8s/dashboard/deployment.yaml. | namespace verdify-dashboard | running | `owned` |
| `k8s-workload:verdify-db-rehearsal/cluster/verdify-cnpg-s2-integration` | verdify-cnpg-s2-integration | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | k3s vallery / verdify-db-rehearsal | retired | `owned` |
| `k8s-workload:verdify-db-rehearsal/deployment/verdify-s2-grafana-proof` | verdify-s2-grafana-proof | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | k3s vallery / verdify-db-rehearsal | retired | `owned` |
| `k8s-workload:verdify-db-rehearsal/job/adhoc-kubectl-jobs` | verdify-db-rehearsal ad-hoc kubectl Jobs (81) | Exact non-data targets removed under Verdify #991 after private evidence preservation, UID/version dry-runs and absent readback; all database/PVC objects retained. | k3s vallery / verdify-db-rehearsal | retired | `owned` |
| `k8s-workload:verdify-db-rehearsal/pod/standalone-pods` | verdify-db-rehearsal standalone Pods (6) | Exact non-data targets removed under Verdify #991 after private evidence preservation, UID/version dry-runs and absent readback; all database/PVC objects retained. | k3s vallery / verdify-db-rehearsal | retired | `owned` |
| `k8s-workload:verdify-descheduler/cronjob/descheduler` | descheduler | CronJob descheduler in verdify-descheduler running descheduler:v0.36.0. | k3s vallery / verdify-descheduler | running | `owned` |
| `k8s-workload:verdify-prod/cronjob/verdify-band-curve-refresh` | verdify-band-curve-refresh | CronJob verdify-band-curve-refresh in verdify-prod running timescaledb:2.25.2-pg16. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/cronjob/verdify-db-backup` | verdify-db-backup | Verdify production DB dump. Target: pv:verdify-db-dumps-prod (/volume2/verdify). | verdify-prod (17 2 * * *) | running | `owned` |
| `k8s-workload:verdify-prod/cronjob/verdify-db-restore-drill` | verdify-db-restore-drill | CronJob verdify-db-restore-drill in verdify-prod (scheduled database restore drill), tracked by Argo app verdify-prod-dark. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/cronjob/verdify-db-watchdog` | verdify-db-watchdog | Retired under Verdify #998 after both production Prometheus collectors verified writer/DB replacement alerts. Exact CronJob and dedicated SA/Role/Binding absent; completed Jobs, credentials and data retained. | k3s vallery / verdify-prod | retired | `owned` |
| `k8s-workload:verdify-prod/cronjob/verdify-firmware-builder` | verdify-firmware-builder | Suspended exact-SHA firmware compile/archive/sign template; ESPHome build init has no device egress and only the separate signer container mounts the signing key. Non-Argo writer (verdify-platform#1537): scripts/firmware-release-job.py --submit creates one-shot fw-* Jobs from this template (manager kubectl-create), ttlSecondsAfterFinished 172800, never Argo-tracked; the release receipt keeps the audit record. | k3s vallery / verdify-prod | idle | `owned` |
| `k8s-workload:verdify-prod/cronjob/verdify-firmware-flasher` | verdify-firmware-flasher | Suspended reviewed-artifact verifier/flasher. Default verifies only; pinned key and manifest digest required before optional attended OTA. Non-Argo writer (verdify-platform#1537): scripts/firmware-release-job.py --submit creates one-shot fw-* Jobs from this template (manager kubectl-create), ttlSecondsAfterFinished 172800, never Argo-tracked; the release receipt keeps the audit record. | k3s vallery / verdify-prod | idle | `owned` |
| `k8s-workload:verdify-prod/cronjob/verdify-greenhouse-brief` | verdify-greenhouse-brief | CronJob verdify-greenhouse-brief in namespace verdify-prod, declared in deploy/k8s/components/greenhouse-brief/cronjob.yaml. | verdify-prod (3-59/5 * * * *) | running | `owned` |
| `k8s-workload:verdify-prod/cronjob/verdify-knowledge-embed` | verdify-knowledge-embed | CronJob verdify-knowledge-embed in namespace verdify-prod, declared in deploy/k8s/components/knowledge-embed/knowledge-embed.yaml. | verdify-prod (17 10 * * *) | running | `owned` |
| `k8s-workload:verdify-prod/cronjob/verdify-lab-publisher` | verdify-lab-publisher | CronJob verdify-lab-publisher in verdify-prod running verdify-lab-publisher-k3s. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/cronjob/verdify-vision` | verdify-vision | CronJob verdify-vision in verdify-prod running verdify-ingestor. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/cronjob/verdify-writer-watchdog` | verdify-writer-watchdog | Retired under Verdify #998 after both production Prometheus collectors verified writer/DB replacement alerts. Exact CronJob and dedicated SA/Role/Binding absent; completed Jobs, credentials and data retained. | k3s vallery / verdify-prod | retired | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-api` | verdify-api | Verdify API and approved saved-public-panel adapter; renderer token only (no Grafana admin credential); source declared in platform PR 1018. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-db-backup-exporter` | verdify-db-backup-exporter (removed 2026-11-14, historical) | Retired Deployment verdify-db-backup-exporter (NFS-mounting backup freshness exporter) in verdify-prod; removed by verdify-platform#1590 (2026-11-14), NotFound live 2026-11-16; freshness now comes from kube-state-metrics CronJob records. Its scrape job was retired by monitoring-stack#1928. | k3s vallery / verdify-prod | retired | `retire` |
| `k8s-workload:verdify-prod/deployment/verdify-db-exporter` | verdify-db-exporter | Deployment verdify-prod/verdify-db-exporter; replicas 1; images: quay.io/prometheuscommunity/postgres-exporter:v0.19.1 (zot origin custody copy). Store exporter for verdify-db, scraped by monitoring-stack job app-postgres-exporter (monitoring-stack#1597). | k3s vallery / verdify-prod | declared-not-deployed | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-grafana` | verdify-grafana | Deployment verdify-grafana in verdify-prod running grafana-image-renderer:v5.10.0, grafana:12.4.5. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-grafana-render-cache` | verdify-grafana-render-cache | Deployment verdify-grafana-render-cache in verdify-prod running nginx-unprivileged:1.29-alpine. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-hermes-iris` | verdify-hermes-iris | Deployment verdify-hermes-iris in verdify-prod running hermes-agent. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-ingestor` | verdify-ingestor | Deployment verdify-ingestor in verdify-prod running postgres:16, timescaledb:2.25.2-pg16, verdify-ingestor. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-lab` | verdify-lab | Two ready Lab serving pods on distinct nodes, each using a validated private emptyDir cache and tokenless refresh sidecar; sequential public-edge pod recovery verified under #1005. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-lab-cache-origin` | verdify-lab-cache-origin | Private tokenless read-only Lab origin deployed at f5214011 under #1005; public serving pods use independent validated caches on distinct nodes. Retained publisher RWO claim; no public route or credentials. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-mcp` | verdify-mcp | Deployment verdify-mcp in verdify-prod running verdify-mcp. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-mqtt` | verdify-mqtt | Deployment verdify-mqtt in verdify-prod running eclipse-mosquitto:2. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-operator-api` | verdify-operator-api | Verdify operator API behind the dashboard BFF (the verdify-api image, uvicorn operator_api:app on 8090, ClusterIP only, no IngressRoute); deploy/k8s/components/operator-api (verdify-platform#1148), wired into overlays/prod (verdify-platform#1143). | k3s vallery / verdify-prod | declared-not-deployed | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-setpoint-server` | verdify-setpoint-server | Deployment verdify-setpoint-server in verdify-prod running timescaledb:2.25.2-pg16, verdify-setpoint-server. | k3s vallery / verdify-prod | running | `owned` |
| `k8s-workload:verdify-prod/deployment/verdify-traefik` | verdify-traefik | Tokenless two-replica app-scoped Traefik file provider. Git-generated HTTP routing via a content-hashed ConfigMap; no Kubernetes provider, API token or Role/Binding (#1006). | k8s ns verdify-prod (2 replicas) | running | `owned` |
| `k8s-workload:verdify-prod/job/adhoc-kubectl-jobs` | verdify-prod ad-hoc kubectl Jobs (44) | All 44 exact inactive standalone Jobs were UID/version guarded and removed under Verdify #990; recovery retained privately, metadata-only receipt in source. | k3s vallery / verdify-prod | retired | `owned` |
| `k8s-workload:verdify-prod/statefulset/verdify-db` | verdify-db | StatefulSet verdify-db in verdify-prod running timescaledb:2.25.2-pg16. | k3s vallery / verdify-prod | running | `owned` |

## namespace

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `namespace:verdify-dashboard` | verdify-dashboard | dashboard.verdify.ai web tier (Deployment verdify-dashboard-web, the BFF); rendered with Pod Security restricted by deploy/k8s/dashboard and synced by Argo app verdify-dashboard. | k3s vallery | running | `owned` |
| `namespace:verdify-db-rehearsal` | verdify-db-rehearsal | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | k3s vallery | retired | `owned` |
| `namespace:verdify-descheduler` | verdify-descheduler | Existing descheduler namespace adopted in place with unchanged labels and deletion protection; Verdify platform | k3s vallery | running | `owned` |
| `namespace:verdify-prod` | verdify-prod | Kubernetes namespace verdify-prod. | k3s vallery | running | `owned` |

## networkpolicy

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `networkpolicy:verdify-prod/verdify-outbound-boundary` | verdify-outbound-boundary | Fixed-host OpenAI embeddings, Slack postMessage and Open-Meteo relay; product issues 1011/1022. | k8s ns verdify-prod | running | `owned` |

## other

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `dashcopy:verdify-platform/product-grafana` | Verdify product Grafana + dashboards | Customer-facing Verdify Grafana with ~25 site dashboards generated from verdify-platform grafana/ trees. | ns verdify-prod Deployment verdify-grafana (+render cache), ConfigMaps verdify-grafana-dashboards-0..3; graphs.verdify.ai | running | `owned` |
| `other:verdify-product-grafana` | Verdify product Grafana (graphs.verdify.ai) | Product dashboards served to users. | ns verdify-prod | running | `owned` |
| `residue:monitoring-stack/dashboards-staged-verdify` | monitoring-stack deploy/observability/grafana/dashboards/staged/verdify-prod-site/ (26 files) | All 26 unreferenced staged Verdify dashboard copies retired by monitoring-stack PR 1045; canonical product dashboards and 21 approved public shares preserved. | jvallery/monitoring-stack@origin/main:deploy/observability/grafana/dashboards/staged/verdify-prod-site/ (26 files) | retired-residue | `owned` |
| `residue:verdify-platform/ns-verdify-platform-dashboard-cms` | verdify-platform/verdify-grafana-dashboards-0..3 ConfigMaps | Four untracked dashboard ConfigMaps in the agent-sessions namespace verdify-platform duplicating verdify-prod ones. | ns verdify-platform | retired | `owned` |

## physical-device

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `physical-device:esphome/greenhouse` | ESPHome greenhouse | Espressif esp32dev — ESP32 greenhouse climate controller with Modbus air/soil probes. | IoT VLAN 10 (address in jvallery/network-infra ipam/allocation.md) | running | `owned` |
| `physical-device:iot-aggregate/greenhouse-probes` | Greenhouse Modbus probes (9 declared) | Six air and three soil Modbus probes behind the greenhouse ESPHome controller. | property; IoT VLAN10 / Home VLAN40 / bridged | running | `owned` |
| `physical-device:iot/ha-shelly-2b1c9427` | Shelly Pro EM 2b1c9427 | Shelly Pro EM energy meter measuring greenhouse circuits. | IoT VLAN 10 (address in jvallery/network-infra ipam/allocation.md); Greenhouse | running | `owned` |
| `physical-device:iot/ha-shelly-b3a979c8` | Shelly Pro EM b3a979c8 | Shelly Pro EM energy meter measuring greenhouse circuits. | IoT VLAN 10 (address in jvallery/network-infra ipam/allocation.md); Greenhouse | running | `owned` |

## pvc

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `pvc:verdify-db-rehearsal/verdify-cnpg-s2-integration-1` | verdify-cnpg-s2-integration-1 | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | namespace verdify-db-rehearsal | retired | `owned` |
| `pvc:verdify-db-rehearsal/verdify-cnpg-s2-integration-1-wal` | verdify-cnpg-s2-integration-1-wal | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | namespace verdify-db-rehearsal | retired | `owned` |
| `pvc:verdify-db-rehearsal/verdify-cnpg-s2-integration-2` | verdify-cnpg-s2-integration-2 | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | namespace verdify-db-rehearsal | retired | `owned` |
| `pvc:verdify-db-rehearsal/verdify-cnpg-s2-integration-2-wal` | verdify-cnpg-s2-integration-2-wal | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | namespace verdify-db-rehearsal | retired | `owned` |
| `pvc:verdify-db-rehearsal/verdify-cnpg-s2-integration-3` | verdify-cnpg-s2-integration-3 | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | namespace verdify-db-rehearsal | retired | `owned` |
| `pvc:verdify-db-rehearsal/verdify-cnpg-s2-integration-3-wal` | verdify-cnpg-s2-integration-3-wal | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | namespace verdify-db-rehearsal | retired | `owned` |
| `pvc:verdify-db-rehearsal/verdify-s2-spool-382-7fa4f802` | verdify-s2-spool-382-7fa4f802 | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | namespace verdify-db-rehearsal | retired | `owned` |
| `pvc:verdify-db-rehearsal/verdify-s2-spool-qualification` | verdify-s2-spool-qualification | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | namespace verdify-db-rehearsal | retired | `owned` |
| `pvc:verdify-prod/db-data-verdify-db-0` | db-data-verdify-db-0 | Protected production data PVC (Prune=false,Delete=false; never prune or delete as rollback). PVC 50Gi class longhorn-v1-workspace-rwo Bound; Longhorn volume pvc-59fe138d-1cc4-4aac-bfcb-3d332f847411 (attached/healthy, replicas 3, recurring standard). | namespace verdify-prod | running | `owned` |
| `pvc:verdify-prod/verdify-db-dumps` | verdify-db-dumps | PVC 100Gi class (static binding) Bound; csi-nfs PV verdify-db-dumps-prod on the NAS share /volume2/verdify/. | namespace verdify-prod | running | `owned` |
| `pvc:verdify-prod/verdify-firmware-artifacts` | verdify-firmware-artifacts | PVC 5Gi class longhorn-v1-workspace-rwo Bound; Longhorn volume pvc-a19dc6b1-ecd2-413d-a89d-692fd113fa94 (detached/unknown, replicas 2, recurring standard). | namespace verdify-prod | idle | `owned` |
| `pvc:verdify-prod/verdify-grafana-data` | verdify-grafana-data | PVC 1Gi class longhorn-v1-workspace-rwo Bound; Longhorn volume pvc-acad919d-b6d2-4824-b7c7-a2b2ab460103 (attached/healthy, replicas 2, recurring standard). | namespace verdify-prod | running | `owned` |
| `pvc:verdify-prod/verdify-hermes-iris-data-portable-20260801` | verdify-hermes-iris-data-portable-20260801 | PVC 5Gi class longhorn-v1-rebuildable-rwo Bound; Longhorn volume pvc-6b6b2f30-c414-4325-a803-87b19010851f (attached/healthy, replicas 2, recurring backup-only,… | namespace verdify-prod | running | `owned` |
| `pvc:verdify-prod/verdify-ingestor-state` | verdify-ingestor-state | PVC 2Gi class longhorn-v1-workspace-rwo Bound; Longhorn volume pvc-68cb2b6c-dac9-494a-9fec-92b800762b5b (attached/healthy, replicas 2, recurring standard). | namespace verdify-prod | running | `owned` |
| `pvc:verdify-prod/verdify-lab-site-cache` | verdify-lab-site-cache | PVC 5Gi class longhorn-v1-rebuildable-rwo Bound; Longhorn volume pvc-1bd6ffec-7246-4e15-b080-287a9cf37418 (attached/healthy, replicas 2, recurring backup-only,… | namespace verdify-prod | running | `owned` |
| `pvc:verdify-prod/verdify-winter-feasibility-archive` | verdify-winter-feasibility-archive | PVC 10Gi class longhorn-v1-workspace-rwo Bound; Longhorn volume pvc-da430cd3-7469-4e36-8ef6-741fa281b753 (detached/unknown, replicas 2, recurring standard). | namespace verdify-prod | idle | `owned` |

## repo

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `repo:verdifyconsultancy/verdify-agent-context` | VerdifyConsultancy/verdify-agent-context | Private Verdify agent context, runbooks, operational handoffs, and sanitized project context. | github.com/VerdifyConsultancy/verdify-agent-context (archived, private) | retired-residue | `retire` |
| `repo:verdifyconsultancy/verdify-gravity` | VerdifyConsultancy/verdify-gravity | Archived repository (no description). | github.com/VerdifyConsultancy/verdify-gravity (archived, private) | retired-residue | `retire` |
| `repo:verdifyconsultancy/verdify-planner` | VerdifyConsultancy/verdify-planner | Verdify planner service and planner_graph package source. | github.com/VerdifyConsultancy/verdify-planner (archived, private) | retired-residue | `retire` |
| `repo:verdifyconsultancy/verdify-platform` | jvallery/verdify-platform | Verdify greenhouse platform: API, DB, firmware, ingestor, web/SaaS; ns verdify-prod, verdify-descheduler. | github.com/jvallery/verdify-platform | running | `owned` |

## route

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `endpoint:tier1.verdify.ai-hostregexp` | tier1.verdify.ai-hostregexp | Hostname tier1.verdify.ai-hostregexp: backend owner jvallery/verdify-platform, route owner jvallery/verdify-platform, DNS owner jvallery/ne… | verdify-prod/verdify-tier1-forward (analytics, botauth, logs, mqtt, traefik .verdify.ai) | running | `owned` |
| `route:verdify-prod/verdify-mcp-tunnel-forward` | verdify-mcp-tunnel-forward | Traefik IngressRoute (tunnelclient only) twin of verdify-tier1-forward for mcp.verdify.ai /mcp -> verdify-prod/verdify-traefik:81 (isolated tier-2 verdify-tunnel listener); external client attribution by CF-Ray/transport-peer join, no forwarded header trusted (verdify-platform#1010) | k8s ns verdify-prod (traefik-apps, Service traefik-apps/traefik-tunnel-client, cloudflared-only) | running | `owned` |
| `route:verdify-prod/verdify-t2-api` | verdify-t2-api | Traefik IngressRoute (verdify-web) for api.verdify.ai -> verdify-prod/verdify-api:8080 [ClusterIP ready=2]; TLS none (HTTP or tunnel-terminated) | k8s ns verdify-prod (verdify-traefik (verdify-prod)) | running | `owned` |
| `route:verdify-prod/verdify-t2-graphs` | verdify-t2-graphs | graphs.verdify.ai uses tokenless file routing; native Grafana queries, bounded PNG cache, and approved public metadata adapter (platform PR 1018). | k8s ns verdify-prod (verdify-traefik (verdify-prod)) | running | `owned` |
| `route:verdify-prod/verdify-t2-lab` | verdify-t2-lab | Traefik IngressRoute (verdify-web) for lab.verdify.ai, labs.verdify.ai -> verdify-prod/verdify-lab:8080 [ClusterIP ready=2]; TLS none (HTTP or tunnel-terminate… | k8s ns verdify-prod (verdify-traefik (verdify-prod)) | running | `owned` |
| `route:verdify-prod/verdify-t2-mcp` | verdify-t2-mcp | Traefik IngressRoute (verdify-web) for mcp.verdify.ai -> verdify-prod/verdify-mcp:8000 [ClusterIP ready=2]; TLS none (HTTP or tunnel-terminated) | k8s ns verdify-prod (verdify-traefik (verdify-prod)) | running | `owned` |
| `route:verdify-prod/verdify-t2-mcp-tunnel` | verdify-t2-mcp-tunnel | Traefik IngressRoute (verdify-tunnel :8001, admitted only from the traefik-apps workload) for mcp.verdify.ai -> verdify-prod/verdify-mcp:8000; JSON access log keeps only the CF-Connecting-Ip/CF-Ray join fields (verdify-platform#1010) | k8s ns verdify-prod (verdify-traefik (verdify-prod)) | running | `owned` |
| `route:verdify-prod/verdify-tier1-forward` | verdify-tier1-forward | Traefik IngressRoute (websecure,web) for analytics.verdify.ai, auth.verdify.ai, botauth.verdify.ai, crm.verdify.ai, logs.verdify.ai, mqtt.verdify.ai, proposals… | k8s ns verdify-prod (traefik-apps) | running | `owned` |

## scheduled-job

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `alert-path:verdify-writer-watchdog` | verdify-prod writer/db watchdog CronJobs | Product DB/writer watchdog path retired under #998 after independently verified monitoring-stack writer/DB alerts; exact two CronJobs and six dedicated grants removed, data retained. | ns verdify-prod CronJobs verdify-writer-watchdog (*/5) and verdify-db-watchdog (1-59/5) | retired | `owned` |

## secret

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `secret:verdify-db-rehearsal/controller-generated` | verdify-db-rehearsal: controller-generated Secrets (5) | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | k3s vallery / verdify-db-rehearsal | retired | `owned` |
| `secret:verdify-db-rehearsal/operator-generated/cnpg` | cnpg-generated secrets in verdify-db-rehearsal (5) | Retired in attended #992 sequence 2026-10-21; namespace, delivery authority and legacy Garage bucket/keys absent. Private encrypted recovery and eight native B2 backups retained. | k8s ns verdify-db-rehearsal | retired | `owned` |

## service

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `service:verdify-prod/verdify-outbound` | verdify-outbound | Fixed-host OpenAI embeddings, Slack postMessage and Open-Meteo relay; product issues 1011/1022. | k8s ns verdify-prod | running | `owned` |

## serviceaccount

| Id | Name | Summary | Location | State | Status |
| --- | --- | --- | --- | --- | --- |
| `serviceaccount:verdify-prod/verdify-outbound` | verdify-outbound | Fixed-host OpenAI embeddings, Slack postMessage and Open-Meteo relay; product issues 1011/1022. | k8s ns verdify-prod | running | `owned` |

## Applications rendered for this repo

Declared by another repo: the declaring repo owns the Application object, and this repo owns what it renders.

| Id | Name | Declaring owner | State | Status |
| --- | --- | --- | --- | --- |
| `argo-app:argocd/verdify-dashboard` | verdify-dashboard | `jvallery/estate-platform` | running | `owned` |
| `argo-app:argocd/verdify-dashboard-secrets` | verdify-dashboard-secrets | `jvallery/estate-platform` | declared-not-deployed | `owned` |
| `argo-app:argocd/verdify-descheduler` | verdify-descheduler | `jvallery/estate-platform` | running | `owned` |
| `argo-app:argocd/verdify-prod-dark` | verdify-prod-dark | `jvallery/estate-platform` | running | `owned` |
| `argo-app:argocd/verdify-prod-secrets-local-prod` | verdify-prod-secrets-local-prod | `jvallery/estate-platform` | running | `owned` |
| `argo-app:argocd/verdify-tenant-bounds` | verdify-tenant-bounds | `jvallery/estate-platform` | declared-not-deployed | `owned` |
