// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Search (README section 3.2): one dialog with a combobox that finds pages, settings by label or name, relays, water
// lines and glossary terms, grouped, at most 8 a group; arrows, Enter and Escape; `/` and Ctrl or ⌘ K open it.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub, useLocation } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFixtureHandler } from "../../../e2e/fixture-api.mjs";
import { FindSetting } from "../control/find-setting";
import { GROUP_LABELS, LINE_ITEMS, PAGE_ITEMS, PER_GROUP, RELAY_ITEMS, TERM_ITEMS, searchResults, settingItems } from "./search-model";
import { SearchButton, SearchProvider } from "./search";

const NOW = Date.parse("2026-11-02T17:42:00Z");
const ALL = [...PAGE_ITEMS, ...settingItems([{ param: "mister_engage_kpa", label: "Mister engage VPD" }]), ...RELAY_ITEMS, ...LINE_ITEMS, ...TERM_ITEMS];
const labels = (query: string, items = ALL) => searchResults(query, items).map((group) => [group.label, group.items.map((item) => item.label)]);

test("pages, relays, lines and terms come from the one model and the shared words", () => {
  expect(PAGE_ITEMS).toHaveLength(26);
  expect(PAGE_ITEMS.find((item) => item.to === "/climate/drying")).toMatchObject({ label: "Drying", group: "pages" });
  expect(RELAY_ITEMS.map((item) => item.label)).toEqual(["Fan 1", "Fan 2", "Vent", "Heat 1 (electric)", "Heat 2 (gas)", "Main light", "Grow light"]);
  expect(new Set(RELAY_ITEMS.map((item) => item.to))).toEqual(new Set(["/equipment"]));
  expect(LINE_ITEMS.map((item) => item.detail)).toEqual(["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08", "L09", "L10", "L11"]);
  expect(new Set(LINE_ITEMS.map((item) => item.to))).toEqual(new Set(["/water"]));
  expect(TERM_ITEMS.find((item) => item.label === "VPD")).toMatchObject({ to: "/settings#glossary", detail: expect.stringMatching(/^Vapour pressure deficit/) });
  expect(settingItems([{ param: "dry_cost_limit_kwh_per_kg", label: "Drying cost limit" }])[0]).toMatchObject({ to: "/settings?edit=dry_cost_limit_kwh_per_kg", detail: "dry_cost_limit_kwh_per_kg" });
});

test("results are grouped in a fixed order, a label that starts with the query first, every word required, empty finds nothing", () => {
  expect(labels("")).toEqual([]);
  expect(labels("   ")).toEqual([]);
  expect(labels("drying")).toEqual([
    ["Pages", ["Drying"]], ["Terms", ["Drying", "Drying cost limit", "Price of drying", "Rule", "Refused", "Daily record", "Night dried"]],
  ]);
  // By label or by name; by any word of either.
  const settings = settingItems([{ param: "mister_engage_kpa", label: "Mister engage VPD" }]);
  for (const query of ["mister engage", "engage_kpa", "engage kpa", "MISTER_ENGAGE"]) expect(labels(query, settings), query).toEqual([["Settings", ["Mister engage VPD"]]]);
  expect(labels("mister drip", settings)).toEqual([]);
  expect(labels("l07")).toEqual([["Water lines", ["South mister"]]]);
  const fan = searchResults("fan", ALL);
  expect(fan.find((group) => group.label === "Relays")?.items.map((item) => item.label)).toEqual(["Fan 1", "Fan 2"]);
  expect(fan.map((group) => group.group)).toEqual([...new Set(fan.map((group) => group.group))]);
  expect(Object.keys(GROUP_LABELS)).toEqual(["pages", "settings", "relays", "lines", "terms"]);
});

test("at most 8 a group", () => {
  const many = settingItems(Array.from({ length: 20 }, (_, index) => ({ param: `band_edge_${index}`, label: `Band edge ${index}` })));
  const groups = searchResults("band edge", many);
  expect(groups).toHaveLength(1);
  expect(groups[0].items).toHaveLength(PER_GROUP);
  expect(PER_GROUP).toBe(8);
});

