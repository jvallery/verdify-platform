// SPDX-License-Identifier: MIT
import { useMemo, useRef, type MutableRefObject } from "react";
import type uPlot from "uplot";
import { dayTitle } from "../lib/format";
import { dayCsvFilename, tableCsv } from "./csv";
import { ChartFoot, type DataTableBlock } from "./data-table";
import { DAY, amountAxis, amountWords, dailyBarWidth, fixedPlotClass, dayAt, dayAxis, dayHead, dayNote, dayRange, fitMax, useDayKeys } from "./daily";
import { CHART_BACKGROUND, Labels, SO_FAR_WORDS, paintBar, paintHatch, paintThresholds, type ChartColors, type PaintTarget, type Threshold } from "./draw";
import { ChartKey, useChartGroupKey, type KeyItem } from "./legend";
import { tooltipPlugin } from "./tooltip";
import type { XRange } from "./types";
import { UPlotChart, type ChartEnv, type ChartOptions } from "./uplot-chart";

/**
 * DailyBars (design system v2 §5): one measure per America/Denver day, one bar a day from 0 in the measure's token, with
 * a 4 px radius at its top and a 2 px gap between bars. A day still in progress, or a day whose record is partial, is
 * drawn lighter and named "so far" (or its own note); a day with no record is a hatched gap, never a zero. The mean of the
 * last 7 complete days is a solid line across those days and the 30-day mean a dashed reference line across the plot;
 * an optional threshold is a labelled warning or critical line. The chart names its one series in its title; its key
 * names the marks that are not the series.
 */
export type DailyBarDay = {
  readonly date: string;
  /** null is a day with no record: a gap, never a zero. */
  readonly value: number | null;
  /** The day is still in progress or its record is partial: drawn lighter, labelled "so far" or `note`. */
  readonly partial?: boolean;
  /** A short qualifier for the tooltip and the table: "so far", "partial meter coverage", "lower bound". */
  readonly note?: string;
};
export type DailyBarsProps = {
  title: string;
  /** The unit word after a value: "kWh", "h", "%", "starts", "gal", "kg". */
  unit: string;
  days: readonly DailyBarDay[];
  token: string;
  /** Mean of the last 7 complete days: a solid line across those days. */
  mean7?: number | null;
  /** Mean of the last 30 complete days: a dashed reference line across the plot. */
  mean30?: number | null;
  threshold?: { value: number; label: string; tone: "warn" | "critical" };
  /** A fixed y maximum (100 for a share); fitted when omitted. The y axis always starts at 0. */
  max?: number;
  format?: (value: number) => string;
  /** Reserved height: sm 7.5rem, md 12.5rem (default md). */
  size?: "sm" | "md";
  /** Charts with one key share a cursor. */
  syncKey?: string;
  /** Activating a bar (click, Enter): the page opens that day. */
  onPick?: (date: string) => void;
  captionHidden?: boolean;
  /** Its own key above the plot (default true); false, or a `ChartGroup` around it, leaves the key to the group (A3). */
  legend?: boolean;
};

export type DailyBar = DailyBarDay & { readonly at: number };
export type DailyBarsModel = {
  readonly title: string;
  readonly unit: string;
  readonly days: readonly DailyBar[];
  readonly xRange: XRange;
  readonly yMax: number;
  readonly mean7: number | null;
  readonly mean30: number | null;
  /** Where the 7-day mean line runs: across the last 7 complete days; null with no mean or no complete day. */
  readonly meanSpan: XRange | null;
  readonly thresholds: readonly Threshold[];
};

const valued = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** The days in date order, each at its local midnight; one that does not parse is left out. */
export function dailyDays<T extends { readonly date: string }>(days: readonly T[]): (T & { readonly at: number })[] {
  return days.map((day) => ({ ...day, at: dayAt(day.date) })).filter((day) => Number.isFinite(day.at)).sort((a, b) => a.at - b.at);
}

