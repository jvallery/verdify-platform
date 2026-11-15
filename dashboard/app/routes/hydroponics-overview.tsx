// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { ChartStack, type StackPanel } from "../charts/chart-stack";
import { chartLinks } from "../charts/uplot-chart";
import { PanelError } from "../components/panel";
import { hydroTally } from "../lib/crops";
import { slotRead, useGraphClock, useWindowReads } from "../lib/graph-reads";
import { viewMeta } from "../lib/sections";
import { useCropsOutlet } from "./crops";
import CropsMap from "./crops-map";

export const meta = () => viewMeta("hydro-overview");
export const links = () => chartLinks();
const REGISTRY = [{ id: "registry", params: {} }] as const;
const RANGES = [{ id: "24h", hours: 24, label: "24 hours" }, { id: "7d", hours: 168, label: "7 days" }, { id: "30d", hours: 720, label: "30 days" }] as const;
const KEYS = ["climate.hydro_ph", "climate.hydro_ec_us_cm", "climate.hydro_water_temp_f", "climate.hydro_tds_ppm", "climate.hydro_orp_mv"];

/** One workspace for the hand-dosed reservoir and its real, API-defined planting positions. */
export default function HydroponicsOverview() {
  const { locations } = useCropsOutlet();
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
  const tally = locations.data && !locations.isError && locations.consecutiveFailures === 0 ? hydroTally(locations.data) : null;
  const panels: StackPanel[] = metrics.map((metric) => ({ id: metric.key, name: metric.label, unit: metric.unit, metrics: [metric], series: read.data,
    message: read.error ? "Water-quality readings could not be refreshed. Retry to load this window." : undefined }));
  return <div className="hydro-workspace">
    <section className="hydro-intro" aria-label="System overview">
      <div><p className="eyebrow">RESERVOIR & ROOTS</p><h2>Your hydroponic garden.</h2><p>Follow water quality, record each crop and plan the next planting.</p><p className="meta">Hand-dosed reservoir. Planting records do not change dosing or climate controls.</p></div>
      <div className="hydro-capacity"><span className="eyebrow">PLANTED SPOTS</span><strong>{tally ? `${tally.planted} / ${tally.total}` : "—"}</strong><span>{tally ? `${tally.total - tally.planted} available` : "Waiting for the location map"}</span></div>
    </section>
    <nav className="workspace-jumps" aria-label="Hydroponics workspace"><a href="#hydro-planting-title">Manage planting spots ↓</a><a href="#hydro-quality-title">Water-quality trends ↓</a></nav>
    <section aria-labelledby="hydro-quality-title">
      <div className="workspace-heading"><div><p className="eyebrow">OBSERVE</p><h2 id="hydro-quality-title" tabIndex={-1}>Water quality</h2></div>
        <nav className="hydro-ranges" aria-label="Water quality time range">{RANGES.map((item) => <Link key={item.id} to={`?range=${item.id}`} preventScrollReset aria-current={item.id === range.id ? "page" : undefined}>{item.label}</Link>)}</nav>
      </div>
      <p className="meta">Measured reservoir readings. Gaps mean no samples; these charts do not prescribe nutrient or pH targets.</p>
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
