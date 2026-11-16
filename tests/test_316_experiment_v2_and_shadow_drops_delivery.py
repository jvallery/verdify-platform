"""Exact316 delivery: ordered admission, the archived drop list, the dependency guard, the roles, the seals.

#1633 host release 4 (contracts phase4-drops): the experiment v2, the policy twin, the planner graph, memory and pack
tables, forecast_deviation_thresholds, the retired planner experiment views and thirteen retired roles are dropped
after the archive Job counted their rows. test_native_qualification_is_recorded is the merge gate: the seal literals
are measured by the rolled-back production qualification.
"""

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PREDECESSOR = 315
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"
COLLECTOR_FUNCTIONS = (
    "public.fn_record_equipment_counter_sample(uuid,timestamp with time zone,text,text,text,double precision,text,"
    "uuid,double precision,uuid,bigint,text)",
    "public.fn_record_equipment_state_source_receipt(uuid,timestamp with time zone,text,text,jsonb,boolean,uuid,"
    "bigint,text)",
)
DIRECT_SNAPSHOT = (
    "public.fn_record_equipment_direct_state_snapshot(uuid,uuid,text,text,jsonb,double precision,uuid,bigint,text)"
)
ROLES = [
    "verdify_experiment_lifecycle",
    "verdify_experiment_component_executor",
    "verdify_experiment_shadow_scheduler",
    "verdify_experiment_randomizer",
    "verdify_experiment_outcome_freezer",
    "verdify_experiment_blinded_analyst",
    "verdify_experiment_v2_lifecycle_login",
    "verdify_experiment_v2_component_executor_login",
    "verdify_experiment_v2_shadow_scheduler_login",
    "verdify_experiment_v2_randomizer_login",
    "verdify_experiment_v2_outcome_freezer_login",
    "twin_ro",
    "verdify_twin_ro",
]
# Objects steer and the contract keep: a reader is still live or removed only by release 4 itself.
KEPT = (
    "v_active_plan",
    "fn_house_vpd_control_band",
    "planner_inference_runs",
    "v_planner_inference_runs",
    "forecast_action_rules",
    "control_experiments",
    "equipment_direct_state_snapshots",
    "equipment_counter_samples",
    "equipment_state_source_receipts",
    "fn_experiment_v2_control_guard",
    "fn_experiment_v2_require_end_recovery_completion",
    "verdify_experiment_v2_owner",
    "verdify_experiment_equipment_source_collector",
)


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


c0 = load("drops316_delivery", "c0-migration-delivery.py")
six = load("drops316_six", "bootstrap-six-runtime-roles.py")
maintenance = load("drops316_maintenance", "bootstrap-maintenance-runtime-roles.py")
qualifier = load("drops316_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_316
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/316-experiment-v2-and-shadow-drops-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/316-experiment-v2-and-shadow-drops-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 317)]


def uncommented(text):
    return re.sub(r"--[^\n]*", "", text)


PRED_BLOCK = SOURCE[SOURCE.index("DO $predecessor$") : SOURCE.index("END $predecessor$;")]
GUARD = SOURCE[SOURCE.index("DO $guard$") : SOURCE.index("END $guard$;")]
BODY = uncommented(SOURCE.split("END $guard$;", 1)[1].split("DO $successor$", 1)[0])
SUCCESSOR_BLOCK = SOURCE[SOURCE.index("DO $successor$") :]


def statements(kind):
    """Names in each top-level DROP <kind> statement, in order."""
    found = []
    for match in re.finditer(rf"^DROP {kind}\n(.*?);", BODY, re.S | re.M):
        found.append([name.strip() for name in match.group(1).split(",\n")])
    return found


def array_after(text, marker):
    start = text.index("ARRAY[", text.index(marker)) + len("ARRAY[")
    names = []
    for match in re.finditer(r"\s*'([^']+)'([,\]])", text[start:]):
        names.append(match.group(1))
        if match.group(2) == "]":
            return names
    raise AssertionError(f"unterminated array after {marker}")


def later():
    return [c0.SUCCESSOR_254] + [getattr(c0, f"SUCCESSOR_{n}") for n in NUMBERS]


def files():
    return {getattr(c0, f"SUCCESSOR_{n}"): getattr(c0, f"SUCCESSOR_{n}_SHA256") for n in NUMBERS}


