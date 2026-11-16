// closed_loop.cpp — firmware-in-the-loop simulation of the Verdify greenhouse.
//
// Links the REAL controller headers (firmware/lib/greenhouse_logic.h, read-only) against the fitted lumped
// physics (physics.h) and one year of recorded weather. Three controllers:
//   controller=fw      the production control law: determine_mode() + resolve_equipment() + the relay layer that
//                      lives in controls.yaml (relay conflict arbitration, min on/off dwell, fog/vent interlock,
//                      a reduced center-mister pulse machine)
//   controller=kiss    a two-axis (temperature, humidity) rule controller of ~60 lines, same relay layer
//   controller=replay  no simulation: scores the RECORDED indoor climate and relay duty with the same metric code
//
// Usage: closed_loop forcing=forcing.bin params=params.json controller=fw [key=value ...]
// Workload: single thread; one simulated year at dt=5 s takes a few seconds.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>

#include "greenhouse_types.h"
#include "greenhouse_solar.h"
#include "greenhouse_logic.h"

namespace phys {
#include "physics.h"
}

// ───────────────────────────── config ─────────────────────────────
static std::map<std::string, std::string> CFG;
static double cfgd(const std::string& k, double def) {
  auto it = CFG.find(k);
  return it == CFG.end() ? def : std::atof(it->second.c_str());
}
static std::string cfgs(const std::string& k, const std::string& def) {
  auto it = CFG.find(k);
  return it == CFG.end() ? def : it->second;
}
static bool cfgb(const std::string& k, bool def) { return cfgd(k, def ? 1 : 0) != 0; }

static const char* PNAMES[] = {"CA", "CI", "CM", "HAI", "HIM", "UA", "UAW", "UAM", "SOLA", "SOLI", "SOLM", "SOLALT",
                               "QH1", "FH1I", "QH2", "TAUH2", "QLA", "MV_VENT", "MV_FAN1", "MV_FAN2", "MINF",
                               "MA", "MB", "KB", "GFOG", "GMIST", "RFOG", "RMIST", "KRES", "RMAX", "TR0", "TRS", "E0",
                               "KCOND", "GLAZE", "TAUS_T", "TAUS_W", "PLUME"};

static bool load_params(const std::string& path, double* p) {
  FILE* f = std::fopen(path.c_str(), "rb");
  if (!f) return false;
  std::string s;
  char buf[4096];
  size_t k;
  while ((k = std::fread(buf, 1, sizeof buf, f)) > 0) s.append(buf, k);
  std::fclose(f);
  for (int i = 0; i < phys::P_N; ++i) {
    std::string key = std::string("\"") + PNAMES[i] + "\":";
    size_t pos = s.find(key);
    if (pos == std::string::npos) { std::fprintf(stderr, "param %s missing\n", PNAMES[i]); return false; }
    p[i] = std::strtod(s.c_str() + pos + key.size(), nullptr);
    double ov = cfgd(std::string("p.") + PNAMES[i], NAN);   // per-run physics override
    if (std::isfinite(ov)) p[i] = ov;
  }
  return true;
}

// ───────────────────────────── forcing ─────────────────────────────
struct Forcing {
  int64_t n = 0;
  std::vector<std::vector<double>> c;
  enum { EPOCH, WX_OK, TO, WO, S, SCOT, WIND, P, ALT, GLM, GLG, TMEAS, WMEAS, IN_OK, O_H1, O_H2, O_VENT, O_F1, O_F2,
         O_FOG, O_MC, O_MS, O_MW, O_OK, NCOL };
  bool load(const std::string& path) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    int64_t hdr[2];
    if (std::fread(hdr, sizeof(int64_t), 2, f) != 2) return false;
    n = hdr[0];
    if (hdr[1] != NCOL) { std::fprintf(stderr, "forcing columns %lld != %d\n", (long long)hdr[1], (int)NCOL); return false; }
    c.assign(NCOL, std::vector<double>(n));
    for (int k = 0; k < NCOL; ++k)
      if ((int64_t)std::fread(c[k].data(), sizeof(double), n, f) != n) return false;
    std::fclose(f);
    return true;
  }
};

// America/Denver UTC offset (minutes) for 2025-11 .. 2026-11: MDT from 2026-03-08 09:00Z to 2026-11-01 08:00Z.
static int denver_offset_min(double epoch_s) {
  const double MDT_START = 1772960400.0;  // 2026-03-08T09:00:00Z
  const double MDT_END = 1793520000.0;    // 2026-11-01T08:00:00Z
  return (epoch_s >= MDT_START && epoch_s < MDT_END) ? -360 : -420;
}

