// SPDX-License-Identifier: MIT
/**
 * What Now's hero, Today and Probes draw from the climate series (dashboard v2 screens §1), as plain functions the tests
 * check without a page:
 * - today's low and high of the house temperature and VPD, for the hero's two gauges;
 * - time in band today, yesterday and whether last night dried out, from the daily record (API-32);
 * - each probe's value and 24 h VPD, against the one house band; the case probe's VPD from its temperature and RH.
 *
 * Two API-04 reads serve them. The day read asks for the house temperature and VPD, the outdoor temperature and each wall
 * probe's VPD over the last 25 h in 15 min buckets: the buckets from local midnight give today's low and high (a
 * fall-back day is 25 h long), the last 24 h the charts and the sparklines. The case read asks for the case probe's
 * temperature and RH over the same window, apart, so a deployment that does not serve them leaves the rest whole.
 */
import { dateShift, formatValue, localDate, localDayStart } from "../../lib/format";
import type { DailyRecord, Reading, Series } from "../../lib/operator-api";
import type { Range } from "../data/band-bar";

export type ClimateKey = "temp" | "vpd";
/** The house keys the hero's gauges and Today's chart read. */
export const HOUSE_KEYS = { temp: "climate.temp_avg", vpd: "climate.vpd_avg", rh: "climate.rh_avg" } as const;
export const OUTDOOR_KEY = "climate.outdoor_temp_f";

/** The four wall probes and the case probe, in the order the block lists them. */
export type ProbeId = "north" | "east" | "south" | "west" | "case";
export const PROBES: readonly { readonly id: ProbeId; readonly name: string }[] = [
  { id: "north", name: "North wall" }, { id: "east", name: "East wall" }, { id: "south", name: "South wall" }, { id: "west", name: "West wall" },
  { id: "case", name: "Controller case" },
];
export const WALL_PROBES = PROBES.filter((probe) => probe.id !== "case");
export const probeTempKey = (id: ProbeId) => `climate.temp_${id}`;
export const probeVpdKey = (id: ProbeId) => `climate.vpd_${id}`;
export const CASE_KEYS = ["climate.temp_case", "climate.rh_case"] as const;
/** The probes' current read: the four wall probes' temperature and VPD (API-04's 8 keys). */
export const PROBE_NOW_KEYS: readonly string[] = WALL_PROBES.flatMap((probe) => [probeTempKey(probe.id), probeVpdKey(probe.id)]);
/** The day read's keys, within API-04's 8: the house temperature and VPD, outdoor, then each wall probe's VPD. */
export const DAY_KEYS: readonly string[] = [HOUSE_KEYS.temp, HOUSE_KEYS.vpd, OUTDOOR_KEY, ...WALL_PROBES.map((probe) => probeVpdKey(probe.id))];
/** The day read covers the last 25 h, so local midnight is inside it even on a 25 h day. */
export const DAY_WINDOW_S = 25 * 3600;
/** 15 min buckets over 25 h: at most 101 of them. */
export const DAY_POINTS = 101;
/** The charts and sparklines draw the last 24 h. */
export const SPARK_S = 24 * 3600;

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const epochS = (instant: string) => Date.parse(instant) / 1000;

/** The local midnight that starts the day of `clock` (epoch ms), in epoch seconds. */
export function todayStartS(clock: number): number {
  return epochS(localDayStart(localDate(new Date(clock).toISOString())));
}

/** The lowest `min` and highest `max` of `key` over the buckets that start at or after `since`: today's low and high. */
export function rangeSince(series: Series | null | undefined, key: string, since: number): Range | null {
  const column = series?.series[key];
  if (!series || !column) return null;
  let low = Number.POSITIVE_INFINITY, high = Number.NEGATIVE_INFINITY;
  series.t.forEach((start, index) => {
    if (start < since) return;
    const lo = column.min[index] ?? column.avg[index], hi = column.max[index] ?? column.avg[index];
    if (finite(lo)) low = Math.min(low, lo);
    if (finite(hi)) high = Math.max(high, hi);
  });
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null;
}

