// SPDX-License-Identifier: MIT
import type { SectionId } from "../lib/sections";

/**
 * The dashboard's one icon set: one icon per section (the rail, the phone bar and the More sheet) and the few marks the
 * frame needs (Search, More, Close). Inline SVG (the content security policy allows no `data:` URI), drawn on a 24-unit
 * grid in `currentColor` with a 1.75 px stroke and round ends, so each takes its link's colour. Decorative: the label
 * beside it names it.
 */
const PATHS: Readonly<Record<SectionId, readonly string[]>> = {
  // A gauge.
  now: ["M4.5 16.5a7.5 7.5 0 1 1 15 0", "M12 16.5l4.2-5.2", "M7 16.5h.01", "M17 16.5h.01", "M12 9h.01"],
  // A thermometer.
  climate: ["M9.5 13.8V5.5a2.5 2.5 0 0 1 5 0v8.3a4 4 0 1 1-5 0z", "M12 9v7.5"],
  // A droplet.
  water: ["M12 3.5c-2.9 3.9-6 7.3-6 10.6a6 6 0 0 0 12 0c0-3.3-3.1-6.7-6-10.6z", "M9.2 14.6a2.9 2.9 0 0 0 2.4 2.6"],
  // A bulb.
  lights: ["M9.5 17.5h5", "M10.5 20.5h3", "M12 3.5a5.5 5.5 0 0 0-3.4 9.8c.6.5.9 1.2.9 2v.2h5v-.2c0-.8.3-1.5.9-2A5.5 5.5 0 0 0 12 3.5z"],
  // A sprout.
  crops: ["M12 20v-8", "M12 12c0-3.6-2.6-6.2-6.5-6.2 0 3.6 2.6 6.2 6.5 6.2z", "M12 14.5c0-3 2.2-5.2 5.5-5.2 0 3-2.2 5.2-5.5 5.2z", "M7.5 20h9"],
  // A planter with a sprout.
  hydro: ["M4 15h16l-2 6H6z", "M12 15V8", "M12 9C6 9 6 3 6 3c6 0 6 6 6 6z", "M12 12c0-6 6-6 6-6s0 6-6 6"],
  // A ledger of days.
  record: ["M6 3.5h12v17H6z", "M9 8h6", "M9 12h6", "M9 16h3.5"],
  // A line chart.
  graphs: ["M4 4v16h16", "M7.5 15l3.5-4.5 3 2.5 5-6.5"],
  // A page with a check.
  review: ["M6 3.5h8.5l3.5 3.5v13.5H6z", "M14.5 3.5V7H18", "M9 13.5l2 2 4-4"],
  // A bell.
  activity: ["M6.5 16.5v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14z", "M10 20.5a2.2 2.2 0 0 0 4 0"],
  // A power switch: a relay.
  equipment: ["M12 3.5v7", "M7.4 6.8a7 7 0 1 0 9.2 0"],
  // A chip.
  controller: ["M7 7h10v10H7z", "M10 10h4v4h-4z", "M9.5 3.5V7", "M14.5 3.5V7", "M9.5 17v3.5", "M14.5 17v3.5", "M3.5 9.5H7", "M3.5 14.5H7", "M17 9.5h3.5", "M17 14.5h3.5"],
  // A stack of records.
  data: ["M5 6.5c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z", "M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11", "M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"],
  // Sliders.
  settings: ["M4 7h9", "M17 7h3", "M4 12h3", "M11 12h9", "M4 17h11", "M19 17h1", "M15 5v4", "M9 10v4", "M17 15v4"],
};

/** The frame's other marks. */
const MARKS = {
  search: ["M10.5 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z", "M15 15l5 5"],
  more: ["M5 6.5h14", "M5 12h14", "M5 17.5h14"],
  close: ["M6 6l12 12", "M18 6L6 18"],
} as const;
export type MarkName = keyof typeof MARKS;

function Svg({ paths, className }: { paths: readonly string[]; className?: string }) {
  return <svg className={className ? `icon ${className}` : "icon"} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {paths.map((path) => <path key={path} d={path} />)}
  </svg>;
}

export function SectionIcon({ section, className }: { section: SectionId; className?: string }) {
  return <Svg paths={PATHS[section]} className={className} />;
}

/** Search's magnifier, More's lines and a sheet's Close. */
export function MarkIcon({ name, className }: { name: MarkName; className?: string }) {
  return <Svg paths={MARKS[name]} className={className} />;
}
