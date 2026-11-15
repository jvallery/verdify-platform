# CI contexts: required, advisory and STD-CI-03 exceptions

The record #1535 asks for: which `ci.yml` check contexts gate merges to `main`, which
are advisory and why, and the dated STD-CI-03 exceptions (each job or shard within
15 minutes). Change this file in the same PR that changes `ci.yml` or the `main`
branch rule.

Durations: p50/p90 in minutes over the last 25 completed (not cancelled) `ci` runs,
read from `gh api actions/runs/<id>/jobs` on 2026-11-09. The shard rows for
`firmware-secretless-compile` and `campaign-qualification` were re-read on 2026-11-15
over the 10 latest `main` runs (931dc223..18ed4f00, all sharded, all first-attempt
green), counting only jobs that ran at least a minute (a path-skipped part reports in
seconds).

| Context | Gate | p50 / p90 | Note |
|---|---|---|---|
| `ci / trusted-precheck` | required | 0.2 / 0.2 | |
| `ci / path-impact` | required | 0.2 / 0.3 | |
| `ci / validate` | required | aggregate | parts: containment-firmware 10.4 / 14.1, pure-logic-1 8.7 / 10.0, pure-logic-2 11.8 / 13.5, rest 5.5 / 6.8 |
| `ci / dashboard` | required | 0.2 / 0.4 | |
| `ci / campaign` | required | aggregate | four shards, each p90 at most 10.7 |
| `ci / lint` | required | 0.2 / 0.2 | |
| `ci / platform-static` | required since 2026-11-13T22:46Z (#1535 Q1 default a) | 0.3 / 0.4 | 12 of 12 main runs green since 2026-11-09 |
| `ci / platform-tests` | required since 2026-11-13T22:46Z (#1535 Q1 default a) | 2.2 / 2.5 | 12 of 12 main runs green since 2026-11-09 |
| `ci / firmware-logic` | required since 2026-11-13T22:46Z (#1535 Q1 default a) | 0.6 / 0.9 | 12 of 12 main runs green since 2026-11-09 |
| `ci / firmware-secretless-compile` | required since 2026-11-15T15:2xZ (#1535 step 4 part 2; gates: 10 consecutive green main runs on the `verdify-esphome-ci` job image, 931dc223..18ed4f00, each shard log with 0 platform/tool downloads and `platformio_core: baked`) | aggregate | two target shards: `firmware-secretless-compile-greenhouse` 7.7 / 9.1 (also runs the generated-cpp negative) and `firmware-secretless-compile-greenhouse-recovery` 6.9 / 9.3; unsharded baked p50 was 20.6 (2026-11-12) |
| `ci / campaign-qualification` | required since 2026-11-15T15:2xZ (#1535 step 4 part 2; gate: aggregate green on the 10 latest main runs) | aggregate | four shards `campaign-qualification-<i>of4` of the tool's default selection: 1of4 6.9 / 11.4, 2of4 6.6 / 15.3, 3of4 7.2 / 8.8, 4of4 5.0 / 7.2; unsharded p50 was about 39.6 (2026-11-12) |
| `ci / buildcheck` | required since 2026-11-15T15:2xZ (#1535 step 4 part 2, carried from #1534; gate: green on the 10 latest main runs and the 10 latest non-cancelled PR runs, 4 of which built images) | aggregate | on push it reports the skipped impact as a pass; `VERDIFY_BUILDCHECK` is `true` since 2026-11-10 |

The 30-run window is #1535's acceptance: 30 consecutive `main` runs, at least 90
percent successful and none displaced. `platform-static`, `platform-tests` and
`firmware-logic` are required before the window closes (#1535 Q1, default a: each has
a clean record on main and on PRs and its rollback is one API call). The two sharded
aggregates and `buildcheck` were added on 2026-11-15 once their gates held, so every
`ci.yml` summary context now gates `main` (12, `strict` false). Required contexts
are written as the whole `required_status_checks.checks` list, each bound to
`app_id` 15368 (STD-CI-08), never through `POST .../contexts`; rollback is writing the
saved previous list back.

Shard rows: the shard contexts are not required themselves; their aggregate is. Every
shard's p50 is within 15 minutes (re-read 2026-11-15, above), so both STD-CI-03 rows
were removed. Watch list, not exceptions: `validate-pure-logic-2` (p50 13.2, p90 15.6
over the same 10 runs) and `ci / dashboard` when its path impact runs it (13.1-16.4 on
the 3 such runs) sit near the line.

## STD-CI-03 exceptions

None. The `campaign-qualification` (recorded 2026-11-09, review 2026-12-09) and
`firmware-secretless-compile` (recorded 2026-11-09, review 2026-11-23) rows were removed
on 2026-11-15 after their shards' p50s came in within 15 minutes (#1535). Add a dated row
here, with its reason and exit, if a job or shard goes over again.
