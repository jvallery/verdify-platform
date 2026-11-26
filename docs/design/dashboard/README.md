# Verdify dashboard and irrigation program: design v2

This package designs dashboard.verdify.ai, the private operator app for the Verdify greenhouse, and the irrigation
program that gets every connected clean and fertilizer line watering on schedule. It answers Jason's four asks (graphs
in the weather.vallery.net look on uPlot, control of every setting, what Iris plans, and setting, changing and
monitoring irrigation) behind Authentik sign-in, through to production. Under Jason's charter of 2026-11-01 (an
experimental greenhouse, forward progress first) it keeps only structural truths and cuts v1's holds, gates and
ceremonies. The result: 93 stories, 9 screens and 31 API operations, shipped as five
releases (R1 read-only dashboard, R1.1 water reads, R2 setting writes, R3 irrigation engine, R4 the Next screens).

Status: Draft v2 (2026-11-01)

**[README](README.md)** · [product](product.md) · [screens](screens.md) · [architecture](architecture.md) ·
[irrigation](irrigation.md) · [design system](design-system.md) ·
[OpenAPI](openapi/dashboard-api.v1.yaml) · [decisions](decisions.md)

## 1. What we are building and why

**Answer:** one private web app to see the greenhouse, change any setting, see Iris's plan and run the water, plus an
irrigation program that moves watering off a Home Assistant button onto schedules the controller runs by itself.

| Jason's ask (2026-11-01) | What v2 delivers | Where |
|---|---|---|
| Graphing, in the weather.vallery.net style | Graphs: one chart stack with the band ribbon, excursions and setting steps, events and equipment lanes, any range, CSV; zones side by side; statistics; uPlot 1.6.32 on weather's tokens | SCR-02, [design system](design-system.md) |
| Control all settings | Settings: every registry row with min, max, step, device readback and age; edit, Manual, Release | SCR-05, [architecture](architecture.md) §5 |
| Know what is planned | Plan: the plan in force, 24/72 h waypoints, the MANUAL rows Iris skips, planner health | SCR-03 |
| Set, change and monitor irrigation | Water: schedules in a 7-day week view, run now, stop, pause, line enables, mister VPD and Schedule switches, minutes by zone; the same through MCP | SCR-04, [irrigation](irrigation.md) |
| Authentik sign-in, production at dashboard.verdify.ai | Native OIDC in the BFF with a second factor at sign-in (member tier; a caretaker enrols one at first sign-in), operator and viewer roles, its own namespace and Argo app | [architecture](architecture.md) §4, §10 |

**Why irrigation is a program.** No schedule exists: the wall drip (L01) has not run since 2026-05-29 (nobody presses
its Home Assistant button), only the center mister (L04) serves VPD, south and west sit idle, no fertilizer feed was
ever commissioned, and no minutes-by-zone figure exists. v2 compiles schedules into one record that the ingestor pushes
and the ESP32 keeps in NVS, so watering continues when WiFi, the ingestor or the DB is down.

**Shape.** Browser → Cloudflare → traefik-apps → `verdify-dashboard-web` (Express BFF + React Router 8 SSR, namespace
`verdify-dashboard`) → `verdify-operator-api` (`verdify-api` image, internal :8090) → `verdify-db`. People and agents
write through `verdify_services`; the ingestor's dispatcher stays the only device writer and re-applies after reboots.

## 2. Simplification charter

> "Overall, the design is far too complicated with far too many holds, safety gates, etc. We need to massively
> simplify. We can take risk. This environment is our experimental greenhouse. Priority is on forward progress, not
> on a bunch of constraints which slow us down." (Jason, 2026-11-01)

**Answer:** the charter overrides every v1 doc; when in doubt, cut. v1 → v2: 199 → 93 stories, 18 → 9 screens,
13 → 7 lanes, 7 → 4 waves, 44 files and about 28,500 lines → 10 files and about 6,200.

- **Forward progress over constraints.** A mistake costs a few plants and a fix-forward, not a safety incident.
- **Keep the structural truths.** One device writer (the ingestor), Authentik sign-in, attribution of every write in
  `activity_log`, and readback: REQUESTED → CONFIRMED from `cfg_*`, `irr_program_id` or `irr_state`.
