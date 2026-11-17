-- Run only inside an explicit rollback-only transaction after exact316 (#1633, host release 4), as the superuser owner:
-- scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. It checks that
-- every dropped object and role is gone and that what stays is still there: the two control_experiments trigger guards,
-- the collector's three functions, planner_inference_runs without its foreign key into planner_pack, v_active_plan and
-- fn_house_vpd_control_band, and no runtime role writing setpoint_plan. As the collector login it runs the ingestor's
-- release 4 attestation (two required functions, the direct-snapshot function tolerated, nothing else); as the
-- ingestor login it reads v_irrigation_schedule_current (which reads v_active_plan); as the dashboard login it reads
-- v_planner_inference_runs.
-- The last line reports the result to the qualifier.
DO $catalog$
DECLARE
    collector text := 'verdify_experiment_equipment_source_collector';
BEGIN
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace
            AND (c.relname LIKE 'experiment\_v2\_%' OR c.relname LIKE 'v\_experiment\_v2\_%'
                 OR c.relname IN ('twin_decisions', 'twin_live_results', 'firmware_twin_divergence',
                                  'planner_graph_runs', 'planner_memory_items', 'planner_memory_retrievals',
                                  'planner_pack', 'forecast_deviation_thresholds', 'v_policy_twin_asof_input',
                                  'v_planner_experiments', 'v_planner_experiment_events', 'v_planner_assignments',
                                  'v_iris_experiment_context', 'v_runtime_v1_iris_experiment_context')))
    THEN RAISE EXCEPTION '316 left a dropped relation'; END IF;
    IF (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_catalog.pg_proc p
          WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn\_experiment\_v2\_%')
        IS DISTINCT FROM ARRAY['fn_experiment_v2_control_guard', 'fn_experiment_v2_require_end_recovery_completion']
    THEN RAISE EXCEPTION '316 function set is not exact'; END IF;
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN (
            'verdify_experiment_lifecycle', 'verdify_experiment_component_executor',
            'verdify_experiment_shadow_scheduler', 'verdify_experiment_randomizer', 'verdify_experiment_outcome_freezer',
            'verdify_experiment_blinded_analyst', 'verdify_experiment_v2_lifecycle_login',
            'verdify_experiment_v2_component_executor_login', 'verdify_experiment_v2_shadow_scheduler_login',
            'verdify_experiment_v2_randomizer_login', 'verdify_experiment_v2_outcome_freezer_login', 'twin_ro',
            'verdify_twin_ro'))
    THEN RAISE EXCEPTION '316 left a dropped role'; END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.control_experiments'::regclass
            AND tgname IN ('trg_experiment_v2_control_guard', 'trg_experiment_v2_end_recovery_completion')) <> 2
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='verdify_experiment_v2_owner')
        OR to_regclass('public.equipment_direct_state_snapshots') IS NULL
        OR to_regclass('public.equipment_counter_samples') IS NULL
        OR to_regclass('public.equipment_state_source_receipts') IS NULL
        OR to_regclass('public.v_active_plan') IS NULL
        OR to_regclass('public.v_irrigation_schedule_current') IS NULL
        OR to_regclass('public.v_planner_inference_runs') IS NULL
        OR to_regclass('public.forecast_action_rules') IS NULL
        OR to_regclass('public.control_experiments') IS NULL
        OR to_regclass('public.policy_templates') IS NULL
        OR to_regprocedure('public.fn_house_vpd_control_band(timestamptz)') IS NULL
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conname='planner_inference_runs_pack_sha256_fkey')
    THEN RAISE EXCEPTION '316 dropped something that stays'; END IF;
    IF NOT has_function_privilege(collector,
            'public.fn_record_equipment_counter_sample(uuid,timestamptz,text,text,text,double precision,text,uuid,double precision,uuid,bigint,text)',
            'EXECUTE')
        OR NOT has_function_privilege(collector,
            'public.fn_record_equipment_direct_state_snapshot(uuid,uuid,text,text,jsonb,double precision,uuid,bigint,text)',
            'EXECUTE')
        OR NOT has_function_privilege(collector,
            'public.fn_record_equipment_state_source_receipt(uuid,timestamptz,text,text,jsonb,boolean,uuid,bigint,text)',
            'EXECUTE')
        OR has_function_privilege(collector, 'public.fn_experiment_v2_control_guard()', 'EXECUTE')
        OR has_function_privilege(collector, 'public.fn_experiment_v2_require_end_recovery_completion()', 'EXECUTE')
    THEN RAISE EXCEPTION '316 collector access is not exact'; END IF;
    -- No runtime role writes setpoint_plan; the MCP duty and the readers keep SELECT.
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE NOT r.rolsuper AND r.rolname !~ '^pg_'
            AND (has_table_privilege(r.oid, 'public.setpoint_plan', 'INSERT,UPDATE,DELETE,TRUNCATE')
                 OR has_any_column_privilege(r.oid, 'public.setpoint_plan', 'INSERT,UPDATE')))
        OR NOT has_table_privilege('verdify_mcp_runtime', 'public.setpoint_plan', 'SELECT')
        OR NOT has_table_privilege('verdify_api_runtime', 'public.setpoint_plan', 'SELECT')
        OR NOT has_table_privilege('verdify_ingestor_runtime', 'public.setpoint_plan', 'SELECT')
    THEN RAISE EXCEPTION '316 setpoint_plan access is not exact'; END IF;
