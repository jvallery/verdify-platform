-- Run only inside an explicit rollback-only transaction after exact 308 (#1184), as the superuser owner:
-- scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. The ledger holds
-- exactly dli-validity-v1 (closed at the migration's now()) and dli-validity-v2-par (open from that instant, available,
-- operator-validated), and 195's fail-closed CHECK is replaced by the PAR-only one. Both DLI views keep 195's ten
-- columns and types, so their dependents and the per-login wrappers still read them. With no PPFD in production yet,
-- v_dli_current reads unavailable / source_reading_missing with the PAR provenance and no day of v_dli_daily is
-- available. The dashboard login reads both views; the api, MCP, Grafana and lab-publisher logins keep their reads.
-- The rollback discards all of it. The last line reports the result.
DO $catalog$
DECLARE
    expected_current text[] := ARRAY['ts timestamp with time zone', 'greenhouse_id text',
        'crop_dli_mol_m2_day double precision', 'availability text', 'unavailable_reason text', 'provenance text',
        'validity_revision text', 'valid_from timestamp with time zone', 'valid_to timestamp with time zone',
        'forensic_proxy_present boolean'];
    expected_daily text[];
BEGIN
    expected_daily := ARRAY['date date'] || expected_current[2:10];
    IF (SELECT array_agg(attname || ' ' || format_type(atttypid, atttypmod) ORDER BY attnum) FROM pg_catalog.pg_attribute
         WHERE attrelid = 'public.v_dli_current'::regclass AND attnum > 0 AND NOT attisdropped)
           IS DISTINCT FROM expected_current
        OR (SELECT array_agg(attname || ' ' || format_type(atttypid, atttypmod) ORDER BY attnum)
              FROM pg_catalog.pg_attribute
             WHERE attrelid = 'public.v_dli_daily'::regclass AND attnum > 0 AND NOT attisdropped)
           IS DISTINCT FROM expected_daily
        OR pg_get_viewdef('public.v_dli_current'::regclass) NOT LIKE '%ppfd_umol_m2_s%'
        OR pg_get_viewdef('public.v_dli_daily'::regclass) NOT LIKE '%ppfd_umol_m2_s%'
        OR pg_get_viewdef('public.v_dli_current'::regclass) LIKE '%lux%'
        OR pg_get_viewdef('public.v_dli_daily'::regclass) LIKE '%lux%'
    THEN RAISE EXCEPTION '308 DLI views are not exact'; END IF;
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.dli_validity_intervals'::regclass
               AND conname = 'dli_validity_release_unavailable')
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint
                       WHERE conrelid = 'public.dli_validity_intervals'::regclass
                         AND conname = 'dli_validity_release_par_only')
        OR (SELECT count(*) FROM public.dli_validity_intervals) <> 2
        OR NOT EXISTS(SELECT 1 FROM public.dli_validity_intervals WHERE validity_revision = 'dli-validity-v1'
                       AND availability = 'unavailable' AND valid_to = now())
        OR NOT EXISTS(SELECT 1 FROM public.dli_validity_intervals WHERE validity_revision = 'dli-validity-v2-par'
                       AND greenhouse_id = 'vallery' AND valid_from = now() AND valid_to IS NULL
                       AND availability = 'available' AND unavailable_reason IS NULL
                       AND provenance = 'par_quantum_sensor_canopy' AND operator_validated
                       AND created_by = 'migration_308')
    THEN RAISE EXCEPTION '308 validity ledger is not exact'; END IF;
    BEGIN
        INSERT INTO public.dli_validity_intervals (greenhouse_id, valid_from, valid_to, availability, provenance,
            validity_revision, operator_validated, created_by)
        VALUES ('q308', '2020-01-01', '2020-01-02', 'available', 'lux_proxy', 'q308', true, 'q308');
        RAISE EXCEPTION '308 ledger accepted a non-PAR available interval';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    IF NOT has_table_privilege('verdify_dashboard_runtime', 'public.v_dli_current', 'SELECT')
        OR NOT has_table_privilege('verdify_dashboard_runtime', 'public.v_dli_daily', 'SELECT')
        OR NOT has_function_privilege('verdify_dashboard_runtime', 'public.fn_dli_validity(timestamptz,text)',
                                      'EXECUTE')
        OR NOT has_column_privilege('verdify_dashboard_runtime', 'public.dli_validity_intervals', 'availability',
                                    'SELECT')
        OR has_column_privilege('verdify_dashboard_runtime', 'public.dli_validity_intervals', 'created_by', 'SELECT')
        OR has_table_privilege('verdify_dashboard_runtime', 'public.dli_validity_intervals', 'INSERT,UPDATE,DELETE')
        OR has_table_privilege('public', 'public.v_dli_current', 'SELECT')
        OR has_table_privilege('public', 'public.v_dli_daily', 'SELECT')
        OR NOT has_table_privilege('verdify_api_runtime', 'public.v_dli_current', 'SELECT')
        OR NOT has_table_privilege('verdify_mcp_runtime', 'public.v_dli_daily', 'SELECT')
    THEN RAISE EXCEPTION '308 DLI access is not exact'; END IF;
    -- Production has no PPFD yet: fail closed with the PAR provenance, and no available day.
    IF (SELECT availability || '/' || unavailable_reason || '/' || provenance || '/' || validity_revision
          FROM public.v_dli_current WHERE greenhouse_id = 'vallery')
           IS DISTINCT FROM 'unavailable/source_reading_missing/par_quantum_sensor_canopy/dli-validity-v2-par'
        OR (SELECT crop_dli_mol_m2_day FROM public.v_dli_current WHERE greenhouse_id = 'vallery') IS NOT NULL
        OR EXISTS(SELECT 1 FROM public.v_dli_daily WHERE availability <> 'unavailable'
                   OR crop_dli_mol_m2_day IS NOT NULL OR unavailable_reason IS NULL)
        OR EXISTS(SELECT 1 FROM public.v_dli_daily WHERE date < (now() AT TIME ZONE 'America/Denver')::date - 1
                   AND (unavailable_reason, validity_revision)
                       IS DISTINCT FROM ('interior_light_sensor_broken', 'dli-validity-v1'))
    THEN RAISE EXCEPTION '308 DLI does not fail closed without PPFD'; END IF;
