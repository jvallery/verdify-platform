# Climate control refactor plan, 2026-11-15

Status: a plan. Nothing in it has been applied: no code, setting, database object or device was changed to write it.

It updates sections 10 to 12 of the [control effectiveness review](../reviews/greenhouse-control-effectiveness-review-2026-11-15.md) after the owner set ten constraints for the design on 2026-11-15, and replaces them where they differ. It covers climate control only: the two heaters, the two fans, the vent, the fogger and the misters when they are used for humidity. Irrigation control and lighting control stay as they are (sections 8.7 and 8.8 list what must not be touched).

Simulated figures are printed as "model A / model B". A and B are the two fitted variants of the house model from the review (section 9.1 there); they differ mainly in how much moisture the house produces, which is not measured. Every simulated figure is for the weather year 2025-11-16 to 2026-11-15 and should be compared only with other simulated figures. The simulator, the scenario definitions and the result files are in [control-review-2026-11-15/](../reviews/control-review-2026-11-15/README.md), and every simulated figure in this document is taken from those result files.

## 0. Summary

**The proposal.** Replace the climate control stack with one control law that runs on the controller, is the same at every hour and in every season, and reads only the band. The band stays what it is today: four edges (temperature low and high, VPD low and high) that follow the sun through anchors stored on the controller. Inside the band only the electric heater works steadily, holding a line near the low edge so that the furnace is the second stage. Every other action starts at an edge or just beside it (the furnace 0.5 F and drying 0.05 kPa inside it, cooling and fog at the edge, the second fan and the misters beyond it) and stops a fixed margin inside. The law has no modes, no clock or season tests and no settings a planner can change. This is the floating corridor that ADR-0004 accepted on 2026-06-18, implemented directly instead of approximated through modes. Section 4 gives the rules in full and appendix A lists the whole law in about 25 lines; the reference implementation is about 170 lines.

**What it does in simulation, on today's band.** It holds both temperature and VPD inside the band 88.0 / 74.2 % of the year against 70.5 / 59.6 % for today's firmware, with 63 / 72 % fewer relay starts (50 / 40 a day against 135 / 142).

**What it does not do by itself.** At the same band the law runs the equipment about as many hours as today's firmware and uses a little more of each utility (+4 / +8 % electricity, +4 / +1 % gas, +9 / +16 % water), because today's firmware saves them by leaving the band. A controller cannot hold a temperature for less heat than the house loses at that temperature. Run hours and utility use are set by where the band's edges are. The law also humidifies dry winter hours that today's firmware leaves dry, so on today's band winter fog water rises from 26 / 4 to 59 / 11 gallons a day; the VPD high edge is the lever. With three small edits to the band the law is below today's firmware on every count the constraints name, except electricity in model B, which is level (21.1 against 21.0 kWh a day):

| Year, simulated, model A / B | Both in own band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware, today's band | 70.5 / 59.6 | 57 / 38 | 135 / 142 | 24.5 / 28.2 | 19.6 / 21.0 | 2.18 / 2.70 | 63 / 56 |
| The law, today's band | 88.0 / 74.2 | 75 / 50 | 50 / 40 | 24.0 / 29.5 | 20.3 / 22.8 | 2.26 / 2.74 | 68 / 65 |
| Today's firmware, band 2 | 75.6 / 63.0 | 62 / 42 | 96 / 114 | 21.6 / 25.2 | 18.5 / 20.0 | 1.92 / 2.49 | 32 / 37 |
| The law, band 2 (three small band edits, section 5.7) | 88.0 / 74.1 | 75 / 50 | 39 / 36 | 21.4 / 27.1 | 18.3 / 21.1 | 1.95 / 2.52 | 34 / 39 |

Band 2 is: the low temperature edge 2 F lower at solar noon and sunset, the VPD high edge 0.10 kPa higher, and the high temperature edge 2 F higher at solar noon and sunset. Against today's firmware on today's band, the law on band 2 makes 71 / 75 % fewer relay starts and changes run hours by -12 / -4 %, electricity by -7 / 0 %, gas by -10 / -7 % and water by -45 / -31 %, while holding its band 88.0 / 74.1 % of the year. That saving is the band's, not the law's: on band 2 itself the law uses about as much as today's firmware does there (run hours -0.2 / +1.9, kWh -0.2 / +1.1, therms +0.03 / +0.04, gallons +3 / +1 a day). What the law adds on any band is the compliance and the cycle count. Whether to edit the band is the owner's decision (decision 9); section 5.7 prices each edge.

**What changes around the law.**

1. The controller runs alone. The law needs its own sensors, its stored anchors and a clock; outdoor data is optional. A small firmware release ahead of the law removes what breaks isolated operation today: the reboot every five minutes while WiFi is down, the trust in a wrong clock, and substituted sensor readings (section 4.9).
2. Outdoor air is used for drying under one rule. A drying run starts on heat the house has to spare, and never on furnace heat unless the owner allows a cost: the heat carried out per kilogram of water carried out, which the controller computes each second and which translates into how cold and damp it may be outside. Some of the heat a run spends is still replaced by the furnace later (+0.01 / +0.04 therm a day, simulated). The controller meters the hours, the water and the heat (section 4.5).
3. The electric heater leads the furnace by threshold, the fan with fewer run hours leads, the second fan joins on a fixed rule, and misters opted in for VPD are a second humidifying stage behind the fogger (sections 4.6 to 4.8).
4. Forecast rules were tested with perfect foresight. Acting early (pre-heating, pre-cooling, pre-drying) saves at most 0.01 therm a day and costs electricity or relay starts. Holding the electric heater's lines 1 F lower while the sun is on the house or due within 3 hours does save: 0.9 / 1.0 kWh a day, at a cost of 0.04 / 0.03 therm of gas. Of that saving, 70 / 75 % needs only the present sun and no forecast. The first release has neither rule. Both are put to the owner as decision 15, and the forecast-action engine is removed (section 6).
5. The planner stops writing climate values. It becomes a daily reviewer that reports and proposes band edits; its irrigation tools stay (section 7).
6. Everything the law makes unnecessary is deleted in every layer: on the controller the mode logic (about 2,100 lines), 100 of 102 climate settings and 130 of 148 climate readbacks; on the host the planner's 48 writable settings, the moisture guardrail, the forecast engine and the experiment code; in the database about 80 tables and about 3.1 GB, with about 0.7 GB more saved by storing readbacks only when they change (section 8).

**Decisions needed from the owner** are in section 12. Four shape the work: the drying cost limit (1), whether to ship the review's small firmware patch this winter or go straight to the law (3), the planner's role (4) and whether to edit the band (9).

**A correction to the review.** The review's simulator limited humidity misting under today's firmware to a daytime window and to 65 F and above. The firmware has no such limit. With it removed, today's firmware simulates at 70.5 / 59.6 % in band with 135 / 142 relay starts and 63 / 56 gallons a day; the review printed 71.8 / 60.6 %, 125 / 132 and 56 / 54. The review's step 1 and step 2 figures move by 0.1 point or less. This plan uses the corrected figures throughout, and the review carries a dated note.

**Limits.** The evidence for the law is a simulation fitted to this house, checked against one year of weather and two model variants. The plan's acceptance step is a measured comparison on the controller with rollback (section 13). Section 14 lists what the simulation does not cover.

## 1. The ten constraints and how the plan meets them

| # | Constraint | In the plan | Evidence |
|---|---|---|---|
| 1 | P0: the controller holds the house through network loss, with no outside input | The law reads only the controller's sensors, anchors and clock. Constants are compiled and anchors are stored in flash. Outdoor data is optional; the controller hears the weather station on the LAN itself and has a wired probe as second source. A defined band when there is no clock. No reboot on WiFi loss. | Section 4.9. Held for a whole year without outdoor data the law keeps 83.3 / 64.1 % (today's firmware 62.8 / 51.8 %); with no clock 52.6 / 41.8 % (today 10.3 / 31.2 %). Isolation drill in section 13. |
| 2 | No hardcoded exceptions, time of day and so on | One law with no branch on the hour, the solar phase, the date, the season, the zone or the weather. Every threshold is an offset from a band edge. The night dry-out machine, the economiser, the temperature and humidity gates on fog and the night-only branches go. What stays fixed is two protection limits (100 F and 40 F) and about 40 compiled numbers, each listed with its sweep. | Sections 4.2, 4.4 and 4.10. Whether compiled numbers are acceptable is decision 13. |
| 3 | Fewer on/off cycles, less run time, less utilisation | Cycles: every action but the electric heater's starts at an edge or just beside it; exit margins sized by sweep; one minimum on and off time per relay class; the electric heater stays on through furnace cycles. Run time: about equal at the same band, lower on an edited band. | 50 / 40 starts a day against 135 / 142 (section 5.4). Run hours -0.4 / +1.3 a day on today's band. On band 2, -3.0 / -1.0 against today's firmware on today's band and -0.2 / +1.9 against today's firmware on band 2 (sections 5.5 and 5.7). |
| 4 | Less utility use | A drying run starts on spare heat only, no pre-staging, no heater cut during drying, and a price for every band edge. At the same band the law uses a little more, because it holds the band; the saving comes from the band edits, which are the owner's (decision 9). | Sections 5.5 and 5.7 |
| 5 | Electric heat before gas where possible | The electric heater switches at low+3.5 / low+4.5 and the furnace at low+0.5 / low+3.0, so the furnace starts only when the house has fallen 3 F below the electric heater's line with that heater on. | Section 4.6: 1.7 / 1.8 furnace hours a day less in winter than with the electric heater on the furnace's side of the swing. Today's firmware already runs the electric heater 19 / 20 hours a day in winter; against it the law's winter gas is +5 / +1 %, because the law keeps the house off the low edge. |
| 6 | Fans alternate and escalate, equal wear | The fan with fewer accumulated run seconds leads each time both are off; the second fan joins at high+1.5; run seconds persist across reboots. | Section 4.7: 1.60 / 2.45 and 1.58 / 2.46 hours a day |
| 7 | Full control of heat1, heat2, fan1, fan2, fogger, vent and opted-in misters | The law drives the six relays every second and requests mister pulses through the irrigation engine for the lines opted in for VPD. No planner switch or host guardrail sits in between. The irrigation interlocks on the wet relays, occupancy and the manual overrides stay (section 4.3). | Sections 4.2, 4.3, 4.8 |
| 8 | Outdoor air for drying, within reason, measurable | A drying run starts when the house has heat to spare. Below that it may start only while the heat carried out per kilogram of water is within a limit, one stored number that the owner sets. It ships at 0, the nearest the law comes to the owner's rule of 2026-11-05 that gas never runs for humidity: the furnace never starts a drying run, but it replaces some of the heat afterwards (+0.01 / +0.04 therm a day). 0.7 would mean above about 38 F outdoors with dry air, 1.0 above about 20 F. That rule's nightly 10 kWh cap goes; the controller meters hours, water and heat instead (decision 1). | Section 4.5 |
| 9 | Keep the diurnal, solar-aligned band | Unchanged: the same anchors and curve, computed on the controller. One definition of the curve per runtime, tested against the same vectors. | Sections 3 and 9 |
| 10 | Use the forecast to pre-stage if it saves resources | Tested with perfect foresight. Acting early (pre-heat, pre-cool, pre-dry) saves at most 0.01 therm a day, for more electricity, and pre-cool and pre-dry add starts and run hours. Holding the electric heater's lines 1 F lower while the sun is on the house or due within 3 hours does save: 0.9 / 1.0 kWh a day at a cost of 0.04 / 0.03 therm of gas, and of that 0.6 / 0.7 kWh needs only the present sun. Holding the furnace's off line down as well saves 0.7 / 0.7 kWh and 0.04 / 0.03 therm for 1.7 / 1.9 more furnace starts. Not in the first release; offered as decision 15. A lower daytime low edge is the larger lever of the same kind and needs no forecast (decision 9). The forecast stays for the reviewer and the dashboard. | Section 6 |
| - | Irrigation and lighting control remain | Out of scope, and listed line by line where the refactor touches shared code. | Sections 8.7 and 8.8 |

## 2. Principles

1. **The band is the policy.** What the house should be, at each point of the solar day, is the band. The owner edits the band and one price: how much heat may be spent to carry out a kilogram of water (section 4.5). Nothing else changes with time, season or weather.
2. **The controller decides alone.** Every input the law needs is on the controller. The host stores, shows, grades and alerts; it never has to arrive for the house to be held.
3. **One law, relative to the band.** A threshold is a fixed offset from a band edge. There is one set of constants and they are compiled.
4. **Act at the edges.** The law does not steer toward a target. Inside the band only the electric heater works steadily, holding a line near the low edge; everything else starts at an edge or just beside it. This is what removes most relay cycles.
5. **A thing is defined once.** One band curve per runtime, one constants file, one compliance definition, one store for the band (section 9).
6. **Delete what does not run or has no measured effect.** A setting that never changes is a constant; a constant needs no readback; a path nothing calls is removed.
7. **Measure what the constraints ask for.** Relay starts, run hours, kWh, therms and gallons are recorded per day, and the acceptance of each step is stated in those numbers (sections 10 and 13).

## 3. Target architecture

### 3.1 What each layer does

| Layer | Does | Does not |
|---|---|---|
| Controller (ESP32 firmware) | Reads its sensors. Computes the band from its stored anchors and its clock. Runs the law every second. Drives the six climate relays and requests mister pulses from the irrigation engine. Runs the irrigation engine and the lighting decisions as today. Publishes sensor values, relay states, the law's state and per-relay counters. | Take any climate setting other than the band anchors, the drying cost limit and the operator switches. Depend on a push after a reboot. |
| Ingestor (the only device writer) | Stores telemetry. Pushes the band anchors and the drying cost limit when the owner changes them or the controller's copy differs. Pushes operator switches. Delivers irrigation programs, irrigation commands and lighting values as today. Grades compliance. Raises alerts. | Read a plan, clamp values, or push defaults. |
| Database | Telemetry, relay events, the band anchors, the operator settings store, compliance, the daily record of cycles, hours and utilities, alerts; the irrigation and lighting objects. | Hold plans, planner waypoints, clamps, forecast actions or experiment ledgers. |
| API, MCP, dashboard | Show state. Let the owner edit the band, the operator switches, irrigation and lights. | Offer a write path for climate actuator settings, or let an agent write the band. |
| Reviewer (Iris) | Reads the record once a day, writes a short review, proposes band edits with their simulated price, and keeps its irrigation tools. | Write any climate value to the controller, the band included. |

### 3.2 What crosses the wire for climate

| Direction | Item | Count | Stored on the controller |
|---|---|---|---|
| To the controller | Band anchors: four edges at four solar points (sunrise, solar noon, sunset, solar midnight) | 16 (24 while the two target curves stay, decision 6) | Yes, in flash. The ROM copy is today's deliberate dry-side view of the committed band file and is used only on a chip whose flash is empty (section 9). |
| To the controller | The drying cost limit (section 4.5) | 1 | Yes, in flash; the ROM copy is the released value |
| To the controller | Occupancy state and the occupancy inhibit switch | 2 | State expires after 60 minutes, as today |
| To the controller | Manual overrides (fan burst, humidify burst, vent bypass) with their timeout | as today | No |
| To the controller | Time (SNTP from the two local servers) | - | A battery clock chip if decision 8 is taken |
| From the controller | Sensor values, relay states, anchor readbacks, the law's state, per-relay start and run-second counters, the drying meter, firmware version and a hash of the compiled constants | - | Counters persist |

The 24 lighting values, the irrigation programs and commands and the soft water budget cross the same wire and are unchanged. Today the wire carries 128 settings and 187 readbacks (review section 6.3). Of those, 102 settings and 148 readbacks belong to climate control; that split is from the inventory made for section 8.

## 4. The control law

### 4.1 Inputs

- Indoor temperature, VPD and dew point: the average of the valid probes, as today.
- The band now: `low` and `high` (F), `vpd_low` and `vpd_high` (kPa), computed on the controller from the anchors and the solar phase, as today.
- Optional: outdoor temperature and dew point, each with its age. The first source is the weather station, whose LAN broadcast the controller receives directly. The second is the wired intake probe on the controller's own sensor bus; it is live today, feeds only the economiser, and gets its own age stamp (it has none). With neither fresh, there is no outdoor data.

**Band validity.** The law needs a band in which the on and off lines of opposing actions do not overlap: the electric heater's off line at or below the cooling off line (a band at least 6.5 F wide), and the drying off line at or below the fogger's off line (at least 0.35 kPa wide). That is stricter than the 5.5 F and 0.20 kPa below which two opposing actions could be latched on together. Today's band is 10 F and 0.43 kPa wide. Both widths are sums of the law's own margins and are generated with the constants. The band editor accepts any width today; it will refuse a narrower band. The controller's own band check (`validate_setpoints`, `firmware/lib/greenhouse_types.h:864-895`) today repairs an inverted band with gaps of 5 F and 0.1 kPa, keeps the temperature edges 5 F inside the protection limits (45 to 95 F) and holds the VPD edges between 0.1 and 5.0 kPa. It gains the two widths and the editor's VPD limits (0.3 to 3.0 kPa), and it widens a narrower band about its middle, so a corrupted anchor cannot make the law fight itself. The widening is not in the reference implementation, because no simulated band needed it; it is firmware work with its own tests. Both checks, the editor's and the controller's, ship before or with the law (phase 3), because the law has no floor or width of its own.

**The night floor.** The owner's night goal is a VPD of at least `max(vpd_low, 0.74)` kPa. The band curve is a smooth curve through the anchors, so between solar midnight and sunrise today's low edge dips to about 0.72 kPa, below its 0.738 anchor. The law starts drying 0.05 kPa above the low edge, so what it holds is about 0.77 kPa at the dip. The editor's floor check moves from the midnight anchor, where it is today, to the curve: the drying line (`vpd_low + 0.05`) must be at or above 0.74 kPa at every point of the night. Today's band passes. The controller then needs no 0.74 of its own, and the grade keeps the owner's definition (decision 10).

### 4.2 The rules

The same rules apply at every hour, in every season.

Temperature:

1. **Electric heater** on below `low + 3.5`, off above `low + 4.5`.
2. **Gas furnace** on below `low + 0.5`, off at `low + 3.0`. It never runs with the vent open.
3. **Cooling** (vent open, lead fan) on above `high`, off below `high - 2.0`. The electric heater is off while cooling.
4. **Second fan** on above `high + 1.5`, off below `high`.

Humidity:

5. **Fogger** on above `vpd_high`, off below `vpd_high - 0.15`.
6. **Misters** opted in for VPD join above `vpd_high + 0.30` and leave below `vpd_high + 0.05`. One line pulses at a time, 60 s on with a 45 s gap. The irrigation engine grants each pulse and picks the line (section 4.8).
7. **Drying with outdoor air** (vent open, lead fan) is wanted below `vpd_low + 0.05` until above `vpd_low + 0.20`. It runs only while all three hold:
   - outdoor data is fresh and the outdoor air is drier: its dew point is at least 3 F below the indoor dew point (it stops when less than 1 F below), and it holds at least 0.1 g/kg less water;
   - the house has heat to spare: temperature at or above `low + 3.5`, or at or above `low + 1.0` while the cost of drying is within the limit of section 4.5; it stops below `low + 0.75`;
   - the house is not cooling and the furnace is off.

   No fog or mist while drying. Drying does not switch the electric heater off: the heater keeps following rule 1.

Protection, independent of the band:

8. At or above 100 F: vent open, both fans on, both heaters off. The fogger and misters keep following rules 5 and 6, as today's firmware does at this limit.
9. At or below 40 F: both heaters on, vent closed, fans, fogger and misters off. Today's firmware also runs a fan in this state; the law does not (decision 12).

Rules 8 and 9 are backstops. With a valid band (edges within 45 to 95 F) rules 1 to 4 have already asked for the heating or cooling they ask for, so they add something only when the band is corrupt, a reading is wrong or the equipment cannot hold the house: with the furnace out, the house reaches 40 F in winter (section 5.8). Rule 9 also stops the fogger and the misters. They are tested with a band that bypasses validation.

The fogger may run with the vent open, so on a hot, dry afternoon rules 3 and 5 together give evaporative cooling without a rule of their own.

**On the case sensor alone.** When the wall probes are invalid and only the case sensor is left, today's firmware stops controlling humidity, because that sensor's humidity is not representative. The law does the same: rules 1 to 4, 8 and 9 run on the case sensor and rules 5 to 7 hold. The case sensor reads warmer than the wall probes (about 4 F in the record), so the temperature rules use its reading less a compiled offset, the median difference measured against the wall probes at the release. Without the offset the house would be held about that much below what the band asks. This state is not simulated; it is a host test in phase 2.

### 4.3 The relay layer

Between the law's requests and the relays there is one small layer. It replaces today's conflict arbitration (`arbitrate_relay_conflicts`), whose rules cut both heaters when the vent or a fan is on (except in cold protection and in the drying mode), make the furnace wait for the electric heater, and give the vent priority over the furnace. The layer below is the one the simulation used.

