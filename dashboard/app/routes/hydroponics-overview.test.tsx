// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Hydroponics → the reservoir now (H-01, H-04): the three readings and the probe's age, in each of the panel's states.
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { text } from "../components/test-render";
import { ReservoirPanel } from "./hydroponics-overview";

const NOW = Date.parse("2026-11-02T17:42:00Z");
const sample = (value: number | null, minutes: number | null) => ({ value, observed_at: minutes === null ? null : new Date(NOW - minutes * 60_000).toISOString(), reason: value === null ? "No reservoir sample in the last 24 h" : null });
const state = vi.hoisted(() => ({ shell: { data: null as unknown, error: null as unknown, pending: false, failures: 0, updatedAt: 0 } }));
vi.mock("../lib/shell", () => ({ useShellNow: () => state.shell }));
vi.mock("../components/freshness", async (importOriginal) => ({ ...(await importOriginal<object>()), useNow: () => NOW }));
afterEach(() => { cleanup(); state.shell = { data: null, error: null, pending: false, failures: 0, updatedAt: 0 }; });

const show = (hydroponics: unknown, error: unknown = null) => {
  state.shell = { data: hydroponics === undefined ? null : { hydroponics }, error, pending: false, failures: 0, updatedAt: NOW };
  render(<MemoryRouter><ReservoirPanel /></MemoryRouter>);
  return screen.getByRole("region", { name: "Reservoir" });
};

test("ready: the three readings and the probe's age", () => {
  const panel = show({ ph: sample(6.4, 3), ec_us_cm: sample(1889, 3), water_temp_f: sample(75.4, 3), stale_after_s: 600 });
  expect(panel.getAttribute("data-state")).toBe("ready");
  expect(text(panel.querySelector(".hydro-probe"))).toMatch(/^Reporting\s?The probe last reported 3.min ago, at \d\d:\d\d; it reports about every 5 minutes\.$/);
  expect([...panel.querySelectorAll(".hydro-now dt")].map(text)).toEqual(["pH", "Conductivity", "Water temperature"]);
  expect(text(panel)).not.toMatch(/[Bb]attery|TDS|ORP/);
});

test("stale: the probe is overdue and its values are muted", () => {
  const panel = show({ ph: sample(6.4, 25), ec_us_cm: sample(1889, 25), water_temp_f: sample(null, null), stale_after_s: 600 });
  expect(panel.getAttribute("data-state")).toBe("stale");
  expect(text(panel.querySelector(".hydro-probe"))).toContain("Overdue");
  expect(text(panel.querySelector("[data-reading=water_temp_f]"))).toContain("No reservoir sample in the last 24 h");
});

test("empty, loading and failed", () => {
  expect(text(show(null))).toContain("No reservoir reading in the last 24 hours.");
  cleanup();
  expect(show(undefined).getAttribute("data-state")).toBe("loading");
  cleanup();
  const failed = show(undefined, new Error("offline"));
  expect(failed.getAttribute("data-state")).toBe("error");
  expect(text(failed)).toContain("Couldn't load the reservoir.");
});
