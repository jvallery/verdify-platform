// SPDX-License-Identifier: MIT
import type { components } from "../generated/operator-api";
import type { AlertSeverity, AlertStatus, BandVerdict, BurstKind, FlowTable, LineFault, LineStateCode, ProbeSensor, ProblemCode, RunOutcomeCode, SendingCode, StateReasonCode, VpdSource } from "./vocab";

type Schemas = components["schemas"];
/** An enum of the contract without its null. */
type Codes<T> = Exclude<T, null | undefined>;

/**
 * The one words table (dashboard v2 words.md): every code from the API or the controller renders through it, in the
 * model's words (band, law, relays, record, review) for someone who knows plants rather than the controller. An
 * unknown code renders raw, so a code added later shows as itself rather than as nothing. `words.test.ts` fails on any
 * OpenAPI `ProblemCode`, `StateReason` or `LineState` code, alert status, schedule, line or run field, band verdict,
 * alert type (`ALERT_TYPES` in `verdify_schemas/alerts.py`, each with a title and one sentence), actuator of the fixed
 * list, activity action, Water family, controller reason family (`fog_block_reason`, `moisture_block_reason`) or
 * enum of the climate law's, the daily record's, the daily review's and the system pages' schemas without an entry
 * here, so a PR that adds one adds its words. `retired-words.test.ts` fails on a retired word of words.md section 3 in
 * any of them.
 */
