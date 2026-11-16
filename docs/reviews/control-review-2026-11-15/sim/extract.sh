#!/usr/bin/env bash
# One-time read-only extracts from verdify prod DB -> local CSV. Sequential, bounded.
set -uo pipefail
REPO="$(git rev-parse --show-toplevel)"
OUT="$(cd "$(dirname "$0")/../data" && pwd)"
q() { # name, sql
  local name="$1" sql="$2"
  local t0=$(date +%s)
  "$REPO/scripts/verdify-db.sh" prod -q -v ON_ERROR_STOP=1 \
    -c "SET statement_timeout='170s'" -c "SET default_transaction_read_only=on" -c "SET max_parallel_workers_per_gather=2" \
    -c "COPY ($sql) TO STDOUT WITH CSV HEADER" </dev/null > "$OUT/$name.csv" 2> "$OUT/$name.err"
  local rc=$?
  echo "$name rc=$rc rows=$(($(wc -l < "$OUT/$name.csv")-1)) bytes=$(wc -c < "$OUT/$name.csv") secs=$(( $(date +%s)-t0 )) $(head -c 200 "$OUT/$name.err" | tr '\n' ' ')"
  [ -s "$OUT/$name.err" ] || rm -f "$OUT/$name.err"
}
r2() { echo "round(($1)::numeric,2) AS $1"; }
r3() { echo "round(($1)::numeric,3) AS $1"; }

