// SPDX-License-Identifier: MIT
import { dayMonth, formatNumber } from "../../lib/format";
import type { DailyRecord, RecordMeans, RecordPeriod } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { Delta } from "../data/delta";
import { Panel } from "../panel";
import { recordState } from "./record-model";

/** Which way a measure is plainly better, if either: time in band up, starts down; the rest have no better direction. */
export type Better = "up" | "down" | null;
/** How a change reads: better or worse where a direction is plainly better; neutral elsewhere, or when it is nothing. */
export type ChangeTone = "better" | "worse" | "neutral";

/** One measure of `RecordMeans` as the comparison shows it. */
type Measure = {
  readonly key: string;
  /** The Days table's label, its unit after a comma. */
  readonly label: string;
  readonly pick: (means: RecordMeans) => number | null;
  /** Decimals of the bare value in a cell. */
  readonly digits: number;
  /** The `Delta` unit of the change. */
  readonly deltaUnit: string;
  readonly better: Better;
};

/** The measures in the Days table's order, with its labels (screens 6.1 row 3). */
export const MEASURES: readonly Measure[] = [
  { key: "both", label: "In band, both, %", pick: (m) => m.both_pct, digits: 1, deltaUnit: "pts", better: "up" },
  { key: "temp", label: "In band, temp, %", pick: (m) => m.temp_pct, digits: 1, deltaUnit: "pts", better: "up" },
  { key: "vpd", label: "In band, VPD, %", pick: (m) => m.vpd_pct, digits: 1, deltaUnit: "pts", better: "up" },
  { key: "nights", label: "Nights dried", pick: (m) => m.nights_dried, digits: 0, deltaUnit: "count", better: null },
  { key: "starts", label: "Climate starts", pick: (m) => m.climate_starts, digits: 0, deltaUnit: "count", better: "down" },
  { key: "climate-run", label: "Climate run time, h", pick: (m) => m.climate_run_h, digits: 1, deltaUnit: "h", better: null },
  { key: "heat1", label: "Heat 1 run time, h", pick: (m) => m.heat1_run_h, digits: 1, deltaUnit: "h", better: null },
  { key: "heat2", label: "Heat 2 run time, h", pick: (m) => m.heat2_run_h, digits: 1, deltaUnit: "h", better: null },
  { key: "kwh", label: "Electricity, kWh", pick: (m) => m.kwh, digits: 1, deltaUnit: "kWh", better: null },
  { key: "therms", label: "Gas, therms (est.)", pick: (m) => m.therms_est, digits: 2, deltaUnit: "therms", better: null },
  { key: "water", label: "Water, gal", pick: (m) => m.crop_gal, digits: 0, deltaUnit: "gal", better: null },
  { key: "drying", label: "Drying, min", pick: (m) => (m.drying_h === null ? null : m.drying_h * 60), digits: 0, deltaUnit: "min", better: null },
];

/** One row of the comparison: the two means as served, as bare numbers, and the change between them. */
export type PeriodChange = {
  readonly key: string;
  readonly label: string;
  /** The earlier mean, a bare number, or "—" when it is null (never 0). Nights dried read "0 of 29". */
  readonly before: string;
  readonly since: string;
  /** The later mean less the earlier; null when either is null, and for nights dried (counts over periods of different lengths). */
  readonly change: number | null;
  readonly deltaUnit: string;
  readonly tone: ChangeTone;
};

const RESOLUTION: Readonly<Record<string, number>> = { pts: 0.05, count: 0.5, h: 0.05, kWh: 0.05, therms: 0.005, gal: 0.5, min: 0.5 };

/** The tone of a change: better or worse only where the measure has a better direction and the change shows at all. */
export function changeTone(change: number | null, better: Better, deltaUnit: string): ChangeTone {
  if (change === null || better === null || Math.abs(change) < (RESOLUTION[deltaUnit] ?? 0)) return "neutral";
  return (change > 0) === (better === "up") ? "better" : "worse";
}

/**
 * The comparison of the period before the law with the period since (parity R-06): one row per measure of
 * `RecordMeans`, in the Days table's order, each mean as the API serves it (never recomputed) and the change between
 * them. A null mean is an em dash and its change is null. Nights dried is a count over each period's own days, so it
 * reads "0 of 29" and carries no change.
 */
export function periodChanges(before: RecordMeans, since: RecordMeans): PeriodChange[] {
  return MEASURES.map((measure) => {
    const a = measure.pick(before), b = measure.pick(since);
    if (measure.key === "nights") {
      const count = (means: RecordMeans, value: number | null) => (value === null ? "—" : `${formatNumber(value, 0)} of ${formatNumber(means.days, 0)}`);
      return { key: measure.key, label: measure.label, before: count(before, a), since: count(since, b), change: null, deltaUnit: measure.deltaUnit, tone: "neutral" };
    }
    const change = a === null || b === null ? null : b - a;
    return {
      key: measure.key, label: measure.label, before: formatNumber(a, measure.digits), since: formatNumber(b, measure.digits), change, deltaUnit: measure.deltaUnit,
      tone: changeTone(change, measure.better, measure.deltaUnit),
    };
  });
}

