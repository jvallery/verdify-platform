// SPDX-License-Identifier: MIT
// What the Law and equipment, Drying and Controller presets draw (screens.md section 7.1, K-13, K-14, S-08), and the
// gaps in the record (R-15): the law's requests in the rules' order with the latches folded, the drying decision with
// its refusals, the price against the limit, the drying line, the hardware budget's lines and the listed gaps.
import { expect, test } from "vitest";
import {
  CONTROLLER_PANELS, DRYING_LINE_KEY, LAW_GROUPS, controllerCharts, costChart, dryingOffset, dryingRow, lawRows, recordGaps, refusedBreakdown, refusedWords,
  withDryingLine,
} from "./graph-law";
import type { ControllerHealth, LawHistory, LawView, MetricDef, Series } from "./operator-api";

const T0 = Date.parse("2026-11-17T12:00:00Z") / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();
const RANGE = { from: T0, to: T0 + 3600 };
const interval = (start: number, end: number, state: string, reason: string | null = null) => ({ start: iso(T0 + start), end: iso(T0 + end), state, reason });

const HISTORY = {
  from: iso(T0), to: iso(T0 + 3600), first_record_at: iso(T0 - 86_400),
  lanes: [
    { key: "latch.h1", group: "latch", intervals: [interval(0, 600, "on")] },
    { key: "request.vent", group: "request", intervals: [interval(-600, 300, "on"), interval(300, 1200, "off"), interval(1200, 1500, "unknown")] },
    { key: "request.heat1", group: "request", intervals: [interval(0, 600, "on"), interval(600, 3600, "off")] },
  ],
  drying: [interval(0, 600, "running"), interval(600, 1500, "refused", "cost"), interval(1500, 1800, "refused", "outdoor_wetter"), interval(1800, 3000, "not_wanted"), interval(3000, 3300, "unknown")],
  outdoor_source: [], band_repaired: [],
  cost: { bucket_s: 900, t: [T0, T0 + 900, T0 + 1800, T0 + 2700], cost_kwh_per_kg: [0.5, 0.82, null, 0.6], limit_kwh_per_kg: [0.7, 0.7, 0.7, 0.7] },
  band: { bucket_s: 900, t: [T0, T0 + 900, T0 + 1800, T0 + 2700], temp_low_f: [60, 60, 60, 60], temp_high_f: [80, 80, 80, 80], vpd_low_kpa: [0.5, 0.52, null, 0.55], vpd_high_kpa: [1.2, 1.2, 1.2, 1.2] },
} as unknown as LawHistory;

test("the law's requests in the rules' order in the accent colour, then the latches folded under As reported; an unknown span is hatched", () => {
  const rows = lawRows(HISTORY, RANGE);
  expect(rows.map((row) => [row.key, row.label, row.token, row.group])).toEqual([
    ["request.heat1", "Electric heat", "--accent", "request"], ["request.vent", "Vent", "--accent", "request"], ["latch.h1", expect.any(String), "--text-2", "latch"],
  ]);
  // Clamped to the window; an off span is not drawn.
  expect(rows[1].spans).toEqual([{ start: T0, end: T0 + 300, state: "on" }, { start: T0 + 1200, end: T0 + 1500, state: "unknown", label: expect.any(String) }]);
  expect(LAW_GROUPS).toEqual([{ key: "request", label: "Asked for" }, { key: "latch", label: "As reported", collapsed: true }]);
});

test("the drying decision: running is on, refused carries its reason in words, not wanted is not drawn, unknown is hatched; the time refused by reason", () => {
  const row = dryingRow(HISTORY, RANGE);
  expect(row.spans.map((span) => [span.start - T0, span.end - T0, span.state])).toEqual([[0, 600, "on"], [600, 1500, "refused"], [1500, 1800, "refused"], [3000, 3300, "unknown"]]);
  expect(row.spans[1].label).toBe(refusedWords("cost"));
  expect(refusedWords("cost")).toMatch(/^Refused: /);
  expect(refusedWords(null)).toBe("Refused");
  expect(refusedBreakdown(HISTORY, RANGE)).toEqual([{ reason: "cost", seconds: 900 }, { reason: "outdoor_wetter", seconds: 300 }]);
});

