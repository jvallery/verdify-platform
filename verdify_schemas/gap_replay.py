"""The controller's gap-log replay lines (contracts gap-log section 9, format G1; #1633 host release 3).

The third-flash firmware keeps a ring of 15-minute quarters while the API session is down and replays each one that
the host did not see live over the ``gap_replay`` text sensor, one line per publish:

    G1 B <boot> <uptime_s> <epoch_s> <n>                                   a pass begins
    G1 Q <boot> <qseq> <ver> <flags> <t0> <off> <n_clim> <n_tr>             one quarter's header
    G1 C <qseq> c=<dt>,<flags>,<mode>,<tin>,<tdp>,<tout>,<relays>,<water>,<seq> ...   its climate records
    G1 T <qseq> <dt>,<relay>,<state>,<seq> ...                              its relay transitions
    G1 E <boot> <n> <last_qseq>                                             the pass ended

``parse_gap_line`` turns one line into one model or raises ``GapLineError``; the ingestor (``ingestor/gap_replay.py``)
assembles a pass and writes it. Lines are ASCII, single-spaced decimal integers, at most 240 characters.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

LINE_MAX_CHARS = 240
FORMAT_PREFIX = "G1"
NO_VALUE = -32768  # INT16_MIN: the temperature is not known
KNOWN_VERSIONS = frozenset({1, 2})  # 2 = one climate record per minute, 1 = the 5-minute fallback
RECORD_SPACING_S = {2: 60, 1: 300}
MAX_CLIMATE_GROUPS = 5
MAX_TRANSITION_GROUPS = 12

# Quarter flags.
FLAG_CLOCK_TRUSTED = 1 << 0  # t0 is epoch seconds; otherwise uptime seconds
FLAG_PARTIAL = 1 << 1
FLAG_TRANSITIONS_TRUNCATED = 1 << 2
FLAG_LIVE = 1 << 3  # the API session was up for the whole quarter: never replayed

# Climate record flags.
REC_INDOOR_VALID = 1 << 0
REC_HUMIDITY_VALID = 1 << 1
REC_OUTDOOR_VALID = 1 << 2

# Section 9.3: the relay index, as the equipment names the ingestor writes to equipment_state. Appended, never reused.
RELAYS: tuple[str, ...] = (
    "heat1",
    "heat2",
    "fan1",
    "fan2",
    "fog",
    "vent",
    "mister_south",
    "mister_south_fert",
    "mister_west",
    "mister_west_fert",
    "mister_center",
    "drip_wall",
    "drip_wall_fert",
    "drip_center",
    "drip_center_fert",
    "fert_master_valve",
    "grow_light_main_intent",
    "grow_light_grow_intent",
)

U16 = Annotated[int, Field(ge=0, le=0xFFFF)]
U32 = Annotated[int, Field(ge=0, le=0xFFFFFFFF)]
I16 = Annotated[int, Field(ge=-32768, le=32767)]


class GapLineError(ValueError):
    """A line that does not parse: the host logs and drops it, never retries it."""


class _Line(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class PassBegin(_Line):
    kind: Literal["B"] = "B"
    boot: U16
    uptime_s: U32
    epoch_s: U32  # 0 when the clock is not trusted now
    n: U32


class QuarterHeader(_Line):
    kind: Literal["Q"] = "Q"
    boot: U16
    qseq: U32
    ver: int
    flags: Annotated[int, Field(ge=0, le=0xFF)]
    t0: U32
    off: U32  # epoch minus uptime when the clock was trusted at the write; 0 = unknown
    n_clim: Annotated[int, Field(ge=0, le=15)]
    n_tr: Annotated[int, Field(ge=0, le=64)]


class ClimateRecord(_Line):
    dt: U16
    flags: Annotated[int, Field(ge=0, le=0xFF)]
    mode: Annotated[int, Field(ge=0, le=0xFF)]
    tin: I16
    tdp: I16
    tout: I16
    relays: U32
    water: U32
    seq: U16

    @staticmethod
    def _f(value: int) -> float | None:
        return None if value == NO_VALUE else value / 10.0

    @property
    def indoor_temp_f(self) -> float | None:
        return self._f(self.tin) if self.flags & REC_INDOOR_VALID else None

    @property
    def indoor_dewpoint_f(self) -> float | None:
        return self._f(self.tdp) if self.flags & REC_HUMIDITY_VALID else None

    @property
    def outdoor_temp_f(self) -> float | None:
        return self._f(self.tout) if self.flags & REC_OUTDOOR_VALID else None

    @property
    def water_gal(self) -> float:
        return self.water / 10.0


class ClimateLine(_Line):
    kind: Literal["C"] = "C"
    qseq: U32
    records: tuple[ClimateRecord, ...] = Field(min_length=1, max_length=MAX_CLIMATE_GROUPS)


class Transition(_Line):
    dt: U16
    relay: Annotated[int, Field(ge=0, le=0xFF)]
    state: Annotated[int, Field(ge=0, le=0xFF)]
    seq: U16

    @property
    def equipment(self) -> str | None:
        """The equipment_state name, or None for an index this host does not know yet."""
        return RELAYS[self.relay] if self.relay < len(RELAYS) else None

    @property
    def on(self) -> bool:
        return bool(self.state & 1)


class TransitionLine(_Line):
    kind: Literal["T"] = "T"
    qseq: U32
    transitions: tuple[Transition, ...] = Field(min_length=1, max_length=MAX_TRANSITION_GROUPS)


class PassEnd(_Line):
    kind: Literal["E"] = "E"
    boot: U16
    n: U32
    last_qseq: U32


GapReplayLine = PassBegin | QuarterHeader | ClimateLine | TransitionLine | PassEnd


def _ints(fields: list[str], count: int, what: str) -> list[int]:
    if len(fields) != count:
        raise GapLineError(f"{what} needs {count} fields, got {len(fields)}")
    try:
        return [int(field, 10) for field in fields]
    except ValueError as error:
        raise GapLineError(f"{what} has a field that is not a decimal integer") from error


def parse_gap_line(line: str) -> GapReplayLine:
    """One replay line as its model; ``GapLineError`` for anything else."""
    if not isinstance(line, str) or not line.isascii():
        raise GapLineError("not an ASCII line")
    if len(line) > LINE_MAX_CHARS:
        raise GapLineError(f"longer than {LINE_MAX_CHARS} characters")
    tokens = line.split(" ")
    if len(tokens) < 2 or tokens[0] != FORMAT_PREFIX or "" in tokens:
        raise GapLineError("not a single-spaced G1 line")
    kind, rest = tokens[1], tokens[2:]
    try:
        if kind == "B":
            boot, uptime_s, epoch_s, n = _ints(rest, 4, "B")
            return PassBegin(boot=boot, uptime_s=uptime_s, epoch_s=epoch_s, n=n)
        if kind == "Q":
            boot, qseq, ver, flags, t0, off, n_clim, n_tr = _ints(rest, 8, "Q")
            if ver not in KNOWN_VERSIONS:
                raise GapLineError(f"unknown record version {ver}")
            return QuarterHeader(boot=boot, qseq=qseq, ver=ver, flags=flags, t0=t0, off=off, n_clim=n_clim, n_tr=n_tr)
        if kind == "C":
            if len(rest) < 2:
                raise GapLineError("C needs a quarter and at least one record")
            (qseq,) = _ints(rest[:1], 1, "C quarter")
            records = []
            for group in rest[1:]:
                if not group.startswith("c="):
                    raise GapLineError("a C record must start with c=")
                values = _ints(group[2:].split(","), 9, "C record")
                records.append(ClimateRecord(**dict(zip(ClimateRecord.model_fields, values, strict=True))))
            return ClimateLine(qseq=qseq, records=tuple(records))
        if kind == "T":
            if len(rest) < 2:
                raise GapLineError("T needs a quarter and at least one transition")
            (qseq,) = _ints(rest[:1], 1, "T quarter")
            transitions = [
                Transition(**dict(zip(Transition.model_fields, _ints(group.split(","), 4, "T group"), strict=True)))
                for group in rest[1:]
            ]
            return TransitionLine(qseq=qseq, transitions=tuple(transitions))
        if kind == "E":
            boot, n, last_qseq = _ints(rest, 3, "E")
            return PassEnd(boot=boot, n=n, last_qseq=last_qseq)
    except ValueError as error:  # pydantic's ValidationError is a ValueError
        if isinstance(error, GapLineError):
            raise
        raise GapLineError(f"{kind} line out of range") from error
    raise GapLineError(f"unknown line type {kind!r}")


def format_gap_line(model: GapReplayLine) -> str:
    """The wire form of a model (tests and fixtures; the firmware is the only real writer)."""
    if isinstance(model, PassBegin):
        fields = [model.boot, model.uptime_s, model.epoch_s, model.n]
    elif isinstance(model, QuarterHeader):
        fields = [model.boot, model.qseq, model.ver, model.flags, model.t0, model.off, model.n_clim, model.n_tr]
    elif isinstance(model, ClimateLine):
        groups = ["c=" + ",".join(str(v) for v in record.model_dump().values()) for record in model.records]
        return " ".join([FORMAT_PREFIX, "C", str(model.qseq), *groups])
    elif isinstance(model, TransitionLine):
        groups = [",".join(str(v) for v in t.model_dump().values()) for t in model.transitions]
        return " ".join([FORMAT_PREFIX, "T", str(model.qseq), *groups])
    else:
        fields = [model.boot, model.n, model.last_qseq]
    return " ".join([FORMAT_PREFIX, model.kind, *(str(v) for v in fields)])
