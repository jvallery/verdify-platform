-- 314 (#1633, host release 3; RULINGS AE1, AE3, AE8): the controller health columns and the gap-replay ledger.
-- Nine nullable diagnostics columns carry what the third-flash firmware publishes about its own health: the minute's
-- lowest free heap and largest free block, the worst control-loop and NVS write times, the persisted restart count,
-- used and free NVS entries, the gap log's state and whether sensing is degraded. NULL means not published (every
-- row before the third flash, and a flush that did not carry the reading): no backfill, no default. The ingestor
-- writes diagnostics only through 217's facade v_runtime_diagnostics_write (security_barrier, not security_invoker),
-- so the facade is replaced with the nine columns appended and the ingestor duty gets INSERT on exactly those nine.
-- The operator API reads them through its table-level SELECT on diagnostics (284), which covers columns added later.
-- gap_replay_quarters is the ledger of replayed gap-log quarters (contracts gap-log section 9, AE8): one row per
-- (boot, qseq), written in the same transaction as the quarter's climate and equipment_state rows, so a quarter
-- already in the ledger is skipped and its minutes are known to be replayed, not seen live. climate and
-- equipment_state are unchanged. The ingestor duty reads the ledger and inserts into it.
-- v_data_gaps_unreplayed is data_gaps with the ledger's replayed spans cut out (a gap fully replayed has no row, a
-- partly replayed one keeps its unreplayed pieces), so a reader of outages does not show replayed minutes as a gap
-- and the ingestor needs no UPDATE on data_gaps. The dashboard duty reads it (series.py), as 308 granted its views.
-- Lane DATA (contracts h3-314-data-additions, RULINGS AF4, AF10): the ingestor duty reads daily_record and
-- daily_relay_record (daily_summary takes therms, starts and run time from them), and fn_refresh_daily_record stores
-- today, yesterday and the day before on every run. Lane MONITORING (contracts h3-health-columns section 7, AF11):
-- the two change-only sensor_registry rows state.lead_fan and equipment.sntp_status go inactive.
-- Seals: the ingestor duty's new facade columns and its ledger grants move the ingestor seal; the api and MCP seals
-- are re-measured too (both read diagnostics). The successor literals are measured by the rolled-back native
-- qualification (tests/fixtures/314-controller-health-and-gap-ledger-native-qualification.json); until then the file
-- carries 313's values and its successor block refuses to finish (fail closed). 314 chains from exact313.
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=313 AND filename='db/migrations/313-planner-review.sql'
            AND sha256='933d856e07503d36115b744eea09b4208e688ad2bbec06f48692e2a850d58e0b'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>313)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '4a39a38fcb5cebc8aa5385b8569db3969fece16210e5c505188624c1b84f6820'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM 'ca2eea00fdfbbef0ddc34a8d29471d5ffc98c299e17b0772f9ee583fdb5e831f'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '5b31cf1e74b78963e266cfd22dc3867a7972dbb53eff209f3c121781fb90f8dc'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.diagnostics'::regclass
            AND attname IN ('heap_min_free_minute_kb', 'heap_largest_block_minute_low_kb', 'loop_worst_ms',
                'restart_count', 'nvs_used_entries', 'nvs_free_entries', 'nvs_write_worst_ms', 'gap_log_state',
                'sensor_degraded_active')
            AND NOT attisdropped)
        OR (SELECT reloptions FROM pg_catalog.pg_class WHERE oid='public.v_runtime_diagnostics_write'::regclass)
            IS DISTINCT FROM ARRAY['security_barrier=true','security_invoker=false']
        OR to_regclass('public.gap_replay_quarters') IS NOT NULL
        OR to_regclass('public.v_data_gaps_unreplayed') IS NOT NULL
        OR to_regclass('public.daily_record') IS NULL OR to_regclass('public.daily_relay_record') IS NULL
        OR has_table_privilege('verdify_ingestor_runtime', 'public.daily_record', 'SELECT')
        OR to_regprocedure('verdify_matview_refresh_runtime.fn_refresh_daily_record()') IS NULL
        OR (SELECT count(*) FROM public.sensor_registry
             WHERE sensor_id IN ('state.lead_fan', 'equipment.sntp_status')) <> 2
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='verdify_dashboard_runtime' AND NOT rolcanlogin)
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='verdify_ingestor_runtime' AND NOT rolcanlogin)
    THEN RAISE EXCEPTION '314 refuses an unqualified predecessor'; END IF;
END $predecessor$;

-- One column per statement: diagnostics is a compressed hypertable.
ALTER TABLE public.diagnostics ADD COLUMN heap_min_free_minute_kb double precision;
ALTER TABLE public.diagnostics ADD COLUMN heap_largest_block_minute_low_kb double precision;
ALTER TABLE public.diagnostics ADD COLUMN loop_worst_ms double precision;
ALTER TABLE public.diagnostics ADD COLUMN restart_count integer;
ALTER TABLE public.diagnostics ADD COLUMN nvs_used_entries integer;
ALTER TABLE public.diagnostics ADD COLUMN nvs_free_entries integer;
ALTER TABLE public.diagnostics ADD COLUMN nvs_write_worst_ms double precision;
ALTER TABLE public.diagnostics ADD COLUMN gap_log_state text;
ALTER TABLE public.diagnostics ADD COLUMN sensor_degraded_active integer;

