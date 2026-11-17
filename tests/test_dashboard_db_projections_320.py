"""Migration 320's three dashboard projections on a private database.

The campaign step starts a fresh server for each tests/test_dashboard_db_*.py file and sets
VERDIFY_ISOLATED_TEST_DSN; without it this file skips. The test builds planner_review (313's table),
daily_relay_record (310's) and gap_replay_quarters (314's) from their migrations, gives the ingestor and MCP duties
the table grants production has, runs the statements between 320's $predecessor$ and $successor$ blocks, and then
reads each projection as verdify_dashboard_runtime (the operator API's duty). The duty reads every projection and no
base table, the ingestor duty is refused on every projection, and the base tables' ACLs are unchanged.

A service test that needs the projections builds them with projections_sql() after creating public.greenhouses
(daily_relay_record references it) and verdify_dashboard_runtime.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import re
import sys
from pathlib import Path

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
if str(TESTS) not in sys.path:
    sys.path.insert(0, str(TESTS))

from test_dashboard_db_band_compliance import private_dsn  # noqa: E402

DUTY = "verdify_dashboard_runtime"
INGESTOR = "verdify_ingestor_runtime"
MCP = "verdify_mcp_runtime"
COLUMNS = {
    "v_dashboard_review": [
        "id", "kind", "review_date", "requested_at", "requested_by", "status", "attempts", "delivered_at", "failure",
        "run_finished_at", "input_tokens", "output_tokens", "total_tokens", "written_at", "summary", "band_proposal",
    ],
    "v_dashboard_relay_day": [
        "date", "greenhouse_id", "equipment", "starts", "run_s", "event_run_s", "repaired_runs", "computed_at",
    ],
    "v_dashboard_gap_replay": [
        "boot", "qseq", "first_ts", "last_ts", "climate_rows", "transition_rows", "format_version", "received_at",
    ],
}  # fmt: skip
BASE_TABLES = ("planner_review", "daily_relay_record", "gap_replay_quarters")


def table(migration: str, name: str) -> str:
    text = (ROOT / "db/migrations" / migration).read_text()
    match = re.search(rf"CREATE TABLE public\.{name} \(.*?\n\);", text, re.S)
    assert match, name
    return match.group(0)


def body_320() -> str:
    source = (ROOT / "db/migrations/320-dashboard-projections.sql").read_text()
    return source.split("END $predecessor$;", 1)[1].split("DO $successor$", 1)[0]


def projections_sql() -> str:
    """The three base tables as their migrations create them, then 320's views, comments and grants."""
    return "\n".join(
        (
            table("313-planner-review.sql", "planner_review"),
            table("310-daily-record.sql", "daily_relay_record"),
            table("314-controller-health-and-gap-ledger.sql", "gap_replay_quarters"),
            body_320(),
        )
    )


SETUP = f"""
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{DUTY}') THEN CREATE ROLE {DUTY} NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{INGESTOR}') THEN CREATE ROLE {INGESTOR} NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{MCP}') THEN CREATE ROLE {MCP} NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO {DUTY}, {INGESTOR};
CREATE TABLE public.greenhouses (id text PRIMARY KEY);
INSERT INTO public.greenhouses VALUES ('vallery');
{table("313-planner-review.sql", "planner_review")}
{table("310-daily-record.sql", "daily_relay_record")}
{table("314-controller-health-and-gap-ledger.sql", "gap_replay_quarters")}
GRANT SELECT ON public.planner_review TO {INGESTOR};
GRANT INSERT (run_id, kind, review_date, requested_by) ON public.planner_review TO {INGESTOR};
GRANT SELECT ON public.planner_review TO {MCP};
GRANT UPDATE (status, written_at, summary, band_proposal) ON public.planner_review TO {MCP};
GRANT SELECT ON public.daily_relay_record, public.gap_replay_quarters TO {INGESTOR};
"""

# Production samples of 2026-11-16 and 2026-11-17 (review 2, two relay days, two replayed quarters).
ROWS = """
INSERT INTO public.planner_review (run_id, kind, review_date, requested_at, requested_by, status, attempts,
    delivered_at, hermes_run_id, gateway_status, run_finished_at, input_tokens, output_tokens, total_tokens,
    written_at, summary)
VALUES ('00000000-0000-4000-8000-000000000320', 'daily', DATE '2026-11-16', TIMESTAMPTZ '2026-11-17 14:00:04Z',
        'ingestor', 'written', 1, TIMESTAMPTZ '2026-11-17 14:00:04Z', 'run_sample', 202,
        TIMESTAMPTZ '2026-11-17 14:04:04Z', 340590, 14538, 355128, TIMESTAMPTZ '2026-11-17 14:03:07Z',
        'No band edit proposed.');
INSERT INTO public.daily_relay_record (date, equipment, starts, run_s, event_run_s, repaired_runs, computed_at)
VALUES (DATE '2026-11-16', 'heat2', 25, 13741, 13276, 1, TIMESTAMPTZ '2026-11-17 07:02:47Z'),
       (DATE '2026-11-16', 'vent', 22, 4281, 3679, 2, TIMESTAMPTZ '2026-11-17 07:02:47Z');
INSERT INTO public.gap_replay_quarters (boot, qseq, first_ts, last_ts, climate_rows, transition_rows,
    format_version, received_at)
VALUES (2, 55, TIMESTAMPTZ '2026-11-17 15:19:40Z', TIMESTAMPTZ '2026-11-17 15:34:12Z', 15, 2, 2,
        TIMESTAMPTZ '2026-11-17 15:34:46Z'),
       (2, 19, TIMESTAMPTZ '2026-11-17 06:34:24Z', TIMESTAMPTZ '2026-11-17 06:34:24Z', 1, 0, 2,
        TIMESTAMPTZ '2026-11-17 06:35:56Z');
"""

