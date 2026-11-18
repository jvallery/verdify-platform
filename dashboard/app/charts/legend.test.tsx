// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
import { act, cleanup, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { media } from "./fixtures/uplot-mock";
import { ChartGroup, Legend, mergeGroupKeys, useChartGroupKey, type KeyItem, type LegendItem } from "./legend";

const ITEMS: LegendItem[] = [
  { key: "climate.temp_avg", label: "Indoor temperature", token: "--c-temp", shown: true },
  { key: "climate.outdoor_temp_f", label: "Outdoor temperature", token: "--c-outdoor", shown: false },
];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

test("the server renders the wide legend, and a phone hydrates it without a mismatch, then shows the disclosure", async () => {
  // The server has no viewport.
  vi.stubGlobal("matchMedia", undefined);
  const html = renderToString(<Legend items={ITEMS} onToggle={() => {}} />);
  expect(html).toMatch(/^<div class="chart-legend">/);
  expect(html).not.toMatch(/style=/);
  vi.stubGlobal("matchMedia", media({ narrow: true }));
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const errors: unknown[] = [];
  await act(async () => { hydrateRoot(container, <Legend items={ITEMS} onToggle={() => {}} />, { onRecoverableError: (error) => errors.push(error) }); });
  expect(errors).toEqual([]);
  expect(container.querySelector("details.chart-legend > summary")!.textContent).toBe("Legend");
  expect([...container.querySelectorAll("button")].map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
});

test("a group's key: each item once in first-seen order; one drawn in different colours reads neutral", () => {
  const heat: KeyItem[] = [{ key: "so-far", label: "lighter: so far", token: "--eq-heat1", kind: "outline" }, { key: "mean7", label: "7-day mean", token: "--text", kind: "line" }];
  const fan: KeyItem[] = [{ key: "so-far", label: "lighter: so far", token: "--eq-fan1", kind: "outline" }, { key: "mean7", label: "7-day mean", token: "--text", kind: "line" }, { key: "gap", label: "no record", token: "--text-3", kind: "hatch" }];
  expect(mergeGroupKeys([heat, fan]).map((item) => [item.key, item.token])).toEqual([["so-far", "--text-2"], ["mean7", "--text"], ["gap", "--text-3"]]);
  expect(mergeGroupKeys([heat, heat]).map((item) => item.token)).toEqual(["--eq-heat1", "--text"]);
  expect(mergeGroupKeys([])).toEqual([]);
});

function Small({ items }: { items: KeyItem[] }) {
  const grouped = useChartGroupKey(items);
  return <p className="small">{grouped ? "in a group" : "alone"}</p>;
}
test("a chart in a ChartGroup hands its key over and draws none; alone it keeps it; given items replace the merge; a chart leaving takes its items", async () => {
  const items: KeyItem[] = [{ key: "mean7", label: "7-day mean", token: "--text", kind: "line" }];
  expect(render(<Small items={items} />).container.textContent).toBe("alone");
  cleanup();
  const { rerender } = render(<ChartGroup label="Probes"><Small items={items} /><Small items={[{ key: "x", label: "Warning", token: "--warn", kind: "dashed" }]} /></ChartGroup>);
  const group = screen.getByRole("group", { name: "Probes" });
  expect([...group.querySelectorAll(".small")].map((item) => item.textContent)).toEqual(["in a group", "in a group"]);
  expect([...group.querySelectorAll(".chart-group-key li")].map((item) => item.textContent)).toEqual(["7-day mean", "Warning"]);
  expect(group.querySelector(".chart-group-key")?.getAttribute("aria-label")).toBe("Probes: key");
  await act(async () => { rerender(<ChartGroup label="Probes"><Small items={items} /></ChartGroup>); });
  expect([...group.querySelectorAll(".chart-group-key li")].map((item) => item.textContent)).toEqual(["7-day mean"]);
  await act(async () => { rerender(<ChartGroup label="Probes" items={[{ key: "y", label: "Band", token: "--c-band-edge", kind: "band" }]}><Small items={items} /></ChartGroup>); });
  expect([...group.querySelectorAll(".chart-group-key li")].map((item) => item.textContent)).toEqual(["Band"]);
});
