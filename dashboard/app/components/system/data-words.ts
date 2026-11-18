// SPDX-License-Identifier: MIT
import { dayMonth, duration, formatValue, localDate, sentenceStart, shortTime } from "../../lib/format";
import type { DataContinuity, Delivery, Setting } from "../../lib/operator-api";
import { deliverySender, isControllerReport, type DeliverySender } from "../../lib/vocab";
import { hasWords, unknownWords, words } from "../../lib/words";
import type { BadgeStatus } from "../badge";
import { finite } from "../data/viz";
import { settingState } from "../setting-row";

/**
 * The words and shapes of System → Data (screens section 10.3, review B6) that only this page uses: what each stored
 * table and probe is called, which probes are not answering and how they group, the continuity bars and sentence, the
 * delivery table by sender and the settings not taken. Pure: the page's components only lay them out.
 */
/** A stored table in words, or null when this build has none for it (the page then shows "Unknown (<table>)"). */
export const tableWords = (table: string): string | null => (hasWords("flow_table", table) ? words("flow_table", table) : null);
/** A probe in words ("North wall temperature"), or null when this build has none for it. */
export const probeWords = (sensor: string): string | null => (hasWords("probe", sensor) ? words("probe", sensor) : null);

/** API-36 reports 7200 for a probe not seen in two hours or more. */
export const PROBE_LOST_S = 7200;
/** "20 s ago", "not seen in 2 h", or "never seen". */
export function probeAge(age: number | null | undefined): string {
  if (!finite(age)) return "never seen";
  return age >= PROBE_LOST_S ? "not seen in 2 h" : `${duration(age)} ago`;
}

// ---------------------------------------------------------------------------------------------------- probes (B6)
type Probe = DataContinuity["probes"][number];
/** What a probe measures, for grouping the silent ones: "7 soil probes". */
export type ProbeKind = "soil" | "air" | "outdoor" | "co2" | "light" | "other";
export function probeKind(sensor: string): ProbeKind {
  const column = sensor.replace(/^[a-z]+\./, "");
  if (column.startsWith("soil_")) return "soil";
  if (column.startsWith("outdoor_")) return "outdoor";
  if (column.startsWith("co2")) return "co2";
  if (column === "lux") return "light";
  if (/^(temp|rh)_|_rh$/.test(column)) return "air";
  return "other";
}
const KIND_NOUNS: Readonly<Record<ProbeKind, readonly [string, string]>> = {
  soil: ["soil probe", "soil probes"], air: ["air probe", "air probes"], outdoor: ["outdoor probe", "outdoor probes"],
  co2: ["CO₂ probe", "CO₂ probes"], light: ["light probe", "light probes"], other: ["probe", "probes"],
};
const DAY_S = 86_400;

/**
 * One line of the probes not answering: a probe on its own ("South 1 soil EC: no reading in 30 days"), or several of
 * one kind that went quiet on the same local day ("7 soil probes: no answer since 14 Nov"). `recent` is a probe that
 * stopped within the last day: it makes the panel a warning. One silent for longer is known, listed in the muted tone.
 */
export type SilentLine = { readonly key: string; readonly text: string; readonly recent: boolean; readonly sensors: readonly string[]; readonly unknown: boolean };
export type ProbeSummary = {
  /** The probes answering, as API-36 lists them. */
  readonly answering: readonly Probe[];
  /** The probes not answering, stopped today first, then the known silent, newest first. */
  readonly silent: readonly SilentLine[];
  /** How many stopped within the last day. */
  readonly stoppedToday: number;
  /** The known silent in a few words for the status line ("7 soil probes silent since 14 Nov"), or null when none. */
  readonly knownText: string | null;
};

type Silent = { probe: Probe; seen: number | null; recent: boolean; kind: ProbeKind; name: string | null };
const lastSeen = (probe: Probe): number | null => {
  const at = probe.last_seen_at ? Date.parse(probe.last_seen_at) : Number.NaN;
  return Number.isFinite(at) ? at : null;
};

