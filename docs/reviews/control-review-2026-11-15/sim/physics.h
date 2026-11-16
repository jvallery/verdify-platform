// physics.h — lumped grey-box model of the Verdify greenhouse: three thermal nodes (air+fast surfaces,
// intermediate mass, slow mass), air moisture with a sorption buffer and a wet-surface reservoir,
// lagged heaters, sensor lag. Shared by the open-loop fitting kernel and the closed-loop simulator.
// Units: temperature degC, humidity ratio g/kg dry air, power W, mass flow kg/s, water g/s, time s.
#pragma once
#include <algorithm>
#include <cmath>

enum PhysIdx {
  P_CA,      // J/K   air + fast-surface heat capacity
  P_CI,      // J/K   intermediate mass (plants, benches, pots, framing)
  P_CM,      // J/K   slow mass (floor, soil)
  P_HAI,     // W/K   air <-> intermediate coupling
  P_HIM,     // W/K   intermediate <-> slow coupling
  P_UA,      // W/K   air -> outdoor loss, house closed (envelope + infiltration)
  P_UAW,     // W/K per mph of wind
  P_UAM,     // W/K   slow mass -> outdoor/ground loss
  P_SOLA,    // W per W/m2 of outdoor horizontal solar absorbed by the air node
  P_SOLI,    // W per W/m2 absorbed by the intermediate node
  P_SOLM,    // W per W/m2 absorbed by the slow node
  P_SOLALT,  // -     extra solar gain per unit of S*cot(solar altitude) (low sun on the walls)
  P_QH1,     // W     electric heater output
  P_FH1I,    // -     fraction of the electric heater output delivered to the intermediate node (rest: air)
  P_QH2,     // W     gas furnace effective output to the sensed air
  P_TAUH2,   // s     furnace lag (two cascaded stages of this time constant: approximates dead time)
  P_QLA,     // -     fraction of grow-light electrical power released to the air node
  P_MV_VENT, // kg/s  air exchange with the vent open and no fan
  P_MV_FAN1, // kg/s  additional exchange with one fan
  P_MV_FAN2, // kg/s  additional exchange with the second fan
  P_MINF,    // kg/s  closed-house infiltration (moisture exchange; its heat loss is inside UA)
  P_MA,      // kg    dry-air mass for moisture
  P_MB,      // kg    sorption-buffer equivalent dry-air mass (hygroscopic materials)
  P_KB,      // kg/s  air <-> buffer moisture exchange
  P_GFOG,    // g/(s kPa) fog evaporation into the air per kPa of VPD
  P_GMIST,   // g/(s kPa) mister direct evaporation per kPa (centre zone weight 1)
  P_RFOG,    // g/s   fog water deposited onto surfaces
  P_RMIST,   // g/s   mister water deposited onto surfaces (centre weight 1)
  P_KRES,    // 1/(s kPa) evaporation rate constant of the wet-surface reservoir
  P_RMAX,    // g     capacity of the wet-surface reservoir (excess drains away)
  P_TR0,     // g/(s kPa) transpiration/soil evaporation conductance in the dark
  P_TRS,     // g/(s kPa) per W/m2 light-driven transpiration conductance
  P_E0,      // g/s   constant moisture source
  P_KCOND,   // g/s per g/kg condensation conductance on the glazing
  P_GLAZE,   // -     glazing temperature fraction between outdoor (0) and indoor (1)
  P_TAUS_T,  // s     temperature sensor lag
  P_TAUS_W,  // s     humidity sensor lag
  P_PLUME,   // K     extra warming seen by the probes at full furnace output (probes sit in the furnace throw)
  P_N
};

struct PhysState {
  double Ta, Ti, Tm, w, wb, qh1, qh2a, qh2, R, Ts, ws;
};

struct PhysIn {
  double To, wo, S, wind, P;   // outdoor temp C, outdoor w g/kg, effective solar W/m2, wind mph, pressure Pa
  double h1, h2, vent, f1, f2, fog, mc, ms, mw, glm, glg;  // actuator duty 0..1
  double cs = 1.0;   // canopy / moisture-source scale (1 = the autumn-2026 house)
};

static inline double esat_pa(double tc) { return 610.94 * std::exp(17.625 * tc / (tc + 243.04)); }
static inline double w_from_e(double e, double P) { return 622.0 * e / (P - e); }
static inline double e_from_w(double w, double P) { return w * P / (622.0 + w); }
static inline double wsat(double tc, double P) { return w_from_e(esat_pa(tc), P); }
static inline double vpd_kpa(double tc, double w, double P) {
  return std::max(0.0, (esat_pa(tc) - e_from_w(w, P)) / 1000.0);
}
static inline double rh_pct(double tc, double w, double P) {
  return std::min(100.0, 100.0 * e_from_w(w, P) / esat_pa(tc));
}
static inline double dewpoint_c(double w, double P) {
  double e = std::max(1.0, e_from_w(w, P));
  double a = std::log(e / 610.94);
  return 243.04 * a / (17.625 - a);
}

