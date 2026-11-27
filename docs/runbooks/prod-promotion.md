# Prod Promotion Runbook

The delivery paths are in `AGENTS.md` (Build, test, deploy, verify). The sync mechanics are in
`docs/runbooks/laptop-operator.md` section 2. This page has the image set, the promotion steps, the checks and rollback.

## How images are built

A merge to `main` runs the GitHub Actions `build` workflow (`.github/workflows/build.yml`) on the ARC set
`verdify-platform-build`. It uses Kaniko and pushes each path-impacted image to the zot origin as
`verdifyconsultancy/<image>`, tagged `gha-<sha12>` and recorded by digest. Its `pin` job (estate-ci pin-bump, the
only pin writer) opens one PR. That PR records the api, mcp, ingestor and migrate digests as build candidates in
the `images:` block of `deploy/k8s/overlays/prod/kustomization.yaml`, which do not render, and moves the
dashboard-web digest. Do not hand-edit the candidate entries. If the push build missed an image, run `build.yml` by
`workflow_dispatch` from `main` and set the `base` input to the last built commit. Do not build these images any
other way.

The production images are the four promoted ones (verdify-api, verdify-mcp, verdify-ingestor, verdify-migrate),
the two hand-pinned ones (verdify-setpoint-server, verdify-lab-publisher-k3s) and the dashboard web
(verdify-dashboard-web, pinned in `deploy/k8s/dashboard/kustomization.yaml`). The operator API runs the verdify-api
digest. `build.yml` also builds verdify-grafana-image-renderer, verdify-hermes-agent (the Iris reviewer) and
verdify-timescaledb, whose digests are edited by hand in their own manifests, and the CI image verdify-esphome-ci,
whose `ci-esphome` job-image digest lives in jvallery/estate-ci `runners.yaml`. An image outside `build.yml` has no
build path; add a `build.yml` profile before you promote it.

## Promotion

1. Merge the candidate pin PR. This changes Git only.
2. Copy the candidate digests into `deploy/k8s/overlays/prod/release-pins.yaml`, the digests production runs, with
   `scripts/promote-release-pins.py` (#808). It copies all four by default, because the migrate hook carries the
   schema that the others expect. It refuses a malformed candidate digest before it changes any release pin, and
   does no cluster, secret or device operation. `--receipt <path outside the repository>` also writes a JSON
   summary (input Git SHA, candidate file hash, release-pin hashes before and after, the four rollback pins) to
   scratch; the previous pins are also in the Git history of `release-pins.yaml`.
3. The setpoint-server and lab-publisher-k3s release pins are edited by hand in `kustomization.yaml`: take the
   `digest` output of that image's job in the merge's `build` run, or resolve its `gha-<sha12>` tag on the zot
   origin.
4. Commit the digest-only change, let `ci` pass, and merge it.
5. Run the full `verdify-prod-dark` sync (prune off, no `resources`) and stay with it through the checks below.
   This sync is the only step that reaches the device writer; nothing in GitHub Actions syncs the cluster or restarts the controller's writer. The
   `verdify-migrate` PreSync hook applies the release's migrations in ledger order. The app reads an in-cluster Git
   mirror, which carries a merge within about 2 minutes; if Argo still compares against the old revision after
   that, a hard refresh makes it read the mirror again. When a migration in the release takes exclusive locks,
   pause MCP, the API and the operator API for the hook and recreate the planner pod afterwards, as
   `laptop-operator.md` section 2 (Exclusive-lock windows) describes.
6. Delete, by kind and exact name, the live objects that the release's pull request lists as removed: the app
   syncs with prune off, so a removed manifest leaves its object behind.
7. Restart what the pull request names in its `Post-merge restart:` line when the sync's pod-spec changes did not
   already roll it.

`main` is the canonical source branch and production the only environment.

## Operator checks

Before you sync, check that the promotion PR's `ci` checks passed (`gh pr checks <n>`) and diff the render against
live (`AGENTS.md`, Build, test, deploy, verify).

After the prod Argo CD app is green, run the read-only smoke checks from a host with a scoped kubeconfig:

```sh
KUBECONFIG=/path/to/verdify-agent.config scripts/k3s-smoke.sh smoke \
  --expected-api-sha "$API_BUILD_SHA" --expected-api-digest "$API_DIGEST"
KUBECONFIG=/path/to/verdify-agent.config scripts/k3s-smoke.sh device-monitor
```

Set `API_BUILD_SHA` and `API_DIGEST` from the API build and the promoted `release-pins.yaml` before you run smoke.
Smoke checks the exact API source and running digest; the controller-decision proof (the law's
`climate_law_state` record under 120 s old, or the action log on a build without the law); fresh readbacks, judged
by the `setpoint_snapshot_pass` marker because readbacks are stored on change; that every MCP replica authenticates
and returns the exact Iris tool inventory; database health; and the operator API (Ready, the same digest, and
`/readyz` at that source). `device-monitor` checks that exactly one pod holds the controller's native API
connection.

Then watch `kubectl -n verdify-prod logs deploy/verdify-ingestor` for five minutes for `ValidationError` or
`row failed schema validation`, and confirm the migration ledger reached the release's newest migration:

```sh
scripts/verdify-db.sh prod -c "SELECT max(seq) FROM schema_migrations WHERE source = 'db/migrations';"
```

## Rollback

Commit a digest-only `release-pins.yaml` change back to the previous pins (the file's Git history), keeping a
`verdify-migrate` digest that contains every applied migration (migrations run forward only), then run the full
sync and `scripts/k3s-smoke.sh smoke` against the rolled-back API digest.
