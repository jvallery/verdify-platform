// SPDX-License-Identifier: MIT
import type { Series } from "./operator-api";

/** A chart bucket is an interval average, not an instantaneous sensor reading. Never turn null into zero. */
export function latestHydroInterval(series: Series | null, key: string): { value: number; at: number } | null {
  const values = series?.series[key]?.avg;
  if (!series || !values) return null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    const at = series.t[index];
    if (typeof value === "number" && Number.isFinite(value) && Number.isFinite(at)) return { value, at };
  }
  return null;
}

/**
 * The probe polls every five minutes; empty finer buckets between two nearby
 * samples are not outages. Remove only those empty buckets from the plot's
 * time axis. No values are interpolated, and recorded outages or gaps over ten
 * minutes retain their nulls. The CSV/table still contain only measured values.
 */
export function hydroPlotSeries(series: Series | null, key: string): Series | null {
  const columns = series?.series[key];
  if (!series || !columns) return series;
  const kept: number[] = [];
  for (let index = 0; index < series.t.length;) {
    if (columns.avg[index] !== null && columns.avg[index] !== undefined) { kept.push(index++); continue; }
    const first = index;
    while (index < series.t.length && (columns.avg[index] === null || columns.avg[index] === undefined)) index++;
    const from = series.t[first - 1], to = series.t[index];
    const outage = (series.gaps ?? []).some((gap) => Date.parse(gap.start) / 1000 < to && Date.parse(gap.end) / 1000 > from);
    const connect = first > 0 && index < series.t.length && to - from <= 600 && !outage;
    if (!connect) for (let missing = first; missing < index; missing++) kept.push(missing);
  }
  return { ...series, t: kept.map((index) => series.t[index]), series: {
    [key]: { ...columns, avg: kept.map((i) => columns.avg[i]), min: kept.map((i) => columns.min[i]), max: kept.map((i) => columns.max[i]), count: kept.map((i) => columns.count[i]),
      ...(columns.reason ? { reason: kept.map((i) => columns.reason![i]) } : {}),
    },
  } };
}

// ---------------------------------------------------------------------------------------------------- the reservoir now
/**
 * The three reservoir channels the probe measures (H-01, `climate.hydro_*`). The meter runs on mains power and reports no battery, so no
 * battery channel is read or charted (H-05); TDS and ORP are not measured either.
 */
export const RESERVOIR_METRICS = ["climate.hydro_ph", "climate.hydro_ec_us_cm", "climate.hydro_water_temp_f"] as const;
export const RESERVOIR_READINGS = [
  { key: "ph", label: "pH", unit: "pH" },
  { key: "ec_us_cm", label: "Conductivity", unit: "µS/cm" },
  { key: "water_temp_f", label: "Water temperature", unit: "°F" },
] as const;

type Reading = { readonly value: number | null; readonly observed_at: string | null; readonly reason?: string | null };
export type ReservoirNow = { readonly ph: Reading; readonly ec_us_cm: Reading; readonly water_temp_f: Reading; readonly stale_after_s: number };

/**
 * The probe's age (H-04): seconds since its newest reading of any channel at `now` (epoch ms), and whether that is past
 * the API's `stale_after_s`. Null age when no channel has a time.
 */
export function probeAge(hydro: ReservoirNow | null | undefined, now: number): { readonly at: string | null; readonly age_s: number | null; readonly stale: boolean } {
  const times = RESERVOIR_READINGS.map(({ key }) => hydro?.[key]?.observed_at ?? null).filter((at): at is string => at !== null && Number.isFinite(Date.parse(at)));
  if (!hydro || !times.length) return { at: null, age_s: null, stale: true };
  const at = times.reduce((newest, time) => (Date.parse(time) > Date.parse(newest) ? time : newest));
  const age = Math.max(0, Math.floor((now - Date.parse(at)) / 1000));
  return { at, age_s: age, stale: age > hydro.stale_after_s };
}