/** The bucket averages of `key` that start at or after `since`, oldest first, a gap kept as null. */
export function valuesSince(series: Series | null | undefined, key: string, since: number): (number | null)[] {
  const column = series?.series[key];
  if (!series || !column) return [];
  return series.t.flatMap((start, index) => (start >= since ? [finite(column.avg[index]) ? column.avg[index] : null] : []));
}

/** VPD (kPa) from air temperature (°F) and RH (%), by the Tetens saturation pressure; null without both. */
export function vpdFrom(tempF: number | null | undefined, rhPct: number | null | undefined): number | null {
  if (!finite(tempF) || !finite(rhPct)) return null;
  const c = (tempF - 32) * (5 / 9);
  const saturation = 0.6108 * Math.exp((17.27 * c) / (c + 237.3));
  return Math.max(0, saturation * (1 - Math.min(100, Math.max(0, rhPct)) / 100));
}

/** The case probe's VPD per bucket since `since`, from its temperature and RH buckets. */
export function caseVpdSince(series: Series | null | undefined, since: number): (number | null)[] {
  const temps = valuesSince(series, CASE_KEYS[0], since), rhs = valuesSince(series, CASE_KEYS[1], since);
  return temps.map((temp, index) => vpdFrom(temp, rhs[index] ?? null));
}

/** The newest bucket of `key` with a value, and when its bucket ends (epoch s); null with none. */
export function newestBucket(series: Series | null | undefined, key: string): { readonly value: number; readonly end: number } | null {
  const column = series?.series[key];
  if (!series || !column) return null;
  for (let index = series.t.length - 1; index >= 0; index--) {
    const value = column.avg[index];
    if (finite(value)) return { value, end: series.t[index] + series.bucket_s };
  }
  return null;
}

/** Time in band today so far, yesterday, and whether last night dried out (from API-32). */
export type InBand = {
  readonly today: number | null;
  readonly yesterday: number | null;
  /** Today's row: the night of 00:00–06:00 that opens it. Null until 06:00, or when unknown. */
  readonly nightDried: boolean | null;
  readonly nightDryoutMin: number | null;
};
/**
 * The record's `band.both_pct` for today and yesterday (both temperature and VPD inside the band), and today's
 * `night_dried`: a day's night is the 00:00–06:00 window its midnight opens, so last night is today's row.
 */
export function inBand(record: Pick<DailyRecord, "days"> | null | undefined, today: string): InBand {
  const day = (date: string) => record?.days.find((row) => row.date === date)?.band ?? null;
  const now = day(today), before = day(dateShift(today, -1));
  return {
    today: finite(now?.both_pct) ? now.both_pct : null,
    yesterday: finite(before?.both_pct) ? before.both_pct : null,
    nightDried: typeof now?.night_dried === "boolean" ? now.night_dried : null,
    nightDryoutMin: finite(now?.night_dryout_min) ? now.night_dryout_min : null,
  };
}
/** "96%": a share in whole percent; "—" when unknown. */
export const percentText = (value: number | null): string => (finite(value) ? `${Math.round(value)}%` : "—");
/** "Last night did not dry out", "Last night dried out for 40 min"; null while unknown. */
export function nightWords(band: Pick<InBand, "nightDried" | "nightDryoutMin">): string | null {
  if (band.nightDried === null) return null;
  if (!band.nightDried) return "Last night did not dry out";
  return finite(band.nightDryoutMin) && band.nightDryoutMin > 0 ? `Last night dried out for ${Math.round(band.nightDryoutMin)} min` : "Last night dried out";
}

/** The reading in its unit, or "—". */
export const readingText = (reading: Pick<Reading, "value">, unit: string): string => formatValue(finite(reading.value) ? reading.value : null, unit);

/** When the readings were read: the oldest time among those with a value, for "As of 10:28" over muted gauges. */
export function readingsAsOf(readings: readonly Pick<Reading, "value" | "observed_at">[]): string | null {
  const times = readings.filter((reading) => finite(reading.value)).map((reading) => reading.observed_at)
    .filter((at): at is string => typeof at === "string" && Number.isFinite(Date.parse(at)));
  return times.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}
