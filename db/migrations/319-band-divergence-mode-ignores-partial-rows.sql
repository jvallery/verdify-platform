-- 319 (#1770, host release 6; #1633, #1734): v_band_device_divergence reads the newest diagnostics row that carries a
-- band_source. Since the fourth flash the controller also writes partial diagnostics rows with no band_source; when the
-- newest row of the 15-minute window was one of them, latest_mode returned NULL and the view reported 'unobservable'
-- although the controller stayed on onchip_curve (E2E CTL-28). 319 adds AND d.band_source IS NOT NULL to latest_mode;
-- every other line of the view is migration 250's. CREATE OR REPLACE keeps the view's 28 columns, its owner, its grants
-- and its comment. The view reads 'unobservable' only when no row of the window carries a band_source. No data
-- changes. Rollback: a later migration restores 250's text. 319 chains from exact318 (its sha256 and the seals 318
-- kept from 317 are bound below).
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=318 AND filename='db/migrations/318-retire-plan-cycle-lessons.sql'
            AND sha256='58910b66c5f9bcc2b771d7b3ae43e084e122e990095bd083f60647860f9368b3'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>318)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '956b9db1d8755c0c008dc16c5b4c287af021f19e63d9481ec42af14aca28d87d'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM 'd388eb9b34e866b8f33e25040cf0e0ae7a829f97cff7e13ae158a6b0613bca5d'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'aa26302d0e3a0931a5f91ce9f23c660a5a240cb59de1a4d5605f38638b534718'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        -- The view this file replaces keeps 250's 28 columns, and diagnostics keeps the column it filters on.
        OR (SELECT count(*) FROM pg_catalog.pg_attribute
             WHERE attrelid='public.v_band_device_divergence'::regclass AND attnum>0 AND NOT attisdropped)<>28
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
             WHERE attrelid='public.diagnostics'::regclass AND attname='band_source' AND NOT attisdropped)
    THEN
        RAISE EXCEPTION '319 requires exact318 and its seals';
    END IF;
END $predecessor$;

