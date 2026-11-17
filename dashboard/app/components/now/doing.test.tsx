// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// What the controller is doing on Now (dashboard v2 screens §1 block 2): the law's sentences, a chip per relay that is on
// with how long, the runs by hand, "Why ›" into Climate; unknown (never "nothing") while the ingestor or the controller
// is not reporting; loading before API-02 answers.
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import { HOLDING, NOTHING_RUNNING } from "../../lib/law-sentence";
import { nowAnswer } from "../../lib/now-answer";
import { parseNow, type Now } from "../../lib/operator-api";
import { renderUi, text } from "../test-render";
import { ControllerDoing, DOING_UNKNOWN, runningChips } from "./doing";

const NOW = Date.parse("2026-11-02T17:42:00Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const plain = (value: string) => value.replaceAll(String.fromCharCode(0xa0), " ");
const nowOf = (names: string | string[], patch: (now: Now) => Now = (now) => now) => patch(parseNow(fixture(names, { now: NOW })["API-02"])!);
const show = (now: Now | null) => renderUi(<ControllerDoing now={now} answer={nowAnswer({ now, failed: false })} />);
const said = () => document.querySelector("#doing [data-doing]");

test("holding: the law's one sentence, no chip, and Why into Climate", () => {
  show(nowOf("in-band", (now) => ({ ...now, law: { ...now.law!, requests: [], drying: "not_wanted", drying_refused_reason: null }, running: [] })));
  expect(said()?.getAttribute("data-doing")).toBe("holding");
  expect(plain(text(said()))).toBe(`${HOLDING} ${NOTHING_RUNNING}`);
  expect(document.querySelectorAll("[data-chip=relay]")).toHaveLength(0);
  expect(screen.getByRole("link", { name: /^Why/ }).getAttribute("href")).toBe("/climate");
});

test("heating: the sentence names the heater and its chip says how long it has been on", () => {
  show(nowOf("in-band", (now) => ({
    ...now, law: { ...now.law!, requests: ["heat1"], drying: "not_wanted", drying_refused_reason: null },
    running: [{ equipment: "heat1", line_id: null, cause: "climate", since: "2026-11-02T17:30:00Z" }],
  }) as Now));
  expect(said()?.getAttribute("data-doing")).toBe("acting");
  expect(plain(text(said()))).toMatch(/electric/i);
  expect([...document.querySelectorAll("[data-chip=relay]")].map((chip) => plain(text(chip)))).toEqual(["Heat 1 (electric) · 12 min"]);
});

test("rows 2 and 3: what runs is unknown, never nothing; before API-02 answers the panel is loading", () => {
  for (const names of ["ingestor-not-running", "controller-not-reporting"]) {
    show(nowOf(names));
    expect(text(said())).toBe(DOING_UNKNOWN);
    expect(document.body.textContent).not.toContain(NOTHING_RUNNING);
    cleanup();
  }
  show(null);
  expect(said()).toBeNull();
});

test("the chips: each relay in words with its time on; no time without a since", () => {
  expect(runningChips([
    { equipment: "fan1", line_id: null, cause: "climate", since: "2026-11-02T17:40:00Z" },
    { equipment: "drip_wall", line_id: "L01", cause: "schedule", since: null },
  ] as Now["running"], NOW).map((chip) => plain(chip.text))).toEqual(["Fan 1 · 2 min", "Wall drip"]);
});
