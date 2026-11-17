// SPDX-License-Identifier: MIT
import { useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import type uPlot from "uplot";
import { dayTitle, formatNumber, formatValue, localDayStart, unitDecimals } from "../lib/format";
import { BAR_GAP, SO_FAR_ALPHA, SO_FAR_WORDS, type ChartColors, type PaintTarget } from "./draw";
import { AXIS_FONT, axisLabel, fitEdges } from "./time-axis";
import { tickDecimals, tickIncrements } from "./time-series";
import type { XRange } from "./types";

/**
 * What the daily kinds share (design system v2 §5): a local day's place on the time axis, the bar geometry (a 2 px gap
 * between neighbours, a 4 px radius at the data end), the day axis, the amount axis that always starts at 0, a fitted
 * maximum, the default words for a value, and the keyboard readout that moves along the days and opens one.
 */
export const DAY = 86_400;
/** A local day's place on the x axis: its America/Denver midnight, so the day's tick sits under its bar. */
export const dayAt = (date: string): number => Date.parse(localDayStart(date)) / 1000;
/** The x window of a run of days: half a day either side of the first and the last. */
export function dayRange(ats: readonly number[]): XRange {
  const first = ats[0] ?? 0, last = ats[ats.length - 1] ?? first;
  return { from: first - DAY / 2, to: last + DAY / 2 };
}

/** The reserved heights (charts.css): sm 7.5rem, md 12.5rem. */
export type DailySize = "sm" | "md";
export const fixedPlotClass = (size: DailySize = "md") => `plot-fixed plot-fixed-${size}`;

/** A bar is never wider than this many CSS px, so a week of bars does not read as blocks. */
export const DAILY_BAR_MAX = 40;
/** A bar's width in canvas px: the narrowest day spacing less the 2 px gap, at least 1 px, at most `DAILY_BAR_MAX`. */
export function dailyBarWidth(plot: PaintTarget, ats: readonly number[], px: number, max = DAILY_BAR_MAX): number {
  let narrowest = Infinity;
  for (let index = 1; index < ats.length; index++) narrowest = Math.min(narrowest, Math.abs(plot.valToPos(ats[index], "x", true) - plot.valToPos(ats[index - 1], "x", true)));
  if (!Number.isFinite(narrowest)) narrowest = Math.min(plot.bbox.width, max * px * 2);
  return Math.max(px, Math.min(narrowest - BAR_GAP * px, max * px));
}

/**
 * A bar segment from `bottom` to `top` (canvas px, `top` above `bottom`): square at both ends, the gap under the next
 * segment left as the surface. A day still in progress fills lighter with a 1 px outline in its own colour.
 */
export function paintSegment(ctx: CanvasRenderingContext2D, box: { left: number; width: number; top: number; bottom: number }, color: string, px: number, soFar = false) {
  const height = box.bottom - box.top;
  if (box.width <= 0 || height <= 0) return;
  ctx.save();
  try {
    ctx.fillStyle = color;
    if (soFar) ctx.globalAlpha = SO_FAR_ALPHA;
    ctx.fillRect(box.left, box.top, box.width, height);
    if (soFar) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = px;
      ctx.setLineDash([]);
      ctx.strokeRect(box.left, box.top, box.width, height);
    }
  } finally {
    ctx.restore();
  }
}

/** Day labels ("Oct 28") under the plot; ticks a day or more apart, up to a quarter apart for a long window. */
export function dayAxis(colors: ChartColors, show = true): uPlot.Axis {
  return {
    show, stroke: colors["--text-3"], font: AXIS_FONT, size: 28, space: 52, grid: { show: false },
    ticks: { stroke: colors["--c-grid"], width: 1, size: 4 },
    incrs: [DAY, 2 * DAY, 7 * DAY, 14 * DAY, 28 * DAY, 56 * DAY, 91 * DAY],
    values: (plot, splits) => fitEdges(plot, splits, splits.map((split) => axisLabel(split, false, DAY))),
  };
}

