// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Record → Days (screens 6.1): the means row as stats with their change and sparkline, the days table newest first with
// today marked "so far", "partial" electricity and em dashes, each day opening Graphs; drying by day; the notes; the
// window control; and each block's loading, empty, stale and error states. Nothing here is a write control.
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderUi, text } from "../test-render";
import { DaysTable } from "./days-table";
import { DryingTable } from "./drying-table";
import { MeansRow, meanStats, nightsText } from "./means-row";
import { RECORD_NOTES, RecordNotes } from "./notes";
import { WindowControl, windowStatus } from "./record-page";
import { MEANS, dailyRecord, readOf, recordDay } from "./test-record";

afterEach(cleanup);

const tile = (key: string) => document.querySelector(`[data-mean="${key}"]`);

test("the means row: eight stats, each the served 7-day mean, its change against the 30-day mean, a 30-day sparkline", () => {
  renderUi(<MeansRow read={readOf(dailyRecord())} days={30} />);
  expect([...document.querySelectorAll(".metric-label")].map((label) => label.textContent)).toEqual([
    "Time in band", "Nights dried", "Climate starts a day", "Heater hours a day", "Electricity a day", "Gas a day, estimated", "Crop water a day", "Drying a day",
  ]);
  expect(text(tile("in-band")?.querySelector(".metric-value"))).toBe("62.4%");
  expect(text(tile("in-band")?.querySelector(".metric-delta"))).toBe(" up 2.4 pts vs 30-day mean");
  expect(text(tile("in-band")?.querySelector(".metric-meta"))).toBe("30-day mean 60.0%");
  expect(text(tile("nights")?.querySelector(".metric-value"))).toBe("2 of 7");
  expect(text(tile("nights")?.querySelector(".metric-delta"))).toBe("5 of 30 over the last 30 days");
  expect(text(tile("heater")?.querySelector(".metric-value"))).toBe("17.4 h");
  expect(text(tile("kwh")?.querySelector(".metric-delta"))).toBe(" up 0.7 kWh vs 30-day mean");
  expect(text(tile("starts")?.querySelector(".metric-delta"))).toBe("No change vs 30-day mean");
  expect(document.querySelectorAll(".metric-tile svg.spark")).toHaveLength(8);
  // The label opens the view where the figure is drawn, in the same window.
  expect(within(tile("in-band") as HTMLElement).getByRole("link", { name: "Time in band" }).getAttribute("href")).toBe("/record/compliance");
  expect(meanStats(90)[0].href).toBe("/record/compliance?days=90");
  expect(nightsText(null)).toBeNull();
  expect(nightsText({ ...MEANS, nights_dried: null })).toBeNull();
});

test("the means row's states: a skeleton per tile, the error with Retry, STALE over old values, and empty", () => {
  renderUi(<MeansRow read={readOf(null, { pending: true })} days={30} />);
  expect(document.querySelectorAll(".metric-tile[aria-busy=true]")).toHaveLength(8);
  cleanup();
  renderUi(<MeansRow read={readOf(null, { failed: true })} days={30} />);
  expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(8);
  expect(screen.getByText("Couldn't load time in band.")).toBeTruthy();
  cleanup();
  renderUi(<MeansRow read={readOf(dailyRecord(), { failed: true })} days={30} />);
  expect(document.querySelectorAll(".metric-tile [data-badge=stale]")).toHaveLength(8);
  cleanup();
  const record = dailyRecord(2);
  const blank = { ...record, means: { d7: null, d30: null }, days: record.days.map((day) => ({ ...recordDay(day.date, 0), complete: false, band: null, relays: null, climate_starts: null, energy: { kwh: null, kwh_partial: null, coverage_pct: null }, gas: { therms_est: null }, water: { total_gal: null, crop_gal: null, wetting_gal: null, house_gal: null, complete: null }, drying: null })) };
  renderUi(<MeansRow read={readOf(blank)} days={30} />);
  expect(screen.getAllByText("No record in these days")).toHaveLength(8);
});

