-- 308 (#1184, DLI slice): interior crop DLI from the canopy PAR meter's PPFD (climate.ppfd_umol_m2_s, migration 307).
-- v_dli_current and v_dli_daily keep their ten columns, names, types and order (v_greenhouse_now, v_daily_kpi and the
-- other dependent views, and 268's per-login wrappers, read them), and now integrate canopy PPFD into mol/m2/day over
-- the America/Denver day with provenance par_quantum_sensor_canopy. They never read lux, dli_today,
-- daily_summary.dli_final or the unused 013 ppfd/dli_par_today columns for a value; forensic_proxy_present still says
-- whether the legacy proxy exists.
--
-- Integration: each PPFD sample holds its value until the next PPFD sample, for at most 120 s and never past the end of
-- the window. DLI = sum(ppfd x held seconds) / 1e6. Coverage = the held seconds over the window's seconds (82,800,
-- 86,400 or 90,000 for a whole day; local midnight to now for today). Climate rows arrive every 61-65 s (measured
-- 2026-11-01..06), so 1-minute buckets would cover only 95-96 % of a day; the 120 s hold covers that cadence fully and
-- leaves a real outage uncovered after its first 120 s.
--   v_dli_daily, per daily_summary date: available only when the ledger is available at local noon, the day has ended
--     and coverage is at least 98 %; otherwise NULL with source_day_incomplete, validity_contract_missing, the ledger's
--     reason, source_reading_missing (no PPFD sample that day), source_coverage_low, or fn_dli_source_invalid_reason.
--     So the first available day is the first FULL local day of PPFD coverage. The aggregate is a LATERAL bounded by
--     that day and gated on the ledger, so days before the PAR interval scan no climate rows.
--   v_dli_current, today so far: available when the ledger is available now, the newest PPFD sample today is at most
--     300 s old and coverage since local midnight is at least 98 %; reasons source_reading_missing,
--     source_reading_stale, source_coverage_low. ts is the newest PPFD sample today, else the newest climate row. So a
--     meter fitted mid-day reads available from the next local midnight.
-- With no PPFD rows (the meter is not fitted yet) both views stay unavailable with source_reading_missing.
--
-- Ledger (dli_validity_intervals, 195): dli-validity-v1 closes at this transaction's now() and keeps its history;
-- dli-validity-v2-par opens at the same instant, available and operator-validated (decisions Round 2 item 10). 195's
-- fail-closed CHECK dli_validity_release_unavailable is replaced by dli_validity_release_par_only: only the PAR source
-- may be available, so ordinary DML still cannot activate any other source.
-- Grants: the dashboard duty (verdify_dashboard_runtime, 282) reads both views, the eight ledger columns 217 grants the
-- api and ingestor duties, and fn_dli_validity, which the views call with the reader's rights.
-- 308 chains from exact307; the successor seals are 307's until the rolled-back native qualification measures them.
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=307 AND filename='db/migrations/307-climate-ppfd-column.sql'
            AND sha256='8f6b6c9baaa5652d89bf6a48b3cd503df1c14d360181e0f1bfdbe0e53349d544'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>307)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '021da321ca9bfa77f5f5724a3e3d8f2e7463b4a1435e47f8b3aa81e4fb8f22ac'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '95ba4bed31a9598ddbd1f2d269d1345d205496f3dcfc784b55d9905ab3128a1e'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '2c6a1cbe628ea66fafe30784189f6c9ba7c33983792a46cd7383d7dae67dc245'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.climate'::regclass
            AND attname='ppfd_umol_m2_s' AND NOT attisdropped)
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.dli_validity_intervals'::regclass
            AND conname='dli_validity_release_unavailable')
        OR (SELECT count(*) FROM public.dli_validity_intervals) <> 1
        OR NOT EXISTS(SELECT 1 FROM public.dli_validity_intervals WHERE greenhouse_id='vallery'
            AND validity_revision='dli-validity-v1' AND valid_to IS NULL AND availability='unavailable')
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='verdify_dashboard_runtime' AND NOT rolcanlogin)
    THEN RAISE EXCEPTION '308 refuses an unqualified predecessor'; END IF;
END $predecessor$;

