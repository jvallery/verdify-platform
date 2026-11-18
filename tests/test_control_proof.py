"""#1633 package 4.1: host readers move to the climate law's state record and keep today's sources as the fallback.

The law build's state record heartbeat (stored on every receipt) is the controller-decision proof for /health, the OTA
gate, the smoke and liveness checks and the stale-proof alert; a build before the law has none, and the action log
stays its proof. The Now read and the 15-minute brief carry the law's drying state while the record is fresh. The OTA
gate's own cases are in tests/test_firmware_preflight_deny_checks.py. No database.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from verdify_schemas.control_proof import (
    LAW_HEARTBEAT_MAX_AGE_S,
    LAW_STATE_AGE_SQL,
    control_proof,
    law_fresh,
)
from verdify_services import reads

ROOT = Path(__file__).resolve().parents[1]
AT = datetime(2026, 11, 16, 5, 0, tzinfo=UTC)
RECORD = {
    "v": 1,
    "l": 0x40 | 0x80,
    "o": 0x1 | 0x4,
    "dr": "cost",
    "e": 0.912,
    "lim": 0.7,
    "br": 0,
    "b": [62.5, 72.5, 0.76, 1.19],
}


@pytest.mark.parametrize(
    ("law_age", "action_age", "missing", "proof"),
    [
        (30, None, "missing", "law"),
        (LAW_HEARTBEAT_MAX_AGE_S, 900, "climate_action", "law"),
        (LAW_HEARTBEAT_MAX_AGE_S + 1, 30, "", "action_log"),
        (None, 30, "", "action_log"),
        (None, 300, "", "missing"),
        (None, 30, "relay_truth", "missing"),
        (500, None, "missing", "missing"),
        (-5, 30, "", "action_log"),
    ],
)
def test_the_law_heartbeat_proves_first_and_the_action_log_is_the_fallback(law_age, action_age, missing, proof):
    assert control_proof(law_age, action_age, missing) == proof
    assert law_fresh(law_age) is (proof == "law")


@pytest.mark.parametrize(
    "script", ["scripts/firmware-deploy-preflight.sh", "scripts/liveness-check.sh", "scripts/health-check.sh"]
)
def test_the_shell_readers_ask_the_same_question(script):
    assert LAW_STATE_AGE_SQL in (ROOT / script).read_text()
    assert f"-le {LAW_HEARTBEAT_MAX_AGE_S}" in (ROOT / script).read_text()


def test_the_api_alert_and_http_checks_use_the_shared_definition():
    api = (ROOT / "api/main.py").read_text()
    assert 'checks["control_proof"] = control_proof(law_age, action_age, action_proof_missing)' in api
    assert 'checks["service_controller"]' in api
    assert "law_age_s = await conn.fetchval(LAW_STATE_AGE_SQL)" in (ROOT / "ingestor/tasks/alerts.py").read_text()
    for script in (
        "scripts/k3s-smoke.sh",
        "scripts/validate-climate-authority-post-deploy.sh",
        "scripts/health-check.sh",
    ):
        assert 'checks.get("control_proof") == "law"' in (ROOT / script).read_text()


# ── the Now read and the brief ──────────────────────────────────────────────


def test_a_fresh_record_is_decoded_for_now():
    law = reads.law_state(json.dumps(RECORD), AT - timedelta(seconds=40), AT)
    assert law is not None
    assert (law.latches, law.requests) == (["dry", "air"], ["heat1", "vent"])
    assert (law.drying, law.drying_refused_reason, law.drying_cost_kwh_per_kg) == ("refused", "cost", 0.912)
    assert (law.drying_cost_limit_kwh_per_kg, law.band_repaired) == (0.7, False)


@pytest.mark.parametrize(
    ("update", "drying", "reason", "cost"),
    [
        ({"l": 0x40 | 0x100, "dr": "none"}, "running", None, 0.912),
        ({"l": 0, "dr": "none"}, "not_wanted", None, 0.912),
        ({"e": None, "dr": "no_outdoor"}, "refused", "no_outdoor", None),
        ({"e": 1000000000, "dr": "not_drier"}, "refused", "not_drier", None),
    ],
)
def test_the_drying_state(update, drying, reason, cost):
    law = reads.law_state(json.dumps({**RECORD, **update}), AT, AT)
    assert (law.drying, law.drying_refused_reason, law.drying_cost_kwh_per_kg) == (drying, reason, cost)


@pytest.mark.parametrize(
    ("update", "latches", "requests", "drying", "reason"),
    [
        # Bits the decoder does not know (a later build) are ignored, not refused.
        ({"l": 0x40 | 0x1000, "o": 0x1 | 0x4000}, ["dry"], ["heat1"], "refused", "cost"),
        # A reason word this host does not know yet still decodes and is passed on as the controller wrote it.
        ({"dr": "a_later_reason"}, ["dry", "air"], ["heat1", "vent"], "refused", "a_later_reason"),
        # The dry latch with no reason: refused, and the reason is null (the page says "no reason").
        ({"dr": "none"}, ["dry", "air"], ["heat1", "vent"], "refused", None),
    ],
)
def test_the_decoder_tolerates_what_it_does_not_know(update, latches, requests, drying, reason):
    law = reads.law_state(json.dumps({**RECORD, **update}), AT, AT)
    assert law is not None
    assert (law.latches, law.requests, law.drying, law.drying_refused_reason) == (latches, requests, drying, reason)


@pytest.mark.parametrize(
    ("value", "observed_at"),
    [
        (None, None),
        (json.dumps(RECORD), AT - timedelta(seconds=LAW_HEARTBEAT_MAX_AGE_S + 1)),
        ('{"v":2}', AT),
    ],
)
def test_before_the_law_or_with_a_stale_record_now_has_no_law(value, observed_at):
    assert reads.law_state(value, observed_at, AT) is None


def test_the_brief_carries_the_law_state_only_while_it_is_fresh():
    sys.path.insert(0, str(ROOT / "tests"))
    sys.path.insert(0, str(ROOT / "api"))
    import greenhouse_brief_job as job
    from test_greenhouse_brief import AT as BRIEF_AT
    from test_greenhouse_brief import MODE, now_model

    law = reads.law_state(json.dumps(RECORD), BRIEF_AT, BRIEF_AT)
    sheet = job.build_sheet(job.Gathered(now=now_model(law=law.model_dump()), mode=MODE), BRIEF_AT)
    assert sheet["climate_law"] == {
        "drying": "refused",
        "drying_refused_because": "cost",
        "drying_cost_kwh_per_kg": 0.91,
        "drying_cost_limit_kwh_per_kg": 0.7,
        "band_repaired_by_controller": False,
        "heaters_requested_by_law": ["heat1"],
    }
    assert "climate_law" not in job.build_sheet(job.Gathered(now=now_model(), mode=MODE), BRIEF_AT)


SAMPLES = ROOT / "tests/fixtures/climate_law_samples"


@pytest.mark.parametrize(
    ("sample", "drying", "reason", "latches", "repaired"),
    [
        ("drying", "running", None, ["dry", "air", "run"], False),
        ("refused_cost", "refused", "cost", ["dry", "air"], False),
        ("no_outdoor", "refused", "no_outdoor", ["dry"], False),
        ("humidity_invalid", "not_wanted", "humidity_invalid", [], False),
        ("no_temperature", "not_wanted", "no_temperature", [], False),
        ("hot_repaired_band", "not_wanted", None, ["cool", "cool2"], True),
    ],
)
def test_the_law_lane_s_sample_records_read_as_now_law(sample, drying, reason, latches, repaired):
    law = reads.law_state((SAMPLES / f"climate_law_state.{sample}.json").read_text(), AT, AT)
    assert (law.drying, law.drying_refused_reason, law.latches, law.band_repaired) == (
        drying,
        reason,
        latches,
        repaired,
    )
