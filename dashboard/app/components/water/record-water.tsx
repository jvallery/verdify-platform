// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import { DailyBars } from "../../charts/daily-bars";
import { dayHeader, formatValue } from "../../lib/format";
import { panelRead, useRecordDaysRead } from "../../lib/queries";
import { lastRecordedDay, recordWaterDays, type RecordWaterDay } from "../../lib/water";
import { Details } from "../details";
import { EmptyState, Panel } from "../panel";
import { Table, type TableColumn } from "../table";

const gal = (value: number | null) => formatValue(value, "gal");
const COLUMNS: readonly TableColumn<RecordWaterDay>[] = [
  { key: "date", header: "Day", rowHeader: true, cell: (day) => <>{dayHeader(day.date)}{day.note && <span className="meta"> · {day.note}</span>}</> },
  { key: "wetting", header: "Wetting", numeric: true, cell: (day) => gal(day.wetting) },
  { key: "crop", header: "Crop", numeric: true, cell: (day) => gal(day.crop) },
  { key: "house", header: "House", numeric: true, cell: (day) => gal(day.house) },
  { key: "total", header: "Total metered", numeric: true, cell: (day) => gal(day.total) },
];

/**
 * The day's water from the daily record (screens section 3.3, parity W-31), beside History's per-line totals: the newest
 * complete day's wetting, crop and house water, crop water per day against its 7- and 30-day means, and every day of the
 * period in a table. The record is named as the source of the day's number; it counts the metered water once per day, so
 * it can differ from the per-line totals, which come from the valves. A day with no record is a gap, never zero.
 */
export function RecordWater({ from, to }: { from: string; to: string }) {
  const read = panelRead(useRecordDaysRead({ from, to }));
  const days = useMemo(() => (read.data ? recordWaterDays(read.data.days) : []), [read.data]);
  const last = lastRecordedDay(days);
  const known = days.some((day) => day.crop !== null || day.total !== null);
  const state = read.data === null ? (read.failed ? "error" : "loading") : known ? "ready" : "empty";
  const means = read.data?.means;
  return <Panel title="The day's water, from the daily record" thing="the daily record's water" state={state} reserve="lg" onRetry={read.retry}
    link={{ to: "/record/utilities", label: "Utilities" }}
    empty={<EmptyState message="The daily record has no water for these days." />}
    foot="Source: the daily record, one row a day. Crop water is wetting plus wall irrigation and fertigation; house water is the rest of what the meter counted. The per-line totals above come from the valves, so the two can differ.">
    {last && <dl className="wat-record-day" aria-label={`Water on ${dayHeader(last.date)}`}>
      <div><dt>{dayHeader(last.date)}, crop</dt><dd>{gal(last.crop)}</dd></div>
      <div><dt>Of which wetting</dt><dd>{gal(last.wetting)}</dd></div>
      <div><dt>House</dt><dd>{gal(last.house)}</dd></div>
      <div><dt>Total metered</dt><dd>{gal(last.total)}{last.note && <span className="meta"> · {last.note}</span>}</dd></div>
    </dl>}
    <DailyBars title="Crop water per day" unit="gal" token="--eq-water" format={(value) => gal(value)} size="sm"
      days={days.map((day) => ({ date: day.date, value: day.crop, partial: day.note !== null, note: day.note ?? undefined }))}
      mean7={means?.d7?.crop_gal ?? null} mean30={means?.d30?.crop_gal ?? null} />
    <Details summary="Every day of the period">
      <Table label="The daily record's water" caption="Water per day from the daily record · America/Denver days" captionHidden columns={COLUMNS} rows={[...days].reverse()} rowKey={(day) => day.date} phone="scroll" />
    </Details>
  </Panel>;
}
