// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Lights → Lights (screens section 4.1) against #1122's fixture API in process, with uPlot mocked. The fixture clock is
// 10:42 on 2026-11-02 (MST): both lights off as the controller wants (enough daylight).
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, media, setTokens } from "../charts/fixtures/uplot-mock";
import { text } from "../components/test-render";
import { ToastProvider } from "../components/toast";
import { SessionProvider } from "../lib/session";
import { OPERATOR, advance, renderWithApi, requests, startFixtureApi, stopFixtureApi, writes, type FixtureOptions } from "../lib/test-fixture-api";
import Lights from "./lights";

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));

async function open(options: FixtureOptions = {}, session = OPERATOR) {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
  const api = startFixtureApi(options);
  renderWithApi(<Lights />, session, "/lights");
  for (let pass = 0; pass < 6; pass++) {
    await advance(10);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
  return api;
}
afterEach(() => { cleanup(); stopFixtureApi(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style"); });

const panel = (name: string) => screen.getByRole("region", { name });

test("each circuit: the switch's state, what the controller wants and why, and today's window and time on", async () => {
  const api = await open();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Lights");
  // The answer first (design review A4), so the head carries no second status line.
  expect(text(document.querySelector("[data-answer]"))).toBe("Both lights are off, as the controller wants: enough daylight.");
  expect(text(document.querySelector(".page-status"))).toBe("");
  const main = panel("Main light");
  expect(text(main.querySelector(".lights-answer"))).toMatch(/^The switch reports it off since \d\d:\d\d\.$/);
  expect(text(main.querySelector(".lights-intent"))).toBe("The controller wants it off: enough daylight.");
  expect(main.querySelector(".lights-mismatch")).toBeNull();
  expect(text(main.querySelector(".lights-today"))).toMatch(/Light window\d\d:00–\d\d:00/);
  // The last seven local days, today included, from local midnight to local midnight.
  const week = requests(api, "API-22").map((row) => new URL(row.path, "http://x").searchParams);
  expect(week.map((query) => [query.get("from"), query.get("to")])).toEqual([["2026-10-27T06:00:00.000Z", "2026-11-03T07:00:00.000Z"]]);
});

test("a mismatch is called out on the circuit and in the answer", async () => {
  await open({ fixture: "grow-lights-differ" });
  expect(text(panel("Grow light").querySelector(".lights-mismatch"))).toBe("The switch reports off, but the controller wants it on.");
  expect(text(document.querySelector("[data-answer]"))).toMatch(/The grow light is off, but the controller wants it on/);
  const checks = panel("How they are switched");
  expect(text(checks.querySelector("[data-light=grow]"))).toContain("Not confirmed");
  expect(text(checks.querySelector("[data-light=main]"))).toContain("Confirmed");
});

test("Home Assistant down: the switches read stale and the page says the lights stay as they are", async () => {
  await open({ fixture: "ha-down" });
  expect(panel("Main light").getAttribute("data-state")).toBe("stale");
  const checks = panel("How they are switched");
  expect(text(checks)).toContain("If Home Assistant or the network is down, the lights stay as they are until it is back.");
  expect(text(checks.querySelector("[data-light=main]"))).toMatch(/Not reported.*has not reported for 11/);
});

test("an operator turns a light on for 30 minutes: one API-20 with those minutes", async () => {
  const api = await open({ fixture: "lights-confirmed" });
  const hand = panel("By hand");
  fireEvent.click(within(hand).getByRole("button", { name: "30 min" }));
  const main = within(hand).getByRole("region", { name: "Main light by hand" });
  fireEvent.click(within(main).getByRole("button", { name: /^Turn on 30 min/ }));
  await advance(10);
  const sent = writes(api).filter((row) => row.operationId === "API-20");
  expect(sent).toHaveLength(1);
  expect(sent[0].path).toMatch(/\/equipment\/lights\/main\/on$/);
  expect(sent[0].body).toEqual({ minutes: 30 });
});

test("the twelve settings of each circuit open their drawer on Settings", async () => {
  await open();
  const settings = panel("Settings");
  const main = within(settings).getByRole("region", { name: "Main light settings" });
  const links = within(main).getAllByRole("link");
  expect(links).toHaveLength(12);
  expect(links.map((link) => link.getAttribute("href"))).toContain("/settings?edit=gl_main_lux_threshold");
  expect([...main.querySelectorAll("h4")].map(text)).toEqual(["Window", "Daylight thresholds", "Hold times", "Out of service"]);
  expect(text(main.querySelector("[data-param=gl_main_lux_threshold]"))).toBe("On when daylight is below40,000 lx");
});

test("a viewer reads every block and has no write control", async () => {
  await open({}, { role: "viewer", writesEnabled: true });
  expect(screen.queryByRole("region", { name: "By hand" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Turn on|Turn off|Back to automatic/ })).toBeNull();
  expect(panel("Main light")).toBeTruthy();
  expect(panel("How they are switched")).toBeTruthy();
  expect(panel("Last 7 days")).toBeTruthy();
});

test("a failed equipment read shows its error with Retry in each circuit, and the settings still render", async () => {
  await open({ fail: { "API-13": 503 } });
  expect(text(panel("Main light"))).toContain("Couldn't load the main light.");
  expect(within(panel("Main light")).getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(within(panel("Settings")).getAllByRole("link").length).toBeGreaterThan(12);
});

test("no daily light integral and no retired word in the page", async () => {
  await open();
  expect(text(document.body)).not.toMatch(/DLI|[Dd]aily light integral|[Tt]arget|[Pp]lanner|\b[Mm]ode\b|[Tt]unable/);
});

test("the server render draws no greenhouse data", () => {
  const client = new QueryClient();
  const html = renderToString(<QueryClientProvider client={client}><SessionProvider apiDown={false}><ToastProvider><MemoryRouter initialEntries={["/lights"]}><Lights /></MemoryRouter></ToastProvider></SessionProvider></QueryClientProvider>);
  expect(html).not.toMatch(/style=/);
  expect(html).not.toContain("The switch reports");
});
