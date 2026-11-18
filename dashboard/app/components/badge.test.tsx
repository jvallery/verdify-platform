// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
import { cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { BADGES, BADGE_STATUSES, Badge, ChemistryBadge, EquipmentStateBadge, ReadbackBadge, StatusBadge, badgeClass, lineChemistry, type BadgeKind } from "./badge";
import { renderUi, text } from "./test-render";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const badgeIn = (container: HTMLElement) => container.querySelector("[data-badge]");

test("every badge of design system v2 §4 carries its word, its status class and a dot", () => {
  const expected: Record<string, [string, string]> = {
    requested: ["Requested", "badge badge-warn"], confirmed: ["Confirmed", "badge badge-ok"],
    not_confirmed: ["Not confirmed", "badge badge-serious"], no_readback: ["No readback", "badge badge-neutral"],
    manual: ["Set by hand", "badge badge-info"], ai: ["AI", "badge badge-neutral"],
    superseded: ["Superseded", "badge badge-neutral"], stale: ["Stale", "badge badge-warn"], clean: ["Clean", "badge badge-neutral badge-clean"],
    fert: ["Fert", "badge badge-neutral badge-fert"], running: ["Running", "badge badge-ok"], idle: ["Idle", "badge badge-neutral"],
    disabled: ["Disabled", "badge badge-neutral"], on: ["On", "badge badge-ok"], off: ["Off", "badge badge-neutral"], unknown: ["Not reported", "badge badge-neutral"],
  };
  expect(Object.keys(BADGES).sort()).toEqual(Object.keys(expected).sort());
  for (const [kind, [word, className]] of Object.entries(expected)) {
    const badge = badgeIn(renderUi(<Badge kind={kind as BadgeKind} />).container)!;
    expect(badge.textContent, kind).toBe(word);
    expect(badge.className, kind).toBe(className);
    expect(badge.getAttribute("data-status"), kind).toBe(className.split(" ")[1].slice("badge-".length));
    expect(badge.querySelector(".badge-dot")?.getAttribute("aria-hidden"), kind).toBe("true");
    cleanup();
  }
});

test("a small badge, and a status badge around any words", () => {
  expect(badgeIn(renderUi(<Badge kind="stale" size="sm" />).container)?.className).toBe("badge badge-warn badge-sm");
  cleanup();
  const { container } = renderUi(<StatusBadge status="critical">Writer down</StatusBadge>);
  const badge = container.querySelector(".badge")!;
  expect(badge.className).toBe("badge badge-critical");
  expect(text(badge)).toBe("Writer down");
  expect(badgeClass("info", "sm", "extra")).toBe("badge badge-info badge-sm extra");
  expect(BADGE_STATUSES).toEqual(["ok", "warn", "serious", "critical", "info", "neutral"]);
});

test("ReadbackState renders its badge; NO READBACK also when readback_via is none; released has none; an unknown state shows raw", () => {
  for (const [state, kind] of [["requested", "requested"], ["confirmed", "confirmed"], ["not_confirmed", "not_confirmed"], ["no_readback", "no_readback"]]) {
    expect(badgeIn(renderUi(<ReadbackBadge state={state} />).container)?.getAttribute("data-badge"), state).toBe(kind);
    cleanup();
  }
  expect(badgeIn(renderUi(<ReadbackBadge state="requested" readbackVia="none" />).container)?.getAttribute("data-badge")).toBe("no_readback");
  cleanup();
  // Released still has no badge.
  expect(renderUi(<ReadbackBadge state="released" readbackVia="none" />).container.textContent).toBe("");
  cleanup();
  expect(renderUi(<ReadbackBadge state="released" />).container.textContent).toBe("");
  cleanup();
  expect(text(renderUi(<ReadbackBadge state="pending_review" />).container)).toBe("pending_review");
});

test("CLEAN and FERT", () => {
  expect(["drip", "mister", "fog", "fert_drip", "fert_mister", "master", "pump"].map(lineChemistry)).toEqual(["clean", "clean", "clean", "fert", "fert", "fert", null]);
  expect(badgeIn(renderUi(<ChemistryBadge chemistry="fert" />).container)?.className).toBe("badge badge-neutral badge-fert");
  cleanup();
  expect(renderUi(<ChemistryBadge chemistry={null} />).container.textContent).toBe("");
});

test("equipment reads the state the API sends: unknown only when it says unknown, never from an age", () => {
  for (const [state, word] of [["on", "On"], ["off", "Off"], ["unknown", "Not reported"]]) {
    expect(text(renderUi(<EquipmentStateBadge state={state} />).container)).toBe(word);
    cleanup();
  }
  // Long after its last report, an OFF actuator is still OFF: no component turns age into unknown.
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  expect(text(renderUi(<EquipmentStateBadge state="off" />).container)).toBe("Off");
});

test("while the dashboard API is down the green family turns neutral, keeping its word", () => {
  for (const kind of ["confirmed", "running", "on"] as const) {
    const badge = badgeIn(renderUi(<Badge kind={kind} />, { apiDown: true }).container)!;
    expect(badge.className, kind).toBe("badge badge-neutral");
    expect(badge.textContent).toBe(BADGES[kind].text);
    cleanup();
  }
  expect(badgeIn(renderUi(<Badge kind="not_confirmed" />, { apiDown: true }).container)?.className).toBe("badge badge-serious");
  cleanup();
  expect(renderUi(<StatusBadge status="ok">Fine</StatusBadge>, { apiDown: true }).container.querySelector(".badge")?.className).toBe("badge badge-neutral");
});
