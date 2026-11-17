// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import type { DataContinuity, Delivery, Setting } from "../../lib/operator-api";
import {
  STANDING_WORDS, continuityBars, continuityDays, continuitySentence, deliveryHours, deliveryLine, failingNow, failingRows, flowLine, oldestWords, probeAge, probeKind, probeSummary,
  probeWords, probesLine, readbackWords, senderRows, stoppedWords, tableWords,
} from "./data-words";

const NOW = "2026-11-02T17:42:00Z";
const NBSP = String.fromCharCode(0xa0);
const plain = (value: string) => value.replaceAll(NBSP, " ");

test("tables and probes read in words; one this build does not know is null, for the page to show raw", () => {
  expect([tableWords("climate"), tableWords("equipment_state"), tableWords("brand_new")]).toEqual(["Climate readings", "Relay changes", null]);
  expect([probeWords("climate.temp_north"), probeWords("climate.rh_north"), probeWords("climate.temp_case"), probeWords("climate.bus_7")]).toEqual([
    "North wall temperature", "North wall relative humidity", "Controller case temperature", null,
  ]);
});

test("a probe's age reads ago, not seen in 2 h at 7200 s, or never seen", () => {
  expect([plain(probeAge(20)), probeAge(7200), probeAge(9000), probeAge(null)]).toEqual(["20 s ago", "not seen in 2 h", "not seen in 2 h", "never seen"]);
});

test("the ranges come from the URL with their defaults", () => {
  expect([continuityDays("7"), continuityDays("30"), continuityDays("2"), continuityDays(null)]).toEqual([7, 30, 1, 1]);
  expect([deliveryHours("168"), deliveryHours("24"), deliveryHours(null)]).toEqual([168, 24, 24]);
});

test("continuity bars per day, today labelled so far", () => {
  const data = fixture("in-band", { now: NOW })["API-36"] as DataContinuity;
  expect(continuityBars(data.by_day, "2026-11-02")).toEqual({
    outage: [{ date: "2026-11-01", value: 574 }, { date: "2026-11-02", value: 131, partial: true, note: "so far" }],
    replayed: [{ date: "2026-11-01", value: 0 }, { date: "2026-11-02", value: 150, partial: true, note: "so far" }],
  });
});

test("pushes by sender leave out the controller's own reports; failed and expired are not taken; anything else waits", () => {
  const data = fixture("delivery-failing", { now: NOW })["API-37"] as Delivery;
  const rows = senderRows(data.by_status);
  expect(rows.map((row) => row.sender)).not.toContain("esp32");
  expect(rows.every((row) => row.name.charAt(0) === row.name.charAt(0).toUpperCase())).toBe(true);
  const made = senderRows([
    { source: "band", status: "confirmed", count: 5 }, { source: "band", status: "expired", count: 2 }, { source: "band", status: "failed", count: 1 },
    { source: "manual", status: "pending", count: 3 }, { source: "esp32", status: "observed", count: 700 }, { source: "someone_new", status: "confirmed", count: 1 },
  ] as never);
  expect(made.map((row) => [row.sender, row.counts.confirmed, row.counts.failed, row.counts.waiting, row.total])).toEqual([
    ["band", 5, 3, 0, 8], ["manual", 0, 0, 3, 3], ["other", 1, 0, 0, 1],
  ]);
  expect(made.at(-1)?.name).toBe("Another sender");
  expect([plain(oldestWords(1840)), oldestWords(0), oldestWords(null)]).toEqual(["Waiting 30 min", "Nothing is waiting", "Not known"]);
  expect([readbackWords(data.readback_pass), readbackWords({ at: null, stored: null, of: null })]).toEqual(["2 changed of 102 read back", "not reported"]);
});

const at = (time: string) => `2026-11-02T${time}:00Z`;
const LEDGER = [
  { param: "a", failed: 2, last_failed_at: at("10:00"), last_confirmed_at: at("11:00") },
  { param: "b", failed: 5, last_failed_at: at("10:00"), last_confirmed_at: null },
  { param: "c", failed: 9, last_failed_at: at("12:00"), last_confirmed_at: at("11:00") },
  { param: "d", failed: 12, last_failed_at: at("04:50"), last_confirmed_at: null },
  { param: "e", failed: 12, last_failed_at: at("04:55"), last_confirmed_at: null },
  { param: "gone", failed: 3, last_failed_at: at("09:00"), last_confirmed_at: null },
] as never[];
/** A catalogue row: confirmed (the controller holds the wanted value) or not confirmed. */
const held = (param: string, state = "confirmed") => ({ param, group: "scheduled_policy", state, desired: null, read_only_kind: null, readback: { value: 1, observed_at: at("10:40"), reason: null } }) as unknown as Setting;

test("with no catalogue the ledger alone decides: failing until a readback confirms it after its last failure; failing first", () => {
  const rows = failingRows(LEDGER.slice(0, 3), null);
  expect(rows.map((row) => [row.param, row.standing, row.now])).toEqual([["c", "failing", true], ["b", "failing", true], ["a", "recovered", false]]);
});

test("against the catalogue a setting is failing, in force, recovered or retired; only failing counts as not taken", () => {
  const catalog = [held("a"), held("b", "not_confirmed"), held("c", "not_confirmed"), held("d"), held("e")];
  const rows = failingRows(LEDGER, catalog);
  expect(rows.map((row) => [row.param, row.standing, row.now])).toEqual([
    ["c", "failing", true], ["b", "failing", true], ["e", "in_force", false], ["d", "in_force", false], ["a", "recovered", false], ["gone", "retired", false],
  ]);
  expect(rows.find((row) => row.param === "d")?.readbackAt).toBe(at("10:40"));
  expect(rows.find((row) => row.param === "gone")?.readbackAt).toBeNull();
  expect(failingNow(LEDGER, catalog)).toBe(2);
  expect(Object.fromEntries(Object.entries(STANDING_WORDS).map(([key, value]) => [key, [value.label, value.status]]))).toEqual({
    failing: ["Failing", "warn"], recovered: ["Recovered", "neutral"], in_force: ["In force", "neutral"], retired: ["Retired", "neutral"],
  });
});

