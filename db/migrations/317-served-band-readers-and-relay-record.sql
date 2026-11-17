-- 317 (#1633, host release 5; #1734): the database readers of the band read the served band, the relay run time has
-- one definition, the retired irrigation readbacks stop reading stale, and the relay counter check judges only a day
-- whose record was taken after it ended; the house VPD band is the served band; the daily record carries the climate
-- law's refused drying by reason; Grafana reads the daily review's status. Views and functions, one appended
-- daily_record column, one new Grafana facade; one unread view is dropped.
-- (a) Band readers (validation CTL-24, release 4 review C-7; RULINGS AF2, one band source: fn_band_setpoints):
--   fn_band_timeline: the crop, projected and fallback VPD edges come from fn_band_setpoints instead of
--     fn_house_vpd_control_band (the zone-informed house band, 0.32-0.87 kPa where the served band is 0.82-1.34 kPa at
--     2026-11-17 01:23Z; the temperature edges already came from fn_band_setpoints), and the threshold block is the
--     climate law's lines on the controller's band (verdify_schemas/climate_law.yaml) instead of the retired settings
--     read through fn_timeline_setpoint_value. Signature and all 56 columns unchanged (RULINGS C4); the retired
--     settings' columns read NULL. Readers: 12 site Grafana dashboards (projected_* and solar_w_m2 only, through the
--     verdify_grafana_runtime wrapper), v_heat_in_band_7d, the dashboard's graph overlay (its formula only).
--   fn_climate_action_effectiveness and fn_climate_action_daily_scorecard: the after-band and the recovery check read
--     fn_band_setpoints instead of the settings ledger (fn_setpoint_at, or its body inlined). Readers: the views
--     v_climate_action_effectiveness_5m/_15m and v_climate_action_daily_scorecard (no code reads them); MCP's day
--     report reads the scorecard function.
--   v_greenhouse_state: sp_temp_low/high and sp_vpd_low/high are the served band, the band flags and errors use it,
--     sp_temp_target/sp_vpd_target are the served targets (they were the edges' midpoint); the eight retired settings'
--     columns read NULL. Columns unchanged. Reader: scripts/export-replay-data.sh.
--   v_heating_staging: setpoint_temp_low is the served low edge at the furnace's start. Reader: v_heating_staging_summary.
--   Every reader above grades a past instant on today's served band curve evaluated at that time: the anchors keep
--   no history, so days before the law flash are not graded on the widened band the controller ran then.
--   fn_heat_staging_inversion: temp_low is the served low edge now (it read a 10-minute readback window that
--     on-change storage leaves empty); d_heat_stage_2 reads NULL. Reader: the ingestor's heat_staging_inversion alert.
--   v_setpoint_forward is dropped: it projected the retired plan settings (v_active_plan, setpoint_plan) and nothing
--     reads it (no code, panel, view, function or grant).
--   Kept as built: v_heat_in_band_7d (it reads fn_band_timeline's firmware band and the heater states only) and
--     v_plan_tactical_outcome_daily (history of past plans' tactical settings beside daily_summary; the public
--     v_forecast_plan_outcome_mart depends on it, and no plan has been active since 315).
--   fn_house_vpd_control_band (validation CTL-26): house_vpd_low/high and crop_vpd_low/high are fn_band_setpoints'
--     vpd_low/vpd_high (the zone-informed widening, low = max(crop low, lowest zone target - 0.20) held 0.55 kPa wide,
--     is retired); the zone targets and their min/median/max stay as information; house_vpd_min_width_kpa and
--     house_vpd_low_margin_kpa read NULL. Same signature and 13 columns, so every reader agrees at once, an old pod
--     during a rollout included: the dispatcher's pre-anchor vpd_low/vpd_high and its mister default gate, the API's
--     compatibility band, MCP's outcome_kpi fallback, fn_setpoint_at('vpd_low'/'vpd_high'), fn_band_trace,
--     fn_band_setpoint_provenance, fn_realized_solar_night_dryout (served_vpd_low), the planner's band_series,
--     v_band_device_divergence and the setpoint server's wrapper. A later release drops it once no code reads it.
-- (b) daily_summary.water_used_gal is the ingestor's writer (tasks/daily.py); nothing for it here.
-- (c) daily_relay_record: run_s is a relay's daily run time; event_run_s is a diagnostic (column comments).
-- (d) v_irrigation_schedule_current: the 18 irrig_* readbacks left the controller with the clocked schedule (the
--     irrigation engine's program replaced it, #1165; ingestor RETIRED_UNROUTABLE_PARAMS; newest rows 2026-11-03), so
--     stale_readback_count and readback_drift_count read NULL (not known) instead of 18 and 0. Every schedule value and
--     source is unchanged.
-- (e) v_relay_counter_reconciliation_daily: comparison reads 'record_early' while the day's relay record was computed
--     before the day ended, and two columns are appended: boots (controller boots on the day, from diagnostics uptime
--     falls) and record_computed_at. The tolerance itself is the ingestor's (relay_counter_mismatch).
-- (f) daily_record.dry_refusal (validation TEL-65): the climate law's wanted-but-refused drying time by reason, from
--     climate_law_state (l bit 6 drying wanted, dr the refusal), each record held until the next and at most 3
--     minutes; set when the day is complete, NULL for a day with no law record (every day before the law flash).
--     fn_daily_record_store writes it; the refresh job restores today and the two days before every run.
-- (g) verdify_grafana_runtime.planner_review: a security-barrier facade over public.planner_review (313) with id,
--     kind, review_date, status, requested_at and written_at only (no summary, band proposal, token counts, failure
--     text or run identifiers), SELECT to verdify_grafana_runtime alone. Readers: the four lab public-share panels
--     that keep their ids, site-intelligence 3 and 4 and site-evidence-operations 14 and 15 (Latest Review, Review
--     Age: kind = 'daily' AND status = 'written', review_date and written_at).
-- Seals: fn_heat_staging_inversion and fn_house_vpd_control_band are in the ordinary boundary digest, the ingestor
-- duty reads the schedule and counter views and daily_record (its columns are hashed), and MCP executes the scorecard
-- and house band functions, so the api, ingestor and MCP seals are measured again by
-- the rolled-back native qualification (tests/fixtures/317-served-band-readers-and-relay-record-native-qualification.json).
-- Until measured, the successor literals are 316's (fail closed). 317 chains from exact316.
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=316 AND filename='db/migrations/316-experiment-v2-and-shadow-drops.sql'
            AND sha256='8439a0e4d9c6cc2809a4a6f61b1a217e2e6ffba1320cad2f55c9582baf56924c'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>316)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '46285cc61b12abcb6e08a3898941a837f0c9c8701761408d8af901e30a291d76'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '74023040d4e1cec522dc7cc0b51348c0898e7006da193b4a3b96613eac49ad4f'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'd78c9a7e114bdece47f0a9f6768e3c3d869a1598dcfce38b1a668ef631551929'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        -- md5 of each replaced function's live body (prosrc): the text between its dollar quotes in the migration that
        -- last defined it (309, 142, 260, 079, 145, 310).
        OR (SELECT count(*) FROM pg_catalog.pg_proc p
             JOIN (VALUES
                 ('public.fn_band_timeline(timestamptz,timestamptz,interval,text)', 'fb2ec095203f71b99930770fed5060e2'),
                 ('public.fn_climate_action_effectiveness(interval)', '2aea42f8283fc90bc28be9431fdd1aec'),
                 ('public.fn_climate_action_daily_scorecard(date)', 'fbfc7aff058b7e86d337fad0d23b6b17'),
                 ('public.fn_heat_staging_inversion()', 'a6df226852d03b72e2c741f82fccca5a'),
                 ('public.fn_house_vpd_control_band(timestamptz)', '16642395e284f7dee234784a05b0000d'),
                 ('public.fn_daily_record_store(date)', 'c215189380c0a8a44645002112d879cf')
             ) AS want(fn, body_md5) ON p.oid=to_regprocedure(want.fn) AND md5(p.prosrc)=want.body_md5)<>6
        OR to_regprocedure('public.fn_band_setpoints(timestamptz)') IS NULL
        OR to_regprocedure('public.fn_zone_vpd_targets(timestamptz)') IS NULL
        OR to_regclass('public.daily_record') IS NULL
        -- (g) the review table's six read columns, and no facade yet.
        OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass('public.planner_review')
            AND attname IN ('id', 'kind', 'review_date', 'status', 'requested_at', 'written_at') AND NOT attisdropped)<>6
        OR to_regclass('verdify_grafana_runtime.planner_review') IS NOT NULL
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.daily_record'::regclass
            AND attname='dry_refusal' AND NOT attisdropped)
        OR to_regclass('public.v_greenhouse_state') IS NULL OR to_regclass('public.v_heating_staging') IS NULL
        OR to_regclass('public.v_irrigation_schedule_current') IS NULL
        -- 315's counter check, not yet extended.
        OR to_regclass('public.v_relay_counter_reconciliation_daily') IS NULL
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.v_relay_counter_reconciliation_daily'::regclass
            AND attname IN ('boots', 'record_computed_at') AND NOT attisdropped)
        OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid='public.daily_relay_record'::regclass
            AND attname IN ('run_s', 'event_run_s', 'repaired_runs', 'computed_at') AND NOT attisdropped)<>4
        -- v_setpoint_forward: present, read by no view and granted to no one but its owner.
        OR to_regclass('public.v_setpoint_forward') IS NULL
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_rewrite r ON r.oid=d.objid
            WHERE d.classid='pg_catalog.pg_rewrite'::regclass AND d.refobjid='public.v_setpoint_forward'::regclass
              AND r.ev_class<>'public.v_setpoint_forward'::regclass)
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
            WHERE c.oid='public.v_setpoint_forward'::regclass AND a.grantee<>c.relowner)
    THEN RAISE EXCEPTION '317 refuses an unqualified predecessor'; END IF;
END $predecessor$;

-- The table and view statements run first, each in a bounded retry (as 315 and 316): a reader of a view holds AccessShare, so
-- each statement waits at most 5 s per attempt, up to 8 attempts 1 s apart, and the file raises naming the view when
-- every attempt is lost (the band-curve refresh job writes daily_record for about 45 s at :02 and :32). lock_timeout is set inside each attempt and restored after it. EXECUTE, not LOCK TABLE: a
-- lock on a view also locks every relation it reads.
DO $views$
DECLARE
    saved text := pg_catalog.current_setting('lock_timeout');
    rec record;
    attempt integer;
