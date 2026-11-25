// SPDX-License-Identifier: MIT
// SCR-04 Water → Today and History (#1135, #1136, redesign §5.2, §5.4) at 1440 and 390 px: zone cards with their rows, the
// state-aware Stop, Site today and Misting, the status line, minutes by zone, the daily record's water, the run ledger, Stop
// all water on every view, the run dialog, and Soil (probe zones, the range and its Edit) at 390, 820 and 1440 px in light
// and dark. Schedules is water-schedules.spec.ts; that a viewer sees no Stop is roles.spec.ts, and
// a row's Run… and Stop in a visit are caretaker-visit.spec.ts.
import type { Page } from "@playwright/test";
import { CAN_STILL_START, CAN_STILL_START_NO_ENGINE, DESKTOP, PHONE, SMALL_PHONE, STOPPED, axe, expect, expectAboveTheFold, expectNoHorizontalScroll, fixtureWrites, load, test, toastLines, untilPolled, useScreensClock } from "./support";

const VIEWS = ["/water", "/water/schedules", "/water/history", "/water/soil"];
const row = (page: Page, id: string) => page.locator(`article[data-line="${id}"]`);
const program = (page: Page) => page.locator("[data-program]");
// The page's Stop all water on screen: the top bar's above 860 px (README section 3.2), the sticky tabs row's at 860 px and
// below; the page header holds none (design review C1).
const stopAll = (page: Page) => page.getByRole("button", { name: "Stop all water" }).locator("visible=true").first();

