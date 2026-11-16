-- Run only inside an explicit rollback-only transaction after exact314 (#1633, host release 3), as the superuser owner:
-- scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. It checks that the
-- nine diagnostics columns exist with their types, that the ingestor duty inserts exactly them through the facade and
-- reads and inserts into the gap-replay ledger, and that the api login, the MCP duty and PUBLIC reach no ledger row.
-- As the ingestor login it then writes one diagnostics row with the nine columns through the facade and one ledger
-- row, and proves a second ledger row for the same quarter and a row with times but no records are refused. The
-- rollback discards all of it. The last line reports the result to the qualifier.
DO $catalog$
DECLARE
    ing text := 'verdify_ingestor_runtime';
    facade text := 'public.v_runtime_diagnostics_write';
    ledger text := 'public.gap_replay_quarters';
    col text;
BEGIN
    IF (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
          FROM pg_attribute a
         WHERE a.attrelid = 'public.diagnostics'::regclass AND a.attnum > 0 AND NOT a.attisdropped
           AND a.attname IN ('heap_min_free_minute_kb', 'heap_largest_block_minute_low_kb', 'loop_worst_ms',
                             'restart_count', 'nvs_used_entries', 'nvs_free_entries', 'nvs_write_worst_ms',
                             'gap_log_state', 'sensor_degraded_active'))
       IS DISTINCT FROM ARRAY['heap_min_free_minute_kb:double precision',
                              'heap_largest_block_minute_low_kb:double precision',
                              'loop_worst_ms:double precision', 'restart_count:integer',
                              'nvs_used_entries:integer', 'nvs_free_entries:integer',
                              'nvs_write_worst_ms:double precision', 'gap_log_state:text',
                              'sensor_degraded_active:integer']
    THEN RAISE EXCEPTION '314 diagnostics columns are not exact'; END IF;
    FOREACH col IN ARRAY ARRAY['heap_min_free_minute_kb', 'heap_largest_block_minute_low_kb', 'loop_worst_ms',
                               'restart_count', 'nvs_used_entries', 'nvs_free_entries', 'nvs_write_worst_ms',
                               'gap_log_state', 'sensor_degraded_active', 'ts', 'firmware_version'] LOOP
        IF NOT has_column_privilege(ing, facade, col, 'INSERT') THEN
            RAISE EXCEPTION '314 facade insert of % is missing', col;
        END IF;
    END LOOP;
    IF has_table_privilege(ing, 'public.diagnostics', 'INSERT,UPDATE,DELETE,TRUNCATE')
        OR NOT has_table_privilege(ing, ledger, 'SELECT')
        OR has_table_privilege(ing, ledger, 'INSERT') OR has_table_privilege(ing, ledger, 'UPDATE')
        OR has_table_privilege(ing, ledger, 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_column_privilege(ing, ledger, 'received_at', 'INSERT')
        OR has_table_privilege('verdify_api_runtime_login', ledger, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_table_privilege('verdify_mcp_runtime', ledger, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_table_privilege('public', ledger, 'SELECT')
    THEN RAISE EXCEPTION '314 access is not exact'; END IF;
    FOREACH col IN ARRAY ARRAY['boot', 'qseq', 'first_ts', 'last_ts', 'climate_rows', 'transition_rows',
                               'format_version'] LOOP
        IF NOT has_column_privilege(ing, ledger, col, 'INSERT') THEN
            RAISE EXCEPTION '314 ledger insert of % is missing', col;
        END IF;
    END LOOP;
END $catalog$;

-- SET SESSION AUTHORIZATION needs the superuser owner; the rollback undoes it.
SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $ingestor$
DECLARE
    at timestamptz := date_trunc('minute', now()) - interval '1 minute';
BEGIN
    INSERT INTO public.v_runtime_diagnostics_write
        (ts, greenhouse_id, heap_min_free_minute_kb, heap_largest_block_minute_low_kb, loop_worst_ms, restart_count,
         nvs_used_entries, nvs_free_entries, nvs_write_worst_ms, gap_log_state, sensor_degraded_active)
    VALUES (at, 'vallery', 38.5, 30.0, 12.0, 7, 120, 380, 0.0, 'armed', 0);
    INSERT INTO public.gap_replay_quarters
        (boot, qseq, first_ts, last_ts, climate_rows, transition_rows, format_version)
    VALUES (314, 1, at - interval '14 minutes', at, 15, 2, 2);
    IF (SELECT climate_rows FROM public.gap_replay_quarters WHERE boot = 314 AND qseq = 1) <> 15 THEN
        RAISE EXCEPTION '314 ingestor login does not read its ledger row';
    END IF;
    BEGIN
        INSERT INTO public.gap_replay_quarters
            (boot, qseq, first_ts, last_ts, climate_rows, transition_rows, format_version)
        VALUES (314, 1, at, at, 1, 0, 2);
        RAISE EXCEPTION '314 accepted a second row for one quarter';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO public.gap_replay_quarters
            (boot, qseq, first_ts, last_ts, climate_rows, transition_rows, format_version)
        VALUES (314, 2, at, at, 0, 0, 2);
        RAISE EXCEPTION '314 accepted a placed quarter with no records';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $ingestor$;
RESET SESSION AUTHORIZATION;

-- A one-hour outage whose middle quarter was replayed reads as two pieces, without the replayed minutes.
INSERT INTO public.data_gaps (start_ts, end_ts, duration_s, reason, backfill_status)
VALUES ('2026-11-16 10:00+00', '2026-11-16 11:00+00', 3600, 'ingestor_restart', 'snapshot_taken');
INSERT INTO public.gap_replay_quarters (boot, qseq, first_ts, last_ts, climate_rows, transition_rows, format_version)
VALUES (315, 7, '2026-11-16 10:15+00', '2026-11-16 10:29+00', 15, 0, 2);
SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;
DO $dashboard$
BEGIN
    IF (SELECT array_agg(tstzrange(start_ts, end_ts) ORDER BY start_ts)
          FROM public.v_data_gaps_unreplayed WHERE start_ts >= '2026-11-16 09:00+00' AND end_ts <= '2026-11-16 12:00+00')
        IS DISTINCT FROM ARRAY[tstzrange('2026-11-16 10:00+00', '2026-11-16 10:15+00'),
                               tstzrange('2026-11-16 10:30+00', '2026-11-16 11:00+00')] THEN
        RAISE EXCEPTION '314 v_data_gaps_unreplayed does not cut the replayed quarter out of the gap';
    END IF;
    IF has_table_privilege('public.gap_replay_quarters', 'SELECT') THEN
        RAISE EXCEPTION '314 dashboard login reads the ledger directly';
    END IF;
END $dashboard$;
RESET SESSION AUTHORIZATION;

-- The observation spool (on in production) sends every Diagnostics field, NULL included, through
-- fn_record_observational_source_event: the nine new keys pass with values and as NULL (phase 2 and law
-- firmware), and a key outside the pinned list is still refused. Definition, security and ACL as 267 made them.
SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $spool$
DECLARE
    at timestamptz := date_trunc('minute', now()) - interval '3 minutes';
    every_key text[] :=
        ARRAY['wifi_rssi','heap_bytes','heap_min_free_kb','heap_largest_free_block_kb','uptime_s','probe_health',
              'reset_reason','firmware_version','active_probe_count','relief_cycle_count','vent_latch_timer_s',
              'sealed_timer_s','vpd_watch_timer_s','mist_backoff_timer_s','vent_mist_assist_active',
              'effective_heat_target_f','effective_cool_stage2_delta_f','effective_vpd_hysteresis_kpa',
              'effective_dehum_aggressive_kpa','controller_time_epoch','controller_local_hour','sntp_valid',
              'sntp_miss_count','last_sntp_sync_age_s','band_source','zone_wet_granted','heap_min_free_minute_kb',
              'heap_largest_block_minute_low_kb','loop_worst_ms','restart_count','nvs_used_entries',
              'nvs_free_entries','nvs_write_worst_ms','gap_log_state','sensor_degraded_active'];
    all_null jsonb;
    refused boolean := false;
BEGIN
    SELECT jsonb_object_agg(k, 'null'::jsonb) INTO all_null FROM unnest(every_key) AS k;
    IF NOT public.fn_record_observational_source_event(gen_random_uuid(), 'diagnostics', at, 'vallery',
            gen_random_uuid(), 1, all_null || jsonb_build_object('uptime_s', 100, 'heap_min_free_minute_kb', 38.5,
            'heap_largest_block_minute_low_kb', 30.0, 'loop_worst_ms', 12.0, 'restart_count', 7,
            'nvs_used_entries', 120, 'nvs_free_entries', 380, 'nvs_write_worst_ms', 0.0, 'gap_log_state', 'armed',
            'sensor_degraded_active', 0)) THEN
        RAISE EXCEPTION '314 spool function did not store a diagnostics row with the nine keys';
    END IF;
    IF NOT public.fn_record_observational_source_event(gen_random_uuid(), 'diagnostics', at + interval '1 minute',
            'vallery', gen_random_uuid(), 1, all_null || jsonb_build_object('uptime_s', 160)) THEN
        RAISE EXCEPTION '314 spool function did not store a diagnostics row with the nine keys NULL';
    END IF;
    IF (SELECT count(*) FROM public.diagnostics WHERE ts = at AND restart_count = 7 AND gap_log_state = 'armed') <> 1
        OR (SELECT count(*) FROM public.diagnostics
             WHERE ts = at + interval '1 minute' AND uptime_s = 160 AND restart_count IS NULL) <> 1 THEN
        RAISE EXCEPTION '314 spool function rows are not in diagnostics';
    END IF;
    BEGIN
        PERFORM public.fn_record_observational_source_event(gen_random_uuid(), 'diagnostics',
            at + interval '2 minutes', 'vallery', gen_random_uuid(), 1, jsonb_build_object('no_such_key', 1));
    EXCEPTION WHEN raise_exception THEN
        refused := SQLERRM LIKE 'observational field outside pinned INSERT projection%';
    END;
    IF NOT refused THEN
        RAISE EXCEPTION '314 spool function accepted a key outside its pinned list';
    END IF;
END $spool$;
RESET SESSION AUTHORIZATION;
DO $spool_definition$
BEGIN
    IF NOT (SELECT p.prosecdef
           AND p.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp', 'TimeZone=UTC']
           AND p.proowner = (SELECT relowner FROM pg_class WHERE oid = 'public.observational_source_events'::regclass)
           AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
           AND has_function_privilege('verdify_ingestor_runtime', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('verdify_api_runtime_login', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('verdify_mcp_runtime_login', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('verdify_dashboard_runtime_login', p.oid, 'EXECUTE')
          FROM pg_proc p
         WHERE p.oid = 'public.fn_record_observational_source_event(uuid,text,timestamptz,text,uuid,bigint,jsonb)'
                       ::regprocedure) THEN
        RAISE EXCEPTION '314 spool function lost 267''s security, owner or ACL';
    END IF;
END $spool_definition$;

-- AF4 (lane DATA): the ingestor duty reads the daily record, SELECT only.
DO $af4$
BEGIN
    IF NOT (has_table_privilege('verdify_ingestor_runtime', 'public.daily_record', 'SELECT')
       AND has_table_privilege('verdify_ingestor_runtime', 'public.daily_relay_record', 'SELECT')
       AND NOT has_table_privilege('verdify_ingestor_runtime', 'public.daily_record', 'INSERT,UPDATE,DELETE,TRUNCATE')
       AND NOT has_table_privilege('verdify_ingestor_runtime', 'public.daily_relay_record', 'INSERT,UPDATE,DELETE,TRUNCATE')
       AND has_table_privilege('verdify_ingestor_runtime_login', 'public.daily_record', 'SELECT')) THEN
        RAISE EXCEPTION '314 AF4 daily record grant is not SELECT only for the ingestor duty';
    END IF;
END $af4$;

-- AF10 (lane DATA): definition, security and ACL as 310 made them, three recent days.
DO $af10$
BEGIN
    IF NOT (SELECT p.prosecdef
           AND p.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']
           AND pg_get_functiondef(p.oid) LIKE '%(VALUES (v_today), (v_today - 1), (v_today - 2))%'
           AND pg_get_functiondef(p.oid) LIKE '%v_today - 3, interval ''1 day''%'
           AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = 'public.fn_daily_record_store(date)'::regprocedure)
           AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
           AND has_function_privilege('verdify_matview_refresh_runtime', p.oid, 'EXECUTE')
          FROM pg_proc p
         WHERE p.oid = 'verdify_matview_refresh_runtime.fn_refresh_daily_record()'::regprocedure) THEN
        RAISE EXCEPTION '314 AF10 fn_refresh_daily_record is not the three-day definition with 310''s security';
    END IF;
END $af10$;

-- AF11 (lane MONITORING): the two change-only registry rows are inactive.
DO $af11$
BEGIN
    IF (SELECT count(*) FROM public.sensor_registry
         WHERE sensor_id IN ('state.lead_fan', 'equipment.sntp_status') AND NOT active) <> 2 THEN
        RAISE EXCEPTION '314 AF11 change-only sensor_registry rows are still active';
    END IF;
END $af11$;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('nine_diagnostics_columns_typed', 'ingestor_inserts_the_nine_through_the_facade',
                               'ingestor_reads_and_inserts_the_ledger_only', 'api_mcp_and_public_denied',
                               'ingestor_login_writes_health_row', 'one_ledger_row_per_quarter',
                               'placed_quarter_needs_records', 'dashboard_reads_gaps_without_replayed_minutes',
                               'af4_ingestor_reads_daily_record_only', 'af10_refresh_stores_three_days',
                               'af11_change_only_rows_inactive',
                               'spool_admits_the_nine_with_values_and_null', 'spool_function_keeps_267_security'),
    'all_passed', true)::text;
