// SPDX-License-Identifier: MIT
// Record's shaping (screens section 6): the window in the URL, the days shown, the block states, and the figures the
// page derives itself (price paid, irrigation, heater hours, per-relay means, the counter check's words).
import { expect, test } from "vitest";
import {
  READ_DAYS, alertsText, change, checkDays, checkResult, hasRecord, heaterHours, irrigationGal, isSoFar, kwhText, parseWindow, pricePaid, readParams,
  recordState, refusedText, relayMean, repairedRuns, runTime, sparkSeries, windowDays, windowHref,
} from "./record-model";
import { MEANS, RELAY_CHECK, dailyRecord, readOf, recordDay } from "./test-record";

const plain = (value: string) => value.replaceAll("\u00a0", " ");

test("the window: 7, 30, 90 or 365 days from ?days=, 30 otherwise; its link keeps the other parameters and omits the default", () => {
  expect([null, "", "30", "7", "90", "365", "14", "07", "7.0", "abc"].map(parseWindow)).toEqual([30, 30, 30, 7, 90, 365, 30, 30, 30, 30]);
  expect(windowHref("/record", 7)).toBe("/record?days=7");
  expect(windowHref("/record/equipment", 30, "days=90&x=1")).toBe("/record/equipment?x=1");
  expect(windowHref("/record/utilities", 365, "?x=1")).toBe("/record/utilities?x=1&days=365");
});

test("every window reads at least the 31 days ending today, so a 30-day mean and a 30-day sparkline always have their days", () => {
  expect(READ_DAYS).toBe(31);
  expect(readParams(7, "2026-11-17")).toEqual({ from: "2026-10-18", to: "2026-11-17" });
  expect(readParams(30, "2026-11-17")).toEqual({ from: "2026-10-18", to: "2026-11-17" });
  expect(readParams(90, "2026-11-17")).toEqual({ from: "2026-08-20", to: "2026-11-17" });
  expect(readParams(365, "2026-11-17")).toEqual({ from: "2025-11-18", to: "2026-11-17" });
  const record = dailyRecord();
  expect(windowDays(record, 7).map((day) => day.date)).toEqual(["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"]);
  expect(windowDays(record, 30)).toHaveLength(30);
  expect(windowDays(record, 90)).toHaveLength(31);
});

test("today is so far; a day with nothing recorded is a gap", () => {
  const record = dailyRecord(3);
  expect(record.days.map((day) => isSoFar(day, record))).toEqual([false, false, true]);
  const empty = recordDay("2026-11-01", 5, {
    complete: false, band: null, relays: null, climate_starts: null, climate_run_s: null, energy: { kwh: null, kwh_partial: null, coverage_pct: null },
    gas: { therms_est: null }, water: { total_gal: null, crop_gal: null, wetting_gal: null, house_gal: null, complete: null }, drying: null, alerts: null,
  });
  expect(hasRecord(empty)).toBe(false);
  expect(hasRecord(record.days[0])).toBe(true);
});

test("a block's state: loading before the first answer, error with nothing, stale over old data, empty with no record, else ready", () => {
  expect(recordState(readOf(null, { pending: true }), false)).toBe("loading");
  expect(recordState(readOf(null, { failed: true }), false)).toBe("error");
  expect(recordState(readOf({}, { failed: true }), false)).toBe("stale");
  expect(recordState(readOf({}), true)).toBe("empty");
  expect(recordState(readOf({}), false)).toBe("ready");
});

test("run time reads minutes up to 90 and hours above; unknown is an em dash", () => {
  expect([0, 59, 5400, 5460, 62_828, null, undefined, NaN].map((seconds) => plain(runTime(seconds)))).toEqual(["0 min", "1 min", "90 min", "1.5 h", "17.5 h", "—", "—", "—"]);
});

test("electricity: the metered figure, \"partial\" under 70 % coverage, \"—\" with no meter reading", () => {
  const day = recordDay("2026-11-16", 1);
  expect(plain(kwhText(day))).toBe("25.1 kWh");
  expect(kwhText({ ...day, energy: { kwh: null, kwh_partial: 11.92, coverage_pct: 54 } })).toBe("partial");
  expect(kwhText({ ...day, energy: { kwh: null, kwh_partial: null, coverage_pct: null } })).toBe("—");
});

