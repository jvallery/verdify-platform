-- 316 (#1633, host release 4; contracts phase4-drops sections 0 to 3): the first drops of the climate refactor.
-- Group 1A and the part of group 1B whose last reader is gone at release 3's head: the confirmed-component
-- experiment v2 (40 tables, 5 views, 113 functions, the six duties and five logins H2 retired), the policy twin
-- (three empty hypertables, v_policy_twin_asof_input and the twin_ro/verdify_twin_ro read roles), the planner graph and
-- memory tables (empty), the shadow planner's planner_pack, forecast_deviation_thresholds, and the four views of the
-- retired planner experiment surface. Every table was archived first (Job verdify-phase4-archive-316 on the backup PVC,
-- kept two years on the NAS and offsite); the predecessor refuses unless each row count still equals the archived one.
-- Stays (each named in contracts r4-316-objects): group 1C; the two control_experiments trigger guards
-- fn_experiment_v2_control_guard and fn_experiment_v2_require_end_recovery_completion (the second reads dropped
-- tables, so a write to control_experiments now fails closed; nothing writes it); verdify_experiment_v2_owner, which owns
-- the live collector objects; equipment_direct_state_snapshots and fn_record_equipment_direct_state_snapshot with the
-- collector's EXECUTE (rule 5: release 4's code lets the two attestation lists accept it without requiring it, and a
-- later release revokes and drops it); planner_inference_runs and its view (only their foreign key into planner_pack
-- goes); forecast_action_rules; the planner roles; the generation 1 policy engine; v_active_plan (read by v_irrigation_schedule_current and Grafana site-irrigation) and
-- fn_house_vpd_control_band (read by MCP outcome_kpi). No kept function, view, trigger, constraint, default or policy
-- depends on a dropped object: the guard checks pg_depend and every kept function body before the first drop, every
-- DROP is RESTRICT, and the identity sequences and triggers go with their tables. Roles: REASSIGN OWNED, DROP OWNED (it
-- revokes twin_ro's grants), DROP ROLE.
-- MCP loses INSERT and UPDATE on setpoint_plan: no code path writes plans after release 3 (it keeps SELECT).
-- Seals: the dropped grants move the api, ingestor and MCP boundary digests; the successor literals are measured by the
-- rolled-back native qualification (tests/fixtures/316-experiment-v2-and-shadow-drops-native-qualification.json); until then the file
-- carries 315's values and its successor block refuses (fail closed). 316 chains from exact315.
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
DECLARE
    v_rel text;
    v_rows bigint;
    v_expected bigint;
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=315 AND filename='db/migrations/315-replayed-gaps-counter-check-and-health.sql'
            AND sha256='a5cadbc8645f7ee3fde65c41e8709b6dba6295dce1fa4f3406237f081dd49fff'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>315)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '7022e3a448569e051a81a19ff621bade902fab0b393c2e45756f7bb9449702dc'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '3ead905daede269bd598b38c86c0477d33e1b51c425a2efc7d5c16c042a745f2'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'ae8180a5fc5dc400fc0f9c49fc6f069c89af033a9b9425ef52a14bf85b202256'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        -- Exactly the reviewed objects exist: 48 tables, 11 views, 113 functions, 13 roles.
        OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'
            AND c.relname = ANY(
            ARRAY['experiment_v2_approvals', 'experiment_v2_bundle_attempts', 'experiment_v2_candidate_revisions',
                'experiment_v2_component_outcomes', 'experiment_v2_contract_constants', 'experiment_v2_day_evidence',
                'experiment_v2_delivery_bundle_completions', 'experiment_v2_delivery_bundles',
                'experiment_v2_direct_launch_waivers', 'experiment_v2_direct_proof_attempt_events',
                'experiment_v2_direct_proof_attempt_work', 'experiment_v2_direct_proof_authorizations',
                'experiment_v2_direct_proof_emergency_recovery_attempt_events',
                'experiment_v2_direct_proof_emergency_recovery_receipts',
                'experiment_v2_direct_proof_emergency_resolutions', 'experiment_v2_direct_proof_receipts',
                'experiment_v2_exports', 'experiment_v2_exposure_closures', 'experiment_v2_exposures',
                'experiment_v2_facility_safe_closures', 'experiment_v2_observation_epochs',
                'experiment_v2_observation_receipts', 'experiment_v2_outcome_freezes',
                'experiment_v2_outcome_source_bindings', 'experiment_v2_outcomes',
                'experiment_v2_preexposure_mismatch_epochs', 'experiment_v2_randomization', 'experiment_v2_reveals',
                'experiment_v2_runtime_faults', 'experiment_v2_runtime_generations',
                'experiment_v2_runtime_snapshots', 'experiment_v2_selector_choices',
                'experiment_v2_selector_contexts', 'experiment_v2_shadow_choices', 'experiment_v2_shadow_contexts',
                'experiment_v2_shadow_cycles', 'experiment_v2_shadow_outcome_previews',
                'experiment_v2_state_artifacts', 'experiment_v2_work', 'experiment_v2_work_events', 'twin_decisions',
                'twin_live_results', 'firmware_twin_divergence', 'planner_graph_runs', 'planner_memory_items',
                'planner_memory_retrievals', 'planner_pack', 'forecast_deviation_thresholds']))<>48
        OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='v'
            AND c.relname = ANY(
            ARRAY['v_experiment_v2_blinded_assigned_day_outcomes', 'v_experiment_v2_frozen_analyzer_input',
                'v_experiment_v2_revealed_analyzer_input', 'v_experiment_v2_selector_climate_source',
                'v_experiment_v2_selector_forecast_source', 'v_policy_twin_asof_input', 'v_planner_experiments',
                'v_planner_experiment_events', 'v_planner_assignments', 'v_iris_experiment_context',
                'v_runtime_v1_iris_experiment_context']))<>11
        OR (SELECT count(to_regprocedure('public.' || s)) FROM unnest(
            ARRAY['fn_experiment_v2_all_assignment_windows_bound(uuid,timestamp with time zone)',
                'fn_experiment_v2_api_status(uuid)', 'fn_experiment_v2_approval_insert_binding()',
                'fn_experiment_v2_assignment_uuid(uuid,text,date)',
                'fn_experiment_v2_assignment_window_is_bound(uuid,uuid,timestamp with time zone)',
                'fn_experiment_v2_begin_delivery_bundle(uuid,uuid,uuid,text,text,text)',
                'fn_experiment_v2_boundary_cycle(uuid,text)',
                'fn_experiment_v2_build_selector_context(uuid,date,timestamp with time zone,timestamp with time zone)',
                'fn_experiment_v2_claim_executor_candidate(uuid,text,bigint,text)',
                'fn_experiment_v2_close_exposure(uuid,text,text)', 'fn_experiment_v2_complete(uuid,text,text)',
                'fn_experiment_v2_complete_at(uuid,timestamp with time zone,text,text)',
                'fn_experiment_v2_configure(uuid,text,text,text,text,text,text,uuid,text,bigint,text)',
                'fn_experiment_v2_context_insert_binding()',
                'fn_experiment_v2_create_work(uuid,text,text,tstzrange,timestamp with time zone,text)',
                'fn_experiment_v2_day1_approval_audit_binding()', 'fn_experiment_v2_direct_interposition_insert()',
                'fn_experiment_v2_direct_launch_approve_day1(uuid,text)',
                'fn_experiment_v2_direct_launch_commit(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text)',
                'fn_experiment_v2_direct_launch_cycle(uuid,text)',
                'fn_experiment_v2_direct_launch_cycle_pre238(uuid,text)',
                'fn_experiment_v2_direct_launch_lock(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_open_randomized(uuid,text)',
                'fn_experiment_v2_direct_proof_attempt_status(uuid)',
                'fn_experiment_v2_direct_proof_begin(uuid,text,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_proof_begin_baseline_after(uuid,uuid,text)',
                'fn_experiment_v2_direct_proof_begin_emergency_recovery(uuid,uuid,text,bigint,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_proof_finish(uuid,text)',
                'fn_experiment_v2_direct_proof_finish_emergency_recovery(uuid,uuid,text)',
                'fn_experiment_v2_direct_proof_open_aggressive(uuid,uuid,text)',
                'fn_experiment_v2_direct_proof_receipt_attempt_binding()',
                'fn_experiment_v2_direct_proof_recovery_generation_guard()',
                'fn_experiment_v2_direct_proof_resolve_emergency(uuid,uuid,text,bigint,text,text,text,text)',
                'fn_experiment_v2_direct_proof_resolve_startup_rollover(uuid,uuid,text,text)',
                'fn_experiment_v2_direct_proof_retry_emergency_recovery(uuid,uuid,uuid,text,bigint,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_proof_work_attempt_guard()',
                'fn_experiment_v2_direct_waiver_proof_binding()', 'fn_experiment_v2_due_assignment(uuid)',
                'fn_experiment_v2_due_shadow_cycle(uuid)', 'fn_experiment_v2_executor_runtime(uuid,text)',
                'fn_experiment_v2_exposure_insert_guard()', 'fn_experiment_v2_facility_safe_insert_guard()',
                'fn_experiment_v2_finalize_assignment(uuid,uuid,text)',
                'fn_experiment_v2_finalize_assignment_at(uuid,uuid,timestamp with time zone,text)',
                'fn_experiment_v2_finalize_randomization(uuid,text)',
                'fn_experiment_v2_freeze_day_evidence(uuid,uuid,jsonb,jsonb,jsonb,text)',
                'fn_experiment_v2_freeze_day_evidence_at(uuid,uuid,jsonb,jsonb,jsonb,timestamp with time zone,text)',
                'fn_experiment_v2_freeze_export(uuid,text,text)',
                'fn_experiment_v2_freeze_export_at(uuid,text,timestamp with time zone,text)',
                'fn_experiment_v2_freeze_outcome(uuid,uuid,jsonb,boolean,boolean,boolean,boolean,boolean,text)',
                'fn_experiment_v2_freeze_outcome_at(uuid,uuid,jsonb,boolean,boolean,boolean,boolean,boolean,timestamp with time zone,text)',
                'fn_experiment_v2_gate_p_sealed_recovery_target(uuid)',
                'fn_experiment_v2_generation_recovery_cleared(uuid,bigint)', 'fn_experiment_v2_immutable()',
                'fn_experiment_v2_json_string(text)', 'fn_experiment_v2_launch_gate_status()',
                'fn_experiment_v2_lock_design(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text)',
                'fn_experiment_v2_monitor_open_exposure(uuid,text,bigint)',
                'fn_experiment_v2_open_exposure(uuid,uuid,text,text)', 'fn_experiment_v2_ops_status()',
                'fn_experiment_v2_outcome_source_bindings_immutable()',
                'fn_experiment_v2_outcome_source_cycle(uuid)', 'fn_experiment_v2_randomization_insert_binding()',
                'fn_experiment_v2_read_delivery_bundle(uuid,uuid,text,text,bigint)',
                'fn_experiment_v2_read_observation_window(uuid,uuid,uuid,text,bigint)',
                'fn_experiment_v2_receipt_canonical(text,uuid,text,text,uuid,uuid,uuid,jsonb,text,text,text,text,bigint,bigint,timestamp with time zone)',
                'fn_experiment_v2_receipt_insert_binding()',
                'fn_experiment_v2_record_approval(uuid,text,text,integer,text,text,tstzrange,timestamp with time zone,text,text,text)',
                'fn_experiment_v2_record_component_outcome(uuid,uuid,uuid,integer,text,text,bigint,bigint,text)',
                'fn_experiment_v2_record_delivery_bundle(uuid,uuid,uuid,timestamp with time zone,text)',
                'fn_experiment_v2_record_facility_safe_closure(uuid,text,text,text)',
                'fn_experiment_v2_record_observation_epoch(uuid,uuid,uuid,uuid,bytea,jsonb,text,text,text,text,bigint,bigint,text)',
                'fn_experiment_v2_record_preexposure_mismatch(uuid,uuid,uuid,text,uuid,bytea,jsonb,text,text,text,text,uuid,bigint,bigint,bigint,text)',
                'fn_experiment_v2_record_runtime_snapshot(uuid,text,uuid,bytea,jsonb,text,text,text,text,uuid,bigint,bigint,boolean,text)',
                'fn_experiment_v2_record_selector_choice(uuid,uuid,text,text,text,text,text,text,text[],text,text)',
                'fn_experiment_v2_record_selector_choice_at(uuid,uuid,text,text,text,text,text,text,text[],text,timestamp with time zone,text)',
                'fn_experiment_v2_record_shadow_choice(uuid,uuid,text,text,text,text,text,text,text[],text,text)',
                'fn_experiment_v2_record_shadow_choice_at(uuid,uuid,text,text,text,text,text,text,text[],text,timestamp with time zone,text)',
                'fn_experiment_v2_record_shadow_outcome_preview(uuid,uuid,jsonb,text)',
                'fn_experiment_v2_record_shadow_outcome_preview_at(uuid,uuid,jsonb,timestamp with time zone,text)',
                'fn_experiment_v2_record_work_event(uuid,uuid,text,jsonb,text)',
                'fn_experiment_v2_recovery_authority_cleared(uuid,uuid)',
                'fn_experiment_v2_register_runtime_instance(uuid,text,uuid,bigint,text)',
                'fn_experiment_v2_register_state(uuid,text,smallint,bytea,bytea,text)',
                'fn_experiment_v2_report_runtime_fault(uuid,text,uuid,bigint,uuid,bigint,bigint,text,text,text)',
                'fn_experiment_v2_request_recovery(uuid,uuid,tstzrange,timestamp with time zone,text,text)',
                'fn_experiment_v2_request_recovery_at(uuid,uuid,tstzrange,timestamp with time zone,text,timestamp with time zone,text)',
                'fn_experiment_v2_require_day1_approval()', 'fn_experiment_v2_require_outcome_source_binding()',
                'fn_experiment_v2_resolve_randomized(uuid,uuid,bigint)',
                'fn_experiment_v2_resolve_readiness(uuid,uuid,bigint)',
                'fn_experiment_v2_resolve_recovery(uuid,uuid,bigint)', 'fn_experiment_v2_reveal(uuid,text)',
                'fn_experiment_v2_reveal_at(uuid,timestamp with time zone,text)',
                'fn_experiment_v2_runtime_snapshot_insert_binding()',
                'fn_experiment_v2_safe_startup_attestation(text,uuid)', 'fn_experiment_v2_schedule_canonical(jsonb)',
                'fn_experiment_v2_schedule_shadow_cycle(uuid,date,timestamp with time zone,text,text,text,text,text,text)',
                'fn_experiment_v2_schedule_shadow_cycle_at(uuid,date,timestamp with time zone,text,text,text,text,text,timestamp with time zone,text)',
                'fn_experiment_v2_selector_cycle(uuid)',
                'fn_experiment_v2_selector_cycle_at(uuid,timestamp with time zone)',
                'fn_experiment_v2_selector_insert_binding()',
                'fn_experiment_v2_selector_invocation_uuid(uuid,text,date)',
                'fn_experiment_v2_set_admission(uuid,text,text,text)',
                'fn_experiment_v2_shadow_cycle_uuid(uuid,text,date,text)',
                'fn_experiment_v2_stamp_facility_safe_lease()',
                'fn_experiment_v2_state_content_sha256(smallint,bytea,bytea)',
                'fn_experiment_v2_state_insert_binding()',
                'fn_experiment_v2_terminalize_legacy_expired_recovery(uuid,uuid,bigint,text)',
                'fn_experiment_v2_timestamp_text(timestamp with time zone)',
                'fn_experiment_v2_transition(uuid,text,text,text,text)', 'fn_experiment_v2_work_insert_binding()',
                'fn_experiment_v2_work_is_eligible(uuid,uuid,bigint,timestamp with time zone,text)']) s)<>113
        OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace
            AND p.proname LIKE 'fn\_experiment\_v2\_%')<>115
        OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = ANY(
            ARRAY['verdify_experiment_lifecycle', 'verdify_experiment_component_executor',
                'verdify_experiment_shadow_scheduler', 'verdify_experiment_randomizer',
                'verdify_experiment_outcome_freezer', 'verdify_experiment_blinded_analyst',
                'verdify_experiment_v2_lifecycle_login', 'verdify_experiment_v2_component_executor_login',
                'verdify_experiment_v2_shadow_scheduler_login', 'verdify_experiment_v2_randomizer_login',
                'verdify_experiment_v2_outcome_freezer_login', 'twin_ro', 'verdify_twin_ro']))<>13
        -- DROP OWNED and DROP ROLE act in this database only: no role may hold anything in another one.
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend d JOIN pg_catalog.pg_roles r ON r.oid=d.refobjid
            WHERE d.refclassid='pg_authid'::regclass AND r.rolname = ANY(
            ARRAY['verdify_experiment_lifecycle', 'verdify_experiment_component_executor',
                'verdify_experiment_shadow_scheduler', 'verdify_experiment_randomizer',
                'verdify_experiment_outcome_freezer', 'verdify_experiment_blinded_analyst',
                'verdify_experiment_v2_lifecycle_login', 'verdify_experiment_v2_component_executor_login',
                'verdify_experiment_v2_shadow_scheduler_login', 'verdify_experiment_v2_randomizer_login',
                'verdify_experiment_v2_outcome_freezer_login', 'twin_ro', 'verdify_twin_ro'])
              AND d.dbid NOT IN (0, (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())))
        -- What stays is still there: the two trigger guards, the collector's three functions and its duty and login,
        -- the owner of the live collector objects, and the readers' objects named in steer.
        OR to_regprocedure('public.fn_experiment_v2_control_guard()') IS NULL
        OR to_regprocedure('public.fn_experiment_v2_require_end_recovery_completion()') IS NULL
        OR (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.control_experiments'::regclass
            AND tgname IN ('trg_experiment_v2_control_guard','trg_experiment_v2_end_recovery_completion'))<>2
        OR NOT has_function_privilege('verdify_experiment_equipment_source_collector',
            'public.fn_record_equipment_direct_state_snapshot(uuid,uuid,text,text,jsonb,double precision,uuid,bigint,text)',
            'EXECUTE')
        OR to_regclass('public.equipment_direct_state_snapshots') IS NULL
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='verdify_experiment_v2_owner')
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='verdify_experiment_equipment_source_collector')
        OR to_regclass('public.v_active_plan') IS NULL
        OR to_regprocedure('public.fn_house_vpd_control_band(timestamptz)') IS NULL
        OR to_regclass('public.planner_inference_runs') IS NULL
        OR to_regclass('public.forecast_action_rules') IS NULL
        OR NOT has_table_privilege('verdify_mcp_runtime', 'public.setpoint_plan', 'SELECT')
        OR NOT has_table_privilege('verdify_mcp_runtime', 'public.setpoint_plan', 'INSERT')
        OR NOT has_table_privilege('verdify_mcp_runtime', 'public.setpoint_plan', 'UPDATE')
        OR has_table_privilege('verdify_mcp_runtime', 'public.setpoint_plan', 'DELETE')
        OR (SELECT confrelid FROM pg_catalog.pg_constraint WHERE conrelid='public.planner_inference_runs'::regclass
            AND conname='planner_inference_runs_pack_sha256_fkey' AND contype='f')
            IS DISTINCT FROM 'public.planner_pack'::regclass
    THEN RAISE EXCEPTION '316 refuses an unqualified predecessor'; END IF;
    -- Every table still holds exactly the rows the archive Job counted (archive first, owner's standing decision).
    FOR v_rel, v_expected IN SELECT t, n FROM (VALUES
        ('experiment_v2_approvals',0),
        ('experiment_v2_bundle_attempts',560),
        ('experiment_v2_candidate_revisions',1),
        ('experiment_v2_component_outcomes',6263),
        ('experiment_v2_contract_constants',1),
        ('experiment_v2_day_evidence',0),
        ('experiment_v2_delivery_bundle_completions',26),
        ('experiment_v2_delivery_bundles',43),
        ('experiment_v2_direct_launch_waivers',0),
        ('experiment_v2_direct_proof_attempt_events',5),
        ('experiment_v2_direct_proof_attempt_work',6),
        ('experiment_v2_direct_proof_authorizations',3),
        ('experiment_v2_direct_proof_emergency_recovery_attempt_events',8),
        ('experiment_v2_direct_proof_emergency_recovery_receipts',3),
        ('experiment_v2_direct_proof_emergency_resolutions',11),
        ('experiment_v2_direct_proof_receipts',0),
        ('experiment_v2_exports',0),
        ('experiment_v2_exposure_closures',0),
        ('experiment_v2_exposures',0),
        ('experiment_v2_facility_safe_closures',1),
        ('experiment_v2_observation_epochs',25),
        ('experiment_v2_observation_receipts',25),
        ('experiment_v2_outcome_freezes',0),
        ('experiment_v2_outcome_source_bindings',0),
        ('experiment_v2_outcomes',0),
        ('experiment_v2_preexposure_mismatch_epochs',0),
        ('experiment_v2_randomization',0),
        ('experiment_v2_reveals',0),
        ('experiment_v2_runtime_faults',94),
        ('experiment_v2_runtime_generations',225),
        ('experiment_v2_runtime_snapshots',0),
        ('experiment_v2_selector_choices',0),
        ('experiment_v2_selector_contexts',0),
        ('experiment_v2_shadow_choices',0),
        ('experiment_v2_shadow_contexts',0),
        ('experiment_v2_shadow_cycles',0),
        ('experiment_v2_shadow_outcome_previews',0),
        ('experiment_v2_state_artifacts',3),
        ('experiment_v2_work',111),
        ('experiment_v2_work_events',322),
        ('twin_decisions',0),
        ('twin_live_results',0),
        ('firmware_twin_divergence',0),
        ('planner_graph_runs',0),
        ('planner_memory_items',0),
        ('planner_memory_retrievals',0),
        ('planner_pack',131),
        ('forecast_deviation_thresholds',3)
    ) AS archived(t, n) LOOP
        EXECUTE format('SELECT count(*) FROM public.%I', v_rel) INTO v_rows;
        IF v_rows <> v_expected THEN
            RAISE EXCEPTION '316 refuses: % holds % rows, the archive counted %', v_rel, v_rows, v_expected;
        END IF;
    END LOOP;
END $predecessor$;

-- The dependency guard (contracts phase4-drops section 0 rule 6): nothing outside this list depends on what it drops.
DO $guard$
DECLARE
    v_rels oid[];
    v_fns oid[];
    v_types oid[];
    v_bad text;
BEGIN
    v_rels := ARRAY(SELECT c.oid FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace
        AND (c.relname = ANY(
            ARRAY['experiment_v2_approvals', 'experiment_v2_bundle_attempts', 'experiment_v2_candidate_revisions',
                'experiment_v2_component_outcomes', 'experiment_v2_contract_constants', 'experiment_v2_day_evidence',
                'experiment_v2_delivery_bundle_completions', 'experiment_v2_delivery_bundles',
                'experiment_v2_direct_launch_waivers', 'experiment_v2_direct_proof_attempt_events',
                'experiment_v2_direct_proof_attempt_work', 'experiment_v2_direct_proof_authorizations',
                'experiment_v2_direct_proof_emergency_recovery_attempt_events',
                'experiment_v2_direct_proof_emergency_recovery_receipts',
                'experiment_v2_direct_proof_emergency_resolutions', 'experiment_v2_direct_proof_receipts',
                'experiment_v2_exports', 'experiment_v2_exposure_closures', 'experiment_v2_exposures',
                'experiment_v2_facility_safe_closures', 'experiment_v2_observation_epochs',
                'experiment_v2_observation_receipts', 'experiment_v2_outcome_freezes',
                'experiment_v2_outcome_source_bindings', 'experiment_v2_outcomes',
                'experiment_v2_preexposure_mismatch_epochs', 'experiment_v2_randomization', 'experiment_v2_reveals',
                'experiment_v2_runtime_faults', 'experiment_v2_runtime_generations',
                'experiment_v2_runtime_snapshots', 'experiment_v2_selector_choices',
                'experiment_v2_selector_contexts', 'experiment_v2_shadow_choices', 'experiment_v2_shadow_contexts',
                'experiment_v2_shadow_cycles', 'experiment_v2_shadow_outcome_previews',
                'experiment_v2_state_artifacts', 'experiment_v2_work', 'experiment_v2_work_events', 'twin_decisions',
                'twin_live_results', 'firmware_twin_divergence', 'planner_graph_runs', 'planner_memory_items',
                'planner_memory_retrievals', 'planner_pack', 'forecast_deviation_thresholds',
                'v_experiment_v2_blinded_assigned_day_outcomes', 'v_experiment_v2_frozen_analyzer_input',
                'v_experiment_v2_revealed_analyzer_input', 'v_experiment_v2_selector_climate_source',
                'v_experiment_v2_selector_forecast_source', 'v_policy_twin_asof_input', 'v_planner_experiments',
                'v_planner_experiment_events', 'v_planner_assignments', 'v_iris_experiment_context',
                'v_runtime_v1_iris_experiment_context'])
          OR c.relname = ANY(
            ARRAY['experiment_v2_bundle_attempts_attempt_id_seq',
                'experiment_v2_component_outcomes_component_outcome_id_seq',
                'experiment_v2_runtime_generations_generation_event_id_seq',
                'experiment_v2_work_events_work_event_id_seq'])));
    v_fns := ARRAY(SELECT to_regprocedure('public.' || s)::oid FROM unnest(
            ARRAY['fn_experiment_v2_all_assignment_windows_bound(uuid,timestamp with time zone)',
                'fn_experiment_v2_api_status(uuid)', 'fn_experiment_v2_approval_insert_binding()',
                'fn_experiment_v2_assignment_uuid(uuid,text,date)',
                'fn_experiment_v2_assignment_window_is_bound(uuid,uuid,timestamp with time zone)',
                'fn_experiment_v2_begin_delivery_bundle(uuid,uuid,uuid,text,text,text)',
                'fn_experiment_v2_boundary_cycle(uuid,text)',
                'fn_experiment_v2_build_selector_context(uuid,date,timestamp with time zone,timestamp with time zone)',
                'fn_experiment_v2_claim_executor_candidate(uuid,text,bigint,text)',
                'fn_experiment_v2_close_exposure(uuid,text,text)', 'fn_experiment_v2_complete(uuid,text,text)',
                'fn_experiment_v2_complete_at(uuid,timestamp with time zone,text,text)',
                'fn_experiment_v2_configure(uuid,text,text,text,text,text,text,uuid,text,bigint,text)',
                'fn_experiment_v2_context_insert_binding()',
                'fn_experiment_v2_create_work(uuid,text,text,tstzrange,timestamp with time zone,text)',
                'fn_experiment_v2_day1_approval_audit_binding()', 'fn_experiment_v2_direct_interposition_insert()',
                'fn_experiment_v2_direct_launch_approve_day1(uuid,text)',
                'fn_experiment_v2_direct_launch_commit(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text)',
                'fn_experiment_v2_direct_launch_cycle(uuid,text)',
                'fn_experiment_v2_direct_launch_cycle_pre238(uuid,text)',
                'fn_experiment_v2_direct_launch_lock(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_open_randomized(uuid,text)',
                'fn_experiment_v2_direct_proof_attempt_status(uuid)',
                'fn_experiment_v2_direct_proof_begin(uuid,text,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_proof_begin_baseline_after(uuid,uuid,text)',
                'fn_experiment_v2_direct_proof_begin_emergency_recovery(uuid,uuid,text,bigint,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_proof_finish(uuid,text)',
                'fn_experiment_v2_direct_proof_finish_emergency_recovery(uuid,uuid,text)',
                'fn_experiment_v2_direct_proof_open_aggressive(uuid,uuid,text)',
                'fn_experiment_v2_direct_proof_receipt_attempt_binding()',
                'fn_experiment_v2_direct_proof_recovery_generation_guard()',
                'fn_experiment_v2_direct_proof_resolve_emergency(uuid,uuid,text,bigint,text,text,text,text)',
                'fn_experiment_v2_direct_proof_resolve_startup_rollover(uuid,uuid,text,text)',
                'fn_experiment_v2_direct_proof_retry_emergency_recovery(uuid,uuid,uuid,text,bigint,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_proof_work_attempt_guard()',
                'fn_experiment_v2_direct_waiver_proof_binding()', 'fn_experiment_v2_due_assignment(uuid)',
                'fn_experiment_v2_due_shadow_cycle(uuid)', 'fn_experiment_v2_executor_runtime(uuid,text)',
                'fn_experiment_v2_exposure_insert_guard()', 'fn_experiment_v2_facility_safe_insert_guard()',
                'fn_experiment_v2_finalize_assignment(uuid,uuid,text)',
                'fn_experiment_v2_finalize_assignment_at(uuid,uuid,timestamp with time zone,text)',
                'fn_experiment_v2_finalize_randomization(uuid,text)',
                'fn_experiment_v2_freeze_day_evidence(uuid,uuid,jsonb,jsonb,jsonb,text)',
                'fn_experiment_v2_freeze_day_evidence_at(uuid,uuid,jsonb,jsonb,jsonb,timestamp with time zone,text)',
                'fn_experiment_v2_freeze_export(uuid,text,text)',
                'fn_experiment_v2_freeze_export_at(uuid,text,timestamp with time zone,text)',
                'fn_experiment_v2_freeze_outcome(uuid,uuid,jsonb,boolean,boolean,boolean,boolean,boolean,text)',
                'fn_experiment_v2_freeze_outcome_at(uuid,uuid,jsonb,boolean,boolean,boolean,boolean,boolean,timestamp with time zone,text)',
                'fn_experiment_v2_gate_p_sealed_recovery_target(uuid)',
                'fn_experiment_v2_generation_recovery_cleared(uuid,bigint)', 'fn_experiment_v2_immutable()',
                'fn_experiment_v2_json_string(text)', 'fn_experiment_v2_launch_gate_status()',
                'fn_experiment_v2_lock_design(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text)',
                'fn_experiment_v2_monitor_open_exposure(uuid,text,bigint)',
                'fn_experiment_v2_open_exposure(uuid,uuid,text,text)', 'fn_experiment_v2_ops_status()',
                'fn_experiment_v2_outcome_source_bindings_immutable()',
                'fn_experiment_v2_outcome_source_cycle(uuid)', 'fn_experiment_v2_randomization_insert_binding()',
                'fn_experiment_v2_read_delivery_bundle(uuid,uuid,text,text,bigint)',
                'fn_experiment_v2_read_observation_window(uuid,uuid,uuid,text,bigint)',
                'fn_experiment_v2_receipt_canonical(text,uuid,text,text,uuid,uuid,uuid,jsonb,text,text,text,text,bigint,bigint,timestamp with time zone)',
                'fn_experiment_v2_receipt_insert_binding()',
                'fn_experiment_v2_record_approval(uuid,text,text,integer,text,text,tstzrange,timestamp with time zone,text,text,text)',
                'fn_experiment_v2_record_component_outcome(uuid,uuid,uuid,integer,text,text,bigint,bigint,text)',
                'fn_experiment_v2_record_delivery_bundle(uuid,uuid,uuid,timestamp with time zone,text)',
                'fn_experiment_v2_record_facility_safe_closure(uuid,text,text,text)',
                'fn_experiment_v2_record_observation_epoch(uuid,uuid,uuid,uuid,bytea,jsonb,text,text,text,text,bigint,bigint,text)',
                'fn_experiment_v2_record_preexposure_mismatch(uuid,uuid,uuid,text,uuid,bytea,jsonb,text,text,text,text,uuid,bigint,bigint,bigint,text)',
                'fn_experiment_v2_record_runtime_snapshot(uuid,text,uuid,bytea,jsonb,text,text,text,text,uuid,bigint,bigint,boolean,text)',
                'fn_experiment_v2_record_selector_choice(uuid,uuid,text,text,text,text,text,text,text[],text,text)',
                'fn_experiment_v2_record_selector_choice_at(uuid,uuid,text,text,text,text,text,text,text[],text,timestamp with time zone,text)',
                'fn_experiment_v2_record_shadow_choice(uuid,uuid,text,text,text,text,text,text,text[],text,text)',
                'fn_experiment_v2_record_shadow_choice_at(uuid,uuid,text,text,text,text,text,text,text[],text,timestamp with time zone,text)',
                'fn_experiment_v2_record_shadow_outcome_preview(uuid,uuid,jsonb,text)',
                'fn_experiment_v2_record_shadow_outcome_preview_at(uuid,uuid,jsonb,timestamp with time zone,text)',
                'fn_experiment_v2_record_work_event(uuid,uuid,text,jsonb,text)',
                'fn_experiment_v2_recovery_authority_cleared(uuid,uuid)',
                'fn_experiment_v2_register_runtime_instance(uuid,text,uuid,bigint,text)',
                'fn_experiment_v2_register_state(uuid,text,smallint,bytea,bytea,text)',
                'fn_experiment_v2_report_runtime_fault(uuid,text,uuid,bigint,uuid,bigint,bigint,text,text,text)',
                'fn_experiment_v2_request_recovery(uuid,uuid,tstzrange,timestamp with time zone,text,text)',
                'fn_experiment_v2_request_recovery_at(uuid,uuid,tstzrange,timestamp with time zone,text,timestamp with time zone,text)',
                'fn_experiment_v2_require_day1_approval()', 'fn_experiment_v2_require_outcome_source_binding()',
                'fn_experiment_v2_resolve_randomized(uuid,uuid,bigint)',
                'fn_experiment_v2_resolve_readiness(uuid,uuid,bigint)',
                'fn_experiment_v2_resolve_recovery(uuid,uuid,bigint)', 'fn_experiment_v2_reveal(uuid,text)',
                'fn_experiment_v2_reveal_at(uuid,timestamp with time zone,text)',
                'fn_experiment_v2_runtime_snapshot_insert_binding()',
                'fn_experiment_v2_safe_startup_attestation(text,uuid)', 'fn_experiment_v2_schedule_canonical(jsonb)',
                'fn_experiment_v2_schedule_shadow_cycle(uuid,date,timestamp with time zone,text,text,text,text,text,text)',
                'fn_experiment_v2_schedule_shadow_cycle_at(uuid,date,timestamp with time zone,text,text,text,text,text,timestamp with time zone,text)',
                'fn_experiment_v2_selector_cycle(uuid)',
                'fn_experiment_v2_selector_cycle_at(uuid,timestamp with time zone)',
                'fn_experiment_v2_selector_insert_binding()',
                'fn_experiment_v2_selector_invocation_uuid(uuid,text,date)',
                'fn_experiment_v2_set_admission(uuid,text,text,text)',
                'fn_experiment_v2_shadow_cycle_uuid(uuid,text,date,text)',
                'fn_experiment_v2_stamp_facility_safe_lease()',
                'fn_experiment_v2_state_content_sha256(smallint,bytea,bytea)',
                'fn_experiment_v2_state_insert_binding()',
                'fn_experiment_v2_terminalize_legacy_expired_recovery(uuid,uuid,bigint,text)',
                'fn_experiment_v2_timestamp_text(timestamp with time zone)',
                'fn_experiment_v2_transition(uuid,text,text,text,text)', 'fn_experiment_v2_work_insert_binding()',
                'fn_experiment_v2_work_is_eligible(uuid,uuid,bigint,timestamp with time zone,text)']) s);
    v_types := ARRAY(SELECT t.oid FROM pg_catalog.pg_type t
        WHERE t.typrelid = ANY(v_rels)
           OR t.typelem IN (SELECT reltype FROM pg_catalog.pg_class WHERE oid = ANY(v_rels) AND reltype <> 0));
    IF cardinality(v_rels) <> 63 OR cardinality(v_fns) <> 113 THEN
        RAISE EXCEPTION '316 guard: % relations, % functions', cardinality(v_rels), cardinality(v_fns);
    END IF;
    SELECT string_agg(DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid), '; ') INTO v_bad
      FROM pg_catalog.pg_depend d
     WHERE ((d.refclassid='pg_class'::regclass AND d.refobjid = ANY(v_rels))
         OR (d.refclassid='pg_proc'::regclass AND d.refobjid = ANY(v_fns))
         OR (d.refclassid='pg_type'::regclass AND d.refobjid = ANY(v_types)))
       AND NOT (
           (d.classid='pg_class'::regclass AND (d.objid = ANY(v_rels) OR d.deptype IN ('a','i')))
        OR (d.classid='pg_type'::regclass AND (d.objid = ANY(v_types) OR d.deptype='i'))
        OR (d.classid='pg_proc'::regclass AND d.objid = ANY(v_fns))
        OR (d.classid='pg_rewrite'::regclass
            AND (SELECT ev_class FROM pg_catalog.pg_rewrite WHERE oid=d.objid) = ANY(v_rels))
        OR (d.classid='pg_trigger'::regclass
            AND (SELECT tgrelid FROM pg_catalog.pg_trigger WHERE oid=d.objid) = ANY(v_rels))
        OR (d.classid='pg_constraint'::regclass
            AND (SELECT conrelid FROM pg_catalog.pg_constraint WHERE oid=d.objid) = ANY(v_rels))
        OR (d.classid='pg_attrdef'::regclass
            AND (SELECT adrelid FROM pg_catalog.pg_attrdef WHERE oid=d.objid) = ANY(v_rels))
        OR (d.classid='pg_policy'::regclass
            AND (SELECT polrelid FROM pg_catalog.pg_policy WHERE oid=d.objid) = ANY(v_rels))
        -- The one foreign key from a kept table into a dropped one, dropped by name below.
        OR (d.classid='pg_constraint'::regclass AND d.objid=(SELECT oid FROM pg_catalog.pg_constraint
            WHERE conrelid='public.planner_inference_runs'::regclass
              AND conname='planner_inference_runs_pack_sha256_fkey')));
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION '316 refuses: % depends on a dropped object', v_bad; END IF;
    -- Function bodies are not in pg_depend: only the kept trigger guard on control_experiments may name a dropped object.
    SELECT string_agg(DISTINCT p.oid::regprocedure::text, '; ') INTO v_bad
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^(_timescaledb|timescaledb)'
       AND p.oid <> ALL(v_fns)
       AND p.oid <> 'public.fn_experiment_v2_require_end_recovery_completion()'::regprocedure
       AND p.prosrc ~ ('\m(' || array_to_string(ARRAY(
           SELECT relname::text FROM pg_catalog.pg_class WHERE oid = ANY(v_rels)
           UNION SELECT proname::text FROM pg_catalog.pg_proc WHERE oid = ANY(v_fns)), '|') || ')\M');
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION '316 refuses: % names a dropped object', v_bad; END IF;
END $guard$;

