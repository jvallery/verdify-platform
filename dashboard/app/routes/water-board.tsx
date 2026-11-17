// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import { useClockValue } from "../components/freshness";
import { Panel, PanelError, PanelErrorBoundary } from "../components/panel";
import { ScheduleLegend } from "../components/schedule/day-timeline";
import { dayModel, entriesOf, valveEpisodes } from "../components/schedule/model";
import { MistingPanel } from "../components/water/misting";
import { SiteToday } from "../components/water/site-today";
import { ZoneCard, zoneKind, type TodayStrips } from "../components/water/zone-card";
import { usePhone } from "../lib/narrow";
import { useApiRead, useSchedulesRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";
import { UNAVAILABLE_TEXT, dayStatesParams, localDay, plannedToday, toMinute, useWaterOutlet, zoneSummaries } from "../lib/water";

export const meta = () => viewMeta("water-today");

/** Today's groups (#1349), each under its own heading: the drips, the misters, then fog as the climate device. */
const TODAY_GROUPS = [{ kind: "drip", title: "Drips" }, { kind: "mister", title: "Misters" }, { kind: "fog", title: "Climate" }] as const;

/**
 * Water → Today (`/water`, screens section 3.1, #1349): one card per physical line under Drips, Misters and Climate (Wall
 * drip, Center drip; Center, South and West mister; Fog), each with its minutes against its cap and when it last watered,
 * a mister's VPD control and Schedule on its own row, and a row per line with its state sentence, its today strip and
 * next run, Run…, its own Stop and ⋯; then the legend. Beside them from 1200 px (sticky), first below that: Site today
 * (the daily mist and fog limit, the soft daily budget with Change, flow, occupancy, backup misting) and Misting (why the
 * misters and the fog are or are not running, API-30 and API-13). On a phone Misting follows the zones instead, so the
 * lines' live state stays ahead of the explanation on the first screen (`usePhone`: the server and the hydrating render
 * keep it in the aside). The layout's API-IRR-01 read drives the cards and Site today; API-IRR-02 (60 s) adds the runs
 * and the planned minutes, and API-05 for today the valve's open time. A failed status read says "Water status
 * unavailable", never idle, and Misting keeps its own read.
 */
export default function WaterBoard() {
  const { irrigation } = useWaterOutlet();
  const phone = usePhone();
  const agenda = useSchedulesRead();
  const today = useClockValue(localDay);
  const now = useClockValue(toMinute);
  const lanes = useApiRead("API-05", dayStatesParams(today), { intervalMs: 60_000 });
  const status = irrigation.data;
  const strips = useMemo((): TodayStrips | null => {
    if (!status || !agenda.data) return null;
    const model = dayModel({ day: today, today, now, agenda: agenda.data, lines: status.lines, lanes: lanes.data ?? null, entries: entriesOf(agenda.data, null, now) });
    // The timeline's lanes hold a physical line's clean and fertilized relays together (#1347); each Today row is one relay.
    const until = Math.min(model.to, now / 1000);
    const byLine = new Map(model.groups.flatMap((group) => group.rows).flatMap((row) => row.lineIds.map((lineId) => [lineId, {
      blocks: row.blocks.filter((block) => block.lineId === lineId), episodes: valveEpisodes(lanes.data ?? null, lineId, model.from, until), valveKnown: row.valveKnown,
    }] as const)));
    // Fog is not schedulable, so the timeline has no row for it: its valve alone.
    byLine.set("L11", { blocks: [], episodes: valveEpisodes(lanes.data ?? null, "L11", model.from, until), valveKnown: lanes.data !== undefined });
    return { from: model.from, to: model.to, night: model.night, byLine };
  }, [status, agenda.data, lanes.data, today, now]);
  const misting = <PanelErrorBoundary thing="misting"><MistingPanel /></PanelErrorBoundary>;
  if (irrigation.isError) {
    return <div className="wat-today">
      {!phone && <div className="wat-aside">{misting}</div>}
      <div className="wat-zones"><PanelError thing="the water status" text={UNAVAILABLE_TEXT} onRetry={() => void irrigation.refetch()} /></div>
      {phone && misting}
    </div>;
  }
  if (!status) {
    return <div className="wat-today" aria-busy="true">
      <div className="wat-aside"><Panel title="Site today" thing="today's water limits" state="loading" reserve="md" />{!phone && misting}</div>
      <div className="wat-zones"><div className="skeleton skeleton-lg" aria-hidden="true" /><div className="skeleton skeleton-lg" aria-hidden="true" /></div>
      {phone && misting}
      <p className="screen-reader">Loading the water status</p>
    </div>;
  }
  const planned = agenda.data ? plannedToday(agenda.data, status.lines, today, now) : null;
  const schedules = agenda.data?.schedules ?? [];
  const summaries = zoneSummaries(status, planned);
  return <div className="wat-today">
    <div className="wat-aside">
      <Panel title="Site today" thing="today's water limits" state="ready"><SiteToday status={status} today={today} /></Panel>
      {!phone && misting}
    </div>
    <div className="wat-zones">
      {TODAY_GROUPS.map((group) => <section key={group.kind} className="wat-group" data-group={group.kind} aria-labelledby={`wat-group-${group.kind}`}>
        <h2 id={`wat-group-${group.kind}`} className="wat-group-title">{group.title}</h2>
        {summaries.filter((summary) => zoneKind(summary.zone) === group.kind).map((summary) => <ZoneCard key={summary.zone} summary={summary} status={status} today={today} now={now} strips={strips} schedules={schedules} />)}
      </section>)}
      <ScheduleLegend className="wat-legend" />
    </div>
    {phone && misting}
  </div>;
}
