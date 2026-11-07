"""Exact307 delivery: ordered admission, the canopy PAR column, the ingest route, measured seals, native evidence.

#1184 (ingest slice; the firmware slice is PR #1494): climate gains ppfd_umol_m2_s, the runtime write facade
v_runtime_climate_write appends it with 217's options, and the ingestor duty may INSERT it, which
fn_record_climate_source_event (266) requires of every payload column. The ingestor routes the ESPHome sensor
canopy_ppfd to it, range-guarded 0-2500, and ClimateRow validates it. Until the meter is fitted and the firmware
flashed, nothing arrives and the column stays NULL. The DLI views and their validity ledger are not touched.
test_native_qualification_is_recorded is the merge gate for the rolled-back production run (production at 305, with
306 applied first) and db/qualification/307-climate-ppfd-column-fixture.sql.
"""

import hashlib
import importlib.util
import json
import math
import re
import shutil
import sys
from pathlib import Path

import pytest

from verdify_schemas.telemetry import ClimateRow
from verdify_services import series

ROOT = Path(__file__).resolve().parents[1]
PREDECESSOR = 306
# Merged predecessors not yet applied in production when 307 is qualified (each one --apply-first).
CHAIN = (306,)
# Production's newest applied migration when the successor is qualified.
LIVE = 305
SEALS = ("api", "ingestor", "mcp")
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclasses resolve their module while the file executes
    spec.loader.exec_module(module)
    return module


c0 = load("ppfd307_delivery", "c0-migration-delivery.py")
six = load("ppfd307_six", "bootstrap-six-runtime-roles.py")
maintenance = load("ppfd307_maintenance", "bootstrap-maintenance-runtime-roles.py")
qualifier = load("ppfd307_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_307
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/307-climate-ppfd-column-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/307-climate-ppfd-column-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, 301, 302, 303, 304, 305, 306, 307]
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


