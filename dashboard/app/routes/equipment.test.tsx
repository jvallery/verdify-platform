// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// System → Equipment (screens section 10.1) against the fixture API in process, with uPlot mocked. The clock is the
// screens' 10:42 America/Denver on 2026-11-02: the climate relays with their why in the law's words, the water relays,
// the lights as state only, the flags, the relay lanes, a viewer, and a block's own error.
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, media, setTokens } from "../charts/fixtures/uplot-mock";
import { text } from "../components/test-render";
import { OPERATOR, advance, renderWithApi, requests, startFixtureApi, stopFixtureApi, type FixtureOptions } from "../lib/test-fixture-api";
import type { Session } from "../lib/session";
import Equipment, { equipmentStatus, runningSentence } from "./equipment";

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));

async function open(options: FixtureOptions = {}, session: Partial<Session> = OPERATOR, path = "/system/equipment") {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
  const api = startFixtureApi(options);
  renderWithApi(<Equipment />, session, path);
  for (let pass = 0; pass < 6; pass++) {
    await advance(10);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
  return api;
}
afterEach(() => { cleanup(); stopFixtureApi(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style"); });

const panel = (name: string) => screen.getByRole("region", { name });
const relay = (key: string) => document.querySelector(`.sys-relay[data-equipment="${key}"]`);

test("the answer says what runs; the climate relays each say their state, since, today so far and why in the law's words", async () => {
  await open();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Equipment");
  expect(text(panel("Answer"))).toMatch(/\.$/);
  const climate = panel("Climate relays");
  expect([...climate.querySelectorAll(".sys-relay")].map((row) => row.getAttribute("data-equipment"))).toEqual(["heat1", "heat2", "fan1", "fan2", "vent", "fog"]);
  for (const key of ["heat1", "heat2", "fan1", "fan2", "vent", "fog"]) {
    const row = relay(key)!;
    expect(text(row.querySelector(".sys-relay-facts"))).toMatch(/today/);
    expect(text(row.querySelector(".sys-relay-why"))).not.toBe("");
    expect(within(row as HTMLElement).queryByRole("link", { name: /^Climate law/ })).toBeNull();
  }
  expect(within(climate).getByRole("link", { name: /^Climate law/ }).getAttribute("href")).toBe("/climate");
  expect(text(climate)).not.toMatch(/\b(plan|planner|waypoint|setpoint|tunable|burst|stage)\b/i);
});

test("water relays, the lights as state with a link, flags and the lanes; the old controller card and why panel are gone", async () => {
  const api = await open();
  expect(panel("Water relays").querySelectorAll(".sys-relay").length).toBeGreaterThan(0);
  const lights = panel("Lights");
  expect(within(lights).getByRole("link", { name: /Light controls/ }).getAttribute("href")).toBe("/lights");
  expect(within(lights).queryByRole("button")).toBeNull();
  expect(panel("Flags")).toBeTruthy();
  expect(panel("Last 24 h")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Controller" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Why" })).toBeNull();
  expect(requests(api, "API-05").length).toBeGreaterThan(0);
  expect(text(document.querySelector(".page-status"))).toMatch(/climate relays? on|Relay states are not reported/);
});

test("72 h lanes from the URL", async () => {
  const api = await open({}, OPERATOR, "/system/equipment?range=72h");
  expect(panel("Last 72 h")).toBeTruthy();
  const query = new URL(requests(api, "API-05")[0].path, "http://x").searchParams;
  expect((Date.parse(query.get("to")!) - Date.parse(query.get("from")!)) / 3_600_000).toBe(72);
});

test("Run by hand sits on the page: an operator has its buttons, a viewer reads what runs and sees no write control", async () => {
  await open();
  expect(within(panel("Run by hand")).getAllByRole("button").length).toBeGreaterThan(0);
  cleanup(); stopFixtureApi();
  await open({ fixture: "viewer-session" }, { role: "viewer", writesEnabled: true });
  expect(panel("Run by hand")).toBeTruthy();
  expect(within(panel("Run by hand")).queryAllByRole("button")).toEqual([]);
  expect(document.querySelectorAll("[data-write-control]").length).toBe(0);
});

test("the law not reporting says why is not known; a failed equipment read is the block's own error", async () => {
  await open({ fixture: "law-not-reporting" });
  expect(text(relay("heat1")?.querySelector(".sys-relay-why"))).toContain("why is not known");
  cleanup(); stopFixtureApi();
  await open({ fail: { "API-13": 500 } });
  expect(panel("Climate relays").getAttribute("data-state")).toBe("error");
  expect(panel("Flags")).toBeTruthy();
});

test("the status line counts the climate relays on", () => {
  const item = (equipment: string, state: string, group = "climate") => ({ equipment, state, group }) as never;
  expect(equipmentStatus(null)).toBeNull();
  expect(equipmentStatus({ items: [item("heat1", "on"), item("fan1", "off"), item("wall_drip", "on", "water")] } as never)).toBe("1 of 6 climate relays on · 1 water line on");
  expect(equipmentStatus({ items: [] } as never)).toBe("Relay states are not reported");
});

test("the answer names what runs, the vent as open, and says when nothing does", () => {
  const item = (equipment: string, state: string, group = "climate", label: string | null = null) => ({ equipment, state, group, label }) as never;
  const off = ["heat1", "heat2", "fan1", "fan2", "vent", "fog"].map((key) => item(key, "off"));
  expect(runningSentence(null)).toBeNull();
  expect(runningSentence({ items: [] } as never)).toBe("The controller has not reported its relays.");
  expect(runningSentence({ items: off } as never)).toBe("Nothing is running: every climate relay is off, the vent is closed and no water line is on.");
  expect(runningSentence({ items: [item("heat1", "on", "climate", "Heat 1 electric"), ...off.slice(1)] } as never)).toBe("Heat 1 electric is on; no water line is on.");
  expect(runningSentence({ items: [...off.slice(0, 4), item("vent", "on"), off[5], item("wall_drip", "on", "water", "Wall drip")] } as never)).toBe("The vent is open and Wall drip is watering.");
});
