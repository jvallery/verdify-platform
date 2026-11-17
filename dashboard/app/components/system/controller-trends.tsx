// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { ThresholdSeries } from "../../charts/threshold-series";
import { epochOf } from "../../charts/time-axis";
import type { ControllerHealth } from "../../lib/operator-api";
import { panelRead, useRegistryRead, useSeriesWindowRead, type PanelRead } from "../../lib/queries";
import { Panel } from "../panel";
import { Segmented } from "../segmented";
import { TREND_RANGES, trendRange, trendSeries, trendSpecs, type TrendSpec } from "./trends";

type Range = ReturnType<typeof trendRange>;

/** The range control: 24 h or 7 d, kept in the URL. */
function RangeControl({ range }: { range: Range }) {
  const [params] = useSearchParams();
  const href = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("trend", id);
    return `?${next.toString()}`;
  };
  return <Segmented label="Range" size="sm" value={range.id} segments={TREND_RANGES.map((item) => ({ value: item.id, label: item.label, to: href(item.id), keepScroll: true }))} />;
}

const EMPTY = <p className="meta">The metric registry lists none of the controller's trend keys.</p>;

/** The charts once the registry has named the keys: one API-04 read of them all. */
function TrendCharts({ specs, range, health, retryRegistry }: { specs: TrendSpec[]; range: Range; health: PanelRead<ControllerHealth>; retryRegistry: () => void }) {
  const keys = useMemo(() => specs.map((spec) => spec.key), [specs]);
  const series = panelRead(useSeriesWindowRead(keys, range.seconds));
  const data = series.failed ? null : series.data;
  const from = epochOf(data?.from), to = epochOf(data?.to);
  const drawn = useMemo(() => (data ? trendSeries(data, specs) : []), [data, specs]);
  const limits = health.data?.limits ?? null;
  const state = series.failed || (data && (from === null || to === null)) ? "error" : series.pending ? "loading" : "ready";
  return <Panel id="trends" title="Trends" thing="the controller's trends" state={state} reserve="lg" observedAt={data?.to} onRetry={() => { retryRegistry(); series.retry(); }}
    actions={<RangeControl range={range} />}
    foot={limits ? "Each line is labelled with the limit it marks." : "The limits are not shown while the controller's health cannot be read."}>
    {from !== null && to !== null && <div className="sys-trends">
      {drawn.map(({ spec, t, values }) => <ThresholdSeries key={spec.key} title={spec.title} unit={spec.unit} t={t} values={values}
        thresholds={limits ? spec.lines(limits) : []} range={{ from, to }} size="sm" syncKey={`verdify:controller:${range.id}`} />)}
    </div>}
  </Panel>;
}

/**
 * Trends (screens section 10.2, row 6): the controller's hardware budget over the last 24 h or 7 d (`?trend=`), one
 * small multiple per key the registry (API-03) lists, each against its limits from API-35. The registry is read at the
 * settings cadence; the series (API-04) every 60 s on a window that ends at the server's now, only once keys are known.
 */
export function ControllerTrends({ health }: { health: PanelRead<ControllerHealth> }) {
  const [params] = useSearchParams();
  const range = trendRange(params.get("trend"));
  const registry = panelRead(useRegistryRead());
  const specs = useMemo(() => trendSpecs(registry.failed ? null : registry.data, registry.failed), [registry.data, registry.failed]);
  if (specs.length > 0) return <TrendCharts specs={specs} range={range} health={health} retryRegistry={registry.retry} />;
  return <Panel id="trends" title="Trends" thing="the controller's trends" state={registry.pending ? "loading" : "empty"} reserve="lg" empty={EMPTY} actions={<RangeControl range={range} />} />;
}
