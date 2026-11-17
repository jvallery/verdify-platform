# Dashboard v2: words

Part of the dashboard v2 design ([README](README.md)). One word per idea, used the same way in navigation,
titles, copy, tooltips, accessible names and alert text. The code that holds them is `dashboard/app/lib/words.ts`
(every code the API sends) and `dashboard/app/lib/glossary.ts` (terms a reader may look up).

## 1. Voice

- Plain words a grower understands; complete sentences; the exact number with its unit.
- Say what the controller is doing and why, in that order: "Venting with one fan to cool: the house is above
  the high edge."
- Name who decided: the controller (the law), the owner (the band and the price), an operator (a setting, a
  manual run), the reviewer (a review, a proposal). Never "the system".
- Unknown is said: "not reported", "no outdoor reading", "not installed". Never a zero in its place.
- No crop or plant name in generic copy. No internal id, table name or bit name in rendered text; the raw record
  is shown only in a disclosure titled "As reported".

## 2. The model's words

| Word | Means | Not |
|---|---|---|
| Band | The range the house is held in: a low and a high edge for temperature and for VPD, through the solar day. Set by the owner | target, setpoint, crop band, zone band |
| Edge | One side of the band: low edge, high edge | limit (reserved for protection and cost) |
| Band in force | The four edges the controller is using this minute | band ahead, derived band |
| Climate law, the law | The controller's fixed rules that turn equipment on and off at the band's edges, every second | mode, state machine, FSM, planner |
| Rule | One line of the law: electric heat, gas furnace, cooling, second fan, fog, misters, drying, hot limit, cold limit | stage, mode |
| Wanted | The rule's condition is met (its latch is set) | latched (in "As reported" only) |
| Asked for | The law asked for the equipment after its own gates | requested (kept for settings awaiting readback) |
| Waiting | Asked for, and held by a minimum on or off time | blocked |
| Held off | Asked for, and stopped by an interlock or a hold, with its reason | blocked, inhibited |
| Drying | Venting to carry moist air out when the outdoor air is drier and the price is under the limit | dehumidifying, DEHUM_VENT |
| Price (of drying) | The heat it costs to remove a kilogram of water, in kWh/kg, as the controller computes it | drying cost e, efficiency |
| Drying cost limit, the limit | The most the owner will pay, in kWh/kg. The one price in the policy | tunable, threshold |
| Refused | Drying was wanted and not run, with one reason: costs more than the limit; outdoor air is not drier; no outdoor reading; the house is too cold to vent; the house is being cooled; the gas furnace is running; humidity cannot be read; temperature cannot be read | blocked |
| Protection limit | The hot limit (100 °F) and the cold limit (40 °F), which override everything | safety mode, SAFETY_COOL, SAFETY_HEAT |
| Running alone | What the controller does without a host, a clock or its probes | degraded mode, fallback |
| Widest safe band | The band the controller uses when it has no clock: the lowest low and the highest high of the day | corridor |
| Repaired band | The controller's band check changed a band it received | clamped |
| Run by hand | One of three timed runs an operator starts: Run the fans, Humidify, Circulate | burst, override, bypass |
| Daily record | One row a day of what happened: time in band, starts, run time, utilities, drying | scorecard, statistics |
| Starts | How many times a relay turned on in a day | cycles |
| Run time | How long a relay was on in a day, as the daily record counts it | duty, on time (kept for a light) |
| In band | The share of a day the house was inside the band: temperature, VPD, both | compliance score, planner score |
| Night dried | The night's VPD reached the drying line for long enough | dry-out achieved |
| Metered, estimated | Electricity is metered; gas is estimated from furnace run time. Each figure says which | cost, nominal |
| Counter check | The controller's own relay counters against the stored record | reconciliation |
| Daily review, the review | What the reviewer writes once a day after reading the record | plan, planner run, cycle |
| Reviewer | The AI that writes the review. Its name, Iris, appears as an author, never as an actor on the climate | planner, Iris plans |
| Proposal | A band change the review suggests. Nothing applies until the owner saves it in the band editor | plan, recommendation applied |
| Hardware budget | The controller's limits: free memory, loop time, storage, stack | heap floor |
| Gap log | The controller's own record of a disconnect, replayed when the host returns | backfill |
| Delivery | A value the host pushed and the controller confirmed by reading it back | sync, push status |
| Confirmed, not confirmed | The controller's readback equals, or does not yet equal, what was sent | REQUESTED, differing |
| Owner, operator, viewer | Who may do what. The band and the limit are the owner's | admin |

## 3. Words that retire

None of these appears in anything rendered. A test fails on them in `lib/words.ts`, `lib/glossary.ts`, route and
component copy.

plan, plan in force, plan age, waypoint, planner, planner health, required trigger, sunrise plan, "Iris changed",
"Let Iris change this", manual (as a lock against the planner), mode, mode code, mode reason, stage, mist stage,
"In band, holding", target, setpoint target, width, bias, night bias, tunable, cascade, zone band, crop band,
experiment, study, held (by a study), forecast band, scorecard, planner score, trust ledger, dispatcher (in copy
outside Data), burst, bypass, DERIVED (as a badge on the band).

Two words stay with a narrower meaning: **manual** means a person's timed action on a light or a water line;
**schedule** means an irrigation schedule and the light window.

## 4. Glossary (`lib/glossary.ts`)

Rewritten or added, each a short definition in the voice above: VPD; band; edge; band in force; climate law;
rule; drying; price of drying; drying cost limit; refused; protection limit; running alone; widest safe band;
run by hand; daily record; starts; run time; in band; night dried; metered and estimated; counter check; daily
review; reviewer; proposal; hardware budget; gap log; delivery; confirmed; daily mist and fog limit; occupancy
hold; main light; grow light; light window; light timer; from peer probes. Removed: the plan, plan-change and
planner terms and "In band, holding".

## 5. Units

°F and kPa for the band; % for humidity and shares; kWh, therms (estimated), gal, kg and g of water, kWh/kg for
the price; h and min for run time (hours above 90 minutes); starts as whole numbers; kB for memory, ms for loop
and storage times, B for stack, dBm for Wi-Fi; s, min, h, d for ages. Times are America/Denver, 24-hour; a date
is "16 Nov".
