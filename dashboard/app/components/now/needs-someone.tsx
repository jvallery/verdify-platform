// SPDX-License-Identifier: MIT
/**
 * Needs you (dashboard v2 screens §1 block 3; US-ACT-02): what asks something of a person, worst first, in one list card.
 * - The top three alerts nobody has acknowledged (API-14 rows with `status` open), in API-14's order (by severity then
 *   age), each an `AlertRow` with "Details ›" into Activity and, for operators, Acknowledge with an optional note in an
 *   "Add a note" disclosure. Acknowledge sends one API-15 request with one `Idempotency-Key`; the row is
 *   removed from this action list once the server confirms it; Activity retains the acknowledgement.
 * - A mister's watchdog back-off or latch (API-IRR-01 `lines[].fault`), with Clear fault on a latch. A latch whose
 *   `irrigation_line_faulted` alert is in the list carries its Clear fault on that alert's row instead, so it reads once.
 * - The daily review late or failed (API-02 `review`), with Open into Review; the `daily_review_missed` alert is this
 *   row, so it is not listed twice.
 * - A band proposal waiting for the owner (API-02 `review.proposal_waiting`), with Open into Review.
 * - "N settings not confirmed ›" (API-02 `writer.differing`), into System → Data, unless the stuck delivery banner
 *   already says so.
 * A fence breach's row points to Stop all water rather than repeating it: a page holds one.
 *
 * The open-alert count shows in the head unless the page's answer already counts the alerts (redesign §2.5: the count
 * appears once in the page body). "No open alerts" only after a successful read while the heartbeat and climate are
 * fresh: "Nothing needs you.", with what was resolved in the last 24 h: "3 resolved in 24 h ›" into Activity's resolved
 * group, or "nothing resolved in 24 h" with no link to an empty page. Otherwise "In-app alerts may be
 * missing: …"; a failed read reads "Alerts unavailable". The read is Activity's (API-14 `status=recent`), one shared key.
 */
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { shortTime } from "../../lib/format";
import type { NowAnswer } from "../../lib/now-answer";
import type { Alert, AlertPage, IrrigationLine, IrrigationStatus, Now } from "../../lib/operator-api";
import { RESOLVED_24H, isClosed, personName } from "../../lib/activity";
import type { PanelRead } from "../../lib/queries";
import { OperatorOnly } from "../../lib/session";
import { useMe } from "../../lib/shell";
import { words } from "../../lib/words";
import { Acknowledge } from "../activity/acknowledge";
import { ALERTS_UNAVAILABLE, AlertRow, NO_OPEN_ALERTS, alertListEmptyText } from "../alert-row";
import { Button } from "../button";
import { ClearFaultButton } from "../clear-fault-button";
import { Chevron } from "../layout/chevron";
import { ObjectRow } from "../layout/object-row";
import { ListCard, type ListCardProps } from "../layout/list-card";
import type { PanelState } from "../panel";
import { lineName } from "./status";

/** Now lists this many. */
export const TOP_ALERTS = 3;
export const NOT_CONFIRMED_HREF = "/system/data";
export const NOTHING_NEEDS_YOU = "Nothing needs you.";
export const NEEDS_YOU_ID = "needs-you";
const SEVERITY_RANK: Readonly<Record<string, number>> = { critical: 0, warning: 1, info: 2 };
const rank = (severity: string) => SEVERITY_RANK[severity] ?? 3;
const validTime = (value: string | null | undefined): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/**
 * The rows Now shows: unacknowledged alerts (`status` open), excluding successful acknowledgements still present
 * in a stale read, at most three. API-14 lists them by severity, then age (`verdify_services.alerts`: last seen, newest first); Now
 * keeps that order, so its top three are the first unacknowledged rows Activity lists, and only guards the severity
 * order. The read also holds the alerts resolved in the last 24 h, which never show here.
 */