# ── Admission and the file ──────────────────────────────────────────────────


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    raw = MIGRATION.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == c0.SUCCESSOR_307_SHA256 == six.PAR_PPFD_MIGRATION[2]
    assert six.PAR_PPFD_MIGRATION[:2] == (307, c0.SUCCESSOR_307) == (307, "307-climate-ppfd-column.sql")
    c0.reviewed_post_254(later(), files())
    with pytest.raises(c0.DeliveryError, match="307 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_307: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["307-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_successor_binds_its_measured_seals_and_exact_ledger_row():
    predecessor = getattr(six, f"SUCCESSOR_{PREDECESSOR}")
    assert predecessor == registered(PREDECESSOR)
    assert six.SUCCESSOR_307 == registered(307)
    assert c0.SUCCESSOR_307_DIGESTS == {API: six.SUCCESSOR_307["api"], INGESTOR: six.SUCCESSOR_307["ingestor"]}
    old = six.seal_profile_sql(PREDECESSOR, predecessor)
    expected = "(" + six.sealed_sql_306().replace(old, six.seal_profile_sql(307, six.SUCCESSOR_307), 1)
    expected += " AND " + six.ledger_row_sql(*six.PAR_PPFD_MIGRATION) + ")"
    assert six.sealed_sql_307() == expected
    assert "(SELECT max(seq) FROM public.schema_migrations WHERE source='db/migrations')=307" in expected
    assert "stamp_method='runner'" in six.ledger_row_sql(*six.PAR_PPFD_MIGRATION)
    assert six.sealed_sql().count(" OR " + six.sealed_sql_306() + " OR " + expected) == 1
    assert maintenance.contract_sql().count(" OR " + six.sealed_sql_307()) == 1
    assert '"307-climate-ppfd-column.sql",' in (ROOT / "tests/test_experiment_schema_migration.py").read_text()
    assert "tests/test_307_climate_ppfd_delivery.py" in (ROOT / "scripts/ci-local.sh").read_text()


def test_migration_pins_its_predecessor_and_reseals_every_receipt():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in SOURCE
    assert f"sha256='{sha}'" in SOURCE
    assert f"seq>{PREDECESSOR})" in SOURCE
    head = SOURCE.split("DO $successor$", 1)[0]
    assert qualifier.successor_literals(SOURCE) == six.SUCCESSOR_307
    for seal, digest in registered(PREDECESSOR).items():
        assert f"'{digest}'" in head, seal
    successor = SOURCE.split("DO $successor$", 1)[1]
    for login in (API, INGESTOR):
        assert f"WHERE login_name='{login}';" in successor
    assert "UPDATE public.mcp_runtime_boundary_receipt" in successor
    assert "'307 refuses an unqualified predecessor'" in SOURCE and "'307 refuses an unqualified successor'" in SOURCE


def test_file_is_wrap_safe_and_every_session_ends_in_rollback():
    assert not safety.classify(MIGRATION).self_committing
    qualifier.refuse_transaction_control(SOURCE)
    code = uncommented(SOURCE).upper()
    for forbidden in (r"\bCOMMIT\b", r"CONCURRENTLY", r"VACUUM", r"ALTER SYSTEM", r"PASSWORD", r"\bTRIGGER\b"):
        assert not re.search(forbidden, code), forbidden
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name
        assert sql.count("ROLLBACK;") == 1, name


# ── The body: one column, the facade with it appended, one INSERT grant ─────


def facade_217():
    text = (ROOT / "db/migrations/217-runtime-role-boundary.sql").read_text()
    array = text.split("('climate', 'v_runtime_climate_write', ARRAY[", 1)[1].split("]::text[]", 1)[0]
    return re.findall(r"'([a-z0-9_]+)'", array)


def test_body_adds_one_nullable_column_and_appends_it_to_217s_facade():
    assert re.findall(r"ALTER TABLE[^;]*;", BODY) == [
        "ALTER TABLE public.climate ADD COLUMN ppfd_umol_m2_s double precision;"
    ]
    view = BODY.split("CREATE OR REPLACE VIEW public.v_runtime_climate_write", 1)[1].split(";", 1)[0]
    assert "WITH (security_barrier=true, security_invoker=false)" in view
    columns = [c.strip() for c in view.split("SELECT", 1)[1].split("FROM public.climate", 1)[0].split(",")]
    assert columns == [*facade_217(), "ppfd_umol_m2_s"]
    assert len(columns) == 87
    grants = [" ".join(g.split()) for g in re.findall(r"\bGRANT\b.*?;", BODY, re.S)]
    assert grants == ["GRANT INSERT (ppfd_umol_m2_s) ON public.v_runtime_climate_write TO verdify_ingestor_runtime;"]
    for absent in ("REVOKE", "DROP ", "UPDATE (", "v_dli_", "dli_validity", "verdify_api_runtime", "PUBLIC"):
        assert absent not in BODY, absent


# ── The ingest route ────────────────────────────────────────────────────────


def test_canopy_ppfd_routes_to_the_column_with_its_range_guard():
    sys.path.insert(0, str(ROOT / "ingestor"))
    import entity_map

    # Outside CLIMATE_MAP until the flashed firmware emits it; the firmware drift guard reads CLIMATE_MAP.
    assert entity_map.ESPHOME_FEEDBACK_MAP["canopy_ppfd"] == "ppfd_umol_m2_s"
    assert "canopy_ppfd" not in entity_map.CLIMATE_MAP
    assert entity_map.FEEDBACK_VALUE_RANGES["ppfd_umol_m2_s"] == (0.0, 2500.0)
    normalize = entity_map.normalize_feedback_value
    assert normalize("ppfd_umol_m2_s", 0.0) == 0.0
    assert normalize("ppfd_umol_m2_s", "812") == 812.0
    assert normalize("ppfd_umol_m2_s", 2500.0) == 2500.0
    for dropped in (math.nan, math.inf, 2600.0, -1.0, None, "unavailable"):
        assert normalize("ppfd_umol_m2_s", dropped) is None, dropped


def test_climate_row_takes_ppfd_and_tolerates_its_absence():
    ts = "2026-11-07T12:00:00+00:00"
    assert ClimateRow.model_validate({"ts": ts, "temp_avg": 70.0}).ppfd_umol_m2_s is None
    assert ClimateRow.model_validate({"ts": ts, "ppfd_umol_m2_s": 812.0}).ppfd_umol_m2_s == 812.0
    with pytest.raises(ValueError):
        ClimateRow.model_validate({"ts": ts, "ppfd_umol_m2_s": -1.0})


def test_the_registry_keys_the_column():
    binding = series.METRICS["climate.ppfd_umol_m2_s"]
    assert (binding.group, binding.unit, binding.provenance, binding.zone) == (
        "light",
        "µmol/m²/s",
        "MEASURED",
        "house",
    )
    assert binding.raw.table == "climate" and binding.raw.column == "ppfd_umol_m2_s"
    assert binding.daily is None and binding.cadence_s == 60 and binding.retention_days == 365
    assert "ppfd_umol_m2_s" in series.EXCLUDED_COLUMNS["ppfd"] and "#1184" in series.EXCLUDED_COLUMNS["ppfd"]


# ── The native qualification ────────────────────────────────────────────────


def test_native_fixture_writes_through_the_production_path_as_the_ingestor_login():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    assert "SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;" in text
    assert "public.fn_record_climate_source_event(" in text
    assert "SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;" in text
    assert text.count("RESET SESSION AUTHORIZATION;") == 2


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
    """What the recorded native qualification must show before 307 merges."""
    assert evidence["final_migration_qualification_pending"] is False, (
        "307 native qualification pending: with production at 305, run scripts/qualify-migration-successor.py "
        "db/migrations/307-climate-ppfd-column.sql --apply-first db/migrations/306-vpd-envelope-sql-mirror.sql "
        "--native-fixture db/qualification/307-climate-ppfd-column-fixture.sql --fixture "
        "tests/fixtures/307-climate-ppfd-column-native-qualification.json on production (every session rolls back) "
        "and commit the fixture it writes"
    )
    assert evidence["migration"] == c0.SUCCESSOR_307
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_307_SHA256
    assert evidence["qualified_successor"] == six.SUCCESSOR_307 == registered(307)
    if CHAIN:  # the merged predecessors production lacked were applied first, in the same sessions
        assert "applied_first" in evidence
    assert measured_against(evidence, CHAIN) == registered(PREDECESSOR)
    assert evidence["before"] == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    assert evidence["native_fixture"]["all_passed"] is True


def fake_qualification(monkeypatch, *, native=None):
    """Replay the qualifier's three sessions for 307, without a database, on production at 305 with 306 first."""
    before, after = registered(PREDECESSOR), registered(307)

    def state(seals, max_seq):
        return {**seals, **{seal + "_receipt": seals[seal] for seal in SEALS}, "max_seq": max_seq}

    replies = {
        "probe": {"before": state(before, LIVE), "applied": state(before, 306), "successor": state(after, 306)},
        "final": {
            "applied": state(before, 306),
            "inside": state(after, 307),
            "native_fixture": native or {"all_passed": True},
        },
        "after": {"after": state(before, LIVE)},
    }
    seen = []

    def run(psql, sql):
        name = "probe" if "QUALIFY successor" in sql else "final" if "QUALIFY inside" in sql else "after"
        seen.append(name)
        return replies[name]

    monkeypatch.setattr(qualifier, "run", run)
    return seen


def test_qualifier_records_307_and_the_gate_accepts_it(monkeypatch, tmp_path):
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
    assert evidence["migration"] == c0.SUCCESSOR_307
    assert evidence["projected_successor"] == six.SUCCESSOR_307 == qualifier.successor_literals(SOURCE)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact307 and its measured seals."""
    assert_recorded(json.loads(FIXTURE.read_text()))
