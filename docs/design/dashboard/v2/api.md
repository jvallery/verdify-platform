# Dashboard v2: read model and API contract

Part of the dashboard v2 design ([README](README.md)). This file is the specification for the operator API changes.
The canonical contract stays `docs/design/dashboard/openapi/dashboard-api.v1.yaml`; where this file and the YAML
disagree after the YAML lands, the YAML wins and this file is corrected.

## 1. Why the API changes

The climate refactor made the controller's band-edge law the only climate decision maker. The operator API still
serves the plan cycle and serves almost none of what the law, the daily record and the daily reviewer write. The
dashboard cannot show what it cannot read, so the read model comes first.

Rules for every read below:

- One definition per number. Run time and starts come from the daily relay record. Compliance comes from
  `daily_band_compliance`. Utilities come from `daily_record`. Controller health, probe ages, table freshness and
  delivery counts use the same SQL and the same thresholds as `api/product_metrics.py`, so the dashboard and the
  estate Prometheus dashboard never disagree.
- Reads run as `verdify_dashboard_runtime`, inside the existing read-only snapshot helpers, bounded by time on every
  hypertable (`ts > now() - interval ...`), within the role's 10 s statement timeout. No read calls
  `fn_relay_run_intervals`, `fn_band_compliance_5m`, `v_sensor_staleness`, the lighting status views or any other
  object the discovery reports measured in seconds.
- `diagnostics` rows are sparse: read the newest non-null value per column over the last 15 minutes, never the newest row.
- `system_state` JSON entities are decoded in SQL and compressed to change intervals before they leave the database.
- Null is honest. A value the controller has not reported is `null`, never 0, and each block carries the time it was
  observed.
- Thresholds and law constants come from the generated constants module and the existing hardware-budget definitions,
  never from a literal typed into a service.
- No new response field repeats a retired idea (plan, waypoint, mode, tunable, target, Iris skips).

## 2. Release order

| Release | Contents | Live effect |
|---|---|---|
| A (additive) | Everything in sections 3 to 6: new reads, additive fields, migration 320, contract, generated client, fixtures, words for the new enums | The current web keeps working; new reads become available |
| B (web) | The v2 web | Uses only reads that release A made live |
| C (retirement) | Section 7: the plan-era routes, fields and metric keys are removed from the API | Nothing reads them by then |

Release A never removes or renames a field, a route, a metric key or an enum value.

As delivered (2026-11-17): releases A and B ship together as one pull request, because the old web's tests do not
pass against the new contract and the old web is replaced in the same change. Migration 320 ships in its own pull
request ahead of it, so the host lane's next migration can chain after it. Release C follows once the v2 web is live.

## 3. New operations

Ids start at API-30. API-08, API-18, API-IRR-09 and OPS-03 stay reserved; 26 to 29 are left unused because earlier
drafts used them.

All are `GET`, readable by viewer and operator, tagged as shown, and answer `application/problem+json` on error with
the existing problem codes (`window_too_large`, `invalid_request`, `query_timeout`, `unavailable`).

### API-30 `GET /v1/law` (tag `law`) → `LawView`

What the controller's law is doing now and why. Polled every 15 s by Climate → Controller, System → Equipment and Now.

Sources: `system_state` entities `climate_law_state`, `climate_drying_meter`, `climate_law_constants`,
`outdoor_source`, `lead_fan`; `diagnostics` (newest non-null per column, 15 min); `equipment_state` (newest row per
relay, with its start); the newest `climate` row; `fn_band_setpoints(now())`; `v_desired_state_current`
(`dry_cost_limit_kwh_per_kg`); today's `daily_record` row; the generated law constants.

