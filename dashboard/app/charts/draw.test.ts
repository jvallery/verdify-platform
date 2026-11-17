// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { BAR_RADIUS, Labels, SO_FAR_ALPHA, SO_FAR_WORDS, hatchColor, labelColor, linesCross, paintBar, paintNow, paintSpanHatch, paintThresholds, thresholdStyle, type PaintTarget } from "./draw";
import { RecordingContext, TOKENS } from "./fixtures/uplot-mock";

test("text is never drawn in a series colour (design system v2 §5): a label takes its text token", () => {
  for (const token of ["--c-vpd", "--text-3", "--accent", "--c-temp", "--eq-fan2", "--c-rh"]) expect(labelColor(TOKENS[token], TOKENS["--text"]), token).toBe(TOKENS["--text"]);
  expect(labelColor(TOKENS["--c-requested"], TOKENS["--warn-text"])).toBe(TOKENS["--warn-text"]);
  expect(labelColor("", TOKENS["--text"])).toBe(TOKENS["--text"]);
});

test("a label is drawn over a 3 px halo of the chart's background, at the first place no drawn line crosses", () => {
  const ctx = new RecordingContext();
  // x 0–100 over 400 px, y 0–100 over 200 px; one shown series flat at 60 (y 80 px), a hidden one at 40 (y 120 px).
  const plot = {
    ctx, bbox: { left: 0, top: 0, width: 400, height: 200 }, scales: { x: { min: 0, max: 100 }, y: { min: 0, max: 100 } },
    valToPos: (value: number, scale: string) => (scale === "x" ? value * 4 : 200 - value * 2),
    data: [[0, 100], [60, 60], [40, 40]], series: [{}, { show: true }, { show: false }],
  } as unknown as PaintTarget;
  const labels = new Labels(plot, 1, "rgb(255, 255, 255)", linesCross(plot, { now: null, retention: [], bounds: [], steps: [], runs: [] }));
  // Above a line at y 90 px the box (74–87) would sit on the series: the label goes below it instead.
  expect(labels.place("Band in force · DERIVED", [{ at: 20, line: 90, align: "left" }], TOKENS["--text-3"])).toBe(true);
  expect(ctx.texts.map((item) => [item.text, item.y])).toEqual([["Band in force · DERIVED", 93]]);
  expect(ctx.halos).toEqual([{ text: "Band in force · DERIVED", x: 20, y: 93, color: "rgb(255, 255, 255)", width: 3 }]);
  // The hidden series is not a line on the chart: a box over it is free.
  expect(labels.place("Forecast · issued 07:00", [{ at: 200, line: 130, align: "left" }], TOKENS["--text-3"])).toBe(true);
  expect(ctx.texts.at(-1)?.y).toBe(114);
  // Where a line crosses every place, the first that overlaps no label still takes it, its halo keeping the words legible.
  const crowded = { ...plot, data: [[0, 100], [60, 60], [47.5, 47.5]], series: [{}, { show: true }, { show: true }] } as unknown as PaintTarget;
  const both = new Labels(crowded, 1, "rgb(255, 255, 255)", linesCross(crowded, { now: null, retention: [], bounds: [], steps: [], runs: [] }));
  expect(both.place("max 2.50 kPa", [{ at: 300, line: 92, align: "right" }], TOKENS["--text"])).toBe(true);
  expect(ctx.texts.at(-1)?.y).toBe(76);
});

/** x 0–100 over 400 px from 0, y 0–100 over 200 px from 0. */
const target = (ctx: RecordingContext) => ({
  ctx, bbox: { left: 0, top: 0, width: 400, height: 200 }, scales: { x: { min: 0, max: 100 }, y: { min: 0, max: 100 } },
  valToPos: (value: number, scale: string) => (scale === "x" ? value * 4 : 200 - value * 2),
}) as unknown as PaintTarget;
const asCanvas = (ctx: RecordingContext) => ctx as unknown as CanvasRenderingContext2D;

