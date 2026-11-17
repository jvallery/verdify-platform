#pragma once

// Phase 2 of the climate refactor, "running alone" (epic #1633; #1643, #1638, #1641).
// What the controller does when the network, the clock, a sensor or the outdoor data
// is missing. Pure functions only (plus the one RAM store of section 6): controls.yaml,
// sensors.yaml and greenhouse.yaml call them, and firmware/test/test_running_alone.cpp
// runs them on the host.
//
// The control logic is otherwise today's. Numbers the climate law owns come from its
// generated constants header; the rest are named here.

#include <cmath>
#include <cstdint>

#include "climate_law_constants_generated.h"
#include "greenhouse_solar.h"
#include "greenhouse_types.h"

namespace running_alone_k {
// Subtracted from the case sensor when it is the only indoor reading (RULINGS F2).
constexpr float CASE_SENSOR_OFFSET_F = static_cast<float>(climate_law_k::CASE_SENSOR_OFFSET_F);
// Outdoor data older than this is no outdoor data (station and intake probe alike).
constexpr uint32_t OUTDOOR_MAX_AGE_S = climate_law_k::OUTDOOR_MAX_AGE_S;
// The age reported when there is no outdoor reading at all (today's sentinel).
constexpr uint32_t OUTDOOR_AGE_NONE_S = 99999;
// An indoor probe sample older than this is not used (the wall averages' window).
constexpr uint32_t INDOOR_PROBE_STALE_MS = 300000;
// The indoor temperature range a reading must fall in (sensors_plausible()'s range).
constexpr float INDOOR_TEMP_MIN_F = -20.0f;
constexpr float INDOOR_TEMP_MAX_F = 140.0f;
// An averaged wall humidity above 100 % and up to this is a sensor at saturation and
// reads as 100 % (RULINGS G2). Above it, or below 0 %, there is no humidity reading.
constexpr float WALL_RH_SATURATION_MAX_PCT = 110.0f;
// After a boot the controller waits at most this long for all four wall probes to be in
// the wall readings (F5) before the law runs on what it has, or with no temperature
// enters the state of decision 7 (RULINGS G3).
constexpr uint32_t BOOT_GRACE_MS = 60000;
// The no-indoor-temperature rule leaves the vent branch only below the corridor's low
// edge less this (RULINGS G5).
constexpr float NO_INDOOR_VENT_HYSTERESIS_F = 1.0f;
// Relay counters and fan run seconds: first copy to flash this long after a boot, then
// at most once per interval (review-1703 minor 7; RULINGS G8).
constexpr uint32_t COUNTER_FIRST_SAVE_MS = 600000;
constexpr uint32_t COUNTER_SAVE_INTERVAL_MS = climate_law_k::FAN_RUNTIME_SAVE_INTERVAL_S * 1000u;
}  // namespace running_alone_k

// ── 1. The band's clock and the corridor ──────────────────────────────────
// The band's solar phase is trusted only after an SNTP sync completed since this
// boot (sntp_acquisition_valid(), the predicate the sntp_valid entity publishes). A
// soft reset keeps the ESP32's clock, and a reset can step it, so a retained clock
// is not trusted for the band. Without trust the band is the corridor: the lowest
// and the highest anchor value of each edge, which does not depend on the time.

enum class BandSource : uint8_t { kOnchipCurve, kCorridor, kDispatcherLegacy };

inline BandSource select_band_source(bool onchip_band_enabled, bool clock_trusted) noexcept {
    if (!onchip_band_enabled) return BandSource::kDispatcherLegacy;
    return clock_trusted ? BandSource::kOnchipCurve : BandSource::kCorridor;
}

inline const char* band_source_name(BandSource s) noexcept {
    switch (s) {
        case BandSource::kOnchipCurve: return "onchip_curve";
        case BandSource::kCorridor: return "corridor";
        case BandSource::kDispatcherLegacy: return "dispatcher_legacy";
    }
    return "dispatcher_legacy";
}

inline float anchor_min(const BandAnchors& a) noexcept {
    return std::fmin(std::fmin(a.sr, a.sm), std::fmin(a.ss, a.mid));
}