BEGIN
    FOR rec IN SELECT * FROM (VALUES
-- (a) The live definition (141) with the served band in place of the settings ledger.
        ('public.v_greenhouse_state', $state$
CREATE OR REPLACE VIEW public.v_greenhouse_state AS
 WITH state_base AS (
         SELECT c.ts,
            c.temp_avg,
            c.vpd_avg,
            c.rh_avg,
            c.dew_point,
            c.temp_north,
            c.temp_south,
            c.temp_east,
            c.temp_west,
            c.vpd_south,
            c.vpd_west,
            c.vpd_east,
            c.lux,
            c.solar_irradiance_w_m2,
            c.dli_today,
            c.co2_ppm,
            c.abs_humidity,
            c.enthalpy_delta,
            c.outdoor_temp_f,
            c.outdoor_rh_pct,
            round(((c.temp_avg - COALESCE(c.dew_point, (c.temp_avg - (10)::double precision))))::numeric, 1) AS dp_margin_f,
            fn_equip_at('fan1'::text, c.ts) AS fan1,
            fn_equip_at('fan2'::text, c.ts) AS fan2,
            fn_equip_at('vent'::text, c.ts) AS vent,
            fn_equip_at('fog'::text, c.ts) AS fog,
            fn_equip_at('heat1'::text, c.ts) AS heat1,
            fn_equip_at('heat2'::text, c.ts) AS heat2,
            fn_equip_at('mister_south'::text, c.ts) AS mist_south,
            fn_equip_at('mister_west'::text, c.ts) AS mist_west,
            fn_equip_at('mister_center'::text, c.ts) AS mist_center,
            b.temp_high AS sp_temp_high,
            b.temp_low AS sp_temp_low,
            b.vpd_high AS sp_vpd_high,
            b.vpd_low AS sp_vpd_low,
            NULL::double precision AS sp_bias_cool,
            NULL::double precision AS sp_bias_heat,
            NULL::double precision AS sp_vpd_hysteresis,
            NULL::double precision AS sp_sealed_max_s,
            NULL::double precision AS sp_relief_s,
            NULL::double precision AS sp_watch_dwell_s,
            NULL::double precision AS sp_d_cool_s2,
            NULL::double precision AS sp_mister_engage,
            COALESCE(c.temp_avg >= b.temp_low AND c.temp_avg <= b.temp_high, false) AS temp_in_band,
            COALESCE(c.vpd_avg >= b.vpd_low AND c.vpd_avg <= b.vpd_high, false) AS vpd_in_band,
            ( SELECT system_state.value
                   FROM system_state
                  WHERE ((system_state.entity = 'greenhouse_state'::text) AND (system_state.ts <= c.ts))
                  ORDER BY system_state.ts DESC
                 LIMIT 1) AS greenhouse_mode,
            b.temp_target AS band_temp_target,
            b.vpd_target AS band_vpd_target
           FROM climate c
             CROSS JOIN LATERAL fn_band_setpoints(c.ts) b(temp_low, temp_high, vpd_low, vpd_high, temp_target, vpd_target)
          WHERE ((c.temp_avg IS NOT NULL) AND (c.ts >= (now() - '14 days'::interval)))
        )
 SELECT ts,
    temp_avg,
    vpd_avg,
    rh_avg,
    dew_point,
    temp_north,
    temp_south,
    temp_east,
    temp_west,
    vpd_south,
    vpd_west,
    vpd_east,
    lux,
    solar_irradiance_w_m2,
    dli_today,
    co2_ppm,
    abs_humidity,
    enthalpy_delta,
    outdoor_temp_f,
    outdoor_rh_pct,
    dp_margin_f,
    fan1,
    fan2,
    vent,
    fog,
    heat1,
    heat2,
    mist_south,
    mist_west,
    mist_center,
    sp_temp_high,
    sp_temp_low,
    sp_vpd_high,
    sp_vpd_low,
    sp_bias_cool,
    sp_bias_heat,
    sp_vpd_hysteresis,
    sp_sealed_max_s,
    sp_relief_s,
    sp_watch_dwell_s,
    sp_d_cool_s2,
    sp_mister_engage,
    temp_in_band,
    vpd_in_band,
    greenhouse_mode,
    round((band_temp_target)::numeric, 2) AS sp_temp_target,
    round((band_vpd_target)::numeric, 3) AS sp_vpd_target,
    round(((temp_avg - band_temp_target))::numeric, 2) AS temp_target_delta_f,
    round(((vpd_avg - band_vpd_target))::numeric, 3) AS vpd_target_delta_kpa,
    round((
        CASE
            WHEN (temp_avg < sp_temp_low) THEN (temp_avg - sp_temp_low)
            WHEN (temp_avg > sp_temp_high) THEN (temp_avg - sp_temp_high)
            ELSE (0.0)::double precision
        END)::numeric, 2) AS temp_band_error_f,
    round((
        CASE
            WHEN (vpd_avg < sp_vpd_low) THEN (vpd_avg - sp_vpd_low)
            WHEN (vpd_avg > sp_vpd_high) THEN (vpd_avg - sp_vpd_high)
            ELSE (0.0)::double precision
        END)::numeric, 3) AS vpd_band_error_kpa
   FROM state_base
$state$),
-- (a) The live definition (079) with the served low edge.
        ('public.v_heating_staging', $staging$
CREATE OR REPLACE VIEW public.v_heating_staging AS
 WITH heat_events AS (
         SELECT equipment_state.ts,
            equipment_state.equipment,
            equipment_state.state,
            lead(equipment_state.ts) OVER (PARTITION BY equipment_state.equipment ORDER BY equipment_state.ts) AS next_ts
           FROM equipment_state
          WHERE (equipment_state.equipment = ANY (ARRAY['heat1'::text, 'heat2'::text]))
        ), heat2_on AS (
         SELECT heat_events.ts AS on_ts,
            COALESCE(heat_events.next_ts, now()) AS off_ts
           FROM heat_events
          WHERE ((heat_events.equipment = 'heat2'::text) AND (heat_events.state = true))
        )
 SELECT (on_ts AT TIME ZONE 'America/Denver'::text) AS heat2_on_mdt,
    (off_ts AT TIME ZONE 'America/Denver'::text) AS heat2_off_mdt,
    round((EXTRACT(epoch FROM (off_ts - on_ts)) / (60)::numeric), 1) AS duration_min,
    ( SELECT equipment_state.state
           FROM equipment_state
          WHERE ((equipment_state.equipment = 'heat1'::text) AND (equipment_state.ts <= h2.on_ts))
          ORDER BY equipment_state.ts DESC
         LIMIT 1) AS heat1_was_on,
    ( SELECT round((climate.temp_avg)::numeric, 1) AS round
           FROM climate
          WHERE ((climate.ts <= h2.on_ts) AND (climate.temp_avg IS NOT NULL))
          ORDER BY climate.ts DESC
         LIMIT 1) AS temp_at_engage,
    ( SELECT b.temp_low
           FROM fn_band_setpoints(h2.on_ts) b(temp_low, temp_high, vpd_low, vpd_high, temp_target, vpd_target)) AS setpoint_temp_low
   FROM heat2_on h2
  ORDER BY on_ts DESC
$staging$),
-- (d) 315's definition with the two readback counts NULL; every value and source expression is unchanged.
        ('public.v_irrigation_schedule_current', $schedule$
CREATE OR REPLACE VIEW public.v_irrigation_schedule_current AS
 WITH param_defaults(parameter, default_value) AS (
         VALUES ('irrig_wall_start_hour'::text,10.0), ('irrig_wall_start_min'::text,30.0), ('irrig_wall_duration_min'::text,10.0), ('irrig_wall_fert_duration_min'::text,6.0), ('irrig_wall_fert_every_n'::text,0.0), ('irrig_wall_days_mask'::text,127.0), ('irrig_wall_fert_days_mask'::text,127.0), ('irrig_wall_flush_min'::text,2.0), ('irrig_wall_interval_days'::text,1.0), ('irrig_center_start_hour'::text,10.0), ('irrig_center_start_min'::text,30.0), ('irrig_center_duration_min'::text,10.0), ('irrig_center_fert_duration_min'::text,6.0), ('irrig_center_fert_every_n'::text,0.0), ('irrig_center_days_mask'::text,127.0), ('irrig_center_fert_days_mask'::text,127.0), ('irrig_center_flush_min'::text,2.0), ('irrig_center_interval_days'::text,1.0)
        ), latest_snapshot AS (
         SELECT DISTINCT ON (setpoint_snapshot.parameter) setpoint_snapshot.parameter,
            setpoint_snapshot.value,
            setpoint_snapshot.ts
           FROM setpoint_snapshot
          WHERE (setpoint_snapshot.parameter IN ( SELECT param_defaults.parameter
                   FROM param_defaults))
          ORDER BY setpoint_snapshot.parameter, setpoint_snapshot.ts DESC
        ), latest_esp32 AS (
         SELECT DISTINCT ON (setpoint_changes.parameter) setpoint_changes.parameter,
            setpoint_changes.value,
            setpoint_changes.ts
           FROM setpoint_changes
          WHERE setpoint_changes.source = 'esp32'::text AND (setpoint_changes.parameter IN ( SELECT param_defaults.parameter
                   FROM param_defaults))
          ORDER BY setpoint_changes.parameter, setpoint_changes.ts DESC
        ), values_by_param AS (
         SELECT d.parameter,
            COALESCE(ap.value, e.value, s.value, d.default_value::double precision) AS value,
                CASE
                    WHEN ap.value IS NOT NULL THEN 'active_plan'::text
                    WHEN e.value IS NOT NULL THEN 'esp32_observed'::text
                    WHEN s.value IS NOT NULL THEN 'cfg_readback'::text
                    ELSE 'default'::text
                END AS source,
            ap.plan_id,
            ap.ts AS plan_ts,
            e.ts AS esp32_ts,
            s.ts AS readback_ts,
            s.value AS readback_value,
            d.default_value
           FROM param_defaults d
             LEFT JOIN v_active_plan ap ON ap.parameter = d.parameter
             LEFT JOIN latest_esp32 e ON e.parameter = d.parameter
             LEFT JOIN latest_snapshot s ON s.parameter = d.parameter
        ), pivoted AS (
         SELECT max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_start_hour'::text) AS wall_start_hour,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_start_min'::text) AS wall_start_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_duration_min'::text) AS wall_duration_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_fert_duration_min'::text) AS wall_fert_duration_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_fert_every_n'::text) AS wall_fert_every_n,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_days_mask'::text) AS wall_days_mask,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_fert_days_mask'::text) AS wall_fert_days_mask,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_flush_min'::text) AS wall_flush_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_wall_interval_days'::text) AS wall_interval_days,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_start_hour'::text) AS center_start_hour,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_start_min'::text) AS center_start_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_duration_min'::text) AS center_duration_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_fert_duration_min'::text) AS center_fert_duration_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_fert_every_n'::text) AS center_fert_every_n,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_days_mask'::text) AS center_days_mask,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_fert_days_mask'::text) AS center_fert_days_mask,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_flush_min'::text) AS center_flush_min,
            max(values_by_param.value) FILTER (WHERE values_by_param.parameter = 'irrig_center_interval_days'::text) AS center_interval_days
           FROM values_by_param
        ), source_rollup AS (
         SELECT
                CASE
                    WHEN count(*) FILTER (WHERE values_by_param.source = 'active_plan'::text) > 0 THEN 'active_plan'::text
                    WHEN count(*) FILTER (WHERE values_by_param.source = 'esp32_observed'::text) > 0 THEN 'esp32_observed'::text
                    WHEN count(*) FILTER (WHERE values_by_param.source = 'cfg_readback'::text) > 0 THEN 'cfg_readback'::text
                    ELSE 'default'::text
                END AS schedule_source,
            max(values_by_param.plan_id) FILTER (WHERE values_by_param.plan_id IS NOT NULL) AS plan_id,
            max(values_by_param.plan_ts) AS plan_ts,
            NULL::bigint AS stale_readback_count,
            NULL::bigint AS readback_drift_count
           FROM values_by_param
        ), latest_equipment AS (
         SELECT DISTINCT ON (equipment_state.equipment) equipment_state.equipment,
            equipment_state.state,
            equipment_state.ts
           FROM equipment_state
          WHERE equipment_state.equipment = ANY (ARRAY['irrigation_enabled'::text, 'irrigation_wall_enabled'::text, 'irrigation_center_enabled'::text])
          ORDER BY equipment_state.equipment, equipment_state.ts DESC
        )
 SELECT 'wall_shared'::text AS schedule_id,
    'wall_shared'::text AS zone_path,
    'Wall shared drip + south/west misters'::text AS display_name,
    ARRAY['south'::text, 'west'::text] AS serves_zones,
    COALESCE(( SELECT latest_equipment.state
           FROM latest_equipment
          WHERE latest_equipment.equipment = 'irrigation_enabled'::text), true) AND COALESCE(( SELECT latest_equipment.state
           FROM latest_equipment
          WHERE latest_equipment.equipment = 'irrigation_wall_enabled'::text), true) AS enabled,
    make_time(GREATEST(0, LEAST(23, round(p.wall_start_hour)::integer)), GREATEST(0, LEAST(59, round(p.wall_start_min)::integer)), 0::double precision) AS start_time,
    round(p.wall_duration_min)::integer AS clean_duration_min,
    round(p.wall_fert_duration_min)::integer AS fert_duration_min,
    round(p.wall_flush_min)::integer AS flush_min,
    round(p.wall_interval_days)::integer AS interval_days,
    round(p.wall_days_mask)::integer AS days_mask,
    round(p.wall_fert_days_mask)::integer AS fert_days_mask,
    round(p.wall_fert_every_n)::integer AS fert_every_n,
    round(p.wall_fert_duration_min)::integer > 0 AND (round(p.wall_fert_days_mask)::integer <> 0 OR round(p.wall_fert_every_n)::integer > 0) AS fertigation_enabled,
    ARRAY['drip_wall_fert'::text, 'mister_south_fert'::text, 'mister_west_fert'::text] AS fert_relays,
    ARRAY['drip_wall'::text, 'mister_south'::text, 'mister_west'::text] AS flush_relays,
    s.schedule_source,
    s.plan_id,
    s.plan_ts,
    s.stale_readback_count,
    s.readback_drift_count,
    'One wall drip path serves south and west; firmware queues wall drip, south mister, and west mister fert jobs from this schedule.'::text AS notes
   FROM pivoted p
     CROSS JOIN source_rollup s