```
LawView
  server_time            datetime
  observed_at            datetime | null     newest law record
  reporting              bool                the newest record is at most 120 s old (the same rule as control_proof.law_fresh)
  band                   LawBand
  inputs                 LawInputs
  rules                  LawRule[]           fixed order: heat1, heat2, cooling, second_fan, fog, mist, drying, hot_limit, cold_limit
  drying                 LawDrying
  timing                 LawTiming
  lead_fan               "fan1" | "fan2" | null
  alone                  LawAlone
  constants              LawConstants

LawBand                                      the band the controller is using now
  temp_low_f, temp_high_f, vpd_low_kpa, vpd_high_kpa   number | null   (record field b)
  repaired               bool | null         the controller's band check changed the band it received (br)
  source                 "onchip_curve" | "corridor" | "dispatcher_legacy" | null   (diagnostics.band_source)
  host                   { temp_low_f, temp_high_f, vpd_low_kpa, vpd_high_kpa } | null   fn_band_setpoints(now())
  differs                bool | null         controller and host differ by more than 1.0 F or 0.10 kPa (the band_device_db_divergence rule)

LawInputs                                    what the law is reading
  temp_f, vpd_kpa        number | null       climate.temp_control, climate.vpd_control
  rh_pct, dew_point_f    number | null
  outdoor                { source: "station" | "intake" | "none" | null, temp_f, rh_pct, dew_point_f: number | null }
                         dew_point_f is worked out from the outdoor temperature and humidity the law reads, and is
                         served unrounded: the client rounds for display
  observed_at            datetime | null

LawRule
  id                     "heat1" | "heat2" | "cooling" | "second_fan" | "fog" | "mist" | "drying" | "hot_limit" | "cold_limit"
  signal                 "temp" | "vpd"
  direction              "below" | "above"   the rule turns on when the signal goes below / above on_at
  on_at, off_at          number | null       thresholds in the signal's unit, computed from the band in use and the constants
  latched                bool | null         the rule's latch bit (h1, h2, cool, cool2, wet, mist, dry); hot and cold use their request bits
  requested              bool | null         the law's request after its own gates (heat1, heat2, cooling, fans>=2, fog, mist, drying, hot, cold)
  relays                 LawRelay[]          the relays this rule drives
  hold                   { kind: "min_off" | "min_on", remaining_s: int } | null
                                             set only when the host can prove it: requested with the relay off inside its
                                             minimum off time, or not requested with the relay on inside its minimum on time

LawRelay
  equipment              "heat1" | "heat2" | "vent" | "fan1" | "fan2" | "fog" | "mister_any"
  state                  "on" | "off" | "unknown"
  since                  datetime | null

LawDrying
  state                  "running" | "refused" | "not_wanted" | "unknown"
  wanted                 bool | null         latch dry
  outdoor_drier          bool | null         latch air
  refused_reason         "none" | "no_outdoor" | "cooling" | "furnace" | "not_drier" | "too_cold" | "cost" | "humidity_invalid" | "no_temperature" | null
  cost_kwh_per_kg        number | null       null when the controller reports no price (no outdoor data)
  limit_kwh_per_kg       number | null       the limit in force on the controller (lim)
  limit_source           "owner" | "default" owner: a desired_state row exists; default: the controller's compiled value
  wanted_below_kpa       number | null       vpd_low + the drying-on margin
  stop_above_kpa         number | null       vpd_low + the drying-off margin
  min_temp_f             number | null       band low + the drying temperature margin
  checks                 { id: "humid" | "outdoor_drier" | "worth_it" | "warm_enough" | "not_cooling" | "furnace_off", ok: bool | null }[]
                                             the decision chain in the order the law applies it
  meter                  { seconds, water_g, heat_wh, refused_seconds: number | null, observed_at: datetime | null }
                                             the controller's counters since its last restart
  today                  { seconds: number | null, runs: int | null, water_g, heat_wh: number | null, lower_bound: bool | null } | null
                                             today's daily_record row

LawTiming
  relay_min_on_s, relay_min_off_s, fog_min_on_s, fog_min_off_s, furnace_boot_wait_s, mist_pulse_s, mist_gap_s   int
  hot_limit_f, cold_limit_f                                                                                      number

LawAlone                                     what the controller needs to run without the host
  clock                  { valid: bool | null, sync_age_s: number | null }
  probes                 { active: int | null, degraded: bool | null }
  host                   { connected: bool | null, heartbeat_age_s: number | null }
  gap_log                "armed" | "not_armed_yet" | "nvs_small" | "nvs_full" | "nvs_slow" | "nvs_error" | null

LawConstants
  hash                   string | null       the controller's reported hash
  release_hash           string              the hash of the constants this API build was generated from
  matches                bool | null
  observed_at            datetime | null
```

