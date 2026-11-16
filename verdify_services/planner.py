"""The Planner section's read (#1361): plan history and cost (API-25).

Each read is ``async``, takes an asyncpg connection, runs in one read-only snapshot and returns a Pydantic model
shaped like its committed OpenAPI schema (docs/design/dashboard/openapi/dashboard-api.v1.yaml).

History reads ``plan_journal`` and ``planner_trigger_ledger`` (the dashboard duty's 284 grants). Cost comes from
migration 302's ``v_planner_inference_runs``; the read checks the view is there and readable first, so before 302 it
answers with cost "not recorded" instead of failing. The Cortex attempt columns (#1350, migration 294: status,
latency_ms, mode, dispatched) are read from the view's ``attempt`` jsonb only when ``planner_inference_runs`` has them,
which ``pg_attribute`` says without any table privilege.

Climate refactor 4.2 retired the planner's write role: no plan rows are written after it, so the history shows the
record up to that release. The study reads API-26 and API-27, the study control API-28 and the study runner went with
it (``verdify_services.planner_study`` and ``verdify_schemas.planner_study`` are deleted).
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

import asyncpg
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from verdify_services.reads import _int_from_query, _snapshot

DENVER = ZoneInfo("America/Denver")
REQUIRED_TRIGGERS = ("MIDNIGHT", "SUNRISE", "SUNSET")
WRITTEN = ("plan_written", "action_completed")
FAILED = ("missed", "timed_out", "delivery_failed", "wrong_action", "neutral_fallback")
PLAN_LIST_LIMIT = 60

HistoryDays = Annotated[Literal[30, 90], BeforeValidator(_int_from_query)]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ── API-25 ──────────────────────────────────────────────────────────────────


class DayCost(_Model):
    calls: int
    models: list[str]
    input_tokens: int | None
    output_tokens: int | None
    energy_wh: float | None
    latency_ms_median: int | None
    dispatched: int | None
    proposed_only: int | None


class PlannerDay(_Model):
    date: date
    plans_written: int
    triggers: dict[str, int]
    params_dispatched: int
    changes_dispatched: int
    changes_confirmed: int
    required_due: int
    required_written: int
    required_failed: int
    required_late: int
    cost: DayCost | None


class PlanCost(_Model):
    model_id: str | None
    input_tokens: int | None
    output_tokens: int | None
    energy_wh: float | None
    latency_ms: int | None
    status: str | None


class PlanSummary(_Model):
    plan_id: str
    trigger: str
    written_at: datetime
    hypothesis: str | None
    outcome_score: float | None
    params_dispatched: int
    cost: PlanCost | None


class PlannerHistory(_Model):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: date = Field(alias="from")
    to: date
    cost_recorded_from: datetime | None
    cortex_attempts: bool
    days: list[PlannerDay]
    plans: list[PlanSummary]


def _json(value: object) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    return value if isinstance(value, dict) else {}


def _int(value: object) -> int | None:
    return None if value is None else int(value)


def _float(value: object) -> float | None:
    return None if value is None else float(value)


# ── SQL ─────────────────────────────────────────────────────────────────────

_CAPABILITY_SQL = """
SELECT CASE WHEN to_regclass('public.v_planner_inference_runs') IS NULL THEN false
            ELSE has_table_privilege(to_regclass('public.v_planner_inference_runs'), 'SELECT') END AS runs,
       EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid = to_regclass('public.planner_inference_runs')
                  AND attname = 'latency_ms' AND NOT attisdropped) AS attempts,
       now() AS at
"""

_PLAN_TRIGGER = """
LEFT JOIN LATERAL (SELECT l.event_type FROM planner_trigger_ledger AS l
                    WHERE l.trigger_id = pj.trigger_id
                    ORDER BY l.expected_at DESC LIMIT 1) AS t ON true
