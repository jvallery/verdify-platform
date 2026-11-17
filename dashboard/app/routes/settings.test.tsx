// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Settings (dashboard v2 screens §10.4) inside the shell, against #1122's fixture API in process: API-09's base is the
// settings fixture rendered at test time from verdify_schemas/tunable_registry.py (pnpm fixtures:settings). The answer,
// the filter by what reads a setting, the groups, the folded settings nothing reads, search, the drawer's Save and
// Release, the pages that own the band and the drying cost limit, a viewer, and each block's four states. Fake timers at
// 10:42 America/Denver on 2026-11-02.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub, useLocation } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "../../e2e/fixtures/index.mjs";
import { FakeResizeObserver, MockPlot, media, setTokens } from "../charts/fixtures/uplot-mock";
import { AppShell } from "../components/app-shell";
import { text } from "../components/test-render";
import { GLOSSARY } from "../lib/glossary";
import { SETTING_GROUPS } from "../lib/settings-context";
import { NOW, UUID, advance, startFixtureApi, stopFixtureApi, writes, type FixtureOptions } from "../lib/test-fixture-api";
import Settings, { UNUSED_SUMMARY, filterOf, links, settingsStatus } from "./settings";

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));

beforeEach(() => { MockPlot.reset(); FakeResizeObserver.instances = []; });
afterEach(() => { cleanup(); stopFixtureApi(); document.documentElement.removeAttribute("style"); });
const BUILD = "fedcba9876543210fedcba9876543210fedcba98";
type Row = { param: string; label: string; group: string; control_class: string; effect?: string; state: string; [field: string]: unknown };

/** What reads each row, as the generator gives it, for a fixture rendered before `Setting.effect`. */
const ANCHORS = ["sr", "sm", "ss", "mid"], ZONES = ["center", "south", "west", "east"];
const UNUSED = new Set([
  "mister_engage_delay_s", "mister_min_off_s", "sw_direct_wet_gate_enabled", "mister_hysteresis_kpa", "site_pressure_hpa", "direct_wet_min_temp_f",
  ...ZONES.flatMap((zone) => ANCHORS.map((anchor) => `zone_vpd_target_${zone}_${anchor}`)),
  ...["below", "above"].flatMap((side) => ZONES.map((zone) => `zone_vpd_width_${side}_${zone}`)),
  ...["center", "south", "west"].map((zone) => `zone_priority_${zone}`),
  ...["temp", "vpd"].flatMap((axis) => ANCHORS.map((anchor) => `band_${axis}_target_${anchor}`)),
]);
const withEffect = (rows: Row[]): Row[] => rows.map((row) => (row.effect ? row : {
  ...row, effect: row.group === "band_in_force" ? "host" : row.control_class === "retired" || UNUSED.has(row.param) ? "none" : "controller",
}));
const served = (): Row[] => withEffect(fixture("in-band", { now: NOW })["API-09"].items as Row[]);

