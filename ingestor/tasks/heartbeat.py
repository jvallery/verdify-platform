"""tasks.heartbeat — the daily review (climate refactor packages 4.2 and 5.1) and the MCP health probe.

The planner is a daily reviewer (plan section 7). Every 60 s this task:

1. at or after 07:00 America/Denver, inserts the ``kind = 'daily'`` planner_review row for yesterday when none
   exists (the partial unique index makes the insert idempotent across restarts: the table is the state);
2. delivers each ``requested`` row (daily, or manual from MCP review_run) to Hermes ``POST /v1/runs`` with the
   review prompt built from the record (``review_prompt``), retrying every 10 minutes, at most 6 attempts;
3. polls Hermes for each delivered run and records its end and token usage (#1661); a run that ends before
   review_write is a failed review with a fixed class;
4. raises ``daily_review_missed`` at or after 10:00 local while yesterday's daily review is not written, and
   resolves it once it is; resolves the retired planner alert kinds once;
5. probes the MCP Service (``mcp_unreachable``).

The trigger matrix, the solar milestones, the plan ledger, the delivery log, the forecast-deviation trigger and the
context-gather script are retired; nothing here writes plan_journal, setpoint_plan, plan_delivery_log or
planner_trigger_ledger.
"""

from datetime import date
from datetime import time as dtime

from review_prompt import REVIEW_EVENT_TYPES, build_review_prompt

from config import HERMES_API_KEY, HERMES_SESSION_PREFIX, HERMES_URL

from ._common import (
    _DENVER,
    GREENHOUSE_ID,
    AlertEnvelope,
    _td,
    asyncio,
    asyncpg,
    datetime,
    json,
    log,
    os,
    re,
    urllib,
    uuid,
)

REVIEW_LOCAL_TIME = dtime(7, 0)  # the record of yesterday is final after 00:32 local (the daily-record refresh)
REVIEW_MISSED_LOCAL_TIME = dtime(10, 0)
REVIEW_RETRY_MINUTES = 10
REVIEW_MAX_ATTEMPTS = 6
REVIEW_RUN_DEADLINE_MINUTES = 60  # a delivered run with no terminal status by then is lost (Hermes keeps 1 h)
REVIEW_DELIVERY_TIMEOUT_SECONDS = 30
REVIEW_RECORD_DAYS = 8
DAILY_REVIEW_SENSOR = "system.daily_review"
# The planner alert kinds the plan cycle raised (contracts/reviewer.md). Nothing raises them now; an open row is
# resolved by the first pass after the release.
RETIRED_PLANNER_ALERT_TYPES = (
    "planner_stale",
    "planner_evaluation_missed",
    "planner_gateway_delivery_failed",
    "planner_trigger_sla_timeout",
    "planner_required_plan_missed",
    "planner_band_ownership_drift",
    "planner_tunable_range_drift",
    "planner_plan_horizon_missing",
    "plan_context_failed",
    "plan_context_slow",
    "forecast_deviation",
    "forecast_action_alert",
    "plan_not_delivered",
)
_retired_alerts_resolved = False
_SESSION_ID = re.compile(r"[A-Za-z0-9:_\-.]+")


# Consecutive failed MCP Service probes (see heartbeat section 6).
_mcp_unreachable_streak = 0
# Whether an mcp_unreachable alert_log row may be open: True at start, so the first
# reachable probe after a restart closes a row the previous process left open.
_mcp_alert_maybe_open = True
MCP_UNREACHABLE_STREAK = 3  # ~3 min of hard-down before the row opens
MCP_UNREACHABLE_SENSOR = "system.mcp"


def mcp_unreachable_alert(url: str, streak: int) -> dict:
    """The mcp_unreachable alert_log payload (#1352). A warning since H3 (RULINGS Q4): MCP serves only the daily review
    and the irrigation tools, and daily_review_missed is the signal that matters."""
    return {
        "alert_type": "mcp_unreachable",
        "severity": "warning",
        "category": "system",
        "sensor_id": MCP_UNREACHABLE_SENSOR,
        "zone": None,
        "message": f"MCP server unreachable at {url} for {streak} consecutive checks",
        "details": {"url": url, "consecutive_failures": streak},
        "metric_value": float(streak),
        "threshold_value": float(MCP_UNREACHABLE_STREAK),
    }


