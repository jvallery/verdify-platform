// SPDX-License-Identifier: MIT
// Revert's target rule (dashboard v2 screens §10.4), pure: the row before the newest; a release, or none, goes back to
// the setting's own value.
import { expect, test } from "vitest";
import type { DesiredSetting } from "./operator-api";
import { REVERT_TO_DEFAULT, needsLookback, revertTarget } from "./revert";

const KPA = { kind: "numeric", unit: "kPa", step: 0.05 };
const JASON = { username: "jason", display_name: "Jason" };
function row(value: number | null, created_at: string, source = "dashboard", name = "jason"): DesiredSetting {
  return { id: 1, param: "outdoor_staleness_max_s", value, manual: value !== null, state: value === null ? "released" : "confirmed", actor: { source, name }, created_at };
}
const history = (desired: DesiredSetting[]) => ({ desired });
const NEWEST = row(1.55, "2026-11-02T15:00:00Z");
const nbsp = (text: string) => text.replaceAll(" ", " ");

test("the target is the row just before the newest, and the button and the reason say so", () => {
  const agent = row(1.6, "2026-10-30T13:02:00Z", "agent:steward", "steward");
  const target = revertTarget(history([row(1.4, "2026-10-29T13:00:00Z"), agent, NEWEST]), KPA, JASON);
  expect(target).toEqual({ kind: "value", value: 1.6, text: `Revert to ${nbsp("1.60 kPa")} (steward, 10/30 07:02)`, reason: "Revert to 1.60 kPa (steward, 10/30 07:02)" });
});

test("only the signed-in person reads by display name; anyone else by username, an agent by its name", () => {
  const at = "2026-10-30T14:00:00Z";
  const words = (actor: DesiredSetting, me: Parameters<typeof revertTarget>[2]) => revertTarget(history([actor, NEWEST]), KPA, me)!.text;
  expect(words(row(1.6, at), JASON)).toContain("(Jason, 10/30 08:00)");
  expect(words(row(1.6, at, "dashboard", "caretaker"), JASON)).toContain("(caretaker, 10/30 08:00)");
  expect(words(row(1.6, at), null)).toContain("(jason, 10/30 08:00)");
  expect(words(row(1.6, at, "system", "host"), JASON)).toContain("(host, 10/30 08:00)");
});

test("a previous release, or no earlier row, goes back to the setting's own value", () => {
  expect(revertTarget(history([row(null, "2026-10-30T13:02:00Z"), NEWEST]), KPA, JASON)).toEqual({ kind: "release", text: REVERT_TO_DEFAULT, reason: "Revert to default (Jason, 10/30 07:02)" });
  expect(revertTarget(history([NEWEST]), KPA, JASON)).toEqual({ kind: "release", text: REVERT_TO_DEFAULT, reason: REVERT_TO_DEFAULT });
});

test("no desired row at all, or a release with no value before it, has nothing to go back to", () => {
  expect(revertTarget(history([]), KPA, JASON)).toBeNull();
  const released = row(null, "2026-11-02T15:00:00Z");
  expect(revertTarget(history([released]), KPA, JASON)).toBeNull();
  expect(revertTarget(history([row(null, "2026-10-30T13:02:00Z"), released]), KPA, JASON)).toBeNull();
  // A release with a value before it goes back to that value.
  expect(revertTarget(history([row(1.6, "2026-10-30T13:02:00Z"), released]), KPA, JASON)).toMatchObject({ kind: "value", value: 1.6 });
});

test("a value reads as stored and a switch or enum in words", () => {
  expect(revertTarget(history([row(48.75, "2026-10-30T13:02:00Z"), NEWEST]), { kind: "numeric", unit: "s", step: 5 }, JASON)!.text).toBe(`Revert to ${nbsp("48.75 s")} (Jason, 10/30 07:02)`);
  expect(revertTarget(history([row(1, "2026-10-30T13:02:00Z"), NEWEST]), { kind: "switch", unit: null, step: 1 }, JASON)!.text).toBe("Revert to ON (Jason, 10/30 07:02)");
  expect(revertTarget(history([row(2, "2026-10-30T13:02:00Z"), NEWEST]), { kind: "enum", unit: null, step: 1, options: [{ value: 2, label: "Eco" }] }, JASON)!.text).toBe("Revert to Eco (Jason, 10/30 07:02)");
});

test("only a window holding exactly the newest row reads further back", () => {
  expect(needsLookback([])).toBe(false);
  expect(needsLookback([NEWEST])).toBe(true);
  expect(needsLookback([row(1.6, "2026-10-30T13:02:00Z"), NEWEST])).toBe(false);
});
