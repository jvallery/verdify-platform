// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Graphs → Explore (screens.md section 7.1, parity R-13, R-15, R-16, K-13, K-14, S-08) against the fixture API in
// process, with uPlot mocked: the acceptance criteria code can check. Times are America/Denver with the fixture clock at
// 10:42 on 2026-11-02 (MST); the fall-back was 2026-11-01.
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, MockPlot, TOKENS, created, media, setTokens } from "../charts/fixtures/uplot-mock";
import { AppShell } from "../components/app-shell";
import { text } from "../components/test-render";
import { outdoorVpd } from "../lib/graph-overlay";
import { TIMEOUT_TEXT } from "../lib/graph-reads";
import { LANES_TEXT, LAW_TEXT } from "../lib/graph-url";
import { SessionProvider } from "../lib/session";
import { NOW, advance, requests, startFixtureApi, stopFixtureApi, type FixtureApi, type FixtureOptions } from "../lib/test-fixture-api";
import Graphs, { clientLoader, links, loader } from "./graphs";

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));

const S = NOW / 1000;
const HOUR = 3600;
const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();
const Stub = createRoutesStub([
  { path: "/graphs", Component: Graphs },
  { path: "/graphs/statistics", Component: () => <h1>Statistics</h1> },
  { path: "/settings", Component: () => <h1>Settings</h1> },
]);
function mount(path: string, apiDown = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } } });
  return render(<QueryClientProvider client={client}><SessionProvider apiDown={apiDown}><Stub initialEntries={[path]} /></SessionProvider></QueryClientProvider>);
}
/**
 * Lets every read, render, lazy uPlot import and chart creation the page starts finish. Each pass moves the fake clock
 * 10 ms: a read that starts in a render another read's answer caused only re-renders once a little time has passed.
 */
async function settle() {
  for (let pass = 0; pass < 8; pass++) {
    await advance(10);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
}
async function open(path: string, options: FixtureOptions = {}, apiDown = false): Promise<FixtureApi> {
  const api = startFixtureApi(options);
  mount(path, apiDown);
  await settle();
  return api;
}
const panels = () => created.filter((plot) => !plot.destroyed && plot.target.className === "plot stack-plot");
const lanesPlot = () => created.find((plot) => !plot.destroyed && plot.target.className === "lanes-canvas");
const ids = () => [...document.querySelectorAll(".chart-stack [data-panel]")].map((panel) => panel.getAttribute("data-panel") ?? "");
const head = (id: string) => text(document.querySelector(`[data-panel="${id}"] .stack-stats`)).replaceAll("\u00a0", " ");
const name = (id: string) => text(document.querySelector(`[data-panel="${id}"] .stack-name`));
const status = () => text(document.querySelector(".page-status")).replaceAll("\u00a0", " ");
const query = (path: string) => new URL(path, "http://dashboard.invalid").searchParams;
/** Every API-04 request's metric list and window. */
const asked = (api: FixtureApi) => requests(api, "API-04").map((row) => {
  const params = query(row.path);
  return { metric: params.getAll("metric"), from: params.get("from"), to: params.get("to"), points: params.get("points") };
});
const OVERLAY_KEY = /^climate\.outdoor_|^forecast\./;
/** The panels' API-04 requests, one per panel: every one but the outdoor and forecast overlay's. */
const seriesAsked = (api: FixtureApi) => asked(api).filter((row) => !row.metric.some((key) => OVERLAY_KEY.test(key))).map(({ metric, from, to }) => ({ metric, from, to }));
/** The overlay's own API-04 requests. */
const overlayAsked = (api: FixtureApi) => asked(api).filter((row) => row.metric.some((key) => OVERLAY_KEY.test(key)));
const keyItems = (id: string) => [...document.querySelectorAll(`[data-panel="${id}"] .stack-key li`)].map((item) => text(item).replaceAll("\u00a0", " "));
const texts = (plot: MockPlot) => { plot.draw(); return plot.ctx.texts.map((item) => item.text.replaceAll("\u00a0", " ")); };
const links_ = (list: string) => within(screen.getByRole("list", { name: list })).getAllByRole("link");

const { createObjectURL, revokeObjectURL } = URL;
const blobs: Blob[] = [];
beforeEach(() => {
  MockPlot.reset(); FakeResizeObserver.instances = []; blobs.length = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return `blob:${blobs.length}`; });
  URL.revokeObjectURL = vi.fn();
});
/** The stubs a mounted chart needs; startFixtureApi stubs fetch and the clock first. */
function chartStubs() {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
}
afterEach(() => {
  cleanup(); stopFixtureApi(); document.documentElement.removeAttribute("style");
  URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL;
});

test("the route links the chart styles; the server renders the head, the toolbar and the stack's frames at their heights, no greenhouse data and no request", () => {
  const api = startFixtureApi();
  expect(links().map((link) => link.rel)).toEqual(["stylesheet", "stylesheet"]);
  const html = renderToString(<QueryClientProvider client={new QueryClient()}><SessionProvider><Stub initialEntries={["/graphs?range=72h"]} /></SessionProvider></QueryClientProvider>);
  expect(html).toContain("Climate");
  expect(html).toContain("America/Denver");
  for (const id of ["temperature", "vpd", "rh"]) expect(html).toContain(`data-panel="${id}"`);
  expect(html).toContain("Loading Temperature…");
  expect(html).not.toMatch(/in band \d/);
  expect(requests(api)).toEqual([]);
});