for (const viewport of [DESKTOP, PHONE]) {
  test(`${viewport.width} px: Today puts every line on its physical line's card (#1336), in order; the reserved center drips are one quiet row and L11 is climate only, run once`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await useScreensClock(page, request, "schedules-paused");
    await load(page, "/water");
    await expect(page.locator(".wat-zone")).toHaveCount(6);
    const zones = await page.locator(".wat-zone").evaluateAll((cards) => cards.map((node) => node.getAttribute("data-zone")));
    expect(zones).toEqual(["wall", "center", "center_mister", "south", "west", "fog"]);
    const ids = await page.locator("article[data-line]").evaluateAll((rows) => rows.map((node) => node.getAttribute("data-line")));
    expect(ids).toEqual(["L01", "L02", "L04", "L07", "L08", "L09", "L10", "L11"]);
    await expect(page.locator('.wat-zone[data-zone="center_mister"] .wat-unwired')).toHaveText("Fertilized line: not wired");
    await expect(page.getByRole("article", { name: "Wall drip", exact: true })).toHaveAttribute("data-state", "idle");
    await expect(page.locator('[data-limit="L01"]')).toContainText("0 / 60 min");
    await expect(row(page, "L01").locator(".wat-next")).toHaveText(/^next\sWed\s07:35\s·\s12\smin$/);
    await expect(row(page, "L02").locator(".line-subrow")).toContainText("Fertilizer valve");
    await expect(page.locator('.wat-zone[data-zone="center"] .wat-zone-reserved h3')).toHaveText("Center drip: reserved, not installed");
    await expect(row(page, "L11")).toContainText("Climate only");
    await expect(row(page, "L11").getByRole("button", { name: "Fog once… Fog" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}

test("1440 px: Site today and Misting sit beside the zones from 1200 px, sticky; Change opens each limit's Settings drawer", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await useScreensClock(page, request, "in-band");
  await load(page, "/water");
  const aside = page.locator(".wat-aside");
  const site = page.getByRole("region", { name: "Site today" });
  const zones = page.locator(".wat-zones");
  const [asideBox, zonesBox] = await Promise.all([aside.boundingBox(), zones.boundingBox()]);
  expect(asideBox!.x).toBeGreaterThan(zonesBox!.x + zonesBox!.width - 1);
  await expect(site.getByRole("link", { name: "Change the daily mist and fog limit in Settings" })).toHaveAttribute("href", "/settings?edit=mister_daily_volume_max_gal");
  await expect(site.getByRole("link", { name: "Change the soft daily budget for mist and fog in Settings" })).toHaveAttribute("href", "/settings?edit=mister_water_budget_gal");
  await expect(site.locator('[data-limit="saf4"]')).toContainText("21 / 360 gal");
  await expect(site.locator('[data-limit="saf4"]')).toContainText("Nothing is exempt from this limit.");
  await expect(site.locator('[data-limit="occupancy"]')).toHaveText("Occupancy: nobody detected, misting allowed (last person 05:10)");
  const misting = page.getByRole("region", { name: "Misting" });
  await expect(misting.locator('.wat-mist-row[data-rule="mist"] .wat-mist-head')).toContainText("Not wanted");
  await expect(misting.locator('.wat-mist-row[data-rule="fog"] .wat-mist-head')).toContainText("Not wanted");
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect(site).toBeInViewport();
  await expectNoHorizontalScroll(page);
});

test("a viewer sees Site today and Misting with no Change", async ({ page, request }) => {
  await useScreensClock(page, request, ["in-band", "viewer-session"]);
  await load(page, "/water");
  await expect(page.getByRole("region", { name: "Misting" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Site today" }).getByRole("link", { name: /^Change/ })).toHaveCount(0);
});

test("at 390 × 844 with L01 running the status line names it, linked to its row, and Wall's L01 row sits above the fold", async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, "l01-running");
  await load(page, "/water");
  const short = page.locator(".page-status-short");
  await expect(short.getByRole("link", { name: "Wall drip running" })).toHaveAttribute("href", "#line-L01");
  await expect(page.locator('.wat-zone[data-zone="wall"] .wat-zone-last')).toHaveText("running now");
  // Site today holds the daily mist and fog limit, the flow and occupancy on a phone; the soft budget and backup misting are not the news.
  await expect(page.locator('.wat-site-list [data-limit="budget"]')).toBeHidden();
  await expect(page.locator('.wat-site-list [data-limit="fallback"]')).toBeHidden();
  await expect(page.locator('.wat-site-list [data-limit="saf4"]')).toBeVisible();
  await expectAboveTheFold(page, row(page, "L01").locator(".line-state"));
  await expectNoHorizontalScroll(page);
});

test("1440 px: the zone heads' cap meters are one width, their minutes and right edges in line, and each zone's last-watered words on its own second line; the reserved zone is one row with no meter", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP);
  await useScreensClock(page, request, "in-band");
  await load(page, "/water");
  const boxes = (selector: string) => page.locator(selector).evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { width: Math.round(box.width), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom), height: box.height };
  }));
  // Each installed physical line has a cap (#1336): Wall, Center mister, South and West; Fog has minutes alone. The reserved
  // Center drip is one quiet row with no head, no cards and no meter (design review C2).
  const center = page.locator('.wat-zone[data-zone="center"]');
  await expect(center.locator(".wat-zone-reserved")).toHaveCount(1);
  await expect(center.locator(".wat-zone-reserved h3")).toHaveText("Center drip: reserved, not installed");
  await expect(center.locator(".wat-zone-head, .meter, article[data-line]")).toHaveCount(0);
  const meters = await boxes(".wat-zone-head .meter");
  expect(meters).toHaveLength(4);
  expect(new Set(meters.map((box) => box.width)).size, JSON.stringify(meters)).toBe(1);
  expect(new Set(meters.map((box) => box.right)).size, JSON.stringify(meters)).toBe(1);
  const minutes = await boxes(".wat-zone-head .meter-amount, .wat-zone-head .wat-zone-minutes");
  expect(new Set(minutes.map((box) => box.right)).size, JSON.stringify(minutes)).toBe(1);
  // The second line sits under the minutes on every zone with a head (all but the reserved row), on one line.
  const [heads, lasts] = await Promise.all([boxes(".wat-zone-head .wat-zone-today > :first-child"), boxes(".wat-zone-head .wat-zone-last")]);
  expect(heads).toHaveLength(5);
  expect(lasts).toHaveLength(5);
  lasts.forEach((last, index) => expect(last.top, `zone ${index}`).toBeGreaterThanOrEqual(heads[index].bottom));
  // One line each: the heights agree to within a pixel (top and bottom round apart at a half-pixel line height).
  const heights = lasts.map((box) => box.height);
  expect(Math.max(...heights) - Math.min(...heights), JSON.stringify(lasts)).toBeLessThan(1);
});