function Here() {
  const { pathname, search } = useLocation();
  return <output data-testid="here">{`${pathname}${search}`}</output>;
}
/** API-09's rows as the fixture API serves them, with `effect` and changed by `patch` on every read. */
function patchSettings(patch: (items: Row[]) => Row[]) {
  const fixtureFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const response = await fixtureFetch(input, init);
    if (!input.startsWith("/api/v1/settings") || input.includes("/history") || (init?.method ?? "GET") !== "GET" || !response.ok) return response;
    const body = await response.json() as { items: Row[] };
    body.items = patch(withEffect(body.items));
    return { ...response, json: async () => body } as Response;
  });
}
/** The shell with Settings at `path`, served by the fixture API; the shell's reads and API-09 have answered. */
async function open(path: string, { patch = (items) => items, session, ...options }: FixtureOptions & { patch?: (items: Row[]) => Row[]; session?: string } = {}) {
  const api = startFixtureApi(session ? { ...options, fixture: [options.fixture ?? "in-band", session].flat() as string[] } : options);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
  patchSettings(patch);
  const Stub = createRoutesStub([{
    path: "/", Component: () => <AppShell build={BUILD} authError={null} />,
    children: [{ path: "settings", Component: () => <><Settings /><Here /></> }],
  }]);
  render(<Stub initialEntries={[path]} />);
  await settle();
  return api;
}
async function settle() {
  for (let pass = 0; pass < 4; pass += 1) {
    await advance(10);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
}
const here = () => screen.getByTestId("here").textContent;
const panel = (id: string) => document.getElementById(id)!;
const shownIn = (id: string) => [...panel(id).querySelectorAll("tr.setting-row")].map((row) => row.getAttribute("data-param"));
const groupsIn = (id: string) => [...panel(id).querySelectorAll("tbody[data-group]")].map((body) => body.getAttribute("data-group"));
const rowOf = (param: string) => document.querySelector(`tr.setting-row[data-param="${param}"]`)!;
const dialog = () => document.querySelector("dialog")!;
const drawerOpen = () => document.querySelector("dialog")?.hasAttribute("open") ?? false;
const segments = () => [...document.querySelectorAll(".ctl-settings-tools a")].map((link) => [text(link), link.getAttribute("aria-current")]);

test("the answer, then the settings in use by group, and those nothing reads folded under the sentence that says so", async () => {
  await open("/settings");
  const rows = served();
  const controller = rows.filter((row) => row.effect === "controller"), host = rows.filter((row) => row.effect === "host"), none = rows.filter((row) => row.effect === "none");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Settings");
  expect(text(document.querySelector(".page-status"))).toBe(`${rows.length} settings · ${controller.length} read by the controller · 0 not confirmed`);
  expect(segments()).toEqual([
    [`All ${rows.length}`, "page"], [`Read by the controller ${controller.length}`, null], [`Used by the host ${host.length}`, null], [`Stored and not used ${none.length}`, null],
  ]);
  // In use: grouped by what a setting is for, in the fixed order, the API's order within a group.
  const order = SETTING_GROUPS.map(([group]) => group);
  const inUse = [...controller, ...host];
  expect(shownIn("settings-in-use")).toEqual(order.flatMap((group) => inUse.filter((row) => row.group === group).map((row) => row.param)));
  expect(groupsIn("settings-in-use")).toEqual(["crop_band", "controller_safety", "scheduled_policy", "site_water_caps", "band_in_force", "read_only"]);
  expect(text(panel("settings-in-use").querySelector('tbody[data-group="crop_band"] .ctl-group-head'))).toBe(`The band · ${inUse.filter((row) => row.group === "crop_band").length}`);
  // Nothing reads them: folded, and listed in full when unfolded.
  const unused = panel("settings-unused");
  expect(text(unused.querySelector("h2"))).toContain(`Stored and not used · ${none.length}`);
  expect([unused.querySelector("details")!.open, text(unused.querySelector("summary"))]).toEqual([false, UNUSED_SUMMARY]);
  expect(shownIn("settings-unused").sort()).toEqual(none.map((row) => row.param).sort());
  // No retired word anywhere on the page.
  expect(document.querySelector("main")!.textContent).not.toMatch(/\b(planner|waypoint|Iris changed|Let Iris|tunable|scorecard)\b/i);
});

test("the filter is in the URL: each shows only what reads it, and Stored and not used opens its fold", async () => {
  await open("/settings?show=controller");
  expect(segments()[1][1]).toBe("page");
  expect(shownIn("settings-in-use")).toHaveLength(served().filter((row) => row.effect === "controller").length);
  expect(document.getElementById("settings-unused")).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: /^Used by the host/ }));
  await settle();
  expect(here()).toBe("/settings?show=host");
  expect(groupsIn("settings-in-use")).toEqual(["band_in_force"]);
  fireEvent.click(screen.getByRole("link", { name: /^Stored and not used/ }));
  await settle();
  expect(document.getElementById("settings-in-use")).toBeNull();
  expect(panel("settings-unused").querySelector("details")!.open).toBe(true);
  expect([filterOf("none"), filterOf("bogus"), filterOf(null)]).toEqual(["none", "all", "all"]);
});

