#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>

// Recovery release floor (#428): healthy historical firmware held 38-44 KB
// free. Requiring >=32 KB current free and >=16 KB largest contiguous block
// across the settled 48-hour watch leaves meaningful headroom above the 3-8 KB
// chronic-failure floor without treating the boot allocation watermark as a
// steady-state sample. A 250 ms loop high-water is one quarter of the 1 s
// control cadence and twenty times below the 5 s Task-WDT timeout.
constexpr float GH_PRE_OTA_MIN_FREE_HEAP_KB = 32.0f;
constexpr float GH_PRE_OTA_MIN_LARGEST_BLOCK_KB = 16.0f;
constexpr uint32_t GH_CONTROL_LOOP_WARN_US = 250000u;

inline uint32_t gh_control_loop_last_us_value = 0;
inline uint32_t gh_control_loop_max_us_value = 0;
inline uint32_t gh_control_loop_overrun_count_value = 0;

// Package 2.4 health readings (contracts/controller-hardware-budget.md section 5b): each 60 s sensor takes, that is
// reads and resets, its own one-minute window, independent of the 15-minute heap_profile log's window.
struct GhMinuteLow {
    uint32_t value = UINT32_MAX;
    void note(uint32_t sample) {
        if (sample < value) value = sample;
    }
    // The window's lowest sample including `now_sample` (taken at publish time, so an empty window still reads
    // a real value), then a new window starts.
    uint32_t take(uint32_t now_sample) {
        note(now_sample);
        const uint32_t v = value;
        value = UINT32_MAX;
        return v;
    }
};

inline GhMinuteLow gh_heap_free_minute_low;
inline GhMinuteLow gh_heap_block_minute_low;
inline uint32_t gh_control_loop_minute_max_us_value = 0;

inline void gh_record_control_loop_duration_us(uint32_t duration_us) {
    gh_control_loop_last_us_value = duration_us;
    if (duration_us > gh_control_loop_max_us_value) gh_control_loop_max_us_value = duration_us;
    if (duration_us > gh_control_loop_minute_max_us_value) gh_control_loop_minute_max_us_value = duration_us;
    if (duration_us > GH_CONTROL_LOOP_WARN_US) gh_control_loop_overrun_count_value++;
}

inline uint32_t gh_take_control_loop_minute_max_us() {
    const uint32_t value = gh_control_loop_minute_max_us_value;
    gh_control_loop_minute_max_us_value = 0;
    return value;
}

inline uint32_t gh_control_loop_last_us() { return gh_control_loop_last_us_value; }

inline uint32_t gh_take_control_loop_max_us() {
    const uint32_t value = gh_control_loop_max_us_value;
    gh_control_loop_max_us_value = 0;
    return value;
}

inline uint32_t gh_take_control_loop_overrun_count() {
    const uint32_t value = gh_control_loop_overrun_count_value;
    gh_control_loop_overrun_count_value = 0;
    return value;
}

// RULINGS AF9(b): WiFi drops since boot, counted by wifi on_disconnect. RAM only: the restart count and the uptime
// reset tell a reader where a boot starts.
inline uint32_t gh_wifi_disconnect_count_value = 0;
inline void gh_note_wifi_disconnect() { gh_wifi_disconnect_count_value++; }
inline uint32_t gh_wifi_disconnect_count() { return gh_wifi_disconnect_count_value; }

inline bool gh_pre_ota_heap_floor_met(float free_kb, float largest_block_kb) {
    return free_kb >= GH_PRE_OTA_MIN_FREE_HEAP_KB
        && largest_block_kb >= GH_PRE_OTA_MIN_LARGEST_BLOCK_KB;
}

#ifdef ESP_PLATFORM
#include "esp_heap_caps.h"
#include "esp_system.h"
#include "esp_flash.h"
#include "esp_partition.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstdio>

// RULINGS AF9(b): the fewest bytes of stack the calling task has ever had free (ESP-IDF counts StackType_t in
// bytes). Called from a sensor update, which runs on ESPHome's loop task, the task that runs the control pass.
inline float gh_loop_stack_high_water_bytes() {
    return float(uxTaskGetStackHighWaterMark(nullptr));
}

