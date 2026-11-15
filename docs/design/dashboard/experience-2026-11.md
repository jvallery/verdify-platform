# Greenhouse dashboard experience, November 2026

Jason requested a full visual and interaction redesign, including a dedicated hydroponic system view with trends and editable planting records for all 60 spots. The product is the existing greenhouse dashboard at `dashboard.verdify.ai`. This work preserves its control authority, authentication, freshness semantics and device-write paths.

Implementation and verification are in progress in PR #1602. This document records the design and acceptance scope; it is not a deployment receipt.

## Design direction

A greenhouse workspace should answer three questions: what needs attention, how the system is behaving, and where to change it. Quiet surfaces and consistent headings carry routine information. Existing warning and fault treatments continue to carry abnormal state. More visual decoration must never imply a healthy sensor, confirmed write or achievable target.

The persistent desktop navigation rail gives each growing task a stable location. On tablets, navigation has its own header row. On phones, eight labelled destinations occupy two rows with usable targets, rather than squeezing long labels into eight narrow columns or hiding destinations behind an overflow menu. The navigation, page title and section tabs share one route model.

Cards sit on a subtle field background. Page descriptions explain the task in ordinary language. Shared spacing, rounded surfaces, restrained borders and the existing Verdify colours connect the overview, watering, planting, charts, activity, configuration and planner views. The status hero and safety signals retain their meanings.

## Hydroponics

`/hydroponics` is the dedicated reservoir and planting workspace. It combines the platform's measured pH, electrical conductivity, water temperature, TDS and ORP series with the API-defined hydro rack. The user can select a spot, a range or a whole rail, then plant, edit, move, harvest or remove records using the existing audited forms. Viewers can inspect records without write controls.

Each hydro rail occupies its own row, with at least 44-pixel planting targets and contained horizontal scrolling on phones. The interface uses the persisted shelf and cell layout. It never invents physical positions or treats an absent layout as an empty 60-spot system. The current layout contains 60 hydro spots. Occupancy is derived from records; three plantings occupying nineteen spots are three plantings, not nineteen.

The general Crops map excludes hydro shelves. Place-text selection must explain references to the other workspace rather than silently selecting only part of the request. A persistent selection shortcut returns users to their actions after scrolling through the map. Planting history remains shared so that a planting moved between systems retains its full record.

Reservoir trends offer 24-hour, 7-day and 30-day windows. They use registered metric units and the same synchronized chart, table and export components as the rest of the dashboard. Null samples remain gaps. Missing metrics, failed reads and stale records are distinct from valid zero values. Hydroponics is hand-dosed: the page does not invent automatic dosing, nutrient targets or pH setpoints.

On phones, the Now emergency Stop stays fixed above navigation while scrolling. Water keeps its live status and Stop ahead of explanatory copy. The Now overview keeps long AI narratives in an expandable preview at every screen size. Measured conditions and quick controls stay prominent; the model author, timestamp and full text remain accessible.

## Configuration

Settings opens with task shortcuts for climate bands, light windows, irrigation schedules and soil moisture targets. Each links to an existing editor or filtered catalog rather than introducing another setting writer. The full catalog, explanatory text, filters, history and readback states remain available. This avoids making low-level controller tuning the only entry point into everyday configuration.

## Acceptance coverage

| Area | Required evidence |
|---|---|
| Navigation and shared presentation | Review all eight main sections at desktop and phone sizes; tablet geometry; no page overflow; current destination and account menu work |
| Now and emergency controls | Fault and stale states remain truthful; Stop remains reachable and retains its existing write semantics |
| Water and schedules | Existing run, pause, history and schedule journeys pass; labels, limits and timeline remain readable |
| Hydro reservoir | Five charts draw real fixture series; range sends the correct keys and bounds; missing and failed samples remain explicit; live registry and reads succeed |
| Hydro planting | All 60 saved positions render; create/edit/move/harvest/remove and conflict handling use existing API; viewer is read-only; cross-workspace place selection is explicit |
| Soil planting | Hydro spots are absent; other shelves and records remain; counts match the scoped records |
| Graphs and activity | Shared chart tools, exports, filters, acknowledgement and historical links remain usable |
| Settings and planner | Task shortcuts reach the correct controls; catalog, drawers, plans and study views remain usable; no additional writer |
| Accessibility | Keyboard focus, headings, labels, touch targets and axe checks; reduced motion; readable layouts at phone/tablet/desktop widths |
| Delivery | Required native CI, reviewed screenshots, source merge, digest pin, Argo Synced/Healthy, expected running build, smoke and live UI verification |

Automated fixture screenshots are captured by `dashboard/e2e/00-experience-visual.spec.ts` into `artifacts/experience` inside the cluster CI workspace. They are evidence for visual review, not a substitute for it. Production verification must distinguish a merged source change, a built image, a delivered image and a working live page.

## Research basis

- [Priva Operator dashboards](https://www.priva.com/horticulture/connext-operator-dashboard-features): organize monitoring around greenhouse systems and keep readings and settings close to the task.
- [Priva strategy visualization](https://help.priva.com/en/articles/458186-visualize-climate-and-irrigation-strategies-in-a-chart): show strategy alongside its measured effect.
- [Home Assistant sections](https://www.home-assistant.io/dashboards/sections/): group related controls into coherent responsive sections.

These inform grouping and hierarchy. The implementation uses Verdify's own components, domain model and physical constraints.
