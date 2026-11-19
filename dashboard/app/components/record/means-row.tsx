// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { formatValue } from "../../lib/format";
import type { DailyRecord, RecordDay, RecordMeans } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { Delta } from "../data/delta";
import { MetricTile, type TileState } from "../data/metric-tile";
import { Sparkline, type SparkToken } from "../data/sparkline";
import { Section, SectionHeader } from "../layout/section-header";
import { PanelErrorBoundary } from "../panel";
import { change, hasRecord, heaterHours, hoursOf, recordState, sparkSeries, windowHref, type WindowDays } from "./record-model";

/** One stat of the means row: its label, where it opens, its served means, its unit and its day's value. */
export type MeanStat = {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly unit: string;
  /** The `Delta` unit: "pts" for a share. */
  readonly deltaUnit: string;
  readonly mean: (means: RecordMeans | null) => number | null;
  readonly day: (day: RecordDay) => number | null | undefined;
  readonly token?: SparkToken;
};

/** The headline figures (screens 6.1 row 1), each a 7-day mean against the 30-day mean, both as the API serves them. */
export function meanStats(days: WindowDays): readonly MeanStat[] {
  const to = (path: string) => windowHref(path, days);
  return [
    { key: "in-band", label: "Time in band", href: to("/record/compliance"), unit: "%", deltaUnit: "pts", mean: (m) => m?.both_pct ?? null, day: (d) => d.band?.both_pct },
    { key: "starts", label: "Climate starts a day", href: to("/record/equipment"), unit: "count", deltaUnit: "count", mean: (m) => m?.climate_starts ?? null, day: (d) => d.climate_starts },
    { key: "heater", label: "Heater hours a day", href: to("/record/equipment"), unit: "h", deltaUnit: "h", mean: heaterHours,
      day: (d) => (d.relays?.heat1 && d.relays?.heat2 ? (d.relays.heat1.run_s + d.relays.heat2.run_s) / 3600 : null) },
    { key: "kwh", label: "Electricity a day", href: to("/record/utilities"), unit: "kWh", deltaUnit: "kWh", mean: (m) => m?.kwh ?? null, day: (d) => d.energy.kwh },
    { key: "therms", label: "Gas a day, estimated", href: to("/record/utilities"), unit: "therms", deltaUnit: "therms", mean: (m) => m?.therms_est ?? null, day: (d) => d.gas.therms_est },
    { key: "crop-water", label: "Crop water a day", href: to("/record/utilities"), unit: "gal", deltaUnit: "gal", mean: (m) => m?.crop_gal ?? null, day: (d) => d.water.crop_gal, token: "water" },
    { key: "drying", label: "Drying a day", href: "/climate/drying", unit: "h", deltaUnit: "h", mean: (m) => m?.drying_h ?? null, day: (d) => hoursOf(d.drying?.seconds) },
  ];
}

/** "1 of 7": nights dried among the complete days a mean covers. */
export const nightsText = (means: RecordMeans | null): string | null =>
  means && means.nights_dried !== null ? `${means.nights_dried} of ${means.days}` : null;

function tileState(read: PanelRead<DailyRecord>): TileState {
  const state = recordState(read, read.data !== null && !read.data.days.some(hasRecord));
  return state === "ready" || state === "loading" || state === "empty" || state === "stale" ? state : "error";
}

/**
 * Days, row 1 (screens 6.1): the means row. Each stat is the 7-day mean as served, its change against the served 30-day
 * mean (`Delta`) and a 30-day sparkline with today marked partial. Nights dried is a count, so its comparison is the
 * 30-day count in words rather than a change. Every tile has its own loading, empty, stale and error state.
 */
export function MeansRow({ read, days }: { read: PanelRead<DailyRecord>; days: WindowDays }) {
  const record = read.data;
  const state = tileState(read);
  const d7 = record?.means.d7 ?? null, d30 = record?.means.d30 ?? null;
  const tile = (key: string, label: string, href: string, value: ReactNode | null, delta: ReactNode, visual: ReactNode, meta: ReactNode) =>
    <MetricTile key={key} label={label} href={href} value={value} delta={delta} visual={visual} meta={meta} state={state} onRetry={read.retry}
      empty="No record in these days" reason="not recorded" data={{ "data-mean": key }} />;
  const nights = tile("nights", "Nights dried", windowHref("/record/compliance", days), nightsText(d7),
    <span className="delta">{nightsText(d30) ?? "—"} <span className="delta-vs">over the last 30 days</span></span>,
    record ? <Sparkline kind="bars" token="muted" label="Night dry-out minutes, last 30 days" {...sparkSeries(record, (day) => day.band?.night_dryout_min)} /> : null,
    d7 && d7.days !== 7 ? `Last ${d7.days} complete ${d7.days === 1 ? "day" : "days"}` : "Last 7 complete days");
  const stats = meanStats(days).map((stat) => {
    const series = record ? sparkSeries(record, stat.day) : null;
    return tile(stat.key, stat.label, stat.href, stat.mean(d7) === null ? null : formatValue(stat.mean(d7), stat.unit),
      <Delta value={change(stat.mean(d7), stat.mean(d30))} unit={stat.deltaUnit} vs="30-day mean" />,
      series && <Sparkline kind="bars" token={stat.token ?? "muted"} label={`${stat.label}, last 30 days`} {...series} />,
      <>30-day mean {formatValue(stat.mean(d30), stat.unit)}{d7 && d7.days !== 7 ? <> · {d7.days} complete {d7.days === 1 ? "day" : "days"}</> : null}</>);
  });
  return <Section className="rc-means" header={<SectionHeader title="The last 7 days against the last 30" meta="7-day means, complete days only" />}>
    <PanelErrorBoundary thing="the means" onRetry={read.retry}>
      <div className="l-cols-4">{[stats[0], nights, ...stats.slice(1)]}</div>
    </PanelErrorBoundary>
  </Section>;
}