async def _open_mcp_unreachable_alert(conn, url: str, streak: int) -> None:
    """One open row per outage: insert unless one is already open."""
    env = AlertEnvelope.model_validate(mcp_unreachable_alert(url, streak))
    await conn.execute(
        """
        INSERT INTO alert_log
          (alert_type, severity, category, sensor_id, zone, message, details,
           source, metric_value, threshold_value, greenhouse_id)
        SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, 'ingestor', $8, $9, $10
         WHERE NOT EXISTS (
               SELECT 1 FROM alert_log
                WHERE alert_type = $1 AND sensor_id = $4 AND resolved_at IS NULL
                  AND disposition IN ('open', 'acknowledged'))
        """,
        env.alert_type,
        env.severity,
        env.category,
        env.sensor_id,
        env.zone,
        env.message,
        json.dumps(env.details),
        env.metric_value,
        env.threshold_value,
        GREENHOUSE_ID,
    )


async def _resolve_mcp_unreachable_alert(conn) -> None:
    await conn.execute(
        """
        UPDATE alert_log
           SET disposition = 'resolved', resolved_at = now(), resolved_by = 'system',
               resolution = 'auto-resolved: MCP reachable again'
         WHERE alert_type = 'mcp_unreachable' AND sensor_id = $1 AND resolved_at IS NULL
        """,
        MCP_UNREACHABLE_SENSOR,
    )


# Hermes retains terminal /v1/runs status in process memory for one hour. Poll
# only the bounded live window and keep the heartbeat's network fan-out below
# Hermes's own ten-run concurrency ceiling.
_HERMES_RUN_STATUS_LOOKBACK_MINUTES = 65
_HERMES_RUN_STATUS_LIMIT = 10
_HERMES_RUN_STATUS_TIMEOUT_SECONDS = 5
_HERMES_RUN_STATUS_MAX_BYTES = 16_384
_HERMES_RUN_STATUSES = frozenset(
    {"queued", "running", "waiting_for_approval", "stopping", "completed", "failed", "cancelled"}
)
_HERMES_RUN_TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})
_HERMES_RUN_LAST_EVENTS = {
    "completed": "run.completed",
    "failed": "run.failed",
    "cancelled": "run.cancelled",
}
_HERMES_RUN_USAGE_FIELDS = ("input_tokens", "output_tokens", "total_tokens")
# A delivered review whose Hermes run ended before review_write: the planner_review.failure class.
_HERMES_RUN_FAILURE_CLASSES = {
    "completed": "completed_without_review",
    "failed": "hermes_run_failed",
    "cancelled": "hermes_run_cancelled",
}


# #1351: a failed run's provider error is classified into this fixed vocabulary and only the class is kept, so
# the planning-failure alert can say "OpenAI billing or credits" without retaining provider text. Order matters:
# OpenAI's out-of-credits error is HTTP 429 `insufficient_quota`, so billing is checked before rate limiting.
_HERMES_RUN_ERROR_CLASSES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "provider_billing",
        re.compile(
            r"insufficient_quota|exceeded your current quota|billing|credit balance|out of credits|"
            r"payment required|\b402\b",
            re.IGNORECASE,
        ),
    ),
    (
        "provider_auth",
        re.compile(r"invalid_api_key|incorrect api key|\b401\b|unauthori[sz]ed|\b403\b|permission denied", re.I),
    ),
    ("provider_rate_limited", re.compile(r"rate.?limit|\b429\b", re.IGNORECASE)),
    (
        "provider_unavailable",
        re.compile(
            r"\b50[0234]\b|service unavailable|overloaded|timed? ?out|connection (?:error|refused|reset)",
            re.IGNORECASE,
        ),
    ),
)


def _classify_hermes_run_error(error: object) -> str | None:
    """A failed run's error text as one fixed class (never the text); None when there is no error text."""
    if isinstance(error, dict):
        error = " ".join(str(value) for value in error.values())
    if not isinstance(error, str) or not error.strip():
        return None
    text = error[:4096]
    for name, pattern in _HERMES_RUN_ERROR_CLASSES:
        if pattern.search(text):
            return name
    return "other"


