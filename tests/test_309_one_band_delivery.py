"""Exact309 delivery: ordered admission, the served-band score, planning water, the retirements, native evidence.

Jason, 2026-11-15: the dynamic served house band is the only temp/VPD measurement basis (the crop band retires), house
or hose water is not planning information, inference-infra telemetry is out of scope, and resource cost leaves the
planner reward (#1623); one release, no soak. test_native_qualification_is_recorded is the merge gate for the
rolled-back production run (production at 308) and db/qualification/309-one-band-retirement-fixture.sql.
"""

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PREDECESSOR = 308
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"
RETIRED_COLUMNS = (
    "compliance_v2_raw_pct",
    "compliance_v2_attributable_pct",
    "compliance_v2_unachievable_frac",
    "graded_temp_compliance_pct",
    "graded_vpd_compliance_pct",
    "graded_stress_hours_heat",
    "graded_stress_hours_cold",
    "graded_stress_hours_vpd_high",
    "graded_stress_hours_vpd_low",
    "feasibility_unknown_min",
    "climate_observed_minute_metrics",
    "kwh_heat",
    "kwh_fans",
    "kwh_other",
    "gas_used_therms",
    "dev_temp_norm_median_day",
    "dev_temp_norm_median_night",
    "dev_temp_norm_p95",
    "dev_vpd_norm_median_day",
    "dev_vpd_norm_median_night",
    "dev_vpd_norm_p95",
    "notes",
    "cycles_dehum",
    "cycles_safety_dehum",
    "dli_final",
)


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


c0 = load("oneband309_delivery", "c0-migration-delivery.py")
six = load("oneband309_six", "bootstrap-six-runtime-roles.py")
maintenance = load("oneband309_maintenance", "bootstrap-maintenance-runtime-roles.py")
qualifier = load("oneband309_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_309
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/309-one-band-retirement-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/309-one-band-retirement-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 310)]


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
    return BODY.split(f"VIEW public.{name} AS", 1)[1].split(";", 1)[0]


