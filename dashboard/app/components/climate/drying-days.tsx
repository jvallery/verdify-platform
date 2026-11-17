// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import { DailyBars } from "../../charts/daily-bars";
import { DailyStack } from "../../charts/daily-stack";
import { formatNumber, formatValue } from "../../lib/format";
import { panelRead, useRecordDaysRead } from "../../lib/queries";
import { EmptyState, Panel, type PanelState } from "../panel";
import { LOWER_BOUND, dryingBars, furnaceStartsOf, heatKwhOf, hoursOf, pricePaidOf, refusalDays, refusalParts, runsOf, waterKgOf } from "./days";

const SYNC = "drying-days";

/**
 * Block 4, By day (screens §2.3): 30 days of the daily record's drying as daily bars (hours, runs, water removed, heat
 * spent, the price paid against the limit in force, furnace starts after drying) and the hours wanted but refused,
 * stacked by reason. Today is drawn "so far"; a day a restart cut short is marked a lower bound. `limit` is the limit in
 * force (API-30), drawn as the price chart's threshold.
 */
export function DryingByDayPanel({ limit }: { limit: number | null }) {
  const read = panelRead(useRecordDaysRead());
  const record = read.data;
  const days = useMemo(() => record?.days ?? [], [record]);
  const parts = useMemo(() => refusalParts(days), [days]);
  const anyDrying = days.some((day) => day.drying !== null);
  const state: PanelState = read.pending ? "loading" : !record ? "error" : read.failed ? "stale" : anyDrying ? "ready" : "empty";
  const means = { d7: record?.means.d7 ?? null, d30: record?.means.d30 ?? null };
  const lowerBound = days.some((day) => day.drying?.lower_bound);
  return <Panel title="By day" thing="the daily record" state={state} reserve="lg" onRetry={read.retry} link={{ to: "/record", label: "Daily record" }}
    empty={<EmptyState message="No drying in the daily record for these 30 days." />}
    foot={lowerBound ? `A day marked "${LOWER_BOUND}" lost part of its count to a restart; it dried at least that much.` : "From the daily record, one row per local day."}>
    <div className="l-cols-2 drying-days">
      <DailyBars title="Hours of drying" unit="h" token="--eq-vent" size="sm" syncKey={SYNC} days={dryingBars(days, hoursOf)}
        mean7={means.d7?.drying_h ?? null} mean30={means.d30?.drying_h ?? null} format={(value) => formatValue(value, "h")} />
      <DailyBars title="Drying runs" unit="runs" token="--eq-vent" size="sm" syncKey={SYNC} days={dryingBars(days, runsOf)} format={(value) => formatNumber(value, 0)} />
      <DailyBars title="Water removed" unit="kg" token="--c-rh" size="sm" syncKey={SYNC} days={dryingBars(days, waterKgOf)} format={(value) => formatValue(value, "kg")} />
      <DailyBars title="Heat spent" unit="kWh" token="--eq-heat1" size="sm" syncKey={SYNC} days={dryingBars(days, heatKwhOf)} format={(value) => formatValue(value, "kWh")} />
      <DailyBars title="Price paid" unit="kWh/kg" token="--c-temp" size="sm" syncKey={SYNC} days={dryingBars(days, pricePaidOf)} format={(value) => formatValue(value, "kWh/kg")}
        threshold={limit === null ? undefined : { value: limit, label: `Limit ${formatValue(limit, "kWh/kg")}`, tone: "warn" }} />
      <DailyBars title="Furnace starts after drying" unit="starts" token="--eq-heat2" size="sm" syncKey={SYNC} days={dryingBars(days, furnaceStartsOf)} format={(value) => formatNumber(value, 0)} />
      <div className="drying-refused">
        {parts.length > 0 ? <DailyStack title="Hours wanted but refused, by reason" unit="h" size="sm" syncKey={SYNC} parts={parts} days={refusalDays(days, parts)}
          format={(value) => formatValue(value, "h")} /> : <p className="meta">{days.some((day) => day.drying?.refused_s) ? "Drying was not refused on any of these days." : "The daily record holds no refusal times for these days."}</p>}
      </div>
    </div>
  </Panel>;
}