/** The days from `from` to `to`, both included. */
export function periodLength(period: Pick<RecordPeriod, "from" | "to">): number {
  return Math.round((Date.parse(`${period.to}T12:00:00Z`) - Date.parse(`${period.from}T12:00:00Z`)) / 86_400_000) + 1;
}

const daysWord = (count: number) => `${formatNumber(count, 0)} ${count === 1 ? "day" : "days"}`;

/** A period's heading and its line: "30 days before the law" and "17 Oct to 15 Nov · 29 days counted, 1 left out". */
export function periodWords(period: RecordPeriod, which: "before" | "since"): { title: string; line: string } {
  const length = periodLength(period);
  const title = which === "before" ? `${daysWord(length)} before the law` : `${daysWord(length)} since the law`;
  const dates = period.from === period.to ? dayMonth(period.from) : `${dayMonth(period.from)} to ${dayMonth(period.to)}`;
  const left = period.excluded_days > 0 ? `, ${formatNumber(period.excluded_days, 0)} left out` : "";
  return { title, line: `${dates} · ${daysWord(period.means.days)} counted${left}` };
}

/** The limits that qualify the comparison (screens 6.1 row 3), in plain sentences from the two periods. */
export function periodLimits(baseline: RecordPeriod, since: RecordPeriod): string[] {
  const left = (count: number) => (count === 0 ? "none" : formatNumber(count, 0));
  const edits = baseline.excluded_days + since.excluded_days === 0
    ? "Days on which the band was edited are left out of both periods; no such day fell in either."
    : `Days on which the band was edited are left out of both periods: ${left(baseline.excluded_days)} before the law and ${left(since.excluded_days)} since.`;
  return [
    edits,
    "Electricity counts only days with at least 70 % meter coverage.",
    "The two periods are different weeks of the year, so the weather differs: the comparison is an indication, not a measurement.",
  ];
}

/** The block's state from the record: hidden without a law day; a sentence when either period is missing; the table. */
export type PeriodsView =
  | { readonly kind: "hidden" }
  | { readonly kind: "sentence"; readonly text: string }
  | { readonly kind: "compare"; readonly baseline: RecordPeriod; readonly since: RecordPeriod };
export function periodsView(record: Pick<DailyRecord, "law_started" | "baseline" | "since_law"> | null): PeriodsView {
  if (!record || !record.law_started) return { kind: "hidden" };
  if (!record.baseline) return { kind: "sentence", text: "No record from before the law to compare with." };
  if (!record.since_law) return { kind: "sentence", text: `The law started on ${dayMonth(record.law_started)}. The comparison appears after its first complete day.` };
  return { kind: "compare", baseline: record.baseline, since: record.since_law };
}

/**
 * Days, row 3 (screens 6.1, parity R-06): before and after the law. The 30 days before the controller's first law
 * record and the days since, side by side with their dates and day counts, one row per measure with the earlier mean,
 * the later mean and the change; then the limits that qualify them. Shown only once the controller has reported the
 * law. On a phone the periods stack and each measure is one line with both values.
 */
export function Periods({ read }: { read: PanelRead<DailyRecord> }) {
  const record = read.data;
  const view = periodsView(record);
  if (view.kind === "hidden") return null;
  const state = recordState(read, false);
  const head = (period: RecordPeriod, which: "before" | "since") => {
    const words = periodWords(period, which);
    return <><span className="rc-period-title">{words.title}</span><span className="rc-period-line">{words.line}</span></>;
  };
  return <Panel title="Before and after the law" thing="the comparison before and after the law" state={state} observedAt={record?.server_time} onRetry={read.retry}>
    {view.kind === "sentence"
      ? <p className="rc-periods-sentence">{view.text}</p>
      : <div className="rc-periods">
        <ul className="rc-period-heads" aria-hidden="true">
          <li>{head(view.baseline, "before")}</li>
          <li>{head(view.since, "since")}</li>
        </ul>
        <table className="rc-period-table">
          <caption className="screen-reader">Means a day before the law and since, and the change</caption>
          <thead><tr>
            <th scope="col"><span className="screen-reader">Measure</span></th>
            <th scope="col" className="num">{head(view.baseline, "before")}</th>
            <th scope="col" className="num">{head(view.since, "since")}</th>
            <th scope="col" className="num">Change</th>
          </tr></thead>
          <tbody>{periodChanges(view.baseline.means, view.since.means).map((row) => <tr key={row.key} data-measure={row.key}>
            <th scope="row">{row.label}</th>
            <td className="num rc-p-before">{row.before}</td>
            <td className="num rc-p-since">{row.since}</td>
            <td className="num rc-p-change">{row.change === null ? "—" : <Delta value={row.change} unit={row.deltaUnit} vs="before the law" tone={row.tone} />}</td>
          </tr>)}</tbody>
        </table>
        <ul className="rc-period-limits">{periodLimits(view.baseline, view.since).map((line) => <li key={line}>{line}</li>)}</ul>
      </div>}
  </Panel>;
}
