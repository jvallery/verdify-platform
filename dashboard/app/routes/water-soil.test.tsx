// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Water → Soil (screens section 3.4, SO-01 to SO-04), History's daily-record water (W-31) and Today's Misting block
// (W-30) in the app shell against the fixture API in process, at 10:42 America/Denver on Monday 2026-11-02.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, MockPlot } from "../charts/fixtures/uplot-mock";
import { AppShell } from "../components/app-shell";
import { text } from "../components/test-render";
import { advance, startFixtureApi, stopFixtureApi, writes, type FixtureOptions } from "../lib/test-fixture-api";
import Water from "./water";
import WaterBoard from "./water-board";
import WaterHistory from "./water-history";
import WaterSoil from "./water-soil";

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));

const BUILD = "fedcba9876543210fedcba9876543210fedcba98";
afterEach(() => { cleanup(); stopFixtureApi(); vi.unstubAllGlobals(); MockPlot.reset(); });

function open(path: string, options: FixtureOptions = {}) {
  const api = startFixtureApi(options);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const Stub = createRoutesStub([{
    path: "/", Component: () => <AppShell build={BUILD} authError={null} />,
    children: [{ path: "water", Component: Water, children: [
      { index: true, Component: WaterBoard }, { path: "history", Component: WaterHistory }, { path: "soil", Component: WaterSoil },
    ] }],
  }]);
  render(<Stub initialEntries={[path]} />);
  return api;
}
const load = async () => { await advance(0); await act(async () => { await vi.dynamicImportSettled(); }); await advance(5); await advance(5); };
const panel = (name: string) => screen.getByRole("region", { name });

test("Soil: one panel per probe zone; a probe the registry does not serve says it has not reported and draws nothing, never zero", async () => {
  open("/water/soil", { fixture: ["in-band", "soil-west-unserved"] });
  await load();
  const south1 = panel("South 1");
  expect(text(south1.querySelector('[data-measure="moisture"] .wat-soil-value'))).toMatch(/^\d+\.\d%$/);
  expect(text(south1)).toMatch(/The probe last answered|Silent: the probe last answered/);
  const west = panel("West");
  expect(west.querySelector(".wat-soil-stat")).toBeNull();
  expect(text(west)).toContain("This probe has not reported in the last 7 days.");
  expect(text(west)).toContain("No reading");
  expect(text(west)).not.toMatch(/\b0\.0%/);
  // The range for every zone, from the soil target rows.
  expect(text(west.querySelector(".wat-soil-range-kv"))).toBe("Range35.0% to 55.0%Wilt18.0%Saturation75.0%");
  expect(document.body.textContent).not.toMatch(/\btarget\b/i);
});

test("Soil: the answer first, conductivity in whole µS/cm, and a silent probe's readings a dash, never its last number as current", async () => {
  open("/water/soil");
  await load();
  // The answer first (design review A4); one key for the zones' charts (A3).
  expect(text(document.querySelector("[data-answer]"))).toMatch(/moisture range\.$/);
  expect(document.querySelectorAll(".wat-soil-group > .chart-key")).toHaveLength(1);
  expect(text(panel("South 1").querySelector('[data-measure="ec"] .wat-soil-value'))).toMatch(/^[\d,]+ µS\/cm$/);
  cleanup(); stopFixtureApi();
  // B10: south 1 silent for three days.
  open("/water/soil", { fixture: ["in-band", "soil-silent"] });
  await load();
  const south1 = panel("South 1");
  expect([...south1.querySelectorAll(".wat-soil-value")].map((node) => text(node))).toEqual(["—", "—", "—"]);
  expect(text(document.querySelector("[data-answer]"))).toContain("South 1 has not answered for over 2 hours.");
});

test("Soil: an operator edits a zone's range in place and sends only what changed; a viewer sees no Edit", async () => {
  const api = open("/water/soil", { fixture: "in-band" });
  await load();
  fireEvent.click(screen.getByRole("button", { name: "Edit West moisture range" }));
  const form = within(screen.getByRole("form", { name: "Edit West moisture range" }));
  fireEvent.change(form.getByLabelText("Low end of the range"), { target: { value: "38" } });
  fireEvent.click(form.getByRole("button", { name: "Save" }));
  await advance(0);
  expect(writes(api).map((row) => [row.operationId, row.body])).toEqual([["API-SOIL-02", { min_pct: 38 }]]);
  cleanup(); stopFixtureApi();
  open("/water/soil", { fixture: ["in-band", "viewer-session"] });
  await load();
  expect(screen.queryByRole("button", { name: /moisture range/ })).toBeNull();
  expect(document.querySelectorAll("[data-write-control]")).toHaveLength(0);
});

test("Soil: when the soil target rows fail the page says so with Retry, and Stop all water stays", async () => {
  open("/water/soil", { fixture: "in-band", fail: { "API-SOIL-01": 503 } });
  await load();
  await advance(30_000);
  expect(screen.getAllByRole("button", { name: /Retry/ }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: /Stop all water|Stop all/ }).length).toBeGreaterThan(0);
});

test("History: the day's water from the daily record, named as the source, beside the per-line totals", async () => {
  open("/water/history", { fixture: "in-band" });
  await load();
  const record = panel("The day's water, from the daily record");
  expect(text(record)).toContain("Source: the daily record");
  expect(text(record)).toMatch(/Wetting|crop/i);
});

test("Today: Misting says whether misters and fog are wanted, from the law, and how the controller picks a zone", async () => {
  open("/water", { fixture: "in-band" });
  await load();
  const misting = panel("Misting");
  expect([...misting.querySelectorAll(".wat-mist-row")].map((row) => [row.getAttribute("data-rule"), text(row.querySelector(".wat-mist-head"))])).toEqual([
    ["mist", "Misters Not wanted"], ["fog", "Fog Not wanted"],
  ]);
  expect(text(misting)).toContain("center, south, west, east");
  expect(text(misting)).not.toMatch(/target|bypass|survival|burst|per-zone/i);
});
