# Verdify k3s secret contract

Owner: this repository owns the CONTRACT (Secret names, key names, which workload
reads which key, the two invariants, the placeholder shape). The VALUES and their
delivery belong to the central KSOPS lane in `jvallery/agents` (planned for
`jvallery/estate-platform`): SOPS+age sealing, and the KSOPS Applications
`verdify-prod-secrets-local-prod` (namespace `verdify-prod`) and
`verdify-dashboard-secrets` (namespace `verdify-dashboard`). There is no
out-of-band apply. History: the secrets-out-of-.env umbrella #30 and the named
prod inventory #66.

This file is the single source of truth for **which Secret carries which key and
which workload reads it**. It contains **NO secret material**: names and keys
only. The deploy manifests reference every Secret BY NAME. `kustomize` cannot
decrypt SOPS, so the in-repo `*.placeholder.yaml` files exist ONLY so
`kustomize build` / `kubeconform` render a complete, lint-able manifest in CI.

Every Secret listed here is read by a workload or a PreSync hook in the current
render (`kustomize build deploy/k8s/overlays/prod` and `deploy/k8s/dashboard`),
except the retired `ghcr-jvallery-readonly`, whose name the render still lists.
When the last reader of a Secret or key leaves the render, it is removed from
this file in the same change, and the central lane retires it after that sync
has held (a Secret still named by a hook fails the hook and blocks the sync, so
the order is never reversed).

## The two invariants (CONTRACT, enforced by review + `kustomize build`)

1. **LOCAL-CONFIG-IS-AN-ANNOTATION.** Every in-repo `*.placeholder.yaml` Secret MUST
   carry `config.kubernetes.io/local-config: "true"` as an **annotation**, never a
   label. `kustomize build` excludes objects with that **annotation** from its
   output. As a **label** the object renders into the manifest, and an ArgoCD
   Secret-blacklisted AppProject rejects the whole sync ("synchronization tasks are
   not valid"). Verification: `kustomize build` of every overlay and of
   `deploy/k8s/dashboard` must emit **zero** `kind: Secret`. (This caught a real
   prod leak; see History.)

2. **NAMESPACE-MATCH.** For each sealed Secret, the KSOPS target namespace MUST be
   byte-identical to:
   - the overlay's `namespace:` directive,
   - the overlay's `Namespace` object, and
   - the ArgoCD `Application.spec.destination.namespace`.

   A mismatch does NOT error: the sealed Secret silently never lands in the
   workload's namespace and the pod starts without its credentials (or CrashLoops on
   a missing key). The namespaces are `verdify-prod` and `verdify-dashboard`.

## Never

- **Never** commit a real secret value, key, token, or password to this repo.
- **Never** bake credentials into a container image (the manifests inject every
  credential via `secretKeyRef` / `secretRef` / a mounted Secret volume at runtime).
  The one exception by design is the signed firmware image, which compiles the
  WiFi credentials and the device API key (see the builder rows below).
- **Never** rotate/seal `ESP32_API_KEY` without exact-target validation of the
  canonical value; it is the ESP32 Noise PSK, compiled into the firmware, and
  must never trigger a re-flash.

## Secret inventory (namespace `verdify-prod`; no values)

Service -> Secret -> key wiring as authored in `deploy/k8s/{base,components,overlays/prod,vision}`.
"req" means the reference is required (a missing key leaves the pod in
`CreateContainerConfigError`), "opt" means it is optional.

