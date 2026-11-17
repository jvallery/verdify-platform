"""The daily record (API-32) and the relay counter check (API-33).

One row per America/Denver day, as the daily tables store their ``date``. Each figure has one source:

- compliance from ``daily_band_compliance`` (the one grade, migration 290 with 305 and 311);
- starts, run time and repaired runs per relay from ``v_dashboard_relay_day``, migration 320's projection of
  ``daily_relay_record`` (run time after the lost-OFF repair: the one definition of daily run time, 317);
- utilities and drying from ``daily_record`` (310 and 317): ``energy.kwh`` is ``kwh_metered_24h``, null under 70 %
  meter coverage, and ``kwh_partial`` what the meter reported (``kwh_metered``); gas is estimated, not metered;
- alerts raised per severity from ``v_daily_scorecard``.

``means`` are server-computed over complete days only (the day ended and its record is stored): the 7 and 30 days
ending on the newest day that can be complete, ``to`` or yesterday when ``to`` is today, so today's partial day never
shortens them. Each mean covers the complete days on which its figure is known; ``days`` counts the complete days.

``law_started`` is the local day of the first law record (``system_state`` ``climate_law_state``, the record API-31's
``first_record_at`` names). Two periods compare the law with what came before, whatever window is asked for:
``baseline``, the 30 days before ``law_started`` less the days with a band edit (an ``activity_log`` ``band.write``),
and ``since_law``, the days from the day after ``law_started`` through yesterday. Each period's means cover its
complete days, as ``means`` do; the day the law started belongs to neither.

API-33 reads ``v_relay_counter_reconciliation_daily`` (315 and 317): the controller's own relay counters against the
stored record, per day and relay.

Each read is ``async``, takes an asyncpg connection and runs in one read-only snapshot. Nothing here writes.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from datetime import date, datetime, time, timedelta
from typing import Annotated, Any, Literal

import asyncpg
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from verdify_schemas.control_proof import LAW_STATE_ENTITY
from verdify_services import law
from verdify_services.band_profile import ACTION as BAND_WRITE
from verdify_services.problems import ServiceError, problem
from verdify_services.reads import DENVER, GREENHOUSE_ID, _finite, _int_from_query, _snapshot

# fn_daily_record_relays() (310): the eleven relays the record keeps, in the dashboard's order.
RECORD_RELAYS = (
    "heat1",
    "heat2",
    "fan1",
    "fan2",
    "vent",
    "fog",
    "mister_center",
    "mister_south",
    "mister_west",
    "drip_wall",
    "drip_center",
)
# The six climate relays together, as v_daily_record's starts_climate and run_h_climate (317).
CLIMATE_RELAYS = ("heat1", "heat2", "fan1", "fan2", "vent", "fog")
# v_relay_counter_reconciliation_daily's relays (the ones with a firmware counter), in the same order.
COUNTED_RELAYS = CLIMATE_RELAYS
DAYS_DEFAULT = 30
DAYS_MAX = 400
MEAN_DAYS = (7, 30)
BASELINE_DAYS = 30
CHECK_DAYS = (7, 14, 30)
# A day's comparison is its worst relay's: a partial day first, then a missing or early record.
COMPARISON_ORDER = ("partial", "no_record", "record_early", "complete")

Comparison = Literal["partial", "no_record", "record_early", "complete"]
# API-33's ``days``: 7 (default), 14 or 30.
CheckDays = Annotated[Literal[7, 14, 30], BeforeValidator(_int_from_query)]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RelayDay(_Model):
    starts: int
    run_s: float
    repaired_runs: int


class RecordBand(_Model):
    both_pct: float | None
    temp_pct: float | None
    vpd_pct: float | None
    both_day_pct: float | None
    both_night_pct: float | None
    temp_below_pct: float | None
    temp_above_pct: float | None
    vpd_below_pct: float | None
    vpd_above_pct: float | None
    graded_min: int | None
    night_dryout_min: int | None
    night_dried: bool | None
    above_full_cooling_min: int | None


class RecordEnergy(_Model):
    kwh: float | None = Field(description="The 24-hour figure (kwh_metered_24h); null under 70 % meter coverage")
    kwh_partial: float | None = Field(description="What the meter reported (kwh_metered)")
    coverage_pct: float | None


class RecordGas(_Model):
    therms_est: float | None = Field(description="Estimated from furnace run time; gas is not metered")


class RecordWater(_Model):
    total_gal: float | None
    crop_gal: float | None = Field(
        description="daily_record.planning_water_gal: wetting plus wall irrigation and fertigation"
    )
    wetting_gal: float | None
    house_gal: float | None
    complete: bool | None


class RecordDrying(_Model):
    seconds: float | None
    runs: int | None
    furnace_starts_after: int | None
    water_g: float | None
    heat_wh: float | None
    lower_bound: bool | None = Field(description="A restart lost meter counts that day")
    wanted_s: float | None
    refused_s: dict[str, float] | None


class RecordAlerts(_Model):
    critical: int
    warning: int
    info: int


class RecordDay(_Model):
    date: date
    complete: bool
    band: RecordBand | None
    relays: dict[str, RelayDay] | None
    climate_starts: int | None
    climate_run_s: float | None
    energy: RecordEnergy
    gas: RecordGas
    water: RecordWater
    drying: RecordDrying | None
    counter_sample_pct: float | None
    alerts: RecordAlerts | None


class RecordMeans(_Model):
    days: int
    both_pct: float | None
    temp_pct: float | None
    vpd_pct: float | None
    nights_dried: int | None
    climate_starts: float | None
    climate_run_h: float | None
    heat1_run_h: float | None
    heat2_run_h: float | None
    kwh: float | None
    therms_est: float | None
    crop_gal: float | None
    drying_h: float | None


class RecordMeansPair(_Model):
    d7: RecordMeans | None
    d30: RecordMeans | None


class RecordPeriod(_Model):
    """A fixed period's means over its complete days, with how many days it leaves out for band edits."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: date = Field(alias="from")
    to: date
    excluded_days: int
    means: RecordMeans


