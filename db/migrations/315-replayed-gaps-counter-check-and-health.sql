-- 315 (#1633, host release 4; RULINGS AF7, AF9, AF10): replayed gaps stop counting as missing, the relay counter
-- check, and three controller health columns. No drop.
-- AF10: v_data_trust_ledger (its data_gap_hours_24h check) and v_irrigation_day_coverage read 314's
-- v_data_gaps_unreplayed instead of data_gaps, so minutes the controller's gap log replayed no longer count as a gap.
-- Every other check of the ledger and every column of both views is unchanged (the live definitions at 311, with only
-- the gap source replaced), so CREATE OR REPLACE keeps their ACLs and their dependants (v_irrigation_minutes_daily,
-- fn_irrigation_minutes_daily). Readers: the API's health and public data-check routes and
-- scripts/validate-irrigation-stack.py read the ledger; the dashboard's irrigation reads (verdify_services
-- irrigation/reads.py) and fn_irrigation_minutes_daily read the coverage. A replayed day reads 'complete' or 'partial'
-- where it read 'partial' or 'no_data'; the 24 h gap figure falls by the replayed hours.
-- AF7: v_relay_counter_reconciliation_daily, one row per local day, greenhouse and counted relay: the starts (and, for
-- the two fans, run seconds) of the controller's lifetime relay_counters (system_state, entity relay_counters, phase 2)
-- as summed deltas, a negative delta (a restart restoring an older save) counted as 0, against daily_relay_record, the
-- record taken from the stored edges. The events stay the source; the counters are a check only. Counted relays:
-- heat1, heat2, fan1, fan2, fog and vent (starts); fan1 and fan2 (run seconds). Valid from the phase 2 flash,
-- 2026-11-16 19:48Z: that day and today read 'partial'. A delta lands on the local day of the row that shows it (rows
-- are published at most 300 s apart, so a start just before midnight may land on the next day). The operator API's
-- product metrics (verdify_dashboard_runtime, as 312) and the ingestor's alert monitor (verdify_ingestor_runtime,
-- lane MONITORING's AF7 warning) read it.
-- Release review (reports h3-release-review): DISPATCHER-01, the spool admission function accepts the new diagnostics
-- keys; READERS-5, v_irrigation_schedule_current judges readbacks stale after 2 hours; RS-6, every setpoint_plan row
-- goes inactive; PLANNER-03, open planner trigger ledger rows close as missed. READERS-4 is accepted, not rewritten:
-- widening fn_public_band_trace_v2's 15-minute cfg readback lookup to the 2-hour keyframe multiplies its per-sample
-- scan over the dense pre-release-3 history on a public route, and widening v_band_device_divergence's raw_legacy
-- window trips the alert's 900 s device-age threshold; the legacy branch is inert while band_source is not
-- dispatcher_legacy. Under on-change storage the trace's lineage cfg_snapshot_value reads unavailable for most
-- samples (compliance figures unchanged).
-- AF9(b): three nullable diagnostics columns for the third flash's read-only health sensors (contracts
-- metrics-coverage, FW-INFRA): loop_stack_high_water_b, wifi_disconnect_count, api_client_count, appended to the
-- ingestor's write facade v_runtime_diagnostics_write with INSERT for the ingestor duty. NULL = not published.
-- Seals: the ingestor duty's facade and counter-check grants move the ingestor seal; the api and MCP seals are measured again. The
-- successor literals were measured by the rolled-back native qualification
-- (tests/fixtures/315-replayed-gaps-counter-check-and-health-native-qualification.json). 315 chains from exact314.
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=314 AND filename='db/migrations/314-controller-health-and-gap-ledger.sql'
            AND sha256='568e0f739d735693c019c7e0bd673820ca5a1eff318e57cc23e6d409c5be680f'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>314)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'e46edc0830022a67995caf59825649963e27557256b4e0e23e6fb423eee2f373'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '86372bad7c5108b4e461579c10d46f4977a82ea26ea218dd07361680adfd365c'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '5b31cf1e74b78963e266cfd22dc3867a7972dbb53eff209f3c121781fb90f8dc'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.diagnostics'::regclass
            AND attname IN ('loop_stack_high_water_b', 'wifi_disconnect_count', 'api_client_count')
            AND NOT attisdropped)
        OR (SELECT reloptions FROM pg_catalog.pg_class WHERE oid='public.v_runtime_diagnostics_write'::regclass)
            IS DISTINCT FROM ARRAY['security_barrier=true','security_invoker=false']
        OR to_regclass('public.v_data_gaps_unreplayed') IS NULL OR to_regclass('public.gap_replay_quarters') IS NULL
        -- md5 of 314's function body: the text between its $body$ quotes (prosrc), computed from the 314 file.
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc
            WHERE oid=to_regprocedure('public.fn_record_observational_source_event(uuid,text,timestamptz,text,uuid,bigint,jsonb)')
              AND md5(prosrc)='84f77650b569c2f246fa96ca3f049897')
        OR to_regclass('public.daily_relay_record') IS NULL
        OR to_regclass('public.v_relay_counter_reconciliation_daily') IS NOT NULL
        -- Both views still read data_gaps and not yet the replay-aware view.
        OR (SELECT count(DISTINCT r.ev_class) FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_depend d ON d.objid=r.oid
             WHERE r.ev_class IN ('public.v_data_trust_ledger'::regclass, 'public.v_irrigation_day_coverage'::regclass)
               AND d.refobjid='public.data_gaps'::regclass)<>2
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_depend d ON d.objid=r.oid
             WHERE r.ev_class IN ('public.v_data_trust_ledger'::regclass, 'public.v_irrigation_day_coverage'::regclass)
               AND d.refobjid='public.v_data_gaps_unreplayed'::regclass)
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='verdify_dashboard_runtime' AND NOT rolcanlogin)
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='verdify_ingestor_runtime' AND NOT rolcanlogin)
    THEN RAISE EXCEPTION '315 refuses an unqualified predecessor'; END IF;
