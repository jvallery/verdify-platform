// SPDX-License-Identifier: MIT
import type { components } from "../generated/operator-api";
import type { AlertSeverity, AlertStatus, BandVerdict, BurstKind, LineFault, LineStateCode, ProblemCode, RequiredTrigger, RunOutcomeCode, StateReasonCode, TriggerOutcome, VpdSource } from "./vocab";

type Schemas = components["schemas"];
/** An enum of the contract without its null. */
type Codes<T> = Exclude<T, null | undefined>;

/**
 * The one words table (design system §1, rule 3): every code from the API or the controller renders through it, in
 * plain words for someone who knows plants rather than the controller. An unknown code renders raw, so a code added
 * later shows as itself rather than as nothing. `words.test.ts` fails on any OpenAPI `ProblemCode`, `StateReason` or
 * `LineState` code, alert status, schedule, line or run field, band verdict, required-trigger state or burst kind,
 * controller mode or mist stage (`firmware/lib/greenhouse_types.h`), alert type (`ALERT_TYPES` in
 * `verdify_schemas/alerts.py`), actuator of the fixed list (architecture §7), planner trigger outcome
 * (`planner_trigger_ledger`'s status check) or stress window kind or severity (`StressWindow` in
 * `verdify_schemas/plan.py`) without an entry here, and on an activity action the services write without one, so a PR
 * that adds one adds its words; the Water families (run outcomes, VPD sources, line faults and program rejects, #1135)
 * are checked the same way, as are the reason families the controller publishes (`mode_reason`, `moisture_block_reason`
 * and `fog_block_reason`, read from the firmware sources). A trigger's `failure_class` is open-ended text the ledger
 * writers choose, with no family yet, so it reads raw. The climate law's, the daily record's, the daily review's and
 * the system pages' enums (dashboard v2) are checked against the OpenAPI file the same way; the delivery and data-gap
 * families word the stored values their database columns hold.
 */
const STATE_REASON = {
  clamped: "Clamped",
  experiment: "Held by an experiment",
  deferred: "Waiting: controller heap low",
  push_failed: "Push failed",
  writer_down: "Ingestor not running",
  controller_not_reporting: "Controller not reporting",
  no_engine: "Applies with the irrigation firmware",
  no_match: "No matching readback yet",
} as const satisfies Record<StateReasonCode, string>;

const ALERT_SEVERITY = { critical: "Critical", warning: "Warning", info: "Info" } as const satisfies Record<AlertSeverity, string>;

/** Every `Alert.status` (the disposition), as a closed alert's line begins ("Resolved by Jason · 10:42"). */
const ALERT_STATUS = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  false_positive: "Marked a false positive",
  suppressed: "Suppressed",
} as const satisfies Record<AlertStatus, string>;

/**
 * Every OpenAPI `ProblemCode`, as a person reads it beside a field or in a toast. A field's `out_of_range` reads
 * "Must be <min>–<max> <unit>" from the Problem's bounds (#1125); this is the line without them.
 */
const PROBLEM_CODE = {
  invalid_request: "The dashboard sent something the API could not read",
  unauthenticated: "Your session ended. Sign in again.",
  forbidden: "Your account can look but not change anything",
  origin_mismatch: "Refused: the change did not come from a dashboard page",
  not_found: "Not found",
  writes_disabled: "Changes are switched off; reading still works",
  query_timeout: "That took too long. Try a shorter window",
  unavailable: "Not available right now. Try again shortly",
  window_too_large: "That window is too long",
  unknown_target: "Nothing by that name",
  read_only: "This can't be changed from the dashboard",
  out_of_range: "Out of range",
  manual: "Set by hand, so Iris leaves it alone",
  request_id_reused: "This change was already sent with other values",
  check_required: "This line needs its one-time check first",
  too_close: "Another schedule on this line starts within 30 min of this one",
  too_many_schedules: "The controller holds 24 schedules; delete one first",
  line_disabled: "The line is disabled",
  line_paused: "The line is paused",
  line_faulted: "The line is faulted",
  not_schedule_member: "The controller runs this mister only with Schedule on until its next firmware flash",
  line_busy: "The line is already running",
  manifold_busy: "Another line on the same supply is running",
  cap_reached: "Over the line's daily limit",
  position_occupied: "Something is already planted there",
  ambiguous_position: "That place could mean more than one spot; be more specific",
  planting_ended: "That planting has already ended",
  study_state: "The study cannot do that now",
} as const satisfies Record<ProblemCode, string>;

/** Every `LineState.code`: an irrigation line's state, with its reason beside it in words (`LineState.reason`). */
const LINE_STATE = {
  idle: "Idle",
  running: "Running",
  waiting: "Waiting",
  blocked: "Can't run now",
  paused: "Paused",
  disabled: "Disabled",
  unknown: "Not reported",
} as const satisfies Record<LineStateCode, string>;

/**
 * Every `RunOutcome`: how an occurrence or run ended, as the week view and the run ledger print it. `unknown` is an
 * outcome that never reached the platform: a gap, never `missed`.
 */
const RUN_OUTCOME = {
  ok: "ok",
  short: "short",
  stopped: "stopped",
  preempted: "preempted",
  skipped: "skipped",
  missed: "missed",
  cap: "cap",
  unknown: "no outcome received",
} as const satisfies Record<RunOutcomeCode, string>;

