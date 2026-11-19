// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// The lights on Now (#1342), under Run by hand: Main light and Grow light with their state in words and Lights' own
// buttons (API-20); they do not wait for the irrigation firmware; with changes off they are disabled; a viewer has none.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { advance, renderWithApi, startFixtureApi, stopFixtureApi, writes } from "../../lib/test-fixture-api";
import { manualUntil } from "../equipment/light-controls";
import { text } from "../test-render";
import { NowLights, lightStateWords } from "./lights";

afterEach(() => { cleanup(); stopFixtureApi(); });
const lightButtons = () => [...document.querySelectorAll(".now-lights button:not(.term)")].map((button) => text(button));

test("Main light and Grow light, each its state in words and its buttons; a Turn on is one API-20 with no dialog", async () => {
  const api = startFixtureApi({ fixture: "in-band" });
  renderWithApi(<NowLights />);
  await advance(0);
  const group = screen.getByRole("group", { name: "Lights" });
  expect([...group.querySelectorAll(".now-light-head")].map(text)).toEqual(["Main light off · Automatic", "Grow light off · Automatic"]);
  expect(lightButtons()).toEqual(["Turn on 15 min Main light", "Turn on 15 min Grow light"]);
  expect(group.querySelector("a[href='/lights']")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Turn on 15 min Main light" }));
  await advance(0);
  expect(writes(api)).toEqual([expect.objectContaining({ method: "POST", operationId: "API-20", path: "/api/v1/equipment/lights/main/on", body: null })]);
  expect(document.querySelector("dialog")).toBeNull();
});

test("the lights do not wait for the irrigation firmware; with changes off they are disabled; a viewer has none", async () => {
  startFixtureApi({ fixture: "before-engine" });
  renderWithApi(<NowLights />);
  await advance(0);
  expect(lightButtons()).toEqual(["Turn on 15 min Main light", "Turn on 15 min Grow light"]);
  cleanup();
  stopFixtureApi();
  startFixtureApi({ fixture: ["in-band", "writes-off"] });
  renderWithApi(<NowLights />, { role: "operator", writesEnabled: false });
  await advance(0);
  for (const button of document.querySelectorAll(".now-lights button:not(.term)")) expect(button.hasAttribute("disabled")).toBe(true);
  cleanup();
  stopFixtureApi();
  startFixtureApi({ fixture: ["in-band", "viewer-session"] });
  renderWithApi(<NowLights />, { role: "viewer", writesEnabled: false });
  await advance(0);
  expect(document.querySelector(".now-lights")).toBeNull();
});

test("a Turn on still running reads its end instead of Automatic; once Lutron and the intent agree, or with no timer, the switch reads as before (#1377)", () => {
  const automatic = { readback: { value: 1 } } as never;
  const until = "2026-11-02T17:55:00Z"; // 10:55 in Longmont
  const on = { state: "on", intent: "off", manual_until: until };
  expect(manualUntil(on)).toBe(until);
  expect(lightStateWords(on, automatic).replaceAll(" ", " ")).toBe("on · by hand until 10:55 · the controller wants it off");
  expect(lightStateWords({ ...on, intent: "on" }, automatic)).toBe("on · Automatic");
  expect(lightStateWords({ state: "off", intent: "off", manual_until: null }, automatic)).toBe("off · Automatic");
});
