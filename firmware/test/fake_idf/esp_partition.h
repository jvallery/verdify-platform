#pragma once
// Host fake for test_gap_log.cpp only: one nvs data partition of a settable size.
#include <cstddef>
#include <cstdint>
struct esp_partition_t { uint32_t address; uint32_t size; };
enum { ESP_PARTITION_TYPE_DATA = 1, ESP_PARTITION_SUBTYPE_DATA_NVS = 2 };
inline esp_partition_t fake_nvs_partition = {0x9000, 436 * 1024};
inline const esp_partition_t* esp_partition_find_first(int, int, const char*) { return &fake_nvs_partition; }