/** The span of the last 7 complete (not partial) days, from the first one's start to the last one's end. */
export function completeSpan(days: readonly { readonly at: number; readonly partial?: boolean }[], count = 7): XRange | null {
  let last = days.length - 1;
  while (last >= 0 && days[last].partial) last--;
  if (last < 0) return null;
  const first = Math.max(0, last - (count - 1));
  return { from: days[first].at - DAY / 2, to: days[last].at + DAY / 2 };
}

export function buildDailyBars(input: Pick<DailyBarsProps, "title" | "unit" | "days" | "mean7" | "mean30" | "threshold" | "max">): DailyBarsModel {
  const days = dailyDays(input.days).map((day): DailyBar => ({ ...day, value: valued(day.value) ? day.value : null }));
  const mean7 = valued(input.mean7) ? input.mean7 : null;
  const mean30 = valued(input.mean30) ? input.mean30 : null;
  const thresholds: Threshold[] = input.threshold && valued(input.threshold.value) ? [{ value: input.threshold.value, level: input.threshold.tone, label: input.threshold.label }] : [];
  const peak = Math.max(0, ...days.map((day) => day.value ?? 0), mean7 ?? 0, mean30 ?? 0, ...thresholds.map((threshold) => threshold.value));
  return {
    title: input.title, unit: input.unit, days, xRange: dayRange(days.map((day) => day.at)),
    yMax: valued(input.max) && input.max > 0 ? input.max : fitMax(peak),
    mean7, mean30, meanSpan: mean7 === null ? null : completeSpan(days), thresholds,
  };
}

type Format = (value: number) => string;

/** The tooltip and the keyboard readout for day `index`: the day and its qualifier, then its value or "no record". */
export function dailyBarsTooltip(model: DailyBarsModel, index: number | null | undefined, format: Format): string[] | null {
  if (index === null || index === undefined || index < 0 || index >= model.days.length) return null;
  const day = model.days[index];
  const lines = [dayHead(day.date, day.partial, day.note), day.value === null ? "no record" : format(day.value)];
  if (model.mean7 !== null) lines.push(`7-day mean ${format(model.mean7)}`);
  return lines;
}

/** The mean lines: the 7-day mean solid across its days, the 30-day mean dashed across the plot, each named at its end. */
export function paintMeans(plot: PaintTarget, model: Pick<DailyBarsModel, "mean7" | "mean30" | "meanSpan">, colors: ChartColors, px: number, labels: Labels, format: Format) {
  const { ctx, bbox } = plot;
  const line = (value: number, from: number, to: number, color: string, width: number, dash: number[]) => {
    const y = plot.valToPos(value, "y", true);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(from, y);
    ctx.lineTo(to, y);
    ctx.stroke();
    return y;
  };
  ctx.save();
  try {
    const right = bbox.left + bbox.width;
    if (model.mean30 !== null) {
      const y = line(model.mean30, bbox.left, right, colors["--text-3"], px, [4 * px, 4 * px]);
      labels.place(`30-day mean ${format(model.mean30)}`, [{ at: bbox.left + 4 * px, line: y, align: "left" }], colors["--text-3"]);
    }
    if (model.mean7 !== null && model.meanSpan) {
      const from = Math.max(bbox.left, plot.valToPos(model.meanSpan.from, "x", true)), to = Math.min(right, plot.valToPos(model.meanSpan.to, "x", true));
      if (to > from) {
        const y = line(model.mean7, from, to, colors["--text"], 2 * px, []);
        labels.place(`7-day mean ${format(model.mean7)}`, [{ at: to - 4 * px, line: y, align: "right" }, { at: from + 4 * px, line: y, align: "left" }], colors["--text"]);
      }
    }
  } finally {
    ctx.restore();
  }
}