/** `IrrigationLine.vpd_source` (D-IRP-13): which reading a mister zone's VPD control uses. */
const VPD_SOURCE = {
  own: "VPD from its own probe",
  peer: "VPD from peer probes",
  house: "VPD from the house average",
} as const satisfies Record<VpdSource, string>;

/** `IrrigationLine.fault` (D-IRP-19): the mister watchdog's back-off or latch; its end time follows the words. */
const LINE_FAULT = {
  backing_off: "Backing off",
  mister_fault: "Faulted: no misting",
} as const satisfies Record<LineFault, string>;

/**
 * `ProgramSync.reject_code`: why the controller refused a pushed program (`RejectCode` in verdify_schemas/irrigation.py),
 * after "Not confirmed: ".
 */
const PROGRAM_REJECT = {
  bad_length: "the program arrived the wrong size",
  bad_magic: "the controller did not recognise the program",
  bad_hash: "the program failed its checksum",
  bad_header: "the controller refused the program's site limits",
  bad_line: "the controller refused a line's settings",
  bad_slot: "the controller refused a schedule",
} as const;

/**
 * `Occurrence.reason`, which the API already gives in words: the fixed ones (`REASON_WORDS` in
 * verdify_schemas/irrigation.py) read here as the week view says them, so a saved block reads like the editor's draft
 * (#1137); one that names who or when (a pause: "line paused by jason: rain") reads as sent.
 */
const OCCURRENCE_REASON = {
  "only while VPD sensing is degraded": "only if VPD sensing is degraded",
  paused: "line paused",
  "line disabled": "Skipped: line disabled",
  "not a schedule member": "Skipped until Schedule is on",
  "not a VPD member": "Skipped: VPD control is off",
} as const;

/**
 * A `degraded_only` fallback window on the schedule views (redesign §6.2): one ahead is a "fallback" that runs only if VPD
 * sensing fails; one that passed without running was "not needed", never a hatched "skipped".
 */
const FALLBACK_WINDOW = {
  conditional: "fallback",
  not_needed: "not needed",
} as const;

/**
 * `MODE_NAMES` in firmware/lib/greenhouse_types.h, in screens SCR-01's words, plus `UNKNOWN`, which API-02 serves when
 * no `greenhouse_state` row is in reach (`verdify_services.reads.mode_code_and_stage`).
 */
const MODE = {
  SENSOR_FAULT: "Sensor fault: equipment off",
  SAFETY_COOL: "Emergency cooling",
  SAFETY_HEAT: "Emergency heating",
  SEALED_MIST: "Sealed to raise humidity",
  THERMAL_RELIEF: "Venting a heat burst",
  VENTILATE: "Venting to cool",
  DEHUM_VENT: "Venting to dry the air",
  IDLE: "In band, holding",
  UNKNOWN: "Mode unknown",
} as const;

/**
 * The fixed actuator list (architecture §7) by `equipment_state` key, as Now's running chips name it: the climate
 * relays, the eleven wet relays L01-L11, the Lutron grow-light readback and the controller's own grow-light switches
 * (`_intent`, Q-09).
 */
const EQUIPMENT = {
  fan1: "Fan 1",
  fan2: "Fan 2",
  vent: "Vent",
  heat1: "Heat 1 (electric)",
  heat2: "Heat 2 (gas)",
  drip_wall: "Wall drip",
  drip_wall_fert: "Wall drip (fertilized)",
  fert_master_valve: "Fertilizer valve",
  mister_center: "Center mister",
  drip_center: "Center drip",
  drip_center_fert: "Center drip (fertilized)",
  mister_south: "South mister",
  mister_south_fert: "South mister (fertilized)",
  mister_west: "West mister",
  mister_west_fert: "West mister (fertilized)",
  fog: "Fog",
  grow_light_main: "Main light",
  grow_light_grow: "Grow light",
  grow_light_main_intent: "Main light (controller)",
  grow_light_grow_intent: "Grow light (controller)",
} as const;

/** API-02 `overrides[].kind`: a burst the controller reads back as running. */
const BURST = { fans: "Fans, vent open", humidify: "Fogger", vent_bypass: "Fans, vent closed" } as const satisfies Record<BurstKind, string>;

/** API-02 `iris.required_trigger`: the daily review (climate refactor 5.1), as Now's Iris tile reads it. */
const REQUIRED_TRIGGER = { ok: "OK", late: "Late", missed: "Missed", failed: "Failed" } as const satisfies Record<RequiredTrigger, string>;

/** `BandPosition.verdict`: a reading against the band in force. */
const BAND_VERDICT = { in: "in band", above: "above band", below: "below band", unavailable: "band unavailable" } as const satisfies Record<BandVerdict, string>;

/** `MIST_NAMES`: the stages of `SEALED_MIST`, which `modeWords` reads in its place. */
const MIST_STAGE = {
  WATCH: "Sealed, watching",
  FOG: "Sealed, fogging",
  S1: "Sealed, misting one zone",
  S2: "Sealed, misting all zones",
} as const;

/**
 * The codes `gh_fog_block_reason` publishes (firmware/greenhouse/controls.yaml, with `manual_fog_safety_block_reason`'s and
 * `fog_force_off_reason`'s in firmware/lib/greenhouse_logic.h): why fog is held, or that it runs. Now's burst
 * `held_reason` reads from here. `FogBlockReason` in verdify_schemas/climate_intent.py is a different enum.
 * `leak_detected` is today's firmware only: the engine release drops it from every force-off (Q-05).
 */
