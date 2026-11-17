// SPDX-License-Identifier: MIT
import { useState } from "react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router";
import { CheckSheet } from "../components/check-sheet";
import { useClockValue } from "../components/freshness";
import { PageHeader } from "../components/layout/page-header";
import { LineOptions } from "../components/line-options";
import { PauseActions, PauseDrawer } from "../components/pause-lines";
import { WaterRuns } from "../components/run-dialog";
import { StopAllWater } from "../components/stop-all-water";
import { WaterStatus } from "../components/water/status-line";
import { useIrrigationRead } from "../lib/queries";
import { viewFor, viewMeta, type ViewId } from "../lib/sections";
import { useRole } from "../lib/session";
import { localDay, newScheduleUrl, type WaterOutlet } from "../lib/water";
import { useStop } from "../lib/writes";

export const meta = () => viewMeta("water-today");

const WATER_VIEWS: readonly ViewId[] = ["water-today", "water-schedules", "water-history", "water-soil"];
/** The Water view at `path` (Today, Schedules, History or Soil). */
function waterView(path: string): ViewId {
  const id = viewFor(path)?.id;
  return id && WATER_VIEWS.includes(id) ? id : "water-today";
}
const STATUS_VIEW = { "water-today": "today", "water-schedules": "schedules", "water-history": "history", "water-soil": "soil" } as const;

/**
 * Water's layout (screens section 3, redesign §5.2–§5.4, §10.5): the page header with its status line (the program state,
 * then what runs on Today, the next run on Schedules, or History's period summary and Soil's probe summary from their
 * views), its actions (Pause lines… on
 * Today, + New schedule on Schedules, an outline), and the Today, Schedules, History and Soil tabs. Above 860 px the top
 * bar's Stop all water is the only one (design review C1); at 860 px and below the page's own sits in the tabs row, which
 * sticks under the header, and reads "■ Stop all" (§9.6), sharing one `useStop`. Stop all water is shown whatever the status says and is
 * never gated by the writes flag. It polls API-IRR-01 once for all four views (every 15 s, 5 s while
 * an item settles with the engine on), under the key Now's water card and `useStop` share, and hands it to them. The
 * check sheet, line options, the pause drawer and the Run dialog open here from the URL, so a failed read that replaces
 * a view with its error leaves an open drawer or dialog and what was typed in it. No greenhouse data renders in SSR.
 */
export default function Water() {
  const irrigation = useIrrigationRead();
  const view = waterView(useLocation().pathname);
  const [search] = useSearchParams();
  const operator = useRole() === "operator";
  const today = useClockValue(localDay);
  const [summary, setSummary] = useState<string | null>(null);
  const context: WaterOutlet = { irrigation, setSummary };
  const lines = irrigation.data?.lines;
  const stop = useStop();
  const stopAll = { stop: () => { void stop.stop(); }, sending: stop.sending };
  const viewAction = view === "water-today" ? <PauseActions lines={lines} />
    : view === "water-schedules" ? <Link className="button-link" to={newScheduleUrl(search)} preventScrollReset data-write-control="true">+ New schedule</Link>
    : null;
  return <div className="water-page">
    <PageHeader view={view} status={<WaterStatus irrigation={irrigation} view={STATUS_VIEW[view as keyof typeof STATUS_VIEW]} today={today} summary={summary} />}
      statusShort={<WaterStatus irrigation={irrigation} view={STATUS_VIEW[view as keyof typeof STATUS_VIEW]} today={today} summary={summary} short />}
      actions={operator && viewAction ? viewAction : null} tabsEnd={<StopAllWater compact control={stopAll} />} stickyTabs />
    <WaterRuns status={irrigation.data}><Outlet context={context} /></WaterRuns>
    {irrigation.data && <CheckSheet lines={irrigation.data.lines} />}
    {irrigation.data && <LineOptions lines={irrigation.data.lines} />}
    <PauseDrawer lines={lines} />
  </div>;
}
