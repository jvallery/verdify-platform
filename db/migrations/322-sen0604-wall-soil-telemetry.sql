-- SEN0604 at South Wall (7, existing south_1 series) and West Wall (9).
-- Retain the original series and South 2 history. Append channels to the existing
-- climate writer facade so the source-event path can store them at normal cadence.
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=321 AND filename='db/migrations/321-ingestor-gap-and-compliance-reads-water-reset-delta.sql'
            AND sha256='614190ef3f32c728d8ca667e854d0559c36573ab204c9ef03851d57395787a5c'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>321)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '6c25f8edeca86917bc4b0c8bb7aa960d6d6a280bfaf2e32b574701439d52f40c'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM 'b37744a7416c1a79835f5876fd3357b1e18c1f3ca91b721005c740c1b6debf42'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'aa26302d0e3a0931a5f91ce9f23c660a5a240cb59de1a4d5605f38638b534718'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR (SELECT reloptions FROM pg_catalog.pg_class WHERE oid='public.v_runtime_climate_write'::regclass)
            IS DISTINCT FROM ARRAY['security_barrier=true','security_invoker=false']
    THEN RAISE EXCEPTION '322 requires exact321 and its seals'; END IF;
END $predecessor$;

ALTER TABLE public.climate
    ADD COLUMN soil_ph_south_1 double precision,
    ADD COLUMN soil_salinity_south_1 double precision,
    ADD COLUMN soil_tds_south_1 double precision,
    ADD COLUMN soil_ec_west double precision,
    ADD COLUMN soil_ph_west double precision,
    ADD COLUMN soil_salinity_west double precision,
    ADD COLUMN soil_tds_west double precision;

CREATE OR REPLACE VIEW public.v_runtime_climate_write
    WITH (security_barrier=true, security_invoker=false) AS
SELECT ts, greenhouse_id, abs_humidity, co2_ppm, dew_point, dli_today,
       ec_runoff_center, enthalpy_delta, flow_gpm, house_temp_delta_f,
       house_temp_target_f, house_vpd_delta, house_vpd_target, intake_rh,
       intake_vpd, lightning_avg_dist_mi, lightning_count, lux,
       mister_water_today, moisture_center, outdoor_illuminance,
       outdoor_lux, outdoor_rh_pct, outdoor_temp_f, ph_runoff_center,
       precip_in, pressure_hpa, rh_avg, rh_case, rh_east, rh_north,
       rh_south, rh_west, soil_ec_south_1, soil_moisture_south_1,
       soil_moisture_south_2, soil_moisture_west, soil_temp_south_1,
       soil_temp_south_2, soil_temp_west, solar_irradiance_w_m2,
       solar_noon_min, solar_phase, solar_sunrise_min, solar_sunset_min,
       temp_avg, temp_case, temp_control, temp_east, temp_intake,
       temp_north, temp_south, temp_west, uv_index, vpd_avg,
       vpd_control, vpd_delta_center, vpd_delta_east, vpd_delta_south,
       vpd_delta_west, vpd_east, vpd_north, vpd_south,
       vpd_target_center, vpd_target_east, vpd_target_south,
       vpd_target_west, vpd_west, water_total_gal, wind_direction_deg,
       wind_gust_mph, wind_lull_mph, wind_speed_mph,
       air_density_kg_m3, feels_like_f, hydro_battery_pct,
       hydro_ec_us_cm, hydro_orp_mv, hydro_ph, hydro_tds_ppm,
       hydro_water_temp_f, precip_intensity_in_h, vapor_pressure_inhg,
       wet_bulb_temp_f, wind_direction_avg_deg, wind_speed_avg_mph,
       ppfd_umol_m2_s, soil_ph_south_1, soil_salinity_south_1, soil_tds_south_1,
       soil_ec_west, soil_ph_west, soil_salinity_west, soil_tds_west
  FROM public.climate;

GRANT INSERT (soil_ph_south_1, soil_salinity_south_1, soil_tds_south_1,
              soil_ec_west, soil_ph_west, soil_salinity_west, soil_tds_west)
    ON public.v_runtime_climate_write TO verdify_ingestor_runtime;

-- Preserve the retired probe's thresholds and historical data; detach dryout routing.
UPDATE public.soil_moisture_targets
   SET probe_column = NULL, sensor_id = NULL, occupancy_zone = NULL
 WHERE zone = 'south_2' AND sensor_id = 'soil.south_2';