test("/graphs?range=72h&set=band_vpd_low_sm: one stack of three panels on one time axis, the band, the setting's steps and the lanes on one cursor", async () => {
  chartStubs();
  const api = await open("/graphs?range=72h&set=band_vpd_low_sm");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Graphs");
  expect(ids()).toEqual(["temperature", "vpd", "rh"]);
  expect([name("temperature"), name("vpd"), name("rh")]).toEqual(["Temperature °F", "VPD kPa", "RH %"]);
  // The resolution line sits in the stack's foot.
  expect(text(document.querySelector(".stack-foot .resolution-line"))).toBe("Oct 30, 11:42 → Nov 5, 10:42 (6 d across the fall-back) · one point per 5 minutes");
  // The window is the past 72 h plus 72 h ahead (decisions 2026-11-05, replacing D-UX-13); every chart, the lanes included, shares one cursor.
  const [temp, vpd, rh] = panels();
  expect(panels()).toHaveLength(3);
  for (const plot of [...panels(), lanesPlot()!]) {
    expect(plot.opts.cursor!.sync!.key).toBe("verdify:graphs:72h");
    expect(plot.scales.x).toEqual({ min: S - 72 * HOUR, max: S + 72 * HOUR });
  }
  // Only the bottom panel draws the time axis, and no panel has a floating tooltip.
  expect(panels().map((plot) => plot.opts.axes![0].size === 0)).toEqual([true, true, false]);
  expect(panels().map((plot) => plot.opts.plugins ?? [])).toEqual([[], [], []]);
  // One API-04 request per panel over [now − 72 h, now); band and setting history read the whole x range.
  expect(seriesAsked(api)).toEqual(["climate.temp_avg", "climate.vpd_avg", "climate.rh_avg"].map((key) => ({ metric: [key], from: iso(S - 72 * HOUR), to: iso(S) })));
  const window = (row: { path: string }) => [query(row.path).get("from"), query(row.path).get("to")];
  expect(requests(api, "API-06").map(window)).toEqual([[iso(S - 72 * HOUR), iso(S + 72 * HOUR)]]);
  expect(requests(api, "API-12").map((row) => [new URL(row.path, "http://x").pathname, ...window(row)])).toEqual([["/api/v1/settings/band_vpd_low_sm/history", iso(S - 72 * HOUR), iso(S + 72 * HOUR)]]);
  expect(requests(api, "API-05").map(window)).toEqual([[iso(S - 72 * HOUR), iso(S)]]);
  // The band on temperature and VPD only; the steps on VPD only: the device line.
  expect([temp, vpd, rh].map((plot) => { plot.draw(); return plot.ctx.fills.some((fill) => fill.color === TOKENS["--c-band-wash"]); })).toEqual([true, true, false]);
  // No words in the plots but "Now" (#1354): the steps and the band are named in the VPD panel's key instead.
  for (const plot of [temp, vpd, rh]) expect(texts(plot).filter((item) => /kPa|°F|%|PLANNED|device|Band|Forecast/.test(item))).toEqual([]);
  // The band is 0.45–0.80 kPa and the setting 0.10: the axis stays on the band and the key says the step is below it.
  // Release 4 (#1633): Iris plans only seconds and gallons now, so no setting a panel draws has a PLANNED step.
  expect(keyItems("vpd")).toEqual(["Band", "VPD low edge at solar noon 0.86 kPa"]);
  expect(vpd.scales.y.min!).toBeGreaterThan(0.1);
  expect(keyItems("temperature")).toEqual(["Band"]);
  expect(keyItems("rh")).toEqual([]);
  for (const plot of panels()) expect(plot.opts.series.slice(1).every((series) => series.spanGaps === false)).toBe(true);
  // The header rows carry the window's statistics, in band where a band is drawn.
  expect(head("temperature")).toMatch(/^in band 100% · low \d\d\.\d \(.+\) · mean \d\d\.\d · high \d\d\.\d \(.+\)$/);
  expect(head("rh")).toMatch(/^low \d\d\.\d/);
  // The lanes sit in their disclosure, open from 861 px; a wet line's interval names its cause.
  expect(document.querySelector<HTMLDetailsElement>("details.stack-lanes")!.open).toBe(true);
  expect([...document.querySelectorAll(".lanes-group-name")].map(text)).toEqual(["Climate", "Misting", "Irrigation", "Lighting", "Sensors"]);
  expect(texts(lanesPlot()!)).toContain("VPD");
  // The range chips keep the setting; the setting's chip opens its drawer.
  expect(links_("Range").map((chip) => [chip.textContent, chip.getAttribute("href"), chip.getAttribute("aria-current")])).toEqual([
    ["Today", "/graphs?range=today&set=band_vpd_low_sm", null], ["24 h", "/graphs?range=24h&set=band_vpd_low_sm", null],
    ["72 h", "/graphs?range=72h&set=band_vpd_low_sm", "page"], ["7 d", "/graphs?range=7d&set=band_vpd_low_sm", null],
    ["30 d", "/graphs?range=30d&set=band_vpd_low_sm", null], ["90 d", "/graphs?range=90d&set=band_vpd_low_sm", null],
  ]);
  expect(within(screen.getByRole("list", { name: "Settings drawn as steps" })).getAllByRole("listitem").map(text)).toEqual(["VPD low edge at solar noon · VPD×"]);
  expect(within(screen.getByRole("list", { name: "Settings drawn as steps" })).getByRole("link", { name: "VPD low edge at solar noon · VPD" }).getAttribute("href")).toBe("/settings?edit=band_vpd_low_sm");

  // Reloading the copied URL renders the same view from the same requests.
  const first = requests(api).map((row) => row.path).sort();
  const firstHeads = ids().map(head);
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  const again = await open("/graphs?range=72h&set=band_vpd_low_sm");
  expect(requests(again).map((row) => row.path).sort()).toEqual(first);
  expect(ids().map(head)).toEqual(firstHeads);
});

test("a cursor on one panel turns every header row into the values there, with one time chip and no tooltip", async () => {
  chartStubs();
  await open("/graphs?range=72h&set=band_vpd_low_sm&outdoor=0");
  const [, vpd] = panels();
  vpd.fire("ready");
  const at = S - 2 * HOUR - 120;
  act(() => vpd.hover(at, (vpd.data[0] as number[]).indexOf(at)));
  expect(document.querySelectorAll(".stack-chip:not([hidden])")).toHaveLength(1);
  // The window spans days, so the chip carries the date.
  expect(text(document.querySelector(".stack-chip"))).toBe("Nov 2, 08:40");
  // The readout names the step drawn there too, as the plot no longer labels it (#1354).
  expect(head("vpd")).toMatch(/^\d\.\d\d · band 0\.45–0\.80 · in · VPD low edge at solar noon 0\.86$/);
  expect(head("temperature")).toMatch(/^\d\d\.\d · band 62\.0–70\.0 · in$/);
  expect(head("rh")).toMatch(/^\d\d\.\d$/);
  expect(document.querySelector(".chart-tooltip")).toBeNull();
});