// ───────────────────────────── band ─────────────────────────────
struct Band { float tlo, ttg, thi, vlo, vtg, vhi; };
struct BandCfg { BandAnchors tlo, ttg, thi, vlo, vtg, vhi; };
static BandAnchors anchors(const std::string& key, BandAnchors def) {
  auto it = CFG.find(key);
  if (it == CFG.end()) return def;
  BandAnchors a = def;
  std::sscanf(it->second.c_str(), "%f,%f,%f,%f", &a.sr, &a.sm, &a.ss, &a.mid);
  return a;
}
static BandCfg band_cfg() {
  BandCfg b;
  // live anchors 2026-11-15 (setpoint_snapshot band_house_* / crop_band_anchors): sunrise, solar noon, sunset, solar midnight
  b.tlo = anchors("band.temp_low", {62.5f, 73.79f, 72.0f, 60.7f});
  b.ttg = anchors("band.temp_target", {67.5f, 78.79f, 77.0f, 65.7f});
  b.thi = anchors("band.temp_high", {72.5f, 83.79f, 82.0f, 70.7f});
  b.vlo = anchors("band.vpd_low", {0.755f, 0.862f, 0.845f, 0.738f});
  b.vtg = anchors("band.vpd_target", {0.935f, 1.042f, 1.025f, 0.83f});
  b.vhi = anchors("band.vpd_high", {1.185f, 1.292f, 1.275f, 1.168f});
  // uniform shifts for sensitivity runs
  float dt = (float)cfgd("band.temp_shift", 0), dvl = (float)cfgd("band.vpd_low_shift", 0), dvh = (float)cfgd("band.vpd_high_shift", 0);
  for (BandAnchors* a : {&b.tlo, &b.ttg, &b.thi}) { a->sr += dt; a->sm += dt; a->ss += dt; a->mid += dt; }
  for (BandAnchors* a : {&b.vlo}) { a->sr += dvl; a->sm += dvl; a->ss += dvl; a->mid += dvl; }
  for (BandAnchors* a : {&b.vhi}) { a->sr += dvh; a->sm += dvh; a->ss += dvh; a->mid += dvh; }
  float nlo = (float)cfgd("band.temp_low_night_shift", 0);   // night setback on the low edge only (sunset + midnight anchors)
  b.tlo.mid += nlo;
  return b;
}
static Band band_at(const BandCfg& b, float phase) {
  return {band_value_at_phase(b.tlo, phase), band_value_at_phase(b.ttg, phase), band_value_at_phase(b.thi, phase),
          band_value_at_phase(b.vlo, phase), band_value_at_phase(b.vtg, phase), band_value_at_phase(b.vhi, phase)};
}

// ───────────────────────────── relay layer (controls.yaml section 2 + 11) ─────────────────────────────
struct Relay {
  bool on = false;
  double last_on = -1e12, last_off = -1e12, min_on = 0, min_off = 0;
  long starts = 0;
  double on_s = 0;
  bool can_on(double now) const { return now - last_off >= min_off; }
  bool can_off(double now) const { return now - last_on >= min_on; }
  void set(double now, bool want, bool force_on, bool force_off) {
    if (want) {
      if (!on && (force_on || can_on(now))) { on = true; last_on = now; ++starts; }
    } else {
      if (on && (force_off || can_off(now))) { on = false; last_off = now; }
    }
  }
};
enum { R_H1, R_H2, R_F1, R_F2, R_FOG, R_VENT, R_MC, R_N };
static const char* RNAMES[] = {"heat1", "heat2", "fan1", "fan2", "fog", "vent", "mister_center"};

// ───────────────────────────── sensed climate ─────────────────────────────
struct Sensed { float temp_f, rh, vpd, dp_f, out_temp_f, out_rh, out_dp_f; };
static inline float c2f(double c) { return (float)(c * 1.8 + 32.0); }
static Sensed sense(const phys::PhysState& s, double To, double wo, double P) {
  Sensed z;
  z.temp_f = c2f(s.Ts);
  z.rh = (float)phys::rh_pct(s.Ts, s.ws, P);
  z.vpd = (float)phys::vpd_kpa(s.Ts, s.ws, P);
  z.dp_f = c2f(phys::dewpoint_c(s.ws, P));
  z.out_temp_f = c2f(To);
  z.out_rh = (float)phys::rh_pct(To, wo, P);
  z.out_dp_f = c2f(phys::dewpoint_c(wo, P));
  return z;
}

// ───────────────────────────── controller request ─────────────────────────────
struct Request {
  RelayOutputs r{};
  bool mist = false;     // center mister requested (pulsed by the relay layer)
  Mode mode = IDLE;      // for relay arbitration exemptions and reporting
};

