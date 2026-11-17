// SPDX-License-Identifier: MIT
import { ArrivingPage } from "../components/layout/page";
import { viewMeta } from "../lib/sections";

/** Climate → Law (screens section 2.1): what the controller is doing to hold the band, and why. Its frame stands until its area lane replaces the body. */
export const meta = () => viewMeta("climate-law");

export default function ClimateLaw() {
  return <ArrivingPage view="climate-law" />;
}