-- Non-trigger functions first (some take or return the rowtypes of dropped tables and views; dropping a function
-- locks no relation), then the setpoint_plan revoke and the roles, then the views, the planner_pack foreign key and the
-- tables (their triggers, constraints and identity sequences go with them), then the trigger functions. RESTRICT.
DROP FUNCTION
    public.fn_experiment_v2_all_assignment_windows_bound(uuid,timestamp with time zone),
    public.fn_experiment_v2_api_status(uuid),
    public.fn_experiment_v2_assignment_uuid(uuid,text,date),
    public.fn_experiment_v2_assignment_window_is_bound(uuid,uuid,timestamp with time zone),
    public.fn_experiment_v2_begin_delivery_bundle(uuid,uuid,uuid,text,text,text),
    public.fn_experiment_v2_boundary_cycle(uuid,text),
    public.fn_experiment_v2_build_selector_context(uuid,date,timestamp with time zone,timestamp with time zone),
    public.fn_experiment_v2_claim_executor_candidate(uuid,text,bigint,text),
    public.fn_experiment_v2_close_exposure(uuid,text,text),
    public.fn_experiment_v2_complete(uuid,text,text),
    public.fn_experiment_v2_complete_at(uuid,timestamp with time zone,text,text),
    public.fn_experiment_v2_configure(uuid,text,text,text,text,text,text,uuid,text,bigint,text),
    public.fn_experiment_v2_create_work(uuid,text,text,tstzrange,timestamp with time zone,text),
    public.fn_experiment_v2_direct_launch_approve_day1(uuid,text),
    public.fn_experiment_v2_direct_launch_commit(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text),
    public.fn_experiment_v2_direct_launch_cycle(uuid,text),
    public.fn_experiment_v2_direct_launch_cycle_pre238(uuid,text),
    public.fn_experiment_v2_direct_launch_lock(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,tstzrange,text,text,text),
    public.fn_experiment_v2_direct_open_randomized(uuid,text),
    public.fn_experiment_v2_direct_proof_attempt_status(uuid),
    public.fn_experiment_v2_direct_proof_begin(uuid,text,tstzrange,text,text,text),
    public.fn_experiment_v2_direct_proof_begin_baseline_after(uuid,uuid,text),
    public.fn_experiment_v2_direct_proof_begin_emergency_recovery(uuid,uuid,text,bigint,tstzrange,text,text,text),
    public.fn_experiment_v2_direct_proof_finish(uuid,text),
    public.fn_experiment_v2_direct_proof_finish_emergency_recovery(uuid,uuid,text),
    public.fn_experiment_v2_direct_proof_open_aggressive(uuid,uuid,text),
    public.fn_experiment_v2_direct_proof_resolve_emergency(uuid,uuid,text,bigint,text,text,text,text),
    public.fn_experiment_v2_direct_proof_resolve_startup_rollover(uuid,uuid,text,text),
    public.fn_experiment_v2_direct_proof_retry_emergency_recovery(uuid,uuid,uuid,text,bigint,tstzrange,text,text,text),
    public.fn_experiment_v2_due_assignment(uuid),
    public.fn_experiment_v2_due_shadow_cycle(uuid),
    public.fn_experiment_v2_executor_runtime(uuid,text),
    public.fn_experiment_v2_finalize_assignment(uuid,uuid,text),
    public.fn_experiment_v2_finalize_assignment_at(uuid,uuid,timestamp with time zone,text),
    public.fn_experiment_v2_finalize_randomization(uuid,text),
    public.fn_experiment_v2_freeze_day_evidence(uuid,uuid,jsonb,jsonb,jsonb,text),
    public.fn_experiment_v2_freeze_day_evidence_at(uuid,uuid,jsonb,jsonb,jsonb,timestamp with time zone,text),
    public.fn_experiment_v2_freeze_export(uuid,text,text),
    public.fn_experiment_v2_freeze_export_at(uuid,text,timestamp with time zone,text),
    public.fn_experiment_v2_freeze_outcome(uuid,uuid,jsonb,boolean,boolean,boolean,boolean,boolean,text),
    public.fn_experiment_v2_freeze_outcome_at(uuid,uuid,jsonb,boolean,boolean,boolean,boolean,boolean,timestamp with time zone,text),
    public.fn_experiment_v2_gate_p_sealed_recovery_target(uuid),
    public.fn_experiment_v2_generation_recovery_cleared(uuid,bigint),
    public.fn_experiment_v2_json_string(text),
    public.fn_experiment_v2_launch_gate_status(),
    public.fn_experiment_v2_lock_design(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text),
    public.fn_experiment_v2_monitor_open_exposure(uuid,text,bigint),
    public.fn_experiment_v2_open_exposure(uuid,uuid,text,text),
    public.fn_experiment_v2_ops_status(),
    public.fn_experiment_v2_outcome_source_cycle(uuid),
    public.fn_experiment_v2_read_delivery_bundle(uuid,uuid,text,text,bigint),
    public.fn_experiment_v2_read_observation_window(uuid,uuid,uuid,text,bigint),
    public.fn_experiment_v2_receipt_canonical(text,uuid,text,text,uuid,uuid,uuid,jsonb,text,text,text,text,bigint,bigint,timestamp with time zone),
    public.fn_experiment_v2_record_approval(uuid,text,text,integer,text,text,tstzrange,timestamp with time zone,text,text,text),
    public.fn_experiment_v2_record_component_outcome(uuid,uuid,uuid,integer,text,text,bigint,bigint,text),
    public.fn_experiment_v2_record_delivery_bundle(uuid,uuid,uuid,timestamp with time zone,text),
    public.fn_experiment_v2_record_facility_safe_closure(uuid,text,text,text),
    public.fn_experiment_v2_record_observation_epoch(uuid,uuid,uuid,uuid,bytea,jsonb,text,text,text,text,bigint,bigint,text),
    public.fn_experiment_v2_record_preexposure_mismatch(uuid,uuid,uuid,text,uuid,bytea,jsonb,text,text,text,text,uuid,bigint,bigint,bigint,text),
    public.fn_experiment_v2_record_runtime_snapshot(uuid,text,uuid,bytea,jsonb,text,text,text,text,uuid,bigint,bigint,boolean,text),
    public.fn_experiment_v2_record_selector_choice(uuid,uuid,text,text,text,text,text,text,text[],text,text),
    public.fn_experiment_v2_record_selector_choice_at(uuid,uuid,text,text,text,text,text,text,text[],text,timestamp with time zone,text),
    public.fn_experiment_v2_record_shadow_choice(uuid,uuid,text,text,text,text,text,text,text[],text,text),
    public.fn_experiment_v2_record_shadow_choice_at(uuid,uuid,text,text,text,text,text,text,text[],text,timestamp with time zone,text),
    public.fn_experiment_v2_record_shadow_outcome_preview(uuid,uuid,jsonb,text),
    public.fn_experiment_v2_record_shadow_outcome_preview_at(uuid,uuid,jsonb,timestamp with time zone,text),
    public.fn_experiment_v2_record_work_event(uuid,uuid,text,jsonb,text),
    public.fn_experiment_v2_recovery_authority_cleared(uuid,uuid),
    public.fn_experiment_v2_register_runtime_instance(uuid,text,uuid,bigint,text),
    public.fn_experiment_v2_register_state(uuid,text,smallint,bytea,bytea,text),
    public.fn_experiment_v2_report_runtime_fault(uuid,text,uuid,bigint,uuid,bigint,bigint,text,text,text),
    public.fn_experiment_v2_request_recovery(uuid,uuid,tstzrange,timestamp with time zone,text,text),
    public.fn_experiment_v2_request_recovery_at(uuid,uuid,tstzrange,timestamp with time zone,text,timestamp with time zone,text),
    public.fn_experiment_v2_resolve_randomized(uuid,uuid,bigint),
    public.fn_experiment_v2_resolve_readiness(uuid,uuid,bigint),
    public.fn_experiment_v2_resolve_recovery(uuid,uuid,bigint),
    public.fn_experiment_v2_reveal(uuid,text),
    public.fn_experiment_v2_reveal_at(uuid,timestamp with time zone,text),
    public.fn_experiment_v2_safe_startup_attestation(text,uuid),
    public.fn_experiment_v2_schedule_canonical(jsonb),
    public.fn_experiment_v2_schedule_shadow_cycle(uuid,date,timestamp with time zone,text,text,text,text,text,text),
    public.fn_experiment_v2_schedule_shadow_cycle_at(uuid,date,timestamp with time zone,text,text,text,text,text,timestamp with time zone,text),
    public.fn_experiment_v2_selector_cycle(uuid),
    public.fn_experiment_v2_selector_cycle_at(uuid,timestamp with time zone),
    public.fn_experiment_v2_selector_invocation_uuid(uuid,text,date),
    public.fn_experiment_v2_set_admission(uuid,text,text,text),
    public.fn_experiment_v2_shadow_cycle_uuid(uuid,text,date,text),
    public.fn_experiment_v2_state_content_sha256(smallint,bytea,bytea),
    public.fn_experiment_v2_terminalize_legacy_expired_recovery(uuid,uuid,bigint,text),
    public.fn_experiment_v2_timestamp_text(timestamp with time zone),
    public.fn_experiment_v2_transition(uuid,text,text,text,text),
    public.fn_experiment_v2_work_is_eligible(uuid,uuid,bigint,timestamp with time zone,text);

