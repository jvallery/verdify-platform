"""Gap 17 (contracts/alert-coverage.md): CI tests for four live-path alerts that had none.

temp_safety, safety_invalid, heat_staging_inversion and lighting_cfg_threshold_drift are written inline in
``alert_monitor``. Each test runs the real monitor pass against a scripted connection: every read returns nothing
except the one the alert needs, and the pass's envelopes are taken from ``_sync_monitor_alerts``. Every envelope is
validated as ``AlertEnvelope``. The thresholds and severities pinned here are the ones the owner relies on.
"""

from __future__ import annotations

import asyncio
import contextlib
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INGESTOR_PATH = str(ROOT / "ingestor")
if INGESTOR_PATH not in sys.path:
    sys.path.insert(0, INGESTOR_PATH)

from tasks import alerts  # noqa: E402

from verdify_schemas.alerts import AlertEnvelope  # noqa: E402

NOW = datetime(2026, 11, 16, 18, 0, tzinfo=UTC)


class Conn:
    """fetch/fetchrow answer the first scripted SQL fragment found in the statement; everything else is empty."""

    def __init__(self, rows=None, row=None):
        self.rows, self.row = rows or {}, row or {}

    async def fetch(self, sql, *args):
        return next((v for k, v in self.rows.items() if k in sql), [])

    async def fetchrow(self, sql, *args):
        return next((v for k, v in self.row.items() if k in sql), None)

    async def fetchval(self, sql, *args):
        return None

    async def execute(self, sql, *args):
        return "OK"

    def transaction(self):
        return contextlib.nullcontext()


def monitor_pass(monkeypatch, conn: Conn) -> dict[str, list[dict]]:
    captured: list[dict] = []

    async def sync(_conn, envelopes, *args, **kwargs):
        captured.extend(envelopes)

    class Pool:
        @contextlib.asynccontextmanager
        async def acquire(self):
            yield conn

    monkeypatch.setattr(alerts, "_sync_monitor_alerts", sync)
    asyncio.run(alerts.alert_monitor(Pool()))
    by_type: dict[str, list[dict]] = {}
    for envelope in captured:
        AlertEnvelope.model_validate(envelope)
        by_type.setdefault(envelope["alert_type"], []).append(envelope)
    return by_type


TEMP_SQL = "SELECT ts, temp_avg FROM climate WHERE temp_avg IS NOT NULL AND ts >= now() - interval '10 minutes'"


@pytest.mark.parametrize(
    ("temp_f", "expected"),
    [(39.5, "FREEZE WARNING"), (100.5, "OVERHEAT WARNING"), (40.0, None), (100.0, None), (70.0, None)],
)
def test_temp_safety_pages_below_40_and_above_100(monkeypatch, temp_f, expected):
    got = monitor_pass(monkeypatch, Conn(row={TEMP_SQL: {"ts": NOW, "temp_avg": temp_f}}))
    if expected is None:
        assert "temp_safety" not in got
        return
    (envelope,) = got["temp_safety"]
    assert envelope["severity"] == "critical" and envelope["sensor_id"] == "climate.temp_avg"
    assert envelope["message"].startswith(expected) and envelope["metric_value"] == temp_f


SAFETY_SQL = "FROM setpoint_snapshot\n            WHERE parameter = ANY($1::text[])"


def test_safety_invalid_pages_only_a_missing_rail_value_once_the_rails_are_retired(monkeypatch):
    """The third flash deleted the rails' entities (the law compiles 40 F and 100 F; RULINGS AE7a): their rows have
    no firmware clamp, so an old readback outside the former range no longer pages; a missing value still does."""
    rail = alerts.REGISTRY["safety_min"]
    assert rail.fw_clamp_lo is None and rail.fw_clamp_hi is None
    former_out_of_range = [{"parameter": "safety_min", "value": 0.0}, {"parameter": "safety_max", "value": 95.0}]
    assert "safety_invalid" not in monitor_pass(monkeypatch, Conn(rows={SAFETY_SQL: former_out_of_range}))
    got = monitor_pass(monkeypatch, Conn(rows={SAFETY_SQL: [{"parameter": "safety_min", "value": None}]}))
    (envelope,) = got["safety_invalid"]
    assert envelope["severity"] == "critical" and envelope["sensor_id"] == "setpoint.safety_min"
    assert envelope["details"] == {"parameter": "safety_min", "value": None}


def test_heat_staging_inversion_is_a_warning_from_its_function(monkeypatch):
    row = {
        "heat2_on_since": NOW - timedelta(seconds=90),
        "duration_s": 90.0,
        "temp_avg": 61.2,
        "temp_low": 62.0,
        "d_heat_stage_2": 3.0,
    }
    got = monitor_pass(monkeypatch, Conn(row={"SELECT * FROM fn_heat_staging_inversion()": row}))
    (envelope,) = got["heat_staging_inversion"]
    assert envelope["severity"] == "warning" and envelope["sensor_id"] == "equipment.heat2"
    assert envelope["metric_value"] == 90.0 and envelope["threshold_value"] == 60.0
    assert "heat_staging_inversion" not in monitor_pass(monkeypatch, Conn())


def test_lighting_threshold_drift_pages_a_device_lux_cfg_off_the_policy(monkeypatch):
    rows = [
        {
            "parameter": "gl_main_lux_threshold",
            "light_key": "main",
            "desired": 500.0,
            "observed": 800.0,
            "observed_ts": NOW,
        }
    ]
    got = monitor_pass(monkeypatch, Conn(rows={"FROM fn_lighting_circuit_policy(now(), 'vallery')": rows}))
    (envelope,) = got["lighting_cfg_threshold_drift"]
    # RULINGS Q4: stays critical while lighting thresholds are host-pushed.
    assert envelope["severity"] == "critical" and envelope["sensor_id"] == "system.lighting_lux_threshold"
    assert "lighting_cfg_threshold_drift" not in monitor_pass(monkeypatch, Conn())


def test_the_engine_judging_alerts_are_retired(monkeypatch):
    # RULINGS Q4: vpd_stress, vent_vpd_moisture_gap and vent_moisture_capacity_limit retire with the law; no producer
    # is left, so their open rows (source 'system') resolve on the next pass.
    import inspect

    source = inspect.getsource(alerts.alert_monitor)
    for retired in ("vpd_stress", "vent_vpd_moisture_gap", "vent_moisture_capacity_limit"):
        assert f'"alert_type": "{retired}"' not in source