const FOG_BLOCK_REASON = {
  none: "Nothing holding fog",
  served: "Fogging now",
  leak_detected: "Water flowing with every Verdify valve closed",
  occupancy: "Someone inside",
  irrigation: "A watering run is using the water",
  resource_budget: "Today's water budget is used up",
  time_invalid: "The controller's clock is not set yet",
  time_window: "Outside the hours fog may run",
  dew_margin: "Too close to the dew point",
  wet_taper: "Wetting tapered off for the time of day",
  rh_ceiling: "Humidity at the fog ceiling",
  temp_low: "Too cold to fog",
  vent_interlock: "Waiting for the vent to close",
  relay_min_off: "Fog resting between runs",
  sensor_fault: "Sensor fault: equipment off",
  fert_master: "The fertilizer line is open",
  water_ceiling: "Today's water ceiling is reached",
} as const;

/**
 * `last_mode_reason` in firmware/lib/greenhouse_logic.h (`init` in greenhouse_types.h; controls.yaml publishes `unknown`
 * for a null pointer): which branch chose the climate mode, as Equipment's Why panel reads it (#1140). `unknown` is the
 * controller's own word, an ordinary value; a null `code` from the API is what "not reporting" looks like.
 */
const MODE_REASON = {
  init: "Controller just started",
  unknown: "The controller gave no reason",
  idle: "In band, holding",
  idle_default: "Nothing needed, holding",
  sensor_fault: "Sensor fault: equipment off",
  safety_cool: "Emergency cooling: at the high safety limit",
  safety_heat: "Emergency heating: at the low safety limit",
  heat_stage1: "Heating with heat1 (electric)",
  heat_stage2: "Heating with heat2 (gas)",
  temp_high: "Venting: too warm",
  temp_vent: "Venting: too warm",
  summer_vent: "Venting: summer vent is on",
  summer_vent_preempt: "Venting: summer vent came before sealing",
  vent_mist_assist: "Venting with misters helping to cool",
  vent_fog_assist: "Venting with fog helping to cool",
  vent_humidify: "Venting to bring in moister outside air",
  humidify_enter: "Sealing to raise humidity",
  humidify_continue: "Sealed, still raising humidity",
  humidify_resolved: "Air no longer too dry: no longer sealed",
  fog_enter: "Sealing to fog",
  fog_continue: "Sealed, still fogging",
  seal_enter: "Sealing to raise humidity",
  seal_continue: "Sealed, still raising humidity",
  seal_exit: "No longer sealed: air recovered or someone inside",
  thermal_relief: "Venting a heat burst",
  thermal_relief_forced: "Venting a heat burst: sealed too long or too hot",
  relief_cycle_breaker: "Venting: too many sealed and relief cycles in a row",
  vpd_low: "Venting to dry the air: VPD too low",
  vpd_too_low: "Venting to dry the air: VPD too low",
  dehum_continue: "Still venting to dry the air",
  dehum_vent_heat: "Venting with heat to dry the air",
  heat_dehum: "Heating with heat1 to dry the air, vent closed",
  night_dryout_pulse: "Night dry-out: venting with drier outside air, heat1 holding the temperature",
  night_dryout_reheat: "Night dry-out: heat1 warming back up after a vent pulse",
  dry_override: "Sealed: VPD above its safe limit",
  vpd_min_safe_rescue: "Venting: VPD below its safe limit",
  vpd_min_safe_heat_rescue: "Heating: VPD below its safe limit",
  mist_backoff: "Resting: sealed for its longest allowed run",
  moisture_blocked: "No longer sealed: someone inside",
  dwell_hold: "Holding the mode for its minimum time",
} as const;

/**
 * The codes `gh_moisture_block_reason` publishes (firmware/greenhouse/controls.yaml): why the misters are held, or that
 * they run. `water_budget` is the soft budget (`mister_water_budget_gal`, lifted in a VPD emergency); the SAF-4 ceiling
 * publishes no reason of its own. `leak_detected` is today's firmware only: the engine release drops it (Q-05).
 */
const MOISTURE_BLOCK_REASON = {
  none: "Nothing holding the misters",
  served: "Misting now",
  pulse_gap: "Resting between mist pulses",
  leak_detected: "Held: water flowing with every Verdify valve closed",
  water_budget: "Misting held: today's soft water budget is used",
  vent_interlock: "Waiting for the vent to close",
  no_humidity_demand: "Humidity in band: no misting needed",
  no_vpd_demand: "VPD in band: no misting needed",
  engage_delay: "Waiting out the misting engage delay",
  below_threshold: "VPD not high enough to wet the plants",
  dew_margin: "Too close to the dew point",
  wet_taper: "Wetting tapered off for the time of day",
  no_zone_available: "No mister zone can run now",
  direct_wet_time_invalid: "The controller's clock is not set yet",
  direct_wet_temp: "Too cold to mist",
  direct_wet_window: "Outside the hours misting may run",
  irrigation: "A watering run is using the water",
  occupancy: "Someone inside",
} as const;

