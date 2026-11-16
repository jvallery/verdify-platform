"""Exact315 delivery: ordered admission, the replay-aware gap readers, the counter check, the health columns, the seals.

#1633 host release 4 (RULINGS AF7, AF9, AF10): v_data_trust_ledger and v_irrigation_day_coverage read 314's
v_data_gaps_unreplayed, v_relay_counter_reconciliation_daily reconciles the controller's lifetime relay counters with
the daily relay record, and three nullable diagnostics columns are appended to the ingestor's write facade. No drop.
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
PREDECESSOR = 314
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"
ING_DUTY = "verdify_ingestor_runtime"
HEALTH_COLUMNS = {
    "loop_stack_high_water_b": "integer",
    "wifi_disconnect_count": "integer",
    "api_client_count": "integer",
}
FACADE_314 = (
    "ts, wifi_rssi, heap_bytes, heap_min_free_kb, heap_largest_free_block_kb, uptime_s, probe_health, reset_reason, "
    "firmware_version, active_probe_count, relief_cycle_count, vent_latch_timer_s, sealed_timer_s, vpd_watch_timer_s, "
    "mist_backoff_timer_s, vent_mist_assist_active, effective_heat_target_f, effective_cool_stage2_delta_f, "
    "effective_vpd_hysteresis_kpa, effective_dehum_aggressive_kpa, controller_time_epoch, controller_local_hour, "
    "sntp_valid, sntp_miss_count, last_sntp_sync_age_s, band_source, zone_wet_granted, greenhouse_id, "
    "heap_min_free_minute_kb, heap_largest_block_minute_low_kb, loop_worst_ms, restart_count, nvs_used_entries, "
    "nvs_free_entries, nvs_write_worst_ms, gap_log_state, sensor_degraded_active"
)
RECON = "v_relay_counter_reconciliation_daily"
SPOOL = "public.fn_record_observational_source_event(uuid,text,timestamptz,text,uuid,bigint,jsonb)"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


c0 = load("gaps315_delivery", "c0-migration-delivery.py")
six = load("gaps315_six", "bootstrap-six-runtime-roles.py")
maintenance = load("gaps315_maintenance", "bootstrap-maintenance-runtime-roles.py")
qualifier = load("gaps315_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_315
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/315-replayed-gaps-counter-check-and-health-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/315-replayed-gaps-counter-check-and-health-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 316)]


def uncommented(text):
    return re.sub(r"--[^\n]*", "", text)


BODY = uncommented(SOURCE.split("END $predecessor$;", 1)[1].split("DO $successor$", 1)[0])
SUCCESSOR_BLOCK = SOURCE[SOURCE.index("DO $successor$") :]


def flat(text):
    return " ".join(text.split())


def view(name):
    return flat(BODY.split(f"VIEW public.{name}", 1)[1].split("COMMENT ON VIEW", 1)[0])


def later():
    return [c0.SUCCESSOR_254] + [getattr(c0, f"SUCCESSOR_{n}") for n in NUMBERS]


def files():
    return {getattr(c0, f"SUCCESSOR_{n}"): getattr(c0, f"SUCCESSOR_{n}_SHA256") for n in NUMBERS}


def registered(n):
    digests = getattr(c0, f"SUCCESSOR_{n}_DIGESTS")
    return {"api": digests[API], "ingestor": digests[INGESTOR], "mcp": getattr(c0, f"SUCCESSOR_{n}_MCP_DIGEST")}


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    assert hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == c0.SUCCESSOR_315_SHA256
    assert six.REPLAYED_GAPS_COUNTER_CHECK_MIGRATION == (315, c0.SUCCESSOR_315, c0.SUCCESSOR_315_SHA256)
    assert c0.SUCCESSOR_315 == "315-replayed-gaps-counter-check-and-health.sql"
    c0.reviewed_post_254(later(), files())
    c0.reviewed_post_254(later()[:-1], files())
    with pytest.raises(c0.DeliveryError, match="315 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_315: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["315-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_file_is_wrap_safe_drops_nothing_and_every_session_ends_in_rollback():
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
        r"\bDROP\b",
        r"\bTRUNCATE\b",
        r"\bDELETE\b",
    ):
        assert not re.search(forbidden, code), forbidden
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name


def test_predecessor_binds_exact314_with_its_registered_seals():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    block = SOURCE[SOURCE.index("DO $predecessor$") : SOURCE.index("END $predecessor$;")]
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in block and f"sha256='{sha}'" in block
    assert f"seq>{PREDECESSOR})" in block and "stamp_method='runner'" in block
    assert f"to_regclass('public.{RECON}') IS NOT NULL" in block
    assert "to_regclass('public.v_data_gaps_unreplayed') IS NULL" in block
    assert all(f"'{column}'" in block for column in HEALTH_COLUMNS)
    assert "ARRAY['security_barrier=true','security_invoker=false']" in block
    assert "d.refobjid='public.data_gaps'::regclass)<>2" in block
    for seal, digest in registered(PREDECESSOR).items():
        assert block.count(f"'hex') IS DISTINCT FROM '{digest}'") == 1, seal


def test_successor_reseals_every_receipt_with_the_registered_literals():
    literals = qualifier.successor_literals(SOURCE)
    assert literals == registered(315) == {k: six.SUCCESSOR_315[k] for k in ("api", "ingestor", "mcp")}
    assert SUCCESSOR_BLOCK.count("UPDATE public.runtime_ordinary_login_attestation_receipts") == 2
    for login, seal in ((API, "api"), (INGESTOR, "ingestor")):
        assert f"decode('{literals[seal]}','hex'), captured_at=clock_timestamp() WHERE login_name='{login}'" in (
            SUCCESSOR_BLOCK
        )
    assert f"decode('{literals['mcp']}','hex') WHERE singleton;" in SUCCESSOR_BLOCK
    assert "'315 receipts do not match the successor seals'" in SUCCESSOR_BLOCK


def test_the_three_columns_are_nullable_without_default_and_one_per_statement():
    added = re.findall(r"ALTER TABLE public\.diagnostics ADD COLUMN (\w+) ([a-z ]+);", BODY)
    assert dict(added) == HEALTH_COLUMNS and len(added) == 3
    alters = " ".join(re.findall(r"ALTER TABLE[^;]*;", BODY))
    assert "DEFAULT" not in alters and "NOT NULL" not in alters
    for column in HEALTH_COLUMNS:
        assert f"COMMENT ON COLUMN public.diagnostics.{column} IS" in BODY


def test_the_facade_keeps_314s_columns_in_order_and_appends_the_three():
    facade = flat(BODY.split("CREATE OR REPLACE VIEW public.v_runtime_diagnostics_write", 1)[1].split(";", 1)[0])
    assert facade == (
        "WITH (security_barrier=true, security_invoker=false) AS SELECT "
        + FACADE_314
        + ", "
        + ", ".join(HEALTH_COLUMNS)
        + " FROM public.diagnostics"
    )


def test_body_grants_exactly_the_facade_columns_and_the_counter_check():
    grants = [flat(g) for g in re.findall(r"\bGRANT\b.*?;", BODY, re.S)]
    spool = f"FUNCTION {SPOOL}"
    assert grants == [
        f"GRANT INSERT ({', '.join(HEALTH_COLUMNS)}) ON public.v_runtime_diagnostics_write TO {ING_DUTY};",
        f"GRANT EXECUTE ON {spool} TO {ING_DUTY};",
        f"GRANT SELECT ON public.{RECON} TO verdify_dashboard_runtime, {ING_DUTY};",
    ]
    # The spool function's ACL, restated as 314 does (CREATE OR REPLACE keeps the owner).
    assert [flat(r) for r in re.findall(r"\bREVOKE\b.*?;", BODY, re.S)] == [f"REVOKE ALL ON {spool} FROM PUBLIC;"]
    assert not re.search(r"\bOWNER TO\b", BODY)
    assert not re.search(r"\bTO PUBLIC\b|DEFAULT PRIVILEGES", BODY)


def test_both_gap_readers_read_the_replay_aware_gaps_only():
    """RULINGS AF10: a gap the gap log replayed no longer counts as missing."""
    ledger = view("v_data_trust_ledger")
    coverage = view("v_irrigation_day_coverage")
    assert "FROM v_data_gaps_unreplayed u WHERE u.end_ts > (now() - '24:00:00'::interval)" in ledger
    assert "gaps AS MATERIALIZED ( SELECT u.start_ts, u.end_ts FROM v_data_gaps_unreplayed u )" in coverage
    assert coverage.count("FROM gaps g") == 2
    for text in (ledger, coverage):
        assert not re.search(r"\bdata_gaps\b", text)
    # Every other check of the ledger stays.
    checks = re.findall(r"SELECT '(\w+)'::text AS check_name", ledger)
    assert checks == [
        "climate_freshness",
        "forecast_freshness",
        "required_sensor_coverage",
        "alert_lifecycle_mismatch",
        "open_critical_or_high_alerts",
        "planner_trigger_sla_36h",
        "data_gap_hours_24h",
        "water_accounting_14d",
        "irrigation_logging_14d",
        "energy_reconciliation_14d",
        "forecast_action_outcomes_7d",
        "crop_lifecycle_completeness",
        "daily_plan_archive_self_check",
    ]
    assert coverage.endswith("END AS coverage FROM days d;")


def _diagnostics_list(sql):
    """The diagnostics branch's allowed:=ARRAY[...] text (it may span lines)."""
    branch = sql[sql.index("WHEN 'diagnostics' THEN") :]
    return branch[branch.index("allowed:=ARRAY[") : branch.index("]", branch.index("allowed:=ARRAY[")) + 1]


