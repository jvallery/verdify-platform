/*
 * test_running_alone.cpp — host tests for phase 2 of the climate refactor, "running alone"
 * (firmware/lib/running_alone.h and the greenhouse_logic.h rules it changes).
 *
 * Compile: g++ -std=c++17 -I lib -o test/test_running_alone test/test_running_alone.cpp
 */

#include "greenhouse_logic.h"
#include "sntp_acquisition.h"
#include "probe_validity.h"
#include "heap_diagnostics.h"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

static int tests_passed = 0;
static int tests_failed = 0;

#define TEST(name)                                                         \
    static void test_##name();                                             \
    static struct Register_##name {                                        \
        Register_##name() { test_registry.push_back({#name, test_##name}); } \
    } reg_##name;                                                          \
    static void test_##name()

#define ASSERT_EQ(a, b) do { if ((a) != (b)) { printf("  FAIL: %s != %s (line %d)\n", #a, #b, __LINE__); tests_failed++; return; } } while (0)
#define ASSERT_TRUE(x) do { if (!(x)) { printf("  FAIL: %s (line %d)\n", #x, __LINE__); tests_failed++; return; } } while (0)
#define ASSERT_FALSE(x) ASSERT_TRUE(!(x))
#define ASSERT_NEAR(a, b, eps) ASSERT_TRUE(std::fabs((a) - (b)) <= (eps))
#define PASS() tests_passed++

struct TestEntry { const char* name; void (*fn)(); };
static std::vector<TestEntry> test_registry;

using namespace running_alone_k;

// The house band's anchors as the controller held them on 2026-11-16 (SR, SM, SS, MID):
// the corridor they give is 60.7 to 83.8 F and 0.74 to 1.29 kPa (plan 4.9).
static const BandAnchors kTempLow = {66.0f, 72.0f, 68.0f, 60.7f};
static const BandAnchors kTempHigh = {76.0f, 83.8f, 80.0f, 71.0f};
static const BandAnchors kVpdLow = {0.80f, 0.90f, 0.85f, 0.74f};
static const BandAnchors kVpdHigh = {1.20f, 1.29f, 1.25f, 1.10f};

static SensorInputs inputs(float temp, float vpd, float rh = 60.0f) {
    SensorInputs in{};
    in.temp_f = temp;
    in.vpd_kpa = vpd;
    in.rh_pct = rh;
    in.dew_point_f = temp - 10.0f;
    in.outdoor_rh_pct = 30.0f;
    in.enthalpy_delta = -5.0f;
    in.vpd_south = in.vpd_west = in.vpd_east = vpd;
    in.local_hour = 12;
    in.outdoor_temp_f = NAN;
    in.outdoor_dewpoint_f = NAN;
    in.outdoor_data_age_s = OUTDOOR_AGE_NONE_S;
    return in;
}

static Setpoints band(float low = 65.0f, float high = 82.0f) {
    Setpoints sp = default_setpoints();
    sp.temp_low = low;
    sp.temp_high = high;
    sp.vpd_low = 0.8f;
    sp.vpd_high = 1.4f;
    sp.safety_max = 100.0f;
    sp.safety_min = 40.0f;
    sp.band_track_fraction = 0.0f;
    return sp;
}

static bool relays_eq(const RelayOutputs& a, const RelayOutputs& b) {
    return a.heat1 == b.heat1 && a.heat2 == b.heat2 && a.fan1 == b.fan1 && a.fan2 == b.fan2 && a.fog == b.fog &&
           a.vent == b.vent;
}

// The YAML's glue, step for step (controls.yaml sections 4, 8+9, 10 and 11), calling the
// same functions in the same order. Only the assembly of SensorInputs is restated here;
// every decision is the library's.
struct Tick {
    IndoorReading indoor;
    bool boot_wait;
    Mode mode;
    RelayOutputs out;  // after the decision-7 table, the overrides, arbitration and the fog rails
    const char* fog_force_off;
    NoIndoorBranch branch;
};

struct Controller {
    BootGrace grace{};
    ControlState st = initial_state();
    bool no_indoor_prev = false;
    NoIndoorBranch no_indoor_last = NoIndoorBranch::kOff;
    RelayOutputs physical{false, false, false, false, false, false};

    Tick tick(uint32_t now_ms, const IndoorReading& indoor, const OutdoorReading& outdoor, const Setpoints& sp,
              float corridor_low, bool humid_latched = false, bool engine_fog_run = false, bool fans_latched = false) {
        Tick t{};
        t.indoor = indoor;
        t.boot_wait = indoor_gate(grace, indoor.source != IndoorSource::kNone, now_ms) == IndoorGate::kBootWait;
        SensorInputs in{};
        in.temp_f = indoor.temp_f;
        in.vpd_kpa = indoor.vpd_kpa;
        in.rh_pct = indoor.rh_pct;
        in.dew_point_f = indoor.dew_point_f;
        in.outdoor_rh_pct = std::isnan(outdoor.rh_pct) ? 30.0f : outdoor.rh_pct;
        in.enthalpy_delta = -5.0f;
        in.vpd_south = in.vpd_west = in.vpd_east = NAN;
        in.local_hour = 12;
        in.outdoor_temp_f = outdoor.temp_f;
        in.outdoor_dewpoint_f = outdoor.dew_point_f;
        in.outdoor_data_age_s = outdoor.age_s;
        in.sensor_degraded = indoor_reading_degraded(indoor);
        Setpoints s = sp;
        s.sw_fsm_controller_enabled = true;
        t.mode = t.boot_wait ? IDLE : determine_mode(in, s, st, 1000);
        RelayOutputs out = t.boot_wait ? RelayOutputs{false, false, false, false, false, false}
                                       : resolve_equipment(t.mode, in, s, st, true);
        const bool no_indoor_entry = t.mode == SENSOR_FAULT && !no_indoor_prev;
        no_indoor_prev = t.mode == SENSOR_FAULT;
        t.branch = NoIndoorBranch::kOff;
        if (t.mode == SENSOR_FAULT) {
            t.branch = no_indoor_branch(outdoor.temp_f, outdoor.age_s, corridor_low,
                                        no_indoor_entry ? NoIndoorBranch::kOff : no_indoor_last);
            out = no_indoor_relays(t.branch, true);
            no_indoor_last = t.branch;
        }
        // AB12/AD1: a fogger press is held only by its own holds; a run-once is apart from the
        // latches, under the law's rails (SENSOR_FAULT's lock among them).
        const FogForceOffInputs rails{t.mode == SENSOR_FAULT, false, false, false, false, false, false};
        const char* press_hold = manual_fog_hold_reason(rails);
        const ManualForce mf =
            apply_manual_overrides(out, {fans_latched, false, humid_latched, press_hold[0] != '\0', false, false}, t.mode);
        if (engine_fog_run && t.mode != SAFETY_COOL && t.mode != SAFETY_HEAT) out.fog = true;
        const RelayArbitration arb = arbitrate_relay_conflicts(t.mode, out, physical, true, true, false);
        out = arb.out;
        t.fog_force_off = mf.fog ? press_hold : fog_force_off_reason(t.mode, rails);
        if (t.fog_force_off[0] != '\0') out.fog = false;
        t.out = out;
        return t;
    }
};

