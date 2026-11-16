-- Run only inside an explicit rollback-only transaction after exact310 (#1668), as the superuser owner:
-- scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. The matview-refresh
-- login attests and runs the CronJob's new call (today, yesterday and up to 8 missing days). The owner then stores the
-- two days with a known lost OFF event: the furnace (heat2) shows 7.8 h from 2026-10-25 02:25Z and 6.3 h from
-- 2026-11-06 17:47Z between its equipment_state edges, and its firmware counter booked a run of about 11 minutes
-- inside each. Then: every relay has a row for each stored day; the two furnace intervals are repaired (2026-11-06:
-- 525 event minutes to under 170; 2026-10-24: 309 to under 110) and nothing else on those days is; heat1 keeps its
-- event run time; run time never exceeds the day; the 2026-11-06 therms are the repaired furnace hours x 0.75; today
-- is not complete and yesterday is; v_daily_record carries the same figures. Read only on production, 2026-11-16.
-- Nothing outside the rollback is written. The last line reports the result.
SET SESSION AUTHORIZATION verdify_matview_refresh_runtime_login;
DO $refresh$
DECLARE started timestamptz := clock_timestamp();
BEGIN
    IF verdify_matview_refresh_runtime.fn_attest_login() IS NOT TRUE THEN
        RAISE EXCEPTION '310 matview-refresh login does not attest';
    END IF;
    PERFORM set_config('record310.days', verdify_matview_refresh_runtime.fn_refresh_daily_record()::text, true);
    PERFORM set_config('record310.ms', round(extract(epoch FROM clock_timestamp() - started) * 1000)::text, true);
END $refresh$;
RESET SESSION AUTHORIZATION;

SELECT public.fn_daily_record_store(DATE '2026-10-24'), public.fn_daily_record_store(DATE '2026-11-06');

DO $fixture$
DECLARE
    today date := (now() AT TIME ZONE 'America/Denver')::date;
BEGIN
    IF current_setting('record310.days')::integer < 2
       OR EXISTS(SELECT 1 FROM public.daily_record d
                  WHERE (SELECT count(*) FROM public.daily_relay_record r WHERE r.date = d.date) <> 11)
       OR NOT EXISTS(SELECT 1 FROM public.daily_record WHERE date = today AND NOT complete)
       OR NOT EXISTS(SELECT 1 FROM public.daily_record WHERE date = today - 1 AND complete)
       OR EXISTS(SELECT 1 FROM public.daily_relay_record WHERE run_s > 90000 OR event_run_s > 90000)
       OR NOT EXISTS(SELECT 1 FROM public.daily_relay_record
                      WHERE date = DATE '2026-11-06' AND equipment = 'heat2'
                        AND event_run_s > 520 * 60 AND run_s < 170 * 60 AND repaired_runs >= 1)
       OR NOT EXISTS(SELECT 1 FROM public.daily_relay_record
                      WHERE date = DATE '2026-10-24' AND equipment = 'heat2'
                        AND event_run_s > 300 * 60 AND run_s < 110 * 60 AND repaired_runs >= 1)
       OR EXISTS(SELECT 1 FROM public.daily_relay_record
                  WHERE date IN (DATE '2026-10-24', DATE '2026-11-06') AND equipment <> 'heat2'
                    AND (repaired_runs <> 0 OR run_s <> event_run_s))
       OR NOT EXISTS(SELECT 1 FROM public.daily_relay_record
                      WHERE date = DATE '2026-11-06' AND equipment = 'heat1' AND run_s > 1200 * 60)
       OR NOT EXISTS(SELECT 1 FROM public.daily_record d
                       JOIN public.daily_relay_record r ON r.date = d.date AND r.equipment = 'heat2'
                      WHERE d.date = DATE '2026-11-06'
                        AND abs(d.therms_est - r.run_s / 3600.0 * 0.75) < 0.001
                        AND d.kwh_metered > 20 AND d.meter_coverage_pct > 80 AND d.water_gal > 0)
       OR NOT EXISTS(SELECT 1 FROM public.v_daily_record v
                       JOIN public.daily_relay_record r ON r.date = v.date AND r.equipment = 'heat2'
                      WHERE v.date = DATE '2026-11-06'
                        AND v.heat2_run_h = round((r.run_s / 3600.0)::numeric, 2)
                        AND v.lost_off_h > 6)
    THEN RAISE EXCEPTION '310 daily record native fixture failed'; END IF;
END $fixture$;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('refresh_login_attests', 'refresh_runs', 'every_relay_has_a_row', 'today_incomplete',
                               'yesterday_complete', 'run_time_within_the_day', 'furnace_2026_11_06_repaired',
                               'furnace_2026_10_24_repaired', 'nothing_else_repaired', 'heat1_keeps_event_time',
                               'therms_from_repaired_hours', 'view_matches_tables'),
    'refreshed_days', current_setting('record310.days')::integer,
    'refresh_ms', current_setting('record310.ms')::numeric,
    'days', (SELECT json_agg(json_build_array(v.date, v.both_in_band_pct, v.starts_climate, v.run_h_climate,
                                              v.kwh_metered_24h, v.therms_est, v.water_gal, v.lost_off_h)
                             ORDER BY v.date)
               FROM public.v_daily_record v),
    'all_passed', true,
    'attested', json_build_object('matview_refresh', true))::text;
