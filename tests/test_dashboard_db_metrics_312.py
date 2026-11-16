"""Migration 312 and the operator API's compliance and utilities groups on a private database.

The campaign step starts a fresh server for each tests/test_dashboard_db_*.py file and sets
VERDIFY_ISOLATED_TEST_DSN; without it this file skips. The test builds daily_band_compliance (290's table),
daily_record (310's table) and a plain energy table with the meter columns, runs the statements between 312's
$predecessor$ and $successor$ blocks, and then reads the two metric groups as verdify_dashboard_runtime (the operator
API's duty): 312's grants are enough, and energy itself stays unreadable to the duty.
"""

from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

import asyncpg
import pytest

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "api"
if str(API) not in sys.path:
    sys.path.insert(0, str(API))

import product_metrics as pm  # noqa: E402
from test_dashboard_db_band_compliance import private_dsn  # noqa: E402, F401

DUTY = "verdify_dashboard_runtime"


def table(migration: str, name: str) -> str:
    text = (ROOT / "db/migrations" / migration).read_text()
    match = re.search(rf"CREATE TABLE public\.{name} \(.*?\n\);", text, re.S)
    assert match, name
    return match.group(0)


def body_312() -> str:
    source = (ROOT / "db/migrations/312-operator-metrics-reads.sql").read_text()
    return source.split("END $predecessor$;", 1)[1].split("DO $successor$", 1)[0]


SETUP = f"""
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{DUTY}') THEN CREATE ROLE {DUTY} NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO {DUTY};
CREATE TABLE public.greenhouses (id text PRIMARY KEY);
INSERT INTO public.greenhouses VALUES ('vallery');
{table("290-band-compliance.sql", "daily_band_compliance")}
{table("310-daily-record.sql", "daily_record")}
CREATE TABLE public.energy (
    ts timestamptz NOT NULL, watts_total double precision, kwh_today double precision, greenhouse_id text,
    ch0_power_w double precision, ch1_power_w double precision, ch0_source_ts timestamptz,
    ch1_source_ts timestamptz, ch0_entity_id text, ch1_entity_id text, ch0_quality text, ch1_quality text
);
"""

TODAY = "(now() AT TIME ZONE 'America/Denver')::date"
ROWS = f"""
INSERT INTO public.daily_band_compliance (date, definition, graded_min, reconstructed_min,
    temp_graded_min, temp_in_min, temp_below_min, temp_above_min,
    vpd_graded_min, vpd_in_min, vpd_below_min, vpd_above_min, both_graded_min, both_in_min,
    day_temp_graded_min, day_temp_in_min, night_temp_graded_min, night_temp_in_min,
    day_vpd_graded_min, day_vpd_in_min, night_vpd_graded_min, night_vpd_in_min,
    day_both_graded_min, day_both_in_min, night_both_graded_min, night_both_in_min)
VALUES ({TODAY} - 1, 'served', 1440, 0, 1440, 1080, 180, 180, 1440, 720, 360, 360, 1440, 576,
        720, 540, 720, 540, 720, 360, 720, 360, 720, 288, 720, 288),
       ({TODAY}, 'served', 600, 0, 600, 600, 0, 0, 600, 300, 300, 0, 600, 300,
        300, 300, 300, 300, 300, 150, 300, 150, 300, 150, 300, 150),
       ({TODAY} - 2, 'served', 1440, 0, 1440, 0, 1440, 0, 1440, 0, 1440, 0, 1440, 0,
        720, 0, 720, 0, 720, 0, 720, 0, 720, 0, 720, 0);
INSERT INTO public.daily_record (date, complete, kwh_metered, meter_coverage_pct, therms_est, water_gal,
    drying_s, drying_runs, furnace_starts_after_drying)
VALUES ({TODAY} - 1, true, 21.5, 96.0, 1.25, 140.0, 3600, 4, 1),
       ({TODAY} - 2, true, 99.0, 50.0, 9.0, 9.0, 0, 0, 0);
INSERT INTO public.energy (ts, kwh_today, ch0_source_ts, ch1_source_ts, ch0_quality, ch1_quality)
VALUES (now() - interval '2 hours', 1.0, now() - interval '2 hours', now() - interval '2 hours', 'ok', 'ok'),
       (now() - interval '30 seconds', 7.25, now() - interval '40 seconds', now() - interval '20 minutes',
        'ok', 'surprise');
"""


async def scenario(dsn: str) -> tuple[list, list, bool]:
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(SETUP)
        await conn.execute(body_312())
        await conn.execute(ROWS)
        await conn.execute(f"SET ROLE {DUTY}")
        compliance = await pm._collect_compliance(conn, None)
        utilities = await pm._collect_utilities(conn, None)
        try:
            await conn.fetchval("SELECT count(*) FROM public.energy")
            reads_energy = True
        except asyncpg.InsufficientPrivilegeError:
            reads_energy = False
        await conn.execute("RESET ROLE")
        return compliance, utilities, reads_energy
    finally:
        await conn.close()


def values(samples: list) -> dict:
    return {(name, labels): value for name, labels, value in samples}


def test_the_duty_reads_both_groups_through_312s_grants_and_never_energy():
    dsn = private_dsn()
    compliance, utilities, reads_energy = asyncio.run(scenario(dsn))
    assert reads_energy is False

    got = values(compliance)
    ratio = "verdify_band_compliance_ratio"
    assert got[(ratio, (("axis", "temp"), ("window", "yesterday")))] == pytest.approx(0.75)
    assert got[(ratio, (("axis", "vpd"), ("window", "yesterday")))] == pytest.approx(0.5)
    assert got[(ratio, (("axis", "both"), ("window", "yesterday")))] == pytest.approx(0.4)
    assert got[(ratio, (("axis", "temp"), ("window", "today")))] == pytest.approx(1.0)
    assert got[("verdify_band_compliance_graded_minutes", (("axis", "both"), ("window", "today")))] == 600
    # Two days, three axes, two families: the day before yesterday is not read.
    assert len(compliance) == 12

    got = values(utilities)
    assert got[("verdify_utility_yesterday", (("utility", "electric_kwh"),))] == 21.5
    assert got[("verdify_utility_yesterday", (("utility", "gas_therm"),))] == 1.25
    assert got[("verdify_utility_yesterday", (("utility", "water_gal"),))] == 140.0
    assert got[("verdify_meter_coverage_ratio", ())] == pytest.approx(0.96)
    assert got[("verdify_daily_record_complete", ())] == 1.0
    assert got[("verdify_utility_today", (("utility", "electric_kwh"),))] == 7.25
    assert 30 <= got[("verdify_meter_age_seconds", (("meter", "ch0"),))] < 120
    assert 1150 <= got[("verdify_meter_age_seconds", (("meter", "ch1"),))] < 1300
    assert got[("verdify_meter_quality", (("meter", "ch0"), ("quality", "ok")))] == 1
    # An unknown quality maps to other.
    assert got[("verdify_meter_quality", (("meter", "ch1"), ("quality", "other")))] == 1
