// SPDX-License-Identifier: MIT
import { chartLinks } from "../charts/uplot-chart";
import { AskedAndRanPanel } from "../components/climate/asked-ran";
import { BandInForcePanel, DryingDecisionPanel, LawAnswerPanel, RulesPanel, RunningAlonePanel, TimingPanel, lawStatusParts } from "../components/climate/law-blocks";
import { Ago } from "../components/freshness";
import { Page } from "../components/layout/page";
import { PageHeader } from "../components/layout/page-header";
import { PanelErrorBoundary } from "../components/panel";
import type { LawView } from "../lib/operator-api";
import { panelRead, useLawRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";

/** Climate → Law (screens §2.1): what the controller is doing to hold the band, and why. */
export const meta = () => viewMeta("climate-law");
export const links = () => chartLinks();

/** The status line: reporting or not, the newest record's age, and the constants against this release (block 1). */
function LawStatus({ view, short = false }: { view: LawView; short?: boolean }) {
  const { reporting, constants } = lawStatusParts(view);
  const age = view.observed_at ? <>newest record <Ago at={view.observed_at} /></> : "no record yet";
  return short ? <>{reporting} · <Ago at={view.observed_at} /></> : <>{reporting} · {age} · {constants}</>;
}

export default function ClimateLaw() {
  const read = panelRead(useLawRead());
  const view = read.data;
  return <Page className="climate-page">
    <PageHeader view="climate-law" status={view ? <LawStatus view={view} /> : read.failed ? "The climate law could not be read." : null}
      statusShort={view ? <LawStatus view={view} short /> : undefined} />
    <div className="l-grid climate-grid climate-grid-law">
      <div className="span-8 climate-main"><PanelErrorBoundary thing="what the controller is doing" onRetry={read.retry}><LawAnswerPanel read={read} /></PanelErrorBoundary></div>
      <div className="span-8 climate-main"><PanelErrorBoundary thing="the rules" onRetry={read.retry}><RulesPanel read={read} /></PanelErrorBoundary></div>
      <div className="span-4 climate-side l-stack">
        <PanelErrorBoundary thing="the drying decision" onRetry={read.retry}><DryingDecisionPanel read={read} /></PanelErrorBoundary>
        <PanelErrorBoundary thing="the band in force" onRetry={read.retry}><BandInForcePanel read={read} /></PanelErrorBoundary>
        <PanelErrorBoundary thing="running alone" onRetry={read.retry}><RunningAlonePanel read={read} /></PanelErrorBoundary>
      </div>
      <div className="span-8 climate-main"><PanelErrorBoundary thing="the law's history"><AskedAndRanPanel /></PanelErrorBoundary></div>
      <div className="span-8 climate-main"><PanelErrorBoundary thing="the timing and constants" onRetry={read.retry}><TimingPanel read={read} /></PanelErrorBoundary></div>
    </div>
  </Page>;
}
