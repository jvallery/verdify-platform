// SPDX-License-Identifier: MIT
import { useMemo, useRef, type MutableRefObject } from "react";
import type uPlot from "uplot";
import { formatValue } from "../lib/format";
import { csvFilename, csvText } from "./csv";
import { fixedPlotClass } from "./daily";
import { ChartFoot, TimeCell, type DataTableBlock } from "./data-table";
import { paintThresholds, type Threshold } from "./draw";
import { ChartKey, useChartGroupKey, type KeyItem } from "./legend";
import { fullTime, timeAxis } from "./time-axis";
import { isolatedPoints, valueAxis } from "./time-series";
import { cursorX, tooltipPlugin } from "./tooltip";
import type { XRange } from "./types";
import { UPlotChart, type ChartEnv, type ChartOptions } from "./uplot-chart";

/**
 * ThresholdSeries (design system v2 §5): one measured line, 2 px in its token, against labelled warning and critical
 * lines (1.5 px dashed in `--warn` and `--critical`, their words in the status text colour): the controller's hardware
 * budget. A missing reading is a gap, never a zero; a lone reading between gaps shows as a point. The y range always
 * holds every threshold, so a limit is never off the chart. One series, so the title names it and there is no legend.
 */
export type ThresholdLine = { readonly value: number; readonly label: string; readonly tone: "warn" | "critical" };
export type ThresholdSeriesProps = {
  title: string;
  unit: string;
  t: readonly number[];
  values: readonly (number | null)[];
  /** Defaults to `--c-temp`. */
  token?: string;
  thresholds: readonly ThresholdLine[];
  range: XRange;
  format?: (value: number) => string;
  size?: "sm" | "md";
  syncKey?: string;
  captionHidden?: boolean;
  /** Its own key above the plot (default true); false, or a `ChartGroup` around it, leaves the key to the group (A3). */
  legend?: boolean;
};

export type ThresholdModel = {
  readonly title: string;
  readonly unit: string;
  readonly t: number[];
  /** Aligned to `t`; a missing reading is null. */
  readonly values: (number | null)[];
  readonly thresholds: readonly Threshold[];
  readonly yRange: readonly [number, number];
};

const valued = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * The y range: the readings inside the window and every threshold, with a tenth of their spread above and below; it
 * stays at or above 0 when everything drawn is, and is 0 to 1 with nothing to draw.
 */
export function thresholdRange(t: readonly number[], values: readonly (number | null)[], thresholds: readonly { value: number }[], range: XRange): [number, number] {
  const levels = [...values.filter((value, index) => valued(value) && t[index] >= range.from && t[index] <= range.to) as number[], ...thresholds.map((threshold) => threshold.value).filter(valued)];
  if (!levels.length) return [0, 1];
  const low = Math.min(...levels), high = Math.max(...levels);
  const pad = high > low ? (high - low) * 0.1 : Math.max(1, Math.abs(high) * 0.1);
  return [low >= 0 && low - pad < 0 ? 0 : low - pad, high + pad];
}

export function buildThresholdSeries(input: Pick<ThresholdSeriesProps, "title" | "unit" | "t" | "values" | "thresholds" | "range">): ThresholdModel {
  const length = Math.min(input.t.length, input.values.length);
  const t = input.t.slice(0, length);
  const values = input.values.slice(0, length).map((value) => (valued(value) ? value : null));
  const thresholds = input.thresholds.filter((threshold) => valued(threshold.value)).map((threshold): Threshold => ({ value: threshold.value, level: threshold.tone, label: threshold.label }));
  return { title: input.title, unit: input.unit, t, values, thresholds, yRange: thresholdRange(t, values, thresholds, input.range) };
}

type Format = (value: number) => string;

/** The tooltip at the cursor: the time with its offset, then the reading or "no reading". */
export function thresholdTooltip(model: ThresholdModel, plot: Pick<uPlot, "cursor" | "posToVal">, format: Format): string[] | null {
  const x = cursorX(plot as uPlot);
  const index = plot.cursor.idx;
  if (x === null || index === null || index === undefined || index < 0 || index >= model.t.length) return null;
  const value = model.values[index];
  return [fullTime(model.t[index]), value === null ? "no reading" : `${model.title} ${format(value)}`];
}

