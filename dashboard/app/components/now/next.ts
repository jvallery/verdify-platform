// SPDX-License-Identifier: MIT
/**
 * "Coming up" on Now (dashboard v2 screens §1, inside Today): the next 12 h in time order, as plain functions the tests
 * check without a page. What it lists is what is scheduled or known ahead, never what the controller will decide: the
 * climate law acts on the band second by second, so nothing about heating, cooling, fog or drying is listed.
 * - The water runs API-IRR-02 schedules in the next 12 h, planned, skipped or blocked, each with its length and why a
 *   skip will not run.
 * - Each light's window in which the controller may switch it on (a window, never a schedule: daylight decides), its
 *   timed switch ending, and where its intent differs from Lutron now (#1340).
 * - Sunrise and sunset.
 * - "Later": each line with no run in the next 12 h, with its next one, its pause, or that it has no schedule.
 */
import { duration, formatValue, localDate, shortTime, wallClockInstant } from "../../lib/format";
import { dayClock } from "../../lib/last-water";
import { lineById, lineDisplayName } from "../../lib/lines";
import type { Equipment, IrrigationLine, Occurrence, Schedule, ScheduleAgenda, Setting } from "../../lib/operator-api";
import { hasWords, words } from "../../lib/words";
import { personName, type SignedIn } from "../../lib/activity";
import { manualUntil } from "../equipment/light-controls";
import { lineName } from "./status";

export const NEXT_H = 12;
const HOUR_S = 3600;

/** The window in epoch seconds: now to 12 h after it. */
export type NextWindow = { readonly now: number; readonly to: number };
export function nextWindow(clock: number): NextWindow {
  const now = Math.floor(clock / 1000);
  return { now, to: now + NEXT_H * HOUR_S };
}

const epoch = (instant: string | null | undefined): number => (instant ? Date.parse(instant) / 1000 : Number.NaN);
const clockOf = (at: number): string => shortTime(new Date(at * 1000).toISOString());

/** A schedule's valve-open seconds and its length in words: "12 min", or a mister's "4 × 45 s". */
export function runLength(schedule: Pick<Schedule, "on_s" | "count" | "gap_s" | "prewet_s" | "flush_s"> | undefined, lineId: string): { seconds: number; words: string } {
  if (!schedule) return { seconds: 60, words: "" };
  const count = Math.max(1, schedule.count ?? 1);
  const on = schedule.on_s ?? 0;
  const seconds = (schedule.prewet_s ?? 0) + on * count + (schedule.gap_s ?? 0) * (count - 1) + (schedule.flush_s ?? 0);
  const kind = lineById(lineId)?.kind;
  const mist = kind === "mister" || kind === "fert_mister";
  const amount = mist || count > 1 ? `${count} × ${duration(on)}` : on < 60 ? duration(on) : formatValue(on / 60, "min");
  return { seconds, words: amount };
}

/** An occurrence's note in words: a skip's reason, or "only if VPD sensing is degraded". */
export function occurrenceNote(occurrence: Pick<Occurrence, "status" | "reason">, schedule: Pick<Schedule, "degraded_only"> | undefined): string | null {
  const reason = occurrence.reason ? (hasWords("occurrence_reason", occurrence.reason) ? words("occurrence_reason", occurrence.reason) : occurrence.reason) : null;
  if (occurrence.status === "planned") return reason ?? (schedule?.degraded_only ? "only if VPD sensing is degraded" : null);
  return reason ? reason.replace(/^Skipped:\s*/, "") : occurrence.status;
}

