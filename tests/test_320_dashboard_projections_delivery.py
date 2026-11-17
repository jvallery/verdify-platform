"""Exact320 delivery: ordered admission, the dashboard's three projections, unchanged seals, native evidence.

The operator API (verdify_dashboard_runtime) reads the daily review, the per-relay daily record and the gap-replay
ledger through v_dashboard_review, v_dashboard_relay_day and v_dashboard_gap_replay, column projections of
planner_review, daily_relay_record and gap_replay_quarters owned by verdify with SELECT to the dashboard duty alone.
The tables' own ACLs are unchanged, because the ordinary and MCP digests hash them (they carry ingestor and MCP
entries). Every seal keeps 319's value. test_native_qualification_is_recorded is the merge gate for the rolled-back
production run that measures the seals and runs db/qualification/320-dashboard-projections-fixture.sql.
"""

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PREDECESSOR = 319
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclasses resolve their module while the file executes
    spec.loader.exec_module(module)
    return module


c0 = load("projections320_delivery", "c0-migration-delivery.py")
six = load("projections320_six", "bootstrap-six-runtime-roles.py")
maintenance = load("projections320_maintenance", "bootstrap-maintenance-runtime-roles.py")
qualifier = load("projections320_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_320
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/320-dashboard-projections-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/320-dashboard-projections-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 321)]
VIEWS = {
    "v_dashboard_review": (
        "planner_review",
        "r",
        [
            "id", "kind", "review_date", "requested_at", "requested_by", "status", "attempts", "delivered_at",
            "failure", "run_finished_at", "input_tokens", "output_tokens", "total_tokens", "written_at", "summary",
            "band_proposal",
        ],
    ),
    "v_dashboard_relay_day": (
        "daily_relay_record",
        "d",
        ["date", "greenhouse_id", "equipment", "starts", "run_s", "event_run_s", "repaired_runs", "computed_at"],
    ),
    "v_dashboard_gap_replay": (
        "gap_replay_quarters",
        "q",
        ["boot", "qseq", "first_ts", "last_ts", "climate_rows", "transition_rows", "format_version", "received_at"],
    ),
}  # fmt: skip


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


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    raw = MIGRATION.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == c0.SUCCESSOR_320_SHA256 == six.DASHBOARD_PROJECTIONS_MIGRATION[2]
    assert six.DASHBOARD_PROJECTIONS_MIGRATION[:2] == (320, c0.SUCCESSOR_320) == (320, "320-dashboard-projections.sql")
    c0.reviewed_post_254(later(), files())
    c0.reviewed_post_254(later()[:-1], files())
    with pytest.raises(c0.DeliveryError, match="320 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_320: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["320-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_successor_keeps_every_seal_and_binds_its_exact_ledger_row():
    predecessor = getattr(six, f"SUCCESSOR_{PREDECESSOR}")
    assert six.SUCCESSOR_320 == predecessor
    assert registered(320) == registered(PREDECESSOR) == {k: six.SUCCESSOR_320[k] for k in ("api", "ingestor", "mcp")}
    assert c0.SUCCESSOR_320_DIGESTS == {API: six.SUCCESSOR_320["api"], INGESTOR: six.SUCCESSOR_320["ingestor"]}
    old = six.seal_profile_sql(PREDECESSOR, predecessor)
    expected = "(" + getattr(six, f"sealed_sql_{PREDECESSOR}")().replace(
        old, six.seal_profile_sql(320, six.SUCCESSOR_320), 1
    )
    expected += " AND " + six.ledger_row_sql(*six.DASHBOARD_PROJECTIONS_MIGRATION) + ")"
    assert six.sealed_sql_320() == expected
    assert "(SELECT max(seq) FROM public.schema_migrations WHERE source='db/migrations')=320" in expected
    assert six.sealed_sql().count(" OR " + getattr(six, f"sealed_sql_{PREDECESSOR}")() + " OR " + expected) == 1
    assert maintenance.contract_sql().count(" OR " + six.sealed_sql_320()) == 1
    assert '"320-dashboard-projections.sql",' in (ROOT / "tests/test_experiment_schema_migration.py").read_text()
    assert "tests/test_320_dashboard_projections_delivery.py" in (ROOT / "scripts/ci-local.sh").read_text()


def test_migration_pins_exact319_and_proves_the_seals_unchanged():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    assert hashlib.sha256((ROOT / "db/migrations" / name).read_bytes()).hexdigest() == sha
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in PRED_BLOCK and f"sha256='{sha}'" in PRED_BLOCK
    assert f"seq>{PREDECESSOR})" in PRED_BLOCK and "stamp_method='runner'" in PRED_BLOCK
    # 319's successor block left these seals in force; both of 320's blocks pin them once each.
    assert qualifier.successor_literals((ROOT / "db/migrations" / name).read_text()) == registered(PREDECESSOR)
    for seal, digest in registered(320).items():
        assert PRED_BLOCK.count(f"'hex') IS DISTINCT FROM '{digest}'") == 1, seal
        assert SUCCESSOR_BLOCK.count(f"'hex') IS DISTINCT FROM '{digest}'") == 1, seal
        assert SOURCE.count(f"'{digest}'") == 2, seal
    assert qualifier.successor_literals(SOURCE) == registered(PREDECESSOR)
    assert "'320 refuses an unqualified predecessor'" in SOURCE and "'320 changed a runtime boundary'" in SOURCE
    assert "UPDATE public.runtime_ordinary_login_attestation_receipts" not in SOURCE
    assert "UPDATE public.mcp_runtime_boundary_receipt" not in SOURCE


def test_the_blocks_guard_the_projections_and_the_base_tables():
    for view, (table, _, columns) in VIEWS.items():
        assert f"to_regclass('public.{view}') IS NOT NULL" in PRED_BLOCK
        assert f"'public.{table}'::regclass" in PRED_BLOCK
        assert f"'public.{view}'::regclass" in SUCCESSOR_BLOCK
        assert f"'public.{table}'::regclass" in SUCCESSOR_BLOCK
        assert f"))<>{len(columns)}" in PRED_BLOCK
    # The successor requires the owner's entry, no PUBLIC entry, one non-grantable dashboard SELECT, no column ACL,
    # and the base tables' ACLs exactly as the predecessor read them.
    for clause in (
        "WHERE a.grantee = c.relowner",
        "WHERE a.grantee = 0",
        "WHERE a.grantee <> c.relowner) <> 1",
        "AND a.privilege_type='SELECT' AND NOT a.is_grantable",
        "AND t.attnum > 0 AND t.attacl IS NOT NULL",
    ):
        assert clause in SUCCESSOR_BLOCK, clause
    assert PRED_BLOCK.count("set_config('verdify_migration_320.base_acls'") == 1
    assert SUCCESSOR_BLOCK.count("current_setting('verdify_migration_320.base_acls', true)") == 2
    fingerprint = PRED_BLOCK[PRED_BLOCK.index("SELECT md5(") : PRED_BLOCK.index(", true);")]
    assert " ".join(fingerprint.split()) in " ".join(SUCCESSOR_BLOCK.split())


def test_file_is_wrap_safe_and_every_session_ends_in_rollback():
    assert not safety.classify(MIGRATION).self_committing
    qualifier.refuse_transaction_control(SOURCE)
    code = uncommented(SOURCE).upper()
    for forbidden in (r"\bCOMMIT\b", r"CONCURRENTLY", r"VACUUM", r"ALTER SYSTEM", r"PASSWORD", r"\bTRIGGER\b"):
        assert not re.search(forbidden, code), forbidden
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name
        assert sql.count("ROLLBACK;") == 1 and "COMMIT" not in sql.upper().replace("ON COMMIT DROP", ""), name
    # New views only: the qualifier locks nothing beyond the ledger and receipt tables.
    assert set(qualifier.locked_relations(SOURCE)) == {
        "public.schema_migrations",
        "public.runtime_ordinary_login_attestation_receipts",
        "public.mcp_runtime_boundary_receipt",
    }


def test_the_body_creates_three_projections_and_grants_them_to_the_dashboard_duty_alone():
    grants = [" ".join(g.split()) for g in re.findall(r"\bGRANT\b.*?;", BODY, re.S)]
    assert grants == [
        "GRANT SELECT ON public.v_dashboard_review, public.v_dashboard_relay_day, public.v_dashboard_gap_replay "
        "TO verdify_dashboard_runtime;"
    ]
    revokes = [" ".join(r.split()) for r in re.findall(r"\bREVOKE\b.*?;", BODY, re.S)]
    assert revokes == [
        "REVOKE ALL ON public.v_dashboard_review, public.v_dashboard_relay_day, public.v_dashboard_gap_replay "
        "FROM PUBLIC;"
    ]
    assert "SECURITY DEFINER" not in BODY and "FUNCTION" not in BODY
    assert re.findall(r"CREATE (?:OR REPLACE )?VIEW (\S+)", BODY) == [f"public.{view}" for view in VIEWS]
    for statement in ("CREATE TABLE", "ALTER ", "DROP ", "DELETE", "UPDATE", "INSERT", "TRUNCATE", "RENAME"):
        assert statement not in BODY, statement
    for runtime in ("verdify_api_runtime", "verdify_ingestor_runtime", "verdify_mcp"):
        assert runtime not in BODY, runtime
    # No base table gains an entry: the digests hash their relacl (ingestor and MCP entries).
    for table, _, _ in VIEWS.values():
        assert not re.search(rf"\bON\s+(?:TABLE\s+)?public\.{table}\b", BODY), table


def test_each_projection_is_exactly_its_specified_columns():
    for view, (table, alias, columns) in VIEWS.items():
        text = " ".join(SOURCE.split(f"CREATE VIEW public.{view} AS", 1)[1].split(";", 1)[0].split())
        selected = ", ".join(f"{alias}.{column}" for column in columns)
        assert text == f"SELECT {selected} FROM public.{table} {alias}", view
        assert f"COMMENT ON VIEW public.{view} IS" in SOURCE


def test_native_fixture_checks_columns_grants_and_reads_as_the_dashboard_login():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    assert "SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;" in text
    assert "SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;" in text
    assert text.count("RESET SESSION AUTHORIZATION;") == 1
    assert "'verdify|{verdify=arwdDxt/verdify,verdify_dashboard_runtime=r/verdify}'" in text
    assert text.count("EXCEPTION WHEN insufficient_privilege THEN NULL;") == len(VIEWS)
    flat = " ".join(text.split()).replace("' '", "")
    for view, (table, _, columns) in VIEWS.items():
        assert f"PERFORM * FROM public.{view} " in text, view
        assert f"PERFORM 1 FROM public.{view} LIMIT 1;" in text, view
        assert f"'{','.join(columns)}'" in flat, view
        # Every table privilege and every column privilege, whoever holds it (the login, its duty or PUBLIC).
        assert (
            f"has_table_privilege(current_user, 'public.{table}', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')"
            in text
        ), table
        assert f"has_any_column_privilege(current_user, 'public.{table}', 'SELECT,INSERT,UPDATE,REFERENCES')" in text, (
            table
        )
    # No statement writes: privilege names inside string literals are not statements.
    assert not re.search(r"\b(INSERT|UPDATE|DELETE)\b", re.sub(r"'[^']*'", "''", uncommented(text)))
    assert text.strip().splitlines()[-1].endswith("'attested', json_build_object('dashboard', true))::text;")


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact320 and its unchanged seals."""
    assert FIXTURE.exists(), (
        "320 native qualification pending: with production at 319, run scripts/qualify-migration-successor.py "
        "db/migrations/320-dashboard-projections.sql --native-fixture "
        "db/qualification/320-dashboard-projections-fixture.sql --fixture "
        "tests/fixtures/320-dashboard-projections-native-qualification.json on production (every session rolls "
        "back) and commit the fixture it writes"
    )
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False
    assert evidence["migration"] == c0.SUCCESSOR_320
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_320_SHA256
    assert evidence["qualified_successor"] == registered(320) == registered(PREDECESSOR)
    assert evidence["qualified_successor"] == qualifier.successor_literals(SOURCE)
    assert evidence["before"] == registered(PREDECESSOR)
    assert evidence["before"] == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    native = evidence["native_fixture"]
    assert native["all_passed"] is True
    assert native["attested"] == {"dashboard": True}
