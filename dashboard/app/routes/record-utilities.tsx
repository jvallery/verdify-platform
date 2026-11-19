// SPDX-License-Identifier: MIT
import { chartLinks } from "../charts/uplot-chart";
import { answerText, utilitiesAnswer } from "../components/record/record-model";
import { RecordPage } from "../components/record/record-page";
import { useRecordWindow } from "../components/record/use-record";
import { UtilitiesView } from "../components/record/utilities-view";
import { viewMeta } from "../lib/sections";

/** Record → Utilities (screens 6.4, parity R-04, W-31): the electricity, gas and water used each day, from API-32. */
export const meta = () => viewMeta("record-utilities");
export const links = () => chartLinks();

export default function RecordUtilities() {
  const window = useRecordWindow();
  const record = window.read.data;
  return <RecordPage view="record-utilities" window={window} answer={answerText(record, utilitiesAnswer(record?.means.d7 ?? null, record?.means.d30 ?? null))}>
    <UtilitiesView read={window.read} days={window.days} />
  </RecordPage>;
}
