// SPDX-License-Identifier: MIT
// The one words table is complete: every code the OpenAPI file, the alert schema, the activity schema and the
// controller's published reasons define has words, so a PR that adds a ProblemCode, a StateReason or line-state code,
// an alert type or category, an activity action or a law, record, review or system enum value fails here until it adds
// them. Each alert type has a title and one sentence. jvallery/agents#5994's dashboard step runs this file when any of
// those sources change.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { OUTCOMES } from "./operator-api";
import { ALERT_SEVERITIES, ALERT_STATUSES, BAND_VERDICTS, BURST_KINDS, LINE_FAULTS, LINE_STATE_CODES, PROBLEM_CODES, STATE_REASON_CODES, VPD_SOURCES } from "./vocab";
import { HISTORICAL_ALERT_TYPES, WORDS, alertAbout, hasWords, words } from "./words";

const repo = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
type Schema = { enum?: (string | null)[]; properties?: Record<string, Schema> };
const SCHEMAS = (parseYaml(repo("docs/design/dashboard/openapi/dashboard-api.v1.yaml")) as { components: { schemas: Record<string, Schema> } }).components.schemas;
/** A schema's enum without its null (a nullable enum lists null as a value). */
const enumOf = (schema: Schema | undefined): string[] => {
  if (!schema?.enum?.length) throw new Error("no enum");
  return schema.enum.filter((value): value is string => value !== null);
};