static IndoorReading wall(float t, float rh) {
    return select_indoor_reading(t, rh, indoor_vpd_kpa(t, rh), dew_point_magnus_f(t, rh), false, NAN, NAN);
}

static IndoorReading no_indoor() { return select_indoor_reading(NAN, NAN, NAN, NAN, false, NAN, NAN); }

static OutdoorReading outdoor_at(float t, float rh = 50.0f) {
    return select_outdoor_reading(1000000u, t, rh, 1000000u - 30000u, NAN, NAN, 0u);
}

static OutdoorReading no_outdoor() { return select_outdoor_reading(1000000u, NAN, NAN, 0u, NAN, NAN, 0u); }

// ── 1. The band's clock: the trust flag and the corridor ─────────────────

TEST(trust_flag_needs_a_completed_sync_since_this_boot) {
    // After any boot sntp_acquired starts false (restore_value: no). A soft reset keeps the
    // ESP32's clock valid (RULINGS C3), and the startup callback for that retained clock is
    // not a completed sync: the band does not trust it.
    bool acquired = false;
    uint32_t last_sync_ms = 0;
    ASSERT_FALSE(record_sntp_acquisition(false, true, 1500u, acquired, last_sync_ms));
    ASSERT_FALSE(sntp_acquisition_valid(acquired, /*rtc_valid=*/true, /*failed=*/false));
    ASSERT_TRUE(select_band_source(true, sntp_acquisition_valid(acquired, true, false)) == BandSource::kCorridor);
    // A power cut: no clock at all. Still the corridor.
    ASSERT_TRUE(select_band_source(true, sntp_acquisition_valid(acquired, false, false)) == BandSource::kCorridor);
    // A time server answers: the curve.
    ASSERT_TRUE(record_sntp_acquisition(true, true, 90000u, acquired, last_sync_ms));
    ASSERT_TRUE(select_band_source(true, sntp_acquisition_valid(acquired, true, false)) == BandSource::kOnchipCurve);
    // An hour without a valid clock (sntp_failed) drops the trust again.
    ASSERT_TRUE(select_band_source(true, sntp_acquisition_valid(acquired, true, true)) == BandSource::kCorridor);
    // The pushed legacy band does not depend on the clock.
    ASSERT_TRUE(select_band_source(false, false) == BandSource::kDispatcherLegacy);
    ASSERT_TRUE(select_band_source(false, true) == BandSource::kDispatcherLegacy);
    PASS();
}

TEST(band_source_names_are_the_published_values) {
    ASSERT_EQ(std::string(band_source_name(BandSource::kOnchipCurve)), std::string("onchip_curve"));
    ASSERT_EQ(std::string(band_source_name(BandSource::kCorridor)), std::string("corridor"));
    ASSERT_EQ(std::string(band_source_name(BandSource::kDispatcherLegacy)), std::string("dispatcher_legacy"));
    PASS();
}

TEST(corridor_is_the_lowest_and_highest_anchor_of_each_edge) {
    const BandCorridor c = band_corridor(kTempLow, kTempHigh, kVpdLow, kVpdHigh);
    ASSERT_NEAR(c.temp_low, 60.7f, 1e-4f);
    ASSERT_NEAR(c.temp_high, 83.8f, 1e-4f);
    ASSERT_NEAR(c.vpd_low, 0.74f, 1e-6f);
    ASSERT_NEAR(c.vpd_high, 1.29f, 1e-6f);
    ASSERT_NEAR(c.temp_target, 0.5f * (60.7f + 83.8f), 1e-4f);
    ASSERT_NEAR(c.vpd_target, 0.5f * (0.74f + 1.29f), 1e-6f);
    // Whichever anchor holds the extreme.
    const BandCorridor d = band_corridor({59.0f, 70.0f, 71.0f, 72.0f}, {80.0f, 79.0f, 90.0f, 70.0f},
                                         {0.9f, 0.5f, 0.9f, 0.9f}, {1.0f, 1.0f, 1.0f, 1.6f});
    ASSERT_NEAR(d.temp_low, 59.0f, 1e-4f);
    ASSERT_NEAR(d.temp_high, 90.0f, 1e-4f);
    ASSERT_NEAR(d.vpd_low, 0.5f, 1e-6f);
    ASSERT_NEAR(d.vpd_high, 1.6f, 1e-6f);
    PASS();
}

TEST(corridor_contains_the_curve_at_every_phase) {
    // The corridor is the widest band the anchors allow: at no solar phase does the curve
    // ask for a low edge below it or a high edge above it... at the anchors themselves.
    const BandCorridor c = band_corridor(kTempLow, kTempHigh, kVpdLow, kVpdHigh);
    for (float phase : {0.0f, 1.0f, 2.0f, 3.0f}) {
        ASSERT_TRUE(band_value_at_phase(kTempLow, phase) >= c.temp_low - 1e-4f);
        ASSERT_TRUE(band_value_at_phase(kTempHigh, phase) <= c.temp_high + 1e-4f);
        ASSERT_TRUE(band_value_at_phase(kVpdLow, phase) >= c.vpd_low - 1e-6f);
        ASSERT_TRUE(band_value_at_phase(kVpdHigh, phase) <= c.vpd_high + 1e-6f);
    }
    PASS();
}

