# Package 2.4: controller hardware budget (design note, 2026-11-16; measured values added 2026-11-17; partition table and NVS confirmed 2026-11-18)

The budget note for #1719. The CI gates that keep a build inside it are in `ci/gha/firmware_secretless_compile.py`:
`FIRMWARE_STATIC_DRAM` and `FIRMWARE_IMAGE_SIZE` (at most 85 % of the 1,835,008 B OTA slot).

Every number below is labelled:
- **[F]** a fact read from a named source;
- **[D]** an ESP-IDF or ESPHome default, not printed by our build, so to confirm;
- **[E]** an estimate.

Sources:
- the CI compile logs of the running build (run 42321694716, job 128247867601, commit 9517acb6) and of phase 2 (#1703 on ccbc2702, the greenhouse compile job of run 43918397252; identical to a7626f27);
- production `diagnostics` and `esp32_logs`, through bounded read-only queries. The controller's `heap_profile` warning line, logged every 15 minutes, carries free, since-boot low-water, largest block, loop time, reset reason and the API buffer state.

## Recommendation

**Static RAM.** The firmware sits well inside the chip's static and flash limits:
- DRAM is 63% used [F];
- the app image fills 60% of its OTA slot [F];
- NVS wear is beyond any concern, centuries at the measured write rate [E, arithmetic in section 4].

**Heap is the one tight resource, and only at a reconnect.**
- Free heap is about 70 KB in steady state, but a host reconnect takes about 60 KB for a moment.
- The since-boot low-water mark is 8.5 KB on the running build, and October builds went down to 1.4 KB without a reset [F].
- The cause is the per-connection burst of entity information and states, and it scales with the entity count (536 entities [F]).

**The gap log (about 14 KB) does not fit today.**
- It fits only after the 4.3 deletions remove about a third of the entities [E].
- So it ships in the third flash, as RULINGS Q3 assumes, and only if that build shows static DRAM at or below phase 2's 114,128 B and a per-minute lowest free heap of at least 16 KB through reconnects.
- If it does not, ship a 12-hour horizon (about 7 KB) instead.

**Interim rollback rule (U4).** Confirm it with one addition: roll back on any restart after the OTA restart, not just a reset reason other than a software reset, because the heap guard and the bus watchdog both restart as "Software reset".

## 1. The device's limits

| Item | Value | Source |
|---|---|---|
| Chip, board | ESP32 (original, dual core, 240 MHz), `board: esp32dev`, ESP-IDF 5.5.4, platform 55.3.39 | [F] firmware/greenhouse.yaml; compile log "HARDWARE: ESP32 240MHz, 320KB RAM, 4MB Flash" |
| Module | not named by the firmware (`esp32dev` is generic); a WROOM-32 class module with 4 MB SPI NOR | [F] 4 MB from the log; the module part is [E] |
| Internal SRAM | 520 KB on the die; 320 KB counted by PlatformIO as RAM ("used 114128 bytes from 327680") | [F] log |
| DRAM segment | 180,736 B total; phase 2 uses 114,128 (63.15%): .bss 97,576, .data 16,400; 66,608 B remain | [F] the compile's memory table |
| IRAM | 131,072 B total; 79,035 used (60.3%) | [F] same |
| Heap | ESP-IDF builds the heap from the DRAM left after static data, plus further DRAM regions after start-up reservations. It is split into several non-contiguous regions; WiFi, lwIP and the API allocate from it at run time. `heap_free` counts 8-bit capable memory. | [D] ESP-IDF heap model |
| Why the largest block matters | An allocation needs one contiguous block. The API's batch buffer (measured up to 8 KB), the overflow buffer and an OTA need a block, not a total. The repository's pre-OTA floor is free >= 32 KB and largest >= 16 KB (`lib/heap_diagnostics.h` lines 12-13). | [F] code and logs |
| Flash, partitions | 4 MB. Offsets printed: bootloader 0x1000, partition table 0x8000, ota data 0x9000, app at 0x10000. The app partition is 1,835,008 B = 0x1C0000 ("Flash: used 1109003 bytes from 1835008"). | [F] log |
| NVS | Confirmed on the device: otadata 0x9000/0x2000, phy_init 0xB000/0x1000, app0 0x10000/0x1C0000, app1 0x1D0000/0x1C0000, nvs 0x390000/0x6D000 (446,464 B = 436 KB, 109 pages). `nvs_get_stats`: 13,734 entries in total, 2,179 used (16 %), 11,555 free, 5 namespaces. Flash chip id 0x5E4016, 4,194,304 B. This is ESPHome's generated ESP-IDF 4 MB table, not a 20 KB Arduino table. | [F] the controller's `flash_profile` log lines (`esp32_logs`, every 15 min) on the fifth flash 2026.11.18.0103.edd30c2d, first read 2026-11-18T01:38:15Z |
| OTA slot vs image | image 1,109,259 B of 1,835,008 B (60.4%), 725,749 B headroom; two slots; `enable_ota_rollback: true` | [F] log and config dump |
| Task stacks | loop task 8,192 B (`loop_task_stack_size: 8192`). The API, the UDP listener, Modbus (UART), the interval lambdas and the 1 s control lambda all run in the loop task. lwIP tcpip task 3,072 B, WiFi task about 3.5 KB, event loop 2,304 B. | loop task [F] config dump; the rest [D] |
| Watchdogs | task watchdog 5 s and interrupt watchdog 300 ms. Our guards: the heap guard restarts when free < 20 KB for 3 min (`greenhouse.yaml` around line 680); the heap pressure flag sets below 15 KB; the bus watchdog restarts when no probe answered for 3,600 s. | IDF values [D]; ours [F] |
| Loop time | worst control pass per 15 min: 9.8-24.5 ms over 928 samples since 11-07, 0 overruns | [F] `heap_profile` lines |

## 2. What the firmware uses today

**Static RAM and binary:**

| Build | Image | DRAM | .bss | .data | IRAM | Source |
|---|---|---|---|---|---|---|
| running 2026.11.7.0133.9517acb6 | 1,110,451 B | 114,968 B | 98,432 | 16,384 | 79,035 | [F] job 128247867601 |
| phase 2 (#1703, ccbc2702) | 1,109,259 B | 114,128 B | 97,576 | 16,400 | 79,035 | [F] ccbc2702 compile job |
| recovery image (phase 2) | 1,104,139 B | 114,128 B | | | | [F] a7626f27 recovery job |

Phase 2 is 840 B smaller in static RAM than the running build.

**Entities (phase 2 YAML)** [F, counted from the YAML]:
- 317 sensors (most of them `cfg_*` readbacks), 105 numbers, 50 text sensors, 42 switches, 22 binary sensors: **536 entities**;
- 301 globals, 69 of them `restore_value`.

At about 98 KB of .bss for 536 entities and 301 globals, an entity costs about 150-200 B of static RAM [E]. It also costs heap for its callbacks and scheduler entries, and bytes in every reconnect burst.

**Measured heap** (running build, `heap_profile` since 2026-11-07, 928 samples) [F]:
- free: typical about 70 KB; 1st percentile 61.6 KB; minimum sampled 28.8 KB at 11-13 22:27, inside the 22:09-22:32 gap;
- largest block: as low as 14.5 KB at that same sample;
- API batch buffer: up to 8,192 B;
- the `diagnostics` table, sampled more coarsely, shows a minimum free of 31.6 KB;
- **since-boot low-water: 43.9 KB until 2026-11-07 21:41, then 8.5 KB by 22:11, across the 22:04-22:06 reconnect.** The largest block fell from 68 to 38 KB and the API batch buffer grew from 2 to 5 KB.
- Earlier builds: since-boot low-water 2.3 KB (10-17 to 10-24) and 1.4 KB (10-24 on), with no reset (reset=3, software, the flash). July: chronic 3-8 KB ended in a task watchdog reset (#428).

**What a reconnect costs (about 60 KB for a moment).** Read from the firmware, ESPHome 2026.6.5's API and the logs:
- **(1) The dominant cost [E, strongest candidate]:** a client that connects (the ingestor, or the second peer) gets the entity list and then every state.
  - At about 100-120 B per entity description, 536 entities come to about 55-65 KB.
  - The batch and overflow buffers (patched, `build_api_batch_patch.py`) and lwIP's send queue hold what the socket cannot take yet. WiFi transmit buffers ([D] dynamic, up to 32 at about 1.6 KB) hold frames until the access point acknowledges them.
  - The measured batch-buffer growth (2 to 5-8 KB) and the fragmentation afterwards (largest block 68 to 38 KB) match this.
- (2) The dispatcher's seed and reconcile: 56 + 18 setting writes. Each is a small message plus a preference write, and ESPHome batches flash writes, so this is small.
- (3) Station packet JSON: one parse of about 400 B every 60 s, a few KB transient; rapid_wind is ignored by design.
- (4) Logs: task log buffer 768 B, small.
- (5) OTA: not involved, except two TCP probes a minute on the OTA and API ports from two cluster hosts [F, logs every minute: "Remote closed at read magic", "CONNECTION_CLOSED"]. Each accepted probe builds and frees a connection object; that churns and fragments the heap. Hand it to the monitoring lane: probe less often, or by ICMP.

The since-boot mark cannot show how deep the later reconnects went. The 15-minute samples catch one at 28.8 KB free and 14.5 KB largest (11-13 22:27).

## 3. The budget

| Change | Static RAM | Heap at a reconnect | Source |
|---|---|---|---|
| Phase 2 vs running | -840 B | burst unchanged | [F] |
| Phase 3, the law | target: no new static RAM. The 256, 256 and 224 B control-lambda buffers move to static (+736 B .bss) and come off the stack. Law state is a few hundred bytes. **Budget: +2 KB at most**, stated in the law PR body against 114,128 B (U4). | burst unchanged | [E]; FW-LAW measures it |
| 4.3 deletions (190 dead settings and readbacks of 315) | **-28 to -38 KB** (190 x 150-200 B) | burst falls by about a third with the entity count | [E]; the 4.3 compile measures it |
| 2.3 gap log | +14.0 KB (5,760 + 8,192 B) | none (drained at a bounded rate, about 8 records per message) | [F] layout in the gap log design (#1712) |

Margins we accept:
- **Lowest free heap at a reconnect burst: >= 16 KB, per-minute reading (section 5b).**
  - Why: the repository's pressure flag is 15 KB and the pre-OTA floor is 32 KB free with a 16 KB largest block.
  - July's chronic 3-8 KB ended in a task watchdog reset.
  - Below 16 KB, one more simultaneous transient (an OTA, a second client) can fail an allocation.
  - **Rollback floor 6 KB** (U4) is the emergency line, not the budget.
- **Largest free block: >= 16 KB steady, >= 12 KB during a burst.** Needed for the API batch buffer (8 KB) with margin, and for an OTA, which the pre-OTA floor refuses below 16 KB: a rollback OTA would then need a restart first.
- **Control lambda stack:** loop task 8,192 B. We accept a high-water mark of at least **2,048 B free** (25%).
  - Phase 2 holds about 736 B of local buffers in the lambda, and FW-LAW makes the new ones static.
  - Not measured yet: no high-water reading exists (section 5b).
  - **Measured (RULINGS AR27, 2026-11-17).** The third flash read 1,848 B free (22.6%) on every sample from 02:10
    to 05:20Z: 149 one-minute samples through Home Assistant's `loop_stack_high_water` entity (the monitoring lane). The
    fourth flash (2026.11.17.0609.8c5cd3bf, boot 06:34:24Z) read the same 1,848 B. Both are under the 2,048 B line.
  - **AR27 ruling.** The gap does not block a flash. It carries to #1733, which either frees stack in the loop
    lambda or moves this line.
  - Until then, three thresholds apply:
    - flash acceptance passes at >= 1,536 B free; below that, report to the coordinator before the pin (not an
      automatic rollback);
    - the monitoring lane's `VerdifyControllerLoopStackLow` warns at < 1,024 B for 5 minutes;
    - an overflow is a crash, with no firmware guard.
  - Release 4 stores the reading as `diagnostics.loop_stack_high_water_b`.
- **Binary:** <= 85% of the slot (1,559,756 B); today 60.4%.
- **Static DRAM:** <= 120,000 B (66%); today 114,128 B.

**Does the gap log fit?**
- **Not on phase 2 or the law build.** 14 KB more static RAM takes about 14 KB from every heap figure: typical 70 KB to 56 KB, the sampled burst 28.8 KB to about 15 KB, and the since-boot 8.5 KB burst below zero, which means an allocation failure.
- **At the third flash, with 4.3, yes [E]:** if 4.3 frees about 30 KB of static RAM and a third of the burst, the gap log's 14 KB leaves static RAM below phase 2.
- **Acceptance for that build:**
  - static DRAM <= 114,128 B with the buffer included;
  - per-minute lowest free >= 16 KB across at least three reconnects in 7 days;
  - largest block >= 16 KB steady.
- **If 4.3 frees less than measured:** ship a 12 h horizon (2,880 + 4,096 B, about 7 KB) and say so.

## 4. Flash writes and lifespan

**What is persisted** [F]:
- 69 `restore_value` globals (`globals.yaml`), including the 8 relay counters;
- 42 switches with a restore mode (30 `RESTORE_DEFAULT_OFF`, 12 `RESTORE_DEFAULT_ON`);
- the irrigation engine's claims record (120 B, at most 24 a day, `irrigation_program.h` around line 634) and program record (616 B, on a program change);
- the policy journal (two alternating copies of up to 1,282 B, each written with a forced `sync()`, on each policy commit, `policy_journal_esphome.h` line 51);
- coming in the law: the doubly blind flag and the drying cost limit (FW-LAW lists them).

**How writes happen:**
- ESPHome writes changed preferences once per flash interval. That is 60 s by default [D]; the YAML sets no `preferences:` block [F].
- On ESP32 it skips a blob whose stored bytes are unchanged [D, ESPHome esp32 preferences]. So only real changes write.
- The claims, the program and the policy journal force a `sync()`.
- No flash write runs in a loop [F, read]: the only `sync()` calls are the claims, the program and the journal; the counters are saved hourly (600 s first).

**Measured rate.** `setpoint_changes`, 30 days, confirmed rows: 17,574 (586 a day) across 138 parameters [F]. Rows whose value differs from the parameter's previous value: **10,035, or 335 a day** [F]. The leaders are `vpd_target_west` (55.7 a day), the other three zone VPD targets (38-43), and the mister and fog timings (12-18). Not all of them are persisted, so this is an upper bound.

**Arithmetic** [E; the entry sizes follow ESP-IDF's 32-byte NVS entries]:

| Writer | Entries per day |
|---|---|
| setting changes: 335 x 3 entries (index + header + data for a small blob) | 1,005 |
| relay counters: up to 8 x 24 x 3 | 576 |
| claims: 24 x 6 | 144 |
| policy journal: assume 100 commits a day (upper bound) x 43 | 4,300 |
| **total** | **about 6,000 entries = about 192 KB a day** |

- NVS partition [F] 436 KB = 109 pages; wear levelling rotates writes across all pages. So each page is erased about every 436 / 192 = **2.3 days**.
- SPI NOR rated **100,000** erase cycles [E, typical datasheet for this flash class]. Life is 100,000 x 2.3 days, about **630 years**.
- The 20 KB case (5 pages, about 29 years) is ruled out: the device has the 436 KB partition (section 2, confirmed 2026-11-18). Beyond concern.
- If one writer ever dominates it is the policy journal (43 entries per commit). Bound its commits, not the settings.

**OTA.** Each flash rewrites one slot: about 1.1 MB, about 272 sector erases, spread over that slot's sectors. At one flash a day, 100,000 cycles last about 270 years per sector. No concern.

## 5. Gates, a build list (nothing built yet)

**a. CI size gate.** S, rides train H3 in this repository (the compile job).
- After the ESPHome compile, parse the memory table.
- Fail when the image > 85% of the app slot or DRAM > 120,000 B.
- Print both to the job summary and as a JSON artifact (`firmware-size.json`: image, slot, dram, bss, data, iram, entities, commit) that a metric can scrape (U5).
- The NVS size is settled on the device (section 2, confirmed 2026-11-18); printing `partitions.csv` in CI is no longer needed.

**b. Controller readings, third flash only (U3b).**
- Each new sensor entity costs about 150-200 B static [E] plus bytes in the reconnect burst. Fold them into one diagnostic text or JSON entity of about 120 B where possible: one entity, about 300 B in all [E].

| Reading | How | RAM | Persisted |
|---|---|---|---|
| lowest free heap per minute | sample `heap_caps_get_free_size` each control pass and keep the minimum, reset after publishing; ESP-IDF 5.3+ also has `heap_caps_monitor_local_minimum_free_size_start/stop`, which also catches dips between passes (confirm in 5.5) | 8 B | no |
| largest block per minute (lowest) | same pass | 4 B | no |
| control-task stack high-water | `uxTaskGetStackHighWaterMark(nullptr)` in the lambda, once a minute | 4 B | no |
| worst loop time per minute | from the existing `gh_take_control_loop_max_us`, per minute instead of 15 min | 0 | no |
| NVS writes | count ESPHome flushes plus our `sync()` calls; `nvs_get_stats` used and free entries | 8 B | no (a restart resets it, which is fine with the restart count) |
| restart count | one `restore_value` u32, +1 at boot | 4 B plus 1 preference | **yes** (one write per boot) |
| reset reason | exists (`Reset Reason`) | 0 | no |
| API client count | `api_heap.peers`, exists in logs; publish it | 0 | no |
| Modbus errors per probe | count the timeouts per address; the logs show probes 8 and 9 (soil) timing out every minute | 10 x 2 B | no |
| WiFi disconnects | count on the WiFi disconnect event | 4 B | no |

**c. Host alerts (rows for the monitoring lane's coverage matrix):**
- lowest free per minute < 16 KB: warning; < 10 KB: page;
- largest block < 16 KB for 10 min: warning (OTA refused);
- stack high-water < 2 KB: warning; as built (AR27): < 1,024 B for 5 min, because both measured builds sit at 1,848 B and a 2 KB rule would fire permanently;
- worst loop > 250 ms: warning;
- restart count +1 without a flash: warning, and a page if reset reason is Task WDT, Panic or Brown-out;
- NVS free entries < 10%: warning;
- Modbus errors on one probe > 50% for 30 min: warning;
- WiFi disconnects > 3 per hour: warning;
- the API probes on 6053 and 3232 every ~30 s are a load to reduce, not an alert.

**d. Flash procedure checks, now** (published today: `heap_free`, `heap_min_free`, `heap_largest_free_block`, `uptime`, `reset_reason`, `wifi_signal`):

| Read at B+10, 20, 30, 45, 60 | Roll back when |
|---|---|
| `reset_reason` | not "Software reset" at B+10 (an OTA restarts as a software reset) |
| `uptime` | **any drop after B+10**: a restart after the OTA restart. The heap guard and the bus watchdog restart as "Software reset" too, so the reason alone is not enough. |
| `heap_min_free` (since boot) | < **6 KB** after the post-flash reconnect burst. Confirmed: the running build's mark is 8.5 KB and the phase 2 flash gives the baseline. October builds reached 1.4-2.3 KB without a reset, so 6 KB is a regression line, not a crash line. |
| `heap_largest_free_block` | < 16 KB at B+60: not a rollback by itself, but the rollback OTA would then be refused by the pre-OTA floor; restart first if a rollback follows |
| `heap_free` | < 25 KB at two consecutive reads (the heap guard's own threshold is 20 KB for 3 min) |
| `wifi_signal` | information only (compare with the pre-flash value) |

The phase 2 flash records all six at B+60 as the baseline for the law flash.

## 6. The owner's question: flash write life for a 24-hour buffer kept in flash (RULINGS W1, W2)

The answer, in numbers; the design is the gap log design v2 (#1712).

**Correction to section 4.** The policy journal has had **no delivery attempts in 30 days**
[F, `policy_delivery_attempts`], so its share is 0, not the 100 commits a day assumed above. Today's writers come to
**about 1,725 NVS entries (55 KB) a day** [E from F rates], not 6,000.

| Case (436 KB nvs, 100,000 erase cycles [DS]) | Written a day | Sector erases a day | Each sector erased every | Life |
|---|---|---|---|---|
| today | 55 KB | 14 | 7.8 days | about 2,100 years [E] |
| today + the buffer in flash (v2: one write per quarter hour) | 77 KB | 21 | 5.3 days | **about 1,450 years** [E] |
| today + the buffer as an hour blob rewritten every 5 min | 166 KB | 44 | 2.5 days | about 680 years [E] |
| today + the buffer as one 14 KB `restore_value` global (the design not to build) | 4.3-20 MB | 1,130-5,100 | 2.3 h to 30 min | **about 5-26 years** [E] |

- **On a 20 KB nvs** (an Arduino-framework first flash) the buffer would not fit, and today's writers alone would
  come to about 11 years [E]. Ruled out.
- **Confirmed 2026-11-18: the device has the 436 KB nvs** (nvs@0x390000+0x6d000, 13,734 entries, 2,179 used) [F,
  the controller's `flash_profile` log lines (`esp32_logs`, every 15 min) on the fifth flash 2026.11.18.0103.edd30c2d, first read 2026-11-18T01:38:15Z], so the 436 KB rows above apply.
- **What a write costs the loop:** a quarter-hour program of a few milliseconds every 15 min, and a sector erase
  about every 76 min, 45 ms typical and 400 ms worst [DS]. The worst case can cost one Modbus poll; it never
  touches a relay decision.
- **RAM:** about 1.1 KB static, against 14 KB for the RAM ring. Flash is the right home for the buffer, as the owner
  suggests: RAM is the scarce resource.
