# Firmware Control Specification: the Band-Edge Law and its Relay Layer

**Scope:** what the controller does every second to the six climate relays and the climate mister pulses: its
inputs, the band-edge law, the relay layer, the holds, the manual runs, the states with missing inputs, the gap log,
what it publishes, and the tests that pin it. The design is
[`design/climate-refactor-plan-2026-11-15.md`](design/climate-refactor-plan-2026-11-15.md) (the plan), sections 4.1
to 4.9 and appendix A; the generated constants are in [`climate-law-constants.md`](climate-law-constants.md).
[`CONTROL-ARCHITECTURE.md`](CONTROL-ARCHITECTURE.md) is the system overview and
[`firmware-control-contract.md`](firmware-control-contract.md) is the contract for values and manual runs.

Code is the source of truth; if this document and the code disagree, the code wins: fix this document. Verified
against `firmware/lib/climate_law.h`, `climate_law_glue.h`, `running_alone.h`, `gap_log.h`, `greenhouse_solar.h`,
`greenhouse_logic.h` and `firmware/greenhouse/controls.yaml` of the third climate flash (#1731).

---

## 1. The control loop

- **Cadence: 1 s** (`firmware/greenhouse/controls.yaml`, `interval: 1s`). Timers accrue real elapsed milliseconds,
  so behaviour does not depend on the tick rate. The relay layer and the mister pulse request take the raw, wrap-safe
  elapsed time.
- **One pass**, in order: the occupancy expiry; the indoor and outdoor readings (`running_alone.h`); the band (curve
  or corridor); the indoor gate (boot grace, run, or no indoor temperature); `climate_law::step_checked()` (the band
  check, then the law); the protection clear of the manual latches; the no-indoor table when there is no indoor
  temperature; the fog dew-margin gate; `climate_law::relay_pass()` (the relay layer, then the manual runs and the
  interlocks over the result); the relay drivers; the mister pulse request to the irrigation engine; the relay
  counters and the drying meter; the gap log's collection; the published state.
- **Pure core.** The law, the relay layer, the mister request, the input selection and the gap log's format and rules
  are pure functions over plain structs, with no ESPHome type, no clock and no hour, season or zone branch in the
  law. The same code runs on the ESP32 and in the host tests.

## 2. Layer boundary

The firmware owns real-time relay control for climate, irrigation and lighting, the protection limits and offline
operation. It does not own the band's values (the house anchors in `crop_band_anchors`, stored in flash), crop
identity, or any policy: it is crop-agnostic (`tests/test_firmware_crop_agnostic_guard.py`). The only climate values
it takes from the host are the band anchors, the drying cost limit and the operator switches; every law number is
compiled from `verdify_schemas/climate_law.yaml`.

## 3. Inputs

### 3.1 Indoor reading (`select_indoor_reading()`)

| Source | Temperature | Humidity, VPD, dew point |
|---|---|---|
| Wall probes (north, west, south, east), averaged | the average, if inside -20 to 140 F | from the average; an averaged humidity above 100 % and up to 110 % reads as 100 % (a sensor at saturation); outside 0 to 110 %: no humidity |
| Case sensor, while fresh (the walls invalid) | the case reading less the compiled offset, 1.6 F (`CASE_SENSOR_OFFSET_F`) | from the case probe's own temperature and humidity |
| Neither | none: the state of section 7 | none |

- **Temperature and humidity are valid apart.** A valid temperature is all rules 1 to 4, 8 and 9 need. With no
  valid humidity, fog, misters and drying hold and nothing is substituted.
- **The law's humidity rules run on the wall average only** (`law_humidity_valid()`): on the case sensor alone rules
  5 to 7 hold, at 100 F included; rules 1 to 4, 8 and 9 run.
- **No substituted values.** A missing reading is missing. A plausible but wrong wall probe stays in the average;
  `probe_validity.h` reports a probe that steps more than 6 F between samples (JUMP) or holds an identical reading for
  60 minutes (FLAT) in `probe_health`, as text only.
- Per-zone VPD for the mister zone choice uses `zone_vpd_with_fallback()` (`firmware/lib/zone_vpd.h`): the zone's
  own fresh probe, else the mean of the fresh peer probes, else the house average; the centre always uses the house
  average.

### 3.2 Outdoor reading (`select_outdoor_reading()`)

The weather station's LAN broadcast first, then the wired intake probe on the controller's sensor bus, each with its
own age stamp. A source counts only with a finite temperature and humidity younger than 600 s
(`OUTDOOR_MAX_AGE_S`); a stamp older than that is cleared, so a silent source cannot look fresh after `millis()`
wraps. With neither, there is no outdoor data. The source is published as `station`, `intake` or `none`.

### 3.3 Band

`sv2_temp_low`, `sv2_temp_high`, `sv2_vpd_low`, `sv2_vpd_high`: the on-chip curve of section 10 while the clock is
trusted, else the corridor (section 9.1). The controller's band check (section 4.4) applies on every pass.

### 3.4 Derived inputs

The humidity ratios `w_in` and `w_out` (g/kg) come from the dew points at the compiled site pressure of 85 kPa
(`humidity_ratio_g_per_kg()`), never from an offset temperature and a humidity, so they are right for the wall and
the case reading. The drying cost limit is the stored value clamped to 0 to 1.5, or 0.7 when it cannot be read.

## 4. The law (`climate_law::step()`)

Nine latches (`State`: `h1`, `h2`, `cool`, `cool2`, `wet`, `mist`, `dry`, `air`, `run`), one per rule and condition,
each with an on line and an off line. No modes. The same rules apply at every hour and in every season. `T` is the
indoor temperature, `V` the indoor VPD; the band is `low`, `high`, `vpd_low`, `vpd_high`.

### 4.1 Rules

| Rule | Latch | On | Off |
|---|---|---|---|
| 1 Electric heater | `h1` | `T < low + 3.5` | `T > low + 4.5` |
| 2 Gas furnace | `h2` | `T < low + 0.5` | `T >= low + 3.0` |
| 3 Cooling (vent, lead fan) | `cool` | `T > high` | `T < high - 2.0` |
| 4 Second fan | `cool2` | `T > high + 1.5` | `T < high` |
| 5 Fogger | `wet` | `V > vpd_high` | `V < vpd_high - 0.15` |
| 6 Misters opted in for VPD | `mist` | `V > vpd_high + 0.30` | `V < vpd_high + 0.05` |
| 7 Drying wanted | `dry` | `V < vpd_low + 0.05` | `V > vpd_low + 0.20` |
| 7 Outdoor air drier | `air` | outdoor dew point at least 3 F below indoor | less than 1 F below |
| 7 Drying run | `run` | `dry`, `air` with more than 0.1 g/kg less water outdoors, cost within the limit, `T >= low + 1.5`, not cooling, furnace latch off | any of `dry`, `air` or the moisture difference lost, cooling, the furnace latch, or `T < low + 0.75` |
| 8 Hot limit | | `T >= 100 F` | |
| 9 Cold limit | | `T <= 40 F` | |

### 4.2 Requests

- `cooling` = `cool` or the hot limit; `drying` = `run` and not cooling; `vent` = cooling or drying.
- Fans: 2 while cooling with `cool2` or at the hot limit, 1 while cooling otherwise or drying, else 0. Drying uses the
  lead fan only.
- `fog` = `wet`, the house at or above `low` (the cold-house guard, plan decision 20), not drying, not at the cold
  limit. `mist` likewise from `mist`.
- `heat1` = `h1` and not cooling, or the cold limit. Drying does not stop the electric heater.
- `heat2` = `h2` and the vent not requested, or the cold limit. The furnace never runs with the vent open.
- At the cold limit the vent, the fans, cooling and drying are dropped.
- At the hot limit the fogger keeps following rule 5 and the misters rule 6, so the misters may pulse at 95 F and
  above; the irrigation engine still decides each mister pulse.
- With no valid humidity the `wet`, `mist` and `dry` latches are cleared. With no valid temperature every latch is
  cleared and the law requests nothing (the state of section 7 is the caller's).
- **The law's own fog keeps the 8 F dew-point margin** (`law_fog_dew_margin_ok()`): outside the no-indoor state the
  fog request is dropped while the indoor temperature minus the dew point is under `WET_DEW_MARGIN_F`. The same gated
  request feeds the irrigation engine's climate demand.

### 4.3 The drying cost

`e = 1.006 x max(0, (T - T_out) / 1.8) / (w_in - w_out) / 3.6` kWh of heat per kg of water. The air flow cancels, so
the controller computes it from its own readings every second. When the moisture difference is 0.1 g/kg or less the
cost reads as never within the limit. A run starts only while `e` is within the stored limit; a running run continues
if the outdoor air turns colder, until a stop condition. The state record carries `e`, the limit and, while drying is
wanted and not running, the first refusal that applies: `no_outdoor`, `cooling`, `furnace`, `not_drier`,
`too_cold`, `cost`; or `humidity_invalid`, `no_temperature`.

### 4.4 The band check (`check_band()`, `step_checked()`)

Every pass, before the law: each edge is clamped to 45 to 95 F and 0.3 to 3.0 kPa; a pair narrower than 6.5 F or
0.35 kPa is widened about its middle (which also repairs an inverted band) and moved back inside the limits; a
non-finite edge takes the other edge less or plus the minimum width; a pair with no finite edge takes the limits. The
state record's `br` flag says when the band was repaired. The law has no floor or width of its own, so a corrupted
anchor cannot make two opposing actions latch together.

## 5. The relay layer (`climate_law::relay_step()`, `relay_pass()`)

### 5.1 Minimum times

| Relay | Minimum on | Minimum off |
|---|---|---|
| Electric heater, furnace | 300 s | 300 s |
| Fan 1, fan 2 | 300 s | 300 s |
| Vent | 300 s | 300 s |
| Fogger | 120 s | 120 s |

These are compiled; the relay drivers in `controls.yaml` apply no dwell of their own.

### 5.2 At boot

Every relay is available at once except the furnace, which counts as just switched off at boot and waits one minimum
off time (300 s) after any boot, whatever the reset reason, so a crash loop cannot cycle it. At or below 40 F the
furnace starts at once. No climate relay is switched during the boot grace (section 7.1).

### 5.3 Interlocks

- **A fan only with the vent open.** The vent opens first and the fan follows on the next pass; the vent stays open
  while a fan runs. A manual fan run with the vent closed is the one exception.
- **The furnace and the vent never together.** While the furnace runs, the vent and fans wait for it to finish its
  minimum on time and stop; the furnace waits until the air reads off. The furnace is never cut short for drying or
  cooling, and finishes its minimum on time even when the electric heater stops.
- **The electric heater and the air.** The electric heater does not start into, and is cut at once by, an open vent
  or a running fan, except during the law's own drying and at the 40 F limit. The drying run's own vent and fan
  finishing their minimum on time after the run stops count as drying: the heater keeps running through that tail
  and gets no minimum-off stamp. The mark is cleared when the air is off or something else asks for it (cooling, the
  no-indoor table, a manual run). A start also waits for the physical air to read off. A cut is not a start: it moves
  no relay counter and no switch time.
- **Manual fan runs** stop both heaters, vent open or closed.

### 5.4 When a minimum time is cut short

| Case | What is cut |
|---|---|
| 100 F limit | Both heaters off at once; the vent opens and both fans start in the same pass. No minimum time applies to the heaters, vent and fans; the interlocks do. |
| 40 F limit | The fans stop and the vent closes at once; the electric heater starts in the same pass and the furnace on the next pass once the air reads off, with no boot wait. |
| Entry to the no-indoor state | The heaters, fans and vent the table drops stop at once (`cut_unwanted`). |
| The fertiliser master or the fertigation line holding, a drip relay on, occupancy, the no-indoor fog lock | The fogger off at once (`fog_hold`), in every state. |
| An engine drip in progress, the soft water budget (not in a VPD emergency), the daily water ceiling | The fogger off at once, except at the 100 F limit, where fog is counted and not capped. |
| A manual run starts | Its relays start past their minimum off times. |
| A manual run ends | Its relays stop at once, unless the law asks for them. A vent the run kept closed keeps its off time. |

The fogger keeps its minimum times at every temperature; only its holds stop it at once. A relay switched outside the
loop (an OTA `on_begin` close, a manual run) is taken into the relay layer with a fresh switch time by
`relay_sync()`, so its minimum times count from that edge.

### 5.5 The lead fan (section 4.7 of the plan)

The lead is chosen only while both fans are off, at the start of an episode (a stretch with at least one fan
running), so there is no swap during a run. It alternates per episode: the lead is the fan that did not lead the last
episode; if that fan is inside its minimum off time, the other fan leads now and that counts as its turn. The last
lead is kept in RAM only; after a restart the fan with fewer persisted run seconds leads once. Run seconds are
telemetry and do not choose the lead otherwise, so nothing catches up after an outage. The second fan joins on
rule 4.

## 6. Wetting: the fogger and the climate misters

### 6.1 Fog holds (`fog_force_off_reason()`)

In order: the no-indoor fog lock (`sensor_fault`), confirmed occupancy (`occupancy`), the fertiliser master valve or
the fertigation line (`fert_master`, SAF-5), a drip relay on (`irrigation`); outside the 100 F limit also an engine
drip run (`irrigation`), the soft water budget (`resource_budget`, lifted in a VPD emergency over 2.5 kPa) and the
daily water ceiling (`water_ceiling`, SAF-4). The leak signal is not a hold: it raises the leak alert only.

`fog_block_reason` publishes the hold's word, `served` while the fogger runs, `relay_min_off` while the law asks for
fog and the fogger waits its minimum off time, `dew_margin` while the law's fog is held by the dew-point margin, or
`none`.

### 6.2 The climate mister pulse request (`mister_step()`)

The law never switches a mister valve. While the mister request holds and a member line is allowed, it asks the
irrigation engine for one pulse at a time through `irr_vpd_grant()`:

- **Pulse** 30 s, 1.4 times longer while the zone's VPD is above 1.2 times `vpd_high`; **gap** 60 s. A refused pulse
  is asked for again one pulse length later; the fogger carries on meanwhile. A pulse cut short still owes its gap.
- **Zone choice:** the fairness rule (an allowed zone above `vpd_high` with no pulse for 600 s, the longest waiting
  first), then the engine's ranking `irr_rank_vpd_zone()` on the house band with the compiled ranks (centre 1, south
  2, west 3, east 4), then the first allowed zone. A zone inside the 45 s mister line minimum off time gives way to
  another ready zone, or the pulse waits.
- **Allowed** is `irr_climate_zone_allowed()` per zone, with the zone gate's safety term
  `zone_gate_safety_ok()`: no occupancy, no feed hold, house VPD above `vpd_high`, dew margin at least 8 F.
- The engine's watchdog (`irr_mister_watchdog()`), daily caps, soft budget and interlocks apply unchanged. The
  misters are not relays of this layer: their re-fire fence is the engine's.

## 7. Missing inputs

### 7.1 Boot grace (`indoor_gate()`)

After a boot the controller waits for the first valid indoor temperature, at most 60 s. Meanwhile no climate relay
is switched by the law, the label is not a sensor fault (so the irrigation engine sees none), no alert is raised and
no state record is published; the manual runs still act. After the first valid temperature, or 60 s, a missing
temperature is the state of section 7.2 at once.

### 7.2 No valid indoor temperature (plan decision 7; `no_indoor_branch()`)

| Outdoor reading | Relays |
|---|---|
| Fresh, at or above the corridor's low edge (the lowest low-edge anchor) | Vent open and one fan (the relay layer picks the lead) |
| Fresh, colder | Electric heater on; vent closed; furnace off. Back to the vent branch only at or above the edge, and out of it only below the edge less 1.0 F |
| No fresh reading | Every climate relay off |

The fogger and the misters are off in every branch; the request goes through the same relay layer, so the interlocks
and the boot rule apply. The manual runs stay effective (a fogger press without the dew-point margin, which cannot be
computed there); a fog run-once of the irrigation engine is refused by the engine's own sensor-fault hold. A critical
alert is raised. The published label is `SENSOR_FAULT` with `mode_reason` `sensor_fault`.

### 7.3 Doubly blind (`doubly_blind_restart_step()`)

No valid indoor temperature and no outdoor reading: every climate relay is already off, so a restart costs no
control. The sensor-bus restart comes after 10 minutes of it the first time, then at most every 60 minutes while it
lasts; the flag that chooses the window is kept across the restart and clears after 60 minutes of continuous
readings. A due restart waits while a wet relay is open or an irrigation run is active. Restarts go through
`App.safe_reboot()`, which saves the relay counters and the open gap log quarter. Outside this state, one restart
rule applies: no probe answer on the sensor bus for 3,600 s, at most once an hour, independent of the clock.

## 8. Manual runs

The contract (actions, timeouts, what ends a run, the holds kept above a press) is
[`firmware-control-contract.md`](firmware-control-contract.md) section 7. At the relay level (`relay_pass()`):

- At a protection limit `clear_latches_at_protection()` clears every latch before the pass, logged once.
- `apply_manual_overrides()` runs on the relay layer's result: the fan latch sets both fans on and the vent open or
  closed by its flag; the fogger latch sets the fogger on unless `manual_fog_hold_reason()` names a hold. It is a
  no-op at the protection limits.
- A run's relays start past their minimum off times (`ManualForce`). A fan latch with the vent closed leaves the
  vent's off time running, so cooling does not wait after the run ends.
- No heater runs during a manual fan run.
- A press works in the no-indoor state; the fogger press is then not held by the no-indoor fog lock.

## 9. Running alone

### 9.1 Clock and corridor

The band's solar phase is trusted only after an SNTP sync has completed since the last boot
(`sntp_acquisition_valid()`, published as `sntp_valid`); a soft reset keeps the ESP32's clock and can step it, so a
retained clock is not trusted for the band. Without trust the band is the corridor (`band_corridor()`): the lowest
anchor of each low edge and the highest of each high edge, with fog and misters allowed. The band source is
published as `onchip_curve` or `corridor`; the on-chip band switch `sw_onchip_band_enabled` defaults on and is
read-only on the host. Irrigation and lighting keep their own clock tests.

### 9.2 What needs no network

The law's constants are compiled; the anchors and the drying cost limit are in flash; the ephemeris is computed
on-chip; the outdoor reading has a local second source (the intake probe). WiFi loss causes no restart
(`wifi.reboot_timeout: 0s`). The relay counters and fan run seconds are copied to flash 10 minutes after a boot, then
at most once an hour and on a planned shutdown, and restored at boot. The drying meter is not persisted; it counts
from 0 at every boot.

### 9.3 The gap log (`gap_log.h`, `gap_log_esphome.h`)

While the host is away there is no anchor reconciliation and no live telemetry. The gap log keeps the record:

- **Format.** Version 2: one climate record a minute (indoor temperature and dew point, outdoor temperature, the
  relay mask, the water total, the mode label and validity flags) and every transition of 18 relays and outputs, kept
  per quarter hour. Format 1 (one climate record every 5 minutes) is a build option (`GAP_LOG_FORMAT`); the version
  byte of each quarter tells the host which it receives.
- **Storage.** The open quarter is collected in RAM and written once into its own NVS key (namespace `gaplog`) when
  it closes (15 minutes, a change of time basis, or 64 transitions) or at a clean shutdown. 96 keys make a 24-hour
  ring. A power cut or panic loses at most the open quarter; a clean restart loses nothing.
- **Time.** A quarter written while the clock is trusted carries epoch seconds and the offset from uptime; one
  written without a trusted clock carries uptime seconds, and the host places it from an offset of the same boot.
- **Liveness.** The recorder is the API client whose `client_info` is exactly the library default (`aioesphomeapi`)
  or starts with `verdify-ingestor`, keyed on its connection id; Home Assistant is not the recorder. A quarter is
  live when the same recorder connection was up for all of it. Live quarters are never replayed.
- **Replay.** A pass starts while there is a quarter to send and the recorder has been connected for 60 s, its
  connection has nothing queued, and the free heap is at least 20 KB with a minute low of at least 24 KB. It sends
  `G1` lines (a begin line, each quarter's header, climate and transition lines, an end line) on the text sensor
  "Gap Replay", one line every 250 ms or slower, each at most 240 characters. After the end line the controller waits
  for the connection to stay up 60 s more, then moves its drained mark; a break sends the same quarters again, so the
  host receives each at least once and must be idempotent.
- **Host.** `ingestor/gap_replay.py` writes each placed climate record where no `climate` row stands within its
  slot, and each transition where no `equipment_state` row of that output with the same state lies within 5 s;
  live rows are never changed. A complete quarter is recorded in `gap_replay_quarters` (migration 314) in the same
  transaction, and a quarter already in the ledger is skipped. `v_data_gaps_unreplayed` is `data_gaps` with the
  replayed spans cut out.
- **Arming and stopping.** At boot the log arms only with an NVS partition of at least 400 KB and at least 25 % free
  entries; it stops under 15 % free entries, after three quarter writes in a row over 200 ms, or on an NVS error.
  "Gap Log State" publishes `armed`, or `off:` with `not_armed_yet`, `nvs_small`, `nvs_full`, `nvs_slow` or
  `nvs_error`.

## 10. The band curve

- **Solar phase** in [0, 4): 0 sunrise, 1 solar noon, 2 sunset, 3 solar midnight, from the on-chip NOAA ephemeris
  (`greenhouse_solar.h`, `solar_phase()`), C1-smooth across the anchors.
- **Band value** (`band_value_at_phase()`): the 4-anchor harmonic interpolation through `{sr, sm, ss, mid}`,
  `c0 + c1*cos(theta) + s1*sin(theta) + c2*cos(2*theta)` with `theta = pi*phi/2`; it passes exactly through each
  anchor and is smooth everywhere.
- **One curve per runtime**, tested against the same vectors: firmware `band_value_at_phase()`, Python
  `verdify_schemas/band_profile.py` and `ingestor/solar.py`, SQL `fn_band_setpoints`. Pinned by the goldens in
  `firmware/test/test_greenhouse_logic.cpp` and by `tests/test_solar_band_anchors.py`.
- Only the house temperature and VPD edges drive the law; temperature is one house-wide curve.

## 11. What the controller publishes

### 11.1 The law state record (`climate_law_state`)

JSON, at most 200 characters (`climate_law_payload.h`), on change at most every 5 s and on a 60 s heartbeat, never
during the boot grace:

| Key | Meaning |
|---|---|
| `v` | format version, 1 |
| `l` | latch bits, bit 0 first: `h1`, `h2`, `cool`, `cool2`, `wet`, `mist`, `dry`, `air`, `run` |
| `o` | request bits: heat1, heat2, vent, fog, mist, one fan, two fans, cooling, drying, hot (100 F), cold (40 F) |
| `dr` | the drying refusal (section 4.3) |
| `e`, `lim` | the drying cost (kWh/kg, `null` with no outdoor data) and the limit in force |
| `br` | 1 when the band check repaired the band |
| `b` | the band the law used: `low`, `high`, `vpd_low`, `vpd_high` |

### 11.2 Other records

- `climate_drying_meter`: `s` seconds of a drying run with the vent open, `g` grams of water and `wh` watt-hours of
  heat carried out (with the compiled air exchange), `rw` seconds drying was wanted and not running. Not persisted.
- `relay_counters`: lifetime starts of heat1, heat2, fan1, fan2, fog and vent, and fan run seconds; persisted. A
  start is an OFF-to-ON edge after the relay layer has run.
- `outdoor_source`, `band_source`, `sntp_valid`, and `climate_law_constants` (the hash of the compiled constants).
- **Controller health**, every 60 s: Free Heap Minute Low and Largest Heap Block Minute Low (kB), Control Loop Worst
  Minute (ms), NVS Write Worst Minute (ms, 0 when nothing was written), each over its own one-minute window; Restart
  Count (persisted); NVS Used Entries and NVS Free Entries; Loop Stack High Water (bytes never used); WiFi Disconnect
  Count (since boot); API Client Count. A `heap_profile` and a `flash_profile` log line every 15 minutes.
- Gap Log State and Gap Replay (section 9.3).

### 11.3 Labels for host readers that predate the law (`legacy_state()`)

The mode, action and priority axis are derived from the relays, the first row that applies:

| State | Mode label | Action | Axis |
|---|---|---|---|
| No valid indoor temperature | `SENSOR_FAULT` | `SENSOR_FAULT` | safety |
| At or above 100 F | `SAFETY_COOL` | `SAFETY_COOL` | safety |
| At or below 40 F | `SAFETY_HEAT` | `SAFETY_HEAT` | safety |
| Vent open, fogger on | `VENTILATE` | `VENT_COOL_FOG_ASSIST` | temp |
| Vent open, a mister on | `VENTILATE` | `VENT_COOL_MIST_ASSIST` | temp |
| Vent open for drying | `DEHUM_VENT` | `DEHUM_VENT` | vpd |
| Vent open otherwise | `VENTILATE` | `VENT_COOL` | temp |
| Vent closed, fogger on | `SEALED_MIST` (stage `FOG`) | `SEALED_FOG` | vpd |
| Vent closed, a mister on | `SEALED_MIST` (stage `S1`) | `SEALED_HUMIDIFY` | vpd |
| A heater on | `IDLE` | `HEAT` | temp |
| None of these | `IDLE` | `IDLE` | temp or vpd when that reading is outside the band, else resource |

During the boot grace the label is `IDLE`. A manual fan run with the vent closed reads `IDLE`. `mode_reason` is
`init` during the boot grace, `sensor_fault` in the no-indoor state and `law` otherwise.

## 12. Tests and the gate for a firmware change

| Check | What it pins |
|---|---|
| `make test-climate-law` (`firmware/test/test_climate_law.cpp`) | The law equals the reference implementation (`docs/reviews/control-review-2026-11-15/sim/band_edge_controller.h`) on one vector set; the rules, the band check, the relay layer, the lead fan, the mister request, the glue, the manual runs and the interlocks |
| `make climate-law-sim` (`firmware/test/climate_law_sim.py --full`, CI only) | The firmware's law and relay layer reproduce the reference's per-minute relay trajectory over the whole weather year |
| `make climate-law-replay` (`firmware/test/test_climate_law_replay.cpp`) | The law over the recorded corpus: the furnace and the vent never together, no fan without the vent, the furnace's boot wait, the 100 F and 40 F rules on injected traces, a NaN trace requests nothing, no latch changes faster than its relay allows |
| `make test-running-alone` | Input selection, the clock trust and corridor, the no-indoor table, the boot grace, the counters, the sensor-bus and doubly blind restarts |
| `make test-gap-log` (`firmware/test/test_gap_log.cpp`) | The gap log's format, ring, clockless stamping, arming and stopping, the recorder test, replay, in both record formats |
| `make test-irrigation-program`, `make test-greenhouse-logic`, `make test-zone-vpd` | The irrigation engine, lighting, the fog holds, the manual run helpers, the band curve goldens, the zone VPD fallback |
| `verdify_schemas/tests/test_climate_law_constants.py` | The generated constants are fresh and no law source holds a literal |
| `make firmware-check` | The ESPHome compile |

`make test-firmware` runs the native suites. Any change under `firmware/lib/**` or `firmware/greenhouse/**` runs
these, then ships through the signed flash path behind `scripts/firmware-deploy-preflight.sh`
([`runbooks/firmware-signed-artifacts.md`](runbooks/firmware-signed-artifacts.md)): no flash on an open critical
alert, stale telemetry or a missing rollback image; there is no bake or timing gate. Changing a compiled constant is a
change to `verdify_schemas/climate_law.yaml` and a firmware release; the controller then reports a new constants hash.
