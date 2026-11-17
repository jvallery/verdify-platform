// SPDX-License-Identifier: MIT
// Settings (dashboard v2 screens §10.4): the page loads with its answer (how many settings, how many the controller reads,
// how many are not confirmed), grouped by what a setting is for and filtered by what reads it; Edit → Save on a setting
// reads Not confirmed since, then Confirmed on the fixture readback; a viewer sees no write control; no horizontal scroll
// on a phone.
import type { Page } from "@playwright/test";
import { FIXTURE_API, PHONE, expect, expectNoHorizontalScroll, fixtureWrites, load, test, untilPolled, useScreensClock, writeControls } from "./support";

const row = (page: Page, param: string) => page.locator(`tr.setting-row[data-param="${param}"]`);
const drawer = (page: Page) => page.locator("dialog[open]");
type Served = { items: { param: string; effect?: string; group: string }[] };

test("the page loads with its answer, the settings in use by group, and the unused ones folded", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/settings");
  const { items } = await (await request.get(`${FIXTURE_API}/v1/settings`)).json() as Served;
  const controller = items.filter((item) => (item.effect ?? "controller") === "controller").length;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  await expect(page.locator(".page-status")).toHaveText(new RegExp(`^${items.length} settings · \\d+ read by the controller · 0 not confirmed$`));
  await expect(page.getByRole("link", { name: /^All \d+$/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: /^Read by the controller \d+$/ })).toBeVisible();
  await expect(page.locator("#settings-in-use tbody[data-group]").first()).toHaveAttribute("data-group", "crop_band");
  await expect(row(page, "outdoor_staleness_max_s").locator(".setting-state")).toHaveText("Confirmed");
  await expect(row(page, "band_temp_low_sr").getByRole("link", { name: "Change on Band" })).toHaveAttribute("href", "/band");
  await expect(page.locator("#settings-unused details")).not.toHaveAttribute("open", "");
  await page.getByRole("link", { name: /^Read by the controller/ }).click();
  await expect(page).toHaveURL(/show=controller/);
  expect(controller).toBeGreaterThan(0);
  expect(await fixtureWrites(request)).toEqual([]);
});

test("Edit → Save sends one API-10; the row reads Not confirmed since, then Confirmed on the readback", async ({ page, request }) => {
  await useScreensClock(page, request, "requested-to-confirmed");
  await load(page, "/settings?q=outdoor_staleness_max_s");
  await page.getByRole("link", { name: "Edit Outdoor Staleness Max" }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByRole("checkbox")).toHaveCount(0);
  await drawer(page).getByLabel("New value").fill("640");
  await drawer(page).getByRole("button", { name: "Save" }).click();
  await expect(drawer(page)).toHaveCount(0);
  const engage = row(page, "outdoor_staleness_max_s");
  await expect(engage.locator(".setting-state")).toHaveText(/^Not confirmed since \d{2}:\d{2}/);
  await untilPolled(page, () => expect(engage.locator(".setting-state")).toHaveText("Confirmed", { timeout: 500 }));
  await expect(engage.locator(".setting-value-text")).toHaveText(/^630\s+s$/);
  const sent = await fixtureWrites(request);
  expect(sent.map((write) => [write.method, write.operationId])).toEqual([["PUT", "API-10"]]);
});

test("a viewer sees every row with Details and no write control, the drawer read-only", async ({ page, request }) => {
  await useScreensClock(page, request, "viewer-session");
  await load(page, "/settings?q=outdoor_staleness_max_s");
  await expect(row(page, "outdoor_staleness_max_s")).toBeVisible();
  await expect(writeControls(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Details of Outdoor Staleness Max" }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByLabel("New value")).toHaveCount(0);
  await expect(writeControls(page)).toHaveCount(0);
});

test("no horizontal scroll at 390 px, with the rows stacked and the drawer open", async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, "in-band");
  await load(page, "/settings");
  await expect(row(page, "outdoor_staleness_max_s")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("link", { name: "Edit Outdoor Staleness Max" }).click();
  await expect(drawer(page)).toBeVisible();
  await expectNoHorizontalScroll(page);
});