/** draw: each day's bar (a "so far" day lighter, a day with no record hatched), the means, then the threshold. */
export function paintDailyBars(plot: PaintTarget, model: DailyBarsModel, token: string, colors: ChartColors, px: number, format: Format) {
  const { ctx, bbox } = plot;
  const width = dailyBarWidth(plot, model.days.map((day) => day.at), px);
  const base = plot.valToPos(0, "y", true);
  ctx.save();
  try {
    for (const day of model.days) {
      const left = plot.valToPos(day.at, "x", true) - width / 2;
      if (day.value === null) paintHatch(ctx, left, bbox.top, width, bbox.height, colors["--text-3"], px);
      else paintBar(ctx, { left, width, base, value: plot.valToPos(day.value, "y", true) }, colors[token] ?? colors["--text"], px, { soFar: day.partial === true });
    }
  } finally {
    ctx.restore();
  }
  const labels = new Labels(plot, px, colors[CHART_BACKGROUND] ?? "");
  paintMeans(plot, model, colors, px, labels, format);
  paintThresholds(plot, model.thresholds, colors, px, labels);
}

/**
 * The options: the bars are drawn in the draw hook (the series draws nothing; it carries the values for the cursor), a
 * day axis, an amount axis from 0, the tooltip on the chart under the pointer or the keyboard, and a click that opens the
 * day under the pointer.
 */
export function dailyBarsOptions(env: ChartEnv, modelRef: MutableRefObject<DailyBarsModel>, token: string, formatRef: MutableRefObject<Format>, keyed: MutableRefObject<boolean>, pickRef: MutableRefObject<((date: string) => void) | undefined>): ChartOptions {
  const { colors, px } = env;
  const model = modelRef.current;
  return {
    padding: [12, 12, 0, 0],
    series: [{}, { label: model.title, scale: "y", paths: () => null, stroke: colors[token], width: 0, points: { show: false } }],
    scales: { y: { range: () => [0, modelRef.current.yMax] } },
    axes: [dayAxis(colors), amountAxis(model.unit, colors)],
    cursor: { points: { show: false } },
    hooks: {
      draw: [(plot) => paintDailyBars(plot, modelRef.current, token, colors, px(), formatRef.current)],
      ready: [(plot) => plot.over.addEventListener("click", () => {
        const index = plot.cursor.idx;
        const day = index === null || index === undefined ? undefined : modelRef.current.days[index];
        if (day && pickRef.current) pickRef.current(day.date);
      })],
    },
    plugins: [tooltipPlugin((plot) => (plot.cursor.event || keyed.current ? dailyBarsTooltip(modelRef.current, plot.cursor.idx, formatRef.current) : null), env.syncKey)],
  };
}

/** One row per day: its value (or "—"), and its note ("so far", "no record"). */
export function dailyBarsTable(model: DailyBarsModel, format: Format): DataTableBlock {
  return {
    caption: `${model.title} · America/Denver`, headers: ["Day", `${model.title} (${model.unit})`, "Note"], count: model.days.length,
    rows: () => model.days.map((day) => [
      <time key="day" dateTime={day.date}>{dayTitle(day.date, "short")}</time>,
      day.value === null ? "—" : format(day.value),
      day.value === null ? "no record" : dayNote(day),
    ]),
  };
}

/** "CSV of this chart": one row per local day, an empty cell for a day with no record (never 0), and its note. */
export function dailyBarsCsv(model: DailyBarsModel): string {
  return tableCsv(
    ["day (America/Denver)", `${model.title} (${model.unit})`, "note"],
    model.days.map((day) => [day.date, day.value, day.value === null ? "no record" : dayNote(day)]),
  );
}

const thresholdToken = (threshold: Threshold) => (threshold.level === "critical" ? "--critical" : "--warn");

