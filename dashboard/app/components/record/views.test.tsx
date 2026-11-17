// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Record → In band, Equipment and Utilities (screens 6.2 to 6.4): the shaping of each chart's days (today "so far",
// partial electricity, water by use, dried nights noted), the per-relay means and the counter check, and each view's
// loading, empty, stale and error states, on uPlot's stand-in.
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, MockPlot, created, media, setTokens } from "../../charts/fixtures/uplot-mock";
import { renderUi, text } from "../test-render";
import { BAND_PARTS, BAND_SYNC, BandView, bandStackDays, barDays } from "./band-view";
import { EquipmentView, checkColumns, relayMeansRows } from "./equipment-view";
import { CLIMATE_RELAYS, WET_RELAYS } from "./record-model";
import { RELAY_CHECK, dailyRecord, readOf } from "./test-record";
import { UtilitiesView, WATER_PARTS, electricityDays, waterDays } from "./utilities-view";

vi.mock("uplot", async () => ({ default: (await import("../../charts/fixtures/uplot-mock")).MockPlot }));

beforeEach(() => {
  MockPlot.reset(); FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ narrow: false, fine: true }));
  setTokens();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style"); });
const settle = () => act(async () => { await vi.dynamicImportSettled(); });

test("in band: the served shares in, below and above for each signal, today so far; bars note dried nights", () => {
  const record = dailyRecord(3);
  expect(BAND_PARTS.map((part) => [part.key, part.token])).toEqual([["in", "--cmp-in"], ["below", "--cmp-below"], ["above", "--cmp-above"]]);
  const temp = bandStackDays(record.days, record, "temp");
  expect(temp[0]).toEqual({ date: "2026-11-15", values: { in: 95, below: 4, above: 1 } });
  expect(temp[2]).toEqual({ date: "2026-11-17", values: { in: 95, below: 4, above: 1 }, partial: true, note: "so far" });
  expect(bandStackDays([{ ...record.days[0], band: null }], record, "vpd")[0].values).toEqual({ in: null, below: null, above: null });
  const nights = barDays(record.days, record, (day) => day.band?.night_dryout_min, (day) => (day.band?.night_dried ? "night dried" : null));
  expect(nights).toEqual([
    { date: "2026-11-15", value: 120 },
    { date: "2026-11-16", value: 250, note: "night dried" },
    { date: "2026-11-17", value: 120, partial: true, note: "so far" },
  ]);
});

test("in band renders its charts on one cursor, with the served means in words", async () => {
  renderUi(<BandView read={readOf(dailyRecord())} days={30} />);
  await settle();
  // Temperature and VPD stacks, day and night, dry-out and above full cooling.
  expect(created).toHaveLength(6);
  expect(new Set(created.map((plot) => plot.opts.cursor?.sync?.key))).toEqual(new Set([BAND_SYNC]));
  expect(screen.getByRole("heading", { name: "Time in band per day" })).toBeTruthy();
  expect(text(screen.getByText(/^Temperature: 7-day mean/))).toBe("Temperature: 7-day mean 96.1% · 30-day mean 96.1%. VPD: 7-day mean 64.2% · 30-day mean 64.2%.");
  expect(text(screen.getByText(/^Nights dried:/))).toBe("Nights dried: 15 of the 30 days shown; 2 of the last 7 complete days, 5 of the last 30.");
});

test("each view's states: skeletons while loading, the error with Retry, STALE over old data, and empty", async () => {
  for (const View of [BandView, UtilitiesView]) {
    renderUi(<View read={readOf(null, { pending: true })} days={30} />);
    expect(document.querySelectorAll("[data-state=loading]").length).toBeGreaterThan(0);
    cleanup();
    renderUi(<View read={readOf(null, { failed: true })} days={30} />);
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0);
    cleanup();
    renderUi(<View read={readOf(dailyRecord(), { failed: true })} days={30} />);
    await settle();
    expect(document.querySelectorAll("[data-state=stale]").length).toBeGreaterThan(0);
    cleanup();
    const record = dailyRecord(2);
    renderUi(<View read={readOf({ ...record, days: [] })} days={30} />);
    expect(document.querySelectorAll("[data-state=empty]").length).toBeGreaterThan(0);
    cleanup();
  }
  renderUi(<EquipmentView read={readOf(null, { pending: true })} check={readOf(null, { failed: true })} days={30} />);
  expect(document.querySelectorAll("[data-state=loading]")).toHaveLength(3);
  expect(screen.getByText("Couldn't load the counter check.")).toBeTruthy();
});

