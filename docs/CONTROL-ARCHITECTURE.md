# Greenhouse Control Architecture

**How the band, the controller, the host and the reviewer fit together, and where each thing is changed.**

Status: living reference for the system after the climate refactor (epic #1633). The ratified design is
[`design/climate-refactor-plan-2026-11-15.md`](design/climate-refactor-plan-2026-11-15.md) (the plan); this
document is the overview. The firmware internals are in [`firmware-fsm-spec.md`](firmware-fsm-spec.md) and the
rules for how a value reaches the control loop are in [`firmware-control-contract.md`](firmware-control-contract.md).
If this document and the code disagree, the code wins: fix this document.

---

## 0. Summary

> The **band is the policy**. The **controller decides climate alone**, every second, with one band-edge law and
> compiled constants. The **host serves the band and one price** (the drying cost limit), stores, grades and
> alerts. The **reviewer (Iris) reads the record once a day** and writes no climate value.

```
 crop_band_anchors (DB)          drying cost limit (DB)       operator switches, irrigation, lighting
   16 house anchors                one stored number            (unchanged subsystems)
          |                               |                                |
          +---------------+---------------+--------------------------------+
                          v
        INGESTOR (the only device writer): pushes on change or readback mismatch,
        confirms every pushed value against its readback, stores telemetry, grades, alerts
                          v
        CONTROLLER (ESP32): band curve on-chip from stored anchors and its clock;
        the band-edge law every second; relay layer; three timed manual runs;
        irrigation engine; lighting; gap log in flash
                          |
                          +--> law state record, relay counters, drying meter, outdoor source,
                               band source, constants hash, controller health, gap log replay
```

Three things hold whatever the network, the host or the reviewer does: the band stored on the controller, the
single device writer, and the protection limits of the law (100 F and 40 F).

---

## 1. Principles

These are the plan's section 2, in force:

1. **The band is the policy.** What the house should be at each point of the solar day is the band. The owner
   edits the band and one price, the drying cost limit (plan 4.5). Nothing else changes with time, season or
   weather.
2. **The controller decides alone.** Every input the law needs is on the controller. The host never has to arrive
   for the house to be held.
3. **One law, relative to the band.** Every threshold is a fixed offset from a band edge. The constants are compiled
   from one file, `verdify_schemas/climate_law.yaml`.
4. **Act at the edges.** Inside the band only the electric heater works steadily, holding a line near the low edge;
   every other action starts at an edge or just beside it.
5. **A thing is defined once.** One band curve per runtime, one constants file, one compliance definition
   (`fn_band_compliance_5m`), one band store (`crop_band_anchors`).

---

## 2. The layers

| Layer | Does | Does not |
|---|---|---|
| Controller (ESP32 firmware) | Reads its sensors; computes the band from its stored anchors and its clock; runs the law every second (`firmware/lib/climate_law.h`); drives the six climate relays; requests mister pulses from the irrigation engine; runs the three timed manual actions, the irrigation engine and the lighting decisions; keeps the gap log; publishes the law's state, relay counters, the drying meter, the outdoor source and its own health. | Take any climate setting other than the band anchors, the drying cost limit and the operator switches. Depend on a push after a reboot. |
| Ingestor (the only device writer) | Stores telemetry; pushes the band anchors and the drying cost limit when the owner changes them or the controller's readback differs; pushes operator switches; delivers irrigation programs and commands and lighting values; confirms every pushed value against its readback; stores the gap log replay; raises alerts. | Read a plan, clamp values or push climate defaults. |
| Database | Telemetry, relay events, `crop_band_anchors`, the settings store, compliance, the daily record of cycles, run time and utilities, alerts, the gap replay ledger, the reviewer's record (`planner_review`), the irrigation and lighting objects. | Hold plans, clamps or forecast actions on the control path. |
| API, MCP, dashboard | Show state; let the owner edit the band, the drying cost limit, the operator switches, irrigation and lights; offer the three timed manual actions. | Offer a write path for climate actuator settings, or let an agent write the band or the drying cost limit. |
| Reviewer (Iris) | Reads the record once a day, writes a short review to `planner_review`, proposes band edits with their simulated price, keeps its irrigation tools. | Write any climate value to the controller, the band included. |

### 2.1 Controller

ESPHome configuration (`firmware/greenhouse.yaml`, `firmware/greenhouse/*.yaml`) around pure C++ libraries in
`firmware/lib/` that the host tests compile and run:

- `climate_law.h`: the law (rules 1 to 9), the controller's band check, the relay layer, the lead fan, the mister
  pulse request, the drying meter, the published labels and the inputs the irrigation engine reads.
- `climate_law_glue.h`: one relay pass (the relay layer, then the manual runs and the interlocks over its result),
  the protection clear of the manual runs, the law's humidity and fog dew-margin gates, the state record cadence.
- `climate_law_constants_generated.h`: the compiled constants, generated from `verdify_schemas/climate_law.yaml`.
- `running_alone.h`: the band's clock trust and the no-clock corridor, the indoor and outdoor reading selection with
  no substituted values, the no-indoor-temperature state, the boot grace, relay counters, the sensor-bus restart.
- `greenhouse_solar.h`: the on-chip ephemeris, the solar phase and the band curve.
- `irrigation_program.h`, `irrigation_engine_esphome.h`: the irrigation engine (unchanged by the refactor).
- `greenhouse_logic.h`: psychrometrics, the fog holds, the manual run helpers and the lighting decisions.
- `gap_log.h`, `gap_log_esphome.h`: store and forward across a disconnect.
- `heap_diagnostics.h`: the controller health readings.

The law and its relay layer are specified in [`firmware-fsm-spec.md`](firmware-fsm-spec.md).

### 2.2 Ingestor and dispatcher

One process, one controller connection, `replicas: 1` and `strategy: Recreate`, a writer Lease, and the
device-write gate `VERDIFY_DEVICE_WRITE_ENABLED=1` set only in `deploy/k8s/overlays/prod`. The dispatcher
(`ingestor/tasks/dispatcher.py`, `ingestor/tasks/band_anchors.py`, `ingestor/esp32_push.py`) pushes:

- the 16 house band anchors through the `set_band_anchor` service, on change or readback mismatch;
- the drying cost limit, only to a controller that publishes its readback;
- the operator switches and the lighting values (the desired-state overlay carries lighting overrides);
- the irrigation programs and commands through the irrigation task (`ingestor/tasks/irrigation.py`).

Every pushed value is confirmed against its readback; `setpoint_unconfirmed` covers a value its
readback has not confirmed and `setpoint_delivery_stuck` a delivery that keeps failing. The ingestor
also receives the gap log replay (`ingestor/gap_replay.py`, section 6).

### 2.3 Reviewer

Iris runs once a day. It reads compliance, relay starts and run hours, utilities, the drying meter, alerts and the
forecast, and writes its review to `planner_review` (migration 313). Where the record supports it, it proposes a
band edit with its simulated price (plan 5.7); the owner applies it in the band editor or does not. Its irrigation
tools stay. Its inputs and outputs are in [`planner/planner-io-schema.md`](planner/planner-io-schema.md).

---

## 3. What crosses the wire for climate

| Direction | Item | Stored on the controller |
|---|---|---|
| To the controller | Band anchors: four edges (temperature low and high, VPD low and high) at four solar points (sunrise, solar noon, sunset, solar midnight), 16 values | Yes, in flash. The ROM copy is a deliberately drier view of `band_defaults.yaml`, used only on a chip whose flash is empty. |
| To the controller | The drying cost limit, kWh of heat per kg of water, 0 to 1.5, default 0.7 | Yes, in flash; the ROM copy is the released default |
| To the controller | Occupancy state and the occupancy inhibit switch | The state expires after 60 minutes |
| To the controller | Manual runs (`manual_override` service: `fans`, `vent_bypass`, `humidify`, `clear`, `restart`) with their minutes, and `manual_override_timeout_min` for the panel buttons | The timeout, yes; a running manual run, no |
| To the controller | Time (SNTP) | Not across a power cut; a clock kept across a soft reset is not trusted for the band until a time server answers |
| From the controller | Sensor values, relay states, anchor and limit readbacks, the law state record, relay counters, the drying meter, outdoor source, band source, constants hash, controller health readings, gap log state and replay, firmware version | Relay counters, fan run seconds and the gap log persist |

The lighting values, the irrigation programs and commands, and the soft water budget cross the same wire and are
unchanged by the refactor.

---

## 4. The band (the deterministic target)

- **Store.** `crop_band_anchors` is the one live store. The controller reads 16 house values: four edges at four
  anchors. Editing that table, through the band editor (`PUT /band/profile`), changes the greenhouse with no
  firmware release. The editor refuses a band narrower than 6.5 F or 0.35 kPa at any point, edges outside 45 to
  95 F or 0.3 to 3.0 kPa, and a night where the drying line (`vpd_low + 0.05`) falls below 0.74 kPa. These limits
  are generated from the constants file.
- **Solar phase.** Clock time maps to a continuous phase in [0, 4): 0 sunrise, 1 solar noon, 2 sunset, 3 solar
  midnight, from the on-chip NOAA ephemeris (`greenhouse_solar.h`, `solar_phase()`). The anchors live in phase
  space, so the diurnal program follows day length through the year.
- **Curve.** A 4-anchor harmonic interpolation through the anchors:
  `value(phi) = c0 + c1*cos(theta) + s1*sin(theta) + c2*cos(2*theta)`, `theta = pi*phi/2`, with
  `c0 = (sr+sm+ss+mid)/4`, `c1 = (sr-ss)/2`, `s1 = (sm-mid)/2`, `c2 = (sr-sm+ss-mid)/4`. It passes exactly through
  each anchor and is smooth everywhere. The same math is in the firmware (`band_value_at_phase()`), in Python
  (`verdify_schemas/band_profile.py`, `ingestor/solar.py`) and in SQL (`fn_band_setpoints` is the band for host
  readers).
- **Temperature is house-wide.** There is one air mass and no per-zone thermal actuator.
- **No trusted clock: the corridor.** Until an SNTP sync has completed since the last boot, the controller serves the
  widest corridor its anchors allow (the lowest and highest anchor of each edge), with fog and misters allowed.
- **Controller band check.** Every pass, the controller clamps each edge to the editor's limits and widens a band
  narrower than the minimum widths about its middle, so a corrupted anchor cannot make two opposing actions latch
  together.

---

## 5. The law, in one page

The full rules, constants and relay layer are in the plan (sections 4.2 to 4.4) and in
[`firmware-fsm-spec.md`](firmware-fsm-spec.md); the generated table of the compiled constants is
[`climate-law-constants.md`](climate-law-constants.md). In short, with `low`, `high`, `vpd_low`, `vpd_high` the band
now:

| Rule | On | Off |
|---|---|---|
| 1 Electric heater | below `low + 3.5` | above `low + 4.5` |
| 2 Gas furnace (never with the vent open) | below `low + 0.5` | at `low + 3.0` |
| 3 Cooling: vent and lead fan | above `high` | below `high - 2.0` |
| 4 Second fan | above `high + 1.5` | below `high` |
| 5 Fogger | above `vpd_high` | below `vpd_high - 0.15` |
| 6 Misters opted in for VPD (pulses through the irrigation engine) | above `vpd_high + 0.30` | below `vpd_high + 0.05` |
| 7 Drying with outdoor air: vent and lead fan | wanted below `vpd_low + 0.05` | above `vpd_low + 0.20` |
| 8 At or above 100 F | vent open, both fans, both heaters off | |
| 9 At or below 40 F | vent closed, fans off, both heaters on, fog and misters off | |

No fog or mist while the house is below `low`. The law's own fog also waits while the indoor temperature is less
than 8 F above the dew point. Fog, misters and drying run only on the wall probes' humidity, not on the case sensor
alone. A drying run starts only while the outdoor air is fresh and drier (dew point at least 3 F below indoor, more
than 0.1 g/kg less water), the house is at or above `low + 1.5`, the furnace is off, nothing is cooling, and the
heat carried out per kilogram of water is within the drying cost limit; it stops below `low + 0.75`. The law has no
modes, no clock, season or zone branch, and no setting a planner can change.

**Relay layer.** Minimum on and off times of 300 s for the heaters, fans and vent and 120 s for the fogger. Every
relay is available at once after a boot except the furnace, which waits 300 s (at or below 40 F it starts at once).
A fan runs only with the vent open; the furnace and the vent are never on together; the electric heater does not
start into, and is cut by, an open vent or a running fan, except the law's own drying (including the drying run's
vent and fan finishing their minimum on time) and the 40 F limit. The lead fan alternates per episode. At a
protection limit no minimum time applies to the heaters, vent and fans.

