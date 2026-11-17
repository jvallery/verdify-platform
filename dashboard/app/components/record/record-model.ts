// SPDX-License-Identifier: MIT
/**
 * Record's shaping (screens section 6): the window kept in the URL, the days a view shows, and the few figures the page
 * derives itself. Every mean and share the daily record serves (API-32 `means`, the `band` shares) is shown as served;
 * the page derives only what the API does not serve, each in one pure function here: the price paid for drying, the
 * irrigation water (crop water less wetting), the heater hours (electric plus gas), the per-relay means of starts and run
 * time, and the counter check's words.
 */
import type { PanelState } from "../panel";
import { dateShift, formatValue } from "../../lib/format";
import type { PanelRead } from "../../lib/queries";
import type { DailyRecord, RecordDay, RecordDrying, RecordMeans, RelayCheck } from "../../lib/operator-api";
import { words } from "../../lib/words";

// ---------------------------------------------------------------------------------------------------- the window
/** The windows every Record view offers (screens section 6), in days; 30 is the default. */
export const WINDOWS = [7, 30, 90, 365] as const;
export type WindowDays = (typeof WINDOWS)[number];
export const DEFAULT_WINDOW: WindowDays = 30;
/**
 * The days one read covers at the least: the 30 complete days a 30-day mean needs, plus today. Every window reads at
 * least this much, so the per-relay means and the 30-day sparklines have their days whatever the window.
 */
export const READ_DAYS = 31;

/** `?days=` as a window; a value that is not one of the four reads as the default. */
export function parseWindow(value: string | null | undefined): WindowDays {
  const days = Number(value);
  return (WINDOWS as readonly number[]).includes(days) && String(days) === value ? (days as WindowDays) : DEFAULT_WINDOW;
}

/** A Record view's path with the window, keeping any other parameter; the default window writes no `days`. */
export function windowHref(path: string, days: WindowDays, search = ""): string {
  const params = new URLSearchParams(search);
  if (days === DEFAULT_WINDOW) params.delete("days"); else params.set("days", String(days));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** API-32's parameters for a window ending `today`: at least `READ_DAYS` local days, `today` included. */
export function readParams(days: WindowDays, today: string): { from: string; to: string } {
  return { from: dateShift(today, -(Math.max(days, READ_DAYS) - 1)), to: today };
}

/** The last `days` days of the record, oldest first. */
export const windowDays = (record: DailyRecord, days: WindowDays): readonly RecordDay[] => record.days.slice(-days);

/** Today, still in progress: the record's last day, not complete. */
export const isSoFar = (day: RecordDay, record: DailyRecord): boolean => day.date === record.to && !day.complete;

/** True when the record holds anything for the day; a day with nothing is a gap. */
export function hasRecord(day: RecordDay): boolean {
  return day.complete || day.band !== null || day.relays !== null || day.climate_starts !== null || day.energy.kwh_partial !== null
    || day.gas.therms_est !== null || day.water.total_gal !== null || day.drying !== null;
}

/**
 * A Record block's state (design-system section 3) from its read: a skeleton until the first answer; the error with
 * Retry when nothing has answered; the last data muted as STALE when the newest read failed; empty when no day of the
 * window holds a record.
 */
export function recordState(read: Pick<PanelRead<unknown>, "data" | "failed" | "pending">, empty: boolean): PanelState {
  if (read.data === null) return read.pending ? "loading" : "error";
  if (read.failed) return "stale";
  return empty ? "empty" : "ready";
}

// ---------------------------------------------------------------------------------------------------- figures
/** Seconds as hours, or null. */
export const hoursOf = (seconds: number | null | undefined): number | null =>
  seconds === null || seconds === undefined || !Number.isFinite(seconds) ? null : seconds / 3600;

/** Run time in words (words.md section 5): minutes up to 90, hours above; "—" when unknown. */
export function runTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  return seconds <= 90 * 60 ? formatValue(seconds / 60, "min") : formatValue(seconds / 3600, "h");
}

/** The day's electricity as the table writes it: the metered 24-hour figure, "partial" under 70 % coverage, or "—". */
export function kwhText(day: RecordDay): string {
  if (day.energy.kwh !== null) return formatValue(day.energy.kwh, "kWh");
  return day.energy.kwh_partial !== null ? "partial" : "—";
}

/** A day's alerts in words: "1 critical, 2 warning", "None", or "—" when the record has none. */
export function alertsText(alerts: RecordDay["alerts"]): string {
  if (!alerts) return "—";
  const parts = [[alerts.critical, "critical"], [alerts.warning, "warning"], [alerts.info, "info"]].filter(([count]) => Number(count) > 0);
  return parts.length ? parts.map(([count, name]) => `${count} ${name}`).join(", ") : "None";
}

/** Irrigation water: the crop water less the wetting (misting and fog), never below 0; null when either is unknown. */
export function irrigationGal(water: RecordDay["water"]): number | null {
  if (water.crop_gal === null || water.wetting_gal === null) return null;
  return Math.max(0, water.crop_gal - water.wetting_gal);
}

/**
 * The price paid for drying, in kWh/kg: the heat spent over the water removed (Wh per g is kWh per kg). Unknown when
 * either is unknown, when no water was removed, or when a restart lost meter counts that day (both are then lower
 * bounds, so their ratio bounds nothing).
 */
