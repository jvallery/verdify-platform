"""Exact311 delivery: ordered admission, one compliance definition, unchanged seals, native evidence.

#1667 and plan section 9 (climate refactor, epic #1633): fn_band_compliance_5m is the one definition and every
database reader reads its copy in daily_summary. 311 stores August from the first day the band audit rows still
cover (the 2026-09-01 break), adds the minutes above the band with the vent and both fans on (capacity, beside the
grade) and appends them and the night dry-out minutes to v_daily_scorecard. Every seal keeps 310's value.
tests/test_dashboard_db_full_cooling_311.py proves the capacity count and the scorecard on a private database;
test_native_qualification_is_recorded is the merge gate for the rolled-back production run (production at 310, or at
309 with --apply-first 310) that measures the seals and runs db/qualification/311-one-compliance-definition-fixture.sql.
"""

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PREDECESSOR = 310
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclasses resolve their module while the file executes
    spec.loader.exec_module(module)
    return module


c0 = load("compliance311_delivery", "c0-migration-delivery.py")
six = load("compliance311_six", "bootstrap-six-runtime-roles.py")
maintenance = load("compliance311_maintenance", "bootstrap-maintenance-runtime-roles.py")
qualifier = load("compliance311_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_311
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/311-one-compliance-definition-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/311-one-compliance-definition-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 312)]


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


