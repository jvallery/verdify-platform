// test_climate_law.cpp: native tests for the band-edge climate law (firmware/lib/climate_law.h, #1671).
//
// 1. The port is the simulated law: climate_law::step() and the reference EdgeController::step()
//    (docs/reviews/control-review-2026-11-15/sim/band_edge_controller.h, study options off) run over the same
//    seeded trajectories and must give identical requests, latches and drying cost at every step. The relay layer
//    is compared the same way with the simulator's relay layer (closed_loop2.cpp, transcribed below).
// 2. Every rule's on and off line, the cut table of section 4.3, the protection limits with a band that bypasses
//    validation, the band check, the mister pulse request, the engine inputs, the legacy labels and the
//    invariants of section 13 (phase 3).
//
// Build + run (make test-climate-law; the firmware-logic CI step):
//   cd firmware && g++ -std=c++17 -I lib -I ../docs/reviews/control-review-2026-11-15/sim \
//       -o test/test_climate_law test/test_climate_law.cpp && ./test/test_climate_law

#include "climate_law.h"
#include "climate_law_payload.h"
#include "climate_law_glue.h"
#include "greenhouse_logic.h"  // mixing_ratio_g_kg(), the device psychrometrics the law's must agree with

#include "band_edge_controller.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

namespace L = climate_law;
using namespace climate_law_k;

static int checks_run = 0;
static int checks_failed = 0;

#define CHECK(cond, label)                                               \
  do {                                                                   \
    ++checks_run;                                                        \
    if (!(cond)) {                                                       \
      ++checks_failed;                                                   \
      std::printf("FAIL: %s (line %d)\n", (label), __LINE__);            \
    }                                                                    \
  } while (0)

// -- helpers --------------------------------------------------------------
static const L::Band kBand{65.0, 80.0, 0.80, 1.25};  // a valid band (15 F, 0.45 kPa)

static L::Inputs base_inputs(double T, double vpd) {
  L::Inputs u{};
  u.T = T;
  u.vpd = vpd;
  u.dp_f = 50.0;
  u.band = kBand;
  u.temp_valid = true;
  u.humidity_valid = true;
  u.out_ok = false;
  u.out_T = 40.0;
  u.out_dp_f = 30.0;
  u.w_in = 8.0;
  u.w_out = 4.0;
  u.dry_cost_limit = DRY_COST_LIMIT_DEFAULT_KWH_PER_KG;
  return u;
}

static bool same_double(double a, double b) {
  return (std::isnan(a) && std::isnan(b)) || std::memcmp(&a, &b, sizeof a) == 0;
}

struct Rng {  // splitmix64: deterministic on every platform
  uint64_t s;
  uint64_t next() {
    uint64_t z = (s += 0x9E3779B97F4A7C15ull);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    return z ^ (z >> 31);
  }
  double uni(double lo, double hi) { return lo + (hi - lo) * double(next() >> 11) / double(1ull << 53); }
  bool coin(double p) { return uni(0, 1) < p; }
};

// -- 1. port == reference -------------------------------------------------
static void port_equals_reference_law() {
  Rng r{20261116};
  long steps = 0, mismatches = 0;
  for (int traj = 0; traj < 400; ++traj) {
    EdgeController ref;  // defaults = the law
    ref.k.e_max = DRY_COST_LIMIT_DEFAULT_KWH_PER_KG;
    L::State st;
    // a band per trajectory: mostly valid, sometimes corrupt (the law is compared as given)
    const double lo = r.uni(40, 80), hi = lo + r.uni(-2, 20), vlo = r.uni(0.3, 1.2), vhi = vlo + r.uni(-0.1, 1.0);
    double T = r.uni(lo - 8, hi + 8), V = r.uni(vlo - 0.4, vhi + 0.6), dp = r.uni(30, 65);
    const double limit = r.coin(0.2) ? r.uni(0, 1.5) : DRY_COST_LIMIT_DEFAULT_KWH_PER_KG;
    if (r.coin(0.1)) T = r.coin(0.5) ? r.uni(95, 110) : r.uni(30, 45);  // protection limits
    for (int i = 0; i < 300; ++i) {
      T += r.uni(-0.6, 0.6);
      V += r.uni(-0.04, 0.04);
      dp += r.uni(-0.5, 0.5);
      // land exactly on every line now and then (the same expressions as the comparisons)
      const double t_lines[] = {lo + HEAT1_ON_ABOVE_LOW_F, lo + HEAT1_OFF_ABOVE_LOW_F, lo + HEAT2_ON_ABOVE_LOW_F,
                                lo + HEAT2_OFF_ABOVE_LOW_F, hi + COOL_ON_ABOVE_HIGH_F,
                                (hi + COOL_ON_ABOVE_HIGH_F) - COOL_OFF_BELOW_HIGH_F, hi + FAN2_ON_ABOVE_HIGH_F,
                                hi + FAN2_OFF_ABOVE_HIGH_F, lo + DRY_START_ABOVE_LOW_F, lo + DRY_STOP_ABOVE_LOW_F,
                                lo + WET_MIN_ABOVE_LOW_F, SAFETY_MAX_F, SAFETY_MIN_F};
      const double v_lines[] = {vhi + FOG_ON_ABOVE_VPD_HIGH_KPA, vhi - FOG_OFF_BELOW_VPD_HIGH_KPA,
                                vhi + MIST_ON_ABOVE_VPD_HIGH_KPA, vhi + MIST_OFF_ABOVE_VPD_HIGH_KPA,
                                vlo + DRY_ON_ABOVE_VPD_LOW_KPA, vlo + DRY_OFF_ABOVE_VPD_LOW_KPA};
      const bool on_line_t = r.coin(0.15), on_line_v = r.coin(0.15);
      if (on_line_t) T = t_lines[r.next() % (sizeof t_lines / sizeof t_lines[0])];
      if (on_line_v) V = v_lines[r.next() % (sizeof v_lines / sizeof v_lines[0])];
      EdgeIn eu{};
      eu.T = T; eu.vpd = V; eu.dp_f = dp;
      eu.tlo = lo; eu.thi = hi; eu.vlo = vlo; eu.vhi = vhi;
      eu.out_ok = r.coin(0.8);
      eu.out_T = T - r.uni(-10, 50);
      eu.out_dp_f = dp - r.uni(-4, 20);
      if (r.coin(0.1)) eu.out_dp_f = r.coin(0.5) ? dp - DRY_DEWPOINT_START_MARGIN_F : dp - DRY_DEWPOINT_STOP_MARGIN_F;
      eu.w_in = r.uni(4, 14);
      eu.w_out = eu.w_in - r.uni(-1, 6);
      if (r.coin(0.05)) eu.w_out = eu.w_in - 0.1;  // the least moisture difference exactly
      ref.k.e_max = limit;
      const EdgeOut e = ref.step(eu, 1.0);
      L::Inputs u{};
      u.T = eu.T; u.vpd = eu.vpd; u.dp_f = eu.dp_f;
      u.band = {lo, hi, vlo, vhi};
      u.temp_valid = true;
      u.humidity_valid = true;
      u.out_ok = eu.out_ok; u.out_T = eu.out_T; u.out_dp_f = eu.out_dp_f; u.w_in = eu.w_in; u.w_out = eu.w_out;
      u.dry_cost_limit = limit;
      const L::Output q = L::step(st, u);
      const bool same = q.heat1 == e.heat1 && q.heat2 == e.heat2 && q.vent == e.vent && q.fog == e.fog
                        && q.mist == e.mist && q.fans == e.fans && q.cooling == e.cooling && q.drying == e.drying
                        && same_double(q.dry_cost, e.dry_cost) && st.h1 == ref.h1 && st.h2 == ref.h2
                        && st.cool == ref.cool && st.cool2 == ref.cool2 && st.wet == ref.wet && st.mist == ref.mist
                        && st.dry == ref.dry && st.air == ref.air && st.run == ref.run;
      ++steps;
      if (!same && ++mismatches <= 5) std::printf("  mismatch: traj %d step %d T=%.3f V=%.3f\n", traj, i, T, V);
    }
  }
  std::printf("  law vectors: %ld steps, %ld mismatches\n", steps, mismatches);
  CHECK(mismatches == 0, "climate_law::step equals the reference EdgeController::step");
}

// The simulator's relay layer (closed_loop2.cpp, controller=edge), transcribed for the vector comparison.
struct SimRelay {
  bool on = false;
  double last_on = -1e12, last_off = -1e12, min_on = 0, min_off = 0;
  bool can_on(double now) const { return now - last_off >= min_off; }
  bool can_off(double now) const { return now - last_on >= min_on; }
  void set(double now, bool want, bool force_off) {
    if (want) {
      if (!on && can_on(now)) { on = true; last_on = now; }
    } else if (on && (force_off || can_off(now))) {
      on = false; last_off = now;
    }
  }
};

static void port_equals_simulator_relay_layer() {
  Rng r{7};
  long steps = 0, mismatches = 0;
  for (int traj = 0; traj < 200; ++traj) {
    SimRelay H1, H2, F1, F2, FOG, VENT;
    H1.min_on = H2.min_on = HEAT_MIN_ON_S; H1.min_off = H2.min_off = HEAT_MIN_OFF_S;
    H2.last_off = -5.0;  // ruling G4: the furnace waits one minimum off time after boot (applied to the reference too)
    F1.min_on = F2.min_on = FAN_MIN_ON_S; F1.min_off = F2.min_off = FAN_MIN_OFF_S;
    VENT.min_on = VENT_MIN_ON_S; VENT.min_off = VENT_MIN_OFF_S;
    FOG.min_on = FOG_MIN_ON_S; FOG.min_off = FOG_MIN_OFF_S;
    bool lead1 = true, led_once = false, last1 = true;
    double f1_s = r.uni(0, 1000), f2_s = r.uni(0, 1000);
    L::RelayState rs;
    const double dt = 5.0;
    L::Output e;
    for (int i = 0; i < 2000; ++i) {
      const double now = i * dt;
      if (r.coin(0.05)) {  // a new request now and then
        e = L::Output{};
        e.heat1 = r.coin(0.5); e.heat2 = r.coin(0.3); e.fog = r.coin(0.3);
        const int mode = int(r.uni(0, 3));
        e.vent = mode > 0; e.fans = mode == 0 ? 0 : (r.coin(0.3) ? 2 : 1);
        if (e.vent) e.heat2 = false;  // the law never asks for both (q.heat2 needs !q.vent)
      }
      // simulator
      const bool fans_off = !F1.on && !F2.on;
      if (fans_off) {  // AB8 alternation with the m7 hand-over (closed_loop2.cpp carries the same rule)
        const bool m1 = F1.can_on(now), m2 = F2.can_on(now);
        const bool turn1 = led_once ? !last1 : f1_s <= f2_s;
        lead1 = m1 != m2 ? m1 : turn1;
      }
      bool want_f1 = lead1 ? e.fans >= 1 : e.fans >= 2, want_f2 = lead1 ? e.fans >= 2 : e.fans >= 1;
      bool want_vent = e.vent;
      if (H2.on && !e.hot) { want_vent = false; want_f1 = want_f2 = false; }
      const bool air_on = VENT.on || F1.on || F2.on;
      H1.set(now, e.heat1, false);
      H2.set(now, e.heat2 && !air_on, e.hot);
      F1.set(now, want_f1 && VENT.on, false);
      F2.set(now, want_f2 && VENT.on, false);
      if (fans_off && (F1.on || F2.on)) { last1 = F1.on && F2.on ? lead1 : F1.on; led_once = true; }
      VENT.set(now, want_vent || want_f1 || want_f2 || F1.on || F2.on, false);
      FOG.set(now, e.fog, false);
      // port
      L::RelayInputs in{f1_s, f2_s, false, uint32_t(dt * MS_PER_S)};
      L::relay_step(rs, e, in);
      const bool same = rs.heat1.on == H1.on && rs.heat2.on == H2.on && rs.fan1.on == F1.on && rs.fan2.on == F2.on
                        && rs.vent.on == VENT.on && rs.fog.on == FOG.on && rs.lead_fan1 == lead1;
      ++steps;
      if (!same && ++mismatches <= 5) std::printf("  relay mismatch: traj %d step %d\n", traj, i);
      if (F1.on) f1_s += dt;
      if (F2.on) f2_s += dt;
    }
  }
  std::printf("  relay vectors: %ld steps, %ld mismatches\n", steps, mismatches);
  CHECK(mismatches == 0, "climate_law::relay_step equals the simulator's relay layer");
}

// -- 2. rules: each on and off line ---------------------------------------
static void rule_lines() {
  const double lo = kBand.low, hi = kBand.high, vh = kBand.vpd_high;
  L::State s;
  // rule 1: electric heater on below low+3.5, off above low+4.5, held between
  L::step(s, base_inputs(lo + HEAT1_ON_ABOVE_LOW_F, 1.0));
  CHECK(!s.h1, "h1 not on at its on line");
  L::step(s, base_inputs(lo + HEAT1_ON_ABOVE_LOW_F - 0.01, 1.0));
  CHECK(s.h1, "h1 on below its on line");
  L::step(s, base_inputs(lo + HEAT1_OFF_ABOVE_LOW_F, 1.0));
  CHECK(s.h1, "h1 held at its off line");
  L::step(s, base_inputs(lo + HEAT1_OFF_ABOVE_LOW_F + 0.01, 1.0));
  CHECK(!s.h1, "h1 off above its off line");
  // rule 2: furnace on below low+0.5, off at low+3.0
  s = {};
  L::Output q = L::step(s, base_inputs(lo + HEAT2_ON_ABOVE_LOW_F - 0.01, 1.0));
  CHECK(s.h2 && q.heat2 && q.heat1, "furnace on below its line, electric heater with it");
  L::step(s, base_inputs(lo + HEAT2_OFF_ABOVE_LOW_F - 0.01, 1.0));
  CHECK(s.h2, "furnace held below its off line");
  L::step(s, base_inputs(lo + HEAT2_OFF_ABOVE_LOW_F, 1.0));
  CHECK(!s.h2, "furnace off at its off line");
  // rule 3: cooling on above high, off below high-2
  s = {};
  q = L::step(s, base_inputs(hi, 1.0));
  CHECK(!q.cooling, "no cooling at the high edge");
  q = L::step(s, base_inputs(hi + 0.01, 1.0));
  CHECK(q.cooling && q.vent && q.fans == 1 && !q.heat1, "cooling above high: vent, lead fan, heater off");
  q = L::step(s, base_inputs(hi - COOL_OFF_BELOW_HIGH_F, 1.0));
  CHECK(q.cooling, "cooling held at its off line");
  q = L::step(s, base_inputs(hi - COOL_OFF_BELOW_HIGH_F - 0.01, 1.0));
  CHECK(!q.cooling && !q.vent, "cooling off below its off line");
  // rule 4: second fan on above high+1.5, off below high
  s = {};
  q = L::step(s, base_inputs(hi + FAN2_ON_ABOVE_HIGH_F + 0.01, 1.0));
  CHECK(q.fans == 2, "second fan above high+1.5");
  q = L::step(s, base_inputs(hi + 0.5, 1.0));
  CHECK(q.fans == 2, "second fan held");
  q = L::step(s, base_inputs(hi - 0.01, 1.0));
  CHECK(q.fans == 1 && q.cooling, "second fan off below high, lead fan stays");
  // rule 5: fog on above vpd_high, off below vpd_high-0.15
  s = {};
  q = L::step(s, base_inputs(70, vh + 0.001));
  CHECK(q.fog, "fog above vpd_high");
  q = L::step(s, base_inputs(70, vh - FOG_OFF_BELOW_VPD_HIGH_KPA));
  CHECK(q.fog, "fog held at its off line");
  q = L::step(s, base_inputs(70, vh - FOG_OFF_BELOW_VPD_HIGH_KPA - 0.001));
  CHECK(!q.fog, "fog off below its off line");
  // rule 6: misters join above vpd_high+0.30, leave below vpd_high+0.05
  s = {};
  q = L::step(s, base_inputs(70, vh + MIST_ON_ABOVE_VPD_HIGH_KPA));
  CHECK(!q.mist && q.fog, "misters wait at their on line; fog leads");
  q = L::step(s, base_inputs(70, vh + MIST_ON_ABOVE_VPD_HIGH_KPA + 0.001));
  CHECK(q.mist, "misters join above vpd_high+0.30");
  q = L::step(s, base_inputs(70, vh + MIST_OFF_ABOVE_VPD_HIGH_KPA));
  CHECK(q.mist, "misters held at their off line");
  q = L::step(s, base_inputs(70, vh + MIST_OFF_ABOVE_VPD_HIGH_KPA - 0.001));
  CHECK(!q.mist && q.fog, "misters leave below vpd_high+0.05, fog stays");
  // rules 5 and 6: the cold-house guard
  s = {};
  q = L::step(s, base_inputs(lo - 0.01, vh + 0.5));
  CHECK(!q.fog && !q.mist && s.wet && s.mist, "no fog or mist below the low edge; the latches wait");
  q = L::step(s, base_inputs(lo, vh + 0.5));
  CHECK(q.fog && q.mist, "fog and mist resume at the low edge");
}

