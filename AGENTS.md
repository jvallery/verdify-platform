# verdify-platform

Verdify is an AI-assisted control system for a real greenhouse. This repository holds the firmware of the ESP32 controller, the ingestor (the only host process that writes to the controller), the TimescaleDB database and its migrations, the API and MCP server, the daily reviewer agent (Iris), the lab site, the product Grafana and the operator dashboard. Production runs on Kubernetes in namespace `verdify-prod`, delivered from `main` by Argo CD. A change here can switch real fans, heaters, lights and irrigation valves.

This repository is public. Everything in it, and in its issues and pull requests, is readable by anyone. This file is the guide for every contributor and coding agent; building, testing and contributing need no access beyond this repository.

## This repository

- Its manifests render three namespaces: `verdify-prod` (the only environment; `verdify-db` is the only database), `verdify-dashboard` (the dashboard web tier) and `verdify-descheduler`.
- It holds the routes for `lab`, `labs`, `api`, `mcp`, `graphs` and `dashboard.verdify.ai`, and the catch-all for every other single-label `*.verdify.ai` host, which forwards to this repository's own Traefik (`verdify-traefik`) in `verdify-prod`.
- It holds the images that `.github/workflows/build.yml` builds, the PriorityClasses `verdify-*`, the scheduled jobs in `verdify-prod` and the Secret name and key contract in `deploy/k8s/SECRETS.md`. Secret values are not here, and the Argo CD Application definitions, DNS, the tunnel, storage and alert rules are kept by the maintainer outside this repository.
- It uses the greenhouse controller, its probes and two Shelly power meters.

Where things are:

- `firmware/` is the controller (`firmware/lib/climate_law.h` is the climate law). `ingestor/`, `api/`, `mcp/`, `hermes/` (Iris), `dashboard/`, `grafana/` and `site/` are the services. `db/migrations/` and `verdify_schemas/` are the data contract.
- `deploy/k8s/base`, `components/*` and `overlays/prod` render production; `deploy/k8s/dashboard/` and `deploy/k8s/descheduler/` render the other two namespaces.
- [docs/agents/contracts.md](docs/agents/contracts.md) has the control model, the cross-layer contracts, the generated files and the focused commands: read it before changing firmware, schemas, migrations or settings. A code comment or check message that cites "AGENTS.md rule 6" or "rule 7" means the readback rule and the restart rule in that file. `docs/CONTROL-ARCHITECTURE.md` and `docs/firmware-control-contract.md` explain the design. The current runbooks are indexed in [docs/runbooks/README.md](docs/runbooks/README.md). Most other files under `docs/` are finished project history (reviews, audits, plans, research); they are also the ingestor's content corpus, so they stay, but they are not instructions.

## Build, test, deploy, verify

**Set up and check.** `make setup` creates the repository `.venv` (Python 3.12 or later; CI uses 3.13). `make ci` is the full offline gate; it is heavy, so let the pull request run it and use `make lint`, one focused test target from `docs/agents/contracts.md`, or `kustomize build deploy/k8s/overlays/prod` locally. `make test` and `make check` are not offline checks: they run against the live stack (see Hazards).

**Contributing.** Work items are this repository's GitHub issues. Make the smallest complete change on a branch, open a pull request, and let the required checks run; a pull request merges when they are green. A change to `verdify_schemas/**`, `ingestor/entity_map.py` or `mcp/server.py` names its restart in the pull request body ("rule 7"). Pull requests from forks are refused by `ci/gha/trusted-precheck.sh`: a maintainer reviews a fork's change and pushes it as a branch of this repository to check it.

