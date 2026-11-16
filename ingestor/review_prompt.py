"""The daily review's prompt (climate refactor 5.1, plan section 7).

Pure functions: the ingestor's review task builds the context from the database and renders it here, and
``scripts/planner-dry.py`` renders the same prompt from a fixture with no database and no API call. Iris (Hermes) is
a reviewer: it reads the record and stores ONE review with ``review_write``. It writes no climate value. A review may
propose a band edit and quote its simulated price from the price list below (plan section 5.7); only the owner applies
a band edit, in the dashboard's band editor.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any

REVIEW_PROMPT_VERSION = "review-v1"

# The trigger matrix keeps two entries (plan section 8.3): the daily review and the manual request.
DAILY_REVIEW = "DAILY_REVIEW"
MANUAL = "MANUAL"
REVIEW_EVENT_TYPES = {"daily": DAILY_REVIEW, "manual": MANUAL}

# Plan section 5.7: the simulated price of each band edit, as the difference from the law on today's band.
# Each cell is "model A / model B" (the two thermal models of section 5.1). Year and winter tables.
PRICE_LIST_COLUMNS = (
    "Band edit",
    "Therms/day",
    "kWh/day",
    "Gallons/day",
    "Starts/day",
    "Run hours/day",
    "Both in own band (points)",
    "Nights dried (of 100)",
)
PRICE_LIST_YEAR: tuple[tuple[str, ...], ...] = (
    ("Whole temperature band 2 F lower", "-0.46 / -0.43", "-1.4 / -0.9", "-5 / +13", "+1.2 / +2.7", "+2.1 / +3.7", "-6.1 / -8.9", "-10 / -14"),
    ("Whole temperature band 2 F higher", "+0.62 / +0.58", "+1.8 / +1.1", "+11 / -6", "+0.9 / +1.5", "-0.2 / -2.3", "+3.6 / +6.5", "+9 / +11"),
    ("Band at sunrise 2 F lower", "-0.15 / -0.17", "-0.3 / -0.2", "-5 / -1", "-1.5 / -0.5", "+0.5 / +0.7", "-2.4 / -3.3", "-4 / -7"),
    ("Band at solar noon 2 F lower", "-0.08 / -0.08", "-0.5 / -0.4", "+1 / +6", "+1.0 / +0.4", "+0.4 / +0.8", "-0.4 / -0.5", "-1 / +1"),
    ("Band at sunset 2 F lower", "-0.13 / -0.06", "-0.3 / -0.1", "-1 / +7", "+0.9 / +2.9", "+0.1 / +1.3", "-0.5 / -0.5", "0 / +2"),
    ("Band at solar midnight 2 F lower", "-0.02 / -0.07", "-0.3 / -0.2", "+1 / +2", "+0.7 / +0.1", "+1.3 / +1.2", "-2.8 / -4.5", "-3 / -8"),
    ("Low edge only, solar noon 2 F lower", "-0.08 / -0.08", "-0.8 / -0.8", "-5 / -3", "-1.7 / -0.6", "-0.8 / -0.5", "+0.2 / +0.5", "0 / +1"),
    ("Low edge only, sunset 2 F lower", "-0.13 / -0.06", "-0.5 / -0.4", "-4 / -1", "-1.1 / +2.3", "-0.4 / +0.1", "-0.3 / +0.2", "0 / +2"),
    ("Low edge only, noon and sunset 2 F lower", "-0.23 / -0.15", "-1.3 / -1.1", "-9 / -4", "-2.6 / +1.6", "-1.3 / -0.4", "+0.1 / +0.4", "+1 / +3"),
    ("Low edge only, noon and sunset 4 F lower", "-0.38 / -0.22", "-2.3 / -2.0", "-16 / -6", "-4.1 / +4.1", "-2.1 / -0.2", "-0.2 / +0.8", "+3 / +5"),
    ("Low edge only, sunrise and midnight 2 F higher", "+0.31 / +0.31", "+0.9 / +0.4", "+10 / +4", "+3.7 / +0.1", "+0.7 / -0.6", "+2.1 / +4.5", "+8 / +13"),
    ("High edge only, noon and sunset 2 F higher", "0.00 / 0.00", "-0.3 / -0.5", "-7 / -14", "-3.0 / +1.8", "-0.8 / -1.6", "+0.4 / +1.2", "+1 / 0"),
    ("VPD high edge 0.10 kPa higher, all day", "-0.09 / -0.04", "-0.6 / -0.1", "-20 / -11", "-4.5 / -4.5", "-0.3 / 0.0", "-0.2 / 0.0", "-1 / 0"),
    ("VPD high edge 0.10 kPa higher, noon and sunset", "-0.05 / -0.03", "-0.5 / -0.1", "-14 / -8", "-2.6 / -3.9", "-0.4 / 0.0", "+0.2 / +0.5", "-1 / 0"),
    ("VPD high edge 0.30 kPa higher, sunrise and midnight", "-0.06 / -0.01", "0.0 / -0.1", "-9 / -6", "-2.3 / -0.6", "+0.5 / +0.2", "-1.3 / -0.8", "0 / 0"),
)  # fmt: skip
PRICE_LIST_WINTER: tuple[tuple[str, ...], ...] = (
    ("Whole temperature band 2 F lower", "-0.73 / -0.64", "-2.1 / -1.1", "-23 / -6", "-5.2 / +1.4", "-1.0 / +1.0", "-4.3 / -7.6", "-13 / -23"),
    ("Whole temperature band 2 F higher", "+0.98 / +0.84", "+2.5 / +1.2", "+29 / +15", "+7.3 / -0.3", "+2.7 / +0.1", "+1.8 / +5.0", "+10 / +14"),
    ("Band at sunrise 2 F lower", "-0.24 / -0.24", "-0.1 / +0.2", "-8 / -2", "-2.5 / -1.5", "-0.1 / +0.4", "-1.8 / -3.8", "-6 / -11"),
    ("Band at solar noon 2 F lower", "-0.12 / -0.09", "-1.2 / -0.7", "-8 / -2", "-1.8 / +0.3", "-0.9 / -0.3", "+0.5 / +0.8", "-1 / +1"),
    ("Band at sunset 2 F lower", "-0.21 / -0.09", "-0.5 / -0.4", "-7 / -2", "-1.4 / +4.3", "-0.4 / +0.5", "-0.4 / +0.3", "+1 / +3"),
    ("Band at solar midnight 2 F lower", "-0.05 / -0.13", "-0.5 / -0.3", "0 / 0", "+0.2 / -0.9", "+0.6 / +0.8", "-2.1 / -4.4", "-4 / -13"),
    ("Low edge only, solar noon 2 F lower", "-0.12 / -0.10", "-1.3 / -0.9", "-9 / -4", "-2.4 / -0.8", "-1.2 / -0.6", "+0.6 / +1.0", "-1 / +1"),
    ("Low edge only, sunset 2 F lower", "-0.21 / -0.09", "-0.6 / -0.5", "-7 / -3", "-1.8 / +3.8", "-0.6 / +0.3", "-0.3 / +0.4", "+1 / +3"),
    ("Low edge only, noon and sunset 2 F lower", "-0.34 / -0.20", "-1.9 / -1.4", "-15 / -7", "-4.1 / +2.8", "-1.9 / -0.4", "+0.3 / +1.0", "+2 / +4"),
    ("Low edge only, noon and sunset 4 F lower", "-0.58 / -0.27", "-3.3 / -2.3", "-27 / -9", "-6.2 / +6.7", "-3.1 / +0.1", "+0.2 / +1.7", "+5 / +7"),
    ("Low edge only, sunrise and midnight 2 F higher", "+0.51 / +0.45", "+0.6 / -0.3", "+15 / +5", "+5.1 / -0.2", "+0.6 / -1.1", "+2.7 / +6.4", "+10 / +17"),
    ("High edge only, noon and sunset 2 F higher", "0.00 / 0.00", "-0.1 / -0.1", "0 / -1", "-0.3 / -0.8", "-0.1 / -0.3", "0.0 / +0.1", "0 / 0"),
    ("VPD high edge 0.10 kPa higher, all day", "-0.16 / -0.07", "-1.0 / -0.1", "-28 / -8", "-6.8 / -2.5", "-1.2 / -0.3", "+0.4 / +0.2", "0 / -1"),
    ("VPD high edge 0.10 kPa higher, noon and sunset", "-0.09 / -0.06", "-0.8 / -0.1", "-21 / -7", "-5.0 / -2.4", "-0.9 / -0.2", "+0.3 / +0.2", "0 / -1"),
    ("VPD high edge 0.30 kPa higher, sunrise and midnight", "-0.11 / -0.01", "-0.1 / 0.0", "-11 / -1", "-2.5 / -0.2", "-0.4 / -0.1", "+0.1 / +0.1", "+1 / 0"),
)  # fmt: skip

_ROLE = """You are Iris, the daily reviewer of the Verdify greenhouse (Longmont, Colorado; orchids and tropicals).

