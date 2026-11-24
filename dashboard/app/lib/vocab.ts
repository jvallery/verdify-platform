// SPDX-License-Identifier: MIT
/**
 * The API vocabulary the components render, as the generated client types it (`app/generated/operator-api.ts`, from
 * docs/design/dashboard/openapi/dashboard-api.v1.yaml). Each list below is checked against its generated union, so a
 * contract change the list misses fails the typecheck. The shapes are the parsed client's (`Lenient`): an enum value
 * newer than this client stays a string, which the words table shows raw.
 */
import type { components } from "../generated/operator-api";
export type { Actor, Alert, Freshness, StateReason } from "./operator-api";

type Schemas = components["schemas"];
/** Every member of `T`, once each: tsc names a missing member or a stray value. */
const everyMember = <T extends string>() => <const V extends readonly [T, ...T[]]>(values: V & ([Exclude<T, V[number]>] extends [never] ? unknown : never)) => values;

/** `ReadbackState`: computed by the API on every read (architecture §5.5); display only. */
export type ReadbackState = Schemas["ReadbackState"];
export const READBACK_STATES = everyMember<ReadbackState>()(["requested", "confirmed", "not_confirmed", "no_readback", "overridden", "released"]);

/** `StateReason.code`: why a value is not confirmed, when the platform knows. */
export type StateReasonCode = Schemas["StateReason"]["code"];
export const STATE_REASON_CODES = everyMember<StateReasonCode>()(["clamped", "deferred", "push_failed", "writer_down", "controller_not_reporting", "no_engine", "no_match"]);

/** `ProblemCode`: why a request was refused, shared with MCP. */
export type ProblemCode = Schemas["ProblemCode"];
export const PROBLEM_CODES = everyMember<ProblemCode>()([
  "invalid_request", "unauthenticated", "forbidden", "origin_mismatch", "not_found", "writes_disabled", "query_timeout", "unavailable", "window_too_large",
  "unknown_target", "read_only", "out_of_range", "manual", "request_id_reused", "check_required", "too_close", "too_many_schedules", "line_disabled",
  "line_paused", "line_faulted", "not_schedule_member", "line_busy", "manifold_busy", "cap_reached", "position_occupied",
  "ambiguous_position", "planting_ended",
]);

/** `LineState.code`: an irrigation line's state. */
export type LineStateCode = Schemas["LineState"]["code"];
export const LINE_STATE_CODES = everyMember<LineStateCode>()(["idle", "running", "waiting", "blocked", "paused", "disabled", "unknown"]);

/** `RunOutcome`: how an occurrence or run ended; `unknown` never reached the platform. */
export type RunOutcomeCode = Schemas["RunOutcome"];
/** `IrrigationLine.vpd_source` (D-IRP-13) and `IrrigationLine.fault` (D-IRP-19), without their null. */
export type VpdSource = NonNullable<Schemas["IrrigationLine"]["vpd_source"]>;
export const VPD_SOURCES = everyMember<VpdSource>()(["own", "peer", "house"]);
export type LineFault = NonNullable<Schemas["IrrigationLine"]["fault"]>;
export const LINE_FAULTS = everyMember<LineFault>()(["backing_off", "mister_fault"]);

/** `Alert.severity` and `Alert.status` (the disposition). */
export type AlertSeverity = Schemas["Alert"]["severity"];
export const ALERT_SEVERITIES = everyMember<AlertSeverity>()(["critical", "warning", "info"]);
export type AlertStatus = Schemas["Alert"]["status"];
export const ALERT_STATUSES = everyMember<AlertStatus>()(["open", "acknowledged", "resolved", "false_positive", "suppressed"]);

/** `Actor.source`: who wrote (R4). `system` is the platform itself, for example the forecast action engine. */
export const ACTOR_SOURCE_PATTERN = /^(dashboard|iris|system|agent:[a-z0-9][a-z0-9_-]*)$/;
export type ActorSource = "dashboard" | "iris" | "system" | `agent:${string}`;
/** AI labels exactly the reviewer (`iris`) and the named agents (`agent:<name>`); a host write never carries it. */
export function isAiSource(source: string): boolean {
  return source === "iris" || (source.startsWith("agent:") && ACTOR_SOURCE_PATTERN.test(source));
}