inline float anchor_max(const BandAnchors& a) noexcept {
    return std::fmax(std::fmax(a.sr, a.sm), std::fmax(a.ss, a.mid));
}

struct BandCorridor {
    float temp_low;
    float temp_target;
    float temp_high;
    float vpd_low;
    float vpd_target;
    float vpd_high;
};

// The widest band the anchors allow. Targets are the corridor's midpoints.
inline BandCorridor band_corridor(const BandAnchors& temp_low, const BandAnchors& temp_high,
                                  const BandAnchors& vpd_low, const BandAnchors& vpd_high) noexcept {
    BandCorridor c{};
    c.temp_low = anchor_min(temp_low);
    c.temp_high = anchor_max(temp_high);
    c.vpd_low = anchor_min(vpd_low);
    c.vpd_high = anchor_max(vpd_high);
    c.temp_target = 0.5f * (c.temp_low + c.temp_high);
    c.vpd_target = 0.5f * (c.vpd_low + c.vpd_high);
    return c;
}

// ── 2. The indoor reading, with no substituted value (#1643, RULINGS G2) ──
// Validity is split. A valid indoor TEMPERATURE is the wall-probe average, else the
// controller-case probe (fresh sample) less the compiled offset; it is all the
// temperature rules and the protection limits need. HUMIDITY is valid only with a
// humidity from the same source: then the VPD and the dew point are computed from that
// source's own temperature and humidity (the case air's own dew point, review-1703 M1).
// A valid temperature without valid humidity keeps temperature control: the reading's
// humidity fields are NaN, the caller marks the reading degraded, and fog, misters and
// drying hold. With no valid temperature every field is NaN and the controller is in
// the state of decision 7 (section 4), after the boot grace (section 5).

enum class IndoorSource : uint8_t { kWall, kCase, kNone };

struct IndoorReading {
    float temp_f;
    float rh_pct;
    float vpd_kpa;
    float dew_point_f;
    IndoorSource source;
    bool humidity_valid;
};

// The controller's own VPD formula (Magnus, b = 237.3; the former controls.yaml vpd_calc).
inline float indoor_vpd_kpa(float temp_f, float rh_pct) noexcept {
    const float tc = (temp_f - 32.0f) * 5.0f / 9.0f;
    const float es = 0.6108f * std::exp((17.27f * tc) / (tc + 237.3f));
    return es * (1.0f - rh_pct / 100.0f);
}

// Dew point (Magnus, b = 237.7), as the controller's outdoor dew point has used.
inline float dew_point_magnus_f(float temp_f, float rh_pct) noexcept {
    if (!std::isfinite(temp_f) || !std::isfinite(rh_pct) || rh_pct <= 0.0f) return NAN;
    const float tc = (temp_f - 32.0f) * (5.0f / 9.0f);
    const float gamma = (17.27f * tc) / (237.7f + tc) + std::log(rh_pct / 100.0f);
    const float dp_c = (237.7f * gamma) / (17.27f - gamma);
    return dp_c * (9.0f / 5.0f) + 32.0f;
}

// An indoor temperature counts only inside the plausibility range.
inline bool indoor_temp_valid(float temp_f) noexcept {
    return std::isfinite(temp_f) && temp_f > running_alone_k::INDOOR_TEMP_MIN_F &&
           temp_f < running_alone_k::INDOOR_TEMP_MAX_F;
}

// A humidity reading in [0, 100] %; up to `saturation_max_pct` reads as 100 % (a sensor
// at saturation); anything else is no reading (NaN).
inline float humidity_reading_pct(float rh_pct, float saturation_max_pct = 100.0f) noexcept {
    if (!std::isfinite(rh_pct) || rh_pct < 0.0f || rh_pct > saturation_max_pct) return NAN;
    return rh_pct > 100.0f ? 100.0f : rh_pct;
}