static L::Inputs drying_inputs(double T, double vpd) {
  L::Inputs u = base_inputs(T, vpd);
  u.out_ok = true;
  u.out_T = T - 5;  // mild: a low cost
  u.dp_f = 55;
  u.out_dp_f = 55 - DRY_DEWPOINT_START_MARGIN_F;
  u.w_in = 9.0;
  u.w_out = 6.0;
  return u;
}

static void rule7_drying() {
  const double lo = kBand.low, vl = kBand.vpd_low;
  const double T = lo + DRY_START_ABOVE_LOW_F + 2;  // inside every temperature line but the heater's
  L::State s;
  L::Output q = L::step(s, drying_inputs(T, vl + DRY_ON_ABOVE_VPD_LOW_KPA));
  CHECK(!q.drying, "no drying at the drying line");
  q = L::step(s, drying_inputs(T, vl + DRY_ON_ABOVE_VPD_LOW_KPA - 0.001));
  CHECK(q.drying && q.vent && q.fans == 1, "drying below the drying line: vent and lead fan");
  CHECK(!q.fog && !q.mist, "no fog or mist while drying");
  q = L::step(s, drying_inputs(T, vl + DRY_OFF_ABOVE_VPD_LOW_KPA));
  CHECK(q.drying, "drying held at its off line");
  q = L::step(s, drying_inputs(T, vl + DRY_OFF_ABOVE_VPD_LOW_KPA + 0.001));
  CHECK(!q.drying, "drying off above vpd_low+0.20");
  // start and stop lines on temperature
  s = {};
  q = L::step(s, drying_inputs(lo + DRY_START_ABOVE_LOW_F - 0.01, vl));
  CHECK(!q.drying && q.dry_refusal == L::DRY_TOO_COLD, "no start below low+1.5");
  q = L::step(s, drying_inputs(lo + DRY_START_ABOVE_LOW_F, vl));
  CHECK(q.drying, "starts at low+1.5");
  q = L::step(s, drying_inputs(lo + DRY_STOP_ABOVE_LOW_F, vl));
  CHECK(q.drying, "continues down to low+0.75");
  q = L::step(s, drying_inputs(lo + DRY_STOP_ABOVE_LOW_F - 0.01, vl));
  CHECK(!q.drying, "stops below low+0.75");
  // the electric heater keeps following rule 1 while drying
  s = {};
  q = L::step(s, drying_inputs(lo + DRY_START_ABOVE_LOW_F, vl));
  CHECK(q.drying && q.heat1 && !q.heat2, "drying does not cut the electric heater; no furnace with the vent");
  // dew point margins 3 / 1 F
  s = {};
  L::Inputs u = drying_inputs(T, vl);
  u.out_dp_f = u.dp_f - DRY_DEWPOINT_START_MARGIN_F + 0.01;
  q = L::step(s, u);
  CHECK(!q.drying && q.dry_refusal == L::DRY_NOT_DRIER, "no start with the outdoor dew point less than 3 F below");
  u.out_dp_f = u.dp_f - DRY_DEWPOINT_START_MARGIN_F;
  q = L::step(s, u);
  CHECK(q.drying, "starts at 3 F below");
  u.out_dp_f = u.dp_f - DRY_DEWPOINT_STOP_MARGIN_F;
  q = L::step(s, u);
  CHECK(q.drying, "continues at 1 F below");
  u.out_dp_f = u.dp_f - DRY_DEWPOINT_STOP_MARGIN_F + 0.01;
  q = L::step(s, u);
  CHECK(!q.drying, "stops when less than 1 F below");
  // the least moisture difference
  s = {};
  u = drying_inputs(T, vl);
  u.w_out = u.w_in - DRY_MIN_MOISTURE_DIFF_G_PER_KG;
  q = L::step(s, u);
  CHECK(!q.drying && q.dry_cost == DRY_COST_NONE_KWH_PER_KG, "no drying at the least moisture difference");
  // the cost: e = cp * dT/1.8 / dw / 3.6
  s = {};
  u = drying_inputs(62, vl);
  u.band.low = 55;
  u.out_T = 40;
  u.w_in = 8.0;
  u.w_out = 5.0;
  q = L::step(s, u);
  const double e = 1.006 * (22.0 / 1.8) / 3.0 / 3.6;
  CHECK(std::fabs(q.dry_cost - e) < 1e-12, "drying cost formula");
  CHECK(q.drying == (e <= DRY_COST_LIMIT_DEFAULT_KWH_PER_KG), "start decided by the limit");
  s = {};
  u.dry_cost_limit = e - 1e-9;
  q = L::step(s, u);
  CHECK(!q.drying && q.dry_refusal == L::DRY_COST, "no start above the limit");
  u.dry_cost_limit = e;
  q = L::step(s, u);
  CHECK(q.drying, "start at the limit");
  u.out_T = 0;  // much colder now: a run that started continues
  q = L::step(s, u);
  CHECK(q.drying, "a started run continues when the outdoor air turns colder");
  // warmer outdoor air costs nothing
  s = {};
  u = drying_inputs(T, vl);
  u.out_T = T + 5;
  q = L::step(s, u);
  CHECK(q.dry_cost == 0.0 && q.drying, "outdoor air warmer than the house: cost 0");
  // no outdoor data: no drying, and every other rule unaffected
  s = {};
  u = drying_inputs(lo + 1, vl);
  u.out_ok = false;
  q = L::step(s, u);
  CHECK(!q.drying && std::isnan(q.dry_cost) && q.dry_refusal == L::DRY_NO_OUTDOOR && q.heat1,
        "no outdoor data: no drying, heater unaffected");
  // furnace on: no drying
  s = {};
  q = L::step(s, drying_inputs(lo + HEAT2_ON_ABOVE_LOW_F - 0.01, vl));
  CHECK(!q.drying && q.heat2 && !q.vent && q.dry_refusal == L::DRY_FURNACE, "no drying while the furnace runs");
  // cooling: no drying
  s = {};
  q = L::step(s, drying_inputs(kBand.high + 1, vl));
  CHECK(q.cooling && !q.drying && q.dry_refusal == L::DRY_COOLING, "no drying while cooling");
  // case sensor alone: humidity rules hold
  s = {};
  u = drying_inputs(T, vl);
  u.humidity_valid = false;
  q = L::step(s, u);
  CHECK(!q.drying && !q.fog && !q.mist && q.dry_refusal == L::DRY_HUMIDITY_INVALID, "no valid humidity");
  u = base_inputs(kBand.low + 1, 2.5);
  u.humidity_valid = false;
  q = L::step(s, u);
  CHECK(!q.fog && !q.mist && q.heat1, "no valid humidity: no fog, temperature rules run");
}

// -- protection, with a band that bypasses validation ---------------------
static void protection_limits() {
  L::State s;
  L::Inputs u = base_inputs(SAFETY_MAX_F, kBand.vpd_high + 0.5);
  u.band = {95.0, 110.0, 0.8, 1.2};  // corrupt: the hot rule must act on its own
  L::Output q = L::step(s, u);
  CHECK(q.hot && q.vent && q.fans == 2 && !q.heat1 && !q.heat2, "100 F: vent, both fans, heaters off");
  CHECK(q.fog, "100 F: the fogger keeps following rule 5 (C1)");
  u.vpd = u.band.vpd_high + 0.5;
  s = {};
  q = L::step(s, u);
  CHECK(q.mist, "100 F: the misters keep following rule 6 (C1)");
  s = {};
  u = base_inputs(SAFETY_MIN_F, kBand.vpd_high + 0.5);
  u.band = {30.0, 38.0, 0.8, 1.2};  // corrupt: cooling latched at 40 F
  q = L::step(s, u);
  CHECK(q.cold && q.heat1 && q.heat2 && !q.vent && q.fans == 0 && !q.fog && !q.mist, "40 F: heaters, all else off");
  // just inside the limits nothing protective
  s = {};
  q = L::step(s, base_inputs(SAFETY_MAX_F - 0.01, 1.0));
  CHECK(!q.hot && q.fans == 2, "below 100 F: the band's rules (high + 1.5)");
}

// -- 4.3: the relay layer ------------------------------------------------
static L::RelayState after_boot_wait() {  // a relay state past the furnace's boot wait (ruling G4)
  L::RelayState r;
  L::relay_step(r, L::Output{}, L::RelayInputs{0, 0, false, HEAT_MIN_OFF_S * MS_PER_S});
  return r;
}

// Ruling AB8 with review m7: the lead fan alternates by episode; a resting fan hands its turn to the other, and the
// order continues from the fan that actually led; escalation to both fans does not change the turn; a restart takes
// the first turn by fewer persisted run seconds, once.
static L::RelayState vent_open_state() {
  L::RelayState r = after_boot_wait();
  r.vent.on = true; r.vent.switched = true; r.vent.since_ms = 600000;
  return r;
}

// One episode: fans as asked until a fan starts, run 60 s, then off and rested. Returns 1 or 2, the fan that led.
static int episode(L::RelayState& r, int fans, const L::RelayInputs& in) {
  L::Output e{};
  e.vent = true; e.fans = fans;
  L::relay_step(r, e, in);
  const int led = r.fan1.on && r.fan2.on ? (r.lead_fan1 ? 1 : 2) : (r.fan1.on ? 1 : (r.fan2.on ? 2 : 0));
  L::RelayInputs run = in;
  run.dt_ms = FAN_MIN_ON_S * MS_PER_S;
  L::relay_step(r, e, run);
  L::Output off{};
  off.vent = true;
  L::relay_step(r, off, in);
  run.dt_ms = FAN_MIN_OFF_S * MS_PER_S;
  L::relay_step(r, off, run);  // both fans rested: either may start
  return led;
}

static void lead_fan_alternates() {
  const uint32_t rest_ms = FAN_MIN_OFF_S * MS_PER_S;
  // strict alternation over many episodes, whatever the run seconds say
  L::RelayState r = vent_open_state();
  const L::RelayInputs lopsided{100, 900000, false, 1000};  // fan 1 has far fewer run seconds throughout
  int prev = 0, swaps = 0, n1 = 0;
  for (int k = 0; k < 40; ++k) {
    const int led = episode(r, 1, lopsided);
    if (k == 0) CHECK(led == 1, "AB8: the first turn after boot goes to fewer run seconds (fan 1)");
    if (prev && led != prev) ++swaps;
    n1 += led == 1;
    prev = led;
  }
  CHECK(swaps == 39 && n1 == 20, "AB8: 40 episodes alternate strictly, 20 each, no catch-up for fan 1's fewer seconds");
  // escalation to both fans does not change whose turn is next
  r = vent_open_state();
  CHECK(episode(r, 1, lopsided) == 1, "AB8: fan 1 leads episode 1");
  CHECK(episode(r, 2, lopsided) == 2 && r.last_led_fan1 == false, "AB8: episode 2 runs both fans, fan 2 led it");
  CHECK(episode(r, 1, lopsided) == 1, "AB8: episode 3 is fan 1's turn again");
  // escalation inside an episode: fan 1 leads, fan 2 joins, fan 1 stops first; the turn is still fan 2's
  r = vent_open_state();
  L::Output one{}, two{}, off{};
  one.vent = two.vent = off.vent = true; one.fans = 1; two.fans = 2;
  L::RelayInputs step{100, 900000, false, FAN_MIN_ON_S * MS_PER_S};
  L::relay_step(r, one, step);
  L::relay_step(r, two, step);
  CHECK(r.fan1.on && r.fan2.on && r.lead_fan1, "AB8: escalation adds fan 2 behind fan 1");
  L::relay_step(r, off, step);
  step.dt_ms = rest_ms;
  L::relay_step(r, off, step);
  CHECK(episode(r, 1, lopsided) == 2, "AB8: after an escalated episode led by fan 1, fan 2 leads");
  // a resting turn hands over, and the order continues from who actually led
  r = vent_open_state();
  CHECK(episode(r, 1, lopsided) == 1, "m7: fan 1 leads episode 1");
  r.fan2.switched = true; r.fan2.since_ms = 60000;  // fan 2 (whose turn it is) stopped 60 s ago
  L::Output cool{};
  cool.vent = true; cool.fans = 1;
  L::relay_step(r, cool, L::RelayInputs{100, 900000, false, 1000});
  CHECK(r.fan1.on && !r.fan2.on && r.lead_fan1, "m7: fan 2 rests, so fan 1 leads now instead of waiting");
  L::RelayInputs run{100, 900000, false, FAN_MIN_ON_S * MS_PER_S};
  L::relay_step(r, cool, run);
  L::relay_step(r, off, run);
  run.dt_ms = rest_ms;
  L::relay_step(r, off, run);
  CHECK(episode(r, 1, lopsided) == 2, "m7: fan 1 took the turn, so fan 2 leads next");
  CHECK(episode(r, 1, lopsided) == 1, "m7: and the alternation continues");
  // both resting: the turn holds and waits, then that fan starts
  r = vent_open_state();
  CHECK(episode(r, 1, lopsided) == 1, "both resting: fan 1 leads episode 1");
  r.fan1.switched = r.fan2.switched = true; r.fan1.since_ms = 10000; r.fan2.since_ms = 20000;
  L::relay_step(r, cool, L::RelayInputs{100, 900000, false, 1000});
  CHECK(!r.lead_fan1 && !r.fan1.on && !r.fan2.on, "both resting: fan 2's turn holds and waits");
  r.fan2.since_ms = rest_ms;
  L::relay_step(r, cool, L::RelayInputs{100, 900000, false, 1000});
  CHECK(r.fan2.on && !r.lead_fan1, "both resting: fan 2 starts when its rest ends");
  L::relay_step(r, cool, L::RelayInputs{0, 99999999, false, 1000});
  CHECK(r.fan2.on && !r.fan1.on && !r.lead_fan1, "no swap during a run");
  // a restart (RAM state lost): fewer persisted run seconds takes the first turn once, then alternation
  r = vent_open_state();
  const L::RelayInputs fan2_fewer{900000, 100, false, 1000};
  CHECK(episode(r, 1, fan2_fewer) == 2 && episode(r, 1, fan2_fewer) == 1 && episode(r, 1, fan2_fewer) == 2,
        "restart: fewer run seconds (fan 2) first, then alternation");
}

