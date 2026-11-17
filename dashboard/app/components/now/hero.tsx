// SPDX-License-Identifier: MIT
/**
 * Now's hero (dashboard v2 screens §1 blocks 1 and 10): the answer as the page's heading, worst first (`now-answer.ts`),
 * never a link, with the out-of-band readings (which edge and by how much) or where the answer is explained as one plain
 * line under it. Then two band gauges, temperature and VPD, against the band the controller is using (`law.band`; the
 * host's band while the law has not reported), each with the reading and its relation in words; RH and the dew point as
 * plain values; the outdoor temperature with its source; and when it was updated.
 *
 * "All readings" (block 10) is the disclosure under it: every reading with its source and time, the law's record as
 * reported, each source's freshness, and the five-minute AI snapshot as a labelled paragraph.
 *
 * Honesty: rows 1 to 3 and 8 of the answer mute the values with STALE and show no relation, and the gauges say when
 * their numbers were read ("As of 10:28"). While the dashboard API is down the gauges do not render. A null reading is
 * "—" with its reason, never 0.
 */
import { Fragment, useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { duration, formatNumber, formatValue, localDate } from "../../lib/format";
import { LOADING_TEXT, houseBand, type BandMetric, type Edges, type NowAnswer } from "../../lib/now-answer";
import type { Freshness, LawView, Now, Reading, Series } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { useApiDown } from "../../lib/session";
import { words } from "../../lib/words";
import { Badge } from "../badge";
import { Button } from "../button";
import { LocalTime, cls } from "../common";
import { BandBar, bandRelationWords, rangeWords } from "../data/band-bar";
import { AgeLabel, FreshnessDot, useNow } from "../freshness";
import { Kv, type KvItem } from "../kv";
import { Term } from "../term";
import { HOUSE_KEYS, rangeSince, readingText, readingsAsOf, todayStartS } from "./climate";
import { NowSnapshot } from "./snapshot";

/** The eyebrow: the time zone is stated once, in the footer and on axes. */
export const NOW_EYEBROW = "Greenhouse · Longmont";
const NO_ANSWER = "No answer from the greenhouse data";
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const validTime = (value: string | null | undefined): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
/** The hashes that open "All readings": `#data` and `#readings`. */
const READINGS_HASHES = new Set(["#data", "#readings"]);
export const READINGS_ID = "readings";
const CONDITION_NAMES: Readonly<Record<BandMetric, string>> = { temp: "temperature", vpd: "VPD" };

/** The plain lines under the headline: each out-of-band reading with "Graphs ›", the answer's own line, or its link. */
export function AnswerDetail({ answer }: { answer: NowAnswer }) {
  if (answer.conditions.length) {
    return <p className="now-condition" data-conditions="">
      {answer.conditions.map((condition, index) => <Fragment key={condition.metric}>
        {index > 0 && " · "}
        <span className="now-condition-item" data-condition={condition.metric}>{condition.text}</span>{" "}
        <Link className="now-condition-link" to={condition.link.to}>{condition.link.label}<span className="screen-reader">: {CONDITION_NAMES[condition.metric]}</span>{" ›"}</Link>
      </Fragment>)}
    </p>;
  }
  const link = answer.link && !answer.link.to.startsWith("#") ? answer.link : null;
  if (!answer.detail && !link) return null;
  return <p className="now-condition">
    {answer.detail && <span data-answer-detail="">{answer.detail}</span>}
    {answer.detail && link && " "}
    {link && <Link className="now-condition-link" to={link.to}>{link.label}{" ›"}</Link>}
  </p>;
}

/** Where the band comes from, in words: the controller's, or the host's while the law has not reported. */
export function bandSourceText(now: Pick<Now, "law" | "band">): string {
  const band = houseBand(now);
  if (band.source === "controller") return now.law?.band_repaired ? "Band in use by the controller, repaired by it" : "Band in use by the controller";
  if (band.source === "host") return "The host's band: the controller has not reported its own";
  return "No band reported";
}

type Gauge = { readonly key: BandMetric; readonly name: string; readonly unit: string; readonly reading: Reading; readonly band: Edges | null; readonly today: Edges | null; readonly href: string };
function gauges(now: Now, day: Series | null, since: number): Gauge[] {
  const band = houseBand(now);
  return [
    { key: "temp", name: "Temperature", unit: "°F", reading: now.indoor.temp_f, band: band.temp, today: rangeSince(day, HOUSE_KEYS.temp, since), href: "/graphs?range=24h#temperature" },
    { key: "vpd", name: "VPD", unit: "kPa", reading: now.indoor.vpd_kpa, band: band.vpd, today: rangeSince(day, HOUSE_KEYS.vpd, since), href: "/graphs?range=24h#vpd" },
  ];
}

/** The two gauges: each its name, the bar, the reading and its relation in words ("in band", "0.4 °F below"). */
function Gauges({ rows, muted }: { rows: readonly Gauge[]; muted: boolean }) {
  return <ul className="now-bands" aria-label="Indoor climate against the band">
    {rows.map((row) => {
      const missing = !finite(row.reading.value);
      const relation = muted || missing ? null : bandRelationWords(row.reading.value, row.band, row.unit);
      const off = relation !== null && relation !== "in band";
      return <li key={row.key} className={cls("now-band", off && "now-band-off")} data-tile={row.key}>
        <Link className="now-band-label" to={row.href}>{row.key === "vpd" ? <Term id="vpd" /> : row.name}<span className="screen-reader"> in Graphs</span></Link>
        <span className="now-band-bar"><BandBar label={row.name} unit={row.unit} value={missing ? null : row.reading.value} band={row.band} today={row.today} hero decorative={false} state={muted ? "stale" : "ready"} /></span>
        <span className={cls("now-band-value", muted && "value-muted")}>{readingText(row.reading, row.unit)}</span>
        <span className="now-band-meta">
          {missing ? <span className="now-band-why">{row.reading.reason || "No reading"}</span>
            : <>{relation && <span className={cls(off && "now-off")} data-relation="">{relation}</span>}
              <span className="now-band-range">{relation && " · "}{row.band ? `band ${rangeWords(row.band.low, row.band.high, row.unit)}` : "no band reported"}</span></>}
        </span>
      </li>;
    })}
  </ul>;
}

/** RH, the dew point and outdoor with its source: plain values. */
function PlainValues({ now, law, muted }: { now: Now; law: LawView | null; muted: boolean }) {
  const source = now.outdoor.source ?? law?.inputs.outdoor.source ?? null;
  const dew = law?.inputs.dew_point_f ?? null;
  return <dl className={cls("now-plain", muted && "value-muted")}>
    <div data-plain="rh"><dt>RH</dt><dd>{readingText(now.indoor.rh_pct, "%")}</dd></div>
    <div data-plain="dew"><dt>Dew point</dt><dd>{formatValue(finite(dew) ? dew : null, "°F")}</dd></div>
    <div data-plain="outdoor"><dt>Outdoor</dt><dd>{readingText(now.outdoor.temp_f, "°F")}{source && <span className="meta"> · {words("outdoor_source", source)}</span>}</dd></div>
  </dl>;
}

function at(value: string | null | undefined): ReactNode {
  return validTime(value) ? <> at <LocalTime at={value} /></> : null;
}
function readingItem(term: string, reading: Reading, unit: string): KvItem {
  return { key: term, term, value: finite(reading.value) ? <>{formatValue(reading.value, unit)}{at(reading.observed_at)}</> : null, reason: reading.reason || "No reading" };
}
function sourceItem(term: string, source: Freshness): KvItem {
  const value = validTime(source.observed_at) && finite(source.age_s)
    ? <><LocalTime at={source.observed_at} /> ({duration(Math.max(0, source.age_s))} old{source.stale ? ", stale" : ""})</>
    : null;
  return { key: term, term, value, reason: "never seen" };
}
const codes = (items: readonly string[], family: "law_lane", prefix: string) => items.map((item) => words(family, `${prefix}.${item}`)).join(", ");

/** The law's record as reported: what it asks for and wants, the drying decision with its price, the band edges. */
export function lawItems(law: NonNullable<Now["law"]>): KvItem[] {
  const band = law.band;
  const cost = law.drying_cost_kwh_per_kg, limit = law.drying_cost_limit_kwh_per_kg;
  const price = finite(cost) ? `${formatNumber(cost, 2)} kWh/kg` : "no price";
  const cap = finite(limit) ? `${formatNumber(limit, 2)} kWh/kg` : "not reported";
  return [
    { key: "law_at", term: "Law record", value: validTime(law.observed_at) ? <LocalTime at={law.observed_at} /> : null, reason: "no time" },
    { key: "law_requests", term: "Asked for", value: law.requests.length ? codes(law.requests, "law_lane", "request") : null, reason: "nothing" },
    { key: "law_latches", term: "Wanted", value: law.latches.length ? codes(law.latches, "law_lane", "latch") : null, reason: "nothing" },
    {
      key: "law_drying", term: "Drying",
      value: `${words("drying_state", law.drying)}${law.drying_refused_reason ? `: ${words("drying_refusal", law.drying_refused_reason)}` : ""} · ${price}, limit ${cap}`,
    },
    {
      key: "law_band", term: "Band edges",
      value: band && finite(band.temp_low_f) && finite(band.temp_high_f) && finite(band.vpd_low_kpa) && finite(band.vpd_high_kpa)
        ? `${rangeWords(band.temp_low_f, band.temp_high_f, "°F")} · ${rangeWords(band.vpd_low_kpa, band.vpd_high_kpa, "kPa")}${law.band_repaired ? " · repaired by the controller" : ""}` : null,
      reason: "not reported",
    },
  ];
}

/** Every reading with its source and time, the law's record, and each source's freshness. */
function AllReadings({ now }: { now: Now }) {
  const { freshness, writer } = now;
  const items: KvItem[] = [
    readingItem("Indoor temperature", now.indoor.temp_f, "°F"),
    readingItem("Indoor VPD", now.indoor.vpd_kpa, "kPa"),
    readingItem("Indoor RH", now.indoor.rh_pct, "%"),
    readingItem(`Outdoor temperature (${words("outdoor_source", now.outdoor.source ?? "unknown")})`, now.outdoor.temp_f, "°F"),
    readingItem(`Outdoor RH (${words("outdoor_source", now.outdoor.source ?? "unknown")})`, now.outdoor.rh_pct, "%"),
    ...(now.law ? lawItems(now.law) : [{ key: "law", term: "Law record", value: null, reason: "not reported in the last 2 minutes" }]),
    sourceItem("Newest climate row", freshness.climate),
    sourceItem("Ingestor heartbeat", freshness.ingestor),
    sourceItem("Newest diagnostics row", freshness.diagnostics),
    sourceItem("Newest settings readback", freshness.readback),
    {
      key: "writer", term: "Settings sent",
      value: validTime(writer.last_at) && finite(writer.age_s) ? <><LocalTime at={writer.last_at} /> ({duration(Math.max(0, writer.age_s))} old)</> : null, reason: "none on record",
    },
  ];
  return <Kv items={items} className="now-readings-list" />;
}

/** Over muted gauges: when their numbers were read, "As of 10:28" (with the date when not today). */
function GaugesAsOf({ readings, clock }: { readings: readonly Reading[]; clock: number }) {
  const when = readingsAsOf(readings);
  if (!when) return null;
  return <p className="now-bands-asof">As of <LocalTime at={when} date={localDate(when) !== localDate(new Date(clock).toISOString())} /></p>;
}

/** The hero before API-02 first answers: the answer claims nothing, and every part keeps its height. */
function HeroLoading() {
  const headingId = useId();
  return <section className="hero now-hero hero-loading" aria-labelledby={headingId} aria-busy="true">
    <div className="now-hero-main">
      <span className="eyebrow">{NOW_EYEBROW}</span>
      <h1 id={headingId} className="hero-answer">{LOADING_TEXT}</h1>
      <div className="skeleton now-skeleton-value" aria-hidden="true" />
    </div>
    <div className="now-hero-climate"><div className="skeleton now-skeleton-bands" aria-hidden="true" /></div>
  </section>;
}

/** Opens "All readings" and brings it into view when the page's hash asks for it (`#data`, `#readings`). */
function useReadingsHash(ref: { readonly current: HTMLDetailsElement | null }, drawn: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    const details = ref.current;
    if (!drawn || !details || !READINGS_HASHES.has(hash)) return;
    details.open = true;
    details.scrollIntoView?.({ block: "nearest" });
  }, [hash, drawn, ref]);
}