test("the story line states time in band and up to three excursions, worst first; each opens its stretch with half an hour either side", async () => {
  chartStubs();
  await open("/graphs?range=24h&set=", { fixture: "in-band" });
  expect(status()).toBe("Last 24 h: Temperature 100% in band · VPD 100% in band · based on graded points · no excursions");
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  // The band narrowed to 64.5–68.0 °F: too cold overnight and too warm again from mid-morning.
  await open("/graphs?range=24h&set=&cmp=day", { fixture: "graphs-excursions" });
  // Worst first: the night's long cold stretch, yesterday's warm afternoon from the window's start, then this morning's.
  expect(status()).toMatch(/^Last 24 h: Temperature \d\d% in band · VPD 100% in band · based on graded points · 3 excursions: too cold Nov 1, 2\d:\d\d–Nov 2, 0[45]:\d\d \(low 63\.0 °F\), too warm Nov 1, 10:42–16:\d\d \(peak 69\.0 °F\), too warm Nov 2, 09:\d\d–10:4\d \(peak 68\.\d °F\)$/);
  const stretches = within(document.querySelector<HTMLElement>(".page-status")!).getAllByRole("link");
  expect(stretches).toHaveLength(3);
  // Each link opens the stretch ±30 min as an exact window, keeping the rest of the view.
  const [coldLink] = stretches;
  const params = new URLSearchParams(coldLink.getAttribute("href")!.split("?")[1]);
  expect([params.get("set"), params.get("cmp")]).toEqual(["", "day"]);
  const from = Date.parse(params.get("from")!) / 1000, to = Date.parse(params.get("to")!) / 1000;
  expect(to - from).toBeGreaterThan(8 * HOUR);
  expect(to - from).toBeLessThan(10 * HOUR);
  // The excursions are shaded under the line, in --tint-warn.
  const [temp] = panels();
  temp.draw();
  expect(temp.ctx.fills.filter((fill) => fill.color === TOKENS["--warn-soft"]).length).toBeGreaterThanOrEqual(2);
});

