// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Run by hand (dashboard v2 screens §1 block 5) in the shell against the fixture API in process: each run's one
// API-IRR-12 with no dialog, what runs from API-02 `overrides` alone with its time left and Stop, the protection-limit
// line, the 15-minute fan cap with no temperature reading, the words before the irrigation firmware, viewers and changes
// off; and Restart controller, exported for the Controller page. The clock is 10:42 America/Denver on 2026-11-02.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { NOW, advance, requests, startFixtureApi, stopFixtureApi, writes, type FixtureOptions } from "../lib/test-fixture-api";
import { AppShell } from "./app-shell";
import { FAN_CAP_TEXT, RUNS_ARRIVE_TEXT, RUNS_UNKNOWN, RestartController, RunByHand, limitText, noTemperature, runWords } from "./run-by-hand";
import { text } from "./test-render";

afterEach(() => { cleanup(); stopFixtureApi(); vi.unstubAllGlobals(); });

function Page() {
  return <><RunByHand /><RestartController /></>;
}
async function open(options: FixtureOptions = {}) {
  const api = startFixtureApi(options);
  const Stub = createRoutesStub([{ path: "/", Component: () => <AppShell build="fedcba9876543210fedcba9876543210fedcba98" authError={null} />, children: [{ path: "equipment", Component: Page }] }]);
  render(<Stub initialEntries={["/equipment"]} />);
  await advance(0);
  return api;
}
const readBack = async (ms: number) => { await advance(ms); await advance(1); };
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const left = () => [...document.querySelectorAll("#run-by-hand [data-run-left]")].map((node) => text(node));
const panelButtons = () => [...document.querySelectorAll<HTMLButtonElement>("#run-by-hand [data-write-control]")];
const iso = (ms: number) => new Date(ms).toISOString();
const run = (fields: Partial<Parameters<typeof runWords>[0]>) => ({ kind: "fans" as const, since: iso(NOW - 60_000), ends_at: null, held_reason: null, ...fields });
const plain = (value: string) => value.replaceAll(" ", " ");

test("a running run in words: its time left, the name alone with no end, and why the controller holds it off", () => {
  expect(plain(runWords(run({ ends_at: iso(NOW + 12 * 60_000) }), NOW))).toBe("Run the fans · 12 min left");
  expect(runWords(run({}), NOW)).toBe("Run the fans");
  expect(runWords(run({ ends_at: iso(NOW - 60_000) }), NOW)).toBe("Run the fans");
  expect(plain(runWords(run({ kind: "vent_bypass", ends_at: iso(NOW + 600_000) }), NOW))).toBe("Circulate · 10 min left");
  expect(runWords(run({ kind: "humidify", held_reason: "occupancy" }), NOW)).toBe("Humidify held off: someone inside");
  expect(runWords(run({ kind: "humidify", held_reason: "new_reason" }), NOW)).toBe("Humidify held off: new_reason");
});

test("the protection limits from the law's timing, and the fan cap only without a temperature reading", () => {
  expect(plain(limitText(null))).toBe("The hot limit (100 °F) and the cold limit (40 °F) end any run by hand.");
  expect(plain(limitText({ hot_limit_f: 98, cold_limit_f: 42 }))).toBe("The hot limit (98 °F) and the cold limit (42 °F) end any run by hand.");
  const reading = { value: 64.8, observed_at: iso(NOW), reason: null };
  const now = { law: null, indoor: { temp_f: reading, rh_pct: reading, vpd_kpa: reading } };
  expect(noTemperature(now, null)).toBe(false);
  expect(noTemperature(now, "no_temperature")).toBe(true);
  expect(noTemperature({ ...now, indoor: { ...now.indoor, temp_f: { value: null, observed_at: null, reason: "No reading" } } }, null)).toBe(true);
  expect(noTemperature(null, null)).toBe(false);
});

test("Run the fans: one {kind, minutes} with no dialog; the time left and Stop show once the controller reads it back", async () => {
  const api = await open({ fixture: "burst-readback-late" });
  expect(text(document.querySelector("[data-runs=none]"))).toBe("Nothing is running by hand.");
  expect(panelButtons().map((node) => text(node))).toEqual(["Run the fans, 15 min", "Humidify, 5 min", "Circulate, 10 min"]);
  press(/^Run the fans/);
  expect(document.querySelector("dialog")).toBeNull();
  await advance(0);
  expect(writes(api)).toEqual([expect.objectContaining({ method: "POST", operationId: "API-IRR-12", body: { kind: "fans", minutes: 15 } })]);
  expect(text(document.querySelector("[data-run=fans] .state-note"))).toBe("Waiting for the controller");
  await readBack(5000);
  expect(left()).toEqual([]);
  await readBack(4999);
  expect(left().map(plain)).toEqual(["Run the fans · 15 min left"]);
  expect(button("Stop: Run the fans")).not.toBeNull();
  expect(writes(api)).toHaveLength(1);
});

