-- 309 (one band): the served house band is the only temp/VPD measurement; planning water excludes house use; resource
-- cost leaves the planner reward (#1623); the crop-band grading, the inference-infra telemetry and never-written
-- daily_summary columns retire. Jason, 2026-11-15: one release, no soak; the dropped data is archived before the sync.
--
-- One band. 290's served-band grading (fn_band_compliance_5m -> daily_band_compliance -> daily_summary.compliance_pct,
-- temp_/vpd_compliance_pct, stress_hours_*) is the only definition:
--   planner_score = compliance_pct (both axes in the served band) at 100 % weight, in v_daily_kpi, mv_daily_kpi,
--     v_planner_performance and fn_planner_scorecard (contract 3). The scorecard reads every metric from
--     mv_daily_kpi and drops the compliance_v2/graded metrics; it adds none, so older readers still validate.
--   v_stress_hours_today keeps its five columns and reads today's served-band stress hours from daily_summary
--     (verdify_matview_refresh_runtime.fn_refresh_band_compliance rewrites today every 30 minutes).
--   fn_band_timeline's actual_* and firmware_* lines read the band_house_* audit rows (the band the grading uses, same
--     600 s window), not setpoint_changes temp/VPD events, which stopped on 2026-09-06.
--   The crop-band grading retires: daily_zone_compliance, compliance_zone_weights, mv_zone_band_grade, v_zone_band,
--     v_target_curve, v_scorecard_climate_diagnostics, fn_zone_band, fn_zone_band_grade, fn_compliance_v2,
--     fn_grade_credit, fn_compliance_pct, fn_house_compliance, fn_observed_minute_diagnostic, and daily_summary's
--     compliance_v2_*, graded_*, feasibility_unknown_min and climate_observed_minute_metrics. crop_target_profiles
--     stays (DLI target, catalog, and fn_center_band_setpoints' fallback when the anchors are missing).
--   daily_climate_metric_revisions captures daily-summary-capture-v3: the served-band ("binary") keys only.
-- Water. v_water_attribution_daily appends planning_water_gal (climate wetting + wall irrigation + wall fertigation)
--   and house_water_gal (manual or unattributed, e.g. hose use). v_daily_kpi water_gal, water_gal_est and
--   cost_water_est use planning gallons; there is no raw-meter fallback. Scoreability is unchanged.
-- Cost (#1623). Resource cost is reported, never rewarded: resource_terms_available is false and
--   planner_score_resource_weight_pct 0 by definition. v_runtime_energy_daily.available_for_scoring needs complete
--   runtime evidence and nominal coefficients on a completed day, not zero-width coefficient bounds, so kwh, therms
--   and cost_* populate from the nominal model; modeled_kwh_low/high carry the bounds and model_quality still says
--   uncertain_coefficients.
-- Inference-infra telemetry (out of scope for verdify): gpu_power, infra_cpu, v_gpu_power_latest, v_infra_cpu_latest,
--   the runtime write facades v_runtime_gpu_power_write and v_runtime_infra_cpu_write, and 268's Grafana wrappers.
-- Retired, no readers: achievable_envelope, weather_station, daily_summary_compliance_backup_20260430,
--   openclaw_interaction_log and v_openclaw_usage_daily/hourly; daily_summary kwh_heat, kwh_fans, kwh_other,
--   gas_used_therms, dev_temp_norm_*, dev_vpd_norm_*, notes, cycles_dehum, cycles_safety_dehum (no dehumidifier) and
--   dli_final (v_dli_daily.forensic_proxy_present is now always false).
-- Dependents: 268's per-login daily_summary wrappers and the v_planner_performance wrapper are dropped and recreated
--   with their columns minus the retired ones and the same grants; v_plan_window_scorecard is recreated unchanged.
--   fn_runtime_ordinary_boundary_digest names the two GPU/CPU facades and five crop-band helpers in its closure lists,
--   so it is redefined without them (protected relations 50 -> 48, invoker helper closure 35 -> 30).
-- 309 chains from exact308; the rolled-back native qualification measured the successor seals.
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=308 AND filename='db/migrations/308-dli-canopy-ppfd.sql'
            AND sha256='564c6df281c836a19a4632caf6ed001832bbd1d5da5749b8a5d607a1bb4a752d'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>308)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'abe5012d9c2c9a4d02049b7ab585ff883e3e855d8065fadb18f59ade662307e0'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '0d7c46acb4cd65df380602c94ff0efc9acf2dea64768c4b7dea12ed7cdf3ef2f'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '5d3e5448a5f35ba198ef830fef8946df92ecbbca921e7b20a84d30ba7cbb7d49'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR to_regclass('public.daily_zone_compliance') IS NULL
        OR to_regclass('public.gpu_power') IS NULL
        OR to_regclass('public.v_scorecard_climate_diagnostics') IS NULL
        OR to_regprocedure('public.fn_zone_band_grade(timestamptz,timestamptz,text)') IS NULL
        OR to_regprocedure('verdify_grafana_runtime.fn_read_v_planner_performance()') IS NULL
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.daily_summary'::regclass
            AND attname='compliance_v2_attributable_pct' AND NOT attisdropped)
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint
            WHERE conrelid='public.daily_climate_metric_revisions'::regclass
              AND conname='daily_climate_metric_revisions_capture_schema_check')
    THEN RAISE EXCEPTION '309 refuses an unqualified predecessor'; END IF;
END $predecessor$;

-- The ordinary boundary digest without the retired facades and helpers (protected relations 48, closure 30).
CREATE OR REPLACE FUNCTION public.fn_runtime_ordinary_boundary_digest(p_login_name text)
 RETURNS bytea
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
    v_duty_name text;
    v_catalog text;
    v_protected_relations text[] := ARRAY[
        'control_experiments', 'experiment_events',
        'control_assignments', 'qualification_transition_slots',
        'control_transition_ledger', 'policy_proposals',
        'policy_proposal_components', 'effective_policy_vectors',
        'effective_policy_vector_components',
        'policy_delivery_outbox', 'policy_delivery_attempts',
        'policy_device_snapshots', 'policy_exposures',
        'policy_templates', 'experiment_context_snapshots',
        'water_meter_events',
        'water_meter_materializer_state', 'v_climate_merged',
        'v_relay_stuck', 'mv_band_curve',
        'v_runtime_climate_write',
        'v_runtime_climate_action_log_write',
        'v_runtime_diagnostics_write',
        'v_runtime_energy_write',
        'v_runtime_equipment_state_write',
        'v_runtime_esp32_logs_write',
        'v_runtime_forecast_deviation_log_write',
        'v_runtime_override_events_write',
        'v_runtime_setpoint_changes_write',
        'v_runtime_setpoint_clamps_write',
        'v_runtime_setpoint_plan_write',
        'v_runtime_setpoint_snapshot_write',
        'v_runtime_system_state_write',
        'v_runtime_weather_forecast_write',
        'forecast_action_rules', 'forecast_action_log',
        'dli_validity_intervals',
        'v_greenhouse_now', 'v_system_health_score',
        'v_slack_crop_tasks_due',
        'slack_alert_runbooks',
        'runtime_ordinary_login_attestation_receipts',
        'control_transition_ledger_ledger_id_seq',
        'experiment_events_event_id_seq',
        'forecast_action_log_id_seq',
        'policy_delivery_attempts_attempt_id_seq',
        'policy_device_snapshots_snapshot_id_seq',
        'water_meter_events_id_seq'
    ];
    v_protected_sequences text[] := ARRAY[
        'control_transition_ledger_ledger_id_seq',
        'experiment_events_event_id_seq',
        'forecast_action_log_id_seq',
        'policy_delivery_attempts_attempt_id_seq',
        'policy_device_snapshots_snapshot_id_seq',
        'water_meter_events_id_seq'
    ];
    v_internal_callees regprocedure[] := ARRAY[
        'public.fn_runtime_assert_protocol_v1(uuid)'::regprocedure,
        'public.fn_runtime_v1_append_event(uuid,uuid,text,text,text,jsonb)'::regprocedure,
        'public.fn_runtime_v1_close_assignment(uuid,uuid,timestamptz,integer,text)'::regprocedure,
        'public.fn_runtime_v1_delivery_fence(uuid,text,integer,text[])'::regprocedure,
        'public.fn_runtime_v1_finalize_delivery_impl(uuid,text,integer,bigint,text,boolean)'::regprocedure,
        'public.fn_experiment_transition(uuid,text,text,text)'::regprocedure,
        'public.fn_create_assignment(uuid,text,text,text,tstzrange,uuid,integer,integer,text,text,text,text,jsonb,text)'::regprocedure,
        'public.fn_claim_qualification_slot(uuid,jsonb,tstzrange,text,jsonb,text)'::regprocedure,
        'public.fn_resolve_qualification_slot(uuid,text,jsonb,text)'::regprocedure,
        'public.fn_record_qualification_event(uuid,text,jsonb,uuid,uuid,text)'::regprocedure,
        'public.fn_submit_policy_proposal(text,text,uuid,jsonb,text,jsonb,text,text,uuid,uuid,tstzrange,text,text)'::regprocedure,
        'public.fn_admit_policy_vector(uuid,text,tstzrange,text,bytea,text,text,bigint)'::regprocedure,
        'public.fn_record_device_snapshot(text,text,text,bigint,uuid,text,text,text,text,tstzrange,timestamptz)'::regprocedure,
        'public.fn_open_exposure(uuid,text,bigint,text)'::regprocedure,
        'public.fn_close_exposure(uuid,text,bigint,timestamptz,text)'::regprocedure,
        'public.fn_freeze_experiment_context(uuid,text,uuid,text,text,text,text,text,text,jsonb,uuid)'::regprocedure,
        'public.fn_bind_experiment_result(uuid,text,text,text)'::regprocedure,
        'public.fn_policy_template_is_complete(uuid)'::regprocedure,
        'public.fn_policy_wire_field_count()'::regprocedure,
        'public.materialize_water_meter_events(text,timestamptz)'::regprocedure
    ];
    v_invoker_helper_closure regprocedure[] := ARRAY[
        'public.fn_band_setpoints(timestamptz)'::regprocedure,
        'public.fn_band_trace(timestamptz,timestamptz,text)'::regprocedure,
        'public.fn_band_setpoint_provenance(timestamptz,text)'::regprocedure,
        'public.fn_center_band_setpoints(timestamptz)'::regprocedure,
        'public.fn_crop_band_value(text,text,timestamptz,text,text,text)'::regprocedure,
        'public.fn_current_season()'::regprocedure,
        'public.fn_diurnal_interp(timestamptz,double precision,double precision)'::regprocedure,
        'public.fn_dli_validity(timestamptz,text)'::regprocedure,
        'public.fn_dli_proxy_lesson_invalid(text,text)'::regprocedure,
        'public.fn_dli_source_invalid_reason(double precision)'::regprocedure,
        'public.fn_equip_at(text,timestamptz)'::regprocedure,
        'public.fn_equipment_health()'::regprocedure,
        'public.fn_forecast_correction(text,numeric)'::regprocedure,
        'public.fn_heat_staging_inversion()'::regprocedure,
        'public.fn_hermite_phase(double precision,double precision,double precision,double precision,double precision,double precision)'::regprocedure,
        'public.fn_house_vpd_control_band(timestamptz)'::regprocedure,
        'public.fn_lighting_circuit_policy(timestamptz,text)'::regprocedure,
        'public.fn_lighting_lux_threshold_recommendation(timestamptz,text,interval)'::regprocedure,
        'public.fn_lighting_minutes_policy(timestamptz,text)'::regprocedure,
        'public.fn_lighting_policy(timestamptz,text)'::regprocedure,
        'public.fn_plan_transition_audit(text,interval,interval)'::regprocedure,
        'public.fn_planner_scorecard(date)'::regprocedure,
        'public.fn_setpoint_at(text,timestamptz)'::regprocedure,
        'public.fn_setpoint_at(text,text,timestamptz)'::regprocedure,
        'public.fn_solar_altitude(timestamptz)'::regprocedure,
        'public.fn_solar_phase(timestamptz)'::regprocedure,
        'public.fn_solar_sunrise_hour(timestamptz)'::regprocedure,
        'public.fn_solar_sunset_hour(timestamptz)'::regprocedure,
        'public.fn_system_health()'::regprocedure,
        'public.fn_zone_vpd_targets(timestamptz)'::regprocedure
    ];