class DailyRecord(_Model):
    """API-32 ``GET /v1/record/days``: one row per local day, ascending, with the 7- and 30-day means and the periods
    before and since the law."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: date = Field(alias="from")
    to: date
    days: list[RecordDay]
    means: RecordMeansPair
    law_started: date | None
    baseline: RecordPeriod | None
    since_law: RecordPeriod | None
    server_time: datetime


class RelayComparison(_Model):
    equipment: str
    counter_starts: int | None
    record_starts: int | None
    starts_difference: int | None
    counter_run_s: float | None
    record_run_s: float | None
    run_s_difference: float | None


class RelayCheckDay(_Model):
    date: date
    comparison: Comparison
    boots: int | None
    relays: list[RelayComparison]


class RelayCheck(_Model):
    """API-33 ``GET /v1/record/relay-check``: per local day, newest first, the counters against the record."""

    days: list[RelayCheckDay]


# ── SQL (bounded by date; parameters only) ──────────────────────────────────

_RECORD_SQL = """
SELECT date, complete, kwh_metered, kwh_metered_24h, meter_coverage_pct, therms_est, water_gal, wetting_gal,
       planning_water_gal, house_water_gal, water_complete, counter_sample_pct, drying_s, drying_runs,
       furnace_starts_after_drying, dry_refusal, drying_water_g, drying_heat_wh, drying_meter_lower_bound
  FROM daily_record
 WHERE greenhouse_id = $1 AND date >= $2 AND date <= $3
"""

_BAND_SQL = """
SELECT date, both_in_band_pct, temp_in_band_pct, vpd_in_band_pct, both_in_band_day_pct, both_in_band_night_pct,
       temp_below_band_pct, temp_above_band_pct, vpd_below_band_pct, vpd_above_band_pct, graded_min,
       night_dryout_min, night_dried_out, temp_above_full_cooling_min
  FROM daily_band_compliance
 WHERE greenhouse_id = $1 AND date >= $2 AND date <= $3
"""

_RELAYS_SQL = """
SELECT date, equipment, starts, run_s, repaired_runs
  FROM v_dashboard_relay_day
 WHERE greenhouse_id = $1 AND date >= $2 AND date <= $3
"""

# Alert counts only: the scorecard's other columns are not selected, so their subqueries never run.
_ALERTS_SQL = """
SELECT date, alerts_critical, alerts_warning, alerts_info
  FROM v_daily_scorecard
 WHERE date >= $1 AND date <= $2
"""

# The local days with a band edit (API-24's one action) in [$3, $4), on activity_log's (greenhouse_id, ts) index.
_BAND_WRITE_DAYS_SQL = """
SELECT DISTINCT (ts AT TIME ZONE 'America/Denver')::date AS date
  FROM activity_log
 WHERE greenhouse_id = $1 AND action = $2 AND ts >= $3 AND ts < $4
"""

_RELAY_CHECK_SQL = """
SELECT date, equipment, counter_starts, record_starts, starts_difference, counter_run_s, record_run_s,
       run_s_difference, comparison, boots
  FROM v_relay_counter_reconciliation_daily
 WHERE greenhouse_id = $1 AND date >= $2 AND date <= $3
