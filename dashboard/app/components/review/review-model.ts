// SPDX-License-Identifier: MIT
/**
 * Review's shaping (dashboard v2 screens section 8, parity R-08 to R-12), pure and tested: today's review state in
 * words, the summary as paragraphs and simple lists, whether the summary speaks of a proposal the review did not store,
 * a proposal's changes and price, the reviewer's health figures and the tokens per review day. Everything here reads
 * API-34 (`ReviewPage`) as the client parses it.
 */
import type { DailyBarDay } from "../../charts/daily-bars";
import { bandAnchorUnit, bandAnchorWords } from "../../lib/band-words";
import { dateShift, dayMonth, formatNumber, formatValue, sentenceStart } from "../../lib/format";
import type { Review, ReviewPage, ReviewProposal } from "../../lib/operator-api";
import { words } from "../../lib/words";
import type { BadgeStatus } from "../badge";

/** A rise of the newest review's tokens over the mean of the reviews before it above this share is flagged (screens 8, row 5). */
export const TOKEN_RISE_FLAG_PCT = 20;
/** Reviewer health counts failures over this many review days, today's included. */
export const HEALTH_DAYS = 30;
/** A summary longer than about this many lines collapses behind Read all. */
export const COLLAPSE_LINES = 12;
/** The prose measure (design-system 2.5: at most 70 characters a line), for the line estimate. */
const LINE_CHARS = 70;

/** "16 Nov": a review date in the words.md form (`dayMonth`). */
export const reviewDay = dayMonth;

// ---------------------------------------------------------------------------------------------------- today
/** The pieces of today's state: a badge and one sentence whose times the page renders as `LocalTime`. */
export type TodayLine = {
  readonly badge: { readonly status: BadgeStatus; readonly text: string };
  /** The sentence, split around the one instant it names (null when it names none). */
  readonly before: string;
  readonly at: string | null;
  readonly after: string;
  /** When the review is expected and when it is late, as the API states them, unless the review is done. */
  readonly window: string | null;
};

/** A sentence around one instant: "… at <time> …", or the sentence without "at" when the time is not recorded. */
function timed(before: string, at: string | null | undefined, after: string): Pick<TodayLine, "before" | "at" | "after"> {
  return at ? { before: `${before} at `, at, after } : { before, at: null, after };
}

/** The newest review of `date` in the page (items are newest first), or null. */
export function reviewOf(items: readonly Review[], date: string): Review | null {
  return items.find((item) => item.review_date === date) ?? null;
}

/**
 * Today's review in words (R-08): written at its time; started or asked for, with its time and the window; due with the
 * window, or late after `late_after`; failed with the failure in words and the attempts; not due yet before
 * `expected_after`. An unknown status reads its raw words.
 */
export function todayLine(today: ReviewPage["today"], items: readonly Review[]): TodayLine {
  const review = reviewOf(items, today.review_date);
  const day = reviewDay(today.review_date);
  const windowWords = `Expected after ${today.expected_after}; late after ${today.late_after}.`;
  const late = { status: "warn" as const, text: "Late" };
  switch (today.status) {
    case "written":
      return { badge: { status: "ok", text: words("review_status", "written") }, ...timed(`The review of ${day} was written`, review?.written_at, "."), window: null };
    case "delivered":
      return {
        badge: today.missed ? late : { status: "info", text: words("review_status", "delivered") },
        ...timed(`The reviewer started the review of ${day}`, review?.delivered_at, today.missed ? ` and has not written it by ${today.late_after}.` : " and is writing it."),
        window: today.missed ? null : windowWords,
      };
    case "requested":
      return {
        badge: today.missed ? late : { status: "info", text: words("review_status", "requested") },
        ...timed(`The review of ${day} was asked for`, review?.requested_at, today.missed ? ` and is not written by ${today.late_after}.` : " and has not started yet."),
        window: today.missed ? null : windowWords,
      };
    case "failed": {
      const attempts = review?.attempts ?? null;
      const failure = review?.failure ? words("review_failure", review.failure) : "no reason was recorded";
      const tries = attempts === null ? "" : ` after ${attempts} ${attempts === 1 ? "attempt" : "attempts"}`;
      return { badge: { status: "critical", text: words("review_status", "failed") }, before: `The review of ${day} failed${tries}: ${failure}.`, at: null, after: "", window: null };
    }
    case "due":
      return today.missed
        ? { badge: late, before: `The review of ${day} is late: it was not written by ${today.late_after}.`, at: null, after: "", window: null }
        : { badge: { status: "neutral", text: words("review_status", "due") }, before: `The review of ${day} is due.`, at: null, after: "", window: windowWords };
    case "not_due":
      return { badge: { status: "neutral", text: words("review_status", "not_due") }, before: `The review of ${day} is not due yet.`, at: null, after: "", window: `Expected after ${today.expected_after}.` };
    default:
      return { badge: { status: today.missed ? "warn" : "neutral", text: words("review_status", today.status) }, before: `The review of ${day}: ${words("review_status", today.status)}.`, at: null, after: "", window: null };
  }
}