static void relay_layer() {
  L::RelayState r;
  L::Output e{};
  e.heat1 = e.heat2 = e.fog = true;
  L::RelayInputs in{0, 0, false, 1000};
  L::relay_step(r, e, in);
  CHECK(r.heat1.on && r.fog.on && !r.heat2.on, "G4: every relay available at boot except the furnace");
  e = L::Output{};
  e.vent = true; e.fans = 1;
  L::relay_step(r, e, in);
  L::relay_step(r, e, in);
  CHECK(r.vent.on && r.fan1.on, "G4: vent and fans available at boot");
  r = {};
  e = L::Output{};
  e.heat2 = true;
  uint32_t waited = 0;
  while (!r.heat2.on && waited < 2 * HEAT_MIN_OFF_S * MS_PER_S) {
    L::relay_step(r, e, in);
    waited += in.dt_ms;
  }
  CHECK(waited == HEAT_MIN_OFF_S * MS_PER_S, "G4: the furnace starts one minimum off time after boot");
  r = after_boot_wait();
  e = L::Output{};
  e.heat1 = e.heat2 = true;
  L::relay_step(r, e, in);
  CHECK(r.heat1.on && r.heat2.on, "both heaters on");
  e = L::Output{};
  L::relay_step(r, e, in);
  CHECK(r.heat1.on && r.heat2.on, "minimum on time holds the heaters");
  for (uint32_t t = 1000; t < HEAT_MIN_ON_S * MS_PER_S; t += 1000) L::relay_step(r, e, in);
  CHECK(!r.heat1.on && !r.heat2.on, "off after the minimum on time");
  // cooling with the furnace on: the air waits for the furnace to finish
  r = after_boot_wait();
  e = L::Output{};
  e.heat2 = true;
  L::relay_step(r, e, in);
  e = L::Output{};
  e.vent = true; e.fans = 1; e.cooling = true;
  for (uint32_t t = 0; t + 1000 < HEAT_MIN_ON_S * MS_PER_S; t += 1000) {
    L::relay_step(r, e, in);
    CHECK(!(r.heat2.on && r.vent.on), "furnace and vent never together");
  }
  CHECK(r.heat2.on && !r.vent.on, "vent waits for the furnace's minimum on time");
  L::relay_step(r, e, in);
  L::relay_step(r, e, in);
  CHECK(!r.heat2.on && r.vent.on && !r.fan1.on, "furnace off, then the vent opens first");
  L::relay_step(r, e, in);
  CHECK(r.vent.on && r.fan1.on, "the fan follows on the next pass");
  // G1, 100 F: both heaters cut at once, the vent opens and both fans start in the same pass
  r = after_boot_wait();
  e = L::Output{};
  e.heat1 = e.heat2 = true;
  L::relay_step(r, e, in);
  e = L::Output{};
  e.vent = true; e.fans = 2; e.cooling = true; e.hot = true;
  L::relay_step(r, e, in);
  CHECK(!r.heat1.on && !r.heat2.on && r.vent.on && r.fan1.on && r.fan2.on,
        "G1, 100 F: heaters cut at once, vent and both fans in the same pass");
  // G1, 100 F: the vent and the fans ignore their minimum off time
  r = after_boot_wait();
  e = L::Output{};
  e.vent = true; e.fans = 2; e.cooling = true;
  L::relay_step(r, e, in);
  L::relay_step(r, e, in);
  for (uint32_t t = 0; t < FAN_MIN_ON_S * MS_PER_S; t += 1000) L::relay_step(r, L::Output{}, in);
  L::relay_step(r, L::Output{}, in);
  CHECK(!r.vent.on && !r.fan1.on && !r.fan2.on, "air off");
  e.hot = true;
  L::relay_step(r, e, in);
  CHECK(r.vent.on && r.fan1.on && r.fan2.on, "G1, 100 F: vent and fans start inside their minimum off time");
  // G1, 40 F: the fans stop and the vent closes at once, both heaters start in the same pass
  r = after_boot_wait();
  e = L::Output{};
  e.vent = true; e.fans = 2; e.cooling = true;
  L::relay_step(r, e, in);
  L::relay_step(r, e, in);
  CHECK(r.vent.on && r.fan1.on && r.fan2.on, "cooling running");
  e = L::Output{};
  e.heat1 = e.heat2 = true; e.cold = true;
  L::relay_step(r, e, in);
  CHECK(!r.vent.on && !r.fan1.on && !r.fan2.on && r.heat1.on && !r.heat2.on,
        "G1, 40 F: air off at once, the electric heater on in the same pass");
  L::relay_step(r, e, in);
  CHECK(r.heat1.on && r.heat2.on, "G1c, 40 F: the furnace follows one pass after the air reads off");
  // G1, 40 F: the heaters ignore their minimum off time
  r = after_boot_wait();
  e = L::Output{};
  e.heat1 = e.heat2 = true;
  L::relay_step(r, e, in);
  for (uint32_t t = 0; t < HEAT_MIN_ON_S * MS_PER_S; t += 1000) L::relay_step(r, L::Output{}, in);
  CHECK(!r.heat1.on && !r.heat2.on, "heaters off");
  e.cold = true;
  L::relay_step(r, e, in);
  CHECK(r.heat1.on && r.heat2.on, "G1, 40 F: heaters start inside their minimum off time");
  // G1b: at or below 40 F the furnace's boot wait does not apply
  r = {};
  e = L::Output{};
  e.heat1 = e.heat2 = true; e.cold = true;
  L::relay_step(r, e, in);
  CHECK(r.heat1.on && r.heat2.on, "G1b, 40 F: both heaters at once after a boot");
  // G1a: the fogger keeps its minimum times at 100 F and at 40 F
  for (int lim = 0; lim < 2; ++lim) {
    const char* at = lim ? "G1a, 40 F" : "G1a, 100 F";
    r = after_boot_wait();
    e = L::Output{};
    e.fog = true;
    L::relay_step(r, e, in);
    CHECK(r.fog.on, "fog on");
    L::Output lim_e{};
    (lim ? lim_e.cold : lim_e.hot) = true;
    L::relay_step(r, lim_e, in);
    CHECK(r.fog.on, at);  // not stopped inside its minimum on time
    for (uint32_t t = 1000; t < FOG_MIN_ON_S * MS_PER_S; t += 1000) L::relay_step(r, lim_e, in);
    CHECK(!r.fog.on, at);  // stops when its minimum on time ends
    lim_e.fog = true;
    L::relay_step(r, lim_e, in);
    CHECK(!r.fog.on, at);  // not restarted inside its minimum off time
    for (uint32_t t = 1000; t < FOG_MIN_OFF_S * MS_PER_S; t += 1000) L::relay_step(r, lim_e, in);
    CHECK(r.fog.on, at);  // restarts when its minimum off time ends
  }
  // G1 keeps the interlocks: at 100 F with the furnace asked (impossible from the law) the air still wins
  r = after_boot_wait();
  e = L::Output{};
  e.heat2 = e.vent = true; e.fans = 1; e.hot = true;
  L::relay_step(r, e, in);
  CHECK(!(r.heat2.on && r.vent.on) && !(r.fan1.on && !r.vent.on), "G1: interlocks still apply");
  // m6: a furnace and vent request together outside protection: the furnace wins, the air waits
  r = after_boot_wait();
  e = L::Output{};
  e.heat2 = e.vent = true; e.fans = 1;
  for (int i = 0; i < 5; ++i) {
    L::relay_step(r, e, in);
    CHECK(!(r.heat2.on && r.vent.on) && !((r.fan1.on || r.fan2.on) && !r.vent.on), "m6: never together");
  }
  // the vent stays open while a fan runs
  r = after_boot_wait();
  e = L::Output{};
  e.vent = true; e.fans = 1;
  L::relay_step(r, e, in);
  L::relay_step(r, e, in);
  e = L::Output{};
  L::relay_step(r, e, in);
  L::relay_step(r, e, in);
  CHECK(r.fan1.on && r.vent.on, "vent held open while the fans finish their minimum on time");
  // saturation: a relay off since boot stays available however long the controller runs (m11)
  r = {};
  L::relay_step(r, L::Output{}, L::RelayInputs{0, 0, false, UINT32_MAX - 1000});
  L::relay_step(r, L::Output{}, L::RelayInputs{0, 0, false, 5000});
  CHECK(r.heat2.since_ms == UINT32_MAX && r.heat1.since_ms == UINT32_MAX, "relay timers saturate");
  e = L::Output{};
  e.heat2 = true;
  L::relay_step(r, e, in);
  CHECK(r.heat2.on, "a saturated timer leaves the relay available");
  // m5: a non-finite run time counts as 0
  r = after_boot_wait();
  e = L::Output{};
  e.vent = true; e.fans = 1;
  L::relay_step(r, e, L::RelayInputs{NAN, 100, false, 1000});
  CHECK(r.lead_fan1, "m5: a NaN run time counts as 0, so that fan leads");
  L::relay_step(r, L::Output{}, in);
  r = after_boot_wait();
  L::relay_step(r, e, L::RelayInputs{100, NAN, false, 1000});
  CHECK(!r.lead_fan1, "m5: either side");
  // fog: minimum times and the hold
  r = {};
  e = L::Output{};
  e.fog = true;
  L::relay_step(r, e, in);
  CHECK(r.fog.on, "fog on");
  L::RelayInputs held = in;
  held.fog_hold = true;
  L::relay_step(r, e, held);
  CHECK(!r.fog.on, "a hold cuts the fogger at once");
  L::relay_step(r, e, in);
  CHECK(!r.fog.on, "the fogger then waits its minimum off time");
  // the lead fan: fewer run seconds, chosen only while both fans are off
  r = {};
  e = L::Output{};
  e.vent = true; e.fans = 1;
  L::RelayInputs f2_less{500, 100, false, 1000};
  L::relay_step(r, e, f2_less);
  L::relay_step(r, e, f2_less);
  CHECK(r.fan2.on && !r.fan1.on && !r.lead_fan1, "the fan with fewer run seconds leads");
  L::RelayInputs f1_less{100, 900, false, 1000};
  L::relay_step(r, e, f1_less);
  CHECK(r.fan2.on && !r.fan1.on, "no swap during a run");
  lead_fan_alternates();
}

// -- 4.1: the band check -------------------------------------------------
// -- T1: the FANS and VENT-BYPASS latches are cleared at a protection limit -------------
// The controller's glue (climate_law_glue.h) pass by pass: the law, the latch clear, the label the override layer
// keys on, the relay layer and the override layer, the physical relays fed back. The temperature dithers across the
// limit at every pass (worse than the 15 s probe cadence).
struct GluePass {
  L::State s;
  L::RelayState r = after_boot_wait();
  RelayOutputs phys{false, false, false, false, false, false};
  uint32_t fans_until_ms = 0, bypass_until_ms = 0;  // the controller's latch deadlines (0 = not latched)
  int vent_edges = 0;
  void run(double T) {
    L::Inputs u = base_inputs(T, 1.0);
    const L::Output law = L::step_checked(s, u, nullptr);
    L::clear_latches_at_protection(law, fans_until_ms, bypass_until_ms);  // X4: the controller's own call
    const Mode mode = law.hot ? SAFETY_COOL : law.cold ? SAFETY_HEAT : IDLE;
    const ManualOverrides ov{fans_until_ms != 0, bypass_until_ms != 0, false, false};
    const L::RelayPass p = L::relay_pass(r, law, L::RelayInputs{0, 0, false, 1000}, phys, ov, mode);
    if (p.out.vent != phys.vent) ++vent_edges;
    phys = p.out;
    L::relay_sync(r, phys);
  }
};

static void protection_clears_overrides() {
  {
    GluePass g;
    g.fans_until_ms = 600000;
    for (int i = 0; i < 30; ++i) g.run(41.0);  // FANS latched in a cold house: vent and both fans forced
    CHECK(g.phys.vent && g.phys.fan1 && g.phys.fan2 && !g.phys.heat2, "T1 setup: FANS forces the air at 41 F");
    g.vent_edges = 0;
    bool furnace_started = false, furnace_dropped = false;
    for (int i = 0; i < 600; ++i) {
      g.run(i % 2 ? SAFETY_MIN_F + 0.1 : SAFETY_MIN_F);
      if (g.phys.heat2) furnace_started = true;
      else if (furnace_started) furnace_dropped = true;
      CHECK(!(g.phys.heat2 && (g.phys.vent || g.phys.fan1 || g.phys.fan2)), "T1: furnace never with the air");
    }
    CHECK(g.fans_until_ms == 0, "T1: the FANS latch is cleared at 40 F");
    CHECK(g.vent_edges <= 1, "T1: at most one vent edge across a 40.0/40.1 dither with FANS latched");
    CHECK(furnace_started && !furnace_dropped, "T1: the furnace starts and stays on");
  }
  {
    GluePass g;
    g.bypass_until_ms = 600000;
    for (int i = 0; i < 30; ++i) g.run(SAFETY_MAX_F - 1.0);  // VENT-BYPASS: fans with the vent closed
    CHECK(!g.phys.vent && g.phys.fan1 && g.phys.fan2, "T1 setup: VENT-BYPASS runs the fans with the vent closed");
    g.vent_edges = 0;
    for (int i = 0; i < 600; ++i) g.run(i % 2 ? SAFETY_MAX_F : SAFETY_MAX_F - 0.1);
    CHECK(g.bypass_until_ms == 0, "T1: the VENT-BYPASS latch is cleared at 100 F");
    CHECK(g.vent_edges <= 1, "T1: at most one vent edge across a 99.9/100.0 dither with VENT-BYPASS latched");
    CHECK(g.phys.vent && g.phys.fan1 && g.phys.fan2, "T1: vent open and both fans on after the clear");
  }
}

