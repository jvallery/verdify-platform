# Firmware Control Contract

This is the part of the control document [`CONTROL-ARCHITECTURE.md`](CONTROL-ARCHITECTURE.md) that says who may
write what; its other part is [`firmware-fsm-spec.md`](firmware-fsm-spec.md) (the state machine and invariants).

This document defines how a value is allowed to enter the controller's control loop, who may write it, and how its
delivery is confirmed. The design is [`design/climate-refactor-plan-2026-11-15.md`](design/climate-refactor-plan-2026-11-15.md)
sections 3.2, 4.4 and 7; the firmware internals are in [`firmware-fsm-spec.md`](firmware-fsm-spec.md) and the
system overview in [`CONTROL-ARCHITECTURE.md`](CONTROL-ARCHITECTURE.md).

## 1. Three kinds of value

| Kind | What | Where it comes from | Changed by |
|---|---|---|---|
| Compiled constant | Every number of the climate law: thresholds relative to the band, relay minimum times, protection limits, mister cadence, the values the irrigation engine and lighting read from the climate path (appendix E of the plan) | `verdify_schemas/climate_law.yaml`, generated into `firmware/lib/climate_law_constants_generated.h` | A firmware release |
| Stored setting | The band anchors, the drying cost limit, the operator switches, `manual_override_timeout_min`, the soft water budget, the lighting settings, the irrigation program | The database, delivered by the ingestor, kept in flash on the controller | The owner on the dashboard (agents: operator switches only) |
| Physics and calibration | Psychrometric coefficients, unit conversions, sensor plausibility ranges, the case sensor offset | The constants file where the law uses them; named constants in `firmware/lib/running_alone.h` for input selection | A firmware release |

The law reads no climate setting except the band and the drying cost limit. There is no planner setting.

## 2. Compiled constants

- **One source.** `verdify_schemas/climate_law.yaml` is the only place a law number is typed.
  `scripts/gen-climate-law-constants.py` generates the firmware header (`namespace climate_law_k`), the host module
  `verdify_schemas/climate_law_constants.py` and the table [`climate-law-constants.md`](climate-law-constants.md).
- **Gate.** `verdify_schemas/tests/test_climate_law_constants.py` fails when a generated file is stale or when a law
  source holds a numeric literal; `climate_law.h` admits no literal other than 0, 1 or 2.
- **Hash.** `CONSTANTS_SHA256` is the SHA-256 of one `<key>=<value>` line per constant, sorted by key. The firmware
  publishes it as `climate_law_constants`; the host compares it with the release's module and alerts on a
  difference. A compiled number has no readback: it cannot be lost at a reboot or delivered wrongly.
- **Derived values.** `band_min_width_f` (6.5 F) and `band_min_width_kpa` (0.35 kPa) are sums of the law's own
  margins, so the band editor and the controller's band check stay consistent with the law.

## 3. Stored settings and their path

Each stored setting has this chain:

| Layer | Contract |
|---|---|
| Registry | A row in `verdify_schemas/tunable_registry.py::REGISTRY` with range, default, ESPHome object id and readback |
| Database | `crop_band_anchors` for the band; the settings store (`setpoint_changes`, readbacks in `setpoint_snapshot`) for the rest |
| Dispatcher | `ingestor/entity_map.py` maps the name to the ESPHome entity or service key; the dispatcher pushes on change or readback mismatch |
| ESPHome | `firmware/greenhouse/tunables.yaml` (numbers and switches) or the `set_band_anchor` service (`firmware/greenhouse.yaml`) stores into a `restore_value` global |
| Readback | A `cfg_*` sensor in `firmware/greenhouse/sensors.yaml`; the ingestor compares it with the pushed value |

**Confirmation.** Every pushed value (the anchors, the drying cost limit, the operator switches, the lighting
values) is compared with its readback; one alert covers a value left unconfirmed. After a confirmed push, the newest
`setpoint_changes` row for that parameter carries the value the controller holds.

