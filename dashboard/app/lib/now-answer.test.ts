// SPDX-License-Identifier: MIT
// Now's worst-first answer (dashboard v2 screens §1 block 1) over the contract fixtures: each row alone produces its
// sentence, the first true row wins for every pair and every combination of rows, and nothing reads "All OK" while a
// row above it holds, while the read it needs has failed or before API-02 first answers. The band is the one the
// controller uses (`law.band`, 61.2–70 °F in the base world) and the protection limits are the law's `hot` and `cold`
// requests; no mode label is read. Times are America/Denver with the fixture clock at 10:42.
import { expect, test } from "vitest";
import { fixture } from "../../e2e/fixtures/index.mjs";
import {
  ALL_OK, ALONE_TEXT, BAND_DWELL_S, COLD_TEXT, HOT_TEXT, LOADING, OUT_OF_BAND_TEXT, STALE_TEXT, UNREACHABLE_TEXT, bandText, houseBand, needsCount, nowAnswer,
  readingFresh, stepBandHold, type BandHold, type NowAnswer,
} from "./now-answer";
import { parseNow, type Freshness, type Now, type Reading } from "./operator-api";

const NOW = Date.parse("2026-11-02T17:42:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const secondsAgo = (seconds: number) => iso(NOW - seconds * 1000);
/** API-02 as the fixture API answers it under `names` at 10:42, through the client's parser. */
function served(names: string | string[]): Now {
  const now = parseNow(fixture(names, { now: NOW })["API-02"]);
  if (!now) throw new Error(`API-02 under ${String(names)} does not parse`);
  return now;
}
const plain = (value: string) => value.replaceAll(" ", " ");
const ask = (now: Now | null, failed = false, hold: BandHold | null = null): NowAnswer => {
  const answer = nowAnswer({ now, failed, hold });
  return { ...answer, text: plain(answer.text), conditions: answer.conditions.map((condition) => ({ ...condition, text: plain(condition.text) })) };
};
/** Row 6's condition line, the phrases joined as the hero shows them. */
const line = (answer: NowAnswer) => answer.conditions.map((condition) => condition.text).join(" · ");
const withLaw = (now: Now, law: Partial<NonNullable<Now["law"]>>): Now => ({ ...now, law: { ...(now.law as NonNullable<Now["law"]>), ...law } });

test("each row of the table, set alone in a fixture, produces its sentence", () => {
  expect(ask(served("in-band"), true).text).toBe("Can't reach the greenhouse data");
  expect(ask(null, true).text).toBe(UNREACHABLE_TEXT);
  expect(ask(served("ingestor-not-running")).text).toBe("Ingestor not running since 10:38");
  expect(ask(served("controller-not-reporting")).text).toBe("Controller not reporting since 10:36");
  expect(ask(served("controller-not-reporting")).detail).toBe(ALONE_TEXT);
  expect(ask(served("flow-valves-closed")).text).toBe("Water flowing with every Verdify valve closed");
  expect(ask(withLaw(served("in-band"), { requests: ["vent", "fan1", "fan2", "cooling", "hot"] })).text).toBe(HOT_TEXT);
  expect(ask(withLaw(served("in-band"), { requests: ["heat1", "heat2", "cold"] })).text).toBe(COLD_TEXT);
  expect(ask(served("too-hot")).text).toBe(OUT_OF_BAND_TEXT);
  expect(line(ask(served("too-hot")))).toBe("Too hot: 14.1 °F above the high edge (84.1 °F, band 61.2–70 °F)");
  expect(ask(served("alerts-merged")).text).toBe("2 things need someone");
  // The age is the hero's own line, so the sentence never repeats it.
  expect(ask(served("stale-data")).text).toBe(STALE_TEXT);
  expect(ask(served("in-band")).text).toBe(ALL_OK);
});

test("each row says where it is explained, and rows 1 to 3 and 8 hide every verdict", () => {
  const rows = {
    failed: ask(served("in-band"), true), ingestor: ask(served("ingestor-not-running")), controller: ask(served("controller-not-reporting")),
    flow: ask(served("flow-valves-closed")), limit: ask(withLaw(served("in-band"), { requests: ["hot"] })), band: ask(served("too-hot")),
    alerts: ask(served("alerts-merged")), stale: ask(served("stale-data")), ok: ask(served("in-band")),
  };
  expect(Object.values(rows).map((answer) => answer.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(Object.values(rows).map((answer) => answer.link?.to ?? null))
    .toEqual([null, "/system/data", "/system/controller", "/activity?alert=201", "/climate", null, "#needs-you", null, null]);
  expect(rows.band.conditions.map((condition) => condition.link.to)).toEqual(["/graphs?range=24h#temperature"]);
  expect(Object.values(rows).filter((answer) => answer.conditions.length)).toEqual([rows.band]);
  expect(Object.values(rows).map((answer) => answer.muted)).toEqual([true, true, true, false, false, false, false, true, false]);
  expect(Object.values(rows).map((answer) => answer.notReporting)).toEqual([true, true, true, false, false, false, false, false, false]);
  expect(rows.failed.unknownSince).toBe(iso(NOW));
  expect(rows.ingestor.unknownSince).toBe(secondsAgo(240));
  expect(rows.controller.unknownSince).toBe(secondsAgo(360));
  expect(rows.ok.unknownSince).toBeNull();
  expect(Object.values(rows).map((answer) => answer.lastDataAt)).toEqual([null, null, null, null, null, null, null, secondsAgo(14 * 60), null]);
});

test("before API-02 first answers nothing is claimed; a failed first read is row 1", () => {
  expect(ask(null)).toEqual(LOADING);
  expect(ask(null, true)).toMatchObject({ row: 1, kind: "unreachable", unknownSince: null, muted: true });
});

// ---------------------------------------------------------------------------------------------------- combinations
const source = (ageS: number, staleAfter = 120): Freshness => ({ observed_at: secondsAgo(ageS), age_s: ageS, cadence_s: 60, stale: ageS > staleAfter });
const readingAt = (reading: Reading, ageS: number): Reading => ({ ...reading, observed_at: secondsAgo(ageS) });
const indoorAt = (now: Now, ageS: number): Now["indoor"] => ({ temp_f: readingAt(now.indoor.temp_f, ageS), rh_pct: readingAt(now.indoor.rh_pct, ageS), vpd_kpa: readingAt(now.indoor.vpd_kpa, ageS) });
/** Each row's condition, made true on an API-02 answer and nothing else: rows 2 to 8 (row 1 is the failed read). */
const SETTERS: Record<number, (now: Now) => Now> = {
  2: (now) => ({ ...now, freshness: { ...now.freshness, ingestor: source(240, 180) } }),
  3: (now) => ({ ...now, freshness: { ...now.freshness, ingestor: source(30, 180), climate: source(360) }, indoor: indoorAt(now, 360) }),
  4: (now) => ({ ...now, leak: { active: true, since: secondsAgo(240), flow_gpm: 1, gal_last_10min: 3, alert_id: 201, stopped_at: null } }),
  5: (now) => withLaw(now, { requests: ["vent", "fan1", "fan2", "cooling", "hot"] }),
  6: (now) => ({ ...now, indoor: { ...now.indoor, temp_f: { value: 84.1, observed_at: secondsAgo(20), reason: null } } }),
  7: (now) => ({ ...now, alerts: { open: 2, critical: 0, warning: 1, info: 1 } }),
  8: (now) => ({ ...now, freshness: { ...now.freshness, ingestor: source(30, 180), climate: source(240) }, indoor: indoorAt(now, 240) }),
};
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8];
/** Rows set together: the highest row first, the lowest last, so the lowest certainly holds. */
const IN_BAND = served("in-band");
function combine(rows: readonly number[]): NowAnswer {
  let now = IN_BAND;
  for (const row of [...rows].sort((a, b) => b - a)) if (row !== 1) now = SETTERS[row](now);
  return ask(now, rows.includes(1));
}

test("every combination of rows reads its lowest row, and All OK needs every row above it false", () => {
  for (const row of ROWS) expect(combine([row]).row, `row ${row}`).toBe(row);
  for (let mask = 1; mask < 1 << ROWS.length; mask += 1) {
    const rows = ROWS.filter((_, bit) => mask & (1 << bit));
    const answer = combine(rows);
    expect(answer.row, rows.join(",")).toBe(Math.min(...rows));
    expect(answer.text, rows.join(",")).not.toBe(ALL_OK);
  }
  expect(combine([]).text).toBe(ALL_OK);
});

// ---------------------------------------------------------------------------------------------------- the band
const band = (patch: (now: Now) => Now) => ask(patch(served("in-band")));
const fresh = (value: number | null): Reading => ({ value, observed_at: secondsAgo(20), reason: value === null ? "No reading" : null });

test("the band is the controller's while the law reports, the host's otherwise", () => {
  const base = served("in-band");
  expect(houseBand(base)).toEqual({ temp: { low: 61.2, high: 70 }, vpd: { low: 0.45, high: 0.8 }, source: "controller" });
  expect(houseBand({ ...base, law: null })).toEqual({ temp: { low: 62, high: 70 }, vpd: { low: 0.45, high: 0.8 }, source: "host" });
  // 61.5 °F is inside the controller's band and below the host's: the controller's wins.
  expect(band((now) => ({ ...now, indoor: { ...now.indoor, temp_f: fresh(61.5) } })).text).toBe(ALL_OK);
  expect(line(band((now) => ({ ...now, law: null, indoor: { ...now.indoor, temp_f: fresh(61.5) } })))).toBe("Too cold: 0.5 °F below the low edge (61.5 °F, band 62–70 °F)");
});

test("row 6: a steady headline, and a condition line naming each reading out, its edge and by how much", () => {
  const out = (patch: (now: Now) => Now) => { const answer = band(patch); expect(answer.text).toBe(OUT_OF_BAND_TEXT); return line(answer); };
  expect(out((now) => ({ ...now, indoor: { ...now.indoor, temp_f: fresh(58.2) } }))).toBe("Too cold: 3.0 °F below the low edge (58.2 °F, band 61.2–70 °F)");
  expect(out((now) => ({ ...now, indoor: { ...now.indoor, vpd_kpa: fresh(1.12) } }))).toBe("Air too dry: 0.32 kPa above the high edge (1.12 kPa, band 0.45–0.80 kPa)");
  expect(out((now) => ({ ...now, indoor: { ...now.indoor, vpd_kpa: fresh(0.32) } }))).toBe("Air too damp: 0.13 kPa below the low edge (0.32 kPa, band 0.45–0.80 kPa)");
  const both = band((now) => ({ ...now, indoor: { ...now.indoor, temp_f: fresh(58.2), vpd_kpa: fresh(1.12) } }));
  expect(both.conditions.map((condition) => condition.metric)).toEqual(["temp", "vpd"]);
  expect(both.conditions.map((condition) => condition.link.to)).toEqual(["/graphs?range=24h#temperature", "/graphs?range=24h#vpd"]);
  // RH has no band: an RH far from anything is no answer.
  expect(band((now) => ({ ...now, indoor: { ...now.indoor, rh_pct: fresh(98) } })).text).toBe(ALL_OK);
  expect(bandText(62.5, 70, "°F")).toBe("62.5–70 °F");
  expect(bandText(null, 70, "°F")).toBeNull();
});

/** An API-02 answer at `at` (epoch s) with temperature and VPD as given, against 2026-11-05's band in force at 18:51Z. */
function poll(base: Now, at: number, temp: number, vpd: number): Now {
  const when = new Date(at * 1000).toISOString();
  return {
    ...withLaw(base, { band: { temp_low_f: 73.91, temp_high_f: 83.91, vpd_low_kpa: 0.863, vpd_high_kpa: 1.293 } }), server_time: when,
    indoor: { ...base.indoor, temp_f: { value: temp, observed_at: when, reason: null }, vpd_kpa: { value: vpd, observed_at: when, reason: null }, rh_pct: { ...base.indoor.rh_pct, observed_at: when } },
  };
}

test("dwell: out only after 2 min out, back in only after 2 min in; idempotent on the same answer", () => {
  const base = served("in-band");
  const t0 = Date.parse("2026-11-05T18:00:00Z") / 1000;
  let hold = stepBandHold(null, poll(base, t0, 77, 1.1));
  expect(hold?.metrics.vpd.held).toBe("in");
  hold = stepBandHold(hold, poll(base, t0 + 15, 77, 1.6));
  expect(stepBandHold(hold, poll(base, t0 + 15, 77, 1.6))).toBe(hold);
  hold = stepBandHold(hold, poll(base, t0 + 120, 77, 1.6));
  expect(ask(poll(base, t0 + 120, 77, 1.6), false, hold).text).toBe(ALL_OK);
  hold = stepBandHold(hold, poll(base, t0 + 135, 77, 1.6));
  expect(ask(poll(base, t0 + 135, 77, 1.6), false, hold).text).toBe(OUT_OF_BAND_TEXT);
  hold = stepBandHold(hold, poll(base, t0 + 150, 77, 1.2));
  const back = ask(poll(base, t0 + 150, 77, 1.2), false, hold);
  expect(back.text).toBe(OUT_OF_BAND_TEXT);
  // Held out while the reading is back inside: no distance until the dwell lets it go.
  expect(line(back)).toBe("Air too dry: (1.20 kPa, band 0.86–1.29 kPa)");
  hold = stepBandHold(hold, poll(base, t0 + 165, 77, 1.4));
  for (let at = t0 + 180; at <= t0 + 285; at += 15) hold = stepBandHold(hold, poll(base, at, 77, 1.2));
  expect(hold?.metrics.vpd.held).toBe("above");
  hold = stepBandHold(hold, poll(base, t0 + 300, 77, 1.2));
  expect(hold?.metrics.vpd.held).toBe("in");
  expect(BAND_DWELL_S).toBe(120);
});

test("replaying 2026-11-05 18:15–18:45Z (the midday vent cycle) changes the headline at most twice", () => {
  const base = served("in-band");
  // `climate` per minute (temp_avg, vpd_avg), read-only from production; 18:36 has no row. Polled four times a minute.
  const minutes: [string, number, number][] = [
    ["18:15", 77.42, 1.209], ["18:16", 77.42, 1.231], ["18:17", 77.36, 1.24], ["18:18", 77.24, 1.252], ["18:19", 76.7, 1.603], ["18:20", 75.68, 1.719],
    ["18:21", 74.78, 1.744], ["18:22", 73.88, 1.67], ["18:23", 73.04, 1.554], ["18:24", 72.26, 1.415], ["18:25", 71.48, 1.481], ["18:26", 70.88, 1.483],
    ["18:27", 70.52, 1.466], ["18:28", 70.16, 1.486], ["18:29", 69.86, 1.461], ["18:30", 69.38, 1.454], ["18:31", 69.14, 1.438], ["18:32", 68.84, 1.431],
    ["18:33", 68.72, 1.398], ["18:34", 68.72, 1.316], ["18:35", 69.2, 1.249], ["18:37", 69.74, 1.269], ["18:38", 70.34, 1.291], ["18:39", 71.0, 1.282],
    ["18:40", 71.66, 1.298], ["18:41", 72.26, 1.292], ["18:42", 73.04, 1.303], ["18:43", 73.64, 1.321], ["18:44", 74.48, 1.096], ["18:45", 75.8, 0.905],
  ];
  let hold: BandHold | null = null;
  const headlines: string[] = [], raw: string[] = [];
  for (const [clock, temp, vpd] of minutes) {
    const start = Date.parse(`2026-11-05T${clock}:00Z`) / 1000;
    for (let tick = 0; tick < 4; tick += 1) {
      const now = poll(base, start + tick * 15, temp, vpd);
      hold = stepBandHold(hold, now);
      headlines.push(ask(now, false, hold).text);
      raw.push(ask(now).text);
    }
  }
  const changes = (texts: string[]) => texts.filter((text, index) => index > 0 && text !== texts[index - 1]).length;
  expect(changes(headlines)).toBeLessThanOrEqual(2);
  expect(headlines[0]).toBe(ALL_OK);
  expect(headlines).toContain(OUT_OF_BAND_TEXT);
  expect(changes(raw)).toBeGreaterThanOrEqual(changes(headlines));
});

test("a stale reading outside the band is no verdict: it reads Waiting for fresh data", () => {
  const old = (now: Now): Now => ({ ...now, indoor: { ...now.indoor, temp_f: { value: 84.1, observed_at: secondsAgo(200), reason: null } } });
  expect(band(old)).toMatchObject({ text: STALE_TEXT, muted: true, lastDataAt: secondsAgo(200) });
  expect(readingFresh(fresh(64.8), served("in-band"))).toBe(true);
  expect(readingFresh({ value: 64.8, observed_at: secondsAgo(121), reason: null }, served("in-band"))).toBe(false);
  expect(readingFresh(fresh(null), served("in-band"))).toBe(false);
  expect(band((now) => ({ ...now, freshness: { ...now.freshness, climate: source(150) } })).lastDataAt).toBe(secondsAgo(150));
  expect(band((now) => ({ ...now, indoor: { ...now.indoor, temp_f: fresh(null) } }))).toMatchObject({ text: STALE_TEXT, lastDataAt: null });
  // A missing RH is not stale: RH has no band.
  expect(band((now) => ({ ...now, indoor: { ...now.indoor, rh_pct: fresh(null) } })).text).toBe(ALL_OK);
});

test("row 7 counts the open alerts and a waiting band proposal", () => {
  expect(needsCount({ alerts: { open: 2, critical: 0, warning: 2, info: 0 }, review: null })).toBe(2);
  const proposal = served("review-proposal-waiting");
  expect(proposal.review?.proposal_waiting).toBe(true);
  const only = { ...proposal, alerts: { ...proposal.alerts, open: 0 } };
  expect(ask(only)).toMatchObject({ text: "1 thing needs someone", link: { to: "/review", label: "Review" } });
  expect(ask({ ...only, alerts: { ...only.alerts, open: 1 } })).toMatchObject({ text: "2 things need someone", link: { to: "#needs-you" } });
});

test("row 7 counts what Needs you lists once its alerts read answers, so the headline and the panel agree (B11)", () => {
  const three = { ...served("in-band"), alerts: { open: 3, critical: 0, warning: 3, info: 0 } };
  // API-02 says three open, the list Needs you shows holds none: the headline follows the list.
  expect(nowAnswer({ now: three, failed: false, needs: 0 }).text).toBe(ALL_OK);
  expect(nowAnswer({ now: served("in-band"), failed: false, needs: 2 })).toMatchObject({ row: 7, text: "2 things need someone" });
  // Before the list answers, API-02's count stands.
  expect(nowAnswer({ now: three, failed: false, needs: null }).text).toBe("3 things need someone");
});

test("rows 2 to 4 at their edges: no time without one, the heartbeat limit, and flow that has stopped", () => {
  expect(band((now) => ({ ...now, freshness: { ...now.freshness, ingestor: { observed_at: null, age_s: null, cadence_s: 60, stale: true } } })).text).toBe("Ingestor not running");
  expect(band((now) => ({ ...now, freshness: { ...now.freshness, ingestor: source(180, 180) } })).row).toBe(9);
  expect(band((now) => ({ ...now, freshness: { ...now.freshness, ingestor: source(181, 180) } })).row).toBe(2);
  expect(band((now) => ({ ...now, freshness: { ...now.freshness, climate: { observed_at: null, age_s: null, cadence_s: 60, stale: true } } })).text).toBe("Controller not reporting");
  expect(ask(served("flow-stopped")).text).toBe("1 thing needs someone");
  const flowing = served("flow-valves-closed");
  expect(ask({ ...flowing, leak: { ...flowing.leak, stopped_at: "not a time" } }).row).toBe(4);
});
