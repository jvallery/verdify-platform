// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Now's hero (dashboard v2 screens §1 blocks 1 and 10) over the fixtures at 10:42: the answer as the page's one heading;
// two band gauges, temperature and VPD, against the band the controller uses (law.band), each with its reading and its
// relation in words; RH, the dew point and outdoor with its source as plain values; when it was updated; and "All
// readings" with the law's record and the labelled AI snapshot. No mode, no plan, no DERIVED. The honest states: no
// relation and STALE values while rows 1 to 3 or 8 hold, no gauges with the API down, a null reading as "—" with its reason.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { answer, buildWorld, fixture } from "../../../e2e/fixtures/index.mjs";
import { nowAnswer } from "../../lib/now-answer";
import { parseLawView, parseNow, parseSeries, type LawView, type Now, type Series } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { DEFAULT_SESSION, SessionProvider } from "../../lib/session";
import { text } from "../test-render";
import { DAY_KEYS, DAY_POINTS, DAY_WINDOW_S } from "./climate";
import { NowHero, bandSourceText, lawItems } from "./hero";
import { SNAPSHOT_AUTHOR, snapshotState } from "./snapshot";

const NOW = Date.parse("2026-11-02T17:42:00Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const plain = (value: string) => value.replaceAll(String.fromCharCode(0xa0), " ");
const series = (names: string | string[], metric: readonly string[], from: string, to: string, points: number): Series => {
  const query = new URLSearchParams([...metric.map((key) => ["metric", key]), ["from", from], ["to", to], ["points", String(points)]]);
  return parseSeries(answer(buildWorld(names, { now: NOW }), { method: "GET", url: `/v1/series?${query}` }).body)!;
};
const read = <T,>(data: T | null, failed = false): PanelRead<T> => ({ data, failed, pending: data === null && !failed, retry: vi.fn() });
const dayRead = (names: string | string[]) => read(series(names, DAY_KEYS, new Date(NOW - DAY_WINDOW_S * 1000).toISOString(), new Date(NOW).toISOString(), DAY_POINTS));
type Options = { failed?: boolean; data?: boolean; apiDown?: boolean; path?: string; patch?: (now: Now) => Now };
function renderHero(names: string | string[], { failed = false, data = true, apiDown = false, path = "/", patch = (now) => now }: Options = {}) {
  const world = fixture(names, { now: NOW });
  const now = data ? patch(parseNow(world["API-02"])!) : null;
  const law = read(parseLawView(world["API-30"]));
  const retry = vi.fn();
  const props = { now, answer: nowAnswer({ now, failed }), day: dayRead(names), law, onRetry: retry };
  const view = render(<MemoryRouter initialEntries={[path]}><SessionProvider {...DEFAULT_SESSION} apiDown={apiDown}><NowHero {...props} /></SessionProvider></MemoryRouter>);
  return { ...view, retry, props };
}
const heading = () => plain(text(screen.getByRole("heading", { level: 1 })));
const gauges = () => [...document.querySelectorAll(".now-band")].map((row) => ({
  tile: row.getAttribute("data-tile"), value: plain(text(row.querySelector(".now-band-value"))), meta: plain(text(row.querySelector(".now-band-meta"))),
}));
const RETIRED = /\b(mode|plan|planner|Iris|DERIVED|target|stage|waypoint)\b/;

test("in band: All OK, two gauges (temperature and VPD) against the controller's band with their relation, RH, dew point and outdoor as plain values", () => {
  renderHero("in-band");
  expect(heading()).toBe("All OK");
  const rows = gauges();
  expect(rows.map((row) => row.tile)).toEqual(["temp", "vpd"]);
  expect(rows[0].meta).toMatch(/^in band · band 61\.2–70(\.0)? °F$/);
  expect(rows[1].meta).toMatch(/band 0\.45–0\.8(0)? kPa/);
  expect(plain(text(document.querySelector("[data-band-source]")))).toBe("Band in use by the controller");
  expect(document.querySelector("[data-plain=rh] dd")?.textContent).toMatch(/%$/);
  expect(document.querySelector("[data-plain=dew] dt")?.textContent).toBe("Dew point");
  expect(plain(text(document.querySelector("[data-plain=outdoor]")))).toMatch(/^Outdoor.*°F/);
  expect(text(document.querySelector(".now-hero"))).not.toMatch(RETIRED);
  expect(screen.queryByText("RH", { selector: ".now-band-label" })).toBeNull();
});

test("each gauge links to its Graphs panel, and the freshness link opens All readings with the law's record as reported", () => {
  renderHero("in-band");
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".now-band-label")].map((link) => link.getAttribute("href"));
  expect(links).toEqual(["/graphs?range=24h#temperature", "/graphs?range=24h#vpd"]);
  const details = document.querySelector<HTMLDetailsElement>("details.now-readings")!;
  expect(details.open).toBe(false);
  fireEvent.click(document.querySelector("[data-tile=data]")!);
  expect(details.open).toBe(true);
  const readings = plain(text(details));
  expect(readings).toContain("Law record");
  expect(readings).toContain("Drying");
  expect(readings).toContain("Newest climate row");
  expect(readings).not.toMatch(RETIRED);
});