**The band.** The 16 house anchors (`band_{temp,vpd}_{low,high}_{sr,sm,ss,mid}`) are stored in flash and reach the
controller through `set_band_anchor`. The ROM values in `firmware/greenhouse/globals.yaml` are a deliberately drier
view of `band_defaults.yaml` (enforced in CI) and are used only on a chip whose flash is empty; the dispatcher
reconciles the store into flash on reconnect. To change the band, edit `crop_band_anchors` through the band editor,
never the firmware globals.

**The drying cost limit.** `dry_cost_limit_kwh_per_kg`, 0 to 1.5 in steps of 0.05, default 0.7. The controller
clamps the stored value to the range and uses the compiled default when it cannot be read
(`climate_law::dry_cost_limit()`), and publishes its readback after restore at boot. The dispatcher sends it only to
a controller that publishes that readback.

**Settings the controller reads for climate.** The band anchors, the drying cost limit,
`manual_override_timeout_min` and the manual run latches, `sw_occupancy_inhibit` with the occupancy state, and the
soft water budget (`mister_water_budget_gal`, irrigation's). The on-chip band switch `sw_onchip_band_enabled` is
read-only on the host. Every other value the climate path reads is compiled.

**The policy wire.** The 48-slot policy vector layout stays frozen in `verdify_schemas/policy_vector.py` so that the
generated firmware files do not change: 5 slots are live settings and 43 are reserved, never written, read or
shown. Nothing sends a policy vector.

## 4. Who may write

- **Owner only** (`OWNER_ONLY_PARAMS` in `verdify_schemas/tunable_registry.py`): the band rows (house and zone), the
  zone priorities, the drying cost limit and `manual_override_timeout_min`. `verdify_services.settings` refuses a
  write or a release of one from any actor but a signed-in dashboard operator. The set is named member by member and
  asserted against the registry's band rows, so it cannot grow silently.
- **Agents** (`AGENT_SETTABLE_PARAMS`): `sw_occupancy_inhibit`, `sw_gl_main_out_of_service` and
  `sw_gl_grow_out_of_service`. MCP `set_setting` refuses everything else for an agent. A test checks that an agent's
  write to a band row or to the drying cost limit is refused.
- **The reviewer** writes no climate value. It reads the record and proposes band edits; the owner applies them.
- **Manual marks.** A setting the owner marked manual is skipped by the reviewer. Last write wins: another assistant
  may change it or clear the mark, logged with who did it.

## 5. Crop-agnostic boundary

The firmware (`firmware/lib/*.h`, `firmware/greenhouse/*.yaml`) knows sensors, relays and numeric bands, never
crops. The only crop knowledge on the controller is the band, as plain floats (`BandAnchors{sr, sm, ss, mid}` in
`greenhouse_solar.h`). Crop strategy lives above the firmware: `band_defaults.yaml`, then `crop_band_anchors`, then
the anchor push. `tests/test_firmware_crop_agnostic_guard.py` fails CI if a crop name appears in non-comment firmware
code or configuration.

## 6. Disconnected operation

The controller computes the ephemeris on-chip and the band from its stored anchors, and its law constants are
compiled, so climate control needs no network. A push is an update, never a control-loop dependency. Without a
trusted clock the band is the corridor; without outdoor data there is no drying with outdoor air. While the host is
away the gap log keeps the record in flash and replays it on reconnect. The full list is in
[`firmware-fsm-spec.md`](firmware-fsm-spec.md) section 9.

## 7. Manual runs

Three timed manual actions, each a latch with a deadline:

| Action | Panel button | `manual_override` kind | Relays while latched | Indicator |
|---|---|---|---|---|
| Run the fogger | PB Fog Burst | `humidify` | fogger on | Fog Burst Active |
| Run the fans, vent open | PB Fan Burst | `fans` | both fans on, vent open | Fan Burst Active |
| Run the fans, vent closed | PB Vent Bypass | `vent_bypass` | both fans on, vent closed | Vent Bypass Active |

- The two fan actions are one latch (`manual_fans_until_ms`) with a vent flag (`manual_fans_vent_closed`). On the
  panel, pressing the button of the running state ends it; pressing the other fan button switches the running latch
  to that vent state for a fresh timeout (`manual_fan_press()`). The fogger has its own latch
  (`manual_fog_until_ms`); its button toggles it (`manual_latch_toggle()`). The service sets a latch for the minutes
  it carries.
- **Timeouts.** A panel press runs for `manual_override_timeout_min`; the service carries its own minutes, which
  the dashboard sets per press. Both are clamped to 1 to 120 (`manual_override_minutes()`); a deadline that wraps to
  exactly 0 is stored as 1.
- **No conditional refusals.** A press is never refused on the band, humidity, dew point, the clock or fog hours, and
  it works with no valid indoor temperature.
- **A run ends** at its timeout, on a second press, on `clear`, or at 100 F or 40 F, where every latch is cleared
  (`clear_latches_at_protection()`). An end stops the run's relays at once unless the law asks for them. No run
  survives a reboot.
- **Kept above a press** (they protect equipment or water): no heater runs during a manual fan run, vent open or
  closed (the furnace never with the air, and the electric heater stops too); a fogger press is held only by
  `manual_fog_hold_reason()`: the fertiliser master valve (SAF-5), a drip relay on or an engine drip run, and the
  daily water ceiling (SAF-4). A press is not held by occupancy or by the soft water budget.
- A press starts its relays at once, past their minimum off times; there is no lockout against repeated pressing.
- `clear` ends all manual runs (it leaves light holds alone); `restart` calls `App.safe_reboot()`, which saves the
  relay counters and the open gap log quarter.
- A fog run-once is the irrigation engine's run, not a manual run: it fogs while the engine asks, under every fog
  hold of the law and the engine's own checks.

## 8. The mist path (irrigation and climate)

The irrigation engine (`firmware/lib/irrigation_program.h`) is unchanged by the refactor; the climate path feeds it:

- **Membership.** A mister zone (L04 centre, L07 south, L09 west) takes climate pulses only while
  `irr_climate_zone_allowed()` says so: the law's mister request (rule 6, with the cold-house guard), the zone gate's
  safety term (`climate_law::zone_gate_safety_ok()`: no occupancy, no feed hold, house VPD above `vpd_high`, dew
  margin at least the compiled 8 F; no clock or night term), an effective VPD member of the irrigation program, no
  watchdog back-off or latch, the zone's duty cap and SAF-4. With no stored program the ROM default makes L04 the
  only member.
- **Zone choice.** The fairness rule first (an allowed zone above `vpd_high` with no pulse for 600 s, the longest
  waiting first), then the engine's ranking (`irr_rank_vpd_zone()`) on the house band with the compiled ranks (centre
  1, south 2, west 3, east 4), then the first allowed zone. A zone inside the mister line minimum off time (45 s)
  gives way to another ready zone.