const STATE_REASON = {
  clamped: "Changed to fit its limits",
  deferred: "Waiting: the controller is short of memory",
  push_failed: "Sending failed",
  writer_down: "Ingestor not running",
  controller_not_reporting: "Controller not reporting",
  no_engine: "Waits for the controller's irrigation engine",
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

/** `Alert.category`, the ingestor's coarse grouping, as an alert's details name it. */
const ALERT_CATEGORY = {
  climate: "Climate",
  equipment: "Equipment",
  sensor: "Probes",
  system: "Controller and host",
  water: "Water",
} as const;

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
  manual: "Set by hand: only a person may change it",
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
 * A `degraded_only` window on the schedule views (redesign §6.2): one ahead is a "backup" that runs only if VPD sensing
 * fails; one that passed without running was "not needed", never a hatched "skipped". "Backup" everywhere (the week
 * cells, the legend, Backup misting): "fallback" is a retired word (words.md, Running alone).
 */
const FALLBACK_WINDOW = {
  conditional: "backup",
  not_needed: "not needed",
} as const;

/**
 * The fixed actuator list (architecture §7) by `equipment_state` key: the climate relays, the eleven wet relays
 * L01-L11, the Lutron grow-light readback and the controller's own grow-light switches (`_intent`, Q-09).
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

/** API-02 `overrides[].kind`: the three timed runs an operator starts (words.md "Run by hand"), by the same names everywhere. */
const RUN_BY_HAND = { fans: "Run the fans", humidify: "Humidify", vent_bypass: "Circulate" } as const satisfies Record<BurstKind, string>;

/** `BandPosition.verdict`: a reading against the band in force. */
const BAND_VERDICT = { in: "in band", above: "above band", below: "below band", unavailable: "band unavailable" } as const satisfies Record<BandVerdict, string>;

/**
 * The codes `gh_fog_block_reason` publishes (firmware/greenhouse/controls.yaml, with `manual_fog_safety_block_reason`'s and
 * `fog_force_off_reason`'s in firmware/lib/greenhouse_logic.h): why fog is held, or that it runs. `leak_detected` is
 * today's firmware only: the engine release drops it from every force-off (Q-05).
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
  sensor_fault: "No indoor reading: equipment off",
  fert_master: "The fertilizer line is open",
  water_ceiling: "Today's water ceiling is reached",
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
  irrigation: "A drip line is running",
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

// ---------------------------------------------------------------------------------------------------- alerts
/**
 * The alert types that belong to the retired model: no producer raises them now (the ingestor resolves their open rows
 * once, `RETIRED_PLANNER_ALERT_TYPES` in ingestor/tasks/heartbeat.py, migration 316 for the experiment platform), but
 * old rows keep them, so each keeps a title marked "(retired check)" and a sentence that says so.
 */
const HISTORICAL = [
  "forecast_deviation", "forecast_action_alert", "component_experiment_integrity", "plan_context_failed", "plan_not_delivered",
  "planner_band_ownership_drift", "planner_evaluation_missed", "planner_gateway_delivery_failed", "planner_plan_horizon_missing",
  "planner_required_plan_missed", "planner_stale", "planner_trigger_sla_timeout", "planner_tunable_range_drift", "safety_invalid",
  "tunable_zero_variance", "vent_moisture_capacity_limit", "vent_vpd_moisture_gap", "vpd_stress",
] as const;
export const HISTORICAL_ALERT_TYPES: ReadonlySet<string> = new Set(HISTORICAL);

/**
 * `ALERT_TYPES` in verdify_schemas/alerts.py, titled for Now, Activity and the alert rows: what happened, in a few words.
 * The two irrigation alerts #1157 adds are worded ahead of it, so the fixtures read the same as production will.
 */
const ALERT_TYPE = {
  alert_validation_failed: "An alert could not be recorded as written",
  band_anchor_db_read_failed: "The band could not be read",
  band_device_db_divergence: "The controller's band differs from the saved band",
  band_fn_null: "The band could not be worked out",
  esp32_push_failed: "A value could not be sent to the controller",
  esp32_reboot: "Controller restarted",
  firmware_relief_ceiling: "Heat relief venting hit its limit",
  firmware_vent_latched: "The controller is holding the vent open",
  firmware_version_mismatch: "The controller is not on the expected firmware",
  heap_pressure_critical: "Controller memory critically low",
  heap_pressure_warning: "Controller memory low",
  heat_manual_override: "Heater drawing power with no command",
  heat_no_power: "Electric heat on but drawing no power",
  relay_pair_forbidden: "Two relays on that must not run together",
  outdoor_source_none: "No outdoor reading",
  case_sensor_only: "Only the case probe is reading",
  boot_stuck: "Controller stuck starting up",
  power_meter_stale: "Greenhouse power meter silent",
  daily_record_missing: "Daily record not written",
  house_temp_band_drift: "Temperature outside the band",
  relay_starts_high: "A relay is starting too often",
  reviewer_wrote_climate: "The reviewer changed a climate value",
  law_state_stale: "Climate law not reporting",
  wetting_below_vpd_band: "Fog or misters running in damp air",
  drying_meter_fault: "Drying meter not counting",
  relay_counters_backstep: "Relay counters went backwards",
  relay_counter_mismatch: "Relay counters and the daily record disagree",
  utility_out_of_baseline: "Yesterday's utility use was unusual",
  drying_refused_all_day: "Drying refused all day on price",
  probes_disagree: "Wall probes disagree",
  owner_value_changed: "An owner's value changed on the controller",
  outdoor_none_indoor_degraded: "No outdoor reading and too few indoor probes",
  outdoor_intake_only: "Outdoor air read from the intake probe only",
  furnace_saturated: "Gas furnace cannot hold the band",
  heat_staging_inversion: "Gas heat on while electric heat is off",
  house_band_drift: "VPD outside the band",
  irrigation_feedback_gap: "Watering feedback missing",
  leak_detected: "Water flowing with every Verdify valve closed",
  law_constants_mismatch: "The controller's law numbers differ from this release",
  payload_rejected: "The controller sends a record the host cannot read",
  daily_review_missed: "Yesterday's review was not written",
  lighting_cfg_threshold_drift: "Light switching levels changed on the controller",
  climate_action_proof_stale: "Climate control evidence is out of date",
  clock_unconfirmed: "The controller's clock is wrong or not set",
  relay_stuck: "Relay stuck",
  sensor_fault: "No indoor reading",
  sensor_offline: "Sensor offline",
  setpoint_delivery_stuck: "Values not reaching the controller",
  setpoint_unconfirmed: "Value not confirmed by the controller",
  site_content_stale: "The lab site is out of date",
  soil_dryout: "Soil drying out",
  soil_sensor_offline: "Soil probe offline",
  temp_safety: "Temperature at a protection limit",
  vpd_extreme: "VPD at an extreme",
  writer_absent: "Ingestor not running",
  telemetry_stall: "No new climate data",
  deploy_override: "A firmware check was overridden",
  irrigation_fence_breach: "A watering valve opened outside its program",
  irrigation_run_missed: "A scheduled watering was missed",
  irrigation_line_faulted: "A mister zone faulted",
  mcp_unreachable: "The reviewer's tools are not answering",
  planner_tool_dependency_failed: "A tool the reviewer needs failed",
  // The retired checks (HISTORICAL_ALERT_TYPES): old rows still read.
  forecast_deviation: "Weather left the forecast (retired check)",
  forecast_action_alert: "The forecast crossed a watch limit (retired check)",
  component_experiment_integrity: "A trial needed attention (retired check)",
  plan_context_failed: "Settings writer could not read its inputs (retired check)",
  plan_not_delivered: "Written settings did not arrive (retired check)",
  planner_band_ownership_drift: "Settings writer touched the band (retired check)",
  planner_evaluation_missed: "Settings writer skipped a check (retired check)",
  planner_gateway_delivery_failed: "Requests to the settings writer failed (retired check)",
  planner_plan_horizon_missing: "Nothing written for the hours ahead (retired check)",
  planner_required_plan_missed: "Settings writer missed a required run (retired check)",
  planner_stale: "Nothing new from the settings writer (retired check)",
  planner_trigger_sla_timeout: "Settings writer answered late (retired check)",
  planner_tunable_range_drift: "A written value was out of range (retired check)",
  safety_invalid: "A protection value was invalid (retired check)",
  tunable_zero_variance: "A setting stayed unchanged for a week (retired check)",
  vent_moisture_capacity_limit: "Venting and misting could not reach the band (retired check)",
  vent_vpd_moisture_gap: "Venting dry air with no misting (retired check)",
  vpd_stress: "VPD stress (retired check)",
} as const;

const RETIRED_CHECK = "A retired check: nothing raises it now, and old alerts keep its name.";
/**
 * Each alert type in one sentence: what the host or the controller saw that raised it, with its numbers. The alert
 * detail shows it under the title; the runbook, when the alert has one, follows it.
 */
const ALERT_ABOUT = {
  alert_validation_failed: "The host raised an alert whose details failed its own checks, and stored this one in its place.",
  band_anchor_db_read_failed: "The host could not read the band's edges from the database; the controller keeps the band it already holds.",
  band_device_db_divergence: "The edges the controller reports differ from the band the owner saved, by more than 1 °F or 0.10 kPa, on its newest records.",
  band_fn_null: "The database gave no edges for the band at this time of day.",
  esp32_push_failed: "The host tried to send a value to the controller and the send failed.",
  esp32_reboot: "The controller restarted without new firmware; three restarts in an hour make it critical.",
  firmware_relief_ceiling: "The controller reported two or more heat relief vents in a row.",
  firmware_vent_latched: "The controller reported the vent held open for 10 minutes or more.",
  firmware_version_mismatch: "The firmware the controller reports is not the release pinned for it.",
  heap_pressure_critical: "The controller's free memory fell below 15 kB, the critical line of its hardware budget.",
  heap_pressure_warning: "The controller's free memory fell below 30 kB, the warning line of its hardware budget.",
  heat_manual_override: "Over 1,000 W was drawn for 15 minutes with both heat relays off, so a heater may have been switched on by hand.",
  heat_no_power: "Heat 1 was on for 15 minutes while the meter read under 500 W.",
  relay_pair_forbidden: "The gas furnace ran with the vent open, or a fan ran with the vent closed, for 5 minutes.",
  outdoor_source_none: "Neither the weather station nor the intake probe gave an outdoor reading for 15 minutes, so the controller cannot dry with outdoor air.",
  case_sensor_only: "For 10 minutes no wall probe reported, and the controller held the band on the case probe alone.",
  boot_stuck: "Five minutes after a restart the controller had still not finished its start-up waits.",
  power_meter_stale: "The greenhouse power meter sent no reading for 30 minutes, so electricity is not being metered.",
  daily_record_missing: "After 06:00, yesterday's daily record or its time in band was still missing.",
  house_temp_band_drift: "For most of the last hour the house was more than 3 °F outside the band's temperature edges.",
  relay_starts_high: "A climate relay started more than 12 times in the last hour, or fog more than 15.",
  reviewer_wrote_climate: "A climate value was written in the reviewer's name, which the law no longer allows.",
  law_state_stale: "The controller is connected but sent no record of its law for 3 minutes.",
  wetting_below_vpd_band: "Fog or a mister ran for 5 minutes while the house VPD was below the band's low edge.",
  drying_meter_fault: "The controller's drying meter went backwards, or stopped counting while drying was running.",
  relay_counters_backstep: "One of the controller's relay counters went down without a restart.",
  relay_counter_mismatch: "Yesterday the controller's own counters and the stored record differed by more than 2 starts or 10 %, or by more than 30 min of run time.",
  utility_out_of_baseline: "Yesterday's electricity, gas or water was over 1.5 times the usual high of the last 30 days, or the meter covered under 70 % of the day.",
  drying_refused_all_day: "Yesterday the house wanted drying, and every time drying was refused because it cost more than the limit.",
  probes_disagree: "The wall temperature probes were more than 12 °F apart for 30 minutes.",
  owner_value_changed: "A value the owner set was confirmed, then the controller reported a different value for 15 minutes.",
  outdoor_none_indoor_degraded: "For 10 minutes there was no outdoor reading and fewer than four indoor probes answered.",
  outdoor_intake_only: "The weather station was silent for 30 minutes, so the controller reads outdoor air from the intake probe.",
  furnace_saturated: "The gas furnace ran for 90 % of the last hour and the house stayed more than 1 °F below the low edge.",
  heat_staging_inversion: "The gas furnace ran while electric heat, which the law brings on first, was off.",
  house_band_drift: "For most of the last 45 minutes the house VPD was more than 0.12 kPa outside the band.",
  irrigation_feedback_gap: "A watering run has no matching reading from the water meter or the soil probes.",
  leak_detected: "The water meter counted flow while every valve the controller drives was closed; it stays open until a person resolves it.",
  law_constants_mismatch: "The fixed numbers the controller's law was built with differ from the ones this release ships.",
  payload_rejected: "For 10 minutes every copy of one of the controller's records was refused as unreadable.",
  daily_review_missed: "By 10:00 the reviewer had not written yesterday's daily review.",
  lighting_cfg_threshold_drift: "The daylight level at which the controller switches a light differs from the value sent to it.",
  climate_action_proof_stale: "Neither a record of what the controller did nor a record of its law arrived in the last 5 minutes.",
  clock_unconfirmed: "The controller's clock is more than 2 minutes off, or has not synced for 30 minutes.",
  relay_stuck: "A relay stayed on or off against what the controller asked of it.",
  sensor_fault: "For 2 minutes the controller had no indoor reading and ran on its rules for running alone.",
  sensor_offline: "A probe or a data feed has not answered for longer than it should.",
  setpoint_delivery_stuck: "A value the host sent has not been confirmed by readback for 15 minutes; after 45 minutes it is critical.",
  setpoint_unconfirmed: "The controller did not read back a value it was sent within 5 minutes.",
  site_content_stale: "The public lab site's content has not been refreshed on time.",
  soil_dryout: "A soil probe read below its zone's wilting point for its whole window.",
  soil_sensor_offline: "A soil probe has stopped sending readings.",
  temp_safety: "The house was below 40 °F or above 100 °F, where the protection limits override everything.",
  vpd_extreme: "The house VPD was below 0.3 kPa or above 3.0 kPa.",
  writer_absent: "The host's telemetry writer holds no lease, so nothing new is being stored.",
  telemetry_stall: "The newest climate record is more than 10 minutes old.",
  deploy_override: "Someone flashed firmware past one of the pre-flight checks, with a written reason.",
  irrigation_fence_breach: "A fertilizer or center valve opened outside a program the controller applied.",
  irrigation_run_missed: "A scheduled run was reported missed, or no outcome arrived for it.",
  irrigation_line_faulted: "The controller latched a mister zone off after its watchdog tripped.",
  mcp_unreachable: "The service that gives the reviewer its tools failed several checks in a row.",
  planner_tool_dependency_failed: "One of the reviewer's tools failed because something it depends on did not answer.",
  forecast_deviation: RETIRED_CHECK,
  forecast_action_alert: RETIRED_CHECK,
  component_experiment_integrity: RETIRED_CHECK,
  plan_context_failed: RETIRED_CHECK,
  plan_not_delivered: RETIRED_CHECK,
  planner_band_ownership_drift: RETIRED_CHECK,
  planner_evaluation_missed: RETIRED_CHECK,
  planner_gateway_delivery_failed: RETIRED_CHECK,
  planner_plan_horizon_missing: RETIRED_CHECK,
  planner_required_plan_missed: RETIRED_CHECK,
  planner_stale: RETIRED_CHECK,
  planner_trigger_sla_timeout: RETIRED_CHECK,
  planner_tunable_range_drift: RETIRED_CHECK,
  safety_invalid: RETIRED_CHECK,
  tunable_zero_variance: RETIRED_CHECK,
  vent_moisture_capacity_limit: RETIRED_CHECK,
  vent_vpd_moisture_gap: RETIRED_CHECK,
  vpd_stress: RETIRED_CHECK,
} as const satisfies Record<keyof typeof ALERT_TYPE, string>;

// ---------------------------------------------------------------------------------------------------- the record and the activity log
/**
 * `activity_log.action` (`ACTIVITY_ACTION_PATTERN` in verdify_schemas/activity.py), as an Activity row's title begins:
 * the words, then the target's label ("Set Outdoor Staleness Max", "Changed line Wall drip", "Lights on Main lights").
 * `plan.write` and the `study.*` actions belong to the retired model: no service writes them now, and old rows read in
 * words that name neither.
 */
const ACTIVITY_ACTION = {
  "setting.write": "Set",
  "setting.release": "Released",
  "band.write": "Changed the band",
  "alert.ack": "Acknowledged",
  "alert.resolve": "Resolved",
  "irrigation.run": "Ran",
  "irrigation.stop": "Stopped",
  "irrigation.clear_fault": "Cleared the fault on",
  "irrigation.override": "Ran by hand",
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
  "planting.note": "Added a note to planting",
  "soil_target.write": "Changed soil target",
  "plan.write": "Settings written before the climate law",
  "study.start": "Started a trial",
  "study.pause": "Paused a trial",
  "study.resume": "Resumed a trial",
  "study.stop": "Stopped a trial",
  "study.boundary": "Trial boundary",
  "study.deviation": "Trial deviation",
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

/** The units of words.md section 5, as a screen reader or a sentence says them ("1.2 kWh/kg" is "kilowatt-hours per kilogram"). */
const UNIT = {
  "°F": "degrees Fahrenheit",
  kPa: "kilopascals",
  "%": "percent",
  kWh: "kilowatt-hours",
  therms: "therms, estimated",
  gal: "gallons",
  kg: "kilograms",
  g: "grams",
  "kWh/kg": "kilowatt-hours per kilogram of water",
  h: "hours",
  min: "minutes",
  s: "seconds",
  d: "days",
  kB: "kilobytes",
  ms: "milliseconds",
  B: "bytes",
  dBm: "decibel-milliwatts",
} as const;

// ---------------------------------------------------------------------------------------------------- the climate law, the daily record, the review and system (dashboard v2)
/** `LawRule.id`: the law's rules, as Climate lists them (words.md "Rule"). */
const LAW_RULE = {
  heat1: "Electric heat",
  heat2: "Gas furnace",
  cooling: "Cooling",
  second_fan: "Second fan",
  fog: "Fog",
  mist: "Misters",
  drying: "Drying",
  hot_limit: "Hot limit",
  cold_limit: "Cold limit",
} as const satisfies Record<Schemas["LawRule"]["id"], string>;
/** `LawRule.signal`: the reading a rule watches. */
const LAW_SIGNAL = { temp: "temperature", vpd: "VPD" } as const satisfies Record<Schemas["LawRule"]["signal"], string>;
/** `LawRule.direction`: a rule turns on when its reading goes below or above its threshold. */
const LAW_DIRECTION = { below: "turns on below", above: "turns on above" } as const satisfies Record<Schemas["LawRule"]["direction"], string>;
/** `LawRule.hold.kind`: why a relay the law asked for is waiting (words.md "Waiting"). */
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
  fog: "Fog",
  mister_any: "Any mister",
} as const satisfies Record<Schemas["LawRelay"]["equipment"], string>;
/** `LawRelay.state` and a law lane's interval state. */
const RELAY_STATE = { on: "On", off: "Off", unknown: "Not reported" } as const satisfies Record<Schemas["LawRelay"]["state"], string>;
/** `LawLane.key`: what the law asked for, and what each rule wanted (its latch; "latched" is said only in "As reported"). */
const LAW_LANE = {
  "request.heat1": "asked for electric heat",
  "request.heat2": "asked for the gas furnace",
  "request.vent": "asked for the vent",
  "request.fog": "asked for fog",
  "request.mist": "asked for misting",
  "request.fan1": "asked for one fan",
  "request.fan2": "asked for both fans",
  "request.cooling": "asked for cooling",
  "request.drying": "asked for drying",
  "request.hot": "hot limit: everything cools",
  "request.cold": "cold limit: everything heats",
  "latch.h1": "electric heat wanted",
  "latch.h2": "gas furnace wanted",
  "latch.cool": "cooling wanted",
  "latch.cool2": "second fan wanted",
  "latch.wet": "wetting wanted",
  "latch.mist": "misting wanted",
  "latch.dry": "drying wanted",
  "latch.air": "outdoor air is drier",
  "latch.run": "drying running",
} as const satisfies Record<Schemas["LawLane"]["key"], string>;
/** `LawLane.group`. */
const LAW_LANE_GROUP = { request: "Asked for", latch: "Wanted" } as const satisfies Record<Schemas["LawLane"]["group"], string>;
/** `LawDrying.state`: drying is venting with drier outdoor air when the house is too humid. */
const DRYING_STATE = {
  running: "drying",
  refused: "drying refused",
  not_wanted: "dry enough",
  unknown: "not reported",
} as const satisfies Record<Schemas["LawDrying"]["state"], string>;
/** `LawDrying.state` standing alone, as a verdict (Climate's drying decision and Drying now; screens 2.1 and 2.3). */
const DRYING_VERDICT = {
  running: "Running",
  refused: "Refused",
  not_wanted: "Not wanted",
  unknown: "Not reported",
} as const satisfies Record<Schemas["LawDrying"]["state"], string>;
/** `LawDrying.refused_reason`: the controller's first reason not to dry while the house wants it (words.md "Refused"). */
const DRYING_REFUSAL = {
  none: "nothing in the way",
  no_outdoor: "no outdoor reading",
  cooling: "the house is being cooled",
  furnace: "the gas furnace is running",
  not_drier: "outdoor air is not drier",
  too_cold: "the house is too cold to vent",
  cost: "costs more than the limit",
  humidity_invalid: "humidity cannot be read",
  no_temperature: "temperature cannot be read",
} as const satisfies Record<Codes<Schemas["LawDrying"]["refused_reason"]>, string>;
/** `LawDrying.checks[].id`: the drying decision chain, in the order the law refuses (the first failing check is the refusal reason). */
const DRYING_CHECK = {
  humid: "the house is humid enough to dry",
  not_cooling: "the house is not being cooled",
  furnace_off: "the gas furnace is off",
  outdoor_drier: "outdoor air is drier",
  warm_enough: "warm enough to vent",
  worth_it: "the price is under the limit",
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
/** `LawBand.source`: where the controller takes its band from (`corridor` is words.md's widest safe band). */
const BAND_SOURCE = {
  onchip_curve: "the band's daily curve, worked out on the controller",
  corridor: "the widest safe band: the controller has no clock",
  dispatcher_legacy: "edges pushed by the host",
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
const REVIEW_KIND = { daily: "Daily review", manual: "Review on request" } as const satisfies Record<Schemas["Review"]["kind"], string>;
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
/** `Setting.effect`: what reads a setting on this build, as Settings' three filters name it (screens.md 10.4). */
const SETTING_EFFECT = {
  controller: "read by the controller",
  host: "used by the host",
  none: "stored and not used",
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
/**
 * `Delivery.by_status[].source`: who pushed or reported a value (setpoint_changes.source; missing reads none). The
 * controller's own reports (`esp32`) are not pushes (`isControllerReport` in vocab.ts).
 */
const DELIVERY_SOURCE = {
  band: "the house band",
  // The settings writer the daily review replaced; old rows still carry its sources.
  plan: "the planner (retired)",
  iris_planner: "the planner (retired)",
  manual: "an operator",
  esp32: "the controller's own report",
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

/**
 * `DataContinuity.probes[].sensor`: the probes API-36 ages (`PROBES` of verdify_services/system_health.py, as
 * `PROBE_SENSORS` in vocab.ts lists them), named as Now names its probes ("North wall") and the metric registry its
 * readings ("relative humidity", "South 1 soil moisture"). Names: they start with a capital.
 */
const PROBE = {
  "climate.temp_north": "North wall temperature",
  "climate.temp_south": "South wall temperature",
  "climate.temp_east": "East wall temperature",
  "climate.temp_west": "West wall temperature",
  "climate.temp_case": "Controller case temperature",
  "climate.temp_intake": "Intake temperature",
  "climate.rh_north": "North wall relative humidity",
  "climate.rh_south": "South wall relative humidity",
  "climate.rh_east": "East wall relative humidity",
  "climate.rh_west": "West wall relative humidity",
  "climate.rh_case": "Controller case relative humidity",
  "climate.intake_rh": "Intake relative humidity",
  "climate.outdoor_temp_f": "Outdoor temperature",
  "climate.outdoor_rh_pct": "Outdoor relative humidity",
  "climate.co2_ppm": "CO₂",
  "climate.lux": "Indoor light",
  "climate.soil_moisture_south_1": "South Wall soil moisture",
  "climate.soil_temp_south_1": "South Wall soil temperature",
  "climate.soil_ec_south_1": "South Wall soil EC",
  "climate.soil_ph_south_1": "South Wall soil pH",
  "climate.soil_salinity_south_1": "South Wall soil salinity",
  "climate.soil_tds_south_1": "South Wall soil TDS",
  "climate.soil_moisture_west": "West Wall soil moisture",
  "climate.soil_temp_west": "West Wall soil temperature",
  "climate.soil_ec_west": "West Wall soil EC",
  "climate.soil_ph_west": "West Wall soil pH",
  "climate.soil_salinity_west": "West Wall soil salinity",
  "climate.soil_tds_west": "West Wall soil TDS",
} as const satisfies Record<ProbeSensor, string>;
/**
 * The stored tables System → Data names (API-36 `tables[].table` and the rejected rows' tables): the six of its flow
 * (`FLOW_TABLES` of system_health.py) and the others a rejected row can name. Names: they start with a capital.
 */
const FLOW_TABLE = {
  climate: "Climate readings",
  equipment_state: "Relay changes",
  system_state: "Controller state",
  diagnostics: "Controller health",
  setpoint_snapshot: "Setting readbacks",
  setpoint_changes: "Setting changes",
  energy: "Power meter",
  irr_state: "Water line state",
  water_meter_events: "Water meter",
  data_gaps: "Outages",
} as const satisfies Record<FlowTable, string> & Record<string, string>;
/**
 * API-37 `dispatcher_stage`: how the host is sending settings to the controller this pass (ingestor
 * `_dispatcher_stage_value`, and `held:readbacks`). `paced <sent>/<pending>` carries numbers: `sendingWords` words it.
 */
const SENDING = {
  ordinary: "sending as usual",
  "held:heap": "held: the controller is short of memory",
  "held:lease": "held: this host does not hold the writer's lease",
  "held:readbacks": "held: waiting for the controller to report every setting",
} as const satisfies Record<Exclude<SendingCode, "paced">, string>;

export const WORDS: { readonly [family: string]: { readonly [code: string]: string } } = {
  state_reason: STATE_REASON,
  alert_severity: ALERT_SEVERITY,
  alert_status: ALERT_STATUS,
  alert_category: ALERT_CATEGORY,
  problem_code: PROBLEM_CODE,
  line_state: LINE_STATE,
  fog_block_reason: FOG_BLOCK_REASON,
  moisture_block_reason: MOISTURE_BLOCK_REASON,
  light_result: LIGHT_RESULT,
  light_reason: LIGHT_REASON,
  light_target: LIGHT_TARGET,
  alert_type: ALERT_TYPE,
  alert_about: ALERT_ABOUT,
  equipment: EQUIPMENT,
  run_by_hand: RUN_BY_HAND,
  band_verdict: BAND_VERDICT,
  activity_action: ACTIVITY_ACTION,
  irrigation_field: IRRIGATION_FIELD,
  unit: UNIT,
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
  drying_verdict: DRYING_VERDICT,
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
  probe: PROBE,
  flow_table: FLOW_TABLE,
  sending: SENDING,
};
export type WordFamily = "state_reason" | "alert_severity" | "alert_status" | "alert_category" | "problem_code" | "line_state" | "fog_block_reason"
  | "moisture_block_reason" | "light_result" | "light_reason" | "light_target" | "alert_type" | "alert_about" | "equipment" | "run_by_hand" | "band_verdict"
  | "activity_action" | "irrigation_field" | "unit" | "run_outcome" | "fallback_window" | "vpd_source" | "line_fault" | "program_reject" | "occurrence_reason"
  | "law_rule" | "law_signal" | "law_direction" | "law_hold" | "law_relay" | "relay_state" | "law_lane" | "law_lane_group" | "drying_state" | "drying_verdict"
  | "drying_refusal" | "drying_check" | "limit_source" | "outdoor_source" | "band_source" | "gap_log" | "review_status" | "review_kind"
  | "review_failure" | "proposal_state" | "relay_comparison" | "setting_effect" | "delivery_status" | "delivery_source" | "data_gap_reason"
  | "data_gap_status" | "probe" | "flow_table" | "sending";

/** True when the table has words for `code` in `family`. */
export function hasWords(family: string, code: string): boolean {
  const table = Object.hasOwn(WORDS, family) ? WORDS[family] : undefined;
  return table !== undefined && Object.hasOwn(table, code);
}

/** The plain words for `code` in `family`, or the code itself when the table has none. */
export function words(family: WordFamily | (string & {}), code: string): string {
  return hasWords(family, code) ? WORDS[family][code] : code;
}

/**
 * A code this build has no words for, standing alone (A8): "Unknown (brownout)", shown in the muted tone
 * (`.word-unknown`). Never the raw code as the name of a thing.
 */
export function unknownWords(code: string): string {
  return `Unknown (${code})`;
}

/** The words for `code` in `family`, or "Unknown (<code>)" when the table has none: for a value standing alone. */
export function wordsOrUnknown(family: WordFamily | (string & {}), code: string): string {
  return hasWords(family, code) ? WORDS[family][code] : unknownWords(code);
}

/**
 * API-37 `dispatcher_stage` in words: "sending as usual", "pacing: 3 of 12 sent this pass", "held: …"; null when it is
 * not reported, and "Unknown (<code>)" for a code this build does not know. A fragment: `sentenceStart` it alone.
 */
export function sendingWords(stage: string | null | undefined): string | null {
  if (stage === null || stage === undefined || stage === "") return null;
  const paced = /^paced (\d+)\/(\d+)$/.exec(stage);
  if (paced) return `pacing: ${paced[1]} of ${paced[2]} sent this pass`;
  return wordsOrUnknown("sending", stage);
}

/** An alert type's one sentence, or null for a type this build does not know (its title then reads raw). */
export function alertAbout(type: string): string | null {
  return hasWords("alert_about", type) ? words("alert_about", type) : null;
}
