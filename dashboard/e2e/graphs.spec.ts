// SPDX-License-Identifier: MIT
// Graphs (screens.md section 7, parity R-13 to R-16, K-13, K-14, S-08) on real uPlot canvases, the main paths only:
// Explore loads and states its window against the band, a preset changes the panels (the law's requests, the drying
// charts, the controller's budget) and an old preset id lands on its v2 name; Zones compares every probe with the one
// house band and draws their spread; a viewer sees no write control; and at 390 px nothing scrolls sideways, the
// toolbar is two rows at most and the first plot is on the first screen. The screens' clock is pinned.
import type { Page } from "@playwright/test";
import { DESKTOP, PHONE, expect, expectAboveTheFold, expectNoHorizontalScroll, fixtureRequests, load, test, useScreensClock, writeControls } from "./support";

const panels = (page: Page) => page.locator(".chart-stack").first().locator("[data-panel]");
const plots = (page: Page) => page.locator(".chart-stack").first().locator(".stack-panels .stack-plot canvas");
const status = (page: Page) => page.locator(".page-status");

test("Explore: the Climate preset draws temperature, VPD and RH against the band and states the window's time in band", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await page.setViewportSize(DESKTOP);
  await load(page, "/graphs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Graphs");
  await expect(panels(page)).toHaveCount(3);
  await expect(plots(page)).toHaveCount(3);
  await expect(status(page)).toContainText("in band");
  await expect(page.getByRole("list", { name: "Range" }).getByRole("link", { name: "72 h" })).toHaveAttribute("aria-current", "page");
  // The one house band, and no plan anywhere on the page.
  expect((await fixtureRequests(request, "API-06")).map((row) => new URL(row.path, "http://x").searchParams.get("zone"))).toEqual(["house"]);
  await expect(page.locator("main")).not.toContainText(/\bplan\b/i);
  await page.getByRole("list", { name: "Range" }).getByRole("link", { name: "24 h" }).click();
  await expect(page).toHaveURL(/[?&]range=24h\b/);
  await expect(plots(page)).toHaveCount(3);
});

test("a preset changes the panels: Law and equipment adds what the law asked for, Drying its price and decision, Controller its budget", async ({ page, request }) => {
  await useScreensClock(page, request, "law-drying-refused-cost");
  await page.setViewportSize(DESKTOP);
  await load(page, "/graphs?range=24h");
  await page.locator(".gr-preset > summary").click();
  await page.getByRole("list", { name: "Presets" }).getByRole("link", { name: "Law and equipment" }).click();
  await expect(page).toHaveURL(/[?&]preset=law\b/);
  await expect(panels(page)).toHaveCount(2);
  await expect(page.getByText("What the law asked for").first()).toBeVisible();
  await load(page, "/graphs?range=24h&preset=drying");
  await expect(page.getByRole("heading", { name: "Price of drying against the limit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The drying decision" })).toBeVisible();
  await load(page, "/graphs?range=24h&preset=controller");
  await expect(page.locator(".gr-controller canvas").first()).toBeVisible();
  // An old preset id lands on its v2 name.
  await load(page, "/graphs?range=7d&preset=water-soil");
  await expect(page).toHaveURL(/[?&]preset=water(&|$)/);
});

test("Zones: every probe against the house band, one band read, and the spread between the warmest and the coolest probe", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await page.setViewportSize(DESKTOP);
  await load(page, "/graphs/zones?range=72h");
  await expect(status(page)).toContainText("every zone against the house band");
  await expect(page.locator(".gr-zones .chart-grid canvas").first()).toBeVisible();
  await expect(page.locator(".gr-zones .chart-stack [data-panel]")).toHaveCount(2);
  expect((await fixtureRequests(request, "API-06")).map((row) => new URL(row.path, "http://x").searchParams.get("zone"))).toEqual(["house"]);
  await page.getByRole("link", { name: /^South/ }).first().click();
  await expect(page).toHaveURL(/[?&]zone=south\b/);
  await expect(status(page)).toContainText("against the house band");
});

test("a viewer sees the same Graphs with no write control", async ({ page, request }) => {
  await useScreensClock(page, request, ["in-band", "viewer-session"]);
  for (const path of ["/graphs", "/graphs/zones"]) {
    await load(page, path);
    await expect(page.locator(".chart-stack canvas, .chart-grid canvas").first()).toBeVisible();
    await expect(writeControls(page)).toHaveCount(0);
  }
});

test("at 390 px: no sideways scroll, the toolbar in two rows at most and the first plot on the first screen", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await page.setViewportSize(PHONE);
  await load(page, "/graphs");
  await expect(plots(page).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectAboveTheFold(page, plots(page).first());
  // Each visible control's vertical middle; controls within 20 px of each other share a row.
  const middles = await page.locator(".gr-tb").evaluate((bar) => [...bar.querySelectorAll<HTMLElement>(".gr-ranges, .gr-steps, .gr-custom > summary, .gr-tools > *")]
    .filter((item) => item.offsetParent !== null).map((item) => { const box = item.getBoundingClientRect(); return box.top + box.height / 2; }).sort((a, b) => a - b));
  const rows = middles.filter((middle, index) => index === 0 || middle - middles[index - 1] > 20).length;
  expect(rows).toBeLessThanOrEqual(2);
  await load(page, "/graphs/zones");
  await expectNoHorizontalScroll(page);
});
