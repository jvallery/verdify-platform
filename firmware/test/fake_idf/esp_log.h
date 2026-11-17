#pragma once
// Host fake for test_gap_log.cpp only: prints ESP_LOGW lines.
#include <cstdio>
#define ESP_LOGW(tag, fmt, ...) (std::printf("    [%s] " fmt "\n", tag, ##__VA_ARGS__))
