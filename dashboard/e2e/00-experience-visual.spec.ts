// SPDX-License-Identifier: MIT
// Reviewable fixture screenshots from the same cluster-backed build the behavioral suite exercises.
import { mkdir } from "node:fs/promises";
import { DESKTOP, PHONE, expect, expectNoHorizontalScroll, load, test, useScreensClock } from "./support";

for (const viewport of [DESKTOP, { width: 820, height: 1180 }, PHONE]) {
  for (const [name, path] of [["overview", "/"], ["water", "/water"], ["schedules", "/water/schedules"], ["schedule-editor", "/water/schedules?schedule=new"], ["water-history", "/water/history"], ["hydroponics", "/hydroponics"], ["crops", "/crops"], ["crop-history", "/crops/history"], ["climate", "/graphs"], ["zones", "/graphs/zones"], ["lighting", "/graphs/lighting"], ["statistics", "/graphs/statistics"], ["activity", "/activity"], ["log", "/activity/log"], ["settings", "/settings"], ["setting-editor", "/settings?edit=mister_engage_kpa"], ["band", "/band"], ["equipment", "/equipment"], ["planner", "/plan"], ["planner-history", "/planner/history"]]) {
    test(`visual review ${name} at ${viewport.width}px`, async ({ page, request }) => {
      await page.setViewportSize(viewport);
      await useScreensClock(page, request, ["hydro-live", "crops-planted"]);
      await load(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await mkdir("../artifacts/experience", { recursive: true });
      await page.screenshot({ path: `../artifacts/experience/${name}-${viewport.width}-viewport.png` });
      await page.screenshot({ path: `../artifacts/experience/${name}-${viewport.width}.png`, fullPage: true });
    });
  }
}
