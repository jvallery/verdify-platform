// SPDX-License-Identifier: MIT
/**
 * WP2's named fixtures (Graphs, redesign §10.4). Each is a patch over the base `in-band` world, written with world.mjs's
 * exported helpers (`clock`, `lineOf`, `itemOf`, `settingOf`, `runLine`, `openAlert`, …) the way the fixtures in
 * world.mjs are, and it may apply a base fixture first (`import { FIXTURES as BASE } from "./world.mjs"`, then
 * `BASE["l01-running"](world)`). index.mjs registers this map
 * once, through `registerFixtures`; a name already registered (a base fixture's or another package's) fails the import,
 * so no package shadows another. Screen packages add fixtures here only, never in world.mjs or operations.mjs.
 *
 * @type {Readonly<Record<string, (world: any) => void>>}
 */
import { JASON, clock, iso, nextId, openAlert } from "./world.mjs";

const HYDRO_METRICS = [
  ["hydro_ph", "Hydroponic pH", "pH"], ["hydro_ec_us_cm", "Hydroponic EC", "µS/cm"],
  ["hydro_water_temp_f", "Hydroponic water temperature", "°F"],
].map(([key, label, unit]) => ({ key: `climate.${key}`, label, unit, group: "water and soil", cadence_s: 300, retention_days: 365, provenance: "MEASURED", zone: null, daily: false, note: null }));
const hydro = (world) => {
  world.metrics.push(...structuredClone(HYDRO_METRICS));
  const sample = (value) => ({ value, observed_at: iso(world.now - 180000), reason: null });
  world.hydroponics = { ph: sample(6.4), ec_us_cm: sample(1889), water_temp_f: sample(75.4), stale_after_s: 600 };
};

export const FIXTURES = {
  "hydro-live": hydro,
  "hydro-no-data": (world) => {
    hydro(world);
    for (const key of ["ph", "ec_us_cm", "water_temp_f"]) world.hydroponics[key] = { value: null, observed_at: null, reason: "No reservoir sample in the last 24 h" };
    world.outages.push({ keys: HYDRO_METRICS.map((metric) => metric.key), from: world.now - 31 * 86400000, to: world.now + 86400000 });
  },
  "hydro-gaps": (world) => {
    hydro(world);
    world.outages.push({ keys: ["climate.hydro_ph"], from: world.now - 6 * 3600000, to: world.now - 3 * 3600000 });
  },
  // Graphs → Climate's story line and excursion shading (redesign §5.5): the band in force narrowed to 64.5–68.0 °F, so
  // the day's temperature wave (63–69 °F, coolest at 01:00, warmest at 13:00) runs too cold overnight, from about 21:00
  // to 05:00, and too warm again from about 09:50.
  "graphs-excursions": (world) => {
    world.band.temp_f = { ...world.band.temp_f, low: 64.5, high: 68 };
  },
  // The event rail (redesign §7.1), beside the base's Iris plan at 07:02, the forecast rule at 06:30 and L04's runs at
  // 06:58: Jason's change of the outdoor staleness limit at 08:42, an agent's of the fog ceiling at 09:00, and a band-drift
  // warning raised at 08:00 and resolved at 09:30.
  "graphs-events": (world) => {
    const at = clock(world.now);
    const id = nextId(world.activity);
    world.activity.push(
      {
        id, ts: iso(at("08:42")), actor: JASON, action: "setting.write", target: "outdoor_staleness_max_s", detail: { before: 660, value: 630 }, reason: "Vandas drying",
        state: "confirmed", confirmed_at: iso(at("08:43")), experiment_id: null, request_id: "6a1e7c2d-3b4f-4e5a-8c9d-0e1f2a3b4c5d",
      },
      {
        id: id + 1, ts: iso(at("09:00")), actor: { source: "agent:steward", name: "steward" }, action: "setting.write", target: "mister_water_budget_gal",
        detail: { before: 300, value: 250 }, reason: "Night humidity", state: "confirmed", confirmed_at: iso(at("09:01")), experiment_id: null, request_id: null,
      },
    );
    openAlert(world, {
      id: 501, alert_type: "house_band_drift", category: "climate", severity: "warning", message: "VPD above its band for 30 minutes", first_seen_at: iso(at("08:00")),
      last_seen_at: iso(at("09:20")), status: "resolved", resolved_at: iso(at("09:30")), resolved_by: "system", resolution: "back inside the band",
    });
  },
};
