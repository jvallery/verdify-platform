// SPDX-License-Identifier: MIT
/**
 * The operator API client (VD-02). Types come only from the generated file, which `pnpm contract:write` renders from
 * docs/design/dashboard/openapi/dashboard-api.v1.yaml (canonical, R1); nobody edits it by hand. Parsing is lenient
 * like weather's: each parser drops fields it does not know, keeps `null` as `null` (never 0), maps an enum value
 * newer than this client to `unknown` (or to the safe value where the UI acts on it: a role reads viewer, a band
 * verdict unavailable), keeps a code the words table shows as its raw string, and returns `null` when a field the UI
 * reads is missing or mistyped. Every call is a same-origin browser fetch to `/api/v1/...`, which the BFF proxies to
 * the operator API's `/v1/...`. A write carries one `Idempotency-Key` and is sent once, never retried; a 401 raises
 * `SessionEnded` for the shell. Registry bounds and snapping stay on the server.
 */
import { z } from "zod";
import type { components, operations, paths } from "../generated/operator-api";
// Zod's eval-capability probe violates a strict browser CSP; configure before building schemas.
z.config({ jitless: true });

type Schemas = components["schemas"];
type OperationId = keyof operations;
type Json<K extends OperationId, S extends keyof operations[K]["responses"]> = operations[K]["responses"][S] extends { content: { "application/json": infer T } } ? T : never;

/**
 * A generated type as the parsers return it. Every string enum also admits a code newer than this client, which the
 * words table shows raw, and a numeric enum or constant reads as a number. Never narrower than what a parser returns.
 */
export type Lenient<T> = unknown extends T ? T
  : T extends string ? (string extends T ? string : T | (string & {}))
  : T extends number ? number
  : T extends boolean | null | undefined ? T
  : T extends readonly (infer U)[] ? readonly Lenient<U>[]
  : { readonly [K in keyof T]: Lenient<T[K]> };

export type Actor = Lenient<Schemas["Actor"]>;
export type Reading = Lenient<Schemas["Reading"]>;
export type Freshness = Lenient<Schemas["Freshness"]>;
export type Leak = Lenient<Schemas["Leak"]>;
export type Occupancy = Lenient<Schemas["Occupancy"]>;
export type Problem = Lenient<Schemas["Problem"]>;
export type ReadbackState = Lenient<Schemas["ReadbackState"]>;
export type StateReason = Lenient<Schemas["StateReason"]>;
export type DesiredSetting = Lenient<Schemas["DesiredSetting"]>;
export type Me = Lenient<Schemas["Me"]>;
export type Now = Lenient<Schemas["Now"]>;
export type Snapshot = Lenient<Schemas["Snapshot"]>;
export type MetricDef = Lenient<Schemas["MetricDef"]>;
export type Metrics = Lenient<Json<"API-03", 200>>;
export type Series = Lenient<Schemas["Series"]>;
export type SeriesColumns = Lenient<Schemas["SeriesColumns"]>;
export type StateLanes = Lenient<Schemas["StateLanes"]>;
export type BandTimeline = Lenient<Schemas["BandTimeline"]>;
export type Plan = Lenient<Schemas["Plan"]>;
export type PlanLane = Lenient<Schemas["PlanLane"]>;
export type PlanWaypoint = Lenient<Schemas["PlanWaypoint"]>;
export type PlannerTrigger = Lenient<Schemas["PlannerTrigger"]>;
export type Settings = Lenient<Json<"API-09", 200>>;
export type Setting = Lenient<Schemas["Setting"]>;
export type SettingHistory = Lenient<Schemas["SettingHistory"]>;
export type Equipment = Lenient<Schemas["Equipment"]>;
export type AlertPage = Lenient<Schemas["AlertPage"]>;
export type Alert = Lenient<Schemas["Alert"]>;
export type ActivityPage = Lenient<Schemas["ActivityPage"]>;
export type ActivityEntry = Lenient<Schemas["ActivityEntry"]>;
export type BandPreview = Lenient<Schemas["BandPreview"]>;
export type BandProfile = Lenient<Schemas["BandProfile"]>;
/** The law's three guardrails (#1633 package 1.6) are null from an API synced before them: the web can ship first. */
type LawGuardrails = "min_width_f" | "min_width_kpa" | "dry_on_above_vpd_low_kpa";
type ProfileGuardrails = Schemas["BandProfilePreview"]["guardrails"];
/** The edge form (dashboard v2, API spec §4.1) is null from an API synced before it, so the editor can ship first. */
type ProfileState = Schemas["BandProfileState"];
type EdgeState = Omit<ProfileState, "edges" | "edges_simple"> & { edges: ProfileState["edges"] | null; edges_simple: ProfileState["edges_simple"] | null };
export type BandProfilePreview = Lenient<Omit<Schemas["BandProfilePreview"], "guardrails" | "current" | "draft" | "law_lines"> & {
  guardrails: Omit<ProfileGuardrails, LawGuardrails> & { [K in LawGuardrails]: ProfileGuardrails[K] | null };
  current: EdgeState; draft: EdgeState; law_lines: Schemas["BandLawLines"] | null;
}>;
export type BandProfileState = BandProfilePreview["current"];
export type BandProfileEdges = Lenient<Schemas["BandProfileEdges"]>;
export type BandEdgesSimple = Lenient<Schemas["BandEdgesSimple"]>;
export type BandLawLines = Lenient<Schemas["BandLawLines"]>;
export type BandProfilePatch = Lenient<Schemas["BandProfilePatch"]>;
export type BandWrite = Lenient<Schemas["BandWrite"]>;
export type LightCommand = Lenient<Schemas["LightCommand"]>;
export type SoilTarget = Lenient<Schemas["SoilTarget"]>;
export type SoilTargets = Lenient<Schemas["SoilTargets"]>;
export type WaterUse = Lenient<Schemas["WaterUse"]>;
export type LightingDays = Lenient<Schemas["LightingDays"]>;
export type LightingCircuit = Lenient<Schemas["LightingDays"]["circuits"][number]>;
export type LightingDay = Lenient<Schemas["LightingDays"]["circuits"][number]["days"][number]>;
export type PlannerHistory = Lenient<Schemas["PlannerHistory"]>;
export type PlannerDay = PlannerHistory["days"][number];
export type IrrigationStatus = Lenient<Schemas["IrrigationStatus"]>;
export type IrrigationLine = Lenient<Schemas["IrrigationLine"]>;
export type LineState = Lenient<Schemas["LineState"]>;
export type ScheduleAgenda = Lenient<Schemas["ScheduleAgenda"]>;
export type Schedule = Lenient<Schemas["Schedule"]>;
export type Occurrence = Lenient<Schemas["Occurrence"]>;
export type Command = Lenient<Schemas["Command"]>;
export type LinesUpdated = Lenient<Json<"API-IRR-08", 200>>;
export type MinutesReport = Lenient<Schemas["MinutesReport"]>;
export type RunPage = Lenient<Schemas["RunPage"]>;
export type Run = Lenient<Schemas["Run"]>;
export type SessionToken = Lenient<Schemas["SessionToken"]>;
export type Readiness = Lenient<Schemas["Readiness"]>;
export type Health = Lenient<Json<"OPS-01", 200>>;
export type Locations = Lenient<Schemas["Locations"]>;
export type CropZone = Lenient<Schemas["ZoneView"]>;
export type CropShelf = Lenient<Schemas["ShelfView"]>;
export type CropCell = Lenient<Schemas["CellView"]>;
export type Occupant = Lenient<Schemas["Occupant"]>;
export type Planting = Lenient<Schemas["Planting"]>;
export type PlantingDetail = Lenient<Schemas["PlantingDetail"]>;
export type PlantingList = Lenient<Schemas["PlantingList"]>;
export type Place = Lenient<Schemas["Place"]>;
export type PositionHistory = Lenient<Schemas["PositionHistory"]>;
export type CropCatalog = Lenient<Schemas["Catalog"]>;
export type Resolution = Lenient<Schemas["Resolution"]>;
export type CropConflict = Lenient<Schemas["Conflict"]>;
export type PlantingNote = Lenient<Schemas["PlantingNote"]>;
export type BandEdges = Lenient<Schemas["BandEdges"]>;
export type HostBandEdges = Lenient<Schemas["HostBandEdges"]>;
export type LawView = Lenient<Schemas["LawView"]>;
export type LawBand = Lenient<Schemas["LawBand"]>;
export type LawInputs = Lenient<Schemas["LawInputs"]>;
export type LawRule = Lenient<Schemas["LawRule"]>;
export type LawRelay = Lenient<Schemas["LawRelay"]>;
export type LawDrying = Lenient<Schemas["LawDrying"]>;
export type LawTiming = Lenient<Schemas["LawTiming"]>;
export type LawAlone = Lenient<Schemas["LawAlone"]>;
export type LawConstants = Lenient<Schemas["LawConstants"]>;
export type LawHistory = Lenient<Schemas["LawHistory"]>;
export type LawLane = Lenient<Schemas["LawLane"]>;
export type DailyRecord = Lenient<Schemas["DailyRecord"]>;
export type RecordDay = Lenient<Schemas["RecordDay"]>;
export type RecordBand = Lenient<Schemas["RecordBand"]>;
export type RecordDrying = Lenient<Schemas["RecordDrying"]>;
export type RecordMeans = Lenient<Schemas["RecordMeans"]>;
export type RecordPeriod = Lenient<Schemas["RecordPeriod"]>;
export type RelayCheck = Lenient<Schemas["RelayCheck"]>;
type ReviewTokens = Schemas["ReviewPage"]["tokens"];
/** API-34. An older API serves no token counts: `count_7` and `count_30` read as null (not known) there. */
export type ReviewPage = Lenient<Omit<Schemas["ReviewPage"], "tokens"> & {
  tokens: Omit<ReviewTokens, "count_7" | "count_30"> & { count_7: ReviewTokens["count_7"] | null; count_30: ReviewTokens["count_30"] | null };
}>;
export type Review = Lenient<Schemas["Review"]>;
export type ReviewProposal = Lenient<Schemas["ReviewProposal"]>;
export type ControllerHealth = Lenient<Schemas["ControllerHealth"]>;
export type DataContinuity = Lenient<Schemas["DataContinuity"]>;
export type Delivery = Lenient<Schemas["Delivery"]>;

