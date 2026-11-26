// SPDX-License-Identifier: MIT
/**
 * WP3's named fixtures (Water, redesign §10.5). Each is a patch over the base `in-band` world, written with world.mjs's
 * exported helpers (`clock`, `lineOf`, `itemOf`, `settingOf`, `runLine`, `openAlert`, …) the way the fixtures in
 * world.mjs are, and it may apply a base fixture first (`import { FIXTURES as BASE } from "./world.mjs"`, then
 * `BASE["l01-running"](world)`). index.mjs registers this map
 * once, through `registerFixtures`; a name already registered (a base fixture's or another package's) fails the import,
 * so no package shadows another. Screen packages add fixtures here only, never in world.mjs or operations.mjs.
 *
 * @type {Readonly<Record<string, (world: any) => void>>}
 */
import { FIXTURES as BASE, DAY, JASON, clock, iso, lineOf } from "./world.mjs";

const EVERY_DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const FIXTURES = {
  // Soil: the west probe's columns are not in the series registry (API-03), as before that probe was wired: its panel says
  // it has not reported and draws nothing.
  "soil-west-unserved": (world) => {
    world.metrics = world.metrics.filter((metric) => !String(metric.key).endsWith("_west") || !String(metric.key).startsWith("climate.soil_"));
  },
  "soil-wall-trends": (world) => {
    world.soilWaves = {
      "climate.soil_ph_south_1": [3.7, 0.1], "climate.soil_ph_west": [4.2, 0.1],
      "climate.soil_ec_west": [80, 3],
      "climate.soil_salinity_south_1": [24, 2], "climate.soil_salinity_west": [44, 2],
      "climate.soil_tds_south_1": [22, 2], "climate.soil_tds_west": [40, 2],
      "climate.soil_moisture_west": [100, 0],
    };
    for (const key of Object.keys(world.soilWaves)) {
      if (world.metrics.some((metric) => metric.key === key)) continue;
      const zone = key.endsWith("_west") ? "west" : "south";
      const base = world.metrics.find((metric) => metric.key === `climate.soil_moisture_${zone === "west" ? "west" : "south_1"}`);
      const unit = key.includes("_ph_") ? "pH" : key.includes("_ec_") ? "µS/cm" : "raw";
      world.metrics.push({ ...base, key, unit, label: key });
    }
    world.outages.push({ keys: ["climate.soil_ph_west"], from: world.now - 6 * DAY / 24, to: world.now - 5 * DAY / 24 });
  },
  // Soil (design review B10): the south 1 probe silent for three days, as the production probes have been since Nov 14.
  // Its panel shows a dash and "no reading since …" for each measure, never its last number as if it were current.
  "soil-silent": (world) => {
    world.outages.push({ keys: ["climate.soil_moisture_south_1", "climate.soil_temp_south_1", "climate.soil_ec_south_1"], from: world.now - 3 * DAY, to: Number.POSITIVE_INFINITY });
  },
  /**
   * Schedules' day (redesign §6.2, §6.6) with something on every kind of row: schedules-paused's week, L01 paused until
   * 14:00 by jason because of rain (a pause band across today's track), and Iris's "Midday mist" at 13:00 on L07, whose
   * Schedule is off, so each of its blocks is hatched with "Skipped until Schedule is on".
   */
  "schedules-day": (world) => {
    BASE["l01-paused"](world);
    const at = clock(world.now);
    world.schedules.push({
      slot_id: 14, line_id: "L07", label: "Midday mist", enabled: true, days: EVERY_DAY, start: { kind: "clock", clock: "13:00" }, on_s: 45, count: 4, gap_s: 60,
      prewet_s: 0, flush_s: 0, degraded_only: false, manual: false, sync: "confirmed", updated_by: { source: "iris", name: "iris" }, updated_at: iso(at("06:10", -1)),
    });
    Object.assign(lineOf(world, "L07"), { schedule_member: false });
    // A disabled schedule stays in the rules list, muted under its line.
    world.schedules.push({
      slot_id: 15, line_id: "L01", label: "Evening top-up", enabled: false, days: EVERY_DAY, start: { kind: "clock", clock: "16:00" }, on_s: 600, count: 1, gap_s: 0,
      prewet_s: 0, flush_s: 0, degraded_only: false, manual: true, sync: "confirmed", updated_by: JASON, updated_at: iso(at("09:30", -1)),
    });
  },
};
