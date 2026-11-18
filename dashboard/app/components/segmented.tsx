// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatNumber } from "../lib/format";
import { cls } from "./common";

/**
 * One segment: a link (a view or range kept in the URL) or a button that selects in place. `count` follows the label
 * with a space, in the count style ("All 135"); null while it is not known.
 */
export type Segment = { readonly value: string; readonly label: ReactNode; readonly count?: number | null; readonly to?: string; readonly keepScroll?: boolean };

export type SegmentedProps = {
  /** Names the group: "Range", "Show". */
  label: string;
  segments: readonly Segment[];
  /** The selected segment's value. */
  value: string;
  /** For button segments: the value chosen. */
  onChange?: (value: string) => void;
  size?: "md" | "sm";
  className?: string;
};

/**
 * The segmented control of design system v2 §4: one selected segment on `--surface` over a `--surface-3` track. Link
 * segments mark the selected one `aria-current="page"`; button segments are toggle buttons with `aria-pressed`, so a
 * screen reader hears which one is on. A segment's count sits a gap after its words (A6). The track scrolls sideways
 * rather than wraps on a narrow screen.
 */
export function Segmented({ label, segments, value, onChange, size = "md", className }: SegmentedProps) {
  return <ul className={cls("segmented", size === "sm" && "segmented-sm", className)} aria-label={label}>
    {segments.map((segment) => {
      const selected = segment.value === value;
      // The label's words and the count are flex items a gap apart: a space at the edge of a flex item is dropped ("All135").
      const label = segment.count === undefined || segment.count === null ? segment.label
        : <><span>{segment.label}</span>{" "}<span className="segmented-count">{formatNumber(segment.count)}</span></>;
      return <li key={segment.value}>
        {segment.to !== undefined
          ? <Link to={segment.to} aria-current={selected ? "page" : undefined} preventScrollReset={segment.keepScroll}>{label}</Link>
          : <button type="button" aria-pressed={selected} onClick={() => { if (!selected) onChange?.(segment.value); }}>{label}</button>}
      </li>;
    })}
  </ul>;
}
