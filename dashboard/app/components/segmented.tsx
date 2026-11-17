// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cls } from "./common";

/** One segment: a link (a view or range kept in the URL) or a button that selects in place. */
export type Segment = { readonly value: string; readonly label: ReactNode; readonly to?: string; readonly keepScroll?: boolean };

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
 * screen reader hears which one is on. The track scrolls sideways rather than wraps on a narrow screen.
 */
export function Segmented({ label, segments, value, onChange, size = "md", className }: SegmentedProps) {
  return <ul className={cls("segmented", size === "sm" && "segmented-sm", className)} aria-label={label}>
    {segments.map((segment) => {
      const selected = segment.value === value;
      return <li key={segment.value}>
        {segment.to !== undefined
          ? <Link to={segment.to} aria-current={selected ? "page" : undefined} preventScrollReset={segment.keepScroll}>{segment.label}</Link>
          : <button type="button" aria-pressed={selected} onClick={() => { if (!selected) onChange?.(segment.value); }}>{segment.label}</button>}
      </li>;
    })}
  </ul>;
}
