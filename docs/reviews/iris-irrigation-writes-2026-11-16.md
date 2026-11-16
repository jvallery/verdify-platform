# How often Iris writes irrigation, by trigger (2026-11-16)

Package 1.4 of the climate refactor (epic #1633), plan section 7. Report only: no production change. Read only on
production on 2026-11-16.

## Sources

- `activity_log` (migration 280): one row per write by a person or agent, with `source`, `actor` and `action`.
  It begins 2026-11-03 05:47 UTC; 194 rows to 2026-11-16 16:17 UTC.
- `irrigation_command` and `irrigation_slot` (migration 283): run, stop, clear-fault and override requests, and the
  schedule slots, each with `source` and `actor`.
- Iris's plan writes are `activity_log` rows with action `plan.write`; their `detail` carries the `changes` and the
  `trigger_id` (`mcp/server.py`, `_append_plan_activity`), joined here to `planner_trigger_ledger.event_type`.

## Irrigation writes: none from Iris

Every irrigation row in `activity_log` since it began (2026-11-03 to 11-16):

| Source | Actor | Writes | Actions |
|---|---|---|---|
| dashboard | jason | 5 | override 4, schedule.create 1 |
| dashboard | agent and lane test actors | 11 | run 5, stop 4, override 2 |
| agent:orbit | orbit | 6 | schedule.update 3, run 1, stop 1, clear_fault 1 |
| system | flash-2026-11-03 | 2 | line.update 2 |
| iris | iris | 0 | |

24 irrigation writes, none from Iris, as the plan states. `irrigation_command` (12 rows, 2026-11-04 to 11-15) and
`irrigation_slot` (4 rows) agree: sources `dashboard` and `agent:orbit` only.

Before the activity log, the wall and center line settings in `setpoint_changes` since 2026-08-01 come from
`esp32` (device readback) and `band` only; no `plan` or `iris` row touches an `irrig_*`, `wall_*` or
`direct_wet_wall_*` parameter.

## What Iris does write, by trigger

Iris wrote 75 plans in the 13 days (all 30-day plan writes fall inside the log). Plans touching water parameters
are the misting and fog settings (`mister_*`, `fog_*`, `min_fog_*`, `sw_*_closes_vent`, `mister_water_budget_gal`),
not irrigation:

| Trigger | Triggers due | Plans written | Plans setting misting and fog |
|---|---|---|---|
| FORECAST_DEVIATION | 18 | 18 | 18 |
| MIDNIGHT | 14 | 13 | 13 |
| SUNRISE | 14 | 13 | 13 |
| SUNSET | 13 | 12 | 12 |
| SOLAR_MAX | 13 | 11 | 0 |
| TRANSITION | 26 | 6 | 0 |
| WEEKLY | 2 | 2 | 2 |
| All | 100 | 75 | 58 |

Each of the 58 rewrites the same 12 misting and fog parameters (297 to 304 waypoint values each in 30 days),
which is the "planner rewrites its settings every waypoint" behaviour of the review.

Uncertainty: the log covers 13 days only, and "triggers due" counts ledger rows due in the window, some of which
a later trigger superseded. The counts are exact for the window; they say nothing about the months before it.

## Queries

```sql
SELECT source, actor, action, count(*)
  FROM activity_log
 WHERE ts > now() - interval '120 days' AND action LIKE 'irrigation.%'
 GROUP BY 1, 2, 3 ORDER BY 4 DESC;

SELECT l.event_type, count(*) AS plan_writes,
       count(*) FILTER (WHERE a.detail::text ~* 'mister|fog') AS setting_misting
  FROM activity_log a
  LEFT JOIN planner_trigger_ledger l ON l.trigger_id::text = a.detail->>'trigger_id'
 WHERE a.action = 'plan.write' AND a.ts > now() - interval '30 days'
 GROUP BY 1 ORDER BY 2 DESC;

SELECT c->>'param' AS param, count(*)
  FROM activity_log a CROSS JOIN LATERAL jsonb_array_elements(a.detail->'changes') c
 WHERE a.action = 'plan.write' AND a.ts > now() - interval '30 days'
   AND c->>'param' ~* 'irrig|drip|water|fert|mister|fog'
 GROUP BY 1 ORDER BY 2 DESC;

SELECT source, parameter, count(*)
  FROM setpoint_changes
 WHERE ts > TIMESTAMPTZ '2026-08-01' AND parameter ~* 'irrig|drip|fert|wall_|center_line|soil'
 GROUP BY 1, 2 ORDER BY 3 DESC;
```