-- The views first, then the ledger: readers lock a DLI view before the ledger table its validity call reads.
CREATE OR REPLACE VIEW public.v_dli_current AS
WITH latest AS (
    SELECT DISTINCT ON (COALESCE(c.greenhouse_id, 'vallery'))
        c.ts,
        COALESCE(c.greenhouse_id, 'vallery') AS greenhouse_id,
        c.dli_today IS NOT NULL AS forensic_proxy_present
    FROM public.climate c
    ORDER BY COALESCE(c.greenhouse_id, 'vallery'), c.ts DESC
), today AS (
    SELECT
        l.ts,
        l.greenhouse_id,
        l.forensic_proxy_present,
        date_trunc('day', now() AT TIME ZONE 'America/Denver') AT TIME ZONE 'America/Denver' AS day_start,
        now() AS window_end
    FROM latest l
), graded AS (
    SELECT
        t.ts,
        t.greenhouse_id,
        t.forensic_proxy_present,
        t.day_start,
        t.window_end,
        v.availability AS ledger_availability,
        v.unavailable_reason AS ledger_reason,
        v.provenance,
        v.validity_revision,
        v.valid_from,
        v.valid_to,
        p.samples,
        p.newest_ts,
        p.covered_s,
        p.dli
    FROM today t
    LEFT JOIN LATERAL public.fn_dli_validity(t.window_end, t.greenhouse_id) v ON true
    LEFT JOIN LATERAL (
        SELECT
            count(*) AS samples,
            max(s.ts) AS newest_ts,
            sum(s.held_s) AS covered_s,
            sum(s.ppfd * s.held_s) / 1e6::double precision AS dli
        FROM (
            SELECT
                c.ts,
                c.ppfd_umol_m2_s AS ppfd,
                extract(epoch FROM LEAST(
                    lead(c.ts) OVER (ORDER BY c.ts),
                    t.window_end,
                    c.ts + interval '120 seconds'
                ) - c.ts)::double precision AS held_s
            FROM public.climate c
            WHERE c.ts >= t.day_start
              AND c.ts < t.window_end
              AND COALESCE(c.greenhouse_id, 'vallery') = t.greenhouse_id
              AND c.ppfd_umol_m2_s IS NOT NULL
              AND v.availability = 'available'
        ) s
    ) p ON true
), reasoned AS (
    SELECT
        g.*,
        CASE
            WHEN g.ledger_availability IS NULL THEN 'validity_contract_missing'
            WHEN g.ledger_availability <> 'available' THEN g.ledger_reason
            WHEN COALESCE(g.samples, 0) = 0 THEN 'source_reading_missing'
            WHEN g.newest_ts < g.window_end - interval '300 seconds' THEN 'source_reading_stale'
            WHEN g.covered_s < 0.98 * extract(epoch FROM g.window_end - g.day_start)::double precision
                THEN 'source_coverage_low'
            ELSE public.fn_dli_source_invalid_reason(g.dli)
        END AS reason
    FROM graded g
)
SELECT
    COALESCE(r.newest_ts, r.ts)::timestamptz AS ts,
    r.greenhouse_id::text AS greenhouse_id,
    (CASE WHEN r.reason IS NULL THEN r.dli END)::double precision AS crop_dli_mol_m2_day,
    (CASE WHEN r.reason IS NULL THEN 'available' ELSE 'unavailable' END)::text AS availability,
    r.reason::text AS unavailable_reason,
    COALESCE(r.provenance, 'unknown_unvalidated_source')::text AS provenance,
    COALESCE(r.validity_revision, 'missing')::text AS validity_revision,
    r.valid_from::timestamptz AS valid_from,
    r.valid_to::timestamptz AS valid_to,
    r.forensic_proxy_present::boolean AS forensic_proxy_present
FROM reasoned r;

COMMENT ON VIEW public.v_dli_current IS
'Current interior crop DLI (migration 308, #1184): today''s running DLI in mol/m2/day from canopy PPFD (climate.ppfd_umol_m2_s, provenance par_quantum_sensor_canopy). Each PPFD sample holds until the next one, at most 120 s; available when the validity ledger is available now, the newest PPFD sample is at most 300 s old and the held time covers at least 98 % of the time since America/Denver midnight. Otherwise NULL with source_reading_missing, source_reading_stale, source_coverage_low, a source-range reason or the ledger''s reason. Never a lux, legacy accumulator or outdoor proxy.';

CREATE OR REPLACE VIEW public.v_dli_daily AS
WITH day_bounds AS (
    SELECT
        ds.date,
        COALESCE(ds.greenhouse_id, 'vallery') AS greenhouse_id,
        ds.dli_final IS NOT NULL AS forensic_proxy_present,
        ds.date::timestamp AT TIME ZONE 'America/Denver' AS day_start,
        (ds.date + 1)::timestamp AT TIME ZONE 'America/Denver' AS day_end
    FROM public.daily_summary ds
    WHERE ds.date IS NOT NULL
), graded AS (
    SELECT
        d.date,
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
    LEFT JOIN LATERAL public.fn_dli_validity(d.day_start + interval '12 hours', d.greenhouse_id) v ON true
    LEFT JOIN LATERAL (
        SELECT
            count(*) AS samples,
            sum(s.held_s) AS covered_s,
            sum(s.ppfd * s.held_s) / 1e6::double precision AS dli
        FROM (
            SELECT
                c.ppfd_umol_m2_s AS ppfd,
                extract(epoch FROM LEAST(
                    lead(c.ts) OVER (ORDER BY c.ts),
                    d.day_end,
                    c.ts + interval '120 seconds'
                ) - c.ts)::double precision AS held_s
            FROM public.climate c
            WHERE c.ts >= d.day_start
              AND c.ts < d.day_end
              AND COALESCE(c.greenhouse_id, 'vallery') = d.greenhouse_id
              AND c.ppfd_umol_m2_s IS NOT NULL
              AND v.availability = 'available'
              AND d.day_end <= now()
        ) s
    ) p ON true
), reasoned AS (
    SELECT
        g.*,
        CASE
            WHEN g.day_end > now() THEN 'source_day_incomplete'
            WHEN g.ledger_availability IS NULL THEN 'validity_contract_missing'
            WHEN g.ledger_availability <> 'available' THEN g.ledger_reason
            WHEN COALESCE(g.samples, 0) = 0 THEN 'source_reading_missing'
            WHEN g.covered_s < 0.98 * extract(epoch FROM g.day_end - g.day_start)::double precision
                THEN 'source_coverage_low'
            ELSE public.fn_dli_source_invalid_reason(g.dli)
        END AS reason
    FROM graded g
)
SELECT
    r.date::date AS date,
    r.greenhouse_id::text AS greenhouse_id,
    (CASE WHEN r.reason IS NULL THEN r.dli END)::double precision AS crop_dli_mol_m2_day,
    (CASE WHEN r.reason IS NULL THEN 'available' ELSE 'unavailable' END)::text AS availability,
    r.reason::text AS unavailable_reason,
    COALESCE(r.provenance, 'unknown_unvalidated_source')::text AS provenance,
    COALESCE(r.validity_revision, 'missing')::text AS validity_revision,
    r.valid_from::timestamptz AS valid_from,
    r.valid_to::timestamptz AS valid_to,
    r.forensic_proxy_present::boolean AS forensic_proxy_present
