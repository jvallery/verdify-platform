"""API-34 and the day's review state (verdify_services.reviews), with no database.

The day's status and missed rule, the proposal states, token use, the proposal's rows with their words and values
now, the cursor and limit refusals, and the page read against a connection that answers each statement from the two
real planner_review rows of 2026-11-17 (ids 1 and 2). The SQL itself runs on the campaign database.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, date, datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from verdify_schemas.review import BandProposal
from verdify_services import band_profile, reviews, series
from verdify_services.problems import ServiceError

ROOT = Path(__file__).resolve().parents[1]
DENVER = ZoneInfo("America/Denver")
AT = datetime(2026, 11, 17, 16, 20, tzinfo=UTC)  # 09:20 MST, the live read

# planner_review as production holds it on 2026-11-17 (live-db C.7): both written, neither with a proposal.
ROW_2 = {
    "id": 2,
    "kind": "daily",
    "review_date": date(2026, 11, 16),
    "status": "written",
    "requested_at": datetime(2026, 11, 17, 14, 0, 4, tzinfo=UTC),
    "requested_by": "ingestor",
    "attempts": 1,
    "delivered_at": datetime(2026, 11, 17, 14, 0, 4, tzinfo=UTC),
    "run_finished_at": datetime(2026, 11, 17, 14, 4, 4, tzinfo=UTC),
    "written_at": datetime(2026, 11, 17, 14, 3, 7, tzinfo=UTC),
    "failure": None,
    "input_tokens": 340590,
    "output_tokens": 14538,
    "total_tokens": 355128,
    "summary": "Compliance: both in band 79.8 %. Proposal (Year): raise only the low edge at sunrise and midnight.",
    "band_proposal": None,
    "next_written_at": None,
    "answered": None,
}
ROW_1 = {
    **ROW_2,
    "id": 1,
    "review_date": date(2026, 11, 15),
    "requested_at": datetime(2026, 11, 17, 0, 19, 17, tzinfo=UTC),
    "delivered_at": datetime(2026, 11, 17, 0, 19, 18, tzinfo=UTC),
    "run_finished_at": datetime(2026, 11, 17, 0, 21, 17, tzinfo=UTC),
    "written_at": datetime(2026, 11, 17, 0, 20, 34, tzinfo=UTC),
    "input_tokens": 179694,
    "output_tokens": 6098,
    "total_tokens": 185792,
    "summary": "No band edit proposed.",
    "next_written_at": ROW_2["written_at"],
}
# The proposal row 2's summary carries in text (the review tool refused its structured field at the time).
PROPOSAL = {
    "anchors": {"band_temp_low_mid": 62.7, "band_temp_low_sr": 64.5},
    "price": "Low edge only, sunrise and midnight 2 F higher: Therms/day +0.31 / +0.31; kWh/day +0.9 / +0.4",
    "reason": "Nights dried 8 of 100 more for 0.31 therm a day",
}
# crop_band_anchors' house temp_low rows (live-db C.5), as series.ANCHOR_ROWS_SQL returns them.
ANCHOR_ROWS = [
    {"series": "temp_low", "anchor": anchor, "season": "all", "value": value, "current_season": "autumn"}
    for anchor, value in (("sr", 62.5), ("sm", 71.8), ("ss", 70.0), ("mid", 60.7))
]


def local(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 11, day, hour, minute, tzinfo=DENVER).astimezone(UTC)


# ── the ingestor's times ────────────────────────────────────────────────────


def test_the_review_times_are_the_ingestors():
    source = (ROOT / "ingestor/tasks/heartbeat.py").read_text()
    assert re.search(r"^REVIEW_LOCAL_TIME = dtime\(7, 0\)", source, re.M)
    assert re.search(r"^REVIEW_MISSED_LOCAL_TIME = dtime\(10, 0\)", source, re.M)
    assert (reviews.REVIEW_LOCAL_TIME, reviews.REVIEW_MISSED_LOCAL_TIME) == (time(7, 0), time(10, 0))
    assert (reviews.EXPECTED_AFTER, reviews.LATE_AFTER) == ("07:00", "10:00")
    assert 'DAILY_REVIEW_SENSOR = "system.daily_review"' in source and '"alert_type": "daily_review_missed"' in source


# ── the day's review ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "at, review_date",
    [
        (AT, date(2026, 11, 16)),
        (local(16, 23, 30), date(2026, 11, 15)),  # 06:30Z on the 17th is still the 16th in Denver
        (local(17, 0, 5), date(2026, 11, 16)),
    ],
)
def test_the_review_date_is_the_local_day_before(at, review_date):
    assert reviews.review_date_of(at) == review_date


def row(status, kind="daily", minute=0, row_id=1):
    return {"kind": kind, "status": status, "requested_at": local(17, 7, minute), "id": row_id}


@pytest.mark.parametrize(
    "rows, at, status",
    [
        ([], time(6, 59), "not_due"),
        ([], time(7, 0), "due"),
        ([], time(11, 0), "due"),
        ([row("requested")], time(7, 1), "requested"),
        ([row("delivered")], time(7, 1), "delivered"),
        ([row("failed")], time(9, 0), "failed"),
        ([row("failed"), row("delivered", "manual", 30, 3)], time(9, 0), "delivered"),
        ([row("written"), row("requested", "manual", 30, 3)], time(9, 0), "written"),
        ([row("failed"), row("written", "manual", 30, 3)], time(11, 0), "written"),
    ],
)
def test_the_days_status_is_written_else_the_newest_request_else_due_by_the_clock(rows, at, status):
    assert reviews.day_status(rows, at) == status


@pytest.mark.parametrize(
    "missed_open, status, at, missed",
    [
        (False, "failed", time(11, 0), False),
        (True, "failed", time(11, 0), True),
        (True, "due", time(10, 0), True),
        (True, "written", time(11, 0), False),
        # An alert raised for an earlier day is still open: before 10:00 this day is not late yet.
        (True, "not_due", time(6, 0), False),
        (True, "due", time(8, 0), False),
        (True, "failed", time(9, 59), False),
        # From 10:00 the open alert stands for this day too (the ingestor raises no second one while it is open).
        (True, "due", time(10, 30), True),
    ],
)
def test_missed_follows_the_open_alert_from_ten_until_the_day_is_written(missed_open, status, at, missed):
    assert reviews.day_missed(missed_open, status, at) is missed


@pytest.mark.parametrize(
    "has_proposal, answered, next_written_at, state",
    [
        (False, None, None, None),
        (True, False, None, "waiting"),
        (True, True, None, "answered"),
        (True, True, AT, "answered"),
        (True, False, AT, "superseded"),
    ],
)
def test_a_proposal_waits_until_a_band_write_answers_it_or_a_newer_review_supersedes_it(
    has_proposal, answered, next_written_at, state
):
    assert reviews.proposal_state(has_proposal, answered, next_written_at) == state


# ── token use ───────────────────────────────────────────────────────────────


def test_token_use_compares_the_newest_review_with_the_ones_before_it():
    tokens = reviews.token_use([ROW_2["total_tokens"], ROW_1["total_tokens"]])
    assert tokens.model_dump() == {"last": 355128, "mean_7": 185792.0, "mean_30": 185792.0, "rise_pct": 91.1}


def test_token_means_take_seven_and_thirty_reviews_before_the_newest():
    totals = [200, *([100] * 7), *([400] * 23), 9999]
    tokens = reviews.token_use(totals)
    assert tokens.last == 200 and tokens.mean_7 == 100.0
    assert tokens.mean_30 == round((7 * 100 + 23 * 400) / 30, 1)
    assert tokens.rise_pct == 100.0


@pytest.mark.parametrize("totals", [[], [185792]])
def test_token_use_is_null_without_a_review_to_compare(totals):
    tokens = reviews.token_use(totals)
    assert tokens.mean_7 is None and tokens.rise_pct is None
    assert tokens.last == (totals[0] if totals else None)


# ── the proposal ────────────────────────────────────────────────────────────


def test_a_proposal_names_each_row_with_its_words_unit_and_value_now():
    current = band_profile.anchors_from_rows(ANCHOR_ROWS)
    proposal = reviews.proposal_of(json.dumps(PROPOSAL), current)
    assert BandProposal.model_validate(PROPOSAL)  # the stored shape is the schema's
    assert [change.model_dump() for change in proposal.changes] == [
        {"param": "band_temp_low_sr", "label": "Band Temp Low SR", "unit": "°F", "current": 62.5, "proposed": 64.5},
        {"param": "band_temp_low_mid", "label": "Band Temp Low Mid", "unit": "°F", "current": 60.7, "proposed": 62.7},
    ]
    assert proposal.price == PROPOSAL["price"] and proposal.reason == PROPOSAL["reason"]


def test_a_row_the_band_editor_does_not_hold_has_no_current_value():
    proposal = reviews.proposal_of({**PROPOSAL, "anchors": {"zone_vpd_target_center_sr": 1.1}}, {})
    (change,) = proposal.changes
    assert change.current is None and change.unit == "kPa" and change.label == "Zone VPD Target Center SR"


def test_a_stored_proposal_the_schema_no_longer_accepts_is_still_shown():
    stored = {**PROPOSAL, "anchors": {"band_temp_low_sr": 120.0, "band_temp_low_mid": "x"}}
    proposal = reviews.proposal_of(stored, {"band_temp_low_sr": 62.5})
    assert [(change.param, change.proposed, change.current) for change in proposal.changes] == [
        ("band_temp_low_sr", 120.0, 62.5)
    ]


@pytest.mark.parametrize("raw", ["not json", [], {"anchors": {}, "price": "p", "reason": "r"}, {"anchors": {"a": 1}}])
def test_a_proposal_with_no_usable_row_or_price_is_none(raw):
    assert reviews.proposal_of(raw, {}) is None


# ── refusals ────────────────────────────────────────────────────────────────


def test_the_cursor_is_the_last_id_and_a_forged_one_is_refused():
    assert reviews._decode_cursor(reviews._encode_cursor(2)) == 2
    for bad in ("x", reviews._encode_cursor(0), "WyJhIl0", "W3RydWVd"):
        with pytest.raises(ServiceError) as caught:
            reviews._decode_cursor(bad)
        assert caught.value.problem.code == "invalid_request" and caught.value.problem.field == "cursor"


@pytest.mark.parametrize("limit", [0, 61, True, "5"])
def test_limit_is_one_to_sixty(limit):
    with pytest.raises(ServiceError) as caught:
        asyncio.run(reviews.page(Conn({}), limit=limit))
    assert caught.value.problem.code == "invalid_request" and caught.value.problem.max == 60


# ── the reads, against a connection that answers each statement ─────────────


class _Tx:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        self.conn.depth += 1

    async def __aexit__(self, *exc):
        self.conn.depth -= 1
        return False


class Conn:
    def __init__(self, answers):
        self.answers = answers
        self.depth = 0
        self.sent = []

    def is_in_transaction(self):
        return self.depth > 0

    def transaction(self, **kwargs):
        assert kwargs.get("readonly") is True
        return _Tx(self)

    async def fetch(self, sql, *args):
        assert self.depth > 0, "every read runs in its snapshot"
        self.sent.append((sql, args))
        answer = self.answers[sql]
        return answer(*args) if callable(answer) else answer

    async def fetchrow(self, sql, *args):
        rows = await self.fetch(sql, *args)
        return rows[0] if rows else None


def answers(*, at=AT, ready=True, day_rows=None, missed_open=False, newest=ROW_2, answered=False, page=None):
    newest_facts = {
        "missed_open": missed_open,
        "written_id": newest["id"] if newest else None,
        "written_date": newest["review_date"] if newest else None,
        "written_at": newest["written_at"] if newest else None,
        "has_proposal": bool(newest and newest["band_proposal"] is not None),
        "answered": answered,
    }
    rows = page if page is not None else [ROW_2, ROW_1]
    return {
        reviews._READY_SQL: [{"at": at, "ready": ready}],
        reviews._DAY_ROWS_SQL: day_rows if day_rows is not None else [row("written", row_id=2)],
        reviews._DAY_FACTS_SQL: [newest_facts],
        reviews._PAGE_SQL: lambda _gh, _action, before, limit: [
            item for item in rows if before is None or item["id"] < before
        ][:limit],
        reviews._TOKENS_SQL: [{"total_tokens": item["total_tokens"]} for item in rows if item["total_tokens"]],
        series.ANCHOR_ROWS_SQL: ANCHOR_ROWS,
    }


def test_the_page_reads_the_live_reviews_newest_first_in_one_snapshot():
    conn = Conn(answers())
    result = asyncio.run(reviews.page(conn))
    assert [item.id for item in result.items] == [2, 1] and result.next_cursor is None
    first = result.items[0]
    assert (first.kind, first.status, first.total_tokens, first.proposal, first.proposal_state) == (
        "daily",
        "written",
        355128,
        None,
        None,
    )
    assert result.today.model_dump() == {
        "review_date": date(2026, 11, 16),
        "status": "written",
        "missed": False,
        "expected_after": "07:00",
        "late_after": "10:00",
    }
    assert result.tokens.rise_pct == 91.1 and result.proposal_waiting is None
    sent = {sql for sql, _ in conn.sent}
    assert series.ANCHOR_ROWS_SQL not in sent  # no proposal on the page: no anchor read
    (day_args,) = [args for sql, args in conn.sent if sql == reviews._DAY_ROWS_SQL]
    assert day_args == (date(2026, 11, 16),)
    (fact_args,) = [args for sql, args in conn.sent if sql == reviews._DAY_FACTS_SQL]
    assert fact_args == ("vallery", "band.write", "daily_review_missed")


def test_the_page_is_keyset_paged_by_id():
    first = asyncio.run(reviews.page(Conn(answers()), limit=1))
    assert [item.id for item in first.items] == [2] and first.next_cursor is not None
    conn = Conn(answers())
    second = asyncio.run(reviews.page(conn, limit=1, cursor=first.next_cursor))
    assert [item.id for item in second.items] == [1] and second.next_cursor is None
    (page_args,) = [args for sql, args in conn.sent if sql == reviews._PAGE_SQL]
    assert page_args == ("vallery", "band.write", 2, 2)


def test_a_waiting_proposal_is_named_and_carries_its_rows():
    with_proposal = {**ROW_2, "band_proposal": json.dumps(PROPOSAL), "answered": False}
    result = asyncio.run(reviews.page(Conn(answers(newest=with_proposal, page=[with_proposal, ROW_1]))))
    assert result.proposal_waiting.model_dump() == {"review_id": 2, "review_date": date(2026, 11, 16)}
    assert result.items[0].proposal_state == "waiting"
    assert [change.current for change in result.items[0].proposal.changes] == [62.5, 60.7]


def test_an_answered_proposal_waits_no_more():
    with_proposal = {**ROW_2, "band_proposal": json.dumps(PROPOSAL), "answered": True}
    result = asyncio.run(reviews.page(Conn(answers(newest=with_proposal, answered=True, page=[with_proposal]))))
    assert result.proposal_waiting is None and result.items[0].proposal_state == "answered"


def test_a_missed_day_reads_the_open_alert():
    conn = Conn(answers(at=local(18, 10, 30), day_rows=[row("failed")], missed_open=True))
    day = asyncio.run(_today(conn))
    assert (day.review_date, day.status, day.missed) == (date(2026, 11, 17), "failed", True)
    assert day.written_at == ROW_2["written_at"]


def test_before_seven_the_day_is_not_due_and_missed_is_false():
    day = asyncio.run(_today(Conn(answers(at=local(18, 6, 30), day_rows=[]))))
    assert (day.status, day.missed) == ("not_due", False)


@pytest.mark.parametrize(
    ("hour", "minute", "status", "missed"), [(6, 0, "not_due", False), (8, 0, "due", False), (10, 30, "due", True)]
)
def test_yesterdays_open_alert_marks_today_missed_only_from_ten(hour, minute, status, missed):
    # The alert raised for the review of 11-16 is still open on 11-18, and no review of 11-17 exists.
    day = asyncio.run(_today(Conn(answers(at=local(18, hour, minute), day_rows=[], missed_open=True))))
    assert (day.review_date, day.status, day.missed) == (date(2026, 11, 17), status, missed)


async def _today(conn):
    async with _Tx(conn):
        return await reviews.today(conn)


def test_without_the_projection_today_is_none_and_the_page_is_unavailable():
    conn = Conn(answers(ready=False))
    assert asyncio.run(_today(conn)) is None
    with pytest.raises(ServiceError) as caught:
        asyncio.run(reviews.page(Conn(answers(ready=False))))
    assert caught.value.problem.code == "unavailable"


def test_the_reads_never_write_and_read_the_projection_only():
    for name, sql in vars(reviews).items():
        if name.endswith("_SQL"):
            assert not re.search(r"\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b", sql), name
            assert "planner_review" not in sql, name