// -- T4: a HUMID press or run-once is climate fog demand for the engine (ruling C2) ------
// -- T6 S2: a relay switched off outside the loop keeps its minimum off time -------------
static void glue_fog_demand_and_sync() {
  L::RelayState r = after_boot_wait();
  const RelayOutputs off{false, false, false, false, false, false};
  const L::Output none{};
  L::RelayPass p = L::relay_pass(r, none, L::RelayInputs{0, 0, false, 1000}, off,
                                 ManualOverrides{false, false, true, false}, IDLE);
  CHECK(p.force.fog && p.out.fog, "T4: HUMID forces the fogger");
  CHECK(L::climate_fog_wanted(none, p.force, false, true), "T4: HUMID alone is climate fog demand (a drip yields)");
  CHECK(!L::climate_fog_wanted(none, p.force, true, true), "T4: a rail other than the drips holds it");
  CHECK(!L::climate_fog_wanted(none, p.force, false, false), "T4: today's clock term holds it");
  p = L::relay_pass(r, none, L::RelayInputs{0, 0, false, 1000}, off, ManualOverrides{false, false, true, true}, IDLE);
  CHECK(!p.force.fog && !L::climate_fog_wanted(none, p.force, false, true), "T4: a blocked HUMID is no demand");
  p = L::relay_pass(r, none, L::RelayInputs{0, 0, false, 1000}, off, ManualOverrides{false, false, true, false},
                    SAFETY_COOL);
  CHECK(!p.force.fog, "T4: no HUMID force at a protection limit");
  L::Output fog{};
  fog.fog = true;
  CHECK(L::climate_fog_wanted(fog, L::RelayPass{}.force, false, true), "T4: the law's fog request is demand");
  // S2: the fogger runs, an OTA on_begin turns it off outside the loop; the next pass must not restart it before
  // its minimum off time.
  r = after_boot_wait();
  RelayOutputs phys = off;
  for (int i = 0; i < int(FOG_MIN_ON_S) + 2; ++i) {
    p = L::relay_pass(r, fog, L::RelayInputs{0, 0, false, 1000}, phys, ManualOverrides{false, false, false, false}, IDLE);
    phys = p.out;
  }
  CHECK(phys.fog, "S2 setup: the fogger runs");
  phys.fog = false;  // switched off outside the loop
  int restarted_after = -1;
  for (int i = 1; i <= int(FOG_MIN_OFF_S) + 2 && restarted_after < 0; ++i) {
    p = L::relay_pass(r, fog, L::RelayInputs{0, 0, false, 1000}, phys, ManualOverrides{false, false, false, false}, IDLE);
    phys = p.out;
    if (phys.fog) restarted_after = i;
  }
  CHECK(restarted_after >= int(FOG_MIN_OFF_S), "S2: the fogger waits its minimum off time after an outside cut");
}

// -- The override rails of the phase 2 build, kept through relay_pass() (tests/test_12_fidelity.py guards the
// controller's call sites; contracts/fidelity-guards-phase3.md maps each rule) ----------------------------------
static void glue_override_rails() {
  const RelayOutputs off{false, false, false, false, false, false};
  const L::Output none{};
  const L::RelayInputs plain{0, 0, false, 1000};
  L::RelayInputs held = plain;
  held.fog_hold = true;
  // A fog hold (the SENSOR_FAULT lock, occupancy, SAF-5, a drip, outside 100 F the soft budget and SAF-4) beats a
  // HUMID press or a fog run-once: the press is applied, the hold after it.
  L::RelayState r = after_boot_wait();
  L::RelayPass p = L::relay_pass(r, none, held, off, ManualOverrides{false, false, true, false}, IDLE);
  CHECK(!p.out.fog, "rails: a fog hold wins over a HUMID press");
  p = L::relay_pass(r, none, held, off, ManualOverrides{false, false, true, false}, SENSOR_FAULT);
  CHECK(!p.out.fog, "rails: a fog hold wins over a HUMID press in SENSOR_FAULT too");
  // At 40 F (SAFETY_HEAT) a FANS or VENT-BYPASS press is a no-op: no fan, the vent stays closed (decision 12: no fan
  // at the 40 F limit; the furnace has its own blower).
  L::Output cold{};
  cold.cold = true;
  cold.heat1 = cold.heat2 = true;
  for (const ManualOverrides ov : {ManualOverrides{true, false, false, false}, ManualOverrides{false, true, false, false}}) {
    r = after_boot_wait();
    p = L::relay_pass(r, cold, plain, off, ov, SAFETY_HEAT);
    CHECK(!p.force.fans && !p.out.fan1 && !p.out.fan2 && !p.out.vent && p.out.heat1,
          "rails: no manual fan and no vent at 40 F");
  }
  // In SENSOR_FAULT the overrides stay effective over the no-indoor table (B1): FANS runs both fans with the vent
  // open, VENT-BYPASS both fans with the vent closed.
  const L::Output heat_row = L::output_from_relays(RelayOutputs{true, false, false, false, false, false});
  r = after_boot_wait();
  p = L::relay_pass(r, heat_row, plain, off, ManualOverrides{true, false, false, false}, SENSOR_FAULT);
  CHECK(p.force.fans && p.out.fan1 && p.out.fan2 && p.out.vent, "rails: FANS effective in SENSOR_FAULT");
  r = after_boot_wait();
  p = L::relay_pass(r, heat_row, plain, off, ManualOverrides{false, true, false, false}, SENSOR_FAULT);
  CHECK(p.force.fans && p.out.fan1 && p.out.fan2 && !p.out.vent, "rails: VENT-BYPASS effective in SENSOR_FAULT");
  // A FANS press ends a furnace run before its minimum on time (T7 item 5): the furnace never runs with the air.
  L::Output furnace{};
  furnace.heat1 = furnace.heat2 = true;
  r = after_boot_wait();
  RelayOutputs phys = off;
  for (int i = 0; i < 3; ++i) {
    p = L::relay_pass(r, furnace, plain, phys, ManualOverrides{false, false, false, false}, IDLE);
    phys = p.out;
  }
  CHECK(phys.heat2, "rails setup: the furnace runs");
  p = L::relay_pass(r, furnace, plain, phys, ManualOverrides{true, false, false, false}, IDLE);
  CHECK(!p.out.heat2 && p.out.fan1 && p.out.fan2 && p.out.vent, "rails: a FANS press ends a furnace run at once");
  // RULINGS AE10: a manual fan run (FANS, vent open; VENT-BYPASS, vent closed) stops the electric heater too, and the
  // heater comes back after the latch ends (its minimum off time from the cut).
  L::Output warm{};
  warm.heat1 = true;
  for (const ManualOverrides ov : {ManualOverrides{true, false, false, false}, ManualOverrides{false, true, false, false}}) {
    r = after_boot_wait();
    phys = off;
    for (int i = 0; i < 3; ++i) {
      p = L::relay_pass(r, warm, plain, phys, ManualOverrides{false, false, false, false}, IDLE);
      phys = p.out;
    }
    CHECK(phys.heat1, "AE10 setup: the electric heater runs");
    for (int i = 0; i < 5; ++i) {
      p = L::relay_pass(r, warm, plain, phys, ov, IDLE);
      phys = p.out;
      CHECK(!p.out.heat1 && !p.out.heat2 && p.out.fan1 && p.out.fan2, "AE10: no heater during a manual fan run");
    }
    CHECK(phys.vent == ov.fans_active, "AE10: FANS opens the vent, VENT-BYPASS keeps it closed");
    int back_after = -1;
    for (int i = 1; i <= int(HEAT_MIN_OFF_S) + int(FAN_MIN_ON_S) + 5 && back_after < 0; ++i) {
      p = L::relay_pass(r, warm, plain, phys, ManualOverrides{false, false, false, false}, IDLE);
      phys = p.out;
      if (phys.heat1) back_after = i;
    }
    CHECK(back_after > 0, "AE10: the electric heater comes back after the latch ends");
  }
  // At 40 F the latch is cleared (T1) and the protection heats.
  {
    GluePass g;
    g.fans_until_ms = 600000;
    for (int i = 0; i < 30; ++i) g.run(SAFETY_MIN_F);
    CHECK(g.fans_until_ms == 0 && g.phys.heat1 && !g.phys.fan1 && !g.phys.fan2 && !g.phys.vent,
          "AE10: at 40 F the FANS latch is cleared and the electric heater runs");
  }
  // The law's own drying still runs the electric heater beside the open vent (no press: no AE10 cut).
  L::Output drying{};
  drying.drying = true;
  drying.vent = true;
  drying.fans = 1;
  drying.heat1 = true;
  r = after_boot_wait();
  phys = off;
  for (int i = 0; i < 5; ++i) {
    p = L::relay_pass(r, drying, plain, phys, ManualOverrides{false, false, false, false}, IDLE);
    phys = p.out;
  }
  CHECK(phys.heat1 && phys.vent && (phys.fan1 || phys.fan2), "AE10: drying keeps the electric heater with the vent");
}

// -- Package 4.3 deferred items: X8 (MINOR-3) and E-m2 ----------------------------------------
static void deferred_43() {
  // X8: the no-indoor request is the table as a fan count, whichever fan the table names.
  for (NoIndoorBranch b : {NoIndoorBranch::kOff, NoIndoorBranch::kVent, NoIndoorBranch::kHeat}) {
    const L::Output q = L::no_indoor_request(b);
    for (bool lead1 : {true, false}) {
      const L::Output t = L::output_from_relays(no_indoor_relays(b, lead1));
      CHECK(q.heat1 == t.heat1 && q.heat2 == t.heat2 && q.vent == t.vent && q.fog == t.fog && q.fans == t.fans &&
                !q.mist,
            "X8: no_indoor_request equals the table's request for either lead");
    }
  }
  // E-m2: VENT-BYPASS latched while the law asks to cool; whenever the latch ends, the vent opens on the next pass,
  // not up to its minimum off time later. Latch lengths across two vent minimum-off periods, so one of them ends just
  // after the relay layer's periodic try to open the vent.
  int worst = 0;
  for (int len = int(VENT_MIN_OFF_S) - 2; len <= 2 * int(VENT_MIN_OFF_S) + 4; ++len) {
    GluePass g;
    g.bypass_until_ms = 600000;
    for (int i = 0; i < len; ++i) g.run(kBand.high + 3.0);
    CHECK(!g.phys.vent && g.phys.fan1 && g.phys.fan2, "E-m2 setup: VENT-BYPASS holds the vent closed, fans on");
    g.bypass_until_ms = 0;
    int opened_after = -1;
    for (int i = 1; i <= int(VENT_MIN_OFF_S) + 2 && opened_after < 0; ++i) {
      g.run(kBand.high + 3.0);
      if (g.phys.vent) opened_after = i;
    }
    if (opened_after < 0 || opened_after > worst) worst = opened_after < 0 ? 1 << 30 : opened_after;
  }
  CHECK(worst == 1, "E-m2: the vent opens on the first pass after VENT-BYPASS ends, whatever the latch length");
}

// -- T3: the climate decision telemetry is the law's label, not the mode machine's ------------
static void law_decision_telemetry() {
  SensorInputs in{};
  in.temp_f = 75.0f;
  in.vpd_kpa = 1.6f;
  L::LegacyInputs li{};
  li.T = 75.0; li.vpd = 1.6; li.band = kBand;
  L::Output law{};
  auto decide = [&](const L::LegacyInputs& x, bool boot) {
    return L::describe_law_decision(L::published_label(L::legacy_state(x), boot), in, law, kBand, true,
                                    "served");
  };
  li.vent_on = true; li.fog_on = true;
  ClimateActionDecision d = decide(li, false);
  CHECK(d.climate_action == CLIMATE_VENT_COOL_FOG_ASSIST, "T3: vent + fog publishes VENT_COOL_FOG_ASSIST");
  CHECK(d.priority_axis == CLIMATE_PRIORITY_TEMP, "T3: its axis");
  CHECK(std::strcmp(d.fog_block_reason, "none") == 0, "T3: climate_fog_block_reason none while the fogger runs");
  li.fog_on = false; li.mister_on = true;
  d = decide(li, false);
  CHECK(d.climate_action == CLIMATE_VENT_COOL_MIST_ASSIST, "T3: vent + mister publishes VENT_COOL_MIST_ASSIST");
  li = L::LegacyInputs{}; li.T = 66.0; li.vpd = 1.0; li.band = kBand; li.heat1_on = true;
  d = decide(li, false);
  CHECK(d.climate_action == CLIMATE_HEAT, "T3: a heater relay on (request off or not) publishes HEAT");
  CHECK(d.priority_axis == CLIMATE_PRIORITY_TEMP, "T3: HEAT has the temperature axis (no heat_dehum override)");
  d = decide(li, true);
  CHECK(d.climate_action == CLIMATE_IDLE, "T3: IDLE during the boot grace");
  li = L::LegacyInputs{}; li.T = 75.0; li.vpd = 0.6; li.band = kBand; li.vent_on = true; li.drying = true;
  law = L::Output{}; law.drying = true; law.vent = true; law.fans = 1;
  d = decide(li, false);
  CHECK(d.climate_action == CLIMATE_DEHUM_VENT, "T3: a drying run publishes DEHUM_VENT");
  CHECK(std::strcmp(d.moisture_exchange_action, "vent_dehum") == 0, "T3: moisture exchange = the drying run");
  CHECK(d.moisture_outdoor_fresh, "T3: of = the law's outdoor validity");
  law = L::Output{}; law.dry_refusal = L::DRY_NO_OUTDOOR;
  d = L::describe_law_decision(L::LegacyState{IDLE, MIST_WATCH, CLIMATE_IDLE, CLIMATE_PRIORITY_VPD}, in, law,
                               kBand, false, "relay_min_off");
  CHECK(std::strcmp(d.moisture_exchange_action, "none") == 0 && std::strcmp(d.moisture_exchange_reason, "no_outdoor") == 0,
        "T3: no run: a = none, r = the law's refusal");
  CHECK(std::strcmp(d.fog_block_reason, "relay_min_off") == 0, "T3: the ladder's other words pass through");
  // 4.3: the band errors come from the band the law used (no Setpoints): 75 F in 65-80 is 0; 1.6 kPa over 1.25.
  CHECK(d.temp_error_f == 0.0f && std::fabs(d.vpd_error_kpa - (1.6f - 1.25f)) < 1e-6f,
        "4.3: band errors against the law's band");
  in.vpd_kpa = NAN;
  d = L::describe_law_decision(L::LegacyState{IDLE, MIST_WATCH, CLIMATE_IDLE, CLIMATE_PRIORITY_VPD}, in, law, kBand,
                               false, "none");
  CHECK(d.vpd_error_kpa == 0.0f && d.fog_margin_kpa == 0.0f, "4.3: no humidity, no VPD error and no fog margin");
  in.vpd_kpa = 1.6f;
  // X4: the clear reports whether it cleared, so the controller logs once
  {
    uint32_t f = 5000, b = 0;
    L::Output hot{};
    hot.hot = true;
    CHECK(L::clear_latches_at_protection(hot, f, b) && f == 0, "X4: clears a set latch and says so");
    CHECK(!L::clear_latches_at_protection(hot, f, b), "X4: nothing to clear, nothing to log");
    f = 5000;
    CHECK(!L::clear_latches_at_protection(L::Output{}, f, b) && f == 5000, "X4: inside the limits the latch stays");
  }
  // X1: the moisture assist state from the law and mister_step (four states)
  {
    L::MisterState m{};
    L::MoistureAssist a = L::moisture_assist(true, true, "west", m);
    CHECK(std::strcmp(a.state, "pulse_on") == 0 && std::strcmp(a.zone, "west") == 0 && a.next_mist_s == 0.0f,
          "X1: a mister relay on is pulse_on in its zone, next 0");
    m.phase = L::MISTER_GAP;
    m.timer_ms = 42000;
    a = L::moisture_assist(true, false, "none", m);
    CHECK(std::strcmp(a.state, "pulse_gap") == 0 && std::strcmp(a.zone, "none") == 0 && a.next_mist_s == 42.0f,
          "X1: the law misting in the gap is pulse_gap, next = the gap left");
    m.phase = L::MISTER_IDLE;
    a = L::moisture_assist(true, false, "none", m);
    CHECK(std::strcmp(a.state, "blocked") == 0 && a.next_mist_s == -1.0f, "X1: the law misting, nothing open: blocked");
    a = L::moisture_assist(false, false, "none", m);
    CHECK(std::strcmp(a.state, "inactive") == 0 && std::strcmp(a.zone, "none") == 0 && a.next_mist_s == -1.0f,
          "X1: no mist request: inactive");
  }
  // X6: vent_mist_assist_status keyed on the label
  {
    L::LegacyInputs x{};
    x.T = 75.0; x.vpd = 1.6; x.band = kBand; x.vent_on = true; x.fog_on = true;
    L::Output q{};
    q.fog = true;
    CHECK(L::vent_assist_status(L::legacy_state(x), true, q, true) == L::VentAssistStatus::kServed, "X6: served");
    x.fog_on = false;
    CHECK(L::vent_assist_status(L::legacy_state(x), true, q, false) == L::VentAssistStatus::kBlocked,
          "X6: vent open, wet request, nothing wet on: blocked");
    CHECK(L::vent_assist_status(L::legacy_state(x), true, L::Output{}, false) == L::VentAssistStatus::kInactive,
          "X6: no wet request: inactive");
  }
  // P8: the state record's publish decision
  CHECK(!L::law_record_due(true, false, true, 100000, 0), "P8: nothing in the boot grace");
  CHECK(L::law_record_due(false, false, false, 100000, 0), "P8: the first record");
  CHECK(!L::law_record_due(false, true, true, 104999, 100000), "P8: a change waits 5 s");
  CHECK(L::law_record_due(false, true, true, 105000, 100000), "P8: a change after 5 s");
  CHECK(!L::law_record_due(false, true, false, 159999, 100000), "P8: unchanged waits the heartbeat");
  CHECK(L::law_record_due(false, true, false, 160000, 100000), "P8: the 60 s heartbeat");
  // X5 P4: no vpd axis without a finite VPD
  {
    L::LegacyInputs x{};
    x.T = 70.0; x.vpd = NAN; x.band = kBand;
    CHECK(L::legacy_state(x).axis == CLIMATE_PRIORITY_RESOURCE, "P4: no 'vpd' axis when the VPD is not finite");
  }
}

