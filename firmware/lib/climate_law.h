#pragma once
/*
 * climate_law.h: the band-edge climate law (docs/design/climate-refactor-plan-2026-11-15.md, section 4 and
 * appendix A; issue #1671).
 *
 * The law is the reference implementation docs/reviews/control-review-2026-11-15/sim/band_edge_controller.h with
 * its study options removed. Every number comes from climate_law_constants_generated.h (generated from
 * verdify_schemas/climate_law.yaml); CI fails on a numeric literal in this file other than 0, 1 or 2.
 * firmware/test/test_climate_law.cpp runs this law and the reference over one vector set and requires identical
 * outputs, and the closed-loop simulation in CI (firmware/test/climate_law_sim.py, the validate-containment-firmware part) runs
 * both through a whole year and compares the per-minute relay trajectory.
 *
 * Pure functions over plain structs. No ESPHome type, no clock, no hour, season or zone branch.
 *
 *   check_band()        the controller's band check (section 4.1)
 *   step_checked()      check_band() then step(): the only entry the controller uses
 *   step()              rules 1 to 9: nine latches and the requests (section 4.2), on a band already checked
 *   relay_step()        the relay layer (section 4.3) and the lead fan (section 4.7)
 *   mister_step()       the pulse request to the irrigation engine (section 4.8, rulings B3, B4)
 *   legacy_state()      the mode / action / axis labels the host still reads (section 11.1)
 *   the engine inputs   section 8.7 with ruling C2
 *   DryingMeter         the drying meter of section 4.5
 *   latch_bits(), request_bits()  the state record's bit masks (climate_law_payload.h formats the payloads)
 */

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <limits>

#include "climate_law_constants_generated.h"
#include "greenhouse_solar.h"
#include "greenhouse_types.h"
#include "irrigation_program.h"