inline float gh_free_heap_kb() {
    return esp_get_free_heap_size() / 1024.0f;
}

inline float gh_min_free_heap_kb() {
    return esp_get_minimum_free_heap_size() / 1024.0f;
}

inline float gh_largest_free_heap_block_kb() {
    return heap_caps_get_largest_free_block(MALLOC_CAP_8BIT) / 1024.0f;
}

// Once per control pass (1 s): the per-minute lows. A dip shorter than a pass (inside an API burst) is missed
// here; the since-boot minimum (esp_get_minimum_free_heap_size) still records it.
inline void gh_note_heap_sample() {
    gh_heap_free_minute_low.note(esp_get_free_heap_size());
    gh_heap_block_minute_low.note(heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
}

inline float gh_take_heap_free_minute_low_kb() {
    return gh_heap_free_minute_low.take(esp_get_free_heap_size()) / 1024.0f;
}

inline float gh_take_heap_block_minute_low_kb() {
    return gh_heap_block_minute_low.take(heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)) / 1024.0f;
}

// NVS entries (32 B each) in use and free, from the default partition; NAN when the call fails.
inline float gh_nvs_entries(bool used) {
    nvs_stats_t st = {};
    if (nvs_get_stats(NULL, &st) != ESP_OK) return NAN;
    return float(used ? st.used_entries : st.free_entries);
}
// RULINGS W1/W2: the device's own partition table (OTA never rewrites it), NVS use and the flash chip, for the
// flash-backed buffer's design. Read-only, static buffers, no heap; a failed call reports its error code.
inline void gh_flash_profile(const char** parts_line, const char** nvs_line) {
    static char parts[384];
    static char nvs[160];
    size_t n = 0;
    parts[0] = '\0';
    esp_partition_iterator_t it = esp_partition_find(ESP_PARTITION_TYPE_ANY, ESP_PARTITION_SUBTYPE_ANY, NULL);
    while (it != NULL) {
        const esp_partition_t* p = esp_partition_get(it);
        const int w = snprintf(parts + n, sizeof(parts) - n, "%s%s@0x%lx+0x%lx", n ? "," : "", p->label,
                               (unsigned long) p->address, (unsigned long) p->size);
        if (w < 0 || size_t(w) >= sizeof(parts) - n) break;  // full: stop, release below
        n += size_t(w);
        it = esp_partition_next(it);
    }
    if (it != NULL) esp_partition_iterator_release(it);
    nvs_stats_t st = {};
    const esp_err_t nvs_err = nvs_get_stats(NULL, &st);
    uint32_t id = 0, bytes = 0;
    const esp_err_t id_err = esp_flash_read_id(NULL, &id);
    const esp_err_t size_err = esp_flash_get_size(NULL, &bytes);
    snprintf(nvs, sizeof(nvs),
             "nvs_used=%u nvs_free=%u nvs_total=%u nvs_ns=%u nvs_err=0x%x flash_id=0x%06lx id_err=0x%x "
             "flash_bytes=%lu size_err=0x%x",
             unsigned(st.used_entries), unsigned(st.free_entries), unsigned(st.total_entries),
             unsigned(st.namespace_count), unsigned(nvs_err), (unsigned long) id, unsigned(id_err),
             (unsigned long) bytes, unsigned(size_err));
    *parts_line = parts;
    *nvs_line = nvs;
}
#else
inline void gh_flash_profile(const char** parts_line, const char** nvs_line) {
    *parts_line = "native";
    *nvs_line = "native";
}
inline float gh_free_heap_kb() { return 0.0f; }
inline float gh_min_free_heap_kb() { return 0.0f; }
inline float gh_largest_free_heap_block_kb() { return 0.0f; }
inline void gh_note_heap_sample() {}
inline float gh_take_heap_free_minute_low_kb() { return 0.0f; }
inline float gh_take_heap_block_minute_low_kb() { return 0.0f; }
inline float gh_nvs_entries(bool) { return 0.0f; }
inline float gh_loop_stack_high_water_bytes() { return 0.0f; }
#endif
