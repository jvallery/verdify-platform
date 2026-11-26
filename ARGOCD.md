# Verdify Platform ArgoCD

Last updated: 2026-11-16

Agent name: `verdify-platform`

## Enforcement Rule

All Kubernetes desired state owned by this lane must be represented in Git and
reconciled by ArgoCD. Do not make durable changes with direct
`kubectl apply/edit/patch` except emergency rollback or read-only diagnostics.

Every workload, namespace, secret reference, ingress, PVC, RBAC, and config
change must trace to a commit on `main`, ArgoCD Application sync/health
evidence, and a verification command or runbook evidence. Link an issue when
one exists.

## Environment Model

Verdify is single-env as of 2026-06-16.

- Prod namespace: `verdify-prod`.
- Live ArgoCD app: `verdify-prod-dark`. The name is legacy and means production:
  it renders `overlays/prod`, the only overlay, and there is no dark or
  device-dark production shape. It is not renamed on its own; it takes a
  production name only when the Application is re-homed.
- Desired state: `deploy/k8s/overlays/prod`.
- Sync model: manual, behind the device-write gate.
- Canonical branch: `main`.

## Applications

| App | Namespace | Source path | Sync policy | Notes |
|---|---|---|---|---|
| `verdify-prod-dark` | `verdify-prod` | `deploy/k8s/overlays/prod` | Manual | Legacy name meaning production; the real production writer. Sync uses the release preflight and rollback checks. |
| `verdify-dashboard` | `verdify-dashboard` | `deploy/k8s/dashboard` | Automated, self-heal, prune off | The dashboard web tier, declared in jvallery/estate-platform `gitops/applications/local-prod/` (adopted in jvallery/agents#5994). The web ships when its digest-pin PR to `deploy/k8s/dashboard/kustomization.yaml` merges, and the app never touches `verdify-prod`. Runbook: `docs/runbooks/dashboard.md`. |
| `verdify-descheduler` | `verdify-descheduler` | `deploy/k8s/descheduler` | Manual, prune off, pinned to an exact commit | The hourly descheduler CronJob ([#802](https://github.com/jvallery/verdify-platform/issues/802)), declared in jvallery/estate-platform `gitops/applications/local-prod/` under `agent-fleet-local-prod-apps`. A source change here reaches the cluster only when that pin moves in jvallery/estate-platform and the app is synced. |

These are the three Applications that sync this repository's paths; all three read it through the in-cluster git mirror, so after a merge Argo may need a hard refresh before it compares against the new commit. `verdify-prod-secrets-local-prod` and `verdify-dashboard-secrets` (SOPS-encrypted bundles in jvallery/estate-platform `secrets/verdify-prod` and `secrets/verdify-dashboard`) and `verdify-tenant-bounds` also deliver into these namespaces; their declarations are in jvallery/estate-platform too.

The live production Application declaration is owned by [jvallery/estate-platform](https://github.com/jvallery/estate-platform/blob/main/gitops/applications/local-prod/verdify-prod-dark.yaml) and reconciled by `agent-fleet-local-prod-apps`, whose source is `gitops/applications/local-prod` in that repository since the Application catalog moved from jvallery/agents on 2026-11-15 (the agents copy is frozen). Adoption preserved its UID, full spec, manual sync and storage ignores. Change its policy in that owner; this repo owns `deploy/k8s/overlays/prod` and its rendered resources.

`verdify-dashboard` and its AppProject are declared in jvallery/estate-platform
(`gitops/applications/local-prod/verdify-dashboard.yaml` and
`gitops/projects/verdify-dashboard.yaml`, with
`CreateNamespace=false` and `ServerSideApply=true`). The AppProject admits only
Namespace `verdify-dashboard`, Deployment, Service, ServiceAccount, ConfigMap,
NetworkPolicy and IngressRoute, and denies Secret: Secret `verdify-dashboard-web`
comes from the central KSOPS Application `verdify-dashboard-secrets`. Prune is
off, so a superseded generated ConfigMap stays; its `IgnoreExtraneous`
annotation keeps the app Synced. The tier-1 exclusion for `dashboard.verdify.ai`
lives in `overlays/prod` and ships with the `verdify-prod-dark` sync.

## Owned Desired State

- Base app workloads and policies: `deploy/k8s/base/`.
- Optional app components: `deploy/k8s/components/`.
- Prod overlay: `deploy/k8s/overlays/prod`.
- Dashboard web tier: `deploy/k8s/dashboard/` (Argo app `verdify-dashboard`).
- Secret names and key contracts: `deploy/k8s/SECRETS.md` plus placeholder
  manifests marked local-config.
- PreSync hooks of the prod sync: the ledgered `verdify-migrate` Job and the
  runtime-role bootstrap Jobs (`deploy/k8s/base`, `components/runtime-role-boundary`,
  `components/experiment-v2-credential-bootstrap`).
- CNPG/migration runbooks and experimental manifests: `deploy/k8s/cnpg/`.

## Out Of Scope

- Cluster-wide ArgoCD installation, AppProject policy, CRDs, CNI, CSI,
  StorageClasses, shared ingress controllers, Cloudflare tunnel config, and
  shared monitoring.
- Secret value sealing/decryption and age key custody.
- Prod sync execution without recorded task scope.

## Promotion Model

A merge to `main` runs the GitHub Actions `build` workflow (`.github/workflows/build.yml`)
on this repository's ARC runners: Kaniko builds the path-impacted images into the zot
origin (tag `gha-<sha12>`), and its `pin` job (estate-ci pin-bump, the only pin writer)
opens one PR that records the api, mcp, ingestor and migrate
`registry.vallery.net/...@sha256:` identities as build
candidates in the `images:` block of `deploy/k8s/overlays/prod/kustomization.yaml`
(and moves the dashboard-web digest in `deploy/k8s/dashboard/kustomization.yaml`).
The prod render runs the release pins instead: `release-pins.yaml`, a
`transformers:` entry applied after `images:`, for those four images, and the
hand-pinned `images:` entries for setpoint-server and
lab-publisher-k3s. The hermes-agent, timescaledb and grafana-image-renderer
images are built by the same workflow but are not in the pin job; their digests
are hand-pinned in their manifests, and a timescaledb repin restarts the
database, so it is an attended release of its own. So `main` renders what production runs, and a build changes
neither the render nor Argo's comparison with live (#808).

Promotion is a digest-only commit that moves release pins (for the four, copy
the candidates into `release-pins.yaml` together), followed by
`argocd app sync verdify-prod-dark` in the same attended session. Merging a pin
changes Git only; no image build or pin authorizes that sync. The Lab web
runtime uses a pinned content-free nginx image and serves only the validated
Quartz cache PVC.

The sync runs with prune off, so a manifest removed from Git leaves its live
object in place. The pull request that removes a workload lists the exact live
objects (kind and name) and what must stay; they are deleted by exact name after
the sync. Database objects are never removed by a sync: a drop is its own
numbered migration, applied by the `verdify-migrate` hook after the release that
removed its last reader and after an archive of the dropped data is written and
checked.

## Verification

- Render prod manifests before PRs that touch desired state:
  `kustomize build deploy/k8s/overlays/prod`.
- Render the dashboard manifests before PRs that touch them:
  `kustomize build deploy/k8s/dashboard` (checked by `tests/test_dashboard_manifests.py`).
- CI gate: `make ci` locally; on PRs the GitHub Actions `ci` workflow on ARC
  (`.github/workflows/ci.yml`; required contexts in the `main` branch rule).
- Promotion follows the Promotion Model above: a digest-only release-pin
  commit (`release-pins.yaml` for the four CI-built candidate images, the
  `images:` entries for setpoint-server and lab-publisher), then the
  gated sync; commands in `docs/runbooks/laptop-operator.md` §2. Merge changes
  Git only. The manual prod sync remains safety-checked.
