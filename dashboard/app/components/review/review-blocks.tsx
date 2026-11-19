// SPDX-License-Identifier: MIT
/**
 * Review's blocks (dashboard v2 screens section 8): Today, Latest review, Proposal, Earlier reviews, Reviewer health
 * and the disclosure on what the reviewer can and cannot do. Each block is a panel with the four states of
 * design-system section 3 and its own error boundary. Nothing here writes: the one control for an operator is a link
 * to the band editor with a proposal loaded.
 */
import { useId } from "react";
import { Link } from "react-router";
import { DailyBars } from "../../charts/daily-bars";
import { formatNumber, localDate, localTime, shortTime } from "../../lib/format";
import type { Review, ReviewPage, ReviewProposal } from "../../lib/operator-api";
import { OperatorOnly } from "../../lib/session";
import { words } from "../../lib/words";
import { StatusBadge } from "../badge";
import { Button } from "../button";
import { LocalTime } from "../common";
import { MetricTile, type TileState } from "../data/metric-tile";
import { Details } from "../details";
import { SectionHeader } from "../layout/section-header";
import { EmptyState, Panel, PanelError, PanelErrorBoundary, type PanelState } from "../panel";
import {
  NO_PROPOSAL, NO_REVIEWS, NO_REVIEWS_DETAIL, ON_DEMAND, OWNER_ONLY, PROPOSAL_APPLIES, PROPOSAL_IN_TEXT, REVIEWER_LIMITS, REVIEWER_LIMITS_TITLE,
} from "./copy";
import {
  HEALTH_DAYS, askedBy, bandEditorHref, changeRows, health, latestWritten, priceParts, proposalBadge, reviewDay, runTokenDays, speaksOfProposal, todayLine, tokenDays,
  tokenWords, type TokenWords,
} from "./review-model";
import { ReviewProse } from "./review-prose";

/** API-34 as the blocks read it: the newest first page, whether its newest read failed, whether none has answered. */
export type ReviewsRead = {
  readonly page: ReviewPage | null;
  readonly failed: boolean;
  readonly pending: boolean;
  /** When the page shown was read (ISO), for the panels' age and STALE line. */
  readonly readAt: string | null;
  readonly retry: () => void;
};

/** The panel state of a read: loading, its error, STALE over the last page, empty, or ready. */
export function readState(read: ReviewsRead, empty = false): PanelState {
  if (read.pending) return "loading";
  if (!read.page) return read.failed ? "error" : "loading";
  if (read.failed) return "stale";
  return empty ? "empty" : "ready";
}