test("alerts in words, the zero kinds left out", () => {
  expect(alertsText({ critical: 1, warning: 2, info: 0 })).toBe("1 critical, 2 warning");
  expect(alertsText({ critical: 0, warning: 0, info: 3 })).toBe("3 info");
  expect(alertsText({ critical: 0, warning: 0, info: 0 })).toBe("None");
  expect(alertsText(null)).toBe("—");
});

test("irrigation is crop water less wetting, never below 0, unknown when either is", () => {
  const water = { total_gal: 46, crop_gal: 44, wetting_gal: 6, house_gal: 2, complete: true };
  expect(irrigationGal(water)).toBe(38);
  expect(irrigationGal({ ...water, crop_gal: 4 })).toBe(0);
  expect(irrigationGal({ ...water, wetting_gal: null })).toBeNull();
  expect(irrigationGal({ ...water, crop_gal: null })).toBeNull();
});

test("the price paid for drying is heat over water (Wh/g = kWh/kg), blank on a lower-bound day or with no water removed", () => {
  const drying = recordDay("2026-11-16", 1).drying!;
  expect(pricePaid(drying)).toBeCloseTo(870 / 1700, 6);
  expect(pricePaid({ ...drying, lower_bound: true })).toBeNull();
  expect(pricePaid({ ...drying, water_g: 0 })).toBeNull();
  expect(pricePaid({ ...drying, heat_wh: null })).toBeNull();
  expect(pricePaid(null)).toBeNull();
});

test("heater hours add the served electric and gas means; the change is the 7-day mean less the 30-day", () => {
  expect(heaterHours(MEANS)).toBeCloseTo(17.4, 6);
  expect(heaterHours({ ...MEANS, heat2_run_h: null })).toBeNull();
  expect(heaterHours(null)).toBeNull();
  expect(change(62.4, 60)).toBeCloseTo(2.4, 6);
  expect(change(null, 60)).toBeNull();
  expect(change(62.4, undefined)).toBeNull();
});

test("a sparkline holds the last 30 days, oldest first, today partial", () => {
  const record = dailyRecord();
  const series = sparkSeries(record, (day) => day.climate_starts);
  expect(series.values).toHaveLength(30);
  expect(series.values.at(-1)).toBe(40);
  expect(series.partial.at(-1)).toBe(true);
  expect(series.partial.slice(0, -1).every((partial) => !partial)).toBe(true);
});

test("drying refused by reason in words, the longest first", () => {
  expect(plain(refusedText({ cost: 466, too_cold: 5273, furnace: 0 })!)).toBe("the house is too cold to vent 88 min; costs more than the limit 8 min");
  expect(refusedText({})).toBeNull();
  expect(refusedText(null)).toBeNull();
});

test("per-relay means cover the last 7 or 30 complete days with a relay record; repaired runs add up over the days shown", () => {
  const record = dailyRecord();
  // fan1 is the third relay: starts 2 + back % 3 over the complete days back 1 to 7.
  const back = [1, 2, 3, 4, 5, 6, 7];
  expect(relayMean(record.days, "fan1", "starts", 7)).toBeCloseTo(back.reduce((sum, b) => sum + 2 + (b % 3), 0) / 7, 6);
  expect(relayMean(record.days, "fan1", "run_h", 30)).toBeCloseTo(1.5, 6);
  expect(relayMean(record.days.map((day) => ({ ...day, relays: null })), "fan1", "starts", 7)).toBeNull();
  expect(repairedRuns(record.days, "fan1")).toBe(2);
  expect(repairedRuns(record.days, "heat1")).toBe(0);
  expect(repairedRuns([], "fan1")).toBeNull();
});

test("the counter check in words: agree, the differences per relay, or nothing to compare; 7 or 30 days", () => {
  const [today, yesterday, older] = RELAY_CHECK.days;
  expect(checkResult(today)).toEqual({ status: "agree", lines: [] });
  expect(checkResult(yesterday).status).toBe("differ");
  expect(checkResult(yesterday).lines.map(plain)).toEqual(["Fan 1: the controller counted 3 fewer starts and 5 min less run time than the record"]);
  expect(checkResult({ ...yesterday, relays: [{ ...yesterday.relays[0], starts_difference: 1, run_s_difference: null }] }).lines)
    .toEqual(["Fan 1: the controller counted 1 more start than the record"]);
  expect(checkResult(older)).toEqual({ status: "none", lines: [] });
  expect([7, 30, 90, 365].map((days) => checkDays(days as 7))).toEqual([7, 30, 30, 30]);
});