export type NowHeroProps = {
  /** The newest API-02 answer (the shell's poll), kept through failures; null before the first. */
  readonly now: Now | null;
  readonly answer: NowAnswer;
  /** The day read (API-04, the last 25 h): today's low and high. */
  readonly day: PanelRead<Series>;
  /** API-30: the dew point and the outdoor source; null while it has not answered. */
  readonly law: PanelRead<LawView>;
  /** Reads API-02 again (row 1's Retry). */
  readonly onRetry: () => void;
};

export function NowHero({ now, answer, day, law, onRetry }: NowHeroProps) {
  const headingId = useId();
  const clock = useNow();
  const apiDown = useApiDown();
  const readings = useRef<HTMLDetailsElement>(null);
  useReadingsHash(readings, answer.kind !== "loading" && now !== null);
  if (answer.kind === "loading") return <HeroLoading />;
  const muted = answer.muted;
  const temp = now?.indoor.temp_f ?? null;
  const rows = now && !apiDown ? gauges(now, day.failed ? null : day.data, todayStartS(clock)) : null;
  const openReadings = (event: MouseEvent<HTMLAnchorElement>) => {
    const details = readings.current;
    if (!details) return;
    details.open = true;
    if (window.location.hash === "#readings") { event.preventDefault(); details.scrollIntoView?.({ block: "nearest" }); }
  };
  return <section className={cls("hero now-hero", !rows && "now-hero-plain")} aria-labelledby={headingId} data-answer={answer.kind}>
    <div className="now-hero-main">
      <span className="eyebrow">{NOW_EYEBROW}</span>
      <h1 id={headingId} className="hero-answer">{answer.text}</h1>
      <AnswerDetail answer={answer} />
      <p className="hero-meta now-fresh">
        <FreshnessDot stale={muted} notReporting={answer.notReporting} />
        <Link id="data" className="now-fresh-link" to={`#${READINGS_ID}`} data-tile="data" onClick={openReadings}>
          <AgeLabel observedAt={temp?.observed_at ?? null} stale={muted || answer.notReporting} />
        </Link>
        {muted && now && <Badge kind="stale" />}
        {answer.row === 1 && <Button onClick={onRetry}>Retry</Button>}
      </p>
      {!now && <p className="hero-meta">{NO_ANSWER}</p>}
    </div>
    {rows && now && <div className="now-hero-climate" data-stale={muted ? "" : undefined}>
      {muted && <GaugesAsOf readings={[now.indoor.temp_f, now.indoor.vpd_kpa]} clock={clock} />}
      <Gauges rows={rows} muted={muted} />
      <p className="meta now-band-source" data-band-source={houseBand(now).source ?? "none"}><Term id="band_in_force">{bandSourceText(now)}</Term></p>
      <PlainValues now={now} law={law.failed ? null : law.data} muted={muted} />
    </div>}
    {now && <details ref={readings} className="now-readings" id={READINGS_ID}>
      <summary>All readings<span className="now-readings-hint"> · sources, times and the law's record</span></summary>
      <NowSnapshot snapshot={now.snapshot} clock={clock} muted={muted || apiDown} />
      <AllReadings now={now} />
    </details>}
  </section>;
}
