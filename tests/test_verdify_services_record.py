"""API-32 and API-33 (verdify_services.record), with no database.

Each day's shape from its stored rows, null where nothing is stored, the 7- and 30-day means over complete days, the
window rules and the relay counter check, against a connection that answers each statement from the real rows of
2026-11-17 (daily_record, daily_relay_record through its projection, daily_band_compliance: live-db section C). The
SQL itself runs on the campaign database.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, date, datetime, time, timedelta

import pytest

from verdify_services import law, record
from verdify_services.problems import ServiceError

AT = datetime(2026, 11, 17, 16, 20, tzinfo=UTC)  # 09:20 MST, the live read
TODAY = date(2026, 11, 17)


def d(day: int) -> date:
    return date(2026, 11, day)


# daily_record, 2026-11-10 to 17 (live-db C.1). kwh_metered_24h is null today (31.9 % coverage); the drying meter and
# the refusal record start on the 16th.
_RECORD_COLUMNS = (
    "date complete kwh_metered kwh_metered_24h meter_coverage_pct therms_est water_gal wetting_gal planning_water_gal "
    "house_water_gal water_complete counter_sample_pct drying_s drying_runs furnace_starts_after_drying "
    "drying_water_g drying_heat_wh drying_meter_lower_bound dry_refusal"
).split()
REFUSAL_16 = json.dumps(
    {"wanted_s": 7260, "covered_s": 29696, "refused_s": {"cost": 466, "furnace": 558, "too_cold": 5273}}
)
RECORDS = [
    dict(zip(_RECORD_COLUMNS, values, strict=True))
    for values in (
        (
            d(17),
            False,
            8.25,
            None,
            31.9,
            1.959,
            1.0,
            1.0,
            1.0,
            0.0,
            False,
            91.9,
            129.8,
            1,
            1,
            247.0,
            177.0,
            False,
            None,
        ),
        (
            d(16),
            True,
            20.86,
            25.09,
            83.1,
            2.863,
            46.0,
            6.0,
            44.0,
            2.0,
            False,
            96.7,
            2383.3,
            21,
            13,
            1703.0,
            867.0,
            False,
            REFUSAL_16,
        ),
        (
            d(15),
            True,
            22.25,
            24.73,
            90.0,
            3.126,
            47.0,
            8.0,
            46.0,
            1.0,
            True,
            99.7,
            4614.9,
            29,
            12,
            None,
            None,
            None,
            None,
        ),
        (
            d(14),
            True,
            25.90,
            29.95,
            86.5,
            3.216,
            165.0,
            4.0,
            31.0,
            134.0,
            False,
            98.1,
            2639.4,
            20,
            5,
            None,
            None,
            None,
            None,
        ),
        (
            d(13),
            True,
            27.22,
            29.84,
            91.2,
            2.487,
            33.0,
            2.0,
            33.0,
            0.0,
            True,
            98.9,
            1537.4,
            12,
            7,
            None,
            None,
            None,
            None,
        ),
        (
            d(12),
            True,
            24.98,
            28.75,
            86.9,
            1.837,
            36.0,
            6.0,
            32.0,
            1.0,
            True,
            99.8,
            1065.8,
            9,
            2,
            None,
            None,
            None,
            None,
        ),
        (
            d(11),
            True,
            24.95,
            28.60,
            87.2,
            2.269,
            32.0,
            5.0,
            32.0,
            0.0,
            True,
            99.2,
            1331.7,
            11,
            2,
            None,
            None,
            None,
            None,
        ),
        (
            d(10),
            True,
            28.02,
            31.12,
            90.0,
            2.042,
            31.0,
            1.0,
            31.0,
            0.0,
            False,
            98.9,
            1006.8,
            9,
            4,
            None,
            None,
            None,
            None,
        ),
    )
]

# daily_band_compliance (live-db C.3): (date, graded, temp in/below/above, vpd in/below/above, both, day, night,
# night dry-out minutes, dried out).
_BAND = (
    (d(17), 545, 96.3, 3.7, 0.0, 66.1, 33.9, 0.0, 62.4, 85.2, 54.9, 170, False),
    (d(16), 1410, 92.9, 7.1, 0.0, 81.2, 18.8, 0.0, 79.8, 89.2, 72.8, 255, True),
    (d(15), 1440, 93.8, 6.3, 0.0, 57.3, 42.0, 0.7, 54.5, 74.2, 40.5, 65, False),
    (d(14), 1430, 95.5, 4.5, 0.0, 54.9, 45.1, 0.0, 53.1, 76.7, 36.1, 150, False),
    (d(13), 1440, 98.3, 1.7, 0.0, 60.4, 39.6, 0.0, 60.1, 75.0, 49.4, 105, False),
    (d(12), 1440, 98.3, 1.7, 0.0, 55.6, 44.1, 0.3, 55.2, 76.9, 39.5, 190, False),
    (d(11), 1440, 98.6, 1.4, 0.0, 66.3, 33.7, 0.0, 65.3, 82.8, 52.4, 210, False),
    (d(10), 1435, 96.9, 3.1, 0.0, 63.8, 35.9, 0.3, 62.0, 77.7, 50.6, 120, False),
)
BANDS = [
    {
        "date": day,
        "graded_min": graded,
        "temp_in_band_pct": t_in,
        "temp_below_band_pct": t_below,
        "temp_above_band_pct": t_above,
        "vpd_in_band_pct": v_in,
        "vpd_below_band_pct": v_below,
        "vpd_above_band_pct": v_above,
        "both_in_band_pct": both,
        "both_in_band_day_pct": both_day,
        "both_in_band_night_pct": both_night,
        "night_dryout_min": dryout,
        "night_dried_out": dried,
        "temp_above_full_cooling_min": 0,
    }
    for day, graded, t_in, t_below, t_above, v_in, v_below, v_above, both, both_day, both_night, dryout, dried in _BAND
]

# v_dashboard_relay_day for 2026-11-16 and 17 (live-db C.2): (equipment, starts, run_s, repaired_runs).
_RELAYS_16 = (
    ("heat1", 36, 62828.0, 0),
    ("heat2", 25, 13741.0, 1),
    ("fan1", 10, 2101.0, 1),
    ("fan2", 12, 2161.0, 1),
    ("vent", 22, 4281.0, 2),
    ("fog", 4, 343.0, 0),
    ("drip_wall", 1, 600.0, 0),
    ("drip_center", 0, 0.0, 0),
    ("mister_center", 0, 0.0, 0),
    ("mister_south", 0, 0.0, 0),
    ("mister_west", 0, 0.0, 0),
)
_RELAYS_17 = (
    ("heat1", 14, 25061.0, 0),
    ("heat2", 15, 9405.0, 0),
    ("fan1", 0, 0.0, 0),
    ("fan2", 1, 300.0, 0),
    ("vent", 1, 301.0, 0),
    ("fog", 1, 120.0, 0),
)
RELAYS = [
    {"date": day, "equipment": name, "starts": starts, "run_s": run_s, "repaired_runs": repaired}
    for day, rows in ((d(16), _RELAYS_16), (d(17), _RELAYS_17))
    for name, starts, run_s, repaired in rows
]
# v_daily_scorecard's alert counts (illustrative): a day before the alert history reads null counts.
ALERTS = [
    {"date": d(17), "alerts_critical": 0, "alerts_warning": 2, "alerts_info": 0},
    {"date": d(16), "alerts_critical": 1, "alerts_warning": 9, "alerts_info": 3},
    {"date": date(2026, 10, 19), "alerts_critical": None, "alerts_warning": None, "alerts_info": None},
]


def between(rows):
    def answer(*args):
        first, last = args[-2], args[-1]
        return [row for row in rows if first <= row["date"] <= last]

    return answer


class _Tx:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        self.conn.depth += 1

    async def __aexit__(self, *exc):
        self.conn.depth -= 1
        return False


class Conn:
    def __init__(self, answers, at=AT, law_started=None):
        self.answers = answers
        self.at = at
        self.law_started = law_started
        self.depth = 0
        self.sent = []

    def is_in_transaction(self):
        return self.depth > 0

    def transaction(self, **kwargs):
        assert kwargs.get("readonly") is True
        return _Tx(self)

    async def fetchval(self, sql, *args):
        assert self.depth > 0, "every read runs in its snapshot"
        if sql == record._LAW_STARTED_SQL:
            # The statement buckets in SQL; the campaign's DB test runs it. Here it answers the local day it names.
            assert args == ("vallery", "climate_law_state", law.LAW_RECORDS_FROM)
            self.sent.append((sql, args))
            return self.law_started
        assert sql == "SELECT now()"
        return self.at

    async def fetch(self, sql, *args):
        assert self.depth > 0, "every read runs in its snapshot"
        self.sent.append((sql, args))
        answer = self.answers[sql]
        return answer(*args) if callable(answer) else answer


def edits_between(edits):
    """_BAND_WRITE_DAYS_SQL over activity_log rows at these instants: the distinct America/Denver days in [start, end).
    A bare date stands for local noon that day."""
    instants = [
        edit if isinstance(edit, datetime) else datetime.combine(edit, time(12), tzinfo=record.DENVER) for edit in edits
    ]

    def answer(greenhouse, action, start, end):
        assert (greenhouse, action) == ("vallery", "band.write")
        days = {ts.astimezone(record.DENVER).date() for ts in instants if start <= ts < end}
        return [{"date": day} for day in sorted(days)]

    return answer


def record_conn(at=AT, law_started=None, band_edits=(), rows=None):
    records, bands, relays = rows if rows is not None else (RECORDS, BANDS, RELAYS)
    return Conn(
        {
            record._RECORD_SQL: between(records),
            record._BAND_SQL: between(bands),
            record._RELAYS_SQL: between(relays),
            record._ALERTS_SQL: between(ALERTS),
            record._BAND_WRITE_DAYS_SQL: edits_between(band_edits),
        },
        at,
        law_started,
    )


def read(**kwargs):
    conn = record_conn(
        kwargs.pop("at", AT), kwargs.pop("law_started", None), kwargs.pop("band_edits", ()), kwargs.pop("rows", None)
    )
    return asyncio.run(record.record_days(conn, **kwargs)), conn


def local_noon(day: date) -> datetime:
    return datetime.combine(day, time(12), tzinfo=record.DENVER).astimezone(UTC)


def synthetic(first: date, last: date, incomplete=()):
    """Stored rows for every day from ``first`` to ``last``, each day's figures distinct: (records, bands, relays)."""
    records, bands, relays = [], [], []
    for n in range((last - first).days + 1):
        day = first + timedelta(days=n)
        records.append(
            {
                **dict.fromkeys(_RECORD_COLUMNS),
                "date": day,
                "complete": day not in incomplete,
                "kwh_metered": 20.0 + n,
                "kwh_metered_24h": 21.0 + n,
                "therms_est": 1.0 + n / 10,
                "planning_water_gal": 10.0 + n,
                "drying_s": 360.0 * n,
            }
        )
        bands.append(
            {
                **{column: None for column in BANDS[0]},
                "date": day,
                "both_in_band_pct": 40.0 + n,
                "temp_in_band_pct": 90.0,
                "vpd_in_band_pct": 50.0 + n,
                "night_dried_out": n % 3 == 0,
            }
        )
        relays += [
            {"date": day, "equipment": "heat1", "starts": 10 + n, "run_s": 3600.0 * (1 + n % 5), "repaired_runs": 0},
            {"date": day, "equipment": "heat2", "starts": n % 4, "run_s": 600.0 * (n % 4), "repaired_runs": 0},
        ]
    return records, bands, relays


