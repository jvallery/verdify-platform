"""Gap-log replay host (contracts gap-log section 9; RULINGS AE8, W11; #1633 host release 3).

The controller replays the 15-minute quarters the host did not see live over the ``gap_replay`` text sensor, one
line per publish (``verdify_schemas.gap_replay``). This module:

- holds a pass from its ``B`` line until its ``E`` line; a ``C`` or ``T`` line whose ``Q`` this pass has not sent is
  dropped and logged, and a ``B`` line starts the pass over (the previous one broke);
- keeps a ``boot -> off`` map (epoch minus uptime) from the ``Q`` and ``B`` lines of the last 24 hours, so a quarter
  written before the clock was trusted can still be placed in time;
- writes each quarter in one transaction: climate rows where no row exists in the record's slot (60 s ending at its
  time; 300 s for format 1), equipment_state rows where no row of that equipment with the same state lies within 5 s,
  then one ``gap_replay_quarters`` ledger row. A quarter already in the ledger is skipped whole. A quarter that came
  in short (a pass broken mid-quarter) or has records it cannot place is written as far as it goes but gets no ledger
  row, so a later pass can complete it; the row checks keep that idempotent. The ledger row records the quarter as
  sent (its records and transitions and the placed span of all of them), not how many rows were new, so the span
  marks replayed minutes even where a live row already stood.

Live rows are never changed. Rows that already exist count as written by someone else, not by the replay.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime

from verdify_schemas.experiment_regimes import saturation_vapor_pressure_kpa
from verdify_schemas.gap_replay import (
    FLAG_CLOCK_TRUSTED,
    FLAG_LIVE,
    RECORD_SPACING_S,
    ClimateLine,
    ClimateRecord,
    GapLineError,
    PassBegin,
    PassEnd,
    QuarterHeader,
    Transition,
    TransitionLine,
    parse_gap_line,
)

log = logging.getLogger("ingestor.gap_replay")

GAP_REPLAY_SENSOR = "gap_replay"
OFFSET_MEMORY_S = 24 * 3600
EQUIPMENT_MATCH_S = 5
MAX_PENDING_PASSES = 4
MAX_PASS_QUARTERS = 96 * 2  # two days of quarters: more than the ring holds
FAILURE_LOG_INTERVAL_S = 60.0


@dataclass
class Quarter:
    header: QuarterHeader
    records: list[ClimateRecord] = field(default_factory=list)
    transitions: list[Transition] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return len(self.records) >= self.header.n_clim and len(self.transitions) >= self.header.n_tr


@dataclass
class ReplayPass:
    begin: PassBegin
    quarters: dict[int, Quarter] = field(default_factory=dict)
    end: PassEnd | None = None
    dropped_lines: int = 0
    offsets: dict[int, int] = field(default_factory=dict)  # boot -> off, frozen at E


@dataclass(frozen=True)
class QuarterResult:
    boot: int
    qseq: int
    skipped: bool = False
    ledgered: bool = False
    climate_rows: int = 0
    transition_rows: int = 0
    unplaced: int = 0


def _derived(record: ClimateRecord) -> tuple[float | None, float | None]:
    """RH and VPD from the indoor temperature and dew point, as for live rows (Tetens)."""
    tin, tdp = record.indoor_temp_f, record.indoor_dewpoint_f
    if tin is None or tdp is None:
        return None, None
    es_in = saturation_vapor_pressure_kpa(tin)
    ea = saturation_vapor_pressure_kpa(tdp)
    rh = max(0.0, min(100.0, 100.0 * ea / es_in))
    return round(rh, 2), round(max(0.0, es_in - ea), 3)


class GapReplayHost:
    """Assembles passes from lines and writes completed passes; one instance per ingestor."""

    def __init__(self, clock=time.time) -> None:
        self._clock = clock
        self._pass: ReplayPass | None = None
        self._boot_offsets: dict[int, tuple[int, float]] = {}
        self.pending: deque[ReplayPass] = deque()
        # Failed pass writes since the process started (ingestor_counters "gr", verdify_ingestor_gap_replay_failures_total),
        # the failures of the current run, and when the last one was logged.
        self.failures = 0
        self._failure_run = 0
        self._failure_logged_at = 0.0

    # ── assembly ─────────────────────────────────────────────────────────────
    def _learn_offset(self, boot: int, off: int) -> None:
        if off:
            self._boot_offsets[boot] = (off, self._clock())

    def _offsets_now(self) -> dict[int, int]:
        cutoff = self._clock() - OFFSET_MEMORY_S
        for boot in [b for b, (_, seen) in self._boot_offsets.items() if seen < cutoff]:
            del self._boot_offsets[boot]
        return {boot: off for boot, (off, _) in self._boot_offsets.items()}

    def receive(self, line: str) -> ReplayPass | None:
        """Take one published line; returns the pass when its ``E`` line completes it (also queued in ``pending``)."""
        try:
            parsed = parse_gap_line(line.strip())
        except GapLineError as error:
            log.warning("gap replay line dropped: %s", error)
            if self._pass is not None:
                self._pass.dropped_lines += 1
            return None

        if isinstance(parsed, PassBegin):
            if self._pass is not None and self._pass.end is None:
                log.warning("gap replay pass of boot %s broke before its end; a new pass begins", self._pass.begin.boot)
            if parsed.epoch_s:
                self._learn_offset(parsed.boot, parsed.epoch_s - parsed.uptime_s)
            self._pass = ReplayPass(begin=parsed)
            return None

        current = self._pass
        if current is None:
            log.warning("gap replay %s line outside a pass dropped", parsed.kind)
            return None

        if isinstance(parsed, QuarterHeader):
            self._learn_offset(parsed.boot, parsed.off)
            if parsed.flags & FLAG_LIVE:
                log.warning("gap replay quarter %s is marked live; ignored", parsed.qseq)
            elif len(current.quarters) >= MAX_PASS_QUARTERS:
                current.dropped_lines += 1
            else:
                current.quarters[parsed.qseq] = Quarter(header=parsed)
            return None

        if isinstance(parsed, (ClimateLine, TransitionLine)):
            quarter = current.quarters.get(parsed.qseq)
            if quarter is None:
                log.warning("gap replay %s line for quarter %s before its header dropped", parsed.kind, parsed.qseq)
                current.dropped_lines += 1
            elif isinstance(parsed, ClimateLine):
                quarter.records.extend(parsed.records[: max(0, quarter.header.n_clim - len(quarter.records))])
            else:
                quarter.transitions.extend(parsed.transitions[: max(0, quarter.header.n_tr - len(quarter.transitions))])
            return None

        assert isinstance(parsed, PassEnd)
        if parsed.boot != current.begin.boot:
            log.warning(
                "gap replay end of boot %s does not match the pass of boot %s; dropped", parsed.boot, current.begin.boot
            )
            self._pass = None
            return None
        current.end = parsed
        current.offsets = self._offsets_now()
        self._pass = None
        if len(self.pending) >= MAX_PENDING_PASSES:
            dropped = self.pending.popleft()
            log.error(
                "gap replay backlog full; dropped the pass of boot %s (the controller resends it)", dropped.begin.boot
            )
        self.pending.append(current)
        return current

    # ── placement ────────────────────────────────────────────────────────────
    @staticmethod
    def place(header: QuarterHeader, dt: int, offsets: dict[int, int]) -> datetime | None:
        """Section 9.5: the record's time, or None when it cannot be placed."""
        if header.flags & FLAG_CLOCK_TRUSTED:
            epoch = header.t0 + dt
        elif header.off:
            epoch = header.off + header.t0 + dt
        elif offsets.get(header.boot):
            epoch = offsets[header.boot] + header.t0 + dt
        else:
            return None
        return datetime.fromtimestamp(epoch, tz=UTC)

    # ── writes ───────────────────────────────────────────────────────────────
    async def write_pending(self, pool) -> list[QuarterResult]:
        """Write every queued pass, oldest first. A failure keeps that pass (and the ones behind it) queued for the
        next flush, counts in ``failures``, and is logged at ERROR on the first failure of a run and then at most once
        a minute. The queue holds at most MAX_PENDING_PASSES; receive() drops the oldest at ERROR when it is full."""
        results: list[QuarterResult] = []
        while self.pending:
            replay = self.pending[0]
            try:
                results.extend(await write_pass(pool, replay))
            except Exception as error:  # noqa: BLE001 - the pass stays queued; the next flush retries it
                self.failures += 1
                self._failure_run += 1
                now = self._clock()
                if self._failure_run == 1 or now - self._failure_logged_at >= FAILURE_LOG_INTERVAL_S:
                    self._failure_logged_at = now
                    log.error(
                        "gap replay pass of boot %s failed (%d time(s) in a row, %d pass(es) queued of at most %d); "
                        "kept for the next flush: %s",
                        replay.begin.boot,
                        self._failure_run,
                        len(self.pending),
                        MAX_PENDING_PASSES,
                        error,
                    )
                return results
            self.pending.popleft()
            if self._failure_run:
                log.info("gap replay pass of boot %s written after %d failure(s)", replay.begin.boot, self._failure_run)
                self._failure_run = 0
        return results