export function thresholdOptions(env: ChartEnv, modelRef: MutableRefObject<ThresholdModel>, token: string, formatRef: MutableRefObject<Format>): ChartOptions {
  const { colors, px } = env;
  const model = modelRef.current;
  return {
    padding: [12, 12, 0, 0],
    series: [{}, {
      label: model.title, scale: "y", stroke: colors[token] ?? colors["--c-temp"], width: 2, spanGaps: false,
      points: { size: 6, filter: isolatedPoints }, value: (_plot, value) => (valued(value) ? formatRef.current(value) : "—"),
    }],
    scales: { y: { range: () => [modelRef.current.yRange[0], modelRef.current.yRange[1]] } },
    axes: [timeAxis({ muted: colors["--text-3"], grid: colors["--c-grid"] }), valueAxis(model.unit, colors, 48)],
    cursor: { points: { show: false } },
    hooks: { draw: [(plot) => paintThresholds(plot, modelRef.current.thresholds, colors, px())] },
    plugins: [tooltipPlugin((plot) => (plot.cursor.event ? thresholdTooltip(modelRef.current, plot, formatRef.current) : null), env.syncKey)],
  };
}

/** One row per reading: its local time with offset, and the reading (or "—"). */
export function thresholdTable(model: ThresholdModel, format: Format): DataTableBlock {
  const limits = model.thresholds.map((threshold) => threshold.label).join(", ");
  return {
    caption: `${model.title}${limits ? ` · ${limits}` : ""} · America/Denver`, headers: ["Time", `${model.title} (${model.unit})`], count: model.t.length,
    rows: () => model.t.map((at, index) => [<TimeCell key="t" at={at} />, model.values[index] === null ? "—" : format(model.values[index]!)]),
  };
}

/** The key: each threshold, in its status colour, with its words. */
export function thresholdKey(model: ThresholdModel): KeyItem[] {
  return model.thresholds.map((threshold) => ({ key: `${threshold.level}-${threshold.value}`, label: threshold.label, token: threshold.level === "critical" ? "--critical" : "--warn", kind: "dashed" }));
}

export function ThresholdSeries(props: ThresholdSeriesProps) {
  const { title, unit, range, size = "md", syncKey, captionHidden = false } = props;
  const token = props.token ?? "--c-temp";
  const key = JSON.stringify([props.thresholds, range.from, range.to]);
  const model = useMemo(() => buildThresholdSeries({ title, unit, t: props.t, values: props.values, thresholds: props.thresholds, range }), [props.t, props.values, key, title, unit]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const format: Format = props.format ?? ((value) => formatValue(value, unit));
  const formatRef = useRef(format);
  formatRef.current = format;
  const data = useMemo<uPlot.AlignedData>(() => [model.t, model.values], [model]);
  const drawable = model.t.length > 0;
  const legend = drawable ? thresholdKey(model) : [];
  const grouped = useChartGroupKey(legend);
  return <figure className="chart chart-threshold">
    <figcaption className={captionHidden ? "screen-reader" : "eyebrow"}>{title}</figcaption>
    {drawable && !grouped && (props.legend ?? true) && <ChartKey items={legend} />}
    {drawable
      ? <UPlotChart options={(env) => thresholdOptions(env, modelRef, token, formatRef)} data={data} xRange={range} structure={`threshold|${unit}|${token}|${size}|${syncKey ?? ""}`}
        className={fixedPlotClass(size)} syncKey={syncKey} marks={model} zoom={false}
        label={`${title} over time in ${unit}, America/Denver, with ${model.thresholds.map((threshold) => threshold.label).join(" and ") || "no limits"} marked. Gaps are left empty, never zero. The data table follows.`} />
      : <div className={`${fixedPlotClass(size)} chart-message`}><p>No readings in this window</p></div>}
    {drawable && <ChartFoot tables={[thresholdTable(model, format)]}
      csv={{ filename: csvFilename(title, range), build: () => csvText({ t: model.t, columns: [{ header: `${title} (${unit})`, values: model.values }] }), version: model, label: "CSV of this window" }} />}
  </figure>;
}
