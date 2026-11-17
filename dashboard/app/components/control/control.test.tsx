// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Control's own parts (dashboard v2 screens §10.4): the text marks, the bounds bar in each state, the search fields and
// control.css staying token-only. Times are America/Denver with the clock at 10:42 on 2026-11-02.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NBSP, denver, renderUi, text } from "../test-render";
import { BoundsBar, boundsWords } from "./bounds-bar";
import { FindSetting, SettingsSearch } from "./find-setting";
import { Mark } from "./marks";

const NOW = Date.parse(denver("10:42"));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("text marks are muted mono words with their data-badge hooks, never pills", () => {
  const { container } = renderUi(<p><Mark kind="ai" /> <Mark kind="no_readback" /></p>);
  expect([...container.querySelectorAll("[data-badge]")].map((node) => [node.getAttribute("data-badge"), node.className, text(node)])).toEqual([
    ["ai", "ctl-mark", "AI"], ["no_readback", "ctl-mark", "No readback"],
  ]);
});

test("the bounds bar: the value as a dot, a request as a dashed ring, an arrowhead past an end, nothing coloured with the API down", () => {
  const bar = (props: Partial<Parameters<typeof BoundsBar>[0]>, session = {}) => {
    cleanup();
    return renderUi(<BoundsBar min={0.5} max={2.5} step={0.05} unit="kPa" value={1.6} {...props} />, session).container.querySelector(".ctl-bounds")!;
  };
  let node = bar({ requested: 1.55 });
  expect(node.querySelector(".ctl-bounds-dot")!.getAttribute("cx")).toBe("55%");
  expect(node.querySelector(".ctl-bounds-planned")).toBeNull();
  expect(node.querySelector(".ctl-bounds-requested")!.getAttribute("cx")).toBe("52.5%");
  expect(text(node.querySelector(".setting-bounds"))).toBe("Allowed 0.50–2.50 kPa · step 0.05");
  expect(node.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  expect(node.querySelector("[style]")).toBeNull();
  // Past an end: no dot, an arrowhead at that end.
  node = bar({ value: 2.9 });
  expect(node.querySelector(".ctl-bounds-dot")).toBeNull();
  expect(node.querySelector(".ctl-bounds-clamp")!.getAttribute("d")).toBe("M1 7 L-6 2 L-6 12 Z");
  // Unknown: no dot and no zero.
  node = bar({ value: null });
  expect([node.classList.contains("is-unknown"), node.querySelector(".ctl-bounds-dot")]).toEqual([true, null]);
  expect(bar({ stale: true }).classList.contains("is-stale")).toBe(true);
  expect(bar({}, { apiDown: true }).classList.contains("is-neutral")).toBe(true);
  // No bounds to draw: the space is kept, empty.
  node = bar({ min: null });
  expect([node.className, node.children.length]).toEqual(["ctl-bounds ctl-bounds-none", 0]);
  expect(boundsWords({ min: 100, max: 600, step: 10, unit: "gal" })?.replaceAll(NBSP, " ")).toBe("Allowed 100–600 gal · step 10");
  expect(boundsWords({ min: 0, max: null })).toBeNull();
});

test("the Control tabs share one search: Settings' field and Find a setting's, 22rem from 861 px, Find an outline that submits the form (#1308 visual QA 28)", () => {
  const { container } = renderUi(<><SettingsSearch value="" onChange={() => {}} /><FindSetting /></>);
  const [settings, find] = [...container.querySelectorAll(".ctl-find")];
  expect(settings.querySelector("input")?.getAttribute("placeholder")).toBe("Search by name, key or what it changes");
  expect(find.querySelector("input")?.getAttribute("placeholder")).toBe("Find a setting");
  expect(find.querySelector("button")?.getAttribute("type")).toBe("submit");
  const css = readFileSync(join(process.cwd(), "app/styles/control.css"), "utf8");
  // A definite width (the old min(24rem,100%) resolved against a column sized by its content and fell back to the input's own).
  expect(css).toContain("@media(min-width:861px){.ctl-find input{width:22rem}}");
  expect(css).not.toMatch(/\.ctl-search input\{width:min\(/);
  // The global filled submit (base.css button[type=submit]) is undone for Find: a way to a page, never a primary action.
  expect(css).toContain(".ctl-find .btn{flex:none;background:var(--surface);border-color:var(--border-strong);color:var(--accent)}");
});

test("control.css is token-only and keeps no rule of a retired piece", () => {
  const css = readFileSync(join(process.cwd(), "app/styles/control.css"), "utf8");
  // Outside comments, which cite issues by number.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  expect(rules.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi)).toBeNull();
  for (const retired of [".pln-", ".ctl-plan", ".ctl-validity", ".ctl-rail", ".ctl-trigger", ".ctl-row-pill", ".ctl-row-meta", ".ctl-bounds-planned", ".settings-overview", ".planner-"]) {
    expect(css, retired).not.toContain(retired);
  }
});