- **One manifold.** Each climate pulse asks the engine for its zone's grant (`irr_vpd_grant()`); one mister relay is
  on at a time. Pulses are 30 s with a 60 s gap, 1.4 times longer while the zone's VPD is above 1.2 times `vpd_high`.
- **Occupancy.** A confirmed occupancy (pushed by the ingestor, expiring after 60 minutes) holds the law's fog, the
  misters, scheduled and run-now mist and the fog run-once; unknown occupancy holds nothing; drips never read it; the
  law's fans and vent run with a person inside.
- **Water.** SAF-4 and the soft budget count the site meter whenever a mister relay or the fogger is on, whatever
  opened it. The soft budget holds the law's fog and the misters except in a VPD emergency (2.5 kPa, compiled).
- **Leak.** `leak_detected` raises the leak alert and nothing else.
- **Mister watchdog (D-IRP-19).** A wet relay on without its engine grant, or a mister on past its commanded pulse
  plus 30 s (300 s when no length is known), is forced off. Per zone per local day a VPD member backs off 10 minutes,
  then 30, and latches on its third fault; a schedule-only zone, L08 or L10 latches on its first. A latch holds until
  local midnight or `clear_fault`; `irr_state` publishes each end time.
- **Engine inputs.** `sensor_fault` is no valid indoor temperature after the boot wait; `safety_cool` is 100 F or
  above; `vpd_emergency` is the highest house or zone VPD above 2.5 kPa; `climate_demand` is the law's fog or mist
  request with every hold but the drips passing (`climate_law::climate_demand()`), so a request held by occupancy,
  the water ceiling or the cold-house guard never makes a drip yield.

