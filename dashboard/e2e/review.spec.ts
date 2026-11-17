// SPDX-License-Identifier: MIT
// Review (dashboard v2 screens section 8) at 1440 and 390 px: today's review state, the latest summary, a waiting
// proposal with Open in the band editor for an operator and none for a viewer, an earlier review opening in place, the
// reviewer's health, and no horizontal scroll. Nothing on the page writes.
import type { Page } from "@playwright/test";
import { DESKTOP, PHONE, WEBKIT, expect, expectNoHorizontalScroll, fixtureWrites, load, test, useScreensClock } from "./support";

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

for (const viewport of [DESKTOP, PHONE]) {
  const at = `${viewport.width} px`;

  test(`${at}: a written review reads its state, its summary and the reviewer's health, with no horizontal scroll`, viewport === PHONE ? WEBKIT : {}, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await useScreensClock(page, request, "in-band");
    await load(page, "/review");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review");
    await expect(region(page, "Today")).toContainText("The review of 1 Nov was written at 07:03.");
    await expect(region(page, "Latest review · 1 Nov")).toContainText("Daily review · written by Iris on 2 Nov at 07:03");
    await expect(region(page, "Proposal")).toContainText("This review proposed no band change.");
    const health = page.getByRole("region", { name: "Reviewer health" });
    await expect(health).toContainText("355,128 tokens");
    await expect(health).toContainText("above the mean of the 7 reviews before it");
    await expect(health).toContainText("A rise over 20% is flagged.");
    await expect(health).not.toContainText("7-day mean");
    await expect(page.getByText("What the reviewer can and cannot do")).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await fixtureWrites(request)).toEqual([]);
  });

  test(`${at}: an earlier review opens its summary in place`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await useScreensClock(page, request, "in-band");
    await load(page, "/review");
    const earlier = region(page, "Earlier reviews");
    const row = earlier.getByRole("listitem").first();
    await row.getByText("31 Oct").click();
    await expect(row).toContainText("temperature held its band");
    await expectNoHorizontalScroll(page);
  });
}

test("a waiting proposal: an operator opens it in the band editor", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await useScreensClock(page, request, ["in-band", "review-proposal-waiting"]);
  await load(page, "/review");
  const proposal = region(page, "Proposal");
  await expect(proposal.getByText("Waiting").first()).toBeVisible();
  await expect(proposal.getByRole("list", { name: "Proposed band changes" }).getByRole("listitem")).toHaveCount(2);
  await expect(proposal).toContainText("+2.0 °F");
  await proposal.getByRole("link", { name: "Open in the band editor" }).click();
  await expect(page).toHaveURL(/\/band\?proposal=9$/);
  expect(await fixtureWrites(request)).toEqual([]);
});

test("a viewer reads the proposal and sees no control", WEBKIT, async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, ["in-band", "review-proposal-waiting", "viewer-session"]);
  await load(page, "/review");
  await expect(region(page, "Proposal")).toContainText("+2.0 °F");
  await expect(page.getByRole("link", { name: "Open in the band editor" })).toHaveCount(0);
  await expect(page.locator("main [data-write-control]")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("a failed review says why and how many attempts", async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, ["in-band", "review-failed"]);
  await load(page, "/review");
  await expect(region(page, "Today")).toContainText("The review of 1 Nov failed after 3 attempts: the reviewer could not be reached.");
  await expect(region(page, "Latest review · 31 Oct")).toBeVisible();
  await expectNoHorizontalScroll(page);
});