TEST(fog_and_misters_work_on_the_corridor_with_no_clock) {
    // Today fog was refused without a clock ("time_invalid"). The force-off has no clock term
    // now: with every rail clear, fog is not forced off in any mode.
    const FogForceOffInputs clear{false, false, false, false, false, false, false};
    for (Mode m : {IDLE, SEALED_MIST, VENTILATE, SAFETY_COOL, DEHUM_VENT}) {
        ASSERT_FALSE(fog_forced_off(m, clear));
    }
    // A dry house on the corridor gets humidity demand from the band alone.
    const BandCorridor c = band_corridor(kTempLow, kTempHigh, kVpdLow, kVpdHigh);
    Setpoints sp = band(c.temp_low, c.temp_high);
    sp.vpd_low = c.vpd_low;
    sp.vpd_high = c.vpd_high;
    SensorInputs in = inputs(75.0f, 2.0f, 30.0f);
    in.dew_point_f = 40.0f;
    ASSERT_TRUE(climate_wet_assist_permitted(in, sp));
    ASSERT_TRUE(climate_fog_assist_permitted(in, sp));
    PASS();
}

// ── 2. The indoor reading: validity split, no substituted value (RULINGS G2) ──

TEST(wall_probes_are_used_while_their_temperature_is_valid) {
    const IndoorReading r = select_indoor_reading(70.0f, 55.0f, 1.10f, 52.0f, true, 75.0f, 40.0f);
    ASSERT_TRUE(r.source == IndoorSource::kWall && r.humidity_valid);
    ASSERT_NEAR(r.temp_f, 70.0f, 1e-6f);
    ASSERT_NEAR(r.rh_pct, 55.0f, 1e-6f);
    ASSERT_NEAR(r.vpd_kpa, 1.10f, 1e-6f);
    ASSERT_NEAR(r.dew_point_f, 52.0f, 1e-6f);
    ASSERT_FALSE(indoor_reading_degraded(r));
    // Missing VPD or dew-point averages come from the same pair.
    const IndoorReading d = select_indoor_reading(70.0f, 55.0f, NAN, NAN, false, NAN, NAN);
    ASSERT_NEAR(d.vpd_kpa, indoor_vpd_kpa(70.0f, 55.0f), 1e-6f);
    ASSERT_NEAR(d.dew_point_f, dew_point_magnus_f(70.0f, 55.0f), 1e-6f);
    PASS();
}

TEST(wall_humidity_above_100_up_to_110_reads_as_saturation) {
    const IndoorReading r = select_indoor_reading(55.0f, 104.0f, -0.02f, 56.0f, false, NAN, NAN);
    ASSERT_TRUE(r.source == IndoorSource::kWall && r.humidity_valid);
    ASSERT_NEAR(r.rh_pct, 100.0f, 1e-6f);
    ASSERT_NEAR(r.vpd_kpa, 0.0f, 1e-6f);                // from the pair, not the negative average
    ASSERT_NEAR(r.dew_point_f, 55.0f, 1e-3f);           // saturated air: dew point = temperature
    const IndoorReading at110 = select_indoor_reading(55.0f, 110.0f, NAN, NAN, false, NAN, NAN);
    ASSERT_TRUE(at110.humidity_valid);
    const IndoorReading above = select_indoor_reading(55.0f, 110.5f, NAN, NAN, false, NAN, NAN);
    ASSERT_FALSE(above.humidity_valid);
    ASSERT_TRUE(above.source == IndoorSource::kWall);
    ASSERT_FALSE(select_indoor_reading(55.0f, -1.0f, NAN, NAN, false, NAN, NAN).humidity_valid);
    PASS();
}

TEST(valid_temperature_without_humidity_keeps_temperature_control) {
    // A saturated winter night with the wall humidity unreadable: the furnace and the
    // protection limits keep running; fog, misters and drying hold; nothing substituted.
    Controller c;
    const Setpoints sp = band(65.0f, 82.0f);
    const IndoorReading r = select_indoor_reading(50.0f, 111.0f, NAN, NAN, true, 52.0f, 60.0f);
    ASSERT_TRUE(r.source == IndoorSource::kWall && !r.humidity_valid);  // never mixed with the case humidity
    ASSERT_TRUE(std::isnan(r.rh_pct) && std::isnan(r.vpd_kpa) && std::isnan(r.dew_point_f));
    ASSERT_TRUE(indoor_reading_degraded(r));
    Tick t = c.tick(100000u, r, outdoor_at(20.0f), sp, 60.7f);
    ASSERT_TRUE(t.mode != SENSOR_FAULT);
    ASSERT_TRUE(t.out.heat1 && t.out.heat2);  // 15 F under the low edge: both stages
    ASSERT_FALSE(t.out.fog || t.out.vent);
    // At the 100 F limit: SAFETY_COOL, vent and fans, no fog (its tests cannot be evaluated).
    Controller hot;
    t = hot.tick(100000u, select_indoor_reading(101.0f, NAN, NAN, NAN, false, NAN, NAN), outdoor_at(90.0f), sp, 60.7f);
    ASSERT_EQ(t.mode, SAFETY_COOL);
    ASSERT_TRUE(t.out.vent && t.out.fan1 && t.out.fan2);
    ASSERT_FALSE(t.out.fog || t.out.heat1 || t.out.heat2);
    // A fogger press stays effective (AD1: no conditional refusals): no humidity reading,
    // and a cold house under the band's low edge.
    Controller cold_press;
    t = cold_press.tick(100000u, r, outdoor_at(20.0f), sp, 60.7f, /*humid_latched=*/true);
    ASSERT_EQ(std::string(t.fog_force_off), std::string(""));
    ASSERT_TRUE(t.out.fog);
    Controller press;
    t = press.tick(100000u, select_indoor_reading(75.0f, NAN, NAN, NAN, false, NAN, NAN), outdoor_at(70.0f), sp,
                   60.7f, /*humid_latched=*/true);
    ASSERT_EQ(std::string(t.fog_force_off), std::string(""));
    ASSERT_TRUE(t.out.fog);
    PASS();
}

TEST(case_sensor_alone_runs_on_its_reading_less_the_offset_with_its_own_dew_point) {
    const IndoorReading r = select_indoor_reading(NAN, NAN, NAN, NAN, true, 72.0f, 40.0f);
    ASSERT_TRUE(r.source == IndoorSource::kCase && r.humidity_valid);
    ASSERT_NEAR(r.temp_f, 72.0f - CASE_SENSOR_OFFSET_F, 1e-5f);
    ASSERT_NEAR(CASE_SENSOR_OFFSET_F, 1.6f, 1e-6f);  // RULINGS F2, from the climate law constants
    ASSERT_NEAR(r.vpd_kpa, indoor_vpd_kpa(72.0f, 40.0f), 1e-6f);
    ASSERT_NEAR(r.dew_point_f, dew_point_magnus_f(72.0f, 40.0f), 1e-6f);  // the case air's own (M1)
    ASSERT_TRUE(indoor_reading_degraded(r));  // VPD-chasing holds, as today

    // 70.4 F under a 71 F low edge: heat; humidity control held although VPD is far above the band.
    Controller c;
    Tick t = c.tick(100000u, select_indoor_reading(NAN, NAN, NAN, NAN, true, 72.0f, 10.0f), outdoor_at(60.0f),
                    band(71.0f, 82.0f), 60.7f);
    ASSERT_EQ(t.mode, IDLE);
    ASSERT_TRUE(t.out.heat1);
    ASSERT_FALSE(t.out.fog);
    PASS();
}

