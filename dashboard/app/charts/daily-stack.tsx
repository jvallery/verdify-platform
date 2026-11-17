// SPDX-License-Identifier: MIT
import { useMemo, useRef, type MutableRefObject } from "react";
import type uPlot from "uplot";
import { dayTitle } from "../lib/format";
import { dayCsvFilename, tableCsv } from "./csv";
import { dailyDays } from "./daily-bars";
import { CsvLink, DataTable, type DataTableBlock } from "./data-table";
import { amountAxis, amountWords, dailyBarWidth, fixedPlotClass, dayAxis, dayHead, dayNote, dayRange, fitMax, paintSegment, useDayKeys } from "./daily";
import { BAR_GAP, SO_FAR_WORDS, paintBar, paintHatch, type ChartColors, type PaintTarget } from "./draw";
import { ChartKey, type KeyItem } from "./legend";
import { tooltipPlugin } from "./tooltip";
import type { XRange } from "./types";
import { UPlotChart, type ChartEnv, type ChartOptions } from "./uplot-chart";

/**
 * DailyStack (design system v2 §5): the parts of each America/Denver day stacked in a fixed order, bottom to top, each in
 * its own token, separated by 2 px of the surface, the top part rounded by 4 px. Uses: time in band, below and above;
 * water by use; drying refused by reason. A day still in progress is drawn lighter and named "so far" (or its note); a
 * part with no value is not drawn, and a day with no part at all is a hatched gap, never a zero. The key lists the parts
 * in their order.
 */
export type DailyStackPart = { readonly key: string; readonly label: string; readonly token: string };
export type DailyStackDay = {
  readonly date: string;
  /** One value per part key; a null part is not drawn; all null is a gap. */
  readonly values: Readonly<Record<string, number | null>>;
  readonly partial?: boolean;
  readonly note?: string;
};
export type DailyStackProps = {
  title: string;
  unit: string;
  /** Bottom to top, in a fixed order; the legend lists them in this order. */
  parts: readonly DailyStackPart[];
  days: readonly DailyStackDay[];
  max?: number;
  format?: (value: number) => string;
  size?: "sm" | "md";
  syncKey?: string;
  onPick?: (date: string) => void;
  captionHidden?: boolean;
};

export type StackDay = {
  readonly date: string;
  readonly at: number;
  readonly partial: boolean;
  readonly note?: string;
  /** Per part, in the parts' order: its value, null when it has none. */
  readonly values: readonly (number | null)[];
  /** The sum of the parts that have a value; null when none has (a gap). */
  readonly total: number | null;
};
export type DailyStackModel = {
  readonly title: string;
  readonly unit: string;
  readonly parts: readonly DailyStackPart[];
  readonly days: readonly StackDay[];
  readonly xRange: XRange;
  readonly yMax: number;
};

const valued = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

export function buildDailyStack(input: Pick<DailyStackProps, "title" | "unit" | "parts" | "days" | "max">): DailyStackModel {
  const days = dailyDays(input.days).map((day): StackDay => {
    const values = input.parts.map((part) => {
      const value = day.values[part.key];
      return valued(value) ? value : null;
    });
    const shown = values.filter(valued);
    return { date: day.date, at: day.at, partial: day.partial === true, note: day.note, values, total: shown.length ? shown.reduce((sum, value) => sum + value, 0) : null };
  });
  const peak = Math.max(0, ...days.map((day) => day.total ?? 0));
  return { title: input.title, unit: input.unit, parts: input.parts, days, xRange: dayRange(days.map((day) => day.at)), yMax: valued(input.max) && input.max > 0 ? input.max : fitMax(peak) };
}

type Format = (value: number) => string;

/** The tooltip and the keyboard readout: the day and its qualifier, each part with a value (top first), then the total. */
export function dailyStackTooltip(model: DailyStackModel, index: number | null | undefined, format: Format): string[] | null {
  if (index === null || index === undefined || index < 0 || index >= model.days.length) return null;
  const day = model.days[index];
  const head = dayHead(day.date, day.partial, day.note);
  if (day.total === null) return [head, "no record"];
  const lines = [head];
  for (let position = model.parts.length - 1; position >= 0; position--) {
    const value = day.values[position];
    if (value !== null) lines.push(`${model.parts[position].label} ${format(value)}`);
  }
  if (model.parts.length > 1) lines.push(`Total ${format(day.total)}`);
  return lines;
}

