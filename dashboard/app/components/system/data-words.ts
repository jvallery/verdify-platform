// SPDX-License-Identifier: MIT
import { duration } from "../../lib/format";
import type { DataContinuity, Delivery } from "../../lib/operator-api";
import { finite } from "../data/viz";

/**
 * The words and shapes of System → Data (screens section 10.3) that only this page uses: what each stored table and
 * probe is, how old a probe's answer is, the continuity bars and the delivery totals. A table or probe this build does
 * not know reads raw, in mono, so a new one shows as itself.
 */
const TABLE_WORDS: Readonly<Record<string, string>> = {
  climate: "Climate readings",
  diagnostics: "Controller health",
  equipment_state: "Relay changes",
  setpoint_snapshot: "Setting readbacks",
  energy: "Power meter",
  system_state: "Controller state",
  irr_state: "Water line state",
  water_meter_events: "Water meter",
  data_gaps: "Outages",
};
/** A stored table in words, or null when this build has none for it. */
export const tableWords = (table: string): string | null => TABLE_WORDS[table] ?? null;

const PLACES: Readonly<Record<string, string>> = { north: "North", south: "South", east: "East", west: "West", center: "Center", case: "Controller case", outdoor: "Outdoor", intake: "Intake" };
const KINDS: Readonly<Record<string, string>> = { temp: "temperature", rh: "humidity", vpd: "VPD", co2: "CO2", lux: "light", soil: "soil moisture" };
/** "climate.temp_north" → "North temperature"; null when the name does not parse. */
export function probeWords(sensor: string): string | null {
  const match = /^(?:[a-z]+\.)?([a-z0-9]+)_([a-z]+)$/.exec(sensor);
  if (!match) return null;
  const [, kind, place] = match;
  return KINDS[kind] && PLACES[place] ? `${PLACES[place]} ${KINDS[kind]}` : null;
}

/** API-36 reports 7200 for a probe not seen in two hours or more. */
export const PROBE_LOST_S = 7200;
/** "20 s ago", "not seen in 2 h", or "never seen". */
export function probeAge(age: number | null | undefined): string {
  if (!finite(age)) return "never seen";
  return age >= PROBE_LOST_S ? "not seen in 2 h" : `${duration(age)} ago`;
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

/** Pushes by status across every source, the largest first, with the share of the whole. */
export type StatusTotal = { readonly status: string; readonly count: number; readonly share: number };
export function statusTotals(rows: Delivery["by_status"]): StatusTotal[] {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.status, (totals.get(row.status) ?? 0) + row.count);
  const all = [...totals.values()].reduce((sum, count) => sum + count, 0);
  return [...totals].map(([status, count]) => ({ status, count, share: all > 0 ? (count / all) * 100 : 0 })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
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
