// SPDX-License-Identifier: MIT
import { Link, useSearchParams } from "react-router";
import { TimeSeries } from "../../charts/time-series";
import { DEFAULT_VIEW, graphHref } from "../../lib/graph-url";
import type { MetricDef, Series, SoilTarget } from "../../lib/operator-api";
import { panelRead, useSeriesWindowRead } from "../../lib/queries";
import { Chips } from "../chips";
import { bucketWords } from "../graphs/resolution-line";
import { EmptyState, Panel } from "../panel";
import { SOIL_MEASURES, soilKeys, zoneLabel } from "./soil-model";

const RANGES = [
  { key: "24h", label: "24 hours", seconds: 86_400 },
  { key: "72h", label: "3 days", seconds: 3 * 86_400 },
  { key: "7d", label: "7 days", seconds: 7 * 86_400 },
  { key: "30d", label: "30 days", seconds: 30 * 86_400 },
] as const;

type Chart = { key: string; title: string; metrics: MetricDef[] };

/** Keep the two wall traces together and every API-04 request within its eight-metric limit. */
function batches(charts: Chart[]): Chart[][] {
  const groups: Chart[][] = [];
  let count = 0;
  for (const chart of charts) {
    if (count === 0 || count + chart.metrics.length > 8) {
      groups.push([]);
      count = 0;
    }
    groups[groups.length - 1].push(chart);
    count += chart.metrics.length;
  }
  return groups;
}

function hasValues(series: Series, metric: MetricDef): boolean {
  return series.series[metric.key]?.avg.some((value) => value !== null && Number.isFinite(value)) ?? false;
}

function TrendsBatch({ charts, seconds }: { charts: Chart[]; seconds: number }) {
  const keys = charts.flatMap(({ metrics }) => metrics.map(({ key }) => key));
  const { data, failed, pending, retry } = panelRead(useSeriesWindowRead(keys, seconds));
  return charts.map(({ key, title, metrics }, index) => {
    const state = failed ? "error" : pending ? "loading" : data && metrics.some((metric) => hasValues(data, metric)) ? "ready" : "empty";
    const from = data ? Date.parse(data.from) / 1000 : 0;
    const to = data ? Date.parse(data.to) / 1000 : 0;
    return <Panel key={key} headingLevel={3} title={title} thing={`soil ${title.toLowerCase()} history`}
      state={state} reserve="md" onRetry={index === 0 ? retry : undefined}
      foot={data && bucketWords(data.bucket_s)}
      empty={<EmptyState message="No readings in this window." />}>
      {state === "ready" && data && <TimeSeries
        title={title}
        metrics={metrics} series={data} now={Date.parse(data.server_time) / 1000} xRange={{ from, to }}
        syncKey={`soil-trends:${seconds}`} linked />}
    </Panel>;
  });
}

export function SoilTrends({ targets, registry }: { targets: readonly SoilTarget[]; registry: readonly MetricDef[] }) {
  const [search] = useSearchParams();
  const range = RANGES.find(({ key }) => key === search.get("range")) ?? RANGES[0];
  const metricsByKey = new Map(registry.map((metric) => [metric.key, metric]));
  const probes = targets.map((target) => ({ label: zoneLabel(target.zone), keys: soilKeys(target, registry) }));
  const charts = SOIL_MEASURES.flatMap(({ measure, label }) => {
    const metrics = probes.flatMap((probe) => {
      const key = probe.keys[measure];
      const metric = key && metricsByKey.get(key);
      return metric ? [{ ...metric, label: probe.label }] : [];
    });
    return metrics.length ? [{ key: measure, title: label, metrics }] : [];
  });

  const moisture = probes.flatMap(({ keys }) => keys.moisture ? [keys.moisture] : []);
  const waterHistory = graphHref({
    ...DEFAULT_VIEW, window: { kind: "range", range: range.key }, preset: "water",
    metrics: moisture, outdoor: false, events: ["runs"],
  });
  return <section className="wat-soil-trends" aria-labelledby="soil-trends-title">
    <div className="wat-soil-trends-head">
      <h2 id="soil-trends-title">Probe trends</h2>
      <Chips label="Soil chart range" kind="nav" items={RANGES.map(({ key, label }) => {
        const params = new URLSearchParams(search);
        params.set("range", key);
        return { key, label, to: `?${params}`, current: range.key === key, keepScroll: true };
      })} />
    </div>
    {moisture.length > 0 && <p><Link to={waterHistory}>Compare moisture with watering runs</Link></p>}
    {charts.length === 0 ? <EmptyState message="No probe measurements are available to graph." /> : <>
      <p className="meta">Gaps indicate missing readings. Salinity and TDS are reference values reported by the probes.</p>
      <div className="wat-soil-trends-grid">
        {batches(charts).map((group) => <TrendsBatch key={group.map(({ key }) => key).join(",")} charts={group} seconds={range.seconds} />)}
      </div>
    </>}
  </section>;
}
