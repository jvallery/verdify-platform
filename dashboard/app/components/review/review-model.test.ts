// SPDX-License-Identifier: MIT
// Review's shaping (dashboard v2 screens section 8): today's state in words, the summary as paragraphs and lists, a
// proposal put only in the text, the changes and the price, and the reviewer's health and tokens per day.
import { expect, test } from "vitest";
import type { Review, ReviewPage } from "../../lib/operator-api";
import {
  askedBy, bandEditorHref, changeRows, collapses, health, headerStatus, latestWritten, mergeReviews, priceParts, proposalBadge, proseBlocks, reviewDay,
  speaksOfProposal, todayLine, tokenDays,
} from "./review-model";

const NBSP = String.fromCharCode(0xa0);
const plain = (value: string) => value.replaceAll(NBSP, " ").replaceAll("−", "-");

function review(id: number, date: string, overrides: Partial<Review> = {}): Review {
  return {
    id, kind: "daily", review_date: date, status: "written", requested_at: `${date}T14:00:04Z`, requested_by: "ingestor", attempts: 1,
    delivered_at: `${date}T14:00:05Z`, run_finished_at: `${date}T14:02:00Z`, written_at: `${date}T14:01:16Z`, failure: null,
    input_tokens: 170_000, output_tokens: 6_000, total_tokens: 176_000, summary: "Temperature held its band.", proposal: null, proposal_state: null,
    ...overrides,
  };
}
const TODAY = { review_date: "2026-11-01", status: "written", missed: false, expected_after: "07:00", late_after: "10:00" } as const;
function page(items: Review[], overrides: Partial<ReviewPage> = {}): ReviewPage {
  return { items, next_cursor: null, today: TODAY, tokens: { last: 355_128, mean_7: 200_000, mean_30: 190_000, rise_pct: 101.5 }, proposal_waiting: null, ...overrides };
}

test("a review date reads as day and month", () => {
  expect(reviewDay("2026-11-01")).toBe("1 Nov");
  expect(reviewDay("2026-10-24")).toBe("24 Oct");
  expect(reviewDay("not a date")).toBe("not a date");
});

test("today: written at its time, with no window", () => {
  const line = todayLine(TODAY, [review(9, "2026-11-01")]);
  expect(line).toEqual({ badge: { status: "ok", text: "Written" }, before: "The review of 1 Nov was written at ", at: "2026-11-01T14:01:16Z", after: ".", window: null });
});

test("today: started and asked for name their time and the window; late once missed", () => {
  const started = todayLine({ ...TODAY, status: "delivered" }, [review(9, "2026-11-01", { status: "delivered", written_at: null })]);
  expect(started.badge).toEqual({ status: "info", text: "Started" });
  expect(started.before + (started.at ?? "") + started.after).toBe("The reviewer started the review of 1 Nov at 2026-11-01T14:00:05Z and is writing it.");
  expect(started.window).toBe("Expected after 07:00; late after 10:00.");
  const late = todayLine({ ...TODAY, status: "requested", missed: true }, [review(9, "2026-11-01", { status: "requested", delivered_at: null, written_at: null })]);
  expect(late.badge).toEqual({ status: "warn", text: "Late" });
  expect(late.after).toBe(" and is not written by 10:00.");
  expect(late.window).toBeNull();
  // A time the review does not carry is left out, never invented.
  const untimed = todayLine({ ...TODAY, status: "requested" }, []);
  expect(untimed.before).toBe("The review of 1 Nov was asked for");
  expect(untimed.at).toBeNull();
});

test("today: failed says the failure in words and the attempts", () => {
  const line = todayLine({ ...TODAY, status: "failed", missed: true }, [review(9, "2026-11-01", { status: "failed", attempts: 3, failure: "gateway_unreachable", written_at: null })]);
  expect(line.badge).toEqual({ status: "critical", text: "Failed" });
  expect(line.before).toBe("The review of 1 Nov failed after 3 attempts: the reviewer could not be reached.");
  const unknown = todayLine({ ...TODAY, status: "failed" }, [review(9, "2026-11-01", { status: "failed", attempts: 1, failure: null })]);
  expect(unknown.before).toBe("The review of 1 Nov failed after 1 attempt: no reason was recorded.");
});