export function openAlertsOf(items: readonly Alert[], dismissed: ReadonlyMap<number, Alert> = new Map()): Alert[] {
  return items.filter((alert) => alert.status === "open" && (() => {
    const ack = dismissed.get(alert.id);
    if (!ack) return true;
    // Repeats merge under the original ID. A newer occurrence needs attention again.
    const seen = (row: Alert) => Date.parse(row.last_seen_at ?? row.first_seen_at);
    return (alert.count ?? 1) > (ack.count ?? 1) || seen(alert) > seen(ack);
  })())
    .map((alert, index) => ({ alert, index }))
    .sort((a, b) => rank(a.alert.severity) - rank(b.alert.severity) || a.index - b.index)
    .map(({ alert }) => alert);
}
/** The first three of `openAlertsOf`: the rows Now shows. */
export function topAlerts(items: readonly Alert[], dismissed: ReadonlyMap<number, Alert> = new Map()): Alert[] {
  return openAlertsOf(items, dismissed).slice(0, TOP_ALERTS);
}

/** The acknowledgements this page made, kept until the next read shows them (shared by the hero's count and the list). */
export type Dismissed = { readonly acknowledged: ReadonlyMap<number, Alert>; readonly dismiss: (alert: Alert) => void };
export function useDismissed(): Dismissed {
  const [acknowledged, setAcknowledged] = useState<ReadonlyMap<number, Alert>>(() => new Map());
  const dismiss = useCallback((alert: Alert) => setAcknowledged((rows) => new Map(rows).set(alert.id, alert)), []);
  return { acknowledged, dismiss };
}

/** What Needs you takes from its reads; the hero counts the same (`needsTally`). */
export type NeedsInput = {
  readonly alerts: AlertPage | null | undefined;
  readonly review: Now["review"] | null | undefined;
  readonly lines: readonly Pick<IrrigationLine, "line_id" | "fault">[] | null | undefined;
  readonly dismissed?: ReadonlyMap<number, Alert>;
};
/**
 * How many things Needs you lists, as the hero's headline counts them (B11: the headline counts what the panel lists):
 * every open alert nobody has acknowledged (the review's own `daily_review_missed` alert folded into its late row), a
 * late or failed review, a waiting band proposal and each mister fault no open alert names. Null before the alerts read
 * answers, when the hero counts API-02's open alerts instead. The settings not confirmed are a link, not a thing.
 */
export function needsTally({ alerts, review, lines, dismissed }: NeedsInput): number | null {
  if (!alerts) return null;
  const late = reviewRow(review);
  const open = openAlertsOf(alerts.items.filter((alert) => !(late && alert.alert_type === "daily_review_missed")), dismissed);
  const latched = new Set(open.map(faultedLine).filter((line): line is string => line !== null));
  const faults = (lines ?? []).filter((line) => line.fault && !latched.has(line.line_id)).length;
  return open.length + (late ? 1 : 0) + (review?.proposal_waiting ? 1 : 0) + faults;
}

export const RESOLVED_HREF = `/activity?resolved=${RESOLVED_24H}`;
/**
 * The alerts resolved in the last 24 h on API-14's page (resolved, a false positive or suppressed, as Activity's group
 * counts them); null when the page was cut short, where a count would only be a floor.
 */
export function resolvedCount(page: Pick<AlertPage, "items" | "next_cursor"> | null | undefined): number | null {
  if (!page || page.next_cursor) return null;
  return page.items.filter(isClosed).length;
}

/**
 * The empty line: what an empty list may honestly say (`coverage`). "No open alerts" adds what was resolved in the last
 * 24 h, linked into Activity's resolved group only when something is there, and uncounted when the count is unknown.
 */
export function emptyLine(coverage: string, resolved: number | null): NonNullable<ListCardProps["empty"]> {
  if (coverage !== NO_OPEN_ALERTS) return { message: coverage };
  if (resolved === 0) return { message: `${NOTHING_NEEDS_YOU} Nothing resolved in 24 h.` };
  const label = resolved === null ? "Resolved in the last 24 h" : `${resolved} resolved in 24 h`;
  return { message: NOTHING_NEEDS_YOU, widen: { to: RESOLVED_HREF, label: <>{label}<Chevron /></> } };
}

