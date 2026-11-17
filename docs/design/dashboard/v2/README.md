# Dashboard v2

The redesign of dashboard.verdify.ai for the operating model that the climate refactor made live: the owner sets
a band and one price, the controller's band-edge law holds the house inside the band on its own, the host records
what happened, and a reviewer reads the record once a day and may propose a band change.

This directory is the design of record for v2. It supersedes the section list, the light-only rule and the
Planner-era screens of the earlier design (`docs/design/dashboard/redesign.md`, `design-system.md`,
`screens/`); the decision row is in [`../decisions.md`](../decisions.md). The canonical API contract stays
`../openapi/dashboard-api.v1.yaml`.

| File | Holds |
|---|---|
| [api.md](api.md) | The read model: new operations, additive fields, migration 320, what the API retires |
| [design-system.md](design-system.md) | Tokens, themes, type, layout, components, charts, test policy |
| [screens.md](screens.md) | Every screen: its question, content, data, states and controls |
| [words.md](words.md) | The vocabulary: one word per idea, and the words that retire |
| [parity.md](parity.md) | Feature coverage: every capability of the stack and where the dashboard shows it |

## 1. What changed underneath

| Was | Is now |
|---|---|
| A planner wrote a plan of settings every few hours; the controller followed a mode machine | The controller's law decides climate alone, every second, from the band and its compiled constants |
| Targets with widths, a settings cascade, about 100 planner-writable settings | One house band (a low and a high edge for temperature and for VPD through the solar day) and one price (the drying cost limit) |
| Planner health, plan lanes, waypoints, "Let Iris change this" | A daily review: one row a day with a summary and, sometimes, a proposed band change the owner answers |
| Equipment "mode" and "mode reason" | Law requests, latches and relays; a drying decision with a stated reason and cost |
| Statistics computed from intervals in the browser | The daily record: time in band, starts, run time, utilities and drying per day, with 7- and 30-day means |
| Controller card with heap and uptime | A hardware budget, a gap log that replays what a disconnect lost, and delivery by readback |

## 2. Principles

1. **Answer first.** Every page opens with the answer to its question, then the evidence, then the controls.
2. **One model, one vocabulary.** Band, law, relays, record, review. The navigation, the page titles and the
   copy use the same words as the controller and the record ([words.md](words.md)).
3. **The controller's truth, with its time.** What the controller reported is shown as reported, with when. A
   value the host derived is labelled as derived. Unknown is shown as unknown, never as zero.
4. **Plain words, exact numbers.** A grower reads it without a manual; every number carries its unit.
5. **Controls sit beside their evidence.** The band editor shows the band's effect before saving; the drying cost
   limit sits beside the price the controller is paying; a manual run shows what it will do and when it ends.
   Every write shows its confirmation by readback.
6. **Built for the greenhouse.** It works on a phone held in one hand: 44 px targets, Stop and Run by hand within
   reach, no horizontal scrolling, a dark theme for night visits.
7. **Accessible.** WCAG 2.2 AA contrast in both themes, full keyboard use, reduced motion honoured, a table
   behind every chart.
8. **Nothing retired stays on screen.** No plan, waypoint, mode, target or tunable language; no control that
   writes a value the law does not read.

## 3. Information architecture

Three groups, fourteen sections. One model (`dashboard/app/lib/sections.ts`) feeds the rail, the phone bar, the
tabs, the breadcrumb and the document title.

