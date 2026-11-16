// SPDX-License-Identifier: MIT
/**
 * The Planner section's words and sums (#1361). Every number is the server's: API-25 counts the days. These helpers
 * only add days up and choose the words. The study's (API-26 to API-28) retired with the planner's write role.
 */
import type { PlannerDay } from "./operator-api";

/** API-25's windows. */
export const HISTORY_DAYS = [30, 90] as const;
export type HistoryDays = (typeof HISTORY_DAYS)[number];
export function historyDays(search: URLSearchParams): HistoryDays {
  return search.get("days") === "90" ? 90 : 30;
}

/** Where /planner goes: Plan, with the same query. */
export function plannerHref(url: string): string {
  return `/plan${new URL(url).search}`;
}

export type HistoryTotals = {
  readonly requiredDue: number;
  readonly requiredWritten: number;
  readonly failed: number;
  readonly late: number;
  readonly plans: number;
  readonly dispatchDays: number;
  readonly days: number;
  readonly costDays: number;
};
/** The window's totals, for the summary line. */
export function historyTotals(days: readonly PlannerDay[]): HistoryTotals {
  const sum = (pick: (day: PlannerDay) => number) => days.reduce((total, day) => total + pick(day), 0);
  return {
    requiredDue: sum((day) => day.required_due), requiredWritten: sum((day) => day.required_written), failed: sum((day) => day.required_failed),
    late: sum((day) => day.required_late), plans: sum((day) => day.plans_written), dispatchDays: days.filter((day) => day.changes_dispatched > 0).length,
    days: days.length, costDays: days.filter((day) => day.cost !== null).length,
  };
}

/** "87 of 90 required plans written · 1 failed · 1 late · 141 plans · changes reached the controller on 5 of 30 days". */
export function historySentence(totals: HistoryTotals): string {
  const parts = [`${totals.requiredWritten} of ${totals.requiredDue} required plans written`];
  if (totals.failed) parts.push(`${totals.failed} failed`);
  if (totals.late) parts.push(`${totals.late} late`);
  parts.push(`${totals.plans} ${totals.plans === 1 ? "plan" : "plans"} in all`);
  parts.push(`changes reached the controller on ${totals.dispatchDays} of ${totals.days} days`);
  return parts.join(" · ");
}

/** "Plans by trigger": the day's mix, required ones first. */
const TRIGGER_ORDER = ["MIDNIGHT", "SUNRISE", "SUNSET"];
export function triggerMix(triggers: Readonly<Record<string, number>>): string {
  const names = Object.keys(triggers).sort((a, b) => {
    const rank = (name: string) => (TRIGGER_ORDER.includes(name) ? TRIGGER_ORDER.indexOf(name) : TRIGGER_ORDER.length);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return names.map((name) => (triggers[name] === 1 ? name : `${name} ×${triggers[name]}`)).join(", ");
}

/** A share in whole percent, or "—" when nothing was sent. */
export function confirmedShare(day: Pick<PlannerDay, "changes_dispatched" | "changes_confirmed">): string {
  if (day.changes_dispatched <= 0) return "—";
  return `${Math.round((100 * day.changes_confirmed) / day.changes_dispatched)}%`;
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** "142K in / 5.6K out tokens", or null when nothing was counted. */
export function tokenWords(input: number | null | undefined, output: number | null | undefined): string | null {
  if (input == null && output == null) return null;
  return `${input == null ? "—" : COMPACT.format(input)} in / ${output == null ? "—" : COMPACT.format(output)} out`;
}
