"""CI gate: planner prompt + MCP scorecard copy describe ONE served-band measurement.

#1623 (Jason, 2026-11-15): the dynamic served house band (band_house_* audit rows,
graded by migration 290 into daily_summary.compliance_pct) is the only temperature/VPD
measurement basis. planner_score = compliance_pct at 100% weight; resource cost is
informational and never part of the reward; planning water excludes house/hose use.
The retired crop-band grading (compliance_v2_*, graded_*, per-zone weights, the
feasibility classifier) must not come back into the prose Iris reads, and ADR-0003
target-hugging stays out.

Pure text parsing — no DB, no ESPHome build, no module import side effects (mirrors
test_planner_prompt_coverage.py). Run anchored to a fixed UTC capture timestamp so
the assertion set is a snapshot, not a moving target.
"""

from __future__ import annotations

import datetime as dt
import pathlib
import re

# UTC capture timestamp for this copy snapshot (no bare-green: the assertions below
# describe the copy as audited at this instant; a regression flips them red).
SNAPSHOT_TS = dt.datetime(2026, 11, 15, 0, 0, 0, tzinfo=dt.UTC)

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
PLANNER_PATH = REPO_ROOT / "ingestor" / "iris_planner.py"
MCP_SERVER_PATH = REPO_ROOT / "mcp" / "server.py"

# The assembled planner prompt is these three module-level triple-quoted constants.
_PROMPT_CONSTANTS = ("_STANDING_DIRECTIVES", "_PLANNER_EXTENDED", "_PLANNER_CORE")

# The retired crop-band grading and resource reward. Any of these back in the
# planner-facing copy is a regression of #1623.
_FORBIDDEN_RETIRED_GRADING = (
    "compliance_v2",
    "graded_",
    "controller-attributable",
    "feasibility classifier",
    "unachievable",
    "center 0.60",
    "80/20",
    "dev_temp_norm",
    "dev_vpd_norm",
)

_FORBIDDEN_TARGET_HUGGING_FRAMINGS = (
    "peaks at the target",
    "hugging the target curve",
    "hugging the target line",
    "drive deviation toward 0",
    "drive toward 0 day",
    "off-target-but-in-band no longer scores",
)


def _prompt_text() -> str:
    """Concatenate the bodies of the three triple-quoted prompt constants."""
    src = PLANNER_PATH.read_text()
    bodies: list[str] = []
    for const in _PROMPT_CONSTANTS:
        m = re.search(rf'{const}\s*=\s*"""(?P<body>.*?)"""', src, re.DOTALL)
        assert m, f"Could not locate prompt constant {const} in {PLANNER_PATH}"
        bodies.append(m.group("body"))
    text = "\n".join(bodies)
    assert text.strip(), "Assembled planner prompt text is empty"
    return text


def _scorecard_docstring() -> str:
    """Extract the body of the `scorecard()` tool docstring from mcp/server.py."""
    src = MCP_SERVER_PATH.read_text()
    m = re.search(
        r'async def scorecard\([^)]*\)\s*->\s*str:\s*"""(?P<body>.*?)"""',
        src,
        re.DOTALL,
    )
    assert m, f"Could not locate scorecard() docstring in {MCP_SERVER_PATH}"
    body = m.group("body")
    assert body.strip(), "scorecard() docstring is empty"
    return body


def _outcome_kpi_docstring() -> str:
    """Extract the body of the `outcome_kpi()` tool docstring from mcp/server.py."""
    src = MCP_SERVER_PATH.read_text()
    m = re.search(
        r'async def outcome_kpi\([^)]*\)\s*->\s*str:\s*"""(?P<body>.*?)"""',
        src,
        re.DOTALL,
    )
    assert m, f"Could not locate outcome_kpi() docstring in {MCP_SERVER_PATH}"
    body = m.group("body")
    assert body.strip(), "outcome_kpi() docstring is empty"
    return body


def test_snapshot_ts_is_utc() -> None:
    """Guard against a naive/local timestamp slipping into the snapshot anchor."""
    assert SNAPSHOT_TS.tzinfo is dt.UTC
    assert SNAPSHOT_TS.utcoffset() == dt.timedelta(0)


def test_planner_prompt_names_one_served_band_score() -> None:
    """The prompt tells Iris the score is served-band compliance_pct at 100% weight."""
    text = _prompt_text()
    lowered = text.lower()
    for token in ("served house band", "band_house_*", "measurement contract 3", "compliance_pct"):
        assert token.lower() in lowered, f"Planner prompt must name {token!r} ({PLANNER_PATH})."
    assert "`planner_score` = `compliance_pct`, at 100% weight" in text
    assert "0.74 kpa" in lowered and "dry-out" in lowered