// ---------------------------------------------------------------------------------------------------- the dialog
function serve() {
  const api = createFixtureHandler({ fixture: "in-band", clock: () => NOW });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const out = api.respond({ method: init.method, url: input, headers: init.headers as Record<string, string> | undefined, body: init.body as string | undefined });
    return new Response(out.body === null || out.body === undefined ? null : JSON.stringify(out.body), { status: out.status, headers: out.headers });
  }));
}
function Where() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="where">{`${pathname}${search}${hash}`}</output>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Page = () => <><Where /><SearchButton /><FindSetting /><input aria-label="A field" /></>;
  const Stub = createRoutesStub([{ path: "*", Component: () => <QueryClientProvider client={client}><SearchProvider><Page /></SearchProvider></QueryClientProvider> }]);
  return render(<Stub initialEntries={["/"]} />);
}
const dialog = () => screen.queryByRole("dialog", { name: "Search" });
const field = () => within(dialog()!).getByRole("combobox");
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }); vi.setSystemTime(new Date(NOW)); serve(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test("the button, / and Ctrl or ⌘ K open one dialog with focus in the combobox; / typed in a field is the field's", async () => {
  mount();
  expect(dialog()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  expect(dialog()).not.toBeNull();
  expect(document.activeElement).toBe(field());
  expect(field().getAttribute("aria-autocomplete")).toBe("list");
  expect(field().getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(dialog()!, { key: "Escape" });
  expect(dialog()).toBeNull();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "A field" }), { key: "/" });
  expect(dialog()).toBeNull();
  fireEvent.keyDown(document.body, { key: "/" });
  expect(dialog()).not.toBeNull();
  fireEvent.keyDown(dialog()!, { key: "Escape" });
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  expect(dialog()).not.toBeNull();
  fireEvent.keyDown(dialog()!, { key: "Escape" });
  fireEvent.keyDown(document.body, { key: "K", metaKey: true });
  expect(dialog()).not.toBeNull();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

test("typing groups the results; arrows move the active option, Enter goes there and closes", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  fireEvent.change(field(), { target: { value: "band" } });
  const listbox = within(dialog()!).getByRole("listbox");
  const groups = within(listbox).getAllByRole("group");
  expect(groups.map((group) => group.getAttribute("aria-labelledby") && document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent)[0]).toBe("Pages");
  const options = within(listbox).getAllByRole("option");
  expect(options[0].querySelector(".search-option-label")?.textContent).toBe("Band");
  expect(options[0].getAttribute("aria-selected")).toBe("true");
  expect(field().getAttribute("aria-activedescendant")).toBe(options[0].id);
  expect(field().getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(field(), { key: "ArrowDown" });
  expect(field().getAttribute("aria-activedescendant")).toBe(options[1].id);
  fireEvent.keyDown(field(), { key: "ArrowUp" });
  fireEvent.keyDown(field(), { key: "Enter" });
  expect(dialog()).toBeNull();
  expect(screen.getByTestId("where").textContent).toBe("/band");
});

test("settings are found by label or name once the settings read answers, and open their drawer on Settings", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle();
  fireEvent.change(field(), { target: { value: "outdoor_staleness_max_s" } });
  const option = within(dialog()!).getAllByRole("option").find((item) => item.textContent?.includes("outdoor_staleness_max_s"));
  expect(option).toBeTruthy();
  fireEvent.click(option!);
  expect(screen.getByTestId("where").textContent).toBe("/settings?edit=outdoor_staleness_max_s");
});

test("nothing found says so; a term opens the glossary; Find a setting opens Search with its words", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  fireEvent.change(field(), { target: { value: "zzzz" } });
  expect(within(dialog()!).queryAllByRole("option")).toHaveLength(0);
  expect(within(dialog()!).getByText("Nothing matches “zzzz”.")).toBeTruthy();
  expect(within(dialog()!).getByRole("status").textContent).toBe("No results");
  fireEvent.change(field(), { target: { value: "vapour pressure" } });
  const term = within(dialog()!).getAllByRole("option").find((item) => item.getAttribute("data-group") === "terms")!;
  expect(term.textContent).toMatch(/^VPDVapour pressure deficit/);
  fireEvent.click(term);
  expect(screen.getByTestId("where").textContent).toBe("/settings#glossary");
  // Find a setting hands its words to Search instead of leaving the page.
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a setting" }), { target: { value: "mister" } });
  fireEvent.submit(screen.getByRole("search", { name: "Find a setting" }));
  expect((field() as HTMLInputElement).value).toBe("mister");
  expect(screen.getByTestId("where").textContent).toBe("/settings#glossary");
});