def _diagnostics_allowed(sql):
    return re.findall(r"'(\w+)'", _diagnostics_list(sql))


def test_the_spool_admits_the_three_keys_and_keeps_everything_else():
    """RELEASE REVIEW DISPATCHER-01: a key outside the pinned list jams the FIFO spool."""
    fn = BODY[BODY.index("CREATE OR REPLACE FUNCTION public.fn_record_observational_source_event(") :]
    fn = fn[: fn.index("REVOKE ALL ON FUNCTION")]
    previous = uncommented((ROOT / "db/migrations/314-controller-health-and-gap-ledger.sql").read_text())
    old = previous[previous.index("CREATE OR REPLACE FUNCTION public.fn_record_observational_source_event(") :]
    old = old[: old.index("REVOKE ALL ON FUNCTION")]
    allowed = _diagnostics_allowed(fn)
    assert allowed[-3:] == list(HEALTH_COLUMNS) and len(allowed) == len(set(allowed))
    assert _diagnostics_allowed(old) + list(HEALTH_COLUMNS) == allowed
    # Only the diagnostics list differs from 314's text.
    assert fn.replace(_diagnostics_list(fn), "") == old.replace(_diagnostics_list(old), "")
    # Every facade column the ingestor may insert, apart from ts and greenhouse_id, is admitted.
    facade = [c.strip() for c in (FACADE_314 + ", " + ", ".join(HEALTH_COLUMNS)).split(",")]
    assert set(facade) - {"ts", "greenhouse_id"} == set(allowed)


