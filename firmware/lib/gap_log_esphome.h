#pragma once
// gap_log_esphome.h - the gap log's device side (contracts/gap-log.md): arming at boot, the quarter writes to NVS
// namespace "gaplog", the clean-shutdown flush, and the replay pump with its drained-mark handshake. Every decision
// is gap_log.h's (host-tested in test/test_gap_log.cpp); this file only does the NVS I/O and the sequencing.
// Host builds see an empty file, as with policy_journal_esphome.h. No heap: static buffers only.

#include "gap_log.h"

#ifdef ESP_PLATFORM
#include "esp_log.h"
#include "esp_partition.h"
#include "esp_timer.h"
#include "nvs.h"

namespace gap_log_dev {
using namespace gap_log;

enum class Phase : uint8_t { IDLE, QUARTER, CLIMATE, TRANSITIONS, END, SETTLE };

struct Runtime {
    LogState state = LogState::NOT_ARMED_YET;
    nvs_handle_t nvs = 0;
    bool nvs_open = false;
    Collector col;
    WriteHealth health;
    Pending pending;
    uint32_t drained = 0;
    bool any_drained = false;
    uint8_t blob[MAX_BLOB];           // shared by the write and the replay read (both in the loop task)
    char line[REPLAY_LINE_MAX + 16];
    uint32_t write_worst_us = 0;      // per-minute window, NVS Write Worst Minute
    // replay
    Phase phase = Phase::IDLE;
    uint32_t to = 0, cur = 0, n_sent = 0, last_sent = 0, first_sent = 0;
    uint8_t part = 0;
    uint32_t settle_since_ms = 0;
    uint32_t recorder_id = 0;         // the recorder connection the replay session belongs to (0 = none)
    uint32_t connected_since_ms = 0;
    uint32_t session = 0, pass_session = 0;
    uint32_t tick_recorder_id = 0;    // the recorder connection the last control pass saw (liveness)
};

inline Runtime& rt() {
    static Runtime r;
    return r;
}

inline const char* state_text() { return gap_log::state_text(rt().state); }

inline uint32_t take_write_worst_us() {
    const uint32_t v = rt().write_worst_us;
    rt().write_worst_us = 0;
    return v;
}

inline bool nvs_entries(uint32_t& free_e, uint32_t& total_e) {
    nvs_stats_t st = {};
    if (nvs_get_stats(NULL, &st) != ESP_OK) return false;
    free_e = uint32_t(st.free_entries);
    total_e = uint32_t(st.total_entries);
    return true;
}

inline void set_state(LogState s) {
    Runtime& r = rt();
    if (s == r.state) return;
    r.state = s;
    ESP_LOGW("gap_log", "gap log %s", gap_log::state_text(s));
}

inline void write_meta() {
    Runtime& r = rt();
    uint8_t m[8] = {FORMAT, uint8_t(r.any_drained ? 1 : 0), 0, 0, uint8_t(r.drained), uint8_t(r.drained >> 8),
                    uint8_t(r.drained >> 16), uint8_t(r.drained >> 24)};
    if (nvs_set_blob(r.nvs, "meta", m, sizeof(m)) != ESP_OK || nvs_commit(r.nvs) != ESP_OK) {
        set_state(LogState::OFF_NVS_ERROR);
    }
}

// Reads quarter `qseq` into the blob buffer; false when the key is missing, unreadable, of an unknown version or
// already overwritten by a later quarter.
inline bool load(uint32_t qseq, Header& h) {
    Runtime& r = rt();
    if (!r.nvs_open) return false;
    char key[4];
    key_for(qseq, key);
    size_t len = sizeof(r.blob);
    if (nvs_get_blob(r.nvs, key, r.blob, &len) != ESP_OK) return false;
    return decode_header(r.blob, len, h) && h.qseq == qseq;
}

// on_boot, first (reviews GL-4, F3-UR-5): the restart count, +1 and committed to NVS at once in its own key, so a
// crash inside the first minute neither reuses the gap log's boot id nor hides from Restart Count. One write per
// boot. Returns 0 when NVS cannot be opened or written (the log then has no unique boot id either).
inline uint32_t count_restart() {
    nvs_handle_t h = 0;
    if (nvs_open("gaplog", NVS_READWRITE, &h) != ESP_OK) return 0;
    uint32_t n = 0;
    if (nvs_get_u32(h, "restarts", &n) != ESP_OK) n = 0;  // missing on the first boot of this build
    ++n;
    const bool ok = nvs_set_u32(h, "restarts", n) == ESP_OK && nvs_commit(h) == ESP_OK;
    nvs_close(h);
    if (!ok) ESP_LOGW("gap_log", "restart count %lu not stored", (unsigned long) n);
    return ok ? n : 0;
}

// on_boot: the W9b arming check, then the ring scan (the next sequence number and the quarters to replay).
inline void boot(uint16_t boot_count) {
    Runtime& r = rt();
    r.col.boot = boot_count;
    const esp_partition_t* part =
        esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_NVS, NULL);
    uint32_t free_e = 0, total_e = 0;
    const bool stats_ok = part != nullptr && nvs_entries(free_e, total_e);
    const LogState armed = arm_state(part ? uint32_t(part->size) : 0u, free_e, total_e, stats_ok);
    if (armed != LogState::OFF_NVS_SMALL && armed != LogState::OFF_NVS_ERROR) {
        r.nvs_open = nvs_open("gaplog", NVS_READWRITE, &r.nvs) == ESP_OK;
    }
    if (r.nvs_open) {
        uint8_t m[8] = {0};
        size_t len = sizeof(m);
        if (nvs_get_blob(r.nvs, "meta", m, &len) == ESP_OK && len == sizeof(m) && m[1] == 1) {
            r.any_drained = true;
            r.drained = uint32_t(m[4]) | (uint32_t(m[5]) << 8) | (uint32_t(m[6]) << 16) | (uint32_t(m[7]) << 24);
        }
        bool any = false;
        uint32_t highest = 0;
        for (uint32_t k = 0; k < QUARTERS; ++k) {
            Header h;
            char key[4];
            key_for(k, key);
            size_t blen = sizeof(r.blob);
            if (nvs_get_blob(r.nvs, key, r.blob, &blen) != ESP_OK || !decode_header(r.blob, blen, h)) continue;
            if (!any || h.qseq > highest) highest = h.qseq;
            any = true;
            if (!(h.flags & Q_LIVE) && (!r.any_drained || h.qseq > r.drained)) r.pending.set(h.qseq);
        }
        r.col.next_qseq = any ? highest + 1 : 0;
    }
    set_state(r.nvs_open ? armed : (armed == LogState::ARMED ? LogState::OFF_NVS_ERROR : armed));
    ESP_LOGW("gap_log", "boot %u: %s, next quarter %lu, nvs %lu bytes, %lu of %lu entries free", unsigned(boot_count),
             gap_log::state_text(r.state), (unsigned long) r.col.next_qseq,
             (unsigned long) (part ? part->size : 0), (unsigned long) free_e, (unsigned long) total_e);
}