END $catalog$;

-- SET SESSION AUTHORIZATION needs the superuser owner; the rollback undoes it.
SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;
DO $dashboard$
BEGIN
    IF (SELECT availability FROM public.v_dli_current WHERE greenhouse_id = 'vallery') IS DISTINCT FROM 'unavailable'
        OR NOT EXISTS(SELECT 1 FROM public.v_dli_daily)
    THEN RAISE EXCEPTION '308 dashboard login does not read the DLI views'; END IF;
END $dashboard$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_api_runtime_login;
DO $api$
BEGIN
    IF (SELECT provenance FROM public.v_dli_current WHERE greenhouse_id = 'vallery')
       IS DISTINCT FROM 'par_quantum_sensor_canopy'
    THEN RAISE EXCEPTION '308 api login does not read v_dli_current'; END IF;
END $api$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_mcp_runtime_login;
DO $mcp$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.v_dli_daily) THEN RAISE EXCEPTION '308 MCP login does not read v_dli_daily'; END IF;
END $mcp$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_grafana_runtime_login;
DO $grafana$
BEGIN
    IF (SELECT validity_revision FROM verdify_grafana_runtime.v_dli_current WHERE greenhouse_id = 'vallery')
       IS DISTINCT FROM 'dli-validity-v2-par'
    THEN RAISE EXCEPTION '308 Grafana login does not read its v_dli_current wrapper'; END IF;
END $grafana$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_lab_publisher_runtime_login;
DO $lab$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM verdify_lab_publisher_runtime.v_dli_daily)
    THEN RAISE EXCEPTION '308 lab-publisher login does not read its v_dli_daily wrapper'; END IF;
END $lab$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('views_keep_ten_columns_and_read_ppfd', 'ledger_v1_closed_v2_par_open',
                               'par_only_check_refuses_other_sources', 'dashboard_grants_exact',
                               'fails_closed_without_ppfd', 'dashboard_login_reads_both_views',
                               'api_mcp_grafana_lab_reads_kept'),
    'all_passed', true)::text;
