// SPDX-License-Identifier: MIT
import { chartLinks } from "../charts/uplot-chart";
import { BandView } from "../components/record/band-view";
import { RecordPage } from "../components/record/record-page";
import { useRecordWindow } from "../components/record/use-record";
import { viewMeta } from "../lib/sections";

/** Record → In band, titled Time in band (screens 6.2, parity R-01): time inside the band, day by day, from API-32's `band`. */
export const meta = () => viewMeta("record-compliance");
export const links = () => chartLinks();

export default function RecordCompliance() {
  const window = useRecordWindow();
  return <RecordPage view="record-compliance" window={window}>
    <BandView read={window.read} days={window.days} />
  </RecordPage>;
}