"""

_HISTORY_DAYS_SQL = f"""
WITH p AS (
    SELECT (pj.created_at AT TIME ZONE 'America/Denver')::date AS date,
           coalesce(t.event_type, 'UNKNOWN') AS trigger
      FROM plan_journal AS pj {_PLAN_TRIGGER}
     WHERE pj.created_at >= $1::date::timestamp AT TIME ZONE 'America/Denver'
       AND pj.created_at < ($2::date + 1)::timestamp AT TIME ZONE 'America/Denver'
), s AS (
    SELECT (ts AT TIME ZONE 'America/Denver')::date AS date, parameter, confirmed_at
      FROM setpoint_changes
     WHERE source = 'plan'
       AND ts >= $1::date::timestamp AT TIME ZONE 'America/Denver'
       AND ts < ($2::date + 1)::timestamp AT TIME ZONE 'America/Denver'
), l AS (
    SELECT (expected_at AT TIME ZONE 'America/Denver')::date AS date, status, due_at, resolved_at
      FROM planner_trigger_ledger
     WHERE expected_at >= $1::date::timestamp AT TIME ZONE 'America/Denver'
       AND expected_at < ($2::date + 1)::timestamp AT TIME ZONE 'America/Denver'
       AND expected_at <= now() AND event_type = ANY($3::text[])
)
SELECT d.date,
       (SELECT count(*) FROM p WHERE p.date = d.date)::int AS plans_written,
       (SELECT jsonb_object_agg(x.trigger, x.n)
          FROM (SELECT trigger, count(*) AS n FROM p WHERE p.date = d.date GROUP BY 1) AS x) AS triggers,
       (SELECT count(DISTINCT s.parameter) FROM s WHERE s.date = d.date)::int AS params_dispatched,
       (SELECT count(*) FROM s WHERE s.date = d.date)::int AS changes_dispatched,
       (SELECT count(s.confirmed_at) FROM s WHERE s.date = d.date)::int AS changes_confirmed,
       (SELECT count(*) FROM l WHERE l.date = d.date)::int AS required_due,
       (SELECT count(*) FROM l WHERE l.date = d.date AND l.status = ANY($4::text[]))::int AS required_written,
       (SELECT count(*) FROM l WHERE l.date = d.date AND l.status = ANY($5::text[]))::int AS required_failed,
       (SELECT count(*) FROM l WHERE l.date = d.date AND l.status = ANY($4::text[])
           AND l.resolved_at > l.due_at)::int AS required_late
  FROM generate_series($1::date, $2::date, interval '1 day') AS g(day)
 CROSS JOIN LATERAL (SELECT g.day::date AS date) AS d
 ORDER BY d.date
"""

_HISTORY_COST_SQL = """
SELECT (r.started_at AT TIME ZONE 'America/Denver')::date AS date,
       count(*)::int AS calls,
       array_remove(array_agg(DISTINCT r.model_id), NULL) AS models,
       sum(r.input_tokens)::bigint AS input_tokens,
       sum(r.output_tokens)::bigint AS output_tokens,
       sum(r.energy_wh)::float8 AS energy_wh,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY coalesce((r.attempt ->> 'latency_ms')::int,
           (extract(epoch FROM r.ended_at - r.started_at) * 1000)::int)) AS latency_ms_median,
       count(*) FILTER (WHERE (r.attempt ->> 'dispatched')::boolean)::int AS dispatched,
       count(*) FILTER (WHERE NOT (r.attempt ->> 'dispatched')::boolean)::int AS proposed_only
  FROM v_planner_inference_runs AS r
 WHERE r.started_at >= $1::date::timestamp AT TIME ZONE 'America/Denver'
   AND r.started_at < ($2::date + 1)::timestamp AT TIME ZONE 'America/Denver'
 GROUP BY 1
"""

_COST_FROM_SQL = "SELECT min(started_at) FROM v_planner_inference_runs"

_PLANS_SQL = f"""
SELECT pj.plan_id, pj.created_at, pj.hypothesis, pj.outcome_score, pj.trigger_id,
       coalesce(t.event_type, 'UNKNOWN') AS trigger,
       (SELECT count(DISTINCT c.parameter) FROM setpoint_changes AS c
         WHERE c.source = 'plan' AND c.trigger_id = pj.trigger_id
           AND c.ts >= pj.created_at - interval '1 hour' AND c.ts < pj.created_at + interval '4 days')::int
           AS params_dispatched
  FROM plan_journal AS pj {_PLAN_TRIGGER}
 WHERE pj.created_at >= $1::date::timestamp AT TIME ZONE 'America/Denver'
 ORDER BY pj.created_at DESC
 LIMIT $2