END $predecessor$;

-- AF9(b). One column per statement: diagnostics is a compressed hypertable.
ALTER TABLE public.diagnostics ADD COLUMN loop_stack_high_water_b integer;
ALTER TABLE public.diagnostics ADD COLUMN wifi_disconnect_count integer;
ALTER TABLE public.diagnostics ADD COLUMN api_client_count integer;

COMMENT ON COLUMN public.diagnostics.loop_stack_high_water_b IS
    'Lowest free stack of the loop task since boot, in bytes (loop_stack_high_water; 315, #1633). NULL = not '
    'published.';
COMMENT ON COLUMN public.diagnostics.wifi_disconnect_count IS
    'WiFi disconnects since boot; resets with a restart (wifi_disconnect_count; 315). NULL = not published.';
COMMENT ON COLUMN public.diagnostics.api_client_count IS
    'API client connections at publish time (api_client_count; 315). NULL = not published.';

-- 314's facade with the three columns appended: the same columns in the same order, then the three.
CREATE OR REPLACE VIEW public.v_runtime_diagnostics_write
    WITH (security_barrier=true, security_invoker=false) AS
SELECT ts, wifi_rssi, heap_bytes, heap_min_free_kb, heap_largest_free_block_kb, uptime_s, probe_health,
       reset_reason, firmware_version, active_probe_count, relief_cycle_count, vent_latch_timer_s, sealed_timer_s,
       vpd_watch_timer_s, mist_backoff_timer_s, vent_mist_assist_active, effective_heat_target_f,
       effective_cool_stage2_delta_f, effective_vpd_hysteresis_kpa, effective_dehum_aggressive_kpa,
       controller_time_epoch, controller_local_hour, sntp_valid, sntp_miss_count, last_sntp_sync_age_s,
       band_source, zone_wet_granted, greenhouse_id, heap_min_free_minute_kb, heap_largest_block_minute_low_kb,
       loop_worst_ms, restart_count, nvs_used_entries, nvs_free_entries, nvs_write_worst_ms, gap_log_state,
       sensor_degraded_active, loop_stack_high_water_b, wifi_disconnect_count, api_client_count
  FROM public.diagnostics;

GRANT INSERT (loop_stack_high_water_b, wifi_disconnect_count, api_client_count)
    ON public.v_runtime_diagnostics_write TO verdify_ingestor_runtime;

