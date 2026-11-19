// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import type { DailyRecord, IrrigationStatus, LawView, StateLanes } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { todayRecord, todayWords, lawRead, whyOf } from "./climate-relays";
import { intentWords, lightsDiffer } from "./lights-state";
import { lanesRange, laneRows } from "./relay-lanes";
import { equipmentToken, startsWords, stateWord } from "./relay-state";
import { lineNote } from "./water-relays";

const NOW = "2026-11-02T17:42:00Z";
const NBSP = String.fromCharCode(0xa0);
const answers = fixture("in-band", { now: NOW });
const read = <T>(data: T | null, failed = false): PanelRead<T> => ({ data, failed, pending: data === null && !failed, retry: () => {} }) as PanelRead<T>;

test("today so far comes from the record's open day; a missing relay is a dash, never 0", () => {
  const record = answers["API-32"] as DailyRecord;
  expect(todayRecord(record)?.complete).toBe(false);
  expect(todayWords("heat1", read(record)).replaceAll(NBSP, " ")).toMatch(/^today so far: .+ on, \d+ starts?$/);
  expect(todayWords("nothing", read(record)).replaceAll(NBSP, " ")).toBe("today so far: — on, — starts");
  expect([todayWords("heat1", read<DailyRecord>(null)), todayWords("heat1", read<DailyRecord>(null, true)), todayWords("heat1", read({ days: [] } as unknown as DailyRecord))]).toEqual([
    "today: —", "today: the daily record is not available", "today: no record yet",
  ]);
});

test("why while the law is loading or failed never borrows an old answer", () => {
  expect(whyOf("heat1", "off", lawRead(read<LawView>(null)), null).text).toBe("Reading the law.");
  expect(whyOf("heat1", "off", lawRead(read<LawView>(null, true)), null).text).toBe("The law could not be read, so why is not known.");
});

test("state words, tokens, starts, the vent's open and closed", () => {
  expect([stateWord("vent", "on"), stateWord("vent", "off"), stateWord("fan1", "on"), stateWord("fan1", "unknown")]).toEqual(["Open", "Closed", "On", "Not reported"]);
  expect([equipmentToken("heat1"), equipmentToken("grow_light_main"), equipmentToken("not_a_relay")]).toEqual(["eq-heat1", "eq-light-main", null]);
  expect([startsWords(1), startsWords(3), startsWords(null)]).toEqual(["1 start", "3 starts", "— starts"]);
});

test("lights: what the controller wants, and a difference only when both sides are known", () => {
  expect([intentWords("on"), intentWords(null)]).toEqual(["the controller wants it on", "the controller has not said what it wants"]);
  expect([lightsDiffer("on", "off"), lightsDiffer("on", "on"), lightsDiffer(null, "off"), lightsDiffer("on", "unknown")]).toEqual([true, false, false, false]);
});

test("the lanes: no intent lanes, grouped climate, water, lights, then the flags, each relay in its token", () => {
  const lanes = answers["API-05"] as StateLanes;
  const rows = laneRows(lanes, { from: 0, to: Date.parse(NOW) / 1000 });
  expect(rows.some((row) => row.key.endsWith("_intent"))).toBe(false);
  expect([...new Set(rows.map((row) => row.group))]).toEqual(["climate", "water", "light", "flag"]);
  expect(rows.find((row) => row.key === "heat1")?.token).toBe("--eq-heat1");
  expect([lanesRange("72h"), lanesRange("7d"), lanesRange(null)]).toEqual(["72h", "24h", "24h"]);
});

test("a water line's note says only paused, disabled, waiting or blocked, with its reason", () => {
  const irrigation = answers["API-IRR-01"] as IrrigationStatus;
  const disabled = irrigation.lines.find((line) => line.state.code === "disabled");
  if (disabled) expect(lineNote(irrigation, disabled.line_id)).toMatch(/^Disabled/);
  const idle = irrigation.lines.find((line) => line.state.code === "idle");
  if (idle) expect(lineNote(irrigation, idle.line_id)).toBeNull();
  expect(lineNote(null, "L01")).toBeNull();
});
