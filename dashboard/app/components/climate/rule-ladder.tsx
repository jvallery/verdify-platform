// SPDX-License-Identifier: MIT
import type { KeyboardEventHandler } from "react";
import { formatValue } from "../../lib/format";
import { words } from "../../lib/words";
import { cls } from "../common";
import { rovingKeys } from "../data/viz";
import { BREAK_AT, buildLadder, type LadderInput, type LadderModel, type PlacedRule } from "./ladder";

/** Rows of labels above the track and the room below it, in px (the SVG's x is in percent, its y in px). */
const ROW_H = 14;
const TOP = 4;
/** The shared roving keys, typed for the SVG (its ticks are focusable SVG elements, which `focus()` the same way). */
const svgKeys = rovingKeys() as unknown as KeyboardEventHandler<SVGSVGElement>;
const pct = (value: number) => `${Math.round(value * 100) / 100}%`;

/** The class of a tick by its rule's state: on, asked for or waiting, a protection limit, or idle. */
function tickClass(rule: PlacedRule): string {
  return cls("ladder-tick", rule.limit && "is-limit", (rule.state === "on" || rule.state === "held_on") && "is-on",
    (rule.state === "asked" || rule.state === "waiting" || rule.state === "wanted") && "is-wanted") ?? "ladder-tick";
}

/** "Electric heat: turns on below 67.9 °F, off at 70.4 °F". */
function tickWords(rule: PlacedRule, unit: string): string {
  const on = `${rule.label}: ${words("law_direction", rule.direction)} ${formatValue(rule.on, unit)}`;
  return rule.off !== null && rule.off !== rule.on ? `${on}, off at ${formatValue(rule.off, unit)}` : on;
}

/** A break in the axis at `at` percent: a gap in the track with two slashes, so the end zone reads as off the scale. */
function AxisBreak({ at, y }: { at: number; y: number }) {
  return <svg x={pct(at)} y={y} width="1" height="1" overflow="visible" aria-hidden="true">
    <rect className="ladder-break-gap" x="-4" y="-6" width="8" height="12" />
    <path className="ladder-break" d="M-5 5 L-1 -5 M1 5 L5 -5" />
  </svg>;
}

/** The horizontal ladder: label rows, the track with the band zone, the ticks, the reading and the edges under it. */
function LadderSvg({ model, label, unit }: { model: LadderModel; label: string; unit: string }) {
  const rows = Math.max(1, model.rows);
  const track = TOP + rows * ROW_H + 10;
  const baseline = (row: number) => TOP + (rows - row) * ROW_H - 3;
  const under = track + 22;
  const reading = model.reading;
  const edges = model.band;
  // Edge values move to a second row under the track when the reading's label would sit on one.
  const crowded = !!reading && !!edges && (Math.abs(reading.at - edges.from) < 12 || Math.abs(reading.at - edges.to) < 12);
  const edgeLine = crowded ? under + ROW_H : under;
  const height = edgeLine + 6;
  const bandLow = model.entries.find((entry) => entry.kind === "edge" && entry.side === "low")?.value;
  const bandHigh = model.entries.find((entry) => entry.kind === "edge" && entry.side === "high")?.value;
  const now = model.entries.find((entry) => entry.kind === "reading")?.value;
  return <svg className="ladder-svg" width="100%" height={height} role="group" aria-label={`${label} ladder: each rule at the value where it turns on; use the arrow keys to read them`}
    tabIndex={0} onKeyDown={svgKeys} focusable="false">
    <rect className="ladder-track" x="0" y={track - 1} width="100%" height="2" />
    {edges && <>
      <rect className="ladder-band" x={pct(edges.from)} y={track - 7} width={pct(edges.to - edges.from)} height="14" />
      <line className="ladder-edge" x1={pct(edges.from)} x2={pct(edges.from)} y1={track - 7} y2={track + 7} />
      <line className="ladder-edge" x1={pct(edges.to)} x2={pct(edges.to)} y1={track - 7} y2={track + 7} />
    </>}
    {model.breaks.low && <AxisBreak at={BREAK_AT.low} y={track} />}
    {model.breaks.high && <AxisBreak at={BREAK_AT.high} y={track} />}
    {model.rules.map((rule) => <g key={rule.id} className={tickClass(rule)} tabIndex={-1} data-roving="" role="img" aria-label={tickWords(rule, unit)}>
      <line className="ladder-tick-line" x1={pct(rule.at)} x2={pct(rule.at)} y1={baseline(rule.row) + 4} y2={track + 7} />
      <text className="ladder-tick-label" x={pct(rule.at)} y={baseline(rule.row)} textAnchor={rule.anchor}>
        {rule.text}
        {rule.off !== null && rule.off !== rule.on && <tspan className="ladder-off"> · off {formatValue(rule.off, unit)}</tspan>}
      </text>
    </g>)}
    {edges && bandLow !== undefined && bandHigh !== undefined && <g aria-hidden="true">
      <text className="ladder-edge-label" x={pct(edges.from)} y={edgeLine} textAnchor="middle">{formatValue(bandLow, unit)}</text>
      <text className="ladder-edge-label" x={pct(edges.to)} y={edgeLine} textAnchor="middle">{formatValue(bandHigh, unit)}</text>
    </g>}
    {reading && now !== undefined && <g aria-hidden="true">
      <circle className="ladder-reading" cx={pct(reading.at)} cy={track} r="6" />
      {reading.clamped && <svg x={pct(reading.at)} y={track} width="1" height="1" overflow="visible">
        <path className="ladder-clamp" d={reading.clamped === "low" ? "M-9 0 L-14 -4 L-14 4 Z" : "M9 0 L14 -4 L14 4 Z"} />
      </svg>}
      <text className="ladder-reading-label" x={pct(reading.at)} y={under} textAnchor={reading.at < 14 ? "start" : reading.at > 86 ? "end" : "middle"}>Now {formatValue(now, unit)}</text>
    </g>}
  </svg>;
}