static void band_check() {
  L::BandCheck c = L::check_band({60.7, 83.8, 0.74, 1.29});
  CHECK(!c.repaired, "today's band passes unchanged");
  c = L::check_band({70.0, 73.0, 1.0, 1.1});
  CHECK(c.repaired && std::fabs((c.band.high - c.band.low) - BAND_MIN_WIDTH_F) < 1e-9
            && std::fabs((c.band.low + c.band.high) / 2 - 71.5) < 1e-9,
        "narrow temperature band widened about its middle");
  CHECK(std::fabs((c.band.vpd_high - c.band.vpd_low) - BAND_MIN_WIDTH_KPA) < 1e-9
            && std::fabs((c.band.vpd_low + c.band.vpd_high) / 2 - 1.05) < 1e-9,
        "narrow VPD band widened about its middle");
  c = L::check_band({80.0, 70.0, 1.3, 0.9});
  CHECK(c.band.high - c.band.low >= BAND_MIN_WIDTH_F - 1e-9 && c.band.vpd_high > c.band.vpd_low, "inverted repaired");
  c = L::check_band({20.0, 120.0, 0.0, 9.0});
  CHECK(c.band.low == BAND_TEMP_MIN_F && c.band.high == BAND_TEMP_MAX_F && c.band.vpd_low == BAND_VPD_MIN_KPA
            && c.band.vpd_high == BAND_VPD_MAX_KPA,
        "edges clamped to the editor's limits");
  c = L::check_band({94.0, 99.0, 2.9, 3.5});
  CHECK(c.band.high == BAND_TEMP_MAX_F && c.band.low == BAND_TEMP_MAX_F - BAND_MIN_WIDTH_F
            && c.band.vpd_high == BAND_VPD_MAX_KPA,
        "widening at a limit moves the band inside it");
  c = L::check_band({NAN, 80.0, NAN, NAN});
  CHECK(c.band.low == 80.0 - BAND_MIN_WIDTH_F && c.band.vpd_low == BAND_VPD_MIN_KPA
            && c.band.vpd_high == BAND_VPD_MAX_KPA,
        "non-finite edges replaced");
  // after the check the opposing lines cannot overlap
  Rng r{99};
  bool ok = true;
  for (int i = 0; i < 10000; ++i) {
    const L::Band b = L::check_band({r.uni(0, 140), r.uni(0, 140), r.uni(-1, 6), r.uni(-1, 6)}).band;
    ok = ok && b.low + HEAT1_OFF_ABOVE_LOW_F <= b.high - COOL_OFF_BELOW_HIGH_F + 1e-9
         && b.vpd_low + DRY_OFF_ABOVE_VPD_LOW_KPA <= b.vpd_high - FOG_OFF_BELOW_VPD_HIGH_KPA + 1e-9
         && b.low >= BAND_TEMP_MIN_F && b.high <= BAND_TEMP_MAX_F && b.vpd_low >= BAND_VPD_MIN_KPA
         && b.vpd_high <= BAND_VPD_MAX_KPA;
  }
  CHECK(ok, "any checked band keeps the heater's off line below the cooling off line and drying below fog");
  CHECK(L::dry_cost_limit(NAN) == DRY_COST_LIMIT_DEFAULT_KWH_PER_KG && L::dry_cost_limit(9) == DRY_COST_LIMIT_MAX_KWH_PER_KG
            && L::dry_cost_limit(-1) == DRY_COST_LIMIT_MIN_KWH_PER_KG && L::dry_cost_limit(0.5) == 0.5,
        "drying cost limit clamped, default when unreadable");
}

// -- invariants of section 13 over random closed trajectories -------------
static void invariants() {
  Rng r{4242};
  bool furnace_vent = false, fan_no_vent = false, wet_below_low = false, wet_drying = false, h2_without_h1 = false,
       inner_change = false, min_times = true;
  for (int traj = 0; traj < 200; ++traj) {
    L::State s;
    L::RelayState rs;
    const L::Band b = L::check_band({r.uni(45, 80), r.uni(55, 95), r.uni(0.3, 1.2), r.uni(0.8, 2.5)}).band;
    double T = r.uni(b.low - 5, b.high + 5), V = r.uni(b.vpd_low - 0.3, b.vpd_high + 0.5);
    uint32_t on_ms[6] = {}, off_ms[6] = {};
    bool prev[6] = {};
    for (int i = 0; i < 3000; ++i) {
      T += r.uni(-0.3, 0.3);
      V += r.uni(-0.02, 0.02);
      L::Inputs u = drying_inputs(T, V);
      u.band = b;
      u.out_ok = r.coin(0.9);
      const L::State before = s;
      const L::Output q = L::step(s, u);
      if (q.heat2 && q.vent) furnace_vent = true;
      if ((q.fog || q.mist) && T < b.low) wet_below_low = true;
      if ((q.fog || q.mist) && q.drying) wet_drying = true;
      if (q.heat2 && !q.heat1) h2_without_h1 = true;
      const bool inside = T > b.low + HEAT1_OFF_ABOVE_LOW_F && T < b.high - COOL_OFF_BELOW_HIGH_F
                          && V > b.vpd_low + DRY_OFF_ABOVE_VPD_LOW_KPA && V < b.vpd_high - FOG_OFF_BELOW_VPD_HIGH_KPA;
      if (inside && i > 0 && (before.h1 != s.h1 || before.h2 != s.h2 || before.cool != s.cool || before.wet != s.wet
                              || before.mist != s.mist || before.dry != s.dry || before.run != s.run)
          && !(before.h1 && !s.h1) && !(before.cool && !s.cool) && !(before.wet && !s.wet) && !(before.dry && !s.dry)
          && !(before.mist && !s.mist) && !(before.run && !s.run) && !(before.h2 && !s.h2))
        inner_change = true;  // inside every inner line a latch may only release, never engage
      L::RelayInputs in{0, 0, false, 1000};
      L::relay_step(rs, q, in);
      if (rs.heat2.on && rs.vent.on) furnace_vent = true;
      if ((rs.fan1.on || rs.fan2.on) && !rs.vent.on) fan_no_vent = true;
      const bool now[6] = {rs.heat1.on, rs.heat2.on, rs.fan1.on, rs.fan2.on, rs.fog.on, rs.vent.on};
      const uint32_t min_on[6] = {HEAT_MIN_ON_S, HEAT_MIN_ON_S, FAN_MIN_ON_S, FAN_MIN_ON_S, FOG_MIN_ON_S, VENT_MIN_ON_S};
      const uint32_t min_off[6] = {HEAT_MIN_OFF_S, HEAT_MIN_OFF_S, FAN_MIN_OFF_S, FAN_MIN_OFF_S, FOG_MIN_OFF_S,
                                   VENT_MIN_OFF_S};
      for (int k = 0; k < 6; ++k) {
        on_ms[k] += 1000;
        off_ms[k] += 1000;
        if (now[k] != prev[k]) {
          // a switch-off before the minimum on time is allowed only for the furnace at 100 F
          if (!now[k] && on_ms[k] < min_on[k] * MS_PER_S && !(q.hot || q.cold)) min_times = false;
          if (now[k] && off_ms[k] < min_off[k] * MS_PER_S && !(q.hot || q.cold) && (k == 1 || off_ms[k] <= uint32_t(i) * 1000))
            min_times = false;
          on_ms[k] = off_ms[k] = 0;
          prev[k] = now[k];
        }
      }
    }
  }
  CHECK(!furnace_vent, "invariant: furnace and vent never on together");
  CHECK(!fan_no_vent, "invariant: no fan without the vent");
  CHECK(!wet_below_low, "invariant: no fog or mist below the low edge");
  CHECK(!wet_drying, "invariant: no fog or mist while drying");
  CHECK(!h2_without_h1, "invariant: the electric heater is requested whenever the furnace is");
  CHECK(!inner_change, "invariant: no request starts while the house is inside every inner line");
  CHECK(min_times, "invariant: minimum on and off times honoured outside the cut table");
}

// -- 4.8: the mister pulse request ---------------------------------------
static L::MisterInputs mister_inputs(double vpd) {
  L::MisterInputs m{};
  m.request = true;
  m.allowed[ZONE_CENTER] = true;
  for (int z = 0; z < ZONE_COUNT; ++z) {
    m.zone_vpd[z] = vpd;
    m.since_fire_ms[z] = 0;
    m.min_off_ready[z] = true;
  }
  m.vpd_high = 1.2;
  m.dt_ms = 1000;
  return m;
}

static void mister_request() {
  L::MisterState s;
  L::MisterInputs m = mister_inputs(1.3);
  m.request = false;
  L::MisterCommand c = L::mister_step(s, m);
  CHECK(c.open_zone < 0 && !c.close_all, "no request: nothing asked");
  m.request = true;
  c = L::mister_step(s, m);
  CHECK(c.open_zone == ZONE_CENTER && c.pulse_ms == MISTER_PULSE_S * MS_PER_S, "plain pulse on the centre line");
  CHECK(s.phase != L::MISTER_PULSE && s.zone < 0, "no pulse is counted open without the grant");
  // refused grant: asked again one pulse length later
  for (uint32_t t = 1000; t < MISTER_PULSE_S * MS_PER_S; t += 1000) {
    c = L::mister_step(s, m);
    CHECK(c.open_zone < 0, "refused: waits one pulse length");
  }
  c = L::mister_step(s, m);
  CHECK(c.open_zone == ZONE_CENTER, "refused: asks again at the next pulse boundary");
  L::mister_opened(s, c.open_zone, c.pulse_ms);
  uint32_t on = 0;
  do {
    c = L::mister_step(s, m);
    on += m.dt_ms;
  } while (!c.close_all && on < 10 * MISTER_PULSE_S * MS_PER_S);
  CHECK(on == MISTER_PULSE_S * MS_PER_S, "the pulse closes after its length");
  uint32_t gap = 0;
  do {
    c = L::mister_step(s, m);
    gap += m.dt_ms;
  } while (c.open_zone < 0 && gap < 10 * MISTER_GAP_S * MS_PER_S);
  CHECK(gap == MISTER_GAP_S * MS_PER_S, "the next pulse after the gap");
  // the request ends: close at once
  L::mister_opened(s, c.open_zone, c.pulse_ms);
  m.request = false;
  c = L::mister_step(s, m);
  CHECK(c.close_all && s.phase == L::MISTER_GAP, "request ends: pulse closed at once, the gap still owed");
  // the longer pulse (ruling B4)
  CHECK(L::mister_pulse_ms(1.2 * MISTER_LONG_PULSE_VPD_RATIO + 0.01, 1.2)
            == uint32_t(std::lround(MISTER_PULSE_S * MS_PER_S * MISTER_LONG_PULSE_FACTOR)),
        "pulse x1.4 above 1.2 x vpd_high");
  CHECK(L::mister_pulse_ms(1.2 * MISTER_LONG_PULSE_VPD_RATIO, 1.2) == MISTER_PULSE_S * MS_PER_S,
        "plain pulse at 1.2 x vpd_high");
  // zone choice: rank among stressed allowed zones (centre 1), fairness for an overdue zone, fence
  s = {};
  m = mister_inputs(1.6);
  m.allowed[ZONE_SOUTH] = m.allowed[ZONE_WEST] = true;
  CHECK(L::mister_choose_zone(m) == ZONE_CENTER, "rank: centre first");
  CHECK(L::mister_fairness_zone(m) == -1, "I6: no overdue zone, no fairness pick");
  m.zone_vpd[ZONE_CENTER] = 1.0;
  CHECK(L::mister_choose_zone(m) == ZONE_SOUTH, "rank: south when centre is not above the edge");
  m.zone_vpd[ZONE_CENTER] = 1.6;
  m.since_fire_ms[ZONE_WEST] = MISTER_OVERDUE_S * MS_PER_S + 1;
  CHECK(L::mister_choose_zone(m) == ZONE_WEST, "fairness: an overdue stressed zone goes first");
  CHECK(L::mister_fairness_zone(m) == ZONE_WEST, "I6: the fairness pick is the zone counted");
  m.zone_vpd[ZONE_WEST] = 1.1;
  CHECK(L::mister_choose_zone(m) == ZONE_CENTER, "fairness only for a zone above the band's high edge");
  m.min_off_ready[ZONE_CENTER] = false;
  CHECK(L::mister_choose_zone(m) == ZONE_SOUTH, "fence: another ready zone takes the pulse");
  m.min_off_ready[ZONE_SOUTH] = m.min_off_ready[ZONE_WEST] = false;
  CHECK(L::mister_choose_zone(m) < 0, "fence: no ready zone, the pulse waits");
  m = mister_inputs(1.6);
  m.allowed[ZONE_CENTER] = false;
  c = L::mister_step(s, m);
  CHECK(c.open_zone < 0, "no allowed zone: no pulse");
  m = mister_inputs(1.6);
  m.since_fire_ms[ZONE_CENTER] = MISTER_OVERDUE_S * MS_PER_S + 1;
  CHECK(L::mister_choose_zone(m) == ZONE_CENTER, "one member line: fairness never changes the choice");
}

