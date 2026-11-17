// SPDX-License-Identifier: MIT
import { Link } from "react-router";
import { dayHeader, formatValue } from "../../lib/format";
import { dayHref } from "../../lib/graph-url";
import type { DailyRecord, RecordDay } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { StatusBadge } from "../badge";
import { EmptyState, Panel } from "../panel";
import { Table, type TableColumn } from "../table";
import { alertsText, hasRecord, isSoFar, kwhText, recordState, runTime, windowDays, type WindowDays } from "./record-model";

const share = (value: number | null | undefined) => formatValue(value, "%");
const yesNo = (value: boolean | null | undefined) => (value === true ? "Yes" : value === false ? "No" : "—");

/** The date cell: a link that opens Graphs on that day, and today marked "so far". */
export function DayCell({ day, record }: { day: RecordDay; record: DailyRecord }) {
  return <span className="rc-date">
    <Link to={dayHref(day.date)}>{dayHeader(day.date)}</Link>
    {isSoFar(day, record) && <StatusBadge status="neutral" size="sm">so far</StatusBadge>}
  </span>;
}

/** The days table's columns (screens 6.1 row 2), in order. */
export function dayColumns(record: DailyRecord): readonly TableColumn<RecordDay>[] {
  return [
    { key: "date", header: "Day", rowHeader: true, cell: (day) => <DayCell day={day} record={record} /> },
    { key: "both", header: "In band, both", numeric: true, cell: (day) => share(day.band?.both_pct) },
    { key: "temp", header: "In band, temperature", numeric: true, cell: (day) => share(day.band?.temp_pct) },
    { key: "vpd", header: "In band, VPD", numeric: true, cell: (day) => share(day.band?.vpd_pct) },
    { key: "dried", header: "Night dried", cell: (day) => yesNo(day.band?.night_dried) },
    { key: "starts", header: "Climate starts", numeric: true, cell: (day) => formatValue(day.climate_starts, "count") },
    { key: "heat1", header: "Heat 1 run time", numeric: true, cell: (day) => runTime(day.relays?.heat1?.run_s) },
    { key: "heat2", header: "Heat 2 run time", numeric: true, cell: (day) => runTime(day.relays?.heat2?.run_s) },
    { key: "kwh", header: "Electricity", numeric: true, cell: (day) => kwhText(day) },
    { key: "therms", header: "Gas, estimated", numeric: true, cell: (day) => formatValue(day.gas.therms_est, "therms") },
    { key: "crop", header: "Crop water", numeric: true, cell: (day) => formatValue(day.water.crop_gal, "gal") },
    { key: "drying", header: "Drying", numeric: true, cell: (day) => runTime(day.drying?.seconds) },
    { key: "alerts", header: "Alerts", cell: (day) => alertsText(day.alerts) },
  ];
}

/**
 * Days, row 2 (screens 6.1): the days of the window, newest first, today first and marked "so far". A day under 70 %
 * meter coverage reads "partial" for its electricity, an unknown value "—". Each day's date opens Graphs on that day.
 * On a phone the table scrolls sideways inside its card with the day fixed at the left, so days stay comparable
 * column by column.
 */
export function DaysTable({ read, days }: { read: PanelRead<DailyRecord>; days: WindowDays }) {
  const record = read.data;
  const shown = record ? [...windowDays(record, days)].reverse() : [];
  const state = recordState(read, record !== null && !shown.some(hasRecord));
  return <Panel title="Day by day" thing="the daily record" state={state} reserve="lg" observedAt={record?.server_time} onRetry={read.retry}
    empty={<EmptyState message="No day in this window has a record yet." />}
    foot="Each day opens Graphs on that day.">
    {record && <Table label="Daily record, scrollable" caption={`The daily record, last ${days} days, newest first`} captionHidden
      columns={dayColumns(record)} rows={shown} rowKey={(day) => day.date} phone="scroll" />}
  </Panel>;
}
