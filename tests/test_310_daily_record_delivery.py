"""Exact310 delivery: ordered admission, the daily record with lost OFF events repaired, unchanged seals, native evidence.

#1668 and plan section 10 (climate refactor, epic #1633): the law is judged on relay starts and run time and on
electricity, gas and water, compared with the 30 days before it. Run time between equipment_state edges turns a lost
OFF event into hours of false run time; 310 repairs it from the firmware relay counter (a run booked inside an event
interval) and, for wet relays, the water meter, and stores one row per day and relay plus one per day of utilities.
The relations keep no ACL entry and every new function's PUBLIC EXECUTE is revoked, so every seal keeps 309's value.
The repair and the store are proved on production's own data (two known furnace lost OFF events) by the native
fixture inside the rolled-back qualification; test_native_qualification_is_recorded is the merge gate for the rolled-back production run (production at 309) that
measures the seals and runs db/qualification/310-daily-record-fixture.sql.
"""

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
PREDECESSOR = 309
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclasses resolve their module while the file executes
    spec.loader.exec_module(module)
    return module


c0 = load("daily_record310_delivery", "c0-migration-delivery.py")
six = load("daily_record310_six", "bootstrap-six-runtime-roles.py")
maintenance = load("daily_record310_maintenance", "bootstrap-maintenance-runtime-roles.py")
qualifier = load("daily_record310_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_310
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/310-daily-record-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/310-daily-record-native-qualification.json"
CRONJOB = ROOT / "deploy/k8s/components/grafana/band-curve-refresh-cronjob.yaml"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 311)]
RELAYS = (
    "heat1",
    "heat2",
    "fan1",
    "fan2",
    "vent",
    "fog",
    "mister_south",
    "mister_west",
    "mister_center",
    "drip_wall",
    "drip_center",
)


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


def function(name):
    return BODY.split(f"CREATE FUNCTION {name}(", 1)[1].split("$;", 1)[0]


