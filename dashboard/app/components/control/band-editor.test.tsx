// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// The band editor (screens 2.2 blocks 3 and 4) against the fixture API in process: the fields start from the band as
// stored (the live band has sunrise and sunset apart on both axes, so both open as their eight anchors), an edit previews
// through API-23 with exactly what Save sends, the stored value shows under a changed field, a field that does not read
// and an edge the band check refuses each say why beside their field with Save off, the confirm sheet lists every
// anchor the write changes, and a viewer and writes off get no working control.
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, MockPlot, media, setTokens } from "../../charts/fixtures/uplot-mock";
import { OPERATOR, advance, renderWithApi, requests, startFixtureApi, stopFixtureApi, type FixtureApi, type FixtureOptions } from "../../lib/test-fixture-api";
import type { Session } from "../../lib/session";
import { PREVIEW_DEBOUNCE_MS } from "../band-preview";
import { text } from "../test-render";
import { BandConfirm, BandEditorPanel, ChangeItem, fieldRows, inputName, limitsText, useBandEditor, type Pending } from "./band-editor";
import { renderUi } from "../test-render";

vi.mock("uplot", async () => ({ default: (await import("../../charts/fixtures/uplot-mock")).MockPlot }));

function Editor() {
  const editor = useBandEditor();
  return <BandEditorPanel editor={editor} />;
}
async function settle() {
  for (let pass = 0; pass < 6; pass++) {
    await advance(10);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
}
async function mount(options: FixtureOptions = {}, session: Partial<Session> = OPERATOR) {
  const api = startFixtureApi(options);
  renderWithApi(<Editor />, session, "/band");
  await settle();
  return api;
}
const input = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: "Save band…" }) as HTMLButtonElement;
const status = () => text(document.querySelector(".band-save [role=status]"));
async function type(name: string, value: string) {
  fireEvent.change(input(name), { target: { value } });
  await advance(PREVIEW_DEBOUNCE_MS);
  await settle();
}
const previews = (api: FixtureApi) => requests(api, "API-23").map((row) => decodeURIComponent(new URL(row.path, "http://x").searchParams.toString()));

beforeEach(() => {
  MockPlot.reset();
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
});
afterEach(() => { cleanup(); stopFixtureApi(); document.documentElement.removeAttribute("style"); });

test("fieldRows: two times as edges, four times as anchors; each input named in full", () => {
  expect(fieldRows("temp", false).map((row) => [row.words, row.inputs.low, row.inputs.high])).toEqual([["By day", "temp_low_day", "temp_high_day"], ["At night", "temp_low_night", "temp_high_night"]]);
  expect(fieldRows("vpd", true).map((row) => row.inputs.high)).toEqual(["band_vpd_high_sr", "band_vpd_high_sm", "band_vpd_high_ss", "band_vpd_high_mid"]);
  expect(inputName("temp_low_day")).toBe("Temperature low edge by day");
  expect(inputName("band_vpd_high_ss")).toBe("VPD high edge at sunset");
});

test("limitsText states the narrowest band and the outer limits, and the drying line at night", () => {
  const guardrails = { temp_min_f: 40, temp_max_f: 100, margin_f: 5, vpd_min_kpa: 0.3, vpd_max_kpa: 3, night_vpd_floor_kpa: 0.74, min_width_f: 6.5, min_width_kpa: 0.35, dry_on_above_vpd_low_kpa: 0.05 };
  const nb = (value: string) => value.replaceAll(" ", " ");
  expect(nb(limitsText("temp", guardrails))).toBe("At least 6.5 °F wide at every hour of the day; at least 5.0 °F inside the 40.0 °F and 100.0 °F protection limits.");
  expect(nb(limitsText("vpd", guardrails))).toBe("At least 0.35 kPa wide at every hour; between 0.30 kPa and 3.00 kPa; at night the drying line (the low edge plus 0.05 kPa) stays at or above 0.74 kPa.");
  expect(nb(limitsText("vpd", { ...guardrails, min_width_kpa: null, dry_on_above_vpd_low_kpa: null }))).toBe("Between 0.30 kPa and 3.00 kPa; the low edge stays at or above 0.74 kPa all night.");
});

test("the fields start from the band as stored, both axes split, with Save off until there is a change", async () => {
  const api = await mount();
  const panel = screen.getByRole("heading", { name: "Set the band" }).closest("section") as HTMLElement;
  expect(panel.getAttribute("data-state")).toBe("ready");
  expect(input("Temperature low edge at sunrise").value).toBe("62.5");
  expect(input("VPD low edge at solar noon").value).toBe("0.862");
  expect(screen.getAllByRole("checkbox", { name: "Set sunrise and sunset separately" }).map((box) => (box as HTMLInputElement).checked)).toEqual([true, true]);
  expect(saveButton().disabled).toBe(true);
  expect(status()).toBe("No change yet. Only the owner saves the band.");
  // Only the band as stored was read: nothing previews before an edit.
  expect(previews(api)).toEqual([""]);
});