- **Keep existing firmware protections, add none:** SAF-4 (360 gal/day), relay watchdogs (D-IRP-19 fix), leak detection
  (an alert only, Round 2 #3).
- **One control rule.** Last write wins; a `manual` flag makes Iris skip a setting or irrigation item; values are
  validated on submit (registry min/max, grid snap). Cut: precedence lattice, expiring holds, step-up, typed
  confirmations, mandatory dry runs, risk tiers, per-domain kill switches.
- **Two roles, one switch.** Operator and viewer, from the Authentik groups `verdify-dashboard-operators` and
  `verdify-dashboard-viewers`. `DASHBOARD_WRITES_ENABLED` is the rollback flag; Stop is never blocked.
- **Every agent writes.** Iris and every MCP agent read and write within registry bounds, attributed as `iris` or
  `agent:<name>`. Cut: envelopes, shadow and propose stages, approval inboxes, agent caps.
- **Irrigation without paperwork.** A line goes live after a one-time physical check, recorded as a note. Cut: bench
  tests, calibration gates, observe periods, review dates, OTA cadence rules, RTC and STOP hardware, caretaker limits.
- **Smaller scope, honest UI.** Home Assistant shrinks to occupancy and Lutron, plus the hydro read until VD-70. Later:
  experiments UI, research depth, replay sandbox, Iris memory governance, SSE, dark theme, command palette, read
  replica, multi-greenhouse, Slack changes. Kept: readback beside the requested value, freshness on every number, gaps
  left as gaps.

## 3. Decisions log

**Answer:** [decisions](decisions.md) is the record, and this page restates none of it. It holds Jason's direction and
his first calls (scope, host, irrigation priority, mister model, tracking in repo markdown); his answers to the 27
irrigation decisions D-IRP-01 to D-IRP-27 (16 accepted, 11 changed); the Round 2 and Round 2b answers, which override
them; and the applied defaults for Q-01 to Q-14. [Irrigation](irrigation.md) §1 states each D-IRP rule as v2 applies it.

## 4. How to read the package

**Answer:** read this page, then the doc for your part. [Decisions](decisions.md) wins, newest round first (the
applied defaults Q-01 to Q-14, then Round 2b, Round 2 and the D-IRP table); then the charter (§2); then the docs, where
the OpenAPI file wins on operation ids and paths.

| Doc | What it holds | Read it to |
|---|---|---|
| [product](product.md) | 4 personas, 35 needs, 9 journeys, 93 stories with 2–3 acceptance criteria each, coverage matrix | Build or accept a feature |
| [screens](screens.md) | IA and navigation (five sections), shell, roles, write feedback, panel states; SCR-01 to SCR-09 as built, with acceptance; the issues that build each screen | Build a screen |
| [redesign](redesign.md) | The UI/UX redesign (built 2026-11-04): five sections, the layout system, cards and micro-visualizations, the chart stack, statistics and the schedule interface, with the wireframes; D-UX-01 to D-UX-13 | See why the screens look as they do |
| [architecture](architecture.md) | Topology, web tier, sign-in, control model (`desired_state`, `manual`, readback), `verdify_services`, read model, API surface, migrations, delivery, tests | Build or ship the backend |
| [irrigation](irrigation.md) | D-IRP rules, current state, lines L01–L11, schedule model, firmware and platform changes, the L01 bridge, HA decommission, API-IRR and MCP tools, delivery | Touch water |
| [band](band.md) | What the climate band is, how the four sun anchors make its curve, what each edge does, the guardrails and who may change what; the Control → Band editor, API-23 and API-24 (#1334) | Change the band |
| [design system](design-system.md) | weather.vallery.net tokens, the Verdify lockup, the page and card grammar, badges, controls, edit drawer, micro-visualizations, the uPlot charts, responsive and accessibility rules; built by VD-01 and VD-03 to VD-08 and the redesign (§9) | Build components or charts |
| [OpenAPI](openapi/dashboard-api.v1.yaml) | The contract: 38 operationIds (API-08, API-18, API-IRR-09 and OPS-03 reserved), schemas and problem codes | Call or serve the API |
| [decisions](decisions.md) | Direction, all 27 D-IRP answers, the Round 2 and 2b answers, Q-01 to Q-14 with their applied defaults | Get or record a ruling |
| [ADR-0011](../../adr/0011-irrigation-scheduling-program.md), [ADR-0012](../../adr/0012-operator-dashboard-architecture.md) | The irrigation program (accepted; amends ADR-0007) and the dashboard architecture (accepted, Round 2 #11) | Cite the decision |

## 5. Screens

**Answer:** nine flat screens, one tap from the nav (phones: a bottom bar with Now, Water, Graphs, Activity, More).
Viewers see every screen read-only; every write shows REQUESTED → CONFIRMED (or NOT CONFIRMED) and lands in Activity.

| Id | Screen | Route | Answers | Build | Main operations | Issues |
|---|---|---|---|---|---|---|
| SCR-01 | Now | `/` | Is the greenhouse OK, what is running, is water fine? | MVP | API-02, API-IRR-01, API-14 | VD-09, VD-16, VD-18 |
| SCR-02 | Graphs | `/graphs`, `/graphs/scorecard` | What happened and what is planned, over any range? How is each day going? | MVP | API-03 to API-06, API-12, API-IRR-10 | VD-10, VD-18 |
| SCR-03 | Plan | `/plan` | What will Iris tell the controller, and is Iris healthy? Now a redirect to Review: release C retired API-07 | MVP | none | VD-11 |
| SCR-04 | Water | `/water`, `/water/schedules`, `/water/history` | What waters, when, why not, and how many minutes per zone? | MVP | API-IRR-01 to API-IRR-08, API-IRR-10, API-IRR-11, API-IRR-13 | VD-15, VD-16, VD-17, VD-69, VD-20 |
| SCR-05 | Settings | `/settings` | What is every setting and what does the device report? Change it | MVP | API-09 to API-12 | VD-12, VD-19 |
| SCR-06 | Activity and alerts | `/activity` | What needs someone, and who changed what? | MVP | API-14 to API-17 | VD-13 |
| SCR-07 | Equipment and controller | `/equipment` | What is each actuator doing? Fan, humidify and vent bursts | MVP | API-13, API-05, API-IRR-12 | VD-14, VD-16, VD-20 |
| SCR-08 | Plants | `/plants` | What grows where? | Later | none | none yet |
| SCR-09 | Sign-in and errors | `/auth/login`, `/auth/callback`, error pages | Who are you, and what went wrong? | MVP | BFF-01 to BFF-03, API-01 | VD-04, VD-21 |

## 6. Key numbers

| What | Count |
|---|---|
| Personas, needs, journeys | 4 (owner-operator, caretaker, AI agents, platform maintainer), 35, 9 |
| User stories | 93 in 11 areas: 75 MVP, 9 Next, 9 Later |
| Screens | 9: 8 MVP, Plants Later |
| API operations | 31 on `/v1` (19 core: API-01 to API-07, API-09 to API-17 and API-19 to API-21; 12 irrigation: API-IRR-01 to API-IRR-08 and API-IRR-10 to API-IRR-13), plus 7 BFF, session and health routes: 38 operationIds; API-08, API-18, API-IRR-09 and OPS-03 are reserved. Release C retired API-07 and the later API-25 ([v2 API spec](v2/api.md) section 7) |
| MCP tools for every agent | 8 irrigation tools (3 read, 5 write), plus `set_setting`, `settings` and `activity`; Iris's `set_plan` and `set_tunable` keep writing plans |
| Migrations and images | 7 additive migrations (M1 `desired_state` and `activity_log`, M2 dashboard login and sessions, M2b the dashboard login's reads and writes, M3 irrigation tables, M4 minutes by zone, M5 lighting release, M6 daily scorecard), and later the light meter's; 1 new image, `verdify-dashboard-web` |
| Irrigation | 11 lines (L01–L11): 9 schedulable (L05 and L06 reserved, no bring-up now), L03 opens with feeds, L11 fog stays climate only; 4 wet zones; at most 24 schedules on the controller |

## 7. Status

**Answer:** Draft v2, written to the charter with Jason's Round 2 and 2b answers applied. All 27 irrigation decisions
are answered; ADR-0011 and ADR-0012 are accepted; the open decisions carry applied defaults
([decisions](decisions.md) Q-01 to Q-14), which Jason may change. The work was tracked under the program epic [#1120](https://github.com/jvallery/verdify-platform/issues/1120); the planning documents (execution plan, sprint plan and audit) are in Git history.
