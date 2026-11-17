// SPDX-License-Identifier: MIT
// What the controller is doing (dashboard v2 screens §1 block 2) from the law's record, against production law records
// of 2026-11-16 and 17 (system_state climate_law_state: `l` latches, `o` requests, `dr`, `e`, `lim`, `b`), decoded as
// API-02 serves them, with the house readings of the same minute.
import { describe, expect, test } from "vitest";
import { words } from "./words";
import { COLD_LIMIT, HOT_LIMIT, NOT_REPORTING, dryClause, humidClause, lawSentence, refusalWords, tempClause, type LawSentenceInput, type LawState } from "./law-sentence";

const plain = (value: string) => value.replaceAll(" ", " ");
/** The live band of 2026-11-17 16:20Z: b = [67.4, 79.4, 0.81, 1.34]. */
const BAND = { temp_low_f: 67.4, temp_high_f: 79.4, vpd_low_kpa: 0.81, vpd_high_kpa: 1.34 };
/** The live record {"l":128,"o":0,"dr":"none","e":0.633,"lim":0.7,"br":0,"b":[67.4,79.4,0.81,1.34]}: only the outdoor-air latch. */
const HOLD: LawState = {
  observed_at: "2026-11-17T16:20:00Z", latches: ["air"], requests: [], drying: "not_wanted", drying_refused_reason: null,
  drying_cost_kwh_per_kg: 0.633, drying_cost_limit_kwh_per_kg: 0.7, band_repaired: false, band: BAND,
};
const record = (fields: Partial<LawState>): LawState => ({ ...HOLD, ...fields });
const on = (...equipment: string[]) => equipment.map((name) => ({ equipment: name, since: "2026-11-17T16:10:00Z" }));
const say = (input: Partial<LawSentenceInput> & Pick<LawSentenceInput, "law">) => {
  const result = lawSentence({ running: [], temp: 70.65, vpd: 0.981, ...input });
  return { ...result, sentences: result.sentences.map(plain) };
};
const text = (input: Partial<LawSentenceInput> & Pick<LawSentenceInput, "law">) => say(input).sentences.join(" ");

describe("holding", () => {
  test("the live l=128, o=0 record with nothing running: holding the band", () => {
    expect(say({ law: HOLD })).toEqual({ sentences: ["Holding the band. Nothing is running."], kind: "holding" });
  });
  test("a water line runs while the law asks for nothing: the law asks for nothing, never 'nothing is running'", () => {
    expect(text({ law: HOLD, running: on("mister_center") })).toBe("Holding the band: the law asks for nothing.");
  });
  test("a relay that is on while the law asks for nothing is explained: finishing its shortest time on, or on by hand", () => {
    expect(say({ law: HOLD, running: on("vent", "fan2") }).sentences).toEqual([
      "Holding the band: the law asks for nothing.",
      "Fan 2 and the vent are still on: the law no longer asks for them, and a relay finishes its shortest time on before it stops.",
    ]);
    expect(say({ law: HOLD, running: on("fan1", "fan2", "vent"), byHand: ["fans"] }).sentences).toEqual([
      "Holding the band: the law asks for nothing.", "Fan 1, fan 2 and the vent are on by hand.",
    ]);
    // The fogger by hand while the furnace finishes its shortest time on: each relay gets its own reason.
    expect(say({ law: HOLD, running: on("fog", "heat2"), byHand: ["humidify"] }).sentences).toEqual([
      "Holding the band: the law asks for nothing.", "The fogger is on by hand.",
      "The gas furnace is still on: the law no longer asks for it, and a relay finishes its shortest time on before it stops.",
    ]);
  });
  test("a relay that came on after the law's last record (written once a minute) is not called a leftover", () => {
    const fresh = [{ equipment: "vent", since: "2026-11-17T16:20:20Z" }, { equipment: "fan2", since: "2026-11-17T16:20:21Z" }];
    expect(say({ law: HOLD, running: fresh }).sentences).toEqual([
      "Holding the band: the law asks for nothing.", "Fan 2 and the vent came on after the law's last record; its next record will show why.",
    ]);
  });
  test("the live 2026-11-17 17:58Z state: heat asked for, the vent and fan 2 finishing a drying run that just ended", () => {
    expect(say({ law: record({ latches: ["h1", "air"], requests: ["heat1"] }), running: on("fan2", "vent", "heat1", "grow_light_main"), temp: 74.5 }).sentences).toEqual([
      "Electric heat is on: the house is within 7.1 °F of the low edge.",
      "Fan 2 and the vent are still on: the law no longer asks for them, and a relay finishes its shortest time on before it stops.",
    ]);
    expect(text({ law: record({ requests: ["fog"], latches: ["wet"] }), running: on("fog", "heat1"), vpd: 1.3 }))
      .toBe("Fogging: VPD is within 0.04 kPa of the high edge. Electric heat is still on: the law no longer asks for it, and a relay finishes its shortest time on before it stops.");
  });
});

