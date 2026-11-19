// SPDX-License-Identifier: MIT
import { listedChanges } from "../../lib/activity";
import { bandAnchorUnit } from "../../lib/band-words";
import { shortDateTime } from "../../lib/format";
import type { ActivityEntry } from "../../lib/operator-api";
import { panelRead, useApiRead } from "../../lib/queries";
import { Panel } from "../panel";
import { ChangeItem } from "../control/band-editor";
import { bandRowWords, isBandParam, type ChangeLine } from "./band-draft";

/**
 * Band block 5 (screens §2.2, parity K-07): the band's changes from Activity (API-17 `band.write`), newest first: when,
 * who, how many edges, the reason, and each change in words with its old and new value behind a disclosure.
 */

/** The newest ten band saves; Activity's log holds the rest. */
export const BAND_HISTORY = { action: "band.write", limit: 10 } as const;
const POLL_MS = 60_000;

/** A save's changes in words, edges and stored rows alike, old to new. */
export function historyLines(entry: Pick<ActivityEntry, "detail">): ChangeLine[] {
  return listedChanges(entry.detail).filter((change) => isBandParam(change.param)).map((change) => ({
    param: change.param, words: bandRowWords(change.param) ?? change.param, unit: bandAnchorUnit(change.param) ?? "",
    before: change.before ?? null, after: change.value,
  }));
}

/** "Nov 16, 14:20 · jason · 4 edges". */
export function historyHead(entry: Pick<ActivityEntry, "ts" | "actor" | "detail">): string {
  const count = historyLines(entry).length;
  return `${shortDateTime(entry.ts)} · ${entry.actor.name} · ${count} ${count === 1 ? "change" : "changes"}`;
}

export function BandHistoryPanel() {
  const read = panelRead(useApiRead("API-17", BAND_HISTORY, { intervalMs: POLL_MS }));
  const items: readonly ActivityEntry[] = read.data?.items ?? [];
  const state = read.pending ? "loading" : !read.data ? "error" : items.length === 0 ? "empty" : read.failed ? "stale" : "ready";
  return <Panel title="Changes" thing="the band's changes" state={state} onRetry={read.retry} link={{ to: "/activity/log?action=band.write", label: "All" }}
    empty={<p className="meta">No band change is recorded yet.</p>}>
    <ul className="band-history">{items.map((entry) => {
      const lines = historyLines(entry);
      return <li key={entry.id}>
        <details>
          <summary>{historyHead(entry)}</summary>
          {lines.length > 0 && <ul className="band-changes">{lines.map((line) => <ChangeItem key={line.param} line={line} />)}</ul>}
        </details>
        <p className="meta">{entry.reason ? entry.reason : "No reason given."}</p>
      </li>;
    })}</ul>
  </Panel>;
}