test("Today runs from local midnight to the next; 24 h has 24 h ahead; ‹ › step by the window's length and Zoom out doubles it, all in the URL", async () => {
  chartStubs();
  await open("/graphs?range=today");
  const midnight = Date.parse("2026-11-02T07:00:00Z") / 1000;
  expect(panels()[0].scales.x).toEqual({ min: midnight, max: midnight + 24 * HOUR });
  expect(status()).toMatch(/^Today: Temperature .* in band · VPD .* in band/);
  expect(screen.getByRole("link", { name: "Previous day" }).getAttribute("href")).toBe("/graphs?from=2026-11-01&to=2026-11-01");
  expect(screen.getByText("Next day: not available")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Zoom out" }).getAttribute("href")).toBe("/graphs?range=48h");
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  const api = await open("/graphs?range=24h");
  expect(panels()[0].scales.x).toEqual({ min: S - 24 * HOUR, max: S + 24 * HOUR });
  // The forecast reads the 24 h ahead, an hour a point.
  expect(overlayAsked(api).find((row) => row.metric[0].startsWith("forecast."))).toMatchObject({ from: iso(S), to: iso(S + 24 * HOUR), points: "25" });
  expect(screen.getByRole("link", { name: "Previous 24 h" }).getAttribute("href")).toBe("/graphs?from=2026-10-31T17:42:00Z&to=2026-11-01T17:42:00Z");
  expect(screen.getByRole("link", { name: "Zoom out" }).getAttribute("href")).toBe("/graphs?range=48h");
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  await open("/graphs?from=2026-10-30&to=2026-10-31");
  expect(screen.getByRole("link", { name: "Previous 2 d" }).getAttribute("href")).toBe("/graphs?from=2026-10-28&to=2026-10-29");
  expect(screen.getByRole("link", { name: "Next 2 d" }).getAttribute("href")).toBe("/graphs?from=2026-11-01&to=2026-11-02");
  expect(screen.getByRole("link", { name: "Zoom out" }).getAttribute("href")).toBe("/graphs?from=2026-10-29&to=2026-11-01");
  // The custom form is open on a days window and keeps the rest of the view.
  expect(document.querySelector<HTMLDetailsElement>("details.gr-custom")!.open).toBe(true);
});

test("a request still REQUESTED draws from the request, never a plan ahead", async () => {
  chartStubs();
  const api = startFixtureApi();
  api.respond({ method: "PUT", url: "/v1/settings/band_vpd_low_sm", body: { value: 0.12, manual: false, reason: "Vandas drying" }, headers: { "Idempotency-Key": "5f0c6a52-8e1d-4c3b-9a7f-2d4e6b8c0a1e" } });
  // Half an hour later the request has not been confirmed: the controller still reads 0.10.
  await advance(30 * 60_000);
  mount("/graphs?range=24h&set=band_vpd_low_sm");
  await settle();
  // The stack's own data table, after the lanes' in their disclosure.
  const details = document.querySelector<HTMLDetailsElement>(".chart-stack > details.chart-table")!;
  act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  const steps = [...details.querySelectorAll("table")].find((table) => table.caption?.textContent?.startsWith("Setting steps"))!;
  expect([...steps.querySelectorAll("tbody tr")].map((row) => text(row.querySelectorAll("td")[1]))).toEqual([
    "VPD low edge at solar noon device 0.86 kPa", "VPD low edge at solar noon REQUESTED 0.12 kPa · jason",
  ]);
  expect(texts(panels()[1]).some((item) => item.includes("PLANNED"))).toBe(false);
});

test("an exact ISO window draws exactly that window, with nothing ahead, and as a closed window never refetches", async () => {
  chartStubs();
  const api = await open("/graphs?from=2026-11-01T08:00:00Z&to=2026-11-01T12:00:00Z");
  const from = Date.parse("2026-11-01T08:00:00Z") / 1000, to = Date.parse("2026-11-01T12:00:00Z") / 1000;
  expect(panels()).toHaveLength(3);
  for (const plot of [...panels(), lanesPlot()!]) expect(plot.scales.x).toEqual({ min: from, max: to });
  expect(seriesAsked(api).map((row) => [row.from, row.to])).toEqual(Array(3).fill(["2026-11-01T08:00:00.000Z", "2026-11-01T12:00:00.000Z"]));
  expect(text(document.querySelector(".resolution-line"))).toBe("Nov 1, 01:00 MST → Nov 1, 05:00 (4 h) · one point per minute");
  expect(screen.getByRole("list", { name: "Range" }).querySelector("[aria-current]")).toBeNull();
  // The settings catalog polls on its own; the window's reads never ask again: the panels, outdoor, the lanes, the band
  // and the marks (writes, alerts, runs), the light switches the lanes read; no setting (none draws by default, #1354) and no
  // forecast, as the window ended before now.
  const windowReads = () => requests(api).filter((row) => ["API-04", "API-05", "API-06", "API-12", "API-17", "API-14", "API-IRR-11"].includes(row.operationId ?? "")).length;
  const count = windowReads();
  expect(count).toBe(10);
  expect(overlayAsked(api).map((row) => row.metric)).toEqual([["climate.outdoor_temp_f", "climate.outdoor_rh_pct"]]);
  await advance(5 * 60_000);
  expect(windowReads()).toBe(count);
});

test("a window that includes now follows the clock every 60 s, and stops while the tab is hidden", async () => {
  chartStubs();
  const api = await open("/graphs?range=24h");
  expect(seriesAsked(api)).toHaveLength(3);
  await advance(61_000);
  const asked = seriesAsked(api);
  expect(asked).toHaveLength(6);
  expect(asked.slice(3).map((row) => [row.from, row.to])).toEqual(Array(3).fill([iso(S + 60 - 24 * HOUR), iso(S + 60)]));
  // The previous render stays while the next window loads, so no panel blinks to "Loading".
  expect(panels()).toHaveLength(3);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await advance(3 * 60_000);
  expect(seriesAsked(api)).toHaveLength(6);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await settle();
  expect(seriesAsked(api)).toHaveLength(9);
});

test("from 7 d the panels read hourly buckets and draw each one's min–max; env=0 hides it and reads the finer buckets; cmp=day draws yesterday dashed with a delta in each header", async () => {
  chartStubs();
  const hourly = await open("/graphs?range=7d&outdoor=0");
  expect(asked(hourly).filter((row) => row.metric[0].startsWith("climate.")).map((row) => row.points)).toEqual(["336", "336", "336"]);
  expect(text(document.querySelector(".resolution-line"))).toContain("· one point per hour");
  const envelope = (plot: MockPlot) => { plot.draw(); return plot.ctx.strokes.filter((stroke) => stroke.stroke === TOKENS["--border-strong"]).length; };
  expect(envelope(panels()[0])).toBeGreaterThan(100);
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  const fine = await open("/graphs?range=7d&outdoor=0&env=0");
  expect(envelope(panels()[0])).toBe(0);
  expect(asked(fine).every((row) => row.points === null)).toBe(true);
  expect(text(document.querySelector(".resolution-line"))).toContain("· one point per 15 minutes");
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  // At 24 h the buckets are 1 min: no envelope even when on.
  await open("/graphs?range=24h&outdoor=0");
  expect(envelope(panels()[0])).toBe(0);
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  const api = await open("/graphs?range=24h&outdoor=0&cmp=day");
  // One extra read per panel, of its primary key a day earlier.
  const compared = seriesAsked(api).filter((row) => row.from === iso(S - 48 * HOUR));
  expect(compared).toEqual(["climate.temp_avg", "climate.vpd_avg", "climate.rh_avg"].map((key) => ({ metric: [key], from: iso(S - 48 * HOUR), to: iso(S - 24 * HOUR) })));
  const [temp] = panels();
  temp.draw();
  expect(temp.ctx.strokes.some((stroke) => stroke.stroke === TOKENS["--text-3"] && stroke.width === 1.25 && stroke.dash.length === 2)).toBe(true);
  expect(head("temperature")).toMatch(/ · yesterday's mean \d\d\.\d · (▲|▼) \d\.\d vs yesterday$|no change vs yesterday$/);
});

test("the event rail marks writes, alerts and runs by source, each linking to Activity; the list under the stack holds every mark; events= toggles a source", async () => {
  chartStubs();
  const api = await open("/graphs?range=24h", { fixture: "graphs-events" });
  // One page of the log and of the runs over the window read so far, and the open and recently resolved alerts.
  // The lanes read the light switches on their own, from a timer's length (2 h) before the window, whatever the rail shows.
  expect(requests(api, "API-17").map((row) => Object.fromEntries(query(row.path)))).toEqual([
    { from: iso(S - 26 * HOUR), to: iso(S), action: "light.", limit: "200" }, { from: iso(S - 24 * HOUR), to: iso(S), limit: "200" },
  ]);
  expect(requests(api, "API-14").map((row) => Object.fromEntries(query(row.path)))).toEqual([{ status: "recent", limit: "200" }]);
  expect(requests(api, "API-IRR-11").map((row) => Object.fromEntries(query(row.path)))).toEqual([{ from: iso(S - 24 * HOUR), to: iso(S), limit: "200" }]);
  const rail = screen.getByRole("group", { name: /^Events on the charts, \d+$/ });
  const marks = within(rail).getAllByRole("button").map((mark) => [mark.getAttribute("data-kind"), mark.querySelector(".rail-glyph")!.getAttribute("data-token"), text(mark), mark.getAttribute("aria-label")]);
  expect(marks).toEqual([
    ["setting", "text-3", "✎", "06:30 · forecast-engine · Set Mister Min Off"],
    ["water", "cause-vpd", "▮", "06:58 · Center mister · VPD · 14 min · ok"],
    ["alert", "warn-text", "▲", "08:00 · warning · VPD outside the band"],
    ["setting", "accent", "✎", "08:42 · jason · Set Outdoor Staleness Max"],
    ["setting", "eq-fan2", "✎", "09:00 · steward AI · Set Mister Water Budget"],
    ["alert", "warn-text", "△", "09:30 · resolved · VPD outside the band"],
  ]);
  // The key toggles each kind on the rail; the retired planner's plan writes are no events (screens.md section 7.1).
  expect(within(screen.getByRole("list", { name: "Event marks" })).getAllByRole("button").map(text)).toEqual(["✎setting", "▮water", "▲alert"]);
  const disclosure = screen.getByRole("region", { name: "Events in this window (6)" });
  expect(disclosure.textContent).not.toMatch(/\bplan\b/i);
  expect(within(disclosure).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
    "/activity/log?target=mister_min_off_s#activity-13", "/water/history?line=L04", "/activity?alert=501",
    "/activity/log?target=outdoor_staleness_max_s#activity-15", "/activity/log?target=mister_water_budget_gal#activity-16", "/activity?alert=501",
  ]);
  // Layers: each source is a chip that turns it off in the URL; the menu stays open while they change.
  const sources = links_("Event sources");
  expect(sources.map((chip) => [chip.textContent, chip.getAttribute("aria-current"), chip.getAttribute("href")])).toEqual([
    ["People", "true", "/graphs?range=24h&events=iris,agents,system,alerts,runs"], ["Reviewer", "true", "/graphs?range=24h&events=people,agents,system,alerts,runs"],
    ["Agents", "true", "/graphs?range=24h&events=people,iris,system,alerts,runs"], ["Host", "true", "/graphs?range=24h&events=people,iris,agents,alerts,runs"],
    ["Alerts", "true", "/graphs?range=24h&events=people,iris,agents,system,runs"], ["Water runs", "true", "/graphs?range=24h&events=people,iris,agents,system,alerts"],
  ]);
  expect(sources[0].closest("[data-menu-keep]")).not.toBeNull();
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  const people = await open("/graphs?range=24h&events=people", { fixture: "graphs-events" });
  expect(within(screen.getByRole("group", { name: /^Events on the charts/ })).getAllByRole("button").map((mark) => mark.getAttribute("aria-label"))).toEqual(["08:42 · jason · Set Outdoor Staleness Max"]);
  expect(requests(people, "API-14")).toEqual([]);
  expect(requests(people, "API-IRR-11")).toEqual([]);
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  const none = await open("/graphs?range=24h&events=", { fixture: "graphs-events" });
  expect(document.querySelector(".stack-rail, .stack-events")).toBeNull();
  const railWrites = requests(none, "API-17").filter((row) => !query(row.path).has("action"));
  expect([railWrites, requests(none, "API-14"), requests(none, "API-IRR-11")]).toEqual([[], [], []]);
});

test("Preset Water and soil draws its own panels, no band and no climate trace, with the water lanes; the menu marks the current one", async () => {
  chartStubs();
  const api = await open("/graphs?range=7d&preset=water&outdoor=0");
  expect(ids()).toEqual(["climate.soil_temp_south_1", "climate.soil_moisture_south_1", "climate.soil_ec_south_1", "climate.flow_gpm"]);
  expect(seriesAsked(api).map((row) => row.metric)).toEqual([
    ["climate.soil_temp_south_1", "climate.soil_temp_south_2", "climate.soil_temp_west"],
    ["climate.soil_moisture_south_1", "climate.soil_moisture_south_2", "climate.soil_moisture_west"], ["climate.soil_ec_south_1"], ["climate.flow_gpm"],
  ]);
  expect(requests(api, "API-06")).toEqual([]);
  const presets = links_("Presets");
  expect(presets.map((link) => [text(link).replace(/ · none yet$/, ""), link.getAttribute("aria-current"), link.getAttribute("href")])).toEqual([
    ["Climate", null, "/graphs?range=7d&outdoor=0"], ["Law and equipment", null, "/graphs?range=7d&preset=law&outdoor=0"], ["Drying", null, "/graphs?range=7d&preset=drying&outdoor=0"],
    ["Outdoor", null, "/graphs?range=7d&preset=outdoor&outdoor=0"], ["Water and soil", "true", "/graphs?range=7d&preset=water&outdoor=0"], ["Light", null, "/graphs?range=7d&preset=light&outdoor=0"],
    ["Controller", null, "/graphs?range=7d&preset=controller&outdoor=0"], ["Hydroponics", null, "/graphs?range=7d&preset=hydroponics&outdoor=0"],
  ]);
  expect(text(document.querySelector(".gr-menu .gr-menu-value"))).toBe("Water and soil");
  // Taking a preset's metric off turns the view into Climate with the metrics left.
  const chips = within(screen.getByRole("list", { name: "Metrics on the charts" }));
  expect(chips.getByRole("link", { name: "Take Site water flow off the charts" }).getAttribute("href")).toBe(
    "/graphs?range=7d&m=climate.soil_moisture_south_1&m=climate.soil_temp_south_1&m=climate.soil_ec_south_1&m=climate.soil_moisture_south_2&m=climate.soil_temp_south_2&m=climate.soil_moisture_west&m=climate.soil_temp_west&outdoor=0",
  );
  expect(text(document.querySelector("[data-system=irrigation] .lanes-group-name"))).toBe("Irrigation");
  expect([...document.querySelectorAll(".lanes-group-name")].map(text)).not.toContain("Climate");
});

test("an old preset id redirects to its v2 name, replacing the entry and keeping the rest of the link", () => {
  const moved = loader({ request: new Request("http://dashboard.invalid/graphs?range=7d&preset=water-soil&m=climate.flow_gpm") }) as Response;
  expect([moved.status, moved.headers.get("Location")]).toEqual([302, "/graphs?range=7d&preset=water&m=climate.flow_gpm"]);
  expect((clientLoader({ request: new Request("http://dashboard.invalid/graphs?preset=water-soil") }) as Response).headers.get("Location")).toBe("/graphs?preset=water");
  expect(loader({ request: new Request("http://dashboard.invalid/graphs?preset=law") })).toBeNull();
});

test("Law and equipment: temperature and VPD against the band, what the law asked for (API-31) and what ran (API-05's climate lanes) on one cursor", async () => {
  chartStubs();
  const api = await open("/graphs?range=24h&preset=law&outdoor=0");
  expect(ids()).toEqual(["temperature", "vpd"]);
  expect(requests(api, "API-31").map((row) => [query(row.path).get("from"), query(row.path).get("to")])).toEqual([[iso(S - 24 * HOUR), iso(S)]]);
  expect(requests(api, "API-05")).toHaveLength(1);
  const lanes = document.querySelector("details.stack-lanes")!;
  expect(lanes.textContent).toContain("What the law asked for");
  // The law's rows under their groups (the latches folded "As reported"), then the relays: API-05's climate lanes only.
  expect([...lanes.querySelectorAll(".lanes-group-name")].map(text)).toEqual(["Asked for", "As reported", "Climate"]);
  for (const plot of created.filter((plot) => !plot.destroyed)) expect(plot.opts.cursor?.sync?.key ?? "verdify:graphs:24h").toBe("verdify:graphs:24h");
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  // API-31 reads at most 31 days: a longer window says so and never asks.
  const long = await open("/graphs?range=90d&preset=law&outdoor=0");
  expect(requests(long, "API-31")).toEqual([]);
  expect(screen.getAllByText(LAW_TEXT).length).toBeGreaterThan(0);
});

test("Drying: VPD against the band with the drying line, the price of drying against the limit and the drying decision", async () => {
  chartStubs();
  const api = await open("/graphs?range=24h&preset=drying&outdoor=0", { fixture: "law-drying-refused-cost" });
  expect(ids()).toEqual(["vpd"]);
  expect(requests(api, "API-31")).toHaveLength(1);
  expect(requests(api, "API-30").length).toBeGreaterThan(0);
  const [vpd] = panels();
  expect(vpd.opts.series.slice(1).map((series) => series.label)).toEqual(["Indoor VPD", "Drying line"]);
  expect(seriesOf(vpd, "Drying line").some((value) => value !== null)).toBe(true);
  expect(screen.getByRole("heading", { name: "Price of drying against the limit" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "The drying decision" })).toBeTruthy();
  expect(document.body.textContent).toMatch(/Refused [^.]* for costs more than the limit/);
});

test("Controller: each budget figure the registry lists against API-35's limits; no band, no climate trace", async () => {
  chartStubs();
  const api = await open("/graphs?range=24h&preset=controller&outdoor=0");
  expect(ids()).toEqual([]);
  expect(requests(api, "API-06")).toEqual([]);
  expect(requests(api, "API-35").length).toBeGreaterThan(0);
  expect(asked(api).filter((row) => row.metric.some((key) => key.startsWith("diagnostics."))).map((row) => row.metric)).toEqual([[
    "diagnostics.heap_minute_low_kb", "diagnostics.heap_largest_block_minute_low_kb", "diagnostics.loop_worst_ms", "diagnostics.nvs_write_worst_ms",
    "diagnostics.loop_stack_free_min_b", "diagnostics.wifi_disconnects",
  ]]);
  expect([...document.querySelectorAll(".gr-controller .panel-title, .gr-controller h2, .gr-controller h3")].length).toBe(6);
});

test("Outdoor: the outdoor keys in their own panels, with no band, no overlay read and no lanes", async () => {
  chartStubs();
  const api = await open("/graphs?range=24h&preset=outdoor");
  expect(ids()).toEqual(expect.arrayContaining(["climate.outdoor_temp_f", "climate.outdoor_rh_pct"]));
  expect(ids()).not.toContain("temperature");
  expect(requests(api, "API-06")).toEqual([]);
  expect(requests(api, "API-05")).toEqual([]);
  expect(asked(api).some((row) => row.metric.some((key) => key.startsWith("forecast.")))).toBe(false);
});

test("a metric's registry note shows on its panel's notes and a gap in the record is listed", async () => {
  chartStubs();
  const api = startFixtureApi({ fixture: "controller-not-reporting" });
  const answered = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const response = await answered(input, init);
    if (!new URL(String(input), "http://dashboard.invalid").pathname.endsWith("/v1/metrics")) return response;
    const body = await response.json();
    body.items = body.items.map((metric: { key: string }) => (metric.key === "climate.temp_avg" ? { ...metric, note: "Reads high in direct sun" } : metric));
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  mount("/graphs?range=24h&outdoor=0");
  await settle();
  expect(requests(api, "API-04").length).toBeGreaterThan(0);
  expect(notes()).toContain("Indoor temperature: Reads high in direct sun");
  const gaps = screen.getByRole("list", { name: "Gaps in the record" });
  expect(within(gaps).getAllByRole("listitem").map((item) => text(item).replaceAll("\u00a0", " "))).toEqual(["No record since 10:37 (5 min)"]);
});

test("a daily key draws in a panel of its own, one point per day, read apart from the climate panels (D-UX-04)", async () => {
  chartStubs();
  const api = await open("/graphs?range=7d&m=daily.temp_in_band_pct&outdoor=0", { fixture: "scorecard-30d" });
  expect(ids()).toEqual(["temperature", "vpd", "rh", "daily.temp_in_band_pct"]);
  expect(name("daily.temp_in_band_pct")).toBe("Temperature time in band, whole day % of day");
  expect(seriesAsked(api).map((row) => row.metric)).toEqual([["climate.temp_avg"], ["climate.vpd_avg"], ["climate.rh_avg"], ["daily.temp_in_band_pct"]]);
  const daily = panels()[3];
  expect((daily.data[0] as number[]).length).toBeLessThanOrEqual(8);
  // One point per local day: a day apart, 25 hours across the fall-back.
  expect(new Set((daily.data[0] as number[]).slice(1).map((at, index) => at - (daily.data[0] as number[])[index]))).toEqual(new Set([86_400, 90_000]));
  // No setting draws on it: the RH ceiling stays on RH.
  expect(texts(daily).some((item) => item.includes("fog"))).toBe(false);
});

test("a 90-day window says the lanes cover at most 31 days, sends no API-05 or runs request and still draws the climate panels", async () => {
  chartStubs();
  const api = await open("/graphs?range=90d");
  expect(panels()).toHaveLength(3);
  expect(requests(api, "API-05")).toEqual([]);
  expect(requests(api, "API-IRR-11")).toEqual([]);
  expect(document.querySelector(".chart-lanes")!.textContent).toContain(LANES_TEXT);
  expect(text(document.querySelector(".resolution-line"))).toContain("one point per day");
  expect(screen.getByText("Runs are marked for windows up to 31 days")).toBeTruthy();
});

test("a 400-day window draws climate's daily summaries and labels the span before the 365 days kept", async () => {
  chartStubs();
  const api = await open("/graphs?from=2025-09-29&to=2026-11-02");
  expect(seriesAsked(api)).toHaveLength(3);
  for (const row of asked(api)) expect(Date.parse(row.to!) - Date.parse(row.from!)).toBeLessThanOrEqual(400 * 86_400_000);
  expect(text(document.querySelector(".resolution-line"))).toContain("· one point per day · daily summaries");
  const notes = [...document.querySelectorAll(".gr-notes li")].map(text);
  expect(notes).toEqual(expect.arrayContaining(["one point per day · daily summaries", "Indoor temperature: Daily summaries before 11/02/2025: raw data kept 365 days"]));
  expect(requests(api, "API-05")).toEqual([]);
});

test("a panel whose window took too long says so in its frame while the other panels render; Retry asks again", async () => {
  chartStubs();
  const api = startFixtureApi();
  const answered = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => (input.includes("metric=climate.vpd_avg")
    ? { status: 503, ok: false, type: "basic", headers: new Headers({ "Content-Type": "application/problem+json" }), json: async () => ({ type: "about:blank", title: "Narrow the window", status: 503, code: "query_timeout", retryable: true }) } as unknown as Response
    : answered(input, init))));
  mount("/graphs?range=30d");
  await settle();
  expect(["temperature", "vpd", "rh"].map((id) => document.querySelector(`[data-panel=${id}] .chart-message`)?.textContent ?? null)).toEqual([null, TIMEOUT_TEXT, null]);
  expect(panels()).toHaveLength(2);
  expect(screen.getByText("Couldn't load part of this window.")).toBeTruthy();
  expect(seriesAsked(api)).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await settle();
  expect(vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input).includes("metric=climate.vpd_avg")).length).toBeGreaterThanOrEqual(2);
});

