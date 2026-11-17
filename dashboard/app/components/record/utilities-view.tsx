// SPDX-License-Identifier: MIT
import { useNavigate } from "react-router";
import { DailyBars, type DailyBarDay } from "../../charts/daily-bars";
import { DailyStack, type DailyStackDay, type DailyStackPart } from "../../charts/daily-stack";
import { formatNumber, formatValue } from "../../lib/format";
import { dayHref } from "../../lib/graph-url";
import type { DailyRecord, RecordDay } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { EmptyState, Panel, PanelErrorBoundary } from "../panel";
import { Table, type TableColumn } from "../table";
import { barDays } from "./band-view";
import { DAY_ROWS, DayCell, unitHead } from "./days-table";
import { irrigationGal, isSoFar, kwhCell, recordState, windowDays, type WindowDays } from "./record-model";

export const UTILITIES_SYNC = "verdify:record-utilities";
const SO_FAR = "so far";
const PARTIAL = "partial meter coverage";

/**
 * Electricity per day: the metered 24-hour figure; a day under 70 % meter coverage draws what the meter reported,
 * lighter, noted "partial meter coverage"; today lighter as "so far".
 */
export function electricityDays(days: readonly RecordDay[], record: DailyRecord): DailyBarDay[] {
  return days.map((day) => {
    if (isSoFar(day, record)) return { date: day.date, value: day.energy.kwh ?? day.energy.kwh_partial, partial: true, note: SO_FAR };
    if (day.energy.kwh !== null) return { date: day.date, value: day.energy.kwh };
    if (day.energy.kwh_partial === null) return { date: day.date, value: null };
    // One note for every such day, so the key names it once; the day's coverage is in the table below.
    return { date: day.date, value: day.energy.kwh_partial, partial: true, note: PARTIAL };
  });
}

/** Water by use, bottom to top: wetting (misting and fog), irrigation, and house water. */
export const WATER_PARTS: readonly DailyStackPart[] = [
  { key: "wetting", label: "Wetting", token: "--eq-mister" },
  { key: "irrigation", label: "Irrigation", token: "--eq-water" },
  { key: "house", label: "House", token: "--c-outdoor" },
];
/** A day's water by use: irrigation is crop water less wetting (`irrigationGal`); today and an incomplete day lighter. */
export function waterDays(days: readonly RecordDay[], record: DailyRecord): DailyStackDay[] {
  return days.map((day) => {
    const soFar = isSoFar(day, record);
    const incomplete = !soFar && day.water.complete === false;
    return {
      date: day.date,
      values: { wetting: day.water.wetting_gal, irrigation: irrigationGal(day.water), house: day.water.house_gal },
      ...(soFar ? { partial: true, note: SO_FAR } : incomplete ? { partial: true, note: "water record incomplete" } : {}),
    };
  });
}

const kwh = (value: number) => formatValue(value, "kWh");
const therms = (value: number) => formatValue(value, "therms");
const gallons = (value: number) => formatValue(value, "gal");
/** "7-day mean 25.1 kWh · 30-day mean 26.4 kWh". */
const meansLine = (d7: number | null | undefined, d30: number | null | undefined, unit: string) => `7-day mean ${formatValue(d7, unit)} · 30-day mean ${formatValue(d30, unit)}`;

const UTILITY_COLUMNS = (record: DailyRecord): readonly TableColumn<RecordDay>[] => [
  { key: "date", header: "Day", rowHeader: true, cell: (day) => <DayCell day={day} record={record} /> },
  { key: "kwh", header: "Metered", headerGroup: "Electricity, kWh", numeric: true, cell: (day) => kwhCell(day) },
  { key: "metered", header: "Reported", headerGroup: "Electricity, kWh", numeric: true, cell: (day) => formatNumber(day.energy.kwh_partial, 1) },
  { key: "coverage", header: unitHead("Coverage", "%"), numeric: true, cell: (day) => formatNumber(day.energy.coverage_pct, 0) },
  { key: "therms", header: unitHead("Gas", "therms (est.)"), numeric: true, cell: (day) => formatNumber(day.gas.therms_est, 2) },
  { key: "wetting", header: "Wetting", headerGroup: "Water, gal", numeric: true, cell: (day) => formatNumber(day.water.wetting_gal, 0) },
  { key: "irrigation", header: "Irrigation", headerGroup: "Water, gal", numeric: true, cell: (day) => formatNumber(irrigationGal(day.water), 0) },
  { key: "house", header: "House", headerGroup: "Water, gal", numeric: true, cell: (day) => formatNumber(day.water.house_gal, 0) },
  { key: "total", header: "All", headerGroup: "Water, gal", numeric: true, cell: (day) => formatNumber(day.water.total_gal, 0) },
];

