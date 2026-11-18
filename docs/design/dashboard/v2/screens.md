# Dashboard v2: screens

Part of the dashboard v2 design ([README](README.md)). One section per screen: the question it answers, what it
shows in reading order, where each value comes from, and its controls. Layout follows
[design-system.md](design-system.md) section 3; words follow [words.md](words.md); operation ids are those of
`../openapi/dashboard-api.v1.yaml` and [api.md](api.md).

Rules for every screen:

- The order on a phone is the reading order below. Above 860 px, blocks marked (side) sit in a right column of
  4 of 12; the rest fills 8, or all 12 when there is no side block.
- The answer comes first, in words: the page's first block states the answer to its question as a sentence built
  from the data, with the numbers that matter, before any table, ladder or chart.
- One observation time a page: the header's status line says how fresh the page is. A block shows its own time only
  when its live read (a relay, a probe, the controller) is not the header's, or when it is stale, failed or not
  reporting; blocks of daily or historical data never do. Every block has all four states of design-system
  section 3.
- Pages stay short: at most about four screens at 1440 px and six on a phone unless the reader asked for more (Show
  all, a longer range, an opened group). Long lists start collapsed or limited.
- A viewer sees every read and no write control. A control that only the owner may use says so.
- A link that leaves the page for evidence opens Graphs on the same time window.

---

## 1. Now `/`

**Question:** Is the house all right, and what needs me?

| # | Block | Shows | Reads |
|---|---|---|---|
| 1 | Hero | The answer as the title, worst first: cannot reach the data; the ingestor is not running; the controller is not reporting (it keeps holding the band on its own); water is flowing with every valve closed; a protection limit is active (too hot, too cold); out of band, with which edge and by how much; N things need someone; waiting for fresh data; all OK. Under it: two band gauges (temperature, VPD) with the band the controller is using, the reading and its relation in words; relative humidity and dew point as plain values; outdoor temperature with its source; when it was updated | API-02 (`climate`, `law.band`, `outdoor`, `freshness`) |
| 2 | What the controller is doing | One or two sentences built from the law's requests and the drying decision, never from a mode label. Examples: "Holding the band. Nothing is running." · "Electric heat is on: the house is within 3.5 °F of the low edge." · "Venting with one fan to cool: the house is above the high edge." · "Fogging: the air is drier than the band allows." · "The air is more humid than the band allows, but drying is refused: it would cost 0.82 kWh/kg and the limit is 0.70." Each active relay as a chip with how long it has been on. Link: Why → `/climate` | API-02 (`law`, `running`) |
| 3 | Needs you (side) | Open alerts that are not acknowledged (three, then a link), with Acknowledge; a daily review that is late or failed; a band proposal waiting, with Open → `/review`; mister faults with Clear fault; settings the controller has not confirmed, with a link to `/system/data`. When empty: "Nothing needs you." and how many alerts resolved in 24 h | API-14, API-02 (`review`, `writer`), API-IRR-01 |
| 4 | Today | A 24-hour chart of temperature and VPD against the band (two small charts on one time axis, the house line, the band, the outdoor line dashed), and under it one lane of what ran (heat, cooling, humidifying, drying). Beside the title: time in band today so far, yesterday, and whether last night dried out | API-04, API-06, API-05, API-32 (yesterday and today) |
| 5 | Run by hand (side, operators) | Three timed runs with identical names everywhere: Run the fans (vent open, 15 min), Humidify (fog, 5 min), Circulate (fans, vent closed, 10 min). A running one shows its remaining time and Stop. One line says a protection limit ends any of them. Then the two lights: state, and Turn on or off for 15 min | API-IRR-12, API-02 (`overrides`), API-20, API-13 |
| 6 | Water today | Gallons today by use against the daily limit, minutes per zone against each cap, whether water is flowing, the next scheduled run. Stop all water (operators) is here and in the top bar | API-IRR-01, API-IRR-02 |
| 7 | Daily review (side) | The newest review's first paragraph, its date and state, and Read → `/review`. Kept visibly apart from the five-minute AI snapshot, which, when present, is a labelled paragraph inside the hero's disclosure | API-02 (`review`), API-34 (limit 1) |
| 8 | Reservoir (side) | pH, conductivity and water temperature with their ages; link to `/hydroponics` | API-02 (`hydroponics`) |
| 9 | Probes | The four wall probes and the case probe as tiles: temperature, VPD, a 24-hour sparkline, and each against the one house band. No per-zone band | API-04 |
| 10 | All readings (disclosure) | Every reading with its source and time; the law record as reported (requests, latches, drying decision, cost, limit, band, repaired); the freshness of each source | API-02 |

