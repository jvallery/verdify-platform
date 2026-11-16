"""Parallel-writer demotion (#584 Lane C) — gating matrix tests.

Covers, without a live DB:
- the verdify_schemas.experiment_config flag parsing and the demotion gate's
  fast path (feature-off takes ZERO queries — current behavior);
- the forecast engine's demoted proposal builder + gated direct writes.

The MCP demotion gate and policy_template_propose were retired with
experiment generation 1 (#1649).
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripted_db import FakeConn  # noqa: E402

from verdify_schemas import experiment_config  # noqa: E402

TRIGGER_ID = str(uuid.uuid4())
ASSIGNMENT_ID = str(uuid.uuid4())


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("VERDIFY_POLICY_VECTOR_MODE", raising=False)
    monkeypatch.delenv("VERDIFY_COMPONENT_EXPERIMENT_ENABLED", raising=False)
    monkeypatch.delenv("VERDIFY_ACTIVE_EXPERIMENT_ID", raising=False)
    monkeypatch.delenv("VERDIFY_LEGACY_DIRECT_POLICY_WRITES_ENABLED", raising=False)


class ForbiddenConn:
    """Feature-off proof: any query is a test failure."""

    def __getattr__(self, name):
        raise AssertionError("feature-off gate must not query the database")


# ── experiment_config flags + gate ──────────────────────────────────────────


class TestFlags:
    def test_mode_defaults_off_and_typos_fail_safe(self, monkeypatch):
        assert experiment_config.policy_vector_mode() == "off"
        for bogus in ("LIVE ", "on", "1", "lIvE-typo"):
            monkeypatch.setenv("VERDIFY_POLICY_VECTOR_MODE", bogus)
            if bogus.strip().lower() not in ("off", "shadow", "live"):
                assert experiment_config.policy_vector_mode() == "off"
        monkeypatch.setenv("VERDIFY_POLICY_VECTOR_MODE", "LIVE")
        assert experiment_config.policy_vector_mode() == "live"

    def test_legacy_writes_disable_only_on_exact_zero(self, monkeypatch):
        assert experiment_config.legacy_direct_policy_writes_enabled() is True
        for keep in ("1", "", "no", "false", "off"):
            monkeypatch.setenv("VERDIFY_LEGACY_DIRECT_POLICY_WRITES_ENABLED", keep)
            assert experiment_config.legacy_direct_policy_writes_enabled() is True, keep
        monkeypatch.setenv("VERDIFY_LEGACY_DIRECT_POLICY_WRITES_ENABLED", "0")
        assert experiment_config.legacy_direct_policy_writes_enabled() is False

    def test_experiment_id_must_be_a_uuid(self, monkeypatch):
        monkeypatch.setenv("VERDIFY_ACTIVE_EXPERIMENT_ID", "not-a-uuid")
        assert experiment_config.active_experiment_id() is None
        monkeypatch.setenv("VERDIFY_ACTIVE_EXPERIMENT_ID", TRIGGER_ID)
        assert experiment_config.active_experiment_id() == TRIGGER_ID

    def test_component_capability_defaults_off_and_typos_fail_closed(self, monkeypatch):
        assert experiment_config.component_experiment_mode() == "off"
        assert experiment_config.component_experiment_gate() == (False, "component_capability_off")
        for raw in ("1", "true", "live", "enabled-typo", "ENABLED", " enabled", "enabled "):
            monkeypatch.setenv("VERDIFY_COMPONENT_EXPERIMENT_ENABLED", raw)
            assert experiment_config.component_experiment_mode() == "off"
            assert experiment_config.component_experiment_enabled() is False

    def test_component_capability_requires_vector_explicitly_off_and_valid_id(self, monkeypatch):
        monkeypatch.setenv("VERDIFY_COMPONENT_EXPERIMENT_ENABLED", "enabled")
        assert experiment_config.component_experiment_gate() == (
            False,
            "generalized_vector_mode_not_exactly_off",
        )
        for raw in ("shadow", "live", "typo", "", "OFF", " off", "off "):
            monkeypatch.setenv("VERDIFY_POLICY_VECTOR_MODE", raw)
            assert experiment_config.component_experiment_gate() == (
                False,
                "generalized_vector_mode_not_exactly_off",
            )

        monkeypatch.setenv("VERDIFY_POLICY_VECTOR_MODE", "off")
        assert experiment_config.component_experiment_gate() == (
            False,
            "active_experiment_id_missing_or_invalid",
        )
        monkeypatch.setenv("VERDIFY_ACTIVE_EXPERIMENT_ID", TRIGGER_ID)
        assert experiment_config.component_experiment_gate() == (True, "admissible")
        assert experiment_config.component_experiment_enabled() is True

    def test_component_capability_has_no_shadow_or_live_submode(self, monkeypatch):
        monkeypatch.setenv("VERDIFY_POLICY_VECTOR_MODE", "off")
        monkeypatch.setenv("VERDIFY_ACTIVE_EXPERIMENT_ID", TRIGGER_ID)
        for raw in ("shadow", "live"):
            monkeypatch.setenv("VERDIFY_COMPONENT_EXPERIMENT_ENABLED", raw)
            assert experiment_config.component_experiment_gate() == (False, "component_capability_off")

    def test_component_startup_hold_fails_safe_on_typos_or_residual_id(self, monkeypatch):
        assert experiment_config.component_startup_hold_required() is False
        monkeypatch.setenv("VERDIFY_COMPONENT_EXPERIMENT_ENABLED", "typo")
        assert experiment_config.component_startup_hold_required() is True
        monkeypatch.setenv("VERDIFY_COMPONENT_EXPERIMENT_ENABLED", "off")
        assert experiment_config.component_startup_hold_required() is False
        monkeypatch.setenv("VERDIFY_ACTIVE_EXPERIMENT_ID", TRIGGER_ID)
        assert experiment_config.component_startup_hold_required() is True


class TestGate:
    def test_feature_off_takes_zero_queries(self):
        assert _run(experiment_config.demoted_policy_write_gate(ForbiddenConn())) is None

    def test_armed_assignment_demotes(self, monkeypatch):
        monkeypatch.setenv("VERDIFY_POLICY_VECTOR_MODE", "live")
        monkeypatch.setenv("VERDIFY_ACTIVE_EXPERIMENT_ID", TRIGGER_ID)
        conn = FakeConn(
            [
                (
                    "FROM public.fn_mcp_armed_assignment_context()",
                    {"experiment_id": TRIGGER_ID, "greenhouse_id": "vallery", "assignment_id": ASSIGNMENT_ID},
                )
            ]
        )
        gate = _run(experiment_config.demoted_policy_write_gate(conn))
        assert gate == {
            "experiment_id": TRIGGER_ID,
            "assignment_id": ASSIGNMENT_ID,
            "greenhouse_id": "vallery",
        }

    def test_experiment_env_without_armed_assignment_fails_open(self, monkeypatch):
        monkeypatch.setenv("VERDIFY_POLICY_VECTOR_MODE", "live")
        monkeypatch.setenv("VERDIFY_ACTIVE_EXPERIMENT_ID", TRIGGER_ID)
        conn = FakeConn([("FROM public.fn_mcp_armed_assignment_context()", None)])
        assert _run(experiment_config.demoted_policy_write_gate(conn)) is None

    def test_probe_error_fails_open_when_legacy_enabled(self, monkeypatch):
        monkeypatch.setenv("VERDIFY_POLICY_VECTOR_MODE", "live")
        monkeypatch.setenv("VERDIFY_ACTIVE_EXPERIMENT_ID", TRIGGER_ID)

        def boom(_args):
            raise RuntimeError("relation does not exist")

        conn = FakeConn([("FROM public.fn_mcp_armed_assignment_context()", boom)])
        assert _run(experiment_config.demoted_policy_write_gate(conn)) is None

    def test_legacy_disabled_demotes_even_without_assignment(self, monkeypatch):
        monkeypatch.setenv("VERDIFY_LEGACY_DIRECT_POLICY_WRITES_ENABLED", "0")
        conn = FakeConn([("FROM public.fn_mcp_armed_assignment_context()", None)])
        gate = _run(experiment_config.demoted_policy_write_gate(conn))
        assert gate is not None and gate["assignment_id"] is None
