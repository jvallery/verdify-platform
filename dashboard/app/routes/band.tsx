// SPDX-License-Identifier: MIT
import { useSearchParams } from "react-router";
import { chartLinks } from "../charts/uplot-chart";
import { BandPreviewPanel } from "../components/band-preview";
import { BandDeliveryPanel, deliveryStatus, deliverySummary, edgeRows } from "../components/climate/band-delivery";
import { BandExplainer } from "../components/climate/band-explainer";
import { BandHistoryPanel } from "../components/climate/band-history";
import { BandProposalPanel, requestedProposal } from "../components/climate/band-proposal";
import { DryingLimit } from "../components/climate/drying-limit";
import { BandEditorPanel, previewProblem, useBandEditor, type BandEditor } from "../components/control/band-editor";
import { Page } from "../components/layout/page";
import { PageHeader } from "../components/layout/page-header";
import { PanelErrorBoundary } from "../components/panel";
import { useGraphClock } from "../lib/graph-reads";
import { panelRead, useLawRead, useSettingsRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";

/**
 * Climate → Band (screens §2.2): what band the house is held in. A waiting proposal first; then the band in words and
 * its preview over the solar day (API-23), the editor (operators), and beside them what the controller has of it, the
 * one price and the band's changes; how the band works last, collapsed. The editor edits edges only: every number the
 * person sees before saving is the number that is sent, and the preview is the server's. No greenhouse data renders in
 * SSR: data loads in the browser.
 */
export const meta = () => viewMeta("climate-band");
export const links = () => chartLinks();

/** The preview's message: the stored band failed, the draft does not read as a number, or its preview failed. */
function previewMessage(editor: BandEditor): string | null {
  if (editor.base.isError && !editor.stored) return null;
  if (editor.request && !editor.request.ok) return "Enter a number in every field you changed to preview the band.";
  if (editor.edited && editor.read.isError) return previewProblem(editor.read.error).message;
  return null;
}

/** The header's status, long and short: what the controller has of the band (block 4's summary). */
function useBandStatus(): { long: string | null; short: string | null } {
  const settings = panelRead(useSettingsRead());
  if (!settings.data) return settings.pending ? { long: null, short: null } : { long: "The band's delivery could not be read.", short: "Delivery not read" };
  const summary = deliverySummary(edgeRows(settings.data.items));
  return { long: deliveryStatus(summary), short: deliveryStatus(summary, true) };
}

export default function Band() {
  const [search] = useSearchParams();
  const editor = useBandEditor();
  const now = useGraphClock(true);
  const law = panelRead(useLawRead());
  const status = useBandStatus();
  const stored = editor.stored;
  const previewState = stored ? "ready" : editor.base.isError ? "error" : "loading";
  return <Page className="climate-page band-page">
    <PageHeader view="climate-band" status={status.long} statusShort={status.short ?? undefined} />
    <PanelErrorBoundary thing="the proposal">
      <BandProposalPanel requested={requestedProposal(search)} loaded={editor.draft?.proposal ?? null} ready={editor.baseDraft !== null} onLoad={editor.loadInto} />
    </PanelErrorBoundary>
    <div className="l-grid climate-grid band-grid">
      <div className="span-8 band-main l-stack">
        <PanelErrorBoundary thing="the band" onRetry={() => void editor.base.refetch()}>
          <BandPreviewPanel preview={editor.preview} edited={editor.edited} now={now} state={previewState} message={previewMessage(editor)}
            onRetry={() => void editor.base.refetch()} />
        </PanelErrorBoundary>
        <PanelErrorBoundary thing="the band editor"><BandEditorPanel editor={editor} /></PanelErrorBoundary>
      </div>
      <div className="span-4 climate-side band-side l-stack">
        <PanelErrorBoundary thing="the band on the controller"><BandDeliveryPanel lastSave={editor.lastSave} /></PanelErrorBoundary>
        <PanelErrorBoundary thing="the drying cost limit"><DryingLimit variant="band" headingLevel={2} /></PanelErrorBoundary>
        <PanelErrorBoundary thing="the band's changes"><BandHistoryPanel /></PanelErrorBoundary>
      </div>
      <div className="span-8 band-how">
        <BandExplainer lines={stored?.law_lines ?? null} hotLimit={law.data?.timing.hot_limit_f ?? stored?.guardrails.temp_max_f ?? null}
          coldLimit={law.data?.timing.cold_limit_f ?? stored?.guardrails.temp_min_f ?? null} />
      </div>
    </div>
  </Page>;
}
