// SPDX-License-Identifier: MIT
import type { Series } from "./operator-api";

/** A chart bucket is an interval average, not an instantaneous sensor reading. Never turn null into zero. */
export function latestHydroInterval(series: Series | null, key: string): { value: number; at: number } | null {
  const values = series?.series[key]?.avg;
  if (!series || !values) return null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    const at = series.t[index];
    if (typeof value === "number" && Number.isFinite(value) && Number.isFinite(at)) return { value, at };
  }
  return null;
}