/** `BandPosition.verdict` and API-02 `overrides[].kind`, which Now words. */
export type BandVerdict = Schemas["BandPosition"]["verdict"];
export const BAND_VERDICTS = everyMember<BandVerdict>()(["in", "above", "below", "unavailable"]);
export type BurstKind = Schemas["Now"]["overrides"][number]["kind"];
export const BURST_KINDS = everyMember<BurstKind>()(["fans", "humidify", "vent_bypass"]);

/** `Setting.readback_via`, `Equipment` item `state` and `IrrigationLine.kind`, which the badges key on. */
export type ReadbackVia = Schemas["Setting"]["readback_via"];
export type EquipmentState = Schemas["Equipment"]["items"][number]["state"];
export type LineKind = Schemas["IrrigationLine"]["kind"];

/**
 * API-36 `probes[].sensor`: the probe-backed climate columns it ages (`PROBES` of verdify_services/system_health.py),
 * each as `climate.<column>`. The contract types them as strings, so this list is the vocabulary `words.test.ts` holds
 * to that file.
 */
export const PROBE_SENSORS = [
  "climate.temp_north", "climate.temp_south", "climate.temp_east", "climate.temp_west", "climate.temp_case", "climate.temp_intake",
  "climate.rh_north", "climate.rh_south", "climate.rh_east", "climate.rh_west", "climate.rh_case", "climate.intake_rh",
  "climate.outdoor_temp_f", "climate.outdoor_rh_pct", "climate.co2_ppm", "climate.lux",
  "climate.soil_moisture_south_1", "climate.soil_temp_south_1", "climate.soil_ec_south_1",
  "climate.soil_ph_south_1", "climate.soil_salinity_south_1", "climate.soil_tds_south_1",
  "climate.soil_moisture_west", "climate.soil_temp_west", "climate.soil_ec_west",
  "climate.soil_ph_west", "climate.soil_salinity_west", "climate.soil_tds_west",
] as const;
export type ProbeSensor = (typeof PROBE_SENSORS)[number];

/** API-36 `tables[].table`: the six stored tables of the data flow (`FLOW_TABLES` of system_health.py), in its order. */
export const FLOW_TABLES = ["climate", "equipment_state", "system_state", "diagnostics", "setpoint_snapshot", "setpoint_changes"] as const;
export type FlowTable = (typeof FLOW_TABLES)[number];

/**
 * API-37 `dispatcher_stage`: `ordinary`, `paced <sent>/<pending>` (as `paced`), `held:heap`, `held:lease` and
 * `held:readbacks` (the ingestor's `_dispatcher_stage_value` and `HELD_READBACKS_STAGE`).
 */
export const SENDING_CODES = ["ordinary", "paced", "held:heap", "held:lease", "held:readbacks"] as const;
export type SendingCode = (typeof SENDING_CODES)[number];

/**
 * `Delivery.by_status[].source` values that are the controller reporting a value itself, not a push: they stay out of
 * the delivery outcomes (B6).
 */
export const CONTROLLER_REPORT_SOURCES: readonly string[] = ["esp32"];
export const isControllerReport = (source: string): boolean => CONTROLLER_REPORT_SOURCES.includes(source);
/** The senders of the delivery table, in its row order: the house band, an operator, the retired planner. */
export const DELIVERY_SENDERS = ["band", "manual", "plan"] as const;
export type DeliverySender = (typeof DELIVERY_SENDERS)[number];
/** The delivery table's row for a source: the planner's two old sources share one; any other source has none (null). */
export function deliverySender(source: string): DeliverySender | null {
  if (source === "plan" || source === "iris_planner") return "plan";
  return source === "band" || source === "manual" ? source : null;
}
