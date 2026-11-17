"""Gap-log replay host (contracts gap-log section 9.7; RULINGS AE8): parser, pass assembly, placement, idempotent writes."""

from __future__ import annotations

import re
import sys
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

INGESTOR_PATH = str(Path(__file__).resolve().parent.parent / "ingestor")
if INGESTOR_PATH not in sys.path:
    sys.path.insert(0, INGESTOR_PATH)

import gap_replay  # noqa: E402

from verdify_schemas.gap_replay import (  # noqa: E402
    FLAG_CLOCK_TRUSTED,
    FLAG_LIVE,
    REC_HUMIDITY_VALID,
    REC_INDOOR_VALID,
    REC_OUTDOOR_VALID,
    ClimateLine,
    ClimateRecord,
    GapLineError,
    PassBegin,
    PassEnd,
    QuarterHeader,
    Transition,
    TransitionLine,
    format_gap_line,
    parse_gap_line,
)

EPOCH = 1_795_000_000  # a trusted quarter start, 2026-11
ALL_VALID = REC_INDOOR_VALID | REC_HUMIDITY_VALID | REC_OUTDOOR_VALID


def _record(
    dt: int, seq: int, *, tin: int = 652, tdp: int = 481, tout: int = 312, flags: int = ALL_VALID
) -> ClimateRecord:
    return ClimateRecord(dt=dt, flags=flags, mode=2, tin=tin, tdp=tdp, tout=tout, relays=0b101, water=1234, seq=seq)


# ── parser ───────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "model",
    [
        PassBegin(boot=7, uptime_s=3600, epoch_s=EPOCH, n=2),
        PassBegin(boot=7, uptime_s=3600, epoch_s=0, n=0),
        QuarterHeader(boot=7, qseq=41, ver=2, flags=FLAG_CLOCK_TRUSTED, t0=EPOCH, off=EPOCH - 100, n_clim=15, n_tr=3),
        QuarterHeader(boot=7, qseq=42, ver=1, flags=0, t0=900, off=0, n_clim=3, n_tr=0),
        ClimateLine(qseq=41, records=tuple(_record(60 * i, i) for i in range(5))),
        ClimateLine(qseq=41, records=(_record(0, 1, tin=-32768, tdp=-32768, tout=-32768, flags=0),)),
        TransitionLine(qseq=41, transitions=tuple(Transition(dt=i, relay=i, state=i % 2, seq=i) for i in range(12))),
        PassEnd(boot=7, n=2, last_qseq=42),
    ],
)
def test_every_line_type_round_trips_every_field(model):
    line = format_gap_line(model)
    assert len(line) <= 240
    assert parse_gap_line(line) == model


@pytest.mark.parametrize(
    "line",
    [
        "",
        "G1",
        "G2 B 1 2 3 4",
        "G1 X 1 2",
        "G1 B 1 2 3",  # a field short
        "G1 B 1 2 3 4 5",  # a field over
        "G1  B 1 2 3 4",  # double space
        "G1 B 1 2 3 x",
        "G1 B 70000 2 3 4",  # boot over u16
        "G1 Q 1 2 3 0 0 0 0 0",  # unknown version
        "G1 Q 1 2 2 0 0 0 16 0",  # n_clim over 15
        "G1 C 41",
        "G1 C 41 1,2,3,4,5,6,7,8,9",  # missing c=
        "G1 C 41 c=1,2,3,4,5,6,7,8",  # eight fields
        "G1 C 41 " + " ".join(["c=0,0,0,0,0,0,0,0,0"] * 6),  # six groups
        "G1 T 41 1,2,3",
        "G1 E 1 2",
        "G1 B 1 2 3 4 " + "9" * 240,  # over-long
        "G1 B 1 2 3 ¹",
    ],
)
def test_a_malformed_or_over_long_line_is_rejected(line):
    with pytest.raises(GapLineError):
        parse_gap_line(line)


# ── a fake database: climate, equipment_state and the ledger ─────────────────
class FakeConn:
    def __init__(self) -> None:
        self.climate: list[tuple[datetime, dict]] = []
        self.equipment: list[tuple[datetime, str, bool]] = []
        self.ledger: dict[tuple[int, int], tuple] = {}

    @asynccontextmanager
    async def transaction(self):
        snapshot = (list(self.climate), list(self.equipment), dict(self.ledger))
        try:
            yield
        except BaseException:
            self.climate, self.equipment, self.ledger = snapshot
            raise

    async def fetchval(self, sql: str, *args):
        if "FROM gap_replay_quarters" in sql:
            return 1 if (args[0], args[1]) in self.ledger else None
        if "FROM climate" in sql:
            ts, secs = args
            return 1 if any(ts - timedelta(seconds=secs) < t <= ts for t, _ in self.climate) else None
        if "FROM equipment_state" in sql:
            equipment, value, ts, secs = args
            near = timedelta(seconds=secs)
            return (
                1 if any(e == equipment and s == value and abs(t - ts) <= near for t, e, s in self.equipment) else None
            )
        raise AssertionError(sql)

    async def execute(self, sql: str, *args):
        if "v_runtime_climate_write" in sql:
            cols = re.search(r"\(([^)]*)\)", sql).group(1).replace(" ", "").split(",")
            row = dict(zip(cols, args, strict=True))
            self.climate.append((row.pop("ts"), row))
        elif "v_runtime_equipment_state_write" in sql:
            self.equipment.append(args)
        elif "INSERT INTO gap_replay_quarters" in sql:
            key = (args[0], args[1])
            assert key not in self.ledger, "unique_violation"
            self.ledger[key] = args[2:]
        else:
            raise AssertionError(sql)


