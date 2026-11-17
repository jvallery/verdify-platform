"""Host release 3 coverage alerts: the pure judgements and the guarded cycle (contracts/alert-coverage.md, RULINGS Q4).

The SQL runs on a private database in tests/test_dashboard_db_coverage_alerts_h3.py.
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import UTC, date, datetime, timedelta
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
    assert len(set(cov.H3_TYPES)) == 13


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
    bad = {**good, "temp_west": 83}
    assert cov.probes_alert([bad] * 17 + [good] * 3) is None  # 17 of 20 is under 90 %
    assert cov.probes_alert([bad] * 19) is None  # fewer than 20 judged rows
    env = cov.probes_alert([bad] * 27 + [good] * 3)
    AlertEnvelope.model_validate(env)
    assert env["details"]["off_median"] == ["temp_west"]
    sun_on_south = {**good, "temp_south": 80.5}  # the unshielded south probe on a sunny morning: 10.5 F
    assert cov.probes_alert([sun_on_south] * 30) is None
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


BLIND = {
    "current": "none",
    "newest_age_s": 120.0,
    "none_age_s": 700.0,
    "diag_rows": 10,
    "diag_unknown": 0,
    "diag_short": 10,
    "fewest": 3,
    "rows": 10,
    "wall_rows": 10,
    "case_rows": 10,
}


def test_no_outdoor_with_a_wall_probe_lost_pages_after_ten_minutes():
    env = cov.outdoor_blind_alert(BLIND)
    AlertEnvelope.model_validate(env)
    assert env["severity"] == "critical" and env["details"]["fewest_wall_probes"] == 3
    assert cov.outdoor_blind_alert({**BLIND, "none_age_s": 500.0}) is None  # not held 10 minutes
    assert cov.outdoor_blind_alert({**BLIND, "diag_short": 9}) is None  # one row had all four walls
    assert cov.outdoor_blind_alert({**BLIND, "current": "intake"}) is None


def test_no_outdoor_with_the_case_probe_only_pages():
    row = {**BLIND, "diag_rows": 0, "diag_short": 0, "fewest": None, "wall_rows": 0}
    env = cov.outdoor_blind_alert(row)
    AlertEnvelope.model_validate(env)
    assert env["details"]["case_only"] is True and env["details"]["fewest_wall_probes"] is None


def test_safeguard_two_opens_nothing_while_a_reading_is_absent_or_unknown():
    assert cov.outdoor_blind_alert({**BLIND, "current": None, "newest_age_s": None, "none_age_s": None}) is None
    assert cov.outdoor_blind_alert({**BLIND, "newest_age_s": 900.0}) is None  # stale: a reconnect
    assert cov.outdoor_blind_alert({**BLIND, "current": "unknown"}) is None
    assert cov.outdoor_blind_alert({**BLIND, "diag_unknown": 1}) is None  # a probe count missing, walls valid
    assert cov.outdoor_blind_alert({**BLIND, "diag_rows": 2, "diag_short": 2}) is None
    intake = {"current": "intake", "newest_age_s": 900.0, "intake_age_s": 4000.0}
    assert cov.intake_only_alert(intake) is None


def test_intake_only_warns_after_half_an_hour():
    row = {"current": "intake", "newest_age_s": 60.0, "intake_age_s": 1900.0}
    env = cov.intake_only_alert(row)
    AlertEnvelope.model_validate(env)
    assert env["severity"] == "warning"
    assert cov.intake_only_alert({**row, "intake_age_s": 1700.0}) is None
    assert cov.intake_only_alert({**row, "current": "station"}) is None


FURNACE = {"known": True, "on_fraction": 0.95, "lo": 58.0, "house": 56.5, "house_rows": 10}


def test_furnace_saturated_warns_only_on_both_legs():
    env = cov.furnace_alert(FURNACE)
    AlertEnvelope.model_validate(env)
    assert env["severity"] == "warning" and env["sensor_id"] == "equipment.heat2"
    assert cov.furnace_alert({**FURNACE, "on_fraction": 0.85}) is None
    assert cov.furnace_alert({**FURNACE, "house": 57.2}) is None  # within 1 F of the band
    assert cov.furnace_alert({**FURNACE, "known": False}) is None
    assert cov.furnace_alert({**FURNACE, "house_rows": 2}) is None  # controller dark
    assert cov.furnace_alert({**FURNACE, "lo": None}) is None


def test_furnace_saturation_links_its_issue():
    import inspect

    assert "issues/1670" in inspect.getsource(cov)


def boot(minutes_ago, before, after, reason="Software reset", uptime=90.0):
    ts = T0 - minutes_ago * MIN
    return {"ts": ts, "boot_ts": ts, "uptime_s": uptime, "fw_before": before, "fw_after": after, "reset_reason": reason}


def test_a_restart_on_the_same_firmware_warns_with_its_reason():
    env = cov.reboot_alert([boot(20, "2026.11.16.a", "2026.11.16.a")])
    AlertEnvelope.model_validate(env)
    assert env["severity"] == "warning" and env["alert_type"] == "esp32_reboot"
    assert env["details"]["reset_reason"] == "Software reset" and env["details"]["restarts_60m"] == 1


def test_three_restarts_in_an_hour_page():
    rows = [boot(m, "v1", "v1", reason=r) for m, r in ((50, "Software reset"), (30, "Task WDT"), (5, "Guru/Panic"))]
    env = cov.reboot_alert(rows)
    AlertEnvelope.model_validate(env)
    assert env["severity"] == "critical" and env["details"]["restarts_60m"] == 3
    assert env["details"]["reset_reason"] == "Guru/Panic"


def test_a_flash_stays_quiet_and_an_unknown_version_waits():
    assert cov.reboot_alert([boot(10, "v1", "v2")]) is None  # a flash
    assert cov.reboot_alert([boot(1, "v1", None)]) is None  # version after the boot not stored yet
    assert cov.reboot_alert([boot(1, None, "v1")]) is None  # nothing stored before it
    assert cov.reboot_alert([]) is None
    # a flash then two same-version restarts: two count, still a warning
    env = cov.reboot_alert([boot(50, "v1", "v2"), boot(30, "v2", "v2"), boot(10, "v2", "v2")])
    assert env["severity"] == "warning" and env["details"]["restarts_60m"] == 2


# ── band_device_db_divergence, law-record branch (OBS-46) ──────────────────────────────────────────────────────────
DB_BAND = {"temp_low": 62.0, "temp_high": 80.0, "vpd_low": 0.60, "vpd_high": 1.20}


def law_band_row(age_s, b, band=None):
    value = json.dumps({"v": 1, "l": 0, "b": b})
    return {"ts": T0 - timedelta(seconds=age_s), "value": value, "age_s": age_s} | (band or DB_BAND)


def test_law_band_is_silent_without_a_law_record():
    assert cov.law_band_alert([]) == (None, False)
    stale = [law_band_row(200 + i, [50.0, 90.0, 0.2, 2.0]) for i in range(3)]
    assert cov.law_band_alert(stale) == (None, False)
    no_band = [{"ts": T0, "value": json.dumps({"v": 1, "l": 0}), "age_s": 10.0} | DB_BAND]
    assert cov.law_band_alert(no_band) == (None, False)


def test_law_band_agreeing_records_judge_and_stay_quiet():
    rows = [law_band_row(10 + 60 * i, [62.4, 79.5, 0.65, 1.15]) for i in range(3)]
    assert cov.law_band_alert(rows) == (None, True)


def test_law_band_opens_only_when_all_three_records_are_off():
    off = [62.0, 82.5, 0.60, 1.20]
    one_off = [law_band_row(10, off), law_band_row(70, [62.0, 80.0, 0.6, 1.2]), law_band_row(130, off)]
    assert cov.law_band_alert(one_off) == (None, True)
    assert cov.law_band_alert([law_band_row(10, off)]) == (None, True)
    rows = [law_band_row(10, off), law_band_row(70, off), law_band_row(130, [62.0, 80.0, 0.6, 1.42])]
    env, present = cov.law_band_alert(rows)
    assert present and env["alert_type"] == "band_device_db_divergence" and env["severity"] == "warning"
    assert env["details"]["max_temp_abs_diff"] == 2.5 and env["details"]["device_age_s"] == 10.0
    AlertEnvelope.model_validate(env)


def test_law_band_vpd_edge_alone_opens():
    rows = [law_band_row(10 + 60 * i, [62.0, 80.0, 0.75, 1.2]) for i in range(3)]
    env, _ = cov.law_band_alert(rows)
    assert env is not None and env["details"]["max_vpd_abs_diff"] == 0.15


# ── relay_counter_mismatch (RULINGS AF7) ────────────────────────────────────────────────────────────────────────────
def recon(equipment, counter_starts, record_starts, counter_run_s=None, record_run_s=None, rows=60):
    run_d = None if counter_run_s is None or record_run_s is None else counter_run_s - record_run_s
    return {
        "date": date(2026, 11, 17),
        "equipment": equipment,
        "counter_starts": counter_starts,
        "record_starts": record_starts,
        "starts_difference": counter_starts - record_starts,
        "counter_run_s": counter_run_s,
        "record_run_s": record_run_s,
        "run_s_difference": run_d,
        "counter_rows": rows,
    }


def test_counter_mismatch_inside_the_tolerance_is_quiet():
    rows = [
        recon("heat1", 12, 10),  # 2 starts: the absolute allowance
        recon("fog", 44, 40),  # 4 of 40: inside 10 %
        recon("fan1", 30, 30, 9000, 7300.0),  # 1700 s: inside 1800 s
        recon("vent", 9, 0, rows=1),  # one counter row: not judged
    ]
    assert cov.counter_mismatch_alerts(rows) == []


def test_a_boot_adds_no_start_allowance():
    # The stored edges carry the ON edge after a boot (RULINGS AF6), so 3 starts over 10 is outside the tolerance.
    assert [a["sensor_id"] for a in cov.counter_mismatch_alerts([recon("heat1", 13, 10)])] == [
        "equipment.heat1.counters.2026-11-17"
    ]


def test_counter_mismatch_warns_once_per_relay_and_day():
    rows = [recon("heat2", 5, 1), recon("fan2", 30, 30, 12000, 9000.0), recon("fog", 3, 3)]
    alerts = cov.counter_mismatch_alerts(rows)
    assert [a["sensor_id"] for a in alerts] == [
        "equipment.heat2.counters.2026-11-17",
        "equipment.fan2.counters.2026-11-17",
    ]
    for env in alerts:
        assert env["severity"] == "warning" and env["alert_type"] == "relay_counter_mismatch"
        AlertEnvelope.model_validate(env)
    assert alerts[0]["metric_value"] == 2.0 and alerts[1]["details"]["counter_run_s"] == 12000


def test_a_failing_counter_read_keeps_only_its_type_open():
    class Conn:
        async def fetchrow(self, sql, *args):
            return None

        async def fetch(self, sql, *args):
            if sql == cov.COUNTER_RECONCILE_SQL:
                raise OSError("no such view")
            return []

    alerts, failed = asyncio.run(cov.coverage_cycle_h3(Conn()))
    assert alerts == [] and failed == frozenset({"relay_counter_mismatch"})