"""


# ── pure rules ──────────────────────────────────────────────────────────────


def window(from_: date | None, to: date | None, today: date) -> tuple[date, date]:
    """API-32's dates: ``to`` defaults to today and ``from`` to 29 days before ``to``; at most 400 days, ``from``
    first."""
    last = to if to is not None else today
    first = from_ if from_ is not None else last - timedelta(days=DAYS_DEFAULT - 1)
    if first > last:
        raise ServiceError(problem("invalid_request", "from must be on or before to", field="from"))
    span = (last - first).days + 1
    if span > DAYS_MAX:
        raise ServiceError(
            problem(
                "window_too_large", f"The window is at most {DAYS_MAX} days", field="from", max=DAYS_MAX, current=span
            )
        )
    return first, last


def means_end(to: date, today: date) -> date:
    """The newest day the means can cover: ``to``, or yesterday when ``to`` is today or later."""
    return min(to, today - timedelta(days=1))


def _int(value: object) -> int | None:
    number = _finite(value)
    return int(number) if number is not None else None


def _json(value: object) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def record_band(row: Mapping[str, Any] | None) -> RecordBand | None:
    if row is None:
        return None
    return RecordBand(
        both_pct=_finite(row["both_in_band_pct"]),
        temp_pct=_finite(row["temp_in_band_pct"]),
        vpd_pct=_finite(row["vpd_in_band_pct"]),
        both_day_pct=_finite(row["both_in_band_day_pct"]),
        both_night_pct=_finite(row["both_in_band_night_pct"]),
        temp_below_pct=_finite(row["temp_below_band_pct"]),
        temp_above_pct=_finite(row["temp_above_band_pct"]),
        vpd_below_pct=_finite(row["vpd_below_band_pct"]),
        vpd_above_pct=_finite(row["vpd_above_band_pct"]),
        graded_min=_int(row["graded_min"]),
        night_dryout_min=_int(row["night_dryout_min"]),
        night_dried=row["night_dried_out"],
        above_full_cooling_min=_int(row["temp_above_full_cooling_min"]),
    )


def record_drying(row: Mapping[str, Any] | None) -> RecordDrying | None:
    """The day's drying: the drying action's time and runs, the drying meter's water and heat, and from the law's
    record (``dry_refusal``, from the law flash on, null for today) the time drying was wanted and refused by reason."""
    if row is None:
        return None
    refusal = _json(row["dry_refusal"])
    wanted = refused = None
    if isinstance(refusal, dict):
        wanted = _finite(refusal.get("wanted_s"))
        stored = refusal.get("refused_s")
        if isinstance(stored, dict):
            refused = {
                str(reason): number for reason, value in stored.items() if (number := _finite(value)) is not None
            }
    return RecordDrying(
        seconds=_finite(row["drying_s"]),
        runs=_int(row["drying_runs"]),
        furnace_starts_after=_int(row["furnace_starts_after_drying"]),
        water_g=_finite(row["drying_water_g"]),
        heat_wh=_finite(row["drying_heat_wh"]),
        lower_bound=row["drying_meter_lower_bound"],
        wanted_s=wanted,
        refused_s=refused,
    )


def record_alerts(row: Mapping[str, Any] | None) -> RecordAlerts | None:
    """The scorecard's counts; null for a day it has no row for or no alert history (its columns are then null)."""
    if row is None:
        return None
    counts = [_int(row[f"alerts_{severity}"]) for severity in ("critical", "warning", "info")]
    if any(count is None for count in counts):
        return None
    critical, warning, info = counts
    return RecordAlerts(critical=critical, warning=warning, info=info)


def record_day(
    day: date,
    record: Mapping[str, Any] | None,
    band: Mapping[str, Any] | None,
    relays: Iterable[Mapping[str, Any]],
    alert_row: Mapping[str, Any] | None,
) -> RecordDay:
    """One day from its stored rows (pure). No row is null, never 0."""
    by_relay = {row["equipment"]: row for row in relays}
    relay_days = {
        name: RelayDay(
            starts=int(by_relay[name]["starts"]),
            run_s=float(by_relay[name]["run_s"]),
            repaired_runs=int(by_relay[name]["repaired_runs"]),
        )
        for name in RECORD_RELAYS
        if name in by_relay
    }
    climate = [relay_days[name] for name in CLIMATE_RELAYS if name in relay_days]

    def value(name: str) -> float | None:
        return _finite(record[name]) if record is not None else None

    return RecordDay(
        date=day,
        complete=bool(record is not None and record["complete"]),
        band=record_band(band),
        relays=relay_days or None,
        climate_starts=sum(item.starts for item in climate) if climate else None,
        climate_run_s=sum(item.run_s for item in climate) if climate else None,
        energy=RecordEnergy(
            kwh=value("kwh_metered_24h"), kwh_partial=value("kwh_metered"), coverage_pct=value("meter_coverage_pct")
        ),
        gas=RecordGas(therms_est=value("therms_est")),
        water=RecordWater(
            total_gal=value("water_gal"),
            crop_gal=value("planning_water_gal"),
            wetting_gal=value("wetting_gal"),
            house_gal=value("house_water_gal"),
            complete=record["water_complete"] if record is not None else None,
        ),
        drying=record_drying(record),
        counter_sample_pct=value("counter_sample_pct"),
        alerts=record_alerts(alert_row),
    )


