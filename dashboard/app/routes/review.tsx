// SPDX-License-Identifier: MIT
/**
 * Review at `/review` (dashboard v2 screens section 8; parity R-08 to R-12): what the daily review said, and whether a
 * proposal is waiting for the owner. In reading order: Today (the state of today's review in words with its times, or
 * its failure and attempts), Latest review (the summary as prose), Proposal (each change as current → proposed, the
 * reason, the price, its state, and Open in the band editor for an operator), Earlier reviews (paged by the API's
 * cursor, each opening in place), Reviewer health at the side above 860 px (tokens against the reviews before the newest, attempts,
 * failures in 30 days and tokens per review day), then what the reviewer can and cannot do.
 *
 * One read, API-34 (`useReviewsRead`, every 60 s); older pages load on request from its `next_cursor` and are read again
 * on each poll from the newest, so a new review never leaves a gap. Nothing here writes: the one control goes to the
 * band editor. No greenhouse data renders on the server: the server render is the loading state.
 */
import { useEffect, useState } from "react";
import { chartLinks } from "../charts/uplot-chart";
import { Page } from "../components/layout/page";
import { PageHeader } from "../components/layout/page-header";
import { EarlierPanel, LatestPanel, ProposalPanel, ReviewerHealth, ReviewerLimits, TodayPanel, type OlderPages, type ReviewsRead } from "../components/review/review-blocks";
import { headerStatus, mergeReviews } from "../components/review/review-model";
import { apiGet, type ParamsOf, type Review as ReviewItem } from "../lib/operator-api";
import { READ_INTERVAL_MS, readKey, useReviewsRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";
import { usePolledQuery } from "../lib/use-current";

export const meta = () => viewMeta("review");
export const links = () => chartLinks();

type Older = { readonly items: readonly ReviewItem[]; readonly next_cursor: string | null; readonly pages: number };

/** Up to `pages` API-34 pages from `start`, each from the previous one's `next_cursor`. */
export async function fetchOlder(params: ParamsOf<"API-34">, start: string | null, pages: number, signal: AbortSignal): Promise<Older> {
  const items: ReviewItem[] = [];
  let cursor = start;
  let fetched = 0;
  while (cursor !== null && fetched < pages) {
    const page = await apiGet("API-34", { ...params, cursor }, { signal });
    fetched += 1;
    items.push(...page.items);
    cursor = page.next_cursor;
  }
  return { items, next_cursor: cursor, pages: fetched };
}

/**
 * The pages after the first, loaded one at a time on request. The key sits under API-34's, and each poll reads every
 * page shown again from the first page's cursor, so the list stays continuous when a new review shifts the pages.
 */
function useOlderReviews(params: ParamsOf<"API-34">, start: string | null): { older: OlderPages; items: readonly ReviewItem[] } {
  const [pages, setPages] = useState(0);
  const query = usePolledQuery<Older>([...readKey("API-34", params), "older"], (signal) => fetchOlder(params, start, pages, signal), READ_INTERVAL_MS.reviews);
  const { refetch } = query;
  useEffect(() => { if (pages > 0) void refetch(); }, [pages, start, refetch]);
  const shown = pages > 0 ? query.data : undefined;
  const next = pages === 0 ? start : shown ? shown.next_cursor : null;
  const failed = pages > 0 && (query.isError || query.consecutiveFailures > 0);
  return {
    items: shown?.items ?? [],
    older: {
      loading: pages > 0 && query.isFetching && pages > (shown?.pages ?? 0),
      failed,
      load: failed ? () => void refetch() : next !== null ? () => setPages(pages + 1) : null,
    },
  };
}

/** The page, with the API's page size unless `limit` names one (the tests page through the fixture's reviews). */
export function ReviewBody({ limit }: { limit?: number }) {
  const params: ParamsOf<"API-34"> = limit === undefined ? {} : { limit };
  const query = useReviewsRead(params);
  const page = query.data ?? null;
  const read: ReviewsRead = {
    page,
    failed: query.consecutiveFailures > 0 || query.isError,
    pending: query.data === undefined && !query.isError && query.consecutiveFailures === 0,
    readAt: query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : null,
    retry: () => { void query.refetch(); },
  };
  const { older, items } = useOlderReviews(params, page?.next_cursor ?? null);
  const reviews = mergeReviews(page?.items ?? [], items);
  const status = page ? headerStatus(page) : read.failed ? "Today's review could not be read." : null;
  return <Page className="rv-page">
    <PageHeader view="review" status={status} />
    <div className="l-grid rv-grid">
      <div className="span-8 l-stack rv-main">
        <TodayPanel read={read} />
        <LatestPanel read={read} />
        <ProposalPanel read={read} />
        <EarlierPanel read={read} reviews={reviews} older={older} />
      </div>
      <div className="span-4 l-stack rv-side">
        <ReviewerHealth read={read} reviews={reviews} />
      </div>
      <div className="rv-foot">
        <ReviewerLimits />
      </div>
    </div>
  </Page>;
}

export default function Review() {
  return <ReviewBody />;
}
