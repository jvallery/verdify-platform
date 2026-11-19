// SPDX-License-Identifier: MIT
// What ran on Now's Today: four rows from the law's request lanes, each the union of its lanes, on before unknown before
// off, a gap in the record unknown and never off.
import { expect, test } from "vitest";
import { RAN_ROWS, ranIntervals, unionIntervals, type Interval } from "./ran";

const at = (clock: string) => `2026-11-02T${clock}:00.000Z`;
const span = (start: string, end: string, state: Interval["state"]): Interval => ({ start: at(start), end: at(end), state });

test("the four rows and their lanes: heating joins both heaters, humidifying the fog and the misters", () => {
  expect(RAN_ROWS.map((row) => [row.label, row.lanes])).toEqual([
    ["Heating", ["request.heat1", "request.heat2"]], ["Cooling", ["request.cooling"]],
    ["Humidifying", ["request.fog", "request.mist"]], ["Drying", ["request.drying"]],
  ]);
});

test("the union: on wins over unknown, unknown over off; touching stretches of one state merge; nothing covered reads unknown", () => {
  const heat1 = [span("10:00", "11:00", "off"), span("11:00", "11:30", "on"), span("11:30", "12:00", "off")];
  const heat2 = [span("10:00", "10:30", "unknown"), span("10:30", "11:15", "on"), span("11:15", "11:45", "off")];
  expect(unionIntervals([heat1, heat2], at("10:00"), at("12:00"))).toEqual([
    span("10:00", "10:30", "unknown"), span("10:30", "11:30", "on"), span("11:30", "11:45", "off"), span("11:45", "12:00", "unknown"),
  ]);
  expect(unionIntervals([[]], at("10:00"), at("11:00"))).toEqual([span("10:00", "11:00", "unknown")]);
  expect(unionIntervals([heat1], at("12:00"), at("10:00"))).toEqual([]);
});

test("a row's intervals clip to the window; a lane missing from the record reads unknown throughout", () => {
  const history = { lanes: [{ group: "requests", key: "request.drying", intervals: [span("09:00", "10:30", "on"), span("10:30", "13:00", "off")] }] };
  const rows = ranIntervals(history as never, at("10:00"), at("12:00"));
  expect(rows.find(({ row }) => row.key === "drying")?.intervals).toEqual([span("10:00", "10:30", "on"), span("10:30", "12:00", "off")]);
  expect(rows.find(({ row }) => row.key === "cooling")?.intervals).toEqual([span("10:00", "12:00", "unknown")]);
  expect(ranIntervals(null, at("10:00"), at("12:00")).every(({ intervals }) => intervals.length === 1 && intervals[0].state === "unknown")).toBe(true);
});
