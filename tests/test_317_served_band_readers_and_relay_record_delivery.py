"""Exact317 delivery: ordered admission, the served-band readers, the relay record, the counter check, the seals.

#1633 host release 5 (#1734; validation CTL-24, TEL-23, release 4 review C-6, C-7, C-10; #1734 CTL-26): the band
readers read fn_band_setpoints, fn_band_timeline's thresholds are the climate law's lines, v_setpoint_forward goes,
the retired irrigation readback counts read NULL, the counter check gains boots and the early-record rule, and
daily_relay_record's run columns are defined. Views and functions only. test_native_qualification_is_recorded is the
merge gate: the literals are measured by the rolled-back production qualification.
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
from verdify_schemas import climate_law_constants as law  # noqa: E402

PREDECESSOR = 316
API, INGESTOR = "verdify_api_runtime_login", "verdify_ingestor_runtime_login"
RECON = "v_relay_counter_reconciliation_daily"
REPLACED = {
    # function -> the migration that last defined it (its body md5 is the predecessor's guard)
    "fn_band_timeline": "309-one-band-retirement.sql",
    "fn_climate_action_effectiveness": "142-climate-action-log.sql",
    "fn_climate_action_daily_scorecard": "260-restore-climate-action-daily-scorecard.sql",
    "fn_heat_staging_inversion": "079-heating-observability.sql",
}
GUARDED = {
    **REPLACED,
    "fn_house_vpd_control_band": "145-vanda-band-and-join-fix.sql",
    "fn_daily_record_store": "310-daily-record.sql",
}
HOUSE_COLUMNS = (
    "crop_vpd_low crop_vpd_high vpd_target_south vpd_target_west vpd_target_east vpd_target_center zone_vpd_min "
    "zone_vpd_median zone_vpd_max house_vpd_low house_vpd_high house_vpd_min_width_kpa house_vpd_low_margin_kpa"
).split()
TIMELINE_COLUMNS = (
    "ts greenhouse_id timeline_phase crop_temp_low crop_temp_high crop_vpd_low crop_vpd_high projected_temp_low "
    "projected_temp_high projected_vpd_low projected_vpd_high actual_temp_low actual_temp_high actual_vpd_low "
    "actual_vpd_high firmware_temp_low firmware_temp_high firmware_vpd_low firmware_vpd_high temp_width_f "
    "vpd_width_kpa sw_fsm_controller_enabled indoor_temp_f indoor_vpd_kpa outdoor_temp_f outdoor_vpd_kpa solar_w_m2 "
    "outdoor_cold_for_vent temp_hysteresis_f heat_hysteresis_f d_heat_stage_2_f d_cool_stage_2_f bias_heat_f "
    "bias_cool_f vpd_hysteresis_kpa vpd_hysteresis_effective_kpa fog_escalation_kpa temp_heat_target_f "
    "temp_heat_on_below_f temp_heat2_on_below_f temp_heat2_clear_f temp_cool_on_above_f temp_cool_hold_until_f "
    "temp_cooling_entry_margin_f temp_cooling_exit_hysteresis_f solar_cooling_lead_f temp_cool_stage2_delta_f "
    "temp_cool_stage2_on_above_f vpd_humidify_on_above_kpa vpd_humidify_resolved_below_kpa vpd_dehum_on_below_kpa "
    "vpd_dehum_resolved_above_kpa vpd_low_eff_kpa vpd_high_eff_kpa vpd_vent_fog_on_above_kpa "
    "vpd_sealed_fog_on_above_kpa"
).split()


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


c0 = load("band317_delivery", "c0-migration-delivery.py")
six = load("band317_six", "bootstrap-six-runtime-roles.py")
qualifier = load("band317_qualifier", "qualify-migration-successor.py")
safety = qualifier._safety()
MIGRATION = ROOT / "db/migrations" / c0.SUCCESSOR_317
SOURCE = MIGRATION.read_text()
NATIVE = ROOT / "db/qualification/317-served-band-readers-and-relay-record-fixture.sql"
FIXTURE = ROOT / "tests/fixtures/317-served-band-readers-and-relay-record-native-qualification.json"
NUMBERS = [*range(255, 292), 293, 294, 296, *range(301, 318)]


def uncommented(text):
    return re.sub(r"--[^\n]*", "", text)


BODY = uncommented(SOURCE.split("END $predecessor$;", 1)[1].split("DO $successor$", 1)[0])
PRED_BLOCK = SOURCE[SOURCE.index("DO $predecessor$") : SOURCE.index("END $predecessor$;")]
SUCCESSOR_BLOCK = SOURCE[SOURCE.index("DO $successor$") :]


def flat(text):
    return " ".join(text.split())


def view(name):
    text = BODY.split(f"CREATE OR REPLACE VIEW public.{name} AS", 1)[1]
    return flat(text.split("\n$", 1)[0])


def function(name):
    text = BODY.split(f"CREATE OR REPLACE FUNCTION public.{name}(", 1)[1]
    return text.split("$function$;", 1)[0]


def later():
    return [c0.SUCCESSOR_254] + [getattr(c0, f"SUCCESSOR_{n}") for n in NUMBERS]


def files():
    return {getattr(c0, f"SUCCESSOR_{n}"): getattr(c0, f"SUCCESSOR_{n}_SHA256") for n in NUMBERS}


def registered(n):
    digests = getattr(c0, f"SUCCESSOR_{n}_DIGESTS")
    return {"api": digests[API], "ingestor": digests[INGESTOR], "mcp": getattr(c0, f"SUCCESSOR_{n}_MCP_DIGEST")}


def test_exact_ordered_source_admission_denies_unknown_changed_and_skipped():
    assert hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == c0.SUCCESSOR_317_SHA256
    assert six.SERVED_BAND_READERS_MIGRATION == (317, c0.SUCCESSOR_317, c0.SUCCESSOR_317_SHA256)
    assert c0.SUCCESSOR_317 == "317-served-band-readers-and-relay-record.sql"
    c0.reviewed_post_254(later(), files())
    c0.reviewed_post_254(later()[:-1], files())
    with pytest.raises(c0.DeliveryError, match="317 successor source drift"):
        c0.reviewed_post_254(later(), {**files(), c0.SUCCESSOR_317: "0" * 64})
    rows = later()
    for invalid in (rows + ["399-unknown.sql"], rows[:-2] + rows[-1:], rows[:-1] + ["317-other.sql"]):
        with pytest.raises(c0.DeliveryError, match="unreviewed"):
            c0.reviewed_post_254(invalid, files())


def test_file_is_wrap_safe_appends_one_column_and_drops_one_unread_view():
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
        r"\bTRUNCATE\b",
        r"\bDELETE\b",
        r"\bCREATE TABLE\b",
        r"\bOWNER TO\b",
    ):
        assert not re.search(forbidden, code), forbidden
    assert re.findall(r"\bDROP\b[^;$]*", BODY) == ["DROP VIEW public.v_setpoint_forward RESTRICT\n"]
    assert re.findall(r"\b(?:GRANT|REVOKE)\b[^;]*", BODY) == [
        "REVOKE ALL ON verdify_grafana_runtime.planner_review FROM PUBLIC",
        "GRANT SELECT ON verdify_grafana_runtime.planner_review TO verdify_grafana_runtime",
    ]
    assert [flat(a) for a in re.findall(r"\bALTER\b[^;$]*", BODY)] == [
        "ALTER TABLE public.daily_record ADD COLUMN dry_refusal jsonb, ADD COLUMN drying_water_g double precision, "
        "ADD COLUMN drying_heat_wh double precision, ADD COLUMN drying_meter_lower_bound boolean"
    ]
    for name, sql in qualifier.sessions(SOURCE, (), qualifier.native_checks(NATIVE)).items():
        assert sql.startswith("BEGIN") and sql.endswith("ROLLBACK;\n"), name


def test_predecessor_binds_exact316_with_its_registered_seals():
    name = getattr(c0, f"SUCCESSOR_{PREDECESSOR}")
    sha = getattr(c0, f"SUCCESSOR_{PREDECESSOR}_SHA256")
    assert f"seq={PREDECESSOR} AND filename='db/migrations/{name}'" in PRED_BLOCK and f"sha256='{sha}'" in PRED_BLOCK
    assert f"seq>{PREDECESSOR})" in PRED_BLOCK and "stamp_method='runner'" in PRED_BLOCK
    for seal, digest in registered(PREDECESSOR).items():
        assert PRED_BLOCK.count(f"'hex') IS DISTINCT FROM '{digest}'") == 1, seal
    assert "attname IN ('boots', 'record_computed_at')" in PRED_BLOCK
    assert "to_regclass('public.v_setpoint_forward') IS NULL" in PRED_BLOCK
    assert "a.grantee<>c.relowner" in PRED_BLOCK


def test_predecessor_guards_each_replaced_functions_live_body():
    """md5(prosrc): the text between the dollar quotes of the migration that last defined each function."""
    for fn, filename in GUARDED.items():
        text = (ROOT / "db/migrations" / filename).read_text()
        pattern = rf"CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?{fn}\s*\("
        starts = [m.end() for m in re.finditer(pattern, text, re.I)]
        start = starts[-1]
        tag = re.search(r"AS\s+(\$\w*\$)", text[start:])
        begin = start + tag.end()
        digest = hashlib.md5(text[begin : text.index(tag.group(1), begin)].encode()).hexdigest()  # noqa: S324
        assert f"'{digest}')" in PRED_BLOCK, fn
    assert ") AS want(fn, body_md5) ON p.oid=to_regprocedure(want.fn) AND md5(p.prosrc)=want.body_md5)<>6" in (
        PRED_BLOCK
    )


def test_successor_reseals_every_receipt_with_the_registered_literals():
    literals = qualifier.successor_literals(SOURCE)
    assert literals == registered(317) == {k: six.SUCCESSOR_317[k] for k in ("api", "ingestor", "mcp")}
    assert SUCCESSOR_BLOCK.count("UPDATE public.runtime_ordinary_login_attestation_receipts") == 2
    for login, seal in ((API, "api"), (INGESTOR, "ingestor")):
        assert f"decode('{literals[seal]}','hex'), captured_at=clock_timestamp() WHERE login_name='{login}'" in (
            SUCCESSOR_BLOCK
        )
    assert f"decode('{literals['mcp']}','hex') WHERE singleton;" in SUCCESSOR_BLOCK
    assert "'317 receipts do not match the successor seals'" in SUCCESSOR_BLOCK


def test_no_replaced_reader_reads_a_retired_band_source():
    """CTL-24 and C-7 (#1734 CTL-26): one band source, fn_band_setpoints."""
    retired = r"fn_setpoint_at|setpoint_changes|fn_timeline_setpoint_value|fn_house_vpd_control_band"
    for fn in REPLACED:
        text = uncommented(function(fn))
        assert not re.search(retired, text), fn
        assert "fn_band_setpoints(" in text, fn
    assert not re.search(r"setpoint_snapshot\s+WHERE\s+parameter", function("fn_heat_staging_inversion"))
    for name in ("v_greenhouse_state", "v_heating_staging"):
        assert not re.search(retired, view(name)) and "fn_band_setpoints(" in view(name), name


def test_the_timeline_keeps_its_56_columns_and_draws_the_laws_lines():
    """Signature and whole return type unchanged; the law's numbers are the generated constants."""
    text = function("fn_band_timeline")
    returns = re.search(r"RETURNS TABLE\((.*?)\)\n", text).group(1)
    assert [c.split()[0] for c in returns.split(", ")] == TIMELINE_COLUMNS
    assert text.startswith(
        "p_start timestamp with time zone, p_end timestamp with time zone, p_step interval DEFAULT "
        "'00:30:00'::interval, p_greenhouse_id text DEFAULT 'vallery'::text)"
    )
    select = text[text.rindex("SELECT\n    r.ts,") :]
    outputs = re.findall(r"(?:AS (\w+)|^\s+r\.(\w+)),?$", select, re.M)
    assert [a or b for a, b in outputs] == TIMELINE_COLUMNS
    cte = text[text.index("law AS (") : text.index("),\nforecast_hourly")]
    numbers = dict((name, float(value)) for value, name in re.findall(r"([\d.]+)::double precision AS (\w+)", cte))
    assert numbers and all(getattr(law, name.upper()) == value for name, value in numbers.items())
    assert "CONSTANTS_SHA256 " + law.CONSTANTS_SHA256[:8] in SOURCE
    flat_text = flat(text)
    for line in (
        "r.firmware_temp_low + law.heat1_on_above_low_f AS temp_heat_on_below_f",
        "r.firmware_temp_low + law.heat1_off_above_low_f AS temp_heat_target_f",
        "r.firmware_temp_low + law.heat2_on_above_low_f AS temp_heat2_on_below_f",
        "r.firmware_temp_low + law.heat2_off_above_low_f AS temp_heat2_clear_f",
        "r.firmware_temp_high + law.cool_on_above_high_f AS temp_cool_on_above_f",
        "r.firmware_temp_high - law.cool_off_below_high_f AS temp_cool_hold_until_f",
        "r.firmware_temp_high + law.fan2_on_above_high_f AS temp_cool_stage2_on_above_f",
        "r.firmware_vpd_high + law.fog_on_above_vpd_high_kpa AS vpd_humidify_on_above_kpa",
        "r.firmware_vpd_high - law.fog_off_below_vpd_high_kpa AS vpd_humidify_resolved_below_kpa",
        "r.firmware_vpd_low + law.dry_on_above_vpd_low_kpa AS vpd_dehum_on_below_kpa",
        "r.firmware_vpd_low + law.dry_off_above_vpd_low_kpa AS vpd_dehum_resolved_above_kpa",
        "band.vpd_low AS projected_vpd_low",
        "band.vpd_high AS projected_vpd_high",
        "COALESCE(actual_vpd_low.value, band.vpd_low)",
    ):
        assert line in flat_text, line
    for retired in ("sw_fsm_controller_enabled", "temp_hysteresis_f", "bias_heat_f", "fog_escalation_kpa"):
        assert f"NULL::{'boolean' if retired.startswith('sw_') else 'double precision'} AS {retired}" in flat_text


def test_the_greenhouse_state_and_staging_columns_read_the_served_band():
    state = view("v_greenhouse_state")
    for column, source in (
        ("sp_temp_high", "b.temp_high"),
        ("sp_temp_low", "b.temp_low"),
        ("sp_vpd_high", "b.vpd_high"),
        ("sp_vpd_low", "b.vpd_low"),
    ):
        assert f"{source} AS {column}," in state
    for column in (
        "sp_bias_cool",
        "sp_bias_heat",
        "sp_vpd_hysteresis",
        "sp_sealed_max_s",
        "sp_relief_s",
        "sp_watch_dwell_s",
        "sp_d_cool_s2",
        "sp_mister_engage",
    ):
        assert f"NULL::double precision AS {column}," in state
    assert "round((band_temp_target)::numeric, 2) AS sp_temp_target" in state
    assert "CROSS JOIN LATERAL fn_band_setpoints(c.ts) b(" in state
    staging = view("v_heating_staging")
    assert "FROM fn_band_setpoints(h2.on_ts) b(" in staging and staging.endswith(
        "AS setpoint_temp_low FROM heat2_on h2 ORDER BY on_ts DESC"
    )
    inversion = flat(function("fn_heat_staging_inversion"))
    assert "SELECT b.temp_low, NULL::double precision AS d_heat_stage_2 FROM fn_band_setpoints(now()) b" in inversion


def test_the_schedule_changes_only_its_two_readback_counts():
    """C-6: the irrig_* readbacks left the controller; every schedule value and source stays as 315 wrote it."""
    previous = (ROOT / "db/migrations/315-replayed-gaps-counter-check-and-health.sql").read_text()
    old = previous[previous.index("CREATE OR REPLACE VIEW public.v_irrigation_schedule_current AS") :]
    old = flat(old[: old.index("$schedule$)")])
    new = "CREATE OR REPLACE VIEW public.v_irrigation_schedule_current AS " + view("v_irrigation_schedule_current")
    stale = re.search(
        r"count\(\*\) FILTER \(WHERE values_by_param\.readback_ts IS NULL[^,]*AS stale_readback_count", old
    )
    drift = re.search(
        r"count\(\*\) FILTER \(WHERE values_by_param\.readback_value IS NOT NULL.*?AS readback_drift_count", old
    )
    assert (
        old.replace(stale.group(0), "NULL::bigint AS stale_readback_count").replace(
            drift.group(0), "NULL::bigint AS readback_drift_count"
        )
        == new
    )


def test_the_counter_check_appends_boots_and_the_early_record_rule():
    """C-10 (SQL half): a day is judged only on a record computed after it ended; boots feed the start allowance."""
    previous = (ROOT / "db/migrations/315-replayed-gaps-counter-check-and-health.sql").read_text()
    old = previous[previous.index(f"CREATE VIEW public.{RECON} AS") :]
    old = flat(old[: old.index("COMMENT ON VIEW")]).rstrip(";")
    new = view(RECON)
    assert "WHEN rr.computed_at < ((f.date + 1)::timestamp AT TIME ZONE 'America/Denver') THEN 'record_early'" in new
    assert new.endswith(
        "ELSE 'complete' END AS comparison, COALESCE(b.boots, 0) AS boots, rr.computed_at AS record_computed_at "
        "FROM frame f LEFT JOIN counted c ON c.date = f.date AND c.greenhouse_id = f.greenhouse_id AND c.equipment = "
        "f.equipment LEFT JOIN public.daily_relay_record rr ON rr.date = f.date AND rr.greenhouse_id = f.greenhouse_id "
        "AND rr.equipment = f.equipment LEFT JOIN booted b ON b.date = f.date AND b.greenhouse_id = f.greenhouse_id"
    )
    assert "u.uptime_s < u.previous_uptime_s" in new and "FROM public.diagnostics d" in new
    # Everything up to the frame CTE and the eleven 315 columns are 315's text.
    head = old[old.index("WITH relays") : old.index("), frame AS")]
    assert new.startswith(head.replace("CREATE VIEW", "CREATE OR REPLACE VIEW"))
    assert old[old.index("), frame AS") : old.index("ELSE 'complete' END AS comparison")] in new


def test_the_run_columns_carry_one_definition():
    """TEL-23: run_s is the daily run time; event_run_s is the unrepaired diagnostic."""
    body = SOURCE.split("END $predecessor$;", 1)[1]
    run = re.search(r"COMMENT ON COLUMN public\.daily_relay_record\.run_s IS\s+'The relay''s daily run time", body)
    event = re.search(r"COMMENT ON COLUMN public\.daily_relay_record\.event_run_s IS\s+'Diagnostic only", body)
    assert run and event


def test_the_views_go_first_in_a_bounded_retry():
    block = flat(BODY[BODY.index("DO $views$") : BODY.index("END $views$;")])
    record = "('public.daily_record', $record$ ALTER TABLE public.daily_record ADD COLUMN dry_refusal jsonb,"
    daily = "('public.v_daily_record', $daily$ CREATE OR REPLACE VIEW public.v_daily_record AS"
    assert block.index("('public.v_setpoint_forward', $forward$") < block.index(record) < block.index(daily)
    assert "$daily$) ) AS v(target, ddl) LOOP" in block
    for name, tag in (
        ("v_greenhouse_state", "state"),
        ("v_heating_staging", "staging"),
        ("v_irrigation_schedule_current", "schedule"),
        (RECON, "recon"),
    ):
        assert f"('public.{name}', ${tag}$ CREATE OR REPLACE VIEW public.{name} AS" in block
    assert "('public.v_setpoint_forward', $forward$ DROP VIEW public.v_setpoint_forward RESTRICT $forward$)" in block
    assert "PERFORM pg_catalog.set_config('lock_timeout', '5s', true); EXECUTE rec.ddl;" in block
    assert block.count("PERFORM pg_catalog.set_config('lock_timeout', saved, true);") == 2
    assert "IF attempt >= 8 THEN" in block and "'317 could not lock % exclusively" in block
    assert "LOCK TABLE" not in BODY
    assert BODY.index("END $views$;") < BODY.index("CREATE OR REPLACE FUNCTION public.fn_band_timeline(")


def test_the_house_vpd_band_is_the_served_band_with_its_13_columns():
    """CTL-26: same signature and return type as 145, so every reader and an old pod agree at once."""
    old = (ROOT / "db/migrations" / GUARDED["fn_house_vpd_control_band"]).read_text()
    head = re.compile(
        r"fn_house_vpd_control_band\(target_ts timestamp with time zone\)\s+RETURNS TABLE\((.*?)\)\s+", re.S
    )
    for text in (old, "fn_house_vpd_control_band(" + function("fn_house_vpd_control_band")):
        columns = [c.split()[0] for c in " ".join(head.search(text).group(1).split()).split(", ")]
        assert columns == HOUSE_COLUMNS
    body = flat(uncommented(function("fn_house_vpd_control_band")))
    assert "LANGUAGE plpgsql STABLE ROWS 1" in body
    assert (
        "SELECT b.vpd_low, b.vpd_high INTO crop_vpd_low, crop_vpd_high FROM public.fn_band_setpoints(target_ts)" in body
    )
    assert "house_vpd_low := crop_vpd_low; house_vpd_high := crop_vpd_high;" in body
    assert "house_vpd_min_width_kpa := NULL; house_vpd_low_margin_kpa := NULL;" in body
    assert "fn_center_band_setpoints" not in body and "0.55" not in body and "0.20" not in body
    assert "COMMENT ON FUNCTION public.fn_house_vpd_control_band(timestamptz) IS" in BODY


def test_the_daily_record_stores_the_laws_refused_drying_by_reason():
    """TEL-65: 310's store plus the law CTEs; the column is set for a complete day only."""
    text = SOURCE.split("CREATE OR REPLACE FUNCTION public.fn_daily_record_store(p_day date)", 1)[1]
    text = text.split("$store$;", 1)[0]
    body = flat(text)
    assert "FROM public.system_state s WHERE s.entity = 'climate_law_state'" in body
    assert "((s.value::jsonb ->> 'l')::bigint & 64) <> 0 AS wanted" in body
    assert (
        "AND CASE WHEN pg_catalog.pg_input_is_valid(s.value, 'jsonb') THEN (s.value::jsonb ->> 'l') ~ '^[0-9]{1,18}$' ELSE false END"
        in body
    )
    assert "COALESCE(s.value::jsonb ->> 'dr', 'unknown') AS reason" in body
    assert "s.ts + interval '3 minutes'" in body and "s.value LIKE '{\"v\":1,%'" in body
    assert "FILTER (WHERE r.reason <> 'none' AND r.wanted_s > 0)" in body
    assert (
        "furnace_starts_after_drying, dry_refusal, drying_water_g, drying_heat_wh, drying_meter_lower_bound, "
        "computed_at)" in body
    )
    assert (
        "CASE WHEN now() >= v_end THEN (SELECT rf.doc FROM refusal rf) END, "
        "(SELECT COALESCE(md.water_g, 0) FROM meter_day md)," in body
    )
    assert "dry_refusal = EXCLUDED.dry_refusal," in body
    old = (ROOT / "db/migrations" / GUARDED["fn_daily_record_store"]).read_text()
    old_body = old.split("CREATE FUNCTION public.fn_daily_record_store(p_day date)", 1)[1].split("$store$;", 1)[0]
    for line in old_body.splitlines():
        if "computed_at" not in line and "now()" not in line:
            assert line in text, line
    assert "COMMENT ON COLUMN public.daily_record.dry_refusal IS" in BODY


def test_the_grafana_review_facade_exposes_status_and_times_only():
    """HOST-LAW's four lab panels read kind, status, review_date and written_at; no review text leaves."""
    create = re.search(
        r"CREATE VIEW verdify_grafana_runtime\.planner_review WITH\(security_barrier=true\) AS SELECT (.*?) FROM public\.planner_review;",
        BODY,
    )
    assert create and [c.strip().strip('"') for c in create.group(1).split(",")] == [
        "id",
        "kind",
        "review_date",
        "status",
        "requested_at",
        "written_at",
    ]
    for hidden in ("summary", "band_proposal", "tokens", "failure", "run_id", "hermes_run_id", "requested_by"):
        assert hidden not in create.group(1), hidden
    assert BODY.count("verdify_grafana_runtime.planner_review") == 4


def test_the_daily_record_carries_the_drying_meters_day():
    """RLY-70 (plan section 10 item 3): the meter's day, boot-aware, 0 on a quiet day, NULL before the first row,
    flagged when a boot lost counts (behaviour: tests/test_dashboard_db_drying_meter_day.py)."""
    text = SOURCE.split("CREATE OR REPLACE FUNCTION public.fn_daily_record_store(p_day date)", 1)[1]
    body = flat(uncommented(text.split("$store$;", 1)[0]))
    assert "WHERE m.entity = 'climate_drying_meter'" in body
    assert "sum(CASE WHEN z.rebooted THEN z.g ELSE z.g - z.previous_g END)::double precision AS water_g" in body
    assert "sum(CASE WHEN z.rebooted THEN z.wh ELSE z.wh - z.previous_wh END)::double precision AS heat_wh" in body
    assert (
        "OR EXISTS (SELECT 1 FROM boot b WHERE b.at - interval '75 seconds' > y.previous_ts AND b.at <= y.ts)) "
        "AS rebooted" in body
    )
    assert "ORDER BY b.ts DESC LIMIT 1), v_start)" in body and "v_start - interval '1 day'" not in body
    assert "THEN ((l.value::jsonb ->> 'l')::bigint & 256) <> 0 ELSE false END)) AS lower_bound" in body
    assert "FROM meter_step z HAVING EXISTS (SELECT 1 FROM meter_raw)" in body
    assert "drying_meter_lower_bound = EXCLUDED.drying_meter_lower_bound" in body
    assert "300 s until the fourth flash (vp#1738)" in SOURCE
    # v_daily_record: 310's text with the three columns appended after computed_at.
    old = (ROOT / "db/migrations/310-daily-record.sql").read_text()
    old_view = old.split("CREATE VIEW public.v_daily_record AS\n", 1)[1].split(";\n", 1)[0]
    new_view = SOURCE.split("CREATE OR REPLACE VIEW public.v_daily_record AS\n", 1)[1].split("\n$daily$", 1)[0]
    assert new_view == old_view.replace(
        "       d.computed_at\n",
        "       d.computed_at,\n       d.drying_water_g,\n       d.drying_heat_wh,\n       d.drying_meter_lower_bound\n",
    )
    for column in ("drying_water_g", "drying_heat_wh", "drying_meter_lower_bound"):
        assert f"COMMENT ON COLUMN public.daily_record.{column} IS" in BODY, column


def test_the_native_fixture_reads_as_each_runtime_and_reports_once():
    text = NATIVE.read_text()
    qualifier.native_checks(NATIVE)
    for login in (
        "verdify_ingestor_runtime_login",
        "verdify_mcp_runtime_login",
        "verdify_dashboard_runtime_login",
        "verdify_grafana_runtime_login",
    ):
        assert f"SET SESSION AUTHORIZATION {login};" in text, login
    assert text.count("RESET SESSION AUTHORIZATION;") == 4


def test_the_projection_is_the_files_literals():
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["migration"] == c0.SUCCESSOR_317
    assert evidence["projected_successor"] == qualifier.successor_literals(SOURCE)


def test_native_qualification_is_recorded():
    """Merge gate: the rolled-back production qualification of exact317 and its measured seals."""
    evidence = json.loads(FIXTURE.read_text())
    assert evidence["final_migration_qualification_pending"] is False, (
        "317 native qualification pending: measure the literals with scripts/qualify-migration-successor.py "
        "db/migrations/317-served-band-readers-and-relay-record.sql --probe-only, write them into the file and its "
        "registrations, then run it with --native-fixture db/qualification/317-served-band-readers-and-relay-record-"
        "fixture.sql --fixture tests/fixtures/317-served-band-readers-and-relay-record-native-qualification.json and "
        "commit the fixture"
    )
    assert evidence["migration"] == c0.SUCCESSOR_317
    assert evidence["exact_final_migration_sha256"] == c0.SUCCESSOR_317_SHA256
    assert evidence["qualified_successor"] == registered(317)
    first = [(r["migration"], r["sha256"]) for r in evidence.get("applied_first", [])]
    if first:
        # Production behind release 4: the probe applied 315 and 316 first.
        assert first == [(getattr(c0, f"SUCCESSOR_{n}"), getattr(c0, f"SUCCESSOR_{n}_SHA256")) for n in (315, 316)]
        assert evidence["before"] == registered(314) == evidence["after_rollback"]
        assert evidence["applied_first_seals"] == registered(PREDECESSOR)
    else:
        assert evidence["before"] == registered(PREDECESSOR) == evidence["after_rollback"]
    assert evidence["final_migration_rollback_verified"] is True
    assert evidence["inside_transaction_receipts_match"] is True
    assert evidence["native_fixture_sha256"] == hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    assert evidence["native_fixture"]["all_passed"] is True