def _valid_hermes_run_id(run_id: object) -> bool:
    """Accept only Hermes's fixed ``run_<uuid hex>`` path segment."""
    if not isinstance(run_id, str) or not run_id.startswith("run_") or len(run_id) != 36:
        return False
    try:
        return uuid.UUID(hex=run_id[4:]).hex == run_id[4:]
    except (ValueError, AttributeError):
        return False


def _normalize_hermes_run_status(payload: object, expected_run_id: str) -> dict[str, object] | None:
    """Return the public-safe subset of one Hermes run-status response.

    Hermes errors and assistant output can contain arbitrary provider/model
    text, so neither is retained. Only the fixed status/event vocabulary and
    numeric usage scalars are eligible for the delivery audit body.
    """
    if not isinstance(payload, dict):
        return None
    if payload.get("object") != "hermes.run" or payload.get("run_id") != expected_run_id:
        return None
    status = payload.get("status")
    if not isinstance(status, str) or status not in _HERMES_RUN_STATUSES:
        return None

    normalized: dict[str, object] = {"status": status}
    last_event = payload.get("last_event")
    if last_event == _HERMES_RUN_LAST_EVENTS.get(status):
        normalized["last_event"] = last_event

    if status == "failed":
        error_class = _classify_hermes_run_error(payload.get("error"))
        if error_class is not None:
            normalized["error_class"] = error_class

    raw_usage = payload.get("usage")
    if isinstance(raw_usage, dict):
        usage: dict[str, int] = {}
        for field in _HERMES_RUN_USAGE_FIELDS:
            value = raw_usage.get(field)
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                usage[field] = value
        if usage:
            normalized["usage"] = usage
    return normalized


