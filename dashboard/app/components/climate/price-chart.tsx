// SPDX-License-Identifier: MIT
/**
 * Drying's price against limit (screens §2.3 block 3; design system v2 §5, "Cost against limit"): the price the
 * controller computes as a line, the limit as a stepped dashed line in `--warn` labelled Limit, the refused spans hatched
 * in `--warn`, the Now rule, a tooltip, a key, the data table and its CSV; under it one lane of the decision.
 */
import { useMemo, useRef, useState } from "react";
import type uPlot from "uplot";
import { CsvLink, DataTable, TimeCell, type DataTableBlock } from "../../charts/data-table";
import { paintLabels, paintNow, paintSpanHatch } from "../../charts/draw";
import { ChartKey, type KeyItem } from "../../charts/legend";
import { StateLanesChart } from "../../charts/state-lanes";
import { timeAxis } from "../../charts/time-axis";
import { valueAxis } from "../../charts/time-series";
import { cursorX, tooltipPlugin } from "../../charts/tooltip";
import { UPlotChart, type ChartEnv, type ChartOptions } from "../../charts/uplot-chart";
import { csvFilename, tableCsv } from "../../charts/csv";
import { fullTime } from "../../charts/time-axis";
import type { XRange } from "../../charts/types";
import { formatValue } from "../../lib/format";
import { panelRead, useLawHistoryRead } from "../../lib/queries";
import { EmptyState, Panel, type PanelState } from "../panel";
import { Segmented } from "../segmented";
import { LAW_WINDOWS, buildPriceModel, decisionRow, refusedAt, windowOf, windowRange, type LawWindowId, type PriceModel } from "./history";

const UNIT = "kWh/kg";
const PRICE_TOKEN = "--c-temp";
const SYNC = "drying-price";

export const PRICE_KEY: readonly KeyItem[] = [
  { key: "price", label: "Price", token: PRICE_TOKEN, kind: "line" },
  { key: "limit", label: "Limit", token: "--warn", kind: "dashed" },
  { key: "refused", label: "Refused", token: "--warn", kind: "hatch" },
];

/** The tooltip at a bucket: its time, the price, the limit and, inside a refused span, why. */
export function priceTooltip(model: PriceModel, index: number | null | undefined): string[] | null {
  if (index === null || index === undefined || index < 0 || index >= model.t.length) return null;
  const at = model.t[index];
  const refused = refusedAt(model, at);
  return [fullTime(at), `Price ${formatValue(model.cost[index], UNIT)}`, `Limit ${formatValue(model.limit[index], UNIT)}`, ...(refused ? [`Refused: ${refused.reason}`] : [])];
}

/** The data table: one row per bucket. */
export function priceTable(model: PriceModel): DataTableBlock {
  return {
    caption: "Price and limit", headers: ["Time", "Price (kWh/kg)", "Limit (kWh/kg)", "Refused"], count: model.t.length,
    rows: () => model.t.map((at, index) => [<TimeCell key="t" at={at} />, formatValue(model.cost[index], UNIT), formatValue(model.limit[index], UNIT), refusedAt(model, at)?.reason ?? ""]),
  };
}
export function priceCsv(model: PriceModel): string {
  return tableCsv(["time (America/Denver)", "price_kwh_per_kg", "limit_kwh_per_kg", "refused"],
    model.t.map((at, index) => [fullTime(at), model.cost[index], model.limit[index], refusedAt(model, at)?.reason ?? ""]));
}

/** The chart's options: the price line, the stepped limit, the refused hatch and the Now rule. */
function priceOptions(env: ChartEnv, modelRef: { current: PriceModel }, now: number): ChartOptions {
  const { colors, px, UPlot } = env;
  return {
    padding: [18, 10, 0, 0],
    series: [{}, { label: "Price", scale: "y", stroke: colors[PRICE_TOKEN], width: 2, spanGaps: false, points: { show: false } },
      { label: "Limit", scale: "y", stroke: colors["--warn"], width: 1.5, dash: [6 * px(), 4 * px()], spanGaps: true, points: { show: false }, paths: UPlot.paths.stepped?.({ align: 1 }) }],
    scales: { y: { range: (_plot, _min, max) => [0, Math.max(1, Number.isFinite(max) ? max * 1.15 : 1)] } },
    axes: [timeAxis({ muted: colors["--text-3"], grid: colors["--c-grid"] }), valueAxis(UNIT, colors)],
    hooks: {
      drawClear: [(plot) => { for (const span of modelRef.current.refused) paintSpanHatch(plot, span.from, span.to, "refused", colors, px()); }],
      draw: [(plot) => {
        const shown = paintNow(plot, now, colors, px());
        paintLabels(plot, { now: shown ? now : null, retention: [], bounds: [], steps: [], runs: [] }, colors, colors[PRICE_TOKEN], px());
      }],
    },
    plugins: [tooltipPlugin((plot: uPlot) => (cursorX(plot) === null ? null : priceTooltip(modelRef.current, plot.cursor.idx)), env.syncKey)],
  };
}

/** The price chart itself, its height reserved by `.chart .plot` before uPlot loads. */
export function PriceChart({ model, range }: { model: PriceModel; range: XRange }) {
  const modelRef = useRef(model);
  modelRef.current = model;
  const data = useMemo(() => [model.t as number[], model.cost as (number | null)[], model.limit as (number | null)[]] as uPlot.AlignedData, [model]);
  const now = range.to;
  return <div className="chart drying-price-chart">
    <UPlotChart className="plot plot-small" structure={`price:${range.to - range.from}`} label="The price of drying against the limit; a table follows"
      options={(env) => priceOptions(env, modelRef, now)} data={data} xRange={range} syncKey={SYNC} marks={model.refused} />
    <ChartKey items={PRICE_KEY} />
    <div className="chart-tools">
      <DataTable tables={[priceTable(model)]} />
      <CsvLink filename={csvFilename("drying-price", range)} build={() => priceCsv(model)} version={model} />
    </div>
  </div>;
}

/** Block 3: the price against the limit over 24 h, 72 h, 7 d or 31 d, and the decision's lane under it. */
export function PriceAgainstLimitPanel() {
  const [chosen, setChosen] = useState<LawWindowId>("72h");
  const window = windowOf(chosen);
  const read = panelRead(useLawHistoryRead(window.seconds));
  const history = read.data;
  const model = useMemo(() => (history ? buildPriceModel(history) : null), [history]);
  const state: PanelState = read.pending ? "loading" : !history ? "error" : read.failed ? "stale" : model?.empty && !history.drying.length ? "empty" : "ready";
  const range = history ? windowRange(history) : null;
  return <Panel title="Price against limit" thing="the price of drying" state={state} reserve="lg" onRetry={read.retry}
    actions={<Segmented label="Window" size="sm" value={chosen} onChange={(value) => setChosen(value as LawWindowId)} segments={LAW_WINDOWS.map((item) => ({ value: item.id, label: item.label }))} />}
    link={{ to: `/graphs?range=${window.graphs}&preset=drying`, label: "Graphs" }}
    empty={<EmptyState message={`No price or decision recorded in the last ${window.label}.`} detail="The controller states a price only while it has an outdoor reading." />}
    foot="The price is the heat drying would cost for each kilogram of water it removes. A gap in the line is time with no outdoor reading.">
    {model && range && history && <>
      <PriceChart model={model} range={range} />
      <StateLanesChart title="The drying decision" rows={[decisionRow(history, range)]} range={range} now={range.to} syncKey={SYNC} />
    </>}
  </Panel>;
}
