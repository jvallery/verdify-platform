// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { chartLinks } from "../charts/uplot-chart";
import { useClockValue } from "../components/freshness";
import { Page } from "../components/layout/page";
import { PageHeader } from "../components/layout/page-header";
import { PanelErrorBoundary } from "../components/panel";
import { ContinuityPanel, DataAnswer, DeliveryPanel, FlowPanel, IngestorCounters, ProbesPanel } from "../components/system/data-blocks";
import {
  continuityDays, continuitySentence, deliveryHours, deliveryLine, failingNow, flowLine, probeSummary, probesLine, stoppedWords, type ProbeSummary,
} from "../components/system/data-words";
import { duration } from "../lib/format";
import type { DataContinuity, Delivery, Setting } from "../lib/operator-api";
import { panelRead, useDataContinuityRead, useDeliveryRead, useSettingsRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";

/**
 * System → Data (screens section 10.3, review B6): whether the record is complete and the controller took what was
 * sent. The answer first (what was lost, what the gap log replayed, and a line each for flow, probes and delivery); then
 * flow, probes, continuity and the ingestor counters from API-36 (`?days=` 1, 7 or 30) and delivery from API-37
 * (`?hours=` 24 or 168), the settings whose pushes failed named by API-09's catalogue, which also says whether the
 * controller holds the wanted value: a setting is not taken now only when the ledger and the catalogue both say so. Until
 * API-09 answers or fails, delivery counts nothing (the catalogue may clear it a moment later). Each block has its own
 * error boundary; no data renders on the server.
 */
export const meta = () => viewMeta("system-data");
export const links = () => chartLinks();

/**
 * The status line: what is missing first ("Ingestor heartbeat 5 min ago", "1 probe stopped answering today", "3
 * settings not taken"), then the probes known to be silent, named apart ("7 soil probes silent since 14 Nov"), joined;
 * "Data flowing · every push taken" when nothing is; null while neither read has answered. Only a probe that stopped
 * within the day counts as missing, and only a setting failing against the catalogue (`failingRows`) as not taken.
 */
export function dataStatus(continuity: DataContinuity | null | undefined, delivery: Delivery | null | undefined, probes: ProbeSummary | null, catalog: readonly Setting[] | null): string | null {
  if (!continuity && !delivery) return null;
  const parts: string[] = [];
  const heartbeat = continuity?.ingestor.heartbeat_age_s;
  if (typeof heartbeat === "number" && heartbeat > 120) parts.push(`Ingestor heartbeat ${duration(heartbeat)} ago`);
  const stopped = stoppedWords(probes?.stoppedToday ?? 0);
  if (stopped) parts.push(stopped);
  const failing = delivery ? failingNow(delivery.failing, catalog) : 0;
  if (failing > 0) parts.push(`${failing} ${failing === 1 ? "setting" : "settings"} not taken`);
  if (parts.length === 0) parts.push(delivery ? "Data flowing · every push taken" : "Data flowing");
  if (probes?.knownText) parts.push(probes.knownText);
  return parts.join(" · ");
}

const minute = (now: number) => Math.floor(now / 60_000) * 60_000;

export default function SystemData() {
  const [params] = useSearchParams();
  const days = continuityDays(params.get("days"));
  const hours = deliveryHours(params.get("hours"));
  const continuity = panelRead(useDataContinuityRead({ days }));
  const delivery = panelRead(useDeliveryRead({ hours }));
  const settings = panelRead(useSettingsRead());
  const now = useClockValue(minute);
  const data = continuity.failed ? null : continuity.data;
  // The catalogue settles when API-09 answers or fails; null when it is not available (the ledger alone decides then).
  const catalogSettled = settings.data !== null || settings.failed;
  const catalog = settings.data?.items ?? null;
  const pushes = delivery.failed || !catalogSettled ? null : delivery.data;
  const probes = useMemo(() => (data ? probeSummary(data.probes, now) : null), [data, now]);
  const line = dataStatus(data, pushes, probes, catalog);
  const stopped = stoppedWords(probes?.stoppedToday ?? 0);
  const sentence = data ? `${continuitySentence(data, days).replace(/\.$/, "")}${stopped ? `; ${stopped}` : ""}.` : null;
  return <Page className="sys-page sys-data">
    <PageHeader view="system-data" status={line} statusShort={line} />
    <div className="l-stack sys-blocks">
      <DataAnswer sentence={sentence} failed={continuity.failed} flow={data ? flowLine(data) : null} probes={probes ? probesLine(probes) : null}
        delivery={pushes ? deliveryLine(pushes, hours, catalog) : null} />
      <div className="sys-pair">
        <PanelErrorBoundary thing="the data flow" onRetry={continuity.retry}><FlowPanel read={continuity} /></PanelErrorBoundary>
        <PanelErrorBoundary thing="the probes" onRetry={continuity.retry}><ProbesPanel read={continuity} summary={probes} /></PanelErrorBoundary>
      </div>
      <PanelErrorBoundary thing="continuity" onRetry={continuity.retry}><ContinuityPanel read={continuity} days={days} /></PanelErrorBoundary>
      <PanelErrorBoundary thing="delivery" onRetry={delivery.retry}><DeliveryPanel read={delivery} hours={hours} catalog={catalog} catalogSettled={catalogSettled} /></PanelErrorBoundary>
      <PanelErrorBoundary thing="the ingestor counters" onRetry={continuity.retry}><IngestorCounters read={continuity} /></PanelErrorBoundary>
    </div>
  </Page>;
}