/** `Problem.result` on an API-20 503 (architecture §5.7): why Lutron did not confirm. The light may still switch late. */
const LIGHT_RESULT = {
  ha_failed: "Lutron did not switch: Home Assistant did not answer",
  not_confirmed: "Lutron did not reach the state",
  timeout: "No answer yet: Lutron may still switch",
} as const;

/**
 * Why the controller wants a grow light on or off (`gl_main_reason`, `gl_grow_reason`; API-13 `auto_reason`, #1335): every
 * reason firmware `evaluate_lighting` and controls.yaml's no-clock branch set.
 */
const LIGHT_REASON = {
  auto_disabled: "Automation off",
  time_invalid: "Controller clock not set: lights held off",
  occupancy_lux_low: "On: someone is in and it is dark outside",
  occupancy_hysteresis_hold: "On: someone is in, holding until it is brighter",
  plant_lux_low: "On: too dark for the plants",
  plant_hysteresis_hold: "On: plant light, holding until it is brighter",
  outside_window: "Off: outside the light window",
  occupancy_lux_unavailable: "Off: someone is in, outdoor light level unknown",
  lux_sufficient: "Off: enough daylight",
  minutes_met: "Off: today's light minutes are met",
} as const;

/** The target API-20 records (`activity_log.target`), as an Activity row names it. */
const LIGHT_TARGET = {
  grow_light_main: "Main lights",
  grow_light_grow: "Grow lights",
} as const;

/**
 * `ALERT_TYPES` in verdify_schemas/alerts.py, titled for Now, Activity and the alert rows. The two irrigation alerts
 * #1157 adds are worded ahead of it, so the fixtures read the same as production will.
 */
const ALERT_TYPE = {
  alert_validation_failed: "An alert could not be recorded as written",
  band_anchor_db_read_failed: "Crop band settings could not be read",
  band_device_db_divergence: "The controller's band differs from the platform's",
  band_fn_null: "The crop band could not be worked out",
  esp32_push_failed: "Settings could not be sent to the controller",
  esp32_reboot: "Controller restarted",
  firmware_relief_ceiling: "Heat relief venting hit its limit",
  firmware_vent_latched: "The controller is holding the vent open",
  firmware_version_mismatch: "The controller is not on the expected firmware",
  forecast_deviation: "Weather is not following the forecast",
  heap_pressure_critical: "Controller memory critically low",
  heap_pressure_warning: "Controller memory low",
  heat_manual_override: "Heater drawing power with no command",
  heat_no_power: "Heater switched on but drawing no power",
  relay_pair_forbidden: "Forbidden relay pair running",
  outdoor_source_none: "No outdoor reading",
  case_sensor_only: "Running on the case sensor only",
  boot_stuck: "Controller stuck in its boot state",
  power_meter_stale: "Greenhouse power meter silent",
  daily_record_missing: "Daily record not written",
  house_temp_band_drift: "House temperature outside its band",
  relay_starts_high: "Relay starting too often",
  reviewer_wrote_climate: "The reviewer wrote a climate setting",
  law_state_stale: "Climate law not reporting",
  wetting_below_vpd_band: "Fog or misters running in wet air",
  drying_meter_fault: "Drying meter not counting",
  relay_counters_backstep: "Relay counters went backwards",
  relay_counter_mismatch: "Relay counters and the daily relay record disagree",
  utility_out_of_baseline: "Yesterday's utility use out of the ordinary",
  drying_refused_all_day: "Drying refused all day for cost",
  probes_disagree: "Wall temperature probes disagree",
  owner_value_changed: "A held setting was changed on the controller",
  outdoor_none_indoor_degraded: "No outdoor reading and indoor probes degraded",
  outdoor_intake_only: "Weather station missing: outdoor from the intake probe only",
  furnace_saturated: "Gas furnace cannot hold the band",
  heat_staging_inversion: "Gas heat on while electric heat is off",
  house_band_drift: "The greenhouse is outside its band",
  irrigation_feedback_gap: "Watering feedback missing",
  leak_detected: "Water flowing with every Verdify valve closed",
  law_constants_mismatch: "The controller runs other climate-law numbers than this release",
  payload_rejected: "The controller sends a status record this release cannot read",
  daily_review_missed: "Iris did not write yesterday's review",
  lighting_cfg_threshold_drift: "Grow light thresholds drifted on the controller",
  climate_action_proof_stale: "Climate control evidence is out of date",
  clock_unconfirmed: "The controller's clock is wrong or not synced",
  component_experiment_integrity: "An experiment needs attention",
  plan_context_failed: "Iris could not gather what it plans from",
  plan_not_delivered: "Iris's plan is not reaching the controller",
  planner_band_ownership_drift: "Iris's plan touches band settings",
  planner_evaluation_missed: "Iris did not review a plan",
  planner_gateway_delivery_failed: "Iris's requests did not get through",
  planner_tool_dependency_failed: "A tool Iris needs failed",
  planner_plan_horizon_missing: "Iris has no plan ahead",
  planner_required_plan_missed: "Iris missed a required plan",
  planner_stale: "No new plan from Iris",
  planner_trigger_sla_timeout: "Iris answered a trigger late",
  planner_tunable_range_drift: "Iris planned a value outside its range",
  relay_stuck: "Relay stuck",
  safety_invalid: "A safety setting is invalid",
  sensor_fault: "No indoor reading: the controller is acting on the outdoor air",
  sensor_offline: "Sensor offline",
  setpoint_delivery_stuck: "Settings not reaching the controller",
  setpoint_unconfirmed: "Setting not confirmed by the controller",
  site_content_stale: "The lab site is out of date",
  soil_dryout: "Soil drying out",
  soil_sensor_offline: "Soil probe offline",
  temp_safety: "Temperature at a safety limit",
  tunable_zero_variance: "A setting has not moved in a week",
  vent_moisture_capacity_limit: "Venting and misting can't bring the air into band",
  vent_vpd_moisture_gap: "Venting dry air with no misting",
  vpd_extreme: "VPD at an extreme",
  vpd_stress: "Plants under VPD stress",
  writer_absent: "Ingestor not running",
  telemetry_stall: "No new climate data",
  deploy_override: "A firmware deploy check was overridden",
  irrigation_fence_breach: "A watering valve opened outside its program",
  irrigation_run_missed: "A scheduled watering was missed",
  irrigation_line_faulted: "A mister zone faulted",
  mcp_unreachable: "Iris's tool server is not answering",
  forecast_action_alert: "The forecast crosses a watch limit",
} as const;

