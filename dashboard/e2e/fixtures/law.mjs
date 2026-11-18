// SPDX-License-Identifier: MIT
/**
 * The climate law, the daily record, the daily review and the system pages (dashboard v2): API-30 to API-37 answered
 * from a fixture world, and their named fixtures. The base state is built on first use (`lawOf`), so every fixture
 * world carries it without world.mjs knowing it; a named fixture here changes it before any read. The values follow
 * the production samples of 2026-11-17 (law records, the drying meter, the daily record, the relay record, the
 * diagnostics row and both planner_review rows), moved onto the fixture clock: the fixture's today is the live
 * partial day, yesterday the live 11-16, and so on. The thresholds mirror verdify_schemas/climate_law.yaml for tests
 * only; the UI never re-implements them.
 */
import { DAY, addDays, iso, local, localInstant, openAlert, settingOf } from "./world.mjs";

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;

// ---------------------------------------------------------------------------------------------------- law constants
/** The law constants (verdify_schemas/climate_law.yaml), as the API serves them. */
const LAW = {
  heat1: [3.5, 4.5], heat2: [0.5, 3.0], cool: [0.0, 2.0], fan2: [1.5, 0.0], fog: [0.0, 0.15], mist: [0.3, 0.05], dry: [0.05, 0.2],
  dry_start_above_low_f: 1.5, hot_f: 100.0, cold_f: 40.0,
};
/** API-23's law_lines: where each rule switches on, as an offset from the band edge it reads. */
export const LAW_LINES = {
  heat1_on_above_low_f: LAW.heat1[0], heat2_on_above_low_f: LAW.heat2[0], cool_on_above_high_f: LAW.cool[0], fan2_on_above_high_f: LAW.fan2[0],
  dry_on_above_vpd_low_kpa: LAW.dry[0], fog_on_above_vpd_high_kpa: LAW.fog[0], mist_on_above_vpd_high_kpa: LAW.mist[0],
};
const TIMING = {
  relay_min_on_s: 300, relay_min_off_s: 300, fog_min_on_s: 120, fog_min_off_s: 120, furnace_boot_wait_s: 300, mist_pulse_s: 30, mist_gap_s: 60,
  hot_limit_f: LAW.hot_f, cold_limit_f: LAW.cold_f,
};
export const RELEASE_HASH = "4250fb1da7d5460388c144f8124dfcc736e0e49077a5cb34496eff3a17120be6";
/** The hardware-budget thresholds the API serves (verdify_services/system_health.py): heap_diagnostics.h, gap_log.h and greenhouse.yaml;
 * stack_free_b is the estate alert's 1,024 B, because the firmware has no loop-stack guard. */
const LIMITS = {
  heap_warning_kb: 25, heap_critical_kb: 15, largest_block_kb: 16, ota_free_kb: 32, loop_worst_ms: 250, nvs_write_ms: 200, stack_free_b: 1024,
  nvs_arm_free_pct: 25, nvs_stop_free_pct: 15,
};

/** A refused read: the fixture API answers it as a problem. */
export class LawRefusal extends Error {
  constructor(status, code, detail) {
    super(detail);
    Object.assign(this, { status, code, detail });
  }
}
const refuse = (status, code, detail) => new LawRefusal(status, code, detail);
const round = (value, places) => (value === null || value === undefined ? null : Number(value.toFixed(places)));
const at = (date, hhmm) => localInstant(date, hhmm);
const today = (world) => local(world.now).date;
/** Dew point in °F from °F and % (Magnus), or null. */
function dewPoint(tempF, rh) {
  if (tempF === null || tempF === undefined || rh === null || rh === undefined || rh <= 0) return null;
  const c = (tempF - 32) / 1.8;
  const gamma = Math.log(rh / 100) + (17.27 * c) / (237.3 + c);
  return round(((237.3 * gamma) / (17.27 - gamma)) * 1.8 + 32, 1);
}
/**
 * The outdoor dew point as the API computes it (verdify_schemas.vpd_envelope.outdoor_dewpoint_f, Tetens and its
 * inverse), unrounded; null when a reading is missing or the humidity is not above zero.
 */
