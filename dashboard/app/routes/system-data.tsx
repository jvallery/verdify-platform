// SPDX-License-Identifier: MIT
import { ArrivingPage } from "../components/layout/page";
import { viewMeta } from "../lib/sections";

/** System → Data (screens section 10.3): whether the record is complete and the controller took what was sent. Its frame stands until its area lane replaces the body. */
export const meta = () => viewMeta("system-data");

export default function SystemData() {
  return <ArrivingPage view="system-data" />;
}
