// SPDX-License-Identifier: MIT
import { formatValue } from "../../lib/format";
import type { DailyRecord, RecordDay } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { EmptyState, Panel } from "../panel";
import { Table, type TableColumn } from "../table";
import { DayCell } from "./days-table";
import { pricePaid, recordState, refusedText, runTime, windowDays, type WindowDays } from "./record-model";

/** A lower-bound amount: "at least 1.70 kg" on a day a restart lost meter counts. */
const bound = (value: number | null, unit: string, lower: boolean | null) => (value === null ? "—" : `${lower ? "at least " : ""}${formatValue(value, unit)}`);

/** The drying table's columns (parity K-15): run time, runs, water removed, heat spent, price paid, refused, furnace starts. */
export function dryingColumns(record: DailyRecord): readonly TableColumn<RecordDay>[] {
  return [
    { key: "date", header: "Day", rowHeader: true, cell: (day) => <DayCell day={day} record={record} /> },
    { key: "time", header: "Drying", numeric: true, cell: (day) => runTime(day.drying?.seconds) },
    { key: "runs", header: "Runs", numeric: true, cell: (day) => formatValue(day.drying?.runs, "count") },
    { key: "water", header: "Water removed", numeric: true, cell: (day) => bound(day.drying ? day.drying.water_g === null ? null : day.drying.water_g / 1000 : null, "kg", day.drying?.lower_bound ?? null) },
    { key: "heat", header: "Heat spent", numeric: true, cell: (day) => bound(day.drying ? day.drying.heat_wh === null ? null : day.drying.heat_wh / 1000 : null, "kWh", day.drying?.lower_bound ?? null) },
    { key: "price", header: "Price paid", numeric: true, cell: (day) => formatValue(pricePaid(day.drying), "kWh/kg") },
    { key: "wanted", header: "Wanted", numeric: true, cell: (day) => runTime(day.drying?.wanted_s) },
    { key: "refused", header: "Refused", cell: (day) => refusedText(day.drying?.refused_s ?? null) ?? (day.drying?.refused_s ? "None" : "—") },
    { key: "furnace", header: "Furnace starts after", numeric: true, cell: (day) => formatValue(day.drying?.furnace_starts_after, "count") },
  ];
}

/**
 * Days (parity K-15): drying per day, newest first: how long it ran and how often, the water it removed, the heat it
 * spent, the price paid for it (heat over water, `pricePaid`), how long it was wanted, why it was refused, and how often
 * the gas furnace started within 15 minutes after a run.
 */
export function DryingTable({ read, days }: { read: PanelRead<DailyRecord>; days: WindowDays }) {
  const record = read.data;
  const shown = record ? [...windowDays(record, days)].reverse() : [];
  const state = recordState(read, record !== null && !shown.some((day) => day.drying !== null));
  return <Panel title="Drying by day" thing="drying by day" state={state} reserve="md" observedAt={record?.server_time} onRetry={read.retry}
    empty={<EmptyState message="No drying is recorded in this window." />} link={{ to: "/climate/drying", label: "Drying" }}>
    {record && <Table label="Drying by day, scrollable" caption={`Drying per day, last ${days} days, newest first`} captionHidden
      columns={dryingColumns(record)} rows={shown} rowKey={(day) => day.date} phone="scroll" />}
  </Panel>;
}