FROM reasoned r;

COMMENT ON VIEW public.v_dli_daily IS
'Daily interior crop DLI (migration 308, #1184) in mol/m2/day from canopy PPFD (climate.ppfd_umol_m2_s, provenance par_quantum_sensor_canopy), one row per daily_summary date. Each PPFD sample holds until the next one, at most 120 s; a day is available only when the validity ledger is available at local noon, the America/Denver day has ended and the held time covers at least 98 % of it, so the first available day is the first full local day of PPFD coverage. Otherwise NULL with source_day_incomplete, source_reading_missing, source_coverage_low, a source-range reason or the ledger''s reason; a gap is never 0.';

-- The ledger: replace 195's fail-closed CHECK, close v1 and open the PAR interval at the same instant.
ALTER TABLE public.dli_validity_intervals DROP CONSTRAINT dli_validity_release_unavailable;
ALTER TABLE public.dli_validity_intervals ADD CONSTRAINT dli_validity_release_par_only CHECK (
    availability = 'unavailable'
    OR (provenance = 'par_quantum_sensor_canopy' AND validity_revision = 'dli-validity-v2-par')
);

UPDATE public.dli_validity_intervals
   SET valid_to = now()
 WHERE greenhouse_id = 'vallery' AND validity_revision = 'dli-validity-v1' AND valid_to IS NULL;

INSERT INTO public.dli_validity_intervals (
    greenhouse_id, valid_from, valid_to, availability, unavailable_reason, provenance, validity_revision,
    operator_validated, created_by
) VALUES (
    'vallery', now(), NULL, 'available', NULL, 'par_quantum_sensor_canopy', 'dli-validity-v2-par', true,
    'migration_308'
);

COMMENT ON TABLE public.dli_validity_intervals IS
'Validity ledger for interior crop DLI. dli-validity-v1 (195, the broken interior sensor and its proxies) is unavailable and closed by migration 308; dli-validity-v2-par (308, #1184) is the canopy PAR quantum sensor, available and operator-validated. CHECK dli_validity_release_par_only lets only that PAR interval be available, so ordinary DML cannot activate another source; v_dli_current and v_dli_daily still need PPFD coverage before they report a value. This is a schema invariant, not DB-role privilege separation.';

GRANT SELECT ON public.v_dli_current, public.v_dli_daily TO verdify_dashboard_runtime;
GRANT SELECT (greenhouse_id, valid_from, valid_to, availability, unavailable_reason, provenance, validity_revision,
              operator_validated)
    ON public.dli_validity_intervals TO verdify_dashboard_runtime;
GRANT EXECUTE ON FUNCTION public.fn_dli_validity(timestamptz, text) TO verdify_dashboard_runtime;

-- Successor seals: the probe of the rolled-back native qualification measures them, and each receipt is re-sealed.
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '021da321ca9bfa77f5f5724a3e3d8f2e7463b4a1435e47f8b3aa81e4fb8f22ac'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '95ba4bed31a9598ddbd1f2d269d1345d205496f3dcfc784b55d9905ab3128a1e'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '2c6a1cbe628ea66fafe30784189f6c9ba7c33983792a46cd7383d7dae67dc245'
    THEN RAISE EXCEPTION '308 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('021da321ca9bfa77f5f5724a3e3d8f2e7463b4a1435e47f8b3aa81e4fb8f22ac','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '308 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('95ba4bed31a9598ddbd1f2d269d1345d205496f3dcfc784b55d9905ab3128a1e','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '308 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('2c6a1cbe628ea66fafe30784189f6c9ba7c33983792a46cd7383d7dae67dc245','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '308 missing mcp receipt'; END IF;
END $successor$;
