# The moisture source: a nightly figure beside the day's water (2026-11-16)

Issue #1669, package 1.4 of the climate refactor (epic #1633). Report only: no production change. Read only on
production on 2026-11-16, for the nights of 2026-10-01 to 2026-11-15.

## The figure

For each night, the median over 00:30 to 04:00 MST (UTC-7 all year, as in the review) of the indoor absolute
humidity (`climate.abs_humidity`, g/m3) minus the outdoor absolute humidity computed from the weather station
(`outdoor_temp_f`, `outdoor_rh_pct`, Magnus coefficients 17.62 and 243.12 C). A night needs at least 60 minute rows.

| Period | Nights | Median surplus (g/m3) | Range |
|---|---|---|---|
| October 2026 | 31 | 4.28 | 2.17 to 6.69 |
| 2026-11-01 to 11-05 | 5 | 3.85 | 2.96 to 4.77 |
| 2026-11-06 to 11-15 | 10 | 4.92 | 3.11 to 5.62 |

The #1669 acceptance figures (4.3 for October, 4.9 for 11-06 to 11-15, within 0.2) are reproduced.

## The night beside the previous day's water and visits

Previous day's metered gallons by cause from `v_water_attribution_daily` (wetting = fog and misters, wall = wall
drip irrigation, house = manual or unattributed, e.g. the hose) and visits from `system_state.occupancy` (a visit is
a change to `occupied`). Selected nights; all 46 are in the query below.

| Night | Surplus | Wetting gal | Wall gal | Ambiguous gal | House gal | Visits |
|---|---|---|---|---|---|---|
| 2026-10-10 | 6.69 | 25 | 0 | 33 | 4 | 0 |
| 2026-10-14 | 2.17 | 9 | 0 | 0 | 0 | 0 |
| 2026-10-27 | 4.76 | 0 | 0 | 0 | 172 | 6 |
| 2026-10-28 | 4.67 | 0 | 0 | 0 | 483 | 2 |
| 2026-11-06 | 5.05 | 10 | 0 | 0 | 2 | 1 |
| 2026-11-10 | 5.62 | 3 | 30 | 5 | 1 | 0 |
| 2026-11-14 | 3.11 | 2 | 31 | 0 | 0 | 0 |
| 2026-11-15 | 3.81 | 4 | 27 | 0 | 134 | 6 |

What it says, and how firmly:

- **Metered water does not explain the night.** Across the 46 nights the correlation between the surplus and the
  previous day's metered gallons is r = 0.14 (0.26 without the three hose days). From 10-14 to 11-06, with 2 to 14
  gallons a day and the misting nearly off, the median surplus was still 4.1 g/m3 (22 nights). Most of the source is
  the plants and the wet floor and benches, and the air exchange decides how much of it stays; neither is measured.
- **The hose days do not stand out by night.** 172 and 483 gallons of house water on 10-26 and 10-27 (visits
  10:30 to 11:31 MDT on 10-26 and more after) were followed by 4.76 and 4.67, near the October median. The water
  shows by day (those two days were 12 % and 11 % in band, the worst of the autumn), not in the 00:30 to 04:00
  window.
- **The wall drip coincides with a step up but is confounded.** From 11-07 the wall drip delivers about 30 gallons a
  day and the median surplus is 4.92 (8 nights to 11-14) against 4.07 before. In the same days the nights
  turned colder and the heater ran longer, so the step cannot be given to the drip on this data.

Uncertainty: the indoor figure is the house average of the probes the controller reports, and the south probe was
missing until 2026-11-14; the outdoor figure is the station's,
whose dew point runs 0 to 2 F from the intake probe's (docs/reviews/intake-probe-vs-station-2026-11-16.md), about
0.1 to 0.3 g/m3 at these temperatures. Night-to-night spread (2.2 to 6.7 in October) is much larger than either.
"Ambiguous" gallons are overlap the attribution cannot split; before 10-12 they are a third to two thirds of the
metered water. The review's comparison with last winter (1.4 to 1.6 times) is not recomputed here: the same query over
2025-12-01 to 2026-03-01 returns no night with 60 rows that have both `abs_humidity` and the station columns.

## Queries

The nightly surplus (add the commented join for the table above):

```sql
WITH r AS (
    SELECT (ts AT TIME ZONE 'Etc/GMT+7')::date AS night,
           abs_humidity - 216.7 * (outdoor_rh_pct / 100.0 * 6.112
               * exp(17.62 * ((outdoor_temp_f - 32) / 1.8) / (243.12 + (outdoor_temp_f - 32) / 1.8)))
             / (273.15 + (outdoor_temp_f - 32) / 1.8) AS d
      FROM climate
     WHERE greenhouse_id = 'vallery'
       AND ts >= TIMESTAMPTZ '2026-10-01 07:00+00' AND ts < TIMESTAMPTZ '2026-11-16 07:00+00'
       AND (ts AT TIME ZONE 'Etc/GMT+7')::time >= TIME '00:30'
       AND (ts AT TIME ZONE 'Etc/GMT+7')::time < TIME '04:00'
       AND abs_humidity BETWEEN 0.5 AND 40 AND outdoor_rh_pct BETWEEN 1 AND 100
       AND outdoor_temp_f BETWEEN -30 AND 120
)
SELECT night, percentile_cont(0.5) WITHIN GROUP (ORDER BY d) AS surplus_g_m3
  FROM r GROUP BY night HAVING count(*) >= 60 ORDER BY night;
-- previous day's water:  LEFT JOIN v_water_attribution_daily w ON w.date = night - 1
--   (climate_wetting_gal, wall_irrigation_gal, ambiguous_gal, manual_or_unattributed_gal)
```

Visits:

```sql
WITH s AS (
    SELECT ts, value, lag(value) OVER (ORDER BY ts) AS prev
      FROM system_state
     WHERE entity = 'occupancy' AND ts >= TIMESTAMPTZ '2026-10-20 06:00+00' AND ts < TIMESTAMPTZ '2026-11-16 07:00+00'
), e AS (SELECT ts, value, lead(ts) OVER (ORDER BY ts) AS until FROM s WHERE prev IS DISTINCT FROM value)
SELECT ts AT TIME ZONE 'America/Denver' AS from_local, until AT TIME ZONE 'America/Denver' AS to_local
  FROM e WHERE value = 'occupied' ORDER BY ts;
```

## What #1669 still asks for

The standing daily row (a table filled by the daily task, with per-run gallons and a visit marker) is not built
here; this report shows the figure can be computed from existing columns and that it reproduces the issue's
numbers. The per-run gallons need the flow rates of the daily record (migration 310, #1668).
