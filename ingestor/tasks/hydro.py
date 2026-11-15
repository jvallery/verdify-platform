"""tasks.hydro — the direct YINMIK hydroponic meter reader (VD-70, #1183).

Every 300 s: read the meter over the Tuya local protocol (``hydro_probe``),
decode, validate with ``ClimateRow`` and overlay the ``hydro_*`` columns onto
the newest ESP32 ``climate`` row through the statement ``ha_sensor_sync``
shares. While the host or a key file of the optional ``verdify-hydro-probe``
Secret is missing the reader idles: one log line per process, no I/O.

The meter answers for a few minutes after it joins Wi-Fi, then stops answering
(tuya_err=905) while still associated until it drops and rejoins, about every
11 minutes (UniFi sessions, 2026-11-15). A failed read is therefore retried
every ``RETRY_INTERVAL_S`` until ``RETRY_WINDOW_S`` has passed, which stays
inside the task's 270 s watchdog and its 300 s cadence. Only a HydroProbeError
or OSError is retried; a decode or validation failure would fail the same way
again. A cycle that never reads logs one warning with the last error class,
the Tuya error code and the attempt count, never the message, and writes
nothing, so the columns age in ``v_data_pipeline_health``.
"""

import time

import hydro_probe

from ._common import (
    UTC,
    ClimateRow,
    asyncio,
    asyncpg,
    datetime,
    log,
    update_latest_climate_row,
)

_LOGGED_COLUMNS = ("hydro_ph", "hydro_ec_us_cm", "hydro_tds_ppm", "hydro_water_temp_f", "hydro_battery_pct")
_idle_logged = False

RETRY_INTERVAL_S = 30.0
RETRY_WINDOW_S = 240.0
_sleep = asyncio.sleep
_monotonic = time.monotonic


def _fmt(value: float | None) -> str:
    return "null" if value is None else f"{value:g}"


async def hydro_probe_sync(pool: asyncpg.Pool) -> None:
    global _idle_logged
    config = hydro_probe.load_config()
    if config is None:
        if not _idle_logged:
            _idle_logged = True
            log.info("hydro key missing: direct hydro reader idle")
        return

    loop = asyncio.get_running_loop()
    started = _monotonic()
    attempts = 0
    while True:
        attempts += 1
        try:
            dps = await loop.run_in_executor(None, hydro_probe.read_status, config)
            break
        except Exception as exc:  # noqa: BLE001 — a message can carry device data; log the class and code only
            retryable = isinstance(exc, hydro_probe.HydroProbeError | OSError)
            if retryable and _monotonic() - started + RETRY_INTERVAL_S <= RETRY_WINDOW_S:
                await _sleep(RETRY_INTERVAL_S)
                continue
            _log_failure(exc, attempts)
            return
    try:
        columns = hydro_probe.decode(dps)
        ClimateRow.model_validate({"ts": datetime.now(UTC), **columns})
    except Exception as exc:  # noqa: BLE001 — a message can carry device data; log the class and code only
        _log_failure(exc, attempts)
        return

    async with pool.acquire() as conn:
        written = await update_latest_climate_row(conn, columns)
    if not written:
        log.warning("hydro_probe source=tuya_local skipped: no recent climate row")
        return
    log.info(
        "hydro_probe source=tuya_local ph=%s ec=%s tds=%s temp_f=%s battery=%s attempts=%d",
        *(_fmt(columns.get(column)) for column in _LOGGED_COLUMNS),
        attempts,
    )


def _log_failure(exc: Exception, attempts: int) -> None:
    code = exc.code if isinstance(exc, hydro_probe.HydroProbeError) else None
    log.warning("hydro_probe source=tuya_local error=%s tuya_err=%s attempts=%d", type(exc).__name__, code, attempts)
