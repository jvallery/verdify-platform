"""Check shared Grafana SQL for relations removed by the migration-316 drop groups."""

import json
import re
from pathlib import Path

import pytest
from pglast import parser

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "db/migrations/316-experiment-v2-and-shadow-drops.sql"
TIME_MACROS = {"__time", "__timeFrom", "__timeTo", "__timeFilter"}


def statements(sql):
    return json.loads(parser.parse_sql_json(sql))["stmts"]


def dropped_relations():
    """The migration runs literal SQL in the dollar-quoted drop group entries."""
    relations = set()
    for statement_sql in re.findall(r"\$ddl\$(.*?)\$ddl\$", MIGRATION.read_text(), re.S):
        for statement in statements(statement_sql):
            drop = statement["stmt"].get("DropStmt", {})
            if drop.get("removeType") in {"OBJECT_TABLE", "OBJECT_VIEW"}:
                for obj in drop["objects"]:
                    schema, name = (part["String"]["sval"] for part in obj["List"]["items"])
                    relations.add((schema, name))
    assert ("public", "twin_decisions") in relations
    return relations


def parse_panel_sql(sql):
    # Treat Grafana macros as inert function calls for syntax analysis only. The
    # PostgreSQL scanner leaves comments and all quoted strings untouched.
    tokens = parser.scan(sql)
    sigils = [
        dollar.start
        for dollar, name, left_paren in zip(tokens[:-2], tokens[1:-1], tokens[2:], strict=True)
        if dollar.name == "ASCII_36"
        and name.start == dollar.end + 1
        and sql[name.start : name.end + 1] in TIME_MACROS
        and left_paren.name == "ASCII_40"
    ]
    for index in reversed(sigils):
        sql = sql[:index] + sql[index + 1 :]
    return statements(sql)


def relation_names(node, visible_ctes=frozenset()):
    if isinstance(node, list):
        for child in node:
            yield from relation_names(child, visible_ctes)
    if not isinstance(node, dict):
        return
    if "RangeVar" in node:
        relation = node["RangeVar"]
        name = relation["relname"]
        schema = relation.get("schemaname")
        # The Grafana login can also see its own facade schema. None of the
        # migration-316 relation names is defined there on current main.
        if schema or name not in visible_ctes:
            yield schema or "public", name

    # A nonrecursive CTE sees earlier siblings, while a recursive WITH gives
    # all the siblings names throughout the WITH. Inner statements may shadow.
    with_clause = node.get("withClause", {})
    ctes = [entry["CommonTableExpr"] for entry in with_clause.get("ctes", [])]
    query_scope = visible_ctes
    if with_clause.get("recursive"):
        query_scope |= {cte["ctename"] for cte in ctes}
    for cte in ctes:
        yield from relation_names(cte["ctequery"], query_scope)
        query_scope |= {cte["ctename"]}
    for key, child in node.items():
        if key != "withClause":
            yield from relation_names(child, query_scope)


def panels(items):
    for panel in items:
        yield panel
        yield from panels(panel.get("panels", []))


def target_errors(uid, panel_id, target, removed):
    sql = target.get("rawSql")
    if not sql:
        return []
    location = f"{uid}/{panel_id} target {target.get('refId', 'unlabelled')}"
    try:
        references = set(relation_names(parse_panel_sql(sql)))
    except parser.ParseError as error:
        return [f"{location}: SQL failed to parse: {error}"]
    return [
        f"{location} references {schema}.{name} dropped by migration 316"
        for schema, name in sorted(references & removed)
    ]


def dashboard_for(uid):
    filename = (
        "grafana/provisioning/dashboards/json/weather.json"
        if uid == "greenhouse-weather"
        else f"grafana/dashboards/{uid}.json"
    )
    return json.loads((ROOT / filename).read_text())


@pytest.mark.parametrize("inject_dropped_relation", [False, True], ids=["current-source", "dropped-relation"])
def test_shared_catalog_guard(inject_dropped_relation):
    catalog = json.loads((ROOT / "verdify_public/grafana_catalog.json").read_text())
    dashboards = {uid: dashboard_for(uid) for uid in catalog}
    if inject_dropped_relation:
        panel = next(panel for panel in panels(dashboards["site-home"]["panels"]) if panel["id"] == 2)
        target = next(target for target in panel["targets"] if target["refId"] == "A")
        target["rawSql"] = f"{target['rawSql'].strip().rstrip(';')} WHERE EXISTS (SELECT 1 FROM public.twin_decisions)"

    removed = dropped_relations()
    errors = [
        error
        for uid, entry in catalog.items()
        for panel in panels(dashboards[uid]["panels"])
        if panel.get("id") in entry["panels"]
        for target in panel.get("targets", [])
        for error in target_errors(uid, panel["id"], target, removed)
    ]
    expected = (
        ["site-home/2 target A references public.twin_decisions dropped by migration 316"]
        if inject_dropped_relation
        else []
    )
    assert errors == expected, "\n".join(errors)


@pytest.mark.parametrize(
    ("predicate", "reject"),
    [
        ("EXISTS (SELECT 1 FROM public.twin_decisions)", True),
        ("EXISTS (SELECT 1 FROM PUBLIC.TWIN_DECISIONS)", True),
        ('EXISTS (SELECT 1 FROM public."twin_decisions")', True),
        ("EXISTS (SELECT 1 FROM public.setpoint_plan)", False),
        ("EXISTS (SELECT 1 FROM other_schema.twin_decisions)", False),
        ("EXISTS (WITH twin_decisions AS (SELECT 1) SELECT 1 FROM twin_decisions)", False),
        ("EXISTS (WITH twin_decisions AS (SELECT 1) SELECT 1 FROM public.twin_decisions)", True),
        ("EXISTS (WITH twin_decisions AS (SELECT 1 FROM twin_decisions) SELECT 1 FROM twin_decisions)", True),
        ("'public.twin_decisions' IS NOT NULL /* FROM public.twin_decisions /* nested */ */", False),
    ],
)
def test_shared_panel_reports_migration_316_drop(predicate, reject):
    dashboard = dashboard_for("site-home")
    catalog = json.loads((ROOT / "verdify_public/grafana_catalog.json").read_text())
    assert 2 in catalog["site-home"]["panels"]
    panel = next(panel for panel in panels(dashboard["panels"]) if panel["id"] == 2)
    target = next(target for target in panel["targets"] if target["refId"] == "A").copy()
    target["rawSql"] = f"{target['rawSql'].strip().rstrip(';')} WHERE {predicate}"
    assert target_errors("site-home", 2, target, dropped_relations()) == (
        ["site-home/2 target A references public.twin_decisions dropped by migration 316"] if reject else []
    )
