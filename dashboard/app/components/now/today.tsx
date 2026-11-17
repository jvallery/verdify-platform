// SPDX-License-Identifier: MIT
/**
 * Today on Now (dashboard v2 screens §1 block 4): the last 24 h of the house temperature and VPD against the band, two
 * small linked charts on one time axis (the time-series kind, with outdoor on the temperature chart); one row group of
 * what ran (heating, cooling, humidifying, drying) from the law's requests (API-31, the state-lanes kind); and beside the
 * title, time in band today so far and yesterday and whether last night dried out (API-32). Coming up sits under them.
 *
 * Reads: the day read (API-04, passed in), API-03 for the metrics, API-06 for the house band, API-31 over 24 h and API-32
 * for yesterday and today. Each part fails alone and says so with Retry; nothing is drawn from a guess.
 */
import { StateLanesChart, spansFromIntervals, type StateLaneRow } from "../../charts/state-lanes";
import { TimeSeries } from "../../charts/time-series";
import type { IrrigationStatus, MetricDef, Series } from "../../lib/operator-api";
import { READ_INTERVAL_MS, panelRead, useApiRead, useBandWindowRead, useLawHistoryRead, type PanelRead } from "../../lib/queries";
import { useApiDown } from "../../lib/session";
import { useClockValue } from "../freshness";
import { Button } from "../button";
import { ComingUp } from "../coming-up";
import { Panel } from "../panel";
import { Term } from "../term";
import { HOUSE_KEYS, OUTDOOR_KEY, SPARK_S, inBand, nightWords, percentText, type InBand } from "./climate";
import { ranIntervals } from "./ran";
import { useInBandRead } from "./reads";

export const TODAY_ID = "today";
export const SYNC_KEY = "verdify:now:24h";
const TEMP_KEYS = [HOUSE_KEYS.temp, OUTDOOR_KEY];
const VPD_KEYS = [HOUSE_KEYS.vpd];

/** "In band today 92% · yesterday 88% · Last night did not dry out"; null with nothing to say. */
export function inBandWords(band: InBand): string | null {
  const parts = [
    band.today !== null ? `today ${percentText(band.today)}` : null,
    band.yesterday !== null ? `yesterday ${percentText(band.yesterday)}` : null,
  ].filter(Boolean);
  const night = nightWords(band);
  if (!parts.length && !night) return null;
  return [parts.length ? `In band ${parts.join(" · ")}` : null, night].filter(Boolean).join(" · ");
}

function InBandLine({ today }: { today: string }) {
  const read = panelRead(useInBandRead(today));
  // With the dashboard API down nothing here can vouch for itself: no share of the day is shown.
  if (useApiDown()) return null;
  if (read.failed && !read.data) return <span className="meta" data-today="tib-failed">Time in band unavailable</span>;
  const words = read.data ? inBandWords(inBand(read.data, today)) : null;
  return words ? <span className="now-tib" data-today="tib"><Term id="in_band">{words}</Term></span> : null;
}

function Failed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return <p className="fault now-next-failed">Couldn't load {what}. <Button onClick={onRetry}>Retry</Button></p>;
}

function Charts({ day, metrics, now }: { day: PanelRead<Series>; metrics: readonly MetricDef[]; now: number }) {
  const band = panelRead(useBandWindowRead("house", SPARK_S));
  const xRange = { from: now - SPARK_S, to: now };
  const of = (keys: readonly string[]) => metrics.filter((metric) => keys.includes(metric.key));
  const series = day.failed ? null : day.data;
  const message = day.failed ? "Couldn't load the last 24 h" : day.pending ? "Loading the last 24 h" : undefined;
  return <div className="now-today-charts">
    <TimeSeries title="Temperature" series={series} metrics={of(TEMP_KEYS)} unit="°F" band={band.failed ? null : band.data} now={now} xRange={xRange} syncKey={SYNC_KEY} linked csv={false} zoomControl={false} message={message} />
    <TimeSeries title="VPD" series={series} metrics={of(VPD_KEYS)} unit="kPa" band={band.failed ? null : band.data} now={now} xRange={xRange} syncKey={SYNC_KEY} linked csv={false} zoomControl={false} message={message} />
    {day.failed && <Failed what="the last 24 h" onRetry={day.retry} />}
  </div>;
}

function WhatRan({ now }: { now: number }) {
  const history = panelRead(useLawHistoryRead(SPARK_S));
  const range = { from: now - SPARK_S, to: now };
  const from = new Date(range.from * 1000).toISOString(), to = new Date(range.to * 1000).toISOString();
  if (history.failed && !history.data) return <Failed what="what ran" onRetry={history.retry} />;
  if (!history.data) return <><div className="skeleton skeleton-sm" aria-hidden="true" /><p className="screen-reader">Loading what ran</p></>;
  const rows: StateLaneRow[] = ranIntervals(history.data, from, to).map(({ row, intervals }) => ({
    key: row.key, label: row.label, token: row.token, group: "ran", spans: spansFromIntervals(intervals, range),
  }));
  return <StateLanesChart title="What ran" rows={rows} groups={[{ key: "ran", label: "What ran" }]} range={range} now={now} syncKey={SYNC_KEY} />;
}

export type TodayProps = {
  /** The day read (API-04 over 25 h). */
  readonly day: PanelRead<Series>;
  readonly irrigation: PanelRead<IrrigationStatus>;
  /** Today's local date, "2026-11-02". */
  readonly today: string;
};

export function Today({ day, irrigation, today }: TodayProps) {
  // The minute on the server's clock: the window moves once a minute.
  const now = useClockValue((value) => Math.floor(value / 60_000) * 60);
  const registry = panelRead(useApiRead("API-03", {}, { intervalMs: READ_INTERVAL_MS.zones }));
  const metrics = registry.failed ? [] : registry.data?.items ?? [];
  return <Panel id={TODAY_ID} title="Today" thing="today" state="ready" actions={<InBandLine today={today} />}
    link={{ to: "/graphs?range=24h", label: <>Graphs<span className="screen-reader"> for the last 24 h</span></> }}>
    {registry.failed && !registry.data
      ? <Failed what="the chart's metrics" onRetry={registry.retry} />
      : <Charts day={day} metrics={metrics} now={now} />}
    <WhatRan now={now} />
    <ComingUp irrigation={irrigation} />
  </Panel>;
}
