// band_edge_controller.h — reference implementation of the proposed climate law (a planning artefact; not product code).
//
// One law for every solar phase and every season: act when the house reaches an edge of the band and stop a fixed margin
// inside it. Inside the band only the electric heater works, holding a line near the low edge so that it, and not the
// furnace, carries the base load. Every threshold is relative to the band's four edges at the current
// solar phase (temperature low and high, VPD low and high), so the band alone carries the diurnal policy. The law has
// no clock, phase, season or weather test of its own.
//
// The law needs only what the controller measures itself (indoor temperature, VPD, dew point) and the band. Outdoor
// conditions are optional and may be absent at any time: they are used only to decide whether outdoor air is worth
// bringing in to dry the house, and without them the house is not dried with outdoor air.
//
// The defaults below ARE the proposed law (docs/design/climate-refactor-plan-2026-11-15.md, section 4). The block
// marked "study options" holds variants that were simulated and not adopted; they are off by default and are not part
// of the law.
#pragma once
#include <algorithm>
#include <cmath>

// Minimum on and off times of the relay layer, seconds (applied by the caller; see closed_loop2.cpp).
struct EdgeDwell {
  double heat_on = 300, heat_off = 300;   // electric heater and gas furnace
  double fan_on = 300, fan_off = 300;     // both fans
  double vent_on = 300, vent_off = 300;
  double fog_on = 120, fog_off = 120;
  double mist_pulse_s = 60, mist_gap_s = 45;   // a mister zone pulses, then the next zone takes the next pulse
};

struct EdgeConst {
  // ---- temperature axis, deg F relative to the band's low and high edge
  double h1_on = 3.5, h1_off = 4.5;   // electric heater: on below low+h1_on, off above low+h1_off
  double h2_on = 0.5, h2_off = 3.0;   // gas furnace: on below low+h2_on, off at low+h2_off (h2_off <= h1_on: the electric heater stays on)
  double c_on = 0.0, c_off = 2.0;     // cooling (vent + lead fan): on above high+c_on, off below high-c_off
  double c2_on = 1.5, c2_off = 0.0;   // second fan: on above high+c2_on, off below high+c2_off
  // ---- humidity axis, kPa relative to the band's VPD low and high edge
  double w_on = 0.0, w_off = 0.15;    // fog: on above vpd_high+w_on, off below vpd_high-w_off
  double m_on = 0.30, m_off = 0.05;   // misters join above vpd_high+m_on, leave below vpd_high+m_off
  double d_on = 0.05, d_off = 0.20;   // drying (vent + lead fan): on below vpd_low+d_on, off above vpd_low+d_off
  // ---- drying is allowed only while the house has heat to spare
  double dt_start = 3.5;              // start only at or above low+dt_start (the electric heater's on line, h1_on)
  double dt_start_gas = 1.0;          // while the drying cost is within e_max: start at or above low+dt_start_gas
  double dt_stop = 0.75;              // stop below low+dt_stop (above the furnace's on line, h2_on)
  // ---- outdoor air "within reason" (only while outdoor data is fresh)
  double dp_margin_f = 3.0;           // start only while the outdoor dew point is this far below the indoor dew point
  double dp_stop_f = 1.0;             // stop once it is less than this far below
  double e_max = 0.0;                 // drying cost limit, kWh of heat carried out per kg of water carried out: below low+dt_start
                                      // drying may start only while its cost is at or below this. 0 = only when outdoor air is
                                      // at least as warm as the house, so drying never draws on furnace heat
  // ---- protection limits (absolute, independent of the band)
  double safe_max = 100, safe_min = 40;

  // ---- study options: simulated, not adopted, off by default, not part of the law
  bool effect_check = false;          // without outdoor data: open the vent, and judge by the indoor dew point whether to go on
  double probe_s = 240, probe_dp_f = 0.5, probe_rest_s = 3600;
  bool hot_forces_fog = false;        // fogger and misters on at the 100 F limit whatever the VPD
  double wet_tmin = -99.0;            // no fog or mist below low+wet_tmin
  double d2_on = 0.05;                // second fan while drying: on below vpd_low-d2_on, off at vpd_low+d_on
  bool dry_two_fans = false;
  double ec_on = 99.0, ec_off = 0.0;  // fog as a cooling stage above high+ec_on; 99 = never
  double ec_v_on = 0.20, ec_v_off = 0.10;
  double pre_heat_gap = 1.0;          // forecast pre-staging (section 6 of the plan)
  double pre_heat_shift_f = -1;
  double pre_cool_gap = 1.0;
  double c_off_min = 0.5;
  double pre_dry_kpa = 0.10;
  double hold_f = 0.0;                // forecast hold-back: the electric heater's lines (and the drying start generated from them)
  bool hold_dry = true;               // with hold_dry off the drying start line stays where it is during the hold-back
  bool hold_stack = false;            // this much lower while the sun is forecast to carry the house; with hold_stack the furnace's
                                      // off line moves down with them
};

struct EdgeIn {
  double T, vpd, dp_f;                // indoor temperature (F), VPD (kPa), dew point (F)
  double tlo, thi, vlo, vhi;          // the band now
  bool out_ok;                        // outdoor data fresh
  double out_T, out_dp_f, w_in, w_out;  // outdoor temperature and dew point (F); indoor and outdoor humidity ratio (g/kg)
  double pre_heat, pre_cool, pre_dry;   // study options: 0..1; the law passes 0
  double pre_sun;
};

struct EdgeOut {
  bool heat1 = false, heat2 = false, vent = false, fog = false, mist = false;
  int fans = 0;                       // 0, 1 (lead) or 2 (lead and lag); which fan leads is the relay layer's choice
  bool cooling = false, drying = false;
  double dry_cost = NAN;              // kWh per kg while outdoor data is fresh (telemetry)
};

