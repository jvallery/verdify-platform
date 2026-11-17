// SPDX-License-Identifier: MIT
import { useMemo, useRef, useState, type MutableRefObject } from "react";
import type uPlot from "uplot";
import { csvFilename, tableCsv } from "./csv";
import { ChartFoot, TimeCell, type DataTableBlock } from "./data-table";
import { hatchColor, paintHatch, paintNow, type ChartColors, type PaintTarget } from "./draw";
import { GROUP_HEAD, LANE_PITCH, clipColumns, intervalText, rowBand, spanDuration, spanPixels, type RowLayout } from "./lanes-draw";
import { ChartKey, type KeyItem } from "./legend";
import { lastAtOrBefore } from "./marks";
import { epochOf, isoLocal, timeAxis } from "./time-axis";
import { cursorX, tooltipPlugin } from "./tooltip";
import type { XRange } from "./types";
import { UPlotChart, useNarrow, type ChartEnv, type ChartOptions } from "./uplot-chart";

/**
 * StateLanesChart (design system v2 §5): rows of spans on one time axis, for what the law asked for, the relays, the
 * drying decision and the outdoor source. "on" is a solid bar in the row's token; "off" draws nothing; "unknown" is a
 * hatch of `--text-3` and "refused" a hatch of `--warn`, so neither ever reads as off. Rows are HTML (their names are
 * text) and may sit under group headings, a group folding its rows behind its heading; the canvas paints each row's band
 * at the same pitch. The present moment is the 1 px Now rule, named in the key.
 */
export type LaneSpanState = "on" | "off" | "unknown" | "refused";
export type StateLaneSpan = {
  readonly start: number;
  readonly end: number;
  readonly state: LaneSpanState;
  /** Words for the tooltip and the table, for example a refusal reason. */
  readonly label?: string;
};
export type StateLaneRow = {
  readonly key: string;
  readonly label: string;
  readonly token: string;
  /** Rows with one group key sit under that group's heading. */
  readonly group?: string;
  readonly spans: readonly StateLaneSpan[];
};
export type StateLaneGroup = { readonly key: string; readonly label: string; readonly collapsed?: boolean };
export type StateLanesChartProps = {
  title: string;
  rows: readonly StateLaneRow[];
  groups?: readonly StateLaneGroup[];
  range: XRange;
  /** Draws the Now rule. */
  now?: number;
  syncKey?: string;
  captionHidden?: boolean;
  /** Its own key above the rows (default true); false leaves it to the page. */
  legend?: boolean;
  /** The CSV link in its foot (default true); false where another page offers the data (Now's What ran: Graphs). */
  csv?: boolean;
};

/** The API's interval states as the lanes draw them: running is on, not wanted is off; a state this build does not know is unknown, never off. */
const STATES: Readonly<Record<string, LaneSpanState>> = { on: "on", running: "on", off: "off", not_wanted: "off", refused: "refused", unknown: "unknown" };
export const laneSpanState = (state: string): LaneSpanState => (Object.hasOwn(STATES, state) ? STATES[state] : "unknown");
export const LANE_STATE_WORDS: Readonly<Record<LaneSpanState, string>> = { on: "on", off: "off", unknown: "unknown", refused: "refused" };

