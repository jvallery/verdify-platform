# Climate law constants

Generated from `verdify_schemas/climate_law.yaml` by `scripts/gen-climate-law-constants.py`. Do not edit;
change the YAML and regenerate. The firmware compiles these values and reports the hash below; changing one
is a firmware release. Design: `docs/design/climate-refactor-plan-2026-11-15.md`, sections 4.4 and 9.

Constants hash (SHA-256): `9ab82e581e84997f7ec0f79ba65b1e69317d2f9ff65bb6941a1588bcc999c81f`

| Name | Value | Unit | Group | Meaning |
|---|---:|---|---|---|
| `HEAT1_ON_ABOVE_LOW_F` | 3.5 | F | temperature | Electric heater on below low + this |
| `HEAT1_OFF_ABOVE_LOW_F` | 4.5 | F | temperature | Electric heater off above low + this |
| `HEAT2_ON_ABOVE_LOW_F` | 0.5 | F | temperature | Furnace on below low + this |
| `HEAT2_OFF_ABOVE_LOW_F` | 3.0 | F | temperature | Furnace off at or above low + this |
| `COOL_ON_ABOVE_HIGH_F` | 0.0 | F | temperature | Cooling on above high + this |
| `COOL_OFF_BELOW_HIGH_F` | 2.0 | F | temperature | Cooling off below high - this |
| `FAN2_ON_ABOVE_HIGH_F` | 1.5 | F | temperature | Second fan on above high + this |
| `FAN2_OFF_ABOVE_HIGH_F` | 0.0 | F | temperature | Second fan off below high + this |
| `FOG_ON_ABOVE_VPD_HIGH_KPA` | 0.0 | kPa | humidity | Fogger on above vpd_high + this |
| `FOG_OFF_BELOW_VPD_HIGH_KPA` | 0.15 | kPa | humidity | Fogger off below vpd_high - this |
| `MIST_ON_ABOVE_VPD_HIGH_KPA` | 0.3 | kPa | humidity | Misters join above vpd_high + this |
| `MIST_OFF_ABOVE_VPD_HIGH_KPA` | 0.05 | kPa | humidity | Misters leave below vpd_high + this |
| `WET_MIN_ABOVE_LOW_F` | 0.0 | F | humidity | No fog or mist while the house is below low + this |
| `DRY_ON_ABOVE_VPD_LOW_KPA` | 0.05 | kPa | drying | Drying wanted below vpd_low + this (the drying line) |
| `DRY_OFF_ABOVE_VPD_LOW_KPA` | 0.2 | kPa | drying | Drying no longer wanted above vpd_low + this |
| `DRY_START_ABOVE_LOW_F` | 1.5 | F | drying | A drying run may start at or above low + this while its cost is within the limit |
| `DRY_STOP_ABOVE_LOW_F` | 0.75 | F | drying | A drying run stops below low + this |
| `DRY_DEWPOINT_START_MARGIN_F` | 3.0 | F | drying | Outdoor air counts as drier when its dew point is at least this far below the indoor dew point |
| `DRY_DEWPOINT_STOP_MARGIN_F` | 1.0 | F | drying | Outdoor air stops counting as drier when its dew point is less than this far below |
| `DRY_MIN_MOISTURE_DIFF_G_PER_KG` | 0.1 | g/kg | drying | Least humidity-ratio difference (indoor minus outdoor) for drying; guards the division in the cost |
| `DRY_COST_NONE_KWH_PER_KG` | 1000000000.0 | kWh/kg | drying | Cost reported when the moisture difference is below the least difference (never within the limit) |
| `SITE_PRESSURE_KPA` | 85.0 | kPa | drying | Air pressure for the humidity ratio (the firmware's compiled site value) |
| `DRY_COST_LIMIT_DEFAULT_KWH_PER_KG` | 0.7 | kWh/kg | drying | Drying cost limit: released default, and the ROM value |
| `DRY_COST_LIMIT_MIN_KWH_PER_KG` | 0.0 | kWh/kg | drying | Drying cost limit: lowest value |
| `DRY_COST_LIMIT_MAX_KWH_PER_KG` | 1.5 | kWh/kg | drying | Drying cost limit: highest value |
| `DRY_COST_LIMIT_STEP_KWH_PER_KG` | 0.05 | kWh/kg | drying | Drying cost limit: editor step |
| `AIR_CP_KJ_PER_KG_K` | 1.006 | kJ/(kg K) | physics | Specific heat of dry air |
| `F_PER_K` | 1.8 | F/K | physics | Degrees F per kelvin of temperature difference |
| `KJ_PER_KWH` | 3600.0 | kJ/kWh | physics | Kilojoules per kilowatt-hour |
| `G_PER_KG` | 1000.0 | g/kg | physics | Grams per kilogram |
| `MS_PER_S` | 1000 | ms/s | physics | Milliseconds per second |
| `SAFETY_MAX_F` | 100.0 | F | protection | At or above: vent open, both fans on, both heaters off |
| `SAFETY_MIN_F` | 40.0 | F | protection | At or below: both heaters on, vent closed, fans, fogger and misters off |
| `HEAT_MIN_ON_S` | 300 | s | relay | Electric heater and furnace: minimum on time |
| `HEAT_MIN_OFF_S` | 300 | s | relay | Electric heater and furnace: minimum off time |
| `FAN_MIN_ON_S` | 300 | s | relay | Fans: minimum on time |
| `FAN_MIN_OFF_S` | 300 | s | relay | Fans: minimum off time |
| `VENT_MIN_ON_S` | 300 | s | relay | Vent: minimum on time |
| `VENT_MIN_OFF_S` | 300 | s | relay | Vent: minimum off time |
| `FOG_MIN_ON_S` | 120 | s | relay | Fogger: minimum on time |
| `FOG_MIN_OFF_S` | 120 | s | relay | Fogger: minimum off time |
| `MISTER_PULSE_S` | 30 | s | misters | Plain climate mister pulse length (RULINGS B3) |
| `MISTER_GAP_S` | 60 | s | misters | Gap between climate mister pulses (RULINGS B3) |
| `MISTER_LONG_PULSE_FACTOR` | 1.4 | ratio | misters | Pulse length multiplier while the zone VPD is above the long-pulse ratio times vpd_high (RULINGS B4) |
| `MISTER_LONG_PULSE_VPD_RATIO` | 1.2 | ratio | misters | The longer pulse applies while zone VPD > this times the band's vpd_high (RULINGS B4) |
| `MISTER_OVERDUE_S` | 600 | s | misters | Fairness: a stressed member zone with no pulse for this long goes first |
| `VPD_EMERGENCY_KPA` | 2.5 | kPa | irrigation | VPD emergency: lifts the soft water budget hold |
| `WET_DEW_MARGIN_F` | 8.0 | F | irrigation | Dew-point margin for wetting (zone gate and scheduled misting), no night test |
| `MISTER_MIN_OFF_S` | 45 | s | irrigation | Mister line minimum off time (zone fence, gap floor) |
| `ZONE_RANK_CENTER` | 1 | rank | irrigation | Mister zone rank: centre |
| `ZONE_RANK_SOUTH` | 2 | rank | irrigation | Mister zone rank: south |
| `ZONE_RANK_WEST` | 3 | rank | irrigation | Mister zone rank: west |
| `ZONE_RANK_EAST` | 4 | rank | irrigation | Mister zone rank: east |
| `OUTDOOR_MAX_AGE_S` | 600 | s | inputs | Outdoor data maximum age, station and intake probe; also lighting's outdoor freshness limit |
| `CASE_SENSOR_OFFSET_F` | 1.6 | F | inputs | Subtracted from the case sensor when it is the only indoor reading (30-day median, case minus wall probes, read 2026-11-16) |
| `FAN_RUNTIME_SAVE_INTERVAL_S` | 3600 | s | inputs | Fan run seconds and relay counters saved to flash at most this often |
| `SENSOR_BUS_RESTART_S` | 3600 | s | inputs | Sensor-bus restart after no probe update for this long, at most once per this |
| `OCCUPANCY_EXPIRY_S` | 3600 | s | inputs | Occupancy state expires after this long |
| `BAND_TEMP_MIN_F` | 45.0 | F | band | Lowest temperature edge the editor and the controller accept |
| `BAND_TEMP_MAX_F` | 95.0 | F | band | Highest temperature edge the editor and the controller accept |
| `BAND_VPD_MIN_KPA` | 0.3 | kPa | band | Lowest VPD edge the editor and the controller accept |
| `BAND_VPD_MAX_KPA` | 3.0 | kPa | band | Highest VPD edge the editor and the controller accept |
| `BAND_MIN_WIDTH_F` | 6.5 | F | band | Least temp_high - temp_low: the heater's off line at or below the cooling off line (sum of `HEAT1_OFF_ABOVE_LOW_F`, `COOL_OFF_BELOW_HIGH_F`) |
| `BAND_MIN_WIDTH_KPA` | 0.35 | kPa | band | Least vpd_high - vpd_low: the drying off line at or below the fogger's off line (sum of `DRY_OFF_ABOVE_VPD_LOW_KPA`, `FOG_OFF_BELOW_VPD_HIGH_KPA`) |
| `NIGHT_VPD_FLOOR_KPA` | 0.74 | kPa | band | Editor: the drying line (vpd_low + dry_on_above_vpd_low_kpa) at or above this at every point of the night |