TEST(case_sensor_alone_fogs_at_the_100_f_limit_and_accepts_a_humid_press) {
    // review-1703 M1: on the case sensor alone the wetting margin is computable, so the
    // survival fog at the 100 F limit, the HUMID press and the centre bursts work as today.
    Setpoints sp = band(65.0f, 82.0f);
    const IndoorReading r = select_indoor_reading(NAN, NAN, NAN, NAN, true, 102.6f, 20.0f);  // 101 F
    ASSERT_NEAR(r.temp_f, 101.0f, 1e-4f);
    ASSERT_TRUE(r.vpd_kpa > sp.vpd_high);
    Controller c;
    Tick t = c.tick(100000u, r, outdoor_at(95.0f, 15.0f), sp, 60.7f);
    ASSERT_EQ(t.mode, SAFETY_COOL);
    ASSERT_TRUE(t.out.fog);
    ASSERT_TRUE(t.out.vent && t.out.fan1 && t.out.fan2);
    SensorInputs in = inputs(r.temp_f, r.vpd_kpa, r.rh_pct);
    in.dew_point_f = r.dew_point_f;
    ASSERT_TRUE(dew_margin_f(in) > sp.direct_wet_stress_min_dew_margin_f);
    // A HUMID press in a hot dry house on the case sensor.
    Controller p;
    t = p.tick(100000u, select_indoor_reading(NAN, NAN, NAN, NAN, true, 86.6f, 25.0f), outdoor_at(80.0f, 20.0f), sp,
               60.7f, /*humid_latched=*/true);
    ASSERT_EQ(std::string(t.fog_force_off), std::string(""));
    ASSERT_TRUE(t.out.fog);
    PASS();
}

TEST(case_temperature_without_case_humidity_keeps_temperature_control) {
    // review-1703 minor 4: a valid case temperature with no case humidity is not a fault.
    const IndoorReading r = select_indoor_reading(NAN, NAN, NAN, NAN, true, 62.0f, NAN);
    ASSERT_TRUE(r.source == IndoorSource::kCase && !r.humidity_valid);
    Controller c;
    const Tick t = c.tick(100000u, r, outdoor_at(30.0f), band(65.0f, 82.0f), 60.7f);
    ASSERT_TRUE(t.mode != SENSOR_FAULT);
    ASSERT_TRUE(t.out.heat1);
    ASSERT_FALSE(t.out.fog);
    PASS();
}

TEST(case_sensor_is_used_only_while_fresh_and_valid) {
    IndoorReading r = select_indoor_reading(NAN, NAN, NAN, NAN, false, 72.0f, 40.0f);  // stale
    ASSERT_TRUE(r.source == IndoorSource::kNone);
    r = select_indoor_reading(NAN, NAN, NAN, NAN, true, 160.0f, 40.0f);  // implausible
    ASSERT_TRUE(r.source == IndoorSource::kNone);
    // An implausible wall average falls to the case sensor.
    r = select_indoor_reading(150.0f, 50.0f, 1.0f, 60.0f, true, 72.0f, 40.0f);
    ASSERT_TRUE(r.source == IndoorSource::kCase);
    ASSERT_TRUE(probe_sample_fresh(400000u, 100001u, INDOOR_PROBE_STALE_MS));
    ASSERT_FALSE(probe_sample_fresh(400001u, 100001u, INDOOR_PROBE_STALE_MS));
    ASSERT_FALSE(probe_sample_fresh(5000u, 0u, INDOOR_PROBE_STALE_MS));
    PASS();
}

TEST(no_indoor_temperature_has_no_substituted_value_and_is_sensor_fault) {
    const IndoorReading r = no_indoor();
    ASSERT_TRUE(r.source == IndoorSource::kNone && !r.humidity_valid);
    ASSERT_TRUE(std::isnan(r.temp_f) && std::isnan(r.rh_pct) && std::isnan(r.vpd_kpa) && std::isnan(r.dew_point_f));
    Controller c;
    const Tick t = c.tick(120000u, r, outdoor_at(70.0f), band(), 60.7f);  // past the boot grace
    ASSERT_EQ(t.mode, SENSOR_FAULT);
    ASSERT_EQ(std::string(c.st.last_mode_reason), std::string("sensor_fault"));
    SensorInputs garbage = inputs(72.0f, 1.0f, INFINITY);
    ASSERT_FALSE(sensors_plausible(garbage));
    PASS();
}

// ── 3. No valid indoor temperature: decision 7, all three branches ──────

TEST(no_indoor_temperature_warm_outdoor_vents_with_the_lead_fan) {
    const float corridor_low = band_corridor(kTempLow, kTempHigh, kVpdLow, kVpdHigh).temp_low;
    ASSERT_TRUE(no_indoor_branch(60.7f, 60u, corridor_low) == NoIndoorBranch::kVent);  // at the edge
    ASSERT_TRUE(relays_eq(no_indoor_relays(NoIndoorBranch::kVent, false), {false, false, false, true, false, true}));
    ASSERT_EQ(std::string(no_indoor_reason(NoIndoorBranch::kVent)), std::string("no_indoor_vent"));
    Controller c;
    const Tick t = c.tick(120000u, no_indoor(), outdoor_at(85.0f), band(), corridor_low);
    ASSERT_TRUE(t.branch == NoIndoorBranch::kVent);
    ASSERT_TRUE(relays_eq(t.out, {false, false, true, false, false, true}));
    PASS();
}

TEST(no_indoor_temperature_cold_outdoor_heats_electric_only) {
    const float corridor_low = band_corridor(kTempLow, kTempHigh, kVpdLow, kVpdHigh).temp_low;
    ASSERT_EQ(std::string(no_indoor_reason(NoIndoorBranch::kHeat)), std::string("no_indoor_heat"));
    Controller c;
    c.physical = {false, false, true, false, false, true};  // entering from the vent branch
    Tick t = c.tick(120000u, no_indoor(), outdoor_at(10.0f), band(), corridor_low);
    ASSERT_TRUE(t.branch == NoIndoorBranch::kHeat);
    ASSERT_FALSE(t.out.heat1);  // waits until the vent and the fan are off
    c.physical = {false, false, false, false, false, false};
    t = c.tick(121000u, no_indoor(), outdoor_at(10.0f), band(), corridor_low);
    ASSERT_TRUE(relays_eq(t.out, {true, false, false, false, false, false}));  // never the furnace
    PASS();
}