def registered(n):
    digests = getattr(c0, f"SUCCESSOR_{n}_DIGESTS")
    return {"api": digests[API], "ingestor": digests[INGESTOR], "mcp": getattr(c0, f"SUCCESSOR_{n}_MCP_DIGEST")}


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    assert hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == c0.SUCCESSOR_316_SHA256
    assert six.EXPERIMENT_V2_SHADOW_DROPS_MIGRATION == (316, c0.SUCCESSOR_316, c0.SUCCESSOR_316_SHA256)
    assert c0.SUCCESSOR_316 == "316-experiment-v2-and-shadow-drops.sql"
    c0.reviewed_post_254(later(), files())
    c0.reviewed_post_254(later()[:-1], files())
    with pytest.raises(c0.DeliveryError, match="316 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_316: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["316-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_file_is_wrap_safe_and_every_session_ends_in_rollback():
    assert not safety.classify(MIGRATION).self_committing
    qualifier.refuse_transaction_control(SOURCE)
    code = qualifier._code_only(SOURCE)[0].upper()
    for forbidden in (r"\bCOMMIT\b", r"CONCURRENTLY", r"VACUUM", r"ALTER SYSTEM", r"PASSWORD", r"\bTRUNCATE\b"):
        assert not re.search(forbidden, code), forbidden
    assert SOURCE.isascii()
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name


def test_predecessor_binds_exact315_with_its_registered_seals():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in PRED_BLOCK and f"sha256='{sha}'" in PRED_BLOCK
    assert f"seq>{PREDECESSOR})" in PRED_BLOCK and "stamp_method='runner'" in PRED_BLOCK
    for seal, digest in registered(PREDECESSOR).items():
        assert PRED_BLOCK.count(f"'hex') IS DISTINCT FROM '{digest}'") == 1, seal


def test_no_blind_cascade_and_every_drop_is_named():
    assert "CASCADE" not in uncommented(SOURCE).upper()
    (views,) = statements("VIEW")
    plain_fns, trigger_fns = statements("FUNCTION")
    hypertables, tables = statements("TABLE")
    assert len(views) == 11 and len(plain_fns) == 92 and len(trigger_fns) == 21
    assert hypertables == ["public.twin_decisions", "public.twin_live_results", "public.firmware_twin_divergence"]
    assert len(tables) == 45
    every = views + plain_fns + trigger_fns + hypertables + tables
    assert len(every) == len(set(every)) == 11 + 113 + 48
    assert all(name.startswith("public.") for name in every)
    # Order: functions that take dropped rowtypes, the views, the tables, then the trigger functions.
    order = [BODY.index("DROP FUNCTION\n"), BODY.index("DROP VIEW\n"), BODY.index("DROP TABLE\n")]
    assert order == sorted(order) and BODY.rindex("DROP FUNCTION\n") > BODY.rindex("DROP TABLE\n")
    assert all(name.endswith("()") for name in trigger_fns)
    for kept in KEPT:
        assert not any(re.search(rf"\.{kept}\b", name) for name in every), kept
    assert not any("fn_record_equipment" in name for name in every)
    assert re.findall(r"\bREVOKE\b[^;]*;", BODY) == [
        "REVOKE INSERT, UPDATE ON public.setpoint_plan FROM verdify_mcp_runtime;"
    ]
    assert not re.search(r"\bGRANT\b", BODY)


def test_relation_drops_take_bounded_locks_views_before_tables():
    """Coordinator 2026-11-16: no up-front LOCK of views over hot tables; views before tables; bounded waits."""
    code = qualifier._code_only(SOURCE)[0].upper()
    for statement in ("DROP VIEW", "DROP TABLE", "ALTER TABLE", "REVOKE", "LOCK TABLE PUBLIC.SETPOINT"):
        assert statement not in code.replace("LOCK TABLE PUBLIC.SCHEMA_MIGRATIONS", ""), statement
    block = SOURCE[SOURCE.index("DO $drops$") : SOURCE.index("END $drops$;")]
    targets = re.findall(r"\((\d), '([^']+)', \$ddl\$", block)
    assert targets == [
        ("1", "views"),
        ("2", "planner_inference_runs foreign key"),
        ("3", "setpoint_plan writes"),
        ("4", "twin hypertables"),
        ("5", "tables"),
    ]
    assert "set_config('lock_timeout', '5s', true)" in block and "attempt >= 8" in block
    assert "EXCEPTION WHEN lock_not_available" in block and "pg_sleep(1)" in block
    assert "'316 left lock_timeout changed'" in block
    # The table drops come after the roles and before the trigger functions and the seals.
    assert SOURCE.index("DROP ROLE") < SOURCE.index("DO $drops$")
    assert SOURCE.index("END $drops$;") < SOURCE.rindex("DROP FUNCTION") < SOURCE.index("DO $successor$")


def test_the_lists_match_the_predecessor_the_guard_and_the_archive_counts():
    tables = sorted(t.split(".", 1)[1] for group in statements("TABLE") for t in group)
    views = sorted(v.split(".", 1)[1] for v in statements("VIEW")[0])
    sigs = sorted(f.split(".", 1)[1] for group in statements("FUNCTION") for f in group)
    assert sorted(array_after(PRED_BLOCK, "AND c.relkind='r'")) == tables
    assert sorted(array_after(PRED_BLOCK, "AND c.relkind='v'")) == views
    assert sorted(array_after(PRED_BLOCK, "FROM unnest(")) == sigs
    assert sorted(array_after(GUARD, "v_fns := ARRAY")) == sigs
    counts = dict(re.findall(r"\('(\w+)',(\d+)\)", PRED_BLOCK))
    assert sorted(counts) == tables and sum(int(n) for n in counts.values()) == 7736 + 131 + 3
    assert counts["planner_pack"] == "131" and counts["forecast_deviation_thresholds"] == "3"
    assert "the archive counted %" in PRED_BLOCK


def test_the_guard_checks_pg_depend_and_function_bodies_before_the_first_drop():
    assert SOURCE.index("END $guard$;") < SOURCE.index("\nDROP ")
    for catalog in ("pg_rewrite", "pg_trigger", "pg_constraint", "pg_attrdef", "pg_policy", "pg_proc", "pg_type"):
        assert f"d.classid='{catalog}'::regclass" in GUARD, catalog
    assert "d.refclassid='pg_class'::regclass" in GUARD and "d.refclassid='pg_proc'::regclass" in GUARD
    assert "p.prosrc ~" in GUARD
    assert "'public.fn_experiment_v2_require_end_recovery_completion()'::regprocedure" in GUARD
    assert "conname='planner_inference_runs_pack_sha256_fkey'" in GUARD
    assert "has_table_privilege('verdify_mcp_runtime', 'public.setpoint_plan', 'INSERT')" in PRED_BLOCK
    assert re.findall(r"ALTER TABLE[^;]*;", BODY) == [
        "ALTER TABLE public.planner_inference_runs DROP CONSTRAINT planner_inference_runs_pack_sha256_fkey;"
    ]


def test_roles_are_reassigned_disowned_and_dropped():
    def names(statement):
        block = BODY.split(statement, 1)[1].split(";", 1)[0]
        return [n.strip() for n in block.replace("TO verdify", "").split(",") if n.strip()]

    assert names("REASSIGN OWNED BY") == ROLES
    assert names("DROP OWNED BY") == ROLES
    assert names("DROP ROLE") == ROLES
    assert BODY.index("REASSIGN OWNED BY") < BODY.index("DROP OWNED BY") < BODY.index("DROP ROLE")
    assert "verdify_experiment_v2_owner" not in ROLES
    assert "verdify_experiment_equipment_source_collector" not in " ".join(ROLES)


def test_successor_reseals_every_receipt_with_the_registered_literals():
    literals = qualifier.successor_literals(SOURCE)
    assert literals == registered(316) == {k: six.SUCCESSOR_316[k] for k in ("api", "ingestor", "mcp")}
    assert SUCCESSOR_BLOCK.count("UPDATE public.runtime_ordinary_login_attestation_receipts") == 2
    for login, seal in ((API, "api"), (INGESTOR, "ingestor")):
        assert f"decode('{literals[seal]}','hex'), captured_at=clock_timestamp() WHERE login_name='{login}'" in (
            SUCCESSOR_BLOCK
        )
    assert f"decode('{literals['mcp']}','hex') WHERE singleton;" in SUCCESSOR_BLOCK
    assert "'316 receipts do not match the successor seals'" in SUCCESSOR_BLOCK


def test_sealed_sql_316_chains_from_315_and_binds_the_exact_ledger_row():
    old = six.seal_profile_sql(PREDECESSOR, six.SUCCESSOR_315)
    expected = "(" + six.sealed_sql_315().replace(old, six.seal_profile_sql(316, six.SUCCESSOR_316), 1)
    expected += " AND " + six.ledger_row_sql(*six.EXPERIMENT_V2_SHADOW_DROPS_MIGRATION) + ")"
    assert six.sealed_sql_316() == expected
    assert "(SELECT max(seq) FROM public.schema_migrations WHERE source='db/migrations')=316" in expected
    assert six.sealed_sql().count(" OR " + six.sealed_sql_315() + " OR " + expected) == 1
    assert maintenance.contract_sql().count(" OR " + six.sealed_sql_316()) == 1
    assert (
        '"316-experiment-v2-and-shadow-drops.sql",' in (ROOT / "tests/test_experiment_schema_migration.py").read_text()
    )
    assert "tests/test_316_experiment_v2_and_shadow_drops_delivery.py" in (ROOT / "scripts/ci-local.sh").read_text()


def test_rule5_both_attestation_lists_tolerate_the_direct_snapshot_function():
    """Contract section 0 rule 5: the lists stop requiring it in this release; a later one revokes and drops it."""
    sys.path.insert(0, str(ROOT / "ingestor"))
    ingestor_source = (ROOT / "ingestor/ingestor.py").read_text()
    required = ingestor_source.split("_EQUIPMENT_SOURCE_COLLECTOR_FUNCTIONS = (", 1)[1].split(")\n", 1)[0]
    tolerated = ingestor_source.split("_EQUIPMENT_SOURCE_COLLECTOR_TOLERATED_FUNCTIONS = (", 1)[1].split(")\n", 1)[0]
    assert "fn_record_equipment_direct_state_snapshot" not in required
    assert "fn_record_equipment_direct_state_snapshot" in tolerated
    hook = (ROOT / "deploy/k8s/components/experiment-v2-credential-bootstrap/bootstrap-job.yaml").read_text()
    assert hook.count("fn_record_equipment_direct_state_snapshot") == 1
    assert "'tolerated'" in hook
    assert DIRECT_SNAPSHOT not in SOURCE.split("DO $guard$")[1].split("DO $dropped$")[0]


def test_native_fixture_checks_the_drops_and_the_logins_that_stay():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    for login in (
        "verdify_experiment_v2_equipment_source_collector_login",
        "verdify_ingestor_runtime_login",
        "verdify_dashboard_runtime_login",
    ):
        assert f"SET SESSION AUTHORIZATION {login};" in text, login
    assert text.count("RESET SESSION AUTHORIZATION;") == 3
    for function in COLLECTOR_FUNCTIONS:
        assert function in text


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_316
    assert evidence["projected_successor"] == qualifier.successor_literals(SOURCE)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact316 and its measured seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False, (
        "316 native qualification pending: measure the literals with scripts/qualify-migration-successor.py "
        "db/migrations/316-experiment-v2-and-shadow-drops.sql --probe-only, write them into the file and its "
        "registrations, then run it with --native-fixture db/qualification/316-experiment-v2-and-shadow-drops-"
        "fixture.sql --fixture tests/fixtures/316-experiment-v2-and-shadow-drops-native-qualification.json and "
        "commit the fixture"
    )
    assert evidence["migration"] == c0.SUCCESSOR_316
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_316_SHA256
    assert evidence["qualified_successor"] == registered(316)
    first = [(r["migration"], r["sha256"]) for r in evidence.get("applied_first", [])]
    if first:
        # Production at 314 (release 4 not yet synced): the probe applied 315 first.
        assert first == [(getattr(c0, f"SUCCESSOR_{n}"), getattr(c0, f"SUCCESSOR_{n}_SHA256")) for n in (315,)]
        assert evidence["before"] == registered(314) == evidence["after_rollback"]
        assert evidence["applied_first_seals"] == registered(PREDECESSOR)
    else:
        assert evidence["before"] == registered(PREDECESSOR) == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    assert evidence["native_fixture"]["all_passed"] is True
