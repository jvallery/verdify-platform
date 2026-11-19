"""Process-health heartbeats for the ingestor's liveness probe (#1748).

Liveness judges the process only: the asyncio event loop answers and the task
supervisor (``task_loop``) runs. A stale climate feed has causes outside the
pod (the controller is silent, its WiFi is down, it restarts); restarting the
single writer repairs none of them, so climate age is not a liveness input. It
stays a metric (``verdify_table_last_row_age_seconds{table="climate"}`` on the
operator API) and an alert. A database outage does not stop either heartbeat,
so it does not restart the writer either (the old probe tolerated it too).

Each beat writes the current epoch to one small file under ``LIVENESS_DIR``
(an emptyDir at /tmp in the pod), at most once per ``BEAT_MIN_INTERVAL_S``.
``ingestor-liveness.py`` reads the files from a separate process.
"""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

# The pod mounts a private emptyDir at /tmp; nothing else writes there.
LIVENESS_DIR = Path(os.environ.get("VERDIFY_LIVENESS_DIR", "/tmp/verdify-liveness"))  # noqa: S108
EVENT_LOOP = "event_loop"
TASK_SUPERVISOR = "task_supervisor"
BEATS = (EVENT_LOOP, TASK_SUPERVISOR)
BEAT_MIN_INTERVAL_S = 10.0
EVENT_LOOP_BEAT_S = 10.0

_last_beat: dict[str, float] = {}


def beat(name: str, *, now: float | None = None) -> None:
    """Record that ``name`` is alive. Throttled; never raises (a failed write only ages the beat)."""
    now = time.time() if now is None else now
    if now - _last_beat.get(name, float("-inf")) < BEAT_MIN_INTERVAL_S:
        return
    try:
        LIVENESS_DIR.mkdir(parents=True, exist_ok=True)
        tmp = LIVENESS_DIR / f".{name}.tmp"
        tmp.write_text(f"{now:.3f}\n")
        os.replace(tmp, LIVENESS_DIR / name)
        _last_beat[name] = now
    except OSError:
        pass


async def event_loop_heartbeat() -> None:
    """Beat while the event loop schedules this coroutine; a blocked loop stops it."""
    while True:
        beat(EVENT_LOOP)
        await asyncio.sleep(EVENT_LOOP_BEAT_S)


def beat_ages(directory: Path | None = None, *, now: float | None = None) -> dict[str, float | None]:
    """Seconds since each beat, or None when its file is missing or unreadable."""
    directory = LIVENESS_DIR if directory is None else directory
    now = time.time() if now is None else now
    ages: dict[str, float | None] = {}
    for name in BEATS:
        try:
            ages[name] = now - float((directory / name).read_text().strip())
        except (OSError, ValueError):
            ages[name] = None
    return ages
