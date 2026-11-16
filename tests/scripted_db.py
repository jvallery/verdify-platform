"""Scripted asyncpg stand-ins for pure unit tests (no live database).

``FakeConn`` answers each query by the first responder whose SQL fragment the
statement contains and records every call; ``FakePool`` hands it out.
"""

from __future__ import annotations


class FakeConn:
    """Answer queries by first-matching SQL substring; record every call."""

    def __init__(self, responders):
        self.responders = list(responders)
        self.calls: list[tuple[str, str, tuple]] = []

    def _respond(self, kind, sql, args, default):
        self.calls.append((kind, " ".join(sql.split()), args))
        for fragment, result in self.responders:
            if fragment in sql:
                return result(args) if callable(result) else result
        return default

    async def fetchrow(self, sql, *args):
        return self._respond("fetchrow", sql, args, None)

    async def fetch(self, sql, *args):
        return self._respond("fetch", sql, args, [])

    async def fetchval(self, sql, *args):
        return self._respond("fetchval", sql, args, None)

    async def execute(self, sql, *args):
        return self._respond("execute", sql, args, "OK")

    def sql_calls(self, fragment):
        return [(kind, sql, args) for kind, sql, args in self.calls if fragment in sql]


class _Acquire:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *exc):
        return False


class FakePool:
    def __init__(self, conn):
        self._conn = conn
        self.acquired = 0

    def acquire(self):
        self.acquired += 1
        return _Acquire(self._conn)
