// SPDX-License-Identifier: MIT
// The frame of dashboard v2 (design-system sections 3 and 6): no page scrolls sideways at 360, 390, 820 or 1440 px;
// at 860 px and below the bottom bar holds five and More opens a sheet listing every section by group; above it the
// rail lists every section in order and marks the current one; with reduced motion nothing moves. And the frame's
// parts: the top bar, the account menu, the fault row that never scrolls away, the warn notices in flow, the count's
// severity, and the old paths that redirect with their query.
import type { Page } from "@playwright/test";
import { CARD_PAGES, REDIRECTS, ROUTES, SETTING_DRAWERS } from "./routes";
import { DESKTOP, PHONE, SMALL_PHONE, WEBKIT, accountMenu, bottomBar, expect, expectNoHorizontalScroll, expectRolePill, load, sectionsNav, test, useFixture } from "./support";

const TABLET = { width: 820, height: 1180 };
/** README section 3: the groups and their sections in order, as the rail and the More sheet list them. */
const GROUPS = [
  { label: "Operate", sections: ["Now", "Climate", "Water", "Lights", "Crops", "Hydroponics"] },
  { label: "Understand", sections: ["Record", "Graphs", "Review", "Activity"] },
  { label: "System", sections: ["Equipment", "Controller", "Data", "Settings"] },
] as const;
const SECTIONS = GROUPS.flatMap((group) => group.sections);
const SECTION_NAMES = SECTIONS.map((section) => new RegExp(`^${section}`));
/** The phone bar: four sections and More. */
const BAR = [/^Now/, /^Climate/, /^Water/, /^Alerts/, /^More/];
/** The section each path belongs to, as the rail marks it. */
const SECTION_OF: Readonly<Record<string, string>> = {
  "/": "Now", "/climate": "Climate", "/band": "Climate", "/climate/drying": "Climate", "/water": "Water", "/water/schedules": "Water",
  "/water/history": "Water", "/water/soil": "Water", "/lights": "Lights", "/lights/history": "Lights", "/crops": "Crops", "/crops/history": "Crops",
  "/hydroponics": "Hydroponics", "/record": "Record", "/record/compliance": "Record", "/record/equipment": "Record", "/record/utilities": "Record",
  "/graphs": "Graphs", "/graphs/zones": "Graphs", "/review": "Review", "/activity": "Activity", "/activity/log": "Activity", "/equipment": "Equipment",
  "/system/controller": "Controller", "/system/data": "Data", "/settings": "Settings",
};
const moreSheet = (page: Page) => page.getByRole("dialog", { name: "More" });

// ---------------------------------------------------------------------------------------------------- every width
for (const viewport of [SMALL_PHONE, PHONE, TABLET, DESKTOP]) {
  const size = `${viewport.width} × ${viewport.height}`;
  const narrow = viewport.width <= 860;
  for (const path of ROUTES) {
    test(`${path} · ${size}: no horizontal scroll, and the ${narrow ? "bottom bar holds five" : "rail lists every section"} with this one marked`, narrow ? WEBKIT : {}, async ({ page, request }) => {
      await useFixture(request, "in-band");
      await page.setViewportSize(viewport);
      await load(page, path);
      await expectNoHorizontalScroll(page);
      if (narrow) {
        await expect(bottomBar(page).locator(".bar-item")).toHaveText(BAR);
        await expect(sectionsNav(page)).toBeHidden();
        const marked = bottomBar(page).locator("[aria-current]");
        await expect(marked).toHaveCount(1);
        const section = SECTION_OF[path];
        await expect(marked.locator(".bar-label")).toHaveText(["Now", "Climate", "Water"].includes(section) ? section : section === "Activity" ? "Alerts" : "More");
      } else {
        await expect(sectionsNav(page).getByRole("link")).toHaveText(SECTION_NAMES);
        await expect(sectionsNav(page).locator("[aria-current=page] .nav-label")).toHaveText(SECTION_OF[path]);
        await expect(bottomBar(page)).toBeHidden();
      }
    });
  }
}