// production setpoints as read back from the device on 2026-11-15 (setpoint_snapshot, 30-day medians)
static Setpoints live_setpoints() {
  Setpoints sp = default_setpoints();
  sp.vpd_hysteresis = (float)cfgd("sp.vpd_hysteresis", 0.1975);
  sp.temp_hysteresis = (float)cfgd("sp.temp_hysteresis", 1.6);
  sp.heat_hysteresis = (float)cfgd("sp.heat_hysteresis", 1.0);
  sp.safety_max = (float)cfgd("sp.safety_max", 100);
  sp.safety_min = (float)cfgd("sp.safety_min", 40);
  sp.vpd_max_safe = (float)cfgd("sp.vpd_max_safe", 2.5);
  sp.vpd_min_safe = (float)cfgd("sp.vpd_min_safe", 0.3);
  sp.sealed_max_ms = (uint32_t)(cfgd("sp.sealed_max_s", 600) * 1000);
  sp.vpd_watch_dwell_ms = (uint32_t)(cfgd("sp.vpd_watch_dwell_s", 60) * 1000);
  sp.mist_s2_delay_ms = (uint32_t)(cfgd("sp.mister_all_delay_s", 89) * 1000);
  sp.fog_escalation_kpa = (float)cfgd("sp.fog_escalation_kpa", 0.25);
  sp.fog_rh_ceiling = (float)cfgd("sp.fog_rh_ceiling", 90);
  sp.fog_min_temp = (float)cfgd("sp.fog_min_temp", 55);
  sp.dehum_aggressive_kpa = (float)cfgd("sp.dehum_aggressive_kpa", 0.6);
  sp.occupancy_inhibit = true;
  sp.econ_block = false;
  sp.sw_summer_vent_enabled = true;
  sp.vent_prefer_temp_delta_f = (float)cfgd("sp.vent_prefer_temp_delta_f", 4);
  sp.vent_prefer_dp_delta_f = (float)cfgd("sp.vent_prefer_dp_delta_f", 3);
  sp.outdoor_staleness_max_s = 600;
  sp.sw_dwell_gate_enabled = cfgb("sp.sw_dwell_gate_enabled", true);
  sp.dwell_gate_ms = (uint32_t)cfgd("sp.dwell_gate_ms", 255000);
  sp.sw_fsm_controller_enabled = true;
  sp.cool_stage2_over_high_f = (float)cfgd("sp.cool_stage2_over_high_f", 1.73);
  sp.cool_stage2_exit_hysteresis_f = (float)cfgd("sp.cool_stage2_exit_hysteresis_f", 1.0);
  sp.cool_exit_hysteresis_f = (float)cfgd("sp.cool_exit_hysteresis_f", 1.6);
  sp.cold_vent_guard_delta_f = (float)cfgd("sp.cold_vent_guard_delta_f", 8);
  sp.cool_all_fans_at_high_enabled = cfgb("sp.cool_all_fans_at_high_enabled", false);
  sp.direct_wet_stress_override_enabled = false;
  sp.direct_wet_stress_vpd_margin_kpa = (float)cfgd("sp.direct_wet_stress_vpd_margin_kpa", 0.05);
  sp.direct_wet_stress_min_dew_margin_f = (float)cfgd("sp.direct_wet_stress_min_dew_margin_f", 8);
  sp.mist_backoff_ms = (uint32_t)(cfgd("sp.mist_backoff_s", 600) * 1000);
  sp.night_stress_min_dew_margin_f = (float)cfgd("sp.night_stress_min_dew_margin_f", 6);
  sp.sw_dawn_rehydrate_enabled = false;
  sp.sw_midday_drench_enabled = false;
  sp.band_track_fraction = 0.0f;
  sp.vent_exchange_fraction = (float)cfgd("sp.vent_exchange_fraction", 0.3);
  sp.dehum_vent_hold_enabled = cfgb("sp.dehum_vent_hold_enabled", true);
  sp.night_dryout_enabled = cfgb("sp.night_dryout_enabled", true);
  sp.night_dryout_pulse_s = (uint32_t)cfgd("sp.night_dryout_pulse_s", 120);
  sp.night_dryout_rest_s = (uint32_t)cfgd("sp.night_dryout_rest_s", 780);
  sp.night_dryout_dp_margin_f = (float)cfgd("sp.night_dryout_dp_margin_f", 3);
  sp.night_dryout_kwh_cap = (float)cfgd("sp.night_dryout_kwh_cap", 10);
  return sp;
}