def _mean(values: Iterable[float | None], digits: int, scale: float = 1.0) -> float | None:
    known = [value / scale for value in values if value is not None]
    return round(sum(known) / len(known), digits) if known else None


def _run_s(day: RecordDay, name: str) -> float | None:
    relay = (day.relays or {}).get(name)
    return relay.run_s if relay is not None else None


def record_means(days: Sequence[RecordDay], end: date, span: int) -> RecordMeans | None:
    """The means over the complete days among the ``span`` days ending on ``end``; null with none (pure)."""
    first = end - timedelta(days=span - 1)
    complete = [day for day in days if day.complete and first <= day.date <= end]
    return means_of(complete) if complete else None


def means_of(complete: Sequence[RecordDay]) -> RecordMeans:
    """The means of these complete days; with none, ``days`` is 0 and every mean null (pure)."""
    dried = [day.band.night_dried for day in complete if day.band is not None and day.band.night_dried is not None]
    return RecordMeans(
        days=len(complete),
        both_pct=_mean((day.band.both_pct if day.band else None for day in complete), 1),
        temp_pct=_mean((day.band.temp_pct if day.band else None for day in complete), 1),
        vpd_pct=_mean((day.band.vpd_pct if day.band else None for day in complete), 1),
        nights_dried=sum(dried) if dried else None,
        climate_starts=_mean((day.climate_starts for day in complete), 1),
        climate_run_h=_mean((day.climate_run_s for day in complete), 2, 3600.0),
        heat1_run_h=_mean((_run_s(day, "heat1") for day in complete), 2, 3600.0),
        heat2_run_h=_mean((_run_s(day, "heat2") for day in complete), 2, 3600.0),
        kwh=_mean((day.energy.kwh for day in complete), 2),
        therms_est=_mean((day.gas.therms_est for day in complete), 3),
        crop_gal=_mean((day.water.crop_gal for day in complete), 1),
        drying_h=_mean((day.drying.seconds if day.drying else None for day in complete), 2, 3600.0),
    )


def record_period(days: Sequence[RecordDay], first: date, last: date, excluded: Iterable[date]) -> RecordPeriod | None:
    """The period ``first`` to ``last``: its means over its complete days that are not ``excluded``; null when it is
    empty (pure)."""
    if first > last:
        return None
    left_out = {day for day in excluded if first <= day <= last}
    complete = [day for day in days if first <= day.date <= last and day.complete and day.date not in left_out]
    return RecordPeriod(from_=first, to=last, excluded_days=len(left_out), means=means_of(complete))


def law_periods(
    days: Sequence[RecordDay], law_started: date | None, today: date, band_edits: Iterable[date]
) -> tuple[RecordPeriod | None, RecordPeriod | None]:
    """``baseline``, the 30 days before ``law_started`` less its band-edit days, and ``since_law``, the day after it
    through yesterday; both null before the first law record (pure)."""
    if law_started is None:
        return None, None
    baseline = record_period(
        days, law_started - timedelta(days=BASELINE_DAYS), law_started - timedelta(days=1), band_edits
    )
    since = record_period(days, law_started + timedelta(days=1), today - timedelta(days=1), ())
    return baseline, since


def _local_midnight(day: date) -> datetime:
    return datetime.combine(day, time(0), tzinfo=DENVER)


