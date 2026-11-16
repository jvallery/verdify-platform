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

// T1, AD1: at a protection limit (100 F hot, 40 F cold) every manual latch (the fans, whichever vent state, and the
// fogger) is cleared, so a press and the protection never fight at a limit crossing (the latch is cleared at the
// limits, not merely ignored).
inline bool protection_clears_latches(const Output& law) noexcept { return law.hot || law.cold; }

// X4: the clear itself, on the controller's latch deadlines (millis() stamps, 0 = not latched). Returns true when it
// cleared a latch that was set, so the caller logs once per clear.
inline bool clear_latches_at_protection(const Output& law, uint32_t& fans_until_ms, uint32_t& fog_until_ms) noexcept {
    if (!protection_clears_latches(law) || (fans_until_ms == 0 && fog_until_ms == 0)) return false;
    fans_until_ms = 0;
    fog_until_ms = 0;
    return true;
}

struct RelayPass {
    RelayOutputs out;   // what the drivers switch to this pass
    ManualForce force;  // what the manual latches forced (force.fog: a fogger press asks, before its holds)
    bool run_once;      // a fog run-once of the irrigation engine asks for fog (outside the limits, before the holds)
};

// One pass of the relay layer and the manual runs on its result (wiring note 4; B1, G7; AB12/AD1):
// - S2: the relay layer first follows what is physically on (an OTA on_begin close, anything outside the loop), so a
//   relay switched off elsewhere keeps its minimum off time instead of being switched back on at once;
// - relay_step(): minimum times, interlocks, the lead fan (published from RelayState::lead_fan1), G1/G4;
// - a manual run that ended this pass (timeout, second press, clear, a limit) stops what it ran at once, unless the
//   law asks for that air or fog (the relay layer then carries it on);
// - apply_manual_overrides(): the fan latch (vent open or closed) and the fogger latch (a no-op in
//   SAFETY_COOL/SAFETY_HEAT, effective in SENSOR_FAULT); a vent the latch keeps closed keeps its off time (E-m2);
// - a fog run-once, apart from the latches;
// - the interlocks over the result (RULINGS AE10, AG3): no heater with a manual fan run (the fan latch, vent open or
//   closed, stops the electric heater as well as the furnace, as the phase 2 build did); the electric heater does
//   not start into, and is cut at once by, an open vent or a running fan, except the law's own drying and the 40 F
//   protection (at 40 F the override is a no-op, T1 has cleared the latch and the relay layer has stopped the air,
//   so the protection heats); AG3a: the drying run's own air tail counts as drying; the furnace never with the air;
//   the fog holds (the law's for the law's fog and a run-once, a press's own, manual_fog_hold_reason(), for a press).
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
                            const ManualOverrides& ov, bool fog_run_once, Mode mode) noexcept {
    relay_sync(r, physical);
    const Relay heat1_before = r.heat1, heat2_before = r.heat2, vent_before = r.vent;
    relay_step(r, request, in);
    // AB12 (note section 3): an end stops the run's relays at once, past their minimum on times, as a press starts
    // them past their minimum off times.
    if (ov.fans_ended && request.fans == 0 && !request.vent) {
        for (Relay* x : {&r.fan1, &r.fan2, &r.vent}) detail::relay_set(*x, false, false, true, 0, 0);
    }
    if (ov.fog_ended && !request.fog) detail::relay_set(r.fog, false, false, true, 0, 0);
    RelayPass p{{r.heat1.on, r.heat2.on, r.fan1.on, r.fan2.on, r.fog.on, r.vent.on}, {false, false, false}, false};
    p.force = apply_manual_overrides(p.out, ov, mode);
    // E-m2: a fan latch with the vent closed runs the fans with the vent closed; the relay layer opens the vent for
    // those fans every pass and the latch closes it again. The vent never moved, so it keeps its off time (relay_sync
    // would otherwise restart it every pass, and cooling would wait up to the vent's minimum off time after the latch
    // ends).
    if (!vent_before.on && r.vent.on && !p.out.vent) {
        r.vent = vent_before;
        detail::relay_tick(r.vent, in.dt_ms);
    }
    // #1343 follow-up, apart from the latches (AD1): a fog run-once fogs while the engine asks, past the fogger's
    // minimum off time, under every fog hold of the law (in.fog_hold: SENSOR_FAULT's lock, occupancy, SAF-5, the
    // drips, the soft budget, SAF-4) and no climate check; a no-op at the protection limits.
    p.run_once = fog_run_once && mode != SAFETY_COOL && mode != SAFETY_HEAT;
    if (p.run_once) p.out.fog = true;
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
    const bool press_fogs = p.force.fog && !ov.fog_held;
    if (in.fog_hold && !press_fogs) p.out.fog = false;
    return p;
}

