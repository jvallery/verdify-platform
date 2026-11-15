# Greenhouse control effectiveness review, 2026-11-15

This is a review of how well the greenhouse is controlled today, why it misses its band when it does, and what
to change. It covers the firmware, the planner, the dispatcher and data path, and the experiment scaffolding
around them. It is analysis and planning only: nothing in the firmware, the settings, the database or the
deployments was changed. The remediation issues are listed in section 12.

Supporting material (the simulator, its fitted parameters and every result table) is in
[`control-review-2026-11-15/`](control-review-2026-11-15/README.md).

## 1. Summary and verdict

**The design holds temperature and does not hold humidity.** From 2026-05-25 to 2026-11-15 (4,036 graded hours)
the house was inside both served bands 47.4% of the time: temperature 85.2%, VPD 52.8%. Temperature has been
inside its band 97 to 99% of the time since October. VPD has stayed between 47 and 57% in every full month. The only numeric bar on record, set by the
band-compliance work (epic #359), is at least 90% on each axis, day and night.

Four things explain the gap.

1. **Wet air, mostly at night (29.9% of graded time, 46 to 48% in October and November).** This is a limit of
   the rules, not of the hardware. Outdoor air was dry enough to dry the house on every October and November
   night. The older dehumidify path is vetoed because venting would over-cool the house. The night dry-out added
   on 2026-11-06 vents for 120 seconds every 15 minutes, starts only when the house is at least 1 °F above the
   band low, and stops whenever the furnace is wanted. On a cold night the electric heater runs flat out and the
   house sits within 1 °F of the band low, so the dry-out is blocked 87% of the time it is needed, and the
   furnace is never allowed to supply the reheat that venting needs.
2. **Dry air on warm afternoons (17.3%).** 84% of it is control-limited: fog had capacity left and was
   cycling, or no wetting was running at all. Fog assist starts up to 0.4 kPa beyond the band edge, and the
   relay and the decision layer use different thresholds.
3. **Heat the hardware cannot remove (up to 8% of graded time).** 55% of the too-hot time (14.3%) had the
   vent and both fans fully on. Fog is the only lever left in those hours.
4. **Faults that nobody was told about.** The electric heater delivered no heat for 209 days with its relay on.
   The controller clock was wrong for 87 days, and 65 to 117 minutes fast on 59 of them, so the band was served
   early. The planner's
   output did not reach the controller on 44 of 94 days. The controller ran on boot defaults, with safety limits of 95 and 45 °F instead of 100 and 40 °F, for
   24 days in September. On 2026-09-04 fog was locked out for 3 h 16 min and the misters for 7 h 18 min, and the
   house reached 100.6 °F with 94.5 °F outside, its highest temperature of the record. None of these was
   detected as a fault: the alert log shows one overheat alert in September, most likely from that afternoon,
   and one warning during the freeze, which does not page.

**The planner's measurable contribution is small.** Each waypoint is a 15-field intent that a fixed
mapping expands to 39 settings; 15 of those never vary and the other 24 behave as three to eight independent
numbers. In the first half of November 84% of the setting changes that came from plans went to mister, fog and
direct-wet settings (about half of those rows are the dispatcher's guardrail and the planner overwriting each
other), while wetting ran 7 minutes a day and the miss was wet air, which none of those settings acts on. In
simulation, moving 20 of the settings anywhere inside their historical ranges changes yearly compliance with a
standard deviation of 1.6 to 1.9 points, and the July settings held all year do as well as seasonal re-tuning.
In the record, days with a fresh plan cannot be told from days with a stale one to within 10 to 16 points;
delivering any sensible settings beats boot defaults by about 8 points. In September the planner scored its own
plans higher on the days when nothing was delivered (6.6 against 4.4).

**Much of what is deployed does not run.** A 468-line legacy cascade is unreachable. 26 of 74 setpoint fields
have no effect. 84 of 128 tunables did not change in the 95-day readback record. A 1,948-line policy engine is
compiled in and switched off. Experiment scaffolding accounts for about 118,000 lines by name (about 26,000 of
them migrations and their tests) and 71 tables, and one of its ledgers was 31% of the database. One extra
planner is deployed and idle, and another runs in shadow with no decision date.

**What to do.** The gains below are simulated with the production control code in the loop, under two model
variants (A and B) that bracket the house's autumn night humidity in 2026; in summer both are drier than the
record. They are differences under the same model. The absolute levels are uncertain: scored the same way,
single months of the record differ from the simulation by up to 30 points (section 9.2).

| Step | What changes | Both in band over a year, simulated, A / B | Nights that dry out, October to April, simulated, A / B (%) |
|---|---|---:|---:|
| Today | Current firmware and settings, with every fault above absent | 71.8 / 60.6 | 63 / 26 |
| 1a. Two operator settings | Dry-out pulse 600 s and rest 300 s. Operator-owned settings: an operator write, reversible in a minute. | 74.2 / 65.6 | 68 / 41 |
| 1b. Three wetting settings | Fog escalation 0.1 kPa, direct-wet margin 0.25 kPa and the mister budget at its 300-gallon maximum, written as manual rows so that the planner's plans stop moving them. Operator writes; no code. | 78.3 / 69.6 | 76 / 45 |
| 2. One firmware release | Stop forcing the electric heater off at each pulse end; start the furnace at band low + 0.5 °F; run the dry-out from band low + 0.5 °F for as long as needed, by day as well; take the mister budget and the planner's other actuator settings out of the planner's hands. | 85.6 / 82.5 | 89 / 74 |
| 3. Remove what does not run | No change to control behaviour | unchanged | unchanged |
| 4. Two-axis controller | About 22 fixed constants in place of the mode arbitration and its tunables | 83.5 / 80.3 | 82 / 63 |
| Option: a stronger dry-out | The dry-out aims above its floor (recommended): with a 0.05 kPa constant in the step 2 release. An existing setting, `night_vpd_bias_kpa` 0.10 from October to April, does the same on that release and is optional before it (a manual operator write, no code; 2 / 17 more nights of 195 before step 2). Next, both fans in a pulse instead of one (firmware). Up to 0.5 therms a day from October to April; the both-fans gain depends on a fan flow that is poorly known (section 9.7). Jason's decision (section 11, decision 2). | 78.2 / 70.6 with the setting after step 1; 85.7 / 84.3 with it after step 2; 86.1 / 84.7 with the constant; 86.2 / 85.4 with the constant and both fans | 77 / 53 with the setting after step 1; 92 / 84 with it after step 2; 92 / 84 with the constant; 93 / 89 with the constant and both fans |
| Option: a warmer night | The temperature low edge 2 °F higher at the solar-midnight and sunrise anchors (62.7 and 64.5 °F). A band edit, no code; 0.25 to 0.4 therms a day from October to April; less certain than the rows above (section 9.7). Jason's decision (section 11, decision 2). | 79.1 / 73.4 after step 1; 86.2 / 85.2 after step 2 | 88 / 70 after step 1; 96 / 86 after step 2 |
| For comparison: a lower night VPD edge | The VPD low edge 0.10 kPa lower at the sunset, solar-midnight and sunrise anchors. It moves the grade, not the air: the dry-out keeps its 0.74 kPa floor, which was set on purpose on 2026-11-05. | 83.8 / 79.2 after step 1; 88.6 / 88.3 after step 2 | 77 / 45 after step 1; 90 / 74 after step 2 |

Electricity changes by 0.6 kWh a day or less at every step. Gas is almost unchanged at step 1 and rises by 0.3
to 0.4 therms a day at step 2: the furnace starts 0.5 °F above the band low instead of at it (about 0.16), and
more venting means more furnace cycles afterwards (0.2 to 0.3, less 0.1 saved by the wetting constants). Step 4 scores about 2 points below
step 2; its case is maintainability, so it comes last.

The last column is the night goal Jason set on 2026-11-05: the house dries out overnight, counted as at least
four of the six hours after midnight at or above the night floor (the band's low edge, and never less than
0.74 kPa). The record met it on none of the 46 nights from
2026-10-01 to 2026-11-15. Steps 1 and 2 are the route to it. October stays the weak month (48 / 19% of nights
after step 2): on the typical night that still fails, the vent is already open for more than half of the six
hours, the electric heater is saturated and the house sits just under the floor. Three additions were tested
for that (section 9.7): a dry-out that aims above the floor instead of at it, as a firmware constant or
through an existing setting (`night_vpd_bias_kpa`) that gives the same nights after step 2 and 2 / 17 more nights of 195
before it; both fans instead of one during a pulse; and a night 2 °F warmer, which costs the most gas and is
the least certain. Lowering the VPD edge
instead would raise the grade and leave the nights as wet.

Step 1 is five operator writes and no code. Step 1a is also the cheapest test of the simulator: two weeks of
nights will show whether the predicted change appears.

**What already works.** Temperature control since the October firmware. The relay churn of spring 2026 is gone
(576 thermal-relief episodes in April, three or fewer reversals a month since August). The dispatcher gate that
froze delivery was replaced on 2026-11-02 and has not stalled since. The clock fault was fixed on 2026-09-30,
the fog part of the lockout on 2026-09-27, and the two safety defaults are corrected in `main`. Planner availability has
been 97 to 99% since September. Migration 309 (2026-11-15) made the served band the only grading basis.

## 2. Scope, data and method

**Data.** Everything was read from production, read-only, one bounded query at a time:

- climate telemetry at one-minute resolution from 2025-11-13 to 2026-11-15 (356.8 online days of 367.7);
- relay state, the two metered power legs, the water meter and controller diagnostics for the same period;
- every setpoint write (732,213 rows) and the controller's readback of every setting (31.9 million rows in the
  last 95 days);
- every journaled plan (719), planner trigger, plan evaluation and lesson, and the alert log (14,019 alerts);
- the served-band compliance record (`daily_band_compliance`, from 2026-09-01), extended back to 2026-05-25
  with the band the controller logged to 2026-06-15, a reconstruction from the anchors for 2026-06-19 to
  2026-08-13, and the dispatcher's audit band after that. The reconstruction matches the audit band to 0.03 °F
  where both exist, and the daily figures match the compliance record to 0.05 points on average.

The snapshot was taken before migration 309 was applied to production (2026-11-15, 11:32 MST). The code is the
repository at commit `ae486ddb`.

**Method.**

1. Ten independent audits: seven of code (firmware logic, firmware surface, irrigation, planner, dispatcher and
   data path, experiments and research, earlier recommendations) and three of data (climate, actuators and
   energy, setpoints and planner effect). They produced 152 findings.
2. Eight adversarial checks of the findings that matter most, each by a reviewer told to refute the finding, and
   one root-cause investigation. All eight came back confirmed with corrections. The corrections are applied
   here; where a first reading was wrong this report says so.
3. A simulation study (section 9): a physical model of the house fitted to the record, with the production
   firmware control code compiled into the loop.
4. A fact-check of this report: nine reviewers checked 901 statements against the sources, the code and the
   result files and returned 186 corrections, most of them of precision. They are applied. Three changed a number in the summary; section 13 says which. The night-goal
   sections added afterwards (9.7 and 9.8) were checked by a tenth reviewer, who rebuilt the simulator from the
   support directory, reproduced its result files exactly and returned eight corrections, also applied. The
   `night_vpd_bias_kpa` scenarios of section 9.7 were run after that check and went to an eleventh reviewer,
   told to refute them: the mechanism and every figure held, and the wording was corrected where it overstated
   the gain on today's firmware.

**What a number means here.** "Measured" is from the record. "Simulated" is a projection from the model and is
always given for both model variants as "A / B". "Inferred" marks a cause that fits the evidence but was not
observed directly. Clock times are America/Denver.

## 3. How the system works today

```
 probes, weather ──► ESP32 controller (1 s loop) ──► relays: heat1, heat2, vent, 2 fans, fog, misters, drip
                        ▲            │
       settings, band   │            │ readback of every setting, every 30 s
                        │            ▼
 planner ──► MCP set_plan ──► database ──► ingestor dispatcher (the only device writer)
```

**House and actuators.** One air mass. Electric heater `heat1` (1.44 kW measured), the primary heater by design.
Gas furnace `heat2` (22 kW input; 12 to 18 kW delivered by the heat balance, 9 kW in the fitted model), the backup. A roof vent and two
fans. A fogger, a centre mister zone (the south and west zones have not run since July), wall and centre drip,
and two grow-light circuits switched through Home Assistant.

**Controller.** An ESP32 running ESPHome. The control law is plain C++ in `firmware/lib` (14 headers, 10,218
lines; `greenhouse_logic.h` is 3,023) called from a one-second loop in `firmware/greenhouse/controls.yaml`
(2,423 lines). Each second it validates the settings, picks a mode with a state machine, ranks candidate
actions, resolves them to relay requests, passes the requests through the relay-conflict rules (one function in
`main`; inline in the YAML on the build that is flashed) and then through per-relay minimum on and off times
(heat 120 / 180 s, fans 120 / 90 s, vent 60 / 60 s; fog 60 / 60 s by default, moved by the planner).

**Band.** The served house band is a temperature and a VPD corridor (low, target, high) that follows the sun.
The controller computes it from 24 anchor values held in flash (six curves at sunrise, solar noon, sunset and
solar midnight) and from its own clock and solar position.
It is 10 °F and 0.43 kPa wide. The same curve is computed in three other places to grade and display it.

**Settings.** The controller exposes 128 settings as entities and publishes a readback of 187 values every
30 seconds (139 and 193 on the build that is flashed today). 117 of the 128 are not kept across a reboot: after a
restart the controller runs on its compiled defaults until the dispatcher pushes the settings again.

**Ingestor.** One process is the only writer to the controller. Its dispatcher runs every five minutes: it
pushes the planner's active waypoint, any setting an operator has written from the dashboard (a write marked
manual outranks the plan), the band anchors when they change and four zone VPD targets, applies a moisture
guardrail, and records each write and its confirmation. The same process stores the telemetry, the
readbacks (every minute) and the relay events, evaluates the alert rules, and runs seven tasks for experiment
machinery that is switched off.

**Planner.** An LLM agent ("Iris", run by Hermes) is woken about nine times a day: at
midnight, sunrise, solar noon, two fixed afternoon checkpoints and sunset, on forecast deviations, and once a
week for a review. It is sent a static prompt of about 11,000 tokens plus a gathered context, writes a plan of
three to eight waypoints up to 72 hours ahead through the MCP `set_plan` tool, scores its previous plan and
stores lessons. A waypoint is a 15-field intent; a fixed mapping (`verdify_schemas/climate_intent.py`) expands
it to 39 controller settings. A second planner (`planner_graph`) is deployed and idle. A third, on local models, has
run in shadow since 2026-11-06.

**Other moving parts.** A forecast-action engine that pre-empted settings on hot days (three settings carry 99%
of its writes; none since 2026-10-05). An irrigation
engine on the controller (live since 2026-11-03). The experiment generations 1 and 2 (orchestrator, policy
vectors, qualification, native-panel ledger), all switched off and all still deployed.

**Size.** The firmware YAML is 11,994 lines, the ingestor 34,806 lines of Python, the MCP server 7,308, the tunable registry 3,917 (150 written entries and 56 generated band entries), and there are 310 migration
files under `db/migrations`.

## 4. Measured performance

### 4.1 Compliance by month

Share of graded time inside the served band, and where the rest went. A five-minute bucket is graded when it
has a valid indoor reading and a valid band. Frozen telemetry (561 buckets), missing data (1,262) and the three
days in June when the band was being redefined (888) are excluded.

| Month | Graded hours | Temp in band % | VPD in band % | Both in band % | Too hot % | Too cold % | Too dry % | Too wet % | Outdoor mean °F | Outdoor dew point °F |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-05 (25th to 31st) | 151 | 63.1 | 64.7 | 49.8 | 36.7 | 0.2 | 25.8 | 9.5 | 67 | 48 |
| 2026-06 | 634 | 82.9 | 57.4 | 52.6 | 17.1 | 0.0 | 23.7 | 19.0 | 71 | 49 |
| 2026-07 | 726 | 74.4 | 56.2 | 46.2 | 25.6 | 0.0 | 26.2 | 17.6 | 78 | 53 |
| 2026-08 | 716 | 77.4 | 52.4 | 43.5 | 22.5 | 0.2 | 26.6 | 21.0 | 75 | 52 |
| 2026-09 | 719 | 90.5 | 46.5 | 43.2 | 9.5 | 0.0 | 15.1 | 38.4 | 69 | 48 |
| 2026-10 | 743 | 98.9 | 49.5 | 48.9 | 0.1 | 1.0 | 2.3 | 48.2 | 58 | 39 |
| 2026-11 (to the 15th) | 347 | 97.2 | 53.8 | 52.5 | 0.0 | 2.8 | 0.5 | 45.7 | 49 | 32 |
| **All** | 4,036 | 85.2 | 52.8 | 47.4 | 14.3 | 0.5 | 17.3 | 29.9 | 68 | 47 |

Temperature compliance rose from 74 to 77% in July and August to 97 to 99% in October and November. VPD
compliance did not improve (46 to 57% in every full month): the larger loss changed sides, from too dry on
summer afternoons to too wet on autumn nights.

### 4.2 Where the lost time goes

| Miss | Hours | Share of graded time | What limits it |
|---|---:|---:|---|
| Too wet (VPD below band) | 1,206 | 29.9% | 92% with no drying action in use. The rules, not the vent or the outdoor air (section 5.1). |
| Too dry (VPD above band) | 697 | 17.3% | 84% control-limited (fog not saturated): 60% is fog and mister cycling, 22% had no wetting running. 2,143 episodes, median 5 minutes (section 5.2). |
| Too hot | 579 | 14.3% | 55% with vent and both fans fully on (fog use not tested): mostly capacity (section 5.2). |
| Too cold | 19 | 0.5% | 174 episodes, median 5 minutes; each furnace cycle starts below the band (section 5.3). |

An independent recomputation of the wet side gave 1,188 hours (28.9%). 44.5% of all out-of-band VPD minutes are
within 0.1 kPa of an edge, and 72.9% within 0.2 kPa: the band is 0.43 kPa wide, the same order as the
controller's own dead bands.

