// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// System → Controller (screens section 10.2) against the fixture API in process, with uPlot mocked. The clock is the
// screens' 10:42 America/Denver on 2026-11-02: the verdict in words from API-35's limits, the budget tiles with their
// meters, identity, links, the law's state, the trends' keys from the registry, and Restart for operators only.
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, media, setTokens } from "../charts/fixtures/uplot-mock";
import { text } from "../components/test-render";
import { OPERATOR, advance, renderWithApi, requests, startFixtureApi, stopFixtureApi, writes, type FixtureOptions } from "../lib/test-fixture-api";
import type { Session } from "../lib/session";
import SystemController, { controllerStatus } from "./system-controller";

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));

async function open(options: FixtureOptions = {}, session: Partial<Session> = OPERATOR, path = "/system/controller") {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
  const api = startFixtureApi(options);
  renderWithApi(<SystemController />, session, path);
  for (let pass = 0; pass < 6; pass++) {
    await advance(10);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
  return api;
}
afterEach(() => { cleanup(); stopFixtureApi(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style"); });

const panel = (name: string) => screen.getByRole("region", { name });
const tile = (key: string) => document.querySelector(`[data-budget="${key}"]`);

test("healthy: the verdict, six budget tiles each with a meter, identity, links and the law's state", async () => {
  await open();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Controller");
  expect(text(document.querySelector(".page-status"))).toMatch(/^Up 3 d 3 h · reported \d\d:\d\d$/);
  expect(text(panel("Verdict"))).toContain("The controller is healthy: every part of the hardware budget is inside its limits.");
  const budget = panel("Hardware budget");
  expect([...budget.querySelectorAll("[data-budget]")].map((node) => node.getAttribute("data-budget"))).toEqual(["memory", "block", "loop", "write", "stack", "entries"]);
  expect(budget.querySelectorAll("svg.sys-meter").length).toBe(6);
  expect(text(tile("memory"))).toContain("Warning under 25 kB, critical under 15 kB");
  expect(text(panel("Identity and uptime"))).toContain("2026.10.30.1412.3240714");
  expect(text(panel("Links"))).toContain("Wi-Fi signal");
  const law = panel("Law state");
  expect(text(law)).toContain("Match this release.");
  expect(within(law).getByRole("list", { name: "What the controller needs to run alone" })).toBeTruthy();
});

test("memory low: the verdict names the first limit crossed and counts the rest; the tiles say which line", async () => {
  await open({ fixture: "controller-heap-low" });
  expect(text(document.querySelector(".page-status"))).toMatch(/^Up /);
  expect(text(panel("Verdict"))).toContain("Free memory fell to 24 kB in the last minute, under the warning line of 25 kB: memory is running short.");
  expect(text(panel("Verdict"))).toContain("2 more limits are crossed");
  expect(tile("memory")?.getAttribute("data-level")).toBe("warn");
  expect(text(tile("memory"))).toContain("Below warning");
  expect(text(tile("memory"))).toContain("Lowest in the last minute");
  expect(tile("loop")?.getAttribute("data-level")).toBe("ok");
});

test("the gap log stopped: storage nearly full is critical", async () => {
  await open({ fixture: "gap-log-off" });
  expect(tile("entries")?.getAttribute("data-level")).toBe("critical");
  expect(text(panel("Verdict"))).toContain("the gap log stops: storage is nearly full");
});

test("the trends ask API-04 for the registry's controller keys, 24 h by default and 7 d from the URL", async () => {
  const api = await open();
  expect(requests(api, "API-03").length).toBeGreaterThan(0);
  const query = new URL(requests(api, "API-04")[0].path, "http://x").searchParams;
  expect(query.getAll("metric")).toEqual(["diagnostics.heap_minute_low_kb", "diagnostics.heap_largest_block_minute_low_kb", "diagnostics.loop_worst_ms", "diagnostics.nvs_write_worst_ms",
    "diagnostics.rssi_dbm"]);
  expect((Date.parse(query.get("to")!) - Date.parse(query.get("from")!)) / 3_600_000).toBe(24);
  cleanup(); stopFixtureApi();
  const week = await open({}, OPERATOR, "/system/controller?trend=7d");
  const weekly = new URL(requests(week, "API-04")[0].path, "http://x").searchParams;
  expect((Date.parse(weekly.get("to")!) - Date.parse(weekly.get("from")!)) / 86_400_000).toBe(7);
});

test("Restart: an operator opens the disclosure, reads what it interrupts, and sends one {kind: restart}", async () => {
  const api = await open({ fixture: "restart-uptime-reset" });
  const section = screen.getByRole("region", { name: "Restart the controller" });
  expect(text(section)).toContain("A run by hand ends");
  fireEvent.click(within(section).getByRole("button", { name: "Restart controller" }));
  await advance(0);
  expect(writes(api)).toEqual([expect.objectContaining({ operationId: "API-IRR-12", body: { kind: "restart" } })]);
  expect(within(section).getByRole("button", { name: "Restart sent" })).toBeTruthy();
});

test("a viewer sees no Restart and no write control", async () => {
  await open({ fixture: "viewer-session" }, { role: "viewer", writesEnabled: true });
  expect(screen.queryByRole("region", { name: "Restart the controller" })).toBeNull();
  expect(document.querySelectorAll("[data-write-control]").length).toBe(0);
  expect(panel("Verdict")).toBeTruthy();
});

test("a failed health read is each block's own error; the status line waits", async () => {
  await open({ fail: { "API-35": 500 } });
  expect(panel("Verdict").getAttribute("data-state")).toBe("error");
  expect(panel("Identity and uptime").getAttribute("data-state")).toBe("error");
  expect(document.querySelector(".page-status")?.textContent ?? "").not.toContain("Up ");
  expect(controllerStatus(null)).toBeNull();
  expect(controllerStatus({ observed_at: null } as never)).toBe("Not reporting");
});
