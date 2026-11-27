# Verdify Platform: k3s operations

This runbook records the k3s operating model, the development loop runnable from any kubectl-equipped host, the
repository sources of truth, firmware delivery, infrastructure dependencies and durable operational gotchas.

Use it with `README.md`, `AGENTS.md` and the focused runbooks linked below. The control design is the
[climate refactor plan](../design/climate-refactor-plan-2026-11-15.md): the controller decides climate alone with
the band-edge law and compiled constants, and the planner is a daily reviewer with no climate writes.

---

## 1. Operating model

- Work from the repository with kubectl, the in-cluster database and scoped runtime credentials. Keep code,
  schemas, migrations, CI, k8s manifests, Grafana dashboards and docs aligned on **`main`**.
- Live firmware, Argo CD, database, credential and public-edge changes need an explicit live command, scoped
  credentials, a passing preflight, observable verification and a retained rollback position.
- **The GitHub repository is the source of truth.** What is deployed is what is in Git (manifests, image digests,
  dashboards, migrations, firmware source). Never hand-edit live cluster resources as the durable fix: change Git,
  then sync.
- **Who decides what.** The controller decides every climate relay (`firmware/lib/climate_law.h`, constants in
  `verdify_schemas/climate_law.yaml`, generated table [`docs/climate-law-constants.md`](../climate-law-constants.md)).
  The host pushes only the house band's edges, the drying cost limit, the soft water budget, the operator switches,
  the lighting values and the irrigation program. The owner sets the band and the drying cost limit in the
  dashboard's band editor; no agent writes them. Iris reviews the day once and writes `planner_review` ([I/O](../planner/planner-io-schema.md)).

---

## 2. The dev loop, runnable from any kubectl host

- **Build, test, lint:**
  - `make setup` creates or updates the repo-local `.venv` from `pyproject.toml` (Python 3.12 or later).
  - `make ci` (`scripts/ci-local.sh`) is the full offline pre-merge gate; `make lint` (ruff) runs one piece of it.
    Wide runs belong on the CI runners, not on a workstation.
  - `make test` runs `tests/`, including smoke tests against the live stack; use it only when live access is
    intended.
  - Only the firmware preflight defaults to `VERDIFY_DB_BACKEND=kube` (Makefile `FIRMWARE_DB_BACKEND`). The other
    shell database helpers (`scripts/lib/psql-verdify.sh`) default to the retired docker backend, so export
    `VERDIFY_DB_BACKEND=kube` to reach the in-cluster database.
- **Database access** (reads are safe; mutations use the explicit live path):
  ```bash
  scripts/verdify-db.sh prod -c "SELECT count(*) FROM climate;"   # one-shot
  scripts/verdify-db.sh prod                                      # interactive psql
  scripts/verdify-db.sh prod --tunnel                             # local socket for psycopg/DBeaver
  ```
  It runs `psql` in `verdify-db-0` through `kubectl exec` (authentication in the pod; it never prints
  credentials). Production is the only environment and `verdify-db` the only database.
  - GOTCHA: `scripts/verdify-db.sh prod < file.sql` does **not** apply (stdin is swallowed). Apply SQL files with
    `kubectl exec -i -n verdify-prod verdify-db-0 -c postgres -- psql -U verdify -d verdify -v ON_ERROR_STOP=1 < file.sql`.
- **Deploy (one greenhouse environment):**
  ```text
  pull request with ci green -> merge to main
    -> GitHub Actions build (.github/workflows/build.yml, ARC set verdify-platform-build,
       Kaniko into the zot origin, tag gha-<sha12>, recorded by digest)
    -> pin PR: api/mcp/ingestor/migrate build candidates in overlays/prod kustomization images:
       (not rendered) and the dashboard-web digest
    -> promotion: digest-only release-pin commit (overlays/prod/release-pins.yaml)
    -> prod: explicit full sync of verdify-prod-dark after render/diff validation
  ```
  The build, pin and promotion flow is in [`prod-promotion.md`](prod-promotion.md); the sync mechanics are in
  [`laptop-operator.md`](laptop-operator.md) section 2. The prod sync is the only step that can touch the live writer.
  Pre-check with `kustomize build deploy/k8s/overlays/prod | kubectl diff -f -` and confirm the **ingestor
  Deployment** (the single device writer) changes only when intended. Argo CD app `verdify-prod-dark` is
  **manual sync, prune off**, so a manifest removed from Git leaves its live object until it is deleted by exact
  name after the sync. The setpoint-server and lab-publisher pins are edited by hand in
  `overlays/prod/kustomization.yaml`; the Hermes, Grafana image renderer and timescaledb digests are edited by hand
  in their own manifests. The dashboard web ships through its own automated app (`dashboard.md`).
