"""Exact308 delivery: ordered admission, the PAR DLI views, the validity ledger, the dashboard grants, native evidence.

#1184 (DLI slice; the ingest slice is 307): v_dli_current and v_dli_daily integrate canopy PPFD
(climate.ppfd_umol_m2_s) into mol/m2/day over the America/Denver day with provenance par_quantum_sensor_canopy and keep
195's ten columns; the ledger closes dli-validity-v1 and opens dli-validity-v2-par at the migration's now(), with
195's fail-closed CHECK replaced by a PAR-only one; the dashboard duty reads both views. Without PPFD both views stay
unavailable. The numbers (27.5 mol/m2/d, the 10-minute gap, source_coverage_low) are proven on the campaign database
by tests/test_dashboard_db_dli_par_308.py. test_native_qualification_is_recorded is the merge gate for the
rolled-back production run (production at 307) and db/qualification/308-dli-canopy-ppfd-fixture.sql.
"""

import hashlib
import importlib.util
import json
import re
import shutil
import sys
from pathlib import Path

import pytest

from verdify_services import series

ROOT = Path(__file__).resolve().parents[1]
PREDECESSOR = 307
# Merged predecessors not yet applied in production when 308 is qualified (each one --apply-first).
CHAIN = ()
# Production's newest applied migration when the successor is qualified.
LIVE = 307
SEALS = ("api", "ingestor", "mcp")
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"
COLUMNS = (
    "greenhouse_id",
    "crop_dli_mol_m2_day",
    "availability",
    "unavailable_reason",
    "provenance",
    "validity_revision",
    "valid_from",
    "valid_to",
    "forensic_proxy_present",
)


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclasses resolve their module while the file executes
    spec.loader.exec_module(module)
    return module


c0 = load("dli308_delivery", "c0-migration-delivery.py")
six = load("dli308_six", "bootstrap-six-runtime-roles.py")
maintenance = load("dli308_maintenance", "bootstrap-maintenance-runtime-roles.py")
qualifier = load("dli308_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_308
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/308-dli-canopy-ppfd-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/308-dli-canopy-ppfd-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, 301, 302, 303, 304, 305, 306, 307, 308]
FIRST = [ROOT / "db/migrations" / getattr(c0, f"SUCCESSOR_{n}") for n in CHAIN]


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


def view(name):
    return BODY.split(f"CREATE OR REPLACE VIEW public.{name} AS", 1)[1].split(";", 1)[0]