class FakePool:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


def _pass_lines(
    *, flags: int = FLAG_CLOCK_TRUSTED, t0: int = EPOCH, off: int = 0, boot: int = 7, b_epoch: int = 0
) -> list[str]:
    header = QuarterHeader(boot=boot, qseq=41, ver=2, flags=flags, t0=t0, off=off, n_clim=6, n_tr=2)
    records = [_record(60 * i, i) for i in range(6)]
    return [
        format_gap_line(PassBegin(boot=boot, uptime_s=5000, epoch_s=b_epoch, n=1)),
        format_gap_line(header),
        format_gap_line(ClimateLine(qseq=41, records=tuple(records[:5]))),
        format_gap_line(ClimateLine(qseq=41, records=tuple(records[5:]))),
        format_gap_line(
            TransitionLine(
                qseq=41,
                transitions=(Transition(dt=30, relay=2, state=1, seq=1), Transition(dt=200, relay=2, state=0, seq=2)),
            )
        ),
        format_gap_line(PassEnd(boot=boot, n=1, last_qseq=41)),
    ]


async def _replay(host, conn, lines):
    for line in lines:
        host.receive(line)
    return await host.write_pending(FakePool(conn))


def _at(epoch: int) -> datetime:
    return datetime.fromtimestamp(epoch, tz=UTC)


@pytest.mark.asyncio
async def test_a_pass_writes_its_rows_and_one_ledger_row_with_derived_humidity():
    conn = FakeConn()
    (result,) = await _replay(gap_replay.GapReplayHost(), conn, _pass_lines())
    assert (result.climate_rows, result.transition_rows, result.ledgered) == (6, 2, True)
    first_ts, last_ts, climate_rows, transition_rows, version = conn.ledger[(7, 41)]
    assert (first_ts, last_ts, climate_rows, transition_rows, version) == (_at(EPOCH), _at(EPOCH + 300), 6, 2, 2)
    ts, row = conn.climate[0]
    assert ts == _at(EPOCH)
    assert (row["temp_avg"], row["dew_point"], row["outdoor_temp_f"], row["water_total_gal"]) == (
        65.2,
        48.1,
        31.2,
        123.4,
    )
    assert 50 < row["rh_avg"] < 60 and 0.8 < row["vpd_avg"] < 1.0
    assert conn.equipment == [(_at(EPOCH + 30), "fan1", True), (_at(EPOCH + 200), "fan1", False)]


@pytest.mark.asyncio
async def test_a_pass_received_twice_yields_the_same_rows():
    conn = FakeConn()
    host = gap_replay.GapReplayHost()
    await _replay(host, conn, _pass_lines())
    rows = (list(conn.climate), list(conn.equipment), dict(conn.ledger))
    (again,) = await _replay(host, conn, _pass_lines())
    assert again.skipped
    assert (conn.climate, conn.equipment, conn.ledger) == rows


@pytest.mark.asyncio
async def test_an_unledgered_resend_adds_nothing_twice():
    """A short quarter has no ledger row; its resend is still idempotent row by row."""
    conn = FakeConn()
    host = gap_replay.GapReplayHost()
    short = _pass_lines()
    del short[3]  # the second C line: the quarter came in short
    (first,) = await _replay(host, conn, short)
    assert (first.climate_rows, first.ledgered) == (5, False)
    (second,) = await _replay(host, conn, _pass_lines())
    assert (second.climate_rows, second.transition_rows, second.ledgered) == (1, 0, True)
    assert len(conn.climate) == 6 and len(conn.equipment) == 2


