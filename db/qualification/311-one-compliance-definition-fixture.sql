-- Run only inside an explicit rollback-only transaction after exact311 (#1667), as the superuser owner:
-- scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. The migration has
-- stored August from the first day the band_house_* audit rows still cover and filled the capacity minutes of
-- every stored day. The matview-refresh login attests and runs the CronJob's call, which now stores the capacity
-- minutes with the rest of the day. Then: no stored day from 2026-08-20 on lacks a row (so the 2026-09-01 break is
-- gone back to at least 08-20, the newest day retention could have reached); the stored August days were graded
-- against audit rows (at most 60 reconstructed minutes) and daily_summary carries their figure; every stored day
-- has capacity minutes no larger than its minutes above the band; 2026-09-04 and 2026-09-08, read only on
-- production on 2026-11-16 at 295 and 285 minutes, are within 15 of that; a winter day with no minute above the
-- band has none; and the dashboard login reads every scorecard column, 210 night dry-out minutes on 2026-11-11
-- (#1667 acceptance) included. Nothing outside the rollback is written. The last line reports the result.
SET SESSION AUTHORIZATION verdify_matview_refresh_runtime_login;
DO $refresh$
BEGIN
    IF verdify_matview_refresh_runtime.fn_attest_login() IS NOT TRUE THEN
        RAISE EXCEPTION '311 matview-refresh login does not attest';
    END IF;
    PERFORM set_config('compliance311.days', verdify_matview_refresh_runtime.fn_refresh_band_compliance()::text, true);
END $refresh$;
RESET SESSION AUTHORIZATION;

DO $fixture$
DECLARE
    today date := (now() AT TIME ZONE 'America/Denver')::date;
BEGIN
    IF current_setting('compliance311.days')::integer < 2
       OR EXISTS(SELECT 1 FROM generate_series(DATE '2026-08-20', today - 1, interval '1 day') g(d)
                  WHERE NOT EXISTS(SELECT 1 FROM public.daily_band_compliance b WHERE b.date = g.d::date))
       OR EXISTS(SELECT 1 FROM public.daily_band_compliance b
                  WHERE b.date < DATE '2026-09-01' AND b.reconstructed_min > 60)
       OR EXISTS(SELECT 1 FROM public.daily_band_compliance b JOIN public.daily_summary s ON s.date = b.date
                  WHERE b.date < DATE '2026-09-01'
                    AND s.compliance_pct IS DISTINCT FROM b.both_in_band_pct)
       OR (SELECT avg(b.both_in_band_pct) FROM public.daily_band_compliance b
            WHERE b.date BETWEEN DATE '2026-08-20' AND DATE '2026-08-31') < 35
       OR EXISTS(SELECT 1 FROM public.daily_band_compliance b
                  WHERE b.date < today
                    AND (b.temp_above_full_cooling_min IS NULL OR b.temp_above_full_cooling_min > b.temp_above_min))
       OR NOT EXISTS(SELECT 1 FROM public.daily_band_compliance b
                      WHERE b.date = DATE '2026-09-04' AND b.temp_above_full_cooling_min BETWEEN 280 AND 310)
       OR NOT EXISTS(SELECT 1 FROM public.daily_band_compliance b
                      WHERE b.date = DATE '2026-09-08' AND b.temp_above_full_cooling_min BETWEEN 270 AND 300)
       OR NOT EXISTS(SELECT 1 FROM public.daily_band_compliance b
                      WHERE b.date = DATE '2026-11-11' AND b.temp_above_min = 0
                        AND b.temp_above_full_cooling_min = 0)
    THEN RAISE EXCEPTION '311 one compliance definition native fixture failed'; END IF;
END $fixture$;

-- SET SESSION AUTHORIZATION needs the superuser owner; the rollback undoes it.
SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;
DO $dashboard$
BEGIN
    IF verdify_dashboard_runtime.fn_attest_login() IS NOT TRUE THEN
        RAISE EXCEPTION '311 dashboard login does not attest';
    END IF;
    -- Every column: a view's unused columns plan away, and with them the reads they make.
    PERFORM * FROM public.v_daily_scorecard v
      WHERE v.date >= (now() AT TIME ZONE 'America/Denver')::date - 3;
    IF NOT FOUND THEN RAISE EXCEPTION '311 dashboard login read no scorecard rows'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.v_daily_scorecard v
                   WHERE v.date = DATE '2026-11-11' AND v.night_dryout_min = 210
                     AND v.temp_above_full_cooling_min = 0) THEN
        RAISE EXCEPTION '311 dashboard scorecard lacks the 2026-11-11 night minutes';
    END IF;
END $dashboard$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('refresh_login_attests', 'refresh_runs', 'no_break_from_08_20',
                               'august_graded_on_audit_rows', 'summary_copied', 'august_mean_served_band',
                               'capacity_filled_and_bounded', 'capacity_2026_09_04', 'capacity_2026_09_08',
                               'capacity_zero_without_heat', 'dashboard_login_attests',
                               'dashboard_login_reads_every_column', 'night_minutes_2026_11_11'),
    'refreshed_days', current_setting('compliance311.days')::integer,
    'first_stored_day', (SELECT min(date) FROM public.daily_band_compliance),
    'august', (SELECT json_agg(json_build_array(date, both_in_band_pct, reconstructed_min, temp_above_min,
                                                temp_above_full_cooling_min) ORDER BY date)
                 FROM public.daily_band_compliance WHERE date < DATE '2026-09-01'),
    'all_passed', true,
    'attested', json_build_object('matview_refresh', true, 'dashboard', true))::text;