- **Grafana dashboards** (not on the control path, safe to iterate): edit `grafana/dashboards/*.json`, run
  `python3 scripts/gen-grafana-dashboard-cms.py`, commit, then server-side apply the ConfigMap; the provisioner
  reloads on a **300 s** cycle (force with `kubectl -n verdify-prod rollout restart deploy/verdify-grafana`). Full
  recipe and gotchas: [`docs/grafana-graph-authoring.md`](../grafana-graph-authoring.md). Estate alert rules and
  dashboards live in jvallery/monitoring-stack; the product's single exposure point for them is the operator API's
  `/metrics`.

---

## 3. Repo == source of truth for what is deployed (and the drift watch)

| Surface | Source of truth in Git | Drift watch |
|---|---|---|
| k8s manifests | `deploy/k8s/overlays/prod` and its components | `kustomize build ... \| kubectl diff -f -` |
| Image digests | `overlays/prod/release-pins.yaml` for api, mcp, ingestor and migrate; `images:` in `overlays/prod/kustomization.yaml` for setpoint-server and lab-publisher (the build candidates there do not render); `deploy/k8s/dashboard/kustomization.yaml` for the dashboard web | live pod `@sha256` equals the rendered digests |
| Grafana dashboards | `grafana/dashboards/*.json`, rendered into generated ConfigMaps | **UI edits do not sync back: always edit the JSON** |
| DB migrations | `db/migrations/` (sequential, ledgered) | applied by the `verdify-migrate` PreSync hook; CI `migration-rollback-safety` check |
| Firmware (source) | `firmware/**`; law constants in `verdify_schemas/climate_law.yaml` | `diagnostics.firmware_version` equals the intended build (section 4); `climate_law_constants` equals the released hash |
| Secrets | names and keys only, in `deploy/k8s/SECRETS.md`; values are SOPS-encrypted outside this repository | the repo holds no SOPS files |

**Verify "live == main" end to end:** the working tree is clean and pushed; live pod digests equal the rendered
`overlays/prod`; `verdify-prod-dark` is Synced and Healthy; no open critical `alert_log` row;
`diagnostics.firmware_version` is the intended build and no `law_constants_mismatch` row is open.

---

## 4. Firmware delivery (safety-checked)

The controller is flashed through the **signed path**: an in-cluster build Job compiles, archives and signs one
exact revision, and an independent flasher Job verifies and uploads it (`scripts/firmware-release-job.py`). The
procedure, its post-flash checks, the close-out pin and the rollback triggers are in
[`firmware-signed-artifacts.md`](firmware-signed-artifacts.md); follow it. No toolchain or secret is needed on the
operator host. `make firmware-deploy` is the alternative from a host that has the toolchain, the device network
and a `secrets.yaml` reconstructed outside the repo (mode 0600, from the `verdify-firmware-ota` and
`verdify-app-secrets` Secrets and the IoT WLAN passphrase); never print any of them.

- **VERIFY the running firmware from telemetry, `diagnostics.firmware_version`, never from
  `firmware/artifacts/last-good.version`** (the rollback floor, which lags until a release is promoted):
  `scripts/verdify-db.sh prod -c "SELECT firmware_version, max(ts) FROM diagnostics WHERE firmware_version IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 1;"`
- **The preflight is mandatory** (`scripts/firmware-deploy-preflight.sh`; both paths run it). No flash while
  `alert_log` has an unresolved critical or legacy-high row; climate telemetry under 300 s old; controller-decision
  proof, which is the law's `climate_law_state` record under 120 s old and not reporting `no_temperature` or
  `humidity_invalid` (a build without the law falls back to the action-log proof); the irrigation topology
  confirmed; no relay cycling faster than its dwell allows; an outdoor source (`station` or `intake`) reported in
  the last 10 minutes; and a last-good or verified provisional rollback binary. There is no bake, minimum-age or
  weekly gate (2026-11-05): ship new builds as often as needed. Overrides need the documented reason-bearing
  environment values; the **critical-alert check protects the plants: investigate the alert rather than override
  it.**