UNION ALL
 SELECT 'center'::text AS schedule_id,
    'center'::text AS zone_path,
    'Center drip'::text AS display_name,
    ARRAY['center'::text] AS serves_zones,
    COALESCE(( SELECT latest_equipment.state
           FROM latest_equipment
          WHERE latest_equipment.equipment = 'irrigation_enabled'::text), true) AND COALESCE(( SELECT latest_equipment.state
           FROM latest_equipment
          WHERE latest_equipment.equipment = 'irrigation_center_enabled'::text), true) AS enabled,
    make_time(GREATEST(0, LEAST(23, round(p.center_start_hour)::integer)), GREATEST(0, LEAST(59, round(p.center_start_min)::integer)), 0::double precision) AS start_time,
    round(p.center_duration_min)::integer AS clean_duration_min,
    round(p.center_fert_duration_min)::integer AS fert_duration_min,
    round(p.center_flush_min)::integer AS flush_min,
    round(p.center_interval_days)::integer AS interval_days,
    round(p.center_days_mask)::integer AS days_mask,
    round(p.center_fert_days_mask)::integer AS fert_days_mask,
    round(p.center_fert_every_n)::integer AS fert_every_n,
    round(p.center_fert_duration_min)::integer > 0 AND (round(p.center_fert_days_mask)::integer <> 0 OR round(p.center_fert_every_n)::integer > 0) AS fertigation_enabled,
    ARRAY['drip_center_fert'::text] AS fert_relays,
    ARRAY['drip_center'::text] AS flush_relays,
    s.schedule_source,
    s.plan_id,
    s.plan_ts,
    s.stale_readback_count,
    s.readback_drift_count,
    'Center drip/fert path; center root-zone and runoff feedback remain pending physical instrumentation.'::text AS notes
   FROM pivoted p
     CROSS JOIN source_rollup s
$schedule$),
-- (e) 315's definition with the early-record rule and two appended columns.
        ('public.v_relay_counter_reconciliation_daily', $recon$
CREATE OR REPLACE VIEW public.v_relay_counter_reconciliation_daily AS
WITH relays(equipment, starts_key, run_key) AS (
    VALUES ('heat1'::text, 'h1'::text, NULL::text), ('heat2', 'h2', NULL), ('fan1', 'f1', 'f1s'),
           ('fan2', 'f2', 'f2s'), ('fog', 'fg', NULL), ('vent', 'vt', NULL)
), samples AS (
    SELECT s.ts, COALESCE(s.greenhouse_id, 'vallery') AS greenhouse_id, s.value::jsonb AS v
      FROM public.system_state s
     WHERE s.entity = 'relay_counters' AND s.ts >= TIMESTAMPTZ '2026-11-16 19:48:00+00'
), steps AS (
    SELECT (sm.ts AT TIME ZONE 'America/Denver')::date AS date, sm.greenhouse_id, r.equipment,
           GREATEST((sm.v ->> r.starts_key)::bigint
                    - COALESCE(lag((sm.v ->> r.starts_key)::bigint) OVER w, 0), 0) AS starts,
           CASE WHEN r.run_key IS NOT NULL THEN
                GREATEST((sm.v ->> r.run_key)::bigint - COALESCE(lag((sm.v ->> r.run_key)::bigint) OVER w, 0), 0)
           END AS run_s
      FROM samples sm
     CROSS JOIN relays r
    WINDOW w AS (PARTITION BY sm.greenhouse_id, r.equipment ORDER BY sm.ts)
), counted AS (
    SELECT date, greenhouse_id, equipment, sum(starts)::bigint AS starts, sum(run_s)::bigint AS run_s,
           count(*)::integer AS n_rows
      FROM steps
     GROUP BY date, greenhouse_id, equipment
), uptime AS (
    -- A controller boot is a diagnostics row whose uptime is more than 60 s short of the previous row's uptime plus
    -- the time between the rows (317; the test of the ingestor's restarted_between), so a boot during a gap counts.
    -- The hour before the window start only seeds lag(); a boot lands on the local day of the first row after it.
    SELECT d.ts, COALESCE(d.greenhouse_id, 'vallery') AS greenhouse_id, d.uptime_s,
           lag(d.uptime_s) OVER (PARTITION BY COALESCE(d.greenhouse_id, 'vallery') ORDER BY d.ts) AS previous_uptime_s,
           lag(d.ts) OVER (PARTITION BY COALESCE(d.greenhouse_id, 'vallery') ORDER BY d.ts) AS previous_ts
      FROM public.diagnostics d
     WHERE d.ts >= TIMESTAMPTZ '2026-11-16 18:48:00+00' AND d.uptime_s IS NOT NULL
), booted AS (
    SELECT (u.ts AT TIME ZONE 'America/Denver')::date AS date, u.greenhouse_id, count(*)::integer AS boots
      FROM uptime u
     WHERE u.ts >= TIMESTAMPTZ '2026-11-16 19:48:00+00'
       AND u.uptime_s < u.previous_uptime_s + extract(epoch FROM u.ts - u.previous_ts) - 60
     GROUP BY 1, 2
), frame AS (
    SELECT d.d::date AS date, g.greenhouse_id, r.equipment, r.run_key IS NOT NULL AS has_run_counter,
           (now() AT TIME ZONE 'America/Denver')::date AS today
      FROM generate_series(DATE '2026-11-16', (now() AT TIME ZONE 'America/Denver')::date, interval '1 day') AS d(d)
     CROSS JOIN (SELECT id AS greenhouse_id FROM public.greenhouses UNION SELECT 'vallery') AS g
     CROSS JOIN relays r
)
SELECT f.date,
       f.greenhouse_id,
       f.equipment,
       COALESCE(c.starts, 0) AS counter_starts,
       rr.starts AS record_starts,
       COALESCE(c.starts, 0) - rr.starts AS starts_difference,
       CASE WHEN f.has_run_counter THEN COALESCE(c.run_s, 0) END AS counter_run_s,
       rr.run_s AS record_run_s,
       CASE WHEN f.has_run_counter THEN COALESCE(c.run_s, 0) - rr.run_s END AS run_s_difference,
       COALESCE(c.n_rows, 0) AS counter_rows,
       CASE WHEN f.date = DATE '2026-11-16' OR f.date >= f.today THEN 'partial'
            WHEN rr.date IS NULL THEN 'no_record'
            WHEN rr.computed_at < ((f.date + 1)::timestamp AT TIME ZONE 'America/Denver') THEN 'record_early'
            ELSE 'complete' END AS comparison,
       COALESCE(b.boots, 0) AS boots,
       rr.computed_at AS record_computed_at
  FROM frame f
  LEFT JOIN counted c ON c.date = f.date AND c.greenhouse_id = f.greenhouse_id AND c.equipment = f.equipment
  LEFT JOIN public.daily_relay_record rr
    ON rr.date = f.date AND rr.greenhouse_id = f.greenhouse_id AND rr.equipment = f.equipment
  LEFT JOIN booted b ON b.date = f.date AND b.greenhouse_id = f.greenhouse_id
$recon$),
-- (a) Unread: the retired plan settings' projection.
        ('public.v_setpoint_forward', $forward$
DROP VIEW public.v_setpoint_forward RESTRICT
$forward$),
-- (f) The refused-drying record, appended (no reader selects by position: v_daily_record names its columns). Last,
-- so the table's exclusive lock is held only from here to the commit, not through the views' retries; nothing above
-- reads the new column.
        ('public.daily_record', $record$
ALTER TABLE public.daily_record ADD COLUMN dry_refusal jsonb
$record$)
    ) AS v(target, ddl) LOOP
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
                    RAISE EXCEPTION '317 could not lock % exclusively in 8 attempts of 5 s', rec.target
                        USING ERRCODE = 'lock_not_available';
                END IF;
                PERFORM pg_catalog.pg_sleep(1);
            END;
        END LOOP;
    END LOOP;
    IF pg_catalog.current_setting('lock_timeout') IS DISTINCT FROM saved THEN
        RAISE EXCEPTION '317 left lock_timeout changed';
    END IF;