/**
 * draw: each day's parts from 0 up, in order. A part ends 2 px under the next one shown, so the surface separates them;
 * the top part is rounded at its end; a "so far" day fills lighter with an outline; a day with no part is hatched.
 */
export function paintDailyStack(plot: PaintTarget, model: DailyStackModel, colors: ChartColors, px: number) {
  const { ctx, bbox } = plot;
  const width = dailyBarWidth(plot, model.days.map((day) => day.at), px);
  const y = (value: number) => plot.valToPos(value, "y", true);
  ctx.save();
  try {
    for (const day of model.days) {
      const left = plot.valToPos(day.at, "x", true) - width / 2;
      if (day.total === null) {
        paintHatch(ctx, left, bbox.top, width, bbox.height, colors["--text-3"], px);
        continue;
      }
      const shown = day.values.flatMap((value, position) => (value !== null && value > 0 ? [{ value, position }] : []));
      let below = 0;
      shown.forEach(({ value, position }, order) => {
        const color = colors[model.parts[position].token] ?? colors["--text"];
        const bottom = y(below), top = y(below + value);
        below += value;
        if (order === shown.length - 1) {
          paintBar(ctx, { left, width, base: bottom, value: top }, color, px, { soFar: day.partial });
          return;
        }
        // The 2 px gap above this part is the surface; a part thinner than the gap still shows 1 px.
        const gap = Math.min(BAR_GAP * px, Math.max(0, bottom - top - px));
        paintSegment(ctx, { left, width, top: top + gap, bottom }, color, px, day.partial);
      });
    }
  } finally {
    ctx.restore();
  }
}

export function dailyStackOptions(env: ChartEnv, modelRef: MutableRefObject<DailyStackModel>, formatRef: MutableRefObject<Format>, keyed: MutableRefObject<boolean>, pickRef: MutableRefObject<((date: string) => void) | undefined>): ChartOptions {
  const { colors, px } = env;
  const model = modelRef.current;
  return {
    padding: [12, 12, 0, 0],
    // One carrier series of the day's total for the cursor; the parts are drawn in the draw hook.
    series: [{}, { label: model.title, scale: "y", paths: () => null, width: 0, points: { show: false } }],
    scales: { y: { range: () => [0, modelRef.current.yMax] } },
    axes: [dayAxis(colors), amountAxis(model.unit, colors)],
    cursor: { points: { show: false } },
    hooks: {
      draw: [(plot) => paintDailyStack(plot, modelRef.current, colors, px())],
      ready: [(plot) => plot.over.addEventListener("click", () => {
        const index = plot.cursor.idx;
        const day = index === null || index === undefined ? undefined : modelRef.current.days[index];
        if (day && pickRef.current) pickRef.current(day.date);
      })],
    },
    plugins: [tooltipPlugin((plot) => (plot.cursor.event || keyed.current ? dailyStackTooltip(modelRef.current, plot.cursor.idx, formatRef.current) : null), env.syncKey)],
  };
}

/** One row per day: each part (or "—"), the total and the note. */
export function dailyStackTable(model: DailyStackModel, format: Format): DataTableBlock {
  return {
    caption: `${model.title} · America/Denver`,
    headers: ["Day", ...model.parts.map((part) => `${part.label} (${model.unit})`), ...(model.parts.length > 1 ? [`Total (${model.unit})`] : []), "Note"], count: model.days.length,
    rows: () => model.days.map((day) => [
      <time key="day" dateTime={day.date}>{dayTitle(day.date, "short")}</time>,
      ...day.values.map((value) => (value === null ? "—" : format(value))),
      ...(model.parts.length > 1 ? [day.total === null ? "—" : format(day.total)] : []),
      day.total === null ? "no record" : dayNote(day),
    ]),
  };
}