async def write_quarter(conn, quarter: Quarter, offsets: dict[int, int]) -> QuarterResult:
    header = quarter.header
    async with conn.transaction():
        if await conn.fetchval(
            "SELECT 1 FROM gap_replay_quarters WHERE boot = $1 AND qseq = $2", header.boot, header.qseq
        ):
            return QuarterResult(header.boot, header.qseq, skipped=True)

        spacing = RECORD_SPACING_S.get(header.ver, 60)
        placed: list[datetime] = []  # every placed record and transition: the ledger's span
        unplaced = 0
        climate_rows = 0
        for record in quarter.records:
            ts = GapReplayHost.place(header, record.dt, offsets)
            if ts is None:
                unplaced += 1
                continue
            placed.append(ts)
            if await conn.fetchval(
                "SELECT 1 FROM climate WHERE ts > $1::timestamptz - make_interval(secs => $2) AND ts <= $1::timestamptz LIMIT 1",
                ts,
                spacing,
            ):
                continue
            rh, vpd = _derived(record)
            await conn.execute(
                "INSERT INTO v_runtime_climate_write "
                "(ts, temp_avg, dew_point, rh_avg, vpd_avg, outdoor_temp_f, water_total_gal) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7)",
                ts,
                record.indoor_temp_f,
                record.indoor_dewpoint_f,
                rh,
                vpd,
                record.outdoor_temp_f,
                record.water_gal,
            )
            climate_rows += 1

        transition_rows = 0
        for transition in quarter.transitions:
            equipment = transition.equipment
            ts = GapReplayHost.place(header, transition.dt, offsets)
            if equipment is None or ts is None:
                unplaced += 1
                continue
            placed.append(ts)
            if await conn.fetchval(
                "SELECT 1 FROM equipment_state WHERE equipment = $1 AND state = $2 "
                "AND ts BETWEEN $3::timestamptz - make_interval(secs => $4) AND $3::timestamptz + make_interval(secs => $4) LIMIT 1",
                equipment,
                transition.on,
                ts,
                EQUIPMENT_MATCH_S,
            ):
                continue
            await conn.execute(
                "INSERT INTO v_runtime_equipment_state_write (ts, equipment, state) VALUES ($1, $2, $3)",
                ts,
                equipment,
                transition.on,
            )
            transition_rows += 1

        ledgered = quarter.complete and unplaced == 0
        if ledgered:
            await conn.execute(
                "INSERT INTO gap_replay_quarters "
                "(boot, qseq, first_ts, last_ts, climate_rows, transition_rows, format_version) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7)",
                header.boot,
                header.qseq,
                min(placed) if placed else None,
                max(placed) if placed else None,
                len(quarter.records),
                len(quarter.transitions),
                header.ver,
            )
    return QuarterResult(header.boot, header.qseq, False, ledgered, climate_rows, transition_rows, unplaced)


async def write_pass(pool, replay: ReplayPass) -> list[QuarterResult]:
    results: list[QuarterResult] = []
    async with pool.acquire() as conn:
        for qseq in sorted(replay.quarters):
            results.append(await write_quarter(conn, replay.quarters[qseq], replay.offsets))
    written = [r for r in results if not r.skipped]
    log.info(
        "gap replay pass of boot %s: %d quarters (%d already in the ledger), %d climate and %d equipment rows written, "
        "%d records unplaced, %d quarters left open, %d lines dropped",
        replay.begin.boot,
        len(results),
        len(results) - len(written),
        sum(r.climate_rows for r in written),
        sum(r.transition_rows for r in written),
        sum(r.unplaced for r in written),
        sum(1 for r in written if not r.ledgered),
        replay.dropped_lines,
    )
    return results


host = GapReplayHost()
