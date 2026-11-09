# Prod Promotion Runbook

Last updated: 2026-11-09 ([#1533](https://github.com/jvallery/verdify-platform/issues/1533)).
The model is in `ARGOCD.md` (Promotion Model). The sync mechanics are in
`docs/runbooks/laptop-operator.md` §2, and the delivery rules are in `AGENTS.md`
(Deliver and verify).

## How images are built

A merge to `main` runs the GitHub Actions `build` workflow
(`.github/workflows/build.yml`) on the ARC set `verdify-platform-build`. It uses
Kaniko and pushes each path-impacted image to the zot origin as
`registry.vallery.net/verdifyconsultancy/<image>`, tagged `gha-<sha12>` and
recorded by digest. Its `pin` job (estate-ci pin-bump, the only pin writer) opens
one PR. That PR records the api, mcp, ingestor, migrate and
experiment-v2-orchestrator digests as build candidates in the `images:` block of
`deploy/k8s/overlays/prod/kustomization.yaml`, which do not render, and moves the
dashboard-web digest. Do not hand-edit the candidate entries. If the push build
missed an image, run `build.yml` by `workflow_dispatch` from `main` and set the
`base` input to the last built commit. The in-cluster native pipeline
(`.agent-fleet/ci.yaml` and its Argo Workflows) is retired (#1397). Do not submit
Argo Workflows to build these images.

`build.yml` also builds the hand-pinned images: grafana-image-renderer,
hermes-agent and timescaledb, whose digests are edited by hand in their own
manifests, and the CI image verdify-esphome-ci, whose `ci-esphome` job-image
digest lives in jvallery/estate-ci `runners.yaml`. `verdify-twin` and
`verdify-ci-validate` have no current build path. Add a `build.yml` profile
before you promote either one.

## Promotion

1. Merge the candidate pin PR. This changes Git only.
2. Copy the candidate digests into `deploy/k8s/overlays/prod/release-pins.yaml`,
   the digests production runs, with `scripts/promote-release-pins.py` (#808).
   It copies all five by default, because the migrate hook carries the schema
   that the others expect. For an immutable source-only receipt, run this from
   clean tracked source:
   `python3 scripts/promote-release-pins.py --receipt /private/path/new-promotion.json`.
   The helper refuses an existing receipt path or a malformed candidate digest
   before it changes any release pin. The receipt records the exact
   promotion-input Git SHA, the candidate file hash, the release-pin hashes
   before and after, the selected changes and all five rollback pins. Keep the
   receipt with the release. Its Git SHA identifies the pin inputs, not the
   images' build source. CI, build provenance and the final Argo/runtime
   adoption need their own receipts. The command does no cluster, secret or
   device operation.
3. The planner, setpoint-server and lab-publisher-k3s release pins are edited by
   hand in `kustomization.yaml`.
4. Commit the digest-only change, let `ci` pass, and merge it.
5. In the same attended session, run the gated `verdify-prod-dark` sync. This is
   the device-write gate, and nothing in GitHub Actions syncs the cluster or
   restarts the ESP32 writer.

`main` is the canonical source branch. The retired `live/platform-main`,
`verdify-dev` and `verdify-staging` promotion chain is not part of the deploy
path.

## Operator Checks

Before you sync, check that the promotion PR's `ci` checks passed
(`gh pr checks <n>`) and diff the render against live (`AGENTS.md`, Deliver and
verify).

After the prod ArgoCD app is green, run read-only smoke checks from a host with
a scoped kubeconfig:

```sh
KUBECONFIG=/path/to/verdify-agent.config scripts/k3s-smoke.sh smoke \
  --expected-api-sha "$API_BUILD_SHA" --expected-api-digest "$API_DIGEST"
KUBECONFIG=/path/to/verdify-agent.config scripts/k3s-smoke.sh device-monitor
```

Set `API_BUILD_SHA` and `API_DIGEST` from the reviewed API build and Git pin
receipt before you run smoke. Smoke checks the exact API source and running
digest, fresh climate and action data, complete cfg readbacks, authenticated MCP
tools, DB health, and the operator API (Ready, the same digest, and `/readyz` at
that source). `device-monitor` checks that exactly one pod holds the ESP32
native API connection.

The earlier flows (GHCR until 2026-07, then the in-cluster native pipeline until
2026-11) are in this file's Git history.
