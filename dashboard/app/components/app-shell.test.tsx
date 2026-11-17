// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// The shell against #1122's fixture API in process (fetch is stubbed onto createFixtureHandler): the polls, the banners
// on every page, the nav count, role gating and the changes-off state, the session-ended card and SCR-09's sign-in
// pages. Times are America/Denver with the fixture clock at 10:42.
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { useMutation } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub, useLoaderData, useLocation } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFixtureHandler } from "../../e2e/fixture-api.mjs";
import { REVISION } from "../../e2e/fixtures/world.mjs";
import { FakeResizeObserver, MockPlot } from "../charts/fixtures/uplot-mock";
import routes from "../routes";
import Activity from "../routes/activity";
import ActivityLog from "../routes/activity-log";
import Band from "../routes/band";
import ClimateLaw from "../routes/climate";
import ClimateDrying from "../routes/climate-drying";
import CropsRoute from "../routes/crops";
import CropsHistory from "../routes/crops-history";
import CropsMap from "../routes/crops-map";
import Equipment from "../routes/equipment";
import Graphs from "../routes/graphs";
import GraphsLighting from "../routes/graphs.lighting";
import GraphZones from "../routes/graphs.zones";
import Lights from "../routes/lights";
import Now from "../routes/now";
import RecordDays from "../routes/record";
import RecordCompliance from "../routes/record-compliance";
import RecordEquipment from "../routes/record-equipment";
import RecordUtilities from "../routes/record-utilities";
import Review from "../routes/review";
import Settings from "../routes/settings";
import SystemController from "../routes/system-controller";
import SystemData from "../routes/system-data";
import WaterRoute from "../routes/water";
import WaterBoard from "../routes/water-board";
import WaterHistory from "../routes/water-history";
import WaterSchedules from "../routes/water-schedules";
import WaterSoil from "../routes/water-soil";
import { apiWrite } from "../lib/operator-api";
import type { AuthError } from "../lib/page-context";
import { NOW_POLL_MS } from "../lib/shell";
import { AppShell } from "./app-shell";
import { Badge } from "./badge";
import { Button } from "./button";
import { FreshnessDot } from "./freshness";
import { text } from "./test-render";

// Graphs (#1130) and Water history (#1127's bars) draw charts: uPlot and ResizeObserver are stand-ins here, as in the chart tests.
vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));
// The chart stylesheet's URL (a Vite ?url import, which the test transform does not serve from a linked install).
vi.mock("uplot/dist/uPlot.min.css?url", () => ({ default: "/assets/uPlot.min.css" }));

const NOW = Date.parse("2026-11-02T17:42:00Z");
const BUILD = "fedcba9876543210fedcba9876543210fedcba98";
/** Every screen route of app/routes.ts by path, with its component; Water's and Crops' views render inside their layouts. */
const SCREENS = [
  ["/", Now], ["/climate", ClimateLaw], ["/band", Band], ["/climate/drying", ClimateDrying],
  ["/water", WaterBoard], ["/water/schedules", WaterSchedules], ["/water/history", WaterHistory], ["/water/soil", WaterSoil],
  ["/lights", Lights], ["/lights/history", GraphsLighting], ["/crops", CropsMap], ["/crops/history", CropsHistory],
  ["/record", RecordDays], ["/record/compliance", RecordCompliance], ["/record/equipment", RecordEquipment], ["/record/utilities", RecordUtilities],
  ["/graphs", Graphs], ["/graphs/zones", GraphZones], ["/review", Review], ["/activity", Activity], ["/activity/log", ActivityLog],
  ["/equipment", Equipment], ["/system/controller", SystemController], ["/system/data", SystemData], ["/settings", Settings],
] as const;
const WATER_VIEWS: readonly string[] = ["/water", "/water/schedules", "/water/history", "/water/soil"];
const CROPS_VIEWS: readonly string[] = ["/crops", "/crops/history"];
/** The screens as the route stub nests them, as app/routes.ts does: the Water views under `routes/water.tsx`. */
function screenRoutes() {
  return [
    ...SCREENS.filter(([to]) => !WATER_VIEWS.includes(to) && !CROPS_VIEWS.includes(to)).map(([to, Component]) => (to === "/" ? { index: true, Component } : { path: to.slice(1), Component })),
    { path: "water", Component: WaterRoute, children: [{ index: true, Component: WaterBoard }, { path: "schedules", Component: WaterSchedules }, { path: "history", Component: WaterHistory }, { path: "soil", Component: WaterSoil }] },
    { path: "crops", Component: CropsRoute, children: [{ index: true, Component: CropsMap }, { path: "history", Component: CropsHistory }] },
  ];
}
/** A page with one write control, Stop and a freshness dot and green badge, to see role gating and API down on. */
function Probe() {
  return <div>
    <Button write>Save</Button>
    <Button write variant="stop">Stop all water</Button>
    <FreshnessDot stale={false} />
    <Badge kind="confirmed" />
  </div>;
}