inline IndoorReading select_indoor_reading(float avg_temp_f, float avg_rh_pct, float avg_vpd_kpa,
                                           float avg_dew_point_f, bool case_fresh, float case_temp_f,
                                           float case_rh_pct,
                                           float case_offset_f = running_alone_k::CASE_SENSOR_OFFSET_F) noexcept {
    if (indoor_temp_valid(avg_temp_f)) {
        const float rh = humidity_reading_pct(avg_rh_pct, running_alone_k::WALL_RH_SATURATION_MAX_PCT);
        if (!std::isfinite(rh)) return {avg_temp_f, NAN, NAN, NAN, IndoorSource::kWall, false};
        // The averages' own VPD and dew point while the humidity is the measured one;
        // computed from the pair when it reads at saturation or they are missing.
        const bool measured = rh == avg_rh_pct;
        const float vpd = measured && std::isfinite(avg_vpd_kpa) ? avg_vpd_kpa : indoor_vpd_kpa(avg_temp_f, rh);
        const float dp = measured && std::isfinite(avg_dew_point_f) ? avg_dew_point_f
                                                                    : dew_point_magnus_f(avg_temp_f, rh);
        return {avg_temp_f, rh, vpd, dp, IndoorSource::kWall, true};
    }
    const float case_t = case_fresh && std::isfinite(case_temp_f) ? case_temp_f - case_offset_f : NAN;
    if (indoor_temp_valid(case_t)) {
        const float rh = humidity_reading_pct(case_rh_pct);
        if (!std::isfinite(rh)) return {case_t, NAN, NAN, NAN, IndoorSource::kCase, false};
        // VPD and dew point from the case probe's own pair (the case air); the
        // temperature the rules see is offset toward the wall probes. The wetting
        // margin, (case - offset) - dew point, is conservative by the offset.
        return {case_t, rh, indoor_vpd_kpa(case_temp_f, rh), dew_point_magnus_f(case_temp_f, rh),
                IndoorSource::kCase, true};
    }
    return {NAN, NAN, NAN, NAN, IndoorSource::kNone, false};
}

// VPD-chasing (humidify, drying, fog for humidity) runs only on the wall averages with
// a valid humidity; anything else is degraded sensing (SensorInputs.sensor_degraded).
inline bool indoor_reading_degraded(const IndoorReading& r) noexcept {
    return r.source != IndoorSource::kWall || !r.humidity_valid;
}

// ── 3. Outdoor data: the station first, the intake probe second ───────────
// Each source has its own age stamp (millis() of its last sample, 0 = none) and the
// same maximum age. A source counts only with a finite temperature and RH.

enum class OutdoorSource : uint8_t { kStation, kIntake, kNone };

struct OutdoorReading {
    float temp_f;
    float rh_pct;
    float dew_point_f;
    uint32_t age_s;
    OutdoorSource source;
};

inline const char* outdoor_source_name(OutdoorSource s) noexcept {
    switch (s) {
        case OutdoorSource::kStation: return "station";
        case OutdoorSource::kIntake: return "intake";
        case OutdoorSource::kNone: return "none";
    }
    return "none";
}

// Wrap-safe age in whole seconds; UINT32_MAX when there has been no sample.
inline uint32_t sample_age_s(uint32_t now_ms, uint32_t last_ms) noexcept {
    if (last_ms == 0) return UINT32_MAX;
    return (now_ms - last_ms) / 1000u;
}

// A stamp older than the maximum age is cleared (0 = no sample), so a source silent for
// 2^32 ms (49.7 days) cannot look fresh again when millis() wraps (review-1703 minor 9).
inline void expire_sample_stamp(uint32_t& last_ms, uint32_t now_ms, uint32_t max_age_ms) noexcept {
    if (last_ms != 0 && (now_ms - last_ms) > max_age_ms) last_ms = 0;
}

inline OutdoorReading select_outdoor_reading(uint32_t now_ms, float station_temp_f, float station_rh_pct,
                                             uint32_t station_last_ms, float intake_temp_f, float intake_rh_pct,
                                             uint32_t intake_last_ms,
                                             uint32_t max_age_s = running_alone_k::OUTDOOR_MAX_AGE_S) noexcept {
    auto usable = [&](float t, float rh, uint32_t last_ms) {
        return std::isfinite(t) && std::isfinite(rh) && sample_age_s(now_ms, last_ms) < max_age_s;
    };
    if (usable(station_temp_f, station_rh_pct, station_last_ms)) {
        return {station_temp_f, station_rh_pct, dew_point_magnus_f(station_temp_f, station_rh_pct),
                sample_age_s(now_ms, station_last_ms), OutdoorSource::kStation};
    }
    if (usable(intake_temp_f, intake_rh_pct, intake_last_ms)) {
        return {intake_temp_f, intake_rh_pct, dew_point_magnus_f(intake_temp_f, intake_rh_pct),
                sample_age_s(now_ms, intake_last_ms), OutdoorSource::kIntake};
    }
    return {NAN, NAN, NAN, running_alone_k::OUTDOOR_AGE_NONE_S, OutdoorSource::kNone};
}

