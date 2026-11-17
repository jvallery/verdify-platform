-- Run only inside an explicit rollback-only transaction after exact315 (#1633, host release 4), as the superuser owner:
-- scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. It checks the three
-- health columns and the ingestor duty's facade INSERT on them, the readers kept on the two redefined views, and that
-- only the dashboard and ingestor duties read the counter check. As the ingestor login it writes one diagnostics row with the three
-- columns. It then proves, with rows the rollback discards: a replayed quarter takes its minutes out of the trust
-- ledger's 24 h gap hours; a fully replayed gap leaves a day complete, a whole-day gap cut by a replayed quarter reads
-- partial and the same gap without it no_data; three counter rows (one a restart's step back) add their deltas to
-- today's check. The last line reports the result to the qualifier.
DO $catalog$
DECLARE
    ing text := 'verdify_ingestor_runtime';
    facade text := 'public.v_runtime_diagnostics_write';
    recon text := 'public.v_relay_counter_reconciliation_daily';
    col text;
BEGIN
    IF (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
          FROM pg_attribute a
         WHERE a.attrelid = 'public.diagnostics'::regclass AND a.attnum > 0 AND NOT a.attisdropped
           AND a.attname IN ('loop_stack_high_water_b', 'wifi_disconnect_count', 'api_client_count'))
       IS DISTINCT FROM ARRAY['loop_stack_high_water_b:integer', 'wifi_disconnect_count:integer',
                              'api_client_count:integer']
    THEN RAISE EXCEPTION '315 diagnostics columns are not exact'; END IF;
    FOREACH col IN ARRAY ARRAY['loop_stack_high_water_b', 'wifi_disconnect_count', 'api_client_count',
                               'sensor_degraded_active', 'ts'] LOOP
        IF NOT has_column_privilege(ing, facade, col, 'INSERT') THEN
            RAISE EXCEPTION '315 facade insert of % is missing', col;
        END IF;
    END LOOP;
    IF has_table_privilege(ing, 'public.diagnostics', 'INSERT,UPDATE,DELETE,TRUNCATE')
        OR NOT has_table_privilege('verdify_dashboard_runtime', recon, 'SELECT')
        OR has_table_privilege('verdify_dashboard_runtime', recon, 'INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_table_privilege('verdify_api_runtime_login', recon, 'SELECT')
        OR NOT has_table_privilege(ing, recon, 'SELECT')
        OR has_table_privilege(ing, recon, 'INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_table_privilege('verdify_mcp_runtime', recon, 'SELECT')
        OR has_table_privilege('public', recon, 'SELECT')
    THEN RAISE EXCEPTION '315 access is not exact'; END IF;
    -- CREATE OR REPLACE kept the readers of the two redefined views.
    IF NOT has_table_privilege('verdify_api_runtime', 'public.v_data_trust_ledger', 'SELECT')
        OR NOT has_table_privilege('verdify_dashboard_runtime', 'public.v_irrigation_day_coverage', 'SELECT')
        OR NOT has_table_privilege('verdify_mcp_runtime', 'public.v_irrigation_day_coverage', 'SELECT')
        OR NOT has_table_privilege(ing, 'public.v_irrigation_day_coverage', 'SELECT')
    THEN RAISE EXCEPTION '315 redefined views lost a reader'; END IF;
    IF (SELECT count(DISTINCT r.ev_class) FROM pg_rewrite r JOIN pg_depend d ON d.objid = r.oid
         WHERE r.ev_class IN ('public.v_data_trust_ledger'::regclass, 'public.v_irrigation_day_coverage'::regclass)
           AND d.refobjid = 'public.v_data_gaps_unreplayed'::regclass) <> 2
        OR EXISTS(SELECT 1 FROM pg_rewrite r JOIN pg_depend d ON d.objid = r.oid
         WHERE r.ev_class IN ('public.v_data_trust_ledger'::regclass, 'public.v_irrigation_day_coverage'::regclass)
           AND d.refobjid = 'public.data_gaps'::regclass)
    THEN RAISE EXCEPTION '315 views do not read the replay-aware gaps alone'; END IF;
END $catalog$;

-- SET SESSION AUTHORIZATION needs the superuser owner; the rollback undoes it.
SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $ingestor$
BEGIN
    INSERT INTO public.v_runtime_diagnostics_write
        (ts, greenhouse_id, loop_stack_high_water_b, wifi_disconnect_count, api_client_count)
    VALUES (date_trunc('minute', now()) - interval '1 minute', 'vallery', 3120, 2, 3);
    -- The spool's admission path: a full diagnostics payload with the three keys is admitted (DISPATCHER-01).
    IF NOT public.fn_record_observational_source_event(
        gen_random_uuid(), 'diagnostics', date_trunc('minute', now()) - interval '2 minutes', 'vallery',
        gen_random_uuid(), 0,
        '{"wifi_rssi": -60, "sensor_degraded_active": 0, "restart_count": 7, "loop_stack_high_water_b": 3120,
          "wifi_disconnect_count": 2, "api_client_count": 3, "gap_log_state": null}'::jsonb) THEN
        RAISE EXCEPTION '315 spool did not admit the diagnostics payload';
    END IF;
END $ingestor$;

-- RS-6 and READERS-5: no plan reads as in force; the schedule view's 2 h readback rule.
DO $plans$
BEGIN
    IF EXISTS(SELECT 1 FROM public.setpoint_plan WHERE is_active)
        OR EXISTS(SELECT 1 FROM public.planner_trigger_ledger WHERE status IN ('expected', 'delivered'))
        OR pg_get_viewdef('public.v_irrigation_schedule_current'::regclass) NOT LIKE '%''02:00:00''::interval%'
        OR NOT has_table_privilege('verdify_ingestor_runtime', 'public.v_irrigation_schedule_current', 'SELECT')
    THEN RAISE EXCEPTION '315 plans or schedule view not as expected'; END IF;
END $plans$;
RESET SESSION AUTHORIZATION;

-- AF10, the ledger: a one-hour gap (in the future, so no real replayed quarter overlaps it) with one replayed quarter
-- adds 0.75 h, not 1 h, to data_gap_hours_24h.
DO $ledger$
DECLARE
    t0 timestamptz := date_trunc('minute', now()) + interval '30 days';
    before numeric;
    after numeric;
BEGIN
    SELECT metric_value INTO before FROM public.v_data_trust_ledger WHERE check_name = 'data_gap_hours_24h';
    INSERT INTO public.data_gaps (start_ts, end_ts, duration_s, reason, backfill_status)
    VALUES (t0, t0 + interval '1 hour', 3600, 'ingestor_restart', 'snapshot_taken');
    INSERT INTO public.gap_replay_quarters (boot, qseq, first_ts, last_ts, climate_rows, transition_rows, format_version)
    VALUES (3150001, 1, t0 + interval '15 minutes', t0 + interval '29 minutes', 15, 0, 2);
    SELECT metric_value INTO after FROM public.v_data_trust_ledger WHERE check_name = 'data_gap_hours_24h';
    IF before IS NULL OR after IS NULL OR abs((after - before) - 0.75) > 0.01 THEN
        RAISE EXCEPTION '315 data_gap_hours_24h counts replayed minutes (before %, after %)', before, after;
    END IF;
END $ledger$;

-- AF10, the coverage: on the newest past complete day, a fully replayed gap keeps it complete, a whole-day gap cut by
-- that replayed quarter reads partial, and the same gap without the quarter reads no_data.
DO $coverage$
DECLARE
    d date;
    ds timestamptz;
    de timestamptz;
    got text;
BEGIN
    SELECT c.local_day INTO d FROM public.v_irrigation_day_coverage c
     WHERE c.greenhouse_id = 'vallery' AND c.coverage = 'complete'
       AND c.local_day < (now() AT TIME ZONE 'America/Denver')::date - 1
     ORDER BY c.local_day DESC LIMIT 1;
    IF d IS NULL THEN RAISE EXCEPTION '315 coverage fixture found no complete day'; END IF;
    ds := d::timestamp AT TIME ZONE 'America/Denver';
    de := (d + 1)::timestamp AT TIME ZONE 'America/Denver';
    IF EXISTS(SELECT 1 FROM public.gap_replay_quarters q WHERE q.first_ts < de + interval '2 hours'
                 AND q.last_ts > ds - interval '2 hours' AND q.boot <> 3150001) THEN
        RAISE EXCEPTION '315 coverage fixture day % already has replayed quarters', d;
    END IF;
    INSERT INTO public.data_gaps (start_ts, end_ts, duration_s, reason, backfill_status)
    VALUES (ds + interval '10 hours', ds + interval '10 hours 15 minutes', 900, 'ingestor_restart', 'snapshot_taken');
    INSERT INTO public.gap_replay_quarters (boot, qseq, first_ts, last_ts, climate_rows, transition_rows, format_version)
    VALUES (3150001, 2, ds + interval '10 hours', ds + interval '10 hours 14 minutes', 15, 0, 2);
    SELECT coverage INTO got FROM public.v_irrigation_day_coverage WHERE greenhouse_id = 'vallery' AND local_day = d;
    IF got IS DISTINCT FROM 'complete' THEN
        RAISE EXCEPTION '315 a fully replayed gap made % read %', d, got;
    END IF;
    INSERT INTO public.data_gaps (start_ts, end_ts, duration_s, reason, backfill_status)
    VALUES (ds - interval '1 hour', de + interval '1 hour', extract(epoch FROM (de - ds) + interval '2 hours'),
            'ingestor_restart', 'snapshot_taken');
    SELECT coverage INTO got FROM public.v_irrigation_day_coverage WHERE greenhouse_id = 'vallery' AND local_day = d;
    IF got IS DISTINCT FROM 'partial' THEN
        RAISE EXCEPTION '315 a whole-day gap cut by a replayed quarter made % read %', d, got;
    END IF;
    DELETE FROM public.gap_replay_quarters WHERE boot = 3150001 AND qseq = 2;
    SELECT coverage INTO got FROM public.v_irrigation_day_coverage WHERE greenhouse_id = 'vallery' AND local_day = d;
    IF got IS DISTINCT FROM 'no_data' THEN
        RAISE EXCEPTION '315 a whole-day unreplayed gap made % read %', d, got;
    END IF;
END $coverage$;

-- AF7: the six counted relays, run seconds for the fans only, and today's deltas: +5, a restart's step back (0), +2.
DO $counters$
DECLARE
    last_ts timestamptz;
    last_v jsonb;
    gh text;
    h bigint;
    s bigint;
    starts_before bigint;
    run_before bigint;
    starts_after bigint;
    run_after bigint;
    t0 timestamptz;
BEGIN
    IF (SELECT array_agg(DISTINCT equipment ORDER BY equipment) FROM public.v_relay_counter_reconciliation_daily)
        IS DISTINCT FROM ARRAY['fan1', 'fan2', 'fog', 'heat1', 'heat2', 'vent']
        OR EXISTS(SELECT 1 FROM public.v_relay_counter_reconciliation_daily
                   WHERE (counter_run_s IS NOT NULL) <> (equipment IN ('fan1', 'fan2')))
        OR (SELECT min(date) FROM public.v_relay_counter_reconciliation_daily) <> DATE '2026-11-16'
    THEN RAISE EXCEPTION '315 counter check relays or days are not exact'; END IF;
    SELECT s0.ts, s0.value::jsonb, s0.greenhouse_id INTO last_ts, last_v, gh
      FROM public.system_state s0
     WHERE s0.entity = 'relay_counters' AND s0.ts >= TIMESTAMPTZ '2026-11-16 19:48:00+00'
     ORDER BY s0.ts DESC LIMIT 1;
    IF last_v IS NULL THEN RAISE EXCEPTION '315 counter fixture found no relay_counters row'; END IF;
    h := (last_v ->> 'h2')::bigint;
    s := (last_v ->> 'f1s')::bigint;
    SELECT counter_starts INTO starts_before FROM public.v_relay_counter_reconciliation_daily
     WHERE greenhouse_id = COALESCE(gh, 'vallery') AND equipment = 'heat2'
       AND date = (now() AT TIME ZONE 'America/Denver')::date;
    SELECT counter_run_s INTO run_before FROM public.v_relay_counter_reconciliation_daily
     WHERE greenhouse_id = COALESCE(gh, 'vallery') AND equipment = 'fan1'
       AND date = (now() AT TIME ZONE 'America/Denver')::date;
    t0 := GREATEST(last_ts, now());
    INSERT INTO public.system_state (ts, entity, value, greenhouse_id) VALUES
        (t0 + interval '1 millisecond', 'relay_counters',
         jsonb_set(jsonb_set(last_v, '{h2}', to_jsonb(h + 5)), '{f1s}', to_jsonb(s + 100))::text, gh),
        (t0 + interval '2 milliseconds', 'relay_counters',
         jsonb_set(jsonb_set(last_v, '{h2}', to_jsonb(h + 2)), '{f1s}', to_jsonb(s + 100))::text, gh),
        (t0 + interval '3 milliseconds', 'relay_counters',
         jsonb_set(jsonb_set(last_v, '{h2}', to_jsonb(h + 4)), '{f1s}', to_jsonb(s + 160))::text, gh);
    SELECT counter_starts INTO starts_after FROM public.v_relay_counter_reconciliation_daily
     WHERE greenhouse_id = COALESCE(gh, 'vallery') AND equipment = 'heat2'
       AND date = (now() AT TIME ZONE 'America/Denver')::date;
    SELECT counter_run_s INTO run_after FROM public.v_relay_counter_reconciliation_daily
     WHERE greenhouse_id = COALESCE(gh, 'vallery') AND equipment = 'fan1'
       AND date = (now() AT TIME ZONE 'America/Denver')::date;
    IF starts_after - starts_before <> 7 OR run_after - run_before <> 160 THEN
        RAISE EXCEPTION '315 counter deltas are not exact (starts % to %, run % to %)',
            starts_before, starts_after, run_before, run_after;
    END IF;
END $counters$;

SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;
DO $dashboard$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.v_relay_counter_reconciliation_daily) THEN
        RAISE EXCEPTION '315 dashboard login reads no counter check row';
    END IF;
END $dashboard$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('three_diagnostics_columns_typed', 'ingestor_inserts_the_three_through_the_facade',
                               'counter_check_dashboard_and_ingestor_only', 'redefined_views_keep_readers',
                               'views_read_replay_aware_gaps', 'ingestor_login_writes_health_row',
                               'ledger_gap_hours_exclude_replayed_minutes', 'coverage_complete_when_fully_replayed',
                               'coverage_partial_when_cut_by_replay', 'coverage_no_data_without_replay',
                               'counter_check_six_relays_fans_run', 'counter_deltas_skip_restart_step_back',
                               'dashboard_login_reads_counter_check', 'spool_admits_the_three_keys',
                               'no_active_plan', 'no_open_trigger_ledger_row', 'schedule_readbacks_two_hours'),
    'all_passed', true)::text;
