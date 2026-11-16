/*
 * test_gap_log_device.cpp - host tests for the gap log's device side (firmware/lib/gap_log_esphome.h) against an
 * in-memory NVS (test/fake_idf): arming, quarter writes, the stopping rules, the shutdown flush, the ring scan at
 * boot, and the replay pump with its drained-mark handshake (contracts/gap-log.md 9.4).
 *
 * Compile: g++ -std=c++17 -Wall -DESP_PLATFORM -I test/fake_idf -I lib -o test/test_gap_log_device \
 *          test/test_gap_log_device.cpp
 */

#include "gap_log_esphome.h"

#include <cstdio>
#include <string>
#include <vector>

using namespace gap_log;
namespace dev = gap_log_dev;

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

static const uint32_t E = 1763337600u;

static void fresh_device(bool wipe_nvs) {
    dev::rt() = dev::Runtime{};
    if (wipe_nvs) fake_nvs.clear();
    fake_nvs_partition.size = 436 * 1024;
    fake_total_entries = 13608;
    fake_other_used = 1725;
    fake_fail_writes = false;
    fake_write_us = 2000;
}

static Climate snap() {
    Climate c;
    c.flags = C_TEMP | C_HUM;
    c.tin = 705;
    return c;
}

// Seconds [from, to) of control passes; the relay mask toggles bit 0 every 100 s.
static void run(uint32_t from, uint32_t to, bool connected) {
    for (uint32_t s = from; s < to; ++s) dev::tick(stamp(true, E + s, s), connected, (s / 100) & 1u, snap());
}

struct Pump {
    uint32_t ms = 0;
    ReplayConditions c;
    std::vector<std::string> lines;
    Pump() {
        c.connected = true;
        c.free_bytes = 60000;
        c.minute_low_bytes = 40000;
    }
    void for_ms(uint32_t span, uint32_t uptime_s) {
        for (uint32_t end = ms + span; ms < end; ms += REPLAY_LINE_MS) {
            const char* l = dev::replay_step(ms, c, stamp(true, E + uptime_s, uptime_s));
            if (l) lines.push_back(l);
        }
    }
    size_t count(char type) const {
        size_t n = 0;
        for (auto& l : lines) n += l.size() > 3 && l[3] == type;
        return n;
    }
};

static void arming() {
    fresh_device(true);
    fake_nvs_partition.size = 20 * 1024;
    dev::boot(1);
    CHECK(dev::rt().state == LogState::OFF_NVS_SMALL && !dev::rt().nvs_open);
    run(0, 2000, false);
    CHECK(fake_nvs.empty());

    fresh_device(true);
    fake_other_used = 10300;  // 24.3 % free
    dev::boot(1);
    CHECK(dev::rt().state == LogState::OFF_NVS_FULL);
    run(0, 2000, false);
    CHECK(fake_nvs.empty());

    fresh_device(true);
    dev::boot(1);
    CHECK(dev::rt().state == LogState::ARMED && dev::rt().col.next_qseq == 0);
}

static void writes_and_stopping() {
    fresh_device(true);
    dev::boot(2);
    run(0, 1800, true);  // two full quarters, both live
    CHECK(fake_nvs.count("q00") == 1 && fake_nvs.count("q01") == 0);  // q01 is still open at 1799
    run(1800, 1801, true);
    CHECK(fake_nvs.count("q01") == 1 && !dev::rt().pending.any());
    Header h;
    CHECK(dev::load(0, h) && h.boot == 2 && (h.flags & Q_LIVE) && h.n_clim == MAX_CLIMATE && h.n_tr == 8);
    CHECK(dev::take_write_worst_us() == 2000 && dev::take_write_worst_us() == 0);

    // three slow writes in a row stop the log
    fake_write_us = 250000;
    run(1801, 1801 + 3 * 900, true);
    CHECK(dev::rt().state == LogState::OFF_NVS_SLOW);
    const size_t keys = fake_nvs.size();
    run(1801 + 3 * 900, 1801 + 5 * 900, true);
    CHECK(fake_nvs.size() == keys);

    // a failed write stops it too
    fresh_device(true);
    dev::boot(3);
    fake_fail_writes = true;
    run(0, 901, true);
    CHECK(dev::rt().state == LogState::OFF_NVS_ERROR);

    // free entries under 15 % stop it
    fresh_device(true);
    dev::boot(3);
    CHECK(dev::rt().state == LogState::ARMED);
    fake_other_used = 11563;  // 15.03 % free before the write; the quarter's entries take it under 15 %
    run(0, 899, true);
    CHECK(dev::rt().state == LogState::ARMED);
    run(899, 901, true);
    CHECK(dev::rt().state == LogState::OFF_NVS_FULL);
}