The controller runs the climate law on its own. No agent writes a climate value: you have no tool that changes a
setting, a plan or the band, and none is needed. Your job is to read the record and write ONE short review.

What to do on this wake-up:
1. Read the record below (the reviewed day and the seven days before it, the band in force, the law's drying
   record, alerts and the forecast). Use your read tools (history, alerts, irrigation_status, irrigation_history,
   scorecard, forecast, lessons, lessons_search, knowledge_search, the crop reads) only where the record leaves a
   question open.
2. Write the review: what happened, against the band and against the seven days before; what the relay starts,
   run hours, electricity, gas and water say; when drying was wanted and refused, and why; anything that needs the
   owner (a fault, a sensor, a lost OFF event, a stuck line). Plain text, at most 4000 characters, numbers with units.
3. If, and only if, the record supports it, propose ONE band edit: the new values of the band rows it changes and
   the price-list row(s) below that price it, quoted as written, with the season (year or winter). Say what the
   owner gives up for what. Never propose an edit the price list does not price. The owner applies it in the band
   editor or does not; you do not apply it.
4. Store the review with review_write(trigger_id=<the run id below>, summary=..., band_proposal=... or omitted).
   Call it exactly once. A wake-up that ends without review_write is recorded as a failed review.

Irrigation: your irrigation tools stay: irrigation_schedule_set, irrigation_line_set, irrigation_run,
irrigation_stop and irrigation_clear_fault write; irrigation_status, irrigation_schedule and irrigation_history read.
Use a write only for a clear fault in the record (a line that must be stopped, a fault to clear once its cause is
gone), pass trigger_id=<the run id> and planner_instance='local', and say in the review what you did and why.
`manual` means a person holds the item and your write is refused; `check_required` means only a person can record
the line's check; irrigation_stop always works.
Lessons: use lessons_manage to record a lesson the record proves; lessons are your memory between reviews."""


def _fmt(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)


def _table(columns: Sequence[str], rows: Sequence[Sequence[Any]]) -> str:
    lines = ["| " + " | ".join(columns) + " |", "|" + "---|" * len(columns)]
    lines += ["| " + " | ".join(_fmt(cell) for cell in row) + " |" for row in rows]
    return "\n".join(lines)


# The daily record columns shown, in order (v_daily_record, migration 310).
RECORD_COLUMNS = (
    "date",
    "complete",
    "both_in_band_pct",
    "temp_in_band_pct",
    "vpd_in_band_pct",
    "night_dried_out",
    "starts_climate",
    "run_h_climate",
    "heat1_starts",
    "heat1_run_h",
    "heat2_starts",
    "heat2_run_h",
    "fan1_run_h",
    "fan2_run_h",
    "vent_run_h",
    "fog_starts",
    "fog_run_h",
    "starts_misters",
    "run_h_misters",
    "kwh_metered",
    "therms_est",
    "water_gal",
    "drying_h",
    "drying_runs",
    "furnace_starts_after_drying",
    "lost_off_h",
)


def price_list_text() -> str:
    """Plan section 5.7 as two tables."""
    return (
        "Each cell is model A / model B, as the difference from the law on today's band.\n\nYear:\n\n"
        + _table(PRICE_LIST_COLUMNS, PRICE_LIST_YEAR)
        + "\n\nWinter (December to February):\n\n"
        + _table(PRICE_LIST_COLUMNS, PRICE_LIST_WINTER)
    )


def render_context(context: Mapping[str, Any]) -> str:
    """The record as text. ``context`` keys: record (rows of RECORD_COLUMNS, newest first), band (param -> value),
    drying (dr -> minutes wanted and refused; None when the law did not report), drying_meter (latest JSON or None),
    alerts (rows of alert_type, severity, opened, still_open), forecast (rows of day, min_f, max_f, min_rh)."""
    parts = []
    record = context.get("record") or []
    parts.append(
        "## The daily record (newest first)\n\n"
        + (_table(RECORD_COLUMNS, [[row.get(c) for c in RECORD_COLUMNS] for row in record]) if record else "No rows.")
    )
    band = context.get("band") or {}
    parts.append(
        "## The band in force (edge anchors)\n\n"
        + (_table(("row", "value"), sorted(band.items())) if band else "Not available.")
    )
    drying = context.get("drying")
    if drying is None:
        parts.append("## The law's drying record\n\nNot reported (the controller did not report the law's state).")
    else:
        rows = sorted(drying.items(), key=lambda item: -item[1])
        parts.append(
            "## The law's drying record (minutes with drying wanted, by why it did not run; 'none' = it ran)\n\n"
            + (_table(("reason", "minutes"), rows) if rows else "Drying was not wanted.")
            + f"\n\nLatest drying meter: {_fmt(context.get('drying_meter'))}"
        )
    alerts = context.get("alerts") or []
    parts.append(
        "## Alerts opened in the last 24 h\n\n"
        + (_table(("alert_type", "severity", "opened", "still_open"), alerts) if alerts else "None.")
    )
    forecast = context.get("forecast") or []
    parts.append(
        "## Forecast, next 72 h (local days)\n\n"
        + (_table(("day", "min_f", "max_f", "min_rh"), forecast) if forecast else "Not available.")
    )
    return "\n\n".join(parts)


def build_review_prompt(*, run_id: str, kind: str, review_date: date, context: Mapping[str, Any]) -> str:
    """The whole message Hermes receives for one review."""
    event = REVIEW_EVENT_TYPES[kind]
    header = (
        f"# {event}: review of {review_date.isoformat()} (America/Denver)\n\n"
        f"Run id (pass as trigger_id to review_write and to any irrigation write): {run_id}\n"
        f"Prompt version: {REVIEW_PROMPT_VERSION}"
    )
    return "\n\n".join(
        (
            header,
            _ROLE,
            render_context(context),
            "## The band price list (plan section 5.7)\n\n" + price_list_text(),
            f"---\nAudit: trigger_id={run_id} planner_instance='local'. End with review_write.",
        )
    )