def test_the_predecessor_guards_314s_function_body():
    """md5(prosrc) of 314's definition: the text between its $body$ quotes, computed from the 314 file."""
    text = (ROOT / "db/migrations/314-controller-health-and-gap-ledger.sql").read_text()
    start = text.index("CREATE OR REPLACE FUNCTION public.fn_record_observational_source_event(")
    begin = text.index("$body$", start) + len("$body$")
    digest = hashlib.md5(text[begin : text.index("$body$", begin)].encode()).hexdigest()  # noqa: S324 - matches md5()
    block = SOURCE[SOURCE.index("DO $predecessor$") : SOURCE.index("END $predecessor$;")]
    assert f"md5(prosrc)='{digest}'" in block


def test_the_diagnostics_model_and_map_carry_the_three_columns():
    """Lane HOST-LAW's ingest (climate/r4-host): the map rows and model fields for the three columns."""
    sys.path.insert(0, str(ROOT / "ingestor"))
    import entity_map

    from verdify_schemas.telemetry import Diagnostics

    assert {key: column for key, column in entity_map.DIAGNOSTIC_MAP.items() if column in HEALTH_COLUMNS} == {
        "loop_stack_high_water": "loop_stack_high_water_b",
        "wifi_disconnect_count": "wifi_disconnect_count",
        "api_client_count": "api_client_count",
    }
    assert set(HEALTH_COLUMNS) <= set(Diagnostics.model_fields)


def test_the_schedule_view_and_the_retired_plans():
    """RELEASE REVIEW READERS-5 (2 h readback rule) and RS-6 (idempotent plan retirement)."""
    sched = view("v_irrigation_schedule_current")
    assert "values_by_param.readback_ts < (now() - '02:00:00'::interval)" in sched and "00:15:00" not in sched
    assert sched.count("AS stale_readback_count") == 1 and sched.count("AS readback_drift_count") == 1
    assert "UPDATE public.setpoint_plan SET is_active = false WHERE is_active;" in BODY
    assert "WHERE status IN ('expected', 'delivered');" in BODY and "UPDATE public.planner_trigger_ledger" in BODY


