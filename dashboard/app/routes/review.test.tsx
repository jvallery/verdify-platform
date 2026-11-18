// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
/**
 * Review (dashboard v2 screens section 8, parity R-08 to R-12) against the fixture API in process, uPlot mocked: today's
 * state written, failed and late; the latest summary; a waiting proposal with Open in the band editor for an operator
 * and none for a viewer; earlier reviews opening in place and paging by the cursor; the reviewer's health; the loading,
 * failed and stale states; and that nothing is written. The clock is the screens' 10:42 America/Denver on 2026-11-02.
 */
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeResizeObserver, MockPlot, media, setTokens } from "../charts/fixtures/uplot-mock";
import { text } from "../components/test-render";
import { OPERATOR, advance, renderWithApi, requests, startFixtureApi, stopFixtureApi, writes, type FixtureOptions } from "../lib/test-fixture-api";
import Review, { ReviewBody, links, meta } from "./review";

/** Retired words of words.md section 3 that could slip into this page's own copy. */
const RETIRED_COPY = ["plan", "plans", "waypoint", "planner", "mode", "stage", "target", "tunable", "cascade", "scorecard", "burst", "bypass", "experiment", "study", "dispatcher"];

vi.mock("uplot", async () => ({ default: (await import("../charts/fixtures/uplot-mock")).MockPlot }));