- **Wet relays during an upload (#1276):** the upload blocks the main loop, so once the password check passes
  `ota.on_begin` closes every wet relay (L01 to L10 and fog). Fans, vent and heat keep their state until the
  reboot.
- **What a flash resets.** The controller's relays drop at the reboot. Under the law no climate relay is switched
  until the boot grace ends (from the fourth flash, #1738: a valid indoor temperature and every wall average
  computed over all four wall probes, or 60 s after boot, whichever comes first; before it, the first valid indoor
  temperature or 60 s); then every relay is available except the furnace, which waits one minimum off time (300 s; not at or below 40 F). The band
  edges, the drying cost limit and the soft water budget are kept in the controller's flash, and the law's
  constants are compiled, so a flash loses no climate setting. The ingestor writes an OFF edge at the boot
  time for every relay it held on, and one ON edge at max(first report, boot) for every relay first reported ON
  after the boot, so the daily record stays whole across the restart.
- **The post-flash reads** (beyond the signed runbook's table): `climate_law_state` rows resume within a minute;
  `climate_law_constants` equals the release's constants hash (else `law_constants_mismatch`); `diagnostics`
  carries the controller health columns (minute heap minimum, largest block, worst loop, restart count, NVS use,
  gap-log state); `diagnostics.band_source` reads `onchip_curve` (`corridor` means the band's clock is not yet
  trusted; it clears once a time server answers).
- **The manual sequence** with `make firmware-deploy` (it passes `FIRMWARE_DB_BACKEND`, default `kube`, through
  preflight, the version wait and both sensor-health sweeps):
  1. `VERDIFY_DB_BACKEND=kube bash scripts/firmware-deploy-preflight.sh`
  2. `FW_VERSION="$(date +%Y.%-m.%-d.%H%M).$(git rev-parse --short HEAD)"; echo "$FW_VERSION" > firmware/artifacts/pending-fw-version.txt`
  3. `ESPHOME_BIN=<esphome> SECRETS_SRC=<secrets.yaml> scripts/firmware-esphome-worktree.sh -s fw_version "$FW_VERSION" compile`, then the same with `upload --device <controller address>`
  4. `VERDIFY_DB_BACKEND=kube bash scripts/wait-for-firmware-version.sh "$FW_VERSION" --timeout 180`, then `VERDIFY_DB_BACKEND=kube EXPECTED_FW_VERSION="$FW_VERSION" make sensor-health SINCE='5 minutes'`
  5. `bash scripts/archive-firmware-artifacts.sh "$FW_VERSION"`, then pin the accepted version in the ingestor pod: `python3 scripts/firmware-release-job.py pin --firmware-version "$FW_VERSION" --submit`. `alert_monitor` reads only that pin (`/srv/verdify/state/expected-firmware-version` in the ingestor pod), so until it moves a healthy flash opens `firmware_version_mismatch`, which the sweep reports as a warning while live equals `EXPECTED_FW_VERSION`. Promoting the release to last-good (`--promote-last-good`, or `make firmware-promote-last-good` later) is a separate decision with no minimum wait.
- The post-flash sensor sweep checks each climate field. The historically absent south temperature, RH and VPD
  triplet is a warning only when a populated prior 24-hour baseline also has zero values for that field. A newly
  lost south reading, any other missing field, a Modbus timeout, a recent watchdog reset or a new critical sensor
  or control alert still fails the sweep.
- **When the accepted last-good binary is genuinely missing:** a separately verified recompile may be used only as
  a *provisional* automatic rollback target. Keep its own version, SHA-256 and provenance; do not copy it to
  `last-good.ota.bin` or call it accepted. Run `make firmware-deploy` from a clean checkout with
  `FIRMWARE_ROLLBACK_BIN=/absolute/path/to/candidate.ota.bin`, `FIRMWARE_ROLLBACK_SHA256=<verified 64-hex digest>`
  and a specific `FIRMWARE_OTA_FREEZE_OVERRIDE_REASON` (at least 12 characters). Preflight verifies and audits the
  candidate without bypassing the critical-alert or stale-telemetry checks.
- **Rollback targets.** Roll back on evidence only, through the flasher Job with the rollback release's exact
  revision and manifest. Every rollback target runs the law: a build from before the law would run on its boot
  values, because the host no longer pushes the old climate settings (plan decision 21). A fix to the law is a new
  law build.
- Firmware logic changes run the offline gates in `docs/agents/contracts.md` (Focused commands: `make
  test-firmware`, `make firmware-invariants`, the replay diff, `make firmware-check`); delivery is in
  `AGENTS.md` (Build, test, deploy, verify).

---

## 5. Infrastructure dependencies

1. **Firmware build and verified flash in the cluster:** separate suspended Job templates compile, archive and sign,
   and verify and flash. The builder needs an exact full source revision, cannot contact the controller and cannot
   promote last-good. The independent flasher needs the reviewed manifest hash and the pinned signature key;
   verification is its default action. No firmware is rebuilt during flashing.
2. **Secrets:** this repository keeps Secret names and keys only (`deploy/k8s/SECRETS.md`). Values are delivered from
   the Secret bundles in jvallery/estate-platform. Add no SOPS file here.
3. **Lab static publishing:** Quartz is the sole generator. The S3-backed `verdify-lab-publisher` builds and
   validates content every 30 minutes, then atomically updates the Longhorn cache served by content-free nginx. See
   [`docs/site-publishing-pipeline.md`](../site-publishing-pipeline.md). Do not add a `/mnt/iris` dependency or a
   second static-site generator.
4. **Durable context:** operational knowledge belongs in this runbook and the focused `docs/` set, and the backlog
   in GitHub issues, rather than in workstation-local notes.

---

## 6. Durable gotchas

- **Every new full Argo sync must atomically clear the prior terminal `status.operationState` and submit the exact
  revision with prune off and no resource selector**, guarded by the observed resourceVersion and no active
  operation. See `laptop-operator.md` section 2. On 2026-10-02 a prior full operation with no selectors produced a false
  Succeeded result at the new revision while hooks and workloads kept old digests. Verify new hook Pod UIDs, start
  times and images, and the running digests; revision, resource count and Synced/Healthy alone do not prove
  delivery.
- **Verify device firmware from `diagnostics.firmware_version`,** not `firmware/artifacts/last-good.version`.
- **The band has one source for host readers: `fn_band_setpoints`.** `fn_setpoint_at` and `setpoint_changes` are
  the settings ledger, never the band. The band store is `crop_band_anchors`; edit the band in the dashboard's band
  editor.
- **Stored on change.** `setpoint_snapshot` stores a readback when its value moved, when a write awaits
  confirmation, after a reconnect or restart, or at its hourly keyframe; take freshness from the
  `system_state` `setpoint_snapshot_pass` marker, not from the newest row. `relay_counters` is written only when a
  counter moved: no row for an interval means no switching. `climate_law_state` is a heartbeat of about 60 s plus
  every change.
- **The daily record** (`daily_record`, `daily_relay_record`, read through `v_daily_record`) takes starts and run
  seconds from the stored relay events, repaired for lost OFF edges; the relay counters are an independent check of
  them, not a second source. `fn_refresh_daily_record` stores today, yesterday and the day before on every run.
- **Outages are replayed.** The controller's gap log stores climate records and relay transitions in flash across a
  network outage and replays them on reconnect; the ingestor places them and writes one `gap_replay_quarters` row
  per replayed quarter. `v_data_gaps_unreplayed` is `data_gaps` with the replayed minutes cut out. A failed pass
  stays queued and is retried; the ingestor logs `gap replay pass of boot ... failed` (at most once a minute),
  `verdify_ingestor_gap_replay_failures_total` counts the failures, and the pass leaves no ledger row until it
  writes. Check after an outage with
  `scripts/verdify-db.sh prod -c "SELECT boot, qseq, first_ts, last_ts, climate_rows, transition_rows FROM gap_replay_quarters ORDER BY received_at DESC LIMIT 20;"`.
- **Exclusive locks stall the runtimes.** A migration qualification or a migrate hook that takes ACCESS EXCLUSIVE
  locks deadlocks with the MCP and API login attestation, and a lock held past about 15 s stops the ingestor. Pause
  MCP, the API and the operator API first (`laptop-operator.md` section 2, Exclusive-lock windows).
- **Never wrap a self-committing migration in an outer `BEGIN..ROLLBACK`** (the 2026-05-30 live-commit incident).
  Use `make migration-rollback-safety` and `scripts/check_migration_rollback_safety.py`.
- **Schema changes land first, consumers next; one migration at a time;** the drift guards
  (`verdify_schemas/tests/test_drift_guards.py`) are the wire protocol.
- **Grafana:** the provisioner reloads every 300 s; verify from the public `/render`, not the localhost
  port-forward API; server-side apply the large dashboards ConfigMap (client-side apply exceeds the annotation
  limit).

---

## 7. Authoritative doc map

- `AGENTS.md`, `README.md` and this runbook: start here.
- Control design: [the climate refactor plan](../design/climate-refactor-plan-2026-11-15.md) (the law, section 4;
  the reviewer, section 7; the daily record, section 10) and the generated constants table
  [`docs/climate-law-constants.md`](../climate-law-constants.md).
- The reviewer: [`docs/planner/planner-io-schema.md`](../planner/planner-io-schema.md).
- Graphs: `docs/grafana-graph-authoring.md` (with `grafana-brand-system.md` and `grafana-panel-catalog.md`).
- Ops runbooks in `docs/runbooks/`: `laptop-operator.md` (the database, sync and firmware-version command
  reference, runnable from any kubectl host), `prod-promotion.md`, `firmware-signed-artifacts.md`, `dashboard.md`.
- Tracker: GitHub issues on `jvallery/verdify-platform`.
