"""Exact312 delivery: ordered admission, the operator API's metric reads, unchanged seals, native evidence.

#1633 package 6: the operator API (verdify_dashboard_runtime) gets SELECT on daily_band_compliance and daily_record
and on v_dashboard_energy, a column projection of energy. energy's own ACL is unchanged, because the ordinary digest
hashes it (energy carries ingestor and MCP entries). Every seal keeps 311's value. test_native_qualification_is_recorded
is the merge gate for the rolled-back production run that measures the seals and runs
db/qualification/312-operator-metrics-reads-fixture.sql.
"""

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PREDECESSOR = 311
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclasses resolve their module while the file executes
    spec.loader.exec_module(module)
    return module


c0 = load("metrics312_delivery", "c0-migration-delivery.py")
six = load("metrics312_six", "bootstrap-six-runtime-roles.py")
maintenance = load("metrics312_maintenance", "bootstrap-maintenance-runtime-roles.py")
qualifier = load("metrics312_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_312
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/312-operator-metrics-reads-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/312-operator-metrics-reads-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 313)]


def uncommented(text):
    return re.sub(r"--[^\n]*", "", text)


BODY = uncommented(SOURCE.split("END $predecessor$;", 1)[1].split("DO $successor$", 1)[0])


def later():
    return [c0.SUCCESSOR_254] + [getattr(c0, f"SUCCESSOR_{n}") for n in NUMBERS]


def files():
    return {getattr(c0, f"SUCCESSOR_{n}"): getattr(c0, f"SUCCESSOR_{n}_SHA256") for n in NUMBERS}