/** "CSV of this chart": one row per local day, a column per part and the total; empty cells where a part has no value. */
export function dailyStackCsv(model: DailyStackModel): string {
  return tableCsv(
    ["day (America/Denver)", ...model.parts.map((part) => `${part.label} (${model.unit})`), `total (${model.unit})`, "note"],
    model.days.map((day) => [day.date, ...day.values, day.total, day.total === null ? "no record" : dayNote(day)]),
  );
}

/** The key: every part in its order, then the lighter days and the gaps. */
export function dailyStackKey(model: DailyStackModel): KeyItem[] {
  const items: KeyItem[] = model.parts.map((part) => ({ key: part.key, label: part.label, token: part.token, kind: "fill" }));
  const partial = [...new Set(model.days.filter((day) => day.partial && day.total !== null).map((day) => day.note ?? SO_FAR_WORDS))];
  if (partial.length) items.push({ key: "so-far", label: `lighter: ${partial.join(", ")}`, token: "--text-3", kind: "outline" });
  if (model.days.some((day) => day.total === null)) items.push({ key: "no-record", label: "no record", token: "--text-3", kind: "hatch" });
  return items;
}

export function dailyStackLabel(model: DailyStackModel): string {
  return `${model.title} per day for ${model.days.length} ${model.days.length === 1 ? "day" : "days"}, in ${model.unit}, stacked bottom to top: ${model.parts.map((part) => part.label).join(", ")}. Days still in progress are lighter; days with no record are hatched, never zero. The data table follows.`;
}

export function DailyStack(props: DailyStackProps) {
  const { title, unit, size = "md", syncKey, onPick, captionHidden = false } = props;
  const key = JSON.stringify([props.parts, props.days, props.max ?? null]);
  const model = useMemo(() => buildDailyStack({ title, unit, parts: props.parts, days: props.days, max: props.max }), [key, title, unit]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const format: Format = props.format ?? ((value) => amountWords(value, unit));
  const formatRef = useRef(format);
  formatRef.current = format;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const plotRef = useRef<uPlot | null>(null);
  const keys = useDayKeys(plotRef, model.days.map((day) => day.date), (index) => (dailyStackTooltip(model, index, format) ?? []).join(", "), onPick);
  const data = useMemo<uPlot.AlignedData>(() => [model.days.map((day) => day.at), model.days.map((day) => day.total)], [model]);
  const plotClass = `${fixedPlotClass(size)}${onPick ? " plot-daily-pick" : ""}`;
  const first = model.days[0], last = model.days[model.days.length - 1];
  return <figure className="chart chart-daily">
    <figcaption className={captionHidden ? "screen-reader" : "eyebrow"}>{title}</figcaption>
    {first && last
      ? <>
        <div className="daily-focus" tabIndex={0} role="group" aria-label={`${title}: arrow keys move between days${onPick ? ", Enter opens the day" : ""}`}
          onKeyDown={keys.onKeyDown} onBlur={keys.onBlur} onMouseMove={() => { keys.keyed.current = false; }}>
          <UPlotChart options={(env) => dailyStackOptions(env, modelRef, formatRef, keys.keyed, pickRef)} data={data} xRange={model.xRange}
            structure={`daily-stack|${unit}|${model.parts.map((part) => `${part.key}:${part.token}`).join(",")}|${size}|${syncKey ?? ""}`} className={plotClass}
            label={dailyStackLabel(model)} syncKey={syncKey} marks={model} zoom={false} onPlot={(plot) => { plotRef.current = plot; }} />
        </div>
        <p className="screen-reader" aria-live="polite">{keys.readout}</p>
        <ChartKey items={dailyStackKey(model)} />
        <div className="chart-tools">
          <CsvLink filename={dayCsvFilename(title, first.date, last.date)} build={() => dailyStackCsv(model)} version={model} label="CSV of this chart" />
        </div>
        <DataTable tables={[dailyStackTable(model, format)]} />
      </>
      : <div className={`${fixedPlotClass(size)} chart-message`}><p>No days to show</p></div>}
  </figure>;
}
