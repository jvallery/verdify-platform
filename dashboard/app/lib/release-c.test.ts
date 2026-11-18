// SPDX-License-Identifier: MIT
/**
 * Release C (dashboard v2 API spec section 7) rolls the web first: every parser it changed reads a payload from the API
 * before it (088414f4: Now.mode and Now.iris, Equipment.mode_reason, the plan blocks, applied_from plan, the held
 * state) and one from the API after it, and both read the same. One payload of each shape per changed parser.
 */
import { expect, test } from "vitest";
import { fixture } from "../../e2e/fixtures/index.mjs";
import { OPERATIONS, parseActivityPage, parseDesiredSetting, parseEquipment, parseNow, parseSettingHistory, parseSettings } from "./operator-api";

const NOW = Date.parse("2026-11-02T17:42:00Z");
type Body = Record<string, unknown>;
const after = fixture(["setting-history", "activity-mixed"], { now: NOW }) as Record<string, Body>;
const clone = <T>(value: T): T => structuredClone(value);
const AT = "2026-11-02T17:00:00.000Z";
const waypoint = { at: AT, value: 720, source: "iris", effective: false };
const desired = {
  id: 12, param: "site_pressure_hpa", value: 845, snapped_from: null, manual: true, manual_before: false, state: "confirmed",
  state_reason: null, confirmed_at: null, actor: { source: "dashboard", name: "jason" }, reason: null, created_at: AT,
};
const clamp = { code: "clamped", detail: "campaign_guard", applied_value: 840, since: AT };

test("the new API's payloads carry none of the retired fields, and the parsers read them", () => {
  expect(after["API-02"]).not.toHaveProperty("mode");
  expect(after["API-02"]).not.toHaveProperty("iris");
  expect(after["API-13"]).not.toHaveProperty("mode_reason");
  expect(after["API-12"]).not.toHaveProperty("plan");
  expect((after["API-09"].items as Body[]).every((row) => !("plan" in row) && row.applied_from !== "plan")).toBe(true);
  for (const [id, parse] of [["API-02", parseNow], ["API-13", parseEquipment], ["API-12", parseSettingHistory], ["API-09", parseSettings], ["API-17", parseActivityPage]] as const) {
    expect(parse(after[id]), id).not.toBeNull();
  }
  expect(Object.keys(OPERATIONS)).not.toContain("API-07");
  expect(Object.keys(OPERATIONS)).not.toContain("API-25");
});

test("Now (API-02): an old payload's mode and iris are ignored, not rejected", () => {
  const old = { ...clone(after["API-02"]), mode: { code: "IDLE", stage: null, reason: "idle", since: AT }, iris: { plan_id: "iris-1", trigger: "SUNRISE", valid_until: AT, required_trigger: "ok" } };
  const [before, now] = [parseNow(old), parseNow(after["API-02"])];
  expect(before).not.toBeNull();
  expect(before).toEqual(now);
  expect(before).not.toHaveProperty("mode");
  expect(before).not.toHaveProperty("iris");
});

test("Equipment (API-13): an old payload's mode_reason is ignored, and the two reasons read as before", () => {
  const old = { ...clone(after["API-13"]), mode_reason: { code: "temp_high", since: AT, observed_at: AT } };
  const [before, now] = [parseEquipment(old), parseEquipment(after["API-13"])];
  expect(before).toEqual(now);
  expect(before).not.toHaveProperty("mode_reason");
  expect(before!.fog_block_reason).toEqual(now!.fog_block_reason);
});

test("Settings (API-09): an old row's plan block is ignored, applied_from plan passes as a code, and held reads not_confirmed", () => {
  const items = clone(after["API-09"].items as Body[]);
  const index = items.findIndex((row) => row.param === "outdoor_staleness_max_s");
  const old = {
    ...after["API-09"],
    items: items.map((row, at) => (at === index
      ? { ...row, plan: { value: 660, plan_id: "iris-1", source: "iris", written_at: AT, next: waypoint }, applied_from: "plan", state: "held", desired: { ...desired, param: row.param, state: "held", state_reason: clamp } }
      : { ...row, plan: null })),
  };
  const before = parseSettings(old)!;
  const now = parseSettings(after["API-09"])!;
  expect(before.items).toHaveLength(now.items.length);
  expect(before.items.every((row) => !("plan" in row))).toBe(true);
  const row = before.items[index];
  expect([row.state, row.desired!.state, row.desired!.state_reason?.code, row.applied_from]).toEqual(["not_confirmed", "not_confirmed", "clamped", "plan"]);
  // The new API sends a clamp as not_confirmed with the same reason: one state on screen either way.
  const fresh = { ...after["API-09"], items: items.map((item, at) => (at === index ? { ...item, state: "not_confirmed", desired: { ...desired, param: item.param, state: "not_confirmed", state_reason: clamp } } : item)) };
  const parsed = parseSettings(fresh)!.items[index];
  expect([parsed.state, parsed.desired!.state, parsed.desired!.state_reason?.code]).toEqual(["not_confirmed", "not_confirmed", "clamped"]);
});

test("a write's answer (API-10, API-11): held reads not_confirmed; every other state as served", () => {
  expect(parseDesiredSetting({ ...desired, state: "held", state_reason: clamp })!.state).toBe("not_confirmed");
  expect(parseDesiredSetting({ ...desired, state: "not_confirmed", state_reason: clamp })!.state).toBe("not_confirmed");
  for (const state of ["requested", "confirmed", "released", "no_readback"]) expect(parseDesiredSetting({ ...desired, state })!.state).toBe(state);
});

test("Setting history (API-12): an old payload's plan waypoints are ignored", () => {
  const old = { ...clone(after["API-12"]), plan: [waypoint] };
  const [before, now] = [parseSettingHistory(old), parseSettingHistory(after["API-12"])];
  expect(before).toEqual(now);
  expect(before).not.toHaveProperty("plan");
});

test("Activity (API-17): an old setting write's held state reads not_confirmed; other entries read as served", () => {
  const page = clone(after["API-17"]) as { items: Body[] };
  const write = page.items.findIndex((entry) => entry.action === "setting.write");
  const old = { ...page, items: page.items.map((entry, at) => (at === write ? { ...entry, state: "held" } : entry)) };
  const before = parseActivityPage(old)!;
  const now = parseActivityPage(page)!;
  expect(before.items[write].state).toBe("not_confirmed");
  expect(before.items.filter((_, at) => at !== write)).toEqual(now.items.filter((_, at) => at !== write));
});
