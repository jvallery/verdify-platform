// SPDX-License-Identifier: MIT
/**
 * The law over time (screens §2.1 block 6 and §2.3 block 3): API-31's lanes, drying decisions and price series and
 * API-05's relays shaped into the shared state lanes and the price chart. Pure, so each row and span is tested.
 */
import { spansFromIntervals, type StateLaneGroup, type StateLaneRow } from "../../charts/state-lanes";
import type { XRange } from "../../charts/types";
import type { LawHistory, StateLanes } from "../../lib/operator-api";
import { words } from "../../lib/words";

/** The windows Law's lanes offer (24 h, 72 h, 7 d) and Drying's price chart adds 31 d to (API-31 serves at most 31 days). */
export const LAW_WINDOWS = [
  { id: "24h", label: "24 h", seconds: 86_400, graphs: "24h" },
  { id: "72h", label: "72 h", seconds: 3 * 86_400, graphs: "72h" },
  { id: "7d", label: "7 d", seconds: 7 * 86_400, graphs: "7d" },
  { id: "31d", label: "31 d", seconds: 31 * 86_400, graphs: "30d" },
] as const;
export type LawWindowId = (typeof LAW_WINDOWS)[number]["id"];
export const windowOf = (id: LawWindowId) => LAW_WINDOWS.find((item) => item.id === id) ?? LAW_WINDOWS[0];

/** The window an answer covers, in epoch seconds, from its own `from` and `to`. */
export function windowRange(answer: Pick<LawHistory, "from" | "to">): XRange {
  return { from: Date.parse(answer.from) / 1000, to: Date.parse(answer.to) / 1000 };
}

/** The lane groups: what the law asked for, what ran, and the latches behind a fold, "As reported" (words.md §1). */
export const LANE_GROUPS: readonly StateLaneGroup[] = [
  { key: "asked", label: "Asked for" },
  { key: "ran", label: "Ran" },
  { key: "latch", label: "As reported", collapsed: true },
];

/** The requests Law shows, in the rules' order, each named by its rule (screens §2.1 block 6). */
export const ASKED_LANES: readonly (readonly [key: string, rule: string])[] = [
  ["request.heat1", "heat1"], ["request.heat2", "heat2"], ["request.cooling", "cooling"], ["request.fan2", "second_fan"], ["request.fog", "fog"],
  ["request.mist", "mist"], ["request.drying", "drying"], ["request.hot", "hot_limit"], ["request.cold", "cold_limit"],
];
/** The relays that ran, in board order, with the colour that stands for each (design system v2 §2.3). */
export const RAN_RELAYS: readonly (readonly [equipment: string, token: string])[] = [
  ["heat1", "--eq-heat1"], ["heat2", "--eq-heat2"], ["vent", "--eq-vent"], ["fan1", "--eq-fan1"], ["fan2", "--eq-fan2"], ["fog", "--eq-fog"],
  ["mister_center", "--eq-mister"], ["mister_south", "--eq-mister"], ["mister_west", "--eq-mister"],
];
/** A law request lane is drawn in `--accent` (design system v2 §2.3), and so is a latch. */
export const LAW_LANE_TOKEN = "--accent";

/** What the law asked for: one row per request of `ASKED_LANES` that API-31 sent, named by its rule. */
export function askedRows(history: Pick<LawHistory, "lanes">, range: XRange): StateLaneRow[] {
  return ASKED_LANES.flatMap(([key, rule]) => {
    const lane = history.lanes.find((item) => item.key === key);
    return lane ? [{ key, label: words("law_rule", rule), token: LAW_LANE_TOKEN, group: "asked", spans: spansFromIntervals(lane.intervals, range) }] : [];
  });
}
/** The latches, as reported, in the API's order. */
export function latchRows(history: Pick<LawHistory, "lanes">, range: XRange): StateLaneRow[] {
  return history.lanes.filter((lane) => lane.group === "latch").map((lane) => ({
    key: lane.key, label: words("law_lane", lane.key), token: LAW_LANE_TOKEN, group: "latch", spans: spansFromIntervals(lane.intervals, range),
  }));
}
/** What ran: API-05's climate relays and the clean misters, named as API-05 names them. */
export function ranRows(states: Pick<StateLanes, "lanes">, range: XRange): StateLaneRow[] {
  return RAN_RELAYS.flatMap(([equipment, token]) => {
    const lane = states.lanes.find((item) => item.equipment === equipment);
    return lane ? [{ key: `relay.${equipment}`, label: lane.label ?? equipment, token, group: "ran", spans: spansFromIntervals(lane.intervals, range) }] : [];
  });
}

/** API-31's drying decision as a lane state: running is on, refused a warn hatch, not wanted off, unknown hatched. */
const DECISION_STATE: Readonly<Record<string, string>> = { running: "on", refused: "refused", not_wanted: "off", unknown: "unknown" };
/** The drying decision as one lane (screens §2.3 block 3): running on, not wanted off, a refused span hatched and named by its reason. */
export function decisionRow(history: Pick<LawHistory, "drying">, range: XRange): StateLaneRow {
  const intervals = history.drying.map((item) => ({ start: item.start, end: item.end, state: DECISION_STATE[item.state] ?? "unknown", reason: item.reason ?? null }));
  return {
    key: "drying", label: "Drying", token: "--eq-vent",
    // The lanes say the state ("refused"); a refused span adds its reason.
    spans: spansFromIntervals(intervals, range, (interval) => (interval.state === "refused" ? (interval.reason ? words("drying_refusal", interval.reason) : "reason not reported") : undefined)),
  };
}

// ---------------------------------------------------------------------------------------------------- the price chart
/** A refused span, in epoch seconds, with its reason in words. */
export type RefusedSpan = { readonly from: number; readonly to: number; readonly reason: string };
export type PriceModel = {
  readonly t: readonly number[];
  readonly cost: readonly (number | null)[];
  readonly limit: readonly (number | null)[];
  readonly refused: readonly RefusedSpan[];
  readonly bucketSeconds: number;
  /** No price and no limit anywhere in the window. */
  readonly empty: boolean;
};

/** API-31's price and limit series, and its refused spans clamped to the window (screens §2.3 block 3). */
export function buildPriceModel(history: Pick<LawHistory, "cost" | "drying" | "from" | "to">): PriceModel {
  const range = windowRange(history);
  const refused = history.drying.filter((item) => item.state === "refused").flatMap((item) => {
    const from = Math.max(range.from, Date.parse(item.start) / 1000), to = Math.min(range.to, Date.parse(item.end) / 1000);
    return Number.isFinite(from) && Number.isFinite(to) && to > from ? [{ from, to, reason: item.reason ? words("drying_refusal", item.reason) : "reason not reported" }] : [];
  });
  const { t, cost_kwh_per_kg: cost, limit_kwh_per_kg: limit } = history.cost;
  const known = (values: readonly (number | null)[]) => values.some((value) => value !== null && Number.isFinite(value));
  return { t, cost, limit, refused, bucketSeconds: history.cost.bucket_s, empty: !known(cost) && !known(limit) };
}

/** The refused span at `at` (epoch s), if any. */
export const refusedAt = (model: Pick<PriceModel, "refused">, at: number): RefusedSpan | null => model.refused.find((span) => at >= span.from && at < span.to) ?? null;