/** The daily review's row: late (missed) or failed; null otherwise. */
export function reviewRow(review: Now["review"] | null | undefined): { readonly tone: "warn" | "fault"; readonly title: string; readonly state: string } | null {
  if (!review) return null;
  const day = shortDate(review.review_date);
  if (review.status === "failed") return { tone: "fault", title: `Daily review failed for ${day}`, state: "The reviewer could not write it. Review says why and can ask again." };
  if (review.missed) return { tone: "warn", title: `Daily review late for ${day}`, state: "It was due after 07:00 and has not been written." };
  return null;
}
/** "Nov 1" from a local date. */
function shortDate(date: string): string {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed) : date;
}

/** The line an `irrigation_line_faulted` alert names, when it does. */
const faultedLine = (alert: Alert): string | null => {
  const value = alert.alert_type === "irrigation_line_faulted" ? alert.details?.line_id : null;
  return typeof value === "string" ? value : null;
};

/** A mister's back-off or latch in words (D-IRP-19): "South mister: backing off until 13:20", "Center mister: faulted, no misting until midnight (watchdog)". */
export function faultText(line: Pick<IrrigationLine, "line_id" | "name" | "fault" | "fault_until">): string {
  const name = lineName(line);
  if (line.fault === "backing_off") return `${name}: backing off${validTime(line.fault_until) ? ` until ${shortTime(line.fault_until)}` : ""}`;
  if (line.fault === "mister_fault") return `${name}: faulted, no misting until midnight (watchdog)`;
  return `${name}: ${words("line_fault", line.fault ?? "")}`;
}

export type NeedsYouProps = {
  /** API-14 `status=recent` (`RECENT_ALERTS`): the open alerts and those resolved in the last 24 h. */
  readonly alerts: PanelRead<AlertPage>;
  /** The newest API-02 answer, for the freshness that vouches for an empty list; null before the first. */
  readonly now: Now | null;
  readonly answer: Pick<NowAnswer, "kind">;
  /** The newest API-02 read failed: its freshness is old news, so an empty list cannot vouch for itself. */
  readonly apiFailed: boolean;
  /** API-02 `alerts.open`: the head's count until the alerts read answers; null while unknown. */
  readonly openCount: number | null;
  readonly irrigation: PanelRead<IrrigationStatus>;
  /** The page's acknowledgements (`useDismissed`), shared with the hero's count; the panel keeps its own when omitted. */
  readonly dismissed?: Dismissed;
};

