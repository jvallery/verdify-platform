-- Run only inside an explicit rollback-only transaction after exact 307 (#1184), as the superuser owner:
-- scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. climate gains
-- ppfd_umol_m2_s (double precision), and the runtime write facade keeps 217's 86 columns and options with it
-- appended. The ingestor duty may INSERT it through the facade and nothing else changes: no UPDATE, no api INSERT,
-- no PUBLIC read. The ingestor login records one climate source event carrying PPFD through
-- fn_record_climate_source_event, the production write path (266), and the legacy ppfd column is still refused.
-- The dashboard login reads the stored value. The rollback discards all of it. The last line reports the result.
DO $catalog$
BEGIN
    IF (SELECT format_type(atttypid, atttypmod) FROM pg_catalog.pg_attribute
         WHERE attrelid = 'public.climate'::regclass AND attname = 'ppfd_umol_m2_s' AND NOT attisdropped)
           IS DISTINCT FROM 'double precision'
        OR (SELECT count(*) FROM pg_catalog.pg_attribute
             WHERE attrelid = 'public.v_runtime_climate_write'::regclass AND attnum > 0 AND NOT attisdropped) <> 87
        OR (SELECT attname FROM pg_catalog.pg_attribute
             WHERE attrelid = 'public.v_runtime_climate_write'::regclass AND attnum > 0 AND NOT attisdropped
             ORDER BY attnum DESC LIMIT 1) IS DISTINCT FROM 'ppfd_umol_m2_s'
        OR (SELECT reloptions FROM pg_catalog.pg_class WHERE oid = 'public.v_runtime_climate_write'::regclass)
           IS DISTINCT FROM ARRAY['security_barrier=true', 'security_invoker=false']
        OR (SELECT pg_get_userbyid(relowner) FROM pg_catalog.pg_class
             WHERE oid = 'public.v_runtime_climate_write'::regclass) <> 'verdify'
    THEN RAISE EXCEPTION '307 climate column or write facade is not exact'; END IF;
    IF NOT has_column_privilege('verdify_ingestor_runtime', 'public.v_runtime_climate_write', 'ppfd_umol_m2_s', 'INSERT')
        OR NOT has_column_privilege('verdify_ingestor_runtime', 'public.v_runtime_climate_write', 'ppfd_umol_m2_s',
                                    'SELECT')
        OR has_column_privilege('verdify_ingestor_runtime', 'public.v_runtime_climate_write', 'ppfd_umol_m2_s',
                                'UPDATE')
        OR has_column_privilege('verdify_api_runtime_login', 'public.v_runtime_climate_write', 'ppfd_umol_m2_s',
                                'INSERT')
        OR has_table_privilege('verdify_ingestor_runtime_login', 'public.climate', 'INSERT,UPDATE,DELETE,TRUNCATE')
        OR NOT has_column_privilege('verdify_dashboard_runtime', 'public.climate', 'ppfd_umol_m2_s', 'SELECT')
        OR NOT has_column_privilege('verdify_mcp_runtime', 'public.climate', 'ppfd_umol_m2_s', 'SELECT')
        OR has_column_privilege('public', 'public.climate', 'ppfd_umol_m2_s', 'SELECT')
    THEN RAISE EXCEPTION '307 ppfd_umol_m2_s access is not exact'; END IF;
    -- One timestamp for the write and the reads below, inside the current (uncompressed) chunk.
    PERFORM set_config('verdify.q307_ts', (date_trunc('second', clock_timestamp()) + interval '0.307307 second')::text,
                       false);
END $catalog$;

-- SET SESSION AUTHORIZATION needs the superuser owner; the rollback undoes it.
SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $ingestor$
DECLARE
    t timestamptz := current_setting('verdify.q307_ts')::timestamptz;
BEGIN
    IF public.fn_record_climate_source_event(gen_random_uuid(), t, 'vallery', gen_random_uuid(), 0,
            jsonb_build_object('ppfd_umol_m2_s', 812.0), jsonb_build_object('qualification', '307'))
       IS NOT TRUE
    THEN RAISE EXCEPTION '307 ingestor login could not record a PPFD climate event'; END IF;
    IF (SELECT ppfd_umol_m2_s FROM public.climate WHERE ts = t AND greenhouse_id = 'vallery') IS DISTINCT FROM 812
    THEN RAISE EXCEPTION '307 ingestor login does not read the stored PPFD'; END IF;
    BEGIN
        PERFORM public.fn_record_climate_source_event(gen_random_uuid(), t + interval '1 second', 'vallery',
            gen_random_uuid(), 0, jsonb_build_object('ppfd', 812.0), jsonb_build_object('qualification', '307'));
        RAISE EXCEPTION '307 ingestor login wrote the legacy ppfd column';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE 'climate payload column is outside runtime INSERT projection: ppfd' THEN RAISE; END IF;
    END;
END $ingestor$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;
DO $dashboard$
BEGIN
    IF (SELECT ppfd_umol_m2_s FROM public.climate
         WHERE ts = current_setting('verdify.q307_ts')::timestamptz AND greenhouse_id = 'vallery')
       IS DISTINCT FROM 812
    THEN RAISE EXCEPTION '307 dashboard login does not read the stored PPFD'; END IF;
END $dashboard$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('column_is_double_precision', 'facade_appends_one_column_with_217_options',
                               'ingestor_insert_only_on_the_new_column', 'api_and_public_denied',
                               'ingestor_login_records_ppfd_event', 'legacy_ppfd_still_refused',
                               'dashboard_login_reads_ppfd'),
    'all_passed', true)::text;
