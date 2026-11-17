# Dashboard v2: parity and coverage

Part of the dashboard v2 design ([README](README.md)). Every capability of the operating stack and where v2
shows or controls it. A row is done when its screen shows it from the named read, in both themes and at every
width. "Kept" means the current behaviour carries over unchanged in function.

## 1. Climate: band, law, drying

| Id | Capability | v2 home | Reads, writes |
|---|---|---|---|
| K-01 | The house band as four edges at four solar points; edit as one change with a reason | Climate → Band | API-23, API-24 |
| K-02 | Preview of a draft band against the stored band, the last day, the forecast and the expected night VPD | Climate → Band | API-23 |
| K-03 | Where each rule acts inside a draft band | Climate → Band (preview lines) | API-23 `law_lines` |
| K-04 | Band validation: outer limits, narrowest band, warnings | Climate → Band | API-23 |
| K-05 | Each edge's delivery to the controller by readback | Climate → Band (after saving); System → Data | API-09, API-37 |
| K-06 | Band in force on the controller, its source, repaired or not, host difference | Climate → Law; Now hero | API-30, API-02 `law.band` |
| K-07 | Band change history | Climate → Band | API-17 |
| K-08 | The drying cost limit: view, set (owner), readback, where it comes from | Climate → Band; Climate → Drying | API-30, API-10 |
| K-09 | Every rule: its thresholds for the band in force, wanted, asked for, relay state, waiting on a minimum time | Climate → Law | API-30 |
| K-10 | The drying decision in the law's order, with the refusal reason, the price and the limit | Climate → Law; Climate → Drying; Now | API-30, API-02 `law` |
| K-11 | Protection limits active | Now hero; Climate → Law | API-30, API-02 `law` |
| K-12 | Running alone: clock, probes, host, gap log | Climate → Law; System → Controller | API-30, API-35 |
| K-13 | What the law asked for and what ran, over time | Climate → Law; Graphs (Law and equipment) | API-31, API-05 |
| K-14 | Price against limit over time, the decision over time | Climate → Drying; Graphs (Drying) | API-31 |
| K-15 | Drying per day: hours, runs, water removed, heat spent, price paid, refused by reason, furnace starts after | Climate → Drying; Record → Days | API-32 |
| K-16 | The drying meter since restart | Climate → Drying | API-30 |
| K-17 | Law constants: hash against the release, timing values, lead fan | Climate → Law (disclosure); System → Controller | API-30 |
| K-18 | Run by hand: fans with vent open, humidify, circulate; remaining time; stop; the 15-minute cap without a temperature reading | Now; System → Equipment | API-IRR-12, API-02 |
| K-19 | Outdoor reading and its source (station, intake, none) | Now; Climate → Law | API-02, API-30 |

## 2. Record, review, graphs

| Id | Capability | v2 home | Reads |
|---|---|---|---|
| R-01 | Per day: in band (both, temperature, VPD, day, night, below, above), night dried, dry-out minutes, above full cooling | Record → Days, In band | API-32 |
| R-02 | Per relay per day: starts, run time, repaired runs; 7- and 30-day means | Record → Equipment | API-32 |
| R-03 | Counter check per relay and day | Record → Equipment | API-33 |
| R-04 | Electricity metered with coverage; gas estimated; water by use | Record → Utilities, Days | API-32 |
| R-05 | 7- and 30-day means of the headline figures | Record → Days | API-32 `means` |
| R-06 | Before the law against since the law, with the limits that qualify the comparison | Record → Days | API-32 `baseline`, `since_law` |
| R-07 | Alerts per day | Record → Days | API-32 |
| R-08 | Today's review state: written, due, late, failed with reason | Review; Now | API-34, API-02 `review` |
| R-09 | The review's summary; its proposal with current and proposed edges, reason, price; proposal state | Review; Climate → Band | API-34 |
| R-10 | A proposal waiting is flagged until answered | Now (Needs you); Review; Band | API-02 `review`, API-34 |
| R-11 | Review history | Review | API-34 |
| R-12 | Reviewer tokens against their mean; attempts; failures | Review | API-34 |
| R-13 | Minute-level series for every stored measure, with band, events, tables and CSV | Graphs → Explore | API-03, API-04, API-05, API-06 |
| R-14 | Probes compared against the house band | Graphs → Zones; Now | API-04 |
| R-15 | Gaps in the record drawn as gaps | every chart | API-04, API-31 |
| R-16 | Sensors that cannot be trusted are labelled (CO2, indoor light); no daily light integral | Graphs; Now (All readings) | API-03 notes |

On demand: a review can be requested only through the admin MCP tool; the dashboard shows its result.

## 3. System

