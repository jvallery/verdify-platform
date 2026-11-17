// SPDX-License-Identifier: MIT
// Climate → Law and Climate → Drying (screens §2.1 and §2.3): both pages load with their answer, the refusal reads in
// words, the drying cost limit saves through API-10 with its readback, a viewer has no control, and nothing scrolls
// sideways at 390 px.
import type { Page } from "@playwright/test";
import { DESKTOP, PHONE, WEBKIT, expect, expectNoHorizontalScroll, fixtureWrites, load, test, useScreensClock } from "./support";

const panel = (page: Page, name: string) => page.locator("section.panel").filter({ has: page.getByRole("heading", { name, exact: true }) });

test("Law answers first, then shows the rules at the band's edges with their thresholds and states, and the drying decision", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await useScreensClock(page, request, "law-drying-refused-cost");
  await load(page, "/climate");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^(Climate law|Law)$/);
  await expect(panel(page, "What the controller is doing")).toContainText("drying is refused");
  const rules = panel(page, "Rules at the band's edges");
  await expect(rules.getByRole("heading", { name: /^Temperature/ })).toBeVisible();
  await expect(rules.locator("svg.ladder-svg").first()).toBeVisible();
  const heat = rules.getByRole("row", { name: /^Electric heat/ });
  await expect(heat.getByRole("cell", { name: "below 64.7" })).toBeVisible();
  await expect(heat.getByRole("cell", { name: "65.7", exact: true })).toBeVisible();
  await expect(rules.getByText("On since 10:38").first()).toBeVisible();
  const decision = panel(page, "Drying decision");
  await expect(decision.getByText("Refused: costs more than the limit").first()).toBeVisible();
  await expect(decision.getByRole("link", { name: /Drying/ })).toHaveAttribute("href", "/climate/drying");
  await expect(panel(page, "Asked and ran")).toBeVisible();
});

test("Drying answers with the verdict and the price against the limit; an operator saves a new limit through API-10 and sees it sent", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await useScreensClock(page, request, "law-drying-refused-cost");
  await load(page, "/climate/drying");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Drying");
  const now = panel(page, "Drying now");
  await expect(now.getByText("Refused", { exact: true })).toBeVisible();
  await expect(now.getByText(/^Drying\sis\swanted\sbut\srefused:\sit\swould\scost\s0\.82\skWh\/kg\sand\sthe\slimit\sis\s0\.70\skWh\/kg\.$/)).toBeVisible();
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

// Climate → Band (screens 2.2): the page answers with the band in words, an operator changes one edge and saves it as one
// API-24 write after the confirm sheet, a waiting proposal named in the URL fills the editor, and a viewer sees the band
// with no control and nothing scrolls sideways at 390 px.
test("Band answers with the band in words; an operator changes one edge, confirms it and saves it as one API-24 write", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await useScreensClock(page, request, "in-band");
  await load(page, "/band");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Band");
  await expect(panel(page, "The band").getByText(/^The\shouse\sis\sheld\sat\s71\.8–85\.8\s°F/)).toBeVisible();
  const editor = panel(page, "Set the band");
  const night = editor.getByRole("textbox", { name: "Temperature low edge at solar midnight" });
  await expect(night).toHaveValue("60.7");
  await night.fill("62.7");
  await expect(editor.getByText("Save writes 1 edge in one change. Only the owner saves the band.")).toBeVisible();
  await editor.getByRole("button", { name: "Save band…" }).click();
  const sheet = page.getByRole("dialog", { name: "Save the band?" });
  await expect(sheet.getByRole("listitem")).toHaveCount(1);
  await expect(sheet.getByRole("listitem")).toContainText("Temperature low edge at solar midnight");
  await sheet.getByRole("button", { name: "Save band", exact: true }).click();
  await expect.poll(async () => (await fixtureWrites(request)).map((row) => [row.operationId, row.path, row.body]))
    .toEqual([["API-24", "/v1/band/profile", { profile: {}, anchors: { band_temp_low_mid: 62.7 } }]]);
  await expect(sheet).toBeHidden();
  await expect(panel(page, "On the controller").getByText(/^You\ssaved\s1\sedge\sat\s\d\d:\d\d/)).toBeVisible();
});

test("a waiting proposal named in the URL comes first and fills the editor, and nothing scrolls sideways at 390 px", async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, "review-proposal-waiting");
  await load(page, "/band?proposal=9");
  const proposal = panel(page, "Proposal from the daily review");
  await expect(proposal.getByText("Waiting", { exact: true })).toBeVisible();
  await expect(proposal.getByRole("button", { name: "Loaded" })).toBeDisabled();
  const editor = panel(page, "Set the band");
  await expect(editor.getByRole("textbox", { name: "Temperature low edge at sunrise" })).toHaveValue("64.5");
  await expect(editor.getByRole("textbox", { name: "Temperature low edge at solar midnight" })).toHaveValue("62.7");
  await expect(editor.getByText("Save writes 2 edges in one change. Only the owner saves the band.")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("a viewer reads the band and its preview with no write control, and nothing scrolls sideways at 390 px", WEBKIT, async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, ["in-band", "viewer-session"]);
  await load(page, "/band");
  await expect(panel(page, "The band").getByText(/^The\shouse\sis\sheld\sat/)).toBeVisible();
  await expect(panel(page, "On the controller")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set the band" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
