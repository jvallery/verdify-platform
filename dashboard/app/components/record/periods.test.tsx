// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Record → Days, before and after the law (screens 6.1 row 3, parity R-06): the change between the two served means of
// each measure, coloured only where a direction is plainly better; each period's heading and dates; the limits; and the
// block's states (hidden without a law day, a sentence when a period is missing, the table).
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { RecordMeans, RecordPeriod } from "../../lib/operator-api";
import { renderUi, text } from "../test-render";
import { MEASURES, Periods, changeTone, periodChanges, periodLength, periodLimits, periodWords, periodsView } from "./periods";
import { MEANS, dailyRecord, readOf } from "./test-record";

afterEach(cleanup);

const BEFORE: RecordMeans = { ...MEANS, days: 29, both_pct: 54.1, temp_pct: 97.6, nights_dried: 0, climate_starts: 61, kwh: 30.4, drying_h: 0.43 };
const SINCE: RecordMeans = { ...MEANS, days: 3, both_pct: 62.5, temp_pct: 94.1, nights_dried: 1, climate_starts: 77, kwh: null, drying_h: 0.88 };
const BASELINE: RecordPeriod = { from: "2026-10-17", to: "2026-11-15", excluded_days: 1, means: BEFORE };
const SINCE_LAW: RecordPeriod = { from: "2026-11-16", to: "2026-11-18", excluded_days: 0, means: SINCE };

test("the change is the later mean less the earlier, as served; a null mean is an em dash with no change; nights carry none", () => {
  const rows = periodChanges(BEFORE, SINCE);
  expect(rows.map((row) => row.key)).toEqual(MEASURES.map((measure) => measure.key));
  const row = (key: string) => rows.find((r) => r.key === key)!;
  expect([row("both").before, row("both").since, row("both").tone]).toEqual(["54.1", "62.5", "better"]);
  expect(row("both").change).toBeCloseTo(8.4, 6);
  expect(row("temp").tone).toBe("worse");
  expect([row("starts").change, row("starts").tone]).toEqual([16, "worse"]);
  expect([row("kwh").before, row("kwh").since, row("kwh").change, row("kwh").tone]).toEqual(["30.4", "—", null, "neutral"]);
  expect([row("nights").before, row("nights").since, row("nights").change]).toEqual(["0 of 29", "1 of 3", null]);
  // Drying is served in hours and shown in minutes.
  expect([row("drying").before, row("drying").since]).toEqual(["26", "53"]);
  // Run time has no plainly better direction, so it is never coloured.
  expect(row("heat1").tone).toBe("neutral");
});

test("a change is coloured only where a direction is plainly better and the change shows at its precision", () => {
  expect(changeTone(2, "up", "pts")).toBe("better");
  expect(changeTone(-2, "up", "pts")).toBe("worse");
  expect(changeTone(-3, "down", "count")).toBe("better");
  expect(changeTone(0.02, "up", "pts")).toBe("neutral");
  expect(changeTone(5, null, "kWh")).toBe("neutral");
  expect(changeTone(null, "up", "pts")).toBe("neutral");
});

test("each period's heading, dates and days counted; the limits in plain sentences", () => {
  expect(periodLength(BASELINE)).toBe(30);
  expect(periodWords(BASELINE, "before")).toEqual({ title: "30 days before the law", line: "17 Oct to 15 Nov · 29 days counted, 1 left out" });
  expect(periodWords(SINCE_LAW, "since")).toEqual({ title: "3 days since the law", line: "16 Nov to 18 Nov · 3 days counted" });
  expect(periodWords({ ...SINCE_LAW, to: "2026-11-16", means: { ...SINCE, days: 1 } }, "since")).toEqual({ title: "1 day since the law", line: "16 Nov · 1 day counted" });
  expect(periodLimits(BASELINE, SINCE_LAW)[0]).toBe("Days on which the band was edited are left out of both periods: 1 before the law and none since.");
  expect(periodLimits({ ...BASELINE, excluded_days: 0 }, SINCE_LAW)[0]).toBe("Days on which the band was edited are left out of both periods; no such day fell in either.");
  expect(periodLimits(BASELINE, SINCE_LAW).join(" ")).not.toMatch(/\b(plan|planner|waypoint|mode|target|tunable)\b/i);
});

test("the block: hidden without a law day; a sentence without a period before or a complete day since; else the table", () => {
  expect(periodsView(null)).toEqual({ kind: "hidden" });
  expect(periodsView({ law_started: null, baseline: BASELINE, since_law: SINCE_LAW })).toEqual({ kind: "hidden" });
  expect(periodsView({ law_started: "2026-11-16", baseline: null, since_law: SINCE_LAW })).toEqual({ kind: "sentence", text: "No record from before the law to compare with." });
  expect(periodsView({ law_started: "2026-11-16", baseline: BASELINE, since_law: null }))
    .toEqual({ kind: "sentence", text: "The law started on 16 Nov. The comparison appears after its first complete day." });
  expect(periodsView({ law_started: "2026-11-16", baseline: BASELINE, since_law: SINCE_LAW }).kind).toBe("compare");
});

test("renders nothing without a law day, the sentence while waiting, and the comparison table with its limits", () => {
  const { container } = renderUi(<Periods read={readOf(dailyRecord(3))} />);
  expect(container.textContent).toBe("");
  cleanup();
  renderUi(<Periods read={readOf({ ...dailyRecord(3), law_started: "2026-11-16", baseline: BASELINE })} />);
  expect(screen.getByRole("heading", { name: "Before and after the law" })).toBeTruthy();
  expect(screen.getByText("The law started on 16 Nov. The comparison appears after its first complete day.")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  cleanup();
  renderUi(<Periods read={readOf({ ...dailyRecord(3), law_started: "2026-11-16", baseline: BASELINE, since_law: SINCE_LAW })} />);
  const table = screen.getByRole("table", { name: "Means a day before the law and since, and the change" });
  expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(MEASURES.map((measure) => measure.label));
  const both = table.querySelector("[data-measure=both]")!;
  expect(text(both.querySelector(".rc-p-change"))).toBe(" up 8.4 pts vs before the law");
  expect(both.querySelector(".rc-p-change .delta")?.getAttribute("data-tone")).toBe("better");
  expect(text(table.querySelector("[data-measure=kwh] .rc-p-change"))).toBe("—");
  expect(screen.getByText("Electricity counts only days with at least 70 % meter coverage.")).toBeTruthy();
});