/**
 * Why a scorecard cell is empty (`SeriesColumns.reason` on the `daily.*` keys, #1130): the water day's
 * `v_water_meter_daily.quality`. VD-56 sends "band grade kept 3 days" and "no meter data" in words already, so they
 * show as sent, as does any reason added later.
 */
const SCORECARD_REASON = {
  partial_day: "day not finished",
  unavailable: "no meter readings",
  ledger_incomplete: "meter totals not caught up",
  discontinuous: "meter readings broken up",
  incomplete: "meter readings miss part of the day",
} as const;

/**
 * Every `PlannerTrigger.outcome` (a `planner_trigger_ledger` status), as Plan's planner health reads it (screens
 * SCR-03). Whether a required trigger is late or needs someone comes from its row, not from these words.
 */
const TRIGGER_OUTCOME = {
  expected: "due",
  delivered: "delivered",
  acked: "acknowledged",
  plan_written: "plan written",
  action_completed: "setting changed",
  neutral_fallback: "fallback",
  wrong_action: "wrong action",
  delivery_failed: "delivery failed",
  timed_out: "timed out",
  missed: "missed",
} as const satisfies Record<TriggerOutcome, string>;

/**
 * Every planner event (`PlanDeliveryEventType` in verdify_schemas/plan.py), as Now's track, its status line and its
 * "Next 12 h" name an Iris trigger (#1339): the words a person uses, never the code. The glossary's "Iris plans" defines them.
 */
const TRIGGER = {
  SUNRISE: "Sunrise plan",
  SUNSET: "Sunset plan",
  SOLAR_MAX: "Midday check",
  MIDNIGHT: "Midnight plan",
  TRANSITION: "Transition",
  FORECAST: "Forecast update",
  DEVIATION: "Drift check",
  FORECAST_DEVIATION: "Forecast changed",
  HEARTBEAT: "Routine check",
  WEEKLY: "Weekly review",
  MANUAL: "Asked by hand",
} as const;

/**
 * Short plain names for the settings Iris plans (#1339), as Now's "Setting changes" row and its "Next 12 h" print a
 * change ("Daily mist budget 200 → 250 gal"), in place of the API's title-cased key ("Mister Water Budget Gal"). A setting not listed
 * reads as the API's label.
 */
const TUNABLE_SHORT = {
  mister_engage_delay_s: "Wait before misting",
  mister_water_budget_gal: "Daily mist budget",
  outdoor_staleness_max_s: "Oldest outdoor reading used",
} as const;

/** `StressWindow.kind` and `severity` (verdify_schemas/plan.py): a plan's stress windows in Plan's Details. */
const STRESS_KIND = { heat: "Heat", cold: "Cold", vpd_high: "VPD high", vpd_low: "VPD low" } as const;
const STRESS_SEVERITY = { low: "low severity", medium: "medium severity", high: "high severity" } as const;

/**
 * `activity_log.action` (`ACTIVITY_ACTION_PATTERN` in verdify_schemas/activity.py), as an Activity row's title begins:
 * the words, then the target's label ("Set VPD Mister Engage", "Changed line L01", "Lights on Main lights"). The
 * irrigation actions are the ones #1156's services write, the light actions API-20's and the planting actions #1327's.
 */
const ACTIVITY_ACTION = {
  "setting.write": "Set",
  "setting.release": "Released",
  "plan.write": "Plan",
  "alert.ack": "Acknowledged",
  "alert.resolve": "Resolved",
  "irrigation.run": "Ran",
  "irrigation.stop": "Stopped",
  "irrigation.clear_fault": "Cleared the fault on",
  "irrigation.override": "Equipment override",
  "irrigation.schedule.create": "Added schedule",
  "irrigation.schedule.update": "Changed schedule",
  "irrigation.schedule.delete": "Deleted schedule",
  "irrigation.line.update": "Changed line",
  "light.on": "Lights on",
  "light.off": "Lights off",
  "planting.create": "Planted",
  "planting.move": "Moved",
  "planting.harvest": "Harvested",
  "planting.end": "Ended",
  "planting.update": "Changed planting",
  "planting.note": "Noted on planting",
  "band.write": "Changed",
  "soil_target.write": "Changed soil target",
  "study.start": "Started study",
  "study.pause": "Paused study",
  "study.resume": "Resumed study",
  "study.stop": "Stopped study",
  "study.boundary": "Study boundary",
  "study.deviation": "Study deviation",
} as const;

