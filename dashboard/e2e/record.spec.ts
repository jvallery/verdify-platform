// SPDX-License-Identifier: MIT
// Record (dashboard v2 screens section 6) on the fixture API at the screens' clock (10:42 on Monday 2 Nov): Days with
// its means row and its days table newest first, today "so far", a day opening Graphs, and the window control kept in
// the URL; In band's charts; Equipment's small multiples and counter check; Utilities' partial electricity; a viewer's
// four views with no write control; before and after the law; and no horizontal scroll at 390 px.
import { PHONE, WEBKIT, expect, expectNoHorizontalScroll, load, test, useScreensClock, writeControls } from "./support";

const VIEWS = ["/record", "/record/compliance", "/record/equipment", "/record/utilities"] as const;
const daysTable = (page: Parameters<typeof load>[0], days: number) => page.getByRole("table", { name: `The daily record, last ${days} days, newest first` });

test("/record: the means row, the days newest first with today so far, the window control in the URL, and a day opens Graphs", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/record");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Daily record");
  await expect(page.getByRole("navigation", { name: "Record views" }).getByRole("link", { name: "Days" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-mean]")).toHaveCount(8);
  await expect(page.locator("[data-mean=in-band] .metric-value")).toHaveText(/^\d+\.\d%$/);
  const window = page.getByRole("list", { name: "Days shown" });
  await expect(window.getByRole("link", { name: "30 d" })).toHaveAttribute("aria-current", "page");
  // The two head rows and 14 of the 30 days, then "Show all 30 days"; today first, marked so far.
  await expect(daysTable(page, 30).getByRole("row")).toHaveCount(16);
  await page.getByRole("button", { name: "Show all 30 days" }).first().click();
  await expect(daysTable(page, 30).getByRole("row")).toHaveCount(32);
  const today = daysTable(page, 30).getByRole("row").nth(2);
  await expect(today.getByRole("rowheader")).toContainText("Mon 2 Nov");
  await expect(today.getByRole("rowheader")).toContainText("so far");

  await window.getByRole("link", { name: "7 d" }).click();
  await expect(page).toHaveURL(/\/record\?days=7$/);
  await expect(daysTable(page, 7).getByRole("row")).toHaveCount(9);
  await expect(window.getByRole("link", { name: "7 d" })).toHaveAttribute("aria-current", "page");

  await daysTable(page, 7).getByRole("row").nth(3).getByRole("link", { name: "Sun 1 Nov" }).click();
  await expect(page).toHaveURL(/\/graphs\?from=2026-11-01&to=2026-11-01$/);
});

test("/record: a day under 70 % meter coverage reads partial, on Days and on Utilities", async ({ page, request }) => {
  await useScreensClock(page, request, ["in-band", "record-partial-day"]);
  await load(page, "/record");
  const yesterday = daysTable(page, 30).getByRole("row").nth(3);
  await expect(yesterday.getByRole("rowheader")).toContainText("Sun 1 Nov");
  await expect(yesterday.getByRole("cell").nth(7)).toHaveText("partial");
  await load(page, "/record/utilities");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Utilities");
  await expect(page.getByRole("heading", { name: "Gas per day, estimated" })).toBeVisible();
  const table = page.getByRole("table", { name: "Electricity, gas and water per day, last 30 days, newest first" });
  await expect(table.getByRole("row").nth(3).getByRole("cell").first()).toHaveText("partial");
  await expect(page.locator("figure.chart canvas")).toHaveCount(3);
});

test("/record/compliance: titled Time in band under the In band tab, its six charts drawn", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/record/compliance?days=90");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Time in band");
  await expect(page.getByRole("navigation", { name: "Record views" }).getByRole("link", { name: "In band" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("list", { name: "Days shown" }).getByRole("link", { name: "90 d" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("figure.chart canvas")).toHaveCount(6);
  await expect(page.getByText(/^Nights\sdried:\s\d+\sof\sthe\s90\sdays\sshown/)).toBeVisible();
});

test("/record/equipment: a block per relay and the counter check in words", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/record/equipment");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Equipment record");
  await expect(page.getByRole("region", { name: "Heat 1 (electric)" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Wall drip" })).toBeVisible();
  const check = page.getByRole("table", { name: "The controller's relay counters against the stored record, newest day first" });
  await expect(check.getByRole("row")).toHaveCount(5);
  await expect(check).toContainText("Part of the day compared");
  await expect(check).toContainText("Whole day compared");
  await expect(check).toContainText("Counters agree");
});

test("/record: before and after the law, between the means and the days; absent until the controller reports the law", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/record");
  const periods = page.getByRole("region", { name: "Before and after the law" });
  await expect(periods).toBeVisible();
  const table = periods.getByRole("table", { name: "Means a day before the law and since, and the change" });
  await expect(table.getByRole("columnheader").nth(1)).toContainText("30 days before the law");
  await expect(table.getByRole("columnheader").nth(2)).toContainText("since the law");
  await expect(table.locator("[data-measure=both] .rc-p-change")).toContainText("vs before the law");
  await expect(periods).toContainText("Electricity counts only days with at least 70 % meter coverage.");
  await useScreensClock(page, request, ["in-band", "record-no-periods"]);
  await load(page, "/record");
  await expect(page.locator("[data-mean]")).toHaveCount(8);
  await expect(page.getByRole("heading", { name: "Before and after the law" })).toHaveCount(0);
});

test("a viewer reads every Record view with no write control", WEBKIT, async ({ page, request }) => {
  await useScreensClock(page, request, ["in-band", "viewer-session"]);
  for (const path of VIEWS) {
    await load(page, path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(writeControls(page, { includeHidden: true })).toHaveCount(0);
  }
});

test("every Record view fits 390 px with no horizontal scroll; the days table scrolls inside its card", WEBKIT, async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, "in-band");
  for (const path of VIEWS) {
    await load(page, path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
  await load(page, "/record");
  await expect(page.getByRole("region", { name: "Daily record, scrollable" })).toBeVisible();
});