def test_planner_prompt_drops_retired_grading() -> None:
    lowered = _prompt_text().lower()
    offenders = [p for p in _FORBIDDEN_RETIRED_GRADING if p.lower() in lowered]
    assert not offenders, f"Planner prompt still carries retired crop-band grading {offenders} ({PLANNER_PATH})."


def test_planner_prompt_keeps_resources_informational() -> None:
    """Cost leaves the reward; electric heat1 is primary heat, never something to minimise."""
    lowered = _prompt_text().lower()
    assert "informational" in lowered
    assert "never minimise heat1 runtime or cost" in lowered
    assert "house/hose water is excluded" in lowered
    assert "3.9x cheaper" not in lowered


def test_planner_prompt_drops_target_hugging_framing() -> None:
    """ADR-0004 says target-distance is diagnostic, not the control objective."""
    lowered = _prompt_text().lower()
    offenders = [p for p in _FORBIDDEN_TARGET_HUGGING_FRAMINGS if p.lower() in lowered]
    assert not offenders, (
        f"Planner prompt still carries ADR-0003 target-hugging framing {offenders} "
        f"({PLANNER_PATH}). Target-reference deviation may be diagnostic, but the "
        "planner must optimize served-band outcomes."
    )


def test_scorecard_docstring_names_one_served_band_score() -> None:
    body = _scorecard_docstring()
    lowered = body.lower()
    for token in (
        "scorecard_contract_version",
        "contract 3",
        "served house band",
        "band_house_*",
        "planner_score = compliance_pct",
        "never widen",
        "informational",
        "house/hose water",
    ):
        assert token in lowered, f"scorecard() docstring must name {token!r} ({MCP_SERVER_PATH})."
    offenders = [p for p in _FORBIDDEN_RETIRED_GRADING if p.lower() in lowered]
    assert not offenders, f"scorecard() docstring still carries retired grading {offenders} ({MCP_SERVER_PATH})."


def test_scorecard_docstring_drops_target_hugging_framing() -> None:
    """Runtime scorecard guidance must not instruct Iris to chase the target line."""
    lowered = _scorecard_docstring().lower()
    offenders = [p for p in _FORBIDDEN_TARGET_HUGGING_FRAMINGS if p.lower() in lowered]
    assert not offenders, (
        f"scorecard() docstring still carries ADR-0003 target-hugging framing {offenders} ({MCP_SERVER_PATH})."
    )


def test_outcome_kpi_docstring_names_adr0004_kpi_surface() -> None:
    """The outcome KPI tool must describe the ADR-0004 evidence surface."""
    body = _outcome_kpi_docstring()
    lowered = body.lower()
    for token in (
        "adr-0004",
        "served",
        "pinched",
        "vpd",
        "actuator",
        "dew",
        "water",
        "dli",
        "dif",
        "solar-phase",
        "moisture-estimator",
        "fog/dehum",
        "heat-dehum",
    ):
        assert token in lowered, f"outcome_kpi() docstring must mention {token!r} ({MCP_SERVER_PATH})."


def test_outcome_kpi_docstring_names_moisture_action_log_source() -> None:
    """Moisture estimator reporting uses action-log JSON once live rows exist."""
    lowered = _outcome_kpi_docstring().lower()
    assert "computed" in lowered
    for token in ("pinched", "dif", "solar-phase", "climate_action_log", "source_system_state"):
        assert token in lowered, f"outcome_kpi() docstring must name computed metric {token!r}."
    assert "moisture-estimator" in lowered
    assert "climate_moisture_exchange" in lowered


def test_outcome_kpi_source_uses_existing_telemetry_for_metrics() -> None:
    """Outcome reporting must be computed from telemetry/readbacks, not hard-coded."""
    src = MCP_SERVER_PATH.read_text()
    for token in (
        "time_bucket('1 minute'",
        "house_temp_target_f",
        "house_vpd_target",
        "setpoint_snapshot",
        "band_track_fraction",
        "solar_phase_buckets",
        "climate_action_log",
        "source_system_state -> 'climate_moisture_exchange'",
        "moisture_estimator",
        "vpd_policy",
        "wet_to_dehum_episodes_30m",
        "dehum_to_wet_episodes_30m",
    ):
        assert token in src, f"outcome_kpi() source must use {token!r} ({MCP_SERVER_PATH})."


def test_outcome_kpi_docstring_drops_target_hugging_framing() -> None:
    """Outcome KPI guidance must not reintroduce ADR-0003 target-line chasing."""
    lowered = _outcome_kpi_docstring().lower()
    offenders = [p for p in _FORBIDDEN_TARGET_HUGGING_FRAMINGS if p.lower() in lowered]
    assert not offenders, (
        f"outcome_kpi() docstring still carries ADR-0003 target-hugging framing {offenders} ({MCP_SERVER_PATH})."
    )