/** `ALERT_TYPES` in verdify_schemas/alerts.py. */
function alertTypes(): string[] {
  const block = /^ALERT_TYPES: tuple\[str, \.\.\.\] = \(([\s\S]*?)^\)/m.exec(repo("verdify_schemas/alerts.py"));
  if (!block) throw new Error("no ALERT_TYPES in verdify_schemas/alerts.py");
  return [...block[1].matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);
}
/** `RejectCode` in verdify_schemas/irrigation.py: why the controller refused a pushed program. */
function rejectCodes(): string[] {
  const literal = /^RejectCode = Literal\[([^\]]*)\]/m.exec(repo("verdify_schemas/irrigation.py"));
  if (!literal) throw new Error("no RejectCode in verdify_schemas/irrigation.py");
  return [...literal[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
}
/**
 * The codes `gh_fog_block_reason` publishes (firmware/greenhouse/controls.yaml, `fog_safety_block_reason`'s and
 * `fog_force_off_reason`'s included); `leak_detected` is today's firmware, which the engine release drops (Q-05).
 */
const FOG_BLOCK_REASONS = [
  "none", "served", "leak_detected", "occupancy", "irrigation", "resource_budget", "time_invalid", "time_window", "dew_margin", "wet_taper", "rh_ceiling",
  "temp_low", "vent_interlock", "relay_min_off", "sensor_fault", "fert_master", "water_ceiling",
];
/** The codes `gh_moisture_block_reason` publishes (firmware/greenhouse/controls.yaml); `leak_detected` is today's firmware, which the engine release drops (Q-05). */
const MOISTURE_BLOCK_REASONS = [
  "none", "served", "pulse_gap", "leak_detected", "water_budget", "vent_interlock", "no_humidity_demand", "no_vpd_demand", "engage_delay", "below_threshold",
  "dew_margin", "wet_taper", "no_zone_available", "direct_wet_time_invalid", "direct_wet_temp", "direct_wet_window", "irrigation", "occupancy",
];
const quoted = (block: string) => [...block.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);
/** Every code controls.yaml writes into `name` with snprintf, ternaries included. */
function snprintfCodes(name: string): string[] {
  return [...repo("firmware/greenhouse/controls.yaml").matchAll(new RegExp(`snprintf\\(\\s*${name}\\s*,\\s*sizeof\\(${name}\\)\\s*,([\\s\\S]*?)\\);`, "g"))]
    .flatMap((match) => quoted(match[1]));
}
/** Every word `fog_force_off_reason()` and `manual_fog_hold_reason()` (firmware/lib/greenhouse_logic.h; the third flash
 * renamed `manual_fog_safety_block_reason()`, AD1) can return. */
function fogBlockReturns(): string[] {
  const logic = repo("firmware/lib/greenhouse_logic.h");
  const force = /inline const char\* fog_force_off_reason\([\s\S]*?\n\}/.exec(logic);
  const safety = /inline const char\* manual_fog_hold_reason\([\s\S]*?\n\}/.exec(logic);
  if (!force || !safety) throw new Error("no fog_force_off_reason or manual_fog_hold_reason in the firmware");
  return [...force[0].matchAll(/return "([a-z0-9_]+)"/g), ...safety[0].matchAll(/return "([a-z0-9_]+)"/g)].map((match) => match[1]);
}

/** Every code in `codes` has words in `family`: words, not the code, and no underscore left in them. */
function expectWorded(family: string, codes: readonly string[]) {
  const missing = codes.filter((code) => !hasWords(family, code));
  expect(missing, `${family} codes without words`).toEqual([]);
  for (const code of codes) {
    expect(words(family, code), `${family}.${code}`).not.toBe(code);
    expect(words(family, code), `${family}.${code}`).not.toMatch(/_/);
  }
}

test("every ProblemCode, StateReason code, line-state code and alert status in the OpenAPI file has words", () => {
  const problemCodes = enumOf(SCHEMAS.ProblemCode);
  const stateReasons = enumOf(SCHEMAS.StateReason?.properties?.code);
  const lineStates = enumOf(SCHEMAS.LineState?.properties?.code);
  expectWorded("problem_code", problemCodes);
  expectWorded("state_reason", stateReasons);
  expectWorded("line_state", lineStates);
  // The typed lists the components use are the file's, both ways (typecheck checks them against the generated client).
  expect([...PROBLEM_CODES].sort()).toEqual([...problemCodes].sort());
  expect([...STATE_REASON_CODES].sort()).toEqual([...stateReasons].sort());
  expect([...LINE_STATE_CODES].sort()).toEqual([...lineStates].sort());
  expect([...ALERT_SEVERITIES].sort()).toEqual([...enumOf(SCHEMAS.Alert?.properties?.severity)].sort());
  expect(ALERT_SEVERITIES.map((severity) => words("alert_severity", severity))).toEqual(["Critical", "Warning", "Info"]);
  const statuses = enumOf(SCHEMAS.Alert?.properties?.status);
  expectWorded("alert_status", statuses);
  expect([...ALERT_STATUSES].sort()).toEqual([...statuses].sort());
});

/** `AlertCategory` in verdify_schemas/alerts.py. */
function alertCategories(): string[] {
  const literal = /^AlertCategory = Literal\[([^\]]*)\]/m.exec(repo("verdify_schemas/alerts.py"));
  if (!literal) throw new Error("no AlertCategory in verdify_schemas/alerts.py");
  return quoted(literal[1]);
}

test("every alert type in ALERT_TYPES has a title and one sentence, the leak alert titled as the banner reads", () => {
  const types = alertTypes();
  expect(types.length).toBeGreaterThanOrEqual(70);
  expect(types).toContain("leak_detected");
  expectWorded("alert_type", types);
  expectWorded("alert_about", types);
  // Both ways: no title for a type the stack does not raise.
  expect(Object.keys(WORDS.alert_type).sort()).toEqual([...types].sort());
  expect(Object.keys(WORDS.alert_about).sort()).toEqual([...types].sort());
  expect(words("alert_type", "leak_detected")).toBe("Water flowing with every Verdify valve closed");
  for (const type of types) {
    const about = alertAbout(type)!;
    // One sentence: a capital, one full stop at the end, no internal names.
    expect(about, type).toMatch(/^[A-Z][^]*\.$/);
    expect(about.slice(0, -1).split(/\.\s/), type).toHaveLength(1);
    expect(`${words("alert_type", type)} ${about}`, type).not.toMatch(/hermes|esp32|nvs|dispatcher|mcp|_/i);
  }
  expect(alertAbout("pump_cavitation")).toBeNull();
});

