// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { Link } from "react-router";
import { dayHeader, formatNumber } from "../../lib/format";
import { dayHref } from "../../lib/graph-url";
import type { DailyRecord, RecordDay } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { StatusBadge } from "../badge";
import { EmptyState, Panel } from "../panel";
import { Table, type TableColumn } from "../table";
import { alertsText, hasRecord, hoursCell, isSoFar, kwhCell, minutesCell, recordState, windowDays, type WindowDays } from "./record-model";

/** The rows a table of days shows before "Show all N days" (A1). */
export const DAY_ROWS = 14;

const share = (value: number | null | undefined) => formatNumber(value, 1);

/**
 * A column head with its unit (A1): the name, a comma, and the unit on a line of its own in its own case, so a head is
 * at most two words a line and "kWh" never reads "KWH".
 */
export function unitHead(name: string, unit: string): ReactNode {
  return <>{name},<br /><span className="unit">{unit}</span></>;
}

/** The date cell: a link that opens Graphs on that day, and today marked "so far". */
export function DayCell({ day, record }: { day: RecordDay; record: DailyRecord }) {
  return <span className="rc-date">
    <Link to={dayHref(day.date)}>{dayHeader(day.date)}</Link>
    {isSoFar(day, record) && <StatusBadge status="neutral" size="sm">so far</StatusBadge>}
  </span>;
}

/** Night dried: a check mark for a dried night, an en dash for one that did not dry, an em dash when unknown. */
export function NightCell({ dried }: { dried: boolean | null | undefined }) {
  if (dried === true) {
    return <span className="rc-night" data-dried="yes">
      <svg className="rc-check" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M3 8.5l3.2 3.2L13 4.8" /></svg>
      <span className="screen-reader">Dried</span>
    </span>;
  }
  if (dried === false) return <span className="rc-night" data-dried="no"><span aria-hidden="true">–</span><span className="screen-reader">Not dried</span></span>;
  return <>—</>;
}

/**
 * The days table's columns (screens 6.1 row 2, B1): units in the headers and bare numbers in the cells, the three
 * in-band shares and the two heaters' run time under one group head each.
 */
export function dayColumns(record: DailyRecord): readonly TableColumn<RecordDay>[] {
  return [
    { key: "date", header: "Day", rowHeader: true, cell: (day) => <DayCell day={day} record={record} /> },
    { key: "both", header: "Both", headerGroup: "In band, %", numeric: true, cell: (day) => share(day.band?.both_pct) },
    { key: "temp", header: "Temp", headerGroup: "In band, %", numeric: true, cell: (day) => share(day.band?.temp_pct) },
    { key: "vpd", header: "VPD", headerGroup: "In band, %", numeric: true, cell: (day) => share(day.band?.vpd_pct) },
    { key: "dried", header: "Night", className: "rc-center", cell: (day) => <NightCell dried={day.band?.night_dried} /> },
    { key: "starts", header: "Starts", numeric: true, cell: (day) => formatNumber(day.climate_starts, 0) },
    { key: "heat1", header: "Heat 1", headerGroup: "Run time, h", numeric: true, cell: (day) => hoursCell(day.relays?.heat1?.run_s) },
    { key: "heat2", header: "Heat 2", headerGroup: "Run time, h", numeric: true, cell: (day) => hoursCell(day.relays?.heat2?.run_s) },
    { key: "kwh", header: unitHead("Electricity", "kWh"), numeric: true, cell: (day) => kwhCell(day) },
    { key: "therms", header: unitHead("Gas", "therms (est.)"), numeric: true, cell: (day) => formatNumber(day.gas.therms_est, 2) },
    { key: "crop", header: unitHead("Water", "gal"), numeric: true, cell: (day) => formatNumber(day.water.crop_gal, 0) },
    { key: "drying", header: unitHead("Drying", "min"), numeric: true, cell: (day) => minutesCell(day.drying?.seconds) },
    { key: "alerts", header: "Alerts", numeric: true, cell: (day) => alertsText(day.alerts) },
  ];
}

/**
 * Days, row 2 (screens 6.1): the days of the window, newest first, today first and marked "so far", 14 of them before
 * "Show all N days". A day under 70 % meter coverage reads "partial" for its electricity, an unknown value "—". Each
 * day's date opens Graphs on that day. On a phone the table scrolls sideways inside its card with the day fixed at the
 * left, so days stay comparable column by column.
 */
export function DaysTable({ read, days }: { read: PanelRead<DailyRecord>; days: WindowDays }) {
  const record = read.data;
  const shown = record ? [...windowDays(record, days)].reverse() : [];
  const state = recordState(read, record !== null && !shown.some(hasRecord));
  return <Panel title="Day by day" thing="the daily record" state={state} reserve="lg" observedAt={record?.server_time} onRetry={read.retry}
    empty={<EmptyState message="No day in this window has a record yet." />}
    foot="Each day opens Graphs on that day. Water is crop water: misting, fog and irrigation.">
    {record && <Table label="Daily record, scrollable" caption={`The daily record, last ${days} days, newest first`} captionHidden
      columns={dayColumns(record)} rows={shown} rowKey={(day) => day.date} phone="scroll" maxRows={DAY_ROWS} rowNoun="days" />}
  </Panel>;
}
