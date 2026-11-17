// SPDX-License-Identifier: MIT
// The law over time: API-31's lanes and decisions and API-05's relays as state-lane rows, and the price chart's model.
import { expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import { parseLawHistory, parseStateLanes, type LawHistory } from "../../lib/operator-api";
import { words } from "../../lib/words";
import { ASKED_LANES, LANE_GROUPS, LAW_WINDOWS, askedRows, buildPriceModel, decisionRow, latchRows, ranRows, refusedAt, windowOf, windowRange } from "./history";

const NOW = "2026-11-02T17:42:00Z";
function history(): LawHistory {
  const parsed = parseLawHistory(fixture("in-band", { now: NOW })["API-31"]);
  if (!parsed) throw new Error("API-31 did not parse");
  return parsed;
}

test("the windows: 24 h, 72 h and 7 d for the lanes, 31 d added for the price; graphs gets its own range name", () => {
  expect(LAW_WINDOWS.map((item) => item.id)).toEqual(["24h", "72h", "7d", "31d"]);
  expect(windowOf("31d").graphs).toBe("30d");
  expect(windowOf("7d").seconds).toBe(604_800);
  const range = windowRange(history());
  expect(range.to - range.from).toBe(86_400);
  expect(LANE_GROUPS.find((group) => group.key === "latch")).toMatchObject({ label: "As reported", collapsed: true });
});

test("asked-for rows follow the rules' order and are named by their rule; latches go in their own group", () => {
  const answer = history();
  const range = windowRange(answer);
  const asked = askedRows(answer, range);
  expect(asked.length).toBeGreaterThan(0);
  const order = ASKED_LANES.map(([key]) => key).filter((key) => asked.some((row) => row.key === key));
  expect(asked.map((row) => row.key)).toEqual(order);
  expect(asked[0]).toMatchObject({ group: "asked", token: "--accent", label: words("law_rule", ASKED_LANES.find(([key]) => key === asked[0].key)?.[1] ?? "") });
  for (const row of [...asked, ...latchRows(answer, range)]) for (const span of row.spans) {
    expect(span.start).toBeGreaterThanOrEqual(range.from);
    expect(span.end).toBeLessThanOrEqual(range.to);
  }
  expect(latchRows(answer, range).every((row) => row.group === "latch")).toBe(true);
});

test("ran rows take API-05's relays in board order with their equipment colour", () => {
  const states = parseStateLanes(fixture("in-band", { now: NOW })["API-05"]);
  if (!states) throw new Error("API-05 did not parse");
  const range = windowRange(history());
  const rows = ranRows(states, range);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.group === "ran" && row.token.startsWith("--eq-"))).toBe(true);
  expect(rows[0].key).toBe("relay.heat1");
});

test("the decision lane: running on, not wanted off, refused hatched with its reason", () => {
  const answer = history();
  const row = decisionRow(answer, windowRange(answer));
  expect(row).toMatchObject({ key: "drying", label: "Drying" });
  const refused = row.spans.filter((span) => span.state === "refused");
  expect(refused.length).toBeGreaterThan(0);
  expect(refused.map((span) => span.label)).toContain(words("drying_refusal", "cost"));
  expect(row.spans.some((span) => span.state === "on")).toBe(true);
  expect(row.spans.some((span) => span.state === "off" && span.label === undefined)).toBe(true);
});

test("the price model: the series as served, refused spans in epoch seconds, and the span at a time", () => {
  const answer = history();
  const model = buildPriceModel(answer);
  expect(model.t.length).toBe(answer.cost.t.length);
  expect(model.bucketSeconds).toBe(60);
  expect(model.empty).toBe(false);
  const first = model.refused[0];
  expect(refusedAt(model, first.from)?.reason).toBe(first.reason);
  expect(refusedAt(model, first.to)).not.toBe(first);
  expect(buildPriceModel({ ...answer, cost: { ...answer.cost, cost_kwh_per_kg: answer.cost.t.map(() => null), limit_kwh_per_kg: answer.cost.t.map(() => null) } }).empty).toBe(true);
});
