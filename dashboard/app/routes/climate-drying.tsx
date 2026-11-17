// SPDX-License-Identifier: MIT
import { ArrivingPage } from "../components/layout/page";
import { viewMeta } from "../lib/sections";

/** Climate → Drying (screens section 2.3): whether drying the air is worth what it costs. Its frame stands until its area lane replaces the body. */
export const meta = () => viewMeta("climate-drying");

export default function ClimateDrying() {
  return <ArrivingPage view="climate-drying" />;
}