CREATE OR REPLACE VIEW public.v_band_device_divergence AS
WITH latest_mode AS (
    SELECT d.band_source
    FROM public.diagnostics d
    WHERE d.greenhouse_id = 'vallery'
      AND d.ts BETWEEN now() - interval '15 minutes' AND now()
      AND d.band_source IS NOT NULL
    ORDER BY d.ts DESC
    LIMIT 1
), mode AS (
    SELECT CASE WHEN m.band_source IN ('onchip_curve', 'dispatcher_legacy')
                THEN m.band_source ELSE 'unobservable' END AS band_source
    FROM (SELECT (SELECT band_source FROM latest_mode) AS band_source) m
), raw_legacy AS (
    SELECT DISTINCT ON (s.parameter) s.parameter, s.value::double precision AS value, s.ts
    FROM public.setpoint_snapshot s
    WHERE s.greenhouse_id = 'vallery'
      AND s.parameter IN ('temp_low', 'temp_high', 'vpd_low', 'vpd_high')
      AND s.ts BETWEEN now() - interval '15 minutes' AND now()
    ORDER BY s.parameter, s.ts DESC
), legacy AS (
    SELECT max(value) FILTER (WHERE parameter = 'temp_low') AS temp_low,
           max(value) FILTER (WHERE parameter = 'temp_high') AS temp_high,
           max(value) FILTER (WHERE parameter = 'vpd_low') AS vpd_low,
           max(value) FILTER (WHERE parameter = 'vpd_high') AS vpd_high,
           CASE WHEN count(*) = 4 THEN min(ts) END AS device_ts
    FROM raw_legacy
), dev AS (
    SELECT m.band_source,
           CASE WHEN m.band_source = 'dispatcher_legacy' THEN l.temp_low END AS temp_low,
           CASE WHEN m.band_source = 'dispatcher_legacy' THEN l.temp_high END AS temp_high,
           CASE WHEN m.band_source = 'dispatcher_legacy' THEN l.vpd_low END AS vpd_low,
           CASE WHEN m.band_source = 'dispatcher_legacy' THEN l.vpd_high END AS vpd_high,
           CASE WHEN m.band_source = 'dispatcher_legacy' THEN l.device_ts END AS device_ts
    FROM mode m CROSS JOIN legacy l
), dev_tgt AS (
    SELECT c.house_temp_target_f AS temp_target, c.house_vpd_target AS vpd_target,
           c.ts AS target_ts
    FROM public.climate c
    WHERE c.greenhouse_id = 'vallery'
      AND c.house_temp_target_f IS NOT NULL AND c.house_vpd_target IS NOT NULL
    ORDER BY c.ts DESC LIMIT 1
), db_band AS (
    SELECT temp_low, temp_high, vpd_low AS anchor_vpd_low,
           vpd_high AS anchor_vpd_high, temp_target, vpd_target
    FROM public.fn_band_setpoints(now())
), db_vpd AS (
    SELECT house_vpd_low AS vpd_low, house_vpd_high AS vpd_high
    FROM public.fn_house_vpd_control_band(now())
), db AS (
    SELECT b.temp_low, b.temp_high,
           CASE WHEN m.band_source = 'dispatcher_legacy' THEN v.vpd_low
                ELSE b.anchor_vpd_low END AS vpd_low,
           CASE WHEN m.band_source = 'dispatcher_legacy' THEN v.vpd_high
                ELSE b.anchor_vpd_high END AS vpd_high,
           b.temp_target, b.vpd_target
    FROM db_band b CROSS JOIN db_vpd v CROSS JOIN mode m
)
SELECT now() AS ts,
       dev.device_ts, age(now(), dev.device_ts) AS device_age,
       dev.temp_low AS device_temp_low, db.temp_low AS db_temp_low,
       dev.temp_low - db.temp_low AS temp_low_diff,
       dev.temp_high AS device_temp_high, db.temp_high AS db_temp_high,
       dev.temp_high - db.temp_high AS temp_high_diff,
       dev.vpd_low AS device_vpd_low, db.vpd_low AS db_vpd_low,
       dev.vpd_low - db.vpd_low AS vpd_low_diff,
       dev.vpd_high AS device_vpd_high, db.vpd_high AS db_vpd_high,
       dev.vpd_high - db.vpd_high AS vpd_high_diff,
       dev_tgt.temp_target AS device_temp_target, db.temp_target AS db_temp_target,
       dev_tgt.temp_target - db.temp_target AS temp_target_diff,
       dev_tgt.vpd_target AS device_vpd_target, db.vpd_target AS db_vpd_target,
       dev_tgt.vpd_target - db.vpd_target AS vpd_target_diff,
       dev_tgt.target_ts AS device_target_ts,
       age(now(), dev_tgt.target_ts) AS target_age,
       greatest(abs(dev.temp_low - db.temp_low), abs(dev.temp_high - db.temp_high)) AS max_temp_abs_diff,
       greatest(abs(dev.vpd_low - db.vpd_low), abs(dev.vpd_high - db.vpd_high)) AS max_vpd_abs_diff,
       abs(dev_tgt.temp_target - db.temp_target) AS temp_target_abs_diff,
       abs(dev_tgt.vpd_target - db.vpd_target) AS vpd_target_abs_diff,
       dev.band_source
FROM dev CROSS JOIN db CROSS JOIN dev_tgt;

-- Successor seals: measured by the native probe, because the view is in a runtime's readable set.
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'b227cdf249d50b28bd110be2e994aa58ef27b546dc508b56b912093d790e70fd'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '12d74c04e3f189f324dba042cfe0948bd794be63f64b84dc12e0dcdc8a51828c'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'aa26302d0e3a0931a5f91ce9f23c660a5a240cb59de1a4d5605f38638b534718'
    THEN RAISE EXCEPTION '319 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('b227cdf249d50b28bd110be2e994aa58ef27b546dc508b56b912093d790e70fd','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '319 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('12d74c04e3f189f324dba042cfe0948bd794be63f64b84dc12e0dcdc8a51828c','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '319 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('aa26302d0e3a0931a5f91ce9f23c660a5a240cb59de1a4d5605f38638b534718','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '319 missing mcp receipt'; END IF;
    IF EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
    THEN RAISE EXCEPTION '319 receipts do not match the successor seals'; END IF;
END $successor$;
