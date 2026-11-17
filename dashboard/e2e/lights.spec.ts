// SPDX-License-Identifier: MIT
// Lights → Lights (screens section 4.1, parity L-01 to L-09) and Lights → History at 1440 and 390 px against #1122's
// fixture API: each circuit's state against what the controller wants, a mismatch called out, a timed switch with its
// length, whether the switches confirmed, the settings opening their drawer, the last seven days, and that a viewer has
// no write control.
import type { Page } from "@playwright/test";
import { DESKTOP, PHONE, WEBKIT, axe, expect, expectNoHorizontalScroll, fixtureWrites, load, test, useFixture, useScreensClock, writeControls } from "./support";

const panel = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

for (const viewport of [DESKTOP, PHONE]) {
  test(`${viewport.width} px: both circuits answer, the switches and settings read, and the page is axe clean with no sideways scroll`, viewport === PHONE ? WEBKIT : {}, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await useScreensClock(page, request, "in-band");
    await load(page, "/lights");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lights");
    await expect(page.locator(".page-status")).toContainText("Both lights are as the controller wants");
    await expect(panel(page, "Main light")).toContainText("The controller wants it off: enough daylight");
    await expect(panel(page, "Grow light")).toContainText("Light window");
    await expect(panel(page, "How they are switched")).toContainText("Home Assistant");
    await expect(panel(page, "Main light settings").getByRole("link")).toHaveCount(12);
    await expect(panel(page, "Last 7 days")).toBeVisible();
    await expect(page.getByText(/DLI|daily light integral/i)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await axe(page);
  });
}

test("a mismatch between the switch and the controller is called out", async ({ page, request }) => {
  await useScreensClock(page, request, "grow-lights-differ");
  await load(page, "/lights");
  await expect(panel(page, "Grow light")).toContainText("The switch reports off, but the controller wants it on.");
  await expect(panel(page, "How they are switched")).toContainText("Not confirmed");
});

test("an operator turns the main light on for 30 minutes: one API-20 with those minutes, then the switch reads on", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await useScreensClock(page, request, "lights-confirmed");
  await load(page, "/lights");
  const hand = panel(page, "By hand");
  await hand.getByRole("button", { name: "30 min", exact: true }).click();
  await hand.getByRole("region", { name: "Main light by hand" }).getByRole("button", { name: /^Turn\son\s30\smin/ }).click();
  await expect(panel(page, "Main light")).toContainText("The switch reports it on");
  const writes = await fixtureWrites(request);
  expect(writes.map((row) => row.operationId)).toEqual(["API-20"]);
  expect(writes[0].path).toMatch(/\/equipment\/lights\/main\/on$/);
  expect(writes[0].body).toEqual({ minutes: 30 });
});

test("a setting row opens that setting's drawer on Settings", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/lights");
  await panel(page, "Main light settings").getByRole("link", { name: /On when daylight is below/ }).click();
  await expect(page).toHaveURL(/\/settings\?edit=gl_main_lux_threshold$/);
});

test("a viewer reads every block and has no write control", WEBKIT, async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useFixture(request, ["in-band", "viewer-session"]);
  await load(page, "/lights");
  await expect(panel(page, "Main light")).toBeVisible();
  await expect(panel(page, "By hand")).toHaveCount(0);
  await expect(writeControls(page)).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("Light history: the lighting graph lives under Lights, and the old path arrives there", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/graphs/lighting?range=7d");
  await expect(page).toHaveURL(/\/lights\/history\?range=7d$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Light history");
  await expect(page.getByRole("navigation", { name: "Lights views" }).getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
  await expect(panel(page, "Light minutes by day")).toBeVisible();
  await expect(page.getByText(/DLI|daily light integral/i)).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
