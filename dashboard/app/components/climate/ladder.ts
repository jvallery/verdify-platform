// SPDX-License-Identifier: MIT
/**
 * The rule ladder's model (design system v2 §5, "Rule ladder"; screens §2.1 block 2): one axis per signal with the band
 * as a zone, each rule's on value as a labelled tick, and the reading as a marker. Pure, so the geometry and the label
 * rows are tested without a browser. Positions are percentages of the track, so the SVG scales with its box.
 *
 * The two protection limits (40 °F and 100 °F) sit far from the band, so the axis is broken: the band, the reading
 * and every other rule share one linear stretch, and a limit outside it stands in an end zone past a break mark.
 */
import { formatNumber, unitDecimals } from "../../lib/format";
import type { RuleStateKind } from "./law";

/** One rule on the ladder. */
export type LadderRule = {
  readonly id: string;
  /** Its name: "Electric heat". */
  readonly label: string;
  /** Where it turns on, in the signal's unit. */
  readonly on: number;
  /** Where it turns off; null or equal to `on` for a limit. */
  readonly off: number | null;
  readonly direction: "below" | "above";
  readonly state: RuleStateKind;
  /** A protection limit, which may stand in an end zone. */
  readonly limit?: boolean;
};
export type LadderInput = {
  readonly unit: string;
  readonly band: { readonly low: number; readonly high: number } | null;
  readonly reading: number | null;
  readonly rules: readonly LadderRule[];
};
export type PlacedRule = LadderRule & {
  /** Position on the track, 0 to 100. */
  readonly at: number;
  /** The label row above the track, 0 nearest it. */
  readonly row: number;
  readonly anchor: "start" | "middle" | "end";
  /** The label: its name and its on value with no unit (the ladder's caption names the unit once). */
  readonly text: string;
  /** A limit drawn in an end zone, past a break in the axis. */
  readonly beyond: boolean;
};
/** One entry of the phone's list, in the ladder's left-to-right order. */
export type LadderEntry =
  | { readonly kind: "rule"; readonly value: number; readonly rule: PlacedRule }
  | { readonly kind: "edge"; readonly value: number; readonly side: "low" | "high" }
  | { readonly kind: "reading"; readonly value: number };
export type LadderModel = {
  /** The linear stretch's ends, in the signal's unit. */
  readonly scale: { readonly low: number; readonly high: number };
  readonly rules: readonly PlacedRule[];
  readonly band: { readonly from: number; readonly to: number } | null;
  readonly reading: { readonly at: number; readonly clamped: "low" | "high" | null } | null;
  /** How many label rows the ticks need above the track. */
  readonly rows: number;
  /** Where the axis breaks for a limit in an end zone. */
  readonly breaks: { readonly low: boolean; readonly high: boolean };
  readonly entries: readonly LadderEntry[];
};

/** The linear stretch takes the track between these, with end zones beyond them for the limits. */
export const INNER = { from: 9, to: 91 } as const;
/** Where a limit in an end zone stands, and where the break mark is drawn. */
export const END_AT = { low: 2, high: 98 } as const;
export const BREAK_AT = { low: 5.5, high: 94.5 } as const;
/** The most label rows above the track. */
export const MAX_ROWS = 3;
/** The narrowest track the horizontal ladder is drawn at (its container query, climate.css), for the label rows. */
export const NOMINAL_WIDTH_PX = 520;
/** The label font's advance (11 px IBM Plex Mono) and the room kept between two labels on one row. */
const CHAR_PX = 6.7;
const GAP_PX = 10;
/** Padding of the linear stretch past its outermost value, at least this much of the unit. */
const MIN_PAD: Readonly<Record<string, number>> = { "°F": 1, kPa: 0.05 };

const finite = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value);

/** The tick's label: "Electric heat 67.9" (°F at one decimal, kPa at two). */
export const tickText = (label: string, on: number, unit: string): string => `${label} ${formatNumber(on, unitDecimals(unit))}`;

/** The label's anchor: near either end it grows inwards, so it never leaves the track. */
export function anchorAt(at: number): "start" | "middle" | "end" {
  return at < 14 ? "start" : at > 86 ? "end" : "middle";
}
/** A label's extent in pixels on a track `width` wide. */
function extent(at: number, text: string, width: number): [number, number] {
  const x = (at / 100) * width, w = text.length * CHAR_PX;
  const anchor = anchorAt(at);
  return anchor === "start" ? [x, x + w] : anchor === "end" ? [x - w, x] : [x - w / 2, x + w / 2];
}