test("#data and #readings open All readings in place", () => {
  renderHero("in-band", { path: "/#readings" });
  expect(document.querySelector<HTMLDetailsElement>("details.now-readings")!.open).toBe(true);
});

test("the law's record in words: what it asks for, what it wants, the drying decision with both prices, and the band edges", () => {
  const now = parseNow(fixture("in-band", { now: NOW })["API-02"])!;
  const items = lawItems({ ...now.law!, requests: ["heat1"], latches: ["air"], drying: "refused", drying_refused_reason: "cost", drying_cost_kwh_per_kg: 0.82, drying_cost_limit_kwh_per_kg: 0.7 });
  const value = (key: string) => plain(String(items.find((item) => item.key === key)?.value ?? ""));
  expect(value("law_requests")).toBe("asked for electric heat");
  expect(value("law_drying")).toMatch(/^drying refused: .+ · 0\.82 kWh\/kg, limit 0\.70 kWh\/kg$/);
  const free = lawItems({ ...now.law!, drying_cost_kwh_per_kg: null });
  expect(plain(String(free.find((item) => item.key === "law_drying")?.value))).toContain("no price");
});

test("out of band: a headline that is no link, the reading and edge in a plain line with Graphs, and the gauge says how far above", () => {
  renderHero("too-hot");
  const h1 = screen.getByRole("heading", { level: 1 });
  expect(h1.querySelector("a")).toBeNull();
  expect(heading()).not.toBe("All OK");
  const conditions = document.querySelector("[data-conditions]");
  expect(conditions).not.toBeNull();
  expect(within(conditions as HTMLElement).getAllByRole("link")[0].getAttribute("href")).toMatch(/^\/graphs/);
  expect(gauges().some((row) => /above|below/.test(row.meta))).toBe(true);
});

test("rows 2 and 3: values muted with STALE, no relation, and the gauges say when they were read", () => {
  for (const names of ["ingestor-not-running", "controller-not-reporting"]) {
    renderHero(names);
    expect(document.querySelector(".now-hero-climate")?.hasAttribute("data-stale")).toBe(true);
    expect(gauges().every((row) => !/in band|above|below/.test(row.meta))).toBe(true);
    expect(text(document.querySelector(".now-bands-asof"))).toMatch(/^As of /);
    cleanup();
  }
});

test("the band the controller has not reported: the host's band, said so", () => {
  const now = parseNow(fixture("in-band", { now: NOW })["API-02"])!;
  expect(bandSourceText({ ...now, law: null })).toBe("The host's band: the controller has not reported its own");
  expect(bandSourceText({ ...now, law: { ...now.law!, band_repaired: true } })).toBe("Band in use by the controller, repaired by it");
});

test("a null reading reads — with its reason, never 0", () => {
  renderHero("in-band", { patch: (now) => ({ ...now, indoor: { ...now.indoor, vpd_kpa: { value: null, observed_at: null, reason: "probe offline" } } }) });
  const vpd = gauges()[1];
  expect(vpd.value).toBe("—");
  expect(vpd.meta).toBe("probe offline");
});

test("API-02 failing: row 1 with Retry; with the API down no gauges; before API-02 answers the hero claims nothing", () => {
  const { retry } = renderHero("in-band", { failed: true, data: false });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(document.querySelector(".now-bands")).toBeNull();
  cleanup();
  renderHero("in-band", { apiDown: true });
  expect(document.querySelector(".now-bands")).toBeNull();
  expect(document.querySelector(".now-hero-plain")).not.toBeNull();
  cleanup();
  render(<MemoryRouter><NowHero now={null} answer={nowAnswer({ now: null, failed: false })} day={read<Series>(null)} law={read<LawView>(null)} onRetry={vi.fn()} /></MemoryRouter>);
  expect(document.querySelector(".hero-loading")?.getAttribute("aria-busy")).toBe("true");
});

test("the AI snapshot sits inside All readings, labelled with its author, time and the AI mark; stale reads muted; outdated or old never shows", () => {
  const snapshot = { text: "Warm and steady.", as_of: "2026-11-02T17:40:00Z", generated_at: "2026-11-02T17:40:05Z", model: "qwen", stale: false, stale_reason: null, outdated: false };
  renderHero("in-band", { patch: (now) => ({ ...now, snapshot }) as Now });
  const block = document.querySelector("details.now-readings [data-snapshot]")!;
  expect(block.getAttribute("data-snapshot")).toBe("fresh");
  expect(plain(text(block))).toMatch(new RegExp(`^AI snapshot.*Warm and steady\\..*Written by ${SNAPSHOT_AUTHOR.replace(/[()]/g, "\\$&")} at .* · AI$`));
  expect(snapshotState({ ...snapshot, stale: true }, NOW)).toBe("stale");
  expect(snapshotState({ ...snapshot, outdated: true }, NOW)).toBeNull();
  expect(snapshotState({ ...snapshot, as_of: "2026-11-02T15:00:00Z" }, NOW)).toBeNull();
  expect(snapshotState({ ...snapshot, text: "  " }, NOW)).toBeNull();
});
