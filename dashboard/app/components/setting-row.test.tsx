// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// SettingRow and the drawer's facts (dashboard v2 screens §10.4) on rows of the settings fixture rendered at test time
// from the tunable registry, patched per rule: the name and key; the value with its unit; the controller's side in
// words.md's words (what it reads when not confirmed); Edit or Details. Times
// are America/Denver with the clock at 10:42 on 2026-11-02.
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "../../e2e/fixtures/index.mjs";
import { parseSettings, type DesiredSetting, type Setting } from "../lib/operator-api";
import { displayNumber, keptNumber, readableDuration, settingDisplay } from "../lib/setting-values";
import type { Session } from "../lib/session";
import { SettingRow, SettingStatus, boundsText, breakableKey, settingState, valueInForce, type SettingRowProps } from "./setting-row";
import { NBSP, denver, renderUi, text } from "./test-render";

const NOW = Date.parse(denver("10:42"));
const OPERATOR: Partial<Session> = { role: "operator", writesEnabled: true };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** The fixture's rows (rendered from verdify_schemas/tunable_registry.py) under `names`, parsed as the client reads them. */
function row(param: string, patch: Partial<Setting> = {}): Setting {
  const found = (parseSettings(fixture("in-band", { now: NOW })["API-09"])!.items as Setting[]).find((item) => item.param === param);
  if (!found) throw new Error(`no fixture row ${param}`);
  return { ...found, ...patch };
}
function desired(fields: Partial<DesiredSetting>): DesiredSetting {
  return {
    id: 7, param: "outdoor_staleness_max_s", value: 630, snapped_from: null, manual: true, manual_before: false, state: "requested", state_reason: null,
    confirmed_at: null, actor: { source: "dashboard", name: "jason" }, reason: null, created_at: denver("10:41", 40), ...fields,
  };
}
function draw(setting: Setting, props: Partial<SettingRowProps> = {}, session: Partial<Session> = OPERATOR) {
  return renderUi(<table><tbody><SettingRow setting={setting} editTo={`/settings?edit=${setting.param}`} {...props} /></tbody></table>, session);
}
const cell = (name: "name" | "value" | "state" | "actions") => text(document.querySelector(`.setting-${name}`));
const edit = () => screen.queryByRole("link", { name: /^Edit / });
const details = () => screen.queryByRole("link", { name: /^Details of / });

test("a confirmed row on one line: name and key; the value with its unit; Confirmed; Edit. Nothing else in the row", () => {
  const setting = row("outdoor_staleness_max_s");
  draw(setting);
  expect(text(document.querySelector(".setting-label"))).toBe("Outdoor Staleness Max");
  expect(text(document.querySelector(".setting-param"))).toBe("outdoor_staleness_max_s");
  // The key may wrap only after an underscore: a <wbr> after each, and no text added.
  expect(document.querySelector(".setting-param")!.querySelectorAll("wbr")).toHaveLength(3);
  expect(cell("value")).toBe("Value 660 s");
  expect(cell("state")).toBe("Confirmed");
  expect(document.querySelectorAll(".setting-row > *")).toHaveLength(4);
  expect(document.querySelector(".setting-row")!.getAttribute("data-state")).toBe("confirmed");
  expect(edit()!.getAttribute("href")).toBe("/settings?edit=outdoor_staleness_max_s");
  expect(edit()!.getAttribute("data-write-control")).toBe("true");
  expect(details()).toBeNull();
  expect(document.querySelector(".setting-summary, .setting-note, .setting-elsewhere")).toBeNull();
  expect(document.querySelector("[style]")).toBeNull();
});

test("a value sent and not yet read back: Not confirmed since the time it was sent, what the controller reads, the reason once known", () => {
  draw(row("outdoor_staleness_max_s", { state: "requested", desired: desired({}) }));
  expect(cell("value")).toBe("Value 630 s");
  expect(cell("state")).toBe("Not confirmed since 10:41 reads 660 s");
  expect(document.querySelector(".setting-row")!.getAttribute("data-state")).toBe("not_confirmed");
  cleanup();
  draw(row("outdoor_staleness_max_s", { state: "not_confirmed", desired: desired({ state: "not_confirmed", state_reason: { code: "push_failed", since: denver("10:41") } as DesiredSetting["state_reason"] }) }));
  expect(cell("state")).toMatch(/^Not confirmed since 10:41 reads 660 s.*Sending failed/);
  expect(document.querySelector(".setting-state .badge")!.className).toContain("badge-serious");
});

test("Not reported when the controller has no value; a Band in force row is worked out by the host, with Details", () => {
  draw(row("outdoor_staleness_max_s", { state: "no_readback", readback: { value: null, observed_at: null, reason: "not reported" } }));
  expect(cell("state")).toBe("Not reported");
  expect(cell("value")).toBe("Value —");
  cleanup();
  draw(row("band_house_temp_low"));
  expect(text(document.querySelector(".setting-label"))).toBe("House temperature low edge now");
  expect(cell("state")).toBe("Worked out by the host");
  expect([edit(), details()?.getAttribute("aria-label")]).toEqual([null, "Details of House temperature low edge now"]);
});

