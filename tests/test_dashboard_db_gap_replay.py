"""The gap replay writer's SQL on a private PostgreSQL (contracts gap-log section 9; #1633 release 5).

The unit tests in tests/test_gap_replay.py use a stand-in connection, so they could not see that PostgreSQL typed
the bare timestamp parameter of write_quarter() as an interval (fixed in release 4: every quarter failed in
production). This file runs write_quarter() and write_pass() unchanged against real tables: climate and
equipment_state from db/schema.sql's DDL, the climate column and write facade of migration 307, the
equipment_state write facade as migration 217 generates it, and gap_replay_quarters from migration 314.

The campaign step starts a fresh server for each tests/test_dashboard_db_*.py file and sets
VERDIFY_ISOLATED_TEST_DSN; without it this file skips.
"""

from __future__ import annotations

import asyncio
import os
import sys
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INGESTOR_PATH = str(ROOT / "ingestor")
if INGESTOR_PATH not in sys.path:
    sys.path.insert(0, INGESTOR_PATH)

import gap_replay  # noqa: E402

from verdify_schemas.gap_replay import (  # noqa: E402
    FLAG_CLOCK_TRUSTED,
    RELAYS,
    ClimateRecord,
    PassBegin,
    QuarterHeader,
    Transition,
)

asyncpg = pytest.importorskip("asyncpg")

pytestmark = pytest.mark.skipif(
    not os.environ.get("VERDIFY_ISOLATED_TEST_DSN"),
    reason="needs the campaign step's private PostgreSQL (VERDIFY_ISOLATED_TEST_DSN)",
)

SCHEMA = "gap_replay_db"
TABLES = ("climate", "equipment_state", "gap_replay_quarters")
VALID = 0b111  # indoor, humidity and outdoor valid


def extract(text: str, start: str, end: str) -> str:
    assert text.count(start) == 1, start
    begin = text.index(start)
    return text[begin : text.index(end, begin) + len(end)].replace("public.", f"{SCHEMA}.")


def ddl() -> list[str]:
    schema = (ROOT / "db/schema.sql").read_text()
    m307 = (ROOT / "db/migrations/307-climate-ppfd-column.sql").read_text()
    m314 = (ROOT / "db/migrations/314-controller-health-and-gap-ledger.sql").read_text()
    return [
        extract(schema, "CREATE TABLE public.climate (", ");\n"),
        f"ALTER TABLE {SCHEMA}.climate ADD COLUMN IF NOT EXISTS ppfd_umol_m2_s double precision",
        extract(m307, "CREATE OR REPLACE VIEW public.v_runtime_climate_write", "FROM public.climate;"),
        extract(schema, "CREATE TABLE public.equipment_state (", ");\n"),
        # Migration 217's generated facade for equipment_state (its pg_catalog.format of 'CREATE VIEW public.%I').
        f"CREATE VIEW {SCHEMA}.v_runtime_equipment_state_write WITH (security_barrier=true, security_invoker=false) "
        f"AS SELECT equipment, greenhouse_id, state, ts FROM {SCHEMA}.equipment_state",
        extract(m314, "CREATE TABLE public.gap_replay_quarters (", "\n);"),
    ]