BEGIN
    v_duty_name := CASE p_login_name
        WHEN 'verdify_api_runtime_login' THEN 'verdify_api_runtime'
        WHEN 'verdify_ingestor_runtime_login' THEN 'verdify_ingestor_runtime'
        ELSE NULL
    END;
    IF v_duty_name IS NULL THEN
        RAISE EXCEPTION 'unrecognized ordinary runtime login'
            USING ERRCODE = '42501';
    END IF;
    IF pg_catalog.cardinality(v_internal_callees) <> 20
       OR pg_catalog.cardinality(v_invoker_helper_closure) <> 30
       OR pg_catalog.cardinality(v_protected_relations) <> 48
       OR pg_catalog.cardinality(v_protected_sequences) <> 6
       OR (SELECT count(DISTINCT callee_oid)
             FROM pg_catalog.unnest(v_internal_callees) callee(callee_oid)) <>
          pg_catalog.cardinality(v_internal_callees)
       OR (SELECT count(DISTINCT helper_oid)
             FROM pg_catalog.unnest(v_invoker_helper_closure)
                  helper(helper_oid)) <>
          pg_catalog.cardinality(v_invoker_helper_closure)
       OR (SELECT count(*)
             FROM pg_class relation
             JOIN pg_namespace namespace_row
               ON namespace_row.oid = relation.relnamespace
            WHERE namespace_row.nspname = 'public'
              AND relation.relname = ANY (v_protected_relations)) <>
          pg_catalog.cardinality(v_protected_relations)
       OR (SELECT count(*)
             FROM pg_class relation
             JOIN pg_namespace namespace_row
               ON namespace_row.oid = relation.relnamespace
            WHERE namespace_row.nspname = 'public'
              AND relation.relkind = 'S'
              AND relation.relname = ANY (v_protected_sequences)) <>
          pg_catalog.cardinality(v_protected_sequences) THEN
        RAISE EXCEPTION 'ordinary runtime authority closure is incomplete';
    END IF;

    WITH security_entries(entry) AS (
        SELECT pg_catalog.format(
                   'role|%s|login=%s|inherit=%s|super=%s|createdb=%s|'
                   'createrole=%s|replication=%s|bypassrls=%s|config=%s',
                   role_row.rolname, role_row.rolcanlogin,
                   role_row.rolinherit, role_row.rolsuper,
                   role_row.rolcreatedb, role_row.rolcreaterole,
                   role_row.rolreplication, role_row.rolbypassrls,
                   coalesce(role_row.rolconfig::text, ''))
          FROM pg_roles role_row
         WHERE role_row.rolname = ANY (ARRAY[
                   'verdify_api_runtime', 'verdify_ingestor_runtime',
                   'verdify_api_runtime_login',
                   'verdify_ingestor_runtime_login'])
        UNION ALL
        SELECT pg_catalog.format(
                   'member|role=%s|member=%s|grantor=%s|admin=%s|'
                   'inherit=%s|set=%s',
                   granted.rolname, member.rolname, grantor.rolname,
                   membership.admin_option, membership.inherit_option,
                   membership.set_option)
          FROM pg_auth_members membership
          JOIN pg_roles granted ON granted.oid = membership.roleid
          JOIN pg_roles member ON member.oid = membership.member
          JOIN pg_roles grantor ON grantor.oid = membership.grantor
         WHERE granted.rolname = ANY (ARRAY[
                   'verdify_api_runtime', 'verdify_ingestor_runtime',
                   'verdify_api_runtime_login',
                   'verdify_ingestor_runtime_login'])
            OR member.rolname = ANY (ARRAY[
                   'verdify_api_runtime', 'verdify_ingestor_runtime',
                   'verdify_api_runtime_login',
                   'verdify_ingestor_runtime_login'])
        UNION ALL
        SELECT pg_catalog.format(
                   'database-role-setting|role=%s|database=%s|settings=%s',
                   role_row.rolname, database_row.datname,
                   setting_row.setconfig::text)
          FROM pg_db_role_setting setting_row
          JOIN pg_roles role_row ON role_row.oid = setting_row.setrole
          JOIN pg_database database_row
            ON database_row.oid = setting_row.setdatabase
         WHERE role_row.rolname = ANY (ARRAY[
                   'verdify_api_runtime', 'verdify_ingestor_runtime',
                   'verdify_api_runtime_login',
                   'verdify_ingestor_runtime_login'])
        UNION ALL
        SELECT pg_catalog.format(
                   'database|%s|owner=%s|acl=%s|connect=%s|create=%s|temp=%s',
                   database_row.datname, owner_role.rolname,
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format('%s:%s:%s', acl.grantee,
                                             acl.privilege_type,
                                             acl.is_grantable), ','
                           ORDER BY acl.grantee, acl.privilege_type,
                                    acl.is_grantable)
                         FROM pg_catalog.aclexplode(database_row.datacl) acl),
                       ''),
                   has_database_privilege(
                       p_login_name, database_row.oid, 'CONNECT'),
                   has_database_privilege(
                       p_login_name, database_row.oid, 'CREATE'),
                   has_database_privilege(
                       p_login_name, database_row.oid, 'TEMP'))
          FROM pg_database database_row
          JOIN pg_roles owner_role ON owner_role.oid = database_row.datdba
         WHERE database_row.datname = current_database()
        UNION ALL
        SELECT pg_catalog.format(
                   'schema|%s|owner=%s|acl=%s|usage=%s|create=%s',
                   namespace_row.nspname, owner_role.rolname,
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format('%s:%s:%s', acl.grantee,
                                             acl.privilege_type,
                                             acl.is_grantable), ','
                           ORDER BY acl.grantee, acl.privilege_type,
                                    acl.is_grantable)
                         FROM pg_catalog.aclexplode(namespace_row.nspacl) acl),
                       ''),
                   has_schema_privilege(
                       p_login_name, namespace_row.oid, 'USAGE'),
                   has_schema_privilege(
                       p_login_name, namespace_row.oid, 'CREATE'))
          FROM pg_namespace namespace_row
          JOIN pg_roles owner_role ON owner_role.oid = namespace_row.nspowner
         WHERE namespace_row.nspname !~ '^pg_'
           AND namespace_row.nspname <> 'information_schema'
           AND NOT EXISTS (
               SELECT 1 FROM pg_depend dependency
                WHERE dependency.classid = 'pg_namespace'::regclass
                  AND dependency.objid = namespace_row.oid
                  AND dependency.refclassid = 'pg_extension'::regclass
                  AND dependency.deptype = 'e')
           AND (has_schema_privilege(
                    p_login_name, namespace_row.oid, 'USAGE')
                OR has_schema_privilege(
                    p_login_name, namespace_row.oid, 'CREATE')
                OR owner_role.rolname = ANY (ARRAY[
                    'verdify_api_runtime', 'verdify_ingestor_runtime',
                    'verdify_api_runtime_login',
                    'verdify_ingestor_runtime_login'])
                OR EXISTS (
                    SELECT 1
                      FROM pg_catalog.aclexplode(namespace_row.nspacl) acl
                     WHERE acl.grantee = 0
                        OR acl.grantee = ANY (ARRAY[
                            (SELECT oid FROM pg_roles
                              WHERE rolname = 'verdify_api_runtime'),
                            (SELECT oid FROM pg_roles
                              WHERE rolname = 'verdify_ingestor_runtime'),
                            (SELECT oid FROM pg_roles
                              WHERE rolname = 'verdify_api_runtime_login'),
                            (SELECT oid FROM pg_roles
                              WHERE rolname =
                                    'verdify_ingestor_runtime_login')])))
        UNION ALL
        SELECT pg_catalog.format(
                   'relation|%I.%I|kind=%s|owner=%s|rls=%s:%s|acl=%s|'
                   'effective=%s:%s:%s:%s:%s:%s:%s|columns=%s|view=%s|'
                   'constraints=%s|options=%s|rules=%s|triggers=%s|policies=%s',
                   namespace_row.nspname, relation.relname,
                   relation.relkind, owner_role.rolname,
                   relation.relrowsecurity, relation.relforcerowsecurity,
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format('%s:%s:%s', acl.grantee,
                                             acl.privilege_type,
                                             acl.is_grantable), ','
                           ORDER BY acl.grantee, acl.privilege_type,
                                    acl.is_grantable)
                         FROM pg_catalog.aclexplode(relation.relacl) acl), ''),
                   has_table_privilege(p_login_name, relation.oid, 'SELECT'),
                   has_table_privilege(p_login_name, relation.oid, 'INSERT'),
                   has_table_privilege(p_login_name, relation.oid, 'UPDATE'),
                   has_table_privilege(p_login_name, relation.oid, 'DELETE'),
                   has_table_privilege(p_login_name, relation.oid, 'TRUNCATE'),
                   has_table_privilege(p_login_name, relation.oid, 'REFERENCES'),
                   has_table_privilege(p_login_name, relation.oid, 'TRIGGER'),
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format(
                               '%s:%s:%s:%s:%s:%s:%s:%s',
                               attribute_row.attnum,
                               attribute_row.attname,
                               pg_catalog.format_type(
                                   attribute_row.atttypid,
                                   attribute_row.atttypmod),
                               attribute_row.attnotnull,
                               attribute_row.attidentity,
                               attribute_row.attgenerated,
                               coalesce((
                                   SELECT pg_catalog.pg_get_expr(
                                              default_row.adbin,
                                              default_row.adrelid, true)
                                     FROM pg_attrdef default_row
                                    WHERE default_row.adrelid = relation.oid
                                      AND default_row.adnum =
                                          attribute_row.attnum), ''),
                               coalesce((
                                   SELECT pg_catalog.string_agg(
                                       pg_catalog.format('%s:%s:%s',
                                           acl.grantee, acl.privilege_type,
                                           acl.is_grantable), ','
                                       ORDER BY acl.grantee,
                                                acl.privilege_type,
                                                acl.is_grantable)
                                     FROM pg_catalog.aclexplode(
                                         attribute_row.attacl) acl), '')), '|'
                           ORDER BY attribute_row.attnum)
                         FROM pg_attribute attribute_row
                        WHERE attribute_row.attrelid = relation.oid
                          AND attribute_row.attnum > 0
                          AND NOT attribute_row.attisdropped), ''),
                   CASE WHEN relation.relkind IN ('v','m')
                        THEN pg_catalog.pg_get_viewdef(relation.oid, true)
                        ELSE '' END,
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format('%s:%s:%s',
                               constraint_row.conname,
                               constraint_row.contype,
                               pg_catalog.pg_get_constraintdef(
                                   constraint_row.oid, true)), '|'
                           ORDER BY constraint_row.conname,
                                    constraint_row.oid)
                         FROM pg_constraint constraint_row
                        WHERE constraint_row.conrelid = relation.oid), ''),
                   coalesce((
                       SELECT pg_catalog.string_agg(option, ',' ORDER BY option)
                         FROM pg_catalog.unnest(relation.reloptions) option), ''),
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format('%s:%s:%s:%s:%s',
                               rewrite_row.rulename, rewrite_row.ev_type,
                               rewrite_row.is_instead, rewrite_row.ev_enabled,
                               pg_catalog.pg_get_ruledef(rewrite_row.oid, true)),
                           '|' ORDER BY rewrite_row.rulename, rewrite_row.oid)
                         FROM pg_rewrite rewrite_row
                        WHERE rewrite_row.ev_class = relation.oid
                          AND rewrite_row.rulename <> '_RETURN'), ''),
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format('%s:%s:%s',
                               trigger_row.tgname, trigger_row.tgenabled,
                               pg_catalog.pg_get_triggerdef(
                                   trigger_row.oid, true)),
                           '|' ORDER BY trigger_row.tgname, trigger_row.oid)
                         FROM pg_trigger trigger_row
                        WHERE trigger_row.tgrelid = relation.oid
                          AND NOT trigger_row.tgisinternal), ''),
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format('%s:%s:%s:%s:%s:%s',
                               policy_row.polname, policy_row.polcmd,
                               policy_row.polpermissive,
                               policy_row.polroles::text,
                               coalesce(pg_catalog.pg_get_expr(
                                   policy_row.polqual, policy_row.polrelid,
                                   true), ''),
                               coalesce(pg_catalog.pg_get_expr(
                                   policy_row.polwithcheck,
                                   policy_row.polrelid, true), '')),
                           '|' ORDER BY policy_row.polname,
                                        policy_row.oid)
                         FROM pg_policy policy_row
                        WHERE policy_row.polrelid = relation.oid), ''))
          FROM pg_class relation
          JOIN pg_namespace namespace_row
            ON namespace_row.oid = relation.relnamespace
          JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
         WHERE relation.relkind IN ('r','p','v','m','f')
           AND namespace_row.nspname !~ '^pg_'
           AND namespace_row.nspname <> 'information_schema'
           AND NOT EXISTS (
               SELECT 1 FROM pg_depend dependency
                WHERE dependency.classid = 'pg_namespace'::regclass
                  AND dependency.objid = namespace_row.oid
                  AND dependency.refclassid = 'pg_extension'::regclass
                  AND dependency.deptype = 'e')
           AND (has_table_privilege(
                    p_login_name, relation.oid,
                    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                OR has_any_column_privilege(
                    p_login_name, relation.oid,
                    'SELECT,INSERT,UPDATE,REFERENCES')
                OR relation.relowner = ANY (ARRAY[
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_api_runtime'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_ingestor_runtime'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_api_runtime_login'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_ingestor_runtime_login')])
                OR relation.oid =
                   'public.runtime_ordinary_login_attestation_receipts'::regclass
                OR (namespace_row.nspname = 'public'
                    AND relation.relname = ANY (v_protected_relations))
                OR EXISTS (
                    SELECT 1 FROM pg_catalog.aclexplode(relation.relacl) acl
                     WHERE acl.grantee = 0
                        OR acl.grantee = ANY (ARRAY[
                            (SELECT oid FROM pg_roles
                              WHERE rolname = 'verdify_api_runtime'),
                            (SELECT oid FROM pg_roles
                              WHERE rolname = 'verdify_ingestor_runtime'),
                            (SELECT oid FROM pg_roles
                              WHERE rolname = 'verdify_api_runtime_login'),
                            (SELECT oid FROM pg_roles
                              WHERE rolname =
                                    'verdify_ingestor_runtime_login')]))
                OR EXISTS (
                    SELECT 1
                      FROM pg_attribute attribute_row
                      CROSS JOIN LATERAL pg_catalog.aclexplode(
                          attribute_row.attacl) acl
                     WHERE attribute_row.attrelid = relation.oid
                       AND attribute_row.attnum > 0
                       AND NOT attribute_row.attisdropped
                       AND (acl.grantee = 0
                            OR acl.grantee = ANY (ARRAY[
                                (SELECT oid FROM pg_roles
                                  WHERE rolname = 'verdify_api_runtime'),
                                (SELECT oid FROM pg_roles
                                  WHERE rolname = 'verdify_ingestor_runtime'),
                                (SELECT oid FROM pg_roles
                                  WHERE rolname =
                                        'verdify_api_runtime_login'),
                                (SELECT oid FROM pg_roles
                                  WHERE rolname =
                                        'verdify_ingestor_runtime_login')]))))
        UNION ALL
        SELECT pg_catalog.format(
                   'sequence|%I.%I|owner=%s|acl=%s|usage=%s|select=%s|update=%s',
                   namespace_row.nspname, relation.relname,
                   owner_role.rolname,
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format('%s:%s:%s', acl.grantee,
                                             acl.privilege_type,
                                             acl.is_grantable), ','
                           ORDER BY acl.grantee, acl.privilege_type,
                                    acl.is_grantable)
                         FROM pg_catalog.aclexplode(relation.relacl) acl), ''),
                   has_sequence_privilege(
                       p_login_name, relation.oid, 'USAGE'),
                   has_sequence_privilege(
                       p_login_name, relation.oid, 'SELECT'),
                   has_sequence_privilege(
                       p_login_name, relation.oid, 'UPDATE'))
          FROM pg_class relation
          JOIN pg_namespace namespace_row
            ON namespace_row.oid = relation.relnamespace
          JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
         WHERE relation.relkind = 'S'
           AND namespace_row.nspname !~ '^pg_'
           AND namespace_row.nspname <> 'information_schema'
           AND NOT EXISTS (
               SELECT 1 FROM pg_depend dependency
                WHERE dependency.classid = 'pg_namespace'::regclass
                  AND dependency.objid = namespace_row.oid
                  AND dependency.refclassid = 'pg_extension'::regclass
                  AND dependency.deptype = 'e')
           AND (has_sequence_privilege(
                    p_login_name, relation.oid, 'USAGE,SELECT,UPDATE')
                OR relation.relowner = ANY (ARRAY[
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_api_runtime'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_ingestor_runtime'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_api_runtime_login'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_ingestor_runtime_login')])
                OR (namespace_row.nspname = 'public'
                    AND relation.relname = ANY (v_protected_sequences))
                OR EXISTS (
                    SELECT 1 FROM pg_catalog.aclexplode(relation.relacl) acl
                     WHERE acl.grantee = 0
                        OR acl.grantee = ANY (ARRAY[
                            (SELECT oid FROM pg_roles
                              WHERE rolname = 'verdify_api_runtime'),
                            (SELECT oid FROM pg_roles
                              WHERE rolname = 'verdify_ingestor_runtime'),
                            (SELECT oid FROM pg_roles
                              WHERE rolname = 'verdify_api_runtime_login'),
                            (SELECT oid FROM pg_roles
                              WHERE rolname =
                                    'verdify_ingestor_runtime_login')])))
        UNION ALL
        SELECT pg_catalog.format(
                   'function|%I.%I(%s)|result=%s|owner=%s|language=%s|'
                   'definer=%s|config=%s|acl=%s|definition=%s|body=%s|bin=%s',
                   namespace_row.nspname, procedure_row.proname,
                   pg_catalog.pg_get_function_identity_arguments(
                       procedure_row.oid),
                   pg_catalog.pg_get_function_result(procedure_row.oid),
                   owner_role.rolname, language_row.lanname,
                   procedure_row.prosecdef,
                   coalesce(procedure_row.proconfig::text, ''),
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format('%s:%s:%s', acl.grantee,
                                             acl.privilege_type,
                                             acl.is_grantable), ','
                           ORDER BY acl.grantee, acl.privilege_type,
                                    acl.is_grantable)
                         FROM pg_catalog.aclexplode(procedure_row.proacl) acl),
                       ''), pg_catalog.pg_get_functiondef(procedure_row.oid),
                   procedure_row.prosrc,
                   coalesce(procedure_row.probin, ''))
          FROM pg_proc procedure_row
          JOIN pg_namespace namespace_row
            ON namespace_row.oid = procedure_row.pronamespace
          JOIN pg_roles owner_role ON owner_role.oid = procedure_row.proowner
          JOIN pg_language language_row
            ON language_row.oid = procedure_row.prolang
         WHERE namespace_row.nspname !~ '^pg_'
           AND namespace_row.nspname <> 'information_schema'
           AND NOT EXISTS (
               SELECT 1 FROM pg_depend dependency
                WHERE dependency.classid = 'pg_namespace'::regclass
                  AND dependency.objid = namespace_row.oid
                  AND dependency.refclassid = 'pg_extension'::regclass
                  AND dependency.deptype = 'e')
           AND (procedure_row.prosecdef
                OR procedure_row.oid = ANY (v_invoker_helper_closure))
           AND (procedure_row.oid = ANY (v_invoker_helper_closure)
                OR procedure_row.proname IN (
                    'fn_runtime_ordinary_boundary_digest',
                    'fn_runtime_attest_ordinary_login')
                OR procedure_row.proowner = ANY (ARRAY[
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_api_runtime'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_ingestor_runtime'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_api_runtime_login'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_ingestor_runtime_login')])
                OR (has_schema_privilege(
                        p_login_name, namespace_row.oid, 'USAGE')
                    AND (has_function_privilege(
                            p_login_name, procedure_row.oid, 'EXECUTE')
                         OR EXISTS (
                            SELECT 1
                              FROM pg_catalog.aclexplode(
                                       procedure_row.proacl) acl
                             WHERE acl.grantee = 0
                                OR acl.grantee = ANY (ARRAY[
                                    (SELECT oid FROM pg_roles
                                      WHERE rolname = 'verdify_api_runtime'),
                                    (SELECT oid FROM pg_roles
                                      WHERE rolname =
                                            'verdify_ingestor_runtime'),
                                    (SELECT oid FROM pg_roles
                                      WHERE rolname =
                                            'verdify_api_runtime_login'),
                                    (SELECT oid FROM pg_roles
                                      WHERE rolname =
                                            'verdify_ingestor_runtime_login')]))))
                OR EXISTS (
                    SELECT 1
                      FROM pg_trigger trigger_row
                      JOIN pg_class trigger_relation
                        ON trigger_relation.oid = trigger_row.tgrelid
                     WHERE trigger_row.tgfoid = procedure_row.oid
                       AND NOT trigger_row.tgisinternal
                       AND (has_table_privilege(
                                p_login_name, trigger_relation.oid,
                                'INSERT,UPDATE,DELETE,TRIGGER')
                            OR has_any_column_privilege(
                                p_login_name, trigger_relation.oid,
                                'INSERT,UPDATE')
                            OR (trigger_relation.relnamespace =
                                'public'::regnamespace
                                AND trigger_relation.relname = ANY (
                                    v_protected_relations)))))
        UNION ALL
        SELECT pg_catalog.format(
                   'trigger|%I.%I|%s|enabled=%s|function=%s|definition=%s',
                   namespace_row.nspname, relation.relname,
                   trigger_row.tgname, trigger_row.tgenabled,
                   trigger_row.tgfoid::regprocedure,
                   pg_catalog.pg_get_triggerdef(trigger_row.oid, true))
          FROM pg_trigger trigger_row
          JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
          JOIN pg_namespace namespace_row
            ON namespace_row.oid = relation.relnamespace
         WHERE NOT trigger_row.tgisinternal
           AND namespace_row.nspname !~ '^pg_'
           AND namespace_row.nspname <> 'information_schema'
           AND (has_table_privilege(
                    p_login_name, relation.oid,
                    'INSERT,UPDATE,DELETE,TRIGGER')
                OR has_any_column_privilege(
                    p_login_name, relation.oid, 'INSERT,UPDATE')
                OR (namespace_row.nspname = 'public'
                    AND relation.relname = ANY (v_protected_relations)))
        UNION ALL
        SELECT pg_catalog.format(
                   'trigger-function|%I.%I(%s)|owner=%s|language=%s|'
                   'definer=%s|config=%s|acl=%s|body=%s|bin=%s',
                   function_namespace.nspname, procedure_row.proname,
                   pg_catalog.pg_get_function_identity_arguments(
                       procedure_row.oid), owner_role.rolname,
                   language_row.lanname, procedure_row.prosecdef,
                   coalesce(procedure_row.proconfig::text, ''),
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format('%s:%s:%s', acl.grantee,
                                             acl.privilege_type,
                                             acl.is_grantable), ','
                           ORDER BY acl.grantee, acl.privilege_type,
                                    acl.is_grantable)
                         FROM pg_catalog.aclexplode(procedure_row.proacl) acl),
                       ''),
                   procedure_row.prosrc, coalesce(procedure_row.probin, ''))
          FROM pg_proc procedure_row
          JOIN pg_namespace function_namespace
            ON function_namespace.oid = procedure_row.pronamespace
          JOIN pg_roles owner_role ON owner_role.oid = procedure_row.proowner
          JOIN pg_language language_row
            ON language_row.oid = procedure_row.prolang
         WHERE EXISTS (
            SELECT 1
              FROM pg_trigger trigger_row
              JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
              JOIN pg_namespace relation_namespace
                ON relation_namespace.oid = relation.relnamespace
             WHERE trigger_row.tgfoid = procedure_row.oid
               AND NOT trigger_row.tgisinternal
               AND relation_namespace.nspname !~ '^pg_'
               AND relation_namespace.nspname <> 'information_schema'
               AND (has_table_privilege(
                        p_login_name, relation.oid,
                        'INSERT,UPDATE,DELETE,TRIGGER')
                    OR has_any_column_privilege(
                        p_login_name, relation.oid, 'INSERT,UPDATE')
                    OR (relation_namespace.nspname = 'public'
                        AND relation.relname = ANY (
                            v_protected_relations))))
        UNION ALL
        SELECT pg_catalog.format(
                   'internal-function|%s|owner=%s|acl=%s|definition=%s|bin=%s',
                   procedure_row.oid::regprocedure, owner_role.rolname,
                   coalesce((
                       SELECT pg_catalog.string_agg(
                           pg_catalog.format('%s:%s:%s', acl.grantee,
                                             acl.privilege_type,
                                             acl.is_grantable), ','
                           ORDER BY acl.grantee, acl.privilege_type,
                                    acl.is_grantable)
                         FROM pg_catalog.aclexplode(procedure_row.proacl) acl),
                       ''),
                   pg_catalog.pg_get_functiondef(procedure_row.oid),
                   coalesce(procedure_row.probin, ''))
          FROM pg_proc procedure_row
          JOIN pg_roles owner_role ON owner_role.oid = procedure_row.proowner
         WHERE procedure_row.oid = ANY (v_internal_callees)
        UNION ALL
        SELECT pg_catalog.format(
                   'rule|%I.%I|%s|definition=%s', namespace_row.nspname,
                   relation.relname, rewrite_row.rulename,
                   pg_catalog.pg_get_ruledef(rewrite_row.oid, true))
          FROM pg_rewrite rewrite_row
          JOIN pg_class relation ON relation.oid = rewrite_row.ev_class
          JOIN pg_namespace namespace_row
            ON namespace_row.oid = relation.relnamespace
         WHERE rewrite_row.rulename <> '_RETURN'
           AND namespace_row.nspname !~ '^pg_'
           AND namespace_row.nspname <> 'information_schema'
           AND (has_table_privilege(
                    p_login_name, relation.oid,
                    'INSERT,UPDATE,DELETE,TRIGGER')
                OR has_any_column_privilege(
                    p_login_name, relation.oid, 'INSERT,UPDATE')
                OR (namespace_row.nspname = 'public'
                    AND relation.relname = ANY (v_protected_relations)))
        UNION ALL
        SELECT pg_catalog.format(
                   'policy|%I.%I|%s|command=%s|roles=%s|using=%s|check=%s',
                   namespace_row.nspname, relation.relname,
                   policy_row.polname, policy_row.polcmd,
                   policy_row.polroles::text,
                   pg_catalog.pg_get_expr(
                       policy_row.polqual, policy_row.polrelid, true),
                   pg_catalog.pg_get_expr(
                       policy_row.polwithcheck, policy_row.polrelid, true))
          FROM pg_policy policy_row
          JOIN pg_class relation ON relation.oid = policy_row.polrelid
          JOIN pg_namespace namespace_row
            ON namespace_row.oid = relation.relnamespace
         WHERE namespace_row.nspname !~ '^pg_'
           AND namespace_row.nspname <> 'information_schema'
           AND (has_table_privilege(
                    p_login_name, relation.oid,
                    'INSERT,UPDATE,DELETE,TRIGGER')
                OR has_any_column_privilege(
                    p_login_name, relation.oid, 'INSERT,UPDATE')
                OR (namespace_row.nspname = 'public'
                    AND relation.relname = ANY (v_protected_relations)))
        UNION ALL
        SELECT pg_catalog.format(
                   'default|owner=%s|schema=%s|kind=%s|grantee=%s|'
                   'privilege=%s|grantable=%s',
                   owner_role.rolname,
                   coalesce(namespace_row.nspname, ''),
                   default_acl.defaclobjtype, acl.grantee,
                   acl.privilege_type, acl.is_grantable)
          FROM pg_default_acl default_acl
          JOIN pg_roles owner_role ON owner_role.oid = default_acl.defaclrole
          LEFT JOIN pg_namespace namespace_row
            ON namespace_row.oid = default_acl.defaclnamespace
          CROSS JOIN LATERAL
               pg_catalog.aclexplode(default_acl.defaclacl) acl
         WHERE default_acl.defaclobjtype IN ('r','S','f')
           AND (acl.grantee = 0
                OR acl.grantee = ANY (ARRAY[
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_api_runtime'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_ingestor_runtime'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_api_runtime_login'),
                    (SELECT oid FROM pg_roles
                      WHERE rolname = 'verdify_ingestor_runtime_login')]))
    )
    SELECT pg_catalog.string_agg(entry, E'\n' ORDER BY entry)
      INTO v_catalog
      FROM security_entries;
    RETURN public.digest(coalesce(v_catalog, ''), 'sha256');