// Outdoor data is fresh for a decision only when it is younger than the maximum age.
inline bool outdoor_data_fresh(uint32_t age_s, uint32_t max_age_s = running_alone_k::OUTDOOR_MAX_AGE_S) noexcept {
    return age_s < max_age_s;
}

// ── 4. No valid indoor temperature: the state of decision 7 (RULINGS B1) ──
// Act on the outdoor temperature against the corridor's low temperature edge (the
// lowest low-edge anchor), with 1.0 F of hysteresis (RULINGS G5): vent open and the
// lead fan on at or above the edge; once venting, back to the electric heater only
// below the edge less 1.0 F (vent closed, the furnace off). No fresh outdoor reading:
// every relay off. The fogger and the misters are off in every branch; the manual
// overrides stay effective (the humidify override without the dew-point margin, G7).

enum class NoIndoorBranch : uint8_t { kVent, kHeat, kOff };

inline NoIndoorBranch no_indoor_branch(float outdoor_temp_f, uint32_t outdoor_age_s, float corridor_temp_low_f,
                                       NoIndoorBranch prev = NoIndoorBranch::kOff,
                                       float hysteresis_f = running_alone_k::NO_INDOOR_VENT_HYSTERESIS_F) noexcept {
    if (!std::isfinite(outdoor_temp_f) || !outdoor_data_fresh(outdoor_age_s) || !std::isfinite(corridor_temp_low_f)) {
        return NoIndoorBranch::kOff;
    }
    const float vent_floor_f = prev == NoIndoorBranch::kVent ? corridor_temp_low_f - hysteresis_f : corridor_temp_low_f;
    return outdoor_temp_f >= vent_floor_f ? NoIndoorBranch::kVent : NoIndoorBranch::kHeat;
}

inline const char* no_indoor_reason(NoIndoorBranch b) noexcept {
    switch (b) {
        case NoIndoorBranch::kVent: return "no_indoor_vent";
        case NoIndoorBranch::kHeat: return "no_indoor_heat";
        case NoIndoorBranch::kOff: return "no_indoor_off";
    }
    return "no_indoor_off";
}

inline RelayOutputs no_indoor_relays(NoIndoorBranch b, bool lead_is_fan1) noexcept {
    RelayOutputs r{false, false, false, false, false, false};
    if (b == NoIndoorBranch::kVent) {
        r.vent = true;
        r.fan1 = lead_is_fan1;
        r.fan2 = !lead_is_fan1;
    } else if (b == NoIndoorBranch::kHeat) {
        r.heat1 = true;
    }
    return r;
}

// ── 5. The boot and the relays at boot ────────────────────────────────────
// Boot grace (RULINGS G3, F5): after a boot the controller waits until every wall
// probe has reported into the wall averages once, at most BOOT_GRACE_MS. While it waits
// no climate relay is switched, the mode is not a sensor fault (so the irrigation engine
// sees none) and no alert is raised. The first probes on the bus are not the house: on
// 2026-11-17 the law dried on north and west (0.82 kPa) while the four-wall average was
// 0.96 to 0.98 kPa. When the grace runs out with a probe still silent, the law runs on
// the probes it has (the averages of whatever is fresh, as after the grace); with no
// temperature at all it is the state of decision 7. After the grace nothing changes.

enum class IndoorGate : uint8_t { kRun, kBootWait, kNoIndoor };

struct BootGrace {
    bool over;
};

