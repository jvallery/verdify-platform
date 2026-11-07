"""The planner study's boundary runner (#1360): a sweep in the operator API, like ``light_timer``. No routes, no SQL.

Every ``SWEEP_S`` each operator API pod runs ``verdify_services.planner_study.locked_sweep_all``: under the study
advisory lock it reads each defined study's run from its ``study.*`` activity rows, holds the 48 planner settings
manual at the baseline vector on a baseline day, releases its own holds otherwise (an AI day, a pause, a stop or the
end), and records the day's boundary once the settings read back, or a deviation after the confirm window. Then it
releases any study hold no study keeps by design (a study file that no longer loads, a dropped field, a failed sweep).
The run is the rows, so a restart or a rollout loses nothing, and each write's request id is derived from the run,
day, field and the row it replaces, so a repeated sweep replays instead of writing twice. A study with no run costs
a few small reads per sweep.

``PLANNER_STUDY_RUNNER_ENABLED`` (default on) is the off switch: off, the runner neither holds nor releases anything;
docs/design/dashboard/planner-study.md has the emergency release.
"""

from __future__ import annotations

import asyncio
import logging
import os

import asyncpg

from verdify_schemas.planner_study import STUDY_FILES
from verdify_services import planner_study

log = logging.getLogger(__name__)

SWEEP_S = 60.0  # a boundary, pause or stop takes effect within about this long
ENABLED_ENV = "PLANNER_STUDY_RUNNER_ENABLED"


def enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "1").strip().lower() not in {"0", "false", "no", "off"}


class Runner:
    """The sweeps in one operator API process; the last outcome logged per study, so a steady state logs once."""

    def __init__(self) -> None:
        self.logged: dict[str, tuple[object, ...]] = {}

    async def run(self, pool: asyncpg.Pool, interval_s: float = SWEEP_S) -> None:
        """The lifespan task: a sweep every ``interval_s``, the first one ``interval_s`` after the start. A failed sweep
        is logged and the next one goes on. Returns at once when ``PLANNER_STUDY_RUNNER_ENABLED`` is off."""
        if not enabled():
            log.warning("Planner study: the runner is off (%s); it holds and releases nothing", ENABLED_ENV)
            return
        while True:
            await asyncio.sleep(interval_s)
            try:
                await self.once(pool)
            except asyncio.CancelledError:
                raise
            except Exception as failure:
                log.warning("Planner study: the sweep failed (%s: %s)", type(failure).__name__, failure)

    async def once(self, pool: asyncpg.Pool) -> tuple[dict[str, object], list[str]] | None:
        async with pool.acquire() as conn:
            outcome = await planner_study.locked_sweep_all(conn, tuple(STUDY_FILES))
        if outcome is None:
            return None
        results, stranded = outcome
        for study_id, result in results.items():
            if isinstance(result, Exception):
                log.warning("Planner study: the %s sweep failed (%s: %s)", study_id, type(result).__name__, result)
                continue
            state = (result.arm, result.held, result.released, tuple(result.foreign), tuple(result.refused))
            if (
                result.held
                or result.released
                or result.boundary
                or result.refused
                or self.logged.get(study_id) != state
            ):
                log.info(
                    "Planner study %s: arm=%s held=%d released=%d held_by_others=%s refused=%s boundary=%s",
                    study_id,
                    result.arm,
                    result.held,
                    result.released,
                    ",".join(result.foreign) or "-",
                    ",".join(result.refused) or "-",
                    result.boundary or "-",
                )
                self.logged[study_id] = state
        if stranded:
            log.warning("Planner study: released %d stranded holds: %s", len(stranded), ",".join(stranded))
        return dict(results), stranded