def days_of(rows, chosen) -> list[record.RecordDay]:
    """The RecordDays of the chosen dates built from the same rows, for the shared mean."""
    records, bands, relays = rows
    return [
        record.record_day(
            day,
            next((row for row in records if row["date"] == day), None),
            next((row for row in bands if row["date"] == day), None),
            [row for row in relays if row["date"] == day],
            None,
        )
        for day in chosen
    ]


def span(first: date, last: date) -> list[date]:
    return [first + timedelta(days=n) for n in range((last - first).days + 1)]


# ── the days ────────────────────────────────────────────────────────────────


def test_the_default_is_the_thirty_days_ending_today_ascending():
    result, conn = read()
    assert (result.from_, result.to) == (date(2026, 10, 19), TODAY)
    assert [day.date for day in result.days] == [date(2026, 10, 19) + timedelta(days=n) for n in range(30)]
    assert result.server_time == AT
    dumped = result.model_dump(mode="json", by_alias=True)
    assert set(dumped) == {"from", "to", "days", "means", "law_started", "baseline", "since_law", "server_time"}
    # No law record yet: no law day and no periods, never empty ones.
    assert (dumped["law_started"], dumped["baseline"], dumped["since_law"]) == (None, None, None)
    # The means need 30 complete days before today: every source is read from 10-18, the alerts only for the window.
    for sql, args in conn.sent:
        if sql == record._LAW_STARTED_SQL:
            continue
        expected = (date(2026, 10, 19), TODAY) if sql == record._ALERTS_SQL else ("vallery", date(2026, 10, 18), TODAY)
        assert args == expected, sql