/** Spans from API interval lists (`{start, end, state}` with ISO datetimes), clamped to the range. */
export function spansFromIntervals(
  intervals: readonly { start: string; end: string; state: string; reason?: string | null }[],
  range: XRange,
  label?: (interval: { state: string; reason?: string | null }) => string | undefined,
): StateLaneSpan[] {
  const spans: StateLaneSpan[] = [];
  for (const interval of intervals) {
    const start = epochOf(interval.start), end = epochOf(interval.end);
    if (start === null || end === null) continue;
    const from = Math.max(start, range.from), to = Math.min(end, range.to);
    if (to <= from) continue;
    const words = label?.(interval);
    spans.push({ start: from, end: to, state: laneSpanState(interval.state), ...(words ? { label: words } : {}) });
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** One line of the lanes, top to bottom: a group's heading (with its row count), or a row. */
export type StateLaneEntry = { kind: "head"; group: StateLaneGroup; count: number } | { kind: "row"; row: StateLaneRow };

/**
 * The lines shown: the rows with no known group first, in their order; then each group in the groups' order, its heading
 * and, while its fold is open, its rows. A group with no rows is left out.
 */
export function stateLaneEntries(rows: readonly StateLaneRow[], groups: readonly StateLaneGroup[], open: ReadonlySet<string>): StateLaneEntry[] {
  const known = new Set(groups.map((group) => group.key));
  const entries: StateLaneEntry[] = rows.filter((row) => !row.group || !known.has(row.group)).map((row) => ({ kind: "row", row }));
  for (const group of groups) {
    const members = rows.filter((row) => row.group === group.key);
    if (!members.length) continue;
    entries.push({ kind: "head", group, count: members.length });
    if (open.has(group.key)) entries.push(...members.map((row): StateLaneEntry => ({ kind: "row", row })));
  }
  return entries;
}

/** What the canvas paints: one entry per shown line (null for a heading), each line's top in CSS px, the pitch and now. */
export type StateLanesView = { rows: (StateLaneRow | null)[]; tops: number[]; pitch: number; now: number | null };
export function stateLanesView(entries: readonly StateLaneEntry[], pitch: number, now: number | null): StateLanesView {
  const tops: number[] = [];
  let top = 0;
  for (const entry of entries) { tops.push(top); top += entry.kind === "head" ? GROUP_HEAD : pitch; }
  return { rows: entries.map((entry) => (entry.kind === "row" ? entry.row : null)), tops, pitch, now };
}

/** The row at `top` CSS px from the plot's top; null over a heading or below the rows. */
export function stateRowAt(view: StateLanesView, top: number): StateLaneRow | null {
  const index = lastAtOrBefore(view.tops, top);
  if (index < 0) return null;
  const row = view.rows[index];
  return row && top < view.tops[index] + view.pitch ? row : null;
}

/** The span of `row` covering `x`. */
export function stateSpanAt(row: StateLaneRow, x: number): StateLaneSpan | null {
  const index = lastAtOrBefore(row.spans.map((span) => span.start), x);
  return index >= 0 && x < row.spans[index].end ? row.spans[index] : null;
}

/** A span's state in words, with its own words after it: "refused · costs more than the limit". */
export const spanWords = (span: StateLaneSpan) => (span.label ? `${LANE_STATE_WORDS[span.state]} · ${span.label}` : LANE_STATE_WORDS[span.state]);

/** The tooltip for the row under the pointer: its name, the state and its words, start–end with offsets, and how long. */
export function stateLaneTooltip(view: StateLanesView, plot: Pick<uPlot, "cursor" | "posToVal">): string[] | null {
  if (!plot.cursor.event) return null;
  const x = cursorX(plot as uPlot), top = plot.cursor.top;
  if (x === null || top === undefined || top === null || top < 0) return null;
  const row = stateRowAt(view, top);
  const span = row ? stateSpanAt(row, x) : null;
  if (!row || !span) return null;
  return [row.label, spanWords(span), intervalText(span.start, span.end), spanDuration(span.end - span.start)];
}

/** draw: each shown row's spans (on solid in its token, unknown and refused hatched, off nothing), then the Now rule. */
export function paintStateLanes(plot: PaintTarget, view: StateLanesView, colors: ChartColors, px: number) {
  const layout: RowLayout = { pitch: view.pitch, tops: view.tops };
  clipColumns(plot, () => {
    const { ctx } = plot;
    view.rows.forEach((row, index) => {
      if (!row) return;
      const band = rowBand(plot, layout, index, px);
      for (const span of row.spans) {
        if (span.state === "off") continue;
        const pixels = spanPixels(plot, span.start, span.end);
        if (!pixels) continue;
        const width = Math.max(pixels.right - pixels.left, px);
        if (span.state === "on") {
          ctx.fillStyle = colors[row.token] ?? colors["--text"];
          ctx.fillRect(pixels.left, band.top, width, band.height);
        } else paintHatch(ctx, pixels.left, band.top, width, band.height, hatchColor(span.state, colors), px);
      }
    });
    if (view.now !== null) paintNow(plot, view.now, colors, px);
  });
}

export function stateLanesOptions(env: ChartEnv, viewRef: MutableRefObject<StateLanesView>): ChartOptions {
  const { colors, px } = env;
  return {
    padding: [0, null, 0, null],
    series: [{}],
    // uPlot always makes a y axis: the lanes have none, so it is hidden.
    axes: [timeAxis({ muted: colors["--text-3"], grid: colors["--c-grid"] }), { show: false }],
    hooks: { draw: [(plot) => paintStateLanes(plot, viewRef.current, colors, px())] },
    plugins: [tooltipPlugin((plot) => stateLaneTooltip(viewRef.current, plot), env.syncKey)],
  };
}

/** The data table: every span of every row, in row order, with its state, its words, its times and how long. */
export function stateLanesTable(title: string, rows: readonly StateLaneRow[]): DataTableBlock {
  return {
    caption: `${title} · America/Denver`, headers: ["Row", "State", "From", "Until", "Duration", "Note"], count: rows.reduce((sum, row) => sum + row.spans.length, 0),
    rows: () => rows.flatMap((row) => row.spans.map((span) => [
      row.label, LANE_STATE_WORDS[span.state], <TimeCell key="from" at={span.start} />, <TimeCell key="until" at={span.end} />, spanDuration(span.end - span.start), span.label ?? "",
    ])),
  };
}

/** "CSV of these lanes": every span, its row, state, local start and end, seconds and words; unknown and refused are their own states. */
export function stateLanesCsv(rows: readonly StateLaneRow[]): string {
  return tableCsv(
    ["row", "label", "state", "start (America/Denver)", "end (America/Denver)", "seconds", "note"],
    rows.flatMap((row) => row.spans.map((span) => [row.key, row.label, span.state, isoLocal(span.start), isoLocal(span.end), Math.round(span.end - span.start), span.label ?? ""])),
  );
}

/** The key: the marks a row's name does not explain, as drawn (each row is named, so its colour needs no key), and Now. */
export function stateLanesKey(rows: readonly StateLaneRow[], range: XRange, now?: number): KeyItem[] {
  const states = new Set(rows.flatMap((row) => row.spans.map((span) => span.state)));
  return [
    ...(states.has("on") ? [{ key: "on", label: "on", token: "--text", kind: "fill" } as const] : []),
    ...(states.has("refused") ? [{ key: "refused", label: "refused", token: "--warn", kind: "hatch" } as const] : []),
    ...(states.has("unknown") ? [{ key: "unknown", label: "unknown", token: "--text-3", kind: "hatch" } as const] : []),
    ...(now !== undefined && now >= range.from && now <= range.to ? [{ key: "now", label: "Now", token: "--text", kind: "line" } as const] : []),
  ];
}

export function StateLanesChart(props: StateLanesChartProps) {
  const { title, rows, range, syncKey, captionHidden = false } = props;
  const groups = useMemo(() => props.groups ?? [], [JSON.stringify(props.groups ?? [])]);
  const narrow = useNarrow();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set((props.groups ?? []).filter((group) => !group.collapsed).map((group) => group.key)));
  const entries = stateLaneEntries(rows, groups, open);
  const view = stateLanesView(entries, narrow ? LANE_PITCH.narrow : LANE_PITCH.wide, props.now ?? null);
  const viewRef = useRef(view);
  viewRef.current = view;
  // Rows arrive as fresh arrays on every poll: the canvas repaints only when what it draws changes.
  const drawn = JSON.stringify([rows, [...open], view.pitch, view.now]);
  const marks = useMemo(() => ({ drawn }), [drawn]);
  const data = useMemo<uPlot.AlignedData>(() => [[range.from, range.to]], [range.from, range.to]);
  const drawable = rows.length > 0;
  const toggle = (key: string) => setOpen((previous) => {
    const next = new Set(previous);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  return <figure className="chart chart-lanes chart-state-lanes">
    <figcaption className={captionHidden ? "screen-reader" : "lanes-caption"}>{captionHidden ? title : <span className="eyebrow">{title}</span>}</figcaption>
    {drawable && (props.legend ?? true) && <ChartKey items={stateLanesKey(rows, range, props.now)} />}
    {drawable
      ? <div className="lanes lanes-state">
        <ul className="lanes-rows" aria-label={`${title}, by row`}>
          {entries.map((entry) => (entry.kind === "head"
            ? <li key={`head-${entry.group.key}`} className="lanes-group" data-group={entry.group.key}>
              <span className="lanes-group-name">{entry.group.label}</span>
              <button type="button" className="lanes-group-fold" aria-expanded={open.has(entry.group.key)} aria-label={`${entry.group.label}: ${entry.count} ${entry.count === 1 ? "row" : "rows"}`}
                onClick={() => toggle(entry.group.key)}>{entry.count} {entry.count === 1 ? "row" : "rows"}</button>
            </li>
            : <li key={entry.row.key} className="lanes-row" data-row={entry.row.key}><span className="lanes-label" title={entry.row.label}>{entry.row.label}</span></li>))}
        </ul>
        <div className="lanes-axis" aria-hidden="true" />
        <UPlotChart options={(env) => stateLanesOptions(env, viewRef)} data={data} xRange={range} structure={`state-lanes|${syncKey ?? ""}`} className="lanes-canvas"
          label={`${title}: rows of spans over time, America/Denver. On is a solid bar; unknown is hatched grey and refused hatched amber, never drawn as off. The data table follows.`}
          syncKey={syncKey} marks={marks} zoom={false} />
      </div>
      : <div className="plot plot-small chart-message"><p>Nothing to show in this window</p></div>}
    {drawable && <ChartFoot name="Lanes table" tables={[stateLanesTable(title, rows)]} csv={(props.csv ?? true) ? { filename: csvFilename(title, range), build: () => stateLanesCsv(rows), version: marks, label: "CSV of these lanes" } : null} />}
  </figure>;
}
