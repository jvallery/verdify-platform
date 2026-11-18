# Alert coverage matrix (2026-11-16, RULINGS N3c)

The coverage matrix for #1713: every failure mode of the climate system against what detects it, its severity,
whether it pages and its test. The ingestor monitor's tests run in CI (`tests/test_coverage_alerts.py`,
`tests/test_coverage_alerts_h3.py`); the rule tests of monitoring-stack run in that repository.

Target state: the law runs on the controller, the planner is a daily reviewer, the daily record is the measure, and the
experiment platform is retired. Sources read for "detected by":
- the ingestor monitor on the frozen branch (climate/alerts a1a37100 = train H1), `host-law` (H1: `sensor_fault`,
  `payload_rejected`), `host-law-outputs` (phase 3: `law_constants_mismatch`) and `planner` (H3: `daily_review_missed`);
- the live monitoring-stack rule ConfigMaps (`prometheus-rules*.yaml` on verdify/climate-alerts, #1947);
- the live sensor registry (`v_sensor_staleness`, 115 rows) and 14 days of `alert_log`.

**Paging.** Prometheus `VerdifyGreenhouseAlertOpen` pages any open **critical** `alert_log` row after 2 min, through
Alertmanager receiver `ha-local-push` (Home Assistant Companion Local Push, one push per `alert_type`). Warning and info
rows never page: they stay on the dashboard (Activity on dashboard.verdify.ai). Slack was decommissioned on
2026-11-17, so Home Assistant push is the only alert path. A few monitoring-stack rules over the product metrics push
a warning to Home Assistant on purpose (`VerdifyFurnaceSaturated`); others, such as `VerdifyControllerWifiWeak`,
follow the Alertmanager severity tree as warnings. So "pages" means a critical row or a critical Prometheus rule.

**Status column:** `today` = live before the refactor; `H1` = host release 1 (#1687); `H2` = host release 2 (#1728,
synced 2026-11-16); `H3` = host release 3 (#1730); `MISSING` = nothing detects it. Production runs a later host
release that contains all three, so every `H1`/`H2`/`H3` row is live.

**"live-only" tests:** `tests/test_08_observability.py` and `test_12_fidelity.py` run against the live stack
(`make test`). CI does not run them, so they count as no CI test.

**Where the tests run in CI.** The pure-function tests are in the pure-logic list of `scripts/ci-local.sh` (the
required `ci / validate` check): `tests/test_coverage_alerts.py`, `tests/test_coverage_alerts_h3.py`,
`tests/test_live_path_alerts.py` (gap #17), `tests/test_climate_alerts_1_3.py` and `tests/test_law_host_entities.py`.
The SQL reads are tested against a private PostgreSQL in the required `ci / campaign` check
(`tests/test_dashboard_db_coverage_alerts.py`, `tests/test_dashboard_db_coverage_alerts_h3.py`,
`tests/test_dashboard_db_climate_alerts.py`). The rule tests of monitoring-stack run in that repository.

## Status at 2026-11-17: every recommended gap is built

All 19 gaps below and the `soil_dryout` fix are built and live; the only failure mode still without a detector is the
grow light commanded on but dark, accepted with its reason in section 8. Severities and thresholds as built (they
differ from the first proposal where a ruling or the data changed them):

| # | Built as | Severity (pages?) | Threshold as built | Release | CI tests |
|---|---|---|---|---|---|
| 1 | `relay_starts_high` | warning | starts in the last hour above 12 (heat1, heat2, fan1, fan2, vent) or 15 (fog) | H2 | test_coverage_alerts.py; test_dashboard_db_coverage_alerts.py |
| 2 | `relay_pair_forbidden` | warning | the furnace with the vent open, or a fan with the vent closed, held 5 min | H2 | as #1 |
| 3 | `outdoor_source_none`; with a degraded indoor reading `outdoor_none_indoor_degraded`; the intake probe alone `outdoor_intake_only` | warning; **critical, pages**; warning | 15 min; 10 min; 30 min | H2; H3; H3 | as #1; test_coverage_alerts_h3.py, test_dashboard_db_coverage_alerts_h3.py |
| 4 | `law_state_stale` | warning | no `climate_law_state` row for 3 min while the controller is connected and runs the law | H3 | test_dashboard_db_coverage_alerts_h3.py |
| 5 | `power_meter_stale` | warning | no `energy` sample on a channel for 30 min | H2 | as #1 |
| 6 | `case_sensor_only` | **critical, pages** (RULINGS AA1) | every wall probe silent with the case sensor reporting, 10 min | H2 | as #1 |
| 7 | `house_temp_band_drift` | warning | most of an hour more than 3 F outside the served band | H2 | as #1 |
| 8 | `daily_record_missing` | warning | yesterday's daily record or compliance row missing after 06:00 local | H2 | as #1 |
| 9 | `reviewer_wrote_climate` | **critical, pages** | any climate setting row from a retired writer after the H3 cutover | H3 | test_coverage_alerts_h3.py, test_dashboard_db_coverage_alerts_h3.py |
| 10 | change-only entities left out of `sensor_offline` | none | | H2 | test_coverage_alerts.py |
| 11 | `wetting_below_vpd_band` | warning | fog or a mister on with house VPD below the band's low edge, 5 min | H3 | test_dashboard_db_coverage_alerts_h3.py |
| 12 | `drying_meter_fault` | warning | the drying meter flat for 10 min during a drying run, or stepping back with no restart | H3 | test_coverage_alerts_h3.py |
| 13 | `utility_out_of_baseline` (also meter coverage below 70 %), `drying_refused_all_day` | warning | a day above 1.5 times the baseline (10 or more days of history) | H3 | test_coverage_alerts_h3.py, test_dashboard_db_coverage_alerts_h3.py |
| 14 | `probes_disagree` | warning | wall spread above 12 F or one probe more than 6 F off the median, most of 30 min | H3 | as #13 |
| 15 | monitoring-stack `VerdifyControllerWifiWeak` | warning (no page) | `verdify_controller_wifi_rssi_dbm` below -80 for 15 min (the controller hardware budget) | monitoring-stack | that repository's rule tests |
| 16 | `boot_stuck` | warning | `mode_reason = 'init'` after 300 s of uptime | H2 | as #1 |
| 17 | CI tests for `temp_safety`, `safety_invalid`, `heat_staging_inversion`, `lighting_cfg_threshold_drift` | none | | H3 | test_live_path_alerts.py |
| 18 | `owner_value_changed` | warning | an owner-held value read back different for 15 min | H3 | test_dashboard_db_coverage_alerts_h3.py |
| 19 | `relay_counters_backstep` | info | a relay counter stepping back with no restart | H3 | test_coverage_alerts_h3.py, test_dashboard_db_coverage_alerts_h3.py |
| `soil_dryout` fix | hysteresis of about 1 point, no reading of a probe with an open offline row | critical (unchanged) | | H2 | test_coverage_alerts.py, test_soil_dryout_alert.py |

Also in H3: `esp32_reboot` is a warning, critical at three restarts in 60 minutes (RULINGS AF8); `mcp_unreachable` is
a warning; `vpd_stress`, `vent_vpd_moisture_gap` and `vent_moisture_capacity_limit` are retired
(test_live_path_alerts.py checks that none is raised). Paging overall is now: `sensor_fault`, `case_sensor_only`,
`outdoor_none_indoor_degraded`, `clock_unconfirmed`, `setpoint_delivery_stuck` at 45 min, `reviewer_wrote_climate`,
three restarts in an hour, and the hard-safety pages listed below. The first-proposal tables that follow are kept as
the record; their Status column is updated to the built state.

**Built for H2 (FROZEN-H2 997b1bfa, RULINGS Q4):** gaps 1, 2 (held 5 min, see the state file), 3, 5 (liveness at
30 min), 6, 7, 8, 10, 16 and the `soil_dryout` fix. New types: `relay_pair_forbidden`, `outdoor_source_none`,
`case_sensor_only`, `boot_stuck`, `power_meter_stale`, `daily_record_missing`, `house_temp_band_drift`,
`relay_starts_high` (all warnings). H3: gap 9 (critical), 4, 11 to 15, 17 to 19, the `mcp_unreachable` demotion,
and retiring the alerts that judge the engine's choices.

## Top: gaps I recommend building, in priority order

Sizes: S = one SQL read and one pure function, about 1 h with tests. M = 2 to 4 h.

| # | Gap | Size | Severity (pages?) | Train |
|---|---|---|---|---|
| 1 | Relay starts per hour above the rollback criteria (12 for heat1/heat2/fan1/fan2/vent, 15 for fog), from `relay_counters` deltas (a negative delta counts 0) | M | warning | H2 (counters land in H1) |
| 2 | Forbidden relay pair held 2 min: furnace (heat2) with the vent open, or a fan with the vent closed (`equipment_state`) | S | warning | H2 |
| 3 | No outdoor source: `outdoor_source = 'none'` for 15 min. With `sensor_fault` this is the doubly blind state (N3b) | S | warning; `sensor_fault` already pages and carries `outdoor_source` | H2 |
| 4 | Law state record stale: no `climate_law_state` row for 3 min while the controller is connected, gated on the law firmware being installed | S | warning | H3 (after the law flash; before it, it would be noise) |
| 5 | Power meters stale: no fresh `energy` ch0/ch1 sample for 15 min. `heat_no_power` is silent on a frozen meter, and `energy` is not in the staleness registry | S | warning | H2 |
| 6 | Running on the case sensor only: `sensor_degraded_active = 1`, or every wall temperature stale, for 10 min (one row instead of four per-probe rows) | S | warning | H2 |
| 7 | House temperature outside the band for longer than a limit. `house_band_drift` reads VPD only; temperature has only the 40/100 F limits | S | warning | H2 |
| 8 | Daily record or compliance row missing for yesterday after 06:00 local | S | warning | H2 |
| 9 | The reviewer wrote a climate value: any `setpoint_changes` row with source `iris`/`plan` after the H3 cutover. It cannot fire falsely | S | **critical (your call)**; the refusal itself is structural (tools removed) | H3 |
| 10 | Exclude change-only entities (`equipment.*`, `state.*`) from `sensor_offline`. `equipment.sntp_status` and `state.lead_fan` read stale now, so this is latent noise | S | none | H2 |
| 11 | Fog or misters running while house VPD is below the band's low edge for 5 min | S | warning | H3 |
| 12 | Drying meter stepping back without a restart, or not growing while the law reports drying | M | warning | H3 |
| 13 | Utilities: daily electricity, gas or water outside the 30-day baseline (for example above p95 × 1.5); meter coverage below 70 %; drying cost limit refusing all day (`dr` = cost for every row of a day). All read the daily record once a day | M | warning | H3 or later |
| 14 | Probes disagreeing: wall temperature spread above 6 F, or one probe more than 4 F off the median, for 30 min | S | warning | H2 |
| 15 | WiFi weak: `wifi_rssi` below -75 dBm for 30 min | S | warning | H2 |
| 16 | Boot stuck: `mode_reason = 'init'` more than 5 min after a boot (boot grace or furnace wait not released) | S | warning | H2 |
| 17 | Tests for live-path alerts with no CI test: `temp_safety`, `safety_invalid`, `heat_staging_inversion`, `lighting_cfg_threshold_drift` | S | none | H2 |
| 18 | Owner-held value changed by something else: newest readback differs from an owner-manual desired value for 15 min (today `setpoint_delivery_stuck` sees it at 15 and 45 min, but not as "changed by someone") | S | warning | H3 |
| 19 | Relay counters stepping back with no restart (uptime did not drop) | S | info | H3 |

**Should page.** Only #9, if you agree. Everything else is a warning. The owner ratified three paging alerts, and the
existing pages below already cover hard safety: `temp_safety`, `leak_detected`, `irrigation_fence_breach`,
controller dark, and DB down or backup stale.

**Noise to fix or drop (the owner pays for every page):**
- **`soil_dryout` (critical): 5 pages in 4 days, all false.** All came from `soil_moisture_south_1` hovering at
  19.3 to 19.7 % against a 20 % wilt line, each auto-resolving. The probe is now offline (out of the soil until the
  reorganization, `jvallery/verdify-platform#1584`). Fix: about 1 point of hysteresis, plus skip a probe with an open
  offline row; or make it a warning until the probes are back in the soil.
- **Planner-era criticals.** `planner_gateway_delivery_failed` and `planner_required_plan_missed` paged 3 times in
  14 days. They retire in H3 per the reviewer design (#1659). `lighting_cfg_threshold_drift` (critical) and
  `mcp_unreachable` (critical heartbeat) are not on that list. After H3, MCP serves only the daily review and
  irrigation tools, so demote `mcp_unreachable` to warning (`daily_review_missed` is the real signal). Keep
  `lighting_cfg_threshold_drift` critical only if lighting thresholds stay host-pushed; otherwise demote it.
- **Warning volume.** `vpd_stress` 88, `house_band_drift` 36 and `sensor_offline` 36 rows in 14 days.
  `vpd_stress`, `vent_vpd_moisture_gap` and `vent_moisture_capacity_limit` judge the retired engine's choices. Under
  the law, band compliance is the daily record's job, so retire them with the law flash (H3). Keep
  `house_band_drift` with a longer limit.
- **Known maintenance.** The hydro probe (orp, battery, tds silent) and soil probes 04/07/08/09 keep rows open.
  Silence them until the reorganization; do not page.
- **Hermes not ready for 13 min today.** `VerdifyIrisUnavailable` is a warning after 10 min with no replica
  available, so not paging was correct for a pod that restarted itself. The page-worthy signal is the missed daily
  review (`daily_review_missed`, warning, H3). No change recommended.

## 1. Sensors

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| One indoor probe lost (north/south/east/west temp or RH) | ingestor `sensor_offline` per column from `v_sensor_staleness` (`climate.temp_*`, `climate.rh_*`, `climate.vpd_*`) | warning | no | registry threshold (staleness_ratio > 1) | test_alert_probe_offline_lifecycle.py, test_climate_alerts_1_3.py | none | today |
| All wall probes lost, running on the case sensor | ingestor `case_sensor_only` (one row for the state) | critical | **yes** | 10 min | test_coverage_alerts.py, test_dashboard_db_coverage_alerts.py | none (gap #6 built) | H2 |
| No valid indoor temperature (SENSOR_FAULT) | ingestor `sensor_fault` (`system.greenhouse_state`, ≥ 120 s; details carry `outdoor_source`, relays) | critical | **yes** | 2 min + 2 min | host-law tests/test_law_host_entities.py | none | H1 |
| Humidity invalid (G2/G2a) | `sensor_offline` on `climate.rh_*` (the G2a warning) | warning | no | registry threshold | as row 1 | none | today |
| Probes disagreeing | ingestor `probes_disagree` | warning | no | most of 30 min | test_coverage_alerts_h3.py, test_dashboard_db_coverage_alerts_h3.py | none (gap #14 built) | H3 |
| Outdoor station stale (Tempest) | `sensor_offline` on `climate.outdoor_temp_f`, `outdoor_rh_pct` and the weather columns | warning | no | registry threshold | as row 1 | none | today |
| Intake probe lost | `sensor_offline` on `climate.temp_intake`, `intake_rh` | warning | no | registry threshold | as row 1 | none | today |
| No outdoor source at all | ingestor `outdoor_source_none`; `outdoor_none_indoor_degraded` with a degraded indoor reading; `outdoor_intake_only` on the intake probe alone | warning / critical / warning | the degraded case: **yes** | 15 / 10 / 30 min | test_coverage_alerts.py, test_coverage_alerts_h3.py and their DB tests | none (gap #3 built) | H2 / H3 |
| Soil probes | ingestor `soil_sensor_offline` per probe (long-offline lifecycle) | warning | no | probe cadence | test_alert_probe_offline_lifecycle.py, test_alert_silences.py | noise: silence the out-of-soil probes | today |
| Hydro probe | `sensor_offline` with `sensor_id = device.hydro_probe` (one row per device) | warning | no | registry threshold | test_climate_alerts_1_3.py | opens on the first pass (real, long-silent); silence until fixed | H1 |
| Water flow meter | `sensor_offline` on `climate.flow_gpm` / `water_total_gal`; `leak_detected` (flow with every valve closed) | warning / critical | leak: yes | threshold / monitor pass | test_alert_leak_lifecycle.py, test_alert_leak_attended.py | none | today |
| Power meters (greenhouse Shelly) | ingestor `power_meter_stale` (no `energy` sample on a channel for 30 min); monitoring-stack `FleetHardwareNativeUnavailable`/`FleetIPProbeUnavailable` (device reachability) | warning | no | 30 min | test_coverage_alerts.py, test_dashboard_db_coverage_alerts.py | none (gap #5 built) | H2 |
| Greenhouse HA probes (04 south air, 08, 09) | monitoring-stack `VerdifySouthAirProbeUnavailable`, `VerdifySouth2SoilProbeUnavailable`, `VerdifyWestSoilProbeUnavailable` | info | no | 15 min | tests/verdify-runtime-health.yaml | known noise (#1584) | today |

## 2. Controller

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| Offline / dark | monitoring-stack `VerdifyControllerDark` (ESP32 writer connections averaged under 0.5 over 20 min, or 6+ changes in 30 min); `VerdifyWriterCountNotExactlyOne`; ingestor `sensor_offline` `device.controller_diagnostics` | critical / critical / warning | **yes** | 2 min after a 20 min average | monitoring-stack writer-exporter rule tests | none | today |
| Unexpected restart | ingestor `esp32_reboot` (uptime reset on the same firmware, with its reset reason); monitoring-stack `VerdifyControllerRestarted` | warning; critical at 3 in 60 min | at 3 in 60 min: **yes** | monitor pass | test_coverage_alerts_h3.py, test_dashboard_db_coverage_alerts_h3.py | none (RULINGS AF8) | H3 |
| Restart loop | `VerdifyControllerDark` connection-flap branch (6+ changes in 30 min) | critical | yes | 2 min | writer-exporter rule tests | none | today |
| Heap low | ingestor `heap_pressure_warning`, `heap_pressure_critical` (debounced firmware flag) | warning / critical | critical: yes | monitor pass | test_heap_low_watermark_alert.py, test_dispatcher_* | none | today |
| WiFi signal weak | monitoring-stack `VerdifyControllerWifiWeak` (`verdify_controller_wifi_rssi_dbm` < -80 for 15 min) | warning | no | 15 min | monitoring-stack rule tests | none (gap #15 built) | monitoring-stack |
| Clock untrusted or wrong | ingestor `clock_unconfirmed` (10-min median offset > 120 s, or `sntp_valid` 0 for 30 min) | critical | **yes** | 10 to 30 min | test_climate_alerts_1_3.py, test_dashboard_db_climate_alerts.py | none | H1 |
| Firmware version differs from the pin | ingestor `firmware_version_mismatch` | warning | no | monitor pass | test_08_observability.py (live-only), test_sensor_health_sweep.py | none | today |
| Constants hash differs | ingestor `law_constants_mismatch` (newest hash under 2 h old) | info | no | hourly receipt | host-law-outputs tests/test_law_host_entities.py | none | H2/H3 (host-law-outputs) |
| Relay counters stepping back | ingestor `relay_counters_backstep` (no restart in between) | info | no | monitor pass | test_coverage_alerts_h3.py, test_dashboard_db_coverage_alerts_h3.py | none (gap #19 built) | H3 |
| Boot left the furnace wait or boot grace stuck | ingestor `boot_stuck` (`mode_reason = 'init'` after 300 s of uptime) | warning | no | 5 min | test_coverage_alerts.py, test_dashboard_db_coverage_alerts.py | none (gap #16 built) | H2 |
| Firmware breaker latched / relief ceiling | ingestor `firmware_vent_latched`, `firmware_relief_ceiling` | per payload | per payload | monitor pass | test_08_observability.py (live-only) | review against the law (these are engine-era rails) | today |

## 3. Control

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| Law state record stale | ingestor `law_state_stale` (no row for 3 min, controller connected, law installed) | warning | no | 3 min | test_dashboard_db_coverage_alerts_h3.py | none (gap #4 built) | H3 |
| Law state record malformed | ingestor `payload_rejected` (rejected on every receipt for 10 min) | warning | no | 10 min | host-law tests/test_law_host_entities.py | none | H1 |
| Protection limit engaged (≤ 40 F, ≥ 100 F) | ingestor `temp_safety` on `climate.temp_avg` (newest row within 10 min) | critical | **yes** | monitor pass + 2 min | test_live_path_alerts.py | none (gap #17 built); reads `temp_avg`, so with no valid temperature `sensor_fault` covers it | today |
| House outside the band too long | ingestor `house_band_drift` (VPD), `house_temp_band_drift` (temperature, gap #7), `vpd_extreme` | warning | no | sustained window; most of an hour 3 F out | test_verdify_services_alerts.py, test_coverage_alerts.py | none (gap #7 built) | today / H2 |
| Band served differs from the database band | ingestor `band_device_db_divergence` (edge or target branch) | warning | no | monitor pass | test_climate_alerts_1_3.py | none | H1 |
| Forbidden relay pair (furnace with vent, fan with vent closed) | ingestor `relay_pair_forbidden` (held 5 min); `heat_staging_inversion` for heat2 without heat1 | warning | no | 5 min | test_coverage_alerts.py, test_dashboard_db_coverage_alerts.py, test_live_path_alerts.py | none (gap #2 built) | H2 |
| Relay starts per hour above the rollback criteria | ingestor `relay_starts_high` | warning | no | hourly | test_coverage_alerts.py, test_dashboard_db_coverage_alerts.py | none (gap #1 built) | H2 |
| Relay commanded, no power drawn (heater) | ingestor `heat_no_power` (heat1 on 15 min, fresh samples < 500 W) | warning | no | 15 min | test_climate_alerts_1_3.py, test_dashboard_db_climate_alerts.py | none (meters exist for the heaters only) | H1 |
| Power drawn, relay off (heater) | ingestor `heat_manual_override` (> 1000 W with both heat relays off for 15 min) | warning | no | 15 min | as above | none | H1 |
| Relay stuck on against demand | ingestor `relay_stuck` | warning | no | monitor pass | test_dashboard_db_settings_alerts.py | none | today |
| Manual override left on | ingestor `owner_value_changed` (an owner-held value read back different for 15 min); `setpoint_delivery_stuck` | warning | no | 15 min | test_dashboard_db_coverage_alerts_h3.py | none (folded into gap #18) | H3 |
| Drying meter not growing or stepping back | ingestor `drying_meter_fault` | warning | no | 10 min | test_coverage_alerts_h3.py | none (gap #12 built) | H3 |
| Fog or misters below the band's low edge | ingestor `wetting_below_vpd_band` (held 5 min) | warning | no | 5 min | test_dashboard_db_coverage_alerts_h3.py | none (gap #11 built) | H3 |
| Safety rails zeroed or invalid | ingestor `safety_invalid` | critical | yes | 5 min | test_live_path_alerts.py | none (gap #17 built) | today |

## 4. Delivery

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| A setting or band value not delivered | ingestor `setpoint_delivery_stuck` (database only; K1 exempts the legacy band scalars under the on-chip band) | warning 15 min, critical 45 min | **yes at 45 min** | 15 / 45 min | test_climate_alerts_1_3.py, test_dashboard_db_climate_alerts.py | none | H1 |
| One push refused or failed | ingestor `esp32_push_failed`, `setpoint_unconfirmed` | warning | no | event | test_alert_producer_payloads.py, test_dispatcher_desired_state.py | none | today |
| Plan written, nothing delivered | ingestor `plan_not_delivered` | warning | no | 30 / 90 min | test_climate_alerts_1_3.py, test_dashboard_db_climate_alerts.py | retires with plans (H3) | H1 |
| Owner-held value changed by something else | ingestor `owner_value_changed`; `setpoint_delivery_stuck` | warning; critical at 45 min | at 45 min | 15 / 45 min | test_dashboard_db_coverage_alerts_h3.py, test_climate_alerts_1_3.py | none (gap #18 built) | H3 |
| A band the law cannot run on | `band_fn_null` (API, critical); `safety_invalid`; `band_device_db_divergence` | critical / critical / warning | yes | request / monitor pass | test_08_observability.py (live-only) | add a CI test for `band_fn_null` | today |

## 5. Data flows

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| Ingestor not writing: climate | `sensor_offline` on every climate column; `VerdifyControllerDark` if the connection drops | warning | no (dark pages) | registry threshold | as section 1 | none | today |
| equipment_state | change-only rows, left out of `sensor_offline` | | | | test_coverage_alerts.py | none (gap #10 built); a fan or relay that never changes is caught by gap #1 counters | H2 |
| counters (`relay_counters`) | NONE (written on change) | | | | | none needed: no row = no movement | n/a |
| readbacks pass (`setpoint_snapshot`) | `setpoint_delivery_stuck` (reads the newest readback per parameter; no readback in a day = not judged) | | | | | add "no snapshot pass for 30 min" to the delivery cycle (S) if wanted | partial |
| diagnostics | `sensor_offline` `device.controller_diagnostics` | warning | no | threshold | test_climate_alerts_1_3.py | none | H1 |
| Rows rejected by validation | ingestor `payload_rejected` (law payloads); ingestor log `row failed schema validation` for the rest | warning | no | 10 min | host-law test_law_host_entities.py | none for law payloads; legacy rows are log-only | H1 |
| Daily record / compliance store not written for a day | ingestor `daily_record_missing` (after 06:00 local) | warning | no | daily | test_coverage_alerts.py, test_dashboard_db_coverage_alerts.py | none (gap #8 built) | H2 |
| Refresh CronJob failing (`verdify-band-curve-refresh`, lab publisher, every `verdify-prod` CronJob) | monitoring-stack `KubeJobFailed`, `KubeCronJobRepeatedFailures`, `KubeCronJobSuccessStale`, `KubeCronJobNotScheduled` | warning | no | 5 to 10 min | kubernetes-baseline rule tests | none | today |
| Migration or hook failing a sync | Argo `ArgoCDApplicationDegraded` (30 min); the sync is attended and manual, so the operator sees the failed operation | warning | no | at sync | gitops rule tests | none | today |
| Database down | monitoring-stack `VerdifyDatabaseUnavailable` (StatefulSet not Ready 3 min) | critical | yes | 3 min | tests/verdify-runtime-health.yaml | none | today |
| Writer lease or exporter unsafe | `VerdifyWriterLeaseUnsafe`, `VerdifyWriterLeaseObservationUnknown`, `VerdifyWriterExporterCoverageIncomplete` | critical | yes | 1 to 2 min | writer-exporter rule tests | none | today |
| Backups | owning lane storage-infra via monitoring-stack `VerdifyDBBackupStale` (critical), `VerdifyDBBackupMetricsUnavailable` | critical / warning | yes | 15 min | verdify-backup rule tests | none (not ours) | today |
| Alert feed itself blind | `VerdifyAlertFeedDown` (operator API cannot read `alert_log` 15 min) | critical | yes | 15 min | tests/verdify-greenhouse-alerts.yaml | none | today |
| Public routes down | `VerdifyProdRouteProbeDown`, SLO burn-rate pairs | critical / warning | yes | 2 to 3 min | edge rule tests | none | today |

## 6. Reviewer and planner

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| Daily review missed | ingestor `daily_review_missed` (after 10:00 local, no written row for yesterday) | warning | no | daily | planner tests/test_daily_review_task.py; monitoring-stack #1947 rule test | none | H3 |
| Reviewer writes a climate value | structurally refused (MCP tools removed, `set_setting` gone) and ingestor `reviewer_wrote_climate` | critical | **yes** | monitor pass | test_coverage_alerts_h3.py, test_dashboard_db_coverage_alerts_h3.py | none (gap #9 built) | H3 |
| Hermes not ready | `VerdifyIrisUnavailable` (no available replica 10 min); `VerdifyDeploymentProgressDeadlineExceeded`; `KubeContainerRestartLoop` | warning | no | 5 to 10 min | tests/verdify-runtime-health.yaml | none (see Noise) | today |
| MCP not ready | ingestor `mcp_unreachable` (heartbeat); `VerdifyMCPSLOBurnRateFast/Slow` | warning / critical | burn rate: yes | heartbeat / 2 min | test_alert_delivery_local.py | none (demoted in H3) | H3 |
| Planner-era alerts (`planner_*`, `plan_context_failed`, `forecast_*`) and the engine-judging `vpd_stress`, `vent_vpd_moisture_gap`, `vent_moisture_capacity_limit` | retired | | | | test_live_path_alerts.py (engine-judging alerts not raised) | none | retired H3 |

## 7. Utilities and cost

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| Electricity, gas or water far outside baseline for a day | ingestor `utility_out_of_baseline` (above 1.5 times the baseline, 10 or more days of history) | warning | no | daily | test_coverage_alerts_h3.py, test_dashboard_db_coverage_alerts_h3.py | none (gap #13 built) | H3 |
| Drying cost limit refusing all day | ingestor `drying_refused_all_day` | warning | no | daily | test_dashboard_db_coverage_alerts_h3.py | none (gap #13 built) | H3 |
| Meter coverage below 70 % | ingestor `utility_out_of_baseline` (coverage leg) | warning | no | daily | test_coverage_alerts_h3.py, test_dashboard_db_coverage_alerts_h3.py | none (gap #13 built) | H3 |
| Whole-house energy feed degraded | monitoring-stack `TeslaEnergyFeedDegraded` | warning | no | 30 min | homeassistant-energy rule tests | none (not greenhouse-specific) | today |

## 8. Irrigation and lighting (they stay)

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| Water flowing with every valve closed | `leak_detected` | critical | yes | monitor pass | test_alert_leak_lifecycle.py, test_alert_leak_attended.py | none | today |
| A valve open outside its fence | `irrigation_fence_breach` | critical | yes | monitor pass | test_dashboard_db_irrigation_ledger.py | none | today |
| A scheduled run missed | `irrigation_run_missed` | warning | no | after the window | test_dashboard_db_irrigation_ledger.py | none | today |
| A line faulted | `irrigation_line_faulted` | warning | no | event | test_dashboard_db_irrigation_ledger.py | none | today |
| Feedback probe stuck or zero | `irrigation_feedback_gap` | warning | no | window | test_soil_dryout_alert.py | none | today |
| Soil below wilt | `soil_dryout` (about 1 point of hysteresis; a probe with an open offline row is not read) | critical | yes | 2.5 h | test_soil_dryout_alert.py, test_coverage_alerts.py | none (fix built); the 7-day false-row read is #1713's last criterion | H2 |
| Lighting lux threshold drifted from policy | `lighting_cfg_threshold_drift` | critical | yes | monitor pass | test_live_path_alerts.py | none (gap #17 built); stays critical while lighting thresholds are host-pushed | today |
| A grow light commanded on but dark (no power or lux) | NONE | | | | NONE | accepted: indoor lux is unreliable and the lights have no meter, so any rule would page falsely | MISSING (accepted) |
| Site content stale (lab) | `site_content_stale` | warning | no | | test_site_content_refresh.py | none | today |