TEST(no_indoor_temperature_and_no_outdoor_reading_turns_every_relay_off) {
    ASSERT_TRUE(no_indoor_branch(70.0f, OUTDOOR_MAX_AGE_S, 60.7f) == NoIndoorBranch::kOff);  // stale
    ASSERT_TRUE(no_indoor_branch(70.0f, 10u, NAN) == NoIndoorBranch::kOff);
    ASSERT_EQ(std::string(no_indoor_reason(NoIndoorBranch::kOff)), std::string("no_indoor_off"));
    Controller c;
    const Tick t = c.tick(120000u, no_indoor(), no_outdoor(), band(), 60.7f);
    ASSERT_TRUE(t.branch == NoIndoorBranch::kOff);
    ASSERT_TRUE(relays_eq(t.out, {false, false, false, false, false, false}));
    PASS();
}

TEST(no_indoor_rule_has_one_degree_of_hysteresis) {
    // RULINGS G5: vent at or above the corridor's low edge; back to heat only below it less 1.0 F.
    const float low = 60.7f;
    ASSERT_TRUE(no_indoor_branch(60.0f, 30u, low, NoIndoorBranch::kVent) == NoIndoorBranch::kVent);
    ASSERT_TRUE(no_indoor_branch(59.7f, 30u, low, NoIndoorBranch::kVent) == NoIndoorBranch::kVent);
    ASSERT_TRUE(no_indoor_branch(59.6f, 30u, low, NoIndoorBranch::kVent) == NoIndoorBranch::kHeat);
    ASSERT_TRUE(no_indoor_branch(60.6f, 30u, low, NoIndoorBranch::kHeat) == NoIndoorBranch::kHeat);
    ASSERT_TRUE(no_indoor_branch(60.7f, 30u, low, NoIndoorBranch::kHeat) == NoIndoorBranch::kVent);
    // Through the loop: outdoor air drifting around the edge changes the branch twice, not per sample.
    Controller c;
    std::vector<NoIndoorBranch> seen;
    uint32_t now = 120000u;
    for (float t : {61.0f, 60.5f, 60.0f, 59.8f, 60.4f, 59.5f, 60.0f, 60.6f, 60.7f, 60.2f}) {
        const Tick k = c.tick(now, no_indoor(), outdoor_at(t), band(), low);
        if (seen.empty() || seen.back() != k.branch) seen.push_back(k.branch);
        now += 1000u;
    }
    ASSERT_EQ(seen.size(), 3u);
    ASSERT_TRUE(seen[0] == NoIndoorBranch::kVent && seen[1] == NoIndoorBranch::kHeat && seen[2] == NoIndoorBranch::kVent);
    PASS();
}

TEST(no_indoor_temperature_humid_press_is_effective_and_engine_run_once_is_not) {
    // RULINGS G7 (review-1703 M2), AD1, through the YAML's own checks: the fogger latch
    // fogs with no indoor reading; an engine run-once stays refused by SENSOR_FAULT's lock.
    Controller c;
    Tick t = c.tick(120000u, no_indoor(), outdoor_at(85.0f), band(), 60.7f, /*humid_latched=*/true);
    ASSERT_EQ(t.mode, SENSOR_FAULT);
    ASSERT_EQ(std::string(t.fog_force_off), std::string(""));
    ASSERT_TRUE(t.out.fog);
    Controller e;
    t = e.tick(120000u, no_indoor(), outdoor_at(85.0f), band(), 60.7f, false, /*engine_fog_run=*/true);
    ASSERT_EQ(std::string(t.fog_force_off), std::string("sensor_fault"));
    ASSERT_FALSE(t.out.fog);
    // No press: fog and misters stay off in every branch.
    for (float out_t : {85.0f, 10.0f}) {
        Controller n;
        ASSERT_FALSE(n.tick(120000u, no_indoor(), outdoor_at(out_t), band(), 60.7f).out.fog);
    }
    // FANS: both fans and the vent; the relay layer then cuts the heater.
    Controller f;
    t = f.tick(120000u, no_indoor(), outdoor_at(10.0f), band(), 60.7f, false, false, /*fans_latched=*/true);
    ASSERT_TRUE(t.out.fan1 && t.out.fan2 && t.out.vent && !t.out.heat1);
    // The temperature rails stay absolute.
    RelayOutputs out = no_indoor_relays(NoIndoorBranch::kOff, true);
    const ManualForce mf = apply_manual_overrides(out, {true, true, true, false, false, false}, SAFETY_HEAT);
    ASSERT_FALSE(mf.fans || mf.fog || mf.vent_open);
    PASS();
}

// ── 4. Outdoor data: source order and ages; the cold-vent guard ──────────

TEST(outdoor_station_first_intake_second_each_with_its_age) {
    const uint32_t now = 1000000u;
    OutdoorReading r = select_outdoor_reading(now, 50.0f, 40.0f, now - 30000u, 52.0f, 35.0f, now - 2000u);
    ASSERT_TRUE(r.source == OutdoorSource::kStation);
    ASSERT_NEAR(r.temp_f, 50.0f, 1e-6f);
    ASSERT_EQ(r.age_s, 30u);
    ASSERT_NEAR(r.dew_point_f, dew_point_magnus_f(50.0f, 40.0f), 1e-6f);
    ASSERT_EQ(std::string(outdoor_source_name(r.source)), std::string("station"));
    r = select_outdoor_reading(now, 50.0f, 40.0f, now - 600000u, 52.0f, 35.0f, now - 2000u);
    ASSERT_TRUE(r.source == OutdoorSource::kIntake);
    ASSERT_NEAR(r.temp_f, 52.0f, 1e-6f);
    ASSERT_EQ(r.age_s, 2u);
    ASSERT_EQ(std::string(outdoor_source_name(r.source)), std::string("intake"));
    r = select_outdoor_reading(now, 50.0f, 40.0f, now - 599999u, 52.0f, 35.0f, now - 2000u);
    ASSERT_TRUE(r.source == OutdoorSource::kStation);
    r = select_outdoor_reading(now, 50.0f, NAN, now - 1000u, 52.0f, 35.0f, now - 2000u);
    ASSERT_TRUE(r.source == OutdoorSource::kIntake);
    r = select_outdoor_reading(now, 50.0f, 40.0f, 0u, 52.0f, 35.0f, now - 2000u);
    ASSERT_TRUE(r.source == OutdoorSource::kIntake);
    r = select_outdoor_reading(now, 50.0f, 40.0f, now - 700000u, 52.0f, 35.0f, now - 600000u);
    ASSERT_TRUE(r.source == OutdoorSource::kNone);
    ASSERT_TRUE(std::isnan(r.temp_f) && std::isnan(r.rh_pct) && std::isnan(r.dew_point_f));
    ASSERT_EQ(r.age_s, OUTDOOR_AGE_NONE_S);
    ASSERT_FALSE(outdoor_data_fresh(r.age_s));
    ASSERT_EQ(std::string(outdoor_source_name(r.source)), std::string("none"));
    r = select_outdoor_reading(5000u, 50.0f, 40.0f, UINT32_MAX - 4999u, NAN, NAN, 0u);  // wrap-safe
    ASSERT_TRUE(r.source == OutdoorSource::kStation);
    ASSERT_EQ(r.age_s, 10u);
    PASS();
}

