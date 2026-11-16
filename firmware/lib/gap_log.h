#pragma once
// Package 2.3, gap log v2 (contracts/gap-log.md): store the climate and relay history in NVS, one blob per quarter
// hour, and replay what the host did not see. This file is the pure core: the record format, the open quarter,
// the ring, clockless stamping, the arming and stopping rules, the replay conditions and the replay lines. No I/O,
// no heap; the NVS side is gap_log_esphome.h. Host tests: firmware/test/test_gap_log.cpp.

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace gap_log {

// RULINGS W11: one climate record per minute (format 2). Format 1 is the 5-minute fallback the W9 gates fall back
// to (static DRAM above 114,128 B, or a quarter write over 200 ms); the version byte tells the host which.
#ifndef GAP_LOG_FORMAT
#define GAP_LOG_FORMAT 2
#endif
constexpr uint8_t FORMAT = GAP_LOG_FORMAT;
static_assert(FORMAT == 1 || FORMAT == 2, "gap log format 1 (5-minute) or 2 (1-minute)");
constexpr uint32_t QUARTERS = 96;          // ring size: 24 h
constexpr uint32_t QUARTER_S = 900;
constexpr uint32_t SLOT_S = FORMAT == 2 ? 60 : 300;  // one climate record per slot
constexpr uint8_t MAX_CLIMATE = uint8_t(QUARTER_S / SLOT_S);  // 15 or 3
constexpr uint8_t MAX_TRANSITIONS = 64;
constexpr size_t HEADER_BYTES = 18;
constexpr size_t CLIMATE_BYTES = 20;
constexpr size_t TRANSITION_BYTES = 6;
constexpr size_t MAX_BLOB = HEADER_BYTES + MAX_CLIMATE * CLIMATE_BYTES + MAX_TRANSITIONS * TRANSITION_BYTES;  // 702 (462)
constexpr uint8_t RELAYS = 18;             // contracts/gap-log.md 9.3; appended, never reused
constexpr int16_t NO_VALUE = INT16_MIN;

// Quarter flags (contracts/gap-log.md section 2).
constexpr uint8_t Q_TRUSTED = 0x01, Q_PARTIAL = 0x02, Q_TRUNCATED = 0x04, Q_LIVE = 0x08;
// Climate record flags.
constexpr uint8_t C_TEMP = 0x01, C_HUM = 0x02, C_OUT = 0x04, C_COOLING = 0x08, C_DRYING = 0x10, C_HOT = 0x20,
                  C_COLD = 0x40;

// Arming and stopping (RULINGS W9b).
constexpr uint32_t ARM_MIN_NVS_BYTES = 400u * 1024u;
constexpr uint32_t ARM_MIN_FREE_PCT = 25;
constexpr uint32_t STOP_FREE_PCT = 15;
constexpr uint32_t SLOW_WRITE_US = 200000u;
constexpr uint8_t SLOW_WRITES_TO_STOP = 3;
// Replay conditions (section 6).
constexpr uint32_t REPLAY_SESSION_MS = 60000u;
constexpr uint32_t REPLAY_MIN_FREE_BYTES = 20u * 1024u;
constexpr uint32_t REPLAY_MIN_MINUTE_LOW_BYTES = 24u * 1024u;
constexpr uint32_t REPLAY_LINE_MS = 250u;
constexpr uint32_t DRAINED_SETTLE_MS = 60000u;
constexpr size_t REPLAY_LINE_MAX = 240;
constexpr uint8_t TRANSITIONS_PER_LINE = 12;
constexpr uint8_t CLIMATE_PER_LINE = 5;  // one 5-minute part (W11)

struct Climate {
    uint16_t dt = 0;
    uint8_t flags = 0;
    uint8_t mode = 0;
    int16_t tin = NO_VALUE, tdp = NO_VALUE, tout = NO_VALUE;  // 0.1 F
    uint32_t relays = 0;
    uint32_t water = 0;  // 0.1 gal since boot
    uint16_t seq = 0;
};

struct Transition {
    uint16_t dt = 0;
    uint8_t relay = 0;
    uint8_t state = 0;
    uint16_t seq = 0;
};

struct Header {
    uint8_t ver = FORMAT;
    uint8_t flags = 0;
    uint16_t boot = 0;
    uint32_t qseq = 0;
    uint32_t t0 = 0;
    uint32_t off = 0;
    uint8_t n_clim = 0;
    uint8_t n_tr = 0;
};

// The open quarter. The replay never decodes a whole quarter: it reads records from the stored blob one line at a
// time (climate_at, transition_at), so the only quarter-sized buffers are this one and the blob buffer.
struct Quarter : Header {
    Climate clim[MAX_CLIMATE];
    Transition tr[MAX_TRANSITIONS];
};

// 0.1 F, rounded; NO_VALUE for a missing or out-of-range reading.
inline int16_t tenths(float f) {
    if (!(f == f) || f > 3000.0f || f < -3000.0f) return NO_VALUE;
    const float x = f * 10.0f;
    return int16_t(x >= 0.0f ? x + 0.5f : x - 0.5f);
}

// ---- encoding (little-endian, field by field) ----
namespace detail {
inline void put8(uint8_t*& p, uint8_t v) { *p++ = v; }
inline void put16(uint8_t*& p, uint16_t v) { put8(p, uint8_t(v)); put8(p, uint8_t(v >> 8)); }
inline void put32(uint8_t*& p, uint32_t v) { put16(p, uint16_t(v)); put16(p, uint16_t(v >> 16)); }
inline uint8_t get8(const uint8_t*& p) { return *p++; }
inline uint16_t get16(const uint8_t*& p) { const uint16_t lo = get8(p); return uint16_t(lo | (uint16_t(get8(p)) << 8)); }
inline uint32_t get32(const uint8_t*& p) { const uint32_t lo = get16(p); return lo | (uint32_t(get16(p)) << 16); }
}  // namespace detail

inline size_t blob_size(const Header& q) {
    return HEADER_BYTES + q.n_clim * CLIMATE_BYTES + q.n_tr * TRANSITION_BYTES;
}

// Returns the bytes written, 0 when `cap` is too small or the counts are out of range.
inline size_t encode(const Quarter& q, uint8_t* buf, size_t cap) {
    using namespace detail;
    if (q.n_clim > MAX_CLIMATE || q.n_tr > MAX_TRANSITIONS || cap < blob_size(q)) return 0;
    uint8_t* p = buf;
    put8(p, q.ver); put8(p, q.flags); put16(p, q.boot); put32(p, q.qseq); put32(p, q.t0); put32(p, q.off);
    put8(p, q.n_clim); put8(p, q.n_tr);
    for (uint8_t i = 0; i < q.n_clim; ++i) {
        const Climate& c = q.clim[i];
        put16(p, c.dt); put8(p, c.flags); put8(p, c.mode); put16(p, uint16_t(c.tin)); put16(p, uint16_t(c.tdp));
        put16(p, uint16_t(c.tout)); put32(p, c.relays); put32(p, c.water); put16(p, c.seq);
    }
    for (uint8_t i = 0; i < q.n_tr; ++i) {
        const Transition& t = q.tr[i];
        put16(p, t.dt); put8(p, t.relay); put8(p, t.state); put16(p, t.seq);
    }
    return size_t(p - buf);
}

// Header only (the ring scan at boot reads nothing more). False on a short blob or an unknown version.
inline bool decode_header(const uint8_t* buf, size_t len, Header& q) {
    using namespace detail;
    if (len < HEADER_BYTES) return false;
    const uint8_t* p = buf;
    q.ver = get8(p);
    if (q.ver != 1 && q.ver != 2) return false;
    q.flags = get8(p); q.boot = get16(p); q.qseq = get32(p); q.t0 = get32(p); q.off = get32(p);
    q.n_clim = get8(p); q.n_tr = get8(p);
    return q.n_clim <= (q.ver == 2 ? 15 : 3) && q.n_clim <= MAX_CLIMATE && q.n_tr <= MAX_TRANSITIONS &&
           len >= blob_size(q);
}

// Record i of a blob whose header decode_header() accepted.
inline Climate climate_at(const uint8_t* blob, uint8_t i) {
    using namespace detail;
    const uint8_t* p = blob + HEADER_BYTES + size_t(i) * CLIMATE_BYTES;
    Climate c;
    c.dt = get16(p); c.flags = get8(p); c.mode = get8(p); c.tin = int16_t(get16(p)); c.tdp = int16_t(get16(p));
    c.tout = int16_t(get16(p)); c.relays = get32(p); c.water = get32(p); c.seq = get16(p);
    return c;
}

inline Transition transition_at(const uint8_t* blob, const Header& h, uint8_t i) {
    using namespace detail;
    const uint8_t* p = blob + HEADER_BYTES + size_t(h.n_clim) * CLIMATE_BYTES + size_t(i) * TRANSITION_BYTES;
    Transition t;
    t.dt = get16(p); t.relay = get8(p); t.state = get8(p); t.seq = get16(p);
    return t;
}

inline bool decode(const uint8_t* buf, size_t len, Quarter& q) {
    if (!decode_header(buf, len, q)) return false;
    for (uint8_t i = 0; i < q.n_clim; ++i) q.clim[i] = climate_at(buf, i);
    for (uint8_t i = 0; i < q.n_tr; ++i) q.tr[i] = transition_at(buf, q, i);
    return true;
}

inline void key_for(uint32_t qseq, char out[4]) {
    const unsigned k = unsigned(qseq % QUARTERS);
    out[0] = 'q'; out[1] = char('0' + k / 10); out[2] = char('0' + k % 10); out[3] = '\0';
}

// ---- time: one basis per quarter ----
struct Stamp {
    bool trusted = false;
    uint32_t t = 0;    // epoch seconds when trusted, else uptime seconds
    uint32_t off = 0;  // epoch - uptime when trusted, else 0
};

inline Stamp stamp(bool clock_trusted, uint32_t epoch_s, uint32_t uptime_s) {
    Stamp s;
    s.trusted = clock_trusted && epoch_s > uptime_s;
    s.t = s.trusted ? epoch_s : uptime_s;
    s.off = s.trusted ? epoch_s - uptime_s : 0;
    return s;
}

// ---- the open quarter ----
// The control pass calls collect() once a second with the relay mask and a climate snapshot; it says when the open
// quarter must be written (then the caller encodes `q`, writes it and calls start_next()).
struct Collector {
    Quarter q;
    bool open = false;
    bool have_mask = false;
    uint32_t last_mask = 0;
    uint16_t clim_seq = 0;
    uint16_t tr_seq = 0;
    uint32_t next_qseq = 0;
    uint16_t boot = 0;
};

enum class Close : uint8_t { NONE = 0, FULL_QUARTER, BASIS_CHANGE, TRANSITIONS_FULL, SHUTDOWN };

inline void open_quarter(Collector& c, const Stamp& s, bool connected) {
    c.q = Quarter{};
    c.q.boot = c.boot;
    c.q.qseq = c.next_qseq;
    c.q.t0 = s.t;
    c.q.off = s.off;
    c.q.flags = uint8_t((s.trusted ? Q_TRUSTED : 0) | (connected ? Q_LIVE : 0));
    c.open = true;
}

// The quarter that close() returned was written (or dropped): the next one gets the next sequence number.
inline void start_next(Collector& c) {
    c.open = false;
    c.next_qseq += 1;
}

// One control pass. `snap` is the climate record to take if a slot is due (its dt, seq and relays are filled
// here). Returns why the open quarter must be written now, before this pass's data, or NONE.
inline Close collect(Collector& c, const Stamp& s, bool connected, uint32_t relay_mask, const Climate& snap) {
    if (c.open) {
        if (s.trusted != bool(c.q.flags & Q_TRUSTED) || s.t < c.q.t0) {
            c.q.flags |= Q_PARTIAL;
            return Close::BASIS_CHANGE;
        }
        if (s.t - c.q.t0 >= QUARTER_S) return Close::FULL_QUARTER;
    }
    if (!c.open) open_quarter(c, s, connected);
    if (!connected) c.q.flags &= uint8_t(~Q_LIVE);
    if (s.off != 0) c.q.off = s.off;
    const uint32_t dt = s.t - c.q.t0;
    // transitions since the previous pass
    const uint32_t changed = c.have_mask ? (relay_mask ^ c.last_mask) : 0u;
    for (uint8_t r = 0; r < RELAYS && changed; ++r) {
        if (!(changed & (1u << r))) continue;
        if (c.q.n_tr >= MAX_TRANSITIONS) {
            c.q.flags |= Q_TRUNCATED;  // 64 transitions in one second: the rest of this second is dropped
            break;
        }
        Transition& t = c.q.tr[c.q.n_tr++];
        t.dt = uint16_t(dt);
        t.relay = r;
        t.state = (relay_mask >> r) & 1u;
        t.seq = c.tr_seq++;
    }
    c.last_mask = relay_mask;
    c.have_mask = true;
    // climate slot
    if (c.q.n_clim < MAX_CLIMATE && dt >= uint32_t(c.q.n_clim) * SLOT_S) {
        Climate& rec = c.q.clim[c.q.n_clim++];
        rec = snap;
        rec.dt = uint16_t(dt);
        rec.relays = relay_mask;
        rec.seq = c.clim_seq++;
    }
    if (c.q.n_tr >= MAX_TRANSITIONS) {
        c.q.flags |= Q_PARTIAL;
        return Close::TRANSITIONS_FULL;  // written now; the next pass opens a new quarter
    }
    return Close::NONE;
}

// ---- arming and stopping (RULINGS W9b) ----
enum class LogState : uint8_t { NOT_ARMED_YET = 0, ARMED, OFF_NVS_SMALL, OFF_NVS_FULL, OFF_NVS_SLOW, OFF_NVS_ERROR };

inline const char* state_text(LogState s) {
    switch (s) {
        case LogState::ARMED: return "armed";
        case LogState::OFF_NVS_SMALL: return "off: nvs_small";
        case LogState::OFF_NVS_FULL: return "off: nvs_full";
        case LogState::OFF_NVS_SLOW: return "off: nvs_slow";
        case LogState::OFF_NVS_ERROR: return "off: nvs_error";
        default: return "off: not_armed_yet";
    }
}

inline bool free_at_least(uint32_t free_entries, uint32_t total_entries, uint32_t pct) {
    return total_entries > 0 && uint64_t(free_entries) * 100u >= uint64_t(total_entries) * pct;
}

inline LogState arm_state(uint32_t nvs_bytes, uint32_t free_entries, uint32_t total_entries, bool stats_ok) {
    if (!stats_ok) return LogState::OFF_NVS_ERROR;
    if (nvs_bytes < ARM_MIN_NVS_BYTES) return LogState::OFF_NVS_SMALL;
    if (!free_at_least(free_entries, total_entries, ARM_MIN_FREE_PCT)) return LogState::OFF_NVS_FULL;
    return LogState::ARMED;
}

struct WriteHealth {
    uint8_t slow_in_row = 0;
};

// After each quarter write: the state the log is in now.
inline LogState after_write(WriteHealth& h, bool ok, uint32_t write_us, uint32_t free_entries, uint32_t total_entries) {
    if (!ok) return LogState::OFF_NVS_ERROR;
    h.slow_in_row = write_us > SLOW_WRITE_US ? uint8_t(h.slow_in_row + 1) : 0;
    if (h.slow_in_row >= SLOW_WRITES_TO_STOP) return LogState::OFF_NVS_SLOW;
    if (!free_at_least(free_entries, total_entries, STOP_FREE_PCT)) return LogState::OFF_NVS_FULL;
    return LogState::ARMED;
}

// ---- replay ----
struct ReplayConditions {
    bool connected = false;
    uint32_t connected_ms = 0;      // how long the API has had a client without a break
    uint32_t api_pending_bytes = 0;
    uint32_t api_overflow_bytes = 0;
    uint32_t api_syncing = 0;       // clients in their initial state sync
    uint32_t free_bytes = 0;
    uint32_t minute_low_bytes = 0;  // the last published per-minute low
};

inline bool replay_may_send(const ReplayConditions& c) {
    return c.connected && c.connected_ms >= REPLAY_SESSION_MS && c.api_pending_bytes == 0 &&
           c.api_overflow_bytes == 0 && c.api_syncing == 0 && c.free_bytes >= REPLAY_MIN_FREE_BYTES &&
           c.minute_low_bytes >= REPLAY_MIN_MINUTE_LOW_BYTES;
}

// Which quarters still need a replay: a bit per ring slot, set when a quarter that was not live is written (or found
// at boot above the drained mark), cleared when the drained mark passes it.
struct Pending {
    uint32_t bits[3] = {0, 0, 0};
    void set(uint32_t qseq) { const uint32_t k = qseq % QUARTERS; bits[k / 32] |= 1u << (k % 32); }
    void clear(uint32_t qseq) { const uint32_t k = qseq % QUARTERS; bits[k / 32] &= ~(1u << (k % 32)); }
    bool has(uint32_t qseq) const { const uint32_t k = qseq % QUARTERS; return bits[k / 32] & (1u << (k % 32)); }
    bool any() const { return bits[0] | bits[1] | bits[2]; }
};

// The oldest qseq still in the ring when the next to be written is `next_qseq`.
inline uint32_t ring_first(uint32_t next_qseq) { return next_qseq > QUARTERS ? next_qseq - QUARTERS : 0; }

// The first quarter a pass sends: after the drained mark and still in the ring.
inline uint32_t replay_from(uint32_t drained, bool any_drained, uint32_t next_qseq) {
    const uint32_t after = any_drained ? drained + 1 : 0;
    const uint32_t first = ring_first(next_qseq);
    return after > first ? after : first;
}

// ---- replay lines (contracts/gap-log.md 9.2); each returns false when the line would not fit ----
inline bool line_begin(char* out, size_t cap, uint16_t boot, uint32_t uptime_s, uint32_t epoch_s, uint32_t n) {
    const int w = snprintf(out, cap, "G1 B %u %lu %lu %lu", unsigned(boot), (unsigned long) uptime_s,
                           (unsigned long) epoch_s, (unsigned long) n);
    return w > 0 && size_t(w) < cap && size_t(w) <= REPLAY_LINE_MAX;
}

inline bool line_quarter(char* out, size_t cap, const Header& q) {
    const int w = snprintf(out, cap, "G1 Q %u %lu %u %u %lu %lu %u %u", unsigned(q.boot), (unsigned long) q.qseq,
                           unsigned(q.ver), unsigned(q.flags), (unsigned long) q.t0, (unsigned long) q.off,
                           unsigned(q.n_clim), unsigned(q.n_tr));
    return w > 0 && size_t(w) < cap && size_t(w) <= REPLAY_LINE_MAX;
}

// Climate records [first, first + 5) of the stored quarter (header q, encoded blob), one 5-minute part; fewer when the next record would take the line
// past REPLAY_LINE_MAX. Returns the count put on the line (0 when none are left or one record alone does not fit).
inline uint8_t line_climate(char* out, size_t cap, const Header& q, const uint8_t* blob, uint8_t first) {
    if (first >= q.n_clim || cap <= REPLAY_LINE_MAX) return 0;
    int w = snprintf(out, cap, "G1 C %lu", (unsigned long) q.qseq);
    if (w <= 0) return 0;
    size_t n = size_t(w);
    uint8_t put = 0;
    for (uint8_t i = first; i < q.n_clim && put < CLIMATE_PER_LINE; ++i) {
        const Climate c = climate_at(blob, i);
        char rec[80];
        const int r = snprintf(rec, sizeof(rec), " c=%u,%u,%u,%d,%d,%d,%lu,%lu,%u", unsigned(c.dt), unsigned(c.flags),
                               unsigned(c.mode), int(c.tin), int(c.tdp), int(c.tout), (unsigned long) c.relays,
                               (unsigned long) c.water, unsigned(c.seq));
        if (r <= 0 || n + size_t(r) > REPLAY_LINE_MAX) break;
        memcpy(out + n, rec, size_t(r) + 1);
        n += size_t(r);
        ++put;
    }
    return put;
}

// Transitions [first, first + 12) of quarter q; fewer when the next one would take the line past REPLAY_LINE_MAX.
// Returns the count put on the line (0 when none are left).
inline uint8_t line_transitions(char* out, size_t cap, const Header& q, const uint8_t* blob, uint8_t first) {
    if (first >= q.n_tr || cap <= REPLAY_LINE_MAX) return 0;
    int w = snprintf(out, cap, "G1 T %lu", (unsigned long) q.qseq);
    if (w <= 0) return 0;
    size_t n = size_t(w);
    uint8_t put = 0;
    for (uint8_t i = first; i < q.n_tr && put < TRANSITIONS_PER_LINE; ++i) {
        const Transition t = transition_at(blob, q, i);
        char rec[32];
        const int r = snprintf(rec, sizeof(rec), " %u,%u,%u,%u", unsigned(t.dt), unsigned(t.relay), unsigned(t.state),
                               unsigned(t.seq));
        if (r <= 0 || n + size_t(r) > REPLAY_LINE_MAX) break;
        memcpy(out + n, rec, size_t(r) + 1);
        n += size_t(r);
        ++put;
    }
    return put;
}

inline bool line_end(char* out, size_t cap, uint16_t boot, uint32_t n, uint32_t last_qseq) {
    const int w = snprintf(out, cap, "G1 E %u %lu %lu", unsigned(boot), (unsigned long) n, (unsigned long) last_qseq);
    return w > 0 && size_t(w) < cap && size_t(w) <= REPLAY_LINE_MAX;
}

}  // namespace gap_log