/** One write through the client, as #1125's hooks send them, with one Idempotency-Key. */
function WriteProbe() {
  const save = useMutation({
    mutationFn: () => apiWrite("API-10", { param: "mister_engage_kpa" }, { value: 1.53, manual: true, reason: "Vandas drying" }, "4f9d2c1e-7b8a-4c3d-9e2f-1a2b3c4d5e6f"),
  });
  return <button type="button" onClick={() => save.mutate()}>Send the write</button>;
}

type Options = { fail?: Record<string, number> };
let requests: string[];
function serve(fixture: string | string[], { fail }: Options = {}) {
  const api = createFixtureHandler({ fixture, clock: () => NOW, ...(fail ? { fail } : {}) });
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    requests.push(input);
    const out = api.respond({ method: init.method, url: input, headers: init.headers as Record<string, string> | undefined, body: init.body as string | undefined });
    return new Response(out.body === null || out.body === undefined ? null : JSON.stringify(out.body), { status: out.status, headers: out.headers });
  }));
}
function mount(path: string, { authError = null, probe = false }: { authError?: AuthError | null; probe?: boolean } = {}) {
  const children = [
    ...screenRoutes(),
    { path: "probe", Component: Probe },
    { path: "write", Component: WriteProbe },
    { path: "auth/*", Component: () => null },
  ];
  const Stub = createRoutesStub([{ path: "/", Component: () => <AppShell build={BUILD} authError={authError} />, children }]);
  return render(<StrictMode><Stub initialEntries={[probe ? "/probe" : path]} /></StrictMode>);
}
async function advance(milliseconds: number) { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); }
const banners = () => [...document.querySelectorAll("[data-banner]")].map((node) => ({ tone: node.getAttribute("data-banner"), text: text(node) }));
const nav = (label: string) => screen.getByRole("navigation", { name: label });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  MockPlot.reset();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

/** The sections in README section 3's order, as the rail lists them, with the count on Activity under alerts-merged. */
const RAIL = ["Now", "Climate", "Water", "Lights", "Crops", "Hydroponics", "Record", "Graphs", "Review", "Activity 2 open alerts", "Equipment", "Controller", "Data", "Settings"];
const RAIL_HREFS = ["/", "/climate", "/water", "/lights", "/crops", "/hydroponics", "/record", "/graphs", "/review", "/activity", "/equipment", "/system/controller", "/system/data", "/settings"];
const current = (root: HTMLElement) => within(root).queryAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page").map(text);
const bar = () => nav("Sections, phone");
const barItems = () => [...bar().querySelectorAll<HTMLElement>(".bar-item")];

