// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Climate → Drying's blocks from API-30 (screens §2.3): the verdict with the price against the limit on one bar, the
// meter since the last restart, and how drying works.
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import { parseLawView, type LawView } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { renderUi, text } from "../test-render";
import { DryingNowPanel, HowDryingWorks, MeterPanel, PriceBar, dryingAnswer, priceScale } from "./drying-blocks";

const NOW = "2026-11-02T17:42:00Z";
afterEach(() => { cleanup(); vi.useRealTimers(); });

function law(names: string | string[] = "in-band"): LawView {
  const view = parseLawView(fixture(names, { now: NOW })["API-30"]);
  if (!view) throw new Error("API-30 did not parse");
  return view;
}
const read = (data: LawView | null, over: Partial<PanelRead<LawView>> = {}): PanelRead<LawView> => ({ data, failed: false, pending: false, retry: () => undefined, ...over });
const section = (name: string) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;
const plain = (value: string) => value.replaceAll(String.fromCharCode(0xa0), " ");

test("the bar's scale fits both marks", () => {
  expect(priceScale(0.82, 0.7)).toBe(1.1);
  expect(priceScale(null, 0.7)).toBe(1);
  expect(priceScale(2, 0.7)).toBe(2.5);
});

test("the bar: over the limit the fill warns; with no price the track is hatched and says why", () => {
  const { container } = renderUi(<><PriceBar cost={0.82} limit={0.7} /><PriceBar cost={null} limit={0.7} /></>);
  const [over, none] = container.querySelectorAll("svg.price-bar");
  expect(over.querySelector(".price-fill")?.getAttribute("class")).toContain("is-over");
  expect(none.getAttribute("class")).toContain("is-unknown");
  expect(text(none)).toContain("no outdoor reading");
  expect(text(over)).toContain("Limit 0.70 kWh/kg");
});

test("the answer: running, refused with its one reason, or not wanted, each with the price now against the limit", () => {
  const answer = (over: Partial<LawView["drying"]>) => plain(dryingAnswer({ state: "refused", refused_reason: "cost", cost_kwh_per_kg: 0.82, limit_kwh_per_kg: 0.7, ...over }));
  expect(answer({})).toBe("Drying is wanted but refused: it would cost 0.82 kWh/kg and the limit is 0.70 kWh/kg.");
  expect(answer({ refused_reason: "furnace", cost_kwh_per_kg: 0.46 })).toBe("Drying is wanted but refused: the gas furnace is running. Its price now, 0.46 kWh/kg, is under the limit of 0.70 kWh/kg.");
  expect(answer({ refused_reason: "no_outdoor", cost_kwh_per_kg: null })).toBe("Drying is wanted but refused: no outdoor reading.");
  expect(answer({ refused_reason: "too_cold", cost_kwh_per_kg: null })).toMatch(/: the house is too cold to vent\. There is no price now: no outdoor reading\.$/);
  expect(answer({ state: "running", refused_reason: null, cost_kwh_per_kg: 0.7 })).toBe("Drying is running at 0.70 kWh/kg, at the limit of 0.70 kWh/kg.");
  expect(answer({ state: "running", refused_reason: null, cost_kwh_per_kg: 0.42 })).toBe("Drying is running at 0.42 kWh/kg, under the limit of 0.70 kWh/kg.");
  expect(answer({ state: "not_wanted", refused_reason: null, cost_kwh_per_kg: 0.93 })).toBe("Drying is not wanted: the air is not humid enough. Drying now would cost 0.93 kWh/kg, over the limit of 0.70 kWh/kg.");
  expect(answer({ state: "unknown", refused_reason: null })).toBe("The controller has not reported its drying decision.");
});

test("drying now: the answer first, the verdict as the head's pill, the price against the limit and today so far", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(NOW));
  renderUi(<DryingNowPanel read={read(law("law-drying-refused-cost"))} />);
  const panel = section("Drying now");
  expect(text(panel.querySelector(".card-title-row"))).toContain("Refused");
  expect(plain(text(panel.querySelector(".drying-answer")))).toBe("Drying is wanted but refused: it would cost 0.82 kWh/kg and the limit is 0.70 kWh/kg.");
  expect(text(panel)).toMatch(/Today so far: /);
});

test("the meter: the controller's own counts since its restart; empty before it reports", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(NOW));
  const view = law();
  renderUi(<MeterPanel read={read(view)} />);
  const panel = section("Meter since the last restart");
  expect(text(panel)).toContain("2 min");
  expect(text(panel)).toContain("0.25 kg");
  expect(text(panel)).toContain("0.72 kWh/kg");
  cleanup();
  renderUi(<MeterPanel read={read({ ...view, drying: { ...view.drying, meter: { ...view.drying.meter, observed_at: null } } })} />);
  expect(section("Meter since the last restart").getAttribute("data-state")).toBe("empty");
});

test("how drying works names the six checks in the law's order with the thresholds in force", () => {
  renderUi(<HowDryingWorks view={law()} />);
  const steps = [...document.querySelectorAll(".drying-steps li")].map((item) => plain(text(item)));
  expect(steps.length).toBe(6);
  expect(steps[0]).toContain("0.50 kPa");
  expect(steps[3]).toContain("62.7 °F");
  renderUi(<HowDryingWorks view={null} />);
  expect(text(document.body)).toContain("a line just above the band's low VPD edge");
});