/**
 * The schedule, line and run fields an irrigation write's `detail` names (OpenAPI `ScheduleInput`, `LineUpdate` and
 * `RunRequest`), as Activity shows a change to one ("Daily cap 60 → 45 min").
 */
const IRRIGATION_FIELD = {
  enabled: "Enabled",
  circuit_id: "Line",
  variant: "Variant",
  vpd_member: "VPD control",
  schedule_member: "Schedule",
  daily_cap_min: "Daily cap",
  vpd_reserve_min: "VPD reserve",
  paused_until: "Paused until",
  checked: "Checked",
  check_note: "Check note",
  label: "Label",
  days: "Days",
  start: "Start",
  on_s: "On",
  count: "Pulses",
  gap_s: "Gap",
  prewet_s: "Prewet",
  flush_s: "Flush",
  minutes: "Run time",
  degraded_only: "Only while VPD sensing is degraded",
} as const;

// ---------------------------------------------------------------- the climate law, the daily record, the review and system (dashboard v2)
/** `LawRule.id`: the law's rules, as Climate lists them. */
const LAW_RULE = {
  heat1: "Electric heat",
  heat2: "Gas furnace",
  cooling: "Cooling",
  second_fan: "Second fan",
  fog: "Fogger",
  mist: "Misters",
  drying: "Drying",
  hot_limit: "Hot limit",
  cold_limit: "Cold limit",
} as const satisfies Record<Schemas["LawRule"]["id"], string>;
/** `LawRule.signal`: the reading a rule watches. */
const LAW_SIGNAL = { temp: "temperature", vpd: "VPD" } as const satisfies Record<Schemas["LawRule"]["signal"], string>;
/** `LawRule.direction`: a rule turns on when its reading goes below or above its threshold. */
const LAW_DIRECTION = { below: "turns on below", above: "turns on above" } as const satisfies Record<Schemas["LawRule"]["direction"], string>;
/** `LawRule.hold.kind`: why a relay is not doing what the law asks yet. */
const LAW_HOLD = {
  min_off: "waiting out its minimum off time",
  min_on: "finishing its minimum on time",
} as const satisfies Record<Codes<Schemas["LawRule"]["hold"]>["kind"], string>;
/** `LawRelay.equipment`: the relays a rule drives; mister_any is any mister zone. */
const LAW_RELAY = {
  heat1: "Heat 1 (electric)",
  heat2: "Heat 2 (gas)",
  vent: "Vent",
  fan1: "Fan 1",
  fan2: "Fan 2",
  fog: "Fogger",
  mister_any: "Any mister",
} as const satisfies Record<Schemas["LawRelay"]["equipment"], string>;
/** `LawRelay.state` and a law lane's interval state. */
const RELAY_STATE = { on: "On", off: "Off", unknown: "Not reported" } as const satisfies Record<Schemas["LawRelay"]["state"], string>;
/** `LawLane.key`: the law's requests (what it asks for) and latches (what it remembers between seconds). */
const LAW_LANE = {
  "request.heat1": "asks for electric heat",
  "request.heat2": "asks for the gas furnace",
  "request.vent": "asks for the vent",
  "request.fog": "asks for the fogger",
  "request.mist": "asks for misting",
  "request.fan1": "asks for at least one fan",
  "request.fan2": "asks for both fans",
  "request.cooling": "asks for cooling",
  "request.drying": "asks for drying",
  "request.hot": "too hot: everything cools",
  "request.cold": "too cold: everything heats",
  "latch.h1": "electric heat latched on",
  "latch.h2": "gas furnace latched on",
  "latch.cool": "cooling latched on",
  "latch.cool2": "second fan latched on",
  "latch.wet": "wetting latched on",
  "latch.mist": "misting latched on",
  "latch.dry": "the house wants drying",
  "latch.air": "outdoor air is drier",
  "latch.run": "drying is running",
} as const satisfies Record<Schemas["LawLane"]["key"], string>;
/** `LawLane.group`. */
const LAW_LANE_GROUP = { request: "Requests", latch: "Latches" } as const satisfies Record<Schemas["LawLane"]["group"], string>;
/** `LawDrying.state`: drying is venting with drier outdoor air when the house is too humid. */
const DRYING_STATE = {
  running: "drying",
  refused: "drying refused",
  not_wanted: "dry enough",
  unknown: "not reported",
} as const satisfies Record<Schemas["LawDrying"]["state"], string>;
/** `LawDrying.refused_reason`: the controller's first reason not to dry while the house wants it. */
const DRYING_REFUSAL = {
  none: "nothing in the way",
  no_outdoor: "no outdoor reading",
  cooling: "the house is being cooled",
  furnace: "the gas furnace is running",
  not_drier: "outdoor air is not drier",
  too_cold: "the house is too cold to vent",
  cost: "costs more than the limit",
  humidity_invalid: "no valid humidity reading",
  no_temperature: "no temperature reading",
} as const satisfies Record<Codes<Schemas["LawDrying"]["refused_reason"]>, string>;
/** `LawDrying.checks[].id`: the drying decision chain, in the order the law refuses (the first failing check is the refusal reason). */
const DRYING_CHECK = {
  humid: "the house is humid enough to dry",
  not_cooling: "the house is not being cooled",
  furnace_off: "the gas furnace is off",
  outdoor_drier: "outdoor air is drier",
  warm_enough: "warm enough to vent",
  worth_it: "worth the heat it costs",
} as const satisfies Record<Schemas["LawDrying"]["checks"][number]["id"], string>;
/** `LawDrying.limit_source`: who set the drying cost limit. */
const LIMIT_SOURCE = { owner: "set by the owner", default: "the controller's default" } as const satisfies Record<Schemas["LawDrying"]["limit_source"], string>;
/** `LawInputs.outdoor.source`, `Now.outdoor.source` and the law history's outdoor source. */
const OUTDOOR_SOURCE = {
  station: "weather station",
  intake: "intake probe",
  none: "no outdoor reading",
  unknown: "not reported",
} as const satisfies Record<Codes<Schemas["LawInputs"]["outdoor"]["source"]> | Schemas["LawHistory"]["outdoor_source"][number]["source"], string>;
/** `LawBand.source`: where the controller takes its band from. */
const BAND_SOURCE = {
  onchip_curve: "the controller's own daily curve",
  corridor: "the widest band (clock not set)",
  dispatcher_legacy: "the older host push",
} as const satisfies Record<Codes<Schemas["LawBand"]["source"]>, string>;
/** `LawAlone.gap_log`: the record the controller keeps while the host is away. */
const GAP_LOG = {
  armed: "on, keeping a record",
  not_armed_yet: "not armed yet",
  nvs_small: "off: storage is too small",
  nvs_full: "off: storage is full",
  nvs_slow: "off: storage is too slow",
  nvs_error: "off: storage failed",
} as const satisfies Record<Codes<Schemas["LawAlone"]["gap_log"]>, string>;
/** `Review.status` and `ReviewPage.today.status`. */
const REVIEW_STATUS = {
  written: "Written",
  delivered: "Started",
  requested: "Asked for",
  failed: "Failed",
  due: "Due",
  not_due: "Not due yet",
} as const satisfies Record<Schemas["Review"]["status"] | Schemas["ReviewPage"]["today"]["status"], string>;
/** `Review.kind`. */
const REVIEW_KIND = { daily: "Daily review", manual: "Asked-for review" } as const satisfies Record<Schemas["Review"]["kind"], string>;
/** `Review.failure`: why a review failed. */
const REVIEW_FAILURE = {
  gateway_rejected: "the reviewer's gateway refused the request",
  gateway_unreachable: "the reviewer could not be reached",
  hermes_run_failed: "the reviewer's run failed",
  hermes_run_cancelled: "the reviewer's run was cancelled",
  completed_without_review: "the run ended without writing a review",
  attempts_exhausted: "every attempt failed",
} as const satisfies Record<Codes<Schemas["Review"]["failure"]>, string>;
/** `Review.proposal_state`: where a band proposal stands with the owner. */
const PROPOSAL_STATE = {
  waiting: "waiting for the owner",
  answered: "the owner changed the band since",
  superseded: "replaced by a newer review",
} as const satisfies Record<Codes<Schemas["Review"]["proposal_state"]>, string>;
/** `RelayCheck.days[].comparison`: how far the controller's own counters and the stored record can be compared. */
const RELAY_COMPARISON = {
  complete: "whole day compared",
  partial: "part of the day compared",
  no_record: "no stored record",
  record_early: "record stored before the day ended",
} as const satisfies Record<Schemas["RelayCheck"]["days"][number]["comparison"], string>;
/** `Setting.effect`: what reads a setting on this build. */
const SETTING_EFFECT = {
  controller: "the controller uses it",
  host: "the host uses it",
  none: "nothing uses it",
} as const satisfies Record<NonNullable<Schemas["Setting"]["effect"]>, string>;
/** `Delivery.by_status[].status`: where a pushed value stands (setpoint_changes.delivery_status; missing reads pending). */
const DELIVERY_STATUS = {
  pending: "waiting to send",
  requested: "asked for",
  queued: "in the send queue",
  sent: "sent, not confirmed yet",
  retrying: "sending again",
  confirmed: "confirmed by readback",
  failed: "not taken",
  cancelled: "cancelled before it was sent",
  superseded: "replaced by a newer value",
  expired: "gave up waiting",
  observed: "seen on the controller",
} as const;
/** `Delivery.by_status[].source`: who pushed or reported a value (setpoint_changes.source; missing reads none). */
const DELIVERY_SOURCE = {
  band: "the house band",
  plan: "the old planner",
  iris_planner: "the old planner",
  manual: "an operator",
  esp32: "the controller",
  dispatcher: "the host",
  system: "the host",
  ingestor: "the host",
  none: "not recorded",
} as const;
/** `DataContinuity.outages[].reason`: why the host lost telemetry (data_gaps.reason). */
const DATA_GAP_REASON = {
  ingestor_restart: "the host reconnected to the controller",
  ingestor_process_restart: "the host's telemetry reader restarted",
} as const;
/** `DataContinuity.outages[].status`: what the host saved when it came back (data_gaps.backfill_status). */
const DATA_GAP_STATUS = {
  snapshot_taken: "state saved on return",
  snapshot_incomplete: "state partly saved on return",
  pending: "not restored yet",
  backfilled: "restored",
  unrecoverable: "lost",
  ignored: "set aside",
} as const;