test("search matches the name shown, the key and what it does; nothing found offers Clear search", async () => {
  await open("/settings?q=sunrise%20low%20edge");
  expect(shownIn("settings-in-use")).toEqual(expect.arrayContaining(["band_temp_low_sr", "band_vpd_low_sr"]));
  expect(shownIn("settings-in-use")).not.toContain("outdoor_staleness_max_s");
  cleanup(); stopFixtureApi();
  await open("/settings?q=gl_main_lux");
  expect(shownIn("settings-in-use")).toEqual(["gl_main_lux_threshold", "gl_main_lux_hysteresis"]);
  cleanup(); stopFixtureApi();
  await open("/settings?q=zzzz");
  expect(within(panel("settings-in-use")).getByText("No setting matches “zzzz”.")).toBeTruthy();
  expect(within(panel("settings-in-use")).getByRole("link", { name: "Clear search" }).getAttribute("href")).toBe("/settings");
  // A search that matches nothing nothing-reads leaves that panel out.
  expect(document.getElementById("settings-unused")).toBeNull();
});

test("Edit opens the drawer: value, readback, state, bounds and what it does; Save sends one API-10 and the row reads Not confirmed since then Confirmed", async () => {
  const api = await open("/settings?q=outdoor_staleness_max_s", { fixture: "requested-to-confirmed" });
  expect(text(rowOf("outdoor_staleness_max_s").querySelector(".setting-state"))).toBe("Confirmed");
  fireEvent.click(screen.getByRole("link", { name: "Edit Outdoor Staleness Max" }));
  await settle();
  expect(drawerOpen()).toBe(true);
  expect(here()).toBe("/settings?q=outdoor_staleness_max_s&edit=outdoor_staleness_max_s");
  expect(text(dialog().querySelector(".drawer-heading"))).toBe("Outdoor Staleness Max");
  const facts = [...dialog().querySelectorAll(".ctl-setting-status dt")].map((term) => text(term));
  expect(facts).toEqual(["Value", "Controller reads", "State", "Allowed", "In use"]);
  // The retired pieces are gone: no planner box, no plan line, no manual-versus-planner word.
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(dialog().textContent).not.toMatch(/\b(Let Iris|plan|planner|manual|Iris changed)\b/i);
  expect(within(dialog()).getByRole("link", { name: "Activity for this setting" }).getAttribute("href")).toBe("/activity/log?target=outdoor_staleness_max_s");
  fireEvent.change(screen.getByLabelText("New value"), { target: { value: "640" } });
  fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Vandas drying" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await advance(0);
  const sent = writes(api);
  expect(sent).toEqual([expect.objectContaining({ method: "PUT", operationId: "API-10", path: "/api/v1/settings/outdoor_staleness_max_s", body: { value: 640, manual: true, reason: "Vandas drying" } })]);
  expect(sent[0].idempotency_key).toMatch(UUID);
  expect(drawerOpen()).toBe(false);
  await settle();
  expect(text(rowOf("outdoor_staleness_max_s").querySelector(".setting-state"))).toMatch(/^Not confirmed since 10:42/);
  expect(text(document.querySelector(".banner"))).toContain("1 setting is not confirmed by the controller: Outdoor Staleness Max");
  await advance(5_000);
  await advance(5_000);
  await settle();
  expect(text(rowOf("outdoor_staleness_max_s").querySelector(".setting-state"))).toBe("Confirmed");
  expect(text(rowOf("outdoor_staleness_max_s").querySelector(".setting-value-text"))).toBe("630 s");
  expect(writes(api)).toHaveLength(1);
});

