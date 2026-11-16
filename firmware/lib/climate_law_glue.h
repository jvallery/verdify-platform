#pragma once
/*
 * climate_law_glue.h: the controller's glue between the band-edge law (climate_law.h) and the phase 2 consumers
 * (greenhouse_logic.h: the manual override layer, the fog rails, the effective-state telemetry). It holds no law number,
 * so it sits outside the literal gate; it exists so the host tests run the same glue the controller runs (RULINGS T1,
 * T3, T4, T6 S2/S3).
 */

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

}  // namespace climate_law
