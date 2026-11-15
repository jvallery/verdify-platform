// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { scheduleOverview } from "./overview";

test("routine rules, conditional windows and actual planned starts are distinct", () => {
  const agenda = {
    schedules: [{ slot_id: 1, enabled: true, degraded_only: false }, { slot_id: 2, enabled: true, degraded_only: true }, { slot_id: 3, enabled: false, degraded_only: false }],
    occurrences: [
      { slot_id: 2, line_id: "L04", status: "planned", planned_start: "2026-11-15T14:00:00Z" },
      { slot_id: 3, line_id: "L05", status: "planned", planned_start: "2026-11-15T14:01:00Z" },
      { slot_id: 1, line_id: "L01", status: "blocked", planned_start: "2026-11-15T14:02:00Z" },
      { slot_id: 1, line_id: "L01", status: "planned", planned_start: "2026-11-15T15:00:00Z" },
    ],
  } satisfies Parameters<typeof scheduleOverview>[0];
  const summary = scheduleOverview(agenda, "2026-11-15", Date.parse("2026-11-15T13:00:00Z"));
  expect(summary).toMatchObject({ routine: 1, backup: 1, disabled: 1, next: { slot_id: 1, planned_start: "2026-11-15T15:00:00Z" } });
  expect(scheduleOverview(agenda, "2026-11-16", Date.parse("2026-11-15T13:00:00Z")).next).toBeNull();
  expect(scheduleOverview(agenda, "2026-11-15", Date.parse("2026-11-15T16:00:00Z")).next).toBeNull();
});