def test_a_complete_day_has_every_figure_from_its_one_source():
    result, _ = read(from_=d(16), to=d(16))
    (day,) = result.days
    assert day.complete is True
    assert day.band.model_dump() == {
        "both_pct": 79.8,
        "temp_pct": 92.9,
        "vpd_pct": 81.2,
        "both_day_pct": 89.2,
        "both_night_pct": 72.8,
        "temp_below_pct": 7.1,
        "temp_above_pct": 0.0,
        "vpd_below_pct": 18.8,
        "vpd_above_pct": 0.0,
        "graded_min": 1410,
        "night_dryout_min": 255,
        "night_dried": True,
        "above_full_cooling_min": 0,
    }
    assert list(day.relays) == list(record.RECORD_RELAYS)
    assert day.relays["heat2"].model_dump() == {"starts": 25, "run_s": 13741.0, "repaired_runs": 1}
    assert (day.climate_starts, day.climate_run_s) == (109, 85455.0)  # the six climate relays only, drips apart
    assert day.energy.model_dump() == {"kwh": 25.09, "kwh_partial": 20.86, "coverage_pct": 83.1}
    assert day.gas.therms_est == 2.863
    assert day.water.model_dump() == {
        "total_gal": 46.0,
        "crop_gal": 44.0,
        "wetting_gal": 6.0,
        "house_gal": 2.0,
        "complete": False,
    }
    assert day.drying.model_dump() == {
        "seconds": 2383.3,
        "runs": 21,
        "furnace_starts_after": 13,
        "water_g": 1703.0,
        "heat_wh": 867.0,
        "lower_bound": False,
        "wanted_s": 7260.0,
        "refused_s": {"cost": 466.0, "furnace": 558.0, "too_cold": 5273.0},
    }
    assert day.counter_sample_pct == 96.7
    assert day.alerts.model_dump() == {"critical": 1, "warning": 9, "info": 3}


