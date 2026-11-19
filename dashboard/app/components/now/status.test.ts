// SPDX-License-Identifier: MIT
// Now's shared phrases (dashboard v2 screens §1): occupancy, and the line helpers the water card and the controller
// block share; deviceUnknown follows the answer's rows 1 to 3.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import { nowAnswer } from "../../lib/now-answer";
import { parseIrrigationStatus, parseNow, type IrrigationStatus } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { deviceUnknown, lineName, lineStatesUnknown, occupancyText } from "./status";

const NOW = Date.parse("2026-11-02T17:42:00Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

const plain = (value: string) => value.replaceAll(String.fromCharCode(0xa0), " ");
const iso = (ms: number) => new Date(ms).toISOString();
const nowOf = (names: string | string[]) => parseNow(fixture(names, { now: NOW })["API-02"])!;
const statusOf = (names: string | string[]): IrrigationStatus => parseIrrigationStatus(fixture(names, { now: NOW })["API-IRR-01"])!;
const read = <T,>(data: T | null, failed = false): PanelRead<T> => ({ data, failed, pending: data === null && !failed, retry: vi.fn() });

test("occupancy: someone inside, nobody seen, unknown, the hold off, and unknown while API-IRR-01 fails", () => {
  expect(plain(occupancyText(read(statusOf("occupied")), NOW))).toBe("Someone inside: misters wait (Frigate, 4 min ago)");
  expect(occupancyText(read(statusOf("in-band")), NOW)).toBe("Nobody seen: misters may run (last person 05:10)");
  expect(occupancyText(read(statusOf("occupancy-unknown")), NOW)).toBe("Occupancy unknown: misters may run");
  expect(occupancyText(read(statusOf(["occupied", "occupancy-hold-off"])), NOW)).toBe("Occupancy mist hold is off: misters may run");
  expect(occupancyText(read(statusOf("in-band"), true), NOW)).toBe("Occupancy unknown");
  expect(occupancyText(read<IrrigationStatus>(null), NOW)).toBe("Occupancy unknown");
  const older = statusOf("in-band");
  expect(occupancyText(read({ ...older, occupancy: { ...older.occupancy, seen_at: iso(NOW - 3 * 86_400_000) } }), NOW)).toBe("Nobody seen: misters may run (last person Oct 30, 11:42)");
});

test("lines: the plain name from the relay, the states unknown only from the API, never from an age before the firmware", () => {
  const lines = statusOf("in-band").lines;
  expect([lineName(lines[0]), lineName(lines[3]), lineName({ line_id: "L99", name: "Hose bib" })]).toEqual(["Wall drip", "Center mister", "Hose bib"]);
  expect(lineStatesUnknown(statusOf("in-band"))).toBe(false);
  expect(lineStatesUnknown(statusOf("controller-not-reporting"))).toBe(true);
  const before = statusOf("before-engine");
  expect(lineStatesUnknown({ ...before, freshness: { observed_at: null, age_s: null, stale: true } })).toBe(false);
});

test("the equipment state is unknown on the answer's rows 1 to 3 only", () => {
  expect(deviceUnknown(nowAnswer({ now: nowOf("controller-not-reporting"), failed: false }))).toBe(true);
  expect(deviceUnknown(nowAnswer({ now: nowOf("in-band"), failed: true }))).toBe(true);
  expect(deviceUnknown(nowAnswer({ now: nowOf("in-band"), failed: false }))).toBe(false);
});
