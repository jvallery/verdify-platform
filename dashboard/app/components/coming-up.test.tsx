// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Coming up on Now's Today (dashboard v2 screens §1) against the fixture API in process at 10:42: the next 12 h in time
// order (the scheduled water runs, the lights' windows and the sun) as `[data-coming]` rows, then "Later"; it reads no
// plan (no API-07), each read fails alone and says so, and before the irrigation firmware the runs say when they come.
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { panelRead, useApiRead } from "../lib/queries";
import { advance, renderWithApi, requests, startFixtureApi, stopFixtureApi, type FixtureOptions } from "../lib/test-fixture-api";
import { ComingUp, NOTHING_NEXT, RUNS_BEFORE_ENGINE } from "./coming-up";
import { text } from "./test-render";

afterEach(() => { cleanup(); stopFixtureApi(); });

function Harness() {
  const irrigation = panelRead(useApiRead("API-IRR-01", {}, { intervalMs: 15_000 }));
  return <ComingUp irrigation={irrigation} />;
}
async function open(fixture: FixtureOptions["fixture"], options: Omit<FixtureOptions, "fixture"> = {}) {
  const api = startFixtureApi({ fixture, ...options });
  renderWithApi(<Harness />);
  await advance(0);
  await advance(0);
  return api;
}
const plain = (value: string) => value.replaceAll(String.fromCharCode(0xa0), " ");
const coming = (kind: string) => [...document.querySelectorAll(`#coming-up [data-coming=${kind}]`)].map((node) => plain(text(node)));
const card = () => document.querySelector<HTMLElement>("#coming-up")!;

test("in band: the next 12 h in time order, runs, lights and the sun, and the lines with no run under Later; no plan read", async () => {
  const api = await open("in-band");
  expect(plain(text(card().querySelector("h3")))).toBe("Coming up · next 12 h");
  const times = [...card().querySelectorAll(".now-next-time")].map((node) => node.getAttribute("datetime")!);
  expect(times.length).toBeGreaterThan(0);
  expect([...times].sort()).toEqual(times);
  expect([...coming("run"), ...coming("light"), ...coming("sun")].length).toBe(times.length);
  expect(coming("later").join(" ")).toMatch(/^Later /);
  expect(requests(api, "API-07")).toEqual([]);
  expect(text(card())).not.toMatch(/\b(plan|planned|planner|Iris|waypoint|forecast)\b/i);
});

test("each read fails alone with Retry, never reading nothing scheduled; before the irrigation firmware the runs say when they come", async () => {
  await open("in-band", { fail: { "API-IRR-02": 503 } });
  const failed = card().querySelector(".now-next-failed")!;
  expect(text(failed)).toMatch(/^Couldn't load the schedules\./);
  expect(text(card())).not.toContain(NOTHING_NEXT);
  fireEvent.click(within(failed as HTMLElement).getByRole("button", { name: "Retry" }));
  await advance(0);
  cleanup();
  stopFixtureApi();
  await open("before-engine");
  expect(coming("engine")).toEqual([RUNS_BEFORE_ENGINE]);
  expect(coming("run")).toEqual([]);
});
