// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// The drying cost limit (screens §2.3 block 2) against #1122's fixture API at 10:42 on Monday 2026-11-02: the limit in
// force and its source, Save through API-10 with its readback, and a viewer with no control.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { text } from "../test-render";
import { OPERATOR, advance, renderWithApi, startFixtureApi, stopFixtureApi, writes } from "../../lib/test-fixture-api";
import { DRYING_LIMIT_PARAM, DryingLimit, limitInForceWords, limitPanelState, startingText } from "./drying-limit";

afterEach(() => { cleanup(); stopFixtureApi(); });

async function mount(variant: "drying" | "band" = "drying", session = OPERATOR, fixture: string | string[] = "in-band") {
  const api = startFixtureApi({ fixture });
  renderWithApi(<DryingLimit variant={variant} />, session);
  await advance(0);
  return api;
}
const panel = () => screen.getByRole("heading", { name: "Drying cost limit" }).closest("section") ?? document.body;

test("the words: the limit in force with its source, the field's starting value, and the panel's state", () => {
  expect(limitInForceWords({ limit_kwh_per_kg: 0.7, limit_source: "default" }).replaceAll(String.fromCharCode(0xa0), " ")).toMatch(/^0\.70 kWh\/kg, /);
  expect(limitInForceWords({ limit_kwh_per_kg: null, limit_source: "default" })).toBe("Not reported");
  expect(startingText({ desired: null, readback: null }, { limit_kwh_per_kg: 0.7 })).toBe("0.70");
  expect(startingText(null, null)).toBe("");
  expect(limitPanelState({ pending: true, data: null, failed: false })).toBe("loading");
  expect(limitPanelState({ pending: false, data: null, failed: true })).toBe("error");
});

test("an operator sees the limit in force and its source, the stepper on the registry's range, and Save writes API-10 with its readback", async () => {
  const api = await mount();
  expect(text(panel())).toContain("0.70 kWh/kg");
  expect(text(panel())).toContain("in force on the controller");
  expect(text(panel())).toContain("Raise it:");
  const field = screen.getByRole("textbox", { name: "New limit" }) as HTMLInputElement;
  expect(field.value).toBe("0.70");
  expect(text(panel())).toContain("Only the owner sets the limit");
  fireEvent.click(screen.getByRole("button", { name: "Increase by 0.05" }));
  expect(field.value).toBe("0.75");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await advance(0);
  expect(writes(api).map((row) => [row.method, row.path, row.body])).toEqual([["PUT", `/api/v1/settings/${DRYING_LIMIT_PARAM}`, { value: 0.75, manual: true }]]);
  await advance(5_000);
  // The registry row now holds the write: its readback badge and the value sent.
  expect(text(panel())).toMatch(/Sent 0\.75 kWh\/kg at/);
});

test("a viewer sees the limit and its source and no control", async () => {
  await mount("drying", { role: "viewer", writesEnabled: true });
  expect(text(panel())).toContain("0.70 kWh/kg");
  expect(screen.queryByRole("textbox", { name: "New limit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

test("on the Band page it adds the price now and a link to Drying", async () => {
  await mount("band");
  expect(text(panel())).toMatch(/The controller would pay 0\.63 kWh\/kg to dry the air now\./);
  expect(screen.getByRole("link", { name: /Drying/ }).getAttribute("href")).toBe("/climate/drying");
  expect(text(panel())).not.toContain("Raise it:");
});
