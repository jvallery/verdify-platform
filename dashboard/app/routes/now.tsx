// SPDX-License-Identifier: MIT
/**
 * Now at `/` (dashboard v2 screens §1): whether the house is all right, and what needs you. The blocks, in the order a
 * phone reads them: the hero (the answer, worst first, and the two band gauges), what the controller is doing, Needs you,
 * Today, Run by hand (operators), Water today, the daily review, the reservoir and the probes. Above 860 px the side
 * column holds Needs you, Run by hand, the review and the reservoir. On a 390 × 844 phone the hero, the controller's
 * sentence and, for an operator, Stop all water (pinned above the bottom bar) are on the first screen.
 *
 * Reads, each polled through lib/polling.ts (paused while the tab is hidden, backing off on failures):
 * - API-02, the shell's own poll (`useShellNow`): the answer, the law's record, the readings, what runs, the review.
 * - API-IRR-01: Water today, the engine flag, the mister faults. Every 15 s, every 5 s while a Stop is pending.
 * - API-14 `status=recent`, Activity's read under its key: Needs you's open alerts and what was resolved in 24 h.
 * - API-30: the dew point and the outdoor source; API-31, API-32, API-03, API-04 and API-06 for Today and the probes;
 *   API-IRR-02 for what comes next; API-34 for the daily review. No plan is read.
 *
 * Each block fails alone, and Stop all water renders whatever the water status can or cannot show. Nothing here renders
 * greenhouse data on the server: the server render is the loading state, and the data loads in the browser.
 */
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chartLinks } from "../charts/uplot-chart";
import { useClockValue } from "../components/freshness";
import { ControllerDoing } from "../components/now/doing";
import { NowHero } from "../components/now/hero";
import { NowLights } from "../components/now/lights";
import { NeedsYou } from "../components/now/needs-someone";
import { useCaseRead, useDayRead } from "../components/now/reads";
import { ReservoirReadings } from "../components/now/reservoir";
import { NowReview } from "../components/now/review";
import { Today } from "../components/now/today";
import { WaterCard } from "../components/now/water-card";
import { PanelErrorBoundary } from "../components/panel";
import { RunByHand } from "../components/run-by-hand";
import { Probes } from "../components/zone-tiles";
import { RECENT_ALERTS } from "../lib/activity";
import { localDate } from "../lib/format";
import { nowAnswer, stepBandHold, type BandHold } from "../lib/now-answer";
import { SessionEnded, type Now as NowData } from "../lib/operator-api";
import { READ_INTERVAL_MS, SETTLING_INTERVAL_MS, irrigationSettling, panelRead, readKey, useApiRead, useLawRead } from "../lib/queries";
import { OperatorOnly } from "../lib/session";
import { useShellNow, useShellStatus } from "../lib/shell";
import { useStop } from "../lib/writes";

export const meta = () => [{ title: "Now · Verdify dashboard" }];
export const links = () => chartLinks();
/** Needs you reads API-14 every 15 s. */
export const ALERTS_POLL_MS = 15_000;

/**
 * The answer's dwell state over the API-02 answers this page has seen (`stepBandHold`), so row 6's headline and condition
 * line do not flicker at a band edge. Derived state, stepped once per new `server_time`.
 */
export function useBandHold(now: NowData | null | undefined): BandHold | null {
  const [hold, setHold] = useState<BandHold | null>(() => stepBandHold(null, now));
  const next = stepBandHold(hold, now);
  if (next !== hold) setHold(next);
  return next;
}

export default function Now() {
  const shell = useShellNow();
  const status = useShellStatus();
  const client = useQueryClient();
  const { stop, sending, confirming } = useStop();
  const pending = sending || confirming;
  const irrigation = panelRead(useApiRead("API-IRR-01", {}, { intervalMs: pending ? SETTLING_INTERVAL_MS : READ_INTERVAL_MS.irrigation, settling: irrigationSettling }));
  const alerts = panelRead(useApiRead("API-14", RECENT_ALERTS, { intervalMs: ALERTS_POLL_MS }));
  const law = panelRead(useLawRead());
  const day = panelRead(useDayRead());
  const caseRead = panelRead(useCaseRead());
  const today = useClockValue((clock) => localDate(new Date(clock).toISOString()));
  // The newest API-02 read failed: the sentence says so at once; the shell's banner waits for a second failure. A 401 is
  // the session ending, which the shell's card says.
  const failed = shell.error !== null && shell.error !== undefined && !(shell.error instanceof SessionEnded);
  const hold = useBandHold(shell.data);
  const answer = nowAnswer({ now: shell.data, failed, hold });
  const retryNow = useCallback(() => { void client.refetchQueries({ queryKey: readKey("API-02"), exact: true }); }, [client]);
  const stopControl = { stop: () => { void stop(); }, sending, confirming };
  return <div className="page now-page">
    <div className="now-main">
      <div className="now-slot now-slot-hero">
        <PanelErrorBoundary thing="the greenhouse data" onRetry={retryNow}>
          <NowHero now={shell.data} answer={answer} day={day} law={law} onRetry={retryNow} />
        </PanelErrorBoundary>
      </div>
      <div className="now-slot now-slot-doing">
        <PanelErrorBoundary thing="what the controller is doing" onRetry={retryNow}>
          <ControllerDoing now={shell.data} answer={answer} />
        </PanelErrorBoundary>
      </div>
      <div className="now-slot now-slot-today">
        <PanelErrorBoundary thing="today" onRetry={day.retry}>
          <Today day={day} irrigation={irrigation} today={today} />
        </PanelErrorBoundary>
      </div>
      <div className="now-slot now-slot-water">
        <PanelErrorBoundary thing="water status" text="Water status unavailable." onRetry={irrigation.retry}>
          <WaterCard irrigation={irrigation} stop={stopControl} />
        </PanelErrorBoundary>
      </div>
      <div className="now-slot now-slot-probes">
        <PanelErrorBoundary thing="the probes">
          <Probes now={shell.data} day={day} caseRead={caseRead} />
        </PanelErrorBoundary>
      </div>
    </div>
    <div className="now-side">
      <div className="now-slot now-slot-needs">
        <PanelErrorBoundary thing="alerts" text="Alerts unavailable" onRetry={alerts.retry}>
          <NeedsYou alerts={alerts} now={shell.data} answer={answer} apiFailed={failed} openCount={failed ? null : status.openAlerts} irrigation={irrigation} />
        </PanelErrorBoundary>
      </div>
      <OperatorOnly>
        <div className="now-slot now-slot-runs">
          <PanelErrorBoundary thing="the runs by hand">
            <RunByHand><NowLights /></RunByHand>
          </PanelErrorBoundary>
        </div>
      </OperatorOnly>
      <div className="now-slot now-slot-review">
        <PanelErrorBoundary thing="the daily review">
          <NowReview />
        </PanelErrorBoundary>
      </div>
      <div className="now-slot now-slot-reservoir">
        <PanelErrorBoundary thing="the reservoir">
          <ReservoirReadings />
        </PanelErrorBoundary>
      </div>
    </div>
  </div>;
}
