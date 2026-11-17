"""Exact318 delivery: ordered admission, the plan-cycle lessons' retirement, the unchanged seals.

#1633 host release 5 (#1734; release 4 review C-9, R4PLANNER-02): the 27 planner_lessons rows that name a retired
setting or a plan waypoint are set inactive. Data only: nothing is deleted or rewritten, no catalog object changes,
and the seals stay 317's. test_native_qualification_is_recorded is the merge gate: the rolled-back production
qualification records the file's measured seals.
"""

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

PREDECESSOR = 317
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"
RETIRED = (1, 7, 8, 27, 88, 89, 94, 98, 102, 104, 105, 125, 128, 131, 134, 136, 139, 140, 141, 151, 162, 174, 223, 272,
           274, 277, 296)  # fmt: skip
# The review's first 17 (live read 2026-11-17 ~00:50Z); the re-derivation added ten (four more retired settings, six
# plan waypoints).
REVIEW_C9 = {1, 7, 27, 88, 89, 94, 98, 102, 104, 125, 128, 131, 134, 139, 140, 174, 272}


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


c0 = load("lessons318_delivery", "c0-migration-delivery.py")
six = load("lessons318_six", "bootstrap-six-runtime-roles.py")
qualifier = load("lessons318_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_318
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/318-retire-plan-cycle-lessons-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/318-retire-plan-cycle-lessons-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 319)]


def uncommented(text):
    return re.sub(r"--[^\n]*", "", text)


BODY = uncommented(SOURCE.split("END $predecessor$;", 1)[1].split("DO $successor$", 1)[0])
PRED_BLOCK = SOURCE[SOURCE.index("DO $predecessor$") : SOURCE.index("END $predecessor$;")]
SUCCESSOR_BLOCK = SOURCE[SOURCE.index("DO $successor$") :]


def later():
    return [c0.SUCCESSOR_254] + [getattr(c0, f"SUCCESSOR_{n}") for n in NUMBERS]


def files():
    return {getattr(c0, f"SUCCESSOR_{n}"): getattr(c0, f"SUCCESSOR_{n}_SHA256") for n in NUMBERS}


def registered(n):
    digests = getattr(c0, f"SUCCESSOR_{n}_DIGESTS")
    return {"api": digests[API], "ingestor": digests[INGESTOR], "mcp": getattr(c0, f"SUCCESSOR_{n}_MCP_DIGEST")}


def ids_in(text):
    match = re.search(r"WHERE id IN \(([^)]*)\)", text)
    return tuple(int(x) for x in match.group(1).replace("\n", " ").split(","))


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    assert hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == c0.SUCCESSOR_318_SHA256
    assert six.RETIRE_PLAN_CYCLE_LESSONS_MIGRATION == (318, c0.SUCCESSOR_318, c0.SUCCESSOR_318_SHA256)
    assert c0.SUCCESSOR_318 == "318-retire-plan-cycle-lessons.sql"
    c0.reviewed_post_254(later(), files())
    c0.reviewed_post_254(later()[:-1], files())
    with pytest.raises(c0.DeliveryError, match="318 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_318: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["318-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_file_is_wrap_safe_and_data_only():
    assert not safety.classify(MIGRATION).self_committing
    qualifier.refuse_transaction_control(SOURCE)
    code = qualifier._code_only(SOURCE)[0].upper()
    for forbidden in (
        r"\bCOMMIT\b",
        r"CONCURRENTLY",
        r"VACUUM",
        r"ALTER SYSTEM",
        r"PASSWORD",
        r"\bTRIGGER\b",
        r"\bTRUNCATE\b",
        r"\bDELETE\b",
        r"\bINSERT\b",
        r"\bCREATE\b",
        r"\bDROP\b",
        r"\bALTER\b",
        r"\bGRANT\b",
        r"\bREVOKE\b",
        r"\bOWNER TO\b",
    ):
        assert not re.search(forbidden, code), forbidden
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name


def test_predecessor_binds_exact317_with_its_registered_seals():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in PRED_BLOCK and f"sha256='{sha}'" in PRED_BLOCK
    assert f"seq>{PREDECESSOR})" in PRED_BLOCK and "stamp_method='runner'" in PRED_BLOCK
    for seal, digest in registered(PREDECESSOR).items():
        assert PRED_BLOCK.count(f"'hex') IS DISTINCT FROM '{digest}'") == 1, seal


def test_the_only_write_retires_the_listed_lessons_and_keeps_their_text():
    statements = [s.strip() for s in re.findall(r"\bUPDATE\b[^;]*;", BODY)]
    assert len(statements) == 1
    (update,) = statements
    assert update.startswith("UPDATE public.planner_lessons")
    assert re.search(r"SET is_active = false\s+WHERE id IN", update)
    assert re.search(r"AND is_active IS TRUE\s+RETURNING id\)", update)
    # R5-ROLL-6: the NOTICE names exactly the ids flipped, so the reversal can be exact.
    assert "string_agg(f.id::text, ', ' ORDER BY f.id)" in update
    assert (
        "RAISE NOTICE '318 retired % plan-cycle lessons, ids (%); the reversal sets is_active = true on these ids only'"
        in BODY
    )
    assert ids_in(update) == RETIRED and len(set(RETIRED)) == 27 and REVIEW_C9 <= set(RETIRED)
    for column in ("lesson", "condition", "category", "confidence", "superseded_by"):
        assert not re.search(rf"\b{column}\s*=", update), column


def test_the_native_fixture_checks_the_same_ids_and_reports_once():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    for array in re.findall(r"ARRAY\[([0-9,\s]+)\]", text):
        assert tuple(int(x) for x in array.split(",")) == RETIRED
    assert "SET SESSION AUTHORIZATION verdify_mcp_runtime_login;" in text
    assert text.count("RESET SESSION AUTHORIZATION;") == 1
    assert text.strip().splitlines()[-1].endswith("'all_passed', true)::text;")


def test_successor_reseals_every_receipt_with_317s_literals():
    literals = qualifier.successor_literals(SOURCE)
    assert literals == registered(318) == registered(PREDECESSOR)
    assert literals == {k: six.SUCCESSOR_318[k] for k in ("api", "ingestor", "mcp")}
    for login, seal in ((API, "api"), (INGESTOR, "ingestor")):
        assert f"decode('{literals[seal]}','hex'), captured_at=clock_timestamp() WHERE login_name='{login}'" in (
            SUCCESSOR_BLOCK
        )
    assert f"decode('{literals['mcp']}','hex') WHERE singleton;" in SUCCESSOR_BLOCK
    assert "'318 receipts do not match the successor seals'" in SUCCESSOR_BLOCK


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_318
    assert evidence["projected_successor"] == qualifier.successor_literals(SOURCE)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact318 and its measured seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False, (
        "318 native qualification pending: run scripts/qualify-migration-successor.py "
        "db/migrations/318-retire-plan-cycle-lessons.sql --native-fixture "
        "db/qualification/318-retire-plan-cycle-lessons-fixture.sql --fixture "
        "tests/fixtures/318-retire-plan-cycle-lessons-native-qualification.json after 317's, and commit the fixture"
    )
    assert evidence["migration"] == c0.SUCCESSOR_318
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_318_SHA256
    assert evidence["qualified_successor"] == registered(318)
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    assert evidence["native_fixture"]["all_passed"] is True
