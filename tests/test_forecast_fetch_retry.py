"""The hourly forecast fetch retries a failure about 5, 15 and 30 minutes later, then gives up until the next run."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ingestor"))

from tasks import forecast  # noqa: E402


def test_forecast_fetch_retries_on_the_bounded_schedule_and_stops():
    calls: list[int] = []
    waits: list[float] = []

    def failing_fetch():
        calls.append(1)
        return None

    async def fake_sleep(delay):
        waits.append(delay)

    assert asyncio.run(forecast._fetch_forecast_with_retry(failing_fetch, fake_sleep)) is None
    assert len(calls) == 4
    assert waits == [300.0, 600.0, 900.0]
    offsets = [sum(waits[: i + 1]) / 60 for i in range(len(waits))]
    assert offsets == [5.0, 15.0, 30.0]

    results = iter([None, None, [{"ts": "2026-11-16T00:00"}]])
    calls.clear()
    waits.clear()

    def flaky_fetch():
        calls.append(1)
        return next(results)

    assert asyncio.run(forecast._fetch_forecast_with_retry(flaky_fetch, fake_sleep)) == [{"ts": "2026-11-16T00:00"}]
    assert len(calls) == 3
    assert waits == [300.0, 600.0]
