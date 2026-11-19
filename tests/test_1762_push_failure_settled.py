"""#1762: an esp32_push_failed row resolves when each listed parameter is settled.

Settled means confirmed after the alert opened, read back by the controller after the alert opened equal to the newest
requested value (within the readback tolerance), or retired (no longer pushed). A row naming no parameter stays open.

The resolver's own SQL runs against a private throwaway PostgreSQL cluster with minimal tables. Set
PUSH_RESOLVE_TEST_PG_BIN (or SCORECARD_TEST_PG_BIN) to a local PostgreSQL bin directory; it never uses DB_DSN/PGHOST or
production credentials. Without server binaries the tests skip; test_event_alert_auto_resolve.py checks the wiring.
The rule was replayed read-only on production on 2026-11-17: it settles alert 14172 (a push failure during the 03:34Z
controller outage whose values held on reconnect), which the confirmed-only rule left open.
"""

from __future__ import annotations

import ast
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ALERTS = ROOT / "ingestor/tasks/alerts.py"
PUSHED = ["gl_grow_lux_hysteresis", "gl_main_lux_threshold", "mister_engage_delay_s"]
SECOND = ["mister_engage_delay_s"]


def _resolver_sql() -> str:
    tree = ast.parse(ALERTS.read_text())
    names = {"_READBACK_MATCH", "_RESOLVE_RECOVERED_PUSH_FAILURES_SQL"}
    body = [n for n in tree.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", None) in names]
    namespace: dict = {}
    exec(compile(ast.Module(body=body, type_ignores=[]), str(ALERTS), "exec"), namespace)  # noqa: S102
    return namespace["_RESOLVE_RECOVERED_PUSH_FAILURES_SQL"]


def _literal_array(values) -> str:
    return "ARRAY[" + ", ".join(f"'{v}'" for v in values) + "]::text[]"


def _bound_sql() -> str:
    sql = _resolver_sql()
    assert "$1::text[]" in sql and "$2::text[]" in sql
    return sql.replace("$1::text[]", _literal_array(SECOND)).replace("$2::text[]", _literal_array(PUSHED))


@pytest.fixture
def pg():
    bin_dir = os.environ.get("PUSH_RESOLVE_TEST_PG_BIN") or os.environ.get("SCORECARD_TEST_PG_BIN")
    if not bin_dir:
        pytest.skip("set PUSH_RESOLVE_TEST_PG_BIN to run the isolated PostgreSQL proof")
    pg_bin = Path(bin_dir)
    cluster = Path(tempfile.mkdtemp(prefix="pushres-pg-"))  # short: the socket path limit is 108 bytes
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env["LC_ALL"] = "C"

    def run(args, **kwargs):
        result = subprocess.run(args, env=env, text=True, capture_output=True, timeout=60, **kwargs)
        assert result.returncode == 0, result.stderr
        return result

    started = False
    try:
        run([str(pg_bin / "initdb"), "-D", str(cluster / "data"), "-U", "fixture", "--auth-local=trust",
             "--auth-host=reject", "--no-locale", "--encoding=UTF8"])  # fmt: skip
        run([str(pg_bin / "pg_ctl"), "-D", str(cluster / "data"), "-l", str(cluster / "server.log"), "-o",
             f"-k {cluster} -c listen_addresses='' -p 55473", "-w", "start"])  # fmt: skip
        started = True

        def query(sql):
            psql = [str(pg_bin / "psql"), "-X", "-v", "ON_ERROR_STOP=1", "-h", str(cluster), "-p", "55473",
                    "-U", "fixture", "-d", "postgres", "-qAt"]  # fmt: skip
            return run(psql, input=sql).stdout.strip()

        query(SCHEMA)
        yield query
    finally:
        if started:
            run([str(pg_bin / "pg_ctl"), "-D", str(cluster / "data"), "-m", "fast", "-w", "stop"])
        shutil.rmtree(cluster)


# The columns the resolver reads, with production's types.
SCHEMA = """
CREATE TABLE alert_log (id bigint PRIMARY KEY, alert_type text, disposition text, created_at timestamptz,
    resolved_at timestamptz, resolved_by text, resolution text, details jsonb);
CREATE TABLE setpoint_changes (ts timestamptz, parameter text, value double precision, source text,
    confirmed_at timestamptz);
CREATE TABLE setpoint_snapshot (ts timestamptz, parameter text, value double precision);
"""


def _alert(alert_id: int, params, opened="now() - interval '30 minutes'") -> str:
    details = "jsonb_build_object('parameters', to_jsonb(" + _literal_array(params) + "))"
    return (f"INSERT INTO alert_log VALUES ({alert_id}, 'esp32_push_failed', 'open', {opened}, NULL, NULL, NULL, "
            f"{details});")  # fmt: skip


def _resolved(pg, setup: str) -> dict[int, str]:
    out = pg(setup + "\n" + _bound_sql() + ";\nSELECT id || ':' || disposition FROM alert_log ORDER BY id;")
    return {int(row.split(":")[0]): row.split(":")[1] for row in out.splitlines()}


def test_read_back_equal_after_the_alert_resolves(pg):
    # 14172's pattern: the push failed on a disconnect, nothing was confirmed after, the reconnect reads back the value.
    setup = (
        _alert(1, ["gl_main_lux_threshold", "gl_grow_lux_hysteresis"])
        + "INSERT INTO setpoint_changes VALUES (now() - interval '2 hours', 'gl_main_lux_threshold', 40000, 'dispatcher',"
        " now() - interval '2 hours'), (now() - interval '35 minutes', 'gl_main_lux_threshold', 40000, 'dispatcher', NULL),"
        " (now() - interval '35 minutes', 'gl_grow_lux_hysteresis', 8000, 'dispatcher', NULL);"
        "INSERT INTO setpoint_snapshot VALUES (now() - interval '5 minutes', 'gl_main_lux_threshold', 40000),"
        " (now() - interval '5 minutes', 'gl_grow_lux_hysteresis', 8000.0004);"
    )
    assert _resolved(pg, setup) == {1: "resolved"}
    assert "read back as requested" in pg("SELECT resolution FROM alert_log WHERE id = 1;")


def test_a_retired_parameter_settles_once_the_others_do(pg):
    setup = (
        _alert(1, ["fog_escalation_kpa", "gl_main_lux_threshold"])
        + _alert(2, ["fog_escalation_kpa", "gl_grow_lux_hysteresis"])
        + "INSERT INTO setpoint_changes VALUES (now() - interval '1 minute', 'gl_main_lux_threshold', 40000,"
        " 'dispatcher', now() - interval '1 minute'), (now() - interval '35 minutes', 'gl_grow_lux_hysteresis', 8000,"
        " 'dispatcher', NULL);"
    )
    # Alert 1: fog_escalation_kpa is not pushed any more, the other was confirmed after. Alert 2: no readback yet.
    assert _resolved(pg, setup) == {1: "resolved", 2: "open"}


def test_one_parameter_still_unequal_keeps_the_alert_open(pg):
    setup = (
        _alert(1, ["gl_main_lux_threshold", "mister_engage_delay_s"])
        + "INSERT INTO setpoint_changes VALUES (now() - interval '35 minutes', 'gl_main_lux_threshold', 40000,"
        " 'dispatcher', NULL), (now() - interval '35 minutes', 'mister_engage_delay_s', 30, 'dispatcher', NULL),"
        " (now() - interval '2 minutes', 'mister_engage_delay_s', 31, 'esp32', NULL);"
        "INSERT INTO setpoint_snapshot VALUES (now() - interval '5 minutes', 'gl_main_lux_threshold', 40000),"
        " (now() - interval '5 minutes', 'mister_engage_delay_s', 32);"
    )
    # 32 vs the requested 30 is outside the 1 s tolerance; the controller's own esp32 row is not a request.
    assert _resolved(pg, setup) == {1: "open"}
    # Inside the 1 s tolerance it settles.
    assert _resolved(pg, "UPDATE setpoint_snapshot SET value = 31 WHERE parameter = 'mister_engage_delay_s';") == {
        1: "resolved"
    }


def test_a_readback_from_before_the_alert_does_not_settle(pg):
    setup = (
        _alert(1, ["gl_main_lux_threshold"])
        + "INSERT INTO setpoint_changes VALUES (now() - interval '35 minutes', 'gl_main_lux_threshold', 40000,"
        " 'dispatcher', NULL); INSERT INTO setpoint_snapshot VALUES (now() - interval '40 minutes',"
        " 'gl_main_lux_threshold', 40000);"
    )
    assert _resolved(pg, setup) == {1: "open"}


def test_a_row_naming_no_parameter_stays_open(pg):
    setup = (
        "INSERT INTO alert_log VALUES (1, 'esp32_push_failed', 'open', now() - interval '30 minutes', NULL, NULL, NULL,"
        ' \'{"reason": "validation"}\'::jsonb);'
    )
    assert _resolved(pg, setup) == {1: "open"}


def test_the_resolver_takes_tolerance_and_pushed_parameters_as_arguments():
    sql = re.sub(r"\s+", " ", _resolver_sql())
    assert "q.param = ANY($2::text[])" in sql
    assert "CASE WHEN q.param = ANY($1::text[]) THEN 1.0 ELSE 0.0 END" in sql
