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

**Paging.** Prometheus `VerdifyGreenhouseAlertOpen` pages any open **critical** `alert_log` row after 2 min.
Alertmanager pushes only `severity=critical`; warning goes to Slack and info is kept. So "pages" means critical.

**Status column:** `today` = live now; `H1` = host release 1 (#1687) adds it; `H2`/`H3` = the train that carries it;
`MISSING` = nothing detects it.

**"live-only" tests:** `tests/test_08_observability.py` and `test_12_fidelity.py` run against the live stack
(`make test`). CI does not run them, so they count as no CI test.

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
| All wall probes lost, running on the case sensor | four or more per-column `sensor_offline` rows | warning | no | per column | as above | one row for the state (gap #6) | MISSING as one signal |
| No valid indoor temperature (SENSOR_FAULT) | ingestor `sensor_fault` (`system.greenhouse_state`, ≥ 120 s; details carry `outdoor_source`, relays) | critical | **yes** | 2 min + 2 min | host-law tests/test_law_host_entities.py | none | H1 |
| Humidity invalid (G2/G2a) | `sensor_offline` on `climate.rh_*` (the G2a warning) | warning | no | registry threshold | as row 1 | none | today |
| Probes disagreeing | NONE | | | | NONE | gap #14 | MISSING |
| Outdoor station stale (Tempest) | `sensor_offline` on `climate.outdoor_temp_f`, `outdoor_rh_pct` and the weather columns | warning | no | registry threshold | as row 1 | none | today |
| Intake probe lost | `sensor_offline` on `climate.temp_intake`, `intake_rh` | warning | no | registry threshold | as row 1 | none | today |
| No outdoor source at all | NONE (`outdoor_source` stored, H1) | | | | NONE | gap #3 | MISSING |
| Soil probes | ingestor `soil_sensor_offline` per probe (long-offline lifecycle) | warning | no | probe cadence | test_alert_probe_offline_lifecycle.py, test_alert_silences.py | noise: silence the out-of-soil probes | today |
| Hydro probe | `sensor_offline` with `sensor_id = device.hydro_probe` (one row per device) | warning | no | registry threshold | test_climate_alerts_1_3.py | opens on the first pass (real, long-silent); silence until fixed | H1 |
| Water flow meter | `sensor_offline` on `climate.flow_gpm` / `water_total_gal`; `leak_detected` (flow with every valve closed) | warning / critical | leak: yes | threshold / monitor pass | test_alert_leak_lifecycle.py, test_alert_leak_attended.py | none | today |
| Power meters (greenhouse Shelly) | indirectly: monitoring-stack `FleetHardwareNativeUnavailable`/`FleetIPProbeUnavailable` (device reachability); `heat_no_power` needs 2 fresh samples and is silent on a frozen meter | warning | no | 30 min | fleet-hardware rule tests | `energy` freshness (gap #5) | MISSING for data |
| Greenhouse HA probes (04 south air, 08, 09) | monitoring-stack `VerdifySouthAirProbeUnavailable`, `VerdifySouth2SoilProbeUnavailable`, `VerdifyWestSoilProbeUnavailable` | info | no | 15 min | tests/verdify-runtime-health.yaml | known noise (#1584) | today |

## 2. Controller

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| Offline / dark | monitoring-stack `VerdifyControllerDark` (ESP32 writer connections averaged under 0.5 over 20 min, or 6+ changes in 30 min); `VerdifyWriterCountNotExactlyOne`; ingestor `sensor_offline` `device.controller_diagnostics` | critical / critical / warning | **yes** | 2 min after a 20 min average | monitoring-stack writer-exporter rule tests | none | today |
| Unexpected restart | ingestor `esp32_reboot` (uptime < 300 s, reset reason not OTA or software) | info | no | monitor pass | test_sensor_health_sweep.py | none; info is right | today |
| Restart loop | `VerdifyControllerDark` connection-flap branch (6+ changes in 30 min) | critical | yes | 2 min | writer-exporter rule tests | none | today |
| Heap low | ingestor `heap_pressure_warning`, `heap_pressure_critical` (debounced firmware flag) | warning / critical | critical: yes | monitor pass | test_08_observability.py (live-only), test_dispatcher_* | keep; add a CI test with gap #17 | today |
| WiFi signal weak | NONE (`diag.wifi_rssi` only in the staleness registry) | | | | NONE | gap #15 | MISSING |
| Clock untrusted or wrong | ingestor `clock_unconfirmed` (10-min median offset > 120 s, or `sntp_valid` 0 for 30 min) | critical | **yes** | 10 to 30 min | test_climate_alerts_1_3.py, test_dashboard_db_climate_alerts.py | none | H1 |
| Firmware version differs from the pin | ingestor `firmware_version_mismatch` | warning | no | monitor pass | test_08_observability.py (live-only), test_sensor_health_sweep.py | none | today |
| Constants hash differs | ingestor `law_constants_mismatch` (newest hash under 2 h old) | info | no | hourly receipt | host-law-outputs tests/test_law_host_entities.py | none | H2/H3 (host-law-outputs) |
| Relay counters stepping back | NONE (a negative delta counts as a restart, 0) | | | | NONE | gap #19 | MISSING |
| Boot left the furnace wait or boot grace stuck | NONE | | | | NONE | gap #16 | MISSING |
| Firmware breaker latched / relief ceiling | ingestor `firmware_vent_latched`, `firmware_relief_ceiling` | per payload | per payload | monitor pass | test_08_observability.py (live-only) | review against the law (these are engine-era rails) | today |

## 3. Control

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| Law state record stale | NONE | | | | NONE | gap #4 | MISSING |
| Law state record malformed | ingestor `payload_rejected` (rejected on every receipt for 10 min) | warning | no | 10 min | host-law tests/test_law_host_entities.py | none | H1 |
| Protection limit engaged (≤ 40 F, ≥ 100 F) | ingestor `temp_safety` on `climate.temp_avg` (newest row within 10 min) | critical | **yes** | monitor pass + 2 min | NONE | test (gap #17); reads `temp_avg`, so with no valid temperature `sensor_fault` covers it | today |
| House outside the band too long | ingestor `house_band_drift` (VPD vs commanded band, sustained); `vpd_extreme` | warning | no | sustained window | test_verdify_services_alerts.py | temperature leg (gap #7) | today (VPD only) |
| Band served differs from the database band | ingestor `band_device_db_divergence` (edge or target branch) | warning | no | monitor pass | test_climate_alerts_1_3.py | none | H1 |
| Forbidden relay pair (furnace with vent, fan with vent closed) | NONE (`heat_staging_inversion` covers heat2 without heat1 only) | | | | NONE | gap #2 | MISSING |
| Relay starts per hour above the rollback criteria | NONE | | | | NONE | gap #1 | MISSING |
| Relay commanded, no power drawn (heater) | ingestor `heat_no_power` (heat1 on 15 min, fresh samples < 500 W) | warning | no | 15 min | test_climate_alerts_1_3.py, test_dashboard_db_climate_alerts.py | none (meters exist for the heaters only) | H1 |
| Power drawn, relay off (heater) | ingestor `heat_manual_override` (> 1000 W with both heat relays off for 15 min) | warning | no | 15 min | as above | none | H1 |
| Relay stuck on against demand | ingestor `relay_stuck` | warning | no | monitor pass | test_dashboard_db_settings_alerts.py | none | today |
| Manual override left on | NONE | | | | NONE | fold into gap #18 (owner-held) | MISSING |
| Drying meter not growing or stepping back | NONE | | | | NONE | gap #12 | MISSING |
| Fog or misters below the band's low edge | NONE (`vent_vpd_moisture_gap` is the opposite case) | | | | NONE | gap #11 | MISSING |
| Safety rails zeroed or invalid | ingestor `safety_invalid` | critical | yes | 5 min | NONE | test (gap #17) | today |

## 4. Delivery

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| A setting or band value not delivered | ingestor `setpoint_delivery_stuck` (database only; K1 exempts the legacy band scalars under the on-chip band) | warning 15 min, critical 45 min | **yes at 45 min** | 15 / 45 min | test_climate_alerts_1_3.py, test_dashboard_db_climate_alerts.py | none | H1 |
| One push refused or failed | ingestor `esp32_push_failed`, `setpoint_unconfirmed` | warning | no | event | test_alert_producer_payloads.py, test_dispatcher_desired_state.py | none | today |
| Plan written, nothing delivered | ingestor `plan_not_delivered` | warning | no | 30 / 90 min | test_climate_alerts_1_3.py, test_dashboard_db_climate_alerts.py | retires with plans (H3) | H1 |
| Owner-held value changed by something else | partly: `setpoint_delivery_stuck` | warning/critical | at 45 min | 15 / 45 min | as above | gap #18 | partial |
| A band the law cannot run on | `band_fn_null` (API, critical); `safety_invalid`; `band_device_db_divergence` | critical / critical / warning | yes | request / monitor pass | test_08_observability.py (live-only) | add a CI test for `band_fn_null` | today |

## 5. Data flows

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| Ingestor not writing: climate | `sensor_offline` on every climate column; `VerdifyControllerDark` if the connection drops | warning | no (dark pages) | registry threshold | as section 1 | none | today |
| equipment_state | change-only rows, so staleness misfires | | | | | exclude them (gap #10); a fan or relay that never changes is caught by gap #1 counters | noise risk |
| counters (`relay_counters`) | NONE (written on change) | | | | | none needed: no row = no movement | n/a |
| readbacks pass (`setpoint_snapshot`) | `setpoint_delivery_stuck` (reads the newest readback per parameter; no readback in a day = not judged) | | | | | add "no snapshot pass for 30 min" to the delivery cycle (S) if wanted | partial |
| diagnostics | `sensor_offline` `device.controller_diagnostics` | warning | no | threshold | test_climate_alerts_1_3.py | none | H1 |
| Rows rejected by validation | ingestor `payload_rejected` (law payloads); ingestor log `row failed schema validation` for the rest | warning | no | 10 min | host-law test_law_host_entities.py | none for law payloads; legacy rows are log-only | H1 |
| Daily record / compliance store not written for a day | NONE | | | | NONE | gap #8 | MISSING |
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
| Reviewer writes a climate value | structurally refused (MCP tools removed, `set_setting` gone); NO alert | | | | | gap #9 | MISSING |
| Hermes not ready | `VerdifyIrisUnavailable` (no available replica 10 min); `VerdifyDeploymentProgressDeadlineExceeded`; `KubeContainerRestartLoop` | warning | no | 5 to 10 min | tests/verdify-runtime-health.yaml | none (see Noise) | today |
| MCP not ready | ingestor `mcp_unreachable` (heartbeat); `VerdifyMCPSLOBurnRateFast/Slow`; `planner_tool_dependency_failed` | critical / critical / warning | yes | heartbeat / 2 min | test_alert_delivery_local.py | demote `mcp_unreachable` to warning at H3 | today |
| Planner-era alerts (`planner_*`, `plan_context_failed`, `forecast_*`) | ingestor | mixed (3 are critical) | some | | various | retired in H3 (the reviewer design, #1659) | today, retire H3 |

## 7. Utilities and cost

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| Electricity, gas or water far outside baseline for a day | NONE | | | | NONE | gap #13 | MISSING |
| Drying cost limit refusing all day | NONE | | | | NONE | gap #13 | MISSING |
| Meter coverage below 70 % | NONE | | | | NONE | gap #13 | MISSING |
| Whole-house energy feed degraded | monitoring-stack `TeslaEnergyFeedDegraded` | warning | no | 30 min | homeassistant-energy rule tests | none (not greenhouse-specific) | today |

## 8. Irrigation and lighting (they stay)

| Failure mode | Detected by | Severity | Pages | How fast | Tested by | Gap / smallest fix | Status |
|---|---|---|---|---|---|---|---|
| Water flowing with every valve closed | `leak_detected` | critical | yes | monitor pass | test_alert_leak_lifecycle.py, test_alert_leak_attended.py | none | today |
| A valve open outside its fence | `irrigation_fence_breach` | critical | yes | monitor pass | test_dashboard_db_irrigation_ledger.py | none | today |
| A scheduled run missed | `irrigation_run_missed` | warning | no | after the window | test_dashboard_db_irrigation_ledger.py | none | today |
| A line faulted | `irrigation_line_faulted` | warning | no | event | test_dashboard_db_irrigation_ledger.py | none | today |
| Feedback probe stuck or zero | `irrigation_feedback_gap` | warning | no | window | test_soil_dryout_alert.py | none | today |
| Soil below wilt | `soil_dryout` | critical | yes | 2.5 h | test_soil_dryout_alert.py | **noise**: hysteresis and offline-probe skip (see Top) | today |
| Lighting lux threshold drifted from policy | `lighting_cfg_threshold_drift` | critical | yes | monitor pass | NONE | test (gap #17); severity review (see Noise) | today |
| A grow light commanded on but dark (no power or lux) | NONE | | | | NONE | not recommended now: indoor lux is unreliable and the lights have no meter | MISSING (accepted) |
| Site content stale (lab) | `site_content_stale` | warning | no | | test_site_content_refresh.py | none | today |
