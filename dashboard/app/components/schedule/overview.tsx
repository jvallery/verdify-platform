// SPDX-License-Identifier: MIT
import { Link } from "react-router";
import type { ScheduleAgenda } from "../../lib/operator-api";
import { localDate, shortTime } from "../../lib/format";
import type { LineInfo } from "./model";

/** A saved rule is not a run. Count enabled rules separately from occurrences and never call a backup window
 * routine watering. The next start is only a plan; controller confirmation and line interlocks still apply. */
export function scheduleOverview(agenda: {
  schedules: readonly Pick<ScheduleAgenda["schedules"][number], "slot_id" | "enabled" | "degraded_only">[];
  occurrences: readonly Pick<ScheduleAgenda["occurrences"][number], "slot_id" | "line_id" | "status" | "planned_start">[];
}, day: string, now: number) {
  const enabled = agenda.schedules.filter((rule) => rule.enabled);
  const bySlot = new Map(enabled.map((rule) => [rule.slot_id, rule]));
  const occurrences = agenda.occurrences.filter((run) => localDate(run.planned_start) === day);
  const next = occurrences.filter((run) => run.status === "planned" && Date.parse(run.planned_start) >= now
    && bySlot.has(run.slot_id) && !bySlot.get(run.slot_id)!.degraded_only)
    .sort((a, b) => Date.parse(a.planned_start) - Date.parse(b.planned_start))[0] ?? null;
  return {
    routine: enabled.filter((rule) => !rule.degraded_only).length,
    backup: enabled.filter((rule) => rule.degraded_only).length,
    disabled: agenda.schedules.length - enabled.length,
    next,
  };
}

export function ScheduleOverview({ agenda, day, now, info }: { agenda: ScheduleAgenda; day: string; now: number; info: LineInfo }) {
  const summary = scheduleOverview(agenda, day, now);
  return <section className="schedule-summary" aria-label="Watering plan at a glance">
    <div><h2>Watering program</h2><p className="meta">Recurring rules define when watering may start. Safety checks still decide whether a run proceeds.</p></div>
    <dl><div><dt>Routine rules</dt><dd>{summary.routine} enabled</dd></div><div><dt>Sensor-fault backup</dt><dd>{summary.backup} windows</dd></div><div><dt>Switched off</dt><dd>{summary.disabled} rules</dd></div></dl>
    <p><strong>Next routine start: </strong>{summary.next ? <>{shortTime(summary.next.planned_start)} · {info.nameOf(summary.next.line_id)}</> : "None remaining on the selected day"}. <a href="#sch-rules-title">Review saved rules ↓</a></p>
    <Link to="/water">Live water status →</Link>
  </section>;
}