First screen on a 390 by 844 px phone: the hero, the controller sentence and, for an operator, Stop all water above
the bar.

---

## 2. Climate

### 2.1 Law `/climate`

**Question:** What is the controller doing to hold the band, and why?

| # | Block | Shows | Reads |
|---|---|---|---|
| 1 | Header status | Reporting or not, the record's age, whether the controller's constants match this release | API-30 (15 s) |
| 2 | Rule ladders | Two ladders, temperature and VPD. Each is one axis with the band as a zone, the reading as a marker, and every rule of that signal as a labelled tick at its on value (the off value appears on focus and in the table). Temperature, left to right: cold limit, gas furnace, electric heat, [band], cooling, second fan, hot limit. VPD: drying wanted, [band], fog, misters. Under each ladder, its rules as rows: name; "turns on below 67.9 °F, off at 70.4 °F"; state as one of Off, Wanted, On since 09:12, Waiting 2 min 10 s (minimum off time), Held on 1 min (minimum on time); the relays it drives with their state | API-30 (`band`, `inputs`, `rules`, `timing`) |
| 3 | Drying decision (side) | A checklist in the law's order: the air is humid enough to want drying; outdoor air is drier; it is worth the heat (price against limit, both numbers); the house is warm enough; the house is not being cooled; the gas furnace is off. Then the verdict: Running, Refused with the reason in words, or Not wanted. Link → `/climate/drying` | API-30 (`drying`) |
| 4 | Band in force (side) | The four edges the controller is using; where they came from (its own curve, or the widest safe band because it has no clock); whether its band check repaired what it received; whether the host's band differs, with both | API-30 (`band`) |
| 5 | Running alone (side) | A checklist: clock set (and its age); probes answering (count); host connected; gap log armed. Each failed row says what the controller does instead | API-30 (`alone`) |
| 6 | Asked and ran | State lanes over 24 h, 72 h or 7 d: what the law asked for (heat 1, heat 2, cooling, second fan, fog, misters, drying, hot limit, cold limit) over what ran (the relays). Gaps in the record are hatched. A disclosure adds the latch lanes. Link → Graphs, preset Law and equipment | API-31, API-05 |
| 7 | Timing and constants (disclosure) | Minimum on and off times, the mister pulse and gap, the two protection limits, lead fan, the constants hash (controller and release) | API-30 (`timing`, `constants`, `lead_fan`) |

### 2.2 Band `/band`

**Question:** What band do I want the house held in?

The band is a low and a high edge for temperature and for VPD at four points of the solar day. The law reads
edges only, so the editor edits edges. The target rows are not shown and not edited.

| # | Block | Shows | Reads and writes |
|---|---|---|---|
| 1 | Proposal (when one waits) | "The daily review of 16 Nov proposes a change": each changed edge as current → proposed, the reason, the price note. Load into the editor fills the draft; the owner still saves. Dismiss hides it for this visit | API-34 |
| 2 | Preview | Two charts over the solar day, temperature and VPD: the stored band, the draft band where it differs, the last 24 h measured, the outdoor forecast (temperature), the expected night VPD (VPD), sunrise, noon, sunset. Drawn inside the band and labelled: where electric heat starts, where the furnace starts, where cooling starts, where drying is wanted, where fog starts. Errors and warnings of the draft listed under the charts | API-23 (300 ms after an edit) |
| 3 | Set the band (owner) | Temperature: day low and high (solar noon), night low and high (solar midnight). VPD: the same four. Each a stepper on the controller's own step. Sunrise and sunset sit halfway between day and night; "Set sunrise and sunset separately" opens the sixteen edges as a table. Limits shown beside the fields: the narrowest band the law allows, the outer limits. Reason (optional). Save writes every changed edge as one change | API-23, API-24 |
| 4 | After saving | Each edge as sent, then confirmed by the controller's readback; the band in force on the controller once it has it | API-09, API-30 |
| 4a | The one price (owner) | The drying cost limit beside the band, because the two are the whole policy: the limit in force, the price the controller is paying now, the same stepper and Save as on Drying, and a link to Drying for the evidence | API-30, API-10 (`dry_cost_limit_kwh_per_kg`) |
| 5 | History | The band's changes: when, who, which edges, the reason | API-17 (`band.write`) |
| 6 | How the band works (disclosure) | Short prose and one diagram: the edges, the rules that act on each, the one price, and what the controller does without a host | none |

Retired from this page: target fields, widths, "Let Iris change this", the night bias, the zone bands.

### 2.3 Drying `/climate/drying`

