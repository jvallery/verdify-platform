-- Run only inside an explicit rollback-only transaction after exact 309 (one band), as the superuser owner:
-- scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. The crop-band
-- grading, the inference-infra telemetry, the retired tables and the retired daily_summary columns are gone;
-- planner_score equals the served-band compliance_pct on every day with resource terms off; planning water excludes
-- house water; the scorecard is contract 3 with no crop-band metric; today's stress view and the band timeline read
-- the served band; capture is v3. Every consumer login keeps its reads. The rollback discards all of it. The last
-- line reports the result.
DO $catalog$
DECLARE
    retired_relations text[] := ARRAY['public.daily_zone_compliance', 'public.compliance_zone_weights',
        'public.mv_zone_band_grade', 'public.v_zone_band', 'public.v_target_curve',
        'public.v_scorecard_climate_diagnostics', 'public.gpu_power', 'public.infra_cpu', 'public.v_gpu_power_latest',
        'public.v_infra_cpu_latest', 'public.v_runtime_gpu_power_write', 'public.v_runtime_infra_cpu_write',
        'verdify_grafana_runtime.gpu_power', 'verdify_grafana_runtime.infra_cpu',
        'verdify_grafana_runtime.v_gpu_power_latest', 'verdify_grafana_runtime.v_infra_cpu_latest',
        'public.achievable_envelope', 'public.weather_station', 'public.daily_summary_compliance_backup_20260430',
        'public.openclaw_interaction_log', 'public.v_openclaw_usage_daily', 'public.v_openclaw_usage_hourly'];
    retired_functions text[] := ARRAY['public.fn_zone_band(text,timestamptz,text)',
        'public.fn_zone_band_grade(timestamptz,timestamptz,text)', 'public.fn_compliance_v2(interval)',
        'public.fn_grade_credit(numeric,numeric,numeric,numeric,numeric)', 'public.fn_compliance_pct(interval)',
        'public.fn_house_compliance(interval)', 'public.fn_observed_minute_diagnostic(date,text)',
        'verdify_grafana_runtime.fn_read_v_gpu_power_latest()', 'verdify_grafana_runtime.fn_read_v_infra_cpu_latest()'];
    yesterday date := (now() AT TIME ZONE 'America/Denver')::date - 1;