namespace climate_law {

using namespace climate_law_k;

// -- The band now (F and kPa) ------------------------------------------------
struct Band {
    double low, high, vpd_low, vpd_high;
};

// -- Section 4.1: the controller's band check -------------------------------
// Clamps each edge to the editor's limits, then widens a band narrower than the law's two minimum widths about its
// middle (which also repairs an inverted band) and moves the widened band back inside the limits. A non-finite edge
// takes the other edge of its pair less or plus the minimum width; a pair with no finite edge takes the limits. The
// law has no floor or width of its own, so a corrupted anchor cannot make two opposing actions latch together.
struct BandCheck {
    Band band;
    bool repaired;  // any edge changed
};

namespace detail {
inline void check_pair(double& lo, double& hi, double lim_lo, double lim_hi, double width) noexcept {
    const bool lo_ok = std::isfinite(lo), hi_ok = std::isfinite(hi);
    if (!lo_ok && !hi_ok) {
        lo = lim_lo;
        hi = lim_hi;
        return;
    }
    if (!lo_ok) lo = hi - width;
    if (!hi_ok) hi = lo + width;
    lo = std::max(lim_lo, std::min(lim_hi, lo));
    hi = std::max(lim_lo, std::min(lim_hi, hi));
    if (hi - lo < width) {
        const double mid = (lo + hi) / 2;
        lo = mid - width / 2;
        hi = mid + width / 2;
        if (lo < lim_lo) {
            lo = lim_lo;
            hi = lo + width;
        }
        if (hi > lim_hi) {
            hi = lim_hi;
            lo = hi - width;
        }
    }
}
}  // namespace detail

inline BandCheck check_band(const Band& in) noexcept {
    Band b = in;
    detail::check_pair(b.low, b.high, BAND_TEMP_MIN_F, BAND_TEMP_MAX_F, BAND_MIN_WIDTH_F);
    detail::check_pair(b.vpd_low, b.vpd_high, BAND_VPD_MIN_KPA, BAND_VPD_MAX_KPA, BAND_MIN_WIDTH_KPA);
    const bool same = b.low == in.low && b.high == in.high && b.vpd_low == in.vpd_low && b.vpd_high == in.vpd_high;
    return {b, !same};
}

// The stored drying cost limit, clamped to its range; the released default when it cannot be read.
inline double dry_cost_limit(double stored) noexcept {
    if (!std::isfinite(stored)) return DRY_COST_LIMIT_DEFAULT_KWH_PER_KG;
    return std::max(DRY_COST_LIMIT_MIN_KWH_PER_KG, std::min(DRY_COST_LIMIT_MAX_KWH_PER_KG, stored));
}

// -- Section 4.2: the law ---------------------------------------------------
struct Inputs {
    double T, vpd, dp_f;            // indoor temperature (F), VPD (kPa), dew point (F)
    Band band;                      // the band now, after check_band() (step_checked() does it)
    bool temp_valid;                // a valid indoor temperature (ruling G2); false or a non-finite T: the law is off
    bool humidity_valid;            // a finite indoor humidity from the same source (ruling G2); false or a
                                    // non-finite VPD: rules 5 to 7 hold, the temperature rules and limits run
    bool out_ok;                    // fresh outdoor data (station, else the intake probe); non-finite values = none
    double out_T, out_dp_f;         // outdoor temperature and dew point (F)
    double w_in, w_out;             // indoor and outdoor humidity ratio (g/kg)
    double dry_cost_limit;          // kWh per kg, from dry_cost_limit()
};

// Why drying is not running while it is wanted (the dry latch is set), the first that applies in this order; and the
// two validity states, which apply whether or not drying is wanted. The state record publishes the name.
enum DryRefusal : uint8_t {
    DRY_RUNNING = 0,         // running, or not wanted
    DRY_NO_OUTDOOR,          // no valid outdoor data
    DRY_COOLING,             // the house is cooling
    DRY_FURNACE,             // the furnace latch is on
    DRY_NOT_DRIER,           // outdoor air not drier (dew point margin or moisture difference)
    DRY_TOO_COLD,            // the house is below the start line (or the stop line)
    DRY_COST,                // the cost is above the limit
    DRY_HUMIDITY_INVALID,    // no valid indoor humidity (ruling G2)
    DRY_NO_TEMPERATURE       // no valid indoor temperature: the law is off
};
inline constexpr const char* DRY_REFUSAL_NAMES[] = {"none",      "no_outdoor", "cooling", "furnace",         "not_drier",
                                                    "too_cold", "cost",       "humidity_invalid", "no_temperature"};

struct State {
    bool h1 = false, h2 = false, cool = false, cool2 = false;
    bool wet = false, mist = false, dry = false, air = false, run = false;
};

struct Output {
    bool heat1 = false, heat2 = false, vent = false, fog = false, mist = false;
    int fans = 0;  // 0, 1 (the lead) or 2
    bool cooling = false, drying = false, hot = false, cold = false;
    double dry_cost = std::numeric_limits<double>::quiet_NaN();  // kWh per kg while outdoor data is fresh
    DryRefusal dry_refusal = DRY_RUNNING;
};

inline Output step(State& s, const Inputs& u) noexcept {
    Output q;
    const double T = u.T, V = u.vpd;
    const Band& b = u.band;
    if (!u.temp_valid || !std::isfinite(T)) {  // no indoor temperature: the law does not act (decision 7 is the caller's)
        s = State{};
        q.dry_refusal = DRY_NO_TEMPERATURE;
        return q;
    }
    const bool hum_ok = u.humidity_valid && std::isfinite(V);
    const bool out_valid = u.out_ok && std::isfinite(u.out_T) && std::isfinite(u.out_dp_f) && std::isfinite(u.dp_f)
                           && std::isfinite(u.w_in) && std::isfinite(u.w_out);
    // ---- temperature
    if (T < b.low + HEAT1_ON_ABOVE_LOW_F) s.h1 = true;
    else if (T > b.low + HEAT1_OFF_ABOVE_LOW_F) s.h1 = false;
    if (T < b.low + HEAT2_ON_ABOVE_LOW_F) s.h2 = true;
    else if (T >= b.low + HEAT2_OFF_ABOVE_LOW_F) s.h2 = false;
    const double cool_on_at = b.high + COOL_ON_ABOVE_HIGH_F;
    if (T > cool_on_at) s.cool = true;
    else if (T < cool_on_at - COOL_OFF_BELOW_HIGH_F) s.cool = false;
    if (T > b.high + FAN2_ON_ABOVE_HIGH_F) s.cool2 = true;
    else if (T < b.high + FAN2_OFF_ABOVE_HIGH_F) s.cool2 = false;
    const bool hot = T >= SAFETY_MAX_F, cold = T <= SAFETY_MIN_F;
    // ---- humidity, too dry
    if (V > b.vpd_high + FOG_ON_ABOVE_VPD_HIGH_KPA) s.wet = true;
    else if (V < b.vpd_high - FOG_OFF_BELOW_VPD_HIGH_KPA) s.wet = false;
    if (V > b.vpd_high + MIST_ON_ABOVE_VPD_HIGH_KPA) s.mist = true;
    else if (V < b.vpd_high + MIST_OFF_ABOVE_VPD_HIGH_KPA) s.mist = false;
    const bool wet_ok = T >= b.low + WET_MIN_ABOVE_LOW_F;
    // ---- humidity, too wet
    if (V < b.vpd_low + DRY_ON_ABOVE_VPD_LOW_KPA) s.dry = true;
    else if (V > b.vpd_low + DRY_OFF_ABOVE_VPD_LOW_KPA) s.dry = false;
    if (!hum_ok) {
        s.wet = s.mist = s.dry = false;
    }
    // is outdoor air worth bringing in?
    bool air_ok = false, cost_ok = false;
    if (out_valid) {
        const double dw = u.w_in - u.w_out;
        if (u.out_dp_f <= u.dp_f - DRY_DEWPOINT_START_MARGIN_F) s.air = true;
        else if (u.out_dp_f > u.dp_f - DRY_DEWPOINT_STOP_MARGIN_F) s.air = false;
        air_ok = s.air && dw > DRY_MIN_MOISTURE_DIFF_G_PER_KG;
        // heat carried out per kg of water carried out; the air flow cancels (kJ/g = MJ/kg, / 3.6 = kWh/kg)
        q.dry_cost = dw > DRY_MIN_MOISTURE_DIFF_G_PER_KG
                         ? AIR_CP_KJ_PER_KG_K * std::max(0.0, (T - u.out_T) / F_PER_K) / dw / (KJ_PER_KWH / G_PER_KG)
                         : DRY_COST_NONE_KWH_PER_KG;
        cost_ok = air_ok && q.dry_cost <= u.dry_cost_limit;
    } else {
        s.air = false;
    }
    const bool cooling = s.cool || hot;
    if (!s.dry || !air_ok || cooling || s.h2 || T < b.low + DRY_STOP_ABOVE_LOW_F) s.run = false;
    else if (cost_ok && T >= b.low + DRY_START_ABOVE_LOW_F) s.run = true;
    // ---- requests
    q.hot = hot;
    q.cold = cold;
    q.cooling = cooling;
    q.drying = s.run && !cooling;
    q.vent = q.cooling || q.drying;
    q.fans = q.cooling ? ((s.cool2 || hot) ? 2 : 1) : (q.drying ? 1 : 0);
    q.fog = s.wet && wet_ok && !q.drying && !cold;
    q.mist = s.mist && wet_ok && !q.drying && !cold;
    q.heat1 = (s.h1 && !q.cooling) || cold;
    q.heat2 = (s.h2 && !q.vent) || cold;  // the furnace never runs with the vent open
    if (cold) {
        q.vent = false;
        q.fans = 0;
        q.cooling = q.drying = false;
    }
    // ---- why drying is wanted and not running (telemetry only)
    if (!hum_ok) q.dry_refusal = DRY_HUMIDITY_INVALID;
    else if (s.dry && !q.drying) {
        if (!out_valid) q.dry_refusal = DRY_NO_OUTDOOR;
        else if (cooling) q.dry_refusal = DRY_COOLING;
        else if (s.h2) q.dry_refusal = DRY_FURNACE;
        else if (!air_ok) q.dry_refusal = DRY_NOT_DRIER;
        else if (T < b.low + DRY_START_ABOVE_LOW_F) q.dry_refusal = DRY_TOO_COLD;
        else q.dry_refusal = DRY_COST;
    }
    return q;
}

// The controller's entry: the band check of section 4.1 on every pass, then the law.
inline Output step_checked(State& s, Inputs u, bool* band_repaired = nullptr) noexcept {
    const BandCheck c = check_band(u.band);
    u.band = c.band;
    if (band_repaired) *band_repaired = c.repaired;
    return step(s, u);
}

// -- Section 4.3: the relay layer; section 4.7: the lead fan ----------------
// One minimum on and one minimum off time per relay; every relay available at boot except the furnace, which waits one
// minimum off time after any boot (ruling G4); a fan only with the vent open (the vent opens first, the fan follows on
// the next pass, the vent stays open while a fan runs); the furnace and the vent never on together (the air waits for
// the furnace to finish and stop; the furnace waits for the vent to close); the lead fan chosen only while both fans
// are off. At a protection limit (100 F, 40 F) no minimum time applies to the heaters, the vent and the fans, and the
// interlocks still do (rulings G1, G1a): at 100 F both heaters stop, the vent opens and the fans start in the same
// pass; at 40 F the fans stop, the vent closes and the electric heater starts in the same pass, the furnace on the
// next pass once the air reads off (G1c), with no boot wait (G1b). The fogger keeps its minimum times everywhere (G1a).
struct Relay {
    bool on = false;
    bool switched = false;  // false until the relay first switches: available at once after boot
    uint32_t since_ms = 0;  // since the last switch (saturating)
};

struct RelayState {
    Relay heat1, heat2{false, true, 0}, fan1, fan2, fog, vent;  // the furnace counts as just switched off at boot
    bool lead_fan1 = true;
    bool drying_air = false;  // glue bookkeeping (RULINGS AG3a): the air that is on was opened by the drying run
};

struct RelayInputs {
    double fan1_run_s, fan2_run_s;  // accumulated run seconds (persisted); non-finite counts as 0
    bool fog_hold;                  // a hold of section 4.3 forces the fogger off at once
    uint32_t dt_ms;                 // since the last call
    bool cut_unwanted = false;      // force off at once every relay not requested (entry to the no-indoor state)
};

struct RelayStarts {
    bool heat1, heat2, fan1, fan2, fog, vent;
};

namespace detail {
inline bool relay_set(Relay& r, bool want, bool force_on, bool force_off, uint32_t min_on_ms,
                      uint32_t min_off_ms) noexcept {
    if (want) {
        if (!r.on && (force_on || !r.switched || r.since_ms >= min_off_ms)) {
            r.on = true;
            r.switched = true;
            r.since_ms = 0;
            return true;
        }
    } else if (r.on && (force_off || r.since_ms >= min_on_ms)) {
        r.on = false;
        r.since_ms = 0;
    }
    return false;
}
inline void relay_tick(Relay& r, uint32_t dt_ms) noexcept {
    r.since_ms = (r.since_ms > std::numeric_limits<uint32_t>::max() - dt_ms) ? std::numeric_limits<uint32_t>::max()
                                                                             : r.since_ms + dt_ms;
}
}  // namespace detail

inline RelayStarts relay_step(RelayState& r, const Output& e, const RelayInputs& in) noexcept {
    for (Relay* x : {&r.heat1, &r.heat2, &r.fan1, &r.fan2, &r.fog, &r.vent}) detail::relay_tick(*x, in.dt_ms);
    const double run1 = std::isfinite(in.fan1_run_s) ? in.fan1_run_s : 0.0;
    const double run2 = std::isfinite(in.fan2_run_s) ? in.fan2_run_s : 0.0;
    if (!r.fan1.on && !r.fan2.on) r.lead_fan1 = run1 <= run2;
    bool want_f1 = r.lead_fan1 ? e.fans >= 1 : e.fans >= 2;
    bool want_f2 = r.lead_fan1 ? e.fans >= 2 : e.fans >= 1;
    bool want_vent = e.vent;
    const uint32_t heat_on = HEAT_MIN_ON_S * MS_PER_S, heat_off = HEAT_MIN_OFF_S * MS_PER_S;
    const uint32_t fan_on = FAN_MIN_ON_S * MS_PER_S, fan_off = FAN_MIN_OFF_S * MS_PER_S;
    const uint32_t vent_on = VENT_MIN_ON_S * MS_PER_S, vent_off = VENT_MIN_OFF_S * MS_PER_S;
    const uint32_t fog_on = FOG_MIN_ON_S * MS_PER_S, fog_off = FOG_MIN_OFF_S * MS_PER_S;
    if (in.cut_unwanted) {  // the heaters, fans and vent the request drops stop now (the fogger has its holds, G1a)
        if (!e.heat1) detail::relay_set(r.heat1, false, false, true, heat_on, heat_off);
        if (!e.heat2) detail::relay_set(r.heat2, false, false, true, heat_on, heat_off);
        if (!want_f1) detail::relay_set(r.fan1, false, false, true, fan_on, fan_off);
        if (!want_f2) detail::relay_set(r.fan2, false, false, true, fan_on, fan_off);
        if (!want_vent && !want_f1 && !want_f2) detail::relay_set(r.vent, false, false, true, vent_on, vent_off);
    }
    if (r.heat2.on && !e.hot) {  // the air waits for the furnace to stop
        want_vent = false;
        want_f1 = want_f2 = false;
    }
    const bool air_on = r.vent.on || r.fan1.on || r.fan2.on;
    const bool vent_was_open = r.vent.on;
    const bool prot = e.hot || e.cold;
    RelayStarts st{};
    st.heat1 = detail::relay_set(r.heat1, e.heat1, prot, prot, heat_on, heat_off);
    if (prot) {
        // Ruling G1/G1a: no minimum time on the heaters, the vent and the fans. The fans that are not wanted and the
        // vent (when no fan is wanted) stop first; the vent opens before the fans in the same pass, as the phase 2
        // glue writes them. G1c: the furnace starts only with the air off at the start of the pass and after it,
        // the one-pass wait of the phase 2 glue (its heat/vent hold reads the relays before it writes them); there
        // is no actuator travel wait to keep. G1b: at or below 40 F the furnace's boot wait does not apply.
        if (!want_f1) detail::relay_set(r.fan1, false, false, true, fan_on, fan_off);
        if (!want_f2) detail::relay_set(r.fan2, false, false, true, fan_on, fan_off);
        st.vent = detail::relay_set(r.vent, want_vent || want_f1 || want_f2, true, true, vent_on, vent_off);
        st.fan1 = detail::relay_set(r.fan1, want_f1 && r.vent.on, true, true, fan_on, fan_off);
        st.fan2 = detail::relay_set(r.fan2, want_f2 && r.vent.on, true, true, fan_on, fan_off);
        const bool air_now = r.vent.on || r.fan1.on || r.fan2.on;
        st.heat2 = detail::relay_set(r.heat2, e.heat2 && !air_on && !air_now, true, true, heat_on, heat_off);
    } else {
        st.heat2 = detail::relay_set(r.heat2, e.heat2 && !air_on, false, false, heat_on, heat_off);
        if (r.heat2.on) {  // defence in depth: the law never asks for the furnace and the air together
            want_vent = false;
            want_f1 = want_f2 = false;
        }
        st.fan1 = detail::relay_set(r.fan1, want_f1 && vent_was_open, false, false, fan_on, fan_off);
        st.fan2 = detail::relay_set(r.fan2, want_f2 && vent_was_open, false, false, fan_on, fan_off);
        st.vent = detail::relay_set(r.vent, want_vent || want_f1 || want_f2 || r.fan1.on || r.fan2.on, false, false,
                                    vent_on, vent_off);
    }
    // G1a: the fogger keeps its minimum times at every temperature; only its hard holds stop it at once.
    st.fog = detail::relay_set(r.fog, e.fog && !in.fog_hold, false, in.fog_hold, fog_on, fog_off);
    return st;
}

// -- Section 4.8: the climate mister pulse request --------------------------
// The law never switches a mister valve. While the mister request holds and a member line is allowed, it asks the
// irrigation engine (irr_vpd_grant) for one pulse at a time on the line chosen here, waits the gap, and asks again.
// A refused or held pulse is asked for again one pulse length later. Zone choice: the fairness rule first (an allowed
// zone above the band's VPD high edge with no pulse for MISTER_OVERDUE_S, the longest waiting first), then the
// engine's ranking on the house band with the compiled ranks, then the first allowed zone, centre first. The
// mister line minimum off time is a fence: a zone inside it gives way to another ready zone, or the pulse waits.
enum MisterPhase : uint8_t { MISTER_IDLE = 0, MISTER_PULSE, MISTER_GAP };

struct MisterState {
    MisterPhase phase = MISTER_IDLE;
    uint32_t timer_ms = 0;
    int zone = -1;  // ZoneId of the open pulse, -1 none
};

struct MisterInputs {
    bool request;                     // the law's mister request with every hold of section 8.7 applied
    bool allowed[ZONE_COUNT];         // irr_climate_zone_allowed() per zone (east never: no mister)
    double zone_vpd[ZONE_COUNT];      // each zone's VPD (centre: the house average); NaN unknown
    double vpd_high;                  // the band's VPD high edge
    uint32_t since_fire_ms[ZONE_COUNT];  // since that zone's last climate pulse: a per-zone counter advanced by dt_ms
                                         // and saturating at UINT32_MAX, which is also its value at boot (never fired);
                                         // never millis() - last, which wraps
    bool min_off_ready[ZONE_COUNT];   // outside the mister line minimum off time
    uint32_t dt_ms;
};

struct MisterCommand {
    bool close_all;     // close every climate mister pulse (irr_climate_close on each line)
    int open_zone;      // ZoneId to ask a pulse for, -1 none
    uint32_t pulse_ms;  // its length (the grant carries it)
};

inline uint32_t mister_pulse_ms(double zone_vpd, double vpd_high) noexcept {
    const double base = double(MISTER_PULSE_S * MS_PER_S);
    const bool long_pulse = std::isfinite(zone_vpd) && zone_vpd > MISTER_LONG_PULSE_VPD_RATIO * vpd_high;
    return uint32_t(std::lround(long_pulse ? base * MISTER_LONG_PULSE_FACTOR : base));
}

inline int mister_choose_zone(const MisterInputs& in) noexcept {
    static constexpr ZoneId kOrder[] = {ZONE_CENTER, ZONE_SOUTH, ZONE_WEST};
    auto stressed = [&](int z) { return std::isfinite(in.zone_vpd[z]) && in.zone_vpd[z] > in.vpd_high; };
    // fairness
    int zone = -1;
    uint32_t oldest = 0;
    for (ZoneId z : kOrder) {
        if (!in.allowed[z] || !stressed(z)) continue;
        const uint32_t age = in.since_fire_ms[z];
        if (age > MISTER_OVERDUE_S * MS_PER_S && age > oldest) {
            zone = z;
            oldest = age;
        }
    }
    if (zone < 0) {
        // the engine's ranking, given the house band and the compiled ranks
        ZoneWetIntent intents[ZONE_COUNT];
        for (int z = 0; z < ZONE_COUNT; ++z) {
            const bool want = stressed(z);
            intents[z] = {want, want, want ? float(in.zone_vpd[z] - in.vpd_high) : 0.0f, want ? "stressed" : "at_target"};
        }
        const int rank[ZONE_COUNT] = {int(ZONE_RANK_CENTER), int(ZONE_RANK_SOUTH), int(ZONE_RANK_WEST),
                                      int(ZONE_RANK_EAST)};
        bool allowed[ZONE_COUNT];
        for (int z = 0; z < ZONE_COUNT; ++z) allowed[z] = in.allowed[z];
        zone = verdify_irr::irr_rank_vpd_zone(allowed, intents, rank);
    }
    if (zone < 0) {
        for (ZoneId z : kOrder) {
            if (in.allowed[z]) {
                zone = z;
                break;
            }
        }
    }
    if (zone < 0 || in.min_off_ready[zone]) return zone;
    for (ZoneId z : kOrder) {
        if (z != zone && in.allowed[z] && in.min_off_ready[z]) return z;
    }
    return -1;
}

// One tick. The caller executes the command (closing, or asking irr_vpd_grant for the pulse and opening the line on
// a grant) and reports the result with mister_opened().
inline MisterCommand mister_step(MisterState& s, const MisterInputs& in) noexcept {
    MisterCommand c{false, -1, 0};
    bool any_allowed = false;
    for (int z = 0; z < ZONE_COUNT; ++z) any_allowed = any_allowed || in.allowed[z];
    if (!in.request || !any_allowed) {
        // close an open pulse; a pulse cut short still owes its gap and a running gap keeps counting, so a request
        // flap cannot skip the gap
        if (s.phase == MISTER_PULSE) {
            c.close_all = true;
            s.phase = MISTER_GAP;
            s.timer_ms = MISTER_GAP_S * MS_PER_S;
        } else if (s.phase == MISTER_GAP) {
            s.timer_ms = s.timer_ms > in.dt_ms ? s.timer_ms - in.dt_ms : 0;
            if (s.timer_ms == 0) s.phase = MISTER_IDLE;
        }
        s.zone = -1;
        return c;
    }
    if (s.phase == MISTER_PULSE && s.zone >= 0 && !in.allowed[s.zone]) {  // its own line disallowed: close now
        c.close_all = true;
        s.zone = -1;
        s.phase = MISTER_GAP;
        s.timer_ms = MISTER_GAP_S * MS_PER_S;
        return c;
    }
    if (s.phase != MISTER_IDLE) {
        s.timer_ms = s.timer_ms > in.dt_ms ? s.timer_ms - in.dt_ms : 0;
        if (s.timer_ms > 0) return c;
    }
    if (s.phase == MISTER_PULSE && s.zone >= 0) {  // pulse over: close and wait the gap
        c.close_all = true;
        s.zone = -1;
        s.phase = MISTER_GAP;
        s.timer_ms = MISTER_GAP_S * MS_PER_S;
        return c;
    }
    c.open_zone = mister_choose_zone(in);
    c.pulse_ms = c.open_zone >= 0 ? mister_pulse_ms(in.zone_vpd[c.open_zone], in.vpd_high)
                                  : MISTER_PULSE_S * MS_PER_S;
    // until mister_opened() says otherwise, the pulse counts as refused: ask again one pulse length later
    s.phase = MISTER_GAP;
    s.zone = -1;
    s.timer_ms = c.pulse_ms;
    return c;
}

inline void mister_opened(MisterState& s, int zone, uint32_t pulse_ms) noexcept {
    s.phase = MISTER_PULSE;
    s.zone = zone;
    s.timer_ms = pulse_ms;
}

// -- Section 8.7 with ruling C2: what the irrigation engine reads from the climate path -------------
// VPD emergency: the highest of the house and zone VPD readings above the compiled emergency level.
inline bool vpd_emergency(double house_vpd, const double (&zone_vpd)[ZONE_COUNT]) noexcept {
    double m = std::numeric_limits<double>::quiet_NaN();
    auto merge = [&](double v) {
        if (std::isfinite(v)) m = std::isfinite(m) ? std::max(m, v) : v;
    };
    merge(house_vpd);
    for (int z = 0; z < ZONE_COUNT; ++z) {
        if (z != ZONE_CENTER) merge(zone_vpd[z]);
    }
    return std::isfinite(m) && m > VPD_EMERGENCY_KPA;
}

// The zone gate's safety term: no occupancy, no feed hold, the house VPD above the band's high edge and the dew
// margin at least the compiled margin. No clock term and no night term.
inline bool zone_gate_safety_ok(bool occupied, bool feed_hold, double house_vpd, double vpd_high,
                                double dew_margin_f) noexcept {
    return !occupied && !feed_hold && std::isfinite(house_vpd) && house_vpd > vpd_high
           && std::isfinite(dew_margin_f) && dew_margin_f >= WET_DEW_MARGIN_F;
}

// The engine's climate-yield input: climate wetting that only a drip holds back. Fog: the law's fog request with
// every fog hold but the two drip terms passing. Mist (ruling C2): the law's mister request, a member line passing
// the zone gate, and neither the soft budget nor occupancy holding it. A request that occupancy, the safety cap or
// the cold-house guard blocks never makes a drip yield.
inline bool climate_demand(const Output& law, bool fog_held_except_drip, bool any_zone_allowed, bool budget_block,
                           bool occupied) noexcept {
    const bool fog_wanted = law.fog && !fog_held_except_drip;
    const bool mist_wanted = law.mist && any_zone_allowed && !budget_block && !occupied;
    return fog_wanted || mist_wanted;
}

// -- Section 11.1: the labels the host still reads in phase 3 ---------------
struct LegacyInputs {
    bool sensor_fault;  // no valid indoor temperature (ruling G2: the state of decision 7)
    double T, vpd;
    Band band;
    bool vent_on, fog_on, mister_on, heat1_on, heat2_on;  // relays as they are
    bool drying;                                          // the law's drying request
};

struct LegacyState {
    Mode mode;
    MistStage mist_stage;  // the SEALED_MIST_<stage> suffix
    ClimateAction action;
    ClimatePriorityAxis axis;
};

inline LegacyState legacy_state(const LegacyInputs& in) noexcept {
    if (in.sensor_fault) return {SENSOR_FAULT, MIST_WATCH, CLIMATE_SENSOR_FAULT, CLIMATE_PRIORITY_SAFETY};
    if (in.T >= SAFETY_MAX_F) return {SAFETY_COOL, MIST_WATCH, CLIMATE_SAFETY_COOL, CLIMATE_PRIORITY_SAFETY};
    if (in.T <= SAFETY_MIN_F) return {SAFETY_HEAT, MIST_WATCH, CLIMATE_SAFETY_HEAT, CLIMATE_PRIORITY_SAFETY};
    if (in.vent_on) {
        if (in.fog_on) return {VENTILATE, MIST_WATCH, CLIMATE_VENT_COOL_FOG_ASSIST, CLIMATE_PRIORITY_TEMP};
        if (in.mister_on) return {VENTILATE, MIST_WATCH, CLIMATE_VENT_COOL_MIST_ASSIST, CLIMATE_PRIORITY_TEMP};
        if (in.drying) return {DEHUM_VENT, MIST_WATCH, CLIMATE_DEHUM_VENT, CLIMATE_PRIORITY_VPD};
        return {VENTILATE, MIST_WATCH, CLIMATE_VENT_COOL, CLIMATE_PRIORITY_TEMP};
    }
    if (in.fog_on) return {SEALED_MIST, MIST_FOG, CLIMATE_SEALED_FOG, CLIMATE_PRIORITY_VPD};
    if (in.mister_on) return {SEALED_MIST, MIST_S1, CLIMATE_SEALED_HUMIDIFY, CLIMATE_PRIORITY_VPD};
    if (in.heat1_on || in.heat2_on) return {IDLE, MIST_WATCH, CLIMATE_HEAT, CLIMATE_PRIORITY_TEMP};
    const Band& b = in.band;
    const bool temp_out = !(in.T >= b.low && in.T <= b.high);
    const bool vpd_out = std::isfinite(in.vpd) && !(in.vpd >= b.vpd_low && in.vpd <= b.vpd_high);  // X5 P4
    return {IDLE, MIST_WATCH, CLIMATE_IDLE,
            temp_out ? CLIMATE_PRIORITY_TEMP : (vpd_out ? CLIMATE_PRIORITY_VPD : CLIMATE_PRIORITY_RESOURCE)};
}

// -- Inputs the controller derives ---------------------------------------
// The humidity ratio (g/kg) from a dew point (F) at the site pressure, with the device VPD's Magnus coefficients:
// the vapour pressure is the saturation pressure at the dew point, so it holds for the wall and the case reading.
inline double humidity_ratio_g_per_kg(double dew_point_f) noexcept {
    const double c = (dew_point_f - F_AT_ZERO_C) / F_PER_K;
    const double e = SAT_VP_A_KPA * std::exp(SAT_VP_B * c / (c + SAT_VP_C_C));
    const double dry = SITE_PRESSURE_KPA - e;
    return dry > 0 ? WATER_AIR_G_PER_KG * e / dry : std::numeric_limits<double>::quiet_NaN();
}

// The relays as they are after the caller's override layer (or anything else that switched one): a relay whose
// physical state differs takes it with a fresh switch time, so its minimum times count from that edge (#1313).
inline void relay_sync(RelayState& r, const RelayOutputs& physical) noexcept {
    auto sync = [](Relay& x, bool on) {
        if (x.on != on) {
            x.on = on;
            x.switched = true;
            x.since_ms = 0;
        }
    };
    sync(r.heat1, physical.heat1);
    sync(r.heat2, physical.heat2);
    sync(r.fan1, physical.fan1);
    sync(r.fan2, physical.fan2);
    sync(r.fog, physical.fog);
    sync(r.vent, physical.vent);
}

// -- The no-indoor-temperature table (FW-INFRA's no_indoor_relays(), decision 7) as a request ----------
// The table goes through the same relay layer, so the interlocks and the boot rule apply to it.
inline Output output_from_relays(const RelayOutputs& t) noexcept {
    Output q;
    q.heat1 = t.heat1;
    q.heat2 = t.heat2;
    q.vent = t.vent;
    q.fog = t.fog;
    q.fans = (t.fan1 ? 1 : 0) + (t.fan2 ? 1 : 0);
    return q;
}

// -- Section 4.5: the drying meter ------------------------------------------
// Lifetime counters (contract phase3-entities, `climate_drying_meter`): seconds of a drying run with the vent open,
// water and heat carried out with the compiled air exchange, and seconds the dry latch was set with no run. The
// fractions are kept so 1 s steps add up exactly; the published values are whole units.
struct DryingMeter {
    uint32_t s = 0, g = 0, wh = 0, rw = 0;
    double s_frac = 0, g_frac = 0, wh_frac = 0, rw_frac = 0;
};

namespace detail {
inline void meter_add(uint32_t& whole, double& frac, double add) noexcept {
    if (!(add > 0)) return;
    frac += add;
    const double w = std::floor(frac);
    frac -= w;
    const double room = double(std::numeric_limits<uint32_t>::max() - whole);
    whole = w >= room ? std::numeric_limits<uint32_t>::max() : whole + uint32_t(w);
}
}  // namespace detail

// One pass. `law` and `state` are this pass's law output and latches, the relays as they are after the relay layer,
// the readings the law used. Non-finite readings add no water or heat (the seconds still count).
inline void drying_meter_step(DryingMeter& m, const State& state, const Output& law, bool vent_on, bool fan_on,
                              const Inputs& u, uint32_t dt_ms) noexcept {
    const double dt = double(dt_ms) / double(MS_PER_S);
    if (law.drying && vent_on) {
        const double mv = DRY_METER_VENT_KG_PER_S + (fan_on ? DRY_METER_FAN_KG_PER_S : 0.0);
        detail::meter_add(m.s, m.s_frac, dt);
        const double dw = u.w_in - u.w_out;  // g/kg
        if (std::isfinite(dw)) detail::meter_add(m.g, m.g_frac, mv * dw * dt);
        const double dT = (u.T - u.out_T) / F_PER_K;  // K
        if (std::isfinite(dT))
            detail::meter_add(m.wh, m.wh_frac, mv * AIR_CP_KJ_PER_KG_K * dT * dt / (KJ_PER_KWH / WH_PER_KWH));
    } else if (state.dry) {
        detail::meter_add(m.rw, m.rw_frac, dt);
    }
}

// -- Payloads (contract phase3-entities) -------------------------------------
namespace detail {
inline uint32_t bits(std::initializer_list<bool> b) noexcept {  // first element is bit 0
    uint32_t m = 0, bit = 1;
    for (bool x : b) {
        if (x) m |= bit;
        bit <<= 1;
    }
    return m;
}
}  // namespace detail

inline uint32_t latch_bits(const State& s) noexcept {
    return detail::bits({s.h1, s.h2, s.cool, s.cool2, s.wet, s.mist, s.dry, s.air, s.run});
}
inline uint32_t request_bits(const Output& q) noexcept {
    return detail::bits({q.heat1, q.heat2, q.vent, q.fog, q.mist, q.fans >= 1, q.fans >= 2, q.cooling, q.drying,
                         q.hot, q.cold});
}

// `climate_law_constants`: the hash of the compiled constants.
inline const char* constants_hash() noexcept { return CONSTANTS_SHA256; }

}  // namespace climate_law
