// SPDX-License-Identifier: MIT
/**
 * "What ran" on Now's Today (dashboard v2 screens §1 block 4): one row group of four rows, heating, cooling,
 * humidifying and drying, from the law's request lanes over the last 24 h (API-31). A row is the union of its lanes:
 * on while any of them is on, unknown while none is on and any is unknown (a gap in the law's record is never off), else
 * off. Pure, so the tests check it without a page.
 */
import type { LawHistory } from "../../lib/operator-api";

export type Interval = { readonly start: string; readonly end: string; readonly state: "on" | "off" | "unknown" };
export type RanRow = { readonly key: string; readonly label: string; readonly token: string; readonly lanes: readonly string[] };
/** The four rows and the request lanes each one joins. */
export const RAN_ROWS: readonly RanRow[] = [
  { key: "heating", label: "Heating", token: "--eq-heat1", lanes: ["request.heat1", "request.heat2"] },
  { key: "cooling", label: "Cooling", token: "--eq-vent", lanes: ["request.cooling"] },
  { key: "humidifying", label: "Humidifying", token: "--eq-fog", lanes: ["request.fog", "request.mist"] },
  { key: "drying", label: "Drying", token: "--eq-fan1", lanes: ["request.drying"] },
];

const RANK = { off: 0, unknown: 1, on: 2 } as const;

/**
 * The union of interval lists: each stretch between two boundaries takes the strongest state any list has there (on,
 * then unknown, then off); a stretch no list covers is unknown. Adjacent stretches of one state merge.
 */
export function unionIntervals(lists: readonly (readonly Interval[])[], from: string, to: string): Interval[] {
  const start = Date.parse(from), end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const parsed = lists.map((list) => list.map((item) => ({ start: Date.parse(item.start), end: Date.parse(item.end), state: item.state }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start));
  const cuts = new Set<number>([start, end]);
  for (const list of parsed) for (const item of list) { if (item.start > start && item.start < end) cuts.add(item.start); if (item.end > start && item.end < end) cuts.add(item.end); }
  const points = [...cuts].sort((a, b) => a - b);
  const out: { start: number; end: number; state: Interval["state"] }[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index], b = points[index + 1];
    const middle = (a + b) / 2;
    let state: Interval["state"] | null = null;
    for (const list of parsed) {
      const hit = list.find((item) => item.start <= middle && middle < item.end);
      const here = hit ? hit.state : "unknown";
      if (state === null || RANK[here] > RANK[state]) state = here;
    }
    const value = state ?? "unknown";
    const last = out.at(-1);
    if (last && last.state === value && last.end === a) last.end = b;
    else out.push({ start: a, end: b, state: value });
  }
  return out.map((item) => ({ start: new Date(item.start).toISOString(), end: new Date(item.end).toISOString(), state: item.state }));
}

/** Each row's intervals over [from, to] from the law's lanes; a row whose lanes are all missing reads unknown throughout. */
export function ranIntervals(history: Pick<LawHistory, "lanes"> | null | undefined, from: string, to: string): { row: RanRow; intervals: Interval[] }[] {
  return RAN_ROWS.map((row) => {
    const lists = row.lanes.map((key) => (history?.lanes.find((lane) => lane.key === key)?.intervals ?? []) as readonly Interval[]);
    return { row, intervals: unionIntervals(lists, from, to) };
  });
}