def _fetch_hermes_run_status(run_id: str) -> dict[str, object] | None:
    """Fetch and sanitize one pollable Hermes run status (blocking helper)."""
    if not _valid_hermes_run_id(run_id):
        log.warning("Skipping malformed Hermes run id on a review row")
        return None

    headers = {"Accept": "application/json"}
    if HERMES_API_KEY:
        headers["Authorization"] = f"Bearer {HERMES_API_KEY}"
    try:
        request = urllib.request.Request(
            f"{HERMES_URL.rstrip('/')}/v1/runs/{run_id}",
            headers=headers,
            method="GET",
        )
        with urllib.request.urlopen(request, timeout=_HERMES_RUN_STATUS_TIMEOUT_SECONDS) as response:
            raw = response.read(_HERMES_RUN_STATUS_MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        # A restarted Hermes process loses its in-memory run registry and
        # returns 404; a delivered review then fails at its deadline.
        if exc.code != 404:
            log.warning("Hermes run status fetch failed for %s: HTTP %d", run_id, exc.code)
        return None
    except Exception as exc:
        log.warning("Hermes run status fetch failed for %s: %s", run_id, type(exc).__name__)
        return None

    if len(raw) > _HERMES_RUN_STATUS_MAX_BYTES:
        log.warning("Hermes run status response exceeded limit for %s", run_id)
        return None
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        log.warning("Hermes run status response was invalid JSON for %s", run_id)
        return None
    return _normalize_hermes_run_status(payload, run_id)


# ── The review's context: the record, read in the ingestor (gather-plan-context.sh is retired) ──


async def gather_review_context(conn: asyncpg.Connection, review_date: date) -> dict:
    """The record a review reads (contracts/reviewer.md). Each part degrades to "not available" on its own."""
    from .band_anchors import crop_band_anchor_values

    context: dict = {}
    try:
        rows = await conn.fetch(
            "SELECT * FROM v_daily_record WHERE date <= $1 AND date > $1 - $2::int ORDER BY date DESC LIMIT $2",
            review_date,
            REVIEW_RECORD_DAYS,
        )
        context["record"] = [dict(row) for row in rows]
    except asyncpg.PostgresError as exc:
        log.warning("review context: daily record read failed: %s", type(exc).__name__)
    try:
        band, _origin = await crop_band_anchor_values(conn)
        context["band"] = band
    except Exception as exc:  # the band reader degrades on its own; a failure here only drops the section
        log.warning("review context: band read failed: %s", type(exc).__name__)
    day_start = datetime.combine(review_date, dtime(0), tzinfo=_DENVER)
    day_end = day_start + _td(days=1)
    try:
        rows = await conn.fetch(
            """
            WITH s AS (
                SELECT ts, value::jsonb AS v, lead(ts) OVER (ORDER BY ts) AS next_ts
                  FROM system_state
                 WHERE entity = 'climate_law_state' AND ts >= $1 AND ts < $2
            )
            SELECT v->>'dr' AS dr,
                   round(sum(LEAST(EXTRACT(epoch FROM (COALESCE(next_ts, $2) - ts)), 120)) / 60.0) AS minutes
              FROM s
             WHERE ((v->>'l')::int & 64) <> 0
             GROUP BY 1
            """,
            day_start,
            day_end,
        )
        reported = await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM system_state WHERE entity = 'climate_law_state' AND ts >= $1 AND ts < $2)",
            day_start,
            day_end,
        )
        context["drying"] = {str(row["dr"]): float(row["minutes"]) for row in rows} if reported else None
        context["drying_meter"] = await conn.fetchval(
            "SELECT value FROM system_state WHERE entity = 'climate_drying_meter' AND ts < $1 ORDER BY ts DESC LIMIT 1",
            day_end,
        )
    except (asyncpg.PostgresError, ValueError) as exc:
        log.warning("review context: law state read failed: %s", type(exc).__name__)
        context["drying"] = None
    try:
        rows = await conn.fetch(
            """
            SELECT alert_type, severity, count(*) AS opened,
                   count(*) FILTER (WHERE resolved_at IS NULL) AS still_open
              FROM alert_log
             WHERE ts > now() - interval '24 hours'
             GROUP BY alert_type, severity
             ORDER BY opened DESC
             LIMIT 30
            """
        )
        context["alerts"] = [tuple(row.values()) for row in rows]
    except asyncpg.PostgresError as exc:
        log.warning("review context: alert read failed: %s", type(exc).__name__)
    try:
        rows = await conn.fetch(
            """
            WITH latest AS (SELECT max(fetched_at) AS f FROM weather_forecast WHERE fetched_at > now() - interval '1 day')
            SELECT (w.ts AT TIME ZONE 'America/Denver')::date AS day,
                   round(min(w.temp_f)::numeric, 1) AS min_f, round(max(w.temp_f)::numeric, 1) AS max_f,
                   round(min(w.rh_pct)::numeric) AS min_rh
              FROM weather_forecast w, latest
             WHERE w.fetched_at = latest.f AND w.ts >= now() AND w.ts < now() + interval '72 hours'
             GROUP BY 1 ORDER BY 1
             LIMIT 4
            """
        )
        context["forecast"] = [tuple(row.values()) for row in rows]
    except asyncpg.PostgresError as exc:
        log.warning("review context: forecast read failed: %s", type(exc).__name__)
    return context


# ── Delivery to Hermes ──


