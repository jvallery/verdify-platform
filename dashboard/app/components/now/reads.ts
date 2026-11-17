// SPDX-License-Identifier: MIT
/**
 * Now's own reads (dashboard v2 screens §1), on the shared keys and cadences of lib/queries.ts: each polls on its
 * cadence, pauses while the tab is hidden, and asks for the window that ends at its own moment on the server's clock.
 * - The day read: API-04 over the last 25 h in 15 min buckets (`DAY_KEYS`), for the hero's today range, Today's chart
 *   and the probes' sparklines.
 * - The case read: the case probe's temperature and RH over the same window, apart from the day read.
 * - The record read: API-32 for yesterday and today, for time in band and whether last night dried out.
 * - `useNearViewport`: a block below the fold reads only once it is near the screen.
 */
import { useEffect, useState, type RefObject } from "react";
import { dateShift } from "../../lib/format";
import { apiGet, type Series } from "../../lib/operator-api";
import { READ_INTERVAL_MS, useRecordDaysRead } from "../../lib/queries";
import { usePolledQuery } from "../../lib/use-current";
import { useServerSkew } from "../freshness";
import { CASE_KEYS, DAY_KEYS, DAY_POINTS, DAY_WINDOW_S } from "./climate";

const iso = (epochMs: number) => new Date(epochMs).toISOString();

function useWindowSeries(keys: readonly string[]) {
  const skewMs = useServerSkew();
  return usePolledQuery<Series>(["api", "API-04", { last_s: DAY_WINDOW_S, metric: keys, points: DAY_POINTS }], (signal) => {
    const to = Date.now() - skewMs;
    return apiGet("API-04", { metric: [...keys], from: iso(to - DAY_WINDOW_S * 1000), to: iso(to), points: DAY_POINTS }, { signal });
  }, READ_INTERVAL_MS.zones);
}
/** API-04 over the last 25 h, 15 min buckets: the house, outdoor and the wall probes' VPD. */
export const useDayRead = () => useWindowSeries(DAY_KEYS);
/** API-04 over the last 25 h for the case probe's temperature and RH. */
export const useCaseRead = () => useWindowSeries(CASE_KEYS);
/** API-32 for yesterday and today (local days), keyed by today so it moves at midnight. */
export const useInBandRead = (today: string) => useRecordDaysRead({ from: dateShift(today, -1), to: today });

/**
 * True once the element has come within `margin` of the viewport, and from then on. Where there is no
 * IntersectionObserver (a server render, an old browser) it stays false, so what it guards never loads there.
 */
export function useNearViewport(ref: RefObject<Element | null>, margin = "400px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (near || !element || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, { rootMargin: margin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin, near]);
  return near;
}