async function settle() {
  for (let pass = 0; pass < 6; pass++) {
    await advance(10);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
}
async function open(options: FixtureOptions = { fixture: "in-band" }, session = OPERATOR, limit?: number) {
  const api = startFixtureApi(options);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  setTokens();
  const view = renderWithApi(limit === undefined ? <Review /> : <ReviewBody limit={limit} />, session, "/review");
  await settle();
  return { api, view };
}
const panel = (name: string) => screen.getByRole("region", { name });
beforeEach(() => { MockPlot.reset(); FakeResizeObserver.instances = []; });
afterEach(() => { cleanup(); stopFixtureApi(); });

test("the route titles the view and links the chart styles", () => {
  expect(meta()).toEqual([{ title: "Review · Verdify dashboard" }]);
  expect(links().map((link) => link.rel)).toEqual(["stylesheet", "stylesheet"]);
});

test("a written review: today's state, the latest summary, no proposal, earlier reviews, health; nothing written", async () => {
  const { api } = await open();
  expect(screen.getByRole("heading", { level: 1 })).toHaveProperty("textContent", "Review");
  expect(document.querySelector(".page-status")?.textContent).toBe("Today's review: written");
  expect(text(panel("Today").querySelector("[data-review=today]"))).toBe("The review of 1 Nov was written at 07:03.");
  expect(within(panel("Today")).getByText("Written")).toBeTruthy();
  expect(text(panel("Today").querySelector("[data-review=no-proposal]"))).toBe("No band proposal is waiting for the owner.");
  const latest = panel("Latest review · 1 Nov");
  expect(text(latest.querySelector(".rv-facts"))).toBe("Daily review · written by Iris on 2 Nov at 07:03 · 355,128 tokens");
  expect(latest.querySelector(".rv-prose p")?.textContent).toMatch(/^Compliance on 2026-11-01: temperature held its band/);
  expect(text(panel("Proposal"))).toContain("This review proposed no band change.");
  const rows = panel("Earlier reviews").querySelectorAll(".rv-earlier-row");
  expect(rows).toHaveLength(8);
  expect(text(rows[0].querySelector(".rv-earlier-date"))).toBe("31 Oct");
  const tokens = document.querySelector("[data-tile=tokens]")!;
  expect(text(tokens.querySelector(".metric-value"))).toBe("355,128 tokens");
  expect(tokens.className).toContain("tone-warn");
  // The means count reviews, not days (B3): the fixture's mean averages the 7 reviews before the newest.
  expect(text(tokens.querySelector(".delta")).trim()).toMatch(/^\d+% above the mean of the 7 reviews before it$/);
  expect(text(tokens.querySelector(".metric-meta"))).toMatch(/^The 7 reviews before it used [\d,]+ tokens on average\. A rise over 20% is flagged\.$/);
  expect(text(document.body)).not.toMatch(/7-day mean/);
  expect(text(document.querySelector("[data-tile=attempts] .metric-value"))).toBe("1 attempt");
  expect(text(document.querySelector("[data-tile=failures] .metric-value"))).toBe("0 failures");
  expect(text(document.querySelector("[data-tile=failures] .metric-meta"))).toBe("Of 9 reviews since 3 Oct.");
  expect(screen.getByText("What the reviewer can and cannot do")).toBeTruthy();
  expect(requests(api, "API-34").map((row) => row.path)).toEqual(["/api/v1/reviews"]);
  expect(writes(api)).toEqual([]);
  // No retired word of words.md section 3 in the page's own copy (the reviewer's summary is its text, not ours).
  const own = text(document.body).replace(/Compliance on [^.]*\.[^]*?No band edit proposed\./g, "");
  for (const word of RETIRED_COPY) expect(own.toLowerCase(), word).not.toMatch(new RegExp(`\\b${word}\\b`));
});

test("a waiting proposal: changes, reason, price and state; an operator opens it in the band editor, a viewer cannot", async () => {
  await open({ fixture: ["in-band", "review-proposal-waiting"] });
  expect(document.querySelector(".page-status")?.textContent).toBe("Today's review: written · a proposal is waiting for the owner");
  expect(text(panel("Today"))).toContain("The review of 1 Nov proposes a band change; it waits for the owner below.");
  const proposal = panel("Proposal");
  expect(within(proposal).getAllByText("Waiting").length).toBeGreaterThan(0);
  const changes = proposal.querySelectorAll(".rv-change");
  expect(changes).toHaveLength(2);
  expect(text(changes[0].querySelector(".rv-change-label"))).toBe("Temperature low edge at sunrise");
  expect(text(changes[0].querySelector(".rv-change-values"))).toBe("62.5 °F →  to 64.5 °F");
  expect(text(changes[0].querySelector(".rv-change-diff"))).toBe("+2.0 °F");
  expect(text(proposal)).toContain("VPD ran below the band on most nights while temperature held");
  expect(text(proposal.querySelector(".rv-price"))).toContain("Therms/day +0.31 / +0.31");
  expect(within(proposal).getByRole("link", { name: "Open in the band editor" }).getAttribute("href")).toBe("/band?proposal=9");
  // The older proposal reads superseded in its row.
  const older = [...panel("Earlier reviews").querySelectorAll(".rv-earlier-row")].find((row) => row.querySelector("[data-proposal]"));
  expect(text(older?.querySelector(".rv-earlier-summary"))).toContain("Proposed a change · superseded");
  cleanup(); stopFixtureApi();
  await open({ fixture: ["in-band", "review-proposal-waiting", "viewer-session"] }, { role: "viewer", writesEnabled: false });
  expect(screen.queryByRole("link", { name: "Open in the band editor" })).toBeNull();
  expect(document.querySelectorAll("[data-write-control]")).toHaveLength(0);
});

test("a review that put its proposal in its text says so", async () => {
  // The live 11-16 review proposed in its summary only: the fixture's summary with its structured proposal dropped.
  const api = startFixtureApi({ fixture: ["in-band", "review-proposal-waiting"] });
  const respond = api.respond.bind(api);
  vi.spyOn(api, "respond").mockImplementation((request) => {
    const out = respond(request);
    if (typeof request.url === "string" && request.url.includes("/v1/reviews") && out.body && typeof out.body === "object") {
      const body = out.body as { items: { proposal: unknown; proposal_state: unknown }[] };
      body.items = body.items.map((item) => ({ ...item, proposal: null, proposal_state: null }));
    }
    return out;
  });
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  renderWithApi(<Review />, OPERATOR, "/review");
  await settle();
  expect(text(panel("Proposal"))).toContain("This review put its proposal in the text of its summary");
  expect(screen.queryByRole("link", { name: "Open in the band editor" })).toBeNull();
});

test("a failed review says the failure in words and the attempts; the latest written review stays readable", async () => {
  await open({ fixture: ["in-band", "review-failed"] });
  expect(text(panel("Today").querySelector("[data-review=today]"))).toBe("The review of 1 Nov failed after 3 attempts: the reviewer could not be reached.");
  expect(screen.getByRole("region", { name: "Latest review · 31 Oct" })).toBeTruthy();
  const failed = panel("Earlier reviews").querySelector(".rv-earlier-row");
  expect(text(failed?.querySelector(".rv-earlier-summary"))).toContain("Failed");
  expect(text(document.querySelector("[data-tile=attempts] .metric-value"))).toBe("3 attempts");
  expect(text(document.querySelector("[data-tile=failures] .metric-value"))).toBe("1 failure");
});

test("a review not written by 10:00 reads late", async () => {
  await open({ fixture: ["in-band", "review-missed"] });
  expect(text(panel("Today").querySelector("[data-review=today]"))).toBe("The review of 1 Nov is late: it was not written by 10:00.");
  expect(within(panel("Today")).getByText("Late")).toBeTruthy();
});

test("an earlier review opens its summary in place", async () => {
  await open();
  const row = panel("Earlier reviews").querySelector<HTMLDetailsElement>(".rv-earlier-details")!;
  expect(row.open).toBe(false);
  fireEvent.click(row.querySelector("summary")!);
  expect(row.querySelector(".rv-prose p")?.textContent).toMatch(/^Compliance on 2026-10-31/);
});

test("earlier reviews page by the cursor, and a poll reads every page shown again", async () => {
  const { api } = await open({ fixture: "in-band" }, OPERATOR, 4);
  expect(panel("Earlier reviews").querySelectorAll(".rv-earlier-row")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Load older reviews" }));
  await settle();
  expect(panel("Earlier reviews").querySelectorAll(".rv-earlier-row")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "Load older reviews" }));
  await settle();
  expect(panel("Earlier reviews").querySelectorAll(".rv-earlier-row")).toHaveLength(8);
  expect(screen.queryByRole("button", { name: "Load older reviews" })).toBeNull();
  expect(requests(api, "API-34").map((row) => row.path)).toEqual([
    "/api/v1/reviews?limit=4", "/api/v1/reviews?limit=4&cursor=4", "/api/v1/reviews?limit=4&cursor=4", "/api/v1/reviews?limit=4&cursor=8",
  ]);
});

test("loading, then a failed read with Retry in each block, and STALE over the last page after a failed poll", async () => {
  startFixtureApi({ fixture: "in-band" });
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("matchMedia", media({ fine: true }));
  renderWithApi(<Review />, OPERATOR, "/review");
  expect(panel("Today").getAttribute("data-state")).toBe("loading");
  cleanup(); stopFixtureApi();
  await open({ fixture: "in-band", fail: { "API-34": 503 } });
  for (const name of ["Today", "Latest review", "Proposal", "Earlier reviews"]) {
    expect(panel(name).getAttribute("data-state"), name).toBe("error");
    expect(within(panel(name)).getByRole("button", { name: "Retry" })).toBeTruthy();
  }
  expect(document.querySelector(".page-status")?.textContent).toBe("Today's review could not be read.");
  cleanup(); stopFixtureApi();
  const { api } = await open();
  api.respond({ method: "POST", url: "/__control", body: JSON.stringify({ fixture: "in-band", fail: { "API-34": 503 } }) });
  await advance(61_000);
  await settle();
  expect(panel("Today").getAttribute("data-state")).toBe("stale");
  expect(text(panel("Today"))).toContain("The review of 1 Nov was written at 07:03.");
});