struct EdgeController {
  EdgeConst k;
  // latches
  bool h1 = false, h2 = false, cool = false, cool2 = false, wet = false, mist = false, dry = false, dry2 = false, run = false, air = false, evap = false;
  // effect check
  double probe_t = 0, probe_dp0 = 0, probe_rest = 0;
  bool probed = false;

  EdgeOut step(const EdgeIn& u, double dt) {
    EdgeOut q;
    const double T = u.T, V = u.vpd;
    const double half = 0.5 * (u.thi - u.tlo);
    // ---- temperature axis
    const double h1_shift = u.pre_heat * (k.pre_heat_shift_f >= 0
        ? std::max(0.0, std::min(k.pre_heat_shift_f, 2.0 * half - k.h1_off - 1.0))
        : std::max(0.0, half - k.h1_on - k.pre_heat_gap));
    const double hold = u.pre_sun * k.hold_f;
    const double h2_off_at = k.h2_off - (k.hold_stack ? std::min(hold, std::max(0.0, k.h2_off - k.h2_on - 1.0)) : 0.0);
    if (T < u.tlo + k.h1_on + h1_shift - hold) h1 = true;
    else if (T > u.tlo + k.h1_off + h1_shift - hold) h1 = false;
    if (T < u.tlo + k.h2_on) h2 = true;
    else if (T >= u.tlo + h2_off_at) h2 = false;
    const double c_on_at = u.thi + k.c_on - u.pre_cool * std::max(0.0, half - k.pre_cool_gap);
    const double c_exit = k.c_off + u.pre_heat * (k.c_off_min - k.c_off);
    if (T > c_on_at) cool = true;
    else if (T < c_on_at - c_exit) cool = false;
    if (T > u.thi + k.c2_on) cool2 = true;
    else if (T < u.thi + k.c2_off) cool2 = false;
    const bool hot = T >= k.safe_max, cold = T <= k.safe_min;
    // ---- humidity axis, too dry
    if (V > u.vhi + k.w_on) wet = true;
    else if (V < u.vhi - k.w_off) wet = false;
    if (V > u.vhi + k.m_on) mist = true;
    else if (V < u.vhi + k.m_off) mist = false;
    const bool wet_ok = T >= u.tlo + k.wet_tmin;
    if (cool && T > u.thi + k.ec_on && V > u.vlo + k.ec_v_on) evap = true;
    else if (!cool || T < u.thi + k.ec_off || V < u.vlo + k.ec_v_off) evap = false;
    // ---- humidity axis, too wet
    const double d_shift = u.pre_dry * k.pre_dry_kpa;
    if (V < u.vlo + k.d_on + d_shift) dry = true;
    else if (V > u.vlo + k.d_off + d_shift) dry = false;
    if (V < u.vlo - k.d2_on) dry2 = true;
    else if (V >= u.vlo + k.d_on) dry2 = false;
    // is outdoor air worth bringing in?
    bool air_ok, gas_ok = false;
    if (u.out_ok) {
      const double dw = u.w_in - u.w_out;   // g/kg
      if (u.out_dp_f <= u.dp_f - k.dp_margin_f) air = true;
      else if (u.out_dp_f > u.dp_f - k.dp_stop_f) air = false;
      air_ok = air && dw > 0.1;
      // heat carried out per kg of water carried out: cp * dT / dw, the air flow cancels (kJ/g = MJ/kg; /3.6 = kWh/kg)
      q.dry_cost = dw > 0.1 ? 1.006 * std::max(0.0, (T - u.out_T) / 1.8) / dw / 3.6 : 1e9;
      gas_ok = air_ok && q.dry_cost <= k.e_max;
      probe_rest = 0; probed = true;
    } else if (k.effect_check) {
      air_ok = probe_rest <= 0;             // study option: try it and judge by the effect on the indoor dew point
    } else {
      air = false; air_ok = false;          // no outdoor data: no drying with outdoor air
    }
    const bool cooling = cool || hot;
    const bool was_run = run;
    if (!dry || !air_ok || cooling || h2 || T < u.tlo + k.dt_stop) run = false;
    else if (T >= u.tlo + (gas_ok ? k.dt_start_gas : k.dt_start - (k.hold_dry ? hold : 0.0))) run = true;
    if (!u.out_ok && k.effect_check) {
      if (run && !was_run) { probe_t = 0; probe_dp0 = u.dp_f; probed = false; }
      if (run && !probed) {
        probe_t += dt;
        if (probe_t >= k.probe_s) {
          probed = true;
          if (probe_dp0 - u.dp_f < k.probe_dp_f) { probe_rest = k.probe_rest_s; run = false; }   // outdoor air is not drying the house
        }
      }
      if (!run && probe_rest > 0) probe_rest -= dt;
    }
    // ---- requests
    q.cooling = cooling;
    q.drying = run && !cooling;
    q.vent = q.cooling || q.drying;
    q.fans = q.cooling ? ((cool2 || hot) ? 2 : 1) : (q.drying ? ((dry2 && k.dry_two_fans) ? 2 : 1) : 0);
    const bool hot_wet = hot && k.hot_forces_fog;
    q.fog = (((wet || evap) && wet_ok && !q.drying) || hot_wet) && !cold;
    q.mist = ((mist && wet_ok && !q.drying) || hot_wet) && !cold;
    q.heat1 = (h1 && !q.cooling) || cold;
    q.heat2 = (h2 && !q.vent) || cold;    // the furnace never runs with the vent open
    if (cold) { q.vent = false; q.fans = 0; q.cooling = q.drying = false; }
    return q;
  }
};
