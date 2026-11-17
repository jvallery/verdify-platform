// SPDX-License-Identifier: MIT
import { useNavigate } from "react-router";
import { DailyBars } from "../../charts/daily-bars";
import { formatValue } from "../../lib/format";
import { dayHref } from "../../lib/graph-url";
import type { DailyRecord, RecordDay, RecordMeans, RelayCheck } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { words } from "../../lib/words";
import { StatusBadge } from "../badge";
import { EmptyState, Panel, PanelErrorBoundary } from "../panel";
import { Table, type TableColumn } from "../table";
import { barDays } from "./band-view";
import { DayCell } from "./days-table";
import {
  CLIMATE_RELAYS, RELAY_TOKENS, WET_RELAYS, checkResult, recordState, relayMean, relayName, repairedRuns, runTime, windowDays, type CheckDay, type WindowDays,
} from "./record-model";

export const EQUIPMENT_SYNC = "verdify:record-equipment";
const count = (value: number) => formatValue(value, "count");
const hours = (value: number) => runTime(value * 3600);

/** One relay's means: starts and run hours a day over the last 7 and 30 complete days. Heat 1 and 2's hours are served. */
export type RelayMeans = { readonly equipment: string; readonly starts7: number | null; readonly starts30: number | null; readonly run7: number | null; readonly run30: number | null; readonly repaired: number | null };
export function relayMeansRows(record: DailyRecord, shown: readonly RecordDay[], relays: readonly string[]): RelayMeans[] {
  const served = (means: RecordMeans | null, equipment: string) => (equipment === "heat1" ? means?.heat1_run_h ?? null : equipment === "heat2" ? means?.heat2_run_h ?? null : undefined);
  return relays.map((equipment) => {
    const run7 = served(record.means.d7, equipment), run30 = served(record.means.d30, equipment);
    return {
      equipment,
      starts7: relayMean(record.days, equipment, "starts", 7), starts30: relayMean(record.days, equipment, "starts", 30),
      run7: run7 === undefined ? relayMean(record.days, equipment, "run_h", 7) : run7,
      run30: run30 === undefined ? relayMean(record.days, equipment, "run_h", 30) : run30,
      repaired: repairedRuns(shown, equipment),
    };
  });
}

/** One relay as small multiples: starts per day and run hours per day, each with its 7-day and 30-day mean lines. */
function RelayCard({ record, shown, row, onPick }: { record: DailyRecord; shown: readonly RecordDay[]; row: RelayMeans; onPick: (date: string) => void }) {
  const token = RELAY_TOKENS[row.equipment] ?? "--c-temp";
  const relay = (day: RecordDay) => day.relays?.[row.equipment];
  const repaired = (day: RecordDay) => { const runs = relay(day)?.repaired_runs ?? 0; return runs > 0 ? `${runs} repaired ${runs === 1 ? "run" : "runs"}` : null; };
  return <section className="rc-relay" aria-label={relayName(row.equipment)} data-relay={row.equipment}>
    <h3 className="rc-relay-name"><span className="rc-swatch" data-token={token.slice(2)} aria-hidden="true" />{relayName(row.equipment)}</h3>
    <DailyBars title="Starts per day" unit="starts" token={token} size="sm" format={count} syncKey={EQUIPMENT_SYNC} onPick={onPick}
      days={barDays(shown, record, (day) => relay(day)?.starts, repaired)} mean7={row.starts7} mean30={row.starts30} />
    <DailyBars title="Run hours per day" unit="h" token={token} size="sm" format={hours} syncKey={EQUIPMENT_SYNC} onPick={onPick}
      days={barDays(shown, record, (day) => { const run = relay(day); return run ? run.run_s / 3600 : null; })} mean7={row.run7} mean30={row.run30} />
  </section>;
}

const MEANS_COLUMNS: readonly TableColumn<RelayMeans>[] = [
  { key: "relay", header: "Relay", rowHeader: true, cell: (row) => relayName(row.equipment) },
  { key: "starts7", header: "Starts a day, 7-day mean", numeric: true, cell: (row) => formatValue(row.starts7, "count") },
  { key: "starts30", header: "Starts a day, 30-day mean", numeric: true, cell: (row) => formatValue(row.starts30, "count") },
  { key: "run7", header: "Run time a day, 7-day mean", numeric: true, cell: (row) => runTime(row.run7 === null ? null : row.run7 * 3600) },
  { key: "run30", header: "Run time a day, 30-day mean", numeric: true, cell: (row) => runTime(row.run30 === null ? null : row.run30 * 3600) },
  { key: "repaired", header: "Repaired runs in the days shown", numeric: true, cell: (row) => formatValue(row.repaired, "count") },
];