# ── Admission and the file ──────────────────────────────────────────────────


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    raw = MIGRATION.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == c0.SUCCESSOR_308_SHA256 == six.DLI_PAR_MIGRATION[2]
    assert six.DLI_PAR_MIGRATION[:2] == (308, c0.SUCCESSOR_308) == (308, "308-dli-canopy-ppfd.sql")
    c0.reviewed_post_254(later(), files())
    with pytest.raises(c0.DeliveryError, match="308 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_308: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["308-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_successor_binds_its_measured_seals_and_exact_ledger_row():
    predecessor = getattr(six, f"SUCCESSOR_{PREDECESSOR}")
    assert predecessor == registered(PREDECESSOR)
    assert six.SUCCESSOR_308 == registered(308)
    assert c0.SUCCESSOR_308_DIGESTS == {API: six.SUCCESSOR_308["api"], INGESTOR: six.SUCCESSOR_308["ingestor"]}
    old = six.seal_profile_sql(PREDECESSOR, predecessor)
    expected = "(" + six.sealed_sql_307().replace(old, six.seal_profile_sql(308, six.SUCCESSOR_308), 1)
    expected += " AND " + six.ledger_row_sql(*six.DLI_PAR_MIGRATION) + ")"
    assert six.sealed_sql_308() == expected
    assert "(SELECT max(seq) FROM public.schema_migrations WHERE source='db/migrations')=308" in expected
    assert "stamp_method='runner'" in six.ledger_row_sql(*six.DLI_PAR_MIGRATION)
    assert six.sealed_sql().count(" OR " + six.sealed_sql_307() + " OR " + expected) == 1
    assert maintenance.contract_sql().count(" OR " + six.sealed_sql_308()) == 1
    assert '"308-dli-canopy-ppfd.sql",' in (ROOT / "tests/test_experiment_schema_migration.py").read_text()
    assert "tests/test_308_dli_par_delivery.py" in (ROOT / "scripts/ci-local.sh").read_text()


def test_migration_pins_its_predecessor_and_reseals_every_receipt():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in SOURCE
    assert f"sha256='{sha}'" in SOURCE
    assert f"seq>{PREDECESSOR})" in SOURCE
    head = SOURCE.split("DO $successor$", 1)[0]
    assert qualifier.successor_literals(SOURCE) == six.SUCCESSOR_308
    for seal, digest in registered(PREDECESSOR).items():
        assert f"'{digest}'" in head, seal
    successor = SOURCE.split("DO $successor$", 1)[1]
    for login in (API, INGESTOR):
        assert f"WHERE login_name='{login}';" in successor
    assert "UPDATE public.mcp_runtime_boundary_receipt" in successor
    assert "'308 refuses an unqualified predecessor'" in SOURCE and "'308 refuses an unqualified successor'" in SOURCE
    # The preflight requires 195's CHECK, the open v1 interval alone, and the dashboard duty (282).
    for needed in (
        "conname='dli_validity_release_unavailable'",
        "validity_revision='dli-validity-v1' AND valid_to IS NULL",
        "rolname='verdify_dashboard_runtime' AND NOT rolcanlogin",
    ):
        assert needed in head, needed


def test_file_is_wrap_safe_and_every_session_ends_in_rollback():
    assert not safety.classify(MIGRATION).self_committing
    qualifier.refuse_transaction_control(SOURCE)
    code = uncommented(SOURCE).upper()
    for forbidden in (r"\bCOMMIT\b", r"CONCURRENTLY", r"VACUUM", r"ALTER SYSTEM", r"PASSWORD", r"\bTRIGGER\b"):
        assert not re.search(forbidden, code), forbidden
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name
        assert sql.count("ROLLBACK;") == 1, name


# ── The body: two views, the ledger, three grants ───────────────────────────


def test_both_views_keep_195s_ten_columns_in_order():
    current = re.findall(r" AS (\w+),?\n", view("v_dli_current").rsplit("\nSELECT\n", 1)[1])
    daily = re.findall(r" AS (\w+),?\n", view("v_dli_daily").rsplit("\nSELECT\n", 1)[1])
    assert current == ["ts", *COLUMNS]
    assert daily == ["date", *COLUMNS]


def test_views_integrate_ppfd_only_with_the_documented_coverage_rule():
    for name in ("v_dli_current", "v_dli_daily"):
        sql = view(name)
        assert "c.ppfd_umol_m2_s IS NOT NULL" in sql and "AND v.availability = 'available'" in sql, name
        assert "sum(s.ppfd * s.held_s) / 1e6::double precision AS dli" in sql, name
        assert "c.ts + interval '120 seconds'" in sql and "lead(c.ts) OVER (ORDER BY c.ts)" in sql, name
        assert "0.98 * extract(epoch FROM" in sql, name
        assert "'source_reading_missing'" in sql and "'source_coverage_low'" in sql, name
        assert "public.fn_dli_validity(" in sql and "public.fn_dli_source_invalid_reason(g.dli)" in sql, name
        # Never a value from lux, the legacy accumulators or 013's placeholders.
        for absent in ("lux", "dli_par_today", "c.ppfd,", "c.ppfd ", "outdoor", "solar_irradiance"):
            assert absent not in sql, (name, absent)
        assert "dli_today AS" not in sql and "dli_final AS" not in sql, name
    assert "'source_reading_stale'" in view("v_dli_current")
    assert "g.newest_ts < g.window_end - interval '300 seconds'" in view("v_dli_current")
    daily = view("v_dli_daily")
    assert "d.day_start + interval '12 hours'" in daily and "AND d.day_end <= now()" in daily
    assert daily.index("'source_day_incomplete'") < daily.index("'validity_contract_missing'")


def test_ledger_replaces_the_fail_closed_check_and_keeps_v1_history():
    alters = [" ".join(a.split()) for a in re.findall(r"ALTER TABLE[^;]*;", BODY)]
    assert alters == [
        "ALTER TABLE public.dli_validity_intervals DROP CONSTRAINT dli_validity_release_unavailable;",
        "ALTER TABLE public.dli_validity_intervals ADD CONSTRAINT dli_validity_release_par_only CHECK "
        "( availability = 'unavailable' OR (provenance = 'par_quantum_sensor_canopy' AND validity_revision = "
        "'dli-validity-v2-par') );",
    ]
    updates = [" ".join(u.split()) for u in re.findall(r"^UPDATE[^;]*;", BODY, re.M)]
    assert updates == [
        "UPDATE public.dli_validity_intervals SET valid_to = now() WHERE greenhouse_id = 'vallery' AND "
        "validity_revision = 'dli-validity-v1' AND valid_to IS NULL;"
    ]
    insert = " ".join(BODY.split("INSERT INTO public.dli_validity_intervals", 1)[1].split(";", 1)[0].split())
    assert insert.endswith(
        "VALUES ( 'vallery', now(), NULL, 'available', NULL, 'par_quantum_sensor_canopy', 'dli-validity-v2-par', "
        "true, 'migration_308' )"
    )
    for absent in ("DELETE", "TRUNCATE", "DROP VIEW", "DROP FUNCTION", "REVOKE", "PUBLIC", "dli_today =", "SECURITY"):
        assert absent not in BODY, absent


def test_grants_reach_the_dashboard_duty_only():
    grants = [" ".join(g.split()) for g in re.findall(r"\bGRANT\b.*?;", BODY, re.S)]
    assert grants == [
        "GRANT SELECT ON public.v_dli_current, public.v_dli_daily TO verdify_dashboard_runtime;",
        "GRANT SELECT (greenhouse_id, valid_from, valid_to, availability, unavailable_reason, provenance, "
        "validity_revision, operator_validated) ON public.dli_validity_intervals TO verdify_dashboard_runtime;",
        "GRANT EXECUTE ON FUNCTION public.fn_dli_validity(timestamptz, text) TO verdify_dashboard_runtime;",
    ]
    # The same eight ledger columns 217 grants the api and ingestor duties.
    m217 = (ROOT / "db/migrations/217-runtime-role-boundary.sql").read_text()
    assert (
        "GRANT SELECT (greenhouse_id, valid_from, valid_to, availability,\n"
        "              unavailable_reason, provenance, validity_revision,\n"
        "              operator_validated)\n    ON public.dli_validity_intervals" in m217
    )


# ── The registry ────────────────────────────────────────────────────────────


def test_the_registry_keys_daily_dli_on_v_dli_daily():
    binding = series.METRICS["daily.dli_mol_m2_day"]
    assert (binding.label, binding.group, binding.unit, binding.provenance, binding.zone) == (
        "DLI",
        "light",
        "mol/m²/d",
        "DERIVED",
        "house",
    )
    assert binding.raw is None and binding.forecast is None
    assert (binding.cadence_s, binding.retention_days) == (86400, 365)
    daily = binding.daily
    assert (daily.view, daily.source, daily.avg, daily.reason, daily.stamp) == (
        "v_dli_daily",
        "scorecard",
        "crop_dli_mol_m2_day",
        "unavailable_reason",
        None,
    )
    assert 'date, "crop_dli_mol_m2_day", "unavailable_reason", NULL::timestamptz AS stamp' in (
        series.daily_rows_sql("v_dli_daily", ["crop_dli_mol_m2_day", "unavailable_reason"], None)
    )


# ── The native qualification ────────────────────────────────────────────────


def test_native_fixture_reads_as_every_consumer_login():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    for login in (
        "verdify_dashboard_runtime_login",
        "verdify_api_runtime_login",
        "verdify_mcp_runtime_login",
        "verdify_grafana_runtime_login",
        "verdify_lab_publisher_runtime_login",
    ):
        assert f"SET SESSION AUTHORIZATION {login};" in text, login
    assert text.count("RESET SESSION AUTHORIZATION;") == 5
    assert "'unavailable/source_reading_missing/par_quantum_sensor_canopy/dli-validity-v2-par'" in text


def measured_against(evidence, chain):
    """The seals the successor ran on: its predecessor's after `chain` was applied in-session, or the live ones."""
    if "applied_first" in evidence:
        assert evidence["applied_first"][len(evidence["applied_first"]) - len(chain) :] == [
            {"migration": getattr(c0, f"SUCCESSOR_{n}"), "seq": n, "sha256": getattr(c0, f"SUCCESSOR_{n}_SHA256")}
            for n in chain
        ]
        return evidence["applied_first_seals"]
    return evidence["before"]


def assert_recorded(evidence):
    """What the recorded native qualification must show before 308 merges."""
    assert evidence["final_migration_qualification_pending"] is False, (
        "308 native qualification pending: with production at 307, run scripts/qualify-migration-successor.py "
        "db/migrations/308-dli-canopy-ppfd.sql --native-fixture db/qualification/308-dli-canopy-ppfd-fixture.sql "
        "--fixture tests/fixtures/308-dli-canopy-ppfd-native-qualification.json on production (every session rolls "
        "back), set the measured seals in the file and its registrations if they moved, and commit the fixture it "
        "writes"
    )
    assert evidence["migration"] == c0.SUCCESSOR_308
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_308_SHA256
    assert evidence["qualified_successor"] == six.SUCCESSOR_308 == registered(308)
    if CHAIN:  # the merged predecessors production lacked were applied first, in the same sessions
        assert "applied_first" in evidence
    assert measured_against(evidence, CHAIN) == registered(PREDECESSOR)
    assert evidence["before"] == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    assert evidence["native_fixture"]["all_passed"] is True


def fake_qualification(monkeypatch, *, native=None):
    """Replay the qualifier's three sessions for 308, without a database, on production at 307."""
    before, after = registered(PREDECESSOR), registered(308)

    def state(seals, max_seq):
        return {**seals, **{seal + "_receipt": seals[seal] for seal in SEALS}, "max_seq": max_seq}

    replies = {
        "probe": {"before": state(before, LIVE), "successor": state(after, LIVE)},
        "final": {"inside": state(after, 308), "native_fixture": native or {"all_passed": True}},
        "after": {"after": state(before, LIVE)},
    }
    seen = []

    def run(psql, sql):
        name = "probe" if "QUALIFY successor" in sql else "final" if "QUALIFY inside" in sql else "after"
        seen.append(name)
        return replies[name]

    monkeypatch.setattr(qualifier, "run", run)
    return seen


def test_qualifier_records_308_and_the_gate_accepts_it(monkeypatch, tmp_path):
    fixture = tmp_path / "fixture.json"
    shutil.copy(FIXTURE, fixture)  # the committed projection is kept, the measurement added
    seen = fake_qualification(monkeypatch)
    report = qualifier.qualify(MIGRATION, fixture, ["psql"], apply_first=FIRST, native_fixture=NATIVE)
    assert seen == ["probe", "final", "after"]
    written = json.loads(fixture.read_text())
    assert {key: written[key] for key in report} == report
    assert written["projection"] == json.loads(FIXTURE.read_text())["projection"]
    assert_recorded(written)
    seen = fake_qualification(monkeypatch, native={"all_passed": False})
    fixture.unlink()
    with pytest.raises(qualifier.QualificationError, match="native qualification failed"):
        qualifier.qualify(MIGRATION, fixture, ["psql"], apply_first=FIRST, native_fixture=NATIVE)
    assert seen == ["probe", "final", "after"] and not fixture.exists()


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_308
    assert evidence["projected_successor"] == six.SUCCESSOR_308 == qualifier.successor_literals(SOURCE)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact308 and its measured seals."""
    assert_recorded(json.loads(FIXTURE.read_text()))
