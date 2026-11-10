# CI contexts: required, advisory and STD-CI-03 exceptions

The record #1535 asks for: which `ci.yml` check contexts gate merges to `main`, which
are advisory and why, and the dated STD-CI-03 exceptions (each job or shard within
15 minutes). Change this file in the same PR that changes `ci.yml` or the `main`
branch rule.

Durations: p50/p90 in minutes over the last 25 completed (not cancelled) `ci` runs,
read from `gh api actions/runs/<id>/jobs` on 2026-11-09.

| Context | Gate | p50 / p90 | Note |
|---|---|---|---|
| `ci / trusted-precheck` | required | 0.2 / 0.2 | |
| `ci / path-impact` | required | 0.2 / 0.3 | |
| `ci / validate` | required | aggregate | parts: containment-firmware 10.4 / 14.1, pure-logic-1 8.7 / 10.0, pure-logic-2 11.8 / 13.5, rest 5.5 / 6.8 |
| `ci / dashboard` | required | 0.2 / 0.4 | |
| `ci / campaign` | required | aggregate | four shards, each p90 at most 10.7 |
| `ci / lint` | required | 0.2 / 0.2 | |
| `ci / platform-static` | advisory until the 30-run window, then required | 0.3 / 0.4 | |
| `ci / platform-tests` | advisory until the 30-run window, then required | 2.2 / 2.5 | |
| `ci / firmware-logic` | advisory until the 30-run window, then required | 0.6 / 0.9 | |
| `ci / firmware-secretless-compile` | advisory until it passes 10 consecutive main runs on the `verdify-esphome-ci` job image, then required | 15.1 / 23.8 | p50 over 15 min while it downloads the toolchain each run; the baked image removes that download |
| `ci / campaign-qualification` | advisory until the 30-run window, then required | 29.8 / 42.0 | STD-CI-03 exception below |
| `ci / buildcheck` | advisory until `VERDIFY_BUILDCHECK` is on and it is stable, then required (#1534) | new | |

The 30-run window is #1535's acceptance: 30 consecutive `main` runs, at least 90
percent successful and none displaced. Required contexts are added only after it,
so a flake cannot block merges; rollback is removing the context from the rule.

## STD-CI-03 exceptions

| Job | Recorded | Review by | Reason and exit |
|---|---|---|---|
| `ci / campaign-qualification` | 2026-11-09 | 2026-12-09 | One process (`verdify-campaign-ci` in the agents-ci-tools image) runs about 27 test files serially; p50 29.8 min. Exit: shard it the way `campaign` and `validate` are sharded, with an aggregate context. |
| `ci / firmware-secretless-compile` | 2026-11-09 | 2026-11-23 | p50 15.1 min including the per-run PlatformIO download. Exit: the ci-esphome set runs the `verdify-esphome-ci` image (`ci/esphome-ci.Dockerfile`) and the p50 is re-read under 15 min; otherwise compile the two targets as two shards. |
