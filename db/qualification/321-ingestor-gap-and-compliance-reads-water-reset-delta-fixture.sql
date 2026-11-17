-- Run only inside an explicit rollback-only transaction after exact321 (iso-2 F2 and F4; #1633, #1734), as the
-- superuser owner: scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. It
-- checks the three ingestor grants and nothing wider on data_gaps, that the ingestor runtime login runs the gap
-- replay's mark and the coverage monitor's daily record read, that no gap the gap log fully replayed is left unmarked,
-- and that materialize_water_meter_events carries the reset delta with its invoker shape and its ACL closed to the
-- runtimes. The mark's UPDATE runs inside the rolled-back transaction; nothing persists.
-- The last line reports the result to the qualifier.
DO $grants$
BEGIN
    IF NOT has_column_privilege('verdify_ingestor_runtime', 'public.data_gaps', 'backfill_status', 'UPDATE')
        OR has_column_privilege('verdify_ingestor_runtime', 'public.data_gaps', 'start_ts', 'UPDATE')
        OR has_column_privilege('verdify_ingestor_runtime', 'public.data_gaps', 'end_ts', 'UPDATE')
        OR has_table_privilege('verdify_ingestor_runtime', 'public.data_gaps', 'DELETE') THEN
        RAISE EXCEPTION '321: the ingestor may update exactly data_gaps.backfill_status';
    END IF;
    IF NOT has_table_privilege('verdify_ingestor_runtime', 'public.v_data_gaps_unreplayed', 'SELECT')
        OR NOT has_table_privilege('verdify_ingestor_runtime', 'public.daily_band_compliance', 'SELECT')
        OR has_table_privilege('verdify_ingestor_runtime', 'public.daily_band_compliance', 'INSERT')
        OR has_table_privilege('verdify_ingestor_runtime', 'public.daily_band_compliance', 'UPDATE') THEN
        RAISE EXCEPTION '321: the ingestor reads v_data_gaps_unreplayed and daily_band_compliance, and writes neither';
    END IF;
    IF EXISTS (SELECT 1 FROM public.data_gaps g
                WHERE g.backfill_status IS DISTINCT FROM 'replayed' AND g.end_ts > g.start_ts
                  AND EXISTS (SELECT 1 FROM public.gap_replay_quarters q
                               WHERE q.first_ts < g.end_ts AND q.last_ts + interval '5 minutes' > g.start_ts)
                  AND NOT EXISTS (SELECT 1 FROM public.v_data_gaps_unreplayed u WHERE u.id = g.id)) THEN
        RAISE EXCEPTION '321: a fully replayed gap is left unmarked';
    END IF;
END $grants$;

DO $water$
DECLARE
    fn constant regprocedure := 'public.materialize_water_meter_events(text,timestamptz)'::regprocedure;
BEGIN
    IF (SELECT p.prosecdef OR p.proconfig IS NOT NULL OR pg_get_userbyid(p.proowner) <> 'verdify'
          FROM pg_catalog.pg_proc p WHERE p.oid = fn) THEN
        RAISE EXCEPTION '321 changed the water materializer''s owner, security or settings';
    END IF;
    IF has_function_privilege('verdify_ingestor_runtime', fn, 'EXECUTE')
        OR has_function_privilege('verdify_api_runtime', fn, 'EXECUTE') THEN
        RAISE EXCEPTION '321 opened the water materializer to a runtime';
    END IF;
    IF (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = fn) !~ 'v_last_total := 0;'
        OR (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = fn) !~ 'after_counter_reset'
        OR obj_description(fn, 'pg_proc') !~ '\(321\)' THEN
        RAISE EXCEPTION '321: the water materializer does not carry the reset delta';
    END IF;
    IF EXISTS (SELECT 1 FROM public.water_meter_events r
                WHERE r.event_type = 'reset' AND r.ts >= timestamptz '2026-11-10 00:00:00+00' AND r.total_gal > 0
                  AND r.prior_ts IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.water_meter_events d
                                   WHERE d.ts = r.ts AND d.source = r.source AND d.meter_id = r.meter_id
                                     AND d.event_type = 'delta')) THEN
        RAISE EXCEPTION '321: a reset since 2026-11-10 still has no delta for the gallons after the boot';
    END IF;
    IF (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = fn) !~ 'held_delta_gal'
        OR EXISTS (SELECT 1 FROM public.water_meter_events e
                    WHERE e.event_type = 'delta' AND e.quality_flag = 'high_delta' AND e.delta_gal <> 0)
        OR EXISTS (SELECT 1 FROM public.water_meter_events e
                    WHERE e.event_type = 'delta' AND e.quality_flag = 'high_delta' AND NOT (e.raw ? 'held_delta_gal')) THEN
        RAISE EXCEPTION '321: a high_delta row keeps its gallons in delta_gal or lost them from raw';
    END IF;
    IF EXISTS (SELECT 1 FROM public.water_meter_events e
                WHERE e.event_type = 'delta' AND e.attribution_class = 'ambiguous_overlap'
                  AND e.attributed_scope IS NULL AND COALESCE(e.candidate_run_count, 0) > 1
                  AND cardinality(e.candidate_relays) > 0
                  AND e.candidate_relays <@ ARRAY['fog', 'mister_center', 'mister_south', 'mister_west']::text[]) THEN
        RAISE EXCEPTION '321: an overlap of wetting relays only has no climate_wetting scope';
    END IF;
END $water$;

SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $ingestor$
BEGIN
    UPDATE data_gaps g
       SET backfill_status = 'replayed'
     WHERE g.end_ts > now() - interval '2 days'
       AND g.end_ts > g.start_ts
       AND g.backfill_status IS DISTINCT FROM 'replayed'
       AND EXISTS (SELECT 1 FROM gap_replay_quarters q
                    WHERE q.first_ts < g.end_ts AND q.last_ts + interval '5 minutes' > g.start_ts)
       AND NOT EXISTS (SELECT 1 FROM v_data_gaps_unreplayed u WHERE u.id = g.id);
    PERFORM EXISTS (SELECT 1 FROM daily_record WHERE date = (now() AT TIME ZONE 'America/Denver')::date - 1),
            EXISTS (SELECT 1 FROM daily_band_compliance WHERE date = (now() AT TIME ZONE 'America/Denver')::date - 1);
END $ingestor$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('ingestor_updates_only_backfill_status', 'ingestor_reads_gap_view_and_compliance',
                               'replayed_gaps_marked', 'water_materializer_shape_and_acl_unchanged',
                               'water_reset_delta_present', 'resets_since_11_10_backfilled',
                               'flap_deltas_zeroed_with_raw', 'wetting_overlaps_scoped', 'ingestor_runtime_runs_mark_and_daily_record_read'),
    'all_passed', true)::text;
