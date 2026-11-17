"""The daily reviewer's output (API-34) and the state of the day's review, which Now (API-02) shares.

The reviewer (climate refactor 5.1) writes one review a day to ``planner_review``; the operator API reads it through
migration 320's projection ``v_dashboard_review``, never the table. ``today()`` is the one definition of the day's
review state: API-34's ``today`` and ``proposal_waiting`` and Now's ``review`` both come from it.

- The review of a day is due once the ingestor requests it, at or after 07:00 America/Denver the next day, and late
  at 10:00, when the ingestor raises ``daily_review_missed`` (``ingestor/tasks/heartbeat.py``). ``status`` is
  ``written`` when any review of that day is written, else the newest request's status, else ``due`` from 07:00 and
  ``not_due`` before. ``missed`` follows the open ``daily_review_missed`` alert while the day is not written.
- A proposal is ``answered`` when a ``band.write`` (the band editor's Save, API-24) followed the review before the
  next written review, ``superseded`` when a newer review was written first, and ``waiting`` otherwise: then it is the
  newest written review and nothing has answered it.
- Each proposed row carries its label and unit from the registry and its current value as the band editor resolves
  it (``band_profile.anchors_from_rows``); a row the band editor does not hold has no current value.
- Token use: the newest finished review against the mean of the 7 and the 30 finished reviews before it.

Each read is ``async``, takes an asyncpg connection and runs in one read-only snapshot. Nothing here writes.
"""

from __future__ import annotations

import base64
import json
import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any, Literal

import asyncpg
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from verdify_schemas.band_profile import HOUSE_PARAMS
from verdify_schemas.band_rows import HOUSE_CROP, HOUSE_SERIES
from verdify_schemas.review import BandProposal, ReviewFailure, ReviewKind, ReviewStatus
from verdify_schemas.setting_help import setting_label
from verdify_schemas.tunable_registry import get as registry_get
from verdify_services import alerts, band_profile, series
from verdify_services.problems import ServiceError, problem
from verdify_services.reads import DENVER, GREENHOUSE_ID, ReviewDayStatus, _snapshot

# The ingestor's daily review times (ingestor/tasks/heartbeat.py:43-44, REVIEW_LOCAL_TIME and
# REVIEW_MISSED_LOCAL_TIME). The ingestor is not importable here; tests/test_verdify_services_reviews.py checks both.
REVIEW_LOCAL_TIME = time(7, 0)
REVIEW_MISSED_LOCAL_TIME = time(10, 0)
EXPECTED_AFTER = REVIEW_LOCAL_TIME.strftime("%H:%M")
LATE_AFTER = REVIEW_MISSED_LOCAL_TIME.strftime("%H:%M")
MISSED_ALERT = "daily_review_missed"
BAND_WRITE = band_profile.ACTION  # API-24's one activity_log action
LIMIT_DEFAULT = 30
LIMIT_MAX = 60
TOKEN_MEANS = (7, 30)
_BIGINT_MAX = 2**63 - 1

