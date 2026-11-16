-- Run only inside an explicit rollback-only transaction after exact310 (#1668), as the superuser owner:
-- scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. The matview-refresh
-- login attests and runs the CronJob's new call (today, yesterday and up to 3 missing days). The owner then stores,
-- one statement each, the days the independent review checked by hand (read only on production, 2026-11-16):
--   2026-10-24/25 heat2: a lost OFF (7.8 h between edges) whose ON edge is a reconnect snapshot; the counter's runs,
--     started no earlier than the previous OFF, give 6406 s and 9562 s (raw edges 18572 s and 24262 s);
--   2026-11-01 heat1: the 25-hour day, a run over midnight split, 86189 s and 11 starts;
--   2026-11-05 fog: an OFF recovered late after a data gap, 433 s between edges, 610 s for the day;
--   2026-11-06 heat2: a lost OFF (6.3 h) and two lost ONs the counter booked: 16 starts, 11051 s, 3 repaired runs;
--   2026-11-14: the late OFFs of heat1 and heat2 at one reconnect.
-- Then: every relay has a row for each stored day; the figures above hold; exactly those days and relays carry a repair;
-- no run time exceeds its local day; the therms are the repaired furnace hours x 0.75; kWh at full coverage is NULL
-- under 70 % coverage; today is not complete and yesterday is; v_daily_record carries the same figures; and the flow
-- rule still repairs the 2026-08-08 mister_center interval. Nothing outside the rollback is written. The last line
-- reports the result.
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

SELECT (public.fn_daily_record_store(DATE '2026-10-24')).date;
SELECT (public.fn_daily_record_store(DATE '2026-10-25')).date;
SELECT (public.fn_daily_record_store(DATE '2026-11-01')).date;
SELECT (public.fn_daily_record_store(DATE '2026-11-05')).date;
SELECT (public.fn_daily_record_store(DATE '2026-11-06')).date;
SELECT (public.fn_daily_record_store(DATE '2026-11-14')).date;

DO $fixture$
DECLARE
    today date := (now() AT TIME ZONE 'America/Denver')::date;
BEGIN
    IF current_setting('record310.days')::integer < 2
       OR EXISTS(SELECT 1 FROM public.daily_record d
                  WHERE (SELECT count(*) FROM public.daily_relay_record r WHERE r.date = d.date) <> 11)
       OR NOT EXISTS(SELECT 1 FROM public.daily_record WHERE date = today AND NOT complete)
       OR NOT EXISTS(SELECT 1 FROM public.daily_record WHERE date = today - 1 AND complete)
       OR EXISTS(SELECT 1 FROM public.daily_relay_record r
                  WHERE r.run_s > extract(epoch FROM ((r.date + 1)::timestamp AT TIME ZONE 'America/Denver')
                                                    - (r.date::timestamp AT TIME ZONE 'America/Denver')) + 1
                     OR r.event_run_s > extract(epoch FROM ((r.date + 1)::timestamp AT TIME ZONE 'America/Denver')
                                                          - (r.date::timestamp AT TIME ZONE 'America/Denver')) + 1)
       OR NOT EXISTS(SELECT 1 FROM public.daily_relay_record
                      WHERE date = DATE '2026-10-24' AND equipment = 'heat2'
                        AND abs(event_run_s - 18572) <= 5 AND abs(run_s - 6406) <= 60 AND repaired_runs >= 1)
       OR NOT EXISTS(SELECT 1 FROM public.daily_relay_record
                      WHERE date = DATE '2026-10-25' AND equipment = 'heat2'
                        AND abs(event_run_s - 24262) <= 5 AND abs(run_s - 9562) <= 60 AND repaired_runs >= 1)
       OR NOT EXISTS(SELECT 1 FROM public.daily_relay_record
                      WHERE date = DATE '2026-11-01' AND equipment = 'heat1'
                        AND abs(run_s - 86189) <= 5 AND starts = 11 AND repaired_runs = 0)
       OR NOT EXISTS(SELECT 1 FROM public.daily_relay_record
                      WHERE date = DATE '2026-11-05' AND equipment = 'fog' AND abs(run_s - 610) <= 30)
       OR NOT EXISTS(SELECT 1 FROM public.daily_relay_record
                      WHERE date = DATE '2026-11-06' AND equipment = 'heat2'
                        AND starts = 16 AND abs(run_s - 11051) <= 60 AND event_run_s > 520 * 60
                        AND repaired_runs = 3)
       OR (SELECT array_agg(r.date::text || ' ' || r.equipment ORDER BY r.date, r.equipment)
             FROM public.daily_relay_record r
            WHERE r.date IN (DATE '2026-10-24', DATE '2026-10-25', DATE '2026-11-01', DATE '2026-11-05',
                             DATE '2026-11-06', DATE '2026-11-14')
              AND r.repaired_runs > 0)
          IS DISTINCT FROM ARRAY['2026-10-24 heat2', '2026-10-25 heat2', '2026-11-05 fog', '2026-11-05 heat1',
                                 '2026-11-05 vent', '2026-11-06 heat1', '2026-11-06 heat2', '2026-11-14 heat1',
                                 '2026-11-14 heat2']
       OR NOT EXISTS(SELECT 1 FROM public.daily_record d
                       JOIN public.daily_relay_record r ON r.date = d.date AND r.equipment = 'heat2'
                      WHERE d.date = DATE '2026-11-06'
                        AND abs(d.therms_est - r.run_s / 3600.0 * 0.75) < 0.001
                        AND d.kwh_metered > 20 AND d.meter_coverage_pct >= 70 AND d.kwh_metered_24h > 20
                        AND d.planning_water_gal > 0 AND d.water_gal >= d.planning_water_gal
                        AND d.counter_sample_pct > 50)
       OR EXISTS(SELECT 1 FROM public.daily_record d
                  WHERE d.kwh_metered_24h IS NOT NULL AND d.meter_coverage_pct < 70)
       OR NOT EXISTS(SELECT 1 FROM public.v_daily_record v
                       JOIN public.daily_relay_record r ON r.date = v.date AND r.equipment = 'heat2'
                      WHERE v.date = DATE '2026-11-06'
                        AND v.heat2_run_h = round((r.run_s / 3600.0)::numeric, 2) AND v.heat2_starts = 16
                        AND v.lost_off_h > 5)
       OR NOT EXISTS(SELECT 1 FROM public.fn_relay_run_intervals(
                                       TIMESTAMP '2026-08-08 00:00' AT TIME ZONE 'America/Denver',
                                       TIMESTAMP '2026-08-09 00:00' AT TIME ZONE 'America/Denver') i
                      WHERE i.equipment = 'mister_center' AND i.repair = 'flow')
    THEN RAISE EXCEPTION '310 daily record native fixture failed'; END IF;
END $fixture$;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('refresh_login_attests', 'refresh_runs', 'every_relay_has_a_row', 'today_incomplete',
                               'yesterday_complete', 'run_time_within_the_local_day', 'furnace_2026_10_24_25',
                               'heat1_2026_11_01_dst_day', 'fog_2026_11_05_late_off', 'furnace_2026_11_06_lost_on',
                               'repairs_exactly_where_reviewed', 'therms_from_repaired_hours',
                               'kwh_24h_null_under_70_pct', 'view_matches_tables', 'flow_rule_2026_08_08'),
    'refreshed_days', current_setting('record310.days')::integer,
    'refresh_ms', current_setting('record310.ms')::numeric,
    'days', (SELECT json_agg(json_build_array(v.date, v.both_in_band_pct, v.starts_climate, v.run_h_climate,
                                              v.kwh_metered_24h, v.therms_est, v.planning_water_gal, v.lost_off_h)
                             ORDER BY v.date)
               FROM public.v_daily_record v),
    'all_passed', true,
    'attested', json_build_object('matview_refresh', true))::text;
