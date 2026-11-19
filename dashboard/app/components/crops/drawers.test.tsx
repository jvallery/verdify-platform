// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// The planting drawer's v2 additions against #1122's fixture API in process: a note on the planting (API-CROP-12, C-12)
// listed in its history, and the expected harvest in the edit form (API-CROP-11, C-11). A viewer gets neither.
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { text } from "../test-render";
import { OPERATOR, advance, renderWithApi, startFixtureApi, stopFixtureApi, writes } from "../../lib/test-fixture-api";
import { PlantingDrawer, type PlantingMode } from "./drawers";

afterEach(() => { cleanup(); stopFixtureApi(); });

/** Lettuce · Butterhead on rail A in `crops-planted`. */
const LETTUCE = 16;

async function open(mode: PlantingMode | null = null, session = OPERATOR) {
  const api = startFixtureApi({ fixture: "crops-planted" });
  renderWithApi(<PlantingDrawer id={LETTUCE} mode={mode} setMode={() => {}} onClose={() => {}} />, session, `/crops?planting=${LETTUCE}`);
  await advance(10);
  await advance(10);
  return api;
}

test("an operator adds a note: one API-CROP-12 with the text, and the note appears in the planting's history", async () => {
  const api = await open();
  const field = screen.getByRole("textbox", { name: "Add a note" });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(text(document.querySelector(".crop-note"))).toContain("Write the note first");
  expect(writes(api)).toEqual([]);
  fireEvent.change(field, { target: { value: "  New leaves on rail A  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await advance(10);
  await advance(10);
  const sent = writes(api);
  expect(sent.map((row) => row.operationId)).toEqual(["API-CROP-12"]);
  expect(sent[0].path).toMatch(new RegExp(`/crops/plantings/${LETTUCE}/notes$`));
  expect(sent[0].body).toEqual({ note: "New leaves on rail A" });
  expect((field as HTMLTextAreaElement).value).toBe("");
  const history = screen.getByRole("list", { name: "Planting history" });
  expect(within(history).getAllByRole("listitem").map(text).some((line) => /Note · New leaves on rail A/.test(line))).toBe(true);
});

test("a viewer reads the history with no note field and no write button", async () => {
  await open(null, { role: "viewer", writesEnabled: true });
  expect(screen.getByRole("heading", { name: "History" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Add a note" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Save note|Move…|Harvest…|Remove…|Edit…/ })).toBeNull();
});

test("the edit form takes the expected harvest and sends only what changed", async () => {
  const api = await open("edit");
  const harvest = screen.getByLabelText("Expected harvest (optional)");
  expect(harvest.getAttribute("type")).toBe("date");
  fireEvent.change(harvest, { target: { value: "2026-12-15" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await advance(10);
  const sent = writes(api);
  expect(sent.map((row) => row.operationId)).toEqual(["API-CROP-11"]);
  expect(sent[0].body).toEqual({ expected_harvest: "2026-12-15" });
});