function outdoorDewPoint(tempF, rh) {
  if (tempF === null || tempF === undefined || rh === null || rh === undefined || rh <= 0) return null;
  const c = ((tempF - 32) * 5) / 9;
  const vapour = (rh / 100) * 0.6108 * Math.exp((17.27 * c) / (c + 237.3));
  const g = Math.log(Math.max(vapour, 1e-6) / 0.6108);
  const value = ((237.3 * g) / (17.27 - g)) * 9 / 5 + 32;
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------------------------------- the base state
/**
 * The law's daily pattern, by local clock: electric heat through the night, the furnace once before dawn, cooling
 * and the second fan in the early afternoon, one short fog run, drying wanted in the evening with two runs. Outdoor
 * air is drier except over the afternoon. Today's spans after the fixture's 10:42 are never reached.
 */
const PATTERN = {
  "request.heat1": [["00:30", "02:10"], ["03:00", "05:20"], ["05:50", "07:10"]],
  "request.heat2": [["04:10", "04:35"]],
  "request.vent": [["12:10", "13:05"], ["14:20", "14:50"], ["19:20", "19:48"], ["21:10", "21:31"]],
  "request.fog": [["13:15", "13:21"]],
  "request.mist": [],
  "request.fan1": [["12:10", "13:05"], ["14:20", "14:50"], ["19:20", "19:48"], ["21:10", "21:31"]],
  "request.fan2": [["12:30", "12:50"]],
  "request.cooling": [["12:10", "13:05"], ["14:20", "14:50"]],
  "request.drying": [["19:20", "19:48"], ["21:10", "21:31"]],
  "request.hot": [],
  "request.cold": [],
  "latch.h1": [["00:30", "02:10"], ["03:00", "05:20"], ["05:50", "07:10"]],
  "latch.h2": [["04:10", "04:35"]],
  "latch.cool": [["12:10", "13:05"], ["14:20", "14:50"]],
  "latch.cool2": [["12:30", "12:50"]],
  "latch.wet": [["13:15", "13:21"]],
  "latch.mist": [],
  "latch.dry": [["19:00", "22:30"]],
  "latch.air": [["00:00", "13:00"], ["16:00", "24:00"]],
  "latch.run": [["19:20", "19:48"], ["21:10", "21:31"]],
};
export const LANE_KEYS = Object.keys(PATTERN);
/** Why drying was refused while wanted and not running, by local clock. */
const REFUSALS = [["19:00", "19:20", "too_cold"], ["19:48", "21:10", "cost"], ["21:31", "22:30", "furnace"]];
const spansOn = (date, spans) => spans.map(([start, end]) => [at(date, start), end === "24:00" ? at(addDays(date, 1), "00:00") : at(date, end)]);

/**
 * The 8 live daily_record rows (11-17 partial back to 11-10), today first. The drying meter and the law's drying record
 * (drying[3..6]) exist only on a day with a law record: today (no drying record until the day is complete), yesterday,
 * and the three days before it from the fixture's first law record (baseLaw's firstRecordAt, four days back), scaled
 * from yesterday's live values; every older day is before the law, where migration 317 stores them null.
 */
const RECORD = [
  { kwh_partial: 8.25, kwh: null, cov: 31.9, therms: 1.959, water: [1.0, 1.0, 1.0, 0.0, false], sample: 91.9, drying: [129.8, 1, 1, 247, 177, false, null] },
  { kwh_partial: 20.86, kwh: 25.09, cov: 83.1, therms: 2.863, water: [46.0, 44.0, 6.0, 2.0, false], sample: 96.7, drying: [2383.3, 21, 13, 1703, 867, false, { wanted_s: 7260, refused_s: { cost: 466, furnace: 558, too_cold: 5273 } }] },
  { kwh_partial: 22.25, kwh: 24.73, cov: 90, therms: 3.126, water: [47.0, 46.0, 8.0, 1.0, true], sample: 99.7, drying: [4614.9, 29, 12, 3298, 1679, false, { wanted_s: 9840, refused_s: { cost: 610, furnace: 720, too_cold: 3895 } }] },
  { kwh_partial: 25.90, kwh: 29.95, cov: 86.5, therms: 3.216, water: [165.0, 31.0, 4.0, 134.0, false], sample: 98.1, drying: [2639.4, 20, 5, 1886, 960, false, { wanted_s: 6300, refused_s: { cost: 402, furnace: 610, too_cold: 2649 } }] },
  // The law's first day: its record starts at 13:48 local, so the law's drying record covers only the afternoon.
  { kwh_partial: 27.22, kwh: 29.84, cov: 91.2, therms: 2.487, water: [33.0, 33.0, 2.0, 0.0, true], sample: 98.9, drying: [1537.4, 12, 7, 1099, 559, false, { wanted_s: 3420, refused_s: { furnace: 212, too_cold: 1190 } }] },
  { kwh_partial: 24.98, kwh: 28.75, cov: 86.9, therms: 1.837, water: [36.0, 32.0, 6.0, 1.0, true], sample: 99.8, drying: [1065.8, 9, 2, null, null, null, null] },
  { kwh_partial: 24.95, kwh: 28.60, cov: 87.2, therms: 2.269, water: [32.0, 32.0, 5.0, 0.0, true], sample: 99.2, drying: [1331.7, 11, 2, null, null, null, null] },
  { kwh_partial: 28.02, kwh: 31.12, cov: 90, therms: 2.042, water: [31.0, 31.0, 1.0, 0.0, false], sample: 98.9, drying: [1006.8, 9, 4, null, null, null, null] },
];
/** daily_band_compliance, today first (11-17 back to 11-08): graded, temp in/below/above, vpd in/below/above, both, day, night, night dry-out, dried. */
const COMPLIANCE = [
  [545, 96.3, 3.7, 0, 66.1, 33.9, 0, 62.4, 85.2, 54.9, 170, false],
  [1410, 92.9, 7.1, 0, 81.2, 18.8, 0, 79.8, 89.2, 72.8, 255, true],
  [1440, 93.8, 6.3, 0, 57.3, 42.0, 0.7, 54.5, 74.2, 40.5, 65, false],
  [1430, 95.5, 4.5, 0, 54.9, 45.1, 0, 53.1, 76.7, 36.1, 150, false],
  [1440, 98.3, 1.7, 0, 60.4, 39.6, 0, 60.1, 75.0, 49.4, 105, false],
  [1440, 98.3, 1.7, 0, 55.6, 44.1, 0.3, 55.2, 76.9, 39.5, 190, false],
  [1440, 98.6, 1.4, 0, 66.3, 33.7, 0, 65.3, 82.8, 52.4, 210, false],
  [1435, 96.9, 3.1, 0, 63.8, 35.9, 0.3, 62.0, 77.7, 50.6, 120, false],
  [1440, 97.9, 2.1, 0, 60.4, 39.2, 0.3, 59.0, 68.0, 52.4, 155, false],
  [1440, 97.2, 2.8, 0, 47.6, 51.7, 0.7, 47.2, 66.4, 33.1, 85, false],
];
/** daily_relay_record: today (partial) and yesterday as stored; older days scaled from the 32-day start totals. */
const RELAYS = [
  { heat1: [14, 25061, 0], heat2: [15, 9405, 0], fan1: [0, 0, 0], fan2: [1, 300, 0], vent: [1, 301, 0], fog: [1, 120, 0] },
  { heat1: [36, 62828, 0], heat2: [25, 13741, 1], fan1: [10, 2101, 1], fan2: [12, 2161, 1], vent: [22, 4281, 2], fog: [4, 343, 0], drip_wall: [1, 600, 0] },
];
const RELAY_KEYS = ["heat1", "heat2", "fan1", "fan2", "vent", "fog", "mister_center", "mister_south", "mister_west", "drip_wall", "drip_center"];
const CLIMATE_RELAYS = ["heat1", "heat2", "fan1", "fan2", "vent", "fog"];
/** Days of daily records the base world holds (older days have none). */
const RECORD_DAYS = 45;

function recordRows(world) {
  const first = today(world);
  return Array.from({ length: RECORD_DAYS }, (_, back) => {
    const date = addDays(first, -back);
    const live = RECORD[back];
    const grade = COMPLIANCE[back] ?? COMPLIANCE[8 + (back % 2)];
    const kwhPartial = live?.kwh_partial ?? round(24 + (back % 7) * 1.1, 2);
    const coverage = live?.cov ?? 88 + (back % 4);
    const relays = Object.fromEntries(RELAY_KEYS.map((key) => {
      const stored = RELAYS[back]?.[key];
      if (stored) return [key, { starts: stored[0], run_s: stored[1], repaired_runs: stored[2] }];
      if (RELAYS[back]) return [key, { starts: 0, run_s: 0, repaired_runs: 0 }];
      const perDay = { heat1: [22, 48_000], heat2: [13, 9_800], fan1: [4, 900], fan2: [4, 950], vent: [7, 1_900], fog: [5, 420], mister_center: [1, 180], drip_wall: [1, 600] }[key];
      return [key, perDay ? { starts: perDay[0] + (back % 3), run_s: perDay[1] + (back % 4) * 120, repaired_runs: 0 } : { starts: 0, run_s: 0, repaired_runs: 0 }];
    }));
    const drying = live ? live.drying : [1100 + (back % 6) * 210, 8 + (back % 5), 2 + (back % 3), null, null, null, null];
    return {
      date, complete: back > 0,
      band: {
        both_pct: grade[7], temp_pct: grade[1], vpd_pct: grade[4], both_day_pct: grade[8], both_night_pct: grade[9], temp_below_pct: grade[2],
        temp_above_pct: grade[3], vpd_below_pct: grade[5], vpd_above_pct: grade[6], graded_min: grade[0], night_dryout_min: grade[10], night_dried: grade[11],
        above_full_cooling_min: 0,
      },
      relays,
      climate_starts: CLIMATE_RELAYS.reduce((sum, key) => sum + relays[key].starts, 0),
      climate_run_s: CLIMATE_RELAYS.reduce((sum, key) => sum + relays[key].run_s, 0),
      energy: { kwh: live ? live.kwh : coverage >= 70 ? round(kwhPartial * 100 / coverage, 2) : null, kwh_partial: kwhPartial, coverage_pct: coverage },
      gas: { therms_est: live?.therms ?? round(2.1 + (back % 5) * 0.21, 3) },
      water: live
        ? { total_gal: live.water[0], crop_gal: live.water[1], wetting_gal: live.water[2], house_gal: live.water[3], complete: live.water[4] }
        : { total_gal: 32 + (back % 4), crop_gal: 31 + (back % 4), wetting_gal: 2 + (back % 5), house_gal: 1, complete: true },
      drying: {
        seconds: drying[0], runs: drying[1], furnace_starts_after: drying[2], water_g: drying[3], heat_wh: drying[4], lower_bound: drying[5],
        wanted_s: drying[6]?.wanted_s ?? null, refused_s: drying[6]?.refused_s ?? null,
      },
      counter_sample_pct: live?.sample ?? 98.5,
      alerts: { critical: 0, warning: back % 3 === 0 ? 2 : 1, info: back % 4 },
    };
  });
}

/** The two live reviews (11-16 and 11-15) moved onto the fixture clock, and seven older daily reviews. */
function reviewRows(world) {
  const first = today(world);
  const summary = (date) => `Compliance on ${date}: temperature held its band most of the day; VPD ran below the band overnight. `
    + "Electric heat carried the night with one furnace run before dawn. Drying ran in the evening and was refused mostly because the house was too cold to vent. "
    + "No band edit proposed.";
  const tokens = [[340_590, 14_538], [179_694, 6_098], [172_410, 5_870], [168_200, 6_010], [181_930, 6_240], [175_020, 5_990], [170_880, 5_760], [166_540, 5_810], [169_300, 5_900]];
  return tokens.map(([input, output], index) => {
    const reviewDate = addDays(first, -(index + 1));
    const requested = at(addDays(first, -index), "07:00") + 4 * SECOND;
    const written = requested + (index === 0 ? 3 * MINUTE + 3 * SECOND : 72 * SECOND);
    return {
      id: 9 - index, kind: "daily", review_date: reviewDate, status: "written", requested_at: iso(requested), requested_by: "ingestor", attempts: 1,
      delivered_at: iso(requested + SECOND), run_finished_at: iso(written + (index === 0 ? 57 : 43) * SECOND), written_at: iso(written), failure: null,
      input_tokens: input, output_tokens: output, total_tokens: input + output, summary: summary(reviewDate), proposal: null,
    };
  });
}

/** The base law state: the newest record, its sources and the meter, as of the fixture clock. */
function baseLaw(world) {
  const { now } = world;
  const date = today(world);
  return {
    observedAt: now - 35 * SECOND,
    // The law's first record, four days back: API-32's since_law then holds three complete days.
    firstRecordAt: at(addDays(date, -4), "13:48"),
    // band.write rows from before the activity the fixture lists (API-17): two band edits inside the 30 days before the
    // law, which API-32's baseline leaves out.
    bandEdits: [at(addDays(date, -11), "16:17"), at(addDays(date, -26), "09:40")],
    // The newest record: only the outdoor-air latch on (the live l=128, o=0), drying not wanted, nothing refused.
    latches: ["air"], requests: [], drying: "not_wanted", refused: "none", cost: 0.633, limit: 0.7, limitSource: "default", repaired: false,
    // The controller follows its own curve continuously; the host's band (Now.band) is a few minutes older.
    band: { temp_low_f: 61.2, temp_high_f: 70.0, vpd_low_kpa: 0.45, vpd_high_kpa: 0.8 },
    bandSource: "onchip_curve", outdoorSource: "station", leadFan: "fan1", constantsHash: RELEASE_HASH, constantsAt: now - 6 * HOUR,
    meter: { seconds: 120, water_g: 247, heat_wh: 177, refused_seconds: 22_440, observed_at: iso(now - 35 * SECOND) },
    // One 6-minute outage last night, with no law record: every lane reads unknown over it.
    gaps: [[at(addDays(date, -1), "21:58"), at(addDays(date, -1), "22:04")]],
    sourceSpans: [[at(addDays(date, -1), "17:10"), at(addDays(date, -1), "17:50"), "intake"]],
    repairedSpans: [],
    extra: {},
    extraRefusals: [],
  };
}
function baseSystem(world) {
  const { now } = world;
  const date = today(world);
  const quarter = (boot, qseq, first, rows, transitions, receivedLag) => {
    const start = at(date, first);
    return {
      boot, qseq, first_at: iso(start), last_at: iso(start + (rows - 1) * MINUTE), received_at: iso(start + (rows - 1) * MINUTE + receivedLag * SECOND),
      climate_rows: rows, transition_rows: transitions,
    };
  };
  return {
    health: {
      min_free_kb: 34.6, largest_block_minute_low_kb: 21.8, loop_worst_ms: 11.4, stack_free_min_b: 1848, nvs_used_entries: 1711, nvs_free_entries: 12_023,
      nvs_write_worst_ms: 3.88, wifi_disconnects: 2, api_clients: 2, clock_valid: true, sync_age_s: 691, clock_misses: 0, probes_active: 4,
      probes_degraded: false, probe_health: "OK", pinned: null,
    },
    // gap_replay_quarters as stored on 11-17, moved onto today (live times are UTC; these read as the same local hours less 7).
    replayed: [
      quarter(2, 55, "08:19", 15, 2, 34), quarter(2, 45, "05:49", 15, 2, 65), quarter(2, 41, "04:49", 15, 1, 64), quarter(2, 40, "04:34", 15, 2, 390),
      quarter(2, 39, "04:19", 15, 1, 1290), quarter(2, 38, "04:04", 15, 1, 2190), quarter(2, 33, "02:49", 15, 1, 64), quarter(2, 28, "01:34", 15, 1, 64),
      quarter(2, 20, "00:34", 15, 1, 67), quarter(1, 15, "00:01", 15, 1, 65),
    ],
    // v_data_gaps_unreplayed: host-side outages, newest first.
    outages: [
      [at(date, "04:13") - 131 * SECOND, 131, "ingestor_process_restart", "snapshot_taken"],
      [at(addDays(date, -1), "21:58"), 360, "ingestor_restart", "snapshot_taken"],
      [at(addDays(date, -1), "16:02"), 214, "ingestor_process_restart", "snapshot_taken"],
      [at(addDays(date, -2), "09:41"), 991, "ingestor_restart", "snapshot_incomplete"],
      [at(addDays(date, -4), "11:20"), 188, "ingestor_process_restart", "snapshot_taken"],
      [at(addDays(date, -9), "02:05"), 402, "ingestor_restart", "snapshot_taken"],
      [at(addDays(date, -18), "13:31"), 245, "ingestor_process_restart", "snapshot_taken"],
    ].map(([start, duration, reason, status]) => ({ start: iso(start), end: iso(start + duration * SECOND), duration_s: duration, reason, status })),
    tables: [["climate", 20, 5], ["diagnostics", 45, 5], ["equipment_state", 312, 2], ["setpoint_snapshot", 30, 10], ["energy", 12, 25], ["system_state", 35, 15]]
      .map(([table, age, rows]) => ({ table, last_row_age_s: age, rows_5m: rows })),
    probes: [["climate.temp_north", 20], ["climate.temp_south", 20], ["climate.temp_east", 21], ["climate.temp_west", 20], ["climate.temp_case", 22], ["climate.rh_north", 20]]
      .map(([sensor, age]) => ({ sensor, age_s: age, last_seen_at: null })),
    ingestor: { reconnects: 0, payloads_rejected: 0, replay_failures: 0, rows_rejected: {}, observed_at: iso(now - 25 * SECOND) },
    dispatcherStage: "ordinary",
    readbackPass: { at: iso(now - 4 * MINUTE), stored: 2, of: 102 },
    delivery: {
      byStatus: [["esp32", "observed", 702], ["band", "confirmed", 198], ["plan", "confirmed", 78], ["manual", "confirmed", 12], ["band", "cancelled", 3], ["plan", "superseded", 1]],
      oldestUnconfirmedS: 0, latency: { p50_s: 4.2, p95_s: 31.8, confirmed: 288 }, failing: [],
    },
  };
}

/** The world's law, record, review and system state, built on first use. */
export function lawOf(world) {
  if (!world.law) {
    world.law = baseLaw(world);
    world.record = recordRows(world);
    world.reviews = reviewRows(world);
    world.system = baseSystem(world);
  }
  return world.law;
}

// ---------------------------------------------------------------------------------------------------- shared helpers
const reporting = (world) => lawOf(world).observedAt !== null && world.now - lawOf(world).observedAt <= 120 * SECOND;
const itemState = (world, equipment) => {
  if (equipment === "mister_any") {
    const misters = world.equipment.filter((item) => item.equipment.startsWith("mister_") && !item.equipment.endsWith("_fert"));
    if (misters.some((item) => item.state === "on")) return { state: "on", since: misters.find((item) => item.state === "on").since };
    if (misters.some((item) => item.state === "unknown")) return { state: "unknown", since: null };
    return { state: "off", since: misters.map((item) => item.since).filter(Boolean).sort().at(-1) ?? null };
  }
  const item = world.equipment.find((row) => row.equipment === equipment);
  if (!item) return { state: "unknown", since: null };
  return { state: ["on", "off"].includes(item.state) ? item.state : "unknown", since: item.since ?? null };
};
const hasLatch = (law, bit) => (law.observedAt === null ? null : law.latches.includes(bit));
const hasRequest = (law, bit) => (law.observedAt === null ? null : law.requests.includes(bit));

/** The open daily_review_missed alert, if any. */
const reviewMissed = (world) => world.alerts.some((alert) => alert.alert_type === "daily_review_missed" && alert.status === "open");
function reviewToday(world) {
  lawOf(world);
  const reviewDate = addDays(today(world), -1);
  const newest = world.reviews.find((row) => row.review_date === reviewDate) ?? null;
  const due = world.now >= at(today(world), "07:00");
  const status = newest ? newest.status : due ? "due" : "not_due";
  // Missed from 10:00 only: an alert still open from an earlier day says nothing about this one before then.
  const missed = reviewMissed(world) && status !== "written" && world.now >= at(today(world), "10:00");
  return { review_date: reviewDate, status, missed, expected_after: "07:00", late_after: "10:00" };
}
/** Each review's proposal state: waiting on the newest written review with a proposal, superseded on older ones. */
function proposalState(world, review) {
  if (!review.proposal) return null;
  if (review.proposalAnswered) return "answered";
  const newerWritten = world.reviews.some((row) => row.status === "written" && row.written_at && review.written_at && row.written_at > review.written_at);
  return newerWritten ? "superseded" : "waiting";
}
const reviewBody = (world, review) => {
  const { proposalAnswered, ...row } = review;
  void proposalAnswered;
  return { ...row, proposal_state: proposalState(world, review) };
};
function waitingProposal(world) {
  const review = world.reviews.find((row) => row.status === "written" && proposalState(world, row) === "waiting");
  return review ? { review_id: review.id, review_date: review.review_date } : null;
}

// ---------------------------------------------------------------------------------------------------- Now's additions
/** API-02's law (fresh records only), review and outdoor source. */
export function nowAdditions(world) {
  const law = lawOf(world);
  const fresh = reporting(world);
  const newestWritten = world.reviews.find((row) => row.status === "written") ?? null;
  return {
    law: fresh ? {
      observed_at: iso(law.observedAt), latches: [...law.latches], requests: [...law.requests], drying: law.drying,
      drying_refused_reason: law.refused === "none" ? null : law.refused, drying_cost_kwh_per_kg: law.cost, drying_cost_limit_kwh_per_kg: law.limit,
      band_repaired: law.repaired, band: { ...law.band },
    } : null,
    review: { ...pick(reviewToday(world), ["review_date", "status", "missed"]), written_at: newestWritten?.written_at ?? null, proposal_waiting: waitingProposal(world) !== null },
    outdoorSource: law.outdoorSource,
  };
}
const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key]]));