test("unknown or undrawable entries from an old link are dropped with a notice, never an error page", async () => {
  chartStubs();
  await open("/graphs?range=fortnight&m=climate.nope&m=forecast.temp_f&set=nope&set=mister_min_off_s&cmp=month");
  expect(within(screen.getByRole("list", { name: "Changes to this link" })).getAllByRole("listitem").map(text)).toEqual([
    "Removed unknown range fortnight", "Removed unknown comparison month", "Removed unknown metric climate.nope", "Removed forecast.temp_f: the outdoor layer draws the forecast",
    "Removed unknown setting nope", "Removed setting mister_min_off_s: nothing reads it on this controller",
  ]);
  expect(panels()).toHaveLength(3);
  expect(within(screen.getByRole("list", { name: "Range" })).getByRole("link", { name: "7 d" }).getAttribute("href")).toBe("/graphs?range=7d&set=");
});

test("an empty window says so with a Last 24 h link", async () => {
  chartStubs();
  await open(`/graphs?from=${iso(S - 4 * 60)}&to=${iso(S)}`, { fixture: "controller-not-reporting" });
  const empty = document.querySelector(".panel-empty")!;
  expect(text(empty)).toBe("No data in this windowLast 24 h");
  expect(within(empty as HTMLElement).getByRole("link", { name: "Last 24 h" }).getAttribute("href")).toBe("/graphs?range=24h");
});

