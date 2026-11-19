// SPDX-License-Identifier: MIT
/**
 * The rule ladder's model (design system v2 §5, "Rule ladder"; screens §2.1 block 2): one axis per signal with the band
 * as a zone, each rule's on value as a labelled tick, and the reading as a marker. Pure, so the geometry and the label
 * rows are tested without a browser. Positions are percentages of the track, so the SVG scales with its box.
 *
 * The two protection limits (40 °F and 100 °F) sit far from the band, so the axis is broken: the band, the reading
 * and every other rule share one linear stretch, and a limit outside it stands in an end zone past a break mark. A
 * reading past such a limit stands in that end zone with it, marked as past the scale.
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
/** How far past its limit's tick a reading in an end zone stands, in percent of the track. */
export const PAST_LIMIT = 1;
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

/** Two labels overlapping on one row cost this many line crossings: a crossed label is still read, an overlapped one is not. */
const OVERLAP_WEIGHT = 3;
/** Above this many labels the rows are chosen greedily rather than by trying every arrangement. */
const EXHAUSTIVE_UP_TO = 8;

/**
 * Label rows, nearest the track first, on a track of the narrowest width the ladder is drawn at. Two things must not
 * happen: two labels on one row overlapping, and a tick's line (which runs from its label down to the track) crossing
 * a label on a lower row, as "Gas furnace" once struck through "Cold limit 40.0". Every arrangement of up to
 * `EXHAUSTIVE_UP_TO` labels in `maxRows` rows is tried, and the one with the fewest clashes wins, then the one closest
 * to the track. Past that, each label takes the lowest row where it overlaps no other.
 */
export function labelRows(items: readonly { at: number; text: string }[], width = NOMINAL_WIDTH_PX, maxRows = MAX_ROWS): number[] {
  const spans = items.map((item) => extent(item.at, item.text, width));
  const xs = items.map((item) => (item.at / 100) * width);
  if (items.length > EXHAUSTIVE_UP_TO) return greedyRows(spans, maxRows, items.map((item) => item.at));
  const clashes = (rows: readonly number[]) => {
    let count = 0;
    for (let a = 0; a < items.length; a++) {
      for (let b = 0; b < items.length; b++) {
        if (a === b) continue;
        const [left, right] = spans[a];
        // Overlap on one row (each pair once): unreadable, so it weighs more than a line crossing a label.
        if (a < b && rows[a] === rows[b] && left < spans[b][1] + GAP_PX && spans[b][0] < right + GAP_PX) count += OVERLAP_WEIGHT;
        // b's line, from its higher label down to the track, passes through a's label.
        if (rows[b] > rows[a] && xs[b] > left - 2 && xs[b] < right + 2) count++;
      }
    }
    return count;
  };
  let best: number[] = new Array<number>(items.length).fill(0);
  let bestScore = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const rows = new Array<number>(items.length).fill(0);
  const visit = (index: number) => {
    if (index === items.length) {
      const score = [clashes(rows), Math.max(0, ...rows), rows.reduce((sum, row) => sum + row, 0)];
      if (score[0] < bestScore[0] || (score[0] === bestScore[0] && (score[1] < bestScore[1] || (score[1] === bestScore[1] && score[2] < bestScore[2])))) {
        bestScore = score;
        best = [...rows];
      }
      return;
    }
    for (let row = 0; row < maxRows; row++) {
      rows[index] = row;
      visit(index + 1);
    }
  };
  visit(0);
  return best;
}

/** Each label, from left to right, takes the lowest row where it overlaps no other; past the last row, the row whose last label ends earliest. */
function greedyRows(spans: readonly [number, number][], maxRows: number, at: readonly number[]): number[] {
  const ends: number[] = [];
  const order = at.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const rows = new Array<number>(spans.length).fill(0);
  for (const { index } of order) {
    const [left, right] = spans[index];
    let row = ends.findIndex((end) => left >= end + GAP_PX);
    if (row < 0) row = ends.length < maxRows ? ends.length : ends.indexOf(Math.min(...ends));
    ends[row] = Math.max(ends[row] ?? Number.NEGATIVE_INFINITY, right);
    rows[index] = row;
  }
  return rows;
}

/**
 * Places the rules, the band and the reading on one track. Null when there is nothing to place (no band, no reading
 * and no thresholds): the block then says the law has not reported.
 */
export function buildLadder({ unit, band, reading, rules }: LadderInput): LadderModel | null {
  const shownBand = band && finite(band.low) && finite(band.high) && band.high >= band.low ? band : null;
  const base = [
    ...(shownBand ? [shownBand.low, shownBand.high] : []),
    ...rules.filter((rule) => !rule.limit).flatMap((rule) => [rule.on, ...(finite(rule.off) ? [rule.off] : [])]),
  ].filter(finite);
  const stretch = (values: readonly number[]) => {
    const min = Math.min(...values), max = Math.max(...values);
    const pad = Math.max((max - min) * 0.06, MIN_PAD[unit] ?? 0);
    return { low: min - pad, high: max + pad };
  };
  // A reading past a protection limit that stands in its end zone stands in that end zone too, past the limit's tick:
  // stretching the axis to it would crush every other rule into a corner (the hot limit at 101 °F).
  const without = base.length ? stretch(base) : null;
  const pastLimit = finite(reading) && without ? rules.find((rule) => rule.limit && finite(rule.on)
    && (rule.direction === "above" ? reading >= rule.on && rule.on > without.high : reading <= rule.on && rule.on < without.low)) : undefined;
  const inner = pastLimit || !finite(reading) ? base : [...base, reading];
  if (!inner.length) return null;
  const scale = stretch(inner);
  const position = (value: number) => INNER.from + ((value - scale.low) / (scale.high - scale.low)) * (INNER.to - INNER.from);
  const placed = rules.filter((rule) => finite(rule.on)).map((rule) => {
    const beyond = !!rule.limit && (rule.on < scale.low || rule.on > scale.high);
    const at = beyond ? (rule.on < scale.low ? END_AT.low : END_AT.high) : position(rule.on);
    return { ...rule, at, beyond, anchor: anchorAt(at), text: tickText(rule.label, rule.on, unit) };
  });
  const rows = labelRows(placed);
  const withRows: PlacedRule[] = placed.map((rule, index) => ({ ...rule, row: rows[index] }));
  let shownReading: LadderModel["reading"] = null;
  if (finite(reading) && pastLimit) {
    const high = pastLimit.direction === "above";
    shownReading = { at: high ? END_AT.high + PAST_LIMIT : END_AT.low - PAST_LIMIT, clamped: high ? "high" : "low" };
  } else if (finite(reading)) {
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