def relay_check_days(rows: Iterable[Mapping[str, Any]]) -> list[RelayCheckDay]:
    """API-33's days, newest first, each relay in the counted order; a day's comparison is its worst relay's (pure)."""
    by_day: dict[date, dict[str, Mapping[str, Any]]] = {}
    for row in rows:
        by_day.setdefault(row["date"], {})[row["equipment"]] = row
    out: list[RelayCheckDay] = []
    for day in sorted(by_day, reverse=True):
        relays = by_day[day]
        ordered = [relays[name] for name in COUNTED_RELAYS if name in relays]
        ordered += [relays[name] for name in sorted(relays) if name not in COUNTED_RELAYS]
        comparison = min(
            (row["comparison"] for row in ordered if row["comparison"] in COMPARISON_ORDER),
            key=COMPARISON_ORDER.index,
            default="partial",
        )
        boots = [_int(row["boots"]) for row in ordered if row["boots"] is not None]
        out.append(
            RelayCheckDay(
                date=day,
                comparison=comparison,
                boots=max(boots) if boots else None,
                relays=[
                    RelayComparison(
                        equipment=row["equipment"],
                        counter_starts=_int(row["counter_starts"]),
                        record_starts=_int(row["record_starts"]),
                        starts_difference=_int(row["starts_difference"]),
                        counter_run_s=_finite(row["counter_run_s"]),
                        record_run_s=_finite(row["record_run_s"]),
                        run_s_difference=_finite(row["run_s_difference"]),
                    )
                    for row in ordered
                ],
            )
        )
    return out


# ── reads ───────────────────────────────────────────────────────────────────


async def record_days(conn: asyncpg.Connection, from_: date | None = None, to: date | None = None) -> DailyRecord:
    """API-32 ``GET /v1/record/days``: the local days ``from`` to ``to`` (default the 30 days ending today, at most
    400), days after today left out, with the 7- and 30-day means over complete days and the periods before and since
    the law."""
    async with _snapshot(conn):
        at: datetime = await conn.fetchval("SELECT now()")
        today = at.astimezone(DENVER).date()
        first, last = window(from_, to, today)
        shown_last = min(last, today)
        end = means_end(last, today)
        read_first = min(first, end - timedelta(days=max(MEAN_DAYS) - 1))
        read_last = shown_last
        first_law_at = await conn.fetchval(law.FIRST_RECORD_SQL, LAW_STATE_ENTITY, law.LAW_RECORDS_FROM)
        law_started = first_law_at.astimezone(DENVER).date() if first_law_at is not None else None
        band_edits: list[date] = []
        if law_started is not None:
            baseline_from = law_started - timedelta(days=BASELINE_DAYS)
            read_first = min(read_first, baseline_from)
            read_last = max(read_last, today - timedelta(days=1))
            band_edits = [
                row["date"]
                for row in await conn.fetch(
                    _BAND_WRITE_DAYS_SQL,
                    GREENHOUSE_ID,
                    BAND_WRITE,
                    _local_midnight(baseline_from),
                    _local_midnight(law_started),
                )
            ]
        records = await conn.fetch(_RECORD_SQL, GREENHOUSE_ID, read_first, read_last)
        bands = await conn.fetch(_BAND_SQL, GREENHOUSE_ID, read_first, read_last)
        relays = await conn.fetch(_RELAYS_SQL, GREENHOUSE_ID, read_first, read_last)
        alert_rows = await conn.fetch(_ALERTS_SQL, first, shown_last) if first <= shown_last else []
    record_by = {row["date"]: row for row in records}
    band_by = {row["date"]: row for row in bands}
    alerts_by = {row["date"]: row for row in alert_rows}
    relays_by: dict[date, list[Mapping[str, Any]]] = {}
    for row in relays:
        relays_by.setdefault(row["date"], []).append(row)
    every = [
        record_day(day, record_by.get(day), band_by.get(day), relays_by.get(day, ()), alerts_by.get(day))
        for offset in range((read_last - read_first).days + 1)
        for day in (read_first + timedelta(days=offset),)
    ]
    d7, d30 = (record_means(every, end, span) for span in MEAN_DAYS)
    baseline, since_law = law_periods(every, law_started, today, band_edits)
    return DailyRecord(
        from_=first,
        to=last,
        days=[day for day in every if first <= day.date <= shown_last],
        means=RecordMeansPair(d7=d7, d30=d30),
        law_started=law_started,
        baseline=baseline,
        since_law=since_law,
        server_time=at,
    )


async def relay_check(conn: asyncpg.Connection, days: int = 7) -> RelayCheck:
    """API-33 ``GET /v1/record/relay-check``: the ``days`` local days ending today (7, 14 or 30)."""
    if isinstance(days, bool) or days not in CHECK_DAYS:
        raise ServiceError(problem("invalid_request", "days must be 7, 14 or 30", field="days"))
    async with _snapshot(conn):
        today = (await conn.fetchval("SELECT now()")).astimezone(DENVER).date()
        rows = await conn.fetch(_RELAY_CHECK_SQL, GREENHOUSE_ID, today - timedelta(days=days - 1), today)
    return RelayCheck(days=relay_check_days(rows))
