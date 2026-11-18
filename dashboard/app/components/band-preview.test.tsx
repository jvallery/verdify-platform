// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// The Band page's preview (screens 2.2 block 2) from API-23 answers the fixture API gives, with uPlot mocked: the answer in
// words, the two charts under one key and one quiet line, the draft drawn only where it differs, the law's lines inside
// the draft band, the findings in words, the night heat estimate, and the loading, failed and message states.
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFixtureHandler } from "../../e2e/fixture-api.mjs";
import { FakeResizeObserver, MockPlot, media, setTokens } from "../charts/fixtures/uplot-mock";
import { parseBandProfilePreview, type BandProfilePreview } from "../lib/operator-api";
import { NOW } from "../lib/test-fixture-api";
import {
  BandPreviewPanel, FindingsList, bandAnswer, bandFindings, lawLines, nightHeatText, previewCsv, previewKey, previewViews, ribbon, solarMarks, tooltipText,
} from "./band-preview";
import { renderUi, text } from "./test-render";

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));

/** API-23 as the fixture API answers `query` (the band as stored with no query). */
function preview(query = ""): BandProfilePreview {
  const api = createFixtureHandler({ clock: () => NOW });
  const out = api.respond({ method: "GET", url: `/api/v1/band/profile${query ? `?${query}` : ""}` });
  expect(out.status).toBe(200);
  return parseBandProfilePreview(out.body) as BandProfilePreview;
}
const DRAFT = "temp_low_day=71.8&temp_high_day=85.8&temp_low_night=62.7&temp_high_night=70.7";

