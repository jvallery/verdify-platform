// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import type { LightingCircuit, Setting } from "../../lib/operator-api";
import {
  circuitSettings, completeMean, hasLightSettings, intentWords, lightsAnswer, lightsStatus, minutesOnDays, mismatch, paramOf, settingHref, settingValue, switchCheck, weekWindow, windowText,
  type LightItem,
} from "./model";

/** 10:42 America/Denver on 2026-11-02 (MST). */
const NOW = Date.parse("2026-11-02T17:42:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const item = (fields: Partial<LightItem> = {}): LightItem => ({
  equipment: "grow_light_main", group: "light", label: "Main", state: "off", intent: "off", auto_reason: "lux_sufficient", manual_until: null, observed_at: ago(1), since: ago(60), ...fields,
});

test("the controller's intent and its reason in words, never the code", () => {
  expect(intentWords(item())).toBe("The controller wants it off: enough daylight");
  expect(intentWords(item({ intent: "on", auto_reason: "plant_lux_low" }))).toBe("The controller wants it on: too dark for the plants");
  expect(intentWords(item({ intent: "off", auto_reason: "auto_disabled" }))).toBe("The controller wants it off. Automation off");
  expect(intentWords(item({ intent: "on", auto_reason: "brand_new_reason" }))).toBe("The controller wants it on. brand_new_reason");
  expect(intentWords(item({ intent: null, auto_reason: null }))).toBe("The controller has not reported what it wants");
});

test("a mismatch is called out; a timed switch is expected and says when it ends", () => {
  expect(mismatch(item())).toBeNull();
  expect(mismatch(item({ state: "off", intent: "on" }))).toEqual({ tone: "warn", text: "The switch reports off, but the controller wants it on." });
  const timed = mismatch(item({ state: "on", intent: "off", manual_until: new Date(NOW + 12 * 60_000).toISOString() }));
  expect(timed?.tone).toBe("info");
  expect(timed?.text).toBe("Switched on by hand until 10:54; the controller wants it off and takes it back then.");
  // Either side not reported: nothing to compare.
  expect(mismatch(item({ state: "unknown", intent: "on" }))).toBeNull();
});

test("whether the switch confirmed: confirmed, not confirmed, by hand, or not reported when Home Assistant is quiet", () => {
  expect(switchCheck(item(), NOW)).toMatchObject({ status: "ok", label: "Confirmed" });
  expect(switchCheck(item({ intent: "on" }), NOW)).toMatchObject({ status: "warn", label: "Not confirmed", text: "The controller wants it on, and the switch still reports off." });
  expect(switchCheck(item({ state: "on", manual_until: new Date(NOW + 60_000).toISOString() }), NOW)).toMatchObject({ status: "info", label: "By hand" });
  const quiet = switchCheck(item({ state: "unknown", observed_at: ago(11) }), NOW);
  expect(quiet).toMatchObject({ status: "warn", label: "Not reported" });
  expect(quiet.text).toBe("The switch has not reported for 11 min: Home Assistant or the network may be down. The light stays as it is until they are back.");
  expect(switchCheck(undefined, NOW).label).toBe("Not reported");
});

test("the page's status line names what needs a look, or says both lights match", () => {
  expect(lightsStatus([item(), item({ equipment: "grow_light_grow" })], NOW)).toBe("Both lights are as the controller wants: main off, grow off");
  expect(lightsStatus([item(), item({ intent: "on" })], NOW)).toBe("Grow light off, the controller wants it on");
  expect(lightsStatus([item({ state: "on", manual_until: new Date(NOW + 60_000).toISOString() }), undefined], NOW)).toBe("Main light on by hand until 10:43 · Grow light not reported");
  expect(lightsStatus([item({ observed_at: ago(20) }), item({ intent: null })], NOW)).toBe("Main light not reported · Grow light off, the controller has not said what it wants");
});

test("the week's window is the last seven local days, stable through the day", () => {
  expect(weekWindow("2026-11-02")).toEqual({ from: "2026-10-27T06:00:00.000Z", to: "2026-11-03T07:00:00.000Z" });
  expect(windowText({ start_hour: 7, cutoff_hour: 19 })).toBe("07:00–19:00");
  expect(windowText({ start_hour: null, cutoff_hour: 19 })).toBeNull();
});

