// SPDX-License-Identifier: MIT
import { ArrivingPage } from "../components/layout/page";
import { viewMeta } from "../lib/sections";

/** Record → Days (screens section 6.1): how each day went, against the last week and month. Its frame stands until its area lane replaces the body. */
export const meta = () => viewMeta("record-days");

export default function RecordDays() {
  return <ArrivingPage view="record-days" />;
}
