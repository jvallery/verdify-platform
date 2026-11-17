# ADR-0013: The climate law replaces the mode machine

- Status: accepted
- Date: 2026-11-17
- Issues: epic #1633 (climate refactor), #1672 (control documents)
- Supersedes: where they describe how climate is decided, ADR-0004 (floating corridor), ADR-0006 (bounded active
  planner) and ADR-0009 (solar-night dry-out); in full, ADR-0010 (confirmed-component experiment fast path, retired)

## Context

Until November 2026 the controller ran a mode and state machine: a mode chosen each pass from the band and from
planner-pushed tunables, with special paths for night dry-out, sealed misting, thermal relief, an economiser,
humidity and temperature gates on fog, and time-of-day branches. The planner wrote climate settings several times a
day through a dispatcher that expanded each waypoint into dozens of values, and a host guardrail rewrote some of
them. The control effectiveness review of 2026-11-15
([`../reviews/greenhouse-control-effectiveness-review-2026-11-15.md`](../reviews/greenhouse-control-effectiveness-review-2026-11-15.md))
measured what that produced. The house was inside both served bands 47.4% of graded time; humidity was the miss,
and wet nights were a limit of the rules, not of the hardware. The planner's settings explained little of the
result. Its output failed to reach the controller on 44 of 94 days, and the controller then ran on boot
defaults. A wrong controller clock and a heater that gave no heat went undetected. Much of the deployed code
never ran, and the setting traffic starved the controller's memory (#430). The controller also could not run alone: it
rebooted every five minutes without WiFi and trusted a wrong clock.

## Decision

- **One band-edge law on the controller.** Every second the controller computes the four band edges
  (temperature low and high, VPD low and high) from anchors stored in its flash and its clock, and drives the six
  climate relays and the climate mister pulses with one law that is the same at every hour and in every season.
  Every action starts at a band edge or a fixed offset from one. Its constants are compiled and generated from
  one source. There is no mode, no time-of-day branch and no planner-pushed tuning.
- **The bands are the owner's.** The band anchors and the drying cost limit are written only by a signed-in
  dashboard operator. The host pushes them, confirms each against its readback and pushes nothing else that
  steers climate.
- **The planner reviews and does not steer.** Iris writes one daily review of the record and may propose band
  edits. It writes no climate value. Among settings, agents write only the operator switches; Iris keeps its
  irrigation tools.
- **The controller runs alone through network loss.** It needs no host input to hold the house. It keeps relay
  counters and a gap log of climate records and relay transitions in flash, replays them to the ingestor when it
  reconnects, and publishes its own health readings.
- **Three timed manual actions** (fans, fog and vent bypass) are the only direct relay overrides, and each ends by
  itself.

## Consequences

- Far fewer relay cycles and settings. In simulation the law makes about two thirds fewer relay starts at the same
  band and holds both temperature and VPD inside the band most of the year. Run time and utility use are set by
  where the owner puts the band edges and the drying price, not by the law.
- Deleted across the layers: the controller's mode logic and nearly all of its climate settings and readbacks;
  the planner's writable climate settings, plan delivery, the moisture guardrail, the forecast-action engine and
  the experiment and digital-twin code on the host; their database tables, views, functions and roles (archived
  before the drop, restore in [`../runbooks/phase4-drop-316-restore.md`](../runbooks/phase4-drop-316-restore.md)).
  Objects that the public lab site still reads are held back until its own sprint.
- The contract lives in one control document, [`../CONTROL-ARCHITECTURE.md`](../CONTROL-ARCHITECTURE.md). Its two
  named parts are [`../firmware-control-contract.md`](../firmware-control-contract.md) (who may write what) and
  [`../firmware-fsm-spec.md`](../firmware-fsm-spec.md) (the state machine and invariants). The design record is
  [`../design/climate-refactor-plan-2026-11-15.md`](../design/climate-refactor-plan-2026-11-15.md).
- A change to how climate is decided is a firmware change to the law and its constants, tested on the host and in
  the closed-loop simulation and delivered by the signed flash path; it is never a host-side tuning change.
- The cost: the controller now carries the whole climate decision, so a defect in the law needs a flash to fix,
  and the rollback target is the previous build of the law.
