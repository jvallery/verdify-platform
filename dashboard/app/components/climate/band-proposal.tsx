// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from "react";
import { bandAnchorUnit } from "../../lib/band-words";
import { dayMonth, formatValue } from "../../lib/format";
import type { Review, ReviewPage, ReviewProposal } from "../../lib/operator-api";
import { panelRead, useReviewsRead, type PanelRead } from "../../lib/queries";
import { OperatorOnly, useRole, useWritesEnabled } from "../../lib/session";
import { StatusBadge } from "../badge";
import { Button } from "../button";
import { Panel } from "../panel";
import { priceParts, proposalBadge } from "../review/review-model";
import { bandRowWords } from "./band-draft";

/**
 * Band block 1 (screens §2.2, parity R-09 and R-10): a band change the daily review proposes, when one waits or when the
 * page opens with `?proposal=<review id>`. Each change as the edge in words, the stored value then and the proposed one;
 * the reason; the price as the review quotes it, one quoted row a line (Review's `priceParts`). "Load into the editor" fills the draft through
 * the anchor overrides (`band-draft.ts` `loadProposal`), and the owner still saves; `?proposal=` loads it on arrival for
 * an operator. Dismiss hides it for this visit. A viewer sees it with no control.
 */

/** `?proposal=<review id>`: the proposal to load on arrival; null when absent or not a review id. */
export function requestedProposal(search: URLSearchParams): number | null {
  const value = Number(search.get("proposal"));
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** The proposal the page shows: the one the URL names, else the one waiting; null when neither. */
export function proposalReview(page: Pick<ReviewPage, "items" | "proposal_waiting">, requested: number | null): Review | null {
  const id = requested ?? page.proposal_waiting?.review_id ?? null;
  if (id === null) return null;
  return page.items.find((item) => item.id === id) ?? null;
}

export type ProposalLine = { readonly param: string; readonly words: string; readonly current: string; readonly proposed: string };
/** Each change: the band row in words (never the catalog's label), its value then and the proposed one, with its unit. */
export function proposalLines(proposal: Pick<ReviewProposal, "changes">): ProposalLine[] {
  return proposal.changes.map((change) => {
    const unit = bandAnchorUnit(change.param) ?? change.unit ?? null;
    return {
      param: change.param, words: bandRowWords(change.param) ?? `Unknown (${change.param})`,
      current: formatValue(change.current, unit).replace(/\s?(°F|kPa)$/, ""), proposed: formatValue(change.proposed, unit),
    };
  });
}

export type BandProposalPanelProps = {
  /** The review the URL names (`?proposal=`), if any. */
  requested: number | null;
  /** The review whose proposal the draft holds, if any. */
  loaded: number | null;
  /** The editor has its band and can take a proposal. */
  ready: boolean;
  /** Loads the proposal into the draft; returns the params it left out (not one of the band's rows). */
  onLoad: (reviewId: number, proposal: ReviewProposal) => readonly string[];
};

function ProposalBody({ review, proposal }: { review: Review; proposal: ReviewProposal }) {
  const lines = proposalLines(proposal);
  const price = priceParts(proposal.price);
  return <>
    <p className="band-proposal-lead">The daily review of {dayMonth(review.review_date)} proposes a change:</p>
    <ul className="band-changes">{lines.map((line) => <li key={line.param}><span className="band-change-name">{line.words}</span>{" "}
      <span className="band-change-values num">{line.current} <span aria-hidden="true">→</span><span className="screen-reader"> to </span> {line.proposed}</span></li>)}</ul>
    {proposal.reason && <p className="band-proposal-why"><strong>Why:</strong> {proposal.reason}</p>}
    {price.parts.length > 0 && <div className="band-proposal-price">
      <p className="meta">{price.lead ? `Its price, as the review quotes it (${price.lead}):` : "Its price, as the review quotes it:"}</p>
      <ul>{price.parts.map((line, index) => <li key={index}>{line}</li>)}</ul>
    </div>}
  </>;
}

/** Block 1: the proposal with Load into the editor and Dismiss; nothing while no proposal waits and none is named. */
export function BandProposalPanel({ requested, loaded, ready, onLoad }: BandProposalPanelProps) {
  const read: PanelRead<ReviewPage> = panelRead(useReviewsRead());
  const role = useRole();
  const writesEnabled = useWritesEnabled();
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [ignored, setIgnored] = useState<readonly string[]>([]);
  const review = read.data ? proposalReview(read.data, requested) : null;
  const proposal = review?.proposal ?? null;
  // ?proposal=<id> loads it once on arrival, for an operator, once the editor has its band.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || requested === null || !review || !proposal || !ready || role !== "operator" || !writesEnabled) return;
    arrived.current = true;
    setIgnored(onLoad(review.id, proposal));
  }, [requested, review, proposal, ready, role, writesEnabled, onLoad]);
  if (read.pending) return requested === null ? null : <Panel title="Proposal from the daily review" thing="the proposal" state="loading" />;
  if (!read.data) {
    return <Panel title="Proposal from the daily review" thing="the daily reviews" state="error" onRetry={read.retry}
      errorText="The daily reviews could not be read, so a waiting proposal cannot show here." />;
  }
  if (requested === null && !review) return null;
  if (review && dismissed === review.id) return null;
  if (!review || !proposal) {
    return <Panel title="Proposal from the daily review" thing="the proposal" state="empty"
      empty={<p className="meta">{review ? `The review of ${dayMonth(review.review_date)} proposed no band change.` : `Review ${requested} is not among the newest ${read.data.items.length} reviews.`}</p>} />;
  }
  const badge = proposalBadge(review.proposal_state);
  const isLoaded = loaded === review.id;
  return <Panel title="Proposal from the daily review" thing="the proposal" state={read.failed ? "stale" : "ready"} observedAt={review.written_at}
    tone={review.proposal_state === "waiting" ? "warn" : undefined} link={{ to: "/review", label: "Review" }}
    pill={badge ? <StatusBadge status={badge.status} size="sm">{badge.text}</StatusBadge> : undefined}>
    <ProposalBody review={review} proposal={proposal} />
    {ignored.length > 0 && <p className="meta">{ignored.length === 1 ? "One change names" : `${ignored.length} changes name`} no row of the band, so the editor leaves {ignored.length === 1 ? "it" : "them"} out.</p>}
    <OperatorOnly>
      <div className="band-proposal-actions">
        <Button variant={isLoaded ? "default" : "primary"} disabled={isLoaded || !ready || !writesEnabled} onClick={() => setIgnored(onLoad(review.id, proposal))}>
          {isLoaded ? "Loaded" : "Load into the editor"}
        </Button>
        <Button variant="quiet" onClick={() => setDismissed(review.id)}>Dismiss</Button>
      </div>
      <p className="meta">{isLoaded ? "Loaded into the editor below. Nothing changes until the band is saved." : "Loading fills the editor; nothing changes until the band is saved."}</p>
    </OperatorOnly>
    {role !== "operator" && <p className="meta">Only the owner loads a proposal into the editor and saves it.</p>}
  </Panel>;
}