| Secret | Key | Consumed by (ref type) |
|---|---|---|
| `verdify-app-secrets` | `POSTGRES_PASSWORD` | database owner credential: `verdify-db`, the `verdify-migrate` hook, the runtime-role bootstrap hooks, `verdify-db-backup`, `verdify-db-exporter` and the suspended `verdify-knowledge-embed` (`secretKeyRef`, req). Absent from the API, ingestor, MCP, operator API, setpoint-server, Grafana, lab-publisher and vision pods, which use their own runtime logins. |
| `verdify-app-secrets` | `VERDIFY_WRITE_API_KEY` | api (`secretKeyRef`, req; write guard `api/main.py`) |
| `verdify-app-secrets` | `MQTT_USER`, `MQTT_PASS` | ingestor (`secretKeyRef`, req); the HAOS broker login of the Frigate occupancy subscriber (`ingestor/occupancy_mqtt.py`, #1370, read-only) |
| `verdify-app-secrets` | `ESP32_API_KEY` | ingestor (`secretKeyRef`, req) and the firmware builder (compiled into the signed image); **device-affecting** |
| `verdify-app-secrets` | `VERDIFY_API_RUNTIME_DB_USER`, `VERDIFY_API_RUNTIME_DB_PASSWORD` | the API's ordinary database identity (migration 217 exact login); the runtime-role bootstrap hooks install it |
| `verdify-app-secrets` | `VERDIFY_INGESTOR_RUNTIME_DB_USER`, `VERDIFY_INGESTOR_RUNTIME_DB_PASSWORD` | the ingestor's ordinary database identity (migration 217 exact login); the runtime-role bootstrap hooks install it |
| `verdify-app-secrets` | `VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_USER`, `VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_PASSWORD` | ingestor append-only equipment source collector (`secretKeyRef`, opt; exact function-only login, writes `equipment_state` and `equipment_counter_samples`) and the `verdify-experiment-v2-credential-bootstrap` hook (req), which installs and attests that one login |
| `verdify-mcp-runtime-db` | `password` | MCP and its PreSync role bootstrap (`secretKeyRef`; username is migration-owned `verdify_mcp_runtime_login`) |
| `verdify-dashboard-runtime-db` | `password` | [operator API](#operator-api-verdify-operator-api-1148), `verdify-greenhouse-brief` and the maintenance role bootstrap |
| `verdify-operator-api` | `operator-api-token` | [operator API](#operator-api-verdify-operator-api-1148) |
| `verdify-mcp-agents` | one key per named agent (`<name>`), the value its MCP bearer token | MCP (optional read-only volume at `/etc/verdify/mcp-agents`, no `subPath`; re-read within 60 s, no restart; [named MCP agents](#named-mcp-agents-vd-59)) |
| `verdify-mcp-observer` | `token` | MCP `VERDIFY_MCP_TOKEN_OBSERVER` (`secretKeyRef`, `components/mcp-observer`); protocol-only observer audience, no operational tools |
| `verdify-hermes` | `OPENAI_API_KEY`, `HERMES_MCP_URL` (note 1) and the other `HERMES_*` runtime env | hermes-iris, the daily reviewer (`envFrom.secretRef`) |
| `verdify-hermes` | `VERDIFY_MCP_TOKEN` | Iris's MCP bearer: hermes-iris presents it, MCP checks it as `VERDIFY_MCP_TOKEN_IRIS` (`secretKeyRef`, req) |
| `verdify-hermes` | `HERMES_IRIS_API_KEY` | ingestor (`secretKeyRef`, req): the daily review task posts the review run to Hermes and polls its status |
| `verdify-ha-token` | `ha_token.txt` | setpoint-server and ingestor (volume mount); **device-affecting** (grow lights through Home Assistant) |
| `verdify-hydro-probe` | `device-id`, `local-key` | ingestor, optional volume mount (`/etc/verdify/hydro-probe`; read-only YINMIK hydro reader, VD-70) |
| `verdify-lab-publisher-s3` | `LAB_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, optional `LAB_S3_ENDPOINT_URL` | lab-publisher (`envFrom.secretRef`) |
| `verdify-grafana-secrets` | `GRAFANA_ADMIN_PASSWORD` | grafana (`secretKeyRef`, req; pod fails closed when absent) |
| `verdify-grafana-secrets` | `GRAFANA_RENDERER_TOKEN` | grafana and image-renderer (`secretKeyRef`, req, shared token); API saved-public-panel PNG adapter (`secretKeyRef`, opt; fails closed when absent) |
| `verdify-grafana-oauth` | `GRAFANA_OAUTH_CLIENT_SECRET` | grafana (`secretKeyRef`, req); [Grafana SSO](#grafana-sso-174) |
| `verdify-frigate-vision-auth` | `token` | Vision CronJob and public API camera reader, mounted read-only at `/vfrigate/token`; GET-only two-camera snapshot credential |
| `verdify-vision-cortex` | `api_key.txt` | Vision CronJob ([local vision](#verdify-local-vision-1021)) |
| `verdify-planner-cortex` | `api_key.txt` | `verdify-greenhouse-brief` ([greenhouse snapshot](#greenhouse-snapshot-1346)) |
| `verdify-embedding-cortex` | `api_key.txt` | MCP (opt) and the suspended `verdify-knowledge-embed` ([knowledge embeddings](#verdify-knowledge-embeddings-1351)) |
| `verdify-contact-turnstile` | `VERDIFY_TURNSTILE_SECRET` | api ([public contact](#public-contact-verification-1008)) |
| `verdify-firmware-ota` | `ota_password`; during a rotation also `ota_password_next` / `ota_password_previous` (#1009, `scripts/firmware-ota-password-rotate.sh`) | signed builder and flasher Jobs (`scripts/firmware-release-job.py --ota-key`), `make firmware-deploy` ESPHome OTA upload + `firmware-rollback.sh`; **device-affecting** (flash gate) |
| `verdify-firmware-wifi` | `wifi_ssid`, `wifi_password` | firmware-builder CronJob/Jobs `WIFI_SSID`/`WIFI_PASSWORD` (`secretKeyRef`, `components/firmware-builder`); compiled into the signed controller image |
| `verdify-firmware-signing` | `cosign.key`, `password` | the build Pod's signer container only ([firmware signing](#firmware-artifact-signing-1009)) |
| the runtime logins | `password` | [runtime database logins](#runtime-database-logins-643) |
| `ghcr-jvallery-readonly` | `.dockerconfigjson` | none: retired in the central lane (jvallery/agents#7013) and absent live. Its name is still listed in the `imagePullSecrets` of `verdify-db`, which pulls from the zot origin through `zot-origin-cluster-pull` (reflected by the fleet, D-03); the name leaves with the next attended `verdify-timescaledb` release (#1543), because that hunk restarts the database. |

Note 1: `HERMES_MCP_URL` must point at the in-cluster `verdify-mcp` Service on port 8000;
it is set at seal time, never committed.

The production overlay performs migration 217's API/ingestor role cutover and
migration 259's MCP cutover: all three workloads reference distinct ordinary
runtime credentials, and the database-owner credential is absent from their pods. The owner
credential remains bounded to database administration, migrations, backups and the
PreSync runtime-role bootstraps. The ordinary runtime Secrets must be reconciled before
any sync. `deploy/k8s/overlays/prod-runtime-role-boundary` is a compatibility
review alias that renders byte-identically to the active `overlays/prod` source;
it is not a second activation layer.

The `experiment-v2-credential-bootstrap` component (a wave-2 PreSync hook; the
name is historical) installs and attests only the equipment-source collector login
from `VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_USER` / `..._DB_PASSWORD` in
`verdify-app-secrets` (64 lowercase hex, distinct from the owner and both ordinary
runtime passwords).

`verdify-lab-publisher-s3` is non-device but required before enabling the
`verdify-lab-publisher` CronJob. The durable prod prefixes are
`s3://verdify-platform/lab/content`, `.../public`, and `.../state`. For the
current S3-compatible endpoint, set
`LAB_S3_BUCKET=verdify-platform`, `AWS_DEFAULT_REGION=garage`, and
`LAB_S3_ENDPOINT_URL=https://s3.vallery.net` (the canonical Garage name under
ADR-012; `s3-hdd` is its retiring alias) with the Verdify-scoped key.

`verdify-grafana-secrets` is a prod-only prerequisite for the Grafana
Deployment, delivered (immutable) by `verdify-prod-secrets-local-prod` from the
central KSOPS lane (jvallery/estate-platform#70). The central lane seals and delivers the
two named keys before an ArgoCD sync; there is deliberately no in-repo placeholder, default password, or
default renderer token. Before any sync, verify only the Secret name and both
required key names (never their values), then run the task-scoped
`verdify-prod-dark` sync. A missing Secret or key leaves new pods
in `CreateContainerConfigError`; Kubernetes still accepts the Deployment object,
but its rollout cannot complete.

### Grafana SSO (#174)

Grafana's admin SSO requires `GRAFANA_OAUTH_CLIENT_SECRET` in a separate
immutable `verdify-grafana-oauth` Secret, matching the dedicated Authentik confidential client
`verdify-grafana`. The public client ID is source-owned; the secret value stays
in the owning KSOPS lane in `jvallery/agents`. Read back the exact
provider/callback/group boundary before changing this configuration. Never
print the provider secret or store it in this repository.

## Named MCP agents (VD-59)

`verdify-mcp-agents` lives in the jvallery/agents KSOPS lane for `verdify-prod`
(jvallery/agents#5993), and only Jason seals its values. Each key is one agent's
name (`^[a-z0-9][a-z0-9_-]{0,62}$`, never `admin`) and its value is that agent's
bearer token: an RFC 6750 token distinct from every other agent's and from every
`VERDIFY_MCP_TOKEN_*` value. MCP mounts the Secret as an optional read-only
volume and re-reads it at most every 60 s; until the Secret exists no agent is
admitted and MCP runs unchanged. `/readyz` lists names only
(`auth_agents_configured`, `auth_agent_keys_rejected`); a rejected key admits
nothing and never makes MCP not ready. Values never appear in logs, errors,
`/readyz`, Git or a browser. A named agent writes no climate value: its
`set_setting` reaches only the operator switches, and the band and the drying
cost limit are written only from the dashboard under the owner's sign-in.

- **Onboard:** Jason names the agent and seals key `<name>` into the
  jvallery/agents KSOPS lane for `verdify-prod`; once delivered, MCP admits
  `agent:<name>` within 3 min with no restart, and the agent's pod carries the
  label `verdify.ai/mcp-agent: "true"` and reads its own key (a pod in
  `verdify-prod` mounts only that key, with `items`, never the whole Secret).
- **Revoke:** delete the key the same way; MCP refuses the agent within 3 min of
  the Secret syncing.
- **Rotate:** Jason replaces the value; within 3 min MCP accepts only the new
  value, with no restart; the agent picks it up from its mounted key file, or on
  restart if it reads the key from an environment variable.

## Protected secret-source ownership (the central lane delivers; this repo specifies)

The current fleet-owned source and delivery entry point are:

```
jvallery/agents/
├── platform/gitops/secrets-ksops/verdify-prod/
└── .github/workflows/local-k8s-secret-sync.yml
```

This contract intentionally records only the owning directory, workflow, Secret
names, and required key names. It does not assert an encrypted filename,
ciphertext contents, or reconciliation state. The central lane resolves the exact protected
artifact in the owning repository and verifies only target metadata and key
names before running the bounded sync workflow.

The in-repo placeholder resources remain local-config-only and never render into
an Argo application. Runtime delivery is exclusively through the central lane;
an Argo application sync of this repo's paths is not a substitute for Secret
reconciliation.

## In-repo placeholder files (local build only)

| File | Secret |
|---|---|
| `overlays/prod/secrets.placeholder.yaml` | `verdify-app-secrets` |
| `overlays/prod/ha-token.placeholder.yaml` | `verdify-ha-token` |
| `overlays/prod/hermes-secret.placeholder.yaml` | `verdify-hermes` |
| `overlays/prod/planner-cortex-secret.placeholder.yaml` | `verdify-planner-cortex` |
| `overlays/prod/embedding-cortex.placeholder.yaml` | `verdify-embedding-cortex` |

The other Secrets have no placeholder: the workloads reference them as
`optional`, as `imagePullSecrets`, or as required references that `kustomize build`
renders without an in-repo stand-in, while real pod startup intentionally fails
closed until the central lane delivers the sealed prod Secret.

## History

- 2026-06-01 (#30): `overlays/prod/secrets.placeholder.yaml` carried
  `config.kubernetes.io/local-config` as a **label**, leaking the placeholder
  `verdify-app-secrets` (5 fake keys) into `kustomize build overlays/prod` output,
  in the device-write env. Fixed to an annotation; added the missing `verdify-hermes`
  placeholder; codified the two invariants above. Every overlay now renders ZERO
  `kind: Secret`.

## Access / least-privilege matrix (#305)

Standing tokens and credentials that an agent or CI can use, against what each
needs. **Hard invariant: no agent/CI principal may have device-write reach or
cluster-admin.** The device writer (ingestor `replicas: 1` + the gated
`allow-ingestor-device-egress`) and firmware OTA stay safety-checked regardless.

| Principal | Scope held | Device-write? | Cluster-admin? | Verdict |
|---|---|---|---|---|
| CI `GITHUB_TOKEN` (per job) | scoped per-job `permissions:`; the build workflow pushes images to the zot origin from its own ARC runner set and its pin job opens the pin PR through the pin-bot App | no (CI never touches the cluster or the device) | no | least-privilege |
| `LAB_REPO_TOKEN` (external PAT) | pushes lab content to the lab repo | no | no | confirm it is fine-grained and single-repo (org-level check, Jason) |
| Grafana datasource | its own runtime login, `verdify_grafana_runtime_login` (`verdify-grafana-runtime-db`), not the database owner | no | no | least-privilege |
| Iris (Hermes) and named MCP agents | MCP bearer tokens; reads, irrigation tools for Iris, operator switches for agents | no climate write (the band, the drying cost limit and every climate setting are refused to an agent) | no | least-privilege |
| Agent kubeconfig (context `vallery`) | full **cluster-admin** | only if device egress is enabled (gated) | **yes** | the real admin surface: prefer a narrow namespaced RBAC `Role` (`get/list` + `pods/exec` scoped to `verdify-db-0`) over the admin kubeconfig |
| `verdify-firmware-ota` / `ota_password` | flash the ESP32 through the signed Jobs or `make firmware-deploy` | **yes (flash)** | no | device-affecting: stays safety-checked; not held by CI |

The gated `argocd app sync` is run by an operator session outside CI.

## Runtime database logins (#643)

Each runtime has its own immutable, password-only Secret, owned exclusively by
`jvallery/agents` central KSOPS. The PreSync bootstrap hooks install each login
from its Secret and never change an existing password. URL-composed DSNs
require the owner's established URL-safe password generation.

| Secret | Key | Fixed database login | Consumers |
|---|---|---|---|
| `verdify-grafana-runtime-db` | `password` | `verdify_grafana_runtime_login` | grafana datasource; six-runtime-role bootstrap |
| `verdify-setpoint-server-runtime-db` | `password` | `verdify_setpoint_server_runtime_login` | setpoint-server; six-runtime-role bootstrap |
| `verdify-lab-publisher-runtime-db` | `password` | `verdify_lab_publisher_runtime_login` | lab-publisher; six-runtime-role bootstrap |
| `verdify-vision-runtime-db` | `password` | `verdify_vision_runtime_login` | vision CronJob; six-runtime-role bootstrap |
| `verdify-planner-runtime-db` | `password` | `verdify_planner_runtime_login` | six-runtime-role bootstrap only (no runtime uses the login); leaves with the planner roles' drop (#1695) |
| `verdify-matview-refresh-runtime-db` | `password` | `verdify_matview_refresh_runtime_login` | `verdify-band-curve-refresh`; maintenance role bootstrap |

The maintenance bootstrap receives its keys and the owner key only for
installation. It locks and rechecks NULL state, authenticates any existing
verifier without replacement, refuses mismatched custody, and never changes an
existing password. Runtime callers receive only their matching key.

### Hydroponic probe (VD-70, #1183)

`verdify-hydro-probe` is owned by the agents KSOPS lane. It carries the YINMIK
meter's Tuya `device-id` and `local-key`. The single ingestor mounts it
read-only and optionally at `/etc/verdify/hydro-probe`; `hydro_probe_sync`
reads both files on every poll and, while either is absent, logs one
`hydro key missing` line and idles. The values never appear in env, Git or a
log line, and no placeholder renders.

Rotate: re-pairing the meter in the Tuya app changes the local key. Jason reads
the new key from the Tuya cloud (LocalTuya's device entry or
`python -m tinytuya wizard`) and reseals it in agents KSOPS; the ingestor uses
it at its next poll once the kubelet refreshes the mount, with no restart. A new
protocol version goes in `VERDIFY_HYDRO_PROBE_TUYA_VERSION`
(`deploy/k8s/overlays/prod/hydro-probe.patch.yaml`).

## Public contact verification (#1008)

`verdify-contact-turnstile` / `VERDIFY_TURNSTILE_SECRET` is rendered by agents central KSOPS into `verdify-prod`, consumed only by `verdify-api`. The public widget sitekey belongs in Quartz; hostname `lab.verdify.ai` and action `contact` are checked at Siteverify. No secret is stored in this repository.

## Verdify local vision (#1021)

`verdify-vision-cortex` must contain `api_key.txt`, a dedicated inference-only Cortex identity limited to `llm.primary.longctx.mm`, owned and sealed in agents KSOPS. The vision CronJob mounts it at `/vcortex/api_key.txt`.

## Greenhouse snapshot (#1346)

CronJob `verdify-greenhouse-brief` (`components/greenhouse-brief`) is the only reader of `verdify-planner-cortex` (the name is historical), key `api_key.txt`: an inference-only Cortex identity limited to the text routes `llm.primary.longctx` and `llm.qwen38u.longctx` (any image request belongs to `llm.primary.longctx.mm` under its own identity). Its adoption into agents KSOPS is jvallery/agents#6079. It is mounted `optional` at `/vcortex-brief/api_key.txt`: without it the job calls nothing, records one `error` row (`FAIL CLOSED`) per run and exits 2. Its database login is the dashboard login (`verdify-dashboard-runtime-db` / `password`). Placeholder: `overlays/prod/planner-cortex-secret.placeholder.yaml`. A separate `verdify-brief-cortex` identity, so the snapshot's Cortex use can be attributed and revoked on its own, is a follow-up in jvallery/cortex-ai-compute and the agents KSOPS lane.

## Verdify knowledge embeddings (#1351)

`verdify-embedding-cortex` must contain `api_key.txt`, a dedicated Cortex identity (73) limited to `embed.main`, with no expiry. Its KSOPS adoption into the agents lane is jvallery/agents#6079. `verdify-mcp` mounts it at `/vembed/api_key.txt` (optional: if it is absent, `lessons_search` and `knowledge_search` fail closed with `embedding_credential_missing`), and so does the suspended `verdify-knowledge-embed` CronJob. `overlays/prod/embedding-cortex.placeholder.yaml` is local-config only, so the render emits no Secret.

## Firmware artifact signing (#1009)

`verdify-firmware-signing` contains `cosign.key` and `password`. Agents owns the
single SOPS source and Secret-only reconciliation. Only the build Pod's signer
container mounts the private key; the compiler and flasher cannot read it.
The public key is product-owned `cosign.pub`, SHA256
`4a3b1fe0a863ff330a7ff938f827949ad28be846b1da549e090bf35935cc177e`.
Jason explicitly approved this new key and encrypted custody on 2026-10-23.
It grants no permission to flash, rotate OTA credentials or open a device
connection. See [signed-artifact operations](../../docs/runbooks/firmware-signed-artifacts.md).

## Dashboard web (`verdify-dashboard`) (#1142)

The dashboard BFF reads one Secret, delivered by the jvallery/agents KSOPS Application
`verdify-dashboard-secrets` (jvallery/agents#5993, `CreateNamespace=false`, so it syncs once Argo app
`verdify-dashboard` has created the namespace). The `verdify-dashboard` AppProject denies Secret, and
`kustomize build deploy/k8s/dashboard` emits none; there is no placeholder. Its target namespace is
`verdify-dashboard`, the same string as the kustomization's `namespace:`, the Namespace object and the
Application destination (invariant 2).

| Secret | Keys | Consumed by | Rotate |
|---|---|---|---|
| `verdify-dashboard-web` | `oidc-client-secret`, `cookie-secret`, `operator-api-token` | the BFF, Deployment `verdify-dashboard-web` (`secretKeyRef`, required: `OIDC_CLIENT_SECRET`, `COOKIE_SECRET`, `OPERATOR_API_TOKEN`) | Jason re-seals in the jvallery/agents KSOPS lane; `operator-api-token` changes together with `verdify-operator-api` in `verdify-prod`, in one agents PR. Once synced, delete the web pod, and the operator API pod for the token, so each restarts with the new value. A new `cookie-secret` voids only sign-ins in progress; sessions survive. |

A missing Secret or key leaves a new web pod in `CreateContainerConfigError`. Read it back by key name only:
`kubectl -n verdify-dashboard describe secret verdify-dashboard-web`. The image-pull Secret
`zot-origin-cluster-pull` is reflected into the namespace by jvallery/agents#5994. Operations:
[dashboard runbook](../../docs/runbooks/dashboard.md).

## Operator API (`verdify-operator-api`) (#1148)

The operator API, Deployment `verdify-operator-api` in `verdify-prod` (`deploy/k8s/components/operator-api`), reads
two Secrets from the jvallery/agents KSOPS lane for `verdify-prod` (jvallery/agents#5993); only Jason seals their
values. Neither has a placeholder, and `kustomize build deploy/k8s/components/operator-api` emits no Secret. The pod
refuses to start unless `OPERATOR_API_TOKEN` has at least 32 printable characters (the BFF's rule) and `DB_USER`
(ConfigMap `verdify-operator-api`) is `verdify_dashboard_runtime_login`. Its `/metrics` (the product metrics) needs
no Secret: it is unauthenticated and reachable only through NetworkPolicy `allow-operator-api-metrics-scrape`.

| Secret | Keys | Consumed by | Rotate |
|---|---|---|---|
| `verdify-operator-api` | `operator-api-token` | Deployment `verdify-operator-api` (`secretKeyRef`, required: `OPERATOR_API_TOKEN`), the bearer the BFF presents; the same value as `verdify-dashboard-web`'s `operator-api-token` | Jason reseals both copies in one jvallery/agents PR. Once both have synced, delete the web pod and the operator API pod so each restarts with the new value; until both have, the BFF's calls get 401. |
| `verdify-dashboard-runtime-db` | `password` | Deployment `verdify-operator-api` (`secretKeyRef`, required: `DB_PASS`, user `verdify_dashboard_runtime_login`), CronJob `verdify-greenhouse-brief` (`secretKeyRef`, required: `DB_PASS`, the same login; #1346) and Job `verdify-maintenance-runtime-role-bootstrap` (`secretKeyRef`, optional: `DASHBOARD_DB_PASSWORD`). A missing or empty value skips that login's duty; any other value must be 64 characters of `[A-Za-z0-9_-]`, or the PreSync hook fails closed and stops the sync. | An owner-run `ALTER ROLE verdify_dashboard_runtime_login PASSWORD …` sets the new value, then Jason reseals it in the KSOPS lane; once synced, restart `verdify-operator-api` (`kubectl -n verdify-prod delete pod -l app.kubernetes.io/component=operator-api`). The role bootstrap never rotates a password. |

A missing Secret or key leaves a new operator API pod in `CreateContainerConfigError`. Read both back by key name
only: `kubectl -n verdify-prod describe secret verdify-operator-api verdify-dashboard-runtime-db`.
