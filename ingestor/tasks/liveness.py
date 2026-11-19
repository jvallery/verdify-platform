"""tasks.liveness — the ingestor heartbeat (VD-54, decisions Q-01).

Every 60 s the task loop writes one ``system_state`` row, entity
``ingestor_heartbeat``, value ``alive``, whether or not the ESP32 session is
up. The dashboard's Now read (``verdify_services.reads``) calls the ingestor
stale once the newest row is older than 180 s, so the banner can tell a dead
ingestor from a controller that stopped reporting. The row goes through the
ingestor login's existing ``v_runtime_system_state_write`` view: no grant and
no migration. The module is not named after the task, because the ``tasks``
package re-exports each task function by name and a submodule called
``ingestor_heartbeat`` would be shadowed by its own function.

Package 6 (RULINGS V2): the same pass writes the ``ingestor_counters`` row, the
process counters (ESP32 reconnects, rejected payloads, rejected device rows per
table) and the firmware pin, which the operator API's metrics timer exposes to
Prometheus. Same view, no grant and no migration. A failed counters write is
logged and never costs the heartbeat row, which goes first.
"""

import re

import gap_replay
import shared

from verdify_schemas.telemetry import INGESTOR_COUNTERS_ENTITY, IngestorCounters, SystemStateRow

from ._common import UTC, _expected_firmware_version, asyncpg, datetime, log

HEARTBEAT_ENTITY = "ingestor_heartbeat"
HEARTBEAT_VALUE = "alive"
_PIN = re.compile(r"([A-Za-z0-9][A-Za-z0-9._-]{0,63})?")


async def ingestor_heartbeat(pool: asyncpg.Pool) -> None:
    """Write one validated heartbeat row."""
    row = SystemStateRow(ts=datetime.now(UTC), entity=HEARTBEAT_ENTITY, value=HEARTBEAT_VALUE)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO v_runtime_system_state_write (ts, entity, value) VALUES ($1, 'ingestor_heartbeat', 'alive')",
            row.ts,
        )
    await write_ingestor_counters(pool, row.ts)


def counters_value() -> str:
    """The compact ``ingestor_counters`` value from this process's counters."""
    pin = _expected_firmware_version() or ""
    return IngestorCounters(
        rc=shared.esp32_reconnects,
        pr=shared.payload_rejections,
        rj=dict(shared.rows_rejected),
        fw=pin if _PIN.fullmatch(pin) else "",
        gr=gap_replay.host.failures,
    ).compact()


async def write_ingestor_counters(pool: asyncpg.Pool, ts: datetime) -> None:
    """One validated ``ingestor_counters`` row; a failure is logged, never raised."""
    try:
        row = SystemStateRow(ts=ts, entity=INGESTOR_COUNTERS_ENTITY, value=counters_value())
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO v_runtime_system_state_write (ts, entity, value) VALUES ($1, $2, $3)",
                row.ts,
                row.entity,
                row.value,
            )
    except Exception as exc:  # noqa: BLE001 - the counters row is observability only
        log.warning("ingestor_counters write failed: %s", type(exc).__name__)
