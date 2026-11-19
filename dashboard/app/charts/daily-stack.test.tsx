// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// DailyStack (design system v2 §5): parts stacked in a fixed order, 2 px of surface between them, the top part rounded, a
// "so far" day lighter, a day with no part a hatched gap (never 0); the key in part order, the tooltip, the table and CSV.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BAR_GAP, SO_FAR_ALPHA } from "./draw";
import { DailyStack, buildDailyStack, dailyStackCsv, dailyStackKey, dailyStackTooltip, type DailyStackPart } from "./daily-stack";
import { FakeResizeObserver, MockPlot, TOKENS, created, media, setTokens } from "./fixtures/uplot-mock";

vi.mock("uplot", async () => ({ default: (await import("./fixtures/uplot-mock")).MockPlot }));

const NBSP = "\u00a0";
const h = (value: string) => `${value}${NBSP}h`;
const settle = () => act(async () => { await vi.dynamicImportSettled(); });
const PARTS: DailyStackPart[] = [
  { key: "in", label: "In band", token: "--cmp-in" },
  { key: "below", label: "Below", token: "--cmp-below" },
  { key: "above", label: "Above", token: "--cmp-above" },
];
const DAYS = [
  { date: "2026-11-15", values: { in: 20, below: 3, above: 1 } },
  { date: "2026-11-16", values: { in: null, below: null, above: null } },
  { date: "2026-11-17", values: { in: 6, below: 0, above: null }, partial: true },
];

beforeEach(() => {
  MockPlot.reset(); FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ narrow: false, fine: true }));
  setTokens();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style"); });

test("the model: values in part order, a day with no part a gap (total null), a part with no value null, the total of those shown", () => {
  const model = buildDailyStack({ title: "Time in band", unit: "h", parts: PARTS, days: DAYS });
  expect(model.days.map((day) => [day.date, day.values, day.total, day.partial])).toEqual([
    ["2026-11-15", [20, 3, 1], 24, false], ["2026-11-16", [null, null, null], null, false], ["2026-11-17", [6, 0, null], 6, true],
  ]);
  expect(model.yMax).toBe(50);
  expect(buildDailyStack({ title: "Time in band", unit: "h", parts: PARTS, days: DAYS, max: 24 }).yMax).toBe(24);
});

test("the tooltip: the top part first, then the total; a gap day reads no record", () => {
  const model = buildDailyStack({ title: "Time in band", unit: "h", parts: PARTS, days: DAYS });
  const format = (value: number) => `${value.toFixed(1)}${NBSP}h`;
  expect(dailyStackTooltip(model, 0, format)).toEqual(["Nov 15", `Above ${h("1.0")}`, `Below ${h("3.0")}`, `In band ${h("20.0")}`, `Total ${h("24.0")}`]);
  expect(dailyStackTooltip(model, 1, format)).toEqual(["Nov 16", "no record"]);
  expect(dailyStackTooltip(model, 2, format)).toEqual(["Nov 17 · so far", `Below ${h("0.0")}`, `In band ${h("6.0")}`, `Total ${h("6.0")}`]);
});

test("paint: each part in its token, 2 px of surface between parts, the top part rounded, so-far lighter, the gap hatched", async () => {
  const { container } = render(<DailyStack title="Time in band" unit="h" parts={PARTS} days={DAYS} max={24} />);
  await settle();
  const plot = created[0];
  plot.fire("ready");
  plot.draw();
  const ctx = plot.ctx;
  expect(ctx.depth).toBe(0);
  // Day 1: in band and below as square segments, above as the rounded top.
  const segment = (token: string) => ctx.rects.filter((rect) => rect.color === TOKENS[token]);
  const [inBand] = segment("--cmp-in"), [below] = segment("--cmp-below");
  // The gap between in band's top and below's bottom is 2 px of surface.
  expect(inBand.y - (below.y + below.height)).toBeCloseTo(BAR_GAP, 6);
  expect(ctx.fills.filter((fill) => fill.color === TOKENS["--cmp-above"])).toHaveLength(1);
  // Day 3 (so far): in band is the top, rounded and lighter; a zero part draws nothing.
  const tops = ctx.fills.map((fill, index) => ({ ...fill, alpha: ctx.fillAlphas[index] })).filter((fill) => fill.color === TOKENS["--cmp-in"]);
  expect(tops.map((fill) => fill.alpha)).toEqual([SO_FAR_ALPHA]);
  expect(segment("--cmp-below")).toHaveLength(1);
  // Day 2: a hatch, never a bar at 0.
  expect(ctx.strokes.some((stroke) => stroke.stroke === TOKENS["--text-3"])).toBe(true);
  expect([...container.querySelectorAll(".chart-key li")].map((item) => item.textContent)).toEqual(["In band", "Below", "Above", "lighter: so far", "no record"]);
  expect(container.querySelector("[role=img]")!.getAttribute("aria-label")).toContain("stacked bottom to top: In band, Below, Above");
  expect(container.querySelectorAll("[style]")).toHaveLength(0);
});

test("the CSV: a column per part and the total, an empty cell where a part has none, no record for a gap day", () => {
  const model = buildDailyStack({ title: "Time in band", unit: "h", parts: PARTS, days: DAYS });
  expect(dailyStackCsv(model).replace(/^\uFEFF/, "").trimEnd().split("\r\n")).toEqual([
    "day (America/Denver),In band (h),Below (h),Above (h),total (h),note",
    "2026-11-15,20,3,1,24,", "2026-11-16,,,,,no record", "2026-11-17,6,0,,6,so far",
  ]);
  expect(dailyStackKey(buildDailyStack({ title: "x", unit: "h", parts: PARTS, days: [DAYS[0]] })).map((item) => item.key)).toEqual(["in", "below", "above"]);
});

test("no days: the message and no plot", async () => {
  render(<DailyStack title="Time in band" unit="h" parts={PARTS} days={[]} />);
  await settle();
  expect(created).toHaveLength(0);
  expect(screen.getByText("No days to show")).toBeTruthy();
});
