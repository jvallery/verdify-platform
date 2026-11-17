-- Run only inside an explicit rollback-only transaction after exact317 (#1633, host release 5; #1734), as the superuser
-- owner: scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. It checks
-- that no replaced band reader reads the settings ledger, the retired settings or the zone-informed house band any
-- more; that fn_band_timeline keeps its 56 columns and puts the served band and the law's lines on the live rows; that
-- v_greenhouse_state carries the served band; that v_setpoint_forward is gone; that the schedule's readback counts read
-- NULL with every schedule value unchanged in type; that the counter check has its two new columns and the early-record
-- rule; that the daily relay record's run columns carry their definitions; and that every grant stayed. As the ingestor
-- login it runs the heat-staging alert's function and reads the schedule and the counter check; as the MCP login it
-- runs the day scorecard for yesterday; as the dashboard login it reads the counter check. Every read is bounded.
-- The last line reports the result to the qualifier.
DO $catalog$
DECLARE
    fn text;
BEGIN
    IF to_regclass('public.v_setpoint_forward') IS NOT NULL THEN RAISE EXCEPTION '317 left v_setpoint_forward'; END IF;
    FOREACH fn IN ARRAY ARRAY['public.fn_band_timeline(timestamptz,timestamptz,interval,text)',
                              'public.fn_climate_action_effectiveness(interval)',
                              'public.fn_climate_action_daily_scorecard(date)',
                              'public.fn_heat_staging_inversion()'] LOOP
        IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(fn)
                AND (p.prosrc ~ '(fn_setpoint_at|setpoint_changes|setpoint_snapshot\s+WHERE\s+parameter|fn_timeline_setpoint_value|fn_house_vpd_control_band)'
                     OR p.prosrc !~ 'fn_band_setpoints'))
            OR to_regprocedure(fn) IS NULL
        THEN RAISE EXCEPTION '317: % still reads a retired band source', fn; END IF;
    END LOOP;
    IF pg_catalog.pg_get_viewdef('public.v_greenhouse_state'::regclass) ~ 'fn_setpoint_at'
        OR pg_catalog.pg_get_viewdef('public.v_heating_staging'::regclass) ~ 'fn_setpoint_at'
        OR pg_catalog.pg_get_viewdef('public.v_greenhouse_state'::regclass) !~ 'fn_band_setpoints'
        OR pg_catalog.pg_get_viewdef('public.v_heating_staging'::regclass) !~ 'fn_band_setpoints'
    THEN RAISE EXCEPTION '317 views still read the settings ledger'; END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_proc p, LATERAL unnest(p.proargmodes) m
          WHERE p.oid='public.fn_band_timeline(timestamptz,timestamptz,interval,text)'::regprocedure AND m='t') <> 56
    THEN RAISE EXCEPTION '317 changed fn_band_timeline''s columns'; END IF;
    IF (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
          WHERE a.attrelid='public.v_relay_counter_reconciliation_daily'::regclass AND a.attnum>0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY['date', 'greenhouse_id', 'equipment', 'counter_starts', 'record_starts',
                               'starts_difference', 'counter_run_s', 'record_run_s', 'run_s_difference', 'counter_rows',
                               'comparison', 'boots', 'record_computed_at']
        OR pg_catalog.pg_get_viewdef('public.v_relay_counter_reconciliation_daily'::regclass) !~ 'record_early'
    THEN RAISE EXCEPTION '317 counter check is not exact'; END IF;
    IF pg_catalog.col_description('public.daily_relay_record'::regclass,
            (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid='public.daily_relay_record'::regclass
               AND attname='run_s')) !~ '^The relay''s daily run time'
        OR pg_catalog.col_description('public.daily_relay_record'::regclass,
            (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid='public.daily_relay_record'::regclass
               AND attname='event_run_s')) !~ '^Diagnostic only'
    THEN RAISE EXCEPTION '317 run columns lack their definitions'; END IF;
    IF NOT has_table_privilege('verdify_ingestor_runtime', 'public.v_relay_counter_reconciliation_daily', 'SELECT')
        OR NOT has_table_privilege('verdify_dashboard_runtime', 'public.v_relay_counter_reconciliation_daily', 'SELECT')
        OR NOT has_table_privilege('verdify_ingestor_runtime', 'public.v_irrigation_schedule_current', 'SELECT')
        OR NOT has_function_privilege('verdify_ingestor_runtime', 'public.fn_heat_staging_inversion()', 'EXECUTE')
        OR NOT has_function_privilege('verdify_mcp_runtime', 'public.fn_climate_action_daily_scorecard(date)', 'EXECUTE')
        OR NOT has_function_privilege('verdify_grafana_runtime',
            'verdify_grafana_runtime.fn_band_timeline(timestamptz,timestamptz,interval,text)', 'EXECUTE')
        OR to_regclass('public.v_heating_staging_summary') IS NULL
        OR to_regclass('public.v_heat_in_band_7d') IS NULL
        OR to_regclass('public.v_climate_action_daily_scorecard') IS NULL
    THEN RAISE EXCEPTION '317 lost a grant or a dependant'; END IF;
END $catalog$;

-- The live rows: the last hour of the timeline on a 30-minute step, and the last 10 minutes of v_greenhouse_state.
DO $values$
DECLARE
    bad integer;
    n integer;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE
               t.projected_vpd_low IS DISTINCT FROM b.vpd_low OR t.projected_vpd_high IS DISTINCT FROM b.vpd_high
            OR t.projected_temp_low IS DISTINCT FROM b.temp_low OR t.crop_vpd_low IS DISTINCT FROM b.vpd_low
            OR t.temp_heat_on_below_f IS DISTINCT FROM t.firmware_temp_low + 3.5
            OR t.temp_heat2_on_below_f IS DISTINCT FROM t.firmware_temp_low + 0.5
            OR t.temp_cool_on_above_f IS DISTINCT FROM t.firmware_temp_high
            OR t.vpd_humidify_on_above_kpa IS DISTINCT FROM t.firmware_vpd_high
            OR t.vpd_dehum_on_below_kpa IS DISTINCT FROM t.firmware_vpd_low + 0.05
            OR t.sw_fsm_controller_enabled IS NOT NULL OR t.temp_hysteresis_f IS NOT NULL
            OR t.firmware_temp_low IS NULL)
      INTO n, bad
      FROM public.fn_band_timeline(now() - interval '1 hour', now(), interval '30 minutes', 'vallery') t
      CROSS JOIN LATERAL public.fn_band_setpoints(t.ts) b;
    IF n <> 3 OR bad <> 0 THEN RAISE EXCEPTION '317 timeline rows: % of % wrong', bad, n; END IF;
    SELECT count(*), count(*) FILTER (WHERE
               g.sp_temp_low IS DISTINCT FROM b.temp_low OR g.sp_temp_high IS DISTINCT FROM b.temp_high
            OR g.sp_vpd_low IS DISTINCT FROM b.vpd_low OR g.sp_vpd_high IS DISTINCT FROM b.vpd_high
            OR g.sp_bias_cool IS NOT NULL OR g.sp_mister_engage IS NOT NULL
            OR g.temp_in_band IS DISTINCT FROM (g.temp_avg BETWEEN b.temp_low AND b.temp_high))
      INTO n, bad
      FROM public.v_greenhouse_state g
      CROSS JOIN LATERAL public.fn_band_setpoints(g.ts) b
     WHERE g.ts > now() - interval '10 minutes';
    IF n = 0 OR bad <> 0 THEN RAISE EXCEPTION '317 greenhouse state rows: % of % wrong', bad, n; END IF;
    IF EXISTS(SELECT 1 FROM public.v_irrigation_schedule_current
               WHERE stale_readback_count IS NOT NULL OR readback_drift_count IS NOT NULL)
        OR (SELECT count(*) FROM public.v_irrigation_schedule_current) <> 2
    THEN RAISE EXCEPTION '317 schedule readback counts are not NULL'; END IF;