def test_today_is_partial_with_no_24_hour_kwh_and_no_refusal_record():
    result, _ = read(from_=TODAY, to=TODAY)
    (day,) = result.days
    assert day.complete is False
    assert day.energy.model_dump() == {"kwh": None, "kwh_partial": 8.25, "coverage_pct": 31.9}
    assert (day.drying.seconds, day.drying.wanted_s, day.drying.refused_s) == (129.8, None, None)
    assert set(day.relays) == {"heat1", "heat2", "fan1", "fan2", "vent", "fog"}
    assert day.climate_starts == 32


def test_a_day_before_the_meter_and_relay_record_is_null_never_zero():
    result, _ = read(from_=d(15), to=d(15))
    (day,) = result.days
    assert day.relays is None and day.climate_starts is None and day.climate_run_s is None
    assert (day.drying.water_g, day.drying.heat_wh, day.drying.lower_bound) == (None, None, None)
    assert day.alerts is None


def test_a_day_with_no_stored_row_is_null_throughout():
    result, _ = read(from_=date(2026, 10, 19), to=date(2026, 10, 19))
    (day,) = result.days
    assert day.complete is False
    assert (day.band, day.relays, day.drying, day.alerts, day.counter_sample_pct) == (None, None, None, None, None)
    assert day.energy.kwh is None and day.water.complete is None and day.gas.therms_est is None


# ── the means ───────────────────────────────────────────────────────────────


