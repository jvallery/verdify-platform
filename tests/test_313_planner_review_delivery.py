"""Exact313 delivery: ordered admission, the review table, the three moved seals, the native gate.

Climate refactor packages 4.2 and 5.1 (#1659, #1660, #1661): the planner is a daily reviewer that writes one row per
review to its own table. The ingestor duty inserts the daily request and records the delivery to Hermes; the MCP
duty inserts a manual request and stores the review. The rolled-back production probe measured all three seals
moving, so all three receipts are re-sealed. test_native_qualification_is_recorded is the merge gate.
"""

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PREDECESSOR = 312
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"
ING_DUTY, MCP_DUTY = "verdify_ingestor_runtime", "verdify_mcp_runtime"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


c0 = load("review313_delivery", "c0-migration-delivery.py")
six = load("review313_six", "bootstrap-six-runtime-roles.py")
maintenance = load("review313_maintenance", "bootstrap-maintenance-runtime-roles.py")
qualifier = load("review313_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_313
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/313-planner-review-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/313-planner-review-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 314)]


def uncommented(text):
    return re.sub(r"--[^\n]*", "", text)


BODY = uncommented(SOURCE.split("END $predecessor$;", 1)[1].split("DO $successor$", 1)[0])
SUCCESSOR_BLOCK = SOURCE[SOURCE.index("DO $successor$") :]


def later():
    return [c0.SUCCESSOR_254] + [getattr(c0, f"SUCCESSOR_{n}") for n in NUMBERS]


def files():
    return {getattr(c0, f"SUCCESSOR_{n}"): getattr(c0, f"SUCCESSOR_{n}_SHA256") for n in NUMBERS}