export const WORDS: { readonly [family: string]: { readonly [code: string]: string } } = {
  state_reason: STATE_REASON,
  alert_severity: ALERT_SEVERITY,
  alert_status: ALERT_STATUS,
  problem_code: PROBLEM_CODE,
  line_state: LINE_STATE,
  mode: MODE,
  mist_stage: MIST_STAGE,
  fog_block_reason: FOG_BLOCK_REASON,
  mode_reason: MODE_REASON,
  moisture_block_reason: MOISTURE_BLOCK_REASON,
  light_result: LIGHT_RESULT,
  light_reason: LIGHT_REASON,
  light_target: LIGHT_TARGET,
  alert_type: ALERT_TYPE,
  equipment: EQUIPMENT,
  burst: BURST,
  required_trigger: REQUIRED_TRIGGER,
  band_verdict: BAND_VERDICT,
  scorecard_reason: SCORECARD_REASON,
  trigger_outcome: TRIGGER_OUTCOME,
  trigger: TRIGGER,
  tunable_short: TUNABLE_SHORT,
  stress_kind: STRESS_KIND,
  stress_severity: STRESS_SEVERITY,
  activity_action: ACTIVITY_ACTION,
  irrigation_field: IRRIGATION_FIELD,
  run_outcome: RUN_OUTCOME,
  fallback_window: FALLBACK_WINDOW,
  vpd_source: VPD_SOURCE,
  line_fault: LINE_FAULT,
  program_reject: PROGRAM_REJECT,
  occurrence_reason: OCCURRENCE_REASON,
  law_rule: LAW_RULE,
  law_signal: LAW_SIGNAL,
  law_direction: LAW_DIRECTION,
  law_hold: LAW_HOLD,
  law_relay: LAW_RELAY,
  relay_state: RELAY_STATE,
  law_lane: LAW_LANE,
  law_lane_group: LAW_LANE_GROUP,
  drying_state: DRYING_STATE,
  drying_refusal: DRYING_REFUSAL,
  drying_check: DRYING_CHECK,
  limit_source: LIMIT_SOURCE,
  outdoor_source: OUTDOOR_SOURCE,
  band_source: BAND_SOURCE,
  gap_log: GAP_LOG,
  review_status: REVIEW_STATUS,
  review_kind: REVIEW_KIND,
  review_failure: REVIEW_FAILURE,
  proposal_state: PROPOSAL_STATE,
  relay_comparison: RELAY_COMPARISON,
  setting_effect: SETTING_EFFECT,
  delivery_status: DELIVERY_STATUS,
  delivery_source: DELIVERY_SOURCE,
  data_gap_reason: DATA_GAP_REASON,
  data_gap_status: DATA_GAP_STATUS,
};
export type WordFamily = "state_reason" | "alert_severity" | "alert_status" | "problem_code" | "line_state" | "mode" | "mist_stage" | "fog_block_reason"
  | "mode_reason" | "moisture_block_reason" | "light_result" | "light_reason" | "light_target" | "alert_type" | "equipment" | "burst" | "required_trigger" | "band_verdict" | "scorecard_reason" | "trigger_outcome" | "trigger" | "tunable_short" | "stress_kind" | "stress_severity"
  | "activity_action" | "irrigation_field" | "run_outcome" | "vpd_source" | "line_fault" | "program_reject" | "occurrence_reason"
  | "law_rule" | "law_signal" | "law_direction" | "law_hold" | "law_relay" | "relay_state" | "law_lane" | "law_lane_group" | "drying_state"
  | "drying_refusal" | "drying_check" | "limit_source" | "outdoor_source" | "band_source" | "gap_log" | "review_status" | "review_kind"
  | "review_failure" | "proposal_state" | "relay_comparison" | "setting_effect" | "delivery_status" | "delivery_source" | "data_gap_reason"
  | "data_gap_status";