# ── Admission and the file ──────────────────────────────────────────────────


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    assert hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == c0.SUCCESSOR_309_SHA256 == six.ONE_BAND_MIGRATION[2]
    assert six.ONE_BAND_MIGRATION[:2] == (309, c0.SUCCESSOR_309) == (309, "309-one-band-retirement.sql")
    c0.reviewed_post_254(later(), files())
    with pytest.raises(c0.DeliveryError, match="309 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_309: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["309-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_successor_binds_its_measured_seals_and_exact_ledger_row():
    assert six.SUCCESSOR_308 == registered(PREDECESSOR)
    assert six.SUCCESSOR_309 == registered(309)
    assert c0.SUCCESSOR_309_DIGESTS == {API: six.SUCCESSOR_309["api"], INGESTOR: six.SUCCESSOR_309["ingestor"]}
    old = six.seal_profile_sql(PREDECESSOR, six.SUCCESSOR_308)
    expected = "(" + six.sealed_sql_308().replace(old, six.seal_profile_sql(309, six.SUCCESSOR_309), 1)
    expected += " AND " + six.ledger_row_sql(*six.ONE_BAND_MIGRATION) + ")"
    assert six.sealed_sql_309() == expected
    assert six.sealed_sql().count(" OR " + six.sealed_sql_308() + " OR " + expected) == 1
    assert maintenance.contract_sql().count(" OR " + six.sealed_sql_309()) == 1
    assert '"309-one-band-retirement.sql",' in (ROOT / "tests/test_experiment_schema_migration.py").read_text()
    assert "tests/test_309_one_band_delivery.py" in (ROOT / "scripts/ci-local.sh").read_text()


def test_migration_pins_its_predecessor_and_reseals_every_receipt():
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{c0.SUCCESSOR_308}'" in SOURCE
    assert f"sha256='{c0.SUCCESSOR_308_SHA256}'" in SOURCE
    assert f"seq>{PREDECESSOR})" in SOURCE
    head = SOURCE.split("DO $successor$", 1)[0]
    assert qualifier.successor_literals(SOURCE) == six.SUCCESSOR_309
    for seal, digest in registered(PREDECESSOR).items():
        assert f"'{digest}'" in head.split("END $predecessor$;", 1)[0], seal
    successor = SOURCE.split("DO $successor$", 1)[1]
    for login in (API, INGESTOR):
        assert f"WHERE login_name='{login}';" in successor
    assert "UPDATE public.mcp_runtime_boundary_receipt" in successor
    assert "'309 refuses an unqualified predecessor'" in SOURCE and "'309 refuses an unqualified successor'" in SOURCE


def test_file_is_wrap_safe_and_every_session_ends_in_rollback():
    assert not safety.classify(MIGRATION).self_committing
    qualifier.refuse_transaction_control(SOURCE)
    code = uncommented(SOURCE).upper()
    for forbidden in (r"\bCOMMIT\b", r"CONCURRENTLY", r"VACUUM", r"ALTER SYSTEM", r"PASSWORD", r"\bCASCADE\b"):
        assert not re.search(forbidden, code), forbidden
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name
        assert sql.count("ROLLBACK;") == 1, name


# ── The body ────────────────────────────────────────────────────────────────


def test_views_over_daily_summary_are_taken_before_daily_summary():
    lock = BODY.index("LOCK TABLE public.daily_summary IN ACCESS EXCLUSIVE MODE;")
    alter = BODY.index("ALTER TABLE public.daily_summary")
    for statement in (
        "DROP VIEW verdify_grafana_runtime.v_planner_performance;",
        "DROP VIEW public.v_plan_window_scorecard;",
        "DROP VIEW public.v_planner_performance;",
        "DROP VIEW verdify_grafana_runtime.daily_summary, verdify_lab_publisher_runtime.daily_summary;",
        "DROP VIEW public.v_scorecard_climate_diagnostics;",
        "ALTER VIEW public.v_daily_kpi OWNER TO verdify;",
        "CREATE OR REPLACE VIEW public.v_stress_hours_today AS",
        "CREATE OR REPLACE VIEW public.v_dli_daily AS",
        "CREATE OR REPLACE VIEW public.v_runtime_energy_daily AS",
        "CREATE OR REPLACE VIEW public.v_water_attribution_daily AS",
        "CREATE OR REPLACE VIEW public.v_daily_kpi AS",
    ):
        assert BODY.index(statement) < lock < alter, statement
    # v_daily_kpi is held before the views it reads are replaced.
    assert BODY.index("ALTER VIEW public.v_daily_kpi") < BODY.index(
        "CREATE OR REPLACE VIEW public.v_water_attribution_daily"
    )


def test_planner_score_is_the_served_band_compliance_with_no_resource_term():
    for name in ("v_daily_kpi", "v_planner_performance"):
        sql = view(name)
        assert "COALESCE(e.compliance_pct, 0::double precision) AS score_compliance" in sql or (
            "COALESCE(d.compliance_pct, 0::double precision) AS score_compliance" in sql
        ), name
        assert "round(score_compliance::numeric, 1) AS planner_score" in sql, name
        assert "0::numeric AS planner_score_resource_weight_pct" in sql, name
        assert "false AS resource_terms_available" in sql, name
        assert "cost_total / 15.0" not in sql and "80::double precision" not in sql, name
        for column in RETIRED_COLUMNS:
            assert column not in sql, (name, column)
    scorecard = BODY.split("FUNCTION public.fn_planner_scorecard(", 1)[1].split("$function$;", 1)[0]
    assert "SELECT 'scorecard_contract_version'::text, 3::numeric" in scorecard
    assert "SELECT 'resource_terms_available', 0::numeric" in scorecard
    assert "SELECT 'planner_score_resource_weight_pct', 0::numeric" in scorecard
    assert "public.daily_summary" not in scorecard and "v_scorecard_climate_diagnostics" not in scorecard
    assert not re.search(r"compliance_v2|graded|unachievable|feasib", scorecard)


def test_planning_water_excludes_house_water_and_energy_needs_no_zero_width_bounds():
    water = view("v_water_attribution_daily")
    assert (
        "COALESCE(e.climate_wetting_gal, 0::double precision) + COALESCE(e.wall_irrigation_gal, 0::double precision)"
        " + COALESCE(e.wall_fertigation_gal, 0::double precision) AS planning_water_gal" in water
    )
    assert "COALESCE(e.manual_or_unattributed_gal, 0::double precision) AS house_water_gal" in water
    kpi = view("v_daily_kpi")
    assert "WHEN water_ok THEN round(planning_water_gal::numeric, 0)" in kpi
    assert "e.planning_water_gal AS water_gal_source" in kpi and "e.water_used_gal\n" not in kpi
    energy = view("v_runtime_energy_daily")
    assert "has_uncertainty" in energy  # model_quality still reports uncertain coefficients
    available = energy.split("AS model_quality", 1)[1].split("AS available_for_scoring", 1)[0]
    assert "has_uncertainty" not in available


def test_served_band_readers_and_capture_v3():
    stress = view("v_stress_hours_today")
    assert "LEFT JOIN daily_summary d ON d.date = b.local_day" in stress and "fn_zone_band" not in stress
    timeline = BODY.split("FUNCTION public.fn_band_timeline(", 1)[1].split("$function$;", 1)[0]
    assert "setpoint_changes" not in timeline
    for role in ("temp_low", "temp_high", "vpd_low", "vpd_high"):
        assert f"s.parameter = 'band_house_{role}'" in timeline, role
    assert timeline.count("s.ts > t.ts - interval '600 seconds'") == 4
    capture = BODY.split("FUNCTION public.fn_capture_daily_climate_metric_revision()", 1)[1].split("$function$;", 1)[0]
    assert "'graded'" not in capture and "observed_minute" not in capture
    assert "SET DEFAULT 'daily-summary-capture-v3'" in BODY


def test_retirements_are_exact_and_without_cascade():
    drops = " ".join(
        " ".join(d.split()) for d in re.findall(r"\bDROP (?:TABLE|VIEW|MATERIALIZED VIEW|FUNCTION)[^;]*;", BODY)
    )
    for name in (
        "public.daily_zone_compliance",
        "public.compliance_zone_weights",
        "public.mv_zone_band_grade",
        "public.v_zone_band",
        "public.v_target_curve",
        "public.v_scorecard_climate_diagnostics",
        "public.fn_zone_band(text,timestamptz,text)",
        "public.fn_zone_band_grade(timestamptz,timestamptz,text)",
        "public.fn_compliance_v2(interval)",
        "public.fn_grade_credit(numeric,numeric,numeric,numeric,numeric)",
        "public.fn_compliance_pct(interval)",
        "public.fn_house_compliance(interval)",
        "public.fn_observed_minute_diagnostic(date,text)",
        "public.gpu_power",
        "public.infra_cpu",
        "public.v_runtime_gpu_power_write",
        "public.v_runtime_infra_cpu_write",
        "public.achievable_envelope",
        "public.weather_station",
        "public.daily_summary_compliance_backup_20260430",
        "public.openclaw_interaction_log",
    ):
        assert name in drops, name
    alter = BODY.split("ALTER TABLE public.daily_summary", 1)[1].split(";", 1)[0]
    assert sorted(re.findall(r"DROP COLUMN (\w+)", alter)) == sorted(RETIRED_COLUMNS)
    for keep in ("crop_target_profiles", "irrigation_log", "irrigation_schedule", "crop_band_anchors"):
        assert keep not in drops, keep
    # The recreated per-login wrappers name every remaining column and none of the retired ones.
    for schema in ("verdify_grafana_runtime", "verdify_lab_publisher_runtime"):
        wrapper = BODY.split(f"CREATE VIEW {schema}.daily_summary WITH(security_barrier=true) AS SELECT", 1)[1]
        wrapper = wrapper.split("FROM public.daily_summary;", 1)[0]
        assert not any(f'"{c}"' in wrapper for c in RETIRED_COLUMNS), schema
        assert f"GRANT SELECT ON {schema}.daily_summary TO {schema};" in BODY


def test_the_digest_drops_exactly_the_retired_closure_entries():
    digest = BODY.split("FUNCTION public.fn_runtime_ordinary_boundary_digest(", 1)[1].split("$function$;", 1)[0]
    assert "cardinality(v_invoker_helper_closure) <> 30" in digest
    assert "cardinality(v_protected_relations) <> 48" in digest
    for retired in ("gpu_power", "infra_cpu", "fn_zone_band", "fn_compliance", "fn_grade_credit"):
        assert retired not in digest, retired
    assert "'public.fn_center_band_setpoints(timestamptz)'::regprocedure" in digest
    assert "'public.fn_planner_scorecard(date)'::regprocedure" in digest


# ── The native qualification ────────────────────────────────────────────────


def test_native_fixture_reads_as_every_consumer_login():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    for login in (
        "verdify_api_runtime_login",
        "verdify_ingestor_runtime_login",
        "verdify_mcp_runtime_login",
        "verdify_grafana_runtime_login",
        "verdify_lab_publisher_runtime_login",
    ):
        assert f"SET SESSION AUTHORIZATION {login};" in text, login
    assert text.count("RESET SESSION AUTHORIZATION;") == 5


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_309
    assert evidence["projected_successor"] == six.SUCCESSOR_309 == qualifier.successor_literals(SOURCE)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact309 and its measured seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False
    assert evidence["migration"] == c0.SUCCESSOR_309
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_309_SHA256
    assert evidence["qualified_successor"] == six.SUCCESSOR_309 == registered(309)
    assert evidence["before"] == registered(PREDECESSOR)
    assert evidence["before"] == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    assert evidence["native_fixture"]["all_passed"] is True