TodayStatus = ReviewDayStatus  # Now.review.status reads the same words
ProposalState = Literal["waiting", "answered", "superseded"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProposalChange(_Model):
    param: str
    label: str
    unit: str | None
    current: float | None = Field(
        description="The row's value now as the band editor reads it; null for a row it does not hold"
    )
    proposed: float


class ReviewProposal(_Model):
    """The review's band proposal (``verdify_schemas.review.BandProposal``), each row with its words and value now."""

    changes: list[ProposalChange]
    price: str
    reason: str | None


class Review(_Model):
    id: int
    kind: ReviewKind
    review_date: date
    status: ReviewStatus
    requested_at: datetime
    requested_by: str
    attempts: int
    delivered_at: datetime | None
    run_finished_at: datetime | None
    written_at: datetime | None
    failure: ReviewFailure | None
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    summary: str | None
    proposal: ReviewProposal | None
    proposal_state: ProposalState | None


class ReviewToday(_Model):
    """The review of the local day before today: its state, whether it is missed, and when it is due and late."""

    review_date: date
    status: TodayStatus
    missed: bool
    expected_after: str = EXPECTED_AFTER
    late_after: str = LATE_AFTER


class ReviewTokens(_Model):
    last: int | None
    mean_7: float | None
    mean_30: float | None
    rise_pct: float | None


class ProposalWaiting(_Model):
    review_id: int
    review_date: date


class ReviewPage(_Model):
    """API-34 ``GET /v1/reviews``: newest first, keyset-paged by id."""

    items: list[Review]
    next_cursor: str | None
    today: ReviewToday
    tokens: ReviewTokens
    proposal_waiting: ProposalWaiting | None


@dataclass(frozen=True)
class ReviewDay:
    """``today()``: the state of the review of the local day before today, the newest written review's time, and the
    proposal that waits for the owner, if one does."""

    review_date: date
    status: TodayStatus
    missed: bool
    written_at: datetime | None
    proposal_waiting: ProposalWaiting | None


# ── SQL (bounded; parameters only) ──────────────────────────────────────────

# Before migration 320 the projection is absent and the dashboard login cannot read the review: Now then shows no
# review instead of failing.
_READY_SQL = """
SELECT now() AS at,
       coalesce(has_table_privilege(to_regclass('public.v_dashboard_review'), 'SELECT'), false) AS ready
"""

_DAY_ROWS_SQL = """
SELECT kind, status, requested_at, id
  FROM v_dashboard_review
 WHERE review_date = $1
"""

# The open daily_review_missed alert (v_open_alerts' own predicate, as Now's Iris tile reads it) and the newest
# written review, with whether a band write followed it. activity_log is read from the review's time on, on its
# (greenhouse_id, ts) index.
_DAY_FACTS_SQL = f"""
SELECT EXISTS (SELECT 1 FROM alert_log WHERE ({alerts.OPEN_PREDICATE}) AND alert_type = $3) AS missed_open,
       w.id AS written_id, w.review_date AS written_date, w.written_at, w.has_proposal, w.answered
  FROM (SELECT 1) AS anchor
  LEFT JOIN LATERAL (
        SELECT r.id, r.review_date, r.written_at, r.band_proposal IS NOT NULL AS has_proposal,
               EXISTS (SELECT 1 FROM activity_log AS a
                        WHERE a.greenhouse_id = $1 AND a.action = $2 AND a.ts > r.written_at) AS answered
          FROM v_dashboard_review AS r
         WHERE r.status = 'written' AND r.written_at IS NOT NULL
         ORDER BY r.written_at DESC, r.id DESC
         LIMIT 1) AS w ON true
"""

# One page, newest first by id. A review with a proposal gets the next written review's time and whether a band
# write came between the two.
_PAGE_SQL = """
SELECT r.id, r.kind, r.review_date, r.status, r.requested_at, r.requested_by, r.attempts, r.delivered_at,
       r.run_finished_at, r.written_at, r.failure, r.input_tokens, r.output_tokens, r.total_tokens, r.summary,
       r.band_proposal, n.next_written_at,
       CASE WHEN r.band_proposal IS NOT NULL AND r.written_at IS NOT NULL THEN
            EXISTS (SELECT 1 FROM activity_log AS a
                     WHERE a.greenhouse_id = $1 AND a.action = $2 AND a.ts > r.written_at
                       AND (n.next_written_at IS NULL OR a.ts < n.next_written_at))
       END AS answered
  FROM v_dashboard_review AS r
  LEFT JOIN LATERAL (SELECT min(x.written_at) AS next_written_at FROM v_dashboard_review AS x
                      WHERE x.status = 'written' AND x.written_at > r.written_at) AS n ON true
 WHERE ($3::bigint IS NULL OR r.id < $3::bigint)
 ORDER BY r.id DESC
 LIMIT $4
"""

_TOKENS_SQL = """
SELECT total_tokens
  FROM v_dashboard_review
 WHERE total_tokens IS NOT NULL
 ORDER BY id DESC
 LIMIT $1
"""


# ── pure rules ──────────────────────────────────────────────────────────────


def review_date_of(at: datetime) -> date:
    """The day the review of ``at``'s local morning covers: the America/Denver day before."""
    return at.astimezone(DENVER).date() - timedelta(days=1)


def day_status(rows: Iterable[Mapping[str, Any]], local_time: time) -> TodayStatus:
    """``written`` when any review of the day is written; else the newest request's status (a manual review asked
    after a failed daily one shows its own progress); else ``due`` from 07:00 local and ``not_due`` before."""
    ordered = sorted(rows, key=lambda row: (row["requested_at"], row["id"]))
    if any(row["status"] == "written" for row in ordered):
        return "written"
    if ordered:
        return ordered[-1]["status"]
    return "due" if local_time >= REVIEW_LOCAL_TIME else "not_due"


def day_missed(missed_open: bool, status: TodayStatus) -> bool:
    """Missed while the ingestor's ``daily_review_missed`` alert is open and the day's review is not written. The
    ingestor resolves the alert once the review of the current day is written."""
    return bool(missed_open) and status != "written"


def proposal_state(has_proposal: bool, answered: bool | None, next_written_at: datetime | None) -> ProposalState | None:
    """``answered`` when a band write followed the review before the next written one, ``superseded`` when a newer
    review was written first, ``waiting`` otherwise; null without a proposal."""
    if not has_proposal:
        return None
    if answered:
        return "answered"
    return "superseded" if next_written_at is not None else "waiting"


def _mean(values: Sequence[int]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def token_use(totals: Sequence[int]) -> ReviewTokens:
    """``totals`` are the finished reviews' total tokens, newest first: the newest against the mean of the 7 and the
    30 before it, and its rise over that 7-review mean in percent."""
    if not totals:
        return ReviewTokens(last=None, mean_7=None, mean_30=None, rise_pct=None)
    last, before = totals[0], totals[1:]
    mean_7, mean_30 = (_mean(before[:count]) for count in TOKEN_MEANS)
    rise = round(100.0 * (last - mean_7) / mean_7, 1) if mean_7 else None
    return ReviewTokens(last=last, mean_7=mean_7, mean_30=mean_30, rise_pct=rise)


def _finite(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _order(param: str) -> tuple[int, str]:
    return (HOUSE_PARAMS.index(param) if param in HOUSE_PARAMS else len(HOUSE_PARAMS), param)


def proposal_of(raw: object, current: Mapping[str, float]) -> ReviewProposal | None:
    """The stored ``band_proposal`` with each row's label, unit and value now, house rows in the band editor's order.

    It is read as ``BandProposal``; a stored proposal the schema no longer accepts (a registry range moved since) is
    still shown, keeping its finite rows and its text."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return None
    if not isinstance(raw, dict):
        return None
    try:
        checked = BandProposal.model_validate(raw)
        anchors: dict[str, float] = dict(checked.anchors)
        price: str | None = checked.price
        reason: str | None = checked.reason
    except ValidationError:
        stored = raw.get("anchors")
        anchors = {
            str(name): number
            for name, value in (stored.items() if isinstance(stored, dict) else ())
            if (number := _finite(value)) is not None
        }
        price, reason = _text(raw.get("price")), _text(raw.get("reason"))
    if not anchors or price is None:
        return None
    changes = []
    for param in sorted(anchors, key=_order):
        spec = registry_get(param)
        changes.append(
            ProposalChange(
                param=param,
                label=setting_label(param),
                unit=spec.unit if spec is not None and spec.unit else None,
                current=current.get(param),
                proposed=anchors[param],
            )
        )
    return ReviewProposal(changes=changes, price=price, reason=reason)


def _encode_cursor(review_id: int) -> str:
    return base64.urlsafe_b64encode(json.dumps([review_id]).encode("ascii")).rstrip(b"=").decode("ascii")


def _decode_cursor(cursor: str) -> int:
    try:
        (review_id,) = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        if isinstance(review_id, bool) or not isinstance(review_id, int) or not 1 <= review_id <= _BIGINT_MAX:
            raise ValueError("not a cursor")
    except (TypeError, ValueError) as exc:  # binascii.Error, JSONDecodeError and UnicodeDecodeError included
        raise ServiceError(
            problem("invalid_request", "cursor is not a next_cursor of this list", field="cursor")
        ) from exc
    return review_id


# ── reads ───────────────────────────────────────────────────────────────────


async def today(conn: asyncpg.Connection) -> ReviewDay | None:
    """The state of the review of the local day before today, inside the caller's snapshot; None before migration
    320 (the dashboard login cannot read the review)."""
    head = await conn.fetchrow(_READY_SQL)
    if not head["ready"]:
        return None
    at: datetime = head["at"]
    review_date = review_date_of(at)
    rows = await conn.fetch(_DAY_ROWS_SQL, review_date)
    facts = await conn.fetchrow(_DAY_FACTS_SQL, GREENHOUSE_ID, BAND_WRITE, MISSED_ALERT)
    status = day_status(rows, at.astimezone(DENVER).time())
    waiting = None
    if facts["written_id"] is not None and facts["has_proposal"] and not facts["answered"]:
        waiting = ProposalWaiting(review_id=facts["written_id"], review_date=facts["written_date"])
    return ReviewDay(
        review_date=review_date,
        status=status,
        missed=day_missed(facts["missed_open"], status),
        written_at=facts["written_at"],
        proposal_waiting=waiting,
    )


async def _current_anchors(conn: asyncpg.Connection) -> dict[str, float]:
    """The house anchors as the band editor reads them (API-23), by param."""
    rows = await conn.fetch(series.ANCHOR_ROWS_SQL, GREENHOUSE_ID, HOUSE_CROP, list(HOUSE_SERIES))
    return band_profile.anchors_from_rows(rows)


def review_of(row: Mapping[str, Any], current: Mapping[str, float]) -> Review:
    proposal = proposal_of(row["band_proposal"], current) if row["band_proposal"] is not None else None
    return Review(
        id=row["id"],
        kind=row["kind"],
        review_date=row["review_date"],
        status=row["status"],
        requested_at=row["requested_at"],
        requested_by=row["requested_by"],
        attempts=row["attempts"],
        delivered_at=row["delivered_at"],
        run_finished_at=row["run_finished_at"],
        written_at=row["written_at"],
        failure=row["failure"],
        input_tokens=row["input_tokens"],
        output_tokens=row["output_tokens"],
        total_tokens=row["total_tokens"],
        summary=row["summary"],
        proposal=proposal,
        proposal_state=proposal_state(proposal is not None, row["answered"], row["next_written_at"]),
    )


async def page(conn: asyncpg.Connection, limit: int = LIMIT_DEFAULT, cursor: str | None = None) -> ReviewPage:
    """API-34 ``GET /v1/reviews``: the reviews newest first (``limit`` 1 to 60, ``cursor`` the previous page's
    ``next_cursor``), the day's review (``today()``), token use and the proposal that waits, in one snapshot."""
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= LIMIT_MAX:
        raise ServiceError(
            problem(
                "invalid_request",
                f"limit must be 1-{LIMIT_MAX}",
                field="limit",
                min=1,
                max=LIMIT_MAX,
                current=limit if isinstance(limit, int) else None,
            )
        )
    before = _decode_cursor(cursor) if cursor else None
    async with _snapshot(conn):
        day = await today(conn)
        if day is None:
            raise ServiceError(problem("unavailable", "The daily review is not readable on this database yet"))
        rows = await conn.fetch(_PAGE_SQL, GREENHOUSE_ID, BAND_WRITE, before, limit + 1)
        totals = [row["total_tokens"] for row in await conn.fetch(_TOKENS_SQL, max(TOKEN_MEANS) + 1)]
        current = await _current_anchors(conn) if any(row["band_proposal"] is not None for row in rows) else {}
    items = [review_of(row, current) for row in rows[:limit]]
    more = len(rows) > limit
    return ReviewPage(
        items=items,
        next_cursor=_encode_cursor(items[-1].id) if more else None,
        today=ReviewToday(review_date=day.review_date, status=day.status, missed=day.missed),
        tokens=token_use(totals),
        proposal_waiting=day.proposal_waiting,
    )
