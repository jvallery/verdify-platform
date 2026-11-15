// SPDX-License-Identifier: MIT
// Reviewable fixture screenshots from the same cluster-backed build the behavioral suite exercises.
import { mkdir } from "node:fs/promises";
import { DESKTOP, PHONE, expect, expectNoHorizontalScroll, load, test, useScreensClock } from "./support";

for (const viewport of [DESKTOP, PHONE]) {
  for (const [name, path] of [["overview", "/"], ["water", "/water"], ["hydroponics", "/hydroponics"], ["crops", "/crops"], ["climate", "/graphs"], ["activity", "/activity"], ["settings", "/settings"], ["planner", "/plan"]]) {
    test(`visual review ${name} at ${viewport.width}px`, async ({ page, request }) => {
      await page.setViewportSize(viewport);
      await useScreensClock(page, request, ["hydro-live", "crops-planted"]);
      await load(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await mkdir("../artifacts/experience", { recursive: true });
      await page.screenshot({ path: `../artifacts/experience/${name}-${viewport.width}.png`, fullPage: true });
    });
  }
}
