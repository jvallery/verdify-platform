// SPDX-License-Identifier: MIT
/**
 * Daily review on Now (dashboard v2 screens §1 block 7): the newest review's first paragraph, its date and state, and
 * "Read ›" into Review (API-34 limit 1). The review explains; it changes nothing on the controller. A late or failed
 * review and a waiting proposal are in Needs you; here they read as the review's own state.
 */
import { Link } from "react-router";
import type { Review, ReviewPage } from "../../lib/operator-api";
import { READ_INTERVAL_MS, panelRead, useApiRead } from "../../lib/queries";
import { words } from "../../lib/words";
import { Panel, type PanelState } from "../panel";

export const REVIEW_PARAMS = { limit: 1 } as const;
export const NO_REVIEW = "No daily review written yet.";

/** The first paragraph of a review's text: up to its first blank line, trimmed; null with none. */
export function firstParagraph(summary: string | null | undefined): string | null {
  const text = (summary ?? "").trim();
  if (!text) return null;
  return text.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
}

/** "Nov 1 · Written", "Nov 1 · Failed: the reviewer could not be reached". */
export function reviewState(review: Pick<Review, "review_date" | "status" | "failure" | "kind">): string {
  const parsed = Date.parse(`${review.review_date}T12:00:00Z`);
  const day = Number.isFinite(parsed) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed) : review.review_date;
  const failure = review.status === "failed" && review.failure ? `: ${words("review_failure", review.failure)}` : "";
  return `${words("review_kind", review.kind)} for ${day} · ${words("review_status", review.status)}${failure}`;
}

export function NowReview() {
  const read = panelRead(useApiRead("API-34", REVIEW_PARAMS, { intervalMs: READ_INTERVAL_MS.reviews }));
  const page: ReviewPage | null = read.failed && !read.data ? null : read.data;
  const review = page?.items[0] ?? null;
  const state: PanelState = read.failed && !read.data ? "error" : !read.data ? "loading" : review ? "ready" : "empty";
  const text = review ? firstParagraph(review.summary) : null;
  return <Panel id="daily-review" title="Daily review" thing="the daily review" state={state} reserve="sm" onRetry={read.retry} empty={NO_REVIEW}
    link={{ to: "/review", label: <>Read<span className="screen-reader"> the daily review</span></> }}>
    {review && <>
      <p className="meta" data-review="state">{reviewState(review)}</p>
      {text ? <p className="now-review-text" data-review="text">{text}</p> : <p className="meta" data-review="text">No text in this review.</p>}
      {page?.proposal_waiting && <p data-review="proposal"><Link to="/review">A band proposal is waiting for you<span aria-hidden="true">{" ›"}</span></Link></p>}
    </>}
  </Panel>;
}