-- The spool's admission function (267; RELEASE REVIEW DISPATCHER-01): the ingestor spools every diagnostics row
-- as its full model, and the function refuses any key outside its pinned diagnostics list, which would jam the FIFO
-- spool. 314's text byte for byte with the three AF9(b) keys appended in this order; CREATE OR REPLACE keeps the owner,
-- SECURITY DEFINER, search_path and time zone, and the REVOKE/GRANT pair restates the ACL as 314 does.
CREATE OR REPLACE FUNCTION public.fn_record_observational_source_event(
 p_event_id uuid,p_kind text,p_source_ts timestamptz,p_greenhouse_id text,
 p_runtime_instance_id uuid,p_connection_generation bigint,p_payload jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
SET timezone='UTC'
AS $body$
DECLARE target_table text; target_view text; allowed text[]; required text[];
 h bytea; inserted uuid; k text; v jsonb; t oid; category "char"; n numeric;
 typed_payload jsonb; column_names text; expressions text;
BEGIN
 IF p_event_id IS NULL OR p_source_ts IS NULL OR p_greenhouse_id IS DISTINCT FROM 'vallery'
 OR p_runtime_instance_id IS NULL OR p_connection_generation IS NULL
 OR p_connection_generation NOT BETWEEN 0 AND 9007199254740991
 OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload='{}'::jsonb
 OR octet_length(p_payload::text)>1048576 THEN
 RAISE EXCEPTION 'invalid observational source event'; END IF;
 CASE p_kind
 WHEN 'system_state' THEN target_table:='system_state'; target_view:='v_runtime_system_state_write'; allowed:=ARRAY['entity','value']; required:=allowed;
 WHEN 'override' THEN target_table:='override_events'; target_view:='v_runtime_override_events_write'; allowed:=ARRAY['override_type','mode']; required:=ARRAY['override_type'];
 WHEN 'setpoint_observed' THEN target_table:='setpoint_changes'; target_view:='v_runtime_setpoint_changes_write'; allowed:=ARRAY['parameter','value']; required:=allowed;
 WHEN 'esp32_log' THEN target_table:='esp32_logs'; target_view:='v_runtime_esp32_logs_write'; allowed:=ARRAY['level','tag','message']; required:=ARRAY['level','message'];
 WHEN 'diagnostics' THEN target_table:='diagnostics'; target_view:='v_runtime_diagnostics_write'; allowed:=ARRAY['wifi_rssi','heap_bytes','heap_min_free_kb','heap_largest_free_block_kb','uptime_s','probe_health','reset_reason','firmware_version','active_probe_count','relief_cycle_count','vent_latch_timer_s','sealed_timer_s','vpd_watch_timer_s','mist_backoff_timer_s','vent_mist_assist_active','effective_heat_target_f','effective_cool_stage2_delta_f','effective_vpd_hysteresis_kpa','effective_dehum_aggressive_kpa','controller_time_epoch','controller_local_hour','sntp_valid','sntp_miss_count','last_sntp_sync_age_s','band_source','zone_wet_granted',
 'heap_min_free_minute_kb','heap_largest_block_minute_low_kb','loop_worst_ms','restart_count','nvs_used_entries','nvs_free_entries','nvs_write_worst_ms','gap_log_state','sensor_degraded_active','loop_stack_high_water_b','wifi_disconnect_count','api_client_count']; required:=ARRAY[]::text[];
 ELSE RAISE EXCEPTION 'unknown observational source kind'; END CASE;
 FOREACH k IN ARRAY required LOOP
 IF NOT p_payload ? k OR p_payload->k='null'::jsonb THEN
 RAISE EXCEPTION 'observational required field missing: %',k; END IF;
 END LOOP;
 typed_payload:=p_payload;
 FOR k,v IN SELECT key,value FROM jsonb_each(p_payload) LOOP
 IF NOT k=ANY(allowed) OR NOT EXISTS(
 SELECT 1 FROM pg_attribute a WHERE a.attrelid=format('public.%I',target_view)::regclass
 AND a.attname=k AND a.attnum>0 AND NOT a.attisdropped
 AND has_column_privilege('verdify_ingestor_runtime',a.attrelid,a.attnum,'INSERT')) THEN
 RAISE EXCEPTION 'observational field outside pinned INSERT projection: %',k; END IF;
 SELECT a.atttypid,ty.typcategory INTO STRICT t,category FROM pg_attribute a JOIN pg_type ty ON ty.oid=a.atttypid
 WHERE a.attrelid=format('public.%I',target_table)::regclass AND a.attname=k AND a.attnum>0 AND NOT a.attisdropped;
 IF v='null'::jsonb THEN CONTINUE; END IF;
 IF (category='N' AND jsonb_typeof(v)<>'number') OR (category='S' AND jsonb_typeof(v)<>'string')
 OR (category='B' AND jsonb_typeof(v)<>'boolean') THEN
 RAISE EXCEPTION 'observational JSON type mismatch: %',k; END IF;
 IF t IN ('smallint'::regtype,'integer'::regtype,'bigint'::regtype) THEN
 n:=(v #>> '{}')::numeric;
 IF n<>trunc(n) THEN RAISE EXCEPTION 'fractional observational integer: %',k; END IF;
 IF t='smallint'::regtype THEN v:=to_jsonb(n::smallint);
 ELSIF t='integer'::regtype THEN v:=to_jsonb(n::integer);
 ELSE v:=to_jsonb(n::bigint); END IF;
 typed_payload:=jsonb_set(typed_payload,ARRAY[k],v);
 END IF;
 END LOOP;
 IF p_kind='esp32_log' AND (p_payload->>'message'='' OR p_payload->>'level' NOT IN ('NONE','ERROR','WARN','INFO','DEBUG','VERBOSE','VERY_VERBOSE','UNKNOWN')) THEN
 RAISE EXCEPTION 'invalid observational log'; END IF;
 h:=sha256(convert_to(jsonb_build_object('event_id',p_event_id,'kind',p_kind,'source_ts',p_source_ts,
 'greenhouse_id',p_greenhouse_id,'runtime',p_runtime_instance_id,'generation',p_connection_generation,
 'payload',p_payload)::text,'UTF8'));
 INSERT INTO public.observational_source_events(event_id,kind,source_ts,greenhouse_id,source_runtime_instance_id,source_connection_generation,event_payload,event_sha256)
 VALUES(p_event_id,p_kind,p_source_ts,p_greenhouse_id,p_runtime_instance_id,p_connection_generation,p_payload,h)
 ON CONFLICT(event_id) DO NOTHING RETURNING event_id INTO inserted;
 IF inserted IS NULL THEN
 IF NOT EXISTS(SELECT 1 FROM public.observational_source_events WHERE event_id=p_event_id AND event_sha256=h) THEN
 RAISE EXCEPTION 'observational UUID already binds different immutable evidence'; END IF;
 RETURN false; END IF;
 IF p_kind='setpoint_observed' THEN
 -- Historical observed evidence; never now(), UPDATE, control replay or fresh confirmation.
 typed_payload:=typed_payload||jsonb_build_object('source','esp32','confirmed_at',p_source_ts,'delivery_status','observed');
 END IF;
 SELECT string_agg(format('%I',key),',' ORDER BY key),
 string_agg(format('(jsonb_populate_record(NULL::public.%I,$3)).%I',target_table,key),',' ORDER BY key)
 INTO column_names,expressions FROM jsonb_object_keys(typed_payload) AS key;
 IF p_kind IN ('override','esp32_log') THEN
 EXECUTE format('INSERT INTO public.%I(ts,%s) SELECT $1,%s',target_view,column_names,expressions)
 USING p_source_ts,p_greenhouse_id,typed_payload;
 ELSE
 EXECUTE format('INSERT INTO public.%I(ts,greenhouse_id,%s) SELECT $1,$2,%s',target_view,column_names,expressions)
 USING p_source_ts,p_greenhouse_id,typed_payload;
 END IF;
 RETURN true;
END $body$;
REVOKE ALL ON FUNCTION public.fn_record_observational_source_event(uuid,text,timestamptz,text,uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_record_observational_source_event(uuid,text,timestamptz,text,uuid,bigint,jsonb) TO verdify_ingestor_runtime;

-- AF10: the live ledger (last defined by 134) with its data_gap_hours_24h check reading the replay-aware gaps.
CREATE OR REPLACE VIEW public.v_data_trust_ledger AS
 SELECT 'climate_freshness'::text AS check_name,
        CASE
            WHEN v_data_pipeline_health.age_s <= 300 THEN 'ok'::text
            ELSE 'fail'::text
        END AS status,
    v_data_pipeline_health.age_s::numeric AS metric_value,
    300::numeric AS threshold_value,
    v_data_pipeline_health.source || ' age seconds'::text AS details
   FROM v_data_pipeline_health
  WHERE v_data_pipeline_health.source = 'climate'::text
UNION ALL
 SELECT 'forecast_freshness'::text AS check_name,
        CASE
            WHEN v_data_pipeline_health.age_s <= 21600 THEN 'ok'::text
            ELSE 'fail'::text
        END AS status,
    v_data_pipeline_health.age_s::numeric AS metric_value,
    21600::numeric AS threshold_value,
    'weather_forecast fetched_at age seconds'::text AS details
   FROM v_data_pipeline_health
  WHERE v_data_pipeline_health.source = 'forecast'::text
UNION ALL
 SELECT 'required_sensor_coverage'::text AS check_name,
        CASE
            WHEN count(*) FILTER (WHERE v_required_sensor_coverage.coverage_status <> 'ok'::text) = 0 THEN 'ok'::text
            ELSE 'warn'::text
        END AS status,
    count(*) FILTER (WHERE v_required_sensor_coverage.coverage_status <> 'ok'::text)::numeric AS metric_value,
    0::numeric AS threshold_value,
    'required configured sensors not ok'::text AS details
   FROM v_required_sensor_coverage
UNION ALL
 SELECT 'alert_lifecycle_mismatch'::text AS check_name,
        CASE
            WHEN count(*) = 0 THEN 'ok'::text
            ELSE 'warn'::text
        END AS status,
    count(*)::numeric AS metric_value,
    0::numeric AS threshold_value,
    'alerts with resolved_at set but disposition not resolved'::text AS details
   FROM alert_log
  WHERE alert_log.resolved_at IS NOT NULL AND alert_log.disposition <> 'resolved'::text
UNION ALL
 SELECT 'open_critical_or_high_alerts'::text AS check_name,
        CASE
            WHEN count(*) = 0 THEN 'ok'::text
            ELSE 'fail'::text
        END AS status,
    count(*)::numeric AS metric_value,
    0::numeric AS threshold_value,
    'open critical/high alerts'::text AS details
   FROM alert_log
  WHERE alert_log.disposition = 'open'::text AND (alert_log.severity = ANY (ARRAY['critical'::text, 'high'::text]))
UNION ALL
 SELECT 'planner_trigger_sla_36h'::text AS check_name,
        CASE
            WHEN v_planner_trigger_health.required_failure_count > 0 THEN 'fail'::text
            WHEN v_planner_trigger_health.missed_expected_count > 0 OR v_planner_trigger_health.overdue_delivered_count > 0 THEN 'warn'::text
            ELSE 'ok'::text
        END AS status,
    (v_planner_trigger_health.required_failure_count + v_planner_trigger_health.missed_expected_count + v_planner_trigger_health.overdue_delivered_count)::numeric AS metric_value,
    0::numeric AS threshold_value,
    'unrecovered required planner trigger failures or currently overdue expected/delivered triggers in last 36h'::text AS details
   FROM v_planner_trigger_health
UNION ALL
 SELECT 'data_gap_hours_24h'::text AS check_name,
        CASE
            WHEN COALESCE(sum(u.duration_s), 0::double precision) = 0::double precision THEN 'ok'::text
            ELSE 'warn'::text
        END AS status,
    round((COALESCE(sum(u.duration_s), 0::double precision) / 3600.0::double precision)::numeric, 2) AS metric_value,
    0::numeric AS threshold_value,
    'telemetry gap hours ending in the last 24h, without minutes the gap log replayed'::text AS details
   FROM v_data_gaps_unreplayed u
  WHERE u.end_ts > (now() - '24:00:00'::interval)
UNION ALL
 SELECT 'water_accounting_14d'::text AS check_name,
        CASE
            WHEN count(*) FILTER (WHERE v_water_accountability.quality_flag = ANY (ARRAY['missing_total'::text, 'negative_total'::text, 'mister_exceeds_total'::text, 'negative_unaccounted'::text])) = 0 THEN 'ok'::text
            ELSE 'warn'::text
        END AS status,
    count(*) FILTER (WHERE v_water_accountability.quality_flag = ANY (ARRAY['missing_total'::text, 'negative_total'::text, 'mister_exceeds_total'::text, 'negative_unaccounted'::text]))::numeric AS metric_value,
    0::numeric AS threshold_value,
    'hard water-accounting failures in last 14 local days; unattributed water remains an instrumentation limitation'::text AS details
   FROM v_water_accountability
  WHERE v_water_accountability.date >= ((now() AT TIME ZONE 'America/Denver'::text)::date - 14)
UNION ALL
 SELECT 'irrigation_logging_14d'::text AS check_name,
        CASE
            WHEN expected.starts_14d = 0 OR logged.logs_14d >= expected.starts_14d THEN 'ok'::text
            ELSE 'warn'::text
        END AS status,
    GREATEST(expected.starts_14d - logged.logs_14d, 0::bigint)::numeric AS metric_value,
    0::numeric AS threshold_value,
    'fertigation starts in equipment_state without canonical run rows in last 14 days'::text AS details
   FROM ( WITH ordered AS (
                 SELECT equipment_state.ts,
                    equipment_state.equipment,
                    equipment_state.state,
                    lag(equipment_state.state) OVER (PARTITION BY equipment_state.equipment ORDER BY equipment_state.ts) AS prev_state
                   FROM equipment_state
                  WHERE (equipment_state.equipment = ANY (ARRAY['drip_wall_fert'::text, 'mister_south_fert'::text, 'mister_west_fert'::text, 'drip_center_fert'::text])) AND equipment_state.ts >= (now() - '14 days'::interval)
                )
         SELECT count(*) AS starts_14d
           FROM ordered
          WHERE ordered.state = true AND COALESCE(ordered.prev_state, false) = false) expected
     CROSS JOIN ( SELECT count(DISTINCT v_irrigation_fertigation_runs.run_id) AS logs_14d
           FROM v_irrigation_fertigation_runs
          WHERE v_irrigation_fertigation_runs.run_start >= (now() - '14 days'::interval)) logged
UNION ALL
 SELECT 'energy_reconciliation_14d'::text AS check_name,
        CASE
            WHEN count(*) FILTER (WHERE v_energy_estimate_reconciliation.quality_flag <> 'ok'::text) = 0 THEN 'ok'::text
            ELSE 'warn'::text
        END AS status,
    count(*) FILTER (WHERE v_energy_estimate_reconciliation.quality_flag <> 'ok'::text)::numeric AS metric_value,
    0::numeric AS threshold_value,
    'daily_summary measured kWh sync mismatches in last 14 local days'::text AS details
   FROM v_energy_estimate_reconciliation
  WHERE v_energy_estimate_reconciliation.date >= ((now() AT TIME ZONE 'America/Denver'::text)::date - 14)
UNION ALL
 SELECT 'forecast_action_outcomes_7d'::text AS check_name,
        CASE
            WHEN count(*) FILTER (WHERE forecast_action_log.outcome IS NULL OR forecast_action_log.outcome = 'pending'::text) = 0 THEN 'ok'::text
            ELSE 'warn'::text
        END AS status,
    count(*) FILTER (WHERE forecast_action_log.outcome IS NULL OR forecast_action_log.outcome = 'pending'::text)::numeric AS metric_value,
    0::numeric AS threshold_value,
    'forecast action rows past follow-up window without evaluated outcome in last 7 days'::text AS details
   FROM forecast_action_log
  WHERE forecast_action_log.triggered_at > (now() - '7 days'::interval) AND forecast_action_log.triggered_at <= (now() - '06:00:00'::interval) AND forecast_action_log.action_taken <> 'evaluated_ok'::text
UNION ALL
 SELECT 'crop_lifecycle_completeness'::text AS check_name,
        CASE
            WHEN sum(v_crop_lifecycle_completeness.missing_count) FILTER (WHERE v_crop_lifecycle_completeness.is_active) = 0 THEN 'ok'::text
            ELSE 'warn'::text
        END AS status,
    COALESCE(sum(v_crop_lifecycle_completeness.missing_count) FILTER (WHERE v_crop_lifecycle_completeness.is_active), 0::bigint)::numeric AS metric_value,
    0::numeric AS threshold_value,
    'missing active crop lifecycle fields'::text AS details
   FROM v_crop_lifecycle_completeness
UNION ALL
 SELECT 'daily_plan_archive_self_check'::text AS check_name,
        CASE
            WHEN count(*) FILTER (WHERE v_daily_plan_archive_self_check.stale) = 0 THEN 'ok'::text
            ELSE 'warn'::text
        END AS status,
    count(*) FILTER (WHERE v_daily_plan_archive_self_check.stale)::numeric AS metric_value,
    0::numeric AS threshold_value,
    'completed generated daily plan pages stale or unaudited'::text AS details
   FROM v_daily_plan_archive_self_check
  WHERE v_daily_plan_archive_self_check.date >= ((now() AT TIME ZONE 'America/Denver'::text)::date - 14) AND v_daily_plan_archive_self_check.date < (now() AT TIME ZONE 'America/Denver'::text)::date;
COMMENT ON VIEW public.v_data_trust_ledger IS
    'Owner-facing public health checks spanning freshness, coverage, gaps, recovered planner trigger SLA, water hard '
    'failures, canonical fertigation logging, measured energy sync, forecasts, crop completeness, and generated '
    'archives. Future instrumentation requirements are reported separately from live-system health. Gaps exclude '
    'the minutes the gap log replayed (v_data_gaps_unreplayed; 315).';

-- AF10: the live coverage (last defined by 281) with both gap tests reading the replay-aware gaps.
CREATE OR REPLACE VIEW public.v_irrigation_day_coverage AS
 WITH wet_relays(relay_slug) AS (
         VALUES ('drip_wall'::text), ('drip_wall_fert'::text), ('fert_master_valve'::text), ('mister_center'::text), ('drip_center'::text), ('drip_center_fert'::text), ('mister_south'::text), ('mister_south_fert'::text), ('mister_west'::text), ('mister_west_fert'::text), ('fog'::text)
        ), greenhouse_ids(greenhouse_id) AS (
         SELECT g.id
           FROM greenhouses g
        UNION
         SELECT 'vallery'::text AS text
        ), first_rows AS (
         SELECT g.greenhouse_id,
            min(f.ts) AS first_ts
           FROM greenhouse_ids g
             CROSS JOIN wet_relays r
             CROSS JOIN LATERAL ( SELECT es.ts
                   FROM equipment_state es
                  WHERE es.equipment = r.relay_slug AND COALESCE(es.greenhouse_id, 'vallery'::text) = g.greenhouse_id
                  ORDER BY es.ts
                 LIMIT 1) f
          GROUP BY g.greenhouse_id
        ), bounds AS MATERIALIZED (
         SELECT f.greenhouse_id,
            (f.first_ts AT TIME ZONE 'America/Denver'::text)::date AS first_day,
            (now() AT TIME ZONE 'America/Denver'::text)::date AS today,
            ((( SELECT max(c.ts) AS max
                   FROM climate c
                  WHERE COALESCE(c.greenhouse_id, 'vallery'::text) = f.greenhouse_id)) AT TIME ZONE 'America/Denver'::text)::date AS newest_climate_day
           FROM first_rows f
        ), gaps AS MATERIALIZED (
         SELECT u.start_ts,
            u.end_ts
           FROM v_data_gaps_unreplayed u
        ), days AS (
         SELECT b.greenhouse_id,
            s.s::date AS local_day,
            b.today,
            b.newest_climate_day,
            (s.s::date::timestamp without time zone AT TIME ZONE 'America/Denver'::text) AS day_start,
            ((s.s::date + 1)::timestamp without time zone AT TIME ZONE 'America/Denver'::text) AS day_end
           FROM bounds b
             CROSS JOIN LATERAL generate_series(b.first_day::timestamp without time zone, b.today::timestamp without time zone, '1 day'::interval) s(s)
        )
 SELECT greenhouse_id,
    local_day,
        CASE
            WHEN newest_climate_day IS NULL OR local_day > newest_climate_day OR (EXISTS ( SELECT 1
               FROM gaps g
              WHERE g.start_ts <= d.day_start AND g.end_ts >= d.day_end)) THEN 'no_data'::text
            WHEN local_day = today OR local_day = newest_climate_day OR (EXISTS ( SELECT 1
               FROM gaps g
              WHERE g.start_ts < d.day_end AND g.end_ts > d.day_start)) THEN 'partial'::text
            ELSE 'complete'::text
        END AS coverage
   FROM days d;
COMMENT ON VIEW public.v_irrigation_day_coverage IS
    'Each America/Denver day from the first wet-relay row to today: no_data (after the newest climate row''s day, '
    'every day when there is no climate row, or wholly inside one unreplayed gap piece), partial (today, the newest '
    'climate row''s day, or an unreplayed gap overlap) or complete. Gaps exclude the minutes the gap log replayed '
    '(v_data_gaps_unreplayed; 315). A complete day with no runs has no minutes rows; nothing is zero-filled.';

-- RELEASE REVIEW READERS-5: readbacks are stored on change with an hourly keyframe (#1662), so a readback is stale
-- when its newest row is older than 2 hours (the rule of validate-irrigation-stack's cfg readback check), not 15
-- minutes. The live definition otherwise; every column and the ACL stay.
CREATE OR REPLACE VIEW public.v_irrigation_schedule_current AS
 WITH param_defaults(parameter, default_value) AS (
         VALUES ('irrig_wall_start_hour'::text,10.0), ('irrig_wall_start_min'::text,30.0), ('irrig_wall_duration_min'::text,10.0), ('irrig_wall_fert_duration_min'::text,6.0), ('irrig_wall_fert_every_n'::text,0.0), ('irrig_wall_days_mask'::text,127.0), ('irrig_wall_fert_days_mask'::text,127.0), ('irrig_wall_flush_min'::text,2.0), ('irrig_wall_interval_days'::text,1.0), ('irrig_center_start_hour'::text,10.0), ('irrig_center_start_min'::text,30.0), ('irrig_center_duration_min'::text,10.0), ('irrig_center_fert_duration_min'::text,6.0), ('irrig_center_fert_every_n'::text,0.0), ('irrig_center_days_mask'::text,127.0), ('irrig_center_fert_days_mask'::text,127.0), ('irrig_center_flush_min'::text,2.0), ('irrig_center_interval_days'::text,1.0)
        ), latest_snapshot AS (
         SELECT DISTINCT ON (setpoint_snapshot.parameter) setpoint_snapshot.parameter,
            setpoint_snapshot.value,
            setpoint_snapshot.ts
           FROM setpoint_snapshot
          WHERE (setpoint_snapshot.parameter IN ( SELECT param_defaults.parameter
                   FROM param_defaults))
          ORDER BY setpoint_snapshot.parameter, setpoint_snapshot.ts DESC
        ), latest_esp32 AS (
         SELECT DISTINCT ON (setpoint_changes.parameter) setpoint_changes.parameter,
            setpoint_changes.value,
            setpoint_changes.ts
           FROM setpoint_changes
          WHERE setpoint_changes.source = 'esp32'::text AND (setpoint_changes.parameter IN ( SELECT param_defaults.parameter
                   FROM param_defaults))
          ORDER BY setpoint_changes.parameter, setpoint_changes.ts DESC
        ), values_by_param AS (
         SELECT d.parameter,
            COALESCE(ap.value, e.value, s.value, d.default_value::double precision) AS value,
                CASE
                    WHEN ap.value IS NOT NULL THEN 'active_plan'::text
                    WHEN e.value IS NOT NULL THEN 'esp32_observed'::text
                    WHEN s.value IS NOT NULL THEN 'cfg_readback'::text
                    ELSE 'default'::text
                END AS source,
            ap.plan_id,
            ap.ts AS plan_ts,
            e.ts AS esp32_ts,
            s.ts AS readback_ts,
            s.value AS readback_value,
            d.default_value
           FROM param_defaults d
             LEFT JOIN v_active_plan ap ON ap.parameter = d.parameter
             LEFT JOIN latest_esp32 e ON e.parameter = d.parameter
             LEFT JOIN latest_snapshot s ON s.parameter = d.parameter
        ), pivoted AS (
         SELECT max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_start_hour'::text) AS wall_start_hour,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_start_min'::text) AS wall_start_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_duration_min'::text) AS wall_duration_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_fert_duration_min'::text) AS wall_fert_duration_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_fert_every_n'::text) AS wall_fert_every_n,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_days_mask'::text) AS wall_days_mask,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_fert_days_mask'::text) AS wall_fert_days_mask,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_flush_min'::text) AS wall_flush_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_interval_days'::text) AS wall_interval_days,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_start_hour'::text) AS center_start_hour,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_start_min'::text) AS center_start_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_duration_min'::text) AS center_duration_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_fert_duration_min'::text) AS center_fert_duration_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_fert_every_n'::text) AS center_fert_every_n,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_days_mask'::text) AS center_days_mask,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_fert_days_mask'::text) AS center_fert_days_mask,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_flush_min'::text) AS center_flush_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_interval_days'::text) AS center_interval_days
           FROM values_by_param
        ), source_rollup AS (
         SELECT
                CASE
                    WHEN count(*) FILTER (WHERE values_by_param.source = 'active_plan'::text) > 0 THEN 'active_plan'::text
                    WHEN count(*) FILTER (WHERE values_by_param.source = 'esp32_observed'::text) > 0 THEN 'esp32_observed'::text
                    WHEN count(*) FILTER (WHERE values_by_param.source = 'cfg_readback'::text) > 0 THEN 'cfg_readback'::text
                    ELSE 'default'::text
                END AS schedule_source,
            max(values_by_param.plan_id) FILTER (WHERE values_by_param.plan_id IS NOT NULL) AS plan_id,
            max(values_by_param.plan_ts) AS plan_ts,
            count(*) FILTER (WHERE values_by_param.readback_ts IS NULL OR values_by_param.readback_ts < (now() - '02:00:00'::interval)) AS stale_readback_count,
            count(*) FILTER (WHERE values_by_param.readback_value IS NOT NULL AND (abs(values_by_param.readback_value - values_by_param.value) / GREATEST(abs(values_by_param.value), 0.001::double precision)) >= 0.01::double precision) AS readback_drift_count
           FROM values_by_param
        ), latest_equipment AS (
         SELECT DISTINCT ON (equipment_state.equipment) equipment_state.equipment,
            equipment_state.state,
            equipment_state.ts
           FROM equipment_state
          WHERE equipment_state.equipment = ANY (ARRAY['irrigation_enabled'::text, 'irrigation_wall_enabled'::text, 'irrigation_center_enabled'::text])
          ORDER BY equipment_state.equipment, equipment_state.ts DESC
        )
 SELECT 'wall_shared'::text AS schedule_id,
    'wall_shared'::text AS zone_path,
    'Wall shared drip + south/west misters'::text AS display_name,
    ARRAY['south'::text, 'west'::text] AS serves_zones,
    COALESCE(( SELECT latest_equipment.state
           FROM latest_equipment
          WHERE latest_equipment.equipment = 'irrigation_enabled'::text), true) AND COALESCE(( SELECT latest_equipment.state
           FROM latest_equipment
          WHERE latest_equipment.equipment = 'irrigation_wall_enabled'::text), true) AS enabled,
    make_time(GREATEST(0, LEAST(23, round(p.wall_start_hour)::integer)), GREATEST(0, LEAST(59, round(p.wall_start_min)::integer)), 0::double precision) AS start_time,
    round(p.wall_duration_min)::integer AS clean_duration_min,
    round(p.wall_fert_duration_min)::integer AS fert_duration_min,
    round(p.wall_flush_min)::integer AS flush_min,
    round(p.wall_interval_days)::integer AS interval_days,
    round(p.wall_days_mask)::integer AS days_mask,
    round(p.wall_fert_days_mask)::integer AS fert_days_mask,
    round(p.wall_fert_every_n)::integer AS fert_every_n,
    round(p.wall_fert_duration_min)::integer > 0 AND (round(p.wall_fert_days_mask)::integer <> 0 OR round(p.wall_fert_every_n)::integer > 0) AS fertigation_enabled,
    ARRAY['drip_wall_fert'::text, 'mister_south_fert'::text, 'mister_west_fert'::text] AS fert_relays,
    ARRAY['drip_wall'::text, 'mister_south'::text, 'mister_west'::text] AS flush_relays,
    s.schedule_source,
    s.plan_id,
    s.plan_ts,
    s.stale_readback_count,
    s.readback_drift_count,
    'One wall drip path serves south and west; firmware queues wall drip, south mister, and west mister fert jobs from this schedule.'::text AS notes
   FROM pivoted p
     CROSS JOIN source_rollup s
