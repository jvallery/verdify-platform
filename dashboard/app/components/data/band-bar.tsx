// SPDX-License-Identifier: MIT
import { formatValue } from "../../lib/format";
import { useApiDown } from "../../lib/session";
import { cls } from "../common";
import { HatchPattern, STATE_WORDS, VizSkeleton, finite, usePatternId, vizRole, type VizState } from "./viz";

export type Range = { readonly low: number; readonly high: number };
/** Where a value sits against its band: the verdict word a caller shows only when it is out of band. */
export type BandPosition = "below" | "in" | "above";

export function bandPosition(value: number | null | undefined, band: Range | null | undefined): BandPosition | null {
  if (!finite(value) || !band || !finite(band.low) || !finite(band.high)) return null;
  return value < band.low ? "below" : value > band.high ? "above" : "in";
}

/**
 * The scale (redesign §4.6, Jason 2026-11-05): the band plus one band width each side, fixed, so the band box keeps its
 * place and width and only the dot moves. A value past either end clamps to it with an arrowhead. Today's low and high do
 * not widen it; they are words, not drawn. With no band (RH) a percentage reads on 0–100%, anything else around its value.
 */
export function bandScale(value: number | null | undefined, band: Range | null | undefined, unit = ""): Range | null {
  if (band && finite(band.low) && finite(band.high) && band.high > band.low) {
    const width = band.high - band.low;
    return { low: band.low - width, high: band.high + width };
  }
  if (unit === "%") return { low: 0, high: 100 };
  if (!finite(value)) return null;
  const pad = Math.max(Math.abs(value) * 0.1, 0.5);
  return { low: value - pad, high: value + pad };
}

export type BandBarProps = {
  /** What it measures, for its name: "Temperature". */
  label: string;
  unit: string;
  value: number | null | undefined;
  /** The band in force; null for a metric with none (RH), which draws no band segment. */
  band?: Range | null;
  /** Today's low and high, for the gauge's name only: they are not drawn (Jason 2026-11-05). */
  today?: Range | null;
  /** On the ink hero: the band box in `--c-band-edge` with mint ends, a mint dot with an ink ring (redesign §4.6). */
  hero?: boolean;
  /** `aria-hidden` when the same numbers sit beside it as text (they usually do); else an image named by them. */
  decorative?: boolean;
  state?: VizState;
  /** Threshold ticks on the track (design system v2 §4), each with an optional label; a warn or critical tick takes that status colour. */
  ticks?: readonly BandTick[];
  /** Label the band's two edges with their values under the track. */
  edgeLabels?: boolean;
  /** Say the reading's relation to the band in words under the gauge: "in band", "0.4 °F below". */
  showRelation?: boolean;
};

/** A threshold tick: where it sits, its label and its level (neutral by default). */
export type BandTick = { readonly value: number; readonly label?: string; readonly level?: "neutral" | "warn" | "critical" };

/** "in band", "0.4 °F below" or "0.4 °F above": how far the reading sits outside the band, in words; null without both. */
export function bandRelationWords(value: number | null | undefined, band: Range | null | undefined, unit: string): string | null {
  const position = bandPosition(value, band);
  if (!position || !band || !finite(value)) return null;
  if (position === "in") return "in band";
  return `${formatValue(position === "below" ? band.low - value : value - band.high, unit)} ${position}`;
}

/** "62.0–70.0 °F": a low and a high that share their unit, written once. */
export function rangeWords(low: number, high: number, unit: string): string {
  const first = formatValue(low, unit), last = formatValue(high, unit);
  const suffix = /^[−\-\d.,]+(.*)$/.exec(last)?.[1] ?? "";
  return `${suffix && first.endsWith(suffix) ? first.slice(0, -suffix.length) : first}–${last}`;
}

/** "Temperature 64.8 °F, band 62.0–70.0 °F, today 61.2–71.9 °F". */
export function bandBarWords({ label, unit, value, band, today }: Pick<BandBarProps, "label" | "unit" | "value" | "band" | "today">): string {
  const parts = [`${label} ${formatValue(value, unit)}`];
  parts.push(band ? `band ${rangeWords(band.low, band.high, unit)}` : "no band");
  if (today) parts.push(`today ${rangeWords(today.low, today.high, unit)}`);
  return parts.join(", ");
}

const at = (scale: Range, value: number) => Math.min(100, Math.max(0, ((value - scale.low) / (scale.high - scale.low || 1)) * 100));
const pct = (value: number) => `${Math.round(value * 100) / 100}%`;

