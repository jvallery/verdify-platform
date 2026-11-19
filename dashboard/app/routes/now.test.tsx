// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Now (dashboard v2 screens §1) in the shell against #1122's fixture API in process, at 10:42 America/Denver: the answer
// and the two band gauges, the controller's sentence from the law, Needs you, Today, Run by hand, Water today with Stop
// all water, the review, the reservoir and the probes; one API-02 request serving the shell and Now and no plan read; the
// degraded states; Stop all water and a run by hand end to end; the writes flag and roles; and no greenhouse data in the
// server render.
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { AppShell } from "../components/app-shell";
import { text } from "../components/test-render";
import { FakeResizeObserver, media, setTokens } from "../charts/fixtures/uplot-mock";
import { advance, requests, sentAt, startFixtureApi, stopFixtureApi, writes, type FixtureOptions } from "../lib/test-fixture-api";
import Now from "./now";

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));
afterEach(() => { cleanup(); stopFixtureApi(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style"); });

const BUILD = "fedcba9876543210fedcba9876543210fedcba98";
function stub() {
  return createRoutesStub([{
    path: "/", Component: () => <AppShell build={BUILD} authError={null} />,
    children: [{ index: true, Component: Now }, { path: "activity", Component: () => <p>Activity</p> }, { path: "climate", Component: () => <p>Climate</p> }],
  }]);
}
async function open(fixture: FixtureOptions["fixture"], options: Omit<FixtureOptions, "fixture"> = {}, path = "/") {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
  const api = startFixtureApi({ fixture, ...options });
  const Stub = stub();
  render(<Stub initialEntries={[path]} />);
  for (let pass = 0; pass < 3; pass++) {
    await advance(0);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
  return api;
}
const plain = (value: string) => value.replaceAll(String.fromCharCode(0xa0), " ");
const answer = () => plain(text(screen.getByRole("heading", { level: 1 })));
const banners = () => [...document.querySelectorAll("[data-banner]")].map((node) => plain(text(node)));
const doing = () => plain(text(document.querySelector("#doing [data-doing]")));
const relays = () => [...document.querySelectorAll("#doing [data-chip=relay]")].map((node) => plain(text(node)));
const main = () => plain(text(document.querySelector("main")));
const toasts = (role: "status" | "alert") => [...screen.getByRole(role).querySelectorAll(".toast-body")]
  .map((body) => [...body.querySelectorAll("p")].map((line) => plain(text(line))).join(" "));
// The page's own Stop: the top bar holds a second one for an operator, so the page's is found inside <main>.
const stopButton = () => within(screen.getByRole("main")).queryByRole("button", { name: /^(Stop all water|Sending…)$/ });
/** The retired words (words.md §3): none reads on Now. */
const RETIRED = /\b(plan|planned|planner|waypoint|mode|stage|target|bias|tunable|cascade|scorecard|dispatcher|burst|bypass|DERIVED|Iris)\b|zone band|crop band|In band, holding|Iris changed/i;

test("in band: All OK, two gauges, the controller's sentence from the law, Needs you empty, Water today with Stop all water, and no retired word", async () => {
  await open("in-band");
  expect(answer()).toBe("All OK");
  expect([...document.querySelectorAll(".now-band")].map((row) => row.getAttribute("data-tile"))).toEqual(["temp", "vpd"]);
  expect(banners()).toEqual([]);
  expect(doing()).not.toBe("");
  expect(document.querySelector("#doing [data-doing]")?.getAttribute("data-doing")).not.toBe("unknown");
  expect(within(document.querySelector<HTMLElement>("#doing")!).getByRole("link", { name: /^Why/ }).getAttribute("href")).toBe("/climate");
  expect(text(document.querySelector("#needs-you .panel-empty p"))).toMatch(/^Nothing needs you\./);
  expect(plain(text(document.querySelector("[data-water=center] .now-water-amount")))).toBe("14 / 120 min");
  expect(stopButton()?.hasAttribute("disabled")).toBe(false);
  expect(stopButton()?.closest(".now-stop")).not.toBeNull();
  expect(document.querySelector("#run-by-hand")).not.toBeNull();
  expect(document.querySelector("#today")).not.toBeNull();
  expect(document.querySelector("#daily-review")).not.toBeNull();
  expect(document.querySelector("#probes")).not.toBeNull();
  expect(main()).not.toMatch(RETIRED);
  expect(document.querySelector(".now-slot-today > .panel-error, .now-slot-today .panel > .panel-error")).toBeNull();
});

test("one API-02 request serves the shell and Now; API-02, API-IRR-01 and API-14 poll every 15 s; no plan and no zone band is read", async () => {
  const api = await open("in-band");
  expect(sentAt("API-02")).toEqual([0]);
  expect(sentAt("API-14")).toEqual([0]);
  await advance(15_000);
  expect(sentAt("API-02")).toEqual([0, 15_000]);
  expect(sentAt("API-14")).toEqual([0, 15_000]);
  expect(requests(api).filter((row) => /\/v1\/plan(ner)?(\/|\?|$)/.test(row.path))).toEqual([]);
  expect(requests(api, "API-05")).toEqual([]);
  // The one house band (API-06 zone=house for the charts); never a zone's own band.
  expect(requests(api, "API-06").every((row) => new URL(row.path, "http://dashboard.invalid").searchParams.get("zone") === "house")).toBe(true);
});

test("the blocks in the phone's order are all present, hero first, then the controller's sentence", async () => {
  await open("in-band");
  const slots = ["hero", "doing", "needs", "today", "runs", "water", "review", "reservoir", "probes"].map((slot) => document.querySelector(`.now-slot-${slot}`));
  expect(slots.every(Boolean)).toBe(true);
  expect(slots[0]!.compareDocumentPosition(slots[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("with the heartbeat old and with the controller silent: the answer names it, the sentence is unknown, never nothing", async () => {
  await open("ingestor-not-running");
  expect(answer()).not.toBe("All OK");
  expect(document.querySelector("#doing [data-doing]")?.getAttribute("data-doing")).toBe("unknown");
  cleanup();
  stopFixtureApi();
  await open("controller-not-reporting");
  expect(document.querySelector("#doing [data-doing]")?.getAttribute("data-doing")).toBe("unknown");
  expect(main()).not.toMatch(/Nothing is running/);
});

test("API-02 failing: the answer says so at once, the banner after the second failure, no gauges and nothing green", async () => {
  await open("in-band", { fail: { "API-02": 503 } });
  expect(answer()).toBe("Can't reach the greenhouse data");
  expect(banners()).toEqual([]);
  await advance(30_000);
  expect(banners()).toEqual(["Dashboard API unavailable"]);
  expect(document.querySelector(".now-bands")).toBeNull();
  expect(text(document.body)).not.toMatch(/All OK|in band/i);
  // Today says its read failed, never a guess; no boundary caught a throw.
  expect(document.querySelector(".now-slot-today .panel-error")).toBeNull();
  expect(document.querySelector(".badge-ok, .tag-ok, .fresh-ok")).toBeNull();
});

test("Stop all water: one API-IRR-07 request, the relay edge takes the wet chip off, and the toast offers Disable", async () => {
  const api = await open("l01-running");
  expect(relays().some((chip) => chip.startsWith("Wall drip"))).toBe(true);
  fireEvent.click(stopButton()!);
  expect(document.querySelector("dialog")).toBeNull();
  await advance(0);
  expect(writes(api)).toEqual([expect.objectContaining({ method: "POST", operationId: "API-IRR-07", body: {} })]);
  expect(text(document.querySelector(".now-stop"))).toContain("Waiting for the valves to read off");
  await advance(5000);
  await advance(1000);
  expect(relays().some((chip) => chip.startsWith("Wall drip"))).toBe(false);
  expect(toasts("status")[0]).toMatch(/^Stopped every running valve\./);
  expect(screen.getByRole("button", { name: "Disable Wall drip" })).toBeTruthy();
});

test("Run the fans from Run by hand: one API-IRR-12 with no dialog, then its time left once the controller reads it back, and its Stop clears it", async () => {
  const api = await open("in-band");
  const panel = document.querySelector<HTMLElement>("#run-by-hand")!;
  fireEvent.click(within(panel).getByRole("button", { name: "Run the fans, 15 min" }));
  await advance(0);
  expect(writes(api)).toEqual([expect.objectContaining({ method: "POST", operationId: "API-IRR-12", body: { kind: "fans", minutes: 15 } })]);
  expect(document.querySelector("dialog")).toBeNull();
  await advance(5000);
  await advance(1);
  expect(plain(text(panel.querySelector("[data-run=fans] [data-run-left]")))).toMatch(/^Run the fans · \d+ min left$/);
  fireEvent.click(within(panel).getByRole("button", { name: "Stop: Run the fans" }));
  await advance(0);
  expect(writes(api).at(-1)).toMatchObject({ operationId: "API-IRR-12", body: { kind: "clear" } });
  expect(text(panel.querySelector("[data-runs=limits]"))).toMatch(/end any run by hand/);
});

test("with changes switched off Stop stays live while the runs and Acknowledge are disabled; a viewer sees no write control at all", async () => {
  await open(["alerts-merged", "writes-off"]);
  expect(stopButton()?.hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("button", { name: "Humidify, 5 min" }).hasAttribute("disabled")).toBe(true);
  expect(within(document.querySelector<HTMLElement>("#needs-you")!).getAllByRole("button", { name: /^Acknowledge/ }).every((button) => button.hasAttribute("disabled"))).toBe(true);
  cleanup();
  stopFixtureApi();
  await open(["alerts-merged", "viewer-session"]);
  expect(text(document.querySelector(".role-pill"))).toBe("Viewer");
  expect(stopButton()).toBeNull();
  expect(document.querySelector("#run-by-hand")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Acknowledge/ })).toBeNull();
  expect(document.querySelectorAll("[data-write-control]")).toHaveLength(0);
});

test("Needs you: a late review and a waiting proposal, each with Open into Review; the settings not confirmed go to System → Data", async () => {
  await open(["review-proposal-waiting", "settings-unconfirmed"]);
  const needs = document.querySelector<HTMLElement>("#needs-you")!;
  expect(within(needs.querySelector<HTMLElement>("[data-needs=proposal]")!).getByRole("link", { name: /^Open/ }).getAttribute("href")).toBe("/review");
  expect(within(needs).getByRole("link", { name: /settings? not confirmed/ }).getAttribute("href")).toBe("/system/data");
});

test("the answer is never a link, and the freshness link opens All readings in place", async () => {
  await open("in-band", {}, "/#data");
  expect(screen.getByRole("heading", { level: 1 }).querySelector("a")).toBeNull();
  expect(document.querySelector<HTMLDetailsElement>("details.now-readings")!.open).toBe(true);
});

test("the server render carries no greenhouse data: Now's loading state only, and no request", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const Stub = stub();
  const html = renderToString(<Stub initialEntries={["/"]} />);
  expect(html).toContain("Checking the greenhouse…");
  expect(html).not.toMatch(/All OK|Nothing is running|Nothing needs you|Stop all water|In band today/);
  expect(html).not.toMatch(/\sstyle=/);
  expect(fetch).not.toHaveBeenCalled();
});
