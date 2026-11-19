// SPDX-License-Identifier: MIT
// Zones' spread (screens.md section 7.2): the warmest probe less the coolest per bucket, center left out, a gap where
// fewer than two probes reported, and the widest spread with its time.
import { expect, test } from "vitest";
import { PROBE_ZONES, SPREAD_KEYS, spreadMetric, spreadSeries, widestSpread } from "./graph-zones";
import type { Series } from "./operator-api";

const column = (avg: (number | null)[]) => ({ avg, min: avg, max: avg, count: avg.map(() => 1), source: "raw", retained_from: null, issued_at: null });
const ROW = {
  from: "", to: "", bucket_s: 60, watermark: null, server_time: "", gaps: [], t: [100, 160, 220],
  series: {
    "climate.temp_north": column([70, 71, null]), "climate.temp_south": column([66, null, 68]), "climate.temp_east": column([68, null, null]),
    "climate.temp_west": column([null, null, null]), "climate.temp_avg": column([90, 90, 90]),
  },
} as unknown as Series;

test("the spread per bucket: highest probe less lowest, center (the house average) left out, a gap under two probes", () => {
  expect(PROBE_ZONES).not.toContain("center");
  const spread = spreadSeries(ROW, "temp")!;
  expect(Object.keys(spread.series)).toEqual([SPREAD_KEYS.temp]);
  expect(spread.series[SPREAD_KEYS.temp].avg).toEqual([4, null, null]);
  expect(spreadSeries(ROW, "temp")).toBe(spread);
  expect(spreadSeries(null, "temp")).toBeNull();
  expect(widestSpread(spread, "temp")).toEqual({ value: 4, at: 100 });
  expect(widestSpread(spreadSeries({ ...ROW, series: {} }, "temp"), "temp")).toBeNull();
  expect(spreadMetric("vpd", "kPa")).toMatchObject({ key: SPREAD_KEYS.vpd, label: "VPD spread", unit: "kPa", provenance: "DERIVED" });
});
