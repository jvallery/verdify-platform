// SPDX-License-Identifier: MIT
import { DaysTable } from "../components/record/days-table";
import { DryingTable } from "../components/record/drying-table";
import { MeansRow } from "../components/record/means-row";
import { RecordNotes } from "../components/record/notes";
import { RecordPage } from "../components/record/record-page";
import { useRecordWindow } from "../components/record/use-record";
import { viewMeta } from "../lib/sections";

/**
 * Record → Days (screens 6.1, parity R-01, R-05, R-07, K-15): how each day went, against the last week and month. The
 * means row; the place of the "Before and after the law" block (row 3, `components/record/periods.tsx`, which the second
 * wave adds as a full-width block between the means and the days); the days table, newest first; drying by day; the
 * notes. One API-32 read over the window, polled every 60 s; nothing renders from data on the server. It draws no uPlot
 * chart (the sparklines are SVG), so it links no chart stylesheet.
 */
export const meta = () => viewMeta("record-days");

export default function RecordDays() {
  const window = useRecordWindow();
  return <RecordPage view="record-days" window={window}>
    <MeansRow read={window.read} days={window.days} />
    {/* Row 3, "Before and after the law": the second wave's <Periods /> (components/record/periods.tsx), full width, here. */}
    <DaysTable read={window.read} days={window.days} />
    <DryingTable read={window.read} days={window.days} />
    <RecordNotes />
  </RecordPage>;
}
