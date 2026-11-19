"""tasks.forecast — the Open-Meteo forecast fetch (split from tasks.py, issue #46).

Behaviour-preserving extraction; bodies are byte-identical to the
original module. The tasks package __init__ re-exports the public
surface so every `from tasks import X` still resolves.
"""

from ._common import (
    _DENVER,
    _FORECAST_URL,
    UTC,
    OpenMeteoForecastResponse,
    ValidationError,
    asyncio,
    asyncpg,
    datetime,
    json,
    log,
    urllib,
)

# Climate refactor 4.2: the forecast-action engine and the forecast-deviation trigger are retired (no agent writes a
# climate value); the forecast fetch stays, for the review's context, the site and the graphs.


def _fetch_forecast() -> list[dict] | None:
    """Fetch 16-day hourly forecast from Open-Meteo. Validated via
    OpenMeteoForecastResponse — parallel-array length mismatch fails loud
    instead of silently index-truncating like the old hand-zipped loop."""
    req = urllib.request.Request(_FORECAST_URL, headers={"User-Agent": "verdify-ingestor/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = json.loads(resp.read())
    except Exception as e:
        log.warning("Forecast fetch failed: %s", e)
        return None

    try:
        response = OpenMeteoForecastResponse.model_validate(raw)
    except ValidationError as e:
        log.warning("Open-Meteo response failed schema validation: %s", e)
        return None

    hourly = response.hourly
    times = hourly.time
    if not times:
        return None
    n = len(times)

    def col(name: str) -> list:
        arr = getattr(hourly, name, None)
        return arr if arr is not None else [None] * n

    rows = []
    for i in range(n):
        rows.append(
            {
                "ts": times[i],
                "temp_f": col("temperature_2m")[i],
                "rh_pct": col("relative_humidity_2m")[i],
                "dew_point_f": col("dew_point_2m")[i],
                "feels_like_f": col("apparent_temperature")[i],
                "vpd_kpa": col("vapour_pressure_deficit")[i],
                "precip_prob_pct": col("precipitation_probability")[i],
                "precip_in": col("precipitation")[i],
                "rain_in": col("rain")[i],
                "snow_in": col("snowfall")[i],
                "weather_code": col("weather_code")[i],
                "cloud_cover_pct": col("cloud_cover")[i],
                "cloud_cover_low_pct": col("cloud_cover_low")[i],
                "cloud_cover_high_pct": col("cloud_cover_high")[i],
                "wind_speed_mph": col("wind_speed_10m")[i],
                "wind_dir_deg": col("wind_direction_10m")[i],
                "wind_gust_mph": col("wind_gusts_10m")[i],
                "solar_w_m2": col("shortwave_radiation")[i],
                "direct_radiation_w_m2": col("direct_radiation")[i],
                "diffuse_radiation_w_m2": col("diffuse_radiation")[i],
                "uv_index": col("uv_index")[i],
                "sunshine_duration_s": col("sunshine_duration")[i],
                "surface_pressure_hpa": col("surface_pressure")[i],
                "et0_mm": col("et0_fao_evapotranspiration")[i],
                "soil_temp_f": col("soil_temperature_0cm")[i],
                "visibility_m": col("visibility")[i],
            }
        )
    return rows


_FORECAST_COLUMNS = (
    "temp_f",
    "rh_pct",
    "wind_speed_mph",
    "wind_dir_deg",
    "cloud_cover_pct",
    "precip_prob_pct",
    "solar_w_m2",
    "dew_point_f",
    "feels_like_f",
    "vpd_kpa",
    "precip_in",
    "rain_in",
    "snow_in",
    "wind_gust_mph",
    "uv_index",
    "et0_mm",
    "direct_radiation_w_m2",
    "diffuse_radiation_w_m2",
    "sunshine_duration_s",
    "weather_code",
    "cloud_cover_low_pct",
    "cloud_cover_high_pct",
    "surface_pressure_hpa",
    "soil_temp_f",
    "visibility_m",
)


# A failed hourly fetch (an Open-Meteo 504, a timeout, a bad body) is tried again about 5, 15 and 30 minutes after
# the first attempt, each with the same 30 s timeout, then waits for the next hourly run. The whole sequence ends
# well inside the 3600 s cadence and its task timeout in ingestor.task_loop; the stale-forecast alert keeps its
# threshold.
FORECAST_RETRY_DELAYS_S = (300.0, 600.0, 900.0)


async def _fetch_forecast_with_retry(fetch=None, sleep=None) -> list[dict] | None:
    fetch = fetch or _fetch_forecast
    sleep = sleep or asyncio.sleep
    loop = asyncio.get_running_loop()
    attempts = len(FORECAST_RETRY_DELAYS_S) + 1
    for attempt in range(1, attempts + 1):
        rows = await loop.run_in_executor(None, fetch)
        if rows:
            if attempt > 1:
                log.info("Forecast fetch attempt %d/%d succeeded", attempt, attempts)
            return rows
        if attempt == attempts:
            log.warning("Forecast fetch attempt %d/%d failed; waiting for the next hourly run", attempt, attempts)
            return None
        delay = FORECAST_RETRY_DELAYS_S[attempt - 1]
        log.warning("Forecast fetch attempt %d/%d failed; retrying in %.0f s", attempt, attempts, delay)
        await sleep(delay)
    return None


async def forecast_sync(pool: asyncpg.Pool) -> None:
    rows = await _fetch_forecast_with_retry()
    if not rows:
        return
    now = datetime.now(UTC)
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM v_runtime_weather_forecast_write WHERE fetched_at < now() - interval '30 days'")
        records = []
        for row in rows:
            ts = datetime.fromisoformat(row["ts"])
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=_DENVER).astimezone(UTC)
            records.append((ts, now, *(row.get(name) for name in _FORECAST_COLUMNS)))
        # One batch per fetch (#1656): one round trip instead of one INSERT per forecast hour.
        await conn.executemany(
            f"""
            INSERT INTO v_runtime_weather_forecast_write (ts, fetched_at, {", ".join(_FORECAST_COLUMNS)})
            VALUES ({", ".join(f"${n}" for n in range(1, len(_FORECAST_COLUMNS) + 3))})
            """,
            records,
        )
    log.info("Forecast: %d rows inserted", len(rows))