// Writes the open quarter (closed by collect() or by the shutdown) and starts the next sequence number.
inline void write_open() {
    Runtime& r = rt();
    const size_t n = encode(r.col.q, r.blob, sizeof(r.blob));
    char key[4];
    key_for(r.col.q.qseq, key);
    const int64_t t0 = esp_timer_get_time();
    bool ok = n > 0 && nvs_set_blob(r.nvs, key, r.blob, n) == ESP_OK;
    ok = ok && nvs_commit(r.nvs) == ESP_OK;
    const uint32_t us = uint32_t(esp_timer_get_time() - t0);
    if (us > r.write_worst_us) r.write_worst_us = us;
    r.pending.clear(r.col.q.qseq);  // the slot's older quarter is gone
    if (ok && !(r.col.q.flags & Q_LIVE)) r.pending.set(r.col.q.qseq);
    uint32_t free_e = 0, total_e = 0;
    ok = ok && nvs_entries(free_e, total_e);
    start_next(r.col);
    set_state(after_write(r.health, ok, us, free_e, total_e));
}

// Each control pass (1 s), after the relays are set. `recorder_id` is the recorder's connection id (0 = absent): a
// pass counts as live only while the same recorder connection is up, so a reconnect between two passes (a new id)
// clears the quarter's live flag as an absence does (GL-1).
inline void tick(const Stamp& now, uint32_t recorder_id, uint32_t relay_mask, const Climate& snap) {
    Runtime& r = rt();
    const bool connected = recorder_id != 0 && (r.tick_recorder_id == 0 || r.tick_recorder_id == recorder_id);
    r.tick_recorder_id = recorder_id;
    if (r.state != LogState::ARMED) return;
    const Close why = collect(r.col, now, connected, relay_mask, snap);
    if (why == Close::NONE) return;
    write_open();
    if (why != Close::TRANSITIONS_FULL && r.state == LogState::ARMED) collect(r.col, now, connected, relay_mask, snap);
}

// on_shutdown (OTA, the restart service, App.safe_reboot): the open quarter is written as a partial one.
inline void shutdown() {
    Runtime& r = rt();
    if (r.state != LogState::ARMED || !r.col.open) return;
    r.col.q.flags |= Q_PARTIAL;
    write_open();
}

