// SPDX-License-Identifier: MIT
// Now (dashboard v2 screens §1) at the screens' clock: on a 390 × 844 phone the first screen holds the answer, the two
// band gauges, the controller's sentence and, for an operator, Stop all water pinned above the bottom bar; the main
// control (Stop all water, and a run by hand) sends one request each; a viewer sees no write control; and the page never
// scrolls sideways at 390, 820 or 1440 px. No plan is read.
import type { Page } from "@playwright/test";
import { DESKTOP, PHONE, expect, expectAboveTheFold, expectNoHorizontalScroll, fixtureRequests, fixtureWrites, load, test, untilPolled, useScreensClock, writeControls } from "./support";

const answer = (page: Page) => page.getByRole("heading", { level: 1 });
const stopAll = (page: Page) => page.getByRole("main").getByRole("button", { name: "Stop all water" });
const doing = (page: Page) => page.locator("#doing [data-doing]");
const TABLET = { width: 820, height: 1180 };

test("390 × 844, an operator: the answer, the two gauges, the controller's sentence and Stop all water sit in the first screen", async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, "in-band");
  await load(page, "/");
  await expect(answer(page)).toHaveText("All OK");
  await expect(page.locator(".now-band")).toHaveCount(2);
  await expect(doing(page)).not.toHaveText("");
  for (const target of [answer(page), page.locator(".now-band[data-tile=temp]"), page.locator(".now-band[data-tile=vpd]"), doing(page), stopAll(page)]) await expectAboveTheFold(page, target);
  const box = await stopAll(page).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  // Pinned: still in the first screen after a scroll.
  await page.evaluate(() => window.scrollTo(0, 1600));
  await expectAboveTheFold(page, stopAll(page));
  await expectNoHorizontalScroll(page);
});

for (const size of [PHONE, TABLET, DESKTOP]) {
  test(`${size.width} px: no horizontal scroll, every block present, no plan read`, async ({ page, request }) => {
    await page.setViewportSize(size);
    await useScreensClock(page, request, "in-band");
    await load(page, "/");
    for (const selector of [".now-hero", "#doing", "#needs-you", "#today", "#run-by-hand", ".now-water", "#daily-review", "#probes"]) await expect(page.locator(selector).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await fixtureRequests(request, "API-07")).toEqual([]);
  });
}

test("Stop all water: one API-IRR-07 request with no dialog", async ({ page, request }) => {
  await useScreensClock(page, request, "l01-running");
  await load(page, "/");
  await stopAll(page).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect.poll(async () => (await fixtureWrites(request)).map((row) => row.operationId)).toEqual(["API-IRR-07"]);
});

test("Run the fans from Run by hand: one API-IRR-12, then its time left and its Stop", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/");
  const panel = page.locator("#run-by-hand");
  await panel.getByRole("button", { name: "Run the fans, 15 min" }).click();
  await expect.poll(async () => (await fixtureWrites(request)).map((row) => [row.operationId, row.body])).toEqual([["API-IRR-12", { kind: "fans", minutes: 15 }]]);
  await untilPolled(page, () => expect(panel.locator("[data-run=fans] [data-run-left]")).toHaveText(/^Run\sthe\sfans\s·\s\d+\smin\sleft$/, { timeout: 500 }));
  await expect(panel.getByRole("button", { name: "Stop: Run the fans" })).toBeVisible();
});

test("a viewer sees the same answer with no write control and no Run by hand", async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, ["in-band", "viewer-session"]);
  await load(page, "/");
  await expect(answer(page)).toHaveText("All OK");
  await expect(page.locator("#run-by-hand")).toHaveCount(0);
  await expect(stopAll(page)).toHaveCount(0);
  await expect(writeControls(page, { includeHidden: true })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("dark: the page reads the same with the dark theme and never scrolls sideways", async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, "in-band");
  await load(page, "/");
  await expect(answer(page)).toHaveText("All OK");
  await expectNoHorizontalScroll(page);
});