describe("each heater", () => {
  test("l=129 (air, h1), o=heat1: electric heat with its distance to the low edge", () => {
    expect(say({ law: record({ latches: ["h1", "air"], requests: ["heat1"] }), running: on("heat1"), temp: 70.9 }))
      .toEqual({ sentences: ["Electric heat is on: the house is within 3.5 °F of the low edge."], kind: "acting" });
  });
  test("o=heat2 alone: the gas furnace, below the low edge", () => {
    expect(text({ law: record({ latches: ["h1", "h2", "air"], requests: ["heat2"] }), running: on("heat2"), temp: 67.1 })).toBe("The gas furnace is on: the house is 0.3 °F below the low edge.");
  });
  test("l=131 (air, h1, h2), o=heat1+heat2: both heaters", () => {
    expect(text({ law: record({ latches: ["h1", "h2", "air"], requests: ["heat1", "heat2"] }), running: on("heat1", "heat2"), temp: 67.6 }))
      .toBe("Electric heat and the gas furnace are on: the house is within 0.2 °F of the low edge.");
  });
  test("a heater asked for whose relay waits out its minimum off time: asked for, not on yet", () => {
    expect(text({ law: record({ latches: ["h1", "h2", "air"], requests: ["heat1", "heat2"] }), running: on("heat1"), temp: 67.6 }))
      .toBe("Electric heat is on and the gas furnace is asked for, not on yet: the house is within 0.2 °F of the low edge.");
  });
  test("no temperature reading: the heater without a distance", () => {
    expect(text({ law: record({ requests: ["heat1"] }), running: on("heat1"), temp: null })).toBe("Electric heat is on.");
  });
});

describe("cooling", () => {
  test("one fan, above the high edge", () => {
    expect(text({ law: record({ latches: ["cool", "air"], requests: ["vent", "fan1", "cooling"] }), running: on("vent", "fan1"), temp: 80.8 }))
      .toBe("Venting with one fan to cool: the house is 1.4 °F above the high edge.");
  });
  test("two fans (cool2), well above the high edge", () => {
    expect(text({ law: record({ latches: ["cool", "cool2", "air"], requests: ["vent", "fan1", "fan2", "cooling"] }), running: on("vent", "fan1", "fan2"), temp: 81.3 }))
      .toBe("Venting with both fans to cool: the house is 1.9 °F above the high edge.");
  });
  test("still cooling back under the high edge", () => {
    expect(text({ law: record({ latches: ["cool"], requests: ["vent", "fan1", "cooling"] }), running: on("vent", "fan1"), temp: 78.2 }))
      .toBe("Venting with one fan to cool: the house is within 1.2 °F of the high edge.");
  });
  test("cooling with fog: one sentence each", () => {
    expect(say({ law: record({ latches: ["cool", "wet"], requests: ["vent", "fan1", "cooling", "fog"] }), running: on("vent", "fan1", "fog"), temp: 80.0, vpd: 1.52 }).sentences).toEqual([
      "Venting with one fan to cool: the house is 0.6 °F above the high edge.",
      "Fogging: the air is drier than the band allows, with VPD 0.18 kPa above the high edge.",
    ]);
  });
});

describe("fog and misters", () => {
  test("fog alone, above the high VPD edge", () => {
    expect(text({ law: record({ latches: ["wet", "air"], requests: ["fog"] }), running: on("fog"), vpd: 1.41 })).toBe("Fogging: the air is drier than the band allows, with VPD 0.07 kPa above the high edge.");
  });
  test("fog latched back under the edge", () => {
    expect(text({ law: record({ latches: ["wet"], requests: ["fog"] }), running: on("fog"), vpd: 1.3 })).toBe("Fogging: VPD is within 0.04 kPa of the high edge.");
  });
  test("misters alone: much drier", () => {
    expect(text({ law: record({ latches: ["mist"], requests: ["mist"] }), running: on("mister_center"), vpd: 1.7 }))
      .toBe("Misting: the air is much drier than the band allows, with VPD 0.36 kPa above the high edge.");
  });
  test("fog and misters together", () => {
    expect(text({ law: record({ latches: ["wet", "mist"], requests: ["fog", "mist"] }), running: on("fog"), vpd: 1.7 }))
      .toBe("Fogging and misting: the air is drier than the band allows, with VPD 0.36 kPa above the high edge.");
  });
  test("fog asked for and held: not on yet", () => {
    expect(text({ law: record({ latches: ["wet"], requests: ["fog"] }), vpd: 1.41 })).toBe("Fog is asked for, not on yet: the air is drier than the band allows, with VPD 0.07 kPa above the high edge.");
  });
});

