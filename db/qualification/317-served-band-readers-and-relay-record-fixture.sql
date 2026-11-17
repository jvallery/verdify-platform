-- Run only inside an explicit rollback-only transaction after exact317 (#1633, host release 5; #1734), as the superuser
-- owner: scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. It checks
-- that no replaced band reader reads the settings ledger, the retired settings or the zone-informed house band any
-- more; that fn_band_timeline keeps its 56 columns and puts the served band and the law's lines on the live rows; that
-- v_greenhouse_state carries the served band; that v_setpoint_forward is gone; that the schedule's readback counts read
-- NULL with every schedule value unchanged in type; that the counter check has its two new columns and the early-record
-- rule; that the daily relay record's run columns carry their definitions; that fn_house_vpd_control_band keeps its 13
-- columns and returns the served band (the setpoint server's wrapper too); that yesterday's daily record, stored
-- again here (rolled back, about 15 s), carries the law's refused drying; and that every grant stayed. As the ingestor
-- login it runs the heat-staging alert's function and the house band and reads the schedule and the counter check; as
-- the MCP login it runs the day scorecard for yesterday and the house band; as the dashboard login it reads the counter
-- check; as the Grafana login it runs the lab panels' review query. Every read is bounded.
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
        OR NOT has_function_privilege('verdify_api_runtime', 'public.fn_house_vpd_control_band(timestamptz)', 'EXECUTE')
        OR NOT has_function_privilege('verdify_ingestor_runtime', 'public.fn_house_vpd_control_band(timestamptz)', 'EXECUTE')
        OR NOT has_function_privilege('verdify_mcp_runtime', 'public.fn_house_vpd_control_band(timestamptz)', 'EXECUTE')
        OR NOT has_function_privilege('verdify_setpoint_server_runtime',
            'verdify_setpoint_server_runtime.fn_house_vpd_control_band(timestamptz)', 'EXECUTE')
        OR NOT has_function_privilege('verdify_matview_refresh_runtime',
            'verdify_matview_refresh_runtime.fn_refresh_daily_record()', 'EXECUTE')
        OR has_function_privilege('verdify_ingestor_runtime', 'public.fn_daily_record_store(date)', 'EXECUTE')
        OR NOT has_table_privilege('verdify_ingestor_runtime', 'public.daily_record', 'SELECT')
        OR NOT has_table_privilege('verdify_dashboard_runtime', 'public.daily_record', 'SELECT')
        OR to_regclass('public.v_band_device_divergence') IS NULL
    THEN RAISE EXCEPTION '317 lost a grant or a dependant'; END IF;
    IF (SELECT array_agg(a ORDER BY o) FROM pg_catalog.pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY u(a, m, o)
          WHERE p.oid='public.fn_house_vpd_control_band(timestamptz)'::regprocedure AND u.m='t')
        IS DISTINCT FROM ARRAY['crop_vpd_low', 'crop_vpd_high', 'vpd_target_south', 'vpd_target_west', 'vpd_target_east',
                               'vpd_target_center', 'zone_vpd_min', 'zone_vpd_median', 'zone_vpd_max', 'house_vpd_low',
                               'house_vpd_high', 'house_vpd_min_width_kpa', 'house_vpd_low_margin_kpa']
        OR (SELECT p.prosrc FROM pg_catalog.pg_proc p
              WHERE p.oid='public.fn_house_vpd_control_band(timestamptz)'::regprocedure) !~ 'fn_band_setpoints'
    THEN RAISE EXCEPTION '317 house VPD band is not the served band''s shape'; END IF;
    IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_catalog.pg_attribute a
          WHERE a.attrelid='public.daily_record'::regclass AND a.attname='dry_refusal' AND NOT a.attisdropped)
        IS DISTINCT FROM 'jsonb'
        OR pg_catalog.col_description('public.daily_record'::regclass,
            (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid='public.daily_record'::regclass
               AND attname='dry_refusal')) !~ '^The climate law''s drying record'
        OR (SELECT p.prosrc FROM pg_catalog.pg_proc p
              WHERE p.oid='public.fn_daily_record_store(date)'::regprocedure) !~ 'climate_law_state'
    THEN RAISE EXCEPTION '317 daily record lacks the refused drying'; END IF;
    IF (SELECT array_agg(a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
          FROM pg_catalog.pg_attribute a
         WHERE a.attrelid='public.daily_record'::regclass AND NOT a.attisdropped
           AND a.attname IN ('drying_water_g', 'drying_heat_wh', 'drying_meter_lower_bound'))
        IS DISTINCT FROM ARRAY['drying_water_g double precision', 'drying_heat_wh double precision',
                               'drying_meter_lower_bound boolean']
        OR (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
              WHERE a.attrelid='public.v_daily_record'::regclass AND a.attnum>48 AND NOT a.attisdropped)
            IS DISTINCT FROM ARRAY['drying_water_g', 'drying_heat_wh', 'drying_meter_lower_bound']
        OR (SELECT p.prosrc FROM pg_catalog.pg_proc p
              WHERE p.oid='public.fn_daily_record_store(date)'::regprocedure) !~ 'climate_drying_meter'
        OR NOT has_table_privilege('verdify_ingestor_runtime', 'public.v_daily_record', 'SELECT')
    THEN RAISE EXCEPTION '317 daily record lacks the drying meter''s day'; END IF;
    IF (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
          WHERE a.attrelid=to_regclass('verdify_grafana_runtime.planner_review') AND a.attnum>0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY['id', 'kind', 'review_date', 'status', 'requested_at', 'written_at']
        OR (SELECT c.reloptions FROM pg_catalog.pg_class c WHERE c.oid='verdify_grafana_runtime.planner_review'::regclass)
            IS DISTINCT FROM ARRAY['security_barrier=true']
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
            WHERE c.oid='verdify_grafana_runtime.planner_review'::regclass AND a.grantee<>c.relowner
              AND (a.grantee<>'verdify_grafana_runtime'::regrole OR a.privilege_type<>'SELECT'))
        OR NOT has_table_privilege('verdify_grafana_runtime', 'verdify_grafana_runtime.planner_review', 'SELECT')
        OR has_table_privilege('verdify_grafana_runtime', 'public.planner_review', 'SELECT')
    THEN RAISE EXCEPTION '317 Grafana review facade is not exact'; END IF;
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
    -- The house VPD band at the last hour's half hours and now: the served band, the wrapper the same.
    SELECT count(*), count(*) FILTER (WHERE
               h.house_vpd_low IS DISTINCT FROM b.vpd_low OR h.house_vpd_high IS DISTINCT FROM b.vpd_high
            OR h.crop_vpd_low IS DISTINCT FROM b.vpd_low OR h.crop_vpd_high IS DISTINCT FROM b.vpd_high
            OR h.house_vpd_min_width_kpa IS NOT NULL OR h.house_vpd_low_margin_kpa IS NOT NULL
            OR (w.house_vpd_low, w.house_vpd_high) IS DISTINCT FROM (h.house_vpd_low, h.house_vpd_high))
      INTO n, bad
      FROM (VALUES (now() - interval '1 hour'), (now() - interval '30 minutes'), (now())) AS s(ts)
      CROSS JOIN LATERAL public.fn_band_setpoints(s.ts) b
      CROSS JOIN LATERAL public.fn_house_vpd_control_band(s.ts) h
      CROSS JOIN LATERAL verdify_setpoint_server_runtime.fn_house_vpd_control_band(s.ts) w;
    IF n <> 3 OR bad <> 0 THEN RAISE EXCEPTION '317 house VPD band rows: % of % wrong', bad, n; END IF;
    -- Yesterday stored again (the rollback undoes it): complete, with law records, and no more refused than wanted;
    -- the meter's day present (a meter row exists since the law flash, so a day without one of its own stores 0),
    -- never negative, flagged or not.
    SELECT count(*) FILTER (WHERE NOT r.complete OR r.dry_refusal IS NULL
               OR r.drying_water_g IS NULL OR r.drying_heat_wh IS NULL OR r.drying_meter_lower_bound IS NULL
               OR r.drying_water_g < 0 OR r.drying_heat_wh < 0
               OR (r.dry_refusal->>'covered_s')::numeric <= 0
               OR (r.dry_refusal->>'wanted_s')::numeric > (r.dry_refusal->>'covered_s')::numeric
               OR jsonb_typeof(r.dry_refusal->'refused_s') <> 'object'
               OR (SELECT COALESCE(sum(v::numeric), 0) FROM jsonb_each_text(r.dry_refusal->'refused_s') e(k, v))
                  > (r.dry_refusal->>'wanted_s')::numeric)
      INTO bad
      FROM public.fn_daily_record_store((now() AT TIME ZONE 'America/Denver')::date - 1) r;
    IF bad <> 0 THEN RAISE EXCEPTION '317 yesterday''s refused drying is not recorded'; END IF;
END $values$;

-- SET SESSION AUTHORIZATION needs the superuser owner; the rollback undoes it.
SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $ingestor$
BEGIN
    PERFORM * FROM public.fn_heat_staging_inversion();
    PERFORM house_vpd_low, house_vpd_high FROM public.fn_house_vpd_control_band(now());
    PERFORM 1 FROM public.v_irrigation_schedule_current LIMIT 1;
    PERFORM drying_water_g, drying_heat_wh, drying_meter_lower_bound FROM public.v_daily_record
      WHERE date > (now() AT TIME ZONE 'America/Denver')::date - 7;
    PERFORM 1 FROM public.v_relay_counter_reconciliation_daily
      WHERE greenhouse_id = 'vallery' AND comparison = 'complete'
        AND date = (now() AT TIME ZONE 'America/Denver')::date - 1;
END $ingestor$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_mcp_runtime_login;
DO $mcp$
BEGIN
    PERFORM 1 FROM public.fn_climate_action_daily_scorecard((now() AT TIME ZONE 'America/Denver')::date - 1) LIMIT 1;
    PERFORM house_vpd_low, house_vpd_high FROM public.fn_house_vpd_control_band(now());
END $mcp$;
RESET SESSION AUTHORIZATION;

-- The lab panels' two queries, unqualified as Grafana sends them. SET SESSION AUTHORIZATION does not apply the
-- login's role setting, so its search_path (268: verdify_grafana_runtime first) is set for the block and restored.
SET SESSION AUTHORIZATION verdify_grafana_runtime_login;
DO $grafana$
DECLARE
    saved text := pg_catalog.current_setting('search_path');
BEGIN
    PERFORM pg_catalog.set_config('search_path', 'verdify_grafana_runtime,pg_catalog,public,pg_temp', true);
    PERFORM review_date, written_at FROM planner_review
      WHERE kind = 'daily' AND status = 'written' ORDER BY review_date DESC LIMIT 1;
    PERFORM max(written_at) FROM planner_review WHERE kind = 'daily' AND status = 'written';
    IF to_regclass('planner_review') IS DISTINCT FROM 'verdify_grafana_runtime.planner_review'::regclass THEN
        RAISE EXCEPTION '317 Grafana login does not resolve planner_review to its facade';
    END IF;
    PERFORM pg_catalog.set_config('search_path', saved, true);
END $grafana$;
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
                               'house_vpd_band_shape', 'daily_record_refused_drying', 'daily_record_drying_meter', 'house_vpd_band_rows_served',
                               'yesterday_refused_drying_stored', 'ingestor_reads_its_objects',
                               'mcp_runs_the_scorecard', 'grafana_reads_the_review_facade',
                               'dashboard_reads_counter_check'),
    'all_passed', true)::text;