UNION ALL
 SELECT 'center'::text AS schedule_id,
    'center'::text AS zone_path,
    'Center drip'::text AS display_name,
    ARRAY['center'::text] AS serves_zones,
    COALESCE(( SELECT latest_equipment.state
           FROM latest_equipment
          WHERE latest_equipment.equipment = 'irrigation_enabled'::text), true) AND COALESCE(( SELECT latest_equipment.state
           FROM latest_equipment
          WHERE latest_equipment.equipment = 'irrigation_center_enabled'::text), true) AS enabled,
    make_time(GREATEST(0, LEAST(23, round(p.center_start_hour)::integer)), GREATEST(0, LEAST(59, round(p.center_start_min)::integer)), 0::double precision) AS start_time,
    round(p.center_duration_min)::integer AS clean_duration_min,
    round(p.center_fert_duration_min)::integer AS fert_duration_min,
    round(p.center_flush_min)::integer AS flush_min,
    round(p.center_interval_days)::integer AS interval_days,
    round(p.center_days_mask)::integer AS days_mask,
    round(p.center_fert_days_mask)::integer AS fert_days_mask,
    round(p.center_fert_every_n)::integer AS fert_every_n,
    round(p.center_fert_duration_min)::integer > 0 AND (round(p.center_fert_days_mask)::integer <> 0 OR round(p.center_fert_every_n)::integer > 0) AS fertigation_enabled,
    ARRAY['drip_center_fert'::text] AS fert_relays,
    ARRAY['drip_center'::text] AS flush_relays,
    s.schedule_source,
    s.plan_id,
    s.plan_ts,
    s.stale_readback_count,
    s.readback_drift_count,
    'Center drip/fert path; center root-zone and runoff feedback remain pending physical instrumentation.'::text AS notes
   FROM pivoted p
     CROSS JOIN source_rollup s;
