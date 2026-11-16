#pragma once
// Host fake for test_gap_log.cpp only: an in-memory NVS namespace with entry accounting and fault injection.
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <vector>
#include "esp_timer.h"
typedef int esp_err_t;
typedef uint32_t nvs_handle_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NVS_NOT_FOUND 0x1102
enum nvs_open_mode_t { NVS_READONLY, NVS_READWRITE };
struct nvs_stats_t { size_t used_entries, free_entries, available_entries, total_entries, namespace_count; };
inline std::map<std::string, std::vector<uint8_t>> fake_nvs;
inline size_t fake_total_entries = 13608;
inline size_t fake_other_used = 1725;
inline bool fake_fail_writes = false;
inline int fake_writes = 0;
inline esp_err_t nvs_open(const char*, nvs_open_mode_t, nvs_handle_t* h) { *h = 1; return ESP_OK; }
inline esp_err_t nvs_get_blob(nvs_handle_t, const char* key, void* out, size_t* len) {
    auto it = fake_nvs.find(key);
    if (it == fake_nvs.end()) return ESP_ERR_NVS_NOT_FOUND;
    if (*len < it->second.size()) return ESP_FAIL;
    std::memcpy(out, it->second.data(), it->second.size());
    *len = it->second.size();
    return ESP_OK;
}
inline esp_err_t nvs_set_blob(nvs_handle_t, const char* key, const void* v, size_t len) {
    if (fake_fail_writes) return ESP_FAIL;
    fake_now_us += fake_write_us;
    ++fake_writes;
    fake_nvs[key] = std::vector<uint8_t>((const uint8_t*) v, (const uint8_t*) v + len);
    return ESP_OK;
}
inline esp_err_t nvs_commit(nvs_handle_t) { return ESP_OK; }
inline esp_err_t nvs_get_stats(const char*, nvs_stats_t* st) {
    size_t used = fake_other_used;
    for (auto& kv : fake_nvs) used += 2 + (kv.second.size() + 31) / 32;
    st->used_entries = used;
    st->total_entries = fake_total_entries;
    st->free_entries = used > fake_total_entries ? 0 : fake_total_entries - used;
    st->available_entries = st->free_entries;
    st->namespace_count = 2;
    return ESP_OK;
}
