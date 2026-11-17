// SPDX-License-Identifier: MIT
import { ArrivingPage } from "../components/layout/page";
import { viewMeta } from "../lib/sections";

/** Lights → Lights (screens section 4.1): whether the lights are doing what the owner wants. Its frame stands until its area lane replaces the body. */
export const meta = () => viewMeta("lights-overview");

export default function Lights() {
  return <ArrivingPage view="lights-overview" />;
}
