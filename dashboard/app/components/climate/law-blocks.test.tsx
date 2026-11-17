// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Climate → Law's blocks (screens §2.1) on the fixture law at 10:42 on Monday 2026-11-02: the ladder and its list, the
// rules table's sentences and states, the drying decision, the band in force, running alone, and the four states.
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import { parseLawView, type LawView } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { renderUi, text } from "../test-render";
import { BandInForcePanel, DryingDecisionPanel, RulesPanel, RunningAlonePanel, TimingPanel, lawPanelState, lawStatusParts } from "./law-blocks";
import { RuleLadder } from "./rule-ladder";

const NOW = "2026-11-02T17:42:00Z";
afterEach(() => { cleanup(); vi.useRealTimers(); });

function law(names: string | string[] = "in-band"): LawView {
  const view = parseLawView(fixture(names, { now: NOW })["API-30"]);
  if (!view) throw new Error("API-30 did not parse");
  return view;
}
const read = (data: LawView | null, over: Partial<PanelRead<LawView>> = {}): PanelRead<LawView> => ({ data, failed: false, pending: false, retry: () => undefined, ...over });
const section = (name: string) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;
function at(now = NOW) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(now));
}

test("the panel state: loading, error, stale on a failed poll or a silent controller, empty before a first record", () => {
  const view = law();
  expect(lawPanelState(read(null, { pending: true }))).toBe("loading");
  expect(lawPanelState(read(null, { failed: true }))).toBe("error");
  expect(lawPanelState(read(view, { failed: true }))).toBe("stale");
  expect(lawPanelState(read({ ...view, observed_at: null }))).toBe("empty");
  expect(lawPanelState(read({ ...view, reporting: false }))).toBe("stale");
  expect(lawPanelState(read({ ...view, reporting: false }), false)).toBe("ready");
  expect(lawPanelState(read(view))).toBe("ready");
  expect(lawStatusParts(view)).toEqual({ reporting: "Reporting", constants: "Its constants match this release" });
  expect(lawStatusParts({ ...view, reporting: false }).reporting).toBe("Not reporting");
});

test("the rules: each signal's ladder lists every rule, the band's edges and the reading in order; the table reads the sentence and state", () => {
  at();
  renderUi(<RulesPanel read={read(law("law-drying-refused-cost"))} />);
  const rules = section("Rules at the band's edges");
  expect(within(rules).getByRole("heading", { name: /^Temperature/ })).toBeTruthy();
  expect(within(rules).getByRole("heading", { name: /^VPD/ })).toBeTruthy();
  const lists = rules.querySelectorAll("ol.ladder-list");
  expect(lists.length).toBe(2);
  const temp = [...lists[0].querySelectorAll("li")].map((item) => text(item.querySelector(".ladder-item-name")));
  expect(temp[0]).toMatch(/^Cold limit/);
  expect(temp.at(-1)).toMatch(/^Hot limit/);
  expect(temp).toContain("Now");
  expect(temp.filter((item) => item.endsWith("edge of the band")).length).toBe(2);
  expect(text(rules)).toContain("Turns on below 64.7 °F, off at 65.7 °F");
  expect(text(rules)).toContain("On since 10:38");
  expect(text(rules)).toContain("Wanted");
  // The SVG ticks are named for a screen reader, as the list is.
  expect(rules.querySelectorAll("svg.ladder-svg [role=img]").length).toBeGreaterThan(0);
});

test("a ladder with nothing to place says so", () => {
  renderUi(<RuleLadder label="VPD" unit="kPa" band={null} reading={null} rules={[]} />);
  expect(screen.getByText("VPD: not reported.")).toBeTruthy();
});

test("the drying decision: the checklist with the failed check, the verdict and the link to Drying", () => {
  at();
  renderUi(<DryingDecisionPanel read={read(law("law-drying-refused-cost"))} />);
  const panel = section("Drying decision");
  expect(text(panel)).toContain("Refused: costs more than the limit");
  expect(text(panel)).toContain("Price 0.82 kWh/kg, limit 0.70 kWh/kg.");
  expect(within(panel).getByRole("link", { name: /Drying/ }).getAttribute("href")).toBe("/climate/drying");
});

test("the band in force, running alone and the timing read their words; a repaired band warns", () => {
  at();
  renderUi(<><BandInForcePanel read={read(law("law-band-repaired"))} /><RunningAlonePanel read={read(law("gap-log-off"))} /><TimingPanel read={read(law())} /></>);
  const band = section("Band in force");
  expect(band.className).toContain("tone-warn");
  expect(text(band)).toContain("repaired the band it received");
  const alone = section("Running alone");
  expect(alone.className).toContain("tone-warn");
  expect(text(document.body)).toContain("Timing and constants");
});

test("no record yet is the empty state; a failed first read is the error state with Retry", () => {
  renderUi(<><DryingDecisionPanel read={read({ ...law(), observed_at: null })} /><BandInForcePanel read={read(null, { failed: true })} /></>);
  expect(section("Drying decision").getAttribute("data-state")).toBe("empty");
  expect(section("Band in force").getAttribute("data-state")).toBe("error");
  expect(within(section("Band in force")).getByRole("button", { name: /Retry/ })).toBeTruthy();
});
