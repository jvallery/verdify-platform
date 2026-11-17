// SPDX-License-Identifier: MIT
import { chartLinks } from "../charts/uplot-chart";
import { DryingNowPanel, HowDryingWorks, MeterPanel } from "../components/climate/drying-blocks";
import { DryingByDayPanel } from "../components/climate/drying-days";
import { DryingLimit } from "../components/climate/drying-limit";
import { dryingVerdict } from "../components/climate/law";
import { PriceAgainstLimitPanel } from "../components/climate/price-chart";
import { Ago } from "../components/freshness";
import { Page } from "../components/layout/page";
import { PageHeader } from "../components/layout/page-header";
import { PanelErrorBoundary } from "../components/panel";
import { formatValue } from "../lib/format";
import { panelRead, useLawRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";

/** Climate → Drying (screens §2.3): whether drying the air is worth what it costs, and the price the owner meant to pay. */
export const meta = () => viewMeta("climate-drying");
export const links = () => chartLinks();

export default function ClimateDrying() {
  const read = panelRead(useLawRead());
  const drying = read.data?.drying ?? null;
  const view = read.data;
  // One observation time a page (A2): the header says how old the law's newest record is; the panels do not repeat it.
  const status = view && drying ? <>{dryingVerdict(drying)} · limit {formatValue(drying.limit_kwh_per_kg, "kWh/kg")} · {view.observed_at ? <>newest record <Ago at={view.observed_at} /></> : "no record yet"}</>
    : read.failed ? "The climate law could not be read." : null;
  return <Page className="climate-page">
    <PageHeader view="climate-drying" status={status} />
    <div className="l-grid climate-grid climate-grid-drying">
      <div className="span-8 climate-main"><PanelErrorBoundary thing="drying now" onRetry={read.retry}><DryingNowPanel read={read} /></PanelErrorBoundary></div>
      <div className="span-8 climate-main"><PanelErrorBoundary thing="the drying cost limit"><DryingLimit /></PanelErrorBoundary></div>
      <div className="span-8 climate-main"><PanelErrorBoundary thing="the price of drying"><PriceAgainstLimitPanel /></PanelErrorBoundary></div>
      <div className="span-8 climate-main"><PanelErrorBoundary thing="the daily record"><DryingByDayPanel limit={drying?.limit_kwh_per_kg ?? null} /></PanelErrorBoundary></div>
      <div className="span-4 climate-side"><PanelErrorBoundary thing="the drying meter" onRetry={read.retry}><MeterPanel read={read} /></PanelErrorBoundary></div>
      <div className="span-8 climate-main"><HowDryingWorks view={read.data} /></div>
    </div>
  </Page>;
}