test("D-UX-06 (2026-11-06): only the running line has a Stop, filled red, and one Stop all water stops everything", async ({ page, request }) => {
  await useScreensClock(page, request, "l01-running");
  await load(page, "/water");
  await expect(page.locator("article[data-line] .btn-stop")).toHaveCount(1);
  await expect(page.locator("article[data-line]").getByRole("button", { name: /^Stop/ })).toHaveCount(1);
  await expect(row(page, "L01").locator(".btn-stop")).toHaveText(/^Stop/);
  await expect(page.getByRole("button", { name: "Stop all water" }).locator("visible=true")).toHaveCount(1);
  await expect(page.locator(".page-status")).toContainText("Wall drip running (run now)");
  await row(page, "L01").getByRole("button", { name: /^Stop/ }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await untilPolled(page, async () => expect((await fixtureWrites(request)).map((write) => [write.operationId, write.body])).toEqual([["API-IRR-07", { line_id: "L01" }]]));
});

test("minutes by zone keys a no-data day, never 0, and marks today partial", async ({ page, request }) => {
  await useScreensClock(page, request, "minutes-gap");
  await load(page, "/water/history");
  await expect(page.locator(".minutes-row")).toHaveCount(5);
  await expect(page.locator(".minutes-today").first()).toHaveText("today 0 min (partial) · cap 60");
  await expect(page.locator(".chart-key").first()).toContainText("no data");
});

test("a latched mister reads its fault as its row's state, with Clear fault; a zone on its peers says so in its head", async ({ page, request }) => {
  await useScreensClock(page, request, ["mister-fault", "south-peer"]);
  await load(page, "/water");
  await expect(row(page, "L04").locator(".line-fault")).toHaveText("Faulted: no misting until midnight (watchdog)");
  await expect(row(page, "L04").getByRole("button", { name: /^Clear fault/ })).toBeVisible();
  await expect(page.locator('.mister-zone[data-line="L07"] .mister-source')).toHaveText("VPD from peer probes");
});

for (const [fixture, says] of [
  ["before-engine", "The controller reports no irrigation engine: relay states only, and no line runs from here until it does"],
  ["program-rev-42", "Program rev 42 on controller · confirmed 2 min ago"],
  ["program-rom", "Running the built-in program: Center mister VPD only, Wall drip run-now, no schedules"],
]) {
  test(`${fixture}: the status line reads what the controller runs`, async ({ page, request }) => {
    await useScreensClock(page, request, fixture);
    await load(page, "/water");
    await expect(program(page)).toHaveText(says);
  });
}

test("with API-IRR-01 failing the page says Water status unavailable, never idle, and Stop all water stays", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band", { fail: { "API-IRR-01": 503 } });
  await load(page, "/water");
  await expect(program(page)).toContainText("Water status unavailable.");
  await expect(page.locator("article[data-line]")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/\bIdle\b/i);
  await expect(stopAll(page)).toBeEnabled();
});

test("History: one period drives the page, four KPIs against the previous period, and the period's summary is the status line", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/water/history");
  await expect(page.locator(".wat-kpis .metric-label")).toHaveText(["Watering", "Gallons", "Runs", "Missed, short or cap"], { useInnerText: false });
  await expect(page.locator(".page-status")).toHaveText(/^Last\s7\sdays:\s.*\swatering/);
  await page.getByRole("list", { name: "Period" }).getByRole("link", { name: "90 d" }).click();
  await expect(page).toHaveURL(/\/water\/history\?range=90d$/);
  await expect(page.locator('[data-kpi="runs"]')).toContainText("Counted over 31 days at most");
  await page.getByLabel("Measure").selectOption("gal");
  await expect(page).toHaveURL(/\/water\/history\?range=90d&measure=gal$/);
  await expect(page.locator(".chart-minutes figcaption")).toHaveText("Gallons per day by zone");
});

