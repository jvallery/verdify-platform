-- 311 (#1667, plan section 9, package 1.2): one compliance definition, read the same way everywhere.
-- fn_band_compliance_5m (290) is the one definition; daily_band_compliance stores it and fn_band_compliance_store
-- copies it into daily_summary's legacy compliance and stress-hour columns, which every database reader reads. Three
-- gaps remained (#1667) and 311 closes those that touch no public-site output:
--   1. The definition break. 290's refresh fills back only to 2026-09-01, so August still carried the retired
--      grade (19 to 20 % against about 44 % on the served band). The band_house_* audit rows that grade a day reach
--      back to 2026-08-13 and setpoint_snapshot's retention is dropping them, so 311 stores every day from the first
--      local day fully covered by the audit rows still present at migration time up to 2026-08-31. Days before that
--      keep their legacy values: the public site reads them (scripts/generate-baseline-vs-iris-page.py reads
--      April 2026), so nulling them is held back (plan 8.10, RULINGS C4) for the owner's word.
--   2. Capacity. daily_band_compliance.temp_above_full_cooling_min: of the minutes above the band, those in
--      5-minute buckets with the vent, fan1 and fan2 all on for the whole bucket (equipment_state edges): time the
--      equipment could not cool. A reported count beside the grade, not a second score. Filled for every stored day.
--   3. The night. v_daily_scorecard appends night_dryout_min (305) and temp_above_full_cooling_min, so the
--      dashboard scorecard shows both (verdify_services/series.py daily keys).
-- Existing columns keep their names, order and types; nothing is dropped or renamed. daily_climate_metric_revisions
-- keeps the prior value of every daily_summary day the backfill changes.
-- No runtime seal moves: daily_band_compliance keeps no ACL entry, v_daily_scorecard keeps its grant to the
-- dashboard duty alone, the new function is verdify's with PUBLIC's EXECUTE revoked and the store is replaced in
-- place. Both blocks pin exact310's seals (309's).
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=310 AND filename='db/migrations/310-daily-record.sql'
            AND sha256='be63023b1b9d34e748252c3db991ab80f4ab262ff2f1707a8c486840eae9bb10'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>310)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR to_regprocedure('public.fn_band_dryout_night(date)') IS NULL
        OR to_regprocedure('public.fn_band_full_cooling_min(date)') IS NOT NULL
        OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.daily_band_compliance'::regclass
            AND attname='temp_above_full_cooling_min' AND NOT attisdropped)
    THEN RAISE EXCEPTION '311 refuses an unqualified predecessor'; END IF;
END $predecessor$;

CREATE FUNCTION public.fn_band_full_cooling_min(p_day date)
RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $cooling$
WITH w AS (
    SELECT p_day::timestamp AT TIME ZONE 'America/Denver' AS opens,
           (p_day + 1)::timestamp AT TIME ZONE 'America/Denver' AS closes
), hot AS (
    SELECT g.bucket
      FROM w CROSS JOIN LATERAL public.fn_band_compliance_5m(w.opens, w.closes) g
     WHERE g.temp_grade = 1
), observed AS (
    SELECT e.equipment, e.ts, bool_or(e.state) AS state
      FROM public.equipment_state e, w
     WHERE e.equipment IN ('vent', 'fan1', 'fan2') AND COALESCE(e.greenhouse_id, 'vallery') = 'vallery'
       AND e.ts >= w.opens - interval '2 days' AND e.ts < w.closes
     GROUP BY e.equipment, e.ts
    UNION ALL
    SELECT r.equipment, s.ts, s.state
      FROM (VALUES ('vent'), ('fan1'), ('fan2')) AS r(equipment)
     CROSS JOIN w
     CROSS JOIN LATERAL (
        SELECT e.ts, bool_or(e.state) AS state
          FROM public.equipment_state e
         WHERE e.equipment = r.equipment AND COALESCE(e.greenhouse_id, 'vallery') = 'vallery'
           AND e.ts < w.opens - interval '2 days'
         GROUP BY e.ts
         ORDER BY e.ts DESC
         LIMIT 1) s
), edge AS (
    SELECT o.equipment, o.ts AS on_at, lead(o.ts) OVER (PARTITION BY o.equipment ORDER BY o.ts) AS off_at, o.state
      FROM (SELECT ob.equipment, ob.ts, ob.state,
                   lag(ob.state) OVER (PARTITION BY ob.equipment ORDER BY ob.ts) AS previous_state
              FROM observed ob) o
     WHERE o.previous_state IS DISTINCT FROM o.state
)
SELECT (5 * count(*) FILTER (
           WHERE (SELECT count(DISTINCT x.equipment) FROM edge x
                   WHERE x.state AND x.on_at <= h.bucket
                     AND COALESCE(x.off_at, now()) >= h.bucket + interval '5 minutes') = 3))::integer
  FROM hot h
