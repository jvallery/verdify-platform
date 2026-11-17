// SPDX-License-Identifier: MIT
/**
 * Zones' comparison (screens.md section 7.2, parity R-14): every probe against the one house band, and the spread
 * between the warmest and the coolest probe, bucket by bucket. Pure: the route reads, the charts draw.
 */
import { ZONES, zoneKey, type Zone, type ZoneMetric } from "./zone-source";
import type { MetricDef, Series, SeriesColumns } from "./operator-api";

/** The zones with a probe of their own: center reads the house average, so it never counts toward the spread. */
export const PROBE_ZONES: readonly Zone[] = ZONES.filter((zone) => zone !== "center");
export const SPREAD_KEYS: Readonly<Record<ZoneMetric, string>> = { temp: "derived.temp_spread", vpd: "derived.vpd_spread", rh: "derived.rh_spread" };
const SPREAD_WORDS: Readonly<Record<ZoneMetric, string>> = { temp: "Temperature spread", vpd: "VPD spread", rh: "RH spread" };

/** The spread's own metric: not an API-03 key, so it heads its own CSV column and never reaches API-04. */
export function spreadMetric(metric: ZoneMetric, unit: string): MetricDef {
  return {
    key: SPREAD_KEYS[metric], label: SPREAD_WORDS[metric], unit, group: "zones", provenance: "DERIVED", cadence_s: 60, retention_days: 365, daily: false,
    note: "The warmest probe less the coolest, in each bucket where at least two probes reported",
  };
}

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const spreads = new WeakMap<Series, Map<ZoneMetric, Series>>();
/**
 * The row's answer (every zone's key for one metric) as the spread between its highest and lowest probe per bucket; a
 * bucket where fewer than two probes reported stays a gap. One copy per answer.
 */
export function spreadSeries(row: Series | null | undefined, metric: ZoneMetric): Series | null {
  if (!row) return null;
  const byMetric = spreads.get(row) ?? new Map<ZoneMetric, Series>();
  spreads.set(row, byMetric);
  const kept = byMetric.get(metric);
  if (kept) return kept;
  const columns = PROBE_ZONES.flatMap((zone) => row.series[zoneKey(zone, metric)] ?? []);
  const avg = row.t.map((_, index) => {
    const values = columns.map((column) => column.avg[index]).filter(finite);
    return values.length < 2 ? null : Number((Math.max(...values) - Math.min(...values)).toFixed(3));
  });
  const spread: SeriesColumns = {
    avg, min: avg, max: avg, count: avg.map((value) => (value === null ? 0 : 1)), source: columns[0]?.source ?? "raw", retained_from: columns[0]?.retained_from ?? null, issued_at: null,
  };
  const series: Series = { ...row, series: { [SPREAD_KEYS[metric]]: spread } };
  byMetric.set(metric, series);
  return series;
}

/** The widest spread in the answer and when: the status line's number. Null when no bucket had two probes. */
export function widestSpread(series: Series | null | undefined, metric: ZoneMetric): { value: number; at: number } | null {
  const column = series?.series[SPREAD_KEYS[metric]];
  if (!series || !column) return null;
  let best: { value: number; at: number } | null = null;
  column.avg.forEach((value, index) => {
    if (finite(value) && (!best || value > best.value)) best = { value, at: series.t[index] };
  });
  return best;
}
