// SPDX-License-Identifier: MIT
import { DaysTable } from "../components/record/days-table";
import { DryingTable } from "../components/record/drying-table";
import { MeansRow } from "../components/record/means-row";
import { RecordNotes } from "../components/record/notes";
import { Periods } from "../components/record/periods";
import { answerText, daysAnswer } from "../components/record/record-model";
import { RecordPage } from "../components/record/record-page";
import { useRecordWindow } from "../components/record/use-record";
import { viewMeta } from "../lib/sections";

/**
 * Record → Days (screens 6.1, parity R-01, R-05, R-06, R-07, K-15): how each day went, against the last week and month.
 * The answer in words; the means row; before and after the law (`Periods`, full width, between the means and the
 * days); the days table, newest first; drying by day; the notes, collapsed. One API-32 read over the window, polled
 * every 60 s; nothing renders from data on the server. It draws no uPlot chart (the sparklines are SVG), so it links no
 * chart stylesheet.
 */
export const meta = () => viewMeta("record-days");

export default function RecordDays() {
  const window = useRecordWindow();
  const record = window.read.data;
  return <RecordPage view="record-days" window={window} answer={answerText(record, daysAnswer(record?.means.d7 ?? null, record?.means.d30 ?? null))}>
    <MeansRow read={window.read} days={window.days} />
    <Periods read={window.read} />
    <DaysTable read={window.read} days={window.days} />
    <DryingTable read={window.read} days={window.days} />
    <RecordNotes />
  </RecordPage>;
}
