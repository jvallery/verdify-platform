// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// ThresholdSeries (design system v2 §5): one measured line against labelled warning and critical lines; the y range
// always holds every threshold; a missing reading is a gap; the tooltip, the key, the table and the CSV.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, MockPlot, TOKENS, created, media, setTokens } from "./fixtures/uplot-mock";
import { ThresholdSeries, buildThresholdSeries, thresholdKey, thresholdRange, thresholdTooltip } from "./threshold-series";

vi.mock("uplot", async () => ({ default: (await import("./fixtures/uplot-mock")).MockPlot }));

const epoch = (instant: string) => Date.parse(instant) / 1000;
const RANGE = { from: epoch("2026-11-17T06:00:00Z"), to: epoch("2026-11-17T09:00:00Z") };
const T = [0, 1, 2, 3].map((hour) => RANGE.from + hour * 3600);
const HEAP = [38, null, 30, 28];
const LIMITS = [{ value: 24, label: "Warning 24 KB", tone: "warn" as const }, { value: 16, label: "Critical 16 KB", tone: "critical" as const }];
const settle = () => act(async () => { await vi.dynamicImportSettled(); });

const { createObjectURL, revokeObjectURL } = URL;
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:csv");
  URL.revokeObjectURL = vi.fn();
  MockPlot.reset(); FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ narrow: false, fine: true }));
  setTokens();
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style");
  URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL;
});

test("the y range holds the readings in the window and every threshold, padded a tenth, never below 0 when nothing is", () => {
  expect(thresholdRange(T, HEAP, LIMITS, RANGE)).toEqual([13.8, 40.2]);
  expect(thresholdRange(T, [1, 2, null, 3], [{ value: 0 }], RANGE)).toEqual([0, 3.3]);
  expect(thresholdRange([], [], [], RANGE)).toEqual([0, 1]);
  // A reading outside the window does not stretch it.
  expect(thresholdRange([RANGE.from - 3600, ...T], [500, ...HEAP], LIMITS, RANGE)).toEqual([13.8, 40.2]);
  const model = buildThresholdSeries({ title: "Heap low-water", unit: "kB", t: T, values: [38, Number.NaN, 30, 28], thresholds: LIMITS, range: RANGE });
  expect(model.values).toEqual([38, null, 30, 28]);
  expect(model.thresholds.map((threshold) => threshold.level)).toEqual(["warn", "critical"]);
  expect(thresholdKey(model).map((item) => [item.label, item.token])).toEqual([["Warning 24 KB", "--warn"], ["Critical 16 KB", "--critical"]]);
});

test("paint: the line 2 px with no gap bridged, the thresholds dashed in their status colours and labelled in their text colours", async () => {
  const { container } = render(<ThresholdSeries title="Heap low-water" unit="kB" t={T} values={HEAP} thresholds={LIMITS} range={RANGE} token="--c-temp" />);
  await settle();
  const plot = created[0];
  plot.fire("ready");
  plot.draw();
  expect(plot.ctx.depth).toBe(0);
  expect([plot.opts.series[1].width, plot.opts.series[1].spanGaps, plot.opts.series[1].stroke]).toEqual([2, false, TOKENS["--c-temp"]]);
  expect(plot.data[1]).toEqual(HEAP);
  expect(plot.scales.y.min).toBeCloseTo(13.8, 9);
  const strokes = plot.ctx.strokes.filter((stroke) => stroke.width === 1.5 && stroke.dash.join() === "6,4").map((stroke) => stroke.stroke);
  expect(strokes).toEqual([TOKENS["--warn"], TOKENS["--critical"]]);
  expect(plot.ctx.texts.map((text) => [text.text, text.color])).toEqual([["Warning 24 KB", TOKENS["--warn-text"]], ["Critical 16 KB", TOKENS["--critical-text"]]]);
  expect([...container.querySelectorAll(".chart-key li")].map((item) => item.textContent)).toEqual(["Warning 24 KB", "Critical 16 KB"]);
  expect(container.querySelector(".plot-fixed-md")).not.toBeNull();
  expect(screen.getByRole("link", { name: /CSV/ })).toBeTruthy();
  expect(container.querySelectorAll("[style]")).toHaveLength(0);
});

test("the tooltip: the time with its offset, then the reading or no reading", () => {
  const model = buildThresholdSeries({ title: "Heap low-water", unit: "kB", t: T, values: HEAP, thresholds: LIMITS, range: RANGE });
  const at = (idx: number) => ({ cursor: { left: 10, top: 10, idx }, posToVal: () => T[idx] }) as never;
  const format = (value: number) => `${value} kB`;
  expect(thresholdTooltip(model, at(0), format)).toEqual(["11/16/2026 23:00 GMT-07:00", "Heap low-water 38 kB"]);
  expect(thresholdTooltip(model, at(1), format)![1]).toBe("no reading");
});

test("no readings: the message, no plot", async () => {
  render(<ThresholdSeries title="Heap low-water" unit="kB" t={[]} values={[]} thresholds={LIMITS} range={RANGE} />);
  await settle();
  expect(created).toHaveLength(0);
  expect(screen.getByText("No readings in this window")).toBeTruthy();
});
