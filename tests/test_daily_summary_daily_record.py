"""One definition of starts, run time and therms (RULINGS AF4, TEL-F1): daily_summary takes the daily record's.

On 2026-11-06 daily_summary.therms_estimated (6.57) used heat2's raw event hours while daily_record.therms_est (2.30)
used the hours after the lost-OFF repair. Both daily-summary paths now take the six climate relays' run time and
starts and the therms from the stored record, and keep the equipment-state figures on a day it does not cover.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import date
from pathlib import Path

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ingestor"))

from tasks import daily  # noqa: E402

DAY = date(2026, 11, 6)


class Conn:
    def __init__(self, record=None, relays=(), fail=False):
        self.record, self.relays, self.fail = record, list(relays), fail
        self.queries = []

    async def fetchrow(self, query, *args):
        self.queries.append(query)
        if self.fail:
            raise asyncpg.InsufficientPrivilegeError("permission denied for table daily_record")
        assert "FROM daily_record WHERE date = $1" in query and args == (DAY,)
        return self.record

    async def fetch(self, query, *args):
        self.queries.append(query)
        assert "FROM daily_relay_record WHERE date = $1" in query
        assert args[0] == DAY and set(args[1]) == set(daily.DAILY_RECORD_RELAYS)
        return self.relays


def test_a_covered_day_gives_the_repaired_run_time_starts_and_therms():
    conn = Conn(
        {"therms_est": 2.30},
        [{"equipment": "heat2", "run_s": 11051.0, "starts": 16}, {"equipment": "fan1", "run_s": 600.0, "starts": 3}],
    )
    record = asyncio.run(daily._daily_record_day(conn, DAY))
    assert record == daily.DailyRecordDay(relays={"heat2": (11051.0 / 60.0, 16), "fan1": (10.0, 3)}, therms=2.30)


def test_a_covered_day_without_a_gas_figure_stores_no_therms():
    record = asyncio.run(daily._daily_record_day(Conn({"therms_est": None}), DAY))
    assert record == daily.DailyRecordDay(relays={}, therms=None)


def test_a_day_the_record_does_not_cover_or_cannot_read_keeps_todays_figures():
    assert asyncio.run(daily._daily_record_day(Conn(None), DAY)) is None
    assert asyncio.run(daily._daily_record_day(Conn(fail=True), DAY)) is None  # before the 314 grant


def test_both_summary_paths_take_the_record_before_they_compute_energy():
    source = (ROOT / "ingestor/tasks/daily.py").read_text()
    for start, end in (
        ("async def grow_light_daily", "# ── utility_cost monthly roll-up"),
        ("async def _refresh_daily_summary_for_date", "async def daily_summary_live"),
    ):
        block = source[source.index(start) : source.index(end)]
        record_at = block.index("record = await _daily_record_day(conn, ")
        assert record_at < block.index("_runtime_kwh_from_minutes(") < block.index("therms = (")
        assert "record.therms\n" in block and "if record is not None\n" in block
    assert daily.DAILY_RECORD_RELAYS == ("heat1", "heat2", "fan1", "fan2", "vent", "fog")