test("today: due, late after 10:00, not due yet, and a newer status read raw", () => {
  expect(todayLine({ ...TODAY, status: "due" }, [])).toMatchObject({ badge: { status: "neutral", text: "Due" }, before: "The review of 1 Nov is due.", window: "Expected after 07:00; late after 10:00." });
  expect(todayLine({ ...TODAY, status: "due", missed: true }, [])).toMatchObject({ badge: { status: "warn", text: "Late" }, before: "The review of 1 Nov is late: it was not written by 10:00.", window: null });
  expect(todayLine({ ...TODAY, status: "not_due" }, [])).toMatchObject({ badge: { text: "Not due yet" }, window: "Expected after 07:00." });
  expect(todayLine({ ...TODAY, status: "queued" }, []).badge.text).toBe("queued");
});

test("the header line says today's state and a proposal waiting", () => {
  expect(headerStatus(page([review(9, "2026-11-01")]))).toBe("Today's review: written");
  expect(headerStatus(page([review(9, "2026-11-01")], { proposal_waiting: { review_id: 9, review_date: "2026-11-01" } }))).toBe("Today's review: written · a proposal is waiting for the owner");
});

test("the latest review is the newest written one; who asked for it", () => {
  const items = [review(10, "2026-11-01", { status: "failed", written_at: null }), review(9, "2026-10-31")];
  expect(latestWritten(items)?.id).toBe(9);
  expect(latestWritten([])).toBeNull();
  expect(askedBy(review(1, "2026-11-01"))).toBe("Daily review");
  expect(askedBy(review(1, "2026-11-01", { kind: "manual", requested_by: "jason" }))).toBe("Asked for by jason");
});

test("pages merge in order without repeating a review", () => {
  expect(mergeReviews([review(3, "a"), review(2, "b")], [review(2, "b"), review(1, "c")]).map((item) => item.id)).toEqual([3, 2, 1]);
});

test("the summary keeps its paragraphs and simple lists and drops other markup", () => {
  const summary = "## Night\nVPD ran **below** the band\novernight.\n\n- Heat ran 6 h\n- Drying ran\n  in the evening\n1. one\n2. two\n\nLast line.";
  expect(proseBlocks(summary)).toEqual([
    { kind: "p", text: "Night VPD ran below the band overnight." },
    { kind: "ul", items: ["Heat ran 6 h", "Drying ran in the evening"] },
    { kind: "ol", items: ["one", "two"] },
    { kind: "p", text: "Last line." },
  ]);
  expect(proseBlocks("   \n\n  ")).toEqual([]);
});

test("a summary longer than about 12 lines collapses", () => {
  expect(collapses(proseBlocks("Short."))).toBe(false);
  expect(collapses(proseBlocks("x".repeat(70 * 12)))).toBe(false);
  expect(collapses(proseBlocks("x".repeat(70 * 12 + 1)))).toBe(true);
  expect(collapses(proseBlocks(Array.from({ length: 7 }, () => "A short paragraph.").join("\n\n")))).toBe(true);
});

test("a summary speaks of a proposal unless it denies one", () => {
  expect(speaksOfProposal("Held the band. Proposal: raise only the low edge at sunrise by 2 °F.")).toBe(true);
  expect(speaksOfProposal("I propose a warmer night.")).toBe(true);
  expect(speaksOfProposal("Held the band. No band edit proposed.")).toBe(false);
  expect(speaksOfProposal("Nothing to propose today.")).toBe(false);
  expect(speaksOfProposal(null)).toBe(false);
});