/**
 * Label rows, nearest the track first: each label, from left to right, takes the lowest row where it overlaps no other
 * on a track of the narrowest width it is drawn at; past the last row it takes the row whose last label ends earliest.
 */
export function labelRows(items: readonly { at: number; text: string }[], width = NOMINAL_WIDTH_PX, maxRows = MAX_ROWS): number[] {
  const ends: number[] = [];
  const order = items.map((item, index) => ({ ...item, index })).sort((a, b) => a.at - b.at);
  const rows = new Array<number>(items.length).fill(0);
  for (const item of order) {
    const [left, right] = extent(item.at, item.text, width);
    let row = ends.findIndex((end) => left >= end + GAP_PX);
    if (row < 0) row = ends.length < maxRows ? ends.length : ends.indexOf(Math.min(...ends));
    ends[row] = Math.max(ends[row] ?? Number.NEGATIVE_INFINITY, right);
    rows[item.index] = row;
  }
  return rows;
}

/**
 * Places the rules, the band and the reading on one track. Null when there is nothing to place (no band, no reading
 * and no thresholds): the block then says the law has not reported.
 */
export function buildLadder({ unit, band, reading, rules }: LadderInput): LadderModel | null {
  const shownBand = band && finite(band.low) && finite(band.high) && band.high >= band.low ? band : null;
  const inner = [
    ...(shownBand ? [shownBand.low, shownBand.high] : []),
    ...(finite(reading) ? [reading] : []),
    ...rules.filter((rule) => !rule.limit).flatMap((rule) => [rule.on, ...(finite(rule.off) ? [rule.off] : [])]),
  ].filter(finite);
  if (!inner.length) return null;
  const min = Math.min(...inner), max = Math.max(...inner);
  const pad = Math.max((max - min) * 0.06, MIN_PAD[unit] ?? 0);
  const scale = { low: min - pad, high: max + pad };
  const position = (value: number) => INNER.from + ((value - scale.low) / (scale.high - scale.low)) * (INNER.to - INNER.from);
  const placed = rules.filter((rule) => finite(rule.on)).map((rule) => {
    const beyond = !!rule.limit && (rule.on < scale.low || rule.on > scale.high);
    const at = beyond ? (rule.on < scale.low ? END_AT.low : END_AT.high) : position(rule.on);
    return { ...rule, at, beyond, anchor: anchorAt(at), text: tickText(rule.label, rule.on, unit) };
  });
  const rows = labelRows(placed);
  const withRows: PlacedRule[] = placed.map((rule, index) => ({ ...rule, row: rows[index] }));
  let shownReading: LadderModel["reading"] = null;
  if (finite(reading)) {
    const clamped = reading < scale.low ? "low" : reading > scale.high ? "high" : null;
    shownReading = { at: clamped === "low" ? INNER.from : clamped === "high" ? INNER.to : position(reading), clamped };
  }
  const entries: LadderEntry[] = [
    ...withRows.map((rule): LadderEntry => ({ kind: "rule", value: rule.on, rule })),
    ...(shownBand ? [{ kind: "edge", value: shownBand.low, side: "low" } as const, { kind: "edge", value: shownBand.high, side: "high" } as const] : []),
    ...(finite(reading) ? [{ kind: "reading", value: reading } as const] : []),
  ];
  // Equal values keep a fixed order: a low edge before the rules on it, a high edge after them, the reading last.
  const rank = (entry: LadderEntry) => (entry.kind === "edge" ? (entry.side === "low" ? 0 : 2) : entry.kind === "rule" ? 1 : 3);
  entries.sort((a, b) => a.value - b.value || rank(a) - rank(b));
  return {
    scale,
    rules: withRows,
    band: shownBand ? { from: position(shownBand.low), to: position(shownBand.high) } : null,
    reading: shownReading,
    rows: withRows.length ? Math.max(...withRows.map((rule) => rule.row)) + 1 : 0,
    breaks: { low: withRows.some((rule) => rule.beyond && rule.at === END_AT.low), high: withRows.some((rule) => rule.beyond && rule.at === END_AT.high) },
    entries,
  };
}