END $values$;

-- SET SESSION AUTHORIZATION needs the superuser owner; the rollback undoes it.
SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $ingestor$
BEGIN
    PERFORM * FROM public.fn_heat_staging_inversion();
    PERFORM 1 FROM public.v_irrigation_schedule_current LIMIT 1;
    PERFORM 1 FROM public.v_relay_counter_reconciliation_daily
      WHERE greenhouse_id = 'vallery' AND comparison = 'complete'
        AND date = (now() AT TIME ZONE 'America/Denver')::date - 1;
END $ingestor$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_mcp_runtime_login;
DO $mcp$
BEGIN
    PERFORM 1 FROM public.fn_climate_action_daily_scorecard((now() AT TIME ZONE 'America/Denver')::date - 1) LIMIT 1;
END $mcp$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;
DO $dashboard$
BEGIN
    PERFORM 1 FROM public.v_relay_counter_reconciliation_daily LIMIT 1;
END $dashboard$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('setpoint_forward_dropped', 'functions_read_the_served_band',
                               'views_read_the_served_band', 'timeline_keeps_56_columns', 'counter_check_exact',
                               'run_columns_defined', 'grants_and_dependants_kept', 'timeline_rows_on_the_law',
                               'greenhouse_state_rows_on_the_band', 'schedule_readback_counts_null',
                               'ingestor_reads_its_objects', 'mcp_runs_the_scorecard', 'dashboard_reads_counter_check'),
    'all_passed', true)::text;
