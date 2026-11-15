// SPDX-License-Identifier: MIT
import { Link } from "react-router";
import type { ScheduleAgenda } from "../../lib/operator-api";
import { localDate, shortTime } from "../../lib/format";
import type { LineInfo } from "./model";

/** A saved rule is not a run. Count enabled rules separately from occurrences and never call a backup window
 * routine watering. The next start is only a plan; controller confirmation and line interlocks still apply. */
export function scheduleOverview(agenda: Pick<ScheduleAgenda, "schedules" | "occurrences">, day: string, now: number) {
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
  return <section className="schedule-overview" aria-label="Watering plan at a glance">
    <a href="#sch-rules-title" className="schedule-overview-card">
      <span className="eyebrow">ROUTINE WATERING</span>
      <strong>{summary.routine} enabled {summary.routine === 1 ? "rule" : "rules"}</strong>
      <span>Recurring watering you have scheduled.{summary.disabled > 0 && ` ${summary.disabled} other ${summary.disabled === 1 ? "rule is" : "rules are"} switched off.`}</span>
      <span className="schedule-overview-action">Review saved rules ↓</span>
    </a>
    <a href="#sch-rules-title" className="schedule-overview-card schedule-overview-backup">
      <span className="eyebrow">SENSOR-FAULT BACKUP</span>
      <strong>{summary.backup} enabled {summary.backup === 1 ? "window" : "windows"}</strong>
      <span>Conditional misting when VPD sensing fails. These are not extra daily watering runs.</span>
      <span className="schedule-overview-action">Review backup windows ↓</span>
    </a>
    <div className="schedule-overview-card">
      <span className="eyebrow">NEXT ROUTINE START · SELECTED DAY</span>
      <strong>{summary.next ? shortTime(summary.next.planned_start) : "No upcoming start"}</strong>
      <span>{summary.next ? `${info.nameOf(summary.next.line_id)} · planned, subject to controller and line checks.` : "No future routine occurrence is planned on this day. Sensor-driven misting operates separately."}</span>
      <Link className="schedule-overview-action" to="/water">Check live water status →</Link>
    </div>
  </section>;
}