-- The six retired duties, their five logins (H2 removed their credentials and runtime) and the two twin read roles.
-- DROP OWNED also revokes twin_ro's SELECT grants; a grant change takes no relation lock.
REASSIGN OWNED BY
    verdify_experiment_lifecycle,
    verdify_experiment_component_executor,
    verdify_experiment_shadow_scheduler,
    verdify_experiment_randomizer,
    verdify_experiment_outcome_freezer,
    verdify_experiment_blinded_analyst,
    verdify_experiment_v2_lifecycle_login,
    verdify_experiment_v2_component_executor_login,
    verdify_experiment_v2_shadow_scheduler_login,
    verdify_experiment_v2_randomizer_login,
    verdify_experiment_v2_outcome_freezer_login,
    twin_ro,
    verdify_twin_ro
    TO verdify;
DROP OWNED BY
    verdify_experiment_lifecycle,
    verdify_experiment_component_executor,
    verdify_experiment_shadow_scheduler,
    verdify_experiment_randomizer,
    verdify_experiment_outcome_freezer,
    verdify_experiment_blinded_analyst,
    verdify_experiment_v2_lifecycle_login,
    verdify_experiment_v2_component_executor_login,
    verdify_experiment_v2_shadow_scheduler_login,
    verdify_experiment_v2_randomizer_login,
    verdify_experiment_v2_outcome_freezer_login,
    twin_ro,
    verdify_twin_ro;
