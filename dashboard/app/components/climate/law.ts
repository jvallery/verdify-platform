// SPDX-License-Identifier: MIT
/**
 * Climate → Law and Drying (screens §2.1, §2.3): the pure shaping of API-30 into what the blocks say. Every code reaches
 * the page through `words()`; the few sentences here are this area's own copy (words.md §1 voice), in plain words with
 * their units. Null is "not reported", never off or 0.
 */
import { duration, formatNumber, formatValue, shortTime, unitDecimals } from "../../lib/format";
import type { LawState } from "../../lib/law-sentence";
import type { LawAlone, LawBand, LawDrying, LawRule, LawView } from "../../lib/operator-api";
import { hasWords, words } from "../../lib/words";
import { rangeWords } from "../data/band-bar";
import type { CheckMark, ChecklistItem } from "../data/checklist";

/** The unit of a rule's signal. */
export const SIGNAL_UNIT: Readonly<Record<string, string>> = { temp: "°F", vpd: "kPa" };
export const unitOf = (signal: string): string => SIGNAL_UNIT[signal] ?? "";

/** The no-break space `formatValue` puts before a unit. */
const NBSP = String.fromCharCode(0xa0);

/** "Electric heat": a sentence's first letter in capitals, for a words entry that opens a line. */
export const capital = (text: string): string => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text);

/** Seconds as "2 min 10 s" (whole seconds under a minute: "40 s"; from an hour, "1 h 5 min"), for a wait that counts down. */
export function minSec(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const part = (value: number, unit: string) => `${value}${NBSP}${unit}`;
  if (whole < 60) return part(whole, "s");
  if (whole < 3600) {
    const rest = whole % 60;
    return rest ? `${part(Math.floor(whole / 60), "min")} ${part(rest, "s")}` : part(Math.floor(whole / 60), "min");
  }
  const minutes = Math.floor((whole % 3600) / 60);
  return minutes ? `${part(Math.floor(whole / 3600), "h")} ${part(minutes, "min")}` : part(Math.floor(whole / 3600), "h");
}

/** A run time in seconds the way words.md §5 has it: minutes, hours past 90 minutes ("1 h 12 min"), "—" when unknown. */
export function runTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  return formatValue(seconds / 60, "min");
}

/** Grams of water in kilograms, as the record states water removed ("1.24 kg"); "—" when unknown. */
export const kilograms = (grams: number | null | undefined): string => (grams === null || grams === undefined ? "—" : formatValue(grams / 1000, "kg"));
/** Watt-hours of heat in kilowatt-hours ("0.4 kWh"); "—" when unknown. */
export const kilowattHours = (wattHours: number | null | undefined): string => (wattHours === null || wattHours === undefined ? "—" : formatValue(wattHours / 1000, "kWh"));

// ---------------------------------------------------------------------------------------------------- the rules
/**
 * A rule's two thresholds for the rules' table, whose header carries the unit ("On, °F"): the on value with its
 * direction ("below 67.9"), and the off value as a bare number. A limit turns off where it turns on, so both read the
 * same number. An unreported threshold reads "—".
 */
export function ruleThresholds(rule: Pick<LawRule, "signal" | "direction" | "on_at" | "off_at">): { on: string; off: string } {
  const digits = unitDecimals(unitOf(rule.signal));
  const on = rule.on_at === null || rule.on_at === undefined ? "—" : `${words("law_direction", rule.direction).replace(/^turns on /, "")} ${formatNumber(rule.on_at, digits)}`;
  const off = rule.off_at ?? rule.on_at;
  return { on, off: formatNumber(off, digits) };
}

/**
 * The relays a rule drives, grouped by state so a row stays one line: every relay in one state reads as one group
 * ("Vent, Fan 1, Fan 2" with one Off); relays in different states read as one group each.
 */
