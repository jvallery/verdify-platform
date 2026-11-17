// SPDX-License-Identifier: MIT
import { ArrivingPage } from "../components/layout/page";
import { viewMeta } from "../lib/sections";

/** System → Controller (screens section 10.2): whether the controller is healthy. Its frame stands until its area lane replaces the body. */
export const meta = () => viewMeta("system-controller");

export default function SystemController() {
  return <ArrivingPage view="system-controller" />;
}