// ---------------------------------------------------------------------------------------------------- field parsers
const text = z.string();
const num = z.number();
const int = z.number().int();
const flag = z.boolean();
/** An optional field that may be null: absent reads null. */
const maybe = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);
/** A code the words table words (design system §1 rule 3): a code newer than this client stays raw. */
const code = z.string();
const record = z.record(z.string(), z.unknown());
/** Every value of a generated string enum; tsc fails when the contract adds one this list lacks. */
const members = <T extends string>() => <const V extends readonly [T, ...T[]]>(values: V & ([Exclude<T, V[number]>] extends [never] ? unknown : never)) => values;
/** An enum the UI acts on: a value newer than this client reads `fallback`. A missing or non-string value fails. */
function choice<const V extends readonly [string, ...string[]]>(values: V, fallback: V[number]) {
  const known = new Set<string>(values);
  return z.string().transform((value) => (known.has(value) ? value : fallback) as V[number]);
}
export const CAUSES = members<Schemas["IrrigationCause"]>()(["vpd", "schedule", "run_now", "feed", "prewet", "flush", "fallback", "unknown"]);
export const OUTCOMES = members<Schemas["RunOutcome"]>()(["ok", "short", "stopped", "preempted", "skipped", "missed", "cap", "unknown"]);
export const LINE_STATES = members<Schemas["LineState"]["code"]>()(["idle", "running", "waiting", "blocked", "paused", "disabled", "unknown"]);
export const RELAY_STATES = members<Schemas["Equipment"]["items"][number]["state"]>()(["on", "off", "unknown"]);
export const ROLES = members<Schemas["Me"]["role"]>()(["operator", "viewer"]);
export const VERDICTS = members<Schemas["BandPosition"]["verdict"]>()(["in", "above", "below", "unavailable"]);
/** What water was for (#1348): irrigation waters plants; climate is VPD and fallback misting, and every fog run. */
export const PURPOSES = members<Schemas["RunPurpose"]>()(["irrigation", "climate"]);
export type Purpose = (typeof PURPOSES)[number];
/** The fog line: every run on it is climate. */
export const FOG_LINE = "L11";
const CLIMATE_CAUSES: ReadonlySet<string> = new Set(["vpd", "fallback"]);
/** A run's purpose from its line and cause, as `verdify_schemas.irrigation.purpose_of` gives it. */
export function purposeOf(lineId: string, cause: string): Purpose {
  return lineId === FOG_LINE || CLIMATE_CAUSES.has(cause) ? "climate" : "irrigation";
}
/** A minutes row's purpose from its group: a line id, a zone (fog is all climate) or a cause. */
export function groupPurpose(groupBy: string, group: string, cause: string): Purpose {
  if (groupBy === "line") return purposeOf(group, cause);
  if (groupBy === "zone" && group === "fog") return "climate";
  return purposeOf("", cause);
}
const cause = choice(CAUSES, "unknown");
/** A server older than #1348 sends no purpose: it is then read from the line and cause, the server's own rule. */
const purpose = choice(PURPOSES, "irrigation").optional();
const outcome = choice(OUTCOMES, "unknown");
const relay = choice(RELAY_STATES, "unknown");
const nullableNumbers = z.array(num.nullable());

// ---------------------------------------------------------------------------------------------------- schemas
const actor = z.object({ source: text, name: text });
const reading = z.object({ value: num.nullable(), observed_at: text.nullable(), reason: maybe(text) });
const freshness = z.object({ observed_at: text.nullable(), age_s: int.nullable(), cadence_s: int.optional(), stale: flag });
const timedValue = z.object({ at: text, value: num.nullable() });
const leak = z.object({
  active: flag.nullable(), since: maybe(text), flow_gpm: maybe(num), gal_last_10min: maybe(int), alert_id: int.nullable(), stopped_at: text.nullable(),
});
const occupancy = z.object({ occupied: flag.nullable(), seen_at: text.nullable(), hold_enabled: maybe(flag) });
const stateReason = z.object({ code, detail: maybe(text), applied_value: maybe(num), since: maybe(text) });
const desiredSetting = z.object({
  id: int, param: text, value: num.nullable(), snapped_from: maybe(num), manual: flag, manual_before: maybe(flag), state: code,
  state_reason: maybe(stateReason), confirmed_at: maybe(text), actor, reason: maybe(text), created_at: text,
});
const problem = z.object({
  type: text.default("about:blank"), title: text, status: int, detail: text.optional(), code, retryable: flag, field: text.optional(),
  min: maybe(num), max: maybe(num), current: maybe(z.union([num, text, flag])), retry_after_s: maybe(int), result: code.optional(),
  request_id: text.optional(),
});
const page = { next_cursor: text.nullable() };

const me = z.object({ username: text, display_name: maybe(text), role: choice(ROLES, "viewer"), writes_enabled: flag, source_revision: text });
const sessionToken = z.object({ token: text, expires_at: text });
const readiness = z.object({ status: code, source_revision: text, operator_api: code.optional(), authentik: code.optional() });
const health = z.object({ status: code.optional() });

