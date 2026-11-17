// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import type { DataContinuity, Delivery } from "../../lib/operator-api";
import { continuityBars, continuityDays, deliveryHours, oldestWords, probeAge, probeWords, readbackWords, statusTotals, tableWords } from "./data-words";

const NOW = "2026-11-02T17:42:00Z";
const NBSP = String.fromCharCode(0xa0);
const plain = (value: string) => value.replaceAll(NBSP, " ");

test("tables and probes read in words; one this build does not know is null, for the page to show raw", () => {
  expect([tableWords("climate"), tableWords("equipment_state"), tableWords("brand_new")]).toEqual(["Climate readings", "Relay changes", null]);
  expect([probeWords("climate.temp_north"), probeWords("climate.rh_north"), probeWords("climate.temp_case"), probeWords("climate.bus_7")]).toEqual([
    "North temperature", "North humidity", "Controller case temperature", null,
  ]);
});

test("a probe's age reads ago, not seen in 2 h at 7200 s, or never seen", () => {
  expect([plain(probeAge(20)), probeAge(7200), probeAge(9000), probeAge(null)]).toEqual(["20 s ago", "not seen in 2 h", "not seen in 2 h", "never seen"]);
});

test("the ranges come from the URL with their defaults", () => {
  expect([continuityDays("7"), continuityDays("30"), continuityDays("2"), continuityDays(null)]).toEqual([7, 30, 1, 1]);
  expect([deliveryHours("168"), deliveryHours("24"), deliveryHours(null)]).toEqual([168, 24, 24]);
});

test("continuity bars per day, today labelled so far", () => {
  const data = fixture("in-band", { now: NOW })["API-36"] as DataContinuity;
  expect(continuityBars(data.by_day, "2026-11-02")).toEqual({
    outage: [{ date: "2026-11-01", value: 574 }, { date: "2026-11-02", value: 131, partial: true, note: "so far" }],
    replayed: [{ date: "2026-11-01", value: 0 }, { date: "2026-11-02", value: 150, partial: true, note: "so far" }],
  });
});

test("delivery totals by status across sources, largest first, with shares; the oldest and the readback pass in words", () => {
  const data = fixture("delivery-failing", { now: NOW })["API-37"] as Delivery;
  const totals = statusTotals(data.by_status);
  expect(totals.map((row) => [row.status, row.count])).toEqual([["observed", 702], ["confirmed", 288], ["failed", 151], ["cancelled", 3], ["pending", 1], ["superseded", 1]]);
  expect(totals.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(100);
  expect([plain(oldestWords(1840)), oldestWords(0), oldestWords(null)]).toEqual(["Waiting 30 min", "Nothing is waiting", "Not known"]);
  expect([readbackWords(data.readback_pass), readbackWords({ at: null, stored: null, of: null })]).toEqual(["2 changed of 102 read back", "not reported"]);
});
