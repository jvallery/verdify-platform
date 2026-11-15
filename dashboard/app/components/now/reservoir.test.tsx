// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { ReservoirReadings } from "./reservoir";

const state = vi.hoisted(() => ({
  now: Date.parse("2026-11-02T17:42:00Z"),
  shell: { error: null as Error | null, data: { hydroponics: {
    stale_after_s: 600,
    ph: { value: 6.4, observed_at: "2026-11-02T17:39:00Z", reason: null as string | null },
    ec_us_cm: { value: 1889, observed_at: "2026-11-02T17:20:00Z", reason: null as string | null },
    water_temp_f: { value: null, observed_at: null, reason: "No reservoir sample in the last 24 h" },
  } } },
}));
vi.mock("../../lib/shell", () => ({ useShellNow: () => state.shell }));
vi.mock("../freshness", () => ({ useNow: () => state.now, AgeLabel: ({ stale }: { stale: boolean }) => <span>{stale ? "Last data" : "Updated"}</span> }));
afterEach(() => { cleanup(); state.shell.error = null; });

test("each reservoir channel keeps its own age and missing reason", () => {
  render(<MemoryRouter><ReservoirReadings /></MemoryRouter>);
  const rows = [...document.querySelectorAll(".hydro-readings > div")];
  expect(rows).toHaveLength(3);
  expect(rows[0].getAttribute("data-stale")).toBe("false");
  expect(rows[0].textContent).toContain("6.4");
  expect(rows[1].getAttribute("data-stale")).toBe("true");
  expect(rows[1].textContent).toContain("sample overdue");
  expect(rows[2].textContent).toContain("No reservoir sample in the last 24 h");
});

test("a failed shared poll never presents cached reservoir values as current", () => {
  state.shell.error = new Error("offline");
  render(<MemoryRouter><ReservoirReadings /></MemoryRouter>);
  expect(screen.getAllByText("Reservoir read unavailable")).toHaveLength(3);
  expect(document.querySelector(".hydro-readings")?.textContent).not.toContain("6.4");
});