COMMENT ON VIEW public.v_irrigation_schedule_current IS
    'Canonical current irrigation schedule. Values prefer v_active_plan, then ESP32 observed number states, then cfg_* '
    'readbacks, then firmware defaults. A readback is stale when its newest row is older than 2 hours (315).';

-- RELEASE REVIEW RS-6: retired plans no longer read as in force. Idempotent; setpoint_plan is not compressed and its
-- only trigger fires on INSERT.
UPDATE public.setpoint_plan SET is_active = false WHERE is_active;

-- RELEASE REVIEW PLANNER-03 (lane PLANNER): trigger ledger rows left open at the plan-cycle cutover never resolve.
-- By status, not id, so rows that moved since the review are left alone; idempotent.
UPDATE public.planner_trigger_ledger
   SET status = 'missed', terminal_action = 'timeout', terminal_at = now(), resolved_at = now(), updated_at = now(),
       notes = concat_ws('; ', notes, 'the plan cycle is retired (climate refactor 4.2)')
 WHERE status IN ('expected', 'delivered');

-- AF7: the counter check. The events stay the source; this view only reconciles.
CREATE VIEW public.v_relay_counter_reconciliation_daily AS
WITH relays(equipment, starts_key, run_key) AS (
    VALUES ('heat1'::text, 'h1'::text, NULL::text), ('heat2', 'h2', NULL), ('fan1', 'f1', 'f1s'),
           ('fan2', 'f2', 'f2s'), ('fog', 'fg', NULL), ('vent', 'vt', NULL)
), samples AS (
    SELECT s.ts, COALESCE(s.greenhouse_id, 'vallery') AS greenhouse_id, s.value::jsonb AS v
      FROM public.system_state s
     WHERE s.entity = 'relay_counters' AND s.ts >= TIMESTAMPTZ '2026-11-16 19:48:00+00'
), steps AS (
    SELECT (sm.ts AT TIME ZONE 'America/Denver')::date AS date, sm.greenhouse_id, r.equipment,
           GREATEST((sm.v ->> r.starts_key)::bigint
                    - COALESCE(lag((sm.v ->> r.starts_key)::bigint) OVER w, 0), 0) AS starts,
           CASE WHEN r.run_key IS NOT NULL THEN
                GREATEST((sm.v ->> r.run_key)::bigint - COALESCE(lag((sm.v ->> r.run_key)::bigint) OVER w, 0), 0)
           END AS run_s
      FROM samples sm
     CROSS JOIN relays r
    WINDOW w AS (PARTITION BY sm.greenhouse_id, r.equipment ORDER BY sm.ts)
), counted AS (
    SELECT date, greenhouse_id, equipment, sum(starts)::bigint AS starts, sum(run_s)::bigint AS run_s,
           count(*)::integer AS n_rows
      FROM steps
     GROUP BY date, greenhouse_id, equipment
), frame AS (
    SELECT d.d::date AS date, g.greenhouse_id, r.equipment, r.run_key IS NOT NULL AS has_run_counter,
           (now() AT TIME ZONE 'America/Denver')::date AS today
      FROM generate_series(DATE '2026-11-16', (now() AT TIME ZONE 'America/Denver')::date, interval '1 day') AS d(d)
     CROSS JOIN (SELECT id AS greenhouse_id FROM public.greenhouses UNION SELECT 'vallery') AS g
     CROSS JOIN relays r
)
SELECT f.date,
       f.greenhouse_id,
       f.equipment,
       COALESCE(c.starts, 0) AS counter_starts,
       rr.starts AS record_starts,
       COALESCE(c.starts, 0) - rr.starts AS starts_difference,
       CASE WHEN f.has_run_counter THEN COALESCE(c.run_s, 0) END AS counter_run_s,
       rr.run_s AS record_run_s,
       CASE WHEN f.has_run_counter THEN COALESCE(c.run_s, 0) - rr.run_s END AS run_s_difference,
       COALESCE(c.n_rows, 0) AS counter_rows,
       CASE WHEN f.date = DATE '2026-11-16' OR f.date >= f.today THEN 'partial'
            WHEN rr.date IS NULL THEN 'no_record'
            ELSE 'complete' END AS comparison
  FROM frame f
  LEFT JOIN counted c ON c.date = f.date AND c.greenhouse_id = f.greenhouse_id AND c.equipment = f.equipment
  LEFT JOIN public.daily_relay_record rr
    ON rr.date = f.date AND rr.greenhouse_id = f.greenhouse_id AND rr.equipment = f.equipment;