def _post_review(run_id: str, kind: str, message: str) -> tuple[int, str | None]:
    """POST one review to Hermes (blocking). Returns (HTTP status or 0 when unreachable, Hermes run id)."""
    session_id = f"{HERMES_SESSION_PREFIX}:review:{run_id}"
    if not _SESSION_ID.fullmatch(session_id):
        log.error("review %s: malformed session id; not sent", run_id)
        return 0, None
    payload = {
        "input": message,
        "session_id": session_id,
        "metadata": {
            "trigger_id": run_id,
            "planner_instance": "local",
            "event_type": REVIEW_EVENT_TYPES[kind],
            "event_label": f"{kind} review",
        },
    }
    request = urllib.request.Request(
        f"{HERMES_URL.rstrip('/')}/v1/runs",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {HERMES_API_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=REVIEW_DELIVERY_TIMEOUT_SECONDS) as response:
            status = response.getcode()
            raw = response.read(_HERMES_RUN_STATUS_MAX_BYTES)
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except Exception as exc:
        log.warning("review %s: Hermes unreachable: %s", run_id, type(exc).__name__)
        return 0, None
    hermes_run_id = None
    try:
        parsed = json.loads(raw)
        candidate = parsed.get("run_id") if isinstance(parsed, dict) else None
        hermes_run_id = candidate if _valid_hermes_run_id(candidate) else None
    except (json.JSONDecodeError, UnicodeDecodeError):
        pass
    return status, hermes_run_id


async def _ensure_daily_row(conn: asyncpg.Connection, now_local: datetime) -> None:
    if now_local.time() < REVIEW_LOCAL_TIME:
        return
    review_date = now_local.date() - _td(days=1)
    # Look first, so the minute loop does not spend an identity value on every conflict (review m7).
    if await conn.fetchval("SELECT 1 FROM planner_review WHERE kind = 'daily' AND review_date = $1", review_date):
        return
    await conn.execute(
        """
        INSERT INTO planner_review (run_id, kind, review_date, requested_by)
        VALUES ($1::uuid, 'daily', $2, 'ingestor')
        ON CONFLICT (review_date) WHERE kind = 'daily' DO NOTHING
        """,
        str(uuid.uuid4()),
        review_date,
    )


async def _deliver_due(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        due = await conn.fetch(
            """
            SELECT run_id::text AS run_id, kind, review_date, attempts
              FROM planner_review
             WHERE status = 'requested'
               AND requested_at + attempts * ($1::int * interval '1 minute') <= now()
             ORDER BY requested_at
             LIMIT 2
            """,
            REVIEW_RETRY_MINUTES,
        )
    loop = asyncio.get_running_loop()
    for row in due:
        async with pool.acquire() as conn:
            # Claim the attempt before the POST (review m1): a pass cut off by its timeout, or an ingestor restart,
            # after Hermes accepted the POST but before the delivered UPDATE, then waits the full retry interval
            # instead of posting the same review again the next minute. A row another pass claimed is skipped.
            attempts = await conn.fetchval(
                """
                UPDATE planner_review SET attempts = attempts + 1
                 WHERE run_id = $1::uuid AND status = 'requested' AND attempts = $2
                RETURNING attempts
                """,
                row["run_id"],
                row["attempts"],
            )
            if attempts is None:
                continue
            context = await gather_review_context(conn, row["review_date"])
        message = build_review_prompt(
            run_id=row["run_id"], kind=row["kind"], review_date=row["review_date"], context=context
        )
        status, hermes_run_id = await loop.run_in_executor(None, _post_review, row["run_id"], row["kind"], message)
        async with pool.acquire() as conn:
            if 200 <= status < 300:
                await conn.execute(
                    """
                    UPDATE planner_review
                       SET status = 'delivered', attempts = $2, delivered_at = now(), hermes_run_id = $3,
                           gateway_status = $4, failure = NULL
                     WHERE run_id = $1::uuid AND status = 'requested'
                    """,
                    row["run_id"],
                    attempts,
                    hermes_run_id,
                    status,
                )
                log.info(
                    "review %s (%s %s) delivered as %s", row["run_id"], row["kind"], row["review_date"], hermes_run_id
                )
                continue
            failure = "gateway_unreachable" if status == 0 else "gateway_rejected"
            exhausted = attempts >= REVIEW_MAX_ATTEMPTS
            await conn.execute(
                """
                UPDATE planner_review
                   SET attempts = $2, gateway_status = $3, failure = $4,
                       status = CASE WHEN $5 THEN 'failed' ELSE status END
                 WHERE run_id = $1::uuid AND status = 'requested'
                """,
                row["run_id"],
                attempts,
                status,
                "attempts_exhausted" if exhausted else failure,
                exhausted,
            )
            log.warning("review %s delivery attempt %d failed (%s, HTTP %d)", row["run_id"], attempts, failure, status)


async def _poll_runs(pool: asyncpg.Pool) -> None:
    """Record each delivered run's end and usage; fail a review whose run ended (or was lost) before review_write."""
    async with pool.acquire() as conn:
        # The deadline runs on its own, with no poll window (review m2): a row delivered while the ingestor was
        # down for more than the window still fails instead of staying delivered.
        lost = await conn.fetch(
            """
            UPDATE planner_review SET status = 'failed', failure = 'hermes_run_failed'
             WHERE status = 'delivered' AND delivered_at < now() - ($1::int * interval '1 minute')
            RETURNING run_id::text AS run_id
            """,
            REVIEW_RUN_DEADLINE_MINUTES,
        )
        for row in lost:
            log.warning(
                "review %s: no terminal Hermes status within %d min", row["run_id"], REVIEW_RUN_DEADLINE_MINUTES
            )
        rows = await conn.fetch(
            """
            SELECT run_id::text AS run_id, hermes_run_id, status, delivered_at
              FROM planner_review
             WHERE status IN ('delivered', 'written') AND run_finished_at IS NULL AND delivered_at IS NOT NULL
               AND delivered_at > now() - interval '2 hours'
             ORDER BY delivered_at DESC
             LIMIT $1
            """,
            _HERMES_RUN_STATUS_LIMIT,
        )
    if not rows:
        return
    loop = asyncio.get_running_loop()
    statuses = await asyncio.gather(
        *(
            loop.run_in_executor(None, _fetch_hermes_run_status, row["hermes_run_id"])
            if row["hermes_run_id"]
            else asyncio.sleep(0, result=None)
            for row in rows
        )
    )
    async with pool.acquire() as conn:
        for row, status in zip(rows, statuses, strict=True):
            terminal = status is not None and status.get("status") in _HERMES_RUN_TERMINAL_STATUSES
            if terminal:
                usage = status.get("usage") or {}
                await conn.execute(
                    """
                    UPDATE planner_review
                       SET run_finished_at = now(), input_tokens = $2, output_tokens = $3, total_tokens = $4,
                           status = CASE WHEN status = 'delivered' THEN 'failed' ELSE status END,
                           failure = CASE WHEN status = 'delivered' THEN $5 ELSE failure END
                     WHERE run_id = $1::uuid AND run_finished_at IS NULL
                    """,
                    row["run_id"],
                    usage.get("input_tokens"),
                    usage.get("output_tokens"),
                    usage.get("total_tokens"),
                    _HERMES_RUN_FAILURE_CLASSES[str(status["status"])],
                )


# ── The one planner alert left: the daily review did not run ──


def daily_review_missed_alert(review_date: date, row: dict | None) -> dict:
    """The daily_review_missed alert_log payload (contracts/reviewer.md)."""
    status = row["status"] if row else None
    return {
        "alert_type": "daily_review_missed",
        "severity": "warning",
        "category": "system",
        "sensor_id": DAILY_REVIEW_SENSOR,
        "zone": None,
        "message": f"The daily review of {review_date.isoformat()} was not written by 10:00 ({status or 'no request'})",
        "details": {
            "review_date": review_date.isoformat(),
            "status": status,
            "attempts": int(row["attempts"]) if row else 0,
            "failure": row["failure"] if row else None,
        },
        "metric_value": None,
        "threshold_value": None,
    }


async def _daily_review_alert(conn: asyncpg.Connection, now_local: datetime) -> None:
    review_date = now_local.date() - _td(days=1)
    row = await conn.fetchrow(
        "SELECT status, attempts, failure FROM planner_review WHERE kind = 'daily' AND review_date = $1",
        review_date,
    )
    # A manual review of the same day, written after a failed daily one, also resolves the alert (review m3).
    written = (row is not None and row["status"] == "written") or bool(
        await conn.fetchval(
            "SELECT 1 FROM planner_review WHERE kind = 'manual' AND review_date = $1 AND status = 'written' LIMIT 1",
            review_date,
        )
    )
    if written:
        await conn.execute(
            """
            UPDATE alert_log
               SET disposition = 'resolved', resolved_at = now(), resolved_by = 'system',
                   resolution = 'auto-resolved: the daily review was written'
             WHERE alert_type = 'daily_review_missed' AND sensor_id = $1 AND resolved_at IS NULL
            """,
            DAILY_REVIEW_SENSOR,
        )
        return
    if now_local.time() < REVIEW_MISSED_LOCAL_TIME:
        return
    env = AlertEnvelope.model_validate(daily_review_missed_alert(review_date, dict(row) if row else None))
    await conn.execute(
        """
        INSERT INTO alert_log
          (alert_type, severity, category, sensor_id, zone, message, details, source, greenhouse_id)
        SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, 'ingestor', $8
         WHERE NOT EXISTS (
               SELECT 1 FROM alert_log
                WHERE alert_type = $1 AND sensor_id = $4 AND resolved_at IS NULL
                  AND disposition IN ('open', 'acknowledged'))
        """,
        env.alert_type,
        env.severity,
        env.category,
        env.sensor_id,
        env.zone,
        env.message,
        json.dumps(env.details),
        GREENHOUSE_ID,
    )


async def _resolve_retired_planner_alerts(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        UPDATE alert_log
           SET disposition = 'resolved', resolved_at = now(), resolved_by = 'system',
               resolution = 'auto-resolved: the plan cycle is retired (climate refactor 4.2)'
         WHERE alert_type = ANY($1::text[]) AND resolved_at IS NULL
        """,
        list(RETIRED_PLANNER_ALERT_TYPES),
    )


async def daily_review(pool: asyncpg.Pool) -> None:
    """The daily review task (every 60 s): request, deliver, poll, alert; then the MCP probe."""
    global _retired_alerts_resolved
    now_local = datetime.now(_DENVER)
    try:
        async with pool.acquire() as conn:
            if not _retired_alerts_resolved:
                await _resolve_retired_planner_alerts(conn)
                _retired_alerts_resolved = True
            await _ensure_daily_row(conn, now_local)
        await _deliver_due(pool)
        await _poll_runs(pool)
        async with pool.acquire() as conn:
            await _daily_review_alert(conn, now_local)
    except Exception as exc:
        log.warning("daily review pass failed: %s: %s", type(exc).__name__, exc)
    await _mcp_health_check(pool)


async def _mcp_health_check(pool: asyncpg.Pool) -> None:
    # MCP server health check (every pass = 60s)
    # 2026-07-11 audit: the legacy single-host watchdog probed 127.0.0.1:8000
    # (always dead in k3s — MCP is a separate Deployment), logged an ERROR,
    # Popen'd a doomed in-container mcp/server.py, and attempted a chat post
    # EVERY MINUTE — pure noise that masked the real MCP health signal. Probe
    # the in-cluster Service instead (override via VERDIFY_MCP_HEALTH_URL);
    # k8s liveness/restart of the MCP Deployment owns recovery, so the local
    # Popen respawn is gone. One mcp_unreachable alert_log row opens per outage
    # (#1352) and resolves when the probe answers again.
    global _mcp_unreachable_streak, _mcp_alert_maybe_open
    mcp_url = os.environ.get("VERDIFY_MCP_HEALTH_URL", "http://verdify-mcp:8000/mcp")
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: urllib.request.urlopen(mcp_url, timeout=5),
        )
        mcp_reachable = True
        # Any response (even 405 Method Not Allowed) means the server is alive
    except urllib.error.HTTPError:
        mcp_reachable = True  # alive, just doesn't accept GET on /mcp
    except Exception as e:
        mcp_reachable = False
        _mcp_unreachable_streak += 1
        log.error("MCP server unreachable (%s, streak=%d): %s", mcp_url, _mcp_unreachable_streak, e)
    try:
        if mcp_reachable:
            _mcp_unreachable_streak = 0
            if _mcp_alert_maybe_open:
                async with pool.acquire() as conn:
                    await _resolve_mcp_unreachable_alert(conn)
                _mcp_alert_maybe_open = False
        elif _mcp_unreachable_streak >= MCP_UNREACHABLE_STREAK:  # idempotent: one open row per outage
            async with pool.acquire() as conn:
                await _open_mcp_unreachable_alert(conn, mcp_url, _mcp_unreachable_streak)
            _mcp_alert_maybe_open = True
    except Exception as e:
        log.warning("mcp_unreachable alert_log write failed: %s", e)