// -- 8.7: the engine's inputs ---------------------------------------------
static void engine_inputs() {
  const double z[ZONE_COUNT] = {NAN, 1.0, VPD_EMERGENCY_KPA + 0.1, NAN};
  CHECK(L::vpd_emergency(1.0, z), "VPD emergency from a zone reading");
  const double z2[ZONE_COUNT] = {NAN, NAN, NAN, NAN};
  CHECK(!L::vpd_emergency(VPD_EMERGENCY_KPA, z2) && L::vpd_emergency(VPD_EMERGENCY_KPA + 0.01, z2),
        "VPD emergency above the compiled level");
  CHECK(!L::vpd_emergency(NAN, z2), "no reading: no emergency");
  CHECK(L::zone_gate_safety_ok(false, false, 1.5, 1.2, WET_DEW_MARGIN_F), "zone gate: open at the dew margin");
  CHECK(!L::zone_gate_safety_ok(false, false, 1.5, 1.2, WET_DEW_MARGIN_F - 0.1), "zone gate: dew margin");
  CHECK(!L::zone_gate_safety_ok(true, false, 1.5, 1.2, 20), "zone gate: occupancy");
  CHECK(!L::zone_gate_safety_ok(false, true, 1.5, 1.2, 20), "zone gate: feed hold");
  CHECK(!L::zone_gate_safety_ok(false, false, 1.2, 1.2, 20), "zone gate: VPD above the high edge");
  // occupancy with the rule 6 latch set gives climate_demand false
  L::State s;
  L::Output q = L::step(s, base_inputs(70, kBand.vpd_high + 0.5));
  CHECK(q.mist && q.fog, "rule 5 and 6 latches set");
  CHECK(!L::climate_demand(q, /*fog held (occupancy)*/ true, true, false, /*occupied*/ true),
        "occupancy: climate_demand false");
  CHECK(L::climate_demand(q, false, true, false, false), "nothing holds: climate_demand true");
  CHECK(!L::climate_demand(q, true, true, true, false), "soft budget and a fog hold: no demand");
  L::Output cold_house = L::step(s, base_inputs(kBand.low - 1, kBand.vpd_high + 0.5));
  CHECK(!L::climate_demand(cold_house, false, true, false, false), "the cold-house guard never makes a drip yield");
}

// -- 11.1: the legacy labels ---------------------------------------------
static void legacy_labels() {
  L::LegacyInputs in{};
  in.T = 70; in.vpd = 1.0; in.band = kBand;
  in.sensor_fault = true;
  CHECK(L::legacy_state(in).action == CLIMATE_SENSOR_FAULT && L::legacy_state(in).mode == SENSOR_FAULT, "fault");
  in.sensor_fault = false;
  in.T = SAFETY_MAX_F;
  CHECK(L::legacy_state(in).mode == SAFETY_COOL && L::legacy_state(in).axis == CLIMATE_PRIORITY_SAFETY, "hot");
  in.T = SAFETY_MIN_F;
  CHECK(L::legacy_state(in).mode == SAFETY_HEAT, "cold");
  in.T = 70;
  in.vent_on = true; in.fog_on = true; in.drying = true;
  CHECK(L::legacy_state(in).action == CLIMATE_VENT_COOL_FOG_ASSIST, "vent + fog: keyed on the relays");
  in.fog_on = false; in.mister_on = true;
  CHECK(L::legacy_state(in).action == CLIMATE_VENT_COOL_MIST_ASSIST, "vent + mister");
  in.mister_on = false;
  CHECK(L::legacy_state(in).mode == DEHUM_VENT && L::legacy_state(in).axis == CLIMATE_PRIORITY_VPD, "drying");
  in.drying = false;
  CHECK(L::legacy_state(in).action == CLIMATE_VENT_COOL, "vent otherwise");
  in.vent_on = false; in.fog_on = true;
  L::LegacyState ls = L::legacy_state(in);
  CHECK(ls.mode == SEALED_MIST && ls.mist_stage == MIST_FOG && ls.action == CLIMATE_SEALED_FOG, "sealed fog");
  in.fog_on = false; in.mister_on = true;
  ls = L::legacy_state(in);
  CHECK(ls.mode == SEALED_MIST && ls.mist_stage == MIST_S1 && ls.action == CLIMATE_SEALED_HUMIDIFY, "sealed mist");
  in.mister_on = false; in.heat1_on = true;
  CHECK(L::legacy_state(in).action == CLIMATE_HEAT && L::legacy_state(in).mode == IDLE, "heat");
  in.heat1_on = false;
  CHECK(L::legacy_state(in).axis == CLIMATE_PRIORITY_RESOURCE, "idle in band: resource");
  in.vpd = 2.0;
  CHECK(L::legacy_state(in).axis == CLIMATE_PRIORITY_VPD, "idle, VPD out: vpd");
  in.T = 90;
  CHECK(L::legacy_state(in).axis == CLIMATE_PRIORITY_TEMP, "idle, temperature out: temp");
}

// -- non-finite inputs fail safe (review M1, M2, m12), the checked entry (m2), the review's test gaps (m3, m4, m11) --
static void nonfinite_and_gaps() {
  // M1: a NaN temperature after the furnace latched: every request off, the state cleared
  L::State s;
  L::Output q = L::step(s, base_inputs(kBand.low - 1, 1.0));
  CHECK(s.h2 && q.heat2, "furnace latched");
  q = L::step(s, base_inputs(NAN, 1.0));
  CHECK(!q.heat1 && !q.heat2 && !q.vent && q.fans == 0 && !q.fog && !q.mist && !q.drying && !s.h1 && !s.h2
            && q.dry_refusal == L::DRY_NO_TEMPERATURE,
        "M1: NaN temperature: the law does not act");
  s = {};
  L::step(s, base_inputs(kBand.high + 3, 1.0));
  q = L::step(s, base_inputs(INFINITY, 1.0));
  CHECK(!q.vent && q.fans == 0 && !q.hot && !s.cool, "M1: infinite temperature: no request (not read as 100 F)");
  s = {};
  L::Inputs u = base_inputs(kBand.low - 1, 1.0);
  L::step(s, u);
  u.temp_valid = false;
  q = L::step(s, u);
  CHECK(!q.heat1 && !q.heat2 && q.dry_refusal == L::DRY_NO_TEMPERATURE, "G2: temperature not valid: the law is off");
  // M1: a NaN VPD after fog latched
  s = {};
  q = L::step(s, base_inputs(70, kBand.vpd_high + 0.5));
  CHECK(q.fog && q.mist, "fog and mist latched");
  q = L::step(s, base_inputs(70, NAN));
  CHECK(!q.fog && !q.mist && !s.wet && !s.mist && q.dry_refusal == L::DRY_HUMIDITY_INVALID, "M1: NaN VPD: fog stops");
  // G2: no valid humidity, valid temperature: the temperature rules and the protection limits still run
  s = {};
  u = base_inputs(SAFETY_MAX_F + 1, NAN);
  q = L::step(s, u);
  CHECK(q.hot && q.vent && q.fans == 2 && !q.fog, "G2: 100 F protection runs without humidity");
  s = {};
  u = base_inputs(SAFETY_MIN_F - 1, NAN);
  q = L::step(s, u);
  CHECK(q.cold && q.heat1 && q.heat2, "G2: 40 F protection runs without humidity");
  // M2: a NaN outdoor temperature with out_ok: no drying, refusal no_outdoor
  s = {};
  u = drying_inputs(70, kBand.vpd_low);
  q = L::step(s, u);
  CHECK(q.drying, "drying runs with valid outdoor data");
  s = {};
  u.out_T = NAN;
  q = L::step(s, u);
  CHECK(!q.drying && !s.air && q.dry_refusal == L::DRY_NO_OUTDOOR, "M2: NaN outdoor temperature: no drying");
  // M2: a running run stops when the dew points turn non-finite (the air latch does not hold)
  s = {};
  u = drying_inputs(70, kBand.vpd_low);
  L::step(s, u);
  for (double L::Inputs::*f : {&L::Inputs::out_dp_f, &L::Inputs::dp_f, &L::Inputs::w_in, &L::Inputs::w_out}) {
    L::State t = s;
    L::Inputs v = u;
    v.*f = NAN;
    q = L::step(t, v);
    CHECK(!q.drying && !t.run && q.dry_refusal == L::DRY_NO_OUTDOOR, "M2: a non-finite drying input stops the run");
  }
  // m12: the drying cost limit passed as NaN refuses (no start at any price)
  s = {};
  u = drying_inputs(70, kBand.vpd_low);
  u.dry_cost_limit = NAN;
  q = L::step(s, u);
  CHECK(!q.drying && q.dry_refusal == L::DRY_COST, "m12: a NaN limit passed in refuses");
  // m12: no non-finite input sets a request that a finite one would not
  Rng r{31337};
  bool safe = true;
  for (int i = 0; i < 20000; ++i) {
    L::State t;
    L::Inputs v = drying_inputs(r.uni(30, 110), r.uni(0, 3));
    double* fields[] = {&v.T, &v.vpd, &v.dp_f, &v.out_T, &v.out_dp_f, &v.w_in, &v.w_out};
    const double bad[] = {NAN, INFINITY, -INFINITY};
    *fields[r.next() % 7] = bad[r.next() % 3];
    for (int k = 0; k < 3; ++k) q = L::step(t, v);
    if (!std::isfinite(v.T) && (q.heat1 || q.heat2 || q.vent || q.fans || q.fog || q.mist)) safe = false;
    if (!std::isfinite(v.vpd) && (q.fog || q.mist || q.drying)) safe = false;
    if ((!std::isfinite(v.out_T) || !std::isfinite(v.out_dp_f) || !std::isfinite(v.dp_f)) && q.drying) safe = false;
    if (q.drying && !(q.dry_cost <= v.dry_cost_limit)) safe = false;
  }
  CHECK(safe, "m12: non-finite inputs never request heat, air, water or drying they should not");
  // m11: refusal order: cooling before furnace (an unchecked inverted band latches both)
  s = {};
  u = drying_inputs(72, 0.5);
  u.band = {80.0, 65.0, 0.8, 1.25};
  q = L::step(s, u);
  CHECK(s.cool && s.h2 && s.dry && q.dry_refusal == L::DRY_COOLING, "m11: refusal order cooling, then furnace");
  // m2: step_checked() runs the band check first
  s = {};
  L::State s2;
  u = drying_inputs(72, 0.5);
  u.band = {80.0, 65.0, 0.8, 1.25};
  bool repaired = false;
  const L::Output a = L::step_checked(s, u, &repaired);
  L::Inputs c = u;
  c.band = L::check_band(u.band).band;
  const L::Output b = L::step(s2, c);
  CHECK(repaired && a.cooling == b.cooling && a.heat2 == b.heat2 && a.heat1 == b.heat1 && a.vent == b.vent
            && !(a.cooling && a.heat2),
        "m2: step_checked equals step on the checked band; no cooling inside a repaired band with the furnace");
  // m11: check_band with a non-finite high edge takes the low edge plus the minimum width
  const L::Band nb = L::check_band({70.0, NAN, 1.0, NAN}).band;
  CHECK(nb.high == 70.0 + BAND_MIN_WIDTH_F && std::fabs(nb.vpd_high - (1.0 + BAND_MIN_WIDTH_KPA)) < 1e-12,
        "m11: non-finite high edges");
  // m11: vpd_emergency leaves out the centre zone (it is the house average)
  const double zc[ZONE_COUNT] = {VPD_EMERGENCY_KPA + 0.1, NAN, NAN, NAN};
  CHECK(!L::vpd_emergency(2.0, zc), "m11: the centre zone is not an emergency term");
  const double zs[ZONE_COUNT] = {NAN, VPD_EMERGENCY_KPA + 0.1, NAN, NAN};
  CHECK(L::vpd_emergency(2.0, zs), "m11: south is");
  // m11: fairness fires strictly after the overdue time
  L::MisterInputs m = mister_inputs(1.6);
  m.allowed[ZONE_SOUTH] = true;
  m.since_fire_ms[ZONE_SOUTH] = MISTER_OVERDUE_S * MS_PER_S;
  CHECK(L::mister_choose_zone(m) == ZONE_CENTER, "m11: not overdue at exactly the overdue time");
  m.since_fire_ms[ZONE_SOUTH] = MISTER_OVERDUE_S * MS_PER_S + 1;
  CHECK(L::mister_choose_zone(m) == ZONE_SOUTH, "m11: overdue one millisecond later");
  // m4: a saturated counter (never fired since boot) is overdue
  m.since_fire_ms[ZONE_SOUTH] = UINT32_MAX;
  CHECK(L::mister_choose_zone(m) == ZONE_SOUTH, "m4: never fired counts as overdue");
  // m3: the open pulse closes when its own line alone is disallowed, and the gap is kept
  L::MisterState ms;
  m = mister_inputs(1.6);
  m.allowed[ZONE_SOUTH] = true;
  L::MisterCommand cmd = L::mister_step(ms, m);
  L::mister_opened(ms, cmd.open_zone, cmd.pulse_ms);
  L::mister_step(ms, m);
  m.allowed[cmd.open_zone] = false;
  L::MisterCommand c2 = L::mister_step(ms, m);
  CHECK(c2.close_all && ms.phase == L::MISTER_GAP && ms.timer_ms == MISTER_GAP_S * MS_PER_S,
        "m3: own line disallowed: closed now, the gap follows");
  // m3: a request flap does not skip the gap
  ms = {};
  m = mister_inputs(1.6);
  cmd = L::mister_step(ms, m);
  L::mister_opened(ms, cmd.open_zone, cmd.pulse_ms);
  m.request = false;
  L::mister_step(ms, m);
  L::mister_step(ms, m);
  m.request = true;
  uint32_t gap = m.dt_ms;  // the second flap tick
  while (L::mister_step(ms, m).open_zone < 0 && gap < 10 * MISTER_GAP_S * MS_PER_S) gap += m.dt_ms;
  CHECK(gap + m.dt_ms == MISTER_GAP_S * MS_PER_S, "m3: after a request flap the next pulse waits the whole gap");
}

// -- Stage B: the no-indoor table, the drying meter and the payloads; writes the contract samples ----------
static std::string samples_dir() {
  const char* d = std::getenv("CLIMATE_LAW_SAMPLES_DIR");
  return d ? std::string(d) : std::string();
}
static void write_sample(const char* name, const char* text) {
  const std::string d = samples_dir();
  if (d.empty()) return;
  FILE* f = std::fopen((d + "/" + name).c_str(), "w");
  if (!f) return;
  std::fprintf(f, "%s\n", text);
  std::fclose(f);
}
static bool json_shape_ok(const char* t) {  // one object, balanced, no NaN or inf text
  int depth = 0;
  for (const char* c = t; *c; ++c) {
    if (*c == '{' || *c == '[') ++depth;
    if (*c == '}' || *c == ']') --depth;
    if (depth < 0) return false;
  }
  return depth == 0 && t[0] == '{' && !std::strstr(t, "nan") && !std::strstr(t, "inf");
}

