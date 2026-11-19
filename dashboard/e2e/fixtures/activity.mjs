// SPDX-License-Identifier: MIT
/**
 * Activity's v2 fixtures (dashboard v2 screens.md section 9, parity A-01 to A-04): alerts of the climate law, the daily
 * review and the controller, each explained on its own page, with one retired check; and a log with the writes the v2
 * model makes: the owner's band save of several edges, the reviewer's watering inside a daily review and a crop note.
 * Each is a patch over the base `in-band` world, written with world.mjs's exported helpers, as now-activity.mjs's are.
 * index.mjs registers this map once, through `registerFixtures`, as `activity.mjs`.
 *
 * @type {Readonly<Record<string, (world: any) => void>>}
 */
import { JASON, clock, iso, openAlert } from "./world.mjs";

const MINUTE = 60_000;
const entry = (row) => ({ detail: {}, reason: null, state: null, confirmed_at: null, experiment_id: null, request_id: null, ...row });

export const FIXTURES = {
  // Three v2 alerts, each with its page (drying, the controller, the review), and an old alert of a retired check
  // resolved this morning, which has none.
  "alerts-v2": (world) => {
    const at = clock(world.now);
    openAlert(world, {
      id: 601, alert_type: "drying_refused_all_day", category: "climate", severity: "warning", message: "Drying was wanted for 9 h and refused all day: cost over the limit",
      details: { refusal: "cost_over_limit", wanted_min: 540 }, first_seen_at: iso(at("06:00")),
      runbook: "1. Open Drying and read the price against the limit.\n2. Raise the limit only if the house must dry tonight.",
    });
    openAlert(world, {
      id: 602, alert_type: "law_constants_mismatch", category: "system", severity: "critical", message: "The controller's constants hash differs from the released file",
      details: { reported: "a1b2c3d4", released: "e5f6a7b8" }, first_seen_at: iso(world.now - 40 * MINUTE), last_seen_at: iso(world.now - 2 * MINUTE), count: 4,
    });
    openAlert(world, {
      id: 603, alert_type: "daily_review_missed", category: "system", severity: "info", message: "No daily review was written for yesterday",
      first_seen_at: iso(at("07:30")),
    });
    openAlert(world, {
      id: 604, alert_type: "planner_stale", category: "system", severity: "info", message: "No settings written for 6 h", first_seen_at: iso(at("02:10")),
      status: "resolved", resolved_at: iso(at("05:00")), resolved_by: "jason", resolution: "Retired check",
    });
  },
  // The log of the v2 model: the band saved with four edges, the reviewer's watering inside a daily review and a crop note.
  "activity-v2": (world) => {
    const at = clock(world.now);
    world.activity = [
      entry({
        id: 41, ts: iso(at("09:10")), actor: JASON, action: "band.write", target: "house band", reason: "Cooler nights for winter",
        detail: {
          changes: [
            { param: "band_temp_low_sr", desired_id: 901, before: 60, value: 58 }, { param: "band_temp_low_ss", desired_id: 902, before: 62, value: 60 },
            { param: "band_vpd_high_sm", desired_id: 903, before: 1.4, value: 1.3 }, { param: "band_vpd_low_mid", desired_id: 904, before: 0.5, value: 0.6 },
          ],
        },
        state: "confirmed", confirmed_at: iso(at("09:11")),
      }),
      entry({
        id: 42, ts: iso(at("07:20")), actor: { source: "iris", name: "iris" }, action: "irrigation.run", target: "L01",
        detail: { minutes: 8, trigger_id: "review-2026-11-02" }, reason: "Wall soil drier than yesterday",
      }),
      entry({ id: 43, ts: iso(at("07:05")), actor: JASON, action: "planting.note", target: "12", reason: "New growth on the south bench" }),
    ];
  },
};