export function pricePaid(drying: RecordDrying | null): number | null {
  if (!drying || drying.lower_bound === true || drying.heat_wh === null || drying.water_g === null || drying.water_g <= 0) return null;
  return drying.heat_wh / drying.water_g;
}

/** Heater hours a day: the served electric and gas means added; null unless both are known. */
export function heaterHours(means: RecordMeans | null): number | null {
  if (!means || means.heat1_run_h === null || means.heat2_run_h === null) return null;
  return means.heat1_run_h + means.heat2_run_h;
}

/** The 7-day mean less the 30-day mean; null when either is unknown. */
export function change(d7: number | null | undefined, d30: number | null | undefined): number | null {
  return d7 === null || d7 === undefined || d30 === null || d30 === undefined ? null : d7 - d30;
}

/** A sparkline's values for the last `count` days, oldest first, with today's marked partial. */
export function sparkSeries(record: DailyRecord, pick: (day: RecordDay) => number | null | undefined, count = 30) {
  const days = record.days.slice(-count);
  return { values: days.map((day) => pick(day) ?? null), partial: days.map((day) => !day.complete) };
}

/** Drying refused by reason, the longest first: "the house is too cold to vent 1.5 h; …"; null when none. */
export function refusedText(refused: RecordDrying["refused_s"]): string | null {
  if (!refused) return null;
  const parts = Object.entries(refused).filter(([, seconds]) => Number.isFinite(seconds) && seconds > 0).sort((a, b) => b[1] - a[1]);
  return parts.length ? parts.map(([reason, seconds]) => `${words("drying_refusal", reason)} ${runTime(seconds)}`).join("; ") : null;
}

// ---------------------------------------------------------------------------------------------------- relays
/** The six climate relays, then the misters and the drip lines (API-32 `relays`), in the order the views draw them. */
export const CLIMATE_RELAYS = ["heat1", "heat2", "fan1", "fan2", "vent", "fog"] as const;
export const WET_RELAYS = ["mister_center", "mister_south", "mister_west", "drip_wall", "drip_center"] as const;
/** Each relay's colour token (design-system section 2.3). */
export const RELAY_TOKENS: Readonly<Record<string, string>> = {
  heat1: "--eq-heat1", heat2: "--eq-heat2", fan1: "--eq-fan1", fan2: "--eq-fan2", vent: "--eq-vent", fog: "--eq-fog",
  mister_center: "--eq-mister", mister_south: "--eq-mister", mister_west: "--eq-mister", drip_wall: "--eq-water", drip_center: "--eq-water",
};
export const relayName = (equipment: string): string => words("equipment", equipment);

/**
 * One relay's mean per day over the last `count` complete days that carry a relay record: starts, or run time in
 * hours. The API serves no per-relay mean but heat 1's and heat 2's run hours, which the views take as served.
 */
export function relayMean(days: readonly RecordDay[], equipment: string, field: "starts" | "run_h", count: 7 | 30): number | null {
  const values = days.filter((day) => day.complete && day.relays !== null).slice(-count)
    .map((day) => day.relays?.[equipment]).filter((relay) => relay !== undefined)
    .map((relay) => (field === "starts" ? relay.starts : relay.run_s / 3600));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** A relay's repaired runs over the days shown; null when no day carries a relay record. */
export function repairedRuns(days: readonly RecordDay[], equipment: string): number | null {
  const counted = days.filter((day) => day.relays !== null);
  return counted.length ? counted.reduce((sum, day) => sum + (day.relays?.[equipment]?.repaired_runs ?? 0), 0) : null;
}

// ---------------------------------------------------------------------------------------------------- counter check
export type CheckDay = RelayCheck["days"][number];
export type CheckResult = { readonly status: "agree" | "differ" | "none"; readonly lines: readonly string[] };

/**
 * One day of the counter check (API-33) in words: agree when every compared difference is 0, otherwise one line per
 * relay that differs ("Fan 1: the controller counted 3 fewer starts and 5 min less run time than the record"); none
 * when the day has no stored record to compare.
 */
export function checkResult(day: CheckDay): CheckResult {
  if (day.comparison === "no_record") return { status: "none", lines: [] };
  const lines = day.relays.flatMap((relay) => {
    const parts: string[] = [];
    const starts = relay.starts_difference;
    if (starts !== null && starts !== 0) parts.push(`${Math.abs(starts)} ${starts > 0 ? "more" : "fewer"} ${Math.abs(starts) === 1 ? "start" : "starts"}`);
    const run = relay.run_s_difference;
    if (run !== null && Math.round(Math.abs(run) / 60) > 0) parts.push(`${runTime(Math.abs(run))} ${run > 0 ? "more" : "less"} run time`);
    return parts.length ? [`${relayName(relay.equipment)}: the controller counted ${parts.join(" and ")} than the record`] : [];
  });
  return { status: lines.length ? "differ" : "agree", lines };
}

/** API-33's `days` for a window: 7 for the 7-day window, else the most it serves, 30. */
export const checkDays = (days: WindowDays): 7 | 30 => (days === 7 ? 7 : 30);
