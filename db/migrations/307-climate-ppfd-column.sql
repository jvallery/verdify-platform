-- 307 (#1184, ingest slice): the canopy PAR meter's column, so the ingestor stores PPFD once the firmware is flashed.
-- The firmware slice (PR #1494) adds the ESPHome sensor canopy_ppfd (par_probe, address 10 on modbus_main); the
-- ingestor maps it to climate.ppfd_umol_m2_s (ingestor/entity_map.py, verdify_schemas/telemetry.py ClimateRow).
-- 307 adds that column and appends it to the runtime write facade v_runtime_climate_write (217's options:
-- security_barrier, not security_invoker) with INSERT for verdify_ingestor_runtime. Production writes climate through
-- fn_record_climate_source_event (266), which raises on any payload column the ingestor runtime cannot INSERT through
-- the facade, so without this grant every climate row would fail once PPFD arrives. Until the meter is fitted the
-- ingestor sends no PPFD key and the column stays NULL. The DLI views, the validity ledger and their grants are not
-- touched here: DLI stays unavailable (ADR-0008) until a later migration rebinds v_dli_current and v_dli_daily.
-- Seals: the column is readable through the table-level SELECT the api, ingestor and MCP duties hold on climate, and
-- the ingestor duty gains a facade INSERT column; the rolled-back native qualification measures the successor seals.
-- 307 chains from exact306.
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=306 AND filename='db/migrations/306-vpd-envelope-sql-mirror.sql'
            AND sha256='6d87f428b317cac9b4179f191d8342d897c29bd2b3046d6e61bb41e11bc41094'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>306)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '42091d8bc52adfff17ef589ca7d71ac3a97fe37af4460b551a938f313635bb8c'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM 'c7ad6a83e598b8f6da9ebd0086c008b13cfa2812647516ecdf8a7d1b32331940'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '2c6a1cbe628ea66fafe30784189f6c9ba7c33983792a46cd7383d7dae67dc245'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.climate'::regclass
            AND attname='ppfd_umol_m2_s' AND NOT attisdropped)
        OR (SELECT reloptions FROM pg_catalog.pg_class WHERE oid='public.v_runtime_climate_write'::regclass)
            IS DISTINCT FROM ARRAY['security_barrier=true','security_invoker=false']
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='verdify_ingestor_runtime' AND NOT rolcanlogin)
    THEN RAISE EXCEPTION '307 refuses an unqualified predecessor'; END IF;
END $predecessor$;

ALTER TABLE public.climate ADD COLUMN ppfd_umol_m2_s double precision;

COMMENT ON COLUMN public.climate.ppfd_umol_m2_s IS
    'Canopy PPFD in µmol/m²/s from the RS-485 PAR quantum sensor at canopy height (Modbus address 10 on modbus_main, '
    'ESPHome sensor canopy_ppfd; #1184). NULL while the meter is absent or silent. The legacy ppfd and dli_par_today '
    'columns (013) stay unused.';

-- 217's facade with the new column appended: same columns in the same order, then ppfd_umol_m2_s.
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
       ppfd_umol_m2_s
  FROM public.climate;

GRANT INSERT (ppfd_umol_m2_s) ON public.v_runtime_climate_write TO verdify_ingestor_runtime;

-- Successor seals: the probe of the rolled-back native qualification measures them, and each receipt is re-sealed.
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '021da321ca9bfa77f5f5724a3e3d8f2e7463b4a1435e47f8b3aa81e4fb8f22ac'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '95ba4bed31a9598ddbd1f2d269d1345d205496f3dcfc784b55d9905ab3128a1e'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '2c6a1cbe628ea66fafe30784189f6c9ba7c33983792a46cd7383d7dae67dc245'
    THEN RAISE EXCEPTION '307 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('021da321ca9bfa77f5f5724a3e3d8f2e7463b4a1435e47f8b3aa81e4fb8f22ac','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '307 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('95ba4bed31a9598ddbd1f2d269d1345d205496f3dcfc784b55d9905ab3128a1e','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '307 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('2c6a1cbe628ea66fafe30784189f6c9ba7c33983792a46cd7383d7dae67dc245','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '307 missing mcp receipt'; END IF;
END $successor$;
