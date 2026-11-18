// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// DailyBars (design system v2 §5): one measure a day from 0, a "so far" day lighter, a day with no record a hatched gap
// (never 0), the 7- and 30-day means, a threshold, the key, the tooltip, the keyboard readout, the table and the CSV.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChartGroup } from "./legend";
import { DailyBars, buildDailyBars, completeSpan, dailyBarsCsv, dailyBarsKey, dailyBarsTooltip, dailyDays } from "./daily-bars";
import { amountWords, dayAt, fitMax } from "./daily";
import { BAR_GAP, SO_FAR_ALPHA } from "./draw";
import { FakeResizeObserver, MockPlot, TOKENS, created, media, setTokens } from "./fixtures/uplot-mock";

vi.mock("uplot", async () => ({ default: (await import("./fixtures/uplot-mock")).MockPlot }));

const NBSP = "\u00a0";
const kwh = (value: string) => `${value}${NBSP}kWh`;
const settle = () => act(async () => { await vi.dynamicImportSettled(); });
const WEEK = [
  { date: "2026-11-12", value: 12 },
  { date: "2026-11-13", value: 10 },
  { date: "2026-11-14", value: null },
  { date: "2026-11-15", value: 0 },
  { date: "2026-11-16", value: 11 },
  { date: "2026-11-17", value: 4, partial: true },
];

const { createObjectURL, revokeObjectURL } = URL;
beforeEach(() => {
  MockPlot.reset(); FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ narrow: false, fine: true }));
  URL.createObjectURL = vi.fn(() => "blob:csv");
  URL.revokeObjectURL = vi.fn();
  setTokens();
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style");
  URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL;
});

test("the model: days in date order at local midnight, a missing value null (never 0), a fitted maximum from 0, the 7-day span over complete days", () => {
  const model = buildDailyBars({ title: "Electricity", unit: "kWh", days: [...WEEK].reverse(), mean7: 9.25, mean30: 10, threshold: { value: 15, label: "Budget 15 kWh", tone: "warn" } });
  expect(model.days.map((day) => [day.date, day.value])).toEqual(WEEK.map((day) => [day.date, day.value]));
  expect(model.days[0].at).toBe(Date.parse("2026-11-12T07:00:00Z") / 1000);
  expect(model.xRange).toEqual({ from: dayAt("2026-11-12") - 43_200, to: dayAt("2026-11-17") + 43_200 });
  // The threshold (15) is the peak: the axis reaches past it.
  expect(model.yMax).toBe(20);
  expect(model.thresholds).toEqual([{ value: 15, level: "warn", label: "Budget 15 kWh" }]);
  // Today is partial: the 7-day mean runs over the complete days only.
  expect(model.meanSpan).toEqual({ from: dayAt("2026-11-12") - 43_200, to: dayAt("2026-11-16") + 43_200 });
  expect(completeSpan(dailyDays([{ date: "2026-11-17", partial: true }]))).toBeNull();
  expect(buildDailyBars({ title: "x", unit: "%", days: WEEK, max: 100 }).yMax).toBe(100);
  expect([fitMax(0), fitMax(0.9), fitMax(12), fitMax(18.5), fitMax(46)]).toEqual([1, 1, 20, 25, 100]);
  expect([amountWords(1, "starts"), amountWords(12, "starts"), amountWords(null, "kWh")]).toEqual(["1 start", "12 starts", "—"]);
});

test("the tooltip: the day and its qualifier, the value or no record, and the 7-day mean", () => {
  const model = buildDailyBars({ title: "Electricity", unit: "kWh", days: WEEK, mean7: 9.25 });
  const format = (value: number) => amountWords(value, "kWh");
  expect(dailyBarsTooltip(model, 0, format)).toEqual(["Nov 12", kwh("12.0"), `7-day mean ${kwh("9.3")}`]);
  expect(dailyBarsTooltip(model, 2, format)).toEqual(["Nov 14", "no record", `7-day mean ${kwh("9.3")}`]);
  expect(dailyBarsTooltip(model, 5, format)![0]).toBe("Nov 17 · so far");
  expect(dailyBarsTooltip(model, 9, format)).toBeNull();
  expect(dailyBarsTooltip(model, null, format)).toBeNull();
});