# ── Admission and the file ──────────────────────────────────────────────────


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    raw = MIGRATION.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == c0.SUCCESSOR_310_SHA256 == six.DAILY_RECORD_MIGRATION[2]
    assert six.DAILY_RECORD_MIGRATION[:2] == (310, c0.SUCCESSOR_310) == (310, "310-daily-record.sql")
    c0.reviewed_post_254(later(), files())
    with pytest.raises(c0.DeliveryError, match="310 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_310: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["310-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_successor_keeps_every_seal_and_binds_its_exact_ledger_row():
    predecessor = getattr(six, f"SUCCESSOR_{PREDECESSOR}")
    assert six.SUCCESSOR_310 == predecessor == registered(PREDECESSOR) == registered(310)
    assert c0.SUCCESSOR_310_DIGESTS == {API: six.SUCCESSOR_310["api"], INGESTOR: six.SUCCESSOR_310["ingestor"]}
    old = six.seal_profile_sql(PREDECESSOR, predecessor)
    expected = "(" + getattr(six, f"sealed_sql_{PREDECESSOR}")().replace(
        old, six.seal_profile_sql(310, six.SUCCESSOR_310), 1
    )
    expected += " AND " + six.ledger_row_sql(*six.DAILY_RECORD_MIGRATION) + ")"
    assert six.sealed_sql_310() == expected
    assert "(SELECT max(seq) FROM public.schema_migrations WHERE source='db/migrations')=310" in expected
    assert "stamp_method='runner'" in six.ledger_row_sql(*six.DAILY_RECORD_MIGRATION)
    assert six.sealed_sql().count(" OR " + getattr(six, f"sealed_sql_{PREDECESSOR}")() + " OR " + expected) == 1
    assert maintenance.contract_sql().count(" OR " + six.sealed_sql_310()) == 1
    assert '"310-daily-record.sql",' in (ROOT / "tests/test_experiment_schema_migration.py").read_text()
    assert "tests/test_310_daily_record_delivery.py" in (ROOT / "scripts/ci-local.sh").read_text()


def test_migration_pins_its_predecessor_and_proves_the_seals_unchanged():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in SOURCE
    assert f"sha256='{sha}'" in SOURCE
    assert f"seq>{PREDECESSOR})" in SOURCE
    for digest in registered(310).values():
        assert SOURCE.count(f"'{digest}'") == 2
    assert qualifier.successor_literals(SOURCE) == six.SUCCESSOR_310
    assert "'310 refuses an unqualified predecessor'" in SOURCE and "'310 changed a runtime boundary'" in SOURCE
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


# ── The body: additive only, no grant but the duty's ────────────────────────


def test_the_body_only_adds_and_grants_only_the_refresh_duty():
    assert re.findall(r"CREATE (?:OR REPLACE )?FUNCTION (\S+)\(", BODY) == [
        "public.fn_daily_record_relays",
        "public.fn_relay_run_intervals",
        "public.fn_daily_record_store",
        "verdify_matview_refresh_runtime.fn_refresh_daily_record",
    ]
    assert re.findall(r"CREATE TABLE (\S+)", BODY) == ["public.daily_relay_record", "public.daily_record"]
    assert re.findall(r"CREATE (?:OR REPLACE )?VIEW (\S+)", BODY) == ["public.v_daily_record"]
    for statement in ("OR REPLACE", "ALTER ", "DROP ", "DELETE", "UPDATE public.", "TRUNCATE", "daily_summary"):
        assert statement not in BODY, statement
    grants = [" ".join(g.split()) for g in re.findall(r"\bGRANT\b.*?;", BODY, re.S)]
    assert grants == [
        "GRANT EXECUTE ON FUNCTION verdify_matview_refresh_runtime.fn_refresh_daily_record() "
        "TO verdify_matview_refresh_runtime;"
    ]
    revokes = [" ".join(r.split()) for r in re.findall(r"\bREVOKE\b.*?;", BODY, re.S)]
    assert revokes == [
        "REVOKE ALL ON FUNCTION public.fn_daily_record_relays() FROM PUBLIC;",
        "REVOKE ALL ON FUNCTION public.fn_relay_run_intervals(timestamptz, timestamptz) FROM PUBLIC;",
        "REVOKE ALL ON FUNCTION public.fn_daily_record_store(date) FROM PUBLIC;",
        "REVOKE ALL ON FUNCTION verdify_matview_refresh_runtime.fn_refresh_daily_record() FROM PUBLIC;",
    ]
    for runtime in ("verdify_api_runtime", "verdify_ingestor_runtime", "verdify_mcp", "verdify_dashboard"):
        assert runtime not in BODY, runtime
    # The only SECURITY DEFINER is the duty's entry point, which refuses any other session user.
    assert BODY.count("SECURITY DEFINER") == 1
    refresh = function("verdify_matview_refresh_runtime.fn_refresh_daily_record")
    assert "IF session_user <> 'verdify_matview_refresh_runtime_login' THEN" in refresh


def test_the_relays_are_the_eleven_climate_and_wetting_relays():
    relays = function("public.fn_daily_record_relays")
    rows = re.findall(r"\('(\w+)', (true|false), (true|false)\)", relays)
    assert tuple(name for name, _, _ in rows) == RELAYS
    counted = {name for name, counter, _ in rows if counter == "true"}
    wet = {name for name, _, water in rows if water == "true"}
    # The firmware's six relay-layer counters (controls.yaml R[]) book a run at each OFF; the misters' counters do not.
    assert counted == {"heat1", "heat2", "fan1", "fan2", "vent", "fog"}
    assert wet == {"fog", "mister_south", "mister_west", "mister_center", "drip_wall", "drip_center"}
    controls = (ROOT / "firmware/greenhouse/controls.yaml").read_text()
    assert "r.runtime_ms += now_ms - r.on_stamp_ms;" in controls
    for stream in counted:
        assert f"id(runtime_{stream}_ms)" in controls, stream


def test_the_repair_rules():
    fn = " ".join(function("public.fn_relay_run_intervals").split())
    # A counter step whose two samples both lie inside the event interval, 60 s from either end, is a lost OFF.
    assert (
        "b.previous_at > ev.on_at AND b.at > ev.on_at + interval '60 seconds' AND b.at < ev.off_at - interval '60 seconds'"
        in fn
    )
    # A fall of the counter (midnight or a reboot) books nothing.
    assert "WHERE s.previous_v IS NOT NULL AND s.v - s.previous_v > 0.05" in fn
    # The rebuilt runs end at each step and are as long as it, never before the event start.
    assert "GREATEST(k.on_at, b.at - b.run_s * interval '1 second'), b.at" in fn
    # Wet relays: an interval over 5 minutes ends at the first 3 minutes without flow, unless the counter repaired it.
    assert "WHERE ev.wet AND ev.off_at - ev.on_at > interval '5 minutes'" in fn
    assert "c.flow_gpm < 0.1" in fn and "f.ts < c.ts + interval '3 minutes'" in fn
    # Callers get only intervals that overlap their window.
    assert "WHERE r.on_at < p_end AND r.off_at > p_start" in fn


def test_the_store_clips_to_the_local_day_and_prices_gas_from_the_coefficient():
    store = " ".join(function("public.fn_daily_record_store").split())
    assert "v_start := p_day::timestamp AT TIME ZONE 'America/Denver';" in store
    assert "v_end := (p_day + 1)::timestamp AT TIME ZONE 'America/Denver';" in store
    assert "extract(epoch FROM LEAST(r.off_at, v_end) - GREATEST(r.on_at, v_start))" in store
    assert "r.on_at >= v_start AND r.on_at < v_end" in store  # a start counts on the day it began
    assert "rc.resource_kind = 'gas_btu_per_hour'" in store and "/ 100000.0" in store
    assert "FROM public.v_energy_daily ed" in store and "FROM public.v_water_attribution_daily w" in store
    assert "a.climate_action = 'DEHUM_VENT'" in store
    assert "r.on_at >= d.ended AND r.on_at < d.ended + interval '15 minutes'" in store
    assert "now() >= v_end" in store  # complete


def test_the_refresh_backfills_the_baseline_before_the_law():
    refresh = " ".join(function("verdify_matview_refresh_runtime.fn_refresh_daily_record").split())
    assert "(VALUES (v_today), (v_today - 1))" in refresh
    assert "generate_series(DATE '2026-10-17', v_today - 2, interval '1 day')" in refresh
    assert "ORDER BY missing.d DESC LIMIT 8" in refresh


def test_the_view_reads_the_one_compliance_definition():
    view = BODY.split("CREATE VIEW public.v_daily_record AS", 1)[1].split(";", 1)[0]
    assert "LEFT JOIN public.daily_band_compliance b ON b.date = d.date" in view
    for relay in RELAYS:
        assert f"AS {relay}_starts" in view and f"AS {relay}_run_h" in view, relay
    climate = "r.equipment IN ('heat1', 'heat2', 'fan1', 'fan2', 'vent', 'fog')"
    assert view.count(climate) == 2
    assert view.count("r.equipment IN ('mister_south', 'mister_west', 'mister_center')") == 2


def test_the_cronjob_runs_the_refresh_last():
    job = yaml.safe_load(CRONJOB.read_text())
    command = job["spec"]["jobTemplate"]["spec"]["template"]["spec"]["containers"][0]["command"][-1]
    calls = re.findall(r"SELECT (verdify_matview_refresh_runtime\.fn_\w+)\(\)", command)
    assert calls[-1] == "verdify_matview_refresh_runtime.fn_refresh_daily_record"
    assert calls.count("verdify_matview_refresh_runtime.fn_refresh_daily_record") == 1


# ── The native qualification ────────────────────────────────────────────────


def test_native_fixture_runs_the_cronjob_call_and_checks_the_two_known_repairs():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    assert text.index("SET SESSION AUTHORIZATION verdify_matview_refresh_runtime_login;") < text.index(
        "verdify_matview_refresh_runtime.fn_refresh_daily_record()"
    )
    assert text.count("RESET SESSION AUTHORIZATION;") == 1
    assert "date = DATE '2026-11-06' AND equipment = 'heat2'" in text
    assert "date = DATE '2026-10-24' AND equipment = 'heat2'" in text


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_310
    assert evidence["projected_successor"] == six.SUCCESSOR_310 == qualifier.successor_literals(SOURCE)
    assert evidence["before"] == registered(PREDECESSOR)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact310 and its unchanged seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False, (
        "310 native qualification pending: with production at 309, run scripts/qualify-migration-successor.py "
        "db/migrations/310-daily-record.sql --native-fixture db/qualification/310-daily-record-fixture.sql --fixture "
        "tests/fixtures/310-daily-record-native-qualification.json on production (every session rolls back) and "
        "commit the fixture it writes"
    )
    assert evidence["migration"] == c0.SUCCESSOR_310
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_310_SHA256
    assert evidence["qualified_successor"] == six.SUCCESSOR_310 == registered(310) == registered(PREDECESSOR)
    assert evidence["before"] == registered(PREDECESSOR)
    assert evidence["before"] == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    native = evidence["native_fixture"]
    assert native["all_passed"] is True
    assert native["attested"] == {"matview_refresh": True}
