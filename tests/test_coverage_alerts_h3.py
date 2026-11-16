"""Host release 3 coverage alerts: the pure judgements and the guarded cycle (contracts/alert-coverage.md, RULINGS Q4).

The SQL runs on a private database in tests/test_dashboard_db_coverage_alerts_h3.py.
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INGESTOR_PATH = str(ROOT / "ingestor")
if INGESTOR_PATH not in sys.path:
    sys.path.insert(0, INGESTOR_PATH)

from tasks import coverage_alerts as cov  # noqa: E402

from verdify_schemas.alerts import ALERT_TYPES, AlertEnvelope  # noqa: E402

T0 = datetime(2026, 11, 16, 18, 0, tzinfo=UTC)
MIN = timedelta(minutes=1)


def law(ts, l_mask):
    return {"entity": "climate_law_state", "ts": ts, "value": json.dumps({"v": 1, "l": l_mask, "dr": "none"})}


def meter(ts, s):
    return {"entity": "climate_drying_meter", "ts": ts, "value": json.dumps({"v": 1, "s": s, "g": 0, "wh": 0, "rw": 0})}


def test_every_h3_type_is_registered_and_validates():
    assert set(cov.H3_TYPES) <= set(ALERT_TYPES)
    assert len(set(cov.H3_TYPES)) == 9


def test_a_drying_run_with_a_flat_meter_and_no_restart_is_a_fault():
    rows = [law(T0 - m * MIN, cov.LAW_RUN_BIT) for m in range(15)]
    rows += [meter(T0 - 14 * MIN, 500), meter(T0 - 9 * MIN, 500), meter(T0 - 2 * MIN, 500)]
    env = cov.drying_meter_alert(rows, [])
    AlertEnvelope.model_validate(env)
    assert env["details"]["stalled_s"] == 720.0 and env["details"]["backsteps"] == {}
    # Growing: no fault. Not running: no fault. A restart inside the span: no fault.
    growing = rows[:15] + [meter(T0 - 14 * MIN, 500), meter(T0 - 2 * MIN, 900)]
    assert cov.drying_meter_alert(growing, []) is None
    idle = [law(T0 - m * MIN, 0) for m in range(15)] + rows[15:]
    assert cov.drying_meter_alert(idle, []) is None
    boot = [{"ts": T0 - 5 * MIN, "uptime_s": 60}]
    assert cov.drying_meter_alert(rows, boot) is None


def test_a_meter_step_back_counts_only_without_a_restart():
    rows = [meter(T0 - 20 * MIN, 900), meter(T0 - 10 * MIN, 100)]
    env = cov.drying_meter_alert(rows, [{"ts": T0 - 9 * MIN, "uptime_s": 7200}])
    assert env["details"]["backsteps"] == {"s": [900, 100]}
    assert cov.drying_meter_alert(rows, [{"ts": T0 - 9 * MIN, "uptime_s": 300}]) is None


def test_reviewer_write_is_critical_and_validates():
    row = {
        "cutover": T0 - 60 * MIN,
        "n": 2,
        "newest": T0,
        "parameters": ["vpd_high", "temp_high"],
        "sources": ["plan"],
    }
    env = cov.reviewer_write_alert(row)
    AlertEnvelope.model_validate(env)
    assert env["severity"] == "critical" and env["details"]["parameters"] == ["temp_high", "vpd_high"]
    assert cov.reviewer_write_alert({**row, "n": 0}) is None
    assert cov.reviewer_write_alert({**row, "cutover": None}) is None


def test_probes_need_most_of_the_half_hour():
    good = {"temp_north": 70, "temp_south": 70.5, "temp_east": 71, "temp_west": 70.2}
    bad = {**good, "temp_west": 76}
    assert cov.probes_alert([bad] * 17 + [good] * 3) is None  # 17 of 20 is under 90 %
    assert cov.probes_alert([bad] * 19) is None  # fewer than 20 judged rows
    env = cov.probes_alert([bad] * 27 + [good] * 3)
    AlertEnvelope.model_validate(env)
    assert env["details"]["off_median"] == ["temp_west"]
    two_probes = {"temp_north": 60, "temp_south": 80, "temp_east": None, "temp_west": None}
    assert cov.probes_alert([two_probes] * 30) is None  # fewer than three probes are not judged


def test_utilities_skip_a_missing_yesterday_and_need_ten_days():
    from datetime import date

    def day(d, therms):
        return {
            "after_six": True,
            "yesterday": date(2026, 11, 15),
            "date": d,
            "kwh_metered_24h": None,
            "therms_est": therms,
            "water_gal": None,
            "meter_coverage_pct": 99.0,
        }

    history = [day(date(2026, 11, 1) + timedelta(days=i), 2.0) for i in range(12)]
    env = cov.utility_alert(history + [day(date(2026, 11, 15), 4.0)])
    AlertEnvelope.model_validate(env)
    assert env["details"]["over"] == {"gas_therm": [4.0, 3.0]}
    assert cov.utility_alert(history) is None  # newest row is not yesterday
    assert cov.utility_alert(history[:5] + [day(date(2026, 11, 15), 4.0)]) is None  # baseline too short


def test_a_failing_read_keeps_only_its_type_open():
    class Conn:
        async def fetchrow(self, sql, *args):
            if sql == cov.REVIEWER_WRITE_SQL:
                raise OSError("boom")
            return None

        async def fetch(self, sql, *args):
            return []

    alerts, failed = asyncio.run(cov.coverage_cycle_h3(Conn()))
    assert alerts == [] and failed == frozenset({"reviewer_wrote_climate"})


def test_the_h3_checks_ride_the_registered_cycle():
    import inspect

    assert "coverage_cycle_h3(conn)" in inspect.getsource(cov.coverage_cycle)