/** The key: the marks that are not the series, as drawn: the lighter days, the gaps, the means and the threshold. */
export function dailyBarsKey(model: DailyBarsModel, token: string): KeyItem[] {
  const items: KeyItem[] = [];
  const partial = [...new Set(model.days.filter((day) => day.partial && day.value !== null).map((day) => day.note ?? SO_FAR_WORDS))];
  if (partial.length) items.push({ key: "so-far", label: `lighter: ${partial.join(", ")}`, token, kind: "outline" });
  if (model.days.some((day) => day.value === null)) items.push({ key: "no-record", label: "no record", token: "--text-3", kind: "hatch" });
  if (model.mean7 !== null && model.meanSpan) items.push({ key: "mean7", label: "7-day mean, complete days", token: "--text", kind: "line" });
  if (model.mean30 !== null) items.push({ key: "mean30", label: "30-day mean", token: "--text-3", kind: "dashed" });
  for (const threshold of model.thresholds) items.push({ key: `threshold-${threshold.value}`, label: threshold.label, token: thresholdToken(threshold), kind: "dashed" });
  return items;
}

/** Names what is plotted and says how to move and that a table follows. */
export function dailyBarsLabel(model: DailyBarsModel): string {
  return `${model.title} per day for ${model.days.length} ${model.days.length === 1 ? "day" : "days"}, in ${model.unit}, from 0. Days still in progress are lighter; days with no record are hatched, never zero. The data table follows.`;
}

export function DailyBars(props: DailyBarsProps) {
  const { title, unit, token, size = "md", syncKey, onPick, captionHidden = false } = props;
  // Days arrive as a fresh array on every poll: the bars rebuild only when their values change.
  const key = JSON.stringify([props.days, props.mean7 ?? null, props.mean30 ?? null, props.threshold ?? null, props.max ?? null]);
  const model = useMemo(() => buildDailyBars({ title, unit, days: props.days, mean7: props.mean7, mean30: props.mean30, threshold: props.threshold, max: props.max }), [key, title, unit]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const format: Format = props.format ?? ((value) => amountWords(value, unit));
  const formatRef = useRef(format);
  formatRef.current = format;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const plotRef = useRef<uPlot | null>(null);
  const keys = useDayKeys(plotRef, model.days.map((day) => day.date), (index) => (dailyBarsTooltip(model, index, format) ?? []).join(", "), onPick);
  const data = useMemo<uPlot.AlignedData>(() => [model.days.map((day) => day.at), model.days.map((day) => day.value)], [model]);
  const plotClass = `${fixedPlotClass(size)}${onPick ? " plot-daily-pick" : ""}`;
  const first = model.days[0], last = model.days[model.days.length - 1];
  const legend = first && last ? dailyBarsKey(model, token) : [];
  const grouped = useChartGroupKey(legend);
  return <figure className="chart chart-daily">
    <figcaption className={captionHidden ? "screen-reader" : "eyebrow"}>{title}</figcaption>
    {first && last
      ? <>
        {!grouped && (props.legend ?? true) && <ChartKey items={legend} />}
        <div className="daily-focus" tabIndex={0} role="group" aria-label={`${title}: arrow keys move between days${onPick ? ", Enter opens the day" : ""}`}
          onKeyDown={keys.onKeyDown} onBlur={keys.onBlur} onMouseMove={() => { keys.keyed.current = false; }}>
          <UPlotChart options={(env) => dailyBarsOptions(env, modelRef, token, formatRef, keys.keyed, pickRef)} data={data} xRange={model.xRange}
            structure={`daily-bars|${unit}|${token}|${size}|${syncKey ?? ""}`} className={plotClass} label={dailyBarsLabel(model)} syncKey={syncKey} marks={model} zoom={false}
            onPlot={(plot) => { plotRef.current = plot; }} />
        </div>
        <p className="screen-reader" aria-live="polite">{keys.readout}</p>
        <ChartFoot tables={[dailyBarsTable(model, format)]} csv={{ filename: dayCsvFilename(title, first.date, last.date), build: () => dailyBarsCsv(model), version: model }} />
      </>
      : <div className={`${fixedPlotClass(size)} chart-message`}><p>No days to show</p></div>}
  </figure>;
}
