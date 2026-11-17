// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { ChartStack, type StackPanel } from "../charts/chart-stack";
import { buildTimeSeriesModel, chartNotes } from "../charts/time-series";
import { chartLinks } from "../charts/uplot-chart";
import { StatusBadge } from "../components/badge";
import { useNow } from "../components/freshness";
import { EmptyState, Panel, PanelErrorBoundary, type PanelState } from "../components/panel";
import { Segmented } from "../components/segmented";
import { duration, formatValue, shortTime } from "../lib/format";
import { slotRead, useGraphClock, useWindowReads } from "../lib/graph-reads";
import { RESERVOIR_METRICS, RESERVOIR_READINGS, hydroPlotSeries, latestHydroInterval, probeAge } from "../lib/hydroponics";
import { viewMeta } from "../lib/sections";
import { useShellNow } from "../lib/shell";
import CropsMap from "./crops-map";

export const meta = () => viewMeta("hydro-overview");
export const links = () => chartLinks();
const REGISTRY = [{ id: "registry", params: {} }] as const;
const RANGES = [{ id: "24h", hours: 24, label: "24 hours" }, { id: "7d", hours: 168, label: "7 days" }, { id: "30d", hours: 720, label: "30 days" }] as const;

/**
 * The reservoir now (H-01, H-04): pH, conductivity and water temperature as the probe last read them, each with its
 * age, and the probe's own age against the API's staleness limit. It shares the shell's API-02 poll.
 */
export function ReservoirPanel() {
  const shell = useShellNow();
  const now = useNow();
  const hydro = shell.data?.hydroponics ?? null;
  const probe = probeAge(hydro, now);
  const state: PanelState = shell.data === null ? (shell.error ? "error" : "loading") : hydro === null ? "empty" : probe.stale ? "stale" : "ready";
  return <Panel title="Reservoir" thing="the reservoir" state={state} observedAt={probe.at} reserve="sm"
    empty={<EmptyState message="No reservoir reading in the last 24 hours." detail="The probe reports about every 5 minutes when it is on the network." />}
    foot="Nutrients and pH are adjusted by hand; this page sets nothing.">
    <p className="hydro-probe" data-stale={probe.stale || undefined}>
      <StatusBadge status={probe.stale ? "warn" : "ok"} size="sm">{probe.stale ? "Overdue" : "Reporting"}</StatusBadge>{" "}
      {probe.age_s === null ? "The probe has not reported." : <>The probe last reported {duration(probe.age_s)} ago, at {shortTime(probe.at!)}; it reports about every 5 minutes.</>}
    </p>
    <dl className="hydro-now">{RESERVOIR_READINGS.map(({ key, label, unit }) => {
      const reading = hydro?.[key];
      return <div key={key} data-reading={key}>
        <dt>{label}</dt>
        <dd>{formatValue(reading?.value, unit)}{reading?.value === null || reading?.value === undefined ? <span className="meta"> {reading?.reason ?? "not reported"}</span> : null}</dd>
      </div>;
    })}</dl>
  </Panel>;
}

/** Water quality (H-02): the three channels over 24 hours, 7 days or 30 days, as recorded interval averages. */
function QualityPanel() {
  const [params] = useSearchParams();
  const range = RANGES.find((item) => item.id === params.get("range")) ?? RANGES[0];
  const registry = slotRead(useWindowReads("API-03", REGISTRY, null), "registry");
  const now = useGraphClock(true);
  const metrics = useMemo(() => RESERVOIR_METRICS.flatMap((key) => registry.data?.items.filter((metric) => metric.key === key) ?? []), [registry.data]);
  const from = now === null ? null : now - range.hours * 3600;
  const id = `${range.id}:${now}`;
  const read = slotRead(useWindowReads("API-04", now !== null && from !== null && metrics.length ? [{ id, params: {
    metric: metrics.map((metric) => metric.key), from: new Date(from * 1000).toISOString(), to: new Date(now * 1000).toISOString(),
  } }] : [], null), id);
  const panels: StackPanel[] = metrics.map((metric) => {
    const hasSamples = latestHydroInterval(read.data, metric.key) !== null;
    return { id: metric.key, name: metric.label, unit: metric.unit, metrics: [metric], series: hasSamples ? hydroPlotSeries(read.data, metric.key) : null,
      message: read.data ? "No data in this window" : "Loading water-quality readings…" };
  });
  const notes = now !== null && from !== null ? panels.flatMap((panel) => chartNotes(buildTimeSeriesModel({
    series: panel.series, metrics: panel.metrics, unit: panel.unit, now, xRange: { from, to: now },
  })).map((note) => `${panel.name}: ${note}`)) : [];
  const failed = registry.error !== null || read.error !== null;
  const state: PanelState = failed && !read.data ? "error" : registry.data && !metrics.length ? "empty" : now === null || !registry.data ? "loading" : "ready";
  return <Panel id="hydro-quality" title="Water quality" thing="water quality" state={state} reserve="lg"
    onRetry={() => { registry.refetch(); read.refetch(); }}
    actions={<Segmented label="Water quality time range" size="sm" value={range.id}
      segments={RANGES.map((item) => ({ value: item.id, label: item.label, to: `?range=${item.id}`, keepScroll: true }))} />}
    empty={<EmptyState message="The reservoir measures are not served." />}
    foot="Recorded interval averages. Lines join samples up to 10 minutes apart; longer gaps stay open. No nutrient or pH level is set here.">
    {notes.length > 0 && <ul className="chart-notes" aria-label="Reservoir data quality">{[...new Set(notes)].map((note) => <li key={note}>{note}</li>)}</ul>}
    {now !== null && from !== null && <ChartStack label="Hydroponic water quality" panels={panels} now={now} xRange={{ from, to: now }} syncKey={`hydro:${id}`} csvName="hydroponics" tableName="Water quality table" />}
  </Panel>;
}

/**
 * Hydroponics (`/hydroponics`, parity H-01 to H-05): how the hand-dosed reservoir is, and what grows in it. The reservoir
 * now with the probe's age, its water quality over time, then the rack's planting spots (the Crops map, scoped to the
 * hydro rack). There are no reservoir writes: nutrients and pH are adjusted by hand.
 */
export default function HydroponicsOverview() {
  return <div className="hydro-workspace l-grid">
    <div className="span-4">
      <PanelErrorBoundary thing="the reservoir"><ReservoirPanel /></PanelErrorBoundary>
    </div>
    <div className="span-8">
      <PanelErrorBoundary thing="water quality"><QualityPanel /></PanelErrorBoundary>
    </div>
    <section className="hydro-spots" aria-labelledby="hydro-planting-title">
      <h2 id="hydro-planting-title" className="hydro-spots-title">Planting spots</h2>
      <p className="meta">Select a spot or a whole rail to plant, edit, move or harvest. Spot labels follow the saved greenhouse layout.</p>
      <CropsMap />
    </section>
  </div>;
}