### 4.3 Energy and water

- **Heat.** In November the electric heater ran 20.9 hours a day (30.0 kWh a day) and the furnace 3.5 hours a
  day (2.6 therms a day, about 43 to 62 kWh of heat). The furnace already supplies half to two thirds of the
  heat on a November day. Over the whole year the furnace burned 1,017 hours in 5,825 cycles, about 763 therms.
  Gas is not metered: the therm figures are burner time at the nameplate input, and the heat figures assume
  that 55 to 80% of it is delivered.
- **Lights.** The grow lights draw a nominal 10 to 15 kWh a day and are not metered. In June to September that
  is more than the entire metered load.
- **Water.** Wetting used about 39,300 gallons from 2026-03-21 to 2026-11-15 (fog 15,400, misters 23,900), 88%
  of all metered water. Misters took 61% of the wetting water for 20 to 40% of fog's VPD effect per gallon. Since
  November 2025 the drip lines ran for 14.8 of 811 wet run-hours (1.8%); automatic drip did not run from
  2026-05-29 to 2026-11-04.
- **Cost evidence.** The planner sees none of this: the resource gate has been closed since 2026-07-09 (#1623).

### 4.4 What the hardware can do

- **Heating.** The envelope loses 0.233 kW per °F (95% interval 0.200 to 0.273) with a time constant of 5.6
  hours. In steady state the 1.44 kW electric heater therefore adds about 6 °F (5.3 to 7.2) over outdoors. With
  stored daytime heat and the lights it carried autumn nights alone down to about 45 to 50 °F outdoors (98%
  duty at a 15 to 20 °F difference); below that the furnace supplies the rest. During a burn the furnace raises
  the air temperature at 19.4 °F an hour (burns last about 11 minutes); the electric heater raises it at
  1.65 °F an hour.
- **Cooling.** With the vent and both fans, the house sits 0.7 °F above outdoors without fog and 6.9 °F below
  with fog under strong sun (9.8 °F below when the outdoor air is very dry, falling to 3.9 °F below when the
  outdoor dew point is within 30 to 40 °F of the outdoor temperature). At 90 °F or more outdoors the
  house was too hot 46.5% of the day and too dry 75.8%.
- **Drying.** Opening the vent with one fan closes 44% of the moisture gap to outdoors within three minutes. On
  October and November nights the house needed to exchange a median 23% of its air to reach the band, and the
  outdoor air was dry enough on every one of them.
- **Deep cold.** The only winter on record (2025-26) ran without the electric heater (section 5.4). On 23 to
  26 January 2026 the furnace ran at 95% duty or more for 48 hours, and below 0 °F outdoors (6.9 hours on two days) the
  house averaged 3.9 °F below its setpoint, which is inferred: no band was recorded that winter.

## 5. Why the band is missed

### 5.1 Wet nights

**How much.** Too wet 29.9% of graded time over the record (27.5 to 28.9% in an independent recount that fills
the June and July gaps differently), 48.2% in October and 45.7% in November. At night: 76.1% of the time
from 2026-10-03 until the night dry-out went live on 2026-11-06, and 55.9% since.

**The outdoor air is dry enough and the vent can move it.** The outdoor dew point was at least 3 °F below the
indoor dew point for 100% of October and November night time. The house needed a median air exchange of 23%
(90th percentile 49%), which the vent and one fan deliver in minutes. What is missing is the heat to warm that
air, a median 16 °F colder than the house: the electric heater is already saturated, and the furnace is not
allowed to run for humidity.

**Why nothing acts.** Two paths can dry the house, and both are closed on a cold night.

1. *The older dehumidify path.* It may open the vent only when VPD is 0.14 kPa below the edge, and then only if
   venting would not over-cool the house. The over-cool test (mixed-air temperature
   `T + 0.30 × (T_out − T)` below the band low, `firmware/lib/greenhouse_logic.h:226,239`) and the hold floor
   (`:250-253`, `:959-960`) cover 76% of the wet time in the current firmware era.
2. *The night dry-out* (#1365, live 2026-11-06). It vents for 120 seconds, then rests 780 seconds. A pulse may
   start only when the house is at least 1.0 °F above the band low (`:371`). That one condition blocked it for
   87% of the wet night time since 2026-11-06, while the electric heater ran at 98% duty. It also stops while
   the furnace latch is set (`:370`), because gas never runs for humidity (ADR-0004, amendment of 2026-11-05, item 2;
   `greenhouse_logic.h:320`).

So on a night colder than about 50 °F outdoors the electric heater is saturated, the house floats just above
the band low between furnace cycles, and neither path is allowed to vent. The temperature band is held and the
humidity band is given up. That is a policy, written down in the ADR-0004 amendment of
2026-11-05; this review's point is what it costs.

**What the dry-out does when it runs.** 130 pulses on 10 nights. The median pulse takes the house down
1.5 °F and 7.8 RH points (the 31% of pulses that start as the furnace unlatches show no temperature dip); 70% of
the RH drop, and half of the absolute-humidity drop, is back within 10 to 13 minutes. Deep-night median VPD rose from 0.530 to
0.744 kPa. Night VPD in band rose from 13.6% to 39.4%; adjusted for the drier weather the gain is 12.3 points
(95% interval -2.5 to +26.0). Its acceptance flag, `night_dried_out` (at least 240 of the 360 minutes after
midnight at or above the floor), has been false on all 10 nights.

**A defect in it.** At the end of 117 of 130 pulses (90%) the electric heater was forced off, 114 times for
exactly 180 seconds. The relay-conflict rule (`greenhouse_logic.h:2963-3011` in `main`; the same logic is
inline in `controls.yaml` on the flashed build, where 117 of the 130 pulses ran) exempts heat from the
heat-and-air interlock only in `SAFETY_HEAT` and `DEHUM_VENT`; on the first tick of the rest phase the vent and fan are still
physically on, so the heater is cut and then waits out its minimum off time. The written rule says the rest
phase is when the heater reheats. This costs 35 minutes and 0.84 to 0.99 kWh of heat a night. The heater is
saturated, so that heat is lost, not postponed, and a furnace start follows within 10 minutes after 27% of
pulses. The unit test for the rest phase does not pass through the arbiter.

**Where the moisture comes from is not measured.** The autumn moisture surplus is 1.4 to 1.6 times last
winter's at the same water use. `drip_wall` runs at about 06:54 MST, the daily VPD minimum, and raises RH by a
median 25 points for about an hour. The two worst days of the autumn (2026-10-26 and 10-27, 12% and 11% in
band) follow occupancy and leak flags; hand watering is inferred. The winter surplus does not follow furnace
duty (r = 0.13), so there is no evidence that combustion adds moisture.

**It aims at the line it is graded against.** A pulse may start only once VPD is below the floor
(`greenhouse_logic.h:368`), and the nightly grade counts the minutes at or above the same floor. A rule that
acts only below a line leaves the house below it for much of the time it is working. In simulation a dry-out
that works to 0.05 kPa above the floor passes 3 to 10 points more nights after step 2, and an existing setting,
`night_vpd_bias_kpa`, lifts the controller's line and not the grade's: the same result after step 2, a smaller
one on today's firmware (section 9.7).

**What the night floor is for.** The night low edge (0.72 to 0.76 kPa, which needs RH at or below 61 to 65%;
the closed house sits at a median 67 to 71%) is a decision, not a research value. The W5 research proposed
0.50 kPa. Jason kept the floor at 0.74 kPa on 2026-11-05 so that the house dries out overnight, which also
helps with algae on the floor (`docs/design/dashboard/decisions.md`; ADR-0004, amendment of 2026-11-05, which
calls it a hard goal and not a cost trade-off). It is enforced in four places: the anchors carry it, the band
editor refuses a lower solar-midnight anchor (`verdify_schemas/band_profile.py:42-44`, `:262-272`), the firmware's dry-out
works to the larger of the band edge and 0.74 kPa (`greenhouse_logic.h:323-334`), and the nightly grade counts
the minutes at or above that floor between 00:00 and 06:00 and passes a night at 240
(`db/migrations/305-band-nightly-dryout.sql`). Scored that way, the record passes none of the 31 October
nights and none of the 15 November nights (section 9.7). Whether the floor is right for the crop is outside
this review: house-average RH never exceeded 90% at night all year, but one probe did for 60.7 hours, and no
glazing or leaf temperature is measured, so no condensation claim is made in either direction.

**Two earlier readings, corrected.** In summer 66 to 72% of wet time sits inside the 0.14 kPa entry
hysteresis and little of it is vetoed, so the hysteresis is the binding limit. In autumn 53% sits inside it,
but the over-cool veto applies to most of that as well: removing the hysteresis alone would open at most 15% of
autumn wet time. And heating does not "outrank" dehumidify venting: in these
conditions the dehumidify action is not eligible at all.

### 5.2 Dry and hot afternoons

**Too dry is mostly cycling and late starts.** 697 hours in 2,143 episodes; the median episode lasts 5 minutes
and 90% last under 30. Fog was running flat out for only 16.4% of the dry time; fog and misters were cycling
for 60% of it, and 22% had no wetting running. The cause is where wetting starts:

- With the vent open, the fog relay fires at `vpd_high − 0.25 × width + fog_escalation_kpa`
  (`greenhouse_logic.h:2634, 2722`), while the decision layer asks for an excess of `fog_escalation_kpa` over
  the edge (`:1005`). In the 95-day readback `fog_escalation_kpa` moved between 0.1 and 0.5 kPa. At 0.5 the house must be
  0.4 kPa past the edge of a 0.43 kPa band before fog helps.
- The mister water budget flag was set for 134.3 hours on 20 days since April (10 of them in August); in the
  1,055 flagged minutes that have a served band, VPD was above the band 53% of the time. The 120-minute daily cap on the centre misters was reached on 22 of 94 misting days.

**Too hot is mostly capacity.** 55.4% of the too-hot time had the vent and both fans fully on. The test does
not ask whether fog was running, and fog adds about 7 °F of cooling under sun, so part of those hours was
recoverable (the lockout below is counted in them). Under the
current firmware the control-limited too-hot time is 25 minutes in 1,043 hours. No hot-side control change is
indicated; the unreachable hours should be reported separately instead of as control error.

**2026-09-04.** The misters stopped at 14:22 MDT on their daily cap, reported as `below_threshold`, and stayed
off until 21:40. At 14:57
fog was blocked because the house had passed 90 °F: fog was allowed only up to the safety maximum minus 5 °F,
and the safety maximum was sitting at its boot default of 95 °F because the dispatcher had delivered nothing
since a reboot two days earlier. Until 18:13 the vent and both fans ran with no evaporative cooling. The house
reached 100.6 °F with 90 to 94.5 °F outside, and VPD 5.4 kPa. When fog resumed the house fell from 90.0 °F by
8 °F in 15 minutes and 10 °F in 22 minutes, while the outdoor air cooled 2.4 °F and the sun went down. The fog gate was fixed on 2026-09-27 (#778). Three smaller gates remain: misters stop at
95 °F, the block reason does not name the duty cap, and the soft water budget withholds fog above the band
unless VPD exceeds 2.5 kPa.

**A proposal tested and rejected.** The code audit found the vent open with outdoor air warmer than indoor for
128 of 286 ventilation hours and proposed an outdoor-cooler check. Simulated in the two-axis test controller of
section 9.9, that check is harmful (summer compliance 58.0 / 57.2 against 68.1 / 63.9 for the same controller
without it, peak 97 / 98 °F against 86 / 87 °F): moving air and fog still cool the house when the outdoor air is
warmer. It was not simulated on the current firmware. It is not in the backlog.

### 5.3 Furnace cycles start below the band

The furnace latch sets when the house is below the band low and clears at the heat target
(`greenhouse_logic.h:1645-1646`). Measured this autumn: on at band low + 0.00 °F, off at + 2.51 °F, burns of 10
to 11 minutes. Every furnace cycle therefore begins with the house already out of band, and the furnace takes
time to deliver heat.

The record shows only 18.7 hours too cold in 5.6 months, because the autumn was mild (three hours below 35 °F
outdoors). Simulated over a full winter the house is below the band 3.0 / 4.1% of October to April, and
8.7 / 9.7% of January.

The electric heater's thermostat has no hysteresis (on at low + 3.47 °F, off at + 3.49 °F) and is limited only
by its dwell timers (180 seconds off, 120 seconds on): 16.7 cycles a day in October and 27.6 a day now, about
half of them forced by the dry-out pulse ends. A resistive load tolerates that; the relay's contact life at
that rate was not assessed.

### 5.4 Operational faults

| Fault | When | Effect | Found by | State now |
|---|---|---|---|---|
| Electric heater delivered no heat with its relay on | 2025-10-26/27 to 2026-05-23 07:30 MDT, 209 days | About 3,340 relay hours and 4,800 kWh nominal. Where the meter record allows the comparison (from 2025-11-13: 2,784 relay hours, 4,000 kWh nominal) the heater circuit drew about 52 kWh. The furnace carried the whole winter. Energy and cost estimates for the period are wrong. | Not recorded (the heater was restored on 2026-05-23); extent found by this review | Heater works. No rule fires on "relay on, no load". The one relay-against-load rule (`heat_manual_override`) checks the opposite case and has been inert since 2026-09-26, because the column it reads is now written empty. |
| Controller clock wrong | 2026-07-05 to 2026-09-30, 87 days; 65 minutes or more fast on 59 of them: +117 minutes from 07-25 to 08-19, +65 to +108 minutes from 08-28 to 09-30 | The band was served early; temperature compliance about 2 to 3 points lower (1.7 to 3.4 by month). The grading record is computed on the server and could not see it. | Fixed on 2026-09-30 as a time-sync fault; size and effect found by this review | Fixed in the 2026-09-30 build. It can recur: a retained clock is trusted without a time sync, and no alert compares the two clocks. |
| Planner output not delivered | 44 of the 94 days from 2026-08-13 to 2026-11-14, all between 2026-09-03 and 2026-10-31, in five freezes; the longest lasted 23.9 and 13.4 days | The controller stayed on its last or boot values. 159 plans were written, scored and learned from. | A person, each time | The gate was replaced on 2026-11-02 (PR #1199). The stall alert is a warning and pages no one. |
| Boot defaults in force | 2026-09-02 23:20 MDT to 2026-09-26 (24 days), and 2026-10-29 16:22 MDT to 11-01 | Safety maximum 95 °F instead of 100, safety minimum 45 instead of 40, direct-wet minimum temperature 0 instead of 65. Night VPD in band was about 16 points lower on boot-default days than on delivered days (95% interval 7 to 26; season and reboots cannot be separated from it). | This review | Two defaults corrected in `main`; the third still boots at 0. |
| Fog and misters locked out | 2026-09-04: misters 14:22 to 21:40 MDT (daily cap), fog 14:57 to 18:13 MDT (temperature gate) | 100.6 °F and 5.4 kPa indoors. | Fog gate: #778 (2026-09-27). Mister cap, label and budget gates: this review | Fog gate fixed 2026-09-27; mister cap and budget gates remain. |
| Heater forced off at dry-out pulse ends | Every night since 2026-11-06 | 35 minutes and about 0.9 kWh of heat a night; extra furnace starts. | This review | Open. |
| Telemetry frozen | Indoor 27.8 hours on 2026-08-09/10; outdoor 53 hours on 2026-09-06 to 09-08 | Stored with no stale marker. The system's grading table (from 2026-09-01) graded 29 minutes of frozen indoor data, on 2026-09-15. | This review | Open. |
| Planner outages | 25 days in five runs, June to August | No plan on those days; required triggers produced a plan 43% of the time in June. | Existing alerts | 97 to 99% since September. |

All but the planner outages left the system looking alive: telemetry flowed, the heartbeat was touched, relays
clicked.
What was missing each time was a comparison of what was commanded with what happened: relay against load,
plan against readback, controller clock against server clock.

## 6. Firmware: what runs and what does not

### 6.1 What runs

The behaviour that reaches the relays is small:

- electric heater on below band low + 3.5 °F; furnace latched on below band low, off at the heat target;
- vent and fans when the house is above the band high, with a second-fan stage;
- fog and the centre misters when VPD is above the band, in two contexts (house closed, vent open);
- the dehumidify vent and, since 2026-11-06, the night dry-out;
- safety heating and cooling at fixed limits, and one relay-conflict arbiter in front of the relays.

Around it sits a decision layer whose structure the record does not use:

- **Candidate ranking** (`evaluate_climate_decision`, `greenhouse_logic.h:895-1090`) is a fixed ladder. Each
  candidate carries a resource cost, a relay-churn cost and a confidence that are written and never read.
- **Sealed misting** is, in practice, a fog burst and a wait: 54.5 of 83.2 sealed hours carry the reason
  `dwell_hold`; fog ran for 2.9 of the 61.1 hours with that reason; and the two sealed mister stages ran 0.45
  hours in 95 days.
- **Four separate comparisons of indoor with outdoor air** (enthalpy economiser, moisture-exchange estimate,
  dry-out dew-point margin, summer-vent deltas). The economiser has not blocked anything since April.
- **Second-fan staging is encoded twice**, as a latch with two thresholds and as a switch that overrides it.
- **The mister state machine** is about 720 lines of YAML outside the host-tested headers; about 150 of them
  are three overlapping zone-choice mechanisms. All five selectors pick the centre zone, the only one that has
  run since 2026-07-10.

### 6.2 Unreachable and inert code

| Item | Size | Evidence |
|---|---|---|
| Legacy mode cascade and thermal relief | 468 lines (`greenhouse_logic.h:2042-2509`); 82 of the 131 `determine_mode` tests run only this path and must be re-pointed or removed | The state machine is forced on at every tick (`controls.yaml:664-669`). Legacy mode labels were last seen on 2026-04-27. Deletion was recommended four times. |
| Setpoint fields with no effect | 26 of 74 | Code reading finds no read on the production path, and a native harness that varied each field over 640,000 ticks changed no relay, mode or mist stage (four fields change only a telemetry label). The planner still pushes three of them (913 rows since 2026-08-13). |
| Retired settings still declared | 17 entities and 27 readbacks | Marked retired in the registry; still published and stored. |
| Retired helpers, constant-return shims and label-only override logic | About 115 lines besides the burst helpers below | Functions with no caller, a fixed return value or a label-only result. |
| Dawn and midday burst code | About 250 lines | The decision function always returns "none". |
| Policy-vector engine | 1,948 lines, about 167 gated read sites, ticking every second | Switched off; all five delivery tables are empty. |
| L01 irrigation bridge (ingestor) | 448 lines and 1,984 test lines | Never executed in production. |
| Missing-probe fault branch | 28 lines | Missing values are replaced by 65 °F and 50% before the check, so it cannot be true. |

Removal is not free of coupling. The irrigation engine uses `policy_hex_decode` from `policy_vector.h` and
`policy_sha256.h`, which must stay. Five of the 26 inert fields are policy wire fields with permanent ids, so
removing them needs a wire schema change; the smaller step is to make them non-pushable. The engine command
path still imports a constant from the bridge block (`_BRIDGE_FENCE_REASONS`, `ingestor/esp32_push.py:1749`),
the rollback paragraph of `AGENTS.md` still names the bridge as the fallback, and the rollback firmware has not
been confirmed to be an engine build. The issues in section 12 carry these blockers.

### 6.3 Settings and readbacks

| Surface | Count | Never changed in the readback window |
|---|---:|---:|
| Setpoint fields passed to the control law | 74 | 26 have no effect at all |
| Setting entities on the controller (`main` / flashed build) | 128 / 139 | 84 of 128; 83 equal the compiled default |
| Readbacks published every 30 seconds (`main` / flashed build) | 187 / 193 | 139 |
| Band parameters | 60 | 50 |
| Parameters the planner writes per waypoint | 39 | 15 (in 345 plans) |

The window is 95 days (90 for plans). 16 of the 84 entities and 11 of the 139 readbacks were added later and
have 10 to 78 days of history. Three consequences:

- **Volume.** By the configured intervals, readbacks are about two thirds of what the controller publishes.
  Stored every minute, they are 31.9 million rows in 95 days: 57% belong to settings that never changed and
  another 21% to settings that changed on five days or fewer.
- **Memory.** Heap is no longer the constraint. On the current build the lowest hourly free heap is 31.6 kB
  over 200 hours, just under the 32 kB release floor, with no watchdog reboot (the 8.5 kB lifetime minimum is
  the boot watermark). The July simplification proposal called 38 to 44 kB healthy, and the target stopped
  being tracked when its issues were closed.
- **Reboots.** 117 of 128 settings (128 of 139 on the flashed build) are not kept across a restart. Until the
  dispatcher pushes them again the controller runs on compiled defaults. The reboot of 2026-09-02 reset 37
  settings, and for 21 the steady production value differs from the compiled default (three of them are in
  section 5.4).

The flashed build (`2026.11.7.0133.9517acb6`) is behind `main`: the changes merged on 2026-11-07 (PR #1494) are
not on the controller, and the issues that tracked the flash were closed in the backlog reset.

### 6.4 Irrigation

The irrigation engine has run on the controller since 2026-11-03. Production has exercised one of its four run
kinds, three of seven outcomes and two of twenty reason codes; the fertilizer sequence, mist windows and
multi-zone paths have never run. Its three backup slots write a "skipped" outcome every day into an eight-entry
ring. The command path polls the database every five seconds, about 100,000 queries a day, for 18 commands in
12 days. No drip decision uses a soil or plant measurement, by design (ADR-0011, decision 5), and only one of
three soil probes still reports. Automatic drip did not run for 159 days of the growing season.

### 6.5 Documents

`docs/firmware-fsm-spec.md` no longer matches the code: its line references are stale, it gives the mist stages
in the old order in one place (section 3.1) and the current order in another (section 7.6), and its relay
protection table disagrees with the live values. `firmware/DESIGN.md` states a
five-second decision loop; it is one second. `AGENTS.md` still waits for an engine promotion (#1165) that was
closed, and names a post-sync readiness job that the production overlay no longer includes.

## 7. Planner

### 7.1 Delivery

On 44 of the 94 days from 2026-08-13 to 2026-11-14 no planner value was confirmed on the controller. The
planner kept working: 159 plans, each scored, and 33 lessons, all still active. The cause was in the
dispatcher (section 8.1) and is fixed; the alert that should catch a repeat does not page.

### 7.2 Measured effect

The undelivered days are the only natural experiment in the record. Checked adversarially, they support two
statements and no more:

- **Delivering sensible settings probably beats boot defaults**: +8.4 points of both-in-band time (95% interval
  +3.8 to +13.1; randomization p = 0.05), +16.5 points on night VPD (+6.9 to +26.0; p = 0.09). Season and
  reboots cannot be separated from it.
- **Re-planning shows no measurable benefit over holding the last plan**: fresh against stale +1.7 points
  (-5.7 to +9.1). Days with large plan changes against days with small ones: -1.5 (-7.5 to +4.4).

The fresh-against-stale comparison cannot detect an effect smaller than 10 to 16 points (delivered against
undelivered: 6 to 9), and it was measured in October, when misters, fog and vents hardly ran. Neither comparison
is clean: in September "undelivered" also meant boot defaults, reboots on 12 of those days and later weather;
in the October firmware era (10-03 to 11-02) the delivered days were live for only 49% of the day.

### 7.3 What the planner changes

- The planner fills a 15-field intent per waypoint, and a fixed mapping
  (`verdify_schemas/climate_intent.py:554-652`) turns it into 39 settings. 15 of the 39 had one value in the
  last 345 plans. Six move in exact lock-step: each is `a + b × relay_churn_penalty`. The 24 that vary have 3 to
  8 effective dimensions.
- Half of all plan-by-parameter rows repeat the previous plan. 16 to 17% of changes are reversed within 24
  hours.
- From 2026-11-01 to 11-14, 84% of the 3,003 confirmed changed plan rows were mister, fog and direct-wet
  settings (about half of the plan rows in this period are the guardrail and the planner overwriting each
  other, section 7.5), in a period when the centre mister fired 12 times and fog ran 87 minutes. None touched heating,
  dehumidification or the band, and the miss was wet air (VPD below the band 45% of the time, above it 0.5%).
- The one band lever the planner holds, `night_vpd_bias_kpa`, has been 0 on the controller for 95 days.
  Section 9.7 tests it: on top of the step 2 release, 0.10 kPa from October to April gives the same nights as
  the 0.05 kPa firmware margin proposed there; on today's firmware it gains less (2 / 17 more nights of 195).

Section 9.4 shows what the tuning range of 20 of these settings is worth in simulation: a standard deviation of
1.6 to 1.9 points of both-in-band time over the year (1.4 to 3.0 by season).

### 7.4 Scoring and lessons

- The outcome score is a number the model passes to `plan_evaluate`. Up to 2026-09-29 it averaged 6.62 on
  undelivered days against 4.42 on delivered days; the anchor score 7.77 against 2.77. In October the two were
  equal.
- Until migration 309 the evaluations were graded on the retired crop band: in October they quoted 11.8%
  temperature compliance where the served band was met 98.9% of the time.
- Scores and served-band compliance correlate negatively across the whole period (-0.27 and -0.34) only
  because the regimes differ: with the era means removed it is -0.12 and -0.10, not significant. By era it is
  -0.04 and -0.17 (to 09-29), -0.29 and -0.37 (October, with the anchor score at its floor) and +0.60 and +0.69
  (November, 12 days). The scores are not systematically inverted; they are not informative either.
- 314 lessons, 229 active; 87% were validated exactly once and none has been retired since June. 33 were
  created on days when nothing was delivered; 21 concern cost, which is out of the reward (#1623). Six lessons were created in October and none
  in November. The knowledge index the prompt tells the model to search has been frozen since 2026-11-06.

### 7.5 The moisture guardrail

When VPD is above its trigger band, or near the top of it while ventilating, the dispatcher caps seven of the
planner's mister and fog settings: a value above the cap is replaced, a value at or below it passes. Two caps
follow the band (high edge + 0.05 and + 0.25 kPa) and five are constants. It has logged 62,404 clamp events
since May 2026 (4,633 in the first half of November). In the 94-day window it fired on 45 of the 48 days it
counts as active, and on all seven settings on 27 of them. Two problems:

- **It watches the wrong band.** Its trigger is a second house band whose high edge is capped at the
  highest zone VPD target, not the served house band (`ingestor/tasks/dispatcher.py:1099-1106`). From 2026-11-03
  to 11-14 it fired in a median of 11.5 different clock hours a day, while VPD was above the served band 0.55%
  of the time. This departs from the one-band decision (#1627).
- **It fights the planner.** From 2026-11-02 to 11-14, 51% of plan rows are A-B-A reversals, nine in ten of
  them on the seven guardrailed settings, flipping between the planner's value and the guardrail's, and the anchor score then penalises the planner for the clamp.

The guardrail's two band offsets (+0.05 and +0.25 kPa) equal the planner's median intent; its timing caps are
below what the planner asks (pulse gap 30 s against 45, minimum fog off 60 s against 85). Fixed constants would
end the argument.

### 7.6 Runs, idle planners and cost

- 505 of 960 transition, solar-noon and forecast-deviation wake-ups ended in an acknowledgement with no change.
  185 of them were forecast-deviation wake-ups, which have had to write a plan since October; for the other two
  kinds the share is 320 of 584 (55%).
- Every waypoint of a plan, up to 72 hours ahead, is computed against the band at the moment the plan is
  written.
- No token or cost figure is recorded for successful production planner runs (four failed runs carry usage:
  0.65 to 1.74 million cumulative input tokens). The only latency on record is delivery to plan written, a
  median of 1.9 minutes. The shadow planner's rows show a
  median of 11,690 input and 11,217 output tokens (9,552 of them reasoning) and 220 seconds per run.
- `planner_graph` (7,457 lines of Python, about 8,300 with its memory ingest and deploy component; its own
  deployment) has written no row. The live planner's trigger routing table (`ingestor/planner_routing.py:111`)
  is dead as well: it maps every key to one value. The shadow planner returned a valid plan on 59% of triggers overall and 91% since 2026-11-08.
- The forecast-action engine has logged 142,434 evaluations, 99.0% of them no-ops. Its device writes since May are three
  constants the planner also owns (98.9% of all its writes); the last was on 2026-10-05. It can no longer act
  on cold (both freeze rules write a band-owned value and are skipped), and it still posts alerts.

## 8. Data path, experiment scaffolding and observability

### 8.1 Dispatcher and stores

**Why delivery stopped.** One fail-closed gate limited the dispatcher to 12 commands. After a watchdog reboot
on 2026-09-02 at 23:20 MDT the controller needed 40 settings restored; the gate refused, and delivery
deadlocked for 23.9 days. In October a staged-reconcile variant of the same gate latched a "halted" state file
three times, the last for 13.4 days, until it was cleared by hand on 2026-11-01. The gate returned before any
row was written, raised no alert and still touched the heartbeat. PR #1199 replaced it with a paced restore,
live since 2026-11-02 (18:17 MST); a 40-value restore on 2026-11-06 took 2 minutes 41 seconds, and no gap has exceeded
four hours since.

What remains: the stall alert (`setpoint_delivery_stuck`) is a warning and only criticals page; it has never
fired, so its delivery is untested; it reads the dispatcher's own memory; and it is muted in one hold state. A check that needs nothing from the dispatcher,
"the newest plan is older than 30 minutes and nothing has been confirmed since", would have had no false
positive in the healthy periods (0 of 76 plans) and would have fired for 203 of the 234 plans written during
the freeze period.

**Stores.**

- `setpoint_snapshot` stores every readback every minute: 962 MB in 95 days. The 56 band parameters alone are
  80,640 unchanged rows a day.
- Six grow-light entities are 56% of `system_state` (1.5 of 2.7 million rows) for two to nine real changes a
  day.
- Of 732,213 `setpoint_changes` rows, 76% came from the band source, 80% of those in June and July. At least
  325,318 (44% of all rows) were re-assertions of unchanged band anchors between 2026-06-16 and 2026-07-11.
  That is fixed. The remaining
  band traffic is four zone VPD targets pushed about 320 times a day, which the controller already computes.
- `weather_forecast` is rewritten row by row every hour and is 763 MB.
- The band curve is implemented four times (controller, ingestor, SQL, schema package) and the same defaults
  are hard-coded in several places, one of them stale.

### 8.2 Experiment scaffolding

Two generations of experiment machinery are deployed and switched off:

- about 118,000 lines by name (about 26,000 of them migrations and their tests; the 34 applied migrations,
  21,671 lines, must stay), 71 tables, about 175 functions, 97 triggers, 17 views and 14 roles;
- three Deployments, 80 days old, that log only "inactive" (the experiment record was closed on 2026-09-30),
  and a pre-sync hook Job with its ConfigMap on every full production sync;
- seven of the ingestor's 27 scheduled tasks, about a fifth of its code, on the single device writer. In addition, two
  hooks outside the task list (the C1 overlay and the drift probe) poll a file every second, write preview
  files on dispatcher passes and can hold the dispatcher;
- `fixed_panel_native_events`: 2,880 MiB, 30.8% of the database before migration 309, growing 60 to 61 MiB
  a day toward about 11 GB at its 180-day retention. Both of its readers (the nightly freezer and the scorecard
  function) return "unavailable";
- a 1,948-line policy engine in the controller's control loop (section 6.2);
- a digital twin that was never deployed and is still compiled and tested in CI, and a finished research
  package of about 16,000 lines of code (already counted above) and 80,000 lines of stored results in the
  product repository.

The removal has an order, and getting it wrong can hold the planner's settings or fail a sync: configuration
first, then the code release, then the manifests, then one drop migration, and the firmware last. Section 10.3 gives the order; the issues in section 12 carry the details.

One part of it is live. The relay record (`equipment_state`) is written through a collector login, a duty role
and functions that carry the experiment's names, and in production the ingestor refuses to start without that
login (`ingestor/ingestor.py:5329-5330`). The removal keeps those three roles of the 14, or moves that path
first.

**A regression from today's migration.** Migration 309 dropped `weather_station`. The
`verdify-winter-feasibility` CronJob still reads it (`research/planner-efficacy/winter_feasibility.py:79`) and
will fail every night from 2026-11-16 at 00:30 MST. Issue #782, which it
served, was closed as not planned on 2026-11-06, so the recommended fix is to retire the collector. The packet
was declared prospective to 2026-12-31, so that is Jason's call.

### 8.3 Observability and data quality

**Alerts.** 14,019 alerts since March, 99.95% of them resolved automatically, so the record cannot show whether
anyone acted. `sensor_offline` raises one alert per column per outage (a single probe produces five). Apart
from the planner outages, none of the faults in section 5.4 was reported as a fault. The alert log shows one
critical overheat alert in September, most likely from the afternoon of 2026-09-04, which reports the symptom
and not the lockout, and one warning during the September freeze (`tunable_zero_variance`), which does not
page. Three rules that cover these faults cannot be relied on:

| Rule | Why it cannot fire |
|---|---|
| `heat_manual_override` (heater load without relay) | Reads `watts_heat`, empty since 2026-09-26. It also has no mirror branch for a relay that is on with no load. |
| `band_device_db_divergence` | From migration 197 (2026-07-11) it compared server-computed band rows with the server function, so it could not see the controller. Since migration 250 (2026-09-27) its input is empty in on-chip mode and the check is skipped. |
| `setpoint_delivery_stuck` (added with PR #1199, after the freezes) | Has never fired. It would raise a warning, which does not page; it is muted in one hold state and depends on the dispatcher's memory. |

**Telemetry.**

- Dead or implausible channels: PPFD and leaf temperatures never populated; daily light integral impossible
  (109 mol a day in July) and then empty; indoor light dead since about April; CO2 pegged near 3,100 ppm since
  June; the south probe absent from about 2026-08-02 to 2026-11-14; one of three soil probes reporting, and
  its readings are flat; the site-pressure setting's stored readback showing an out-of-range 412.57 hPa on 24
  days (cause unknown).
- Frozen data is stored as valid (section 5.4).
- `climate_action_log` band low, high and band-error columns have been stale since 2026-07-11.
- The house average hides the zones: the north probe was inside the VPD band 36.5% of the time against 51.7%
  for the average (from 2026-06-19), and read 3.0 °F and 0.66 kPa high at midday in June and July (1.7 °F and
  0.40 kPa in August and September).

**Definitions.**

- Before migration 309, `mv_daily_kpi` compliance changed meaning on 2026-09-01: August read 19.1% where the
  served band gives 43.5%. Migration 309 redefines the view; whether the step remains was not re-checked.
- Two house VPD values are stored. The mean of the per-probe VPDs (`vpd_avg`) is the one the control loop uses
  (`firmware/greenhouse/controls.yaml:273`) and the one that is graded. The VPD of the mean temperature and
  humidity is stored as `vpd_control` and labelled "Control VPD", but nothing in the firmware reads it. Graded
  against that column, June and July would differ by 3 to 4 points. The grade and the control loop agree; the
  label does not.
- Capacity-limited hours are counted as control error.

**Records.**

- `equipment_state` loses OFF events (30.1 false ON hours found by checking against the flow meter).
- Since May, two thirds of the water attributed to a consumer (21,775 of 31,955 gallons) is "ambiguous
  overlap", and the water table holds 1.37 million gallons of counter-flap rows.
- The fog power coefficient is 468 W against 710 W measured; grow lights, the furnace blower and gas are not
  metered (#1623).
- The moisture entering the house (wetting, irrigation, hand watering) is not recorded in a form that can be
  set against the humidity it causes. It is the largest uncertainty in the simulation.

## 9. Simulation study

The study tested eighteen hypotheses. All figures are simulated, for both model variants (A / B), as the share
of a year with temperature and VPD inside the served band.

| # | Hypothesis | Test | Result | Verdict |
|---|---|---|---|---|
| 1 | Seasonal re-tuning by the planner improves compliance | The July settings held all year; 30 random vectors in the planner's historical ranges | 72.4 / 60.6 fixed against 71.8 / 60.6 seasonal; standard deviation 1.9 / 1.6 | Not supported |
| 2 | Wet nights are a hardware limit | The same vent and fan under different rules | 16 to 22 points come from the wet axis alone | Rejected: a rule limit |
| 3 | The night dry-out helps as built | Current firmware with and without it | 71.8 / 60.6 against 64.6 / 53.8 | Supported |
| 4 | Longer pulses inside today's limits help | Pulse 600 s, rest 300 s | 74.2 / 65.6 | Supported |
| 5 | An earlier furnace start removes the cold dips cheaply | On at band low + 0.5 °F, off at + 3.0 °F | Time below band 1.9 / 2.5% to 0.5 / 0.5% for 0.2 therms a day | Supported |
| 6 | The pulse-end interlock costs compliance | Exempt the dry-out's own run-out | 71.8 / 60.7; heater cycles halved | Not supported: fix it for wear and correctness |
| 7 | Fog should start at the band edge | Fog escalation 0.1 and 0.5 kPa | +4.4 / +4.6 and -2.4 / -1.0 points | Supported |
| 8 | The mister water budget costs compliance | Budget 100 gal; no budget | -3.5 / -2.8 points at 100 gal; peak 5 °F lower with none | Supported |
| 9 | Venting only when outdoors is cooler helps | Outdoor-cooler check on the cooling vent of the two-axis test controller | Summer 58.0 / 57.2 against 68.1 / 63.9 without it; peak 97 / 98 °F against 86 / 87 | Rejected: harmful |
| 10 | A night temperature setback saves energy for free | Temperature low edge 2 and 4 °F lower at solar midnight | -1.3 to -3.0 points; under 1 kWh a day saved | Rejected |
| 11 | Two axes with fixed constants can match the current stack | Two-axis controller, 22 constants | 83.5 / 80.3 against 71.8 / 60.6 | Supported |
| 12 | The same gain is reachable by patching the existing firmware | Three small code changes (interlock, furnace thresholds, dry-out) and fixed wetting constants | 85.6 / 82.5 (81.8 / 78.3 from the code changes alone) | Supported: patch first |
| 13 | The gain survives a wrong model | Nine one-factor changes to the physics, two-axis controller against current firmware | Gain +7 to +42 points in every case | Supported |
| 14 | Where the band sits matters more than tuning | VPD low edge moved by 0.10 kPa | +7 / +12 lower at night only; +8 / +13 lower at all hours; -11 / -15 higher at all hours | Supported for the grade only: the night air does not change (section 9.7) |
| 15 | A dry-out that aims above its floor meets the night goal more often | After step 2, start a pulse below the floor + 0.05 kPa | 92 / 84% of October-to-April nights dry out against 89 / 74% | Supported |
| 16 | A warmer night meets the night goal | After step 2, temperature low edge 2 °F higher at night | 96 / 86% against 89 / 74%, for 0.25 to 0.4 therms a day in those months | Supported in the model; the autumn measurement says less (section 9.7) |
| 17 | More air during the dry-out meets the night goal more often | After step 2, both fans in a pulse instead of one | 92 / 84% against 89 / 74%; 91 / 79% with the second fan at its lower fitted flow | Supported; the size depends on the second fan's flow |
| 18 | An existing setting can aim the dry-out above its floor with no firmware | `night_vpd_bias_kpa` 0.10 from October to April, after step 1 and after step 2 | 77 / 53% of October-to-April nights against 76 / 45% after step 1; 92 / 84% against 89 / 74% after step 2, the same as the firmware constant | Supported after step 2, where it equals the constant; on today's firmware the gain is within the noise in A (2 more nights of 195) and 17 more nights in B, none of them in November. Held through the summer it costs 1.4 to 2.3 points there |

### 9.1 Model

**Physics** (`control-review-2026-11-15/sim/physics.h`, 38 parameters). Three thermal nodes: the air with its
fast surfaces, an intermediate mass (plants, benches, pots, framing) and a slow mass (floor and soil). Air
moisture with a sorption buffer, a wet-surface reservoir filled by fog and mister deposition, light-driven
transpiration and condensation on the glazing. A two-stage lag for the furnace, lags for the sensors, and a
term for the probes sitting in the furnace's throw.

**Fit.** The model was fitted to the one-minute record with the recorded relay states and weather as inputs,
by minimising the error of two-day free-running simulations, with every fourth week held out. Three fits:

- cool season, 2026-09-28 to 2026-11-16;
- summer, 2026-06-01 to 2026-09-16;
- winter, 2025-12-01 to 2026-03-12 together with autumn 2026. The electric heater's output is set to zero for
  that winter because it delivered none (section 5.4).

Only data after 2026-05-23 can teach the model what the electric heater does. The fitted furnace reproduces the
timing of the measured heating cycles (correlation 0.89) and about two thirds of their size (standard deviation
of the high-passed temperature 0.59 °F against 0.92 °F measured).

Air exchange is the least certain part of the fit. In all three fits the first fan's flow ends at the lower
bound it was given (0.25 kg/s) and the vent-only exchange at its lower bound, and the second fan's flow comes
out at 0.08, 0.10 and 0.32 kg/s. Section 9.8 repeats the steps to the dry-out goal with the fan flow halved and
doubled.

**Two variants.** The moisture source is not measured, and it changed during 2026: the same model needs a
source scale of 0.95 to match October and 1.4 to match 6 to 15 November. So every scenario is run twice:

- **A**: drier in the cold season. Winter fit with source scale 0.95; the cool-season fit for May to September,
  which gives the milder summer.
- **B**: wetter in the cold season, hotter and drier in summer. Winter fit with source scale 1.4; the summer
  fit for May to September.

**Closed loop** (`sim/closed_loop.cpp`). The simulator compiles the production headers in `firmware/lib`
unchanged: the state machine, the equipment resolution and the relay-conflict arbiter are the shipped code. The
relay layer that lives in the ESPHome YAML (minimum on and off times, the fog and vent interlock, the water
budget and a reduced centre-mister pulse timer) is re-implemented in the simulator. The headers are those of
`main` (commit `ae486ddb`), one merge ahead of the build on the controller; that merge moved the relay-conflict
rules into a function line for line, retired unused entities and added a light sensor (section 6.3). It steps every five seconds through the recorded weather of 2025-11-16 to 2026-11-15
with today's band and today's house. Settings are the time-weighted medians of what the planner had on the
controller in 2026-10-15 to 11-15 (used for October to April) and in 2026-07-12 to 07-25 (May to September).
The simulated system is healthy: the clock is right, settings arrive, the heater works. The same code can score the
recorded data against today's band (section 9.2 and table A2), so that record and simulation are compared on
one definition. Section 4 grades the record against the served band of the time instead.

### 9.2 Validation

The current firmware in closed loop, against four recorded windows. The windows lie inside the fitting period,
so this tests the closed loop (the shipped control code reacting to the model), not the physics out of sample.

| Measure | 1 Oct - 6 Nov: measured / A / B | 6 - 15 Nov: measured / A / B | 12 - 24 Jul: measured / A / B | 25 Jul - 12 Aug: measured / A / B |
|---|---:|---:|---:|---:|
| Temperature in band % | 97.8 / 99.2 / 98.6 | 96.2 / 99.2 / 98.4 | 64.8 / 68.2 / 37.8 | 63.5 / 78.8 / 54.4 |
| Temperature above band % | 0.3 / 0.3 / 0.5 | 0.0 / 0.0 / 0.0 | 35.1 / 31.9 / 62.2 | 34.5 / 21.1 / 45.6 |
| VPD in band % | 48.4 / 52.0 / 35.1 | 55.2 / 91.5 / 56.8 | 57.5 / 40.0 / 20.6 | 59.6 / 49.0 / 36.1 |
| VPD below band % | 49.5 / 44.8 / 63.3 | 44.2 / 5.6 / 43.1 | 9.6 / 15.3 / 7.1 | 10.5 / 19.7 / 7.0 |
| VPD above band % | 2.1 / 3.2 / 1.5 | 0.6 / 2.9 / 0.1 | 32.9 / 44.8 / 72.3 | 29.9 / 31.3 / 56.9 |
| VPD below band at night % | 76.7 / 74.7 / 93.0 | 57.9 / 9.6 / 69.8 | 16.9 / 23.5 / 9.5 | 14.2 / 32.8 / 8.7 |
| Electric heater h/day | 14.8 / 14.0 / 16.8 | 20.4 / 18.6 / 19.4 | 0.1 / 0.1 / 0.0 | 1.2 / 1.3 / 0.8 |
| Furnace h/day | 1.7 / 1.2 / 1.8 | 3.7 / 1.8 / 2.8 | 0.0 / 0.0 / 0.0 | 0.0 / 0.1 / 0.0 |
| Vent h/day | 0.4 / 1.1 / 2.1 | 0.6 / 0.1 / 0.4 | 13.9 / 14.6 / 19.9 | 11.3 / 10.2 / 16.2 |
| Fog h/day | 0.4 / 0.3 / 0.0 | 0.1 / 0.4 / 0.0 | 5.5 / 2.9 / 4.4 | 3.4 / 2.3 / 3.9 |
| kWh/day | 21.5 / 20.4 / 24.4 | 29.4 / 27.0 / 27.9 | 6.8 / 5.2 / 7.6 | 6.3 / 5.6 / 7.4 |
| Therms/day | 1.3 / 0.9 / 1.3 | 2.8 / 1.4 / 2.1 | 0.0 / 0.0 / 0.0 | 0.0 / 0.1 / 0.0 |
| Gal/day | 19.1 / 12.4 / 2.8 | 3.4 / 14.2 / 0.2 | 311.1 / 244.1 / 323.9 | 247.4 / 173.0 / 258.5 |
| Peak temperature °F | 85.8 / 85.6 / 85.8 | 84.7 / 82.0 / 81.6 | 91.8 / 90.0 / 91.5 | 94.1 / 91.0 / 92.2 |

The measured columns are the recorded climate scored by the simulator's code against today's band over these
windows (UTC days), so they differ from section 4.1.

- **Cool season, temperature and heat** (1 October to 6 November, before the night dry-out; 6 to 15 November,
  with it): good. In-band time is within 3 points and electric heater hours within 14%. Furnace hours in the
  second window are under-predicted (1.8 / 2.8 against 3.7 hours a day).
- **Cool season, humidity:** the variants bracket the record. Night time below the VPD band is 76.7% measured
  against 74.7 / 93.0 in the first window and 57.9% against 9.6 / 69.8 in the second. Variant A is far too dry
  for the second window; B is close.
- **Summer** (12 to 24 July; 25 July to 12 August): both variants are too dry by day in the first window. A is
  within 4 points of the temperature record in the first window and 15 points too good in the second; B is too
  hot in both. In the second window the controller's clock ran 117 minutes fast (section 5.4), which the
  simulation does not contain.

Run over the whole year and scored the same way, the current firmware simulates between 15 points below and 30
points above the recorded month, with B within 13 points in three of the six months (June to November;
Appendix A, table A2). The differences are not model error alone. The record was produced by the firmware, the
band, the settings and the faults of its time; the simulation runs today's firmware with no faults. June ran an
older controller and band. September, 22 points high in both variants, was the month of the wrong clock, the
frozen dispatcher and the boot defaults.

What follows from this:

- absolute levels are indicative only: single months are off by up to 30 points;
- a ranking is reported only when it holds under both variants;
- the gains in this section are not validated in the house. Section 10.1 is the first test;
- mid-November to April are projections. There is no record of today's house in winter: the one recorded
  winter ran without the electric heater.

### 9.3 Results

Year, both model variants:

| Scenario (model A / B) | Both in band % | Temp in band % | VPD below band % | VPD above band % | kWh/day | Therms/day | Gal/day |
|---|---:|---:|---:|---:|---:|---:|---:|
| Current firmware, today's settings | 71.8 / 60.6 | 94.9 / 92.3 | 16.2 / 27.0 | 9.7 / 9.6 | 19.6 / 21.1 | 2.2 / 2.7 | 56 / 54 |
| Current firmware without the night dry-out | 64.6 / 53.8 | 94.9 / 92.4 | 23.5 / 33.8 | 9.7 / 9.6 | 19.1 / 21.1 | 2.1 / 2.6 | 55 / 54 |
| Current firmware, July settings held all year | 72.4 / 60.6 | 94.9 / 92.4 | 16.2 / 27.2 | 9.2 / 9.4 | 19.5 / 21.1 | 2.2 / 2.7 | 56 / 54 |
| Current firmware, today's autumn settings held all year | 67.8 / 58.1 | 91.6 / 88.6 | 16.3 / 26.7 | 13.9 / 12.5 | 19.6 / 20.9 | 2.2 / 2.7 | 47 / 36 |
| Step 1a: dry-out pulse 600 s, rest 300 s | 74.2 / 65.6 | 94.8 / 91.8 | 13.8 / 22.0 | 9.7 / 9.6 | 19.8 / 21.5 | 2.2 / 2.8 | 56 / 54 |
| Wetting constants alone: fog escalation 0.1 kPa, direct-wet margin 0.25 kPa, mister budget 300 gal | 76.6 / 65.1 | 96.0 / 93.2 | 13.7 / 24.1 | 6.8 / 7.3 | 19.2 / 21.1 | 2.1 / 2.6 | 45 / 54 |
| Step 1: both of the above | 78.3 / 69.6 | 95.9 / 92.8 | 11.8 / 19.4 | 6.8 / 7.2 | 19.4 / 21.4 | 2.2 / 2.7 | 45 / 54 |
| Step 1 with the planner's other settings held at their July values | 78.9 / 69.7 | 95.9 / 92.8 | 11.8 / 19.4 | 6.3 / 7.1 | 19.4 / 21.4 | 2.2 / 2.7 | 46 / 54 |
| Step 1 with the July values and no mister budget (needs a firmware change) | 78.9 / 70.6 | 95.9 / 94.1 | 11.8 / 19.5 | 6.3 / 6.0 | 19.4 / 21.5 | 2.2 / 2.7 | 46 / 60 |
| Patch: pulse-end interlock fix | 71.8 / 60.7 | 94.9 / 92.3 | 16.2 / 26.9 | 9.8 / 9.6 | 19.9 / 21.7 | 2.1 / 2.6 | 56 / 54 |
| Patch: furnace on at low + 0.5 °F, off at low + 3.0 °F (with interlock fix) | 73.8 / 64.9 | 96.3 / 94.3 | 15.0 / 24.0 | 10.3 / 9.8 | 19.7 / 21.5 | 2.3 / 2.8 | 58 / 55 |
| Patch: dry-out from low + 0.5 °F, near-continuous (with interlock fix) | 76.2 / 69.1 | 94.8 / 92.1 | 11.8 / 18.5 | 9.7 / 9.6 | 20.0 / 21.9 | 2.3 / 2.9 | 56 / 54 |
| Patch: all three | 78.4 / 73.8 | 96.3 / 94.3 | 10.4 / 15.1 | 10.2 / 9.7 | 19.8 / 21.6 | 2.5 / 3.1 | 58 / 55 |
| Patch: all three, dry-out by day as well | 81.8 / 78.3 | 96.3 / 94.3 | 7.0 / 10.7 | 10.2 / 9.7 | 20.1 / 21.8 | 2.5 / 3.2 | 58 / 55 |
| Patch: all of the above, the wetting constants, the July values, mister budget 300 gal | 85.6 / 81.6 | 97.4 / 95.1 | 5.9 / 9.1 | 6.8 / 7.2 | 19.6 / 21.7 | 2.4 / 3.1 | 49 / 54 |
| Step 2: the same with no mister budget | 85.6 / 82.5 | 97.4 / 96.4 | 5.9 / 9.1 | 6.8 / 6.1 | 19.6 / 21.7 | 2.4 / 3.1 | 49 / 60 |
| Two-axis controller, fixed constants | 83.5 / 80.3 | 96.6 / 95.3 | 7.1 / 10.7 | 7.5 / 6.7 | 19.4 / 21.4 | 2.5 / 3.1 | 51 / 59 |
| Two-axis controller without dehumidification | 67.2 / 58.4 | 96.5 / 95.2 | 23.3 / 32.4 | 7.5 / 6.8 | 18.4 / 20.4 | 2.3 / 2.7 | 51 / 60 |

By season:

| Scenario (model A / B) | Oct-Apr both % | Oct-Apr temp below % | Oct-Apr VPD below % | Oct-Apr therms/day | Oct-Apr kWh/day | May-Sep both % | May-Sep temp above % | May-Sep VPD above % | May-Sep gal/day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Current firmware, today's settings | 80.1 / 64.8 | 3.0 / 4.1 | 11.3 / 31.2 | 3.5 / 4.2 | 27.9 / 29.2 | 61.1 / 55.2 | 7.3 / 11.6 | 14.2 / 20.6 | 94 / 120 |
| Step 1: settings | 84.5 / 74.8 | 3.0 / 4.7 | 6.2 / 21.0 | 3.4 / 4.3 | 27.3 / 29.0 | 70.3 / 62.9 | 4.9 / 9.8 | 6.7 / 15.4 | 65 / 118 |
| Step 2: patched firmware | 90.3 / 89.4 | 0.7 / 0.7 | 2.7 / 9.1 | 3.8 / 4.7 | 27.1 / 29.1 | 79.5 / 73.5 | 4.9 / 6.8 | 6.8 / 12.7 | 65 / 131 |
| Two-axis controller | 89.1 / 87.3 | 0.7 / 0.6 | 4.1 / 11.2 | 3.9 / 4.9 | 27.9 / 29.9 | 76.2 / 71.1 | 6.7 / 9.4 | 9.0 / 14.2 | 78 / 130 |

Reading the tables:

- **The night dry-out is worth 7 points** even in its present form (71.8 / 60.6 against 64.6 / 53.8 without).
- **Seasonal re-tuning is worth nothing once the right vector is fixed.** The July settings held all year score
  72.4 / 60.6; today's autumn settings held all year score 67.8 / 58.1.
- **Settings alone recover 6 to 9 points**, with no firmware change and almost no extra gas: 2 to 5 from the
  two dry-out settings and the rest from the wetting constants. The mister budget is held at 300 gallons, the
  most the firmware accepts. In the hotter variant it still binds in July: with no budget the year is 0.9
  points higher and the summer peak 5 °F lower, but that needs a firmware change.
- **The interlock fix does not change compliance** but halves electric heater relay cycles (10.5 to 5.2 and
  16.6 to 7.7 a day).
- **Starting the furnace 0.5 °F earlier** cuts time below the temperature band from 1.9 / 2.5% to 0.5 / 0.5%
  for about 0.2 therms a day.
- **Letting the dry-out run** (from band low + 0.5 °F, for as long as needed, by day as well) is the largest
  single gain: VPD below the band falls from 16.2 / 27.0% to 11.8 / 18.5% with the night dry-out patch alone,
  and to 7.0 / 10.7% with the furnace change and the daytime dry-out added.
- **The patched firmware and the two-axis controller end within about 2 points of each other** (85.6 / 82.5 and
  83.5 / 80.3).
  What separates them is the amount of code, not the result.
- **Energy.** Over the year, electricity moves by less than 1 kWh a day in every scenario that keeps
  dehumidification (step 2 uses 1.1 / 1.4 kWh a day more from May to September). Gas rises by 0.3 to 0.4 therms
  a day at step 2, 0.3 to 0.5 in October to April: 0.16 from the earlier furnace start and 0.2 to 0.3 from the
  extra venting, which brings more furnace cycles afterwards, less about 0.1 saved by the wetting constants. Water falls in variant A and rises in variant B.

### 9.4 The planner's tunables

The simulator models 20 of the 24 settings the planner varies (section 7.3); the two mister engage thresholds,
the mister VPD weight and the direct-wet switch were not varied. Each of the 20 was set to the lowest and the
highest value it took in the readback record, one at a time, with everything else at today's settings:

| Parameter | Low value | Change in both-in-band, A / B (points) | High value | Change, A / B (points) |
|---|---:|---:|---:|---:|
| `fog_escalation_kpa` | 0.1 | +4.39 / +4.55 | 0.5 | -2.42 / -0.99 |
| `water_budget_gal` | 100 | -3.46 / -2.79 | 300 | -0.01 / 0.00 |
| `direct_wet_stress_vpd_margin_kpa` | 0.05 | 0.00 / 0.00 | 0.25 | +0.97 / +2.79 |
| `fog_on` | 32 | -1.51 / -0.49 | 75 | +0.69 / +0.22 |
| `vpd_watch_dwell_s` | 45 | +0.65 / +0.13 | 82 | -0.38 / -0.11 |
| `cool_exit_hysteresis_f` | 1.42 | +0.43 / +0.52 | 2.32 | -0.58 / -0.47 |
| `fog_off` | 35 | +0.09 / +0.15 | 144 | -0.45 / -0.29 |
| `dwell_gate_ms` | 180000 | -0.35 / -0.39 | 330000 | +0.25 / +0.36 |
| `direct_wet_stress_min_dew_margin_f` | 8 | 0.00 / 0.00 | 12 | -0.38 / -0.06 |
| `pulse_on_s` | 30 | +0.12 / +0.28 | 90 | 0.00 / 0.00 |
| `cool_stage2_over_high_f` | 0.0 | +0.04 / -0.01 | 2.07 | -0.14 / -0.11 |
| `engage_delay_s` | 30 | -0.04 / -0.08 | 56 | 0.00 / +0.07 |
| `pulse_gap_s` | 18 | 0.00 / -0.01 | 60 | +0.03 / +0.07 |
| `cold_vent_guard_delta_f` | 6 | +0.06 / 0.00 | 15 | -0.03 / 0.00 |
| `cool_all_fans_at_high_enabled` | 0 | 0.00 / 0.00 | 1 | +0.03 / -0.05 |
| `vpd_hysteresis` | 0.1375 | +0.04 / +0.03 | 0.3 | 0.00 / 0.00 |
| `temp_hysteresis` | 1.0 | 0.00 / 0.00 | 2.32 | 0.00 / 0.00 |
| `mister_all_delay_s` | 60 | 0.00 / 0.00 | 300 | 0.00 / 0.00 |
| `vent_prefer_temp_delta_f` | 2 | 0.00 / 0.00 | 15 | 0.00 / 0.00 |
| `vent_prefer_dp_delta_f` | 2 | 0.00 / 0.00 | 12 | 0.00 / 0.00 |

Four parameters move the year by more than one point in at least one variant, two of them in both
(`fog_escalation_kpa` and the water budget). Nine move it by less than 0.1 in either direction. `vpd_hysteresis` does
nothing because a cap of one third of the band width (0.142 kPa) binds first.

Thirty random vectors drawn inside the same ranges:

| Period and model | Today's settings | Min | 10th pct | Median | 90th pct | Max | Std dev |
|---|---:|---:|---:|---:|---:|---:|---:|
| year, model A | 71.8 | 66.2 | 68.2 | 70.2 | 73.1 | 73.4 | 1.89 |
| year, model B | 60.6 | 57.2 | 58.6 | 59.5 | 62.4 | 63.1 | 1.57 |
| winter, model A | 80.1 | 79.4 | 79.6 | 80.8 | 83.4 | 84.1 | 1.42 |
| winter, model B | 64.8 | 64.4 | 64.5 | 64.9 | 69.3 | 69.4 | 2.13 |
| summer, model A | 61.1 | 48.8 | 52.3 | 56.6 | 58.9 | 61.3 | 2.96 |
| summer, model B | 55.2 | 47.8 | 50.6 | 52.1 | 54.0 | 55.2 | 1.57 |

The whole space the planner has explored spans six to seven points from worst to best over the year. Today's
settings sit above its median for the year and for May to September, and just below it for October to April.
Three settings matter and have one best value each, all year: fog escalation 0.1 kPa, direct-wet margin
0.25 kPa, and a mister water budget that does not bind. A fourth, the minimum fog on time, costs 0.5 to 1.5
points at its lowest value.

### 9.5 Patches to the existing firmware

The patch rows in section 9.3 were produced in three ways. Changes 2 and 3 are compile-time switches added to
a copy of `firmware/lib` (`sim/firmware-lib-sim.patch`, 85 lines): the defaults reproduce today's firmware, and
the values below are set with compiler flags when the patched binaries are built (the README lists them).
Change 1 is emulated in the simulator's relay layer (`fw.rest_exempt` in `closed_loop.cpp`), because the rule
it changes is checked against the physical state of the relays. Change 4 is settings. Two further switches in the same patch, used only in section 9.7, make the dry-out work to a margin above its
floor and run both fans during a pulse. Nothing in the
repository's firmware was changed.

1. **Pulse-end interlock:** the dry-out's own vent and fan run-out no longer forces the electric heater off.
2. **Furnace thresholds:** on below band low + 0.5 °F, off at band low + 3.0 °F.
3. **Dry-out:** start margin 0.5 °F instead of 1.0; the 300-second rest floor and the 900-second minimum cycle
   removed, and run as 600-second pulses with 30-second rests, the nearest the existing state machine comes to
   "until the edge is regained"; the nightly energy cap at the firmware maximum of 30 kWh; in the by-day build,
   allowed by day and with no energy cap.
4. **Wetting constants:** fog escalation 0.1 kPa and direct-wet margin 0.25 kPa, the mister budget at 300
   gallons or removed, and the planner's other settings held at their July values.

One caution from the heating runs: a furnace OFF threshold above the electric heater's line (band low +
3.5 °F) produced 109 / 127 furnace starts a day from October to April in the two-axis controller (68 / 79
over the year, section 9.6). The OFF threshold must stay at or below the heater's line; band low + 3.0 °F keeps
half a degree of margin.

### 9.6 The two-axis controller

A controller with two independent axes and fixed constants (section 10.4) was written into the simulator. Its
requests pass through the production relay arbiter and the simulator's copy of the relay minimum times, and the
furnace is never requested while an air relay is on. Results for the recommended constants are in section 9.3. Variations, over the year:

| Variation (model A / B) | Both in band % | Temp below band % | VPD below band % | kWh/day | Therms/day | Furnace starts/day | Gal/day | Peak °F |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Recommended: dehumidify continuously while wet, from band low + 0.5 °F | 83.5 / 80.3 | 0.5 / 0.5 | 7.1 / 10.7 | 19.4 / 21.4 | 2.5 / 3.1 | 11 / 15 | 51 / 59 | 85.8 / 86.4 |
| No dehumidification | 67.2 / 58.4 | 0.5 / 0.5 | 23.3 / 32.4 | 18.4 / 20.4 | 2.3 / 2.7 | 10 / 12 | 51 / 60 | 85.8 / 86.4 |
| Dehumidify only from band low + 1.0 °F | 80.6 / 75.0 | 0.5 / 0.5 | 10.1 / 15.9 | 19.5 / 21.5 | 2.4 / 2.9 | 10 / 14 | 51 / 59 | 85.8 / 86.4 |
| Dehumidify only from band low + 2.0 °F | 78.6 / 70.3 | 0.5 / 0.5 | 12.1 / 20.6 | 19.5 / 21.3 | 2.3 / 2.8 | 10 / 13 | 51 / 59 | 85.7 / 86.4 |
| From low + 1.0 °F, in pulses of 120 s every 15 minutes | 77.6 / 69.0 | 0.5 / 0.5 | 13.0 / 21.9 | 19.0 / 20.9 | 2.3 / 2.8 | 10 / 13 | 51 / 59 | 85.7 / 86.4 |
| From low + 1.0 °F, furnace on at band low and off at low + 2.5 °F (today's thresholds) | 78.1 / 69.6 | 1.9 / 2.5 | 11.7 / 20.1 | 19.6 / 21.6 | 2.2 / 2.7 | 10 / 13 | 48 / 58 | 85.8 / 86.4 |
| From low + 1.0 °F, furnace on at low + 1.0 °F and off at low + 3.5 °F | 83.4 / 80.7 | 0.5 / 0.5 | 6.7 / 10.0 | 18.0 / 19.5 | 2.7 / 3.4 | 12 / 16 | 53 / 60 | 85.8 / 86.4 |
| From low + 1.0 °F, furnace off at low + 4.0 °F (above the electric heater's line) | 80.9 / 78.1 | 0.5 / 0.5 | 9.1 / 12.8 | 11.9 / 13.1 | 3.4 / 3.9 | 68 / 79 | 53 / 59 | 85.8 / 86.4 |
| From low + 1.0 °F, no misters (fog only) | 81.8 / 75.5 | 0.5 / 0.5 | 6.9 / 14.3 | 18.5 / 21.4 | 2.3 / 2.9 | 10 / 13 | 49 / 53 | 85.8 / 88.7 |

- **The wet axis is worth 16 to 22 points.** Without dehumidification the controller scores 67.2 / 58.4.
- **The temperature guard on dehumidification is the main lever**: 78.6 / 70.3 from band low + 2.0 °F, 80.6 /
  75.0 from + 1.0, 83.5 / 80.3 from + 0.5. This is the same condition that blocks today's night dry-out.
- **Continuous beats pulsed** by 3 to 6 points at the same guard.
- **An earlier furnace start buys compliance with gas.** On at low + 1.0 °F gives the same compliance as the
  recommended constants for 0.3 therms a day more and 1.5 to 1.9 kWh a day less.
- **Misters add little in this model.** With fog alone, yearly compliance is 1.3 / 0.5 points higher than the
  same controller with misters (the row with the guard at band low + 1.0 °F, 80.6 / 75.0) and water use 4 to
  10% lower; the peak temperature in the hotter variant is 2.3 °F higher and its summer compliance
  2.2 points lower. The model's treatment of mister deposition is its least certain part, so this is a
  question for a trial, not a result (section 11).

### 9.7 Band placement and the overnight dry-out goal

Each row of the first table moves one edge of the band and leaves the control rules alone. "At night" lowers
the sunset, solar-midnight and sunrise anchors of the VPD low edge and leaves the solar-noon anchor where it
is.

| Scenario (model A / B) | Year both % | Oct-Apr both % | May-Sep both % | VPD below band % | kWh/day | Therms/day |
|---|---:|---:|---:|---:|---:|---:|
| **Current firmware, today's band** | 71.8 / 60.6 | 80.1 / 64.8 | 61.1 / 55.2 | 16.2 / 27.0 | 19.6 / 21.1 | 2.2 / 2.7 |
| VPD low edge -0.10 kPa at solar midnight only | 75.1 / 65.4 | 84.4 / 71.8 | 63.1 / 57.1 | 12.9 / 22.1 | 19.4 / 21.1 | 2.2 / 2.7 |
| VPD low edge -0.10 kPa at solar midnight and sunrise | 78.2 / 69.6 | 86.1 / 75.4 | 67.9 / 62.2 | 9.9 / 17.8 | 19.4 / 21.1 | 2.2 / 2.7 |
| VPD low edge -0.10 kPa at night (sunset, midnight and sunrise anchors) | 79.2 / 72.3 | 87.1 / 79.2 | 69.0 / 63.3 | 8.9 / 15.0 | 19.4 / 21.0 | 2.2 / 2.7 |
| VPD low edge -0.10 kPa at all hours | 79.9 / 73.1 | 86.9 / 79.5 | 70.9 / 64.8 | 8.4 / 14.2 | 19.4 / 21.1 | 2.2 / 2.7 |
| VPD low edge -0.20 kPa at all hours | 85.5 / 81.4 | 90.4 / 88.9 | 79.1 / 71.7 | 3.3 / 6.1 | 19.3 / 21.0 | 2.2 / 2.7 |
| VPD low edge +0.10 kPa at all hours | 60.7 / 45.8 | 68.1 / 47.1 | 51.1 / 44.1 | 27.2 / 42.5 | 19.8 / 21.1 | 2.2 / 2.7 |
| Temperature band +2 °F | 76.5 / 71.8 | 81.0 / 75.0 | 70.8 / 67.6 | 10.6 / 17.8 | 21.1 / 22.6 | 2.7 / 3.2 |
| Temperature band -2 °F | 61.8 / 47.7 | 72.6 / 52.1 | 47.8 / 42.2 | 23.9 / 36.5 | 18.3 / 19.8 | 1.8 / 2.2 |
| **Step 1, today's band** | 78.3 / 69.6 | 84.5 / 74.8 | 70.3 / 62.9 | 11.8 / 19.4 | 19.4 / 21.4 | 2.2 / 2.7 |
| VPD low edge -0.10 kPa at solar midnight only | 80.7 / 74.0 | 87.7 / 81.6 | 71.7 / 64.0 | 9.3 / 14.7 | 19.4 / 21.4 | 2.2 / 2.7 |
| VPD low edge -0.10 kPa at night | 83.8 / 79.2 | 89.0 / 86.8 | 77.0 / 69.3 | 6.2 / 9.1 | 19.4 / 21.4 | 2.2 / 2.7 |
| VPD low edge -0.10 kPa at all hours | 84.2 / 79.7 | 88.9 / 86.8 | 78.2 / 70.5 | 5.7 / 8.6 | 19.4 / 21.4 | 2.2 / 2.7 |
| **Step 2, today's band** | 85.6 / 82.5 | 90.3 / 89.4 | 79.5 / 73.5 | 5.9 / 9.1 | 19.6 / 21.7 | 2.4 / 3.1 |
| VPD low edge -0.10 kPa at solar midnight only | 87.3 / 86.3 | 92.1 / 94.9 | 81.2 / 75.2 | 4.1 / 5.1 | 19.6 / 21.7 | 2.4 / 3.0 |
| VPD low edge -0.10 kPa at night | 88.6 / 88.3 | 92.7 / 97.0 | 83.3 / 77.1 | 2.8 / 3.1 | 19.5 / 21.7 | 2.4 / 3.0 |
| VPD low edge -0.10 kPa at all hours | 88.6 / 88.3 | 92.7 / 96.9 | 83.4 / 77.2 | 2.8 / 3.1 | 19.5 / 21.7 | 2.4 / 3.0 |
| **Two-axis controller, today's band** | 83.5 / 80.3 | 89.1 / 87.3 | 76.2 / 71.1 | 7.1 / 10.7 | 19.4 / 21.4 | 2.5 / 3.1 |
| VPD low edge -0.10 kPa at all hours (guard at low + 1.0 °F) | 85.2 / 82.3 | 90.2 / 88.8 | 78.6 / 73.8 | 5.3 / 8.4 | 19.0 / 21.0 | 2.3 / 2.8 |
| VPD low edge -0.20 kPa at all hours (guard at low + 1.0 °F) | 88.3 / 87.1 | 92.7 / 94.9 | 82.6 / 76.9 | 2.0 / 3.5 | 18.7 / 20.7 | 2.3 / 2.8 |

**A lower VPD edge moves the grade, not the air.** Lowering the VPD low edge by 0.10 kPa at night adds 7 to 12
points with today's firmware, 5 to 10 after step 1 and 3 to 6 after step 2, at no energy cost. Almost all of
the gain of an all-hours change comes from the night, and the solar-midnight anchor alone gives about two fifths
of it (three fifths after step 2).
Raising the edge by 0.10 kPa at all hours costs 11 to 15 points. But the night air is the same in these runs
(mean night VPD from October to April 0.88 / 0.76 kPa against 0.88 / 0.77), because the firmware's dry-out
works to the larger of the band edge and 0.74 kPa whatever the band says. The points come from grading the
same wet hours against an easier edge.

**The night edge was set on purpose** (section 5.1): on 2026-11-05, so that the house dries out overnight,
with its own acceptance measure. So the question for the night is how often that goal is met, and what it
takes. The next table scores it as the nightly grade does, from one-minute samples and today's
band: a night dries out when at least 240 of the 360
minutes from 00:00 to 06:00 are at or above the larger of the band's low edge and 0.74 kPa.

| Scenario (model A / B) | Nights that dry out, October to April, % | October 2026, % | November 2026, % | Minutes of 360 at or above the floor, October to April | Both in band over the year, % | Therms/day, October to April |
|---|---:|---:|---:|---:|---:|---:|
| **The record, scored the same way** |  | 0 of 31 nights | 0 of 15 nights | 16 in October, 92 in November |  |  |
| Current firmware without the night dry-out | 56 / 22 | 0 / 0 | 21 / 0 | 232 / 109 | 64.6 / 53.8 | 3.45 / 4.10 |
| Current firmware, today's settings | 63 / 26 | 0 / 0 | 36 / 0 | 253 / 140 | 71.8 / 60.6 | 3.48 / 4.22 |
| Step 1a: dry-out pulse 600 s, rest 300 s | 68 / 41 | 6 / 0 | 36 / 0 | 270 / 187 | 74.2 / 65.6 | 3.53 / 4.40 |
| Step 1: all five settings | 76 / 45 | 32 / 6 | 43 / 0 | 291 / 204 | 78.3 / 69.6 | 3.44 / 4.26 |
| Step 1 and `night_vpd_bias_kpa` 0.10 from October to April (a sixth setting) | 77 / 53 | 42 / 23 | 36 / 0 | 300 / 227 | 78.2 / 70.6 | 3.46 / 4.38 |
| Step 2: one firmware release | 89 / 74 | 48 / 19 | 79 / 57 | 324 / 268 | 85.6 / 82.5 | 3.76 / 4.73 |
| Step 2, dry-out aimed 0.05 kPa above the floor (a firmware constant) | 92 / 84 | 65 / 39 | 86 / 71 | 337 / 305 | 86.1 / 84.7 | 3.84 / 4.93 |
| Step 2 and `night_vpd_bias_kpa` 0.10 from October to April instead | 92 / 84 | 65 / 39 | 86 / 71 | 338 / 305 | 85.7 / 84.3 | 3.85 / 4.91 |
| the same, with the setting held all year | 92 / 84 | 65 / 39 | 86 / 71 | 338 / 305 | 84.8 / 83.3 | 3.85 / 4.91 |
| Step 2, both fans in the dry-out pulse | 92 / 84 | 61 / 35 | 86 / 71 | 332 / 293 | 85.9 / 84.0 | 3.80 / 4.93 |
| the same, with the second fan at its lower fitted flow | 91 / 79 | 55 / 29 | 86 / 71 | 327 / 278 | 85.8 / 83.2 | 3.77 / 4.79 |
| Step 2, the 0.05 kPa target and both fans | 93 / 89 | 65 / 55 | 86 / 86 | 341 / 320 | 86.2 / 85.4 | 3.93 / 5.21 |
| the same, with the second fan at its lower fitted flow | 92 / 85 | 65 / 42 | 86 / 71 | 339 / 313 | 86.2 / 85.1 | 3.87 / 5.02 |
| Step 2, night temperature low edge +2 °F | 96 / 86 | 77 / 35 | 93 / 79 | 343 / 310 | 86.2 / 85.2 | 4.12 / 4.98 |
| Step 2, the 0.05 kPa target and the night low edge +2 °F | 97 / 91 | 81 / 55 | 100 / 86 | 350 / 334 | 86.5 / 86.8 | 4.16 / 5.14 |
| Step 2, night temperature low edge +4 °F | 98 / 94 | 87 / 68 | 100 / 93 | 354 / 339 | 85.9 / 86.8 | 4.63 / 5.37 |
| Step 1, night temperature low edge +2 °F | 88 / 70 | 48 / 19 | 79 / 71 | 324 / 258 | 79.1 / 73.4 | 3.80 / 4.60 |
| Step 1, night temperature low edge +4 °F | 96 / 85 | 81 / 32 | 100 / 86 | 346 / 308 | 78.7 / 76.2 | 4.31 / 5.01 |
| Two-axis controller | 82 / 63 | 19 / 0 | 79 / 57 | 300 / 239 | 83.5 / 80.3 | 3.87 / 4.89 |
| Step 1, night VPD low edge 0.10 kPa lower | 77 / 45 | 32 / 6 | 43 / 0 | 291 / 204 | 83.8 / 79.2 | 3.43 / 4.22 |
| Step 2, night VPD low edge 0.10 kPa lower | 90 / 74 | 55 / 19 | 79 / 57 | 324 / 268 | 88.6 / 88.3 | 3.75 / 4.66 |
| Two-axis controller, night VPD low edge 0.10 kPa lower | 61 / 25 | 0 / 0 | 36 / 0 | 247 / 139 | 86.7 / 85.6 | 3.75 / 4.57 |

- **The record meets the goal on no night** from 2026-10-01 to 2026-11-15: a mean 16 minutes of 360 in October
  and 92 in November (17 and 95 on the graded `vpd_avg` signal; the table row uses VPD from the mean temperature
  and humidity). Variant B, the one that matches this November's nights, gives the same answer for today's
  firmware (0% in both months); variant A is drier than the record in November.
- **Steps 1 and 2 raise the share of October-to-April nights that dry out** from 63 / 26% to 76 / 45% and to
  89 / 74%.
- **October stays the weak month:** 48 / 19% of nights after step 2. On the October nights that still fail,
  the vent is open for a median 58 / 66% of the six hours, the furnace runs for a median 6 / 16% of them and
  the electric heater runs at a median 94 / 98% duty, and the house averages 0.71 / 0.68 kPa, just under the
  floor. On most of those nights the rules are no longer what stops the dry-out: the vent is open for more
  than half of the six hours on 10 of the 16 failing nights in A and 20 of the 25 in B, and the heater is at 90%
  duty or more on 11 and 21. What is missing is drying power at the
  temperature the band allows: more air through the house, a warmer house, or a target above the line. Outdoor
  air is not the limit: at 63 °F, outdoor air alone would give at least 0.89 kPa on every October night.
- **Aiming above the floor helps.** The dry-out starts a pulse only below the floor, so a house it is holding
  sits near the line and is counted below it much of the time. Working to 0.05 kPa above the floor passes 92 /
  84% of October-to-April nights (65 / 39% in October) for 0.1 to 0.2 therms a day in those months; 0.10 kPa
  adds little more.
- **An existing setting does the same after step 2, with no further firmware.** `night_vpd_bias_kpa` (0 to
  0.25 kPa) lifts the controller's own night VPD band, by its full value at solar midnight and by nothing at
  sunset and sunrise (`firmware/greenhouse/controls.yaml:477-491`), and the dry-out's floor follows that band.
  The band the house is graded against is written by the dispatcher from the anchors and has no bias term
  (`ingestor/tasks/band_anchors.py:319-342`), so the grade keeps its floor. The setting has read 0 on the
  controller since at least 2026-08-13. A value of 0.10 kPa lifts the band by 0.05 to 0.07 kPa on average
  between 00:00 and 06:00 (0.03 to 0.06 at 04:00, 0.01 or less at 06:00), which is why 0.10 from October to
  April gives the nights of the 0.05 kPa constant after step 2: 92 / 84% (65 / 39% in October), the same
  number of nights in every month, for up to 0.2 therms a day in those months. 0.05 and 0.15 kPa give 92 / 80%
  and 92 / 86%. Four things qualify it:
  - On today's firmware it gains less. After step 1 it gives 77 / 53% against 76 / 45%, 2 and 17 more nights
    of 195. In A that is within the noise (0.05, 0.10 and 0.15 kPa give 79, 77 and 78%). In B, the variant that
    matches this November's nights, no night of November 2026 passes with or without it (0 of 14; a mean of
    135 minutes against 111).
  - It has to be a manual row. Every plan waypoint writes this setting with the plan's own value, normally 0
    (`verdify_schemas/climate_intent.py:648`, `mcp/server.py:4231-4252`), and only a manual row outranks the
    plans. While the row is held the planner cannot use the lever, and the planner study will not start
    (`verdify_services/planner_study.py:596-601`); the same is true of step 1's three wetting rows.
  - It moves the whole night band, not only the dry-out. The older vent-dehumidify path and the closed-house
    heater nudge work from the same low edge (`firmware/lib/greenhouse_logic.h:951-952`, `:1623-1637`), and
    wetting from the high edge. Simulated from October to April: 2 to 7 more vent starts a day (1 to 7 with the
    constant), electricity within 0.2 kWh a day (0.1 to 0.4 more with the constant), and time below the temperature band
    3.1 / 5.1% against 3.0 / 4.7% on today's firmware (0.7 / 0.8% against 0.7 / 0.7% after step 2; 3.1 / 5.2% and
    0.7 / 0.9% with the constant). Held through the summer, the
    later wetting costs 1.4 to 2.3 points of both-in-band from May to September, all of it at night, which is
    why it goes back to 0 in May.
  - The constant scores 0.6 to 0.8 points more of both-in-band from October to April: in A because it leaves
    the wetting edge alone (time above the VPD band 6.8% against 7.6% after step 2), in B because its margin
    does not fade before sunrise and, on the step 2 release, also works by day, when the setting adds nothing
    (time below the band 4.8% against 5.5%, more than half of that difference by day). From May to September it costs 0.1
    points or less of in-band time and adds about 0.05 therms and 0.4 to 0.7 kWh a day.
- **So does more air.** A pulse runs the vent and one fan. With both fans, 92 / 84% of October-to-April nights
  dry out (61 / 35% in October) for up to 0.2 therms a day in those months, and the time below the temperature
  band in those months goes from 0.7 / 0.7% to 0.7 / 1.0%. The target and both fans together give 93 / 89%
  (65 / 55% in October) for 0.2 to 0.5 therms a day. The second fan's flow is the weak number: the cold-season
  fit puts it at 0.32 kg/s and the other two fits at 0.08 and 0.10. With the lower value the gain is about half
  (91 / 79%), and on top of the target it is small (92 / 85%).
- **A warmer night supplies the heat through the temperature band.** With the temperature low edge 2 °F higher
  at the solar-midnight and sunrise anchors, 96 / 86% of October-to-April nights dry out after step 2 (88 / 70%
  after step 1) for 0.25 to 0.4 therms a day in those months, 60 to 85 therms a year. With 4 °F it is 98 / 94%
  for 0.6 to 0.9 therms a day, 160 to 205 a year. With the higher target and the 2 °F together it is 97 / 91%.
  It is a band edit, not code. Three cautions:
  - The W5 research measured that heat alone underdelivers, because the indoor dew point follows the
    temperature (0.53 °F per °F over the year, 0.84 from September to November), and rated a 3 °F warmer night
    poor value (`docs/research/w5/vpd-band.md`, section E and option 5). The simulator shows the same effect:
    with the house closed its dew point rises 0.50 to 0.66 °F per °F, so 2 °F buys about 0.08 kPa. That is
    close to the whole-year measurement and below the autumn one, so the autumn gain may be overstated.
  - The gain is large in nights and small in kPa because the dry-out already holds the house just under the
    floor: the October nights that fail after step 2 average 0.71 / 0.68 kPa.
  - It is heat spent for humidity, which the third item of the 2026-11-05 amendment keeps blocked (ENV-2), so
    taking it means amending that item; and it narrows the day-to-night temperature difference by the same
    2 °F. Both are Jason's to weigh.
- **Not tested here:** the two other levers the W5 research lists for the same goal, a dehumidifier rated for
  low temperatures (the only one it found that holds 0.74 kPa without venting) and finding the moisture source
  (section 5.1).
- **A lower VPD edge leaves the nights as wet as they were** (after step 2, 90 / 74% of nights dry out against
  89 / 74%, with the same minutes at or above the floor), and a controller that follows the edge dries fewer: the
  two-axis controller of section 10.4 falls from 82 / 63% to 61 / 25%, which is what it scores with no
  dehumidification at all.

The three figures above that come from minute traces (the failing October nights, the closed-house response
and the outdoor-air figure) are reproduced by `night_checks.py` in the support directory.


Shifting the whole temperature band up 2 °F at all hours gains 4.7 / 11.2 points for 1.5 kWh and 0.5 therms a
day: less time below the VPD band in the cold months, because warmer air holds more water, and less time above
the temperature band in summer. Shifting it down 2 °F costs 10 to 13 points. Whether any of these suits the
crop is not a question the data can answer.

### 9.8 Robustness

The comparison of the two-axis controller with the current firmware, repeated with one physical quantity
changed at a time:

| Change to the physics | Current firmware A / B | Two-axis A / B | Gain A / B (points) | Extra therms/day A / B | Extra kWh/day A / B |
|---|---:|---:|---:|---:|---:|
| Fitted model | 71.8 / 60.6 | 83.5 / 80.3 | +11.7 / +19.7 | +0.3 / +0.4 | -0.1 / +0.3 |
| Moisture source x 1.5 | 57.3 / 32.0 | 81.6 / 67.7 | +24.2 / +35.8 | +0.5 / +1.0 | +0.4 / +1.7 |
| Moisture source x 0.7 | 73.3 / 71.2 | 80.3 / 81.1 | +7.0 / +9.9 | +0.2 / +0.3 | -0.2 / -0.1 |
| Fan air flow x 2 (vent-only exchange unchanged) | 74.4 / 64.8 | 85.1 / 83.5 | +10.7 / +18.7 | +0.3 / +0.5 | -0.2 / +0.2 |
| Fan air flow x 0.5 (vent-only exchange unchanged) | 67.6 / 56.4 | 80.5 / 75.5 | +13.0 / +19.2 | +0.3 / +0.3 | -0.1 / +0.3 |
| Furnace output x 0.7 | 71.1 / 58.8 | 82.6 / 78.0 | +11.5 / +19.2 | +0.4 / +0.6 | -0.1 / +0.4 |
| Envelope heat loss x 1.25 | 69.0 / 58.3 | 82.3 / 78.2 | +13.3 / +20.0 | +0.4 / +0.5 | -0.1 / +0.5 |
| Closed-house infiltration x 0.5 | 49.2 / 27.6 | 80.1 / 69.7 | +31.0 / +42.1 | +0.6 / +0.9 | +0.3 / +1.5 |
| Sorption buffer x 2 | 67.6 / 57.8 | 80.9 / 76.8 | +13.3 / +19.0 | +0.4 / +0.5 | 0.0 / +0.6 |
| Sensor lag x 2 | 69.7 / 59.3 | 82.3 / 78.6 | +12.6 / +19.4 | +0.3 / +0.5 | -0.2 / +0.3 |

The gain stays positive in all nine cases, between 7 and 42 points. The current firmware is fragile to a
wetter or tighter house: it falls to 49 / 28% when infiltration is halved and to 57 / 32% when the moisture
source is 1.5 times larger. A controller that vents on demand holds 68 to 82% in the same cases. These nine
runs cover the two-axis controller only.

The settings step and the patch were repeated for one quantity, the one the dry-out depends on and the fit
knows least (section 9.1): the flow of both fans, halved and doubled.

| Scenario (model A / B) | Nights that dry out, October to April, %: fan flow x 0.5 | fitted | x 2 | Both in band over the year, %: fan flow x 0.5 | fitted | x 2 |
|---|---:|---:|---:|---:|---:|---:|
| Today | 60 / 24 | 63 / 26 | 65 / 31 | 67.6 / 56.4 | 71.8 / 60.6 | 74.4 / 64.8 |
| Step 1a | 66 / 31 | 68 / 41 | 79 / 51 | 70.3 / 60.9 | 74.2 / 65.6 | 76.9 / 70.0 |
| Step 1 | 74 / 38 | 76 / 45 | 82 / 59 | 78.8 / 65.7 | 78.3 / 69.6 | 79.3 / 73.1 |
| Step 2 | 85 / 56 | 89 / 74 | 92 / 82 | 84.5 / 77.2 | 85.6 / 82.5 | 86.2 / 85.1 |
| Step 2 with the 0.05 kPa target | 91 / 72 | 92 / 84 | 93 / 87 | 85.3 / 80.5 | 86.1 / 84.7 | 86.5 / 86.5 |
| Step 2 with both fans in the pulse | 91 / 76 | 92 / 84 | 93 / 87 | 85.3 / 80.5 | 85.9 / 84.0 | 86.1 / 85.4 |

Every step gains on the night goal, in the same order, in all three cases; in both-in-band the both-fans
option is level with step 2 in variant A at double flow. With half the fan flow step 2 passes 85 / 56% of
October-to-April nights instead of 89 / 74%, and that is where aiming above the floor and the second fan pay
most (72% and 76% in variant B).

### 9.9 Tested and set aside

The two-axis options below were run on an earlier variant of the two-axis controller (76.6 / 69.8: continuous
dehumidification from band low + 1.0 °F, today's furnace thresholds, no furnace-and-air interlock), not on the
recommended constants. The rows marked "Current firmware" were run on today's firmware and settings
(71.8 / 60.6). Each is shown as a change from its own baseline:

| Option | Change in both-in-band over the year, A / B (points) | Change in kWh/day | Change in therms/day | Peak °F |
|---|---:|---:|---:|---:|
| Outdoor-cooler check on the cooling vent | -4.1 / -3.1 | -0.5 / -0.4 | 0.0 / 0.0 | 97.4 / 97.9 |
| Temperature low edge 2 °F lower at solar midnight | -1.3 / -1.6 | -0.5 / -0.2 | 0.0 / 0.0 | 85.8 / 86.8 |
| Temperature low edge 4 °F lower at solar midnight | -2.8 / -3.0 | -0.9 / -0.5 | 0.0 / 0.0 | 85.8 / 86.8 |
| Heater minimum on and off time 60 s | 0.0 / +0.4 | +0.3 / +0.5 | 0.0 / 0.0 | 85.8 / 86.8 |
| Heater minimum on and off time 300 s | 0.0 / +0.1 | -0.3 / -0.5 | 0.0 / 0.0 | 85.8 / 86.8 |
| Electric heater line at band low + 2.5 °F | -0.4 / 0.0 | -2.2 / -2.2 | +0.1 / +0.1 | 85.8 / 86.8 |
| Electric heater line at band low + 5.0 °F | +0.2 / +0.5 | +2.0 / +1.7 | -0.1 / -0.1 | 85.8 / 86.8 |
| Second fan at the band high | 0.0 / -0.3 | +0.1 / +0.2 | 0.0 / 0.0 | 85.8 / 86.8 |
| Second fan at band high + 3 °F | 0.0 / 0.0 | 0.0 / -0.1 | 0.0 / 0.0 | 85.8 / 87.5 |
| Cooling exit 3 °F below the band high | -1.3 / -1.4 | +0.2 / +0.2 | 0.0 / 0.0 | 85.8 / 86.8 |
| No rest between sealed fog bursts | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 85.8 / 86.8 |
| Mister pulses 30 s on, 60 s off | 0.0 / 0.0 | 0.0 / +0.1 | 0.0 / 0.0 | 85.8 / 86.8 |
| Mister pulses 90 s on, 45 s off | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 85.7 / 86.9 |
| Both fans while dehumidifying | +0.3 / +1.5 | +0.2 / +0.2 | 0.0 / +0.1 | 85.8 / 86.8 |
| Dehumidify when outdoor dew point is 1 °F lower (not 3 °F) | +0.2 / +0.6 | +0.3 / +0.3 | 0.0 / 0.0 | 85.8 / 86.8 |
| Current firmware: electric heater hysteresis 0.5 °F | -0.1 / -0.2 | -0.6 / -0.6 | 0.0 / 0.0 | 90.9 / 91.8 |
| Current firmware: electric heater hysteresis 2.0 °F | +0.2 / +0.3 | +1.1 / +0.9 | -0.1 / 0.0 | 90.9 / 91.8 |
| Current firmware: heater minimum on and off time 300 s | -0.1 / -0.1 | -0.2 / -0.4 | 0.0 / 0.0 | 90.9 / 91.8 |
| Current firmware: dwell gate off | -1.0 / -1.0 | 0.0 / 0.0 | 0.0 / 0.0 | 90.9 / 91.8 |
| Current firmware: dry-out pulse 240 s, rest 660 s | +0.9 / +1.9 | +0.1 / +0.1 | 0.0 / 0.0 | 90.9 / 91.8 |
| Current firmware: dry-out energy cap 30 kWh a night (today 10) | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 90.9 / 91.8 |

- **Outdoor-cooler check on the cooling vent:** harmful. Summer compliance 58.0 / 57.2 against 68.1 / 63.9,
  and a peak of 97 / 98 °F against 86 / 87 (section 5.2).
- **A lower night temperature edge** (lowered at solar midnight, tapering to no change at sunset and sunrise):
  costs 1.3 to 3.0 points and saves under 1 kWh a day. Colder air holds
  less water, so the wet side gets worse.
- **Heater dwell, heater hysteresis and the electric heater's line:** within half a point. Moving the line
  trades about 2 kWh a day against 0.1 therm.
- **Second-fan thresholds, sealed-fog rest, mister pulse pattern:** no effect.
- **Removing the dwell gate:** minus one point.
- **A dry-out pulse of 240 seconds in the same 15-minute cycle:** plus one to two points. The 600-second pulse
  of section 10.1 does better.
- **The dry-out's nightly energy cap:** almost never binds. Raising it from 10 kWh to the firmware maximum of 30
  changes the year by 0.05 points or less, with today's settings and with those of step 1.

## 10. Recommended design

The order is: change settings, measure, patch the firmware, measure, remove what does not run, and only then
consider the rewrite. Each step is useful without the next.

### 10.1 Step 1: five settings, no code

| Setting | Today | Proposed | Who writes it today |
|---|---|---|---|
| `night_dryout_pulse_s` | 120 | 600 | Operator. The planner cannot write it. |
| `night_dryout_rest_s` | 780 | 300 | Operator. The planner cannot write it. |
| `fog_escalation_kpa` | 0.1 to 0.5 | 0.1, fixed | The planner, on every waypoint |
| `direct_wet_stress_vpd_margin_kpa` | 0.05 to 0.25 | 0.25, fixed | The planner, on every waypoint |
| `mister_water_budget_gal` | 100 to 300 | 300, the most the firmware and the registry accept | The planner, on every waypoint |

**Step 1a, two dry-out values.** They are operator-owned and inside the range the firmware already
validates (pulse 60 to 600 seconds, rest at least 300, cycle at least 900). The number of pulses an hour does
not change, so the pulse-end heat loss of
section 5.1 does not grow. The nightly energy cap can stay at 10 kWh: with the longer pulses, raising it to 30
changes the simulated year by 0.05 points or less. Simulated: 74.2 / 65.6 over the year against 71.8 / 60.6.

**Step 1b, three manual rows.** The three wetting values are computed from the planner's intent on every
waypoint (`verdify_schemas/climate_intent.py:619-633`), so an ordinary write lasts only until the next plan. A
write marked manual outranks every later plan until it is released (`verdify_schemas/setting_values.py:206-231`;
the operator write path marks its writes manual by default, `api/operator_routes/writes.py:74-75`), and production held three manual rows on 2026-11-15. So these are operator writes too, with no code. The
dispatcher's moisture guardrail does not interfere: of the three it caps only the fog escalation, at 0.15 kPa
or more. Making the three values constants in the code, so that nothing has to be held manually, belongs to
step 2 and to the decision on the planner's role. Removing the mister budget altogether needs the firmware's
100 to 300 gallon clamp changed and also belongs to step 2. The same mechanism can hold any other planner
setting at a fixed value, so the planner's reduced role (section 11, decision 5) can be tried before any code
is removed.

Simulated for 1a and 1b together: 78.3 / 69.6 over the year against 71.8 / 60.6; October to April 84.5 / 74.8
against 80.1 / 64.8; gas almost unchanged. In variant A the peak temperature is 5 °F lower. In the hotter
variant B the 300-gallon budget still binds in July and the peak does not move. One cost to watch: longer
pulses cool the house more, and in the wetter variant the time below the temperature band from October to
April rises from 4.1 to 4.7%.

**How to judge it.** Fourteen nights against the nights before, with outdoor dew point as a covariate: night
time below the VPD band, time below the temperature band, furnace starts. That comparison judges the dry-out
pair. The wetting values act when the house is too dry, which was 0.5% of graded time in November, so they can
be written in the same session and are judged next summer. The prediction for
late-November and December weather (simulated months 2025-11, 2025-12 and 2026-11): night time below the VPD
band falls by 10 to 14 points in variant B, the variant that matches this November's nights, and by 0 to 3 in
A; time below the temperature band rises by about 1 point in B; the furnace starts 1 to 3 more times a day in
B; and the minutes at or above the floor between 00:00 and 06:00 (`night_dryout_min` in the nightly grade)
rise by 40 to 60 a night in B and by 1 to 17 in A. If the change is near the prediction, the simulator can be trusted for step 2. If not, the model is
corrected before any firmware work. Rollback is writing 120 and 780 seconds back and releasing the three manual
rows.

**An optional sixth setting for afterwards.** `night_vpd_bias_kpa` at 0.10 makes the dry-out aim above its
floor (section 9.7). It is an operator write like the other five, as a manual row. On today's firmware the
simulated gain is smaller: 2 / 17 more passing nights of 195 from October to April (9 / 23 more minutes a night
at or above the floor), and none this November. It is a trial of the mechanism; the constant in the step 2 release is the
fix. If it is tried, keep it out of the fourteen nights so that the two effects can be told apart, and write 0
again in May or when that release is flashed.

### 10.2 Step 2: one firmware release

1. **Pulse-end interlock.** Keep the heat-and-air exemption until the dry-out's own vent and fan have
   physically released, and add the missing test of the rest phase through the arbiter.
2. **Furnace thresholds.** On below band low + 0.5 °F; off at band low + 3.0 °F.
3. **Dry-out on demand.** Start from band low + 0.5 °F; run until the edge is regained instead of a fixed
   pulse and rest; by day as well. Temperature keeps priority: the dry-out still yields to the furnace latch,
   and the furnace is never requested while the vent is open. Work to 0.05 kPa above the floor, not to the
   floor itself, so that a house the dry-out is holding counts as dry (section 9.7; this margin is not in the figure below). As a constant it replaces the
   `night_vpd_bias_kpa` setting, which gives the same nights on this release from October to April but has to
   be held as a manual row and written back to 0 in May. Both fans in a pulse is the next thing to try if nights still fall short.
4. **Humidify at the edge.** One fog threshold, the band's high edge, as a constant used by both the relay
   and the decision layer. The 0.1 kPa setting already puts the relay there (its threshold is the setting
   less a quarter of the band width, and fog is refused at or below the edge); the decision layer waits for
   0.1 kPa more. The direct-wet margin as a constant; the water budget reduced to a fixed
   guard against a leak or a stuck valve (in simulation the 300-gallon budget costs the hotter variant 0.9
   points a year and 5 °F of peak).

Three smaller fixes belong in the same release: the remaining boot default, a guard against a retained clock
after an unclean reset (section 5.4), and the missing-probe check (section 6.2). The clock guard still needs
its rule: waiting for a time sync would hold the fallback phase and block fog after every boot. The
relay-against-load and clock comparisons are ingestor alerts and need no firmware. The merge that is waiting
to be flashed (PR #1494) goes with it.

Gates: the firmware unit tests and invariants, the replay diff, and the simulator. Simulated result:
85.6 / 82.5 over the year, 90.3 / 89.4 from October to April. Three things about that figure. It holds
the planner's other settings at their July values, which is worth 0.6 points or less by itself. Change 3 was
simulated as 600-second pulses with 30-second rests and no energy cap, not as a true run until the edge is
regained (the fact-check re-ran the night-only build under caps of 10, 20 and 30 kWh and got the same nights). And change 4 was simulated as the 0.1 kPa setting, which leaves the decision layer 0.1 kPa behind
the relay. With the dry-out working to 0.05 kPa above the floor the same release scores 86.1 / 84.7, and
92 / 84% of October-to-April nights dry out instead of 89 / 74%, for 0.1 to 0.2 therms a day more in those
months.

Change 3 needs a decision first (section 11): the ADR-0004 amendment of 2026-11-05 says gas never runs for
humidity. The furnace would still never run *while* venting; but venting more means the furnace runs more
afterwards. The simulated cost is 0.2 to 0.3 therms a day over the year for the dry-out change, and 0.3 to 0.4
for the whole release.

### 10.3 Step 3: remove what does not run

In this order, because each step makes the next one smaller and safer:

1. Stop the native-panel ledger and retire the winter-feasibility collector (configuration only).
2. Delete the legacy cascade and re-point or remove its tests; make the 26 inert fields non-pushable, then
   delete them (five need a wire schema change).
3. Take the experiment workers out of the ingestor, then the runtime, the manifests and, last, the schema.
4. Remove the policy engine from the firmware.
5. Compile the settings that never change into constants, and publish and store only what can change.
6. Retire the idle planners, the forecast-action engine and the moisture guardrail.
7. Remove the retired irrigation code and the small dead paths.

Items 1 to 4 and 7 do not change control behaviour and are checked by the existing replay and test gates. Item
5 changes what the controller boots with, and item 6 ends the guardrail's caps on seven mister and fog settings
(section 7.5); both follow the constants of steps 1 and 2, which fix those values first.

### 10.4 Step 4: a two-axis controller

Once the patched firmware has shown the behaviour in the house, the mode arbitration can be replaced by the
same behaviour written directly:

```
every tick, from temperature T, VPD, the indoor and outdoor dew points, and the band:

temperature axis
  cooling : latch. On above T_high (plus 2.5 °F when outdoors is more than 10 °F below T_low).
                        Off 1.5 °F below T_high (3.0 °F in the same cold-outdoor case). Always on at the safety maximum.
  heat1   : on below T_low + 3.5 °F.
  furnace : latch. On below T_low + 0.5 °F, off at T_low + 3.0 °F. Only with heat1.
  fan 2   : latch while cooling. On above T_high + 1.0 °F, off at T_high.
  safety  : both heaters at the safety minimum; no heat while cooling.

humidity axis, too dry
  after 60 s above VPD_high, if wetting is safe
  (dew-point margin 8 °F by day and 6 °F at night, RH below 90%, T at least 55 °F):
    vent open   : fog and the centre mister.
    vent closed : fog for at most 600 s, then 600 s rest.

humidity axis, too wet
  wet : latch. On below VPD_low, off at VPD_low + 0.03 kPa.
  if wet, not cooling, outdoor dew point at least 3 °F below indoor,
     T at least T_low + 0.5 °F, and the furnace latch clear:
    vent and the lead fan until the latch clears; heat1 holds up to target - 1.5 °F.
  the furnace is never requested while an air relay is on.

all requests pass through the existing relay-conflict arbiter and minimum on and off times.
```

That is about 60 lines and 22 constants for the two axes. It keeps, from today's relay layer, the centre
mister's gate and pulse timing (at least 65 °F, from 120 minutes after sunrise to 180 minutes before sunset,
60 seconds on and 45 off after a 44-second delay), the rule that fog closes the vent, and the relay minimum
times. It replaces the mode state machine, the candidate ranking, the sealed
mister ladder, the four outdoor-air comparisons, the dwell gate and the water budget, and with them most of
the 74 setpoint fields and 128 settings. The band remains the one thing that is set from outside.

As simulated, the wet latch follows the band's low edge. To keep the decision of 2026-11-05 it must use the
larger of that edge and 0.74 kPa at night, as the firmware's dry-out does, or a later band edit would quietly
switch the dry-out off (section 9.7); with today's anchors the two differ by less than 0.02 kPa.

It scores 83.5 / 80.3 in simulation against 85.6 / 82.5 for the patched firmware: about 2 points lower, which is
inside the model's uncertainty. The reason to do it is that a controller this size can be read, tested and reasoned about in full.
Whether that is worth a rewrite and a new qualification is Jason's decision; nothing in steps 1 to 3 depends
on it.

**What the planner does in this design.** It sets intent: the band, within reviewed bounds, and at most one or
two named levers (a night bias, a pre-cool before a hot day). It does not tune actuator thresholds, and its
plans are scored on served-band compliance for plans that were confirmed on the controller.

## 11. Decisions for Jason

Each decision has an issue in section 12 that carries the evidence and the options in full.

| # | Decision | Options and what each costs | Recommendation |
|---|---|---|---|
| 1 | Apply the settings step (section 10.1) | Yes: 6 to 9 points simulated. Five operator writes, reversible in a minute, no code; the three wetting values are written as manual rows so that later plans do not replace them. No: nothing changes and the simulator stays untested. | Yes. It is the cheapest test of everything else in this review. |
| 2 | How to reach the overnight dry-out goal | The 0.74 kPa night floor and its goal (at least four of the six hours after midnight at or above it) were decided on 2026-11-05; the record has met the goal on 0 of 46 nights. Steps 1 and 2 take the simulated share of October-to-April nights that dry out from 63 / 26% to 76 / 45% and 89 / 74%, and October stays at 48 / 19%. Four things could be added. (a) Aim the dry-out above the floor: 92 / 84% after step 2, for 0.1 to 0.2 therms a day in those months. A 0.05 kPa firmware constant does it for good. An existing setting gives the same nights on that release with no further code (`night_vpd_bias_kpa` at 0.10 from October to April, as a manual row; held through the summer it costs 1.4 to 2.3 points there). On today's firmware the setting gains less: 77 / 53% against 76 / 45% after step 1, and no more passing nights this November. (b) Run both fans in a pulse instead of one: 92 / 84% alone and 93 / 89% with (a), for up to 0.5 therms a day with (a); a firmware change; the second fan's flow is poorly known, and at its lower fitted value the gain is about half alone and small with (a). (c) Hold the night 2 °F warmer (the temperature low edge at the solar-midnight and sunrise anchors): 96 / 86% after step 2, 88 / 70% after step 1, for 0.25 to 0.4 therms a day in those months (60 to 85 a year); a band edit. The W5 research rated a warmer night poor value for the VPD it buys, the simulated autumn gain may be overstated, it costs the crop 2 °F of day-to-night difference, and it is heat spent for humidity, which the third item of the 2026-11-05 amendment keeps blocked: taking it means amending that item. (d) Lower the VPD edge by 0.10 kPa at night: the grade rises by 3 to 6 points after step 2 and the nights stay as wet (90 / 74% against 89 / 74%); the band editor refuses it today, by design. | Keep the floor and do not lower the edge: it would hide the miss the floor was set to remove. Take (a) as a constant in the step 2 release. Until then the setting is optional, once step 1's fourteen nights are over: 2 / 17 more nights of 195 in simulation, none of them this November, for one more manual row to hold and to set back to 0 in May or when the release is flashed. If nights still fall short after the release, try (b) for two weeks, then (c): (b) uses the lever already adopted, more outdoor air, and (c) is heat spent for humidity. |
| 3 | Gas for dehumidification reheat | Keep the rule as written (the furnace never runs for humidity; ADR-0004, amendment of 2026-11-05): the dry-out stays blocked on cold nights. Or let the dry-out vent down to band low + 0.5 °F and let ordinary furnace cycles restore the temperature afterwards; the furnace still never runs while the vent is open. Simulated cost of the dry-out change 0.2 to 0.3 therms a day (65 to 115 therms a year); the whole of step 2, with the earlier furnace start, 0.3 to 0.4 (100 to 135 a year). Most of step 2's 7 to 13 points depends on it. | Allow it, and amend the night dry-out amendment in ADR-0004 (and the matching note in ADR-0003) to say what is allowed. |
| 4 | Mister water budget and daily cap | State what they are for. A guard against a leak or a stuck valve is a fixed limit with an alarm. A conservation target is a number of gallons a day, with its cost stated: in simulation a 100-gallon budget costs 2.8 to 3.5 points, and even the 300-gallon maximum costs the hotter variant 5 °F of summer peak. | A fixed guard, not a planner setting. Separately, try fog only for two weeks next summer: in simulation the misters add little (section 9.6) for 61% of the wetting water. |
| 5 | The planner's role | Keep it tuning 39 actuator parameters. Or reduce it to intent (the band within reviewed bounds, and one or two named levers) and freeze the rest as constants. Or suspend its writes and run on fixed settings. | Reduce it to intent. Freezing the constants costs nothing in simulation, and the record shows no benefit from re-planning. A with-and-without test would not settle it now: by the study's own power analysis two months resolve about 7 points of night VPD (`docs/research/w5/planner-ab.md`), and the settings the planner changes today do not act on the winter miss (the one lever it holds that does, `night_vpd_bias_kpa`, has stayed at 0, and at 0.10 it is worth 5 points of night VPD or less on today's firmware; sections 7.3 and 9.7). Run one only after the planner works a lever the study can resolve; as built, the study will not start while a planner setting is held as a manual row (`verdify_services/planner_study.py:596-601`), which step 1 does for three. |
| 6 | The experiment and policy-vector capability | Keep it deployed and switched off: 31% of the database, a fifth of the device writer's code, a policy engine in the control loop. Or retire it in the order of section 10.3. | Retire it. Stop the native-panel ledger now in either case. |
| 7 | The idle planners | `planner_graph` has never written a row. No decision date or pass criterion for the shadow planner on local models was found in the repository. | Remove `planner_graph`. Give the shadow planner a date and a pass criterion, or stop it. |
| 8 | The forecast-action engine | Keep it for its constants (three settings carry 99% of its writes) and its alerts, or remove it. | Remove it. Its last device write was on 2026-10-05 and the planner owns the same settings. |
| 9 | The firmware on the controller | The controller is one merge behind `main` (PR #1494), and the issues that tracked the flash were closed. | Flash it with the step 2 release instead of by itself. |
| 10 | The two-axis rewrite | Do it after step 2, or stop after the patch and the removal. | Decide after the patched firmware has run for a month. Nothing else depends on it. |
| 11 | The twin and the research package | Keep them in the product repository and in CI, or move them out. | Delete the twin. Move the finished research package to its own repository. |
| 12 | The winter-feasibility collector | It will fail every night from 2026-11-16, because migration 309 dropped a table it reads. Retire it, or repair its query and let the packet finish on 2026-12-31 as declared. | Retire it: the issue it served (#782) was closed as not planned. |

## 12. Remediation backlog

The issues are filed in this repository under the product milestones, not under the estate convergence waves
(the 2026-11 backlog reset set control tuning outside those waves). Each follows the issue contract. The epic
is #1633.

**Step 1: this week, no firmware**

| Issue | Title | Priority | Needs Jason's decision |
|---|---|---|---|
| #1634 | [conv] verdify-winter-feasibility will fail nightly from 2026-11-16: migration 309 dropped weather_station; retire it | p1 | yes |
| #1635 | [conv] Stop the native-panel ledger: fixed_panel_native_events is 31 % of the database, grows 61 MiB/day, feeds nothing | p1 |  |
| #1673 | [conv] Five operator settings, no code: dry-out pulse 600 s / rest 300 s; fog 0.1, direct-wet 0.25, budget 300 gal held | p1 | yes |
| #1636 | [obs] Setpoint delivery stalled without a page on 44 of 94 days: page on a stall, from a check outside dispatcher memory | p1 |  |
| #1637 | [obs] Electric heater gave no heat for 209 days with its relay on: fix heat_manual_override, add the mirror check | p1 |  |
| #1638 | [obs] Controller clock wrong for 87 days, up to 117 min fast: alert on offset and SNTP validity, guard a retained RTC | p1 |  |

**Step 2: one firmware release**

| Issue | Title | Priority | Needs Jason's decision |
|---|---|---|---|
| #1675 | [conv] Night dry-out forces heat1 off for 180 s at the end of 90 % of pulses | p2 |  |
| #1639 | [conv] Furnace starts only after the house is below the band: start heat2 at band low + 0.5 F, stop at low + 3.0 F | p2 |  |
| #1674 | [conv] Night dry-out cannot hold the VPD low edge: start at band low + 0.5 F, run as long as needed, by day as well | p1 | yes |
| #1640 | [conv] Fog assist starts up to 0.4 kPa beyond the VPD high edge; relay and decision layer use different thresholds | p2 |  |
| #1641 | [conv] Mister duty cap and water budget withhold evaporative cooling while the house is above the band | p2 | yes |
| #1642 | [conv] Boot defaults differ from production values: safety limits ran at 95 / 45 F for 24 days; one still boots at 0 | p1 |  |
| #1643 | [conv] Missing probe data is replaced by 65 F / 50 % before the fault check, so SENSOR_FAULT cannot fire on it | p2 |  |
| #1644 | [conv] Device firmware is behind main: merged W7 changes (PR #1494) are not flashed and no issue tracks it | p2 | yes |
| #1645 | [conv] drip_wall runs at the daily VPD minimum and raises RH by 25 points: move it to late morning | p3 |  |

**Decisions that shape the rest**

| Issue | Title | Priority | Needs Jason's decision |
|---|---|---|---|
| #1676 | [conv] Overnight dry-out goal met on 0 of 46 nights: keep the 0.74 kPa floor; decide target margin, both fans, warmer night | p1 | yes |
| #1646 | [conv] Decide the planner's role: 39 parameters act as 3 to 8; tuning moves simulated compliance under 2 points (SD) | p1 | yes |

**Step 3: remove what does not run**

| Issue | Title | Priority | Needs Jason's decision |
|---|---|---|---|
| #1647 | [conv] Delete the unreachable legacy mode cascade (468 lines); re-point or drop the 82 tests that run only it | p2 |  |
| #1648 | [conv] Delete 26 inert Setpoints fields end to end; stop the planner writing three of them and the near-inert temp_hysteresis | p2 |  |
| #1649 | [conv] Retire experiment generations 1 and 2 in a safe order: ingestor workers, runtime, manifests, then schema | p2 | yes |
| #1650 | [conv] Remove the switched-off policy-vector engine from the firmware control loop (1,948 lines) | p2 | yes |
| #1651 | [conv] Publish and store only what can change: 84 of 128 tunables and 139 of 187 readbacks are constants | p2 |  |
| #1652 | [conv] Retire idle verdify-planner (planner_graph), planner-memory ingest and dead routing; decide the Cortex shadow | p2 | yes |
| #1653 | [conv] Remove the forecast-action engine: 99 % no-ops, single-valued writes, last write 2026-10-05, still posts alerts | p2 | yes |
| #1654 | [conv] VPD-high guardrail uses the zone-target band, not the served band; caps up to 7 plan values on 45 of 48 days | p1 |  |
| #1655 | [conv] Remove retired irrigation code: the never-run L01 bridge (448 lines, 1,984 test lines) and inert burst helpers | p3 |  |
| #1656 | [conv] Small dead paths in the ingestor and services | p3 |  |
| #1657 | [conv] Remove the digital twin and move the finished research package out of the product repo | p3 | yes |
| #1658 | [conv] Irrigation engine: 1 of 4 run kinds has ever run, backup slots log no-op skips, commands polled every 5 s | p3 |  |

**Planner**

| Issue | Title | Priority | Needs Jason's decision |
|---|---|---|---|
| #1659 | [conv] Planner feedback loop scores and learns from plans that never reached the device | p2 |  |
| #1660 | [conv] Planner runs: 55 % of TRANSITION/SOLAR_MAX wake-ups only acknowledge; write-time band waypoints; stale prompt | p3 |  |
| #1661 | [obs] No token, cost or latency record for the production planner | p3 |  |

**Records, alerts and data quality**

| Issue | Title | Priority | Needs Jason's decision |
|---|---|---|---|
| #1662 | [conv] Store readbacks and state on change: 78 % of setpoint_snapshot rarely changes, lighting is 56 % of system_state | p2 |  |
| #1663 | [conv] One band curve and one store: the harmonic exists four times and defaults are hard-coded in several places | p3 |  |
| #1664 | [obs] Alert volume: sensor_offline raises one alert per column per outage; 99.95 % of 14,019 alerts end up resolved | p3 |  |
| #1665 | [obs] climate_action_log band low/high and band-error columns have been stale since 2026-07-11 | p3 |  |
| #1666 | [obs] Frozen and dead channels are stored as valid data, and frozen rows can be graded | p3 |  |
| #1667 | [obs] Compliance reporting: 2026-09-01 definition break, no capacity split, night_dried_out 0 of 10 and unread | p3 |  |
| #1668 | [obs] Run-time and water records: lost OFF events, 1.37 M gal of flap rows, two thirds of attributed water ambiguous | p3 |  |
| #1669 | [obs] The moisture source is not measured, so wet nights cannot be attributed to wetting, irrigation or hand watering | p2 |  |
| #1670 | [obs] Furnace saturation is not alerted and the winter heating margin is not recorded | p2 |  |

**Step 4 and documents**

| Issue | Title | Priority | Needs Jason's decision |
|---|---|---|---|
| #1671 | [conv] Replace mode arbitration with a two-axis band controller once the patched firmware has proved the behaviour | p3 | yes |
| #1672 | [conv] Control documents no longer describe the running controller | p3 |  |

**Suggested order.**

1. **This week, no firmware.** Retire the failing collector and stop the ledger. Apply the five settings and start the 14-night comparison; when it ends, `night_vpd_bias_kpa` 0.10 can be tried (optional; decision 2). Make a delivery stall page. Repair the
   heater alert and add a clock comparison.
2. **One firmware release.** The four changes of section 10.2, the remaining boot default, the retained-clock
   guard and the missing-probe check, together with the merge that is waiting to be flashed.
3. **Removal, in the order of section 10.3.** The order matters (sections 6.2 and 8.2). No item changes control
   behaviour except compiling the settings into constants and retiring the moisture guardrail and the
   forecast-action engine, which follow the constants of steps 1 and 2.
4. **The planner.** Fix what it is scored on; point the guardrail at the served band for as long as it is
   kept; then reduce the planner's role as decided.
5. **After a month of the patched firmware.** Decide on the two-axis controller.

## 13. Limits of this review

- **Simulated gains are not validated in the house.** The two variants bracket the cool-season night humidity
  of 2026, not the record as a whole: scored the same way, the simulated current firmware is between 15 points
  below and 30 points above the recorded month, and above it in four of six months. The conclusions rest on
  differences that hold under both variants. The two-axis comparison was also repeated under nine changes to
  the physics; the settings step and the patch only under a halved and a doubled fan flow (section 9.8). Step 1
  is the test.
- **Winter is extrapolated.** Mid-November to April have no record of today's house with a working electric
  heater. The winter fit uses a season in which that heater delivered nothing.
- **The moisture source is not measured.** It is the largest uncertainty in the model, and the reason for two
  variants. Hand watering is inferred, not recorded.
- **Heat buys less night VPD in the record than in the model in autumn.** With the house closed, the simulated
  dew point follows the temperature by 0.50 to 0.66 °F per °F. The W5 research measured 0.53 over the year and
  0.84 from September to November. Figures that depend on heat lifting VPD, the warmer night of section 9.7 most
  of all, may be overstated for autumn.
- **The night-bias scenarios were run after the fact-check.** They use the same simulator: after the
  setting was added to it, all ten binaries were rebuilt and the `base`, `step1` and `night` scenario groups, the
  night robustness runs and the night checks came out unchanged. A separate reviewer then tried to refute
  them: the path from the setting to the control loop, the unbiased grade and every figure held. The first
  wording overstated the gain on today's firmware; section 9.7 now gives it.
- **The second fan's air flow is poorly identified.** The three fits put it at 0.08, 0.10 and 0.32 kg/s. The
  both-fans option of section 9.7 is given at both ends of that range.
- **Gas is not metered.** Gas figures are burner time at the nameplate input. The furnace's delivered heat
  is 12 to 18 kW by the heat balance and 9 kW in the fitted model.
- **Crop needs were not assessed.** The review measures compliance with the served band. It does not say the
  band is right for the plants, and it makes no condensation or disease claim: no glazing or leaf temperature
  is measured.
- **One air mass.** Compliance is graded on the house average. The north probe is inside the VPD band 15 points
  less often than the average.
- **The planner comparison is observational.** Delivered and undelivered days differ in weather, reboots and
  season. It can exclude a large effect in either direction, not a small one.
- **The snapshot predates migration 309.** Table names and grading functions in the evidence are those of the
  morning of 2026-11-15.
- **Not every finding was checked twice.** Eight groups of findings and one root cause were verified
  adversarially, and this report was fact-checked against its sources (901 statements, 186 corrections). The
  other audit findings were checked against the code or the data by the audit that made them, and each issue
  repeats the check for the lines it cites.
- **What a later check changed.** The night VPD edge was first read as an open question, with a lower edge
  recommended. It is a decision of 2026-11-05 with its own acceptance measure, so this review scores that
  measure (section 9.7) and shows the lower edge as a comparison only. Section 8.3 first said that the grade
  and the control loop use different VPD signals; they use the same one. A warmer night was first listed as an
  equal option; the W5 measurement of how the dew point follows the temperature makes it the weaker one.
- **What the fact-check changed.** Three corrections moved a number in the summary. The settings step is
  78.3 / 69.6, not 78.9 / 70.6: the first run assumed no mister budget, which the firmware does not accept as a
  setting. The band change is simulated at night only (83.8 / 79.2 and 88.6 / 88.3 after steps 1 and 2); the
  first run moved the edge at all hours (84.8 / 80.7 and 88.6 / 88.3). And the simulation is compared with the
  record on one definition (table A2), which puts variant B within 13 points of the record in three of six
  months, not five.
- **Earlier recommendations.** Several items here were recommended before (the legacy cascade four times) and
  closed unplanned in the backlog reset. This review does not assume they were rejected on their merits; the
  issues name their predecessors.

## Appendix A. Tables

### A1. Simulated compliance by month

Both in band, percent of time. The measured column is the served-band record of section 4.1 (the band of the
time); the simulated columns use today's band. The months before 2026-05 have no served-band record.

| Month | Measured (served band of the time) | Current firmware A / B | Step 1 A / B | Step 2 A / B | Two-axis A / B | Furnace h/day, current A / B | Therms/day, current A / B |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2025-11 | no served-band record | 86.3 / 66.5 | 87.8 / 74.4 | 93.4 / 91.8 | 92.8 / 91.7 | 5.9 / 6.9 | 4.5 / 5.2 |
| 2025-12 | no served-band record | 89.3 / 75.1 | 89.4 / 80.9 | 93.2 / 95.7 | 92.4 / 94.9 | 6.1 / 7.3 | 4.6 / 5.5 |
| 2026-01 | no served-band record | 80.5 / 79.5 | 80.6 / 82.2 | 85.8 / 92.2 | 84.7 / 91.8 | 9.8 / 10.9 | 7.4 / 8.2 |
| 2026-02 | no served-band record | 87.8 / 75.6 | 88.4 / 81.0 | 92.6 / 94.5 | 91.8 / 94.1 | 5.6 / 6.8 | 4.2 / 5.1 |
| 2026-03 | no served-band record | 83.0 / 67.4 | 87.5 / 81.1 | 92.5 / 93.1 | 91.6 / 89.8 | 3.1 / 4.0 | 2.3 / 3.0 |
| 2026-04 | no served-band record | 82.6 / 60.4 | 87.0 / 76.6 | 92.2 / 91.6 | 92.1 / 87.6 | 3.1 / 4.2 | 2.3 / 3.1 |
| 2026-05 | 49.8 (25th to 31st) | 71.5 / 68.8 | 78.0 / 75.4 | 91.2 / 89.2 | 90.2 / 87.7 | 2.7 / 4.4 | 2.0 / 3.3 |
| 2026-06 | 52.6 | 64.9 / 62.9 | 71.2 / 69.0 | 80.1 / 78.2 | 77.7 / 76.6 | 0.1 / 0.2 | 0.1 / 0.1 |
| 2026-07 | 46.2 | 46.5 / 33.4 | 62.4 / 42.5 | 66.9 / 52.5 | 61.3 / 51.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| 2026-08 | 43.5 | 57.6 / 46.7 | 68.6 / 55.4 | 75.4 / 65.9 | 70.8 / 62.6 | 0.1 / 0.0 | 0.0 / 0.0 |
| 2026-09 | 43.2 | 65.3 / 64.9 | 71.7 / 73.3 | 84.1 / 82.6 | 81.5 / 78.6 | 0.2 / 0.1 | 0.1 / 0.0 |
| 2026-10 | 48.9 | 57.5 / 38.7 | 73.9 / 56.0 | 84.3 / 72.2 | 80.5 / 67.6 | 1.2 / 1.8 | 0.9 / 1.4 |
| 2026-11 | 52.5 (to the 15th) | 81.2 / 53.3 | 85.2 / 60.3 | 92.7 / 85.4 | 92.3 / 84.2 | 2.3 / 3.4 | 1.7 / 2.5 |

### A2. Simulated current firmware against the record

The record is shown twice: graded against the served band of the time (section 4.1), and scored by the
simulator's code against today's band, which is the definition the simulated columns use. The last column uses
the second.

| Month | Record, served band of the time % | Record, today's band % | Simulated current firmware, A / B | Simulated minus record on today's band, A / B (points) |
|---|---:|---:|---:|---:|
| 2026-06 | 52.6 | 44.9 | 64.9 / 62.9 | +20.0 / +18.0 |
| 2026-07 | 46.2 | 48.2 | 46.5 / 33.4 | -1.8 / -14.8 |
| 2026-08 | 43.5 | 43.4 | 57.6 / 46.7 | +14.3 / +3.3 |
| 2026-09 | 43.2 | 43.2 | 65.3 / 64.9 | +22.1 / +21.7 |
| 2026-10 | 48.9 | 47.4 | 57.5 / 38.7 | +10.1 / -8.6 |
| 2026-11 | 52.5 | 50.9 | 81.2 / 53.3 | +30.2 / +2.4 |

The simulated system has no faults and runs today's firmware all year. September 2026 had three faults (the
wrong clock, the frozen dispatcher and boot defaults), which probably account for part of the 22 points by
which both variants exceed it; the simulation does not test this.

## Appendix B. Reproduction

Everything needed to repeat the simulation is in
[`control-review-2026-11-15/`](control-review-2026-11-15/README.md): the model, the fitting code, the
closed-loop simulator, the scenario definitions, the fitted parameters and the result files that the tables in
this report are generated from. The production data extract is not in the repository; the README gives the
read-only extraction steps. One of the extraction queries reads a table that migration 309 has since dropped;
the simulation needs only the climate, relay and energy extracts. The firmware diff used in section 9.5
(`sim/firmware-lib-sim.patch`, 85 lines) covers the furnace thresholds and the dry-out; the interlock fix is a
simulator option and the wetting constants are settings. The diff is applied to a copy; the repository's
firmware is unchanged.