**Holds above the law** (plan 4.3): the fertiliser master or the fertigation line, a drip relay on, occupancy and a
sensor fault stop the fogger and misters at once; an engine drip in progress, the soft water budget (not in a VPD
emergency) and the daily water ceiling stop the fogger except at the 100 F limit, and the misters always, through the
engine's grant. Occupancy holds wetting only: the law's fans and vent run with a person inside.

**Manual actions.** Three timed latches: the fogger; both fans with the vent open; both fans with the vent closed
(the two fan actions are one latch with a vent flag). A press is never refused on the band, humidity, dew point, the
clock or fog hours, and works with no indoor temperature. A run ends at its timeout, on a second press of its
button, on `clear`, or at 100 F or 40 F. No heater runs during a manual fan run; a fogger press is held only by the
holds that protect equipment and water (the fertiliser master, a drip, the daily water ceiling). The contract is in
[`firmware-control-contract.md`](firmware-control-contract.md) section 7.

---

## 6. Running alone

| Condition | What the controller does |
|---|---|
| WiFi down | Keeps running; no restart (`wifi.reboot_timeout: 0s`). A stuck WiFi stack stays stuck until a manual restart, with the house still controlled. |
| Ingestor, API or reviewer down | No effect on climate. |
| Reboot | Constants compiled; anchors and the drying cost limit from flash; every relay but the furnace available at once, the furnace after 300 s; no climate relay switched until the first valid indoor temperature, for at most 60 s; fan run seconds and relay counters restored; no manual run survives. |
| Clock not trusted (no SNTP sync since boot) | The corridor band; fog and misters work. Irrigation and lighting keep their own clock tests. |
| No outdoor data | The intake probe on the controller's own sensor bus takes over from the weather station; with neither fresh (600 s) there is no drying with outdoor air. |
| Wall probes invalid | The case sensor, less its 1.6 F offset, for the temperature rules; fog, misters and drying hold. |
| No valid indoor temperature | By the outdoor temperature against the corridor's low edge: vent and lead fan, or the electric heater, or every relay off with no fresh outdoor reading; fog and misters off; the manual runs stay effective; a critical alert. |
| No indoor temperature and no outdoor reading | Every climate relay off; the sensor-bus restart comes after 10 minutes, then at most every 60 minutes while it lasts. |
| Disconnect from the host | The gap log keeps the last 24 hours in flash: one climate record a minute and every relay transition, one NVS key per quarter hour. On reconnect the controller replays the quarters the ingestor did not see live, and the ingestor writes them in by their record time. |