const bandPosition = z.object({ low: num.nullable(), high: num.nullable(), verdict: choice(VERDICTS, "unavailable") });
const controller = z.object({
  firmware_version: maybe(text), uptime_s: maybe(int), reset_reason: maybe(text), heap_free_kb: maybe(num), heap_largest_block_kb: maybe(num),
  rssi_dbm: maybe(num), observed_at: maybe(text),
  // The shell banner's three health facts (dashboard v2); a server before them sends none, read as null.
  heap_minute_low_kb: maybe(num), restart_count: maybe(int), gap_log: maybe(code),
});
const bandEdges = z.object({ temp_low_f: num, temp_high_f: num, vpd_low_kpa: num, vpd_high_kpa: num });
/** The host's band (LawBand.host): an edge it cannot compute is null. */
const hostBandEdges = z.object({ temp_low_f: maybe(num), temp_high_f: maybe(num), vpd_low_kpa: maybe(num), vpd_high_kpa: maybe(num) });
/** The greenhouse snapshot (#1346); a server before it sends none. */
const snapshot = z.object({
  text, generated_at: text, as_of: text, model: text, stale: flag, stale_reason: maybe(code), outdated: flag,
});
/** The climate law's state record while it is fresh (#1633 package 4.1); null before the law build, absent from an older server. */
const lawState = z.object({
  observed_at: text, latches: z.array(text), requests: z.array(text), drying: choice(["running", "refused", "not_wanted"] as const, "not_wanted"),
  drying_refused_reason: maybe(text), drying_cost_kwh_per_kg: maybe(num), drying_cost_limit_kwh_per_kg: num, band_repaired: flag,
  band: maybe(bandEdges),
});
/** Today's daily review on Now (dashboard v2); null before the reviewer has a row, absent from an older server. */
const nowReview = z.object({ review_date: text, status: code, missed: flag, written_at: maybe(text), proposal_waiting: flag });
const now = z.object({
  server_time: text,
  indoor: z.object({ temp_f: reading, rh_pct: reading, vpd_kpa: reading }),
  outdoor: z.object({ temp_f: reading, rh_pct: reading, source: maybe(code) }),
  band: z.object({ temp_f: bandPosition, vpd_kpa: bandPosition, rh_pct: bandPosition.nullable(), observed_at: maybe(text) }),
  mode: z.object({ code: text, stage: maybe(text), reason: maybe(text), since: maybe(text) }),
  iris: z.object({ plan_id: text.nullable(), trigger: maybe(text), valid_until: maybe(text), required_trigger: code }),
  alerts: z.object({ open: int, critical: int, warning: int, info: int }),
  running: z.array(z.object({ equipment: text, line_id: maybe(text), cause: maybe(cause), since: text.nullable() })),
  overrides: z.array(z.object({ kind: code, since: text, ends_at: text.nullable(), held_reason: maybe(text) })),
  leak,
  freshness: z.object({ climate: freshness, diagnostics: freshness, readback: freshness, ingestor: freshness }),
  writer: z.object({ last_at: maybe(text), age_s: int.nullable(), stuck: flag, differing: int, oldest_since: maybe(text) }),
  controller: controller.optional(),
  snapshot: snapshot.nullable().optional(),
  hydroponics: z.object({ ph: reading, ec_us_cm: reading, water_temp_f: reading, stale_after_s: int.positive() }).nullable().optional(),
  law: lawState.nullable().optional(),
  review: maybe(nowReview),
});

const metricDef = z.object({
  key: text, label: text, group: text, unit: text, cadence_s: int, retention_days: int, provenance: code, zone: maybe(text), daily: flag,
  note: maybe(text),
});
const metrics = z.object({ items: z.array(metricDef) });
const seriesColumns = z.object({
  avg: nullableNumbers, min: nullableNumbers, max: nullableNumbers, count: z.array(int), source: code, retained_from: maybe(text),
  reason: z.array(text.nullable()).optional(), issued_at: maybe(text),
});
const series = z.object({
  from: text, to: text, bucket_s: int, t: z.array(int), series: z.record(z.string(), seriesColumns), watermark: text.nullable(), server_time: text,
  gaps: z.array(z.object({ start: text, end: text, reason: text.nullable() })).default([]),
});
const stateLanes = z.object({
  from: text, to: text,
  lanes: z.array(z.object({
    equipment: text, label: text.optional(), group: code, line_id: maybe(text),
    intervals: z.array(z.object({ start: text, end: text, state: relay, cause: maybe(cause) })),
  })),
});
const bandColumns = z.object({ temp_low: nullableNumbers, temp_high: nullableNumbers, vpd_low: nullableNumbers, vpd_high: nullableNumbers });
const achievableNight = z.object({
  night: text, graded: int, served_in_pct: maybe(num), achievable_in_pct: maybe(num), below_served_pct: maybe(num), below_achievable_pct: maybe(num),
  fit: maybe(z.object({ hours: int, rmse_f: num })),
});
// #1433: asked for with `achievable`; older answers have no field, which reads as null.
const achievableColumns = z.object({
  vpd_low: nullableNumbers, vpd_high: nullableNumbers, expected_low: nullableNumbers, expected_high: nullableNumbers, days: int, nights: z.array(achievableNight),
});
const bandTimeline = z.object({ from: text, to: text, step_s: int, t: z.array(int), band: bandColumns, crop: bandColumns, achievable: maybe(achievableColumns) });
const bandCurve = z.object({ low: nullableNumbers, target: nullableNumbers, high: nullableNumbers });
const bandPreview = z.object({ param: text, unit: text, day: text, step_s: int, t: z.array(int), current: bandCurve, draft: bandCurve });
const bandProfile = z.object({
  temp_day: num, temp_night: num, temp_width_day: num, temp_width_night: num, vpd_day: num, vpd_night: num,
  vpd_below_day: num, vpd_above_day: num, vpd_below_night: num, vpd_above_night: num,
});
const bandWrite = z.object({ changed: z.array(desiredSetting) });
const soilTarget = z.object({
  zone: text, wilt_pct: num, min_pct: num, max_pct: num, saturation_pct: num, notes: maybe(text),
  probe: maybe(text), sensor_id: maybe(text), occupancy_zone: maybe(text),
  updated_at: maybe(text), updated_by: maybe(actor), reason: maybe(text),
});
const soilTargets = z.object({ targets: z.array(soilTarget) });
const bandProfileEdges = z.object({
  temp_low_day: num, temp_high_day: num, temp_low_night: num, temp_high_night: num,
  vpd_low_day: num, vpd_high_day: num, vpd_low_night: num, vpd_high_night: num,
});
const bandLawLines = z.object({
  heat1_on_above_low_f: num, heat2_on_above_low_f: num, cool_on_above_high_f: num, fan2_on_above_high_f: num,
  dry_on_above_vpd_low_kpa: num, fog_on_above_vpd_high_kpa: num, mist_on_above_vpd_high_kpa: num,
});
const bandProfileState = z.object({
  profile: bandProfile, anchors: z.record(z.string(), num), simple: flag,
  // The edge form; an API from before it sends none, read as null.
  edges: maybe(bandProfileEdges), edges_simple: maybe(z.object({ temp: flag, vpd: flag })),
});
const bandProfilePreview = z.object({
  day: text, step_s: int, t: z.array(int),
  sun: z.object({ sunrise: maybe(int), solar_noon: maybe(int), sunset: maybe(int), solar_midnight: maybe(int) }),
  current: bandProfileState, draft: bandProfileState, changed: z.array(text),
  temp: z.object({ current: bandCurve, draft: bandCurve }),
  vpd: z.object({ current: bandCurve, draft: bandCurve, expected_low: nullableNumbers, expected_high: nullableNumbers }),
  guardrails: z.object({ temp_min_f: num, temp_max_f: num, margin_f: num, vpd_min_kpa: num, vpd_max_kpa: num, night_vpd_floor_kpa: num,
    min_width_f: maybe(num), min_width_kpa: maybe(num), dry_on_above_vpd_low_kpa: maybe(num) }),
  law_lines: maybe(bandLawLines),
  overshoot: z.record(z.string(), num),
  night_heat_kwh: z.object({ current: maybe(num), draft: maybe(num) }),
  envelope: maybe(z.object({ hours: int, days: int, rmse_f: num, dewpoint_p10_f: num })),
  findings: z.array(z.object({ code, severity: z.enum(["error", "warning"]).catch("warning"), field: text, detail: text })),
  // The overlays: an API from before them draws none, rather than failing the page.
  measured: z.object({ window_start: int, window_end: int, at: z.array(maybe(int)), temp: nullableNumbers, vpd: nullableNumbers })
    .catch({ window_start: 0, window_end: 0, at: [], temp: [], vpd: [] }),
  forecast: z.object({ temp: nullableNumbers, vpd: nullableNumbers, issued_at: maybe(text) }).catch({ temp: [], vpd: [], issued_at: null }),
});

