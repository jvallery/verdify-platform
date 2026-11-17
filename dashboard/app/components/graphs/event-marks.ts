// SPDX-License-Identifier: MIT
/**
 * The event rail's marks on Graphs (screens.md section 7.1): what people, the reviewer, other agents and the host wrote
 * (API-17), the alerts raised and resolved (API-14, open and recently resolved), and the water runs (API-IRR-11, windows
 * up to 31 days), as `ChartEvent`s for the stack, each in words and linking to its Activity entry. The plan writes of the
 * retired planner are not events any more: they are left out of the rail and its list. Pure: the route reads.
 */
import { EVENT_SOURCES, activityEvent, alertEvents, runEvent, type ChartEvent, type EventSource } from "../../charts/events";
import type { ActivityEntry, Alert, Run, Setting } from "../../lib/operator-api";
import { settingLabel } from "../../lib/settings-context";
import { words } from "../../lib/words";

/** API-17 and API-IRR-11 give at most this many rows a page; the rail reads one page of each. */
export const EVENTS_PAGE = 200;
/** The sources whose marks come from the activity log. */
export const WRITE_SOURCES: readonly EventSource[] = ["people", "iris", "agents", "system"];

/** The retired planner's writes (`plan.*`): never marked. */
export const isPlanWrite = (entry: Pick<ActivityEntry, "action">): boolean => entry.action.split(".")[0] === "plan";

/** "Set VPD Mister Engage", "Acknowledged “Relay stuck”": an entry's action and what it changed, in words. */
export function eventTitle(entry: ActivityEntry, labels: ReadonlyMap<string, string>): string {
  const detail = entry.detail ?? {};
  const action = words("activity_action", entry.action);
  let target = entry.target;
  if (entry.action.startsWith("setting.")) target = labels.get(entry.target) ?? entry.target;
  else if (entry.action.startsWith("alert.") && typeof detail.alert_type === "string") target = `“${words("alert_type", detail.alert_type)}”`;
  else if (entry.action.startsWith("irrigation.") && entry.target === "all") target = "every line";
  return `${action} ${target}`;
}

export type EventInput = {
  readonly activity?: readonly ActivityEntry[] | null;
  readonly alerts?: readonly Alert[] | null;
  readonly runs?: readonly Run[] | null;
  /** API-09, for setting labels; the param reads raw without it. */
  readonly settings?: readonly Setting[] | null;
  /** The sources shown: the URL's `events`. */
  readonly sources: readonly EventSource[];
  /** Epoch seconds. */
  readonly now: number;
};

/** Every mark of the sources shown, in time order; the stack keeps those inside its view. */
export function chartEvents({ activity, alerts, runs, settings, sources, now }: EventInput): ChartEvent[] {
  const labels = new Map((settings ?? []).map((row) => [row.param, settingLabel(row)]));
  const out: ChartEvent[] = [];
  for (const entry of activity ?? []) {
    if (isPlanWrite(entry)) continue;
    const event = activityEvent(entry, now, eventTitle(entry, labels));
    if (event && sources.includes(event.source)) out.push(event);
  }
  if (sources.includes("alerts")) for (const alert of alerts ?? []) out.push(...alertEvents(alert, now, words("alert_type", alert.alert_type)));
  if (sources.includes("runs")) for (const run of runs ?? []) {
    const event = runEvent(run, now);
    if (event) out.push(event);
  }
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** The sources a view shows: the URL's, or every one. */
export const shownSources = (events: readonly EventSource[] | null): readonly EventSource[] => events ?? EVENT_SOURCES;