// ---------------------------------------------------------------------------------------------------- API-30
/** The relays a rule drives, as verdify_services/law.py rule_relays(): the lead fan for one fan, both while it is not known. */
function ruleRelays(id, lead) {
  const other = { fan1: "fan2", fan2: "fan1" }[lead ?? ""];
  const leads = other ? [lead] : ["fan1", "fan2"];
  return {
    heat1: ["heat1"], heat2: ["heat2"], cooling: ["vent", ...leads], second_fan: other ? [other] : ["fan1", "fan2"], fog: ["fog"], mist: ["mister_any"],
    drying: ["vent", ...leads], hot_limit: ["vent", "fan1", "fan2"], cold_limit: ["heat1", "heat2"],
  }[id];
}
const RULES = [
  ["heat1", "temp", "below", "h1", "heat1", (band) => [band.temp_low_f + LAW.heat1[0], band.temp_low_f + LAW.heat1[1]]],
  ["heat2", "temp", "below", "h2", "heat2", (band) => [band.temp_low_f + LAW.heat2[0], band.temp_low_f + LAW.heat2[1]]],
  ["cooling", "temp", "above", "cool", "cooling", (band) => [band.temp_high_f + LAW.cool[0], band.temp_high_f - LAW.cool[1]]],
  ["second_fan", "temp", "above", "cool2", "fan2", (band) => [band.temp_high_f + LAW.fan2[0], band.temp_high_f + LAW.fan2[1]]],
  ["fog", "vpd", "above", "wet", "fog", (band) => [band.vpd_high_kpa + LAW.fog[0], band.vpd_high_kpa - LAW.fog[1]]],
  ["mist", "vpd", "above", "mist", "mist", (band) => [band.vpd_high_kpa + LAW.mist[0], band.vpd_high_kpa + LAW.mist[1]]],
  ["drying", "vpd", "below", "dry", "drying", (band) => [band.vpd_low_kpa + LAW.dry[0], band.vpd_low_kpa + LAW.dry[1]]],
  ["hot_limit", "temp", "above", null, "hot", () => [LAW.hot_f, LAW.hot_f]],
  ["cold_limit", "temp", "below", null, "cold", () => [LAW.cold_f, LAW.cold_f]],
];
/** Each relay's minimum on and off time; the misters have none here. */
const MIN_TIMES = {
  heat1: [TIMING.relay_min_on_s, TIMING.relay_min_off_s], heat2: [TIMING.relay_min_on_s, TIMING.relay_min_off_s],
  fan1: [TIMING.relay_min_on_s, TIMING.relay_min_off_s], fan2: [TIMING.relay_min_on_s, TIMING.relay_min_off_s],
  vent: [TIMING.relay_min_on_s, TIMING.relay_min_off_s], fog: [TIMING.fog_min_on_s, TIMING.fog_min_off_s],
};
/** The relays a manual run holds (verdify_services/law.py MANUAL_RUN_RELAYS), by Now's override kind. */
const MANUAL_RUN = { fans: ["fan1", "fan2", "vent", "heat1", "heat2"], vent_bypass: ["fan1", "fan2", "vent", "heat1", "heat2"], humidify: ["fog"] };
const manualHeld = (world) => new Set((world.overrides ?? []).flatMap((run) => MANUAL_RUN[run.kind] ?? []));
const REQUEST_OF = { heat1: "heat1", heat2: "heat2", vent: "vent", fog: "fog", mister_any: "mist" };
/** Whether the law's request asks for this relay: the lead fan for one fan, both for two; null while the lead is not known. */
function relayWanted(law, relay) {
  if (relay === "fan1" || relay === "fan2") {
    const one = hasRequest(law, "fan1");
    const two = hasRequest(law, "fan2");
    if (two || !one) return two;
    return law.leadFan ? relay === law.leadFan : null;
  }
  return hasRequest(law, REQUEST_OF[relay]);
}
/**
 * The longest hold the host can prove over a rule's relays (verdify_services/law.py rule_hold()): requested with a wanted
 * relay off inside its minimum off time, or not requested with an unwanted relay on inside its minimum on time. Never at
 * the limits (but the fogger), never on a relay a manual run holds, the fogger off only while the controller names its
 * minimum off time, the fogger on only at a limit. The fixture's controller booted long before any of its switches.
 */