beforeEach(() => {
  MockPlot.reset();
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style"); });

test("the answer states the band as stored by day and at night, and says when sunrise and sunset are set apart", () => {
  expect(bandAnswer(preview())).toBe("The house is held at 71.8–85.8 °F and 0.86–1.39 kPa by day (solar noon), and at 60.7–70.7 °F and 0.74–1.27 kPa at night (solar midnight). Sunrise and sunset are set apart from the halfway point.".replaceAll(" °F", " °F").replaceAll(" kPa", " kPa"));
  const simple = preview();
  expect(bandAnswer({ current: { ...simple.current, edges_simple: { temp: true, vpd: true } } })).not.toMatch(/set apart/);
});

test("the views draw the draft only when it differs, and the law's lines inside the band the draft makes", () => {
  const stored = previewViews(preview(), NOW / 1000, false);
  expect(stored.temp.draft).toBeNull();
  expect(stored.temp.runs.length).toBeGreaterThan(0);
  expect(stored.temp.outdoor).not.toBeNull();
  expect(stored.vpd.expected).not.toBeNull();
  expect(stored.temp.lines.map((line) => line.label)).toEqual(["Furnace starts", "Electric heat starts", "Cooling starts"]);
  expect(stored.vpd.lines.map((line) => line.label)).toEqual(["Drying wanted", "Fog starts"]);

  const draft = preview(DRAFT);
  const views = previewViews(draft, NOW / 1000, true);
  expect(views.temp.draft).not.toBeNull();
  // The VPD axis is not in the draft, so it draws no draft line.
  expect(views.vpd.draft).toBeNull();
  // The furnace line sits its offset above the draft's low edge, not the stored one.
  const index = draft.t.length - 1;
  const offsets = draft.law_lines!;
  expect(views.temp.lines[0].values[index]).toBeCloseTo((draft.temp.draft.low[index] ?? 0) + offsets.heat2_on_above_low_f, 3);
});

test("lawLines needs the law's offsets (an API before them draws none), and ribbon leaves a gap open", () => {
  expect(lawLines("temp", { low: [60], high: [70] }, null)).toEqual([]);
  expect(ribbon([1, 2, 3, 4], [60, null, 61, 62], [70, 71, 72, 73]).map((run) => run.t)).toEqual([[1], [3, 4]]);
});

test("the key, the sun's marks and the readout name what each chart draws, in words", () => {
  const views = previewViews(preview(DRAFT), NOW / 1000, true);
  expect(previewKey(views.temp).map((item) => item.label)).toEqual(["Band as stored", "Draft band", "Measured, last 24 h", "Outdoor forecast", "Where a rule starts"]);
  expect(previewKey(views.vpd).map((item) => item.label)).toEqual(["Band as stored", "Measured, last 24 h", "Expected night VPD", "Where a rule starts"]);
  expect(solarMarks(preview().sun).map((mark) => mark.word)).toEqual(["Sunrise", "Noon", "Sunset"]);
  const readout = tooltipText(views.temp, 0)!.join(" | ").replaceAll(" ", " ");
  expect(readout).toMatch(/Band 6\d\.\d–7\d\.\d °F \| Draft /);
  expect(readout).toMatch(/Furnace starts \d+\.\d °F/);
  expect(tooltipText(views.temp, -1)).toBeNull();
});

test("one CSV holds both charts, each column named by its axis", () => {
  const views = previewViews(preview(DRAFT), NOW / 1000, true);
  const head = previewCsv(views).split("\n")[0];
  expect(head).toContain("Temperature band low, °F");
  expect(head).toContain("Temperature draft low, °F");
  expect(head).toContain("VPD band high, kPa");
  expect(head).not.toContain("VPD draft");
});

test("the night heat estimate names the draft only while one is previewed", () => {
  const draft = preview(DRAFT);
  expect(nightHeatText(draft, false)).toMatch(/^Heat for tonight, estimated: [\d.]+\u00a0kWh with the band as stored\.$/);
  expect(nightHeatText(draft, true)).toMatch(/with the draft\.$/);
  expect(nightHeatText({ night_heat_kwh: { current: null, draft: null } }, true)).toBeNull();
});

test("findings list errors first, each naming its edge in words with the API's reason", () => {
  renderUi(<FindingsList findings={[
    { code: "overshoot", severity: "warning", field: "band_temp_low_sr", detail: "temp_low leaves its anchor range by 1.5 °F" },
    { code: "band_width", severity: "error", field: "temp_low_night", detail: "The band narrows to 5.0 °F" },
  ]} />);
  const items = within(screen.getByRole("list", { name: "What the band check found" })).getAllByRole("listitem").map((item) => text(item));
  expect(items).toEqual([
    "Blocks Save Temperature low edge at night: The band narrows to 5.0 °F",
    "Warning Temperature low edge at sunrise: The temperature low edge leaves its anchor range by 1.5 °F",
  ]);
});

// API-23 for the stored band as it read live on 2026-11-17: three overshoot warnings, one of them on the stored middle line.
const LIVE_FINDINGS: Pick<BandProfilePreview, "findings" | "overshoot" | "changed"> = {
  changed: [],
  overshoot: { temp_low: 1.1, temp_target: 1.5, temp_high: 1.9, vpd_low: 0.01, vpd_target: 0.01, vpd_high: 0.02 },
  findings: [
    { code: "overshoot", severity: "warning", field: "band_temp_low_sr", detail: "temp_low leaves its anchor range by 1.1 °F" },
    { code: "overshoot", severity: "warning", field: "band_temp_target_sr", detail: "temp_target leaves its anchor range by 1.5 °F" },
    { code: "overshoot", severity: "warning", field: "band_temp_high_sr", detail: "temp_high leaves its anchor range by 1.9 °F" },
    { code: "dewpoint_unreached", severity: "warning", field: "vpd_below_night", detail: "A 0.74 kPa night floor needs a dewpoint" },
  ],
};

test("with no draft change the overshoot is one quiet line, and nothing names the stored middle line", () => {
  for (const edited of [false, true]) {
    const shown = bandFindings(LIVE_FINDINGS, edited);
    expect(shown.findings.map((item) => item.code)).toEqual(["dewpoint_unreached"]);
    expect(shown.overshootNote?.replaceAll("\u00a0", " ")).toBe(
      "The curve runs up to 1.9 °F outside its anchors, because sunrise and sunset are set apart from the midpoint of noon and midnight. This is accepted.",
    );
  }
  // Both axes past the warning line: the most of each.
  const both = bandFindings({ ...LIVE_FINDINGS, findings: [...LIVE_FINDINGS.findings,
    { code: "overshoot", severity: "warning", field: "band_vpd_high_sr", detail: "vpd_high leaves its anchor range by 0.02 kPa" }] }, false);
  expect(both.overshootNote?.replaceAll("\u00a0", " ")).toMatch(/^The curve runs up to 1\.9 °F and 0\.02 kPa outside its anchors/);
  expect(bandFindings({ ...LIVE_FINDINGS, findings: [] }, false)).toEqual({ findings: [], overshootNote: null });
});

test("while a draft changes the band the overshoot stays one warning per edge; an error shows only with a draft", () => {
  const order = { code: "band_order", severity: "error" as const, field: "band_temp_target_sm", detail: "temp_target falls below temp_low during the day" };
  const draft = { ...LIVE_FINDINGS, changed: ["band_temp_low_sm"], findings: [...LIVE_FINDINGS.findings, order] };
  const shown = bandFindings(draft, true);
  expect(shown.overshootNote).toBeNull();
  expect(shown.findings.map((item) => `${item.code} ${item.field}`)).toEqual([
    "overshoot band_temp_low_sr", "overshoot band_temp_high_sr", "dewpoint_unreached vpd_below_night", "band_order band_temp_target_sm",
  ]);
  // The stored band's own errors block nothing.
  expect(bandFindings(draft, false).findings.some((item) => item.severity === "error")).toBe(false);
});

test("the panel: the answer, two charts under one key and one quiet line, the sun's times and the stored band's warning", () => {
  const stored = preview();
  renderUi(<BandPreviewPanel preview={stored} edited={false} now={NOW / 1000} state="ready" />);
  const panel = screen.getByRole("heading", { name: "The band" }).closest("section") as HTMLElement;
  expect(panel.getAttribute("data-state")).toBe("ready");
  expect(text(panel)).toContain("The house is held at 71.8–85.8 °F");
  expect(panel.querySelectorAll("figure.band-chart")).toHaveLength(2);
  // One quiet line for both charts: one data table disclosure, one CSV.
  expect(panel.querySelectorAll(".chart-foot")).toHaveLength(1);
  expect([...panel.querySelectorAll(".chart-csv")].map((link) => link.getAttribute("aria-label"))).toEqual(["CSV of these charts"]);
  expect(text(panel)).toContain("Sunrise 07:00 · Solar noon 12:30 · Sunset 18:00.");
  // The stored band's own errors would block nothing, and its overshoot is one quiet line, not a Warning.
  expect(text(panel)).not.toContain("Warning Temperature low edge at sunrise");
  expect(text(panel.querySelector(".band-overshoot.meta"))).toMatch(/^The curve runs up to 1\.5\s°F outside its anchors, because sunrise and sunset are set apart/);
  expect(text(panel)).toMatch(/Heat for tonight, estimated: [\d.]+ kWh with the band as stored\./);
});

test("the panel's other states: loading reserves its place, a failure offers Retry, a message shows above the charts", () => {
  const onRetry = vi.fn();
  const { rerender } = renderUi(<BandPreviewPanel preview={null} edited={false} now={null} state="loading" />);
  const panel = () => screen.getByRole("heading", { name: "The band" }).closest("section") as HTMLElement;
  expect(panel().getAttribute("data-state")).toBe("loading");
  rerender(<BandPreviewPanel preview={null} edited={false} now={null} state="error" onRetry={onRetry} />);
  expect(panel().getAttribute("data-state")).toBe("error");
  within(panel()).getByRole("button", { name: /Retry/ }).click();
  expect(onRetry).toHaveBeenCalled();
  rerender(<BandPreviewPanel preview={preview()} edited={true} now={null} state="ready" message="Preview unavailable" />);
  expect(within(panel()).getByRole("status").textContent).toBe("Preview unavailable");
});