/** The counter check's columns: the day, how far it could be compared, the controller's restarts and the result. */
export function checkColumns(record: DailyRecord | null): readonly TableColumn<CheckDay>[] {
  return [
    { key: "date", header: "Day", rowHeader: true, cell: (day) => {
      const recorded = record?.days.find((row) => row.date === day.date);
      return recorded && record ? <DayCell day={recorded} record={record} /> : day.date;
    } },
    { key: "compared", header: "Compared", cell: (day) => words("relay_comparison", day.comparison) },
    { key: "boots", header: "Controller restarts", numeric: true, cell: (day) => formatValue(day.boots, "count") },
    { key: "result", header: "Result", cell: (day) => {
      const result = checkResult(day);
      if (result.status === "none") return "No stored record to compare";
      if (result.status === "agree") return <StatusBadge status="ok" size="sm">Counters agree</StatusBadge>;
      return <><StatusBadge status="warn" size="sm">Counters differ</StatusBadge><ul className="rc-diffs">{result.lines.map((line) => <li key={line}>{line}</li>)}</ul></>;
    } },
  ];
}

/**
 * Record → Equipment (screens 6.3, parity R-02 and R-03): each climate relay's starts and run hours per day as small
 * multiples with their 7- and 30-day means, the misters and drip lines in a second group, the means table, and the
 * counter check: per day, whether the controller's own relay counters agree with the stored record, and where not, by
 * how much.
 */
export function EquipmentView({ read, check, days }: { read: PanelRead<DailyRecord>; check: PanelRead<RelayCheck>; days: WindowDays }) {
  const navigate = useNavigate();
  const record = read.data;
  const shown = record ? windowDays(record, days) : [];
  const state = recordState(read, record !== null && !shown.some((day) => day.relays !== null));
  const pick = (date: string) => { void navigate(dayHref(date)); };
  const common = { state, observedAt: record?.server_time, onRetry: read.retry, empty: <EmptyState message="No day in this window has a relay record." /> } as const;
  const group = (relays: readonly string[]) => (record ? relayMeansRows(record, shown, relays) : []);
  const climate = group(CLIMATE_RELAYS), wet = group(WET_RELAYS);
  const checkState = recordState(check, check.data !== null && check.data.days.length === 0);
  return <div className="l-stack">
    <Panel title="Climate relays" thing="the climate relays" reserve="lg" {...common} foot="Solid line: the 7-day mean. Dashed line: the 30-day mean. A bar opens Graphs on its day.">
      {record && <PanelErrorBoundary thing="the climate relay charts" onRetry={read.retry}><div className="rc-multiples">
        {climate.map((row) => <RelayCard key={row.equipment} record={record} shown={shown} row={row} onPick={pick} />)}
      </div></PanelErrorBoundary>}
    </Panel>
    <Panel title="Misters and drip lines" thing="the misters and drip lines" reserve="lg" {...common}>
      {record && <PanelErrorBoundary thing="the mister and drip charts" onRetry={read.retry}><div className="rc-multiples">
        {wet.map((row) => <RelayCard key={row.equipment} record={record} shown={shown} row={row} onPick={pick} />)}
      </div></PanelErrorBoundary>}
    </Panel>
    <Panel title="Means per relay" thing="the means per relay" {...common} foot="Means cover complete days only. Heat 1 and heat 2 run time are the daily record's own means.">
      {record && <Table label="Means per relay, scrollable" caption="Starts and run time a day per relay, 7- and 30-day means" captionHidden
        columns={MEANS_COLUMNS} rows={[...climate, ...wet]} rowKey={(row) => row.equipment}
        group={(row) => ((CLIMATE_RELAYS as readonly string[]).includes(row.equipment) ? "climate" : "wet")} groupOrder={["climate", "wet"]}
        groupLabel={(name) => (name === "climate" ? "Climate relays" : "Misters and drip lines")} />}
    </Panel>
    <Panel title="Counter check" thing="the counter check" state={checkState} onRetry={check.retry}
      empty={<EmptyState message="The controller's relay counters have no day to compare yet." />}
      foot={days > 30 ? "The counter check covers the last 30 days at most." : "The controller's own relay counters against the stored daily record."}>
      {check.data && <Table label="Counter check, scrollable" caption="The controller's relay counters against the stored record, newest day first" captionHidden
        columns={checkColumns(record)} rows={check.data.days} rowKey={(day) => day.date} phone="list" />}
    </Panel>
  </div>;
}
