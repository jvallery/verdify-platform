-- The real ingestor role writes all twelve readings through the production source-event entry point.
SELECT set_config('verdify.q322_ts', (date_trunc('second', clock_timestamp()) + interval '0.322322 second')::text, false);
SELECT set_config('verdify.q322_readings', '{
    "soil_moisture_south_1":20.3,"soil_temp_south_1":75.56,"soil_ec_south_1":28,
    "soil_ph_south_1":5.7,"soil_salinity_south_1":15,"soil_tds_south_1":14,
    "soil_moisture_west":19.3,"soil_temp_west":73.04,"soil_ec_west":21,
    "soil_ph_west":5.0,"soil_salinity_west":11,"soil_tds_west":10,"ppfd_umol_m2_s":122
}', false);

SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $ingestor$
DECLARE
    t timestamptz := current_setting('verdify.q322_ts')::timestamptz;
    readings jsonb := current_setting('verdify.q322_readings')::jsonb;
BEGIN
    IF public.fn_record_climate_source_event(gen_random_uuid(), t, 'vallery', gen_random_uuid(), 0,
            readings, jsonb_build_object('qualification', '322')) IS NOT TRUE
    THEN RAISE EXCEPTION '322 ingestor could not record a soil climate event'; END IF;
    IF NOT EXISTS (SELECT FROM public.climate AS c
                    WHERE ts = t AND greenhouse_id = 'vallery' AND to_jsonb(c) @> readings)
    THEN RAISE EXCEPTION '322 did not store all twelve soil readings and PAR'; END IF;
END $ingestor$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;
DO $dashboard$
BEGIN
    IF NOT EXISTS (SELECT FROM public.climate AS c
                    WHERE ts = current_setting('verdify.q322_ts')::timestamptz AND greenhouse_id = 'vallery'
                      AND to_jsonb(c) @> current_setting('verdify.q322_readings')::jsonb)
    THEN RAISE EXCEPTION '322 dashboard could not read the stored soil readings'; END IF;
END $dashboard$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION verdify_grafana_runtime_login;
DO $grafana$
BEGIN
    IF has_column_privilege(current_user, 'public.climate', 'ppfd_umol_m2_s', 'SELECT')
    THEN RAISE EXCEPTION '322 gave Grafana direct climate access'; END IF;
    IF NOT EXISTS (SELECT FROM verdify_grafana_runtime.climate AS c
                    WHERE ts = current_setting('verdify.q322_ts')::timestamptz AND greenhouse_id = 'vallery'
                      AND to_jsonb(c) @> current_setting('verdify.q322_readings')::jsonb)
    THEN RAISE EXCEPTION '322 Grafana could not read the stored soil and PAR readings'; END IF;
END $grafana$;
RESET SESSION AUTHORIZATION;

DO $mapping$
BEGIN
    IF (SELECT count(*) FROM public.soil_moisture_targets
         WHERE greenhouse_id = 'vallery' AND probe_column IS NOT NULL) <> 2
       OR NOT EXISTS (SELECT FROM public.soil_moisture_targets
                       WHERE greenhouse_id = 'vallery' AND zone = 'south_2' AND probe_column IS NULL)
    THEN RAISE EXCEPTION '322 did not retire the South 2 probe assignment'; END IF;
    IF EXISTS (SELECT FROM public.sensor_registry
               WHERE sensor_id IN ('climate.soil_moisture_south_2', 'climate.soil_temp_south_2') AND active)
       OR (SELECT count(*) FROM public.sensor_registry
           WHERE active AND source_table='climate' AND current_setting('verdify.q322_readings')::jsonb ? source_column) <> 13
    THEN RAISE EXCEPTION '322 sensor registry does not match the live soil and PAR channels'; END IF;
END $mapping$;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('ingestor_source_event_stores_all_soil_and_par_values',
                               'dashboard_and_grafana_read_all_values', 'two_active_soil_assignments',
                               'live_sensor_registry_matches_the_channels'),
    'all_passed', true)::text;
