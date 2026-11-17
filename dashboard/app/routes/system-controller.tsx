// SPDX-License-Identifier: MIT
import { chartLinks } from "../charts/uplot-chart";
import { Page } from "../components/layout/page";
import { PageHeader } from "../components/layout/page-header";
import { PanelErrorBoundary } from "../components/panel";
import { verdict } from "../components/system/budget";
import { BudgetSection, IdentityPanel, LawStatePanel, LinksPanel, VerdictPanel, uptimeWords } from "../components/system/controller-blocks";
import { ControllerTrends } from "../components/system/controller-trends";
import { RestartSection } from "../components/system/restart";
import { deviceState } from "../components/system/states";
import type { ControllerHealth } from "../lib/operator-api";
import { panelRead, useControllerHealthRead, useLawRead } from "../lib/queries";
import { useShellNow, useShellStatus } from "../lib/shell";
import { viewMeta } from "../lib/sections";

/**
 * System → Controller (screens section 10.2): whether the controller is healthy. The verdict, the hardware budget
 * against its limits, identity and uptime, links, the law's state (all API-35, with API-30's constants and running
 * alone), the trends (API-03 and API-04) and, for operators, Restart behind a disclosure. Each block has its own error
 * boundary; no data renders on the server.
 */
export const meta = () => viewMeta("system-controller");
export const links = () => chartLinks();

/** The status line: "Healthy · up 3 d 3 h", the verdict's title alone otherwise; null while API-35 has not answered. */
export function controllerStatus(health: ControllerHealth | null | undefined): string | null {
  if (!health) return null;
  const said = verdict(health);
  return said.level === "ok" && health.uptime_s !== null && health.uptime_s !== undefined ? `${said.title} · up ${uptimeWords(health.uptime_s)}` : said.title;
}

export default function SystemController() {
  const health = panelRead(useControllerHealthRead());
  const law = panelRead(useLawRead());
  const shell = useShellNow();
  const status = useShellStatus();
  const state = deviceState(health, status);
  const since = state === "ingestor_down" ? shell.data?.freshness.ingestor.observed_at : shell.data?.freshness.climate.observed_at;
  const props = { read: health, state, since };
  const line = controllerStatus(health.failed ? null : health.data);
  return <Page className="sys-page sys-controller">
    <PageHeader view="system-controller" status={line} statusShort={line} />
    <div className="l-stack sys-blocks">
      <PanelErrorBoundary thing="the verdict" onRetry={health.retry}><VerdictPanel {...props} /></PanelErrorBoundary>
      <PanelErrorBoundary thing="the hardware budget" onRetry={health.retry}><BudgetSection {...props} /></PanelErrorBoundary>
      <div className="sys-pair">
        <PanelErrorBoundary thing="the controller's identity" onRetry={health.retry}><IdentityPanel {...props} /></PanelErrorBoundary>
        <PanelErrorBoundary thing="the controller's links" onRetry={health.retry}><LinksPanel {...props} /></PanelErrorBoundary>
      </div>
      <PanelErrorBoundary thing="the law's state" onRetry={health.retry}><LawStatePanel {...props} law={law} /></PanelErrorBoundary>
      <PanelErrorBoundary thing="the controller's trends"><ControllerTrends health={health} /></PanelErrorBoundary>
      <PanelErrorBoundary thing="the restart"><RestartSection /></PanelErrorBoundary>
    </div>
  </Page>;
}
