// SPDX-License-Identifier: MIT
/**
 * Now's answer to "is the house all right, and what needs me?" (dashboard v2 screens §1 block 1): the first true row of
 * the worst-first table. Pure: it reads the newest API-02 answer and whether the newest API-02 read failed, and states
 * every age at the answer's own `server_time`. It reads the climate law's record (`law`: its requests and the band in
 * use), never a mode label. The sentence uses no codes and reads the same for operators and viewers; it never reads
 * "All OK" while a row above it holds or the read it needs has failed, and before API-02 first answers it claims nothing.
 *
 * 1. The newest API-02 read failed: "Can't reach the greenhouse data" (the shell's banner waits for a second failure).
 * 2. The ingestor heartbeat is stale (older than 180 s): "Ingestor not running since HH:MM".
 * 3. The heartbeat is fresh and the newest climate row is older than 300 s: "Controller not reporting since HH:MM",
 *    with the line that it keeps holding the band on its own.
 * 4. The leak alert is open and flow has not stopped: "Water flowing with every Verdify valve closed".
 * 5. A protection limit is on (the law's `hot` or `cold` request): "Too hot: the hot limit is on" or "Too cold: …".
 * 6. A fresh reading is outside the band the controller is using (`law.band`; the host's band while the law has not
 *    reported): the steady headline "Out of band", and `conditions` says which edge and by how much, temperature first,
 *    each as a plain phrase ("Too hot: 14.1 °F above the high edge (84.1 °F, band 61.2–70 °F)"). With a dwell state
 *    (`stepBandHold`) a reading counts as out only after `BAND_DWELL_S` out, and as back in after the same, so the
 *    headline does not flicker at an edge. The band gauges keep the raw relation.
 * 7. Things that need someone: the open alerts nobody has acknowledged (the one count) and a band proposal waiting for
 *    the owner: "1 thing needs someone".
 * 8. The climate data is stale: "Waiting for fresh data".
 * 9. "All OK".
 *
 * Rows 2 and 3 use the shell's own tests (`heartbeatFresh`, `climateFresh`), so the sentence and the fault banner never
 * disagree. Row 8 holds while API-02 marks the climate source stale, an indoor reading is older than twice the climate
 * cadence at `server_time`, or a reading with a band has no value.
 */
import { formatValue, shortTime } from "./format";
import type { Now, Reading } from "./operator-api";
import { climateFresh, heartbeatFresh } from "./shell";

export type AnswerKind = "unreachable" | "ingestor" | "controller" | "flow" | "limit" | "band" | "needs" | "stale" | "ok";
/** Where the sentence links: the page that explains it. `to` starting with "#" is an anchor on Now itself. */
export type AnswerLink = { readonly to: string; readonly label: string };
export type BandMetric = "temp" | "vpd";
export type BandVerdict = "in" | "above" | "below";
/** Row 6: one reading out of the band, as a plain phrase with its Graphs panel. */
export type BandCondition = { readonly metric: BandMetric; readonly verdict: "above" | "below"; readonly text: string; readonly link: AnswerLink };
export type NowAnswer = {
  /** The row of the table that holds, 1 to 9; 0 while API-02 has not answered and nothing is known. */
  readonly row: number;
  readonly kind: AnswerKind | "loading";
  readonly text: string;
  /** A plain line under the headline that is not a condition (row 3: the controller holds the band on its own). */
  readonly detail: string | null;
  readonly link: AnswerLink | null;
  /** Row 6: every reading out of the band, temperature then VPD; empty on every other row. */
  readonly conditions: readonly BandCondition[];
  /** Rows 1 to 3 and 8 (and loading): no verdict anywhere, and the values muted with STALE. */
  readonly muted: boolean;
  /** Rows 1 to 3: the source is not reporting or out of reach; the freshness dot reads off. */
  readonly notReporting: boolean;
  /** Rows 1 to 3: the equipment state is unknown since this instant; null when there is none. */
  readonly unknownSince: string | null;
  /** Row 8: when the data the page still shows was read. Null on every other row, or with no time. */
  readonly lastDataAt: string | null;
};
export type AnswerInput = {
  /** The newest API-02 answer, kept through failures; null before the first. */
  readonly now: Now | null;
  /** The newest API-02 read failed. */
  readonly failed: boolean;
  /** The dwell state over the polls so far (`stepBandHold`); without it row 6 reads each poll as it is. */
  readonly hold?: BandHold | null;
};