function holdOf(world, law, id, requested, states) {
  if (requested === null || id === "hot_limit" || id === "cold_limit") return null;
  const atLimit = hasRequest(law, "hot") || hasRequest(law, "cold");
  const held = manualHeld(world);
  let best = null;
  for (const { equipment, state, since } of states) {
    const times = MIN_TIMES[equipment];
    if (!times || state === "unknown" || since === null || held.has(equipment) || (atLimit && equipment !== "fog")) continue;
    const [minOn, minOff] = times;
    const wanted = relayWanted(law, equipment);
    const elapsed = Math.floor((world.now - Date.parse(since)) / SECOND);
    let hold = null;
    if (requested && wanted === true && state === "off") {
      if (equipment === "fog" && world.reasons?.fog_block_reason?.code !== "relay_min_off") continue;
      if (elapsed < minOff) hold = { kind: "min_off", remaining_s: minOff - elapsed };
    } else if (!requested && wanted === false && state === "on" && (equipment !== "fog" || atLimit) && elapsed < minOn) {
      hold = { kind: "min_on", remaining_s: minOn - elapsed };
    }
    if (hold && (!best || hold.remaining_s > best.remaining_s)) best = hold;
  }
  return best;
}
/** The drying checks in the order the law refuses (verdify_services/law.py drying_checks()); all null without a fresh record. */
function dryingChecks(law, fresh, temp, minTemp) {
  const ids = ["humid", "not_cooling", "furnace_off", "outdoor_drier", "warm_enough", "worth_it"];
  if (!fresh || law.refused === "no_temperature") return ids.map((id) => ({ id, ok: null }));
  const running = hasLatch(law, "run");
  // law.cost is null with no price; costIsNone marks the no-price value (too small a moisture difference).
  const noPrice = law.cost === null && !law.costIsNone;
  const ok = {
    humid: law.refused === "humidity_invalid" ? null : hasLatch(law, "dry"),
    not_cooling: !(hasLatch(law, "cool") || hasRequest(law, "hot")),
    furnace_off: !hasLatch(law, "h2"),
    outdoor_drier: running ? true : noPrice ? null : hasLatch(law, "air") && !law.costIsNone,
    warm_enough: running || law.refused === "cost" ? true : law.refused === "too_cold" ? false : temp === null ? null : temp >= minTemp,
    worth_it: running ? true : noPrice ? null : !law.costIsNone && law.cost <= law.limit,
  };
  return ids.map((id) => ({ id, ok: ok[id] }));
}
function lawBody(world) {
  const law = lawOf(world);
  const band = law.band;
  const temp = world.indoor.temp_f.value;
  const rh = world.indoor.rh_pct.value;
  // The law reads the station or the intake; with no outdoor source it has no outdoor reading.
  const outdoorKnown = law.outdoorSource === "station" || law.outdoorSource === "intake";
  const outdoorTemp = outdoorKnown ? world.outdoor.temp_f.value : null;
  const outdoorRh = outdoorKnown ? world.outdoor.rh_pct.value : null;
  const fresh = reporting(world);
  const rules = RULES.map(([id, signal, direction, latch, request, thresholds]) => {
    const [on, off] = thresholds(band);
    const requested = hasRequest(law, request);
    const states = ruleRelays(id, law.leadFan).map((equipment) => ({ equipment, ...itemState(world, equipment) }));
    return {
      id, signal, direction, on_at: round(on, signal === "vpd" ? 2 : 1), off_at: round(off, signal === "vpd" ? 2 : 1),
      latched: latch ? hasLatch(law, latch) : requested, requested, relays: states,
      hold: fresh ? holdOf(world, law, id, requested, states) : null,
    };
  });
  const record = world.record[0];
  const known = law.observedAt !== null;
  const wanted = hasLatch(law, "dry");
  const drier = hasLatch(law, "air");
  const minTemp = round(band.temp_low_f + LAW.dry_start_above_low_f, 1);
  const host = world.band ? {
    temp_low_f: world.band.temp_f.low, temp_high_f: world.band.temp_f.high, vpd_low_kpa: world.band.vpd_kpa.low, vpd_high_kpa: world.band.vpd_kpa.high,
  } : null;
  const differs = host && Object.values(host).every((value) => value !== null)
    ? Math.abs(host.temp_low_f - band.temp_low_f) > 1.0 || Math.abs(host.temp_high_f - band.temp_high_f) > 1.0
      || Math.abs(host.vpd_low_kpa - band.vpd_low_kpa) > 0.1 || Math.abs(host.vpd_high_kpa - band.vpd_high_kpa) > 0.1
    : null;
  const heartbeat = world.freshness.ingestor;
  return {
    server_time: iso(world.now), observed_at: known ? iso(law.observedAt) : null, reporting: reporting(world),
    band: { ...band, repaired: known ? law.repaired : null, source: law.bandSource, host, differs },
    inputs: {
      temp_f: temp, vpd_kpa: world.indoor.vpd_kpa.value, rh_pct: rh, dew_point_f: dewPoint(temp, rh),
      outdoor: { source: law.outdoorSource, temp_f: outdoorTemp, rh_pct: outdoorRh, dew_point_f: outdoorDewPoint(outdoorTemp, outdoorRh) },
      observed_at: world.indoor.temp_f.observed_at,
    },
    rules,
    drying: {
      state: known ? law.drying : "unknown", wanted, outdoor_drier: drier, refused_reason: known ? law.refused : null,
      cost_kwh_per_kg: law.cost, limit_kwh_per_kg: known ? law.limit : null, limit_source: law.limitSource,
      wanted_below_kpa: round(band.vpd_low_kpa + LAW.dry[0], 2), stop_above_kpa: round(band.vpd_low_kpa + LAW.dry[1], 2), min_temp_f: minTemp,
      checks: dryingChecks(law, fresh, temp, minTemp),
      meter: { ...law.meter },
      today: record?.drying ? {
        seconds: record.drying.seconds, runs: record.drying.runs, water_g: record.drying.water_g, heat_wh: record.drying.heat_wh, lower_bound: record.drying.lower_bound,
      } : null,
    },
    timing: { ...TIMING },
    lead_fan: law.leadFan,
    alone: {
      clock: { valid: world.system.health.clock_valid, sync_age_s: world.system.health.sync_age_s },
      probes: { active: world.system.health.probes_active, degraded: world.system.health.probes_degraded },
      host: { connected: !heartbeat.stale, heartbeat_age_s: heartbeat.age_s },
      gap_log: world.controller.gap_log ?? null,
    },
    constants: {
      hash: law.constantsHash, release_hash: RELEASE_HASH, matches: law.constantsHash === null ? null : law.constantsHash === RELEASE_HASH,
      observed_at: law.constantsHash === null ? null : iso(law.constantsAt),
    },
  };
}