test("the run ledger reads 0 in Used, gal for a run that moved no water, a dash with its reason for a run with no meter data, and shows no rate or flow flag", async ({ page, request }) => {
  await useScreensClock(page, request, "runs-zero-and-unknown");
  await load(page, "/water/history");
  const ledger = page.getByRole("table", { name: /runs, newest first/i });
  // The column by its header: its cells are bare numbers, the unit is in the header.
  const used = (await ledger.locator("thead th").allTextContents()).indexOf("Used, gal");
  expect(used).toBeGreaterThan(-1);
  const usedCells = ledger.locator(`tbody tr > :nth-child(${used + 1})`);
  await expect(usedCells.filter({ hasText: /^0$/ }).first()).toBeVisible();
  // No meter data: a dash, with the reason for a screen reader (and as the dash's title), never 0.
  const unknown = usedCells.filter({ has: page.locator('[title="no meter data"]') }).first();
  await expect(unknown).toHaveText(/^—\s*no meter data$/);
  await expect(unknown.locator(".screen-reader")).toHaveText(/^\s*no meter data$/);
  await expect(ledger.locator("tbody")).not.toContainText(/gal\/min|\bflow\b/i);
});

test("at 390 px the ledger's runs stack as rows and nothing scrolls sideways", async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, "runs-zero-and-unknown");
  await load(page, "/water/history");
  await expect(page.getByRole("table", { name: /runs, newest first/i })).toBeHidden();
  await expect(page.getByRole("list", { name: "Runs, newest first" }).locator("li").first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});

for (const path of VIEWS) {
  test(`${path}: an operator's Stop all water sends one API-IRR-07 with no dialog, then the Stop result with Disable for L01`, async ({ page, request }) => {
    await useScreensClock(page, request, "l01-running");
    await load(page, path);
    await stopAll(page).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await untilPolled(page, () => expect(toastLines(page)).toHaveText([STOPPED, CAN_STILL_START], { timeout: 500 }));
    await expect(page.getByRole("button", { name: "Disable Wall drip", exact: true })).toBeVisible();
    expect((await fixtureWrites(request)).map((write) => [write.operationId, write.body])).toEqual([["API-IRR-07", {}]]);
  });
}

for (const [fixture, result] of [["writes-off", CAN_STILL_START], ["before-engine", CAN_STILL_START_NO_ENGINE]]) {
  test(`${fixture}: Stop all water stays enabled and sends one API-IRR-07`, async ({ page, request }) => {
    await useScreensClock(page, request, fixture);
    await load(page, "/water");
    await expect(stopAll(page)).toBeEnabled();
    await stopAll(page).click();
    await untilPolled(page, () => expect(toastLines(page)).toHaveText([STOPPED, result], { timeout: 500 }));
    expect((await fixtureWrites(request)).map((write) => write.operationId)).toEqual(["API-IRR-07"]);
  });
}

test("at 390 px a row's Run… is full width and each of its targets is at least 44 px", async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, "in-band");
  await load(page, "/water");
  const actions = row(page, "L01").locator(":scope > .object-row-actions");
  const run = actions.getByRole("button", { name: /^Run…/ });
  const [box, wide] = await Promise.all([actions.boundingBox(), run.boundingBox()]);
  // Run… takes the row's width beside its ⋯; an idle row has no Stop (D-UX-06, 2026-11-06).
  expect(wide!.width).toBeGreaterThan(box!.width * 0.6);
  await expect(actions.getByRole("button", { name: /^Stop/ })).toHaveCount(0);
  for (const target of [run, actions.locator("summary")]) expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalScroll(page);
});