# ── Admission and the file ──────────────────────────────────────────────────


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    raw = MIGRATION.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == c0.SUCCESSOR_311_SHA256 == six.COMPLIANCE_DEFINITION_MIGRATION[2]
    assert (
        six.COMPLIANCE_DEFINITION_MIGRATION[:2] == (311, c0.SUCCESSOR_311) == (311, "311-one-compliance-definition.sql")
    )
    c0.reviewed_post_254(later(), files())
    with pytest.raises(c0.DeliveryError, match="311 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_311: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["311-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_successor_keeps_every_seal_and_binds_its_exact_ledger_row():
    predecessor = getattr(six, f"SUCCESSOR_{PREDECESSOR}")
    assert six.SUCCESSOR_311 == predecessor == registered(PREDECESSOR) == registered(311)
    assert c0.SUCCESSOR_311_DIGESTS == {API: six.SUCCESSOR_311["api"], INGESTOR: six.SUCCESSOR_311["ingestor"]}
    old = six.seal_profile_sql(PREDECESSOR, predecessor)
    expected = "(" + getattr(six, f"sealed_sql_{PREDECESSOR}")().replace(
        old, six.seal_profile_sql(311, six.SUCCESSOR_311), 1
    )
    expected += " AND " + six.ledger_row_sql(*six.COMPLIANCE_DEFINITION_MIGRATION) + ")"
    assert six.sealed_sql_311() == expected
    assert "(SELECT max(seq) FROM public.schema_migrations WHERE source='db/migrations')=311" in expected
    assert "stamp_method='runner'" in six.ledger_row_sql(*six.COMPLIANCE_DEFINITION_MIGRATION)
    assert six.sealed_sql().count(" OR " + getattr(six, f"sealed_sql_{PREDECESSOR}")() + " OR " + expected) == 1
    assert maintenance.contract_sql().count(" OR " + six.sealed_sql_311()) == 1
    assert '"311-one-compliance-definition.sql",' in (ROOT / "tests/test_experiment_schema_migration.py").read_text()
    assert "tests/test_311_one_compliance_definition_delivery.py" in (ROOT / "scripts/ci-local.sh").read_text()


def test_migration_pins_its_predecessor_and_proves_the_seals_unchanged():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in SOURCE
    assert f"sha256='{sha}'" in SOURCE
    assert f"seq>{PREDECESSOR})" in SOURCE
    for digest in registered(311).values():
        assert SOURCE.count(f"'{digest}'") == 2
    assert qualifier.successor_literals(SOURCE) == six.SUCCESSOR_311
    assert "'311 refuses an unqualified predecessor'" in SOURCE and "'311 changed a runtime boundary'" in SOURCE
    # Nothing is re-sealed: the receipts already hold these digests.
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


# ── The body ────────────────────────────────────────────────────────────────


M290 = (ROOT / "db/migrations/290-band-compliance.sql").read_text()
M305 = (ROOT / "db/migrations/305-band-nightly-dryout.sql").read_text()


def test_the_body_only_adds_and_keeps_every_grant():
    assert re.findall(r"CREATE (?:OR REPLACE )?FUNCTION (\S+)\(", BODY) == [
        "public.fn_band_full_cooling_min",
        "public.fn_band_compliance_store",
    ]
    assert re.findall(r"CREATE (?:OR REPLACE )?VIEW (\S+)", BODY) == ["public.v_daily_scorecard"]
    assert "GRANT" not in BODY and "SECURITY DEFINER" not in BODY
    revokes = [" ".join(r.split()) for r in re.findall(r"\bREVOKE\b.*?;", BODY, re.S)]
    assert revokes == ["REVOKE ALL ON FUNCTION public.fn_band_full_cooling_min(date) FROM PUBLIC;"]
    for statement in ("CREATE TABLE", "DROP ", "DELETE", "TRUNCATE", "RENAME"):
        assert statement not in BODY, statement
    # daily_summary is written only by the replaced store's copy (305's text), never directly.
    assert BODY.count("UPDATE public.daily_summary") == 1
    assert BODY.index("UPDATE public.daily_summary") < BODY.index("$store$;")
    # The only ALTER adds one nullable column and its bound.
    alters = [" ".join(a.split()) for a in re.findall(r"\bALTER TABLE\b.*?;", BODY, re.S)]
    assert alters == [
        "ALTER TABLE public.daily_band_compliance ADD COLUMN temp_above_full_cooling_min integer, "
        "ADD CONSTRAINT daily_band_compliance_full_cooling_minutes CHECK ( temp_above_full_cooling_min IS NULL "
        "OR temp_above_full_cooling_min BETWEEN 0 AND temp_above_min);"
    ]
    for runtime in ("verdify_api_runtime", "verdify_ingestor_runtime", "verdify_mcp", "verdify_dashboard"):
        assert runtime not in BODY, runtime


def test_the_scorecard_keeps_290s_columns_and_appends_two():
    old = M290.split("CREATE OR REPLACE VIEW public.v_daily_scorecard AS", 1)[1].split("\n\nCOMMENT ON VIEW", 1)[0]
    new = SOURCE.split("CREATE OR REPLACE VIEW public.v_daily_scorecard AS", 1)[1].split(";\nCOMMENT ON VIEW", 1)[0]
    head, tail = old.split("    b.reconstructed_pct AS band_reconstructed_pct\n", 1)
    assert new + ";" == (
        head
        + "    b.reconstructed_pct AS band_reconstructed_pct,\n"
        + "    -- 311 (#1667): the night and the capacity, beside the grade.\n"
        + "    b.night_dryout_min,\n"
        + "    b.temp_above_full_cooling_min\n"
        + tail
    )


def test_the_store_is_305s_with_the_capacity_minutes():
    old = M305.split("AS $store$", 1)[1].split("$store$;", 1)[0]
    new = SOURCE.split("AS $store$", 1)[1].split("$store$;", 1)[0]
    assert "LEAST(public.fn_band_full_cooling_min(p_day), d.temp_above_min)" in new
    assert "temp_above_full_cooling_min = EXCLUDED.temp_above_full_cooling_min" in new
    # Everything from the daily_summary copy on is 305's text, and so 290's.
    assert new.split("RETURNING t.* INTO stored;", 1)[1] == old.split("RETURNING t.* INTO stored;", 1)[1]


def test_full_cooling_is_vent_and_both_fans_for_the_whole_bucket():
    fn = " ".join(SOURCE.split("AS $cooling$", 1)[1].split("$cooling$;", 1)[0].split())
    assert "public.fn_band_compliance_5m(w.opens, w.closes) g WHERE g.temp_grade = 1" in fn
    assert "e.equipment IN ('vent', 'fan1', 'fan2')" in fn
    assert "x.state AND x.on_at <= h.bucket AND COALESCE(x.off_at, now()) >= h.bucket + interval '5 minutes') = 3" in fn


def test_the_backfill_starts_at_the_first_covered_day_and_stops_at_august():
    backfill = " ".join(SOURCE.split("DO $backfill$", 1)[1].split("END $backfill$;", 1)[0].split())
    assert "s.parameter = 'band_house_temp_low' AND s.zone = 'house'" in backfill
    assert "((first_audit + interval '600 seconds') AT TIME ZONE 'America/Denver')::date + 1" in backfill
    assert "DATE '2026-08-31'" in backfill
    assert "PERFORM public.fn_band_compliance_store(v_day);" in backfill
    # Days before it keep their legacy daily_summary values: the public site reads them (plan 8.10).
    assert "compliance_pct = NULL" not in SOURCE


def test_the_refill_is_bounded_per_statement():
    refills = re.findall(r"UPDATE public\.daily_band_compliance b.*?;", BODY, re.S)
    assert len(refills) == 2
    assert "b.date < DATE '2026-10-01'" in refills[0]


def test_the_series_registry_reads_the_new_columns():
    series = (ROOT / "verdify_services/series.py").read_text()
    assert '"night_dryout_min",' in series and '"temp_above_full_cooling_min",' in series
    assert '"Control VPD"' not in series


# ── The native qualification ────────────────────────────────────────────────


def test_native_fixture_reads_as_the_dashboard_login_and_checks_the_acceptance():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    assert text.index("SET SESSION AUTHORIZATION verdify_matview_refresh_runtime_login;") < text.index(
        "verdify_matview_refresh_runtime.fn_refresh_band_compliance()"
    )
    assert "SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;" in text
    assert text.count("RESET SESSION AUTHORIZATION;") == 2
    assert "v.date = DATE '2026-11-11' AND v.night_dryout_min = 210" in text


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_311
    assert evidence["projected_successor"] == six.SUCCESSOR_311 == qualifier.successor_literals(SOURCE)
    assert evidence["before"] == registered(PREDECESSOR)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact311 and its unchanged seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False, (
        "311 native qualification pending: with production at 310 (or at 309, adding --apply-first "
        "db/migrations/310-daily-record.sql), run scripts/qualify-migration-successor.py "
        "db/migrations/311-one-compliance-definition.sql --native-fixture "
        "db/qualification/311-one-compliance-definition-fixture.sql --fixture "
        "tests/fixtures/311-one-compliance-definition-native-qualification.json on production (every session rolls "
        "back) and commit the fixture it writes"
    )
    assert evidence["migration"] == c0.SUCCESSOR_311
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_311_SHA256
    assert evidence["qualified_successor"] == six.SUCCESSOR_311 == registered(311) == registered(PREDECESSOR)
    assert evidence["before"] == registered(PREDECESSOR)
    assert evidence["before"] == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    native = evidence["native_fixture"]
    assert native["all_passed"] is True
    assert native["attested"] == {"matview_refresh": True, "dashboard": True}