test("paint: bars from 0 with a 2 px gap, the so-far day lighter, the gap day hatched, the means in text colours and the threshold", async () => {
  const { container } = render(<DailyBars title="Electricity" unit="kWh" token="--eq-heat1" days={WEEK} mean7={9.25} mean30={10} threshold={{ value: 15, label: "Budget 15 kWh", tone: "warn" }} />);
  await settle();
  const plot = created[0];
  plot.fire("ready");
  plot.draw();
  const ctx = plot.ctx;
  expect(ctx.depth).toBe(0);
  expect(plot.opts.series[1].paths!(plot as never, 1, 0, 0)).toBeNull();
  expect(plot.scales.y).toEqual({ min: 0, max: 20 });
  // Five days have a value (0 kWh draws nothing, as it has no height); the partial day fills lighter.
  const bars = ctx.fills.map((fill, index) => ({ ...fill, alpha: ctx.fillAlphas[index] })).filter((fill) => fill.color === TOKENS["--eq-heat1"]);
  expect(bars).toHaveLength(4);
  expect(bars.map((bar) => bar.alpha)).toEqual([1, 1, 1, SO_FAR_ALPHA]);
  // Neighbouring bars never touch: the gap between them is at least 2 px.
  const xs = (bar: (typeof bars)[number]) => bar.path.map(([x]) => x);
  expect(Math.min(...xs(bars[1])) - Math.max(...xs(bars[0]))).toBeGreaterThanOrEqual(BAR_GAP);
  // The day with no record is a hatch of --text-3 over the plot's height, never a bar at 0.
  expect(ctx.strokes.some((stroke) => stroke.stroke === TOKENS["--text-3"] && stroke.width === 1 && stroke.dash.length === 0)).toBe(true);
  // The 7-day mean: 2 px --text, solid; the 30-day mean 1 px --text-3, dashed; each labelled in a text colour.
  expect(ctx.strokes.some((stroke) => stroke.stroke === TOKENS["--text"] && stroke.width === 2 && stroke.dash.length === 0)).toBe(true);
  expect(ctx.strokes.some((stroke) => stroke.stroke === TOKENS["--text-3"] && stroke.width === 1 && stroke.dash.join() === "4,4")).toBe(true);
  expect(ctx.texts.map((text) => [text.text, text.color])).toEqual(expect.arrayContaining([
    [`7-day mean ${kwh("9.3")}`, TOKENS["--text"]], [`30-day mean ${kwh("10.0")}`, TOKENS["--text-3"]], ["Budget 15 kWh", TOKENS["--warn-text"]],
  ]));
  // No text in a series colour.
  expect(ctx.texts.some((text) => text.color === TOKENS["--eq-heat1"])).toBe(false);
  expect(ctx.strokes.some((stroke) => stroke.stroke === TOKENS["--warn"] && stroke.width === 1.5)).toBe(true);
  // The key names what is not the series; the plot names what is plotted; no style attribute anywhere.
  expect([...container.querySelectorAll(".chart-key li")].map((item) => item.textContent)).toEqual(["lighter: so far", "no record", "7-day mean, complete days", "30-day mean", "Budget 15 kWh"]);
  expect(container.querySelector("[role=img]")!.getAttribute("aria-label")).toMatch(/^Electricity per day for 6 days, in kWh, from 0\./);
  expect(container.querySelectorAll("[style]")).toHaveLength(0);
});

