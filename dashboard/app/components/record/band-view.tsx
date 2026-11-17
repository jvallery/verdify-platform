// SPDX-License-Identifier: MIT
import { useNavigate } from "react-router";
import { DailyBars, type DailyBarDay } from "../../charts/daily-bars";
import { DailyStack, type DailyStackDay, type DailyStackPart } from "../../charts/daily-stack";
import { formatValue } from "../../lib/format";
import { dayHref } from "../../lib/graph-url";
import type { DailyRecord, RecordDay } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { EmptyState, Panel, PanelErrorBoundary } from "../panel";
import { isSoFar, recordState, windowDays, type WindowDays } from "./record-model";

/** In band, below and above, bottom to top (screens 6.2), in their compliance tokens. */
export const BAND_PARTS: readonly DailyStackPart[] = [
  { key: "in", label: "In band", token: "--cmp-in" },
  { key: "below", label: "Below", token: "--cmp-below" },
  { key: "above", label: "Above", token: "--cmp-above" },
];
/** The cursor every chart of the view shares. */
export const BAND_SYNC = "verdify:record-band";
const SO_FAR = "so far";
const minutes = (value: number) => formatValue(value, "min");
const percent = (value: number) => formatValue(value, "%");

/** A signal's daily stack: the served shares in, below and above the band; today drawn lighter as "so far". */
export function bandStackDays(days: readonly RecordDay[], record: DailyRecord, signal: "temp" | "vpd"): DailyStackDay[] {
  return days.map((day) => {
    const band = day.band;
    const soFar = isSoFar(day, record);
    return {
      date: day.date,
      values: band
        ? { in: signal === "temp" ? band.temp_pct : band.vpd_pct, below: signal === "temp" ? band.temp_below_pct : band.vpd_below_pct, above: signal === "temp" ? band.temp_above_pct : band.vpd_above_pct }
        : { in: null, below: null, above: null },
      ...(soFar ? { partial: true, note: SO_FAR } : {}),
    };
  });
}

/** One measure per day as bars, today lighter as "so far"; `mark` adds a note to a day ("night dried"). */
export function barDays(days: readonly RecordDay[], record: DailyRecord, pick: (day: RecordDay) => number | null | undefined, mark?: (day: RecordDay) => string | null): DailyBarDay[] {
  return days.map((day) => {
    const soFar = isSoFar(day, record);
    const note = mark?.(day) ?? null;
    return { date: day.date, value: pick(day) ?? null, ...(soFar ? { partial: true } : {}), ...(soFar || note ? { note: [note, soFar ? SO_FAR : null].filter(Boolean).join(", ") } : {}) };
  });
}

/** "7-day mean 96.1% · 30-day mean 97.0%": the served means of a share. */
const meansLine = (d7: number | null | undefined, d30: number | null | undefined) => `7-day mean ${percent(d7 ?? NaN)} · 30-day mean ${percent(d30 ?? NaN)}`;

/**
 * Record → In band (screens 6.2): time in band per day as a daily stack (in band, below, above) for temperature and for
 * VPD on one cursor; the house in band by day against by night; the minutes of night dry-out with the dried nights
 * noted; and the minutes above full cooling. Every chart carries its table and CSV; a bar opens Graphs on its day.
 */
export function BandView({ read, days }: { read: PanelRead<DailyRecord>; days: WindowDays }) {
  const navigate = useNavigate();
  const record = read.data;
  const shown = record ? windowDays(record, days) : [];
  const state = recordState(read, record !== null && !shown.some((day) => day.band !== null));
  const pick = (date: string) => { void navigate(dayHref(date)); };
  const d7 = record?.means.d7 ?? null, d30 = record?.means.d30 ?? null;
  const common = { thing: "time in band", state, observedAt: record?.server_time, onRetry: read.retry, empty: <EmptyState message="No day in this window was graded against the band." /> } as const;
  const dried = shown.filter((day) => day.band?.night_dried === true).length;
  return <div className="l-stack">
    <Panel title="Time in band per day" {...common} reserve="lg" foot={`Temperature: ${meansLine(d7?.temp_pct, d30?.temp_pct)}. VPD: ${meansLine(d7?.vpd_pct, d30?.vpd_pct)}.`}>
      {record && <PanelErrorBoundary thing="the time in band charts" onRetry={read.retry}><div className="l-stack">
        <DailyStack title="Temperature" unit="%" parts={BAND_PARTS} days={bandStackDays(shown, record, "temp")} max={100} format={percent} syncKey={BAND_SYNC} onPick={pick} />
        <DailyStack title="VPD" unit="%" parts={BAND_PARTS} days={bandStackDays(shown, record, "vpd")} max={100} format={percent} syncKey={BAND_SYNC} onPick={pick} />
      </div></PanelErrorBoundary>}
    </Panel>
    <Panel title="Day against night" {...common} foot={`Both in band. All day: ${meansLine(d7?.both_pct, d30?.both_pct)}.`}>
      {record && <PanelErrorBoundary thing="the day and night charts" onRetry={read.retry}><div className="l-stack">
        <DailyBars title="In band by day" unit="%" token="--c-day" days={barDays(shown, record, (day) => day.band?.both_day_pct)} max={100} format={percent} size="sm" syncKey={BAND_SYNC} onPick={pick} />
        <DailyBars title="In band by night" unit="%" token="--c-night" days={barDays(shown, record, (day) => day.band?.both_night_pct)} max={100} format={percent} size="sm" syncKey={BAND_SYNC} onPick={pick} />
      </div></PanelErrorBoundary>}
    </Panel>
    <div className="l-cols-2">
      <Panel title="Night dry-out" {...common}
        foot={`Nights dried: ${dried} of the ${shown.length} days shown; ${d7?.nights_dried ?? "—"} of the last ${d7?.days ?? 7} complete days, ${d30?.nights_dried ?? "—"} of the last ${d30?.days ?? 30}.`}>
        {record && <DailyBars title="Minutes of night dry-out" unit="min" token="--c-vpd" format={minutes} syncKey={BAND_SYNC} onPick={pick}
          days={barDays(shown, record, (day) => day.band?.night_dryout_min, (day) => (day.band?.night_dried ? "night dried" : null))} />}
      </Panel>
      <Panel title="Above full cooling" {...common} foot="Minutes the house was above the band's high edge with both fans and the vent already running: heat the cooling could not carry.">
        {record && <DailyBars title="Minutes above full cooling" unit="min" token="--cmp-above" format={minutes} syncKey={BAND_SYNC} onPick={pick}
          days={barDays(shown, record, (day) => day.band?.above_full_cooling_min)} />}
      </Panel>
    </div>
  </div>;
}