// ---------------------------------------------------------------------------------------------------- API-31
/** Where the law's records end: now while it reports, else a minute after the newest record. */
const recordsEnd = (world) => (reporting(world) ? world.now : (lawOf(world).observedAt ?? lawOf(world).firstRecordAt) + MINUTE);
/**
 * The lanes' states for one answer: `(key, t)` is unknown before the first record, after the last, or inside an
 * outage; else on or off. A state needs the local date of its instant and that day's spans as instants, and both are
 * time-zone conversions. One answer asks for the same instants for every lane and the same days for every instant
 * (some 100,000 conversions for a day's window, most of a second on a CI runner), so each is worked out once here.
 */
function laneReader(world) {
  const law = lawOf(world);
  const end = recordsEnd(world);
  const dates = new Map();
  const spans = new Map();
  const dateOf = (t) => {
    let date = dates.get(t);
    if (date === undefined) { date = local(t).date; dates.set(t, date); }
    return date;
  };
  const spansOf = (key, date) => {
    const id = `${key} ${date}`;
    let found = spans.get(id);
    if (found === undefined) { found = spansOn(date, PATTERN[key] ?? []); spans.set(id, found); }
    return found;
  };
  return (key, t) => {
    if (law.firstRecordAt === null || t < law.firstRecordAt || t >= end || law.gaps.some(([start, stop]) => t >= start && t < stop)) return "unknown";
    if ((law.extra[key] ?? []).some(([start, stop]) => t >= start && t < stop)) return "on";
    return spansOf(key, dateOf(t)).some(([start, stop]) => t >= start && t < stop) ? "on" : "off";
  };
}
const BUCKETS = [60, 300, 900, 3600, 10_800, 86_400];
/** Every edge between `from` and `to` that a lane, drying or the outdoor source can change at. */
function edges(world, from, to) {
  const law = lawOf(world);
  const points = new Set([from, to, law.firstRecordAt, recordsEnd(world), world.now]);
  for (let date = addDays(local(from).date, -1); date <= local(to).date; date = addDays(date, 1)) {
    for (const spans of Object.values(PATTERN)) for (const [start, end] of spansOn(date, spans)) { points.add(start); points.add(end); }
    for (const [start, end] of spansOn(date, REFUSALS.map(([s, e]) => [s, e]))) { points.add(start); points.add(end); }
  }
  for (const [start, end] of [...law.gaps, ...Object.values(law.extra).flat(), ...law.extraRefusals, ...law.sourceSpans, ...law.repairedSpans]) { points.add(start); points.add(end); }
  return [...points].filter((point) => point !== null && point >= from && point <= to).sort((a, b) => a - b);
}
/** Change intervals of `stateAt` over the edges, merged where equal. */
function intervalsOf(points, stateAt) {
  const out = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const [start, end] = [points[index], points[index + 1]];
    if (end <= start) continue;
    const state = stateAt((start + end) / 2);
    const last = out.at(-1);
    if (last && JSON.stringify(last.state) === JSON.stringify(state) && last.end === start) last.end = end;
    else out.push({ start, end, state });
  }
  return out;
}
function refusalAt(world, t) {
  const law = lawOf(world);
  const extra = law.extraRefusals.find(([start, end]) => t >= start && t < end);
  if (extra) return extra[2];
  const date = local(t).date;
  return REFUSALS.find(([start, end]) => t >= at(date, start) && t < at(date, end))?.[2] ?? "cost";
}
function lawHistoryBody(world, { query }) {
  const law = lawOf(world);
  const from = Date.parse(query.get("from") ?? "");
  const to = Date.parse(query.get("to") ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw refuse(400, "invalid_request", "from and to must be date-times, to after from");
  if (to - from > 31 * DAY) throw refuse(422, "window_too_large", "The window is at most 31 days");
  const stateOf = laneReader(world);
  const points = edges(world, from, to);
  const lanes = LANE_KEYS.map((key) => ({
    key, group: key.split(".")[0],
    intervals: intervalsOf(points, (t) => stateOf(key, t)).map(({ start, end, state }) => ({ start: iso(start), end: iso(end), state })),
  }));
  const drying = intervalsOf(points, (t) => {
    const run = stateOf("latch.run", t);
    if (run === "unknown") return { state: "unknown", reason: null };
    if (run === "on") return { state: "running", reason: null };
    if (stateOf("latch.dry", t) === "on") return { state: "refused", reason: refusalAt(world, t) };
    return { state: "not_wanted", reason: null };
  }).map(({ start, end, state }) => ({ start: iso(start), end: iso(end), ...state }));
  const outdoor = intervalsOf(points, (t) => (stateOf("latch.air", t) === "unknown" ? "unknown"
    : law.sourceSpans.find(([start, end]) => t >= start && t < end)?.[2] ?? law.outdoorSource)).map(({ start, end, state }) => ({ start: iso(start), end: iso(end), source: state }));
  const repaired = law.repairedSpans.filter(([start, end]) => end > from && start < to).map(([start, end]) => ({ start: iso(Math.max(start, from)), end: iso(Math.min(end, to)) }));
  const bucket = BUCKETS.find((size) => (to - from) / (size * SECOND) <= 1500) ?? 86_400;
  const t = [];
  for (let start = Math.floor(from / (bucket * SECOND)) * bucket; start * SECOND < to; start += bucket) t.push(start);
  // The outdoor-air latch at each bucket's start, read once: a bucket has values only where a record covers it.
  const air = t.map((start) => stateOf("latch.air", start * SECOND));
  const swing = (start) => (Math.cos((2 * Math.PI * (start * SECOND - world.now)) / DAY) - 1) / 2;
  const where = (value) => t.map((start, index) => (air[index] === "unknown" ? null : value(start)));
  return {
    from: iso(from), to: iso(to), first_record_at: law.firstRecordAt === null ? null : iso(law.firstRecordAt), lanes, drying, outdoor_source: outdoor, band_repaired: repaired,
    cost: {
      bucket_s: bucket, t,
      cost_kwh_per_kg: t.map((start, index) => (air[index] === "on" ? round((law.cost ?? 0.633) + 0.12 * swing(start), 3) : null)),
      limit_kwh_per_kg: where(() => law.limit),
    },
    band: {
      bucket_s: bucket, t,
      temp_low_f: where((start) => round(law.band.temp_low_f + 4 * swing(start), 1)),
      temp_high_f: where((start) => round(law.band.temp_high_f + 6 * swing(start), 1)),
      vpd_low_kpa: where((start) => round(law.band.vpd_low_kpa + 0.05 * swing(start), 2)),
      vpd_high_kpa: where((start) => round(law.band.vpd_high_kpa + 0.08 * swing(start), 2)),
    },
  };
}

// ---------------------------------------------------------------------------------------------------- API-32, API-33
const DATE = /^\d{4}-\d\d-\d\d$/;
const mean = (values) => {
  const known = values.filter((value) => value !== null && value !== undefined);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
};
function meansOf(days) {
  const complete = days.filter((day) => day.complete);
  if (!complete.length) return null;
  const hours = (pick) => round(mean(complete.map(pick)), 2);
  return {
    days: complete.length,
    both_pct: round(mean(complete.map((day) => day.band?.both_pct)), 1),
    temp_pct: round(mean(complete.map((day) => day.band?.temp_pct)), 1),
    vpd_pct: round(mean(complete.map((day) => day.band?.vpd_pct)), 1),
    nights_dried: complete.some((day) => day.band) ? complete.filter((day) => day.band?.night_dried).length : null,
    climate_starts: round(mean(complete.map((day) => day.climate_starts)), 1),
    climate_run_h: hours((day) => (day.climate_run_s === null ? null : day.climate_run_s / 3600)),
    heat1_run_h: hours((day) => (day.relays ? day.relays.heat1.run_s / 3600 : null)),
    heat2_run_h: hours((day) => (day.relays ? day.relays.heat2.run_s / 3600 : null)),
    kwh: round(mean(complete.map((day) => day.energy.kwh)), 2),
    therms_est: round(mean(complete.map((day) => day.gas.therms_est)), 3),
    crop_gal: round(mean(complete.map((day) => day.water.crop_gal)), 1),
    drying_h: hours((day) => (day.drying?.seconds === null || day.drying?.seconds === undefined ? null : day.drying.seconds / 3600)),
  };
}
const emptyDay = (date) => ({
  date, complete: false, band: null, relays: null, climate_starts: null, climate_run_s: null, energy: { kwh: null, kwh_partial: null, coverage_pct: null },
  gas: { therms_est: null }, water: { total_gal: null, crop_gal: null, wetting_gal: null, house_gal: null, complete: null }, drying: null, counter_sample_pct: null,
  alerts: null,
});
function recordBody(world, { query }) {
  lawOf(world);
  const last = query.get("to") ?? today(world);
  const first = query.get("from") ?? addDays(last, -29);
  if (!DATE.test(first) || !DATE.test(last) || first > last) throw refuse(400, "invalid_request", "from and to must be dates, from not after to");
  const span = Math.round((Date.parse(`${last}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / DAY) + 1;
  if (span > 400) throw refuse(422, "window_too_large", "At most 400 days");
  const byDate = new Map(world.record.map((row) => [row.date, row]));
  const days = Array.from({ length: span }, (_, index) => addDays(first, index)).map((date) => structuredClone(byDate.get(date) ?? emptyDay(date)));
  const window = (count) => world.record.filter((row) => row.complete && row.date <= today(world)).slice(0, count);
  return {
    from: first, to: last, days, means: { d7: meansOf(window(7)), d30: meansOf(window(30)) }, ...lawPeriods(world), server_time: iso(world.now),
  };
}
const EMPTY_MEANS = {
  days: 0, both_pct: null, temp_pct: null, vpd_pct: null, nights_dried: null, climate_starts: null, climate_run_h: null, heat1_run_h: null,
  heat2_run_h: null, kwh: null, therms_est: null, crop_gal: null, drying_h: null,
};
/**
 * API-32's law day and its two periods (verdify_services/record.py): the 30 days before the law and the days since it
 * through yesterday, each leaving out the days with a band edit. since_law is null until one of its days is complete.
 */
function lawPeriods(world) {
  const law = lawOf(world);
  const started = law.firstRecordAt === null ? null : local(law.firstRecordAt).date;
  if (started === null) return { law_started: null, baseline: null, since_law: null };
  const writes = [...law.bandEdits, ...(world.activity ?? []).filter((row) => row.action === "band.write").map((row) => Date.parse(row.ts))];
  const edits = new Set(writes.map((ts) => local(ts).date));
  const period = (from, to) => {
    const left = [...edits].filter((date) => date >= from && date <= to);
    const days = world.record.filter((row) => row.date >= from && row.date <= to && !left.includes(row.date));
    return { from, to, excluded_days: left.length, means: meansOf(days) ?? { ...EMPTY_MEANS } };
  };
  const [sinceFrom, sinceTo] = [addDays(started, 1), addDays(today(world), -1)];
  const sinceComplete = world.record.some((row) => row.complete && row.date >= sinceFrom && row.date <= sinceTo);
  return {
    law_started: started,
    baseline: period(addDays(started, -30), addDays(started, -1)),
    since_law: sinceComplete ? period(sinceFrom, sinceTo) : null,
  };
}
function relayCheckBody(world, { query }) {
  lawOf(world);
  const count = Number(query.get("days") ?? 7);
  if (![7, 14, 30].includes(count)) throw refuse(400, "invalid_request", "days is 7, 14 or 30");
  // The controller's counters began three days ago: earlier days have no rows in the view.
  const comparisons = world.relayCheckComparisons ?? ["partial", "complete", "complete", "partial"];
  return {
    days: comparisons.slice(0, count).map((comparison, back) => {
      const row = world.record[back];
      return {
        date: row.date, comparison, boots: back === 0 ? 2 : back === 3 ? 1 : 0,
        relays: CLIMATE_RELAYS.map((equipment) => {
          const record = comparison === "no_record" ? null : row.relays[equipment];
          const counterStarts = comparison === "partial" && back > 0 ? Math.max(0, record.starts - 3) : record ? record.starts : row.relays[equipment].starts;
          const fan = equipment.startsWith("fan");
          const counterRun = fan ? (record ? record.run_s - (comparison === "partial" && back > 0 ? 300 : 0) : row.relays[equipment].run_s) : null;
          return {
            equipment, counter_starts: counterStarts, record_starts: record ? record.starts : null,
            starts_difference: record ? counterStarts - record.starts : null, counter_run_s: counterRun, record_run_s: record ? record.run_s : null,
            run_s_difference: fan && record ? counterRun - record.run_s : null,
          };
        }),
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------- API-34
function reviewsBody(world, { query }) {
  lawOf(world);
  const limit = Number(query.get("limit") ?? 30);
  if (!Number.isInteger(limit) || limit < 1 || limit > 60) throw refuse(400, "invalid_request", "limit is 1 to 60");
  const cursor = query.get("cursor");
  const start = cursor === null ? 0 : Number(cursor);
  if (!Number.isInteger(start) || start < 0) throw refuse(400, "invalid_request", "cursor is not one this API gave");
  const rows = world.reviews;
  return {
    next_cursor: start + limit < rows.length ? String(start + limit) : null,
    items: rows.slice(start, start + limit).map((row) => reviewBody(world, row)),
    today: reviewToday(world),
    tokens: tokenUse(rows.map((row) => row.total_tokens).filter((value) => value !== null)),
    days: tokenDays(world, rows),
    proposal_waiting: waitingProposal(world),
  };
}
/**
 * verdify_services/reviews.py _TOKEN_DAYS_SQL (#1661): every finished review's tokens on the America/Denver day its run
 * finished, over the last 30 days, oldest first.
 */
function tokenDays(world, rows) {
  const since = addDays(local(world.now).date, -29);
  const byDay = new Map();
  for (const row of rows) {
    if (row.total_tokens === null || row.run_finished_at === null) continue;
    const day = local(Date.parse(row.run_finished_at)).date;
    if (day < since) continue;
    const sum = byDay.get(day) ?? { day, reviews: 0, input_tokens: null, output_tokens: null, total_tokens: 0 };
    sum.reviews += 1;
    if (row.input_tokens !== null) sum.input_tokens = (sum.input_tokens ?? 0) + row.input_tokens;
    if (row.output_tokens !== null) sum.output_tokens = (sum.output_tokens ?? 0) + row.output_tokens;
    sum.total_tokens += row.total_tokens;
    byDay.set(day, sum);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}
/**
 * verdify_services/reviews.py token_use(): the finished reviews' totals, newest first; the newest against the mean of
 * the 7 and the 30 before it (or of as many as there are, counted in count_7 and count_30).
 */
function tokenUse(totals) {
  if (!totals.length) return { last: null, mean_7: null, mean_30: null, rise_pct: null, count_7: 0, count_30: 0 };
  const [last, ...before] = totals;
  const [seven, thirty] = [before.slice(0, 7), before.slice(0, 30)];
  const mean7 = round(mean(seven), 1);
  return {
    last, mean_7: mean7, mean_30: round(mean(thirty), 1), rise_pct: mean7 ? round((100 * (last - mean7)) / mean7, 1) : null,
    count_7: seven.length, count_30: thirty.length,
  };
}

// ---------------------------------------------------------------------------------------------------- API-35 to API-37
function controllerBody(world) {
  lawOf(world);
  const { controller } = world;
  const health = world.system.health;
  const fresh = controller.observed_at !== null;
  const value = (v) => (fresh ? v : null);
  const uptime = controller.uptime_s;
  return {
    observed_at: controller.observed_at,
    firmware: { version: controller.firmware_version, pinned: health.pinned, matches: health.pinned === null || controller.firmware_version === null ? null : health.pinned === controller.firmware_version },
    uptime_s: uptime,
    restarts: { count: controller.restart_count ?? null, reset_reason: controller.reset_reason, booted_at: uptime === null ? null : iso(world.now - 45 * SECOND - uptime * SECOND) },
    heap: {
      free_kb: controller.heap_free_kb, min_free_kb: value(health.min_free_kb), largest_block_kb: controller.heap_largest_block_kb,
      minute_low_kb: controller.heap_minute_low_kb ?? null, largest_block_minute_low_kb: value(health.largest_block_minute_low_kb),
    },
    loop: { worst_ms: value(health.loop_worst_ms), stack_free_min_b: value(health.stack_free_min_b) },
    nvs: { used_entries: value(health.nvs_used_entries), free_entries: value(health.nvs_free_entries), write_worst_ms: value(health.nvs_write_worst_ms) },
    wifi: { rssi_dbm: controller.rssi_dbm, disconnects: value(health.wifi_disconnects), api_clients: value(health.api_clients) },
    clock: { valid: value(health.clock_valid), sync_age_s: value(health.sync_age_s), misses: value(health.clock_misses) },
    probes: { active: value(health.probes_active), degraded: value(health.probes_degraded), health: value(health.probe_health) },
    band_source: lawOf(world).bandSource, gap_log: controller.gap_log ?? null,
    limits: { ...LIMITS },
  };
}
function continuityBody(world, { query }) {
  lawOf(world);
  const days = Number(query.get("days") ?? 1);
  if (![1, 7, 30].includes(days)) throw refuse(400, "invalid_request", "days is 1, 7 or 30");
  const from = world.now - days * DAY;
  const { system } = world;
  const outages = system.outages.filter((row) => Date.parse(row.end) > from).slice(0, 200);
  const replayed = system.replayed.filter((row) => Date.parse(row.last_at) >= from).slice(0, 200);
  const dates = Array.from({ length: days + 1 }, (_, index) => addDays(local(from).date, index)).filter((date) => date <= today(world));
  return {
    from: iso(from), to: iso(world.now), gap_log: world.controller.gap_log ?? null, outages, replayed,
    by_day: dates.map((date) => ({
      date,
      outage_s: outages.filter((row) => local(Date.parse(row.start)).date === date).reduce((sum, row) => sum + row.duration_s, 0),
      replayed_min: replayed.filter((row) => local(Date.parse(row.first_at)).date === date).reduce((sum, row) => sum + row.climate_rows, 0),
    })),
    tables: structuredClone(system.tables),
    probes: structuredClone(system.probes),
    ingestor: { heartbeat_age_s: world.freshness.ingestor.age_s, ...structuredClone(system.ingestor) },
  };
}
function deliveryBody(world, { query }) {
  lawOf(world);
  const hours = Number(query.get("hours") ?? 24);
  if (![24, 168].includes(hours)) throw refuse(400, "invalid_request", "hours is 24 or 168");
  const { delivery } = world.system;
  const scale = hours / 24;
  return {
    from: iso(world.now - hours * HOUR), to: iso(world.now),
    by_status: delivery.byStatus.map(([source, status, count]) => ({ source, status, count: Math.round(count * scale) })),
    oldest_unconfirmed_s: delivery.oldestUnconfirmedS,
    latency: { ...delivery.latency, confirmed: Math.round(delivery.latency.confirmed * scale) },
    failing: delivery.failing.map((row) => ({ ...row, label: settingOf(world, row.param)?.label ?? row.param, failed: Math.round(row.failed * scale) })),
    dispatcher_stage: world.system.dispatcherStage,
    readback_pass: { ...world.system.readbackPass },
  };
}

/** The reads, by operationId. A thrown `LawRefusal` is a problem answer. */
export const LAW_READS = {
  "API-30": lawBody, "API-31": lawHistoryBody, "API-32": recordBody, "API-33": relayCheckBody, "API-34": reviewsBody, "API-35": controllerBody,
  "API-36": continuityBody, "API-37": deliveryBody,
};

// ---------------------------------------------------------------------------------------------------- named fixtures
const turnOn = (world, equipment, since) => {
  const item = world.equipment.find((row) => row.equipment === equipment);
  Object.assign(item, { state: "on", since: iso(since), observed_at: iso(since), cycles_today: (item.cycles_today ?? 0) + 1 });
};
const missedAlert = (world, details) => openAlert(world, {
  id: 310, alert_type: "daily_review_missed", category: "system", severity: "warning",
  message: `The daily review of ${addDays(today(world), -1)} was not written by 10:00`,
  details: { review_date: addDays(today(world), -1), ...details }, first_seen_at: iso(at(today(world), "10:00")),
});

/**
 * Named fixtures (registered by index.mjs). Each builds the base state first, so it can change it.
 * @type {Readonly<Record<string, (world: any) => void>>}
 */
export const FIXTURES = {
  // Drying runs now: the house is humid (VPD under 0.50 kPa), outdoor air is drier and the price is under the limit,
  // so the vent and the lead fan run (the record l=448: dry, air and run latches; vent, fan and drying requests).
  "law-drying-running": (world) => {
    const law = lawOf(world);
    const start = world.now - 6 * MINUTE;
    Object.assign(world.indoor.vpd_kpa, { value: 0.47 });
    Object.assign(world.indoor.rh_pct, { value: 76.0 });
    Object.assign(law, { latches: ["dry", "air", "run"], requests: ["vent", "fan1", "drying"], drying: "running", refused: "none", cost: 0.52 });
    law.meter = { ...law.meter, seconds: 480, water_g: 610, heat_wh: 402 };
    law.extra = { "request.vent": [[start, world.now + HOUR]], "request.fan1": [[start, world.now + HOUR]], "request.drying": [[start, world.now + HOUR]], "latch.dry": [[start - 14 * MINUTE, world.now + HOUR]], "latch.run": [[start, world.now + HOUR]] };
    turnOn(world, "vent", start);
    turnOn(world, "fan1", start + 20 * SECOND);
  },
  // Drying is wanted and refused for its price: 0.82 kWh/kg against the 0.70 limit (the spec's sample record, l=193:
  // h1, dry and air latched, electric heat requested and running for 4 min).
  "law-drying-refused-cost": (world) => {
    const law = lawOf(world);
    const start = world.now - 4 * MINUTE;
    Object.assign(world.indoor.temp_f, { value: 64.2 });
    Object.assign(world.indoor.vpd_kpa, { value: 0.47 });
    Object.assign(world.indoor.rh_pct, { value: 76.0 });
    Object.assign(law, { latches: ["h1", "dry", "air"], requests: ["heat1"], drying: "refused", refused: "cost", cost: 0.82 });
    law.extra = { "request.heat1": [[start, world.now + HOUR]], "latch.h1": [[start, world.now + HOUR]], "latch.dry": [[start - 20 * MINUTE, world.now + HOUR]] };
    law.extraRefusals = [[start - 20 * MINUTE, world.now + HOUR, "cost"]];
    turnOn(world, "heat1", start);
  },
  // The hot limit: the house reads 101.2 °F, past the fixed 100 °F, so the law asks for the hot rule and the vent and
  // both fans run (Now's controller sentence names the limit; Climate's ladder draws the reading in its end zone).
  "law-hot-limit": (world) => {
    const law = lawOf(world);
    const start = world.now - 3 * MINUTE;
    Object.assign(world.indoor.temp_f, { value: 101.2 });
    Object.assign(law, { latches: [], requests: ["hot"], drying: "not_wanted", refused: "none" });
    law.extra = { "request.hot": [[start, world.now + HOUR]] };
    turnOn(world, "vent", start);
    turnOn(world, "fan1", start + 10 * SECOND);
    turnOn(world, "fan2", start + 20 * SECOND);
  },
  // No indoor temperature: the reading is null with its reason and drying is refused because the temperature cannot be
  // read, so Run by hand says a fan run stops after 15 minutes.
  "law-no-temperature": (world) => {
    const law = lawOf(world);
    world.indoor.temp_f = { value: null, observed_at: null, reason: "No indoor temperature" };
    Object.assign(law, { latches: ["dry"], requests: [], drying: "refused", refused: "no_temperature" });
  },
  // No law record for 9 minutes while the controller is connected: Now carries no law, Climate shows the newest
  // record as old, and the law_state_stale alert is open.
  "law-not-reporting": (world) => {
    const law = lawOf(world);
    law.observedAt = world.now - 9 * MINUTE;
    law.meter = { ...law.meter, observed_at: iso(law.observedAt) };
    openAlert(world, {
      id: 311, alert_type: "law_state_stale", category: "system", severity: "warning", message: "The controller's climate law has not reported for 9 minutes",
      details: { age_s: 540, uptime_s: world.controller.uptime_s ?? 0 }, first_seen_at: iso(world.now - 7 * MINUTE),
    });
  },
  // The controller's band check changed the band it received (br=1): its high edge sits at the minimum width over the
  // low edge, so the band in use differs from the host's.
  "law-band-repaired": (world) => {
    const law = lawOf(world);
    law.repaired = true;
    law.band = { ...law.band, temp_low_f: 61.2, temp_high_f: 67.7 };
    law.repairedSpans = [[world.now - 47 * MINUTE, world.now]];
  },
  // Today's review of yesterday was never written: nothing was requested, it is past 10:00 and the alert is open.
  "review-missed": (world) => {
    lawOf(world);
    world.reviews = world.reviews.slice(1);
    missedAlert(world, { status: null, attempts: 0, failure: null });
  },
  // Today's review failed: three attempts, the reviewer could not be reached, and the alert is open.
  "review-failed": (world) => {
    lawOf(world);
    const [newest] = world.reviews;
    Object.assign(newest, {
      status: "failed", attempts: 3, delivered_at: null, run_finished_at: null, written_at: null, failure: "gateway_unreachable", input_tokens: null,
      output_tokens: null, total_tokens: null, summary: null,
    });
    missedAlert(world, { status: "failed", attempts: 3, failure: "gateway_unreachable" });
  },
  // Today's review proposes a band edit the owner has not answered (the live 11-16 proposal, which the review tool
  // refused at the time and the reviewer wrote into its summary).
  "review-proposal-waiting": (world) => {
    lawOf(world);
    const [newest] = world.reviews;
    const change = (param, current, proposed) => ({ param, label: settingOf(world, param)?.label ?? param, unit: "°F", current, proposed });
    newest.summary = `${newest.summary.replace(" No band edit proposed.", "")} Proposal: raise only the low edge at sunrise and solar midnight by 2 °F.`;
    newest.proposal = {
      changes: [change("band_temp_low_sr", 62.5, 64.5), change("band_temp_low_mid", 60.7, 62.7)],
      // Stored as verdify_schemas BandProposal stores it: the quoted price-list rows, one a line.
      price: [
        "Low edge only, sunrise and midnight 2 F higher: Therms/day +0.31 / +0.31; kWh/day +0.9 / +0.4; Gallons/day +10 / +4; "
          + "Starts/day +3.7 / +0.1; Run hours/day +0.7 / -0.6; Both in own band (points) +2.1 / +4.5; Nights dried (of 100) +8 / +13",
        "Low edge only, sunrise and midnight 1 F higher: Therms/day +0.15 / +0.16; kWh/day +0.4 / +0.2; Gallons/day +5 / +2; "
          + "Starts/day +1.8 / +0.1; Run hours/day +0.3 / -0.3; Both in own band (points) +1.0 / +2.2; Nights dried (of 100) +4 / +6",
      ].join("\n"),
      reason: "VPD ran below the band on most nights while temperature held; a warmer low edge at night dries the house with less venting.",
    };
    // An older proposal, since superseded by newer reviews.
    const older = world.reviews[4];
    older.proposal = {
      changes: [{ param: "band_vpd_high_sm", label: settingOf(world, "band_vpd_high_sm")?.label ?? "band_vpd_high_sm", unit: "kPa", current: 1.35, proposed: 1.39 }],
      price: "High VPD edge at solar noon 0.04 kPa higher: Gallons/day -6 / -2; Starts/day -1.2 / -0.4",
      reason: null,
    };
  },
  // Yesterday's record is partial: a restart lost meter counts, the meter covered 54 % of the day so its 24-hour kWh is
  // unknown, and the relay counters cover only part of it.
  "record-partial-day": (world) => {
    lawOf(world);
    const yesterday = world.record[1];
    Object.assign(yesterday.energy, { kwh: null, kwh_partial: 11.92, coverage_pct: 54.0 });
    Object.assign(yesterday.water, { complete: false });
    Object.assign(yesterday.drying, { lower_bound: true });
    Object.assign(yesterday.band, { graded_min: 1080 });
    yesterday.counter_sample_pct = 61.2;
    world.relayCheckComparisons = ["partial", "partial", "complete", "partial"];
  },
  // No law record is stored (a controller on firmware from before the law): API-32 serves no law day and neither
  // period, the law view has no record, and its history is unknown throughout. No day has the drying meter or the
  // law's drying record either, as migration 317 stores them only for a day with a law record.
  "record-no-periods": (world) => {
    const law = lawOf(world);
    Object.assign(law, { observedAt: null, firstRecordAt: null, latches: [], requests: [], cost: null, constantsHash: null, gaps: [], sourceSpans: [] });
    law.meter = { seconds: null, water_g: null, heat_wh: null, refused_seconds: null, observed_at: null };
    for (const row of world.record) Object.assign(row.drying, { water_g: null, heat_wh: null, lower_bound: null, wanted_s: null, refused_s: null });
  },
  // Four soil probes have gone quiet: three were last seen three days ago, and one has no reading in 30 days. They
  // are known silent. One wall probe stopped about 3 h ago, within the day: that one warns ("Stopped today").
  "data-probes-silent": (world) => {
    lawOf(world);
    const lastSeen = iso(world.now - 3 * DAY);
    world.system.probes = [
      ...world.system.probes,
      ...[["climate.soil_moisture_south_1", lastSeen], ["climate.soil_moisture_south_2", lastSeen], ["climate.soil_moisture_west", lastSeen]]
        .map(([sensor, seen]) => ({ sensor, age_s: (3 * DAY) / SECOND, last_seen_at: seen })),
      { sensor: "climate.soil_ec_south_1", age_s: null, last_seen_at: null },
      { sensor: "climate.rh_west", age_s: (3 * HOUR) / SECOND, last_seen_at: iso(world.now - 3 * HOUR) },
    ];
  },
  // The gap log is off because the controller's storage is full: nothing is kept while the host is away.
  "gap-log-off": (world) => {
    lawOf(world);
    world.controller = { ...world.controller, gap_log: "nvs_full" };
    Object.assign(world.system.health, { nvs_used_entries: 13_420, nvs_free_entries: 314, nvs_write_worst_ms: 212.5 });
  },
  // Pushes are failing (the live band/failed rows), one push waits 31 min, and the dispatcher is pacing. Each setting
  // stands one way against the catalogue (screens section 10.3): the two lux thresholds are failing (their newest value
  // is not confirmed), the two minimum on-times are in force (the controller holds the wanted value although their
  // pushes failed), the outdoor staleness limit recovered (a push was confirmed after its last failure), and
  // fog_escalation_kpa is retired (the catalogue no longer has it).
  "delivery-failing": (world) => {
    lawOf(world);
    const { delivery } = world.system;
    delivery.byStatus = [...delivery.byStatus, ["band", "failed", 141], ["manual", "failed", 6], ["plan", "failed", 4], ["manual", "pending", 1]];
    delivery.oldestUnconfirmedS = 1840;
    delivery.latency = { p50_s: 9.8, p95_s: 412.0, confirmed: 288 };
    const failing = (param, failed, minutesAgo, confirmedHoursAgo) => ({
      param, failed, last_failed_at: iso(world.now - minutesAgo * MINUTE), last_confirmed_at: confirmedHoursAgo === null ? null : iso(world.now - confirmedHoursAgo * HOUR),
    });
    delivery.failing = [
      failing("gl_main_lux_threshold", 36, 4, null), failing("gl_grow_lux_threshold", 36, 4, null), failing("gl_main_min_on_s", 35, 5, 30),
      failing("gl_grow_min_on_s", 34, 5, 30), failing("outdoor_staleness_max_s", 6, 31, 0.25), failing("fog_escalation_kpa", 12, 50, null),
    ];
    const sent = iso(world.now - 4 * MINUTE);
    ["gl_main_lux_threshold", "gl_grow_lux_threshold"].forEach((param, index) => {
      const desired = {
        id: 9101 + index, param, value: 30_000, snapped_from: null, manual: true, manual_before: false, state: "not_confirmed",
        state_reason: { code: "no_match", detail: null, applied_value: null, since: sent }, confirmed_at: null,
        actor: { source: "dashboard", name: "jason" }, reason: null, created_at: sent,
      };
      Object.assign(settingOf(world, param), { state: "not_confirmed", desired, applied_from: "manual" });
    });
    world.system.dispatcherStage = "paced 12/40";
  },
};