| Id | Capability | v2 home | Reads, writes |
|---|---|---|---|
| S-01 | Every climate relay: state, since, run time and starts today, why | System → Equipment | API-13, API-30, API-32 |
| S-02 | Every water relay: state, since, minutes and starts today | System → Equipment | API-13, API-IRR-01 |
| S-03 | Flags: occupancy, leak, flow | System → Equipment; Now | API-13, API-02 |
| S-04 | Relay lanes 24 h and 72 h | System → Equipment | API-05 |
| S-05 | Hardware budget against its limits: memory minute low, largest block, loop time, storage write time, stack, storage entries | System → Controller | API-35 |
| S-06 | Firmware against the pinned release, uptime, restarts, reset reason | System → Controller | API-35 |
| S-07 | Wi-Fi, clock, probes answering | System → Controller | API-35 |
| S-08 | Hardware trends | System → Controller; Graphs (Controller) | API-04 |
| S-09 | Restart the controller | System → Controller | API-IRR-12 |
| S-10 | Table freshness and flow; ingestor heartbeat | System → Data | API-36 |
| S-11 | Probe ages | System → Data | API-36 |
| S-12 | Outages, replayed quarters, per-day continuity, gap log state | System → Data | API-36 |
| S-13 | Delivery: outcomes, oldest unconfirmed, time to confirm, failing settings, readback pass | System → Data | API-37 |
| S-14 | Ingestor counters | System → Data | API-36 |
| S-15 | Every setting: value, readback, state, bounds, history, release; grouped by effect | System → Settings | API-09 to API-12 |
| S-16 | Shell banners: API down, ingestor not running, controller not reporting, flow or leak, settings not confirmed, changes switched off | every page | API-02 |
| S-17 | Roles and session: operator and viewer, sign-in refusal, session ended | every page | API-01 |
| S-18 | Search across pages, settings, relays, lines and terms | every page | API-09 |
| S-19 | Light and dark themes | every page | none |

## 4. Water, soil

W-01 to W-29 are kept, each at its present place on Water (status, agenda, create and edit schedules by clock,
sunrise, solar noon or sunset with an offset, copy, run once, stop one, stop all, pause, enable, the one-time
line check, caps, mister membership, clear fault, limits, minutes, the run ledger, daily gallons, leak, occupancy
hold, backup misting). Changes:

| Id | Capability | v2 home | Reads, writes |
|---|---|---|---|
| W-18 | Run by hand | Now; System → Equipment (see K-18) | API-IRR-12 |
| W-19 | Controller restart | System → Controller (see S-09) | API-IRR-12 |
| W-22 | Soft daily budget for mist and fog: edit | Water → Today (Change opens the setting) | API-10 |
| W-30 | Why the misters are or are not running | Water → Today (Misting) | API-30, API-13 |
| W-31 | The day's water from the daily record | Water → History; Record → Utilities | API-32 |
| SO-01 | Soil targets: view and edit a zone | Water → Soil | API-SOIL-01, API-SOIL-02 |
| SO-02 | Soil moisture, conductivity and temperature now and over 7 days against the target | Water → Soil | API-04 |
| SO-03 | A probe that has not reported is said so | Water → Soil; System → Data | API-36 |
| SO-04 | Soil alerts | Activity | API-14 |

## 5. Lights

| Id | Capability | v2 home | Reads, writes |
|---|---|---|---|
| L-01 | State as the switch reports it, the controller's intent, the timer | Lights; Now; System → Equipment | API-13 |
| L-02 | Turn on or off for a time | Lights; Now | API-20 |
| L-03 | Back to automatic | Lights | API-10, API-20 |
| L-04 | The timer's end returns the light to the intent | Lights (shown) | API-13 |
| L-05 | Out of service | Lights (settings) | API-10 |
| L-06 | The twelve settings of each circuit with readback | Lights (settings) | API-09, API-10 |
| L-07 | Lighting by day and the lighting graph | Lights; Lights → History | API-22, API-05 |
| L-08 | The controller's reason in words | Lights | API-13 |
| L-09 | That the lights depend on Home Assistant, and whether the last command was confirmed | Lights | API-13 |

## 6. Crops, hydroponics

C-01 to C-10 and H-01 to H-03 are kept. Changes:

| Id | Capability | v2 home | Reads, writes |
|---|---|---|---|
| C-11 | Edit a planting, including its expected harvest | Crops (edit form) | API-CROP-11 |
| C-12 | Add a note to a planting | Crops (planting drawer) | API-CROP-12 |
| H-04 | Reservoir probe age | Hydroponics; System → Data | API-02, API-36 |
| H-05 | No battery series (the meter is mains-powered) | Hydroponics | none |

## 7. Alerts and activity

| Id | Capability | v2 home | Reads, writes |
|---|---|---|---|
| A-01 | Open alerts with severity, acknowledge, resolve, clear fault | Activity; Now | API-14 to API-16, API-IRR-13 |
| A-02 | Words for every alert type the stack raises, and a link to the page that explains each | Activity | API-14 |
| A-03 | The activity log: every write by people, the reviewer, agents and the host, with filters | Activity → Log | API-17 |
| A-04 | The alert's runbook text | Activity (alert detail) | API-14 |

## 8. Retired from the dashboard

The Plan page and plan history; planner health and required triggers; plan lanes and plan markers on charts;
"Let Iris change this" and the manual lock on climate settings; mode, mode reason and mist stage; target and
width fields on the band; the night bias; zone bands; the target series; the planner study states; Statistics
as a section of Graphs (its figures live in Record, from the daily record); the bridge-period water strings; the
reservoir battery series.
