// SPDX-License-Identifier: MIT
import { useSearchParams } from "react-router";
import { chartLinks } from "../charts/uplot-chart";
import { Page } from "../components/layout/page";
import { PageHeader } from "../components/layout/page-header";
import { PanelErrorBoundary } from "../components/panel";
import { ContinuityPanel, DeliveryPanel, FlowPanel, IngestorCounters, ProbesPanel } from "../components/system/data-blocks";
import { PROBE_LOST_S, continuityDays, deliveryHours } from "../components/system/data-words";
import { duration } from "../lib/format";
import type { DataContinuity, Delivery } from "../lib/operator-api";
import { panelRead, useDataContinuityRead, useDeliveryRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";

/**
 * System → Data (screens section 10.3): whether the record is complete and the controller took what was sent. Flow,
 * probes, continuity and the ingestor counters read API-36 (`?days=` 1, 7 or 30); delivery reads API-37 (`?hours=` 24
 * or 168). Each block has its own error boundary; no data renders on the server.
 */
export const meta = () => viewMeta("system-data");
export const links = () => chartLinks();

/**
 * The status line: what is missing first ("Ingestor heartbeat 5 min ago", "1 probe not seen in 2 h", "3 settings not
 * taken"), joined; "Data flowing · every push taken" when nothing is; null while neither read has answered.
 */
export function dataStatus(continuity: DataContinuity | null | undefined, delivery: Delivery | null | undefined): string | null {
  if (!continuity && !delivery) return null;
  const parts: string[] = [];
  const heartbeat = continuity?.ingestor.heartbeat_age_s;
  if (typeof heartbeat === "number" && heartbeat > 120) parts.push(`Ingestor heartbeat ${duration(heartbeat)} ago`);
  const lost = continuity?.probes.filter((probe) => typeof probe.age_s === "number" && probe.age_s >= PROBE_LOST_S).length ?? 0;
  if (lost > 0) parts.push(`${lost} ${lost === 1 ? "probe" : "probes"} not seen in 2 h`);
  const failing = delivery?.failing.length ?? 0;
  if (failing > 0) parts.push(`${failing} ${failing === 1 ? "setting" : "settings"} not taken`);
  if (parts.length > 0) return parts.join(" · ");
  return delivery ? "Data flowing · every push taken" : "Data flowing";
}

export default function SystemData() {
  const [params] = useSearchParams();
  const days = continuityDays(params.get("days"));
  const hours = deliveryHours(params.get("hours"));
  const continuity = panelRead(useDataContinuityRead({ days }));
  const delivery = panelRead(useDeliveryRead({ hours }));
  const line = dataStatus(continuity.failed ? null : continuity.data, delivery.failed ? null : delivery.data);
  return <Page className="sys-page sys-data">
    <PageHeader view="system-data" status={line} statusShort={line} />
    <div className="l-stack sys-blocks">
      <div className="sys-pair">
        <PanelErrorBoundary thing="the data flow" onRetry={continuity.retry}><FlowPanel read={continuity} /></PanelErrorBoundary>
        <PanelErrorBoundary thing="the probes" onRetry={continuity.retry}><ProbesPanel read={continuity} /></PanelErrorBoundary>
      </div>
      <PanelErrorBoundary thing="continuity" onRetry={continuity.retry}><ContinuityPanel read={continuity} days={days} /></PanelErrorBoundary>
      <PanelErrorBoundary thing="delivery" onRetry={delivery.retry}><DeliveryPanel read={delivery} hours={hours} /></PanelErrorBoundary>
      <PanelErrorBoundary thing="the ingestor counters" onRetry={continuity.retry}><IngestorCounters read={continuity} /></PanelErrorBoundary>
    </div>
  </Page>;
}