const plural = (count: number, one: string, many = `${one}s`) => `${formatNumber(count, 0)} ${count === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------------- 1 Today
/** Row 1: today's review state in words with its times, or the failure in words with the attempts (R-08). */
export function TodayPanel({ read }: { read: ReviewsRead }) {
  const line = read.page ? todayLine(read.page.today, read.page.items) : null;
  return <PanelErrorBoundary thing="today's review" onRetry={read.retry}>
    <Panel title="Today" thing="today's review" state={readState(read)} reserve="sm" observedAt={read.readAt} onRetry={read.retry}
      pill={line && <StatusBadge status={line.badge.status}>{line.badge.text}</StatusBadge>}>
      {line && <div className="rv-today">
        <p className="rv-today-line" data-review="today">{line.before}{line.at && <LocalTime at={line.at} />}{line.after}</p>
        {line.window && <p className="meta">{line.window}</p>}
        {read.page && !read.page.proposal_waiting && <p className="meta" data-review="no-proposal">No band proposal is waiting for the owner.</p>}
        {read.page?.proposal_waiting && <p className="rv-today-waiting"><StatusBadge status="warn" size="sm">Proposal waiting</StatusBadge> The review of {reviewDay(read.page.proposal_waiting.review_date)} proposes a band change; it waits for the owner below.</p>}
      </div>}
    </Panel>
  </PanelErrorBoundary>;
}

// ---------------------------------------------------------------------------------------------------- 2 Latest review
/** "17 Nov at 07:03": when a review was written, its date in the words.md form like the review dates around it. */
function WrittenAt({ at }: { at: string }) {
  return <time dateTime={at} title={localTime(at)}>{reviewDay(localDate(at))} at {shortTime(at)}</time>;
}

/** The facts line of a review: who asked, when it was written and by whom, and its tokens. */
export function ReviewFacts({ review }: { review: Review }) {
  return <p className="meta rv-facts">
    {askedBy(review)}
    {review.written_at && <> · written by Iris on <WrittenAt at={review.written_at} /></>}
    {review.status === "failed" && <> · failed after {plural(review.attempts, "attempt")}</>}
    {review.total_tokens !== null && review.total_tokens !== undefined && <> · {plural(review.total_tokens, "token")}</>}
  </p>;
}

/** Row 2: the newest written review's summary as prose, its date and who asked for it (R-09). */
export function LatestPanel({ read }: { read: ReviewsRead }) {
  const latest = read.page ? latestWritten(read.page.items) : null;
  return <PanelErrorBoundary thing="the latest review" onRetry={read.retry}>
    <Panel title={latest ? `Latest review · ${reviewDay(latest.review_date)}` : "Latest review"} thing="the latest review" state={readState(read, !latest)} reserve="lg"
      observedAt={read.readAt} onRetry={read.retry} empty={<EmptyState message={NO_REVIEWS} detail={NO_REVIEWS_DETAIL} />}>
      {latest && <article className="rv-latest" data-review-id={latest.id}>
        <ReviewFacts review={latest} />
        {latest.summary ? <ReviewProse summary={latest.summary} /> : <p className="muted">This review has no summary.</p>}
      </article>}
    </Panel>
  </PanelErrorBoundary>;
}

// ---------------------------------------------------------------------------------------------------- 3 Proposal
/** A proposal's changes, reason, price note and state, with Open in the band editor for an operator (R-09, R-10). */
export function ProposalBody({ reviewId, proposal, state, stateShown = true }: { reviewId: number; proposal: ReviewProposal; state: string | null | undefined; stateShown?: boolean }) {
  const rows = changeRows(proposal);
  const price = priceParts(proposal.price);
  const badge = stateShown ? proposalBadge(state) : null;
  return <div className="rv-proposal" data-proposal={reviewId}>
    {(badge || state === "waiting") && <p className="rv-proposal-state">{badge && <><StatusBadge status={badge.status} size="sm">{badge.text}</StatusBadge> </>}{state === "waiting" && PROPOSAL_APPLIES}</p>}
    <ul className="rv-changes" aria-label="Proposed band changes">
      {rows.map((row) => <li key={row.key} className="rv-change" data-param={row.key}>
        <span className="rv-change-label">{row.label}</span>
        <span className="rv-change-values"><span>{row.current}</span><span aria-hidden="true"> → </span><span className="screen-reader"> to </span><strong>{row.proposed}</strong></span>
        <span className="rv-change-diff meta">{row.difference === "—" ? "difference unknown" : row.difference}</span>
      </li>)}
    </ul>
    {proposal.reason && <div className="rv-proposal-part"><h3>Reason</h3><p>{proposal.reason}</p></div>}
    {price.parts.length > 0 && <div className="rv-proposal-part">
      <h3>Price</h3>
      {price.lead && <p>{price.lead}:</p>}
      {price.parts.length > 1 ? <ul className="rv-price">{price.parts.map((part, index) => <li key={index}>{part}</li>)}</ul> : <p>{price.parts[0]}</p>}
    </div>}
    <OperatorOnly>
      <p className="rv-proposal-open"><Link className="btn btn-primary" to={bandEditorHref(reviewId)}>Open in the band editor</Link> <span className="meta">{OWNER_ONLY}</span></p>
    </OperatorOnly>
  </div>;
}

/** A review's proposal, or that it put its proposal in its text, or that it proposed none. */
function ProposalOf({ review, stateShown = true }: { review: Review; stateShown?: boolean }) {
  if (review.proposal) return <ProposalBody reviewId={review.id} proposal={review.proposal} state={review.proposal_state} stateShown={stateShown} />;
  if (speaksOfProposal(review.summary)) return <p className="rv-proposal-text" data-proposal="text">{PROPOSAL_IN_TEXT}</p>;
  return null;
}

/** Row 3: the latest review's proposal, if it made one (R-09, R-10). */
export function ProposalPanel({ read }: { read: ReviewsRead }) {
  const latest = read.page ? latestWritten(read.page.items) : null;
  const inText = latest !== null && !latest.proposal && speaksOfProposal(latest.summary);
  const empty = latest === null || (!latest.proposal && !inText);
  const badge = latest?.proposal ? proposalBadge(latest.proposal_state) : null;
  return <PanelErrorBoundary thing="the proposal" onRetry={read.retry}>
    <Panel title="Proposal" thing="the proposal" state={readState(read, empty)} reserve="md" observedAt={read.readAt} onRetry={read.retry}
      tone={latest?.proposal_state === "waiting" ? "warn" : undefined}
      pill={badge && <StatusBadge status={badge.status}>{badge.text}</StatusBadge>}
      empty={<EmptyState message={latest ? NO_PROPOSAL : NO_REVIEWS} detail={latest ? PROPOSAL_APPLIES : undefined} />}>
      {latest && <ProposalOf review={latest} stateShown={false} />}
    </Panel>
  </PanelErrorBoundary>;
}

// ---------------------------------------------------------------------------------------------------- 4 Earlier reviews
export type OlderPages = { readonly loading: boolean; readonly failed: boolean; readonly load: (() => void) | null };

/** One earlier review: its date, kind, state and whether it proposed a change; opening it shows its summary and proposal. */
export function EarlierRow({ review }: { review: Review }) {
  const statusBadge = review.status === "written" ? null : <StatusBadge status={review.status === "failed" ? "critical" : "info"} size="sm">{statusWords(review.status)}</StatusBadge>;
  const proposed = review.proposal ? proposalBadge(review.proposal_state) : null;
  return <li className="rv-earlier-row" data-review-id={review.id}>
    <Details className="rv-earlier-details" summary={<span className="rv-earlier-summary">
      <span className="rv-earlier-date">{reviewDay(review.review_date)}</span>
      <span className="rv-earlier-kind meta">{askedBy(review)}</span>
      {statusBadge}
      {review.proposal && <StatusBadge status={proposed?.status ?? "neutral"} size="sm">Proposed a change{proposed ? ` · ${proposed.text.toLowerCase()}` : ""}</StatusBadge>}
    </span>}>
      <div className="rv-earlier-body">
        <ReviewFacts review={review} />
        {review.status === "failed" && <p>{failureWords(review)}</p>}
        {review.summary && <ReviewProse summary={review.summary} />}
        <ProposalOf review={review} />
      </div>
    </Details>
  </li>;
}

const statusWords = (status: string): string => words("review_status", status);
function failureWords(review: Review): string {
  return `It failed after ${plural(review.attempts, "attempt")}: ${review.failure ? words("review_failure", review.failure) : "no reason was recorded"}.`;
}

/** Row 4: every review but the latest, newest first, paged by the API's cursor (R-11). */
export function EarlierPanel({ read, reviews, older }: { read: ReviewsRead; reviews: readonly Review[]; older: OlderPages }) {
  const latest = read.page ? latestWritten(read.page.items) : null;
  const rows = reviews.filter((review) => review.id !== latest?.id);
  return <PanelErrorBoundary thing="earlier reviews" onRetry={read.retry}>
    <Panel title="Earlier reviews" thing="earlier reviews" state={readState(read, rows.length === 0 && !older.load)} reserve="md" observedAt={read.readAt} onRetry={read.retry}
      empty={<EmptyState message="No earlier review yet." detail="Each day's review joins this list once a newer one is written." />}>
      {rows.length > 0 && <ol className="rv-earlier">{rows.map((review) => <EarlierRow key={review.id} review={review} />)}</ol>}
      {older.failed && <PanelError thing="older reviews" onRetry={older.load ?? undefined} />}
      {older.load && !older.failed && <div className="rv-more"><Button wide disabled={older.loading} onClick={older.load}>{older.loading ? "Loading older…" : "Load older reviews"}</Button></div>}
    </Panel>
  </PanelErrorBoundary>;
}

// ---------------------------------------------------------------------------------------------------- 5 Reviewer health
const tileState = (state: PanelState): TileState => (state === "loading" || state === "error" || state === "stale" || state === "empty" ? state : "ready");

/** "▲ 91% above the review before it": the arrow carries the direction in ink, the words say against what (`tokenWords`). */
function TokenComparison({ comparison }: { comparison: NonNullable<TokenWords["comparison"]> }) {
  const { direction, text } = comparison;
  return <span className="delta" data-direction={direction}>
    {direction !== "none" && <><span className={direction === "up" ? "glyph glyph-up" : "glyph glyph-down"} aria-hidden="true" />{" "}</>}{text}
  </span>;
}

/** Row 5 (side): the newest review's tokens against the reviews before it, attempts, failures in 30 days, and tokens per day (R-12). */
export function ReviewerHealth({ read, reviews }: { read: ReviewsRead; reviews: readonly Review[] }) {
  const headingId = useId();
  const page = read.page;
  const figures = page ? health(page, reviews) : null;
  const state = readState(read, reviews.length === 0);
  const tile = tileState(state);
  const runDays = page ? runTokenDays(page) : null;
  const days = page ? (runDays ?? tokenDays(reviews, page.today.review_date)) : [];
  const tokens = page ? tokenWords(page.tokens) : null;
  const empty = "No review yet";
  return <section className="rv-health" aria-labelledby={headingId}>
    <SectionHeader id={headingId} title="Reviewer health" />
    <div className="rv-health-tiles">
      <MetricTile label="Tokens, newest review" state={tile} empty={empty} onRetry={read.retry} tone={figures?.flagged ? "warn" : undefined} data={{ "data-tile": "tokens" }}
        value={figures && figures.last !== null ? plural(figures.last, "token") : null} reason={figures ? "not recorded" : undefined}
        delta={tokens?.comparison && <TokenComparison comparison={tokens.comparison} />}
        meta={tokens?.meta ?? undefined} />
      <MetricTile label="Attempts, newest review" state={tile} empty={empty} onRetry={read.retry} tone={figures && figures.attempts !== null && figures.attempts > 1 ? "warn" : undefined} data={{ "data-tile": "attempts" }}
        value={figures && figures.attempts !== null ? plural(figures.attempts, "attempt") : null}
        meta={figures && `${plural(figures.retries, "retry", "retries")} in the last ${HEALTH_DAYS} days.`} />
      <MetricTile label={`Failures, last ${HEALTH_DAYS} days`} state={tile} empty={empty} onRetry={read.retry} tone={figures && figures.failures > 0 ? "fault" : undefined} data={{ "data-tile": "failures" }}
        value={figures ? plural(figures.failures, "failure") : null}
        meta={figures && `Of ${plural(figures.reviews, "review")} since ${reviewDay(figures.since)}.`} />
    </div>
    <PanelErrorBoundary thing="tokens per review day" onRetry={read.retry}>
      <Panel title="Tokens per review day" headingLevel={3} thing="tokens per review day" state={readState(read, days.length === 0)} reserve="sm" observedAt={read.readAt} onRetry={read.retry}
        empty={<EmptyState message="No review has used tokens yet." />}
        foot={runDays
          ? `Total tokens of the reviews, daily and manual, that finished each day over the last ${HEALTH_DAYS} days. A day with no finished review is a gap.`
          : `Total tokens of each day's reviews over the last ${HEALTH_DAYS} days. A day with no written review is a gap.`}>
        {days.length > 0 && <DailyBars title="Tokens per review day" unit="tokens" days={days} token="--c-temp"
          format={(value) => formatNumber(Math.round(value), 0)} size="sm" captionHidden />}
      </Panel>
    </PanelErrorBoundary>
  </section>;
}

// ---------------------------------------------------------------------------------------------------- 6 the disclosure
/** Row 6: what the reviewer can and cannot do, collapsed (screens 8). */
export function ReviewerLimits() {
  return <Details className="card rv-limits" summary={REVIEWER_LIMITS_TITLE}>
    <ul className="rv-limits-list">{REVIEWER_LIMITS.map((line) => <li key={line}>{line}</li>)}</ul>
    <p className="meta">{ON_DEMAND}</p>
  </Details>;
}
