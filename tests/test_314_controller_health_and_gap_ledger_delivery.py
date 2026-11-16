"""Exact314 delivery: ordered admission, the health columns, the gap-replay ledger, the moved seals, the pending gate.

#1633 host release 3 (RULINGS AE1, AE3, AE8): nine nullable diagnostics columns for the controller's own health,
appended to the ingestor's write facade v_runtime_diagnostics_write with INSERT for the ingestor duty, and
gap_replay_quarters, the ledger of replayed gap-log quarters, which the ingestor duty reads and inserts into. The
ingestor seal moves and the api and MCP seals are measured again; every receipt is re-sealed.
test_native_qualification_is_recorded is the merge gate: the literals are measured by the rolled-back production
qualification.
"""

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PREDECESSOR = 313
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"
ING_DUTY = "verdify_ingestor_runtime"
HEALTH_COLUMNS = {
    "heap_min_free_minute_kb": "double precision",
    "heap_largest_block_minute_low_kb": "double precision",
    "loop_worst_ms": "double precision",
    "restart_count": "integer",
    "nvs_used_entries": "integer",
    "nvs_free_entries": "integer",
    "nvs_write_worst_ms": "double precision",
    "gap_log_state": "text",
    "sensor_degraded_active": "integer",
}
FACADE_217 = (
    "ts, wifi_rssi, heap_bytes, heap_min_free_kb, heap_largest_free_block_kb, uptime_s, probe_health, reset_reason, "
    "firmware_version, active_probe_count, relief_cycle_count, vent_latch_timer_s, sealed_timer_s, vpd_watch_timer_s, "
    "mist_backoff_timer_s, vent_mist_assist_active, effective_heat_target_f, effective_cool_stage2_delta_f, "
    "effective_vpd_hysteresis_kpa, effective_dehum_aggressive_kpa, controller_time_epoch, controller_local_hour, "
    "sntp_valid, sntp_miss_count, last_sntp_sync_age_s, band_source, zone_wet_granted, greenhouse_id"
)
LEDGER_INSERT = "boot, qseq, first_ts, last_ts, climate_rows, transition_rows, format_version"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


c0 = load("health314_delivery", "c0-migration-delivery.py")
six = load("health314_six", "bootstrap-six-runtime-roles.py")
maintenance = load("health314_maintenance", "bootstrap-maintenance-runtime-roles.py")
qualifier = load("health314_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_314
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/314-controller-health-and-gap-ledger-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/314-controller-health-and-gap-ledger-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 315)]


def uncommented(text):
    return re.sub(r"--[^\n]*", "", text)


BODY = uncommented(SOURCE.split("END $predecessor$;", 1)[1].split("DO $successor$", 1)[0])
SUCCESSOR_BLOCK = SOURCE[SOURCE.index("DO $successor$") :]


def flat(text):
    return " ".join(text.split())


def later():
    return [c0.SUCCESSOR_254] + [getattr(c0, f"SUCCESSOR_{n}") for n in NUMBERS]


def files():
    return {getattr(c0, f"SUCCESSOR_{n}"): getattr(c0, f"SUCCESSOR_{n}_SHA256") for n in NUMBERS}


