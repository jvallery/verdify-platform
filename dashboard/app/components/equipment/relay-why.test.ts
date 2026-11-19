// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import type { LawRule, LawView } from "../../lib/operator-api";
import { CLIMATE_RELAYS, holdWords, relayWhy, ruleName, rulesFor, thresholdWords } from "./relay-why";

const NOW = "2026-11-02T17:42:00Z";
const NBSP = String.fromCharCode(0xa0);
const plain = (value: string | null) => value?.replaceAll(NBSP, " ") ?? null;
const lawOf = (name = "in-band"): LawView => fixture(name, { now: NOW })["API-30"] as LawView;
/** The law with one rule changed. */
function withRule(law: LawView, id: LawRule["id"], change: Partial<LawRule>): LawView {
  return { ...law, rules: law.rules.map((rule) => (rule.id === id ? { ...rule, ...change } : rule)) };
}

test("each climate relay names the rules that drive it from API-30, in the law's order", () => {
  const law = lawOf();
  expect(Object.fromEntries(CLIMATE_RELAYS.map((relay) => [relay, rulesFor(relay, law.rules).map((rule) => rule.id)]))).toEqual({
    heat1: ["heat1", "cold_limit"], heat2: ["heat2", "cold_limit"], fan1: ["cooling", "drying", "hot_limit"], fan2: ["second_fan", "hot_limit"],
    vent: ["cooling", "drying", "hot_limit"], fog: ["fog"],
  });
  expect([ruleName("heat1"), ruleName("hot_limit"), ruleName("brand_new")]).toEqual(["electric heat", "the hot limit", "brand_new"]);
});

test("with nothing asked for, every relay is not needed and the sentence names its first rule's threshold", () => {
  const law = lawOf();
  const why = Object.fromEntries(CLIMATE_RELAYS.map((relay) => [relay, relayWhy(relay, "off", law, relay === "fog" ? "none" : null)]));
  expect(Object.values(why).every((row) => row.status === "idle")).toBe(true);
  expect(plain(why.heat1.text)).toBe("Not needed. Electric heat turns on below 64.7 °F.");
  expect(plain(why.fan2.text)).toBe("Not needed. Second fan turns on above 71.5 °F.");
  expect(plain(why.fog.text)).toBe("Not needed. Fog turns on above 0.80 kPa.");
  expect([why.vent.rule, why.fog.hold]).toEqual(["cooling", null]);
});

test("a rule that asks for a running relay reads asked for, by that rule", () => {
  const law = lawOf("law-drying-running");
  expect(relayWhy("vent", "on", law)).toEqual({ status: "asked", text: "Asked for by drying.", rule: "drying", hold: null });
  expect(relayWhy("fan1", "on", law).text).toBe("Asked for by drying.");
});

test("asked for inside its minimum off time is waiting, with the time left; asked for and still off with no hold is not on yet", () => {
  const base = lawOf();
  const waiting = withRule(base, "heat1", { requested: true, hold: { kind: "min_off", remaining_s: 130 } });
  expect(plain(relayWhy("heat1", "off", waiting).text)).toBe("Asked for by electric heat; waiting out its minimum off time, 2 min left.");
  expect(relayWhy("heat1", "off", waiting).status).toBe("waiting");
  expect(relayWhy("heat1", "off", withRule(base, "heat1", { requested: true })).text).toBe("Asked for by electric heat; not on yet.");
});

test("fog asked for and off is held off by its block reason, in words; a block reason shows as its own sentence", () => {
  const law = withRule(lawOf(), "fog", { requested: true });
  expect(relayWhy("fog", "off", law, "dew_margin")).toEqual({ status: "held", text: "Asked for by fog, and held off.", rule: "fog", hold: "Held off: too close to the dew point." });
  expect(holdWords("fog_block_reason", "served")).toBeNull();
  expect(holdWords("moisture_block_reason", "brand_new_code")).toBe("Held off: brand_new_code.");
});

test("a relay on with nothing asking reads finishing inside its minimum on time, else on without a request", () => {
  const base = lawOf();
  const finishing = withRule(base, "second_fan", { hold: { kind: "min_on", remaining_s: 45 } });
  expect(plain(relayWhy("fan2", "on", finishing).text)).toBe("Nothing asks for it now; finishing its minimum on time, 45 s left.");
  expect(relayWhy("fan2", "on", base).status).toBe("unasked");
});

test("with the law not reporting, or with no request known, why is not known; a rule with no threshold says so", () => {
  expect(relayWhy("heat1", "off", null).status).toBe("unknown");
  expect(relayWhy("heat1", "off", { ...lawOf(), reporting: false }).text).toBe("The law is not reporting, so why is not known.");
  expect(relayWhy("heat1", "off", withRule(withRule(lawOf(), "heat1", { requested: null }), "cold_limit", { requested: null })).status).toBe("unknown");
  expect(relayWhy("pump", "off", lawOf()).text).toBe("No rule of the law drives this relay.");
  const heat1 = lawOf().rules[0];
  expect(thresholdWords({ ...heat1, on_at: null })).toBe("Electric heat decides it; its threshold is not reported.");
});