END $views$;

COMMENT ON VIEW public.v_greenhouse_state IS
    'Rolling 14-day climate, relay and band state per climate row. The band columns (sp_temp_low/high, sp_vpd_low/high, '
    'sp_temp_target, sp_vpd_target, the in-band flags and band errors) are the served band, fn_band_setpoints (317, '
    'RULINGS AF2); the retired settings'' columns (sp_bias_*, sp_vpd_hysteresis, sp_sealed_max_s, sp_relief_s, '
    'sp_watch_dwell_s, sp_d_cool_s2, sp_mister_engage) read NULL.';

COMMENT ON VIEW public.v_heating_staging IS
    'Each furnace (heat2) run with the electric heater''s state and the temperature at its start, and the served '
    'band''s low edge then (fn_band_setpoints; 317).';

COMMENT ON VIEW public.v_irrigation_schedule_current IS
    'The retired clocked irrigation schedule as last known (v_active_plan, then ESP32 observed number states, then '
    'cfg_* readbacks, then firmware defaults). The irrigation engine''s program replaced it (#1165) and the irrig_* '
    'readbacks are no longer published, so stale_readback_count and readback_drift_count read NULL (317).';

COMMENT ON VIEW public.v_relay_counter_reconciliation_daily IS
    'Relay counters against the daily relay record (315, #1633, RULINGS AF7): per local day, greenhouse and relay, '
    'the starts (fans: and run seconds) summed from relay_counters deltas, a negative delta counted as 0, beside '
    'daily_relay_record''s figures from the stored edges, and their difference. A check only; the events are the '
    'source. Valid from the phase 2 flash, 2026-11-16 19:48Z: that day and today read partial; no_record = no '
    'daily_relay_record row; record_early = the record was computed before the day ended (317). boots: controller '
    'boots on the day (a diagnostics uptime below the row before; 317); a boot loses the counter increments between '
    'the restart and its first published row. record_computed_at: when the record row was computed.';

-- (a) Functions: CREATE OR REPLACE keeps their owners and ACLs; each signature and return type is unchanged.
CREATE OR REPLACE FUNCTION public.fn_band_timeline(p_start timestamp with time zone, p_end timestamp with time zone, p_step interval DEFAULT '00:30:00'::interval, p_greenhouse_id text DEFAULT 'vallery'::text)
 RETURNS TABLE(ts timestamp with time zone, greenhouse_id text, timeline_phase text, crop_temp_low double precision, crop_temp_high double precision, crop_vpd_low double precision, crop_vpd_high double precision, projected_temp_low double precision, projected_temp_high double precision, projected_vpd_low double precision, projected_vpd_high double precision, actual_temp_low double precision, actual_temp_high double precision, actual_vpd_low double precision, actual_vpd_high double precision, firmware_temp_low double precision, firmware_temp_high double precision, firmware_vpd_low double precision, firmware_vpd_high double precision, temp_width_f double precision, vpd_width_kpa double precision, sw_fsm_controller_enabled boolean, indoor_temp_f double precision, indoor_vpd_kpa double precision, outdoor_temp_f double precision, outdoor_vpd_kpa double precision, solar_w_m2 double precision, outdoor_cold_for_vent boolean, temp_hysteresis_f double precision, heat_hysteresis_f double precision, d_heat_stage_2_f double precision, d_cool_stage_2_f double precision, bias_heat_f double precision, bias_cool_f double precision, vpd_hysteresis_kpa double precision, vpd_hysteresis_effective_kpa double precision, fog_escalation_kpa double precision, temp_heat_target_f double precision, temp_heat_on_below_f double precision, temp_heat2_on_below_f double precision, temp_heat2_clear_f double precision, temp_cool_on_above_f double precision, temp_cool_hold_until_f double precision, temp_cooling_entry_margin_f double precision, temp_cooling_exit_hysteresis_f double precision, solar_cooling_lead_f double precision, temp_cool_stage2_delta_f double precision, temp_cool_stage2_on_above_f double precision, vpd_humidify_on_above_kpa double precision, vpd_humidify_resolved_below_kpa double precision, vpd_dehum_on_below_kpa double precision, vpd_dehum_resolved_above_kpa double precision, vpd_low_eff_kpa double precision, vpd_high_eff_kpa double precision, vpd_vent_fog_on_above_kpa double precision, vpd_sealed_fog_on_above_kpa double precision)
 LANGUAGE sql
 STABLE ROWS 10000
AS $function$
WITH timeline AS (
    SELECT generate_series(p_start, p_end, p_step) AS ts
),
-- The climate law's offsets (verdify_schemas/climate_law.yaml, CONSTANTS_SHA256 4250fb1d...; names as there). The
-- firmware compiles the same numbers; a change of the law is a firmware release and a new definition here.
law AS (
    SELECT 3.5::double precision AS heat1_on_above_low_f,
           4.5::double precision AS heat1_off_above_low_f,
           0.5::double precision AS heat2_on_above_low_f,
           3.0::double precision AS heat2_off_above_low_f,
           0.0::double precision AS cool_on_above_high_f,
           2.0::double precision AS cool_off_below_high_f,
           1.5::double precision AS fan2_on_above_high_f,
           0.0::double precision AS fog_on_above_vpd_high_kpa,
           0.15::double precision AS fog_off_below_vpd_high_kpa,
           0.05::double precision AS dry_on_above_vpd_low_kpa,
           0.20::double precision AS dry_off_above_vpd_low_kpa
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
    band.temp_low AS crop_temp_low,
    band.temp_high AS crop_temp_high,
    band.vpd_low AS crop_vpd_low,
    band.vpd_high AS crop_vpd_high,
    band.temp_low AS projected_temp_low,
    band.temp_high AS projected_temp_high,
    band.vpd_low AS projected_vpd_low,
    band.vpd_high AS projected_vpd_high,
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
        WHEN t.ts <= now() THEN COALESCE(actual_temp_low.value, band.temp_low)
        ELSE band.temp_low
    END AS firmware_temp_low,
    CASE
        WHEN t.ts <= now() THEN COALESCE(actual_temp_high.value, band.temp_high)
        ELSE band.temp_high
    END AS firmware_temp_high,
    CASE
        WHEN t.ts <= now() THEN COALESCE(actual_vpd_low.value, band.vpd_low)
        ELSE band.vpd_low
    END AS firmware_vpd_low,
    CASE
        WHEN t.ts <= now() THEN COALESCE(actual_vpd_high.value, band.vpd_high)
        ELSE band.vpd_high
    END AS firmware_vpd_high
FROM timeline t
CROSS JOIN LATERAL fn_band_setpoints(t.ts) AS band
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
)
-- The thresholds are the law's lines on the band the controller holds (firmware_*). The retired settings
-- (sw_fsm_controller_enabled, the hysteresis, stage-2, bias and fog-escalation settings) and the old controller's
-- outdoor-cold and solar-lead adjustments have no source under the law: NULL.
SELECT
    r.ts,
    r.greenhouse_id,
    r.timeline_phase,
    r.crop_temp_low,
    r.crop_temp_high,
    r.crop_vpd_low,
    r.crop_vpd_high,
    r.projected_temp_low,
    r.projected_temp_high,
    r.projected_vpd_low,
    r.projected_vpd_high,
    r.actual_temp_low,
    r.actual_temp_high,
    r.actual_vpd_low,
    r.actual_vpd_high,
    r.firmware_temp_low,
    r.firmware_temp_high,
    r.firmware_vpd_low,
    r.firmware_vpd_high,
    r.firmware_temp_high - r.firmware_temp_low AS temp_width_f,
    r.firmware_vpd_high - r.firmware_vpd_low AS vpd_width_kpa,
    NULL::boolean AS sw_fsm_controller_enabled,
    r.indoor_temp_f,
    r.indoor_vpd_kpa,
    r.outdoor_temp_f,
    r.outdoor_vpd_kpa,
    r.solar_w_m2,
    NULL::boolean AS outdoor_cold_for_vent,
    NULL::double precision AS temp_hysteresis_f,
    NULL::double precision AS heat_hysteresis_f,
    NULL::double precision AS d_heat_stage_2_f,
    NULL::double precision AS d_cool_stage_2_f,
    NULL::double precision AS bias_heat_f,
    NULL::double precision AS bias_cool_f,
    NULL::double precision AS vpd_hysteresis_kpa,
    law.fog_off_below_vpd_high_kpa AS vpd_hysteresis_effective_kpa,
    NULL::double precision AS fog_escalation_kpa,
    r.firmware_temp_low + law.heat1_off_above_low_f AS temp_heat_target_f,
    r.firmware_temp_low + law.heat1_on_above_low_f AS temp_heat_on_below_f,
    r.firmware_temp_low + law.heat2_on_above_low_f AS temp_heat2_on_below_f,
    r.firmware_temp_low + law.heat2_off_above_low_f AS temp_heat2_clear_f,
    r.firmware_temp_high + law.cool_on_above_high_f AS temp_cool_on_above_f,
    r.firmware_temp_high - law.cool_off_below_high_f AS temp_cool_hold_until_f,
    law.cool_on_above_high_f AS temp_cooling_entry_margin_f,
    law.cool_off_below_high_f AS temp_cooling_exit_hysteresis_f,
    NULL::double precision AS solar_cooling_lead_f,
    law.fan2_on_above_high_f AS temp_cool_stage2_delta_f,
    r.firmware_temp_high + law.fan2_on_above_high_f AS temp_cool_stage2_on_above_f,
    r.firmware_vpd_high + law.fog_on_above_vpd_high_kpa AS vpd_humidify_on_above_kpa,
    r.firmware_vpd_high - law.fog_off_below_vpd_high_kpa AS vpd_humidify_resolved_below_kpa,
    r.firmware_vpd_low + law.dry_on_above_vpd_low_kpa AS vpd_dehum_on_below_kpa,
    r.firmware_vpd_low + law.dry_off_above_vpd_low_kpa AS vpd_dehum_resolved_above_kpa,
    r.firmware_vpd_low AS vpd_low_eff_kpa,
    r.firmware_vpd_high AS vpd_high_eff_kpa,
    r.firmware_vpd_high + law.fog_on_above_vpd_high_kpa AS vpd_vent_fog_on_above_kpa,
    r.firmware_vpd_high + law.fog_on_above_vpd_high_kpa AS vpd_sealed_fog_on_above_kpa
