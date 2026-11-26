// SPDX-License-Identifier: MIT
import { useEffect, useMemo } from "react";
import { ThresholdSeries } from "../../charts/threshold-series";
import { formatValue, shortDateTime } from "../../lib/format";
import { apiGet, type MetricDef, type Series, type SoilTarget } from "../../lib/operator-api";
import { READ_INTERVAL_MS } from "../../lib/queries";
import { usePolledQuery } from "../../lib/use-current";
import { StatusBadge } from "../badge";
import { agoDuration, useClockValue, useServerSkew } from "../freshness";
import { EmptyState, Panel, type PanelState } from "../panel";
import {
  SOIL_MEASURES, SOIL_NOW_S, SOIL_WINDOW_S, moistureLine, newestReading, probeState, probeWords, rangeRelation, readingOlder, soilKeys, soilValue, zoneLabel,
  type ProbeState, type RangeRelation, type SoilMeasure,
} from "./soil-model";
import { SoilRange } from "./soil-targets";

/** What a zone tells the page for its status line. */
export type ZoneReport = { readonly zone: string; readonly state: ProbeState; readonly relation: RangeRelation };

/**
 * API-04 for `keys` over the last `seconds`, ending at each poll's own moment on the server's clock (as the shared window
 * reads do); null with no key, since API-04 refuses an empty list.
 */
function useSoilSeries(keys: readonly string[], seconds: number) {
  const skewMs = useServerSkew();
  return usePolledQuery<Series | null>(["api", "API-04", { last_s: seconds, metric: keys }], (signal) => {
    if (!keys.length) return Promise.resolve(null);
    const to = Date.now() - skewMs;
    return apiGet("API-04", { metric: [...keys], from: new Date(to - seconds * 1000).toISOString(), to: new Date(to).toISOString() }, { signal });
  }, READ_INTERVAL_MS.zones);
}

/** The unit each measure reads in: the registry's, else its usual one. */
const unitOf = (metric: Pick<MetricDef, "unit"> | undefined) => metric?.unit ?? "";

/**
 * One probe zone on Water → Soil (screens section 3.4, parity SO-01 to SO-03): the answer first (where the moisture sits
 * against the range, as a badge), then the probe measurements with their ages (API-04, a 3-hour
 * window at minute resolution), a 7-day chart of moisture against the range's wilt, low and high lines, the range with
 * Edit for an operator (API-SOIL-01, API-SOIL-02), and when the probe last answered. A probe silent for 2 hours, or with
 * nothing in 7 days, says so and is not drawn; a measure the probe does not have is left out.
 */
export function SoilZone({ target, registry, onReport }: { target: SoilTarget; registry: readonly MetricDef[]; onReport: (report: ZoneReport) => void }) {
  const keys = useMemo(() => soilKeys(target, registry), [target, registry]);
  const list = useMemo(() => SOIL_MEASURES.flatMap(({ measure }) => (keys[measure] ? [keys[measure]] : [])), [keys]);
  const week = useSoilSeries(list, SOIL_WINDOW_S);
  const recent = useSoilSeries(list, SOIL_NOW_S);
  const now = useClockValue((at) => Math.floor(at / 60_000) * 60);
  const loaded = week.data !== undefined && recent.data !== undefined;
  const newest = (measure: SoilMeasure) => newestReading(recent.data, keys[measure], now) ?? newestReading(week.data, keys[measure], now);
  const moisture = newest("moisture");
  const state = probeState(moisture?.at ?? null, now, loaded, Boolean(keys.moisture));
  const relation = rangeRelation(moisture?.value ?? null, target, state);
  const name = zoneLabel(target.zone);
  const { status, text } = relation;
  useEffect(() => { onReport({ zone: target.zone, state, relation: { status, text } }); }, [onReport, target.zone, state, status, text]);
  const failed = (week.isError && week.data === undefined) || (recent.isError && recent.data === undefined);
  const panelState: PanelState = failed ? "error" : !loaded && keys.moisture ? "loading" : state === "silent" ? "stale" : "ready";
  const line = moistureLine(week.data, keys.moisture);
  const drawn = state !== "never" && line !== null && line.values.some((value) => value !== null);
  const from = now - SOIL_WINDOW_S;
  const silent = state === "silent";
  return <Panel title={name} thing={`the ${name} probe`} state={panelState} headingLevel={3} reserve="lg"
    observedAt={moisture ? new Date(moisture.at * 1000).toISOString() : undefined}
    pill={<StatusBadge status={relation.status} size="sm">{relation.text}</StatusBadge>}
    onRetry={() => { void week.refetch(); void recent.refetch(); }}
    foot={probeWords(state, moisture?.at ?? null, agoDuration, now)}>
    <dl className="wat-soil-now" data-probe={state}>
      {SOIL_MEASURES.filter(({ measure }) => keys[measure]).map(({ measure, label }) => {
        const reading = newest(measure);
        const unit = unitOf(registry.find((metric) => metric.key === keys[measure]));
        return <div key={measure} className="wat-soil-stat" data-measure={measure}>
          <dt>{label}</dt>
          <dd>{silent && reading
            // A silent probe's last number is never shown as if it were current (design review B10); the card's one
            // line above says when it last answered, so each reading is only a dash.
            ? <span className="wat-soil-value" title={`No reading since ${shortDateTime(new Date(reading.at * 1000).toISOString())}`}>—</span>
            : <><span className="wat-soil-value">{reading ? soilValue(reading.value, unit) : "—"}</span>
              {reading && measure === "moisture" && reading.value === 100 && now - reading.at <= 300 &&
                <span className="meta wat-soil-age">At the probe’s upper limit</span>}
              {reading ? (now - reading.at > 300 || readingOlder(reading.at, moisture?.at ?? null)) &&
                <span className="meta wat-soil-age">{agoDuration(Math.max(0, now - reading.at))}</span>
                : <span className="meta wat-soil-age">not reported</span>}</>}</dd>
        </div>;
      })}
    </dl>
    {drawn
      ? <ThresholdSeries title={`${name} moisture, last 7 days`} unit="%" t={line.t} values={line.values} token="--eq-water" range={{ from, to: now }}
        thresholds={[{ value: target.wilt_pct, label: "Wilt", tone: "critical" }, { value: target.min_pct, label: "Low end", tone: "warn" }, { value: target.max_pct, label: "High end", tone: "warn" }]}
        format={(value) => formatValue(value, "%")} size="sm" syncKey="water-soil" />
      : <EmptyState message={keys.moisture ? "No moisture readings in the last 7 days, so nothing is drawn." : "This zone's probe is not in the list of measured values, so nothing is drawn."} />}
    <SoilRange target={target} />
  </Panel>;
}
