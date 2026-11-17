// SPDX-License-Identifier: MIT
/**
 * "What the controller is doing" on Now (dashboard v2 screens §1 block 2): one or two sentences built from the climate
 * law's record (API-02 `law`: its requests, its drying decision and the band in use), what runs (API-02 `running`) and
 * the house readings, never from a mode label. Pure, so the tests read it against real law records.
 *
 * The order is the law's own:
 * - A protection limit (the `hot` or `cold` request) overrides everything and stands alone.
 * - The first sentence is about temperature: cooling (the vent with one or both fans), else heating (electric heat, the
 *   gas furnace or both), each against the edge it acts at, with how far the house sits from that edge.
 * - The second is about the air's moisture: drying running (with its price against the limit), else fog or misters
 *   against the high VPD edge, else drying wanted and refused with the controller's one reason (both numbers for cost;
 *   "outdoor air is not drier" when the controller has no price), else drying off because a reading is missing.
 * - With nothing asked for: "Holding the band. Nothing is running." (or that the law asks for nothing while a run by
 *   hand or a water line runs).
 *
 * A rule the law asks for whose relay is not running yet reads "asked for, not on yet": the relay waits out its minimum
 * off time or an interlock holds it. A missing reading drops the distance, never guesses it.
 */
import { formatNumber, formatValue } from "./format";
import type { Now } from "./operator-api";
import { words } from "./words";

export type LawState = NonNullable<Now["law"]>;
export type LawSentenceInput = {
  /** API-02 `law`: the newest law record while it is fresh; null when the law has not reported. */
  readonly law: LawState | null | undefined;
  /** API-02 `running`: the equipment commanded on now. */
  readonly running: Now["running"];
  /** The house temperature (°F) and VPD (kPa) the law reads; null when not reported or not fresh. */
  readonly temp: number | null;
  readonly vpd: number | null;
};
export type LawSentence = {
  /** One or two sentences. */
  readonly sentences: readonly string[];
  /** holding: nothing asked for; acting: a rule is asked for; limit: a protection limit; not_reporting: no law record. */
  readonly kind: "holding" | "acting" | "limit" | "not_reporting";
};

export const HOLDING = "Holding the band.";
export const NOTHING_RUNNING = "Nothing is running.";
export const NOT_REPORTING = "The law has not reported in the last 2 minutes, so what the controller is doing is not known.";
export const HOT_LIMIT = "The hot limit is on: everything cools, with the vent open and both fans running.";
export const COLD_LIMIT = "The cold limit is on: both heaters run and the vent stays closed.";

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const degrees = (value: number) => formatValue(Math.abs(value), "°F");
const kpa = (value: number) => formatValue(Math.abs(value), "kPa");

/** How far the house sits from the low (heating) or high (cooling) temperature edge; null without both numbers. */
export function tempClause(temp: number | null, edge: number | null | undefined, side: "low" | "high"): string | null {
  if (!finite(temp) || !finite(edge)) return null;
  const gap = Math.round((temp - edge) * 10) / 10;
  if (gap === 0) return `the house is at the ${side} edge`;
  if (side === "low") return gap < 0 ? `the house is ${degrees(gap)} below the low edge` : `the house is within ${degrees(gap)} of the low edge`;
  return gap > 0 ? `the house is ${degrees(gap)} above the high edge` : `the house is within ${degrees(gap)} of the high edge`;
}

/** How dry the air is against the high VPD edge (fog, misters); null without both numbers. */
export function dryClause(vpd: number | null, high: number | null | undefined, much = false): string | null {
  if (!finite(vpd) || !finite(high)) return null;
  const gap = Math.round((vpd - high) * 100) / 100;
  if (gap > 0) return `the air is ${much ? "much " : ""}drier than the band allows, with VPD ${kpa(gap)} above the high edge`;
  return gap === 0 ? "VPD is at the high edge" : `VPD is within ${kpa(gap)} of the high edge`;
}

/** How humid the air is against the low VPD edge (drying), as a sentence's start; null without both numbers. */
export function humidClause(vpd: number | null, low: number | null | undefined): string | null {
  if (!finite(vpd) || !finite(low)) return null;
  const gap = Math.round((vpd - low) * 100) / 100;
  if (gap < 0) return "the air is more humid than the band allows";
  return gap === 0 ? "VPD is at the low edge" : `VPD is within ${kpa(gap)} of the low edge`;
}