test("the days table: newest first, today marked so far, partial electricity, em dashes, each day a link to Graphs on that day", () => {
  const record = dailyRecord();
  record.days[record.days.length - 2] = { ...record.days[record.days.length - 2], energy: { kwh: null, kwh_partial: 11.92, coverage_pct: 54 }, band: null, alerts: null };
  renderUi(<DaysTable read={readOf(record)} days={7} />);
  const table = screen.getByRole("table", { name: "The daily record, last 7 days, newest first" });
  // Two header rows: the group heads ("In band, %", "Run time, h") over their columns; units live in the heads.
  const rows = within(table).getAllByRole("row").slice(2);
  expect(rows).toHaveLength(7);
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "Day", "In band, %", "Night", "Starts", "Run time, h", "Electricity,kWh", "Gas,therms (est.)", "Water,gal", "Drying,min", "Alerts",
    "Both", "Temp", "VPD", "Heat 1", "Heat 2",
  ]);
  const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => text(cell));
  expect(text(within(rows[0]).getByRole("rowheader"))).toBe("Tue 17 Novso far");
  expect(within(rows[0]).getByRole("link").getAttribute("href")).toBe("/graphs?from=2026-11-17&to=2026-11-17");
  expect(cells(rows[0])[7]).toBe("partial");
  expect(cells(rows[1])).toEqual(["—", "—", "—", "—", "41", "0.5", "1.0", "partial", "2.50", "36", "60", "—"]);
  expect(cells(rows[2])).toEqual(["62.0", "95.0", "62.0", "–Not dried", "42", "0.5", "1.0", "25.2", "2.50", "36", "60", "1"]);
  expect(cells(rows[3])[3]).toBe("Dried");
  expect(within(rows[1]).queryByText("so far")).toBeNull();
});

test("the days table's states: skeleton, error with Retry, STALE, and empty", () => {
  renderUi(<DaysTable read={readOf(null, { pending: true })} days={30} />);
  expect(document.querySelector("[data-state=loading] .skeleton")).not.toBeNull();
  cleanup();
  renderUi(<DaysTable read={readOf(null, { failed: true })} days={30} />);
  expect(screen.getByText("Couldn't load the daily record.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  cleanup();
  renderUi(<DaysTable read={readOf(dailyRecord(), { failed: true })} days={30} />);
  expect(document.querySelector("[data-state=stale] [data-badge=stale]")).not.toBeNull();
  expect(screen.getByRole("table")).toBeTruthy();
  cleanup();
  const record = dailyRecord(1);
  renderUi(<DaysTable read={readOf({ ...record, days: [] })} days={30} />);
  expect(screen.getByText("No day in this window has a record yet.")).toBeTruthy();
});

test("drying by day: run time, runs, water, heat, the price paid, wanted, refused by reason and furnace starts; lower bounds said", () => {
  const record = dailyRecord(3);
  record.days[0] = { ...record.days[0], drying: { ...record.days[0].drying!, lower_bound: true, refused_s: null } };
  renderUi(<DryingTable read={readOf(record)} days={7} />);
  const rows = within(screen.getByRole("table", { name: "Drying per day, last 7 days, newest first" })).getAllByRole("row").slice(1);
  const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => text(cell));
  expect(cells(rows[1])).toEqual(["60", "10", "1.70", "0.9", "0.51", "120", "96", "2"]);
  expect(cells(rows[2])).toEqual(["60", "10", "≥ 1.70", "≥ 0.9", "—", "120", "—", "2"]);
  expect(screen.getAllByRole("listitem").map((item) => text(item))).toEqual([
    "Tue 17 Nov: the house is too cold to vent 88 min; costs more than the limit 8 min.",
    "Mon 16 Nov: the house is too cold to vent 88 min; costs more than the limit 8 min.",
  ]);
  expect(screen.getByText(/≥ marks a lower bound/)).toBeTruthy();
  cleanup();
  // Only the days drying ran or was wanted are listed; the rest are one sentence.
  const quiet = dailyRecord(3);
  quiet.days[0] = { ...quiet.days[0], drying: { ...quiet.days[0].drying!, seconds: 0, runs: 0, wanted_s: 0, refused_s: null } };
  renderUi(<DryingTable read={readOf(quiet)} days={7} />);
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3);
  expect(screen.getByText("No drying was wanted on the other day.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Drying" }).getAttribute("href")).toBe("/climate/drying");
});

test("the notes say what each figure counts, in plain words with no retired word", () => {
  renderUi(<RecordNotes />);
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([...RECORD_NOTES]);
  expect(RECORD_NOTES.join(" ")).not.toMatch(/\b(plan|planner|waypoint|mode|target|tunable|scorecard|setpoint)\b/i);
  expect(RECORD_NOTES.some((note) => note.includes("estimated from the furnace's run time"))).toBe(true);
});

test("the window control: 7, 30, 90 and 365 days as links that keep the view; the status names the window", () => {
  renderUi(<WindowControl days={90} />);
  const group = screen.getByRole("list", { name: "Days shown" });
  const links = within(group).getAllByRole("link");
  expect(links.map((link) => text(link))).toEqual(["7 d", "30 d", "90 d", "365 d"]);
  expect(links.map((link) => link.getAttribute("href"))).toEqual(["/?days=7", "/", "/?days=90", "/?days=365"]);
  expect(links[2].getAttribute("aria-current")).toBe("page");
  const status = windowStatus(dailyRecord(), 30);
  expect(status.long).toBe("Last 30 days, Mon 19 Oct to Tue 17 Nov, today so far");
  expect(status.short).toBe("30 days to Tue 17 Nov");
});
