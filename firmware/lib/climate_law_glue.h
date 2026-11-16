#pragma once
/*
 * climate_law_glue.h: the controller's glue between the band-edge law (climate_law.h) and the phase 2 consumers
 * (greenhouse_logic.h: the manual override layer, the fog rails, the effective-state telemetry). It holds no law number,
 * so it sits outside the literal gate; it exists so the host tests run the same glue the controller runs (RULINGS T1,
 * T3, T4, T6 S2/S3).
 */

#include <cmath>
#include <cstring>

#include "climate_law.h"
#include "greenhouse_logic.h"

namespace climate_law {

// T1: at a protection limit (100 F hot, 40 F cold) the FANS and VENT-BYPASS latches are cleared, so the override and
// the protection never fight at a limit crossing (the override is cleared at the limits, not merely ignored).
inline bool protection_clears_latches(const Output& law) noexcept { return law.hot || law.cold; }

// X4: the clear itself, on the controller's latch deadlines (millis() stamps, 0 = not latched). Returns true when it
// cleared a latch that was set, so the caller logs once per clear.
inline bool clear_latches_at_protection(const Output& law, uint32_t& fans_until_ms, uint32_t& bypass_until_ms) noexcept {
    if (!protection_clears_latches(law) || (fans_until_ms == 0 && bypass_until_ms == 0)) return false;
    fans_until_ms = 0;
    bypass_until_ms = 0;
    return true;
}

struct RelayPass {
    RelayOutputs out;   // what the drivers switch to this pass
    ManualForce force;  // what the override layer forced
};

// One pass of the relay layer and the override layer on its result (wiring note 4; B1, G7):
// - S2: the relay layer first follows what is physically on (an OTA on_begin close, anything outside the loop), so a
//   relay switched off elsewhere keeps its minimum off time instead of being switched back on at once;
// - relay_step(): minimum times, interlocks, the lead fan (published from RelayState::lead_fan1), G1/G4;
// - apply_manual_overrides(): FANS, VENT-BYPASS, HUMID (a no-op in SAFETY_COOL/SAFETY_HEAT, effective in
//   SENSOR_FAULT);
// - the interlocks over the result (RULINGS AE10, AG3): no heater with a manual fan run (FANS or VENT-BYPASS stops
//   the electric heater as well as the furnace, as the phase 2 build did); the electric heater does not start into,
//   and is cut at once by, an open vent or a running fan, except the law's own drying and the 40 F protection (at
//   40 F the override is a no-op, T1 has cleared the latch and the relay layer has stopped the air, so the
//   protection heats); AG3a: the drying run's own air tail counts as drying; the furnace never with the air; the
//   fog holds win.
// A cut is not a start: a heater the relay layer would have started this pass and an interlock holds off keeps the
// relay layer's state from before the pass (its off time keeps counting), so a held start moves no switch time, no
// counter and no physical relay.
// The caller switches the drivers to `out`, then calls relay_sync() again with the physical states.
namespace detail {
inline void undo_held_start(Relay& r, const Relay& before, bool physical_on, bool out_on, uint32_t dt_ms) noexcept {
    if (r.on && !physical_on && !out_on) {
        r = before;
        relay_tick(r, dt_ms);
    }
}
}  // namespace detail

inline RelayPass relay_pass(RelayState& r, const Output& request, const RelayInputs& in, const RelayOutputs& physical,
                            const ManualOverrides& ov, Mode mode) noexcept {
    relay_sync(r, physical);
    const Relay heat1_before = r.heat1, heat2_before = r.heat2;
    relay_step(r, request, in);
    RelayPass p{{r.heat1.on, r.heat2.on, r.fan1.on, r.fan2.on, r.fog.on, r.vent.on}, {false, false, false}};
    p.force = apply_manual_overrides(p.out, ov, mode);
    const bool air = p.out.vent || p.out.fan1 || p.out.fan2;
    // AG3a: the drying run's own air tail (its vent and fan finishing their minimum on after the run stops) keeps the
    // electric heater as the run did: no cut and no minimum-off stamp. The mark is set while the run asks for the
    // air and cleared when the air is off or something else asks for it (cooling, the no-indoor table, a press).
    if (request.drying && air) r.drying_air = true;
    else if (!air || p.force.fans || (!request.drying && (request.vent || request.fans > 0))) r.drying_air = false;
    if (p.force.fans) p.out.heat1 = p.out.heat2 = false;
    // A start also waits for the physical air (review AG3-1): the drivers switch heat1 before the vent, so a vent
    // the relay layer closes this pass is still open when heat1 would start; phase 2 held heat one more pass.
    const bool air_phys = physical.vent || physical.fan1 || physical.fan2;
    if (p.out.heat1 && (air || (!physical.heat1 && air_phys)) && !request.drying && !request.cold && !r.drying_air)
        p.out.heat1 = false;
    if (p.out.heat2 && air) p.out.heat2 = false;
    detail::undo_held_start(r.heat1, heat1_before, physical.heat1, p.out.heat1, in.dt_ms);
    detail::undo_held_start(r.heat2, heat2_before, physical.heat2, p.out.heat2, in.dt_ms);
    if (in.fog_hold) p.out.fog = false;
    return p;
}

// RULINGS AG1 (plan 4.2): the law's humidity rules (5 fog, 6 misters, 7 drying) run only on the wall averages with a
// valid humidity; on the case sensor they hold and rules 1 to 4, 8 and 9 run. No exception at 100 F: the
// protection's vent and fans run, the law's fog does not. The HUMID press and the centre bursts keep reading
// indoor.humidity_valid (the case dew point, G2).
inline bool law_humidity_valid(bool law_temp_valid, const IndoorReading& indoor) noexcept {
    return law_temp_valid && indoor.humidity_valid && !indoor_reading_degraded(indoor);
}

// The HUMID press's (and the fog run-once's) safety block (wiring note 4, T7 items 2 and 3, G7; AG1): the compiled
// wetting dew margin on the indoor reading's own humidity (the case sensor's too: G2), skipped with no humidity
// reading; then the law's cold-house guard (below the checked band's low edge), skipped with no temperature.
inline const char* humid_press_block(bool law_temp_valid, const IndoorReading& indoor, double band_low) noexcept {
    if (law_temp_valid && indoor.humidity_valid && indoor.temp_f - indoor.dew_point_f < WET_DEW_MARGIN_F)
        return "dew_margin";
    if (law_temp_valid && indoor.temp_f < band_low) return "temp_low";
    return "";
}

// RULINGS AG2: the law's own fog keeps the phase 2 dew-point margin: outside SENSOR_FAULT it is dropped while the
// indoor temperature minus the dew point is under WET_DEW_MARGIN_F (the misters' zone gate margin); no reading is no
// margin. The caller drops law_request.fog before relay_pass() and feeds the same request to climate_fog_wanted().
inline bool law_fog_dew_margin_ok(Mode mode, double temp_f, double dew_point_f) noexcept {
    return mode == SENSOR_FAULT || (temp_f - dew_point_f >= WET_DEW_MARGIN_F);
}

// The fog_block_reason ladder's last rungs (after the rails, the press's safety block and `served`): the law's fog
// waiting the fogger's minimum off time, the law's fog held by the dew-point margin (RULINGS AG2; phase 2's word), or
// no fog asked for. `request_fog` is the gated law_request.fog.
inline const char* law_fog_wait_word(bool law_fog, bool request_fog) noexcept {
    if (request_fog) return "relay_min_off";
    if (law_fog) return "dew_margin";
    return "none";
}

// T4 (ruling C2): the irrigation engine's climate fog demand keeps today's terms: the law's fog request OR a HUMID
// press / fog run-once the override layer forced (apply_manual_overrides already honours the safety block and the
// protection limits), held back only by the rails other than the drips, and today's clock term.
inline bool climate_fog_wanted(const Output& law, const ManualForce& force, bool rails_but_drips_force_off,
                               bool wall_clock_valid) noexcept {
    return (law.fog || force.fog) && !rails_but_drips_force_off && wall_clock_valid;
}

// T3 (F3, C-M1, E-M1, E-M2): the decision telemetry is the law's. The published label: legacy_state() of the relays,
// IDLE during the boot grace (the mode stays IDLE there, G3).
inline LegacyState published_label(const LegacyState& legacy, bool boot_wait) noexcept {
    if (boot_wait) return {IDLE, MIST_WATCH, CLIMATE_IDLE, CLIMATE_PRIORITY_RESOURCE};
    return legacy;
}

// climate_fog_block_reason: the fog_block_reason ladder's word, except `none` while the fogger runs (contract
// phase3-wiring section 7; the climate vocabulary never had `served`).
inline const char* climate_fog_block_word(const char* ladder) noexcept {
    return (ladder[0] == 's' && std::strcmp(ladder, "served") == 0) ? "none" : ladder;
}

// The decision fields published on the climate_* entities, from the law: the action and axis of the label (so vent +
// fog is VENT_COOL_FOG_ASSIST and vent + mister VENT_COOL_MIST_ASSIST, IDLE with heat keyed on the physical
// relays), the summary and cost of that action, the fog margin against the law's fog threshold, the moisture
// exchange from the law's drying run (a = vent_dehum while it runs, r = its refusal, of = the law's outdoor
// validity; the mode machine's projections publish their neutral values).
inline ClimateActionDecision describe_law_decision(const LegacyState& label, const SensorInputs& in, const Setpoints& sp,
                                                   const Output& law, const Band& band, bool out_ok,
                                                   const char* fog_ladder_word) noexcept {
    // X1: no mode-machine state: the fields it fed (assist state, next mist, heat assist) are the law's below or
    // published by the caller from moisture_assist().
    const ControlState neutral = initial_state();  // on the stack: no static RAM (U3)
    ClimateActionDecision d = describe_climate_decision_for_action(label.action, label.axis, in, sp, neutral);
    d.fog_margin_kpa = std::isfinite(in.vpd_kpa) ? float(in.vpd_kpa - (band.vpd_high + FOG_ON_ABOVE_VPD_HIGH_KPA))
                                                 : 0.0f;
    d.fog_block_reason = climate_fog_block_word(fog_ladder_word);
    const unsigned dr = unsigned(law.dry_refusal);
    d.moisture_exchange_action = law.drying ? "vent_dehum" : "none";
    d.moisture_exchange_reason =
        dr < sizeof(DRY_REFUSAL_NAMES) / sizeof(DRY_REFUSAL_NAMES[0]) ? DRY_REFUSAL_NAMES[dr] : "none";
    d.moisture_vent_vpd_gain_kpa = 0.0f;
    d.moisture_vent_held_vpd_gain_kpa = 0.0f;
    d.moisture_heat_vpd_gain_kpa = 0.0f;
    d.moisture_outdoor_fresh = out_ok;
    d.moisture_vent_overcools = false;
    d.moisture_heat_assist_corun = false;
    d.moisture_hold_required = false;
    d.moisture_heat_assist_active = false;
    d.moisture_heat_assist_timer_ms = 0;
    return d;
}

// X1 (P1): climate_moisture_assist_state, climate_moisture_zone and climate_next_mist_eligible_s from the law and
// mister_step: a mister relay on is pulse_on in its zone, next 0; the law misting with the train in its gap is
// pulse_gap, next = the gap left; the law misting otherwise (a hold, no grant, a minimum off time) is blocked; no
// mist request is inactive. `zone` is the phase 2 telemetry name of the open line.
struct MoistureAssist {
    const char* state;
    const char* zone;
    float next_mist_s;  // -1 = none
};
inline MoistureAssist moisture_assist(bool law_mist, bool mister_on, const char* zone, const MisterState& m) noexcept {
    if (mister_on) return {"pulse_on", zone, 0.0f};
    if (law_mist && m.phase == MISTER_GAP) return {"pulse_gap", "none", float(m.timer_ms) / float(MS_PER_S)};
    if (law_mist) return {"blocked", "none", -1.0f};
    return {"inactive", "none", -1.0f};
}

// X6 (P3): vent_mist_assist_status keyed on the published label: an assist label (vent with fog or a mister on) is
// served; the vent open with a wet request and nothing wet on is blocked (the caller appends the reason); else
// inactive.
enum class VentAssistStatus : uint8_t { kInactive, kServed, kBlocked };
inline VentAssistStatus vent_assist_status(const LegacyState& label, bool vent_on, const Output& law,
                                           bool wet_on) noexcept {
    if (label.action == CLIMATE_VENT_COOL_FOG_ASSIST || label.action == CLIMATE_VENT_COOL_MIST_ASSIST)
        return VentAssistStatus::kServed;
    if (vent_on && (law.mist || law.fog) && !wet_on) return VentAssistStatus::kBlocked;
    return VentAssistStatus::kInactive;
}

// X8/P8: the climate_law_state publish decision: nothing during the boot grace; the first record; a changed record
// at most every 5 s; the 60 s heartbeat (an unchanged record still reaches the host).
constexpr uint32_t LAW_RECORD_MIN_CHANGE_MS = 5000;
constexpr uint32_t LAW_RECORD_HEARTBEAT_MS = 60000;
inline bool law_record_due(bool boot_wait, bool sent, bool changed, uint32_t now_ms, uint32_t last_ms) noexcept {
    if (boot_wait) return false;
    if (!sent) return true;
    const uint32_t age = now_ms - last_ms;
    return (changed && age >= LAW_RECORD_MIN_CHANGE_MS) || age >= LAW_RECORD_HEARTBEAT_MS;
}

}  // namespace climate_law