test("while the controller is not reporting each trace stops at its last sample and the notes say STALE once; the band and the step still draw", async () => {
  chartStubs();
  await open("/graphs?range=24h&outdoor=0&set=band_vpd_low_sm", { fixture: "controller-not-reporting" });
  const [temp, vpd, rh] = panels();
  expect([...document.querySelectorAll(".gr-notes li")].map(text)).toEqual(["STALE · last data 10:36", "Temperature and VPD: Band in force", "Temperature and VPD: Band ahead of now · the stored band"]);
  for (const plot of [temp, vpd, rh]) {
    const [t, values] = plot.data as [number[], (number | null)[]];
    const last = values.findLastIndex((value) => value !== null);
    expect(t[last]).toBe(S - 6 * 60);
    expect(values.slice(last + 1).every((value) => value === null)).toBe(true);
  }
  expect([temp, vpd, rh].map((plot) => { plot.draw(); return plot.ctx.fills.some((fill) => fill.color === TOKENS["--c-band-wash"]); })).toEqual([true, true, false]);
  expect(keyItems("vpd").map((item) => item.replace(/ · (above|below) the chart [↑↓]$/, ""))).toEqual(["Band", "VPD low edge at solar noon 0.86 kPa"]);
  expect(document.querySelector(".panel-empty")).toBeNull();
});

