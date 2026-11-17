from importlib import util
from pathlib import Path

import asyncpg
import pytest

_SPEC = util.spec_from_file_location("verdify_api_main", Path(__file__).parents[1] / "api" / "main.py")
assert _SPEC and _SPEC.loader
main = util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(main)


class _Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _Connection:
    def __init__(self, *, cancel_fetch: bool = False):
        self.cancel_fetch = cancel_fetch
        self.executed: list[str] = []

    async def execute(self, statement: str):
        self.executed.append(statement)

    def transaction(self):
        return _Transaction()

    async def fetch(self, statement: str, *args):
        if self.cancel_fetch:
            raise asyncpg.QueryCanceledError("canceling statement due to statement timeout")
        return [{"metric": "planner_score", "value": 91.0}]

    async def fetchrow(self, statement: str, *args):
        if self.cancel_fetch:
            raise asyncpg.QueryCanceledError("canceling statement due to statement timeout")
        return {"available_for_scoring": True}


@pytest.mark.asyncio
async def test_api_pool_checkout_reapplies_query_safety_settings():
    conn = _Connection()

    await main._setup_db_connection(conn)

    assert conn.executed == [
        "SET application_name = 'verdify-api'",
        "SET statement_timeout = '15000ms'",
    ]


@pytest.mark.asyncio
async def test_scorecard_statement_timeout_degrades_to_empty_metrics():
    conn = _Connection(cancel_fetch=True)

    rows = await main._fetch_planner_scorecard(conn)

    assert rows == []
    assert conn.executed == ["SET LOCAL statement_timeout = '6000ms'"]


@pytest.mark.asyncio
async def test_optional_public_evidence_timeout_degrades_to_none():
    conn = _Connection(cancel_fetch=True)

    row = await main._fetchrow_optional(conn, "SELECT * FROM slow_optional_view")

    assert row is None
    assert conn.executed == ["SET LOCAL statement_timeout = '3000ms'"]


class _Pool:
    def __init__(self, conn):
        self.conn = conn
        self.acquired = 0

    def acquire(self):
        pool = self

        class _Acquire:
            async def __aenter__(self):
                pool.acquired += 1
                return pool.conn

            async def __aexit__(self, *exc):
                return False

        return _Acquire()


@pytest.fixture
def ledger(monkeypatch):
    monkeypatch.setattr(main, "_trust_ledger", {"rows": None, "at": None, "task": None})
    return main._trust_ledger


@pytest.mark.asyncio
async def test_the_trust_ledger_is_read_in_the_background_with_its_own_timeout(monkeypatch, ledger):
    """v_data_trust_ledger takes about 23 s (#1633 release 4): a request returns the cached rows at once and starts one
    refresh, which runs with the ledger's own timeout; until it ends the request sees no rows."""
    conn = _Connection()
    pool = _Pool(conn)
    monkeypatch.setattr(main, "pool", pool)

    assert main.trust_ledger_rows() == []
    assert main.trust_ledger_rows() == []  # a refresh already runs: no second one
    await ledger["task"]
    assert pool.acquired == 1
    assert conn.executed == ["SET LOCAL jit = off", f"SET LOCAL statement_timeout = '{main.TRUST_LEDGER_TIMEOUT_MS}ms'"]
    assert main.trust_ledger_rows() == [{"metric": "planner_score", "value": 91.0}]
    assert ledger["task"].done() and pool.acquired == 1  # fresh: no refresh until the TTL passes


@pytest.mark.asyncio
async def test_a_failed_trust_ledger_refresh_keeps_the_previous_rows_until_the_next_ttl(monkeypatch, ledger):
    ledger.update(rows=[{"check_name": "climate_freshness", "status": "ok"}], at=0.0)
    pool = _Pool(_Connection(cancel_fetch=True))
    monkeypatch.setattr(main, "pool", pool)

    assert main.trust_ledger_rows() == [{"check_name": "climate_freshness", "status": "ok"}]
    await ledger["task"]
    assert main.trust_ledger_rows() == [{"check_name": "climate_freshness", "status": "ok"}]
    assert pool.acquired == 1  # the failure stamps the time, so the next try waits for the TTL


def test_the_public_routes_never_query_the_trust_ledger_inline():
    source = (Path(__file__).parents[1] / "api" / "main.py").read_text()
    assert source.count("FROM v_data_trust_ledger") == 1  # TRUST_LEDGER_SQL only
    for route in ("async def public_data_health(", "async def public_evidence_snapshot("):
        body = source[source.index(route) :]
        body = body[: body.index("\n@app.")]
        assert "trust_ledger_rows()" in body, route
