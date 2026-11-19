-- 321 (iso-2 findings F2 and F4, host release 8 or 9; #1633, #1712, #1734): three fixes found by the
-- second isolation test, each small.
-- (1) Nothing ever marked a replayed gap: the ingestor holds INSERT only on data_gaps. 321 grants it UPDATE of
--     backfill_status and SELECT on v_data_gaps_unreplayed, and the ingestor's gap replay sets 'replayed' on each
--     gap the gap log fully replayed (no piece left in the view). The gaps replayed so far are marked here, once.
-- (2) The coverage monitor's daily record check reads daily_band_compliance, which the ingestor could not read, so it
--     failed every 5 minutes. 321 grants SELECT on it, as 312 did for the dashboard.
-- (3) The water pulse counter restarts from zero at controller boot. materialize_water_meter_events booked a reset
--     with no delta, so the first gallons after every boot were lost (11-17: 1 gal at 14:14Z and 1 gal at 17:42Z).
--     321 keeps the reset row and then books the counter's value as a delta from zero over the interval since the
--     counter last read zero (its newest phantom_zero row), else since the last positive sample (raw carries
--     after_counter_reset), and adds once the deltas the old text dropped at the resets since 2026-11-10. The delta
--     keeps every quality rule: past 5 minutes it is source_gap, above 25 gal
--     high_delta, so only a short outage counts as ok delivery. Every other line is migration 194's, with the
--     materializer revision 'migration_321' on new rows; owner, ACL and the invoker shape are unchanged (CREATE OR
--     REPLACE). Rows already materialized are not rewritten.
-- (4) The water records (#1668 items 2 and 3, AR49). A high_delta row (a counter flap) stores delta_gal 0, its gallons
--     in raw.held_delta_gal, so an unfiltered sum of water_meter_events is safe; the 909 stored flap rows are zeroed
--     the same way, once. An overlap of wetting relays only (fog and misters) gets the scope climate_wetting, in the
--     function and once for the stored rows; the class stays ambiguous_overlap.
-- Rollback: a later migration revokes the grants and restores 194's function text. 321 chains from exact320 (its
-- sha256 and the seals 320 kept, which are 319's, are bound below).
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=320 AND filename='db/migrations/320-dashboard-projections.sql'
            AND sha256='71deafa19652c44c110e8f7370db4cb5bbfa359853301dd69a680bb26cbcbfc1'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>320)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'b227cdf249d50b28bd110be2e994aa58ef27b546dc508b56b912093d790e70fd'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '12d74c04e3f189f324dba042cfe0948bd794be63f64b84dc12e0dcdc8a51828c'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'aa26302d0e3a0931a5f91ce9f23c660a5a240cb59de1a4d5605f38638b534718'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        -- The objects 321 grants on and replaces exist in the shape it expects.
        OR to_regclass('public.v_data_gaps_unreplayed') IS NULL
        OR to_regclass('public.daily_band_compliance') IS NULL
        OR to_regclass('public.gap_replay_quarters') IS NULL
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
             WHERE attrelid='public.data_gaps'::regclass AND attname='backfill_status' AND NOT attisdropped)
        OR to_regprocedure('public.materialize_water_meter_events(text,timestamptz)') IS NULL
        OR (SELECT p.prosecdef OR p.proconfig IS NOT NULL FROM pg_catalog.pg_proc p
             WHERE p.oid='public.materialize_water_meter_events(text,timestamptz)'::regprocedure)
    THEN
        RAISE EXCEPTION '321 requires exact320 and its seals';
    END IF;
END $predecessor$;

GRANT UPDATE (backfill_status) ON public.data_gaps TO verdify_ingestor_runtime;
GRANT SELECT ON public.v_data_gaps_unreplayed TO verdify_ingestor_runtime;
GRANT SELECT ON public.daily_band_compliance TO verdify_ingestor_runtime;