const planRecord = z.object({
  plan_id: text, trigger: text, written_at: text, valid_from: maybe(text), valid_until: maybe(text), status: maybe(text), hypothesis: maybe(text),
  experiment: maybe(text), expected_outcome: maybe(text), conditions_summary: maybe(text), outcome_score: maybe(num), lesson: maybe(text),
  detail: record.optional(),
});
const plannerTrigger = z.object({
  trigger: text, required: flag, expected_at: text, due_at: text, outcome: code, resolved_at: maybe(text), failure_class: maybe(text),
});
const planWaypoint = z.object({ at: text, value: num.nullable(), source: code, effective: flag });
const planLane = z.object({
  param: text, label: text, unit: maybe(text), device: reading, waypoints: z.array(planWaypoint), desired: desiredSetting.nullable(), applied_from: code,
});
const plan = z.object({
  plan: planRecord.nullable(), no_plan_since: maybe(text), lanes: z.array(planLane), manual_count: int, health: z.array(plannerTrigger),
});
/** A setting's operator text (#1332); a server older than it sends none. */
const settingHelp = z.object({
  summary: text, effect: text, raise: maybe(text), lower: maybe(text), caution: maybe(text), guardrail: flag.optional(), reference_url: maybe(text),
});
const setting = z.object({
  param: text, label: text, control_class: code, group: code, kind: code, unit: maybe(text), min: maybe(num), max: maybe(num), step: maybe(num),
  options: z.array(z.object({ value: num, label: text })).optional(), writable: flag, read_only_reason: maybe(text),
  read_only_kind: maybe(code), source_params: z.array(text).optional(), help: settingHelp.nullable().optional(), readback_via: code,
  readback: reading.nullable(), desired: desiredSetting.nullable(),
  plan: z.object({ value: num.nullable(), plan_id: text, source: code, written_at: text, next: planWaypoint.nullable() }).nullable(),
  applied_from: code, state: code,
  // What reads the setting on this build (dashboard v2); a server before it sends none.
  effect: code.optional(),
});
const settings = z.object({ items: z.array(setting), server_time: text });
const settingHistory = z.object({
  param: text, unit: maybe(text), min: maybe(num), max: maybe(num), from: text, to: text, desired: z.array(desiredSetting),
  plan: z.array(planWaypoint), readback: z.array(timedValue),
});

const reasonState = z.object({ code: text.nullable(), since: text.nullable(), observed_at: text.nullable() });
const equipment = z.object({
  items: z.array(z.object({
    equipment: text, label: text, group: code, line_id: maybe(text), state: relay, since: maybe(text), runtime_today_s: maybe(int),
    cycles_today: maybe(int), intent: maybe(relay), observed_at: text.nullable(),
    // Grow lights only: the timer's end (#1377) and the controller's reason (#1335); a strict parse would drop them.
    manual_until: maybe(text), auto_reason: maybe(text),
  })),
  mode_reason: reasonState.optional(), fog_block_reason: reasonState.optional(), moisture_block_reason: reasonState.optional(),
});
const alert = z.object({
  id: int, alert_type: text, category: text, severity: code, message: text, zone: maybe(text), metric_value: maybe(num), threshold_value: maybe(num),
  details: record.optional(), status: code, first_seen_at: text, last_seen_at: maybe(text), count: int.optional(), acknowledged_at: maybe(text),
  acknowledged_by: maybe(text), notes: maybe(text), resolved_at: maybe(text), resolved_by: maybe(text), resolution: maybe(text), runbook: maybe(text),
});
const alertPage = z.object({ ...page, items: z.array(alert) });
const activityEntry = z.object({
  id: int, ts: text, actor, action: text, target: text, detail: record.optional(), reason: maybe(text), state: maybe(code), confirmed_at: maybe(text),
  experiment_id: maybe(text), request_id: maybe(text),
});
const activityPage = z.object({ ...page, items: z.array(activityEntry) });
const lightCommand = z.object({ light: code, state: code, result: code, activity_id: int });
const gallons = z.record(z.string(), int).nullable();
const waterUse = z.object({
  from: text, to: text,
  days: z.array(z.object({ date: text, coverage: code, meter_gal: int.nullable(), by_line: gallons, by_cause: gallons, by_purpose: gallons.default(null), no_valve_gal: int.nullable() })),
});

