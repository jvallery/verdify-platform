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
| `ci / platform-static` | required (#1535 Q1 default a: added with the branch-rule write that follows the shard PR) | 0.3 / 0.4 | 12 of 12 main runs green since 2026-11-09 |
| `ci / platform-tests` | required (#1535 Q1 default a, as above) | 2.2 / 2.5 | 12 of 12 main runs green since 2026-11-09 |
| `ci / firmware-logic` | required (#1535 Q1 default a, as above) | 0.6 / 0.9 | 12 of 12 main runs green since 2026-11-09 |
| `ci / firmware-secretless-compile` | advisory until it passes 10 consecutive main runs on the `verdify-esphome-ci` job image and the aggregate is green on 3 main runs, then required | aggregate | two target shards, `ci / firmware-secretless-compile-greenhouse` (also runs the generated-cpp negative) and `ci / firmware-secretless-compile-greenhouse-recovery`; unsharded baked p50 was 20.6 (2026-11-12) |
| `ci / campaign-qualification` | advisory until the aggregate is green on 3 main runs, then required | aggregate | four shards `ci / campaign-qualification-<i>of4` of the tool's default selection; unsharded p50 was about 39.6 (2026-11-12) |
| `ci / buildcheck` | advisory until it is green on the last 10 PR and main runs, then required (carried from #1534 to #1535; `VERDIFY_BUILDCHECK` is `true` since 2026-11-10) | new | on push it reports the skipped impact as a pass |

The 30-run window is #1535's acceptance: 30 consecutive `main` runs, at least 90
percent successful and none displaced. `platform-static`, `platform-tests` and
`firmware-logic` are required before the window closes (#1535 Q1, default a: each has
a clean record on main and on PRs and its rollback is one API call). The two sharded
aggregates and `buildcheck` follow once their own gates above hold. Required contexts
are written as the whole `required_status_checks.checks` list, each bound to
`app_id` 15368 (STD-CI-08), never through `POST .../contexts`; rollback is writing the
saved previous list back.

Shard rows: the shard contexts are not required themselves; their aggregate is. Re-read
each shard's p50 after 3 main runs with the sharded jobs and remove its STD-CI-03 row
below once that p50 is within 15 minutes.

## STD-CI-03 exceptions

| Job | Recorded | Review by | Reason and exit |
|---|---|---|---|
| `ci / campaign-qualification` | 2026-11-09 | 2026-12-09 | One process ran about 27 test files serially; p50 about 39.6 min on 2026-11-12. Sharded four ways by #1535 (`campaign-qualification-<i>of4`). Exit: each shard's p50 within 15 min over 3 main runs, then delete this row. |
| `ci / firmware-secretless-compile` | 2026-11-09 | 2026-11-23 | p50 20.6 min on the baked image (2026-11-12), so the "re-read under 15 min" exit failed and the two targets now compile as two shards (#1535). Exit: each shard's p50 within 15 min over 3 main runs, then delete this row. |