test("the price of drying against the limit: one labelled line; a limit that changed draws the newest and says so; no price says why", () => {
  expect(costChart(HISTORY)).toMatchObject({ values: [0.5, 0.82, null, 0.6], thresholds: [{ value: 0.7, tone: "warn" }], note: null });
  expect(costChart(HISTORY).thresholds[0].label).toMatch(/^Limit 0\.70/);
  const changed = { ...HISTORY, cost: { ...HISTORY.cost, limit_kwh_per_kg: [0.7, 0.7, 0.8, 0.8] } } as LawHistory;
  expect(costChart(changed).thresholds[0].value).toBe(0.8);
  expect(costChart(changed).note).toMatch(/^The limit changed in this window, from 0\.70.* to 0\.80/);
  const unpriced = { ...HISTORY, cost: { ...HISTORY.cost, cost_kwh_per_kg: [null, null, null, null] } } as LawHistory;
  expect(costChart(unpriced).note).toMatch(/^No price was computed/);
});

test("the drying line: the band's low VPD edge at each bucket plus the law's offset; a bucket with no band is a gap; one copy per answer", () => {
  const law = { drying: { wanted_below_kpa: 0.55 }, band: { vpd_low_kpa: 0.5 } } as unknown as LawView;
  expect(dryingOffset(law)).toBe(0.05);
  expect(dryingOffset(null)).toBeNull();
  expect(dryingOffset({ drying: { wanted_below_kpa: null }, band: { vpd_low_kpa: 0.5 } } as unknown as LawView)).toBeNull();
  const panel = { from: iso(T0), to: iso(T0 + 3600), bucket_s: 300, watermark: null, server_time: iso(T0), gaps: [], t: [T0, T0 + 600, T0 + 1200, T0 + 1800, T0 + 3000], series: {} } as unknown as Series;
  const merged = withDryingLine(panel, HISTORY, 0.05)!;
  expect(merged.series[DRYING_LINE_KEY].avg).toEqual([0.55, 0.55, 0.57, null, 0.6]);
  expect(withDryingLine(panel, HISTORY, 0.05)).toBe(merged);
  expect(withDryingLine(panel, HISTORY, null)).toBe(panel);
});

test("the controller's charts: only the keys the registry lists, by its labels and notes, against API-35's limits; none while it fails", () => {
  const metric = (key: string, label: string, note: string | null = null) => ({ key, label, note, unit: "kB", group: "controller" }) as MetricDef;
  const catalog = [metric("diagnostics.heap_minute_low_kb", "Lowest free heap in the minute", "Sampled every second"), metric("diagnostics.wifi_disconnects", "Wi-Fi disconnects")];
  const limits = { heap_warning_kb: 30, heap_critical_kb: 20, largest_block_kb: 12, loop_worst_ms: 50, nvs_write_ms: 40, stack_free_b: 1024 } as ControllerHealth["limits"];
  const charts = controllerCharts(catalog, limits);
  expect(charts.map((chart) => [chart.key, chart.title, chart.note, chart.thresholds.map((line) => [line.value, line.tone])])).toEqual([
    ["diagnostics.heap_minute_low_kb", "Lowest free heap in the minute", "Sampled every second", [[30, "warn"], [20, "critical"]]],
    ["diagnostics.wifi_disconnects", "Wi-Fi disconnects", null, []],
  ]);
  expect(charts[0].thresholds.map((line) => line.label)).toEqual(["Warning 30\u00a0kB", "Critical 20\u00a0kB"]);
  expect(controllerCharts(catalog, null)[0].thresholds).toEqual([]);
  expect(CONTROLLER_PANELS.map((panel) => panel.key)).toContain("diagnostics.heap_largest_block_minute_low_kb");
});

test("gaps in the record: runs of empty buckets at least 5 minutes and two buckets long, with the outage recorded over them; an open gap reaches the end", () => {
  const t = Array.from({ length: 12 }, (_, index) => T0 + index * 300);
  const avg = [1, null, 1, null, null, 1, 1, 1, 1, 1, null, null];
  const series = { bucket_s: 300, t, series: { k: { avg } }, gaps: [{ start: iso(T0 + 800), end: iso(T0 + 1300), reason: "ingestor_restart" }] } as unknown as Series;
  const measured = { from: T0, to: T0 + 3600 };
  expect(recordGaps(series, "k", measured)).toEqual([
    { from: T0 + 900, to: T0 + 1500, reason: "ingestor_restart" },
    { from: T0 + 3000, to: T0 + 3600, reason: null },
  ]);
  expect(recordGaps(series, "missing", measured)).toEqual([]);
  expect(recordGaps(null, "k", measured)).toEqual([]);
});