ACLS = """
SELECT c.relname, coalesce(c.relacl::text, ''),
       coalesce((SELECT string_agg(t.attname || '=' || t.attacl::text, ',' ORDER BY t.attnum)
                   FROM pg_attribute t WHERE t.attrelid = c.oid AND t.attnum > 0 AND t.attacl IS NOT NULL), '')
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1::text[])
 ORDER BY c.relname
"""

VIEW_ACL = """
SELECT (SELECT count(*) FROM aclexplode(c.relacl) a WHERE a.grantee = c.relowner) AS owner_entries,
       (SELECT count(*) FROM aclexplode(c.relacl) a WHERE a.grantee = 0) AS public_entries,
       (SELECT array_agg(r.rolname || ':' || a.privilege_type || ':' || a.is_grantable::text ORDER BY r.rolname)
          FROM aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
         WHERE a.grantee <> c.relowner) AS others,
       (SELECT count(*) FROM pg_attribute t
         WHERE t.attrelid = c.oid AND t.attnum > 0 AND t.attacl IS NOT NULL) AS column_acls,
       c.relkind, pg_get_userbyid(c.relowner) = current_user AS owned
  FROM pg_class c WHERE c.oid = $1::text::regclass
"""


async def refused(conn: asyncpg.Connection, sql: str) -> bool:
    try:
        await conn.fetch(sql)
    except asyncpg.InsufficientPrivilegeError:
        return True
    return False


async def scenario(dsn: str) -> dict:
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(SETUP)
        before = await conn.fetch(ACLS, list(BASE_TABLES))
        await conn.execute(body_320())
        after = await conn.fetch(ACLS, list(BASE_TABLES))
        await conn.execute(ROWS)
        view_acls = {view: dict(await conn.fetchrow(VIEW_ACL, f"public.{view}")) for view in COLUMNS}

        await conn.execute(f"SET ROLE {DUTY}")
        reads = {view: await conn.fetch(f"SELECT * FROM public.{view} ORDER BY 1, 2, 3") for view in COLUMNS}
        duty_base = {name: await refused(conn, f"SELECT 1 FROM public.{name} LIMIT 1") for name in BASE_TABLES}
        await conn.execute("RESET ROLE")

        await conn.execute(f"SET ROLE {INGESTOR}")
        ingestor = {view: await refused(conn, f"SELECT 1 FROM public.{view} LIMIT 1") for view in COLUMNS}
        await conn.execute("RESET ROLE")
        return {
            "before": [tuple(r) for r in before],
            "after": [tuple(r) for r in after],
            "view_acls": view_acls,
            "reads": reads,
            "duty_base": duty_base,
            "ingestor": ingestor,
        }
    finally:
        await conn.close()


def test_the_duty_reads_each_projection_and_nothing_else_reaches_them():
    dsn = private_dsn()
    got = asyncio.run(scenario(dsn))

    # The base tables' table and column ACLs are what they were before 320, and the duty reads none of them.
    assert got["before"] == got["after"] and len(got["before"]) == len(BASE_TABLES)
    assert got["duty_base"] == {name: True for name in BASE_TABLES}

    # Each view: the owner's entry, one non-grantable SELECT for the duty, no PUBLIC entry, no column ACL.
    for view, acl in got["view_acls"].items():
        assert acl == {
            "owner_entries": acl["owner_entries"],
            "public_entries": 0,
            "others": [f"{DUTY}:SELECT:false"],
            "column_acls": 0,
            "relkind": "v",
            "owned": True,
        }, view
        assert acl["owner_entries"] > 0, view

    # The duty reads exactly the specified columns, in order, with the stored values.
    for view, rows in got["reads"].items():
        assert rows, view
        assert list(rows[0].keys()) == COLUMNS[view], view
    review = got["reads"]["v_dashboard_review"][0]
    assert (review["kind"], review["review_date"], review["status"], review["attempts"]) == (
        "daily",
        dt.date(2026, 11, 16),
        "written",
        1,
    )
    assert (review["input_tokens"], review["output_tokens"], review["total_tokens"]) == (340590, 14538, 355128)
    assert review["failure"] is None and review["band_proposal"] is None
    assert review["summary"] == "No band edit proposed."
    relay = {r["equipment"]: r for r in got["reads"]["v_dashboard_relay_day"]}
    assert (relay["heat2"]["starts"], relay["heat2"]["run_s"], relay["heat2"]["event_run_s"]) == (25, 13741, 13276)
    assert relay["vent"]["repaired_runs"] == 2 and relay["vent"]["greenhouse_id"] == "vallery"
    quarters = {(r["boot"], r["qseq"]): r for r in got["reads"]["v_dashboard_gap_replay"]}
    assert set(quarters) == {(2, 19), (2, 55)}
    assert (quarters[(2, 55)]["climate_rows"], quarters[(2, 55)]["transition_rows"]) == (15, 2)
    assert quarters[(2, 19)]["first_ts"] == quarters[(2, 19)]["last_ts"]

    # Another runtime duty is refused on every projection.
    assert got["ingestor"] == {view: True for view in COLUMNS}
