// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useState } from "react";
import { chartLinks } from "../charts/uplot-chart";
import { EmptyState, Panel, PanelErrorBoundary } from "../components/panel";
import { ChartGroup, type KeyItem } from "../charts/legend";
import { soilAnswer, soilSummary } from "../components/water/soil-model";
import { SoilZone, type ZoneReport } from "../components/water/soil-zone";
import { READ_INTERVAL_MS, panelRead, useApiRead, useRegistryRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";
import { useWaterOutlet } from "../lib/water";

export const meta = () => viewMeta("water-soil");
/** The zones' one chart key (design review A3): each zone's lines sit at its own values, so the key names the lines once. */
const SOIL_KEY: readonly KeyItem[] = [
  { key: "wilt", label: "Wilt", token: "--critical", kind: "dashed" },
  { key: "low", label: "Low end", token: "--warn", kind: "dashed" },
  { key: "high", label: "High end", token: "--warn", kind: "dashed" },
];
export const links = () => chartLinks();

/**
 * Water → Soil (`/water/soil`, screens section 3.4, parity SO-01 to SO-03): is each zone's soil where I want it? One
 * panel per probe zone from the soil target rows (API-SOIL-01), each with its moisture, conductivity and temperature now,
 * a 7-day chart of moisture against its range, the range with Edit for an operator (API-SOIL-02) and when the probe last
 * answered, under the answer in words and one key for the zones' charts. The metric registry (API-03) says which of a
 * probe's measures exist, since API-04 refuses an unknown key. It
 * renders under Water's layout, which draws the header and the tabs; the status line carries the probes' summary.
 */
export default function WaterSoil() {
  const { setSummary } = useWaterOutlet();
  const targets = panelRead(useApiRead("API-SOIL-01", {}, { intervalMs: READ_INTERVAL_MS.settings }));
  const registry = panelRead(useRegistryRead());
  const [reports, setReports] = useState<Readonly<Record<string, ZoneReport>>>({});
  const onReport = useCallback((report: ZoneReport) => setReports((current) => {
    const before = current[report.zone];
    if (before && before.state === report.state && before.relation.status === report.relation.status && before.relation.text === report.relation.text) return current;
    return { ...current, [report.zone]: report };
  }), []);
  const zones = targets.data?.targets ?? null;
  const known = zones ? zones.map((zone) => reports[zone.zone] ?? { zone: zone.zone, state: "unknown" as const, relation: { status: "neutral" as const, text: "" } }) : [];
  const summary = zones ? soilSummary(known) : null;
  const answer = soilAnswer(known);
  useEffect(() => {
    setSummary?.(summary);
    return () => setSummary?.(null);
  }, [setSummary, summary]);
  if (!zones || !registry.data) {
    const failed = (targets.failed && !zones) || (registry.failed && !registry.data);
    return <div className="wat-soil">
      <Panel title="Soil" thing="the soil probes" state={failed ? "error" : "loading"} reserve="lg" onRetry={() => { targets.retry(); registry.retry(); }} />
    </div>;
  }
  if (!zones.length) {
    return <div className="wat-soil">
      <Panel title="Soil" thing="soil probes" state="empty" empty={<EmptyState message="No soil probe zones are set up." detail="A probe zone is added with its probe, by a database change." />} />
    </div>;
  }
  const metrics = registry.data.items;
  // The answer first (design review A4), then the zones side by side, three a row at 1440 px, under one key for their charts (A3).
  return <div className="wat-soil">
    <p className="page-answer wat-answer" data-answer="">{answer ?? "Reading the soil probes…"}</p>
    <ChartGroup label="Moisture against each zone's range" items={SOIL_KEY} className="wat-soil-group">
      <div className="wat-soil-grid">
        {zones.map((target) => <PanelErrorBoundary key={target.zone} thing={`the ${target.zone} probe`}>
          <SoilZone target={target} registry={metrics} onReport={onReport} />
        </PanelErrorBoundary>)}
      </div>
    </ChartGroup>
  </div>;
}
