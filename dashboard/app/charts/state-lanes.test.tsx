// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// StateLanesChart (design system v2 §5): API intervals to spans, on solid, unknown and refused hatched (never off), group
// headings that fold, the Now rule, the tooltip by row, the key, the table and the CSV.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, MockPlot, TOKENS, created, media, setTokens } from "./fixtures/uplot-mock";
import { LANE_PITCH } from "./lanes-draw";
import {
  StateLanesChart, laneSpanState, spansFromIntervals, stateLaneEntries, stateLanesCsv, stateLanesKey, stateLanesView, stateLaneTooltip, stateRowAt,
  type StateLaneRow,
} from "./state-lanes";

vi.mock("uplot", async () => ({ default: (await import("./fixtures/uplot-mock")).MockPlot }));

const epoch = (instant: string) => Date.parse(instant) / 1000;
const RANGE = { from: epoch("2026-11-17T06:00:00Z"), to: epoch("2026-11-17T10:00:00Z") };
const NOW = epoch("2026-11-17T09:00:00Z");
const settle = () => act(async () => { await vi.dynamicImportSettled(); });
const ROWS: StateLaneRow[] = [
  { key: "heat1", label: "Electric heat", token: "--eq-heat1", group: "law", spans: [{ start: RANGE.from, end: RANGE.from + 3600, state: "on" }, { start: RANGE.from + 3600, end: RANGE.from + 7200, state: "off" }] },
  { key: "drying", label: "Drying", token: "--eq-vent", group: "law", spans: [{ start: RANGE.from, end: RANGE.from + 1800, state: "refused", label: "costs more than the limit" }] },
  { key: "outdoor", label: "Outdoor source", token: "--c-outdoor", spans: [{ start: RANGE.from, end: RANGE.from + 600, state: "unknown" }] },
];

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

test("intervals to spans: clamped to the range, sorted, running on and not wanted off, a state this build does not know unknown", () => {
  const spans = spansFromIntervals([
    { start: "2026-11-17T09:30:00Z", end: "2026-11-17T11:00:00Z", state: "not_wanted" },
    { start: "2026-11-17T05:00:00Z", end: "2026-11-17T07:00:00Z", state: "running" },
    { start: "2026-11-17T07:00:00Z", end: "2026-11-17T08:00:00Z", state: "refused", reason: "cost" },
    { start: "2026-11-17T08:00:00Z", end: "2026-11-17T09:00:00Z", state: "paused_by_something_new" },
    { start: "2026-11-17T11:00:00Z", end: "2026-11-17T12:00:00Z", state: "on" },
    { start: "not a time", end: "2026-11-17T09:00:00Z", state: "on" },
  ], RANGE, (interval) => interval.reason ?? undefined);
  expect(spans).toEqual([
    { start: RANGE.from, end: epoch("2026-11-17T07:00:00Z"), state: "on" },
    { start: epoch("2026-11-17T07:00:00Z"), end: epoch("2026-11-17T08:00:00Z"), state: "refused", label: "cost" },
    { start: epoch("2026-11-17T08:00:00Z"), end: epoch("2026-11-17T09:00:00Z"), state: "unknown" },
    { start: epoch("2026-11-17T09:30:00Z"), end: RANGE.to, state: "off" },
  ]);
  expect(["on", "off", "unknown", "refused", "running", "not_wanted", "x"].map(laneSpanState)).toEqual(["on", "off", "unknown", "refused", "on", "off", "unknown"]);
});

test("entries: ungrouped rows first, then each group's heading and, while open, its rows; an empty group is left out", () => {
  const groups = [{ key: "law", label: "What the law asked for" }, { key: "empty", label: "Nothing" }];
  const lines = (open: string[]) => stateLaneEntries(ROWS, groups, new Set(open)).map((entry) => (entry.kind === "head" ? `# ${entry.group.label} ${entry.count}` : entry.row.key));
  expect(lines(["law"])).toEqual(["outdoor", "# What the law asked for 2", "heat1", "drying"]);
  expect(lines([])).toEqual(["outdoor", "# What the law asked for 2"]);
  const view = stateLanesView(stateLaneEntries(ROWS, groups, new Set(["law"])), 30, NOW);
  expect(view.tops).toEqual([0, 30, 54, 84]);
  expect([stateRowAt(view, 10)?.key, stateRowAt(view, 40), stateRowAt(view, 60)?.key, stateRowAt(view, 200)]).toEqual(["outdoor", null, "heat1", null]);
});

