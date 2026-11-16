// The law replay over the recorded corpus (plan 13, phase 3; contracts/phase3-wiring.md section 9; #1671).
//
// It replaces the replay-diff gate of determine_mode() for the control path: the recorded sensor traces
// (firmware/test/data/replay_overrides.csv.gz, tab separated, on stdin) drive climate_law::step_checked() and
// relay_step() at the controller's 1 s pass, and every pass is checked against the section 13 invariants:
//   - interlocks: the furnace never with the vent or a fan; no fan without the vent; the furnace's boot wait (G4)
//     except at or below 40 F (G1b);
//   - protection (G1, G1a, G1c): at or above 100 F no heater, the vent open and both fans on; at or below 40 F no
//     vent and no fan, the electric heater on, the furnace on from the next pass; the fogger keeps its minimum times;
//   - no valid temperature: nothing requested;
//   - noise: no relay switches inside its minimum on or off time outside a protection pass.
// Besides the recorded traces it runs three injected ones made from the same rows: the temperature lifted to
// 100 F and above for a span, lowered to 40 F and below for a span, and NaN indoor and outdoor readings.
// It reports the drying start/stop pairs and the starts per relay.
//
// Usage: gzip -dc firmware/test/data/replay_overrides.csv.gz | test_climate_law_replay [max_rows]

#include "climate_law.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace L = climate_law;

struct Row {
    double t_s;  // seconds since the first row
    double T, vpd, rh, dp, out_T, out_dp, out_age;
    L::Band band;
};

static double num(const std::string& s) {
    if (s.empty()) return NAN;
    char* end = nullptr;
    const double v = std::strtod(s.c_str(), &end);
    return end == s.c_str() ? NAN : v;
}