END $catalog$;

-- The ingestor's release 4 collector attestation, as the collector login: the two required functions, the
-- direct-snapshot function tolerated, no other experiment, collector or SECURITY DEFINER function.
SET SESSION AUTHORIZATION verdify_experiment_v2_equipment_source_collector_login;
DO $collector$
BEGIN
    IF EXISTS(
            SELECT 1 FROM unnest(ARRAY[
                'public.fn_record_equipment_counter_sample(uuid,timestamp with time zone,text,text,text,double precision,text,uuid,double precision,uuid,bigint,text)',
                'public.fn_record_equipment_state_source_receipt(uuid,timestamp with time zone,text,text,jsonb,boolean,uuid,bigint,text)'
            ]) required(sig)
             WHERE to_regprocedure(required.sig) IS NULL
                OR NOT has_function_privilege(current_user, to_regprocedure(required.sig), 'EXECUTE'))
        OR EXISTS(
            SELECT 1 FROM pg_catalog.pg_proc candidate
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid = candidate.pronamespace
             WHERE namespace.nspname = 'public'
               AND (candidate.proname LIKE 'fn_experiment_v2_%' OR candidate.proname LIKE 'fn_record_equipment_%'
                    OR candidate.prosecdef)
               AND has_function_privilege(current_user, candidate.oid, 'EXECUTE')
               AND candidate.oid NOT IN (
                   'public.fn_record_equipment_counter_sample(uuid,timestamp with time zone,text,text,text,double precision,text,uuid,double precision,uuid,bigint,text)'::regprocedure,
                   'public.fn_record_equipment_state_source_receipt(uuid,timestamp with time zone,text,text,jsonb,boolean,uuid,bigint,text)'::regprocedure,
                   'public.fn_record_equipment_direct_state_snapshot(uuid,uuid,text,text,jsonb,double precision,uuid,bigint,text)'::regprocedure))
    THEN RAISE EXCEPTION '316 collector attestation fails'; END IF;
END $collector$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $ingestor$
BEGIN
    PERFORM 1 FROM public.v_irrigation_schedule_current LIMIT 1;
END $ingestor$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;
DO $dashboard$
BEGIN
    PERFORM 1 FROM public.v_planner_inference_runs LIMIT 1;
END $dashboard$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('dropped_relations_gone', 'only_the_two_trigger_guards_remain', 'dropped_roles_gone',
                               'kept_objects_present', 'planner_inference_runs_fk_gone', 'collector_access_exact',
                               'no_runtime_writes_setpoint_plan',
                               'collector_login_release4_attestation', 'ingestor_reads_irrigation_schedule',
                               'dashboard_reads_planner_inference_runs'),
    'all_passed', true)::text;