test("the retired checks keep a title marked as retired, and no other type is so marked", () => {
  const types = alertTypes();
  expect([...HISTORICAL_ALERT_TYPES].filter((type) => !types.includes(type))).toEqual([]);
  for (const type of types) {
    const historical = HISTORICAL_ALERT_TYPES.has(type);
    expect(words("alert_type", type).endsWith(" (retired check)"), type).toBe(historical);
    if (historical) expect(alertAbout(type), type).toMatch(/^A retired check/);
  }
  // The planner's types are retired; the reviewer's tool failure, which MCP still raises, is not.
  expect(HISTORICAL_ALERT_TYPES.has("planner_stale")).toBe(true);
  expect(HISTORICAL_ALERT_TYPES.has("planner_tool_dependency_failed")).toBe(false);
});

test("every alert category has words", () => {
  const categories = alertCategories();
  expect(categories).toEqual(["sensor", "equipment", "climate", "water", "system"]);
  expectWorded("alert_category", categories);
  expect(Object.keys(WORDS.alert_category).sort()).toEqual([...categories].sort());
});

/** The `equipment_state` keys `ingestor/entity_map.py` maps the controller's relays and switches to. */
function entityMapEquipment(): string[] {
  const source = repo("ingestor/entity_map.py");
  return ["EQUIPMENT_BINARY_MAP", "EQUIPMENT_SWITCH_MAP"].flatMap((name) => {
    const block = new RegExp(`^${name}: dict\\[str, str\\] = \\{([\\s\\S]*?)^\\}`, "m").exec(source);
    if (!block) throw new Error(`no ${name} in ingestor/entity_map.py`);
    return [...block[1].matchAll(/"[^"]+":\s*"([a-z0-9_]+)"/g)].map((match) => match[1]);
  });
}
/** Architecture §7's fixed actuator list: the climate relays, the eleven wet relays, the Lutron readback and the controller's light switches. */
const FIXED_ACTUATORS = [
  "fan1", "fan2", "vent", "heat1", "heat2",
  "drip_wall", "drip_wall_fert", "fert_master_valve", "mister_center", "drip_center", "drip_center_fert", "mister_south", "mister_south_fert",
  "mister_west", "mister_west_fert", "fog",
  "grow_light_main", "grow_light_grow", "grow_light_main_intent", "grow_light_grow_intent",
];

test("every actuator of the fixed list has its plain name, in screens SCR-01's words", () => {
  // Every key but the Lutron readback (written by the Home Assistant sync, not the controller) is one entity_map.py maps.
  const mapped = entityMapEquipment();
  expect(FIXED_ACTUATORS.filter((key) => !mapped.includes(key))).toEqual(["grow_light_main", "grow_light_grow"]);
  expectWorded("equipment", FIXED_ACTUATORS);
  expect(Object.keys(WORDS.equipment).sort()).toEqual([...FIXED_ACTUATORS].sort());
  expect(["fan1", "heat1", "heat2", "mister_center", "drip_wall"].map((key) => words("equipment", key))).toEqual(["Fan 1", "Heat 1 (electric)", "Heat 2 (gas)", "Center mister", "Wall drip"]);
  expect(words("equipment", "pump")).toBe("pump");
});

test("every band verdict and run by hand in the OpenAPI file has words; the runs by hand read by their v2 names", () => {
  const verdicts = enumOf(SCHEMAS.BandPosition?.properties?.verdict);
  const bursts = enumOf((SCHEMAS.Now?.properties?.overrides as { items?: Schema } | undefined)?.items?.properties?.kind);
  expectWorded("band_verdict", verdicts);
  expectWorded("run_by_hand", bursts);
  expect([...BAND_VERDICTS].sort()).toEqual([...verdicts].sort());
  expect([...BURST_KINDS].sort()).toEqual([...bursts].sort());
  expect(BAND_VERDICTS.map((verdict) => words("band_verdict", verdict))).toEqual(["in band", "above band", "below band", "band unavailable"]);
  expect(["fans", "humidify", "vent_bypass"].map((kind) => words("run_by_hand", kind))).toEqual(["Run the fans", "Humidify", "Circulate"]);
  expect(hasWords("burst", "fans")).toBe(false);
});

test("the table has words for every code gh_fog_block_reason publishes", () => {
  expect(FOG_BLOCK_REASONS).toHaveLength(17);
  expectWorded("fog_block_reason", FOG_BLOCK_REASONS);
  expect(Object.keys(WORDS.fog_block_reason).sort()).toEqual([...FOG_BLOCK_REASONS].sort());
  // A code the firmware adds fails here until it has words, because the engine release edits these sources.
  const published = [...fogBlockReturns(), ...snprintfCodes("fog_block_reason")];
  expect(published.length).toBeGreaterThanOrEqual(12);
  expect(published.filter((code) => !hasWords("fog_block_reason", code))).toEqual([]);
});

test("the table has words for every code gh_moisture_block_reason publishes, in the issue's tone", () => {
  expect(MOISTURE_BLOCK_REASONS).toHaveLength(18);
  expectWorded("moisture_block_reason", MOISTURE_BLOCK_REASONS);
  expect(Object.keys(WORDS.moisture_block_reason).sort()).toEqual([...MOISTURE_BLOCK_REASONS].sort());
  // The law firmware (#1722) publishes 8 codes. The table keeps the words for the codes only the phase 2 rollback
  // firmware still publishes (below_threshold, direct_wet_temp, direct_wet_window, engage_delay, no_humidity_demand,
  // vent_interlock, wet_taper).
  const published = snprintfCodes("moisture_block_reason");
  expect(published.length).toBeGreaterThanOrEqual(8);
  expect(published.filter((code) => !hasWords("moisture_block_reason", code))).toEqual([]);
  expect(words("moisture_block_reason", "no_vpd_demand")).toBe("VPD in band: no misting needed");
  expect(words("moisture_block_reason", "water_budget")).toBe("Misting held: today's soft water budget is used");
  expect(words("moisture_block_reason", "leak_detected")).toBe("Held: water flowing with every Verdify valve closed");
});

test("the API-20 results in Problem.result and its targets have words", () => {
  const results = enumOf(SCHEMAS.Problem?.properties?.result);
  expectWorded("light_result", results);
  expect(Object.keys(WORDS.light_result).sort()).toEqual([...results].sort());
  expect(results.map((result) => words("light_result", result))).toEqual([
    "Lutron did not switch: Home Assistant did not answer", "Lutron did not reach the state", "No answer yet: Lutron may still switch",
  ]);
  expect(words("light_target", "grow_light_main")).toBe("Main lights");
  expect(words("light_target", "grow_light_grow")).toBe("Grow lights");
});

test("every grow-light reason the controller sets has words (API-13 auto_reason, #1335)", () => {
  const logic = /const char\* reason = "auto_disabled";([\s\S]*?)const uint32_t elapsed/.exec(repo("firmware/lib/greenhouse_logic.h"));
  if (!logic) throw new Error("no evaluate_lighting reasons in the firmware");
  const reasons = [...new Set([...logic[1].matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]))];
  expect(reasons.length).toBeGreaterThanOrEqual(9);
  expectWorded("light_reason", [...reasons, "auto_disabled", "time_invalid"]);
  expect(words("light_reason", "plant_hysteresis_hold")).toBe("On: plant light, holding until it is brighter");
});