### API-31 `GET /v1/law/history?from&to` (tag `law`) → `LawHistory`

The law's decisions over time, for lanes and for the drying price chart. Window at most 31 days, same `from`/`to`
rules as API-05.

```
LawHistory
  from, to               datetime
  first_record_at        datetime | null     the oldest law record (2026-11-16 on production)
  lanes                  LawLane[]           one per request and per latch, fixed order
  drying                 { start, end: datetime, state: "running" | "refused" | "not_wanted" | "unknown", reason: string | null }[]
  outdoor_source         { start, end: datetime, source: "station" | "intake" | "none" | "unknown" }[]
  band_repaired          { start, end: datetime }[]
  cost                   { bucket_s: int, t: int[], cost_kwh_per_kg: (number | null)[], limit_kwh_per_kg: (number | null)[] }
  band                   { bucket_s: int, t: int[], temp_low_f, temp_high_f, vpd_low_kpa, vpd_high_kpa: (number | null)[] }

LawLane
  key                    "request.heat1" | "request.heat2" | "request.vent" | "request.fog" | "request.mist" | "request.fan1"
                         | "request.fan2" | "request.cooling" | "request.drying" | "request.hot" | "request.cold"
                         | "latch.h1" | "latch.h2" | "latch.cool" | "latch.cool2" | "latch.wet" | "latch.mist" | "latch.dry" | "latch.air" | "latch.run"
  group                  "request" | "latch"
  intervals              { start, end: datetime, state: "on" | "off" | "unknown" }[]
```

`unknown` covers every span of more than 180 s with no law record. `cost` and `band` use the API-04 bucket ladder and
at most 1,500 points. `request.fan1` is "at least one fan", `request.fan2` is "both fans".

### API-32 `GET /v1/record/days?from&to` (tag `record`) → `DailyRecord`

The daily record: compliance, starts, run time, utilities and drying, one row per local day, with the 7- and 30-day
means the reviewer and the owner compare against. `from`/`to` are local dates, at most 400 days; the default is the
30 days ending today.

Sources: `daily_record`, `daily_band_compliance`, `v_dashboard_relay_day` (migration 320), `v_daily_scorecard`
(alert counts only).

```
DailyRecord
  from, to               date
  days                   RecordDay[]         ascending by date
  means                  { d7: RecordMeans | null, d30: RecordMeans | null }
  law_started            date | null         the local day of the first law record
  baseline               RecordPeriod | null the 30 complete days before law_started, leaving out days with a band.write in activity_log
  since_law              RecordPeriod | null the complete days from the day after law_started, leaving out the same kind of day
  server_time            datetime

RecordPeriod
  from, to               date
  excluded_days          int                 days left out of the period (band edits)
  means                  RecordMeans

law_started is the earlier of the local day of the first climate_law_state row and the first day whose daily
record carries the drying meter. Both periods leave out a day on which the band was edited and count it in
excluded_days, so the two sides are compared on days the band stood still. since_law is null until one day after
law_started is complete (ended, with its record stored). A baseline with no complete day has means.days 0 and
null means; baseline is null only when law_started is.

RecordDay
  date                   date
  complete               bool                the local day has ended and its record is stored
  band                   RecordBand | null
  relays                 { [equipment]: { starts: int, run_s: number, repaired_runs: int } } | null
                         equipment: heat1, heat2, fan1, fan2, vent, fog, mister_center, mister_south, mister_west, drip_wall, drip_center
  climate_starts         int | null          the six climate relays together
  climate_run_s          number | null
  energy                 { kwh: number | null, kwh_partial: number | null, coverage_pct: number | null }
                         kwh is the 24-hour figure and is null under 70 % meter coverage; kwh_partial is what the meter reported
  gas                    { therms_est: number | null }          estimated from furnace run time; gas is not metered
  water                  { total_gal, crop_gal, wetting_gal, house_gal: number | null, complete: bool | null }
                         crop_gal is daily_record.planning_water_gal (wetting plus wall irrigation and fertigation)
  drying                 RecordDrying | null
  counter_sample_pct     number | null
  alerts                 { critical, warning, info: int } | null

RecordBand
  both_pct, temp_pct, vpd_pct                         number | null
  both_day_pct, both_night_pct                        number | null
  temp_below_pct, temp_above_pct, vpd_below_pct, vpd_above_pct   number | null
  graded_min             int | null
  night_dryout_min       int | null
  night_dried            bool | null
  above_full_cooling_min int | null

RecordDrying
  seconds                number | null
  runs                   int | null
  furnace_starts_after   int | null
  water_g, heat_wh       number | null
  lower_bound            bool | null         a restart lost meter counts that day
  wanted_s               number | null
  refused_s              { [reason]: number } | null

RecordMeans                                  over complete days only
  days                   int                 how many complete days the mean covers
  both_pct, temp_pct, vpd_pct                number | null
  nights_dried           int | null
  climate_starts, climate_run_h              number | null
  heat1_run_h, heat2_run_h                   number | null
  kwh, therms_est, crop_gal, drying_h        number | null
```