/** The decimals a unit's ticks may print: a count none, else as `formatValue` prints the unit. */
export const amountDecimals = (unit: string) => (unit === "starts" || unit === "count" ? 0 : unitDecimals(unit));
/** The amount axis: 0 at the foot, numbers only (the unit is in the title), one width so stacked charts line up. */
export function amountAxis(unit: string, colors: ChartColors, size = 48): uPlot.Axis {
  const decimals = amountDecimals(unit);
  return {
    stroke: colors["--text-3"], font: AXIS_FONT, size, space: 24,
    grid: { stroke: colors["--c-grid"], width: 1 }, ticks: { stroke: colors["--c-grid"], width: 1, size: 4 },
    incrs: tickIncrements(decimals),
    values: (_plot, splits, _axis, _space, increment) => splits.map((split) => formatNumber(split, Math.min(decimals, tickDecimals(increment, unit)))),
  };
}

/** A y maximum that leaves room over the tallest mark: 1, 2, 2.5 or 5 times a power of ten; 1 with nothing to show. */
export function fitMax(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 1;
  const target = peak * 1.1;
  const power = 10 ** Math.floor(Math.log10(target));
  for (const multiple of [1, 2, 2.5, 5, 10]) if (multiple * power >= target - 1e-9) return Number((multiple * power).toPrecision(12));
  return target;
}

/** A value in words, the default of every daily kind: "12 starts", "1 start", else `formatValue` in the unit. */
export function amountWords(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (unit === "starts") {
    const whole = Math.round(value);
    return `${formatNumber(whole, 0)} ${whole === 1 ? "start" : "starts"}`;
  }
  return formatValue(value, unit);
}

/** A day's head in a tooltip or a table: "Nov 16", "Nov 17 · so far", "Nov 15 · partial meter coverage". */
export function dayHead(date: string, partial?: boolean, note?: string): string {
  const qualifier = note ?? (partial ? SO_FAR_WORDS : undefined);
  return qualifier ? `${dayTitle(date, "short")} · ${qualifier}` : dayTitle(date, "short");
}

/** The words of a day's qualifier for a table or CSV: its note, "so far" for a partial day, else empty. */
export const dayNote = (day: { partial?: boolean; note?: string }) => day.note ?? (day.partial ? SO_FAR_WORDS : "");

/**
 * The keyboard readout of a daily chart: the chart is one tab stop; ←/→ move between days, Home and End to the first and
 * the last, and Enter opens the day when the page can (`onPick`). The cursor follows, so the tooltip reads the day, and
 * the same words go to a polite live region for a screen reader. A pointer move takes the cursor back.
 */
export function useDayKeys(plotRef: MutableRefObject<uPlot | null>, dates: readonly string[], words: (index: number) => string, onPick?: (date: string) => void) {
  const [active, setActive] = useState<number | null>(null);
  const keyed = useRef(false);
  const move = (index: number) => {
    const plot = plotRef.current;
    const clamped = Math.max(0, Math.min(dates.length - 1, index));
    setActive(clamped);
    keyed.current = true;
    if (plot && typeof plot.setCursor === "function") {
      const at = dayAt(dates[clamped]);
      plot.setCursor({ left: plot.valToPos(at, "x"), top: (plot.over?.clientHeight ?? 0) / 2 });
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!dates.length) return;
    const current = active ?? dates.length - 1;
    if (event.key === "ArrowRight") move(active === null ? current : current + 1);
    else if (event.key === "ArrowLeft") move(active === null ? current : current - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(dates.length - 1);
    else if (event.key === "Enter" && onPick && active !== null) onPick(dates[active]);
    else return;
    event.preventDefault();
  };
  const onBlur = () => { keyed.current = false; setActive(null); };
  return { active, keyed, onKeyDown, onBlur, readout: active === null ? "" : words(active) };
}