def test_the_means_cover_complete_days_ending_yesterday():
    result, _ = read()
    d7 = result.means.d7
    assert d7.model_dump() == {
        "days": 7,
        "both_pct": 61.4,  # 79.8, 54.5, 53.1, 60.1, 55.2, 65.3, 62.0
        "temp_pct": 96.3,
        "vpd_pct": 62.8,
        "nights_dried": 1,
        "climate_starts": 109.0,  # the relay record exists for the 16th only
        "climate_run_h": 23.74,
        "heat1_run_h": 17.45,
        "heat2_run_h": 3.82,
        "kwh": 28.3,  # kwh_metered_24h of the seven days
        "therms_est": 2.549,
        "crop_gal": 35.6,
        "drying_h": 0.58,
    }
    # Only these seven days are stored, so the 30-day mean covers the same days.
    assert result.means.d30 == d7


def test_the_means_end_on_to_when_to_is_past():
    result, _ = read(from_=d(10), to=d(12))
    assert result.means.d7.days == 3 and result.means.d7.kwh == round((31.12 + 28.60 + 28.75) / 3, 2)


def test_no_complete_day_gives_null_means():
    result, _ = read(from_=date(2026, 10, 1), to=date(2026, 10, 5))
    assert result.means.model_dump() == {"d7": None, "d30": None}


def test_a_window_past_today_lists_days_through_today():
    result, _ = read(from_=d(16), to=d(20))
    assert result.to == d(20) and [day.date for day in result.days] == [d(16), d(17)]
    assert result.means.d7.days == 7


# ── the periods before and since the law ────────────────────────────────────


def test_the_law_started_day_is_read_in_the_snapshot_with_its_fixed_floor():
    result, conn = read(law_started=d(16))
    assert result.law_started == d(16)
    assert (record._LAW_STARTED_SQL, ("vallery", "climate_law_state", law.LAW_RECORDS_FROM)) in conn.sent
    # One statement, bounded below on both sources, each bucketed by its America/Denver day.
    sql = " ".join(record._LAW_STARTED_SQL.split())
    assert "FROM system_state s WHERE s.entity = $2 AND s.ts >= $3::timestamptz ORDER BY s.ts LIMIT 1" in sql
    assert "(s.ts AT TIME ZONE 'America/Denver')::date" in sql
    assert "r.date >= ($3::timestamptz AT TIME ZONE 'America/Denver')::date AND r.dry_refusal IS NOT NULL" in sql
    assert sql.startswith("SELECT LEAST(")
    # Band edits are bucketed by their local day too, inside a bounded ts range.
    edits = " ".join(record._BAND_WRITE_DAYS_SQL.split())
    assert "SELECT DISTINCT (ts AT TIME ZONE 'America/Denver')::date AS date FROM activity_log" in edits
    assert "ts >= $3 AND ts < $4" in edits
    # The floor is a fixed instant before the first law build reached the controller (2026-11-16 22:03Z).
    assert law.LAW_RECORDS_FROM == datetime(2026, 11, 15, tzinfo=UTC)
    assert law.LAW_RECORDS_FROM < datetime(2026, 11, 16, 22, 3, tzinfo=UTC)


def test_the_live_shape_baseline_crosses_the_month_and_the_clock_change_and_since_law_waits():
    # Live on 2026-11-17: the law started on the 16th, so the baseline is 17 October to 15 November and since_law has
    # no ended day yet.
    result, conn = read(law_started=d(16), band_edits=[d(11)])
    assert result.since_law is None
    baseline = result.baseline
    assert (baseline.from_, baseline.to, baseline.excluded_days) == (date(2026, 10, 17), d(15), 1)
    # The five complete stored days of 10 to 15 November less the 11th, through the shared mean.
    assert baseline.means == record.means_of(days_of((RECORDS, BANDS, RELAYS), [d(10), d(12), d(13), d(14), d(15)]))
    assert baseline.means.days == 5
    # The band-edit lookup runs from the baseline's local midnight (MDT) to today's (MST): 31 days and one hour.
    start, end = next(args for sql, args in conn.sent if sql == record._BAND_WRITE_DAYS_SQL)[2:]
    assert start == datetime(2026, 10, 17, tzinfo=record.DENVER) and start.utcoffset() == timedelta(hours=-6)
    assert end == datetime(2026, 11, 17, tzinfo=record.DENVER) and end.utcoffset() == timedelta(hours=-7)
    assert end.astimezone(UTC) - start.astimezone(UTC) == timedelta(days=31, hours=1)
    # Every source is read from the baseline's first day.
    assert [args[1] for sql, args in conn.sent if sql == record._RECORD_SQL] == [date(2026, 10, 17)]
    dumped = result.model_dump(mode="json", by_alias=True)
    assert dumped["baseline"]["from"] == "2026-10-17" and "from_" not in dumped["baseline"]


