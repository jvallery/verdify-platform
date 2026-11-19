// SPDX-License-Identifier: MIT
import { dayHeader, formatNumber } from "../../lib/format";
import type { DailyRecord, RecordDay, RecordDrying } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { EmptyState, Panel } from "../panel";
import { Table, type TableColumn } from "../table";
import { DAY_ROWS, DayCell, unitHead } from "./days-table";
import { dryingDay, dryingRestText, minutesCell, pricePaid, recordState, refusedText, windowDays, type WindowDays } from "./record-model";

/** A lower-bound amount as a bare number: "≥ 1.70" on a day a restart lost meter counts; "—" when unknown. */
export function boundCell(value: number | null, decimals: number, lower: boolean | null): string {
  return value === null ? "—" : `${lower ? "≥ " : ""}${formatNumber(value, decimals)}`;
}

/** All the seconds drying was refused that day, by any reason; null when the record has none. */
export function refusedSeconds(refused: RecordDrying["refused_s"]): number | null {
  if (!refused) return null;
  return Object.values(refused).reduce((sum, seconds) => sum + (Number.isFinite(seconds) && seconds > 0 ? seconds : 0), 0);
}

/** The drying table's columns (parity K-15): units in the headers, bare numbers in the cells. */
export function dryingColumns(record: DailyRecord): readonly TableColumn<RecordDay>[] {
  return [
    { key: "date", header: "Day", rowHeader: true, cell: (day) => <DayCell day={day} record={record} /> },
    { key: "time", header: unitHead("Drying", "min"), numeric: true, cell: (day) => minutesCell(day.drying?.seconds) },
    { key: "runs", header: "Runs", numeric: true, cell: (day) => formatNumber(day.drying?.runs, 0) },
    { key: "water", header: unitHead("Water removed", "kg"), numeric: true, cell: (day) => boundCell(day.drying?.water_g == null ? null : day.drying.water_g / 1000, 2, day.drying?.lower_bound ?? null) },
    { key: "heat", header: unitHead("Heat spent", "kWh"), numeric: true, cell: (day) => boundCell(day.drying?.heat_wh == null ? null : day.drying.heat_wh / 1000, 1, day.drying?.lower_bound ?? null) },
    { key: "price", header: unitHead("Price", "kWh/kg"), numeric: true, cell: (day) => formatNumber(pricePaid(day.drying), 2) },
    { key: "wanted", header: unitHead("Wanted", "min"), numeric: true, cell: (day) => minutesCell(day.drying?.wanted_s) },
    { key: "refused", header: unitHead("Refused", "min"), numeric: true, cell: (day) => minutesCell(refusedSeconds(day.drying?.refused_s ?? null)) },
    { key: "furnace", header: <>Furnace<br />starts</>, numeric: true, cell: (day) => formatNumber(day.drying?.furnace_starts_after, 0) },
  ];
}

/** "Mon 16 Nov: the house is too cold to vent 88 min; …": why drying was refused, one line per day that has reasons. */
export function refusalLines(days: readonly RecordDay[]): { date: string; text: string }[] {
  return days.flatMap((day) => {
    const text = refusedText(day.drying?.refused_s ?? null);
    return text ? [{ date: day.date, text: `${dayHeader(day.date)}: ${text}.` }] : [];
  });
}

/**
 * Days (parity K-15, B1): drying per day, newest first, only the days on which drying ran or was wanted: how long it
 * ran and how often, the water it removed, the heat it spent, the price paid for it (heat over water, `pricePaid`), how
 * long it was wanted and refused, and how often the gas furnace started within 15 minutes after a run. Under the table,
 * why drying was refused on each day that says, and one sentence for the days the table leaves out.
 */
export function DryingTable({ read, days }: { read: PanelRead<DailyRecord>; days: WindowDays }) {
  const record = read.data;
  const all = record ? [...windowDays(record, days)].reverse() : [];
  const shown = all.filter(dryingDay);
  const rest = shown.length ? dryingRestText(all.filter((day) => !dryingDay(day) && day.drying !== null)) : null;
  const reasons = refusalLines(shown);
  const lower = shown.some((day) => day.drying?.lower_bound === true);
  const state = recordState(read, record !== null && !all.some((day) => day.drying !== null));
  return <Panel title="Drying by day" thing="drying by day" state={state} reserve="md" observedAt={record?.server_time} onRetry={read.retry}
    empty={<EmptyState message="No drying is recorded in this window." />} link={{ to: "/climate/drying", label: "Drying" }}
    foot={rest || lower ? <>{rest}{rest && lower ? " " : ""}{lower ? "≥ marks a lower bound: a restart lost meter counts that day." : ""}</> : undefined}>
    {record && (shown.length
      ? <Table label="Drying by day, scrollable" caption={`Drying per day, last ${days} days, newest first`} captionHidden
        columns={dryingColumns(record)} rows={shown} rowKey={(day) => day.date} phone="scroll" maxRows={DAY_ROWS} rowNoun="days" />
      : <p className="muted">Drying did not run and was not wanted on any day shown.</p>)}
    {reasons.length > 0 && <div className="rc-refusals">
      <h3 className="rc-subhead">Why drying was refused</h3>
      <ul className="rc-refusal-list">{reasons.map((line) => <li key={line.date}>{line.text}</li>)}</ul>
    </div>}
  </Panel>;
}
