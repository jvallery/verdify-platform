"""RULINGS AF6 (TEL-F4, RLY-F4): relay edges across a controller boot."""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

INGESTOR_PATH = str(Path(__file__).resolve().parent.parent / "ingestor")
if INGESTOR_PATH not in sys.path:
    sys.path.insert(0, INGESTOR_PATH)
for key, value in (("DB_USER", "test"), ("DB_PASSWORD", "test"), ("DB_HOST", "127.0.0.1"), ("DB_PORT", "5432")):
    os.environ.setdefault(key, value)
os.environ.setdefault("DB_NAME", "test")

import ingestor  # noqa: E402

T = datetime(2026, 11, 16, 19, 0, tzinfo=UTC)


@pytest.fixture
def relays(monkeypatch):
    state = ingestor.state
    monkeypatch.setattr(state, "equipment", {})
    monkeypatch.setattr(state, "pending_ordinary_equipment", [])
    monkeypatch.setattr(state, "relay_generation", 0)
    monkeypatch.setattr(state, "relays_on_before_connection", set())
    monkeypatch.setattr(state, "relays_first_seen", {})
    monkeypatch.setattr(state, "relays_first_recorded", set())
    monkeypatch.setattr(state, "relay_boot_at", None)
    monkeypatch.setattr(state, "counter_source_firmware_generation", 0)
    monkeypatch.setattr(state, "diagnostics", {})
    monkeypatch.setattr(ingestor, "_mark_equipment_source_gap", lambda reason: None)
    monkeypatch.setattr(state, "relay_last_uptime_s", None)
    monkeypatch.setattr(ingestor.shared, "note_wet_relay", lambda *args: None)
    return state


def _report(equipment: str, value: bool, at: datetime, generation: int) -> None:
    # An invalid callback clock keeps the receipt path out of this test; the cache still updates.
    ingestor._record_equipment_callback(equipment, value, at, generation, False)


def test_a_boot_writes_off_edges_at_the_boot_and_the_first_states_after_it(relays):
    for equipment, value in (("heat1", True), ("fan1", True), ("vent", False)):
        _report(equipment, value, T, 5)
    ingestor._relay_edges_across_boot(50_000.0, T + timedelta(minutes=1), 5)
    assert relays.pending_ordinary_equipment == []  # no reset yet

    # A flash: the controller reconnects as generation 6, heat1 is ON again, then uptime reads 40 s.
    _report("heat1", True, T + timedelta(minutes=10), 6)
    report_at = T + timedelta(minutes=10, seconds=5)
    ingestor._relay_edges_across_boot(40.0, report_at, 6)
    boot_at = report_at - timedelta(seconds=40)
    assert relays.pending_ordinary_equipment == [
        (boot_at, "fan1", False),
        (boot_at, "heat1", False),
        (T + timedelta(minutes=10), "heat1", True),  # swallowed by the cache as no change, restored as an edge
    ]
    # Relays not yet reported on the new connection leave the cache: their first state is stored as an edge.
    assert relays.equipment == {"heat1": True}

    # Uptime keeps rising on the same boot: nothing more.
    ingestor._relay_edges_across_boot(100.0, report_at + timedelta(minutes=1), 6)
    assert len(relays.pending_ordinary_equipment) == 3


def _live_report(equipment: str, value: bool, at: datetime, generation: int) -> None:
    # A valid callback clock: the receipt path runs when this connection's firmware lineage is known.
    ingestor._record_equipment_callback(equipment, value, at, generation, True)


@pytest.mark.parametrize("uptime_first", [False, True])
def test_a_relay_off_before_the_boot_and_on_at_its_first_report_gets_one_on_edge(relays, uptime_first):
    # 2026-11-17: heat1 OFF before the boot, switched on by the law right after it; the first report on the new
    # connection comes before its firmware lineage, so the receipt path cannot store it.
    _report("heat1", False, T, 5)
    ingestor._relay_edges_across_boot(50_000.0, T + timedelta(minutes=1), 5)
    first_at = T + timedelta(minutes=10)
    report_at = T + timedelta(minutes=10, seconds=5)
    if uptime_first:
        ingestor._relay_edges_across_boot(30.0, report_at, 6)
        _live_report("heat1", True, first_at, 6)
    else:
        _live_report("heat1", True, first_at, 6)
        ingestor._relay_edges_across_boot(30.0, report_at, 6)
    assert relays.pending_ordinary_equipment == [(max(first_at, report_at - timedelta(seconds=30)), "heat1", True)]
    assert relays.equipment == {"heat1": True}


@pytest.mark.parametrize("uptime_first", [False, True])
def test_a_first_on_state_the_receipt_path_stored_gets_no_second_edge(relays, monkeypatch, uptime_first):
    stored = []
    monkeypatch.setattr(ingestor, "_valid_source_firmware", lambda revision: True)
    monkeypatch.setattr(ingestor, "_append_pending_equipment_event", lambda event: stored.append(event) or True)
    _report("heat1", False, T, 5)
    ingestor._relay_edges_across_boot(50_000.0, T + timedelta(minutes=1), 5)
    relays.counter_source_firmware_generation = 6
    relays.diagnostics["firmware_version"] = "build"
    report_at = T + timedelta(minutes=10, seconds=5)
    if uptime_first:
        ingestor._relay_edges_across_boot(30.0, report_at, 6)
        _live_report("heat1", True, T + timedelta(minutes=10), 6)
    else:
        _live_report("heat1", True, T + timedelta(minutes=10), 6)
        ingestor._relay_edges_across_boot(30.0, report_at, 6)
    assert [(e.equipment, e.state) for e in stored] == [("heat1", True)]
    assert relays.pending_ordinary_equipment == []