test("the routes: every v2 view, the old paths that redirect, SCR-09 through /auth/* and a catch-all; no /more or /plants", () => {
  // A layout's own path is its index child's: Water's four views nest under routes/water.tsx.
  type Entry = { path?: string; index?: boolean; children?: Entry[] };
  const leaves = (entries: readonly Entry[], base = ""): string[] => entries.flatMap((entry) => {
    const path = entry.index ? base || "/" : `${base}/${entry.path}`;
    return entry.children?.length ? leaves(entry.children, path) : [path];
  });
  const paths = leaves(routes as Entry[]);
  expect(paths).toEqual([
    "/", "/climate", "/band", "/climate/drying", "/water", "/water/schedules", "/water/history", "/water/soil", "/lights", "/lights/history",
    "/crops", "/crops/history", "/hydroponics", "/record", "/record/compliance", "/record/equipment", "/record/utilities", "/graphs", "/graphs/zones",
    "/review", "/activity", "/activity/log", "/equipment", "/system/controller", "/system/data", "/settings",
    "/plan", "/planner", "/planner/history", "/graphs/statistics", "/graphs/scorecard", "/graphs/lighting", "/auth/*", "/*",
  ]);
  expect(paths).not.toContain("/plants");
  expect(paths).not.toContain("/more");
});

test("in band: the shell reads API-01 and API-02 once each, shows no banner, and every route renders one h1", async () => {
  serve("in-band");
  for (const [path] of SCREENS) {
    mount(path); await advance(0);
    expect(banners(), path).toEqual([]);
    expect(screen.getAllByRole("heading", { level: 1 }), path).toHaveLength(1);
    cleanup();
  }
  requests = [];
  mount("/climate"); await advance(0);
  // A page that has not shipped reads nothing of its own: only the shell's two polls, and Search's settings read waits
  // until Search opens.
  expect(requests.sort()).toEqual(["/api/v1/me", "/api/v1/now"]);
  // API-02 every 15 s, API-01 every 60 s: one poll each, never a second.
  requests = [];
  await advance(NOW_POLL_MS);
  expect(requests).toEqual(["/api/v1/now"]);
  await advance(60_000 - NOW_POLL_MS);
  expect(requests.filter((path) => path === "/api/v1/me")).toHaveLength(1);
});