COMMENT ON COLUMN public.diagnostics.heap_min_free_minute_kb IS
    'Lowest free heap in kB within the last minute (ESPHome free_heap_minute_low; 314, #1633). NULL = not '
    'published.';
COMMENT ON COLUMN public.diagnostics.heap_largest_block_minute_low_kb IS
    'Lowest largest free heap block in kB within the last minute (largest_heap_block_minute_low; 314). NULL = not '
    'published.';
COMMENT ON COLUMN public.diagnostics.loop_worst_ms IS
    'Worst control-loop run time in ms within the last minute (control_loop_worst_minute; 314). NULL = not '
    'published.';
COMMENT ON COLUMN public.diagnostics.restart_count IS
    'Controller restarts counted by the firmware and kept across reboots (restart_count; 314). NULL = not '
    'published.';
COMMENT ON COLUMN public.diagnostics.nvs_used_entries IS
    'Used NVS entries of 32 bytes (nvs_used_entries; 314). NULL = not published or the stats read failed.';
COMMENT ON COLUMN public.diagnostics.nvs_free_entries IS
    'Free NVS entries of 32 bytes (nvs_free_entries; 314). NULL = not published or the stats read failed.';
COMMENT ON COLUMN public.diagnostics.nvs_write_worst_ms IS
    'Worst NVS write time in ms within the last minute, 0 when nothing was written (nvs_write_worst_minute; 314). '
    'NULL = not published.';
COMMENT ON COLUMN public.diagnostics.gap_log_state IS
    'The gap log state: armed, or off: nvs_small, nvs_full, nvs_slow, nvs_error, not_armed_yet (gap_log_state; '
    '314). NULL = not published.';
COMMENT ON COLUMN public.diagnostics.sensor_degraded_active IS
    '1 while the controller runs with degraded sensing, else 0 (sensor_degraded_active; 314). NULL = not '
    'published.';

-- 217's facade with the nine columns appended: the same columns in the same order, then the nine.
CREATE OR REPLACE VIEW public.v_runtime_diagnostics_write
    WITH (security_barrier=true, security_invoker=false) AS
SELECT ts, wifi_rssi, heap_bytes, heap_min_free_kb, heap_largest_free_block_kb, uptime_s, probe_health,
       reset_reason, firmware_version, active_probe_count, relief_cycle_count, vent_latch_timer_s, sealed_timer_s,
       vpd_watch_timer_s, mist_backoff_timer_s, vent_mist_assist_active, effective_heat_target_f,
       effective_cool_stage2_delta_f, effective_vpd_hysteresis_kpa, effective_dehum_aggressive_kpa,
       controller_time_epoch, controller_local_hour, sntp_valid, sntp_miss_count, last_sntp_sync_age_s,
       band_source, zone_wet_granted, greenhouse_id, heap_min_free_minute_kb, heap_largest_block_minute_low_kb,
       loop_worst_ms, restart_count, nvs_used_entries, nvs_free_entries, nvs_write_worst_ms, gap_log_state,
       sensor_degraded_active
  FROM public.diagnostics;

GRANT INSERT (heap_min_free_minute_kb, heap_largest_block_minute_low_kb, loop_worst_ms, restart_count,
    nvs_used_entries, nvs_free_entries, nvs_write_worst_ms, gap_log_state, sensor_degraded_active)
    ON public.v_runtime_diagnostics_write TO verdify_ingestor_runtime;

CREATE TABLE public.gap_replay_quarters (
    boot             bigint NOT NULL CHECK (boot >= 0),
    qseq             bigint NOT NULL CHECK (qseq >= 0),
    first_ts         timestamptz,
    last_ts          timestamptz,
    climate_rows     integer NOT NULL CHECK (climate_rows >= 0),
    transition_rows  integer NOT NULL CHECK (transition_rows >= 0),
    format_version   smallint NOT NULL CHECK (format_version > 0),
    received_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (boot, qseq),
    CHECK ((first_ts IS NULL) = (last_ts IS NULL)),
    CHECK (last_ts >= first_ts),
    CHECK ((first_ts IS NULL) = (climate_rows + transition_rows = 0))
);
COMMENT ON TABLE public.gap_replay_quarters IS
    'Gap-log quarters the ingestor replayed into climate and equipment_state (314, #1633, RULINGS AE8): one row per '
    'controller boot and quarter sequence, written in the transaction that stores the quarter''s rows, so a quarter '
    'already here is skipped. Its minutes were replayed after a disconnect, not seen live.';
COMMENT ON COLUMN public.gap_replay_quarters.first_ts IS
    'Placed time of the quarter''s first replayed record or transition; NULL when the quarter carried none.';
COMMENT ON COLUMN public.gap_replay_quarters.last_ts IS
    'Placed time of the quarter''s last replayed record or transition; NULL when the quarter carried none.';