/**
 * BandBar (redesign §4.6), Now's hero and zone tiles: one full-width track, the band as a green box on it (a wash with
 * its two edges) and the value as a dot; nothing else is drawn. Positions are SVG percentages, so it scales with its box and
 * needs no style. Unknown draws no dot over a hatched track; stale is muted; while the API is down it is neutral.
 */
export function BandBar({ label, unit, value, band = null, today = null, hero = false, decorative = true, state = "ready", ticks = [], edgeLabels = false, showRelation = false }: BandBarProps) {
  const apiDown = useApiDown();
  const hatch = usePatternId("bb-hatch");
  if (state === "loading") return <VizSkeleton className={cls("bb", hero && "bb-hero")} label={label} />;
  const known = state === "ready" || state === "stale";
  const shown = known && finite(value) ? value : null;
  const scale = known ? bandScale(shown, band, unit) : null;
  const words = known && scale ? bandBarWords({ label, unit, value, band, today }) : `${label} ${STATE_WORDS[state === "stale" || state === "ready" ? "unknown" : state]}`;
  const clamped = scale && shown !== null ? (shown < scale.low ? "low" : shown > scale.high ? "high" : null) : null;
  const unknownTrack = !scale || shown === null;
  // The band box, centred on the track: 12 px on the hero, 10 px on white, taller than the 2 px track so it reads as a box.
  const top = 3, box = hero ? 12 : 10, base = hero ? 18 : 16;
  const shownTicks = scale ? ticks.filter((tick) => finite(tick.value)) : [];
  // Labels (the edges' values and the ticks') sit on one row under the track, 14 px tall.
  const labelled = !!scale && ((edgeLabels && !!band) || shownTicks.some((tick) => tick.label));
  const height = base + (labelled ? 14 : 0), labelY = height - 2;
  const level = (tick: BandTick) => (tick.level === "warn" || tick.level === "critical" ? `bb-tick-${tick.level}` : null);
  const relation = showRelation && known ? bandRelationWords(shown, band, unit) : null;
  const gauge = <svg className={cls("bb", hero && "bb-hero", state === "stale" && "is-stale", apiDown && "is-neutral", unknownTrack && "is-unknown")}
    width="100%" height={height} {...vizRole(words, decorative)} focusable="false">
    {unknownTrack && <HatchPattern id={hatch} />}
    <rect className="bb-track" x="0" y={hero ? 8 : 7} width="100%" height="2" />
    {unknownTrack && <rect className="bb-unknown" x="0" y={hero ? 5 : 4} width="100%" height="8" fill={`url(#${hatch})`} />}
    {scale && band && <>
      <rect className="bb-band" x={pct(at(scale, band.low))} y={top} width={pct(at(scale, band.high) - at(scale, band.low))} height={box} />
      <line className="bb-edge" x1={pct(at(scale, band.low))} x2={pct(at(scale, band.low))} y1={top} y2={top + box} />
      <line className="bb-edge" x1={pct(at(scale, band.high))} x2={pct(at(scale, band.high))} y1={top} y2={top + box} />
    </>}
    {scale && shownTicks.map((tick, index) => <line key={`t${index}`} className={cls("bb-tick", level(tick))} x1={pct(at(scale, tick.value))} x2={pct(at(scale, tick.value))} y1={1} y2={top + box + 2} />)}
    {labelled && scale && band && edgeLabels && <>
      <text className="bb-edge-label" x={pct(at(scale, band.low))} y={labelY} textAnchor="middle">{formatValue(band.low, unit)}</text>
      <text className="bb-edge-label" x={pct(at(scale, band.high))} y={labelY} textAnchor="middle">{formatValue(band.high, unit)}</text>
    </>}
    {labelled && scale && shownTicks.map((tick, index) => tick.label && <text key={`l${index}`} className={cls("bb-tick-label", level(tick))} x={pct(at(scale, tick.value))} y={labelY} textAnchor="middle">{tick.label}</text>)}
    {scale && shown !== null && <circle className="bb-dot" cx={pct(at(scale, shown))} cy={hero ? 9 : 8} r={hero ? 6 : 5} />}
    {clamped && <svg x={clamped === "low" ? "0" : "100%"} y="0" width="1" height="1" overflow="visible">
      <path className="bb-clamp" d={clamped === "low" ? "M-1 8 L5 4 L5 12 Z" : "M1 8 L-5 4 L-5 12 Z"} />
    </svg>}
  </svg>;
  if (!showRelation) return gauge;
  return <>{gauge}{relation && <span className="bb-relation" data-position={bandPosition(shown, band)}>{relation}</span>}</>;
}
