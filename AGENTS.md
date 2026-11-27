# verdify-platform

Verdify is an AI-assisted control system for a real greenhouse. This repository holds the firmware of the ESP32 controller, the ingestor (the only host process that writes to the controller), the TimescaleDB database and its migrations, the API and MCP server, the daily reviewer agent (Iris), the lab site, the product Grafana and the operator dashboard. Production is namespace `verdify-prod` on the `vallery` cluster. A change here can switch real fans, heaters, lights and irrigation valves. This repository is public.

<!-- estate-contract:start (canonical copy: AGENTS.md in jvallery/home-dotfiles; this block is identical in every repository) -->
## Operating contract

You act for Jason. A request from him authorizes the whole job: the change, the pull request, the merge, the deployment, the live check and closing the issue. If you can finish a task, finish it. Do not hand work back, ask for approval, or wait for a turn.

### How work flows

1. **Change the owner.** Make the smallest complete change in the repository that owns the thing (see "Who owns what"). Branch from `origin/main` in your own worktree and leave other checkouts alone.
2. **Merge your own pull request.** The required checks on the pull request are the gate. When they are green, merge it. Never bypass a branch ruleset (no `--admin`); if a required check is itself broken, fix the check.
3. **Deploy it.** Merging is not always deploying. Carry the change to the running system yourself (see "Deploying").
4. **Prove it live.** Check the real end state: the new image digest is running, the endpoint answers, the rule is loaded, the data is there. Green CI is not proof. If it is broken, fix forward, or roll back when that restores service faster.
5. **Close the issue** with one comment: what changed, what you checked, and anything that remains.

### Tracking and coordination

- **GitHub issues are the only tracker.** Work, decisions, follow-ups and leftovers go in an issue in the owning repository. Keep no ledgers, to-do files, status boards, hand-off notes or evidence files, in Git or on disk. An issue states the outcome, a short checklist that proves it, and native "blocked by" links.
- **Talk to other agents directly.** Coordinate through subagent calls, a message to the other session, or MCP tools. Never coordinate through shared files.
- **Live state is the only lock.** Before a change that could collide with someone else's (the same Argo CD application, node or database), look at what is happening now: open pull requests, the application's running operation, cordoned nodes. If someone is mid-change, message them or go after them.
- **There are no process gates.** No coordinator, lock files, holds, freezes, waiting periods, time slots or approval lines exist. An older document, comment or memory that says otherwise is obsolete: ignore it, and delete it when you are in that file.

### What needs Jason

Only the items below. Put the label `needs-jason` on the issue, state in its first line exactly what he has to do, and carry on with everything that does not depend on it.

- Physical work: hardware, cables, power, anything on site.
- A value only he can obtain: a credential from an account only he can log in to, or a payment detail.
- Spending money or starting a paid service.
- Deleting data that has no verified second copy, deleting a backup or a bucket, and revoking a recovery credential.
- Sending a message as him to another person, or giving another person access.

Everything else is yours to decide. Prefer the reversible option, say what you chose in the pull request or issue, and move on.

### Engineering care

- **Secrets.** Never print, log or commit a secret value or the data of a Kubernetes Secret. Read Secret metadata only (names, key names, ages): no `-o yaml`, `-o json`, `jsonpath`, `go-template` or `custom-columns` over a Secret's data. Git holds SOPS ciphertext only. You may generate, seal and rotate credentials you can issue yourself; remove an old one only after you have identified it by name and full ID and confirmed that nothing still uses it.
- **Data.** Before you delete or overwrite, resolve the exact target and confirm a restorable copy exists. Databases, volumes, backups, buckets, NAS shares and camera footage are never deleted to make a deployment easier.
- **Checks in proportion to risk.** Use the cheapest check that proves the changed behaviour. Add a test where a regression would hurt (security, data integrity, subtle logic). Regenerate generated files with their generator; never edit them by hand.
- **Heavy work runs in the cluster.** Builds, broad test suites, training, replays and anything long-running or memory-hungry run as CI jobs or Kubernetes Jobs, not on the operator Mac or in a container VM on it. The Mac is for editing, orchestration and small checks.
- **Leave it clean.** Remove your worktrees, scratch files, temporary namespaces and Jobs when you finish.