@pytest.mark.asyncio
async def test_a_live_row_is_never_overwritten_and_blocks_a_replayed_one():
    conn = FakeConn()
    live = {"temp_avg": 70.0}
    conn.climate.append((_at(EPOCH + 60 + 20), live))  # live row inside the slot ending at minute 2
    conn.equipment.append((_at(EPOCH + 33), "fan1", True))  # the live transition, 3 s off
    (result,) = await _replay(gap_replay.GapReplayHost(), conn, _pass_lines())
    assert (result.climate_rows, result.transition_rows) == (5, 1)
    assert conn.ledger[(7, 41)] == (_at(EPOCH), _at(EPOCH + 300), 6, 2, 2)  # the quarter as sent
    assert conn.climate[0] == (_at(EPOCH + 80), live)
    assert not any(ts == _at(EPOCH + 120) for ts, _ in conn.climate)


@pytest.mark.parametrize(
    ("kwargs", "start"),
    [
        ({"flags": FLAG_CLOCK_TRUSTED, "t0": EPOCH}, EPOCH),  # trusted: t0 is epoch
        ({"flags": 0, "t0": 3600, "off": EPOCH}, EPOCH + 3600),  # off on the quarter
        ({"flags": 0, "t0": 3600, "b_epoch": EPOCH + 5000}, EPOCH + 3600),  # off from the B line
    ],
)
@pytest.mark.asyncio
async def test_placement(kwargs, start):
    conn = FakeConn()
    await _replay(gap_replay.GapReplayHost(), conn, _pass_lines(**kwargs))
    assert conn.climate[0][0] == _at(start)


@pytest.mark.asyncio
async def test_placement_from_a_later_quarter_of_the_same_boot():
    conn = FakeConn()
    host = gap_replay.GapReplayHost()
    lines = _pass_lines(flags=0, t0=3600)
    later = QuarterHeader(boot=7, qseq=42, ver=2, flags=0, t0=4500, off=EPOCH, n_clim=0, n_tr=0)
    lines.insert(-1, format_gap_line(later))
    await _replay(host, conn, lines)
    assert conn.climate[0][0] == _at(EPOCH + 3600)
    assert (7, 41) in conn.ledger and (7, 42) in conn.ledger


@pytest.mark.asyncio
async def test_an_unplaced_quarter_writes_nothing_and_stays_open():
    conn = FakeConn()
    (result,) = await _replay(gap_replay.GapReplayHost(), conn, _pass_lines(flags=0, t0=3600))
    assert (result.unplaced, result.ledgered) == (8, False)
    assert conn.climate == [] and conn.equipment == [] and conn.ledger == {}


@pytest.mark.asyncio
async def test_a_c_or_t_line_before_its_q_is_dropped_and_a_live_quarter_is_ignored():
    conn = FakeConn()
    host = gap_replay.GapReplayHost()
    lines = _pass_lines()
    lines.insert(1, format_gap_line(ClimateLine(qseq=99, records=(_record(0, 0),))))
    live = QuarterHeader(
        boot=7, qseq=40, ver=2, flags=FLAG_CLOCK_TRUSTED | FLAG_LIVE, t0=EPOCH - 900, off=0, n_clim=1, n_tr=0
    )
    lines.insert(1, format_gap_line(live))
    for line in lines:
        host.receive(line)
    (replay,) = host.pending
    assert replay.dropped_lines == 1 and sorted(replay.quarters) == [41]
    await host.write_pending(FakePool(conn))
    assert list(conn.ledger) == [(7, 41)]


@pytest.mark.asyncio
async def test_a_broken_pass_is_not_written_and_a_failed_write_stays_queued():
    host = gap_replay.GapReplayHost()
    for line in _pass_lines()[:-1]:  # no E line
        host.receive(line)
    assert not host.pending

    class Failing(FakeConn):
        async def execute(self, sql, *args):
            raise RuntimeError("database down")

    for line in _pass_lines():
        host.receive(line)
    assert await host.write_pending(FakePool(Failing())) == []
    assert len(host.pending) == 1 and host.failures == 1
    conn = FakeConn()
    await host.write_pending(FakePool(conn))
    assert not host.pending and (7, 41) in conn.ledger
    assert host.failures == 1  # a count since process start, for verdify_ingestor_gap_replay_failures_total


@pytest.mark.asyncio
async def test_a_failing_pass_is_counted_every_flush_and_logged_at_most_once_a_minute(caplog):
    now = [1000.0]
    host = gap_replay.GapReplayHost(clock=lambda: now[0])

    class Failing(FakeConn):
        async def execute(self, sql, *args):
            raise RuntimeError("operator does not exist")

    for line in _pass_lines():
        host.receive(line)
    caplog.set_level("ERROR", logger="ingestor.gap_replay")
    for _ in range(13):  # one minute of 5 s flushes
        await host.write_pending(FakePool(Failing()))
        now[0] += 5.0
    assert host.failures == 13 and len(host.pending) == 1
    assert [r.levelname for r in caplog.records].count("ERROR") == 2  # the first, then once 60 s later
    assert "13 time(s) in a row" in caplog.records[-1].getMessage()