export function relayGroups(relays: readonly Pick<LawRule["relays"][number], "equipment" | "state">[]): { state: string; names: string }[] {
  const groups: { state: string; names: string[] }[] = [];
  for (const relay of relays) {
    const name = words("law_relay", relay.equipment);
    const last = groups[groups.length - 1];
    if (last && last.state === relay.state) last.names.push(name);
    else groups.push({ state: relay.state, names: [name] });
  }
  return groups.map((group) => ({ state: group.state, names: group.names.join(", ") }));
}

/** What a rule is doing, in words.md's words: Off, Wanted, Asked for, On since, Waiting (minimum off), Held on (minimum on). */
export type RuleStateKind = "off" | "wanted" | "asked" | "on" | "waiting" | "held_on" | "unknown";
export type RuleState = { readonly kind: RuleStateKind; readonly text: string; readonly since?: string | null };

/** The earliest `since` among the rule's relays that are on, or null. */
function onSince(rule: Pick<LawRule, "relays">): string | null {
  const times = rule.relays.filter((relay) => relay.state === "on" && relay.since).map((relay) => relay.since as string);
  return times.length ? times.reduce((first, time) => (Date.parse(time) < Date.parse(first) ? time : first)) : null;
}

/**
 * The rule's state from its latch, its request, its relays and the hold the host can prove (api.md LawRule): a hold
 * first, since it says why a relay disagrees with the law; then asked for and running ("On since 09:12"), asked for and
 * not yet running, wanted but not asked for (another rule or a gate wins), and off. Unknown when the record is missing.
 */
export function ruleState(rule: Pick<LawRule, "latched" | "requested" | "relays" | "hold">): RuleState {
  if (rule.hold && rule.hold.kind === "min_off") return { kind: "waiting", text: `Waiting ${minSec(rule.hold.remaining_s)} (minimum off time)` };
  if (rule.hold && rule.hold.kind === "min_on") return { kind: "held_on", text: `Held on ${minSec(rule.hold.remaining_s)} (minimum on time)` };
  if (rule.requested === null || rule.requested === undefined) return { kind: "unknown", text: "Not reported" };
  if (rule.requested) {
    const since = onSince(rule);
    if (since) return { kind: "on", text: `On since ${shortTime(since)}`, since };
    if (rule.relays.some((relay) => relay.state === "on")) return { kind: "on", text: "On" };
    return { kind: "asked", text: "Asked for" };
  }
  if (rule.latched) return { kind: "wanted", text: "Wanted" };
  if (rule.latched === null || rule.latched === undefined) return { kind: "unknown", text: "Not reported" };
  return { kind: "off", text: "Off" };
}

/** The rules of one signal, in the API's fixed order. */
export const rulesOf = (rules: readonly LawRule[], signal: "temp" | "vpd"): LawRule[] => rules.filter((rule) => rule.signal === signal);

// ---------------------------------------------------------------------------------------------------- the drying decision
/** The verdict words of screens §2.1 block 3 and §2.3 block 1: Running, Refused: <reason>, Not wanted. */
export function dryingVerdict(drying: Pick<LawDrying, "state" | "refused_reason">): string {
  const verdict = words("drying_verdict", hasWords("drying_verdict", drying.state) ? drying.state : "unknown");
  const reason = drying.refused_reason && drying.refused_reason !== "none" ? words("drying_refusal", drying.refused_reason) : null;
  return drying.state === "refused" && reason ? `${verdict}: ${reason}` : verdict;
}
/** The verdict's status: running ok, refused warn, the rest neutral. */
export const verdictTone = (state: string): "ok" | "warn" | "neutral" => (state === "running" ? "ok" : state === "refused" ? "warn" : "neutral");

const mark = (ok: boolean | null | undefined): CheckMark => (ok === true ? "met" : ok === false ? "unmet" : "unknown");