- A minimum on time and a minimum off time per relay: 300 s and 300 s for the two heaters, the fans and the vent; 120 s and 120 s for the fogger. At boot every relay is available at once. Today the timers start at zero, which holds the heaters off for 180 s after every restart.
- A fan runs only with the vent open: the vent opens first and the fan follows on the next pass. The vent stays open while a fan runs.
- The furnace and the vent are never on together. The vent and fans wait until the furnace has finished its minimum on time and stopped; the furnace waits until the vent has closed. The furnace is never cut short for drying or cooling.
- The electric heater is not cut when the vent opens to dry. Today the night dry-out switches it off for the first 180 s of each pulse (issue #1675).
- The lead fan is the fan with fewer accumulated run seconds, chosen each time both fans are off (section 4.7).
- The law never switches a mister valve. It asks the irrigation engine for a pulse (section 4.8).

A minimum time is cut short only in these cases:

| Case | What is cut | Status |
|---|---|---|
| 100 F limit | The furnace is switched off at once and the vent does not wait for it | New in this form; today's firmware does the same through its safety mode |
| No valid indoor reading | The safe state of decision 7 is taken at once | New. Today the controller substitutes 65 F and 50 % and keeps controlling on them (section 4.9) |
| Fertiliser master open or the fertigation line holding, a drip relay on, occupancy, sensor fault | Fogger and misters off at once, in every state | As today |
| The irrigation engine's drip in progress, the soft water budget (not during a VPD emergency), the daily water safety cap | Fogger and misters off at once, except at the 100 F limit, where fog is counted and not capped | As today |
| Manual overrides | Force a relay on or off | As today |

The first row is in the simulated layer. The others are holds that the simulator does not model (section 14). At the 40 F limit nothing is cut short: a vent or fan still inside its minimum on time finishes it, and the furnace starts once the vent has closed. With a valid band the vent cannot be open at 40 F, so this matters only for a corrupt band.

### 4.4 The constants

The law has no exception: no branch on the hour, the solar phase, the date, the season or the zone. It does have fixed numbers. They are compiled into the firmware from one generated file (section 9), have no readback, and the firmware reports one hash of them. A compiled number cannot be lost at a reboot, delivered wrongly or left unconfirmed, and changing one is a firmware release, which this repository can ship at any time. That they are fixed, and not settings, is decision 13.

| Constant | Value | What the sweep says (section 5.6; year, model A / B, difference from the law) |
|---|---|---|
| Electric heater on / off above `low` | 3.5 / 4.5 F | Its lines sit above the furnace's off line so that it stays on through furnace cycles. Moving both lines 0.5 F up: +0.70 / +0.56 kWh and -0.032 / -0.029 therm a day. Moving them 0.5 F down with the furnace unchanged: -0.78 / -0.71 kWh and +0.035 / +0.019 therm. The position trades electricity for gas, 0.7 / 0.7 kWh of electricity for each kWh of gas burned. In heat delivered to the house it is 2.1 / 1.7 kWh of electric heat for each kWh of furnace heat, because the higher line also holds the house warmer (section 4.6). |
| Furnace on / off above `low` | 0.5 / 3.0 F | On at 0.5 keeps the house off the edge: too cold 0.6 / 0.6 % of the year against 1.9 / 2.6 % today. The off line and the heater's lines move together. One step narrower (furnace off at 2.5, heater 3.0 / 4.0): +2.1 / +2.6 furnace starts, -0.70 / -0.54 kWh and -0.046 / -0.035 therm a day (decision 2). |
| Cooling off below `high` | 2.0 F | At 1.5: +1.2 / +0.8 starts a day. At 3.0: +0.74 / +0.70 run hours a day. |
| Second fan on above `high` | 1.5 F | At 0.5: +0.1 / +0.1 starts a day. At 3.0: -0.1 / -0.6 starts a day and -0.01 / -0.05 point. |
| Fogger off below `vpd_high` | 0.15 kPa | At 0.10: +4.5 / +2.6 starts a day. At 0.20: +5.2 / +2.1 gallons a day. |
| Misters join / leave above `vpd_high` | 0.30 / 0.05 kPa | The fogger alone holds the edge almost all the time; without misters compliance changes by 0.00 / -0.11 point. |
| Drying on / off above `vpd_low` | 0.05 / 0.20 kPa | Starting at 0.10: +4.5 / +4.6 starts a day. Starting at the edge: -0.1 / -0.4 point. |
| Drying start / stop above `low` | 3.5 / 0.75 F (start at 1.0 within the cost limit) | 3.5 is the electric heater's on line and is generated from it. Section 4.5. |
| Outdoor dew point below indoor to start / stop | 3 / 1 F | A single 2 F margin: +6.6 / +6.1 starts a day. |
| Least outdoor moisture difference | 0.1 g/kg | Guards the division in the cost. |
| Air pressure for the humidity ratio | 85 kPa | The firmware's compiled site value. |
| Drying cost limit (stored, not compiled) | 0 kWh of heat per kg of water | The owner's to set: section 4.5 and decision 1. |
| Protection limits | 100 F and 40 F | Today's values. |
| Minimum on / off: heaters, fans, vent | 300 / 300 s | Fans and vent at 180 s: +0.2 / +0.5 starts a day; at 120 s: +0.2 / +0.9. Heaters at 180 s: no difference at all; in a simulation without sensor noise a heater cycle is longer than either value. |
| Minimum on / off: fogger | 120 / 120 s | At 60 s: +1.5 / +0.8 starts a day. At 180 s: -0.4 / -0.1 point and +15.1 / -1.6 starts a day. |
| Mister pulse / gap | 60 / 45 s | Today's compiled defaults. Production runs pulses of 30 to 90 s with gaps of 18 to 60 s that the planner sets. |
| Outdoor data maximum age, station and intake probe | 600 s | Today's value for the station. Not exercised in the simulation, which has outdoor data for a whole run or not at all. |
| Minimum band width | 6.5 F and 0.35 kPa | Derived (section 4.1). |
| Band limits | 45 to 95 F, 0.3 to 3.0 kPa | The editor's existing limits. |
| Fan run-second save interval | 3,600 s | Section 4.7. |
| Sensor-bus restart, no probe update for | 3,600 s | Today's value (section 4.9). |
| Occupancy expiry | 60 minutes | Today's value. |
| Case sensor offset | The median difference from the wall probes at the release (about 4 F) | Used only when the wall probes are invalid (sections 4.2 and 4.9). Not simulated. |
| Kept for the irrigation engine: VPD emergency, dew-point margin for wetting, mister line minimum off, mister zone ranks | 2.5 kPa, 8 F, 45 s, centre first | Section 8.7. Each is taken from the controller's readback at the release, so that irrigation does not change. The dew-point margin is the larger of today's day and night values, with no night test. |

About 40 numbers in all. Section 5.6 shows the sweeps for the year and by season. Outside the heating lines no change to a margin gains more than 0.2 point of compliance over the year, 0.1 in winter or 0.4 in summer, which is the evidence that one value can serve the whole year. The heating lines are a trade that the owner decides (decision 2): lower lines save energy for more furnace starts, and in model B they also gain up to 1.6 points of winter compliance, because the line above which drying may start moves down with them.

### 4.5 Drying with outdoor air, "within reason" (constraint 8)

Bringing in outdoor air to dry the house carries heat out with the water. Per kilogram of water carried out, the heat carried out is

`e = 1.006 x max(0, (T_in - T_out) / 1.8) / (w_in - w_out) / 3.6`    kWh per kg

with temperatures in F and `w` the humidity ratio in g/kg. The air flow cancels, so `e` depends only on the indoor and outdoor air, both of which the controller measures. Outdoor air warmer than the house gives `e = 0`. When the outdoor air holds less than 0.1 g/kg less water than the indoor air there is no drying at all.

The table gives `e` for a house at 62 F and 0.79 kPa, about where a winter night sits. It is computed from the formula with the firmware's vapour-pressure function at the site's 85 kPa, not simulated.

| Outdoor temperature | `e` at 50 % outdoor RH | `e` at 70 % outdoor RH |
|---|---:|---:|
| 50 F | 0.51 | 1.00 |
| 40 F | 0.67 | 0.88 |
| 30 F | 0.81 | 0.94 |
| 20 F | 0.95 | 1.03 |
| 10 F | 1.10 | 1.16 |
| 0 F | 1.26 | 1.29 |

So `e` is the deterministic measure the constraint asks for: one number, computed each second, that says how much heat a kilogram of drying throws away. It rises as the outdoor air gets damper, and in dry air it rises as the air gets colder. In damp air it is high in mild weather too, because little water is carried out. A limit on `e` is a statement about how cold and how damp it may be outside. A warmer house lowers `e`: at 66 F it is 0.1 to 0.4 lower, most in mild, damp air.

The rule is in two parts.

- **Drying on spare heat.** When the house is at or above `low + 3.5`, the electric heater's on line, the house is being held by the electric heater or the sun. A drying run may start there whatever `e` is, and it stops at `low + 0.75`, above the furnace's on line. On a cold night the house is seldom at that line: the furnace holds it between `low + 0.5` and `low + 3.0`, so this part seldom runs. This is what keeps drying "within reason" with no setting at all. It is not free of gas: a run spends the heat stored between its start and stop lines, and on a night when the furnace runs afterwards the furnace replaces part of it.
- **Drying below that line.** Between `low + 1.0` and `low + 3.5` drying may start only while `e` is at or below the limit. Here the furnace is what restores the house: drying stops at `low + 0.75`, and if the house cools to `low + 0.5` an ordinary furnace cycle lifts it again. The limit is checked when drying starts; a run that started within it continues if the outdoor air turns colder, until one of its stop conditions.

**The limit is 0 as shipped.** At 0 the second part runs only when the outdoor air is at least as warm as the house, where drying costs no heat. That is as close as the law comes to the owner's rule of 2026-11-05 (the amendment to ADR-0004): energy is spent for the night floor through ventilation backed by electric heat, within a nightly cap of 10 kWh, and gas never runs for humidity. Under the law the furnace never starts a drying run and never runs during one, and the machinery around the rule goes: the night-only test, the pulse and rest timers and the forced heater cut. Two things differ from that rule, and decision 1 puts both to the owner.

- **Gas is not strictly zero.** Part of the heat a run spends is replaced by the furnace afterwards: +0.01 / +0.04 therm a day over the year and +0.01 / +0.05 in winter, against never drying. The higher the stop line, the less of a run falls inside the furnace's swing, and at `low + 3.0` none of it does. That stop line leaves -0.003 / +0.013 therm a day against never drying, for 0.1 / 1.5 points of compliance and 1 / 3 dried nights in a hundred. Lower stop lines remove less:

| Drying on spare heat, limit 0 | Both in band % | Nights dried % | Therms/day | Furnace starts/day | Vent starts/day | Drying hours/day |
|---|---:|---:|---:|---:|---:|---:|
| Never dry with outdoor air | 83.3 / 64.1 | 66 / 31 | 2.256 / 2.700 | 8.9 / 11.8 | 3.3 / 1.2 | 0.00 / 0.00 |
| **Stop at low+0.75 (proposed)** | 88.0 / 74.2 | 75 / 50 | 2.262 / 2.740 | 9.0 / 12.1 | 5.4 / 5.0 | 1.02 / 2.03 |
| Stop at low+1.5 | 87.9 / 73.8 | 75 / 49 | 2.258 / 2.730 | 8.9 / 12.0 | 5.5 / 5.0 | 0.96 / 1.91 |
| Stop at low+2.0 | 87.9 / 73.5 | 75 / 48 | 2.256 / 2.723 | 8.9 / 12.0 | 5.5 / 5.0 | 0.92 / 1.82 |
| Stop at low+3.0, the furnace's off line | 87.9 / 72.8 | 75 / 47 | 2.253 / 2.713 | 8.9 / 11.9 | 6.0 / 5.2 | 0.83 / 1.63 |

- **The nightly 10 kWh cap is not replaced by another cap.** The law limits what a kilogram of drying may cost, not how much drying a day gets. The heat carried out is 1.1 / 1.7 kWh a day on average (0.8 / 1.1 in winter), far below the old cap; the largest single night was not tabulated. The controller meters it every day. A cap on the daily total can be added as a second stored number if the meter shows the need; it would be a counter over the last 24 hours, not a night test.

Raising the limit is the owner's decision (decision 1), and this is what each step buys and costs over the year:

| Drying rule | Both in band % | Nights dried % | Therms/day | kWh/day | Furnace starts/day | Vent starts/day | Drying hours/day | Water carried out kg/day | Heat carried out kWh/day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Never dry with outdoor air | 83.3 / 64.1 | 66 / 31 | 2.26 / 2.70 | 19.3 / 21.3 | 8.9 / 11.8 | 3.3 / 1.2 | 0.00 / 0.00 | 0.0 / 0.0 | 0.0 / 0.0 |
| **Limit 0: drying starts on spare heat only (proposed)** | 88.0 / 74.2 | 75 / 50 | 2.26 / 2.74 | 20.3 / 22.8 | 9.0 / 12.1 | 5.4 / 5.0 | 1.02 / 2.03 | 1.3 / 3.8 | 1.1 / 1.7 |
| Limit 0.5 kWh/kg | 88.6 / 79.8 | 75 / 56 | 2.27 / 2.85 | 20.3 / 22.9 | 9.0 / 12.7 | 6.1 / 8.7 | 1.09 / 2.64 | 1.6 / 6.1 | 1.2 / 2.5 |
| Limit 0.7 kWh/kg | 89.0 / 81.6 | 76 / 63 | 2.29 / 2.93 | 20.4 / 23.0 | 9.1 / 13.3 | 6.9 / 10.8 | 1.18 / 2.94 | 1.8 / 7.0 | 1.3 / 3.3 |
| Limit 1.0 kWh/kg | 89.6 / 83.3 | 77 / 66 | 2.33 / 3.04 | 20.4 / 23.1 | 9.4 / 14.0 | 8.1 / 12.9 | 1.33 / 3.25 | 2.0 / 7.8 | 1.7 / 4.2 |
| No limit | 90.1 / 83.8 | 80 / 70 | 2.37 / 3.09 | 20.4 / 23.1 | 9.8 / 14.3 | 9.4 / 13.6 | 1.46 / 3.38 | 2.2 / 8.1 | 2.0 / 4.6 |

In winter:

| Drying rule | Both in band % | Nights dried % | Therms/day | kWh/day | Furnace starts/day | Vent starts/day | Drying hours/day | Water carried out kg/day | Heat carried out kWh/day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Never dry with outdoor air | 91.2 / 70.2 | 75 / 26 | 3.67 / 4.23 | 28.4 / 29.2 | 14.9 / 20.0 | 0.2 / 0.3 | 0.00 / 0.00 | 0.0 / 0.0 | 0.0 / 0.0 |
| **Limit 0: drying starts on spare heat only (proposed)** | 93.1 / 76.7 | 81 / 43 | 3.69 / 4.28 | 29.1 / 30.4 | 15.0 / 20.3 | 0.5 / 1.7 | 0.62 / 1.13 | 1.3 / 4.1 | 0.8 / 1.1 |
| Limit 0.5 kWh/kg | 93.6 / 84.8 | 81 / 51 | 3.70 / 4.46 | 29.1 / 30.6 | 15.1 / 21.5 | 1.3 / 7.3 | 0.71 / 2.00 | 1.7 / 7.9 | 1.0 / 2.4 |
| Limit 0.7 kWh/kg | 93.9 / 87.4 | 82 / 63 | 3.72 / 4.58 | 29.1 / 30.7 | 15.2 / 22.5 | 2.5 / 10.7 | 0.81 / 2.41 | 2.0 / 9.3 | 1.2 / 3.5 |
| Limit 1.0 kWh/kg | 94.5 / 89.7 | 84 / 69 | 3.76 / 4.75 | 29.2 / 30.8 | 15.6 / 23.7 | 4.1 / 14.0 | 0.98 / 2.88 | 2.4 / 10.6 | 1.6 / 5.0 |
| No limit | 94.9 / 90.3 | 87 / 73 | 3.80 / 4.82 | 29.2 / 30.8 | 16.0 / 24.2 | 5.3 / 15.2 | 1.14 / 3.08 | 2.7 / 11.1 | 2.1 / 5.7 |

- Against never drying, the proposed rule dries 9 / 18 more nights in a hundred and holds the band 4.7 / 10.2 points more, for +1.0 / +1.4 kWh and +0.01 / +0.04 therm a day.
- A limit of 0.7 lets the furnace back drying only above about 38 F outdoors with dry air; 1.0 goes down to about 20 F and 1.3 to about 0 F. Against the proposed rule, 0.7 dries 1 / 13 more nights in a hundred for +0.03 / +0.19 therm, +0.2 / +1.3 furnace starts and +1.5 / +5.8 vent starts a day. No limit at all: 5 / 20 more nights for +0.11 / +0.35 therm a day.
- The two models disagree about what a higher limit buys, because they disagree about how much moisture the house makes. That quantity is measured in phase 1 (issue #1669), and the decision is better made after it.
- The start line of the second part, `low + 1.0`, is only 0.25 F above the stop line, and the simulation has no sensor noise. At a limit of 0 it is used only while the outdoor air is at least as warm as the house, and moving it to `low + 1.5` changes compliance by 0.00 / -0.04 point. At a limit of 0.7 the same move changes compliance by -0.2 / -1.2 point and starts by -1.5 / -4.4 a day. The line is in the noise test of phase 3 (section 13) and is the first to be raised if it chatters. The cost uses the outdoor temperature, and the intake probe may read warm (section 4.9), which makes drying look cheaper than it is; on the intake probe alone only the first part applies, whatever the limit, until the probe has been compared with the station for a season.

**One stored number.** The limit is the owner's price for a dry night, so it is the one value besides the band that is stored on the controller and can be edited. It is delivered and read back like an anchor, and its ROM copy is the released value. Everything else in the law is compiled.

**Measuring it.** The controller accumulates three numbers while drying runs: the seconds, the water carried out (from the two humidity ratios and the fan's rated flow) and the heat carried out. They are published as daily totals with the reason drying was refused when it was wanted (no outdoor data, outdoor air not drier, cost above the limit, house too cold, furnace on). The last three columns of the tables above are the same meter in the simulator. The heat carried out is the heat the heaters or the sun must replace, so it is the upper bound of what drying costs in utilities on that day. The host adds one figure from the relay record: furnace starts within 15 minutes of the end of a drying run. The water and heat figures depend on the fan flow, which is rated and not measured, so they are comparable day to day but not exact.

### 4.6 Electric heat first (constraint 5)

The electric heater's lines sit above the furnace's whole swing. In mild weather the electric heater holds the house between `low + 3.5` and `low + 4.5` alone and the furnace never starts. When the electric heater cannot hold the house, the temperature falls to `low + 0.5`, the furnace lifts it to `low + 3.0` and stops, and the electric heater has stayed on throughout. The electric heater starts 0.8 / 0.8 times a day in simulation against 11.0 / 16.8 today.

So inside the band one relay does work: the electric heater holds a line 3.5 to 4.5 F above the low edge. That is the cost of the ordering, and the sweep prices it. Moving the heater's lines down 0.5 F together with the furnace's off line saves 0.70 / 0.54 kWh a day; moving them up 0.5 F alone costs 0.70 / 0.56 kWh and saves 0.032 / 0.029 therm a day: 0.68 / 0.56 kWh more electric heat for 0.32 / 0.33 kWh less furnace heat, the rest going to a house that is held warmer. Moving them down 0.5 F alone does the reverse: -0.78 / -0.71 kWh and +0.035 / +0.019 therm a day, with +0.35 / +0.21 kWh of furnace heat in place of 0.76 / 0.70 kWh of electric heat. With the whole heating stack 1 F lower (heater 2.5 / 3.5, furnace off at 2.0) the result is -1.32 / -1.11 kWh, -0.089 / -0.059 therm and +5.3 / +6.5 furnace starts a day. The position of the lines is a choice between electricity, gas and furnace starts (decision 2).

If the electric heater is dead or unpowered the same thresholds make the furnace carry the house with no flag or setting: in simulation the law then holds 84.0 / 69.3 % of the year at 3.71 / 4.24 therms a day. An alert on "relay on, no power drawn" is still needed (issue #1637), because the heater relay ran for 209 days with no heat and nothing reported it.

What the ordering is worth, against the same law with the electric heater on the furnace's side of the swing:

| Winter (October to April) | Electric heater h/day | Furnace h/day | kWh/day | Therms/day | Furnace starts/day | All starts/day | Both in band % |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware | 19.1 / 20.2 | 4.68 / 5.67 | 28.0 / 29.2 | 3.51 / 4.25 | 16.3 / 21.3 | 89 / 84 | 79.2 / 63.5 |
| The law: electric heater first | 19.3 / 20.9 | 4.92 / 5.71 | 29.1 / 30.4 | 3.69 / 4.28 | 15.0 / 20.3 | 37 / 29 | 93.1 / 76.7 |
| Reference: electric heater on at low+1.0, off at low+2.0 (not ahead of the furnace; drying still starts at low+3.5) | 7.0 / 7.8 | 6.59 / 7.46 | 11.3 / 11.4 | 4.94 / 5.60 | 19.7 / 24.8 | 58 / 57 | 89.9 / 73.6 |

Electric first uses 18 / 19 kWh a day more electricity in winter and 1.25 / 1.32 therms a day less gas, with 37 / 48 % fewer relay starts. In the reference the drying start line stays at `low + 3.5`. The house then sits in the furnace's swing and seldom has spare heat, so winter drying falls from 0.62 / 1.13 to 0.44 / 0.68 hours a day, and part of the reference's lower compliance is that and not the ordering. The energy figures are the ordering's. The electric heater runs 19 / 21 hours a day in winter under the law and 19 / 20 under today's firmware; that is the design. Against today's firmware the law's winter gas is +5 / +1 %: it starts the furnace 0.5 F above the low edge, where today's firmware starts it at the edge and spends 3.0 / 4.1 % of the winter below it.

### 4.7 Fans: alternate and escalate (constraint 6)

- **Lead.** Each time both fans are off, the fan with fewer accumulated run seconds becomes the lead for the next run. There is no swap during a run, so alternating adds no cycles. This replaces today's helper, which swaps the lead in the middle of a run when the run times differ by more than 600 s and also rotates on a timer.
- **Escalate.** The second fan joins above `high + 1.5` and leaves below `high`. Both fans run at the 100 F limit. Drying uses the lead fan only: adding the second fan while VPD is more than 0.05 kPa below the low edge changes compliance by 0.0 / 0.0 point for +1.1 / +1.3 starts a day.
- **Memory.** The run seconds and start counts are kept in memory and saved to flash once an hour, then restored at boot. Today both are cleared at local midnight and lost on a reboot.

| Year | Fan 1 h/day | Fan 2 h/day | Fan 1 starts/day | Fan 2 starts/day |
|---|---:|---:|---:|---:|
| The law: the fan with fewer run hours leads | 1.60 / 2.45 | 1.58 / 2.46 | 2.6 / 2.6 | 2.9 / 2.5 |
| Reference: fan 1 always leads | 2.96 / 4.55 | 0.22 / 0.36 | 5.4 / 5.0 | 0.0 / 0.1 |

The measured record shows today's firmware already keeps the two fans within a few percent of each other per month; the plan keeps that and makes it survive reboots.

### 4.8 Misters opted in for VPD (constraint 7)

Which mister lines may be used for humidity is already a per-line flag in the irrigation program, set by the owner in the dashboard. The law asks the irrigation engine for a pulse on a member line through the engine's existing grant call and never opens a mister valve itself. The engine's daily caps, its soft water budget, its watchdog and its interlocks keep applying, unchanged.

**Which line.** The engine's ranking picks the line, as today, and its code does not change. What changes is what it is given. Today each zone is compared with its own VPD target curve. Under the plan each zone is compared with the house band: a zone wants water while its own VPD reading is above the house band's high edge, and among those the owner's rank decides, the centre first. The ranks become compiled values, taken from the controller's readback at the release. When the engine refuses a pulse (occupancy, a drip in progress, a cap reached, the first seconds after boot), the law asks again at the next pulse boundary; the fogger carries on meanwhile. The simulator is simpler than this: it rotates the member lines and opens them directly.

**Fairness.** Today's climate mister code has a rule of its own beside the ranking (`firmware/greenhouse/controls.yaml:1400-1420`): a stressed member zone that has had no pulse for 10 minutes goes first, judged against the same per-zone targets. It is not engine code, so it would go with the mister state machine. The law keeps it in its pulse request, judged against the house band's high edge like the ranking. With one member line, as today, it never acts.

**A second stage.** The fogger acts first at the VPD high edge and the misters join 0.30 kPa above it. In simulation the fogger alone holds the edge nearly all the time: removing the misters changes compliance by 0.00 / -0.11 point, and today's membership (the centre line only) gives 0.00 / 0.00 point against all three zones. They are kept because the owner asked for them and because they are the only humidifier left if the fogger fails.

Removed with this: the per-zone VPD target curves and widths for the misters (decision 5), and three functions that always return the same answer since the wet taper and the stress windows were retired, with the settings that still feed them (`past_wet_taper`, `stress_wet_override_permitted`, `direct_wet_stress_override_permitted`; `wet_taper_before_sunset_min`, `direct_wet_min_temp_f`).

### 4.9 Running alone (constraint 1)

The climate relays are local outputs and the law's inputs are local, so the remaining dependencies are the clock, values that only exist after a push, and the outdoor data. The table lists each condition, what the controller does today and what it does under the plan.

| Condition | Today | Under the plan |
|---|---|---|
| WiFi down | By configuration the controller restarts every 300 s (`wifi.reboot_timeout: 300s`, `firmware/greenhouse.yaml:178`). Each restart switches every relay off and holds the heaters off for 180 s, and 117 of the 128 settings return to their boot values. No WiFi outage of that length is in the record. | No restart (`0s`, as the API timeout on line 206 already is). The law keeps running and nothing returns to a boot value. A restart was also the only automatic recovery from a stuck WiFi stack; once the clock chip is fitted a restart costs nothing, and a long timeout (for example 6 hours) brings that recovery back (decision 8). |
| Ingestor or API down | Plan waypoints stop arriving; the last settings stay. | No effect on climate. |
| Reboot | Boot values differ from production values for part of the settings (issue #1642); the heaters are held off for 180 s; the fan run times and the fan lead reset. | Constants are compiled; anchors come from flash; every relay is available at once; fan run seconds are restored. |
| Flash storage empty | The ROM band is used: a deliberately drier view of the committed band file, kept that way since the wet-night regression of 2026-06-15 and enforced in CI. | Unchanged. It is a recorded safety decision, and it only applies to a chip whose flash is empty. |
| No outdoor data | The cold-vent guard keeps using the last station reading with no age test (`firmware/lib/greenhouse_logic.h:1602-1611`); the dry-out stops. | The wired intake probe takes over. With neither source there is no drying with outdoor air; every other rule is unaffected. |
| Clock wrong but valid | Trusted. The controller ran up to 117 minutes fast for 87 days (issue #1638) and served a shifted band: time had never synchronised, and each watchdog or panic reset stepped the retained clock by 0.5 to 125 minutes. | The band's clock is trusted only when SNTP has synchronised since the last boot or the battery clock chip supplied the time. Otherwise: "no clock" below. The host alerts when the controller's band differs from the band the host computes. |
| No clock | The solar phase is frozen at local noon of day 172, so the noon band is served all night; the fogger and climate misters are refused, even at the 100 F limit. | The widest corridor the anchors allow: the lowest and highest anchor values of each edge (60.7 to 83.8 F and 0.74 to 1.29 kPa today). The fogger and misters work. |
| Wall probes invalid | The case sensor is used, with no age test; it reads about 4 F warmer than the wall probes, and humidity control stops. With no reading at all the controller substitutes 65 F and 50 % and controls on them; it also substitutes 50 % for a missing case humidity and 65 F for a reading outside -20 to 150 F (`firmware/greenhouse/controls.yaml:241-247`, `266-269`). | The case sensor is used while it is fresh, less its offset from the wall probes (section 4.2), for the temperature rules only. With no reading at all the controller reports a sensor fault and takes a defined safe state (decision 7). No substituted values. |
| Sensor bus silent | Two restarts: when all five probes are silent, skipped while the clock is invalid, and after 3,600 s with no probe update (`controls.yaml:2340-2376`). | One restart rule, independent of the clock, at most once an hour. |
| Electric heater dead | The furnace covers by temperature; nothing alerts. | The same, with an alert (section 4.6). |
| Gas outage | The electric heater alone cannot hold the band in winter. | The same; no controller can change that (section 5.8). |

**Where the clock rule applies.** It applies to the climate band only. Irrigation and lighting each test the clock themselves (the engine needs a valid clock and no SNTP failure, lighting a valid clock), and they keep their tests and their inputs, including the solar times they read today. That leaves two tests of time on the controller, on purpose: irrigation and lighting are not to change. A battery clock chip does change them in one way: after a power cut they have the time at once and no longer wait for the network. That is part of decision 8.

**The clock chip.** A battery clock chip on the controller's I2C bus removes the dependency on the network for time. It is the one hardware change the plan recommends. Without it, a restart during a network outage leaves the controller on the no-clock corridor until the network returns. The chip shares its bus with the relay expanders, so its bench test includes a failed chip leaving the relays working.

**The intake probe.** Its temperature has been compared with the station's for two days only: it read a median 1.3 F warmer, with a range of -4.0 to +8.3 F, and its siting may warm it. A probe warmed by its housing reads a higher temperature and a lower relative humidity, and the dew point computed from the two is unchanged, so warmth biases the cost of section 4.5 and not the dew-point test of rule 7. Its dew point has not been compared with the station's at all. Phase 1 compares both for a season on the host, with no firmware change. This is what an outdoor dew point that reads wrong does to the law, and what having no outdoor data does:

| The law, condition held for the whole year | Both in band % | Nights dried % | Drying hours/day | Vent starts/day | Relay starts/day | kWh/day | Therms/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Outdoor data correct | 88.0 / 74.2 | 75 / 50 | 1.02 / 2.03 | 5.4 / 5.0 | 50 / 40 | 20.3 / 22.8 | 2.26 / 2.74 |
| Outdoor dew point read 2 F too high | 87.6 / 73.1 | 75 / 48 | 0.59 / 1.25 | 5.8 / 7.1 | 50 / 44 | 20.0 / 22.4 | 2.26 / 2.73 |
| Outdoor dew point read 2 F too low | 87.8 / 74.3 | 75 / 50 | 1.51 / 2.20 | 4.6 / 4.8 | 48 / 40 | 20.5 / 22.8 | 2.26 / 2.74 |
| Outdoor dew point read 4 F too low | 87.8 / 74.3 | 75 / 50 | 1.51 / 2.20 | 4.6 / 4.8 | 48 / 40 | 20.5 / 22.8 | 2.26 / 2.74 |
| No outdoor data: no drying with outdoor air | 83.3 / 64.1 | 66 / 31 | 0.00 / 0.00 | 3.3 / 1.2 | 45 / 32 | 19.3 / 21.3 | 2.26 / 2.70 |
| No outdoor data, with the effect check (studied, not adopted) | 87.7 / 73.7 | 74 / 49 | 1.37 / 2.07 | 4.7 / 4.8 | 48 / 40 | 20.4 / 22.7 | 2.26 / 2.74 |

- A dew point that reads too low makes outdoor air look drier than it is. At 2 F too low the test already passes whenever the house is too humid, which is why the 2 F and 4 F rows are equal: drying then runs +0.48 / +0.18 hours a day more, for +0.2 / 0.0 kWh a day and the same compliance. The rest of rule 7 still bounds it: the house must be too humid and must have heat to spare.
- A dew point that reads 2 F too high costs 0.4 / 1.2 point of compliance and adds +0.4 / +2.1 vent starts a day.
- With no outdoor data at all the law gives up drying: 4.7 / 10.2 points of compliance and 9 / 18 dried nights in a hundred. That is the worst case, and it is still 12.8 / 4.5 points above today's firmware with everything working.

**No effect check.** An earlier draft let the controller test outdoor air when it had no outdoor data: open the vent for four minutes and continue only if the indoor dew point fell. Held for a year without outdoor data it recovered 4.4 / 9.6 points of compliance against not drying. It is not adopted. It needs relay feedback, a rule for probes dropping out during the test and a repeat during long runs, and its 0.5 F test was never checked against sensor noise; the case it serves needs both the station and the intake probe to be gone. It remains in the simulator as a study option.

Each condition held for a whole year, which is far longer than any real outage, to show the direction and size:

| Condition held for the whole year | Both in band % today | Both in band % law | Therms/day today | Therms/day law | Gallons/day today | Gallons/day law | Coldest F today | Coldest F law | Hottest F today | Hottest F law |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Everything available | 70.5 / 59.6 | 88.0 / 74.2 | 2.18 / 2.70 | 2.26 / 2.74 | 63 / 56 | 68 / 65 | 58.9 / 58.8 | 59.4 / 59.3 | 90.9 / 91.8 | 85.7 / 86.9 |
| No outdoor data | 62.8 / 51.8 | 83.3 / 64.1 | 2.13 / 2.59 | 2.26 / 2.70 | 65 / 57 | 68 / 65 | 58.9 / 58.8 | 59.4 / 59.2 | 90.9 / 91.8 | 85.7 / 87.0 |
| Clock 117 minutes fast | 47.5 / 46.2 | 69.6 / 63.2 | 2.63 / 3.11 | 2.69 / 3.14 | 79 / 70 | 88 / 89 | 58.9 / 58.8 | 59.4 / 59.3 | 91.0 / 91.8 | 85.9 / 87.1 |
| Clock 60 minutes fast | not run | 77.7 / 68.8 | not run | 2.41 / 2.90 | not run | 75 / 75 | not run | 59.3 / 59.3 | not run | 85.8 / 87.1 |
| Clock 60 minutes slow | not run | 79.1 / 66.3 | not run | 2.29 / 2.73 | not run | 69 / 63 | not run | 59.3 / 59.3 | not run | 85.7 / 86.9 |
| Clock 3 hours slow | 50.9 / 43.5 | 69.6 / 57.4 | 2.81 / 3.10 | 2.75 / 3.09 | 87 / 68 | 90 / 80 | 58.8 / 58.8 | 59.3 / 59.2 | 90.9 / 91.8 | 85.9 / 86.5 |
| Clock 6 hours slow | not run | 48.3 / 40.0 | not run | 3.96 / 4.17 | not run | 146 / 131 | not run | 59.5 / 59.4 | not run | 85.7 / 86.5 |
| No clock at all | 10.3 / 31.2 | 52.6 / 41.8 | 4.28 / 5.01 | 1.56 / 2.07 | 0 / 0 | 35 / 47 | 66.7 / 63.9 | 60.7 / 60.7 | 102.8 / 98.3 | 84.7 / 86.8 |
| No clock and no outdoor data | 10.3 / 31.1 | 48.0 / 32.6 | 4.28 / 5.01 | 1.51 / 1.90 | 0 / 0 | 35 / 48 | 66.7 / 63.9 | 60.7 / 60.7 | 102.8 / 98.3 | 84.7 / 86.8 |

With no clock, today's firmware heats to the noon band all night (4.28 / 5.01 therms a day against 2.18 / 2.70), cannot fog, and reaches 103 / 98 F. The law on the corridor stays between 61 and 87 F.

One limit of the no-clock state is in the irrigation engine and not in the law. The engine's daily water count starts a new day by the clock, so with no clock it keeps counting. When the count reaches the soft water budget (100 to 300 gallons, as it is set) the fogger and misters are held except in a VPD emergency, and at the daily safety cap (360 gallons) everything but protection fog is held. At the summer rate of the no-clock state (64 / 106 gallons a day) the budget is reached after one to five days, depending on where it is set, and the cap after three to six. With no clock the engine also starts no scheduled drip or mist, as today. Today's firmware refuses fog from the first minute without a clock, so this is still better than today; removing it means giving the engine a day rollover that does not need the clock, which is a change to irrigation and so the owner's call (decision 8 lists it). With the clock chip the state needs two faults at once.

Lighting is the one subsystem that cannot run alone: the lights are switched through Home Assistant. That is unchanged and outside this plan (section 8.8).

### 4.10 What the law replaces (constraint 2)

Each item below is a special case in today's climate path that the law makes unnecessary. File references are to the code as reviewed.

| Today | Under the law |
|---|---|
| Eight exclusive modes, eleven actions, four mist stages, a ranked table of candidate actions (`firmware/lib/greenhouse_logic.h:781-1250`, `1556-2835`) | No modes. Nine on/off latches, one per rule and condition. |
| Night dry-out machine: night only, pulse and rest timers, a nightly kWh budget, a 0.74 kPa floor compiled into the firmware, a forced cut of the electric heater for 180 s per pulse | Rule 7 at every hour. The floor is a property of the band (section 4.1). |
| Heat-assisted dehumidifying at night only; "can hold" at night only; separate night and day dew-point margins | Rule 7. The wetting gate that irrigation keeps gets one compiled margin and no night test (section 8.7). |
| Economiser on enthalpy, a moisture-exchange estimator, summer-vent comparators, the cold-vent guard: four different answers to "is outdoor air better" | One: the dew-point margin and the cost of rule 7. |
| Fog refused below 55 F and above 90 % RH; three wetting gates that always return the same answer since their windows were retired | Rules 5 and 6. The band's VPD edges already say when the air is too dry. |
| Interior thresholds at 25 % of the band width in one function and raw edges in another (issue #1640) | One threshold per rule. |
| Three anti-chatter layers on one exit (exit margin, dwell gate, relay minimum times) | Exit margin and relay minimum times. |
| Two second-fan rules; a lead fan that swaps during a run | Rule 4; the lead chosen while both fans are off. |
| Conflict arbitration that cuts the heaters when the vent opens, with exemptions by mode | Three lines of the relay layer (section 4.3). |
| `night_vpd_bias_kpa`, `band_track_fraction`, the planner's 48 writable settings, the host's moisture guardrail that rewrites them | None. The band is the only policy. |
| The planner's trigger matrix on clock times and the forecast-action rules | Not on the control path (sections 6 and 7). |

The irrigation schedule and the lighting photoperiod are schedules the owner sets, not climate exceptions; they are untouched.

## 5. Simulation evidence

### 5.1 Method and what it can and cannot show

The simulator is the one built for the review (section 9 there): a physics model of the house fitted to the measured record, driven minute by minute by the recorded weather of 2025-11-16 to 2026-11-15, with the controller in the loop each second. For "today's firmware" the controller is the product's own decision code compiled into the simulator. For the law it is the reference implementation `band_edge_controller.h` with the relay layer of section 4.3.

- "Today's firmware" in a simulation means today's firmware and today's settings with all equipment working, held for the whole year. The measured record is worse (47.4 % of minutes inside the band from 2026-05-25 to 2026-11-15) because it also contains other settings, the wrong clock, the unpowered heater and delivery outages. Simulated figures are compared with simulated figures only.
- Model A and model B bracket the largest unknown, the house's moisture source. Where they disagree, the answer depends on something not yet measured (issue #1669).
- The band is graded as the review grades it. "Both in band" is the share of minutes with temperature and VPD inside the band. "Nights dried" is the share of nights that meet the owner's night goal of 2026-11-05: at least 240 of the 360 minutes from 00:00 to 06:00 at or above the VPD floor.
- A relay start is an off-to-on transition. Run hours are the sum over the seven climate relays. kWh counts the electric heater, the fans, the fogger and the vent motor; therms are furnace hours times 0.75 (the nameplate input; gas is not metered); gallons are fog and mist water.
- The model of today's firmware is corrected against the review's. The review's simulator allowed humidity misting only from 120 minutes after sunrise to 180 minutes before sunset and at 65 F or above; the firmware has no such limits. Removing them moves today's firmware from 71.8 / 60.6 % to 70.5 / 59.6 % in band, from 125 / 132 to 135 / 142 relay starts a day and from 56 / 54 to 63 / 56 gallons a day. The review's step 1 and step 2 move by 0.1 point or less.
- The simulation has no sensor noise, and relay starts are where that shows. One check against the record: the electric heater's measured starts were 16.7 a day in October 2026 and 27.6 in November; the simulation of today's firmware gives 28.3 / 35.6 and 11.4 / 18.5. It is above the measurement in one month and below it in the other, so simulated starts are indicative and not exact. Most of the law's on and off lines are at least 1 F or 0.15 kPa apart and its minimum times are 120 to 300 s, which makes it less sensitive to noise than a single threshold. The exception is the cost-limited start of drying at `low + 1.0`, which is 0.25 F above its stop line (section 4.5). Section 13 measures both on the controller.

### 5.2 Headline, by season

Year:

| Controller | Both in band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware and settings | 70.5 / 59.6 | 57 / 38 | 135 / 142 | 24.5 / 28.2 | 19.6 / 21.0 | 2.18 / 2.70 | 63 / 56 |
| Review step 1 (five settings, no code) | 78.3 / 69.7 | 70 / 53 | 104 / 100 | 23.7 / 29.1 | 19.4 / 21.4 | 2.16 / 2.72 | 45 / 54 |
| Review step 2 (patched firmware) | 85.6 / 82.6 | 80 / 71 | 111 / 110 | 24.9 / 30.8 | 19.6 / 21.7 | 2.43 / 3.05 | 49 / 61 |
| Review step 4 (the review's two-axis controller) | 83.3 / 80.4 | 73 / 64 | 144 / 160 | 24.3 / 29.7 | 19.5 / 21.4 | 2.50 / 3.13 | 53 / 60 |
| **The law** (drying cost limit 0) | 88.0 / 74.2 | 75 / 50 | 50 / 40 | 24.0 / 29.5 | 20.3 / 22.8 | 2.26 / 2.74 | 68 / 65 |
| The law with the drying cost limit at 0.7 kWh/kg (decision 1) | 89.0 / 81.6 | 76 / 63 | 53 / 53 | 24.4 / 31.8 | 20.4 / 23.0 | 2.29 / 2.93 | 68 / 65 |

Winter (October to April):

| Controller | Both in band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware and settings | 79.2 / 63.5 | 59 / 26 | 89 / 84 | 25.6 / 28.1 | 28.0 / 29.2 | 3.51 / 4.25 | 26 / 4 |
| Review step 1 (five settings, no code) | 84.5 / 74.8 | 76 / 45 | 81 / 67 | 25.2 / 29.1 | 27.3 / 29.0 | 3.44 / 4.26 | 30 / 4 |
| Review step 2 (patched firmware) | 90.3 / 89.4 | 89 / 73 | 89 / 86 | 25.9 / 31.3 | 27.1 / 29.1 | 3.76 / 4.73 | 36 / 6 |
| Review step 4 (the review's two-axis controller) | 88.7 / 87.1 | 81 / 63 | 90 / 78 | 27.9 / 33.0 | 28.0 / 29.9 | 3.94 / 4.90 | 29 / 5 |
| **The law** (drying cost limit 0) | 93.1 / 76.7 | 81 / 43 | 37 / 29 | 27.3 / 29.4 | 29.1 / 30.4 | 3.69 / 4.28 | 59 / 11 |
| The law with the drying cost limit at 0.7 kWh/kg (decision 1) | 93.9 / 87.4 | 82 / 63 | 41 / 50 | 27.8 / 32.6 | 29.1 / 30.7 | 3.72 / 4.58 | 59 / 11 |

Summer (May to September):

| Controller | Both in band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware and settings | 59.3 / 54.6 | 55 / 54 | 194 / 218 | 22.9 / 28.2 | 8.7 / 10.4 | 0.45 / 0.69 | 111 / 123 |
| Review step 1 (five settings, no code) | 70.3 / 63.0 | 62 / 64 | 133 / 143 | 21.7 / 29.2 | 9.2 / 11.5 | 0.51 / 0.72 | 65 / 119 |
| Review step 2 (patched firmware) | 79.4 / 73.8 | 68 / 68 | 139 / 143 | 23.7 / 30.2 | 9.9 / 12.1 | 0.71 / 0.87 | 66 / 133 |
| Review step 4 (the review's two-axis controller) | 76.3 / 71.8 | 63 / 65 | 215 / 267 | 19.7 / 25.4 | 8.5 / 10.3 | 0.65 / 0.83 | 83 / 132 |
| **The law** (drying cost limit 0) | 81.4 / 71.1 | 68 / 59 | 66 / 54 | 19.8 / 29.7 | 9.0 / 12.9 | 0.41 / 0.74 | 80 / 134 |
| The law with the drying cost limit at 0.7 kWh/kg (decision 1) | 82.6 / 74.1 | 68 / 62 | 68 / 57 | 20.0 / 30.7 | 9.0 / 13.0 | 0.44 / 0.79 | 80 / 134 |

The law minus each alternative, over the year:

| Difference | Both in band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| The law minus today's firmware | +17.5 / +14.6 | +17.9 / +11.6 | -85.2 / -102.4 | -0.4 / +1.3 | +0.7 / +1.7 | +0.08 / +0.04 | +5.6 / +8.9 |
| The law minus review step 2 | +2.4 / -8.4 | -4.9 / -21.1 | -61.0 / -70.5 | -0.9 / -1.3 | +0.7 / +1.1 | -0.17 / -0.31 | +19.3 / +3.5 |

- The law holds the band 17.5 / 14.6 points more of the year than today's firmware, with 63 / 72 % fewer relay starts, and dries 18 / 12 more nights in a hundred.
- Against the review's step 2 patch the law is ahead in model A and behind in model B (+2.4 / -8.4 points), with less than half the starts. The difference is furnace heat spent on drying: the patch dries 80 / 71 % of nights against 75 / 50 % and uses 0.17 / 0.31 therm a day more gas. Model B is the wetter house, so it is where that heat buys the most.
- The last row of each table is the law with the drying cost limit at 0.7 kWh per kg, which lets the furnace back drying in mild weather. Against the step 2 patch it is +3.4 / -1.0 points, for 0.14 / 0.12 therm a day less. How much furnace heat a dry night is worth is decision 1; the law is the same either way.
- The review's own two-axis controller (its step 4) is superseded. The law makes 66 / 75 % fewer starts; with the limit at 0.7, which spends furnace heat on drying as that controller does, it holds the band +5.7 / +1.2 points more for 0.21 / 0.20 therm a day less.

### 5.3 Where the band is still lost

Share of the year outside each edge:

| Controller | Too cold % | Too hot % | Too humid % | Too dry % |
|---|---:|---:|---:|---:|
| Today's firmware and settings | 1.9 / 2.6 | 3.7 / 5.1 | 17.1 / 28.4 | 10.4 / 9.1 |
| Review step 1 (five settings, no code) | 2.0 / 2.9 | 2.1 / 4.4 | 11.9 / 19.4 | 6.8 / 7.2 |
| Review step 2 (patched firmware) | 0.5 / 0.6 | 2.1 / 3.0 | 6.0 / 9.1 | 6.8 / 6.0 |
| Review step 4 (the review's two-axis controller) | 0.5 / 0.5 | 2.9 / 4.1 | 7.5 / 10.8 | 7.2 / 6.2 |
| **The law** (drying cost limit 0) | 0.6 / 0.6 | 2.5 / 3.5 | 7.7 / 19.0 | 1.7 / 3.6 |
| The law with the drying cost limit at 0.7 kWh/kg (decision 1) | 0.6 / 0.7 | 2.5 / 3.5 | 6.7 / 11.6 | 1.7 / 3.7 |

Winter:

| Controller | Too cold % | Too hot % | Too humid % | Too dry % |
|---|---:|---:|---:|---:|
| Today's firmware and settings | 3.0 / 4.1 | 0.1 / 0.1 | 12.6 / 32.6 | 6.0 / 1.0 |
| Review step 1 (five settings, no code) | 3.0 / 4.7 | 0.0 / 0.1 | 6.2 / 21.0 | 7.0 / 1.0 |
| Review step 2 (patched firmware) | 0.7 / 0.7 | 0.0 / 0.0 | 2.7 / 9.1 | 6.8 / 1.0 |
| Review step 4 (the review's two-axis controller) | 0.7 / 0.6 | 0.0 / 0.1 | 4.7 / 11.3 | 6.0 / 1.0 |
| **The law** (drying cost limit 0) | 0.9 / 0.7 | 0.0 / 0.1 | 5.5 / 22.4 | 0.5 / 0.1 |
| The law with the drying cost limit at 0.7 kWh/kg (decision 1) | 0.9 / 0.8 | 0.0 / 0.1 | 4.7 / 11.7 | 0.5 / 0.1 |

Summer:

| Controller | Too cold % | Too hot % | Too humid % | Too dry % |
|---|---:|---:|---:|---:|
| Today's firmware and settings | 0.4 / 0.6 | 8.5 / 11.7 | 22.9 / 22.9 | 16.1 / 19.7 |
| Review step 1 (five settings, no code) | 0.6 / 0.6 | 4.9 / 9.9 | 19.2 / 17.4 | 6.6 / 15.2 |
| Review step 2 (patched firmware) | 0.2 / 0.5 | 4.8 / 6.8 | 10.2 / 9.1 | 6.8 / 12.4 |
| Review step 4 (the review's two-axis controller) | 0.2 / 0.5 | 6.7 / 9.4 | 11.0 / 10.2 | 8.8 / 13.0 |
| **The law** (drying cost limit 0) | 0.2 / 0.5 | 5.8 / 8.0 | 10.7 / 14.5 | 3.3 / 8.3 |
| The law with the drying cost limit at 0.7 kWh/kg (decision 1) | 0.2 / 0.5 | 5.8 / 7.9 | 9.4 / 11.5 | 3.3 / 8.3 |

What remains under the law is mostly "too humid", 7.7 / 19.0 % of the year: the hours when outdoor air is not drier than the house, or the house has no heat to spare and a drying run may not start on furnace heat. That is the part decision 1 can buy back: at a limit of 0.7 it is 6.7 / 11.6 %. "Too hot" is summer afternoons with the vent open and both fans running; the law's hottest minute of the year is 85.7 / 86.9 F against 90.9 / 91.8 F for today's firmware. "Too dry" falls from 10.4 / 9.1 % to 1.7 / 3.6 %, because the fogger now holds the VPD high edge.

### 5.4 Cycles and run hours, per relay (constraint 3)

Year:

| Relay | Starts/day today | Starts/day law | Hours/day today | Hours/day law |
|---|---:|---:|---:|---:|
| Electric heater | 11.0 / 16.8 | 0.8 / 0.8 | 12.86 / 13.86 | 12.91 / 14.58 |
| Gas furnace | 9.8 / 12.5 | 9.0 / 12.1 | 2.91 / 3.60 | 3.02 / 3.65 |
| Vent | 16.3 / 17.4 | 5.4 / 5.0 | 3.03 / 3.90 | 2.97 / 4.56 |
| Fans (both) | 19.3 / 18.6 | 5.5 / 5.1 | 4.32 / 5.66 | 3.18 / 4.91 |
| Fogger | 49.9 / 38.0 | 28.9 / 13.3 | 0.86 / 0.63 | 1.96 / 1.75 |
| Misters (all zones) | 28.4 / 38.9 | 0.0 / 3.8 | 0.49 / 0.51 | 0.00 / 0.06 |
| **All relays** | 134.8 / 142.4 | 49.6 / 40.0 | 24.5 / 28.2 | 24.0 / 29.5 |

Winter:

| Relay | Starts/day today | Starts/day law | Hours/day today | Hours/day law |
|---|---:|---:|---:|---:|
| Electric heater | 9.7 / 18.7 | 0.8 / 0.7 | 19.10 / 20.19 | 19.35 / 20.91 |
| Gas furnace | 16.3 / 21.3 | 15.0 / 20.3 | 4.68 / 5.67 | 4.92 / 5.71 |
| Vent | 8.3 / 16.9 | 0.5 / 1.7 | 0.58 / 1.11 | 0.67 / 1.21 |
| Fans (both) | 8.3 / 16.9 | 0.4 / 1.7 | 0.57 / 1.08 | 0.67 / 1.21 |
| Fogger | 43.5 / 8.5 | 19.8 / 5.1 | 0.69 / 0.08 | 1.70 / 0.32 |
| Misters (all zones) | 3.2 / 1.8 | 0.0 / 0.0 | 0.03 / 0.01 | 0.00 / 0.00 |
| **All relays** | 89.4 / 84.2 | 36.6 / 29.5 | 25.6 / 28.1 | 27.3 / 29.4 |

Summer:

| Relay | Starts/day today | Starts/day law | Hours/day today | Hours/day law |
|---|---:|---:|---:|---:|
| Electric heater | 12.6 / 14.4 | 0.8 / 1.0 | 4.76 / 5.65 | 4.55 / 6.36 |
| Gas furnace | 1.4 / 1.2 | 1.1 / 1.3 | 0.60 / 0.92 | 0.55 / 0.99 |
| Vent | 26.7 / 18.1 | 11.9 / 9.3 | 6.21 / 7.54 | 5.96 / 8.90 |
| Fans (both) | 33.6 / 20.9 | 12.0 / 9.5 | 9.20 / 11.61 | 6.45 / 9.72 |
| Fogger | 58.2 / 76.3 | 40.7 / 24.1 | 1.08 / 1.33 | 2.29 / 3.60 |
| Misters (all zones) | 61.2 / 87.1 | 0.0 / 8.6 | 1.09 / 1.14 | 0.00 / 0.14 |
| **All relays** | 193.7 / 218.1 | 66.5 / 53.7 | 22.9 / 28.2 | 19.8 / 29.7 |

- Starts fall for every relay. The electric heater goes from 11.0 / 16.8 to 0.8 / 0.8 a day, because it stays on through the furnace's cycles.
- The furnace falls least, from 9.8 / 12.5 to 9.0 / 12.1 a day. It is large for the house (75,000 BTU/h input), so a burn is short whatever decides it. With about the same number of burns the law holds the low edge: too cold 0.6 / 0.6 % of the year against 1.9 / 2.6 %. The width of the furnace's swing is the only lever on furnace starts within the law (decision 2).
- The fogger starts 42 / 65 % less often and runs 2.0 / 1.7 hours a day against 0.9 / 0.6: it holds the VPD high edge, and it does the work the misters do today. The misters go from 28 / 39 starts a day to 0.0 / 3.8.
- Run hours at the same band are about equal (-0.4 / +1.3 hours a day). The electric heater is about half of them, 12.9 / 14.6 hours a day against 12.9 / 13.9 today; that is constraint 5 at work in both. Fan hours fall and fogger hours rise. Run hours fall only when the band is edited (section 5.7).

### 5.5 Utilities (constraint 4)

Where the law's electricity and water go:

| The law | Electric heater kWh/day | Fans kWh/day | Fogger kWh/day | Vent kWh/day | Fog gallons/day | Mister gallons/day |
|---|---:|---:|---:|---:|---:|---:|
| Year | 18.5 / 20.9 | 0.36 / 0.55 | 1.39 / 1.24 | 0.03 / 0.05 | 68 / 61 | 0.0 / 3.9 |
| Winter (October to April) | 27.8 / 30.0 | 0.08 / 0.14 | 1.21 / 0.23 | 0.01 / 0.01 | 59 / 11 | 0.0 / 0.0 |
| Summer (May to September) | 6.5 / 9.1 | 0.73 / 1.10 | 1.63 / 2.55 | 0.06 / 0.09 | 80 / 125 | 0.1 / 8.9 |

About 91 / 92 % of the electricity is the electric heater. Nearly all the water is fog; the misters use 0 / 4 gallons a day.

At the same band the law uses a little more of each utility than today's firmware: +0.7 / +1.7 kWh, +0.08 / +0.04 therm and +6 / +9 gallons a day. Each has a cause that is the band being held:

- **Electricity:** drying spends electric heat, +1.0 / +1.4 kWh a day against never drying, and today's firmware dries fewer nights.
- **Gas:** the furnace starts 0.5 F above the low edge instead of at it, so the house spends less time below the band. Of the difference, +0.01 / +0.04 therm a day is heat that drying spent and the furnace replaced (section 4.5).
- **Water:** the fogger holds the VPD high edge on dry days, including sunny winter days in model A (59 / 11 gallons a day in winter against 26 / 4). The owner's note of 2026-11-05 accepted dry winter hours for now; the law does not, and section 5.7 prices the edge that decides it (decision 9).

The same comparison on three edited bands (section 5.7 defines them):

| Year, the law minus today's firmware on the same band | Both in own band, points | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|
| Today's band | +17.5 / +14.6 | -85 / -102 | -0.4 / +1.3 | +0.7 / +1.7 | +0.08 / +0.04 | +6 / +9 |
| Band 1 | +15.7 / +14.4 | -75 / -106 | -0.7 / +1.5 | -0.1 / +1.4 | 0.00 / 0.00 | -1 / +3 |
| Band 2 | +12.4 / +11.1 | -57 / -78 | -0.2 / +1.9 | -0.2 / +1.1 | +0.03 / +0.04 | +3 / +1 |
| Band 3 | +12.4 / +12.3 | -55 / -77 | -0.3 / +2.5 | -0.4 / +1.0 | +0.04 / +0.06 | +1 / +1 |

On every band the law holds its band 11 to 17 points more of the year with 55 to 106 fewer relay starts a day, and its utility use differs from today's firmware on the same band by 0.1 to 1.7 kWh, 0.00 to 0.08 therm and 1 to 9 gallons a day.

A controller cannot lower utility use at a fixed band by much: holding a temperature takes the heat the house loses at that temperature. What the controller can do is stop wasting, and the law does: no heater cut during drying, no drying run started on furnace heat, no pulsing, no pre-staging. The larger lever is the band itself, which section 5.7 prices.

### 5.6 Sensitivity of each constant

Each row changes one rule and shows the difference from the law over the year.

| Change to one rule (year, difference from the law) | Both in band | Nights dried | Starts/day | Furnace starts/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Furnace off at low+2.5 and electric heater 3.0/4.0 (narrower furnace swing) | -0.2 / +0.3 | -1 / +1 | +1.3 / +3.0 | +2.1 / +2.6 | -0.70 / -0.54 | -0.05 / -0.04 | -4.2 / -2.1 |
| Furnace off at low+3.5 and electric heater 4.0/5.0 (wider furnace swing) | 0.0 / 0.0 | +1 / +1 | -0.4 / -1.4 | -1.5 / -1.9 | +0.70 / +0.56 | +0.06 / +0.05 | +4.6 / +2.9 |
| Electric heater 4.0/5.0, furnace unchanged | +0.1 / -0.5 | +1 / +1 | +0.1 / -0.5 | -0.1 / -0.1 | +0.70 / +0.56 | -0.03 / -0.03 | +1.0 / +0.5 |
| Electric heater 3.0/4.0, furnace and drying start unchanged | -0.4 / -0.6 | -1 / 0 | -0.4 / -0.3 | +0.2 / +0.1 | -0.78 / -0.71 | +0.03 / +0.02 | -1.0 / -0.3 |
| Electric heater 2.5/3.5, furnace and drying start unchanged | -1.0 / -1.5 | -2 / -3 | -0.5 / -0.1 | +0.4 / +0.3 | -1.71 / -1.84 | +0.08 / +0.06 | -2.1 / -0.7 |
| Furnace on at low+0.25 | -0.5 / -1.1 | -2 / -1 | -1.0 / -1.1 | -0.9 / -1.1 | +0.04 / +0.04 | -0.04 / -0.05 | -0.3 / +0.1 |
| Whole heating stack 1 F lower: electric heater 2.5/3.5, furnace off at low+2.0 | -0.3 / +0.7 | -1 / +2 | +4.1 / +7.7 | +5.3 / +6.5 | -1.32 / -1.11 | -0.09 / -0.06 | -8.2 / -3.9 |
| Electric heater on at low+1.5, off at low+3.5 (a 2 F swing; drying still starts at low+3.5) | -1.5 / -2.3 | -3 / -3 | -1.1 / -0.4 | +0.6 / +0.4 | -2.51 / -2.62 | +0.12 / +0.09 | -2.9 / -0.9 |
| Heaters minimum on/off 180 s | 0.0 / 0.0 | 0 / 0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.00 / 0.00 | 0.00 / 0.00 | 0.0 / 0.0 |
| Electric heater 1.0/2.0 (not ahead of the furnace; drying still starts at low+3.5) | -3.3 / -4.1 | -7 / -7 | +10.8 / +14.8 | +3.1 / +2.6 | -12.16 / -13.22 | +0.87 / +0.86 | -6.5 / -2.6 |
| Fog exit margin 0.10 kPa | -0.3 / -0.3 | 0 / 0 | +4.5 / +2.6 | +0.1 / 0.0 | -0.15 / -0.02 | -0.02 / 0.00 | -5.0 / -1.8 |
| Fog exit margin 0.20 kPa | +0.2 / +0.1 | 0 / +1 | -3.4 / -2.5 | -0.1 / 0.0 | +0.12 / +0.04 | +0.02 / 0.00 | +5.2 / +2.1 |
| Fog minimum on/off 60 s | 0.0 / 0.0 | 0 / 0 | +1.5 / +0.8 | 0.0 / 0.0 | -0.01 / -0.01 | 0.00 / 0.00 | -0.7 / -0.3 |
| Fog minimum on/off 180 s | -0.4 / -0.1 | 0 / 0 | +15.1 / -1.6 | 0.0 / 0.0 | +0.80 / +0.03 | 0.00 / 0.00 | +7.7 / +1.0 |
| Fans and vent minimum on/off 180 s | 0.0 / 0.0 | 0 / 0 | +0.2 / +0.5 | 0.0 / 0.0 | -0.01 / -0.04 | 0.00 / 0.00 | 0.0 / -0.1 |
| Fans and vent minimum on/off 120 s | 0.0 / 0.0 | 0 / 0 | +0.2 / +0.9 | 0.0 / 0.0 | -0.01 / -0.04 | 0.00 / 0.00 | 0.0 / -0.1 |
| Cooling exit 1.5 F inside | -0.1 / +0.1 | 0 / 0 | +1.2 / +0.8 | 0.0 / 0.0 | -0.07 / -0.10 | 0.00 / 0.00 | -1.2 / -1.9 |
| Cooling exit 3.0 F inside | +0.1 / -0.1 | 0 / 0 | -0.7 / -0.8 | 0.0 / 0.0 | +0.12 / +0.15 | 0.00 / 0.00 | +2.5 / +4.3 |
| Second fan at high+0.5 | 0.0 / +0.1 | 0 / 0 | +0.1 / +0.1 | 0.0 / 0.0 | +0.02 / +0.01 | 0.00 / 0.00 | +0.1 / +0.5 |
| Second fan at high+3.0 | 0.0 / 0.0 | 0 / 0 | -0.1 / -0.6 | 0.0 / 0.0 | -0.01 / -0.04 | 0.00 / 0.00 | 0.0 / -0.7 |
| Add fog as a cooling stage above high+1.5 | 0.0 / 0.0 | 0 / 0 | 0.0 / -0.5 | 0.0 / 0.0 | +0.01 / +0.01 | 0.00 / 0.00 | +0.5 / +1.4 |
| Add fog as a cooling stage above high+0.5 | +0.1 / +0.1 | 0 / 0 | +0.1 / -0.3 | 0.0 / 0.0 | +0.01 / +0.02 | 0.00 / 0.00 | +0.9 / +2.4 |
| Misters join at vpd_high+0.20 | -0.8 / +0.1 | -1 / 0 | -0.3 / +1.9 | +0.1 / 0.0 | +0.11 / -0.04 | +0.01 / 0.00 | -1.3 / +1.1 |
| Misters join at vpd_high+0.40, leave at +0.15 | 0.0 / -0.1 | 0 / 0 | 0.0 / -2.0 | 0.0 / 0.0 | 0.00 / +0.04 | 0.00 / 0.00 | 0.0 / -1.0 |
| No misters | 0.0 / -0.1 | 0 / 0 | 0.0 / -3.1 | 0.0 / 0.0 | 0.00 / +0.05 | 0.00 / 0.00 | 0.0 / -1.9 |
| Centre mister only (today's membership) | 0.0 / 0.0 | 0 / 0 | 0.0 / -0.1 | 0.0 / 0.0 | 0.00 / -0.01 | 0.00 / 0.00 | 0.0 / +0.1 |
| No fog or mist below the low temperature edge | 0.0 / -0.1 | 0 / 0 | +0.7 / +0.3 | 0.0 / 0.0 | -0.02 / 0.00 | 0.00 / 0.00 | -0.8 / -0.1 |
| Drying exit 0.15 kPa above the low edge | -0.1 / -0.5 | 0 / -1 | +0.4 / +2.1 | 0.0 / 0.0 | -0.08 / -0.11 | 0.00 / -0.01 | -0.1 / 0.0 |
| Drying starts 0.10 kPa above the low edge | -0.1 / +0.1 | 0 / 0 | +4.5 / +4.6 | 0.0 / 0.0 | +0.30 / +0.14 | 0.00 / 0.00 | +1.5 / +0.2 |
| Drying starts at the low edge | -0.1 / -0.4 | -1 / -2 | -1.0 / -2.6 | 0.0 / 0.0 | -0.14 / -0.14 | 0.00 / -0.01 | -0.1 / 0.0 |
| Second fan while drying, when VPD is more than 0.05 kPa below the low edge | 0.0 / 0.0 | 0 / 0 | +1.1 / +1.3 | 0.0 / 0.0 | 0.00 / +0.01 | 0.00 / 0.00 | 0.0 / 0.0 |
| Outdoor dew-point margin 2 F, no start/stop gap | +0.2 / -0.3 | +1 / 0 | +6.6 / +6.1 | 0.0 / 0.0 | -0.11 / -0.13 | 0.00 / 0.00 | -0.1 / +0.1 |
| Outdoor dew-point margin 4 F start, 1 F stop | -0.1 / 0.0 | 0 / 0 | -0.6 / -0.1 | 0.0 / 0.0 | -0.07 / -0.04 | 0.00 / 0.00 | -0.1 / 0.0 |

By season:

| Change to one rule (difference from the law) | Both in band, winter | Both in band, summer | Starts/day, winter | Starts/day, summer |
|---|---:|---:|---:|---:|
| Furnace off at low+2.5 and electric heater 3.0/4.0 (narrower furnace swing) | -0.2 / +0.9 | -0.3 / -0.3 | +2.3 / +4.8 | 0.0 / +0.7 |
| Furnace off at low+3.5 and electric heater 4.0/5.0 (wider furnace swing) | 0.0 / -0.2 | +0.1 / +0.3 | -0.8 / -2.3 | +0.2 / -0.4 |
| Electric heater 4.0/5.0, furnace unchanged | +0.1 / -0.9 | +0.1 / 0.0 | 0.0 / -0.8 | +0.2 / -0.2 |
| Electric heater 3.0/4.0, furnace and drying start unchanged | -0.2 / -0.3 | -0.6 / -1.0 | +0.1 / +0.1 | -1.0 / -0.8 |
| Electric heater 2.5/3.5, furnace and drying start unchanged | -0.5 / -0.7 | -1.5 / -2.4 | +0.3 / +1.0 | -1.6 / -1.6 |
| Furnace on at low+0.25 | -0.7 / -1.7 | -0.2 / -0.3 | -1.7 / -1.8 | -0.1 / -0.3 |
| Whole heating stack 1 F lower: electric heater 2.5/3.5, furnace off at low+2.0 | -0.2 / +1.6 | -0.4 / -0.5 | +7.0 / +12.5 | +0.4 / +1.4 |
| Electric heater on at low+1.5, off at low+3.5 (a 2 F swing; drying still starts at low+3.5) | -1.0 / -1.2 | -2.2 / -3.6 | +0.2 / +0.8 | -2.7 / -2.0 |
| Heaters minimum on/off 180 s | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| Electric heater 1.0/2.0 (not ahead of the furnace; drying still starts at low+3.5) | -3.2 / -3.1 | -3.5 / -5.4 | +21.7 / +27.4 | -3.5 / -1.6 |
| Fog exit margin 0.10 kPa | 0.0 / 0.0 | -0.6 / -0.7 | +4.9 / +1.0 | +4.0 / +4.7 |
| Fog exit margin 0.20 kPa | 0.0 / 0.0 | +0.4 / +0.4 | -2.9 / -0.7 | -4.0 / -4.8 |
| Fog minimum on/off 60 s | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | +3.4 / +1.8 |
| Fog minimum on/off 180 s | 0.0 / 0.0 | -0.9 / -0.1 | 0.0 / 0.0 | +34.7 / -3.6 |
| Fans and vent minimum on/off 180 s | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | +0.4 / +1.2 |
| Fans and vent minimum on/off 120 s | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | +0.5 / +2.2 |
| Cooling exit 1.5 F inside | 0.0 / 0.0 | -0.3 / +0.2 | +0.1 / +0.1 | +2.6 / +1.8 |
| Cooling exit 3.0 F inside | 0.0 / -0.1 | +0.3 / -0.2 | 0.0 / -0.1 | -1.6 / -1.7 |
| Second fan at high+0.5 | 0.0 / 0.0 | +0.1 / +0.1 | 0.0 / 0.0 | +0.2 / +0.3 |
| Second fan at high+3.0 | 0.0 / 0.0 | 0.0 / -0.1 | 0.0 / 0.0 | -0.2 / -1.3 |
| Add fog as a cooling stage above high+1.5 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / -1.2 |
| Add fog as a cooling stage above high+0.5 | 0.0 / 0.0 | +0.3 / +0.2 | 0.0 / 0.0 | +0.3 / -0.7 |
| Misters join at vpd_high+0.20 | 0.0 / 0.0 | -1.9 / +0.2 | 0.0 / 0.0 | -0.6 / +4.3 |
| Misters join at vpd_high+0.40, leave at +0.15 | 0.0 / 0.0 | 0.0 / -0.2 | 0.0 / 0.0 | 0.0 / -4.6 |
| No misters | 0.0 / 0.0 | 0.0 / -0.3 | 0.0 / 0.0 | 0.0 / -7.2 |
| Centre mister only (today's membership) | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / -0.3 |
| No fog or mist below the low temperature edge | 0.0 / -0.1 | 0.0 / 0.0 | +1.2 / +0.6 | 0.0 / 0.0 |
| Drying exit 0.15 kPa above the low edge | -0.1 / -0.5 | 0.0 / -0.4 | 0.0 / +0.7 | +0.8 / +4.1 |
| Drying starts 0.10 kPa above the low edge | +0.1 / +0.1 | -0.3 / 0.0 | +0.4 / +1.6 | +9.8 / +8.4 |
| Drying starts at the low edge | -0.2 / -0.4 | 0.0 / -0.3 | -0.3 / -1.0 | -1.9 / -4.8 |
| Second fan while drying, when VPD is more than 0.05 kPa below the low edge | -0.1 / -0.1 | 0.0 / 0.0 | +0.1 / +0.3 | +2.5 / +2.6 |
| Outdoor dew-point margin 2 F, no start/stop gap | 0.0 / 0.0 | +0.4 / -0.8 | 0.0 / 0.0 | +15.2 / +14.0 |
| Outdoor dew-point margin 4 F start, 1 F stop | 0.0 / 0.0 | -0.3 / 0.0 | 0.0 / 0.0 | -1.4 / -0.2 |

- **The heating lines are a trade, not an optimum** (the first ten rows). A narrower furnace swing with a lower electric line saves electricity and gas and costs furnace starts: one step (-0.70 / -0.54 kWh and -0.05 / -0.04 therm a day for +2.1 / +2.6 furnace starts), two steps (-1.32 / -1.11 kWh and -0.09 / -0.06 therm for +5.3 / +6.5), and a wider swing the other way (+0.70 / +0.56 kWh and +0.06 / +0.05 therm for -1.5 / -1.9). That is constraint 3 against constraint 4, and it is decision 2. The electric heater's lines alone, with the furnace's swing unchanged, trade electricity for gas in both directions and leave the starts as they are: 0.5 F lower -0.78 / -0.71 kWh and +0.03 / +0.02 therm, 0.5 F higher +0.70 / +0.56 kWh and -0.03 / -0.03 therm. In winter the lowest lines change compliance by -0.2 / +1.6 points: model B gains, because the line above which drying may start moves down with them.
- **The electric heater needs its place above the furnace.** With a 2 F swing that reaches down into the furnace's range it runs 2.5 / 2.6 kWh a day less and the furnace +0.12 / +0.09 therm more, for -1.5 / -2.3 points. On the furnace's side of the swing it loses 3.3 / 4.1 points and adds +10.8 / +14.8 starts a day. Both rows leave the drying start line at `low + 3.5`, so part of their lost compliance is drying that no longer finds spare heat (0.98 / 1.85 and 0.86 / 1.59 hours a day against 1.02 / 2.03), not the ordering itself. The energy figures are the ordering's.
- **Everything else is flat.** Outside the heating lines no row gains more than 0.2 point of compliance over the year, 0.1 in winter or 0.4 in summer, in either model. That is the evidence that one value can serve every season. The rows that save a little of a utility cost starts or compliance.
- **Flat alternatives.** The second fan at `high + 3.0` and the misters joining at `vpd_high + 0.40` and leaving at `+ 0.15` do as well as the proposed values within the noise of the simulation. A shorter minimum time for the heaters changes nothing at all: without sensor noise a heater cycle is longer than either value.
- **Tried and not adopted:** fog as an added cooling stage (+0.1 / +0.1 point for +0.9 / +2.4 gallons a day), a second fan while drying, when VPD is more than 0.05 kPa below the low edge (0.0 / 0.0 point for +1.1 / +1.3 starts a day) and a rule against fog below the low temperature edge (0.0 / -0.1 point).
- **One row to watch:** a fogger minimum time of 180 s changes starts by +15.1 / -1.6 a day. In model A the longer burst wets the house past the VPD low edge and the vent opens to dry it, +14.0 / +0.2 more vent starts a day in summer. The fogger's minimum times stay at 120 s.

### 5.7 The band sets the utility use: a price for each edge

Each row moves one part of the band and runs the law on it. Compliance is graded against the edited band.

Year:

| Band edit (difference from the law on today's band) | Therms/day | kWh/day | Gallons/day | Starts/day | Run hours/day | Both in own band | Nights dried |
|---|---:|---:|---:|---:|---:|---:|---:|
| Whole temperature band 2 F lower | -0.46 / -0.48 | -1.4 / -0.9 | -6 / +14 | +0.5 / +0.6 | +1.9 / +3.1 | -6.9 / -9.8 | -12 / -7 |
| Whole temperature band 2 F higher | +0.61 / +0.62 | +1.8 / +1.2 | +17 / -4 | +2.7 / +4.3 | -0.1 / -1.6 | +3.8 / +8.6 | +9 / +12 |
| Band at sunrise 2 F lower | -0.16 / -0.17 | -0.2 / -0.2 | -4 / -1 | -1.3 / -0.2 | +0.6 / +0.7 | -2.5 / -3.2 | -5 / -4 |
| Band at solar noon 2 F lower | -0.07 / -0.08 | -0.6 / -0.5 | +1 / +7 | +1.4 / +0.4 | +0.4 / +0.7 | -0.5 / -0.7 | -1 / 0 |
| Band at sunset 2 F lower | -0.13 / -0.11 | -0.4 / -0.1 | -1 / +8 | +0.8 / +0.4 | -0.1 / +0.9 | -0.8 / -2.2 | -1 / +1 |
| Band at solar midnight 2 F lower | -0.02 / -0.05 | -0.3 / -0.2 | +1 / +2 | +0.3 / +0.3 | +1.3 / +1.3 | -2.8 / -3.6 | -4 / -3 |
| Low edge only, solar noon 2 F lower | -0.08 / -0.09 | -0.9 / -0.8 | -5 / -3 | -1.0 / -0.6 | -0.8 / -0.6 | +0.2 / +0.4 | -1 / 0 |
| Low edge only, sunset 2 F lower | -0.14 / -0.11 | -0.5 / -0.4 | -5 / -1 | -1.2 / -0.3 | -0.6 / -0.3 | -0.6 / -1.6 | -1 / +1 |
| Low edge only, noon and sunset 2 F lower | -0.23 / -0.20 | -1.4 / -1.1 | -10 / -4 | -2.2 / -0.7 | -1.4 / -0.8 | -0.2 / -1.1 | 0 / +1 |
| Low edge only, noon and sunset 4 F lower | -0.38 / -0.31 | -2.5 / -2.1 | -17 / -6 | -3.9 / -0.3 | -2.4 / -1.1 | -0.8 / -2.7 | +1 / +1 |
| Low edge only, sunrise and midnight 2 F higher | +0.32 / +0.34 | +0.8 / +0.6 | +11 / +4 | +4.2 / +1.8 | +0.7 / -0.1 | +2.0 / +5.5 | +7 / +15 |
| High edge only, noon and sunset 2 F higher | 0.00 / 0.00 | -0.3 / -0.5 | -7 / -14 | -3.1 / +1.8 | -0.8 / -1.6 | +0.3 / +1.2 | +1 / 0 |
| VPD high edge 0.10 kPa higher, all day | -0.08 / -0.04 | -0.6 / -0.1 | -20 / -11 | -4.3 / -4.4 | -0.4 / 0.0 | -0.2 / 0.0 | -1 / +1 |
| VPD high edge 0.10 kPa higher, noon and sunset | -0.05 / -0.03 | -0.5 / -0.1 | -15 / -8 | -2.5 / -3.7 | -0.4 / 0.0 | +0.3 / +0.5 | -1 / 0 |
| VPD high edge 0.30 kPa higher, sunrise and midnight | -0.07 / -0.01 | 0.0 / -0.1 | -9 / -6 | -2.3 / -0.8 | +0.5 / +0.2 | -1.3 / -0.9 | -1 / 0 |

Winter:

| Band edit (difference from the law on today's band) | Therms/day | kWh/day | Gallons/day | Starts/day | Run hours/day | Both in own band | Nights dried |
|---|---:|---:|---:|---:|---:|---:|---:|
| Whole temperature band 2 F lower | -0.74 / -0.71 | -2.2 / -1.2 | -25 / -6 | -7.0 / -2.2 | -1.5 / +0.1 | -5.7 / -9.4 | -17 / -12 |
| Whole temperature band 2 F higher | +0.96 / +0.92 | +2.7 / +1.3 | +39 / +18 | +10.4 / +5.1 | +3.1 / +1.2 | +2.3 / +8.8 | +10 / +16 |
| Band at sunrise 2 F lower | -0.25 / -0.23 | -0.1 / +0.1 | -7 / -2 | -2.6 / -1.2 | -0.1 / +0.4 | -1.9 / -3.6 | -8 / -7 |
| Band at solar noon 2 F lower | -0.11 / -0.10 | -1.2 / -0.8 | -8 / -2 | -0.8 / +0.2 | -0.9 / -0.5 | +0.6 / +0.6 | -2 / 0 |
| Band at sunset 2 F lower | -0.22 / -0.18 | -0.5 / -0.4 | -7 / -1 | -1.7 / +0.1 | -0.6 / -0.3 | -0.9 / -2.8 | -2 / +1 |
| Band at solar midnight 2 F lower | -0.05 / -0.10 | -0.5 / -0.3 | -1 / 0 | -0.5 / -0.8 | +0.6 / +0.8 | -2.1 / -3.2 | -7 / -5 |
| Low edge only, solar noon 2 F lower | -0.11 / -0.11 | -1.3 / -0.9 | -9 / -4 | -1.3 / -0.7 | -1.2 / -0.8 | +0.6 / +0.9 | -2 / -1 |
| Low edge only, sunset 2 F lower | -0.22 / -0.18 | -0.6 / -0.5 | -8 / -2 | -2.1 / -0.4 | -0.8 / -0.5 | -0.8 / -2.7 | -2 / +1 |
| Low edge only, noon and sunset 2 F lower | -0.35 / -0.29 | -1.9 / -1.3 | -17 / -6 | -3.5 / -1.0 | -2.1 / -1.1 | -0.1 / -1.6 | 0 / +1 |
| Low edge only, noon and sunset 4 F lower | -0.59 / -0.44 | -3.4 / -2.4 | -28 / -9 | -6.1 / -0.7 | -3.5 / -1.4 | -1.0 / -3.9 | +3 / -1 |
| Low edge only, sunrise and midnight 2 F higher | +0.53 / +0.51 | +0.6 / -0.1 | +16 / +5 | +6.4 / +3.2 | +0.8 / -0.2 | +2.9 / +8.6 | +9 / +22 |
| High edge only, noon and sunset 2 F higher | 0.00 / 0.00 | -0.1 / -0.2 | 0 / -1 | -0.2 / -0.7 | -0.1 / -0.3 | 0.0 / +0.2 | 0 / +1 |
| VPD high edge 0.10 kPa higher, all day | -0.15 / -0.06 | -1.0 / -0.1 | -29 / -8 | -6.3 / -2.5 | -1.2 / -0.3 | +0.4 / +0.2 | -1 / 0 |
| VPD high edge 0.10 kPa higher, noon and sunset | -0.08 / -0.05 | -0.9 / -0.1 | -22 / -7 | -4.6 / -2.2 | -0.9 / -0.2 | +0.4 / +0.2 | -1 / -1 |
| VPD high edge 0.30 kPa higher, sunrise and midnight | -0.12 / -0.01 | -0.1 / -0.1 | -10 / -1 | -2.4 / -0.5 | -0.4 / -0.1 | +0.1 / 0.0 | 0 / 0 |

- **The low temperature edge by day is nearly free to lower.** On a sunny day the sun carries the house above it anyway; on a dull day the edge is 72 to 74 F and the electric heater holds the house 3.5 to 4.5 F above it, at about 75.5 to 78.3 F. Two degrees lower at solar noon and sunset saves 0.23 / 0.20 therm and 1.4 / 1.1 kWh a day for -0.2 / -1.1 point of compliance.
- **The low edge at night is expensive to raise** (+0.32 / +0.34 therm a day for 2 F) and it buys dry nights (7 / 15 more in a hundred), because a warmer house is further from the VPD low edge. That is furnace heat spent for humidity by another route, so it belongs with decision 1.
- **The VPD high edge is the water lever:** 0.10 kPa higher saves 20 / 11 gallons and 4.3 / 4.4 starts a day. The 2026-11-05 amendment accepted dry winter nights for now, to be looked at again in December. The law does not: it holds the VPD high edge at every hour, which is why its winter water is 59 / 11 gallons a day against 26 / 4 today. Raising the edge at night alone is a weak lever, because most of that fog is used by day: 0.30 kPa higher at the sunrise and midnight anchors saves 10 / 1 gallons and 0.12 / 0.01 therm a day in winter, where 0.10 kPa higher at every hour saves 29 / 8 gallons. Raising this edge at every hour is how the owner keeps accepting dry winter air (decision 9).
- **The high temperature edge by day** costs no gas and saves water and fan hours (-7 / -14 gallons and -0.8 / -1.6 run hours a day).

Three combined edits, with today's firmware on the same bands for comparison:

| Controller and band | Both in own band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware, today's band | 70.5 / 59.6 | 57 / 38 | 135 / 142 | 24.5 / 28.2 | 19.6 / 21.0 | 2.18 / 2.70 | 63 / 56 |
| The law, today's band | 88.0 / 74.2 | 75 / 50 | 50 / 40 | 24.0 / 29.5 | 20.3 / 22.8 | 2.26 / 2.74 | 68 / 65 |
| The law, band 1: day low edge 2 F lower, VPD high edge 0.10 kPa higher | 87.5 / 73.0 | 75 / 51 | 43 / 36 | 22.5 / 28.8 | 18.6 / 21.6 | 1.96 / 2.52 | 41 / 52 |
| The law, band 2: band 1 and day high edge 2 F higher | 88.0 / 74.1 | 75 / 50 | 39 / 36 | 21.4 / 27.1 | 18.3 / 21.1 | 1.95 / 2.52 | 34 / 39 |
| The law, band 3: band 2 with the day low edge 4 F lower | 87.4 / 72.6 | 78 / 50 | 38 / 37 | 20.6 / 26.9 | 17.4 / 20.2 | 1.82 / 2.42 | 31 / 38 |
| Today's firmware, band 1 | 71.8 / 58.6 | 57 / 40 | 118 / 141 | 23.2 / 27.3 | 18.7 / 20.2 | 1.96 / 2.52 | 42 / 49 |
| Today's firmware, band 2 | 75.6 / 63.0 | 62 / 42 | 96 / 114 | 21.6 / 25.2 | 18.5 / 20.0 | 1.92 / 2.49 | 32 / 37 |
| Today's firmware, band 3 | 75.0 / 60.4 | 62 / 42 | 93 / 114 | 20.9 / 24.5 | 17.8 / 19.2 | 1.79 / 2.36 | 30 / 37 |

Winter:

| Controller and band | Both in own band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware, today's band | 79.2 / 63.5 | 59 / 26 | 89 / 84 | 25.6 / 28.1 | 28.0 / 29.2 | 3.51 / 4.25 | 26 / 4 |
| The law, today's band | 93.1 / 76.7 | 81 / 43 | 37 / 29 | 27.3 / 29.4 | 29.1 / 30.4 | 3.69 / 4.28 | 59 / 11 |
| The law, band 1: day low edge 2 F lower, VPD high edge 0.10 kPa higher | 93.3 / 75.1 | 81 / 44 | 27 / 27 | 24.4 / 28.1 | 26.6 / 29.0 | 3.20 / 3.97 | 19 / 2 |
| The law, band 2: band 1 and day high edge 2 F higher | 93.3 / 75.2 | 81 / 43 | 27 / 26 | 24.2 / 27.9 | 26.5 / 28.9 | 3.20 / 3.96 | 18 / 1 |
| The law, band 3: band 2 with the day low edge 4 F lower | 92.3 / 72.9 | 84 / 42 | 25 / 28 | 23.0 / 27.7 | 25.2 / 27.9 | 2.99 / 3.83 | 12 / 0 |
| Today's firmware, band 1 | 80.7 / 60.8 | 58 / 29 | 62 / 78 | 24.1 / 27.1 | 26.7 / 28.1 | 3.17 / 3.98 | 8 / 1 |
| Today's firmware, band 2 | 83.5 / 64.4 | 66 / 31 | 56 / 72 | 23.6 / 26.6 | 26.7 / 28.2 | 3.11 / 3.92 | 8 / 0 |
| Today's firmware, band 3 | 83.0 / 60.7 | 67 / 32 | 51 / 72 | 22.7 / 25.8 | 25.7 / 27.1 | 2.90 / 3.72 | 5 / 0 |

Summer:

| Controller and band | Both in own band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware, today's band | 59.3 / 54.6 | 55 / 54 | 194 / 218 | 22.9 / 28.2 | 8.7 / 10.4 | 0.45 / 0.69 | 111 / 123 |
| The law, today's band | 81.4 / 71.1 | 68 / 59 | 66 / 54 | 19.8 / 29.7 | 9.0 / 12.9 | 0.41 / 0.74 | 80 / 134 |
| The law, band 1: day low edge 2 F lower, VPD high edge 0.10 kPa higher | 80.1 / 70.3 | 67 / 60 | 64 / 47 | 20.0 / 29.7 | 8.2 / 11.8 | 0.34 / 0.65 | 69 / 117 |
| The law, band 2: band 1 and day high edge 2 F higher | 81.2 / 72.8 | 68 / 60 | 56 / 48 | 17.9 / 26.2 | 7.6 / 10.9 | 0.34 / 0.66 | 56 / 88 |
| The law, band 3: band 2 with the day low edge 4 F lower | 81.1 / 72.3 | 70 / 61 | 56 / 48 | 17.5 / 26.0 | 7.1 / 10.2 | 0.31 / 0.60 | 55 / 87 |
| Today's firmware, band 1 | 60.3 / 55.7 | 54 / 54 | 190 / 224 | 22.0 / 27.5 | 8.4 / 9.8 | 0.38 / 0.63 | 86 / 112 |
| Today's firmware, band 2 | 65.4 / 61.1 | 58 / 56 | 148 / 169 | 19.0 / 23.4 | 7.8 / 9.4 | 0.38 / 0.64 | 63 / 86 |
| Today's firmware, band 3 | 64.6 / 59.9 | 56 / 56 | 148 / 168 | 18.5 / 22.8 | 7.4 / 8.8 | 0.34 / 0.58 | 62 / 85 |

As change from today's firmware on today's band:

| Year, change from today's firmware on today's band | Relay starts | Run hours | Electricity | Gas | Water |
|---|---:|---:|---:|---:|---:|
| The law, today's band | -63 % / -72 % | -2 % / +5 % | +4 % / +8 % | +4 % / +1 % | +9 % / +16 % |
| The law, band 1: day low edge 2 F lower, VPD high edge 0.10 kPa higher | -68 % / -75 % | -8 % / +2 % | -5 % / +2 % | -10 % / -7 % | -35 % / -7 % |
| The law, band 2: band 1 and day high edge 2 F higher | -71 % / -75 % | -12 % / -4 % | -7 % / 0 % | -10 % / -7 % | -45 % / -31 % |
| The law, band 3: band 2 with the day low edge 4 F lower | -72 % / -74 % | -16 % / -4 % | -11 % / -4 % | -16 % / -10 % | -51 % / -32 % |

- On band 2 the law makes 71 / 75 % fewer relay starts than today's firmware does on today's band, runs 3.0 / 1.0 fewer hours a day and uses 45 / 31 % less water and 10 / 7 % less gas, while holding its band 88.0 / 74.1 % of the year. Electricity is -7 / 0 %: in model B it stays level, because the law dries nights that today's firmware leaves wet, and drying spends electric heat.
- Most of the utility saving is the band's, and most of the drop in relay starts is the law's. On band 2 itself the law differs from today's firmware by -0.2 / +1.9 run hours, -0.2 / +1.1 kWh, +0.03 / +0.04 therm and +3 / +1 gallons a day, with 57 / 78 fewer relay starts a day and 12 / 11 points more of the year in band.
- Band 3 goes further on every utility (-16 / -10 % gas, -11 / -4 % electricity) for a low edge of 68 to 70 F by day, with the house held near 72 to 74 F on a dull afternoon.
- Today's firmware saves about the same utilities on the same bands (the last three rows). The edits are worth weighing whichever controller runs, and they need no code: the band editor exists. What the law adds on any band is the compliance and the cycle count.

The edits are the owner's to make or not (decision 9).

### 5.8 Robustness to model error

Each row changes one fitted property of the house and re-runs four controllers over the year.

| Model changed by | Both % today | Both % step 2 | Both % law | Both % law, limit 0.7 | Starts/day today | Starts/day law | Therms/day law | Coldest F law |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Fitted model | 70.5 / 59.6 | 85.6 / 82.6 | 88.0 / 74.2 | 89.0 / 81.6 | 135 / 142 | 50 / 40 | 2.26 / 2.74 | 59.4 / 59.3 |
| Moisture source x 1.5 | 56.2 / 31.4 | 84.0 / 67.4 | 75.5 / 49.5 | 84.0 / 71.1 | 131 / 151 | 45 / 44 | 2.64 / 3.43 | 59.3 / 59.3 |
| Moisture source x 0.7 | 72.2 / 70.7 | 82.5 / 83.0 | 91.1 / 84.5 | 91.4 / 85.5 | 158 / 154 | 59 / 48 | 2.11 / 2.41 | 59.4 / 59.4 |
| Fan air flow x 2 | 73.2 / 63.7 | 86.2 / 85.4 | 84.5 / 74.0 | 87.8 / 82.9 | 129 / 136 | 57 / 57 | 2.28 / 2.73 | 59.4 / 59.2 |
| Fan air flow x 0.5 | 66.4 / 56.1 | 84.4 / 77.2 | 87.1 / 73.4 | 88.0 / 79.8 | 135 / 142 | 51 / 39 | 2.27 / 2.74 | 59.4 / 59.3 |
| Furnace heat x 0.7 | 69.7 / 57.7 | 84.8 / 80.4 | 86.4 / 72.2 | 87.4 / 79.6 | 126 / 133 | 46 / 34 | 3.07 / 3.76 | 55.5 / 53.1 |
| Electric heater heat x 0.8 | 69.5 / 59.2 | 85.4 / 82.1 | 87.1 / 73.5 | 88.6 / 81.7 | 133 / 142 | 50 / 40 | 2.51 / 3.01 | 59.3 / 59.2 |
| Envelope heat loss x 1.25 | 67.8 / 57.5 | 84.5 / 80.6 | 85.7 / 72.3 | 87.5 / 80.8 | 136 / 146 | 50 / 41 | 3.00 / 3.50 | 58.3 / 56.3 |
| Infiltration x 0.5 | 47.5 / 25.8 | 84.1 / 72.1 | 73.1 / 51.8 | 83.2 / 72.6 | 158 / 175 | 51 / 50 | 1.79 / 2.29 | 59.4 / 59.3 |
| Fog evaporation x 0.5 | 66.5 / 58.6 | 82.0 / 80.4 | 82.3 / 72.3 | 84.9 / 79.7 | 145 / 146 | 51 / 54 | 2.28 / 2.74 | 59.4 / 59.3 |
| Fog evaporation x 1.5 | 72.6 / 60.9 | 87.8 / 83.7 | 88.5 / 75.9 | 89.5 / 83.3 | 125 / 141 | 69 / 42 | 2.26 / 2.74 | 59.4 / 59.3 |
| Moisture buffer x 2 | 66.5 / 57.5 | 82.9 / 78.6 | 83.6 / 70.1 | 86.2 / 78.4 | 148 / 149 | 53 / 43 | 2.30 / 2.79 | 59.3 / 59.3 |
| Sensor lag x 2 | 68.3 / 58.8 | 84.4 / 80.7 | 87.3 / 74.8 | 88.5 / 81.2 | 127 / 134 | 44 / 41 | 2.30 / 2.82 | 59.3 / 59.2 |
| Electric heater dead | 67.1 / 56.8 | 84.0 / 79.6 | 84.0 / 69.3 | 86.9 / 81.1 | 129 / 140 | 49 / 41 | 3.71 / 4.24 | 59.3 / 57.9 |
| Furnace dead (gas outage) | 37.2 / 28.3 | 47.4 / 38.0 | 51.2 / 38.7 | 51.7 / 39.6 | 96 / 104 | 32 / 25 | relay time only | 23.5 / 22.2 |

- The law holds the band more than today's firmware in every row, by 10.3 to 25.9 points. With both heaters working its starts stay at 34 to 69 a day where today's firmware makes 125 to 175.
- The law is most sensitive to the moisture balance. With half again as much moisture source it holds 75.5 / 49.5 %, and with half the infiltration 73.1 / 51.8 %: those are the houses where drying matters most, and where a limit of 0 leaves the most nights humid. A limit of 0.7 recovers most of it (84.0 / 71.1 % and 83.2 / 72.6 %). This is the uncertainty behind decision 1, and phase 1 measures it (issue #1669). They are also the rows where today's firmware does worst.
- With the electric heater dead the furnace carries the house by temperature (84.0 / 69.3 % at 3.71 / 4.24 therms a day).
- A furnace that delivers 30 % less than its rating lets the house fall to 55.5 / 53.1 F on the coldest night (issue #1670).
- With the furnace dead, no controller holds the winter band: the electric heater alone leaves the house below the band 65 / 74 % of the winter and the coldest minute is 23 / 22 F. The figures for today's firmware and the step 2 patch in that row are not like for like: their cold-protection mode runs a fan with the vent closed, and the model charges that fan the full air exchange of an open vent.

## 6. Forecast pre-staging (constraint 10)

The constraint asks for pre-staging if it reduces resource use and run time. That was tested before deciding to build anything, with the most favourable assumption possible: the controller knows the coming outdoor temperature and sun exactly (the weather record itself), so the result is an upper bound on what a forecast could deliver for these rules. Two rows repeat a rule with a forecast error of up to 8 F.

Four rules were tried on top of the law: three act early and one holds back. Each has a trigger from the forecast and an action:

- **Pre-heat.** Trigger: the coldest outdoor temperature of the next 12 hours is more than 25 F below the band's lowest low edge, which is below about 36 F. Action: raise the electric heater's lines, by 0.5 F in one row and by 4.5 F in the next (to 1 F below the high edge), so that electric heat is banked before the furnace is needed. While it is active the cooling exit is 0.5 F instead of 2.0 F, so that cooling does not remove the banked heat.
- **Pre-cool.** Trigger: the warmest outdoor temperature of the next 6 or 8 hours is above the band's highest high edge (by more than 5 F, by any amount, or within 5 F below it), and the outdoor air is now at least 2 F cooler than the house. Action: start cooling 4 F below the high edge and stop 6 F below it.
- **Pre-dry.** Trigger: the outdoor air will be 10 or 20 F colder within 6 or 10 hours. Action: start and stop drying 0.10 kPa higher, while outdoor air is still cheap to bring in. Its stop line then sits above the fogger's off line.
- **Hold back.** Trigger: the sun on the house is above 300 W/m2 now, or will pass it within the next 3 or 6 hours. The sun is above that level 26 % of the year; with 3 hours of look-ahead the rule is active 42 % of the year, and with 6 hours 54 %. Action: lower the electric heater's lines by 0.5, 1 or 2 F, so that the sun supplies heat the heater would have supplied. Three forms were run. The heater's lines alone, 0.5 or 1 F lower, which keeps the heater's off line above the furnace's. The heater's lines and the drying start line 2 F lower, which puts the heater inside the furnace's swing. And the heater's lines, the drying start line and the furnace's off line together (the furnace's by the same amount, at most 1.5 F), which keeps the heater above a narrower furnace swing. Two rows repeat the 1 F forms with no look-ahead: the trigger is then the present sun alone, and no forecast is used.

Year, difference from the law:

| Pre-staging rule (year, difference from the law) | Share of time active % | Both in band | Therms/day | kWh/day | Gallons/day | Starts/day | Furnace starts/day | Run hours/day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Pre-heat: electric heater lines 0.5 F higher, 12 h ahead of a night more than 25 F below the band | 21.8 / 21.8 | +0.01 / -0.01 | 0.00 / 0.00 | +0.02 / 0.00 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | +0.01 / -0.01 |
| Pre-heat: electric heater lines 4.5 F higher, same trigger | 21.8 / 21.8 | +0.03 / -0.02 | 0.00 / 0.00 | +0.11 / +0.04 | +0.1 / 0.0 | 0.0 / -0.1 | 0.0 / 0.0 | +0.07 / +0.01 |
| The same with a forecast error of up to 8 F | 22.8 / 22.8 | +0.03 / -0.06 | -0.01 / -0.01 | +0.24 / +0.10 | +0.2 / 0.0 | 0.0 / -0.1 | -0.1 / -0.1 | +0.15 / +0.05 |
| Pre-cool: start cooling 4 F below the high edge, 6 h ahead of a day more than 5 F above the band | 1.4 / 1.3 | +0.05 / -0.03 | 0.00 / 0.00 | +0.02 / -0.01 | 0.0 / 0.0 | +0.7 / +0.3 | 0.0 / 0.0 | +0.29 / +0.07 |
| Pre-cool: the same, 6 h ahead of a day above the band | 3.9 / 3.7 | +0.03 / -0.07 | 0.00 / 0.00 | +0.09 / +0.03 | +0.3 / +0.4 | +1.7 / +0.8 | 0.0 / 0.0 | +0.68 / +0.31 |
| Pre-cool: the same, 8 h ahead of a day within 5 F of the band's high edge | 10.2 / 10.0 | -0.38 / -0.22 | +0.01 / 0.00 | +0.36 / +0.22 | +1.9 / +3.4 | +4.3 / +2.5 | +0.1 / 0.0 | +1.61 / +0.91 |
| Pre-cool (day above the band) with a forecast error of up to 8 F | 4.6 / 4.4 | -0.09 / -0.16 | 0.00 / 0.00 | +0.15 / +0.08 | +0.9 / +1.3 | +2.4 / +1.3 | 0.0 / 0.0 | +0.86 / +0.45 |
| Pre-dry: dry 0.10 kPa earlier when the next 6 h turn 10 F colder outdoors | 25.8 / 25.8 | -0.13 / +0.36 | 0.00 / +0.02 | +0.42 / +0.17 | +2.9 / +0.4 | +7.2 / +2.8 | 0.0 / +0.1 | +0.70 / +0.44 |
| Pre-dry: the same, 10 h ahead | 40.1 / 40.1 | -0.20 / +0.52 | 0.00 / +0.02 | +0.55 / +0.26 | +3.6 / +0.8 | +10.1 / +4.1 | 0.0 / +0.1 | +0.94 / +0.63 |
| Pre-dry: when the next 10 h turn 20 F colder outdoors | 11.3 / 11.3 | -0.15 / +0.19 | 0.00 / +0.01 | +0.21 / +0.06 | +1.7 / 0.0 | +4.3 / +0.6 | 0.0 / 0.0 | +0.35 / +0.13 |
| Hold back: electric heater lines 1 F lower while the sun is on the house (no forecast) | 25.6 / 25.6 | -0.12 / -0.07 | +0.04 / +0.03 | -0.63 / -0.72 | -0.7 / -0.4 | +0.1 / +0.4 | +0.2 / +0.2 | -0.42 / -0.48 |
| Hold back: heater lines, drying start and furnace off line 1 F lower while the sun is on the house (no forecast) | 25.6 / 25.6 | -0.13 / +0.13 | +0.01 / +0.01 | -0.56 / -0.56 | -1.5 / -1.1 | +0.5 / +0.4 | +0.5 / +0.5 | -0.38 / -0.35 |
| Hold back: electric heater lines 0.5 F lower from 3 h ahead of sun | 42.2 / 42.2 | -0.14 / -0.11 | +0.02 / +0.01 | -0.45 / -0.39 | -0.7 / -0.2 | -0.2 / 0.0 | +0.1 / +0.1 | -0.32 / -0.27 |
| Hold back: electric heater lines 1 F lower, 3 h ahead | 42.2 / 42.2 | -0.17 / -0.26 | +0.04 / +0.03 | -0.91 / -0.96 | -1.4 / -0.5 | -0.3 / +0.3 | +0.2 / +0.2 | -0.62 / -0.64 |
| Hold back: electric heater lines and drying start 2 F lower, 3 h ahead (inside the furnace's swing) | 42.2 / 42.2 | -0.24 / +0.88 | +0.21 / +0.25 | -3.06 / -3.51 | -2.9 / -1.4 | +2.9 / +6.5 | +0.8 / +0.8 | -1.84 / -1.69 |
| Hold back: the same with the furnace's off line 1.5 F lower | 42.2 / 42.2 | -0.18 / +0.81 | -0.02 / +0.01 | -1.38 / -1.37 | -6.6 / -3.6 | +3.2 / +7.5 | +3.5 / +4.1 | -0.93 / -0.37 |
| Hold back: heater lines, drying start and furnace off line 1 F lower, 3 h ahead | 42.2 / 42.2 | -0.12 / +0.05 | -0.04 / -0.03 | -0.70 / -0.66 | -4.1 / -2.5 | +1.0 / +1.9 | +1.7 / +1.9 | -0.55 / -0.35 |
| Hold back: heater lines and drying start 2 F and furnace off line 1.5 F lower, 6 h ahead | 54.3 / 54.3 | -0.13 / +1.80 | +0.01 / +0.10 | -1.59 / -1.54 | -7.3 / -3.7 | +7.5 / +16.3 | +5.4 / +6.9 | -0.75 / +0.24 |

- Pre-heating changes gas by -0.01 to 0.00 therm a day and electricity by 0.00 to +0.24 kWh a day.
- Pre-cooling changes compliance by -0.38 to +0.05 point and adds 0.3 to 4.3 starts and 0.07 to 1.61 run hours a day.
- Pre-drying adds 0.6 to 10.1 starts a day and changes gas by 0.00 to +0.02 therm, for a change in compliance of -0.20 to +0.52 point.
- Holding back the electric heater's lines alone, 1 F from 3 hours ahead of sun, saves 0.9 / 1.0 kWh and 0.6 / 0.6 run hours a day and costs 0.04 / 0.03 therm a day, with relay starts changed by -0.3 / +0.3 a day and compliance by -0.2 / -0.3 point. The furnace replaces part of the electric heat that is removed (0.45 / 0.39 kWh more furnace heat for 0.88 / 0.95 kWh of electric heat a day), so this form moves heat from the electric heater to the furnace, against constraint 5. At 0.5 F the energy figures are about half.
- Two degrees puts the heater's lines inside the furnace's swing: 3.1 / 3.5 kWh a day saved for 0.21 / 0.25 therm burned, which is 6 / 7 kWh of fuel.
- Holding back the heater's lines and the furnace's off line together (1 F, 3 hours ahead) saves 0.70 / 0.66 kWh, 0.04 / 0.03 therm and 0.6 / 0.3 run hours a day, for 1.7 / 1.9 more furnace starts a day: the furnace's swing is narrower while the rule is active. Two degrees or six hours ahead save more electricity and add more furnace starts (5.4 / 6.9 a day at 6 hours), and at 6 hours gas changes by +0.01 / +0.10 therm.
- Most of the heater-only saving needs no forecast. With the present sun alone as the trigger it saves 0.63 / 0.72 kWh and 0.42 / 0.48 run hours a day and costs 0.04 / 0.03 therm. The 3 hours of look-ahead save a further 0.28 / 0.24 kWh and 0.20 / 0.16 run hours. In the form with the furnace's off line the look-ahead is what saves the gas: on the present sun alone that form saves 0.56 / 0.56 kWh, changes gas by +0.01 / +0.01 therm and adds 0.5 / 0.5 furnace starts a day.
- Against the same lines lowered at every hour (section 5.6), the 3 hour forms get about half of the electricity saving while they are active 42 % of the time, and at a smaller price. The heater-only form loses 0.2 / 0.3 point of compliance where the all-hours row loses 1.0 / 1.5. The form with the furnace's off line adds 1.7 / 1.9 furnace starts where the all-hours row adds 5.3 / 6.5.

Acting early saves nothing because of the house. It loses heat with a time constant of 5.6 hours (review section 4.4), so most of the heat banked in the afternoon has leaked away before the coldest hours, and a house held warmer in the meantime loses more. Moisture leaves faster still. Cooling early costs fan hours for air that warms again before the peak.

**What holding back comes to.** It is the one rule here that saves anything, and the saving is a few percent. The heater-only form saves 4 / 4 % of the electricity and 3 / 2 % of the run hours and uses 2 / 1 % more gas. Of its electricity saving 70 / 75 % comes from the present sun, and the look-ahead saves a further 1 / 1 % of the electricity. The form with the furnace's off line saves 3 / 3 % of the electricity and 2 / 1 % of the gas with 19 / 16 % more furnace starts, and there the forecast is what saves the gas. Each form pays with something another constraint protects: heat moved from the electric heater to the furnace (constraint 5), or furnace starts (constraint 3). The figures assume the sun is known exactly.

The same kind of saving is available from the band with no forecast. The low edge climbs about 11 F between sunrise and solar noon, and the heaters follow it. Lowering that edge 2 F at solar noon and sunset saves 0.23 / 0.20 therm and 1.4 / 1.1 kWh a day averaged over the year, with no forecast and no sun reading (section 5.7). It also lets the house be 2 F cooler by day, which is the owner's choice of band (decision 9). A hold-back is the refinement that acts only on sunny days and only on the heaters' lines.

**What was not simulated.** Putting drying off until the outdoor air is cheaper. Its saving is bounded by what drying costs at a limit of 0: 1.0 / 1.4 kWh and 0.01 / 0.04 therm a day against never drying. It could reach that bound only by giving up dried nights.

**Conclusion.** No rule that acts early reduces resource use or run time in this house. Holding the electric heater's lines lower while the sun is on the house does, by a few percent, and it pays for that with gas in place of electric heat or with furnace starts. Most of it needs no forecast. The forecast's own share is 1 / 1 % of the electricity, or the gas saving of the form that adds furnace starts. The first release has neither rule: the law is accepted on the controller first, and the hold-back is put to the owner as decision 15 with these figures. If it is built, the present-sun form reads the weather station's light reading, which the controller already receives for the lighting decision with a freshness check (`tempest_lux`, `firmware/greenhouse/controls.yaml:2185-2204`), with its threshold set in that reading's unit from the record. The look-ahead form adds one optional input, a "sun expected" flag from the host that expires by itself. The law runs as specified without either, so constraint 1 is not affected. The forecast-action engine is removed either way (issue #1653): of its 142,434 logged evaluations 98.96 % were no-ops and its last write to the controller was on 2026-10-05. The hourly forecast fetch stays for the dashboard and the reviewer, who can warn of a cold snap that exceeds the furnace (issue #1670) and price a temporary band edit for it. The answer would change if the house gained thermal mass, for example water storage; the test is one simulator run and can be repeated then.

## 7. The planner's role

Under the law there is no climate actuator setting left to tune: of the 48 settings the planner writes today, the soft water budget stays as an irrigation setting that the owner sets (decision 11), and the rest become compiled constants or disappear. The question that remains is whether the planner writes anything at all.

What the record says (review section 7): on 44 of 94 days no planner value reached the controller and the planner kept planning; re-planning showed no measurable benefit over holding the last plan (plus 1.7 points, interval -5.7 to +9.1); 505 of 960 wake-ups ended in an acknowledgement with no change; each waypoint is computed against the band at the moment of writing, for up to 72 hours ahead.

**Recommendation: the planner becomes a reviewer** (decision 4).

- Once a day it reads the record: compliance, relay starts and hours, utilities, the drying meter, alerts, and the forecast.
- It writes a short review to the existing journal. Where the record supports it, it proposes a band edit and quotes its simulated price from section 5.7. The owner makes the edit in the band editor or does not.
- It writes no climate value to the controller, directly or through a setting. That has to be enforced, because the general settings tool (`set_setting` in MCP) today lets an agent write any writable row, band anchors included, and an agent's write wins over everything but a person's. The tool is limited to the operator switches for an agent, and a test checks that an agent's write to a band row is refused.
- It keeps its irrigation tools (schedules, line settings, run, stop, clear fault, status). They do not use the climate write path. Three things tie them to the plan cycle and are edited with it: the prompt tells Iris to end every wake-up with `set_plan` or `acknowledge_trigger`; three of the write tools take an optional `trigger_id` and `planner_instance`, which are only logged, and the review passes its own run id; and the tests that assert both (`tests/test_mcp_irrigation_write_tools.py`, `tests/test_dashboard_db_mcp_irrigation_writes.py`), with the Iris tool-count test (`tests/test_mcp_irrigation_write_tools.py:253-264`) and the five files it reads, which change together when the plan tools go.

**When Iris can act on irrigation.** Iris acts only when it is woken, and only the trigger matrix wakes it: midnight, sunrise, solar noon, two transitions, sunset, a weekly run, a forecast deviation and a manual trigger (`ingestor/tasks/_common.py:853-945`), about eight times a day. Nothing in irrigation wakes it. The `irrigation_changed` and `desired_state_changed` notifications wake the ingestor's irrigation sync and the dispatcher (`ingestor/ingestor.py:5023-5049`), not the planner, and they stay as they are. With one review a day Iris can change irrigation once a day and on a manual trigger. The record says that loses nothing seen so far: in the twelve days the activity log covers (from 2026-11-03) there are 24 irrigation writes, from the dashboard, the release work and another agent, and none from Iris. If the owner wants Iris to act on irrigation more often than daily, a second run is one more trigger of the same kind (decision 4).

The alternatives are a planner with bounded authority over the band (it could move anchors within an envelope the owner sets) and no planner. Bounded band authority keeps an AI in the loop but adds a writing path whose effect the record could not show, and it makes the band a moving target for the compliance figure. No planner loses the daily reading of the record, which is where a language model is useful. Neither changes anything on the controller, so the choice can be made late.

What goes with the planner's write role, in every layer: the 15-field intent and its mapping to 39 settings, the plan waypoints and their table, `set_plan` and `set_tunable`, the trigger matrix and the forecast-deviation trigger, the planner study, the planner scoring views, the planner service-level alerts (one alert remains: the daily review did not run), and the idle second planner (issue #1652). Section 8 lists them by file.

## 8. Changes by layer

Each table lists what stays, what goes and the issue that carries it. "New" means no filed issue covers it yet (section 11.3). Line counts are from the review's inventory of the code at commit `ae486ddb`.

### 8.1 Firmware

| Item | Today | Target | Issue |
|---|---|---|---|
| Mode decision: `determine_mode_band_first`, `determine_mode` and its legacy cascade, the candidate ranking, `evaluate_overrides`, `resolve_equipment` (`firmware/lib/greenhouse_logic.h:781-1250`, `1556-2835`) | about 1,750 lines | A new `climate_law.h` of about 150 lines taken from the reference implementation, with host tests | #1671 (amended), #1647 |
| Moisture-exchange estimator, economiser, night dry-out helpers, wet-taper and fog-hour shims, band pinch, centre-burst helpers (`greenhouse_logic.h:202-455`, `477-485`, `581-654`, part of `655-780`) | about 350 lines | Removed. Lines `456-476` hold three time helpers that the lighting window calls (`lighting_in_window`, `:1296-1310`); they stay. | New; #1648, #1655 for the dead parts |
| `Setpoints` struct | 74 fields | Removed. The law takes the four band edges; the constants are compiled. | #1648 (26 fields), new for the rest |
| Modes, actions, mist stages, control state | 8 / 11 / 4 / 28 fields | Nine latches and the counters | #1671 |
| Relay layer: minimum times in `set_relay` (`firmware/greenhouse/controls.yaml:120-181`), `arbitrate_relay_conflicts` (`greenhouse_logic.h:2937-3023`), the fan lead helper (`1251-1284`) | timers start at zero at boot; arbitration cuts the heaters when the vent opens; the lead swaps during a run and on a timer; starts and run times reset at midnight and on reboot | Section 4.3: relays available at boot, three rules in place of the arbitration, a lead chosen while both fans are off, starts and run seconds saved hourly | #1671, new |
| Policy-vector engine | 1,948 lines, 216 gated reads, off in every deployment | Removed. `policy_sha256.h` and `policy_hex_decode` stay (the irrigation engine uses them). | #1650 |
| Climate settings in `tunables.yaml` | 102 entities | 2: `sw_occupancy_inhibit` and the soft water budget, which belongs to irrigation (section 8.7). `manual_override_timeout_min` also stays. | #1651 (amended), #1648 |
| Climate readbacks in `sensors.yaml` | 148 | 18: 16 anchors, the drying cost limit and the water budget (26 while the target curves stay) | #1651 (amended) |
| `set_band_anchor` keys (`firmware/greenhouse.yaml:217-282`) | 56 | 18: 16 edges, the drying cost limit and the manual override timeout (26 with the target curves) | #1663, new |
| Per-zone mister VPD curves: 24 anchors, 24 readbacks, 4 pushed scalars; 4 zone ranks | read only by the mister logic | Curves removed; the engine's ranking is fed from the house band and compiled ranks (section 4.8, decision 5) | New |
| Mister state machine and its zone-choice mechanisms (`controls.yaml:977-1694`) | about 720 lines | A pulse request to the irrigation engine through the grant. The engine's ranking stays. The fairness rule is in this code (`:1400-1420`) and is carried into the pulse request (section 4.8). | #1671, #1655 |
| Telemetry strings and JSON (`controls.yaml:1696-2102`) | about 400 lines | One compact state record: latches, the reason drying is refused, drying cost, outdoor source, clock state, band source. The three solar-time publications stay (the dashboard's Light series reads them). The mode-era strings and the outdoor freshness fields that the OTA gate reads stay through phase 3 and go in phase 4 with their host readers (section 11.1). | New |
| ROM band anchors (`firmware/greenhouse/globals.yaml:606-631` and following) | a deliberately drier view of `band_defaults.yaml`, enforced in CI | Unchanged. If the target curves go (decision 6), the CI rule is restated on the edges. | - |
| `wifi.reboot_timeout` (`firmware/greenhouse.yaml:178`) | 300 s | 0 s; a long timeout once the clock chip is fitted (decision 8) | New |
| Time validity (`controls.yaml:427`) | valid time is trusted | A separate trust flag for the band's clock (section 4.9). `controller_time_valid` and the solar times that lighting and irrigation read are not touched. | #1638 (amended) |
| Band validation (`validate_setpoints`, `greenhouse_types.h:864-895`) | repairs an inverted band with gaps of 5 F and 0.1 kPa, keeps the temperature edges 5 F inside the protection limits and the VPD edges within 0.1 to 5.0 kPa | Adds the two widths, the widening and the 0.3 to 3.0 kPa limits of section 4.1. Ships with the law (phase 3). | New |
| Restart on a silent sensor bus (`controls.yaml:2340-2376`) | two rules, one skipped while the clock is invalid | One rule, at most once an hour; the window is a constant | New |
| No-clock behaviour (`controls.yaml:428-438`) | phase frozen at noon of day 172, fog and misters refused | The widest corridor; fog and misters allowed | New |
| Substituted sensor values (`controls.yaml:241-247`, `266-269`) | 65 F and 50 % | Case sensor less its offset for the temperature rules, then a sensor fault with a defined safe state | #1643 |
| Outdoor data | weather station only; the wired intake probe feeds the economiser and has no age stamp | Station, then intake probe with its own age stamp; otherwise none | New |
| Firmware tests and CI gates: `test_greenhouse_logic.cpp` (6,210 lines, 297 calls into the removed functions), `replay_overrides.cpp`, `replay_invariants.cpp` and `invariants.h` (933 lines), the replay diff gate at zero tolerance bound to a hash of the logic, the replay header check, the policy-consumer manifest check, the recovery image | written against the mode logic | Rewritten for the law. Native tests run the reference implementation's vectors; the replay compares the firmware's law with the reference; the minimum-dark invariant, which is lighting's, stays; the release that replaces the logic carries an accepted-divergence record. This is the largest single piece of firmware work in the plan. | #1647 (amended), new |
| Lighting blocks, irrigation engine, solar ephemeris, psychrometrics, manual override latches, occupancy | | Unchanged (sections 8.7, 8.8) | - |

### 8.2 Registry and schemas

| Item | Today | Target | Issue |
|---|---|---|---|
| `verdify_schemas/tunable_registry.py` climate rows | 161 of 206 rows | 19: 16 anchors (or 24), the drying cost limit, the occupancy inhibit and the water budget, which moves from planner-written to owner-set. The manual override timeout, the lighting rows (24) and the irrigation rows are unchanged. | #1651 (amended), #1648 |
| Planner-writable rows | 48 on the wire (49 carry the flag; MCP refuses one) | 0. The wire metadata goes in the same change: `wire_id`, `wire_kind`, `wire_scale`, the field-count constant and its import-time check (`tunable_registry.py:3860-3868`, `:3917`), together with `policy_vector.py`, `policy_arbiter.py` and the research imports that read them. | #1646 (amended), #1650 |
| Law constants | typed in the firmware, the registry, the dispatcher, the alerts and SQL | One file `verdify_schemas/climate_law.yaml`. Generated from it: the firmware header, a Python module for the alerts and the band editor, a SQL constants function for the band timeline and the Grafana thresholds, and the documentation table (section 9). | New |
| `band_defaults.yaml`, `band_profile.py`, `band_rows.py`, `solar.py`, `setting_values.py` | band definition and editor | Kept. `band_defaults.yaml` stays the committed source of the seed and the ROM band. Zone sections, the night bias in the two curve copies and the season scoring are removed. `band_profile.py` holds the one Python copy of the curve. The editor's checks gain the widths and the night-floor rule of section 4.1 before the law ships. | New (item 12 in section 11.3) for the editor's checks; #1663 for the rest |
| `climate_intent.py` (652 lines), plan waypoints in `plan.py`, `planner_proposal.py`, `planner_study.py` and its YAML | the planner's write surface. `climate_intent.py` also holds the action, axis and assist vocabularies and the intent version that the telemetry schema (`verdify_schemas/telemetry.py`), the action-log writer (`ingestor/ingestor.py:2404-2653`) and the OTA gate read. | Removed; `plan.py` shrinks to the review record. The vocabularies and the intent version stay until phase 4 has moved their readers (section 11.1). | #1646 (amended), new |
| `policy_vector.py`, `policy_transport.py`, the component, experiment and fixed-panel schema modules | experiments | Removed, except what the irrigation push uses | #1649, #1650, #1635 |
| `irrigation.py` and the three irrigation site rows | | Unchanged | - |

### 8.3 Ingestor

| Item | Today | Target | Issue |
|---|---|---|---|
| Dispatcher (`ingestor/tasks/dispatcher.py`, 2,164 lines) | reads the plan, overlays desired state, clamps, pushes defaults, zone scalars and experiment overlays | Pushes anchors and the drying cost limit on change or mismatch, and the operator switches. The lighting block (`:1329-1368`) is unchanged except that it no longer skips a value held by a plan row (`:1365`). `_heap_push_defer_active`, which the irrigation task imports, stays. The desired-state overlay (`:1478-1540`) is how a lighting override and an operator switch reach the controller; it stays, without its plan, experiment and guardrail inputs. | #1663, #1654, new |
| Moisture guardrail and its clamp audit (`dispatcher.py:964-1021`) | rewrites planner values | Removed: nothing is left to clamp | #1654 |
| Duplicate default blocks (`dispatcher.py:418`, `:426-433`, `:1384-1414`) | second and third copies of safety and mister defaults | Removed | #1663 |
| `band_source()` hatch (`ingestor/tasks/band_anchors.py:129-140`) | switch between band sources | Removed; the lighting override path that it gates becomes unconditional | #1663 |
| Delivery confirmation | three mechanisms | One, for every pushed value: anchors, the drying cost limit, operator switches and the 24 lighting values are each compared with their readback. This is the existing snapshot confirmation, which the lighting policy functions depend on. One alert on an unconfirmed value remains of the two kinds there are today. | #1636 (amended), new |
| Forecast-action engine (`scripts/forecast-action-engine.py` and its task, 667 lines) | 98.96 % no-ops | Removed | #1653 |
| Forecast-deviation trigger (`ingestor/tasks/forecast.py:364-564`) | wakes the planner | Removed | #1653, #1660 |
| Planner runtime: `iris_planner.py` (1,623 lines), `planning_heartbeat` (1,704), routing, fallback and memory ingest (953), `scripts/gather-plan-context.sh` (1,848) | the plan cycle, 6,128 lines | A daily review: one trigger (a periodic task or a CronJob), one call, a short context. The irrigation section of the context and the manual trigger stay. Nothing in irrigation wakes the planner today (section 7). | #1646, #1660, #1652 |
| Experiment workers | 7,391 lines, 21 % of the ingestor, plus 3,545 test lines | Removed | #1649, #1650 |
| Alert rules on the climate path (26 kinds) | | Keep the outcome and equipment alerts: `house_band_drift`, `vpd_stress`, `vpd_extreme`, `temp_safety`, `relay_stuck`, `heat_manual_override`, `band_device_db_divergence`, one delivery alert, the state-record freshness alert, and `heat_staging_inversion`, which is the only check of constraint 5 and is redefined on relay events alone. `safety_invalid` is replaced by the constants-hash check. Remove those on modes, planner settings and experiments. Add: clock unconfirmed, band from ROM, no outdoor source, relay starts above their norm, daily review missed, heater on with no power drawn (issue #1637), compiled constants differ from the release. About 17 kinds. | #1664 (amended) |
| `forecast_sync`, occupancy sync, the irrigation task and its two listeners, the lighting paths | | Unchanged. The occupancy push goes out on change instead of on every pass. | - |
| Entity map and storage for what the law publishes (`ingestor/entity_map.py`) | no entries | Entries and storage for the relay counters, the state record, the drying meter, the constants hash, the clock flag and the band source; the registry row, the push and the editor field of the drying cost limit. Each ships before the firmware that publishes it, so that a flash needs no host change. | New |
| `grow_light_daily` | writes the whole `daily_summary` row | Its lighting parts are unchanged; section 10 extends the record it writes | #1668 (amended) |

### 8.4 Database

| Item | Today | Target | Issue |
|---|---|---|---|
| `setpoint_plan`, `setpoint_clamps`, `forecast_action_log`, `forecast_action_rules` | 123 MB, 53 MB, 49 MB and a short rule list | Dropped, after their dependents (below) | #1646, #1654, #1653 |
| Planner cycle tables: `planner_trigger_ledger`, `plan_delivery_log`, `daily_plan_archive_audit`; `forecast_deviation_log`, `forecast_deviation_thresholds` | written by the plan cycle and the deviation trigger | Dropped with their writers. `planner_lessons` follows decision 4. | #1646, #1653, #1660 |
| Experiment tables, functions, triggers, views and roles | 71 tables, about 175 functions, 97 triggers, 17 views, 14 roles; `fixed_panel_native_events` alone 2,878 MB | Dropped. `fn_mcp_armed_assignment_context` is redefined because the irrigation context calls it. | #1635, #1649, #1657 |
| Idle planner tables | 3 with no rows, 2 shadow | Dropped | #1652 |
| `setpoint_snapshot` | 962 MB; 57 % of rows are constants | Stored on change; about 40 parameters instead of 191, which include the 24 lighting readbacks and the water budget readback | #1662 |
| `setpoint_changes` | 318 MB; mostly band-anchor re-assertions from June and July, since fixed | Kept; small | #1663 |
| `crop_band_anchors` | 24 house rows, 16 zone rows, 12 crop temperature rows; rows are chosen by season and growth stage | 16 house rows (or 24), constrained to one season and one growth stage, because the controller has neither. Zone rows dropped. The 12 crop rows need their reader traced first. | #1663, new |
| `fn_house_vpd_control_band` | a further definition of the VPD band: the median of the zone crop curves, a 0.55 kPa minimum width and a 0.20 kPa low margin, typed again in `ingestor/tasks/_common.py:155-158`. It is behind `fn_setpoint_at` and the `vpd_stress` alert, `v_band_device_divergence`, `fn_band_timeline`, API `/setpoints`, the dispatcher and the setpoint server. | Redefined as the house anchor curve; the two constants deleted | New |
| `fn_zone_vpd_targets`; the crop-profile fallback in `fn_center_band_setpoints` | further definitions of a band. Read by `verdify_services/series.py:1360`, `api/main.py:1852`, the Grafana home dashboard, `dispatcher.py:1098`, `scripts/setpoint-server.py:310`, the function above and the materialized view `mv_band_curve`, which a CronJob refreshes (`fn_refresh_mv_band_curve`) and the boundary digest counts. | Dropped after each reader is repointed to the house curve. `mv_band_curve` is redefined on the house curve or dropped in the same migration, with its refresh step and its entry in the digest's relation list. | New |
| `fn_band_timeline` (57 columns) | re-derives firmware thresholds in SQL | Band edges and the law's lines from the generated constants | New |
| `climate_action_log` | 768 MB; one row a minute with a JSON copy of the device state; band columns stale since July | The law's state on change and one plain row a minute as a heartbeat. The OTA gate reads its freshness (section 8.5). | #1665 (amended) |
| Planner scoring views and functions | | Replaced by served-band compliance and the daily cycles and utilities record | #1659 (amended) |
| `fn_band_compliance_5m` and its daily table | the one compliance definition | Kept; it grades the signal the controller controls on (section 9) | #1667 |
| `daily_summary` | per-relay cycles and run times, estimated kWh and therms from `v_runtime_energy_daily` and `resource_coefficients` | Kept and reused for section 10. The furnace's 0.75 therm an hour goes into `resource_coefficients`; no second definition of therms. | #1668 (amended) |
| `climate`, `equipment_state`, `system_state`, `desired_state`, `weather_forecast`, `alert_log`, `plan_journal` | | Kept | - |
| Irrigation tables and views, lighting functions and views, `crops`, `crop_target_profiles`, the solar functions | | Unchanged (sections 8.7, 8.8) | - |

**Order of the drops.** A plain drop fails or, with `CASCADE`, silently removes things irrigation and the dashboard need. Each migration follows these rules:

1. Code first: a release removes every reader of an object before the migration that drops it. The dispatcher, for one, reads `fn_zone_vpd_targets` at the top of each pass, before its lighting block; dropping the function first would stop lighting delivery.
2. `v_irrigation_schedule_current` joins `v_active_plan`, which reads `setpoint_plan`. The irrigation view is redefined without the plan source (it already falls back to the controller's state, then readbacks, then defaults); then `v_active_plan`, `v_setpoint_forward` and the per-role plan views of migration 268 are dropped; then the table. The irrigation view reports the clocked schedule that the irrigation engine replaced; removing it is irrigation clean-up and belongs to issue #1655, not here. `v_active_plan` is also read by `verdify_services/settings.py`, `verdify_services/reads.py`, `api/main.py`, `mcp/server.py`, the dispatcher and `scripts/setpoint-server.py`. `setpoint_plan` is read directly by the ingestor's action-log writer (its plan-context query, `ingestor/ingestor.py:2404-2417`) and by the lab site publisher (`scripts/generate-daily-plan.py`, `scripts/generate-ai-tunables-page.py` and the publisher's plan view of migration 268); a failed publisher step blocks the site rebuild, so these are removed or repointed first. `scripts/generate-lessons-page.py` follows decision 4. `setpoint_clamps` is read by the settings path (`verdify_services/settings.py`, `verdify_services/reads.py:1051`), which drops its clamp joins before the table goes.
3. The dashboard login's self-check (`fn_attest_login`, migration 282) names `setpoint_plan` and five experiment tables. Once they are gone the check raises an error on every pooled connection and every dashboard route fails, the irrigation and light routes included. It is redefined in the same migration as the drop, with the two login checks of migration 276 that name an experiment table.
4. Two boundary digests are checked when a runtime connects. `fn_runtime_ordinary_boundary_digest` (the API and ingestor receipts) lists 48 protected relations, 30 helper functions and 20 internal callees by name and checks the counts. `fn_mcp_runtime_boundary_digest` (`mcp_runtime_boundary_receipt`) is computed over the MCP roles' privileges, so it changes with every dropped object MCP can touch; a stale receipt stops every MCP tool, the irrigation tools included. Every drop migration rewrites the lists and the counts and re-seals the receipts, as migrations 286 and 309 did. Acceptance is that the ingestor, the API and MCP start and pass their login attestation after the migration.
5. `db/schema.sql` predates migration 290 and still contains objects that migration 309 dropped. The inventory and the CI check below are based on a replay of the migrations into a scratch database, not on that file.

The drops ship one migration per release with an archive dump taken first, not a soak. About 3.1 GB is dropped and about 0.7 GB more is saved by storing snapshots on change (an estimate), of the 9.3 GB measured before migration 309. About 80 tables go: 71 experiment tables and the plan, forecast and planner tables above; the replay gives the final count.

### 8.5 API, MCP and dashboards

| Item | Today | Target | Issue |
|---|---|---|---|
| MCP `set_plan` (`mcp/server.py:3798-4386`), `set_tunable` (`:3231`), `policy_template_propose` (`:4390`) | climate write tools | Removed | #1646 (amended), #1649 |
| MCP `acknowledge_trigger`, `plan_run`, `plan_status`, `plan_evaluate` | plan cycle | Removed or reduced to the review | #1659, #1660 |
| MCP `set_setting` (`:5387`) | writes any writable row for an agent, band anchors included | Kept; for an agent, limited to the operator switches | New |
| MCP `settings`, `get_setpoints`, `band_profile`, `band_profile_preview`, the read tools | | Kept; the settings catalogue shrinks with the registry | - |
| MCP irrigation tools (8) and soil tools (2) | three write tools take an optional `trigger_id` and `planner_instance`, which are only logged | Unchanged; the review passes its own run id | #1646 (amended) |
| HTTP experiment routes | 12 | Removed | #1649 |
| HTTP `PUT /band/profile`, `PUT` and `DELETE /settings/{param}`, the read routes | | Kept. The band editor gains one field, the drying cost limit, and stores the four edges. | New |
| HTTP planner routes and the planner study runner | 5 | The review, or removed | #1646 |
| `/setpoints` on the setpoint server | two script readers (`scripts/audit-lighting-automation.py`, `scripts/liveness-check.sh`) | Removed after they are repointed. Its `/lights` routes are the light switch path and stay. | #1656 |
| The OTA gate and the health checks: `scripts/firmware-deploy-preflight.sh:116-165` and `:228-243`, `scripts/liveness-check.sh`, `scripts/k3s-smoke.sh` (through `/health`), `scripts/validate-climate-authority-post-deploy.sh`, the API's action-proof query (`api/main.py:1362`, used by three routes), the `climate_action_proof_stale` alert | require a `climate_action_log` row younger than 300 s that carries the action, the priority axis, the intent version, the targets and their deltas. The preflight also requires an outdoor reading under 10 minutes old, which it reads from the moisture-exchange JSON in the action log. | Read the law's state record and its heartbeat, and the law's outdoor source and its age. Until they do, the controller keeps publishing the action, the axis and the outdoor freshness fields, and the ingestor keeps writing the intent version, the band, the targets and the deltas; otherwise no flash passes the gate, a rollback included (section 11.1). | New |
| Operator dashboard and the 15-minute brief: `/now` (`verdify_services/reads.py`), `api/greenhouse_brief_job.py`, the plan card, planner health and plan lanes components | read the mode, its reason, the fog and moisture block reasons and the plan routes | The law's state and reasons; the plan components removed or replaced by the review. `Leak` and `ReadbackState` in `reads.py`, which irrigation imports, stay. | New |
| API `/health` (`api/main.py:2043`) and the scorecard fetch (`api/main.py:1240`) | read `v_planner_performance` and `fn_planner_scorecard` | Repointed to compliance and the review | #1659 (amended) |
| Grafana | `setpoint_plan` in two dashboards, the planner scoring objects in two, `plan_journal` in five, `fn_band_timeline` in twelve, `fn_zone_vpd_targets` in one | Repointed or removed in the release that changes the object; a CI check that no panel queries a dropped object | New |

### 8.6 Documents

`docs/CONTROL-ARCHITECTURE.md`, `docs/firmware-control-contract.md`, `docs/firmware-fsm-spec.md`, `docs/tunable-cascade.md`, `docs/iris-planner-contract.md`, `docs/planner/planner-io-schema.md` and `firmware/DESIGN.md` describe the stack that is removed. They are replaced by one control document that states the law, includes the generated constants table and describes the device contract of section 3.2; the old files are marked as history (issue #1672). The cross-layer rules in `AGENTS.md` about planner tunables and their readbacks are rewritten when the tunables go.

The decision records change as follows, in one new ADR that states the law:

| Record | What the plan does to it |
|---|---|
| ADR-0004, floating corridor | Decisions 1 to 3 (float inside the band, the target is not a control objective, cost is a driver) are what the law implements. Decision 7 (the planner pre-acts on the forecast, towards model-predictive control) is withdrawn on the evidence of section 6. The one forecast rule that saved anything there is an input to the controller, not a planner action, and is decision 15. |
| ADR-0004, amendment of 2026-11-05 (night dry-out) | Kept in part. The floor and the nightly grade stay. "Gas never runs for humidity" becomes the drying cost limit at 0: the furnace never starts a drying run and never runs during one, but it replaces part of the heat afterwards (section 4.5). The pulses and the night-only test are replaced by rule 7. Two items change by default and are put to the owner. The 10 kWh nightly cap goes, replaced by the cost limit and the daily meter (decision 1). Item 5 (dry winter nights accepted for now) no longer holds, because the law holds the VPD high edge at every hour; keeping it is a choice of that edge (section 5.7, decision 9). Raising the limit above 0 would change the amendment further. |
| ADR-0006, bounded active planner | Superseded by the reviewer of section 7. |
| ADR-0009, solar-night dry-out | Superseded: drying follows rule 7 at every hour. |
| ADR-0010, experiment fast path | Retired with the experiment code (issue #1649). |

### 8.7 Irrigation: what stays and what the climate path must keep providing

No irrigation behaviour is meant to change. Irrigation shares valves, the fogger and the control loop with climate, so the refactor has obligations to it, and three places where the climate side feeds irrigation need the owner's eye: the inputs of the zone ranking (decision 5), mister pulses when there is no clock (section 4.9), and how often Iris acts on irrigation (section 7).

**Stays as it is:** `firmware/lib/irrigation_program.h`, `irrigation_engine_esphome.h`, `firmware/greenhouse/irrigation_engine.yaml` (the program and command services, the `manual_override` service, the 5 s tick, the engine's own clock test); the ten wet relays with their grant and fertiliser-master guards; `greenhouse_solar.h`; `policy_sha256.h` and `policy_hex_decode`; on the host `ingestor/tasks/irrigation.py`, the device transport `push_policy_transaction` (`ingestor/esp32_push.py:1331-1418`), `verdify_schemas/irrigation.py`, the irrigation services, routes, MCP tools, tables, views and alerts; the dashboard water pages; the soft water budget, which caps scheduled misting as well as climate pulses and is shown on the dashboard. It stays a stored setting and the owner sets it in place of the planner (decision 11). Two symbols that irrigation modules import from code this plan rewrites also stay: `_heap_push_defer_active` in the dispatcher and `Leak` and `ReadbackState` in `verdify_services/reads.py`.

**The law must do, every second, what the climate loop does for the engine today:**

- Open a mister only through `irr_vpd_grant`, `irr_vpd_release` and `irr_climate_close`, and only for a line the engine allows (`irr_climate_zone_allowed`); call `irr_mister_watchdog`; use `irr_rank_vpd_zone` when more than one line is a member, and carry over the fairness rule that overrides it for an overdue zone, which is in the climate mister code today (`controls.yaml:1400-1420`, section 4.8).
- Hold the fogger and misters exactly as today. In every state: while the fertiliser master is open or the fertigation line holds (`irr_l03_hold`), while a drip relay reads on, during occupancy, and on a sensor fault. Outside the 100 F limit also: while the engine has a drip in progress (`irr_drip_active`), when the soft budget is reached, unless a VPD emergency holds (`controls.yaml:865-867`), and when the daily safety cap has tripped (`irr_saf4_tripped`). Fog at the 100 F limit is counted and not capped.
- Honour a fog request from `irr_fog_run`, and add the metered water to the engine's daily count while the fogger or a mister runs (`irr_add_water`).
- Supply the engine's inputs, which today are read from the mode logic:

| Engine input | Today | Under the law |
|---|---|---|
| `sensor_fault` | mode is SENSOR_FAULT | no valid indoor reading |
| `safety_cool` | mode is SAFETY_COOL | temperature at or above 100 F (rule 8) |
| `vpd_emergency` | the highest of the house and zone VPD readings is above the safety maximum setting | the same test against a compiled 2.5 kPa |
| `climate_demand` | fog or mist is wanted and nothing but a drip holds it | the latch of rule 5 or rule 6 is set and every hold above passes except the drip. A latch that occupancy or the safety cap blocks must not make a drip yield. |
| the zone gate's `demand` | climate misting wanted | the latch of rule 6, with the vent rule of today |
| the zone gate's `safety_ok` | a valid clock, no occupancy, no feed hold, VPD above the high edge, and a dew margin with separate day and night values | no occupancy, no feed hold, VPD above the high edge, and one compiled dew margin, the larger of the day and night values read back at the release. No clock term, because the law has a band when there is no clock, and no night term. |
| zone ranking inputs | each zone's VPD against its own target curve; ranks from four settings | each zone's VPD against the house band; ranks compiled at the release values |
| fairness rule inputs | each member zone's VPD against its own target; 10 minutes without a pulse | the same against the house band's high edge |
| `sensor_degraded`, `occupied`, `rh_pct`, the per-zone VPD source | | unchanged |
| dew margin for scheduled misting | setting `direct_wet_stress_min_dew_margin_f` | compiled at the value read back at the release (8 F by default) |
| `soft_budget_centigal` | setting `mister_water_budget_gal`, written by the planner | the same setting, set by the owner |
| `mister_min_off_s` | setting, written by the planner | compiled at the value read back at the release (45 s by default) |

**In the database:** `v_irrigation_schedule_current` is redefined before the plan table is dropped (section 8.4), and a test checks that it returns the same rows without the plan source. Whether the view is still needed at all is a question for issue #1655.

**Scope notes on filed issues** so that they do not cut what irrigation uses:

- #1650: keep `policy_sha256.h`, move `policy_hex_decode` beside it, turn the three engine reads through `pol()` into plain values.
- #1646 and #1649: `push_policy_transaction` is the irrigation transport and stays; redefine `fn_mcp_armed_assignment_context`, the irrigation schedule view and the login checks before any drop (section 8.4).
- #1641 and #1651: the soft budget stays, with its readback (`verdify_services/irrigation/reads.py:709-711` reads it over 24 hours).
- #1662: store-on-change must keep what irrigation reads from `setpoint_snapshot`: the budget readback and the readbacks of the retired L01 bridge while it is the rollback path.
- #1655: the retired bridge, burst helpers and feed hold are dead for irrigation, but the bridge is the documented rollback path until the last-good firmware is an engine build.
- #1656: keep the ingestor's `irrigation_changed` and `desired_state_changed` listeners. They wake the irrigation sync and the dispatcher, not the planner.
- #1671: the specification of the law's release includes the hold list and the input table above.
- The relay entity names stay; the fence alert, the minutes views and the water attribution read them.

**Checks:** `make test-irrigation-program`, `make test-firmware`, the `tests/test_irrigation_*.py` and `tests/test_dashboard_db_*irrigation*.py` suites, `tests/test_mcp_irrigation_write_tools.py`, a render test of the irrigation context in place of `make planner-dry` (which imports the planner runtime), the dashboard water end-to-end specs. Four native tests are added with the law: a VPD pulse without a grant never opens a valve; occupancy with the rule 6 latch set gives `climate_demand` false; protection fog runs past a drip in progress and stops for a drip relay that reads on; the soft budget holds the fogger and misters and a VPD emergency lifts the hold. No host test reaches the grant code today.

### 8.8 Lighting: what stays

Nothing in lighting is changed. Lighting decisions run inside the same one-second loop and share the settings machinery, so the refactor must carry them over intact.

**Stays as it is:** `firmware/lib/greenhouse_logic.h:1285-1548` and `2904-2929`, the three time helpers at `456-476`, and the manual-override helpers at `2862-2900`; the lighting types (`greenhouse_types.h:596-711`); the lighting block in `firmware/greenhouse/controls.yaml:2124-2294` with real elapsed time, its own clock test and the solar times it reads; all 24 lighting settings and their 24 readbacks; the light kinds of the `manual_override` service; the weather station parser and its lux value; the occupancy flag, its push and its 60-minute expiry; the dispatcher's lighting block (its one change: it no longer skips a value held by a plan row), its sets and the desired-state overlay; the sunrise-anchored window (`ingestor/tasks/band_anchors.py:397-416`); the snapshot confirmation of pushed values and `ingestor/tasks/confirmation.py:252-311`; the `/lights` routes of the setpoint server; the lighting SQL functions and views with `crops`, `crop_target_profiles` and `fn_solar_altitude`; the lighting parts of the `grow_light_daily` job; the `lighting_cfg_threshold_drift` alert.

**Scope notes on filed issues:**

- #1651: exclude every lighting setting and readback. The dispatcher decides whether the firmware supports per-circuit lighting from the lux-threshold and lighting switch readbacks; dropping them turns lighting delivery off.
- #1663: when `band_source()` is deleted, keep the lighting window path unconditional. Keep the desired-state overlay.
- #1636: the one confirmation mechanism covers the lighting values; the lighting policy functions read only confirmed rows.
- #1650: the lighting read of `outdoor_staleness_max_s` through `pol()` (`controls.yaml:2191-2192`) becomes a compiled value, taken from the readback at the release (600 s by default).
- #1662: keep the lighting reason rows, the 24 lighting readbacks and the freshness the lighting views and the light resync expect.
- #1656: delete only `confirmation.py:314-335`; keep `:252-311` and the `/lights` routes.
- #1666: the indoor light sensor is lighting's fallback input; removing it means editing the two firmware reads in the same change.
- #1638: the clock rule of section 4.9 is for the band only.
- Any migration that replaces a function inside the API's sealed helper set re-seals it, as migrations 286 and 309 did.

**Checks:** `make test-greenhouse-logic`, `make firmware-invariants` (the minimum-dark invariant), `make firmware-check`, `tests/test_286_lighting_policy_delivery.py`, `tests/test_solar_band_anchors.py`, `tests/test_dispatcher_plain_convergence.py`, `tests/test_dispatcher_desired_state.py`, `tests/test_verdify_services_lighting.py`, `tests/test_operator_lights.py`, `tests/test_ha_light_writer_boundary.py`, the dashboard equipment end-to-end specs, and a dashboard light switch after each migration that drops an object.

Known and unchanged: the lights are switched through Home Assistant, so lighting does not work with the network down, and the lights add about 1.45 kW of unmetered heat while on. Neither is addressed here.

### 8.9 Counts

| Layer | Item | Today | Target |
|---|---|---:|---:|
| Firmware | Climate settings | 102 | 2 |
| Firmware | Climate readbacks | 148 | 18 |
| Firmware | `Setpoints` fields | 74 | 0 |
| Firmware | Modes | 8 | 0 |
| Firmware | Mode logic and helper lines in `greenhouse_logic.h` | about 2,100 | a law of about 150 |
| Firmware | Policy-vector engine lines | 1,948 | 0 |
| Registry | Climate rows | 161 | 19 |
| Registry | Planner-writable rows | 48 | 0 |
| Schemas | Planner and experiment modules on the climate path | about 4,700 lines | the review record |
| Ingestor | Periodic tasks on the climate path | 17 | 6 |
| Ingestor | Experiment workers | 7,391 lines | 0 |
| Ingestor and scripts | Planner runtime | 6,128 lines | a daily review call |
| Ingestor | Climate alert kinds | 26 | about 17 |
| Database | Tables | about 80 dropped | |
| Database | Size | 9.3 GB | about 5.5 GB |
| MCP | Climate write tools | 4 | 1 (`set_setting`, operator switches only for an agent) |
| HTTP | Experiment and planner routes | 17 | 0 to 2 |
| Band | Definitions of the band curve | 5 | 3, tested against one set of vectors |
| Band | Keys of the anchor service | 56 | 18 |

Targets assume decisions 5 and 6 are taken as recommended (no zone curves, no target curves).

## 9. Consistency: one definition per thing

The review found the same quantity defined in several places with different values (section 8 there). The target is one source for each, with everything else generated from it or tested against it.

| Thing | Today | Target |
|---|---|---|
| Band curve through the anchors | Five definitions: `firmware/lib/greenhouse_solar.h:159`, `ingestor/solar.py:122`, SQL `fn_crop_band_value`, `verdify_schemas/band_profile.py:56`, and SQL `fn_house_vpd_control_band`, which builds the house VPD band from the zone crop curves with its own width and margin | Three, one per runtime (firmware, Python in `band_profile.py`, SQL), each tested against the same generated vectors (issue #1663). `fn_house_vpd_control_band` becomes the house anchor curve. |
| Solar phase | Three implementations | The same three runtimes, the same vectors |
| Band values | The committed file `band_defaults.yaml` (the seed, and the source of the ROM band), the live store `crop_band_anchors`, the firmware ROM (a deliberately drier view of the file, enforced in CI), the controller's flash | One live store, `crop_band_anchors`, with the house rows on one season and one growth stage. The controller's flash copy is read back and compared. The committed file stays the seed and the ROM source, and the ROM stays the dry-side view: that is a recorded safety decision and it only applies to a chip with empty flash. A release check reports where the store differs from the file, so that the owner sees what such a chip would serve. |
| Night bias | `night_vpd_bias_kpa` in the firmware, the registry and two host copies of the curve | Removed everywhere with the setting |
| Law constants | Typed separately in firmware globals, registry defaults, two dispatcher blocks, the setpoint server, the alerts, SQL and the firmware library's defaults; the protection limits exist in five copies and the controller ran 95 / 45 F for 24 days in September and again from 2026-10-29 to 11-01 | One file, `verdify_schemas/climate_law.yaml`. The firmware header, a Python module, a SQL constants function and the documentation table are generated from it. CI fails when a generated file is stale or when one of the law's numbers is typed as a literal in host code. The controller reports a hash of its compiled constants and the host alerts when it differs from the released file. |
| "Is outdoor air better" | Four comparators | One, in rule 7 |
| Thresholds shown on graphs | `fn_band_timeline` re-derives firmware thresholds in SQL (57 columns) | The band edges plus the offsets from the generated constants |
| Compliance | One official function and four readers that disagree with it (review section 8.3) | `fn_band_compliance_5m` only. It grades the signal the law controls on, against the band the host computes. The controller's own band is compared with that in an alert, so a clock fault shows as a fault and not as a silently shifted band. |
| Gas | 0.75 therm an hour typed in more than one place | `resource_coefficients`, which the daily record already reads |
| Delivery confirmation | Three mechanisms | One, for every pushed value (section 8.3) |
| Clock validity | One flag, read by climate, lighting and irrigation | Two on purpose: a trust flag for the band's clock, and the existing flag that lighting and irrigation keep (section 4.9) |
| Names and units | The same quantity under several names (`temp_low`, `target_temp_low_f`, a band role name) | One name per quantity in every layer; F and kPa |
| Documents | Seven control documents, several describing removed designs | One (section 8.6) |

## 10. Measuring cycles, run time and utilities

Constraints 3, 4 and 8 are stated in quantities the system does not record reliably today: the controller counts starts and run time per relay but clears the counts at midnight and loses them on a reboot, the host rebuilds them from events and some off events are lost (issue #1668), gas is not metered, and nothing meters drying.

1. **Counters on the controller.** For each relay, a running count of starts and of on-seconds, saved to flash hourly and never reset. The host takes daily differences. This replaces rebuilding from events.
2. **Utilities.** Electricity from the existing power meters; water from the existing flow meter; gas as furnace hours times the coefficient in `resource_coefficients` until a gas meter exists (decision 14).
3. **The drying meter** of section 4.5: hours, water and heat carried out, the reason drying was refused, and furnace starts within 15 minutes of a drying run.
4. **One daily record.** The existing `daily_summary` row already holds cycles and run time per relay and estimated kWh and therms. It gains the drying figures, both in band, and whether the night was dried.
5. **One page** that shows those numbers by day with 7-day and 30-day means.
6. **One alert:** a relay's starts above twice its 30-day median on two consecutive days.
7. **A baseline before the law.** The same record is collected on today's firmware first (phase 1), so that the law's acceptance compares measured with measured.

## 11. Delivery sequence

Firmware has no build or release timing gate in this repository, so the plan gives an order, not dates.

### 11.1 Phases

| Phase | Content | Changes the behaviour of | Rollback |
|---|---|---|---|
| 0. Now, no code | The five operator settings of review step 1 (issue #1673), which wait for the owner's approval and simulate at 78.3 / 69.7 % against 70.5 / 59.6 %. The nightly CronJob that fails from 2026-11-16, because migration 309 dropped a table it reads (issue #1634). Any band edit the owner chooses (decision 9). | Settings on today's firmware | Set the values back |
| 1. Measure (host only) | The daily record of section 10 from relay events, with the lost off events fixed (#1668); the one compliance definition (#1667); the heater-without-power alert (#1637); the delivery stall page (#1636); the clock difference alert (#1638, host part); the moisture source (#1669); the intake probe compared with the weather station; how often Iris writes irrigation, by trigger (section 7). Also the host side of what the later firmware publishes, which is additive: entity-map entries and storage for the relay counters, the clock trust flag, the band source, the constants hash, the state record and the drying meter, and the registry row, the push and the editor field of the drying cost limit (section 8.3). The push of the limit and its confirmation apply only once the controller publishes the limit's readback, so the builds before the law, and a rollback to them, raise no delivery alert. | Nothing on the controller | Previous pins |
| 2. Firmware: running alone | No reboot on WiFi loss; the trust flag for the band's clock; the no-clock corridor with fog allowed; the intake probe as second outdoor source with its own age stamp, and an age test on the cold-vent guard; no substituted sensor values (#1643) and the case sensor's offset; persisted fan run seconds and relay counters; relays available at boot; one restart rule for a silent sensor bus; the change that is merged but not yet flashed (#1644). The control logic is otherwise today's. | The controller in degraded conditions only | Signed flash of the last-good build |
| 3. Firmware: the law | Before the flash: the band editor's width and night-floor checks (section 4.1). The flash: `climate_law.h` replaces the mode decision, with the controller's band check. The relay layer is reduced. The irrigation glue is re-pointed (section 8.7). The state record and the drying meter are added. Everything the host reads today is still published (below), and the old climate settings and readbacks stay on the wire and do nothing, so the flash needs no host change: the host side shipped in phase 1. | Climate control | Signed flash of the phase 2 build, which stays the last-good build until the law is accepted |
| 4. Delete | Host first: every reader moves to the law's state record (the OTA gate, the smoke and liveness checks, the alerts, the dashboard, the brief). Then firmware: the legacy fields, the inert settings, readbacks and structs, the policy engine. Host: the planner's write surface, the dispatcher's plan reading, guardrail and defaults, the forecast engine. Database: the drops in the order of section 8.4, one migration per release with an archive dump first. | Nothing: everything deleted is inert by then | Previous pins |
| 5. Reviewer and documents | The planner becomes the reviewer (section 7). The control documents are replaced (section 8.6). | The planner | Previous pins |

**What the law build still publishes in phase 3.** The OTA gate refuses a flash, a rollback included, unless the action log has a fresh row with the mode-era fields. The smoke test, the liveness check, the stale-proof and stuck-relay alerts, the grading of fog and mist time, the dashboard's current-state view and the 15-minute brief read the same fields. So the law build keeps publishing them, from one small table:

| State (the first row that applies) | Legacy mode label | Action | Priority axis |
|---|---|---|---|
| No valid indoor reading | `SENSOR_FAULT` | `SENSOR_FAULT` | safety |
| At or above 100 F | `SAFETY_COOL` | `SAFETY_COOL` | safety |
| At or below 40 F | `SAFETY_HEAT` | `SAFETY_HEAT` | safety |
| Vent open, fogger on | `VENTILATE` | `VENT_COOL_FOG_ASSIST` | temp |
| Vent open, a mister on | `VENTILATE` | `VENT_COOL_MIST_ASSIST` | temp |
| Vent open for drying | `DEHUM_VENT` | `DEHUM_VENT` | vpd |
| Vent open otherwise | `VENTILATE` | `VENT_COOL` | temp |
| Vent closed, fogger on | `SEALED_MIST`, with the stage suffix today's readers expect | `SEALED_FOG` | vpd |
| Vent closed, a mister on | `SEALED_MIST`, with its stage suffix | `SEALED_HUMIDIFY` | vpd |
| A heater on | `IDLE` | `HEAT` | temp |
| None of these | `IDLE` | `IDLE` | as today: temp or vpd when that reading is outside the band, otherwise resource |

- After the three protection rows the table is keyed on the relays, not on the law's latches. A fogger that is still running while the vent finishes its minimum on time is then reported as fog, and the grading of fog and mist time, which is keyed on these action names, stays right. While the fogger runs the fog block reason is `none`; when a hold stops it, the reason names the hold.

- `THERMAL_RELIEF` is no longer emitted.
- The action and the axis use only today's vocabularies (`verdify_schemas/climate_intent.py`). The ingestor skips an action-log row whose value is outside them, the log then goes stale, and the OTA gate fails. The assist state and the mister zone stay inside their sets as well. The grading of fog and mist time is keyed on these action names.
- The moisture-exchange JSON keeps its outdoor freshness and age fields (`of`, `oa`), filled from the law's outdoor source. The preflight refuses a flash unless they show an outdoor reading under 10 minutes old (`scripts/firmware-deploy-preflight.sh:228-243`).
- The intent version, the band, the targets and the deltas in the action log are written by the ingestor, which does not change in phase 3.
- The two target curves keep being published until decision 6 removes them with their readers.

Order rules:

- Phase 3 keeps the wire contract in both directions, so that going back is one flash, the single device writer does not change in the same step as the control law, and the OTA gate passes for the law build and for the rollback build.
- The host stops pushing climate settings (phase 4) only after the law build is the last-good build. After that the pre-law firmware is no longer a rollback target, because without the pushes it would run on boot values.
- In phase 4 a reader moves before what it reads goes: host readers before the firmware drops a field, and code before the migration that drops an object. The action vocabulary in `climate_intent.py` and the gate's two checks (the action proof and the outdoor freshness) are the last to go.
- Anything the host must know about a new firmware output ships before the firmware that publishes it.
- Removing the experiment code and ledgers (#1649, #1635, #1657) and the idle planner (#1652) does not depend on the law and can start at once, with the drop rules of section 8.4.

### 11.2 The interim question

The review's step 2 is a small patch to today's firmware (issues #1639, #1640, #1674, #1675) that simulates at 85.6 / 82.6 %. It changes code that phase 3 deletes, and it uses +0.25 / +0.35 therm a day more than today's firmware: it vents down to 0.5 F above the low edge, where the furnace replaces the heat, so in effect it spends furnace heat on drying. The recommendation is to apply the five settings now, ship phase 2, and go straight to the law (decision 3). If the law is expected to take more than about a month, shipping the step 2 patch with phase 2 holds the band better for the rest of this winter.

### 11.3 The filed issues under this plan

Epic #1633 and its 43 children were filed from the review. "Stands" means the issue is right as filed.

| Issue | Subject | Under this plan |
|---|---|---|
| #1633 | Epic | Amend: the phases above replace its step list |
| #1634 | Winter-feasibility CronJob fails nightly | Stands; phase 0 |
| #1635 | Native-panel ledger | Stands with the drop rules of section 8.4; phase 4, can start now |
| #1636 | Setpoint delivery stall page | Amend: one confirmation for every pushed value, lighting included; phase 1 |
| #1637 | Electric heater: no heat for 209 days | Stands; phase 1; matters more under constraint 5 |
| #1638 | Controller clock wrong for 87 days | Amend: the trust flag is for the band's clock only (section 4.9); phases 1 and 2 |
| #1639 | Furnace thresholds | Superseded by rule 2 (same thresholds), unless the interim patch ships |
| #1640 | Fog threshold mismatch | Superseded by rule 5, unless the interim patch ships |
| #1641 | Mister duty cap and water budget | Amend: the budget stays, set by the owner (decision 11); the duty cap goes with the mister state machine |
| #1642 | Boot defaults differ from production | Amend: the ROM band stays as it is; the other boot defaults disappear with the constants |
| #1643 | Substituted 65 F / 50 % | Stands, with the three substitutions cited in section 4.9 and the case sensor's offset; phase 2 |
| #1644 | Controller firmware behind main | Stands; phase 2 |
| #1645 | Wall drip timing | Stands; irrigation, the owner's choice, outside this plan |
| #1646 | The planner's role | Amend: section 7, with the limit on `set_setting` and the irrigation tools' ties to the plan cycle |
| #1647 | Delete the legacy mode cascade | Amend: add the firmware tests and CI gates of section 8.1; done by phase 3 |
| #1648 | Delete 26 inert `Setpoints` fields | Amend: the whole struct goes; phase 4 |
| #1649 | Retire experiment generations 1 and 2 | Stands with the scope notes of section 8.7 and the drop rules of section 8.4; can start now |
| #1650 | Remove the policy-vector engine | Stands with the scope notes of sections 8.7 and 8.8; phase 4 |
| #1651 | Publish and store only what can change | Amend: climate constants are compiled; lighting and the water budget are excluded; phase 4 |
| #1652 | Retire the idle planner | Stands; can start now |
| #1653 | Remove the forecast-action engine | Stands, now with the evidence of section 6; phase 4 |
| #1654 | VPD-high guardrail | Amend: removed, nothing left to clamp; phase 4 |
| #1655 | Retired irrigation code | Stands with the scope notes of section 8.7; add the question of whether `v_irrigation_schedule_current` is still needed |
| #1656 | Small dead paths | Stands with the scope notes of sections 8.7 and 8.8 |
| #1657 | Digital twin | Stands; can start now |
| #1658 | Irrigation engine | Stands; irrigation, outside this plan |
| #1659 | Planner feedback loop | Amend: the reviewer reads compliance and utilities; phase 5 |
| #1660 | Planner runs | Amend: one review a day and the manual trigger; nothing in irrigation wakes the planner (section 7); phase 5 |
| #1661 | No token or cost record | Stands, smaller; phase 5 |
| #1662 | Store readbacks on change | Stands with the scope notes of sections 8.7 and 8.8; phase 4 |
| #1663 | One band curve and one store | Amend: 16 anchors, one season and growth stage, lighting path unconditional, the desired-state overlay kept; phase 4 |
| #1664 | Alert volume | Amend: the alert list of section 8.3; phases 1 and 4 |
| #1665 | Stale band columns in the action log | Amend: replaced by the law's state record with a heartbeat row; phases 3 and 4 |
| #1666 | Frozen and dead channels | Stands with the scope note of section 8.8 |
| #1667 | Compliance reporting | Stands; phase 1 |
| #1668 | Run-time and water records | Amend: section 10; phases 1 and 2 |
| #1669 | Moisture source not measured | Stands; it is the largest uncertainty in section 5 and it comes before decision 1 |
| #1670 | Furnace saturation | Stands |
| #1671 | Two-axis band controller | Amend: becomes the law issue. Section 4, the hold list and the input table of section 8.7 replace its specification; phase 3 |
| #1672 | Control documents | Amend: add the decision record for the law and the changes to ADR-0004, ADR-0006, ADR-0009 and ADR-0010 (section 8.6); phase 5 |
| #1673 | Five operator settings | Stands; phase 0; waits for the owner |
| #1674 | Night dry-out | Superseded by rule 7, unless the interim patch ships |
| #1675 | Dry-out forces the electric heater off | Superseded by rule 7, unless the interim patch ships |
| #1676 | Overnight dry-out goal | Amend: decisions 1 and 10 |

New issues this plan needs, to be filed when the owner resumes GitHub work:

1. Firmware phase 2: running alone.
2. The constants file and its generated outputs, with the CI check on literals.
3. The drying meter and the daily cycles and utilities record on the controller's counters.
4. Remove the planner's climate write surface end to end, with the agent limit on `set_setting`.
5. Delete what the law replaced, in firmware, registry and dispatcher, including the per-zone mister curves.
6. The law's host side: the entity-map entries and the drying cost limit's row, push and editor field (before the flashes); then the state record, the OTA gate and the health checks, `fn_band_timeline`, `fn_house_vpd_control_band`, the alert list, one delivery confirmation.
7. The database drop sequence: the login checks, the irrigation schedule view, the boundary digest, and a check against a migration replay.
8. The dashboard, brief and Grafana readers of removed objects.
9. Firmware tests and CI gates for the law.
10. The intake probe compared with the weather station for a season.
11. Battery clock chip (hardware), if decision 8 is taken.
12. Band validity: the editor's width and night-floor checks and the controller's band check, before or with the law.
13. The hold-back while the sun is on the house or forecast, only if decision 15 is taken.

No issue has been edited or filed for this plan. Filed issues that quote the review's simulated figures for today's firmware are restated on the corrected baseline when the edits are made.

## 12. Decisions for the owner

Numbered as they are referenced in the text. Four shape the work (1, 3, 4 and 9); the rest can be taken when their phase is reached.

| # | Decision | Recommendation | Why | Needed by |
|---|---|---|---|---|
| 1 | Drying with outdoor air: the cost limit (how much furnace heat may be spent to carry out a kilogram of water), where a run stops, and whether a daily cap is kept | Ship the limit at 0, stored and editable like an anchor, with the stop line at `low + 0.75` and no daily cap. Decide on a higher limit once phase 1 has measured the moisture source. | 0 is the nearest the law comes to the rule of 2026-11-05 that gas never runs for humidity: no drying run starts on furnace heat or runs while the furnace is on, but the furnace replaces part of the heat afterwards, +0.01 / +0.04 therm and 0.0 / +0.2 furnace starts a day against never drying. To come closest to the letter of the rule, stop every run at the furnace's off line (`low + 3.0`): the gas left over is -0.003 / +0.013 therm a day against never drying, at a cost of 1 / 3 dried nights in a hundred and 0.1 / 1.5 points of compliance (section 4.5). The rule's nightly 10 kWh cap is not kept: the heat carried out averages 1.1 / 1.7 kWh a day (0.8 / 1.1 in winter) and is metered, and a daily cap can be added as a second stored number if the meter shows the need. Against a limit of 0, a limit of 0.5 costs +0.01 / +0.11 therm a day for 0 / 6 more dried nights in a hundred; 0.7 (above about 38 F outdoors with dry air) +0.03 / +0.19 therm for 1 / 13 nights and +1.0 / +7.4 points of compliance; 1.0 (above about 20 F) +0.06 / +0.30 therm for 2 / 17 nights; no limit +0.11 / +0.35 therm for 5 / 20 nights. The two models disagree because they disagree on the moisture source. The limit is a stored number, so changing it needs no release, and the drying meter shows what it spends (section 4.5). A value above 0 amends the 2026-11-05 amendment to ADR-0004. | Phase 3, and at any time after |
| 2 | The heating lines: the furnace's swing and the electric heater's line above it | Furnace 0.5 / 3.0, electric heater 3.5 / 4.5 | It is the middle of a trade between furnace starts and energy. One step lower (furnace off at 2.5, heater 3.0 / 4.0): +2.1 / +2.6 furnace starts a day for -0.70 / -0.54 kWh and -0.05 / -0.04 therm. Two steps lower: +5.3 / +6.5 starts for -1.32 / -1.11 kWh and -0.09 / -0.06 therm, and -0.2 / +1.6 points of winter compliance, because the drying start line moves down with the heater's. One step higher: -1.5 / -1.9 starts for +0.70 / +0.56 kWh and +0.06 / +0.05 therm. The electric heater's lines alone trade electricity for gas and leave the starts as they are: 0.5 F lower with the furnace unchanged is -0.78 / -0.71 kWh for +0.03 / +0.02 therm and -0.4 / -0.6 point of compliance. That saves electricity by holding the house cooler and moves some heat to the furnace, which constraint 5 counts against it. The lines are compiled, so a change is a release. | Phase 3 |
| 3 | Interim patch this winter, or straight to the law | Straight to the law; the five settings now | Section 11.2. | Now |
| 4 | The planner's role, and how often Iris may act on irrigation | Reviewer once a day, no climate writes; an agent's `set_setting` limited to the operator switches; Iris keeps its irrigation tools and uses them in the review or on a manual trigger | Section 7. Nothing in irrigation wakes Iris today, and none of the 24 irrigation writes in the activity log (from 2026-11-03) is Iris's. A second run a day is one more trigger if the owner wants it. | Phase 4 |
| 5 | Per-zone VPD curves for the misters | Remove the curves. The irrigation engine's zone ranking is fed from the house band and each zone's own VPD reading, with today's ranks compiled. | Only the centre mister ran in 95 days. It removes 24 anchors, 24 readbacks, four pushed values and a SQL function. It changes which zone is chosen when more than one line is opted in; that is the only change to how the engine picks a line (section 4.8). The other changes to the engine's inputs are listed in section 8.7. | Phase 3 |
| 6 | The two target curves (temperature and VPD) | Remove them from the controller and the store | The law reads the four edges only and nothing else controls to the targets. Their host readers change in the same release: the band editor, `v_band_device_divergence`, the `house_band_drift` alert and the OTA gate, which requires target values today. Keeping them costs 8 anchors and 8 readbacks and nothing else. | Phase 4 |
| 7 | Safe state with no indoor reading at all | All climate relays off, critical alert | Today's firmware does not reach this state when the probes are lost: it substitutes 65 F and 50 % and keeps controlling on them (section 4.9). All relays off is what its sensor-fault mode does when it is entered. The state needs every probe on the sensor bus, the case sensor included, to fail. Any rule that acts without a reading can be wrong in the other season. In winter this state lets the house cool, and no hardware thermostat backs it (section 14). | Phase 2 |
| 8 | Battery clock chip on the controller | Add it. With it, a WiFi restart timeout of about 6 hours instead of none. | It is the only way the clock survives a power cut during a network outage (section 4.9). It also gives irrigation and lighting the time at once after a power cut. Without it the WiFi timeout stays at 0, and after one to six days without a clock the soft water budget and then the daily safety cap hold the fogger and misters, unless the irrigation engine's daily water count gets a rollover that does not use the clock, which is a change to irrigation. | Phase 2 or later |
| 9 | Band edits from the price list, and dry winter air | The owner's choice. Band 2 is what the summary shows; band 1 is its first two edits. | The band, not the controller, sets run hours and utility use (section 5.7). The edits are made in the band editor, need no code, and save about as much on today's firmware. One of them is also a standing choice: the note of 2026-11-05 accepted dry winter nights for now, and the law does not, so on today's band its winter water is 59 / 11 gallons a day against 26 / 4. The VPD high edge 0.10 kPa higher at every hour takes 29 / 8 gallons of that back; raising it at night alone takes 10 / 1. | Any time; the VPD high edge before phase 3 |
| 10 | The night floor of 0.74 kPa | Keep the owner's definition for the grade. The band editor checks the curve instead of the midnight anchor: the drying line (`vpd_low + 0.05`) at or above 0.74 kPa at every point of the night. No anchor changes. | Today's band passes: the curve's lowest point is about 0.72 kPa, so the drying line there is about 0.77. The firmware's own compiled 0.74 goes with the dry-out machine, so the law has no floor of its own (constraint 2). | Phase 3 |
| 11 | The soft daily water budget | Keep it as an irrigation setting that the owner sets, at the value the controller reads back at the release | It caps scheduled misting as well as climate pulses, and the dashboard shows it. The planner writes it today and stops in phase 4. | Phase 4 |
| 12 | Fan in cold protection | No fan | Today's firmware runs the lead fan with the vent closed at or below 40 F to mix the air. The law keeps "no fan without the vent open" without exception. That state has not occurred in the record. | Phase 3 |
| 13 | Fixed numbers compiled into the firmware | Accept them as constants | Constraint 2 rules out exceptions. The law has none, but it has about 40 fixed numbers (section 4.4). The alternative is to keep them as settings, which brings back delivery, readback and boot defaults for values that the sweeps show are flat. | Phase 3 |
| 14 | Gas meter | Optional | Therms are estimated from furnace hours until one exists. | Any time |
| 15 | A hold-back on the electric heater's lines while the sun is on the house or forecast (constraint 10) | Not in the first release. Decide after the law is accepted on the controller, with measured figures. If one is built, start with the present-sun form, which needs no forecast. | It is the one rule of section 6 that saved anything in simulation. Lines 1 F lower while the sun is on the house: -0.6 / -0.7 kWh and -0.4 / -0.5 run hours a day, +0.04 / +0.03 therm. With 3 hours of forecast look-ahead: -0.9 / -1.0 kWh, -0.6 / -0.6 run hours, +0.04 / +0.03 therm. Both move heat from the electric heater to the furnace (constraint 5). With the look-ahead and the furnace's off line held down as well: -0.7 / -0.7 kWh, -0.04 / -0.03 therm and -0.6 / -0.3 run hours a day for +1.7 / +1.9 furnace starts (constraint 3). The figures assume the sun is known exactly. The present-sun form uses the light reading the controller already receives for lighting; the look-ahead adds one optional input, a "sun expected" flag from the host that expires by itself. Without either the law runs as specified. The band's daytime low edge is the larger lever of the same kind and needs no forecast (decision 9). | After phase 3 |

## 13. Verification and acceptance

Simulation and heavy test runs belong on the cluster's CI runners, not on a workstation.

**Phase 2.**

- Host tests for the trust flag, the no-clock corridor, the outdoor source order and the case sensor alone (the temperature rules on its reading less the offset); `make test-firmware`, `make firmware-check`; the irrigation and lighting checks of sections 8.7 and 8.8.
- On the controller, attended. The controller's network is blocked from before local midnight until after it, for at least six hours, and the controller is restarted once during that time. Its relays keep working, the band is held as on a normal night, the irrigation engine's daily water count starts a new day at local midnight, the relay counters keep counting, and its uptime resets only at the deliberate restart. After that restart, with the network still blocked: the anchor readbacks equal the store, the fan run seconds are restored, every relay is available at once, and the controller reports "clock unconfirmed" and serves the corridor, or keeps the band if the clock chip is fitted. With the weather station's broadcast blocked, the outdoor source switches to the intake probe. Blocking the network is a write in the network lane and is arranged there.

**Phase 3.**

- Native tests of the law's invariants: the furnace never requested with the vent open; no fan without the vent; minimum times honoured outside the cases of section 4.3; the electric heater requested whenever the furnace is; no fog or mist while drying; no mister valve without a grant; the two protection states; no change of request while the house is inside every inner line; the same inputs give the same outputs at any clock time; every relay available at boot; a band narrower than the two widths is widened and an inverted one repaired; and the four irrigation tests of section 8.7 (a VPD pulse without a grant never opens a valve; occupancy with the rule 6 latch set gives `climate_demand` false; protection fog runs past a drip in progress and stops for a drip relay that reads on; the soft budget holds the fogger and misters and a VPD emergency lifts the hold).
- A noise test: the law is run on recorded probe readings, which carry the real sensor noise, around each pair of lines. No latch may change more often than its relay's minimum times allow, and the cost-limited drying start (`low + 1.0` against a stop at `low + 0.75`) is one of the pairs. If it chatters, that start line is raised to `low + 1.5` (section 4.5).
- The closed-loop simulation in CI, built with the product header instead of the reference, reproduces the reference results (both in band within 0.5 point, starts within 5 %).
- The existing replay gate compares old and new decisions on recorded data and will show total divergence on this release by design. It is replaced in the same change by the comparison of the firmware's law with the reference and by the invariant tests on the same recorded data (section 8.1).
- The OTA gate, with its action proof and its outdoor freshness check, the smoke test and the liveness check pass on the law build with no host change, and pass again for a flash back to the phase 2 build.
- On the controller, for at least seven days that include a cold night and a sunny day. The baseline days of phase 1 and the acceptance days have different weather, so the gates are set through the simulator. Phase 1 gives, for each quantity, the ratio of measured to simulated on today's firmware. For the acceptance days both controllers are simulated on that window's weather and scaled by that ratio; "expected today" and "expected law" below are those scaled figures.
  1. No protection state entered because of the law.
  2. Both in band: at least expected today plus half the expected gain.
  3. Relay starts in total: at most expected today minus half the expected reduction. Furnace starts: at most 20 % above expected law. Furnace starts within 15 minutes of the end of a drying run: at most one a day on average.
  4. Run hours, kWh, estimated therms and gallons a day: each at most 15 % above expected law.
  5. The drying meter reports, and the refusal reasons account for the time drying was wanted and did not run.
  6. Irrigation and lighting: a scheduled drip ran, a VPD mister pulse went through the grant, the lights followed their window, and a dashboard irrigation write and a dashboard light switch worked.
- A failed gate is reported with its numbers. The law build stays on the controller for diagnosis only if no protection state occurred and compliance is at or above expected today; otherwise the phase 2 build is flashed. The window starts again after a fix; a gate is not passed by re-running the window unchanged.
- Go back to the phase 2 build at once if the law causes a protection state, if a heater, a fan or the vent makes more than 12 starts in an hour or the fogger more than 15 (mister pulses are not counted), or if compliance is below expected today for three days.

**Phase 4.** After each deletion: `make ci`; the production render equals what is live; the controller's readback list equals the registry; no alert rule or dashboard panel queries a dropped object, checked against a replay of the migrations; the ingestor, the API and MCP start and pass their login attestation (section 8.4); the lab site publisher completes a run; the irrigation and lighting checks, with a dashboard irrigation write and a dashboard light switch. The OTA gate passes on the law's state record before the firmware stops publishing the legacy fields.

**Phase 5.** One review a day for 14 days; no row written to `setpoint_changes` by the planner's identity; an agent's write to a band row is refused; Iris's irrigation tools work in the daily review and on a manual trigger; the ingestor's two irrigation listeners still fire.

## 14. Risks and limits

1. **The model.** The evidence is a simulation fitted to this house. Air exchange is its least certain part and the moisture source is not measured; models A and B bracket it and section 5.8 perturbs the rest. The law's lead over today's firmware is large against those perturbations. The exact utility figures are not.
2. **No sensor noise in the simulation.** Simulated relay starts are indicative: for today's firmware the simulation is above the measurement in one month and below it in another (section 5.1).
3. **Not simulated:** occupancy holds; the irrigation holds on the fogger and misters (a drip in progress, the fertiliser master, the soft budget, the safety cap); the irrigation engine's zone ranking and refused grants (the simulator rotates the member lines and opens them itself); the lights as a heat source; manual overrides; sensor failures and probe dropouts; control on the case sensor alone; a stale outdoor reading; the band widening of section 4.1; and any duty limit of the fogger at 2.0 / 1.7 hours a day against 0.9 / 0.6 today.
4. **Gas is estimated,** from furnace hours.
5. **One weather year.**
6. **The furnace.** Its starts barely fall; it is large for the house. Its capacity in deep cold is a separate question (issue #1670).
7. **Humid hours at a limit of 0.** The law leaves the house too humid 8 / 19 % of the year. In model B it holds less of the band than the review's step 2 patch, which in effect spends furnace heat on drying. Decision 1 is that trade, and the moisture measurement of phase 1 comes first. A limit of 0 is also not zero gas: the furnace replaces part of the heat that drying spends (section 4.5).
8. **The law release rewrites the control path** of the controller. The mitigations are the unchanged wire contract in both directions, the invariant tests, the comparison with the reference in CI and the rollback by flash.
9. **What no control law covers.** A relay that stays closed; one probe that reads wrong while it still reports; a controller that is hung or unpowered, which heats nothing. No hardware thermostat backs the controller; that was accepted earlier (issue #1296, cited in the sensor-fault code) and is not reopened here.
10. **Without a clock,** the irrigation engine's daily water count does not start a new day, so after one to six days the soft water budget and then the daily safety cap hold the fogger and misters (section 4.9).
11. **The intake probe** is not validated as an outdoor source: two days of temperature comparison and none of dew point.
12. **Values taken at the release.** The dew-point margin for wetting, the mister line's minimum off time, the zone ranks, the case sensor's offset and lighting's outdoor staleness limit become compiled values. Each is taken from the controller's readback at the release; where a readback differs from the default named in this plan, the readback wins.
13. **Open inventories:** what reads the 12 crop temperature rows in `crop_band_anchors`; the final count of dropped tables. The activity log covers only twelve days of irrigation writes, so "Iris writes none" is a short record.
14. **Lighting does not run alone** and its heat is not metered; both are outside this plan.

## Appendix A. The law in full

This restates section 4.2 as the reference implementation computes it each second. `T` and `V` are the indoor temperature and VPD; `low`, `high`, `vpd_low` and `vpd_high` are the band now. Each of the nine latches keeps its state between its two lines.

```text
h1    on  if T < low + 3.5            off if T > low + 4.5
h2    on  if T < low + 0.5            off if T >= low + 3.0
cool  on  if T > high                 off if T < high - 2.0
cool2 on  if T > high + 1.5           off if T < high
wet   on  if V > vpd_high             off if V < vpd_high - 0.15
mist  on  if V > vpd_high + 0.30      off if V < vpd_high + 0.05
dry   on  if V < vpd_low + 0.05       off if V > vpd_low + 0.20
air   on  if dewpoint_out <= dewpoint_in - 3    off if dewpoint_out > dewpoint_in - 1
      off without fresh outdoor data

dw      = w_in - w_out                                     g of water per kg of air
e       = 1.006 * max(0, (T - T_out) / 1.8) / dw / 3.6       kWh of heat carried out per kg of water
air_ok  = air and dw > 0.1
hot     = T >= 100          cold = T <= 40
cooling = cool or hot

run   off if not dry, or not air_ok, or cooling, or h2, or T < low + 0.75
      on  if T >= low + 3.5, or if T >= low + 1.0 while e <= limit          limit = 0 as shipped

drying  = run and not cooling
vent    = cooling or drying
fans    = 2 if cooling and (cool2 or hot), 1 if cooling or drying, otherwise 0
fogger  = wet and not drying and not cold
misters = mist and not drying and not cold
heater  = (h1 and not cooling) or cold
furnace = (h2 and not vent) or cold
if cold: vent closed, fans 0
```

The relay layer of section 4.3 sits between these requests and the relays, and the holds of section 8.7 apply to the fogger and the misters. The reference implementation also carries study options that were simulated and not adopted (the effect check, fog forced at the 100 F limit, fog as a cooling stage, a second fan while drying, pre-staging and the hold-back while the sun is on the house or forecast). They are off by default and are not part of the law. The stop line of a drying run (`low + 0.75`) and the cost-limited start line (`low + 1.0`) are constants of the law that decision 1 and the noise test of section 13 may move.

## Appendix B. Reproducing the figures

The simulator, the scenario definitions and the result files are in [`docs/reviews/control-review-2026-11-15/`](../reviews/control-review-2026-11-15/README.md); its README gives the build and run commands. The files this plan adds:

| File | What it is |
|---|---|
| `sim/band_edge_controller.h` | The reference implementation of the law. Its default constants are the law. The options marked as study options are off by default and are not part of it. |
| `sim/closed_loop2.cpp` | The review's closed-loop simulator with the law as a third controller, its relay layer, three mister zones, the runtime-balanced lead fan, the drying meter, relay start and run-hour totals, perfect-foresight pre-staging and hold-back, the degraded modes and a bias on the outdoor reading. Its model of today's firmware no longer limits humidity misting to a daytime window. |
| `sim/scenarios_plan.py` | Every scenario in this plan, in groups: `ref`, `law`, `ldeg`, `lprice`, `lecon`, `lpre`, `lrev`. |
| `sim/robustness_plan.py` | The one-factor changes to the model of section 5.8. |
| `sim/plan_tables.py` | Builds every table in this plan from the result files. |
| `results/plan_scenarios.csv`, `results/plan_robustness.csv` | The results, by year and season for every scenario and by month for today's firmware and the law. |

Each scenario is four single-process runs of about one second: two model variants, each with a cold-season and a warm-season model.

The review's own result files in the same directory were made before the correction to the model of today's firmware and are kept as they were; the review carries a dated note.

## Appendix C. Scenario names

| In this plan | Scenario |
|---|---|
| Today's firmware and settings | `fw_live` |
| Review step 1, step 2 and the review's two-axis controller | `fw_settings_300`, `fwp_all_day_best`, `kiss_strict_minabove0.5` |
| The law | `law` |
| Drying cost limit 0.5, 0.7, 1.0, none; never dry | `law_e0.5`, `law_e0.7`, `law_e1.0`, `law_eall`, `law_nodry` |
| A limit of 0.7 with a higher start line; the same at a limit of 0 | `e0.7_gas_from1.5`, `e0.7_gas_from2.0`; `law_gas_from1.5` |
| A higher stop line for drying at a limit of 0 | `law_dstop1.5`, `law_dstop2.0`, `law_dstop3.0` |
| Electric heater not ahead of the furnace; fan 1 always leads | `law_h1_not_first`, `law_lead_fixed` |
| No misters; centre mister only | `law_mist0`, `law_mist1` |
| One rule changed (section 5.6) | `s_*` |
| No outdoor data, without and with the effect check; outdoor dew point read wrong | `law_offline`, `law_offline_effect`, `law_out_dp+2`, `law_out_dp-2`, `law_out_dp-4` |
| Clock wrong; no clock (section 4.9) | `law_clock*`, `law_noclock`, `law_noclock_offline`; for today's firmware `fw_offline`, `fw_clock*`, `fw_frozen_noon`, `fw_frozen_noon_offline` |
| One band edge moved (section 5.7) | `p_*` (the night VPD edge: `p_vhi_night+0.30`) |
| Bands 1, 2 and 3 under the law and under today's firmware | `econ1`, `econ2`, `econ3`, `fw_econ1`, `fw_econ2`, `fw_econ3` |
| Pre-staging (section 6) | `pre_*` |
| Holding back while the sun is on the house or forecast (section 6) | `hold_sun_*` (`h0`: the present sun alone, no forecast) |
