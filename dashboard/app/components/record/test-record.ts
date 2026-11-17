// SPDX-License-Identifier: MIT
// Test helper for Record's tests (not a test file): a daily record shaped as API-32 serves it, and reads in each state.
import type { DailyRecord, RecordDay, RecordMeans, RelayCheck } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { dateShift } from "../../lib/format";

const RELAYS = ["heat1", "heat2", "fan1", "fan2", "vent", "fog", "mister_center", "mister_south", "mister_west", "drip_wall", "drip_center"];

/** One day of the record: complete unless it is `to`; values that vary a little by `back` (days before `to`). */
export function recordDay(date: string, back: number, overrides: Partial<RecordDay> = {}): RecordDay {
  return {
    date, complete: back > 0,
    band: {
      both_pct: 60 + back, temp_pct: 95, vpd_pct: 62, both_day_pct: 80, both_night_pct: 50, temp_below_pct: 4, temp_above_pct: 1, vpd_below_pct: 37,
      vpd_above_pct: 1, graded_min: 1440, night_dryout_min: back % 2 ? 250 : 120, night_dried: back % 2 === 1, above_full_cooling_min: back === 2 ? 15 : 0,
    },
    relays: Object.fromEntries(RELAYS.map((key, index) => [key, { starts: index + back % 3, run_s: (index + 1) * 1800, repaired_runs: key === "fan1" && back === 1 ? 2 : 0 }])),
    climate_starts: 40 + back, climate_run_s: 60_000,
    energy: { kwh: 25 + back / 10, kwh_partial: 22, coverage_pct: 88 },
    gas: { therms_est: 2.5 },
    water: { total_gal: 40, crop_gal: 36, wetting_gal: 6, house_gal: 4, complete: true },
    drying: { seconds: 3600, runs: 10, furnace_starts_after: 2, water_g: 1700, heat_wh: 870, lower_bound: false, wanted_s: 7200, refused_s: { cost: 466, too_cold: 5273 } },
    counter_sample_pct: 98, alerts: { critical: 0, warning: 1, info: 0 },
    ...overrides,
  };
}

export const MEANS: RecordMeans = {
  days: 7, both_pct: 62.4, temp_pct: 96.1, vpd_pct: 64.2, nights_dried: 2, climate_starts: 41.3, climate_run_h: 16.2, heat1_run_h: 15.1, heat2_run_h: 2.3,
  kwh: 27.1, therms_est: 2.45, crop_gal: 34, drying_h: 0.6,
};
export const MEANS_30: RecordMeans = { ...MEANS, days: 30, both_pct: 60, nights_dried: 5, kwh: 26.4 };

/** A daily record whose days a test may replace one by one. */
export type TestRecord = Omit<DailyRecord, "days"> & { days: RecordDay[] };

/** `count` days ending `to` (today, so far), oldest first. */
export function dailyRecord(count = 31, to = "2026-11-17"): TestRecord {
  const days = Array.from({ length: count }, (_, index) => recordDay(dateShift(to, index - count + 1), count - 1 - index));
  // Today: so far, the meter under 70 %.
  days[count - 1] = { ...days[count - 1], energy: { kwh: null, kwh_partial: 8.25, coverage_pct: 31.9 } };
  return { from: days[0].date, to, days, means: { d7: MEANS, d30: MEANS_30 }, law_started: null, baseline: null, since_law: null, server_time: `${to}T17:42:00Z` };
}

export const RELAY_CHECK: RelayCheck = {
  days: [
    { date: "2026-11-17", comparison: "partial", boots: 2, relays: [{ equipment: "fan1", counter_starts: 4, record_starts: 4, starts_difference: 0, counter_run_s: 900, record_run_s: 900, run_s_difference: 0 }] },
    { date: "2026-11-16", comparison: "complete", boots: 0, relays: [{ equipment: "fan1", counter_starts: 7, record_starts: 10, starts_difference: -3, counter_run_s: 1801, record_run_s: 2101, run_s_difference: -300 }] },
    { date: "2026-11-15", comparison: "no_record", boots: null, relays: [] },
  ],
};

/** A read as a panel sees it. */
export function readOf<T>(data: NoInfer<T> | null, { failed = false, pending = false } = {}): PanelRead<T> {
  return { data, failed, pending, retry: () => undefined };
}
