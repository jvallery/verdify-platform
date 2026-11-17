// SPDX-License-Identifier: MIT
import { StateLanesChart } from "../../charts/state-lanes";
import { ThresholdSeries } from "../../charts/threshold-series";
import { clockTime } from "../../charts/time-axis";
import type { XRange } from "../../charts/types";
import { duration, formatValue } from "../../lib/format";
import { CONTROLLER_PANELS, LAW_GROUPS, costChart, dryingRow, lawRows, refusedBreakdown, type ControllerChart } from "../../lib/graph-law";
import { LAW_TEXT } from "../../lib/graph-url";
import type { LawHistory, Series } from "../../lib/operator-api";
import { words } from "../../lib/words";
import { EmptyState } from "../empty-state";
import { Panel, PanelError, type PanelState } from "../panel";
import { Skeleton } from "../skeleton";

/**
 * The charts the Law and equipment, Drying and Controller presets of Explore draw beside their API-04 panels
 * (screens.md section 7.1): the law's requests (K-13), the price of drying against the limit and the drying decision
 * (K-14), and the hardware budget against its limits (S-08). Each is on the page's time axis and cursor, and each says
 * honestly when it is loading, failed, empty or outside the 31 days API-31 reads at a time.
 */

/** One read as these charts take it: the answer, whether it failed, and its retry. */
export type ChartRead<T> = { readonly data: T | null; readonly error: unknown; readonly refetch: () => void };
export type LawChartsProps = {
  history: ChartRead<LawHistory>;
  /** False past 31 days: API-31 is not asked. */
  allowed: boolean;
  range: XRange;
  now: number | null;
  syncKey: string;
};
const failed = (read: ChartRead<unknown>) => read.error !== null && read.data === null;
const stateOf = (read: ChartRead<unknown>, allowed: boolean, empty: boolean): PanelState => (!allowed ? "empty" : failed(read) ? "error" : read.data === null ? "loading" : empty ? "empty" : "ready");
/** "The law's record starts Nov 16, 07:00": said when the window starts before the first law record. */
function firstRecordNote(history: LawHistory | null, range: XRange): string | null {
  const first = history?.first_record_at ? Date.parse(history.first_record_at) / 1000 : null;
  return first !== null && first > range.from ? `The law's record starts ${clockTime(first, true)}; before it the lanes are hatched as not reported` : null;
}

/**
 * What the law asked for, over the window (K-13), for the Law and equipment preset's lanes: each request in the rules'
 * order, the latches folded under "As reported". Placed with the relay lanes (what ran) in the stack's lanes disclosure.
 */
export function LawLanes({ history, allowed, range, now, syncKey }: LawChartsProps) {
  if (!allowed) return <p className="meta gr-law-message">{LAW_TEXT}</p>;
  if (failed(history)) return <PanelError thing="what the law asked for" onRetry={history.refetch} />;
  if (!history.data) return <Skeleton size="md" label="What the law asked for" />;
  const note = firstRecordNote(history.data, range);
  return <div className="gr-law">
    <StateLanesChart title="What the law asked for" rows={lawRows(history.data, range)} groups={LAW_GROUPS} range={range} now={now ?? undefined} syncKey={syncKey} />
    {note && <p className="meta gr-law-note">{note}</p>}
  </div>;
}

/**
 * The Drying preset's charts under its VPD panel (K-14): the price of drying against the owner's limit, then the
 * drying decision with its refused spans and the time refused by reason.
 */
export function DryingCharts({ history, allowed, range, now, syncKey }: LawChartsProps) {
  const data = history.data;
  const cost = data ? costChart(data) : null;
  const decision = data ? dryingRow(data, range) : null;
  const refused = data ? refusedBreakdown(data, range) : [];
  const outside = allowed ? undefined : <EmptyState message={LAW_TEXT} />;
  return <div className="l-stack gr-extra">
    <Panel title="Price of drying against the limit" thing="the price of drying" state={stateOf(history, allowed, cost !== null && !cost.values.some((value) => value !== null) && !cost.thresholds.length)}
      onRetry={history.refetch} empty={outside ?? <EmptyState message="No price of drying in this window." />} foot={cost?.note ?? undefined}>
      {cost && <ThresholdSeries title="Price of drying" unit="kWh/kg" t={cost.t} values={cost.values} token="--c-vpd" thresholds={cost.thresholds} range={range}
        format={(value) => formatValue(value, "kWh/kg")} syncKey={syncKey} captionHidden />}
    </Panel>
    <Panel title="The drying decision" thing="the drying decision" state={stateOf(history, allowed, decision !== null && !decision.spans.length)} onRetry={history.refetch}
      empty={outside ?? <EmptyState message="Drying was not wanted in this window." />}
      foot={refused.length ? <>Refused {refused.map((item) => `${duration(item.seconds)} for ${words("drying_refusal", item.reason)}`).join(", ")}</> : undefined}>
      {decision && <StateLanesChart title="The drying decision" rows={[decision]} range={range} now={now ?? undefined} syncKey={syncKey} captionHidden />}
    </Panel>
  </div>;
}

export type ControllerChartsProps = {
  /** The charts the registry lists, with API-35's limits. */
  charts: readonly ControllerChart[] | null;
  /** API-04 over the window for every key of `CONTROLLER_PANELS`. */
  series: ChartRead<Series>;
  /** API-35 failed: the lines are missing and the foot says why. */
  limitsFailed: boolean;
  range: XRange;
  syncKey: string;
};

/** The Controller preset (S-08): one chart per budget figure against its limits, on the page's time axis. */
export function ControllerCharts({ charts, series, limitsFailed, range, syncKey }: ControllerChartsProps) {
  if (charts !== null && charts.length === 0) return <EmptyState message="The registry lists no controller figure yet." />;
  const slots = charts ?? CONTROLLER_PANELS.map((panel) => ({ key: panel.key, title: panel.title, unit: panel.unit, note: null, thresholds: [] }));
  const data = series.data;
  return <div className="l-stack gr-extra gr-controller">
    {slots.map((chart) => {
      const values = data?.series[chart.key]?.avg ?? null;
      const state: PanelState = failed(series) ? "error" : !data || charts === null ? "loading" : !values || !values.some((value) => value !== null) ? "empty" : "ready";
      const foot = [chart.note, limitsFailed ? "Limits unavailable: the controller's budget could not be read" : null].filter(Boolean).join(" · ");
      return <Panel key={chart.key} title={chart.title} thing={chart.title.toLowerCase()} state={state} onRetry={series.refetch} reserve="sm"
        empty={<EmptyState message="No reading in this window." />} foot={foot || undefined}>
        {data && values && <ThresholdSeries title={chart.title} unit={chart.unit} t={data.t} values={values} thresholds={chart.thresholds} range={range}
          format={(value) => formatValue(value, chart.unit)} size="sm" syncKey={syncKey} captionHidden />}
      </Panel>;
    })}
  </div>;
}