test("the CSV and the table: an empty cell for a day with no record, never 0; the note says so far", async () => {
  const model = buildDailyBars({ title: "Electricity", unit: "kWh", days: WEEK });
  expect(dailyBarsCsv(model).replace(/^\uFEFF/, "").trimEnd().split("\r\n")).toEqual([
    "day (America/Denver),Electricity (kWh),note",
    "2026-11-12,12,", "2026-11-13,10,", "2026-11-14,,no record", "2026-11-15,0,", "2026-11-16,11,", "2026-11-17,4,so far",
  ]);
  expect(dailyBarsKey(model, "--eq-heat1").map((item) => item.key)).toEqual(["so-far", "no-record"]);
  const { container } = render(<DailyBars title="Electricity" unit="kWh" token="--eq-heat1" days={WEEK} />);
  await settle();
  expect(screen.getByRole("link", { name: "CSV of this chart" }).getAttribute("download")).toBe("verdify-electricity-2026-11-12-2026-11-17.csv");
  const details = container.querySelector<HTMLDetailsElement>("details.chart-table")!;
  act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  await waitFor(() => expect(details.querySelector("table")).toBeTruthy());
  const rows = [...details.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td, th")].map((cell) => cell.textContent));
  expect(rows[2]).toEqual(["Nov 14", "—", "no record"]);
  expect(rows[5]).toEqual(["Nov 17", kwh("4.0"), "so far"]);
});

test("keys: arrows move the cursor day to day and read it aloud; Enter and a click open the day", async () => {
  const picked: string[] = [];
  render(<DailyBars title="Electricity" unit="kWh" token="--eq-heat1" days={WEEK} onPick={(date) => picked.push(date)} />);
  await settle();
  const plot = created[0];
  plot.fire("ready");
  plot.scales.x = { min: dayAt("2026-11-12") - 43_200, max: dayAt("2026-11-17") + 43_200 };
  const group = screen.getByRole("group", { name: "Electricity: arrow keys move between days, Enter opens the day" });
  const readout = () => document.querySelector("[aria-live=polite]")!.textContent;
  fireEvent.keyDown(group, { key: "End" });
  expect(plot.cursor.idx).toBe(5);
  expect(readout()).toBe(`Nov 17 · so far, ${kwh("4.0")}`);
  fireEvent.keyDown(group, { key: "ArrowLeft" });
  fireEvent.keyDown(group, { key: "ArrowLeft" });
  fireEvent.keyDown(group, { key: "ArrowLeft" });
  expect(plot.cursor.idx).toBe(2);
  expect(readout()).toBe("Nov 14, no record");
  // The keyboard cursor shows the tooltip even with no pointer event.
  expect(plot.over.querySelector(".chart-tooltip")?.textContent).toContain("no record");
  fireEvent.keyDown(group, { key: "Enter" });
  fireEvent.keyDown(group, { key: "Home" });
  expect(plot.cursor.idx).toBe(0);
  plot.hover(dayAt("2026-11-16"), 4);
  fireEvent.click(plot.over);
  expect(picked).toEqual(["2026-11-14", "2026-11-16"]);
});

test("no days: the message, no plot, no key and no CSV", async () => {
  const { container } = render(<DailyBars title="Electricity" unit="kWh" token="--eq-heat1" days={[]} />);
  await settle();
  expect(created).toHaveLength(0);
  expect(screen.getByText("No days to show")).toBeTruthy();
  expect(container.querySelector(".chart-key, .chart-foot")).toBeNull();
});

test("the chrome (A3): the key is one line above the plot, and under it one quiet line of the table and CSV", async () => {
  const { container } = render(<DailyBars title="Electricity" unit="kWh" token="--eq-heat1" days={WEEK} mean7={9.3} />);
  await settle();
  const figure = container.querySelector("figure")!;
  expect([...figure.children].map((child) => child.className)).toEqual(["eyebrow", "chart-key", "daily-focus", "screen-reader", "chart-foot"]);
  const foot = figure.querySelector(".chart-foot")!;
  expect(foot.querySelector("summary")?.textContent).toBe("Data table · 6 rows");
  const csv = screen.getByRole("link", { name: "CSV of this chart" });
  expect([csv.textContent, csv.className, foot.contains(csv)]).toEqual(["CSV", "chart-csv", true]);
  cleanup();
  // legend={false}: no key of its own; the table and CSV stay.
  const bare = render(<DailyBars title="Electricity" unit="kWh" token="--eq-heat1" days={WEEK} legend={false} />).container;
  await settle();
  expect(bare.querySelector(".chart-key")).toBeNull();
  expect(bare.querySelector(".chart-foot .chart-table")).not.toBeNull();
});

test("small multiples in a ChartGroup: one key above the first row, each chart its title, plot and quiet line", async () => {
  render(<ChartGroup label="Climate relays">
    <DailyBars title="Starts per day" unit="starts" token="--eq-heat1" days={WEEK} mean7={9} mean30={10} size="sm" />
    <DailyBars title="Starts per day" unit="starts" token="--eq-fan1" days={WEEK} mean7={8} mean30={9} size="sm" />
    <DailyBars title="Run hours per day" unit="h" token="--eq-fan1" days={WEEK} mean7={8} mean30={9} size="sm" />
  </ChartGroup>);
  await settle();
  const group = screen.getByRole("group", { name: "Climate relays" });
  const keys = group.querySelectorAll(".chart-key");
  expect(keys).toHaveLength(1);
  expect(keys[0].className).toBe("chart-key chart-group-key");
  expect(group.firstElementChild).toBe(keys[0]);
  expect([...keys[0].querySelectorAll("li")].map((item) => item.textContent)).toEqual(["lighter: so far", "no record", "7-day mean, complete days", "30-day mean"]);
  // The relays' own colours differ, so "so far" reads in the neutral text colour; the means keep theirs.
  expect([...keys[0].querySelectorAll(".chart-key-swatch")].map((swatch) => swatch.getAttribute("data-token"))).toEqual(["text-2", "text-3", "text", "text-3"]);
  expect(group.querySelectorAll("figure")).toHaveLength(3);
  expect(group.querySelectorAll(".chart-foot")).toHaveLength(3);
  expect(group.querySelectorAll("figure .chart-key")).toHaveLength(0);
});
