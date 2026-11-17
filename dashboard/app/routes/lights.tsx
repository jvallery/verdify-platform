// SPDX-License-Identifier: MIT
import { useState } from "react";
import { chartLinks } from "../charts/uplot-chart";
import { useClockValue, useNow } from "../components/freshness";
import { LIGHTS, useLightControl } from "../components/equipment/light-controls";
import { Page } from "../components/layout/page";
import { PageHeader } from "../components/layout/page-header";
import { CIRCUITS, circuitOf, lightsStatus, localToday, weekWindow, type HandMinutes } from "../components/lights/model";
import { ByHandPanel, CircuitPanel, SettingsPanel, SwitchingPanel, WeekPanel } from "../components/lights/panels";
import { PanelErrorBoundary } from "../components/panel";
import type { Setting } from "../lib/operator-api";
import { panelRead, useEquipmentRead, useLightingDaysRead, useSettingsRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";
import { OperatorOnly, useRole } from "../lib/session";

export const meta = () => viewMeta("lights-overview");
export const links = () => chartLinks();

const settingOf = (items: readonly Setting[] | undefined, param: string) => items?.find((item) => item.param === param);

/**
 * Lights → Lights (`/lights`, screens section 4.1, parity L-01 to L-09): are the lights doing what the owner wants?
 * Each circuit as its switch reports it against what the controller wants and why, then By hand (operators), how the
 * lights are switched and whether each switch confirmed, the twelve settings of each circuit and the last seven days.
 * No greenhouse data renders in SSR: every block waits for its read.
 */
export default function Lights() {
  const now = useNow();
  const today = useClockValue(localToday);
  const operator = useRole() === "operator";
  const equipmentQuery = useEquipmentRead();
  const equipment = panelRead(equipmentQuery);
  const settingsQuery = useSettingsRead();
  const settings = panelRead(settingsQuery);
  const week = panelRead(useLightingDaysRead(weekWindow(today)));
  const settingItems = settingsQuery.data?.items;
  const [main, grow] = LIGHTS;
  const controls = [useLightControl(main, settingOf(settingItems, main.autoParam)), useLightControl(grow, settingOf(settingItems, grow.autoParam))];
  const [minutes, setMinutes] = useState<HandMinutes>(15);
  const items = CIRCUITS.map((circuit) => equipment.data?.items.find((item) => item.equipment === circuit.equipment));
  const circuits = CIRCUITS.map((circuit) => circuitOf(week.data, circuit.light));
  const status = equipment.data ? lightsStatus(items, now) : equipment.failed ? "The lights could not be read" : null;

  return <Page className="lights-page">
    <PageHeader view="lights-overview" status={status} />
    <div className="l-grid">
      <div className="l-cols-2">
        {CIRCUITS.map((circuit, index) => <PanelErrorBoundary key={circuit.light} thing={`the ${circuit.name.toLowerCase()}`} onRetry={equipment.retry}>
          <CircuitPanel circuit={circuit} item={items[index]} equipment={equipment} today={circuits[index]} now={now} />
        </PanelErrorBoundary>)}
      </div>
      <OperatorOnly>
        <div className="span-8">
          <PanelErrorBoundary thing="the light buttons" onRetry={equipment.retry}>
            <ByHandPanel controls={controls} items={items} equipment={equipment} minutes={minutes} setMinutes={setMinutes} now={now} />
          </PanelErrorBoundary>
        </div>
      </OperatorOnly>
      <div className={operator ? "span-4" : undefined}>
        <PanelErrorBoundary thing="the switches" onRetry={equipment.retry}>
          <SwitchingPanel items={items} equipment={equipment} now={now} />
        </PanelErrorBoundary>
      </div>
      <PanelErrorBoundary thing="the light settings" onRetry={settings.retry}>
        <SettingsPanel items={settingItems ?? null} read={settings} />
      </PanelErrorBoundary>
      <PanelErrorBoundary thing="the light days" onRetry={week.retry}>
        <WeekPanel circuits={circuits} read={week} />
      </PanelErrorBoundary>
    </div>
  </Page>;
}