/** The evidence beside each check, from the readings and thresholds API-30 serves; null where there is nothing to add. */
function checkDetail(id: string, view: Pick<LawView, "inputs" | "drying">): string | null {
  const { inputs, drying } = view;
  switch (id) {
    case "humid":
      return drying.wanted_below_kpa === null ? null : `VPD ${formatValue(inputs.vpd_kpa, "kPa")}; drying is wanted below ${formatValue(drying.wanted_below_kpa, "kPa")} and stops above ${formatValue(drying.stop_above_kpa, "kPa")}.`;
    case "outdoor_drier":
      if (inputs.outdoor.source === "none") return "No outdoor reading.";
      return `Dew point outdoors ${formatValue(inputs.outdoor.dew_point_f, "°F")}, indoors ${formatValue(inputs.dew_point_f, "°F")}.`;
    case "worth_it":
      if (drying.cost_kwh_per_kg === null) return `No price without an outdoor reading; the limit is ${formatValue(drying.limit_kwh_per_kg, "kWh/kg")}.`;
      return `Price ${formatValue(drying.cost_kwh_per_kg, "kWh/kg")}, limit ${formatValue(drying.limit_kwh_per_kg, "kWh/kg")}.`;
    case "warm_enough":
      return drying.min_temp_f === null ? null : `${formatValue(inputs.temp_f, "°F")}; venting needs at least ${formatValue(drying.min_temp_f, "°F")}.`;
    default:
      return null;
  }
}

/** The drying decision as a checklist in the law's order (screens §2.1 block 3), each check with its evidence. */
export function dryingChecks(view: Pick<LawView, "inputs" | "drying">): ChecklistItem[] {
  return view.drying.checks.map((check) => ({
    key: check.id, mark: mark(check.ok), statement: capital(words("drying_check", check.id)), detail: checkDetail(check.id, view) ?? undefined,
  }));
}

// ---------------------------------------------------------------------------------------------------- the band in force
/** "61.5–70.0 °F" for a low and a high; "—" when either is missing. */
export function edgesText(low: number | null | undefined, high: number | null | undefined, unit: string): string {
  if (low === null || low === undefined || high === null || high === undefined) return "—";
  return rangeWords(low, high, unit);
}

/** Where the band came from, in a sentence (words.md: band in force, widest safe band, repaired band). */
export function bandSourceSentence(band: Pick<LawBand, "source">): string {
  if (band.source === null || band.source === undefined) return "Where the band comes from is not reported.";
  return `From ${words("band_source", band.source)}.`;
}
export function repairedSentence(band: Pick<LawBand, "repaired">): string {
  if (band.repaired === null || band.repaired === undefined) return "Whether its band check changed the band is not reported.";
  return band.repaired ? "The controller's band check repaired the band it received." : "The controller's band check left the band as received.";
}
export function hostSentence(band: Pick<LawBand, "host" | "differs">): string {
  if (!band.host || band.differs === null || band.differs === undefined) return "The host's band for this minute is not known.";
  return band.differs ? "The host's band for this minute differs:" : "The host's band for this minute is the same.";
}

// ---------------------------------------------------------------------------------------------------- running alone
/**
 * Running alone (screens §2.1 block 5, words.md): clock, probes, host and gap log, each with what the controller does
 * instead when it fails.
 */
export function aloneChecks(alone: LawAlone): ChecklistItem[] {
  const { clock, probes, host, gap_log: gapLog } = alone;
  const probesOk = probes.active === null || probes.active === undefined ? null : probes.active > 0 && probes.degraded !== true;
  return [
    {
      key: "clock", mark: mark(clock.valid), statement: "The clock is set",
      detail: clock.valid === false ? "Without a clock the controller holds the widest safe band: the lowest low and the highest high of the day."
        : clock.sync_age_s !== null && clock.sync_age_s !== undefined ? `Last synced ${duration(clock.sync_age_s)} ago.` : undefined,
    },
    {
      key: "probes", mark: mark(probesOk), statement: "The probes are answering",
      detail: probes.active === null || probes.active === undefined ? undefined
        : probes.active === 0 ? "With no indoor probe the controller acts on the outdoor air: the vent and one fan when it is warm enough outside, else electric heat."
        : `${probes.active} ${probes.active === 1 ? "probe" : "probes"} answering${probes.degraded ? "; fewer than usual, so the house reading leans on the ones left." : "."}`,
    },
    {
      key: "host", mark: mark(host.connected), statement: "The host is connected",
      detail: host.connected === false ? "The controller keeps holding the band on its own and keeps a record for the host to replay."
        : host.heartbeat_age_s !== null && host.heartbeat_age_s !== undefined ? `Heartbeat ${duration(host.heartbeat_age_s)} ago.` : undefined,
    },
    {
      key: "gap_log", mark: gapLog === null || gapLog === undefined ? "unknown" : gapLog === "armed" ? "met" : "unmet", statement: "The gap log is armed",
      detail: gapLog === null || gapLog === undefined ? undefined
        : gapLog === "armed" ? capital(`${words("gap_log", gapLog)}.`) : `${capital(words("gap_log", gapLog))}: a disconnect now would lose what happens until the host returns.`,
    },
  ];
}