/** The page header's one line: today's state in a few words, and a proposal waiting. */
export function headerStatus(page: ReviewPage): string {
  const state = todayLine(page.today, page.items).badge.text;
  return `Today's review: ${state.toLowerCase()}${page.proposal_waiting ? " · a proposal is waiting for the owner" : ""}`;
}

// ---------------------------------------------------------------------------------------------------- reviews
/** The newest written review (the Latest review block), or null. */
export function latestWritten(items: readonly Review[]): Review | null {
  return items.find((item) => item.status === "written") ?? null;
}

/** Who asked for a review: the daily schedule, or the person who asked (screens 8, row 2). */
export function askedBy(review: Pick<Review, "kind" | "requested_by">): string {
  return review.kind === "manual" ? `Asked for by ${review.requested_by}` : words("review_kind", review.kind);
}

/** Merges pages of reviews in order, keeping the first of each id (a new review shifts the pages under a cursor). */
export function mergeReviews(...pages: readonly (readonly Review[])[]): Review[] {
  const seen = new Set<number>();
  const out: Review[] = [];
  for (const page of pages) for (const item of page) if (!seen.has(item.id)) { seen.add(item.id); out.push(item); }
  return out;
}

// ---------------------------------------------------------------------------------------------------- the summary
/** One block of the summary: a paragraph, or a simple list. */
export type ProseBlock = { readonly kind: "p"; readonly text: string } | { readonly kind: "ul" | "ol"; readonly items: readonly string[] };

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
/** Removes the markup a plain-text summary may still carry: heading hashes and emphasis markers. */
const plain = (line: string) => line.replace(/^\s*#{1,6}\s+/, "").replace(/\*\*|__/g, "").trim();

/**
 * The summary as paragraphs and simple lists, nothing more (it is plain text by instruction): blank lines part
 * paragraphs, lines of a paragraph join with a space, and a run of "- " or "1. " lines is a list.
 */
export function proseBlocks(summary: string): ProseBlock[] {
  type Building = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };
  const built: Building[] = [];
  for (const chunk of summary.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    // Each chunk starts its own blocks: `current` is the block this chunk is filling.
    let current: Building | null = null;
    for (const raw of chunk.split("\n")) {
      if (!raw.trim()) continue;
      const kind = BULLET.test(raw) ? "ul" : NUMBERED.test(raw) ? "ol" : null;
      if (kind) {
        const item = plain(raw.replace(kind === "ul" ? BULLET : NUMBERED, ""));
        if (current !== null && current.kind === kind) current.items.push(item);
        else { current = { kind, items: [item] }; built.push(current); }
      } else if (current !== null && current.kind !== "p" && /^\s+\S/.test(raw)) {
        // An indented line continues the list item above it.
        current.items[current.items.length - 1] += ` ${plain(raw)}`;
      } else if (current !== null && current.kind === "p") {
        current.lines.push(plain(raw));
      } else {
        current = { kind: "p", lines: [plain(raw)] };
        built.push(current);
      }
    }
  }
  return built
    .map((block): ProseBlock => (block.kind === "p" ? { kind: "p", text: block.lines.filter(Boolean).join(" ") } : { kind: block.kind, items: block.items.filter(Boolean) }))
    .filter((block) => (block.kind === "p" ? block.text !== "" : block.items.length > 0));
}

/** About how many lines the blocks fill at the prose measure, a paragraph's gap counted as a line. */
export function proseLines(blocks: readonly ProseBlock[]): number {
  const lines = (text: string) => Math.max(1, Math.ceil(text.length / LINE_CHARS));
  return blocks.reduce((sum, block, index) => sum + (index > 0 ? 1 : 0) + (block.kind === "p" ? lines(block.text) : block.items.reduce((n, item) => n + lines(item), 0)), 0);
}

/** True when the summary is long enough to collapse behind Read all. */
export const collapses = (blocks: readonly ProseBlock[]): boolean => proseLines(blocks) > COLLAPSE_LINES;

const PROPOSAL_WORD = /\bpropos(?:al|als|e|es|ed|ing)\b/i;
const NEGATION = /\b(?:no|not|none|nothing|without|never)\b/i;
/**
 * True when the summary speaks of a proposal: a sentence names one and does not deny it ("No band edit proposed."
 * does not count). Used only where the review stored no structured proposal.
 */
