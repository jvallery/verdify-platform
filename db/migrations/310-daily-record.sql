-- 310 (#1668, plan section 10): the daily record of relay starts, run time and utilities, with lost OFF events repaired.
-- The climate law is judged by time in band (290's one definition), by relay starts and run time, and by electricity,
-- gas and water. Run time today is the span between equipment_state edges, so a lost OFF event becomes hours of false
-- run time: in the 30 days before 2026-11-16 the furnace (heat2) shows 7.8 h on the night of 2026-10-24 and 6.3 h on
-- the afternoon of 2026-11-06 that its own counter says lasted about 11 minutes each. 310 adds:
--   fn_daily_record_relays()            the eleven climate and wetting relays, which carry a firmware run counter and
--                                       which use water;
--   fn_relay_run_intervals(start, end)  each relay's ON intervals overlapping [start, end), repaired:
--     * heat1, heat2, fan1, fan2, vent, fog: the firmware adds a run to its relay counter when the relay switches
--       off (equipment_counter_samples, a sample every 30 s). A counter step whose two samples both lie inside an
--       event interval, more than 60 s before its end, proves the relay went off there; so does a closing step that
--       straddles a data gap and books 120 s or more less than the interval (an OFF recovered late). The interval is
--       then rebuilt from the counter's steps, each run ending at its step and as long as the step, never before the
--       relay's previous OFF. A step no interval explains is a lost ON and becomes a run of its own. The counter is not a run-time
--       source on its own: today's firmware zeroes it at local midnight without the part of a run in progress
--       (heat1 reads 2 to 7 h a day below its power meter), so an interval with no such step keeps its edges.
--     * fog, misters and drips: an interval longer than 5 minutes ends at the first 3 minutes with no flow on the
--       water meter (climate.flow_gpm), when the counter did not already repair it.
--   daily_relay_record                  per America/Denver day and relay: starts, run seconds (repaired), the raw
--                                       event run seconds and the runs that came from a repair;
--   daily_record                        per day: metered kWh (v_energy_daily) with its coverage, furnace therms
--                                       (repaired heat2 hours x the resource_coefficients input; gas is not metered),
--                                       metered, wetting and planning gallons (v_water_attribution_daily), the
--                                       drying action time and runs (climate_action_log DEHUM_VENT) and the furnace
--                                       starts within 15 minutes after a drying run;
--   fn_daily_record_store(date)         recomputes one day into both tables;
--   v_daily_record                      one row per day: the 290 compliance, starts and run hours per relay and in
--                                       total, and the utilities: what the law is compared on;
--   verdify_matview_refresh_runtime.fn_refresh_daily_record()
--                                       the refresh the band-curve CronJob calls every 30 minutes: today, yesterday
--                                       and up to 3 missing days back to 2026-10-17 (the 30-day baseline before the
--                                       law, complete after ten runs; about 15 s a day, mostly the energy and water
--                                       views, which scan their tables).
-- Nothing existing changes: v_equipment_runtime_daily, daily_summary and their readers (Grafana, the publisher, the
-- deploy preflight) are untouched. No runtime seal moves: the relations are verdify's with no ACL entry, PUBLIC's
-- EXECUTE is revoked from every new function, and the only EXECUTE goes to the matview-refresh duty, in its own
-- schema. Both blocks pin exact309's seals.
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=309 AND filename='db/migrations/309-one-band-retirement.sql'
            AND sha256='65c356059893386dd49aa2531555875f287272e33f48aba46c6d082cfd25b0d1'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>309)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR to_regclass('public.daily_record') IS NOT NULL
        OR to_regclass('public.daily_relay_record') IS NOT NULL
        OR to_regclass('public.v_daily_record') IS NOT NULL
        OR to_regclass('public.equipment_counter_samples') IS NULL
        OR to_regclass('public.daily_band_compliance') IS NULL
        OR to_regclass('public.v_energy_daily') IS NULL
        OR to_regclass('public.v_water_attribution_daily') IS NULL
        OR to_regnamespace('verdify_matview_refresh_runtime') IS NULL
    THEN RAISE EXCEPTION '310 refuses an unqualified predecessor'; END IF;
END $predecessor$;

CREATE FUNCTION public.fn_daily_record_relays()
RETURNS TABLE (equipment text, has_counter boolean, wet boolean)
LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $relays$
VALUES ('heat1', true, false), ('heat2', true, false), ('fan1', true, false), ('fan2', true, false),
       ('vent', true, false), ('fog', true, true),
       ('mister_south', false, true), ('mister_west', false, true), ('mister_center', false, true),
       ('drip_wall', false, true), ('drip_center', false, true)
$relays$;
COMMENT ON FUNCTION public.fn_daily_record_relays() IS
    'The relays of the daily record (310): has_counter, the firmware books a run into its relay counter at each OFF '
    '(equipment_counter_samples); wet, the relay uses water, so the water meter shows when it ran.';

CREATE FUNCTION public.fn_relay_run_intervals(p_start timestamptz, p_end timestamptz)
RETURNS TABLE (equipment text, on_at timestamptz, off_at timestamptz,
               event_on_at timestamptz, event_off_at timestamptz, repair text)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $intervals$
WITH relay AS (
    SELECT r.equipment, r.has_counter, r.wet FROM public.fn_daily_record_relays() r
), observed AS (
    -- Each relay's rows from two days before the window to a day after it, and its last row before that, so an
    -- interval open at either edge keeps its true start and end.
    SELECT e.equipment, e.ts, bool_or(e.state) AS state
      FROM public.equipment_state e
     WHERE e.equipment IN (SELECT r.equipment FROM relay r)
       AND COALESCE(e.greenhouse_id, 'vallery') = 'vallery'
       AND e.ts >= p_start - interval '2 days' AND e.ts < p_end + interval '1 day'
     GROUP BY e.equipment, e.ts
    UNION ALL
    SELECT r.equipment, s.ts, s.state
      FROM relay r
     CROSS JOIN LATERAL (
        SELECT e.ts, bool_or(e.state) AS state
          FROM public.equipment_state e
         WHERE e.equipment = r.equipment AND COALESCE(e.greenhouse_id, 'vallery') = 'vallery'
           AND e.ts < p_start - interval '2 days'
         GROUP BY e.ts
         ORDER BY e.ts DESC
         LIMIT 1) s
), edge AS (
    SELECT o.equipment, o.ts, o.state,
           lead(o.ts) OVER (PARTITION BY o.equipment ORDER BY o.ts) AS next_ts
      FROM (SELECT ob.equipment, ob.ts, ob.state,
                   lag(ob.state) OVER (PARTITION BY ob.equipment ORDER BY ob.ts) AS previous_state
              FROM observed ob) o
     WHERE o.previous_state IS DISTINCT FROM o.state
), event_all AS (
    -- Every interval of the lookback, each with its relay's previous OFF: a counted run never starts before it.
    SELECT g.equipment, r.has_counter, r.wet, g.ts AS on_at,
           COALESCE(g.next_ts, LEAST(now(), p_end + interval '1 day')) AS off_at,
           lag(g.next_ts) OVER (PARTITION BY g.equipment ORDER BY g.ts) AS previous_off_at
      FROM edge g JOIN relay r USING (equipment)
     WHERE g.state
), event AS (
    SELECT ea.* FROM event_all ea WHERE ea.on_at < p_end AND ea.off_at > p_start
), sample AS (
    SELECT c.stream AS equipment, c.source_observed_at AS at, c.counter_value_minutes AS v,
           lag(c.counter_value_minutes) OVER w AS previous_v,
           lag(c.source_observed_at) OVER w AS previous_at
      FROM public.equipment_counter_samples c
     WHERE c.greenhouse_id = 'vallery'
       AND c.stream IN (SELECT r.equipment FROM relay r WHERE r.has_counter)
       AND c.source_observed_at >= p_start - interval '2 days'
       AND c.source_observed_at < p_end + interval '1 day'
    WINDOW w AS (PARTITION BY c.device_id, c.stream ORDER BY c.source_observed_at)
), step AS (
    -- A rise of the counter: one or more runs that ended between the two samples. A fall is a reset (local
    -- midnight or a reboot) and books nothing.
    SELECT s.equipment, s.at, s.previous_at, (s.v - s.previous_v) * 60.0 AS run_s
      FROM sample s
     WHERE s.previous_v IS NOT NULL AND s.v - s.previous_v > 0.05
), counted AS (
    -- A lost OFF is proved two ways. (1) A counter step whose two samples both lie inside the interval, more than
    -- 60 s before its end: the relay went off inside it. (2) The OFF arrived late, after a data gap: the closing step's
    -- samples straddle the gap and it books at least 120 s less than the interval. (2) is not trusted across local
    -- midnight or a counter reset, where the counter books only part of a run.
    SELECT ev.equipment, ev.on_at, ev.off_at, ev.previous_off_at,
           EXISTS (SELECT 1 FROM step b
                    WHERE b.equipment = ev.equipment
                      AND b.previous_at > ev.on_at
                      AND b.at < ev.off_at - interval '60 seconds')
           OR (EXISTS (SELECT 1 FROM step b
                        WHERE b.equipment = ev.equipment
                          AND b.at > ev.off_at - interval '60 seconds' AND b.at <= ev.off_at + interval '90 seconds'
                          AND b.previous_at < ev.off_at - interval '120 seconds'
                          AND b.run_s < extract(epoch FROM ev.off_at - ev.on_at) - 120)
               AND (ev.on_at AT TIME ZONE 'America/Denver')::date = (ev.off_at AT TIME ZONE 'America/Denver')::date
               AND NOT EXISTS (SELECT 1 FROM sample s
                                WHERE s.equipment = ev.equipment AND s.v < s.previous_v
                                  AND s.at > ev.on_at AND s.at <= ev.off_at + interval '90 seconds')) AS lost_off
      FROM event ev
     WHERE ev.has_counter
), flowed AS (
    SELECT ev.equipment, ev.on_at, ev.off_at,
           (SELECT min(c.ts)
              FROM public.climate c
             WHERE c.greenhouse_id = 'vallery'
               AND c.ts > ev.on_at + interval '2 minutes' AND c.ts < ev.off_at
               AND c.flow_gpm < 0.1
               AND NOT EXISTS (SELECT 1 FROM public.climate f
                                WHERE f.greenhouse_id = 'vallery'
                                  AND f.ts >= c.ts AND f.ts < c.ts + interval '3 minutes'
                                  AND (f.flow_gpm IS NULL OR f.flow_gpm >= 0.1))
               AND (SELECT count(*) FROM public.climate f
                     WHERE f.greenhouse_id = 'vallery'
                       AND f.ts >= c.ts AND f.ts < c.ts + interval '3 minutes') >= 2) AS dry_at
      FROM event ev
     WHERE ev.wet AND ev.off_at - ev.on_at > interval '5 minutes'
       AND NOT EXISTS (SELECT 1 FROM counted k
                        WHERE k.equipment = ev.equipment AND k.on_at = ev.on_at AND k.lost_off)
       -- A relay whose counter booked the whole interval at its OFF ran it, whatever the coarse flow meter showed.
       AND NOT (ev.has_counter AND EXISTS (SELECT 1 FROM step b
                    WHERE b.equipment = ev.equipment
                      AND b.at > ev.off_at - interval '60 seconds' AND b.at <= ev.off_at + interval '90 seconds'
                      AND b.run_s >= extract(epoch FROM ev.off_at - ev.on_at) - 60))
), run AS (
    SELECT ev.equipment, ev.on_at, ev.off_at, ev.on_at AS event_on_at, ev.off_at AS event_off_at, 'none'::text AS repair
      FROM event ev
     WHERE NOT EXISTS (SELECT 1 FROM counted k
                        WHERE k.equipment = ev.equipment AND k.on_at = ev.on_at AND k.lost_off)
       AND NOT EXISTS (SELECT 1 FROM flowed f
                        WHERE f.equipment = ev.equipment AND f.on_at = ev.on_at AND f.dry_at IS NOT NULL)
    UNION ALL
    -- Rebuilt from the steps: each run ends at its step and lasts what it booked, never before the relay's previous
    -- OFF (the interval's own ON edge can be a late reconnect snapshot).
    SELECT k.equipment,
           GREATEST(COALESCE(k.previous_off_at, '-infinity'::timestamptz), b.at - b.run_s * interval '1 second'),
           b.at, k.on_at, k.off_at, 'counter'
      FROM counted k
      JOIN step b ON b.equipment = k.equipment
                 AND (b.previous_at > k.on_at OR b.at > k.on_at + interval '45 seconds')
                 AND b.at <= k.off_at + interval '90 seconds'
     WHERE k.lost_off
    UNION ALL
    SELECT f.equipment, f.on_at, f.dry_at, f.on_at, f.off_at, 'flow'
      FROM flowed f
     WHERE f.dry_at IS NOT NULL
    UNION ALL
    -- A run the counter booked with no ON interval to hold it (a lost ON): it ends at the step and lasts what it
    -- booked. It has no event interval, so it adds to run_s and not to event_run_s.
    SELECT b.equipment, b.at - b.run_s * interval '1 second', b.at, NULL, NULL, 'counter_orphan'
      FROM step b
     WHERE NOT EXISTS (SELECT 1 FROM event_all ea
                        WHERE ea.equipment = b.equipment
                          AND b.at > ea.on_at AND b.previous_at < ea.off_at + interval '90 seconds')
)
SELECT r.equipment, r.on_at, r.off_at, r.event_on_at, r.event_off_at, r.repair
  FROM run r
 WHERE r.on_at < p_end AND r.off_at > p_start
 ORDER BY r.equipment, r.on_at
$intervals$;
COMMENT ON FUNCTION public.fn_relay_run_intervals(timestamptz, timestamptz) IS
    'The ON intervals of the daily-record relays overlapping [p_start, p_end), lost OFF events repaired (310, #1668). '
    'event_on_at/event_off_at: the interval between equipment_state edges. repair none: kept as recorded; counter: '
    'the firmware counter proved a lost or late OFF, so it is rebuilt from the counter''s steps; flow: a wet '
    'relay''s interval over 5 minutes ends at the first 3 minutes without flow; counter_orphan: a run the counter '
    'booked with no interval (a lost ON), event columns NULL. Unclipped: callers clip to their window.';

CREATE TABLE public.daily_relay_record (
    date          date NOT NULL,
    greenhouse_id text NOT NULL DEFAULT 'vallery' REFERENCES public.greenhouses(id),
    equipment     text NOT NULL,
    starts        integer NOT NULL CHECK (starts >= 0),
    run_s         double precision NOT NULL CHECK (run_s >= 0 AND run_s <= 90000),
    event_run_s   double precision NOT NULL CHECK (event_run_s >= 0 AND event_run_s <= 90000),
    repaired_runs integer NOT NULL CHECK (repaired_runs >= 0),
    computed_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (date, equipment)
);
COMMENT ON TABLE public.daily_relay_record IS
    'Relay starts and run time per America/Denver day (310, #1668, plan section 10): fn_relay_run_intervals clipped to '
    'the day. starts: runs that began in the day; run_s: seconds on in the day after the lost-OFF repair; event_run_s: '
    'the same from the raw equipment_state edges; repaired_runs: runs in the day that a repair produced.';

CREATE TABLE public.daily_record (
    date                        date PRIMARY KEY,
    greenhouse_id               text NOT NULL DEFAULT 'vallery' REFERENCES public.greenhouses(id),
    complete                    boolean NOT NULL,
    kwh_metered                 double precision,
    kwh_metered_24h             double precision,
    meter_coverage_pct          double precision,
    therms_est                  double precision,
    water_gal                   double precision,
    wetting_gal                 double precision,
    planning_water_gal          double precision,
    house_water_gal             double precision,
    water_complete              boolean,
    counter_sample_pct          double precision CHECK (counter_sample_pct >= 0 AND counter_sample_pct <= 100),
    drying_s                    double precision NOT NULL CHECK (drying_s >= 0 AND drying_s <= 90000),
    drying_runs                 integer NOT NULL CHECK (drying_runs >= 0),
    furnace_starts_after_drying integer NOT NULL CHECK (furnace_starts_after_drying >= 0),
    computed_at                 timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.daily_record IS
    'Utilities and drying per America/Denver day (310, plan section 10). kwh_metered: the two-channel Shelly meter '
    '(v_energy_daily.measured_kwh; partial scope, not the whole greenhouse) over the hours it reported; '
    'kwh_metered_24h: its mean watts x the day''s length, the day at full coverage, NULL when it reported under 70 % '
    'of the day (every day before 2026-10-24); therms_est: repaired heat2 hours x the furnace input of '
    'resource_coefficients / 100,000 BTU (no gas meter, decision 14); planning_water_gal: the water the law is '
    'compared on (309); water_gal: all metered water, house_water_gal (hose and hand watering) included; '
    'wetting_gal: v_water_attribution_daily climate wetting; water_complete its available_for_scoring; '
    'counter_sample_pct: heat1 counter samples against one per 30 s, below 100 the lost-OFF repair was partly blind; '
    'drying_s and drying_runs: the controller''s DEHUM_VENT action in climate_action_log (a gap '
    'over 3 minutes ends a run); furnace_starts_after_drying: heat2 starts within 15 minutes after a drying run.';

CREATE FUNCTION public.fn_daily_record_store(p_day date)
RETURNS public.daily_record
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $store$
DECLARE
    v_start timestamptz;
    v_end timestamptz;
    stored public.daily_record;
BEGIN
    IF p_day IS NULL OR p_day > (now() AT TIME ZONE 'America/Denver')::date THEN
        RAISE EXCEPTION 'daily record day % is not a past or current local day', p_day USING ERRCODE = '22023';
    END IF;
    v_start := p_day::timestamp AT TIME ZONE 'America/Denver';
    v_end := (p_day + 1)::timestamp AT TIME ZONE 'America/Denver';

    WITH run AS MATERIALIZED (
        SELECT * FROM public.fn_relay_run_intervals(v_start, v_end)
    ), event AS (
        SELECT DISTINCT r.equipment, r.event_on_at, r.event_off_at FROM run r WHERE r.event_on_at IS NOT NULL
    ), per_relay AS (
        SELECT x.equipment,
               (SELECT count(*) FROM run r
                 WHERE r.equipment = x.equipment AND r.on_at >= v_start AND r.on_at < v_end)::integer AS starts,
               COALESCE((SELECT sum(extract(epoch FROM LEAST(r.off_at, v_end) - GREATEST(r.on_at, v_start)))
                           FROM run r WHERE r.equipment = x.equipment), 0)::double precision AS run_s,
               COALESCE((SELECT sum(extract(epoch FROM LEAST(e.event_off_at, v_end) - GREATEST(e.event_on_at, v_start)))
                           FROM event e WHERE e.equipment = x.equipment), 0)::double precision AS event_run_s,
               (SELECT count(*) FROM run r WHERE r.equipment = x.equipment AND r.repair <> 'none')::integer AS repaired_runs
          FROM public.fn_daily_record_relays() x
    ), relay_rows AS (
        INSERT INTO public.daily_relay_record AS t
            (date, equipment, starts, run_s, event_run_s, repaired_runs, computed_at)
        SELECT p_day, p.equipment, p.starts, p.run_s, p.event_run_s, p.repaired_runs, now() FROM per_relay p
        ON CONFLICT (date, equipment) DO UPDATE SET
            starts = EXCLUDED.starts, run_s = EXCLUDED.run_s, event_run_s = EXCLUDED.event_run_s,
            repaired_runs = EXCLUDED.repaired_runs, computed_at = EXCLUDED.computed_at
        RETURNING t.equipment, t.run_s
    ), action AS (
        SELECT a.ts, a.climate_action = 'DEHUM_VENT' AS drying,
               lead(a.ts) OVER (ORDER BY a.ts) AS next_ts
          FROM public.climate_action_log a
         WHERE a.greenhouse_id = 'vallery' AND a.ts >= v_start - interval '1 hour' AND a.ts < v_end
    ), dry_row AS (
        SELECT d.ts, LEAST(COALESCE(d.next_ts, LEAST(v_end, now())), d.ts + interval '3 minutes') AS until
          FROM action d WHERE d.drying
    ), dry_island AS (
        SELECT d.ts, d.until,
               sum(CASE WHEN d.previous_until IS NULL OR d.ts > d.previous_until THEN 1 ELSE 0 END)
                   OVER (ORDER BY d.ts) AS island
          FROM (SELECT y.ts, y.until, lag(y.until) OVER (ORDER BY y.ts) AS previous_until FROM dry_row y) d
    ), dry_run AS (
        SELECT min(i.ts) AS began, max(i.until) AS ended FROM dry_island i GROUP BY i.island
    ), gas AS (
        SELECT rc.nominal_value
          FROM public.equipment eq
          JOIN public.resource_coefficients rc ON rc.equipment_id = eq.id
         WHERE eq.greenhouse_id = 'vallery' AND eq.slug = 'heat2' AND eq.is_active
           AND rc.resource_kind = 'gas_btu_per_hour'
           AND rc.valid_from <= v_start AND (rc.valid_to IS NULL OR rc.valid_to > v_start)
         ORDER BY rc.valid_from DESC, rc.id DESC
         LIMIT 1
    ), energy AS (
        -- The day at full coverage only when the meter reported at least 70 % of it (before 2026-10-24 it did not).
        SELECT ed.measured_kwh::double precision AS kwh,
               CASE WHEN ed.meter_coverage_pct >= 70
                    THEN ed.avg_watts * extract(epoch FROM v_end - v_start) / 3600.0 / 1000.0 END::double precision
                   AS kwh_24h,
               ed.meter_coverage_pct::double precision AS coverage
          FROM public.v_energy_daily ed
         WHERE ed.date = p_day AND ed.greenhouse_id = 'vallery'
    ), water AS (
        SELECT w.quality_filtered_meter_gal::double precision AS gal,
               w.climate_wetting_gal::double precision AS wetting,
               w.planning_water_gal::double precision AS planning,
               w.manual_or_unattributed_gal::double precision AS house,
               w.available_for_scoring AS complete
          FROM public.v_water_attribution_daily w
         WHERE w.date = p_day AND w.greenhouse_id = 'vallery'
    ), evidence AS (
        -- The heat1 counter stream, one sample per 30 s: below 100 the lost-OFF detector was partly blind.
        SELECT LEAST(100.0, count(*) * 30.0 * 100.0 / extract(epoch FROM LEAST(v_end, now()) - v_start))::double precision
                   AS counter_sample_pct
          FROM public.equipment_counter_samples c
         WHERE c.greenhouse_id = 'vallery' AND c.stream = 'heat1'
           AND c.source_observed_at >= v_start AND c.source_observed_at < v_end
    )
    INSERT INTO public.daily_record AS t (
        date, complete, kwh_metered, kwh_metered_24h, meter_coverage_pct, therms_est,
        water_gal, wetting_gal, planning_water_gal, house_water_gal, water_complete, counter_sample_pct,
        drying_s, drying_runs, furnace_starts_after_drying, computed_at)
    SELECT p_day, now() >= v_end,
           (SELECT e.kwh FROM energy e), (SELECT e.kwh_24h FROM energy e), (SELECT e.coverage FROM energy e),
           (SELECT rr.run_s / 3600.0 * g.nominal_value::double precision / 100000.0
              FROM relay_rows rr, gas g WHERE rr.equipment = 'heat2'),
           (SELECT w.gal FROM water w), (SELECT w.wetting FROM water w), (SELECT w.planning FROM water w),
           (SELECT w.house FROM water w), (SELECT w.complete FROM water w), (SELECT ev.counter_sample_pct FROM evidence ev),
           COALESCE((SELECT sum(GREATEST(extract(epoch FROM LEAST(d.until, v_end) - GREATEST(d.ts, v_start)), 0))
                       FROM dry_row d), 0),
           (SELECT count(*) FROM dry_run d WHERE d.began >= v_start)::integer,
           (SELECT count(*) FROM run r
             WHERE r.equipment = 'heat2' AND r.on_at >= v_start AND r.on_at < v_end
               AND EXISTS (SELECT 1 FROM dry_run d
                            WHERE r.on_at >= d.ended AND r.on_at < d.ended + interval '15 minutes'))::integer,
           now()
    ON CONFLICT (date) DO UPDATE SET
        complete = EXCLUDED.complete, kwh_metered = EXCLUDED.kwh_metered,
        kwh_metered_24h = EXCLUDED.kwh_metered_24h, meter_coverage_pct = EXCLUDED.meter_coverage_pct,
        therms_est = EXCLUDED.therms_est, water_gal = EXCLUDED.water_gal, wetting_gal = EXCLUDED.wetting_gal,
        planning_water_gal = EXCLUDED.planning_water_gal, house_water_gal = EXCLUDED.house_water_gal,
        water_complete = EXCLUDED.water_complete, counter_sample_pct = EXCLUDED.counter_sample_pct,
        drying_s = EXCLUDED.drying_s, drying_runs = EXCLUDED.drying_runs,
        furnace_starts_after_drying = EXCLUDED.furnace_starts_after_drying, computed_at = EXCLUDED.computed_at
    RETURNING t.* INTO stored;
    RETURN stored;
END
$store$;
COMMENT ON FUNCTION public.fn_daily_record_store(date) IS
    'Recompute one America/Denver day of the daily record (310): daily_relay_record for every relay of '
    'fn_daily_record_relays and the daily_record row, about 15 s. Operator backfill, as verdify, not while the '
    'band-curve-refresh CronJob runs (it stores newest first): SELECT public.fn_daily_record_store(d::date) FROM '
    'generate_series(CURRENT_DATE, DATE ''2026-10-17'', ''-1 day'') d.';

CREATE FUNCTION verdify_matview_refresh_runtime.fn_refresh_daily_record() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $refresh$
 DECLARE
  v_today date := (now() AT TIME ZONE 'America/Denver')::date;
  v_day date;
  v_refreshed integer := 0;
 BEGIN
  IF session_user <> 'verdify_matview_refresh_runtime_login' THEN
   RAISE EXCEPTION 'refresh caller outside duty' USING ERRCODE='42501';
  END IF;
  -- Today and yesterday every run, so yesterday closes complete after midnight; then the newest 3 days back to
  -- 2026-10-17 that have no row: the 30-day baseline before the climate law fills in ten runs (five hours). A day
  -- that fails is skipped with a warning, so one bad day never stops the rest.
  FOR v_day IN
   SELECT recent.d FROM (VALUES (v_today), (v_today - 1)) AS recent(d)
   UNION ALL
   (SELECT missing.d::date FROM generate_series(DATE '2026-10-17', v_today - 2, interval '1 day') AS missing(d)
     WHERE NOT EXISTS (SELECT 1 FROM public.daily_record r WHERE r.date = missing.d::date)
     ORDER BY missing.d DESC LIMIT 3)
  LOOP
   BEGIN
    PERFORM public.fn_daily_record_store(v_day);
    v_refreshed := v_refreshed + 1;
   EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'daily record % not stored: %', v_day, SQLERRM;
   END;
  END LOOP;
  RETURN v_refreshed;
 END $refresh$;
REVOKE ALL ON FUNCTION public.fn_daily_record_relays() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_relay_run_intervals(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_daily_record_store(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION verdify_matview_refresh_runtime.fn_refresh_daily_record() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verdify_matview_refresh_runtime.fn_refresh_daily_record() TO verdify_matview_refresh_runtime;

CREATE VIEW public.v_daily_record AS
WITH relay AS (
    SELECT r.date,
           sum(r.starts) FILTER (WHERE r.equipment IN ('heat1', 'heat2', 'fan1', 'fan2', 'vent', 'fog'))::integer
               AS starts_climate,
           round((sum(r.run_s) FILTER (WHERE r.equipment IN ('heat1', 'heat2', 'fan1', 'fan2', 'vent', 'fog'))
               / 3600.0)::numeric, 2) AS run_h_climate,
           sum(r.starts) FILTER (WHERE r.equipment IN ('mister_south', 'mister_west', 'mister_center'))::integer AS starts_misters,
           round((sum(r.run_s) FILTER (WHERE r.equipment IN ('mister_south', 'mister_west', 'mister_center')) / 3600.0)::numeric, 2) AS run_h_misters,
           round((sum(r.event_run_s - r.run_s) / 3600.0)::numeric, 2) AS lost_off_h,
           max(r.starts) FILTER (WHERE r.equipment = 'heat1') AS heat1_starts,
           round((max(r.run_s) FILTER (WHERE r.equipment = 'heat1') / 3600.0)::numeric, 2) AS heat1_run_h,
           max(r.starts) FILTER (WHERE r.equipment = 'heat2') AS heat2_starts,
           round((max(r.run_s) FILTER (WHERE r.equipment = 'heat2') / 3600.0)::numeric, 2) AS heat2_run_h,
           max(r.starts) FILTER (WHERE r.equipment = 'fan1') AS fan1_starts,
           round((max(r.run_s) FILTER (WHERE r.equipment = 'fan1') / 3600.0)::numeric, 2) AS fan1_run_h,
           max(r.starts) FILTER (WHERE r.equipment = 'fan2') AS fan2_starts,
           round((max(r.run_s) FILTER (WHERE r.equipment = 'fan2') / 3600.0)::numeric, 2) AS fan2_run_h,
           max(r.starts) FILTER (WHERE r.equipment = 'vent') AS vent_starts,
           round((max(r.run_s) FILTER (WHERE r.equipment = 'vent') / 3600.0)::numeric, 2) AS vent_run_h,
           max(r.starts) FILTER (WHERE r.equipment = 'fog') AS fog_starts,
           round((max(r.run_s) FILTER (WHERE r.equipment = 'fog') / 3600.0)::numeric, 2) AS fog_run_h,
           max(r.starts) FILTER (WHERE r.equipment = 'mister_south') AS mister_south_starts,
           round((max(r.run_s) FILTER (WHERE r.equipment = 'mister_south') / 3600.0)::numeric, 2) AS mister_south_run_h,
           max(r.starts) FILTER (WHERE r.equipment = 'mister_west') AS mister_west_starts,
           round((max(r.run_s) FILTER (WHERE r.equipment = 'mister_west') / 3600.0)::numeric, 2) AS mister_west_run_h,
           max(r.starts) FILTER (WHERE r.equipment = 'mister_center') AS mister_center_starts,
           round((max(r.run_s) FILTER (WHERE r.equipment = 'mister_center') / 3600.0)::numeric, 2) AS mister_center_run_h,
           max(r.starts) FILTER (WHERE r.equipment = 'drip_wall') AS drip_wall_starts,
           round((max(r.run_s) FILTER (WHERE r.equipment = 'drip_wall') / 3600.0)::numeric, 2) AS drip_wall_run_h,
           max(r.starts) FILTER (WHERE r.equipment = 'drip_center') AS drip_center_starts,
           round((max(r.run_s) FILTER (WHERE r.equipment = 'drip_center') / 3600.0)::numeric, 2) AS drip_center_run_h
      FROM public.daily_relay_record r
     GROUP BY r.date
)
SELECT d.date,
       d.complete,
       b.both_in_band_pct,
       b.temp_in_band_pct,
       b.vpd_in_band_pct,
       b.graded_min,
       b.night_dried_out,
       r.starts_climate, r.run_h_climate, r.starts_misters, r.run_h_misters,
       r.heat1_starts, r.heat1_run_h, r.heat2_starts, r.heat2_run_h,
       r.fan1_starts, r.fan1_run_h, r.fan2_starts, r.fan2_run_h,
       r.vent_starts, r.vent_run_h, r.fog_starts, r.fog_run_h,
       r.mister_south_starts, r.mister_south_run_h, r.mister_west_starts, r.mister_west_run_h,
       r.mister_center_starts, r.mister_center_run_h,
       r.drip_wall_starts, r.drip_wall_run_h, r.drip_center_starts, r.drip_center_run_h,
       round(d.kwh_metered::numeric, 2) AS kwh_metered,
       round(d.kwh_metered_24h::numeric, 2) AS kwh_metered_24h,
       d.meter_coverage_pct,
       round(d.therms_est::numeric, 3) AS therms_est,
       d.planning_water_gal, d.water_gal, d.house_water_gal, d.wetting_gal, d.water_complete,
       round(d.counter_sample_pct::numeric, 1) AS counter_sample_pct,
       round((d.drying_s / 3600.0)::numeric, 2) AS drying_h,
       d.drying_runs,
       d.furnace_starts_after_drying,
       r.lost_off_h,
       d.computed_at
  FROM public.daily_record d
  LEFT JOIN relay r ON r.date = d.date
  LEFT JOIN public.daily_band_compliance b ON b.date = d.date;
COMMENT ON VIEW public.v_daily_record IS
    'The daily record (310, plan section 10): one row per America/Denver day. Compliance from daily_band_compliance '
    '(290, fn_band_compliance_5m, the one definition); starts and run hours per relay after the lost-OFF repair, '
    'totals for the six climate relays (heat1, heat2, fan1, fan2, vent, fog) and the three misters (drips are '
    'irrigation, in neither total); metered kWh (kwh_metered_24h NULL under 70 % coverage), estimated therms, '
    'planning gallons (the compared figure) beside all metered and house gallons; drying action hours and runs; '
    'lost_off_h, the hours the repair removed net of runs it restored; counter_sample_pct, the repair''s evidence. '
    'Compliance is the stored grade only: a day 290 did not grade shows none. complete is false for the day in progress.';

DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR EXISTS(SELECT 1 FROM pg_class c
            WHERE c.oid IN ('public.daily_record'::regclass, 'public.daily_relay_record'::regclass,
                            'public.v_daily_record'::regclass)
              AND (pg_get_userbyid(c.relowner) <> 'verdify' OR c.relacl IS NOT NULL))
        OR EXISTS(SELECT 1 FROM pg_proc p
            WHERE p.oid IN ('public.fn_daily_record_relays()'::regprocedure,
                            'public.fn_relay_run_intervals(timestamptz,timestamptz)'::regprocedure,
                            'public.fn_daily_record_store(date)'::regprocedure,
                            'verdify_matview_refresh_runtime.fn_refresh_daily_record()'::regprocedure)
              AND (pg_get_userbyid(p.proowner) <> 'verdify'
                   OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee NOT IN (p.proowner,
                           (SELECT oid FROM pg_roles WHERE rolname='verdify_matview_refresh_runtime')))))
    THEN RAISE EXCEPTION '310 changed a runtime boundary'; END IF;
END $successor$;
