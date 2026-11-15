// SPDX-License-Identifier: MIT
import { DESKTOP, PHONE, axe, expect, expectNoHorizontalScroll, fixtureRequests, load, test, useScreensClock } from "./support";

for (const viewport of [DESKTOP, PHONE]) {
  test(`${viewport.width}px: reservoir trends and all 60 editable positions share an accessible workspace`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await useScreensClock(page, request, ["hydro-live", "crops-planted"]);
    await load(page, "/hydroponics");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hydroponics");
    await expect(page.locator(".stack-plot canvas")).toHaveCount(3);
    await expect(page.locator('button[data-cell^="EAST-HYDRO-"]')).toHaveCount(60);
    const spot = await page.locator('button[data-cell="EAST-HYDRO-1"]').boundingBox();
    expect(spot!.width).toBeGreaterThanOrEqual(44);
    expect(spot!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("link", { name: "Manage planting spots ↓" }).click();
    await expect(page.getByRole("heading", { name: "Your planting spots" })).toBeInViewport();
    await expectNoHorizontalScroll(page);
    await axe(page);
  });
}

test("changing the hydro range reads exactly the three reservoir metrics over seven days", async ({ page, request }) => {
  await useScreensClock(page, request, "hydro-live");
  await load(page, "/hydroponics");
  await page.getByRole("link", { name: "7 days", exact: true }).click();
  await expect(page.locator(".stack-plot canvas")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "7 days", exact: true })).toHaveAttribute("aria-current", "page");
  const calls = await fixtureRequests(request, "API-04");
  const query = new URL(calls.at(-1)!.path, "http://fixture.invalid").searchParams;
  expect(query.getAll("metric")).toEqual(["climate.hydro_ph", "climate.hydro_ec_us_cm", "climate.hydro_water_temp_f"]);
  expect(Date.parse(query.get("to")!) - Date.parse(query.get("from")!)).toBe(7 * 86400000);
});

test("a failed reservoir read leaves planting available with an explicit retry", async ({ page, request }) => {
  await useScreensClock(page, request, "hydro-live", { fail: { "API-04": 503 } });
  await load(page, "/hydroponics");
  await expect(page.getByText("Couldn't load water quality.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
  await expect(page.locator('button[data-cell^="EAST-HYDRO-"]')).toHaveCount(60);
});

test("missing samples stay empty rather than drawing a zero-value reservoir", async ({ page, request }) => {
  await useScreensClock(page, request, "hydro-no-data");
  await load(page, "/hydroponics");
  await expect(page.getByText("No data in this window", { exact: true })).toHaveCount(3);
  await expect(page.locator(".stack-plot canvas")).toHaveCount(0);
});

test("place selection explains a location outside the hydro workspace instead of silently dropping it", async ({ page, request }) => {
  await useScreensClock(page, request, "hydro-live");
  await load(page, "/hydroponics");
  await page.getByLabel("Select by place").fill("west top");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.locator(".crop-toolbar").getByRole("alert")).toContainText("Choose places in this workspace");
  await expect(page.locator('.crop-cell[aria-pressed="true"]')).toHaveCount(0);
});

test("Now and Hydroponics share timestamped probe readings independent of the chart range", async ({ page, request }) => {
  await useScreensClock(page, request, "hydro-live");
  await load(page, "/");
  const reservoir = page.getByRole("region", { name: "Reservoir now" });
  await expect(reservoir).toContainText("1,889.0");
  await expect(reservoir).toContainText("Updated 3 min ago");
  await expect(reservoir).not.toContainText(/TDS|ORP/);
  await load(page, "/hydroponics?range=30d");
  await expect(reservoir).toContainText("1,889.0");
  await expect(reservoir).toContainText("Updated 3 min ago");
  await expect(page.locator(".stack-plot canvas")).toHaveCount(3);
});