-- The gaps the gap log has fully replayed so far: overlapped by a ledgered quarter and with no piece left.
UPDATE public.data_gaps g
   SET backfill_status = 'replayed'
 WHERE g.backfill_status IS DISTINCT FROM 'replayed'
   AND g.end_ts > g.start_ts
   AND EXISTS (SELECT 1 FROM public.gap_replay_quarters q
                WHERE q.first_ts < g.end_ts AND q.last_ts + interval '5 minutes' > g.start_ts)
   AND NOT EXISTS (SELECT 1 FROM public.v_data_gaps_unreplayed u WHERE u.id = g.id);

CREATE OR REPLACE FUNCTION public.materialize_water_meter_events(
    p_greenhouse_id text DEFAULT 'vallery',
    p_through timestamptz DEFAULT now()
)
RETURNS TABLE (
    processed_sample_count bigint,
    event_rows_upserted bigint,
    materialized_through timestamptz,
    ledger_status text
)
LANGUAGE plpgsql
AS $$
DECLARE
    r record;
    v_last_source_ts timestamptz;
    v_last_total_ts timestamptz;
    v_last_total double precision;
    v_last_quality text;
    v_processed bigint := 0;
    v_events bigint := 0;
    v_row_count bigint := 0;
    v_delta double precision;
    v_quality text;
    v_raw_latest timestamptz;
    v_candidate_relays text[];
    v_candidate_count integer;
    v_fert_master_overlap boolean;
    v_fert_commissioned boolean;
    v_attribution_class text;
    v_attributed_scope text;
    v_attribution_quality text;
    v_after_reset boolean;
    v_zero_ts timestamptz;
