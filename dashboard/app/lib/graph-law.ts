// SPDX-License-Identifier: MIT
/**
 * What the Law and equipment, Drying and Controller presets of Explore draw beside their API-04 panels (screens.md
 * section 7.1, parity K-13, K-14, S-08), shaped for the shared chart kinds: the law's requests over time from API-31 as
 * state lanes, the drying decision as one lane with its refused spans, the price of drying against the owner's limit,
 * the drying line on the VPD panel, and the controller's hardware budget against API-35's limits. Pure: the route reads,
 * the charts draw, and the tests check it without a page.
 */
import type { LaneSpanState, StateLaneGroup, StateLaneRow, StateLaneSpan } from "../charts/state-lanes";
import type { ThresholdLine } from "../charts/threshold-series";
import { epochOf } from "../charts/time-axis";
import type { XRange } from "../charts/types";
import { formatValue } from "./format";
import type { ControllerHealth, LawHistory, LawView, MetricDef, Series, SeriesColumns } from "./operator-api";
import { words } from "./words";

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Interval lists as lane spans inside `range`: each clamped to it, an empty one dropped, an "off" one not drawn. `state`
 * maps an interval to its lane state and `label` gives the words its tooltip and table read.
 */
export function spansOf<T extends { start: string; end: string }>(intervals: readonly T[], range: XRange, state: (interval: T) => LaneSpanState, label?: (interval: T) => string | undefined): StateLaneSpan[] {
  const out: StateLaneSpan[] = [];
  for (const interval of intervals) {
    const start = epochOf(interval.start), end = epochOf(interval.end);
    if (start === null || end === null) continue;
    const from = Math.max(start, range.from), to = Math.min(end, range.to);
    const kind = state(interval);
    if (to <= from || kind === "off") continue;
    const words = label?.(interval);
    out.push({ start: from, end: to, state: kind, ...(words ? { label: words } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- the law's requests
/** The law's requests in the order of its rules, each named by what it asks for. */
const REQUESTS: readonly (readonly [string, string])[] = [
  ["request.heat1", "Electric heat"], ["request.heat2", "Gas furnace"], ["request.cooling", "Cooling"], ["request.vent", "Vent"],
  ["request.fan1", "At least one fan"], ["request.fan2", "Both fans"], ["request.fog", "Fogger"], ["request.mist", "Misters"],
  ["request.drying", "Drying"], ["request.hot", "Hot limit"], ["request.cold", "Cold limit"],
];
/** The rows' groups: what the law asked for, then its latches, folded, under the record's own heading (words.md). */
export const LAW_GROUPS: readonly StateLaneGroup[] = [
  { key: "request", label: "Asked for" },
  { key: "latch", label: "As reported", collapsed: true },
];
/** A lane interval's tooltip words: "not reported" for a span with no law record. */
const laneLabel = (interval: { state: string }) => (interval.state === "unknown" ? words("relay_state", "unknown").toLowerCase() : undefined);
const laneState = (interval: { state: string }): LaneSpanState => (interval.state === "on" ? "on" : interval.state === "unknown" ? "unknown" : "off");

/**
 * What the law asked for (K-13): one row per request in the rules' order, in `--accent` (design-system section 2.3), then
 * the latches in a folded group, each by the record's words. A lane API-31 does not send is left out; an unknown span (no
 * law record for more than 180 s) is hatched.
 */
export function lawRows(history: LawHistory, range: XRange): StateLaneRow[] {
  const lanes = new Map(history.lanes.map((lane) => [lane.key, lane]));
  const requests = REQUESTS.flatMap(([key, label]) => {
    const lane = lanes.get(key);
    return lane ? [{ key, label, token: "--accent", group: "request", spans: spansOf(lane.intervals, range, laneState, laneLabel) }] : [];
  });
  const latches = history.lanes.filter((lane) => lane.group === "latch").map((lane) => ({
    key: lane.key, label: upper(words("law_lane", lane.key)), token: "--text-2", group: "latch", spans: spansOf(lane.intervals, range, laneState, laneLabel),
  }));
  return [...requests, ...latches];
}

// ---------------------------------------------------------------------------------------------------- drying
/** "Refused: costs more than the limit": a refused span's words, from the law's reason. */
export function refusedWords(reason: string | null | undefined): string {
  return reason ? `Refused: ${words("drying_refusal", reason)}` : "Refused";
}
/**
 * The drying decision over time (K-14): one lane, drying while it ran, a `--warn` hatch with its reason while it was
 * wanted and refused, a `--text-3` hatch where the law did not report, nothing while the house was dry enough.
 */
export function dryingRow(history: LawHistory, range: XRange): StateLaneRow {
  const spans = spansOf(history.drying, range,
    (interval) => (interval.state === "running" ? "on" : interval.state === "refused" ? "refused" : interval.state === "unknown" ? "unknown" : "off"),
    (interval) => (interval.state === "refused" ? refusedWords(interval.reason) : interval.state === "running" ? upper(words("drying_state", "running")) : laneLabel(interval)));
  return { key: "drying", label: "Drying", token: "--accent", spans };
}
/** Seconds refused in the window, by reason, the most first: the words under the decision lane. */
export function refusedBreakdown(history: LawHistory, range: XRange): { reason: string; seconds: number }[] {
  const totals = new Map<string, number>();
  for (const span of spansOf(history.drying, range, (interval) => (interval.state === "refused" ? "refused" : "off"), (interval) => interval.reason ?? "")) {
    const reason = span.label ?? "";
    totals.set(reason, (totals.get(reason) ?? 0) + span.end - span.start);
  }
  return [...totals].map(([reason, seconds]) => ({ reason, seconds })).sort((a, b) => b.seconds - a.seconds);
}

export type CostChart = {
  readonly t: readonly number[];
  readonly values: readonly (number | null)[];
  readonly thresholds: readonly ThresholdLine[];
  /** Said under the chart: the limit changed in the window, or no price was computed. */
  readonly note: string | null;
};
const KWH_KG = "kWh/kg";
/**
 * The price of drying against the limit (K-14): the controller's price per bucket as a line, the owner's limit as a
 * labelled line. The shared threshold kind draws one value, so a limit that changed inside the window draws its newest
 * value and the note says from what it changed.
 */
export function costChart(history: LawHistory): CostChart {
  const { t, cost_kwh_per_kg: values, limit_kwh_per_kg: limits } = history.cost;
  const known = limits.filter((value): value is number => value !== null && Number.isFinite(value));
  const newest = known.at(-1);
  const changed = known.some((value) => value !== newest);
  const thresholds: ThresholdLine[] = newest === undefined ? [] : [{ value: newest, label: `Limit ${formatValue(newest, KWH_KG)}`, tone: "warn" }];
  const priced = values.some((value) => value !== null);
  const note = changed ? `The limit changed in this window, from ${formatValue(known[0], KWH_KG)} to ${formatValue(newest, KWH_KG)}; the line shows the newest`
    : !priced ? "No price was computed in this window: drying was not wanted, or the law did not report" : null;
  return { t, values, thresholds, note };
}

/** The drying line's key: no API-03 metric, so it heads its own CSV column and legend entry and never reaches API-04. */
export const DRYING_LINE_KEY = "derived.drying_line_kpa";
export const DRYING_LINE_METRIC: MetricDef = {
  key: DRYING_LINE_KEY, label: "Drying line", unit: "kPa", group: "law", provenance: "DERIVED", cadence_s: 60, retention_days: 31, daily: false,
  note: "Drying is wanted while VPD is under this line: the band's low edge plus the law's drying offset",
};
/**
 * The law's drying offset over the band's low VPD edge, from API-30 now: where drying is wanted (`wanted_below_kpa`)
 * less the band in force's low edge. Null while either is not reported.
 */
export function dryingOffset(law: LawView | null | undefined): number | null {
  const wanted = law?.drying.wanted_below_kpa, low = law?.band.vpd_low_kpa;
  return typeof wanted === "number" && typeof low === "number" ? Number((wanted - low).toFixed(3)) : null;
}
const lastAtOrBefore = (sorted: readonly number[], x: number) => {
  let low = 0, high = sorted.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] <= x) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
};
const drawn = new WeakMap<Series, WeakMap<LawHistory, Map<number, Series>>>();
/**
 * The VPD panel's answer with the drying line beside it (K-14): on each of the panel's buckets, the band's low VPD edge
 * that API-31 recorded at or before it plus the offset; a bucket with no band stays a gap. One copy per pair of answers
 * and offset, so a chart that has not changed never redraws.
 */
export function withDryingLine(panel: Series | null, history: LawHistory | null, offset: number | null): Series | null {
  if (!panel || !history || offset === null) return panel;
  const byHistory = drawn.get(panel) ?? new WeakMap<LawHistory, Map<number, Series>>();
  drawn.set(panel, byHistory);
  const byOffset = byHistory.get(history) ?? new Map<number, Series>();
  byHistory.set(history, byOffset);
  const kept = byOffset.get(offset);
  if (kept) return kept;
  const { t, vpd_low_kpa: lows, bucket_s: bucket } = history.band;
  const avg = panel.t.map((start) => {
    const index = lastAtOrBefore(t, start);
    const low = index >= 0 && start - t[index] < bucket ? lows[index] : null;
    return low === null || low === undefined ? null : Number((low + offset).toFixed(3));
  });
  const columns: SeriesColumns = { avg, min: avg, max: avg, count: avg.map((value) => (value === null ? 0 : 1)), source: "raw", retained_from: null, issued_at: null };
  const merged: Series = { ...panel, series: { ...panel.series, [DRYING_LINE_KEY]: columns } };
  byOffset.set(offset, merged);
  return merged;
}

// ---------------------------------------------------------------------------------------------------- the controller
type Limits = ControllerHealth["limits"];
export type ControllerPanel = {
  /** The API-03 key. */
  readonly key: string;
  /** The chart's title when the registry gives no label. */
  readonly title: string;
  readonly unit: string;
  /** The hardware budget's lines from API-35, labelled. */
  readonly thresholds: (limits: Limits) => ThresholdLine[];
};
const line = (value: number, unit: string, tone: "warn" | "critical"): ThresholdLine => ({ value, label: `${tone === "warn" ? "Warning" : "Critical"} ${formatValue(value, unit)}`, tone });
/**
 * The Controller preset (screens.md section 7.1, S-08): free memory with its warning and critical limits, the largest
 * free block, loop time, storage writes, the loop's stack and Wi-Fi, each against the hardware budget API-35 serves.
 */
export const CONTROLLER_PANELS: readonly ControllerPanel[] = [
  { key: "diagnostics.heap_minute_low_kb", title: "Free memory, lowest in the minute", unit: "kB", thresholds: (limits) => [line(limits.heap_warning_kb, "kB", "warn"), line(limits.heap_critical_kb, "kB", "critical")] },
  { key: "diagnostics.heap_largest_block_minute_low_kb", title: "Largest free block, lowest in the minute", unit: "kB", thresholds: (limits) => [line(limits.largest_block_kb, "kB", "critical")] },
  { key: "diagnostics.loop_worst_ms", title: "Slowest control loop", unit: "ms", thresholds: (limits) => [line(limits.loop_worst_ms, "ms", "warn")] },
  { key: "diagnostics.nvs_write_worst_ms", title: "Slowest settings storage write", unit: "ms", thresholds: (limits) => [line(limits.nvs_write_ms, "ms", "warn")] },
  { key: "diagnostics.loop_stack_free_min_b", title: "Least free loop stack", unit: "B", thresholds: (limits) => [line(limits.stack_free_b, "B", "warn")] },
  { key: "diagnostics.wifi_disconnects", title: "Wi-Fi disconnects", unit: "count", thresholds: () => [] },
];
export type ControllerChart = {
  readonly key: string;
  readonly title: string;
  readonly unit: string;
  readonly note: string | null;
  readonly thresholds: readonly ThresholdLine[];
};
/** The controller charts the registry lists, by its labels and notes, with API-35's limits (none while it fails). */
export function controllerCharts(catalog: readonly MetricDef[], limits: Limits | null): ControllerChart[] {
  return CONTROLLER_PANELS.flatMap((panel) => {
    const metric = catalog.find((item) => item.key === panel.key);
    if (!metric) return [];
    return [{ key: panel.key, title: metric.label || panel.title, unit: metric.unit || panel.unit, note: metric.note ?? null, thresholds: limits ? panel.thresholds(limits) : [] }];
  });
}

// ---------------------------------------------------------------------------------------------------- gaps
export type RecordGap = { readonly from: number; readonly to: number; readonly reason: string | null };
/** A run of empty buckets is listed from this long: a single missing minute is not a gap worth a line. */
export const GAP_MIN_S = 5 * 60;
/**
 * The gaps in the record (parity R-15): runs of buckets inside `measured` where `key` has no value, at least 5 minutes
 * and two buckets long, each with the outage the ingestor recorded over it (`Series.gaps`), oldest first. A gap that
 * reaches the end of `measured` is still open.
 */
export function recordGaps(series: Series | null | undefined, key: string, measured: XRange | null): RecordGap[] {
  const column = series?.series[key];
  if (!series || !column || !measured) return [];
  const bucket = series.bucket_s;
  const out: RecordGap[] = [];
  let start: number | null = null, count = 0;
  const close = (end: number) => {
    if (start !== null && count >= 2 && end - start >= GAP_MIN_S) {
      const outage = (series.gaps ?? []).find((gap) => (epochOf(gap.start) ?? Infinity) < end && (epochOf(gap.end) ?? -Infinity) > start!);
      out.push({ from: start, to: end, reason: outage?.reason ?? null });
    }
    start = null; count = 0;
  };
  series.t.forEach((at, index) => {
    if (at < measured.from || at >= measured.to) return;
    const value = column.avg[index];
    if (value === null || value === undefined || !Number.isFinite(value)) {
      if (start === null) start = at;
      count++;
    } else close(at);
  });
  close(Math.min(measured.to, (series.t.at(-1) ?? measured.to) + bucket));
  return out;
}
