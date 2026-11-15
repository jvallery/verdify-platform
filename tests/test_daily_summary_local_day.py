"""daily_summary cycles and day boundaries follow the America/Denver greenhouse day.

The database and the ingestor container both run on UTC. Before this fix the firmware-counter
snapshot fired at 00:05 UTC (17:05 MST) and stamped the UTC date, so a local day's partial counters
landed on the next day's row; grow_light_daily's CURRENT_DATE - 1 named the local day still in
progress between 17:00 and 24:00 MST; and daily_summary_live never rewrote the fan, heat, fog, vent
and grow-light cycles, so those wrong values stood (2026-11-14: cycles_heat1 17 stored, 40 in
v_equipment_runtime_daily).
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DAILY = (ROOT / "ingestor" / "tasks" / "daily.py").read_text()
INGESTOR = (ROOT / "ingestor" / "ingestor.py").read_text()


def _block(src: str, start: str, end: str) -> str:
    i = src.index(start)
    return src[i : src.index(end, i)]


def test_live_refresh_rewrites_every_transition_cycle_column():
    block = _block(DAILY, "async def _refresh_daily_summary_for_date", "async def daily_summary_live")
    for col in (
        "cycles_fan1",
        "cycles_fan2",
        "cycles_heat1",
        "cycles_heat2",
        "cycles_fog",
        "cycles_vent",
        "cycles_grow_light",
    ):
        assert re.search(rf"\b{col}=\$\d+", block), f"daily_summary_live does not write {col}"
    for eq in ("fan1", "fan2", "heat1", "heat2", "fog", "vent"):
        assert f'cycles.get("{eq}")' in block, f"{eq} cycles must come from the transition view, NULL when absent"


def test_grow_light_daily_yesterday_is_the_local_day():
    block = _block(DAILY, "async def grow_light_daily", "# ── utility_cost monthly roll-up")
    assert "CURRENT_DATE - 1" not in block
    assert "(now() AT TIME ZONE 'America/Denver')::date - 1" in block


def test_firmware_snapshot_uses_the_local_clock_before_the_midnight_reset():
    snapshot = _block(INGESTOR, "async def write_daily_summary", "async with pool.acquire() as conn:")
    assert "datetime.now(COUNTER_SOURCE_TIMEZONE).date()" in snapshot
    assert "datetime.now(UTC).date()" not in snapshot
    trigger = _block(INGESTOR, "# Daily summary: snapshot the firmware day counters", "await write_daily_summary(pool)")
    assert "datetime.now(COUNTER_SOURCE_TIMEZONE)" in trigger
    assert "now_mt.hour == 23 and now_mt.minute == 58" in trigger
    assert 'ZoneInfo("America/Denver")' in INGESTOR.split("COUNTER_SOURCE_TIMEZONE =", 1)[1].splitlines()[0]
