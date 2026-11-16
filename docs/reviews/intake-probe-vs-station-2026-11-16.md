# The intake probe against the weather station: temperature and dew point (2026-11-16)

Issue #1699, package 1.4 of the climate refactor (epic #1633). Report only: no production change. Read only on
production on 2026-11-16.

The law takes outdoor air from the weather station and falls back to the wired intake probe (plan section 4.9).
The plan compared the two for two days (median 1.3 F warm). Both have been stored once a minute in `climate` since
April 2026: 325,713 matched minutes from 2026-04-01 to 2026-11-15 (`temp_intake`, `intake_rh` against
`outdoor_temp_f`, `outdoor_rh_pct`). Dew point from Magnus (17.62, 243.12 C). Offsets are intake minus station, in F.
"Sun up" is `solar_altitude_deg > 0`.

## Temperature

| Window | Minutes | Median | P10 | P90 |
|---|---|---|---|---|
| All | 325,713 | 0.00 | -2.99 | +5.11 |
| Sun down | 147,316 | -0.88 | -3.37 | +1.28 |
| Sun up | 178,397 | +1.33 | -2.38 | +7.45 |

By month, sun down: -0.23 (April), -0.65, -0.83, -1.06, -1.35 (August), -0.70, -0.86, -0.63 (November). Sun up:
+2.63 (April), +2.38, +1.80, +1.04, +1.04, +1.17, -0.63 (October), -0.52 (November), with a long warm tail in
summer (June P90 +16.1).

## Dew point

| Window | Minutes | Median | P10 | P90 |
|---|---|---|---|---|
| All | 325,704 | +0.23 | -2.45 | +2.05 |
| Sun down | 147,314 | +0.26 | -2.25 | +1.80 |
| Sun up | 178,390 | +0.19 | -2.63 | +2.26 |

By month (all hours): -1.30 (April), -1.09, -1.92 (June), +0.05 (July), +0.55, +0.76, +0.91, +1.00 (November).

## Reading it

- **Temperature: no constant offset to subtract.** The median over the season is 0.0 F. At night the probe reads
  about 0.9 F cool, steady from month to month (-0.2 to -1.4). By day it reads warm in sun (+1.0 to +2.6 F from
  April to September, a P90 of +6 to +16 F), which is radiative heating of the probe, not air. As the fallback it is
  good at night; by day it overstates outdoor air by 1 to 3 F typically and much more in strong sun. If the
  release corrects it, it is by sun state (subtract about +1.3 F by day, add about 0.9 F by night), not one median.
  The plan's two-day 1.3 F matches the sun-up median.
- **Dew point: a drift, not an offset.** The median moved from about -1.9 F in June to +1.0 F in November, a
  3 F swing in five months with a steady sign change in July. One of the two humidity sensors is drifting; this
  data cannot say which. A single median subtracted at release would be wrong within weeks. At 30 to 50 F a 1 F
  dew point error is about 0.2 to 0.3 g/m3, small against the 4 to 5 g/m3 night surplus
  (docs/reviews/moisture-source-2026-11-16.md), but it moves the drying test's margin by the same amount.

## Uncertainty

The station is the reference here, not a calibrated instrument; the offsets are between two sensors. The minutes
are strongly autocorrelated, so the effective sample is closer to the 229 days than to 325,713 minutes; the
month-to-month spread above (about 1 F in temperature at night, 3 F in dew point) is the honest uncertainty, not
the standard error. Station dropouts are not filtered beyond the -30 to 130 F and 1 to 100 % range checks: a station
value held through an outage would widen the tails. March is left out (partial data).

## Query

```sql
WITH r AS (
    SELECT date_trunc('month', ts AT TIME ZONE 'America/Denver')::date AS m,
           COALESCE(solar_altitude_deg, 0) > 0 AS sun,
           temp_intake AS ti, outdoor_temp_f AS ts_f, intake_rh AS hi, outdoor_rh_pct AS hs
      FROM climate
     WHERE greenhouse_id = 'vallery'
       AND ts >= TIMESTAMPTZ '2026-04-01 06:00+00' AND ts < TIMESTAMPTZ '2026-11-16 07:00+00'
       AND temp_intake BETWEEN -30 AND 130 AND outdoor_temp_f BETWEEN -30 AND 130
), d AS (
    SELECT r.*, ti - ts_f AS dt,
           CASE WHEN hi BETWEEN 1 AND 100 AND hs BETWEEN 1 AND 100 THEN 1.8 * (
               243.12 * (ln(hi / 100.0) + 17.62 * ((ti - 32) / 1.8) / (243.12 + (ti - 32) / 1.8))
                 / (17.62 - (ln(hi / 100.0) + 17.62 * ((ti - 32) / 1.8) / (243.12 + (ti - 32) / 1.8)))
             - 243.12 * (ln(hs / 100.0) + 17.62 * ((ts_f - 32) / 1.8) / (243.12 + (ts_f - 32) / 1.8))
                 / (17.62 - (ln(hs / 100.0) + 17.62 * ((ts_f - 32) / 1.8) / (243.12 + (ts_f - 32) / 1.8))))
           END AS ddp
      FROM r
)
SELECT m, sun, GROUPING(m, sun) AS level, count(*) AS n,
       percentile_cont(ARRAY[0.1, 0.5, 0.9]) WITHIN GROUP (ORDER BY dt) AS temp_offset_f,
       percentile_cont(ARRAY[0.1, 0.5, 0.9]) WITHIN GROUP (ORDER BY ddp) AS dew_point_offset_f
  FROM d
 GROUP BY GROUPING SETS ((m), (sun), (), (m, sun))
 ORDER BY m, sun;
```
