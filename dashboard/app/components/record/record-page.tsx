// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { dayHeader } from "../../lib/format";
import type { DailyRecord } from "../../lib/operator-api";
import type { ViewId } from "../../lib/sections";
import { Page } from "../layout/page";
import { PageHeader } from "../layout/page-header";
import { Segmented } from "../segmented";
import { WINDOWS, windowDays, windowHref, type WindowDays } from "./record-model";
import type { RecordWindow } from "./use-record";

/** The query a tab change between Record's views keeps: the window. */
const RECORD_QUERY = ["days"] as const;

/** "7 d" … "365 d", each a link that keeps the view and its other parameters. */
export function WindowControl({ days }: { days: WindowDays }) {
  const { pathname, search } = useLocation();
  return <div className="page-toolbar rc-toolbar">
    <Segmented label="Days shown" size="sm" value={String(days)}
      segments={WINDOWS.map((count) => ({ value: String(count), label: `${count}\u00a0d`, to: windowHref(pathname, count, search), keepScroll: true }))} />
  </div>;
}

/** The status line: the window's first and last day, once the record has answered. */
export function windowStatus(record: DailyRecord, days: WindowDays): { long: string; short: string } {
  const shown = windowDays(record, days);
  const first = shown[0]?.date ?? record.from;
  return { long: `Last ${days} days, ${dayHeader(first)} to ${dayHeader(record.to)}, today so far`, short: `${days} days to ${dayHeader(record.to)}` };
}

/**
 * One Record view's frame: the page header (its status line names the window once the record answers; it renders no
 * time on the server, so the server's text is the same at any clock), the window control shared by the four views, and
 * the view's blocks.
 */
export function RecordPage({ view, window, children }: { view: ViewId; window: RecordWindow; children?: ReactNode }) {
  const record = window.read.data;
  const status = record ? windowStatus(record, window.days) : null;
  return <Page className="record">
    <PageHeader view={view} status={status?.long ?? null} statusShort={status?.short ?? null} keepQuery={RECORD_QUERY} />
    <WindowControl days={window.days} />
    {children}
  </Page>;
}
