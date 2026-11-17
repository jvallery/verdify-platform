// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Probes on Now (dashboard v2 screens §1 block 9) against the fixture API in process at 10:42: the four wall probes and
// the case probe, each its own temperature and VPD with a 24 h VPD sparkline, each against the one house band the
// controller uses; no zone band (no API-06 zone read) and no stand-in value: a probe out reads "—" with its reason. The
// case probe's VPD is worked out from its temperature and RH and says so.
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { panelRead, useNowRead } from "../lib/queries";
import { advance, renderWithApi, requests, startFixtureApi, stopFixtureApi, type FixtureOptions } from "../lib/test-fixture-api";
import { useCaseRead, useDayRead } from "./now/reads";
import { text } from "./test-render";
import { Probes, caseReading } from "./zone-tiles";

afterEach(() => { cleanup(); stopFixtureApi(); });

function Harness() {
  const now = useNowRead();
  return <Probes now={now.data ?? null} day={panelRead(useDayRead())} caseRead={panelRead(useCaseRead())} />;
}
async function open(options: FixtureOptions = {}) {
  const api = startFixtureApi(options);
  renderWithApi(<Harness />);
  for (let pass = 0; pass < 4; pass++) await advance(10);
  return api;
}
const plain = (value: string) => value.replaceAll(String.fromCharCode(0xa0), " ");
const probe = (id: string) => document.querySelector<HTMLElement>(`[data-probe=${id}]`)!;
const value = (id: string, name: string) => plain(text(probe(id).querySelector(`[data-tile=${name}]`)));
const meta = (id: string) => plain(text(probe(id).querySelector(".now-zone-meta")));

test("five probes, north, east, south, west and the case, each with its temperature and VPD against the one house band; no zone band read", async () => {
  const api = await open({ fixture: "in-band" });
  expect([...document.querySelectorAll("[data-probe]")].map((node) => node.getAttribute("data-probe"))).toEqual(["north", "east", "south", "west", "case"]);
  for (const id of ["north", "east", "south", "west"]) {
    expect(value(id, "temp")).toMatch(/°F$/);
    expect(value(id, "vpd")).toMatch(/kPa$/);
    expect(meta(id)).toMatch(/band 0\.45–0\.8(0)? kPa/);
  }
  expect(within(probe("north")).getByRole("link").getAttribute("href")).toBe("/graphs/zones?zone=north");
  expect(requests(api, "API-06")).toEqual([]);
  expect(text(document.querySelector("#probes"))).not.toMatch(/zone band|crop band|target/i);
});

test("south's probe out reads — with its reason, never a neighbour's value or 0", async () => {
  await open({ fixture: "south-probe-out" });
  expect(value("south", "vpd")).toBe("—");
  expect(meta("south")).toMatch(/·/);
  expect(probe("south").querySelector("[data-zone-tag]")).toBeNull();
});

test("the case probe: its VPD worked out from its temperature and RH, said so; without its keys it reads not reported", async () => {
  await open({ fixture: "in-band" });
  expect(probe("case").querySelector("[data-probe-tag=derived]")).not.toBeNull();
  const series = {
    from: "2026-11-02T16:30:00Z", to: "2026-11-02T17:45:00Z", server_time: "2026-11-02T17:42:00Z", bucket_s: 900,
    t: [Date.parse("2026-11-02T17:30:00Z") / 1000], series: { "climate.temp_case": { avg: [77], min: [77], max: [77] }, "climate.rh_case": { avg: [50], min: [50], max: [50] } },
  } as unknown as Parameters<typeof caseReading>[0];
  const reading = caseReading(series, 0);
  expect(reading.temp).toEqual({ value: 77, stale: false, reason: null });
  expect(reading.vpd.value).toBeCloseTo(1.58, 2);
  expect(caseReading(null, 0).vpd).toEqual({ value: null, stale: false, reason: "not reported" });
});

test("a failed read says so with Retry, and Retry reads again", async () => {
  const api = await open({ fixture: "in-band", fail: { "API-03": 503 } });
  const panel = document.querySelector<HTMLElement>("#probes")!;
  expect(text(panel.querySelector(".panel-error"))).toMatch(/^Couldn't load the probes\./);
  const before = requests(api, "API-03").length;
  fireEvent.click(within(panel).getByRole("button", { name: "Retry" }));
  await advance(10);
  expect(requests(api, "API-03").length).toBeGreaterThan(before);
});