// Every 250 ms: the next replay line to publish, or nullptr. `c.recorder_id` is the caller's; `c.connected` and
// `c.connected_ms` are filled here. A new recorder connection (a new id) is a new session: a pass in progress stops,
// nothing is settled for the old session, and the next pass starts again from its first quarter once the new
// connection has been up 60 s (GL-1).
inline const char* replay_step(uint32_t now_ms, ReplayConditions c, const Stamp& now) {
    Runtime& r = rt();
    if (c.recorder_id != r.recorder_id) {
        if (c.recorder_id != 0) {
            ++r.session;
            r.connected_since_ms = now_ms;
        }
        r.recorder_id = c.recorder_id;
    }
    c.connected = c.recorder_id != 0;
    c.connected_ms = c.connected ? now_ms - r.connected_since_ms : 0;
    if (!r.nvs_open) return nullptr;
    if (r.phase != Phase::IDLE && (!c.connected || r.session != r.pass_session)) {
        r.phase = Phase::IDLE;  // the session broke: the mark stays, the next pass sends the same quarters
        return nullptr;
    }
    if (r.phase == Phase::SETTLE) {
        if (now_ms - r.settle_since_ms < DRAINED_SETTLE_MS) return nullptr;
        if (r.n_sent > 0) {
            // GL-2: only a slot that still holds the quarter sent; a slot a later quarter has overwritten keeps that
            // quarter's bit, and the next pass sends it (its qseq is above the new mark).
            for (uint32_t q = r.first_sent; q <= r.last_sent; ++q) {
                if (slot_holds(q, r.col.next_qseq)) r.pending.clear(q);
            }
            r.drained = r.last_sent;
            r.any_drained = true;
            write_meta();
        }
        r.phase = Phase::IDLE;
        return nullptr;
    }
    if (!replay_may_send(c)) return nullptr;  // paused; the pass resumes where it stopped
    if (r.phase == Phase::IDLE) {
        if (!r.pending.any() || r.col.next_qseq == 0) return nullptr;
        const uint32_t from = replay_from(r.drained, r.any_drained, r.col.next_qseq);
        r.to = r.col.next_qseq - 1;
        uint32_t n = 0;
        for (uint32_t q = from; q <= r.to; ++q) n += r.pending.has(q) ? 1u : 0u;
        if (n == 0) {
            r.pending = Pending{};  // only bits of drained or overwritten quarters were left
            return nullptr;
        }
        r.pass_session = r.session;
        r.cur = from;
        r.n_sent = 0;
        r.phase = Phase::QUARTER;
        return line_begin(r.line, sizeof(r.line), r.col.boot, now.trusted ? now.t - now.off : now.t,
                          now.trusted ? now.t : 0u, n) ? r.line : nullptr;
    }
    Header h;
    for (;;) {
        if (r.phase == Phase::END) {
            r.phase = Phase::SETTLE;
            r.settle_since_ms = now_ms;
            return line_end(r.line, sizeof(r.line), r.col.boot, r.n_sent, r.last_sent) ? r.line : nullptr;
        }
        if (r.phase == Phase::QUARTER) {
            while (r.cur <= r.to && !r.pending.has(r.cur)) ++r.cur;
            if (r.cur > r.to) {
                r.phase = Phase::END;
                continue;
            }
            if (!load(r.cur, h)) {
                ++r.cur;  // unreadable or overwritten: skipped
                continue;
            }
            r.part = 0;
            r.phase = Phase::CLIMATE;
            return line_quarter(r.line, sizeof(r.line), h) ? r.line : nullptr;
        }
        if (!load(r.cur, h)) {  // re-read: a quarter write may have used the buffer since the last line
            r.phase = Phase::QUARTER;
            ++r.cur;
            continue;
        }
        if (r.phase == Phase::CLIMATE) {
            const uint8_t n = line_climate(r.line, sizeof(r.line), h, r.blob, r.part);
            if (n > 0) {
                r.part = uint8_t(r.part + n);
                return r.line;
            }
            r.part = 0;
            r.phase = Phase::TRANSITIONS;
        }
        const uint8_t n = line_transitions(r.line, sizeof(r.line), h, r.blob, r.part);
        if (n > 0) {
            r.part = uint8_t(r.part + n);
            return r.line;
        }
        if (r.n_sent == 0) r.first_sent = r.cur;
        r.last_sent = r.cur;
        ++r.n_sent;
        ++r.cur;
        r.phase = Phase::QUARTER;
    }
}

}  // namespace gap_log_dev
#endif
