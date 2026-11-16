"""Bound replay readback batches to actual climate rows, seeded with each parameter's newest value."""

from __future__ import annotations

import argparse
import csv
from datetime import UTC, datetime
from pathlib import Path


def climate_bounds(path: Path) -> tuple[datetime, datetime] | None:
    first = last = None
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            moment = datetime.fromisoformat(row["ts"].replace("Z", "+00:00"))
            if moment.tzinfo is None or moment.utcoffset() is None:
                raise ValueError("replay climate timestamps require an offset")
            moment = moment.astimezone(UTC)
            if last is not None and moment <= last:
                raise ValueError("replay climate timestamps must increase")
            first = first or moment
            last = moment
    return None if first is None else (first, last)


def query(bounds: tuple[datetime, datetime] | None, *, all_history: bool = False) -> str:
    """Every stored readback batch in the window, each parameter's newest row before it as the seed.

    Readbacks are stored on change (#1662), so a batch holds only what changed: the consumer merges each batch into
    the configuration in force (newest per parameter), and the seed carries every parameter's value at the start. Every
    parameter has an hourly keyframe, so two days of seed lookback hold each one that still exists.
    """
    where = "greenhouse_id = 'vallery' AND band_role IS NULL"  # readbacks only, not the band audit rows
    if all_history:
        return _copy(f"SELECT greenhouse_id, ts, parameter, value FROM setpoint_snapshot WHERE {where}")
    if bounds is None:
        return _copy(f"SELECT greenhouse_id, ts, parameter, value FROM setpoint_snapshot WHERE {where} AND false")
    start, end = bounds
    if any(t.tzinfo is None or t.utcoffset() is None for t in bounds) or end < start:
        raise ValueError("invalid replay timestamp bounds")
    # Canonical datetime output is the only interpolated input.
    start, end = (t.astimezone(UTC).isoformat() for t in bounds)
    return _copy(
        f"""SELECT * FROM (
        SELECT DISTINCT ON (parameter) greenhouse_id, ts, parameter, value FROM setpoint_snapshot
         WHERE {where} AND ts <= TIMESTAMPTZ '{start}' AND ts > TIMESTAMPTZ '{start}' - interval '2 days'
         ORDER BY parameter, ts DESC
    ) AS seed
    UNION ALL
    SELECT greenhouse_id, ts, parameter, value FROM setpoint_snapshot
     WHERE {where} AND ts > TIMESTAMPTZ '{start}' AND ts <= TIMESTAMPTZ '{end}'"""
    )


def _copy(rows: str) -> str:
    return f"""COPY (
    WITH rows AS ({rows})
    SELECT greenhouse_id, ts,
        jsonb_object_agg(parameter, to_jsonb(value) ORDER BY parameter) AS config_payload
    FROM rows
    GROUP BY greenhouse_id, ts
    ORDER BY ts
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\\t', HEADER, NULL '')
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--climate", type=Path, required=True)
    parser.add_argument("--all-history", action="store_true")
    args = parser.parse_args()
    bounds = None if args.all_history else climate_bounds(args.climate)
    print(query(bounds, all_history=args.all_history))


if __name__ == "__main__":
    main()