@pytest.mark.parametrize(
    "law_started, today, baseline, since",
    [
        # A law day on the first of a month: the baseline is the previous month's last 30 days.
        (date(2026, 11, 1), d(17), (date(2026, 10, 2), date(2026, 10, 31)), (d(2), d(16))),
        # since_law crosses the month boundary.
        (date(2026, 10, 30), date(2026, 11, 3), (date(2026, 9, 30), date(2026, 10, 29)), (date(2026, 10, 31), d(2))),
        # Across the turn of the year.
        (
            date(2027, 1, 2),
            date(2027, 1, 5),
            (date(2026, 12, 3), date(2027, 1, 1)),
            (date(2027, 1, 3), date(2027, 1, 4)),
        ),
    ],
)
def test_the_period_bounds_are_calendar_days(law_started, today, baseline, since):
    assert record.period_bounds(law_started, today) == (baseline, since)


def test_band_edit_days_leave_both_periods_by_their_local_day_across_the_clock_change():
    rows = synthetic(date(2026, 10, 1), d(16))
    edits = [
        datetime(2026, 10, 6, 5, 59, tzinfo=UTC),  # 23:59 MDT on 5 October: before the baseline
        datetime(2026, 11, 1, 7, 30, tzinfo=UTC),  # 01:30 MDT on 1 November, before the clocks go back
        datetime(2026, 11, 2, 6, 30, tzinfo=UTC),  # 23:30 MST on 1 November: the same local day, not the 2nd
        local_noon(d(5)),  # the law's own day: in neither period
        datetime(2026, 11, 10, 3, 0, tzinfo=UTC),  # 20:00 MST on 9 November: since the law
        datetime(2026, 11, 17, 8, 0, tzinfo=UTC),  # 01:00 MST today: never read
    ]
    result, conn = read(law_started=d(5), band_edits=edits, rows=rows)
    baseline, since = result.baseline, result.since_law
    assert (baseline.from_, baseline.to, baseline.excluded_days) == (date(2026, 10, 6), d(4), 1)
    assert (since.from_, since.to, since.excluded_days) == (d(6), d(16), 1)
    baseline_days = [day for day in span(date(2026, 10, 6), d(4)) if day != d(1)]
    since_days = [day for day in span(d(6), d(16)) if day != d(9)]
    # The same RecordMeans code path as the window's means, over the same rows.
    assert baseline.means == record.means_of(days_of(rows, baseline_days)) and baseline.means.days == 29
    assert since.means == record.means_of(days_of(rows, since_days)) and since.means.days == 10
    # since_law starts the day after the law's day: the 5th is in neither mean.
    with_law_day = record.means_of(days_of(rows, [d(5), *since_days]))
    assert with_law_day.days == 11 and since.means != with_law_day
    edit_rows = next(sql_args for sql_args in conn.sent if sql_args[0] == record._BAND_WRITE_DAYS_SQL)
    assert edit_rows[1][2:] == (
        datetime(2026, 10, 6, tzinfo=record.DENVER),
        datetime(2026, 11, 17, tzinfo=record.DENVER),
    )


def test_the_window_means_and_a_period_over_the_same_days_agree():
    rows = synthetic(date(2026, 10, 1), d(16))
    # Law day 10 November: since_law is the 11th to the 16th, the six days the 7-day mean also covers but the 10th.
    result, _ = read(law_started=d(10), rows=rows, from_=d(10), to=d(16))
    assert result.since_law.means == record.means_of(days_of(rows, span(d(11), d(16))))
    assert result.means.d7 == record.means_of(days_of(rows, span(d(10), d(16))))


def test_the_periods_do_not_depend_on_the_window():
    rows = synthetic(date(2026, 10, 1), d(16))
    full, _ = read(law_started=d(5), band_edits=[d(1), d(9)], rows=rows)
    for window in ({"from_": d(11), "to": TODAY}, {"from_": d(17), "to": d(17)}, {"from_": d(1), "to": d(3)}):
        narrow, _ = read(law_started=d(5), band_edits=[d(1), d(9)], rows=rows, **window)
        assert (narrow.law_started, narrow.baseline, narrow.since_law) == (d(5), full.baseline, full.since_law)
        assert [day.date for day in narrow.days] == span(window["from_"], window["to"])


