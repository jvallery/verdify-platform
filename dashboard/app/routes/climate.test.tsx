// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Climate → Law and Climate → Drying (screens §2.1 and §2.3) against the fixture API in process, with uPlot mocked, at
// the screens' 10:42 America/Denver on 2026-11-02: every block answers, the windows read API-31 with their own span,
// the controller not reporting goes stale, a failed read is the error state, and a viewer has no control.
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, media, setTokens } from "../charts/fixtures/uplot-mock";
import { text } from "../components/test-render";
import { OPERATOR, advance, renderWithApi, requests, startFixtureApi, stopFixtureApi, type FixtureOptions } from "../lib/test-fixture-api";
import type { Session } from "../lib/session";
import ClimateDrying from "./climate-drying";
import ClimateLaw from "./climate";

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));

async function open(page: "law" | "drying", options: FixtureOptions = {}, session: Partial<Session> = OPERATOR) {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
  const api = startFixtureApi(options);
  renderWithApi(page === "law" ? <ClimateLaw /> : <ClimateDrying />, session, page === "law" ? "/climate" : "/climate/drying");
  for (let pass = 0; pass < 6; pass++) {
    await advance(10);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
  return api;
}
afterEach(() => { cleanup(); stopFixtureApi(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style"); });

const panel = (name: string) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;
const windowOf = (path: string) => {
  const query = new URL(path, "http://x").searchParams;
  return (Date.parse(query.get("to") ?? "") - Date.parse(query.get("from") ?? "")) / 1000;
};

test("Law: the header's status, the rules, the side blocks, the lanes and the timing all answer", async () => {
  const api = await open("law", { fixture: "law-drying-refused-cost" });
  expect(text(document.querySelector(".page-header, header"))).toMatch(/Reporting/);
  for (const name of ["Rules at the band's edges", "Drying decision", "Band in force", "Running alone", "Asked and ran"]) {
    expect(panel(name).getAttribute("data-state"), name).toBe("ready");
  }
  expect(text(document.body)).toContain("Timing and constants");
  expect(requests(api, "API-31").length).toBeGreaterThan(0);
  expect(requests(api, "API-05").length).toBeGreaterThan(0);
});

test("Law's lanes switch windows: 72 h asks API-31 for three days", async () => {
  const api = await open("law");
  fireEvent.click(within(panel("Asked and ran")).getByRole("button", { name: "72 h" }));
  await advance(10);
  expect(requests(api, "API-31").map((row) => windowOf(row.path))).toContain(3 * 86_400);
});

test("with the controller not reporting the law's blocks are stale, never ready", async () => {
  await open("law", { fixture: "law-not-reporting" });
  expect(panel("Rules at the band's edges").getAttribute("data-state")).toBe("stale");
  expect(text(document.body)).toMatch(/Not reporting/);
});

test("a failed law read is the error state with Retry on each block", async () => {
  await open("law", { fail: { "API-30": 503 } });
  for (const name of ["Rules at the band's edges", "Drying decision", "Band in force"]) {
    expect(panel(name).getAttribute("data-state"), name).toBe("error");
    expect(within(panel(name)).getByRole("button", { name: /Retry/ })).toBeTruthy();
  }
});

test("Drying: now, the limit, the price against the limit, by day, the meter and how drying works", async () => {
  const api = await open("drying", { fixture: "law-drying-refused-cost" });
  for (const name of ["Drying now", "Drying cost limit", "Price against limit", "By day", "Meter since the last restart"]) {
    expect(panel(name).getAttribute("data-state"), name).toBe("ready");
  }
  expect(text(panel("Drying now"))).toContain("Refused: costs more than the limit");
  expect(text(document.body)).toContain("How drying works");
  expect(requests(api, "API-32").length).toBeGreaterThan(0);
  fireEvent.click(within(panel("Price against limit")).getByRole("button", { name: "31 d" }));
  await advance(10);
  expect(requests(api, "API-31").map((row) => windowOf(row.path))).toContain(31 * 86_400);
});

test("a viewer reads Drying with no write control", async () => {
  await open("drying", {}, { role: "viewer", writesEnabled: true });
  expect(screen.queryByRole("textbox", { name: "New limit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(text(panel("Drying cost limit"))).toContain("0.70 kWh/kg");
});