### API-33 `GET /v1/record/relay-check?days` (tag `record`) → `RelayCheck`

The controller's own relay counters against the stored record (`v_relay_counter_reconciliation_daily`). `days` 7, 14 or 30.

```
RelayCheck
  days                   { date, comparison: "complete" | "partial" | "no_record" | "record_early", boots: int | null,
                           relays: { equipment, counter_starts, record_starts, starts_difference: int | null,
                                     counter_run_s, record_run_s, run_s_difference: number | null }[] }[]
```

### API-34 `GET /v1/reviews?limit&cursor` (tag `review`) → `ReviewPage`

The daily reviewer's output. Source: `v_dashboard_review` (migration 320), the open `daily_review_missed` alert and
`activity_log` rows with action `band.write`.

```
ReviewPage
  items                  Review[]            newest first; limit 1 to 60, default 30
  next_cursor            string | null
  today                  { review_date: date, status: "written" | "delivered" | "requested" | "failed" | "due" | "not_due",
                           missed: bool, expected_after: "07:00", late_after: "10:00" }
  tokens                 { last: int | null, mean_7: number | null, mean_30: number | null, rise_pct: number | null,
                           count_7: int, count_30: int }
                         the means are over the 7 and the 30 written reviews before the newest one, or as many
                         as there are; count_7 and count_30 say how many each covers (reviews, not days)
  days                   [{ day: date, reviews: int, input_tokens: int | null, output_tokens: int | null,
                           total_tokens: int }]
                         the reviewer's daily cost (#1661): every finished review, daily and manual, summed on the
                         America/Denver day its run finished, last 30 days, oldest first; no price per token is stored
  proposal_waiting       { review_id: int, review_date: date } | null

Review
  id                     int
  kind                   "daily" | "manual"
  review_date            date
  status                 "requested" | "delivered" | "written" | "failed"
  requested_at           datetime
  requested_by           string
  attempts               int
  delivered_at, run_finished_at, written_at   datetime | null
  failure                "gateway_rejected" | "gateway_unreachable" | "hermes_run_failed" | "hermes_run_cancelled" | "completed_without_review" | "attempts_exhausted" | null
  input_tokens, output_tokens, total_tokens   int | null
  summary                string | null
  proposal               ReviewProposal | null
  proposal_state         "waiting" | "answered" | "superseded" | null

ReviewProposal                               mirrors verdify_schemas.review.BandProposal
  changes                { param: string, label: string, unit: string, current: number | null, proposed: number }[]
  price                  as the schema stores it
  reason                 string | null
```

`proposal_state`: `waiting` when this is the newest written review that carries a proposal and no `band.write`
followed its `written_at`; `answered` when a `band.write` followed it; `superseded` when a newer written review
exists. `tokens.rise_pct` compares the newest review with `mean_7` of the reviews before it.

### API-35 `GET /v1/system/controller` (tag `system`) → `ControllerHealth`

