// SPDX-License-Identifier: MIT
import { useSearchParams } from "react-router";
import { localDate } from "../../lib/format";
import type { DailyRecord } from "../../lib/operator-api";
import { panelRead, useRecordDaysRead, type PanelRead } from "../../lib/queries";
import { useClockValue } from "../freshness";
import { parseWindow, readParams, type WindowDays } from "./record-model";

export type RecordWindow = {
  /** The window of `?days=`. */
  readonly days: WindowDays;
  /** API-32 over the window, and at least the 31 days ending today (`READ_DAYS`). */
  readonly read: PanelRead<DailyRecord>;
};

/**
 * The window and the daily record every Record view reads: `?days=` (7, 30, 90 or 365) and API-32 from the window's
 * first day to today on the server's clock. The four views ask with the same parameters for a window, so switching
 * views reuses one cache entry.
 */
export function useRecordWindow(): RecordWindow {
  const [params] = useSearchParams();
  const days = parseWindow(params.get("days"));
  const today = useClockValue((now) => localDate(new Date(now).toISOString()));
  const read = panelRead(useRecordDaysRead(readParams(days, today)));
  return { days, read };
}