export function speaksOfProposal(summary: string | null | undefined): boolean {
  if (!summary) return false;
  return summary.split(/(?<=[.!?])\s+|\n+/).some((sentence) => PROPOSAL_WORD.test(sentence) && !NEGATION.test(sentence));
}

// ---------------------------------------------------------------------------------------------------- the proposal
export type ChangeRow = {
  readonly key: string;
  readonly label: string;
  readonly current: string;
  readonly proposed: string;
  /** The signed difference with its unit ("+2.0 °F"), or "—" when the current value is unknown. */
  readonly difference: string;
};

/** A value in its unit; `formatValue` knows °F and kPa, and an unknown unit prints after the number. */
const valueIn = (value: number | null | undefined, unit: string | null | undefined) => formatValue(value, unit ?? null);

/**
 * Each change as label, current → proposed with its unit, and the signed difference (R-09). A band edge is named in
 * words ("Temperature low edge at sunrise", C9), never by the catalog's label of its key ("Band Temp Low SR").
 */
export function changeRows(proposal: ReviewProposal): ChangeRow[] {
  return proposal.changes.map((change) => {
    const edge = bandAnchorWords(change.param);
    const unit = bandAnchorUnit(change.param) ?? change.unit ?? null;
    const diff = change.current === null || change.current === undefined ? null : change.proposed - change.current;
    const difference = diff === null ? "—" : `${diff > 0 ? "+" : ""}${valueIn(diff, unit)}`;
    return { key: change.param, label: edge ? sentenceStart(edge) : change.label, current: valueIn(change.current, unit), proposed: valueIn(change.proposed, unit), difference };
  });
}

/**
 * The price note as the reviewer wrote it (B3). It is one text with one quoted price-list row a line, so each line is
 * its own row. A note of one line that lists figures ("Low edge only: Therms/day +0.31 / +0.31; kWh/day …") reads as
 * a lead (the text before the first colon) and its parts (split on semicolons), one part a row.
 */
export function priceParts(price: string): { readonly lead: string | null; readonly parts: readonly string[] } {
  const lines = price.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) return { lead: null, parts: lines };
  const text = lines[0] ?? "";
  const colon = text.indexOf(": ");
  const rest = colon > 0 ? text.slice(colon + 2) : text;
  const parts = rest.split(/;\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { lead: null, parts: text ? [text] : [] };
  return { lead: colon > 0 ? text.slice(0, colon) : null, parts };
}

/** A proposal's state as its badge (waiting, answered, superseded); an unknown state reads its words, neutral. */
export function proposalBadge(state: string | null | undefined): { readonly status: BadgeStatus; readonly text: string } | null {
  if (!state) return null;
  if (state === "waiting") return { status: "warn", text: "Waiting" };
  if (state === "answered") return { status: "neutral", text: "Answered" };
  if (state === "superseded") return { status: "neutral", text: "Superseded" };
  return { status: "neutral", text: words("proposal_state", state) };
}

/** The band editor with this review's proposal loaded (screens 8, row 3). */
export const bandEditorHref = (reviewId: number): string => `/band?proposal=${reviewId}`;

// ---------------------------------------------------------------------------------------------------- reviewer health
export type Health = {
  readonly last: number | null;
  readonly mean7: number | null;
  readonly mean30: number | null;
  readonly risePct: number | null;
  /** The rise is over `TOKEN_RISE_FLAG_PCT`. */
  readonly flagged: boolean;
  /** The newest review's attempts, or null with no review. */
  readonly attempts: number | null;
  /** Attempts past the first, summed over the window. */
  readonly retries: number;
  readonly failures: number;
  /** Reviews in the window. */
  readonly reviews: number;
  /** The first day of the window (local date). */
  readonly since: string;
};

/** The newest review's tokens against the reviews before it, in words: an arrow's direction and its sentence. */
export type TokenWords = {
  /** "91% above the review before it", "12% below the mean of the 5 reviews before it"; null with nothing to compare. */
  readonly comparison: { readonly direction: "up" | "down" | "none"; readonly text: string } | null;
  /** The figure compared with, and the flag: "The 5 reviews before it used 179,493 tokens on average. A rise over 20% is flagged." */
  readonly meta: string | null;
};

/**
 * The tokens tile's words (screens 8 row 5, B3). The API's 7-day mean averages the reviews written in the 7 days before
 * the newest (`count_7` of them), not days, so the words count reviews: with none, the figure stands alone; with one,
 * "91% above the review before it"; with more, "above the mean of the 5 reviews before it". A rise over
 * `TOKEN_RISE_FLAG_PCT` is flagged.
 */