The controller's hardware budget. Sources: `diagnostics` (newest non-null per column, 15 min; the `CONTROLLER_SQL`
and `HEALTH_SQL` definitions of `api/product_metrics.py`), `system_state` (`ingestor_counters`,
`climate_law_constants`).

```
ControllerHealth
  observed_at            datetime | null
  firmware               { version: string | null, pinned: string | null, matches: bool | null }
  uptime_s               number | null
  restarts               { count: int | null, reset_reason: string | null, booted_at: datetime | null }
  heap                   { free_kb, min_free_kb, largest_block_kb, minute_low_kb, largest_block_minute_low_kb: number | null }
  loop                   { worst_ms: number | null, stack_free_min_b: number | null }
  nvs                    { used_entries, free_entries: int | null, write_worst_ms: number | null }
  wifi                   { rssi_dbm: number | null, disconnects: int | null, api_clients: int | null }
  clock                  { valid: bool | null, sync_age_s: number | null, misses: int | null }
  probes                 { active: int | null, degraded: bool | null, health: string | null }
  band_source            string | null
  gap_log                string | null
  limits                 { heap_warning_kb, heap_critical_kb, largest_block_kb, ota_free_kb, loop_worst_ms, nvs_write_ms,
                           stack_free_b, nvs_arm_free_pct, nvs_stop_free_pct: number }
```

`limits` are the hardware-budget thresholds (package 2.4) from their existing definition; the lane finds the single
source and cites it. Trends come from API-04 (section 5).

### API-36 `GET /v1/system/data?days` (tag `system`) → `DataContinuity`

Is telemetry flowing, what was lost, what the gap log restored. `days` 1, 7 or 30.

Sources: `v_data_gaps_unreplayed`, `v_dashboard_gap_replay` (migration 320), the `FRESHNESS_SQL`, `FLOW_SQL` and
`PROBES_SQL` definitions of `api/product_metrics.py`, `system_state` (`ingestor_heartbeat`, `ingestor_counters`,
`setpoint_snapshot_pass`, `dispatcher_stage`), `diagnostics.gap_log_state`.

```
DataContinuity
  from, to               datetime
  gap_log                string | null
  outages                { start, end: datetime, duration_s: int, reason: string, status: string }[]      newest first, at most 200
  replayed               { boot, qseq: int, first_at, last_at, received_at: datetime, climate_rows, transition_rows: int }[]   newest first, at most 200
  by_day                 { date, outage_s: int, replayed_min: int }[]
  tables                 { table: string, last_row_age_s: number | null, rows_5m: int | null }[]
  probes                 { sensor: string, age_s: number | null, last_seen_at: datetime | null }[]
                         age 7200 means not seen in 2 h; last_seen_at is filled only for such a probe (its newest
                         reading of the last 30 days, null when there is none), so the page can say since when
  ingestor               { heartbeat_age_s: number | null, reconnects, payloads_rejected, replay_failures: int | null,
                           rows_rejected: { [table]: int } | null, observed_at: datetime | null }
```

### API-37 `GET /v1/system/delivery?hours` (tag `system`) → `Delivery`

Did the controller take what the host pushed. `hours` 24 or 168.

Sources: `setpoint_changes` (bounded by `ts`), `system_state` (`dispatcher_stage`, `setpoint_snapshot_pass`), the
`DELIVERY_SQL` and `OLDEST_UNCONFIRMED_SQL` definitions.

```
Delivery
  from, to               datetime
  by_status              { source: string, status: string, count: int }[]
  oldest_unconfirmed_s   number | null       0 when nothing waits
  latency                { p50_s, p95_s: number | null, confirmed: int }
  failing                { param: string, label: string, failed: int, last_failed_at: datetime, last_confirmed_at: datetime | null }[]
                                             settings with a failed push in the window, worst first, at most 50
  dispatcher_stage       string | null
  readback_pass          { at: datetime | null, stored: int | null, of: int | null }
```

### API-CROP-12 `POST /v1/crops/plantings/{planting_id}/notes` (tag `crops`) → `Planting`

Operator only. Body `{ note: string (1 to 2000), reason?: string }`. Calls the crops service's existing annotate
function (the one MCP `annotate_planting` uses), writes one `crop_events` note row and one `activity_log` row, takes
an `Idempotency-Key` like every write.