COMMENT ON COLUMN public.gap_replay_quarters.climate_rows IS 'Climate records of the quarter (its Q line n_clim).';
COMMENT ON COLUMN public.gap_replay_quarters.transition_rows IS
    'Relay transitions of the quarter (its Q line n_tr).';
COMMENT ON COLUMN public.gap_replay_quarters.format_version IS
    'The quarter''s record version (its Q line ver): 2 = per-minute records, 1 = 5-minute.';

GRANT SELECT ON public.gap_replay_quarters TO verdify_ingestor_runtime;
GRANT INSERT (boot, qseq, first_ts, last_ts, climate_rows, transition_rows, format_version)
    ON public.gap_replay_quarters TO verdify_ingestor_runtime;

-- A quarter's span is [first_ts, last_ts + one record interval): its records sit at t0, t0 + 60, ... t0 + 840.
CREATE VIEW public.v_data_gaps_unreplayed WITH (security_barrier=true) AS
SELECT g.id,
       lower(piece.span) AS start_ts,
       upper(piece.span) AS end_ts,
       extract(epoch FROM upper(piece.span) - lower(piece.span))::double precision AS duration_s,
       g.reason,
       g.backfill_status,
       g.created_at
  FROM public.data_gaps g
  CROSS JOIN LATERAL unnest(
      tstzmultirange(tstzrange(g.start_ts, g.end_ts))
      - COALESCE((SELECT range_agg(tstzrange(q.first_ts, q.last_ts + CASE q.format_version
                                                                      WHEN 1 THEN interval '5 minutes'
                                                                      ELSE interval '1 minute' END))
                    FROM public.gap_replay_quarters q
                   WHERE q.first_ts < g.end_ts AND q.last_ts + interval '5 minutes' > g.start_ts),
                 '{}'::tstzmultirange)) AS piece(span)
 WHERE NOT isempty(piece.span);
COMMENT ON VIEW public.v_data_gaps_unreplayed IS
    'data_gaps without the minutes the gap log replayed (gap_replay_quarters spans; 314, #1633, RULINGS AE8): one row '
    'per remaining piece of a gap, with the gap''s id and reason. Read this, not data_gaps, to show outages.';
GRANT SELECT ON public.v_data_gaps_unreplayed TO verdify_dashboard_runtime;

-- AF4 (lane DATA): the daily summary reads the daily record. SELECT only, to the group role.
GRANT SELECT ON public.daily_relay_record, public.daily_record TO verdify_ingestor_runtime;

-- AF10 (lane DATA): 310's refresh with (v_today - 2) added and the missing-day scan starting at v_today - 3.
CREATE OR REPLACE FUNCTION verdify_matview_refresh_runtime.fn_refresh_daily_record() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $refresh$
 DECLARE
  v_today date := (now() AT TIME ZONE 'America/Denver')::date;
  v_day date;
  v_refreshed integer := 0;
 BEGIN
  IF session_user <> 'verdify_matview_refresh_runtime_login' THEN
   RAISE EXCEPTION 'refresh caller outside duty' USING ERRCODE='42501';
  END IF;
  -- Today, yesterday and the day before every run (RULINGS AF10): a gap replay that lands just after local
  -- midnight is stored again; then the newest 3 days back to 2026-10-17 that have no row. A day that fails is
  -- skipped with a warning, so one bad day never stops the rest.
  FOR v_day IN
   SELECT recent.d FROM (VALUES (v_today), (v_today - 1), (v_today - 2)) AS recent(d)
   UNION ALL
   (SELECT missing.d::date FROM generate_series(DATE '2026-10-17', v_today - 3, interval '1 day') AS missing(d)
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
REVOKE ALL ON FUNCTION verdify_matview_refresh_runtime.fn_refresh_daily_record() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verdify_matview_refresh_runtime.fn_refresh_daily_record() TO verdify_matview_refresh_runtime;

-- AF11 (lane MONITORING): change-only entities are not judged stale; the lead fan is watched as a metric.
UPDATE public.sensor_registry SET active = false
 WHERE sensor_id IN ('state.lead_fan', 'equipment.sntp_status') AND active;

-- Successor seals: the probe of the rolled-back native qualification measures them, and each receipt is re-sealed.
-- PENDING: the literals below are 313's until the probe measures them, so an unqualified file stops here.
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '4a39a38fcb5cebc8aa5385b8569db3969fece16210e5c505188624c1b84f6820'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM 'ca2eea00fdfbbef0ddc34a8d29471d5ffc98c299e17b0772f9ee583fdb5e831f'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '5b31cf1e74b78963e266cfd22dc3867a7972dbb53eff209f3c121781fb90f8dc'
    THEN RAISE EXCEPTION '314 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('4a39a38fcb5cebc8aa5385b8569db3969fece16210e5c505188624c1b84f6820','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '314 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('ca2eea00fdfbbef0ddc34a8d29471d5ffc98c299e17b0772f9ee583fdb5e831f','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '314 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('5b31cf1e74b78963e266cfd22dc3867a7972dbb53eff209f3c121781fb90f8dc','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '314 missing mcp receipt'; END IF;
    IF EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
    THEN RAISE EXCEPTION '314 receipts do not match the successor seals'; END IF;
END $successor$;
