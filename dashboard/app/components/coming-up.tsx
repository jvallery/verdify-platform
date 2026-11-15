// SPDX-License-Identifier: MIT
/** Observed equipment history and a separate scheduled-work agenda. */
import { useRef } from "react";
import type { NowAnswer } from "../lib/now-answer";
import type { IrrigationStatus, Now } from "../lib/operator-api";
import { READ_INTERVAL_MS, panelRead, useApiRead, useEquipmentRead, useSettingsRead, useStatesWindowRead, type PanelRead } from "../lib/queries";
import { useMe } from "../lib/shell";
import { Badge } from "./badge";
import { Button } from "./button";
import { cls } from "./common";
import { TimeTrack } from "./data/time-track";
import { useClockValue } from "./freshness";
import { NEXT_H, PAST_H, itemTime, laterText, nextItems, nextWindow, equipmentRow, pastSpans, type NextItem, type NextWindow } from "./now/next";
import { useNearViewport } from "./now/reads";
import { RunningNow } from "./now/running";
import { Panel } from "./panel";
import { words } from "../lib/words";

const PLAN_PARAMS = { hours: 24 } as const;
const AGENDA_PARAMS = { days: 7 } as const;
export const NOTHING_NEXT = "Nothing planned in the next 12 h";
export const RUNS_BEFORE_ENGINE = "Schedules run with the irrigation firmware";
export const TRACK_LABEL = "Equipment history: the last 6 hours";

/** A read's failure in one line, with Retry. */
function Failed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return <p className="fault now-next-failed">Couldn't load {what}. <Button onClick={onRetry}>Retry</Button></p>;
}

/** The track, its six hours of API-05 read once it is near the screen. */
function Track({ window, near }: { window: NextWindow; near: boolean }) {
  return near ? <LiveTrack window={window} /> : <TimeTrack label={TRACK_LABEL} from={window.from} to={window.now} rows={[]} state="loading" />;
}
function LiveTrack({ window }: { window: NextWindow }) {
  const lanes = panelRead(useStatesWindowRead(PAST_H * 3600));
  const historyWindow = { ...window, to: window.now };
  const rows = (lanes.data?.lanes ?? []).filter((lane) => equipmentRow(lane.equipment)).map((lane) => ({
    key: lane.equipment,
    label: words("equipment", lane.equipment),
    spans: [...pastSpans({ ...lanes.data!, lanes: [lane] }, historyWindow).values()].flat(),
    data: { "data-equipment": lane.equipment },
  }));
  return <>
    <TimeTrack label={TRACK_LABEL} from={window.from} to={window.now} now={window.now} rows={rows} gridHours={1} state={lanes.failed ? "error" : lanes.pending ? "loading" : "ready"} />
    {lanes.failed && <Failed what="the last 6 h" onRetry={lanes.retry} />}
  </>;
}

/** One row of "Next 12 h": its time, what happens, and who planned it or why it will not run. */
function NextRow({ item, clock }: { item: NextItem; clock: number }) {
  const skipped = item.status === "skipped" || item.status === "blocked";
  return <li className={cls("now-next-item", skipped && "now-next-skipped")} data-coming={item.kind}>
    <time className="now-next-time" dateTime={new Date(item.at * 1000).toISOString()}>{itemTime(item.at, clock)}</time>
    <span className="now-next-what">{item.text}{item.ai && <> <Badge kind="ai" /></>}{item.note && <span className="meta"> · {item.note}</span>}</span>
  </li>;
}

export type RunningAndNextProps = {
  readonly now: Now | null;
  readonly answer: NowAnswer;
  readonly irrigation: PanelRead<IrrigationStatus>;
};

export function RunningAndNext({ now, answer, irrigation }: RunningAndNextProps) {
  const plan = panelRead(useApiRead("API-07", PLAN_PARAMS, { intervalMs: READ_INTERVAL_MS.plan }));
  const agenda = panelRead(useApiRead("API-IRR-02", AGENDA_PARAMS, { intervalMs: READ_INTERVAL_MS.schedules }));
  // The lights' windows and intent (#1340): a failed read draws neither, never a guess.
  const settingsRead = useSettingsRead();
  const equipmentRead = useEquipmentRead();
  const settings = settingsRead.error ? null : settingsRead.data?.items ?? null;
  const equipment = equipmentRead.error ? null : equipmentRead.data?.items ?? null;
  const me = useMe();
  // The clock's minute, on the server's clock: the hours around now are worth one render a minute.
  const clock = useClockValue((value) => Math.floor(value / 60_000) * 60_000);
  const trackRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(trackRef);
  const window = nextWindow(clock);
  const status = irrigation.failed ? null : irrigation.data;
  const beforeEngine = status?.engine === false;
  const items = nextItems({ plan: plan.data, agenda: agenda.data, settings, equipment }, window).filter((item) => !(beforeEngine && item.kind === "run"));
  const later = agenda.data && status ? laterText({ agenda: agenda.data, lines: status.lines }, window, clock, me) : null;
  const waiting = plan.pending || agenda.pending;
  return <Panel id="coming-up" title="Equipment & scheduled work" thing="what is running and next" state="ready">
    <div className="now-next-now">
      <h3 className="now-sub">Running now</h3>
      <RunningNow now={now} answer={answer} irrigation={irrigation} />
    </div>
    <div ref={trackRef} className="now-track" tabIndex={0} role="region" aria-label="Scrollable equipment history">
      <p className="now-sub now-track-caption">Observed equipment · last {PAST_H} h</p>
      <Track window={window} near={near} /><p className="meta">Filled bars show recorded on-time. Hatched areas have no reliable state. Equipment responds to conditions; this is history, not a forecast.</p>
    </div>
    <div className="now-next">
      <h3 className="now-sub">Scheduled work · next {NEXT_H} h</h3>
      {plan.failed && <Failed what="the plan" onRetry={plan.retry} />}
      {agenda.failed && <Failed what="the schedules" onRetry={agenda.retry} />}
      {waiting && !items.length
        ? <><div className="skeleton now-skeleton-list" aria-hidden="true" /><p className="screen-reader">Loading what comes next</p></>
        : items.length
          ? <ol className="now-next-list">{items.map((item) => <NextRow key={item.key} item={item} clock={clock} />)}</ol>
          : !plan.failed && !agenda.failed && <p className="meta">{NOTHING_NEXT}</p>}
      {beforeEngine && <p className="meta" data-coming="engine">{RUNS_BEFORE_ENGINE}</p>}
    </div>
    {later && <p className="meta now-later" data-coming="later"><span className="now-later-label">Later</span> {later}</p>}
  </Panel>;
}
