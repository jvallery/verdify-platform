// SPDX-License-Identifier: MIT
// Coming up on Now (dashboard v2 screens §1, inside Today) over the contract fixtures at 10:42 Denver: the scheduled
// water runs, the lights' windows and timers, the sun and Later, with nothing about what the controller will decide.
import { expect, test } from "vitest";
import { answer, buildWorld, fixture } from "../../../e2e/fixtures/index.mjs";
import { parseIrrigationStatus, parseScheduleAgenda, type ScheduleAgenda } from "../../lib/operator-api";
import { laterText, lightTimers, lightWindows, nextItems, nextRunText, nextWindow, runLength } from "./next";

const NOW = Date.parse("2026-11-02T17:42:00Z");
const WINDOW = nextWindow(NOW);
const ME = { username: "jason", display_name: "Jason" };
const plain = (value: string | null | undefined) => (value ?? "").replaceAll(String.fromCharCode(0xa0), " ");
const get = (names: string | string[], url: string) => answer(buildWorld(names, { now: NOW }), { method: "GET", url }).body;
const agendaOf = (names: string | string[]): ScheduleAgenda => parseScheduleAgenda(get(names, "/v1/irrigation/schedules?days=7"))!;
const statusOf = (names: string | string[]) => parseIrrigationStatus(fixture(names, { now: NOW })["API-IRR-01"])!;
const at = (clock: string) => Date.parse(`2026-11-02T${clock}:00-07:00`) / 1000;
const setting = (param: string, value: number) => ({ param, readback: { value } }) as never;

test("the window: now to 12 h after it, in epoch seconds", () => {
  expect(WINDOW).toEqual({ now: NOW / 1000, to: NOW / 1000 + 12 * 3600 });
});

test("a run's length: minutes for a drip, count × on for a mister", () => {
  const drip = runLength({ on_s: 720, count: 1, gap_s: 0, prewet_s: 0, flush_s: 0 }, "L01");
  expect([drip.seconds, plain(drip.words)]).toEqual([720, "12 min"]);
  expect(plain(runLength({ on_s: 30, count: 1, gap_s: 0, prewet_s: 0, flush_s: 0 }, "L01").words)).toBe("30 s");
  expect(runLength(undefined, "L01")).toEqual({ seconds: 60, words: "" });
});

test("the next 12 h: the water runs and the sun in time order, nothing the controller decides", () => {
  const items = nextItems({ agenda: agendaOf("in-band"), settings: null, equipment: null }, WINDOW);
  expect(items.map((item) => [item.kind, plain(item.text), plain(item.note)])).toEqual([
    ["run", "Center mister · 4 × 45 s · sensor-fault backup", "only if VPD sensing is degraded"],
    ["run", "Center mister · 4 × 45 s · sensor-fault backup", "only if VPD sensing is degraded"],
    ["sun", "Sunset", ""],
  ]);
  expect(items.map((item) => item.at)).toEqual([at("11:47"), at("13:47"), items[2].at]);
  // A skipped run says why, without "Skipped:"; a scheduled one is not struck through.
  const skipped = nextItems({ agenda: agendaOf(["schedules-paused", "l07-schedule-off"]), settings: null, equipment: null }, { ...WINDOW, to: WINDOW.now + 24 * 3600 });
  expect(skipped.filter((item) => item.kind === "run").map((item) => [plain(item.text), item.skipped, item.note])).toContainEqual(["Center mister · 8 × 1 min · Dawn drench", false, null]);
});

test("the next scheduled run for Water today", () => {
  expect(plain(nextRunText(agendaOf("in-band"), WINDOW, NOW))).toBe("Center mister at 11:47 · 4 × 45 s");
  expect(nextRunText(null, WINDOW, NOW)).toBeNull();
});

test("the lights: the window each may switch on, nothing while automation is off, the intent where it differs", () => {
  const settings = [
    setting("sw_gl_main_auto_mode", 1), setting("gl_main_sunrise_hour", 7), setting("gl_main_sunset_hour", 20), setting("sw_gl_main_solar_phasing", 0),
    setting("sw_gl_grow_auto_mode", 0), setting("gl_grow_sunrise_hour", 7), setting("gl_grow_sunset_hour", 22),
  ];
  expect(lightWindows(settings, null, WINDOW).filter((item) => item.to > WINDOW.now && item.from < WINDOW.to)).toEqual([{ light: "main", from: at("07:00"), to: at("20:00") }]);
  const solar = agendaOf("in-band").solar;
  const phased = [...settings, setting("sw_gl_main_solar_phasing", 1), setting("gl_main_sunrise_offset_min", -30), setting("gl_main_sunset_offset_min", 60)].reverse();
  expect(lightWindows(phased, solar, WINDOW).find((item) => item.from <= WINDOW.now && item.to > WINDOW.now)).toEqual({ light: "main", from: at("06:05"), to: at("17:58") });
  const items = nextItems({ agenda: null, settings, equipment: [{ equipment: "grow_light_grow", state: "on", intent: "off", since: null }] }, WINDOW).filter((item) => item.kind === "light");
  expect(items.map((item) => [plain(item.text), item.note])).toEqual([
    ["Main light may switch on 07:00–20:00", "when daylight is low, or for anyone inside"],
    ["Grow light: the controller wants it off", "Lutron differs"],
  ]);
});

test("a timed light switch still running lists its end; one the controller already matches does not", () => {
  const iso = (clock: string) => new Date(at(clock) * 1000).toISOString();
  const equipment = [
    { equipment: "grow_light_main", state: "on", intent: "off", since: iso("10:40"), manual_until: iso("10:55") },
    { equipment: "grow_light_grow", state: "on", intent: "on", since: iso("10:41"), manual_until: iso("10:56") },
  ];
  expect(lightTimers(equipment, WINDOW)).toEqual([{ light: "main", name: "Main light", at: at("10:55") }]);
  expect(lightTimers([{ ...equipment[0], manual_until: null }, { ...equipment[0], manual_until: iso("10:30") }], WINDOW)).toEqual([]);
  const items = nextItems({ agenda: null, settings: null, equipment }, WINDOW).filter((item) => item.kind === "light");
  expect(items.map((item) => [plain(item.text), item.note, item.at])).toEqual([
    ["Main light: the controller wants it off", "Lutron differs", WINDOW.now],
    ["Main light back to automatic", "the by-hand switch ends", at("10:55")],
  ]);
});

test("Later: each line with no run in the next 12 h, its next one, its pause with who and why, or together with no schedule", () => {
  expect(laterText({ agenda: agendaOf("in-band"), lines: statusOf("in-band").lines }, WINDOW, NOW, ME)).toBe("No schedule: Wall drip, South mister, West mister");
  expect(plain(laterText({ agenda: agendaOf("schedules-paused"), lines: statusOf("schedules-paused").lines }, WINDOW, NOW, ME)))
    .toBe("Wall drip Wed 07:35 · Wall drip (fertilized) Sun 07:35 · Center mister Tue 06:50 · No schedule: South mister, West mister");
  expect(plain(laterText({ agenda: agendaOf("l01-paused"), lines: statusOf("l01-paused").lines }, WINDOW, NOW, ME))).toMatch(/^Wall drip paused until 14:00 by Jason: rain · next Wed 07:35 · /);
  expect(plain(laterText({ agenda: agendaOf("l01-paused"), lines: statusOf("l01-paused").lines }, WINDOW, NOW, { username: "caretaker", display_name: "Caretaker" }))).toContain("by jason: rain");
});