FROM resolved r
CROSS JOIN law
ORDER BY r.ts;
$function$;
COMMENT ON FUNCTION public.fn_band_timeline(timestamptz, timestamptz, interval, text) IS
    'The band timeline (actual and forecast) on a fixed step: crop and projected edges from the served band '
    '(fn_band_setpoints, RULINGS AF2), actual edges from the controller''s band readbacks, firmware edges the actual '
    'ones with the served band as fallback, and the climate law''s lines on the firmware edges '
    '(verdify_schemas/climate_law.yaml). The retired settings'' columns read NULL; all 56 columns kept (RULINGS C4; 317).';

CREATE OR REPLACE FUNCTION public.fn_climate_action_effectiveness(p_window interval)
 RETURNS TABLE(action_ts timestamp with time zone, greenhouse_id text, climate_action text, priority_axis text, plan_id text, trigger_id uuid, planner_instance text, temp_band_error_before_f double precision, vpd_band_error_before_kpa double precision, temp_band_error_after_f double precision, vpd_band_error_after_kpa double precision, temp_abs_error_delta_f double precision, vpd_abs_error_delta_kpa double precision, recovered_within_window boolean, time_to_recover_s double precision, wet_relay_duty_pct double precision, vent_fan_duty_pct double precision, fog_duty_pct double precision, mister_water_delta_gal double precision, outdoor_temp_f double precision, outdoor_dewpoint_f double precision, solar_irradiance_w_m2 double precision, wet_assist_allowed boolean, wet_assist_block_reason text, fog_allowed boolean, fog_block_reason text, relay_truth jsonb, resource_cost_estimate jsonb)
 LANGUAGE sql
 STABLE
AS $function$
WITH base AS (
    SELECT
        l.*,
        c0.ts AS before_climate_ts,
        c0.temp_avg AS before_temp_f,
        c0.vpd_avg AS before_vpd_kpa,
        c0.mister_water_today AS before_mister_water_gal,
        c0.outdoor_temp_f,
        c0.outdoor_rh_pct,
        c0.dew_point AS before_dew_point_f,
        c0.solar_irradiance_w_m2,
        c1.ts AS after_climate_ts,
        c1.temp_avg AS after_temp_f,
        c1.vpd_avg AS after_vpd_kpa,
        c1.mister_water_today AS after_mister_water_gal,
        ab.temp_low AS after_temp_low,
        ab.temp_high AS after_temp_high,
        ab.vpd_low AS after_vpd_low,
        ab.vpd_high AS after_vpd_high
    FROM public.climate_action_log l
    LEFT JOIN LATERAL (
        SELECT c.*
        FROM public.climate c
        WHERE COALESCE(c.greenhouse_id, 'vallery') = COALESCE(l.greenhouse_id, 'vallery')
          AND c.temp_avg IS NOT NULL
          AND c.vpd_avg IS NOT NULL
          AND c.ts <= l.ts
        ORDER BY c.ts DESC
        LIMIT 1
    ) c0 ON true
    LEFT JOIN LATERAL (
        SELECT c.*
        FROM public.climate c
        WHERE COALESCE(c.greenhouse_id, 'vallery') = COALESCE(l.greenhouse_id, 'vallery')
          AND c.temp_avg IS NOT NULL
          AND c.vpd_avg IS NOT NULL
          AND c.ts >= l.ts + p_window
          AND c.ts <= l.ts + p_window + interval '3 minutes'
        ORDER BY c.ts ASC
        LIMIT 1
    ) c1 ON true
    -- The served band (fn_band_setpoints, RULINGS AF2) at the after-sample (317). The anchors keep no history: a past
    -- instant is graded on today's served band curve evaluated at that time, not the band the controller ran then.
    LEFT JOIN LATERAL fn_band_setpoints(COALESCE(c1.ts, l.ts)) ab ON true
    WHERE l.ts >= now() - interval '14 days'
),
scored AS (
    SELECT
        b.*,
        CASE
            WHEN b.after_temp_f IS NULL OR b.after_temp_low IS NULL OR b.after_temp_high IS NULL THEN NULL
            WHEN b.after_temp_f < b.after_temp_low THEN b.after_temp_f - b.after_temp_low
            WHEN b.after_temp_f > b.after_temp_high THEN b.after_temp_f - b.after_temp_high
            ELSE 0.0
        END AS after_temp_band_error,
        CASE
            WHEN b.after_vpd_kpa IS NULL OR b.after_vpd_low IS NULL OR b.after_vpd_high IS NULL THEN NULL
            WHEN b.after_vpd_kpa < b.after_vpd_low THEN b.after_vpd_kpa - b.after_vpd_low
            WHEN b.after_vpd_kpa > b.after_vpd_high THEN b.after_vpd_kpa - b.after_vpd_high
            ELSE 0.0
        END AS after_vpd_band_error
    FROM base b
)
SELECT
    s.ts AS action_ts,
    s.greenhouse_id,
    s.climate_action,
    s.priority_axis,
    s.plan_id,
    s.trigger_id,
    s.planner_instance,
    s.temp_band_error_f AS temp_band_error_before_f,
    s.vpd_band_error_kpa AS vpd_band_error_before_kpa,
    s.after_temp_band_error AS temp_band_error_after_f,
    s.after_vpd_band_error AS vpd_band_error_after_kpa,
    CASE
        WHEN s.after_temp_band_error IS NULL OR s.temp_band_error_f IS NULL THEN NULL
        ELSE abs(s.after_temp_band_error) - abs(s.temp_band_error_f)
    END AS temp_abs_error_delta_f,
    CASE
        WHEN s.after_vpd_band_error IS NULL OR s.vpd_band_error_kpa IS NULL THEN NULL
        ELSE abs(s.after_vpd_band_error) - abs(s.vpd_band_error_kpa)
    END AS vpd_abs_error_delta_kpa,
    recovery.time_to_recover_s IS NOT NULL AS recovered_within_window,
    recovery.time_to_recover_s,
    duty.wet_relay_duty_pct,
    duty.vent_fan_duty_pct,
    duty.fog_duty_pct,
    CASE
        WHEN s.before_mister_water_gal IS NULL OR s.after_mister_water_gal IS NULL THEN NULL
        ELSE greatest(0.0, s.after_mister_water_gal - s.before_mister_water_gal)
    END AS mister_water_delta_gal,
    s.outdoor_temp_f,
    CASE
        WHEN s.outdoor_temp_f IS NULL OR s.outdoor_rh_pct IS NULL OR s.outdoor_rh_pct <= 0 THEN NULL
        ELSE (
            243.04 * (
                ln(s.outdoor_rh_pct / 100.0)
                + ((17.625 * ((s.outdoor_temp_f - 32.0) * 5.0 / 9.0))
                   / (243.04 + ((s.outdoor_temp_f - 32.0) * 5.0 / 9.0)))
            )
            / (
                17.625
                - ln(s.outdoor_rh_pct / 100.0)
                - ((17.625 * ((s.outdoor_temp_f - 32.0) * 5.0 / 9.0))
                   / (243.04 + ((s.outdoor_temp_f - 32.0) * 5.0 / 9.0)))
            )
        ) * 9.0 / 5.0 + 32.0
    END AS outdoor_dewpoint_f,
    s.solar_irradiance_w_m2,
    s.wet_assist_allowed,
    s.wet_assist_block_reason,
    s.fog_allowed,
    s.fog_block_reason,
    s.relay_truth,
    s.resource_cost_estimate