test("Stop sends one {kind: clear} and its readback reads nothing running", async () => {
  const api = await open({ fixture: "push-button-burst" });
  expect(left()).toEqual(["Run the fans"]);
  press("Stop: Run the fans");
  await advance(0);
  expect(writes(api)).toEqual([expect.objectContaining({ operationId: "API-IRR-12", body: { kind: "clear" } })]);
  await readBack(5000);
  expect(left()).toEqual([]);
  expect(text(document.querySelector("[data-runs=none]"))).toBe("Nothing is running by hand.");
});

test("the protection-limit line always; the fan cap only with no temperature reading", async () => {
  await open();
  expect(plain(text(document.querySelector("[data-runs=limits]")))).toBe("The hot limit (100 °F) and the cold limit (40 °F) end any run by hand. When a run ends the controller goes back to the law.");
  expect(document.querySelector("[data-runs=no-temperature]")).toBeNull();
  cleanup(); stopFixtureApi();
  // The law refuses drying for want of a temperature reading: a fan run is capped, from the next API-02 on.
  await open();
  const fetcher = globalThis.fetch as (input: string, init?: RequestInit) => Promise<Response>;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const answer = await fetcher(input, init);
    if (input !== "/api/v1/now") return answer;
    const body = await answer.json() as { law: Record<string, unknown> };
    body.law = { ...body.law, drying: "not_wanted", drying_refused_reason: "no_temperature" };
    return { ...answer, headers: answer.headers, json: async () => body } as unknown as Response;
  }));
  await readBack(15_000);
  expect(text(document.querySelector("[data-runs=no-temperature]"))).toBe(FAN_CAP_TEXT);
});

test("while the controller is not reporting what runs reads unknown, never none, and Stop stays", async () => {
  await open({ fixture: "controller-not-reporting" });
  expect(text(document.querySelector("[data-runs=unknown]"))).toBe(RUNS_UNKNOWN);
  expect(document.querySelector("[data-runs=none]")).toBeNull();
  expect(button("Stop every run by hand")).not.toBeNull();
});

test("before the irrigation firmware: the words that runs arrive with it, no button, and what runs still shows", async () => {
  await open({ fixture: ["push-button-burst", "before-engine"] });
  expect(text(document.querySelector("[data-arrives=runs]"))).toBe(RUNS_ARRIVE_TEXT);
  expect(panelButtons()).toHaveLength(0);
  expect(left()).toEqual(["Run the fans"]);
});

test("a viewer reads what runs with no control; with changes off every control is disabled and nothing is sent", async () => {
  await open({ fixture: ["push-button-burst", "viewer-session"] });
  expect(left()).toEqual(["Run the fans"]);
  expect(document.querySelectorAll("#run-by-hand button")).toHaveLength(0);
  expect(document.querySelectorAll("[data-write-control]")).toHaveLength(0);
  cleanup(); stopFixtureApi();
  // Stop stays live with changes switched off, as Stop all water does; starting a run does not.
  const api = await open({ fixture: ["writes-off", "push-button-burst"] });
  expect(panelButtons().map((control) => [text(control), control.disabled])).toEqual([["Stop: Run the fans", false], ["Humidify, 5 min", true], ["Circulate, 10 min", true]]);
  expect(writes(api)).toEqual([]);
});

test("a failed engine read says so with Retry, offers no run, and what runs still shows", async () => {
  const api = await open({ fixture: "push-button-burst", fail: { "API-IRR-01": 503 } });
  expect(panelButtons()).toHaveLength(0);
  expect(text(document.querySelector("#run-by-hand .panel-error .fault"))).toBe("Can't tell whether the controller has the irrigation firmware yet.");
  expect(left()).toEqual(["Run the fans"]);
  const reads = requests(api, "API-IRR-01").length;
  press("Retry");
  await advance(0);
  expect(requests(api, "API-IRR-01")).toHaveLength(reads + 1);
});

test("Restart controller: one {kind: restart} with no dialog, Restart sent until the uptime drops", async () => {
  const api = await open({ fixture: "restart-uptime-reset" });
  const restart = () => document.querySelector<HTMLButtonElement>(".run-restart [data-write-control]")!;
  expect(restart().textContent).toBe("Restart controller");
  fireEvent.click(restart());
  expect(document.querySelector("dialog")).toBeNull();
  await advance(0);
  expect(writes(api)).toEqual([expect.objectContaining({ operationId: "API-IRR-12", body: { kind: "restart" } })]);
  expect([restart().textContent, restart().disabled]).toEqual(["Restart sent", true]);
  await readBack(5000);
  await readBack(10_000);
  expect([restart().textContent, restart().disabled]).toEqual(["Restart controller", false]);
  expect(text(document.querySelector(".run-restart .state-note"))).toBe("The controller restarted");
});