TEST(stale_stamps_are_cleared_so_a_wrap_cannot_revive_them) {
    // review-1703 minor 9: a stamp older than the maximum age is zeroed.
    const uint32_t max_ms = OUTDOOR_MAX_AGE_S * 1000u;
    uint32_t stamp = 1000u;
    expire_sample_stamp(stamp, 1000u + max_ms, max_ms);
    ASSERT_EQ(stamp, 1000u);  // exactly the maximum age: kept (select already ignores it)
    expire_sample_stamp(stamp, 1001u + max_ms, max_ms);
    ASSERT_EQ(stamp, 0u);
    // Once cleared, the source reads as never heard, also 2^32 ms later.
    const OutdoorReading r = select_outdoor_reading(1500u, 50.0f, 40.0f, stamp, NAN, NAN, 0u);
    ASSERT_TRUE(r.source == OutdoorSource::kNone);
    uint32_t fresh = UINT32_MAX - 1000u;  // a fresh stamp across the wrap is kept
    expire_sample_stamp(fresh, 5000u, max_ms);
    ASSERT_EQ(fresh, UINT32_MAX - 1000u);
    PASS();
}

TEST(cold_vent_guard_assumes_cold_with_no_outdoor_reading) {
    // RULINGS G6: the guard reads the selected outdoor reading; with none it assumes cold,
    // the side with fewer vent starts. Warm fresh air: plain cooling at the high edge.
    const Setpoints sp = band(65.0f, 82.0f);
    Controller warm;
    ASSERT_EQ(warm.tick(100000u, wall(83.0f, 50.0f), outdoor_at(75.0f), sp, 60.7f).mode, VENTILATE);
    Controller cold;
    ASSERT_EQ(cold.tick(100000u, wall(83.0f, 50.0f), outdoor_at(30.0f), sp, 60.7f).mode, IDLE);
    Controller none;
    ASSERT_EQ(none.tick(100000u, wall(83.0f, 50.0f), no_outdoor(), sp, 60.7f).mode, IDLE);
    Setpoints g = sp;
    SensorInputs in = inputs(83.0f, 1.0f);
    ASSERT_TRUE(outdoor_cold_for_vent_guard(in, g));
    in.outdoor_temp_f = 75.0f;
    ASSERT_FALSE(outdoor_cold_for_vent_guard(in, g));
    PASS();
}

// ── 5. The boot: grace for the first reading; the furnace waits ──────────

TEST(boot_grace_waits_for_the_first_indoor_temperature_at_most_60_s) {
    // RULINGS G3. Probes answer after 20 s: no relay switched and no sensor fault before.
    Controller c;
    c.physical = {false, false, false, false, false, false};
    Tick t = c.tick(1000u, no_indoor(), outdoor_at(10.0f), band(), 60.7f);
    ASSERT_TRUE(t.boot_wait);
    ASSERT_EQ(t.mode, IDLE);
    ASSERT_EQ(std::string(c.st.last_mode_reason), std::string("init"));
    ASSERT_TRUE(relays_eq(t.out, {false, false, false, false, false, false}));
    t = c.tick(19000u, no_indoor(), outdoor_at(10.0f), band(), 60.7f);
    ASSERT_TRUE(t.boot_wait && t.mode == IDLE);
    t = c.tick(20000u, wall(60.0f, 70.0f), outdoor_at(10.0f), band(), 60.7f);
    ASSERT_FALSE(t.boot_wait);
    ASSERT_TRUE(t.out.heat1);
    // Once a temperature has been valid, losing it is the state of decision 7 at once.
    t = c.tick(21000u, no_indoor(), outdoor_at(10.0f), band(), 60.7f);
    ASSERT_EQ(t.mode, SENSOR_FAULT);
    // No probe at all: decision 7 at 60 s, not before.
    Controller d;
    ASSERT_TRUE(d.tick(59999u, no_indoor(), outdoor_at(10.0f), band(), 60.7f).boot_wait);
    t = d.tick(60000u, no_indoor(), outdoor_at(10.0f), band(), 60.7f);
    ASSERT_FALSE(t.boot_wait);
    ASSERT_EQ(t.mode, SENSOR_FAULT);
    ASSERT_TRUE(t.out.heat1);
    // The grace never comes back (a millis() wrap included).
    ASSERT_TRUE(indoor_gate(d.grace, false, 10u) == IndoorGate::kNoIndoor);
    PASS();
}

TEST(every_relay_but_the_furnace_is_available_at_boot) {
    // RULINGS G4: stamp 0 = no edge since this boot. Every relay may start at once except the
    // furnace, which waits one minimum off time after ANY boot.
    for (uint32_t min_off : {60000u, 90000u, 180000u, 300000u}) {
        ASSERT_TRUE(relay_start_allowed(1000u, 0u, min_off, false));
        ASSERT_TRUE(relay_dwell_elapsed(1000u, 0u, min_off));
    }
    ASSERT_FALSE(relay_start_allowed(0u, 0u, 300000u, true));
    ASSERT_FALSE(relay_start_allowed(299999u, 0u, 300000u, true));
    ASSERT_TRUE(relay_start_allowed(300000u, 0u, 300000u, true));
    // After a real OFF edge the minimum off time applies to every relay, wrap-safe.
    ASSERT_FALSE(relay_start_allowed(100000u, 50000u, 180000u, false));
    ASSERT_TRUE(relay_start_allowed(230000u, 50000u, 180000u, false));
    ASSERT_FALSE(relay_start_allowed(1000u, UINT32_MAX - 1000u, 180000u, true));
    ASSERT_TRUE(relay_start_allowed(400000u, 50000u, 300000u, true));
    PASS();
}

