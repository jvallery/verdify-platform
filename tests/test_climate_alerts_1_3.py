"""The alerts of the climate refactor's package 1.3 (#1636, #1637, #1638 host part, #1664), as pure functions.

The SQL that feeds them runs on a private PostgreSQL in tests/test_dashboard_db_climate_alerts.py.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alert_lifecycle_harness import AlertLog, load_alert_lifecycle

ROOT = Path(__file__).resolve().parents[1]
INGESTOR_PATH = str(ROOT / "ingestor")
if INGESTOR_PATH not in sys.path:
    sys.path.insert(0, INGESTOR_PATH)

from tasks import alerts  # noqa: E402

from verdify_schemas.alerts import AlertEnvelope  # noqa: E402

T0 = datetime(2026, 11, 16, 12, 0, tzinfo=UTC)
MIN = 60.0


def valid(envelope: dict) -> AlertEnvelope:
    return AlertEnvelope.model_validate(envelope)


# ── #1637: the electric heater against its power meter ─────────────────────


def heat_row(*, heat1_on, heat1_settled=True, heat2_on=False, heat2_settled=True, samples=3, max_w=0.0, min_w=0.0):
    return {
        "heat1_on": heat1_on,
        "heat1_settled": heat1_settled,
        "heat1_since": T0 - timedelta(minutes=20),
        "heat2_on": heat2_on,
        "heat2_settled": heat2_settled,
        "samples": samples,
        "max_w": max_w,
        "min_w": min_w,
    }


def test_relay_on_with_19_watt_samples_for_15_minutes_raises_heat_no_power():
    [alert] = alerts._heat_power_alerts(heat_row(heat1_on=True, max_w=19.0, min_w=18.0))
    env = valid(alert)
    assert (env.alert_type, env.severity, env.sensor_id) == ("heat_no_power", "warning", "equipment.heat1")
    assert env.details["samples"] == 3 and env.details["max_watts"] == 19.0


def test_a_heater_that_draws_its_load_raises_nothing():
    assert alerts._heat_power_alerts(heat_row(heat1_on=True, max_w=1450.0, min_w=1420.0)) == []


def test_relay_on_for_less_than_15_minutes_raises_nothing():
    assert alerts._heat_power_alerts(heat_row(heat1_on=True, heat1_settled=False, max_w=19.0)) == []


def test_1450_watts_with_both_relays_off_raises_heat_manual_override():
    [alert] = alerts._heat_power_alerts(heat_row(heat1_on=False, max_w=1460.0, min_w=1450.0))
    env = valid(alert)
    assert (env.alert_type, env.severity) == ("heat_manual_override", "warning")
    assert env.details == {"watts": 1450, "samples": 3}


def test_a_heater_load_while_the_furnace_is_on_or_just_switched_off_raises_nothing():
    on = heat_row(heat1_on=False, heat2_on=True, max_w=1460.0, min_w=1450.0)
    just_off = heat_row(heat1_on=False, heat1_settled=False, max_w=1460.0, min_w=1450.0)
    assert alerts._heat_power_alerts(on) == [] and alerts._heat_power_alerts(just_off) == []


@pytest.mark.parametrize("samples", [0, 1])
def test_a_frozen_meter_raises_neither(samples):
    # The SQL counts distinct ch1_source_ts inside the window: an unchanged source timestamp counts once or not at all.
    assert alerts._heat_power_alerts(heat_row(heat1_on=True, samples=samples, max_w=19.0, min_w=19.0)) == []
    assert alerts._heat_power_alerts(heat_row(heat1_on=False, samples=samples, max_w=1450.0, min_w=1450.0)) == []


# ── #1636: delivery of a setting stalled ──────────────────────────────────


def stuck(*rows: tuple[str, float]) -> list[dict]:
    return [{"parameter": name, "since": T0 - timedelta(seconds=age), "age_s": age} for name, age in rows]


def test_a_setting_differing_14_minutes_raises_nothing():
    assert alerts._setpoint_delivery_stuck_alert(stuck(("temp_low", 14 * MIN))) is None


def test_16_minutes_of_difference_is_a_warning():
    env = valid(alerts._setpoint_delivery_stuck_alert(stuck(("temp_low", 16 * MIN), ("vpd_low", 2 * MIN))))
    assert (env.alert_type, env.severity, env.sensor_id) == ("setpoint_delivery_stuck", "warning", "dispatcher")
    assert env.details["params"] == ["temp_low"] and env.details["differing"] == 1
    assert env.threshold_value == 15 * MIN


def test_45_minutes_of_difference_is_critical():
    env = valid(alerts._setpoint_delivery_stuck_alert(stuck(("temp_low", 46 * MIN), ("vpd_low", 20 * MIN))))
    assert env.severity == "critical" and env.details["params"] == ["temp_low", "vpd_low"]
    assert env.message == "2 settings not reaching the controller since 11:14 UTC"
    assert env.threshold_value == 45 * MIN


def test_a_lighting_value_whose_readback_differs_45_minutes_is_critical():
    env = valid(alerts._setpoint_delivery_stuck_alert(stuck(("gl_main_sunset_hour", 46 * MIN))))
    assert env.severity == "critical" and env.details["params"] == ["gl_main_sunset_hour"]


def test_the_stuck_alert_lists_at_most_twenty_settings():
    env = valid(alerts._setpoint_delivery_stuck_alert(stuck(*((f"param_{i:02d}", 30 * MIN) for i in range(25)))))
    assert env.details["differing"] == 25 and len(env.details["params"]) == 20


def test_the_monitor_reads_no_dispatcher_memory_and_no_stage_exempts_the_alert():
    source = (ROOT / "ingestor" / "tasks" / "alerts.py").read_text()
    monitor = source[source.index("async def alert_monitor(") : source.index("async def _sync_monitor_alerts(")]
    assert "_setpoint_delivery_cycle(conn)" in monitor
    assert "delivery_differing_since" not in source and "dispatcher_stage" not in source
    assert "held:c1" not in source


def test_a_failed_delivery_read_keeps_an_open_row():
    class Broken:
        async def fetch(self, *_args):
            raise OSError("connection reset")

    assert asyncio.run(alerts._setpoint_delivery_cycle(Broken())) == (None, frozenset({"setpoint_delivery_stuck"}))


def test_an_acknowledged_warning_that_turns_critical_opens_again_so_it_pages():
    ns = load_alert_lifecycle()
    log = AlertLog(T0)
    warning = alerts._setpoint_delivery_stuck_alert(stuck(("temp_low", 16 * MIN)))
    critical = alerts._setpoint_delivery_stuck_alert(stuck(("temp_low", 46 * MIN)))

    def sync(envelope):
        asyncio.run(
            ns["_sync_monitor_alerts"](
                log, [envelope], component_status_available=True, component_closure_resolutions={}, now=log.now
            )
        )

    sync(warning)
    [row] = log.of("setpoint_delivery_stuck", "dispatcher")
    log.acknowledge(row["id"])
    assert row["disposition"] == "acknowledged"
    log.now = T0 + timedelta(minutes=30)
    sync(critical)
    assert row["severity"] == "critical" and row["disposition"] == "open" and row["acknowledged_at"] is not None
    assert row["resolved_at"] is None and len(log.of("setpoint_delivery_stuck", "dispatcher")) == 1


def test_a_plan_with_no_confirmed_write_after_it_raises_plan_not_delivered():
    created = T0 - timedelta(minutes=31)
    env = valid(alerts._plan_not_delivered_alert({"plan_created_at": created, "last_confirmed_at": None}))
    assert (env.alert_type, env.severity) == ("plan_not_delivered", "warning")
    assert env.message.startswith("Iris's plan of 11:29 UTC has not reached the controller")
    assert alerts._plan_not_delivered_alert(None) is None


# ── #1638: the controller's clock ─────────────────────────────────────────


@pytest.mark.parametrize(
    ("offset", "invalid", "raised"),
    [(690.0, False, True), (-50.0, False, False), (-130.0, False, True), (None, True, True), (None, False, False)],
)
def test_clock_offset_and_sync(offset, invalid, raised):
    alert = alerts._clock_unconfirmed_alert({"offset_s": offset, "sntp_invalid_30m": invalid})
    assert (alert is not None) is raised
    if alert is not None:
        env = valid(alert)
        assert (env.alert_type, env.severity) == ("clock_unconfirmed", "critical")


def test_a_690_second_offset_names_the_direction():
    assert alerts._clock_unconfirmed_alert({"offset_s": 690.0, "sntp_invalid_30m": False})["message"] == (
        "The controller's clock is 690 s fast"
    )


# ── #1664: one sensor_offline row per device ──────────────────────────────


def staleness(sensor_id, kind="hydroponic", ratio=4.0):
    return {"sensor_id": sensor_id, "type": kind, "staleness_ratio": ratio}


def test_five_stale_hydro_columns_raise_one_alert():
    columns = ["hydro_ec_us_cm", "hydro_ph", "hydro_orp_mv", "hydro_battery_pct", "hydro_tds_ppm"]
    rows = [staleness(f"climate.{column}") for column in columns]
    [alert] = alerts._sensor_offline_alerts(rows)
    env = valid(alert)
    assert env.sensor_id == "device.hydro_probe"
    assert env.details["columns"] == sorted(f"climate.{column}" for column in columns)


def test_a_stale_soil_column_raises_no_sensor_offline():
    assert alerts._sensor_offline_alerts([staleness("climate.soil_moisture_south_1", "sensor")]) == []


def test_the_diagnostics_share_one_row_and_other_sensors_keep_their_own():
    rows = [
        staleness("diag.heap_bytes", "diagnostic", None),
        staleness("diag.uptime_s", "diagnostic", None),
        staleness("climate.rh_south", "humidity", 3.0),
        staleness("state.mister_state", "state"),
    ]
    out = {alert["sensor_id"]: valid(alert) for alert in alerts._sensor_offline_alerts(rows)}
    assert set(out) == {"device.controller_diagnostics", "climate.rh_south"}
    assert out["device.controller_diagnostics"].details["columns"] == ["diag.heap_bytes", "diag.uptime_s"]
    assert "columns" not in out["climate.rh_south"].details or out["climate.rh_south"].details["columns"] is None


def test_open_per_column_rows_of_a_device_close_as_replaced():
    ns = load_alert_lifecycle()
    log = AlertLog(T0)
    column = log.seed(
        alert_type="sensor_offline",
        sensor_id="climate.hydro_ph",
        category="sensor",
        ts=T0 - timedelta(hours=1),
        message="Sensor `climate.hydro_ph` offline",
        details={"type": "hydroponic", "staleness_ratio": None},
    )
    device = alerts._sensor_offline_alerts([staleness("climate.hydro_ph")])
    asyncio.run(
        ns["_sync_monitor_alerts"](
            log, device, component_status_available=True, component_closure_resolutions={}, now=T0
        )
    )
    assert column["resolution"] == "auto-resolved: replaced by the per-device alert"
    assert [row["resolved_at"] for row in log.of("sensor_offline", "device.hydro_probe")] == [None]
