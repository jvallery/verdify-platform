/*
 * test_gap_log.cpp - host tests for the gap log (firmware/lib/gap_log.h, contracts/gap-log.md): the record format,
 * the ring, clockless stamping, the arming and stopping rules, the replay conditions and the replay lines.
 *
 * Compile: g++ -std=c++17 -Wall -I lib -o test/test_gap_log test/test_gap_log.cpp
 *          (and -DGAP_LOG_FORMAT=1 for the 5-minute fallback)
 */

#include "gap_log.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace gap_log;

static int passed = 0, failed = 0;
#define CHECK(x)                                                     \
    do {                                                             \
        if (x) {                                                     \
            ++passed;                                                \
        } else {                                                     \
            ++failed;                                                \
            printf("  FAIL line %d: %s\n", __LINE__, #x);            \
        }                                                            \
    } while (0)

static Climate snap(float tin) {
    Climate c;
    c.flags = C_TEMP | C_HUM | C_OUT;
    c.mode = 3;
    c.tin = tenths(tin);
    c.tdp = tenths(tin - 15.0f);
    c.tout = tenths(-4.25f);
    c.water = 12345;
    return c;
}

// Runs the collector second by second like the control pass; returns the closed quarters.
struct Run {
    Collector c;
    std::vector<Quarter> closed;
    void pass(const Stamp& s, bool connected, uint32_t mask, float tin = 70.0f) {
        const Close why = collect(c, s, connected, mask, snap(tin));
        if (why == Close::NONE) return;
        closed.push_back(c.q);
        start_next(c);
        if (why != Close::TRANSITIONS_FULL) collect(c, s, connected, mask, snap(tin));  // this pass's data
    }
};

static void format_round_trip() {
    Quarter q;
    q.flags = Q_TRUSTED | Q_TRUNCATED;
    q.boot = 65535;
    q.qseq = 4000000000u;
    q.t0 = 1763337600u;
    q.off = 1763000000u;
    q.n_clim = MAX_CLIMATE;
    q.n_tr = MAX_TRANSITIONS;
    for (uint8_t i = 0; i < q.n_clim; ++i) {
        q.clim[i] = snap(-12.34f + i);
        q.clim[i].dt = uint16_t(i * SLOT_S);
        q.clim[i].relays = 0x3FFFFu;
        q.clim[i].seq = uint16_t(65530 + i);
    }
    q.clim[0].tdp = NO_VALUE;
    for (uint8_t i = 0; i < q.n_tr; ++i) q.tr[i] = Transition{uint16_t(899 - i), uint8_t(i % RELAYS), uint8_t(i & 1), uint16_t(i)};
    uint8_t buf[MAX_BLOB];
    const size_t n = encode(q, buf, sizeof(buf));
    CHECK(n == MAX_BLOB);
    CHECK(MAX_BLOB == (FORMAT == 2 ? 702u : 462u));
    CHECK(encode(q, buf, MAX_BLOB - 1) == 0);
    Quarter d;
    CHECK(decode(buf, n, d));
    CHECK(d.ver == FORMAT && d.flags == q.flags && d.boot == q.boot && d.qseq == q.qseq && d.t0 == q.t0 && d.off == q.off);
    CHECK(d.n_clim == q.n_clim && d.n_tr == q.n_tr);
    CHECK(d.clim[0].tdp == NO_VALUE && d.clim[0].tin == tenths(-12.34f) && d.clim[0].tin == -123);
    CHECK(d.clim[MAX_CLIMATE - 1].seq == q.clim[MAX_CLIMATE - 1].seq && d.clim[1].relays == 0x3FFFFu);
    CHECK(d.clim[2].water == 12345 && d.clim[2].tout == -43);
    CHECK(d.tr[63].dt == 899 - 63 && d.tr[63].relay == 63 % RELAYS && d.tr[63].state == 1 && d.tr[63].seq == 63);
    // a short blob, an unknown version and an impossible count are refused
    CHECK(!decode(buf, n - 1, d));
    buf[0] = 3;
    CHECK(!decode(buf, n, d));
    buf[0] = FORMAT;
    buf[16] = 16;  // n_clim above 15
    CHECK(!decode_header(buf, n, d));
    // NaN and out-of-range readings are NO_VALUE
    CHECK(tenths(0.0f / 0.0f) == NO_VALUE && tenths(5000.0f) == NO_VALUE && tenths(0.04f) == 0 && tenths(-0.05f) == -1);
    char key[4];
    key_for(0, key);
    CHECK(strcmp(key, "q00") == 0);
    key_for(96 * 7 + 95, key);
    CHECK(strcmp(key, "q95") == 0);
}

static void clockless_stamping() {
    const Stamp a = stamp(false, 1763337600u, 500);
    CHECK(!a.trusted && a.t == 500 && a.off == 0);
    const Stamp b = stamp(true, 1763337600u, 500);
    CHECK(b.trusted && b.t == 1763337600u && b.off == 1763337100u);
    const Stamp c = stamp(true, 400, 500);  // an epoch that cannot be real is not trusted
    CHECK(!c.trusted && c.t == 500);

    // Untrusted boot: a quarter on the uptime basis; trust arrives at 1000 s and closes it early.
    Run r;
    r.c.boot = 7;
    for (uint32_t t = 100; t < 1000; ++t) r.pass(stamp(false, 0, t), true, 0);
    CHECK(r.closed.empty());  // the uptime quarter 100..999 closes full at 1000 (900 s)
    for (uint32_t t = 1000; t < 1100; ++t) r.pass(stamp(t >= 1050, 1763337600u + t, t), true, 0);
    CHECK(r.closed.size() == 2);
    const Quarter& q = r.closed[1];
    CHECK(!(q.flags & Q_TRUSTED) && (q.flags & Q_PARTIAL) && q.t0 == 1000 && q.off == 0 && q.boot == 7);
    CHECK(r.c.q.flags & Q_TRUSTED);
    CHECK(r.c.q.t0 == 1763337600u + 1050 && r.c.q.off == 1763337600u);  // the open quarter places the earlier ones
    CHECK(r.closed[0].qseq == 0 && q.qseq == 1 && r.c.q.qseq == 2);
}

static void collector_records_and_transitions() {
    Run r;
    const uint32_t E = 1763337600u;
    // first pass: no transition (no previous mask), climate record 0 at dt 0
    r.pass(stamp(true, E, 10), true, 0x1u);
    CHECK(r.c.q.n_clim == 1 && r.c.q.n_tr == 0 && r.c.q.clim[0].relays == 0x1u && (r.c.q.flags & Q_LIVE));
    for (uint32_t s = 1; s < 900; ++s) {
        const uint32_t mask = (s == 5 || s == 6) ? 0x3u : (s == 70 ? 0x20001u : 0x1u);
        r.pass(stamp(true, E + s, 10 + s), s < 400 || s > 460, mask);
    }
    const Quarter& q = r.c.q;
    CHECK(q.n_clim == MAX_CLIMATE);
    CHECK(q.clim[1].dt == SLOT_S && q.clim[MAX_CLIMATE - 1].dt == (MAX_CLIMATE - 1) * SLOT_S);
    CHECK(q.clim[1].seq == 1);
    CHECK(q.n_tr == 4);  // bit1 on at 5, off at 7; bit17 on at 70, off at 71
    CHECK(q.tr[0].dt == 5 && q.tr[0].relay == 1 && q.tr[0].state == 1);
    CHECK(q.tr[1].dt == 7 && q.tr[1].relay == 1 && q.tr[1].state == 0);
    CHECK(q.tr[2].dt == 70 && q.tr[2].relay == 17 && q.tr[2].state == 1 && q.tr[3].seq == 3);
    CHECK(!(q.flags & Q_LIVE));  // the session dropped inside the quarter: it will be replayed
    CHECK(r.closed.empty());
    r.pass(stamp(true, E + 900, 910), true, 0x1u);  // 900 s: the quarter closes, the next opens with this pass
    CHECK(r.closed.size() == 1 && !(r.closed[0].flags & Q_PARTIAL) && r.c.q.t0 == E + 900 && r.c.q.n_clim == 1);
    CHECK(r.c.q.flags & Q_LIVE);

    // 64 transitions close the quarter early, nothing lost
    Run f;
    for (uint32_t s = 0; s <= 70; ++s) f.pass(stamp(true, E + s, s), true, (s & 1) ? 0x1u : 0x0u);
    CHECK(f.closed.size() == 1 && f.closed[0].n_tr == MAX_TRANSITIONS && (f.closed[0].flags & Q_PARTIAL));
    CHECK(!(f.closed[0].flags & Q_TRUNCATED));
    CHECK(f.c.q.n_tr == 70 - 64 && f.c.q.tr[0].seq == 64);
}

static void arming_and_stopping() {
    CHECK(arm_state(436 * 1024, 10000, 13608, true) == LogState::ARMED);
    CHECK(arm_state(20 * 1024, 400, 504, true) == LogState::OFF_NVS_SMALL);
    CHECK(arm_state(436 * 1024, 3401, 13608, true) == LogState::OFF_NVS_FULL);  // 24.99 %
    CHECK(arm_state(436 * 1024, 3402, 13608, true) == LogState::ARMED);         // 25.0 %
    CHECK(arm_state(436 * 1024, 10000, 13608, false) == LogState::OFF_NVS_ERROR);
    CHECK(arm_state(436 * 1024, 0, 0, true) == LogState::OFF_NVS_FULL);
    WriteHealth h;
    CHECK(after_write(h, true, 250000, 9000, 13608) == LogState::ARMED);
    CHECK(after_write(h, true, 250000, 9000, 13608) == LogState::ARMED);
    CHECK(after_write(h, true, 3000, 9000, 13608) == LogState::ARMED);  // a fast write resets the run
    CHECK(after_write(h, true, 200001, 9000, 13608) == LogState::ARMED);
    CHECK(after_write(h, true, 200001, 9000, 13608) == LogState::ARMED);
    CHECK(after_write(h, true, 200001, 9000, 13608) == LogState::OFF_NVS_SLOW);
    WriteHealth g;
    CHECK(after_write(g, true, 200000, 9000, 13608) == LogState::ARMED);  // exactly 200 ms is not slow
    CHECK(after_write(g, true, 1000, 2042, 13608) == LogState::ARMED);    // 15.006 %
    CHECK(after_write(g, true, 1000, 2041, 13608) == LogState::OFF_NVS_FULL);  // 14.998 %
    CHECK(after_write(g, false, 1000, 9000, 13608) == LogState::OFF_NVS_ERROR);
    CHECK(strcmp(state_text(LogState::ARMED), "armed") == 0 && strcmp(state_text(LogState::OFF_NVS_SLOW), "off: nvs_slow") == 0);
}

static void replay_conditions_and_ring() {
    ReplayConditions c;
    c.connected = true;
    c.connected_ms = 60000;
    c.free_bytes = 20 * 1024;
    c.minute_low_bytes = 24 * 1024;
    CHECK(replay_may_send(c));
    ReplayConditions x = c; x.connected = false; CHECK(!replay_may_send(x));
    x = c; x.connected_ms = 59999; CHECK(!replay_may_send(x));
    x = c; x.api_pending_bytes = 1; CHECK(!replay_may_send(x));
    x = c; x.api_overflow_bytes = 1; CHECK(!replay_may_send(x));
    x = c; x.api_syncing = 1; CHECK(!replay_may_send(x));
    x = c; x.free_bytes = 20 * 1024 - 1; CHECK(!replay_may_send(x));
    x = c; x.minute_low_bytes = 24 * 1024 - 1; CHECK(!replay_may_send(x));

    Pending p;
    CHECK(!p.any());
    p.set(5); p.set(95); p.set(96 + 40);
    CHECK(p.has(5) && p.has(95) && p.has(40) && p.has(96 + 5) && !p.has(6) && p.any());
    p.clear(101);  // same slot as 5
    CHECK(!p.has(5) && p.any());
    CHECK(ring_first(10) == 0 && ring_first(96) == 0 && ring_first(97) == 1 && ring_first(500) == 404);
    CHECK(replay_from(0, false, 10) == 0);       // nothing drained yet
    CHECK(replay_from(7, true, 10) == 8);
    CHECK(replay_from(7, true, 500) == 404);     // older than the ring: gone
    CHECK(replay_from(450, true, 500) == 451);
}

static void replay_lines() {
    char line[256];
    CHECK(line_begin(line, sizeof(line), 65535, 4294967295u, 4294967295u, 96));
    CHECK(std::string(line) == "G1 B 65535 4294967295 4294967295 96");
    Quarter q;
    q.boot = 3;
    q.qseq = 41;
    q.flags = Q_TRUSTED;
    q.t0 = 1763337600u;
    q.off = 1763330000u;
    q.n_clim = MAX_CLIMATE;
    q.n_tr = 25;
    for (uint8_t i = 0; i < q.n_clim; ++i) { q.clim[i] = snap(70.1f); q.clim[i].dt = uint16_t(i * SLOT_S); q.clim[i].seq = i; }
    for (uint8_t i = 0; i < q.n_tr; ++i) q.tr[i] = Transition{uint16_t(10 + i), uint8_t(i % RELAYS), uint8_t(i & 1), uint16_t(i)};
    uint8_t blob[MAX_BLOB];
    CHECK(encode(q, blob, sizeof(blob)) > 0);
    CHECK(line_quarter(line, sizeof(line), q));
    char want[96];
    snprintf(want, sizeof(want), "G1 Q 3 41 %u 1 1763337600 1763330000 %u 25", unsigned(FORMAT), unsigned(MAX_CLIMATE));
    CHECK(std::string(line) == want);
    // climate in 5-minute parts
    uint8_t first = 0, lines = 0;
    while (uint8_t n = line_climate(line, sizeof(line), q, blob, first)) {
        CHECK(strlen(line) <= REPLAY_LINE_MAX && strncmp(line, "G1 C 41 c=", 10) == 0);
        CHECK(n <= CLIMATE_PER_LINE);
        if (lines == 0) CHECK(n == CLIMATE_PER_LINE || n == q.n_clim);
        first = uint8_t(first + n);
        ++lines;
    }
    CHECK(first == q.n_clim && lines == (FORMAT == 2 ? 3 : 1));
    // worst-case values still fit, in smaller parts
    for (uint8_t i = 0; i < q.n_clim; ++i) {
        q.clim[i] = Climate{65535, 255, 255, -32768, -32768, -32768, 4294967295u, 4294967295u, 65535};
    }
    CHECK(encode(q, blob, sizeof(blob)) > 0);
    first = 0;
    while (uint8_t n = line_climate(line, sizeof(line), q, blob, first)) { CHECK(strlen(line) <= REPLAY_LINE_MAX); first = uint8_t(first + n); }
    CHECK(first == q.n_clim);
    CHECK(line_climate(line, REPLAY_LINE_MAX, q, blob, 0) == 0);  // a buffer that cannot hold a full line is refused
    // transitions, 12 per line
    first = 0; lines = 0;
    while (uint8_t n = line_transitions(line, sizeof(line), q, blob, first)) {
        CHECK(strlen(line) <= REPLAY_LINE_MAX);
        if (lines == 0) CHECK(strncmp(line, "G1 T 41 10,0,0,0 11,1,1,1", 25) == 0);
        first = uint8_t(first + n);
        ++lines;
    }
    CHECK(first == 25 && lines == 3);
    q.n_tr = MAX_TRANSITIONS;
    for (uint8_t i = 0; i < q.n_tr; ++i) q.tr[i] = Transition{65535, 255, 255, 65535};
    CHECK(encode(q, blob, sizeof(blob)) > 0);
    first = 0;
    while (uint8_t n = line_transitions(line, sizeof(line), q, blob, first)) { CHECK(strlen(line) <= REPLAY_LINE_MAX); first = uint8_t(first + n); }
    CHECK(first == MAX_TRANSITIONS);
    CHECK(line_end(line, sizeof(line), 3, 96, 41));
    CHECK(std::string(line) == "G1 E 3 96 41");
}

int main() {
    printf("gap log format %u (%u-second records)\n", unsigned(FORMAT), unsigned(SLOT_S));
    format_round_trip();
    clockless_stamping();
    collector_records_and_transitions();
    arming_and_stopping();
    replay_conditions_and_ring();
    replay_lines();
    printf("%d checks passed, %d failed\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