test("with the dashboard API down the page grades nothing: no story line, no band, no in-band words", async () => {
  chartStubs();
  await open("/graphs?range=24h", {}, true);
  expect(status()).toBe("");
  expect(document.body.textContent).not.toMatch(/\bin band\b/i);
  const [temp] = panels();
  temp.draw();
  expect(temp.ctx.fills.some((fill) => fill.color === TOKENS["--c-band-wash"])).toBe(false);
});

test("CSV of this window holds exactly the plotted columns, with local times and offsets", async () => {
  chartStubs();
  await open("/graphs?range=24h&m=climate.flow_gpm&outdoor=0");
  const link = screen.getByRole("link", { name: "CSV of this window" });
  expect(link.getAttribute("href")).toMatch(/^blob:/);
  expect(link.getAttribute("download")).toBe("verdify-graphs-2026-11-01T1042-2026-11-03T1042.csv");
  const csv = await blobs[blobs.length - 1].text();
  const lines = csv.trimEnd().split("\r\n");
  expect(lines[0]).toBe("time (America/Denver),climate.temp_avg (°F),climate.vpd_avg (kPa),climate.rh_avg (%),climate.flow_gpm (gal/min)");
  // One point per minute over the past 24 h: 1,440 rows, each with the plotted traces and nothing else.
  expect(lines).toHaveLength(1441);
  expect(lines[1]).toMatch(/^2026-11-01T10:42:00-07:00,[\d.]+,[\d.]+,[\d.]+,0$/);
  expect(lines.at(-1)).toMatch(/^2026-11-02T10:41:00-07:00,[\d.]+,[\d.]+,[\d.]+,0$/);
});

/** Graphs in the shell, so API-02's outdoor reading gives the overlay its age. */
async function openInShell(path: string, options: FixtureOptions = {}) {
  const api = startFixtureApi(options);
  const Shell = createRoutesStub([{ path: "/", Component: () => <AppShell build={"f".repeat(40)} authError={null} />, children: [{ path: "graphs", Component: Graphs }] }]);
  render(<Shell initialEntries={[path]} />);
  await settle();
  return api;
}
const notes = () => [...document.querySelectorAll(".gr-notes li")].map(text);
const seriesOf = (plot: MockPlot, label: string) => plot.data[plot.opts.series.findIndex((series) => series.label === label)] as (number | null)[];

test("the outdoor overlay by default: Tempest traces on each climate panel, dashed, with their source and age said once; outdoor VPD is derived per bucket and labelled DERIVED", async () => {
  chartStubs();
  const api = await openInShell("/graphs?range=24h");
  // One read for outdoor over the measured window, one for the forecast over the next 24 h in hourly buckets.
  expect(overlayAsked(api)).toEqual([
    { metric: ["climate.outdoor_temp_f", "climate.outdoor_rh_pct"], from: iso(S - 24 * HOUR), to: iso(S), points: null },
    { metric: ["forecast.temp_f", "forecast.rh_pct", "forecast.vpd_kpa"], from: iso(S), to: iso(S + 24 * HOUR), points: "25" },
  ]);
  const [temp, vpd, rh] = panels();
  expect([temp, vpd, rh].map((plot) => plot.opts.series.slice(1).map((series) => [series.label, series.stroke, series.dash ?? null]))).toEqual([
    [["Indoor temperature", TOKENS["--c-temp"], null], ["Outdoor temperature", TOKENS["--c-outdoor"], [6, 4]]],
    [["Indoor VPD", TOKENS["--c-vpd"], null], ["Outdoor VPD · DERIVED", TOKENS["--c-outdoor"], [6, 4]]],
    [["Indoor relative humidity", TOKENS["--c-rh"], null], ["Outdoor relative humidity", TOKENS["--c-outdoor"], [6, 4]]],
  ]);
  // Fixture API-02: the Tempest's reading is 2 minutes old; the forecast was fetched at 07:00, 3 h 42 min ago, so it reads
  // STALE (#1353: it is fetched hourly). The band's source is said here once, never on the band (#1354).
  expect(notes()).toEqual(["Outdoor · Tempest via the controller · 2 min ago", "Forecast · STALE · issued 07:00", "Temperature and VPD: Band in force", "Temperature and VPD: Band ahead of now · the stored band"]);
  // The swatches in the header rows toggle each series, each reading its series alone and named in full.
  expect(within(document.querySelector<HTMLElement>("[data-panel=temperature]")!).getAllByRole("button").map((button) => [button.textContent, button.getAttribute("aria-label"), button.getAttribute("aria-pressed")])).toEqual([
    ["Indoor", "Indoor temperature", "true"], ["Outdoor", "Outdoor temperature", "true"], ["Forecast", "Forecast temperature", "true"],
  ]);
  const temps = seriesOf(temp, "Outdoor temperature"), rhs = seriesOf(rh, "Outdoor relative humidity"), vpds = seriesOf(vpd, "Outdoor VPD · DERIVED");
  expect(vpds).toHaveLength((vpd.data[0] as number[]).length);
  const at = temps.findLastIndex((value) => value !== null);
  expect(at).toBeGreaterThan(0);
  expect(vpds[at]).toBeCloseTo(outdoorVpd(temps[at], rhs[at])!, 4);
});

