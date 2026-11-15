#!/usr/bin/env python3
"""
daily-summary-snapshot.py — Compute and upsert daily climate aggregates.

Complements the ESP32 ingestor which writes cycle counts and runtimes via DAILY_ACCUM_MAP.
This script adds climate min/max/avg and peak demand.
Resource totals/costs are owned by the provenance-gated ingestor path and are
intentionally never written here. Compliance and stress hours are graded by the
database on the served house band (migrations 290/309) and are never written here.

Runs at 00:05 UTC daily via cron (captures the completed day).

Usage:
    daily-summary-snapshot.py              # snapshot yesterday
    daily-summary-snapshot.py --date 2026-03-23   # snapshot a specific date
    daily-summary-snapshot.py --backfill 30        # backfill last N days
"""

import asyncio
import logging
import os
import sys
from datetime import date, datetime, timedelta

import asyncpg

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [daily-snapshot] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


def get_db_url() -> str:
    if dsn := os.environ.get("VERDIFY_DSN"):
        return dsn
    password = os.environ.get("POSTGRES_PASSWORD")
    if not password:
        raise RuntimeError("VERDIFY_DSN or POSTGRES_PASSWORD is required")
    return f"postgresql://verdify:{password}@127.0.0.1:5432/verdify"


async def snapshot_day(conn, target_date: date) -> bool:
    """Compute and upsert daily summary for a single date. Returns True if data found."""

    # Date boundaries in Denver local time converted to UTC-aware datetimes
    from zoneinfo import ZoneInfo

    denver = ZoneInfo("America/Denver")
    day_start = datetime(target_date.year, target_date.month, target_date.day, tzinfo=denver)
    day_end = day_start + timedelta(days=1)

    # ── Climate aggregates ──
    climate = await conn.fetchrow(
        """
        SELECT
            MIN(temp_avg) AS temp_min,
            MAX(temp_avg) AS temp_max,
            ROUND(AVG(temp_avg)::numeric, 1) AS temp_avg,
            MIN(rh_avg) AS rh_min,
            MAX(rh_avg) AS rh_max,
            ROUND(AVG(rh_avg)::numeric, 1) AS rh_avg,
            MIN(vpd_avg) AS vpd_min,
            MAX(vpd_avg) AS vpd_max,
            ROUND(AVG(vpd_avg)::numeric, 2) AS vpd_avg,
            ROUND(AVG(co2_ppm)::numeric, 0) AS co2_avg,
            MIN(outdoor_temp_f) AS outdoor_temp_min,
            MAX(outdoor_temp_f) AS outdoor_temp_max,
            MAX(mister_water_today) AS mister_water_diagnostic
        FROM climate
        WHERE ts >= $1 AND ts < $2
        AND temp_avg IS NOT NULL
    """,
        day_start,
        day_end,
    )

    if not climate or climate["temp_avg"] is None:
        log.warning("No climate data for %s", target_date)
        return False

    # ── Peak demand from Shelly EM ──
    peak_row = await conn.fetchval(
        """
        SELECT ROUND((MAX(watts_total) / 1000.0)::numeric, 2)
        FROM energy WHERE ts >= $1 AND ts < $2
    """,
        day_start,
        day_end,
    )
    peak_kw = float(peak_row) if peak_row else None

    # ── Upsert ──
    await conn.execute(
        """
        INSERT INTO daily_summary (
            date, temp_min, temp_max, temp_avg, rh_min, rh_max, rh_avg,
            vpd_min, vpd_max, vpd_avg, co2_avg,
            outdoor_temp_min, outdoor_temp_max,
            peak_kw, captured_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, now()
        )
        ON CONFLICT (date) DO UPDATE SET
            temp_min = COALESCE(EXCLUDED.temp_min, daily_summary.temp_min),
            temp_max = COALESCE(EXCLUDED.temp_max, daily_summary.temp_max),
            temp_avg = COALESCE(EXCLUDED.temp_avg, daily_summary.temp_avg),
            rh_min = COALESCE(EXCLUDED.rh_min, daily_summary.rh_min),
            rh_max = COALESCE(EXCLUDED.rh_max, daily_summary.rh_max),
            rh_avg = COALESCE(EXCLUDED.rh_avg, daily_summary.rh_avg),
            vpd_min = COALESCE(EXCLUDED.vpd_min, daily_summary.vpd_min),
            vpd_max = COALESCE(EXCLUDED.vpd_max, daily_summary.vpd_max),
            vpd_avg = COALESCE(EXCLUDED.vpd_avg, daily_summary.vpd_avg),
            co2_avg = COALESCE(EXCLUDED.co2_avg, daily_summary.co2_avg),
            outdoor_temp_min = COALESCE(EXCLUDED.outdoor_temp_min, daily_summary.outdoor_temp_min),
            outdoor_temp_max = COALESCE(EXCLUDED.outdoor_temp_max, daily_summary.outdoor_temp_max),
            peak_kw = COALESCE(EXCLUDED.peak_kw, daily_summary.peak_kw),
            captured_at = now()
    """,
        target_date,
        climate["temp_min"],
        climate["temp_max"],
        float(climate["temp_avg"]),
        climate["rh_min"],
        climate["rh_max"],
        float(climate["rh_avg"]),
        climate["vpd_min"],
        climate["vpd_max"],
        float(climate["vpd_avg"]),
        float(climate["co2_avg"]) if climate["co2_avg"] else None,
        climate["outdoor_temp_min"],
        climate["outdoor_temp_max"],
        peak_kw,
    )

    log.info(
        "%s: temp %.0f–%.0f°F, VPD %.1f–%.1f",
        target_date,
        climate["temp_min"] or 0,
        climate["temp_max"] or 0,
        climate["vpd_min"] or 0,
        climate["vpd_max"] or 0,
    )
    return True


async def main():
    conn = await asyncpg.connect(get_db_url())

    try:
        if "--backfill" in sys.argv:
            idx = sys.argv.index("--backfill")
            days = int(sys.argv[idx + 1]) if idx + 1 < len(sys.argv) else 30
            today = date.today()
            count = 0
            for i in range(days, 0, -1):
                d = today - timedelta(days=i)
                if await snapshot_day(conn, d):
                    count += 1
            log.info("Backfill complete: %d/%d days", count, days)

        elif "--date" in sys.argv:
            idx = sys.argv.index("--date")
            target = date.fromisoformat(sys.argv[idx + 1])
            await snapshot_day(conn, target)

        else:
            # Default: snapshot yesterday
            yesterday = date.today() - timedelta(days=1)
            await snapshot_day(conn, yesterday)

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
