// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import type { ControllerHealth, Metrics, Series } from "../../lib/operator-api";
import { TRENDS, trendRange, trendSeries, trendSpecs } from "./trends";

const NOW = "2026-11-02T17:42:00Z";
const NBSP = String.fromCharCode(0xa0);
const answers = fixture("in-band", { now: NOW });

test("the trends are the registry's controller keys, in order; the fallback only while the registry has failed", () => {
  const registry = answers["API-03"] as Metrics;
  expect(trendSpecs(registry, false).map((spec) => spec.key)).toEqual([
    "diagnostics.heap_minute_low_kb", "diagnostics.heap_largest_block_minute_low_kb", "diagnostics.loop_worst_ms", "diagnostics.nvs_write_worst_ms",
  ]);
  expect(trendSpecs({ items: [...registry.items, { ...registry.items[0], key: "diagnostics.rssi_dbm" }] }, false).at(-1)?.title).toBe("Wi-Fi signal");
  expect(trendSpecs(null, false)).toEqual([]);
  expect(trendSpecs(null, true)).toEqual([...TRENDS]);
});

test("each trend's lines come from API-35's limits, labelled", () => {
  const limits = (answers["API-35"] as ControllerHealth).limits;
  expect(TRENDS.map((spec) => spec.lines(limits).map((line) => [line.value, line.label.replaceAll(NBSP, " "), line.tone]))).toEqual([
    [[25, "Warning 25 kB", "warn"], [15, "Critical 15 kB", "critical"]], [[16, "Warning 16 kB", "warn"]], [[250, "Warning 250.0 ms", "warn"]], [[200, "Warning 200.0 ms", "warn"]], [],
  ]);
  expect([trendRange("7d").seconds, trendRange(null).id, trendRange("30d").id]).toEqual([604_800, "24h", "24h"]);
});

test("a minute low reads each bucket's min, a worst time its max; a key the answer lacks is all gaps", () => {
  const series = { t: [1, 2], series: { "diagnostics.heap_minute_low_kb": { avg: [30, 31], min: [28, null], max: [32, 33], count: [1, 1] } } } as unknown as Series;
  const [memory, loop] = trendSeries(series, [TRENDS[0], TRENDS[2]]);
  expect(memory.values).toEqual([28, null]);
  expect(loop.values).toEqual([null, null]);
});