// ---------------------------------------------------------------------------------------------------- the answer (A4)
/** The law record's request code of each rule (API-02 `law.requests`), where it differs from the rule's id. */
const REQUEST_OF_RULE: Readonly<Record<string, string>> = { second_fan: "fan2", hot_limit: "hot", cold_limit: "cold" };

/**
 * API-30 as the law record Now's controller sentence reads (`lib/law-sentence.ts`, API-02 `law`), so Climate law opens
 * with the same sentence from its own read: each rule asked for is a request under its code, with the relays it drives;
 * the drying decision, its price and limit, and the band in force. Null while the law is not reporting.
 */
export function lawStateOf(view: LawView): LawState | null {
  if (!view.reporting || !view.observed_at) return null;
  const requests = new Set<string>();
  for (const rule of view.rules) {
    if (!rule.requested) continue;
    requests.add(REQUEST_OF_RULE[rule.id] ?? rule.id);
    for (const relay of rule.relays) requests.add(relay.equipment);
  }
  const { band, drying } = view;
  const edges = band.temp_low_f !== null && band.temp_low_f !== undefined && band.temp_high_f !== null && band.temp_high_f !== undefined
    && band.vpd_low_kpa !== null && band.vpd_low_kpa !== undefined && band.vpd_high_kpa !== null && band.vpd_high_kpa !== undefined
    ? { temp_low_f: band.temp_low_f, temp_high_f: band.temp_high_f, vpd_low_kpa: band.vpd_low_kpa, vpd_high_kpa: band.vpd_high_kpa } : null;
  return {
    observed_at: view.observed_at, latches: [], requests: [...requests] as LawState["requests"],
    drying: drying.state === "running" || drying.state === "refused" ? drying.state : "not_wanted",
    drying_refused_reason: drying.refused_reason ?? null, drying_cost_kwh_per_kg: drying.cost_kwh_per_kg ?? null,
    drying_cost_limit_kwh_per_kg: drying.limit_kwh_per_kg ?? Number.NaN, band_repaired: band.repaired === true, band: edges,
  };
}

/** The climate relays that are on, each once, with the earliest time it is known to be on (for the chips and the sentence). */
export function onRelays(view: Pick<LawView, "rules">): { equipment: string; line_id: null; cause: null; since: string | null }[] {
  const on = new Map<string, string | null>();
  for (const rule of view.rules) {
    for (const relay of rule.relays) {
      if (relay.state !== "on") continue;
      const seen = on.get(relay.equipment);
      const since = relay.since ?? null;
      if (!on.has(relay.equipment) || (since && (!seen || Date.parse(since) < Date.parse(seen)))) on.set(relay.equipment, since);
    }
  }
  return [...on].map(([equipment, since]) => ({ equipment, line_id: null, cause: null, since }));
}

// ---------------------------------------------------------------------------------------------------- the page's status line
/** Whether the controller's constants match this release, in words. */
export function constantsWords(constants: Pick<LawView["constants"], "matches">): string {
  return constants.matches === true ? "its constants match this release" : constants.matches === false ? "its constants differ from this release" : "its constants are not reported";
}
