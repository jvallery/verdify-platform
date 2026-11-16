#pragma once
/*
 * climate_law_payload.h: the JSON payloads the law build publishes (contract phase3-entities: climate_law_state,
 * climate_drying_meter, climate_law_constants). Presentation only (buffer sizes, decimal places, no law number), so
 * this file sits outside the literal gate of climate_law.h.
 */

#include <cmath>
#include <cstddef>
#include <cstdio>

#include "climate_law.h"

namespace climate_law {

namespace detail {
inline int put_num(char* p, size_t n, double v, int decimals) noexcept {
    if (!std::isfinite(v)) return std::snprintf(p, n, "null");
    return std::snprintf(p, n, "%.*f", decimals, v);
}
}  // namespace detail

// `climate_law_state`. Returns the length written (the record is at most 200 characters).
inline int format_state_record(char* buf, size_t n, const State& s, const Output& q, double limit, bool band_repaired,
                               const Band& b) noexcept {
    const unsigned dr = unsigned(q.dry_refusal);
    const char* name = dr < sizeof(DRY_REFUSAL_NAMES) / sizeof(DRY_REFUSAL_NAMES[0]) ? DRY_REFUSAL_NAMES[dr] : "none";
    char e[24], lim[16], b0[16], b1[16], b2[16], b3[16];
    detail::put_num(e, sizeof e, q.dry_cost, 3);
    detail::put_num(lim, sizeof lim, limit, 2);
    detail::put_num(b0, sizeof b0, b.low, 1);
    detail::put_num(b1, sizeof b1, b.high, 1);
    detail::put_num(b2, sizeof b2, b.vpd_low, 2);
    detail::put_num(b3, sizeof b3, b.vpd_high, 2);
    return std::snprintf(buf, n, "{\"v\":1,\"l\":%u,\"o\":%u,\"dr\":\"%s\",\"e\":%s,\"lim\":%s,\"br\":%d,\"b\":[%s,%s,%s,%s]}",
                         unsigned(latch_bits(s)), unsigned(request_bits(q)), name, e, lim, band_repaired ? 1 : 0, b0,
                         b1, b2, b3);
}

// `climate_drying_meter`.
inline int format_drying_meter(char* buf, size_t n, const DryingMeter& m) noexcept {
    return std::snprintf(buf, n, "{\"v\":1,\"s\":%u,\"g\":%u,\"wh\":%u,\"rw\":%u}", unsigned(m.s), unsigned(m.g),
                         unsigned(m.wh), unsigned(m.rw));
}

}  // namespace climate_law