/** True when the table has words for `code` in `family`. */
export function hasWords(family: string, code: string): boolean {
  const table = Object.hasOwn(WORDS, family) ? WORDS[family] : undefined;
  return table !== undefined && Object.hasOwn(table, code);
}

/** The plain words for `code` in `family`, or the code itself when the table has none. */
export function words(family: WordFamily | (string & {}), code: string): string {
  return hasWords(family, code) ? WORDS[family][code] : code;
}

/** The controller's mode in words: a `SEALED_MIST` stage reads as its stage ("Sealed, misting one zone"). */
export function modeWords(code: string, stage?: string | null): string {
  if (code === "SEALED_MIST" && stage && hasWords("mist_stage", stage)) return words("mist_stage", stage);
  return words("mode", code);
}

/** `IDLE` reads "In band, holding", a verdict on the band; without it, what the controller was doing. */
const MODE_NO_VERDICT: Readonly<Record<string, string>> = { IDLE: "holding", UNKNOWN: "unknown" };
/**
 * The mode with no verdict in it, in lower case to follow a label ("Last mode: holding"), for a mode that may be old
 * (Now's status line while the data is stale, redesign §4.3); every other mode reads as `modeWords` has it, and an
 * unmapped code shows raw.
 */
export function modeWordsNoVerdict(code: string, stage?: string | null): string {
  if (Object.hasOwn(MODE_NO_VERDICT, code)) return MODE_NO_VERDICT[code];
  const text = modeWords(code, stage);
  return text === code ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}
