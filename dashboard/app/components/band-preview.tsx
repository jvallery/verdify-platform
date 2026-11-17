// SPDX-License-Identifier: MIT
import { useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import type uPlot from "uplot";
import { csvFilename, windowCsv } from "../charts/csv";
import { ChartFoot, TimeCell, type DataTableBlock } from "../charts/data-table";
import { CHART_BACKGROUND, Labels, paintBandEdges, paintBandFill, paintNow, type PaintTarget } from "../charts/draw";
import { ChartGroup, useChartGroupKey, type KeyItem } from "../charts/legend";
import { marksExtent, paddedRange, type BandRun } from "../charts/marks";
import { valueAxis } from "../charts/time-series";
import { clockTime, epochOf, fullTime, timeAxis } from "../charts/time-axis";
import { tooltipPlugin } from "../charts/tooltip";
import type { XRange } from "../charts/types";
import { UPlotChart, type ChartEnv, type ChartOptions } from "../charts/uplot-chart";
import { dateShift, formatNumber, formatValue, localDayStart, unitDecimals } from "../lib/format";
import type { BandLawLines, BandProfilePreview } from "../lib/operator-api";
import { StatusBadge } from "./badge";
import { AXIS_UNIT, findingDetail, findingSubject, storedEdges, type Axis } from "./climate/band-draft";
import { Panel, type PanelState } from "./panel";

/**
 * The Band page's preview (screens §2.2 block 2, parity K-02 to K-04): two charts over the solar day, temperature and
 * VPD, from API-23 alone, so the browser computes no curve. Each draws the stored band as a wash with its edges, the
 * draft band dashed where it differs, the last 24 h measured, the outdoor forecast (temperature) or the expected night
 * VPD (VPD), sunrise, solar noon, sunset and now, and the law's lines inside the band the draft makes (API-23
 * `law_lines`, the law's own offsets from its edges), each labelled where a rule starts. The two charts share one key and
 * one quiet line under both (A3); the draft's findings follow in words, each naming its edge (A8).
 */

export const PREVIEW_DEBOUNCE_MS = 300;
export const PREVIEW_UNAVAILABLE = "Preview unavailable";
export const AXIS_TITLE: Readonly<Record<Axis, string>> = { temp: "Temperature", vpd: "VPD" };

type Column = readonly (number | null)[];
type Edges = { readonly low: Column; readonly high: Column };
export type LawLine = { readonly key: string; readonly label: string; readonly values: Column };
export type SolarMark = { readonly at: number; readonly word: string; readonly text: string };
export type PreviewView = {
  readonly axis: Axis;
  readonly unit: "°F" | "kPa";
  readonly t: readonly number[];
  /** The band as stored, as the wash's runs. */
  readonly runs: BandRun[];
  readonly current: Edges;
  /** The draft's edges, or null when there is no draft or it changes nothing on this axis. */
  readonly draft: Edges | null;
  /** The last 24 h measured, by clock time (after now, yesterday's). */
  readonly measured: Column | null;
  /** Temperature: the outdoor forecast. */
  readonly outdoor: Column | null;
  /** VPD: the night VPD the house is expected to reach (p25 and p75). */
  readonly expected: Edges | null;
  /** Where each rule starts, inside the band the draft makes. */
  readonly lines: readonly LawLine[];
  readonly now: number | null;
  readonly marks: readonly SolarMark[];
};

const shown = (values: Column | null | undefined): values is Column => Array.isArray(values) && values.some((value) => value !== null);
const sameColumn = (a: Column, b: Column) => a.length === b.length && a.every((value, index) => value === b[index]);
const plus = (values: Column, offset: number): Column => values.map((value) => (value === null ? null : Math.round((value + offset) * 1000) / 1000));

/** The ribbon's runs: a null in low or high leaves it open. */
export function ribbon(t: readonly number[], low: Column, high: Column): BandRun[] {
  const runs: BandRun[] = [];
  let run: BandRun | null = null;
  t.forEach((at, index) => {
    const bottom = low[index], top = high[index];
    if (bottom === null || bottom === undefined || top === null || top === undefined) { run = null; return; }
    if (!run) { run = { source: "band", label: "", t: [], low: [], high: [] }; runs.push(run); }
    run.t.push(at); run.low.push(bottom); run.high.push(top);
  });
  return runs;
}

/**
 * Where each rule starts inside a band (API-23 `law_lines`, the law's offsets from its edges): temperature, the gas
 * furnace and electric heat above the low edge and cooling at the high edge; VPD, drying above the low edge and fog at
 * the high edge. None without the offsets (an API before them).
 */
export function lawLines(axis: Axis, band: Edges, offsets: BandLawLines | null): LawLine[] {
  if (!offsets) return [];
  if (axis === "temp") {
    return [
      { key: "heat2", label: "Furnace starts", values: plus(band.low, offsets.heat2_on_above_low_f) },
      { key: "heat1", label: "Electric heat starts", values: plus(band.low, offsets.heat1_on_above_low_f) },
      { key: "cool", label: "Cooling starts", values: plus(band.high, offsets.cool_on_above_high_f) },
    ];
  }
  return [
    { key: "dry", label: "Drying wanted", values: plus(band.low, offsets.dry_on_above_vpd_low_kpa) },
    { key: "fog", label: "Fog starts", values: plus(band.high, offsets.fog_on_above_vpd_high_kpa) },
  ];
}

/** Sunrise, solar noon and sunset of the previewed day. */
export function solarMarks(sun: BandProfilePreview["sun"]): SolarMark[] {
  const marks: [string, string, number | null][] = [["Sunrise", "Sunrise", sun.sunrise], ["Noon", "Solar noon", sun.solar_noon], ["Sunset", "Sunset", sun.sunset]];
  return marks.flatMap(([word, name, at]) => (typeof at === "number" ? [{ at, word, text: `${name} ${clockTime(at)}` }] : []));
}

/** The two charts' views from one API-23 answer; `edited` false draws no draft. */
export function previewViews(preview: BandProfilePreview, now: number | null, edited: boolean): Record<Axis, PreviewView> {
  const marks = solarMarks(preview.sun);
  const view = (axis: Axis): PreviewView => {
    const curves = preview[axis];
    const current = { low: curves.current.low, high: curves.current.high };
    const differs = edited && !(sameColumn(curves.current.low, curves.draft.low) && sameColumn(curves.current.high, curves.draft.high));
    const draft = differs ? { low: curves.draft.low, high: curves.draft.high } : null;
    const vpd = preview.vpd;
    return {
      axis, unit: AXIS_UNIT[axis], t: preview.t, runs: ribbon(preview.t, current.low, current.high), current, draft,
      measured: shown(preview.measured[axis]) ? preview.measured[axis] : null,
      outdoor: axis === "temp" && shown(preview.forecast.temp) ? preview.forecast.temp : null,
      expected: axis === "vpd" && shown(vpd.expected_low) ? { low: vpd.expected_low, high: vpd.expected_high } : null,
      lines: lawLines(axis, draft ?? current, preview.law_lines), now, marks,
    };
  };
  return { temp: view("temp"), vpd: view("vpd") };
}

/** The key of one chart, which the group merges into one line above both (A3). */
export function previewKey(view: PreviewView): KeyItem[] {
  return [
    { key: "band", label: "Band as stored", token: "--c-band-edge", kind: "fill" },
    ...(view.draft ? [{ key: "draft", label: "Draft band", token: "--c-requested", kind: "dashed" } as const] : []),
    ...(view.measured ? [{ key: "measured", label: "Measured, last 24 h", token: view.axis === "temp" ? "--c-temp" : "--c-vpd", kind: "line" } as const] : []),
    ...(view.outdoor ? [{ key: "outdoor", label: "Outdoor forecast", token: "--c-outdoor", kind: "dashed" } as const] : []),
    ...(view.expected ? [{ key: "expected", label: "Expected night VPD", token: "--c-outdoor", kind: "dotted" } as const] : []),
    ...(view.lines.length ? [{ key: "rules", label: "Where a rule starts", token: "--text-2", kind: "dotted" } as const] : []),
  ];
}

/** The plotted columns after t, in series order: draft low and high, measured, outdoor or expected, then the law's lines. */
function columns(view: PreviewView): Column[] {
  const blank = view.t.map(() => null);
  return [
    view.draft?.low ?? blank, view.draft?.high ?? blank, view.measured ?? blank,
    ...(view.axis === "temp" ? [view.outdoor ?? blank] : [view.expected?.low ?? blank, view.expected?.high ?? blank]),
    ...view.lines.map((line) => line.values),
  ];
}

const DASH = { draft: [8, 4], outdoor: [6, 4], expected: [2, 3], rule: [2, 3] } as const;

/** The now line, the sun's marks and every label, kept apart; the law's labels sit on their lines, right of noon first. */
function paintMarks(plot: PaintTarget, view: PreviewView, colors: ChartEnv["colors"], px: number) {
  const { ctx, bbox } = plot;
  const x = (at: number) => plot.valToPos(at, "x", true);
  const y = (value: number) => plot.valToPos(value, "y", true);
  const nowShown = view.now !== null && paintNow(plot, view.now, colors, px);
  ctx.save();
  try {
    ctx.strokeStyle = colors["--text-3"];
    ctx.lineWidth = px;
    ctx.setLineDash([4 * px, 3 * px]);
    for (const mark of view.marks) {
      ctx.beginPath();
      ctx.moveTo(x(mark.at), bbox.top);
      ctx.lineTo(x(mark.at), bbox.top + bbox.height);
      ctx.stroke();
    }
    const labels = new Labels(plot, px, colors[CHART_BACKGROUND] ?? "");
    const top = bbox.top + 16 * px;
    const both = (at: number, line: number) => [{ at: x(at) + 4 * px, line, align: "left" as const }, { at: x(at) - 4 * px, line, align: "right" as const }];
    if (nowShown && view.now !== null) labels.place("Now", both(view.now, top), colors["--text"]);
    for (const mark of view.marks) labels.place(mark.word, both(mark.at, top), colors["--text-3"]);
    // Each rule's label at the first of a few times of day where it fits on its own line.
    const tries = [0.62, 0.86, 0.38, 0.14].map((share) => Math.min(view.t.length - 1, Math.floor(share * view.t.length)));
    for (const line of view.lines) {
      const anchors = tries.flatMap((index) => {
        const value = line.values[index];
        return value === null || value === undefined ? [] : [{ at: x(view.t[index]), line: y(value), align: "left" as const }];
      });
      labels.place(line.label, anchors, colors["--text-2"]);
    }
  } finally {
    ctx.restore();
  }
}

/** A low and a high in words: "71.8–85.8 °F". */
const rangeWords = (low: number | null | undefined, high: number | null | undefined, unit: string) =>
  (low === null || low === undefined || high === null || high === undefined ? "—" : `${formatNumber(low, unitDecimals(unit))}–${formatValue(high, unit)}`);

function previewOptions(env: ChartEnv, viewRef: MutableRefObject<PreviewView>): ChartOptions {
  const { colors, px } = env;
  const view = viewRef.current;
  const line = (label: string, stroke: string, width: number, dash?: readonly number[]): uPlot.Series =>
    ({ label, scale: "y", stroke, width, dash: dash ? [...dash] : undefined, spanGaps: false, points: { show: false } });
  const outdoor = view.axis === "temp"
    ? [line("Outdoor forecast", colors["--c-outdoor"], 1.5, DASH.outdoor)]
    : [line("Expected night VPD, p25", colors["--c-outdoor"], 1.5, DASH.expected), line("Expected night VPD, p75", colors["--c-outdoor"], 1.5, DASH.expected)];
  return {
    padding: [18, 10, 0, 0],
    series: [{}, line("Draft low", colors["--c-requested"], 2, DASH.draft), line("Draft high", colors["--c-requested"], 2, DASH.draft),
      line("Measured", colors[view.axis === "temp" ? "--c-temp" : "--c-vpd"], 2), ...outdoor,
      ...view.lines.map((rule) => line(rule.label, colors["--text-2"], 1, DASH.rule))],
    scales: { y: { range: (_plot, min, max) => paddedRange([min, max], marksExtent(viewRef.current.runs, [], ...env.xWindow())) } },
    axes: [timeAxis({ muted: colors["--text-3"], grid: colors["--c-grid"] }), valueAxis(view.unit, colors)],
    hooks: {
      drawClear: [(plot) => paintBandFill(plot, viewRef.current.runs, colors)],
      drawAxes: [(plot) => paintBandEdges(plot, viewRef.current.runs, colors, px())],
      draw: [(plot) => paintMarks(plot, viewRef.current, colors, px())],
    },
    plugins: [tooltipPlugin((plot) => tooltipText(viewRef.current, plot.cursor.idx))],
  };
}

/** The pointer's readout at one step: the time, the band, the draft, the measured and outdoor values and each rule's line. */
export function tooltipText(view: PreviewView, index: number | null | undefined): string[] | null {
  const { t, unit, current, draft } = view;
  if (index === null || index === undefined || index < 0 || index >= t.length) return null;
  const lines = [fullTime(t[index]), `Band ${rangeWords(current.low[index], current.high[index], unit)}`];
  if (draft) lines.push(`Draft ${rangeWords(draft.low[index], draft.high[index], unit)}`);
  const value = (label: string, column: Column | null | undefined) => {
    const at = column?.[index];
    if (at !== null && at !== undefined) lines.push(`${label} ${formatValue(at, unit)}`);
  };
  value("Measured", view.measured);
  value("Outdoor forecast", view.outdoor);
  if (view.expected && view.expected.low[index] !== null && view.expected.low[index] !== undefined) lines.push(`Expected night VPD ${rangeWords(view.expected.low[index], view.expected.high[index], unit)}`);
  for (const rule of view.lines) value(rule.label, rule.values);
  return lines;
}

/** The table and the CSV hold the same columns: the band, the draft while one shows, and the measured values. */
function tableColumns(view: PreviewView): { header: string; values: Column }[] {
  const unit = view.unit;
  return [
    { header: `Band low, ${unit}`, values: view.current.low }, { header: `Band high, ${unit}`, values: view.current.high },
    ...(view.draft ? [{ header: `Draft low, ${unit}`, values: view.draft.low }, { header: `Draft high, ${unit}`, values: view.draft.high }] : []),
    ...(view.measured ? [{ header: `Measured, ${unit}`, values: view.measured }] : []),
  ];
}
function previewTable(view: PreviewView): DataTableBlock {
  const cols = tableColumns(view);
  return {
    caption: `${AXIS_TITLE[view.axis]} band over the day · America/Denver`, headers: ["Time", ...cols.map((col) => col.header)], count: view.t.length,
    rows: () => view.t.map((at, index) => [<TimeCell key="t" at={at} />, ...cols.map((col) => formatValue(col.values[index], view.unit))]),
  };
}

/** The previewed day, local midnight to midnight. */
export function dayRange(day: string, t: readonly number[]): XRange {
  const from = epochOf(localDayStart(day)) ?? t[0] ?? 0;
  return { from, to: epochOf(localDayStart(dateShift(day, 1))) ?? from + 86_400 };
}

/** The CSV of both charts: one row a step, the temperature columns, then the VPD columns. */
export function previewCsv(views: Record<Axis, PreviewView>): string {
  return windowCsv([views.temp, views.vpd].map((view) => ({ t: view.t, columns: tableColumns(view).map((col) => ({ ...col, header: `${AXIS_TITLE[view.axis]} ${col.header.charAt(0).toLowerCase()}${col.header.slice(1)}` })) })));
}

/** One axis's chart, inside the preview's group: its title and its plot (the group keeps the key and the one quiet line). */
export function PreviewChart({ day, view }: { day: string; view: PreviewView }) {
  const viewRef = useRef(view);
  viewRef.current = view;
  useChartGroupKey(previewKey(view));
  const xRange: XRange = useMemo(() => dayRange(day, view.t), [day, view.t]);
  const data = useMemo<uPlot.AlignedData>(() => [[...view.t], ...columns(view).map((column) => [...column])], [view]);
  const marks = useMemo(() => ({ runs: view.runs, draft: view.draft, now: view.now, lines: view.lines, sun: view.marks }), [view.runs, view.draft, view.now, view.lines, view.marks]);
  const title = AXIS_TITLE[view.axis];
  const structure = `band-preview|${view.axis}|${view.lines.map((line) => line.key).join(",")}`;
  return <figure className="chart band-chart">
    <figcaption className="band-chart-title">{title}, {view.unit}</figcaption>
    <UPlotChart options={(env) => previewOptions(env, viewRef)} data={data} xRange={xRange} structure={structure} className="plot" zoom={false} marks={marks}
      label={`${title} band over the solar day in ${view.unit}, America/Denver: the band as stored${view.draft ? ", the draft band dashed" : ""} and where each rule starts. Gaps are left empty, never zero. The data table follows the charts.`} />
  </figure>;
}

/** The answer in words (A4): the band as stored, by day and at night, and whether sunrise and sunset are set apart. */
export function bandAnswer(preview: Pick<BandProfilePreview, "current">): string {
  const edges = storedEdges(preview.current);
  const pair = (time: "day" | "night") => `${rangeWords(edges[`temp_low_${time}`], edges[`temp_high_${time}`], "°F")} and ${rangeWords(edges[`vpd_low_${time}`], edges[`vpd_high_${time}`], "kPa")}`;
  const apart = preview.current.edges_simple && (!preview.current.edges_simple.temp || !preview.current.edges_simple.vpd)
    ? " Sunrise and sunset are set apart from the halfway point." : "";
  return `The house is held at ${pair("day")} by day (solar noon), and at ${pair("night")} at night (solar midnight).${apart}`;
}

export type Finding = BandProfilePreview["findings"][number];
/** The draft's findings in words: what each is about, then why, in the API's words with each series named. */
export function FindingsList({ findings }: { findings: readonly Finding[] }) {
  if (!findings.length) return null;
  const ordered = [...findings.filter((item) => item.severity === "error"), ...findings.filter((item) => item.severity !== "error")];
  return <ul className="band-findings" aria-label="What the band check found">
    {ordered.map((finding) => {
      const subject = findingSubject(finding.field);
      return <li key={`${finding.code}-${finding.field}`} data-severity={finding.severity}>
        <StatusBadge status={finding.severity === "error" ? "critical" : "warn"} size="sm">{finding.severity === "error" ? "Blocks Save" : "Warning"}</StatusBadge>{" "}
        <span>{subject && <strong>{subject}: </strong>}{findingDetail(finding.detail)}</span>
      </li>;
    })}
  </ul>;
}

/** The night heat estimate (API-23 `night_heat_kwh`), stored and with the draft. */
export function nightHeatText(preview: Pick<BandProfilePreview, "night_heat_kwh">, edited: boolean): string | null {
  const { current, draft } = preview.night_heat_kwh;
  if (current === null && draft === null) return null;
  const stored = `Heat for tonight, estimated: ${formatValue(current, "kWh")} with the band as stored`;
  return edited ? `${stored}, ${formatValue(draft, "kWh")} with the draft.` : `${stored}.`;
}

export type BandPreviewPanelProps = {
  preview: BandProfilePreview | null;
  /** A draft is being previewed (it may change nothing). */
  edited: boolean;
  now: number | null;
  state: PanelState;
  /** A message in place of the charts or above them: the preview failed, or a field does not read as a number. */
  message?: ReactNode;
  onRetry?: () => void;
};

/** Block 2: the answer, the two charts with one key, the sun's times, the findings and the night heat estimate. */
export function BandPreviewPanel({ preview, edited, now, state, message, onRetry }: BandPreviewPanelProps) {
  const views = useMemo(() => (preview && preview.t.length ? previewViews(preview, now, edited) : null), [preview, now, edited]);
  const marks = views?.temp.marks ?? [];
  const heat = preview ? nightHeatText(preview, edited) : null;
  return <Panel title="The band" thing="the band" state={state} reserve="lg" onRetry={onRetry} foot={heat}>
    {preview && <p className="band-answer">{bandAnswer(preview)}</p>}
    {message && <p role="status" className="band-message">{message}</p>}
    {views && preview && <ChartGroup label="The band over the solar day" className="band-charts">
      <PreviewChart day={preview.day} view={views.temp} />
      <PreviewChart day={preview.day} view={views.vpd} />
      <ChartFoot tables={[previewTable(views.temp), previewTable(views.vpd)]}
        csv={{ filename: csvFilename("band", dayRange(preview.day, preview.t)), build: () => previewCsv(views), version: views, label: "CSV of these charts" }} />
    </ChartGroup>}
    {marks.length > 0 && <p className="meta band-sun">{marks.map((mark) => mark.text).join(" · ")}. After the Now line the measured line is yesterday's.</p>}
    {preview && <FindingsList findings={edited ? preview.findings : preview.findings.filter((finding) => finding.severity !== "error")} />}
  </Panel>;
}
