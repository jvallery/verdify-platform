// SPDX-License-Identifier: MIT
// Climate → Law and Climate → Drying (screens §2.1 and §2.3): both pages load with their answer, the refusal reads in
// words, the drying cost limit saves through API-10 with its readback, a viewer has no control, and nothing scrolls
// sideways at 390 px.
import type { Page } from "@playwright/test";
import { DESKTOP, PHONE, WEBKIT, expect, expectNoHorizontalScroll, fixtureWrites, load, test, useScreensClock } from "./support";

const panel = (page: Page, name: string) => page.locator("section.panel").filter({ has: page.getByRole("heading", { name, exact: true }) });

test("Law shows the rules at the band's edges, each rule's sentence and state, and the drying decision", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await useScreensClock(page, request, "law-drying-refused-cost");
  await load(page, "/climate");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^(Climate law|Law)$/);
  const rules = panel(page, "Rules at the band's edges");
  await expect(rules.getByRole("heading", { name: /^Temperature/ })).toBeVisible();
  await expect(rules.locator("svg.ladder-svg").first()).toBeVisible();
  await expect(rules.getByText("Turns on below 64.7 °F, off at 65.7 °F")).toBeVisible();
  await expect(rules.getByText("On since 10:38").first()).toBeVisible();
  const decision = panel(page, "Drying decision");
  await expect(decision.getByText("Refused: costs more than the limit").first()).toBeVisible();
  await expect(decision.getByRole("link", { name: /Drying/ })).toHaveAttribute("href", "/climate/drying");
  await expect(panel(page, "Asked and ran")).toBeVisible();
});

test("Drying shows the verdict and the price against the limit; an operator saves a new limit through API-10 and sees it sent", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await useScreensClock(page, request, "law-drying-refused-cost");
  await load(page, "/climate/drying");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Drying");
  const now = panel(page, "Drying now");
  await expect(now.getByText("Refused: costs more than the limit")).toBeVisible();
  await expect(now.getByText(/^Price\s0\.82\skWh\/kg\sagainst\sthe\slimit\s0\.70\skWh\/kg\.$/)).toBeVisible();
  const limit = panel(page, "Drying cost limit");
  const field = limit.getByRole("textbox", { name: "New limit" });
  await expect(field).toHaveValue("0.70");
  await limit.getByRole("button", { name: "Increase by 0.05" }).click();
  await expect(field).toHaveValue("0.75");
  await limit.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await fixtureWrites(request)).map((row) => [row.operationId, row.path, row.body]))
    .toEqual([["API-10", "/v1/settings/dry_cost_limit_kwh_per_kg", { value: 0.75, manual: true }]]);
  await expect(limit.getByText(/Sent\s0\.75\skWh\/kg\sat/)).toBeVisible();
  await expect(panel(page, "Price against limit")).toBeVisible();
  await expect(panel(page, "By day")).toBeVisible();
});

test("a viewer reads Law and Drying with no write control, and nothing scrolls sideways at 390 px", WEBKIT, async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, ["in-band", "viewer-session"]);
  await load(page, "/climate/drying");
  const limit = panel(page, "Drying cost limit");
  await expect(limit.getByText(/0\.70\skWh\/kg/).first()).toBeVisible();
  await expect(limit.getByRole("textbox", { name: "New limit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await load(page, "/climate");
  // Narrow, each ladder is a list in the track's order.
  await expect(panel(page, "Rules at the band's edges").locator("ol.ladder-list").first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});