export function NeedsYou({ alerts, now, answer, apiFailed, openCount, irrigation, dismissed }: NeedsYouProps) {
  const me = useMe();
  // Remove only after API-15 confirms success, including while an older poll is still in flight.
  const own = useDismissed();
  const { acknowledged, dismiss } = dismissed ?? own;
  const freshness = apiFailed || !now ? null : now.freshness;
  const review = now && !apiFailed ? now.review ?? null : null;
  const late = reviewRow(review);
  const proposal = review?.proposal_waiting === true;
  // The review's late row is the daily_review_missed alert: it is not listed twice.
  const items = alerts.data ? topAlerts(alerts.data.items.filter((alert) => !(late && alert.alert_type === "daily_review_missed")), acknowledged) : [];
  const status = irrigation.failed ? null : irrigation.data;
  const latched = new Set(items.map(faultedLine).filter((line): line is string => line !== null));
  const faults = (status?.lines ?? []).filter((line) => line.fault && !latched.has(line.line_id));
  const differing = now && !apiFailed && !now.writer.stuck && now.writer.differing > 0 ? now.writer.differing : 0;
  // An empty list vouches for itself only with API-02's freshness: hold the panel until API-02 first answers.
  const waiting = alerts.pending || (!now && !apiFailed);
  const anything = items.length > 0 || faults.length > 0 || differing > 0 || late !== null || proposal;
  const state: PanelState = alerts.failed && !anything ? "error" : waiting || (!alerts.data && !alerts.failed) ? "loading" : anything ? "ready" : "empty";
  const coverage = alertListEmptyText({ readOk: true, ingestor: freshness?.ingestor, climate: freshness?.climate });
  // The count shows once in the page body: here, unless the answer already reads it; and never "· 0" beside the empty line.
  // It counts the open alerts of the list below once the read answers, so the head and the rows agree.
  const listed = alerts.data ? openAlertsOf(alerts.data.items, acknowledged).length : openCount;
  const count = answer.kind === "needs" || listed === null || listed < 1 ? null : listed;
  return <ListCard id={NEEDS_YOU_ID} title="Needs you" count={count} thing="alerts" state={state} reserve="sm" onRetry={alerts.retry}
    errorText={ALERTS_UNAVAILABLE} link={{ to: "/activity", label: "All alerts" }} empty={emptyLine(coverage, resolvedCount(alerts.data))}>
    {alerts.failed && <p className="fault now-needs-note">{ALERTS_UNAVAILABLE}. <Button onClick={alerts.retry}>Retry</Button></p>}
    {!alerts.failed && coverage !== NO_OPEN_ALERTS && <p className="meta now-needs-note" data-alerts="coverage">{coverage}</p>}
    {items.length > 0 && <ol className="alert-list now-alerts">
      {items.map((alert) => {
        const line = faultedLine(alert);
        const latch = line ? status?.lines.find((row) => row.line_id === line) : undefined;
        const breach = alert.alert_type === "irrigation_fence_breach" && alert.status === "open";
        // The API names people by username; the signed-in person reads by name, as on Activity.
        const named = alert.acknowledged_by ? { ...alert, acknowledged_by: personName(alert.acknowledged_by, me) } : alert;
        return <AlertRow key={alert.id} alert={named} openTo={`/activity?alert=${alert.id}`}
          action={latch && status ? <ClearFaultButton line={latch} engine={status.engine} /> : undefined}
          acknowledge={alert.status === "open" ? <Acknowledge alert={alert} onAcknowledged={dismiss} /> : undefined}>
          {/* Quick actions are an operator's: a viewer is never pointed at a control that is not there. */}
          {breach && <OperatorOnly><p className="meta now-breach-note">Stop all water is under Water today.</p></OperatorOnly>}
        </AlertRow>;
      })}
    </ol>}
    {(late || proposal) && <ul className="alert-list now-review-rows">
      {late && <ObjectRow as="li" title={late.title} tone={late.tone} className="now-review-row" data={{ "data-needs": "review" }} state={late.state}
        primary={<Link className="btn" to="/review">Open<span className="screen-reader"> the review</span></Link>} />}
      {proposal && <ObjectRow as="li" title="A band proposal is waiting for you" tone="warn" className="now-review-row" data={{ "data-needs": "proposal" }}
        state="The daily review proposes a change to the band. Only you can accept it." primary={<Link className="btn" to="/review">Open<span className="screen-reader"> the proposal</span></Link>} />}
    </ul>}
    {faults.length > 0 && <ul className="alert-list now-faults">
      {faults.map((line) => <ObjectRow key={line.line_id} as="li" title={faultText(line)} tone="warn" className="now-fault" data={{ "data-water": "fault" }}
        state={line.fault === "backing_off" ? "The watchdog paused misting on this line; it resumes by itself." : "The watchdog latched this line after repeated faults."}
        stop={status ? <ClearFaultButton line={line} engine={status.engine} /> : undefined} />)}
    </ul>}
    {differing > 0 && <p className="now-unconfirmed"><Link to={NOT_CONFIRMED_HREF}>{differing === 1 ? "1 setting" : `${differing} settings`} not confirmed by the controller<span className="screen-reader"> in System, Data</span><Chevron /></Link></p>}
  </ListCard>;
}