static void shutdown_and_boot_scan() {
    fresh_device(true);
    dev::boot(4);
    run(0, 1000, false);  // q00 full (not live), q01 open for 100 s
    dev::shutdown();
    Header h;
    CHECK(dev::load(1, h) && (h.flags & Q_PARTIAL) && h.n_clim == (FORMAT == 2 ? 2 : 1) && !(h.flags & Q_LIVE));
    // restart: the scan continues the sequence and finds both quarters to replay
    fresh_device(false);
    dev::boot(5);
    CHECK(dev::rt().col.next_qseq == 2 && dev::rt().pending.has(0) && dev::rt().pending.has(1));
}

static void replay_handshake() {
    fresh_device(true);
    dev::boot(6);
    run(0, 900 * 3, false);  // three quarters during an outage
    run(900 * 3, 900 * 4 + 1, true);  // one live quarter after it, opened with the session up
    CHECK(dev::rt().col.next_qseq == 4);
    Pump p;
    p.for_ms(59000, 3700);  // the session is younger than 60 s: nothing
    CHECK(p.lines.empty());
    p.for_ms(60000, 3760);
    CHECK(p.count('B') == 1 && p.count('Q') == 3 && p.count('E') == 1);
    CHECK(p.count('C') == (FORMAT == 2 ? 9u : 3u) && p.count('T') == 3);
    CHECK(p.lines[0] == "G1 B 6 3760 " + std::to_string(E + 3760) + " 3");
    CHECK(p.lines.back() == "G1 E 6 3 2");
    CHECK(p.lines[1].rfind("G1 Q 6 0 ", 0) == 0 && p.lines[2].rfind("G1 C 0 c=0,", 0) == 0);
    for (auto& l : p.lines) CHECK(l.size() <= REPLAY_LINE_MAX);
    CHECK(!fake_nvs.count("meta"));  // still settling
    p.for_ms(60000, 3820);
    CHECK(fake_nvs.count("meta") && dev::rt().any_drained && dev::rt().drained == 2 && !dev::rt().pending.any());
    const size_t n = p.lines.size();
    p.for_ms(60000, 3880);
    CHECK(p.lines.size() == n);  // nothing more to send
    // a restart keeps the mark: nothing is replayed again
    fresh_device(false);
    dev::boot(7);
    CHECK(!dev::rt().pending.any() && dev::rt().drained == 2 && dev::rt().col.next_qseq == 4);
}

static void replay_interrupted_and_paused() {
    fresh_device(true);
    dev::boot(8);
    run(0, 900 * 2 + 1, false);
    Pump p;
    p.for_ms(64000, 2000);
    CHECK(p.count('B') == 1 && p.count('E') == 1);
    p.c.connected = false;  // the session breaks before the 60 s settle
    p.for_ms(1000, 2001);
    CHECK(!fake_nvs.count("meta") && dev::rt().pending.has(0) && dev::rt().pending.has(1));
    p.c.connected = true;
    p.lines.clear();
    p.c.api_pending_bytes = 100;  // API backlog: paused
    p.for_ms(70000, 2070);
    CHECK(p.lines.empty());
    p.c.api_pending_bytes = 0;
    p.for_ms(500, 2071);
    CHECK(p.lines.size() == 2 && p.lines[0].rfind("G1 B 8 ", 0) == 0);
    p.c.free_bytes = 10000;  // heap under 20 KB: paused mid-pass
    p.for_ms(5000, 2076);
    CHECK(p.lines.size() == 2);
    p.c.free_bytes = 60000;
    p.for_ms(120000, 2200);
    CHECK(p.count('B') == 1 && p.count('Q') == 2 && p.count('E') == 1 && dev::rt().drained == 1);
}

static void ring_wrap() {
    fresh_device(true);
    dev::boot(9);
    run(0, 900 * 100 + 1, false);  // 100 quarters: the 4 oldest are overwritten
    CHECK(dev::rt().col.next_qseq == 100 && fake_nvs.size() == 96);
    Pump p;
    p.for_ms(60000 + 96 * 8 * REPLAY_LINE_MS, 90100);
    CHECK(p.count('Q') == 96 && p.lines[1].rfind("G1 Q 9 4 ", 0) == 0 && p.count('E') == 1);
    CHECK(p.lines[0] == "G1 B 9 90100 " + std::to_string(E + 90100) + " 96");
}

int main() {
    printf("gap log device side, format %u\n", unsigned(FORMAT));
    arming();
    writes_and_stopping();
    shutdown_and_boot_scan();
    replay_handshake();
    replay_interrupted_and_paused();
    ring_wrap();
    printf("%d checks passed, %d failed\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