test("a row's ⋯ holds its enable switch, Options…, Pause until… and its links; Escape closes it", async ({ page, request }) => {
  await useScreensClock(page, request, "schedules-paused");
  await load(page, "/water");
  const menu = row(page, "L02").locator("details.menu");
  await menu.locator("summary").click();
  await expect(menu.getByRole("switch", { name: "Enabled Wall drip (fertilized)" })).toBeVisible();
  await expect(menu.getByRole("button", { name: /^Options…/ })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Runs of Wall drip (fertilized)" })).toHaveAttribute("href", "/water/history?line=L02");
  await axe(page);
  await page.keyboard.press("Escape");
  await expect(menu.getByRole("switch", { name: "Enabled Wall drip (fertilized)" })).toBeHidden();
});

test("at 360 px a row's ⋯ opens its panel across the row, inside the screen, for an operator's idle line and for a viewer", async ({ page, request }) => {
  await page.setViewportSize(SMALL_PHONE);
  for (const fixture of [["in-band"], ["in-band", "viewer-session"]]) {
    await useScreensClock(page, request, fixture);
    await load(page, "/water");
    const menu = row(page, "L01").locator("details.menu");
    await menu.locator("summary").click();
    const panel = menu.locator(".menu-panel");
    await expect(panel.getByRole("link", { name: "Runs of Wall drip", exact: true })).toBeVisible();
    const box = await panel.boundingBox();
    expect(box!.x, fixture.join("+")).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, fixture.join("+")).toBeLessThanOrEqual(SMALL_PHONE.width);
    await expectNoHorizontalScroll(page);
  }
});

test("the run dialog with its most fields passes WCAG 2.2 AA at 390 px", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, "run-dialogs");
  await load(page, "/water");
  await row(page, "L08").getByRole("button", { name: /^Run…/ }).click();
  await expect(page.locator("dialog[open]")).toContainText("Run South mister (fertilized)");
  await axe(page);
});

test("at 390 px Stop reads ■ Stop all (the square drawn) and stays reachable while the page scrolls", async ({ page, request }) => {
  await page.setViewportSize(PHONE);
  await useScreensClock(page, request, "in-band");
  await load(page, "/water");
  const stop = page.getByRole("button", { name: "Stop all", exact: true });
  await expect(stop).toBeVisible();
  await expect(stop).toHaveText("Stop all", { useInnerText: true });
  await expect(stop.locator(".glyph-stop")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(stop).toBeInViewport();
});

// ---------------------------------------------------------------------------------------------------- Soil (SO-01 to SO-04)
for (const viewport of [PHONE, { width: 820, height: 1180 }, DESKTOP]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${viewport.width} px ${scheme}: Soil shows one panel per probe zone; a probe with no readings says so and is never drawn as zero`, async ({ page, request }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await useScreensClock(page, request, "soil-west-unserved");
      await load(page, "/water/soil");
      const south = page.getByRole("region", { name: "South Wall" });
      await expect(south.locator('.wat-soil-stat[data-measure="moisture"] .wat-soil-value')).toHaveText(/^\d+\.\d%$/);
      await expect(south.locator(".wat-soil-range-kv")).toContainText("Range");
      const west = page.getByRole("region", { name: "West Wall" });
      await expect(west).toContainText("This probe has not reported in the last 7 days.");
      await expect(west.locator(".wat-soil-stat")).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    });
  }
}

test("Soil: an operator edits a zone's moisture range in place and sends only what changed; a viewer sees no Edit", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/water/soil");
  await page.getByRole("button", { name: "Edit West Wall moisture range" }).click();
  const form = page.getByRole("form", { name: "Edit West Wall moisture range" });
  await form.getByLabel("Low end of the range").fill("38");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toHaveCount(0);
  expect((await fixtureWrites(request)).map((write) => [write.operationId, write.body])).toEqual([["API-SOIL-02", { min_pct: 38 }]]);
  await useScreensClock(page, request, ["in-band", "viewer-session"]);
  await load(page, "/water/soil");
  await expect(page.getByRole("region", { name: "West Wall" })).toBeVisible();
  await expect(page.getByRole("button", { name: /moisture range/ })).toHaveCount(0);
});

test("History: the day's water from the daily record names the record as its source", async ({ page, request }) => {
  await useScreensClock(page, request, "in-band");
  await load(page, "/water/history");
  const record = page.getByRole("region", { name: "The day's water, from the daily record" });
  await expect(record).toContainText("Source: the daily record");
  await expectNoHorizontalScroll(page);
});
