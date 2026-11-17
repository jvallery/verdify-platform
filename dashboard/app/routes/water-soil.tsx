// SPDX-License-Identifier: MIT
import { ArrivingPage } from "../components/layout/page";
import { viewMeta } from "../lib/sections";

/**
 * Water → Soil (screens section 3.4): whether each zone's soil is where the owner wants it. It renders under Water's
 * layout, which draws the page header and the tabs, so it draws only its body. Its frame stands until its area lane
 * replaces the body.
 */
export const meta = () => viewMeta("water-soil");

export default function WaterSoil() {
  return <ArrivingPage view="water-soil" header={false} />;
}