"""

_PLAN_COST_SQL = """
SELECT DISTINCT ON (r.attempt ->> 'trigger_id') r.attempt ->> 'trigger_id' AS trigger_id, r.model_id,
       r.input_tokens, r.output_tokens, r.energy_wh::float8 AS energy_wh,
       coalesce((r.attempt ->> 'latency_ms')::int, (extract(epoch FROM r.ended_at - r.started_at) * 1000)::int)
           AS latency_ms,
       r.attempt ->> 'status' AS status
  FROM v_planner_inference_runs AS r
 WHERE r.attempt ->> 'trigger_id' = ANY($1::text[])
 ORDER BY r.attempt ->> 'trigger_id', (r.attempt ->> 'status') = 'ok' DESC, r.started_at DESC
"""

# ── Reads ───────────────────────────────────────────────────────────────────


async def history(conn: asyncpg.Connection, days: int = 30) -> PlannerHistory:
    """API-25 ``GET /v1/planner/history``: the 30 or 90 local days ending today, and the newest plans."""
    if days not in (30, 90):
        raise ValueError("days must be 30 or 90")
    async with _snapshot(conn):
        cap = await conn.fetchrow(_CAPABILITY_SQL)
        last: date = cap["at"].astimezone(DENVER).date()
        first = last - timedelta(days=days - 1)
        rows = await conn.fetch(_HISTORY_DAYS_SQL, first, last, list(REQUIRED_TRIGGERS), list(WRITTEN), list(FAILED))
        plans = await conn.fetch(_PLANS_SQL, first, PLAN_LIST_LIMIT)
        costs: dict[date, Mapping[str, Any]] = {}
        plan_costs: dict[str, Mapping[str, Any]] = {}
        cost_from = None
        if cap["runs"]:
            cost_from = await conn.fetchval(_COST_FROM_SQL)
            costs = {row["date"]: row for row in await conn.fetch(_HISTORY_COST_SQL, first, last)}
            triggers = [str(row["trigger_id"]) for row in plans if row["trigger_id"] is not None]
            if triggers:
                plan_costs = {row["trigger_id"]: row for row in await conn.fetch(_PLAN_COST_SQL, triggers)}
    attempts = bool(cap["attempts"])
    return PlannerHistory(
        from_=first,
        to=last,
        cost_recorded_from=cost_from,
        cortex_attempts=attempts,
        days=[
            PlannerDay(
                date=row["date"],
                plans_written=row["plans_written"],
                triggers={key: int(value) for key, value in _json(row["triggers"]).items()},
                params_dispatched=row["params_dispatched"],
                changes_dispatched=row["changes_dispatched"],
                changes_confirmed=row["changes_confirmed"],
                required_due=row["required_due"],
                required_written=row["required_written"],
                required_failed=row["required_failed"],
                required_late=row["required_late"],
                cost=_day_cost(costs.get(row["date"]), attempts),
            )
            for row in rows
        ],
        plans=[
            PlanSummary(
                plan_id=row["plan_id"],
                trigger=row["trigger"],
                written_at=row["created_at"],
                hypothesis=row["hypothesis"],
                outcome_score=_float(row["outcome_score"]),
                params_dispatched=row["params_dispatched"],
                cost=_plan_cost(plan_costs.get(str(row["trigger_id"]))),
            )
            for row in plans
        ],
    )


def _day_cost(row: Mapping[str, Any] | None, attempts: bool) -> DayCost | None:
    if row is None:
        return None
    return DayCost(
        calls=row["calls"],
        models=list(row["models"] or []),
        input_tokens=_int(row["input_tokens"]),
        output_tokens=_int(row["output_tokens"]),
        energy_wh=_float(row["energy_wh"]),
        latency_ms_median=_int(row["latency_ms_median"]),
        dispatched=row["dispatched"] if attempts else None,
        proposed_only=row["proposed_only"] if attempts else None,
    )


def _plan_cost(row: Mapping[str, Any] | None) -> PlanCost | None:
    if row is None:
        return None
    return PlanCost(
        model_id=row["model_id"],
        input_tokens=_int(row["input_tokens"]),
        output_tokens=_int(row["output_tokens"]),
        energy_wh=_float(row["energy_wh"]),
        latency_ms=_int(row["latency_ms"]),
        status=row["status"],
    )