def test_since_law_waits_for_a_complete_day_not_only_an_ended_one():
    # The law started on the 15th; the 16th has ended but its record is not stored yet (or not complete): no
    # complete day since the law, so since_law is null, while the baseline is served.
    for rows in (
        synthetic(date(2026, 10, 1), d(15)),
        synthetic(date(2026, 10, 1), d(16), incomplete=[d(16)]),
    ):
        result, _ = read(law_started=d(15), rows=rows)
        assert result.since_law is None
        assert (result.baseline.from_, result.baseline.to, result.baseline.means.days) == (
            date(2026, 10, 16),
            d(14),
            30,
        )
    # Once the 16th is complete, since_law is that one day.
    rows = synthetic(date(2026, 10, 1), d(16))
    result, _ = read(law_started=d(15), rows=rows)
    since = result.since_law
    assert (since.from_, since.to, since.excluded_days) == (d(16), d(16), 0)
    assert since.means == record.means_of(days_of(rows, [d(16)])) and since.means.days == 1


def test_since_law_whose_only_complete_day_was_a_band_edit_has_zero_days_and_null_means():
    # The 16th is complete but the band was changed on it: since_law is served, the day left out and counted.
    rows = synthetic(date(2026, 10, 1), d(16))
    result, _ = read(law_started=d(15), rows=rows, band_edits=[d(16)])
    since = result.since_law
    assert (since.from_, since.to, since.excluded_days) == (d(16), d(16), 1)
    assert since.means.days == 0
    assert {key for key, value in since.means.model_dump().items() if value is not None} == {"days"}


def test_an_old_window_reads_its_own_dates_and_the_periods_dates_and_nothing_between():
    rows = synthetic(date(2025, 11, 1), d(16))
    full, _ = read(law_started=d(5), band_edits=[d(9)], rows=rows)
    result, conn = read(law_started=d(5), band_edits=[d(9)], rows=rows, from_=date(2025, 11, 10), to=date(2025, 11, 16))
    assert [day.date for day in result.days] == span(date(2025, 11, 10), date(2025, 11, 16))
    assert result.means.d7 == record.means_of(days_of(rows, span(date(2025, 11, 10), date(2025, 11, 16))))
    assert (result.baseline, result.since_law) == (full.baseline, full.since_law)
    # Two ranges per source: the window with its means' 30 days, and the baseline's first day through yesterday.
    for sql in (record._RECORD_SQL, record._BAND_SQL, record._RELAYS_SQL):
        assert [args for sent, args in conn.sent if sent == sql] == [
            ("vallery", date(2025, 10, 18), date(2025, 11, 16)),
            ("vallery", date(2026, 10, 6), d(16)),
        ]


@pytest.mark.parametrize(
    "ranges, merged",
    [
        ([(d(1), d(5)), (d(3), d(9))], [(d(1), d(9))]),  # overlapping
        ([(d(6), d(9)), (d(1), d(5))], [(d(1), d(9))]),  # touching, out of order
        ([(d(1), d(3)), (d(5), d(9))], [(d(1), d(3)), (d(5), d(9))]),  # a day apart
        ([(d(1), d(9)), (d(2), d(4))], [(d(1), d(9))]),  # one inside the other
    ],
)
def test_read_ranges_join_only_ranges_that_overlap_or_touch(ranges, merged):
    assert record.read_ranges(*ranges) == merged


def test_since_law_is_null_while_no_day_after_the_law_has_ended():
    for started in (d(16), TODAY):
        result, _ = read(law_started=started)
        assert result.since_law is None
        assert result.baseline.to == started - timedelta(days=1)


def test_a_period_with_no_complete_day_has_zero_days_and_null_means():
    period = record.record_period([], date(2026, 10, 1), date(2026, 10, 30), [date(2026, 10, 3), date(2026, 11, 3)])
    assert period.excluded_days == 1 and period.means.days == 0
    assert {key for key, value in period.means.model_dump().items() if value is not None} == {"days"}
    assert record.record_period([], d(17), d(16), []) is None