test("a bar is rounded at its data end only; a day so far is the same colour, lighter, with a full-colour outline", () => {
  const ctx = new RecordingContext();
  paintBar(asCanvas(ctx), { left: 10, width: 20, base: 200, value: 120 }, TOKENS["--eq-water"], 1);
  // Up from the base: square at 200, the two top corners rounded by 4 px.
  expect(ctx.fills).toEqual([{ color: TOKENS["--eq-water"], path: [[10, 200], [10, 120 + BAR_RADIUS], [14, 120], [26, 120], [30, 124], [30, 200]] }]);
  expect(ctx.fillAlphas).toEqual([1]);
  expect(ctx.strokes).toEqual([]);
  paintBar(asCanvas(ctx), { left: 40, width: 20, base: 200, value: 150 }, TOKENS["--eq-water"], 1, { soFar: true });
  expect(ctx.fillAlphas).toEqual([1, SO_FAR_ALPHA]);
  expect(ctx.strokes.map((stroke) => [stroke.stroke, stroke.width])).toEqual([[TOKENS["--eq-water"], 1]]);
  expect(ctx.globalAlpha).toBe(1);
  expect(ctx.depth).toBe(0);
  expect(SO_FAR_WORDS).toBe("so far");
  // Nothing to draw: no width or no length.
  paintBar(asCanvas(ctx), { left: 0, width: 0, base: 200, value: 100 }, TOKENS["--eq-water"], 1);
  paintBar(asCanvas(ctx), { left: 0, width: 10, base: 200, value: 200 }, TOKENS["--eq-water"], 1);
  expect(ctx.fills).toHaveLength(2);
});

test("unknown spans hatch in --text-3 and refused or waiting spans in --warn, clipped to the plot", () => {
  expect([hatchColor("unknown", TOKENS), hatchColor("refused", TOKENS)]).toEqual([TOKENS["--text-3"], TOKENS["--warn"]]);
  const ctx = new RecordingContext();
  paintSpanHatch(target(ctx), -10, 25, "refused", TOKENS, 1);
  expect(ctx.strokes).toHaveLength(1);
  expect(ctx.strokes[0].stroke).toBe(TOKENS["--warn"]);
  // From the plot's left edge (−10 clamps to 0) to 100 px; each diagonal climbs the full 200 px height.
  expect(ctx.strokes[0].path.slice(0, 2)).toEqual([[-200, 200], [0, 0]]);
  expect(Math.max(...ctx.strokes[0].path.filter((_, index) => index % 2 === 0).map(([px]) => px))).toBeLessThan(100);
  expect(ctx.depth).toBe(0);
});

test("thresholds: a 1.5 px dashed line in the status solid, labelled in its text colour; one outside the range is not drawn", () => {
  expect(thresholdStyle("warn", TOKENS, 1)).toEqual({ stroke: TOKENS["--warn"], text: TOKENS["--warn-text"], width: 1.5, dash: [6, 4] });
  expect(thresholdStyle("critical", TOKENS, 2)).toEqual({ stroke: TOKENS["--critical"], text: TOKENS["--critical-text"], width: 3, dash: [12, 8] });
  const ctx = new RecordingContext();
  paintThresholds(target(ctx), [{ value: 40, level: "warn", label: "Warning 24 KB" }, { value: 20, level: "critical", label: "Critical 16 KB" }, { value: 140, level: "warn", label: "Off the scale" }], { ...TOKENS, background: "rgb(255, 255, 255)" }, 1);
  expect(ctx.strokes.map((stroke) => [stroke.stroke, stroke.width, stroke.dash, stroke.path])).toEqual([
    [TOKENS["--warn"], 1.5, [6, 4], [[0, 120], [400, 120]]], [TOKENS["--critical"], 1.5, [6, 4], [[0, 160], [400, 160]]],
  ]);
  expect(ctx.texts.map((item) => [item.text, item.color])).toEqual([["Warning 24 KB", TOKENS["--warn-text"]], ["Critical 16 KB", TOKENS["--critical-text"]]]);
  expect(ctx.depth).toBe(0);
});

test("the present moment is a 1 px --text rule labelled Now", () => {
  const ctx = new RecordingContext();
  expect(paintNow(target(ctx), 50, TOKENS, 1)).toBe(true);
  expect(ctx.strokes.map((stroke) => [stroke.stroke, stroke.width, stroke.path])).toEqual([[TOKENS["--text"], 1, [[200, 0], [200, 200]]]]);
});