export const ALL_OK = "All OK";
export const UNREACHABLE_TEXT = "Can't reach the greenhouse data";
export const LOADING_TEXT = "Checking the greenhouse…";
export const STALE_TEXT = "Waiting for fresh data";
export const OUT_OF_BAND_TEXT = "Out of band";
export const HOT_TEXT = "Too hot: the hot limit is on";
export const COLD_TEXT = "Too cold: the cold limit is on";
export const ALONE_TEXT = "It keeps holding the band on its own.";
/** A reading counts as out of band after 2 min out, and as back in after 2 min in (Jason 2026-11-05, #1338). */
export const BAND_DWELL_S = 120;
/** A climate source is stale past twice its cadence (the `v_sensor_staleness` rule); the climate cadence is 60 s. */
const DEFAULT_CADENCE_S = 60;

const validTime = (value: string | null | undefined): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const since = (value: string | null) => (value ? ` since ${shortTime(value)}` : "");
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const hasValue = (reading: Reading) => finite(reading.value);

const answer = (row: number, kind: AnswerKind, text: string, fields: Partial<Omit<NowAnswer, "row" | "kind" | "text">> = {}): NowAnswer => ({
  row, kind, text, detail: null, link: null, conditions: [], muted: false, notReporting: false, unknownSince: null, lastDataAt: null, ...fields,
});
export const LOADING: NowAnswer = { row: 0, kind: "loading", text: LOADING_TEXT, detail: null, link: null, conditions: [], muted: true, notReporting: false, unknownSince: null, lastDataAt: null };

function ageAtServer(observedAt: string | null | undefined, now: Pick<Now, "server_time">): number | null {
  if (!validTime(observedAt) || !validTime(now.server_time)) return null;
  return Math.max(0, (Date.parse(now.server_time) - Date.parse(observedAt)) / 1000);
}
const staleAfterS = (now: Pick<Now, "freshness">) => {
  const cadence = now.freshness.climate.cadence_s;
  return 2 * (finite(cadence) && cadence > 0 ? cadence : DEFAULT_CADENCE_S);
};
/** A reading with a value no older than twice the climate cadence at `server_time`. */
export function readingFresh(reading: Reading, now: Pick<Now, "server_time" | "freshness">): boolean {
  const age = ageAtServer(reading.observed_at, now);
  return hasValue(reading) && age !== null && age <= staleAfterS(now);
}

// The band reads as it is set: whole degrees drop ".0" ("61.2–70 °F"); kPa keeps 2 dp.
const WHOLE_OR_ONE = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const TWO = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NBSP = " ";
const bound = (value: number, unit: string) => (unit === "kPa" ? TWO : WHOLE_OR_ONE).format(value).replace("-", "−");
/** "61.2–70 °F", "0.45–0.80 kPa"; null without both edges. */
export function bandText(low: number | null | undefined, high: number | null | undefined, unit: string): string | null {
  if (!finite(low) || !finite(high)) return null;
  return `${bound(low, unit)}–${bound(high, unit)}${NBSP}${unit}`;
}

