// SPDX-License-Identifier: MIT
/**
 * Probes on Now (dashboard v2 screens §1 block 9): the four wall probes and the case probe, each with its temperature,
 * its VPD and a 24 h VPD sparkline, each against the one house band (the band the controller is using). There is no
 * zone band and no stand-in: a probe that has not reported reads "—" with its reason, never a neighbour's value or 0.
 *
 * Reads: API-04 over the last 15 minutes for the wall probes' temperature and VPD (`PROBE_NOW_KEYS`) with API-03 for
 * their cadences; the day read (API-04 over 25 h, passed in) for the wall sparklines; the case read (the case probe's
 * temperature and RH, passed in), whose VPD the page works out from them and says so. Each probe opens its zone's charts.
 */
import { Link } from "react-router";
import { formatValue } from "../lib/format";
import { houseBand } from "../lib/now-answer";
import type { Now, Series } from "../lib/operator-api";
import { READ_INTERVAL_MS, panelRead, useApiRead, useSeriesWindowRead, type PanelRead } from "../lib/queries";
import { useApiDown } from "../lib/session";
import { ZONE_WINDOW_S, keyValue, type ZoneData, type ZoneValue } from "../lib/zone-source";
import { Badge } from "./badge";
import { cls } from "./common";
import { bandPosition, bandRelationWords, rangeWords, type Range } from "./data/band-bar";
import { Sparkline } from "./data/sparkline";
import { CASE_KEYS, PROBES, PROBE_NOW_KEYS, SPARK_S, caseVpdSince, newestBucket, probeTempKey, probeVpdKey, valuesSince, vpdFrom, type ProbeId } from "./now/climate";
import { Panel, type PanelState } from "./panel";
import { Term } from "./term";

export const PROBES_ID = "probes";
const NOT_REPORTED = "not reported";
/** The case read's newest bucket counts as current within 20 min of its end. */
const CASE_FRESH_S = 20 * 60;

export type ProbeReading = { readonly temp: ZoneValue; readonly vpd: ZoneValue; readonly spark: readonly (number | null)[]; readonly derived: boolean };

/** The case probe's current temperature and its VPD from temperature and RH, from the case read's newest buckets. */
export function caseReading(series: Series | null | undefined, sparkFrom: number): ProbeReading {
  const temp = newestBucket(series, CASE_KEYS[0]), rh = newestBucket(series, CASE_KEYS[1]);
  const serverS = series ? Date.parse(series.server_time) / 1000 : Number.NaN;
  const fresh = (end: number) => Number.isFinite(serverS) && serverS - end <= CASE_FRESH_S;
  const value = (sample: { value: number; end: number } | null): ZoneValue => (!sample ? { value: null, stale: false, reason: NOT_REPORTED } : { value: sample.value, stale: !fresh(sample.end), reason: fresh(sample.end) ? null : "last data over 20 min old" });
  const tempValue = value(temp);
  const vpd = temp && rh ? vpdFrom(temp.value, rh.value) : null;
  return {
    temp: tempValue,
    vpd: vpd === null ? { value: null, stale: false, reason: NOT_REPORTED } : { value: vpd, stale: tempValue.stale, reason: tempValue.reason },
    spark: caseVpdSince(series, sparkFrom),
    derived: true,
  };
}

/** A wall probe's own temperature and VPD from the 15-minute read, and its 24 h VPD from the day read. */
export function wallReading(id: ProbeId, data: ZoneData, day: Series | null, sparkFrom: number): ProbeReading {
  return { temp: keyValue(probeTempKey(id), data), vpd: keyValue(probeVpdKey(id), data), spark: valuesSince(day, probeVpdKey(id), sparkFrom), derived: false };
}

const ZONE_OF: Readonly<Partial<Record<ProbeId, string>>> = { north: "north", east: "east", south: "south", west: "west" };