FROM scored s
LEFT JOIN LATERAL (
    SELECT extract(epoch FROM min(c.ts - s.ts))::double precision AS time_to_recover_s
    FROM public.climate c
    CROSS JOIN LATERAL fn_band_setpoints(c.ts) rb
    WHERE COALESCE(c.greenhouse_id, 'vallery') = COALESCE(s.greenhouse_id, 'vallery')
      AND c.ts >= s.ts
      AND c.ts <= s.ts + p_window
      AND c.temp_avg BETWEEN COALESCE(rb.temp_low, -1000) AND COALESCE(rb.temp_high, 1000)
      AND c.vpd_avg BETWEEN COALESCE(rb.vpd_low, -1000) AND COALESCE(rb.vpd_high, 1000)
) recovery ON true
LEFT JOIN LATERAL (
    SELECT
        round((avg((
            COALESCE(fn_equip_at('fog', sample_ts), false)
            OR COALESCE(fn_equip_at('mister_south', sample_ts), false)
            OR COALESCE(fn_equip_at('mister_west', sample_ts), false)
            OR COALESCE(fn_equip_at('mister_center', sample_ts), false)
        )::int) * 100.0)::numeric, 2)::double precision AS wet_relay_duty_pct,
        round((avg((
            COALESCE(fn_equip_at('vent', sample_ts), false)
            OR COALESCE(fn_equip_at('fan1', sample_ts), false)
            OR COALESCE(fn_equip_at('fan2', sample_ts), false)
        )::int) * 100.0)::numeric, 2)::double precision AS vent_fan_duty_pct,
        round((avg(COALESCE(fn_equip_at('fog', sample_ts), false)::int) * 100.0)::numeric, 2)::double precision
            AS fog_duty_pct
    FROM generate_series(s.ts, s.ts + p_window, interval '1 minute') AS sample(sample_ts)
) duty ON true;
$function$;

CREATE OR REPLACE FUNCTION public.fn_climate_action_daily_scorecard(target_date date)
 RETURNS TABLE(date date, greenhouse_id text, climate_action text, decisions bigint, avg_abs_temp_error_before_f numeric, avg_abs_vpd_error_before_kpa numeric, avg_temp_abs_error_delta_15m_f numeric, avg_vpd_abs_error_delta_15m_kpa numeric, avg_wet_relay_duty_pct numeric, avg_vent_fan_duty_pct numeric, mister_water_delta_gal numeric, wet_blocked_decisions bigint, fog_blocked_decisions bigint)
 LANGUAGE sql
 STABLE
