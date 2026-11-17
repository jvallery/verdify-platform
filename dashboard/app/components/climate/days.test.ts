// SPDX-License-Identifier: MIT
// Drying by day: API-32's drying record per day as bars and the refusal stack; gaps stay gaps, today is "so far".
import { expect, test } from "vitest";
import type { RecordDay, RecordDrying } from "../../lib/operator-api";
import { words } from "../../lib/words";
import { LOWER_BOUND, SO_FAR, dryingBars, hoursOf, pricePaidOf, refusalDays, refusalParts, waterKgOf } from "./days";

const drying = (over: Partial<RecordDrying> = {}): RecordDrying => ({
  seconds: 3600, runs: 2, furnace_starts_after: 1, water_g: 1000, heat_wh: 700, lower_bound: false, wanted_s: 5400, refused_s: { cost: 1800 }, ...over,
});
const day = (date: string, value: RecordDrying | null, complete = true) => ({ date, complete, drying: value }) as unknown as RecordDay;

test("each measure per day; no drying record is a gap, never a zero", () => {
  const days = [day("2026-10-31", drying()), day("2026-11-01", null), day("2026-11-02", drying({ seconds: 1800, water_g: 0 }), false)];
  expect(dryingBars(days, hoursOf).map((item) => item.value)).toEqual([1, null, 0.5]);
  expect(dryingBars(days, waterKgOf).map((item) => item.value)).toEqual([1, null, 0]);
  // No water removed, no price paid.
  expect(dryingBars(days, pricePaidOf).map((item) => item.value)).toEqual([0.7, null, null]);
  expect(dryingBars(days, hoursOf)[2]).toMatchObject({ partial: true, note: SO_FAR });
  expect(dryingBars([day("2026-11-01", drying({ lower_bound: true }))], hoursOf)[0]).toMatchObject({ partial: true, note: LOWER_BOUND });
  expect(dryingBars(days, hoursOf)[0].partial).toBeUndefined();
});

test("refusal parts: only reasons some day refused for, in the fixed order, an unknown reason last", () => {
  const days = [day("2026-11-01", drying({ refused_s: { furnace: 600, cost: 1800, mystery: 60, cooling: 0 } })), day("2026-11-02", drying({ refused_s: null }))];
  const parts = refusalParts(days);
  expect(parts.map((part) => part.key)).toEqual(["cost", "furnace", "mystery"]);
  expect(parts[0]).toMatchObject({ token: "--eq-heat1" });
  expect(parts[0].label.toLowerCase()).toBe(words("drying_refusal", "cost").toLowerCase());
  expect(parts[2].token).toBe("--text-3");
  const stacked = refusalDays(days, parts);
  expect(stacked[0].values).toEqual({ cost: 0.5, furnace: 1 / 6, mystery: 1 / 60 });
  expect(stacked[1].values).toEqual({ cost: null, furnace: null, mystery: null });
});