/** Why drying is refused, in words: both numbers for cost; "outdoor air is not drier" when there is no price. */
export function refusalWords(law: Pick<LawState, "drying_refused_reason" | "drying_cost_kwh_per_kg" | "drying_cost_limit_kwh_per_kg">): string {
  const reason = law.drying_refused_reason ?? "";
  const cost = law.drying_cost_kwh_per_kg, limit = law.drying_cost_limit_kwh_per_kg;
  if (reason === "cost" || reason === "not_drier") {
    if (reason === "cost" && finite(cost)) return `it would cost ${formatNumber(cost, 2)} kWh/kg and the limit is ${formatNumber(limit, 2)}`;
    return words("drying_refusal", "not_drier");
  }
  return reason ? words("drying_refusal", reason) : "the controller gave no reason";
}

type Part = { readonly name: string; readonly on: boolean };
/** "Electric heat is on", "Electric heat and the gas furnace are on", "Electric heat is on and the gas furnace is asked for, not on yet". */
function stateOf(parts: readonly Part[]): string {
  const verb = (on: boolean, many: boolean) => (on ? (many ? "are on" : "is on") : (many ? "are asked for, not on yet" : "is asked for, not on yet"));
  if (parts.length === 1) return `${parts[0].name} ${verb(parts[0].on, false)}`;
  if (parts.every((part) => part.on === parts[0].on)) return `${parts.map((part) => part.name).join(" and ")} ${verb(parts[0].on, true)}`;
  return parts.map((part) => `${part.name} ${verb(part.on, false)}`).join(" and ");
}
const sentence = (head: string, clause: string | null) => `${capital(head)}${clause ? `: ${clause}` : ""}.`;

function temperatureSentence(law: LawState, isOn: (equipment: string) => boolean, temp: number | null): string | null {
  const asks = (code: string) => law.requests.includes(code as LawState["requests"][number]);
  const band = law.band ?? null;
  if (asks("cooling")) {
    const fans = asks("fan2") ? "both fans" : "one fan";
    const clause = tempClause(temp, band?.temp_high_f, "high");
    if (!isOn("vent")) return sentence(`cooling with ${fans} is asked for, not on yet`, clause);
    return sentence(`venting with ${fans} to cool`, clause);
  }
  const heaters: Part[] = [];
  if (asks("heat1")) heaters.push({ name: "electric heat", on: isOn("heat1") });
  if (asks("heat2")) heaters.push({ name: "the gas furnace", on: isOn("heat2") });
  if (!heaters.length) return null;
  return sentence(stateOf(heaters), tempClause(temp, band?.temp_low_f, "low"));
}

function moistureSentence(law: LawState, isOn: (equipment: string) => boolean, vpd: number | null): string | null {
  const asks = (code: string) => law.requests.includes(code as LawState["requests"][number]);
  const band = law.band ?? null;
  if (law.drying === "running" || asks("drying")) {
    const fans = asks("fan2") ? "both fans" : "one fan";
    const cost = law.drying_cost_kwh_per_kg, limit = law.drying_cost_limit_kwh_per_kg;
    const price = finite(cost) && finite(limit) ? ` at ${formatNumber(cost, 2)} kWh/kg, under the limit of ${formatNumber(limit, 2)}` : "";
    return `Drying: venting with ${fans} to carry moist air out${price}.`;
  }
  const fog = asks("fog"), mist = asks("mist");
  if (fog || mist) {
    const head = fog && mist ? (isOn("fog") ? "fogging and misting" : "fog and misters are asked for") : fog ? (isOn("fog") ? "fogging" : "fog is asked for, not on yet") : "misting";
    return sentence(head, dryClause(vpd, band?.vpd_high_kpa, mist && !fog));
  }
  if (law.drying === "refused") {
    const humid = humidClause(vpd, band?.vpd_low_kpa);
    return `${humid ? `${capital(humid)}, but drying is refused` : "Drying is wanted and refused"}: ${refusalWords(law)}.`;
  }
  const reason = law.drying_refused_reason;
  if (reason === "humidity_invalid" || reason === "no_temperature") return `Drying is off: ${words("drying_refusal", reason)}.`;
  return null;
}

/** The sentences for this moment; see the file's head. */
export function lawSentence({ law, running, temp, vpd }: LawSentenceInput): LawSentence {
  if (!law) return { sentences: [NOT_REPORTING], kind: "not_reporting" };
  if (law.requests.includes("hot")) return { sentences: [HOT_LIMIT], kind: "limit" };
  if (law.requests.includes("cold")) return { sentences: [COLD_LIMIT], kind: "limit" };
  const on = new Set(running.map((item) => item.equipment));
  const isOn = (equipment: string) => on.has(equipment);
  const sentences = [temperatureSentence(law, isOn, temp), moistureSentence(law, isOn, vpd)].filter((line): line is string => line !== null);
  if (sentences.length) return { sentences, kind: "acting" };
  return { sentences: [running.length ? `${HOLDING.slice(0, -1)}: the law asks for nothing.` : `${HOLDING} ${NOTHING_RUNNING}`], kind: "holding" };
}