// ── 6. Relay starts and fan run seconds across a restart ─────────────────

TEST(relay_counters_count_starts_and_fan_seconds) {
    RelayCounters c{};
    const bool off[kCountedRelays] = {false, false, false, false, false, false};
    bool on[kCountedRelays] = {true, false, true, false, false, true};
    relay_counters_tick(c, off, on, 1000u);  // heat1, fan1, vent start
    ASSERT_EQ(c.starts[0], 1u);
    ASSERT_EQ(c.starts[2], 1u);
    ASSERT_EQ(c.starts[5], 1u);
    ASSERT_EQ(c.starts[1] + c.starts[3] + c.starts[4], 0u);
    ASSERT_EQ(c.fan_run_s[0], 0u);  // fan1 was off over the interval that ended
    for (int i = 0; i < 9; ++i) relay_counters_tick(c, on, on, 250u);
    ASSERT_EQ(c.starts[2], 1u);
    ASSERT_EQ(c.fan_run_s[0], 2u);
    ASSERT_EQ(c.fan_run_ms_carry[0], 250u);
    ASSERT_EQ(c.fan_run_s[1], 0u);
    relay_counters_tick(c, on, off, 750u);  // the last ON interval still counts
    ASSERT_EQ(c.fan_run_s[0], 3u);
    ASSERT_EQ(c.fan_run_ms_carry[0], 0u);
    relay_counters_tick(c, off, on, 1000u);  // a second start
    ASSERT_EQ(c.starts[2], 2u);
    PASS();
}

TEST(relay_counters_are_saved_at_ten_minutes_then_hourly_and_restored) {
    // review-1703 minor 7: the first copy ten minutes after a boot, then at most hourly.
    ASSERT_FALSE(relay_counters_save_due(599999u, 0u, false));
    ASSERT_TRUE(relay_counters_save_due(600000u, 0u, false));
    ASSERT_FALSE(relay_counters_save_due(600000u + 3599999u, 600000u, true));
    ASSERT_TRUE(relay_counters_save_due(600000u + 3600000u, 600000u, true));
    ASSERT_TRUE(relay_counters_save_due(1000u, UINT32_MAX - 3599000u, true));  // wrap-safe
    // The RAM store the loop and the shutdown hook share starts empty and unrestored.
    RelayCounterStore& store = relay_counter_store();
    ASSERT_FALSE(store.restored || store.saved_since_boot);
    const uint32_t saved_starts[kCountedRelays] = {11u, 2u, 30u, 29u, 7u, 41u};
    const uint32_t saved_fans[2] = {86400u, 86000u};
    store.counters = relay_counters_restore(saved_starts, saved_fans);
    store.restored = true;
    RelayCounters& c = relay_counter_store().counters;
    ASSERT_EQ(c.starts[0], 11u);
    ASSERT_EQ(c.starts[5], 41u);
    ASSERT_EQ(c.fan_run_s[1], 86000u);
    ASSERT_EQ(c.fan_run_ms_carry[0], 0u);
    const bool off[kCountedRelays] = {false, false, false, false, false, false};
    const bool on[kCountedRelays] = {false, false, false, true, false, true};
    relay_counters_tick(c, off, on, 1000u);
    relay_counters_tick(c, on, on, 5000u);
    ASSERT_EQ(relay_counter_store().counters.starts[3], 30u);
    ASSERT_EQ(relay_counter_store().counters.fan_run_s[1], 86005u);
    PASS();
}

TEST(fan_lead_balance_survives_a_restart) {
    uint32_t f1 = 0, f2 = 0;
    fan_runtime_for_lead_ms(86400u, 86000u, f1, f2);
    ASSERT_EQ(f1, 400000u);
    ASSERT_EQ(f2, 0u);
    ASSERT_TRUE(choose_runtime_balanced_fan_lead(true, f1, f2, false, false));
    fan_runtime_for_lead_ms(90000u, 86000u, f1, f2);
    ASSERT_FALSE(choose_runtime_balanced_fan_lead(true, f1, f2, false, false));  // fan 2 leads
    fan_runtime_for_lead_ms(4000000000u, 1u, f1, f2);
    ASSERT_EQ(f1, (UINT32_MAX / 1000u) * 1000u);
    ASSERT_EQ(f2, 0u);
    PASS();
}

// ── 7. The sensor bus: one restart rule ────────────────────────────────────

TEST(sensor_bus_restarts_after_an_hour_silent_whatever_the_clock) {
    const uint32_t window = 3600u * 1000u;
    ASSERT_FALSE(sensor_bus_restart_due(3700000u, 100000u, window));
    ASSERT_TRUE(sensor_bus_restart_due(3700001u, 100000u, window));
    // No probe since this boot: counted from the boot, so at most once an hour.
    ASSERT_FALSE(sensor_bus_restart_due(3600000u, 0u, window));
    ASSERT_TRUE(sensor_bus_restart_due(3600001u, 0u, window));
    ASSERT_FALSE(sensor_bus_restart_due(100000000u, 99990000u, window));
    // Across the millis() wrap (review-1703 minor 8): unsigned subtraction.
    ASSERT_FALSE(sensor_bus_restart_due(1000u, UINT32_MAX - 1000u, window));
    ASSERT_TRUE(sensor_bus_restart_due(3600000u, UINT32_MAX - 1000u, window));
    PASS();
}