def registered(n):
    digests = getattr(c0, f"SUCCESSOR_{n}_DIGESTS")
    return {"api": digests[API], "ingestor": digests[INGESTOR], "mcp": getattr(c0, f"SUCCESSOR_{n}_MCP_DIGEST")}


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    assert hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == c0.SUCCESSOR_313_SHA256
    assert six.PLANNER_REVIEW_MIGRATION == (313, c0.SUCCESSOR_313, c0.SUCCESSOR_313_SHA256)
    assert c0.SUCCESSOR_313 == "313-planner-review.sql"
    c0.reviewed_post_254(later(), files())
    c0.reviewed_post_254(later()[:-1], files())
    with pytest.raises(c0.DeliveryError, match="313 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_313: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["313-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_file_is_wrap_safe_and_every_session_ends_in_rollback():
    assert not safety.classify(MIGRATION).self_committing
    qualifier.refuse_transaction_control(SOURCE)
    code = uncommented(SOURCE).upper()
    for forbidden in (r"\bCOMMIT\b", r"CONCURRENTLY", r"VACUUM", r"ALTER SYSTEM", r"PASSWORD", r"\bTRIGGER\b"):
        assert not re.search(forbidden, code), forbidden
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name


def test_predecessor_binds_exact312_with_its_registered_seals():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    block = SOURCE[SOURCE.index("DO $predecessor$") : SOURCE.index("END $predecessor$;")]
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in block and f"sha256='{sha}'" in block
    assert f"seq>{PREDECESSOR})" in block and "stamp_method='runner'" in block
    assert "to_regclass('public.planner_review') IS NOT NULL" in block
    assert "to_regclass('public.v_daily_record') IS NULL" in block
    for seal, digest in registered(PREDECESSOR).items():
        assert block.count(f"'hex') IS DISTINCT FROM '{digest}'") == 1, seal


def test_successor_reseals_all_three_receipts_with_the_probe_literals():
    literals = qualifier.successor_literals(SOURCE)
    assert literals == registered(313) == {k: six.SUCCESSOR_313[k] for k in ("api", "ingestor", "mcp")}
    for seal in ("api", "ingestor", "mcp"):
        assert literals[seal] != registered(PREDECESSOR)[seal], seal
    assert json.loads(FIXTURE.read_text())["projected_successor"] == literals
    assert SUCCESSOR_BLOCK.count("UPDATE public.runtime_ordinary_login_attestation_receipts") == 2
    for login in (API, INGESTOR):
        seal = "api" if login == API else "ingestor"
        assert f"decode('{literals[seal]}','hex'), captured_at=clock_timestamp() WHERE login_name='{login}'" in (
            SUCCESSOR_BLOCK
        )
    assert f"decode('{literals['mcp']}','hex') WHERE singleton;" in SUCCESSOR_BLOCK


def test_body_grants_exactly_the_ingestor_and_mcp_duties():
    grants = [" ".join(g.split()) for g in re.findall(r"\bGRANT\b.*?;", BODY, re.S)]
    assert grants == [
        f"GRANT SELECT ON public.planner_review TO {ING_DUTY};",
        f"GRANT INSERT (run_id, kind, review_date, requested_by) ON public.planner_review TO {ING_DUTY};",
        "GRANT UPDATE (status, attempts, delivered_at, hermes_run_id, gateway_status, failure, run_finished_at, "
        f"input_tokens, output_tokens, total_tokens) ON public.planner_review TO {ING_DUTY};",
        f"GRANT SELECT ON public.v_daily_record TO {ING_DUTY};",
        f"GRANT SELECT ON public.planner_review TO {MCP_DUTY};",
        f"GRANT INSERT (run_id, kind, review_date, requested_by) ON public.planner_review TO {MCP_DUTY};",
        f"GRANT UPDATE (status, written_at, summary, band_proposal) ON public.planner_review TO {MCP_DUTY};",
    ]
    assert not re.search(r"\bTO PUBLIC\b|DEFAULT PRIVILEGES|\bOWNER TO\b|\bDROP\b|\bTRUNCATE\b|\bREVOKE\b", BODY)
    assert "GENERATED ALWAYS AS IDENTITY" in BODY
    assert "planner_review_daily_uidx ON public.planner_review (review_date) WHERE kind = 'daily'" in BODY
    # Nothing the public site reads is touched (RULINGS C4).
    for kept in ("plan_journal", "setpoint_plan", "plan_delivery_log", "planner_trigger_ledger", "v_active_plan"):
        assert kept not in BODY, kept


def test_the_table_matches_the_review_schema():
    from verdify_schemas import review

    failures = re.search(r"failure IN \(([^)]*)\)", BODY, re.S)[1]
    assert {f.strip().strip("'") for f in failures.split(",")} == set(review.ReviewFailure.__args__)
    statuses = re.search(r"status IN \('requested', 'delivered', 'written', 'failed'\)", BODY)
    assert statuses and set(review.ReviewStatus.__args__) == {"requested", "delivered", "written", "failed"}
    assert "length(summary) BETWEEN 1 AND 4000" in BODY and review.REVIEW_SUMMARY_MAX_CHARS == 4000


def test_sealed_sql_313_chains_from_312_and_binds_the_exact_ledger_row():
    old = six.seal_profile_sql(PREDECESSOR, six.SUCCESSOR_312)
    expected = "(" + six.sealed_sql_312().replace(old, six.seal_profile_sql(313, six.SUCCESSOR_313), 1)
    expected += " AND " + six.ledger_row_sql(*six.PLANNER_REVIEW_MIGRATION) + ")"
    assert six.sealed_sql_313() == expected
    assert "(SELECT max(seq) FROM public.schema_migrations WHERE source='db/migrations')=313" in expected
    assert six.sealed_sql().count(" OR " + six.sealed_sql_312() + " OR " + expected) == 1
    assert maintenance.contract_sql().count(" OR " + six.sealed_sql_313()) == 1
    assert '"313-planner-review.sql",' in (ROOT / "tests/test_experiment_schema_migration.py").read_text()
    assert "tests/test_313_planner_review_delivery.py" in (ROOT / "scripts/ci-local.sh").read_text()


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact313 and its measured seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False, (
        "313 native qualification pending: measure the ingestor and MCP literals with "
        "scripts/qualify-migration-successor.py db/migrations/313-planner-review.sql --probe-only, write them into "
        "the file and its registrations, then run it with --native-fixture db/qualification/313-planner-review-"
        "fixture.sql --fixture tests/fixtures/313-planner-review-native-qualification.json and commit the fixture"
    )
    assert evidence["migration"] == c0.SUCCESSOR_313
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_313_SHA256
    assert evidence["qualified_successor"] == registered(313)
    assert evidence["before"] == registered(PREDECESSOR) == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    assert evidence["native_fixture"]["all_passed"] is True