DROP ROLE
    verdify_experiment_lifecycle,
    verdify_experiment_component_executor,
    verdify_experiment_shadow_scheduler,
    verdify_experiment_randomizer,
    verdify_experiment_outcome_freezer,
    verdify_experiment_blinded_analyst,
    verdify_experiment_v2_lifecycle_login,
    verdify_experiment_v2_component_executor_login,
    verdify_experiment_v2_shadow_scheduler_login,
    verdify_experiment_v2_randomizer_login,
    verdify_experiment_v2_outcome_freezer_login,
    twin_ro,
    verdify_twin_ro;

-- The relation drops run in a bounded retry, as 315's view redefinitions do: each statement waits at most 5 s for its
-- locks, up to 8 attempts 1 s apart, and the file raises naming the statement when every attempt is lost. They run by
-- EXECUTE so the qualifier does not lock the views up front (LOCK TABLE on a view locks every relation it reads, and
-- four of these views read climate, one also diagnostics, equipment_state and setpoint_snapshot); DROP VIEW itself
-- locks only the view. Views go first, then tables. Nothing live reads a dropped view or table. Dropping the tables
-- also locks the tables their foreign keys reference (greenhouses, control_experiments, control_assignments) until
-- commit; greenhouses is referenced by the hot hypertables, so the table drops come last, just before the trigger
-- functions and the seals. The setpoint_plan revoke rides the same retry.
DO $drops$
DECLARE
    saved text := pg_catalog.current_setting('lock_timeout');
    rec record;
    attempt integer;