BEGIN
    INSERT INTO public.water_meter_materializer_state (
        greenhouse_id, source, meter_id
    ) VALUES (
        p_greenhouse_id, 'climate.water_total_gal', 'main_pulse'
    )
    ON CONFLICT (greenhouse_id, source, meter_id) DO NOTHING;

    SELECT s.last_source_ts, s.last_total_ts, s.last_total_gal,
           s.last_event_quality
      INTO v_last_source_ts, v_last_total_ts, v_last_total, v_last_quality
      FROM public.water_meter_materializer_state s
     WHERE s.greenhouse_id = p_greenhouse_id
       AND s.source = 'climate.water_total_gal'
       AND s.meter_id = 'main_pulse'
     FOR UPDATE;

    FOR r IN
        SELECT c.ts,
               max(c.water_total_gal)::double precision AS total_gal,
               count(DISTINCT c.water_total_gal)::integer AS total_variants
          FROM public.climate c
         WHERE COALESCE(c.greenhouse_id, 'vallery') = p_greenhouse_id
           AND c.water_total_gal IS NOT NULL
           AND (v_last_source_ts IS NULL OR c.ts > v_last_source_ts)
           AND c.ts <= p_through
         GROUP BY c.ts
         ORDER BY c.ts
    LOOP
        v_processed := v_processed + 1;

        IF r.total_variants > 1 THEN
            INSERT INTO public.water_meter_events (
                ts, greenhouse_id, source, meter_id, event_type, prior_ts,
                prior_total_gal, total_gal, delta_gal, quality_flag, raw,
                materializer_revision
            ) VALUES (
                r.ts, p_greenhouse_id, 'climate.water_total_gal', 'main_pulse',
                'source_conflict', v_last_total_ts, v_last_total, r.total_gal, 0,
                'conflicting_source_samples',
                jsonb_build_object(
                    'variant_count', r.total_variants,
                    'materializer', 'migration_321'
                ),
                'migration_321'
            )
            ON CONFLICT (ts, source, meter_id, event_type) DO UPDATE
            SET greenhouse_id = EXCLUDED.greenhouse_id,
                prior_ts = EXCLUDED.prior_ts,
                prior_total_gal = EXCLUDED.prior_total_gal,
                total_gal = EXCLUDED.total_gal,
                quality_flag = EXCLUDED.quality_flag,
                raw = public.water_meter_events.raw || EXCLUDED.raw,
                materializer_revision = EXCLUDED.materializer_revision;
            GET DIAGNOSTICS v_row_count = ROW_COUNT;
            v_events := v_events + v_row_count;
            -- Establish a new baseline without accepting an unknowable delta.
            v_last_quality := 'conflicting_source_samples';
            v_last_total := r.total_gal;
            v_last_total_ts := r.ts;
            v_last_source_ts := r.ts;
            CONTINUE;
        END IF;

        IF v_last_source_ts IS NOT NULL
           AND r.ts - v_last_source_ts > interval '5 minutes' THEN
            INSERT INTO public.water_meter_events (
                ts, greenhouse_id, source, meter_id, event_type, prior_ts,
                prior_total_gal, total_gal, delta_gal, quality_flag, raw,
                materializer_revision
            ) VALUES (
                r.ts, p_greenhouse_id, 'climate.water_total_gal', 'main_pulse',
                'gap', v_last_source_ts, v_last_total, r.total_gal, 0,
                'source_gap',
                jsonb_build_object(
                    'gap_seconds', extract(epoch FROM (r.ts - v_last_source_ts)),
                    'materializer', 'migration_321'
                ),
                'migration_321'
            )
            ON CONFLICT (ts, source, meter_id, event_type) DO UPDATE
            SET greenhouse_id = EXCLUDED.greenhouse_id,
                prior_ts = EXCLUDED.prior_ts,
                prior_total_gal = EXCLUDED.prior_total_gal,
                total_gal = EXCLUDED.total_gal,
                quality_flag = EXCLUDED.quality_flag,
                raw = public.water_meter_events.raw || EXCLUDED.raw,
                materializer_revision = EXCLUDED.materializer_revision;
            GET DIAGNOSTICS v_row_count = ROW_COUNT;
            v_events := v_events + v_row_count;
            v_last_quality := 'source_gap';
        END IF;

        IF r.total_gal <= 0 THEN
            INSERT INTO public.water_meter_events (
                ts, greenhouse_id, source, meter_id, event_type, prior_ts,
                prior_total_gal, total_gal, delta_gal, quality_flag, raw,
                materializer_revision
            ) VALUES (
                r.ts, p_greenhouse_id, 'climate.water_total_gal', 'main_pulse',
                'phantom_zero', v_last_total_ts, v_last_total, r.total_gal, 0,
                'phantom_zero', jsonb_build_object('materializer', 'migration_321'),
                'migration_321'
            )
            ON CONFLICT (ts, source, meter_id, event_type) DO UPDATE
            SET greenhouse_id = EXCLUDED.greenhouse_id,
                prior_ts = EXCLUDED.prior_ts,
                prior_total_gal = EXCLUDED.prior_total_gal,
                total_gal = EXCLUDED.total_gal,
                quality_flag = EXCLUDED.quality_flag,
                raw = public.water_meter_events.raw || EXCLUDED.raw,
                materializer_revision = EXCLUDED.materializer_revision;
            GET DIAGNOSTICS v_row_count = ROW_COUNT;
            v_events := v_events + v_row_count;
            v_last_quality := 'phantom_zero';
        ELSIF v_last_total IS NULL THEN
            INSERT INTO public.water_meter_events (
                ts, greenhouse_id, source, meter_id, event_type, prior_ts,
                prior_total_gal, total_gal, delta_gal, quality_flag, raw,
                materializer_revision
            ) VALUES (
                r.ts, p_greenhouse_id, 'climate.water_total_gal', 'main_pulse',
                'initial', NULL, NULL, r.total_gal, 0, 'ok',
                jsonb_build_object('materializer', 'migration_321'), 'migration_321'
            )
            ON CONFLICT (ts, source, meter_id, event_type) DO UPDATE
            SET greenhouse_id = EXCLUDED.greenhouse_id,
                total_gal = EXCLUDED.total_gal,
                quality_flag = EXCLUDED.quality_flag,
                raw = public.water_meter_events.raw || EXCLUDED.raw,
                materializer_revision = EXCLUDED.materializer_revision;
            GET DIAGNOSTICS v_row_count = ROW_COUNT;
            v_events := v_events + v_row_count;
            v_last_quality := 'ok';
            v_last_total := r.total_gal;
            v_last_total_ts := r.ts;
        ELSE
            v_after_reset := false;
            IF r.total_gal < v_last_total THEN
                INSERT INTO public.water_meter_events (
                    ts, greenhouse_id, source, meter_id, event_type, prior_ts,
                    prior_total_gal, total_gal, delta_gal, quality_flag, raw,
                    materializer_revision
                ) VALUES (
                    r.ts, p_greenhouse_id, 'climate.water_total_gal', 'main_pulse',
                    'reset', v_last_total_ts, v_last_total, r.total_gal, 0,
                    'counter_reset', jsonb_build_object('materializer', 'migration_321'),
                    'migration_321'
                )
                ON CONFLICT (ts, source, meter_id, event_type) DO UPDATE
                SET greenhouse_id = EXCLUDED.greenhouse_id,
                    prior_ts = EXCLUDED.prior_ts,
                    prior_total_gal = EXCLUDED.prior_total_gal,
                    total_gal = EXCLUDED.total_gal,
                    quality_flag = EXCLUDED.quality_flag,
                    raw = public.water_meter_events.raw || EXCLUDED.raw,
                    materializer_revision = EXCLUDED.materializer_revision;
                GET DIAGNOSTICS v_row_count = ROW_COUNT;
                v_events := v_events + v_row_count;
                v_last_quality := 'counter_reset';
                -- 321: the pulse counter restarts from zero at boot, so the gallons it shows now were used since it
                -- last read zero (its newest phantom_zero after the last positive sample), else since that sample.
                -- Book them as a delta from zero over that interval instead of dropping them.
                SELECT max(e.ts) INTO v_zero_ts
                  FROM public.water_meter_events e
                 WHERE e.greenhouse_id = p_greenhouse_id
                   AND e.source = 'climate.water_total_gal'
                   AND e.meter_id = 'main_pulse'
                   AND e.event_type = 'phantom_zero'
                   AND e.ts > v_last_total_ts
                   AND e.ts < r.ts;
                v_last_total := 0;
                v_last_total_ts := COALESCE(v_zero_ts, v_last_total_ts);
                v_after_reset := true;
            END IF;
            IF r.total_gal > v_last_total THEN
                v_delta := r.total_gal - v_last_total;
                v_quality := CASE
                    WHEN v_delta > 25 THEN 'high_delta'
                    WHEN v_last_total_ts IS NOT NULL
                     AND r.ts - v_last_total_ts > interval '5 minutes' THEN 'source_gap'
                    ELSE 'ok'
                END;

                WITH relay_list(relay_slug) AS (
                    SELECT unnest(ARRAY[
                        'fog', 'mister_center', 'mister_south', 'mister_west',
                        'drip_wall', 'drip_center', 'drip_wall_fert', 'drip_center_fert',
                        'mister_south_fert', 'mister_west_fert'
                    ]::text[])
                ), seed AS (
                    SELECT
                        l.relay_slug,
                        v_last_total_ts AS ts,
                        COALESCE((
                            SELECT bool_and(es.state)
                            FROM public.equipment_state es
                            WHERE COALESCE(es.greenhouse_id, 'vallery') = p_greenhouse_id
                              AND es.equipment = l.relay_slug
                              AND es.ts = (
                                  SELECT max(latest.ts)
                                  FROM public.equipment_state latest
                                  WHERE COALESCE(latest.greenhouse_id, 'vallery') = p_greenhouse_id
                                    AND latest.equipment = l.relay_slug
                                    AND latest.ts <= v_last_total_ts
                              )
                            HAVING count(DISTINCT es.state) = 1
                        ), false) AS state
                    FROM relay_list l
                ), interval_events AS (
                    SELECT relay_slug, ts, state FROM seed
                    UNION ALL
                    SELECT l.relay_slug, es.ts, bool_or(es.state) AS state
                    FROM relay_list l
                    JOIN public.equipment_state es ON es.equipment = l.relay_slug
                    WHERE COALESCE(es.greenhouse_id, 'vallery') = p_greenhouse_id
                      AND es.ts > v_last_total_ts
                      AND es.ts <= r.ts
                    GROUP BY l.relay_slug, es.ts
                ), ordered AS (
                    SELECT relay_slug, ts, state,
                           lag(state) OVER (PARTITION BY relay_slug ORDER BY ts) AS prior_state
                    FROM interval_events
                ), relay_runs AS (
                    SELECT relay_slug,
                           count(*) FILTER (
                               WHERE state IS TRUE
                                 AND prior_state IS DISTINCT FROM true
                           )::integer AS run_count
                    FROM ordered
                    GROUP BY relay_slug
                )
                SELECT
                    COALESCE(
                        array_agg(relay_slug ORDER BY relay_slug)
                            FILTER (WHERE run_count > 0),
                        ARRAY[]::text[]
                    ),
                    COALESCE(sum(run_count), 0)::integer
                  INTO v_candidate_relays, v_candidate_count
                  FROM relay_runs;

                v_fert_master_overlap := false;
                v_fert_commissioned := false;
                IF 'drip_wall_fert' = ANY(v_candidate_relays) THEN
                    WITH boundaries AS (
                        SELECT v_last_total_ts AS ts
                        UNION
                        SELECT es.ts
                        FROM public.equipment_state es
                        WHERE COALESCE(es.greenhouse_id, 'vallery') = p_greenhouse_id
                          AND es.equipment IN ('drip_wall_fert', 'fert_master_valve')
                          AND es.ts > v_last_total_ts
                          AND es.ts < r.ts
                        UNION
                        SELECT r.ts
                    ), segments AS (
                        SELECT
                            b.ts,
                            lead(b.ts) OVER (ORDER BY b.ts) AS next_ts,
                            COALESCE((
                                SELECT bool_and(es.state)
                                FROM public.equipment_state es
                                WHERE COALESCE(es.greenhouse_id, 'vallery') = p_greenhouse_id
                                  AND es.equipment = 'drip_wall_fert'
                                  AND es.ts = (
                                      SELECT max(latest.ts)
                                      FROM public.equipment_state latest
                                      WHERE COALESCE(latest.greenhouse_id, 'vallery') = p_greenhouse_id
                                        AND latest.equipment = 'drip_wall_fert'
                                        AND latest.ts <= b.ts
                                  )
                                HAVING count(DISTINCT es.state) = 1
                            ), false) AS wall_fert_on,
                            COALESCE((
                                SELECT bool_and(es.state)
                                FROM public.equipment_state es
                                WHERE COALESCE(es.greenhouse_id, 'vallery') = p_greenhouse_id
                                  AND es.equipment = 'fert_master_valve'
                                  AND es.ts = (
                                      SELECT max(latest.ts)
                                      FROM public.equipment_state latest
                                      WHERE COALESCE(latest.greenhouse_id, 'vallery') = p_greenhouse_id
                                        AND latest.equipment = 'fert_master_valve'
                                        AND latest.ts <= b.ts
                                  )
                                HAVING count(DISTINCT es.state) = 1
                            ), false) AS fert_master_on
                        FROM boundaries b
                    )
                    SELECT EXISTS (
                        SELECT 1
                        FROM segments s
                        WHERE s.wall_fert_on
                          AND s.fert_master_on
                          AND s.next_ts > s.ts
                    )
                      INTO v_fert_master_overlap;

                    SELECT COALESCE((
                        SELECT lower(s.value) IN ('true', 'on', '1', 'eligible')
                        FROM public.system_state s
                        WHERE COALESCE(s.greenhouse_id, 'vallery') = p_greenhouse_id
                          AND s.entity = 'fertigation_commissioning_eligible'
                          AND s.ts <= r.ts
                        ORDER BY s.ts DESC
                        LIMIT 1
                    ), false)
                      INTO v_fert_commissioned;
                END IF;

                v_attribution_class := CASE
                    WHEN v_candidate_count = 0 THEN 'manual_or_unattributed'
                    WHEN v_candidate_count = 1 THEN 'meter_attributed'
                    ELSE 'ambiguous_overlap'
                END;
                v_attributed_scope := CASE
                    WHEN v_candidate_count > 1
                      AND v_candidate_relays <@ ARRAY[
                          'fog', 'mister_center', 'mister_south', 'mister_west'
                      ]::text[] THEN 'climate_wetting'
                    WHEN v_candidate_count <> 1 THEN NULL
                    WHEN v_candidate_relays[1] IN (
                        'fog', 'mister_center', 'mister_south', 'mister_west'
                    ) THEN 'climate_wetting'
                    WHEN v_candidate_relays[1] = 'drip_wall' THEN 'wall_irrigation'
                    WHEN v_candidate_relays[1] = 'drip_wall_fert'
                      AND v_fert_master_overlap
                      AND v_fert_commissioned THEN 'wall_fertigation'
                    ELSE 'unsupported_path'
                END;
                v_attribution_quality := CASE
                    WHEN v_last_total_ts IS NULL THEN 'missing_interval'
                    WHEN EXISTS (
                        SELECT 1
                        FROM public.equipment_state es
                        WHERE COALESCE(es.greenhouse_id, 'vallery') = p_greenhouse_id
                          AND es.equipment = ANY(ARRAY[
                              'fog', 'mister_center', 'mister_south', 'mister_west',
                              'drip_wall', 'drip_center', 'drip_wall_fert',
                              'drip_center_fert', 'mister_south_fert',
                              'mister_west_fert'
                          ]::text[])
                          AND es.ts >= v_last_total_ts
                          AND es.ts <= r.ts
                        GROUP BY es.equipment, es.ts
                        HAVING count(DISTINCT es.state) > 1
                    ) THEN 'conflicting_relay_events'
                    WHEN v_candidate_count = 1
                      AND v_candidate_relays[1] = 'drip_wall_fert'
                      AND NOT v_fert_master_overlap THEN 'fert_master_not_observed'
                    WHEN v_candidate_count = 1
                      AND v_candidate_relays[1] = 'drip_wall_fert'
                      AND NOT v_fert_commissioned THEN 'fertigation_not_commissioned'
                    ELSE 'ok'
                END;
                INSERT INTO public.water_meter_events (
                    ts, greenhouse_id, source, meter_id, event_type, prior_ts,
                    prior_total_gal, total_gal, delta_gal, quality_flag, raw,
                    materializer_revision, attribution_class, attributed_scope,
                    candidate_relays, candidate_run_count, attribution_quality
                ) VALUES (
                    r.ts, p_greenhouse_id, 'climate.water_total_gal', 'main_pulse',
                    'delta', v_last_total_ts, v_last_total, r.total_gal,
                    CASE WHEN v_quality = 'high_delta' THEN 0 ELSE v_delta END,
                    v_quality, jsonb_build_object('materializer', 'migration_321')
                        || CASE WHEN v_after_reset THEN jsonb_build_object('after_counter_reset', true)
                                ELSE '{}'::jsonb END
                        || CASE WHEN v_quality = 'high_delta' THEN jsonb_build_object('held_delta_gal', v_delta)
                                ELSE '{}'::jsonb END,
                    'migration_321', v_attribution_class, v_attributed_scope,
                    v_candidate_relays, v_candidate_count, v_attribution_quality
                )
                ON CONFLICT (ts, source, meter_id, event_type) DO UPDATE
                SET greenhouse_id = EXCLUDED.greenhouse_id,
                    prior_ts = EXCLUDED.prior_ts,
                    prior_total_gal = EXCLUDED.prior_total_gal,
                    total_gal = EXCLUDED.total_gal,
                    delta_gal = EXCLUDED.delta_gal,
                    quality_flag = EXCLUDED.quality_flag,
                    raw = public.water_meter_events.raw || EXCLUDED.raw,
                    materializer_revision = EXCLUDED.materializer_revision,
                    attribution_class = EXCLUDED.attribution_class,
                    attributed_scope = EXCLUDED.attributed_scope,
                    candidate_relays = EXCLUDED.candidate_relays,
                    candidate_run_count = EXCLUDED.candidate_run_count,
                    attribution_quality = EXCLUDED.attribution_quality;
                GET DIAGNOSTICS v_row_count = ROW_COUNT;
                v_events := v_events + v_row_count;
                v_last_quality := v_quality;
                v_last_total := r.total_gal;
                v_last_total_ts := r.ts;
            ELSE
                -- An unchanged positive sample is still a successful checkpoint.
                v_last_total_ts := r.ts;
            END IF;
        END IF;

        v_last_source_ts := r.ts;
    END LOOP;

    UPDATE public.water_meter_materializer_state
       SET last_source_ts = v_last_source_ts,
           last_total_ts = v_last_total_ts,
           last_total_gal = v_last_total,
           last_event_quality = v_last_quality,
           last_success_at = CASE WHEN v_processed > 0 THEN now() ELSE last_success_at END,
           processed_samples = processed_samples + v_processed,
           updated_at = now()
     WHERE greenhouse_id = p_greenhouse_id
       AND source = 'climate.water_total_gal'
       AND meter_id = 'main_pulse';

    SELECT max(c.ts)
      INTO v_raw_latest
      FROM public.climate c
     WHERE COALESCE(c.greenhouse_id, 'vallery') = p_greenhouse_id
       AND c.water_total_gal IS NOT NULL;

    RETURN QUERY SELECT
        v_processed,
        v_events,
        v_last_source_ts,
        CASE
            WHEN v_raw_latest IS NULL OR v_last_source_ts IS NULL THEN 'unavailable'
            WHEN v_last_source_ts < v_raw_latest - interval '5 minutes' THEN 'stale'
            WHEN v_raw_latest < now() - interval '10 minutes' THEN 'stale'
            WHEN v_last_quality IN (
                'source_gap', 'high_delta', 'conflicting_source_samples',
                'counter_reset', 'phantom_zero'
            ) THEN 'discontinuous'
            ELSE 'fresh'
        END;
