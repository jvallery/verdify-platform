// SPDX-License-Identifier: MIT
/**
 * Drying by day (screens §2.3 block 4): API-32's per-day drying record shaped into the shared daily bars and stack.
 * A day with no drying record is a gap, never a zero; today is drawn "so far"; a day a restart cut short (its meter
 * counts lost) is a lower bound and says so. Pure, so every day's value and note is tested.
 */
import type { DailyBarDay } from "../../charts/daily-bars";
import type { DailyStackDay, DailyStackPart } from "../../charts/daily-stack";
import type { RecordDay, RecordDrying } from "../../lib/operator-api";
import { words } from "../../lib/words";
import { capital } from "./law";

/** The qualifier of a day that is still running, and of one whose counts are a lower bound. */
export const SO_FAR = "so far";
export const LOWER_BOUND = "lower bound";

/** Whether a day is drawn lighter, and what its tooltip and table say about it. */
function qualifier(day: Pick<RecordDay, "complete" | "drying">): { partial?: boolean; note?: string } {
  const notes = [...(!day.complete ? [SO_FAR] : []), ...(day.drying?.lower_bound ? [LOWER_BOUND] : [])];
  return notes.length ? { partial: true, note: notes.join(", ") } : {};
}

/** One measure of drying per day: `pick` reads it from the day's drying record, null when there is none. */
export function dryingBars(days: readonly RecordDay[], pick: (drying: RecordDrying) => number | null | undefined): DailyBarDay[] {
  return days.map((day) => {
    const value = day.drying ? pick(day.drying) : null;
    return { date: day.date, value: value === null || value === undefined || !Number.isFinite(value) ? null : value, ...qualifier(day) };
  });
}

/** The measures of block 4: hours, runs, water removed, heat spent, the price paid and furnace starts after drying. */
export const hoursOf = (drying: RecordDrying) => (drying.seconds === null ? null : drying.seconds / 3600);
export const runsOf = (drying: RecordDrying) => drying.runs;
export const waterKgOf = (drying: RecordDrying) => (drying.water_g === null ? null : drying.water_g / 1000);
export const heatKwhOf = (drying: RecordDrying) => (drying.heat_wh === null ? null : drying.heat_wh / 1000);
/** The price paid: heat over water (kWh per kg), null without water removed (no price can be stated for none). */
export const pricePaidOf = (drying: RecordDrying) => (drying.heat_wh === null || drying.water_g === null || drying.water_g <= 0 ? null : drying.heat_wh / drying.water_g);
export const furnaceStartsOf = (drying: RecordDrying) => drying.furnace_starts_after;

/**
 * The refusal reasons, bottom to top, each with the colour of what refused it (design system v2 §2.3): the price is
 * electricity, the furnace is gas, cooling is the fan, drier air is humidity, too cold is below the band, and the
 * readings the law could not take are context.
 */
export const REFUSAL_PARTS: readonly (readonly [reason: string, token: string])[] = [
  ["cost", "--eq-heat1"], ["not_drier", "--c-rh"], ["too_cold", "--cmp-below"], ["furnace", "--eq-heat2"], ["cooling", "--eq-fan1"],
  ["no_outdoor", "--c-outdoor"], ["humidity_invalid", "--text-3"], ["no_temperature", "--text-2"],
];

/** The parts the window needs: each reason some day refused drying for, in the fixed order, named in words. */
export function refusalParts(days: readonly RecordDay[]): DailyStackPart[] {
  const seen = new Set(days.flatMap((day) => Object.entries(day.drying?.refused_s ?? {}).filter(([, seconds]) => seconds > 0).map(([reason]) => reason)));
  const known = REFUSAL_PARTS.filter(([reason]) => seen.has(reason)).map(([key, token]) => ({ key, label: capital(words("drying_refusal", key)), token }));
  // A reason this build has no colour for still shows, in the context colour, after the known ones.
  const other = [...seen].filter((reason) => !REFUSAL_PARTS.some(([key]) => key === reason)).sort().map((key) => ({ key, label: capital(words("drying_refusal", key)), token: "--text-3" }));
  return [...known, ...other];
}

/** Hours wanted but refused, by reason, per day; a day with no refusal record is a gap. */
export function refusalDays(days: readonly RecordDay[], parts: readonly DailyStackPart[]): DailyStackDay[] {
  return days.map((day) => {
    const refused = day.drying?.refused_s ?? null;
    const values = Object.fromEntries(parts.map((part) => [part.key, refused ? (refused[part.key] ?? 0) / 3600 : null]));
    return { date: day.date, values, ...qualifier(day) };
  });
}
