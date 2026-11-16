#pragma once
// Host fake for test_gap_log.cpp only: a settable clock and a per-write delay.
#include <cstdint>
inline int64_t fake_now_us = 0;
inline int64_t fake_write_us = 2000;
inline int64_t esp_timer_get_time() { return fake_now_us; }
