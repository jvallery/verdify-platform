// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Climate → Band (screens 2.2) against the fixture API in process, with uPlot mocked, at the screens' 10:42 America/Denver
// on 2026-11-02: a save round trip (edit, preview, confirm sheet, one API-24 write, the readback and the history), the edge
// form round trip (an axis put back to sunrise and sunset halfway is stored that way and opens as edges), a proposal
// loaded on arrival, and a viewer and writes off.
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, MockPlot, media, setTokens } from "../charts/fixtures/uplot-mock";
import { PREVIEW_DEBOUNCE_MS } from "../components/band-preview";
import { text } from "../components/test-render";
import type { Session } from "../lib/session";
import { OPERATOR, advance, renderWithApi, requests, startFixtureApi, stopFixtureApi, writes, type FixtureApi, type FixtureOptions } from "../lib/test-fixture-api";
import Band from "./band";

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));

async function settle(passes = 6) {
  for (let pass = 0; pass < passes; pass++) {
    await advance(10);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
}
async function open(options: FixtureOptions = {}, session: Partial<Session> = OPERATOR, path = "/band") {
  const api = startFixtureApi(options);
  renderWithApi(<Band />, session, path);
  await settle();
  return api;
}
const panel = (name: string) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;
const input = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const splits = () => screen.getAllByRole("checkbox", { name: "Set sunrise and sunset separately" }) as HTMLInputElement[];
const sheet = () => document.querySelector("dialog.band-confirm") as HTMLDialogElement;
async function type(name: string, value: string) {
  fireEvent.change(input(name), { target: { value } });
  await advance(PREVIEW_DEBOUNCE_MS);
  await settle();
}
async function save(reason = "") {
  if (reason) fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: reason } });
  fireEvent.click(screen.getByRole("button", { name: "Save band…" }));
  await settle();
  fireEvent.click(within(sheet()).getByRole("button", { name: "Save band" }));
  await settle(10);
}
const bandWrites = (api: FixtureApi) => writes(api).filter((row) => row.operationId === "API-24");

beforeEach(() => {
  MockPlot.reset();
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
});
afterEach(() => { cleanup(); stopFixtureApi(); document.documentElement.removeAttribute("style"); });

test("the page answers first: the header's delivery status, then the band in words, the editor and the side blocks", async () => {
  await open();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Band");
  expect(text(document.querySelector(".page-header, header"))).toContain("The controller has confirmed every edge");
  expect(screen.queryByRole("heading", { name: "Proposal from the daily review" })).toBeNull();
  expect(text(panel("The band"))).toMatch(/^The band\s*The house is held at 71\.8–85\.8 °F/);
  for (const name of ["The band", "Set the band", "On the controller", "Drying cost limit"]) expect(panel(name).getAttribute("data-state"), name).toBe("ready");
  expect(panel("Changes").getAttribute("data-state")).toBe("empty");
  expect(text(document.querySelector("details.band-explainer summary"))).toBe("How the band works");
});

test("a save round trip: the edit previews, the sheet lists it, one API-24 write sends it, the page shows it sent and in the history", async () => {
  const api = await open();
  await type("Temperature low edge at solar midnight", "62.7");
  expect(requests(api, "API-23").map((row) => decodeURIComponent(new URL(row.path, "http://x").search))).toContain("?anchor=band_temp_low_mid:62.7");
  // The preview draws the draft and the night heat with the draft.
  expect(text(panel("The band"))).toMatch(/with the draft\./);
  await save("Warmer nights");
  const sent = bandWrites(api);
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toEqual({ profile: {}, anchors: { band_temp_low_mid: 62.7 }, reason: "Warmer nights" });
  expect(sheet().hasAttribute("open")).toBe(false);
  // The readback: the edge was sent and waits for the controller (or is already confirmed); the history has the save.
  expect(text(panel("On the controller"))).toMatch(/You saved 1 edge at \d\d:\d\d; (0 of 1 confirmed so far|the controller has confirmed it)\./);
  await advance(60_000);
  await settle();
  expect(text(panel("Changes"))).toMatch(/· 1 change/);
  expect(text(panel("Changes"))).toContain("Warmer nights");
  // The fields start again from the band as stored, which now holds the new edge.
  expect(input("Temperature low edge at solar midnight").value).toBe("62.7");
  expect(input("Temperature low edge at solar midnight").closest(".band-cell")?.hasAttribute("data-changed")).toBe(false);
});

