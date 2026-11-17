// SPDX-License-Identifier: MIT
// US-NOW-07's bar, for dashboard v2 (design-system section 6): WCAG 2.2 AA on every route and SCR-09 card at 320, 768
// and 1440 px, every route in the light theme and in the dark one, no rule disabled and no route skipped. The theme is
// the `theme` cookie the root loader reads (app/lib/theme.ts THEME_COOKIE), so the server renders `data-theme` and axe
// sees the first paint's colours. The SCR-09 cards are checked in the light theme.
import { CARD_PAGES, ROUTES, SETTING_DRAWERS } from "./routes";
import { axe, expect, load, test, useFixture } from "./support";

/** The cookie app/lib/theme.ts names THEME_COOKIE. */
const THEME_COOKIE = "theme";
const THEMES = ["light", "dark"] as const;

for (const theme of THEMES) for (const width of [320, 768, 1440]) for (const path of ROUTES) {
  test(`${path} · ${width} px · ${theme} · WCAG 2.2 AA`, async ({ page, request, baseURL }) => {
    test.slow(path === "/settings", "axe over hundreds of rows takes about 15 s on the CI pod");
    await useFixture(request, "in-band");
    await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url: baseURL }]);
    await page.setViewportSize({ width, height: 900 });
    const response = await load(page, path);
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toMatch(/\sstyle\s*=/i);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await axe(page);
  });
}

for (const width of [320, 768, 1440]) for (const { path, status } of CARD_PAGES) {
  test(`${path} · ${width} px · WCAG 2.2 AA`, async ({ page, request }) => {
    await useFixture(request, "in-band");
    await page.setViewportSize({ width, height: 900 });
    const response = await load(page, path);
    expect(response.status()).toBe(status);
    expect(await response.text()).not.toMatch(/\sstyle\s*=/i);
    await axe(page);
  });
}

for (const width of [320, 768, 1440]) for (const { path, fixture, charts } of SETTING_DRAWERS) {
  test(`${path} under ${fixture} · ${width} px · WCAG 2.2 AA`, async ({ page, request }) => {
    await useFixture(request, fixture);
    await page.setViewportSize({ width, height: 900 });
    await load(page, path);
    await expect(page.locator("dialog[open] .plot canvas")).toHaveCount(charts);
    await axe(page);
  });
}