static void stage_b_payloads() {
  // the no-indoor table through the relay layer: vent + lead fan, or the electric heater; the entry cut
  RelayOutputs vent_tab{false, false, true, false, false, true};
  L::Output o = L::output_from_relays(vent_tab);
  CHECK(o.vent && o.fans == 1 && !o.heat1 && !o.heat2, "no-indoor vent row as a request");
  L::RelayState r = after_boot_wait();
  L::Output heat{};
  heat.heat1 = heat.heat2 = true;
  L::relay_step(r, heat, L::RelayInputs{0, 0, false, 1000});
  CHECK(r.heat1.on && r.heat2.on, "heaters running");
  L::RelayInputs entry{0, 0, false, 1000};
  entry.cut_unwanted = true;
  L::relay_step(r, o, entry);
  CHECK(!r.heat1.on && !r.heat2.on && r.vent.on, "entry cut: heaters off at once, the vent opens");
  L::relay_step(r, o, L::RelayInputs{0, 0, false, 1000});
  CHECK(r.fan1.on && r.vent.on, "the lead fan follows");
  L::relay_step(r, L::Output{}, L::RelayInputs{0, 0, false, 1000});
  CHECK(r.fan1.on && r.vent.on, "after the entry pass the minimum times apply again");

  // the humidity ratio from the dew point agrees with the device's mixing ratio at saturation (greenhouse_logic.h)
  for (double dp : {20.0, 45.0, 60.0, 75.0}) {
    const double w = L::humidity_ratio_g_per_kg(dp);
    CHECK(std::fabs(w - double(mixing_ratio_g_kg(float(dp), 100.0f))) < 0.01, "humidity ratio from dew point");
  }
  CHECK(std::isnan(L::humidity_ratio_g_per_kg(NAN)), "humidity ratio of NaN is NaN");
  // relay_sync: an override's edge restarts the minimum times
  {
    L::RelayState rs2 = after_boot_wait();
    RelayOutputs phys{false, false, true, true, false, true};  // a FANS press: vent and both fans
    L::relay_sync(rs2, phys);
    CHECK(rs2.fan1.on && rs2.fan2.on && rs2.vent.on && rs2.fan1.since_ms == 0, "sync takes the pressed relays");
    L::relay_step(rs2, L::Output{}, L::RelayInputs{0, 0, false, 1000});
    CHECK(rs2.fan1.on && rs2.vent.on, "after a sync the fans keep their minimum on time");
  }
  // a drying run, 30 minutes, through law, relay layer and meter
  L::State s;
  L::RelayState rs = after_boot_wait();
  L::DryingMeter m;
  L::Inputs u = drying_inputs(70, kBand.vpd_low);  // out_T 65, w_in 9, w_out 6
  L::Output q;
  for (int i = 0; i < 1800; ++i) {
    q = L::step_checked(s, u);
    L::relay_step(rs, q, L::RelayInputs{0, 0, false, 1000});
    L::drying_meter_step(m, s, q, rs.vent.on, rs.fan1.on || rs.fan2.on, u, 1000);
  }
  CHECK(q.drying && m.s == 1800, "meter: 1800 s of drying with the vent open");
  const double mv = DRY_METER_VENT_KG_PER_S + DRY_METER_FAN_KG_PER_S;
  const double g = DRY_METER_VENT_KG_PER_S * 3.0 * 1 + mv * 3.0 * 1799;  // the fan joins on the second pass
  CHECK(std::fabs(double(m.g) - g) <= 1.0, "meter: water carried out");
  const double wh = (DRY_METER_VENT_KG_PER_S * 1 + mv * 1799) * AIR_CP_KJ_PER_KG_K * (5.0 / F_PER_K) / 3.6;
  CHECK(std::fabs(double(m.wh) - wh) <= 1.0, "meter: heat carried out");
  char rec[256];
  int n = L::format_state_record(rec, sizeof rec, s, q, u.dry_cost_limit, false, u.band);
  CHECK(n > 0 && n <= 200 && json_shape_ok(rec) && std::strstr(rec, "\"dr\":\"none\""), "state record while drying");
  write_sample("climate_law_state.drying.json", rec);
  // refused by cost: the dry latch counts as wanted-but-refused seconds
  L::State s2;
  L::Inputs cold = drying_inputs(70, kBand.vpd_low);
  cold.out_T = -10;
  cold.w_out = 8.5;
  for (int i = 0; i < 600; ++i) {
    q = L::step_checked(s2, cold);
    L::drying_meter_step(m, s2, q, false, false, cold, 1000);
  }
  CHECK(q.dry_refusal == L::DRY_COST && m.rw == 600, "meter: refused seconds");
  n = L::format_state_record(rec, sizeof rec, s2, q, cold.dry_cost_limit, false, cold.band);
  CHECK(json_shape_ok(rec) && std::strstr(rec, "\"dr\":\"cost\""), "state record refused by cost");
  write_sample("climate_law_state.refused_cost.json", rec);
  char met[128];
  n = L::format_drying_meter(met, sizeof met, m);
  CHECK(n > 0 && json_shape_ok(met), "drying meter payload");
  write_sample("climate_drying_meter.json", met);
  // no outdoor data: e is null
  L::State s3;
  L::Inputs no_out = drying_inputs(70, kBand.vpd_low);
  no_out.out_ok = false;
  q = L::step_checked(s3, no_out);
  L::format_state_record(rec, sizeof rec, s3, q, no_out.dry_cost_limit, false, no_out.band);
  CHECK(json_shape_ok(rec) && std::strstr(rec, "\"e\":null") && std::strstr(rec, "\"dr\":\"no_outdoor\""),
        "state record with no outdoor data");
  write_sample("climate_law_state.no_outdoor.json", rec);
  // cooling at 100 F with a repaired band
  L::State s4;
  L::Inputs hot = base_inputs(SAFETY_MAX_F + 1, 1.0);
  hot.band = {70.0, 72.0, 1.0, 1.1};
  bool repaired = false;
  q = L::step_checked(s4, hot, &repaired);
  L::format_state_record(rec, sizeof rec, s4, q, hot.dry_cost_limit, repaired, L::check_band(hot.band).band);
  CHECK(json_shape_ok(rec) && std::strstr(rec, "\"br\":1") && (L::request_bits(q) >> 9 & 1u), "state record at 100 F");
  write_sample("climate_law_state.hot_repaired_band.json", rec);
  // no valid humidity; no valid temperature
  L::State s5;
  L::Inputs hum = base_inputs(70, NAN);
  hum.humidity_valid = false;
  q = L::step_checked(s5, hum);
  L::format_state_record(rec, sizeof rec, s5, q, hum.dry_cost_limit, false, hum.band);
  CHECK(json_shape_ok(rec) && std::strstr(rec, "\"dr\":\"humidity_invalid\""), "state record, humidity invalid");
  write_sample("climate_law_state.humidity_invalid.json", rec);
  L::State s6;
  L::Inputs not_t = base_inputs(NAN, NAN);
  not_t.temp_valid = false;
  q = L::step_checked(s6, not_t);
  L::format_state_record(rec, sizeof rec, s6, q, not_t.dry_cost_limit, false, not_t.band);
  CHECK(json_shape_ok(rec) && std::strstr(rec, "\"l\":0,\"o\":0") && std::strstr(rec, "\"dr\":\"no_temperature\""),
        "state record, no temperature");
  write_sample("climate_law_state.no_temperature.json", rec);
  // the longest record fits in 200 characters
  L::State big;
  big.h1 = big.h2 = big.cool = big.cool2 = big.wet = big.mist = big.dry = big.air = big.run = true;
  L::Output bq{};
  bq.dry_cost = DRY_COST_NONE_KWH_PER_KG;
  bq.dry_refusal = L::DRY_HUMIDITY_INVALID;
  n = L::format_state_record(rec, sizeof rec, big, bq, -1.25, true, {-140.5, -140.5, -10.25, -10.25});
  CHECK(n <= 200, "the longest state record fits in 200 characters");
  // the constants hash
  CHECK(std::strlen(L::constants_hash()) == 64, "constants hash is 64 hex");
  write_sample("climate_law_constants.txt", L::constants_hash());
}

// -- RULINGS AG1: the case sensor holds the humidity rules, through the wiring's own input path -----------
// The controller builds the law's inputs from select_indoor_reading() (running_alone.h) and law_humidity_valid()
// (the glue); this test does the same with the wall probes lost and a finite case humidity.
static L::Inputs law_inputs_from(const IndoorReading& in) {
  L::Inputs u = base_inputs(in.temp_f, in.vpd_kpa);
  u.dp_f = in.dew_point_f;
  u.w_in = L::humidity_ratio_g_per_kg(in.dew_point_f);
  u.humidity_valid = L::law_humidity_valid(true, in);
  return u;
}

static void law_case_sensor_holds_humidity_rules() {
  const float off = running_alone_k::CASE_SENSOR_OFFSET_F;
  // Dry air in the band: on the wall averages the law wets; on the case sensor (same air) it does not.
  const IndoorReading wall = select_indoor_reading(75.0f, 25.0f, NAN, NAN, false, NAN, NAN);
  CHECK(wall.source == IndoorSource::kWall && L::law_humidity_valid(true, wall), "AG1 setup: wall humidity valid");
  L::State s;
  L::Output q = L::step(s, law_inputs_from(wall));
  CHECK(q.fog && q.mist, "AG1 setup: dry air on the wall averages fogs and mists");
  const IndoorReading dry_case = select_indoor_reading(NAN, NAN, NAN, NAN, true, 75.0f + off, 25.0f);
  CHECK(dry_case.source == IndoorSource::kCase && dry_case.humidity_valid && std::isfinite(dry_case.vpd_kpa),
        "AG1 setup: the case sensor alone gives a finite case humidity");
  CHECK(!L::law_humidity_valid(true, dry_case), "AG1: the law's humidity is not valid on the case sensor");
  s = {};
  q = L::step(s, law_inputs_from(dry_case));
  CHECK(!q.fog && !q.mist && !q.drying, "AG1: no fog and no mist on the case air");
  // Wet air: no drying on the case air (the wall averages would dry with the same outdoor air).
  const IndoorReading wet_wall = select_indoor_reading(72.0f, 97.0f, NAN, NAN, false, NAN, NAN);
  L::Inputs u = law_inputs_from(wet_wall);
  u.out_ok = true;
  u.out_T = 60.0;
  u.out_dp_f = wet_wall.dew_point_f - 15.0;
  u.w_out = L::humidity_ratio_g_per_kg(u.out_dp_f);
  s = {};
  q = L::step(s, u);
  CHECK(q.drying && q.vent && q.fans == 1, "AG1 setup: wet air on the wall averages dries");
  const IndoorReading wet_case = select_indoor_reading(NAN, NAN, NAN, NAN, true, 72.0f + off, 97.0f);
  L::Inputs uc = law_inputs_from(wet_case);
  uc.out_ok = true;
  uc.out_T = u.out_T;
  uc.out_dp_f = u.out_dp_f;
  uc.w_out = u.w_out;
  s = {};
  q = L::step(s, uc);
  CHECK(!q.drying && !q.vent && q.fans == 0 && q.dry_refusal == L::DRY_HUMIDITY_INVALID,
        "AG1: no drying vent on the case air");
  // The temperature rules run on the case sensor.
  s = {};
  q = L::step(s, law_inputs_from(select_indoor_reading(NAN, NAN, NAN, NAN, true, 60.0f + off, 25.0f)));
  CHECK(q.heat1 && q.heat2 && !q.fog && !q.mist, "AG1: a cold house heats on the case sensor, no wetting");
  s = {};
  q = L::step(s, law_inputs_from(select_indoor_reading(NAN, NAN, NAN, NAN, true, 88.0f + off, 25.0f)));
  CHECK(q.cooling && q.vent && q.fans >= 1 && !q.fog && !q.mist, "AG1: a hot house cools on the case sensor, no wetting");
  // No exception at 100 F: the protection's vent and both fans run, the law's fog does not.
  s = {};
  q = L::step(s, law_inputs_from(select_indoor_reading(NAN, NAN, NAN, NAN, true, float(SAFETY_MAX_F) + off, 25.0f)));
  CHECK(q.hot && q.vent && q.fans == 2 && !q.fog && !q.mist, "AG1: at 100 F on the case sensor, air but no fog");
  // The HUMID press keeps the case dew point: the case reading's own humidity stays valid for it.
  CHECK(dry_case.humidity_valid && std::isfinite(dry_case.dew_point_f), "AG1: the press still reads the case dew point");
}

// -- RULINGS AG2: the law's own fog keeps the 8 F dew-point margin ---------------------------------
static void law_fog_wet_rails() {
  CHECK(!L::law_fog_dew_margin_ok(IDLE, 90.0, 82.5), "AG2: under 8 F of margin, no fog");
  CHECK(L::law_fog_dew_margin_ok(IDLE, 90.0, 90.0 - WET_DEW_MARGIN_F), "AG2: at 8 F of margin, fog");
  CHECK(!L::law_fog_dew_margin_ok(IDLE, 90.0, NAN), "AG2: no dew point, no margin, no fog");
  CHECK(!L::law_fog_dew_margin_ok(SAFETY_COOL, SAFETY_MAX_F, SAFETY_MAX_F - 7.0), "AG2: at 100 F the margin holds");
  CHECK(L::law_fog_dew_margin_ok(SENSOR_FAULT, NAN, NAN), "AG2: SENSOR_FAULT is the fog lock's, not the margin's");
  // The controller's path: the law asks for fog with a 6.6 F margin (99 F, VPD 1.3 kPa); the gated request reaches
  // neither the relay nor the engine's fog demand.
  const double T = 99.0;
  const float rh = 100.0f * (1.0f - 1.3f / indoor_vpd_kpa(float(T), 0.0f));  // 0 % RH: the saturation pressure
  L::Inputs u = base_inputs(T, 1.3);
  u.dp_f = dew_point_magnus_f(float(T), rh);
  L::State s;
  const L::Output law = L::step(s, u);
  CHECK(law.fog && T - u.dp_f < WET_DEW_MARGIN_F, "AG2 setup: the law fogs inside the margin");
  L::Output req = law;
  if (!L::law_fog_dew_margin_ok(IDLE, T, u.dp_f)) req.fog = false;
  L::RelayState r = after_boot_wait();
  RelayOutputs phys{false, false, false, false, false, false};
  bool fog_on = false;
  for (int i = 0; i < 30; ++i) {
    const L::RelayPass p = L::relay_pass(r, req, L::RelayInputs{0, 0, false, 1000}, phys,
                                         ManualOverrides{false, false, false, false}, IDLE);
    phys = p.out;
    L::relay_sync(r, phys);
    fog_on = fog_on || phys.fog;
  }
  CHECK(!fog_on, "AG2: no fog relay inside the margin");
  CHECK(!L::climate_fog_wanted(req, ManualForce{false, false, false}, false, true),
        "AG2: the engine's fog demand reads the same gated request");
  // The telemetry reads the same gated request: fog_block_reason names the hold, and the vent-assist status (vent
  // open for cooling, nothing wet on) is not "blocked" on a fog the margin dropped.
  CHECK(std::strcmp(L::law_fog_wait_word(law.fog, req.fog), "dew_margin") == 0, "AG2: the ladder says dew_margin");
  CHECK(std::strcmp(L::law_fog_wait_word(true, true), "relay_min_off") == 0 &&
            std::strcmp(L::law_fog_wait_word(false, false), "none") == 0,
        "AG2: the ladder's other rungs keep their words");
  L::LegacyInputs vx{};
  vx.T = T; vx.vpd = 1.3; vx.band = kBand; vx.vent_on = true;
  CHECK(law.vent && L::vent_assist_status(L::legacy_state(vx), true, law, false) == L::VentAssistStatus::kBlocked,
        "AG2 setup: on the ungated request the vent-assist status reads blocked");
  CHECK(L::vent_assist_status(L::legacy_state(vx), true, req, false) == L::VentAssistStatus::kInactive,
        "AG2: on the gated request the vent-assist status is inactive, not blocked:none");
  CHECK(L::climate_fog_wanted(law, ManualForce{false, false, false}, false, true),
        "AG2 setup: the ungated request would have asked the engine");
}

