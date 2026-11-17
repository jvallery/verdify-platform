// SPDX-License-Identifier: MIT
import { ArrivingPage } from "../components/layout/page";
import { viewMeta } from "../lib/sections";

/** Review (screens section 8): the daily review and a band proposal waiting for the owner. Its frame stands until its area lane replaces the body. */
export const meta = () => viewMeta("review");

export default function Review() {
  return <ArrivingPage view="review" />;
}
