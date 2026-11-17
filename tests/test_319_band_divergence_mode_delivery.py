"""Exact319 delivery: ordered admission, the divergence view's mode read, the measured seals.

#1770 (host release 6; #1633, #1734): since the fourth flash the controller also writes diagnostics rows with no
band_source; when the newest row of the window was one of them, v_band_device_divergence read 'unobservable'. 319
adds AND d.band_source IS NOT NULL to latest_mode and changes nothing else: same columns, owner, grants and comment
(CREATE OR REPLACE). test_native_qualification_is_recorded is the merge gate: the rolled-back production
qualification records the file's measured seals and the native fixture's column, grant, comment and mode checks.
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

PREDECESSOR = 318
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


c0 = load("divergence319_delivery", "c0-migration-delivery.py")
six = load("divergence319_six", "bootstrap-six-runtime-roles.py")
qualifier = load("divergence319_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_319
SOURCE = MIGRATION.read_text()
VIEW_250 = (ROOT / "db/migrations/250-band-divergence-provenance.sql").read_text()
NATIVE = ROOT / "db/qualification/319-band-divergence-mode-ignores-partial-rows-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/319-band-divergence-mode-ignores-partial-rows-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 320)]
PREDICATE = "      AND d.band_source IS NOT NULL\n"


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


def view_text(text):
    start = text.index("CREATE OR REPLACE VIEW public.v_band_device_divergence AS")
    return text[start : text.index(";", start) + 1]


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    assert hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == c0.SUCCESSOR_319_SHA256
    assert six.BAND_DIVERGENCE_MODE_MIGRATION == (319, c0.SUCCESSOR_319, c0.SUCCESSOR_319_SHA256)
    assert c0.SUCCESSOR_319 == "319-band-divergence-mode-ignores-partial-rows.sql"
    c0.reviewed_post_254(later(), files())
    c0.reviewed_post_254(later()[:-1], files())
    with pytest.raises(c0.DeliveryError, match="319 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_319: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["319-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_file_is_wrap_safe_and_replaces_only_the_view():
    assert not safety.classify(MIGRATION).self_committing
    qualifier.refuse_transaction_control(SOURCE)
    code = qualifier._code_only(SOURCE)[0].upper()
    for forbidden in (r"\bCOMMIT\b", r"CONCURRENTLY", r"VACUUM", r"ALTER SYSTEM", r"PASSWORD", r"\bTRUNCATE\b",
                      r"\bDELETE\b", r"\bINSERT\b", r"\bDROP\b", r"\bALTER\b", r"\bGRANT\b", r"\bREVOKE\b",
                      r"\bOWNER TO\b", r"\bCOMMENT ON\b"):  # fmt: skip
        assert not re.search(forbidden, code), forbidden
    assert re.findall(r"\bCREATE\b[^\n]*", code) == ["CREATE OR REPLACE VIEW PUBLIC.V_BAND_DEVICE_DIVERGENCE AS"]
    assert re.findall(r"\bUPDATE\s+\S+", BODY) == []
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name


def test_the_view_is_250s_with_one_predicate_in_latest_mode():
    new, old = view_text(SOURCE), view_text(VIEW_250)
    assert new.count(PREDICATE) == 1 and new.replace(PREDICATE, "", 1) == old
    latest_mode = new[new.index("WITH latest_mode AS (") : new.index("), mode AS (")]
    assert PREDICATE in latest_mode and "ORDER BY d.ts DESC\n    LIMIT 1" in latest_mode


def test_predecessor_binds_exact318_with_its_registered_seals():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in PRED_BLOCK and f"sha256='{sha}'" in PRED_BLOCK
    assert f"seq>{PREDECESSOR})" in PRED_BLOCK and "stamp_method='runner'" in PRED_BLOCK
    for seal, digest in registered(PREDECESSOR).items():
        assert PRED_BLOCK.count(f"'hex') IS DISTINCT FROM '{digest}'") == 1, seal
    assert "attrelid='public.v_band_device_divergence'::regclass AND attnum>0 AND NOT attisdropped)<>28" in PRED_BLOCK


def test_the_native_fixture_checks_columns_grants_comment_and_mode():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    assert "'verdify|{verdify=arwdDxt/verdify,verdify_ingestor_runtime=r/verdify}'" in text
    assert "SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;" in text
    assert text.count("RESET SESSION AUTHORIZATION;") == 1
    assert not re.search(r"\b(INSERT|UPDATE|DELETE)\b", uncommented(text))
    assert text.strip().splitlines()[-1].endswith("'all_passed', true)::text;")


def test_successor_reseals_every_receipt_with_the_registered_literals():
    literals = qualifier.successor_literals(SOURCE)
    assert literals == registered(319)
    assert literals == {k: six.SUCCESSOR_319[k] for k in ("api", "ingestor", "mcp")}
    for login, seal in ((API, "api"), (INGESTOR, "ingestor")):
        assert f"decode('{literals[seal]}','hex'), captured_at=clock_timestamp() WHERE login_name='{login}'" in (
            SUCCESSOR_BLOCK
        )
    assert f"decode('{literals['mcp']}','hex') WHERE singleton;" in SUCCESSOR_BLOCK
    assert "'319 receipts do not match the successor seals'" in SUCCESSOR_BLOCK


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_319
    assert evidence["projected_successor"] == qualifier.successor_literals(SOURCE)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact319 and its measured seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False, (
        "319 native qualification pending: run scripts/qualify-migration-successor.py "
        "db/migrations/319-band-divergence-mode-ignores-partial-rows.sql --native-fixture "
        "db/qualification/319-band-divergence-mode-ignores-partial-rows-fixture.sql --fixture "
        "tests/fixtures/319-band-divergence-mode-ignores-partial-rows-native-qualification.json, and commit the fixture"
    )
    assert evidence["migration"] == c0.SUCCESSOR_319
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_319_SHA256
    assert evidence["qualified_successor"] == registered(319)
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    assert evidence["native_fixture"]["all_passed"] is True