// -- RULINGS AG3: the electric heater never with the air (except drying and 40 F); a cut is not a start ----------
struct RelayRig {
  L::RelayState r = after_boot_wait();
  RelayOutputs phys{false, false, false, false, false, false};
  RelayCounters c{};
  int heat1_edges = 0;        // physical heat1 switches, either way
  int heat1_off_resets = 0;   // the relay layer's heat1 switch time moved while heat1 stayed physically off
  int overlap = 0;            // passes with heat1 and the air on outside drying and 40 F
  int pass = 0, air_off_pass = -1, heat1_on_pass = -1;
  void step(const L::Output& req, Mode mode = IDLE, ManualOverrides ov = ManualOverrides{false, false, false, false}) {
    const bool was[6] = {phys.heat1, phys.heat2, phys.fan1, phys.fan2, phys.fog, phys.vent};
    const uint32_t since_before = r.heat1.since_ms;
    const L::RelayPass p = L::relay_pass(r, req, L::RelayInputs{double(c.fan_run_s[0]), double(c.fan_run_s[1]),
                                                                false, 1000}, phys, ov, mode);
    if (p.out.heat1 != phys.heat1) ++heat1_edges;
    const bool air_was = phys.vent || phys.fan1 || phys.fan2;
    phys = p.out;
    L::relay_sync(r, phys);  // the controller's call after the drivers switch
    const bool is[6] = {phys.heat1, phys.heat2, phys.fan1, phys.fan2, phys.fog, phys.vent};
    if (!was[0] && !is[0] && r.heat1.since_ms < since_before) ++heat1_off_resets;
    relay_counters_tick(c, was, is, 1000);
    const bool air = phys.vent || phys.fan1 || phys.fan2;
    if (phys.heat1 && air && !req.drying && !req.cold) ++overlap;
    if (air_was && !air && air_off_pass < 0) air_off_pass = pass;
    if (!was[0] && is[0]) heat1_on_pass = pass;
    ++pass;
  }
};

static void glue_heater_air_interlock() {
  L::Output heat{};
  heat.heat1 = true;
  L::Output cool{};
  cool.cooling = cool.vent = true;
  cool.fans = 1;
  const int tail = int(VENT_MIN_ON_S) + int(FAN_MIN_ON_S) + int(HEAT_MIN_OFF_S) + 30;
  // (a) Cooling starts inside heat1's minimum on: heat1 is cut the pass the vent opens and stays off; it comes back
  // the pass the air is off (its minimum off long passed), with one start each way.
  {
    RelayRig g;
    for (int i = 0; i < 10; ++i) g.step(heat);
    CHECK(g.phys.heat1 && g.r.heat1.since_ms < HEAT_MIN_ON_S * MS_PER_S, "AG3 (a) setup: heat1 inside its minimum on");
    g.step(cool);
    CHECK(g.phys.vent && !g.phys.heat1, "AG3 (a): heat1 cut the pass the vent opens");
    for (int i = 0; i < int(HEAT_MIN_OFF_S) + 60; ++i) g.step(cool);
    g.air_off_pass = g.heat1_on_pass = -1;
    for (int i = 0; i < tail && g.heat1_on_pass < 0; ++i) g.step(heat);
    CHECK(g.air_off_pass > 0 && g.heat1_on_pass == g.air_off_pass + 1, "AG3 (a): heat1 starts the pass after the air is physically off");
    CHECK(g.overlap == 0 && g.c.starts[0] == 2 && g.heat1_edges == 3 && g.heat1_off_resets == 0,
          "AG3 (a): no overlap, two starts, no tick-by-tick toggling, no held start moved the off time");
  }
  // (b) The no-indoor table flips heat to vent and back (SENSOR_FAULT, not the entry tick).
  {
    const L::Output heat_row = L::output_from_relays(RelayOutputs{true, false, false, false, false, false});
    const L::Output vent_row = L::output_from_relays(RelayOutputs{false, false, true, false, false, true});
    RelayRig g;
    for (int i = 0; i < 10; ++i) g.step(heat_row, SENSOR_FAULT);
    CHECK(g.phys.heat1, "AG3 (b) setup: the table's heat row runs heat1");
    g.step(vent_row, SENSOR_FAULT);
    CHECK(g.phys.vent && !g.phys.heat1, "AG3 (b): the flip to vent cuts heat1 at once");
    for (int i = 0; i < int(HEAT_MIN_OFF_S) + 60; ++i) g.step(vent_row, SENSOR_FAULT);
    g.air_off_pass = g.heat1_on_pass = -1;
    for (int i = 0; i < tail && g.heat1_on_pass < 0; ++i) g.step(heat_row, SENSOR_FAULT);
    CHECK(g.air_off_pass > 0 && g.heat1_on_pass == g.air_off_pass + 1, "AG3 (b): heat1 waits for the air, then starts");
    CHECK(g.overlap == 0 && g.c.starts[0] == 2 && g.heat1_edges == 3 && g.heat1_off_resets == 0,
          "AG3 (b): no overlap across the flips, no toggling, no moved off time");
  }
  // (c) heat1 wanted during the air's minimum-on tail after cooling: held, no internal start, then at once.
  {
    RelayRig g;
    for (int i = 0; i < 10; ++i) g.step(cool);
    CHECK(g.phys.vent && (g.phys.fan1 || g.phys.fan2), "AG3 (c) setup: the air runs");
    int held = 0;
    for (int i = 0; i < tail && g.heat1_on_pass < 0; ++i) {
      g.step(heat);
      if (!g.phys.heat1) ++held;
    }
    CHECK(held > 200, "AG3 (c): heat1 held through the air's minimum-on tail");
    CHECK(g.heat1_on_pass == g.air_off_pass + 1, "AG3 (c): heat1 starts the pass after the air is physically off");
    CHECK(g.overlap == 0 && g.c.starts[0] == 1 && g.heat1_edges == 1 && g.heat1_off_resets == 0,
          "AG3 (c): one start, no toggling, the held start moved no counter and no switch time");
  }
  // (d) heat1 wanted after a short manual fan run: the latch ends before the fans' minimum on; the fans finish it with
  // the vent open and heat1 waits for them.
  {
    RelayRig g;
    for (int i = 0; i < 30; ++i) g.step(heat, IDLE, ManualOverrides{true, false, false, false});
    CHECK(!g.phys.heat1 && g.phys.fan1 && g.phys.fan2 && g.phys.vent, "AG3 (d) setup: FANS runs, heat1 held");
    g.air_off_pass = -1;
    int held = 0;
    for (int i = 0; i < tail && g.heat1_on_pass < 0; ++i) {
      g.step(heat);
      if (!g.phys.heat1) ++held;
    }
    CHECK(held > 200, "AG3 (d): heat1 held while the fans finish their minimum on");
    CHECK(g.heat1_on_pass == g.air_off_pass + 1, "AG3 (d): heat1 starts the pass after the air is physically off");
    CHECK(g.overlap == 0 && g.c.starts[0] == 1 && g.heat1_edges == 1 && g.heat1_off_resets == 0,
          "AG3 (d): one start, no toggling, no moved switch time");
  }
  // AG3-1: on the pass the relay layer closes the vent (its minimum on over) heat1 does not start beside it; the
  // physical vent is still open when the drivers switch heat1.
  {
    L::Output vent_only{};
    vent_only.cooling = vent_only.vent = true;
    RelayRig g;
    for (int i = 0; i < 5; ++i) g.step(vent_only);
    CHECK(g.phys.vent && !g.phys.fan1 && !g.phys.fan2, "AG3-1 setup: the vent alone is open");
    bool start_beside_open_vent = false;
    for (int i = 0; i < int(VENT_MIN_ON_S) + 10; ++i) {
      const bool vent_before = g.phys.vent;
      g.step(heat);
      if (vent_before && g.phys.heat1) start_beside_open_vent = true;
    }
    CHECK(!start_beside_open_vent && g.phys.heat1 && g.heat1_on_pass == g.air_off_pass + 1,
          "AG3-1: heat1 starts one pass after the vent is physically closed");
  }
  // The exceptions: the law's drying keeps heat1 with the vent and its fan; at 40 F heat1 runs (the air is stopped).
  {
    L::Output drying{};
    drying.drying = drying.vent = drying.heat1 = true;
    drying.fans = 1;
    RelayRig g;
    for (int i = 0; i < 20; ++i) g.step(drying);
    CHECK(g.phys.heat1 && g.phys.vent && g.c.starts[0] == 1 && g.heat1_edges == 1,
          "AG3: drying keeps the electric heater beside the open vent");
  }
}

// -- RULINGS AG3a: the drying run's own air tail keeps the electric heater -----------------------------
static void glue_drying_tail() {
  L::Output drying{};
  drying.drying = drying.vent = drying.heat1 = true;
  drying.fans = 1;
  L::Output heat{};
  heat.heat1 = true;
  // A short drying run (60 s, under the air's 300 s minimum on) stops; the house wants heat1 only. The vent and fan
  // finish their minimum on; heat1 keeps running through that tail: no cut, no edge, no minimum-off stamp.
  {
    RelayRig g;
    for (int i = 0; i < 60; ++i) g.step(drying);
    CHECK(g.phys.heat1 && g.phys.vent && (g.phys.fan1 || g.phys.fan2), "AG3a setup: drying with heat1");
    bool tail_seen = false, heat_kept = true;
    for (int i = 0; i < int(VENT_MIN_ON_S) + int(FAN_MIN_ON_S); ++i) {
      g.step(heat);
      if (g.phys.vent || g.phys.fan1 || g.phys.fan2) tail_seen = true;
      heat_kept = heat_kept && g.phys.heat1;
    }
    CHECK(tail_seen && heat_kept && !g.phys.vent && !g.phys.fan1 && !g.phys.fan2,
          "AG3a: heat1 runs through the drying run's air tail, which then closes");
    CHECK(g.heat1_edges == 1 && g.c.starts[0] == 1 && !g.r.drying_air, "AG3a: no heat1 cut or restart; mark cleared");
  }
  // The same tail taken over by cooling: the air is now the cooling's, heat1 (in its minimum on) is cut at once.
  {
    RelayRig g;
    for (int i = 0; i < 60; ++i) g.step(drying);
    L::Output cool{};
    cool.cooling = cool.vent = true;
    cool.fans = 1;
    g.step(cool);
    CHECK(!g.phys.heat1 && g.phys.vent && !g.r.drying_air, "AG3a: cooling after drying cuts heat1 at once");
  }
  // A FANS press in the tail: AE10 cuts both heaters, and the mark clears (the press's air is not the drying's).
  {
    RelayRig g;
    for (int i = 0; i < 60; ++i) g.step(drying);
    g.step(heat, IDLE, ManualOverrides{true, false, false, false});
    CHECK(!g.phys.heat1 && !g.r.drying_air, "AG3a: a FANS press in the tail cuts heat1 and clears the mark");
  }
}

// -- Review tests T1, T2, T3 ------------------------------------------------------------------------
static void glue_review_t1_t2_t3() {
  // T1: a furnace start the AE10 cut holds off (a FANS press on the pass the relay layer would start heat2) is
  // undone: no physical edge, no switch-time stamp, the furnace's off time keeps counting.
  {
    L::Output warm{};
    warm.heat1 = warm.heat2 = true;
    L::RelayState r = after_boot_wait();
    const RelayOutputs off{false, false, false, false, false, false};
    const uint32_t since0 = r.heat2.since_ms;
    const L::RelayPass p = L::relay_pass(r, warm, L::RelayInputs{0, 0, false, 1000}, off,
                                         ManualOverrides{true, false, false, false}, IDLE);
    CHECK(!p.out.heat2 && !p.out.heat1 && p.force.fans, "T1 setup: the FANS press holds both heaters");
    CHECK(!r.heat2.on && r.heat2.since_ms == since0 + 1000 && r.heat2.switched == after_boot_wait().heat2.switched,
          "T1: the held furnace start moved no switch time");
    L::relay_sync(r, p.out);
    CHECK(!r.heat2.on && r.heat2.since_ms == since0 + 1000, "T1: the controller's sync after the drivers keeps it");
  }
  // T2: a cooling tail, then 40 F: the protection stops the air and starts heat1 in the same pass, although the
  // vent and fans were physically on at the start of that pass (the 40 F exemption of the physical-air start check).
  {
    L::Output cool{};
    cool.cooling = cool.vent = true;
    cool.fans = 2;
    L::Output cold{};
    cold.cold = true;
    cold.heat1 = cold.heat2 = true;
    RelayRig g;
    for (int i = 0; i < 10; ++i) g.step(cool);
    CHECK(g.phys.vent && g.phys.fan1 && g.phys.fan2, "T2 setup: cooling air inside its minimum on");
    g.step(cold, SAFETY_HEAT);
    CHECK(g.phys.heat1 && !g.phys.vent && !g.phys.fan1 && !g.phys.fan2, "T2: at 40 F heat1 starts as the air stops");
    CHECK(!g.phys.heat2, "T2: the furnace waits one pass for the air to read off (G1c)");
    g.step(cold, SAFETY_HEAT);
    CHECK(g.phys.heat2, "T2: then the furnace starts");
  }
  // T3: the HUMID press's safety block on the wiring's input path. Case sensor alone, finite case humidity: the law's
  // humidity is not valid (AG1) but the press still checks the case dew point (G2).
  {
    const float off = running_alone_k::CASE_SENSOR_OFFSET_F;
    const IndoorReading humid_case = select_indoor_reading(NAN, NAN, NAN, NAN, true, 75.0f + off, 90.0f);
    CHECK(!L::law_humidity_valid(true, humid_case) && humid_case.humidity_valid, "T3 setup: case sensor alone");
    CHECK(std::strcmp(L::humid_press_block(true, humid_case, kBand.low), "dew_margin") == 0,
          "T3: the press refuses fog inside the case dew margin");
    const IndoorReading dry_case = select_indoor_reading(NAN, NAN, NAN, NAN, true, 75.0f + off, 40.0f);
    CHECK(L::humid_press_block(true, dry_case, kBand.low)[0] == '\0', "T3: a dry case reading lets the press fog");
    const IndoorReading cold_case = select_indoor_reading(NAN, NAN, NAN, NAN, true, 60.0f + off, 40.0f);
    CHECK(std::strcmp(L::humid_press_block(true, cold_case, kBand.low), "temp_low") == 0,
          "T3: below the band's low edge the press is refused");
    const IndoorReading no_rh = select_indoor_reading(NAN, NAN, NAN, NAN, true, 75.0f + off, NAN);
    CHECK(!no_rh.humidity_valid && L::humid_press_block(true, no_rh, kBand.low)[0] == '\0',
          "T3: with no humidity reading the dew test is skipped (G7)");
    CHECK(L::humid_press_block(false, humid_case, kBand.low)[0] == '\0', "T3: with no temperature both tests skip");
  }
}

int main() {
  port_equals_reference_law();
  port_equals_simulator_relay_layer();
  rule_lines();
  rule7_drying();
  protection_limits();
  relay_layer();
  protection_clears_overrides();
  glue_fog_demand_and_sync();
  glue_override_rails();
  law_case_sensor_holds_humidity_rules();
  law_fog_wet_rails();
  glue_heater_air_interlock();
  glue_drying_tail();
  glue_review_t1_t2_t3();
  deferred_43();
  law_decision_telemetry();
  band_check();
  invariants();
  mister_request();
  engine_inputs();
  legacy_labels();
  nonfinite_and_gaps();
  stage_b_payloads();
  std::printf("test_climate_law: %d checks, %d failed\n", checks_run, checks_failed);
  return checks_failed == 0 ? 0 : 1;
}