END;
$$;

COMMENT ON FUNCTION public.materialize_water_meter_events(text, timestamptz) IS
'Incrementally checkpoints cumulative water telemetry into an idempotent event ledger. Resets, phantom zeros, large deltas, and source gaps remain explicit and are never counted as quality-filtered delivery. After a counter reset the counter''s value is booked as a delta from zero over the interval since the last sample (321), under the same quality rules.';

-- Once: the gallons the old text dropped at each reset since 2026-11-10 (the materializer never rewrites a booked
-- row). A reset whose counter read above 0 and that has no delta at its own time gets one: from zero, over the
-- interval since the counter's newest zero reading after the reset's prior sample (else that sample), with the
-- function's quality rules. Its relays are not re-derived: manual_or_unattributed, attribution_quality
-- reset_backfill_321. v_water_meter_daily is a view, so the day totals read the new rows at once; daily_record
-- refreshes the last three days on its next run.
INSERT INTO public.water_meter_events (
    ts, greenhouse_id, source, meter_id, event_type, prior_ts, prior_total_gal, total_gal, delta_gal, quality_flag,
    raw, materializer_revision, attribution_class, attributed_scope, candidate_relays, candidate_run_count,
    attribution_quality
)
SELECT r.ts, r.greenhouse_id, r.source, r.meter_id, 'delta', b.since, 0, r.total_gal,
       CASE WHEN r.total_gal > 25 THEN 0 ELSE r.total_gal END,
       CASE WHEN r.total_gal > 25 THEN 'high_delta'
            WHEN r.ts - b.since > interval '5 minutes' THEN 'source_gap'
            ELSE 'ok' END,
       jsonb_build_object('materializer', 'migration_321', 'after_counter_reset', true, 'backfill', true)
           || CASE WHEN r.total_gal > 25 THEN jsonb_build_object('held_delta_gal', r.total_gal)
                   ELSE '{}'::jsonb END,
       'migration_321', 'manual_or_unattributed', NULL, ARRAY[]::text[], 0, 'reset_backfill_321'
  FROM public.water_meter_events r
 CROSS JOIN LATERAL (
       SELECT COALESCE((SELECT max(z.ts) FROM public.water_meter_events z
                         WHERE z.greenhouse_id IS NOT DISTINCT FROM r.greenhouse_id AND z.source = r.source
                           AND z.meter_id = r.meter_id AND z.event_type = 'phantom_zero'
                           AND z.ts > r.prior_ts AND z.ts < r.ts), r.prior_ts) AS since
 ) b
 WHERE r.event_type = 'reset'
   AND r.ts >= timestamptz '2026-11-10 00:00:00+00'
   AND r.total_gal > 0
   AND r.prior_ts IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.water_meter_events d
                    WHERE d.ts = r.ts AND d.source = r.source AND d.meter_id = r.meter_id AND d.event_type = 'delta');

