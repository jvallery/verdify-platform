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
// - the interlocks over a press: the furnace never with the air; the fog holds win.
// The caller switches the drivers to `out`, then calls relay_sync() again with the physical states.
inline RelayPass relay_pass(RelayState& r, const Output& request, const RelayInputs& in, const RelayOutputs& physical,
                            const ManualOverrides& ov, Mode mode) noexcept {
    relay_sync(r, physical);
    relay_step(r, request, in);
    RelayPass p{{r.heat1.on, r.heat2.on, r.fan1.on, r.fan2.on, r.fog.on, r.vent.on}, {false, false, false}};
    p.force = apply_manual_overrides(p.out, ov, mode);
    if (p.out.heat2 && (p.out.vent || p.out.fan1 || p.out.fan2)) p.out.heat2 = false;
    if (in.fog_hold) p.out.fog = false;
    return p;
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
                                                   const ControlState& state, const Output& law, const Band& band,
                                                   bool out_ok, const char* fog_ladder_word) noexcept {
    ClimateActionDecision d = describe_climate_decision_for_action(label.action, label.axis, in, sp, state);
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

}  // namespace climate_law