// `walls_complete`: every wall reading the law uses (the three averages and the dew
// point) was last computed over all four wall probes (controls.yaml: wall_avgs_full 15).
inline IndoorGate indoor_gate(BootGrace& grace, bool temp_valid, bool walls_complete, uint32_t now_ms,
                              uint32_t grace_ms = running_alone_k::BOOT_GRACE_MS) noexcept {
    if ((temp_valid && walls_complete) || now_ms >= grace_ms) grace.over = true;
    if (!grace.over) return IndoorGate::kBootWait;
    return temp_valid ? IndoorGate::kRun : IndoorGate::kNoIndoor;
}

// A relay that has not switched since this boot (stamp 0) is available at once: the
// minimum times measure from a real edge, never from the boot.
inline bool relay_dwell_elapsed(uint32_t now_ms, uint32_t edge_ms, uint32_t min_ms) noexcept {
    return edge_ms == 0 || (now_ms - edge_ms) >= min_ms;
}

// The one exception (RULINGS G4): the furnace waits one minimum off time after ANY
// boot, so a crash loop cannot cycle it. `waits_after_boot` is true for the furnace
// only. (A furnace that has not run for 49.7 days waits once more when millis() wraps.)
inline bool relay_start_allowed(uint32_t now_ms, uint32_t last_off_ms, uint32_t min_off_ms,
                                bool waits_after_boot) noexcept {
    if (last_off_ms == 0) return !waits_after_boot || now_ms >= min_off_ms;
    return (now_ms - last_off_ms) >= min_off_ms;
}

// ── 6. Relay starts and fan run seconds, kept across a restart ────────────
// Lifetime counters (never reset at midnight), kept in RAM, copied to the restore_value
// globals ten minutes after a boot, then at most once an hour, and on a planned
// shutdown (greenhouse.yaml on_shutdown), and restored at boot. Index order: heat1,
// heat2, fan1, fan2, fog, vent.

constexpr int kCountedRelays = 6;
constexpr int kFan1Index = 2;
constexpr int kFan2Index = 3;

struct RelayCounters {
    uint32_t starts[kCountedRelays];
    uint32_t fan_run_s[2];
    uint32_t fan_run_ms_carry[2];
};

// The RAM copy, shared by the control loop and the shutdown hook.
struct RelayCounterStore {
    RelayCounters counters;
    bool restored;
    bool saved_since_boot;
    uint32_t last_save_ms;
};

inline RelayCounterStore& relay_counter_store() noexcept {
    static RelayCounterStore store{};
    return store;
}

inline RelayCounters relay_counters_restore(const uint32_t saved_starts[kCountedRelays],
                                            const uint32_t saved_fan_run_s[2]) noexcept {
    RelayCounters c{};
    for (int i = 0; i < kCountedRelays; ++i) c.starts[i] = saved_starts[i];
    c.fan_run_s[0] = saved_fan_run_s[0];
    c.fan_run_s[1] = saved_fan_run_s[1];
    return c;
}

// One control tick. `was_on` is each relay before this tick's apply (its state over the
// interval just ended, `dt_ms` long); `is_on` after it. A start is an OFF-to-ON edge.
inline void relay_counters_tick(RelayCounters& c, const bool was_on[kCountedRelays],
                                const bool is_on[kCountedRelays], uint32_t dt_ms) noexcept {
    for (int i = 0; i < kCountedRelays; ++i) {
        if (!was_on[i] && is_on[i] && c.starts[i] != UINT32_MAX) c.starts[i] += 1;
    }
    const int fans[2] = {kFan1Index, kFan2Index};
    for (int f = 0; f < 2; ++f) {
        if (!was_on[fans[f]]) continue;
        const uint32_t ms = c.fan_run_ms_carry[f] + dt_ms;
        const uint32_t add_s = ms / 1000u;
        c.fan_run_ms_carry[f] = ms % 1000u;
        c.fan_run_s[f] = (UINT32_MAX - c.fan_run_s[f] < add_s) ? UINT32_MAX : c.fan_run_s[f] + add_s;
    }
}

// The flash copy is due COUNTER_FIRST_SAVE_MS after the boot, then once a full interval
// has passed since the last copy.
inline bool relay_counters_save_due(uint32_t now_ms, uint32_t last_save_ms, bool saved_since_boot,
                                    uint32_t first_ms = running_alone_k::COUNTER_FIRST_SAVE_MS,
                                    uint32_t interval_ms = running_alone_k::COUNTER_SAVE_INTERVAL_MS) noexcept {
    if (!saved_since_boot) return now_ms >= first_ms;
    return (now_ms - last_save_ms) >= interval_ms;
}

