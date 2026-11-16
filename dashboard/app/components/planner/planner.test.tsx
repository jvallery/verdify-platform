// SPDX-License-Identifier: MIT
// The Planner section's history words (#1361). The study's pages, controls and calendar retired with the planner's
// write role (climate refactor 4.2).
import { expect, test } from "vitest";
import { confirmedShare, historyDays, historySentence, historyTotals, plannerHref, triggerMix } from "../../lib/planner";

test("history: window, redirect, totals and words", () => {
  expect(historyDays(new URLSearchParams("days=90"))).toBe(90);
  expect(historyDays(new URLSearchParams("days=7"))).toBe(30);
  expect(plannerHref("https://dashboard.verdify.ai/planner?x=1")).toBe("/plan?x=1");
  expect(triggerMix({ DEVIATION: 2, SUNSET: 1, MIDNIGHT: 1 })).toBe("MIDNIGHT, SUNSET, DEVIATION ×2");
  expect(confirmedShare({ changes_dispatched: 4, changes_confirmed: 3 })).toBe("75%");
  expect(confirmedShare({ changes_dispatched: 0, changes_confirmed: 0 })).toBe("—");
  const base = { plans_written: 3, triggers: {}, params_dispatched: 0, changes_dispatched: 0, changes_confirmed: 0, required_due: 3, required_written: 3, required_failed: 0, required_late: 0, cost: null };
  const totals = historyTotals([{ ...base, date: "2026-11-04" }, { ...base, date: "2026-11-05", required_written: 2, required_failed: 1, changes_dispatched: 5 }]);
  expect(historySentence(totals)).toBe("5 of 6 required plans written · 1 failed · 6 plans in all · changes reached the controller on 1 of 2 days");
});
