// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// The daily review on Now (dashboard v2 screens §1 block 7) against the fixture API: the newest review's first paragraph,
// its date and state, and Read into Review (API-34 limit 1); a failed review says so; a failed read says so with Retry.
import { cleanup, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { advance, renderWithApi, requests, startFixtureApi, stopFixtureApi } from "../../lib/test-fixture-api";
import { text } from "../test-render";
import { NowReview, firstParagraph, reviewState } from "./review";

afterEach(() => { cleanup(); stopFixtureApi(); });
const panel = () => document.querySelector<HTMLElement>("#daily-review")!;

test("the newest review: its state and first paragraph, Read into Review, one API-34 read with limit 1", async () => {
  const api = startFixtureApi({ fixture: "in-band" });
  renderWithApi(<NowReview />);
  await advance(0);
  expect(text(panel().querySelector("[data-review=state]"))).toMatch(/ for [A-Z][a-z]{2} \d{1,2} · /);
  expect(text(panel().querySelector("[data-review=text]"))).not.toBe("");
  expect(within(panel()).getByRole("link", { name: /^Read/ }).getAttribute("href")).toBe("/review");
  expect(requests(api, "API-34").map((row) => new URL(row.path, "http://dashboard.invalid").searchParams.get("limit"))).toEqual(["1"]);
});

test("a failed review reads failed with its reason; a failed read says so with Retry", async () => {
  startFixtureApi({ fixture: "review-failed" });
  renderWithApi(<NowReview />);
  await advance(0);
  expect(text(panel().querySelector("[data-review=state]"))).toMatch(/· Failed: /);
  cleanup();
  stopFixtureApi();
  startFixtureApi({ fixture: "in-band", fail: { "API-34": 503 } });
  renderWithApi(<NowReview />);
  await advance(0);
  expect(within(panel()).getByRole("button", { name: "Retry" })).toBeTruthy();
});

test("the first paragraph: up to the first blank line, one line; nothing reads null", () => {
  expect(firstParagraph("Held the band all day.\nNights were damp.\n\nProposal: none.")).toBe("Held the band all day. Nights were damp.");
  expect([firstParagraph(""), firstParagraph(null), firstParagraph("  ")]).toEqual([null, null, null]);
  expect(reviewState({ review_date: "2026-11-01", status: "written", failure: null, kind: "daily" })).toMatch(/ for Nov 1 · Written$/);
});
