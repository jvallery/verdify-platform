# CI contexts: required checks and light paths

The `main` branch rule requires the thirteen `ci / …` contexts of `.github/workflows/ci.yml`
(`strict` false: a branch need not be up to date). Change this file in the same pull request
that changes `ci.yml` or the branch rule. Required contexts are written as the whole
`required_status_checks.checks` list, each bound to the GitHub Actions app (STD-CI-01), never
through `POST .../contexts`; rolling back is writing the previous list back.

| Context | What it covers |
|---|---|
| `ci / trusted-precheck` | refuses fork pull requests and untrusted events |
| `ci / path-impact` | classifies the change (light paths below) |
| `ci / validate` | aggregate of the validate parts: containment-firmware, pure-logic-1, pure-logic-2, rest |
| `ci / dashboard` | the dashboard checks, when its path impact selects them |
| `ci / campaign` | aggregate of the `campaign-qualification-<i>of4` shards |
| `ci / lint` | lint |
| `ci / platform-static` | aggregate of the validate parts (its ruff passes are a subset of validate-rest's) |
| `ci / platform-tests` | aggregate of the validate parts, which run every platform test |
| `ci / firmware-logic` | aggregate of the validate parts; `containment-firmware` runs the firmware logic, gap-log, override-replay, running-alone, climate-law and invariant suites |
| `ci / firmware-secretless-compile` | aggregate of the two compile shards (`-greenhouse`, `-greenhouse-recovery`) |
| `ci / campaign-qualification` | aggregate of the four campaign-qualification shards |
| `ci / buildcheck` | builds the impacted images without pushing; on push it reports the skipped impact as a pass |
| `ci / secret-scan` | gitleaks over the checked-out tree (`ci/gha/gitleaks.sh`, `.gitleaks.toml`); runs on every event, no path filter |

Shard contexts are not required themselves; their aggregate is. Every job and shard should finish
within 15 minutes (STD-CI-03); `validate-pure-logic-2` and `ci / dashboard` (when it runs) sit near
that line.

## Light paths

The `ci / path-impact` job (a direct job, so its outputs reach the other jobs; it
runs `trusted-precheck.sh` itself and starts beside `ci / trusted-precheck`)
classifies the change with `ci/gha/verdify_path_impact.py`. Every required context
still reports; a check that the class does not need passes as "not impacted":

| Class | When | What runs |
|---|---|---|
| `pins` | every changed path is `deploy/k8s/overlays/prod/kustomization.yaml`, `deploy/k8s/overlays/prod/release-pins.yaml` or `deploy/k8s/dashboard/kustomization.yaml`, and only `sha256:` digest values or comment lines differ | the validate `pins` part (`ci/gha/pins-check.sh`: both renders, zero `kind: Secret` in the prod render, the pin-shape and release-pin tests), secret-scan, lint, buildcheck |
| `docs` | every changed path is Markdown whose file name no file under `tests/`, `verdify_schemas/tests/`, `scripts/`, `ci/`, `.github/` or the `Makefile` mentions | secret-scan, lint, buildcheck (the ingestor image copies `docs/`), dashboard when its own flag selects it |
| `verified` | push to `main` only (#1716 C1): the commit is a merged pull request's merge commit, a successful `pull_request` run of `ci` for that pull request's head logged `VERDIFY_TESTED_TREE` equal to this commit's tree (`ci/gha/verified_on_pr.py`; any API error or mismatch is full) | secret-scan, lint, the aggregates (each passes as "not impacted") |
| full | anything else, every classifier fallback, and the nightly `schedule` run (09:17 UTC, no base) | everything, as before |

Independently, `firmware-check` (the firmware tree, `ci/esphome-ci.Dockerfile`,
`ci/gha/**` or `.github/workflows/**` changed) selects the two
`firmware-secretless-compile` shards. The firmware native tests,
replay invariants and the rule 6, rule 7 and replay-diff gates stay in the validate
`containment-firmware` part of every full run. Skipped shard matrices are never
required contexts: their aggregates fail unless `path-impact` succeeded and either
every shard succeeded or the class skipped the matrix (`ci/gha/require-success.sh`,
`tests/test_gha_ci_light_paths.py`).

Placement (#1716, estate-ci#229 C3): `ci / trusted-precheck`, `ci / path-impact`,
`buildcheck-impact` and every aggregate run on `verdify-platform-ci-gate` (runner
container only, warm, slot-free), so a docs-only or pin-only run no longer queues
behind validate or campaign shards on `verdify-platform-ci` or `-ci-tools`.

## STD-CI-03 exceptions

None. Add a row here, with its reason and exit, if a job or shard goes over 15 minutes.
