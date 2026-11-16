"""Proof that the controller is deciding: the law's state record, or today's action log while it is absent.

The climate law build (phase 3) publishes ``climate_law_state`` on every change and as a 60 s heartbeat; the ingestor
stores every receipt in ``system_state``. A row younger than ``LAW_HEARTBEAT_MAX_AGE_S`` proves the law is running.
Builds before the law publish no state record, so every reader falls back to today's proof: a ``climate_action_log``
row younger than ``ACTION_LOG_MAX_AGE_S`` with every proof field (the readers keep their own field list). The OTA gate,
``/health``, the smoke and liveness checks and the stale-proof alert all decide with ``control_proof``; the shell
readers embed ``LAW_STATE_AGE_SQL`` and are held to it by tests/test_control_proof.py.
"""

from __future__ import annotations

from typing import Literal

LAW_STATE_ENTITY = "climate_law_state"
LAW_HEARTBEAT_MAX_AGE_S = 120
ACTION_LOG_MAX_AGE_S = 300

# Seconds since the newest state record, or NULL when there is none in the last hour (a build before the law).
LAW_STATE_AGE_SQL = (
    "SELECT extract(epoch FROM now() - max(ts))::int FROM system_state "
    "WHERE entity = 'climate_law_state' AND ts > now() - interval '1 hour'"
)

ControlProof = Literal["law", "action_log", "missing"]


def law_fresh(law_age_s: float | None) -> bool:
    """Whether a state record row is young enough to prove the law is running."""
    return law_age_s is not None and 0 <= law_age_s <= LAW_HEARTBEAT_MAX_AGE_S


def control_proof(law_age_s: float | None, action_age_s: float | None, action_missing: str | None) -> ControlProof:
    """``law`` while the state record's heartbeat is fresh; otherwise ``action_log`` while today's action log proves
    the decision (fresh and complete); otherwise ``missing``."""
    if law_fresh(law_age_s):
        return "law"
    if action_age_s is not None and action_age_s < ACTION_LOG_MAX_AGE_S and not action_missing:
        return "action_log"
    return "missing"