test("a server render carries no greenhouse data: no banner, count, role, name, reading age or API build, and no request", () => {
  serve("alerts-merged");
  const Stub = createRoutesStub([{ path: "/", Component: () => <AppShell build={BUILD} authError={null} />, children: screenRoutes() }]);
  const html = renderToString(<Stub initialEntries={["/activity"]} />);
  expect(html).toContain('aria-label="Verdify dashboard, home"');
  expect(html).toContain('aria-label="Sections"');
  expect(html).toContain("fedcba987654");
  expect(html).toContain('action="/auth/logout"');
  expect(html).toMatch(/Last reading (<!-- -->)?—/);
  expect(html).not.toMatch(/data-banner|nav-count|role-pill|account-name"|Jason|Operator|open alerts| ago</);
  // Before API-01 answers the account button reads Account and still holds Sign out; no Stop for an unknown role.
  expect(html).toContain("Account");
  expect(html).not.toContain("Stop all");
  expect(html).not.toContain(REVISION.slice(0, 12));
  expect(requests).toEqual([]);
});

test("the rail: the lockup, three groups with their labels, fourteen sections with icons and the count, the theme switch", async () => {
  serve("alerts-merged");
  mount("/activity/log"); await advance(0);
  const rail = screen.getByTestId("rail");
  const brand = within(rail).getByRole("link", { name: "Verdify dashboard, home" });
  expect(brand.getAttribute("href")).toBe("/");
  expect(brand.querySelectorAll(".brand-leaf, .brand-mark, .brand-dot")).toHaveLength(3);
  expect(text(brand)).toBe("erdify · Dashboard");
  const sections = nav("Sections");
  expect([...sections.querySelectorAll(".nav-group-label")].map(text)).toEqual(["Operate", "Understand", "System"]);
  expect(within(sections).getAllByRole("list").map((list) => list.getAttribute("aria-labelledby") && text(document.getElementById(list.getAttribute("aria-labelledby")!)))).toEqual(["Operate", "Understand", "System"]);
  const links = within(sections).getAllByRole("link");
  expect(links.map(text)).toEqual(RAIL);
  expect(links.map((link) => link.getAttribute("href"))).toEqual(RAIL_HREFS);
  expect(links.map((link) => link.querySelectorAll("svg.nav-icon[aria-hidden=true]").length)).toEqual(RAIL.map(() => 1));
  // A sub-view marks its section.
  expect(current(sections)).toEqual(["Activity 2 open alerts"]);
  expect(sections.querySelector(".nav-count")?.getAttribute("data-severity")).toBe("warning");
  expect(within(rail).getByRole("group", { name: "Theme" })).toBeTruthy();
});

test("the current section is marked on every v2 path and on each old path while it redirects", async () => {
  serve("in-band");
  const cases: [string, string][] = [
    ["/band", "Climate"], ["/climate/drying", "Climate"], ["/water/soil", "Water"], ["/lights/history", "Lights"], ["/record/utilities", "Record"],
    ["/graphs/zones", "Graphs"], ["/equipment", "Equipment"], ["/system/data", "Data"], ["/settings", "Settings"],
  ];
  for (const [path, section] of cases) {
    mount(path); await advance(0);
    expect(current(nav("Sections")), path).toEqual([section]);
    cleanup();
  }
});

test("the top bar: Search, the freshness chip with the newest reading's age, Stop all water for an operator, the account menu", async () => {
  serve("alerts-merged");
  mount("/graphs"); await advance(0);
  const bar = screen.getByTestId("topbar");
  expect(bar.tagName).toBe("HEADER");
  expect(within(bar).getByRole("button", { name: /^Search/ }).getAttribute("aria-keyshortcuts")).toBe("/ Control+K Meta+K");
  const chip = within(bar).getByTestId("freshness");
  expect(chip.getAttribute("href")).toBe("/system/controller");
  expect(text(chip)).toMatch(/^Last reading \d+ (s|min) ago$/);
  expect(chip.querySelector("[data-fresh]")?.getAttribute("data-fresh")).toBe("ok");
  expect(within(bar).getByRole("button", { name: "Stop all water" })).toBeTruthy();
  const account = bar.querySelector<HTMLDetailsElement>("details.account-menu")!;
  expect(text(account.querySelector("summary .role-pill"))).toBe("Operator");
  expect(text(account.querySelector("summary .account-name"))).toBe("Jason");
  expect(account.open).toBe(false);
  expect([...account.querySelectorAll(".menu-panel > p")].map(text)).toEqual(["Signed in as Jason (jason)", "Operator: can change anything"]);
  const signOut = account.querySelector<HTMLFormElement>("form.signout-form")!;
  expect([signOut.method, signOut.getAttribute("action"), text(signOut)]).toEqual(["post", "/auth/logout", "Sign out"]);
  // The phone's lockup lives in the bar too; the stylesheet shows it at 860 px and below.
  expect(within(bar).getByRole("link", { name: "Verdify dashboard, home" }).className).toBe("brand topbar-brand");
  const footer = document.querySelector("footer")!;
  expect(text(footer.querySelector(".build-line"))).toBe(`Verdify dashboard · build fedcba987654 · API ${REVISION.slice(0, 12)}`);
  // The time zone is stated once, here.
  expect(text(footer.querySelector(".footer-zone"))).toBe("Times are America/Denver");
  expect(within(footer).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["https://graphs.verdify.ai/", "https://lab.verdify.ai/", "/fonts/OFL-sans.txt", "/fonts/OFL-mono.txt"]);
  cleanup();
  // A viewer has no Stop in the bar.
  serve("viewer-session");
  mount("/graphs"); await advance(0);
  expect(within(screen.getByTestId("topbar")).queryByRole("button", { name: "Stop all water" })).toBeNull();
});

test("the phone bar holds five: Now, Climate, Water, Alerts with the count, and More; the section is marked there or on More", async () => {
  serve("alerts-merged");
  const cases: [string, string][] = [["/", "Now"], ["/band", "Climate"], ["/water/soil", "Water"], ["/activity/log", "Alerts 2 open alerts"], ["/record", "More"], ["/settings", "More"], ["/lights/history", "More"]];
  for (const [path, marked] of cases) {
    mount(path); await advance(0);
    expect(barItems().map(text), path).toEqual(["Now", "Climate", "Water", "Alerts 2 open alerts", marked === "More" ? `More, you are in ${path === "/record" ? "Record" : path === "/settings" ? "Settings" : "Lights"}` : "More"]);
    expect(barItems().map((item) => item.getAttribute("href"))).toEqual(["/", "/climate", "/water", "/activity", null]);
    expect(barItems().map((item) => item.querySelectorAll("svg.bar-icon[aria-hidden=true]").length)).toEqual([1, 1, 1, 1, 1]);
    const marks = barItems().filter((item) => item.hasAttribute("aria-current"));
    expect(marks.map((item) => text(item.querySelector(".bar-label"))), path).toEqual([marked.replace(/ 2 open alerts$/, "")]);
    cleanup();
  }
});

test("More opens a sheet with every section by group, the theme switch and Sign out; Escape closes it and focus returns to More", async () => {
  serve("in-band");
  mount("/record/compliance"); await advance(0);
  const more = within(bar()).getByRole("button", { name: /^More/ });
  expect([more.getAttribute("aria-haspopup"), more.getAttribute("aria-expanded")]).toEqual(["dialog", "false"]);
  more.focus();
  fireEvent.click(more);
  const sheet = screen.getByRole("dialog", { name: "More" });
  expect(more.getAttribute("aria-expanded")).toBe("true");
  const all = within(sheet).getByRole("navigation", { name: "All sections" });
  expect([...all.querySelectorAll(".nav-group-label")].map(text)).toEqual(["Operate", "Understand", "System"]);
  expect(within(all).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(RAIL_HREFS);
  expect(current(all)).toEqual(["Record"]);
  expect(within(sheet).getByRole("group", { name: "Theme" })).toBeTruthy();
  expect(within(sheet).getByRole("button", { name: "Sign out" }).closest("form")?.getAttribute("action")).toBe("/auth/logout");
  expect(sheet.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(sheet, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();
  expect(document.activeElement).toBe(more);
  // A section chosen in the sheet goes there and closes it.
  fireEvent.click(more);
  fireEvent.click(within(screen.getByRole("dialog", { name: "More" })).getByRole("link", { name: "Data" }));
  await advance(0);
  expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Data");
});

test("with no open alert the count draws no pill, and a screen reader still hears 0 open alerts", async () => {
  serve("in-band");
  mount("/"); await advance(0);
  const activity = within(nav("Sections")).getByRole("link", { name: /^Activity/ });
  expect(text(activity)).toBe("Activity 0 open alerts");
  expect(activity.querySelector(".nav-count")).toBeNull();
});

test("every page has a page header: the breadcrumb names group and section, the h1 the view, and a tabbed section its tabs", async () => {
  serve("in-band");
  const expected: Record<string, [string, string, string[]]> = {
    "/climate": ["Operate›Climate", "Climate law", ["Law", "Band", "Drying"]], "/band": ["Operate›Climate", "Band", ["Law", "Band", "Drying"]],
    "/climate/drying": ["Operate›Climate", "Drying", ["Law", "Band", "Drying"]],
    "/water": ["Operate›Water", "Water today", ["Today", "Schedules", "History", "Soil"]], "/water/history": ["Operate›Water", "Water history", ["Today", "Schedules", "History", "Soil"]],
    "/lights": ["Operate›Lights", "Lights", ["Lights", "History"]], "/lights/history": ["Operate›Lights", "Light history", ["Lights", "History"]],
    "/record": ["Understand›Record", "Daily record", ["Days", "In band", "Equipment", "Utilities"]],
    "/record/equipment": ["Understand›Record", "Equipment record", ["Days", "In band", "Equipment", "Utilities"]],
    "/graphs": ["Understand›Graphs", "Graphs", ["Explore", "Zones"]], "/graphs/zones": ["Understand›Graphs", "Zones", ["Explore", "Zones"]],
    "/activity": ["Understand›Activity", "Alerts", ["Alerts", "Log"]], "/activity/log": ["Understand›Activity", "Activity log", ["Alerts", "Log"]],
  };
  for (const [path, [crumbs, h1, tabs]] of Object.entries(expected)) {
    mount(path); await advance(0);
    expect(text(screen.getByRole("navigation", { name: "Breadcrumb" })), path).toBe(crumbs);
    expect(screen.getByRole("heading", { level: 1 }).textContent, path).toBe(h1);
    const section = crumbs.split("›")[1];
    const views = screen.getByRole("navigation", { name: `${section} views` });
    expect(within(views).getAllByRole("link").map(text), path).toEqual(tabs);
    expect(within(views).getAllByRole("link").filter((tab) => tab.getAttribute("aria-current") === "page").map((tab) => tab.getAttribute("href")), path).toEqual([path]);
    cleanup();
  }
  for (const [path, crumbs, h1] of [["/review", "Understand›Review", "Review"], ["/system/controller", "System›Controller", "Controller"], ["/system/data", "System›Data", "Data"]]) {
    mount(path); await advance(0);
    expect(text(screen.getByRole("navigation", { name: "Breadcrumb" })), path).toBe(crumbs);
    expect(screen.getByRole("heading", { level: 1 }).textContent, path).toBe(h1);
    expect(screen.queryByRole("navigation", { name: /views$/ }), path).toBeNull();
    expect(text(document.querySelector(".page-arriving-text")), path).toBe("This page arrives with the v2 release of the dashboard.");
    cleanup();
  }
});

test("a heartbeat 4 min old reads Ingestor not running on every page, in a row of the sticky top bar", async () => {
  serve("ingestor-not-running");
  for (const [path] of SCREENS) {
    mount(path); await advance(0);
    expect(banners(), path).toEqual([{ tone: "fault", text: "Ingestor not running since 10:38. The controller keeps holding the band on its own; nothing new is recorded until it is back. Data ›" }]);
    expect(document.querySelector("header.topbar .topbar-fault [data-banner=fault]"), path).not.toBeNull();
    cleanup();
  }
});

test("a fresh heartbeat with climate 6 min old reads Controller not reporting and links to Controller", async () => {
  serve("controller-not-reporting");
  mount("/water"); await advance(0);
  expect(banners()).toHaveLength(1);
  expect(banners()[0].text).toMatch(/^Controller not reporting since 10:36\. If it has power, it keeps holding the band on its own/);
  expect(document.body.textContent).not.toMatch(/controller offline/i);
  expect(within(document.querySelector<HTMLElement>("[data-banner]")!).getByRole("link", { name: "Controller" }).getAttribute("href")).toBe("/system/controller");
  // The freshness chip says the same without words: its dot is off.
  expect(screen.getByTestId("freshness").querySelector("[data-fresh]")?.getAttribute("data-fresh")).toBe("off");
});

test("API-02 failing twice in a row reads Dashboard API unavailable, and nothing is green", async () => {
  serve("api-down");
  mount("/probe", { probe: true }); await advance(0);
  // One failure is not enough.
  expect(banners()).toEqual([]);
  expect(document.querySelector("main [data-fresh]")?.getAttribute("data-fresh")).toBe("ok");
  // The second poll comes after the backoff (30 s after one failure).
  await advance(2 * NOW_POLL_MS);
  expect(banners()).toEqual([{ tone: "fault", text: "Dashboard API unavailable" }]);
  expect(document.querySelector("main [data-fresh]")?.getAttribute("data-fresh")).toBe("off");
  expect(document.querySelector("[data-badge=confirmed]")?.className).toBe("badge badge-neutral");
});

test("while the API is down the count is unknown: both navs drop it rather than keep the last one, and it returns with the API", async () => {
  serve("alerts-merged");
  mount("/graphs"); await advance(0);
  const activity = (label: string) => text(nav(label).querySelector("[data-section=activity]"));
  expect([activity("Sections"), activity("Sections, phone")]).toEqual(["Activity 2 open alerts", "Alerts 2 open alerts"]);
  serve("alerts-merged", { fail: { "API-02": 503 } });
  // One failure keeps the count; the second, after the 30 s backoff, is the API down.
  await advance(NOW_POLL_MS);
  expect(activity("Sections")).toBe("Activity 2 open alerts");
  await advance(2 * NOW_POLL_MS);
  expect(banners()).toEqual([{ tone: "fault", text: "Dashboard API unavailable" }]);
  expect([activity("Sections"), activity("Sections, phone")]).toEqual(["Activity", "Alerts"]);
  // The next poll, after the 60 s backoff, answers again.
  serve("alerts-merged");
  await advance(60_000);
  expect(banners()).toEqual([]);
  expect(activity("Sections")).toBe("Activity 2 open alerts");
});

test("water flowing with every valve closed, then Flow stopped at HH:MM, links to its alert", async () => {
  serve("flow-stopped");
  mount("/graphs"); await advance(0);
  expect(banners()).toEqual([{ tone: "fault", text: "Flow stopped at 10:40 Open the alert ›" }]);
  expect(screen.getByRole("link", { name: /Open the alert/ }).getAttribute("href")).toBe("/activity?alert=201");
});

test("stuck delivery and changes off are warn banners; with changes off an operator's controls are disabled but Stop", async () => {
  serve(["stuck-delivery", "writes-off"]);
  mount("/probe", { probe: true }); await advance(0);
  expect(banners()).toEqual([
    { tone: "warn", text: "Settings not reaching the controller since 06:10 (4 differ) Delivery ›" },
    { tone: "warn", text: "Changes are switched off; reading still works" },
  ]);
  expect(screen.getByRole("link", { name: /Delivery/ }).getAttribute("href")).toBe("/system/data");
  // Warn banners sit in flow at the top of the page, never in the header.
  expect(document.querySelectorAll("main [data-banner=warn]")).toHaveLength(2);
  expect(document.querySelector("header [data-banner]")).toBeNull();
  expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  // The page's Stop and the top bar's both stay live.
  expect(screen.getAllByRole("button", { name: "Stop all water" }).map((button) => button.hasAttribute("disabled"))).toEqual([false, false]);
});

test("roles come from API-01: an operator gets write controls; a viewer session renders none on any route", async () => {
  serve("in-band");
  mount("/probe", { probe: true });
  // Until API-01 answers the page is a viewer's.
  expect(document.querySelectorAll("[data-write-control]")).toHaveLength(0);
  await advance(0);
  // Save and Stop on the page, and the top bar's Stop all water.
  expect(document.querySelectorAll("[data-write-control]")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
  cleanup();
  serve("viewer-session");
  for (const path of [...SCREENS.map(([to]) => to), "/probe"]) {
    mount(path, { probe: path === "/probe" }); await advance(0);
    expect(text(document.querySelector(".role-pill")), path).toBe("Viewer");
    expect(document.querySelectorAll("[data-write-control]"), path).toHaveLength(0);
    cleanup();
  }
});

test("a 401 during polling shows the session-ended card, which signs in back to the same URL and query", async () => {
  serve("in-band", { fail: { "API-02": 401 } });
  mount("/activity?target=L01"); await advance(0);
  const card = screen.getByRole("alertdialog", { name: "Your session ended" });
  expect(text(card)).toBe("Your session endedSign in again.Sign in");
  const signIn = within(card).getByRole("link", { name: "Sign in" });
  expect(signIn.getAttribute("href")).toBe("/auth/login?returnTo=%2Factivity%3Ftarget%3DL01");
  expect(document.activeElement).toBe(signIn);
  expect(document.querySelector(".app-page")?.hasAttribute("inert")).toBe(true);
  // A 401 is not the API failing, and every poll stops.
  expect(banners()).toEqual([]);
  const sent = requests.length;
  await advance(10 * 60_000);
  expect(requests).toHaveLength(sent);
});

test("a 401 from a write shows the same card and stops every poll", async () => {
  serve("in-band", { fail: { "API-10": 401 } });
  mount("/write?from=drawer"); await advance(0);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send the write" })); });
  await advance(0);
  expect(requests).toContain("/api/v1/settings/mister_engage_kpa");
  const card = screen.getByRole("alertdialog", { name: "Your session ended" });
  expect(within(card).getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/auth/login?returnTo=%2Fwrite%3Ffrom%3Ddrawer");
  const sent = requests.length;
  await advance(10 * 60_000);
  expect(requests).toHaveLength(sent);
});

test.each([
  ["failed", 400, "Sign-in didn't complete", "Try again.", "Sign in"],
  ["unavailable", 503, "Sign-in is unavailable", "Try again in a minute.", "Sign in"],
  ["no_access", 403, "No dashboard access", "Your account doesn't have dashboard access. Ask Jason to add you to a dashboard group.", "Sign out"],
] as const)("a %s sign-in shows SCR-09's card with the header alone, and polls nothing", async (reason, _status, title, body, action) => {
  serve("in-band");
  mount("/auth/callback", { authError: { reason, requestId: "4f9d2c1e-7b8a-4c3d-9e2f-1a2b3c4d5e6f" } }); await advance(0);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
  expect(screen.getByText(body)).toBeTruthy();
  const control = action === "Sign in" ? screen.getByRole("link", { name: "Sign in" }) : screen.getByRole("button", { name: "Sign out" });
  if (action === "Sign in") expect(control.getAttribute("href")).toBe("/auth/login");
  else expect(control.closest("form")?.getAttribute("action")).toBe("/auth/logout");
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(document.querySelector(".role-pill, .account-menu, [data-banner]")).toBeNull();
  expect(text(document.querySelector(".build-line"))).toBe("Verdify dashboard · build fedcba987654 · API —");
  expect(screen.getByText(/Request id/).textContent).toBe("Request id 4f9d2c1e-7b8a-4c3d-9e2f-1a2b3c4d5e6f");
  expect(requests).toEqual([]);
});

test("a refusal card's lockup is a full page load: a client navigation would keep the refusal and draw it at /", async () => {
  serve("in-band");
  const authError: AuthError = { reason: "failed", requestId: null };
  // As root.tsx: the refusal comes from the root loader, which never revalidates on a navigation.
  function Root() {
    const { pathname } = useLocation();
    return <><AppShell build={BUILD} authError={useLoaderData<{ authError: AuthError | null }>().authError} /><output data-testid="path">{pathname}</output></>;
  }
  const Stub = createRoutesStub([{
    id: "root", path: "/", Component: Root, loader: () => ({ authError }), shouldRevalidate: () => false,
    children: [{ index: true, Component: Now }, { path: "auth/*", Component: () => null }],
  }]);
  render(<Stub initialEntries={["/auth/callback"]} />); await advance(0);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign-in didn't complete");
  let prevented: boolean | null = null;
  // Runs after React's handlers, then stops jsdom's own navigation, which it does not implement.
  const record = (event: Event) => { prevented = event.defaultPrevented; event.preventDefault(); };
  document.addEventListener("click", record);
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Verdify dashboard, home" })); });
  document.removeEventListener("click", record);
  // The browser loads / itself, so the BFF starts a sign-in; React Router never navigated.
  expect(prevented).toBe(false);
  expect(screen.getByTestId("path").textContent).toBe("/auth/callback");
});
