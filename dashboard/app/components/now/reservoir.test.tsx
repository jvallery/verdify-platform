// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { ReservoirReadings, reservoirSample } from "./reservoir";

const state = vi.hoisted(() => ({
  now: Date.parse("2026-11-02T17:42:00Z"),
  shell: { error: null as Error | null, data: { hydroponics: {
    stale_after_s: 600,
    ph: { value: 6.4, observed_at: "2026-11-02T17:39:00Z", reason: null as string | null },
    ec_us_cm: { value: 1032.4, observed_at: "2026-11-02T17:20:00Z", reason: null as string | null },
    water_temp_f: { value: null as number | null, observed_at: null as string | null, reason: "No reservoir sample in the last 24 h" as string | null },
  } } as { hydroponics: unknown } | null },
}));
vi.mock("../../lib/shell", () => ({ useShellNow: () => state.shell }));
vi.mock("../freshness", () => ({ useNow: () => state.now, AgeLabel: ({ stale }: { stale: boolean }) => <span>{stale ? "Last data" : "Updated"}</span> }));
afterEach(cleanup);

const hydro = (fields: Record<string, unknown> = {}) => ({
  stale_after_s: 600,
  ph: { value: 6.4, observed_at: "2026-11-02T17:39:00Z", reason: null },
  ec_us_cm: { value: 1032.4, observed_at: "2026-11-02T17:38:00Z", reason: null },
  water_temp_f: { value: 75, observed_at: "2026-11-02T17:39:00Z", reason: null },
  ...fields,
});

test("three tiles, conductivity without decimals and its unit in the label, a missing channel with its reason (B11)", () => {
  render(<MemoryRouter><ReservoirReadings /></MemoryRouter>);
  const tiles = [...document.querySelectorAll(".now-reservoir > div")];
  expect(tiles).toHaveLength(3);
  expect(tiles[0].textContent).toBe("pH6.4");
  expect(tiles[1].textContent).toBe("Conductivity, µS/cm1,032");
  expect(tiles[2].textContent).toContain("—");
  expect(tiles[2].textContent).toContain("No reservoir sample in the last 24 h");
  expect(screen.getByRole("link", { name: /Hydroponics/ }).getAttribute("href")).toBe("/hydroponics");
});

test("one observation line for the three tiles, from the oldest sample, overdue past stale_after_s (A2)", () => {
  render(<MemoryRouter><ReservoirReadings /></MemoryRouter>);
  const line = document.querySelector("[data-reservoir=sample]");
  // The conductivity sample is 22 min old against a 10 min limit.
  expect(line?.textContent).toBe("Last data · sample overdue");
  expect(document.querySelectorAll(".now-reservoir .age")).toHaveLength(0);
  expect(document.querySelector("[data-reservoir=ec_us_cm]")?.getAttribute("data-stale")).toBe("true");
});

test("reservoirSample: the oldest sample with a value, and whether it is overdue", () => {
  const clock = Date.parse("2026-11-02T17:42:00Z");
  expect(reservoirSample(hydro() as never, clock)).toEqual({ at: "2026-11-02T17:38:00Z", stale: false });
  expect(reservoirSample(hydro({ ec_us_cm: { value: null, observed_at: "2026-11-02T10:00:00Z", reason: null } }) as never, clock)).toEqual({ at: "2026-11-02T17:39:00Z", stale: false });
  expect(reservoirSample(hydro({ ph: { value: 6.4, observed_at: "2026-11-02T17:00:00Z", reason: null } }) as never, clock)?.stale).toBe(true);
  expect(reservoirSample(null, clock)).toBeNull();
});

test("a failed shared poll never presents cached reservoir values as current", () => {
  state.shell = { error: new Error("offline"), data: state.shell?.data ?? null } as never;
  render(<MemoryRouter><ReservoirReadings /></MemoryRouter>);
  expect(screen.getByText(/Reservoir read unavailable/)).toBeTruthy();
  expect(document.body.textContent).not.toContain("6.4");
});