test("the edge form round trip: an axis put back halfway sends its four edges and opens as edges once stored", async () => {
  const api = await open();
  fireEvent.click(splits()[0]);
  await advance(PREVIEW_DEBOUNCE_MS);
  await settle();
  await type("Temperature low edge at night", "61.7");
  await save();
  const sent = bandWrites(api);
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toEqual({ profile: { temp_low_day: 71.8, temp_high_day: 85.8, temp_low_night: 61.7, temp_high_night: 70.7 }, anchors: {} });
  await settle();
  // Stored with sunrise and sunset halfway, the temperature axis opens as its four edges; VPD stays split.
  expect(splits().map((box) => box.checked)).toEqual([false, true]);
  expect(input("Temperature low edge at night").value).toBe("61.7");
});

test("a proposal named in the URL loads on arrival: its edges fill the fields and the sheet lists exactly what it changes", async () => {
  const api = await open({ fixture: "review-proposal-waiting" }, OPERATOR, "/band?proposal=9");
  expect(text(panel("Proposal from the daily review"))).toContain("Waiting");
  expect(within(panel("Proposal from the daily review")).getByRole("button", { name: "Loaded" })).toBeTruthy();
  expect(text(panel("Set the band"))).toContain("The daily review's proposal is loaded");
  expect(input("Temperature low edge at sunrise").value).toBe("64.5");
  expect(input("Temperature low edge at solar midnight").value).toBe("62.7");
  await advance(PREVIEW_DEBOUNCE_MS);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Save band…" }));
  await settle();
  expect(within(sheet()).getAllByRole("listitem").map((item) => text(item))).toEqual([
    "Temperature low edge at sunrise 62.5 → to  64.5 °F", "Temperature low edge at solar midnight 60.7 → to  62.7 °F",
  ]);
  fireEvent.click(within(sheet()).getByRole("button", { name: "Save band" }));
  await settle(10);
  expect(bandWrites(api)[0].body).toEqual({ profile: {}, anchors: { band_temp_low_sr: 64.5, band_temp_low_mid: 62.7 } });
});

test("a viewer sees the band, the preview and the proposal with no control", async () => {
  await open({ fixture: ["review-proposal-waiting", "viewer-session"] }, { role: "viewer", writesEnabled: false }, "/band?proposal=9");
  expect(panel("The band").getAttribute("data-state")).toBe("ready");
  expect(screen.queryByRole("heading", { name: "Set the band" })).toBeNull();
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  expect(within(panel("Proposal from the daily review")).queryByRole("button")).toBeNull();
  expect(within(panel("Drying cost limit")).queryByRole("button", { name: "Save" })).toBeNull();
});

test("with writes off the fields are read-only and nothing can be saved", async () => {
  const api = await open({ fixture: "writes-off" }, { role: "operator", writesEnabled: false });
  expect(screen.getAllByRole("textbox").filter((box) => box.closest(".band-form")).every((box) => (box as HTMLInputElement).disabled)).toBe(true);
  expect((screen.getByRole("button", { name: "Save band…" }) as HTMLButtonElement).disabled).toBe(true);
  expect(bandWrites(api)).toHaveLength(0);
});

test("a failed read of the band takes down only its own blocks", async () => {
  await open({ fail: { "API-23": 503 } });
  expect(panel("The band").getAttribute("data-state")).toBe("error");
  expect(panel("Set the band").getAttribute("data-state")).toBe("error");
  expect(panel("On the controller").getAttribute("data-state")).toBe("ready");
});
