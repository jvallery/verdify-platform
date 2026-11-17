// SPDX-License-Identifier: MIT
import { ArrivingPage } from "../components/layout/page";
import { viewMeta } from "../lib/sections";

/** Record → Time in band (screens section 6.2): time inside the band, day by day. Its frame stands until its area lane replaces the body. */
export const meta = () => viewMeta("record-compliance");

export default function RecordCompliance() {
  return <ArrivingPage view="record-compliance" />;
}
