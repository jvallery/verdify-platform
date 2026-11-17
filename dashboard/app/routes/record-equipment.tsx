// SPDX-License-Identifier: MIT
import { ArrivingPage } from "../components/layout/page";
import { viewMeta } from "../lib/sections";

/** Record → Equipment (screens section 6.3): starts and run time per relay, day by day. Its frame stands until its area lane replaces the body. */
export const meta = () => viewMeta("record-equipment");

export default function RecordEquipment() {
  return <ArrivingPage view="record-equipment" />;
}