AS $function$
WITH bounds AS (
    SELECT
        GREATEST(
            (target_date::timestamp AT TIME ZONE 'America/Denver'),
            now() - interval '14 days'
        ) AS start_ts,
        ((target_date + 1)::timestamp AT TIME ZONE 'America/Denver') AS end_ts
),
-- One row per climate_action_log decision on the target day, with the
-- migration-142 c0 (last climate sample at or before the action) and c1
-- (first climate sample in [ts+15m, ts+18m]) lookups inlined verbatim and
-- the after-band from the served band, fn_band_setpoints (RULINGS AF2; 317).
actions AS (
    SELECT
        row_number() OVER () AS rid,
        l.ts,
        l.greenhouse_id,
        l.climate_action,
        l.temp_band_error_f,
        l.vpd_band_error_kpa,
        l.wet_assist_block_reason,
        l.fog_block_reason,
        c0.mister_water_today AS before_mister_water_gal,
        c1.ts AS after_climate_ts,
        c1.temp_avg AS after_temp_f,
        c1.vpd_avg AS after_vpd_kpa,
        c1.mister_water_today AS after_mister_water_gal,
        ab.temp_low AS after_temp_low,
        ab.temp_high AS after_temp_high,
        ab.vpd_low AS after_vpd_low,
        ab.vpd_high AS after_vpd_high
    FROM public.climate_action_log l
    LEFT JOIN LATERAL (
        SELECT c.*
        FROM public.climate c
        WHERE COALESCE(c.greenhouse_id, 'vallery') = COALESCE(l.greenhouse_id, 'vallery')
          AND c.temp_avg IS NOT NULL
          AND c.vpd_avg IS NOT NULL
          AND c.ts <= l.ts
        ORDER BY c.ts DESC
        LIMIT 1
    ) c0 ON true
    LEFT JOIN LATERAL (
        SELECT c.*
        FROM public.climate c
        WHERE COALESCE(c.greenhouse_id, 'vallery') = COALESCE(l.greenhouse_id, 'vallery')
          AND c.temp_avg IS NOT NULL
          AND c.vpd_avg IS NOT NULL
          AND c.ts >= l.ts + interval '15 minutes'
          AND c.ts <= l.ts + interval '15 minutes' + interval '3 minutes'
        ORDER BY c.ts ASC
        LIMIT 1
    ) c1 ON true
    LEFT JOIN LATERAL fn_band_setpoints(COALESCE(c1.ts, l.ts)) ab ON true
    -- scalar-subquery bounds (InitPlan params) so TimescaleDB excludes
    -- non-target chunks at executor startup; a CROSS JOIN would make these
    -- join quals and merely index-descend every chunk
    WHERE l.ts >= (SELECT start_ts FROM bounds)
      AND l.ts < (SELECT end_ts FROM bounds)
),
-- The seven relay channels the scorecard's duty percentages read
-- (migration 142's wet OR: fog + three misters; vent OR: vent + two fans).
duty_channels AS (
    SELECT unnest(ARRAY[
        'fog', 'mister_south', 'mister_west', 'mister_center',
        'vent', 'fan1', 'fan2'
    ]) AS equipment
),
-- Last-known state per channel at the window start (fn_equip_at's exact
-- body evaluated once per channel instead of once per sample).
-- MATERIALIZED: referenced once, so without it the planner inlines the
-- scalar subquery into the duty join and re-executes it per grp=0
-- sample-channel row (measured 46k executions / 11.5 s on prod for a day
-- where one fan never transitioned).
carry AS MATERIALIZED (
    SELECT
        dc.equipment,
        (
            SELECT es.state
            FROM public.equipment_state es
            WHERE es.equipment = dc.equipment
              AND es.ts <= b.start_ts
            ORDER BY es.ts DESC
            LIMIT 1
        ) AS state
    FROM duty_channels dc
    CROSS JOIN bounds b
),
-- In-window transitions, one row per (equipment, ts). Among equal-ts
-- duplicates fn_equip_at's index scan returns the smallest-ctid row, so the
-- dedup keeps exactly that row.
edges AS (
    SELECT DISTINCT ON (es.equipment, es.ts)
        es.equipment,
        es.ts,
        es.state
    FROM public.equipment_state es
    WHERE es.equipment IN (
            'fog', 'mister_south', 'mister_west', 'mister_center',
            'vent', 'fan1', 'fan2'
          )
      AND es.ts > (SELECT start_ts FROM bounds)
      AND es.ts <= (SELECT end_ts FROM bounds) + interval '15 minutes'
    ORDER BY es.equipment, es.ts, es.ctid
),
-- The migration-142 sample grid: minute instants anchored at each action's
-- own timestamp, inclusive of both ends (16 instants per row).
samples AS (
    SELECT
        a.rid,
        s.sample_ts
    FROM actions a
    CROSS JOIN LATERAL generate_series(
        a.ts, a.ts + interval '15 minutes', interval '1 minute'
    ) AS s(sample_ts)
),
-- One LOCF pass: interleave edges (kind 0) and sample instants (kind 1) per
-- channel; grp counts edges at or before each row (an edge applies at its
-- own instant, matching fn_equip_at's ts <= sample), and edge_state carries
-- the grp-leader edge's state to every sample in the group.
events AS (
    SELECT e.equipment, e.ts AS ts_point, 0 AS kind,
           NULL::bigint AS rid, NULL::timestamptz AS sample_ts, e.state AS state_val
    FROM edges e
    UNION ALL
    SELECT dc.equipment, s.sample_ts, 1,
           s.rid, s.sample_ts, NULL::boolean
    FROM samples s
    CROSS JOIN duty_channels dc
),
resolved AS (
    SELECT
        ev.*,
        count(CASE WHEN ev.kind = 0 THEN 1 END)
            OVER (PARTITION BY ev.equipment ORDER BY ev.ts_point, ev.kind) AS grp
    FROM events ev
),
states AS (
    SELECT
        r.*,
        bool_or(CASE WHEN r.kind = 0 THEN r.state_val END)
            OVER (PARTITION BY r.equipment, r.grp) AS edge_state
    FROM resolved r
),
-- Per sample instant: the wet-relay OR and vent/fan OR of migration 142,
-- with fn_equip_at's NULL -> false coalescing applied per channel.
sample_flags AS (
    SELECT
        st.rid,
        st.sample_ts,
        bool_or(COALESCE(CASE WHEN st.grp > 0 THEN st.edge_state ELSE ci.state END, false))
            FILTER (WHERE st.equipment IN ('fog', 'mister_south', 'mister_west', 'mister_center'))
            AS wet_on,
        bool_or(COALESCE(CASE WHEN st.grp > 0 THEN st.edge_state ELSE ci.state END, false))
            FILTER (WHERE st.equipment IN ('vent', 'fan1', 'fan2'))
            AS vent_on
    FROM states st
    JOIN carry ci ON ci.equipment = st.equipment
    WHERE st.kind = 1
    GROUP BY st.rid, st.sample_ts
),
duty AS (
    SELECT
        sf.rid,
        round((avg(sf.wet_on::int) * 100.0)::numeric, 2)::double precision AS wet_relay_duty_pct,
        round((avg(sf.vent_on::int) * 100.0)::numeric, 2)::double precision AS vent_fan_duty_pct
    FROM sample_flags sf
    GROUP BY sf.rid
),
-- Migration 142's scored/after expressions, verbatim.
enriched AS (
    SELECT
        a.*,
        CASE
            WHEN a.after_temp_f IS NULL OR a.after_temp_low IS NULL OR a.after_temp_high IS NULL THEN NULL
            WHEN a.after_temp_f < a.after_temp_low THEN a.after_temp_f - a.after_temp_low
            WHEN a.after_temp_f > a.after_temp_high THEN a.after_temp_f - a.after_temp_high
            ELSE 0.0
        END AS after_temp_band_error,
        CASE
            WHEN a.after_vpd_kpa IS NULL OR a.after_vpd_low IS NULL OR a.after_vpd_high IS NULL THEN NULL
            WHEN a.after_vpd_kpa < a.after_vpd_low THEN a.after_vpd_kpa - a.after_vpd_low
            WHEN a.after_vpd_kpa > a.after_vpd_high THEN a.after_vpd_kpa - a.after_vpd_high
            ELSE 0.0
        END AS after_vpd_band_error,
        CASE
            WHEN a.before_mister_water_gal IS NULL OR a.after_mister_water_gal IS NULL THEN NULL
            ELSE greatest(0.0, a.after_mister_water_gal - a.before_mister_water_gal)
        END AS mister_water_delta_gal
    FROM actions a
)
SELECT
    (e.ts AT TIME ZONE 'America/Denver')::date AS date,
    e.greenhouse_id,
    e.climate_action,
    count(*) AS decisions,
    round(avg(abs(e.temp_band_error_f))::numeric, 2) AS avg_abs_temp_error_before_f,
    round(avg(abs(e.vpd_band_error_kpa))::numeric, 3) AS avg_abs_vpd_error_before_kpa,
    round(avg(
        CASE
            WHEN e.after_temp_band_error IS NULL OR e.temp_band_error_f IS NULL THEN NULL
            ELSE abs(e.after_temp_band_error) - abs(e.temp_band_error_f)
        END
    )::numeric, 2) AS avg_temp_abs_error_delta_15m_f,
    round(avg(
        CASE
            WHEN e.after_vpd_band_error IS NULL OR e.vpd_band_error_kpa IS NULL THEN NULL
            ELSE abs(e.after_vpd_band_error) - abs(e.vpd_band_error_kpa)
        END
    )::numeric, 3) AS avg_vpd_abs_error_delta_15m_kpa,
    round(avg(d.wet_relay_duty_pct)::numeric, 2) AS avg_wet_relay_duty_pct,
    round(avg(d.vent_fan_duty_pct)::numeric, 2) AS avg_vent_fan_duty_pct,
    round(sum(coalesce(e.mister_water_delta_gal, 0.0))::numeric, 3) AS mister_water_delta_gal,
    count(*) FILTER (WHERE e.wet_assist_block_reason IS NOT NULL) AS wet_blocked_decisions,
    count(*) FILTER (WHERE e.fog_block_reason IS NOT NULL AND e.fog_block_reason <> 'none') AS fog_blocked_decisions
FROM enriched e
JOIN duty d ON d.rid = e.rid
GROUP BY 1, 2, 3;
$function$;

CREATE OR REPLACE FUNCTION public.fn_heat_staging_inversion()
 RETURNS TABLE(heat2_on_since timestamp with time zone, heat1_state boolean, duration_s double precision, temp_avg double precision, temp_low double precision, d_heat_stage_2 double precision)
 LANGUAGE sql
 STABLE
AS $function$
    WITH latest_h2 AS (
        SELECT ts, state FROM equipment_state
        WHERE equipment = 'heat2' ORDER BY ts DESC LIMIT 1
    ),
    latest_h1 AS (
        SELECT ts, state FROM equipment_state
        WHERE equipment = 'heat1' ORDER BY ts DESC LIMIT 1
    ),
    latest_climate AS (
        SELECT temp_avg FROM climate
        WHERE temp_avg IS NOT NULL ORDER BY ts DESC LIMIT 1
    ),
    -- The served band's low edge now (fn_band_setpoints, RULINGS AF2; 317). d_heat_stage_2 is a retired setting
    -- with no source under the climate law: NULL.
    latest_sp AS (
        SELECT b.temp_low, NULL::double precision AS d_heat_stage_2
        FROM fn_band_setpoints(now()) b
    )
    SELECT h2.ts, h1.state, EXTRACT(EPOCH FROM now() - h2.ts),
           c.temp_avg, sp.temp_low, sp.d_heat_stage_2
    FROM latest_h2 h2, latest_h1 h1, latest_climate c, latest_sp sp
    WHERE h2.state = true AND h1.state = false
      AND EXTRACT(EPOCH FROM now() - h2.ts) > 60;
$function$;

-- (a) CTL-26: the house VPD band is the served band. The live definition (145) widened the crop band around the
-- zone targets; the zone targets stay as information, the width and margin constants are retired (NULL).
CREATE OR REPLACE FUNCTION public.fn_house_vpd_control_band(target_ts timestamp with time zone)
RETURNS TABLE(crop_vpd_low double precision, crop_vpd_high double precision,
              vpd_target_south double precision, vpd_target_west double precision,
              vpd_target_east double precision, vpd_target_center double precision,
              zone_vpd_min double precision, zone_vpd_median double precision,
              zone_vpd_max double precision, house_vpd_low double precision,
              house_vpd_high double precision, house_vpd_min_width_kpa double precision,
              house_vpd_low_margin_kpa double precision)
LANGUAGE plpgsql
STABLE ROWS 1
AS $function$
BEGIN
    SELECT b.vpd_low, b.vpd_high
      INTO crop_vpd_low, crop_vpd_high
      FROM public.fn_band_setpoints(target_ts) AS b
     LIMIT 1;

    IF crop_vpd_low IS NULL OR crop_vpd_high IS NULL THEN
        RETURN;
    END IF;

    SELECT z.vpd_target_south, z.vpd_target_west, z.vpd_target_east, z.vpd_target_center
      INTO vpd_target_south, vpd_target_west, vpd_target_east, vpd_target_center
      FROM public.fn_zone_vpd_targets(target_ts) AS z
     LIMIT 1;

    SELECT min(t.v), percentile_cont(0.5) WITHIN GROUP (ORDER BY t.v), max(t.v)
      INTO zone_vpd_min, zone_vpd_median, zone_vpd_max
      FROM (VALUES (vpd_target_south), (vpd_target_west), (vpd_target_east), (vpd_target_center)) AS t(v)
     WHERE t.v IS NOT NULL AND t.v > 0 AND t.v < 10;

    house_vpd_low := crop_vpd_low;
    house_vpd_high := crop_vpd_high;
    house_vpd_min_width_kpa := NULL;
    house_vpd_low_margin_kpa := NULL;
    RETURN NEXT;
END;
$function$;
COMMENT ON FUNCTION public.fn_house_vpd_control_band(timestamptz) IS
    'Compatibility reader of the one band (317, CTL-26): house_vpd_low/high and crop_vpd_low/high are '
    'fn_band_setpoints'' vpd_low/vpd_high, the served house band; vpd_target_* and zone_vpd_min/median/max are the '
    'zone targets for information; house_vpd_min_width_kpa and house_vpd_low_margin_kpa are retired (NULL). New code '
    'reads fn_band_setpoints; a later release drops this function.';

-- (f) TEL-65: the daily record carries the law's refused drying. The live definition (310) plus the law CTEs and
-- the dry_refusal column.
CREATE OR REPLACE FUNCTION public.fn_daily_record_store(p_day date)
RETURNS public.daily_record
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $store$
DECLARE
    v_start timestamptz;
    v_end timestamptz;
    stored public.daily_record;
BEGIN
    IF p_day IS NULL OR p_day > (now() AT TIME ZONE 'America/Denver')::date THEN
        RAISE EXCEPTION 'daily record day % is not a past or current local day', p_day USING ERRCODE = '22023';
    END IF;
    v_start := p_day::timestamp AT TIME ZONE 'America/Denver';
    v_end := (p_day + 1)::timestamp AT TIME ZONE 'America/Denver';

    WITH run AS MATERIALIZED (
        SELECT * FROM public.fn_relay_run_intervals(v_start, v_end)
    ), event AS (
        SELECT DISTINCT r.equipment, r.event_on_at, r.event_off_at FROM run r WHERE r.event_on_at IS NOT NULL
    ), per_relay AS (
        SELECT x.equipment,
               (SELECT count(*) FROM run r
                 WHERE r.equipment = x.equipment AND r.on_at >= v_start AND r.on_at < v_end)::integer AS starts,
               COALESCE((SELECT sum(extract(epoch FROM LEAST(r.off_at, v_end) - GREATEST(r.on_at, v_start)))
                           FROM run r WHERE r.equipment = x.equipment), 0)::double precision AS run_s,
               COALESCE((SELECT sum(extract(epoch FROM LEAST(e.event_off_at, v_end) - GREATEST(e.event_on_at, v_start)))
                           FROM event e WHERE e.equipment = x.equipment), 0)::double precision AS event_run_s,
               (SELECT count(*) FROM run r WHERE r.equipment = x.equipment AND r.repair <> 'none')::integer AS repaired_runs
          FROM public.fn_daily_record_relays() x
    ), relay_rows AS (
        INSERT INTO public.daily_relay_record AS t
            (date, equipment, starts, run_s, event_run_s, repaired_runs, computed_at)
        SELECT p_day, p.equipment, p.starts, p.run_s, p.event_run_s, p.repaired_runs, now() FROM per_relay p
        ON CONFLICT (date, equipment) DO UPDATE SET
            starts = EXCLUDED.starts, run_s = EXCLUDED.run_s, event_run_s = EXCLUDED.event_run_s,
            repaired_runs = EXCLUDED.repaired_runs, computed_at = EXCLUDED.computed_at
        RETURNING t.equipment, t.run_s
    ), action AS (
        SELECT a.ts, a.climate_action = 'DEHUM_VENT' AS drying,
               lead(a.ts) OVER (ORDER BY a.ts) AS next_ts
          FROM public.climate_action_log a
         WHERE a.greenhouse_id = 'vallery' AND a.ts >= v_start - interval '1 hour' AND a.ts < v_end
    ), dry_row AS (
        SELECT d.ts, LEAST(COALESCE(d.next_ts, LEAST(v_end, now())), d.ts + interval '3 minutes') AS until
          FROM action d WHERE d.drying
    ), dry_island AS (
        SELECT d.ts, d.until,
               sum(CASE WHEN d.previous_until IS NULL OR d.ts > d.previous_until THEN 1 ELSE 0 END)
                   OVER (ORDER BY d.ts) AS island
          FROM (SELECT y.ts, y.until, lag(y.until) OVER (ORDER BY y.ts) AS previous_until FROM dry_row y) d
    ), dry_run AS (
        SELECT min(i.ts) AS began, max(i.until) AS ended FROM dry_island i GROUP BY i.island
    ), gas AS (
        SELECT rc.nominal_value
          FROM public.equipment eq
          JOIN public.resource_coefficients rc ON rc.equipment_id = eq.id
         WHERE eq.greenhouse_id = 'vallery' AND eq.slug = 'heat2' AND eq.is_active
           AND rc.resource_kind = 'gas_btu_per_hour'
           AND rc.valid_from <= v_start AND (rc.valid_to IS NULL OR rc.valid_to > v_start)
         ORDER BY rc.valid_from DESC, rc.id DESC
         LIMIT 1
    ), energy AS (
        -- The day at full coverage only when the meter reported at least 70 % of it (before 2026-10-24 it did not).
        SELECT ed.measured_kwh::double precision AS kwh,
               CASE WHEN ed.meter_coverage_pct >= 70
                    THEN ed.avg_watts * extract(epoch FROM v_end - v_start) / 3600.0 / 1000.0 END::double precision
                   AS kwh_24h,
               ed.meter_coverage_pct::double precision AS coverage
          FROM public.v_energy_daily ed
         WHERE ed.date = p_day AND ed.greenhouse_id = 'vallery'
    ), water AS (
        SELECT w.quality_filtered_meter_gal::double precision AS gal,
               w.climate_wetting_gal::double precision AS wetting,
               w.planning_water_gal::double precision AS planning,
               w.manual_or_unattributed_gal::double precision AS house,
               w.available_for_scoring AS complete
          FROM public.v_water_attribution_daily w
         WHERE w.date = p_day AND w.greenhouse_id = 'vallery'
    ), evidence AS (
        -- The heat1 counter stream, one sample per 30 s: below 100 the lost-OFF detector was partly blind.
        SELECT LEAST(100.0, count(*) * 30.0 * 100.0 / extract(epoch FROM LEAST(v_end, now()) - v_start))::double precision
                   AS counter_sample_pct
          FROM public.equipment_counter_samples c
         WHERE c.greenhouse_id = 'vallery' AND c.stream = 'heat1'
           AND c.source_observed_at >= v_start AND c.source_observed_at < v_end
    ), law AS (
        -- The climate law's state record (one a minute, and on a change): each record holds until the next, at most
        -- 3 minutes, so a gap (a boot, a lost link) counts as no record. l bit 6: drying wanted; dr: why it is not
        -- running ('none' while it runs).
        SELECT s.ts,
               LEAST(COALESCE(lead(s.ts) OVER (ORDER BY s.ts), LEAST(v_end, now())), s.ts + interval '3 minutes') AS until,
               ((s.value::jsonb ->> 'l')::bigint & 64) <> 0 AS wanted,
               COALESCE(s.value::jsonb ->> 'dr', 'unknown') AS reason
          FROM public.system_state s
         WHERE s.entity = 'climate_law_state' AND s.ts >= v_start - interval '3 minutes' AND s.ts < v_end
           AND s.value LIKE '{"v":1,%'
           -- One malformed record is skipped, not fatal to the day: the JSON must parse and l must be digits (the
           -- contract allows up to 2^32 - 1, so bigint). CASE keeps the casts behind the checks.
           AND CASE WHEN pg_catalog.pg_input_is_valid(s.value, 'jsonb')
                    THEN (s.value::jsonb ->> 'l') ~ '^[0-9]{1,18}$' ELSE false END
    ), law_reason AS (
        SELECT l.reason,
               sum(GREATEST(extract(epoch FROM LEAST(l.until, v_end) - GREATEST(l.ts, v_start)), 0)) AS covered_s,
               sum(GREATEST(extract(epoch FROM LEAST(l.until, v_end) - GREATEST(l.ts, v_start)), 0))
                   FILTER (WHERE l.wanted) AS wanted_s
          FROM law l
         GROUP BY l.reason
    ), refusal AS (
        SELECT jsonb_build_object(
                   'covered_s', round(sum(r.covered_s)),
                   'wanted_s', round(COALESCE(sum(r.wanted_s), 0)),
                   'refused_s', COALESCE(jsonb_object_agg(r.reason, round(r.wanted_s))
                                             FILTER (WHERE r.reason <> 'none' AND r.wanted_s > 0), '{}'::jsonb)) AS doc
          FROM law_reason r
        HAVING sum(r.covered_s) > 0
    )
    INSERT INTO public.daily_record AS t (
        date, complete, kwh_metered, kwh_metered_24h, meter_coverage_pct, therms_est,
        water_gal, wetting_gal, planning_water_gal, house_water_gal, water_complete, counter_sample_pct,
        drying_s, drying_runs, furnace_starts_after_drying, dry_refusal, computed_at)
    SELECT p_day, now() >= v_end,
           (SELECT e.kwh FROM energy e), (SELECT e.kwh_24h FROM energy e), (SELECT e.coverage FROM energy e),
           (SELECT rr.run_s / 3600.0 * g.nominal_value::double precision / 100000.0
              FROM relay_rows rr, gas g WHERE rr.equipment = 'heat2'),
           (SELECT w.gal FROM water w), (SELECT w.wetting FROM water w), (SELECT w.planning FROM water w),
           (SELECT w.house FROM water w), (SELECT w.complete FROM water w), (SELECT ev.counter_sample_pct FROM evidence ev),
           COALESCE((SELECT sum(GREATEST(extract(epoch FROM LEAST(d.until, v_end) - GREATEST(d.ts, v_start)), 0))
                       FROM dry_row d), 0),
           (SELECT count(*) FROM dry_run d WHERE d.began >= v_start)::integer,
           (SELECT count(*) FROM run r
             WHERE r.equipment = 'heat2' AND r.on_at >= v_start AND r.on_at < v_end
               AND EXISTS (SELECT 1 FROM dry_run d
                            WHERE r.on_at >= d.ended AND r.on_at < d.ended + interval '15 minutes'))::integer,
           CASE WHEN now() >= v_end THEN (SELECT rf.doc FROM refusal rf) END,
           now()
    ON CONFLICT (date) DO UPDATE SET
        complete = EXCLUDED.complete, kwh_metered = EXCLUDED.kwh_metered,
        kwh_metered_24h = EXCLUDED.kwh_metered_24h, meter_coverage_pct = EXCLUDED.meter_coverage_pct,
        therms_est = EXCLUDED.therms_est, water_gal = EXCLUDED.water_gal, wetting_gal = EXCLUDED.wetting_gal,
        planning_water_gal = EXCLUDED.planning_water_gal, house_water_gal = EXCLUDED.house_water_gal,
        water_complete = EXCLUDED.water_complete, counter_sample_pct = EXCLUDED.counter_sample_pct,
        drying_s = EXCLUDED.drying_s, drying_runs = EXCLUDED.drying_runs,
        furnace_starts_after_drying = EXCLUDED.furnace_starts_after_drying, dry_refusal = EXCLUDED.dry_refusal,
        computed_at = EXCLUDED.computed_at
    RETURNING t.* INTO stored;
    RETURN stored;
END
$store$;
COMMENT ON COLUMN public.daily_record.dry_refusal IS
    'The climate law''s drying record for the day (317, TEL-65), from climate_law_state, each record held until the '
    'next and at most 3 minutes: covered_s, the seconds with a law record; wanted_s, the seconds drying was wanted '
    '(l bit 6); refused_s, an object of refusal reason (dr: no_outdoor, cooling, furnace, not_drier, too_cold, cost, '
    'humidity_invalid, no_temperature) to the wanted seconds it refused; wanted_s minus their sum ran. Set when the '
    'day is complete; NULL for the day in progress and for a day with no law record (before the law flash).';

-- (g) The daily review's status for the lab's public-share panels, built as the other Grafana facades (268).
CREATE VIEW verdify_grafana_runtime.planner_review WITH(security_barrier=true) AS SELECT "id", "kind", "review_date", "status", "requested_at", "written_at" FROM public.planner_review;
REVOKE ALL ON verdify_grafana_runtime.planner_review FROM PUBLIC;
GRANT SELECT ON verdify_grafana_runtime.planner_review TO verdify_grafana_runtime;
COMMENT ON VIEW verdify_grafana_runtime.planner_review IS
    'The daily review''s status for Grafana (317): id, kind, review_date, status, requested_at and written_at of '
    'public.planner_review; the review''s text, band proposal, token counts and failure text stay out.';

-- (c) One definition of a relay's daily run time (validation TEL-23).
COMMENT ON COLUMN public.daily_relay_record.run_s IS
    'The relay''s daily run time: seconds on in the America/Denver day from fn_relay_run_intervals, after the lost-OFF '
    '(counter), lost-ON (counter_orphan) and dry-flow repairs (310). daily_summary, daily_record and every report use '
    'this column (317).';
COMMENT ON COLUMN public.daily_relay_record.event_run_s IS
    'Diagnostic only: the seconds the raw equipment_state edges give for the same day, before any repair. It differs '
    'from run_s on the days with repaired_runs > 0 (a lost OFF lengthens an interval, a lost ON drops a run); '
    'event_run_s - run_s is the repair''s net effect. Not a run time to report or to compare a summary with (317).';

-- Successor seals: the probe of the rolled-back native qualification measures them, and each receipt is re-sealed.
-- Until measured, these are 316's values and the block refuses (fail closed).
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '46285cc61b12abcb6e08a3898941a837f0c9c8701761408d8af901e30a291d76'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '74023040d4e1cec522dc7cc0b51348c0898e7006da193b4a3b96613eac49ad4f'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'd78c9a7e114bdece47f0a9f6768e3c3d869a1598dcfce38b1a668ef631551929'
    THEN RAISE EXCEPTION '317 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('46285cc61b12abcb6e08a3898941a837f0c9c8701761408d8af901e30a291d76','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '317 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('74023040d4e1cec522dc7cc0b51348c0898e7006da193b4a3b96613eac49ad4f','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '317 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('d78c9a7e114bdece47f0a9f6768e3c3d869a1598dcfce38b1a668ef631551929','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '317 missing mcp receipt'; END IF;
    IF EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
    THEN RAISE EXCEPTION '317 receipts do not match the successor seals'; END IF;
END $successor$;