test("each change reads current → proposed with its unit and the signed difference", () => {
  const rows = changeRows({
    changes: [
      { param: "band_temp_low_sr", label: "Low edge at sunrise", unit: "°F", current: 62.5, proposed: 64.5 },
      { param: "band_vpd_high_sm", label: "High VPD edge at solar noon", unit: "kPa", current: 1.35, proposed: 1.31 },
      { param: "band_temp_high_ss", label: "High edge at sunset", unit: "°F", current: null, proposed: 80 },
    ],
    price: "", reason: null,
  }).map((row) => ({ ...row, current: plain(row.current), proposed: plain(row.proposed), difference: plain(row.difference) }));
  expect(rows).toEqual([
    { key: "band_temp_low_sr", label: "Low edge at sunrise", current: "62.5 °F", proposed: "64.5 °F", difference: "+2.0 °F" },
    { key: "band_vpd_high_sm", label: "High VPD edge at solar noon", current: "1.35 kPa", proposed: "1.31 kPa", difference: "-0.04 kPa" },
    { key: "band_temp_high_ss", label: "High edge at sunset", current: "—", proposed: "80.0 °F", difference: "—" },
  ]);
});

test("the price note splits into its lead and parts when it lists figures", () => {
  expect(priceParts("Low edge only: Therms/day +0.31 / +0.31; kWh/day +0.9 / +0.4")).toEqual({ lead: "Low edge only", parts: ["Therms/day +0.31 / +0.31", "kWh/day +0.9 / +0.4"] });
  expect(priceParts("About 0.3 therms a day more.")).toEqual({ lead: null, parts: ["About 0.3 therms a day more."] });
  expect(priceParts("  ")).toEqual({ lead: null, parts: [] });
});

test("a proposal's state badge, and the band editor link", () => {
  expect(proposalBadge("waiting")).toEqual({ status: "warn", text: "Waiting" });
  expect(proposalBadge("answered")).toEqual({ status: "neutral", text: "Answered" });
  expect(proposalBadge("superseded")).toEqual({ status: "neutral", text: "Superseded" });
  expect(proposalBadge(null)).toBeNull();
  expect(bandEditorHref(9)).toBe("/band?proposal=9");
});

test("health: the rise is flagged above 20 %, attempts of the newest, retries and failures over 30 days", () => {
  const items = [
    review(12, "2026-11-01", { attempts: 2 }),
    review(11, "2026-10-31", { status: "failed", attempts: 3, failure: "hermes_run_failed", total_tokens: null }),
    review(10, "2026-10-03", { status: "failed", attempts: 3 }),
    review(9, "2026-10-02", { status: "failed", attempts: 3 }),
  ];
  expect(health(page(items), items)).toEqual({
    last: 355_128, mean7: 200_000, mean30: 190_000, risePct: 101.5, flagged: true, attempts: 2, retries: 5, failures: 2, reviews: 3, since: "2026-10-03",
  });
  expect(health(page(items, { tokens: { last: 1, mean_7: 1, mean_30: 1, rise_pct: 20 } }), items).flagged).toBe(false);
  expect(health(page([], { tokens: { last: null, mean_7: null, mean_30: null, rise_pct: null } }), []).attempts).toBeNull();
});

test("tokens per review day: oldest first, a day with no written review is a gap, two reviews add, a running one is partial", () => {
  const items = [
    review(14, "2026-11-01", { status: "delivered", written_at: null, total_tokens: null }),
    review(13, "2026-10-31", { kind: "manual", total_tokens: 1_000 }),
    review(12, "2026-10-31", { total_tokens: 2_000 }),
    review(11, "2026-10-29", { status: "failed", total_tokens: null }),
    review(10, "2026-09-01", { total_tokens: 9 }),
  ];
  expect(tokenDays(items, "2026-11-01")).toEqual([
    { date: "2026-10-29", value: null },
    { date: "2026-10-30", value: null },
    { date: "2026-10-31", value: 3_000 },
    { date: "2026-11-01", value: null, partial: true, note: "still running" },
  ]);
  expect(tokenDays([], "2026-11-01")).toEqual([]);
});