@pytest.fixture(scope="module")
def dsn():
    from conftest import isolated_mutation_test_dsn

    value = isolated_mutation_test_dsn()

    async def run(statements):
        conn = await asyncpg.connect(value)
        try:
            for s in statements:
                await conn.execute(s)
        finally:
            await conn.close()

    asyncio.run(run([f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE", f"CREATE SCHEMA {SCHEMA}", *ddl()]))
    yield value
    asyncio.run(run([f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"]))


class _Pool:
    """write_pass() takes a pool; this one hands out the test's real connection."""

    def __init__(self, conn) -> None:
        self._conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self._conn


def scenario(dsn, body):
    async def run():
        conn = await asyncpg.connect(dsn)
        try:
            await conn.execute(f"SET search_path = {SCHEMA}")
            await conn.execute(f"TRUNCATE {', '.join(TABLES)}")
            epoch = int(await conn.fetchval("SELECT extract(epoch FROM date_trunc('minute', now()))")) - 3600
            await body(conn, epoch)
        finally:
            await conn.close()

    asyncio.run(run())


def record(dt: int, seq: int) -> ClimateRecord:
    return ClimateRecord(dt=dt, flags=VALID, mode=0, tin=700, tdp=500, tout=400, relays=0, water=123, seq=seq)


def transition(dt: int, equipment: str, on: bool, seq: int) -> Transition:
    return Transition(dt=dt, relay=RELAYS.index(equipment), state=int(on), seq=seq)


def quarter(ver: int, qseq: int, t0: int, records, transitions) -> gap_replay.Quarter:
    header = QuarterHeader(
        boot=7, qseq=qseq, ver=ver, flags=FLAG_CLOCK_TRUSTED, t0=t0, off=0, n_clim=len(records), n_tr=len(transitions)
    )
    return gap_replay.Quarter(header=header, records=list(records), transitions=list(transitions))


def replay_pass(*quarters: gap_replay.Quarter) -> gap_replay.ReplayPass:
    return gap_replay.ReplayPass(
        begin=PassBegin(boot=7, uptime_s=4000, epoch_s=0, n=len(quarters)),
        quarters={q.header.qseq: q for q in quarters},
    )


def at(epoch: int, dt: int):
    return gap_replay.GapReplayHost.place(
        QuarterHeader(boot=7, qseq=0, ver=2, flags=FLAG_CLOCK_TRUSTED, t0=epoch, off=0, n_clim=0, n_tr=0), dt, {}
    )


def test_a_format_2_quarter_is_written_through_the_views_once_and_never_doubles_a_row(dsn):
    async def body(conn, t0):
        # A live climate row 30 s before the third record (inside its 60 s slot) and a live heat1 ON row 3 s after
        # the replayed one: neither is written again.
        await conn.execute("INSERT INTO climate (ts, temp_avg) VALUES ($1, 71.0)", at(t0, 120) - timedelta(seconds=30))
        await conn.execute(
            "INSERT INTO equipment_state (ts, equipment, state) VALUES ($1, 'heat1', true)",
            at(t0, 10) + timedelta(seconds=3),
        )
        q = quarter(
            2,
            40,
            t0,
            [record(0, 1), record(60, 2), record(120, 3)],
            [transition(10, "heat1", True, 1), transition(100, "heat1", False, 2), transition(110, "fan1", True, 3)],
        )
        results = await gap_replay.write_pass(_Pool(conn), replay_pass(q))
        assert [(r.skipped, r.ledgered, r.climate_rows, r.transition_rows, r.unplaced) for r in results] == [
            (False, True, 2, 2, 0)
        ]
        climate = await conn.fetch(
            "SELECT ts, temp_avg, dew_point, rh_avg, vpd_avg, outdoor_temp_f, water_total_gal FROM climate ORDER BY ts"
        )
        assert [r["ts"] for r in climate] == [at(t0, 0), at(t0, 60), at(t0, 120) - timedelta(seconds=30)]
        assert (climate[0]["temp_avg"], climate[0]["dew_point"], climate[0]["outdoor_temp_f"]) == (70.0, 50.0, 40.0)
        assert climate[0]["water_total_gal"] == 12.3 and climate[0]["rh_avg"] is not None
        states = await conn.fetch("SELECT ts, equipment, state FROM equipment_state ORDER BY ts, equipment")
        assert [(r["equipment"], r["state"]) for r in states] == [("heat1", True), ("heat1", False), ("fan1", True)]
        assert states[0]["ts"] == at(t0, 10) + timedelta(seconds=3)
        ledger = await conn.fetchrow("SELECT * FROM gap_replay_quarters")
        assert (ledger["boot"], ledger["qseq"], ledger["format_version"]) == (7, 40, 2)
        assert (ledger["climate_rows"], ledger["transition_rows"]) == (3, 3)  # as sent, not as new
        assert (ledger["first_ts"], ledger["last_ts"]) == (at(t0, 0), at(t0, 120))

        # The same quarter in a later pass is skipped whole.
        again = await gap_replay.write_pass(_Pool(conn), replay_pass(q))
        assert [r.skipped for r in again] == [True]
        assert await conn.fetchval("SELECT count(*) FROM climate") == 3
        assert await conn.fetchval("SELECT count(*) FROM equipment_state") == 3
        assert await conn.fetchval("SELECT count(*) FROM gap_replay_quarters") == 1

    scenario(dsn, body)


def test_a_format_1_quarter_uses_the_five_minute_slot(dsn):
    async def body(conn, t0):
        # 200 s before the second record: outside a 60 s slot, inside format 1's 300 s one.
        await conn.execute("INSERT INTO climate (ts, temp_avg) VALUES ($1, 71.0)", at(t0, 300) - timedelta(seconds=200))
        q = quarter(1, 41, t0, [record(0, 1), record(300, 2)], [transition(30, "vent", True, 1)])
        [result] = await gap_replay.write_pass(_Pool(conn), replay_pass(q))
        assert (result.ledgered, result.climate_rows, result.transition_rows) == (True, 1, 1)
        assert await conn.fetchval("SELECT format_version FROM gap_replay_quarters WHERE qseq = 41") == 1
        assert await conn.fetchval("SELECT count(*) FROM climate") == 2

    scenario(dsn, body)