$cooling$;
COMMENT ON FUNCTION public.fn_band_full_cooling_min(date) IS
    'Capacity-limited heat of one America/Denver day (311, #1667): minutes in 5-minute buckets graded above the '
    'band by fn_band_compliance_5m while the vent, fan1 and fan2 were all on for the whole bucket (equipment_state '
    'edges). Time the equipment could not cool; a count beside the grade, not a score.';

ALTER TABLE public.daily_band_compliance
    ADD COLUMN temp_above_full_cooling_min integer,
    ADD CONSTRAINT daily_band_compliance_full_cooling_minutes CHECK (
        temp_above_full_cooling_min IS NULL OR temp_above_full_cooling_min BETWEEN 0 AND temp_above_min);
COMMENT ON COLUMN public.daily_band_compliance.temp_above_full_cooling_min IS
    'Of temp_above_min, the minutes with the vent and both fans on for the whole bucket (311, #1667): time the '
    'equipment could not cool. Reported beside the grade, never subtracted from it.';

CREATE OR REPLACE FUNCTION public.fn_band_compliance_store(p_day date)
RETURNS public.daily_band_compliance
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $store$
DECLARE
    stored public.daily_band_compliance;
BEGIN
    IF p_day IS NULL OR p_day > (now() AT TIME ZONE 'America/Denver')::date THEN
        RAISE EXCEPTION 'band compliance day % is not a past or current local day', p_day USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.daily_band_compliance AS t (
        date, definition, graded_min, reconstructed_min,
        temp_graded_min, temp_in_min, temp_below_min, temp_above_min,
        vpd_graded_min, vpd_in_min, vpd_below_min, vpd_above_min,
        both_graded_min, both_in_min,
        day_temp_graded_min, day_temp_in_min, night_temp_graded_min, night_temp_in_min,
        day_vpd_graded_min, day_vpd_in_min, night_vpd_graded_min, night_vpd_in_min,
        day_both_graded_min, day_both_in_min, night_both_graded_min, night_both_in_min,
        night_dryout_graded_min, night_dryout_min, temp_above_full_cooling_min, computed_at)
    SELECT p_day, 'served-band-5m-v1', d.graded_min, d.reconstructed_min,
           d.temp_graded_min, d.temp_in_min, d.temp_below_min, d.temp_above_min,
           d.vpd_graded_min, d.vpd_in_min, d.vpd_below_min, d.vpd_above_min,
           d.both_graded_min, d.both_in_min,
           d.day_temp_graded_min, d.day_temp_in_min, d.night_temp_graded_min, d.night_temp_in_min,
           d.day_vpd_graded_min, d.day_vpd_in_min, d.night_vpd_graded_min, d.night_vpd_in_min,
           d.day_both_graded_min, d.day_both_in_min, d.night_both_graded_min, d.night_both_in_min,
           n.graded_min, n.floor_min, LEAST(public.fn_band_full_cooling_min(p_day), d.temp_above_min), now()
      FROM public.fn_band_compliance_day(p_day) d
     CROSS JOIN public.fn_band_dryout_night(p_day) n
    ON CONFLICT (date) DO UPDATE SET
        definition = EXCLUDED.definition, graded_min = EXCLUDED.graded_min,
        reconstructed_min = EXCLUDED.reconstructed_min,
        temp_graded_min = EXCLUDED.temp_graded_min, temp_in_min = EXCLUDED.temp_in_min,
        temp_below_min = EXCLUDED.temp_below_min, temp_above_min = EXCLUDED.temp_above_min,
        vpd_graded_min = EXCLUDED.vpd_graded_min, vpd_in_min = EXCLUDED.vpd_in_min,
        vpd_below_min = EXCLUDED.vpd_below_min, vpd_above_min = EXCLUDED.vpd_above_min,
        both_graded_min = EXCLUDED.both_graded_min, both_in_min = EXCLUDED.both_in_min,
        day_temp_graded_min = EXCLUDED.day_temp_graded_min, day_temp_in_min = EXCLUDED.day_temp_in_min,
        night_temp_graded_min = EXCLUDED.night_temp_graded_min, night_temp_in_min = EXCLUDED.night_temp_in_min,
        day_vpd_graded_min = EXCLUDED.day_vpd_graded_min, day_vpd_in_min = EXCLUDED.day_vpd_in_min,
        night_vpd_graded_min = EXCLUDED.night_vpd_graded_min, night_vpd_in_min = EXCLUDED.night_vpd_in_min,
        day_both_graded_min = EXCLUDED.day_both_graded_min, day_both_in_min = EXCLUDED.day_both_in_min,
        night_both_graded_min = EXCLUDED.night_both_graded_min, night_both_in_min = EXCLUDED.night_both_in_min,
        night_dryout_graded_min = EXCLUDED.night_dryout_graded_min, night_dryout_min = EXCLUDED.night_dryout_min,
        temp_above_full_cooling_min = EXCLUDED.temp_above_full_cooling_min,
        computed_at = EXCLUDED.computed_at
    RETURNING t.* INTO stored;
    -- The legacy columns MCP, the planner and Grafana read become copies of this definition. A day with
    -- no summary row is left alone (the ingestor's daily task creates it); an unchanged day is not rewritten.
    UPDATE public.daily_summary s SET
        compliance_pct = stored.both_in_band_pct,
        temp_compliance_pct = stored.temp_in_band_pct,
        vpd_compliance_pct = stored.vpd_in_band_pct,
        stress_hours_heat = CASE WHEN stored.temp_graded_min > 0 THEN round(stored.temp_above_min / 60.0, 2) END,
        stress_hours_cold = CASE WHEN stored.temp_graded_min > 0 THEN round(stored.temp_below_min / 60.0, 2) END,
        stress_hours_vpd_high = CASE WHEN stored.vpd_graded_min > 0 THEN round(stored.vpd_above_min / 60.0, 2) END,
        stress_hours_vpd_low = CASE WHEN stored.vpd_graded_min > 0 THEN round(stored.vpd_below_min / 60.0, 2) END
     WHERE s.date = p_day
       AND (s.compliance_pct, s.temp_compliance_pct, s.vpd_compliance_pct,
            s.stress_hours_heat, s.stress_hours_cold, s.stress_hours_vpd_high, s.stress_hours_vpd_low)
           IS DISTINCT FROM
           (stored.both_in_band_pct, stored.temp_in_band_pct, stored.vpd_in_band_pct,
            CASE WHEN stored.temp_graded_min > 0 THEN round(stored.temp_above_min / 60.0, 2)::double precision END,
            CASE WHEN stored.temp_graded_min > 0 THEN round(stored.temp_below_min / 60.0, 2)::double precision END,
            CASE WHEN stored.vpd_graded_min > 0 THEN round(stored.vpd_above_min / 60.0, 2)::double precision END,
            CASE WHEN stored.vpd_graded_min > 0 THEN round(stored.vpd_below_min / 60.0, 2)::double precision END);
    RETURN stored;
END
$store$;
COMMENT ON FUNCTION public.fn_band_compliance_store(date) IS
    'Grade one America/Denver day with fn_band_compliance_day, its dry-out window with fn_band_dryout_night (305) '
    'and its capacity-limited heat with fn_band_full_cooling_min (311), upsert daily_band_compliance and copy the '
    'whole-day shares and below/above hours into daily_summary''s legacy compliance and stress-hour columns (290, '
    '#1358). Operator backfill, as verdify: SELECT public.fn_band_compliance_store(d::date) FROM generate_series(...) d.';
REVOKE ALL ON FUNCTION public.fn_band_full_cooling_min(date) FROM PUBLIC;

-- The definition break: every day from the first local day the audit rows still cover to 2026-08-31 that has no
-- row is stored (and copied into daily_summary). A day whose first bucket has no audit row in reach is not.
DO $backfill$
DECLARE
    first_audit timestamptz := (SELECT min(s.ts) FROM public.setpoint_snapshot s
                                 WHERE s.parameter = 'band_house_temp_low' AND s.zone = 'house'
                                   AND s.ts >= TIMESTAMPTZ '2026-08-01 00:00+00');
    v_day date;
BEGIN
    IF first_audit IS NULL THEN
        RETURN;
    END IF;
    FOR v_day IN
        SELECT d::date FROM generate_series(((first_audit + interval '600 seconds') AT TIME ZONE 'America/Denver')::date + 1,
                                            DATE '2026-08-31', interval '1 day') AS g(d)
         WHERE NOT EXISTS (SELECT 1 FROM public.daily_band_compliance b WHERE b.date = g.d::date)
         ORDER BY 1
    LOOP
        PERFORM public.fn_band_compliance_store(v_day);
    END LOOP;
END $backfill$;

-- The rows already stored get their capacity minutes: September (hot days, about 1.3 s each) apart from the rest
-- (about 0.4 s each), so no statement nears the qualifier's 120 s bound.
UPDATE public.daily_band_compliance b
   SET temp_above_full_cooling_min = LEAST(public.fn_band_full_cooling_min(b.date), b.temp_above_min)
 WHERE b.temp_above_full_cooling_min IS NULL AND b.date < DATE '2026-10-01';
UPDATE public.daily_band_compliance b
   SET temp_above_full_cooling_min = LEAST(public.fn_band_full_cooling_min(b.date), b.temp_above_min)
 WHERE b.temp_above_full_cooling_min IS NULL;

-- The scorecard reads the one definition. Existing columns keep their names, order and types; the night dry-out
-- minutes and the capacity-limited minutes are appended.
CREATE OR REPLACE VIEW public.v_daily_scorecard AS
WITH alert_origin AS MATERIALIZED (
    SELECT min(a.created_at) AS first_at FROM public.alert_log a
)
SELECT
    d.date,
    b.temp_in_band_pct,
    b.vpd_in_band_pct,
    b.both_in_band_day_pct AS time_in_band_day_pct,
    b.both_in_band_night_pct AS time_in_band_night_pct,
    CASE WHEN b.date IS NULL THEN 'not graded against the served band'
         WHEN b.both_in_band_day_pct IS NULL OR b.both_in_band_night_pct IS NULL THEN 'no graded readings'
    END AS band_reason,
    d.water_used_gal AS water_gal,
    -- daily_summary_live fills water_used_gal only when v_water_attribution_daily can score the
    -- day. v_water_meter_daily has no time bound (it windows every metered climate row and
    -- meter event: 2.5 s for a 30-day read on 2026-11-02), so the reason comes from bounded
    -- checks in its vocabulary: today is partial_day, a day with no meter reading is
    -- unavailable, and any other null day is incomplete.
    CASE WHEN d.water_used_gal IS NOT NULL THEN NULL
         WHEN d.date >= (now() AT TIME ZONE 'America/Denver')::date THEN 'partial_day'
         WHEN NOT EXISTS (SELECT 1 FROM public.climate m
                           WHERE m.ts >= d.day_start AND m.ts < d.day_end
                             AND m.water_total_gal IS NOT NULL) THEN 'unavailable'
         ELSE 'incomplete'
    END AS water_reason,
    (SELECT CASE WHEN count(*) > 0 THEN count(*) FILTER (WHERE l.status = 'plan_written') END
       FROM public.planner_trigger_ledger l
      WHERE l.event_type IN ('MIDNIGHT', 'SUNRISE', 'SUNSET')
        AND l.due_at >= d.day_start AND l.due_at < d.day_end)::integer AS iris_required_written,
    (SELECT CASE WHEN count(*) > 0 THEN count(*) FILTER (WHERE l.status IN (
                'acked', 'action_completed', 'neutral_fallback', 'wrong_action',
                'delivery_failed', 'timed_out', 'missed')) END
       FROM public.planner_trigger_ledger l
      WHERE l.event_type IN ('MIDNIGHT', 'SUNRISE', 'SUNSET')
        AND l.due_at >= d.day_start AND l.due_at < d.day_end)::integer AS iris_required_missed,
    CASE WHEN d.day_end > (SELECT o.first_at FROM alert_origin o) THEN
        (SELECT count(*) FROM public.alert_log a
          WHERE a.severity = 'critical' AND a.ts >= d.day_start AND a.ts < d.day_end)::integer
    END AS alerts_critical,
    CASE WHEN d.day_end > (SELECT o.first_at FROM alert_origin o) THEN
        (SELECT count(*) FROM public.alert_log a
          WHERE a.severity = 'warning' AND a.ts >= d.day_start AND a.ts < d.day_end)::integer
    END AS alerts_warning,
    CASE WHEN d.day_end > (SELECT o.first_at FROM alert_origin o) THEN
        (SELECT count(*) FROM public.alert_log a
          WHERE a.severity = 'info' AND a.ts >= d.day_start AND a.ts < d.day_end)::integer
    END AS alerts_info,
    d.captured_at,
    b.temp_below_band_pct,
    b.temp_above_band_pct,
    b.vpd_below_band_pct,
    b.vpd_above_band_pct,
    b.temp_in_band_day_pct,
    b.temp_in_band_night_pct,
    b.vpd_in_band_day_pct,
    b.vpd_in_band_night_pct,
    b.reconstructed_pct AS band_reconstructed_pct,
    -- 311 (#1667): the night and the capacity, beside the grade.
    b.night_dryout_min,
    b.temp_above_full_cooling_min
  FROM (SELECT s.date, s.water_used_gal, s.captured_at,
               s.date::timestamp AT TIME ZONE 'America/Denver' AS day_start,
               (s.date + 1)::timestamp AT TIME ZONE 'America/Denver' AS day_end
          FROM public.daily_summary s) d
  LEFT JOIN public.daily_band_compliance b ON b.date = d.date;
COMMENT ON VIEW public.v_daily_scorecard IS
    'Graphs scorecard (VD-56, API-04 daily.* keys): one row per daily_summary.date (America/Denver). '
    'Time in band from daily_band_compliance (290, #1358: graded against the band the controller served): '
    'temperature and VPD for the whole day with below and above, day and night per axis, and both axes by day '
    'and night (time_in_band_day_pct, time_in_band_night_pct), null with band_reason when the day is not graded; '
    'the night dry-out minutes (305) and the minutes above the band with full cooling on (311, #1667); '
    'gallons with water_reason (partial_day, unavailable or incomplete); Iris required plans written and missed; '
    'alerts raised by severity. Null means no data, never 0.';

DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='public.daily_band_compliance'::regclass
            AND c.relkind='r' AND pg_get_userbyid(c.relowner)='verdify' AND c.relacl IS NULL)
        OR EXISTS(SELECT 1 FROM aclexplode((SELECT c.relacl FROM pg_class c
                                            WHERE c.oid='public.v_daily_scorecard'::regclass)) a
            WHERE a.grantee NOT IN ((SELECT oid FROM pg_roles WHERE rolname='verdify'),
                                    (SELECT oid FROM pg_roles WHERE rolname='verdify_dashboard_runtime')))
        OR EXISTS(SELECT 1 FROM pg_proc p
            WHERE p.oid IN ('public.fn_band_full_cooling_min(date)'::regprocedure,
                            'public.fn_band_compliance_store(date)'::regprocedure)
              AND (pg_get_userbyid(p.proowner) <> 'verdify'
                   OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee <> p.proowner)))
    THEN RAISE EXCEPTION '311 changed a runtime boundary'; END IF;
END $successor$;
