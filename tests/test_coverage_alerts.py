"""Alert coverage, host release 2 (contracts/alert-coverage.md): the pure judgements and the guarded cycle.

The SQL runs on a private PostgreSQL in tests/test_dashboard_db_coverage_alerts.py.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INGESTOR_PATH = str(ROOT / "ingestor")
if INGESTOR_PATH not in sys.path:
    sys.path.insert(0, INGESTOR_PATH)

from tasks import alerts  # noqa: E402
from tasks import coverage_alerts as cov  # noqa: E402

from verdify_schemas.alerts import AlertEnvelope  # noqa: E402


def valid(envelope: dict) -> AlertEnvelope:
    env = AlertEnvelope.model_validate(envelope)
    assert env.severity == "warning"
    return env


def relay(equipment, state, age_s):
    return {"equipment": equipment, "state": state, "age_s": age_s}


def test_furnace_with_the_vent_open_for_5_minutes_raises_a_forbidden_pair():
    env = valid(cov.forbidden_pair_alert([relay("heat2", True, 400), relay("vent", True, 310)]))
    assert env.alert_type == "relay_pair_forbidden" and env.details["pairs"] == ["heat2+vent_open"]


def test_a_fan_with_the_vent_closed_raises_and_a_short_overlap_does_not():
    env = valid(cov.forbidden_pair_alert([relay("fan2", True, 320), relay("vent", False, 4000)]))
    assert env.details["pairs"] == ["fan2+vent_closed"]
    # 2026-11-05: fan2 ran 3 min before the vent opened; under the 5-minute hold.
    assert cov.forbidden_pair_alert([relay("fan2", True, 182), relay("vent", False, 4000)]) is None
    assert cov.forbidden_pair_alert([relay("fan1", True, 900), relay("vent", True, 900)]) is None
    assert cov.forbidden_pair_alert([relay("heat2", True, 900), relay("vent", False, 900)]) is None


def test_no_outdoor_source_for_15_minutes_raises():
    env = valid(cov.outdoor_source_alert({"current": "none", "newest_age_s": 30.0, "none_age_s": 960.0}))
    assert env.alert_type == "outdoor_source_none"
    assert cov.outdoor_source_alert({"current": "none", "newest_age_s": 30.0, "none_age_s": 600.0}) is None
    assert cov.outdoor_source_alert({"current": "station", "newest_age_s": 30.0, "none_age_s": None}) is None
    # The controller silent: its own alerts speak; a stale 'none' is not judged.
    assert cov.outdoor_source_alert({"current": "none", "newest_age_s": 1800.0, "none_age_s": 3600.0}) is None


def test_every_wall_probe_silent_with_the_case_sensor_reporting_raises():
    env = valid(cov.case_only_alert({"rows": 10, "wall_rows": 0, "case_rows": 10}))
    assert env.alert_type == "case_sensor_only"
    assert cov.case_only_alert({"rows": 10, "wall_rows": 1, "case_rows": 10}) is None
    assert cov.case_only_alert({"rows": 10, "wall_rows": 0, "case_rows": 0}) is None  # sensor_fault's case
    assert cov.case_only_alert({"rows": 2, "wall_rows": 0, "case_rows": 2}) is None


def test_init_past_300_seconds_of_uptime_is_a_stuck_boot():
    env = valid(cov.boot_stuck_alert({"mode_reason": "init", "uptime_s": 420.0}))
    assert env.alert_type == "boot_stuck"
    assert cov.boot_stuck_alert({"mode_reason": "init", "uptime_s": 60.0}) is None
    assert cov.boot_stuck_alert({"mode_reason": "law", "uptime_s": 4200.0}) is None
    assert cov.boot_stuck_alert({"mode_reason": "init", "uptime_s": None}) is None


def test_a_meter_channel_silent_for_30_minutes_raises():
    env = valid(cov.power_meter_alert({"ch0_age_s": 40.0, "ch1_age_s": 2000.0}))
    assert env.details["channels"] == ["ch1"]
    env = valid(cov.power_meter_alert({"ch0_age_s": None, "ch1_age_s": None}))
    assert env.details["channels"] == ["ch0", "ch1"]
    assert cov.power_meter_alert({"ch0_age_s": 1700.0, "ch1_age_s": 20.0}) is None


def test_yesterdays_record_missing_after_six_raises():
    row = {"after_six": True, "day": date(2026, 11, 15), "record": False, "compliance": True}
    env = valid(cov.daily_record_alert(row))
    assert env.details == {"day": "2026-11-15", "missing": ["record"]}
    assert cov.daily_record_alert({**row, "after_six": False}) is None
    assert cov.daily_record_alert({**row, "record": True}) is None


def test_an_hour_mostly_3_degrees_below_the_band_raises_and_a_mixed_hour_does_not():
    row = {"lo": 70.0, "hi": 83.0, "total": 60, "cold": 58, "hot": 0, "mean_f": 64.2}
    env = valid(cov.temp_band_alert(row))
    assert env.details["side"] == "cold" and env.details["fraction"] == 0.97
    assert cov.temp_band_alert({**row, "cold": 40}) is None
    assert cov.temp_band_alert({**row, "total": 20, "cold": 20}) is None
    assert cov.temp_band_alert({**row, "lo": None}) is None


def test_relay_starts_above_the_rollback_criteria_raise():
    env = valid(cov.relay_starts_alert([{"equipment": "heat1", "starts": 13}, {"equipment": "fog", "starts": 15}]))
    assert env.details["starts"] == {"heat1": 13}
    assert cov.relay_starts_alert([{"equipment": "fog", "starts": 15}, {"equipment": "vent", "starts": 12}]) is None
    assert cov.relay_starts_alert([{"equipment": "fog", "starts": 16}])["details"]["starts"] == {"fog": 16}


def test_one_failing_read_skips_its_alert_keeps_its_type_and_the_rest_still_run():
    class Conn:
        async def fetchrow(self, sql, *args):
            if sql is cov.CASE_ONLY_SQL:
                raise RuntimeError("relation does not exist")
            if sql is cov.BOOT_STUCK_SQL:
                return {"mode_reason": "init", "uptime_s": 900.0}
            return None

        async def fetch(self, sql, *args):
            return []

    found, kept = asyncio.run(cov.coverage_cycle(Conn()))
    assert kept == frozenset({"case_sensor_only"})
    assert [a["alert_type"] for a in found] == ["boot_stuck"]


def test_the_cycle_is_registered_in_the_monitor_and_its_failed_types_kept_open():
    import inspect

    monitor = inspect.getsource(alerts.alert_monitor)
    assert "coverage_alerts, failed = await coverage_cycle(conn)" in monitor
    assert set(cov.COVERAGE_TYPES) == {check[0] for check in cov._CHECKS}


def test_change_only_entities_raise_no_sensor_offline():
    rows = [
        {"sensor_id": "equipment.sntp_status", "type": "equipment", "staleness_ratio": 9.0},
        {"sensor_id": "state.lead_fan", "type": "system_state", "staleness_ratio": 9.0},
        {"sensor_id": "climate.temp_north", "type": "temperature", "staleness_ratio": 3.0},
    ]
    assert [a["sensor_id"] for a in alerts._sensor_offline_alerts(rows)] == ["climate.temp_north"]


def test_soil_dryout_skips_an_offline_probe_and_holds_until_one_point_above_wilt():
    open_rows = [
        {"alert_type": "soil_sensor_offline", "sensor_id": "soil.west"},
        {"alert_type": "soil_dryout", "sensor_id": "soil.south_1.soil_moisture_south_1"},
    ]
    assert cov.soil_probe_offline(open_rows, "soil.west", "soil_moisture_west")
    assert not cov.soil_probe_offline(open_rows, "soil.south_1", "soil_moisture_south_1")
    key = "soil.south_1.soil_moisture_south_1"
    assert cov.soil_dryout_hold(open_rows, key, 20.4, 20.0)  # the 2026-11-02..04 flaps hovered here
    assert not cov.soil_dryout_hold(open_rows, key, 21.0, 20.0)
    assert not cov.soil_dryout_hold(open_rows, "soil.west.soil_moisture_west", 10.0, 20.0)
    assert not cov.soil_dryout_hold(open_rows, key, None, 20.0)
