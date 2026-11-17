// SPDX-License-Identifier: MIT
import { chartLinks } from "../charts/uplot-chart";
import { RunByHand } from "../components/run-by-hand";
import { ClimateRelays } from "../components/equipment/climate-relays";
import { FlagsCard } from "../components/equipment/flags";
import { LightsState } from "../components/equipment/lights-state";
import { RelayLanes } from "../components/equipment/relay-lanes";
import { WaterRelays } from "../components/equipment/water-relays";
import { CLIMATE_RELAYS } from "../components/equipment/relay-why";
import { localDate } from "../lib/format";
import { useClockValue } from "../components/freshness";
import { Page } from "../components/layout/page";
import { PageHeader } from "../components/layout/page-header";
import { PanelErrorBoundary } from "../components/panel";
import { deviceState } from "../components/system/states";
import type { Equipment as EquipmentRead } from "../lib/operator-api";
import { panelRead, useEquipmentRead, useIrrigationRead, useLawRead, useRecordDaysRead } from "../lib/queries";
import { useShellNow, useShellStatus } from "../lib/shell";
import { viewMeta } from "../lib/sections";

/**
 * System → Equipment (screens section 10.1): what every relay is doing and why, and the runs by hand. Climate relays
 * (API-13 state, API-32 today, API-30 why), water relays (API-13, API-IRR-01), lights as state only, Run by hand (its
 * buttons for operators only), the flags, then the relay lanes of the last 24 h or 72 h (API-05). The daily run-time chart is Record →
 * Equipment's and the controller's health is Controller's. Every block has its own error boundary; no greenhouse data
 * renders on the server.
 */
export const meta = () => viewMeta("system-equipment");
export const links = () => chartLinks();

/** "2 of 6 climate relays on · 1 water line on", from API-13; null while it has not answered. */
export function equipmentStatus(equipment: EquipmentRead | null | undefined): string | null {
  if (!equipment) return null;
  const items = new Map(equipment.items.map((item) => [item.equipment, item]));
  const climate = CLIMATE_RELAYS.map((key) => items.get(key)?.state ?? "unknown");
  if (climate.every((state) => state === "unknown")) return "Relay states are not reported";
  const on = climate.filter((state) => state === "on").length;
  const water = equipment.items.filter((item) => item.group === "water" && item.equipment !== "fog" && item.state === "on").length;
  return `${on} of ${CLIMATE_RELAYS.length} climate relays on · ${water === 0 ? "no water line on" : `${water} water ${water === 1 ? "line" : "lines"} on`}`;
}

const localToday = (now: number): string => localDate(new Date(now).toISOString());

export default function Equipment() {
  const equipment = panelRead(useEquipmentRead());
  const law = panelRead(useLawRead());
  const record = panelRead(useRecordDaysRead());
  const irrigation = panelRead(useIrrigationRead());
  const shell = useShellNow();
  const status = useShellStatus();
  const today = useClockValue(localToday);
  const state = deviceState(equipment, status);
  const since = state === "ingestor_down" ? shell.data?.freshness.ingestor.observed_at : shell.data?.freshness.climate.observed_at;
  const line = equipmentStatus(equipment.failed ? null : equipment.data);
  return <Page className="sys-page sys-equipment">
    <PageHeader view="system-equipment" status={line} statusShort={line} />
    <div className="l-stack sys-blocks">
      <PanelErrorBoundary thing="the climate relays" onRetry={equipment.retry}>
        <ClimateRelays equipment={equipment} law={law} record={record} state={state} since={since} />
      </PanelErrorBoundary>
      <PanelErrorBoundary thing="the water relays" onRetry={equipment.retry}>
        <WaterRelays equipment={equipment} irrigation={irrigation} state={state} since={since} />
      </PanelErrorBoundary>
      <PanelErrorBoundary thing="the lights" onRetry={equipment.retry}><LightsState equipment={equipment} state={state} since={since} /></PanelErrorBoundary>
      <PanelErrorBoundary thing="the runs by hand"><RunByHand /></PanelErrorBoundary>
      <PanelErrorBoundary thing="the flags"><FlagsCard today={today} /></PanelErrorBoundary>
      <PanelErrorBoundary thing="the relay lanes"><RelayLanes /></PanelErrorBoundary>
    </div>
  </Page>;
}