END;
$function$;

-- Readers lock a view before its base relations, so every view over daily_summary that changes is taken first,
-- outermost first, and daily_summary last: a reader waiting on one of them never holds daily_summary.
-- The dependents of the retired daily_summary columns go first; they are recreated after the ALTER.
DROP VIEW verdify_grafana_runtime.v_planner_performance;
DROP FUNCTION verdify_grafana_runtime.fn_read_v_planner_performance();
DROP VIEW public.v_plan_window_scorecard;
DROP VIEW public.v_planner_performance;
DROP VIEW verdify_grafana_runtime.daily_summary, verdify_lab_publisher_runtime.daily_summary;
DROP VIEW public.v_scorecard_climate_diagnostics;

-- Scorecard contract 3: every metric from mv_daily_kpi (the api duty reads it, not daily_summary); resources informational.
CREATE OR REPLACE FUNCTION public.fn_planner_scorecard(p_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(metric text, value numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT 'scorecard_contract_version'::text, 3::numeric
    UNION ALL SELECT 'planner_score', k.planner_score FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'planner_score_resource_weight_pct', 0::numeric
    UNION ALL SELECT 'resource_terms_available', 0::numeric
    UNION ALL SELECT 'compliance_pct', k.compliance_pct FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'temp_compliance_pct', k.temp_compliance_pct FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'vpd_compliance_pct', k.vpd_compliance_pct FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'total_stress_h', k.total_stress_h FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'heat_stress_h', k.heat_stress_h FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'cold_stress_h', k.cold_stress_h FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'vpd_high_stress_h', k.vpd_high_stress_h FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'vpd_low_stress_h', k.vpd_low_stress_h FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'kwh', k.kwh FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'therms', k.therms FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'water_gal', k.water_gal FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'mister_water_gal', k.mister_water_gal FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'cost_electric', k.cost_electric FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'cost_gas', k.cost_gas FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'cost_water', k.cost_water FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'cost_total', k.cost_total FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'dp_margin_min_f', k.dp_margin_min_f FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT 'dp_risk_hours', k.dp_risk_hours FROM public.mv_daily_kpi k WHERE k.date = p_date
    UNION ALL SELECT '7d_avg_score', round(avg(k.planner_score), 1) FROM public.mv_daily_kpi k WHERE k.date BETWEEN p_date - 7 AND p_date - 1
    UNION ALL SELECT '7d_avg_compliance', round(avg(k.compliance_pct), 1) FROM public.mv_daily_kpi k WHERE k.date BETWEEN p_date - 7 AND p_date - 1
    UNION ALL SELECT '7d_avg_cost', round(avg(k.cost_total), 2) FROM public.mv_daily_kpi k WHERE k.date BETWEEN p_date - 7 AND p_date - 1
    UNION ALL SELECT '7d_avg_kwh', round(avg(k.kwh), 1) FROM public.mv_daily_kpi k WHERE k.date BETWEEN p_date - 7 AND p_date - 1
    UNION ALL SELECT '7d_avg_therms', round(avg(k.therms), 3) FROM public.mv_daily_kpi k WHERE k.date BETWEEN p_date - 7 AND p_date - 1
    UNION ALL SELECT '7d_avg_water_gal', round(avg(k.water_gal), 0) FROM public.mv_daily_kpi k WHERE k.date BETWEEN p_date - 7 AND p_date - 1;
END;
$function$;
COMMENT ON FUNCTION public.fn_planner_scorecard(date) IS
'Scorecard contract 3 (309): planner_score = compliance_pct, both axes in the served house band; every metric from mv_daily_kpi: the served-band climate metrics (290''s grading via daily_summary) and resources (kwh, therms, water_gal = planning water, cost_*) as informational nominal-model estimates. resource_terms_available is 0 and planner_score_resource_weight_pct 0 by definition (#1623).';

-- v_daily_kpi is held before the views it reads are replaced (an ALTER VIEW takes only the view's own lock).
ALTER VIEW public.v_daily_kpi OWNER TO verdify;

-- Today's served-band stress hours, the same values daily_summary carries (alert-monitor reads these columns).
CREATE OR REPLACE VIEW public.v_stress_hours_today AS
 WITH bounds AS (
         SELECT (date_trunc('day'::text, (now() AT TIME ZONE 'America/Denver'::text)) AT TIME ZONE 'America/Denver'::text) AS start_ts,
            (now() AT TIME ZONE 'America/Denver'::text)::date AS local_day
        )
 SELECT b.start_ts AS date,
    round(d.stress_hours_cold::numeric, 2) AS cold_stress_hours,
    round(d.stress_hours_heat::numeric, 2) AS heat_stress_hours,
    round(d.stress_hours_vpd_high::numeric, 2) AS vpd_stress_hours,
    round(d.stress_hours_vpd_low::numeric, 2) AS vpd_low_hours
   FROM bounds b
     LEFT JOIN daily_summary d ON d.date = b.local_day;
COMMENT ON VIEW public.v_stress_hours_today IS
'Served house band stress hours for the current America/Denver day: the daily_summary stress_hours_* that fn_band_compliance_store writes from 290''s 5-minute grading (refreshed every 30 minutes). Column names preserved for the alert monitor and Grafana (309).';

-- The legacy DLI proxy column retires; v_dli_daily keeps its columns.
CREATE OR REPLACE VIEW public.v_dli_daily AS
WITH day_bounds AS (
         SELECT ds.date,
            COALESCE(ds.greenhouse_id, 'vallery'::text) AS greenhouse_id,
            false AS forensic_proxy_present,
            (ds.date::timestamp without time zone AT TIME ZONE 'America/Denver'::text) AS day_start,
            ((ds.date + 1)::timestamp without time zone AT TIME ZONE 'America/Denver'::text) AS day_end
           FROM daily_summary ds
          WHERE ds.date IS NOT NULL
        ), graded AS (
         SELECT d.date,
            d.greenhouse_id,
            d.forensic_proxy_present,
            d.day_start,
            d.day_end,
            v.availability AS ledger_availability,
            v.unavailable_reason AS ledger_reason,
            v.provenance,
            v.validity_revision,
            v.valid_from,
            v.valid_to,
            p.samples,
            p.covered_s,
            p.dli
           FROM day_bounds d
             LEFT JOIN LATERAL fn_dli_validity(d.day_start + '12:00:00'::interval, d.greenhouse_id) v(availability, unavailable_reason, provenance, validity_revision, valid_from, valid_to, operator_validated) ON true
             LEFT JOIN LATERAL ( SELECT count(*) AS samples,
                    sum(s.held_s) AS covered_s,
                    sum(s.ppfd * s.held_s) / '1000000'::numeric::double precision AS dli
                   FROM ( SELECT c.ppfd_umol_m2_s AS ppfd,
                            EXTRACT(epoch FROM LEAST(lead(c.ts) OVER (ORDER BY c.ts), d.day_end, c.ts + '00:02:00'::interval) - c.ts)::double precision AS held_s
                           FROM climate c
                          WHERE c.ts >= d.day_start AND c.ts < d.day_end AND COALESCE(c.greenhouse_id, 'vallery'::text) = d.greenhouse_id AND c.ppfd_umol_m2_s IS NOT NULL AND v.availability = 'available'::text AND d.day_end <= now()) s) p ON true
        ), reasoned AS (
         SELECT g.date,
            g.greenhouse_id,
            g.forensic_proxy_present,
            g.day_start,
            g.day_end,
            g.ledger_availability,
            g.ledger_reason,
            g.provenance,
            g.validity_revision,
            g.valid_from,
            g.valid_to,
            g.samples,
            g.covered_s,
            g.dli,
                CASE
                    WHEN g.day_end > now() THEN 'source_day_incomplete'::text
                    WHEN g.ledger_availability IS NULL THEN 'validity_contract_missing'::text
                    WHEN g.ledger_availability <> 'available'::text THEN g.ledger_reason
                    WHEN COALESCE(g.samples, 0::bigint) = 0 THEN 'source_reading_missing'::text
                    WHEN g.covered_s < (0.98::double precision * EXTRACT(epoch FROM g.day_end - g.day_start)::double precision) THEN 'source_coverage_low'::text
                    ELSE fn_dli_source_invalid_reason(g.dli)
                END AS reason
           FROM graded g
        )
 SELECT date,
    greenhouse_id,
        CASE
            WHEN reason IS NULL THEN dli
            ELSE NULL::double precision
        END AS crop_dli_mol_m2_day,
        CASE
            WHEN reason IS NULL THEN 'available'::text
            ELSE 'unavailable'::text
        END AS availability,
    reason AS unavailable_reason,
    COALESCE(provenance, 'unknown_unvalidated_source'::text) AS provenance,
    COALESCE(validity_revision, 'missing'::text) AS validity_revision,
    valid_from,
    valid_to,
    forensic_proxy_present
   FROM reasoned r;

-- Modelled energy is reportable once runtime evidence and nominal coefficients are complete for a finished day.
CREATE OR REPLACE VIEW public.v_runtime_energy_daily AS
WITH runtime AS (
         SELECT ds.date,
            ds.greenhouse_id,
            v.equipment,
            rt.on_minutes::double precision AS on_minutes,
            rt.is_complete_day,
            rt.start_state_known,
            rt.is_deploy_gate_eligible AS runtime_evidence_eligible,
            rt.quality AS runtime_quality
           FROM daily_summary ds
             CROSS JOIN LATERAL ( VALUES ('heat1'::text), ('fan1'::text), ('fan2'::text), ('fog'::text), ('vent'::text), ('grow_light_main'::text), ('grow_light_grow'::text)) v(equipment)
             LEFT JOIN mv_equipment_runtime_daily rt ON rt.day = ds.date AND rt.greenhouse_id = ds.greenhouse_id AND rt.equipment = v.equipment
        ), evidence AS (
         SELECT r_1.date,
            r_1.greenhouse_id,
            r_1.equipment,
            r_1.on_minutes,
            r_1.is_complete_day,
            r_1.start_state_known,
            r_1.runtime_evidence_eligible,
            r_1.runtime_quality,
            c.nominal_value AS coefficient_nominal,
            c.lower_bound AS coefficient_low,
            c.upper_bound AS coefficient_high,
            c.coefficient_source,
            c.revision AS coefficient_revision,
            c.evidence_ref,
            c.unit,
            c.lower_bound <> c.upper_bound AS has_uncertainty
           FROM runtime r_1
             LEFT JOIN equipment e ON e.greenhouse_id = r_1.greenhouse_id AND e.slug = r_1.equipment AND e.is_active
             LEFT JOIN LATERAL ( SELECT rc.id,
                    rc.equipment_id,
                    rc.resource_kind,
                    rc.unit,
                    rc.nominal_value,
                    rc.lower_bound,
                    rc.upper_bound,
                    rc.coefficient_source,
                    rc.revision,
                    rc.evidence_ref,
                    rc.valid_from,
                    rc.valid_to,
                    rc.is_model_default,
                    rc.notes,
                    rc.created_at
                   FROM resource_coefficients rc
                  WHERE rc.equipment_id = e.id AND rc.resource_kind = 'electric_watts'::text AND rc.valid_from <= (r_1.date::timestamp without time zone AT TIME ZONE 'America/Denver'::text) AND (rc.valid_to IS NULL OR rc.valid_to > (r_1.date::timestamp without time zone AT TIME ZONE 'America/Denver'::text))
                  ORDER BY rc.valid_from DESC, rc.id DESC
                 LIMIT 1) c ON true
        )
 SELECT date,
    greenhouse_id,
        CASE
            WHEN bool_or(on_minutes IS NULL OR NOT COALESCE(runtime_evidence_eligible, false) OR coefficient_nominal IS NULL) THEN NULL::double precision
            ELSE round(sum(on_minutes / 60.0::double precision * coefficient_nominal / 1000.0::double precision)::numeric, 3)::double precision
        END AS modeled_kwh,
        CASE
            WHEN bool_or(on_minutes IS NULL OR NOT COALESCE(runtime_evidence_eligible, false) OR coefficient_low IS NULL) THEN NULL::double precision
            ELSE round(sum(on_minutes / 60.0::double precision * coefficient_low / 1000.0::double precision)::numeric, 3)::double precision
        END AS modeled_kwh_low,
        CASE
            WHEN bool_or(on_minutes IS NULL OR NOT COALESCE(runtime_evidence_eligible, false) OR coefficient_high IS NULL) THEN NULL::double precision
            ELSE round(sum(on_minutes / 60.0::double precision * coefficient_high / 1000.0::double precision)::numeric, 3)::double precision
        END AS modeled_kwh_high,
    round(100.0 * count(*) FILTER (WHERE on_minutes IS NOT NULL AND coefficient_nominal IS NOT NULL AND runtime_evidence_eligible)::numeric / NULLIF(count(*), 0)::numeric, 1)::double precision AS runtime_coverage_pct,
    jsonb_agg(DISTINCT jsonb_build_object('equipment', equipment, 'revision', coefficient_revision, 'source', coefficient_source, 'low', coefficient_low, 'nominal', coefficient_nominal, 'high', coefficient_high, 'unit', unit, 'evidence_ref', evidence_ref)) FILTER (WHERE coefficient_nominal IS NOT NULL) AS coefficient_revisions,
    'whole_controlled_equipment_runtime'::text AS modeled_scope,
        CASE
            WHEN date >= (now() AT TIME ZONE 'America/Denver'::text)::date THEN 'incomplete_runtime'::text
            WHEN bool_or(coefficient_nominal IS NULL) THEN 'missing_coefficients'::text
            WHEN bool_or(on_minutes IS NULL OR NOT COALESCE(runtime_evidence_eligible, false)) THEN 'incomplete_runtime_evidence'::text
            WHEN bool_or(has_uncertainty) THEN 'uncertain_coefficients'::text
            ELSE 'ok'::text
        END AS model_quality,
    date < (now() AT TIME ZONE 'America/Denver'::text)::date AND bool_and(on_minutes IS NOT NULL) AND bool_and(COALESCE(runtime_evidence_eligible, false)) AND bool_and(coefficient_nominal IS NOT NULL) AS available_for_scoring,
    jsonb_agg(jsonb_build_object('equipment', equipment, 'quality', COALESCE(runtime_quality, 'missing'::text), 'complete_day', COALESCE(is_complete_day, false), 'start_state_known', COALESCE(start_state_known, false), 'eligible', COALESCE(runtime_evidence_eligible, false)) ORDER BY equipment) AS runtime_evidence
   FROM evidence r
  GROUP BY date, greenhouse_id;
COMMENT ON VIEW public.v_runtime_energy_daily IS
'Whole controlled-equipment runtime model with low/nominal/high kWh, transition-derived runtime completeness, and the coefficient revision valid on that local day. Runtime evidence reads the migration-200 materialized snapshot (mv_equipment_runtime_daily, 10-minute refresh). available_for_scoring means a completed local day with complete eligible runtime and a nominal coefficient for every metered load (309): kWh and cost are informational nominal-model estimates, never a planner objective; modeled_kwh_low/high carry the coefficient bounds and model_quality still reports uncertain_coefficients.';

-- Planning water and the house water reported beside it.
CREATE OR REPLACE VIEW public.v_water_attribution_daily AS
WITH events AS (
         SELECT (e_1.ts AT TIME ZONE 'America/Denver'::text)::date AS date,
            e_1.greenhouse_id,
            round(sum(e_1.delta_gal) FILTER (WHERE e_1.attribution_class = 'meter_attributed'::text)::numeric, 3)::double precision AS attributed_gal,
            round(sum(e_1.delta_gal) FILTER (WHERE e_1.attributed_scope = 'climate_wetting'::text)::numeric, 3)::double precision AS climate_wetting_gal,
            round(sum(e_1.delta_gal) FILTER (WHERE e_1.attributed_scope = 'wall_irrigation'::text)::numeric, 3)::double precision AS wall_irrigation_gal,
            round(sum(e_1.delta_gal) FILTER (WHERE e_1.attributed_scope = 'wall_fertigation'::text)::numeric, 3)::double precision AS wall_fertigation_gal,
            round(sum(e_1.delta_gal) FILTER (WHERE e_1.attributed_scope = 'unsupported_path'::text)::numeric, 3)::double precision AS unsupported_path_gal,
            round(sum(e_1.delta_gal) FILTER (WHERE e_1.attribution_class = 'ambiguous_overlap'::text)::numeric, 3)::double precision AS ambiguous_gal,
            round(sum(e_1.delta_gal) FILTER (WHERE e_1.attribution_class = 'manual_or_unattributed'::text)::numeric, 3)::double precision AS manual_or_unattributed_gal,
            count(*) FILTER (WHERE e_1.attribution_quality <> 'ok'::text) AS attribution_quality_events
           FROM v_water_event_attribution e_1
          GROUP BY ((e_1.ts AT TIME ZONE 'America/Denver'::text)::date), e_1.greenhouse_id
        ), runs AS (
         SELECT (r_1.run_start AT TIME ZONE 'America/Denver'::text)::date AS date,
            r_1.greenhouse_id,
            count(*) FILTER (WHERE r_1.run_classification = 'command_only'::text) AS command_only_runs,
            count(*) FILTER (WHERE r_1.run_classification = 'ambiguous_overlap'::text) AS ambiguous_runs,
            count(*) FILTER (WHERE r_1.run_classification = 'meter_attributed'::text) AS meter_attributed_runs
           FROM v_water_run_accounting r_1
          GROUP BY ((r_1.run_start AT TIME ZONE 'America/Denver'::text)::date), r_1.greenhouse_id
        )
 SELECT m.day::date AS date,
    m.greenhouse_id,
    m.used_gal AS quality_filtered_meter_gal,
    COALESCE(e.attributed_gal, 0::double precision) AS attributed_gal,
    COALESCE(e.climate_wetting_gal, 0::double precision) AS climate_wetting_gal,
    COALESCE(e.wall_irrigation_gal, 0::double precision) AS wall_irrigation_gal,
    COALESCE(e.wall_fertigation_gal, 0::double precision) AS wall_fertigation_gal,
    COALESCE(e.unsupported_path_gal, 0::double precision) AS unsupported_path_gal,
    COALESCE(e.ambiguous_gal, 0::double precision) AS ambiguous_gal,
    COALESCE(e.manual_or_unattributed_gal, 0::double precision) AS manual_or_unattributed_gal,
    COALESCE(r.command_only_runs, 0::bigint) AS command_only_runs,
    COALESCE(r.ambiguous_runs, 0::bigint) AS ambiguous_runs,
    COALESCE(r.meter_attributed_runs, 0::bigint) AS meter_attributed_runs,
    round((m.used_gal - COALESCE(e.attributed_gal, 0::double precision) - COALESCE(e.ambiguous_gal, 0::double precision) - COALESCE(e.manual_or_unattributed_gal, 0::double precision))::numeric, 6)::double precision AS conservation_error_gal,
    m.quality AS ledger_quality,
        CASE
            WHEN abs(m.used_gal - COALESCE(e.attributed_gal, 0::double precision) - COALESCE(e.ambiguous_gal, 0::double precision) - COALESCE(e.manual_or_unattributed_gal, 0::double precision)) > 0.001::double precision THEN 'conservation_error'::text
            WHEN m.quality <> 'ok'::text THEN m.quality
            WHEN COALESCE(e.attribution_quality_events, 0::bigint) > 0 THEN 'attribution_degraded'::text
            ELSE 'ok'::text
        END AS resource_quality,
    m.available_for_scoring AND abs(m.used_gal - COALESCE(e.attributed_gal, 0::double precision) - COALESCE(e.ambiguous_gal, 0::double precision) - COALESCE(e.manual_or_unattributed_gal, 0::double precision)) <= 0.001::double precision AND COALESCE(e.attribution_quality_events, 0::bigint) = 0 AS available_for_scoring,
    COALESCE(e.climate_wetting_gal, 0::double precision) + COALESCE(e.wall_irrigation_gal, 0::double precision) + COALESCE(e.wall_fertigation_gal, 0::double precision) AS planning_water_gal,
    COALESCE(e.manual_or_unattributed_gal, 0::double precision) AS house_water_gal
   FROM v_water_meter_daily m
     LEFT JOIN events e ON e.date = m.day::date AND e.greenhouse_id = m.greenhouse_id
     LEFT JOIN runs r ON r.date = m.day::date AND r.greenhouse_id = m.greenhouse_id;
COMMENT ON VIEW public.v_water_attribution_daily IS
'Conservative daily water partition. Attributed + ambiguous + manual/unattributed exactly conserves accepted meter gallons; command-only runs never contribute gallons. planning_water_gal (climate wetting + wall irrigation + wall fertigation) is the only planner and KPI water; house_water_gal (manual or unattributed, e.g. hose use) is reported beside it and never planning information (309).';

-- planner_score is the served-band compliance; planning water; resources informational.
CREATE OR REPLACE VIEW public.v_daily_kpi AS
WITH evidence AS (
         SELECT d.date,
            d.cycles_fan1,
            d.cycles_fan2,
            d.cycles_heat1,
            d.cycles_heat2,
            d.cycles_fog,
            d.cycles_vent,
            d.runtime_fan1_min,
            d.runtime_fan2_min,
            d.runtime_heat1_min,
            d.runtime_heat2_min,
            d.runtime_fog_min,
            d.runtime_vent_min,
            d.runtime_mister_south_h,
            d.runtime_mister_west_h,
            d.runtime_mister_center_h,
            d.water_used_gal,
            d.mister_water_gal,
            d.captured_at,
            d.kwh_total,
            d.peak_kw,
            d.runtime_grow_light_min,
            d.cycles_grow_light,
            d.runtime_drip_wall_h,
            d.runtime_drip_center_h,
            d.kwh_estimated,
            d.therms_estimated,
            d.cost_electric,
            d.cost_gas,
            d.cost_water,
            d.cost_total,
            d.temp_min,
            d.temp_max,
            d.temp_avg,
            d.rh_min,
            d.rh_max,
            d.rh_avg,
            d.vpd_min,
            d.vpd_max,
            d.vpd_avg,
            d.co2_avg,
            d.outdoor_temp_min,
            d.outdoor_temp_max,
            d.stress_hours_heat,
            d.stress_hours_cold,
            d.stress_hours_vpd_high,
            d.stress_hours_vpd_low,
            d.greenhouse_id,
            d.min_dp_margin_f,
            d.dp_risk_hours,
            d.compliance_pct,
            d.temp_compliance_pct,
            d.vpd_compliance_pct,
            d.mister_fairness_overrides_today,
            d.cycles_mister_south,
            d.cycles_mister_west,
            d.cycles_mister_center,
            d.cycles_drip_wall,
            d.cycles_drip_center,
            d.runtime_drip_wall_fert_h,
            d.runtime_drip_center_fert_h,
            d.runtime_mister_south_fert_h,
            d.runtime_mister_west_fert_h,
            d.runtime_fert_master_h,
            d.runtime_irrigation_clean_h,
            d.runtime_irrigation_fert_h,
            d.runtime_irrigation_total_h,
            d.cycles_drip_wall_fert,
            d.cycles_drip_center_fert,
            d.cycles_mister_south_fert,
            d.cycles_mister_west_fert,
            d.cycles_fert_master,
            d.irrigation_water_gal,
            d.fertigation_water_gal,
            d.runtime_grow_light_main_min,
            d.runtime_grow_light_grow_min,
            w.quality_filtered_meter_gal,
            w.climate_wetting_gal,
            w.planning_water_gal,
            COALESCE(w.available_for_scoring, false) AS water_ok,
            e.modeled_kwh,
            COALESCE(e.available_for_scoring, false) AS energy_ok,
            dl.crop_dli_mol_m2_day,
            dl.availability AS dli_availability,
            dl.unavailable_reason AS dli_unavailable_reason,
            dl.provenance AS dli_provenance,
            dl.validity_revision AS dli_validity_revision,
            dl.valid_from AS dli_valid_from,
            dl.valid_to AS dli_valid_to
           FROM daily_summary d
             LEFT JOIN v_water_attribution_daily w ON w.date = d.date AND w.greenhouse_id = d.greenhouse_id
             LEFT JOIN v_runtime_energy_daily e ON e.date = d.date AND e.greenhouse_id = d.greenhouse_id
             LEFT JOIN v_dli_daily dl ON dl.date = d.date AND dl.greenhouse_id = COALESCE(d.greenhouse_id, 'vallery'::text)
          WHERE d.date IS NOT NULL
        ), normalized AS (
         SELECT e.date,
            e.cycles_fan1,
            e.cycles_fan2,
            e.cycles_heat1,
            e.cycles_heat2,
            e.cycles_fog,
            e.cycles_vent,
            e.runtime_fan1_min,
            e.runtime_fan2_min,
            e.runtime_heat1_min,
            e.runtime_heat2_min,
            e.runtime_fog_min,
            e.runtime_vent_min,
            e.runtime_mister_south_h,
            e.runtime_mister_west_h,
            e.runtime_mister_center_h,
            e.water_used_gal,
            e.mister_water_gal,
            e.captured_at,
            e.kwh_total,
            e.peak_kw,
            e.runtime_grow_light_min,
            e.cycles_grow_light,
            e.runtime_drip_wall_h,
            e.runtime_drip_center_h,
            e.kwh_estimated,
            e.therms_estimated,
            e.cost_electric,
            e.cost_gas,
            e.cost_water,
            e.cost_total,
            e.temp_min,
            e.temp_max,
            e.temp_avg,
            e.rh_min,
            e.rh_max,
            e.rh_avg,
            e.vpd_min,
            e.vpd_max,
            e.vpd_avg,
            e.co2_avg,
            e.outdoor_temp_min,
            e.outdoor_temp_max,
            e.stress_hours_heat,
            e.stress_hours_cold,
            e.stress_hours_vpd_high,
            e.stress_hours_vpd_low,
            e.greenhouse_id,
            e.min_dp_margin_f,
            e.dp_risk_hours,
            e.compliance_pct,
            e.temp_compliance_pct,
            e.vpd_compliance_pct,
            e.mister_fairness_overrides_today,
            e.cycles_mister_south,
            e.cycles_mister_west,
            e.cycles_mister_center,
            e.cycles_drip_wall,
            e.cycles_drip_center,
            e.runtime_drip_wall_fert_h,
            e.runtime_drip_center_fert_h,
            e.runtime_mister_south_fert_h,
            e.runtime_mister_west_fert_h,
            e.runtime_fert_master_h,
            e.runtime_irrigation_clean_h,
            e.runtime_irrigation_fert_h,
            e.runtime_irrigation_total_h,
            e.cycles_drip_wall_fert,
            e.cycles_drip_center_fert,
            e.cycles_mister_south_fert,
            e.cycles_mister_west_fert,
            e.cycles_fert_master,
            e.irrigation_water_gal,
            e.fertigation_water_gal,
            e.runtime_grow_light_main_min,
            e.runtime_grow_light_grow_min,
            e.quality_filtered_meter_gal,
            e.climate_wetting_gal,
            e.planning_water_gal,
            e.water_ok,
            e.modeled_kwh,
            e.energy_ok,
            e.crop_dli_mol_m2_day,
            e.dli_availability,
            e.dli_unavailable_reason,
            e.dli_provenance,
            e.dli_validity_revision,
            e.dli_valid_from,
            e.dli_valid_to,
            COALESCE(e.compliance_pct, 0::double precision) AS score_compliance,
            e.water_ok AND e.energy_ok AND e.cost_total IS NOT NULL AS resource_ok,
            e.planning_water_gal AS water_gal_source
           FROM evidence e
        )
 SELECT date,
    round(compliance_pct::numeric, 1) AS compliance_pct,
    round(temp_compliance_pct::numeric, 1) AS temp_compliance_pct,
    round(vpd_compliance_pct::numeric, 1) AS vpd_compliance_pct,
    round(stress_hours_heat::numeric, 2) AS heat_stress_h,
    round(stress_hours_cold::numeric, 2) AS cold_stress_h,
    round(stress_hours_vpd_high::numeric, 2) AS vpd_high_stress_h,
    round(stress_hours_vpd_low::numeric, 2) AS vpd_low_stress_h,
    round((stress_hours_heat + stress_hours_cold + stress_hours_vpd_high + stress_hours_vpd_low)::numeric, 2) AS total_stress_h,
        CASE
            WHEN energy_ok THEN round(modeled_kwh::numeric, 2)
            ELSE NULL::numeric
        END AS kwh,
        CASE
            WHEN energy_ok THEN round(therms_estimated::numeric, 3)
            ELSE NULL::numeric
        END AS therms,
        CASE
            WHEN water_ok THEN round(planning_water_gal::numeric, 0)
            ELSE NULL::numeric
        END AS water_gal,
        CASE
            WHEN water_ok THEN round(climate_wetting_gal::numeric, 0)
            ELSE NULL::numeric
        END AS mister_water_gal,
        CASE
            WHEN energy_ok THEN round(cost_electric::numeric, 2)
            ELSE NULL::numeric
        END AS cost_electric,
        CASE
            WHEN energy_ok THEN round(cost_gas::numeric, 2)
            ELSE NULL::numeric
        END AS cost_gas,
        CASE
            WHEN water_ok THEN round(cost_water::numeric, 2)
            ELSE NULL::numeric
        END AS cost_water,
        CASE
            WHEN resource_ok THEN round(cost_total::numeric, 2)
            ELSE NULL::numeric
        END AS cost_total,
    round(temp_min::numeric, 1) AS temp_min,
    round(temp_max::numeric, 1) AS temp_max,
    round(temp_avg::numeric, 1) AS temp_avg,
    round(vpd_min::numeric, 2) AS vpd_min,
    round(vpd_max::numeric, 2) AS vpd_max,
    round(vpd_avg::numeric, 2) AS vpd_avg,
    round(crop_dli_mol_m2_day::numeric, 1) AS dli,
    round(min_dp_margin_f::numeric, 1) AS dp_margin_min_f,
    round(COALESCE(dp_risk_hours, 0::double precision)::numeric, 1) AS dp_risk_hours,
    round(score_compliance::numeric, 1) AS planner_score,
    0::numeric AS planner_score_resource_weight_pct,
    false AS resource_terms_available,
    dli_availability,
    dli_unavailable_reason,
    dli_provenance,
    dli_validity_revision,
    dli_valid_from,
    dli_valid_to,
    round(modeled_kwh::numeric, 2) AS kwh_modeled,
    round(therms_estimated::numeric, 3) AS therms_modeled,
    round(water_gal_source::numeric, 0) AS water_gal_est,
    COALESCE(round((modeled_kwh * 0.111::double precision)::numeric, 2), round(cost_electric::numeric, 2)) AS cost_electric_est,
    COALESCE(round((therms_estimated * 0.83::double precision)::numeric, 2), round(cost_gas::numeric, 2)) AS cost_gas_est,
    COALESCE(round((water_gal_source * 0.00484::double precision)::numeric, 2), round(cost_water::numeric, 2)) AS cost_water_est,
        CASE
            WHEN COALESCE(modeled_kwh * 0.111::double precision, cost_electric) IS NOT NULL THEN round((COALESCE(modeled_kwh * 0.111::double precision, cost_electric) + COALESCE(therms_estimated * 0.83::double precision, cost_gas, 0::double precision) + COALESCE(water_gal_source * 0.00484::double precision, cost_water, 0::double precision))::numeric, 2)
            ELSE NULL::numeric
        END AS cost_total_est
   FROM normalized
  ORDER BY date;
COMMENT ON VIEW public.v_daily_kpi IS
'Daily planner KPI. planner_score = compliance_pct, both axes in the served house band (290), at 100 % weight; resource_terms_available is false and planner_score_resource_weight_pct 0 by definition (309, #1623). kwh, therms and cost_* are nominal-model estimates gated on complete evidence; water is planning water only (climate wetting + irrigation + fertigation). Interior DLI is availability-bearing.';
COMMENT ON MATERIALIZED VIEW public.mv_daily_kpi IS
'Dashboard/scorecard snapshot of v_daily_kpi, refreshed every 10 min by the verdify-band-curve-refresh CronJob. fn_planner_scorecard and panels read THIS, not the live view (27 live-view scans per scorecard call OOM-crashed the DB on 2026-07-14/15). planner_score = served-band compliance_pct (309); the *_est/*_modeled columns are ungated display estimates over planning water.';

-- daily_summary last, held through the drops and the ALTER below.
LOCK TABLE public.daily_summary IN ACCESS EXCLUSIVE MODE;

-- Inference-infra telemetry: 268's Grafana wrappers, the latest views, the write facades, then the hypertables.
DROP VIEW verdify_grafana_runtime.v_gpu_power_latest, verdify_grafana_runtime.v_infra_cpu_latest,
    verdify_grafana_runtime.gpu_power, verdify_grafana_runtime.infra_cpu;
DROP FUNCTION verdify_grafana_runtime.fn_read_v_gpu_power_latest(), verdify_grafana_runtime.fn_read_v_infra_cpu_latest();
DROP VIEW public.v_gpu_power_latest, public.v_infra_cpu_latest,
    public.v_runtime_gpu_power_write, public.v_runtime_infra_cpu_write;
DROP TABLE public.gpu_power, public.infra_cpu;

-- Tables and views with no reader.
DROP VIEW public.v_openclaw_usage_daily, public.v_openclaw_usage_hourly;
DROP TABLE public.openclaw_interaction_log, public.achievable_envelope, public.weather_station,
    public.daily_summary_compliance_backup_20260430;

-- The crop-band grading.
DROP MATERIALIZED VIEW public.mv_zone_band_grade;
DROP VIEW public.v_zone_band, public.v_target_curve;
DROP FUNCTION public.fn_house_compliance(interval), public.fn_compliance_pct(interval),
    public.fn_compliance_v2(interval), public.fn_zone_band_grade(timestamptz,timestamptz,text),
    public.fn_zone_band(text,timestamptz,text), public.fn_grade_credit(numeric,numeric,numeric,numeric,numeric),
    public.fn_observed_minute_diagnostic(date,text);
DROP TABLE public.daily_zone_compliance, public.compliance_zone_weights;

-- The band timeline reads the served band the grading uses.
CREATE OR REPLACE FUNCTION public.fn_band_timeline(p_start timestamp with time zone, p_end timestamp with time zone, p_step interval DEFAULT '00:30:00'::interval, p_greenhouse_id text DEFAULT 'vallery'::text)
 RETURNS TABLE(ts timestamp with time zone, greenhouse_id text, timeline_phase text, crop_temp_low double precision, crop_temp_high double precision, crop_vpd_low double precision, crop_vpd_high double precision, projected_temp_low double precision, projected_temp_high double precision, projected_vpd_low double precision, projected_vpd_high double precision, actual_temp_low double precision, actual_temp_high double precision, actual_vpd_low double precision, actual_vpd_high double precision, firmware_temp_low double precision, firmware_temp_high double precision, firmware_vpd_low double precision, firmware_vpd_high double precision, temp_width_f double precision, vpd_width_kpa double precision, sw_fsm_controller_enabled boolean, indoor_temp_f double precision, indoor_vpd_kpa double precision, outdoor_temp_f double precision, outdoor_vpd_kpa double precision, solar_w_m2 double precision, outdoor_cold_for_vent boolean, temp_hysteresis_f double precision, heat_hysteresis_f double precision, d_heat_stage_2_f double precision, d_cool_stage_2_f double precision, bias_heat_f double precision, bias_cool_f double precision, vpd_hysteresis_kpa double precision, vpd_hysteresis_effective_kpa double precision, fog_escalation_kpa double precision, temp_heat_target_f double precision, temp_heat_on_below_f double precision, temp_heat2_on_below_f double precision, temp_heat2_clear_f double precision, temp_cool_on_above_f double precision, temp_cool_hold_until_f double precision, temp_cooling_entry_margin_f double precision, temp_cooling_exit_hysteresis_f double precision, solar_cooling_lead_f double precision, temp_cool_stage2_delta_f double precision, temp_cool_stage2_on_above_f double precision, vpd_humidify_on_above_kpa double precision, vpd_humidify_resolved_below_kpa double precision, vpd_dehum_on_below_kpa double precision, vpd_dehum_resolved_above_kpa double precision, vpd_low_eff_kpa double precision, vpd_high_eff_kpa double precision, vpd_vent_fog_on_above_kpa double precision, vpd_sealed_fog_on_above_kpa double precision)
 LANGUAGE sql
 STABLE ROWS 10000
AS $function$
WITH timeline AS (
    SELECT generate_series(p_start, p_end, p_step) AS ts
),
forecast_hourly AS (
    SELECT DISTINCT ON (date_trunc('hour', wf.ts))
        date_trunc('hour', wf.ts) AS forecast_hour,
        wf.temp_f AS outdoor_temp_f,
        wf.vpd_kpa AS outdoor_vpd_kpa,
        wf.solar_w_m2
      FROM weather_forecast wf
     WHERE wf.greenhouse_id = p_greenhouse_id
       AND wf.ts >= p_start - interval '1 hour'
       AND wf.ts <= p_end + interval '1 hour'
     ORDER BY date_trunc('hour', wf.ts), wf.fetched_at DESC
),
resolved AS (
SELECT
    t.ts,
    p_greenhouse_id AS greenhouse_id,
    CASE WHEN t.ts <= now() THEN 'actual' ELSE 'forecast' END AS timeline_phase,
    crop.temp_low AS crop_temp_low,
    crop.temp_high AS crop_temp_high,
    house.crop_vpd_low,
    house.crop_vpd_high,
    crop.temp_low AS projected_temp_low,
    crop.temp_high AS projected_temp_high,
    house.house_vpd_low AS projected_vpd_low,
    house.house_vpd_high AS projected_vpd_high,
    actual_temp_low.value AS actual_temp_low,
    actual_temp_high.value AS actual_temp_high,
    actual_vpd_low.value AS actual_vpd_low,
    actual_vpd_high.value AS actual_vpd_high,
    actual_climate.temp_avg AS indoor_temp_f,
    actual_climate.vpd_avg AS indoor_vpd_kpa,
    CASE
        WHEN t.ts <= now() THEN actual_climate.outdoor_temp_f
        ELSE forecast.outdoor_temp_f
    END AS outdoor_temp_f,
    CASE
        WHEN t.ts <= now() THEN actual_climate.outdoor_vpd_kpa
        ELSE forecast.outdoor_vpd_kpa
    END AS outdoor_vpd_kpa,
    CASE
        WHEN t.ts <= now() THEN actual_climate.solar_w_m2
        ELSE forecast.solar_w_m2
    END AS solar_w_m2,
    CASE
        WHEN t.ts <= now() THEN COALESCE(actual_temp_low.value, crop.temp_low)
        ELSE crop.temp_low
    END AS firmware_temp_low,
    CASE
        WHEN t.ts <= now() THEN COALESCE(actual_temp_high.value, crop.temp_high)
        ELSE crop.temp_high
    END AS firmware_temp_high,
    CASE
        WHEN t.ts <= now() THEN COALESCE(actual_vpd_low.value, house.house_vpd_low)
        ELSE house.house_vpd_low
    END AS firmware_vpd_low,
    CASE
        WHEN t.ts <= now() THEN COALESCE(actual_vpd_high.value, house.house_vpd_high)
        ELSE house.house_vpd_high
    END AS firmware_vpd_high
FROM timeline t
CROSS JOIN LATERAL fn_band_setpoints(t.ts) AS crop
CROSS JOIN LATERAL fn_house_vpd_control_band(t.ts) AS house
LEFT JOIN LATERAL (
    SELECT s.value
      FROM setpoint_snapshot s
     WHERE s.greenhouse_id = p_greenhouse_id
       AND s.parameter = 'band_house_temp_low'
       AND s.zone = 'house'
       AND t.ts <= now()
       AND s.ts <= t.ts
       AND s.ts > t.ts - interval '600 seconds'
     ORDER BY s.ts DESC
     LIMIT 1
) AS actual_temp_low ON true
LEFT JOIN LATERAL (
    SELECT s.value
      FROM setpoint_snapshot s
     WHERE s.greenhouse_id = p_greenhouse_id
       AND s.parameter = 'band_house_temp_high'
       AND s.zone = 'house'
       AND t.ts <= now()
       AND s.ts <= t.ts
       AND s.ts > t.ts - interval '600 seconds'
     ORDER BY s.ts DESC
     LIMIT 1
) AS actual_temp_high ON true
LEFT JOIN LATERAL (
    SELECT s.value
      FROM setpoint_snapshot s
     WHERE s.greenhouse_id = p_greenhouse_id
       AND s.parameter = 'band_house_vpd_low'
       AND s.zone = 'house'
       AND t.ts <= now()
       AND s.ts <= t.ts
       AND s.ts > t.ts - interval '600 seconds'
     ORDER BY s.ts DESC
     LIMIT 1
) AS actual_vpd_low ON true
LEFT JOIN LATERAL (
    SELECT s.value
      FROM setpoint_snapshot s
     WHERE s.greenhouse_id = p_greenhouse_id
       AND s.parameter = 'band_house_vpd_high'
       AND s.zone = 'house'
       AND t.ts <= now()
       AND s.ts <= t.ts
       AND s.ts > t.ts - interval '600 seconds'
     ORDER BY s.ts DESC
     LIMIT 1
) AS actual_vpd_high ON true
LEFT JOIN LATERAL (
    SELECT
        c.temp_avg,
        c.vpd_avg,
        c.outdoor_temp_f,
        CASE
            WHEN c.outdoor_temp_f IS NOT NULL AND c.outdoor_rh_pct IS NOT NULL THEN
                0.6108
                * exp(17.27 * ((c.outdoor_temp_f - 32.0) / 1.8)
                      / (((c.outdoor_temp_f - 32.0) / 1.8) + 237.3))
                * (1.0 - c.outdoor_rh_pct / 100.0)
            ELSE NULL
        END AS outdoor_vpd_kpa,
        c.solar_irradiance_w_m2 AS solar_w_m2
      FROM climate c
     WHERE c.greenhouse_id = p_greenhouse_id
       AND t.ts <= now()
       AND c.ts <= t.ts
       AND c.ts >= t.ts - interval '15 minutes'
     ORDER BY c.ts DESC
    LIMIT 1
) AS actual_climate ON true
LEFT JOIN forecast_hourly forecast
       ON t.ts > now()
      AND forecast.forecast_hour = date_trunc('hour', t.ts + interval '30 minutes')
),
with_tunables AS (
    SELECT
        r.*,
        greatest(2.0, r.firmware_temp_high - r.firmware_temp_low) AS temp_width_f,
        greatest(0.2, r.firmware_vpd_high - r.firmware_vpd_low) AS vpd_width_kpa,
        fn_timeline_setpoint_value(p_greenhouse_id, 'sw_fsm_controller_enabled', r.ts, 1.0) >= 0.5
            AS sw_fsm_controller_enabled,
        fn_timeline_setpoint_value(p_greenhouse_id, 'temp_hysteresis', r.ts, 1.5)
            AS temp_hysteresis_f,
        fn_timeline_setpoint_value(p_greenhouse_id, 'heat_hysteresis', r.ts, 1.0)
            AS heat_hysteresis_f,
        fn_timeline_setpoint_value(p_greenhouse_id, 'd_heat_stage_2', r.ts, 5.0)
            AS d_heat_stage_2_f,
        fn_timeline_setpoint_value(p_greenhouse_id, 'd_cool_stage_2', r.ts, 3.0)
            AS d_cool_stage_2_f,
        fn_timeline_setpoint_value(p_greenhouse_id, 'bias_heat', r.ts, 0.0)
            AS bias_heat_f,
        fn_timeline_setpoint_value(p_greenhouse_id, 'bias_cool', r.ts, 0.0)
            AS bias_cool_f,
        fn_timeline_setpoint_value(p_greenhouse_id, 'vpd_hysteresis', r.ts, 0.3)
            AS vpd_hysteresis_kpa,
        fn_timeline_setpoint_value(p_greenhouse_id, 'fog_escalation_kpa', r.ts, 0.4)
            AS fog_escalation_kpa
    FROM resolved r
),
derived_base AS (
    SELECT
        t.*,
        CASE
            WHEN t.sw_fsm_controller_enabled THEN
                least(greatest(0.05, t.vpd_hysteresis_kpa), greatest(0.05, t.vpd_width_kpa * 0.33))
            ELSE
                least(greatest(0.05, t.vpd_hysteresis_kpa), t.firmware_vpd_high * 0.5)
        END AS vpd_hysteresis_effective_kpa,
        CASE
            WHEN t.sw_fsm_controller_enabled THEN
                t.firmware_temp_low + t.temp_width_f * 0.25
            ELSE
                t.firmware_temp_low + t.temp_width_f * 0.25 + t.bias_heat_f
        END AS temp_heat_target_f,
        CASE
            WHEN t.sw_fsm_controller_enabled THEN
                least(t.d_cool_stage_2_f, greatest(1.0, t.temp_width_f * 0.25))
            ELSE
                t.d_cool_stage_2_f
        END AS temp_cool_stage2_delta_f,
        t.firmware_vpd_low + t.vpd_width_kpa * 0.25 AS vpd_low_eff_kpa,
        t.firmware_vpd_high - t.vpd_width_kpa * 0.25 AS vpd_high_eff_kpa
    FROM with_tunables t
),
derived AS (
    SELECT
        b.*,
        (
            b.outdoor_temp_f IS NOT NULL
            AND b.outdoor_temp_f < (b.firmware_temp_low - 10.0)
        ) AS outdoor_cold_for_vent,
        CASE
            WHEN b.sw_fsm_controller_enabled
             AND b.outdoor_temp_f IS NOT NULL
             AND b.outdoor_temp_f < (b.firmware_temp_low - 10.0)
                THEN b.temp_cool_stage2_delta_f
            ELSE 0.0
        END AS temp_cooling_entry_margin_f,
        CASE
            WHEN b.sw_fsm_controller_enabled
             AND b.outdoor_temp_f IS NOT NULL
             AND b.outdoor_temp_f < (b.firmware_temp_low - 10.0)
                THEN greatest(b.temp_hysteresis_f, 3.0)
            ELSE b.temp_hysteresis_f
        END AS temp_cooling_exit_hysteresis_f,
        CASE
            WHEN b.sw_fsm_controller_enabled
             AND NOT (
                 b.outdoor_temp_f IS NOT NULL
                 AND b.outdoor_temp_f < (b.firmware_temp_low - 10.0)
             )
             AND b.solar_w_m2 IS NOT NULL
             AND b.solar_w_m2 >= 500.0
             AND extract(hour FROM b.ts AT TIME ZONE 'America/Denver') BETWEEN 10 AND 17
             AND b.indoor_vpd_kpa IS NOT NULL
             AND b.indoor_vpd_kpa <= (b.firmware_vpd_high - b.vpd_hysteresis_effective_kpa)
                THEN 1.0
            ELSE 0.0
        END AS solar_cooling_lead_f,
        CASE
            WHEN b.sw_fsm_controller_enabled THEN
                greatest(
                    b.firmware_temp_low + 1.0,
                    b.firmware_temp_high
                    + CASE
                        WHEN b.outdoor_temp_f IS NOT NULL
                         AND b.outdoor_temp_f < (b.firmware_temp_low - 10.0)
                            THEN b.temp_cool_stage2_delta_f
                        ELSE 0.0
                    END
                    - CASE
                        WHEN NOT (
                            b.outdoor_temp_f IS NOT NULL
                            AND b.outdoor_temp_f < (b.firmware_temp_low - 10.0)
                        )
                         AND b.solar_w_m2 IS NOT NULL
                         AND b.solar_w_m2 >= 500.0
                         AND extract(hour FROM b.ts AT TIME ZONE 'America/Denver') BETWEEN 10 AND 17
                         AND b.indoor_vpd_kpa IS NOT NULL
                         AND b.indoor_vpd_kpa <= (b.firmware_vpd_high - b.vpd_hysteresis_effective_kpa)
                            THEN 1.0
                        ELSE 0.0
                    END
                )
            ELSE
                b.firmware_temp_high - b.temp_width_f * 0.25 + b.bias_cool_f
        END AS temp_cool_on_above_f
    FROM derived_base b
)
SELECT
    d.ts,
    d.greenhouse_id,
    d.timeline_phase,
    d.crop_temp_low,
    d.crop_temp_high,
    d.crop_vpd_low,
    d.crop_vpd_high,
    d.projected_temp_low,
    d.projected_temp_high,
    d.projected_vpd_low,
    d.projected_vpd_high,
    d.actual_temp_low,
    d.actual_temp_high,
    d.actual_vpd_low,
    d.actual_vpd_high,
    d.firmware_temp_low,
    d.firmware_temp_high,
    d.firmware_vpd_low,
    d.firmware_vpd_high,
    d.temp_width_f,
    d.vpd_width_kpa,
    d.sw_fsm_controller_enabled,
    d.indoor_temp_f,
    d.indoor_vpd_kpa,
    d.outdoor_temp_f,
    d.outdoor_vpd_kpa,
    d.solar_w_m2,
    d.outdoor_cold_for_vent,
    d.temp_hysteresis_f,
    d.heat_hysteresis_f,
    d.d_heat_stage_2_f,
    d.d_cool_stage_2_f,
    d.bias_heat_f,
    d.bias_cool_f,
    d.vpd_hysteresis_kpa,
    d.vpd_hysteresis_effective_kpa,
    d.fog_escalation_kpa,
    d.temp_heat_target_f,
    d.temp_heat_target_f + d.heat_hysteresis_f AS temp_heat_on_below_f,
    CASE
        WHEN d.sw_fsm_controller_enabled THEN d.firmware_temp_low
        ELSE d.temp_heat_target_f - d.d_heat_stage_2_f
    END AS temp_heat2_on_below_f,
    CASE
        WHEN d.sw_fsm_controller_enabled THEN d.temp_heat_target_f
        ELSE d.temp_heat_target_f + d.heat_hysteresis_f
    END AS temp_heat2_clear_f,
    d.temp_cool_on_above_f,
    CASE
        WHEN d.sw_fsm_controller_enabled THEN
            least(
                d.firmware_temp_high - d.temp_cooling_exit_hysteresis_f,
                d.temp_cool_on_above_f - d.temp_cooling_exit_hysteresis_f
            )
        ELSE d.temp_cool_on_above_f - d.temp_hysteresis_f
    END AS temp_cool_hold_until_f,
    d.temp_cooling_entry_margin_f,
    d.temp_cooling_exit_hysteresis_f,
    d.solar_cooling_lead_f,
    d.temp_cool_stage2_delta_f,
    CASE
        WHEN d.sw_fsm_controller_enabled THEN d.firmware_temp_high + d.temp_cool_stage2_delta_f
        ELSE d.temp_cool_on_above_f + d.temp_cool_stage2_delta_f
    END AS temp_cool_stage2_on_above_f,
    d.firmware_vpd_high AS vpd_humidify_on_above_kpa,
    d.firmware_vpd_high - d.vpd_hysteresis_effective_kpa AS vpd_humidify_resolved_below_kpa,
    CASE
        WHEN d.sw_fsm_controller_enabled AND d.outdoor_cold_for_vent THEN
            d.firmware_vpd_low - d.vpd_hysteresis_effective_kpa
        ELSE d.firmware_vpd_low
    END AS vpd_dehum_on_below_kpa,
    d.firmware_vpd_low + d.vpd_hysteresis_effective_kpa AS vpd_dehum_resolved_above_kpa,
    d.vpd_low_eff_kpa,
    d.vpd_high_eff_kpa,
    d.vpd_high_eff_kpa + d.fog_escalation_kpa AS vpd_vent_fog_on_above_kpa,
    d.firmware_vpd_high + d.fog_escalation_kpa AS vpd_sealed_fog_on_above_kpa
FROM derived d
ORDER BY d.ts;
$function$;

-- Capture v3: the served-band keys only.
ALTER TABLE public.daily_climate_metric_revisions DROP CONSTRAINT daily_climate_metric_revisions_capture_schema_check;
ALTER TABLE public.daily_climate_metric_revisions ADD CONSTRAINT daily_climate_metric_revisions_capture_schema_check
    CHECK (capture_schema = ANY (ARRAY['daily-summary-capture-v1'::text, 'daily-summary-capture-v2'::text,
                                       'daily-summary-capture-v3'::text]));
ALTER TABLE public.daily_climate_metric_revisions ALTER COLUMN capture_schema SET DEFAULT 'daily-summary-capture-v3';

CREATE OR REPLACE FUNCTION public.fn_capture_daily_climate_metric_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    prior_metrics jsonb;
    next_metrics jsonb;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        prior_metrics := jsonb_build_object(
        'binary', jsonb_build_object(
            'compliance_pct', OLD.compliance_pct,
            'temp_compliance_pct', OLD.temp_compliance_pct,
            'vpd_compliance_pct', OLD.vpd_compliance_pct,
            'stress_hours_heat', OLD.stress_hours_heat,
            'stress_hours_cold', OLD.stress_hours_cold,
            'stress_hours_vpd_high', OLD.stress_hours_vpd_high,
            'stress_hours_vpd_low', OLD.stress_hours_vpd_low)
    );
    END IF;
    IF TG_OP <> 'DELETE' THEN
        next_metrics := jsonb_build_object(
        'binary', jsonb_build_object(
            'compliance_pct', NEW.compliance_pct,
            'temp_compliance_pct', NEW.temp_compliance_pct,
            'vpd_compliance_pct', NEW.vpd_compliance_pct,
            'stress_hours_heat', NEW.stress_hours_heat,
            'stress_hours_cold', NEW.stress_hours_cold,
            'stress_hours_vpd_high', NEW.stress_hours_vpd_high,
            'stress_hours_vpd_low', NEW.stress_hours_vpd_low)
    );
    END IF;
    IF TG_OP = 'UPDATE'
       AND prior_metrics IS NOT DISTINCT FROM next_metrics
       AND OLD.date IS NOT DISTINCT FROM NEW.date
       AND OLD.greenhouse_id IS NOT DISTINCT FROM NEW.greenhouse_id THEN
        RETURN NULL; -- unrelated fields/no-op refresh must not manufacture revisions
    END IF;
    IF TG_OP <> 'INSERT' THEN
        INSERT INTO public.daily_climate_metric_revisions
            (operation, greenhouse_id, day, source_captured_at, metrics)
        VALUES (CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'before_update' END,
                OLD.greenhouse_id, OLD.date, OLD.captured_at, prior_metrics);
    END IF;
    IF TG_OP <> 'DELETE' THEN
        INSERT INTO public.daily_climate_metric_revisions
            (operation, greenhouse_id, day, source_captured_at, metrics)
        VALUES (CASE WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'after_update' END,
                NEW.greenhouse_id, NEW.date, NEW.captured_at, next_metrics);
    END IF;
    RETURN NULL; -- AFTER trigger; never modifies or skips the source write
END;
$function$;

ALTER TABLE public.daily_summary
    DROP COLUMN compliance_v2_raw_pct, DROP COLUMN compliance_v2_attributable_pct,
    DROP COLUMN compliance_v2_unachievable_frac, DROP COLUMN graded_temp_compliance_pct,
    DROP COLUMN graded_vpd_compliance_pct, DROP COLUMN graded_stress_hours_heat, DROP COLUMN graded_stress_hours_cold,
    DROP COLUMN graded_stress_hours_vpd_high, DROP COLUMN graded_stress_hours_vpd_low,
    DROP COLUMN feasibility_unknown_min, DROP COLUMN climate_observed_minute_metrics,
    DROP COLUMN kwh_heat, DROP COLUMN kwh_fans, DROP COLUMN kwh_other, DROP COLUMN gas_used_therms,
    DROP COLUMN dev_temp_norm_median_day, DROP COLUMN dev_temp_norm_median_night, DROP COLUMN dev_temp_norm_p95,
    DROP COLUMN dev_vpd_norm_median_day, DROP COLUMN dev_vpd_norm_median_night, DROP COLUMN dev_vpd_norm_p95,
    DROP COLUMN notes, DROP COLUMN cycles_dehum, DROP COLUMN cycles_safety_dehum, DROP COLUMN dli_final;

CREATE VIEW public.v_planner_performance AS
WITH daily AS (
         SELECT d.date,
            d.cycles_fan1,
            d.cycles_fan2,
            d.cycles_heat1,
            d.cycles_heat2,
            d.cycles_fog,
            d.cycles_vent,
            d.runtime_fan1_min,
            d.runtime_fan2_min,
            d.runtime_heat1_min,
            d.runtime_heat2_min,
            d.runtime_fog_min,
            d.runtime_vent_min,
            d.runtime_mister_south_h,
            d.runtime_mister_west_h,
            d.runtime_mister_center_h,
            d.water_used_gal,
            d.mister_water_gal,
            d.captured_at,
            d.kwh_total,
            d.peak_kw,
            d.runtime_grow_light_min,
            d.cycles_grow_light,
            d.runtime_drip_wall_h,
            d.runtime_drip_center_h,
            d.kwh_estimated,
            d.therms_estimated,
            d.cost_electric,
            d.cost_gas,
            d.cost_water,
            d.cost_total,
            d.temp_min,
            d.temp_max,
            d.temp_avg,
            d.rh_min,
            d.rh_max,
            d.rh_avg,
            d.vpd_min,
            d.vpd_max,
            d.vpd_avg,
            d.co2_avg,
            d.outdoor_temp_min,
            d.outdoor_temp_max,
            d.stress_hours_heat,
            d.stress_hours_cold,
            d.stress_hours_vpd_high,
            d.stress_hours_vpd_low,
            d.greenhouse_id,
            d.min_dp_margin_f,
            d.dp_risk_hours,
            d.compliance_pct,
            d.temp_compliance_pct,
            d.vpd_compliance_pct,
            d.mister_fairness_overrides_today,
            d.cycles_mister_south,
            d.cycles_mister_west,
            d.cycles_mister_center,
            d.cycles_drip_wall,
            d.cycles_drip_center,
            d.runtime_drip_wall_fert_h,
            d.runtime_drip_center_fert_h,
            d.runtime_mister_south_fert_h,
            d.runtime_mister_west_fert_h,
            d.runtime_fert_master_h,
            d.runtime_irrigation_clean_h,
            d.runtime_irrigation_fert_h,
            d.runtime_irrigation_total_h,
            d.cycles_drip_wall_fert,
            d.cycles_drip_center_fert,
            d.cycles_mister_south_fert,
            d.cycles_mister_west_fert,
            d.cycles_fert_master,
            d.irrigation_water_gal,
            d.fertigation_water_gal,
            d.runtime_grow_light_main_min,
            d.runtime_grow_light_grow_min,
            COALESCE(w.available_for_scoring, false) AS water_ok,
            COALESCE(e.available_for_scoring, false) AS energy_ok
           FROM daily_summary d
             LEFT JOIN v_water_attribution_daily w ON w.date = d.date AND w.greenhouse_id = d.greenhouse_id
             LEFT JOIN v_runtime_energy_daily e ON e.date = d.date AND e.greenhouse_id = d.greenhouse_id
          WHERE d.date IS NOT NULL
        ), scored AS (
         SELECT d.date,
            d.stress_hours_heat AS heat_stress_h,
            d.stress_hours_cold AS cold_stress_h,
            d.stress_hours_vpd_high AS vpd_high_stress_h,
            d.stress_hours_vpd_low AS vpd_low_stress_h,
            COALESCE(d.compliance_pct, 0::double precision) AS score_compliance,
            d.compliance_pct,
            d.temp_compliance_pct,
            d.vpd_compliance_pct,
                CASE
                    WHEN d.water_ok AND d.energy_ok THEN d.cost_total
                    ELSE NULL::double precision
                END AS cost_total,
                CASE
                    WHEN d.energy_ok THEN d.cost_electric
                    ELSE NULL::double precision
                END AS cost_electric,
                CASE
                    WHEN d.water_ok AND d.energy_ok AND d.cost_total IS NOT NULL THEN d.cost_gas
                    ELSE NULL::double precision
                END AS cost_gas,
                CASE
                    WHEN d.water_ok THEN d.cost_water
                    ELSE NULL::double precision
                END AS cost_water,
            d.compliance_pct AS compliance_binary_pct,
            d.water_ok AND d.energy_ok AND d.cost_total IS NOT NULL AS resource_ok
           FROM daily d
        )
 SELECT date,
    heat_stress_h,
    cold_stress_h,
    vpd_high_stress_h,
    vpd_low_stress_h,
    heat_stress_h + cold_stress_h + vpd_high_stress_h + vpd_low_stress_h AS total_stress_h,
    round(compliance_pct::numeric, 1) AS compliance_pct,
    round(temp_compliance_pct::numeric, 1) AS temp_compliance_pct,
    round(vpd_compliance_pct::numeric, 1) AS vpd_compliance_pct,
    cost_total,
    cost_electric,
    cost_gas,
    cost_water,
        CASE
            WHEN (heat_stress_h + cold_stress_h + vpd_high_stress_h + vpd_low_stress_h) > 0::double precision AND cost_total IS NOT NULL THEN round((cost_total / (heat_stress_h + cold_stress_h + vpd_high_stress_h + vpd_low_stress_h))::numeric, 2)
            ELSE NULL::numeric
        END AS cost_per_stress_hour,
    round(score_compliance::numeric, 1) AS planner_score,
    round(compliance_binary_pct::numeric, 1) AS compliance_binary_pct,
    0::numeric AS planner_score_resource_weight_pct,
    false AS resource_terms_available
   FROM scored;
COMMENT ON VIEW public.v_planner_performance IS
'Contract 3 (309): served house band reading fractions and stress hours. planner_score = compliance_pct at 100 % weight; cost columns are informational nominal-model estimates and resource_terms_available is false by definition (#1623).';
GRANT SELECT ON public.v_planner_performance TO verdify_api_runtime;

CREATE VIEW public.v_plan_window_scorecard AS
WITH plan_days AS (
         SELECT pei.plan_id,
            d.d::date AS day,
            GREATEST(EXTRACT(epoch FROM LEAST(pei.interval_end, d.d + '1 day'::interval) - GREATEST(pei.interval_start, d.d)) / 86400.0, 0::numeric) AS day_weight
           FROM v_plan_execution_intervals pei
             CROSS JOIN LATERAL generate_series(pei.interval_start::date::timestamp with time zone, LEAST(pei.interval_end::date, CURRENT_DATE)::timestamp with time zone, '1 day'::interval) d(d)
        )
 SELECT pd.plan_id,
    sum(pd.day_weight) AS governed_day_fraction,
    sum(pd.day_weight::double precision * COALESCE(vpp.heat_stress_h, 0::double precision)) AS heat_stress_h,
    sum(pd.day_weight::double precision * COALESCE(vpp.cold_stress_h, 0::double precision)) AS cold_stress_h,
    sum(pd.day_weight::double precision * COALESCE(vpp.vpd_high_stress_h, 0::double precision)) AS vpd_high_stress_h,
    sum(pd.day_weight::double precision * COALESCE(vpp.vpd_low_stress_h, 0::double precision)) AS vpd_low_stress_h,
    sum(pd.day_weight::double precision * COALESCE(vpp.total_stress_h, 0::double precision)) AS total_stress_h,
        CASE
            WHEN sum(pd.day_weight) > 0::numeric THEN sum(pd.day_weight * COALESCE(vpp.compliance_pct, 0::numeric)) / sum(pd.day_weight)
            ELSE NULL::numeric
        END AS compliance_pct,
        CASE
            WHEN sum(pd.day_weight) > 0::numeric THEN sum(pd.day_weight * COALESCE(vpp.temp_compliance_pct, 0::numeric)) / sum(pd.day_weight)
            ELSE NULL::numeric
        END AS temp_compliance_pct,
        CASE
            WHEN sum(pd.day_weight) > 0::numeric THEN sum(pd.day_weight * COALESCE(vpp.vpd_compliance_pct, 0::numeric)) / sum(pd.day_weight)
            ELSE NULL::numeric
        END AS vpd_compliance_pct,
    sum(pd.day_weight::double precision * COALESCE(vpp.cost_total, 0::double precision)) AS cost_total,
        CASE
            WHEN sum(pd.day_weight) > 0::numeric THEN sum(pd.day_weight * COALESCE(vpp.planner_score, 0::numeric)) / sum(pd.day_weight)
            ELSE NULL::numeric
        END AS planner_score
   FROM plan_days pd
     LEFT JOIN v_planner_performance vpp ON vpp.date = pd.day
  GROUP BY pd.plan_id;
GRANT SELECT ON public.v_plan_window_scorecard TO verdify_ingestor_runtime, verdify_mcp_runtime;

CREATE FUNCTION verdify_grafana_runtime.fn_read_v_planner_performance() RETURNS TABLE("date" date, "heat_stress_h" double precision, "cold_stress_h" double precision, "vpd_high_stress_h" double precision, "vpd_low_stress_h" double precision, "total_stress_h" double precision, "compliance_pct" numeric, "temp_compliance_pct" numeric, "vpd_compliance_pct" numeric, "cost_total" double precision, "cost_electric" double precision, "cost_gas" double precision, "cost_water" double precision, "cost_per_stress_hour" numeric, "planner_score" numeric, "compliance_binary_pct" numeric, "planner_score_resource_weight_pct" numeric, "resource_terms_available" boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $read$ SELECT "date", "heat_stress_h", "cold_stress_h", "vpd_high_stress_h", "vpd_low_stress_h", "total_stress_h", "compliance_pct", "temp_compliance_pct", "vpd_compliance_pct", "cost_total", "cost_electric", "cost_gas", "cost_water", "cost_per_stress_hour", "planner_score", "compliance_binary_pct", "planner_score_resource_weight_pct", "resource_terms_available" FROM public.v_planner_performance $read$;
REVOKE ALL ON FUNCTION verdify_grafana_runtime.fn_read_v_planner_performance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verdify_grafana_runtime.fn_read_v_planner_performance() TO verdify_grafana_runtime;
CREATE VIEW verdify_grafana_runtime.v_planner_performance WITH(security_barrier=true) AS SELECT * FROM verdify_grafana_runtime.fn_read_v_planner_performance();
REVOKE ALL ON verdify_grafana_runtime.v_planner_performance FROM PUBLIC;
GRANT SELECT ON verdify_grafana_runtime.v_planner_performance TO verdify_grafana_runtime;

CREATE VIEW verdify_grafana_runtime.daily_summary WITH(security_barrier=true) AS SELECT "date", "cycles_fan1", "cycles_fan2", "cycles_heat1", "cycles_heat2", "cycles_fog", "cycles_vent", "runtime_fan1_min", "runtime_fan2_min", "runtime_heat1_min", "runtime_heat2_min", "runtime_fog_min", "runtime_vent_min", "runtime_mister_south_h", "runtime_mister_west_h", "runtime_mister_center_h", "water_used_gal", "mister_water_gal", "captured_at", "kwh_total", "peak_kw", "runtime_grow_light_min", "cycles_grow_light", "runtime_drip_wall_h", "runtime_drip_center_h", "kwh_estimated", "therms_estimated", "cost_electric", "cost_gas", "cost_water", "cost_total", "temp_min", "temp_max", "temp_avg", "rh_min", "rh_max", "rh_avg", "vpd_min", "vpd_max", "vpd_avg", "co2_avg", "outdoor_temp_min", "outdoor_temp_max", "stress_hours_heat", "stress_hours_cold", "stress_hours_vpd_high", "stress_hours_vpd_low", "greenhouse_id", "min_dp_margin_f", "dp_risk_hours", "compliance_pct", "temp_compliance_pct", "vpd_compliance_pct", "mister_fairness_overrides_today", "cycles_mister_south", "cycles_mister_west", "cycles_mister_center", "cycles_drip_wall", "cycles_drip_center", "runtime_drip_wall_fert_h", "runtime_drip_center_fert_h", "runtime_mister_south_fert_h", "runtime_mister_west_fert_h", "runtime_fert_master_h", "runtime_irrigation_clean_h", "runtime_irrigation_fert_h", "runtime_irrigation_total_h", "cycles_drip_wall_fert", "cycles_drip_center_fert", "cycles_mister_south_fert", "cycles_mister_west_fert", "cycles_fert_master", "irrigation_water_gal", "fertigation_water_gal", "runtime_grow_light_main_min", "runtime_grow_light_grow_min" FROM public.daily_summary;
REVOKE ALL ON verdify_grafana_runtime.daily_summary FROM PUBLIC;
GRANT SELECT ON verdify_grafana_runtime.daily_summary TO verdify_grafana_runtime;
CREATE VIEW verdify_lab_publisher_runtime.daily_summary WITH(security_barrier=true) AS SELECT "date", "cycles_fan1", "cycles_fan2", "cycles_heat1", "cycles_heat2", "cycles_fog", "cycles_vent", "runtime_fan1_min", "runtime_fan2_min", "runtime_heat1_min", "runtime_heat2_min", "runtime_fog_min", "runtime_vent_min", "runtime_mister_south_h", "runtime_mister_west_h", "runtime_mister_center_h", "water_used_gal", "mister_water_gal", "captured_at", "kwh_total", "peak_kw", "runtime_grow_light_min", "cycles_grow_light", "runtime_drip_wall_h", "runtime_drip_center_h", "kwh_estimated", "therms_estimated", "cost_electric", "cost_gas", "cost_water", "cost_total", "temp_min", "temp_max", "temp_avg", "rh_min", "rh_max", "rh_avg", "vpd_min", "vpd_max", "vpd_avg", "co2_avg", "outdoor_temp_min", "outdoor_temp_max", "stress_hours_heat", "stress_hours_cold", "stress_hours_vpd_high", "stress_hours_vpd_low", "greenhouse_id", "min_dp_margin_f", "dp_risk_hours", "compliance_pct", "temp_compliance_pct", "vpd_compliance_pct", "mister_fairness_overrides_today", "cycles_mister_south", "cycles_mister_west", "cycles_mister_center", "cycles_drip_wall", "cycles_drip_center", "runtime_drip_wall_fert_h", "runtime_drip_center_fert_h", "runtime_mister_south_fert_h", "runtime_mister_west_fert_h", "runtime_fert_master_h", "runtime_irrigation_clean_h", "runtime_irrigation_fert_h", "runtime_irrigation_total_h", "cycles_drip_wall_fert", "cycles_drip_center_fert", "cycles_mister_south_fert", "cycles_mister_west_fert", "cycles_fert_master", "irrigation_water_gal", "fertigation_water_gal", "runtime_grow_light_main_min", "runtime_grow_light_grow_min" FROM public.daily_summary;
REVOKE ALL ON verdify_lab_publisher_runtime.daily_summary FROM PUBLIC;
GRANT SELECT ON verdify_lab_publisher_runtime.daily_summary TO verdify_lab_publisher_runtime;

REFRESH MATERIALIZED VIEW public.mv_daily_kpi;

-- Successor seals: the probe of the rolled-back native qualification measures them, and each receipt is re-sealed.
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22'
    THEN RAISE EXCEPTION '309 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '309 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '309 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '309 missing mcp receipt'; END IF;
END $successor$;
