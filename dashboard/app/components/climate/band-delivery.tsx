// SPDX-License-Identifier: MIT
import { bandAnchorUnit, bandAnchorWords } from "../../lib/band-words";
import { formatNumber, formatValue, sentenceStart, shortTime, unitDecimals } from "../../lib/format";
import type { DesiredSetting, LawView, Setting } from "../../lib/operator-api";
import { panelRead, useLawRead, useSettingsRead, type PanelRead } from "../../lib/queries";
import { ReadbackBadge } from "../badge";
import { Panel, type PanelState } from "../panel";
import { StateReasonLine } from "../state-reason-line";
import { EDGE_ANCHORS } from "./band-draft";

/**
 * Band block 4 (screens §2.2, parity K-05 and K-06): what the controller has of the band. Each of the sixteen edges'
 * newest write as API-09 reads it back (requested until the controller's readback equals it, then confirmed, or not
 * confirmed with its reason), the last Save of this visit, and the band in force on the controller this minute (API-30).
 * The page header's status line is this block's summary.
 */

export type DeliveryRow = { readonly param: string; readonly words: string; readonly unit: string; readonly setting: Setting };
/** The sixteen edge rows of API-09, in the band's order; a row the catalog lacks is left out. */
export function edgeRows(items: readonly Setting[]): DeliveryRow[] {
  return EDGE_ANCHORS.flatMap((param) => {
    const setting = items.find((item) => item.param === param);
    return setting ? [{ param, words: sentenceStart(bandAnchorWords(param) ?? param), unit: bandAnchorUnit(param) ?? "", setting }] : [];
  });
}

export type DeliverySummary = {
  readonly total: number;
  readonly waiting: readonly DeliveryRow[];
  readonly failing: readonly DeliveryRow[];
  /** The newest confirmation among the edges, if any. */
  readonly confirmedAt: string | null;
  /** The badge state that sums the edges up. */
  readonly state: "confirmed" | "requested" | "not_confirmed";
};
export function deliverySummary(rows: readonly DeliveryRow[]): DeliverySummary {
  const waiting = rows.filter((row) => row.setting.state === "requested");
  const failing = rows.filter((row) => row.setting.state === "not_confirmed");
  const confirmedAt = rows.map((row) => row.setting.desired?.confirmed_at ?? null).filter((at): at is string => at !== null).sort().at(-1) ?? null;
  return { total: rows.length, waiting, failing, confirmedAt, state: failing.length ? "not_confirmed" : waiting.length ? "requested" : "confirmed" };
}

/** The header's status line: what the controller has of the band. */
export function deliveryStatus(summary: DeliverySummary, short = false): string {
  if (summary.total === 0) return "The band's edges are not in the settings catalog";
  const parts: string[] = [];
  if (summary.failing.length) parts.push(`${summary.failing.length} ${summary.failing.length === 1 ? "edge" : "edges"} not confirmed`);
  if (summary.waiting.length) parts.push(`${summary.waiting.length} waiting for the controller`);
  if (parts.length) return parts.join(" · ");
  return short ? "Every edge confirmed" : `The controller has confirmed every edge${summary.confirmedAt ? `, last at ${shortTime(summary.confirmedAt)}` : ""}`;
}

/** "70.2–83.9 °F": a low and a high at the unit's decimals. */
const range = (low: number | null, high: number | null, unit: string) =>
  (low === null || high === null ? "not reported" : `${formatNumber(low, unitDecimals(unit))}–${formatValue(high, unit)}`);
/** The band in force this minute on the controller, in words (API-30 `band`). */
export function inForceText(band: LawView["band"]): string {
  const text = `In force on the controller now: ${range(band.temp_low_f, band.temp_high_f, "°F")} and ${range(band.vpd_low_kpa, band.vpd_high_kpa, "kPa")}.`;
  return band.differs ? `${text} It differs from the band the host is sending; Climate law shows both.` : text;
}

function RowLine({ row }: { row: DeliveryRow }) {
  const desired = row.setting.desired;
  return <li>
    <span className="band-change-name">{row.words}</span>{" "}
    <ReadbackBadge state={row.setting.state} readbackVia={row.setting.readback_via} />{" "}
    {desired && <span className="meta">sent {formatValue(desired.value, row.unit)} at {shortTime(desired.created_at)}</span>}
    <StateReasonLine state={row.setting.state} reason={desired?.state_reason} requestedAt={desired?.created_at} unit={row.unit} />
  </li>;
}

/** What the last Save of this visit sent, and how many of those the controller has confirmed. */
function SaveLine({ save, rows }: { save: { readonly at: string; readonly rows: readonly DesiredSetting[] }; rows: readonly DeliveryRow[] }) {
  const sent = save.rows.filter((item) => EDGE_ANCHORS.includes(item.param));
  const confirmed = sent.filter((item) => rows.find((row) => row.param === item.param)?.setting.state === "confirmed").length;
  const words = `${sent.length} ${sent.length === 1 ? "edge" : "edges"}`;
  return <p className="band-save-line">You saved {words} at {shortTime(save.at)}; {confirmed === sent.length ? `the controller has confirmed ${sent.length === 1 ? "it" : "them all"}.` : `${confirmed} of ${sent.length} confirmed so far.`}</p>;
}

export function deliveryState(settings: Pick<PanelRead<unknown>, "data" | "failed" | "pending">): PanelState {
  if (settings.pending) return "loading";
  if (!settings.data) return "error";
  return settings.failed ? "stale" : "ready";
}

/** Block 4: the edges' delivery, the last Save of this visit and the band in force. */
export function BandDeliveryPanel({ lastSave }: { lastSave: { readonly at: string; readonly rows: readonly DesiredSetting[] } | null }) {
  const settings = panelRead(useSettingsRead());
  const law = panelRead(useLawRead());
  const rows = settings.data ? edgeRows(settings.data.items) : [];
  const summary = deliverySummary(rows);
  const open = [...summary.failing, ...summary.waiting];
  return <Panel title="On the controller" thing="the band's delivery" state={deliveryState(settings)} onRetry={settings.retry}
    pill={rows.length ? <ReadbackBadge state={summary.state} /> : undefined} link={{ to: "/climate", label: "Climate law" }}>
    {lastSave && <SaveLine save={lastSave} rows={rows} />}
    <p>{summary.total === 0 ? "The settings catalog lists none of the band's edges." : open.length
      ? `${open.length} of ${summary.total} edges are not confirmed by the controller's readback yet:`
      : `The controller has read back all ${summary.total} edges${summary.confirmedAt ? `; the last was confirmed at ${shortTime(summary.confirmedAt)}` : ""}.`}</p>
    {open.length > 0 && <ul className="band-delivery">{open.map((row) => <RowLine key={row.param} row={row} />)}</ul>}
    <p className="meta">{law.data ? inForceText(law.data.band) : law.pending ? "Reading the band in force…" : "The band in force could not be read."}</p>
  </Panel>;
}