**Question:** Is drying the air worth what it costs, and am I paying the price I meant to?

| # | Block | Shows | Reads and writes |
|---|---|---|---|
| 1 | Now | The verdict (Running, Refused: reason, Not wanted) and the price against the limit on one bar: the price the controller computes now, the limit as a mark, "no outdoor reading" when there is no price | API-30 (`drying`) |
| 2 | The limit (owner) | The limit in force on the controller, where it comes from (set by the owner, or the controller's default), a stepper on its step with its range, Save, and the readback. Two sentences on what raising or lowering it does | API-30, API-09, API-10 (`dry_cost_limit_kwh_per_kg`) |
| 3 | Price against limit | A chart over 24 h, 72 h, 7 d or 31 d: the price, the limit as a stepped line, refused spans shaded; under it a lane of the decision (running, refused by reason, not wanted) | API-31 (`cost`, `drying`) |
| 4 | By day | Per day for 30 days: hours of drying, runs, water removed (kg), heat spent (kWh) and the price paid (kWh per kg) as daily bars; hours wanted but refused, stacked by reason; furnace starts after drying. A restart that lost meter counts marks its day as a lower bound | API-32 (`drying`) |
| 5 | Meter since the last restart (side) | Seconds, water, heat, refused seconds as the controller counts them, with the time | API-30 (`drying.meter`) |
| 6 | How drying works (disclosure) | The decision in order, and why each refusal exists | none |

---

## 3. Water

Water keeps its three views and gains Soil. The layout (page head, program banner, Stop all water) stays.

### 3.1 Today `/water`

As today (site summary, a card per zone with its lines, running now, caps and the daily limit), with these changes:

- A **Misting** block states why the misters are or are not running, from the law and the mister holds: wanted
  or not (VPD against the mist line), then the hold in force in words (water budget, someone is inside, a drip
  line is running, too close to the dew point, the pulse gap, no zone available). Reads API-30 (`rules` mist and
  fog) and API-13.
- The soft daily budget for mist and fog shows its value with Change, which opens that setting; the hard daily
  limit says plainly that nothing is exempt from it.
- Zone order and the choice of zone are described as the controller does it: a fixed order (centre, south, west,
  east) against the one house band, with a turn for a zone that has waited 10 minutes.
- Every string written for the bridge period before the irrigation engine is deleted.

### 3.2 Schedules `/water/schedules` and 3.3 History `/water/history`

As today. History's daily water adds the day's totals from the daily record (wetting, crop, house) beside the
per-line totals, with the record as the stated source of the day's number (API-32).

### 3.4 Soil `/water/soil`

**Question:** Is each zone's soil where I want it?

Per zone: moisture, conductivity and temperature now with their ages, the target range with Edit (operators), a
7-day chart of moisture against the range, and when the probe last answered. A probe that has not reported says
so; it is not drawn as zero. Reads API-04, API-SOIL-01; writes API-SOIL-02. The soil targets leave Settings.

---

## 4. Lights

### 4.1 Lights `/lights`

**Question:** Are the lights doing what I want?

| # | Block | Shows | Reads and writes |
|---|---|---|---|
| 1 | Two circuits | For Main and Grow: on or off as the switch reports it; what the controller wants and why, in words (enough daylight, outside the window, a plant needs light, held on by hand, minimum on time); a mismatch between the two called out; today's window and minutes on | API-13, API-22 |
| 2 | By hand (operators) | Turn on or off for 15 minutes (up to 120), the time left, Back to automatic | API-20, API-10 |
| 3 | How they are switched | One sentence and a state: the lights are switched through Home Assistant; if it or the network is down they stay as they are. Shows whether the last command was confirmed | API-13 |
| 4 | Settings | The twelve settings of each circuit in groups (window, daylight thresholds, hold times, out of service), each opening the setting drawer | API-09 |
| 5 | Last 7 days | Minutes on per day per circuit as daily bars | API-22 |

### 4.2 History `/lights/history`

The lighting graph that was Graphs → Lighting, unchanged in function.

---

## 5. Crops `/crops`, `/crops/history` and Hydroponics `/hydroponics`

As today, with:

- A note on a planting from its drawer (API-CROP-12), listed in its history.
- The expected harvest date in the edit form (API-CROP-11).
- Hydroponics drops the battery series: the meter runs on mains power and never reports one.

---

## 6. Record

The daily record is what the reviewer reads. Every view offers 30 days by default and 7, 90 and 365 days.

### 6.1 Days `/record`

**Question:** How did each day go, against the last week and month?

| # | Block | Shows | Reads |
|---|---|---|---|
| 1 | Means | Stats with the 7-day mean, its change against the 30-day mean and a 30-day sparkline: time in band, nights dried (of 7), climate starts a day, heater hours a day, electricity (kWh a day), gas (therms a day, estimated), crop water (gal a day), drying (hours a day) | API-32 (`means`, `days`) |
| 2 | Days | A table, newest first: date; in band (both, temperature, VPD); night dried; climate starts; heat 1 and heat 2 hours; kWh; therms; crop gallons; drying hours; alerts. Today is the first row, marked "so far". A day with partial meter coverage shows its kWh as "partial". A row opens Graphs on that day | API-32 |
| 3 | Before and after the law | The same means for two periods side by side: the 30 days before the law took over, and the days since. Under the figures, the limits that qualify them: days on which the band was edited are left out of the earlier period; electricity counts only days with at least 70 % meter coverage; a run that crossed midnight is booked to the day it started | API-32 (`baseline`, `since_law`) |
| 4 | Notes | What each column counts and what it does not: gas is estimated from furnace run time; electricity is the metered figure and is blank under 70 % coverage; crop water is misting, fog and irrigation, not the hose | none |

### 6.2 In band `/record/compliance`

Time in band per day as a daily stack (in band, below, above) for temperature and for VPD on one time axis; day
against night as two lines; minutes of night dry-out with dried nights marked; minutes above full cooling. A
table behind each. Reads API-32 (`band`).

### 6.3 Equipment `/record/equipment`

Starts per day and run hours per day for each climate relay (heat 1, heat 2, fan 1, fan 2, vent, fog) as small
multiples with their means; the misters and drip lines in a second group; a table with the 7- and 30-day means.
**Counter check:** per day, whether the controller's own counters agree with the stored record, and the
differences where they do not. Reads API-32 (`relays`), API-33.

### 6.4 Utilities `/record/utilities`

Electricity per day (metered; partial days lighter and labelled), gas per day (estimated), water per day
stacked by use (wetting, irrigation, house), each with its means and a table. Reads API-32.

---

## 7. Graphs

### 7.1 Explore `/graphs`

The explorer keeps its window controls, layers, added metrics, events, CSV and tables. Presets:

| Preset | Panels |
|---|---|
| Climate | Temperature, VPD and humidity against the band, outdoor dashed; equipment lanes |
| Law and equipment | Temperature and VPD against the band; what the law asked for; what ran |
| Drying | VPD against the band with the drying line; price against limit; the drying decision |
| Outdoor | Outdoor temperature, humidity, wind, light, rain |
| Water and soil | Water lanes, soil moisture per zone, flow |
| Light | Outdoor light, the two circuits |
| Controller | Free memory with its limits, loop time, storage writes, Wi-Fi |
| Hydroponics | pH, conductivity, water temperature |

Retired: plan markers, the plan layer, the target series, the forecast band "from the plan". The band ahead of
now is drawn from the stored band.

### 7.2 Zones `/graphs/zones`

The probes compared: each probe's temperature and VPD against the one house band, and the spread between the
warmest and the coolest. No zone bands.

---

## 8. Review `/review`

**Question:** What did the daily review say, and is a proposal waiting for me?

| # | Block | Shows | Reads |
|---|---|---|---|
| 1 | Today | The state of today's review: written at 07:12; due after 07:00; late (after 10:00); failed, with the reason in words and the attempts | API-34 (`today`) |
| 2 | Latest review | The summary as prose, its date, who asked for it (daily, or a person) | API-34 |
| 3 | Proposal | When the review proposes a band change: each edge as current → proposed, the reason, the price note, and its state (waiting, answered, superseded). Open in the band editor (owner) goes to `/band` with the proposal loaded. A review that put its proposal only in the text says so | API-34 |
| 4 | Earlier reviews | A list by date with state and whether it proposed a change; a row opens its summary and proposal | API-34 (paged) |
| 5 | Reviewer health (side) | Tokens used by the newest review against its 7-day mean with the rise in percent (a rise over 20 % is flagged), attempts, failures in the last 30 days | API-34 (`tokens`, `items`) |
| 6 | What the reviewer can and cannot do (disclosure) | It reads the daily record and writes one review. It writes no climate value. It may switch occupancy and a light's out-of-service switch, and it keeps its irrigation tools | none |

---

## 9. Activity `/activity`, `/activity/log`

As today, with words for every alert type the law, the record and the reviewer raise, the alert's evidence link
pointed at the v2 page that explains it (a drying alert to Drying, a controller alert to Controller, a data
alert to Data, a review alert to Review), and no planner filter.

---

## 10. System

### 10.1 Equipment `/equipment`

**Question:** What is every relay doing, and can I run one by hand?

| # | Block | Shows | Reads and writes |
|---|---|---|---|
| 1 | Climate relays | Heat 1 (electric), heat 2 (gas), fan 1, fan 2, vent, fog: on or off, since when, run time and starts today, and why in the law's words (asked for, waiting on a minimum time, held off by an interlock), each linking to `/climate` | API-13, API-30, API-32 (today) |
| 2 | Water relays | The eleven lines with state, since, minutes and starts today | API-13, API-IRR-01 |
| 3 | Lights | Both circuits, state and controller intent; controls live on `/lights` | API-13 |
| 4 | Run by hand (operators) | The same three timed runs as Now, with Stop | API-IRR-12 |
| 5 | Flags | Someone inside, leak, water flowing | API-13, API-02 |
| 6 | Last 24 h or 72 h | Relay lanes | API-05 |

The daily run-time chart moves to Record → Equipment; the controller card moves to Controller.

### 10.2 Controller `/system/controller`

**Question:** Is the controller healthy?

| # | Block | Shows | Reads |
|---|---|---|---|
| 1 | Verdict | Healthy, or the first limit crossed, in words | API-35 |
| 2 | Hardware budget | Stats, each against its limit with a meter: free memory (minute low) against the warning and critical lines; largest free block; loop time (worst); storage write time (worst); stack free; storage entries used and free | API-35 (`heap`, `loop`, `nvs`, `limits`) |
| 3 | Identity and uptime | Firmware version against the pinned release; uptime; restarts and the last reset reason; when it last booted | API-35 |
| 4 | Links | Wi-Fi signal, disconnects, API clients; clock set, age of the last sync; probes answering | API-35 |
| 5 | Law state | Band source, gap log state, constants match | API-35, API-30 |
| 6 | Trends | Threshold series over 24 h or 7 d: free memory minute low, largest block, loop time, storage write time, Wi-Fi signal | API-04 (controller keys) |
| 7 | Restart (operators, disclosure) | Restart the controller, with what it interrupts | API-IRR-12 (`restart`) |

### 10.3 Data `/system/data`

**Question:** Is the record complete, and did the controller take what was sent?

| # | Block | Shows | Reads |
|---|---|---|---|
| 1 | Flow | Each stored table with the age of its newest row and rows in the last five minutes; the ingestor's heartbeat | API-36 (`tables`, `ingestor`) |
| 2 | Probes | Each sensor with the age of its last answer; not seen in two hours is said so | API-36 (`probes`) |
| 3 | Continuity | Per day over 1, 7 or 30 days: seconds without data and minutes the gap log restored, as daily bars; the list of outages (start, end, length, reason, whether replayed); the replayed quarters | API-36 (`by_day`, `outages`, `replayed`, `gap_log`) |
| 4 | Delivery | Pushed values by outcome over 24 h or 7 d; the oldest value still unconfirmed; time to confirm (median, 95th); the settings whose pushes failed, with a link to each and how each stands (Failing, In force, Recovered, Retired); the last readback pass | API-37, API-09 |
| 5 | Ingestor counters (disclosure) | Reconnects, rejected payloads and rows by table, replay failures | API-36 |

A setting is not taken now only when no push was confirmed after its last failure and the catalogue (API-09) does not
show the controller holding the wanted value: the delivery ledger knows only pushes, the catalogue knows what the
controller holds. A setting the catalogue reads confirmed is listed as In force (with its readback time) and one the
catalogue no longer has as Retired; both are listed but not counted in the status line, the answer or the panel's tone.
While API-09 has not answered, delivery counts nothing; when it fails, the ledger alone decides. A push is
still waiting only while its status is not an outcome (confirmed, not taken, cancelled, replaced): API-37's age of the
oldest unconfirmed push also counts a cancelled one, so with no push waiting the page reads "Nothing is waiting".

### 10.4 Settings `/settings`

**Question:** What is every setting, and which ones matter?

The catalogue grouped by what a setting is for, each row with its value, the controller's readback and its
state. Three filters by effect: read by the controller; used by the host; stored and not used (collapsed, and
read-only in wording: changing one changes nothing on this controller). The band's edges appear read-only, in a
group that stays closed, with a link to Band whose words follow the role: "Edit on Band" for an operator, "See on
Band" for a viewer, who cannot change the band (screens §1.3: a viewer sees no write control); the drying cost limit links to Drying; the soil targets link to Soil. The setting drawer keeps
value, bounds, history and release. Retired: the plan column, "Let Iris change this", held-by-experiment states.
Reads API-09, API-12; writes API-10, API-11.
