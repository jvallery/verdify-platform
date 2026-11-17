"""MCP review_write and review_run (#1659, #1661, climate refactor 5.1) against a fake connection.

review_write stores the review on its open row only, validates a band proposal against the band rows and their
registry ranges, and writes no setting, band or plan. review_run inserts one manual request for a day that is not in
the future.
"""

from __future__ import annotations

import asyncio
import inspect
import json
from datetime import date
from types import SimpleNamespace

import pytest
from test_mcp_audience_auth import clean_auth_env, mcp_server, mcp_types  # noqa: F401

RUN_ID = "11111111-2222-4333-8444-555555555555"
IRIS = SimpleNamespace(source="iris")


class Conn:
    def __init__(self, row=None):
        self.row = row
        self.calls: list[tuple[str, tuple]] = []
        self.closed = False

    async def fetchrow(self, sql, *args):
        self.calls.append((" ".join(sql.split()), args))
        return self.row

    async def execute(self, sql, *args):
        self.calls.append((" ".join(sql.split()), args))
        return "INSERT 0 1"

    async def close(self):
        self.closed = True


@pytest.fixture()
def wired(mcp_server, mcp_types, monkeypatch):  # noqa: F811
    holder = {}

    def use(row=None, caller=IRIS):
        conn = Conn(row)

        async def db():
            return conn

        monkeypatch.setattr(mcp_server, "_db", db)
        monkeypatch.setattr(mcp_server, "current_actor", lambda: caller)
        holder["conn"] = conn
        return conn

    return use


def payload(result) -> dict:
    [content] = result.content
    return json.loads(content.text)


def test_review_write_stores_the_review_on_its_open_row_only(mcp_server, wired):  # noqa: F811
    conn = wired(row={"kind": "daily", "review_date": date(2026, 11, 16)})
    proposal = {"anchors": {"band_temp_high_mid": 82.0}, "price": "row 4: +0.6 kWh/day", "reason": "afternoon heat"}
    result = asyncio.run(mcp_server.review_write(trigger_id=RUN_ID, summary="Night VPD held.", band_proposal=proposal))
    assert result.isError is False and conn.closed
    assert payload(result) == {"run_id": RUN_ID, "kind": "daily", "review_date": "2026-11-16", "status": "written"}
    ((sql, args),) = conn.calls
    assert sql.startswith("UPDATE planner_review SET status = 'written'")
    assert "status IN ('requested', 'delivered') AND written_at IS NULL" in sql
    assert args[0] == RUN_ID and json.loads(args[2]) == proposal


def test_review_write_refuses_a_bad_proposal_or_run_id_before_any_write(mcp_server, wired):  # noqa: F811
    conn = wired()
    off_band = {"anchors": {"mister_engage_delay_s": 90.0}, "price": "row 1", "reason": "drier"}
    out_of_range = {"anchors": {"band_temp_high_mid": 120.0}, "price": "row 1", "reason": "hotter"}
    for kwargs in (
        {"trigger_id": "not-a-uuid", "summary": "x"},
        {"trigger_id": RUN_ID, "summary": "x", "band_proposal": off_band},
        {"trigger_id": RUN_ID, "summary": "x", "band_proposal": out_of_range},
    ):
        result = asyncio.run(mcp_server.review_write(**kwargs))
        assert result.isError is True and payload(result)["code"] == "invalid_request", kwargs
    assert conn.calls == []


def test_review_write_stores_a_proposal_that_quotes_its_price_rows_as_a_list(mcp_server, wired):  # noqa: F811
    # The 2026-11-16 review sent `price` as a list of quoted rows and was refused ("Input should be a valid string"),
    # so its proposal survived only in the summary text.
    conn = wired(row={"kind": "daily", "review_date": date(2026, 11, 16)})
    rows = ["Year: Low edge only, sunrise and midnight 2 F higher: Therms/day +0.31 / +0.31", "Winter: row 3"]
    proposal = {"anchors": {"band_temp_low_sr": 64.5, "band_temp_low_mid": 62.7}, "price": rows, "reason": "cold"}
    result = asyncio.run(mcp_server.review_write(trigger_id=RUN_ID, summary="Cold night.", band_proposal=proposal))
    assert result.isError is False
    ((_, args),) = conn.calls
    stored = json.loads(args[2])
    assert stored["price"] == "\n".join(rows)
    assert stored["anchors"] == proposal["anchors"] and stored["reason"] == "cold"


def test_review_write_names_the_rejected_proposal_field(mcp_server, wired):  # noqa: F811
    conn = wired()
    bad_price = {"anchors": {"band_temp_low_sr": 64.5}, "price": {"row": 1}, "reason": "cold"}
    result = asyncio.run(mcp_server.review_write(trigger_id=RUN_ID, summary="x", band_proposal=bad_price))
    assert result.isError is True and conn.calls == []
    assert payload(result)["detail"].startswith("band_proposal.price:")


def test_review_write_answers_not_found_for_a_written_or_unknown_run(mcp_server, wired):  # noqa: F811
    wired(row=None)
    result = asyncio.run(mcp_server.review_write(trigger_id=RUN_ID, summary="Second write."))
    assert result.isError is True and payload(result)["code"] == "not_found"


def test_review_write_touches_only_planner_review(mcp_server):  # noqa: F811
    source = inspect.getsource(mcp_server.review_write) + inspect.getsource(mcp_server.review_run)
    for forbidden in ("desired_state", "setpoint_plan", "plan_journal", "crop_band_anchors", "setpoint_changes"):
        assert forbidden not in source


def test_review_run_requests_one_manual_review_for_yesterday_by_default(mcp_server, wired):  # noqa: F811
    conn = wired()
    result = asyncio.run(mcp_server.review_run())
    body = payload(result)
    assert result.isError is False and body["kind"] == "manual" and body["status"] == "requested"
    ((sql, args),) = conn.calls
    assert sql.startswith("INSERT INTO planner_review") and "'manual'" in sql
    assert args[0] == body["run_id"] and args[2] == "iris"


def test_review_run_refuses_a_future_day_and_an_unresolved_caller(mcp_server, wired):  # noqa: F811
    conn = wired()
    result = asyncio.run(mcp_server.review_run(review_date="2999-01-01"))
    assert result.isError is True and payload(result)["code"] == "invalid_request"
    wired(caller=None)
    result = asyncio.run(mcp_server.review_run())
    assert result.isError is True and payload(result)["code"] == "forbidden"
    assert conn.calls == []