/** The phone's ladder: the same marks as a vertical list in the same order, the band's stretch shaded. */
function LadderList({ model, label, unit }: { model: LadderModel; label: string; unit: string }) {
  const low = model.entries.find((entry) => entry.kind === "edge" && entry.side === "low")?.value;
  const high = model.entries.find((entry) => entry.kind === "edge" && entry.side === "high")?.value;
  const inBand = (value: number) => low !== undefined && high !== undefined && value >= low && value <= high;
  return <ol className="ladder-list" aria-label={`${label} ladder, lowest first`}>
    {model.entries.map((entry, index) => {
      const key = entry.kind === "rule" ? entry.rule.id : entry.kind === "edge" ? `edge-${entry.side}` : "reading";
      return <li key={`${key}-${index}`} className={cls("ladder-item", `is-${entry.kind}`, inBand(entry.value) && "in-band", entry.kind === "rule" && tickClass(entry.rule))}>
        <span className="ladder-item-mark" aria-hidden="true" />
        <span className="ladder-item-value">{formatValue(entry.value, unit)}</span>
        <span className="ladder-item-name">{entry.kind === "rule" ? <>{entry.rule.label} <span className="muted">{words("law_direction", entry.rule.direction)}</span></>
          : entry.kind === "edge" ? (entry.side === "low" ? "Low edge of the band" : "High edge of the band") : "Now"}</span>
      </li>;
    })}
  </ol>;
}

export type RuleLadderProps = LadderInput & {
  /** The signal's name: "Temperature", "VPD". */
  label: string;
};

/**
 * The rule ladder (design system v2 §5): one axis with the band as a zone, each rule's on value as a labelled tick (its
 * off value on focus and in the rules' table), and the reading as a marker. Above a 520 px wide container it is an SVG
 * track; narrower it is the same marks as a list in the same order (screens §2.1 block 2), so no label ever overlaps.
 * Nothing to place reads "Not reported".
 */
export function RuleLadder({ label, unit, band, reading, rules }: RuleLadderProps) {
  const model = buildLadder({ unit, band, reading, rules });
  if (!model) return <p className="ladder-none muted">{label}: not reported.</p>;
  return <div className="ladder">
    <LadderSvg model={model} label={label} unit={unit} />
    <LadderList model={model} label={label} unit={unit} />
  </div>;
}