## 4. Additive fields on existing operations

| Operation | Field | Meaning |
|---|---|---|
| API-02 `Now` | `law.band` `{temp_low_f, temp_high_f, vpd_low_kpa, vpd_high_kpa}` or null | The band the controller is using (record field `b`) |
| API-02 `Now` | `review` `{review_date, status, missed, written_at, proposal_waiting}` or null | Same meaning as `ReviewPage.today`, plus `written_at` of the newest written review and whether a proposal waits |
| API-02 `Now` | `outdoor.source` `station`, `intake`, `none` or null | `system_state` `outdoor_source` |
| API-02 `Now` | `controller.heap_minute_low_kb`, `controller.restart_count`, `controller.gap_log` | The three health facts the shell needs for its banner |
| API-09 `Setting` | `effect` `controller`, `host` or `none` | `controller`: the connected controller's control loop reads it. `host`: a host task reads it (lighting schedule, dispatcher, alerts). `none`: stored and echoed, but nothing reads it on this build. The service derives it from the registry and one reviewed list, guarded by a test |

`Now.iris` and `Now.mode` stay until release C.

### 4.1 The band as edges (API-23 and API-24)

The law reads a low and a high edge. The profile form of API-23 and API-24 (a target with a width) describes a
band the law no longer has, so both operations gain an edge form. The target-and-width fields keep working until
release C.

| Operation | Addition |
|---|---|
| API-23 query, API-24 body | Eight optional numbers: `temp_low_day`, `temp_high_day`, `temp_low_night`, `temp_high_night`, `vpd_low_day`, `vpd_high_day`, `vpd_low_night`, `vpd_high_night`. Day is solar noon, night is solar midnight. Each low or high series given at least one edge compiles with sunrise and sunset halfway between day and night, on the push step; an edge left out of that series keeps the band's own noon or midnight value. A series given no edge keeps its four anchors as stored. Giving one axis in both forms is `invalid_request`, naming the first edge field |
| API-23 response, in the stored state and in the draft | `edges`: the same eight numbers as the band's noon and midnight edges read; `edges_simple` `{temp, vpd}`: true when sunrise and sunset edges equal the midpoint of noon and midnight |
| API-23 response, facts | `law_lines`: the offsets the preview draws, from the law constants: `heat1_on_above_low_f`, `heat2_on_above_low_f`, `cool_on_above_high_f`, `fan2_on_above_high_f`, `dry_on_above_vpd_low_kpa`, `fog_on_above_vpd_high_kpa`, `mist_on_above_vpd_high_kpa` |

Target rows under the edge form: people no longer edit them. A stored target whose whole daily curve still lies
between its new edges is left as it is; one whose curve would leave them at any hour moves, at all four anchors,
to the midpoint of its edges (on the push step) in the same write, so the stored rows never contradict the band.
Validation is the existing band check (outer limits, the narrowest band the law allows) applied to the edges; a
finding about the order of two edges names the edge field of the side it is about.

The client parses `edges`, `edges_simple` and `law_lines` as nullable, so a web built on this contract runs
against an API that does not serve them yet; the editor then falls back to the anchors.

## 5. Metric registry additions (API-03 and API-04)

New keys, bound to stored columns, all `MEASURED`, bucketed like their neighbours:

| Group | Keys |
|---|---|
| controller | `diagnostics.heap_min_free_kb`, `diagnostics.heap_minute_low_kb`, `diagnostics.heap_largest_block_minute_low_kb`, `diagnostics.loop_worst_ms`, `diagnostics.loop_stack_free_min_b`, `diagnostics.nvs_used_entries`, `diagnostics.nvs_free_entries`, `diagnostics.nvs_write_worst_ms`, `diagnostics.wifi_disconnects`, `diagnostics.api_clients`, `diagnostics.restart_count`, `diagnostics.active_probes`, `diagnostics.sntp_sync_age_s` |
| power (new group) | `energy.ch0_power_w`, `energy.ch1_power_w` from `v_dashboard_energy`. Channel 1 is stored negative because its clamp is reversed (#1369); the key serves the magnitude and its note says so |

Two metrics that exist gain a note: `climate.co2_ppm` is marked unreliable, and `climate.hydro_battery_pct` is marked
"not reported: the meter runs on mains power". Nothing is removed in release A.

## 6. Migration 320: dashboard projections

One migration, seals unchanged, in the pattern of migration 312's `v_dashboard_energy`: views owned by `verdify`,
`REVOKE ALL ... FROM PUBLIC`, `GRANT SELECT` to `verdify_dashboard_runtime` alone, no grant on any relation another
runtime can reach.

| View | Projects | Columns |
|---|---|---|
| `v_dashboard_review` | `planner_review` | `id`, `kind`, `review_date`, `requested_at`, `requested_by`, `status`, `attempts`, `delivered_at`, `failure`, `run_finished_at`, `input_tokens`, `output_tokens`, `total_tokens`, `written_at`, `summary`, `band_proposal` |
| `v_dashboard_relay_day` | `daily_relay_record` | `date`, `greenhouse_id`, `equipment`, `starts`, `run_s`, `event_run_s`, `repaired_runs`, `computed_at` |
| `v_dashboard_gap_replay` | `gap_replay_quarters` | `boot`, `qseq`, `first_ts`, `last_ts`, `climate_rows`, `transition_rows`, `format_version`, `received_at` |

It needs every delivery artefact a migration needs (the SQL file with predecessor and successor blocks pinning 319's
seals, the entries in `scripts/c0-migration-delivery.py` and `scripts/bootstrap-six-runtime-roles.py`, the delivery
test, the forward-only list, the qualification fixture SQL, a DB test that runs each new read as the dashboard duty)
and a native qualification recorded from production.

## 7. Release C: what the API stops serving

| Item | Replacement |
|---|---|
| API-07 `GET /v1/plan`, schema `Plan`, `PlanLane`, `PlannerTrigger` | None. The list of held settings is API-09 |
| API-25 `GET /v1/planner/history`, `verdify_services/planner.py` | API-34 |
| `Now.iris` | `Now.review` |
| `Now.mode` and the mode words | `Now.law` |
| `Setting.plan`, `SettingHistory.plan`, `PlanWaypoint`, `AppliedFrom: plan` | None |
| `Equipment.mode_reason` | API-30 |
| Metric keys `daily.iris_required_written`, `daily.iris_required_missed`, the 12 keys of the `targets` group, `climate.hydro_battery_pct` | None |
| API-06 and API-19 zones `center`, `south`, `west`, `east` | The house band. Zones are probes; the law has one band |
| The experiment-armed checks in `Now.writer` and the `held` setting state | None |
| Tags `plan`, `planner`; problem code `study_state` | None |

`scripts/dashboard-smoke.sh --sweep` moves from API-07 and API-25 to API-30, API-32 and API-34 in release B, so the
live sweep never reads a retired route.

### 7.1 What shipped (2026-11-17)

Every row of the table above. In detail:

- **Routes.** API-07 and API-25 are gone from the operator API and from the committed contract, with the schemas `Plan`,
  `PlanLane`, `PlanRecord`, `PlannerTrigger`, `PlanWaypoint`, `PlannerHistory`, `PlannerDayCost` and `PlanCost`, and the
  tags `plan` and `planner`. `verdify_services/planner.py` and its DB test are deleted.
- **Fields.** `Now` loses `mode` and `iris`; `Equipment` loses `mode_reason`; `Setting` and `SettingHistory` lose `plan`;
  `applied_from` is `manual`, `desired`, `band` or `default`. `ReadbackState` loses `held` and `StateReason` loses
  `experiment`: a clamp reads `not_confirmed` with reason `clamped` at once, and an armed experiment no longer holds a
  setting or leaves it out of `Now.writer.differing`. `ProblemCode` loses `study_state`.
- **Metrics.** API-03 no longer lists the `targets` group (`climate.house_temp_target_f`, `climate.house_temp_delta_f`,
  `climate.house_vpd_target`, `climate.house_vpd_delta`, and `climate.vpd_target_*` and `climate.vpd_delta_*` for
  center, south, west and east), `daily.iris_required_written`, `daily.iris_required_missed` or
  `climate.hydro_battery_pct`. The columns stay in the database.
- **Zones.** API-06 takes `zone=house` only; any other zone is 400 `invalid_request`. API-19 takes the house band's 24
  anchors only; a zone VPD target or width is 422 `unknown_target`. API-09 still lists the Band in force rows of every
  zone.
- **Kept outside the operator API.** The MCP `settings` tool's history still carries its `plan` values through
  `reads.setting_history_with_plan()`; the operator API does not serve it. MCP's settings catalog rows no longer carry
  the `plan` key, which was always null. The greenhouse snapshot job read the climate mode and the next planner runs
  until part 2 (D, below) gave it the law's facts.
- **Web.** It rolls first. Its parsers drop the retired fields and read an old `held` as `not_confirmed`, so the same
  build works against the API at 088414f4 and after release C (`app/lib/release-c.test.ts` parses one payload of each
  shape). The badges, words and reason lines lose `held`, `experiment` and `study_state`. The graph link checker still
  drops a retired metric key with its notice, for the old API's registry. /plan, /planner and /planner/history still
  redirect to Review.
- **Smoke.** `scripts/dashboard-smoke.sh --sweep` reads API-06 with `zone=house` (was `zone=south`), API-19 with
  `band_vpd_target_sm` (was `zone_vpd_target_center_sm`) and checks API-13's two reasons (was three, with
  `mode_reason`). The `--role operator` legs (with and without `--revert`) no longer accept the `held` state or the
  `experiment` reason (no `HELD` line; a write must answer `requested`), and after a release they wait only for the
  device to leave the check's value (no `applied_from: plan` case). The `--agent-write` leg's description no longer
  mentions `held`; it still prints whatever state `set_setting` answers. Each leg passes against 088414f4 too; that
  API answers `held` only under an armed experiment, and the retired experiment platform arms none.