BEGIN
    FOR rec IN SELECT * FROM (VALUES
        (1, 'views', $ddl$
DROP VIEW
    public.v_experiment_v2_blinded_assigned_day_outcomes,
    public.v_experiment_v2_frozen_analyzer_input,
    public.v_experiment_v2_revealed_analyzer_input,
    public.v_experiment_v2_selector_climate_source,
    public.v_experiment_v2_selector_forecast_source,
    public.v_policy_twin_asof_input,
    public.v_planner_experiments,
    public.v_planner_experiment_events,
    public.v_planner_assignments,
    public.v_iris_experiment_context,
    public.v_runtime_v1_iris_experiment_context;
$ddl$),
        -- planner_inference_runs stays (verdify_services planner and the operator API read it); its pack_sha256 column
        -- and values stay, only the foreign key into the archived planner_pack goes.
        (2, 'planner_inference_runs foreign key', $ddl$
ALTER TABLE public.planner_inference_runs DROP CONSTRAINT planner_inference_runs_pack_sha256_fkey;
$ddl$),
        -- No code path writes plans after release 3 (MCP set_plan is retired; lane HOST-LAW): the MCP duty keeps SELECT.
        (3, 'setpoint_plan writes', $ddl$
REVOKE INSERT, UPDATE ON public.setpoint_plan FROM verdify_mcp_runtime;
$ddl$),
        -- The three policy twin hypertables (empty, no chunks) in their own statement.
        (4, 'twin hypertables', $ddl$
DROP TABLE
    public.twin_decisions,
    public.twin_live_results,
    public.firmware_twin_divergence;
$ddl$),
        (5, 'tables', $ddl$
DROP TABLE
    public.experiment_v2_approvals,
    public.experiment_v2_bundle_attempts,
    public.experiment_v2_candidate_revisions,
    public.experiment_v2_component_outcomes,
    public.experiment_v2_contract_constants,
    public.experiment_v2_day_evidence,
    public.experiment_v2_delivery_bundle_completions,
    public.experiment_v2_delivery_bundles,
    public.experiment_v2_direct_launch_waivers,
    public.experiment_v2_direct_proof_attempt_events,
    public.experiment_v2_direct_proof_attempt_work,
    public.experiment_v2_direct_proof_authorizations,
    public.experiment_v2_direct_proof_emergency_recovery_attempt_events,
    public.experiment_v2_direct_proof_emergency_recovery_receipts,
    public.experiment_v2_direct_proof_emergency_resolutions,
    public.experiment_v2_direct_proof_receipts,
    public.experiment_v2_exports,
    public.experiment_v2_exposure_closures,
    public.experiment_v2_exposures,
    public.experiment_v2_facility_safe_closures,
    public.experiment_v2_observation_epochs,
    public.experiment_v2_observation_receipts,
    public.experiment_v2_outcome_freezes,
    public.experiment_v2_outcome_source_bindings,
    public.experiment_v2_outcomes,
    public.experiment_v2_preexposure_mismatch_epochs,
    public.experiment_v2_randomization,
    public.experiment_v2_reveals,
    public.experiment_v2_runtime_faults,
    public.experiment_v2_runtime_generations,
    public.experiment_v2_runtime_snapshots,
    public.experiment_v2_selector_choices,
    public.experiment_v2_selector_contexts,
    public.experiment_v2_shadow_choices,
    public.experiment_v2_shadow_contexts,
    public.experiment_v2_shadow_cycles,
    public.experiment_v2_shadow_outcome_previews,
    public.experiment_v2_state_artifacts,
    public.experiment_v2_work,
    public.experiment_v2_work_events,
    public.planner_graph_runs,
    public.planner_memory_items,
    public.planner_memory_retrievals,
    public.planner_pack,
    public.forecast_deviation_thresholds;
$ddl$)
    ) AS v(ord, target, ddl) ORDER BY ord LOOP
        attempt := 0;
        LOOP
            attempt := attempt + 1;
            BEGIN
                PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
                EXECUTE rec.ddl;
                PERFORM pg_catalog.set_config('lock_timeout', saved, true);
                EXIT;
            EXCEPTION WHEN lock_not_available THEN
                PERFORM pg_catalog.set_config('lock_timeout', saved, true);
                IF attempt >= 8 THEN
                    RAISE EXCEPTION '316 could not lock % in 8 attempts of 5 s', rec.target
                        USING ERRCODE = 'lock_not_available';
                END IF;
                PERFORM pg_catalog.pg_sleep(1);
            END;
        END LOOP;
    END LOOP;
    IF pg_catalog.current_setting('lock_timeout') IS DISTINCT FROM saved THEN
        RAISE EXCEPTION '316 left lock_timeout changed';
    END IF;