test("every activity action the services write has words, each one an action the server can log", () => {
  // The pattern is one or more adjacent raw strings in parentheses; Python joins them.
  const source = /ACTIVITY_ACTION_PATTERN = \(((?:\s*r"[^"]+")+)\s*\)/.exec(repo("verdify_schemas/activity.py"));
  if (!source) throw new Error("no ACTIVITY_ACTION_PATTERN in verdify_schemas/activity.py");
  const server = new RegExp([...source[1].matchAll(/r"([^"]+)"/g)].map((part) => part[1]).join(""));
  // The fixed actions (architecture §9), the irrigation ones #1156 writes, API-20's light.on and light.off, API-24's band.write and the plantings'.
  const actions = [
    "setting.write", "setting.release", "plan.write", "alert.ack", "alert.resolve", "irrigation.run", "irrigation.stop", "irrigation.clear_fault",
    "irrigation.override", "irrigation.schedule.create", "irrigation.schedule.update", "irrigation.schedule.delete", "irrigation.line.update", "light.on", "light.off",
    "band.write",
    // The planting writes (#1327, #1328).
    "planting.create", "planting.move", "planting.harvest", "planting.end", "planting.update", "planting.note",
    // The soil targets' edit (#1345).
    "soil_target.write",
    // The planner study's run (#1360): an operator's start, pause, resume and stop; the runner's boundary and deviation.
    "study.start", "study.pause", "study.resume", "study.stop", "study.boundary", "study.deviation",
  ];
  expectWorded("activity_action", actions);
  expect(Object.keys(WORDS.activity_action).sort()).toEqual([...actions].sort());
  for (const action of actions) expect(server.test(action), action).toBe(true);
  // The retired actions read in words that name no plan and no study; the band's save names the band.
  expect(words("activity_action", "plan.write")).toBe("Settings written before the climate law");
  expect(words("activity_action", "study.start")).toBe("Started a trial");
  expect(words("activity_action", "band.write")).toBe("Changed the band");
  expect(words("activity_action", "planting.note")).toBe("Added a note to planting");
  // An action this build does not know reads raw.
  expect(words("activity_action", "equipment.override")).toBe("equipment.override");
});

test("every schedule, line and run field an irrigation write carries has words", () => {
  const props = (name: string) => Object.keys(SCHEMAS[name]?.properties ?? {});
  // line_id is the row's target, and manual and reason have their own words in the row.
  const fields = [...new Set(["ScheduleInput", "LineUpdate", "RunRequest"].flatMap(props))].filter((field) => !["line_id", "manual", "reason"].includes(field));
  expect(fields.length).toBeGreaterThanOrEqual(17);
  expectWorded("irrigation_field", fields);
  expect(Object.keys(WORDS.irrigation_field).sort()).toEqual([...fields].sort());
});

test("the existing families keep their words", () => {
  expect(Object.keys(WORDS.state_reason).sort()).toEqual([...STATE_REASON_CODES].sort());
  expect(words("state_reason", "no_match")).toBe("No matching readback yet");
  expect(words("state_reason", "no_engine")).toBe("Waits for the controller's irrigation engine");
  expect(words("problem_code", "writes_disabled")).toBe("Changes are switched off; reading still works");
});

test("the Water families (#1135): every run outcome, VPD source, line fault and program reject has words", () => {
  const outcomes = enumOf(SCHEMAS.RunOutcome);
  expect(Object.keys(WORDS.run_outcome).sort()).toEqual([...outcomes].sort());
  expect([...OUTCOMES].sort()).toEqual([...outcomes].sort());
  // The outcome words are the outcomes, except the gap: an outcome that never reached the platform.
  expect(outcomes.map((outcome) => words("run_outcome", outcome))).toEqual(["ok", "short", "stopped", "preempted", "skipped", "missed", "cap", "no outcome received"]);
  const sources = enumOf(SCHEMAS.IrrigationLine?.properties?.vpd_source);
  expect([...VPD_SOURCES].sort()).toEqual([...sources].sort());
  expectWorded("vpd_source", sources);
  expect(sources.map((source) => words("vpd_source", source))).toEqual(["VPD from its own probe", "VPD from peer probes", "VPD from the house average"]);
  const faults = enumOf(SCHEMAS.IrrigationLine?.properties?.fault);
  expect([...LINE_FAULTS].sort()).toEqual([...faults].sort());
  expectWorded("line_fault", faults);
  const rejects = rejectCodes();
  expect(rejects).toEqual(["bad_length", "bad_magic", "bad_hash", "bad_header", "bad_line", "bad_slot"]);
  expectWorded("program_reject", rejects);
  expect(Object.keys(WORDS.program_reject).sort()).toEqual([...rejects].sort());
  // Occurrence reasons arrive in words: the fixed ones read as the week view says them, the rest as sent.
  expect(words("occurrence_reason", "only while VPD sensing is degraded")).toBe("only if VPD sensing is degraded");
  expect(words("occurrence_reason", "line paused by jason: rain")).toBe("line paused by jason: rain");
  expect(words("occurrence_reason", "line disabled")).toBe("Skipped: line disabled");
  expect(words("occurrence_reason", "not a schedule member")).toBe("Skipped until Schedule is on");
  expect(words("occurrence_reason", "not a VPD member")).toBe("Skipped: VPD control is off");
  // The refusals the schedule editor reads beside Start and above Save.
  expect(words("problem_code", "too_many_schedules")).toBe("The controller holds 24 schedules; delete one first");
  expect(words("problem_code", "too_close")).toBe("Another schedule on this line starts within 30 min of this one");
});

test("an unknown code or family renders raw, prototype names included", () => {
  expect(words("state_reason", "brownout")).toBe("brownout");
  expect(words("alert_type", "pump_cavitation")).toBe("pump_cavitation");
  expect(words("no_such_family", "vpd_high")).toBe("vpd_high");
  expect(words("state_reason", "constructor")).toBe("constructor");
  expect(words("toString", "valueOf")).toBe("valueOf");
  expect(hasWords("state_reason", "__proto__")).toBe(false);
  expect(hasWords("burst", "hasOwnProperty")).toBe(false);
});

test("the plan-era families are gone with their screens (words.md section 3)", () => {
  for (const family of ["mode", "mist_stage", "mode_reason", "required_trigger", "trigger_outcome", "trigger", "tunable_short", "stress_kind", "stress_severity", "scorecard_reason"]) {
    expect(Object.hasOwn(WORDS, family), family).toBe(false);
  }
});

/** The schema at `path` under a component schema: a property name, `[]` for an array's items, `?` for the non-null branch of an anyOf. */
type Node = Schema & { type?: string | string[]; items?: Node; anyOf?: Node[]; properties?: Record<string, Node> };
function schemaAt(name: string, path: string[]): Schema | undefined {
  let node: Node | undefined = SCHEMAS[name] as Node | undefined;
  for (const step of path) {
    if (!node) return undefined;
    if (step === "[]") node = node.items;
    else if (step === "?") node = node.anyOf?.find((branch) => branch.type !== "null");
    else node = node.properties?.[step];
  }
  return node;
}
/** Every enum of the climate law's, the daily record's, the daily review's and the system pages' schemas, with its family. */
const V2_ENUMS: [family: string, schema: string, path: string[]][] = [
  ["law_rule", "LawRule", ["id"]],
  ["law_signal", "LawRule", ["signal"]],
  ["law_direction", "LawRule", ["direction"]],
  ["law_hold", "LawRule", ["hold", "?", "kind"]],
  ["law_relay", "LawRelay", ["equipment"]],
  ["relay_state", "LawRelay", ["state"]],
  ["relay_state", "LawLane", ["intervals", "[]", "state"]],
  ["law_lane", "LawLane", ["key"]],
  ["law_lane_group", "LawLane", ["group"]],
  ["drying_state", "LawDrying", ["state"]],
  ["drying_state", "LawHistory", ["drying", "[]", "state"]],
  ["drying_refusal", "LawDrying", ["refused_reason"]],
  ["drying_check", "LawDrying", ["checks", "[]", "id"]],
  ["limit_source", "LawDrying", ["limit_source"]],
  ["outdoor_source", "LawInputs", ["outdoor", "source"]],
  ["outdoor_source", "LawHistory", ["outdoor_source", "[]", "source"]],
  ["outdoor_source", "Now", ["outdoor", "source"]],
  ["band_source", "LawBand", ["source"]],
  ["gap_log", "LawAlone", ["gap_log"]],
  ["review_status", "Review", ["status"]],
  ["review_status", "ReviewPage", ["allOf"]],
  ["review_kind", "Review", ["kind"]],
  ["review_failure", "Review", ["failure"]],
  ["proposal_state", "Review", ["proposal_state"]],
  ["relay_comparison", "RelayCheck", ["days", "[]", "comparison"]],
  ["setting_effect", "Setting", ["effect"]],
  ["equipment", "LawView", ["lead_fan"]],
];

test("every enum value of the climate law, daily record, review and system schemas has words", () => {
  for (const [family, schema, path] of V2_ENUMS) {
    if (path[0] === "allOf") {
      // ReviewPage.today.status: the second allOf branch carries it.
      const today = ((SCHEMAS[schema] as { allOf: Node[] }).allOf[1].properties?.today as Node | undefined)?.properties?.status;
      expectWorded(family, enumOf(today));
      continue;
    }
    expectWorded(family, enumOf(schemaAt(schema, path)));
  }
  // Now.review.status is ReviewPage.today.status.
  expectWorded("review_status", enumOf(schemaAt("Now", ["review", "?", "status"])));
  // The stored values the delivery and data-gap readouts word (setpoint_changes, data_gaps), and the device's gap-log states.
  expectWorded("delivery_status", ["pending", "requested", "queued", "sent", "retrying", "confirmed", "failed", "cancelled", "superseded", "expired", "observed"]);
  expectWorded("delivery_source", ["band", "plan", "iris_planner", "manual", "esp32", "dispatcher", "system", "ingestor", "none"]);
  expectWorded("data_gap_reason", ["ingestor_restart", "ingestor_process_restart"]);
  expectWorded("data_gap_status", ["snapshot_taken", "snapshot_incomplete", "pending", "backfilled", "unrecoverable", "ignored"]);
});

test("the drying checks are worded in the order the law refuses, as the contract lists them", () => {
  expect(Object.keys(WORDS.drying_check)).toEqual(enumOf(schemaAt("LawDrying", ["checks", "[]", "id"])));
  expect(words("band_source", "corridor")).toBe("the widest safe band: the controller has no clock");
});

test("the law's refusals and states read as the owner would say them, with no internal names", () => {
  expect(["cost", "too_cold", "not_drier", "no_outdoor", "furnace", "cooling"].map((code) => words("drying_refusal", code))).toEqual([
    "costs more than the limit", "the house is too cold to vent", "outdoor air is not drier", "no outdoor reading", "the gas furnace is running",
    "the house is being cooled",
  ]);
  expect(words("gap_log", "not_armed_yet")).toBe("not armed yet");
  expect(words("gap_log", "nvs_full")).toBe("off: storage is full");
  // No internal service or device names in the new families' words.
  const families = ["law_rule", "law_lane", "drying_refusal", "drying_check", "band_source", "gap_log", "review_failure", "delivery_source", "data_gap_reason", "data_gap_status"];
  for (const family of families) {
    for (const text of Object.values(WORDS[family])) expect(text, `${family}: ${text}`).not.toMatch(/hermes|iris|esp32|ingestor|nvs|dispatcher|vanda|orchid/i);
  }
});

test("the law's words follow words.md: asked for and wanted, never latched; the widest safe band, never a corridor", () => {
  for (const text of Object.values(WORDS.law_lane)) expect(text).not.toMatch(/latch/i);
  expect(["request", "latch"].map((group) => words("law_lane_group", group))).toEqual(["Asked for", "Wanted"]);
  expect(words("band_source", "corridor")).toMatch(/^the widest safe band/);
  expect(words("law_rule", "fog")).toBe(words("equipment", "fog"));
  expect(["controller", "host", "none"].map((effect) => words("setting_effect", effect))).toEqual(["read by the controller", "used by the host", "stored and not used"]);
});

test("every unit of words.md section 5 has its spoken name", () => {
  const units = ["°F", "kPa", "%", "kWh", "therms", "gal", "kg", "g", "kWh/kg", "h", "min", "s", "d", "kB", "ms", "B", "dBm"];
  expectWorded("unit", units);
  expect(Object.keys(WORDS.unit).sort()).toEqual([...units].sort());
  expect(words("unit", "therms")).toBe("therms, estimated");
});