test("Release, with an operator's value standing, sends one API-11", async () => {
  const api = await open("/settings?edit=outdoor_staleness_max_s", { fixture: "setting-history" });
  expect(within(dialog()).getByText("Release drops the value an operator set; the host then sends the setting's own value again.")).toBeTruthy();
  fireEvent.click(within(dialog()).getByRole("button", { name: "Release" }));
  await advance(0);
  expect(writes(api).map((row) => [row.method, row.operationId])).toEqual([["DELETE", "API-11"]]);
});

test("a band point and the drying cost limit open read-only with a link to their page; a setting nothing reads says so above its field", async () => {
  await open("/settings?edit=band_temp_low_sr");
  expect(text(dialog().querySelector(".drawer-heading"))).toBe("Temperature low edge at sunrise");
  expect(screen.queryByLabelText("New value")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(within(dialog()).getByRole("link", { name: "Change on Band" }).getAttribute("href")).toBe("/band");
  cleanup(); stopFixtureApi();
  await open("/settings?edit=dry_cost_limit_kwh_per_kg");
  expect(within(dialog()).getByRole("link", { name: "Change on Drying" }).getAttribute("href")).toBe("/climate/drying");
  expect(screen.queryByLabelText("New value")).toBeNull();
  cleanup(); stopFixtureApi();
  await open("/settings?edit=mister_engage_delay_s");
  expect(text(dialog().querySelector(".ctl-no-effect"))).toBe("Nothing on this controller reads this setting: changing it changes nothing.");
  expect(screen.getByLabelText("New value")).toBeTruthy();
  cleanup(); stopFixtureApi();
  await open("/settings?q=gl_main_lux_threshold");
  expect(within(rowOf("gl_main_lux_threshold") as HTMLElement).getByRole("link", { name: "Lights" }).getAttribute("href")).toBe("/lights");
});

test("a viewer sees every row with Details and no write control; ?edit= opens the drawer read-only", async () => {
  await open("/settings?edit=outdoor_staleness_max_s", { session: "viewer-session" });
  expect(document.querySelector("main [data-write-control]")).toBeNull();
  expect(screen.queryAllByRole("link", { name: /^Edit / })).toEqual([]);
  expect(screen.getAllByRole("link", { name: /^Details of / }).length).toBeGreaterThan(0);
  expect(drawerOpen()).toBe(true);
  expect(screen.queryByLabelText("New value")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Release" })).toBeNull();
});

test("each block's four states: loading, failed with Retry, empty, and stale readbacks", async () => {
  await open("/settings", { fail: { "API-09": 503 } });
  expect(within(panel("settings-in-use")).getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(text(document.querySelector(".page-status"))).toBe("");
  cleanup(); stopFixtureApi();
  await open("/settings", { patch: (items) => items.filter((row) => row.effect !== "none") });
  expect(within(panel("settings-unused")).getByText("No setting of this kind.")).toBeTruthy();
  cleanup(); stopFixtureApi();
  await open("/settings?q=outdoor_staleness_max_s", { fixture: "controller-not-reporting" });
  expect(rowOf("outdoor_staleness_max_s").querySelector('[data-readback="stale"]')).not.toBeNull();
  expect(panel("settings-in-use").getAttribute("data-state")).toBe("stale");
});

test("the status line, the route's chart styles and the glossary at #glossary", async () => {
  expect(settingsStatus(null)).toBeNull();
  const rows = served() as never[];
  expect(settingsStatus(rows, true)).toBe(`${rows.length} settings · 0 not confirmed`);
  expect(links().length).toBeGreaterThan(0);
  await open("/settings#glossary");
  const glossary = panel("glossary");
  expect(glossary.querySelector("details")!.open).toBe(true);
  expect(text(glossary.querySelector("summary"))).toBe(`${Object.keys(GLOSSARY).length} terms the pages use`);
});