-- Once (#1668 items 2 and 3, AR49): every stored high_delta row (counter flaps; 909 rows, 1,379,214 gal on
-- 2026-11-17) gets delta_gal 0, so an unfiltered sum of the table is safe; its gallons move to raw.held_delta_gal and
-- prior_total_gal/total_gal stay as recorded. No reader changes: every reader of delta_gal filters quality_flag = 'ok'.
-- The 81 high_delta rows already at 0 (2026-01 to 2026-03) get held_delta_gal 0, so every high_delta row carries it,
-- as every row the function books from now on does.
UPDATE public.water_meter_events
   SET raw = COALESCE(raw, '{}'::jsonb)
             || jsonb_build_object('held_delta_gal', delta_gal, 'delta_zeroed_by', 'migration_321'),
       delta_gal = 0
 WHERE event_type = 'delta'
   AND quality_flag = 'high_delta'
   AND NOT (COALESCE(raw, '{}'::jsonb) ? 'held_delta_gal');

-- Once: an overlap of wetting relays only (fog and misters) is climate wetting whichever relay used the water. Its
-- class stays ambiguous_overlap (the relay is still unknown; the daily partition and the irrigation run reads key on
-- the class), only the scope is set, so climate_wetting_gal and planning_water_gal count it (15,319 rows, 21,757 gal
-- on 2026-11-17).
UPDATE public.water_meter_events
   SET attributed_scope = 'climate_wetting',
       raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('scope_set_by', 'migration_321')
 WHERE event_type = 'delta'
   AND attribution_class = 'ambiguous_overlap'
   AND attributed_scope IS NULL
   AND COALESCE(candidate_run_count, 0) > 1
   AND cardinality(candidate_relays) > 0
   AND candidate_relays <@ ARRAY['fog', 'mister_center', 'mister_south', 'mister_west']::text[];

-- Successor seals: measured by the native probe, because the grants widen the ingestor runtime's boundary. Until
-- then they are 320's (319's values), so the file fails closed.
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '6c25f8edeca86917bc4b0c8bb7aa960d6d6a280bfaf2e32b574701439d52f40c'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM 'b37744a7416c1a79835f5876fd3357b1e18c1f3ca91b721005c740c1b6debf42'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'aa26302d0e3a0931a5f91ce9f23c660a5a240cb59de1a4d5605f38638b534718'
    THEN RAISE EXCEPTION '321 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('6c25f8edeca86917bc4b0c8bb7aa960d6d6a280bfaf2e32b574701439d52f40c','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '321 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('b37744a7416c1a79835f5876fd3357b1e18c1f3ca91b721005c740c1b6debf42','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '321 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('aa26302d0e3a0931a5f91ce9f23c660a5a240cb59de1a4d5605f38638b534718','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '321 missing mcp receipt'; END IF;
    IF EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
    THEN RAISE EXCEPTION '321 receipts do not match the successor seals'; END IF;
END $successor$;
