# Climate control refactor plan, 2026-11-15

Status: ratified by the owner on 2026-11-16 (section 12). The same day he delegated its execution to the coordinator of the agent sessions (section 11.5). Nothing in it has been applied: no code, setting, database object or device was changed to write it. The state of each step is in its issue.

It updates sections 10 to 12 of the [control effectiveness review](../reviews/greenhouse-control-effectiveness-review-2026-11-15.md) after the owner set ten constraints for the design on 2026-11-15, and replaces them where they differ. It covers climate control only: the two heaters, the two fans, the vent, the fogger and the misters when they are used for humidity. Irrigation control and lighting control stay as they are (sections 8.7 and 8.8 list what must not be touched).

Simulated figures are printed as "model A / model B". A and B are the two fitted variants of the house model from the review (section 9.1 there); they differ mainly in how much moisture the house produces, which is not measured. Every simulated figure is for the weather year 2025-11-16 to 2026-11-15 and should be compared only with other simulated figures. The simulator, the scenario definitions and the result files are in [control-review-2026-11-15/](../reviews/control-review-2026-11-15/README.md), and every simulated figure in this document is taken from those result files.

## 0. Summary

**The proposal.** Replace the climate control stack with one control law that runs on the controller, is the same at every hour and in every season, and reads only the band. The band keeps its form: four edges (temperature low and high, VPD low and high) that follow the sun through anchors stored on the controller. Its values are the owner's (decision 9). Inside the band only the electric heater works steadily, holding a line near the low edge so that the furnace is the second stage. Every other action starts at an edge or just beside it (the furnace 0.5 F and drying 0.05 kPa inside it, cooling and fog at the edge, the second fan and the misters beyond it) and stops a fixed margin inside. The law has no modes, no clock or season tests and no settings a planner can change. This is the floating corridor that ADR-0004 accepted on 2026-06-18, implemented directly instead of approximated through modes. Section 4 gives the rules in full and appendix A lists the whole law in about 25 lines; the reference implementation is about 170 lines.

**What it does in simulation, on today's band.** It holds both temperature and VPD inside the band 88.6 / 80.4 % of the year against 70.5 / 59.6 % for today's firmware, with 62 / 66 % fewer relay starts (52 / 49 a day against 135 / 142).

**What it does not do by itself.** At the same band the law does not save run time or utilities. Run hours change by -2 / +12 %, electricity by +3 / +9 %, gas by +5 / +7 % and water by +7 / +16 %. Today's firmware saves them by leaving the band, and it mostly fails to dry the house: the law dries 75 / 60 nights in a hundred against 57 / 38, and drying takes vent, fan and heater time. A controller cannot hold a temperature for less heat than the house loses at that temperature. Run hours and utility use are set by where the band's edges are, and by the owner's price for drying (section 4.5). The law also humidifies dry winter hours that today's firmware leaves dry, so on today's band winter fog water rises from 26 / 4 to 57 / 11 gallons a day; the VPD high edge is the lever. With three small edits to the band the law makes far fewer relay starts and uses less water than today's firmware in both models, and less electricity and gas in model A. In model B, where the house makes more moisture, electricity, gas and run hours come out level with today's firmware or a little above it (21.3 against 21.0 kWh, 2.74 against 2.70 therms and 29.5 against 28.2 run hours a day), because the law spends them on drying:

| Year, simulated, model A / B | Both in own band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware, today's band | 70.5 / 59.6 | 57 / 38 | 135 / 142 | 24.5 / 28.2 | 19.6 / 21.0 | 2.18 / 2.70 | 63 / 56 |
| The law, today's band | 88.6 / 80.4 | 75 / 60 | 52 / 49 | 24.0 / 31.5 | 20.2 / 23.0 | 2.29 / 2.90 | 67 / 65 |
| Today's firmware, band 2 | 75.6 / 63.0 | 62 / 42 | 96 / 114 | 21.6 / 25.2 | 18.5 / 20.0 | 1.92 / 2.49 | 32 / 37 |
| The law, band 2 (three small band edits, section 5.7) | 88.9 / 81.9 | 77 / 63 | 41 / 47 | 21.6 / 29.5 | 18.2 / 21.3 | 1.98 / 2.74 | 34 / 39 |

Band 2 is: the low temperature edge 2 F lower at solar noon and sunset, the VPD high edge 0.10 kPa higher, and the high temperature edge 2 F higher at solar noon and sunset. Against today's firmware on today's band, the law on band 2 makes 70 / 67 % fewer relay starts and changes run hours by -12 / +5 %, electricity by -7 / +1 %, gas by -9 / +1 % and water by -45 / -31 %, while holding its band 88.9 / 81.9 % of the year. Where there is a saving it is the band's, not the law's. On band 2 itself the law uses about as much as today's firmware does there in model A and more in model B, where it dries nights that today's firmware leaves humid (run hours 0.0 / +4.3, kWh -0.2 / +1.3, therms +0.05 / +0.25, gallons +2 / +1 a day). What the law adds on any band is the compliance and the cycle count. The owner agreed to edit the band on 2026-11-15 and ratified band 2 on 2026-11-16 (decision 9). It is entered in the band editor on the same day as the five settings (appendix D, section 11.5). Section 5.7 prices each edge.

**What changes around the law.**

1. The controller runs alone. The law needs its own sensors and its stored anchors. It takes the time from the network and outdoor data from the weather station: without the time it serves a safe flat corridor, and without any outdoor reading it does not dry with outdoor air. A small firmware release ahead of the law removes what breaks isolated operation today: the reboot every five minutes while WiFi is down, the trust in a wrong clock, and substituted sensor readings (section 4.9). No hardware is added, so no battery clock (decision 8).
2. Outdoor air is used for drying under one rule with one number. A drying run may start only while the heat it carries out per kilogram of water carried out is within a limit that the owner sets on the dashboard. The controller computes that cost each second from its own readings, and the limit translates into how cold and damp it may be outside. The default is 0.7 kWh per kg: dry outdoor air down to about 38 F, and damp air never. Against never drying with outdoor air it costs +0.03 / +0.20 therm and +0.9 / +1.6 kWh a day, simulated, and dries 9 / 29 more nights in a hundred. The controller meters the hours, the water and the heat (section 4.5).
3. The electric heater leads the furnace by threshold, the fan with fewer run hours leads, the second fan joins on a fixed rule, and misters opted in for VPD are a second humidifying stage behind the fogger (sections 4.6 to 4.8).
4. Forecast rules were tested with perfect foresight. Acting early (pre-heating, pre-cooling, pre-drying) saves at most 0.02 therm a day and costs electricity or relay starts. Holding the electric heater's lines 1 F lower while the sun is on the house or due within 3 hours does save: 0.9 / 0.9 kWh a day, at a cost of 0.04 / 0.04 therm of gas. Of that saving, 72 / 79 % needs only the present sun and no forecast. The first release has neither rule (decision 15), and the forecast-action engine is removed (section 6).
5. The planner stops writing climate values. It becomes a daily reviewer that reports and proposes band edits; its irrigation tools stay (section 7).
6. Everything the law makes unnecessary is deleted in every layer: on the controller the mode logic (about 2,100 lines), 100 of 102 climate settings and 130 of 148 climate readbacks; on the host the planner's 48 writable settings, the moisture guardrail, the forecast engine and the experiment code; in the database about 78 tables and about 2.9 GB, with about 0.7 GB more saved by storing readbacks only when they change (section 8). The public site is out of scope, so what it reads is held back for now: seven more tables, the plan and scoring views and a little code (section 8.10).

**Decisions.** On 2026-11-16 the owner ratified every recommendation of this plan, with two changes: no hardware work, so no clock chip is fitted (decision 8), and lab.verdify.ai is out of scope (decision 19). Section 12 is the record. Later the same day he delegated execution to the coordinator of the agent sessions and asked for speed. Section 11.5 says who makes each production step, which waits are cut, and the defaults built on where the ratification left a point open; he can overrule each default. Nothing has been applied to the house. Section 11.4 is the execution order. Appendix D holds the two runbooks of phase 0, and appendix E the values compiled for irrigation and lighting.

**A correction to the review.** The review's simulator limited humidity misting under today's firmware to a daytime window and to 65 F and above. The firmware has no such limit. With it removed, today's firmware simulates at 70.5 / 59.6 % in band with 135 / 142 relay starts and 63 / 56 gallons a day; the review printed 71.8 / 60.6 %, 125 / 132 and 56 / 54. The review's step 1 and step 2 figures move by 0.1 point or less. This plan uses the corrected figures throughout, and the review carries a dated note.

**Limits.** The evidence for the law is a simulation fitted to this house, checked against one year of weather and two model variants. The plan's acceptance step is a measured comparison on the controller with rollback (section 13). Section 14 lists what the simulation does not cover.

## 1. The ten constraints and how the plan meets them

| # | Constraint | In the plan | Evidence |
|---|---|---|---|
| 1 | P0: the controller holds the house through network loss, with no outside input | The law reads only the controller's sensors, its stored anchors and its clock, which is set from the network (no battery clock, decision 8). Constants are compiled and anchors are stored in flash. Outdoor data is optional; the controller hears the weather station on the LAN itself and has a wired probe as second source. A defined band when there is no clock. No reboot on WiFi loss. | Section 4.9. Held for a whole year without outdoor data the law keeps 83.3 / 64.0 % (today's firmware 62.8 / 51.8 %); with no clock 52.9 / 44.7 % (today 10.3 / 31.2 %). Isolation tests in section 13. |
| 2 | No hardcoded exceptions, time of day and so on | One law with no branch on the hour, the solar phase, the date, the season, the zone or the weather. Every threshold is an offset from a band edge. The night dry-out machine, the economiser, the temperature and humidity gates on fog and the night-only branches go. What stays fixed is two protection limits (100 F and 40 F) and about 40 compiled numbers, each listed with its sweep. | Sections 4.2, 4.4 and 4.10. The compiled numbers were accepted as constants (decision 13). |
| 3 | Fewer on/off cycles, less run time, less utilisation | Cycles: every action but the electric heater's starts at an edge or just beside it; exit margins sized by sweep; one minimum on and off time per relay class; the electric heater stays on through furnace cycles. Run time: about equal at the same band in model A and higher in model B, where the law dries more; on band 2 lower in model A and a little higher in model B. | 52 / 49 starts a day against 135 / 142 (section 5.4). Run hours -0.4 / +3.3 a day on today's band. On band 2, -2.9 / +1.3 against today's firmware on today's band and 0.0 / +4.3 against today's firmware on band 2 (sections 5.5 and 5.7). |
| 4 | Less utility use | One price limit on drying, no pre-staging, no heater cut during drying, and a price for every band edge. At the same band the law uses more, because it holds the band and dries the house. The band edits the owner agreed to on 2026-11-15 (decision 9) bring a saving in model A and bring electricity and gas back level with today's in model B. | Sections 4.5, 5.5 and 5.7 |
| 5 | Electric heat before gas where possible | The electric heater switches at low+3.5 / low+4.5 and the furnace at low+0.5 / low+3.0, so the furnace starts only when the house has fallen 3 F below the electric heater's line with that heater on. | Section 4.6: 1.7 / 1.8 furnace hours a day less in winter than with the electric heater on the furnace's side of the swing. Today's firmware already runs the electric heater 19 / 20 hours a day in winter; against it the law's winter gas is +6 / +7 %, from the furnace line in model A and from drying in model B. |
| 6 | Fans alternate and escalate, equal wear | The fan with fewer accumulated run seconds leads each time both are off; the second fan joins at high+1.5; run seconds persist across reboots. | Section 4.7: 1.60 / 2.86 and 1.62 / 2.87 hours a day |
| 7 | Full control of heat1, heat2, fan1, fan2, fogger, vent and opted-in misters | The law drives the six relays every second and requests mister pulses through the irrigation engine for the lines opted in for VPD. No planner switch or host guardrail sits in between. The irrigation interlocks on the wet relays, occupancy and the manual overrides stay (section 4.3). | Sections 4.2, 4.3, 4.8 |
| 8 | Outdoor air for drying, within reason, measurable | One test. A drying run may start only while the heat carried out per kilogram of water carried out is within a limit: one stored number that the owner sets on the dashboard, 0.7 kWh per kg by default. In outdoor terms 0.7 admits dry air down to about 38 F and refuses damp air at every temperature; 1.0 reaches about 17 F. The controller meters drying hours, water and heat every day, so what the setting costs is read off the record. The rule of 2026-11-05 that gas never runs for humidity, and its nightly 10 kWh cap, are replaced by the owner's decision of 2026-11-15 (decision 1). | Section 4.5 |
| 9 | Keep the diurnal, solar-aligned band | Unchanged: the same anchors and curve, computed on the controller. One definition of the curve per runtime, tested against the same vectors. | Sections 3 and 9 |
| 10 | Use the forecast to pre-stage if it saves resources | Tested with perfect foresight. Acting early (pre-heat, pre-cool, pre-dry) saves at most 0.02 therm a day, for more electricity, and pre-cool and pre-dry add starts and run hours. Holding the electric heater's lines 1 F lower while the sun is on the house or due within 3 hours does save: 0.9 / 0.9 kWh a day at a cost of 0.04 / 0.04 therm of gas, and of that 0.6 / 0.7 kWh needs only the present sun. Holding the furnace's off line down as well saves 0.7 / 0.7 kWh and 0.04 / 0.04 therm for 1.7 / 2.0 more furnace starts. Not in the first release (decision 15). A lower daytime low edge is the larger lever of the same kind and needs no forecast (decision 9). The forecast stays for the reviewer and the dashboard. | Section 6 |
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
| To the controller | Band anchors: four edges at four solar points (sunrise, solar noon, sunset, solar midnight) | 16 | Yes, in flash. The ROM copy is today's deliberate dry-side view of the committed band file and is used only on a chip whose flash is empty (section 9). |
| To the controller | The drying cost limit (section 4.5) | 1 | Yes, in flash; the ROM copy is the released value |
| To the controller | Occupancy state and the occupancy inhibit switch | 2 | State expires after 60 minutes, as today |
| To the controller | Manual overrides (fan burst, humidify burst, vent bypass) with their timeout | as today | No |
| To the controller | Time (SNTP from the two local servers) | - | None kept across a power cut. A retained clock survives a soft reset and is not trusted for the band until a time server answers (decision 8, section 4.9) |
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
6. **Misters** opted in for VPD join above `vpd_high + 0.30` and leave below `vpd_high + 0.05`. One line pulses at a time, 30 s on with a 60 s gap, and a pulse is 1.4 times longer while the zone's VPD is above 1.2 times `vpd_high` (section 4.8; the simulator ran 60 s on and 45 s off). The irrigation engine grants each pulse and picks the line (section 4.8).

   Neither the fogger nor the misters run while the house is below the band's low temperature edge. A cold, dry house, which is what a heating failure in winter gives, is not wetted: the request waits and acts when the house is back at the edge (decision 20).
7. **Drying with outdoor air** (vent open, lead fan) is wanted below `vpd_low + 0.05` until above `vpd_low + 0.20`. It runs only while all three hold:
   - outdoor data is fresh and the outdoor air is drier: its dew point is at least 3 F below the indoor dew point (it stops when less than 1 F below), and it holds at least 0.1 g/kg less water;
   - the price is right: a run starts only while the house is at or above `low + 1.5` and the cost of drying, in heat carried out per kilogram of water carried out, is within the owner's limit of section 4.5; it stops below `low + 0.75`;
   - the house is not cooling and the furnace is off.

   No fog or mist while drying. Drying does not switch the electric heater off: the heater keeps following rule 1.

Protection, independent of the band:

8. At or above 100 F: vent open, both fans on, both heaters off. The fogger keeps following rule 5, as today's firmware does at this limit. The misters also keep following rule 6. That is a declared change: today's firmware runs no climate mister pulse at this limit, and none from about 95 F. The irrigation engine's own gates still decide every pulse (section 8.7).
9. At or below 40 F: both heaters on, vent closed, fans, fogger and misters off. Today's firmware also runs a fan in this state; the law does not (decision 12).

Rules 8 and 9 are backstops. With a valid band (edges within 45 to 95 F) rules 1 to 4 have already asked for the heating or cooling they ask for, so they add something only when the band is corrupt, a reading is wrong or the equipment cannot hold the house: with the furnace out, the house reaches 40 F in winter (section 5.8). Rule 9 also stops the fogger and the misters. They are tested with a band that bypasses validation.

The fogger may run with the vent open, so on a hot, dry afternoon rules 3 and 5 together give evaporative cooling without a rule of their own.

**On the case sensor alone.** When the wall probes are invalid and only the case sensor is left, today's firmware stops controlling humidity, because that sensor's humidity is not representative. The law does the same: rules 1 to 4, 8 and 9 run on the case sensor and rules 5 to 7 hold. The case sensor reads warmer than the wall probes (a median of 1.6 F over the 30 days to 2026-11-16: 3.3 F with the sun up, 0.6 F at night), so the temperature rules use its reading less a compiled offset, the median difference measured against the wall probes in the 30 days before the release. Without the offset the house would be held about that much below what the band asks. This state is not simulated; it is a host test in phase 2.

### 4.3 The relay layer

Between the law's requests and the relays there is one small layer. It replaces today's conflict arbitration (`arbitrate_relay_conflicts`), whose rules cut both heaters when the vent or a fan is on (except in cold protection and in the drying mode), make the furnace wait for the electric heater, and give the vent priority over the furnace. The layer below is the one the simulation used.