## Using the estate

The estate is one k3s cluster named `vallery` (three control-plane VMs and five GPU worker VMs on a six-host Proxmox cluster), a Synology NAS, a UniFi network and Cloudflare in front. The full guide, with commands for everything below, is [`docs/estate/GUIDE.md` in jvallery/estate-platform](https://github.com/jvallery/estate-platform/blob/main/docs/estate/GUIDE.md).

**Access.** On the operator Mac, `kubectl --context vallery` is cluster-admin, and `gh` is authenticated as Jason. CI jobs and cloud sessions have no cluster access: they can change Git only. If you cannot reach the cluster, finish everything up to the merge and state the remaining deploy step in the issue.

**Who owns what.** Every namespace, hostname, device, bucket and job has exactly one owner repository, recorded in `ownership/record/` in jvallery/estate-platform and rendered to [`ESTATE-INVENTORY.md`](https://github.com/jvallery/estate-platform/blob/main/docs/estate/ESTATE-INVENTORY.md). A namespace's label `estate.vallery.net/owner` names its owner. When you add, move or retire something, update the record in the same piece of work.

| Area | Owner |
|---|---|
| Argo CD, the application catalog, shared operators (CNPG, cert-manager, MariaDB), Authentik, central secrets, ownership record, standards | `jvallery/estate-platform` |
| CI workflows and runners | `jvallery/estate-ci` |
| DNS, routes, TLS, Cloudflare, UniFi, Pi-hole, MetalLB, Traefik | `jvallery/network-infra` |
| Longhorn, StorageClasses, NAS shares, S3 buckets, the image registry, backups | `jvallery/storage-infra` |
| Prometheus, Alertmanager, Loki, Grafana, probes, every alert rule and dashboard | `jvallery/monitoring-stack` |
| Proxmox hosts, VMs, k3s nodes, node labels and taints | `jvallery/proxmox-infrastructure` |
| GPUs, GPUStack, the Cortex inference API, Open WebUI | `jvallery/cortex-ai-compute` |
| The operator Mac and this contract | `jvallery/home-dotfiles` |
| Each application | Its own repository, which owns what renders into its namespaces |

**Deploying.** Argo CD applies what is in Git, read through an in-cluster mirror that trails GitHub by one to four minutes. For many Applications, including most secret bundles in jvallery/estate-platform, merging is the deploy event. An Application that is manual or pinned has its reason on its row in `gitops/rings.yaml` in jvallery/estate-platform. Look up how your application is delivered:

```sh
kubectl --context vallery get applications.argoproj.io -A --field-selector metadata.name=<app> -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,TARGET:.spec.source.targetRevision,AUTO:.spec.syncPolicy.automated,REV:.status.sync.revision,SYNC:.status.sync.status,HEALTH:.status.health.status
```

- `TARGET` is `main` and `AUTO` is on: merging deploys. Wait until `REV` is your merge commit or a later one and the application is Synced and Healthy. `AUTO` is off when it shows `<none>` or `enabled:false`.
- `TARGET` is `main` and `AUTO` is off: merge, then sync the objects you changed, and only those, unless this repository's own section says its application must be synced whole.
- `TARGET` is a commit SHA: the application is pinned, and its `pin_reason` in `gitops/rings.yaml` says what the pin protects. Move the pin to your merge commit in the file that declares the Application, merge that, then sync the objects you changed.

A change to an Application's own file (its spec or its pin) is delivered by the root that reads the file. Every catalog root tracks `main`, so there is no root pin to move and nothing to record afterwards:

- `gitops/applications/local-prod/` in jvallery/estate-platform: applied on merge.
- `gitops/applications/local-staging/` or `local-dev/` there: merge, then sync that environment's root naming the Application.
- An owner repository's Argo CD directory (`argocd/` in most): merge, then sync the owner's nested root naming the Application, unless the repository's own section says the root is automated.

The guide has the exact commands for a named sync and a pin move. Two rules protect the cluster. Sync named objects, never a whole root or a whole pinned Application, because a whole sync applies every pending change under it and can deliver or roll back other people's work. Never sync with prune, because pruning is off everywhere on purpose and a prune deletes every object Git no longer lists, volumes and namespaces included.

**CI and images.** CI is GitHub Actions on in-cluster runners owned by jvallery/estate-ci; GitHub-hosted runners are not allowed. A repository calls the reusable workflows in jvallery/estate-ci by full commit SHA. Images are built in CI with Kaniko and pushed to `registry.vallery.net`. In most repositories the build then opens a pull request that pins the new digest in the deployment manifests, and merging that pull request is the release; where a repository promotes differently, its own section says how. Manifests reference images by `@sha256` digest only. Upstream images are mirrored into the registry first. Re-run a failed job with `gh run rerun <run-id> --failed`.

**Secrets.** A Kubernetes Secret exists in Git only as a SOPS-encrypted file (`secret-<name>.enc.yaml`), decrypted in the cluster by Argo CD. Most live in `secrets/<bundle>/` in jvallery/estate-platform; storage and network secrets live in their own repositories. Encrypting needs only the public keys in `.sops.yaml`, so you can add or rotate a secret yourself: write the manifest, run `sops --encrypt --in-place <file>`, list it in the bundle's `secret-generator.yaml`, and deliver it like any other change. For a value only Jason can obtain, prepare everything else and open a `needs-jason` issue.

**Running workloads.** Namespaces enforce the Pod Security `baseline` level by default. A new namespace needs the `estate.vallery.net/owner=<org>.<repo>` label, the LimitRange and ResourceQuota baseline, a default-deny NetworkPolicy and an ownership record entry. For one-off heavy work, use a CI job, a Job in the owning namespace, or a disposable namespace named `tmp-<topic>` and labelled `estate.vallery.net/disposable=true` and `estate.vallery.net/expires=<date>`, and delete it afterwards. The `tmp-` name matters: alert rules that read logs can tell a throwaway namespace only by its name. Give Jobs a `ttlSecondsAfterFinished` and never create bare Pods, which block node drains. Set a memory request to what the workload uses (its measured peak plus a margin): every worker runs to the same memory budget, so an oversized request takes capacity from everything else. Cluster-scoped RBAC is written only through Git and Argo CD: a ClusterRole or ClusterRoleBinding created or deleted by hand pages as a critical security alert, so test with a namespaced Role and RoleBinding.

**Storage and databases.** The default StorageClass is replicated Longhorn. Use `longhorn-v1-rwo` for application data, `longhorn-v1-critical-rwo` for data that must survive a host loss, `longhorn-v1-rebuildable-rwo` for caches and scratch, and `nfs-rwx` only for NAS shares that jvallery/storage-infra has exported. S3 buckets come from jvallery/storage-infra. A Postgres database is a three-instance CloudNativePG cluster that archives to a bucket from jvallery/storage-infra; copy an existing one. Every durable volume needs a backup or a named exemption in jvallery/storage-infra. A backup has two copies, one on the NAS and one in Backblaze B2, and is never stored on a Longhorn volume; running data on Longhorn is fine once it has a backup.

**Exposing a service.** Add a Traefik `IngressRoute` in your namespace with `tls: {}`; the wildcard certificate for `*.vallery.net` already covers it. For login, add the Authentik forward-auth middlewares. Every exposed hostname, LAN-only or public, is one entry in the edge registry in jvallery/estate-platform, and needs all of: its route, DNS inside the LAN, and a probe from inside the cluster with an alert on it in jvallery/monitoring-stack. A public hostname also needs a row in the Cloudflare tunnel configuration in jvallery/network-infra, public DNS, and a probe from outside the estate with its alert. Checks in those repositories fail a registered hostname that lacks a part, and an exposed one that is not registered.

**Observability.** Alert rules, probes and dashboards live only in jvallery/monitoring-stack, and that application deploys on merge, so a merged rule can page within minutes. Alerts go to Alertmanager and nowhere else: they are read on the Grafana alert dashboard, and critical alerts are also pushed to Jason's phone (by Telegram once it is delivered; the guide says what is live). Never notify a person from an application, and build nothing on Home Assistant for alerts. Dashboards are generated, never hand-edited. When something you run can fail in a new way, add the metric and the alert.

**Node and host maintenance.** Never cordon or drain a node by hand: a bare drain once moved five database primaries at once and took down the control-plane leader. Use `scripts/k3s-planned-maintenance.py` in jvallery/proxmox-infrastructure, one node at a time. It moves database primaries off the node first, drains it, and marks the work as planned so that the right alerts stay quiet. Read its README first, and never run a script only to see its help text.

**AI inference.** Workloads call the in-cluster OpenAI-compatible API at `https://cortex.vallery.net/v1` with their own scoped key, issued by jvallery/cortex-ai-compute. Never use an admin credential or an outside provider key.

**Standards.** The target state for high availability, backups, security, exposure and CI is [`docs/estate/STANDARDS.md` in jvallery/estate-platform](https://github.com/jvallery/estate-platform/blob/main/docs/estate/STANDARDS.md). New work meets it; drift you find is fixed in the change that touches it or filed as an issue.
<!-- estate-contract:end -->

## This repository

- It owns the namespaces `verdify-prod` (the only environment; `verdify-db` is the only database), `verdify-dashboard` (the dashboard web tier) and `verdify-descheduler`, and everything its manifests render into them. Item detail is in [OWNERSHIP.md](OWNERSHIP.md).
- It owns the routes for `lab`, `labs`, `api`, `mcp`, `graphs` and `dashboard.verdify.ai`, and the catch-all for every other single-label `*.verdify.ai` host, which forwards to this repository's own Traefik (`verdify-traefik`) in `verdify-prod`.
- It owns the images that `.github/workflows/build.yml` builds, the PriorityClasses `verdify-*`, the scheduled jobs in `verdify-prod` and the Secret name and key contract in `deploy/k8s/SECRETS.md`. Secret values are not here.
- It uses the greenhouse controller, its probes and two Shelly power meters; the device records themselves belong to jvallery/homeassistant.

Where things are:

- `firmware/` is the controller (`firmware/lib/climate_law.h` is the climate law). `ingestor/`, `api/`, `mcp/`, `hermes/` (Iris), `dashboard/`, `grafana/` and `site/` are the services. `db/migrations/` and `verdify_schemas/` are the data contract.
- `deploy/k8s/base`, `components/*` and `overlays/prod` render production; `deploy/k8s/dashboard/` and `deploy/k8s/descheduler/` render the other two namespaces.
- [ARGOCD.md](ARGOCD.md) describes the Applications. [docs/agents/contracts.md](docs/agents/contracts.md) has the control model, the cross-layer contracts, the generated files and the focused commands: read it before changing firmware, schemas, migrations or settings. A code comment or check message that cites "AGENTS.md rule 6" or "rule 7" means the readback rule and the restart rule in that file. `docs/CONTROL-ARCHITECTURE.md` and `docs/firmware-control-contract.md` explain the design. Runbooks are in `docs/runbooks/`.

## Build, test, deploy, verify

**Checks.** `make ci` is the full gate; it is heavy, so let the pull request run it and use `make lint`, one focused test target, or `kustomize build deploy/k8s/overlays/prod` locally. The required checks are the `ci / …` jobs of `.github/workflows/ci.yml` (`docs/ci/ci-contexts.md` lists them). The branch does not have to be up to date, and every push restarts the run, so rebase a green pull request only when GitHub reports a conflict.

**Images.** A merge to `main` runs `build.yml` for the images whose paths changed. Its `pin` job opens one pull request that moves the dashboard-web digest and records the api, mcp, ingestor and migrate digests in the `images:` block of `deploy/k8s/overlays/prod/kustomization.yaml`. Merge it when green. Those four entries are build candidates only: `release-pins.yaml`, applied after them, decides what production runs. Never edit the candidate entries by hand, because they race with the pin job. The whole of `docs/` is copied into the ingestor image as its content corpus, but a merge whose only changes to an image are files it copies and never runs (`docs/` apart from `docs/planner/`, and `verdify_schemas/tests/`) builds nothing and opens no pin pull request; the next build of that image ships them. To publish a corpus change on its own, dispatch `build.yml` with `base` set to a commit before it.

Each part of the system is delivered differently.

**Dashboard web: merging deploys.** The Application `verdify-dashboard` tracks `main` and syncs `deploy/k8s/dashboard/` automatically. The web is live when the pin pull request merges. Prove it with `scripts/dashboard-smoke.sh --expected-web-sha <build commit>`. To switch off dashboard writes without a release, merge a one-line change of `DASHBOARD_WRITES_ENABLED` to `false` in that kustomization. Runbook: `docs/runbooks/dashboard.md`.

**Production (`verdify-prod`): merge, promote, then sync.** The Application `verdify-prod-dark` (the name is historical; it is production) tracks `main` and has no automatic sync, so a merge changes Git only.

1. Run `python3 scripts/promote-release-pins.py`. It copies the candidate digests into `release-pins.yaml`, all four together, because the migrate image carries the schema the others expect. Commit that digest-only change and merge it. The setpoint-server and lab-publisher pins are edited by hand in the kustomization (`docs/runbooks/prod-promotion.md`).
2. Look at what will change: `kustomize build deploy/k8s/overlays/prod | kubectl --context vallery diff -f -`. A sync applies every out-of-sync object, not only yours.
3. Sync the whole Application at the exact commit, with prune off and no resource list, using the command in `docs/runbooks/laptop-operator.md` section 2. This is the one exception to "sync only the objects you changed": Argo CD skips every hook on a selective sync, so the `verdify-migrate` hook would not run and the new images would start against an old schema. Right after submitting, read `.status.operationState.operation.sync.resources`; it must be absent or empty. If it is not, stop and do not retry.
4. Delete by exact name any live object that the release removed from Git, and nothing else. Restart what the pull request's `Post-merge restart:` line names if the sync did not already roll it.

Prove it:

```sh
kubectl --context vallery -n argocd get application verdify-prod-dark -o jsonpath='{.status.sync.status} {.status.health.status} {.status.sync.revision}{"\n"}'
kubectl --context vallery -n verdify-prod get deploy,sts,cronjob
scripts/k3s-smoke.sh smoke --expected-api-sha "$API_BUILD_SHA" --expected-api-digest "$API_DIGEST"
scripts/k3s-smoke.sh device-monitor
```

`device-monitor` must show exactly one connection to the controller. After an ingestor rollout, watch `kubectl --context vallery -n verdify-prod logs deploy/verdify-ingestor` for five minutes for `ValidationError` or `row failed schema validation`. The Application's health also reflects the last run of each CronJob, so a failed scheduled job shows it Degraded; find what failed before you blame a sync.

To roll back, commit a digest-only `release-pins.yaml` change to the previous pins, keeping a `verdify-migrate` digest that contains every applied migration, then sync and smoke-test again.

**Descheduler.** The Application `verdify-descheduler` tracks `main` and has no automatic sync. After the merge, hard-refresh the Application and sync the objects you changed at the revision it has resolved, not at an older commit (the estate guide, "Sync named objects"). Read `deploy/k8s/descheduler/descheduler-arm.md` first.

**Firmware.** Firmware reaches the controller only through the signed release Jobs (`scripts/firmware-release-job.py`, runbook `docs/runbooks/firmware-signed-artifacts.md`) or `make firmware-deploy`. Both run `scripts/firmware-deploy-preflight.sh`, which refuses to flash on an unresolved critical alert, stale telemetry or a missing rollback artifact. Verify the running version with the `diagnostics.firmware_version` query in `docs/runbooks/laptop-operator.md` section 3.

**Lab content.** The CronJob `verdify-lab-publisher` publishes S3 content to the lab site every 30 minutes; see `docs/runbooks/lab-content-pipeline.md`.

**Secrets.** The bundles are `secrets/verdify-prod` and `secrets/verdify-dashboard` in jvallery/estate-platform. Each is delivered by its own Application, which tracks `main` and syncs itself, so a changed Secret is one pull request there and deploys on merge. Add no SOPS file here.

## Hazards

- **One writer to the controller.** Device writes happen only where `VERDIFY_DEVICE_WRITE_ENABLED=1`, which only `overlays/prod` sets. Keep the ingestor at one replica with the `Recreate` strategy: two writers would send the controller conflicting commands. A production sync recreates the ingestor when its pod spec changes, so check the diff and the controller connection every time. `verdify-setpoint-server` is a second writer (grow lights through Home Assistant) with a hand-set pin.
- **The controller must keep a safe fallback.** Flash only through the preflight. Roll back only to a build of the band-edge law; older firmware would run on its boot values because the host no longer sends the settings it expects. Never relabel a recovery candidate as `last-good`.
- **The band and the drying cost limit are the owner's.** They are written only from the dashboard band editor under Jason's sign-in. No agent, script or MCP tool writes a climate value; Iris only reviews.
- **Some make targets and scripts act on the live greenhouse.** `make test` and `make check` run against the live stack. `greenhouse-quiet-on` and `-off` change setpoints. `irrigation-feedback-finalize` and `irrigation-acceptance` resolve alerts. `hermes-restart` restarts Iris. `db-dump` overwrites `db/schema.sql`. `firmware-deploy` and `firmware-rollback` flash the controller. `scripts/dashboard-smoke.sh` with `--agent-write`, `--role operator` or `--lights` changes a real setting or switches the real main light and then restores it. `scripts/smoke-feedback-loop.py` writes synthetic rows to the database it reaches. Read a target before you run it.
- **Never prune or delete the database.** The StatefulSet `verdify-db`, its volume and the dump volume `verdify-db-dumps` hold years of telemetry. Pruning is off; removing a manifest leaves the live object, which you then delete by exact name.
- **Migrations go forward only.** Never edit an applied migration, and never wrap a self-committing one in `BEGIN … ROLLBACK`: the inner commit lands on the live database. A dropped table comes back only from its archive.
- **A stricter schema silently drops data.** The ingestor logs and discards any row that fails its `verdify_schemas` model. Check live data before tightening a write model.
- **The production render must contain no Secret.** `kustomize build deploy/k8s/overlays/prod` must emit zero `kind: Secret`. Each placeholder Secret carries `config.kubernetes.io/local-config: "true"` as an annotation; as a label it would render, and the AppProject would reject the whole sync.
- **The catch-all route swallows new hostnames.** `verdify-tier1-forward` sends every single-label `*.verdify.ai` host that it does not exclude to this repository's Traefik. A host served from another namespace must be added to its exclusion list; Traefik priority does not separate them. A new hostname is also an exposed host: it needs its entry in the edge registry (`ownership/record/edge.yaml` in jvallery/estate-platform), its route, DNS inside the LAN, a probe from inside the cluster with an alert and, when public, a tunnel row, public DNS and a probe from outside with an alert; see "Expose a service" in jvallery/estate-platform `docs/estate/GUIDE.md`.
- **Exclusive-lock migrations need a quiet database.** Pause the API, MCP and the operator API for the hook and avoid the scheduled compression and refresh jobs, as "Exclusive-lock windows" in `docs/runbooks/laptop-operator.md` describes; otherwise the migration deadlocks with them and the ingestor restarts.
- **This repository is public.** Keep credentials, internal addresses, device serial numbers and household details out of Git, issues and logs. `make firmware-deploy` reads the OTA password from the cluster; never print it.

## Neighbours

- jvallery/estate-platform: every Application and AppProject declaration (`gitops/applications/local-prod/verdify-*.yaml`), the Secret bundles, the tenant limits (`platform/tenant-bounds/verdify`, Application `verdify-tenant-bounds`) and the CloudNativePG operator.
- jvallery/network-infra: DNS, the Cloudflare tunnel entries for `*.verdify.ai`, the shared Traefik, the `*.verdify.ai` wildcard certificate and the `crm.verdify.ai` route.
- jvallery/storage-infra: NAS shares and static volumes (including the one behind `verdify-db-dumps`), StorageClasses, backup policy and off-site copies.
- jvallery/monitoring-stack: alert rules, probes and the estate dashboards over the product metrics. Product Grafana dashboards stay here.
- jvallery/homeassistant: Home Assistant entities, the MQTT broker on Home Assistant and the greenhouse device records.
- jvallery/estate-ci: the runner sets and reusable workflows.
- jvallery/verdify-www: the `verdify.ai` apex, `www` and `www-dev`. jvallery/crm: the CRM. jvallery/kepler: the `kepler-estate-operations` Role in each Verdify namespace.
