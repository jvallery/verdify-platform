// SPDX-License-Identifier: MIT
// Water → Soil's shaping (screens section 3.4, SO-01 to SO-03): the probe's keys from the registry, the newest reading
// and its time, reporting, silent and never, the moisture against the range, and the page's summary.
import { expect, test } from "vitest";
import type { Series } from "../../lib/operator-api";
import { SILENT_AFTER_S, moistureLine, newestReading, probeState, probeWords, rangeRelation, readingOlder, soilAnswer, soilKeys, soilSummary, soilValue, zoneLabel } from "./soil-model";

const NOW = 1_800_000_000;
const RANGE = { wilt_pct: 20, min_pct: 40, max_pct: 60 };
const series = (key: string, avg: (number | null)[], bucket = 600): Series => ({
  t: avg.map((_, index) => NOW - (avg.length - index) * bucket), bucket_s: bucket, gaps: [],
  series: { [key]: { avg, min: avg, max: avg, count: avg.map((value) => (value === null ? 0 : 1)) } },
}) as unknown as Series;

test("a zone's keys come from its probe column and only the keys the registry serves", () => {
  const registry = ["climate.soil_moisture_south_1", "climate.soil_ec_south_1"].map((key) => ({ key }));
  expect(soilKeys({ probe: "soil_moisture_south_1" }, registry)).toEqual({ moisture: "climate.soil_moisture_south_1", ec: "climate.soil_ec_south_1" });
  expect(soilKeys({ probe: "soil_moisture_west" }, registry)).toEqual({});
  expect(soilKeys({ probe: null }, registry)).toEqual({});
  expect(zoneLabel("south_1")).toBe("South Wall");
});

test("each SEN0604 card can read all six channels and leaves a retired target unbound", () => {
  const measures = ["moisture", "temp", "ec", "ph", "salinity", "tds"];
  const keys = (zone: string) => Object.fromEntries(measures.map((measure) => [measure, `climate.soil_${measure}_${zone}`]));
  const registry = [...Object.values(keys("south_1")), ...Object.values(keys("west"))].map((key) => ({ key }));
  expect(soilKeys({ probe: "soil_moisture_south_1" }, registry)).toEqual(keys("south_1"));
  expect(soilKeys({ probe: "soil_moisture_west" }, registry)).toEqual(keys("west"));
  expect(soilKeys({ probe: null }, registry)).toEqual({});
});

test("the newest reading is the last measured bucket, ending no later than now; a gap is skipped, never zero", () => {
  const key = "climate.soil_moisture_south_1";
  expect(newestReading(series(key, [41, 42, null]), key, NOW)).toEqual({ value: 42, at: NOW - 600 });
  expect(newestReading(series(key, [null, null]), key, NOW)).toBeNull();
  expect(newestReading(undefined, key, NOW)).toBeNull();
  expect(moistureLine(series(key, [41, null]), key)?.values).toEqual([41, null]);
});

test("a probe reports, falls silent after 2 hours, or has never reported; never is said so, not drawn as zero", () => {
  expect(probeState(NOW - 60, NOW, true, true)).toBe("reporting");
  expect(probeState(NOW - SILENT_AFTER_S - 1, NOW, true, true)).toBe("silent");
  expect(probeState(null, NOW, true, true)).toBe("never");
  expect(probeState(null, NOW, false, true)).toBe("unknown");
  expect(probeState(NOW, NOW, true, false)).toBe("never");
  const ago = (seconds: number) => `${seconds} s ago`;
  expect(probeWords("never", null, ago, NOW)).toBe("This probe has not reported in the last 7 days.");
  expect(probeWords("silent", NOW - 9000, ago, NOW)).toBe("Silent: the probe last answered 9000 s ago, over 2 hours ago.");
  expect(probeWords("reporting", NOW - 60, ago, NOW)).toBe("The probe last answered 60 s ago.");
});

test("moisture against the range: below wilt, below or above the range, in range; silent has no verdict; none reads No reading", () => {
  expect(rangeRelation(15, RANGE, "reporting")).toEqual({ status: "critical", text: "Below wilt by 5.0%" });
  expect(rangeRelation(35, RANGE, "reporting")).toEqual({ status: "warn", text: "5.0% below the range" });
  expect(rangeRelation(65, RANGE, "reporting")).toEqual({ status: "warn", text: "5.0% above the range" });
  expect(rangeRelation(50, RANGE, "reporting")).toEqual({ status: "ok", text: "In range" });
  expect(rangeRelation(50, RANGE, "silent")).toEqual({ status: "neutral", text: "Last reading in range" });
  expect(rangeRelation(null, RANGE, "never")).toEqual({ status: "neutral", text: "No reading" });
  expect(rangeRelation(0, RANGE, "never")).toEqual({ status: "neutral", text: "No reading" });
});

test("the summary counts zones, those reporting and those reporting outside their range", () => {
  const ok = { state: "reporting" as const, relation: { status: "ok" as const, text: "" } };
  const low = { state: "reporting" as const, relation: { status: "warn" as const, text: "" } };
  const quiet = { state: "never" as const, relation: { status: "neutral" as const, text: "" } };
  expect(soilSummary([ok, low, quiet])).toBe("3 probe zones · 2 reporting · 1 outside its range");
  expect(soilSummary([quiet])).toBe("1 probe zone · 0 reporting");
  expect(soilSummary([])).toBeNull();
});

test("Soil's answer first (design review A4), conductivity in whole µS/cm, and a reading's own age only when older than the card's", () => {
  const below = { status: "warn" as const, text: "3.6% below the range" };
  const ok = { status: "ok" as const, text: "in range" };
  expect(soilAnswer([{ zone: "south_1", state: "reporting", relation: below }, { zone: "south_2", state: "reporting", relation: below }, { zone: "west", state: "reporting", relation: below }]))
    .toBe("South Wall, South 2 and West Wall are below their moisture range.");
  expect(soilAnswer([{ zone: "south_1", state: "reporting", relation: ok }, { zone: "west", state: "reporting", relation: ok }])).toBe("Every zone is in its moisture range.");
  expect(soilAnswer([{ zone: "south_1", state: "silent", relation: below }, { zone: "west", state: "reporting", relation: ok }]))
    .toBe("West Wall is in range. South Wall has not answered for over 2 hours.");
  expect(soilAnswer([{ zone: "west", state: "unknown", relation: ok }])).toBeNull();
  expect(soilValue(853.4, "µS/cm")).toBe("853\u00a0µS/cm");
  expect(soilValue(1889.2, "µS/cm")).toBe("1,889\u00a0µS/cm");
  expect(readingOlder(NOW - 60, NOW)).toBe(false);
  expect(readingOlder(NOW - 3600, NOW)).toBe(true);
  expect(readingOlder(NOW, null)).toBe(false);
});