const lightingDays = z.object({
  from: text, to: text,
  circuits: z.array(z.object({
    light: code, equipment: text, label: text,
    days: z.array(z.object({
      date: text, partial: z.boolean(), on_s: int, starts: int, start_hour: int.nullable(), cutoff_hour: int.nullable(), lux_on: num.nullable(), lux_off: num.nullable(),
      target_min: int.nullable(), window_min: int.nullable(), qualified_min: int.nullable(),
    })),
  })),
});
// The Planner section (#1361). Null is "not recorded", never 0.
const counts = z.record(z.string(), int);
const plannerDayCost = z.object({
  calls: int, models: z.array(text), input_tokens: maybe(int), output_tokens: maybe(int), energy_wh: maybe(num), latency_ms_median: maybe(int),
  dispatched: maybe(int), proposed_only: maybe(int),
});
const planCost = z.object({
  model_id: maybe(text), input_tokens: maybe(int), output_tokens: maybe(int), energy_wh: maybe(num), latency_ms: maybe(int), status: maybe(code),
});
const plannerHistory = z.object({
  from: text, to: text, cost_recorded_from: maybe(text), cortex_attempts: flag,
  days: z.array(z.object({
    date: text, plans_written: int, triggers: counts, params_dispatched: int, changes_dispatched: int, changes_confirmed: int, required_due: int,
    required_written: int, required_failed: int, required_late: int, cost: plannerDayCost.nullable(),
  })),
  plans: z.array(z.object({
    plan_id: text, trigger: text, written_at: text, hypothesis: maybe(text), outcome_score: maybe(num), params_dispatched: int, cost: planCost.nullable(),
  })),
});
const lineState = z.object({
  code: choice(LINE_STATES, "unknown"), cause: maybe(cause), slot_id: maybe(int), reason: maybe(text), ends_at: maybe(text), observed_at: maybe(text),
});
const nextRun = z.object({ line_id: text, slot_id: int, start_at: text, label: maybe(text), minutes: maybe(num) });
const irrigationLine = z.object({
  line_id: text, name: text, zone: code, kind: code, clean_partner: maybe(text), reserved: flag, enabled: flag,
  check: z.object({ checked_by: text, checked_at: text, note: maybe(text) }).nullable(), vpd_member: maybe(flag), schedule_member: maybe(flag),
  vpd_source: maybe(code), daily_cap_min: int, vpd_reserve_min: maybe(int), paused_until: text.nullable(), paused_by: maybe(actor),
  pause_reason: maybe(text), fault: maybe(code), fault_until: maybe(text), manual: flag, manual_before: maybe(flag), state: lineState,
  today: z.object({ minutes: maybe(num), pulses: maybe(int), gal: maybe(int), climate_minutes: maybe(num), climate_pulses: maybe(int) }).optional(), next_run: maybe(nextRun),
  last_water: maybe(z.object({ at: text, open_s: int, pulses: maybe(int), cause, purpose })),
  last_outcome: maybe(z.object({ outcome, at: text, reason: maybe(text) })), sync: code,
}).transform((line) => ({
  ...line, last_water: line.last_water && { ...line.last_water, purpose: line.last_water.purpose ?? purposeOf(line.line_id, line.last_water.cause) },
}));
const programSync = z.object({
  state: code, revision: maybe(int), desired_sha256: text, applied_revision: maybe(int), applied_hash: maybe(text), src: code.nullable(),
  reason: maybe(text), pushed_at: maybe(text), confirmed_at: maybe(text), reject_code: maybe(text), next_retry_at: maybe(text),
});
const usedOfMax = z.object({ used: num.nullable(), max: num.nullable() });
/** #1336: one variant of a physical line; an API from before it sends no `circuits`, read as none. */
const circuitVariant = z.object({ variant: code, line_id: maybe(text), wired: flag, master_valve: flag, enabled: flag, running: flag });
const circuit = z.object({ circuit_id: code, name: text, zone: code, kind: code, clean: circuitVariant, fertilized: circuitVariant });
const irrigationStatus = z.object({
  server_time: text, engine: flag, program: programSync, lines: z.array(irrigationLine), circuits: z.array(circuit).default([]),
  active_runs: z.array(z.object({
    manifold: code, line_id: text, cause, slot_id: maybe(int), started_at: text, ends_at: maybe(text), pulses_done: maybe(int), pulses_total: maybe(int),
  })),
  today: z.object({
    date: text, zones: z.record(z.string(), num.nullable()), climate_zones: z.record(z.string(), num.nullable()).default({}),
    climate: z.object({ minutes: maybe(num), pulses: maybe(int), gal: maybe(int) }).default({ minutes: null, pulses: null, gal: null }),
  }),
  limits: z.object({ saf4_gal: usedOfMax, soft_budget_gal: usedOfMax }), leak, occupancy, fallback_active: flag, freshness,
});
const schedule = z.object({
  slot_id: int, line_id: text, label: text.optional(), enabled: flag, days: z.array(code), start: z.object({ kind: code, clock: text.optional(), offset_min: int.default(0) }),
  on_s: int, count: int, gap_s: int.default(0), prewet_s: int.default(0), flush_s: int.default(0), degraded_only: flag.default(false), manual: flag,
  reason: text.optional(), manual_before: maybe(flag), sync: code, updated_by: actor, updated_at: text,
});
const occurrence = z.object({
  slot_id: int, line_id: text, planned_start: text, status: code, outcome: maybe(outcome), reason: maybe(text), run_id: maybe(text),
});
const scheduleAgenda = z.object({
  schedules: z.array(schedule), occurrences: z.array(occurrence), counts: z.object({ schedules: int, max_schedules: int }),
  bounds: z.record(z.string(), z.record(z.string(), z.object({ min: num, max: num }))),
  solar: z.array(z.object({ date: text, sunrise: text, solar_noon: text, sunset: text })),
});
const command = z.object({
  command_id: text, kind: code, line_id: text.nullable(), args: record.optional(), status: code, actor, reason: maybe(text), created_at: text,
  sent_at: maybe(text),
});
const linesUpdated = z.object({ lines: z.array(irrigationLine) });
const minutesReport = z.object({
  from: text, to: text, group_by: code, purpose: maybe(choice(PURPOSES, "irrigation")), periods: z.array(z.object({ start: text, coverage: code })),
  rows: z.array(z.object({ period: text, group: text, cause, purpose, chemistry: code, minutes: num, pulses: maybe(int), gal: maybe(int) })),
}).transform((report) => ({
  ...report, rows: report.rows.map((row) => ({ ...row, purpose: row.purpose ?? groupPurpose(report.group_by, row.group, row.cause) })),
}));
const run = z.object({
  run_id: text, line_id: text, zone: text, chemistry: code, cause, purpose, slot_id: maybe(int), schedule_label: maybe(text), command_id: maybe(text),
  actor: maybe(actor), started_at: text, ended_at: maybe(text), open_s: int, pulses: maybe(int), gal: maybe(int), outcome, reason: maybe(text),
}).transform((value) => ({ ...value, purpose: value.purpose ?? purposeOf(value.line_id, value.cause) }));
const runPage = z.object({ ...page, items: z.array(run) });
// Crops (#1327, #1330): the location tree, plantings and the place preview.
const occupant = z.object({ planting_id: int, crop: text, variety: maybe(text), since: text, count: maybe(int) });
const cropCell = z.object({
  label: text, number: maybe(int), mount_type: maybe(text), layout_group: maybe(text), layout_row: maybe(int), layout_col: maybe(int), occupant: maybe(occupant),
});
const cropShelf = z.object({
  slug: text, name: text, kind: code, tier: maybe(int), wall: maybe(code), display_order: maybe(int), label_short: maybe(text),
  water_lines: z.array(z.object({ line_id: text, name: text, note: maybe(text) })).default([]), plantings: z.array(occupant).default([]), cells: z.array(cropCell).default([]),
});
const cropZone = z.object({ slug: text, name: text, plantings: z.array(occupant).default([]), shelves: z.array(cropShelf).default([]) });
const locations = z.object({ zones: z.array(cropZone), cell_count: int, occupied_cells: int, active_plantings: int, server_time: text });
const place = z.object({ zone: text, shelf: maybe(text), cell: maybe(text), since: text, until: maybe(text), count: maybe(int) });
const plantingFields = {
  id: int, crop: text, variety: maybe(text), crop_catalog_slug: maybe(text), count: maybe(int), stage: maybe(code), planted_date: text, active: flag,
  ended_at: maybe(text), end_reason: maybe(code), notes: maybe(text), recorded_by: maybe(actor), zones: z.array(text).default([]),
  shelves: z.array(text).default([]), cells: z.array(text).default([]), where: maybe(text), places: z.array(place).default([]),
};
const planting = z.object(plantingFields);
const plantingDetail = z.object({
  ...plantingFields, history: z.array(place).default([]),
  events: z.array(z.object({
    id: int, ts: maybe(text), event_type: code, count: maybe(int), notes: maybe(text), source: maybe(text), operator: maybe(text), detail: maybe(record),
  })).default([]),
  harvests: z.array(z.object({ id: int, ts: maybe(text), unit_count: maybe(int), weight_kg: maybe(num), notes: maybe(text), operator: maybe(text) })).default([]),
});
const plantingList = z.object({ items: z.array(planting) });
const positionHistory = z.object({
  label: text, zone: text, shelf: text,
  items: z.array(z.object({ planting_id: int, crop: text, variety: maybe(text), since: text, until: maybe(text), count: maybe(int) })),
});
const cropCatalog = z.object({ items: z.array(z.object({ slug: text, name: text, category: maybe(text) })) });
const cropConflict = z.object({ cell: text, planting_id: int, crop: text, since: text, until: maybe(text) });
const resolution = z.object({
  places: z.array(z.object({ zone: text, shelf: maybe(text), cell: maybe(text) })), cells: z.array(text), where: text, at: text,
  conflicts: z.array(cropConflict).default([]),
});

