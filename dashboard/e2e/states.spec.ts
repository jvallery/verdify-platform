// SPDX-License-Identifier: MIT
// The honesty rules most likely to slip (screens §1.2, §1.5): while data is missing no page reads as an all clear.
import { ROUTES } from "./routes";
import { expect, expectNoText, load, test, untilPolled, useFixture } from "./support";

for (const path of ROUTES) {
  test(`${path}: with the API down, after two failed polls the banner shows and nothing reads green`, async ({ page, request }) => {
    await useFixture(request, "api-down");
    await page.clock.install();
    await load(page, path);
    // The shell's backoff puts its second poll 30 s after the first, and the banner waits for that second failure.
    await untilPolled(page, () => expect(page.locator("[data-banner=fault]")).toHaveText("Dashboard API unavailable", { timeout: 1_000 }), 31_000);
    for (const reassurance of ["All OK", "No open alerts", "CONFIRMED"]) await expectNoText(page, reassurance);
    // Record's tab, title and notes name "In band" (README section 3, words.md), so there the badges carry the check.
    if (!path.startsWith("/record")) await expectNoText(page, /\bin band\b/i);
    await expect(page.locator(".badge-ok, .tag-ok, .fresh-ok")).toHaveCount(0);
  });

  for (const [fixture, banner] of [
    // Screens §1 block 1: the controller keeps holding the band on its own (its law runs with or without the host).
    ["ingestor-not-running", /^Ingestor\snot\srunning\ssince\s\d\d:\d\d\.\sThe\scontroller\skeeps\sholding\sthe\sband\son\sits\sown;\snothing\snew\sis\srecorded\suntil\sit\sis\sback\./],
    ["controller-not-reporting", /^Controller\snot\sreporting\ssince\s\d\d:\d\d\.\sIf\sit\shas\spower,\sit\skeeps\sholding\sthe\sband\son\sits\sown\sand\skeeps\sits\swater\sschedules/],
  ] as const) {
    test(`${path}: under ${fixture} the banner says so, never "Controller offline" or "No open alerts"`, async ({ page, request }) => {
      await useFixture(request, fixture);
      await load(page, path);
      await expect(page.locator("[data-banner=fault]")).toHaveText(banner);
      await expectNoText(page, /controller offline/i);
      await expectNoText(page, /no open alerts/i);
    });
  }
}