// exact update of dx/dt = a - b x over dt (b >= 0)
static inline double relax(double x, double a, double b, double dt) {
  if (b < 1e-12) return x + a * dt;
  double xeq = a / b;
  return xeq + (x - xeq) * std::exp(-b * dt);
}

static const double CP_AIR = 1006.0;   // J/(kg K)
static const double LATENT = 2450.0;   // J/g
static const double GL_MAIN_W = 630.0, GL_GROW_W = 816.0;
static const double W_MS = 1.2, W_MW = 0.6;  // south and west nozzle counts relative to centre (30/25, 15/25)

static inline void phys_init(PhysState& s, double T, double w) {
  s.Ta = s.Ti = s.Tm = s.Ts = T; s.w = s.wb = s.ws = w; s.qh1 = s.qh2a = s.qh2 = 0; s.R = 0;
}

static inline void phys_step(PhysState& s, const PhysIn& u, const double* p, double dt) {
  const double mv = p[P_MV_VENT] * u.vent + p[P_MV_FAN1] * std::max(u.f1, u.f2) + p[P_MV_FAN2] * std::min(u.f1, u.f2);
  const double vpd = vpd_kpa(s.Ta, s.w, u.P);
  const double mist_w = u.mc + W_MS * u.ms + W_MW * u.mw;
  const double e_fog = p[P_GFOG] * u.fog * vpd;
  const double e_mist = p[P_GMIST] * mist_w * vpd;
  const double fill = p[P_RFOG] * u.fog + p[P_RMIST] * mist_w;
  double e_res = p[P_KRES] * s.R * vpd;
  if (e_res * dt > s.R) e_res = s.R / dt;
  const double e_tr = u.cs * ((p[P_TR0] + p[P_TRS] * u.S) * vpd + p[P_E0]);
  const double Tg = u.To + p[P_GLAZE] * (s.Ta - u.To);
  const double wsg = wsat(Tg, u.P);
  const double cond_k = p[P_KCOND] * (s.w > wsg ? 1.0 : 0.0);

  // heater lags
  s.qh1 = p[P_QH1] * u.h1;
  s.qh2a = relax(s.qh2a, p[P_QH2] * u.h2 / p[P_TAUH2], 1.0 / p[P_TAUH2], dt);
  s.qh2 = relax(s.qh2, s.qh2a / p[P_TAUH2], 1.0 / p[P_TAUH2], dt);

  // moisture: Ma dw/dt = (mv+minf)(wo - w) + kb (wb - w) + sources - cond_k (w - wsg)
  const double mex = mv + p[P_MINF];
  const double a_w = (mex * u.wo + p[P_KB] * s.wb + e_fog + e_mist + e_res + e_tr + cond_k * wsg) / p[P_MA];
  const double b_w = (mex + p[P_KB] + cond_k) / p[P_MA];
  double w_new = relax(s.w, a_w, b_w, dt);
  const double ws_air = wsat(s.Ta, u.P);
  if (w_new > ws_air) w_new = ws_air;
  const double wb_new = relax(s.wb, p[P_KB] * s.w / p[P_MB], p[P_KB] / p[P_MB], dt);

  // air node
  const double ua = p[P_UA] + p[P_UAW] * u.wind + mv * CP_AIR;
  const double q_src = p[P_SOLA] * u.S + (1.0 - p[P_FH1I]) * s.qh1 + s.qh2 + p[P_QLA] * (GL_MAIN_W * u.glm + GL_GROW_W * u.glg)
                       - LATENT * (e_fog + e_mist);
  const double Ta_new = relax(s.Ta, (p[P_HAI] * s.Ti + ua * u.To + q_src) / p[P_CA], (p[P_HAI] + ua) / p[P_CA], dt);
  // intermediate node (evaporation from wet surfaces and transpiration draw their latent heat here)
  const double Ti_new = relax(s.Ti,
      (p[P_HAI] * s.Ta + p[P_HIM] * s.Tm + p[P_SOLI] * u.S + p[P_FH1I] * s.qh1 - LATENT * (e_res + e_tr)) / p[P_CI],
      (p[P_HAI] + p[P_HIM]) / p[P_CI], dt);
  // slow node
  const double Tm_new = relax(s.Tm, (p[P_HIM] * s.Ti + p[P_UAM] * u.To + p[P_SOLM] * u.S) / p[P_CM],
                              (p[P_HIM] + p[P_UAM]) / p[P_CM], dt);

  double R_new = s.R + (fill - e_res) * dt;
  if (R_new < 0) R_new = 0;
  if (R_new > p[P_RMAX]) R_new = p[P_RMAX];

  s.Ta = Ta_new; s.Ti = Ti_new; s.Tm = Tm_new; s.w = w_new; s.wb = wb_new; s.R = R_new;
  s.Ts = relax(s.Ts, (s.Ta + p[P_PLUME] * s.qh2 / p[P_QH2]) / p[P_TAUS_T], 1.0 / p[P_TAUS_T], dt);
  s.ws = relax(s.ws, s.w / p[P_TAUS_W], 1.0 / p[P_TAUS_W], dt);
}
