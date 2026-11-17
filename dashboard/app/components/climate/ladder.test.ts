// SPDX-License-Identifier: MIT
// The rule ladder's model (design system v2 §5): scale, end zones, label rows and the reading order the list keeps.
import { expect, test } from "vitest";
import { BREAK_AT, END_AT, INNER, MAX_ROWS, PAST_LIMIT, anchorAt, buildLadder, labelRows, tickText, type LadderRule } from "./ladder";

const rule = (id: string, on: number, off: number | null, direction: "below" | "above", limit = false): LadderRule => ({ id, label: id, on, off, direction, state: "off", limit });
const TEMP_RULES = [
  rule("Electric heat", 64.7, 65.7, "below"), rule("Gas furnace", 61.7, 64.2, "below"), rule("Cooling", 70, 68, "above"), rule("Second fan", 71.5, 70, "above"),
  rule("Hot limit", 100, 100, "above", true), rule("Cold limit", 40, 40, "below", true),
];

test("nothing to place is null; a tick names the rule and its on value at the unit's decimals", () => {
  expect(buildLadder({ unit: "°F", band: null, reading: null, rules: [] })).toBeNull();
  expect(tickText("Electric heat", 64.7, "°F")).toBe("Electric heat 64.7");
  expect(tickText("Fogger", 0.8, "kPa")).toBe("Fogger 0.80");
  expect([anchorAt(5), anchorAt(50), anchorAt(95)]).toEqual(["start", "middle", "end"]);
});

test("the stretch covers the band, the reading and every non-limit threshold; the limits stand in end zones with a break", () => {
  const model = buildLadder({ unit: "°F", band: { low: 61.2, high: 70 }, reading: 64.8, rules: TEMP_RULES });
  if (!model) throw new Error("no model");
  expect(model.scale.low).toBeLessThan(61.2);
  expect(model.scale.high).toBeGreaterThan(71.5);
  const at = (id: string) => model.rules.find((item) => item.id === id)?.at ?? NaN;
  for (const id of ["Electric heat", "Gas furnace", "Cooling", "Second fan"]) {
    expect(at(id)).toBeGreaterThanOrEqual(INNER.from);
    expect(at(id)).toBeLessThanOrEqual(INNER.to);
  }
  expect(at("Gas furnace")).toBeLessThan(at("Electric heat"));
  expect(at("Hot limit")).toBe(END_AT.high);
  expect(at("Cold limit")).toBe(END_AT.low);
  expect(model.breaks).toEqual({ low: true, high: true });
  expect(BREAK_AT.low).toBeGreaterThan(END_AT.low);
  expect(model.band?.from).toBeLessThan(model.band?.to ?? 0);
  expect(model.reading?.clamped).toBeNull();
  expect(model.rows).toBeGreaterThan(0);
  expect(model.rows).toBeLessThanOrEqual(MAX_ROWS);
  // The list reads low to high: the cold limit, the band's low edge, the furnace … the second fan, the hot limit.
  const order = model.entries.map((entry) => (entry.kind === "rule" ? entry.rule.id : entry.kind === "edge" ? `${entry.side} edge` : "reading"));
  expect(order).toEqual(["Cold limit", "low edge", "Gas furnace", "Electric heat", "reading", "Cooling", "high edge", "Second fan", "Hot limit"]);
});

test("the reading always widens the stretch; a limit inside the stretch is placed like any rule", () => {
  const cold = buildLadder({ unit: "°F", band: { low: 61, high: 70 }, reading: 20, rules: [rule("Electric heat", 64.7, 65.7, "below")] });
  // The reading itself widens the stretch, so it is never clamped by the band alone.
  expect(cold?.reading?.clamped).toBeNull();
  const near = buildLadder({ unit: "°F", band: { low: 61, high: 70 }, reading: 66, rules: [rule("Hot limit", 70.5, 70.5, "above", true)] });
  expect(near?.rules[0].beyond).toBe(false);
  expect(near?.breaks).toEqual({ low: false, high: false });
});

test("label rows: crowded ticks climb rows, at most three; spaced ticks share the first", () => {
  expect(labelRows([{ at: 10, text: "A 1.0" }, { at: 50, text: "B 2.0" }, { at: 90, text: "C 3.0" }])).toEqual([0, 0, 0]);
  const crowded = labelRows([{ at: 40, text: "Electric heat 64.7" }, { at: 42, text: "Gas furnace 61.7" }, { at: 44, text: "Cooling 70.0" }, { at: 46, text: "Second fan 71.5" }]);
  // Four labels that all overlap cannot fit three rows: one pair shares a row, and only one.
  expect(new Set(crowded).size).toBe(MAX_ROWS);
  expect(crowded.length - new Set(crowded).size).toBe(1);
});

test("label rows: no tick's line runs through a lower label, and two labels on one row never overlap", () => {
  // The real temperature ladder of 2026-11-17: the furnace's tick sat under the end of "Cold limit 40.0".
  const items = [{ at: 2, text: "Cold limit 40.0" }, { at: 16.2, text: "Gas furnace 71.1" }, { at: 30.6, text: "Electric heat 74.1" },
    { at: 78.8, text: "Cooling 84.0" }, { at: 86.1, text: "Second fan 85.5" }, { at: 98, text: "Hot limit 100.0" }];
  const rows = labelRows(items);
  const cold = 0, furnace = 1;
  expect(rows[cold]).toBeGreaterThan(rows[furnace]);
  // Cooling and the second fan cannot share a row.
  expect(rows[3]).not.toBe(rows[4]);
  expect(Math.max(...rows)).toBeLessThan(MAX_ROWS);
});

test("a reading past a protection limit stands in the limit's end zone instead of stretching the axis", () => {
  const model = buildLadder({ unit: "°F", band: { low: 61.2, high: 70 }, reading: 101.2, rules: TEMP_RULES });
  if (!model) throw new Error("no model");
  expect(model.scale.high).toBeLessThan(75);
  expect(model.reading).toEqual({ at: END_AT.high + PAST_LIMIT, clamped: "high" });
  expect(model.rules.find((item) => item.id === "Hot limit")?.beyond).toBe(true);
  const freezing = buildLadder({ unit: "°F", band: { low: 61.2, high: 70 }, reading: 38, rules: TEMP_RULES });
  expect(freezing?.reading).toEqual({ at: END_AT.low - PAST_LIMIT, clamped: "low" });
  // Short of the limit, the reading still stretches the axis.
  const warm = buildLadder({ unit: "°F", band: { low: 61.2, high: 70 }, reading: 80, rules: TEMP_RULES });
  expect(warm?.reading?.clamped).toBeNull();
  expect(warm?.scale.high).toBeGreaterThan(80);
});