// Today's lead-fan chooser compares run times inside a deadband. It is given the two
// lifetime run times as milliseconds above the smaller one, so the comparison survives
// a restart and the milliseconds cannot overflow.
inline void fan_runtime_for_lead_ms(uint32_t fan1_run_s, uint32_t fan2_run_s, uint32_t& fan1_ms,
                                    uint32_t& fan2_ms) noexcept {
    const uint32_t base = fan1_run_s < fan2_run_s ? fan1_run_s : fan2_run_s;
    const uint32_t d1 = fan1_run_s - base;
    const uint32_t d2 = fan2_run_s - base;
    constexpr uint32_t kMaxS = UINT32_MAX / 1000u;
    fan1_ms = (d1 > kMaxS ? kMaxS : d1) * 1000u;
    fan2_ms = (d2 > kMaxS ? kMaxS : d2) * 1000u;
}

// ── 7. The sensor bus: one restart rule ────────────────────────────────────
// Restart when no probe on the bus has answered for more than `window_ms`, counted from
// the last answer (a millis() stamp) or, with none since this boot (stamp 0), from the
// boot. Unsigned subtraction keeps it right across the millis() wrap. Independent of
// the clock, and so at most once per window.
inline bool sensor_bus_restart_due(uint32_t now_ms, uint32_t last_probe_ms, uint32_t window_ms) noexcept {
    return (now_ms - last_probe_ms) > window_ms;
}

// Doubly blind (RULINGS Q2, ratified U1; contracts last-resort-thermometer): no valid indoor temperature AND no
// outdoor reading, so every climate relay is already off and a restart costs no control. Restart after 10 minutes
// of it the first time, then wait 60 minutes between restarts while it lasts (`restarted_before` is a restore_value
// flag kept across the restart, so restarts and flash writes stay bounded). X2: the flag clears only after 60
// minutes of continuous readings (a blind sample restarts that count), so a flapping reading cannot bring back the
// 10-minute window. X3: a due restart waits while a wet relay is open or an irrigation run is active (`water_busy`)
// and is retried at the next tick. `evaluated` is false until the control loop has judged the state after boot (the
// boot wait), and an unjudged pass changes nothing. These two windows are named here, outside the generated
// constants file, so the frozen CONSTANTS_SHA256 the host release carries does not move.
// DOUBLY_BLIND_FAST_RESTART is the one line to take out: false restores the plain sensor-bus rule above.
constexpr bool DOUBLY_BLIND_FAST_RESTART = true;
constexpr uint32_t DOUBLY_BLIND_FIRST_RESTART_MS = 10u * 60u * 1000u;
constexpr uint32_t DOUBLY_BLIND_REPEAT_RESTART_MS = 60u * 60u * 1000u;

struct DoublyBlindRestart {
    bool was_blind = false;
    uint32_t since_ms = 0;
    bool clearing = false;     // not blind, counting toward clearing the flag
    uint32_t clear_since_ms = 0;
};

inline bool doubly_blind_restart_step(DoublyBlindRestart& s, bool& restarted_before, bool evaluated, bool blind,
                                      uint32_t now_ms, bool water_busy = false) noexcept {
    if (!DOUBLY_BLIND_FAST_RESTART || !evaluated) return false;
    if (!blind) {
        s.was_blind = false;
        if (!s.clearing) {
            s.clearing = true;
            s.clear_since_ms = now_ms;
        }
        if (restarted_before && now_ms - s.clear_since_ms >= DOUBLY_BLIND_REPEAT_RESTART_MS) restarted_before = false;
        return false;
    }
    s.clearing = false;
    if (!s.was_blind) {
        s.was_blind = true;
        s.since_ms = now_ms;
    }
    const uint32_t window = restarted_before ? DOUBLY_BLIND_REPEAT_RESTART_MS : DOUBLY_BLIND_FIRST_RESTART_MS;
    if ((now_ms - s.since_ms) <= window) return false;
    if (water_busy) return false;  // X3: retried at the next tick
    restarted_before = true;
    return true;
}
