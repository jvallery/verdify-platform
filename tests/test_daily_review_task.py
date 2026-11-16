"""The daily review task (#1659, #1660, climate refactor 5.1) with a fake database and a fake Hermes.

The task requests yesterday's review after 07:00 local, delivers it to Hermes with bounded retries, records the run's
end and usage, fails a review whose run ended without review_write, and raises daily_review_missed after 10:00 until
the review is written. No test reaches a database or a network.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

INGESTOR_PATH = str(Path(__file__).resolve().parents[1] / "ingestor")
if INGESTOR_PATH not in sys.path:
    sys.path.insert(0, INGESTOR_PATH)

for key, value in {
    "DB_USER": "verdify-test",
    "DB_PASSWORD": "not-a-secret",
    "DB_HOST": "127.0.0.1",
    "DB_PORT": "5432",
    "DB_NAME": "verdify-test",
}.items():
    os.environ.setdefault(key, value)

from tasks import heartbeat  # noqa: E402

from verdify_schemas.alerts import AlertEnvelope  # noqa: E402

DENVER = ZoneInfo("America/Denver")
RUN_ID = "11111111-2222-4333-8444-555555555555"


class Conn:
    """Records every statement; answers fetch/fetchrow from queues the test sets."""

    def __init__(self, fetch=None, fetchrow=None):
        self.executed: list[tuple[str, tuple]] = []
        self.fetch_rows = list(fetch or [])
        self.fetchrow_value = fetchrow

    async def execute(self, sql, *args):
        self.executed.append((" ".join(sql.split()), args))
        return "OK"

    async def fetch(self, sql, *args):
        return self.fetch_rows.pop(0) if self.fetch_rows else []

    async def fetchrow(self, sql, *args):
        return self.fetchrow_value


class Pool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        conn = self.conn

        class Acquire:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *exc):
                return False

        return Acquire()


def local(hour, minute=0):
    return datetime(2026, 11, 17, hour, minute, tzinfo=DENVER)


def test_no_daily_row_before_seven_and_yesterdays_row_after():
    conn = Conn()
    asyncio.run(heartbeat._ensure_daily_row(conn, local(6, 59)))
    assert conn.executed == []
    asyncio.run(heartbeat._ensure_daily_row(conn, local(7, 0)))
    ((sql, args),) = conn.executed
    assert "INSERT INTO planner_review" in sql and "ON CONFLICT (review_date) WHERE kind = 'daily' DO NOTHING" in sql
    assert args[1] == date(2026, 11, 16)


def _deliver(monkeypatch, status, hermes_run_id, attempts=0):
    conn = Conn(fetch=[[{"run_id": RUN_ID, "kind": "daily", "review_date": date(2026, 11, 16), "attempts": attempts}]])

    async def context(_conn, review_date):
        assert review_date == date(2026, 11, 16)
        return {}

    posted = []
    monkeypatch.setattr(heartbeat, "gather_review_context", context)
    monkeypatch.setattr(heartbeat, "build_review_prompt", lambda **kw: f"review {kw['run_id']}")
    monkeypatch.setattr(
        heartbeat, "_post_review", lambda run_id, kind, message: posted.append(message) or (status, hermes_run_id)
    )
    asyncio.run(heartbeat._deliver_due(Pool(conn)))
    assert posted == [f"review {RUN_ID}"]
    return conn.executed


def test_an_accepted_delivery_records_the_hermes_run(monkeypatch):
    ((sql, args),) = _deliver(monkeypatch, 202, "run_abc")
    assert "SET status = 'delivered'" in sql
    assert args == (RUN_ID, 1, "run_abc", 202)


def test_a_rejected_delivery_retries_then_fails_with_a_fixed_class(monkeypatch):
    ((sql, args),) = _deliver(monkeypatch, 503, None)
    assert args[:4] == (RUN_ID, 1, 503, "gateway_rejected") and args[4] is False
    ((sql, args),) = _deliver(monkeypatch, 0, None)
    assert args[3] == "gateway_unreachable"
    ((sql, args),) = _deliver(monkeypatch, 0, None, attempts=heartbeat.REVIEW_MAX_ATTEMPTS - 1)
    assert args[3] == "attempts_exhausted" and args[4] is True


def test_a_run_that_ended_without_review_write_fails_and_usage_is_kept(monkeypatch):
    delivered = datetime.now(DENVER) - timedelta(minutes=5)
    rows = [
        {"run_id": RUN_ID, "hermes_run_id": "run_abc", "status": "delivered", "delivered_at": delivered},
    ]
    conn = Conn(fetch=[rows])
    usage = {"input_tokens": 9000, "output_tokens": 800, "total_tokens": 9800}
    monkeypatch.setattr(heartbeat, "_fetch_hermes_run_status", lambda run_id: {"status": "completed", "usage": usage})
    asyncio.run(heartbeat._poll_runs(Pool(conn)))
    ((sql, args),) = conn.executed
    assert "run_finished_at = now()" in sql
    assert "status = CASE WHEN status = 'delivered' THEN 'failed' ELSE status END" in sql
    assert args == (RUN_ID, 9000, 800, 9800, "completed_without_review")


def test_a_delivered_run_with_no_terminal_status_is_lost_after_the_deadline(monkeypatch):
    late = datetime.now(DENVER) - timedelta(minutes=heartbeat.REVIEW_RUN_DEADLINE_MINUTES + 1)
    conn = Conn(fetch=[[{"run_id": RUN_ID, "hermes_run_id": "run_abc", "status": "delivered", "delivered_at": late}]])
    monkeypatch.setattr(heartbeat, "_fetch_hermes_run_status", lambda run_id: {"status": "running"})
    asyncio.run(heartbeat._poll_runs(Pool(conn)))
    ((sql, args),) = conn.executed
    assert "SET status = 'failed', failure = 'hermes_run_failed'" in sql and args == (RUN_ID,)


def test_the_missed_alert_waits_for_ten_and_a_written_review_resolves_it():
    missing = Conn(fetchrow=None)
    asyncio.run(heartbeat._daily_review_alert(missing, local(9, 59)))
    assert missing.executed == []
    asyncio.run(heartbeat._daily_review_alert(missing, local(10, 0)))
    ((sql, args),) = missing.executed
    assert "INSERT INTO alert_log" in sql and args[0] == "daily_review_missed" and args[3] == "system.daily_review"

    written = Conn(fetchrow={"status": "written", "attempts": 1, "failure": None})
    asyncio.run(heartbeat._daily_review_alert(written, local(10, 30)))
    ((sql, args),) = written.executed
    assert "UPDATE alert_log" in sql and "disposition = 'resolved'" in sql and args == ("system.daily_review",)


def test_the_missed_alert_payload_is_a_valid_envelope_with_no_free_text_failure():
    payload = heartbeat.daily_review_missed_alert(
        date(2026, 11, 16), {"status": "failed", "attempts": 6, "failure": "attempts_exhausted"}
    )
    env = AlertEnvelope.model_validate(payload)
    assert env.alert_type == "daily_review_missed"
    assert env.details == {
        "review_date": "2026-11-16",
        "status": "failed",
        "attempts": 6,
        "failure": "attempts_exhausted",
    }