def registered(n):
    digests = getattr(c0, f"SUCCESSOR_{n}_DIGESTS")
    return {"api": digests[API], "ingestor": digests[INGESTOR], "mcp": getattr(c0, f"SUCCESSOR_{n}_MCP_DIGEST")}


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    assert hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == c0.SUCCESSOR_314_SHA256
    assert six.CONTROLLER_HEALTH_GAP_LEDGER_MIGRATION == (314, c0.SUCCESSOR_314, c0.SUCCESSOR_314_SHA256)
    assert c0.SUCCESSOR_314 == "314-controller-health-and-gap-ledger.sql"
    c0.reviewed_post_254(later(), files())
    c0.reviewed_post_254(later()[:-1], files())
    with pytest.raises(c0.DeliveryError, match="314 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_314: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["314-other.sql"]):
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


def test_predecessor_binds_exact313_with_its_registered_seals():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    block = SOURCE[SOURCE.index("DO $predecessor$") : SOURCE.index("END $predecessor$;")]
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in block and f"sha256='{sha}'" in block
    assert f"seq>{PREDECESSOR})" in block and "stamp_method='runner'" in block
    assert "to_regclass('public.gap_replay_quarters') IS NOT NULL" in block
    assert all(f"'{column}'" in block for column in HEALTH_COLUMNS)
    assert "ARRAY['security_barrier=true','security_invoker=false']" in block
    for seal, digest in registered(PREDECESSOR).items():
        assert block.count(f"'hex') IS DISTINCT FROM '{digest}'") == 1, seal


def test_successor_reseals_every_receipt_with_the_registered_literals():
    literals = qualifier.successor_literals(SOURCE)
    assert literals == registered(314) == {k: six.SUCCESSOR_314[k] for k in ("api", "ingestor", "mcp")}
    assert SUCCESSOR_BLOCK.count("UPDATE public.runtime_ordinary_login_attestation_receipts") == 2
    for login, seal in ((API, "api"), (INGESTOR, "ingestor")):
        assert f"decode('{literals[seal]}','hex'), captured_at=clock_timestamp() WHERE login_name='{login}'" in (
            SUCCESSOR_BLOCK
        )
    assert f"decode('{literals['mcp']}','hex') WHERE singleton;" in SUCCESSOR_BLOCK
    assert "'314 receipts do not match the successor seals'" in SUCCESSOR_BLOCK


def test_the_nine_columns_are_nullable_without_default_and_one_per_statement():
    added = re.findall(r"ALTER TABLE public\.diagnostics ADD COLUMN (\w+) ([a-z ]+);", BODY)
    assert dict(added) == HEALTH_COLUMNS and len(added) == 9
    assert "DEFAULT" not in BODY.split("CREATE TABLE")[0] and "NOT NULL" not in BODY.split("CREATE TABLE")[0]
    for column in HEALTH_COLUMNS:
        assert f"COMMENT ON COLUMN public.diagnostics.{column} IS" in BODY


def test_the_facade_keeps_217s_columns_in_order_and_appends_the_nine():
    view = flat(BODY.split("CREATE OR REPLACE VIEW public.v_runtime_diagnostics_write", 1)[1].split(";", 1)[0])
    assert view == (
        "WITH (security_barrier=true, security_invoker=false) AS SELECT "
        + FACADE_217
        + ", "
        + ", ".join(HEALTH_COLUMNS)
        + " FROM public.diagnostics"
    )


def test_body_grants_exactly_the_ingestor_duty():
    grants = [flat(g) for g in re.findall(r"\bGRANT\b.*?;", BODY, re.S)]
    assert grants == [
        f"GRANT INSERT ({', '.join(HEALTH_COLUMNS)}) ON public.v_runtime_diagnostics_write TO {ING_DUTY};",
        f"GRANT SELECT ON public.gap_replay_quarters TO {ING_DUTY};",
        f"GRANT INSERT ({LEDGER_INSERT}) ON public.gap_replay_quarters TO {ING_DUTY};",
        "GRANT SELECT ON public.v_data_gaps_unreplayed TO verdify_dashboard_runtime;",
    ]
    assert not re.search(r"\bTO PUBLIC\b|DEFAULT PRIVILEGES|\bOWNER TO\b|\bDROP\b|\bTRUNCATE\b|\bREVOKE\b", BODY)
    # climate and equipment_state are unchanged (RULINGS AE8): no index, no column, no grant.
    for kept in ("public.climate", "public.equipment_state", "CREATE INDEX", "CREATE UNIQUE INDEX"):
        assert kept not in BODY, kept


def test_the_ledger_carries_what_a_reader_needs():
    table = flat(BODY.split("CREATE TABLE public.gap_replay_quarters (", 1)[1].split(");", 1)[0])
    for column in (
        "boot bigint NOT NULL",
        "qseq bigint NOT NULL",
        "first_ts timestamptz",
        "last_ts timestamptz",
        "climate_rows integer NOT NULL",
        "transition_rows integer NOT NULL",
        "format_version smallint NOT NULL",
        "received_at timestamptz NOT NULL DEFAULT now()",
    ):
        assert column in table, column
    assert "PRIMARY KEY (boot, qseq)" in table


def test_the_diagnostics_model_and_map_carry_the_nine_columns():
    sys.path.insert(0, str(ROOT / "ingestor"))
    import entity_map

    from verdify_schemas.telemetry import Diagnostics

    mapped = set(entity_map.DIAGNOSTIC_MAP.values())
    assert set(HEALTH_COLUMNS) <= mapped
    assert set(HEALTH_COLUMNS) <= set(Diagnostics.model_fields)


def test_sealed_sql_314_chains_from_313_and_binds_the_exact_ledger_row():
    old = six.seal_profile_sql(PREDECESSOR, six.SUCCESSOR_313)
    expected = "(" + six.sealed_sql_313().replace(old, six.seal_profile_sql(314, six.SUCCESSOR_314), 1)
    expected += " AND " + six.ledger_row_sql(*six.CONTROLLER_HEALTH_GAP_LEDGER_MIGRATION) + ")"
    assert six.sealed_sql_314() == expected
    assert "(SELECT max(seq) FROM public.schema_migrations WHERE source='db/migrations')=314" in expected
    assert six.sealed_sql().count(" OR " + six.sealed_sql_313() + " OR " + expected) == 1
    assert maintenance.contract_sql().count(" OR " + six.sealed_sql_314()) == 1
    assert (
        '"314-controller-health-and-gap-ledger.sql",'
        in (ROOT / "tests/test_experiment_schema_migration.py").read_text()
    )
    assert "tests/test_314_controller_health_and_gap_ledger_delivery.py" in (ROOT / "scripts/ci-local.sh").read_text()


def test_native_fixture_writes_as_the_ingestor_login():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    assert "SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;" in text
    assert text.count("RESET SESSION AUTHORIZATION;") == 2
    assert "SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;" in text
    assert "INSERT INTO public.v_runtime_diagnostics_write" in text and "INSERT INTO public.gap_replay_quarters" in text


def test_outage_readers_see_gaps_without_replayed_minutes():
    """A replayed outage must not read as a gap: the view cuts the ledger's spans out and the graphs read it."""
    view = flat(BODY.split("CREATE VIEW public.v_data_gaps_unreplayed", 1)[1].split(";", 1)[0])
    assert "FROM public.data_gaps g" in view and "FROM public.gap_replay_quarters q" in view
    assert "tstzmultirange(tstzrange(g.start_ts, g.end_ts))" in view and "range_agg(" in view
    series = (ROOT / "verdify_services" / "series.py").read_text()
    assert "FROM public.v_data_gaps_unreplayed" in series and "FROM public.data_gaps" not in series


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_314
    assert evidence["before"] == registered(PREDECESSOR)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact314 and its measured seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False, (
        "314 native qualification pending: measure the literals with scripts/qualify-migration-successor.py "
        "db/migrations/314-controller-health-and-gap-ledger.sql --probe-only, write them into the file and its "
        "registrations, then run it with --native-fixture db/qualification/314-controller-health-and-gap-ledger-"
        "fixture.sql --fixture tests/fixtures/314-controller-health-and-gap-ledger-native-qualification.json and "
        "commit the fixture"
    )
    assert evidence["migration"] == c0.SUCCESSOR_314
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_314_SHA256
    assert evidence["qualified_successor"] == registered(314)
    assert evidence["before"] == registered(PREDECESSOR) == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    assert evidence["native_fixture"]["all_passed"] is True