| Group | Section | Path | Views (tab · title · path) | Question it answers |
|---|---|---|---|---|
| Operate | Now | `/` | one view | Is the house all right, and what needs me? |
| Operate | Climate | `/climate` | Law · Climate law · `/climate`; Band · Band · `/band`; Drying · Drying · `/climate/drying` | What is the controller doing to hold the band, and why? What band do I want? |
| Operate | Water | `/water` | Today · Water today · `/water`; Schedules · Schedules · `/water/schedules`; History · Water history · `/water/history`; Soil · Soil · `/water/soil` | What is being watered, and by what? |
| Operate | Lights | `/lights` | Lights · Lights · `/lights`; History · Light history · `/lights/history` | Are the lights doing what I want? |
| Operate | Crops | `/crops` | Map · Crops · `/crops`; History · Crop history · `/crops/history` | What is planted where? |
| Operate | Hydroponics | `/hydroponics` | one view | How is the reservoir, and what grows in it? |
| Understand | Record | `/record` | Days · Daily record · `/record`; In band · Time in band · `/record/compliance`; Equipment · Equipment record · `/record/equipment`; Utilities · Utilities · `/record/utilities` | How did each day go, against the last week and month? |
| Understand | Graphs | `/graphs` | Explore · Graphs · `/graphs`; Zones · Zones · `/graphs/zones` | What happened, minute by minute? |
| Understand | Review | `/review` | one view | What did the daily review say, and is a proposal waiting for me? |
| Understand | Activity | `/activity` | Alerts · Alerts · `/activity`; Log · Activity log · `/activity/log` | What needs attention, and who changed what? |
| System | Equipment | `/equipment` | one view | What is every relay doing, and can I run one by hand? |
| System | Controller | `/system/controller` | one view | Is the controller healthy? |
| System | Data | `/system/data` | one view | Is the record complete, and did the controller take what was sent? |
| System | Settings | `/settings` | one view | What is every setting, and which ones matter? |

### 3.1 Redirects

Each keeps its query string and answers 302 on the server and a client redirect on navigation.

| Old path | New path |
|---|---|
| `/plan`, `/planner`, `/planner/history` | `/review` |
| `/graphs/statistics`, `/graphs/scorecard` | `/record` |
| `/graphs/lighting` | `/lights/history` |

`/band`, `/settings`, `/equipment`, `/activity`, `/water/*`, `/crops/*`, `/hydroponics` and `/graphs` keep their
paths, so bookmarks, drawer links and alert links keep working.

### 3.2 Navigation by width

- **Above 860 px:** a fixed left rail with the lockup, the three groups (a small group label, then its sections
  with an icon and a label) and, at its foot, the theme switch. The open-alert count sits on Activity. A top bar
  over the content holds Search, the freshness chip, Stop all water (operators) and the account menu.
- **At 860 px and below:** a top bar (lockup, freshness dot, account) and a bottom bar of five: Now, Climate,
  Water, Alerts and More. More opens a sheet with every section by group, the theme switch and sign-out. The
  section a person is in is always marked, in the bar when it is one of the four and in the More button otherwise.
- Stop all water is always one touch away for an operator: in the top bar above 860 px, pinned above the bottom
  bar on Now and in Water's sticky tab row at 860 px and below.
- **Search** (`/` or `Ctrl/⌘ K`): one dialog that finds a page, a setting (by its label or its name), a relay, a
  water line or a glossary term and goes there.

## 4. Releases

| Release | What ships | How it reaches production |
|---|---|---|
| A | The read model ([api.md](api.md) sections 3 to 6) and migration 320 | Merge, build, promotion of the `verdify-api` and `verdify-migrate` pins, one gated full sync of `verdify-prod-dark` |
| B | The v2 web; the live sweep moves to the new reads | Merge, build, the pin PR rolls `verdify-dashboard` |
| C | The API stops serving the plan-era routes and fields ([api.md](api.md) section 7) | Merge, build, promotion, one gated full sync |

Release B needs release A live. Release C needs release B live, so no served page reads a retired route.

## 5. Done means

- Every row of [parity.md](parity.md) is shown, or carries the reason it is not.
- No retired word of [words.md](words.md) appears in a rendered page, a tooltip or an accessible name.
- Every screen of [screens.md](screens.md) renders at 390, 820 and 1440 px in both themes with no horizontal
  scroll, no contrast failure and no console or CSP error, against the fixture API and against production.
- Each number on Record, Controller and Data equals the same number on the estate Prometheus dashboard for the
  same moment, because both read one definition.
- `scripts/dashboard-smoke.sh --expected-web-sha <commit>` and its `--sweep` pass against the live site.