// "2026-04-09 00:00:31.501193+00" -> seconds (days from civil, UTC)
static double parse_ts(const std::string& s) {
    int y, mo, d, h, mi;
    double sec;
    if (std::sscanf(s.c_str(), "%d-%d-%d %d:%d:%lf", &y, &mo, &d, &h, &mi, &sec) != 6) return NAN;
    y -= mo <= 2;
    const int era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = unsigned(y - era * 400);
    const unsigned doy = unsigned((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1);
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    const double days = double(era) * 146097 + double(doe) - 719468;
    return days * 86400.0 + h * 3600.0 + mi * 60.0 + sec;
}

static int failures = 0;
static std::map<std::string, int> fail_counts;
static void fail(const std::string& what, const std::string& where) {
    if (fail_counts[what]++ < 3) std::printf("FAIL %s at %s\n", what.c_str(), where.c_str());
    ++failures;
}

struct Stats {
    long passes = 0, dry_starts = 0, dry_stops = 0, hot = 0, cold = 0, no_temp = 0;
    long starts[6] = {0, 0, 0, 0, 0, 0};
};

static const char* kRelay[6] = {"heat1", "heat2", "fan1", "fan2", "fog", "vent"};

// One trace through the law and the relay layer at 1 s passes.
static Stats run_trace(const std::vector<Row>& rows, const char* name) {
    Stats st;
    L::State s;
    L::RelayState r;
    const L::Band corridor{65.0, 80.0, 0.8, 1.25};  // a band for rows that recorded none
    uint32_t since_boot_ms = 0;
    bool prev_on[6] = {false, false, false, false, false, false};
    uint32_t since_edge_ms[6] = {UINT32_MAX, UINT32_MAX, UINT32_MAX, UINT32_MAX, UINT32_MAX, UINT32_MAX};
    const uint32_t min_on_ms[6] = {L::HEAT_MIN_ON_S * L::MS_PER_S, L::HEAT_MIN_ON_S * L::MS_PER_S,
                                   L::FAN_MIN_ON_S * L::MS_PER_S,  L::FAN_MIN_ON_S * L::MS_PER_S,
                                   L::FOG_MIN_ON_S * L::MS_PER_S,  L::VENT_MIN_ON_S * L::MS_PER_S};
    const uint32_t min_off_ms[6] = {L::HEAT_MIN_OFF_S * L::MS_PER_S, L::HEAT_MIN_OFF_S * L::MS_PER_S,
                                    L::FAN_MIN_OFF_S * L::MS_PER_S,  L::FAN_MIN_OFF_S * L::MS_PER_S,
                                    L::FOG_MIN_OFF_S * L::MS_PER_S,  L::VENT_MIN_OFF_S * L::MS_PER_S};
    bool was_drying = false, prev_cold = false;
    double fan_run[2] = {0, 0};
    for (size_t i = 0; i < rows.size(); ++i) {
        const Row& w = rows[i];
        // hold each row until the next (at most 5 minutes; a longer gap is a restart of the trace's clock)
        const double next = i + 1 < rows.size() ? rows[i + 1].t_s : w.t_s + 60;
        int secs = int(std::lround(next - w.t_s));
        if (secs < 1) secs = 1;
        if (secs > 300) secs = 300;
        L::Inputs u{};
        u.T = w.T;
        u.vpd = w.vpd;
        u.dp_f = w.dp;
        const bool band_ok = std::isfinite(w.band.low) && std::isfinite(w.band.high) &&
                             std::isfinite(w.band.vpd_low) && std::isfinite(w.band.vpd_high);
        u.band = band_ok ? w.band : corridor;
        u.temp_valid = std::isfinite(w.T);
        u.humidity_valid = std::isfinite(w.vpd) && std::isfinite(w.dp);
        u.out_ok = std::isfinite(w.out_T) && std::isfinite(w.out_dp) &&
                   !(std::isfinite(w.out_age) && w.out_age > L::OUTDOOR_MAX_AGE_S);
        u.out_T = w.out_T;
        u.out_dp_f = w.out_dp;
        u.w_in = L::humidity_ratio_g_per_kg(w.dp);
        u.w_out = L::humidity_ratio_g_per_kg(w.out_dp);
        u.dry_cost_limit = L::DRY_COST_LIMIT_DEFAULT_KWH_PER_KG;
        for (int k = 0; k < secs; ++k) {
            const L::Output q = L::step_checked(s, u);
            L::RelayInputs in{fan_run[0], fan_run[1], false, 1000};
            const bool had_air = r.vent.on || r.fan1.on || r.fan2.on;
            L::relay_step(r, q, in);
            since_boot_ms += 1000;
            ++st.passes;
            if (r.fan1.on) fan_run[0] += 1;
            if (r.fan2.on) fan_run[1] += 1;
            char where[96];
            std::snprintf(where, sizeof where, "%s row %zu (T=%.1f)", name, i, w.T);
            const bool on[6] = {r.heat1.on, r.heat2.on, r.fan1.on, r.fan2.on, r.fog.on, r.vent.on};
            // interlocks
            if (r.heat2.on && (r.vent.on || r.fan1.on || r.fan2.on)) fail("furnace with the air", where);
            if ((r.fan1.on || r.fan2.on) && !r.vent.on) fail("fan without the vent", where);
            if (r.heat2.on && !prev_on[1] && since_boot_ms <= L::HEAT_MIN_OFF_S * L::MS_PER_S && !q.cold)
                fail("furnace inside its boot wait (G4)", where);
            // no valid temperature: nothing requested
            if (!u.temp_valid && (q.heat1 || q.heat2 || q.vent || q.fog || q.mist || q.fans))
                fail("a request with no valid temperature", where);
            // protection (G1)
            if (u.temp_valid && w.T >= L::SAFETY_MAX_F) {
                if (r.heat1.on || r.heat2.on) fail("a heater on at 100 F", where);
                if (!(r.vent.on && r.fan1.on && r.fan2.on)) fail("vent and both fans not on at 100 F", where);
            }
            if (u.temp_valid && w.T <= L::SAFETY_MIN_F) {
                if (r.vent.on || r.fan1.on || r.fan2.on) fail("air on at 40 F", where);
                if (!r.heat1.on) fail("electric heater off at 40 F", where);
                if (prev_cold && !had_air && !r.heat2.on) fail("furnace off a pass after the air at 40 F", where);
            }
            prev_cold = u.temp_valid && w.T <= L::SAFETY_MIN_F;
            st.hot += q.hot;
            st.cold += q.cold;
            st.no_temp += !u.temp_valid;
            // noise: minimum times outside protection passes (the fogger keeps them always, G1a)
            const bool prot = q.hot || q.cold;
            for (int j = 0; j < 6; ++j) {
                if (since_edge_ms[j] != UINT32_MAX) since_edge_ms[j] += 1000;  // this pass's tick, as the relay layer's
                if (on[j] != prev_on[j]) {
                    const uint32_t need = on[j] ? min_off_ms[j] : min_on_ms[j];
                    if ((!prot || j == 4) && since_edge_ms[j] != UINT32_MAX && since_edge_ms[j] < need)
                        fail(std::string("a minimum time broken: ") + kRelay[j], where);
                    if (on[j]) ++st.starts[j];
                    since_edge_ms[j] = 0;
                }
                prev_on[j] = on[j];
            }
            if (q.drying && !was_drying) ++st.dry_starts;
            if (!q.drying && was_drying) ++st.dry_stops;
            was_drying = q.drying;
        }
    }
    const double hours = st.passes / 3600.0;
    std::printf("  %-10s %8.0f h, %ld s at 100 F, %ld s at 40 F, %ld s no temperature, drying starts/stops %ld/%ld, starts/h:",
                name, hours, st.hot, st.cold, st.no_temp, st.dry_starts, st.dry_stops);
    for (int j = 0; j < 6; ++j) std::printf(" %s %.2f", kRelay[j], hours > 0 ? st.starts[j] / hours : 0.0);
    std::printf("\n");
    return st;
}

int main(int argc, char** argv) {
    const long max_rows = argc > 1 ? std::atol(argv[1]) : 0;
    std::string line;
    if (!std::getline(std::cin, line)) {
        std::printf("FAIL: no corpus on stdin\n");
        return 1;
    }
    std::map<std::string, int> col;
    {
        std::stringstream hs(line);
        std::string c;
        int k = 0;
        while (std::getline(hs, c, '\t')) col[c] = k++;
    }
    const char* need[] = {"ts", "temp_avg", "vpd_avg", "rh_avg", "indoor_dew_point", "outdoor_temp_f",
                          "outdoor_dewpoint_f", "outdoor_data_age_s", "sp_temp_low", "sp_temp_high",
                          "sp_vpd_low", "sp_vpd_high"};
    for (const char* n : need) {
        if (!col.count(n)) {
            std::printf("FAIL: corpus column %s missing\n", n);
            return 1;
        }
    }
    std::vector<Row> rows;
    double t0 = NAN;
    std::vector<std::string> f;
    while (std::getline(std::cin, line)) {
        f.clear();
        std::stringstream ls(line);
        std::string c;
        while (std::getline(ls, c, '\t')) f.push_back(c);
        auto get = [&](const char* n) { const int k = col[n]; return k < int(f.size()) ? f[k] : std::string(); };
        const double t = parse_ts(get("ts"));
        if (!std::isfinite(t)) continue;
        if (!std::isfinite(t0)) t0 = t;
        Row w{};
        w.t_s = t - t0;
        w.T = num(get("temp_avg"));
        w.vpd = num(get("vpd_avg"));
        w.rh = num(get("rh_avg"));
        w.dp = num(get("indoor_dew_point"));
        w.out_T = num(get("outdoor_temp_f"));
        w.out_dp = num(get("outdoor_dewpoint_f"));
        w.out_age = num(get("outdoor_data_age_s"));
        w.band = {num(get("sp_temp_low")), num(get("sp_temp_high")), num(get("sp_vpd_low")), num(get("sp_vpd_high"))};
        rows.push_back(w);
        if (max_rows > 0 && long(rows.size()) >= max_rows) break;
    }
    if (rows.size() < 100) {
        std::printf("FAIL: corpus too short (%zu rows)\n", rows.size());
        return 1;
    }
    std::printf("climate law replay: %zu recorded rows\n", rows.size());
    run_trace(rows, "recorded");
    // injected traces: a span lifted to 100 F and above, lowered to 40 F and below, and NaN readings
    const size_t span_from = rows.size() / 3, span_to = span_from + std::min<size_t>(rows.size() / 10, 600);
    std::vector<Row> hot = rows, cold = rows, nan_rows = rows;
    for (size_t i = span_from; i < span_to; ++i) {
        hot[i].T = L::SAFETY_MAX_F + double(i % 7);
        cold[i].T = L::SAFETY_MIN_F - double(i % 7);
        nan_rows[i].T = nan_rows[i].vpd = nan_rows[i].dp = NAN;
        nan_rows[i].out_T = nan_rows[i].out_dp = NAN;
    }
    if (run_trace(hot, "hot").hot == 0) fail("the injected 100 F span never reached protection", "hot");
    if (run_trace(cold, "cold").cold == 0) fail("the injected 40 F span never reached protection", "cold");
    if (run_trace(nan_rows, "nan").no_temp == 0) fail("the injected NaN span never lost the temperature", "nan");
    for (const auto& kv : fail_counts) std::printf("  %s: %d passes\n", kv.first.c_str(), kv.second);
    std::printf("climate law replay: %s\n", failures ? "FAIL" : "PASS");
    return failures ? 1 : 0;
}