- A minimum on time and a minimum off time per relay: 300 s and 300 s for the two heaters, the fans and the vent; 120 s and 120 s for the fogger. At boot every relay is available at once. Today the timers start at zero, which holds each relay off for its minimum off time after every restart (heaters 180 s, fans 90 s, vent and fogger 60 s).
- A fan runs only with the vent open: the vent opens first and the fan follows on the next pass. The vent stays open while a fan runs.
- The furnace and the vent are never on together. The vent and fans wait until the furnace has finished its minimum on time and stopped; the furnace waits until the vent has closed. The furnace is never cut short for drying or cooling.
- The electric heater is not cut when the vent opens to dry. Today the night dry-out switches it off for the first 180 s of each pulse (issue #1675).
- The lead fan is the fan with fewer accumulated run seconds, chosen each time both fans are off (section 4.7).
- The law never switches a mister valve. It asks the irrigation engine for a pulse (section 4.8).

A minimum time is cut short only in these cases:

| Case | What is cut | Status |
|---|---|---|
| 100 F limit | The furnace is switched off at once and the vent does not wait for it | New in this form; today's firmware does the same through its safety mode |
| No valid indoor reading | The state of decision 7 is entered at once | New. It reverses the disposition recorded on issue #1296 and is built as ratified (section 11.5). Today, when every probe is silent, the controller restarts once and then controls on substituted 65 F and 50 %; a reading that fails the plausibility test turns every relay off (section 4.9) |
| Fertiliser master open or the fertigation line holding, a drip relay on, occupancy, sensor fault | Fogger and misters off at once, in every state | As today |
| The irrigation engine's drip in progress, the soft water budget (not during a VPD emergency), the daily water safety cap | The fogger off at once, except at the 100 F limit, where fog is counted and not capped. The misters are held by all three in every state, because the engine's grant refuses them | As today |
| Manual overrides | Force a relay on or off. In the state of decision 7 the fan, vent and fogger overrides stay effective (today they do nothing in the sensor-fault state); none exists for the heaters | Changed in the state of decision 7 (section 11.5) |

The first row is in the simulated layer. The others are holds that the simulator does not model (section 14). At the 40 F limit nothing is cut short: a vent or fan still inside its minimum on time finishes it, and the furnace starts once the vent has closed. With a valid band the vent cannot be open at 40 F, so this matters only for a corrupt band.

### 4.4 The constants

The law has no exception: no branch on the hour, the solar phase, the date, the season or the zone. It does have fixed numbers. They are compiled into the firmware from one generated file (section 9), have no readback, and the firmware reports one hash of them. A compiled number cannot be lost at a reboot, delivered wrongly or left unconfirmed, and changing one is a firmware release, which this repository can ship at any time. That they are fixed, and not settings, is decision 13.

| Constant | Value | What the sweep says (section 5.6; year, model A / B, difference from the law) |
|---|---|---|
| Electric heater on / off above `low` | 3.5 / 4.5 F | Its lines sit above the furnace's off line so that it stays on through furnace cycles. Moving both lines 0.5 F up: +0.74 / +0.58 kWh and -0.033 / -0.018 therm a day. Moving them 0.5 F down with the furnace unchanged: -0.74 / -0.66 kWh and +0.033 / +0.030 therm. The position trades electricity for gas: moving the lines up, 0.8 / 1.1 kWh of electricity for each kWh of gas saved; moving them down, 0.8 / 0.8. In heat delivered to the house, moving them up costs 2.3 / 2.9 kWh of electric heat for each kWh of furnace heat saved, because the higher line also holds the house warmer (section 4.6). |
| Furnace on / off above `low` | 0.5 / 3.0 F | On at 0.5 keeps the house off the edge: too cold 0.6 / 0.7 % of the year against 1.9 / 2.6 % today. The off line and the heater's lines move together. One step narrower (furnace off at 2.5, heater 3.0 / 4.0): +2.1 / +2.9 furnace starts, -0.71 / -0.56 kWh and -0.052 / -0.040 therm a day (decision 2). |
| Cooling off below `high` | 2.0 F | At 1.5: +1.2 / +0.9 starts a day. At 3.0: +0.75 / +0.72 run hours a day. |
| Second fan on above `high` | 1.5 F | At 0.5: +0.1 / +0.1 starts a day. At 3.0: -0.1 / -0.5 starts a day and 0.00 / -0.04 point. |
| Fogger off below `vpd_high` | 0.15 kPa | At 0.10: +4.1 / +2.6 starts a day. At 0.20: +5.3 / +2.0 gallons a day. |
| Misters join / leave above `vpd_high` | 0.30 / 0.05 kPa | The fogger alone holds the edge almost all the time; without misters compliance changes by 0.00 / -0.13 point. |
| No fog or mist below | `low` | The cold-house guard of rules 5 and 6 (decision 20). Without it compliance changes by +0.02 / +0.02 point and relay starts by -0.7 / -0.3 a day. |
| Drying on / off above `vpd_low` | 0.05 / 0.20 kPa | Starting at 0.10: +5.6 / +8.1 starts a day. Starting at the edge: -0.3 / -0.8 point. |
| Drying start / stop above `low` | 1.5 / 0.75 F | A run starts at or above the first while its cost is within the limit, and stops below the second, which is above the furnace's on line. Starting at 1.0: +1.5 / +4.4 starts a day. Stopping below 1.0: -0.1 / -0.7 point (section 4.5). |
| Outdoor dew point below indoor to start / stop | 3 / 1 F | A single 2 F margin: +3.1 / +5.7 starts a day. |
| Least outdoor moisture difference | 0.1 g/kg | Guards the division in the cost. |
| Air pressure for the humidity ratio | 85 kPa | The firmware's compiled site value. |
| Drying cost limit (stored, not compiled) | 0.7 kWh of heat per kg of water by default; 0 to 1.5 | The owner's number, edited on the dashboard (decision 1, taken on 2026-11-15). Section 4.5. |
| Protection limits | 100 F and 40 F | Today's values. |
| Minimum on / off: heaters, fans, vent | 300 / 300 s | Fans and vent at 180 s: +0.2 / +0.8 starts a day; at 120 s: +0.2 / +1.4. Heaters at 180 s: no difference at all; in a simulation without sensor noise a heater cycle is longer than either value. |
| Minimum on / off: fogger | 120 / 120 s | At 60 s: +2.7 / +1.5 starts a day. At 180 s: -0.4 / -0.1 point and +16.4 / -1.8 starts a day. |
| Mister pulse / gap / longer pulse | 30 / 60 s; a pulse 1.4 times longer while the zone's VPD is above 1.2 times `vpd_high` | The values the controller held most in the 30 days before 2026-11-16 (decision 13, appendix E, section 11.5). Not swept: the simulator runs one cadence, 60 s on and 45 s off, with no longer pulse. |
| Outdoor data maximum age, station and intake probe | 600 s | Today's value for the station. Not exercised in the simulation, which has outdoor data for a whole run or not at all. |
| Minimum band width | 6.5 F and 0.35 kPa | Derived (section 4.1). |
| Band limits | 45 to 95 F, 0.3 to 3.0 kPa | The editor's existing limits. |
| Fan run-second save interval | 3,600 s | Section 4.7. |
| Sensor-bus restart, no probe update for | 3,600 s | Today's value (section 4.9). |
| Occupancy expiry | 60 minutes | Today's value. |
| Case sensor offset | The median difference from the wall probes in the 30 days before the release (1.6 F for the 30 days to 2026-11-16; 3.3 F with the sun up, 0.6 F at night) | Used only when the wall probes are invalid (sections 4.2 and 4.9). Not simulated. |
| Kept for the irrigation engine: VPD emergency, dew-point margin for wetting, mister line minimum off, mister zone ranks | 2.5 kPa, 8 F, 45 s, centre first | Section 8.7. These are the values the controller holds today (appendix E, decision 13), so that irrigation does not change; the owner can change any of them before the flash (section 11.5). The dew-point margin is the larger of today's day and night values (8 and 6 F), with no night test. |

About 40 numbers in all. Section 5.6 shows the sweeps for the year and by season. Outside the heating lines and the drying start line no change to a margin gains more than 0.6 point of compliance over the year, 1.0 in winter or 0.4 in summer, which is the evidence that one value can serve the whole year. Starting drying at `low + 1.0` gains +0.2 / +1.2 points (+0.2 / +1.6 in winter), but it is only 0.25 F above the stop line and waits for the noise test (section 4.5). The heating lines are a trade, and the owner took them as proposed (decision 2): lower lines save energy for more furnace starts.

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

The rule is one test of price. A drying run may start while the house is at or above `low + 1.5` and `e` is at or below the limit. It stops below `low + 0.75`, which is above the furnace's on line, or when another condition of rule 7 ends it. The limit is checked when a run starts; a run that started within it continues if the outdoor air turns colder, until one of its stop conditions. A run spends the heat stored between its start and stop lines. On a mild night the electric heater restores it, and on a cold night an ordinary furnace cycle does, once the house has cooled to `low + 0.5`. The limit is the price the owner accepts, in heat, for each kilogram of water removed, whichever heater pays.

**The limit is the owner's number.** On 2026-11-15 the owner decided that the limit is above zero, that it is edited on the dashboard, and that this plan sets its default (decision 1). That replaces the rule of 2026-11-05 (the amendment to ADR-0004), under which gas never ran for humidity and a night's ventilation was capped at 10 kWh. The machinery around that rule goes with it: the night-only test, the pulse and rest timers and the forced heater cut.

**The default is 0.7 kWh per kg.** Three things recommend it.

- It is "within reason" in outdoor terms. By the table above, 0.7 admits outdoor air down to about 38 F when that air is dry, and, with the house at 62 F, refuses outdoor air at 70 % relative humidity at every temperature in the table, because damp air carries little water out for the heat it takes. A warmer house admits mild, damp air sooner. That is the constraint as the owner worded it: not when it is very cold outside.
- It is about the heat that evaporated the water. Evaporating a kilogram of water takes 0.68 kWh. At 0.7 a run starts only while throwing a kilogram of water out costs about as much heat as it took to put it into the air.
- Each step above it buys less. Raising the limit from 0 to 0.7 holds the band 5.4 / 15.7 points more for 0.03 / 0.20 therm and 6 / 16 relay starts a day. Removing the limit altogether adds 0.7 / 2.1 points for another 0.05 / 0.15 therm and 4 / 6 starts. A lower default is defensible where cycles and run time count most: 0.5 gives up 0.6 / 1.8 points for 1.7 / 3.7 fewer starts and 0.7 / 0.9 fewer run hours a day.

Over the year, on today's band:

| Drying cost limit | Both in band % | Nights dried % | Too humid % | Therms/day | kWh/day | Relay starts/day | Furnace starts/day | Vent starts/day | Drying hours/day | Water carried out kg/day | Heat carried out kWh/day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Never dry with outdoor air | 83.3 / 64.0 | 66 / 31 | 12.4 / 29.0 | 2.26 / 2.70 | 19.3 / 21.3 | 45.9 / 32.7 | 9.0 / 11.8 | 3.3 / 1.2 | 0.00 / 0.00 | 0.0 / 0.0 | 0.0 / 0.0 |
| Limit 0: only while the outdoor air is at least as warm as the house | 83.3 / 64.7 | 66 / 32 | 12.4 / 28.3 | 2.26 / 2.70 | 19.3 / 21.4 | 45.9 / 33.4 | 9.0 / 11.9 | 3.3 / 1.5 | 0.00 / 0.05 | 0.0 / 0.3 | 0.0 / 0.0 |
| Limit 0.2 kWh/kg | 84.8 / 72.5 | 67 / 44 | 10.9 / 20.7 | 2.26 / 2.74 | 19.4 / 22.2 | 47.0 / 39.2 | 9.0 / 12.1 | 3.9 / 4.3 | 0.17 / 1.25 | 0.4 / 3.4 | 0.1 / 0.9 |
| Limit 0.3 | 86.2 / 75.7 | 71 / 51 | 9.5 / 17.5 | 2.26 / 2.77 | 19.6 / 22.6 | 48.1 / 41.8 | 9.0 / 12.3 | 4.4 / 5.6 | 0.42 / 1.88 | 0.8 / 4.6 | 0.4 / 1.5 |
| Limit 0.4 | 87.2 / 77.7 | 72 / 53 | 8.5 / 15.5 | 2.27 / 2.80 | 19.8 / 22.8 | 49.1 / 43.7 | 9.0 / 12.4 | 4.9 / 6.5 | 0.62 / 2.30 | 1.1 / 5.3 | 0.6 / 2.0 |
| Limit 0.5 | 88.0 / 78.6 | 74 / 54 | 7.7 / 14.6 | 2.28 / 2.83 | 19.9 / 22.9 | 49.8 / 45.2 | 9.1 / 12.6 | 5.2 / 7.1 | 0.81 / 2.48 | 1.4 / 5.7 | 0.8 / 2.4 |
| Limit 0.6 | 88.4 / 79.5 | 75 / 58 | 7.3 / 13.7 | 2.28 / 2.86 | 20.1 / 22.9 | 50.6 / 47.2 | 9.1 / 12.9 | 5.6 / 8.0 | 0.95 / 2.66 | 1.5 / 6.2 | 1.0 / 2.7 |
| **Limit 0.7 (the default)** | 88.6 / 80.4 | 75 / 60 | 7.1 / 12.8 | 2.29 / 2.90 | 20.2 / 23.0 | 51.5 / 48.9 | 9.2 / 13.2 | 6.0 / 8.7 | 1.08 / 2.82 | 1.7 / 6.6 | 1.2 / 3.1 |
| Limit 0.85 | 88.9 / 81.3 | 76 / 62 | 6.8 / 11.9 | 2.30 / 2.96 | 20.3 / 23.0 | 52.6 / 51.3 | 9.2 / 13.6 | 6.5 / 9.7 | 1.19 / 3.02 | 1.8 / 7.1 | 1.4 / 3.7 |
| Limit 1.0 | 89.1 / 82.0 | 76 / 64 | 6.7 / 11.2 | 2.31 / 3.01 | 20.4 / 23.1 | 53.3 / 53.1 | 9.3 / 13.9 | 6.8 / 10.5 | 1.27 / 3.17 | 1.9 / 7.5 | 1.6 / 4.2 |
| Limit 1.5 (the top of the range) | 89.3 / 82.6 | 77 / 66 | 6.4 / 10.7 | 2.33 / 3.06 | 20.4 / 23.1 | 54.8 / 54.8 | 9.5 / 14.2 | 7.5 / 11.2 | 1.37 / 3.29 | 2.1 / 7.8 | 1.8 / 4.6 |
| No limit | 89.3 / 82.5 | 78 / 66 | 6.4 / 10.7 | 2.34 / 3.06 | 20.4 / 23.1 | 55.1 / 54.9 | 9.5 / 14.2 | 7.6 / 11.2 | 1.38 / 3.29 | 2.1 / 7.8 | 1.8 / 4.6 |

In winter:

| Drying cost limit | Both in band % | Nights dried % | Too humid % | Therms/day | kWh/day | Relay starts/day | Furnace starts/day | Vent starts/day | Drying hours/day | Water carried out kg/day | Heat carried out kWh/day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Never dry with outdoor air | 91.2 / 70.2 | 75 / 26 | 7.4 / 28.9 | 3.68 / 4.23 | 28.4 / 29.2 | 37.3 / 27.2 | 15.0 / 20.0 | 0.2 / 0.3 | 0.00 / 0.00 | 0.0 / 0.0 | 0.0 / 0.0 |
| Limit 0: only while the outdoor air is at least as warm as the house | 91.2 / 71.2 | 75 / 28 | 7.4 / 27.8 | 3.68 / 4.23 | 28.4 / 29.3 | 37.3 / 27.7 | 15.0 / 20.1 | 0.2 / 0.6 | 0.00 / 0.07 | 0.0 / 0.4 | 0.0 / 0.0 |
| Limit 0.2 kWh/kg | 91.7 / 78.5 | 77 / 40 | 6.8 / 20.6 | 3.68 / 4.30 | 28.5 / 30.3 | 37.4 / 31.4 | 15.0 / 20.5 | 0.3 / 2.2 | 0.15 / 1.20 | 0.4 / 4.7 | 0.1 / 1.0 |
| Limit 0.3 | 92.6 / 80.4 | 79 / 46 | 5.9 / 18.6 | 3.68 / 4.34 | 28.8 / 30.5 | 37.9 / 33.2 | 15.1 / 20.7 | 0.4 / 3.0 | 0.40 / 1.50 | 1.0 / 5.9 | 0.5 / 1.4 |
| Limit 0.4 | 93.1 / 81.9 | 80 / 48 | 5.4 / 17.2 | 3.69 / 4.38 | 29.0 / 30.5 | 38.2 / 35.5 | 15.1 / 21.0 | 0.6 / 4.1 | 0.56 / 1.69 | 1.3 / 6.7 | 0.7 / 1.8 |
| Limit 0.5 | 93.5 / 83.1 | 81 / 48 | 5.1 / 16.0 | 3.70 / 4.43 | 29.0 / 30.6 | 38.5 / 37.5 | 15.2 / 21.3 | 0.8 / 4.9 | 0.66 / 1.87 | 1.6 / 7.3 | 0.9 / 2.2 |
| Limit 0.6 | 93.6 / 84.4 | 81 / 54 | 5.0 / 14.7 | 3.71 / 4.48 | 29.0 / 30.6 | 39.1 / 40.7 | 15.2 / 21.9 | 1.1 / 6.2 | 0.70 / 2.07 | 1.7 / 8.1 | 1.0 / 2.8 |
| **Limit 0.7 (the default)** | 93.7 / 85.7 | 81 / 59 | 4.9 / 13.4 | 3.72 / 4.54 | 29.1 / 30.7 | 39.8 / 43.3 | 15.3 / 22.3 | 1.4 / 7.3 | 0.77 / 2.28 | 1.9 / 8.7 | 1.1 / 3.4 |
| Limit 0.85 | 93.7 / 87.0 | 81 / 62 | 4.9 / 12.1 | 3.73 / 4.63 | 29.1 / 30.7 | 40.6 / 47.0 | 15.4 / 22.9 | 1.7 / 8.9 | 0.84 / 2.56 | 2.0 / 9.6 | 1.3 / 4.2 |
| Limit 1.0 | 93.8 / 87.9 | 82 / 64 | 4.7 / 11.1 | 3.74 / 4.70 | 29.1 / 30.8 | 41.5 / 49.9 | 15.4 / 23.4 | 2.1 / 10.1 | 0.92 / 2.79 | 2.2 / 10.2 | 1.5 / 5.0 |
| Limit 1.5 (the top of the range) | 94.0 / 88.8 | 84 / 68 | 4.5 / 10.3 | 3.78 / 4.78 | 29.2 / 30.8 | 43.3 / 52.9 | 15.7 / 24.0 | 2.9 / 11.3 | 1.05 / 3.00 | 2.4 / 10.8 | 1.9 / 5.7 |
| No limit | 94.1 / 88.7 | 84 / 68 | 4.4 / 10.3 | 3.78 / 4.78 | 29.2 / 30.8 | 43.6 / 53.1 | 15.8 / 24.0 | 3.0 / 11.4 | 1.06 / 3.00 | 2.4 / 10.8 | 1.9 / 5.7 |

On band 2 (section 5.7), over the year:

| Drying cost limit, band 2, year | Both in band % | Nights dried % | Too humid % | Therms/day | kWh/day | Relay starts/day | Furnace starts/day | Vent starts/day | Drying hours/day | Water carried out kg/day | Heat carried out kWh/day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Limit 0 | 83.0 / 63.8 | 67 / 36 | 13.2 / 30.5 | 1.95 / 2.47 | 17.3 / 19.6 | 35.0 / 28.4 | 9.8 / 12.0 | 2.5 / 1.3 | 0.00 / 0.06 | 0.0 / 0.3 | 0.0 / 0.0 |
| Limit 0.5 | 88.3 / 79.9 | 75 / 57 | 8.0 / 14.7 | 1.97 / 2.65 | 18.0 / 21.2 | 39.3 / 42.7 | 10.0 / 13.2 | 4.6 / 8.0 | 0.88 / 2.73 | 1.6 / 7.2 | 0.9 / 2.8 |
| **Limit 0.7 (the default)** | 88.9 / 81.9 | 77 / 63 | 7.4 / 12.6 | 1.98 / 2.74 | 18.2 / 21.3 | 40.7 / 47.1 | 10.0 / 13.9 | 5.3 / 9.9 | 1.11 / 3.11 | 1.8 / 8.2 | 1.2 / 3.6 |
| Limit 1.0 | 89.5 / 83.7 | 78 / 69 | 6.8 / 10.8 | 2.01 / 2.85 | 18.3 / 21.4 | 42.5 / 51.5 | 10.2 / 14.6 | 6.1 / 11.7 | 1.30 / 3.47 | 2.0 / 9.1 | 1.5 / 4.7 |

- **What the default costs.** Against never drying with outdoor air, the default dries 9 / 29 more nights in a hundred and holds the band 5.4 / 16.4 points more, for +0.03 / +0.20 therm, +0.9 / +1.6 kWh, +5.6 / +16.2 relay starts and +2.6 / +6.7 run hours a day. Drying is where the law spends more run time and utilities than today's firmware, whose night dry-out runs 1.0 / 1.2 hours a day against the law's 1.1 / 2.8, and the limit is the owner's control over it.
- **The two models disagree** about what the limit buys, because they disagree about how much moisture the house makes. That quantity is measured in phase 1 (issue #1669). The measurement tunes the default; it no longer decides whether the limit is above zero.
- **No daily cap.** The limit prices each kilogram, so the total needs no cap of its own. At the default the heat carried out averages 1.2 / 3.1 kWh a day (1.1 / 3.4 in winter) against the old rule's 10 kWh a night; the largest single day was not tabulated. The controller meters drying every day: hours, water carried out and heat carried out. A cap on the daily total can be added later as a second stored number if the meter shows the need; it would be a counter over the last 24 hours, not a night test.
- **The range is 0 to 1.5 kWh per kg, in steps of 0.05.** At 0 a run starts only while the outdoor air is at least as warm as the house, which is close to never. At 1.5 the limit has almost stopped binding: the last two rows of the tables differ by a few tenths of a relay start a day. The controller clamps the stored value to the range, and uses the compiled default when the stored value cannot be read.
- **The start line.** `low + 1.5` is 0.75 F above the stop line. Starting at `low + 1.0` holds +0.2 / +1.2 points more of the band for +1.5 / +4.4 starts a day, but it is 0.25 F above the stop line and the simulation has no sensor noise. Starting at `low + 2.0` gives up 0.2 / 1.5 points for 0.6 / 2.4 fewer starts. The line is in the noise test of phase 3 (section 13).
- **On the intake probe alone** the rule is the same. The cost uses the outdoor temperature, and the intake probe may read warm (section 4.9). A probe that reads 8 F warm when the outdoor air is 30 F colder than the house understates the cost by about a quarter, so a limit of 0.7 would admit air that costs up to about 0.95. Phase 1 measures the probe's offset against the station; if it matters, the release subtracts the median, as it does for the case sensor.

| Drying run | Both in band % | Nights dried % | Too humid % | Therms/day | kWh/day | Relay starts/day | Furnace starts/day | Vent starts/day | Drying hours/day | Water carried out kg/day | Heat carried out kWh/day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Start at or above low+1.5, stop below low+0.75 (the law)** | 88.6 / 80.4 | 75 / 60 | 7.1 / 12.8 | 2.29 / 2.90 | 20.2 / 23.0 | 51.5 / 48.9 | 9.2 / 13.2 | 6.0 / 8.7 | 1.08 / 2.82 | 1.7 / 6.6 | 1.2 / 3.1 |
| Start at or above low+1.0 | 88.9 / 81.6 | 76 / 63 | 6.9 / 11.6 | 2.29 / 2.93 | 20.2 / 23.0 | 53.0 / 53.3 | 9.2 / 13.3 | 6.7 / 10.8 | 1.09 / 2.93 | 1.7 / 7.0 | 1.2 / 3.3 |
| Start at or above low+2.0 | 88.4 / 78.9 | 75 / 58 | 7.3 / 14.3 | 2.28 / 2.88 | 20.2 / 22.9 | 50.9 / 46.6 | 9.1 / 13.0 | 5.7 / 7.6 | 1.04 / 2.68 | 1.5 / 6.1 | 1.1 / 2.9 |
| Stop below low+1.0 | 88.5 / 79.7 | 75 / 58 | 7.2 / 13.5 | 2.28 / 2.88 | 20.2 / 23.0 | 51.7 / 49.1 | 9.1 / 13.1 | 6.1 / 8.9 | 1.04 / 2.71 | 1.6 / 6.3 | 1.1 / 3.0 |
| Study: a run may also start at or above low+3.5 whatever its cost | 88.8 / 80.4 | 75 / 60 | 7.0 / 12.8 | 2.29 / 2.90 | 20.3 / 23.0 | 52.0 / 48.9 | 9.2 / 13.2 | 6.2 / 8.7 | 1.16 / 2.83 | 1.7 / 6.6 | 1.3 / 3.2 |

**A second way in was studied and not adopted.** The first form of this rule also let a run start at or above `low + 3.5`, the electric heater's on line, whatever its cost, on the reasoning that the house has heat to spare there. At the default limit that changes compliance by +0.1 / 0.0 point and adds +0.14 / 0.00 kWh, +0.3 / 0.0 run hours and +0.5 / 0.0 relay starts a day (the last row above). It would also let the house throw heat out at any price on a very cold night, which is what the constraint rules out. With one test, no run starts above the owner's price, and the heating lines of decision 2 no longer move the drying rule.

**One stored number.** The limit is the owner's price for a dry house, so it is the one value besides the band that is stored on the controller and can be edited. It is delivered and read back like an anchor, its ROM copy is the released default, and the dashboard shows it beside the band with the drying meter. No agent can write it (section 7). Everything else in the law is compiled.

**Measuring it.** The controller accumulates three numbers while drying runs: the seconds, the water carried out (from the two humidity ratios and the fan's rated flow) and the heat carried out. They are published as daily totals with the reason drying was refused when it was wanted (no outdoor data, outdoor air not drier, cost above the limit, house too cold, furnace on). The last three columns of the tables above are the same meter in the simulator. The heat carried out is the heat the heaters or the sun must replace, so it is the upper bound of what drying costs in utilities on that day. The host adds one figure from the relay record: furnace starts within 15 minutes of the end of a drying run. The water and heat figures depend on the fan flow, which is rated and not measured, so they are comparable day to day but not exact.

### 4.6 Electric heat first (constraint 5)

The electric heater's lines sit above the furnace's whole swing. In mild weather the electric heater holds the house between `low + 3.5` and `low + 4.5` alone and the furnace never starts. When the electric heater cannot hold the house, the temperature falls to `low + 0.5`, the furnace lifts it to `low + 3.0` and stops, and the electric heater has stayed on throughout. The electric heater starts 0.8 / 0.8 times a day in simulation against 11.0 / 16.8 today.

So inside the band one relay does work: the electric heater holds a line 3.5 to 4.5 F above the low edge. That is the cost of the ordering, and the sweep prices it. Moving the heater's lines down 0.5 F together with the furnace's off line saves 0.71 / 0.56 kWh a day; moving them up 0.5 F alone costs 0.74 / 0.58 kWh and saves 0.033 / 0.018 therm a day: 0.72 / 0.58 kWh more electric heat for 0.31 / 0.20 kWh less furnace heat, the rest going to a house that is held warmer. Moving them down 0.5 F alone does the reverse: -0.74 / -0.66 kWh and +0.033 / +0.030 therm a day, with +0.33 / +0.34 kWh of furnace heat in place of 0.73 / 0.66 kWh of electric heat. With the whole heating stack 1 F lower (heater 2.5 / 3.5, furnace off at 2.0) the result is -1.36 / -1.16 kWh, -0.098 / -0.076 therm and +5.2 / +6.9 furnace starts a day. The position of the lines is a choice between electricity, gas and furnace starts (decision 2).

If the electric heater is dead or unpowered the same thresholds make the furnace carry the house with no flag or setting: in simulation the law then holds 86.3 / 79.9 % of the year at 3.81 / 4.55 therms a day. An alert on "relay on, no power drawn" is still needed (issue #1637), because the heater relay ran for 209 days with no heat and nothing reported it.

What the ordering is worth, against the same law with the electric heater on the furnace's side of the swing:

| Winter (October to April) | Electric heater h/day | Furnace h/day | kWh/day | Therms/day | Furnace starts/day | All starts/day | Both in band % |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware | 19.1 / 20.2 | 4.68 / 5.67 | 28.0 / 29.2 | 3.51 / 4.25 | 16.3 / 21.3 | 89 / 84 | 79.2 / 63.5 |
| The law: electric heater first | 19.3 / 21.0 | 4.95 / 6.06 | 29.1 / 30.7 | 3.72 / 4.54 | 15.3 / 22.3 | 40 / 43 | 93.7 / 85.7 |
| Reference: electric heater on at low+1.0, off at low+2.0 (not ahead of the furnace) | 7.6 / 8.9 | 6.61 / 7.85 | 12.1 / 13.2 | 4.96 / 5.89 | 19.9 / 27.0 | 62 / 77 | 92.2 / 86.3 |

Electric first uses 17 / 17 kWh a day more electricity in winter and 1.24 / 1.34 therms a day less gas, with 36 / 44 % fewer relay starts. The electric heater runs 19 / 21 hours a day in winter under the law and 19 / 20 under today's firmware; that is the design. Against today's firmware the law's winter gas is +6 / +7 %. In model A most of it (+5 %) is the furnace starting 0.5 F above the low edge, where today's firmware starts it at the edge and spends 3.0 / 4.1 % of the winter below it. In model B all of it is drying: without drying the law uses 0.5 % less winter gas than today's firmware.

### 4.7 Fans: alternate and escalate (constraint 6)

- **Lead.** Each time both fans are off, the fan with fewer accumulated run seconds becomes the lead for the next run. There is no swap during a run, so alternating adds no cycles. This replaces today's helper, which swaps the lead in the middle of a run when the run times differ by more than 600 s and also rotates on a timer.
- **Escalate.** The second fan joins above `high + 1.5` and leaves below `high`. Both fans run at the 100 F limit. Drying uses the lead fan only: adding the second fan while VPD is more than 0.05 kPa below the low edge changes compliance by 0.0 / 0.0 point for +0.9 / +2.6 starts a day.
- **Memory.** The run seconds and start counts are kept in memory and saved to flash once an hour, then restored at boot. Today both are cleared at local midnight and lost on a reboot.

| Year | Fan 1 h/day | Fan 2 h/day | Fan 1 starts/day | Fan 2 starts/day |
|---|---:|---:|---:|---:|
| The law: the fan with fewer run hours leads | 1.60 / 2.86 | 1.62 / 2.87 | 3.1 / 4.4 | 2.9 / 4.4 |
| Reference: fan 1 always leads | 3.01 / 5.38 | 0.22 / 0.36 | 6.0 / 8.7 | 0.0 / 0.1 |

The measured record shows today's firmware already keeps the two fans within a few percent of each other per month; the plan keeps that and makes it survive reboots.

### 4.8 Misters opted in for VPD (constraint 7)

Which mister lines may be used for humidity is already a per-line flag in the irrigation program, set by the owner in the dashboard. The law asks the irrigation engine for a pulse on a member line through the engine's existing grant call and never opens a mister valve itself. The engine's daily caps, its soft water budget, its watchdog and its interlocks keep applying, unchanged.

**Which line.** The engine's ranking picks the line, as today, and its code does not change. What changes is what it is given. Today each zone is compared with its own VPD target curve. Under the plan each zone is compared with the house band: a zone wants water while its own VPD reading is above the house band's high edge, and among those the owner's rank decides, the centre first. The ranks become compiled values: centre 1, south 2, west 3 and east 4, which the controller has held without change (appendix E). When the engine refuses a pulse (occupancy, a drip in progress, a cap reached, the first seconds after boot), the law asks again at the next pulse boundary; the fogger carries on meanwhile. The simulator is simpler than this: it rotates the member lines and opens them directly.

**Fairness.** Today's climate mister code has a rule of its own beside the ranking (`firmware/greenhouse/controls.yaml:1400-1420`): a stressed member zone that has had no pulse for 10 minutes goes first, judged against the same per-zone targets. It is not engine code, so it would go with the mister state machine. The law keeps it in its pulse request, judged against the house band's high edge like the ranking. With one member line, as today, it never acts.

**Pulse length.** Today the stage-1 pulse is the plain pulse setting (33 s held on 2026-11-16, 30 s most often). Only in stage 2, entered after 90 s above `vpd_high + 0.25`, is it lengthened by the setting `mister_vpd_weight` when the zone's VPD is above 1.2 times its own target (`firmware/greenhouse/controls.yaml:1600-1612`); the escalation pulse at `:1513-1516` uses a different test, for south and west only. Decision 5 keeps the longer-pulse test and reads it against the house band's high edge. The law has one mister stage: a pulse is the plain pulse length, times 1.4 while the zone's VPD is above 1.2 times `vpd_high`. The pulse is 30 s and the gap 60 s; 1.4 is the median and the value held most of `mister_vpd_weight` over the 30 days (1.39). These are the values the controller held most (decision 13, appendix E, section 11.5). At an edge of 1.29 kPa the misters join at 1.59 kPa and leave below 1.34 kPa, and the longer pulse applies above 1.55 kPa. The simulator ran one cadence, 60 s on and 45 s off, with no longer pulse. Scheduled misting never reads these values.

**A second stage.** The fogger acts first at the VPD high edge and the misters join 0.30 kPa above it. In simulation the fogger alone holds the edge nearly all the time: removing the misters changes compliance by 0.00 / -0.13 point, and today's membership (the centre line only) gives 0.00 / 0.00 point against all three zones. They are kept because the owner asked for them and because they are the only humidifier left if the fogger fails.

Removed with this: the per-zone VPD target curves and widths for the misters (decision 5), and three functions that always return the same answer since the wet taper and the stress windows were retired, with the settings that still feed them (`past_wet_taper`, `stress_wet_override_permitted`, `direct_wet_stress_override_permitted`; `wet_taper_before_sunset_min`, `direct_wet_min_temp_f`).

### 4.9 Running alone (constraint 1)

The climate relays are local outputs and the law's inputs are local, so the remaining dependencies are the clock, values that only exist after a push, and the outdoor data. The table lists each condition, what the controller does today and what it does under the plan.

| Condition | Today | Under the plan |
|---|---|---|
| WiFi down | By configuration the controller restarts every 300 s (`wifi.reboot_timeout: 300s`, `firmware/greenhouse.yaml:178`). Each restart switches every relay off and holds each one off for its minimum off time (heaters 180 s, fans 90 s, vent and fogger 60 s), and 117 of the 128 settings return to their boot values. No WiFi outage of that length is in the record. | No restart (`0s`, as the API timeout on line 206 already is). This reverses the owner's ruling D-IRP-27 of the dashboard programme ("Keep 300 s"), so it is decision 22. The law keeps running and nothing returns to a boot value. A restart was also the only automatic recovery from a stuck WiFi stack, and that recovery is given up: with no battery clock (decision 8) a restart while the LAN is down leaves the band without a trusted clock until a time server answers, so no timeout is right. A stuck stack stays stuck until the controller is restarted by hand, with the house still controlled (an accepted consequence, section 12.2). |
| Ingestor or API down | Plan waypoints stop arriving; the last settings stay. | No effect on climate. |
| Reboot | Boot values differ from production values for part of the settings (issue #1642); each relay is held off for its minimum off time; the fan run times and the fan lead reset. | Constants are compiled; anchors come from flash; every relay is available at once; fan run seconds are restored. |
| Flash storage empty | The ROM band is used: a deliberately drier view of the committed band file, kept that way since the wet-night regression of 2026-06-15 and enforced in CI. | Unchanged. It is a recorded safety decision, and it only applies to a chip whose flash is empty. |
| No outdoor data | The cold-vent guard keeps using the last station reading with no age test (`firmware/lib/greenhouse_logic.h:1602-1611`); the dry-out stops. | The wired intake probe takes over. With neither source there is no drying with outdoor air; every other rule is unaffected. |
| Clock wrong but valid | Trusted. The controller ran up to 117 minutes fast for 87 days (issue #1638) and served a shifted band: time had never synchronised, and each watchdog or panic reset stepped the retained clock by 0.5 to 125 minutes. | A soft reset keeps the ESP32's clock and only a power cut loses it, so the band's clock is trusted only after an SNTP sync has completed since the last boot (the existing `sntp_valid` entity). Otherwise: "no clock" below. The host alerts when the controller's band differs from the band the host computes. |
| No clock | The solar phase is frozen at local noon of day 172, so the noon band is served all night; the fogger and climate misters are refused, even at the 100 F limit. | The widest corridor the anchors allow: the lowest and highest anchor values of each edge (60.7 to 83.8 F and 0.74 to 1.29 kPa today). The fogger and misters work. |
| Wall probes invalid | The case sensor is used, with no age test; it reads warmer than the wall probes (a median of 1.6 F over the 30 days to 2026-11-16), and humidity control stops. With no reading at all the controller restarts once and then substitutes 65 F and 50 % and controls on them (`controls.yaml:2346-2359`); it also substitutes 50 % for a missing case humidity and 65 F for a reading outside -20 to 150 F (`firmware/greenhouse/controls.yaml:241-247`, `266-269`). | The case sensor is used while it is fresh, less its offset from the wall probes (section 4.2), for the temperature rules only. With no reading at all the controller reports a sensor fault and enters the state of decision 7, in which the manual overrides of the fans, the vent and the fogger stay effective (section 11.5). No substituted values. |
| Sensor bus silent | Two restarts: when all five probes are silent, skipped while the clock is invalid, and after 3,600 s with no probe update (`controls.yaml:2340-2376`). | One restart rule, independent of the clock, at most once an hour. |
| Electric heater dead | The furnace covers by temperature; nothing alerts. | The same, with an alert (section 4.6). |
| Gas outage | The electric heater alone cannot hold the band in winter. | The same; no controller can change that (section 5.8). |

**Where the clock rule applies.** It applies to the climate band only. Irrigation and lighting each test the clock themselves (the engine needs a valid clock and no SNTP failure, lighting a valid clock), and they keep their tests and their inputs, including the solar times they read today. That leaves two tests of time on the controller, on purpose: irrigation and lighting are not to change. After a soft reset they keep running on the retained clock, as today; after a power cut with no time server answering they wait for one.

**No clock chip.** A battery clock chip on the controller would remove the dependency on the network for time. The owner ruled out hardware work on 2026-11-16, so his earlier ruling stands (NTP only, D-IRP-25 of the dashboard programme) and decision 8 is closed. A soft reset (watchdog, panic, heap guard, the sensor-bus rule, the restart service, an OTA) keeps the ESP32's clock; only a power cut loses it. The band trusts the clock only after a time server has answered since the last boot (the row "Clock wrong but valid" above). What is left is any boot after which neither time server has answered: a restart during a LAN outage, the minutes after a site power cut until one of them is back, or a time-server fault while the LAN is up, as in the 87 days of issue #1638. For as long as that lasts the band serves the corridor of the row "No clock", which is a safe band, and the host's band-difference alert reports it. After a power cut the controller has no time at all: irrigation starts no scheduled run and lighting switches both lights off (reason `time_invalid`). After a soft reset irrigation and lighting, which test only that the clock is valid, keep running on the retained clock, including any step the reset gave it. The one further limit of the power-cut state, in the engine's water count, is below.

**The intake probe.** Its temperature has been compared with the station's for two days only: it read a median 1.3 F warmer, with a range of -4.0 to +8.3 F, and its siting may warm it. A probe warmed by its housing reads a higher temperature and a lower relative humidity, and the dew point computed from the two is unchanged, so warmth biases the cost of section 4.5 and not the dew-point test of rule 7. Its dew point has not been compared with the station's at all. Phase 1 compares both for a season on the host, with no firmware change. This is what an outdoor dew point that reads wrong does to the law, and what having no outdoor data does:

| The law, condition held for the whole year | Both in band % | Nights dried % | Drying hours/day | Vent starts/day | Relay starts/day | kWh/day | Therms/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Outdoor data correct | 88.6 / 80.4 | 75 / 60 | 1.08 / 2.82 | 6.0 / 8.7 | 52 / 49 | 20.2 / 23.0 | 2.29 / 2.90 |
| Outdoor dew point read 2 F too high | 87.9 / 79.0 | 75 / 58 | 0.60 / 1.92 | 5.8 / 10.3 | 51 / 52 | 19.8 / 22.6 | 2.28 / 2.87 |
| Outdoor dew point read 2 F too low | 88.6 / 80.8 | 75 / 61 | 1.69 / 3.06 | 5.5 / 8.8 | 51 / 49 | 20.6 / 23.0 | 2.29 / 2.93 |
| Outdoor dew point read 4 F too low | 88.7 / 81.1 | 75 / 61 | 1.74 / 3.12 | 5.7 / 9.1 | 51 / 50 | 20.6 / 23.1 | 2.30 / 2.95 |
| No outdoor data: no drying with outdoor air | 83.3 / 64.0 | 66 / 31 | 0.00 / 0.00 | 3.3 / 1.2 | 46 / 33 | 19.3 / 21.3 | 2.26 / 2.70 |
| No outdoor data, with the effect check (studied, not adopted) | 83.3 / 64.0 | 66 / 31 | 0.00 / 0.00 | 3.3 / 1.2 | 46 / 33 | 19.3 / 21.3 | 2.26 / 2.70 |

- A dew point that reads too low makes outdoor air look drier than it is. At 2 F too low the test already passes whenever the house is too humid, which is why the 2 F and 4 F rows are nearly equal: drying then runs +0.62 / +0.24 hours a day more, for +0.4 / +0.1 kWh a day and compliance within half a point. The rest of rule 7 still bounds it: the house must be too humid and the cost must be within the limit.
- A dew point that reads 2 F too high costs 0.8 / 1.4 point of compliance and adds -0.2 / +1.6 vent starts a day.
- With no outdoor data at all the law gives up drying: 5.4 / 16.4 points of compliance and 9 / 29 dried nights in a hundred. That is the worst case, and it is still 12.8 / 4.4 points above today's firmware with everything working.

**No effect check.** An earlier draft let the controller test outdoor air when it had no outdoor data: open the vent for four minutes and continue only if the indoor dew point fell. Held for a year without outdoor data it recovered 0.0 / 0.0 points of compliance against not drying. It is not adopted. It needs relay feedback, a rule for probes dropping out during the test and a repeat during long runs, and its 0.5 F test was never checked against sensor noise; the case it serves needs both the station and the intake probe to be gone. It remains in the simulator as a study option.

Each condition held for a whole year, which is far longer than any real outage, to show the direction and size:

| Condition held for the whole year | Both in band % today | Both in band % law | Therms/day today | Therms/day law | Gallons/day today | Gallons/day law | Coldest F today | Coldest F law | Hottest F today | Hottest F law |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Everything available | 70.5 / 59.6 | 88.6 / 80.4 | 2.18 / 2.70 | 2.29 / 2.90 | 63 / 56 | 67 / 65 | 58.9 / 58.8 | 59.3 / 59.2 | 90.9 / 91.8 | 85.7 / 86.9 |
| No outdoor data | 62.8 / 51.8 | 83.3 / 64.0 | 2.13 / 2.59 | 2.26 / 2.70 | 65 / 57 | 67 / 65 | 58.9 / 58.8 | 59.4 / 59.3 | 90.9 / 91.8 | 85.7 / 87.0 |
| Clock 117 minutes fast | 47.5 / 46.2 | 68.9 / 65.2 | 2.63 / 3.11 | 2.76 / 3.33 | 79 / 70 | 83 / 89 | 58.9 / 58.8 | 59.3 / 59.3 | 91.0 / 91.8 | 85.9 / 87.1 |
| Clock 60 minutes fast | not run | 77.4 / 72.2 | not run | 2.45 / 3.07 | not run | 73 / 75 | not run | 59.4 / 59.3 | not run | 85.8 / 87.1 |
| Clock 60 minutes slow | not run | 79.8 / 70.5 | not run | 2.30 / 2.88 | not run | 68 / 63 | not run | 59.3 / 59.3 | not run | 85.7 / 86.9 |
| Clock 3 hours slow | 50.9 / 43.5 | 70.7 / 59.7 | 2.81 / 3.10 | 2.79 / 3.21 | 87 / 68 | 85 / 80 | 58.8 / 58.8 | 59.3 / 59.2 | 90.9 / 91.8 | 85.8 / 86.5 |
| Clock 6 hours slow | not run | 47.9 / 40.1 | not run | 4.04 / 4.24 | not run | 134 / 128 | not run | 59.5 / 59.4 | not run | 85.7 / 86.5 |
| No clock at all | 10.3 / 31.2 | 52.9 / 44.7 | 4.28 / 5.01 | 1.59 / 2.29 | 0 / 0 | 35 / 47 | 66.7 / 63.9 | 60.7 / 60.6 | 102.8 / 98.3 | 84.7 / 86.8 |
| No clock and no outdoor data | 10.3 / 31.1 | 48.0 / 32.6 | 4.28 / 5.01 | 1.51 / 1.90 | 0 / 0 | 35 / 48 | 66.7 / 63.9 | 60.7 / 60.7 | 102.8 / 98.3 | 84.7 / 86.8 |

With no clock, today's firmware heats to the noon band all night (4.28 / 5.01 therms a day against 2.18 / 2.70), cannot fog, and reaches 103 / 98 F. The law on the corridor stays between 61 and 87 F.

One limit of the power-cut state is in the irrigation engine and not in the law. The engine's daily water count starts a new day by the clock, so with no clock it keeps counting. When the count reaches the soft water budget (300 gallons, decision 11, which is also its boot value) the fogger and misters are held except in a VPD emergency, and at the daily safety cap (360 gallons) everything but protection fog is held. At the summer rate of the no-clock state (64 / 106 gallons a day) the budget is reached after about three to five days and the cap after three to six. With no clock the engine also starts no scheduled drip or mist, as today. Today's firmware refuses fog from the first minute without a clock, so this is still better than today. A day rollover that does not need the clock was proposed. It is not built and the engine is not edited (section 11.5), so the limit stands, as an accepted consequence of having no battery clock (decision 8).

Lighting is the one subsystem that cannot run alone: the lights are switched through Home Assistant. That is unchanged and outside this plan (section 8.8).

### 4.10 What the law replaces (constraint 2)

Each item below is a special case in today's climate path that the law makes unnecessary. File references are to the code as reviewed.

| Today | Under the law |
|---|---|
| Eight exclusive modes, eleven actions, four mist stages, a ranked table of candidate actions (`firmware/lib/greenhouse_logic.h:781-1250`, `1556-2835`) | No modes. Nine on/off latches, one per rule and condition. |
| Night dry-out machine: night only, pulse and rest timers, a nightly kWh budget, a 0.74 kPa floor compiled into the firmware, a forced cut of the electric heater for 180 s per pulse | Rule 7 at every hour. The floor is a property of the band (section 4.1). |
| Heat-assisted dehumidifying at night only; "can hold" at night only; separate night and day dew-point margins | Rule 7. The wetting gate that irrigation keeps gets one compiled margin and no night test (section 8.7). |
| Economiser on enthalpy, a moisture-exchange estimator, summer-vent comparators, the cold-vent guard: four different answers to "is outdoor air better" | One: the dew-point margin and the cost of rule 7. |
| Fog refused below 55 F and above 90 % RH; three wetting gates that always return the same answer since their windows were retired | Rules 5 and 6, with one guard written relative to the band in place of the 55 F test: no fog or mist below the low temperature edge (decision 20). The humidity test goes: the band's VPD edges already say when the air is too dry. The fogger's dew-margin veto goes too (`firmware/lib/greenhouse_logic.h:545`): today the dew-point margin for wetting also refuses fog; above the VPD high edge it binds only near 95 F. |
| No climate mister pulse at the 100 F limit, and none from about 95 F | The misters follow rule 6 at every temperature, a declared change (rule 8); the irrigation engine's gates still decide each pulse |
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
- The simulation has no sensor noise, and relay starts are where that shows. One check against the record: the electric heater's measured starts were 16.7 a day in October 2026 and 27.6 in November; the simulation of today's firmware gives 28.3 / 35.6 and 11.4 / 18.5. It is above the measurement in one month and below it in the other, so simulated starts are indicative and not exact. Most of the law's on and off lines are at least 1 F or 0.15 kPa apart and its minimum times are 120 to 300 s, which makes it less sensitive to noise than a single threshold. The narrowest pair is the start and stop of a drying run, 0.75 F apart (section 4.5). Section 13 measures both on the controller.

### 5.2 Headline, by season

Year:

| Controller | Both in band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware and settings | 70.5 / 59.6 | 57 / 38 | 135 / 142 | 24.5 / 28.2 | 19.6 / 21.0 | 2.18 / 2.70 | 63 / 56 |
| Review step 1 (five settings, no code) | 78.3 / 69.7 | 70 / 53 | 104 / 100 | 23.7 / 29.1 | 19.4 / 21.4 | 2.16 / 2.72 | 45 / 54 |
| Review step 2 (patched firmware) | 85.6 / 82.6 | 80 / 71 | 111 / 110 | 24.9 / 30.8 | 19.6 / 21.7 | 2.43 / 3.05 | 49 / 61 |
| Review step 4 (the review's two-axis controller) | 83.3 / 80.4 | 73 / 64 | 144 / 160 | 24.3 / 29.7 | 19.5 / 21.4 | 2.50 / 3.13 | 53 / 60 |
| **The law** (drying cost limit 0.7 kWh/kg, the default) | 88.6 / 80.4 | 75 / 60 | 52 / 49 | 24.0 / 31.5 | 20.2 / 23.0 | 2.29 / 2.90 | 67 / 65 |
| The law, never drying with outdoor air | 83.3 / 64.0 | 66 / 31 | 46 / 33 | 21.4 / 24.8 | 19.3 / 21.3 | 2.26 / 2.70 | 67 / 65 |

Winter (October to April):

| Controller | Both in band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware and settings | 79.2 / 63.5 | 59 / 26 | 89 / 84 | 25.6 / 28.1 | 28.0 / 29.2 | 3.51 / 4.25 | 26 / 4 |
| Review step 1 (five settings, no code) | 84.5 / 74.8 | 76 / 45 | 81 / 67 | 25.2 / 29.1 | 27.3 / 29.0 | 3.44 / 4.26 | 30 / 4 |
| Review step 2 (patched firmware) | 90.3 / 89.4 | 89 / 73 | 89 / 86 | 25.9 / 31.3 | 27.1 / 29.1 | 3.76 / 4.73 | 36 / 6 |
| Review step 4 (the review's two-axis controller) | 88.7 / 87.1 | 81 / 63 | 90 / 78 | 27.9 / 33.0 | 28.0 / 29.9 | 3.94 / 4.90 | 29 / 5 |
| **The law** (drying cost limit 0.7 kWh/kg, the default) | 93.7 / 85.7 | 81 / 59 | 40 / 43 | 27.6 / 32.2 | 29.1 / 30.7 | 3.72 / 4.54 | 57 / 11 |
| The law, never drying with outdoor air | 91.2 / 70.2 | 75 / 26 | 37 / 27 | 25.6 / 26.3 | 28.4 / 29.2 | 3.68 / 4.23 | 58 / 11 |

Summer (May to September):

| Controller | Both in band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware and settings | 59.3 / 54.6 | 55 / 54 | 194 / 218 | 22.9 / 28.2 | 8.7 / 10.4 | 0.45 / 0.69 | 111 / 123 |
| Review step 1 (five settings, no code) | 70.3 / 63.0 | 62 / 64 | 133 / 143 | 21.7 / 29.2 | 9.2 / 11.5 | 0.51 / 0.72 | 65 / 119 |
| Review step 2 (patched firmware) | 79.4 / 73.8 | 68 / 68 | 139 / 143 | 23.7 / 30.2 | 9.9 / 12.1 | 0.71 / 0.87 | 66 / 133 |
| Review step 4 (the review's two-axis controller) | 76.3 / 71.8 | 63 / 65 | 215 / 267 | 19.7 / 25.4 | 8.5 / 10.3 | 0.65 / 0.83 | 83 / 132 |
| **The law** (drying cost limit 0.7 kWh/kg, the default) | 82.1 / 73.5 | 68 / 62 | 67 / 56 | 19.5 / 30.5 | 8.7 / 13.0 | 0.43 / 0.78 | 79 / 134 |
| The law, never drying with outdoor air | 73.0 / 56.1 | 55 / 38 | 57 / 40 | 16.0 / 22.8 | 7.4 / 11.1 | 0.42 / 0.71 | 79 / 136 |

The law minus each alternative, over the year:

| Difference | Both in band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| The law minus today's firmware | +18.1 / +20.8 | +18.2 / +22.3 | -83.3 / -93.5 | -0.4 / +3.3 | +0.6 / +2.0 | +0.11 / +0.20 | +4.4 / +8.9 |
| The law minus review step 2 | +3.1 / -2.2 | -4.6 / -10.4 | -59.1 / -61.5 | -0.9 / +0.6 | +0.6 / +1.3 | -0.14 / -0.15 | +18.1 / +3.5 |

- The law holds the band 18.1 / 20.8 points more of the year than today's firmware, with 62 / 66 % fewer relay starts, and dries 18 / 22 more nights in a hundred.
- Against the review's step 2 patch the law is ahead in model A and behind in model B (+3.1 / -2.2 points), with less than half the starts. The difference is drying without a price. The patch dries at any outdoor temperature, so it dries 80 / 71 % of nights against 75 / 60 % and uses 0.14 / 0.15 therm a day more gas. Model B is the wetter house, so it is where that heat buys the most. With no limit the law holds 89.3 / 82.5 % of the year for 2.34 / 3.06 therm a day, against the patch's 85.6 / 82.6 % for 2.43 / 3.05 (section 4.5).
- The last row of each table is the law with drying with outdoor air switched off. The difference from the row above it is what the drying rule buys and costs at the default limit: 5.4 / 16.4 points of compliance and 9 / 29 dried nights in a hundred for +0.03 / +0.20 therm, +0.9 / +1.6 kWh and +6 / +16 relay starts a day. The limit is the owner's number (section 4.5); the law is the same at any value.
- The review's own two-axis controller (its step 4) is superseded. The law makes 64 / 69 % fewer starts and holds the band +5.3 / 0.0 points against it, with gas at -0.22 / -0.23 therm a day.

### 5.3 Where the band is still lost

Share of the year outside each edge:

| Controller | Too cold % | Too hot % | Too humid % | Too dry % |
|---|---:|---:|---:|---:|
| Today's firmware and settings | 1.9 / 2.6 | 3.7 / 5.1 | 17.1 / 28.4 | 10.4 / 9.1 |
| Review step 1 (five settings, no code) | 2.0 / 2.9 | 2.1 / 4.4 | 11.9 / 19.4 | 6.8 / 7.2 |
| Review step 2 (patched firmware) | 0.5 / 0.6 | 2.1 / 3.0 | 6.0 / 9.1 | 6.8 / 6.0 |
| Review step 4 (the review's two-axis controller) | 0.5 / 0.5 | 2.9 / 4.1 | 7.5 / 10.8 | 7.2 / 6.2 |
| **The law** (drying cost limit 0.7 kWh/kg, the default) | 0.6 / 0.7 | 2.5 / 3.5 | 7.1 / 12.8 | 2.0 / 3.7 |
| The law, never drying with outdoor air | 0.6 / 0.7 | 2.6 / 3.7 | 12.4 / 29.0 | 2.0 / 3.7 |

Winter:

| Controller | Too cold % | Too hot % | Too humid % | Too dry % |
|---|---:|---:|---:|---:|
| Today's firmware and settings | 3.0 / 4.1 | 0.1 / 0.1 | 12.6 / 32.6 | 6.0 / 1.0 |
| Review step 1 (five settings, no code) | 3.0 / 4.7 | 0.0 / 0.1 | 6.2 / 21.0 | 7.0 / 1.0 |
| Review step 2 (patched firmware) | 0.7 / 0.7 | 0.0 / 0.0 | 2.7 / 9.1 | 6.8 / 1.0 |
| Review step 4 (the review's two-axis controller) | 0.7 / 0.6 | 0.0 / 0.1 | 4.7 / 11.3 | 6.0 / 1.0 |
| **The law** (drying cost limit 0.7 kWh/kg, the default) | 0.9 / 0.8 | 0.0 / 0.1 | 4.9 / 13.4 | 1.1 / 0.2 |
| The law, never drying with outdoor air | 0.9 / 0.8 | 0.0 / 0.1 | 7.4 / 28.9 | 1.0 / 0.2 |

Summer:

| Controller | Too cold % | Too hot % | Too humid % | Too dry % |
|---|---:|---:|---:|---:|
| Today's firmware and settings | 0.4 / 0.6 | 8.5 / 11.7 | 22.9 / 22.9 | 16.1 / 19.7 |
| Review step 1 (five settings, no code) | 0.6 / 0.6 | 4.9 / 9.9 | 19.2 / 17.4 | 6.6 / 15.2 |
| Review step 2 (patched firmware) | 0.2 / 0.5 | 4.8 / 6.8 | 10.2 / 9.1 | 6.8 / 12.4 |
| Review step 4 (the review's two-axis controller) | 0.2 / 0.5 | 6.7 / 9.4 | 11.0 / 10.2 | 8.8 / 13.0 |
| **The law** (drying cost limit 0.7 kWh/kg, the default) | 0.2 / 0.5 | 5.8 / 7.9 | 9.9 / 12.1 | 3.3 / 8.3 |
| The law, never drying with outdoor air | 0.2 / 0.5 | 5.8 / 8.4 | 19.0 / 29.1 | 3.3 / 8.3 |

What remains under the law is mostly "too humid", 7.1 / 12.8 % of the year: the hours when outdoor air is not drier than the house, when drying would cost more than the owner's limit, or when the house is too close to its low edge to give up heat. The limit is the lever: with no limit it is 6.4 / 10.7 %, and with drying switched off 12.4 / 29.0 %. "Too hot" is summer afternoons with the vent open and both fans running; the law's hottest minute of the year is 85.7 / 86.9 F against 90.9 / 91.8 F for today's firmware. "Too dry" falls from 10.4 / 9.1 % to 2.0 / 3.7 %, because the fogger now holds the VPD high edge.

### 5.4 Cycles and run hours, per relay (constraint 3)

Year:

| Relay | Starts/day today | Starts/day law | Hours/day today | Hours/day law |
|---|---:|---:|---:|---:|
| Electric heater | 11.0 / 16.8 | 0.8 / 0.8 | 12.86 / 13.86 | 12.83 / 14.66 |
| Gas furnace | 9.8 / 12.5 | 9.2 / 13.2 | 2.91 / 3.60 | 3.05 / 3.87 |
| Vent | 16.3 / 17.4 | 6.0 / 8.7 | 3.03 / 3.90 | 3.02 / 5.39 |
| Fans (both) | 19.3 / 18.6 | 6.1 / 8.8 | 4.32 / 5.66 | 3.23 / 5.74 |
| Fogger | 49.9 / 38.0 | 29.4 / 13.7 | 0.86 / 0.63 | 1.92 / 1.75 |
| Misters (all zones) | 28.4 / 38.9 | 0.0 / 3.7 | 0.49 / 0.51 | 0.00 / 0.06 |
| **All relays** | 134.8 / 142.4 | 51.5 / 48.9 | 24.5 / 28.2 | 24.0 / 31.5 |

Winter:

| Relay | Starts/day today | Starts/day law | Hours/day today | Hours/day law |
|---|---:|---:|---:|---:|
| Electric heater | 9.7 / 18.7 | 0.8 / 0.7 | 19.10 / 20.19 | 19.35 / 21.01 |
| Gas furnace | 16.3 / 21.3 | 15.3 / 22.3 | 4.68 / 5.67 | 4.95 / 6.06 |
| Vent | 8.3 / 16.9 | 1.4 / 7.3 | 0.58 / 1.11 | 0.82 / 2.41 |
| Fans (both) | 8.3 / 16.9 | 1.4 / 7.3 | 0.57 / 1.08 | 0.82 / 2.39 |
| Fogger | 43.5 / 8.5 | 20.8 / 5.7 | 0.69 / 0.08 | 1.65 / 0.32 |
| Misters (all zones) | 3.2 / 1.8 | 0.0 / 0.0 | 0.03 / 0.01 | 0.00 / 0.00 |
| **All relays** | 89.4 / 84.2 | 39.8 / 43.3 | 25.6 / 28.1 | 27.6 / 32.2 |

Summer:

| Relay | Starts/day today | Starts/day law | Hours/day today | Hours/day law |
|---|---:|---:|---:|---:|
| Electric heater | 12.6 / 14.4 | 0.9 / 1.0 | 4.76 / 5.65 | 4.37 / 6.41 |
| Gas furnace | 1.4 / 1.2 | 1.2 / 1.4 | 0.60 / 0.92 | 0.58 / 1.04 |
| Vent | 26.7 / 18.1 | 12.0 / 10.5 | 6.21 / 7.54 | 5.87 / 9.26 |
| Fans (both) | 33.6 / 20.9 | 12.1 / 10.7 | 9.20 / 11.61 | 6.36 / 10.07 |
| Fogger | 58.2 / 76.3 | 40.5 / 24.1 | 1.08 / 1.33 | 2.28 / 3.59 |
| Misters (all zones) | 61.2 / 87.1 | 0.0 / 8.6 | 1.09 / 1.14 | 0.00 / 0.14 |
| **All relays** | 193.7 / 218.1 | 66.8 / 56.3 | 22.9 / 28.2 | 19.5 / 30.5 |

- Starts fall for every relay but the furnace. The electric heater goes from 11.0 / 16.8 to 0.8 / 0.8 a day, because it stays on through the furnace's cycles.
- The furnace's starts barely change: from 9.8 / 12.5 to 9.2 / 13.2 a day, down in model A and up in model B. On band 2 they are up in both models against today's firmware on that band (+1.1 / +2.7 a day). It is large for the house (75,000 BTU/h input), so a burn is short whatever decides it. With about the same number of burns the law holds the low edge: too cold 0.6 / 0.7 % of the year against 1.9 / 2.6 %. The width of the furnace's swing is the only lever on furnace starts within the law (decision 2).
- The fogger starts 41 / 64 % less often and runs 1.9 / 1.7 hours a day against 0.9 / 0.6: it holds the VPD high edge, and it does the work the misters do today. The misters go from 28 / 39 starts a day to 0.0 / 3.7.
- Run hours at the same band do not fall (-0.4 / +3.3 hours a day). The electric heater is about half of them, 12.8 / 14.7 hours a day against 12.9 / 13.9 today; that is constraint 5 at work in both. Fan hours for cooling fall and fogger hours rise, and drying adds vent and fan time, 1.1 / 2.8 hours a day, which is where model B's rise comes from. Run hours fall when the band is edited (section 5.7) or the drying cost limit is lowered (section 4.5).

### 5.5 Utilities (constraint 4)

Where the law's electricity and water go:

| The law | Electric heater kWh/day | Fans kWh/day | Fogger kWh/day | Vent kWh/day | Fog gallons/day | Mister gallons/day |
|---|---:|---:|---:|---:|---:|---:|
| Year | 18.4 / 21.0 | 0.36 / 0.65 | 1.37 / 1.24 | 0.03 / 0.05 | 67 / 61 | 0.0 / 3.9 |
| Winter (October to April) | 27.8 / 30.2 | 0.09 / 0.27 | 1.17 / 0.23 | 0.01 / 0.02 | 57 / 11 | 0.0 / 0.0 |
| Summer (May to September) | 6.3 / 9.2 | 0.72 / 1.14 | 1.62 / 2.55 | 0.06 / 0.09 | 79 / 125 | 0.0 / 9.0 |

About 91 / 92 % of the electricity is the electric heater. Nearly all the water is fog; the misters use 0 / 4 gallons a day.

At the same band the law uses more of each utility than today's firmware: +0.6 / +2.0 kWh, +0.11 / +0.20 therm and +4 / +9 gallons a day. Each has a cause that is the band being held:

- **Electricity:** drying spends electric heat, +0.9 / +1.6 kWh a day against never drying, and today's firmware dries fewer nights.
- **Gas:** the furnace starts 0.5 F above the low edge instead of at it, so the house spends less time below the band. Of the difference, +0.03 / +0.20 therm a day is heat that drying spent and the furnace replaced (section 4.5).
- **Water:** the fogger holds the VPD high edge on dry days, including sunny winter days in model A (57 / 11 gallons a day in winter against 26 / 4). The owner's note of 2026-11-05 accepted dry winter air for now; the law does not, and section 5.7 prices the edge that decides it (decision 9).

The same comparison on three edited bands (section 5.7 defines them):

| Year, the law minus today's firmware on the same band | Both in own band, points | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|
| Today's band | +18.1 / +20.8 | -83 / -93 | -0.4 / +3.3 | +0.6 / +2.0 | +0.11 / +0.20 | +4 / +9 |
| Band 1 | +16.6 / +22.2 | -73 / -94 | -0.5 / +3.9 | -0.2 / +1.6 | +0.03 / +0.22 | -1 / +3 |
| Band 2 | +13.3 / +18.9 | -55 / -67 | 0.0 / +4.3 | -0.2 / +1.3 | +0.05 / +0.25 | +2 / +1 |
| Band 3 | +13.7 / +21.8 | -53 / -64 | +0.1 / +5.3 | -0.4 / +1.3 | +0.07 / +0.32 | +1 / +1 |

On every band the law holds its band 13 to 22 points more of the year with 53 to 94 fewer relay starts a day, and its utility use differs from today's firmware on the same band by 0.2 to 2.0 kWh, 0.03 to 0.32 therm and 1 to 9 gallons a day.

A controller cannot lower utility use at a fixed band by much: holding a temperature takes the heat the house loses at that temperature. What the controller can do is stop wasting, and the law does: no heater cut during drying, no drying above the owner's price, no pulsing, no pre-staging. The larger lever is the band itself, which section 5.7 prices.

### 5.6 Sensitivity of each constant

Each row changes one rule and shows the difference from the law over the year.

| Change to one rule (year, difference from the law) | Both in band | Nights dried | Starts/day | Furnace starts/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Furnace off at low+2.5 and electric heater 3.0/4.0 (narrower furnace swing) | -0.3 / -0.4 | -1 / -1 | +1.1 / +3.5 | +2.1 / +2.9 | -0.71 / -0.56 | -0.05 / -0.04 | -3.9 / -2.3 |
| Furnace off at low+3.5 and electric heater 4.0/5.0 (wider furnace swing) | +0.1 / +0.5 | +1 / +2 | -0.4 / -1.8 | -1.6 / -2.1 | +0.72 / +0.57 | +0.06 / +0.05 | +4.8 / +2.8 |
| Electric heater 4.0/5.0, furnace unchanged | +0.2 / +0.2 | +1 / +1 | +0.3 / -0.1 | -0.2 / -0.1 | +0.74 / +0.58 | -0.03 / -0.02 | +1.2 / +0.4 |
| Electric heater 3.0/4.0, furnace unchanged | -0.2 / -0.1 | -1 / -1 | -0.1 / +0.5 | +0.1 / +0.2 | -0.74 / -0.66 | +0.03 / +0.03 | -0.7 / -0.4 |
| Electric heater 2.5/3.5, furnace unchanged | -0.3 / -0.3 | -1 / -1 | -0.2 / +0.8 | +0.4 / +0.3 | -1.55 / -1.48 | +0.08 / +0.06 | -1.8 / -0.8 |
| Furnace on at low+0.25 | -0.5 / -2.0 | -1 / -4 | -1.2 / -2.6 | -0.9 / -1.5 | +0.04 / +0.02 | -0.05 / -0.08 | -0.4 / +0.1 |
| Whole heating stack 1 F lower: electric heater 2.5/3.5, furnace off at low+2.0 | -0.5 / -0.8 | -1 / -1 | +3.5 / +8.6 | +5.2 / +6.9 | -1.36 / -1.16 | -0.10 / -0.08 | -8.0 / -3.9 |
| Electric heater on at low+1.5, off at low+3.5 (a 2 F swing) | -0.6 / -0.5 | -1 / -1 | -0.4 / +1.2 | +0.6 / +0.5 | -2.20 / -2.18 | +0.12 / +0.10 | -2.4 / -1.0 |
| Heaters minimum on/off 180 s | 0.0 / 0.0 | 0 / 0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.00 / 0.00 | 0.00 / 0.00 | 0.0 / 0.0 |
| Electric heater 1.0/2.0 (not ahead of the furnace) | -1.4 / -0.6 | -3 / 0 | +12.6 / +19.8 | +3.0 / +2.6 | -11.24 / -12.13 | +0.85 / +0.87 | -6.1 / -2.8 |
| Fog exit margin 0.10 kPa | -0.2 / -0.3 | 0 / 0 | +4.1 / +2.6 | +0.1 / +0.1 | -0.12 / -0.03 | -0.01 / 0.00 | -4.6 / -1.9 |
| Fog exit margin 0.20 kPa | +0.1 / +0.1 | 0 / 0 | -3.0 / -2.2 | -0.2 / 0.0 | +0.16 / +0.04 | +0.02 / 0.00 | +5.3 / +2.0 |
| Fog minimum on/off 60 s | 0.0 / 0.0 | 0 / 0 | +2.7 / +1.5 | 0.0 / 0.0 | -0.02 / -0.01 | 0.00 / 0.00 | -0.8 / -0.4 |
| Fog minimum on/off 180 s | -0.4 / -0.1 | 0 / 0 | +16.4 / -1.8 | 0.0 / 0.0 | +0.97 / +0.03 | +0.01 / 0.00 | +9.0 / +0.8 |
| Fans and vent minimum on/off 180 s | 0.0 / 0.0 | 0 / 0 | +0.2 / +0.8 | 0.0 / 0.0 | +0.01 / -0.03 | 0.00 / 0.00 | -0.1 / -0.1 |
| Fans and vent minimum on/off 120 s | 0.0 / +0.1 | 0 / +1 | +0.2 / +1.4 | 0.0 / 0.0 | 0.00 / -0.03 | 0.00 / 0.00 | 0.0 / -0.1 |
| Cooling exit 1.5 F inside | -0.1 / +0.1 | 0 / 0 | +1.2 / +0.9 | 0.0 / 0.0 | -0.05 / -0.08 | 0.00 / 0.00 | -1.2 / -1.9 |
| Cooling exit 3.0 F inside | +0.2 / -0.1 | 0 / 0 | -0.8 / -0.8 | 0.0 / 0.0 | +0.13 / +0.17 | 0.00 / 0.00 | +2.4 / +4.2 |
| Second fan at high+0.5 | +0.1 / +0.1 | 0 / 0 | +0.1 / +0.1 | 0.0 / 0.0 | +0.02 / +0.04 | 0.00 / 0.00 | +0.1 / +0.5 |
| Second fan at high+3.0 | 0.0 / 0.0 | 0 / 0 | -0.1 / -0.5 | 0.0 / 0.0 | -0.01 / -0.02 | 0.00 / 0.00 | -0.1 / -0.7 |
| Add fog as a cooling stage above high+1.5 | 0.0 / 0.0 | 0 / 0 | 0.0 / -0.5 | 0.0 / 0.0 | +0.01 / +0.03 | 0.00 / 0.00 | +0.5 / +1.4 |
| Add fog as a cooling stage above high+0.5 | +0.1 / +0.1 | 0 / 0 | +0.1 / -0.3 | 0.0 / 0.0 | +0.02 / +0.04 | 0.00 / 0.00 | +0.9 / +2.4 |
| Misters join at vpd_high+0.20 | -0.3 / +0.1 | 0 / 0 | +0.2 / +1.9 | +0.1 / 0.0 | +0.12 / -0.03 | +0.02 / 0.00 | -1.8 / +1.0 |
| Misters join at vpd_high+0.40, leave at +0.15 | 0.0 / -0.1 | 0 / 0 | +0.2 / -2.0 | 0.0 / 0.0 | +0.02 / +0.04 | 0.00 / 0.00 | +0.6 / -1.0 |
| No misters | 0.0 / -0.1 | 0 / 0 | +0.1 / -3.1 | 0.0 / 0.0 | +0.02 / +0.06 | 0.00 / 0.00 | +0.6 / -1.9 |
| Centre mister only (today's membership) | 0.0 / 0.0 | 0 / 0 | 0.0 / -0.1 | 0.0 / 0.0 | 0.00 / 0.00 | 0.00 / 0.00 | 0.0 / +0.1 |
| Fog and mist allowed below the low temperature edge (the guard removed) | 0.0 / 0.0 | 0 / 0 | -0.7 / -0.3 | -0.1 / 0.0 | +0.03 / 0.00 | 0.00 / 0.00 | +1.0 / +0.1 |
| Drying exit 0.15 kPa above the low edge | 0.0 / -0.3 | 0 / -2 | +0.3 / +2.2 | 0.0 / -0.2 | -0.09 / -0.12 | -0.01 / -0.03 | +0.2 / 0.0 |
| Drying starts 0.10 kPa above the low edge | 0.0 / +0.6 | -1 / 0 | +5.6 / +8.1 | +0.1 / +0.3 | +0.36 / +0.17 | +0.02 / +0.05 | +1.9 / +0.2 |
| Drying starts at the low edge | -0.3 / -0.8 | 0 / -1 | -1.7 / -4.6 | 0.0 / -0.2 | -0.14 / -0.16 | -0.01 / -0.03 | -0.1 / -0.1 |
| Second fan while drying, when VPD is more than 0.05 kPa below the low edge | 0.0 / 0.0 | 0 / +1 | +0.9 / +2.6 | 0.0 / 0.0 | -0.02 / +0.03 | 0.00 / +0.01 | -0.1 / -0.1 |
| Outdoor dew-point margin 2 F, no start/stop gap | +0.1 / -0.2 | 0 / 0 | +3.1 / +5.7 | 0.0 / 0.0 | -0.18 / -0.12 | 0.00 / 0.00 | -0.1 / +0.1 |
| Outdoor dew-point margin 4 F start, 1 F stop | -0.1 / 0.0 | 0 / 0 | -0.4 / -0.1 | 0.0 / 0.0 | -0.02 / -0.03 | 0.00 / 0.00 | 0.0 / 0.0 |

By season:

| Change to one rule (difference from the law) | Both in band, winter | Both in band, summer | Starts/day, winter | Starts/day, summer |
|---|---:|---:|---:|---:|
| Furnace off at low+2.5 and electric heater 3.0/4.0 (narrower furnace swing) | -0.3 / -0.2 | -0.4 / -0.6 | +2.2 / +5.8 | -0.4 / +0.6 |
| Furnace off at low+3.5 and electric heater 4.0/5.0 (wider furnace swing) | 0.0 / +0.4 | +0.3 / +0.5 | -1.0 / -2.9 | +0.4 / -0.2 |
| Electric heater 4.0/5.0, furnace unchanged | +0.1 / +0.1 | +0.3 / +0.3 | +0.1 / -0.2 | +0.4 / 0.0 |
| Electric heater 3.0/4.0, furnace unchanged | -0.2 / +0.2 | -0.3 / -0.4 | +0.1 / +0.9 | -0.5 / +0.1 |
| Electric heater 2.5/3.5, furnace unchanged | -0.2 / +0.1 | -0.4 / -0.7 | +0.4 / +1.5 | -0.9 / 0.0 |
| Furnace on at low+0.25 | -0.6 / -3.1 | -0.3 / -0.6 | -1.9 / -4.2 | -0.3 / -0.5 |
| Whole heating stack 1 F lower: electric heater 2.5/3.5, furnace off at low+2.0 | -0.4 / -0.5 | -0.6 / -1.3 | +6.2 / +14.4 | 0.0 / +1.1 |
| Electric heater on at low+1.5, off at low+3.5 (a 2 F swing) | -0.4 / +0.1 | -0.8 / -1.4 | +0.3 / +2.1 | -1.3 / +0.1 |
| Heaters minimum on/off 180 s | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| Electric heater 1.0/2.0 (not ahead of the furnace) | -1.4 / +0.6 | -1.4 / -2.2 | +22.7 / +34.2 | -0.6 / +1.1 |
| Fog exit margin 0.10 kPa | 0.0 / +0.1 | -0.6 / -0.7 | +4.1 / +1.0 | +4.1 / +4.6 |
| Fog exit margin 0.20 kPa | -0.1 / -0.1 | +0.4 / +0.4 | -2.3 / -0.2 | -4.0 / -4.7 |
| Fog minimum on/off 60 s | 0.0 / 0.0 | 0.0 / 0.0 | +2.3 / +1.2 | +3.4 / +1.9 |
| Fog minimum on/off 180 s | 0.0 / 0.0 | -0.8 / -0.2 | -0.7 / -0.3 | +38.5 / -3.8 |
| Fans and vent minimum on/off 180 s | 0.0 / 0.0 | 0.0 / 0.0 | -0.1 / +0.2 | +0.4 / +1.5 |
| Fans and vent minimum on/off 120 s | 0.0 / +0.1 | 0.0 / 0.0 | 0.0 / +0.5 | +0.5 / +2.5 |
| Cooling exit 1.5 F inside | 0.0 / 0.0 | -0.3 / +0.2 | +0.1 / 0.0 | +2.6 / +1.9 |
| Cooling exit 3.0 F inside | 0.0 / 0.0 | +0.4 / -0.1 | -0.1 / 0.0 | -1.7 / -1.7 |
| Second fan at high+0.5 | 0.0 / 0.0 | +0.1 / +0.2 | 0.0 / 0.0 | +0.3 / +0.3 |
| Second fan at high+3.0 | 0.0 / 0.0 | 0.0 / -0.1 | 0.0 / +0.1 | -0.2 / -1.3 |
| Add fog as a cooling stage above high+1.5 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / -1.2 |
| Add fog as a cooling stage above high+0.5 | 0.0 / 0.0 | +0.3 / +0.2 | 0.0 / +0.1 | +0.3 / -0.7 |
| Misters join at vpd_high+0.20 | 0.0 / 0.0 | -0.7 / +0.2 | -0.1 / 0.0 | +0.6 / +4.4 |
| Misters join at vpd_high+0.40, leave at +0.15 | 0.0 / 0.0 | 0.0 / -0.2 | +0.3 / 0.0 | 0.0 / -4.6 |
| No misters | 0.0 / 0.0 | 0.0 / -0.3 | +0.3 / 0.0 | 0.0 / -7.3 |
| Centre mister only (today's membership) | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / -0.3 |
| Fog and mist allowed below the low temperature edge (the guard removed) | 0.0 / 0.0 | 0.0 / 0.0 | -1.2 / -0.6 | 0.0 / 0.0 |
| Drying exit 0.15 kPa above the low edge | 0.0 / -0.5 | +0.1 / -0.1 | 0.0 / +0.3 | +0.7 / +4.7 |
| Drying starts 0.10 kPa above the low edge | +0.2 / +1.0 | -0.2 / +0.1 | +1.9 / +6.8 | +10.6 / +9.8 |
| Drying starts at the low edge | -0.4 / -1.4 | 0.0 / 0.0 | -1.3 / -3.9 | -2.2 / -5.4 |
| Second fan while drying, when VPD is more than 0.05 kPa below the low edge | 0.0 / 0.0 | 0.0 / 0.0 | +0.1 / +2.0 | +1.9 / +3.3 |
| Outdoor dew-point margin 2 F, no start/stop gap | 0.0 / 0.0 | +0.3 / -0.4 | 0.0 / 0.0 | +7.1 / +13.2 |
| Outdoor dew-point margin 4 F start, 1 F stop | 0.0 / 0.0 | -0.2 / 0.0 | 0.0 / 0.0 | -0.9 / -0.2 |

- **The heating lines are a trade, not an optimum** (the first ten rows). A narrower furnace swing with a lower electric line saves electricity and gas and costs furnace starts: one step (-0.71 / -0.56 kWh and -0.05 / -0.04 therm a day for +2.1 / +2.9 furnace starts), two steps (-1.36 / -1.16 kWh and -0.10 / -0.08 therm for +5.2 / +6.9), and a wider swing the other way (+0.72 / +0.57 kWh and +0.06 / +0.05 therm for -1.6 / -2.1). That is constraint 3 against constraint 4, and it is decision 2. The electric heater's lines alone, with the furnace's swing unchanged, trade electricity for gas in both directions and leave the starts as they are: 0.5 F lower -0.74 / -0.66 kWh and +0.03 / +0.03 therm, 0.5 F higher +0.74 / +0.58 kWh and -0.03 / -0.02 therm. In winter the lowest lines change compliance by -0.4 / -0.5 points.
- **The electric heater needs its place above the furnace.** With a 2 F swing that reaches down into the furnace's range it runs 2.2 / 2.2 kWh a day less and the furnace +0.12 / +0.10 therm more, for -0.6 / -0.5 points. On the furnace's side of the swing it loses 1.4 / 0.6 points and adds +12.6 / +19.8 starts a day.
- **Everything else is flat.** Outside the heating lines no row gains more than 0.6 point of compliance over the year, 1.0 in winter or 0.4 in summer, in either model. That is the evidence that one value can serve every season. Nearly every row that saves a little of a utility costs starts or compliance.
- **Flat alternatives.** The second fan at `high + 3.0` and the misters joining at `vpd_high + 0.40` and leaving at `+ 0.15` do as well as the proposed values within the noise of the simulation. A shorter minimum time for the heaters changes nothing at all: without sensor noise a heater cycle is longer than either value.
- **Tried and not adopted:** fog as an added cooling stage (+0.1 / +0.1 point for +0.9 / +2.4 gallons a day) and a second fan while drying, when VPD is more than 0.05 kPa below the low edge (0.0 / 0.0 point for +0.9 / +2.6 starts a day). The cold-house guard on fog and mist (rules 5 and 6) is in the law at a small price: without it compliance changes by +0.02 / +0.02 point and relay starts by -0.7 / -0.3 a day.
- **One row to watch:** a fogger minimum time of 180 s changes starts by +16.4 / -1.8 a day. In model A the longer burst wets the house past the VPD low edge and the vent opens to dry it, +15.2 / +0.2 more vent starts a day in summer. The fogger's minimum times stay at 120 s.

### 5.7 The band sets the utility use: a price for each edge

Each row moves one part of the band and runs the law on it. Compliance is graded against the edited band.

Year:

| Band edit (difference from the law on today's band) | Therms/day | kWh/day | Gallons/day | Starts/day | Run hours/day | Both in own band | Nights dried |
|---|---:|---:|---:|---:|---:|---:|---:|
| Whole temperature band 2 F lower | -0.46 / -0.43 | -1.4 / -0.9 | -5 / +13 | +1.2 / +2.7 | +2.1 / +3.7 | -6.1 / -8.9 | -10 / -14 |
| Whole temperature band 2 F higher | +0.62 / +0.58 | +1.8 / +1.1 | +11 / -6 | +0.9 / +1.5 | -0.2 / -2.3 | +3.6 / +6.5 | +9 / +11 |
| Band at sunrise 2 F lower | -0.15 / -0.17 | -0.3 / -0.2 | -5 / -1 | -1.5 / -0.5 | +0.5 / +0.7 | -2.4 / -3.3 | -4 / -7 |
| Band at solar noon 2 F lower | -0.08 / -0.08 | -0.5 / -0.4 | +1 / +6 | +1.0 / +0.4 | +0.4 / +0.8 | -0.4 / -0.5 | -1 / +1 |
| Band at sunset 2 F lower | -0.13 / -0.06 | -0.3 / -0.1 | -1 / +7 | +0.9 / +2.9 | +0.1 / +1.3 | -0.5 / -0.5 | 0 / +2 |
| Band at solar midnight 2 F lower | -0.02 / -0.07 | -0.3 / -0.2 | +1 / +2 | +0.7 / +0.1 | +1.3 / +1.2 | -2.8 / -4.5 | -3 / -8 |
| Low edge only, solar noon 2 F lower | -0.08 / -0.08 | -0.8 / -0.8 | -5 / -3 | -1.7 / -0.6 | -0.8 / -0.5 | +0.2 / +0.5 | 0 / +1 |
| Low edge only, sunset 2 F lower | -0.13 / -0.06 | -0.5 / -0.4 | -4 / -1 | -1.1 / +2.3 | -0.4 / +0.1 | -0.3 / +0.2 | 0 / +2 |
| Low edge only, noon and sunset 2 F lower | -0.23 / -0.15 | -1.3 / -1.1 | -9 / -4 | -2.6 / +1.6 | -1.3 / -0.4 | +0.1 / +0.4 | +1 / +3 |
| Low edge only, noon and sunset 4 F lower | -0.38 / -0.22 | -2.3 / -2.0 | -16 / -6 | -4.1 / +4.1 | -2.1 / -0.2 | -0.2 / +0.8 | +3 / +5 |
| Low edge only, sunrise and midnight 2 F higher | +0.31 / +0.31 | +0.9 / +0.4 | +10 / +4 | +3.7 / +0.1 | +0.7 / -0.6 | +2.1 / +4.5 | +8 / +13 |
| High edge only, noon and sunset 2 F higher | 0.00 / 0.00 | -0.3 / -0.5 | -7 / -14 | -3.0 / +1.8 | -0.8 / -1.6 | +0.4 / +1.2 | +1 / 0 |
| VPD high edge 0.10 kPa higher, all day | -0.09 / -0.04 | -0.6 / -0.1 | -20 / -11 | -4.5 / -4.5 | -0.3 / 0.0 | -0.2 / 0.0 | -1 / 0 |
| VPD high edge 0.10 kPa higher, noon and sunset | -0.05 / -0.03 | -0.5 / -0.1 | -14 / -8 | -2.6 / -3.9 | -0.4 / 0.0 | +0.2 / +0.5 | -1 / 0 |
| VPD high edge 0.30 kPa higher, sunrise and midnight | -0.06 / -0.01 | 0.0 / -0.1 | -9 / -6 | -2.3 / -0.6 | +0.5 / +0.2 | -1.3 / -0.8 | 0 / 0 |

Winter:

| Band edit (difference from the law on today's band) | Therms/day | kWh/day | Gallons/day | Starts/day | Run hours/day | Both in own band | Nights dried |
|---|---:|---:|---:|---:|---:|---:|---:|
| Whole temperature band 2 F lower | -0.73 / -0.64 | -2.1 / -1.1 | -23 / -6 | -5.2 / +1.4 | -1.0 / +1.0 | -4.3 / -7.6 | -13 / -23 |
| Whole temperature band 2 F higher | +0.98 / +0.84 | +2.5 / +1.2 | +29 / +15 | +7.3 / -0.3 | +2.7 / +0.1 | +1.8 / +5.0 | +10 / +14 |
| Band at sunrise 2 F lower | -0.24 / -0.24 | -0.1 / +0.2 | -8 / -2 | -2.5 / -1.5 | -0.1 / +0.4 | -1.8 / -3.8 | -6 / -11 |
| Band at solar noon 2 F lower | -0.12 / -0.09 | -1.2 / -0.7 | -8 / -2 | -1.8 / +0.3 | -0.9 / -0.3 | +0.5 / +0.8 | -1 / +1 |
| Band at sunset 2 F lower | -0.21 / -0.09 | -0.5 / -0.4 | -7 / -2 | -1.4 / +4.3 | -0.4 / +0.5 | -0.4 / +0.3 | +1 / +3 |
| Band at solar midnight 2 F lower | -0.05 / -0.13 | -0.5 / -0.3 | 0 / 0 | +0.2 / -0.9 | +0.6 / +0.8 | -2.1 / -4.4 | -4 / -13 |
| Low edge only, solar noon 2 F lower | -0.12 / -0.10 | -1.3 / -0.9 | -9 / -4 | -2.4 / -0.8 | -1.2 / -0.6 | +0.6 / +1.0 | -1 / +1 |
| Low edge only, sunset 2 F lower | -0.21 / -0.09 | -0.6 / -0.5 | -7 / -3 | -1.8 / +3.8 | -0.6 / +0.3 | -0.3 / +0.4 | +1 / +3 |
| Low edge only, noon and sunset 2 F lower | -0.34 / -0.20 | -1.9 / -1.4 | -15 / -7 | -4.1 / +2.8 | -1.9 / -0.4 | +0.3 / +1.0 | +2 / +4 |
| Low edge only, noon and sunset 4 F lower | -0.58 / -0.27 | -3.3 / -2.3 | -27 / -9 | -6.2 / +6.7 | -3.1 / +0.1 | +0.2 / +1.7 | +5 / +7 |
| Low edge only, sunrise and midnight 2 F higher | +0.51 / +0.45 | +0.6 / -0.3 | +15 / +5 | +5.1 / -0.2 | +0.6 / -1.1 | +2.7 / +6.4 | +10 / +17 |
| High edge only, noon and sunset 2 F higher | 0.00 / 0.00 | -0.1 / -0.1 | 0 / -1 | -0.3 / -0.8 | -0.1 / -0.3 | 0.0 / +0.1 | 0 / 0 |
| VPD high edge 0.10 kPa higher, all day | -0.16 / -0.07 | -1.0 / -0.1 | -28 / -8 | -6.8 / -2.5 | -1.2 / -0.3 | +0.4 / +0.2 | 0 / -1 |
| VPD high edge 0.10 kPa higher, noon and sunset | -0.09 / -0.06 | -0.8 / -0.1 | -21 / -7 | -5.0 / -2.4 | -0.9 / -0.2 | +0.3 / +0.2 | 0 / -1 |
| VPD high edge 0.30 kPa higher, sunrise and midnight | -0.11 / -0.01 | -0.1 / 0.0 | -11 / -1 | -2.5 / -0.2 | -0.4 / -0.1 | +0.1 / +0.1 | +1 / 0 |

- **The low temperature edge by day is nearly free to lower.** On a sunny day the sun carries the house above it anyway; on a dull day the edge is 72 to 74 F and the electric heater holds the house 3.5 to 4.5 F above it, at about 75.5 to 78.3 F. Two degrees lower at solar noon and sunset saves 0.23 / 0.15 therm and 1.3 / 1.1 kWh a day for +0.1 / +0.4 point of compliance.
- **The low edge at night is expensive to raise** (+0.31 / +0.31 therm a day for 2 F) and it buys dry nights (8 / 13 more in a hundred), because a warmer house is further from the VPD low edge. That is heat spent for humidity by another route; the drying cost limit of section 4.5 is the direct lever.
- **The VPD high edge is the water lever:** 0.10 kPa higher saves 20 / 11 gallons and 4.5 / 4.5 starts a day. The 2026-11-05 amendment accepted dry winter air for now, to be looked at again in December. The law does not: it holds the VPD high edge at every hour, which is why its winter water is 57 / 11 gallons a day against 26 / 4 today. Raising the edge at night alone is a weak lever, because most of that fog is used by day: 0.30 kPa higher at the sunrise and midnight anchors saves 11 / 1 gallons and 0.11 / 0.01 therm a day in winter, where 0.10 kPa higher at every hour saves 28 / 8 gallons. Raising this edge at every hour is how the owner keeps accepting dry winter air (decision 9).
- **The high temperature edge by day** costs no gas and saves water and fan hours (-7 / -14 gallons and -0.8 / -1.6 run hours a day).

Three combined edits, with today's firmware on the same bands for comparison:

| Controller and band | Both in own band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware, today's band | 70.5 / 59.6 | 57 / 38 | 135 / 142 | 24.5 / 28.2 | 19.6 / 21.0 | 2.18 / 2.70 | 63 / 56 |
| The law, today's band | 88.6 / 80.4 | 75 / 60 | 52 / 49 | 24.0 / 31.5 | 20.2 / 23.0 | 2.29 / 2.90 | 67 / 65 |
| The law, band 1: day low edge 2 F lower, VPD high edge 0.10 kPa higher | 88.4 / 80.8 | 75 / 63 | 45 / 47 | 22.6 / 31.2 | 18.5 / 21.7 | 1.98 / 2.74 | 41 / 52 |
| The law, band 2: band 1 and day high edge 2 F higher | 88.9 / 81.9 | 77 / 63 | 41 / 47 | 21.6 / 29.5 | 18.2 / 21.3 | 1.98 / 2.74 | 34 / 39 |
| The law, band 3: band 2 with the day low edge 4 F lower | 88.7 / 82.2 | 79 / 66 | 40 / 50 | 20.9 / 29.8 | 17.3 / 20.5 | 1.85 / 2.68 | 31 / 38 |
| Today's firmware, band 1 | 71.8 / 58.6 | 57 / 40 | 118 / 141 | 23.2 / 27.3 | 18.7 / 20.2 | 1.96 / 2.52 | 42 / 49 |
| Today's firmware, band 2 | 75.6 / 63.0 | 62 / 42 | 96 / 114 | 21.6 / 25.2 | 18.5 / 20.0 | 1.92 / 2.49 | 32 / 37 |
| Today's firmware, band 3 | 75.0 / 60.4 | 62 / 42 | 93 / 114 | 20.9 / 24.5 | 17.8 / 19.2 | 1.79 / 2.36 | 30 / 37 |

Winter:

| Controller and band | Both in own band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware, today's band | 79.2 / 63.5 | 59 / 26 | 89 / 84 | 25.6 / 28.1 | 28.0 / 29.2 | 3.51 / 4.25 | 26 / 4 |
| The law, today's band | 93.7 / 85.7 | 81 / 59 | 40 / 43 | 27.6 / 32.2 | 29.1 / 30.7 | 3.72 / 4.54 | 57 / 11 |
| The law, band 1: day low edge 2 F lower, VPD high edge 0.10 kPa higher | 94.3 / 86.7 | 83 / 63 | 30 / 45 | 24.9 / 31.7 | 26.6 / 29.3 | 3.24 / 4.32 | 19 / 1 |
| The law, band 2: band 1 and day high edge 2 F higher | 94.4 / 86.9 | 83 / 63 | 29 / 44 | 24.7 / 31.5 | 26.5 / 29.2 | 3.23 / 4.31 | 18 / 0 |
| The law, band 3: band 2 with the day low edge 4 F lower | 94.1 / 87.4 | 86 / 66 | 28 / 49 | 23.8 / 32.1 | 25.3 / 28.3 | 3.04 / 4.25 | 12 / 0 |
| Today's firmware, band 1 | 80.7 / 60.8 | 58 / 29 | 62 / 78 | 24.1 / 27.1 | 26.7 / 28.1 | 3.17 / 3.98 | 8 / 1 |
| Today's firmware, band 2 | 83.5 / 64.4 | 66 / 31 | 56 / 72 | 23.6 / 26.6 | 26.7 / 28.2 | 3.11 / 3.92 | 8 / 0 |
| Today's firmware, band 3 | 83.0 / 60.7 | 67 / 32 | 51 / 72 | 22.7 / 25.8 | 25.7 / 27.1 | 2.90 / 3.72 | 5 / 0 |

Summer:

| Controller and band | Both in own band % | Nights dried % | Relay starts/day | Run hours/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Today's firmware, today's band | 59.3 / 54.6 | 55 / 54 | 194 / 218 | 22.9 / 28.2 | 8.7 / 10.4 | 0.45 / 0.69 | 111 / 123 |
| The law, today's band | 82.1 / 73.5 | 68 / 62 | 67 / 56 | 19.5 / 30.5 | 8.7 / 13.0 | 0.43 / 0.78 | 79 / 134 |
| The law, band 1: day low edge 2 F lower, VPD high edge 0.10 kPa higher | 80.8 / 73.0 | 66 / 63 | 64 / 50 | 19.7 / 30.5 | 8.0 / 11.9 | 0.36 / 0.70 | 69 / 117 |
| The law, band 2: band 1 and day high edge 2 F higher | 81.8 / 75.4 | 68 / 63 | 56 / 51 | 17.5 / 26.9 | 7.4 / 11.0 | 0.35 / 0.69 | 55 / 88 |
| The law, band 3: band 2 with the day low edge 4 F lower | 81.6 / 75.4 | 70 / 66 | 56 / 51 | 17.3 / 26.8 | 7.0 / 10.4 | 0.32 / 0.63 | 55 / 87 |
| Today's firmware, band 1 | 60.3 / 55.7 | 54 / 54 | 190 / 224 | 22.0 / 27.5 | 8.4 / 9.8 | 0.38 / 0.63 | 86 / 112 |
| Today's firmware, band 2 | 65.4 / 61.1 | 58 / 56 | 148 / 169 | 19.0 / 23.4 | 7.8 / 9.4 | 0.38 / 0.64 | 63 / 86 |
| Today's firmware, band 3 | 64.6 / 59.9 | 56 / 56 | 148 / 168 | 18.5 / 22.8 | 7.4 / 8.8 | 0.34 / 0.58 | 62 / 85 |

As change from today's firmware on today's band:

| Year, change from today's firmware on today's band | Relay starts | Run hours | Electricity | Gas | Water |
|---|---:|---:|---:|---:|---:|
| The law, today's band | -62 % / -66 % | -2 % / +12 % | +3 % / +9 % | +5 % / +7 % | +7 % / +16 % |
| The law, band 1: day low edge 2 F lower, VPD high edge 0.10 kPa higher | -67 % / -67 % | -7 % / +11 % | -6 % / +3 % | -9 % / +1 % | -35 % / -7 % |
| The law, band 2: band 1 and day high edge 2 F higher | -70 % / -67 % | -12 % / +5 % | -7 % / +1 % | -9 % / +1 % | -45 % / -31 % |
| The law, band 3: band 2 with the day low edge 4 F lower | -70 % / -65 % | -14 % / +6 % | -12 % / -3 % | -15 % / -1 % | -51 % / -32 % |

- On band 2 the law makes 70 / 67 % fewer relay starts than today's firmware does on today's band and uses 45 / 31 % less water, while holding its band 88.9 / 81.9 % of the year. Run hours change by -2.9 / +1.3 a day, gas by -9 / +1 % and electricity by -7 / +1 %. In model A all three fall. In model B they stay level or rise a little, because the law dries nights that today's firmware leaves wet, and drying takes vent and fan hours and heat.
- Most of the utility saving is the band's, and most of the drop in relay starts is the law's. On band 2 itself the law differs from today's firmware by 0.0 / +4.3 run hours, -0.2 / +1.3 kWh, +0.05 / +0.25 therm and +2 / +1 gallons a day, with 55 / 67 fewer relay starts a day and 13 / 19 points more of the year in band.
- Band 3 goes further on every utility (-15 / -1 % gas, -12 / -3 % electricity) for a low edge of 68 to 70 F by day, with the house held near 72 to 74 F on a dull afternoon.
- Today's firmware saves about the same utilities on the same bands (the last three rows). The edits are worth weighing whichever controller runs, and they need no code: the band editor exists. What the law adds on any band is the compliance and the cycle count.

Two decisions act on the same daytime low edge that band 2 lowers, so both were run again on band 2. Each row is the difference from the law on band 2:

| Change to one rule (band 2, year, difference from the law on band 2) | Both in band | Nights dried | Starts/day | Furnace starts/day | kWh/day | Therms/day | Gallons/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Furnace off at low+2.5 and electric heater 3.0/4.0 (one step lower) | -0.2 / -0.5 | -1 / 0 | +1.6 / +3.8 | +2.1 / +2.8 | -0.51 / -0.44 | -0.03 / -0.02 | -2.2 / -0.2 |
| Whole heating stack 1 F lower: electric heater 2.5/3.5, furnace off at low+2.0 (two steps lower) | -0.4 / -0.8 | -2 / -2 | +4.4 / +10.3 | +5.0 / +6.9 | -1.02 / -0.90 | -0.06 / -0.04 | -3.9 / -0.5 |
| Furnace off at low+3.5 and electric heater 4.0/5.0 (one step higher) | +0.3 / +0.5 | +1 / +2 | -0.9 / -2.8 | -1.6 / -2.0 | +0.54 / +0.46 | +0.04 / +0.03 | +2.3 / +0.4 |
| Hold back: electric heater lines 1 F lower while the sun is on the house (no forecast) | 0.0 / -0.1 | 0 / 0 | +0.2 / +0.5 | +0.1 / +0.1 | -0.44 / -0.57 | +0.02 / +0.03 | -0.1 / -0.1 |
| Hold back: electric heater lines 1 F lower, 3 h ahead | -0.1 / -0.1 | -1 / 0 | 0.0 / +0.6 | +0.2 / +0.1 | -0.64 / -0.75 | +0.03 / +0.03 | -0.4 / -0.2 |
| Hold back: heater lines and furnace off line 1 F lower, 3 h ahead | -0.1 / -0.2 | -1 / 0 | +0.5 / +2.4 | +1.4 / +1.7 | -0.50 / -0.50 | -0.03 / -0.03 | -2.4 / -0.3 |

On 2026-11-16 the owner ratified band 2 (decision 9). It is written on the same day as the five settings of decision 16 (section 11.5). This section shows today's band and band 2 side by side.

### 5.8 Robustness to model error

Each row changes one fitted property of the house and re-runs four controllers over the year.

| Model changed by | Both % today | Both % step 2 | Both % law | Both % law, never drying | Starts/day today | Starts/day law | Therms/day law | Coldest F law |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Fitted model | 70.5 / 59.6 | 85.6 / 82.6 | 88.6 / 80.4 | 83.3 / 64.0 | 135 / 142 | 52 / 49 | 2.29 / 2.90 | 59.3 / 59.2 |
| Moisture source x 1.5 | 56.2 / 31.4 | 84.0 / 67.4 | 82.7 / 69.7 | 64.5 / 32.8 | 131 / 151 | 55 / 80 | 2.84 / 4.36 | 59.3 / 59.2 |
| Moisture source x 0.7 | 72.2 / 70.7 | 82.5 / 83.0 | 91.2 / 85.1 | 89.4 / 79.4 | 158 / 154 | 58 / 50 | 2.11 / 2.43 | 59.4 / 59.3 |
| Fan air flow x 2 | 73.2 / 63.7 | 86.2 / 85.4 | 86.9 / 80.9 | 76.1 / 64.2 | 129 / 136 | 62 / 68 | 2.37 / 2.95 | 59.2 / 59.2 |
| Fan air flow x 0.5 | 66.4 / 56.1 | 84.4 / 77.2 | 87.8 / 79.0 | 82.2 / 63.4 | 135 / 142 | 53 / 46 | 2.29 / 2.87 | 59.3 / 59.2 |
| Furnace heat x 0.7 | 69.7 / 57.7 | 84.8 / 80.4 | 87.1 / 78.4 | 81.7 / 62.0 | 126 / 133 | 47 / 43 | 3.11 / 3.99 | 55.5 / 53.1 |
| Electric heater heat x 0.8 | 69.5 / 59.2 | 85.4 / 82.1 | 88.1 / 80.5 | 82.5 / 63.7 | 133 / 142 | 51 / 51 | 2.54 / 3.22 | 59.3 / 59.3 |
| Envelope heat loss x 1.25 | 67.8 / 57.5 | 84.5 / 80.6 | 87.0 / 79.6 | 80.5 / 62.3 | 136 / 146 | 52 / 51 | 3.05 / 3.71 | 58.2 / 56.3 |
| Infiltration x 0.5 | 47.5 / 25.8 | 84.1 / 72.1 | 81.0 / 70.2 | 55.6 / 30.4 | 158 / 175 | 61 / 77 | 1.97 / 2.91 | 59.4 / 59.3 |
| Fog evaporation x 0.5 | 66.5 / 58.6 | 82.0 / 80.4 | 84.4 / 78.5 | 73.4 / 61.5 | 145 / 146 | 55 / 64 | 2.32 / 2.90 | 59.3 / 59.3 |
| Fog evaporation x 1.5 | 72.6 / 60.9 | 87.8 / 83.7 | 89.2 / 82.1 | 83.2 / 65.7 | 125 / 141 | 72 / 51 | 2.30 / 2.90 | 59.3 / 59.3 |
| Moisture buffer x 2 | 66.5 / 57.5 | 82.9 / 78.6 | 85.2 / 77.4 | 77.5 / 59.4 | 148 / 149 | 56 / 56 | 2.37 / 3.05 | 59.3 / 59.3 |
| Sensor lag x 2 | 68.3 / 58.8 | 84.4 / 80.7 | 88.0 / 79.6 | 82.2 / 62.5 | 127 / 134 | 46 / 47 | 2.32 / 2.93 | 59.3 / 59.2 |
| Electric heater dead | 67.1 / 56.8 | 84.0 / 79.6 | 86.3 / 79.9 | 79.8 / 62.1 | 129 / 140 | 53 / 56 | 3.81 / 4.55 | 59.2 / 57.9 |
| Furnace dead (gas outage) | 37.2 / 28.3 | 47.4 / 38.0 | 51.6 / 39.5 | 46.8 / 30.0 | 96 / 104 | 32 / 26 | relay time only | 23.5 / 22.2 |

- The law holds the band more than today's firmware in every row, by 11.2 to 44.4 points. With both heaters working its starts stay at 43 to 80 a day where today's firmware makes 125 to 175.
- The law is most sensitive to the moisture balance. With half again as much moisture source it holds 82.7 / 69.7 %, and with half the infiltration 81.0 / 70.2 %: those are the houses where drying matters most. With drying switched off the law would hold 64.5 / 32.8 % and 55.6 / 30.4 % there. This is the uncertainty behind the default of the drying cost limit, and phase 1 measures it (issue #1669). They are also the rows where today's firmware does worst. In those two rows the review's step 2 patch, which dries without a price, holds 84.0 / 67.4 % and 84.1 / 72.1 %, ahead of the law at the default limit in three of the four figures. A higher limit is the law's answer to a wetter house (section 4.5).
- With the electric heater dead the furnace carries the house by temperature (86.3 / 79.9 % at 3.81 / 4.55 therms a day).
- A furnace that delivers 30 % less than its rating lets the house fall to 55.5 / 53.1 F on the coldest night (issue #1670).
- With the furnace dead, no controller holds the winter band: the electric heater alone leaves the house below the band 65 / 75 % of the winter and the coldest minute is 23 / 22 F. The figures for today's firmware and the step 2 patch in that row are not like for like: their cold-protection mode runs a fan with the vent closed, and the model charges that fan the full air exchange of an open vent.

## 6. Forecast pre-staging (constraint 10)

The constraint asks for pre-staging if it reduces resource use and run time. That was tested before deciding to build anything, with the most favourable assumption possible: the controller knows the coming outdoor temperature and sun exactly (the weather record itself), so the result is an upper bound on what a forecast could deliver for these rules. Two rows repeat a rule with a forecast error of up to 8 F.

Four rules were tried on top of the law: three act early and one holds back. Each has a trigger from the forecast and an action:

- **Pre-heat.** Trigger: the coldest outdoor temperature of the next 12 hours is more than 25 F below the band's lowest low edge, which is below about 36 F. Action: raise the electric heater's lines, by 0.5 F in one row and by 4.5 F in the next (to 1 F below the high edge), so that electric heat is banked before the furnace is needed. While it is active the cooling exit is 0.5 F instead of 2.0 F, so that cooling does not remove the banked heat.
- **Pre-cool.** Trigger: the warmest outdoor temperature of the next 6 or 8 hours is above the band's highest high edge (by more than 5 F, by any amount, or within 5 F below it), and the outdoor air is now at least 2 F cooler than the house. Action: start cooling 4 F below the high edge and stop 6 F below it.
- **Pre-dry.** Trigger: the outdoor air will be 10 or 20 F colder within 6 or 10 hours. Action: start and stop drying 0.10 kPa higher, while outdoor air is still cheap to bring in. Its stop line then sits above the fogger's off line.
- **Hold back.** Trigger: the sun on the house is above 300 W/m2 now, or will pass it within the next 3 or 6 hours. The sun is above that level 26 % of the year; with 3 hours of look-ahead the rule is active 42 % of the year, and with 6 hours 54 %. Action: lower the electric heater's lines by 0.5, 1 or 2 F, so that the sun supplies heat the heater would have supplied. Three forms were run. The heater's lines alone, 0.5 or 1 F lower, which keeps the heater's off line above the furnace's. The heater's lines 2 F lower, which puts the heater inside the furnace's swing. And the heater's lines and the furnace's off line together (the furnace's by the same amount, at most 1.5 F), which keeps the heater above a narrower furnace swing. Two rows repeat the 1 F forms with no look-ahead: the trigger is then the present sun alone, and no forecast is used.

Year, difference from the law:

| Pre-staging rule (year, difference from the law) | Share of time active % | Both in band | Therms/day | kWh/day | Gallons/day | Starts/day | Furnace starts/day | Run hours/day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Pre-heat: electric heater lines 0.5 F higher, 12 h ahead of a night more than 25 F below the band | 21.8 / 21.8 | +0.02 / +0.03 | 0.00 / 0.00 | +0.03 / +0.02 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | +0.02 / +0.02 |
| Pre-heat: electric heater lines 4.5 F higher, same trigger | 21.8 / 21.8 | +0.02 / +0.04 | -0.01 / 0.00 | +0.12 / +0.06 | +0.3 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | +0.08 / +0.04 |
| The same with a forecast error of up to 8 F | 22.8 / 22.8 | +0.03 / +0.03 | -0.02 / -0.01 | +0.25 / +0.13 | +0.4 / 0.0 | 0.0 / 0.0 | -0.1 / 0.0 | +0.16 / +0.07 |
| Pre-cool: start cooling 4 F below the high edge, 6 h ahead of a day more than 5 F above the band | 1.5 / 1.2 | +0.06 / -0.02 | 0.00 / 0.00 | +0.03 / +0.01 | 0.0 / 0.0 | +0.7 / +0.3 | 0.0 / 0.0 | +0.30 / +0.10 |
| Pre-cool: the same, 6 h ahead of a day above the band | 3.9 / 3.6 | +0.04 / -0.05 | 0.00 / 0.00 | +0.09 / +0.05 | +0.4 / +0.4 | +1.7 / +0.9 | 0.0 / 0.0 | +0.70 / +0.32 |
| Pre-cool: the same, 8 h ahead of a day within 5 F of the band's high edge | 10.2 / 9.9 | -0.07 / -0.18 | +0.01 / 0.00 | +0.35 / +0.25 | +2.1 / +3.2 | +4.4 / +2.5 | 0.0 / 0.0 | +1.57 / +0.96 |
| Pre-cool (day above the band) with a forecast error of up to 8 F | 4.6 / 4.3 | -0.03 / -0.17 | 0.00 / 0.00 | +0.16 / +0.11 | +0.9 / +1.3 | +2.5 / +1.3 | 0.0 / 0.0 | +0.87 / +0.48 |
| Pre-dry: dry 0.10 kPa earlier when the next 6 h turn 10 F colder outdoors | 25.8 / 25.8 | -0.14 / +0.60 | +0.02 / +0.07 | +0.46 / +0.22 | +3.3 / +0.6 | +8.1 / +4.8 | +0.1 / +0.4 | +0.90 / +0.86 |
| Pre-dry: the same, 10 h ahead | 40.1 / 40.1 | -0.16 / +0.86 | +0.03 / +0.11 | +0.64 / +0.34 | +4.4 / +1.2 | +11.9 / +7.6 | +0.1 / +0.6 | +1.29 / +1.36 |
| Pre-dry: when the next 10 h turn 20 F colder outdoors | 11.3 / 11.3 | -0.15 / +0.23 | 0.00 / +0.03 | +0.21 / +0.07 | +1.9 / +0.1 | +4.7 / +1.3 | 0.0 / +0.2 | +0.37 / +0.31 |
| Hold back: electric heater lines 1 F lower while the sun is on the house (no forecast) | 25.6 / 25.6 | -0.11 / +0.05 | +0.03 / +0.04 | -0.61 / -0.71 | -0.5 / -0.4 | +0.1 / +0.6 | +0.1 / +0.2 | -0.39 / -0.45 |
| Hold back: heater lines and furnace off line 1 F lower while the sun is on the house (no forecast) | 25.6 / 25.6 | -0.10 / +0.08 | +0.01 / 0.00 | -0.55 / -0.59 | -1.4 / -1.2 | +0.3 / +0.6 | +0.5 / +0.5 | -0.39 / -0.40 |
| Hold back: electric heater lines 0.5 F lower from 3 h ahead of sun | 42.2 / 42.2 | -0.12 / +0.09 | +0.02 / +0.02 | -0.42 / -0.40 | -0.8 / -0.2 | -0.3 / +0.3 | +0.1 / +0.1 | -0.28 / -0.22 |
| Hold back: electric heater lines 1 F lower, 3 h ahead | 42.2 / 42.2 | -0.13 / +0.05 | +0.04 / +0.04 | -0.85 / -0.91 | -1.0 / -0.6 | -0.2 / +0.8 | +0.2 / +0.2 | -0.56 / -0.51 |
| Hold back: electric heater lines 2 F lower, 3 h ahead (inside the furnace's swing) | 42.2 / 42.2 | -0.26 / -0.06 | +0.20 / +0.22 | -3.08 / -3.60 | -2.9 / -1.4 | +2.1 / +5.3 | +0.7 / +0.7 | -1.97 / -2.15 |
| Hold back: the same with the furnace's off line 1.5 F lower | 42.2 / 42.2 | -0.38 / -0.31 | -0.04 / -0.03 | -1.40 / -1.46 | -6.6 / -3.6 | +2.0 / +4.4 | +3.2 / +3.8 | -1.15 / -0.97 |
| Hold back: heater lines and furnace off line 1 F lower, 3 h ahead | 42.2 / 42.2 | -0.19 / -0.11 | -0.04 / -0.04 | -0.69 / -0.68 | -3.9 / -2.6 | +0.7 / +2.1 | +1.7 / +2.0 | -0.60 / -0.44 |
| Hold back: heater lines 2 F and furnace off line 1.5 F lower, 6 h ahead | 54.3 / 54.3 | -0.56 / -0.85 | -0.04 / -0.04 | -1.68 / -1.71 | -7.4 / -3.7 | +3.5 / +7.0 | +4.8 / +5.7 | -1.34 / -1.16 |

- Pre-heating changes gas by -0.02 to 0.00 therm a day and electricity by +0.02 to +0.25 kWh a day.
- Pre-cooling changes compliance by -0.18 to +0.06 point and adds 0.3 to 4.4 starts and 0.10 to 1.57 run hours a day.
- Pre-drying adds 1.3 to 11.9 starts a day and changes gas by 0.00 to +0.11 therm, for a change in compliance of -0.16 to +0.86 point.
- Holding back the electric heater's lines alone, 1 F from 3 hours ahead of sun, saves 0.9 / 0.9 kWh and 0.6 / 0.5 run hours a day and costs 0.04 / 0.04 therm a day, with relay starts changed by -0.2 / +0.8 a day and compliance by -0.1 / 0.0 point. The furnace replaces part of the electric heat that is removed (0.41 / 0.46 kWh more furnace heat for 0.83 / 0.90 kWh of electric heat a day), so this form moves heat from the electric heater to the furnace, against constraint 5. At 0.5 F the energy figures are about half.
- Two degrees puts the heater's lines inside the furnace's swing: 3.1 / 3.6 kWh a day saved for 0.20 / 0.22 therm burned, which is 6 / 7 kWh of fuel.
- Holding back the heater's lines and the furnace's off line together (1 F, 3 hours ahead) saves 0.69 / 0.68 kWh, 0.04 / 0.04 therm and 0.6 / 0.4 run hours a day, for 1.7 / 2.0 more furnace starts a day: the furnace's swing is narrower while the rule is active. Two degrees or six hours ahead save more electricity and add more furnace starts (4.8 / 5.7 a day at 6 hours), and at 6 hours gas changes by -0.04 / -0.04 therm.
- Most of the heater-only saving needs no forecast. With the present sun alone as the trigger it saves 0.61 / 0.71 kWh and 0.39 / 0.45 run hours a day and costs 0.03 / 0.04 therm. The 3 hours of look-ahead save a further 0.24 / 0.19 kWh and 0.16 / 0.07 run hours. In the form with the furnace's off line the look-ahead is what saves the gas: on the present sun alone that form saves 0.55 / 0.59 kWh, changes gas by +0.01 / 0.00 therm and adds 0.5 / 0.5 furnace starts a day.
- Against the same lines lowered at every hour (section 5.6), the 3 hour forms get about half of the electricity saving while they are active 42 % of the time, and at a smaller price. The heater-only form changes compliance by -0.1 / 0.0 point where the all-hours row loses 0.3 / 0.3. The form with the furnace's off line adds 1.7 / 2.0 furnace starts where the all-hours row adds 5.2 / 6.9.

Acting early saves nothing because of the house. It loses heat with a time constant of 5.6 hours (review section 4.4), so most of the heat banked in the afternoon has leaked away before the coldest hours, and a house held warmer in the meantime loses more. Moisture leaves faster still. Cooling early costs fan hours for air that warms again before the peak.

**What holding back comes to.** It is the one kind of rule here that saves electricity and run hours, and the saving is a few percent. The heater-only form saves 4 / 4 % of the electricity and 2 / 2 % of the run hours and uses 2 / 1 % more gas. Of its electricity saving 72 / 79 % comes from the present sun, and the look-ahead saves a further 1 / 1 % of the electricity. The form with the furnace's off line saves 3 / 3 % of the electricity and 2 / 1 % of the gas with 18 / 15 % more furnace starts, and there the forecast is what saves the gas. Each form pays with something another constraint protects: heat moved from the electric heater to the furnace (constraint 5), or furnace starts (constraint 3). The figures assume the sun is known exactly.

The same kind of saving is available from the band with no forecast. The low edge climbs about 11 F between sunrise and solar noon, and the heaters follow it. Lowering that edge 2 F at solar noon and sunset saves 0.23 / 0.15 therm and 1.3 / 1.1 kWh a day averaged over the year, with no forecast and no sun reading (section 5.7). It also lets the house be 2 F cooler by day, which is the owner's choice of band (decision 9). A hold-back is the refinement that acts only on sunny days and only on the heaters' lines.

**What was not simulated.** Putting drying off until the outdoor air is cheaper. Its saving is bounded by what drying costs at the default limit: 0.9 / 1.6 kWh and 0.03 / 0.20 therm a day against never drying. It could reach that bound only by giving up dried nights, and the cost limit already refuses the expensive hours.

**Conclusion.** No rule that acts early reduces resource use or run time in this house. Holding the electric heater's lines lower while the sun is on the house does, by a few percent, and it pays for that with gas in place of electric heat or with furnace starts. Most of it needs no forecast. The forecast's own share is 1 / 1 % of the electricity, or the gas saving of the form that adds furnace starts. The first release has neither rule: the law is accepted on the controller first (decision 15), and the hold-back is a deferred issue that carries these figures. If it is built, the present-sun form reads the weather station's light reading, which the controller already receives for the lighting decision with a freshness check (`tempest_lux`, `firmware/greenhouse/controls.yaml:2185-2204`), with its threshold set in that reading's unit from the record. The look-ahead form adds one optional input, a "sun expected" flag from the host that expires by itself. The law runs as specified without either, so constraint 1 is not affected. The forecast-action engine is removed either way (issue #1653): of its 142,434 logged evaluations 98.96 % were no-ops and its last write to the controller was on 2026-10-05. The hourly forecast fetch stays for the dashboard and the reviewer, who can warn of a cold snap that exceeds the furnace (issue #1670) and price a temporary band edit for it. The answer would change if the house gained thermal mass, for example water storage; the test is one simulator run and can be repeated then.

## 7. The planner's role

Under the law one climate setting is left, the drying cost limit, and the owner sets it on the dashboard (decision 1). Of the 48 settings the planner writes today, the soft water budget stays as an irrigation setting that the owner sets (decision 11), and the rest become compiled constants or disappear. The planner has no climate value left to write.

What the record says (review section 7): on 44 of 94 days no planner value reached the controller and the planner kept planning; re-planning showed no measurable benefit over holding the last plan (plus 1.7 points, interval -5.7 to +9.1); 505 of 960 wake-ups ended in an acknowledgement with no change; each waypoint is computed against the band at the moment of writing, for up to 72 hours ahead.

**Decided on 2026-11-15: the planner becomes a reviewer** (decision 4).

- Once a day it reads the record: compliance, relay starts and hours, utilities, the drying meter, alerts, and the forecast.
- It writes a short review to a table of its own, not to `plan_journal`: embedded panels of the public site and `v_forecast_plan_outcome_mart` read every `plan_journal` row whatever its prefix (section 8.10). Where the record supports it, it proposes a band edit and quotes its simulated price from section 5.7. The owner makes the edit in the band editor or does not.
- It writes no climate value to the controller, directly or through a setting. That has to be enforced, because the general settings tool (`set_setting` in MCP) today lets an agent write any writable row, band anchors included, and an agent's write wins over everything but a person's. The tool is limited to the operator switches for an agent, and a test checks that an agent's write to a band row or to the drying cost limit is refused. Those are written only from the dashboard under the owner's sign-in: the reviewer's proposal carries the values and the owner applies it there.
- It keeps its irrigation tools (schedules, line settings, run, stop, clear fault, status). They do not use the climate write path. Three things tie them to the plan cycle and are edited with it: the prompt tells Iris to end every wake-up with `set_plan` or `acknowledge_trigger`; three of the write tools take an optional `trigger_id` and `planner_instance`, which are only logged, and the review passes its own run id; and the tests that assert both (`tests/test_mcp_irrigation_write_tools.py`, `tests/test_dashboard_db_mcp_irrigation_writes.py`), with the Iris tool-count test (`tests/test_mcp_irrigation_write_tools.py:253-264`) and the five files it reads, which change together when the plan tools go.

**When Iris can act on irrigation.** Iris acts only when it is woken, and only the trigger matrix wakes it: midnight, sunrise, solar noon, two transitions, sunset, a weekly run, a forecast deviation and a manual trigger (`ingestor/tasks/_common.py:853-945`), about eight times a day. Nothing in irrigation wakes it. The `irrigation_changed` and `desired_state_changed` notifications wake the ingestor's irrigation sync and the dispatcher (`ingestor/ingestor.py:5023-5049`), not the planner, and they stay as they are. With one review a day Iris can change irrigation once a day and on a manual trigger. The record says that loses nothing seen so far: in the twelve days the activity log covers (from 2026-11-03) there are 24 irrigation writes, from the dashboard, the release work and another agent, and none from Iris. The owner accepted that on 2026-11-15. A second run a day remains one more trigger of the same kind if it is wanted later.

Considered and not chosen: a planner with bounded authority over the band (it could move anchors within an envelope the owner sets), and no planner. Bounded band authority keeps an AI in the loop but adds a writing path whose effect the record could not show, and it makes the band a moving target for the compliance figure. No planner loses the daily reading of the record, which is where a language model is useful.

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
| `wifi.reboot_timeout` (`firmware/greenhouse.yaml:178`) | 300 s | 0 s (decision 22) | New |
| Time validity (`controls.yaml:427`) | valid time is trusted, including a clock retained across a soft reset | A separate trust flag for the band's clock: trusted only after an SNTP sync has completed since the last boot (the existing `sntp_acquisition` logic and `sntp_valid` entity; section 4.9). `controller_time_valid` and the solar times that lighting and irrigation read are not touched. | #1638 (amended) |
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
| `setpoint_plan`, `setpoint_clamps`, `forecast_action_log`, `forecast_action_rules` | 123 MB, 53 MB, 49 MB and a short rule list | Their writers and their readers on the control path are removed. `forecast_action_rules` is dropped. The other three tables are held back for the public site and stop growing (section 8.10). | #1646, #1654, #1653 |
| Planner cycle tables: `planner_trigger_ledger`, `plan_delivery_log`, `daily_plan_archive_audit`; `forecast_deviation_log`, `forecast_deviation_thresholds` | written by the plan cycle and the deviation trigger | Their writers on the control path are removed. `forecast_deviation_thresholds` is dropped. The other four are held back for the public site (section 8.10); the site's own generator keeps writing `daily_plan_archive_audit`. `planner_lessons` stays as the reviewer's memory. | #1646, #1653, #1660 |
| Experiment tables, functions, triggers, views and roles | 71 tables, about 175 functions, 97 triggers, 17 views, 14 roles; `fixed_panel_native_events` alone 2,878 MB | Dropped. `fn_mcp_armed_assignment_context` is redefined because the irrigation context calls it. The public evidence route keeps its keys and reports that evidence as unavailable (section 8.10). | #1635, #1649, #1657 |
| Idle planner tables | 3 with no rows, 2 shadow | Dropped | #1652 |
| `setpoint_snapshot` | 962 MB; 57 % of rows are constants | Stored on change; about 40 parameters instead of 191, which include the 24 lighting readbacks and the water budget readback | #1662 |
| `setpoint_changes` | 318 MB; mostly band-anchor re-assertions from June and July, since fixed | Kept; small | #1663 |
| `crop_band_anchors` | 24 house rows, 16 zone rows, 12 crop temperature rows; rows are chosen by season and growth stage | 16 house rows are what the controller reads, constrained to one season and one growth stage, because the controller has neither; the store has one of each today. The 8 target rows stay in the store while the public site's band view draws them (section 8.10). Zone rows dropped. The 12 crop rows need their reader traced first. | #1663, new |
| `fn_house_vpd_control_band` | a further definition of the VPD band: the median of the zone crop curves, a 0.55 kPa minimum width and a 0.20 kPa low margin, typed again in `ingestor/tasks/_common.py:155-158`. It is behind `fn_setpoint_at` and the `vpd_stress` alert, `v_band_device_divergence`, `fn_band_timeline`, API `/setpoints`, the dispatcher and the setpoint server. | Redefined as the house anchor curve; the two constants deleted | New |
| `fn_zone_vpd_targets`; the crop-profile fallback in `fn_center_band_setpoints` | further definitions of a band. Read by `verdify_services/series.py:1360`, `api/main.py:1852`, the Grafana home dashboard, `dispatcher.py:1098`, `scripts/setpoint-server.py:310`, the function above and the materialized view `mv_band_curve`, which a CronJob refreshes (`fn_refresh_mv_band_curve`) and the boundary digest counts. | Dropped after each reader is repointed to the house curve. `mv_band_curve` is redefined on the house curve in the same migration and keeps its name, all thirteen columns and its refresh step, because the public site embeds panels that read it (section 8.10); the four zone target columns are filled from the house curve or left NULL. | New |
| `fn_band_timeline` (56 columns) | re-derives firmware thresholds in SQL | Band edges and the law's lines from the generated constants. Its signature and its whole return type stay: all 56 columns, with their names, types and order, because the Grafana wrapper of migration 268 selects * into that row type. Columns the law no longer has are filled from the generated constants or left NULL (section 8.10). | New |
| `climate_action_log` | 768 MB; one row a minute with a JSON copy of the device state; band columns stale since July | The law's state on change and one plain row a minute as a heartbeat. The OTA gate reads its freshness (section 8.5). No column is dropped while the public site's panels read the table (section 8.10); the mode-era columns stop being filled in phase 4. | #1665 (amended) |
| Planner scoring views and functions | | The reviewer reads served-band compliance and the daily cycles and utilities record. The scoring names that the public site and its evidence route read are held back (section 8.10); `fn_planner_scorecard` already returns served-band compliance. | #1659 (amended) |
| `fn_band_compliance_5m` and its daily table | the one compliance definition | Kept; it grades the signal the controller controls on (section 9) | #1667 |
| `daily_summary` | per-relay cycles and run times, estimated kWh and therms from `v_runtime_energy_daily` and `resource_coefficients` | Kept and reused for section 10. The furnace's 0.75 therm an hour is already in `resource_coefficients` (75,000 BTU/h); the other typed copies are removed, so there is no second definition of therms. | #1668 (amended) |
| `climate`, `equipment_state`, `system_state`, `desired_state`, `weather_forecast`, `alert_log`, `plan_journal` | | Kept | - |
| Irrigation tables and views, lighting functions and views, `crops`, `crop_target_profiles`, the solar functions | | Unchanged (sections 8.7, 8.8) | - |

**Order of the drops.** A plain drop fails or, with `CASCADE`, silently removes things irrigation and the dashboard need. Each migration follows these rules:

1. Code first: a release removes every reader of an object before the migration that drops it. The dispatcher, for one, reads `fn_zone_vpd_targets` at the top of each pass, before its lighting block; dropping the function first would stop lighting delivery.
2. `setpoint_plan` and `v_active_plan` stay while the public site is out of scope (section 8.10): the site's publisher reads them (`scripts/generate-daily-plan.py`, `scripts/generate-ai-tunables-page.py` and the publisher's plan view of migration 268), and a failed publisher step stops the whole site from rebuilding. What goes in phase 4 is every reader on the control path: `verdify_services/settings.py`, `verdify_services/reads.py`, `api/main.py` outside the public evidence route, `mcp/server.py`, the dispatcher, `scripts/setpoint-server.py` and the ingestor's action-log writer (its plan-context query, `ingestor/ingestor.py:2404-2417`). `setpoint_clamps` stays as well, and the settings path (`verdify_services/settings.py`, `verdify_services/reads.py:1051`) drops its clamp joins. `v_irrigation_schedule_current` joins `v_active_plan`; it already falls back to the controller's state, then readbacks, then defaults, and it is redefined without the plan source so that irrigation no longer depends on a frozen table. Removing that view altogether is irrigation clean-up and belongs to issue #1655. When the site is taken up, the order for what was held back is: the site's readers, then `v_active_plan`, `v_setpoint_forward` and the per-role plan views of migration 268, then the tables.
3. The dashboard login's self-check (`fn_attest_login`, migration 282) names `setpoint_plan` and five experiment tables. Once they are gone the check raises an error on every pooled connection and every dashboard route fails, the irrigation and light routes included. It is redefined in the same migration as the drop, with the two login checks of migration 276 that name an experiment table.
4. Two boundary digests are checked when a runtime connects. `fn_runtime_ordinary_boundary_digest` (the API and ingestor receipts) lists 48 protected relations, 30 helper functions and 20 internal callees by name and checks the counts. `fn_mcp_runtime_boundary_digest` (`mcp_runtime_boundary_receipt`) is computed over the MCP roles' privileges, so it changes with every dropped object MCP can touch; a stale receipt stops every MCP tool, the irrigation tools included. Every drop migration rewrites the lists and the counts and re-seals the receipts, as migrations 286 and 309 did. Acceptance is that the ingestor, the API and MCP start and pass their login attestation after the migration.
5. `db/schema.sql` predates migration 290 and still contains objects that migration 309 dropped. The inventory and the CI check below are based on a replay of the migrations into a scratch database, not on that file.

The drops ship one migration per release with an archive dump taken first, not a soak. About 2.9 GB is dropped in this plan and about 0.7 GB more is saved by storing snapshots on change (an estimate), of the 9.3 GB measured before migration 309. About 78 tables go: the 71 experiment tables, the idle planner tables and the two rule tables. The seven plan and forecast tables that the public site reads, about 0.23 GB, are held back (section 8.10); the replay gives the final counts.

### 8.5 API, MCP and dashboards

| Item | Today | Target | Issue |
|---|---|---|---|
| MCP `set_plan` (`mcp/server.py:3798-4386`), `set_tunable` (`:3231`), `policy_template_propose` (`:4390`) | climate write tools | Removed. The constant `PLAN_REQUIRED_PARAMS` stays, because a generator of the public site parses it (section 8.10). | #1646 (amended), #1649 |
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
| API `/health` (`api/main.py:2043`) and the scorecard fetch (`api/main.py:1240`) | read `v_planner_performance` and `fn_planner_scorecard` | `/health` reads compliance. The public scorecard route keeps its path and its keys (section 8.10). | #1659 (amended) |
| Grafana | `setpoint_plan` in two dashboards, the planner scoring objects in two, `plan_journal` in five, `fn_band_timeline` in twelve, `fn_zone_vpd_targets` in one | Repointed in the release that changes the object. In the twenty dashboards of the public site's share manifest, no uid changes and no shared panel is removed (section 8.10). A CI check that no panel and no generator of the site queries a dropped object. | New |

### 8.6 Documents

`docs/CONTROL-ARCHITECTURE.md`, `docs/firmware-control-contract.md`, `docs/firmware-fsm-spec.md`, `docs/tunable-cascade.md`, `docs/iris-planner-contract.md`, `docs/planner/planner-io-schema.md` and `firmware/DESIGN.md` describe the stack that is removed. They are replaced by one control document that states the law, includes the generated constants table and describes the device contract of section 3.2; the old files are marked as history (issue #1672). The cross-layer rules in `AGENTS.md` about planner tunables and their readbacks are rewritten when the tunables go.

The decision records change as follows, in one new ADR that states the law:

| Record | What the plan does to it |
|---|---|
| ADR-0004, floating corridor | Decisions 1 to 3 (float inside the band, the target is not a control objective, cost is a driver) are what the law implements. Decision 7 (the planner pre-acts on the forecast, towards model-predictive control) is withdrawn on the evidence of section 6. The one kind of forecast rule that saved electricity there is an input to the controller, not a planner action, and is decision 15. |
| ADR-0004, amendment of 2026-11-05 (night dry-out) | Superseded in two items by the owner's decision of 2026-11-15 (decision 1). "Gas never runs for humidity" is replaced by the drying cost limit, a price above zero that the owner sets on the dashboard (section 4.5). The 10 kWh nightly cap goes with it: the limit prices each kilogram and the controller meters the daily total. The floor and the nightly grade stay. The pulses and the night-only test are replaced by rule 7. Item 5 (dry winter nights accepted for now) is carried by the band: the law holds the VPD high edge at every hour, so accepting dry winter air is a choice of that edge (section 5.7, decision 9). The new record states all of this. |
| ADR-0006, bounded active planner | Superseded by the reviewer of section 7. |
| ADR-0009, solar-night dry-out | Superseded: drying follows rule 7 at every hour. |
| ADR-0010, experiment fast path | Retired with the experiment code (issue #1649). |

### 8.7 Irrigation: what stays and what the climate path must keep providing

Irrigation shares valves, the fogger and the control loop with climate, so the refactor has obligations to it. The engine's code is not changed (section 11.5). No irrigation behaviour is meant to change except in three declared ways:

1. The soft water budget is held at 300 gallons from phase 0 and kept across a restart from phase 2 (decision 11). The controller held 120 on 2026-11-16, so scheduled mist windows, fog and climate pulses may run on from 120 to 300 gallons on a day that reaches them.
2. The dew-point margin for wetting is compiled at 8 F, where the planner moved it between 8 and 12 F (appendix E).
3. At and just below the 100 F limit the misters follow rule 6, where today's firmware runs no climate mister pulse (rule 8). The engine's own gates still decide every pulse.

The inputs of the zone ranking change as decision 5 says, and the values compiled for the engine are those of appendix E. How often Iris acts on irrigation was decided on 2026-11-15 (decision 4, section 7).

**Stays as it is:** `firmware/lib/irrigation_program.h`, `irrigation_engine_esphome.h`, `firmware/greenhouse/irrigation_engine.yaml` (the program and command services, the `manual_override` service, the 5 s tick, the engine's own clock test); the ten wet relays with their grant and fertiliser-master guards; `greenhouse_solar.h`; `policy_sha256.h` and `policy_hex_decode`; on the host `ingestor/tasks/irrigation.py`, the device transport `push_policy_transaction` (`ingestor/esp32_push.py:1331-1418`), `verdify_schemas/irrigation.py`, the irrigation services, routes, MCP tools, tables, views and alerts; the dashboard water pages; the soft water budget, which caps scheduled misting as well as climate pulses and is shown on the dashboard. It stays a stored setting and the owner sets it in place of the planner (decision 11). Two symbols that irrigation modules import from code this plan rewrites also stay: `_heap_push_defer_active` in the dispatcher and `Leak` and `ReadbackState` in `verdify_services/reads.py`.

**The law must do, every second, what the climate loop does for the engine today:**

- Open a mister only through `irr_vpd_grant`, `irr_vpd_release` and `irr_climate_close`, and only for a line the engine allows (`irr_climate_zone_allowed`); call `irr_mister_watchdog`; use `irr_rank_vpd_zone` when more than one line is a member, and carry over the fairness rule that overrides it for an overdue zone, which is in the climate mister code today (`controls.yaml:1400-1420`, section 4.8).
- Hold the fogger and misters exactly as today. In every state: while the fertiliser master is open or the fertigation line holds (`irr_l03_hold`), while a drip relay reads on, during occupancy, and on a sensor fault, except that the humidify override can still force the fogger in the state of decision 7 (section 11.5). Outside the 100 F limit the fogger is also held while the engine has a drip in progress (`irr_drip_active`), when the soft budget is reached unless a VPD emergency holds (`controls.yaml:865-867`), and when the daily safety cap has tripped (`irr_saf4_tripped`); fog at the 100 F limit is counted and not capped. The misters are held by all three in every state: the engine's grant refuses them.
- Honour a fog request from `irr_fog_run`, and add the metered water to the engine's daily count while the fogger or a mister runs (`irr_add_water`).
- Supply the engine's inputs, which today are read from the mode logic:

| Engine input | Today | Under the law |
|---|---|---|
| `sensor_fault` | mode is SENSOR_FAULT | no valid indoor reading |
| `safety_cool` | mode is SAFETY_COOL | temperature at or above 100 F (rule 8) |
| `vpd_emergency` | the highest of the house and zone VPD readings is above the safety maximum setting | the same test against a compiled 2.5 kPa, which is what the controller holds; the boot repair and the sanity reset that fall back to 3.0 today go with the setting |
| `climate_demand` | fog or mist is wanted and nothing but a drip holds it; mist also needs a member line that passes the zone gate | the latch of rule 5 is set, or the latch of rule 6 is set and at least one member line passes the zone gate (`irr_climate_zone_allowed`), as today; the house is at or above the band's low temperature edge (the cold-house guard); and every hold above passes except the drip. A latch that occupancy, the safety cap, the guard or the zone gate blocks must not make a drip yield. |
| the zone gate's `demand` | climate misting wanted | the latch of rule 6 with its cold-house guard, with the vent rule of today |
| the zone gate's `safety_ok` | a valid clock, no occupancy, no feed hold, VPD above the high edge, and a dew margin with separate day and night values | no occupancy, no feed hold, VPD above the high edge, and one compiled dew margin of 8 F, the larger of the day value (8 F) and the night value (6 F) that the controller holds; at these values nothing changes. No clock term, because the law has a band when there is no clock, and no night term. |
| zone ranking inputs | each zone's VPD against its own target curve; ranks from four settings | each zone's VPD against the house band; ranks compiled as centre 1, south 2, west 3, east 4 (appendix E) |
| fairness rule inputs | each member zone's VPD against its own target; 10 minutes without a pulse | the same against the house band's high edge |
| `sensor_degraded`, `occupied`, `rh_pct`, the per-zone VPD source | | unchanged |
| dew margin for scheduled misting | setting `direct_wet_stress_min_dew_margin_f` | compiled at 8 F: the default, what the controller holds, and the value on most of the last 30 days, in which the planner moved it between 8 and 12 (appendix E) |
| `soft_budget_centigal` | setting `mister_water_budget_gal`, written by the planner | the same setting, set by the owner |
| `mister_min_off_s` | setting, written by the planner | compiled at 45 s, which the controller has held without change (appendix E) |

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
- #1650: the lighting read of `outdoor_staleness_max_s` through `pol()` (`controls.yaml:2191-2192`) becomes a compiled 600 s, which is the default and what the controller has held without change (appendix E). The law's own age limit on outdoor data is the same constant.
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
| Database | Tables | about 85 dropped: about 78 in this plan, 7 when the public site is taken up | |
| Database | Size | 9.3 GB | about 5.5 GB (about 5.7 GB while the 7 tables are held back) |
| MCP | Climate write tools | 4 | 1 (`set_setting`, operator switches only for an agent) |
| HTTP | Experiment and planner routes | 17 | 0 to 2 |
| Band | Definitions of the band curve | 5 | 3, tested against one set of vectors |
| Band | Keys of the anchor service | 56 | 18 |

Targets follow decisions 5, 6 and 11 (no zone curves, no target curves on the controller, the water budget kept as a setting the owner sets). They are the end state. While the public site is out of scope, section 8.10 holds part of it back: seven tables of about 0.23 GB, the views and functions in its list, the 8 target rows of the store and about 570 lines of schema modules.

### 8.10 Held back for the public site

The owner put lab.verdify.ai out of scope on 2026-11-16 (decision 19). The site is rebuilt every 30 minutes by a publisher that queries the live database and one public API route. Its pages embed panels of thirteen product dashboards (from a crawl of the live pages; the hand-written sources were not read), and its share manifest (`grafana-public-shares.json`, `verdify_public/grafana_catalog.json`) gives public tokens to twenty. A generator step that fails once in production (the CronJob sets one attempt per step; the script's default is three) stops the whole site from rebuilding (`scripts/publish-site-content.sh:184-189`): the last good pages stay up and go stale, and the only signal is a failed publisher Job. Any change to an object a generator reads is treated as breaking until its test passes. So this plan follows three rules, and they override every removal named elsewhere in section 8.

1. **The site keeps building.** No file of the site, its generators or its publisher changes. Nothing a generator reads is dropped or renamed, and no column it reads is dropped.
2. **Its panels and routes keep answering.** No dashboard in the share manifest changes its uid or loses a shared panel, and no object or column such a panel reads is dropped. The rule covers every uid and panel id in the manifest. The public API routes keep their paths and their keys.
3. **Content may go quiet where the thing it reports has stopped.** A page or a panel that reports plans, modes or experiments shows nothing new once there are none. That cannot be avoided without redesigning the page, which is the work the owner deferred. Each such effect is listed below with the step that causes it, and the coordinator starts phases 4 and 5 with this list in front of it (section 11.5).

**Held back until the site is taken up.** The plan's target state is unchanged. These stay until decision 19 is reopened, and each is an exclusion in the scope of the issue that would have removed it (section 11.3).

| Kind | Held back | Why |
|---|---|---|
| Tables | `setpoint_plan`, `setpoint_clamps`, `plan_delivery_log`, `planner_trigger_ledger`, `forecast_deviation_log`, `forecast_action_log`, `daily_plan_archive_audit` | Read on every publisher run or through the public evidence route. Their writers on the control path are still removed, so they stop growing. `daily_plan_archive_audit` is written by the site's own generator and stays writable by its role. About 0.23 GB together. |
| Views and functions | `v_active_plan`, `v_planner_trigger_health`, `v_daily_plan_archive_self_check`, `v_data_trust_ledger`, `fn_planner_scorecard`, `v_planner_performance`, `mv_daily_kpi`, `v_forecast_plan_outcome_mart`, `v_plan_tactical_outcome_daily`; `fn_band_timeline` with its signature and its whole return type (all 56 columns, with their names, types and order); `mv_band_curve` and `v_band_curve` with all thirteen columns (`ts`, `greenhouse_id`, `temp_low`, `temp_target`, `temp_high`, `vpd_low`, `vpd_target`, `vpd_high`, `vpd_target_center`, `vpd_target_south`, `vpd_target_west`, `vpd_target_east`, `solar_phase`); the publisher's and Grafana's projections of these objects from migrations 268 and 309 | Generators, the evidence route or embedded panels read them by name. The Grafana wrapper of migration 268 selects * from `fn_band_timeline` into a fixed row type, and its projection of `v_band_curve` names all thirteen columns. `fn_band_timeline` and `mv_band_curve` are redefined on the house curve and keep every column; a column with no source is filled from the generated constants or the house curve, or left NULL. |
| Store rows | The 8 target-curve rows of the house band in `crop_band_anchors` | `mv_band_curve` draws them on the site's home page. The controller and the dispatcher stop reading them in phase 4 (decision 6). |
| Columns | Every column of `climate`, `daily_summary`, `climate_action_log`, `setpoint_snapshot` and `system_state` that a projection of migration 268 or 309 names | Dropping one breaks the projection and every generator that reads the table. A column that is no longer filled falls under rule 3. |
| Dashboards | The uids and the shared panel ids of the twenty dashboards in the share manifest: `site-home`, `site-climate`, `site-climate-lighting`, `site-evidence-operations`, `site-evidence-planning-quality`, `site-evidence-economics`, `site-intelligence`, `site-intelligence-planning`, `site-greenhouse-crops`, `site-greenhouse-zones`, `site-greenhouse-equipment`, `site-irrigation` and `greenhouse-weather`, seen on the live pages, and `site-climate-controller`, `site-climate-cooling`, `site-climate-heating`, `site-climate-humidity`, `site-climate-water`, `site-evidence-dashboards` and `site-intelligence-data` | The site embeds them through public-dashboard tokens bound to each uid, and the site's build and the API's proxy accept only panels in the manifest. A panel's query is repointed where an object changes; no shared panel is removed. |
| API | `GET /api/v1/public/evidence-snapshot` with its keys and its `metric_semantics.contract_version` of 3; the public routes the pages link (`home-metrics`, `data-health`, `scorecard`, `contact`); the embed routes `GET /api/public/dashboards/{token}` and `/render/d-solo/{uid}/{slug}` with `verdify_public/grafana_public.py` and `grafana_catalog.json` | A publisher step fetches the first and fails on an error. Its experiment readers fail closed, so they report "unavailable" once the experiment tables go; a test against a replay of the migrations confirms that before the drop. |
| Code | `CLIMATE_INTENT_FIELD_DOCS` in `verdify_schemas/climate_intent.py`; `PLAN_REQUIRED_PARAMS` in `mcp/server.py`, which stays assigned as `TIER1_REG` or a literal; the names the AI tunables generator imports: `PLANNER_PUSHABLE_REG`, `REGISTRY`, `TIER1_REG`, `TUNABLE_CONTRACT_CLASSES_REG` and `TunableDef` from the registry, `HELP`, `ALL_TUNABLES` (kept a subset of `REGISTRY`) and `DB_DSN` in `ingestor/config.py`; `verdify_schemas/fixed_panel_native_route.py`, `physical_crop_band.py` and `route_only_crop_band_reader.py` | The site's generators and the evidence route import or parse them, and their tests run in CI. About 570 lines of schema modules stay for this reason alone. |
| Release pin | The publisher's image is not advanced during the refactor unless the generators' tests pass on the new source | The image bundles the schemas, the MCP server and the firmware files that the generators read. |

**What goes quiet on the site, and when.**

| Step | Effect on the public site |
|---|---|
| Phase 0, the band edit | The band shown follows the edit, as after any band edit. |
| Phase 1 | Run-time and cycle figures change where lost off events are repaired (#1668). |
| Phase 3, the law | The mode shown is derived from the relays (section 11.1). The mister, override and mode-reason lanes of `site-climate` 19 change, and the AI tunables page's override counts stop. Plans are still written and shown, and no longer steer the climate. |
| Retiring the experiment platform | The experiment evidence rows of the planning-quality page read "unavailable". The shared panels `site-intelligence-planning` 120 to 125 and `site-evidence-planning-quality` 21 and 22 are repointed or report nothing. |
| Phase 4 | The mode-era panels of the operations and climate pages (`site-evidence-operations` 4 and 19 to 21, `site-climate` 19 and 130 to 132) show nothing new. The band panels follow the one house curve. The forecast page's deviation list stops (#1653), the AI tunables page's clamp and dispatch evidence stops, and the operations page's "Active controller mode" card keeps the last mode label, which is stale. |
| The release of packages 4.2 and 5.1 | The daily plan pages, the plans index, the active plan, the plan age, the last plans, the plan-outcome panels and the 30-day plan-outcomes file get no new content. The trigger matrix ends in the same release, so no trigger waits for a plan and the data-health card does not report a failure. The AI tunables page and the hand-written pages about the planning loop describe a write surface that no longer exists. |

**Checks.** Every change of phase 4 and phase 5 runs the site's generators and the queries of the embedded panels against a replay of the migrations in CI, and a publisher run is watched after each production sync. The review writes its record to a table of its own, not to `plan_journal`, because the embedded panels `site-intelligence-planning` 5 and 10 and `site-evidence-planning-quality` 18 and 19, `v_forecast_plan_outcome_mart` (panels 13 and 14 and the 30-day file) and `scripts/generate-baseline-vs-iris-page.py` read every `plan_journal` row whatever its prefix. Not verified for this plan: the hand-written page sources, which are kept in object storage and not in this repository, and what the two linked routes `home-metrics` and `data-health` read; both are checked before the first deletion of phase 4.

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
| Thresholds shown on graphs | `fn_band_timeline` re-derives firmware thresholds in SQL (56 columns) | The band edges plus the offsets from the generated constants |
| Compliance | One official function and four readers that disagree with it (review section 8.3) | `fn_band_compliance_5m` only. It grades the signal the law controls on, against the band the host computes. The controller's own band is compared with that in an alert, so a clock fault shows as a fault and not as a silently shifted band. |
| Gas | 0.75 therm an hour typed in more than one place | `resource_coefficients`, which the daily record already reads |
| Delivery confirmation | Three mechanisms | One, for every pushed value (section 8.3) |
| Clock validity | One flag, read by climate, lighting and irrigation | Two on purpose: a trust flag for the band's clock, and the existing flag that lighting and irrigation keep (section 4.9) |
| Names and units | The same quantity under several names (`temp_low`, `target_temp_low_f`, a band role name) | One name per quantity in every layer; F and kPa |
| Documents | Seven control documents, several describing removed designs | One (section 8.6) |

## 10. Measuring cycles, run time and utilities

Constraints 3, 4 and 8 are stated in quantities the system does not record reliably today: the controller counts starts and run time per relay but clears the counts at midnight and loses them on a reboot, the host rebuilds them from events and some off events are lost (issue #1668), gas is not metered, and nothing meters drying.

1. **Counters on the controller.** For each relay, a running count of starts and of on-seconds, saved to flash hourly and never reset. The host takes daily differences. This replaces rebuilding from events.
2. **Utilities.** Electricity from the existing power meters; water from the existing flow meter; gas as furnace hours times the coefficient in `resource_coefficients`. Gas is not metered and no meter is fitted; the coefficient is checked once against a winter bill (decision 14).
3. **The drying meter** of section 4.5: hours, water and heat carried out, the reason drying was refused, and furnace starts within 15 minutes of a drying run.
4. **One daily record.** The existing `daily_summary` row already holds cycles and run time per relay and estimated kWh and therms. It gains the drying figures, both in band, and whether the night was dried.
5. **One page** that shows those numbers by day with 7-day and 30-day means.
6. **One alert:** a relay's starts above twice its 30-day median on two consecutive days.
7. **A baseline before the law.** The same record, backfilled over the 30 days before the first write of phase 0 on today's firmware (section 11.5), so that the law's acceptance compares measured with measured.

## 11. Delivery sequence

Firmware has no build or release timing gate in this repository, so the plan gives an order, not dates.

### 11.1 Phases

| Phase | Content | Changes the behaviour of | Rollback |
|---|---|---|---|
| 0. Now, no firmware | The five operator settings of review step 1 (issue #1673, decision 16), written by the coordinator under the delegation (section 11.5); they simulate at 78.3 / 69.7 % against 70.5 / 59.6 %. The nightly CronJob that fails from 2026-11-16, because migration 309 dropped a table it reads (issue #1634). Band 2 (decision 9), entered in the band editor the same day. The steps of both writes are in appendix D. | Settings and the band on today's firmware | Set the values back |
| 1. Measure (host only) | The daily record of section 10 from relay events, with the lost off events fixed (#1668); the one compliance definition (#1667); the heater-without-power alert (#1637); the delivery stall page (#1636); the clock difference alert (#1638, host part); the moisture source (#1669); the intake probe compared with the weather station; how often Iris writes irrigation, by trigger (section 7). Also the host side of what the later firmware publishes, which is additive: entity-map entries and storage for the relay counters, the clock trust flag, the band source, the constants hash, the state record and the drying meter, and the registry row, the push and the editor field of the drying cost limit, with its default of 0.7 kWh per kg, its range of 0 to 1.5 and the rule that only the owner writes it (sections 4.5 and 8.3). The push of the limit and its confirmation apply only once the controller publishes the limit's readback, so the builds before the law, and a rollback to them, raise no delivery alert. The baseline is the same daily record backfilled over the 30 days before the first write of phase 0 (section 11.5). | Nothing on the controller | Previous pins |
| 2. Firmware: running alone | No reboot on WiFi loss (decision 22); the trust flag for the band's clock; the no-clock corridor with fog allowed; the intake probe as second outdoor source with its own age stamp, and an age test on the cold-vent guard; no substituted sensor values (#1643), the case sensor's offset and the state for no indoor reading (decision 7, with the manual overrides effective in it); persisted fan run seconds, relay counters and the water budget; relays available at boot; one restart rule for a silent sensor bus; and the change that is merged but not yet flashed (#1644). The irrigation engine is not edited (section 11.5). The new logic lives in the firmware library, where host tests can run it. The control logic is otherwise today's. | The controller in degraded conditions only | Signed flash of the last-good build |
| 3. Firmware: the law | Before the flash: the band editor's width and night-floor checks (section 4.1). The flash: `climate_law.h` replaces the mode decision, with the controller's band check. The relay layer is reduced. The irrigation glue is re-pointed (section 8.7). The state record and the drying meter are added. Everything the host reads today is still published (below), and the old climate settings and readbacks stay on the wire and do nothing, so the flash needs no host change: the host side shipped in phase 1. | Climate control | Signed flash of the phase 2 build, which stays the last-good build until phase 4 starts |
| 4. Delete | Host first: every reader moves to the law's state record (the OTA gate, the smoke and liveness checks, the alerts, the dashboard, the brief). Then firmware: the legacy fields, the inert settings, readbacks and structs, the policy engine. Host: the planner's write surface (in one release with the reviewer, package 5.1), the dispatcher's plan reading, guardrail and defaults, the forecast engine. Database: the drops in the order of section 8.4, one migration per release with an archive dump first. Everything the public site reads is held back (section 8.10). | Nothing on the control path: everything deleted is inert by then. On the public site the mode-era panels show nothing new, and from the release of packages 4.2 and 5.1 the plan pages get no new content (section 8.10). | Host: previous pins. Firmware: a signed flash of the law's build from before the deletions. Dropped tables: only from that release's archive dump (decision 18). The firmware from before the law is no longer a target. |
| 5. Reviewer and documents | The planner becomes the reviewer (section 7). The control documents are replaced (section 8.6). The reviewer ships in one release with the removal of the planner's write surface and the end of the trigger matrix, so no trigger waits for a plan (packages 4.2 and 5.1); the site's plan pages get no new content from then on (section 8.10). | The planner; what the public site shows of plans | Previous pins |
| Later, when the owner takes up the public site | What section 8.10 holds back: seven tables, the plan and scoring views, the 8 target rows of the store, the mode-era columns and about 570 lines of schema modules. | The public site | - |

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
- The two target curves keep being published until phase 4 removes them with their readers (decision 6).

Order rules:

- Phase 3 keeps the wire contract in both directions, so that going back is one flash, the single device writer does not change in the same step as the control law, and the OTA gate passes for the law build and for the rollback build.
- The host stops pushing climate settings (phase 4) only after the law build is the last-good build. After that the pre-law firmware is no longer a rollback target, because without the pushes it would run on boot values.
- In phase 4 a reader moves before what it reads goes: host readers before the firmware drops a field, and code before the migration that drops an object. The action vocabulary in `climate_intent.py` and the gate's two checks (the action proof and the outdoor freshness) are the last to go.
- Anything the host must know about a new firmware output ships before the firmware that publishes it.
- Removing the experiment code and ledgers (#1649, #1635, #1657) and the idle planner (#1652) does not depend on the law. Decisions 17 and 18 are taken, so it can start at once, with the drop rules of section 8.4 and the exclusions of section 8.10.
- In phase 4 the registry and the dispatcher stop pushing a setting, by a sync, before the flash that removes it.
- Phase 4 is the point of no return for the firmware from before the law (the last row of the table). The coordinator starts it after the functional acceptance of the law (decision 21, section 11.5).

### 11.2 The interim question

Decided on 2026-11-15: the work goes straight to the law (decision 3). The review's step 2, a small patch to today's firmware (issues #1639, #1640, #1674, #1675) that simulates at 85.6 / 82.6 %, is not shipped; it changes code that phase 3 deletes. Until the law is flashed the house runs today's firmware with phase 2, on band 2 once it is entered, and with the review's five settings (decisions 9 and 16).

### 11.3 The filed issues under this plan

Epic #1633 and its 43 children were filed from the review on 2026-11-15; all are open and none has been touched since. "Stands" means the issue's change is right as filed; where its body still refers to the patch release that decision 3 cancelled, that reference is removed. The issue bodies cite the review's decision numbers, which are not the numbers of section 12.

| Issue | Subject | Under this plan |
|---|---|---|
| #1633 | Epic | Amend: the phases and the package order of section 11.4 replace its step list; its target state follows decisions 3 and 4; the superseded issues get their own group |
| #1634 | Winter-feasibility CronJob fails nightly | Stands; phase 0. Not delivered by the merge of #1677, which changed another job |
| #1635 | Native-panel ledger | Stands with the drop rules of section 8.4 and the exclusions of section 8.10; does not wait for the law |
| #1636 | Setpoint delivery stall page | Amend: one confirmation for every pushed value, lighting included; its alert on undelivered plans is interim, because plans end in phase 5; phase 1 |
| #1637 | Electric heater: no heat for 209 days | Stands; phase 1; matters more under constraint 5 |
| #1638 | Controller clock wrong for 87 days | Amend: the trust flag is for the band's clock only (section 4.9), SNTP is the only time source and the WiFi timeout goes to 0 (decisions 8 and 22); phases 1 and 2 |
| #1639 | Furnace thresholds | Superseded by rule 2 (same thresholds); closes into #1671 |
| #1640 | Fog threshold mismatch | Superseded by rule 5; closes into #1671 |
| #1641 | Mister duty cap and water budget | Amend: the budget stays, set at 300 gallons and kept across a restart from phase 2, package 2.1 (decision 11); the duty cap goes with the mister state machine |
| #1642 | Boot defaults differ from production | Amend: the ROM band stays as it is; the other climate boot defaults disappear with the constants; lighting's boot values are not changed |
| #1643 | Substituted 65 F / 50 % | Amend: no substituted values, the case sensor less its offset, and the state for no indoor reading of decision 7, which replaces its "all relays off", built as ratified with the manual overrides effective (section 11.5); phase 2 |
| #1644 | Controller firmware behind main | Amend: what is merged and not flashed ships in the phase 2 build; phase 2 |
| #1645 | Wall drip timing | Stands; irrigation, the owner's choice, outside this plan |
| #1646 | The planner's role | Amend: decided (decision 4); section 7, with the limit on `set_setting` and the irrigation tools' ties to the plan cycle; the plan-writing tools go in the release of packages 4.2 and 5.1; the plan tables are held back (section 8.10) |
| #1647 | Delete the legacy mode cascade | Amend: add the firmware tests and CI gates of section 8.1; the cascade goes when the law replaces the mode decision, so the replay shows divergence by design; phase 3 |
| #1648 | Delete 26 inert `Setpoints` fields | Amend: the whole struct goes; phase 4 |
| #1649 | Retire experiment generations 1 and 2 | Amend: the planner study goes with it; scope notes of section 8.7, drop rules of section 8.4, exclusions of section 8.10; does not wait for the law |
| #1650 | Remove the policy-vector engine | Stands with the scope notes of sections 8.7 and 8.8; phase 4 |
| #1651 | Publish and store only what can change | Amend: climate constants are compiled; lighting and the water budget are excluded; phase 4 |
| #1652 | Retire the idle planner | Stands; does not wait for the law. The idle planner and its shadow copy are retired without a further go (section 11.5) |
| #1653 | Remove the forecast-action engine | Stands, now with the evidence of section 6; its two log tables are held back (section 8.10); phase 4 |
| #1654 | VPD-high guardrail | Amend: removed, nothing left to clamp; `setpoint_clamps` is held back (section 8.10); phase 4 |
| #1655 | Retired irrigation code | Stands with the scope notes of section 8.7; add the question of whether `v_irrigation_schedule_current` is still needed |
| #1656 | Small dead paths | Stands with the scope notes of sections 8.7 and 8.8 |
| #1657 | Digital twin | Stands; does not wait for the law |
| #1658 | Irrigation engine | Stands; irrigation, outside this plan |
| #1659 | Planner feedback loop | Amend: the reviewer reads compliance and utilities; the scoring names the public site reads are held back (section 8.10); phase 5 |
| #1660 | Planner runs | Amend: one review a day and the manual trigger; nothing in irrigation wakes the planner (section 7); phase 5 |
| #1661 | No token or cost record | Stands, smaller; phase 5 |
| #1662 | Store readbacks on change | Stands with the scope notes of sections 8.7 and 8.8; phase 4 |
| #1663 | One band curve and one store | Amend: 16 anchors on the controller, one season and growth stage, lighting path unconditional and tested, the desired-state overlay kept; the 8 target rows and the band views' columns are held back (section 8.10); phase 4 |
| #1664 | Alert volume | Amend: the alert list of section 8.3, changed in the monitoring lane; phases 1 and 4 |
| #1665 | Stale band columns in the action log | Amend: replaced by the law's state record with a heartbeat row; no column is dropped (section 8.10); phases 3 and 4 |
| #1666 | Frozen and dead channels | Stands with the scope note of section 8.8; its look at the north probe on site is not part of this plan |
| #1667 | Compliance reporting | Stands; phase 1 |
| #1668 | Run-time and water records | Amend: section 10; phases 1 and 2 |
| #1669 | Moisture source not measured | Stands; it is the largest uncertainty in section 5 and it tunes the default of the drying cost limit |
| #1670 | Furnace saturation | Stands; outside the sequence (risk 6) |
| #1671 | Two-axis band controller | Amend: becomes the law issue. Section 4, the hold list and the input table of section 8.7 replace its specification, with decisions 2, 5, 12, 13 and 20, the defaults of section 11.5 and the declared change of rule 8; its acceptance is section 13; phase 3 |
| #1672 | Control documents | Amend: add the decision record for the law and the changes to ADR-0004, ADR-0006, ADR-0009 and ADR-0010 (section 8.6); phase 5 |
| #1673 | Five operator settings | Amend: decided (decision 16), written by the coordinator under the delegation by the steps of appendix D, on the same day as band 2; its sixth write to the night bias is dropped; phase 0 |
| #1674 | Night dry-out | Superseded by rule 7; closes into #1671 |
| #1675 | Dry-out forces the electric heater off | Superseded by rule 7; closes into #1671 |
| #1676 | Overnight dry-out goal | Amend: decided by decisions 1, 9 and 10; its three options are replaced by them |

New issues this plan needs:

1. Firmware phase 2: running alone.
2. The constants file and its generated outputs, with the CI check on literals.
3. The drying meter and the daily cycles and utilities record on the controller's counters.
4. Remove the planner's climate write surface end to end, with the agent limit on `set_setting`.
5. Delete what the law replaced, in firmware, registry and dispatcher, including the per-zone mister curves.
6. The law's host side: the entity-map entries and the drying cost limit's row, push and editor field (before the flashes); then the state record, the OTA gate and the health checks, `fn_band_timeline`, `fn_house_vpd_control_band`, one delivery confirmation.
7. The database drop sequence: the login checks, the irrigation schedule view, the boundary digest and a check against a migration replay, with section 8.10 as its exclusion list.
8. The dashboard, brief and Grafana readers of removed objects, with the public site's embedded panels kept.
9. Firmware tests and CI gates for the law.
10. The intake probe compared with the weather station for a season.
11. The archive of the dropped history (decision 18): the dumps and their checksums here, and their custody in the storage lane.
12. Band validity: the editor's width and night-floor checks (before the law) and the controller's band check (with the law).
13. Band 2: the three edits to the served house band (decision 9), written on the same day as the five settings.
14. Deferred: the hold-back on the electric heater's lines while the sun is on the house (decision 15), to be decided after the law is accepted.

Three belong to other lanes and are drafted for those lanes: the alert rules (monitoring), the custody of the archive (storage) and the window for the isolation tests of phase 2 (network).

Not filed: a clock chip (decision 8) and anything for the public site (decision 19).

The amendments and the new issues are applied to GitHub under the delegation (section 11.5). Filed issues that quote the review's simulated figures for today's firmware are restated on the corrected baseline when the edits are made.


### 11.4 Execution

**How the work runs.** Each package below is one issue and one or more pull requests to `main`. A merge changes Git only. Production changes in three ways: a sync of the production application (the device-write gate), a digest pin of the dashboard, and a signed flash of the controller, all as `AGENTS.md` describes them. Since 2026-11-16 the coordinator makes each of them, and the two writes of phase 0, under the owner's delegation (section 11.5). An issue is closed by a verifier against its acceptance, live, and not by the lane that did the work. Simulation, firmware compiles and wide test runs go to the CI runners.

**The order.** Packages in the same phase can run side by side unless the table says otherwise. "Sync" is a full sync of the production application with prune off.

| # | Package | Issue | Needs first | Reaches production by | Done when |
|---|---|---|---|---|---|
| 0.1 | The five settings | #1673 | - | The coordinator's five writes, each a manual value (appendix D.1) | The five readbacks hold and the holds are active |
| 0.2 | The failing nightly job | #1634 | - | Pull request that suspends the CronJob, sync | The live CronJob reads `suspend: true` and no new Job fails |
| 0.3 | Band 2 | New 13 | 0.1, the same day | The coordinator's edit in the band editor (appendix D.2) | The eight readbacks hold; the day of the edit is left out of every comparison |
| 1.1 | The daily record of cycles, run time and utilities, with lost off events repaired | #1668, new 3 | - | Migration, ingestor, sync | The record matches the power meters and the flow meter for a week |
| 1.2 | One compliance definition | #1667 | - | Migration, sync | Every reader gives the figure of `fn_band_compliance_5m` |
| 1.3 | Alerts: heater on without power, delivery stalled, the controller's clock | #1637, #1636, #1638 (host part), #1664 | - | Rules in the monitoring lane; ingestor, sync | Each alert fires in a test and stays quiet on a normal day |
| 1.4 | Measurements: the moisture source, the intake probe against the weather station, Iris's irrigation writes by trigger | #1669, new 10, #1646 | - | Queries and one report each; no production change | Each has a figure with its uncertainty |
| 1.5 | The host side of what the later firmware publishes, and the drying cost limit's row, push and editor field | New 6 | - | Schemas, ingestor, dashboard; sync and dashboard pin | The host accepts the new entities from a test client; the limit shows on the dashboard and is not pushed until the controller reports it |
| 1.6 | Band validity: the editor's width and night-floor checks | New 12 | 1.7 | API and dashboard; sync and dashboard pin | The editor refuses a band that is too narrow or whose drying line falls under the floor, and accepts today's band and band 2 |
| 1.7 | The constants file and its generated outputs, with the CI check on literals | New 2 | - | Pull request only | CI fails on a stale generated file and on a typed literal |
| 1.8 | The baseline | #1668 | 1.1, 1.2 | - | The daily record backfilled over the 30 days before the first write of phase 0, on today's firmware, band and settings (section 11.5) |
| 2.1 | Firmware, running alone: the logic in the firmware library with host tests; the water budget kept across a restart | New 1, #1643, #1638, #1644, #1641 | - | Pull requests; CI compile | Host tests pass for the trust flag, the corridor, the outdoor source order, the case sensor alone and no indoor reading (the state of decision 7, with the manual overrides effective) |
| 2.2 | The flash of the phase 2 build, and the two tests on the controller | New 1 | 2.1; 1.5; a window in the network lane | Sync of 1.5 first, then signed flash | Section 13, phase 2; the build becomes last-good |
| 3.1 | The law in the firmware library, the controller's band check, its tests and CI gates, the closed-loop simulation in CI | #1671, new 9, new 12, #1647 | 1.7 | Pull requests; CI | Section 13, phase 3, the tests |
| 3.2 | The compiled values for irrigation and lighting | #1671 | - | With 3.1 | The list in the build equals appendix E |
| 3.3 | The flash of the law, and its functional acceptance | #1671 | 1.5, 1.6, 1.8, 2.2, 3.1, 3.2 | Signed flash | Section 13, phase 3: the functional acceptance at the flash; the seven-day read is reported afterwards |
| 4.0 | The start of phase 4 | - | 3.3 | - | Decision 21; the seven-day read and a cold snap are not waited for (section 11.5) |
| 4.1 | Host readers move to the law's state record | New 6, new 8, #1665 | 4.0 | Sync and dashboard pin | The OTA gate, the smoke and liveness checks, the alerts, the dashboard and the brief pass on the state record |
| 4.2 | The planner's climate write surface (`set_plan`, `set_tunable`, the plan-writing prompt), the dispatcher's plan reading, the guardrail, the forecast engine, the release of the three phase 0 pins, small dead paths | New 4, #1646, #1654, #1653, #1656 | 4.1 | Sync, in one release with 5.1 | No climate value is written by an agent; an agent's write to a band row or the limit is refused |
| 4.3 | Firmware: the inert settings, readbacks, structs, the policy engine, the anchor keys from 56 to 18 and the target curves, the boot defaults, the retired irrigation code, the dead channels | New 5, #1648, #1650, #1651, #1663 (firmware part), #1642, #1655, #1666 | 4.2 | Sync (the registry and the dispatcher stop pushing what the flash removes), then signed flash | The controller's readback list equals the registry |
| 4.4 | Readbacks and state stored on change; one band store | #1662, #1663 | 4.3 | Migration, sync | Irrigation and lighting checks pass; the site's generators pass |
| 4.5 | The database drops, each with its archive | New 7, new 11 | The code release that removes the readers | One migration per release, sync | The services start and pass their login checks; the archive's checksum is recorded |
| 5.1 | The planner becomes the reviewer, with its own record table | #1659, #1660, #1661 | 4.1; ships in one release with 4.2 | Planner image, sync | The first daily review is written and verified, with no climate write; the later reviews are reported |
| 5.2 | The control documents and the decision record | #1672 | 3.3 | Pull request | One control document; the old ones marked as history |
| X.1 | The experiment platform: ledger, generations 1 and 2, the digital twin | #1635, #1649, #1657 | - | Pull requests, sync, then its own drops under the rules of 4.5 (one migration per release with its archive); they do not wait for 4.0 | The deployments are gone; the public evidence route still answers |
| X.2 | The idle second planner, with its shadow copy | #1652 | - | Pull request, sync | The deployment and its tables are gone |

Packages 4.2 and 5.1 are one release: the plan-writing tools go when the reviewer starts and the trigger matrix ends, so no trigger is left waiting for a plan (section 8.10). Issue #1676 is answered by decisions 1, 9 and 10 and needs no package of its own. Outside the sequence: #1645 and #1658 (irrigation), the on-site look of #1666, and #1670 (the furnace's capacity in deep cold, risk 6).

**What can start at once.** Packages 0.1 to 0.3, 1.1 to 1.5, 1.7, 2.1, X.1 and X.2 need nothing else; 1.6 and 1.8 follow the column "Needs first".

**Removed workloads.** The production application syncs with prune off, so removing a manifest does not delete the live object. A pull request that removes a workload lists the exact live objects (kind and name), and the coordinator deletes them after the sync.

**What stops a step.** A step that would change something on the public site beyond section 8.10's list stops and is reported to the coordinator. So does a step that would change what irrigation or lighting does, other than the changes named in sections 8.7 and 8.8.

### 11.5 Execution under the delegation of 2026-11-16

On 2026-11-16, after ratifying this plan, the owner delegated its execution to the coordinator of the agent sessions and asked for speed: "minimize holds, waits, soaks ... accepting associated risks". This section records what that changes. Where another part of this plan still names the owner for a production step, this section wins. His design decisions (section 12.1) are unchanged. Nothing here says that a step has been made: the state of each step is in its issue.

**Who makes each production step.** The coordinator makes every production step of section 11.4: the merges, the release pins, the syncs of the production application, the dashboard pins and the signed flashes of the controller. It also makes the two writes of phase 0, the five settings and band 2, each recorded as a manual value with the delegation as its reason (appendix D). It also applies the issue amendments and the new issues of section 11.3. The lanes, agent sessions under the coordinator, write code and pull requests and never change production. An issue is still closed by a verifier against its live acceptance. Still in force: no hardware work, lab.verdify.ai out of scope, irrigation and lighting as they are except the changes declared in sections 8.7 and 8.8, the ten constraints, and every rule of `AGENTS.md`.

**Waits that are cut, and what each gives up.**

| Wait in the ratified plan | Now | What is given up |
|---|---|---|
| 14 nights between the five settings and band 2 | None: both are written the same day | The effect of the settings and that of band 2 can no longer be told apart on the house; only their sum is measured. |
| A 14-day baseline on today's firmware, collected forward (package 1.8) | The daily record backfilled over the 30 days before the first write of phase 0 | The baseline is rebuilt from relay events with the lost off events repaired, not from the controller's counters, and it is on today's band and settings. The ratio of measured to simulated still comes from it, and the acceptance still simulates both controllers on the band that is live. |
| Seven days on the controller before the law is accepted | A functional acceptance at the flash (section 13); the seven-day read is reported afterwards and does not gate phase 4 | Phase 4 can start before the law's measured gates are known. If the seven-day read fails after phase 4 has begun, the fix is a new law build, because the firmware from before the law is then no longer a rollback target (decision 21). |
| One cold snap under the law before phase 4 | Not waited for | The law's heating lines may meet their first deep-cold night after the point of no return. |
| 14 daily reviews before phase 5 closes | The first review is verified; the rest are reported | A reviewer that fails after its first day is found by the missed-review alert, not by the acceptance. |

Nothing else in section 13 is dropped: the tests, the CI gates, the OTA gate, the live readbacks and the rules to go back at once stay.

**Defaults built on.** Where the ratification left a point to the owner, it is built as follows. He can overrule any of them; a change after the build is a new release.

1. *Decision 7, no valid indoor reading:* built as ratified. With fresh outdoor air at or above the band's lowest low-edge anchor (60.7 F today; derived from the band, never a literal): vent open and the lead fan on, heaters off. Colder: vent closed, electric heater on, furnace off. With no fresh outdoor reading either: every relay off. The fogger and misters are off in every case, and a critical alert is raised. This replaces the "all relays off" recorded on issue #1296 on 2026-11-04. In this state the manual overrides of the fans, the vent and the fogger stay effective; none exists for the heaters.
2. *The irrigation engine's day rollover without a clock:* not built, and the engine is not edited. The limit at the end of section 4.9 stands as an accepted consequence.
3. *The values compiled for irrigation and lighting (decision 13, appendix E):* the value the controller held most over the 30 days before 2026-11-16. Mister pulse 30 s and gap 60 s (the simulator ran 60 s and 45 s); VPD emergency 2.5 kPa; dew-point margin for wetting 8 F, with no night test; mister line minimum off 45 s; zone ranks centre 1, south 2, west 3, east 4; outdoor data maximum age 600 s; protection limits 100 F and 40 F, which are also the boot values.
4. *Decision 5, the longer pulse:* built as ratified. The longer-pulse test stays and reads the house band's high edge. There is one mister stage. A pulse is the plain pulse length, times 1.4 while the zone's VPD is above 1.2 times the band's high VPD edge; 1.4 is the median and the value held most of `mister_vpd_weight` over the 30 days (1.39). The fairness rule of section 4.8 stays.
5. *The experiment platform (package X.1) and the idle second planner (package X.2)* are retired without a further go.

**Corrections from the review of this plan.** Independent reviews of this plan found errors in it, and the coordinator ruled on the contested ones. Each correction is written into the section it concerns. Those that change what is built:

- At the 100 F limit the misters keep following rule 6, which is a declared change (section 4.2, rule 8).
- The irrigation engine's inputs keep today's terms, and only fog is exempt from the holds at the 100 F limit (section 8.7).
- A soft reset keeps the clock, so the band trusts the clock only after a time server has answered since the last boot, while irrigation and lighting keep their own tests (section 4.9).
- Every object, column, dashboard and shared panel the public site reads is kept whole, and the reviewer writes its record to its own table (sections 7 and 8.10).
- The planner's plan-writing tools go in the same release as the reviewer and the end of the trigger matrix (section 11.4).
- The host side of a firmware output is synced before the flash that publishes it, and a sync stops a push before the flash that removes the setting (section 11.4).

## 12. Decisions

Every decision this plan needs is taken, except two points the ratification did not settle, which are built on defaults (below). The owner answered four on 2026-11-15 and ratified the rest on 2026-11-16, in his words: "I agree with all of your recommendations, ratify them. One exception, I'm not doing hardware work (e.g., adding a clock chip). Leave lab.verdify.ai out of scope for now." Section 12.1 is the record, numbered as the text refers to it. Section 12.2 says what the exception and the change of scope alter. Later the same day he delegated execution to the coordinator (section 11.5). Two points the ratification did not settle, the reversal contained in decision 7 and the engine's day rollover without a clock, are built on defaults that he can overrule (section 11.5). Section 12.3 lists what stays with him. Nothing in this section has been applied to the house: the record is of decisions, and each live write waits for its own step (section 11.4).

### 12.1 The record

| # | Decision | Decided | Why, and what follows | Phase |
|---|---|---|---|---|
| 1 | Drying with outdoor air: the cost limit | Above zero and set on the dashboard (2026-11-15). The default is 0.7 kWh of heat per kg of water, the range 0 to 1.5, with no daily cap (2026-11-16). | One price rule (section 4.5). A run starts at or above `low + 1.5` and stops below `low + 0.75`. Against never drying with outdoor air the default costs +0.03 / +0.20 therm, +0.9 / +1.6 kWh and +6 / +16 relay starts a day and holds the band 5.4 / 16.4 points more of the year. The rule of 2026-11-05 that gas never runs for humidity, and its 10 kWh nightly cap, are superseded. The owner can change the limit on the dashboard at any time, and the moisture measurement of phase 1 may move the default. | 1 and 3 |
| 2 | The heating lines: the furnace's swing and the electric heater's line above it | Furnace 0.5 / 3.0, electric heater 3.5 / 4.5, compiled. Looked at again when phase 3 has measured the furnace's starts. | It is the middle of a trade between furnace starts and energy. One step lower (furnace off at 2.5, heater 3.0 / 4.0): +2.1 / +2.9 furnace starts a day for -0.71 / -0.56 kWh and -0.05 / -0.04 therm. Two steps lower: +5.2 / +6.9 starts for -1.36 / -1.16 kWh and -0.10 / -0.08 therm. One step higher: -1.6 / -2.1 starts for +0.72 / +0.57 kWh and +0.06 / +0.05 therm. On band 2 the same three steps give +2.1 / +2.8, +5.0 / +6.9 and -1.6 / -2.0 furnace starts a day (section 5.7). The electric heater's lines alone trade electricity for gas and leave the starts as they are: 0.5 F lower with the furnace unchanged is -0.74 / -0.66 kWh for +0.03 / +0.03 therm and -0.2 / -0.1 point of compliance. That saves electricity by holding the house cooler and moves some heat to the furnace, which constraint 5 counts against it. If cycles count for more than utilities, that speaks for the lines as decided or one step higher. A stored offset for the whole heating stack was the alternative; it was not taken. The lines are compiled, so a change is a release. | 3 |
| 3 | Interim patch this winter, or straight to the law | Straight to the law (2026-11-15). | The review's step 2 patch is not shipped (section 11.2). Issues #1639, #1640, #1674 and #1675 are superseded by rules 2, 5 and 7. The small release of phase 2, running alone, still ships first: it does not change normal control and it is the rollback target of the law. | 2 and 3 |
| 4 | The planner's role, and how often Iris may act on irrigation | Agreed as recommended (2026-11-15). | A reviewer once a day with no climate writes. An agent's `set_setting` is limited to the operator switches. Iris keeps its irrigation tools and uses them in the review or on a manual trigger. `planner_lessons` stays as the reviewer's memory (section 7). What the public site shows of it is not part of this plan (decision 19). | 4 and 5 |
| 5 | Per-zone VPD curves for the misters | Removed. The irrigation engine's zone ranking is fed from the house band and each zone's own VPD reading, with today's ranks compiled. | Only the centre mister ran in 95 days. It removes 24 anchors, 24 readbacks, four pushed values and a SQL function. It changes which zone is chosen when more than one line is opted in; that is the only change to how the engine picks a line (section 4.8). Two other tests read the per-zone targets today and read the house band's high edge afterwards: whether any zone is stressed (`firmware/greenhouse/controls.yaml:1142-1145`), and the longer pulse far above the target, which is kept with one mister stage (section 4.8, section 11.5). The other changes to the engine's inputs are listed in section 8.7. This follows the owner's ruling of 2026-11-15 that the served house band is the only band. | 3 |
| 6 | The two target curves (temperature and VPD) | Removed from the controller in phase 4. The 8 target rows stay in the store while the public site draws them (section 8.10) and go when decision 19 is reopened. | The law reads the four edges only and nothing else controls to the targets. Their host readers change in the same release: the band editor, `v_band_device_divergence`, the `house_band_drift` alert and the OTA gate, which requires target values today. | 4 |
| 7 | What the controller does with no indoor reading at all | It acts on the outdoor temperature. Fresh outdoor air at or above the band's lowest low-edge anchor (60.7 F today): vent open and the lead fan on, heaters off. Colder: vent closed, electric heater on, furnace off. No fresh outdoor reading either: every climate relay off. In every case the fogger and misters are off and a critical alert is raised, and the manual overrides of the fans, the fogger and the vent stay effective (no override exists for the heaters). Ratified on 2026-11-16. It reverses the disposition recorded on issue #1296 on 2026-11-04, when the owner said "Mark the missing thermostat as accepted" and the issue was closed "as is: no physical thermostat and no fail-warm firmware change". The recommendation did not say so. It is built as ratified under the delegation, and the owner can overrule it (section 11.5); phase 2 then builds issue #1643 as filed: no substituted values, and with no valid indoor reading every relay off, with the alert. | All relays off, the earlier recommendation, is wrong in both seasons if the state lasts: a closed house overheats in summer sun and cools in winter. The state is one fault away. The four wall probes, the case probe and the outdoor intake probe share one RS-485 bus with the soil probes and the light sensor (`firmware/greenhouse/hardware.yaml:262-296`), so a failed transceiver or a shorted cable leaves the controller with no indoor reading. Today, with every probe silent, it restarts once and then substitutes 65 F and 50 % and controls on them (`firmware/greenhouse/controls.yaml:243-246`, `2346-2359`): by night that calls for no furnace when the low edge is below 65 F, and by day, when the low edge is above it, it calls for heat with no reading; the sensor-fault state with every relay off is entered only when a reading it has fails the plausibility test (section 4.9). The outdoor rule uses the weather station's broadcast, so it needs the LAN. It rests on two facts: a ventilated house is not colder than the outdoor air, and the electric heater alone cannot lift the house more than about 6 F (1.44 kW against a loss of 0.233 kW per F). It is still wrong on a cool sunny day, when a closed house overheats, and it does not hold a deep winter night: only the furnace can, and the furnace does not run without a reading. That gap stays (section 12.2). It does not cover a controller that is hung or unpowered, and no hardware thermostat backs the controller; that was accepted on issue #1296 and is not reopened. | 2 |
| 8 | Battery clock chip on the controller | Declined: no hardware work (2026-11-16). The ruling D-IRP-25 of the dashboard programme stands: NTP only. | The plan had recommended the chip. Without it the controller takes its time from the two time servers on the LAN, and a clock kept across a reset is not trusted (section 4.9). What that leaves, and what this plan does about it without hardware, is in section 12.2. | - |
| 9 | Band edits from the price list, and dry winter air | Band 2, the three edits of section 5.7. Ratified to follow the 14 nights of decision 16; under the delegation it is written the same day as the five settings (section 11.5). The low temperature edge 2 F lower at solar noon and sunset: 73.8 to 71.8 F and 72.0 to 70.0 F. The high temperature edge 2 F higher there: 83.8 to 85.8 F and 82.0 to 84.0 F. The VPD high edge 0.10 kPa higher at every hour: its peak goes from 1.29 to 1.39 kPa. | The eight values are entered in the band editor on today's firmware (appendix D.2), by the coordinator under the delegation (section 11.5). The owner's check is the crop: under the law the hottest minute of the simulated year is 88.0 / 88.7 F on band 2 against 85.7 / 86.9 F on today's band, and today's firmware reaches 90.9 / 91.8 F on today's band; the daytime VPD may reach 1.39 kPa before the fogger starts. The third edit makes the acceptance of dry winter air of 2026-11-05 a standing one: at every hour it takes 28 / 8 gallons a day off the law's winter water (57 / 11 on today's band against 26 / 4 for today's firmware), where a larger edit at night alone takes 11 / 1. The ratified order, the band 14 nights after the settings, was meant to tell the two changes apart; written the same day, only their sum is measured (section 11.5). | 0 |
| 10 | The night floor of 0.74 kPa | The owner's definition is kept for the grade. The band editor checks the curve instead of the midnight anchor: the drying line (`vpd_low + 0.05`) at or above 0.74 kPa at every point of the night. No anchor changes. | Today's band passes, and so does band 2, which leaves the VPD low edge alone: the curve's lowest point is about 0.72 kPa, so the drying line there is about 0.77. The firmware's own compiled 0.74 goes with the dry-out machine, so the law has no floor of its own (constraint 2). | 3 |
| 11 | The soft daily water budget | An irrigation setting that the owner sets: 300 gallons a day, stored on the controller so that a restart keeps it. | It caps scheduled misting as well as climate pulses, and the dashboard shows it. The planner writes it today, between 100 and 300 gallons, and stops in phase 4. The law's simulated water use is 67 / 65 gallons a day, so at 300 the budget is a backstop and does not shape a normal day; the owner can set it lower if he wants it to. Today the value is not kept across a restart: it returns to its boot value until the host pushes it (`firmware/greenhouse/globals.yaml:1183-1186`). Against the 120 gallons the controller held on 2026-11-16, 300 lets scheduled misting and fog continue from 120 to 300 gallons on a day that reaches them. That, and the budget kept across a restart, which moves from phase 4 to phase 2, are changes to what irrigation does (section 8.7). | 2 and 4 |
| 12 | Fan in cold protection | No fan. | Today's firmware runs the lead fan with the vent closed at or below 40 F to mix the air. The law keeps "no fan without the vent open" without exception. That state has not occurred in the record. The decision assumes the gas furnace moves its own air; if it does not, the fan stays. | 3 |
| 13 | Fixed numbers compiled into the firmware | Accepted as constants. The values that irrigation and lighting read are compiled at what the controller holds, read as the value it held most over the 30 days before 2026-11-16 (appendix E, section 11.5). The owner can change any of them before the phase 3 flash, and any he wants to keep editable stays a stored setting. | Constraint 2 rules out exceptions. The law has none, but it has about 40 fixed numbers (section 4.4). The alternative is to keep them as settings, which brings back delivery, readback and boot defaults for values that the sweeps show are flat. Two qualifications. The heating lines are not flat: they are a trade (decision 2). The mister pulse and gap were not swept: the simulator runs one cadence, 60 s on and 45 s off, and the planner sets both today. The owner said that irrigation and lighting control remain, so the values they read are frozen at what the controller holds and not at this plan's defaults. Where the planner moves a value today, the list gives its spread over 30 days and proposes the value it held most. | 3 |
| 14 | Gas meter | None: no hardware work (2026-11-16). The furnace's rated input is checked once against a utility bill. | Therms are estimated from furnace hours at 0.75 therm an hour. One winter bill against the furnace hours of the same period tests that figure. It also tests the fitted share of the fuel that reaches the house, about 0.4, which is low for a furnace and may be an artefact of the fit; if it is, the simulated gas cost of drying is overstated. | After the first winter bill |
| 15 | A hold-back on the electric heater's lines while the sun is on the house or forecast (constraint 10) | Not in the first release. Decided after the law is accepted on the controller, with measured figures. If one is built, it starts with the present-sun form, which needs no forecast. | It is the one kind of rule in section 6 that saved electricity and run hours in simulation; its heater-only forms pay for that with gas. Lines 1 F lower while the sun is on the house: -0.6 / -0.7 kWh and -0.4 / -0.4 run hours a day, +0.03 / +0.04 therm. With 3 hours of forecast look-ahead: -0.9 / -0.9 kWh, -0.6 / -0.5 run hours, +0.04 / +0.04 therm. Both move heat from the electric heater to the furnace (constraint 5). With the look-ahead and the furnace's off line held down as well: -0.7 / -0.7 kWh, -0.04 / -0.04 therm and -0.6 / -0.4 run hours a day for +1.7 / +2.0 furnace starts (constraint 3). On band 2, whose daytime low edge is already 2 F lower, the present-sun form gives -0.4 / -0.6 kWh and +0.02 / +0.03 therm a day, and the look-ahead form -0.6 / -0.7 kWh and +0.03 / +0.03 therm (section 5.7). The figures assume the sun is known exactly. The present-sun form uses the light reading the controller already receives for lighting; the look-ahead adds one optional input, a "sun expected" flag from the host that expires by itself. Without either the law runs as specified. | After 3 |
| 16 | The review's five settings on today's firmware (issue #1673) | To be applied in one write. Ratified with 14 nights read before the band is edited; under the delegation the coordinator makes the five writes, each stored as a manual value with the delegation as its reason, on the same day as band 2 (section 11.5). Its steps are in appendix D.1. | They are a write to the live controller and its settings store. Two are the owner's own: the night dry-out pulse from 120 to 600 s and its rest from 780 to 300 s. Three pin values that the planner rewrites: fog escalation at 0.1 kPa, the wet-stress margin at 0.25 kPa and the water budget at 300 gallons; on 2026-11-16 the controller held 0.25 kPa, 0.05 kPa and 120 gallons. Simulated, they hold the band 78.3 / 69.7 % of the year against 70.5 / 59.6 %. With the band edits of decision 9 they are the two improvements to this winter's nights that need no code, and they are the larger: in winter 76 / 45 nights in a hundred dry out against 59 / 26 today and 66 / 31 with band 2 alone. They are undone by writing the old values back, and the nights after the write, read together with band 2's, are the first check of this simulator against the house. The three pins are released in phase 4. | 0 |
| 17 | Retiring the experiment platform | To be retired, without a further go (section 11.5): the orchestrator image, the ingestor's experiment workers, the policy-vector engine, the digital twin and their tables. It does not depend on the law. | Two generations of experiment machinery are deployed and switched off. Their three Deployments log only "inactive", and the experiment record was closed on 2026-09-30 (review section 8.2). They are 7,391 lines of the ingestor (21 %), 71 tables, about 2.9 GB and a policy engine in the control loop. The reference simulator stays as the way to test a control change before it is flashed. | Any time before 4 |
| 18 | The history that is dropped, and its archive | The drops are approved with an archive: one dump per migration, checksummed, kept on the NAS and offsite for two years in the storage lane's custody, and no soak. One plain row a minute stays in the action log as a heartbeat. | About 78 tables and 2.9 GB go in this plan: the 71 experiment tables, the idle planner tables and two rule tables. The seven plan and forecast tables that the public site reads, about 0.23 GB, are held back (section 8.10) and are dropped under the same rule when the site is taken up. After a drop that history exists only in the dump. Readbacks and the action log are stored on change from then on, which lowers the resolution of what is kept. | 4 |
| 19 | The public lab pages built from the plan | Deferred: lab.verdify.ai is out of scope (2026-11-16). This plan edits none of the site's files, generators or publisher, and keeps every object, column, route, dashboard and shared panel the site reads answering. Content changes where what it reports stops (section 8.10). | The earlier recommendation, one daily review page in place of the plan pages, is withdrawn until the owner reopens the question. What that means for the drops and for phase 5 is in section 12.2. | - |
| 20 | Fog and mist in a cold house | One guard, relative to the band: no fog or mist while the house is below the band's low temperature edge. It is part of rules 5 and 6. | Today's firmware refuses fog below 55 F and above 90 % relative humidity (section 4.10). The humidity test is redundant: fog starts only above the VPD high edge, and under today's band a house at 90 % cannot be there below 100 F. The temperature test is not redundant. A cold, dry house, which is what a heating failure in winter gives, would be fogged; fog cools it further and wets cold plants. The figures of this plan include the guard. Without it compliance changes by +0.02 / +0.02 point over the year and relay starts by -0.7 / -0.3 a day. It is an offset from a band edge, like every other line of the law, and not an exception of the kind constraint 2 rules out. The mister duty cap is not kept: the irrigation engine's soft budget and daily safety cap already bound the water. | 3 |
| 21 | The start of phase 4 | Ratified: phase 4 starts on the owner's word, after the acceptance report of section 13 and at least one cold snap under the law. Under the delegation the coordinator starts it after the functional acceptance at the flash, and no cold snap is waited for (section 11.5). | Once the host stops pushing the old climate settings, the firmware from before the law is no longer a rollback target: it would run on its boot values (section 11.1). Every step before that point is undone by a flash. | After 3 |
| 22 | The controller's restart when WiFi is lost | No restart: the timeout goes from 300 s to 0 in phase 2. This reverses the ruling D-IRP-27 of the dashboard programme ("Keep 300 s"), and the owner ratified the reversal. | Today the controller restarts every 300 s for as long as WiFi is down (`firmware/greenhouse.yaml:178`). Each restart switches every relay off, holds each one off for its minimum off time (heaters 180 s, fans 90 s, vent and fogger 60 s) and returns 117 of the 128 settings to their boot values (section 4.9). Under the law a restart costs less, but it still drops every relay and, with the LAN down, leaves the band without a trusted clock, so the controller would spend the outage on the flat corridor. That is the opposite of constraint 1. What the restart bought is the only automatic recovery from a stuck WiFi stack. Nothing takes its place: a stuck stack waits for a restart by hand, an accepted consequence (section 12.2). No WiFi outage of 300 s is in the record. | 2 |

### 12.2 What the owner's two changes alter

**No hardware work.** Nothing in this plan's work fits a part, moves a probe or needs a visit to the greenhouse. Two accepted consequences need a person there when they occur (items 3 and 4). Four things follow.

1. *No battery clock.* The controller takes the time from two time servers over the network, and with no restart on WiFi loss the clock keeps running through an outage. A soft reset (watchdog, panic, heap guard, the sensor-bus rule, the restart service, an OTA) keeps the ESP32's clock; only a power cut loses it. The band trusts the clock only after a time server has answered since the last boot. What is left is any boot after which neither server has answered: a restart during a LAN outage, the minutes after a site power cut, or a time-server fault while the LAN is up, as in the 87 days of issue #1638. For as long as that lasts the band serves the flat corridor of section 4.9 (60.7 to 83.8 F and 0.74 to 1.29 kPa today), which keeps the house safe and holds the band less well: a whole simulated year on the corridor is in the band 52.9 / 44.7 % of the time against 88.6 / 80.4 %, with 1.59 / 2.29 therms a day. The host's band-difference alert reports it. Irrigation and lighting keep their own clock tests: after a soft reset they run on the retained clock, including any step the reset gave it; after a power cut with no time server they wait, as today.
2. *The irrigation engine's water count without a clock.* After a power cut with no time server answering, the engine's daily water count does not start a new day, so after about three to five days the soft water budget and then the daily safety cap would hold the fogger and the misters (section 4.9). A day rollover that does not need the clock was proposed. It is not built and the engine's code is not changed (section 11.5), so the hold is an accepted consequence of this state. The changes to what irrigation does are the three that section 8.7 declares: the soft budget at 300 gallons and kept across a restart (decision 11), the dew-point margin compiled at 8 F (appendix E), and the misters at the 100 F limit (rule 8).
3. *No indoor reading on a deep winter night.* The temperature sensor of the clock chip was to be the last-resort indoor reading of decision 7. Without it the outdoor rule stands alone: on a cold night with every indoor sensor lost, the house is closed with the electric heater on and falls toward the outdoor temperature plus about 6 F. The controller raises a critical alert at once, and a person has to act at the greenhouse. In this state the manual overrides of the fans, the fogger and the vent stay effective: phase 2 exempts it from today's sensor-fault no-op and all-off lock. No override exists for the heaters (`firmware/lib/greenhouse_types.h:390`). This is an accepted risk. Today the same fault does no better: with every probe silent the controller restarts once and then controls on a substituted 65 F, which calls for no furnace on a night whose low edge is below that, and the sensor-fault state it enters on an implausible reading turns every relay off (section 4.9, issue #1296). A software-only way to narrow it exists, running the furnace for a share of each hour computed from the outdoor temperature; it runs gas with no temperature reading, it is not designed or simulated, and it is not in this plan.
4. *A stuck WiFi stack and unmetered gas.* With the restart on WiFi loss gone (decision 22), a controller whose WiFi stack is stuck keeps controlling the house and stays off the network until it is restarted by hand, an accepted consequence; the host's existing offline alert reports it. The plan had meant to test, on a bench, whether switching the radio off and on recovers a stuck stack. There is no bench controller, the test would have to be made on the live one, and a fault in such a change could leave the controller unreachable for a flash; so the timeout is the only change to WiFi handling. This drops the radio-cycle recovery that decision 22 included; the owner may ask for it to be tested on the live controller in a window of the network lane (section 12.3). No WiFi outage of 300 s is in the record. Gas stays estimated from furnace hours and is checked once against a winter bill (decision 14).

**lab.verdify.ai is out of scope.** This plan does not design, replace or edit anything on the public site.

1. *Nothing the site reads is dropped or broken.* The site's sources, its page generators and its publisher are not edited. Every database object, column, API route, dashboard and shared panel that the site's build or a page reads keeps answering; section 8.10 is the rule and the list, and it is an exclusion in the scope of every deletion. What is held back for the site alone goes only after the owner reopens decision 19: seven tables of about 0.23 GB, the plan and scoring views, the 8 target rows of the band store and about 570 lines of schema modules.
2. *What changes on the site anyway.* Content goes quiet where the thing it reports stops, and section 8.10 lists each case with its step. Through phase 3 the site shows what it shows today, except the changes section 8.10 lists for phases 1 and 3; the plans on it are still written, and from the flash of the law they no longer steer the climate. Retiring the experiment platform turns its evidence rows to "unavailable". Phase 4 ends the mode-era panels, and the release of packages 4.2 and 5.1, which ends plan writing and starts the reviewer, ends new plan pages.
3. *Phases 4 and 5 are where the site goes quiet.* Under the delegation the coordinator starts them (section 11.5), with section 8.10's list in front of it. Before the release of packages 4.2 and 5.1 the site's build is run against a day with no plan, without changing the site.

### 12.3 What is left to the owner

Since 2026-11-16 the coordinator makes every production step, including those this section listed as the owner's go (section 11.5). What stays with the owner:

| When | What | Why it is his |
|---|---|---|
| Any time | The band and the drying cost limit, in the band editor; overruling any default of section 11.5 | They are his settings, and the defaults were built for him to overrule |
| Before the law is flashed (package 3.2) | Any value of appendix E he wants changed; otherwise the values of section 11.5 are built | Irrigation and lighting are to stay as they are |
| Any time | Whether the furnace moves its own air (decision 12); if it does not, the fan in cold protection stays | Only a look at the furnace answers it |
| Any time | Whether the radio-cycle recovery of decision 22 is tried on the live controller in a window of the network lane (section 12.2) | It was part of the ratified decision and was dropped for want of a bench controller |
| After phase 3 | The re-look at the heating lines (decision 2), the hold-back (decision 15) and any change to the drying default after phase 1 (decision 1) | They are design decisions, unchanged by the delegation |
| After the first winter gas bill | One check of the bill against furnace hours (decision 14) | Only he has the bill |
| When he takes up the public site | Decision 19, and with it what section 8.10 holds back | The site is out of scope until he says |

### 12.4 Noted

- **Alerts.** The climate alert list goes from 26 kinds to about 17 (section 8.3). The rules live in the monitoring lane and are changed there, with one row per alert: kept, removed or new.
- **Dashboard.** The plan card, the planner health panel and the plan lanes go. The current-state view shows the law's state and its reasons, and the daily review and the cycles and utilities record take the place of the planner cards in the same release (section 8.5). This is dashboard.verdify.ai, the operator's dashboard, not the public site.
- **One band in the store.** Seasonal and growth-stage rows go, and a seasonal change becomes a band edit (section 8.4). The editor refuses a band narrower than 6.5 F or 0.35 kPa, and says why (section 4.1).
- **Agents and the band.** No agent writes the band or the drying cost limit, an owner-directed session included. They are written from the dashboard under the owner's sign-in (section 7). The one exception is phase 0: the coordinator writes band 2 under the delegation (section 11.5), before the refusal is built in phase 4.
- **Decision records.** ADR-0004 decision 7 and ADR-0006, under which the planner acts ahead on the forecast, are withdrawn (section 8.6). Forecast use can return as an input to the controller (decision 15).

## 13. Verification and acceptance

Simulation and heavy test runs belong on the cluster's CI runners, not on a workstation.

**Phase 2.**

- Host tests for the trust flag, the no-clock corridor, the outdoor source order, the case sensor alone (the temperature rules on its reading less the offset) and no indoor reading at all (the state of decision 7 and a critical alert, with no substituted value). The logic of this release is written in the firmware library, where these tests run it; code in the ESPHome YAML is compiled in CI and never executed off the controller. `make test-firmware`, `make firmware-check`; the irrigation and lighting checks of sections 8.7 and 8.8. A host test that the manual overrides of the fans, the vent and the fogger act in the state of decision 7.
- On the controller, two tests. Both are attended, neither needs anyone at the greenhouse, and both are writes in the network lane, arranged there in its window and under its lock.
  1. *Six hours alone.* The controller is cut off from the network from before local midnight until after it, for at least six hours, and is not restarted. The block is made at the gateway (routing or firewall), so WiFi stays associated and no restart by hand can be needed; the weather station's broadcast may still arrive. If the network lane can only block the WiFi client, the test is run only with the accepted risk that a stack that does not re-associate needs a restart by hand. When the block is lifted: the uptime has not reset; the relay counters and the fan run seconds have advanced; the engine's daily water count started a new day at local midnight; the electric heater's power meter, which reports by itself, shows the heater cycling through the block as on a normal night; and the first readings after the block are inside the band.
  2. *A restart without the time.* The controller's path to the host stays open, its time servers are blocked, and it is restarted through its restart service. After the restart: the anchor readbacks equal the store, the fan run seconds and the relay counters are restored, every relay is available at once, the controller reports `sntp_valid` 0 ("clock unconfirmed", the existing entity) and serves the corridor, and irrigation and lighting keep running on the retained clock, as today. If the network lane can also keep the weather station's data from the controller, the outdoor source is seen to switch to the intake probe; if it cannot, the host tests cover the source order. When the block is lifted the controller takes the time and returns to the band.
- Not exercised on the controller: a power-on with no time server answering, the only state with no time at all, which needs the power switched by hand. Host tests cover its parts: the corridor, and the irrigation engine with an invalid clock.

**Phase 3.**

- Native tests of the law's invariants: the furnace never requested with the vent open; no fan without the vent; minimum times honoured outside the cases of section 4.3; the electric heater requested whenever the furnace is; no fog or mist while drying; no fog or mist below the band's low edge (decision 20); no mister valve without a grant; the two protection states; no change of request while the house is inside every inner line; the same inputs give the same outputs at any clock time; every relay available at boot; a band narrower than the two widths is widened and an inverted one repaired; and the four irrigation tests of section 8.7 (a VPD pulse without a grant never opens a valve; occupancy with the rule 6 latch set gives `climate_demand` false; protection fog runs past a drip in progress and stops for a drip relay that reads on; the soft budget holds the fogger and misters and a VPD emergency lifts the hold).
- A noise test: the law is run on recorded probe readings, which carry the real sensor noise, around each pair of lines. No latch may change more often than its relay's minimum times allow, and the start and stop of a drying run (`low + 1.5` and `low + 0.75`) are one of the pairs. If that pair chatters, the start line is raised (section 4.5).
- The closed-loop simulation in CI, built with the product header instead of the reference, reproduces the reference results (both in band within 0.5 point, starts within 5 %).
- The existing replay gate compares old and new decisions on recorded data and will show total divergence on this release by design. It is replaced in the same change by the comparison of the firmware's law with the reference and by the invariant tests on the same recorded data (section 8.1).
- The OTA gate, with its action proof and its outdoor freshness check, the smoke test and the liveness check pass on the law build with no host change, and pass again for a flash back to the phase 2 build.
- **Functional acceptance at the flash** (section 11.5). The OTA gate, the smoke test and the liveness check pass; the controller publishes the law's state record, the drying meter and the constants hash; no protection state is entered; within the first day each relay the weather calls for switches at its line, as the state record shows; and the irrigation and lighting checks of item 6 below pass. Phase 4 may start on this.
- **The seven-day read,** reported afterwards and not a gate for phase 4: on the controller, for at least seven days that include a cold night and a sunny day. The baseline days of phase 1 and the acceptance days have different weather, so the gates are set through the simulator. Phase 1 gives, for each quantity, the ratio of measured to simulated on today's firmware. For the acceptance days both controllers are simulated on that window's weather and scaled by that ratio; "expected today" and "expected law" below are those scaled figures. Both are simulated on the band that is live, and the law at the drying cost limit that is set on the controller; the ratio comes from the 30 days backfilled on today's firmware, band and settings (section 11.5). If the owner changes the band or the limit during the window, the window starts again.
  1. No protection state entered because of the law.
  2. Both in band: at least expected today plus half the expected gain.
  3. Relay starts in total: at most expected today minus half the expected reduction. Furnace starts: at most 20 % above expected law. Furnace starts within 15 minutes of the end of a drying run are reported beside the drying meter. They are part of what the drying cost limit buys with, so they are bounded with the furnace's starts and have no fixed number of their own.
  4. Run hours, kWh, estimated therms and gallons a day: each at most 15 % above expected law.
  5. The drying meter reports, and the refusal reasons account for the time drying was wanted and did not run.
  6. Irrigation and lighting: a scheduled drip ran, a VPD mister pulse went through the grant, the lights followed their window, and a dashboard irrigation write and a dashboard light switch worked.
- A failed gate is reported with its numbers. The law build stays on the controller for diagnosis only if no protection state occurred and compliance is at or above expected today; otherwise the phase 2 build is flashed. Once phase 4 has started, the phase 2 build is no longer a rollback target and the fix is a new law build (section 11.5). The window starts again after a fix; a gate is not passed by re-running the window unchanged.
- Go back at once to the last-good build (the phase 2 build until phase 4 starts) if the law causes a protection state, if a heater, a fan or the vent makes more than 12 starts in an hour or the fogger more than 15 (mister pulses are not counted), or if compliance is below expected today for three days.

**Phase 4.** Before each release: the public site's generators and the queries of its embedded panels pass against a replay of the migrations (section 8.10). After each deletion: `make ci`; the production render equals what is live; the controller's readback list equals the registry; no alert rule or dashboard panel queries a dropped object, checked against the same replay; the ingestor, the API and MCP start and pass their login attestation (section 8.4); the lab site's publisher completes a run and the site's build time advances; the irrigation and lighting checks, with a dashboard irrigation write and a dashboard light switch. The OTA gate passes on the law's state record before the firmware stops publishing the legacy fields.

**Phase 5.** Before the release of packages 4.2 and 5.1: the public site's build passes on a day with no plan, with no change to the site. Then the first daily review is verified and the later ones are reported (section 11.5); the review's record is in its own table, not `plan_journal`; no row written to `setpoint_changes` by the planner's identity; an agent's write to a band row or to the drying cost limit is refused; the review's record is not shown on the site as a plan; Iris's irrigation tools work in the daily review and on a manual trigger; the ingestor's two irrigation listeners still fire.

## 14. Risks and limits

1. **The model.** The evidence is a simulation fitted to this house. Air exchange is its least certain part and the moisture source is not measured; models A and B bracket it and section 5.8 perturbs the rest. The law's lead over today's firmware is large against those perturbations. The exact utility figures are not.
2. **No sensor noise in the simulation.** Simulated relay starts are indicative: for today's firmware the simulation is above the measurement in one month and below it in another (section 5.1).
3. **Not simulated:** occupancy holds; the irrigation holds on the fogger and misters (a drip in progress, the fertiliser master, the soft budget, the safety cap); the irrigation engine's zone ranking and refused grants (the simulator rotates the member lines and opens them itself); the lights as a heat source; manual overrides; sensor failures and probe dropouts; control on the case sensor alone; a stale outdoor reading; the band widening of section 4.1; and any duty limit of the fogger at 1.9 / 1.7 hours a day against 0.9 / 0.6 today.
4. **Gas is estimated,** from furnace hours. No meter is fitted; one winter bill checks the coefficient (decision 14).
5. **One weather year.**
6. **The furnace.** Its starts do not fall: -0.6 / +0.7 a day against today's firmware on today's band and +1.1 / +2.7 on band 2. It is large for the house, and the width of its swing is the only lever on its starts (decision 2). Its capacity in deep cold is a separate question (issue #1670).
7. **Humid hours.** At the default drying cost limit the law leaves the house too humid 7 / 13 % of the year, against 17 / 28 % for today's firmware; the higher figure of each pair is model B, the wetter house. The limit is the owner's control over that, and the moisture measurement of phase 1 tunes its default (section 4.5).
8. **The law release rewrites the control path** of the controller. The mitigations are the unchanged wire contract in both directions, the invariant tests, the comparison with the reference in CI and the rollback by flash.
9. **What no control law covers.** A relay that stays closed; one probe that reads wrong while it still reports; a controller that is hung or unpowered, which heats nothing. No hardware thermostat backs the controller; that was accepted earlier (issue #1296, cited in the sensor-fault code) and is not reopened here. Decision 7 covers the loss of every indoor sensor, not a controller that has stopped; for that one case it changes what was accepted on that issue, and it is built as ratified, which the owner can overrule (section 11.5).
10. **Without a clock,** after a power cut with no time server answering, the irrigation engine's daily water count does not start a new day, so after about three to five days the soft water budget and then the daily safety cap hold the fogger and misters (section 4.9). The day rollover that would remove this is not built (section 11.5).
11. **The intake probe** is not validated as an outdoor source: two days of temperature comparison and none of dew point.
12. **Compiled values.** The VPD emergency level, the dew-point margin for wetting, the mister line's minimum off time, the zone ranks, the mister pulse, gap and longer-pulse factor, the case sensor's offset and lighting's outdoor staleness limit become compiled values. Appendix E lists what the controller held on 2026-11-16 and over the 30 days before. The planner moves four of them today (the dew-point margin, the pulse, the gap and the factor), so any compiled value differs from some hours of today's operation. The value held most is built, and the owner can change any before the flash (decision 13, section 11.5). The simulator gives no evidence for the values the irrigation engine reads, because it has no dew gate, no grant and no water budget in the law's path.
13. **Open inventories:** what reads the 12 crop temperature rows in `crop_band_anchors`; the final count of dropped tables. The activity log covers only twelve days of irrigation writes, so "Iris writes none" is a short record.
14. **Lighting does not run alone** and its heat is not metered; both are outside this plan.
15. **What the law costs at the default.** At a drying cost limit of 0.7 the law uses more gas than today's firmware in both models (+0.11 / +0.20 therm a day on today's band, +0.05 / +0.25 on band 2), and in model B more electricity and run hours as well (+0.6 / +2.0 kWh and -0.4 / +3.3 hours a day on today's band, -0.2 / +1.3 and 0.0 / +4.3 on band 2). It buys the band held and the nights dried. The limit and the band are the levers, and both are the owner's.
16. **No battery clock.** Any boot after which no time server has answered leaves the band on the flat corridor until one answers. After a power cut irrigation schedules and the lights wait with it; after a soft reset they run on the retained clock (section 12.2).
17. **No indoor reading on a cold night.** With every indoor sensor lost the house is closed with the electric heater on and falls toward the outdoor temperature plus about 6 F; a person has to act at the greenhouse (section 12.2). The manual overrides of the fans, the vent and the fogger stay effective. If the owner overrules decision 7, every relay is off instead (issue #1643 as filed).
18. **A stuck WiFi stack** is cleared only by a restart by hand. The controller keeps controlling meanwhile, and the host's offline alert reports it (decision 22).
19. **The public site.** Seven tables, the plan and scoring views and about 570 lines of code stay only because the site reads them, and the publisher's image stays at its pin. A reader that section 8.10 misses would stop the site from rebuilding, with a failed publisher Job as the only signal; the replay check and a watched publisher run after each sync are the guard. The hand-written pages are not in this repository and were not read for this plan.
20. **The phase 2 tests on the controller** are writes in the network lane and wait for its window.
21. **The waits that were cut** (section 11.5). The five settings and band 2 are measured only together; the baseline is backfilled from relay events; phase 4 can start before the law's seven-day read and before a cold snap, and a read that fails after that is fixed forward.

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
      on  if T >= low + 1.5 while e <= limit          limit: stored, 0 to 1.5, 0.7 by default

drying  = run and not cooling
vent    = cooling or drying
fans    = 2 if cooling and (cool2 or hot), 1 if cooling or drying, otherwise 0
wet_ok  = T >= low
fogger  = wet and wet_ok and not drying and not cold
misters = mist and wet_ok and not drying and not cold
heater  = (h1 and not cooling) or cold
furnace = (h2 and not vent) or cold
if cold: vent closed, fans 0
```

The relay layer of section 4.3 sits between these requests and the relays, and the holds of section 8.7 apply to the fogger and the misters. The reference implementation also carries study options that were simulated and not adopted (the effect check, fog forced at the 100 F limit, fog as a cooling stage, a second fan while drying, a second start line for drying at any cost, pre-staging and the hold-back while the sun is on the house or forecast). They are off by default and are not part of the law. The start and stop lines of a drying run (`low + 1.5` and `low + 0.75`) are constants of the law that the noise test of section 13 may move.

## Appendix B. Reproducing the figures

The simulator, the scenario definitions and the result files are in [`docs/reviews/control-review-2026-11-15/`](../reviews/control-review-2026-11-15/README.md); its README gives the build and run commands. The files this plan adds:

| File | What it is |
|---|---|
| `sim/band_edge_controller.h` | The reference implementation of the law. Its default constants are the law. The options marked as study options are off by default and are not part of it. |
| `sim/closed_loop2.cpp` | The review's closed-loop simulator with the law as a third controller, its relay layer, three mister zones, the runtime-balanced lead fan, the drying meter, relay start and run-hour totals, perfect-foresight pre-staging and hold-back, the degraded modes and a bias on the outdoor reading. Its model of today's firmware no longer limits humidity misting to a daytime window. |
| `sim/scenarios_plan.py` | Every scenario in this plan, in groups: `ref`, `law`, `ldeg`, `lprice`, `lecon`, `lpre`, `lrev`, `ldec`. |
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
| Drying cost limit from 0 to 1.5, none; never dry | `law_e0`, `law_e0.2` to `law_e1.5` (`law` is 0.7), `law_eall`, `law_nodry`; on band 2 `econ2_e0`, `econ2_e0.5`, `econ2_e1.0` |
| Another start or stop line for drying; a second start line at any cost | `law_gas_from1.0`, `law_gas_from2.0`, `s_dry_stop1.0`; `law_spare` |
| The heating lines and the hold-back on band 2 (decisions 2 and 15) | `econ2_s_*`, `econ2_hold_*` |
| Electric heater not ahead of the furnace; fan 1 always leads | `law_h1_not_first`, `law_lead_fixed` |
| No misters; centre mister only | `law_mist0`, `law_mist1` |
| One rule changed (section 5.6) | `s_*` |
| No outdoor data, without and with the effect check; outdoor dew point read wrong | `law_offline`, `law_offline_effect`, `law_out_dp+2`, `law_out_dp-2`, `law_out_dp-4` |
| Clock wrong; no clock (section 4.9) | `law_clock*`, `law_noclock`, `law_noclock_offline`; for today's firmware `fw_offline`, `fw_clock*`, `fw_frozen_noon`, `fw_frozen_noon_offline` |
| One band edge moved (section 5.7) | `p_*` (the night VPD edge: `p_vhi_night+0.30`) |
| Bands 1, 2 and 3 under the law and under today's firmware | `econ1`, `econ2`, `econ3`, `fw_econ1`, `fw_econ2`, `fw_econ3` |
| Pre-staging (section 6) | `pre_*` |
| Holding back while the sun is on the house or forecast (section 6) | `hold_sun_*` (`h0`: the present sun alone, no forecast) |

## Appendix D. Phase 0 runbooks

Both writes are made by the coordinator under the delegation of 2026-11-16 (section 11.5), on the same day, each stored as a manual value with the delegation as its reason, in a session that reads the state before and after. Neither needs a sync, a flash, a maintenance lease or a network lock. The "holds" columns were read from the controller's readbacks on 2026-11-16 at about 08:00 MST and are read again at the session.

### D.1 The five settings (decision 16, issue #1673)

| Setting | What it is | Controller holds | Set to | Allowed |
|---|---|---:|---:|---|
| `night_dryout_pulse_s` | Length of a night dry-out pulse | 120 | 600 | 60 to 600 |
| `night_dryout_rest_s` | Closed rest after a pulse | 780 | 300 | 300 to 3600 |
| `fog_escalation_kpa` | How far above the VPD high edge before humidifying steps up | 0.25 | 0.1 | 0.1 to 0.5 |
| `direct_wet_stress_vpd_margin_kpa` | How far above the VPD high edge before misting assists the vent | 0.05 | 0.25 | 0 to 0.5 |
| `mister_water_budget_gal` | Daily soft cap on mister water | 120 | 300 | 100 to 300 |

The dry-out pair has never been written and runs on its boot values. The other three are the planner's values of that hour. None of the five is held today. Three other settings are held (the economiser switch and the two lighting auto-mode switches): two were written by agent sessions and one by the owner. They are left alone.

**Steps.**

1. *Before, read only.* The controller is connected and its uptime and firmware version are noted. No `setpoint_unconfirmed` alert is open, no heap alert is open, and no setting shows as held by an experiment. The five readbacks are as in the table. `sw_night_dryout_enabled` reads 1 and `night_dryout_kwh_cap` reads 10; neither is changed. The coordination steer file is read for a ruling on this item.
2. *The five writes,* through the dashboard's settings path: the pulse first, then the rest, then the other three. Each is stored with manual = true and the delegation as its reason, which holds the value against the planner. The order matters for the pair only: the controller keeps pulse plus rest at 15 minutes or more, so a rest of 300 saved while the pulse is still 120 runs as 780 although its readback shows 300. Only the firmware enforces this rule; the host does not, so the writer keeps the order and checks the pair on the controller's readback.
3. *After each edit, within 5 minutes, read only.* The readback equals the value, the push is confirmed, the hold is active and no `setpoint_unconfirmed` alert has opened (it warns at 5 minutes and is critical at 15).
4. *When.* Before 00:00 MST, so that the first night is whole. A night on which a confirmation landed after midnight is not counted.

A write that does not pass manual = true stores manual = false, so it replaces a value a person holds and drops the hold; Iris's write to a held value is refused. Each of the five writes therefore passes manual = true.

**The nights after the write.** Each day the five readbacks are checked from 00:00 to 06:00. All five return to their boot values at a restart (120, 780, 0.4, 0.05 and 300) until the dispatcher writes them again after the reconnect, and a night on which they did not hold is not counted. `night_vpd_bias_kpa` is not written.

**The read.** From `daily_band_compliance`: the minutes dried between 00:00 and 06:00, the nights dried and both in band. From `mv_equipment_runtime_daily`: relay starts, the furnace's among them. Both are set against the nights from 2026-11-06 to the write, with each night's outdoor dew point beside it, because the weather differs. Nights on which pulses stopped at the kWh cap are noted. Band 2 is written the same day, so this read measures the settings and band 2 together (section 11.5). Simulated over the year, the five settings give 78.3 / 69.7 % both in band against 70.5 / 59.6 %, and 70 / 53 nights dried in a hundred against 57 / 38.

**Rollback.** Save 120 and 780 for the pair, or release both, after which the dispatcher writes the registry defaults, which are the same values. Release the other three, and the planner's values return: their rollback is by release, because a re-save of fog 0.25 would snap to 0.2 on the editor's grid.

### D.2 Band 2 (decision 9), the same day

The coordinator enters eight values in the band editor's Advanced view, which shows the 24 anchor values, and saves once, as a manual write with the delegation as its reason. The other sixteen stay as they are. No other agent writes the band.

| Anchor | Name | Controller holds | Enter |
|---|---|---:|---:|
| Low temperature edge, solar noon | `band_temp_low_sm` | 73.8 | 71.8 |
| Low temperature edge, sunset | `band_temp_low_ss` | 72.0 | 70.0 |
| High temperature edge, solar noon | `band_temp_high_sm` | 83.8 | 85.8 |
| High temperature edge, sunset | `band_temp_high_ss` | 82.0 | 84.0 |
| VPD high edge, sunrise | `band_vpd_high_sr` | 1.19 | 1.29 |
| VPD high edge, solar noon | `band_vpd_high_sm` | 1.29 | 1.39 |
| VPD high edge, sunset | `band_vpd_high_ss` | 1.27 | 1.37 |
| VPD high edge, solar midnight | `band_vpd_high_mid` | 1.17 | 1.27 |

The values are on the editor's grid (0.1 F and 0.01 kPa). They are within 0.01 F and 0.005 kPa of the band that was simulated as band 2, and each VPD value is 0.10 kPa above what the controller holds.

**Rules.**

- Only these eight values are changed, and only in the Advanced view. A Save from the profile controls recomputes every anchor of an axis from the profile, which would move the anchors that are to stay.
- The preview is read before the Save. No check of the editor refuses band 2: its narrowest gaps to the target curve are 4.59 F and 0.09 kPa (the VPD low-to-target gap, which band 2 leaves as it is; the high-to-target gap is 0.33 kPa), its high temperature edge peaks at 87.74 F against a firmware limit of 95 F, and the night floor passes as it does today. The preview shows overshoot warnings on the low edge (1.15 F), the target (1.54 F, unchanged) and the high edge (1.94 F); for today's band it shows 1.54 F on all three temperature series. Warnings do not refuse a Save.
- One Save writes the eight values together. They are not written one at a time through the settings page, and not by SQL.

**Before, read only.** The Advanced view and the eight readbacks show the table's values. The store holds 73.79, 72, 83.79, 82, 1.185, 1.292, 1.275 and 1.168 for the eight anchors, which the editor displays rounded to its grid. The store has one set of rows, for every season and one growth stage, as it had on 2026-11-16. The protection limit reads 100 F and the on-chip band is on. No heap alert and no `setpoint_unconfirmed` alert is open. The coordination steer file is read for a ruling on this item.

**After, within about 5 minutes, read only.** The ingestor logs one dispatch of eight anchors. The eight band readbacks equal the entered values and the pushes are confirmed. Irrigation status and the lights are unchanged.

**What changes, by design.** The house may run up to 2.4 F cooler between solar noon and sunset (2 F at the two anchors) before heat is called, and up to 2.4 F warmer before the vent opens. Fog and climate misting start 0.10 kPa later. Before dawn the band is 0.83 F narrower than today, because the curve through the four anchors dips there as the afternoon anchors move; it is the curve the simulation ran. The drift alert's "too dry" line moves up 0.10 kPa. The band graphs redraw the four days before the edit with the new anchors, and the grade of the day of the edit mixes two bands, so that day is left out of every comparison.

**Rollback.** A second Save with the "Controller holds" values of the table; the store then holds them on the grid (73.8 for 73.79, and so on), which is what the controller already ran. "Release to auto" does not restore a band.

### D.3 The failing nightly job (issue #1634)

The CronJob `verdify-winter-feasibility` has failed every night since 2026-11-16, because migration 309 dropped a table it reads. The change sets `spec.suspend: true` on the CronJob in `deploy/k8s/components/winter-feasibility/collector.yaml` by a pull request. Before the sync, `kustomize build deploy/k8s/overlays/prod | kubectl diff -f -` is run and any other pending drift is checked; then the full sync. Removing the CronJob from the manifests would not delete it, because the application does not prune; the PVC `verdify-winter-feasibility-archive` keeps its data. Another lane edited the same manifest on 2026-11-16, so the file is read again before the change. The job writes nothing to the controller.

## Appendix E. Values compiled for irrigation and lighting

The law compiles the values below (decision 13), so that nothing irrigation or lighting reads can be moved by a planner. The "holds" column was read from the controller's readbacks on 2026-11-16 at about 08:00 MST, the spread from the 30 days before. The last column is the value built: the value the controller held most over the 30 days (decision 13, section 11.5). The owner can change any of them before the phase 3 flash.

| Value | Read by | Controller holds | Last 30 days | Written today by | Compiled value built |
|---|---|---|---|---|---|
| VPD emergency level (`safety_vpd_max`) | The engine's emergency test: it lifts the soft-budget hold for climate pulses and fog, pauses clean drips, holds the start of drips and fertiliser-mister runs, and puts VPD pulses before scheduled ones | 2.5 kPa | Constant | Nobody | 2.5 kPa. The boot repair and the sanity reset that fall back to 3.0 kPa today go with the setting. |
| Dew-point margin for wetting, by day (`direct_wet_stress_min_dew_margin_f`) | The engine's scheduled misting, the zone gate and, today, the fogger's dew-margin veto, which the law drops (rule 5); above the high edge it binds only near 95 F | 8 F | 8 to 12 F, 8 most of the time; 37 planner writes | The planner | 8 F |
| Dew-point margin, at night (`night_stress_min_dew_margin_f`) | The zone gate | 6 F | Constant | Nobody | None of its own: the gate uses the larger of the two margins, which is 8 F at every hour today |
| Mister line minimum off (`mister_min_off_s`) | The engine's zone fence and the gap floor of scheduled pulses | 45 s | Constant | The planner may, and has not | 45 s |
| Zone ranks (`zone_priority_*`) | The engine's zone ranking, which acts with two or more member lines; there is one today | Centre 1, south 2, west 3, east 4 | Constant | The dispatcher, from the defaults | The same |
| Outdoor data age limit (`outdoor_staleness_max_s`) | Lighting's freshness test of the outdoor light level, and the law's age limit on outdoor data | 600 s | Constant | The planner may (tier 1), and has not in the 30 days | 600 s |
| Climate mister pulse (`mister_pulse_on_s`) | The climate mister code only | 33 s | 30 to 60 s, 30 most often | The planner | 30 s (the simulator ran 60 s) |
| Climate mister gap (`mister_pulse_gap_s`) | The climate mister code only | 37 s | 20 to 60 s, median 56, 60 most often; 499 planner writes | The planner | 60 s (the simulator ran 45 s) |
| Longer-pulse multiplier (`mister_vpd_weight`) | The climate mister code only | 1.7 | 1.13 to 2.0, median 1.39 | The planner | 1.4, applied while the zone's VPD is above 1.2 times the band's high VPD edge (section 4.8) |
| Protection limits (`safety_max`, `safety_min`) | Rule 8, and the engine's high-temperature input | 100 F and 40 F | 95 and 45 F were also read, from four writes with source "band" in the 30 days; the boot values are 100 and 40 F (`firmware/greenhouse/globals.yaml:159-167`) | The dispatcher | 100 F and 40 F |
| Case sensor offset | The temperature rules when the wall probes are invalid | - | 1.6 F, the median of the 30 days to 2026-11-16 (3.3 F with the sun up, 0.6 F at night) | - | The median of the 30 days before the release |

**Stays a setting.** The soft water budget (`mister_water_budget_gal`), which the owner sets to 300 gallons in phase 0 and which is kept across a restart from phase 2 (decision 11). All 24 lighting settings stay settings.

**Where a compiled value differs from today.**

- *The dew-point margin.* When the planner raised it, to as much as 12 F, scheduled misting and climate wetting were refused whenever the air was less than 12 F above its dew point, a wider margin than 8 F. At a compiled 8 F they are refused within 8 F, as they were most of the time.
- *The mister pulse, gap and longer-pulse factor.* The built values are 30 s, 60 s and 1.4, the values the controller held most. On 2026-11-16 it held 33 s, 37 s and 1.7, and the planner moved all three. Today the factor applies only in the second mister stage; under the law, with one stage, it applies to any pulse while the zone is above 1.2 times the band's high VPD edge (section 4.8). The simulator ran one cadence, 60 s on and 45 s off, with no factor. Under the law the misters are a second stage that seldom runs: with the misters removed altogether, simulated compliance changes by 0.00 / -0.13 point (section 4.8).
- *Everything else in the table* is constant today, so compiling it changes nothing.

The simulator gives no evidence for the values the irrigation engine reads: in the law's path it has no dew gate, no grant and no water budget.