// The climate law (API-30, API-31). Null is "not reported", never 0.
export const DRYING_STATES = members<Schemas["LawDrying"]["state"]>()(["running", "refused", "not_wanted", "unknown"]);
const span = { start: text, end: text };
const lawRelay = z.object({ equipment: code, state: relay, since: maybe(text) });
const lawRule = z.object({
  id: code, signal: code, direction: code, on_at: maybe(num), off_at: maybe(num), latched: maybe(flag), requested: maybe(flag),
  relays: z.array(lawRelay), hold: maybe(z.object({ kind: code, remaining_s: int })),
});
const lawDrying = z.object({
  state: choice(DRYING_STATES, "unknown"), wanted: maybe(flag), outdoor_drier: maybe(flag), refused_reason: maybe(code),
  cost_kwh_per_kg: maybe(num), limit_kwh_per_kg: maybe(num), limit_source: code, wanted_below_kpa: maybe(num), stop_above_kpa: maybe(num),
  min_temp_f: maybe(num), checks: z.array(z.object({ id: code, ok: maybe(flag) })),
  meter: z.object({ seconds: maybe(num), water_g: maybe(num), heat_wh: maybe(num), refused_seconds: maybe(num), observed_at: maybe(text) }),
  today: maybe(z.object({ seconds: maybe(num), runs: maybe(int), water_g: maybe(num), heat_wh: maybe(num), lower_bound: maybe(flag) })),
});
const lawView = z.object({
  server_time: text, observed_at: maybe(text), reporting: flag,
  band: z.object({
    temp_low_f: maybe(num), temp_high_f: maybe(num), vpd_low_kpa: maybe(num), vpd_high_kpa: maybe(num), repaired: maybe(flag), source: maybe(code),
    host: maybe(hostBandEdges), differs: maybe(flag),
  }),
  inputs: z.object({
    temp_f: maybe(num), vpd_kpa: maybe(num), rh_pct: maybe(num), dew_point_f: maybe(num),
    outdoor: z.object({ source: maybe(code), temp_f: maybe(num), rh_pct: maybe(num), dew_point_f: maybe(num) }), observed_at: maybe(text),
  }),
  rules: z.array(lawRule), drying: lawDrying,
  timing: z.object({
    relay_min_on_s: int, relay_min_off_s: int, fog_min_on_s: int, fog_min_off_s: int, furnace_boot_wait_s: int, mist_pulse_s: int, mist_gap_s: int,
    hot_limit_f: num, cold_limit_f: num,
  }),
  lead_fan: maybe(code),
  alone: z.object({
    clock: z.object({ valid: maybe(flag), sync_age_s: maybe(num) }), probes: z.object({ active: maybe(int), degraded: maybe(flag) }),
    host: z.object({ connected: maybe(flag), heartbeat_age_s: maybe(num) }), gap_log: maybe(code),
  }),
  constants: z.object({ hash: maybe(text), release_hash: text, matches: maybe(flag), observed_at: maybe(text) }),
});
const lawHistory = z.object({
  from: text, to: text, first_record_at: maybe(text),
  lanes: z.array(z.object({ key: code, group: code, intervals: z.array(z.object({ ...span, state: relay })) })),
  drying: z.array(z.object({ ...span, state: choice(DRYING_STATES, "unknown"), reason: maybe(code) })),
  outdoor_source: z.array(z.object({ ...span, source: code })),
  band_repaired: z.array(z.object(span)),
  cost: z.object({ bucket_s: int, t: z.array(int), cost_kwh_per_kg: nullableNumbers, limit_kwh_per_kg: nullableNumbers }),
  band: z.object({ bucket_s: int, t: z.array(int), temp_low_f: nullableNumbers, temp_high_f: nullableNumbers, vpd_low_kpa: nullableNumbers, vpd_high_kpa: nullableNumbers }),
});
// The daily record (API-32, API-33).
const recordBand = z.object({
  both_pct: maybe(num), temp_pct: maybe(num), vpd_pct: maybe(num), both_day_pct: maybe(num), both_night_pct: maybe(num), temp_below_pct: maybe(num),
  temp_above_pct: maybe(num), vpd_below_pct: maybe(num), vpd_above_pct: maybe(num), graded_min: maybe(int), night_dryout_min: maybe(int),
  night_dried: maybe(flag), above_full_cooling_min: maybe(int),
});
const recordDrying = z.object({
  seconds: maybe(num), runs: maybe(int), furnace_starts_after: maybe(int), water_g: maybe(num), heat_wh: maybe(num), lower_bound: maybe(flag),
  wanted_s: maybe(num), refused_s: maybe(z.record(z.string(), num)),
});
const recordDay = z.object({
  date: text, complete: flag, band: maybe(recordBand),
  relays: maybe(z.record(z.string(), z.object({ starts: int, run_s: num, repaired_runs: int }))),
  climate_starts: maybe(int), climate_run_s: maybe(num),
  energy: z.object({ kwh: maybe(num), kwh_partial: maybe(num), coverage_pct: maybe(num) }),
  gas: z.object({ therms_est: maybe(num) }),
  water: z.object({ total_gal: maybe(num), crop_gal: maybe(num), wetting_gal: maybe(num), house_gal: maybe(num), complete: maybe(flag) }),
  drying: maybe(recordDrying), counter_sample_pct: maybe(num),
  alerts: maybe(z.object({ critical: int, warning: int, info: int })),
});
const recordMeans = z.object({
  days: int, both_pct: maybe(num), temp_pct: maybe(num), vpd_pct: maybe(num), nights_dried: maybe(int), climate_starts: maybe(num),
  climate_run_h: maybe(num), heat1_run_h: maybe(num), heat2_run_h: maybe(num), kwh: maybe(num), therms_est: maybe(num), crop_gal: maybe(num),
  drying_h: maybe(num),
});
const recordPeriod = z.object({ from: text, to: text, excluded_days: int, means: recordMeans });
const dailyRecord = z.object({
  from: text, to: text, days: z.array(recordDay), means: z.object({ d7: maybe(recordMeans), d30: maybe(recordMeans) }),
  // The periods before and since the law; a server before them sends none, read as null.
  law_started: maybe(text), baseline: maybe(recordPeriod), since_law: maybe(recordPeriod),
  server_time: text,
});
const relayCheck = z.object({
  days: z.array(z.object({
    date: text, comparison: code, boots: maybe(int),
    relays: z.array(z.object({
      equipment: text, counter_starts: maybe(int), record_starts: maybe(int), starts_difference: maybe(int), counter_run_s: maybe(num),
      record_run_s: maybe(num), run_s_difference: maybe(num),
    })),
  })),
});
// The daily review (API-34).
const reviewProposal = z.object({
  changes: z.array(z.object({ param: text, label: text, unit: maybe(text), current: maybe(num), proposed: num })), price: text, reason: maybe(text),
});
const review = z.object({
  id: int, kind: code, review_date: text, status: code, requested_at: text, requested_by: text, attempts: int, delivered_at: maybe(text),
  run_finished_at: maybe(text), written_at: maybe(text), failure: maybe(code), input_tokens: maybe(int), output_tokens: maybe(int),
  total_tokens: maybe(int), summary: maybe(text), proposal: maybe(reviewProposal), proposal_state: maybe(code),
});
const reviewPage = z.object({
  ...page, items: z.array(review),
  today: z.object({ review_date: text, status: code, missed: flag, expected_after: text, late_after: text }),
  tokens: z.object({ last: maybe(int), mean_7: maybe(num), mean_30: maybe(num), rise_pct: maybe(num),
    // An older API serves no counts: read as not known, so the tokens tile shows the figure alone.
    count_7: maybe(int), count_30: maybe(int) }),
  proposal_waiting: maybe(z.object({ review_id: int, review_date: text })),
});
// System (API-35 to API-37).
const controllerHealth = z.object({
  observed_at: maybe(text),
  firmware: z.object({ version: maybe(text), pinned: maybe(text), matches: maybe(flag) }),
  uptime_s: maybe(num),
  restarts: z.object({ count: maybe(int), reset_reason: maybe(text), booted_at: maybe(text) }),
  heap: z.object({ free_kb: maybe(num), min_free_kb: maybe(num), largest_block_kb: maybe(num), minute_low_kb: maybe(num), largest_block_minute_low_kb: maybe(num) }),
  loop: z.object({ worst_ms: maybe(num), stack_free_min_b: maybe(num) }),
  nvs: z.object({ used_entries: maybe(int), free_entries: maybe(int), write_worst_ms: maybe(num) }),
  wifi: z.object({ rssi_dbm: maybe(num), disconnects: maybe(int), api_clients: maybe(int) }),
  clock: z.object({ valid: maybe(flag), sync_age_s: maybe(num), misses: maybe(int) }),
  probes: z.object({ active: maybe(int), degraded: maybe(flag), health: maybe(text) }),
  band_source: maybe(code), gap_log: maybe(code),
  limits: z.object({
    heap_warning_kb: num, heap_critical_kb: num, largest_block_kb: num, ota_free_kb: num, loop_worst_ms: num, nvs_write_ms: num, stack_free_b: num,
    nvs_arm_free_pct: num, nvs_stop_free_pct: num,
  }),
});
const dataContinuity = z.object({
  from: text, to: text, gap_log: maybe(code),
  outages: z.array(z.object({ ...span, duration_s: int, reason: code, status: code })),
  replayed: z.array(z.object({
    boot: int, qseq: int, first_at: text, last_at: text, received_at: text, climate_rows: int, transition_rows: int,
  })),
  by_day: z.array(z.object({ date: text, outage_s: int, replayed_min: int })),
  tables: z.array(z.object({ table: text, last_row_age_s: maybe(num), rows_5m: maybe(int) })),
  // `last_seen_at` is missing from an older API: read as not known.
  probes: z.array(z.object({ sensor: text, age_s: maybe(num), last_seen_at: maybe(text) })),
  ingestor: z.object({
    heartbeat_age_s: maybe(num), reconnects: maybe(int), payloads_rejected: maybe(int), replay_failures: maybe(int),
    rows_rejected: maybe(z.record(z.string(), int)), observed_at: maybe(text),
  }),
});
const delivery = z.object({
  from: text, to: text,
  by_status: z.array(z.object({ source: code, status: code, count: int })),
  oldest_unconfirmed_s: maybe(num),
  latency: z.object({ p50_s: maybe(num), p95_s: maybe(num), confirmed: int }),
  failing: z.array(z.object({ param: text, label: text, failed: int, last_failed_at: text, last_confirmed_at: maybe(text) })),
  dispatcher_stage: maybe(text),
  readback_pass: z.object({ at: maybe(text), stored: maybe(int), of: maybe(int) }),
});

