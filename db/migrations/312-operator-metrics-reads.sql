-- 312 (#1633, package 6): the operator API's product metrics read the daily record, the compliance store and the
-- power meter. The operator API reads as verdify_dashboard_runtime; its utilities and compliance metric groups need:
--   daily_band_compliance  290's stored grade per America/Denver day (311's capacity minutes included);
--   daily_record           310's per-day utilities: metered kWh and its coverage, furnace therms, gallons;
--   energy                 the power meter's newest row: kWh today, ch0/ch1 power, source time and quality.
-- 312 grants SELECT on daily_band_compliance and daily_record to verdify_dashboard_runtime and nothing else.
-- energy is read through v_dashboard_energy, a column projection owned by verdify and granted SELECT to
-- verdify_dashboard_runtime alone: energy already carries ACL entries for verdify_ingestor_runtime and
-- verdify_mcp_runtime, so the ordinary digest (309) hashes its whole relacl and a grant on the table itself would
-- move the api and ingestor seals. The view leaves energy's ACL as it is, and has no api, ingestor, MCP or PUBLIC
-- entry and no protected name, so no digest takes it in. daily_band_compliance (relacl NULL since 290) and
-- daily_record (relacl NULL since 310) are in no digest's closure either, and gaining a dashboard-only entry keeps
-- them out. No runtime seal moves and no receipt is re-sealed. Both blocks pin exact311's seals (309's).
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=311 AND filename='db/migrations/311-one-compliance-definition.sql'
            AND sha256='b53904cde320fc4a2543017c4d5733bc31528fd4a4c57e8c68e940b394c935f7'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>311)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='verdify_dashboard_runtime' AND NOT rolcanlogin)
        OR EXISTS(SELECT 1 FROM pg_class c
            WHERE c.oid IN ('public.daily_band_compliance'::regclass, 'public.daily_record'::regclass)
              AND (c.relkind <> 'r' OR pg_get_userbyid(c.relowner) <> 'verdify' OR c.relacl IS NOT NULL))
        OR EXISTS(SELECT 1 FROM aclexplode((SELECT c.relacl FROM pg_class c WHERE c.oid='public.energy'::regclass)) a
            WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname='verdify_dashboard_runtime'))
        OR to_regclass('public.v_dashboard_energy') IS NOT NULL
    THEN RAISE EXCEPTION '312 refuses an unqualified predecessor'; END IF;
END $predecessor$;

CREATE VIEW public.v_dashboard_energy AS
SELECT e.ts, e.greenhouse_id, e.kwh_today, e.ch0_power_w, e.ch1_power_w,
       e.ch0_source_ts, e.ch1_source_ts, e.ch0_quality, e.ch1_quality
  FROM public.energy e;
COMMENT ON VIEW public.v_dashboard_energy IS
    'The power meter for the operator API''s product metrics (312, package 6): kWh today, per-channel power, '
    'source time and quality per energy row. verdify''s, SELECT to verdify_dashboard_runtime alone, so energy''s '
    'own ACL (and with it the api and ingestor seals) is unchanged.';

GRANT SELECT ON public.daily_band_compliance, public.daily_record, public.v_dashboard_energy
    TO verdify_dashboard_runtime;

DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        -- Each of the three carries exactly its owner's entry and one SELECT for the dashboard duty.
        OR EXISTS(SELECT 1 FROM pg_class c
            WHERE c.oid IN ('public.daily_band_compliance'::regclass, 'public.daily_record'::regclass,
                            'public.v_dashboard_energy'::regclass)
              AND (pg_get_userbyid(c.relowner) <> 'verdify'
                   OR (SELECT count(*) FROM aclexplode(c.relacl) a WHERE a.grantee <> c.relowner) <> 1
                   OR NOT EXISTS(SELECT 1 FROM aclexplode(c.relacl) a
                       WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname='verdify_dashboard_runtime')
                         AND a.privilege_type='SELECT' AND NOT a.is_grantable)))
        OR EXISTS(SELECT 1 FROM pg_attribute t
            WHERE t.attrelid IN ('public.daily_band_compliance'::regclass, 'public.daily_record'::regclass,
                                 'public.v_dashboard_energy'::regclass)
              AND t.attnum > 0 AND t.attacl IS NOT NULL)
        OR EXISTS(SELECT 1 FROM aclexplode((SELECT c.relacl FROM pg_class c WHERE c.oid='public.energy'::regclass)) a
            WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname='verdify_dashboard_runtime'))
    THEN RAISE EXCEPTION '312 changed a runtime boundary'; END IF;
END $successor$;
