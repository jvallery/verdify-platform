// SPDX-License-Identifier: MIT
import { formatValue } from "../../lib/format";
import type { ControllerHealth, Metrics, Series } from "../../lib/operator-api";

/**
 * The controller's trends (screens section 10.2, row 6): small multiples of API-04 over 24 h or 7 d, each a measured
 * line against the hardware budget's labelled lines from API-35. Which keys exist is the metric registry's (API-03,
 * group `controller`): a key it does not list is not asked for. `TRENDS` is the fallback list, read only while the
 * registry cannot answer. A minute low reads each bucket's `min`, a worst time its `max`.
 */
export type TrendLine = { readonly value: number; readonly label: string; readonly tone: "warn" | "critical" };
type Limits = ControllerHealth["limits"];
export type TrendSpec = {
  readonly key: string;
  readonly title: string;
  readonly unit: string;
  readonly column: "min" | "max" | "avg";
  readonly lines: (limits: Limits) => TrendLine[];
};

const line = (value: number, unit: string, tone: "warn" | "critical"): TrendLine => ({ value, tone, label: `${tone === "warn" ? "Warning" : "Critical"} ${formatValue(value, unit)}` });

export const TRENDS: readonly TrendSpec[] = [
  { key: "diagnostics.heap_minute_low_kb", title: "Free memory, minute low", unit: "kB", column: "min",
    lines: (limits) => [line(limits.heap_warning_kb, "kB", "warn"), line(limits.heap_critical_kb, "kB", "critical")] },
  { key: "diagnostics.heap_largest_block_minute_low_kb", title: "Largest free block, minute low", unit: "kB", column: "min", lines: (limits) => [line(limits.largest_block_kb, "kB", "warn")] },
  { key: "diagnostics.loop_worst_ms", title: "Loop time, worst", unit: "ms", column: "max", lines: (limits) => [line(limits.loop_worst_ms, "ms", "warn")] },
  { key: "diagnostics.nvs_write_worst_ms", title: "Storage write time, worst", unit: "ms", column: "max", lines: (limits) => [line(limits.nvs_write_ms, "ms", "warn")] },
  { key: "diagnostics.rssi_dbm", title: "Wi-Fi signal", unit: "dBm", column: "avg", lines: () => [] },
];

export const TREND_RANGES = [{ id: "24h", label: "24 h", seconds: 86_400 }, { id: "7d", label: "7 d", seconds: 7 * 86_400 }] as const;
export type TrendRange = (typeof TREND_RANGES)[number];
/** `?trend=`: 7d, else the default 24h. */
export const trendRange = (value: string | null): TrendRange => TREND_RANGES.find((range) => range.id === value) ?? TREND_RANGES[0];

/**
 * The trends to draw: those whose key the registry lists, in `TRENDS` order; every fallback key while the registry
 * read has failed; none while it has not answered yet.
 */
export function trendSpecs(registry: Metrics | null | undefined, failed: boolean): TrendSpec[] {
  if (!registry) return failed ? [...TRENDS] : [];
  const listed = new Set(registry.items.map((item) => item.key));
  return TRENDS.filter((spec) => listed.has(spec.key));
}

export type TrendSeries = { readonly spec: TrendSpec; readonly t: readonly number[]; readonly values: readonly (number | null)[] };
/** Each trend's times and values from one API-04 answer; a key the answer lacks reads all null, a gap, never 0. */
export function trendSeries(series: Series, specs: readonly TrendSpec[]): TrendSeries[] {
  return specs.map((spec) => {
    const columns = series.series[spec.key];
    const values = columns ? (columns[spec.column] ?? columns.avg) : series.t.map(() => null);
    return { spec, t: series.t, values };
  });
}
