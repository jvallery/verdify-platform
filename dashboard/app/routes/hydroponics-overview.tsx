// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { ChartStack, type StackPanel } from "../charts/chart-stack";
import { buildTimeSeriesModel, chartNotes } from "../charts/time-series";
import { ReservoirReadings } from "../components/now/reservoir";
import { hydroPlotSeries, latestHydroInterval } from "../lib/hydroponics";
import { chartLinks } from "../charts/uplot-chart";
import { PanelError } from "../components/panel";
import { slotRead, useGraphClock, useWindowReads } from "../lib/graph-reads";
import { viewMeta } from "../lib/sections";
import CropsMap from "./crops-map";

export const meta = () => viewMeta("hydro-overview");
export const links = () => chartLinks();
const REGISTRY = [{ id: "registry", params: {} }] as const;
const RANGES = [{ id: "24h", hours: 24, label: "24 hours" }, { id: "7d", hours: 168, label: "7 days" }, { id: "30d", hours: 720, label: "30 days" }] as const;
const KEYS = ["climate.hydro_ph", "climate.hydro_ec_us_cm", "climate.hydro_water_temp_f"];

/** One workspace for the hand-dosed reservoir and its real, API-defined planting positions. */
export default function HydroponicsOverview() {
  const [params] = useSearchParams();
  const range = RANGES.find((item) => item.id === params.get("range")) ?? RANGES[0];
  const registry = slotRead(useWindowReads("API-03", REGISTRY, null), "registry");
  const now = useGraphClock(true);
  const metrics = useMemo(() => KEYS.flatMap((key) => registry.data?.items.filter((metric) => metric.key === key) ?? []), [registry.data]);
  const from = now === null ? null : now - range.hours * 3600;
  const id = `${range.id}:${now}`;
  const read = slotRead(useWindowReads("API-04", now !== null && from !== null && metrics.length ? [{ id, params: {
    metric: metrics.map((metric) => metric.key), from: new Date(from * 1000).toISOString(), to: new Date(now * 1000).toISOString(),
  } }] : [], null), id);
  const panels: StackPanel[] = metrics.map((metric) => {
    const hasSamples = latestHydroInterval(read.data, metric.key) !== null;
    return { id: metric.key, name: metric.label, unit: metric.unit, metrics: [metric], series: hasSamples ? hydroPlotSeries(read.data, metric.key) : null,
      message: read.error !== null ? "Water-quality readings could not be refreshed. Retry to load this window." : read.data ? "No data in this window" : "Loading water-quality readings…" };
  });
  const notes = now !== null && from !== null ? panels.flatMap((panel) => chartNotes(buildTimeSeriesModel({
    series: panel.series, metrics: panel.metrics, unit: panel.unit, now, xRange: { from, to: now },
  })).map((note) => `${panel.name}: ${note}`)) : [];
  return <div className="hydro-workspace">
    <nav className="workspace-jumps" aria-label="Hydroponics workspace"><a href="#hydro-planting-title">Manage planting spots ↓</a><a href="#hydro-quality-title">Water-quality trends ↓</a></nav>
    <ReservoirReadings link={false} />
    <section aria-labelledby="hydro-quality-title">
      <div className="workspace-heading"><div><p className="eyebrow">OBSERVE</p><h2 id="hydro-quality-title" tabIndex={-1}>Water quality</h2></div>
        <nav className="hydro-ranges" aria-label="Water quality time range">{RANGES.map((item) => <Link key={item.id} to={`?range=${item.id}`} preventScrollReset aria-current={item.id === range.id ? "page" : undefined}>{item.label}</Link>)}</nav>
      </div>
      <p className="meta">Recorded interval averages. Lines connect samples up to 10 minutes apart; longer gaps stay open; these charts do not prescribe nutrient or pH targets.</p>
      {notes.length > 0 && <ul className="chart-notes" aria-label="Reservoir data quality">{[...new Set(notes)].map((note) => <li key={note}>{note}</li>)}</ul>}
      {(registry.error !== null || read.error !== null) && <PanelError thing="water quality" onRetry={() => { registry.refetch(); read.refetch(); }} />}
      {registry.data && !metrics.length ? <p className="card">Water-quality metrics are not available from the platform.</p> : now !== null && from !== null && metrics.length > 0 ? <ChartStack label="Hydroponic water quality" panels={panels} now={now} xRange={{ from, to: now }} syncKey={`hydro:${id}`} csvName="hydroponics" tableName="Water quality table" /> : <p aria-busy="true">Loading water-quality charts…</p>}
    </section>
    <section aria-labelledby="hydro-planting-title">
      <div className="workspace-heading"><div><p className="eyebrow">GROW</p><h2 id="hydro-planting-title" tabIndex={-1}>Your planting spots</h2></div><Link to="/crops/history">Planting history →</Link></div>
      <p className="meta">Select a spot or a whole rail to plant, edit, move or harvest. Spot labels follow the saved greenhouse layout.</p>
      <CropsMap />
    </section>
  </div>;
}