function Probe({ id, name, reading, band, sparkState }: { id: ProbeId; name: string; reading: ProbeReading; band: Range | null; sparkState: "ready" | "loading" | "error" | "stale" }) {
  const apiDown = useApiDown();
  const { temp, vpd } = reading;
  const position = vpd.stale || apiDown ? null : bandPosition(vpd.value, band);
  const relation = position === null ? null : bandRelationWords(vpd.value, band, "kPa");
  const off = position === "above" || position === "below";
  const zone = ZONE_OF[id];
  return <li className={cls("now-zone", off && "now-zone-off")} data-probe={id}>
    <div className="now-zone-head">
      <h3 className="now-zone-name">{zone ? <Link className="now-zone-link" to={`/graphs/zones?zone=${zone}`}>{name}<span className="screen-reader">: open its charts</span></Link> : name}</h3>
      {reading.derived && <span className="now-zone-tag" data-probe-tag="derived">VPD worked out from its temperature and RH</span>}
    </div>
    <p className="now-zone-values">
      <span className={cls("now-zone-value", temp.stale && "value-muted")} data-tile="temp">{formatValue(temp.value, "°F")}</span>
      <span className={cls("now-zone-value", vpd.stale && "value-muted")} data-tile="vpd">{formatValue(vpd.value, "kPa")}</span>
      {(temp.stale || vpd.stale) && <Badge kind="stale" />}
    </p>
    <Sparkline values={reading.spark} token="vpd" band={band} size="tile" label={`${name} VPD over the last 24 h`} state={sparkState} />
    <p className="now-zone-meta meta">
      {relation && <><span className={cls(off && "now-off")} data-relation="">{relation}</span> · </>}
      <Term id="band">band</Term> {band ? rangeWords(band.low, band.high, "kPa") : "not reported"}
      {vpd.value === null && vpd.reason && <> · {vpd.reason}</>}
      {vpd.stale && vpd.reason && <> · {vpd.reason}</>}
    </p>
  </li>;
}

export type ProbesProps = {
  readonly now: Now | null;
  /** The day read (API-04 over the last 25 h): the wall probes' 24 h VPD. */
  readonly day: PanelRead<Series>;
  /** The case read (API-04 over the last 25 h): the case probe's temperature and RH. */
  readonly caseRead: PanelRead<Series>;
};

export function Probes({ now, day, caseRead }: ProbesProps) {
  const registry = panelRead(useApiRead("API-03", {}, { intervalMs: READ_INTERVAL_MS.zones }));
  const current = panelRead(useSeriesWindowRead(PROBE_NOW_KEYS, ZONE_WINDOW_S));
  const failed = (registry.failed && !registry.data) || (current.failed && !current.data);
  const state: PanelState = failed ? "error" : registry.pending || current.pending || !now ? "loading" : "ready";
  const retry = () => { registry.retry(); current.retry(); day.retry(); caseRead.retry(); };
  const data: ZoneData = { series: [current.data], metrics: registry.data?.items ?? [], lines: null };
  const series = day.failed ? null : day.data;
  const end = series ? Date.parse(series.to) / 1000 : Number.NaN;
  const sparkFrom = Number.isFinite(end) ? end - SPARK_S : Number.POSITIVE_INFINITY;
  const vpd = now ? houseBand(now).vpd : null;
  const wallSpark = day.failed && !series ? "error" : series ? "ready" : "loading";
  const caseSeries = caseRead.failed ? null : caseRead.data;
  const caseEnd = caseSeries ? Date.parse(caseSeries.to) / 1000 : Number.NaN;
  const caseSpark = caseRead.failed && !caseSeries ? "error" : caseSeries ? "ready" : "loading";
  return <Panel id={PROBES_ID} title="Probes" thing="the probes" state={state} reserve="md" onRetry={retry} errorText="Couldn't load the probes."
    link={{ to: "/graphs/zones", label: <>Zones<span className="screen-reader"> in Graphs</span></> }}>
    <p className="meta now-probes-note">Each probe against the one house band.</p>
    <ul className="now-zones">
      {PROBES.map((probe) => probe.id === "case"
        ? <Probe key={probe.id} id={probe.id} name={probe.name} band={vpd} sparkState={caseSpark} reading={caseRead.failed && !caseSeries
          ? { temp: { value: null, stale: false, reason: NOT_REPORTED }, vpd: { value: null, stale: false, reason: NOT_REPORTED }, spark: [], derived: true }
          : caseReading(caseSeries, Number.isFinite(caseEnd) ? caseEnd - SPARK_S : Number.POSITIVE_INFINITY)} />
        : <Probe key={probe.id} id={probe.id} name={probe.name} band={vpd} sparkState={wallSpark} reading={wallReading(probe.id, data, series, sparkFrom)} />)}
    </ul>
  </Panel>;
}