test("equipment: the per-relay means, heat 1 and heat 2 run hours as served, the others from the complete days", () => {
  const record = dailyRecord();
  const rows = relayMeansRows(record, record.days.slice(-7), CLIMATE_RELAYS);
  expect(rows.map((row) => row.equipment)).toEqual(["heat1", "heat2", "fan1", "fan2", "vent", "fog"]);
  expect([rows[0].run7, rows[0].run30, rows[1].run7]).toEqual([15.1, 15.1, 2.3]);
  expect(rows[2].run7).toBeCloseTo(1.5, 6);
  expect(rows[2].repaired).toBe(2);
  expect(relayMeansRows(record, record.days, WET_RELAYS).map((row) => row.equipment)).toEqual(["mister_center", "mister_south", "mister_west", "drip_wall", "drip_center"]);
});

test("equipment renders small multiples per relay, the means table and the counter check in words", async () => {
  renderUi(<EquipmentView read={readOf(dailyRecord())} check={readOf(RELAY_CHECK)} days={7} />);
  await settle();
  // Two charts per relay: six climate relays and five wet ones.
  expect(created).toHaveLength(22);
  expect(screen.getByRole("region", { name: "Heat 1 (electric)" })).toBeTruthy();
  const means = screen.getByRole("table", { name: "Starts and run time a day per relay, 7- and 30-day means" });
  expect(within(means).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
    "Climate relays", "Heat 1 (electric)", "Heat 2 (gas)", "Fan 1", "Fan 2", "Vent", "Fog", "Misters and drip lines", "Center mister", "South mister", "West mister", "Wall drip", "Center drip",
  ]);
  const check = screen.getByRole("table", { name: "The controller's relay counters against the stored record, newest day first" });
  const rows = within(check).getAllByRole("row").slice(1);
  expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => text(cell)))).toEqual([
    ["Part of the day compared", "2", "Counters agree"],
    ["Whole day compared", "0", "Counters differ1 relayFan 1: the controller counted 3 fewer starts and 5 min less run time than the record"],
    ["No stored record", "—", "No stored record to compare"],
  ]);
  expect(checkColumns(null)[0].cell(RELAY_CHECK.days[2])).toBe("2026-11-15");
});

test("equipment on a phone: three relays a group, then \"Show N more relays\" reveals the rest", async () => {
  vi.stubGlobal("matchMedia", media({ narrow: true, fine: false }));
  renderUi(<EquipmentView read={readOf(dailyRecord())} check={readOf(RELAY_CHECK)} days={7} />);
  await settle();
  expect(screen.queryByRole("region", { name: "Fan 2" })).toBeNull();
  const more = screen.getByRole("button", { name: "Show 3 more relays" });
  expect(screen.getByRole("button", { name: "Show 2 more relays" })).toBeTruthy();
  await act(async () => { more.click(); });
  expect(screen.getByRole("region", { name: "Fan 2" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show 3 more relays" })).toBeNull();
});

test("utilities: electricity metered, a partial day lighter with its coverage, today so far; water by use; irrigation is crop less wetting", () => {
  const record = dailyRecord(3);
  record.days[1] = { ...record.days[1], energy: { kwh: null, kwh_partial: 11.92, coverage_pct: 54 }, water: { ...record.days[1].water, complete: false } };
  expect(electricityDays(record.days, record)).toEqual([
    { date: "2026-11-15", value: 25.2 },
    { date: "2026-11-16", value: 11.92, partial: true, note: "partial meter coverage" },
    { date: "2026-11-17", value: 8.25, partial: true, note: "so far" },
  ]);
  expect(WATER_PARTS.map((part) => [part.key, part.token])).toEqual([["wetting", "--eq-mister"], ["irrigation", "--eq-water"], ["house", "--c-outdoor"]]);
  expect(waterDays(record.days, record)).toEqual([
    { date: "2026-11-15", values: { wetting: 6, irrigation: 30, house: 4 } },
    { date: "2026-11-16", values: { wetting: 6, irrigation: 30, house: 4 }, partial: true, note: "water record incomplete" },
    { date: "2026-11-17", values: { wetting: 6, irrigation: 30, house: 4 }, partial: true, note: "so far" },
  ]);
});

test("utilities renders the three charts on one cursor and the table, gas labelled estimated", async () => {
  renderUi(<UtilitiesView read={readOf(dailyRecord())} days={30} />);
  await settle();
  expect(created).toHaveLength(3);
  expect(screen.getByRole("heading", { name: "Gas per day, estimated" })).toBeTruthy();
  const table = screen.getByRole("table", { name: "Electricity, gas and water per day, last 30 days, newest first" });
  // Two header rows (the electricity and water groups), then 14 of the 30 days before "Show all 30 days".
  expect(within(table).getAllByRole("row")).toHaveLength(16);
  expect(text(within(table).getAllByRole("row")[2])).toContain("partial");
  expect(screen.getByRole("button", { name: "Show all 30 days" })).toBeTruthy();
});
