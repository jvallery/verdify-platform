// fit_kernel.cpp — open-loop simulation of the physics model with RECORDED actuator duty.
#include "physics.h"
extern "C" {
// reset[i]: 0 = continue, 1 = re-initialise measured states (Ta, w, sensors) from measurements,
// 2 = cold start (all states), -1 = invalid minute (state held, output NaN). sub = sub-steps per minute.
void simulate_open(const double* p, int n, int sub,
                   const double* Tmeas, const double* wmeas,
                   const double* To, const double* wo, const double* S, const double* Scot,
                   const double* wind, const double* P,
                   const double* h1, const double* h2, const double* vent, const double* f1, const double* f2,
                   const double* fog, const double* mc, const double* ms, const double* mw,
                   const double* glm, const double* glg, const double* cs,
                   const int* reset, double* Tsim, double* wsim, double* Tiout, double* Tmout) {
  PhysState s; phys_init(s, 20, 6);
  const double dt = 60.0 / sub;
  for (int i = 0; i < n; ++i) {
    if (reset[i] < 0) { Tsim[i] = NAN; wsim[i] = NAN; Tiout[i] = NAN; Tmout[i] = NAN; continue; }
    if (reset[i] == 2) { phys_init(s, Tmeas[i], wmeas[i]); s.qh1 = p[P_QH1] * h1[i]; s.qh2a = s.qh2 = p[P_QH2] * h2[i]; }
    else if (reset[i] == 1) { s.Ta = s.Ts = Tmeas[i]; s.w = s.ws = wmeas[i]; }
    Tsim[i] = s.Ts; wsim[i] = s.ws; Tiout[i] = s.Ti; Tmout[i] = s.Tm;
    PhysIn u{To[i], wo[i], S[i] + p[P_SOLALT] * Scot[i], wind[i], P[i],
             h1[i], h2[i], vent[i], f1[i], f2[i], fog[i], mc[i], ms[i], mw[i], glm[i], glg[i], cs[i]};
    for (int k = 0; k < sub; ++k) phys_step(s, u, p, dt);
  }
}
int phys_nparams() { return P_N; }
}