describe("drying", () => {
  test("l=448 (dry, air, run): drying runs with its price under the limit", () => {
    expect(text({ law: record({ latches: ["dry", "air", "run"], requests: ["vent", "fan1", "drying"], drying: "running", drying_cost_kwh_per_kg: 0.52 }), running: on("vent", "fan1"), vpd: 0.79 }))
      .toBe("Drying: venting with one fan to carry moist air out at 0.52 kWh/kg, under the limit of 0.70.");
  });
  test("l=449 (h1, dry, air, run): electric heat holds the temperature while drying runs", () => {
    expect(say({ law: record({ latches: ["h1", "dry", "air", "run"], requests: ["heat1", "vent", "fan1", "drying"], drying: "running", drying_cost_kwh_per_kg: 0.41 }), running: on("heat1", "vent", "fan1"), temp: 69.2, vpd: 0.79 }).sentences)
      .toEqual(["Electric heat is on: the house is within 1.8 °F of the low edge.", "Drying: venting with one fan to carry moist air out at 0.41 kWh/kg, under the limit of 0.70."]);
  });
  test("l=193 (h1, dry, air), dr=cost: refused with both numbers", () => {
    expect(say({ law: record({ latches: ["h1", "dry", "air"], requests: ["heat1"], drying: "refused", drying_refused_reason: "cost", drying_cost_kwh_per_kg: 0.82 }), running: on("heat1"), temp: 70.1, vpd: 0.78 }).sentences)
      .toEqual(["Electric heat is on: the house is within 2.7 °F of the low edge.", "The air is more humid than the band allows, but drying is refused: it would cost 0.82 kWh/kg and the limit is 0.70."]);
  });
  test("refused for cost with no price: outdoor air is not drier", () => {
    expect(text({ law: record({ latches: ["dry"], drying: "refused", drying_refused_reason: "cost", drying_cost_kwh_per_kg: null }), vpd: 0.78 }))
      .toBe("The air is more humid than the band allows, but drying is refused: outdoor air is not drier.");
  });
  // The reasons read as the words table has them (lib/words.ts `drying_refusal`, the vocabulary lane's).
  test.each(["not_drier", "no_outdoor", "too_cold", "cooling", "furnace", "humidity_invalid", "no_temperature"])("refused for %s", (reason) => {
    expect(text({ law: record({ latches: ["dry"], drying: "refused", drying_refused_reason: reason, drying_cost_kwh_per_kg: null }), vpd: 0.83 }))
      .toBe(`VPD is within 0.02 kPa of the low edge, but drying is refused: ${words("drying_refusal", reason)}.`);
  });
  test("the reasons a grower reads", () => {
    expect(words("drying_refusal", "not_drier")).toBe("outdoor air is not drier");
    expect(words("drying_refusal", "furnace")).toBe("the gas furnace is running");
  });
  test("l=195 (h1, h2, dry, air), dr=furnace: the furnace heats and drying never runs with it", () => {
    expect(say({ law: record({ latches: ["h1", "h2", "dry", "air"], requests: ["heat1", "heat2"], drying: "refused", drying_refused_reason: "furnace", drying_cost_kwh_per_kg: 0.61 }), running: on("heat1", "heat2"), temp: 67.2, vpd: 0.7 }).sentences)
      .toEqual(["Electric heat and the gas furnace are on: the house is 0.2 °F below the low edge.", "The air is more humid than the band allows, but drying is refused: the gas furnace is running."]);
  });
  test("refused with no VPD reading", () => {
    expect(text({ law: record({ drying: "refused", drying_refused_reason: "too_cold" }), vpd: null })).toBe("Drying is wanted and refused: the house is too cold to vent.");
  });
  test("no humidity reading: drying is off and says why", () => {
    expect(text({ law: record({ latches: [], drying: "not_wanted", drying_refused_reason: "humidity_invalid" }) })).toBe(`Drying is off: ${words("drying_refusal", "humidity_invalid")}.`);
  });
});

describe("protection limits and not reporting", () => {
  test("the hot limit stands alone, whatever else is asked for", () => {
    expect(say({ law: record({ latches: ["cool", "cool2"], requests: ["vent", "fan1", "fan2", "cooling", "hot"] }), running: on("vent", "fan1", "fan2"), temp: 100.4 }))
      .toEqual({ sentences: [HOT_LIMIT], kind: "limit" });
  });
  test("the cold limit", () => {
    expect(say({ law: record({ requests: ["heat1", "heat2", "cold"] }), running: on("heat1", "heat2"), temp: 39.6 })).toEqual({ sentences: [COLD_LIMIT], kind: "limit" });
  });
  test("no law record: not reporting, never holding", () => {
    expect(say({ law: null })).toEqual({ sentences: [NOT_REPORTING], kind: "not_reporting" });
    expect(say({ law: undefined }).kind).toBe("not_reporting");
  });
});

describe("the clauses", () => {
  test("distances are rounded once and a missing number drops the clause", () => {
    expect(plain(tempClause(67.4, 67.4, "low") ?? "")).toBe("the house is at the low edge");
    expect(tempClause(null, 67.4, "low")).toBeNull();
    expect(tempClause(70, null, "high")).toBeNull();
    expect(dryClause(1.34, 1.34)).toBe("VPD is at the high edge");
    expect(humidClause(0.81, 0.81)).toBe("VPD is at the low edge");
    expect(humidClause(0.8, undefined)).toBeNull();
  });
  test("a refusal with no reason says so", () => {
    expect(refusalWords({ drying_refused_reason: null, drying_cost_kwh_per_kg: null, drying_cost_limit_kwh_per_kg: 0.7 })).toBe("the controller gave no reason");
  });
});