def test_the_counter_check_names_its_relays_window_and_restart_rule():
    """RULINGS AF7: counters are the check, the events the source; valid from the phase 2 flash."""
    recon = view(RECON)
    assert (
        "VALUES ('heat1'::text, 'h1'::text, NULL::text), ('heat2', 'h2', NULL), ('fan1', 'f1', 'f1s'), "
        "('fan2', 'f2', 'f2s'), ('fog', 'fg', NULL), ('vent', 'vt', NULL)"
    ) in recon
    assert "s.entity = 'relay_counters' AND s.ts >= TIMESTAMPTZ '2026-11-16 19:48:00+00'" in recon
    assert recon.count("COALESCE(lag(") == 2 and recon.count("GREATEST(") == 2
    assert "LEFT JOIN public.daily_relay_record rr" in recon
    assert "WHEN f.date = DATE '2026-11-16' OR f.date >= f.today THEN 'partial'" in recon
    for column in (
        "counter_starts",
        "record_starts",
        "starts_difference",
        "counter_run_s",
        "record_run_s",
        "run_s_difference",
        "counter_rows",
        "comparison",
    ):
        assert f"AS {column}" in recon, column
    # A check only: nothing writes through it; the API and MCP duties are not granted it.
    assert not re.search(r"\b(INSERT|UPDATE)\b", recon)


def test_sealed_sql_315_chains_from_314_and_binds_the_exact_ledger_row():
    old = six.seal_profile_sql(PREDECESSOR, six.SUCCESSOR_314)
    expected = "(" + six.sealed_sql_314().replace(old, six.seal_profile_sql(315, six.SUCCESSOR_315), 1)
    expected += " AND " + six.ledger_row_sql(*six.REPLAYED_GAPS_COUNTER_CHECK_MIGRATION) + ")"
    assert six.sealed_sql_315() == expected
    assert "(SELECT max(seq) FROM public.schema_migrations WHERE source='db/migrations')=315" in expected
    assert six.sealed_sql().count(" OR " + six.sealed_sql_314() + " OR " + expected) == 1
    assert maintenance.contract_sql().count(" OR " + six.sealed_sql_315()) == 1
    assert (
        '"315-replayed-gaps-counter-check-and-health.sql",'
        in (ROOT / "tests/test_experiment_schema_migration.py").read_text()
    )
    assert "tests/test_315_replayed_gaps_counter_check_and_health_delivery.py" in (
        (ROOT / "scripts/ci-local.sh").read_text()
    )


def test_native_fixture_writes_as_the_ingestor_and_reads_as_the_dashboard():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    assert "SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;" in text
    assert "SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;" in text
    assert text.count("RESET SESSION AUTHORIZATION;") == 2
    assert "INSERT INTO public.v_runtime_diagnostics_write" in text
    for name in ("$ledger$", "$coverage$", "$counters$"):
        assert text.count(name) == 2, name


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_315
    assert evidence["projected_successor"] == qualifier.successor_literals(SOURCE)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact315 and its measured seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False, (
        "315 native qualification pending: measure the literals with scripts/qualify-migration-successor.py "
        "db/migrations/315-replayed-gaps-counter-check-and-health.sql --probe-only, write them into the file and its "
        "registrations, then run it with --native-fixture db/qualification/315-replayed-gaps-counter-check-and-"
        "health-fixture.sql --fixture tests/fixtures/315-replayed-gaps-counter-check-and-health-native-qualification"
        ".json and commit the fixture"
    )
    assert evidence["migration"] == c0.SUCCESSOR_315
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_315_SHA256
    assert evidence["qualified_successor"] == registered(315)
    first = [(r["migration"], r["sha256"]) for r in evidence.get("applied_first", [])]
    if first:
        # Production at 311 (release 3 not yet synced): the probe applied 312, 313 and 314 first.
        assert first == [(getattr(c0, f"SUCCESSOR_{n}"), getattr(c0, f"SUCCESSOR_{n}_SHA256")) for n in (312, 313, 314)]
        assert evidence["before"] == registered(311) == evidence["after_rollback"]
        assert evidence["applied_first_seals"] == registered(PREDECESSOR)
    else:
        assert evidence["before"] == registered(PREDECESSOR) == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    assert evidence["native_fixture"]["all_passed"] is True