-- Extend the existing read-only Grafana projection; keep the public base table private.
CREATE OR REPLACE VIEW verdify_grafana_runtime.climate WITH (security_barrier=true) AS
SELECT ts, temp_avg, temp_north, temp_south, temp_east, temp_west, temp_case, temp_control, temp_intake,
       rh_avg, rh_north, rh_south, rh_east, rh_west, rh_case, vpd_avg, vpd_north, vpd_south, vpd_east,
       vpd_west, vpd_control, dew_point, abs_humidity, enthalpy_delta, co2_ppm, lux, dli_today, flow_gpm,
       water_total_gal, mister_water_today, outdoor_temp_f, outdoor_rh_pct, ph_input, ec_input, ph_runoff_wall,
       ec_runoff_wall, ph_runoff_center, ec_runoff_center, moisture_north, moisture_south, moisture_center,
       ppfd, dli_par_today, pressure_hpa, leaf_temp_north, leaf_temp_south, leaf_wetness_north,
       leaf_wetness_south, wind_speed_mph, wind_direction_deg, outdoor_lux, solar_irradiance_w_m2, precip_in,
       uv_index, hydro_tds_ppm, hydro_water_temp_f, wind_gust_mph, wind_lull_mph, wind_speed_avg_mph,
       wind_direction_avg_deg, feels_like_f, wet_bulb_temp_f, vapor_pressure_inhg, air_density_kg_m3,
       precip_intensity_in_h, lightning_count, lightning_avg_dist_mi, solar_altitude_deg, solar_azimuth_deg,
       hydro_ec_us_cm, hydro_orp_mv, hydro_ph, hydro_battery_pct, soil_moisture_south_1, soil_temp_south_1,
       soil_ec_south_1, soil_moisture_south_2, soil_temp_south_2, soil_moisture_west, soil_temp_west,
       intake_rh, intake_vpd, outdoor_illuminance, greenhouse_id, solar_phase, solar_sunrise_min,
       solar_noon_min, solar_sunset_min, house_temp_target_f, house_temp_delta_f, house_vpd_target,
       house_vpd_delta, vpd_target_center, vpd_target_south, vpd_target_west, vpd_target_east,
       vpd_delta_center, vpd_delta_south, vpd_delta_west, vpd_delta_east, ppfd_umol_m2_s, soil_ph_south_1,
       soil_salinity_south_1, soil_tds_south_1, soil_ec_west, soil_ph_west, soil_salinity_west, soil_tds_west
  FROM public.climate;

-- Retire live registry coverage while preserving historical IDs, rows and target history.
UPDATE public.sensor_registry
   SET active = false, updated_at = now()
 WHERE sensor_id IN ('climate.soil_moisture_south_2', 'climate.soil_temp_south_2');

UPDATE public.greenhouse_sensor_config
   SET is_required = false
 WHERE greenhouse_id = 'vallery' AND target_table = 'climate'
   AND target_column IN ('soil_moisture_south_2', 'soil_temp_south_2');

INSERT INTO public.sensor_registry
    (sensor_id, entity_id, type, zone, source_table, source_column, unit, expected_interval_s, active, description)
SELECT 'climate.' || source_column, entity_id, 'sensor', zone, 'climate', source_column, unit, 60, true, description
FROM (VALUES
    ('soil_moisture_south_1', 'south_1_soil_moisture____', 'south', '%', 'South Wall SEN0604 soil moisture'),
    ('soil_temp_south_1', 'south_1_soil_temp___f_', 'south', '°F', 'South Wall SEN0604 soil temperature'),
    ('soil_ec_south_1', 'south_1_soil_ec___s_cm_', 'south', 'µS/cm', 'South Wall SEN0604 electrical conductivity'),
    ('soil_ph_south_1', 'south_wall_soil_ph', 'south', 'pH', 'South Wall SEN0604 soil pH'),
    ('soil_salinity_south_1', 'south_wall_soil_salinity', 'south', 'raw', 'South Wall SEN0604 salinity reference output'),
    ('soil_tds_south_1', 'south_wall_soil_tds', 'south', 'raw', 'South Wall SEN0604 TDS reference output'),
    ('soil_moisture_west', 'west_soil_moisture____', 'west', '%', 'West Wall SEN0604 soil moisture'),
    ('soil_temp_west', 'west_soil_temp___f_', 'west', '°F', 'West Wall SEN0604 soil temperature'),
    ('soil_ec_west', 'west_wall_soil_ec', 'west', 'µS/cm', 'West Wall SEN0604 electrical conductivity'),
    ('soil_ph_west', 'west_wall_soil_ph', 'west', 'pH', 'West Wall SEN0604 soil pH'),
    ('soil_salinity_west', 'west_wall_soil_salinity', 'west', 'raw', 'West Wall SEN0604 salinity reference output'),
    ('soil_tds_west', 'west_wall_soil_tds', 'west', 'raw', 'West Wall SEN0604 TDS reference output'),
    ('ppfd_umol_m2_s', 'canopy_ppfd', 'house', 'µmol/m²/s', 'Canopy SEN0641 photosynthetic photon flux density')
) AS channels(source_column, entity_id, zone, unit, description)
ON CONFLICT (sensor_id) DO UPDATE
SET entity_id = EXCLUDED.entity_id,
    zone = EXCLUDED.zone,
    unit = EXCLUDED.unit,
    expected_interval_s = EXCLUDED.expected_interval_s,
    active = EXCLUDED.active,
    description = EXCLUDED.description,
    updated_at = now();

DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '100231c37c0caf37be0bfde62454b223e17df91fbf0e8b0279f3c2e28ab23f0e'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '5f507e44e0172534703829a626b47b7fff7576c0fbbc39d58516b986b8556a79'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'aa26302d0e3a0931a5f91ce9f23c660a5a240cb59de1a4d5605f38638b534718'
    THEN RAISE EXCEPTION '322 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('100231c37c0caf37be0bfde62454b223e17df91fbf0e8b0279f3c2e28ab23f0e','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '322 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('5f507e44e0172534703829a626b47b7fff7576c0fbbc39d58516b986b8556a79','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '322 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('aa26302d0e3a0931a5f91ce9f23c660a5a240cb59de1a4d5605f38638b534718','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '322 missing mcp receipt'; END IF;
END $successor$;
