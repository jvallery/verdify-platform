// SPDX-License-Identifier: MIT
import { formatValue } from "../../lib/format";
import type { BandLawLines } from "../../lib/operator-api";
import { Details } from "../details";

/**
 * Band block 6 (screens §2.2, manager's review C8): how the band works, for the law. Short prose and one small diagram:
 * the edges, what the law does at each with its own offsets (API-23 `law_lines`), the one price, and what the controller
 * does without a host or a clock. Collapsed; it reads nothing of its own.
 */

export type DiagramStep = { readonly key: string; readonly text: string; readonly kind: "limit" | "rule" | "edge"; readonly inBand: boolean };

/** "1.5 °F above the high edge", "at the high edge" when the offset is nothing, "0.05 kPa above the low edge". */
const offsetWords = (offset: number | undefined, unit: string, edge: string) => (offset === undefined ? `near the ${edge}` : offset === 0 ? `at the ${edge}` : `${formatValue(offset, unit)} above the ${edge}`);

/**
 * One axis as a ladder from top to bottom: the protection limit, the rules above the band, the high edge, the rules
 * inside the band, the low edge and the limit below. The rules come from the law's offsets; without them, no offsets.
 */
export function diagramSteps(axis: "temp" | "vpd", lines: BandLawLines | null, limits: { hot: number | null; cold: number | null }): DiagramStep[] {
  const l = lines ?? undefined;
  if (axis === "temp") {
    return [
      { key: "hot", kind: "limit", inBand: false, text: `Hot limit${limits.hot === null ? "" : `, ${formatValue(limits.hot, "°F")}`}: cooling overrides everything` },
      { key: "fan2", kind: "rule", inBand: false, text: `The second fan joins ${offsetWords(l?.fan2_on_above_high_f, "°F", "high edge")}` },
      { key: "cool", kind: "rule", inBand: false, text: `Cooling starts ${offsetWords(l?.cool_on_above_high_f, "°F", "high edge")}: vent and lead fan` },
      { key: "high", kind: "edge", inBand: true, text: "High edge" },
      { key: "heat1", kind: "rule", inBand: true, text: `Electric heat starts ${l ? `${formatValue(l.heat1_on_above_low_f, "°F")} above the low edge` : "near the low edge"}` },
      { key: "heat2", kind: "rule", inBand: true, text: `The gas furnace starts ${l ? `${formatValue(l.heat2_on_above_low_f, "°F")} above the low edge` : "just above the low edge"}` },
      { key: "low", kind: "edge", inBand: true, text: "Low edge" },
      { key: "cold", kind: "limit", inBand: false, text: `Cold limit${limits.cold === null ? "" : `, ${formatValue(limits.cold, "°F")}`}: heating overrides everything` },
    ];
  }
  return [
    { key: "mist", kind: "rule", inBand: false, text: `The misters join ${offsetWords(l?.mist_on_above_vpd_high_kpa, "kPa", "high edge")}` },
    { key: "fog", kind: "rule", inBand: false, text: `Fog starts ${offsetWords(l?.fog_on_above_vpd_high_kpa, "kPa", "high edge")}: the air is too dry` },
    { key: "high", kind: "edge", inBand: true, text: "High edge" },
    { key: "dry", kind: "rule", inBand: true, text: l ? `Drying is wanted from ${formatValue(l.dry_on_above_vpd_low_kpa, "kPa")} above the low edge down: the air is too humid` : "Drying is wanted near the low edge and below: the air is too humid" },
    { key: "low", kind: "edge", inBand: true, text: "Low edge" },
  ];
}

function Ladder({ title, steps }: { title: string; steps: readonly DiagramStep[] }) {
  return <figure className="band-diagram-axis">
    <figcaption>{title}</figcaption>
    <ol className="band-diagram">{steps.map((step) => <li key={step.key} data-kind={step.kind} data-in-band={step.inBand ? "" : undefined}>{step.text}</li>)}</ol>
  </figure>;
}

export type BandExplainerProps = { lines: BandLawLines | null; hotLimit: number | null; coldLimit: number | null };

/** Block 6, a disclosure: the band in prose, then the two ladders. */
export function BandExplainer({ lines, hotLimit, coldLimit }: BandExplainerProps) {
  const limits = { hot: hotLimit, cold: coldLimit };
  const heat1 = lines ? formatValue(lines.heat1_on_above_low_f, "°F") : null;
  return <Details className="card band-explainer" summary="How the band works">
    <div className="prose">
      <p>The band is the range the house is held in: a low and a high edge for temperature and for VPD. Each edge is set by day (solar noon) and at night (solar midnight); sunrise and sunset sit halfway between unless they are set separately. The controller draws one smooth curve through the four times, so the band follows the sun through the seasons.</p>
      <p>Every second the controller's law compares the house with the edges in force and switches equipment at fixed points beside them{heat1 ? `: electric heat, for example, starts ${heat1} above the low edge, before the house reaches it` : ""}. The ladders below show each point. Fans, fog and misters keep the house from crossing the high edges; heat and drying keep it from crossing the low ones.</p>
      <p>Drying vents moist air out, which costs heat. The controller dries only while that price, in kWh for each kilogram of water, is under the drying cost limit: the one price beside the band.</p>
      <p>Without a host the controller keeps the band it last confirmed. Without a clock it holds the widest safe band, the lowest low and the highest high of the day. The hot and cold limits override everything.</p>
      <p>Only the owner saves the band. The daily review may propose a change; nothing changes until the owner loads it here and saves it.</p>
    </div>
    <div className="band-diagram-pair" role="group" aria-label="Where the law acts around the band">
      <Ladder title="Temperature" steps={diagramSteps("temp", lines, limits)} />
      <Ladder title="VPD" steps={diagramSteps("vpd", lines, limits)} />
    </div>
  </Details>;
}