export type Edges = { readonly low: number; readonly high: number };
export type HouseBand = {
  readonly temp: Edges | null;
  readonly vpd: Edges | null;
  /** controller: the band the law is using (`law.band`); host: the host's band while the law has not reported. */
  readonly source: "controller" | "host" | null;
};
const edges = (low: number | null | undefined, high: number | null | undefined): Edges | null => (finite(low) && finite(high) ? { low, high } : null);
/** The one house band: the controller's (`law.band`) when the law reports it, else the host's (`band`). */
export function houseBand(now: Pick<Now, "law" | "band">): HouseBand {
  const law = now.law?.band;
  if (law && (edges(law.temp_low_f, law.temp_high_f) || edges(law.vpd_low_kpa, law.vpd_high_kpa))) {
    return { temp: edges(law.temp_low_f, law.temp_high_f), vpd: edges(law.vpd_low_kpa, law.vpd_high_kpa), source: "controller" };
  }
  const temp = edges(now.band.temp_f.low, now.band.temp_f.high), vpd = edges(now.band.vpd_kpa.low, now.band.vpd_kpa.high);
  return { temp, vpd, source: temp || vpd ? "host" : null };
}

type Metric = { readonly metric: BandMetric; readonly reading: Reading; readonly band: Edges | null; readonly unit: string; readonly above: string; readonly below: string; readonly anchor: string };
const metrics = (now: Now): Metric[] => {
  const band = houseBand(now);
  return [
    { metric: "temp", reading: now.indoor.temp_f, band: band.temp, unit: "°F", above: "Too hot", below: "Too cold", anchor: "temperature" },
    { metric: "vpd", reading: now.indoor.vpd_kpa, band: band.vpd, unit: "kPa", above: "Air too dry", below: "Air too damp", anchor: "vpd" },
  ];
};
const BAND_METRICS: readonly BandMetric[] = ["temp", "vpd"];

/** A value against edges: "above", "below" or "in". */
export const verdictOf = (value: number, band: Edges): BandVerdict => (value > band.high ? "above" : value < band.low ? "below" : "in");

/** Each reading's relation to the band now: "above" or "below" only for a fresh reading with a band; else "in". */
export function rawVerdicts(now: Now): Readonly<Record<BandMetric, BandVerdict>> {
  const out: Record<BandMetric, BandVerdict> = { temp: "in", vpd: "in" };
  for (const { metric, reading, band } of metrics(now)) {
    if (band && finite(reading.value) && readingFresh(reading, now)) out[metric] = verdictOf(reading.value, band);
  }
  return out;
}

/** The dwell state behind row 6: per reading, the verdict that holds and a different one waiting since `since` (epoch s). */
export type BandHold = {
  readonly at: number;
  readonly metrics: Readonly<Record<BandMetric, { readonly held: BandVerdict; readonly next: BandVerdict | null; readonly since: number }>>;
};

/** One poll's step of the dwell state. Pure and idempotent: the same answer (or an older one) leaves it as it is. */
export function stepBandHold(prev: BandHold | null | undefined, now: Now | null | undefined, dwellS = BAND_DWELL_S): BandHold | null {
  if (!now || !validTime(now.server_time)) return prev ?? null;
  const at = Date.parse(now.server_time) / 1000;
  if (prev && at <= prev.at) return prev;
  const raw = rawVerdicts(now);
  const next = {} as Record<BandMetric, BandHold["metrics"][BandMetric]>;
  for (const metric of BAND_METRICS) {
    const was = prev?.metrics[metric];
    const verdict = raw[metric];
    if (!was || verdict === was.held) next[metric] = { held: verdict, next: null, since: at };
    else if (was.next === verdict) next[metric] = at - was.since >= dwellS ? { held: verdict, next: null, since: at } : was;
    else next[metric] = { held: was.held, next: verdict, since: at };
  }
  return { at, metrics: next };
}

/** Row 6: every fresh reading out of the band, which edge and by how much, temperature then VPD. */
export function bandConditions(now: Now, hold?: BandHold | null): BandCondition[] {
  const raw = rawVerdicts(now);
  const out: BandCondition[] = [];
  for (const { metric, reading, band, unit, above, below, anchor } of metrics(now)) {
    if (!band || !finite(reading.value) || !readingFresh(reading, now)) continue;
    const verdict = hold ? hold.metrics[metric].held : raw[metric];
    if (verdict === "in") continue;
    const by = verdict === "above" ? reading.value - band.high : band.low - reading.value;
    // A held verdict whose reading has come back inside reads without a distance until the dwell lets it go.
    const distance = by > 0 ? `${formatValue(by, unit)} ${verdict === "above" ? "above the high edge" : "below the low edge"} ` : "";
    const text = `${verdict === "above" ? above : below}: ${distance}(${formatValue(reading.value, unit)}, band ${bandText(band.low, band.high, unit)})`;
    out.push({ metric, verdict, text, link: { to: `/graphs?range=24h#${anchor}`, label: "Graphs" } });
  }
  return out;
}

