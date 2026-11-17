// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import type { ControllerHealth } from "../../lib/operator-api";
import { budgetItems, freeShare, levelOf, verdict } from "./budget";

const NOW = "2026-11-02T17:42:00Z";
const NBSP = String.fromCharCode(0xa0);
const plain = (value: string | null) => value?.replaceAll(NBSP, " ") ?? null;
const health = (name: string | string[] = "in-band"): ControllerHealth => fixture(name, { now: NOW })["API-35"] as ControllerHealth;

test("levels: lower or higher is worse, critical before warning, unknown never inside", () => {
  expect([levelOf(30, "lower", 25, 15), levelOf(20, "lower", 25, 15), levelOf(10, "lower", 25, 15), levelOf(null, "lower", 25, 15)]).toEqual(["ok", "warn", "critical", "unknown"]);
  expect([levelOf(100, "higher", 250, null), levelOf(260, "higher", 250, null)]).toEqual(["ok", "warn"]);
  expect([freeShare(1711, 12_023)?.toFixed(1), freeShare(null, 3), freeShare(0, 0)]).toEqual(["87.5", null, null]);
});

test("the six budget items in order, each value against its limits, all inside on the base fixture", () => {
  const items = budgetItems(health());
  expect(items.map((row) => [row.key, plain(row.text), row.level, plain(row.limits)])).toEqual([
    ["memory", "37 kB", "ok", "warning under 25 kB, critical under 15 kB"],
    ["block", "22 kB", "ok", "warning under 16 kB"],
    ["loop", "11.4 ms", "ok", "warning over 250.0 ms"],
    ["write", "3.9 ms", "ok", "warning over 200.0 ms"],
    ["stack", "1,848 B", "ok", "warning under 1,024 B"],
    ["entries", "12,023 free of 13,734", "ok", "warning under 25% free, critical under 15% free"],
  ]);
  expect(plain(items[0].meta)).toBe("Now 38 kB · lowest since restart 35 kB");
  expect(verdict(health())).toEqual({ level: "ok", title: "Healthy", text: "Every part of the hardware budget is inside its limits.", more: 0 });
});

test("the verdict names the first limit crossed, critical first, and counts the rest", () => {
  const low = health("controller-heap-low");
  const items = budgetItems(low);
  expect(items.find((row) => row.key === "memory")?.level).toBe("warn");
  expect(items.find((row) => row.key === "block")?.level).toBe("warn");
  const said = verdict(low);
  expect([said.level, said.title, plain(said.text), said.more]).toEqual([
    "warn", "Warning", "Free memory fell to 24 kB in the last minute, under the warning line of 25 kB: memory is running short.", 2,
  ]);
  const critical = { ...low, heap: { ...low.heap, minute_low_kb: 12 } };
  expect(plain(verdict(critical).text)).toBe("Free memory fell to 12 kB in the last minute, under the critical line of 15 kB: the controller is close to running out of memory and may restart.");
});

test("storage nearly full stops the gap log; a slow write says so; not reporting is said", () => {
  const full = health("gap-log-off");
  const entries = budgetItems(full).find((row) => row.key === "entries")!;
  expect([entries.level, entries.crossed]).toEqual(["critical", "Only 2.3% of the storage entries are free, under the critical line of 15%: the gap log stops: storage is nearly full."]);
  expect(plain(budgetItems(full).find((row) => row.key === "write")!.crossed)).toBe("A storage write took 212.5 ms, over the warning line of 200.0 ms: the gap log stops keeping a record while storage is this slow.");
  expect(verdict({ ...health(), observed_at: null }).title).toBe("Not reporting");
});

test("a value not reported is unknown, and the verdict says how many", () => {
  const base = health();
  const missing = { ...base, loop: { worst_ms: null, stack_free_min_b: null } };
  expect(budgetItems(missing).find((row) => row.key === "loop")?.text).toBe("—");
  expect(verdict(missing).text).toBe("Every reported part of the hardware budget is inside its limits; 2 values are not reported.");
});

test("the meter's scale leaves room past the value and each line; storage entries read out of 100", async () => {
  const { budgetScale } = await import("./budget-meter");
  expect(budgetScale({ value: 37, warning: 25, critical: 15, worse: "lower", unit: "kB" })).toBe(50);
  expect(budgetScale({ value: 11.4, warning: 250, critical: null, worse: "higher", unit: "ms" })).toBe(312.5);
  expect(budgetScale({ value: 400, warning: 250, critical: null, worse: "higher", unit: "ms" })).toBeCloseTo(460);
  expect(budgetScale({ value: 87.5, warning: 25, critical: 15, worse: "lower", unit: "%" })).toBe(100);
  expect(budgetScale({ value: null, warning: null, critical: null, worse: "lower", unit: "B" })).toBe(1);
});