test("an anchor edit previews exactly what Save would send, shows the stored value under the field and counts the change", async () => {
  const api = await mount();
  await type("Temperature low edge at sunrise", "63");
  expect(previews(api).at(-1)).toBe("anchor=band_temp_low_sr:63");
  const cell = input("Temperature low edge at sunrise").closest(".band-cell") as HTMLElement;
  expect(cell.hasAttribute("data-changed")).toBe(true);
  expect(text(cell)).toContain("Stored 62.5 °F");
  expect(status()).toBe("Save writes 1 edge in one change. Only the owner saves the band.");
  expect(saveButton().disabled).toBe(false);
});

test("an axis switched from split to edges sends its four edges, and the preview lists sunrise and sunset moving halfway", async () => {
  const api = await mount();
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Set sunrise and sunset separately" })[0]);
  await advance(PREVIEW_DEBOUNCE_MS);
  await settle();
  expect(input("Temperature low edge by day").value).toBe("71.8");
  expect(previews(api).at(-1)).toBe("temp_low_day=71.8&temp_high_day=85.8&temp_low_night=60.7&temp_high_night=70.7");
  // Sunrise and sunset of the low and the high edge move; noon and midnight stay.
  expect(status()).toMatch(/^Save writes 4 edges/);
});

test("a field that does not read as a number says so beside it, and Save stays off", async () => {
  await mount();
  await type("VPD high edge at sunset", "dry");
  const cell = input("VPD high edge at sunset").closest(".band-cell") as HTMLElement;
  expect(text(cell)).toContain("Enter a number");
  expect(input("VPD high edge at sunset").getAttribute("aria-invalid")).toBe("true");
  expect(saveButton().disabled).toBe(true);
  expect(status()).toMatch(/^Enter a number in every field you changed\./);
});

test("an edge the band check refuses shows the API's reason beside that edge, and Save stays off", async () => {
  await mount();
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Set sunrise and sunset separately" })[1]);
  await type("VPD low edge at night", "0.6");
  const cell = input("VPD low edge at night").closest(".band-cell") as HTMLElement;
  expect(text(cell)).toMatch(/that drying line stays at least 0\.74 kPa all night/);
  expect(saveButton().disabled).toBe(true);
  expect(status()).toMatch(/^Fix the marked edge to save\./);
});

test("Save opens the confirm sheet with each changed edge old to new; Cancel sends nothing", async () => {
  const api = await mount();
  await type("Temperature low edge at solar midnight", "62.7");
  fireEvent.click(saveButton());
  await settle();
  const sheet = document.querySelector("dialog.band-confirm") as HTMLDialogElement;
  expect(sheet.hasAttribute("open")).toBe(true);
  expect(within(sheet).getByRole("heading", { name: "Save the band?" })).toBeTruthy();
  expect(within(sheet).getAllByRole("listitem").map((item) => text(item))).toEqual(["Temperature low edge at solar midnight 60.7 → to  62.7 °F"]);
  fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
  await settle();
  expect(requests(api, "API-24")).toHaveLength(0);
});

test("the confirm sheet lists stored rows the law does not read on a line of their own", () => {
  const pending: Pending = {
    sent: { edges: {}, anchors: { band_temp_low_sr: 64.5, band_temp_target_mid: 66.7 } }, reason: "",
    edges: [{ param: "band_temp_low_sr", words: "Temperature low edge at sunrise", unit: "°F", before: 62.5, after: 64.5 }],
    targets: [{ param: "band_temp_target_mid", words: "Temperature middle line at solar midnight", unit: "°F", before: 65.7, after: 66.7 }],
  };
  renderUi(<BandConfirm pending={pending} onCancel={() => {}} onSave={() => {}} sending={false} error={null} />, OPERATOR);
  const sheet = document.querySelector("dialog.band-confirm") as HTMLElement;
  expect(text(sheet)).toContain("Changes 1 edge in one change:");
  expect(text(sheet)).toContain("Also changes 1 stored row the law does not read:");
  expect(text(sheet)).toContain("No reason given.");
  expect([...sheet.querySelectorAll(".band-changes-quiet li")].map((item) => text(item))).toEqual(["Temperature middle line at solar midnight 65.7 → to  66.7 °F"]);
});

test("ChangeItem reads old to new with the unit once, and a missing old value as a dash", () => {
  renderUi(<ul><ChangeItem line={{ param: "band_vpd_high_sm", words: "VPD high edge at solar noon", unit: "kPa", before: null, after: 1.39 }} /></ul>);
  expect(text(screen.getByRole("listitem"))).toBe("VPD high edge at solar noon — → to  1.39 kPa");
});

test("a viewer gets no editor at all", async () => {
  await mount({}, { role: "viewer", writesEnabled: false });
  expect(screen.queryByRole("heading", { name: "Set the band" })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("with writes off every field is read-only and the status says why", async () => {
  await mount({}, { role: "operator", writesEnabled: false });
  expect(input("Temperature low edge at sunrise").disabled).toBe(true);
  expect(saveButton().disabled).toBe(true);
  expect(status()).toBe("Changes are switched off, so the band cannot be saved now.");
});

test("a failed read of the band is the panel's error state with Retry", async () => {
  await mount({ fail: { "API-23": 503 } });
  const panel = screen.getByRole("heading", { name: "Set the band" }).closest("section") as HTMLElement;
  expect(panel.getAttribute("data-state")).toBe("error");
  expect(within(panel).getByRole("button", { name: /Retry/ })).toBeTruthy();
});