// ───────────────────────────── KISS two-axis controller ─────────────────────────────
struct Kiss {
  // constants (all fixed in firmware in this design; overridable here only to test sensitivity)
  double heat1_above_low, heat2_on_below_low, heat2_off_above_low, cool_exit, cold_guard_delta, cold_entry_guard,
      fan2_over_high, dry_dwell_s, fog_over_high_vent, fog_over_high_sealed, sealed_fog_max_s, sealed_fog_rest_s,
      dp_margin_f, pulse_s, rest_s, kwh_cap, wet_exit_kpa, dew_margin_day, dew_margin_night, wet_min_temp, safe_max,
      safe_min, heat_hold_below_target, dehum_min_above_low;
  int dehum_mode;          // 0 none, 1 pulse/rest, 2 continuous while wet
  bool dehum_day, vent_needs_cooler_out, both_fans_dehum;
  bool gas_interlock;      // furnace never requested while an air relay is on or wanted; dehumidify waits for the furnace;
                           // the vent/fan run-out after a dehumidify period stays in the heat+air exempt mode (no heat1 force-off)
  // state
  bool cooling = false, heat2 = false, fan2 = false, wet = false;
  double dry_s = 0, fog_on_s = 0, fog_rest_s = 0, pulse_t = 0, rest_t = 0, kwh_tonight = 0;
  bool was_night = false, was_dehum = false;
  void init() {
    heat1_above_low = cfgd("kiss.heat1_above_low", 3.5);
    heat2_on_below_low = cfgd("kiss.heat2_on_below_low", 0.0);
    heat2_off_above_low = cfgd("kiss.heat2_off_above_low", 2.5);
    cool_exit = cfgd("kiss.cool_exit", 1.5);
    cold_guard_delta = cfgd("kiss.cold_guard_delta", 10);
    cold_entry_guard = cfgd("kiss.cold_entry_guard", 2.5);
    fan2_over_high = cfgd("kiss.fan2_over_high", 1.0);
    dry_dwell_s = cfgd("kiss.dry_dwell_s", 60);
    fog_over_high_vent = cfgd("kiss.fog_over_high_vent", 0.1);
    fog_over_high_sealed = cfgd("kiss.fog_over_high_sealed", 0.0);
    sealed_fog_max_s = cfgd("kiss.sealed_fog_max_s", 600);
    sealed_fog_rest_s = cfgd("kiss.sealed_fog_rest_s", 600);
    dp_margin_f = cfgd("kiss.dp_margin_f", 3);
    pulse_s = cfgd("kiss.pulse_s", 120);
    rest_s = cfgd("kiss.rest_s", 780);
    kwh_cap = cfgd("kiss.kwh_cap", 1e9);
    wet_exit_kpa = cfgd("kiss.wet_exit_kpa", 0.03);
    dew_margin_day = cfgd("kiss.dew_margin_day", 8);
    dew_margin_night = cfgd("kiss.dew_margin_night", 6);
    wet_min_temp = cfgd("kiss.wet_min_temp", 55);
    safe_max = cfgd("kiss.safe_max", 100);
    safe_min = cfgd("kiss.safe_min", 40);
    heat_hold_below_target = cfgd("kiss.heat_hold_below_target", 1.5);
    dehum_min_above_low = cfgd("kiss.dehum_min_above_low", 1.0);   // temperature first: exchange air only above this margin
    dehum_mode = (int)cfgd("kiss.dehum_mode", 1);
    dehum_day = cfgb("kiss.dehum_day", true);
    vent_needs_cooler_out = cfgb("kiss.vent_needs_cooler_out", false);
    both_fans_dehum = cfgb("kiss.both_fans_dehum", false);
    gas_interlock = cfgb("kiss.gas_interlock", false);
  }
  Request step(const Sensed& z, const Band& b, bool night, double dt, bool air_on) {
    Request q;
    const double T = z.temp_f, V = z.vpd;
    // ---- temperature axis
    const bool cold_out = z.out_temp_f < b.tlo - cold_guard_delta;
    if (T >= safe_max) cooling = true;
    else if (cooling) cooling = T > b.thi - (cold_out ? std::max(3.0, cool_exit) : cool_exit);
    else cooling = T > b.thi + (cold_out ? cold_entry_guard : 0.0);
    if (cooling && vent_needs_cooler_out && T < safe_max && z.out_temp_f >= T) cooling = false;
    bool heat1 = T < b.tlo + heat1_above_low;
    if (T < b.tlo + heat2_on_below_low) heat2 = true;
    else if (T >= b.tlo + heat2_off_above_low) heat2 = false;
    if (T <= safe_min) { heat1 = true; heat2 = true; }
    if (!cooling) fan2 = false;
    else if (T > b.thi + fan2_over_high) fan2 = true;
    else if (T <= b.thi) fan2 = false;
    bool vent = cooling, fan_lead = cooling, fan_other = cooling && (fan2 || T >= safe_max);
    // ---- humidity axis: too dry
    dry_s = (V > b.vhi) ? dry_s + dt : 0;
    const bool wet_ok = (T - z.dp_f) >= (night ? dew_margin_night : dew_margin_day) && z.rh < 90 && T >= wet_min_temp;
    const bool want_wet = dry_s >= dry_dwell_s && wet_ok;
    bool fog = false, mist = false;
    if (cooling) {
      fog = want_wet && V > b.vhi + fog_over_high_vent;
      mist = fog;
      fog_on_s = 0;
    } else {
      if (fog_rest_s > 0) fog_rest_s -= dt;
      else if (want_wet && V > b.vhi + fog_over_high_sealed) { fog = true; fog_on_s += dt; }
      else fog_on_s = 0;
      if (fog_on_s >= sealed_fog_max_s) { fog_on_s = 0; fog_rest_s = sealed_fog_rest_s; }
    }
    // ---- humidity axis: too wet (runs alongside heating)
    if (night && !was_night) kwh_tonight = 0;
    was_night = night;
    const bool drier_out = z.out_dp_f <= z.dp_f - dp_margin_f;
    if (V < b.vlo) wet = true;
    else if (V >= b.vlo + wet_exit_kpa) wet = false;
    bool dehum = false;
    const bool warm_enough = T >= b.tlo + dehum_min_above_low;
    if (dehum_mode > 0 && !cooling && wet && drier_out && warm_enough && (night || dehum_day) && kwh_tonight < kwh_cap
        && !(gas_interlock && heat2)) {
      if (dehum_mode == 2) dehum = true;
      else {
        if (rest_t > 0) rest_t -= dt;
        else { dehum = true; pulse_t += dt; if (pulse_t >= pulse_s) { pulse_t = 0; rest_t = rest_s; } }
      }
      if (T < b.ttg - heat_hold_below_target) heat1 = true;   // hold temperature while exchanging air
    } else {
      pulse_t = 0;
      if (!wet) rest_t = 0;
    }
    if (dehum) { vent = true; fan_lead = true; if (both_fans_dehum) fan_other = true; }
    if (dehum) was_dehum = true;
    const bool closing = gas_interlock && !dehum && !cooling && was_dehum && air_on;
    if (!dehum && !air_on) was_dehum = false;
    if (heat1 && (night)) kwh_tonight += 1.436 * dt / 3600.0 * (dehum || rest_t > 0 ? 1.0 : 0.0);
    // ---- interlocks
    if (cooling && T < safe_max) { heat1 = false; heat2 = false; }
    bool heat2_req = heat2 && heat1;
    if (gas_interlock && (dehum || air_on)) heat2_req = false;
    q.r.heat1 = heat1; q.r.heat2 = heat2_req; q.r.fan1 = fan_lead; q.r.fan2 = fan_other; q.r.fog = fog; q.r.vent = vent;
    q.mist = mist;
    q.mode = cooling ? VENTILATE : ((dehum || closing) ? DEHUM_VENT : IDLE);
    return q;
  }
};