export type RunStatus = "scheduled" | "skipped" | "blocked";
const STATUS_OF: Readonly<Record<string, RunStatus>> = { planned: "scheduled", skipped: "skipped", blocked: "blocked" };
type Upcoming = { readonly occurrence: Occurrence; readonly schedule: Schedule | undefined; readonly at: number; readonly status: RunStatus };
/** The agenda's occurrences that start after now and inside the window, scheduled, skipped or blocked, in time order. */
export function upcoming(agenda: Pick<ScheduleAgenda, "occurrences" | "schedules"> | null | undefined, window: NextWindow): Upcoming[] {
  return (agenda?.occurrences ?? [])
    .filter((occurrence) => Object.hasOwn(STATUS_OF, occurrence.status))
    .map((occurrence) => ({ occurrence, schedule: agenda?.schedules.find((item) => item.slot_id === occurrence.slot_id), at: epoch(occurrence.planned_start), status: STATUS_OF[occurrence.status] }))
    .filter(({ at }) => at > window.now && at <= window.to)
    .sort((a, b) => a.at - b.at);
}

/** Sunrise and sunset inside [from, to]. */
export function sunTimes(solar: ScheduleAgenda["solar"] | null | undefined, window: { readonly from: number; readonly to: number }): { at: number; kind: "sunrise" | "sunset" }[] {
  return (solar ?? []).flatMap((day) => [{ at: epoch(day.sunrise), kind: "sunrise" as const }, { at: epoch(day.sunset), kind: "sunset" as const }])
    .filter(({ at }) => Number.isFinite(at) && at >= window.from && at <= window.to).sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------------------------------- the lights
export type LightKey = "main" | "grow";
export const LIGHT_ROWS: readonly { readonly light: LightKey; readonly equipment: string; readonly name: string }[] = [
  { light: "main", equipment: "grow_light_main", name: "Main light" },
  { light: "grow", equipment: "grow_light_grow", name: "Grow light" },
];
type SettingRow = Pick<Setting, "param" | "readback">;
/** A setting's device value (API-09 `readback.value`), or null when it is not reported. */
const deviceValue = (settings: readonly SettingRow[] | null | undefined, param: string): number | null => {
  const value = settings?.find((row) => row.param === param)?.readback?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
const pad = (value: number) => String(value).padStart(2, "0");
/** The instant of a local wall clock on a date, from minutes after local midnight (wrapping into the next day). */
function localAt(date: string, minutes: number): number {
  const day = Math.floor(minutes / 1440);
  const rest = ((minutes % 1440) + 1440) % 1440;
  const shifted = day === 0 ? date : new Date(Date.parse(`${date}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
  const instant = wallClockInstant(`${shifted}T${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`);
  return instant ? Date.parse(instant) / 1000 : Number.NaN;
}

export type LightWindow = { readonly light: LightKey; readonly from: number; readonly to: number };
/**
 * When the controller may switch each light on (#1340), from its device settings in API-09: its photoperiod
 * `[gl_<light>_sunrise_hour, gl_<light>_sunset_hour)` in local hours, or, with `sw_gl_<light>_solar_phasing` on and the
 * sun known, sunrise and sunset from API-IRR-02 moved by `gl_<light>_sunrise_offset_min` and `_sunset_offset_min`.
 * Inside it the light comes on only while daylight is low, so this is a window, never a schedule. None while the light's
 * automation is off or a value is not reported. The main light also comes on for anyone inside at any hour (#1374).
 */
export function lightWindows(settings: readonly SettingRow[] | null | undefined, solar: ScheduleAgenda["solar"] | null | undefined, window: NextWindow): LightWindow[] {
  const out: LightWindow[] = [];
  const dates = [-1, 0, 1].map((shift) => localDate(new Date((window.now + shift * 86_400) * 1000).toISOString()));
  for (const { light } of LIGHT_ROWS) {
    if (deviceValue(settings, `sw_gl_${light}_auto_mode`) !== 1) continue;
    const solarOn = deviceValue(settings, `sw_gl_${light}_solar_phasing`) === 1;
    for (const date of dates) {
      let from: number, to: number;
      const sun = solar?.find((day) => day.date === date);
      if (solarOn && sun) {
        from = epoch(sun.sunrise) + (deviceValue(settings, `gl_${light}_sunrise_offset_min`) ?? 0) * 60;
        to = epoch(sun.sunset) + (deviceValue(settings, `gl_${light}_sunset_offset_min`) ?? 0) * 60;
      } else {
        const start = deviceValue(settings, `gl_${light}_sunrise_hour`), cutoff = deviceValue(settings, `gl_${light}_sunset_hour`);
        if (start === null || cutoff === null || start === cutoff) continue;
        from = localAt(date, start * 60);
        to = localAt(date, (cutoff > start ? cutoff : cutoff + 24) * 60);
      }
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) out.push({ light, from, to });
    }
  }
  return out;
}

type LightItem = Pick<Equipment["items"][number], "equipment" | "state" | "intent" | "since" | "manual_until">;
const knownState = (state: string | null | undefined): state is "on" | "off" => state === "on" || state === "off";

/** Each light's timed switch still running (#1377, API-13 `manual_until`): when it ends and the light goes back to automatic. */
export function lightTimers(equipment: readonly LightItem[] | null | undefined, window: NextWindow): { readonly light: LightKey; readonly name: string; readonly at: number }[] {
  const out: { light: LightKey; name: string; at: number }[] = [];
  for (const item of equipment ?? []) {
    const place = LIGHT_ROWS.find((row) => row.equipment === item.equipment);
    const until = place ? manualUntil(item) : null;
    const at = until === null ? NaN : epoch(until);
    if (place && Number.isFinite(at) && at > window.now && at <= window.to) out.push({ light: place.light, name: place.name, at });
  }
  return out;
}

export type NextItem = {
  readonly key: string;
  readonly at: number;
  /** The `[data-coming]` hook: a water run, a light, or the sun. */
  readonly kind: "run" | "light" | "sun";
  readonly text: string;
  /** A skip's reason, or how a light's window works. */
  readonly note?: string | null;
  /** A run that will not happen (skipped, blocked) reads struck through. */
  readonly skipped?: boolean;
};
export type NextInput = {
  readonly agenda: Pick<ScheduleAgenda, "occurrences" | "schedules" | "solar"> | null | undefined;
  readonly settings: readonly SettingRow[] | null | undefined;
  readonly equipment: readonly LightItem[] | null | undefined;
};

/** The next 12 h: the water runs, the lights' windows and timers, and the sun, in time order. */
export function nextItems(input: NextInput, window: NextWindow): NextItem[] {
  const items: NextItem[] = [];
  for (const { occurrence, schedule, at, status } of upcoming(input.agenda, window)) {
    const { words: amount } = runLength(schedule, occurrence.line_id);
    const head = lineDisplayName(occurrence.line_id);
    const skipped = status !== "scheduled";
    items.push({
      key: `run-${occurrence.slot_id}-${occurrence.planned_start}`, at, kind: "run", skipped,
      text: [skipped ? `${head} skipped` : head, amount, schedule?.label].filter(Boolean).join(" · "), note: occurrenceNote(occurrence, schedule),
    });
  }
  for (const { light, from, to } of lightWindows(input.settings, input.agenda?.solar, window)) {
    const name = LIGHT_ROWS.find((row) => row.light === light)!.name;
    const start = Math.max(from, window.now);
    if (!(Math.min(to, window.to) > start)) continue;
    items.push({ key: `window-${light}-${from}`, at: start, kind: "light", text: `${name} may switch on ${clockOf(from)}–${clockOf(to)}`, note: light === "main" ? "when daylight is low, or for anyone inside" : "when daylight is low" });
  }
  for (const item of input.equipment ?? []) {
    const place = LIGHT_ROWS.find((row) => row.equipment === item.equipment);
    if (!place || !knownState(item.intent) || !knownState(item.state) || item.intent === item.state) continue;
    items.push({ key: `intent-${item.equipment}`, at: window.now, kind: "light", text: `${place.name}: the controller wants it ${item.intent}`, note: "Lutron differs" });
  }
  for (const { light, name, at } of lightTimers(input.equipment, window)) {
    items.push({ key: `timer-${light}-${at}`, at, kind: "light", text: `${name} back to automatic`, note: "the by-hand switch ends" });
  }
  for (const { at, kind } of sunTimes(input.agenda?.solar, { from: window.now, to: window.to })) {
    if (at > window.now) items.push({ key: `${kind}-${at}`, at, kind: "sun", text: kind === "sunrise" ? "Sunrise" : "Sunset" });
  }
  const order: Readonly<Record<NextItem["kind"], number>> = { sun: 0, light: 1, run: 2 };
  return items.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

/** "13:00", with the weekday when it falls on another day ("Tue 06:35"). */
export function itemTime(at: number, clock: number): string {
  const instant = new Date(at * 1000).toISOString();
  return localDate(instant) === localDate(new Date(clock).toISOString()) ? shortTime(instant) : dayClock(instant, clock);
}

type PausableLine = Pick<IrrigationLine, "line_id" | "paused_until" | "paused_by" | "pause_reason">;
/** "paused until 14:00 by Jason: rain", "by Jason" alone when no reason was given. */
export function pausedWords(line: PausableLine, clock: number, me: SignedIn): string {
  const until = line.paused_until ? dayClock(line.paused_until, clock).replace(/^today /, "") : "";
  const who = line.paused_by ? ` by ${line.paused_by.source === "dashboard" ? personName(line.paused_by.name, me) : line.paused_by.name}` : "";
  return `paused until ${until}${who}${line.pause_reason ? `: ${line.pause_reason}` : ""}`;
}

/** The lines Later may name: enabled, not reserved, and neither fog (climate only) nor the fertilizer supply valve. */
const laterLine = (line: Pick<IrrigationLine, "enabled" | "reserved" | "kind">) => line.enabled && !line.reserved && line.kind !== "fog" && line.kind !== "master";

/**
 * "Later": each line with no run in the next 12 h: its next run from the week's agenda ("Wall drip (fertilized) Sun
 * 07:35"), its pause ("Wall drip paused until Thu 09:00 by Jason: rain · next Fri 07:35"), or, together, the lines with
 * no schedule at all ("No schedule: Wall drip, South mister"). Null when every line runs within 12 h or none is set up.
 */
export function laterText(input: { agenda: Pick<ScheduleAgenda, "occurrences" | "schedules"> | null | undefined; lines: readonly IrrigationLine[] }, window: NextWindow, clock: number, me: SignedIn): string | null {
  const soon = new Set(upcoming(input.agenda, window).map(({ occurrence }) => occurrence.line_id));
  const parts: string[] = [];
  const bare: string[] = [];
  for (const line of input.lines.filter(laterLine).sort((a, b) => a.line_id.localeCompare(b.line_id))) {
    if (soon.has(line.line_id)) continue;
    const scheduled = (input.agenda?.schedules ?? []).some((schedule) => schedule.line_id === line.line_id && schedule.enabled);
    const next = (input.agenda?.occurrences ?? []).filter((item) => item.line_id === line.line_id && item.status === "planned" && epoch(item.planned_start) > window.to)
      .sort((a, b) => epoch(a.planned_start) - epoch(b.planned_start))[0];
    const name = lineName(line);
    const paused = line.paused_until && epoch(line.paused_until) > window.now;
    if (paused) parts.push(`${name} ${pausedWords(line, clock, me)}${next ? ` · next ${dayClock(next.planned_start, clock)}` : ""}`);
    else if (next) parts.push(`${name} ${dayClock(next.planned_start, clock)}`);
    else if (scheduled) parts.push(`${name}: no run this week`);
    else bare.push(lineName(line));
  }
  if (bare.length) parts.push(`No schedule: ${bare.join(", ")}`);
  return parts.length ? parts.join(" · ") : null;
}

/** The next scheduled water run in the next 12 h, for Water today: "Wall drip at 13:00 · 12 min"; null with none. */
export function nextRunText(agenda: Pick<ScheduleAgenda, "occurrences" | "schedules"> | null | undefined, window: NextWindow, clock: number): string | null {
  const next = upcoming(agenda, window).find((item) => item.status === "scheduled");
  if (!next) return null;
  const { words: amount } = runLength(next.schedule, next.occurrence.line_id);
  return [`${lineDisplayName(next.occurrence.line_id)} at ${itemTime(next.at, clock)}`, amount].filter(Boolean).join(" · ");
}