test("the band's points and the drying cost limit open read-only (Details); a lighting setting has Edit", () => {
  draw(row("band_temp_low_sr"));
  expect(text(document.querySelector(".setting-label"))).toBe("Temperature low edge at sunrise");
  expect([edit(), details()?.getAttribute("href")]).toEqual([null, "/settings?edit=band_temp_low_sr"]);
  cleanup();
  draw(row("dry_cost_limit_kwh_per_kg"));
  expect(edit()).toBeNull();
  cleanup();
  draw(row("gl_main_lux_threshold"));
  expect(edit()).not.toBeNull();
});

test("a viewer sees every row with Details and no write control", () => {
  draw(row("outdoor_staleness_max_s"), {}, { role: "viewer", writesEnabled: true });
  expect(edit()).toBeNull();
  expect(details()!.getAttribute("href")).toBe("/settings?edit=outdoor_staleness_max_s");
  expect(document.querySelector("[data-write-control]")).toBeNull();
});

test("stale readbacks: the value muted with the stale age; never Confirmed-looking ink", () => {
  draw(row("outdoor_staleness_max_s"), { readbackStale: true });
  expect(document.querySelector(".setting-state [data-readback]")!.getAttribute("data-readback")).toBe("stale");
  expect(document.querySelector(".setting-state .value-muted")).not.toBeNull();
});

test("no retired words in a row: no plan, planner, Iris changed, manual or held", () => {
  for (const param of ["outdoor_staleness_max_s", "band_temp_target_sm", "temp_low", "sw_gl_main_auto_mode", "mister_engage_delay_s"]) {
    draw(row(param, { state: "not_confirmed", desired: desired({ param, state: "not_confirmed", state_reason: { code: "clamped", applied_value: 1 } }) }));
    expect(text(document.querySelector(".setting-row")), param).not.toMatch(/\b(plan|planned|planner|Iris changed|manual|held|target)\b/i);
    cleanup();
  }
});

test("the drawer's facts: value, readback, state, the allowed range with the bounds bar, and what reads it", () => {
  renderUi(<SettingStatus setting={row("outdoor_staleness_max_s", { state: "requested", desired: desired({}) })} />);
  const facts = [...document.querySelectorAll(".ctl-setting-status > div")].map((pair) => [text(pair.querySelector("dt")), text(pair.querySelector("dd"))]);
  expect(facts.map(([term]) => term)).toEqual(["Value", "Controller reads", "State", "Allowed", "In use"]);
  expect(facts[0][1]).toBe("630 s");
  expect(facts[2][1]).toBe("Not confirmed since 10:41");
  expect(facts[4][1]).toBe("Read by the controller.");
  expect(document.querySelector(".ctl-bounds-requested")).not.toBeNull();
  expect(document.querySelector(".ctl-bounds-planned")).toBeNull();
});

test("bounds and step, the value in force and the state, without rendering", () => {
  expect(boundsText({ param: "x", kind: "numeric", min: 0.5, max: 2.5, step: 0.05, unit: "kPa" }).replaceAll(NBSP, " ")).toBe("0.50–2.50 kPa in steps of 0.05");
  expect(boundsText({ param: "x", kind: "switch", min: null, max: null, step: 1, unit: null })).toBe("ON or OFF");
  expect(boundsText({ param: "x", kind: "enum", min: null, max: null, step: null, unit: null, options: [{ value: 0, label: "Off" }, { value: 1, label: "On" }] })).toBe("Off, On");
  expect(boundsText({ param: "x", kind: "numeric", min: null, max: null, step: null, unit: null })).toBe("—");
  const base = row("outdoor_staleness_max_s");
  expect(valueInForce(base)).toBe(660);
  expect(valueInForce({ ...base, state: "requested", desired: desired({}) })).toBe(630);
  // A release has nothing standing: the controller's value is the one in force.
  expect(valueInForce({ ...base, state: "released", desired: desired({ value: null, state: "released" }) })).toBe(660);
  expect(settingState({ ...base, state: "released" }).kind).toBe("reported");
  expect(settingState({ ...base, state: "not_confirmed", desired: desired({ state: "not_confirmed" }) })).toMatchObject({ kind: "not_confirmed", status: "serious" });
  expect(settingState(row("band_house_temp_low")).kind).toBe("derived");
  // A legacy wide limit has nothing to confirm: the host stopped sending it, so a stale push never reads not confirmed.
  const legacy = row("temp_low", { state: "not_confirmed", desired: null });
  expect(legacy.read_only_kind).toBe("legacy_wide_limit");
  expect(settingState(legacy)).toEqual({ kind: "reported", status: "neutral", since: null, reason: null });
  expect(settingState({ ...legacy, readback: null }).kind).toBe("not_reported");
  expect(text(renderUi(<p>{breakableKey("a_b_c")}</p>).container)).toBe("a_b_c");
});

test("one display for Settings' rows and Lights: the step's decimals or those it carries, the key's unit, a long duration readable", () => {
  expect(displayNumber(48.75, 30)).toBe("48.75");
  expect(keptNumber(0.7, 0.05)).toBe("0.70");
  expect(readableDuration(1_800_000, "ms")?.replaceAll(NBSP, " ")).toBe("30 min");
  expect(settingDisplay(660, row("outdoor_staleness_max_s")).replaceAll(NBSP, " ")).toBe("660 s");
});