- **Restart.** `verdify-operator-api` and `verdify-mcp`. No migration and no database change.

### 7.2 Part 2: follow-ups from the live site (2026-11-17)

Same release, same restart (`verdify-operator-api` and `verdify-mcp`; the snapshot CronJob takes the api image with
the full sync). No migration.

- **A. Legacy wide limits (API-09, API-12, MCP `settings`).** `temp_low`, `temp_high`, `vpd_low` and `vpd_high` are
  evaluated as never requested: `confirmed` with a readback, else `no_readback`, never `not_confirmed` against the
  dispatcher's last push, which stopped once the band anchors confirmed. `applied_from` reads `default` for them: `band`
  means the host sends the band's value, and it sends these no more. `Now.writer.differing` never counted them.
- **B. Delivery (API-37).** `oldest_unconfirmed_s` leaves out `cancelled` pushes, as it leaves out superseded, failed,
  expired and observed ones. The operator API's `/metrics` reads the same statement.
- **C. The law (API-30).** While `lead_fan` is null and exactly one fan is on, that fan is the lead for the rules'
  `relays` and `hold` (Cooling and Drying list it, Second fan the other), when it started while the other fan was off
  or no later than the other's last run. The second fan finishing its minimum on time after the lead stopped does not
  lead. Both on, both off or that tail: both fans are listed, as before. `lead_fan` itself stays what the controller
  reported.
- **D. The greenhouse snapshot (`Now.snapshot`, MCP `get_greenhouse_snapshot`).** The job's fact sheet drops
  `climate_mode` and `planner` and gains `climate_law` (what the law asks for, with each rule's thresholds from the band
  in use, the equipment finishing its shortest time on, the drying decision and why, the band edges in use, the drying
  cost and its limit) and `daily_review` (status and whether a band proposal waits). Its write trigger keys on the law's
  requests. Prompt version `brief-v2`. `reads.climate_mode()` and `reads.planner_runs()` are deleted.
- **E. The band (API-23).** `overshoot` holds the four edge series only; no overshoot finding names a `*_target_*` row.
  `band_order` still names the target row it crossed (an error; `edge_field()` maps it to the edge for an edge draft).
  The web hides a warning on a target row and, with no draft change, folds the overshoot warnings into one note line.
