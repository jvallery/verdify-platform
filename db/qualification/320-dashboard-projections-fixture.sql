-- Run only inside an explicit rollback-only transaction after exact320 (the dashboard read model), as the superuser
-- owner: scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. Each of the
-- three projections has exactly its specified columns, is verdify's and grants SELECT to the dashboard duty alone. The
-- dashboard login (the operator API's) attests and reads each one with a bounded read, and still has no privilege on
-- planner_review, daily_relay_record or gap_replay_quarters. The ingestor runtime login is refused on every
-- projection, and neither the api nor the MCP login nor PUBLIC can read one. Nothing is written. The last line
-- reports the result to the qualifier.
DO $views$
BEGIN
    IF (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = 'public.v_dashboard_review'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM 'id,kind,review_date,requested_at,requested_by,status,attempts,delivered_at,failure,'
                         'run_finished_at,input_tokens,output_tokens,total_tokens,written_at,summary,band_proposal' THEN
        RAISE EXCEPTION '320 v_dashboard_review columns are not the specified list';
    END IF;
    IF (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = 'public.v_dashboard_relay_day'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM 'date,greenhouse_id,equipment,starts,run_s,event_run_s,repaired_runs,computed_at' THEN
        RAISE EXCEPTION '320 v_dashboard_relay_day columns are not the specified list';
    END IF;
    IF (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = 'public.v_dashboard_gap_replay'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM 'boot,qseq,first_ts,last_ts,climate_rows,transition_rows,format_version,received_at' THEN
        RAISE EXCEPTION '320 v_dashboard_gap_replay columns are not the specified list';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                WHERE c.oid IN ('public.v_dashboard_review'::regclass, 'public.v_dashboard_relay_day'::regclass,
                                'public.v_dashboard_gap_replay'::regclass)
                  AND c.relowner::regrole::text || '|' || c.relacl::text
                      IS DISTINCT FROM 'verdify|{verdify=arwdDxt/verdify,verdify_dashboard_runtime=r/verdify}') THEN
        RAISE EXCEPTION '320 a projection''s owner or grants are not exact';
    END IF;
    IF has_table_privilege('verdify_api_runtime_login', 'public.v_dashboard_review', 'SELECT')
        OR has_table_privilege('verdify_api_runtime_login', 'public.v_dashboard_relay_day', 'SELECT')
        OR has_table_privilege('verdify_api_runtime_login', 'public.v_dashboard_gap_replay', 'SELECT')
        OR has_table_privilege('verdify_mcp_runtime_login', 'public.v_dashboard_review', 'SELECT')
        OR has_table_privilege('verdify_mcp_runtime_login', 'public.v_dashboard_relay_day', 'SELECT')
        OR has_table_privilege('verdify_mcp_runtime_login', 'public.v_dashboard_gap_replay', 'SELECT')
        OR has_table_privilege('public', 'public.v_dashboard_review', 'SELECT')
        OR has_table_privilege('public', 'public.v_dashboard_relay_day', 'SELECT')
        OR has_table_privilege('public', 'public.v_dashboard_gap_replay', 'SELECT')
    THEN RAISE EXCEPTION '320 a projection is readable beyond the dashboard duty'; END IF;
END $views$;

-- SET SESSION AUTHORIZATION needs the superuser owner; the rollback undoes it.
SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;
DO $dashboard$
BEGIN
    IF verdify_dashboard_runtime.fn_attest_login() IS NOT TRUE THEN
        RAISE EXCEPTION '320 dashboard login does not attest';
    END IF;
    IF has_table_privilege(current_user, 'public.planner_review', 'SELECT')
        OR has_table_privilege(current_user, 'public.daily_relay_record', 'SELECT')
        OR has_table_privilege(current_user, 'public.gap_replay_quarters', 'SELECT') THEN
        RAISE EXCEPTION '320 dashboard login reads a base table directly';
    END IF;
    PERFORM * FROM public.v_dashboard_review r WHERE r.review_date >= (now() AT TIME ZONE 'America/Denver')::date - 30;
    PERFORM * FROM public.v_dashboard_relay_day d WHERE d.date >= (now() AT TIME ZONE 'America/Denver')::date - 3;
    PERFORM * FROM public.v_dashboard_gap_replay q WHERE q.received_at > now() - interval '30 days';
END $dashboard$;

SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $ingestor$
BEGIN
    BEGIN
        PERFORM 1 FROM public.v_dashboard_review LIMIT 1;
        RAISE EXCEPTION '320 the ingestor runtime read v_dashboard_review';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM 1 FROM public.v_dashboard_relay_day LIMIT 1;
        RAISE EXCEPTION '320 the ingestor runtime read v_dashboard_relay_day';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM 1 FROM public.v_dashboard_gap_replay LIMIT 1;
        RAISE EXCEPTION '320 the ingestor runtime read v_dashboard_gap_replay';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $ingestor$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('projection_columns_exact', 'projection_owner_and_grants_exact',
                               'projections_unreadable_by_api_mcp_and_public', 'dashboard_login_attests',
                               'dashboard_login_no_base_tables', 'dashboard_login_reads_review',
                               'dashboard_login_reads_relay_day', 'dashboard_login_reads_gap_replay',
                               'ingestor_runtime_refused'),
    'all_passed', true,
    'attested', json_build_object('dashboard', true))::text;