for (const viewport of [SMALL_PHONE, PHONE]) {
  const size = `${viewport.width} × ${viewport.height}`;
  for (const { path, fixture, charts } of SETTING_DRAWERS) {
    test(`${path} under ${fixture} · ${size}: the drawer's charts fit, with no horizontal scroll`, WEBKIT, async ({ page, request }) => {
      await useFixture(request, fixture);
      await page.setViewportSize(viewport);
      await load(page, path);
      const body = page.locator("dialog[open] .drawer-body");
      await expect(body.locator(".plot canvas")).toHaveCount(charts);
      await expectNoHorizontalScroll(page);
      expect(await body.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    });
  }
  for (const { path, status, heading } of CARD_PAGES) {
    test(`${path} · ${size}: the card alone, with no frame and no horizontal scroll`, WEBKIT, async ({ page, request }) => {
      await useFixture(request, "in-band");
      await page.setViewportSize(viewport);
      const response = await load(page, path);
      expect(response.status()).toBe(status);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(bottomBar(page)).toHaveCount(0);
      await expect(page.getByTestId("rail")).toHaveCount(0);
      await expect(page.locator(".role-pill")).toHaveCount(0);
      await expect(page.locator("[data-banner]")).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    });
  }
}

for (const path of [...ROUTES, ...CARD_PAGES.map((card) => card.path)]) {
  test(`${path}: with reduced motion no element has a transition or an animation`, async ({ page, request }) => {
    await useFixture(request, "in-band");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await load(page, path);
    const moving = await page.evaluate(() => {
      // css-animations-2: `auto`, a computed animation-duration in some engines, is 0s for an animation on the clock.
      const still = (durations: string) => durations.split(",").every((duration) => ["0s", "auto"].includes(duration.trim()));
      const found: string[] = [];
      for (const element of document.querySelectorAll("*")) {
        for (const pseudo of [null, "::before", "::after"]) {
          const style = getComputedStyle(element, pseudo);
          if (!still(style.transitionDuration) || !still(style.animationDuration)) found.push(`${element.tagName.toLowerCase()}.${element.className}${pseudo ?? ""}`);
        }
      }
      // What computed styles cannot show: anything running now, a script's element.animate() included.
      for (const animation of document.getAnimations()) found.push(`running: ${animation.constructor.name}`);
      return found;
    });
    expect(moving).toEqual([]);
  });
}

// ---------------------------------------------------------------------------------------------------- above 860 px
test("1440 px: the rail is fixed at the left with three labelled groups, an icon per section, the count on Activity and the theme switch", async ({ page, request }) => {
  await useFixture(request, "alerts-merged");
  await page.setViewportSize(DESKTOP);
  await load(page, "/record/compliance");
  const rail = page.getByTestId("rail");
  await expect(rail.locator(".nav-group-label")).toHaveText(GROUPS.map((group) => group.label));
  for (const group of GROUPS) {
    await expect(rail.locator(`.nav-group:has(.nav-group-label:text-is("${group.label}")) .nav-label`)).toHaveText([...group.sections]);
  }
  await expect(rail.locator(".rail-link svg.nav-icon")).toHaveCount(SECTIONS.length);
  await expect(rail.locator(".rail-link[aria-current=page] .nav-label")).toHaveText("Record");
  // The count: API-02 alerts.open, filled by the worst open severity.
  await expect(rail.locator(".nav-count")).toHaveText("2");
  await expect(rail.locator(".nav-count")).toHaveAttribute("data-severity", /^(critical|warning|info)$/);
  await expect(rail.getByRole("group", { name: "Theme" }).getByRole("radio")).toHaveCount(3);
  // Fixed: it stays at the left edge when the page scrolls, and the content column starts after it.
  await page.evaluate(() => window.scrollTo(0, 600));
  const [box, main] = await Promise.all([rail.boundingBox(), page.locator("main#main-content").boundingBox()]);
  expect([box!.x, box!.y]).toEqual([0, 0]);
  expect(main!.x).toBeGreaterThanOrEqual(box!.width);
  for (const link of await rail.locator(".rail-link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator("a[href='/more']")).toHaveCount(0);
});

test("1440 px: the sticky top bar holds Search, the freshness chip, Stop all water for an operator and the account menu", async ({ page, request }) => {
  await useFixture(request, "in-band");
  await page.setViewportSize(DESKTOP);
  await load(page, "/graphs");
  const bar = page.getByTestId("topbar");
  await expect(bar.getByRole("button", { name: /^Search/ })).toBeVisible();
  await expect(bar.getByTestId("freshness")).toHaveText(/^Last reading/);
  await expect(bar.getByTestId("freshness")).toHaveAttribute("href", "/system/controller");
  await expect(bar.getByRole("button", { name: "Stop all water" })).toBeVisible();
  await expect(bar.locator(".topbar-brand")).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 2000));
  const box = await bar.boundingBox();
  expect(box!.y).toBe(0);
  // `/` opens Search; Escape closes it.
  await page.locator("body").press("/");
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  await page.keyboard.type("drying");
  await expect(page.getByRole("dialog", { name: "Search" }).getByRole("option").first()).toContainText("Drying");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search" })).toHaveCount(0);
});

test("1440 px: a short page's footer reaches the bottom, and the page keeps one centred column inside --content", async ({ page, request }) => {
  await useFixture(request, "in-band");
  await page.setViewportSize(DESKTOP);
  for (const path of ["/water/schedules", "/graphs", "/review"]) {
    await load(page, path);
    const [rail, main] = await Promise.all([page.getByTestId("rail").boundingBox(), page.locator("main#main-content").boundingBox()]);
    const column = DESKTOP.width - rail!.width;
    expect(Math.abs(main!.x - rail!.width - (column - main!.width) / 2), path).toBeLessThanOrEqual(1);
  }
  const footer = await page.locator(".site-footer").boundingBox();
  expect(Math.round(footer!.y + footer!.height)).toBeGreaterThanOrEqual(DESKTOP.height);
});

// ---------------------------------------------------------------------------------------------------- 860 px and below
for (const viewport of [SMALL_PHONE, PHONE]) {
  test(`${viewport.width} px: the bar's five are an icon over a label, at least 44 px; the top bar has the lockup, the dot and the account`, WEBKIT, async ({ page, request }) => {
    await useFixture(request, "alerts-merged");
    await page.setViewportSize(viewport);
    await load(page, "/");
    const items = bottomBar(page).locator(".bar-item");
    await expect(items).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
      expect((await items.nth(index).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(items.nth(index).locator("svg.bar-icon")).toHaveCount(1);
    }
    await expect(bottomBar(page).locator("[data-section=activity] .nav-count")).toHaveText("2");
    const bar = page.getByTestId("topbar");
    await expect(bar.locator(".topbar-brand")).toBeVisible();
    await expect(bar.getByTestId("freshness").locator(".dot")).toBeVisible();
    await expect(bar.locator(".fresh-chip-text")).toHaveCSS("position", "absolute");
    await expect(bar.getByRole("button", { name: /^Search/ })).toBeHidden();
    await expect(bar.getByRole("button", { name: "Stop all water" })).toBeHidden();
    await expectRolePill(page, "OPERATOR");
    // The bar sits on the bottom edge.
    const box = await bottomBar(page).boundingBox();
    expect(Math.round(box!.y + box!.height)).toBe(viewport.height);
  });
}

test("390 px: More opens a sheet listing every section by group with the theme switch and Sign out; Escape and the scrim close it", WEBKIT, async ({ page, request }) => {
  await useFixture(request, "in-band");
  await page.setViewportSize(PHONE);
  await load(page, "/record/utilities");
  const more = bottomBar(page).getByRole("button", { name: /^More/ });
  await expect(more).toHaveAttribute("aria-current", "true");
  await more.click();
  const sheet = moreSheet(page);
  await expect(sheet).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const all = sheet.getByRole("navigation", { name: "All sections" });
  await expect(all.locator(".nav-group-label")).toHaveText(GROUPS.map((group) => group.label));
  await expect(all.getByRole("link")).toHaveText(SECTION_NAMES);
  await expect(all.locator("[aria-current=page]")).toHaveText(/^Record/);
  await expect(sheet.getByRole("group", { name: "Theme" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
  // Focus stays in the sheet: Tab from its last control comes back inside it.
  for (let index = 0; index < 30; index += 1) await page.keyboard.press("Tab");
  expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(more).toBeFocused();
  // The scrim, above the sheet, closes it too.
  await more.click();
  await page.mouse.click(PHONE.width / 2, 10);
  await expect(moreSheet(page)).toHaveCount(0);
  // A section chosen in the sheet goes there.
  await more.click();
  await moreSheet(page).getByRole("link", { name: "Data" }).click();
  await expect(page).toHaveURL(/\/system\/data$/);
  await expect(moreSheet(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Data");
  await expectNoHorizontalScroll(page);
});

test("390 px: the theme switch applies at once and the cookie keeps it on the next page load", async ({ page, request }) => {
  await useFixture(request, "in-band");
  await page.setViewportSize(PHONE);
  await load(page, "/");
  await bottomBar(page).getByRole("button", { name: /^More/ }).click();
  await moreSheet(page).getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await load(page, "/water");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await bottomBar(page).getByRole("button", { name: /^More/ }).click();
  await moreSheet(page).getByRole("radio", { name: "System" }).check();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
});

// ---------------------------------------------------------------------------------------------------- the parts
for (const viewport of [SMALL_PHONE, DESKTOP]) {
  test(`${viewport.width} px: the account menu reads OPERATOR, opens to the name, the role and Sign out, a POST to /auth/logout`, async ({ page, request }) => {
    await useFixture(request, "in-band");
    await page.setViewportSize(viewport);
    await load(page, "/water");
    const account = accountMenu(page);
    await expectRolePill(page, "OPERATOR");
    await expect(account.panel).toBeHidden();
    await account.open();
    await expect(account.panel).toContainText("Signed in as Jason (jason)");
    await expect(account.panel).toContainText("Operator: can change anything");
    await expect(account.signOut).toBeVisible();
    await expect(account.menu.locator("form")).toHaveAttribute("action", "/auth/logout");
    await expect(account.menu.locator("form")).toHaveAttribute("method", "post");
    // Escape closes it and puts focus back on its button.
    await page.keyboard.press("Escape");
    await expect(account.panel).toBeHidden();
    await expect(account.button).toBeFocused();
    await expectNoHorizontalScroll(page);
  });
}

for (const viewport of [PHONE, DESKTOP]) {
  test(`${viewport.width} px: the fault banner is a row of the sticky top bar and stays in view after scrolling 2,000 px; warn banners sit in flow`, async ({ page, request }) => {
    await useFixture(request, ["controller-not-reporting", "writes-off"]);
    await page.setViewportSize(viewport);
    await load(page, "/settings");
    const fault = page.locator("header.topbar .topbar-fault [data-banner=fault]");
    await expect(fault).toHaveText(/^Controller not reporting since/);
    await expect(page.locator("main [data-banner=warn]")).toHaveText(["Changes are switched off; reading still works"]);
    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(2000);
    await expect(fault).toBeInViewport();
    const box = await fault.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(200);
    await expect(page.locator("main [data-banner=warn]")).not.toBeInViewport();
    await expectNoHorizontalScroll(page);
  });
}

/** The page each redirect lands on, by its h1. */
const REDIRECT_TITLES: Readonly<Record<string, string>> = { "/review": "Review", "/record": "Daily record", "/lights/history": "Light history" };

test("the old paths redirect with their query to their v2 view, a log-filtered /activity to the log, and /more is not found", async ({ page, request }) => {
  await useFixture(request, "in-band");
  for (const { path, to } of REDIRECTS) {
    const response = await page.request.get(`${path}?x=1`, { maxRedirects: 0 });
    expect([response.status(), response.headers().location], path).toEqual([302, `${to}?x=1`]);
    await load(page, `${path}?x=1`);
    await expect(page).toHaveURL(new RegExp(`${to.replace(/\//g, "\\/")}\\?x=1$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(REDIRECT_TITLES[to]);
  }
  await load(page, "/activity?target=L01");
  await expect(page).toHaveURL(/\/activity\/log\?target=L01$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Activity log");
  await load(page, "/activity?alert=7");
  await expect(page).toHaveURL(/\/activity\?alert=7$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alerts");
  const response = await load(page, "/more");
  expect(response.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
});