test("the forecast draws dotted right of now only, in --c-outdoor; its swatch hides it", async () => {
  chartStubs();
  await openInShell("/graphs?range=24h");
  const [temp] = panels();
  temp.draw();
  const dashed = temp.ctx.strokes.filter((stroke) => stroke.stroke === TOKENS["--c-outdoor"] && stroke.dash.join() === "2,3");
  expect(dashed).toHaveLength(1);
  // 11:00 to 10:00 the next day joined: 24 hourly points, every one right of the now line.
  expect(dashed[0].path).toHaveLength(24);
  const nowAt = temp.valToPos(S, "x");
  expect(dashed[0].path.every(([x]) => x > nowAt)).toBe(true);
  expect(Math.max(...(temp.data[0] as number[]))).toBeLessThan(S);
  fireEvent.click(within(document.querySelector<HTMLElement>("[data-panel=temperature]")!).getByRole("button", { name: "Forecast temperature" }));
  temp.draw();
  expect(temp.ctx.strokes.filter((stroke) => stroke.dash.join() === "2,3")).toEqual([]);
});

test("the Outdoor layer shows the overlay by default and outdoor=0 hides it: no read, no trace, no note; the chip links back", async () => {
  chartStubs();
  const on = await openInShell("/graphs?range=24h");
  const chip = () => within(screen.getByRole("list", { name: "Overlays" })).getByRole("link", { name: "Outdoor" });
  expect(chip().getAttribute("aria-current")).toBe("true");
  expect(chip().getAttribute("href")).toBe("/graphs?range=24h&outdoor=0");
  expect(overlayAsked(on)).toHaveLength(2);
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  const off = await openInShell("/graphs?range=24h&outdoor=0");
  expect(chip().getAttribute("aria-current")).toBeNull();
  expect(chip().getAttribute("href")).toBe("/graphs?range=24h");
  expect(overlayAsked(off)).toEqual([]);
  expect(panels().map((plot) => plot.opts.series.length)).toEqual([2, 2, 2]);
  expect(notes()).toEqual(["Temperature and VPD: Band in force", "Temperature and VPD: Band ahead of now · the stored band"]);
  expect(text(document.querySelector(".gr-layers .gr-menu-value"))).toBe(" · 1 changed");
  // Every other link keeps it off.
  expect(within(screen.getByRole("list", { name: "Range" })).getByRole("link", { name: "7 d" }).getAttribute("href")).toBe("/graphs?range=7d&outdoor=0");
});

test("the overlay reads STALE past twice its cadence, and an outdoor read that fails leaves the indoor traces drawn", async () => {
  chartStubs();
  await openInShell("/graphs?range=24h", { fixture: "controller-not-reporting" });
  expect(notes()[0]).toBe("Outdoor · Tempest via the controller · STALE · 6 min ago");
  cleanup(); stopFixtureApi(); MockPlot.reset(); chartStubs();
  const api = startFixtureApi();
  const answered = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => (input.includes("climate.outdoor_temp_f")
    ? { status: 503, ok: false, type: "basic", headers: new Headers({ "Content-Type": "application/problem+json" }), json: async () => ({ type: "about:blank", title: "Unavailable", status: 503, code: "unavailable", retryable: true }) } as unknown as Response
    : answered(input, init))));
  mount("/graphs?range=24h");
  await settle();
  expect(requests(api, "API-04").length).toBeGreaterThan(0);
  expect(panels()).toHaveLength(3);
  expect(seriesOf(panels()[0], "Indoor temperature").some((value) => value !== null)).toBe(true);
  expect(seriesOf(panels()[0], "Outdoor temperature").every((value) => value === null)).toBe(true);
  expect(screen.getByText("Couldn't load part of this window.")).toBeTruthy();
});

test("CSV of this window with the overlay: outdoor beside each panel's trace, derived VPD under its own key and the forecast's hours on their own rows", async () => {
  chartStubs();
  await open("/graphs?range=24h&events=");
  const lines = (await blobs[blobs.length - 1].text()).trimEnd().split("\r\n");
  expect(lines[0]).toBe("time (America/Denver),climate.temp_avg (°F),climate.outdoor_temp_f (°F),forecast.temp_f (°F),climate.vpd_avg (kPa),derived.outdoor_vpd_kpa (kPa),forecast.vpd_kpa (kPa),climate.rh_avg (%),climate.outdoor_rh_pct (%),forecast.rh_pct (%)");
  // 1,440 measured minutes, then 24 forecast hours.
  expect(lines).toHaveLength(1465);
  expect(lines[1439]).toMatch(/^2026-11-02T10:40:00-07:00,[\d.]+,[\d.]+,,[\d.]+,[\d.]+,,[\d.]+,[\d.]+,$/);
  expect(lines[1440]).toMatch(/^2026-11-02T10:41:00-07:00,[\d.]+,,,[\d.]+,,,[\d.]+,,$/);
  expect(lines[1441]).toMatch(/^2026-11-02T11:00:00-07:00,,,[\d.]+,,,[\d.]+,,,[\d.]+$/);
  expect(lines.at(-1)).toMatch(/^2026-11-03T10:00:00-07:00,,,[\d.]+,,,[\d.]+,,,[\d.]+$/);
});