/** Row 8: when the data the page still shows was read, when it is stale; null when fresh. */
function staleness(now: Now): { at: string | null } | null {
  const readings = [now.indoor.temp_f, now.indoor.vpd_kpa, now.indoor.rh_pct];
  const old = readings.filter((reading) => hasValue(reading) && !readingFresh(reading, now));
  const missing = metrics(now).some(({ reading, band }) => band !== null && !hasValue(reading));
  if (!now.freshness.climate.stale && !old.length && !missing) return null;
  const times = old.map((reading) => reading.observed_at).filter(validTime).sort((a, b) => Date.parse(a) - Date.parse(b));
  const climate = now.freshness.climate.stale && validTime(now.freshness.climate.observed_at) ? now.freshness.climate.observed_at : null;
  return { at: times[0] ?? climate };
}

/** Row 7's count: the open alerts nobody has acknowledged, and a band proposal waiting for the owner. */
export function needsCount(now: Pick<Now, "alerts" | "review">): number {
  const open = finite(now.alerts.open) ? Math.max(0, now.alerts.open) : 0;
  return open + (now.review?.proposal_waiting ? 1 : 0);
}

/** The first row of the worst-first table that holds. */
export function nowAnswer({ now, failed, hold }: AnswerInput): NowAnswer {
  if (failed) return answer(1, "unreachable", UNREACHABLE_TEXT, { muted: true, notReporting: true, unknownSince: validTime(now?.server_time) ? now.server_time : null });
  if (!now) return LOADING;
  const { ingestor, climate } = now.freshness;
  if (!heartbeatFresh(ingestor)) {
    const at = validTime(ingestor.observed_at) ? ingestor.observed_at : null;
    return answer(2, "ingestor", `Ingestor not running${since(at)}`, { detail: ALONE_TEXT, link: { to: "/system/data", label: "Data" }, muted: true, notReporting: true, unknownSince: at });
  }
  if (!climateFresh(climate)) {
    const at = validTime(climate.observed_at) ? climate.observed_at : null;
    return answer(3, "controller", `Controller not reporting${since(at)}`, { detail: ALONE_TEXT, link: { to: "/system/controller", label: "Controller" }, muted: true, notReporting: true, unknownSince: at });
  }
  const { leak } = now;
  if (finite(leak.alert_id) && !validTime(leak.stopped_at)) {
    return answer(4, "flow", "Water flowing with every Verdify valve closed", { link: { to: `/activity?alert=${leak.alert_id}`, label: "Open the alert" } });
  }
  const requests = now.law?.requests ?? [];
  if (requests.includes("hot")) return answer(5, "limit", HOT_TEXT, { link: { to: "/climate", label: "Climate law" } });
  if (requests.includes("cold")) return answer(5, "limit", COLD_TEXT, { link: { to: "/climate", label: "Climate law" } });
  const conditions = bandConditions(now, hold);
  if (conditions.length) return answer(6, "band", OUT_OF_BAND_TEXT, { conditions });
  const count = needsCount(now);
  if (count > 0) {
    const onlyProposal = now.review?.proposal_waiting && count === 1;
    return answer(7, "needs", count === 1 ? "1 thing needs someone" : `${count} things need someone`, { link: onlyProposal ? { to: "/review", label: "Review" } : { to: "#needs-you", label: "Needs you" } });
  }
  const stale = staleness(now);
  if (stale) return answer(8, "stale", STALE_TEXT, { muted: true, lastDataAt: stale.at });
  return answer(9, "ok", ALL_OK);
}