BEGIN
    IF EXISTS(SELECT 1 FROM unnest(retired_relations) r WHERE to_regclass(r) IS NOT NULL)
        OR EXISTS(SELECT 1 FROM unnest(retired_functions) f WHERE to_regprocedure(f) IS NOT NULL)
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.daily_summary'::regclass
                   AND NOT attisdropped AND attnum > 0
                   AND (attname ~ '^(compliance_v2_|graded_|dev_temp_norm_|dev_vpd_norm_)'
                        OR attname IN ('feasibility_unknown_min', 'climate_observed_minute_metrics', 'kwh_heat',
                                       'kwh_fans', 'kwh_other', 'gas_used_therms', 'notes', 'cycles_dehum',
                                       'cycles_safety_dehum', 'dli_final')))
        OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid = 'public.daily_summary'::regclass
             AND attnum > 0 AND NOT attisdropped) <> 76
        OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid = 'verdify_grafana_runtime.daily_summary'::regclass
             AND attnum > 0 AND NOT attisdropped) <> 76
        OR (SELECT count(*) FROM pg_catalog.pg_attribute
             WHERE attrelid = 'verdify_lab_publisher_runtime.daily_summary'::regclass AND attnum > 0 AND NOT attisdropped) <> 76
    THEN RAISE EXCEPTION '309 retirement is not exact'; END IF;
    IF EXISTS(SELECT 1 FROM public.mv_daily_kpi k
               WHERE k.planner_score IS DISTINCT FROM COALESCE(k.compliance_pct, 0)
                  OR k.resource_terms_available OR k.planner_score_resource_weight_pct <> 0)
        OR EXISTS(SELECT 1 FROM public.v_planner_performance p
               WHERE p.planner_score IS DISTINCT FROM COALESCE(p.compliance_pct, 0) OR p.resource_terms_available)
        OR (SELECT value FROM public.fn_planner_scorecard(yesterday) WHERE metric = 'scorecard_contract_version') <> 3
        OR (SELECT value FROM public.fn_planner_scorecard(yesterday) WHERE metric = 'planner_score')
           IS DISTINCT FROM (SELECT value FROM public.fn_planner_scorecard(yesterday) WHERE metric = 'compliance_pct')
        OR EXISTS(SELECT 1 FROM public.fn_planner_scorecard(yesterday)
                   WHERE metric ~ '(compliance_v2|graded|unachievable|feasib)')
        OR (SELECT value FROM public.fn_planner_scorecard(yesterday) WHERE metric = 'resource_terms_available') <> 0
    THEN RAISE EXCEPTION '309 planner score is not the served band'; END IF;
    IF EXISTS(SELECT 1 FROM public.v_water_attribution_daily w
               WHERE w.planning_water_gal IS DISTINCT FROM w.climate_wetting_gal + w.wall_irrigation_gal + w.wall_fertigation_gal
                  OR w.house_water_gal IS DISTINCT FROM w.manual_or_unattributed_gal)
        OR EXISTS(SELECT 1 FROM public.mv_daily_kpi k JOIN public.v_water_attribution_daily w ON w.date = k.date
                   WHERE k.water_gal IS NOT NULL AND k.water_gal <> round(w.planning_water_gal::numeric, 0))
    THEN RAISE EXCEPTION '309 planning water includes house water'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.v_runtime_energy_daily e
                   WHERE e.date BETWEEN yesterday - 6 AND yesterday AND e.available_for_scoring)
        OR NOT EXISTS(SELECT 1 FROM public.mv_daily_kpi k WHERE k.date BETWEEN yesterday - 6 AND yesterday
                       AND k.kwh IS NOT NULL)
    THEN RAISE EXCEPTION '309 modelled energy is still gated on coefficient certainty'; END IF;
    IF (SELECT count(*) FROM public.v_stress_hours_today) <> 1
        OR (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public'
             AND table_name = 'daily_climate_metric_revisions' AND column_name = 'capture_schema')
           IS DISTINCT FROM '''daily-summary-capture-v3''::text'
        OR pg_get_functiondef('public.fn_band_timeline(timestamptz,timestamptz,interval,text)'::regprocedure)
           LIKE '%setpoint_changes%'
        OR NOT EXISTS(SELECT 1 FROM public.fn_band_timeline(now() - interval '1 hour', now(), interval '15 minutes')
                       WHERE actual_temp_low IS NOT NULL AND actual_vpd_high IS NOT NULL)
    THEN RAISE EXCEPTION '309 served-band readers are not exact'; END IF;
END $catalog$;

-- SET SESSION AUTHORIZATION needs the superuser owner; the rollback undoes it.
SET SESSION AUTHORIZATION verdify_api_runtime_login;
DO $api$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.v_planner_performance)
        OR NOT EXISTS(SELECT 1 FROM public.fn_planner_scorecard((now() AT TIME ZONE 'America/Denver')::date - 1))
        OR NOT EXISTS(SELECT 1 FROM public.v_water_attribution_daily WHERE house_water_gal IS NOT NULL)
    THEN RAISE EXCEPTION '309 api login does not read the scorecard'; END IF;
END $api$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $ingestor$
BEGIN
    IF (SELECT count(*) FROM public.v_stress_hours_today) <> 1
        OR NOT EXISTS(SELECT 1 FROM public.v_daily_kpi)
        OR NOT EXISTS(SELECT 1 FROM public.v_water_attribution_daily WHERE planning_water_gal IS NOT NULL)
        OR NOT EXISTS(SELECT 1 FROM public.v_plan_window_scorecard)
    THEN RAISE EXCEPTION '309 ingestor login does not read its views'; END IF;
END $ingestor$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_mcp_runtime_login;
DO $mcp$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.mv_daily_kpi)
        OR NOT EXISTS(SELECT 1 FROM public.v_plan_window_scorecard)
        OR NOT EXISTS(SELECT 1 FROM public.daily_summary)
    THEN RAISE EXCEPTION '309 MCP login does not read the KPI'; END IF;
END $mcp$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_grafana_runtime_login;
DO $grafana$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM verdify_grafana_runtime.daily_summary)
        OR NOT EXISTS(SELECT 1 FROM verdify_grafana_runtime.v_planner_performance)
        OR NOT EXISTS(SELECT 1 FROM verdify_grafana_runtime.mv_daily_kpi)
    THEN RAISE EXCEPTION '309 Grafana login does not read its wrappers'; END IF;
END $grafana$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_lab_publisher_runtime_login;
DO $lab$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM verdify_lab_publisher_runtime.daily_summary)
    THEN RAISE EXCEPTION '309 lab-publisher login does not read its daily_summary wrapper'; END IF;
END $lab$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('retired_objects_and_columns_absent', 'planner_score_is_served_band_compliance',
                               'scorecard_contract_3_without_crop_band', 'planning_water_excludes_house_water',
                               'modelled_energy_reportable', 'served_band_readers_and_capture_v3',
                               'api_ingestor_mcp_grafana_lab_reads_kept'),
    'all_passed', true)::text;