END $drops$;

DROP FUNCTION
    public.fn_experiment_v2_approval_insert_binding(),
    public.fn_experiment_v2_context_insert_binding(),
    public.fn_experiment_v2_day1_approval_audit_binding(),
    public.fn_experiment_v2_direct_interposition_insert(),
    public.fn_experiment_v2_direct_proof_receipt_attempt_binding(),
    public.fn_experiment_v2_direct_proof_recovery_generation_guard(),
    public.fn_experiment_v2_direct_proof_work_attempt_guard(),
    public.fn_experiment_v2_direct_waiver_proof_binding(),
    public.fn_experiment_v2_exposure_insert_guard(),
    public.fn_experiment_v2_facility_safe_insert_guard(),
    public.fn_experiment_v2_immutable(),
    public.fn_experiment_v2_outcome_source_bindings_immutable(),
    public.fn_experiment_v2_randomization_insert_binding(),
    public.fn_experiment_v2_receipt_insert_binding(),
    public.fn_experiment_v2_require_day1_approval(),
    public.fn_experiment_v2_require_outcome_source_binding(),
    public.fn_experiment_v2_runtime_snapshot_insert_binding(),
    public.fn_experiment_v2_selector_insert_binding(),
    public.fn_experiment_v2_stamp_facility_safe_lease(),
    public.fn_experiment_v2_state_insert_binding(),
    public.fn_experiment_v2_work_insert_binding();