export function tokenWords(tokens: Pick<ReviewPage["tokens"], "rise_pct" | "mean_7" | "count_7">): TokenWords {
  const count = tokens.count_7 ?? 0;
  const rise = tokens.rise_pct;
  const mean = tokens.mean_7;
  if (count <= 0 || rise === null || rise === undefined || !Number.isFinite(rise)) return { comparison: null, meta: null };
  const against = count === 1 ? "the review before it" : `the mean of the ${formatNumber(count, 0)} reviews before it`;
  const size = Math.round(Math.abs(rise));
  const comparison = size === 0
    ? { direction: "none" as const, text: `The same as ${against}` }
    : { direction: rise > 0 ? "up" as const : "down" as const, text: `${formatNumber(size, 0)}% ${rise > 0 ? "above" : "below"} ${against}` };
  const figure = mean === null || mean === undefined ? null : formatNumber(Math.round(mean), 0);
  const base = figure === null ? null : count === 1 ? `The review before it used ${figure} tokens.` : `The ${formatNumber(count, 0)} reviews before it used ${figure} tokens on average.`;
  const flag = rise > TOKEN_RISE_FLAG_PCT ? `A rise over ${TOKEN_RISE_FLAG_PCT}% is flagged.` : null;
  return { comparison, meta: [base, flag].filter(Boolean).join(" ") || null };
}

/** The reviews of the last `HEALTH_DAYS` review days, ending at today's review date. */
export function inWindow(items: readonly Review[], todayDate: string): Review[] {
  const since = dateShift(todayDate, -(HEALTH_DAYS - 1));
  return items.filter((item) => item.review_date >= since && item.review_date <= todayDate);
}

/** Reviewer health (R-12): tokens against the reviews before the newest, attempts, failures over the last 30 days. */
export function health(page: ReviewPage, items: readonly Review[]): Health {
  const window = inWindow(items, page.today.review_date);
  const rise = page.tokens.rise_pct;
  return {
    last: page.tokens.last, mean7: page.tokens.mean_7, mean30: page.tokens.mean_30, risePct: rise,
    flagged: rise !== null && rise > TOKEN_RISE_FLAG_PCT,
    attempts: items[0]?.attempts ?? null,
    retries: window.reduce((sum, item) => sum + Math.max(0, item.attempts - 1), 0),
    failures: window.filter((item) => item.status === "failed").length,
    reviews: window.length,
    since: dateShift(page.today.review_date, -(HEALTH_DAYS - 1)),
  };
}

/**
 * Total tokens per review day over the window, oldest first, every day from the first review to today's review date:
 * a day with no review, or only a failed one, is a gap (null), never a zero. Two reviews of one day add up; a day whose
 * review is still running is partial.
 */
export function tokenDays(items: readonly Review[], todayDate: string): DailyBarDay[] {
  const window = inWindow(items, todayDate);
  if (!window.length) return [];
  const byDay = new Map<string, { total: number | null; running: boolean }>();
  for (const item of window) {
    const day = byDay.get(item.review_date) ?? { total: null, running: false };
    if (item.total_tokens !== null && item.total_tokens !== undefined) day.total = (day.total ?? 0) + item.total_tokens;
    if (item.status === "requested" || item.status === "delivered") day.running = true;
    byDay.set(item.review_date, day);
  }
  const first = window.reduce((min, item) => (item.review_date < min ? item.review_date : min), todayDate);
  const days: DailyBarDay[] = [];
  for (let date = first; date <= todayDate; date = dateShift(date, 1)) {
    const day = byDay.get(date);
    days.push(day?.running ? { date, value: day.total, partial: true, note: "still running" } : { date, value: day?.total ?? null });
  }
  return days;
}

/**
 * Total tokens per local day of the reviews' runs (API-34 `days`, #1661): every finished review, daily and manual, on
 * the day its run finished. Oldest first, every day from the first listed to today (the day after today's review date):
 * a day with no finished review is a gap (null), never a zero, and today is partial while today's review runs. Null
 * when the API serves no days (an older API); the page then falls back to `tokenDays`.
 */
export function runTokenDays(page: ReviewPage): DailyBarDay[] | null {
  if (!page.days) return null;
  if (!page.days.length) return [];
  const today = dateShift(page.today.review_date, 1);
  const totals = new Map(page.days.map((day) => [day.day, day.total_tokens]));
  const running = page.today.status === "requested" || page.today.status === "delivered";
  const days: DailyBarDay[] = [];
  for (let date = page.days[0].day; date <= today; date = dateShift(date, 1)) {
    const value = totals.get(date) ?? null;
    days.push(running && date === today ? { date, value, partial: true, note: "still running" } : { date, value });
  }
  return days;
}