**Required checks.** The twelve `ci / …` contexts of `.github/workflows/ci.yml`, listed with their light paths in [docs/ci/ci-contexts.md](docs/ci/ci-contexts.md). They run on self-hosted runners through the reusable workflows of [jvallery/estate-ci](https://github.com/jvallery/estate-ci), called by commit SHA. The branch does not have to be up to date, and every push restarts the run, so rebase a green pull request only when GitHub reports a conflict. `ci/gha/trusted-precheck.sh` refuses a pull request whose base is not `main`, so stacked pull requests fail: base each on `main`. A `ci / secret-scan` (gitleaks) hit on a test or document string is fixed by rewording the line; `.gitleaks.toml` allowlists exact reviewed values only, never a pattern. The dashboard e2e settings fixture is rendered at test time from `verdify_schemas/tunable_registry.py` (`scripts/gen-dashboard-settings-fixture.py`), so a registry change can change what the e2e specs see, and only the in-cluster browser job runs them.

**Images.** A merge to `main` runs `build.yml` for the images whose paths changed. Its `pin` job opens one pull request that moves the dashboard-web digest and records the api, mcp, ingestor and migrate digests in the `images:` block of `deploy/k8s/overlays/prod/kustomization.yaml`. Those four entries are build candidates only: `release-pins.yaml`, applied after them, decides what production runs. Never edit the candidate entries by hand, because they race with the pin job. The whole of `docs/` is copied into the ingestor image as its content corpus, but a merge whose only changes to an image are files it copies and never runs (`docs/` apart from `docs/planner/`, and `verdify_schemas/tests/`) builds nothing and opens no pin pull request; the next build of that image ships them. To publish a corpus change on its own, dispatch `build.yml` with `base` set to a commit before it.

Each part of the system is delivered differently.

**Dashboard web: merging deploys.** The Argo CD Application `verdify-dashboard` syncs `deploy/k8s/dashboard/` from `main` automatically. The web is live when its pin pull request merges. Check it with `scripts/dashboard-smoke.sh --expected-web-sha <build commit>`. To switch off dashboard writes without a release, merge a one-line change of `DASHBOARD_WRITES_ENABLED` to `false` in that kustomization. Runbook: [docs/runbooks/dashboard.md](docs/runbooks/dashboard.md).

**Production (`verdify-prod`): merge, promote, then sync.** The Application `verdify-prod-dark` (the name is historical; it is production) reads `main` and has no automatic sync, so a merge changes Git only.

1. Run `python3 scripts/promote-release-pins.py`. It copies the candidate digests into `release-pins.yaml`, all four together, because the migrate image carries the schema the others expect. Commit that digest-only change and merge it. The setpoint-server and lab-publisher pins are edited by hand in the kustomization ([docs/runbooks/prod-promotion.md](docs/runbooks/prod-promotion.md)).
2. Diff the render (`kustomize build deploy/k8s/overlays/prod`) against the live objects. A sync applies every out-of-sync object, not only yours.
3. Sync the whole Application at the exact commit, with prune off and no resource list, using the procedure in [docs/runbooks/laptop-operator.md](docs/runbooks/laptop-operator.md) section 2. Argo CD skips every hook on a selective sync, so a named-object sync would not run the `verdify-migrate` hook and the new images would start against an old schema. Right after submitting, read `.status.operationState.operation.sync.resources`; it must be absent or empty. If it is not, stop and do not retry.
4. Delete by exact name any live object that the release removed from Git, and nothing else. Restart what the pull request's `Post-merge restart:` line names if the sync did not already roll it.

Then check it: the Application is Synced and Healthy at the release commit, `scripts/k3s-smoke.sh smoke --expected-api-sha "$API_BUILD_SHA" --expected-api-digest "$API_DIGEST"` passes, and `scripts/k3s-smoke.sh device-monitor` shows exactly one connection to the controller. After an ingestor rollout, watch the ingestor's logs for five minutes for `ValidationError` or `row failed schema validation`. The Application's health also reflects the last run of each CronJob, so a failed scheduled job shows it Degraded; find what failed before you blame a sync.

To roll back, commit a digest-only `release-pins.yaml` change to the previous pins, keeping a `verdify-migrate` digest that contains every applied migration, then sync and run the smoke checks again.

**Descheduler.** The Application `verdify-descheduler` reads `main` and has no automatic sync: after the merge, the objects you changed are synced at the merge commit. Read [deploy/k8s/descheduler/descheduler-arm.md](deploy/k8s/descheduler/descheduler-arm.md) first; the policy decides which production pods are evicted.

**Firmware.** Firmware reaches the controller only through the signed release Jobs (`scripts/firmware-release-job.py`, runbook [docs/runbooks/firmware-signed-artifacts.md](docs/runbooks/firmware-signed-artifacts.md)) or `make firmware-deploy`. Both run `scripts/firmware-deploy-preflight.sh`, which refuses to flash on an unresolved critical alert, stale telemetry or a missing rollback artifact. Verify the running version with the `diagnostics.firmware_version` query in `docs/runbooks/laptop-operator.md` section 3.

**Lab content.** The CronJob `verdify-lab-publisher` publishes S3 content to the lab site every 30 minutes; see [docs/runbooks/lab-content-pipeline.md](docs/runbooks/lab-content-pipeline.md).

**Secrets.** Secret values are delivered from outside this repository; `deploy/k8s/SECRETS.md` is the name and key contract the manifests rely on. Add no SOPS file here.

## Hazards

- **One writer to the controller.** Device writes happen only where `VERDIFY_DEVICE_WRITE_ENABLED=1`, which only `overlays/prod` sets. Keep the ingestor at one replica with the `Recreate` strategy: two writers would send the controller conflicting commands. A production sync recreates the ingestor when its pod spec changes, so check the diff and the controller connection every time. `verdify-setpoint-server` is a second writer (grow lights through Home Assistant) with a hand-set pin.
- **The controller must keep a safe fallback.** Flash only through the preflight. Roll back only to a build of the band-edge law; older firmware would run on its boot values because the host no longer sends the settings it expects. Never relabel a recovery candidate as `last-good`.
- **The band and the drying cost limit are the owner's.** They are written only from the dashboard band editor under the owner's sign-in. No agent, script or MCP tool writes a climate value; Iris only reviews.
- **Some make targets and scripts act on the live greenhouse.** `make test` and `make check` run against the live stack. `greenhouse-quiet-on` and `-off` change setpoints. `irrigation-feedback-finalize` and `irrigation-acceptance` resolve alerts. `hermes-restart` restarts Iris. `db-dump` overwrites `db/schema.sql`. `firmware-deploy` and `firmware-rollback` flash the controller. `scripts/dashboard-smoke.sh` with `--agent-write`, `--role operator` or `--lights` changes a real setting or switches the real main light and then restores it. `scripts/smoke-feedback-loop.py` writes synthetic rows to the database it reaches. Read a target before you run it.
- **Never prune or delete the database.** The StatefulSet `verdify-db`, its volume and the dump volume `verdify-db-dumps` hold years of telemetry. Pruning is off; removing a manifest leaves the live object, which is then deleted by exact name.
- **Migrations go forward only.** Never edit an applied migration, and never wrap a self-committing one in `BEGIN … ROLLBACK`: the inner commit lands on the live database. A dropped table comes back only from its archive.
- **A stricter schema silently drops data.** The ingestor logs and discards any row that fails its `verdify_schemas` model. Check live data before tightening a write model.
- **The production render must contain no Secret.** `kustomize build deploy/k8s/overlays/prod` must emit zero `kind: Secret`. Each placeholder Secret carries `config.kubernetes.io/local-config: "true"` as an annotation; as a label it would render, and the Argo CD project would reject the whole sync.
- **The catch-all route swallows new hostnames.** `verdify-tier1-forward` sends every single-label `*.verdify.ai` host that it does not exclude to this repository's Traefik. A host served from another namespace must be added to its exclusion list; Traefik priority does not separate them. A new hostname also needs DNS, a probe and an alert outside this repository: say so in its issue.
- **Exclusive-lock migrations need a quiet database.** Pause the API, MCP and the operator API for the hook and avoid the scheduled compression and refresh jobs, as "Exclusive-lock windows" in `docs/runbooks/laptop-operator.md` describes; otherwise the migration deadlocks with them and the ingestor restarts.
- **Keep private details out.** Credentials, internal addresses, host and node names, device serial numbers and household details stay out of Git, issues and logs. `make firmware-deploy` reads the OTA password from the cluster; never print it.

## Neighbours

- [jvallery/estate-ci](https://github.com/jvallery/estate-ci) (public): the reusable workflows and the `verdify-platform-*` runner sets.
- Home Assistant: the entities, the MQTT broker and the greenhouse device records that the ingestor and the setpoint server use.
- Everything else production depends on (the Argo CD Applications and projects, the Secret values, DNS and the tunnel for `*.verdify.ai`, the shared Traefik and certificates, NAS shares and backups, alert rules and probes, the `verdify.ai` website and the CRM) is maintained outside this repository. An issue here that needs a change there says so; the maintainer carries it. Product Grafana dashboards stay here.