// RULINGS AG1 (plan 4.2): the law's humidity rules (5 fog, 6 misters, 7 drying) run only on the wall averages with a
// valid humidity; on the case sensor they hold and rules 1 to 4, 8 and 9 run. No exception at 100 F: the
// protection's vent and fans run, the law's fog does not. A fogger press reads no humidity (AD1); the centre bursts
// keep reading indoor.humidity_valid (the case dew point, G2).
inline bool law_humidity_valid(bool law_temp_valid, const IndoorReading& indoor) noexcept {
    return law_temp_valid && indoor.humidity_valid && !indoor_reading_degraded(indoor);
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

// X8 (MINOR-3): the no-indoor-temperature table (decision 7) as the relay layer's request: vent with one fan, or the
// electric heater, or nothing. The fan is a count; relay_step() picks the lead (alternating, AB8), so the request is
// not built from a lead read before the relay layer has chosen it this pass.
inline Output no_indoor_request(NoIndoorBranch b) noexcept {
    Output q;
    q.vent = b == NoIndoorBranch::kVent;
    q.fans = q.vent ? 1 : 0;
    q.heat1 = b == NoIndoorBranch::kHeat;
    return q;
}

// T4 (ruling C2), AD1: the irrigation engine's climate fog demand, the fog the climate path wants that only a drip
// holds back: the law's fog request or a fog run-once, held by the law's rails other than the drips; or a fogger
// press (ManualForce.fog), held by a press's holds other than the drips (SAF-5, SAF-4); and today's clock term.
inline bool climate_fog_wanted(bool law_or_run_once_fog, bool law_rails_but_drips_force_off, bool press_fog,
                               bool press_holds_but_drips, bool wall_clock_valid) noexcept {
    return ((law_or_run_once_fog && !law_rails_but_drips_force_off) || (press_fog && !press_holds_but_drips)) &&
           wall_clock_valid;
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

// The decision fields published on the climate_* entities, from the law alone (package 4.3: no Setpoints, no mode
// machine state): the action and axis of the label (so vent + fog is VENT_COOL_FOG_ASSIST and vent + mister
// VENT_COOL_MIST_ASSIST, IDLE with heat keyed on the physical relays), the band errors against the band the law used,
// the summary and cost of that action, the fog margin against the law's fog threshold, the moisture exchange from the
// law's drying run (a = vent_dehum while it runs, r = its refusal, of = the law's outdoor validity). The assist state,
// zone and next mist are the caller's, from moisture_assist(); the old projections publish their neutral values.
inline ClimateActionDecision describe_law_decision(const LegacyState& label, const SensorInputs& in, const Output& law,
                                                   const Band& band, bool out_ok,
                                                   const char* fog_ladder_word) noexcept {
    ClimateActionDecision d{};
    d.climate_action = label.action;
    d.priority_axis = label.axis;
    d.temp_error_f = climate_band_error(in.temp_f, float(band.low), float(band.high));
    d.vpd_error_kpa = std::isfinite(in.vpd_kpa) ? climate_band_error(in.vpd_kpa, float(band.vpd_low), float(band.vpd_high))
                                                : 0.0f;  // RULINGS G2: no humidity, no VPD error
    d.candidate_summary = climate_summary_for_action(label.action);
    d.moisture_assist_state = CLIMATE_MOISTURE_INACTIVE;
    d.moisture_zone = CLIMATE_ZONE_NONE;
    d.next_mist_eligible_s = -1.0f;
    d.fog_margin_kpa = std::isfinite(in.vpd_kpa) ? float(in.vpd_kpa - (band.vpd_high + FOG_ON_ABOVE_VPD_HIGH_KPA))
                                                 : 0.0f;
    d.fog_block_reason = climate_fog_block_word(fog_ladder_word);
    d.resource_cost_estimate = climate_resource_estimate(label.action);
    const unsigned dr = unsigned(law.dry_refusal);
    d.moisture_exchange_action = law.drying ? "vent_dehum" : "none";
    d.moisture_exchange_reason =
        dr < sizeof(DRY_REFUSAL_NAMES) / sizeof(DRY_REFUSAL_NAMES[0]) ? DRY_REFUSAL_NAMES[dr] : "none";
    d.moisture_outdoor_fresh = out_ok;
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