q climate_raw "SELECT ts, $(r2 temp_avg), $(r2 temp_control), $(r2 temp_north), $(r2 temp_south), $(r2 temp_east), $(r2 temp_west), $(r2 temp_case), $(r2 temp_intake), $(r2 rh_avg), $(r2 rh_north), $(r2 rh_south), $(r2 rh_east), $(r2 rh_west), $(r3 vpd_avg), $(r3 vpd_control), $(r3 vpd_north), $(r3 vpd_south), $(r3 vpd_east), $(r3 vpd_west), $(r2 dew_point), $(r3 abs_humidity), $(r2 enthalpy_delta), $(r2 co2_ppm), $(r2 lux), $(r3 dli_today), $(r2 ppfd), $(r3 flow_gpm), $(r2 water_total_gal), $(r2 mister_water_today), $(r2 outdoor_temp_f), $(r2 outdoor_rh_pct), $(r2 pressure_hpa), $(r2 wind_speed_mph), $(r2 outdoor_lux), $(r2 solar_irradiance_w_m2), $(r2 solar_altitude_deg), $(r2 intake_rh), $(r3 solar_phase), $(r2 house_temp_target_f), $(r3 house_vpd_target), $(r2 leaf_temp_north), $(r2 leaf_temp_south) FROM climate WHERE ts >= '2025-11-13' ORDER BY ts"
q equipment_state "SELECT ts, equipment, state::int AS state FROM equipment_state WHERE ts >= '2025-11-01' ORDER BY ts"
q energy_raw "SELECT ts, round(watts_total::numeric,1) watts_total, round(watts_heat::numeric,1) watts_heat, round(watts_fans::numeric,1) watts_fans, round(watts_other::numeric,1) watts_other, round(kwh_today::numeric,3) kwh_today, round(ch0_power_w::numeric,1) ch0_power_w, round(ch1_power_w::numeric,1) ch1_power_w FROM energy WHERE ts >= '2025-11-13' ORDER BY ts"
q climate_action_log "SELECT ts, climate_action, priority_axis, round(temp_low_f::numeric,2) temp_low_f, round(temp_target_f::numeric,2) temp_target_f, round(temp_high_f::numeric,2) temp_high_f, round(vpd_low_kpa::numeric,3) vpd_low_kpa, round(vpd_target_kpa::numeric,3) vpd_target_kpa, round(vpd_high_kpa::numeric,3) vpd_high_kpa, round(temp_band_error_f::numeric,2) temp_band_error_f, round(vpd_band_error_kpa::numeric,3) vpd_band_error_kpa, moisture_assist_state, moisture_zone, wet_assist_allowed, wet_assist_block_reason, fog_allowed, fog_block_reason, plan_id, climate_intent_version FROM climate_action_log ORDER BY ts"
q setpoint_changes_nonband "SELECT ts, parameter, value, source, zone, planner_instance, trigger_id, delivery_status, confirmed_at, expired_at FROM setpoint_changes WHERE source <> 'band' ORDER BY ts"
q setpoint_changes_band_daily "SELECT ts::date AS day, parameter, count(*) n, min(value) vmin, max(value) vmax, count(DISTINCT value) n_distinct FROM setpoint_changes WHERE source = 'band' GROUP BY 1,2 ORDER BY 1,2"
q snapshot_house_band_5m "SELECT time_bucket('5 minutes', ts) AS t, parameter, round(avg(value)::numeric,3) v FROM setpoint_snapshot WHERE parameter LIKE 'band_house_%' GROUP BY 1,2 ORDER BY 1,2"
q snapshot_param_daily "SELECT ts::date AS day, parameter, count(*) n, min(value) vmin, max(value) vmax, count(DISTINCT round(value::numeric,4)) n_distinct FROM setpoint_snapshot GROUP BY 1,2 ORDER BY 1,2"
q daily_summary "SELECT * FROM daily_summary ORDER BY date"
q daily_band_compliance "SELECT * FROM daily_band_compliance ORDER BY date"
q mv_daily_kpi "SELECT * FROM mv_daily_kpi ORDER BY date"
q mv_equipment_runtime_daily "SELECT day, equipment, on_minutes, cycles, starts, cycles_under_1m, cycles_1m_to_5m, short_cycles_under_5m, cycles_5m_to_15m, cycles_15m_plus, peak_transitions_per_hour, is_complete_day, quality FROM mv_equipment_runtime_daily ORDER BY day, equipment"
q crop_band_anchors "SELECT * FROM crop_band_anchors ORDER BY id"
q planner_lessons "SELECT * FROM planner_lessons ORDER BY id"
q planner_trigger_ledger "SELECT id, event_type, event_label, instance, expected_at, due_at, delivered_at, resolved_at, status, expected_action, sla_seconds, catchup, trigger_id, resulting_plan_id, terminal_action, terminal_at, failure_class, had_required_failure, left(notes,200) notes FROM planner_trigger_ledger ORDER BY id"
q plan_delivery_log "SELECT id, delivered_at, event_type, event_label, wake_mode, gateway_status, resulting_plan_id, plan_written_at, trigger_id, instance, acked_at, status, terminal_action, terminal_at, failure_class FROM plan_delivery_log ORDER BY id"
q plan_journal "SELECT plan_id, created_at, left(conditions_summary,600) conditions_summary, left(hypothesis,800) hypothesis, left(experiment,600) experiment, left(expected_outcome,600) expected_outcome, params_changed, left(actual_outcome,800) actual_outcome, outcome_score, left(lesson_extracted,600) lesson_extracted, validated_at, planner_instance, trigger_id, anchor_score, climate_intent_version, guardrail_penalty, valid_from, expires_at, lifecycle_status FROM plan_journal ORDER BY created_at"
q planner_inference_runs "SELECT run_id, scheduled_in_arm, provider, model_id, started_at, ended_at, retries, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, billed_cost_usd, energy_wh, trigger_id, event_type, status, finish_reason, latency_ms, reasoning_tokens, attempt, attempt_kind, pack_variant, mode, dispatched, left(error,300) error FROM planner_inference_runs ORDER BY started_at"
q override_events "SELECT ts, override_type, mode, left(details::text,400) details FROM override_events ORDER BY ts"
q setpoint_clamps_monthly "SELECT date_trunc('month', ts)::date AS month, parameter, reason, status, count(*) n, round(avg(requested)::numeric,3) avg_requested, round(avg(applied)::numeric,3) avg_applied FROM setpoint_clamps GROUP BY 1,2,3,4 ORDER BY 1,2"
q alert_log_monthly "SELECT date_trunc('month', ts)::date AS month, alert_type, severity, category, source, count(*) n, count(resolved_at) n_resolved FROM alert_log GROUP BY 1,2,3,4,5 ORDER BY 1,6 DESC"
q forecast_action_monthly "SELECT date_trunc('month', triggered_at)::date AS month, rule_name, action_taken, param, outcome, count(*) n FROM forecast_action_log GROUP BY 1,2,3,4,5 ORDER BY 1,6 DESC"
q diagnostics_hourly "SELECT time_bucket('1 hour', ts) AS t, max(firmware_version) firmware_version, min(heap_bytes) heap_min, round(avg(heap_bytes)::numeric,0) heap_avg, min(heap_min_free_kb) heap_min_free_kb, min(heap_largest_free_block_kb) heap_largest_block_kb, min(uptime_s) uptime_min, max(uptime_s) uptime_max, max(reset_reason) reset_reason, round(avg(wifi_rssi)::numeric,1) rssi, max(relief_cycle_count) relief_cycles, max(band_source) band_source, min(active_probe_count) probes_min, max(sntp_miss_count) sntp_miss, count(*) n FROM diagnostics GROUP BY 1 ORDER BY 1"
q system_state_modes "SELECT ts, entity, left(value,300) value FROM system_state WHERE entity IN ('greenhouse_state','mode_reason','last_transition','climate_action','climate_priority_axis','overrides_active','climate_moisture_assist_state','mister_state','fog_block_reason','moisture_block_reason','dispatcher_stage') ORDER BY ts"
q system_state_entity_counts "SELECT entity, count(*) n, min(ts) first_ts, max(ts) last_ts, count(DISTINCT value) n_distinct FROM system_state GROUP BY 1 ORDER BY 2 DESC"
q setpoint_plan_monthly "SELECT date_trunc('month', created_at)::date AS month, parameter, source, count(*) n, count(DISTINCT plan_id) n_plans, min(value) vmin, max(value) vmax FROM setpoint_plan GROUP BY 1,2,3 ORDER BY 1,2"
q water_daily "SELECT ts::date AS day, attribution_class, attributed_scope, count(*) n, round(sum(delta_gal)::numeric,2) gal FROM water_meter_events GROUP BY 1,2,3 ORDER BY 1"
# achievable_envelope was dropped by migration 309 (2026-11-15): this query, kept as it was run, fails on the
# current schema. The simulator does not use its output.
q achievable_envelope "SELECT zone, season, hour_of_day, env_temp_lo_floor, env_temp_hi_cap, env_temp_achievable_p50, env_vpd_lo_floor, env_vpd_hi_cap, cap_source, is_active FROM achievable_envelope ORDER BY 1,2,3"
q resource_coefficients "SELECT * FROM resource_coefficients ORDER BY id"
q equipment "SELECT * FROM equipment ORDER BY 1"
q schema_migrations_tail "SELECT * FROM schema_migrations ORDER BY 1 DESC LIMIT 60"
echo EXTRACT_DONE
