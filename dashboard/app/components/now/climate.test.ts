// SPDX-License-Identifier: MIT
// What Now's hero, Today and the probes draw from the climate series and the daily record (dashboard v2 screens §1):
// today's low and high from local midnight, the probes' last 24 h with their gaps, the case probe's VPD from its
// temperature and RH, and time in band today and yesterday with last night; a gap stays a gap, never 0.
import { expect, test } from "vitest";
import { answer, buildWorld } from "../../../e2e/fixtures/index.mjs";
import { parseSeries, type DailyRecord, type Series } from "../../lib/operator-api";
import {
  CASE_KEYS, DAY_KEYS, DAY_POINTS, DAY_WINDOW_S, HOUSE_KEYS, OUTDOOR_KEY, PROBE_NOW_KEYS, caseVpdSince, inBand, newestBucket, nightWords, percentText,
  probeVpdKey, rangeSince, readingsAsOf, todayStartS, valuesSince, vpdFrom,
} from "./climate";

const NOW = Date.parse("2026-11-02T17:42:00Z");
const series = (names: string | string[], metric: readonly string[], from: string, to: string, points: number): Series => {
  const query = new URLSearchParams([...metric.map((key) => ["metric", key]), ["from", from], ["to", to], ["points", String(points)]]);
  return parseSeries(answer(buildWorld(names, { now: NOW }), { method: "GET", url: `/v1/series?${query}` }).body)!;
};
const day = (names: string | string[] = "in-band") => series(names, DAY_KEYS, new Date(NOW - DAY_WINDOW_S * 1000).toISOString(), new Date(NOW).toISOString(), DAY_POINTS);

test("the reads: the day read's seven keys and the probes' eight, within API-04's eight; no zone band key and no RH on the day read", () => {
  expect(DAY_KEYS).toEqual([HOUSE_KEYS.temp, HOUSE_KEYS.vpd, OUTDOOR_KEY, "climate.vpd_north", "climate.vpd_east", "climate.vpd_south", "climate.vpd_west"]);
  expect(PROBE_NOW_KEYS).toHaveLength(8);
  expect(PROBE_NOW_KEYS).toContain("climate.temp_west");
  expect(CASE_KEYS).toEqual(["climate.temp_case", "climate.rh_case"]);
  expect(day().bucket_s).toBe(900);
  // 00:00 MST on Nov 2 is 07:00Z.
  expect(todayStartS(NOW)).toBe(Date.parse("2026-11-02T07:00:00Z") / 1000);
});

test("today's low and high: the lowest min and highest max of the buckets from local midnight, never yesterday's; none reads null", () => {
  const read = day();
  const since = todayStartS(NOW);
  const range = rangeSince(read, HOUSE_KEYS.temp, since)!;
  const starts = read.t.map((at, index) => ({ at, index })).filter(({ at }) => at >= since);
  const mins = starts.map(({ index }) => read.series[HOUSE_KEYS.temp].min[index]).filter((value): value is number => value !== null);
  expect(range.low).toBe(Math.min(...mins));
  expect(range.high).toBeGreaterThan(range.low);
  expect(rangeSince(read, HOUSE_KEYS.temp, Date.parse("2026-11-03T07:00:00Z") / 1000)).toBeNull();
  expect(rangeSince(read, "climate.nothing", since)).toBeNull();
  expect(rangeSince(null, HOUSE_KEYS.temp, since)).toBeNull();
});

test("a probe's last 24 h keeps its gaps: south's probe out reads null for its last 20 minutes", () => {
  const out = day("south-probe-out");
  const from = Date.parse(out.to) / 1000 - 24 * 3600;
  const values = valuesSince(out, probeVpdKey("south"), from);
  expect(values.length).toBeGreaterThanOrEqual(96);
  expect(values.at(-1)).toBeNull();
  expect(values.slice(0, 80).every((value) => typeof value === "number")).toBe(true);
});

test("the case probe's VPD from its temperature and RH (Tetens over the leaf at air temperature); a missing input reads null", () => {
  // 77 °F is 25 °C: saturation 3.17 kPa, so 50% RH leaves 1.58 kPa.
  expect(vpdFrom(77, 50)).toBeCloseTo(1.58, 2);
  expect(vpdFrom(68, 100)).toBe(0);
  expect([vpdFrom(null, 50), vpdFrom(77, null)]).toEqual([null, null]);
  // An RH over 100% (a wet probe) clamps: saturated air has no deficit.
  expect(vpdFrom(77, 140)).toBe(0);
  const read: Series = {
    from: "2026-11-02T16:00:00Z", to: "2026-11-02T17:00:00Z", server_time: "2026-11-02T17:00:30Z", bucket_s: 1800, t: [Date.parse("2026-11-02T16:00:00Z") / 1000, Date.parse("2026-11-02T16:30:00Z") / 1000],
    series: {
      "climate.temp_case": { avg: [77, 80], min: [76, 79], max: [78, 81] },
      "climate.rh_case": { avg: [50, null], min: [49, null], max: [51, null] },
    },
  } as unknown as Series;
  const values = caseVpdSince(read, 0);
  expect(values[0]).toBeCloseTo(1.58, 2);
  expect(values[1]).toBeNull();
  expect(newestBucket(read, "climate.temp_case")).toEqual({ value: 80, end: Date.parse("2026-11-02T17:00:00Z") / 1000 });
  expect(newestBucket(read, "climate.rh_case")?.value).toBe(50);
  expect(newestBucket(null, "climate.rh_case")).toBeNull();
});

const record = (days: { date: string; both_pct: number | null; night_dried?: boolean | null; night_dryout_min?: number | null }[]) =>
  ({ days: days.map((row) => ({ date: row.date, complete: true, band: { both_pct: row.both_pct, night_dried: row.night_dried ?? null, night_dryout_min: row.night_dryout_min ?? null } })) }) as unknown as Pick<DailyRecord, "days">;

test("time in band today and yesterday from the daily record's both_pct, and last night from today's row; a day with no row reads null", () => {
  const read = record([{ date: "2026-11-01", both_pct: 88.4 }, { date: "2026-11-02", both_pct: 91.6, night_dried: true, night_dryout_min: 42 }]);
  const band = inBand(read, "2026-11-02");
  expect(band).toEqual({ today: 91.6, yesterday: 88.4, nightDried: true, nightDryoutMin: 42 });
  expect([percentText(band.today), percentText(null)]).toEqual(["92%", "—"]);
  expect(nightWords(band)).toBe("Last night dried out for 42 min");
  expect(nightWords({ nightDried: true, nightDryoutMin: 0 })).toBe("Last night dried out");
  expect(nightWords({ nightDried: false, nightDryoutMin: null })).toBe("Last night did not dry out");
  expect(nightWords(inBand(read, "2026-11-04"))).toBeNull();
  expect(inBand(null, "2026-11-02")).toEqual({ today: null, yesterday: null, nightDried: null, nightDryoutMin: null });
});

test("muted gauges say when their numbers were read: the oldest time among the readings that have a value", () => {
  expect(readingsAsOf([{ value: 70, observed_at: "2026-11-02T17:30:00Z" }, { value: 0.9, observed_at: "2026-11-02T17:28:00Z" }])).toBe("2026-11-02T17:28:00Z");
  expect(readingsAsOf([{ value: null, observed_at: "2026-11-02T17:10:00Z" }, { value: 0.9, observed_at: "2026-11-02T17:28:00Z" }])).toBe("2026-11-02T17:28:00Z");
  expect(readingsAsOf([{ value: null, observed_at: null }])).toBeNull();
});