/** The probes answering and those not, grouped, at `now` (epoch ms). */
export function probeSummary(probes: readonly Probe[], now: number): ProbeSummary {
  const answering = probes.filter((probe) => finite(probe.age_s) && probe.age_s < PROBE_LOST_S);
  const silent: Silent[] = probes.filter((probe) => !answering.includes(probe)).map((probe) => {
    const seen = lastSeen(probe);
    return { probe, seen, recent: seen !== null && now - seen <= DAY_S * 1000, kind: probeKind(probe.sensor), name: probeWords(probe.sensor) };
  });
  const groups = new Map<string, Silent[]>();
  for (const row of silent) {
    const day = row.seen === null ? "none" : localDate(new Date(row.seen).toISOString());
    const key = `${row.recent ? "recent" : "known"}|${row.kind}|${day}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const lines: SilentLine[] = [...groups].map(([key, rows]) => {
    const first = rows[0];
    const earliest = rows.reduce<number | null>((min, row) => (row.seen === null ? min : min === null ? row.seen : Math.min(min, row.seen)), null);
    const since = earliest === null ? "no reading in 30 days"
      : `no answer since ${first.recent ? shortTime(new Date(earliest).toISOString()) : dayMonth(localDate(new Date(earliest).toISOString()))}`;
    const who = rows.length > 1 ? `${rows.length} ${KIND_NOUNS[first.kind][1]}` : first.name ?? unknownWords(first.probe.sensor);
    return { key, text: `${who}: ${since}`, recent: first.recent, sensors: rows.map((row) => row.probe.sensor), unknown: rows.length === 1 && first.name === null };
  });
  const newest = (line: SilentLine) => Math.max(...silent.filter((row) => line.sensors.includes(row.probe.sensor)).map((row) => row.seen ?? 0));
  lines.sort((a, b) => Number(b.recent) - Number(a.recent) || newest(b) - newest(a) || a.text.localeCompare(b.text));
  const known = lines.filter((line) => !line.recent);
  const knownCount = known.reduce((sum, line) => sum + line.sensors.length, 0);
  const knownText = known.length === 0 ? null
    : known.length === 1 ? known[0].text.replace(": no answer", " silent").replace(": no reading in 30 days", " silent for 30 days")
    : `${knownCount} probes known to be silent`;
  return { answering, silent: lines, stoppedToday: silent.filter((row) => row.recent).length, knownText };
}
/** "1 probe stopped answering today", for the status line and the answer; null when none did. */
export function stoppedWords(count: number): string | null {
  return count > 0 ? `${count} ${count === 1 ? "probe" : "probes"} stopped answering today` : null;
}

/** The continuity ranges: 1, 7 or 30 days (`?days=`). */
export const CONTINUITY_DAYS = [1, 7, 30] as const;
export type ContinuityDays = (typeof CONTINUITY_DAYS)[number];
export const continuityDays = (value: string | null): ContinuityDays => (value === "7" ? 7 : value === "30" ? 30 : 1);
/** The delivery ranges: 24 h or 7 d (`?hours=`). */
export const DELIVERY_HOURS = [24, 168] as const;
export type DeliveryHours = (typeof DELIVERY_HOURS)[number];
export const deliveryHours = (value: string | null): DeliveryHours => (value === "168" ? 168 : 24);

export type Bar = { readonly date: string; readonly value: number | null; readonly partial?: boolean; readonly note?: string };
/**
 * The continuity bars: seconds without data and minutes the gap log replayed, per local day, today drawn as so far.
 * A day API-36 does not list is a gap, never zero.
 */
export function continuityBars(byDay: DataContinuity["by_day"], today: string): { readonly outage: Bar[]; readonly replayed: Bar[] } {
  const bar = (date: string, value: number): Bar => (date === today ? { date, value, partial: true, note: "so far" } : { date, value });
  return {
    outage: byDay.map((day) => bar(day.date, day.outage_s)),
    replayed: byDay.map((day) => bar(day.date, day.replayed_min)),
  };
}

/** The oldest value still waiting for its readback, in words. */
export function oldestWords(seconds: number | null | undefined): string {
  if (!finite(seconds)) return "Not known";
  return seconds <= 0 ? "Nothing is waiting" : `Waiting ${duration(seconds)}`;
}

/** "2 changed of 102 read back", or what is not known of the newest readback pass. */
export function readbackWords(pass: Delivery["readback_pass"]): string {
  if (!finite(pass.of)) return "not reported";
  return `${finite(pass.stored) ? pass.stored : "—"} changed of ${pass.of} read back`;
}

// ---------------------------------------------------------------------------------------------------- continuity
const windowWords = (days: number) => (days === 1 ? "the last 24 h" : `the last ${days} days`);
/** Minutes as "45 min" or "3 h 29 min". */
export function minutesWords(minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = Math.round(minutes % 60);
  return hours > 0 ? `${hours}\u00a0h${rest ? ` ${rest}\u00a0min` : ""}` : `${rest}\u00a0min`;
}
/**
 * The page's answer (A4): "No data was lost in the last 24 h." or "3 gaps in the last 24 h, 9 min in all; the gap log
 * replayed 3 h 29 min." What the gap log replayed is said whenever it replayed anything.
 */
export function continuitySentence(data: Pick<DataContinuity, "outages" | "by_day">, days: number): string {
  const lost = data.by_day.reduce((sum, day) => sum + day.outage_s, 0);
  const replayed = data.by_day.reduce((sum, day) => sum + day.replayed_min, 0);
  const restored = replayed > 0 ? `the gap log replayed ${minutesWords(replayed)}` : null;
  if (data.outages.length === 0 && lost === 0) return restored ? `No data was lost in ${windowWords(days)}; ${restored}.` : `No data was lost in ${windowWords(days)}.`;
  const gaps = data.outages.length;
  const head = `${gaps > 0 ? `${gaps} ${gaps === 1 ? "gap" : "gaps"}` : "Gaps"} in the record in ${windowWords(days)}, ${duration(lost)} in all`;
  return `${head}${restored ? `; ${restored}` : ""}.`;
}

// ---------------------------------------------------------------------------------------------------- delivery (B6)
/** The delivery table's outcome columns: what happened to a push. A status in none of them counts as waiting. */
export const OUTCOMES = ["confirmed", "failed", "cancelled", "superseded"] as const;
export type Outcome = (typeof OUTCOMES)[number] | "waiting";
const OUTCOME_OF: Readonly<Record<string, Outcome>> = { confirmed: "confirmed", failed: "failed", expired: "failed", cancelled: "cancelled", superseded: "superseded" };
export type SenderRow = { readonly sender: DeliverySender | "other"; readonly name: string; readonly counts: Readonly<Record<Outcome, number>>; readonly total: number };
/**
 * Pushes by who sent them (the house band, an operator, the retired planner) and how they ended. The controller's own
 * reports are not pushes and stay out; a source with no sender row of its own counts under "Another sender".
 */
export function senderRows(rows: Delivery["by_status"]): SenderRow[] {
  const table = new Map<DeliverySender | "other", Record<Outcome, number>>();
  for (const row of rows) {
    if (isControllerReport(row.source)) continue;
    const sender = deliverySender(row.source) ?? "other";
    const counts = table.get(sender) ?? { confirmed: 0, failed: 0, cancelled: 0, superseded: 0, waiting: 0 };
    counts[OUTCOME_OF[row.status] ?? "waiting"] += row.count;
    table.set(sender, counts);
  }
  const order: (DeliverySender | "other")[] = ["band", "manual", "plan", "other"];
  return order.filter((sender) => table.has(sender)).map((sender) => {
    const counts = table.get(sender)!;
    return { sender, name: sender === "other" ? "Another sender" : sentenceStart(words("delivery_source", sender)), counts, total: Object.values(counts).reduce((sum, n) => sum + n, 0) };
  });
}
/** Every push of the window that was confirmed, across senders. */
export const confirmedPushes = (rows: readonly SenderRow[]): number => rows.reduce((sum, row) => sum + row.counts.confirmed, 0);
/**
 * How long the oldest push still waiting for its readback has waited, in seconds; null when the API does not say. API-37's
 * `oldest_unconfirmed_s` also counts a cancelled push, which waits for nothing, so while the window's pushes hold none
 * that is still waiting (every status is an outcome) nothing waits and this is 0. The API drops cancelled pushes from
 * that age in its next release.
 */
export function oldestWaiting(data: Pick<Delivery, "by_status" | "oldest_unconfirmed_s">): number | null {
  if (!finite(data.oldest_unconfirmed_s)) return null;
  const waiting = data.by_status.some((row) => !isControllerReport(row.source) && row.count > 0 && !(row.status in OUTCOME_OF));
  return waiting ? data.oldest_unconfirmed_s : 0;
}

type Failing = Delivery["failing"][number];
/**
 * How a setting whose pushes failed stands now (screens section 10.3). The ledger (API-37) only knows pushes; the
 * catalogue (API-09) knows what the controller holds. failing: no push was confirmed after its last failure and the
 * catalogue does not show the controller holding the wanted value (or the catalogue is not available); recovered: a
 * push was confirmed after the last failure; in_force: the catalogue reads it confirmed, so the controller holds the
 * wanted value although its pushes failed; retired: the catalogue no longer has it. Only failing counts as not taken.
 */
export type Standing = "failing" | "recovered" | "in_force" | "retired";
/** The State badge of each standing; "In force" as the Drying page says "in force on the controller". */
export const STANDING_WORDS: Readonly<Record<Standing, { readonly label: string; readonly status: BadgeStatus }>> = {
  failing: { label: "Failing", status: "warn" },
  recovered: { label: "Recovered", status: "neutral" },
  in_force: { label: "In force", status: "neutral" },
  retired: { label: "Retired", status: "neutral" },
};
/** A setting whose pushes failed, with how it stands; `readbackAt` is the catalogue's readback time of an in-force row. */
export type FailingRow = Failing & { readonly standing: Standing; readonly now: boolean; readonly readbackAt: string | null };
const STANDING_ORDER: readonly Standing[] = ["failing", "in_force", "recovered", "retired"];
const newest = (row: Failing) => Date.parse(row.last_confirmed_at ?? row.last_failed_at);
/**
 * The ledger's failing settings, each with how it stands against the catalogue (`null`: API-09 is not available, and
 * the ledger alone decides). Failing first (most failures first), then in force, recovered and retired, each newest
 * first, then by key.
 */
export function failingRows(rows: readonly Failing[], catalog: readonly Setting[] | null): FailingRow[] {
  const byParam = catalog ? new Map(catalog.map((row) => [row.param, row])) : null;
  const standing = (row: Failing): { standing: Standing; readbackAt: string | null } => {
    if (row.last_confirmed_at && Date.parse(row.last_confirmed_at) >= Date.parse(row.last_failed_at)) return { standing: "recovered", readbackAt: null };
    if (!byParam) return { standing: "failing", readbackAt: null };
    const setting = byParam.get(row.param);
    if (!setting) return { standing: "retired", readbackAt: null };
    return settingState(setting).kind === "confirmed" ? { standing: "in_force", readbackAt: setting.readback?.observed_at ?? null } : { standing: "failing", readbackAt: null };
  };
  return rows.map((row) => {
    const stands = standing(row);
    return { ...row, ...stands, now: stands.standing === "failing" };
  }).sort((a, b) => STANDING_ORDER.indexOf(a.standing) - STANDING_ORDER.indexOf(b.standing)
    || (a.now ? b.failed - a.failed : 0) || newest(b) - newest(a) || a.param.localeCompare(b.param));
}
/** How many settings are not taken now: the ledger and the catalogue both say so. */
export const failingNow = (rows: readonly Failing[], catalog: readonly Setting[] | null): number => failingRows(rows, catalog).filter((row) => row.now).length;
/** "4.2 s median · 31.8 s for the slowest 5 %", or what is not known. */
export function confirmTimeWords(latency: Delivery["latency"]): string | null {
  if (!finite(latency.p50_s)) return null;
  const slow = finite(latency.p95_s) ? ` · ${formatValue(latency.p95_s, "s")} for the slowest 5\u00a0%` : "";
  return `${formatValue(latency.p50_s, "s")} median${slow}`;
}

// ---------------------------------------------------------------------------------------------------- the answer's lines
/** One short line under the answer: a block's state in words, with its tone. */
export type StateLine = { readonly tone: "ok" | "warn" | "muted"; readonly text: string };
/** The ingestor stops being "flowing" after two minutes without a heartbeat, and climate readings after five. */
const HEARTBEAT_LATE_S = 120;
const CLIMATE_LATE_S = 300;
/** A push unconfirmed for longer than this makes Delivery a warning. */
export const WAITING_LATE_S = 1800;
/** Flow: the heartbeat and the newest climate row. */
export function flowLine(data: Pick<DataContinuity, "ingestor" | "tables">): StateLine {
  const heartbeat = data.ingestor.heartbeat_age_s;
  if (finite(heartbeat) && heartbeat > HEARTBEAT_LATE_S) return { tone: "warn", text: `Ingestor heartbeat ${duration(heartbeat)} ago` };
  const climate = data.tables.find((row) => row.table === "climate")?.last_row_age_s;
  if (finite(climate) && climate > CLIMATE_LATE_S) return { tone: "warn", text: `Newest climate reading ${duration(climate)} ago` };
  if (!finite(heartbeat)) return { tone: "muted", text: "Ingestor heartbeat not reported" };
  return { tone: "ok", text: `Storing as it arrives · heartbeat ${duration(heartbeat)} ago` };
}
/** Probes: those that stopped today, those answering, the known silent. */
export function probesLine(summary: ProbeSummary): StateLine {
  const parts = [stoppedWords(summary.stoppedToday), `${summary.answering.length} answering`, summary.knownText].filter(Boolean) as string[];
  return { tone: summary.stoppedToday > 0 ? "warn" : summary.knownText ? "muted" : "ok", text: sentenceStart(parts.join(" · ")) };
}
/** Delivery: the settings failing now (against the catalogue, as `failingRows`), else what was confirmed and what waits. */
export function deliveryLine(data: Pick<Delivery, "by_status" | "failing" | "oldest_unconfirmed_s">, hours: number, catalog: readonly Setting[] | null): StateLine {
  const window = hours === 24 ? "24 h" : "7 days";
  const failing = failingNow(data.failing, catalog);
  if (failing > 0) return { tone: "warn", text: `${failing} ${failing === 1 ? "setting is" : "settings are"} not taken now` };
  const confirmed = confirmedPushes(senderRows(data.by_status));
  const oldest = oldestWaiting(data) ?? 0;
  const waiting = oldest > 0 ? ` · the oldest unconfirmed has waited ${duration(oldest)}` : "";
  return { tone: oldest > WAITING_LATE_S ? "warn" : "ok", text: `${formatValue(confirmed, "count")} pushes confirmed in ${window}, none failing${waiting}` };
}
