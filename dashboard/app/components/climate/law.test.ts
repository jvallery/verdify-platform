// SPDX-License-Identifier: MIT
// Climate → Law's shaping (screens §2.1): each rule's sentence and state, the drying decision with its evidence, the band
// in force and running alone, against the fixture API's law (the production record moved onto the screens' clock).
import { expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import { words } from "../../lib/words";
import { parseLawView, type LawRule, type LawView } from "../../lib/operator-api";
import {
  aloneChecks, bandSourceSentence, capital, constantsWords, dryingChecks, dryingVerdict, edgesText, hostSentence, kilograms, kilowattHours, minSec,
  repairedSentence, ruleSentence, ruleState, rulesOf, runTime, verdictTone,
} from "./law";

const NOW = "2026-11-02T17:42:00Z";
const plain = (text: string) => text.replaceAll(String.fromCharCode(0xa0), " ");
function law(names: string | string[] = "in-band"): LawView {
  const view = parseLawView(fixture(names, { now: NOW })["API-30"]);
  if (!view) throw new Error("API-30 did not parse");
  return view;
}
const rule = (view: LawView, id: string) => view.rules.find((item) => item.id === id) as LawRule;

test("minSec counts a wait down in minutes and seconds; runTime reads minutes, then hours past 90 minutes", () => {
  expect(plain(minSec(40))).toBe("40 s");
  expect(plain(minSec(130))).toBe("2 min 10 s");
  expect(plain(minSec(300))).toBe("5 min");
  expect(plain(minSec(3900))).toBe("1 h 5 min");
  expect(plain(minSec(-3))).toBe("0 s");
  expect(plain(runTime(129.8))).toBe("2 min");
  expect(plain(runTime(4320))).toBe("72 min");
  expect(plain(runTime(7500))).toBe("2 h 5 min");
  expect(runTime(null)).toBe("—");
  expect(plain(kilograms(1240))).toBe("1.24 kg");
  expect(plain(kilowattHours(402))).toBe("0.4 kWh");
  expect(kilograms(null)).toBe("—");
});

test("a rule reads as one sentence from its thresholds; a limit reads only where it turns on", () => {
  const view = law();
  expect(plain(ruleSentence(rule(view, "heat1")))).toBe("turns on below 64.7 °F, off at 65.7 °F");
  expect(plain(ruleSentence(rule(view, "cooling")))).toBe("turns on above 70.0 °F, off at 68.0 °F");
  expect(plain(ruleSentence(rule(view, "drying")))).toBe("turns on below 0.50 kPa, off at 0.65 kPa");
  expect(plain(ruleSentence(rule(view, "hot_limit")))).toBe("turns on above 100.0 °F");
  expect(ruleSentence({ signal: "temp", direction: "below", on_at: null, off_at: null })).toBe("Thresholds not reported");
  expect(rulesOf(view.rules, "vpd").map((item) => item.id)).toEqual(["fog", "mist", "drying"]);
  expect(rulesOf(view.rules, "temp").map((item) => item.id)).toEqual(["heat1", "heat2", "cooling", "second_fan", "hot_limit", "cold_limit"]);
});

test("a rule's state: off, wanted, asked for, on since, waiting and held on, and unknown without a record", () => {
  const relays = (state: "on" | "off" | "unknown", since: string | null = null) => [{ equipment: "heat1", state, since }];
  expect(ruleState({ latched: false, requested: false, relays: relays("off"), hold: null })).toMatchObject({ kind: "off", text: "Off" });
  expect(ruleState({ latched: true, requested: false, relays: relays("off"), hold: null })).toMatchObject({ kind: "wanted", text: "Wanted" });
  expect(ruleState({ latched: true, requested: true, relays: relays("off"), hold: null })).toMatchObject({ kind: "asked", text: "Asked for" });
  expect(ruleState({ latched: true, requested: true, relays: relays("on", "2026-11-02T16:12:00Z"), hold: null })).toMatchObject({ kind: "on", text: "On since 09:12" });
  expect(plain(ruleState({ latched: true, requested: true, relays: relays("off"), hold: { kind: "min_off", remaining_s: 130 } }).text)).toBe("Waiting 2 min 10 s (minimum off time)");
  expect(plain(ruleState({ latched: false, requested: false, relays: relays("on"), hold: { kind: "min_on", remaining_s: 60 } }).text)).toBe("Held on 1 min (minimum on time)");
  expect(ruleState({ latched: null, requested: null, relays: relays("unknown"), hold: null })).toMatchObject({ kind: "unknown", text: "Not reported" });
  // The earliest relay that is on gives the time.
  const two = [{ equipment: "vent", state: "on" as const, since: "2026-11-02T17:00:00Z" }, { equipment: "fan1", state: "on" as const, since: "2026-11-02T16:59:00Z" }];
  expect(ruleState({ latched: true, requested: true, relays: two, hold: null }).text).toBe("On since 09:59");
  // The refused-for-cost record: electric heat on, drying wanted and not asked for.
  const refused = law("law-drying-refused-cost");
  expect(ruleState(rule(refused, "heat1")).text).toBe("On since 10:38");
  expect(ruleState(rule(refused, "drying")).kind).toBe("wanted");
});

test("the drying decision is a checklist in the law's order with its evidence, then the verdict", () => {
  const refused = law("law-drying-refused-cost");
  const items = dryingChecks(refused);
  expect(items.map((item) => item.key)).toEqual(["humid", "not_cooling", "furnace_off", "outdoor_drier", "warm_enough", "worth_it"]);
  expect(items.map((item) => item.mark)).toEqual(["met", "met", "met", "met", "met", "unmet"]);
  expect(items[0].statement).toBe("The house is humid enough to dry");
  expect(plain(String(items[5].detail))).toBe("Price 0.82 kWh/kg, limit 0.70 kWh/kg.");
  expect(plain(String(items[0].detail))).toBe("VPD 0.47 kPa; drying is wanted below 0.50 kPa and stops above 0.65 kPa.");
  expect(plain(String(items[4].detail))).toBe("64.2 °F; venting needs at least 62.7 °F.");
  expect(dryingVerdict(refused.drying)).toBe("Refused: costs more than the limit");
  expect(verdictTone(refused.drying.state)).toBe("warn");
  expect(dryingVerdict(law("law-drying-running").drying)).toBe("Running");
  expect(dryingVerdict(law().drying)).toBe("Not wanted");
  expect(dryingVerdict({ state: "unknown", refused_reason: null })).toBe("Not reported");
  // No outdoor reading: no price, and the check says so.
  const none = { ...refused, inputs: { ...refused.inputs, outdoor: { ...refused.inputs.outdoor, source: "none" } }, drying: { ...refused.drying, cost_kwh_per_kg: null } };
  const blind = dryingChecks(none);
  expect(blind[3].detail).toBe("No outdoor reading.");
  expect(plain(String(blind[5].detail))).toBe("No price without an outdoor reading; the limit is 0.70 kWh/kg.");
  expect(dryingChecks({ ...refused, drying: { ...refused.drying, checks: [{ id: "humid", ok: null }] } })[0].mark).toBe("unknown");
});

test("the band in force: the four edges, where they came from, repaired or not, and the host's difference", () => {
  const view = law();
  expect(plain(edgesText(view.band.temp_low_f, view.band.temp_high_f, "°F"))).toBe("61.2–70.0 °F");
  expect(plain(edgesText(view.band.vpd_low_kpa, view.band.vpd_high_kpa, "kPa"))).toBe("0.45–0.80 kPa");
  expect(edgesText(null, 70, "°F")).toBe("—");
  expect(bandSourceSentence(view.band)).toBe(`From ${words("band_source", "onchip_curve")}.`);
  expect(bandSourceSentence({ source: null })).toBe("Where the band comes from is not reported.");
  expect(repairedSentence(view.band)).toBe("The controller's band check left the band as received.");
  expect(hostSentence(view.band)).toBe("The host's band for this minute is the same.");
  const repaired = law("law-band-repaired");
  expect(repairedSentence(repaired.band)).toBe("The controller's band check repaired the band it received.");
  expect(hostSentence(repaired.band)).toBe("The host's band for this minute differs:");
  expect(hostSentence({ host: null, differs: null })).toBe("The host's band for this minute is not known.");
});

test("running alone: each failed row says what the controller does instead; unknown is never a failure", () => {
  const view = law();
  const fine = aloneChecks(view.alone);
  expect(fine.map((item) => [item.key, item.mark])).toEqual([["clock", "met"], ["probes", "met"], ["host", "met"], ["gap_log", "met"]]);
  expect(plain(String(fine[0].detail))).toBe("Last synced 11 min ago.");
  expect(fine[1].detail).toBe("4 probes answering.");
  const alone = aloneChecks({ clock: { valid: false, sync_age_s: null }, probes: { active: 0, degraded: true }, host: { connected: false, heartbeat_age_s: 400 }, gap_log: "nvs_full" });
  expect(alone.map((item) => item.mark)).toEqual(["unmet", "unmet", "unmet", "unmet"]);
  expect(alone[0].detail).toMatch(/widest safe band/);
  expect(alone[1].detail).toMatch(/acts on the outdoor air/);
  expect(alone[2].detail).toMatch(/keeps holding the band on its own/);
  expect(alone[3].detail).toBe("Off: storage is full: a disconnect now would lose what happens until the host returns.");
  const unknown = aloneChecks({ clock: { valid: null, sync_age_s: null }, probes: { active: null, degraded: null }, host: { connected: null, heartbeat_age_s: null }, gap_log: null });
  expect(unknown.map((item) => item.mark)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
});

test("the constants against the release, in words; capital opens a line", () => {
  expect(constantsWords({ matches: true })).toBe("its constants match this release");
  expect(constantsWords({ matches: false })).toBe("its constants differ from this release");
  expect(constantsWords({ matches: null })).toBe("its constants are not reported");
  expect(capital("electric heat")).toBe("Electric heat");
  expect(capital("")).toBe("");
});
