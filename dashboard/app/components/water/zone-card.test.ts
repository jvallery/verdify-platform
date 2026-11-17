// SPDX-License-Identifier: MIT
/** The zone card's pure parts (design review C2): a row's short name inside its zone, a reserved zone, a strip worth drawing. */
import { expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import type { IrrigationStatus } from "../../lib/operator-api";
import { lineShortName, reservedZone, stripHasDay } from "./zone-card";

const NOW = Date.parse("2026-11-02T17:42:00Z");
const status = (name = "in-band") => fixture(name, { now: NOW })["API-IRR-01"] as IrrigationStatus;
const line = (from: IrrigationStatus, id: string) => from.lines.find((item) => item.line_id === id)!;

test("a row reads Clean line or Fertilized line under the zone that names its physical line; fog reads Fog line", () => {
  const from = status();
  expect(lineShortName(line(from, "L01"), "Wall drip")).toBe("Clean line");
  expect(lineShortName(line(from, "L02"), "Wall drip")).toBe("Fertilized line");
  expect(lineShortName(line(from, "L11"), "Fog")).toBe("Fog line");
  expect(lineShortName(line(from, "L04"), "Some other zone")).toBe("Center mister");
});

test("a zone is reserved only while every line is reserved, off and not running", () => {
  const from = status("reserved-lines");
  const center = [line(from, "L05"), line(from, "L06")];
  expect(reservedZone(center)).toBe(true);
  expect(reservedZone([{ ...center[0], enabled: true }, center[1]])).toBe(false);
  expect(reservedZone([line(from, "L01")])).toBe(false);
  expect(reservedZone([])).toBe(false);
});

test("a strip is drawn only with a run today or the valve open today", () => {
  expect(stripHasDay(undefined)).toBe(false);
  expect(stripHasDay({ blocks: [], episodes: [] })).toBe(false);
  expect(stripHasDay({ blocks: [{ part: "run" }], episodes: [] })).toBe(true);
  expect(stripHasDay({ blocks: [{ part: "prewet" as never }], episodes: [] })).toBe(false);
  expect(stripHasDay({ blocks: [], episodes: [{}] })).toBe(true);
});
