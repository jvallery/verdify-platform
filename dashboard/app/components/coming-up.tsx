// SPDX-License-Identifier: MIT
/**
 * Coming up (dashboard v2 screens §1, inside Today): the next 12 h in time order, the scheduled water runs, the lights'
 * windows and timers and the sun (`components/now/next.ts`), then "Later" for each line with no run in those 12 h. It
 * lists what is scheduled or known ahead, never what the controller will decide. Reads API-IRR-02 (the week), API-09 and
 * API-13 for the lights; a failed read says so with Retry and draws nothing of its own, never a guess.
 */
import type { IrrigationStatus } from "../lib/operator-api";
import { READ_INTERVAL_MS, panelRead, useApiRead, useEquipmentRead, useSettingsRead, type PanelRead } from "../lib/queries";
import { useMe } from "../lib/shell";
import { Button } from "./button";
import { cls } from "./common";
import { useClockValue } from "./freshness";
import { NEXT_H, itemTime, laterText, nextItems, nextWindow, type NextItem } from "./now/next";

export const AGENDA_PARAMS = { days: 7 } as const;
export const NOTHING_NEXT = "Nothing scheduled in the next 12 h";
export const RUNS_BEFORE_ENGINE = "Schedules run with the irrigation firmware";

function Failed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return <p className="fault now-next-failed">Couldn't load {what}. <Button onClick={onRetry}>Retry</Button></p>;
}

function NextRow({ item, clock }: { item: NextItem; clock: number }) {
  return <li className={cls("now-next-item", item.skipped && "now-next-skipped")} data-coming={item.kind}>
    <time className="now-next-time" dateTime={new Date(item.at * 1000).toISOString()}>{itemTime(item.at, clock)}</time>
    <span className="now-next-what">{item.text}{item.note && <span className="meta"> · {item.note}</span>}</span>
  </li>;
}

export type ComingUpProps = { readonly irrigation: PanelRead<IrrigationStatus> };

export function ComingUp({ irrigation }: ComingUpProps) {
  const agenda = panelRead(useApiRead("API-IRR-02", AGENDA_PARAMS, { intervalMs: READ_INTERVAL_MS.schedules }));
  const settingsRead = useSettingsRead();
  const equipmentRead = useEquipmentRead();
  const settings = settingsRead.error ? null : settingsRead.data?.items ?? null;
  const equipment = equipmentRead.error ? null : equipmentRead.data?.items ?? null;
  const me = useMe();
  // The clock's minute: the hours ahead are worth one render a minute.
  const clock = useClockValue((value) => Math.floor(value / 60_000) * 60_000);
  const window = nextWindow(clock);
  const status = irrigation.failed ? null : irrigation.data;
  const beforeEngine = status?.engine === false;
  const items = nextItems({ agenda: agenda.data, settings, equipment }, window).filter((item) => !(beforeEngine && item.kind === "run"));
  const later = agenda.data && status ? laterText({ agenda: agenda.data, lines: status.lines }, window, clock, me) : null;
  return <section className="now-next" id="coming-up" aria-labelledby="coming-up-title">
    <h3 className="now-sub" id="coming-up-title">Coming up · next {NEXT_H} h</h3>
    {agenda.failed && <Failed what="the schedules" onRetry={agenda.retry} />}
    {agenda.pending && !items.length
      ? <><div className="skeleton now-skeleton-list" aria-hidden="true" /><p className="screen-reader">Loading what comes next</p></>
      : items.length
        ? <ol className="now-next-list">{items.map((item) => <NextRow key={item.key} item={item} clock={clock} />)}</ol>
        : !agenda.failed && <p className="meta" data-coming="none">{NOTHING_NEXT}</p>}
    {beforeEngine && <p className="meta" data-coming="engine">{RUNS_BEFORE_ENGINE}</p>}
    {later && <p className="meta now-later" data-coming="later"><span className="now-later-label">Later</span> {later}</p>}
  </section>;
}
