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
            AND sha256='415691b042963a5621ead41b8ee887061dffb806ab8795d831b0edc68130a507'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>313)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22'
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

-- Successor seals: the probe of the rolled-back native qualification measures them, and each receipt is re-sealed.
-- PENDING: the literals below are 313's until the probe measures them, so an unqualified file stops here.
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22'
    THEN RAISE EXCEPTION '314 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '314 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '314 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '314 missing mcp receipt'; END IF;
    IF EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
    THEN RAISE EXCEPTION '314 receipts do not match the successor seals'; END IF;
END $successor$;