COMMENT ON VIEW public.v_relay_counter_reconciliation_daily IS
    'Relay counters against the daily relay record (315, #1633, RULINGS AF7): per local day, greenhouse and relay, '
    'the starts (fans: and run seconds) summed from relay_counters deltas, a negative delta counted as 0, beside '
    'daily_relay_record''s figures from the stored edges, and their difference. A check only; the events are the '
    'source. Valid from the phase 2 flash, 2026-11-16 19:48Z: that day and today read partial; no_record = no '
    'daily_relay_record row.';
GRANT SELECT ON public.v_relay_counter_reconciliation_daily TO verdify_dashboard_runtime, verdify_ingestor_runtime;

-- Successor seals: the probe of the rolled-back native qualification measures them, and each receipt is re-sealed.
-- Measured by the native probe of 2026-11-16 (22:55Z): all three seals move; the MCP seal moves because the MCP duty
-- reads v_irrigation_day_coverage, whose definition the MCP boundary digest hashes.
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '7022e3a448569e051a81a19ff621bade902fab0b393c2e45756f7bb9449702dc'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '3ead905daede269bd598b38c86c0477d33e1b51c425a2efc7d5c16c042a745f2'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'ae8180a5fc5dc400fc0f9c49fc6f069c89af033a9b9425ef52a14bf85b202256'
    THEN RAISE EXCEPTION '315 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('7022e3a448569e051a81a19ff621bade902fab0b393c2e45756f7bb9449702dc','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '315 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('3ead905daede269bd598b38c86c0477d33e1b51c425a2efc7d5c16c042a745f2','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '315 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('ae8180a5fc5dc400fc0f9c49fc6f069c89af033a9b9425ef52a14bf85b202256','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '315 missing mcp receipt'; END IF;
    IF EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
    THEN RAISE EXCEPTION '315 receipts do not match the successor seals'; END IF;
END $successor$;