def test_no_law_record_means_no_law_day_and_no_periods_and_no_band_edit_lookup():
    result, conn = read(band_edits=[d(11)])
    assert (result.law_started, result.baseline, result.since_law) == (None, None, None)
    assert record._BAND_WRITE_DAYS_SQL not in [sql for sql, _ in conn.sent]
    assert record.law_periods([], None, TODAY, [d(11)]) == (None, None)


# ── refusals ────────────────────────────────────────────────────────────────


def test_from_after_to_is_refused():
    with pytest.raises(ServiceError) as caught:
        read(from_=d(17), to=d(16))
    assert caught.value.problem.code == "invalid_request" and caught.value.problem.field == "from"


def test_a_window_over_400_days_is_too_large():
    read(from_=TODAY - timedelta(days=399), to=TODAY)
    with pytest.raises(ServiceError) as caught:
        read(from_=TODAY - timedelta(days=400), to=TODAY)
    assert caught.value.problem.code == "window_too_large" and caught.value.problem.max == 400


def test_the_reads_never_write_and_read_the_relay_record_through_its_projection():
    for name, sql in vars(record).items():
        if name.endswith("_SQL"):
            assert not re.search(r"\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b", sql), name
            assert not re.search(r"\bdaily_relay_record\b", sql), name
    assert "FROM v_dashboard_relay_day" in record._RELAYS_SQL


# ── API-33 ──────────────────────────────────────────────────────────────────


def check_row(day, equipment, counter, recorded, comparison="complete", boots=0, counter_run=None, record_run=0.0):
    return {
        "date": day,
        "equipment": equipment,
        "counter_starts": counter,
        "record_starts": recorded,
        "starts_difference": None if recorded is None else counter - recorded,
        "counter_run_s": counter_run,
        "record_run_s": record_run,
        "run_s_difference": None if counter_run is None or record_run is None else counter_run - record_run,
        "comparison": comparison,
        "boots": boots,
    }


# 2026-11-16 (live-db C.2): the counters began at 19:48Z, so heat1 reads 11 against the record's 36.
CHECK_ROWS = [
    check_row(d(16), "fog", 2, 4, "partial", 1, record_run=343.0),
    check_row(d(16), "heat1", 11, 36, "partial", 1, record_run=62828.0),
    check_row(d(16), "fan1", 5, 10, "partial", 1, counter_run=1500.0, record_run=2101.0),
    check_row(d(15), "heat1", 30, 30),
    check_row(d(15), "fan1", 4, None, "no_record", counter_run=900.0, record_run=None),
    check_row(d(14), "heat1", 30, 30, "record_early"),
    check_row(d(14), "heat2", 12, 12),
]


def test_the_relay_check_reads_the_days_ending_today():
    conn = Conn({record._RELAY_CHECK_SQL: CHECK_ROWS})
    result = asyncio.run(record.relay_check(conn, days=14))
    assert conn.sent == [(record._RELAY_CHECK_SQL, ("vallery", d(4), TODAY))]
    assert [(day.date, day.comparison, day.boots) for day in result.days] == [
        (d(16), "partial", 1),
        (d(15), "no_record", 0),
        (d(14), "record_early", 0),
    ]
    sixteenth = result.days[0]
    assert [relay.equipment for relay in sixteenth.relays] == ["heat1", "fan1", "fog"]
    assert sixteenth.relays[0].model_dump() == {
        "equipment": "heat1",
        "counter_starts": 11,
        "record_starts": 36,
        "starts_difference": -25,
        "counter_run_s": None,
        "record_run_s": 62828.0,
        "run_s_difference": None,
    }
    assert sixteenth.relays[1].run_s_difference == -601.0
    no_record = result.days[1].relays[1]
    assert (no_record.record_starts, no_record.starts_difference, no_record.record_run_s) == (None, None, None)


@pytest.mark.parametrize("days", [0, 10, 31, True])
def test_the_relay_check_takes_7_14_or_30_days(days):
    with pytest.raises(ServiceError) as caught:
        asyncio.run(record.relay_check(Conn({}), days=days))
    assert caught.value.problem.code == "invalid_request" and caught.value.problem.field == "days"