test("paint: on solid in the row's token, refused hatched --warn, unknown hatched --text-3, off nothing, then the Now rule", async () => {
  const { container } = render(<StateLanesChart title="What the law asked for" rows={ROWS} groups={[{ key: "law", label: "Law" }]} range={RANGE} now={NOW} />);
  await settle();
  const plot = created[0];
  plot.scales.x = { min: RANGE.from, max: RANGE.to };
  plot.fire("ready");
  plot.draw();
  const ctx = plot.ctx;
  expect(ctx.depth).toBe(0);
  expect(ctx.rects.filter((rect) => rect.color === TOKENS["--eq-heat1"])).toHaveLength(1);
  expect(ctx.rects.some((rect) => rect.color === TOKENS["--eq-vent"] || rect.color === TOKENS["--c-outdoor"])).toBe(false);
  expect(ctx.strokes.some((stroke) => stroke.stroke === TOKENS["--warn"])).toBe(true);
  expect(ctx.strokes.some((stroke) => stroke.stroke === TOKENS["--text-3"])).toBe(true);
  expect(ctx.strokes.some((stroke) => stroke.stroke === TOKENS["--text"] && stroke.width === 1)).toBe(true);
  // Now is named in the key, not on the canvas: a lane has no room for words.
  expect(ctx.texts).toEqual([]);
  // Rows are text; a group heading folds its rows.
  expect([...container.querySelectorAll(".lanes-row")].map((row) => row.textContent)).toEqual(["Outdoor source", "Electric heat", "Drying"]);
  const fold = screen.getByRole("button", { name: "Law: 2 rows" });
  expect(fold.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(fold);
  expect([...container.querySelectorAll(".lanes-row")].map((row) => row.textContent)).toEqual(["Outdoor source"]);
  expect(within(container.querySelector<HTMLElement>(".chart-key")!).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["on", "refused", "unknown", "Now"]);
  expect(screen.getByRole("link", { name: "CSV of these lanes" })).toBeTruthy();
  expect(container.querySelectorAll("[style]")).toHaveLength(0);
});

test("the tooltip names the row under the pointer, the state with its words, the times and how long", () => {
  const view = stateLanesView(stateLaneEntries(ROWS, [], new Set()), LANE_PITCH.wide, NOW);
  const plot = { cursor: { left: 10, top: LANE_PITCH.wide + 4, idx: 0, event: { type: "mousemove" } }, posToVal: () => RANGE.from + 600 } as never;
  const lines = stateLaneTooltip(view, plot)!;
  expect(lines[0]).toBe("Drying");
  expect(lines[1]).toBe("refused · costs more than the limit");
  expect(lines[3]).toBe("30\u00a0min");
  expect(stateLaneTooltip(view, { ...(plot as object), cursor: { left: 10, top: 4, idx: 0, event: null } } as never)).toBeNull();
});

test("the CSV and the key: every span with its own state, unknown and refused never off; Now only inside the range", () => {
  expect(stateLanesCsv(ROWS).replace(/^\uFEFF/, "").trimEnd().split("\r\n")).toEqual([
    "row,label,state,start (America/Denver),end (America/Denver),seconds,note",
    "heat1,Electric heat,on,2026-11-16T23:00:00-07:00,2026-11-17T00:00:00-07:00,3600,",
    "heat1,Electric heat,off,2026-11-17T00:00:00-07:00,2026-11-17T01:00:00-07:00,3600,",
    "drying,Drying,refused,2026-11-16T23:00:00-07:00,2026-11-16T23:30:00-07:00,1800,costs more than the limit",
    "outdoor,Outdoor source,unknown,2026-11-16T23:00:00-07:00,2026-11-16T23:10:00-07:00,600,",
  ]);
  expect(stateLanesKey(ROWS, RANGE, RANGE.to + 60).map((item) => item.key)).toEqual(["on", "refused", "unknown"]);
});

test("no rows: the message and no plot", async () => {
  render(<StateLanesChart title="Relays" rows={[]} range={RANGE} />);
  await settle();
  expect(created).toHaveLength(0);
  expect(screen.getByText("Nothing to show in this window")).toBeTruthy();
});
