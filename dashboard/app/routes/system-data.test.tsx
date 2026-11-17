// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// System → Data (screens section 10.3) against the fixture API in process, with uPlot mocked. The clock is the screens'
// 10:42 America/Denver on 2026-11-02: flow, probes, continuity, delivery with the failing settings linking to their
// drawers, the ingestor counters, the ranges in the URL, and no write control for anyone.
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, media, setTokens } from "../charts/fixtures/uplot-mock";
import { text } from "../components/test-render";
import { OPERATOR, advance, renderWithApi, requests, startFixtureApi, stopFixtureApi, type FixtureOptions } from "../lib/test-fixture-api";
import type { Session } from "../lib/session";
import SystemData, { dataStatus } from "./system-data";

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));

async function open(options: FixtureOptions = {}, session: Partial<Session> = OPERATOR, path = "/system/data") {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
  const api = startFixtureApi(options);
  renderWithApi(<SystemData />, session, path);
  for (let pass = 0; pass < 6; pass++) {
    await advance(10);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
  return api;
}
afterEach(() => { cleanup(); stopFixtureApi(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style"); });

const panel = (name: string) => screen.getByRole("region", { name });
const RETIRED = /\b(plan|planner|waypoint|setpoint|tunable|burst|bypass|stage|scorecard|mode|target)s?\b/i;

test("flow, probes and continuity read API-36 in words: tables, ages, outages and replayed quarters", async () => {
  const api = await open();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Data");
  expect(text(document.querySelector(".page-status"))).toBe("Data flowing · every push taken");
  const flow = panel("Flow");
  expect(text(flow)).toContain("Ingestor heartbeat 20 s ago");
  expect(within(flow).getByRole("rowheader", { name: "Climate readings" })).toBeTruthy();
  expect(text(flow)).not.toMatch(/setpoint_snapshot|equipment_state/);
  expect(within(panel("Probes")).getByRole("rowheader", { name: "North temperature" })).toBeTruthy();
  const continuity = panel("Continuity");
  expect(text(continuity)).toContain("Gap log on, keeping a record");
  expect(within(continuity).getByRole("region", { name: "Outages" }).querySelectorAll("tbody tr").length).toBe(3);
  expect(within(continuity).getByRole("region", { name: "Replayed quarters" })).toBeTruthy();
  expect(new URL(requests(api, "API-36")[0].path, "http://x").searchParams.get("days")).toBe("1");
  for (const name of ["Flow", "Probes", "Continuity", "Delivery"]) expect(text(panel(name)), name).not.toMatch(RETIRED);
});

test("delivery: outcomes as a bar list and a table, the oldest unconfirmed, and each failing setting links to its drawer", async () => {
  await open({ fixture: "delivery-failing" });
  expect(text(document.querySelector(".page-status"))).toBe("5 settings not taken");
  const delivery = panel("Delivery");
  expect(within(delivery).getByRole("list", { name: "Pushes by outcome" }).querySelectorAll("li").length).toBe(6);
  expect(within(delivery).getByRole("region", { name: "Pushes by source and outcome" })).toBeTruthy();
  expect(text(delivery)).toContain("Waiting 30 min");
  expect(text(delivery)).toContain("2 changed of 102 read back");
  const failing = within(delivery).getByRole("region", { name: "Settings whose pushes failed" });
  const links = within(failing).getAllByRole("link");
  expect(links.length).toBe(5);
  expect(links.every((link) => /^\/settings\?edit=[\w%.-]+$/.test(link.getAttribute("href") ?? ""))).toBe(true);
});

test("the ranges come from the URL: 7 days of continuity, 7 days of delivery", async () => {
  const api = await open({}, OPERATOR, "/system/data?days=7&hours=168");
  expect(new URL(requests(api, "API-36")[0].path, "http://x").searchParams.get("days")).toBe("7");
  expect(new URL(requests(api, "API-37")[0].path, "http://x").searchParams.get("hours")).toBe("168");
});

test("a viewer sees the same page and no write control; the ingestor counters sit in a disclosure", async () => {
  await open({ fixture: "viewer-session" }, { role: "viewer", writesEnabled: true });
  expect(document.querySelectorAll("[data-write-control]").length).toBe(0);
  const counters = document.querySelector(".sys-counters details");
  expect(text(counters?.querySelector("summary"))).toBe("Ingestor counters");
  expect(text(counters)).toContain("Payloads rejected");
});

test("a failed delivery read is its own error; the other blocks stand", async () => {
  await open({ fail: { "API-37": 500 } });
  expect(panel("Delivery").getAttribute("data-state")).toBe("error");
  expect(panel("Flow").getAttribute("data-state")).toBe("ready");
});

test("the status line says what is missing first", () => {
  expect(dataStatus(null, null)).toBeNull();
  const continuity = { ingestor: { heartbeat_age_s: 600 }, probes: [{ sensor: "a", age_s: 7200 }, { sensor: "b", age_s: 3 }] } as never;
  expect(dataStatus(continuity, { failing: [{}] } as never)?.replaceAll(String.fromCharCode(0xa0), " ")).toBe("Ingestor heartbeat 10 min ago · 1 probe not seen in 2 h · 1 setting not taken");
});