## 9. Lighting

Lighting is unchanged by the refactor; its settings, readbacks and the dispatcher's lighting block stay.

### 9.1 Cutoff and manual disable precedence (#386)

A solar or fixed-hour cutoff removes automatic lighting demand, but an already on circuit completes its configured
minimum-on interval. At the exact elapsed minimum the decision is OFF with `outside_window`; low lux or occupancy
cannot restart it outside the window. An external relay OFF is current state and is never replaced with a cached
automatic ON at the cutoff.

Setting the per-circuit `auto_enabled` flag false requests OFF with `auto_disabled` immediately, including during
minimum-on dwell. That explicit disable takes precedence over ordinary cycling protection. Invalid controller time
forces both relays OFF before evaluation.

`scripts/growlight-boundary-episodes.py --since '3 days'` reads the runtime evidence passively: it classifies every
intent ON interval per circuit from the `grow_light_<c>_intent` edges, the per-decision `gl_<c>_reason` rows, the
live `gl_<c>_min_on_s` and controller boots, and reports the Lutron readback lag after each edge. `boundary_ok` (the
window closed during minimum-on and the light went OFF within one decision of its expiry) is the episode #386 waits
for; `premature` or `overrun` exits 1.

### 9.2 Timed manual light hold (#1335)

A dashboard light switch (API-20) is timed: it lasts its minutes (15 by default, 1 to 120), then the light is
automatic again. The confirmed switch queues `manual_override light_<main|grow>_<on|off>` with the same minutes,
which sets the per-circuit deadline latch `gl_<c>_hold_until_ms` and the held state `gl_<c>_hold_on`. While the
deadline is ahead, `evaluate_lighting_held()` reports the held state with the reason `manual_hold_on` or
`manual_hold_off` whatever the schedule decides, and stamps a dwell transition only when the relay really changes, so
when the deadline passes the schedule's decision applies at once, measured from the manual switch. Back to automatic
sends `light_<c>_auto`, which zeroes the deadline; `clear` leaves light holds alone. A hold is not restored after a
reboot, and invalid controller time still forces both relays OFF.

## 10. Literals outside the constants file

| Category | Where | Rule |
|---|---|---|
| Indoor plausibility (-20 to 140 F), wall humidity read as 100 % up to 110 %, probe staleness (300 s), boot grace (at most 60 s), no-indoor hysteresis (1.0 F), counter save times | `firmware/lib/running_alone.h` (`running_alone_k`) | Named constants, host-tested in `firmware/test/test_running_alone.cpp` |
| The doubly blind restart windows (10 and 60 minutes) | `running_alone.h` | Named there so the constants hash does not move; ratified by the owner |
| State record cadence (5 s on change, 60 s heartbeat) | `climate_law_glue.h` | Presentation, not control |
| Gap log format, ring size, arming and stopping gates, replay conditions | `firmware/lib/gap_log.h` | Named constants, host-tested in `firmware/test/test_gap_log.cpp` |
| Manual run minutes (1 to 120) | `greenhouse_logic.h` (`manual_override_minutes()`) | The same range as the registry row and the service |
| Psychrometric constants of the law | `climate_law.yaml` | Compiled with the law |
| Irrigation engine and lighting numbers | `irrigation_program.h`, lighting settings | Unchanged subsystems |
