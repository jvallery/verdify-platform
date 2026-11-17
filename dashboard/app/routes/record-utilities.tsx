// SPDX-License-Identifier: MIT
import { ArrivingPage } from "../components/layout/page";
import { viewMeta } from "../lib/sections";

/** Record → Utilities (screens section 6.4): electricity, gas and water per day, and their cost. Its frame stands until its area lane replaces the body. */
export const meta = () => viewMeta("record-utilities");

export default function RecordUtilities() {
  return <ArrivingPage view="record-utilities" />;
}