// ───────────────────────────── metrics ─────────────────────────────
struct Acc {
  double n = 0, n_day = 0, n_night = 0;
  double t_in = 0, t_lo = 0, t_hi = 0, v_in = 0, v_lo = 0, v_hi = 0, both = 0;
  double t_in_d = 0, v_in_d = 0, both_d = 0, t_in_n = 0, v_in_n = 0, both_n = 0, v_lo_n = 0, v_hi_d = 0;
  double t_err = 0, v_err = 0;                 // mean distance outside the band (deg F, kPa)
  double on_min[R_N] = {0};
  double starts[R_N] = {0};
  double mode_min[8] = {0};
  double tmin = 1e9, tmax = -1e9, sum_t = 0, sum_v = 0, sum_v_n = 0, sum_to = 0;
  double dn_nights = 0, dn_pass = 0, dn_min = 0;  // nightly dry-out acceptance, see the scoring loop
};

static void emit(FILE* f, const char* scen, const char* key, const Acc& a) {
  if (a.n <= 0) return;
  auto pct = [](double x, double n) { return n > 0 ? 100.0 * x / n : NAN; };
  const double h1 = a.on_min[R_H1] / 60, h2 = a.on_min[R_H2] / 60, fans = (a.on_min[R_F1] + a.on_min[R_F2]) / 60,
               fog = a.on_min[R_FOG] / 60, vent = a.on_min[R_VENT] / 60, mc = a.on_min[R_MC] / 60;
  const double kwh = 1.436 * h1 + 0.113 * fans + 0.710 * fog + 0.010 * vent;
  const double therms = 0.75 * h2;                       // nameplate input 75,000 BTU/h, not metered
  const double gal = 34.8 * fog + 67.2 * mc;             // measured by regression: fog 0.58 gal/min, centre mister 1.12 gal/min
  const double days = a.n / 1440.0;
  std::fprintf(f,
               "%s,%s,%.1f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.3f,%.4f,"
               "%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.2f,%.3f,%.1f,%.2f,%.2f,%.2f,%.3f,%.3f,%.2f,"
               "%.2f,%.2f,%.2f,%.2f,%.2f,%.0f,%.2f,%.1f\n",
               scen, key, days, pct(a.t_in, a.n), pct(a.t_lo, a.n), pct(a.t_hi, a.n), pct(a.v_in, a.n), pct(a.v_lo, a.n),
               pct(a.v_hi, a.n), pct(a.both, a.n), pct(a.t_in_d, a.n_day), pct(a.v_in_d, a.n_day), pct(a.both_d, a.n_day),
               pct(a.t_in_n, a.n_night), pct(a.v_in_n, a.n_night), pct(a.both_n, a.n_night), pct(a.v_lo_n, a.n_night),
               a.t_err / a.n, a.v_err / a.n,
               h1 / days, h2 / days, a.on_min[R_F1] / 60 / days, a.on_min[R_F2] / 60 / days, vent / days, fog / days, mc / days,
               a.starts[R_H1] / days, a.starts[R_H2] / days, a.starts[R_F1] / days, a.starts[R_VENT] / days,
               a.starts[R_FOG] / days, a.starts[R_MC] / days,
               kwh / days, therms / days, gal / days, a.tmin, a.tmax, a.sum_t / a.n, a.sum_v / a.n,
               a.n_night > 0 ? a.sum_v_n / a.n_night : NAN, a.sum_to / a.n,
               pct(a.mode_min[IDLE], a.n), pct(a.mode_min[VENTILATE], a.n), pct(a.mode_min[SEALED_MIST], a.n),
               pct(a.mode_min[DEHUM_VENT], a.n), pct(a.v_hi_d, a.n_day), a.dn_nights, pct(a.dn_pass, a.dn_nights),
               a.dn_nights > 0 ? a.dn_min / a.dn_nights : NAN);
}
static const char* HEADER =
    "scenario,period,days,temp_in_pct,temp_below_pct,temp_above_pct,vpd_in_pct,vpd_below_pct,vpd_above_pct,both_in_pct,"
    "temp_in_day_pct,vpd_in_day_pct,both_in_day_pct,temp_in_night_pct,vpd_in_night_pct,both_in_night_pct,vpd_below_night_pct,"
    "temp_err_f,vpd_err_kpa,heat1_h_day,heat2_h_day,fan1_h_day,fan2_h_day,vent_h_day,fog_h_day,mister_h_day,"
    "heat1_starts_day,heat2_starts_day,fan1_starts_day,vent_starts_day,fog_starts_day,mister_starts_day,"
    "kwh_day,therms_day,gal_day,temp_min_f,temp_max_f,temp_mean_f,vpd_mean,vpd_mean_night,outdoor_mean_c,"
    "idle_pct,ventilate_pct,sealed_pct,dehum_pct,vpd_above_day_pct,dryout_nights,dryout_pass_pct,dryout_min_night\n";

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    const char* eq = std::strchr(argv[i], '=');
    if (!eq) continue;
    CFG[std::string(argv[i], eq - argv[i])] = std::string(eq + 1);
  }
  Forcing F;
  if (!F.load(cfgs("forcing", "forcing.bin"))) { std::fprintf(stderr, "cannot load forcing\n"); return 2; }
  double p[phys::P_N];
  if (!load_params(cfgs("params", "params.json"), p)) { std::fprintf(stderr, "cannot load params\n"); return 2; }
  double p_summer[phys::P_N];
  const bool has_summer = CFG.count("params_summer") && load_params(CFG["params_summer"], p_summer);   // May..September
  const std::string ctrl = cfgs("controller", "fw");
  const std::string scen = cfgs("name", ctrl);
  const double dt = cfgd("dt", 5.0);
  const int ticks = (int)std::lround(60.0 / dt);
  const double t_start = cfgd("start", F.c[Forcing::EPOCH][0]);
  const double t_end = cfgd("end", F.c[Forcing::EPOCH][F.n - 1] + 60);
  const double score_from = cfgd("score_from", t_start + 86400.0);
  const BandCfg bc = band_cfg();
  // controls.yaml: night_vpd_bias_kpa raises the controller's own VPD band at night (0 at sunset and sunrise, the full
  // value at solar midnight). The band the house is graded against does not move with it.
  const float night_bias = (float)cfgd("band.night_vpd_bias_kpa", 0);
  const Setpoints base_sp = live_setpoints();
  const double canopy = cfgd("canopy", 1.0);              // moisture-source scale (1 = autumn-2026 house)
  const double dryout_from = cfgd("dryout_from", 0);        // epoch after which night dry-out is enabled (validation)
  const bool fw_rest_exempt = cfgb("fw.rest_exempt", false);  // emulate the proposed pulse-end interlock fix

  Relay R[R_N];
  R[R_H1].min_on = R[R_H2].min_on = cfgd("dwell.heat_on", 120);
  R[R_H1].min_off = R[R_H2].min_off = cfgd("dwell.heat_off", 180);
  R[R_F1].min_on = R[R_F2].min_on = cfgd("dwell.fan_on", 120);
  R[R_F1].min_off = R[R_F2].min_off = cfgd("dwell.fan_off", 90);
  R[R_FOG].min_on = cfgd("dwell.fog_on", 50);
  R[R_FOG].min_off = cfgd("dwell.fog_off", 60);
  R[R_VENT].min_on = cfgd("dwell.vent_on", 60);
  R[R_VENT].min_off = cfgd("dwell.vent_off", 60);
  const double pulse_on = cfgd("mister.pulse_on_s", 60), pulse_gap = std::max(cfgd("mister.pulse_gap_s", 40), cfgd("mister.min_off_s", 45));
  const double engage_delay = cfgd("mister.engage_delay_s", 44), mist_min_temp = cfgd("mister.min_temp_f", 65);
  const double mist_start_off = cfgd("mister.start_offset_min", 120), mist_end_off = cfgd("mister.drydown_min", 180);
  const double water_budget = cfgd("mister.water_budget_gal", 120);

  ControlState st = initial_state();
  Kiss K; K.init();
  phys::PhysState s;
  bool inited = false;
  double mist_req_s = 0, mist_phase_t = 0; bool mist_on_phase = true;
  double water_today = 0; int last_day = -1;

  std::map<std::string, Acc> acc;
  FILE* trace = nullptr;
  if (CFG.count("trace")) {
    trace = std::fopen(CFG["trace"].c_str(), "w");
    std::fprintf(trace, "epoch_s,temp_f,vpd,rh,w,mode,heat1,heat2,fan1,fan2,fog,vent,mister,tlo,thi,vlo,vhi,out_temp_f,night,scored\n");
  }
  const bool replay = (ctrl == "replay");

  for (int64_t i = 0; i < F.n; ++i) {
    const double ep = F.c[Forcing::EPOCH][i];
    if (ep < t_start || ep >= t_end) continue;
    const double To = F.c[Forcing::TO][i], wo = F.c[Forcing::WO][i], P = F.c[Forcing::P][i];
    if (!inited) {
      double T0 = F.c[Forcing::IN_OK][i] > 0.5 ? F.c[Forcing::TMEAS][i] : 18.0;
      double w0 = F.c[Forcing::IN_OK][i] > 0.5 ? F.c[Forcing::WMEAS][i] : 7.0;
      phys::phys_init(s, T0, w0);
      inited = true;
    }
    const int off = denver_offset_min(ep);
    const SolarTimes sol = solar_times_from_unix((uint64_t)ep, off);
    const time_t tt = (time_t)(ep + off * 60.0);
    struct tm tmv; gmtime_r(&tt, &tmv);
    const double* pp = (has_summer && tmv.tm_mon + 1 >= 5 && tmv.tm_mon + 1 <= 9) ? p_summer : p;
    double duty[R_N] = {0};
    double mode_ticks[8] = {0};
    Sensed z{};
    Band b{};
    bool night = false;
    const int local_day = (int)std::floor((ep + off * 60.0) / 86400.0);
    if (local_day != last_day) { water_today = 0; last_day = local_day; }

    if (replay) {
      phys::PhysState m = s;
      m.Ts = F.c[Forcing::TMEAS][i]; m.ws = F.c[Forcing::WMEAS][i];
      z = sense(m, To, wo, P);
      const int now_min = local_minute_from_unix((uint64_t)ep, off);
      const float ph = solar_phase(now_min, sol);
      b = band_at(bc, ph);
      night = ph >= 2.0f;
      duty[R_H1] = F.c[Forcing::O_H1][i]; duty[R_H2] = F.c[Forcing::O_H2][i]; duty[R_F1] = F.c[Forcing::O_F1][i];
      duty[R_F2] = F.c[Forcing::O_F2][i]; duty[R_FOG] = F.c[Forcing::O_FOG][i]; duty[R_VENT] = F.c[Forcing::O_VENT][i];
      duty[R_MC] = F.c[Forcing::O_MC][i];
    } else {
      for (int k = 0; k < ticks; ++k) {
        const double now = ep + k * dt;
        const int now_min = local_minute_from_unix((uint64_t)now, off);
        const float ph = solar_phase(now_min, sol);
        b = band_at(bc, ph);
        night = ph >= 2.0f;
        z = sense(s, To, wo, P);
        Request q;
        SensorInputs in{};
        in.temp_f = z.temp_f; in.vpd_kpa = z.vpd; in.rh_pct = z.rh; in.dew_point_f = z.dp_f;
        in.outdoor_rh_pct = z.out_rh; in.enthalpy_delta = -5.0f; in.solar_w_m2 = (float)F.c[Forcing::S][i];
        in.vpd_south = in.vpd_west = in.vpd_east = z.vpd;
        in.local_hour = now_min / 60; in.occupied = false;
        in.outdoor_temp_f = z.out_temp_f; in.outdoor_dewpoint_f = z.out_dp_f; in.outdoor_data_age_s = 10;
        in.sensor_degraded = false;
        in.now_minute = now_min; in.sunrise_min = sol.sunrise_min; in.solar_noon_min = sol.solar_noon_min;
        in.sunset_min = sol.sunset_min; in.solar_phase = ph;
        Setpoints sp = base_sp;
        sp.temp_low = b.tlo; sp.temp_high = b.thi; sp.temp_target = b.ttg;
        sp.vpd_low = b.vlo; sp.vpd_high = b.vhi; sp.vpd_target = b.vtg;
        if (night_bias > 0.0f && ph >= 2.0f && ph <= 4.0f) {
          const float sn = std::sin(3.14159265f * (ph - 2.0f) * 0.5f);
          const float add = night_bias * sn * sn;
          sp.vpd_low += add; sp.vpd_target += add; sp.vpd_high += add;
        }
        if (now < dryout_from) sp.night_dryout_enabled = false;
        validate_setpoints(sp);
        sp.sw_fsm_controller_enabled = true;
        if (ctrl == "fw") {
          const Mode mode = determine_mode(in, sp, st, (uint32_t)(dt * 1000));
          q.r = resolve_equipment(mode, in, sp, st, true);
          q.mode = mode;
          q.mist = (mode == SEALED_MIST && (st.mist_stage == MIST_S1 || st.mist_stage == MIST_S2))
                   || (mode == VENTILATE && st.vent_mist_assist_active);
        } else {
          q = K.step(z, b, night, dt, R[R_VENT].on || R[R_F1].on || R[R_F2].on);
        }
        // relay conflict arbitration (greenhouse_logic.h) with the physical relay state
        const RelayOutputs physical{R[R_H1].on, R[R_H2].on, R[R_F1].on, R[R_F2].on, R[R_FOG].on, R[R_VENT].on};
        Mode arb_mode = q.mode;
        if (fw_rest_exempt && ctrl == "fw" && st.dryout_phase == DRYOUT_REST && q.mode == IDLE
            && (physical.vent || physical.fan1 || physical.fan2)) {
          arb_mode = DEHUM_VENT;   // proposed fix: a dry-out pulse's own vent/fan run-out does not force heat1 off
          q.r.heat2 = false;
        }
        const RelayArbitration arb = arbitrate_relay_conflicts(arb_mode, q.r, physical, R[R_H1].can_on(now), R[R_H1].can_off(now), false);
        RelayOutputs w = arb.out;
        // fog rails: water budget; fog closes vent unless it is the open-vent assist
        const bool budget_block = water_today >= water_budget && z.vpd <= 2.5f;
        const bool open_vent_fog = open_vent_fog_assist_permitted(q.mode, q.r);
        if (budget_block) w.fog = false;
        if (physical.vent && !open_vent_fog) w.fog = false;
        R[R_H1].set(now, w.heat1, false, arb.force_heat_off);
        R[R_H2].set(now, w.heat2, false, arb.force_heat2_off);
        R[R_VENT].set(now, w.vent, arb.fan_requires_vent, false);
        R[R_F1].set(now, w.fan1, false, false);
        R[R_F2].set(now, w.fan2, false, false);
        R[R_FOG].set(now, w.fog, false, budget_block);
        // center mister pulse machine (reduced from controls.yaml section 12)
        const bool mist_gate = climate_wet_assist_permitted(in, sp) && z.temp_f >= mist_min_temp
                               && now_min >= sol.sunrise_min + mist_start_off && now_min <= sol.sunset_min - mist_end_off
                               && !budget_block;
        if (q.mist && mist_gate) {
          mist_req_s += dt;
          if (mist_req_s >= engage_delay) {
            mist_phase_t += dt;
            if (mist_on_phase && mist_phase_t >= pulse_on) { mist_on_phase = false; mist_phase_t = 0; }
            else if (!mist_on_phase && mist_phase_t >= pulse_gap) { mist_on_phase = true; mist_phase_t = 0; }
            const bool want = mist_on_phase;
            if (want && !R[R_MC].on) { R[R_MC].on = true; ++R[R_MC].starts; }
            if (!want) R[R_MC].on = false;
          }
        } else {
          mist_req_s = 0; mist_phase_t = 0; mist_on_phase = true; R[R_MC].on = false;
        }
        // advance the physics with the actual relay states
        phys::PhysIn u{To, wo, F.c[Forcing::S][i] + pp[phys::P_SOLALT] * F.c[Forcing::SCOT][i], F.c[Forcing::WIND][i], P,
                       R[R_H1].on ? 1.0 : 0.0, R[R_H2].on ? 1.0 : 0.0, R[R_VENT].on ? 1.0 : 0.0, R[R_F1].on ? 1.0 : 0.0,
                       R[R_F2].on ? 1.0 : 0.0, R[R_FOG].on ? 1.0 : 0.0, R[R_MC].on ? 1.0 : 0.0, 0.0, 0.0,
                       F.c[Forcing::GLM][i], F.c[Forcing::GLG][i], canopy};
        phys::phys_step(s, u, pp, dt);
        for (int r = 0; r < R_N; ++r) duty[r] += R[r].on ? 1.0 / ticks : 0.0;
        mode_ticks[(int)q.mode] += 1.0 / ticks;
        water_today += (R[R_FOG].on ? 0.58 : 0.0) * dt / 60.0 + (R[R_MC].on ? 1.12 : 0.0) * dt / 60.0;   // metered flow while fog/mister relays are on
      }
    }
    // ---- score this minute
    const bool scored = ep >= score_from && F.c[Forcing::WX_OK][i] > 0.5
                        && (!replay || (F.c[Forcing::IN_OK][i] > 0.5 && F.c[Forcing::O_OK][i] > 0.5));
    if (trace)
      std::fprintf(trace, "%.0f,%.2f,%.4f,%.1f,%.3f,%d,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.4f,%.4f,%.1f,%d,%d\n", ep,
                   z.temp_f, z.vpd, z.rh, replay ? F.c[Forcing::WMEAS][i] : s.ws, replay ? -1 : (int)(std::max_element(mode_ticks, mode_ticks + 8) - mode_ticks),
                   duty[R_H1], duty[R_H2], duty[R_F1], duty[R_F2], duty[R_FOG], duty[R_VENT], duty[R_MC], b.tlo, b.thi, b.vlo, b.vhi,
                   z.out_temp_f, night ? 1 : 0, scored ? 1 : 0);
    if (!scored) continue;
    // period keys: ALL, calendar month (local), season
    char mkey[16]; std::snprintf(mkey, sizeof mkey, "%04d-%02d", tmv.tm_year + 1900, tmv.tm_mon + 1);
    const bool day = F.c[Forcing::ALT][i] > 0.0;
    for (const std::string& key : {std::string("ALL"), std::string(mkey)}) {
      Acc& a = acc[key];
      a.n += 1;
      const bool tin = z.temp_f >= b.tlo && z.temp_f <= b.thi, vin = z.vpd >= b.vlo && z.vpd <= b.vhi;
      a.t_in += tin; a.t_lo += z.temp_f < b.tlo; a.t_hi += z.temp_f > b.thi;
      a.v_in += vin; a.v_lo += z.vpd < b.vlo; a.v_hi += z.vpd > b.vhi; a.both += tin && vin;
      if (day) { a.n_day += 1; a.t_in_d += tin; a.v_in_d += vin; a.both_d += tin && vin; a.v_hi_d += z.vpd > b.vhi; }
      else { a.n_night += 1; a.t_in_n += tin; a.v_in_n += vin; a.both_n += tin && vin; a.v_lo_n += z.vpd < b.vlo; a.sum_v_n += z.vpd; }
      a.t_err += std::max(0.0f, std::max(b.tlo - z.temp_f, z.temp_f - b.thi));
      a.v_err += std::max(0.0f, std::max(b.vlo - z.vpd, z.vpd - b.vhi));
      for (int r = 0; r < R_N; ++r) a.on_min[r] += duty[r];
      for (int m = 0; m < 8; ++m) a.mode_min[m] += mode_ticks[m];
      a.tmin = std::min(a.tmin, (double)z.temp_f); a.tmax = std::max(a.tmax, (double)z.temp_f);
      a.sum_t += z.temp_f; a.sum_v += z.vpd; a.sum_to += To;
    }
    // Nightly dry-out acceptance (ADR-0004, amendment of 2026-11-05; db/migrations/305): minutes at or above
    // max(served vpd_low, 0.74 kPa) between 00:00 and 06:00 local time. A night passes with at least 240.
    {
      static int dn_day = -1, dn_graded = 0, dn_ok = 0;
      static char dn_key[16] = "";
      if (tmv.tm_hour < 6) {
        if (local_day != dn_day) { dn_day = local_day; dn_graded = 0; dn_ok = 0; std::snprintf(dn_key, sizeof dn_key, "%s", mkey); }
        dn_graded += 1;
        dn_ok += z.vpd >= std::max((double)b.vlo, 0.74) ? 1 : 0;
      } else if (dn_day == local_day && dn_graded >= 300) {
        for (const std::string& key : {std::string("ALL"), std::string(dn_key)}) {
          Acc& a = acc[key];
          a.dn_nights += 1; a.dn_pass += dn_ok >= 240 ? 1 : 0; a.dn_min += dn_ok;
        }
        dn_graded = 0;
      }
    }
    // starts per period: attribute the relay start counters by differencing
    static long prev_starts[R_N] = {0};
    for (int r = 0; r < R_N; ++r) {
      const long d = R[r].starts - prev_starts[r];
      prev_starts[r] = R[r].starts;
      if (d) { acc["ALL"].starts[r] += d; acc[mkey].starts[r] += d; }
    }
  }
  if (trace) std::fclose(trace);
  FILE* out = stdout;
  if (CFG.count("out")) out = std::fopen(CFG["out"].c_str(), cfgb("append", false) ? "a" : "w");
  if (!cfgb("append", false) || cfgb("header", false)) std::fputs(HEADER, out);
  for (auto& kv : acc) emit(out, scen.c_str(), kv.first.c_str(), kv.second);
  if (out != stdout) std::fclose(out);
  return 0;
}