DO $dropped$
BEGIN
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace
            AND c.relname = ANY(
            ARRAY['experiment_v2_approvals', 'experiment_v2_bundle_attempts', 'experiment_v2_candidate_revisions',
                'experiment_v2_component_outcomes', 'experiment_v2_contract_constants', 'experiment_v2_day_evidence',
                'experiment_v2_delivery_bundle_completions', 'experiment_v2_delivery_bundles',
                'experiment_v2_direct_launch_waivers', 'experiment_v2_direct_proof_attempt_events',
                'experiment_v2_direct_proof_attempt_work', 'experiment_v2_direct_proof_authorizations',
                'experiment_v2_direct_proof_emergency_recovery_attempt_events',
                'experiment_v2_direct_proof_emergency_recovery_receipts',
                'experiment_v2_direct_proof_emergency_resolutions', 'experiment_v2_direct_proof_receipts',
                'experiment_v2_exports', 'experiment_v2_exposure_closures', 'experiment_v2_exposures',
                'experiment_v2_facility_safe_closures', 'experiment_v2_observation_epochs',
                'experiment_v2_observation_receipts', 'experiment_v2_outcome_freezes',
                'experiment_v2_outcome_source_bindings', 'experiment_v2_outcomes',
                'experiment_v2_preexposure_mismatch_epochs', 'experiment_v2_randomization', 'experiment_v2_reveals',
                'experiment_v2_runtime_faults', 'experiment_v2_runtime_generations',
                'experiment_v2_runtime_snapshots', 'experiment_v2_selector_choices',
                'experiment_v2_selector_contexts', 'experiment_v2_shadow_choices', 'experiment_v2_shadow_contexts',
                'experiment_v2_shadow_cycles', 'experiment_v2_shadow_outcome_previews',
                'experiment_v2_state_artifacts', 'experiment_v2_work', 'experiment_v2_work_events', 'twin_decisions',
                'twin_live_results', 'firmware_twin_divergence', 'planner_graph_runs', 'planner_memory_items',
                'planner_memory_retrievals', 'planner_pack', 'forecast_deviation_thresholds',
                'v_experiment_v2_blinded_assigned_day_outcomes', 'v_experiment_v2_frozen_analyzer_input',
                'v_experiment_v2_revealed_analyzer_input', 'v_experiment_v2_selector_climate_source',
                'v_experiment_v2_selector_forecast_source', 'v_policy_twin_asof_input', 'v_planner_experiments',
                'v_planner_experiment_events', 'v_planner_assignments', 'v_iris_experiment_context',
                'v_runtime_v1_iris_experiment_context', 'experiment_v2_bundle_attempts_attempt_id_seq',
                'experiment_v2_component_outcomes_component_outcome_id_seq',
                'experiment_v2_runtime_generations_generation_event_id_seq',
                'experiment_v2_work_events_work_event_id_seq']))
        OR EXISTS(SELECT 1 FROM unnest(
            ARRAY['fn_experiment_v2_all_assignment_windows_bound(uuid,timestamp with time zone)',
                'fn_experiment_v2_api_status(uuid)', 'fn_experiment_v2_approval_insert_binding()',
                'fn_experiment_v2_assignment_uuid(uuid,text,date)',
                'fn_experiment_v2_assignment_window_is_bound(uuid,uuid,timestamp with time zone)',
                'fn_experiment_v2_begin_delivery_bundle(uuid,uuid,uuid,text,text,text)',
                'fn_experiment_v2_boundary_cycle(uuid,text)',
                'fn_experiment_v2_build_selector_context(uuid,date,timestamp with time zone,timestamp with time zone)',
                'fn_experiment_v2_claim_executor_candidate(uuid,text,bigint,text)',
                'fn_experiment_v2_close_exposure(uuid,text,text)', 'fn_experiment_v2_complete(uuid,text,text)',
                'fn_experiment_v2_complete_at(uuid,timestamp with time zone,text,text)',
                'fn_experiment_v2_configure(uuid,text,text,text,text,text,text,uuid,text,bigint,text)',
                'fn_experiment_v2_context_insert_binding()',
                'fn_experiment_v2_create_work(uuid,text,text,tstzrange,timestamp with time zone,text)',
                'fn_experiment_v2_day1_approval_audit_binding()', 'fn_experiment_v2_direct_interposition_insert()',
                'fn_experiment_v2_direct_launch_approve_day1(uuid,text)',
                'fn_experiment_v2_direct_launch_commit(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text)',
                'fn_experiment_v2_direct_launch_cycle(uuid,text)',
                'fn_experiment_v2_direct_launch_cycle_pre238(uuid,text)',
                'fn_experiment_v2_direct_launch_lock(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_open_randomized(uuid,text)',
                'fn_experiment_v2_direct_proof_attempt_status(uuid)',
                'fn_experiment_v2_direct_proof_begin(uuid,text,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_proof_begin_baseline_after(uuid,uuid,text)',
                'fn_experiment_v2_direct_proof_begin_emergency_recovery(uuid,uuid,text,bigint,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_proof_finish(uuid,text)',
                'fn_experiment_v2_direct_proof_finish_emergency_recovery(uuid,uuid,text)',
                'fn_experiment_v2_direct_proof_open_aggressive(uuid,uuid,text)',
                'fn_experiment_v2_direct_proof_receipt_attempt_binding()',
                'fn_experiment_v2_direct_proof_recovery_generation_guard()',
                'fn_experiment_v2_direct_proof_resolve_emergency(uuid,uuid,text,bigint,text,text,text,text)',
                'fn_experiment_v2_direct_proof_resolve_startup_rollover(uuid,uuid,text,text)',
                'fn_experiment_v2_direct_proof_retry_emergency_recovery(uuid,uuid,uuid,text,bigint,tstzrange,text,text,text)',
                'fn_experiment_v2_direct_proof_work_attempt_guard()',
                'fn_experiment_v2_direct_waiver_proof_binding()', 'fn_experiment_v2_due_assignment(uuid)',
                'fn_experiment_v2_due_shadow_cycle(uuid)', 'fn_experiment_v2_executor_runtime(uuid,text)',
                'fn_experiment_v2_exposure_insert_guard()', 'fn_experiment_v2_facility_safe_insert_guard()',
                'fn_experiment_v2_finalize_assignment(uuid,uuid,text)',
                'fn_experiment_v2_finalize_assignment_at(uuid,uuid,timestamp with time zone,text)',
                'fn_experiment_v2_finalize_randomization(uuid,text)',
                'fn_experiment_v2_freeze_day_evidence(uuid,uuid,jsonb,jsonb,jsonb,text)',
                'fn_experiment_v2_freeze_day_evidence_at(uuid,uuid,jsonb,jsonb,jsonb,timestamp with time zone,text)',
                'fn_experiment_v2_freeze_export(uuid,text,text)',
                'fn_experiment_v2_freeze_export_at(uuid,text,timestamp with time zone,text)',
                'fn_experiment_v2_freeze_outcome(uuid,uuid,jsonb,boolean,boolean,boolean,boolean,boolean,text)',
                'fn_experiment_v2_freeze_outcome_at(uuid,uuid,jsonb,boolean,boolean,boolean,boolean,boolean,timestamp with time zone,text)',
                'fn_experiment_v2_gate_p_sealed_recovery_target(uuid)',
                'fn_experiment_v2_generation_recovery_cleared(uuid,bigint)', 'fn_experiment_v2_immutable()',
                'fn_experiment_v2_json_string(text)', 'fn_experiment_v2_launch_gate_status()',
                'fn_experiment_v2_lock_design(uuid,date,integer,time without time zone,text,text,text,text,text,text,text,text,text,text,text)',
                'fn_experiment_v2_monitor_open_exposure(uuid,text,bigint)',
                'fn_experiment_v2_open_exposure(uuid,uuid,text,text)', 'fn_experiment_v2_ops_status()',
                'fn_experiment_v2_outcome_source_bindings_immutable()',
                'fn_experiment_v2_outcome_source_cycle(uuid)', 'fn_experiment_v2_randomization_insert_binding()',
                'fn_experiment_v2_read_delivery_bundle(uuid,uuid,text,text,bigint)',
                'fn_experiment_v2_read_observation_window(uuid,uuid,uuid,text,bigint)',
                'fn_experiment_v2_receipt_canonical(text,uuid,text,text,uuid,uuid,uuid,jsonb,text,text,text,text,bigint,bigint,timestamp with time zone)',
                'fn_experiment_v2_receipt_insert_binding()',
                'fn_experiment_v2_record_approval(uuid,text,text,integer,text,text,tstzrange,timestamp with time zone,text,text,text)',
                'fn_experiment_v2_record_component_outcome(uuid,uuid,uuid,integer,text,text,bigint,bigint,text)',
                'fn_experiment_v2_record_delivery_bundle(uuid,uuid,uuid,timestamp with time zone,text)',
                'fn_experiment_v2_record_facility_safe_closure(uuid,text,text,text)',
                'fn_experiment_v2_record_observation_epoch(uuid,uuid,uuid,uuid,bytea,jsonb,text,text,text,text,bigint,bigint,text)',
                'fn_experiment_v2_record_preexposure_mismatch(uuid,uuid,uuid,text,uuid,bytea,jsonb,text,text,text,text,uuid,bigint,bigint,bigint,text)',
                'fn_experiment_v2_record_runtime_snapshot(uuid,text,uuid,bytea,jsonb,text,text,text,text,uuid,bigint,bigint,boolean,text)',
                'fn_experiment_v2_record_selector_choice(uuid,uuid,text,text,text,text,text,text,text[],text,text)',
                'fn_experiment_v2_record_selector_choice_at(uuid,uuid,text,text,text,text,text,text,text[],text,timestamp with time zone,text)',
                'fn_experiment_v2_record_shadow_choice(uuid,uuid,text,text,text,text,text,text,text[],text,text)',
                'fn_experiment_v2_record_shadow_choice_at(uuid,uuid,text,text,text,text,text,text,text[],text,timestamp with time zone,text)',
                'fn_experiment_v2_record_shadow_outcome_preview(uuid,uuid,jsonb,text)',
                'fn_experiment_v2_record_shadow_outcome_preview_at(uuid,uuid,jsonb,timestamp with time zone,text)',
                'fn_experiment_v2_record_work_event(uuid,uuid,text,jsonb,text)',
                'fn_experiment_v2_recovery_authority_cleared(uuid,uuid)',
                'fn_experiment_v2_register_runtime_instance(uuid,text,uuid,bigint,text)',
                'fn_experiment_v2_register_state(uuid,text,smallint,bytea,bytea,text)',
                'fn_experiment_v2_report_runtime_fault(uuid,text,uuid,bigint,uuid,bigint,bigint,text,text,text)',
                'fn_experiment_v2_request_recovery(uuid,uuid,tstzrange,timestamp with time zone,text,text)',
                'fn_experiment_v2_request_recovery_at(uuid,uuid,tstzrange,timestamp with time zone,text,timestamp with time zone,text)',
                'fn_experiment_v2_require_day1_approval()', 'fn_experiment_v2_require_outcome_source_binding()',
                'fn_experiment_v2_resolve_randomized(uuid,uuid,bigint)',
                'fn_experiment_v2_resolve_readiness(uuid,uuid,bigint)',
                'fn_experiment_v2_resolve_recovery(uuid,uuid,bigint)', 'fn_experiment_v2_reveal(uuid,text)',
                'fn_experiment_v2_reveal_at(uuid,timestamp with time zone,text)',
                'fn_experiment_v2_runtime_snapshot_insert_binding()',
                'fn_experiment_v2_safe_startup_attestation(text,uuid)', 'fn_experiment_v2_schedule_canonical(jsonb)',
                'fn_experiment_v2_schedule_shadow_cycle(uuid,date,timestamp with time zone,text,text,text,text,text,text)',
                'fn_experiment_v2_schedule_shadow_cycle_at(uuid,date,timestamp with time zone,text,text,text,text,text,timestamp with time zone,text)',
                'fn_experiment_v2_selector_cycle(uuid)',
                'fn_experiment_v2_selector_cycle_at(uuid,timestamp with time zone)',
                'fn_experiment_v2_selector_insert_binding()',
                'fn_experiment_v2_selector_invocation_uuid(uuid,text,date)',
                'fn_experiment_v2_set_admission(uuid,text,text,text)',
                'fn_experiment_v2_shadow_cycle_uuid(uuid,text,date,text)',
                'fn_experiment_v2_stamp_facility_safe_lease()',
                'fn_experiment_v2_state_content_sha256(smallint,bytea,bytea)',
                'fn_experiment_v2_state_insert_binding()',
                'fn_experiment_v2_terminalize_legacy_expired_recovery(uuid,uuid,bigint,text)',
                'fn_experiment_v2_timestamp_text(timestamp with time zone)',
                'fn_experiment_v2_transition(uuid,text,text,text,text)', 'fn_experiment_v2_work_insert_binding()',
                'fn_experiment_v2_work_is_eligible(uuid,uuid,bigint,timestamp with time zone,text)']) s WHERE to_regprocedure('public.' || s) IS NOT NULL)
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ANY(
            ARRAY['verdify_experiment_lifecycle', 'verdify_experiment_component_executor',
                'verdify_experiment_shadow_scheduler', 'verdify_experiment_randomizer',
                'verdify_experiment_outcome_freezer', 'verdify_experiment_blinded_analyst',
                'verdify_experiment_v2_lifecycle_login', 'verdify_experiment_v2_component_executor_login',
                'verdify_experiment_v2_shadow_scheduler_login', 'verdify_experiment_v2_randomizer_login',
                'verdify_experiment_v2_outcome_freezer_login', 'twin_ro', 'verdify_twin_ro']))
        OR (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_catalog.pg_proc p
            WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn\_experiment\_v2\_%')
            IS DISTINCT FROM ARRAY['fn_experiment_v2_control_guard','fn_experiment_v2_require_end_recovery_completion']
        OR (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.control_experiments'::regclass
            AND tgname IN ('trg_experiment_v2_control_guard','trg_experiment_v2_end_recovery_completion'))<>2
        OR to_regclass('public.equipment_direct_state_snapshots') IS NULL
        OR NOT has_function_privilege('verdify_experiment_equipment_source_collector',
            'public.fn_record_equipment_direct_state_snapshot(uuid,uuid,text,text,jsonb,double precision,uuid,bigint,text)',
            'EXECUTE')
        OR to_regclass('public.v_active_plan') IS NULL
        OR to_regprocedure('public.fn_house_vpd_control_band(timestamptz)') IS NULL
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.planner_inference_runs'::regclass
            AND contype='f' AND conname='planner_inference_runs_pack_sha256_fkey')
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.planner_inference_runs'::regclass
            AND attname='pack_sha256' AND NOT attisdropped)
        -- No runtime role writes setpoint_plan; the MCP duty still reads it.
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE NOT r.rolsuper AND r.rolname !~ '^pg_'
            AND has_table_privilege(r.oid, 'public.setpoint_plan', 'INSERT,UPDATE,DELETE,TRUNCATE'))
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE NOT r.rolsuper AND r.rolname !~ '^pg_'
            AND has_any_column_privilege(r.oid, 'public.setpoint_plan', 'INSERT,UPDATE'))
        OR NOT has_table_privilege('verdify_mcp_runtime', 'public.setpoint_plan', 'SELECT')
    THEN RAISE EXCEPTION '316 did not drop exactly its list'; END IF;
END $dropped$;

-- Successor seals: the probe of the rolled-back native qualification measures them, and each receipt is re-sealed.
-- Until measured, these are 315's values and the block refuses (fail closed).
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '7022e3a448569e051a81a19ff621bade902fab0b393c2e45756f7bb9449702dc'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '3ead905daede269bd598b38c86c0477d33e1b51c425a2efc7d5c16c042a745f2'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'ae8180a5fc5dc400fc0f9c49fc6f069c89af033a9b9425ef52a14bf85b202256'
    THEN RAISE EXCEPTION '316 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('7022e3a448569e051a81a19ff621bade902fab0b393c2e45756f7bb9449702dc','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '316 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('3ead905daede269bd598b38c86c0477d33e1b51c425a2efc7d5c16c042a745f2','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '316 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('ae8180a5fc5dc400fc0f9c49fc6f069c89af033a9b9425ef52a14bf85b202256','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '316 missing mcp receipt'; END IF;
    IF EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
    THEN RAISE EXCEPTION '316 receipts do not match the successor seals'; END IF;
END $successor$;