/**
 * Record → Utilities (screens 6.4, parity R-04 and W-31): electricity per day (metered; a partial day lighter with its
 * note), gas per day (estimated, and labelled so), and water per day stacked by use, each with its served means; then
 * the table of every figure, newest first.
 */
export function UtilitiesView({ read, days }: { read: PanelRead<DailyRecord>; days: WindowDays }) {
  const navigate = useNavigate();
  const record = read.data;
  const shown = record ? windowDays(record, days) : [];
  const pick = (date: string) => { void navigate(dayHref(date)); };
  const d7 = record?.means.d7 ?? null, d30 = record?.means.d30 ?? null;
  const panel = (empty: boolean, message: string) => ({
    state: recordState(read, empty), observedAt: record?.server_time, onRetry: read.retry, empty: <EmptyState message={message} />,
  });
  const noEnergy = record !== null && !shown.some((day) => day.energy.kwh_partial !== null);
  const noGas = record !== null && !shown.some((day) => day.gas.therms_est !== null);
  const noWater = record !== null && !shown.some((day) => day.water.total_gal !== null);
  return <div className="l-stack">
    <div className="l-cols-2">
      <Panel title="Electricity per day" thing="electricity" {...panel(noEnergy, "No meter reading in this window.")}
        foot={`Metered. ${meansLine(d7?.kwh, d30?.kwh, "kWh")}, over days with at least 70 % meter coverage.`}>
        {record && <PanelErrorBoundary thing="the electricity chart" onRetry={read.retry}>
          <DailyBars title="Electricity per day" captionHidden unit="kWh" token="--eq-heat1" days={electricityDays(shown, record)} mean7={d7?.kwh} mean30={d30?.kwh}
            format={kwh} syncKey={UTILITIES_SYNC} onPick={pick} />
        </PanelErrorBoundary>}
      </Panel>
      <Panel title="Gas per day, estimated" thing="gas" {...panel(noGas, "No gas estimate in this window.")}
        foot={`Estimated from the furnace's run time; gas is not metered. ${meansLine(d7?.therms_est, d30?.therms_est, "therms")}.`}>
        {record && <PanelErrorBoundary thing="the gas chart" onRetry={read.retry}>
          <DailyBars title="Gas per day, estimated" captionHidden unit="therms" token="--eq-heat2" days={barDays(shown, record, (day) => day.gas.therms_est)}
            mean7={d7?.therms_est} mean30={d30?.therms_est} format={therms} syncKey={UTILITIES_SYNC} onPick={pick} />
        </PanelErrorBoundary>}
      </Panel>
    </div>
    <Panel title="Water per day by use" thing="water" reserve="lg" {...panel(noWater, "No water record in this window.")}
      foot={`Crop water is wetting and irrigation; house water is the rest the meter counted, such as the hose. Crop water: ${meansLine(d7?.crop_gal, d30?.crop_gal, "gal")}.`}>
      {record && <PanelErrorBoundary thing="the water chart" onRetry={read.retry}>
        <DailyStack title="Water per day by use" captionHidden unit="gal" parts={WATER_PARTS} days={waterDays(shown, record)} format={gallons} syncKey={UTILITIES_SYNC} onPick={pick} />
      </PanelErrorBoundary>}
    </Panel>
    <Panel title="Utilities by day" thing="the utilities" reserve="lg" {...panel(noEnergy && noGas && noWater, "No utility is recorded in this window.")}
      foot="Metered is the whole day's figure, blank under 70 % meter coverage, where the day reads “partial”; reported is what the meter counted.">
      {record && <Table label="Utilities by day, scrollable" caption={`Electricity, gas and water per day, last ${days} days, newest first`} captionHidden
        columns={UTILITY_COLUMNS(record)} rows={[...shown].reverse()} rowKey={(day) => day.date} phone="scroll" maxRows={DAY_ROWS} rowNoun="days" />}
    </Panel>
  </div>;
}