TEST(doubly_blind_restarts_after_10_minutes_then_every_60) {
    DoublyBlindRestart s;
    bool restarted = false;
    // Not judged yet (boot wait): nothing changes, a set flag stays set.
    ASSERT_FALSE(doubly_blind_restart_step(s, restarted, false, true, 1000u));
    ASSERT_FALSE(s.was_blind);
    // Blind from t = 60 s: due only after 10 minutes of it.
    ASSERT_FALSE(doubly_blind_restart_step(s, restarted, true, true, 60000u));
    ASSERT_FALSE(doubly_blind_restart_step(s, restarted, true, true, 60000u + 600000u));
    ASSERT_TRUE(doubly_blind_restart_step(s, restarted, true, true, 60000u + 600001u));
    ASSERT_TRUE(restarted);
    // After the restart (new state, flag kept): 60 minutes, not 10.
    DoublyBlindRestart after;
    ASSERT_FALSE(doubly_blind_restart_step(after, restarted, false, true, 30000u));  // boot wait keeps the flag
    ASSERT_TRUE(restarted);
    ASSERT_FALSE(doubly_blind_restart_step(after, restarted, true, true, 60000u));
    ASSERT_FALSE(doubly_blind_restart_step(after, restarted, true, true, 60000u + 600001u));
    ASSERT_FALSE(doubly_blind_restart_step(after, restarted, true, true, 60000u + 3600000u));
    ASSERT_TRUE(doubly_blind_restart_step(after, restarted, true, true, 60000u + 3600001u));
    ASSERT_TRUE(restarted);
    // X2: one clear sample keeps the 60-minute window (a flapping reading cannot bring back 10 minutes).
    DoublyBlindRestart again;
    ASSERT_FALSE(doubly_blind_restart_step(again, restarted, true, true, 60000u));
    ASSERT_FALSE(doubly_blind_restart_step(again, restarted, true, false, 120000u));
    ASSERT_TRUE(restarted);
    ASSERT_FALSE(doubly_blind_restart_step(again, restarted, true, true, 180000u));
    ASSERT_FALSE(doubly_blind_restart_step(again, restarted, true, true, 180000u + 600001u));
    ASSERT_TRUE(doubly_blind_restart_step(again, restarted, true, true, 180000u + 3600001u));
    // 60 minutes of continuous clear readings restore the 10-minute window; a blind sample restarts that count.
    DoublyBlindRestart cleared;
    ASSERT_TRUE(restarted);
    ASSERT_FALSE(doubly_blind_restart_step(cleared, restarted, true, false, 0u));
    ASSERT_FALSE(doubly_blind_restart_step(cleared, restarted, true, false, 3000000u));
    ASSERT_FALSE(doubly_blind_restart_step(cleared, restarted, true, true, 3060000u));   // blind: count restarts
    ASSERT_FALSE(doubly_blind_restart_step(cleared, restarted, true, false, 3120000u));
    ASSERT_FALSE(doubly_blind_restart_step(cleared, restarted, true, false, 3120000u + 3599999u));
    ASSERT_TRUE(restarted);
    ASSERT_FALSE(doubly_blind_restart_step(cleared, restarted, true, false, 3120000u + 3600000u));
    ASSERT_FALSE(restarted);
    ASSERT_FALSE(doubly_blind_restart_step(cleared, restarted, true, true, 7000000u));
    ASSERT_TRUE(doubly_blind_restart_step(cleared, restarted, true, true, 7000000u + 600001u));
    // X3: a due restart waits while water runs and is retried at the next tick.
    DoublyBlindRestart wet;
    bool r3 = false;
    ASSERT_FALSE(doubly_blind_restart_step(wet, r3, true, true, 0u));
    ASSERT_FALSE(doubly_blind_restart_step(wet, r3, true, true, 600001u, true));
    ASSERT_FALSE(r3);
    ASSERT_TRUE(doubly_blind_restart_step(wet, r3, true, true, 660001u, false));
    ASSERT_TRUE(r3);
    // Across the millis() wrap.
    DoublyBlindRestart wrap;
    bool r2 = false;
    ASSERT_FALSE(doubly_blind_restart_step(wrap, r2, true, true, UINT32_MAX - 1000u));
    ASSERT_FALSE(doubly_blind_restart_step(wrap, r2, true, true, 598000u));
    ASSERT_TRUE(doubly_blind_restart_step(wrap, r2, true, true, 600000u));
    PASS();
}

TEST(humidity_reading_range) {
    ASSERT_NEAR(humidity_reading_pct(55.0f), 55.0f, 1e-6f);
    ASSERT_NEAR(humidity_reading_pct(0.0f), 0.0f, 1e-6f);
    ASSERT_TRUE(std::isnan(humidity_reading_pct(100.5f)));  // the case probe: no saturation band
    ASSERT_NEAR(humidity_reading_pct(100.5f, WALL_RH_SATURATION_MAX_PCT), 100.0f, 1e-6f);
    ASSERT_TRUE(std::isnan(humidity_reading_pct(NAN)));
    ASSERT_TRUE(std::isnan(humidity_reading_pct(INFINITY, WALL_RH_SATURATION_MAX_PCT)));
    ASSERT_TRUE(indoor_temp_valid(-19.9f) && !indoor_temp_valid(-20.0f) && !indoor_temp_valid(140.0f));
    PASS();
}

// Package 2.4 health readings: per-minute windows, each taken (read and reset) by its own sensor.
TEST(health_minute_low_window) {
    GhMinuteLow w;
    ASSERT_EQ(w.take(40000u), 40000u);  // empty window: the publish-time sample
    w.note(30000u);
    w.note(12000u);
    w.note(35000u);
    ASSERT_EQ(w.take(38000u), 12000u);  // the dip between publishes
    ASSERT_EQ(w.take(38000u), 38000u);  // the next window starts fresh
    w.note(50000u);
    ASSERT_EQ(w.take(20000u), 20000u);  // a lower publish-time sample counts too
    PASS();
}

TEST(health_loop_worst_minute_is_its_own_window) {
    gh_take_control_loop_max_us();
    gh_take_control_loop_minute_max_us();
    gh_take_control_loop_overrun_count();
    gh_record_control_loop_duration_us(9000u);
    gh_record_control_loop_duration_us(260000u);
    gh_record_control_loop_duration_us(12000u);
    ASSERT_EQ(gh_take_control_loop_minute_max_us(), 260000u);
    ASSERT_EQ(gh_take_control_loop_minute_max_us(), 0u);  // reset by the take
    gh_record_control_loop_duration_us(15000u);
    ASSERT_EQ(gh_take_control_loop_minute_max_us(), 15000u);
    ASSERT_EQ(gh_take_control_loop_max_us(), 260000u);  // the 15-minute log window is untouched
    ASSERT_EQ(gh_control_loop_last_us(), 15000u);
    ASSERT_EQ(gh_take_control_loop_overrun_count(), 1u);
    PASS();
}

int main() {
    printf("Running %zu running-alone tests\n", test_registry.size());
    for (const auto& t : test_registry) {
        const int before = tests_failed;
        t.fn();
        if (tests_failed != before) printf("  in test %s\n", t.name);
    }
    printf("\n%d passed, %d failed\n", tests_passed, tests_failed);
    return tests_failed == 0 ? 0 : 1;
}
