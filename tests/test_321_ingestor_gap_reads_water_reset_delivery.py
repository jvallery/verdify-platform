"""Exact321 delivery: ordered admission, the three ingestor grants, the replayed-gap mark, the water reset delta, seals.

iso-2 F2 and F4 (#1633, #1734): nothing marked a replayed gap (the ingestor held INSERT only on data_gaps), the
coverage monitor could not read daily_band_compliance, and a water counter reset dropped the gallons used since boot.
321 grants the ingestor UPDATE (backfill_status) on data_gaps and SELECT on v_data_gaps_unreplayed and
daily_band_compliance, marks the gaps replayed so far, and replaces materialize_water_meter_events with 194's text plus
the reset delta. test_dashboard_db_water_reset_321.py runs the function; test_dashboard_db_gap_replay.py runs the
mark. test_native_qualification_is_recorded is the merge gate: the rolled-back production qualification records the
file's measured seals and the native fixture's checks.
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
INGESTOR_PATH = str(ROOT / "ingestor")
if INGESTOR_PATH not in sys.path:
    sys.path.insert(0, INGESTOR_PATH)

import gap_replay  # noqa: E402

PREDECESSOR = 320
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


c0 = load("gapreads321_delivery", "c0-migration-delivery.py")
six = load("gapreads321_six", "bootstrap-six-runtime-roles.py")
qualifier = load("gapreads321_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_321
SOURCE = MIGRATION.read_text()
M194 = (ROOT / "db/migrations/194-scope-aware-resource-accounting.sql").read_text()
NATIVE = ROOT / "db/qualification/321-ingestor-gap-and-compliance-reads-water-reset-delta-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/321-ingestor-gap-and-compliance-reads-water-reset-delta-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 321), 321]
FUNCTION_START = "CREATE OR REPLACE FUNCTION public.materialize_water_meter_events("


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


def function_text(text):
    start = text.index(FUNCTION_START)
    return text[start : text.index("\n$$;", start) + 4]


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    assert hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == c0.SUCCESSOR_321_SHA256
    assert six.INGESTOR_GAP_READS_WATER_RESET_MIGRATION == (321, c0.SUCCESSOR_321, c0.SUCCESSOR_321_SHA256)
    c0.reviewed_post_254(later(), files())
    c0.reviewed_post_254(later()[:-1], files())
    with pytest.raises(c0.DeliveryError, match="321 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_321: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["321-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_file_is_wrap_safe_and_changes_only_the_grants_the_mark_and_the_function():
    assert not safety.classify(MIGRATION).self_committing
    qualifier.refuse_transaction_control(SOURCE)
    code = qualifier._code_only(SOURCE)[0].upper()
    for forbidden in (r"\bCOMMIT\b", r"CONCURRENTLY", r"VACUUM", r"ALTER SYSTEM", r"PASSWORD", r"\bTRUNCATE\b",
                      r"\bDELETE\b", r"\bDROP\b", r"\bALTER\b", r"\bREVOKE\b", r"\bOWNER TO\b", r"SECURITY DEFINER"):  # fmt: skip
        assert not re.search(forbidden, code), forbidden
    assert re.findall(r"\bCREATE\b[^\n]*", code) == [
        "CREATE OR REPLACE FUNCTION PUBLIC.MATERIALIZE_WATER_METER_EVENTS("
    ]
    assert re.findall(r"^GRANT [^;]*;", BODY, re.M) == [
        "GRANT UPDATE (backfill_status) ON public.data_gaps TO verdify_ingestor_runtime;",
        "GRANT SELECT ON public.v_data_gaps_unreplayed TO verdify_ingestor_runtime;",
        "GRANT SELECT ON public.daily_band_compliance TO verdify_ingestor_runtime;",
    ]
    outside_function = BODY.replace(uncommented(function_text(SOURCE)), "")
    assert re.findall(r"(?m)^UPDATE\s+\S+", outside_function) == [
        "UPDATE public.data_gaps",
        "UPDATE public.water_meter_events",
        "UPDATE public.water_meter_events",
    ]
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name


def norm(text):
    return [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith("--")]


def test_the_function_is_194s_with_the_reset_delta_only():
    new, old = function_text(SOURCE), function_text(M194).replace("'migration_194'", "'migration_321'")
    assert "'migration_194'" not in new
    assert "v_after_reset boolean;" in new and new.count("v_last_total := 0;") == 1
    assert "after_counter_reset" in new
    # Every statement of 194 survives; the added lines are the reset delta's.
    added = [line for line in norm(new) if line not in norm(old)]
    assert added == [
        "v_after_reset boolean;",
        "v_zero_ts timestamptz;",
        "v_after_reset := false;",
        "IF r.total_gal < v_last_total THEN",
        "SELECT max(e.ts) INTO v_zero_ts",
        "FROM public.water_meter_events e",
        "WHERE e.greenhouse_id = p_greenhouse_id",
        "AND e.source = 'climate.water_total_gal'",
        "AND e.meter_id = 'main_pulse'",
        "AND e.event_type = 'phantom_zero'",
        "AND e.ts > v_last_total_ts",
        "AND e.ts < r.ts;",
        "v_last_total := 0;",
        "v_last_total_ts := COALESCE(v_zero_ts, v_last_total_ts);",
        "v_after_reset := true;",
        "IF r.total_gal > v_last_total THEN",
        "WHEN v_candidate_count > 1",
        "AND v_candidate_relays <@ ARRAY[",
        "]::text[] THEN 'climate_wetting'",
        "'delta', v_last_total_ts, v_last_total, r.total_gal,",
        "CASE WHEN v_quality = 'high_delta' THEN 0 ELSE v_delta END,",
        "v_quality, jsonb_build_object('materializer', 'migration_321')",
        "|| CASE WHEN v_after_reset THEN jsonb_build_object('after_counter_reset', true)",
        "ELSE '{}'::jsonb END",
        "|| CASE WHEN v_quality = 'high_delta' THEN jsonb_build_object('held_delta_gal', v_delta)",
        "ELSE '{}'::jsonb END,",
    ]
    removed = [line for line in norm(old) if line not in norm(new)]
    assert removed == [
        "ELSIF r.total_gal < v_last_total THEN",
        "ELSIF r.total_gal > v_last_total THEN",
        "'delta', v_last_total_ts, v_last_total, r.total_gal, v_delta,",
        "v_quality, jsonb_build_object('materializer', 'migration_321'),",
    ]
    assert "COMMENT ON FUNCTION public.materialize_water_meter_events(text, timestamptz) IS" in SOURCE


def test_the_backfill_and_the_ingestor_mark_select_the_same_gaps():
    mark = " ".join(gap_replay.MARK_REPLAYED_GAPS_SQL.split())
    backfill = " ".join(
        SOURCE[
            SOURCE.index("UPDATE public.data_gaps g") : SOURCE.index(";", SOURCE.index("UPDATE public.data_gaps g"))
        ].split()
    )
    for clause in (
        "SET backfill_status = 'replayed'",
        "g.end_ts > g.start_ts",
        "g.backfill_status IS DISTINCT FROM 'replayed'",
        "q.first_ts < g.end_ts AND q.last_ts + interval '5 minutes' > g.start_ts",
        "WHERE u.id = g.id",
    ):
        assert clause in mark and clause in backfill, clause
    assert "now() - $1::interval" in mark  # the ingestor bounds its scan; the one-time backfill does not


def test_predecessor_binds_exact320_with_its_registered_seals():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in PRED_BLOCK and f"sha256='{sha}'" in PRED_BLOCK
    assert f"seq>{PREDECESSOR})" in PRED_BLOCK and "stamp_method='runner'" in PRED_BLOCK
    for seal, digest in registered(PREDECESSOR).items():
        assert PRED_BLOCK.count(f"'hex') IS DISTINCT FROM '{digest}'") == 1, seal


def test_the_native_fixture_checks_grants_mark_and_function():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    assert "SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;" in text
    assert text.count("RESET SESSION AUTHORIZATION;") == 1
    assert not re.search(r"\b(INSERT INTO|DELETE FROM)\b", uncommented(text))
    assert text.strip().splitlines()[-1].endswith("'all_passed', true)::text;")


def test_successor_reseals_every_receipt_with_the_registered_literals():
    literals = qualifier.successor_literals(SOURCE)
    assert literals == registered(321)
    assert literals == {k: six.SUCCESSOR_321[k] for k in ("api", "ingestor", "mcp")}
    for login, seal in ((API, "api"), (INGESTOR, "ingestor")):
        assert f"decode('{literals[seal]}','hex'), captured_at=clock_timestamp() WHERE login_name='{login}'" in (
            SUCCESSOR_BLOCK
        )
    assert f"decode('{literals['mcp']}','hex') WHERE singleton;" in SUCCESSOR_BLOCK
    assert "'321 receipts do not match the successor seals'" in SUCCESSOR_BLOCK


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_321
    assert evidence["projected_successor"] == qualifier.successor_literals(SOURCE)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact321 and its measured seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False, (
        "321 native qualification pending: run scripts/qualify-migration-successor.py "
        f"db/migrations/{c0.SUCCESSOR_321} --native-fixture "
        "db/qualification/321-ingestor-gap-and-compliance-reads-water-reset-delta-fixture.sql --fixture "
        "tests/fixtures/321-ingestor-gap-and-compliance-reads-water-reset-delta-native-qualification.json, "
        "and commit the fixture"
    )
    assert evidence["migration"] == c0.SUCCESSOR_321
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_321_SHA256
    assert evidence["qualified_successor"] == registered(321)
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    assert evidence["native_fixture"]["all_passed"] is True
