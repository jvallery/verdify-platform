// SPDX-License-Identifier: MIT
// The glossary is words.md section 4: exactly its terms, each defined in complete sentences.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { GLOSSARY, GLOSSARY_PATH, glossaryEntry } from "./glossary";

/** The terms words.md section 4 lists as rewritten or added, in its order, by their ids here. */
const SECTION_4 = [
  "vpd", "band", "edge", "band_in_force", "climate_law", "rule", "drying", "drying_price", "drying_cost_limit", "refused", "protection_limit",
  "running_alone", "widest_safe_band", "run_by_hand", "daily_record", "starts", "run_time", "in_band", "night_dried", "metered_estimated",
  "counter_check", "daily_review", "reviewer", "proposal", "hardware_budget", "gap_log", "delivery", "confirmed", "mist_fog_limit",
  "occupancy_hold", "main_light", "grow_light", "light_window", "light_timer", "peer_probes",
];

test("the glossary holds exactly words.md section 4's terms, in its order", () => {
  expect(Object.keys(GLOSSARY)).toEqual(SECTION_4);
  // The section's list, read from the design, names as many terms as the table holds.
  const design = readFileSync(new URL("../../../docs/design/dashboard/v2/words.md", import.meta.url), "utf8");
  const list = /## 4\. Glossary[^\n]*\n\n([\s\S]*?)\. Removed:/.exec(design);
  if (!list) throw new Error("no glossary list in words.md section 4");
  expect(list[1].replace(/^Rewritten or added, each a short definition in the voice above: /, "").split(/;\s*/)).toHaveLength(SECTION_4.length);
});

test("every definition is complete sentences, and the removed plan-era terms are gone", () => {
  for (const [id, entry] of Object.entries(GLOSSARY)) {
    expect(entry.term, id).toMatch(/^[A-Z]/);
    expect(entry.definition, id).toMatch(/^[A-Z][^]*\.$/);
    expect(entry.definition.length, id).toBeLessThanOrEqual(400);
  }
  for (const removed of ["iris", "iris_triggers", "plan_changes", "ai_mark", "holding", "derived", "house_band", "bursts", "in_band_today"]) {
    expect(Object.hasOwn(GLOSSARY, removed), removed).toBe(false);
  }
  expect(glossaryEntry("drying_cost_limit").term).toBe("Drying cost limit");
  expect(GLOSSARY_PATH).toBe("/settings#glossary");
});
