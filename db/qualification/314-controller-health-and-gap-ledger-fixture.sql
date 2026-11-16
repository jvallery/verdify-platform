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

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('nine_diagnostics_columns_typed', 'ingestor_inserts_the_nine_through_the_facade',
                               'ingestor_reads_and_inserts_the_ledger_only', 'api_mcp_and_public_denied',
                               'ingestor_login_writes_health_row', 'one_ledger_row_per_quarter',
                               'placed_quarter_needs_records'),
    'all_passed', true)::text;
