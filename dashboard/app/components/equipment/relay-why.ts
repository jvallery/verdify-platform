// SPDX-License-Identifier: MIT
import type { BadgeStatus } from "../badge";
import { duration, formatValue } from "../../lib/format";
import type { LawRule, LawView } from "../../lib/operator-api";
import { hasWords, words } from "../../lib/words";

/**
 * Why a climate relay is on or off, in the law's words (screens section 10.1, row 1): which rule of the law drives it,
 * and whether that rule asks for it, waits out a minimum on or off time, or is held off. Every fact is API-30's: the
 * rules a relay serves come from each rule's `relays`, never from a table here, and a hold is only the one the host
 * can prove (`LawRule.hold`). Fog's hold comes from API-13's `fog_block_reason`, in words.
 */

/** The six climate relays in their fixed order (fog is also water line L11). */
export const CLIMATE_RELAYS = ["heat1", "heat2", "fan1", "fan2", "vent", "fog"] as const;
export type ClimateRelay = (typeof CLIMATE_RELAYS)[number];

export type WhyStatus = "asked" | "waiting" | "held" | "finishing" | "idle" | "unasked" | "unknown";
export type RelayWhy = {
  readonly status: WhyStatus;
  /** One sentence: what the law is doing with this relay and why. */
  readonly text: string;
  /** The rule the sentence names, for the link to Climate; null when none. */
  readonly rule: LawRule["id"] | null;
  /** A hold the controller reports in words (fog only), as its own sentence. */
  readonly hold: string | null;
};

/** The status word beside each sentence, in the vocabulary of words.md section 2. */
export const WHY_STATUS_WORDS: Readonly<Record<WhyStatus, string>> = {
  asked: "Asked for",
  waiting: "Waiting",
  held: "Held off",
  finishing: "Finishing",
  idle: "Not needed",
  unasked: "Not asked for",
  unknown: "Not reported",
};
/** Status colours mean state (design system section 1): a request the relay follows is ok, one it cannot follow yet warn. */
export const WHY_STATUS_TONE: Readonly<Record<WhyStatus, BadgeStatus>> = {
  asked: "ok", waiting: "warn", held: "warn", finishing: "neutral", idle: "neutral", unasked: "info", unknown: "neutral",
};

/** The block codes that hold nothing back: fogging now, or nothing holding it. */
const NOT_HELD = new Set(["none", "served"]);

/** The rules that drive `equipment`, in the law's fixed order. */
export function rulesFor(equipment: string, rules: readonly LawRule[]): LawRule[] {
  return rules.filter((rule) => rule.relays.some((relay) => relay.equipment === equipment));
}

/** A rule's name mid-sentence: "electric heat", "the hot limit". */
export function ruleName(id: string): string {
  const name = words("law_rule", id);
  const lower = hasWords("law_rule", id) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
  return id === "hot_limit" || id === "cold_limit" ? `the ${lower}` : lower;
}
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const unitOf = (rule: LawRule) => (rule.signal === "vpd" ? "kPa" : "°F");

/** "Electric heat turns on below 64.7 °F." The rule's threshold, or its name alone while the threshold is unknown. */
export function thresholdWords(rule: LawRule): string {
  const name = capitalised(ruleName(rule.id));
  if (rule.on_at === null || rule.on_at === undefined) return `${name} decides it; its threshold is not reported.`;
  return `${name} ${words("law_direction", rule.direction)} ${formatValue(rule.on_at, unitOf(rule))}.`;
}

/** A block reason as a held-off sentence: "Held off: too close to the dew point." Null when nothing holds it. */
export function holdWords(family: "fog_block_reason" | "moisture_block_reason", code: string | null | undefined): string | null {
  if (!code || NOT_HELD.has(code)) return null;
  const text = words(family, code);
  return `Held off: ${hasWords(family, code) ? text.charAt(0).toLowerCase() + text.slice(1) : text}.`;
}

/**
 * Why `equipment` is in `state`, from the law. While the law is not reporting nothing is said but that. A rule that asks
 * for the relay wins: it runs, waits out its minimum off time, or (fog) is held off by its block reason. With no rule
 * asking, a relay inside its minimum on time is finishing it; one that is on anyway is on without a request (a run by
 * hand); one that is off is not needed, and the sentence names the threshold of the first rule that drives it.
 */
export function relayWhy(equipment: string, state: string, law: LawView | null | undefined, block?: string | null): RelayWhy {
  const hold = equipment === "fog" ? holdWords("fog_block_reason", block) : null;
  if (!law || !law.reporting) return { status: "unknown", text: "The law is not reporting, so why is not known.", rule: null, hold };
  const rules = rulesFor(equipment, law.rules);
  if (rules.length === 0) return { status: "unknown", text: "No rule of the law drives this relay.", rule: null, hold };
  const asking = rules.find((rule) => rule.requested === true);
  if (asking) {
    const by = `Asked for by ${ruleName(asking.id)}`;
    if (asking.hold?.kind === "min_off" && state !== "on") {
      return { status: "waiting", text: `${by}; ${words("law_hold", "min_off")}, ${duration(asking.hold.remaining_s)} left.`, rule: asking.id, hold };
    }
    if (state === "off") {
      return hold ? { status: "held", text: `${by}, and held off.`, rule: asking.id, hold } : { status: "asked", text: `${by}; not on yet.`, rule: asking.id, hold };
    }
    return { status: "asked", text: `${by}.`, rule: asking.id, hold };
  }
  if (rules.every((rule) => rule.requested === null || rule.requested === undefined)) {
    return { status: "unknown", text: "The law has not said whether it asks for this relay.", rule: null, hold };
  }
  const finishing = rules.find((rule) => rule.hold?.kind === "min_on");
  if (finishing && state === "on") {
    return { status: "finishing", text: `Nothing asks for it now; ${words("law_hold", "min_on")}, ${duration(finishing.hold!.remaining_s)} left.`, rule: finishing.id, hold };
  }
  if (state === "on") return { status: "unasked", text: "On, and no rule of the law asks for it now: a run by hand starts it this way.", rule: null, hold };
  return { status: "idle", text: `Not needed. ${thresholdWords(rules[0])}`, rule: rules[0].id, hold };
}
