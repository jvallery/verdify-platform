// SPDX-License-Identifier: MIT
// System → Controller and System → Data (screens sections 10.2 and 10.3, parity S-06 to S-14, K-17, K-18, H-04) at
// 1440 and 390 px against the fixture API: the controller's verdict and hardware budget against its limits, Restart for
// operators only; the data flow, continuity and delivery with each failing setting linking to its drawer; and a viewer
// with no write control.
import type { Page } from "@playwright/test";
import { DESKTOP, PHONE, WEBKIT, expect, expectNoHorizontalScroll, fixtureWrites, load, test, useFixture, useScreensClock, writeControls } from "./support";

const panel = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

for (const viewport of [DESKTOP, PHONE]) {
  test(`${viewport.width} px: Controller answers whether it is healthy, with no sideways scroll`, viewport === PHONE ? WEBKIT : {}, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await useScreensClock(page, request, "in-band");
    await load(page, "/system/controller");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Controller");
    await expect(page.locator(".page-status")).toContainText("Up ");
    await expect(panel(page, "Verdict")).toContainText("The controller is healthy");
    await expect(panel(page, "Verdict")).toContainText("inside its limits");
    await expect(panel(page, "Hardware budget").locator("[data-budget]")).toHaveCount(6);
    await expect(panel(page, "Identity and uptime")).toContainText("Firmware");
    await expect(panel(page, "Law state")).toContainText("Band source");
    await expect(panel(page, "Trends")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test(`${viewport.width} px: Data answers whether the record is complete, with no sideways scroll`, viewport === PHONE ? WEBKIT : {}, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await useScreensClock(page, request, "in-band");
    await load(page, "/system/data");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Data");
    await expect(page.locator(".page-status")).toContainText("Data flowing");
    await expect(panel(page, "Flow")).toContainText("Ingestor heartbeat");
    await expect(page.getByRole("region", { name: "Answer" })).toContainText("in the last 24 h");
    await expect(panel(page, "Probes")).toContainText("probes answering");
    await expect(panel(page, "Continuity")).toContainText("Outages");
    await expect(panel(page, "Delivery")).toContainText("Oldest unconfirmed");
    await expectNoHorizontalScroll(page);
  });
}

test("memory low: the verdict names the line crossed", async ({ page, request }) => {
  await useScreensClock(page, request, "controller-heap-low");
  await load(page, "/system/controller");
  await expect(panel(page, "Verdict")).toContainText("under the warning line of 25");
  await expect(page.locator('[data-budget="memory"]')).toContainText("Below warning");
});

test("probes silent for days are named apart and muted; the one that stopped today warns", async ({ page, request }) => {
  await useScreensClock(page, request, "data-probes-silent");
  await load(page, "/system/data");
  await expect(page.locator(".page-status")).toContainText("1 probe stopped answering today");
  await expect(page.locator(".page-status")).toContainText("4 probes known to be silent");
  await expect(panel(page, "Probes").locator(".sys-silent-line.is-known")).toHaveCount(2);
  await expect(panel(page, "Probes").locator(".sys-silent-line.is-recent")).toHaveCount(1);
  await expect(panel(page, "Probes").locator(".sys-silent-line.is-recent")).toContainText("West wall relative humidity");
});

test("an operator restarts the controller from the disclosure: one {kind: restart}", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await useScreensClock(page, request, "restart-uptime-reset");
  await load(page, "/system/controller");
  const restart = page.getByRole("region", { name: "Restart the controller" });
  await restart.getByText("Restart the controller", { exact: true }).click();
  await expect(restart).toContainText("A run by hand ends");
  await restart.getByRole("button", { name: "Restart controller" }).click();
  await expect.poll(async () => (await fixtureWrites(request)).map((row) => [row.operationId, row.body])).toEqual([["API-IRR-12", { kind: "restart" }]]);
});

test("a failing setting links to its drawer on Settings; the ranges stay in the address", async ({ page, request }) => {
  await useScreensClock(page, request, "delivery-failing");
  await load(page, "/system/data");
  await expect(page.locator(".page-status")).toContainText("settings not taken");
  await panel(page, "Delivery").getByRole("link", { name: "7 d" }).click();
  await expect(page).toHaveURL(/hours=168/);
  await panel(page, "Settings whose pushes failed").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/settings\?edit=[\w%.-]+$/);
});

test("a viewer reads Controller and Data and has no write control", WEBKIT, async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useFixture(request, ["in-band", "viewer-session"]);
  await load(page, "/system/controller");
  await expect(panel(page, "Verdict")).toBeVisible();
  await expect(page.getByRole("region", { name: "Restart the controller" })).toHaveCount(0);
  await expect(writeControls(page)).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await load(page, "/system/data");
  await expect(panel(page, "Delivery")).toBeVisible();
  await expect(writeControls(page)).toHaveCount(0);
});