def registered(n):
    digests = getattr(c0, f"SUCCESSOR_{n}_DIGESTS")
    return {"api": digests[API], "ingestor": digests[INGESTOR], "mcp": getattr(c0, f"SUCCESSOR_{n}_MCP_DIGEST")}


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    raw = MIGRATION.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == c0.SUCCESSOR_312_SHA256 == six.OPERATOR_METRICS_READS_MIGRATION[2]
    assert (
        six.OPERATOR_METRICS_READS_MIGRATION[:2] == (312, c0.SUCCESSOR_312) == (312, "312-operator-metrics-reads.sql")
    )
    c0.reviewed_post_254(later(), files())
    with pytest.raises(c0.DeliveryError, match="312 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_312: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["312-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_successor_keeps_every_seal_and_binds_its_exact_ledger_row():
    predecessor = getattr(six, f"SUCCESSOR_{PREDECESSOR}")
    assert six.SUCCESSOR_312 == predecessor == registered(PREDECESSOR) == registered(312)
    assert c0.SUCCESSOR_312_DIGESTS == {API: six.SUCCESSOR_312["api"], INGESTOR: six.SUCCESSOR_312["ingestor"]}
    old = six.seal_profile_sql(PREDECESSOR, predecessor)
    expected = "(" + getattr(six, f"sealed_sql_{PREDECESSOR}")().replace(
        old, six.seal_profile_sql(312, six.SUCCESSOR_312), 1
    )
    expected += " AND " + six.ledger_row_sql(*six.OPERATOR_METRICS_READS_MIGRATION) + ")"
    assert six.sealed_sql_312() == expected
    assert "(SELECT max(seq) FROM public.schema_migrations WHERE source='db/migrations')=312" in expected
    assert six.sealed_sql().count(" OR " + getattr(six, f"sealed_sql_{PREDECESSOR}")() + " OR " + expected) == 1
    assert maintenance.contract_sql().count(" OR " + six.sealed_sql_312()) == 1
    assert '"312-operator-metrics-reads.sql",' in (ROOT / "tests/test_experiment_schema_migration.py").read_text()
    assert "tests/test_312_operator_metrics_reads_delivery.py" in (ROOT / "scripts/ci-local.sh").read_text()


def test_migration_pins_its_predecessor_and_proves_the_seals_unchanged():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in SOURCE
    assert f"sha256='{sha}'" in SOURCE
    assert f"seq>{PREDECESSOR})" in SOURCE
    for digest in registered(312).values():
        assert SOURCE.count(f"'{digest}'") == 2
    assert qualifier.successor_literals(SOURCE) == six.SUCCESSOR_312
    assert "'312 refuses an unqualified predecessor'" in SOURCE and "'312 changed a runtime boundary'" in SOURCE
    assert "UPDATE public.runtime_ordinary_login_attestation_receipts" not in SOURCE
    assert "UPDATE public.mcp_runtime_boundary_receipt" not in SOURCE


def test_file_is_wrap_safe_and_every_session_ends_in_rollback():
    assert not safety.classify(MIGRATION).self_committing
    qualifier.refuse_transaction_control(SOURCE)
    code = uncommented(SOURCE).upper()
    for forbidden in (r"\bCOMMIT\b", r"CONCURRENTLY", r"VACUUM", r"ALTER SYSTEM", r"PASSWORD", r"\bTRIGGER\b"):
        assert not re.search(forbidden, code), forbidden
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name
        assert sql.count("ROLLBACK;") == 1 and "COMMIT" not in sql.upper().replace("ON COMMIT DROP", ""), name


def test_the_body_grants_three_reads_to_the_dashboard_duty_and_nothing_else():
    grants = [" ".join(g.split()) for g in re.findall(r"\bGRANT\b.*?;", BODY, re.S)]
    assert grants == [
        "GRANT SELECT ON public.daily_band_compliance, public.daily_record, public.v_dashboard_energy "
        "TO verdify_dashboard_runtime;"
    ]
    assert "REVOKE" not in BODY and "SECURITY DEFINER" not in BODY and "FUNCTION" not in BODY
    assert re.findall(r"CREATE (?:OR REPLACE )?VIEW (\S+)", BODY) == ["public.v_dashboard_energy"]
    for statement in ("CREATE TABLE", "ALTER ", "DROP ", "DELETE", "UPDATE", "INSERT", "TRUNCATE", "RENAME"):
        assert statement not in BODY, statement
    for runtime in ("verdify_api_runtime", "verdify_ingestor_runtime", "verdify_mcp", "PUBLIC"):
        assert runtime not in BODY, runtime
    # energy itself gains no entry: the ordinary digest hashes its relacl (ingestor and MCP entries).
    assert not re.search(r"\bON\s+(?:TABLE\s+)?public\.energy\b", BODY)


def test_the_energy_projection_is_the_meter_columns_only():
    view = " ".join(SOURCE.split("CREATE VIEW public.v_dashboard_energy AS", 1)[1].split(";", 1)[0].split())
    assert view == (
        "SELECT e.ts, e.greenhouse_id, e.kwh_today, e.ch0_power_w, e.ch1_power_w, "
        "e.ch0_source_ts, e.ch1_source_ts, e.ch0_quality, e.ch1_quality FROM public.energy e"
    )


def test_the_operator_api_reads_only_granted_relations():
    metrics = (ROOT / "api/product_metrics.py").read_text()
    assert "public.v_dashboard_energy" in metrics
    assert not re.search(r"\bFROM\s+(?:public\.)?energy\b", metrics)


def test_native_fixture_reads_as_the_dashboard_login():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    assert "SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;" in text
    assert text.count("RESET SESSION AUTHORIZATION;") == 1
    for relation in ("public.daily_band_compliance", "public.daily_record", "public.v_dashboard_energy"):
        assert f"PERFORM * FROM {relation}" in text
    assert "has_table_privilege(current_user, 'public.energy', 'SELECT')" in text


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_312
    assert evidence["projected_successor"] == six.SUCCESSOR_312 == qualifier.successor_literals(SOURCE)
    assert evidence["before"] == registered(PREDECESSOR)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact312 and its unchanged seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False, (
        "312 native qualification pending: with production at 311 (or earlier, adding --apply-first for each of "
        "310 and 311), run scripts/qualify-migration-successor.py db/migrations/312-operator-metrics-reads.sql "
        "--native-fixture db/qualification/312-operator-metrics-reads-fixture.sql --fixture "
        "tests/fixtures/312-operator-metrics-reads-native-qualification.json on production (every session rolls "
        "back) and commit the fixture it writes"
    )
    assert evidence["migration"] == c0.SUCCESSOR_312
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_312_SHA256
    assert evidence["qualified_successor"] == six.SUCCESSOR_312 == registered(312) == registered(PREDECESSOR)
    assert evidence["before"] == registered(PREDECESSOR)
    assert evidence["before"] == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    native = evidence["native_fixture"]
    assert native["all_passed"] is True
    assert native["attested"] == {"dashboard": True}
