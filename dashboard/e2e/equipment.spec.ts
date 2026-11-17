// SPDX-License-Identifier: MIT
// System → Equipment (screens section 10.1, parity S-01 to S-05, K-12) at 1440 and 390 px against the fixture API:
// every climate relay with its state, since, today so far and why in the law's words, each linking to the law; the
// water relays; the lights as state with a link to Lights; Run by hand; the flags; the relay lanes for 24 h or 72 h;
// and a viewer with no write control.
import type { Page } from "@playwright/test";
import { DESKTOP, PHONE, WEBKIT, expect, expectNoHorizontalScroll, fixtureRequests, load, test, useFixture, useScreensClock, writeControls } from "./support";

const panel = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const RETIRED = /\b(plan|planner|waypoint|setpoint|tunable|burst|bypass|scorecard)s?\b/i;

for (const viewport of [DESKTOP, PHONE]) {
  test(`${viewport.width} px: every relay says what it is doing and why, with no sideways scroll`, viewport === PHONE ? WEBKIT : {}, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await useScreensClock(page, request, "in-band");
    await load(page, "/equipment");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Equipment");
    await expect(page.locator(".page-status")).toContainText("climate relays on");
    const climate = panel(page, "Climate relays");
    await expect(climate.locator(".sys-relay")).toHaveCount(6);
    await expect(climate.locator(".sys-relay").first()).toContainText("today so far");
    await expect(climate.getByRole("link", { name: /^Climate law: the rules behind/ })).toHaveCount(6);
    await expect(panel(page, "Water relays").locator(".sys-relay").first()).toBeVisible();
    await expect(panel(page, "Lights").getByRole("link", { name: /Light controls/ })).toHaveAttribute("href", "/lights");
    await expect(panel(page, "Flags")).toBeVisible();
    await expect(panel(page, "Last 24 h")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(RETIRED);
    await expectNoHorizontalScroll(page);
  });
}

test("a relay's why links to the climate law", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/equipment");
  await panel(page, "Climate relays").getByRole("link", { name: /^Climate law: the rules behind Fan 1/ }).click();
  await expect(page).toHaveURL(/\/climate$/);
});

test("the lanes switch to 72 h and keep it in the address", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/equipment");
  await panel(page, "Last 24 h").getByRole("link", { name: "72 h" }).click();
  await expect(page).toHaveURL(/range=72h/);
  await expect(panel(page, "Last 72 h")).toBeVisible();
  // The title follows the address at once; the 72 h read reaches the fixture API a moment later.
  await expect.poll(async () => {
    const last = (await fixtureRequests(request, "API-05")).at(-1);
    if (!last) return null;
    const query = new URL(last.path, "http://x").searchParams;
    return (Date.parse(query.get("to")!) - Date.parse(query.get("from")!)) / 3_600_000;
  }).toBe(72);
});

test("an operator starts a run by hand from this page: one API-IRR-12", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await useScreensClock(page, request, "in-band");
  await load(page, "/equipment");
  await panel(page, "Run by hand").getByRole("button", { name: /^Run the fans/ }).click();
  await expect.poll(async () => (await fixtureRequests(request, "API-IRR-12")).map((row) => row.body)).toEqual([{ kind: "fans", minutes: 15 }]);
});

test("a viewer reads every block and has no write control", WEBKIT, async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useFixture(request, ["in-band", "viewer-session"]);
  await load(page, "/equipment");
  await expect(panel(page, "Climate relays")).toBeVisible();
  await expect(panel(page, "Run by hand")).toBeVisible();
  await expect(writeControls(page)).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
