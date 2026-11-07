# Planner study controls: AI planner (Hermes) versus a frozen baseline

Status: design and slice 1 implementation (#1360, 2026-11-07). Related: [decisions](decisions.md),
[screens](screens.md), study definition `verdify_schemas/planner_ab_winter_2026.yaml`, research
`docs/research/w5/planner-ab.md`.

## Inputs

- **Jason, 2026-11-07:** resume the AI-planner-versus-baseline study with **Hermes as the AI arm**. The
  dashboard gives him management controls (start, pause, stop and the arm schedule) and visibility
  (assignments, per-arm outcomes, cost and status).
- **Jason, 2026-11-07 (#1482 addendum):** Cortex shadow runs after #1482 (repair attempt with thinking off,
  `max_tokens` 24,000, deadline 900 s) are a different treatment. They are never pooled with the earlier
  shadow runs.
- **Jason, 2026-11-06:** Hermes stays the authoritative planner and the Cortex planner keeps running in
  shadow, with no cutover. This replaces the 2026-11-05 plan to make the Cortex planner the AI arm.
- The study design itself is unchanged from #1359 and the reviewed definition: two arms, 30 adjacent day
  pairs in a seeded order, an 11:00 local boundary, a 3 h washout, night VPD in band as the primary metric
  and temperature in band as a guardrail with a 2-point margin.

## What exists today

| Piece | Where | What it can do for this study |
|---|---|---|
| experiment-v2 orchestrator (lifecycle, selector, freezer) | `experiment_orchestrator/`, Deployments `verdify-experiment-v2-*` | Built for ADR-0010's confirmed-component switchback. Lifecycle calls `fn_experiment_v2_boundary_cycle` and `fn_experiment_v2_direct_launch_cycle`, which is hard-wired to the closed record `45039c86…`. Selector picks one of three hot/dry profiles. Freezer freezes component outcomes. All three run `capability_off`. The duty roles are attested against an exact function list, so any new function means changing the attestation and the roles together. |
| Experiment API | `api/main.py` `/api/v1/experiments/*` | Legacy protocol-v1 transitions and protocol-v2 component control behind the experiment token, not the dashboard session. `control_experiments` rows with protocol 2 change only through v2 functions (trigger guard). `control_assignments` rows are immutable and `randomized_day` arms must be the blinded `X`/`Y`. |
| Study definition | `verdify_schemas/planner_study.py`, `planner_ab_winter_2026.yaml` | Arms, metrics, schedule, looks and stopping rules. `preregistered` is false: the seed, schedule hash and baseline hash are still null. |
| Planner section reads | `verdify_services/planner.py`: API-25 (history and cost), API-26 (experiments), API-27 (one study); migration 302 views | Lists the defined study and the closed 2026-08 record. Shows the design, an empty arm calendar, results `not_started` and no outcomes. |
| Dashboard | `dashboard/app/routes/planner-experiments.tsx` | Read only: "the study is started and stopped by the orchestrator, never here". |
| Desired state and the manual flag | `verdify_services/settings.py` (API-10, API-11), dispatcher `resolve_effective` | A `manual: true` desired value wins over the plan whatever the plan's age. Iris's `set_setting` is refused on it. The dispatcher pushes it through every fence and re-asserts it after a controller reconnect. Readback state (`requested`, `confirmed`, `not_confirmed`) is computed per setting. All 48 `PLANNER_PUSHABLE_REG` fields are desired-writable. |
| `activity_log` | written by every operator API write | Who, when, why, request id and a `detail` object. It is append-only, and the dashboard duty can read and write it. |
| Operator API background sweeps | `api/operator_routes/light_timer.py` | The precedent for a restart-safe timer: the row is the timer, and each sweep re-reads it. |
| Planner cost | `planner_inference_runs` through `v_planner_inference_runs` | Cortex shadow calls only: tokens, energy, latency, status, attempt kind. Hermes records no per-call cost anywhere. |

## Need, capability, gap

| Need | Existing capability | Gap | Resolution in this slice |
|---|---|---|---|
| **Start** a study run | Orchestrator `lock-design` / `approve-day1` for the closed v2 record only | No path for a new study, and no dashboard write | API-28 `start`. It checks that the definition is preregistered, that the committed baseline file matches its hash, that no run is active and that no person or agent holds any of the 48 fields manual. It then records `study.start` with the run id, first day, seed, schedule hash and baseline hash. |
| **Pause / resume** | `set_admission` emergency hold (v2 only) | None for a planner study | API-28 `pause` releases the study's holds now, so Hermes dispatches as normal. If a pair was under way, that whole pair is void and runs again after the resume. API-28 `resume` places the remaining pairs from the next boundary, in their seeded order. |
| **Stop** | `abort` (v1) | None | API-28 `stop` releases the holds and ends the run. The days already done stay recorded. |
| **Arm schedule** | Seeded randomizer in the v2 selector (an OpenAI call, retired) | No schedule for this study | Arm order is a pure function of the committed seed: a coin flip within each adjacent pair. `schedule_sha256` is that order's hash and is committed with the seed before day 1. Days are placed from the first day Jason picks at Start, and re-placed by pause and resume, never re-drawn. The calendar shows every placed day with its arm and status. |
| **AI arm = Hermes** | Hermes writes plans; the dispatcher sends `source='plan'` | — | Nothing changes on AI days: the study releases its holds at the boundary and Hermes's plans apply. |
| **Baseline arm** | ADR-0010 whole-vector restore (component path, not used) | No way to freeze the 48 fields or to keep Hermes's plans off the device | At the boundary the runner writes each of the 48 fields as a `manual: true` desired value equal to the locked baseline vector, as `system:planner_study`. Manual wins over any plan, so Hermes's plans for that day are stored in `setpoint_plan`/`plan_journal` and not dispatched: they are propose-only. The runner never overwrites a field someone else holds manual; that field is a deviation for the day. |
| **Readback-confirmed boundary** | Per-setting readback state | — | The runner reads the 48 fields' readback state. The boundary is confirmed when every field reads `confirmed` within 15 min. Otherwise it records one `study.deviation` (`boundary_unconfirmed`, with the fields) and never loops. Resending is the dispatcher's own job; it also re-asserts after an ESP32 reboot. |
| **Status** | API-26 shows `defined` | No run state | API-26 and API-27 derive the run's status (`scheduled`, `running`, `paused`, `finished`, `stopped`) from its `study.*` activity rows. API-27 adds `run`: the arm and day in force now, the holds in force and confirmed, the last boundary result and the next boundary. |
| **Assignments** | Calendar from `control_assignments` (empty) | — | The API-27 calendar comes from the run: each placed day with its date, pair, arm and status (`scheduled`, `active`, `done`, `void`, `cancelled`), its boundary result and its deviations. |
| **Per-arm outcomes** | `outcomes: []` until the frozen analyzer runs | No `study_day_outcomes` freezer and no analyzer | Each finished day gets live operational values from tables the dashboard duty reads: heat1, heat2, vent, fan, fog and mister minutes (`equipment_state`), required plans written (`planner_trigger_ledger`) and plan changes dispatched (`setpoint_changes`). The per-arm summary is the mean per arm, labelled "live, not the frozen analysis". The climate metrics (night VPD in band, temperature in band, errors) stay null with their reason until the freezer lands (follow-up below). |
| **Cost** | API-25 day cost from `v_planner_inference_runs` | Hermes cost is not recorded; Cortex cohorts not split | Per arm day: Hermes plans written and changes dispatched. Cortex shadow calls, tokens and energy by cohort: `cortex-pre-1482` and `cortex-1482`, split at the cohort's start time in the study definition and never pooled. Runs after the #1482 merge but before that start time is set read as `unattributed`. |
| **Write authorization** | Operator API: GET for viewers and operators, other methods for operators only; actor from the session; `Idempotency-Key`; one `activity_log` row per write | — | API-28 uses the same model: operator only, actor from the session, idempotent, one `study.<action>` row with the reason. The BFF's `DASHBOARD_WRITES_ENABLED` gate applies. |

## Why the operator API runs the boundaries, not the orchestrator

#1360 expected the experiment-v2 lifecycle duty to own the boundaries. With Hermes as the AI arm, the boundary
is 48 desired-state writes and a readback check, and the operator API already owns that path: validation,
snapping, the manual flag, attribution, idempotency and readback state (`verdify_services.settings`). The
orchestrator's roles can call only their attested `fn_experiment_v2_*` functions. Teaching them desired state
would mean new SECURITY DEFINER functions, a new attested function list and a migration that changes the
experiment duties. Using `control_experiments`/`control_assignments` would collide with the protocol-v2 guard,
the immutable blinded `X`/`Y` assignments and the 45039c86-specific direct-launch path. So:

- The run is recorded only in `activity_log` (`study.start`, `study.pause`, `study.resume`, `study.stop`,
  `study.boundary`, `study.deviation`), with the run id in `detail`. The schedule is computed from those rows
  and the committed seed. **No migration** is needed; no runtime seal (api, ingestor, MCP) moves.
- `operator_routes/planner_study_runner.py` sweeps every 60 s in the operator API, like `light_timer`. Each
  sweep re-reads the rows, so a restart or rollout loses nothing. Writes use idempotency keys derived from the
  run, day and field, so a repeated sweep replays rather than writing twice. A transaction advisory lock
  serializes the sweep and the API-28 writes.
- The experiment-v2 orchestrator stays `capability_off`. Its selector's OpenAI egress is already cut (#1351).

## Run semantics

- **Day:** study day D runs from 11:00 America/Denver on D to 11:00 on D+1, so each arm owns one night. The
  first 3 h are washout (scored by the analyzer, not by the runner).
- **Start:** `first_day` must be a date whose 11:00 boundary is still ahead. Until then the run is `scheduled`
  and nothing is held. Start also refuses when the baseline vector is outside the current
  `planner_effective_bounds`, or when any of the 48 has a desired row someone else wrote, manual or not, so
  day 1 begins from plans alone.
- **Baseline day:** at its boundary the runner writes the 48 baseline values as manual. **AI day:** the runner
  releases every field whose newest desired row is still its own.
- **Guarded writes.** Every desired-state write and release takes a per-setting transaction lock
  (`pg_advisory_xact_lock(hashtext('desired_state:<greenhouse>:<param>'))`). The runner's writes also carry the
  newest row id the sweep read, and go in only while that row is still the newest
  (`settings.Superseded` otherwise). A hold's request id includes that row id, so a hold someone wrote over is
  not mistaken for a replay.
- **Last write wins.** If a person writes or releases one of the 48 during a study day, the write stands. It
  is never refused and never written back. It is recorded once as a deviation: `released_by_other` for a write
  over the day's hold, or `held_by_other` for a field already held manual. The day stays in the
  intention-to-treat analysis (product §, D-IRP-26 as decided). A hold or release the settings validator
  refuses is a `hold_refused` or `release_refused` deviation, and the sweep moves on to the next field.
- **Boundary.** A day's boundary is recorded once every field it is judged on reads settled. On a baseline
  day that means `confirmed`, `no_readback` or `held`. On an AI day `released` (the study's own release) and
  `overridden` (a plan in force) also count. Fields that are deviations are not judged. The 15 min confirm
  window runs from the day's newest study write, not from 11:00. An unconfirmed boundary and its
  `boundary_unconfirmed` deviation commit in one transaction.
- **Stranded holds.** After each sweep the runner releases every field whose newest row is still a
  `system:planner_study` hold that no study keeps by design now. A study keeps its fields only on a baseline
  day, and only when its sweep succeeded. A study file that stops loading, a field dropped from the list, or a
  failed sweep therefore cannot leave a manual hold in force.
- **Pause:** holds released immediately. A pair with a day already under way is void (`paused`) and runs
  again, in its own seeded order, after the resume. **Resume:** the remaining pairs start at the next 11:00
  boundary. **Stop:** holds released; days not yet run are `cancelled`.
- **Finished:** after the last pair's second day, the runner releases its holds and the run reads `finished`.

## Emergency release

1. **Normal:** press Stop on Planner → Experiments, or call API-28 `stop`. Within a minute the runner releases
   every study hold.
2. **Runner misbehaving:** set `PLANNER_STUDY_RUNNER_ENABLED=false` on the operator API Deployment (merge the
   env change, or as a break-glass patch that is recorded in steer and reverted after). With the runner off it
   neither holds nor releases anything, so release the holds by hand. List them read-only:

   ```sql
   SELECT param, value, created_at FROM v_desired_state_current
    WHERE greenhouse_id = 'vallery' AND source = 'system' AND actor = 'planner_study' AND value IS NOT NULL;
   ```

   Then release each field from Settings (API-11, "Release"), or with MCP `set_setting(release=True)`. Release
   is last write wins, and the runner (once back on) never writes over it that day.

## Preregistration (before Start)

`scripts/planner-study-preregister.py` (read-only on the database) does the following:

1. It computes the baseline vector. For each of the 48 fields it takes the median of the device-confirmed
   `source='plan'` values over the 14 days before it runs, or the newest readback where Hermes never wrote
   the field. Each value is snapped to the registry grid.
2. It writes `verdify_schemas/planner_study_baselines/planner-ab-winter-2026.json`.
3. It draws a seed, and sets `baseline_vector.sha256`, `schedule.seed` and `schedule.schedule_sha256` in the
   YAML.

That commit is the pre-registration. API-28 `start` refuses a definition that is not preregistered, or whose
baseline file does not hash to the committed value.

## Not closed in this slice (follow-ups on #1360)

1. **Outcome freezer and analyzer.** `study_day_outcomes` (append-only, one row per day with every metric or a
   NULL reason, weather covariates) from `fn_band_compliance_5m`, and the ANCOVA plus randomization-inference
   analyzer with byte-identical reruns. It needs a migration, a duty that can read the band rollup, and a job.
   It is due before the first look at 15 pairs, not before day 1. The source data (climate, band audit,
   equipment state) are retained, so finished days can be frozen afterwards.
2. **Hermes cost accounting.** Hermes records no tokens or price per plan. Until it does, the AI arm's cost
   is its plan and dispatch counts only.
3. **MCP read tool** for study status. The MCP role cannot read the rows without a seal move; agents can read
   the dashboard's API-27 instead.
4. **#1434** (VPD scoring baseline: dry-out minutes, `night_dried_out`, kWh against the cap, scored against both
   the served band and the achievable envelope) feeds the freezer's metric list; its gate is 2026-11-13.
5. **Writes-gate coverage (review item 6).** API-28 rides `DASHBOARD_WRITES_ENABLED` like every dashboard write,
   but the runner does not: turning dashboard writes off does not stop a running study. Use Stop or
   `PLANNER_STUDY_RUNNER_ENABLED`. Whether the writes gate should also pause the runner is open.
6. **AI-day deviations and Iris holds (review item 7).** On an AI day the runner records no deviations. A
   person's manual hold, or an Iris desired value, on one of the 48 is currently treated as part of the AI arm.
   Decide whether Iris desired writes count as the AI arm (likely yes), and whether a person's AI-day hold should
   be a deviation like on a baseline day.
