// SPDX-License-Identifier: MIT
import { Link } from "react-router";

/**
 * Range chips 24 h, 72 h, 7 d and 30 d as links with `aria-current`, drawn as the small segmented control of design
 * system v2 §4 (one selected segment on `--surface` over a `--surface-3` track). The caller builds each href; Graphs
 * keeps the range in the URL (#1130).
 */
export const RANGES = [
  { id: "24h", label: "24 h", seconds: 86_400 },
  { id: "72h", label: "72 h", seconds: 3 * 86_400 },
  { id: "7d", label: "7 d", seconds: 7 * 86_400 },
  { id: "30d", label: "30 d", seconds: 30 * 86_400 },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

/** `only` keeps a subset, in this order: Equipment offers 24 h and 72 h (screens SCR-07). */
export function RangeChips({ current, href, only }: { current: string | null; href: (range: RangeId) => string; only?: readonly RangeId[] }) {
  return <ul className="segmented segmented-sm range-chips" aria-label="Range">
    {RANGES.filter((range) => !only || only.includes(range.id)).map((range) => <li key={range.id}>
      <Link to={href(range.id)} aria-current={range.id === current ? "page" : undefined} preventScrollReset>{range.label}</Link>
    </li>)}
  </ul>;
}
