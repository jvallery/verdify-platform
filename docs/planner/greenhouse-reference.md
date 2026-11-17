# Greenhouse Operational Reference

## Physical

- 367 sq ft, elongated hexagon, 3,614 cu ft volume, peak 143" ceiling
- Elevation: 5,090 ft (Longmont, CO, 40.17N). 17% less air density than sea level.
- Glazing: 6mm opal polycarbonate, SHGC 0.66, diffuses all direct light
- Glazed surface area: ~785-810 sq ft (walls + roof, surface-to-floor ratio ~2.1)
- Solar gain: ~87,000 BTU/hr peak (validated - conservative, roof alone ~81K)
- Fan cooling (actual): ~34,000-39,000 BTU/hr (altitude-derated + intake-restricted)
- Fan cooling (nameplate): 52,900 BTU/hr - overstated ~40% due to altitude + vent restriction
- Cooling deficit: ~49,000-53,000 BTU/hr on peak days, giving 107-112 F indoor on 90 F outdoor
- Intake vent: single 24"x24" (4 sq ft) - critically undersized for 4,900 CFM (2x industry max velocity)

## Zones

| Zone | Character | Crops | Mister | Notes |
|------|-----------|-------|--------|-------|
| South | Hottest, exhaust fans, hex taper | Canna lilies (floor) | 6 heads, 30 nozzles, strongest response | Climate mister line L07, rank 2 |
| West | Longest wall (22'5"), afternoon sun | Shelves (herbs, starts) | 3 heads, 15 nozzles, moderate response | Climate mister line L09, rank 3 |
| East | Coolest, tree shade until 10:18 AM | Hydro NFT (lettuce, pepper, strawberry) | NONE | No mister; its probe is a peer in the zone VPD fallback |
| Center | Mixing zone, fog machine location | Vanda orchids (hanging) | 5 heads, 25 nozzles, weakest mister response | Climate mister line L04, rank 1; ranked on the house VPD |
| North | Equipment buffer, thermally stable | None | None | Manifold, sink, controller, heater |

## Equipment

The controller runs every climate relay with the band-edge law (`docs/CONTROL-ARCHITECTURE.md`); the thresholds below
are fixed offsets from the served band (`low`, `high`, `vpd_low`, `vpd_high`).

| Device | Capacity | Control |
|--------|----------|---------|
| Fan 1 (SW) | 2,450 CFM, 52W | Cooling above `high` with the vent; the lead fan alternates per episode |
| Fan 2 (SE) | 2,450 CFM, 52W | Joins above `high + 1.5`; both fans at 100 F |
| Heater 1 (electric) - PRIMARY | 1,500W | On below `low + 3.5`, off above `low + 4.5`: it holds a line inside the band. The primary heater (Jason, 2026-11-05): solar/Powerwall-backed and independent of gas supply; long electric run time is intended |
| Heater 2 (gas/Lennox) - BACKUP | 75,000 BTU/hr nameplate, ~48,000-54,000 actual (altitude derated 20%) | On below `low + 0.5`, off at `low + 3.0`; never with the vent open. The backup heater (Jason, 2026-11-05). Overshoot: ~1-2 F typical |
| AquaFog XE 2000 | 1,644W observed draw, centrifugal atomizer (4-25 um droplets, ~90% evap efficiency) | On above `vpd_high`, off below `vpd_high - 0.15`; runs with the vent open or closed. Max 15.8 GPH (0.26 GPM). |
| Intake vent (north) | 24"x24" (4 sq ft) - critically undersized, needs 2-3x more area | Opens with the lead fan for cooling, and for drying with outdoor air when it is drier and the heat cost per kg of water is within the drying cost limit |
| Grow lights (main) | 630W, 15x4FT LED | DLI-based automation |
| Grow lights (shelf) | 816W, 15x2FT LED | DLI-based automation |

## Activity, Lighting, And Wetting

- Main-light policy currently sets a 06:00 start and 960 qualified light minutes, so global biological activity is 06:00-22:00.
- Climate fog and mister pulses have no clock, activity-window or zone branch: they follow the VPD band, are held
  while the house is below `low`, and wait while the house is less than 8 F above its dew point.
- Scheduled watering (drips, fertigation, scheduled mist) is the irrigation program's; there is no Vanda-specific
  firmware branch.
- Fertigation day masks (`irrig_*_fert_days_mask`) are scheduler-style; when nonzero they supersede the older every-N fert counters.

## Protection Limits

- At or above 100 F: vent open, both fans, both heaters off.
- At or below 40 F: vent closed, fans off, both heaters on, fog and misters off.

## Utility Rates

- Electric: $0.111/kWh
- Gas: $0.83/therm (100,000 BTU)
- Water: $0.00484/gal
- Gas heat is 3.9x more cost-effective per BTU than electric; cost does not set the heater order: electric is the primary heater and gas the backup (Jason, 2026-11-05)

## Water System

- 1 GPM per zone (water pressure limits to one zone at a time)
- Warm water (86 F from Rinnai tankless) aids evaporation

**Climate humidification order:** the fogger comes first, at `vpd_high` (AquaFog ~0.26 GPM, the lowest-water
device though the higher-power one); the opted-in zone misters (~1 GPM per zone) pulse only above `vpd_high + 0.30`,
one zone at a time through the irrigation engine, and the fog keeps running while they pulse.
- At 15% outdoor RH, evaporation is near-instant (gap can be very short)

## Key Physics

- VPD rises with solar load and ventilation (dry outside air at 5,090 ft)
- Fogging with the vent closed retains humidity but traps heat
- Fog + fans = evaporative cooling (phase change absorbs heat)
- At 85 F/15% RH outdoor: open-vent misting achieves only 52-61% RH (VPD 1.6-2.0 kPa) - still above target
- Sealed-vent misting can reach 70-85% RH in 2-5 min, but heat builds without ventilation
- Above ~85 F, heat stress is engineering-limited (addressable with shade cloth + fan-and-pad), not physics-limited
- Wet-bulb depression at 5,090ft/15% RH reaches ~31 F - evaporative cooling is exceptionally powerful here
- Slab thermal mass: ~7,300 BTU/F effective (slab + sub-slab soil), time constant ~11.5h, provides 7-10 F overnight retention
- Air exchange at 4,900 CFM: full volume replaced every 44 seconds