// ---------------------------------------------------------------------------------------------------- parsers
export type Parser<T> = (value: unknown) => T | null;
function parser<T>(schema: z.ZodType<T>): Parser<T> {
  return (value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
}
// Each annotation makes tsc check the parsed shape against the generated type, so a contract change the parser
// misses fails the typecheck.
export const parseProblem: Parser<Problem> = parser(problem);
export const parseMe: Parser<Me> = parser(me);
export const parseNow: Parser<Now> = parser(now);
export const parseMetrics: Parser<Metrics> = parser(metrics);
export const parseSeries: Parser<Series> = parser(series);
export const parseStateLanes: Parser<StateLanes> = parser(stateLanes);
export const parseBandTimeline: Parser<BandTimeline> = parser(bandTimeline);
export const parsePlan: Parser<Plan> = parser(plan);
export const parseSettings: Parser<Settings> = parser(settings);
export const parseDesiredSetting: Parser<DesiredSetting> = parser(desiredSetting);
export const parseSettingHistory: Parser<SettingHistory> = parser(settingHistory);
export const parseEquipment: Parser<Equipment> = parser(equipment);
export const parseAlertPage: Parser<AlertPage> = parser(alertPage);
export const parseAlert: Parser<Alert> = parser(alert);
export const parseActivityPage: Parser<ActivityPage> = parser(activityPage);
export const parseBandPreview: Parser<BandPreview> = parser(bandPreview);
export const parseBandProfilePreview: Parser<BandProfilePreview> = parser(bandProfilePreview);
export const parseBandWrite: Parser<BandWrite> = parser(bandWrite);
export const parseLightCommand: Parser<LightCommand> = parser(lightCommand);
export const parseSoilTargets: Parser<SoilTargets> = parser(soilTargets);
export const parseSoilTarget: Parser<SoilTarget> = parser(soilTarget);
export const parseWaterUse: Parser<WaterUse> = parser(waterUse);
export const parseLightingDays: Parser<LightingDays> = parser(lightingDays);
export const parsePlannerHistory: Parser<PlannerHistory> = parser(plannerHistory);
export const parseIrrigationStatus: Parser<IrrigationStatus> = parser(irrigationStatus);
export const parseScheduleAgenda: Parser<ScheduleAgenda> = parser(scheduleAgenda);
export const parseSchedule: Parser<Schedule> = parser(schedule);
export const parseCommand: Parser<Command> = parser(command);
export const parseLinesUpdated: Parser<LinesUpdated> = parser(linesUpdated);
export const parseMinutesReport: Parser<MinutesReport> = parser(minutesReport);
export const parseRunPage: Parser<RunPage> = parser(runPage);
export const parseLocations: Parser<Locations> = parser(locations);
export const parsePlanting: Parser<Planting> = parser(planting);
export const parsePlantingDetail: Parser<PlantingDetail> = parser(plantingDetail);
export const parsePlantingList: Parser<PlantingList> = parser(plantingList);
export const parsePositionHistory: Parser<PositionHistory> = parser(positionHistory);
export const parseCropCatalog: Parser<CropCatalog> = parser(cropCatalog);
export const parseResolution: Parser<Resolution> = parser(resolution);
export const parseLawView: Parser<LawView> = parser(lawView);
export const parseLawHistory: Parser<LawHistory> = parser(lawHistory);
export const parseDailyRecord: Parser<DailyRecord> = parser(dailyRecord);
export const parseRelayCheck: Parser<RelayCheck> = parser(relayCheck);
export const parseReviewPage: Parser<ReviewPage> = parser(reviewPage);
export const parseControllerHealth: Parser<ControllerHealth> = parser(controllerHealth);
export const parseDataContinuity: Parser<DataContinuity> = parser(dataContinuity);
export const parseDelivery: Parser<Delivery> = parser(delivery);
// The BFF's own calls and the probes; the browser never makes these.
export const parseSessionToken: Parser<SessionToken> = parser(sessionToken);
export const parseReadiness: Parser<Readiness> = parser(readiness);
export const parseHealth: Parser<Health> = parser(health);

// ---------------------------------------------------------------------------------------------------- operations
type Method = "GET" | "PUT" | "POST" | "PATCH" | "DELETE";
type Entry<M extends Method, P extends keyof paths, F extends Parser<unknown> | null> = { readonly method: M; readonly path: P; readonly parse: F };
const op = <M extends Method, P extends keyof paths, F extends Parser<unknown> | null>(method: M, path: P, parse: F): Entry<M, P, F> => ({ method, path, parse });

/** Every `/v1` operation the browser calls, by its design id; `parse` reads its success body (null: no body). */
export const OPERATIONS = {
  "API-01": op("GET", "/v1/me", parseMe),
  "API-02": op("GET", "/v1/now", parseNow),
  "API-03": op("GET", "/v1/metrics", parseMetrics),
  "API-04": op("GET", "/v1/series", parseSeries),
  "API-05": op("GET", "/v1/states", parseStateLanes),
  "API-06": op("GET", "/v1/band", parseBandTimeline),
  "API-07": op("GET", "/v1/plan", parsePlan),
  "API-09": op("GET", "/v1/settings", parseSettings),
  "API-10": op("PUT", "/v1/settings/{param}", parseDesiredSetting),
  "API-11": op("DELETE", "/v1/settings/{param}", parseDesiredSetting),
  "API-12": op("GET", "/v1/settings/{param}/history", parseSettingHistory),
  "API-13": op("GET", "/v1/equipment", parseEquipment),
  "API-14": op("GET", "/v1/alerts", parseAlertPage),
  "API-15": op("POST", "/v1/alerts/{id}/ack", parseAlert),
  "API-16": op("POST", "/v1/alerts/{id}/resolve", parseAlert),
  "API-17": op("GET", "/v1/activity", parseActivityPage),
  "API-19": op("GET", "/v1/band/preview", parseBandPreview),
  "API-20": op("POST", "/v1/equipment/lights/{light}/{state}", parseLightCommand),
  "API-21": op("GET", "/v1/water/daily", parseWaterUse),
  "API-22": op("GET", "/v1/lighting", parseLightingDays),
  "API-23": op("GET", "/v1/band/profile", parseBandProfilePreview),
  "API-24": op("PUT", "/v1/band/profile", parseBandWrite),
  "API-25": op("GET", "/v1/planner/history", parsePlannerHistory),
  "API-30": op("GET", "/v1/law", parseLawView),
  "API-31": op("GET", "/v1/law/history", parseLawHistory),
  "API-32": op("GET", "/v1/record/days", parseDailyRecord),
  "API-33": op("GET", "/v1/record/relay-check", parseRelayCheck),
  "API-34": op("GET", "/v1/reviews", parseReviewPage),
  "API-35": op("GET", "/v1/system/controller", parseControllerHealth),
  "API-36": op("GET", "/v1/system/data", parseDataContinuity),
  "API-37": op("GET", "/v1/system/delivery", parseDelivery),
  "API-SOIL-01": op("GET", "/v1/soil-targets", parseSoilTargets),
  "API-SOIL-02": op("PUT", "/v1/soil-targets/{zone}", parseSoilTarget),
  "API-IRR-01": op("GET", "/v1/irrigation", parseIrrigationStatus),
  "API-IRR-02": op("GET", "/v1/irrigation/schedules", parseScheduleAgenda),
  "API-IRR-03": op("POST", "/v1/irrigation/schedules", parseSchedule),
  "API-IRR-04": op("PUT", "/v1/irrigation/schedules/{slot_id}", parseSchedule),
  "API-IRR-05": op("DELETE", "/v1/irrigation/schedules/{slot_id}", null),
  "API-IRR-06": op("POST", "/v1/irrigation/lines/{line_id}/run", parseCommand),
  "API-IRR-07": op("POST", "/v1/irrigation/stop", parseCommand),
  "API-IRR-08": op("PUT", "/v1/irrigation/lines/{line_id}", parseLinesUpdated),
  "API-IRR-10": op("GET", "/v1/irrigation/minutes", parseMinutesReport),
  "API-IRR-11": op("GET", "/v1/irrigation/runs", parseRunPage),
  "API-IRR-12": op("POST", "/v1/equipment/override", parseCommand),
  "API-IRR-13": op("POST", "/v1/irrigation/clear-fault", parseCommand),
  "API-CROP-01": op("GET", "/v1/crops/locations", parseLocations),
  "API-CROP-02": op("GET", "/v1/crops/plantings", parsePlantingList),
  "API-CROP-03": op("GET", "/v1/crops/plantings/{planting_id}", parsePlantingDetail),
  "API-CROP-04": op("GET", "/v1/crops/positions/{label}/history", parsePositionHistory),
  "API-CROP-05": op("GET", "/v1/crops/catalog", parseCropCatalog),
  "API-CROP-06": op("GET", "/v1/crops/resolve", parseResolution),
  "API-CROP-07": op("POST", "/v1/crops/plantings", parsePlanting),
  "API-CROP-08": op("POST", "/v1/crops/plantings/{planting_id}/move", parsePlanting),
  "API-CROP-09": op("POST", "/v1/crops/plantings/{planting_id}/harvest", parsePlanting),
  "API-CROP-10": op("POST", "/v1/crops/plantings/{planting_id}/remove", parsePlanting),
  "API-CROP-11": op("PATCH", "/v1/crops/plantings/{planting_id}", parsePlanting),
  "API-CROP-12": op("POST", "/v1/crops/plantings/{planting_id}/notes", parsePlanting),
} as const;
type Table = typeof OPERATIONS;
export type ApiOperationId = keyof Table;
// Each row must be the generated paths entry for its method and path, both ways, or tsc names the row.
type Declared<P extends keyof paths, M extends Method> = paths[P][Lowercase<M>];
type Mismatched = { [K in ApiOperationId]: [operations[K]] extends [Declared<Table[K]["path"], Table[K]["method"]>]
  ? [Declared<Table[K]["path"], Table[K]["method"]>] extends [operations[K]] ? never : K : K }[ApiOperationId];
const tableMatchesContract: [Mismatched] extends [never] ? true : { mismatched: Mismatched } = true;
void tableMatchesContract;

type IdsBy<M extends Method> = { [K in ApiOperationId]: Table[K]["method"] extends M ? K : never }[ApiOperationId];
export type ReadOperationId = IdsBy<"GET">;
export type WriteOperationId = IdsBy<"PUT" | "POST" | "PATCH" | "DELETE">;
export type Parsed<K extends ApiOperationId> = Table[K]["parse"] extends Parser<infer T> ? T : null;
type Part<T> = [NonNullable<T>] extends [never] ? Record<never, never> : NonNullable<T>;
/** Path and query parameters in one object, typed from the generated operation. */
export type ParamsOf<K extends OperationId> = Part<operations[K]["parameters"]["path"]> & Part<operations[K]["parameters"]["query"]>;
type RequestBody<K extends OperationId> = NonNullable<operations[K]["requestBody"]> extends { content: { "application/json": infer B } } ? B : never;
/** The JSON request body, typed from the generated operation; undefined when the operation takes none or it is optional. */
export type BodyOf<K extends OperationId> = [RequestBody<K>] extends [never] ? undefined
  : undefined extends operations[K]["requestBody"] ? RequestBody<K> | undefined : RequestBody<K>;

/** The sign-in session ended (a 401 from the BFF): the shell shows its session-ended card. */
export class SessionEnded extends Error {
  constructor() {
    super("Your session ended. Sign in again.");
    this.name = "SessionEnded";
  }
}
/** A refusal or failure, with its Problem. `status` 0 means the API could not be reached. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;
  constructor(status: number, problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
export type CallOptions = { signal?: AbortSignal; fetch?: Fetcher };
export type WriteResult<T> = { status: number; data: T; replayed: boolean };

const synthetic = (status: number, code: string, title: string, retryable: boolean): Problem => ({ type: "about:blank", title, status, code, retryable, min: null, max: null, current: null, retry_after_s: null });
const UNREACHABLE = synthetic(0, "unavailable", "Dashboard API unavailable", true);
const TIMED_OUT = synthetic(0, "unavailable", "Dashboard API did not answer in time", true);

/**
 * A fetch or body read that failed. The caller's own abort (a hidden tab) is rethrown as it is; a timeout signal
 * (`AbortSignal.timeout`, as `usePolledQuery` passes) or a network failure is an `ApiError` with status 0.
 */
function unreachable(error: unknown, signal: AbortSignal | undefined): never {
  const timedOut = (signal?.reason as { name?: unknown } | undefined)?.name === "TimeoutError";
  if (signal?.aborted && !timedOut) throw error;
  throw new ApiError(0, timedOut ? TIMED_OUT : UNREACHABLE);
}

/** `/api/v1/...` for an operation: path parameters fill its template, the rest become the query (arrays repeat). */
export function operationPath(operationId: ApiOperationId, params: Readonly<Record<string, unknown>>): string {
  const used = new Set<string>();
  const filled = OPERATIONS[operationId].path.replace(/\{([a-z_]+)\}/g, (_match, name: string) => {
    used.add(name);
    const value = params[name];
    if (value === undefined || value === null || value === "") throw new TypeError(`${operationId} needs ${name}`);
    // The browser would resolve a . or .. segment to another path before the BFF could refuse it.
    if (value === "." || value === "..") throw new TypeError(`${operationId} ${name} cannot be ${String(value)}`);
    return encodeURIComponent(String(value));
  });
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (used.has(name) || value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(name, String(item));
  }
  const search = query.toString();
  return `/api${filled}${search ? `?${search}` : ""}`;
}

/** The JSON body, or null when it is not JSON. An abort or timeout while it arrives fails like the fetch. */
async function body(response: Response, signal: AbortSignal | undefined): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (signal?.aborted) unreachable(error, signal);
    return null;
  }
}
async function call(operationId: ApiOperationId, params: Readonly<Record<string, unknown>>, payload: unknown, idempotencyKey: string | undefined, options: CallOptions) {
  const { method, parse } = OPERATIONS[operationId];
  const headers: Record<string, string> = { Accept: "application/json, application/problem+json" };
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey !== undefined) headers["Idempotency-Key"] = idempotencyKey;
  const fetcher: Fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const path = operationPath(operationId, params);
  let response: Response;
  try {
    response = await fetcher(path, {
      method, headers, body: payload === undefined ? undefined : JSON.stringify(payload), credentials: "same-origin", cache: "no-store",
      redirect: "manual", signal: options.signal,
    });
  } catch (error) {
    unreachable(error, options.signal);
  }
  // No session: the BFF answers 401 on /api. A redirect to sign in reads the same.
  if (response.status === 401 || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) throw new SessionEnded();
  if (!response.ok) {
    const problem = parseProblem(await body(response, options.signal));
    throw new ApiError(response.status, problem ?? synthetic(response.status, `http_${response.status}`, "Dashboard API error", response.status >= 500));
  }
  const replayed = response.headers.get("Idempotency-Replayed") === "true";
  if (parse === null || response.status === 204) return { status: response.status, data: null, replayed };
  const data = (parse as Parser<unknown>)(await body(response, options.signal));
  if (data === null) throw new ApiError(response.status, synthetic(response.status, "invalid_response", "Unexpected answer from the dashboard API", false));
  return { status: response.status, data, replayed };
}

/**
 * One read. Throws `SessionEnded` on a 401 and `ApiError` on any other failure, a timeout included, so a poll counts
 * it; the caller's own abort rethrows as the abort it is.
 */
export async function apiGet<K extends ReadOperationId>(operationId: K, params: ParamsOf<K>, options: CallOptions = {}): Promise<Parsed<K>> {
  const result = await call(operationId, params as Readonly<Record<string, unknown>>, undefined, undefined, options);
  return result.data as Parsed<K>;
}

/**
 * One write with its `Idempotency-Key` (one key per user action, so a double tap or a manual retry applies once). It is
 * sent exactly once and never retried here. Throws `SessionEnded` on a 401 and `ApiError` (with the field and bounds
 * of a 422) on any other refusal.
 */
export async function apiWrite<K extends WriteOperationId>(operationId: K, params: ParamsOf<K>, payload: BodyOf<K>, idempotencyKey: string, options: CallOptions = {}): Promise<WriteResult<Parsed<K>>> {
  const result = await call(operationId, params as Readonly<Record<string, unknown>>, payload, idempotencyKey, options);
  return result as WriteResult<Parsed<K>>;
}

/** A fresh key for one user action. */
export const newIdempotencyKey = (): string => crypto.randomUUID();
