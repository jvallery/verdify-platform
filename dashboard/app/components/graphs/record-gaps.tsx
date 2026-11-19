// SPDX-License-Identifier: MIT
import { clockTime, localDay } from "../../charts/time-axis";
import type { XRange } from "../../charts/types";
import { duration } from "../../lib/format";
import { recordGaps, type RecordGap } from "../../lib/graph-law";
import type { Series } from "../../lib/operator-api";
import { words } from "../../lib/words";

/**
 * Gaps in the record (screens.md section 7.1, parity R-15): the charts draw a stretch with no record as a gap, never
 * joined across, and this list names each one with its length and, where the ingestor recorded the outage, why.
 */
export type GapItem = { readonly key: string; readonly text: string };

/** "No record 03:10–03:42 (32 min) · the host reconnected to the controller"; an open gap reads "No record since 03:10". */
export function gapText(gap: RecordGap, open: boolean): string {
  const withDate = localDay(gap.from) !== localDay(gap.to);
  const span = open ? `No record since ${clockTime(gap.from, withDate)}` : `No record ${clockTime(gap.from, withDate)}–${clockTime(gap.to, withDate)}`;
  const reason = gap.reason ? ` · ${words("data_gap_reason", gap.reason)}` : "";
  return `${span} (${duration(gap.to - gap.from)})${reason}`;
}

/** The first panel's first metric's gaps inside the measured window, as list items. */
export function recordGapItems(series: Series | null | undefined, key: string | null, measured: XRange | null): GapItem[] {
  if (!key || !measured) return [];
  return recordGaps(series, key, measured).map((gap) => ({ key: `${gap.from}`, text: gapText(gap, gap.to >= measured.to) }));
}

/** The list under the notes; nothing when the record is whole. */
export function RecordGaps({ gaps }: { gaps: readonly GapItem[] }) {
  if (!gaps.length) return null;
  return <details className="gr-gaps">
    <summary className="meta">Gaps in the record · {gaps.length}</summary>
    <ul aria-label="Gaps in the record">{gaps.map((gap) => <li key={gap.key}>{gap.text}</li>)}</ul>
  </details>;
}