Lighting is the one subsystem that cannot run alone: the lights are switched through Home Assistant.

**The gap log in more detail** (`gap_log.h`, format version 2). Each quarter hour is collected in RAM and written
once, when it closes or at a clean shutdown, into its own NVS key; 96 keys make a 24-hour ring, so a power cut loses
at most the open quarter. A quarter is marked live when the recorder (the ingestor's API connection) was attached for
all of it; only quarters that were not live are replayed. A replay pass starts once the recorder has been connected
for 60 s, its connection has nothing queued and the heap has room, sends one line every 250 ms or slower on the "Gap Replay" text sensor, and
advances the controller's drained mark only after the connection has stayed up for another 60 s, so the host
receives every quarter at least once. The ingestor writes a replayed record only where no live row stands, and
records each quarter it has written in the ledger `gap_replay_quarters` (migration 314) in the same transaction;
`v_data_gaps_unreplayed` shows outages with the replayed minutes cut out. The log arms at boot only with an NVS
partition of at least 400 KB and at least 25 % free entries, and stops, saying why on "Gap Log State", under 15 %
free, after three quarter writes in a row over 200 ms, or on an NVS error.

---

## 7. What the controller publishes

- **Law state record** (`climate_law_state`): latch and request bit masks, the drying refusal, the drying cost, the
  limit, whether the band check repaired the band, and the band the law used. Published on change (at most every
  5 s) and on a 60 s heartbeat.
- **Drying meter** (`climate_drying_meter`): seconds of drying, water and heat carried out, seconds wanted and
  refused. Counts from 0 at every boot.
- **Relay counters** (`relay_counters`): lifetime starts per relay and fan run seconds, persisted. The daily record
  is built from relay events; the counters are the independent check.
- **Outdoor source** (`station`, `intake`, `none`), **band source** (`onchip_curve` or `corridor`), `sntp_valid`,
  and the **constants hash** (`climate_law_constants`), compared with the release's hash by the host.
- **Controller health**, each per minute: free heap minute low, largest heap block minute low, control loop worst
  time, NVS write worst time; and restart count, NVS used and free entries, main-loop stack high-water mark, WiFi
  disconnect count and API client count. A `heap_profile` and a `flash_profile` log line every 15 minutes.
- **Gap log**: "Gap Log State" (`armed` or `off:` with the reason) and the replay lines on "Gap Replay".
- **Labels for host readers that predate the law**: the mode, action and priority axis, derived from the relays
  (plan 11.1).

---

## 8. Alerts and metrics

Alert rules live in `jvallery/monitoring-stack`. The climate set keeps outcome and equipment alerts (band drift,
VPD extremes, temperature safety, stuck relays, a heater on with no power drawn #1637, staging inversion,
band divergence between controller and host, the two delivery alerts) and adds: clock unconfirmed, band from ROM, no
outdoor source, relay starts above their norm, daily review missed, constants differing from the release, running on
the case probe alone (pages after 10 minutes), no outdoor source together with a degraded indoor reading (pages),
the intake probe alone for 30 minutes, furnace saturation (#1670), controller restarts with their reset reason, and
the controller hardware budget (heap, largest block, loop time, NVS, gap log not armed). An alert never pages for a
value the controller does not use. Metrics for every dimension are exposed through the operator API's `/metrics`
and shown on the estate's generated dashboards.

---

## 9. Changing things

| To change | Do this | Firmware release? |
|---|---|---|
| The band | The band editor on the dashboard (`PUT /band/profile`), which writes `crop_band_anchors` | No |
| The drying cost limit | The setting `dry_cost_limit_kwh_per_kg`, written by a signed-in dashboard operator | No |
| Occupancy inhibit, out-of-service switches | The dashboard (agents may write only these operator switches) | No |
| A manual run | The panel buttons, or the dashboard's timed manual actions | No |
| Irrigation programs, schedules, lines, the soft water budget | The dashboard water pages or the MCP irrigation tools | No |
| Lighting | The dashboard lighting settings and timed light switches | No |
| A law constant | Edit `verdify_schemas/climate_law.yaml`, run `scripts/gen-climate-law-constants.py`, then the firmware gates | Yes |
| Firmware logic | Edit `firmware/**`, run the gates in [`firmware-fsm-spec.md`](firmware-fsm-spec.md) section 12, then the signed flash path ([`runbooks/firmware-signed-artifacts.md`](runbooks/firmware-signed-artifacts.md)) | Yes |

The band rows, the zone priorities, the drying cost limit and `manual_override_timeout_min` are owner-only: the
settings service refuses a write from anyone but a signed-in dashboard operator (`OWNER_ONLY_PARAMS` in
`verdify_schemas/tunable_registry.py`). An agent may write only `AGENT_SETTABLE_PARAMS`: the occupancy inhibit and
the two light circuits' out-of-service switches.

---

## 10. Invariants

- **Single writer.** The production ingestor is the only thing that writes the controller: `replicas: 1`,
  `strategy: Recreate` and the writer Lease. The controller accepts several API connections, so it is not a fence
  itself. Never open a second writer.
- **Device-write gate.** `VERDIFY_DEVICE_WRITE_ENABLED=1` only in `overlays/prod`.
- **Protection.** At 100 F and 40 F the law's protection runs whatever the band, the band check or a manual run:
  every manual latch is cleared at a limit.
- **No substituted readings.** A missing reading is missing; the controller never controls on a made-up value.

---

## 11. Known limits

- Temperature is house-wide; per-zone temperature would need hardware.
- A gas outage in winter exceeds what the electric heater can hold; no controller changes that.
- No battery clock: after a power cut with no time server, the band is the corridor, irrigation starts no scheduled
  run and lighting switches both lights off until time returns. Gap log quarters written without a trusted clock
  are placed in time by the host only once a later quarter or replay of the same boot carries the clock offset.
- The doubly blind state (every indoor probe and the intake probe lost with the weather station also missing) turns
  every climate relay off; an indoor sensor independent of the sensor bus is later hardware work (#1721).
- In a sensor fault a manual fan run holds both heaters for its whole timeout (up to 120 minutes), and the 40 F
  clear cannot fire without a temperature.

---

## 12. Pointers

- Design and decisions: [`design/climate-refactor-plan-2026-11-15.md`](design/climate-refactor-plan-2026-11-15.md),
  sections 4 (the law), 4.9 (running alone), 7 (the reviewer), 8 (changes by layer), 11.5 and 12.4 (execution
  decisions).
- Constants: [`climate-law-constants.md`](climate-law-constants.md), generated from
  `verdify_schemas/climate_law.yaml`.
- Firmware internals: [`firmware-fsm-spec.md`](firmware-fsm-spec.md). Value contract:
  [`firmware-control-contract.md`](firmware-control-contract.md).
- Firmware: `firmware/lib/climate_law.h`, `climate_law_glue.h`, `running_alone.h`, `greenhouse_solar.h`,
  `gap_log.h`, `firmware/greenhouse/controls.yaml`.
- Host: `ingestor/tasks/dispatcher.py`, `ingestor/tasks/band_anchors.py`, `ingestor/esp32_push.py`,
  `ingestor/gap_replay.py`, `verdify_schemas/band_profile.py`, `verdify_schemas/tunable_registry.py`.
- Reviewer: [`planner/planner-io-schema.md`](planner/planner-io-schema.md).
- Operating: [`runbooks/laptop-operator.md`](runbooks/laptop-operator.md),
  [`runbooks/prod-promotion.md`](runbooks/prod-promotion.md).
