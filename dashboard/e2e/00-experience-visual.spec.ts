// SPDX-License-Identifier: MIT
// Reviewable fixture screenshots from the same cluster-backed build the behavioral suite exercises: every v2 view at
// three widths in the light theme, at 1440 and 390 px in the dark theme too, and a few named states. The pictures are
// written before anything is asserted, so a failing page still leaves its picture for review.
import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { ROUTES } from "./routes";
import { DESKTOP, PHONE, expect, expectNoHorizontalScroll, load, test, useScreensClock } from "./support";

const OUT = "../artifacts/experience";
const TABLET = { width: 820, height: 1180 };
const BASE = ["hydro-live", "crops-planted"] as const;
const nameOf = (path: string) => path.slice(1).replaceAll("/", "-") || "now";

type Shot = { name: string; path: string; fixtures: readonly string[]; dark: boolean };
/** Every view of e2e/routes.ts, plus the two editors that open over a page. */
const VIEWS: Shot[] = [
  ...ROUTES.map((path) => ({ name: nameOf(path), path, fixtures: BASE, dark: true })),
  { name: "water-schedule-editor", path: "/water/schedules?schedule=new", fixtures: BASE, dark: false },
  { name: "settings-editor", path: "/settings?edit=outdoor_staleness_max_s", fixtures: BASE, dark: false },
];
/** States a reviewer should see once: drying running and refused, a proposal, a late review, low memory, failing delivery. */
const STATES: Shot[] = [
  { name: "now-alerts", path: "/", fixtures: ["alerts-merged"], dark: false },
  { name: "now-drying", path: "/", fixtures: ["law-drying-running"], dark: false },
  { name: "climate-drying-running", path: "/climate", fixtures: ["law-drying-running"], dark: false },
  { name: "climate-refused-cost", path: "/climate", fixtures: ["law-drying-refused-cost"], dark: false },
  { name: "climate-not-reporting", path: "/climate", fixtures: ["law-not-reporting"], dark: false },
  { name: "climate-hot-limit", path: "/climate", fixtures: ["law-hot-limit"], dark: false },
  { name: "now-no-temperature", path: "/", fixtures: ["law-no-temperature"], dark: false },
  { name: "lights-differ", path: "/lights", fixtures: ["grow-lights-differ"], dark: false },
  { name: "review-proposal", path: "/review", fixtures: ["review-proposal-waiting"], dark: false },
  { name: "review-missed", path: "/review", fixtures: ["review-missed"], dark: false },
  { name: "record-partial", path: "/record", fixtures: ["record-partial-day"], dark: false },
  { name: "controller-heap-low", path: "/system/controller", fixtures: ["controller-heap-low"], dark: false },
  { name: "data-delivery-failing", path: "/system/data", fixtures: ["delivery-failing"], dark: false },
];

/** The theme as the switch applies it: the attribute, then the event the charts redraw on; two frames let them paint. */
async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate(async (next) => {
    document.documentElement.setAttribute("data-theme", next);
    document.dispatchEvent(new Event("verdify:theme"));
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))));
  }, theme);
}

function shoot(shot: Shot, viewport: { width: number; height: number }) {
  test(`visual review ${shot.name} at ${viewport.width}px`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await useScreensClock(page, request, shot.fixtures);
    let failure: unknown = null;
    try { await load(page, shot.path); } catch (error) { failure = error; }
    await mkdir(OUT, { recursive: true });
    const file = `${OUT}/${shot.name}-${viewport.width}`;
    if (shot.name === "now") await page.screenshot({ path: `${file}-viewport.png` });
    await page.screenshot({ path: `${file}.png`, fullPage: true });
    if (shot.dark && viewport.width !== TABLET.width) {
      await setTheme(page, "dark");
      await page.screenshot({ path: `${file}-dark.png`, fullPage: true });
      await setTheme(page, "light");
    }
    if (failure) throw failure;
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}

for (const viewport of [DESKTOP, TABLET, PHONE]) for (const shot of VIEWS) shoot(shot, viewport);
for (const viewport of [DESKTOP, PHONE]) for (const shot of STATES) shoot(shot, viewport);