test("the delivery line warns on a setting failing now or a push waiting over 30 min; otherwise counts what was confirmed", () => {
  const ok = deliveryLine({ by_status: [{ source: "band", status: "confirmed", count: 12 }], failing: [], oldest_unconfirmed_s: 0 } as never, 24, null);
  expect([ok.tone, plain(ok.text)]).toEqual(["ok", "12 pushes confirmed in 24 h, none failing"]);
  expect(deliveryLine({ by_status: [], failing: [], oldest_unconfirmed_s: 2400 } as never, 168, null).tone).toBe("warn");
  const one = [{ param: "x", failed: 1, last_failed_at: at("10:00"), last_confirmed_at: null }];
  const failing = deliveryLine({ by_status: [], failing: one, oldest_unconfirmed_s: 0 } as never, 24, null);
  expect([failing.tone, failing.text]).toEqual(["warn", "1 setting is not taken now"]);
  // The catalogue clears every row: the controller holds x, and y is retired.
  const cleared = deliveryLine({ by_status: [{ source: "band", status: "confirmed", count: 12 }], failing: [...one, { ...one[0], param: "y" }], oldest_unconfirmed_s: 0 } as never, 24, [held("x")]);
  expect([cleared.tone, plain(cleared.text)]).toEqual(["ok", "12 pushes confirmed in 24 h, none failing"]);
});

test("the answer's sentence: nothing lost, or the gaps and what the gap log replayed", () => {
  expect(continuitySentence({ outages: [], by_day: [{ outage_s: 0, replayed_min: 0 }] } as never, 1)).toBe("No data was lost in the last 24 h.");
  expect(plain(continuitySentence({ outages: [{}, {}, {}], by_day: [{ outage_s: 540, replayed_min: 209 }] } as never, 1)))
    .toBe("3 gaps in the record in the last 24 h, 9 min in all; the gap log replayed 3 h 29 min.");
});

test("the flow line warns when the heartbeat is over 2 min or the newest climate row over 5 min", () => {
  expect(flowLine({ ingestor: { heartbeat_age_s: 20 }, tables: [{ table: "climate", last_row_age_s: 30 }] } as never).tone).toBe("ok");
  expect(flowLine({ ingestor: { heartbeat_age_s: 200 }, tables: [] } as never).tone).toBe("warn");
  expect(flowLine({ ingestor: { heartbeat_age_s: 20 }, tables: [{ table: "climate", last_row_age_s: 400 }] } as never).tone).toBe("warn");
});

const NOW_MS = Date.parse(NOW);
const probe = (sensor: string, age_s: number | null, last_seen_at: string | null) => ({ sensor, age_s, last_seen_at }) as never;

test("probe kinds come from the column", () => {
  expect(["climate.soil_ec_south_1", "climate.temp_north", "climate.outdoor_temp", "climate.co2_ppm", "climate.lux", "climate.bus_7"].map(probeKind))
    .toEqual(["soil", "air", "outdoor", "co2", "light", "other"]);
});

test("probes not answering: grouped by kind and day, a stop of today first and counted; the long silent are known; none seen is 30 days", () => {
  const long = "2026-10-30T15:00:00Z";
  const summary = probeSummary([
    probe("climate.temp_north", 20, NOW),
    probe("climate.rh_north", 20, NOW),
    probe("climate.soil_moisture_south_1", 9 * 86_400, long),
    probe("climate.soil_ec_south_1", 9 * 86_400, long),
    probe("climate.soil_moisture_south_2", 9 * 86_400, "2026-10-30T16:00:00Z"),
    probe("climate.soil_ec_south_2", null, null),
    probe("climate.temp_case", 3 * 3600, "2026-11-02T14:42:00Z"),
  ], NOW_MS);
  expect(summary.answering.length).toBe(2);
  expect(summary.stoppedToday).toBe(1);
  expect(summary.silent.map((line) => [line.text, line.recent])).toEqual([
    ["Controller case temperature: no answer since 07:42", true],
    ["3 soil probes: no answer since 30 Oct", false],
    ["Unknown (climate.soil_ec_south_2): no reading in 30 days", false],
  ]);
  // A probe this build has no name for says so, with its key.
  expect(summary.silent.at(-1)?.unknown).toBe(true);
  expect(summary.knownText).toBe("4 probes known to be silent");
  expect(probesLine(summary)).toEqual({ tone: "warn", text: "1 probe stopped answering today · 2 answering · 4 probes known to be silent" });
});

test("only known silent probes: muted, named apart for the status line; none silent is ok", () => {
  const known = probeSummary([probe("climate.temp_north", 20, NOW), probe("climate.soil_moisture_south_1", 9 * 86_400, "2026-10-30T15:00:00Z"),
    probe("climate.soil_ec_south_1", 9 * 86_400, "2026-10-30T15:00:00Z")], NOW_MS);
  expect([known.stoppedToday, known.knownText, probesLine(known).tone]).toEqual([0, "2 soil probes silent since 30 Oct", "muted"]);
  const none = probeSummary([probe("climate.temp_north", 20, NOW)], NOW_MS);
  expect([none.silent, none.knownText, probesLine(none)]).toEqual([[], null, { tone: "ok", text: "1 answering" }]);
  expect([stoppedWords(0), stoppedWords(2)]).toEqual([null, "2 probes stopped answering today"]);
});