test("minutes on per day: today is partial and labelled so far; the 7-day mean covers complete days only", () => {
  const circuit = {
    light: "main", equipment: "grow_light_main", label: "Main",
    days: [
      { date: "2026-11-01", partial: false, on_s: 36_000, starts: 2, start_hour: 7, cutoff_hour: 19, lux_on: 40000, lux_off: 48000, target_min: 960, window_min: 720, qualified_min: 700 },
      { date: "2026-10-31", partial: false, on_s: 24_000, starts: 1, start_hour: 7, cutoff_hour: 19, lux_on: 40000, lux_off: 48000, target_min: 960, window_min: 720, qualified_min: 700 },
      { date: "2026-11-02", partial: true, on_s: 600, starts: 1, start_hour: 7, cutoff_hour: 19, lux_on: 40000, lux_off: 48000, target_min: 960, window_min: 220, qualified_min: 110 },
    ],
  } as LightingCircuit;
  const days = minutesOnDays(circuit);
  expect(days).toEqual([
    { date: "2026-11-01", value: 600 }, { date: "2026-10-31", value: 400 }, { date: "2026-11-02", value: 10, partial: true, note: "so far" },
  ]);
  expect(completeMean(days)).toBe(500);
  expect(completeMean([])).toBeNull();
  expect(minutesOnDays(null)).toEqual([]);
});

test("the twelve settings of each circuit, in four groups, each opening its drawer on Settings", () => {
  expect(paramOf("main", "lux_threshold")).toBe("gl_main_lux_threshold");
  expect(paramOf("grow", "sw_auto_mode")).toBe("sw_gl_grow_auto_mode");
  expect(settingHref("gl_main_lux_threshold")).toBe("/settings?edit=gl_main_lux_threshold");
  const rows: Setting[] = [
    { param: "gl_main_lux_threshold", readback: { value: 40000 }, state: "confirmed" },
    { param: "gl_main_sunrise_hour", readback: { value: 7 }, state: "requested" },
    { param: "gl_main_min_on_s", readback: { value: 120 }, state: "confirmed" },
    { param: "sw_gl_main_out_of_service", readback: { value: 0 }, state: "confirmed" },
  ] as unknown as Setting[];
  const groups = circuitSettings("main", rows);
  expect(groups.map(({ group }) => group.title)).toEqual(["Window", "Daylight thresholds", "Hold times", "Out of service"]);
  expect(groups.flatMap(({ rows: shown }) => shown)).toHaveLength(12);
  const shown = Object.fromEntries(groups.flatMap(({ rows: list }) => list.map((row) => [row.param, [row.value, row.state]])));
  expect(shown.gl_main_lux_threshold).toEqual(["40,000 lx", "confirmed"]);
  expect(shown.gl_main_sunrise_hour).toEqual(["07:00", "requested"]);
  expect(shown.gl_main_min_on_s).toEqual(["2 min", "confirmed"]);
  expect(shown.sw_gl_main_out_of_service).toEqual(["Off", "confirmed"]);
  // A setting the API does not serve reads "—", never 0.
  expect(shown.gl_main_lux_hysteresis).toEqual(["—", null]);
  expect(hasLightSettings(rows)).toBe(true);
  expect(hasLightSettings([{ param: "mister_engage_kpa" }])).toBe(false);
  expect(settingValue(60, "s")).toBe("60 s");
  expect(settingValue(7.5, "hour")).toBe("07:30");
});

test("the answer first (design review A4): both lights in one sentence when they agree for one reason, else a sentence a light", () => {
  const grow = (fields: Partial<LightItem> = {}) => item({ equipment: "grow_light_grow", label: "Grow", ...fields });
  expect(lightsAnswer([item(), grow()], NOW)).toBe("Both lights are off, as the controller wants: enough daylight.");
  expect(lightsAnswer([item(), grow({ intent: "on", auto_reason: "plant_lux_low" })], NOW))
    .toBe("The main light is off, as the controller wants: enough daylight. The grow light is off, but the controller wants it on: too dark for the plants.");
  expect(lightsAnswer([item({ state: "on", manual_until: new Date(NOW + 12 * 60_000).toISOString() }), grow()], NOW))
    .toBe("The main light is on by hand until 10:54; then the controller takes it off. The grow light is off, as the controller wants: enough daylight.");
  expect(lightsAnswer([item({ observed_at: ago(30) }), undefined], NOW)).toBe("The main light has not reported whether it is on. The grow light has not reported whether it is on.");
});
