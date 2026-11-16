"""The observation spool's payload keys equal what fn_record_observational_source_event admits, kind by kind.

The spool (VERDIFY_OBSERVATION_SPOOL_ENABLED, on in production) drains FIFO and acknowledges a row only after the
function accepts it, and the function refuses any key outside its pinned list for the kind. One unknown key, NULL
included, therefore stops every spooled observation (DISPATCHER-01). No database: the allowed lists are read from the
newest migration that defines the function, the payloads from the ingestor's source and the Diagnostics model.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from verdify_schemas.telemetry import Diagnostics

ROOT = Path(__file__).resolve().parents[1]
DEFINITION = "FUNCTION public.fn_record_observational_source_event("
DIAGNOSTICS_EXCLUDED = {"ts", "greenhouse_id"}  # ingestor.py: diag.model_dump(mode="json", exclude=...)


def newest_definition() -> tuple[str, str]:
    files = sorted(
        (path for path in (ROOT / "db/migrations").glob("*.sql") if DEFINITION in path.read_text()),
        key=lambda path: int(path.name.split("-", 1)[0]),
    )
    text = files[-1].read_text()
    start = text.index(DEFINITION)
    return files[-1].name, text[start : text.index("$body$;", start)]


def allowed_by_kind() -> dict[str, set[str]]:
    _, body = newest_definition()
    kinds = re.findall(r"WHEN '([a-z0-9_]+)' THEN target_table:=.*?allowed:=ARRAY\[(.*?)\]", body, re.S)
    return {kind: set(re.findall(r"'([a-z0-9_]+)'", items)) for kind, items in kinds}


def spooled_literal_keys() -> dict[str, set[str]]:
    """Keys of every ("kind", {...}) payload literal in ingestor/ingestor.py."""
    tree = ast.parse((ROOT / "ingestor/ingestor.py").read_text())
    found: dict[str, set[str]] = {}
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Tuple)
            and len(node.elts) == 2
            and isinstance(node.elts[0], ast.Constant)
            and isinstance(node.elts[0].value, str)
            and isinstance(node.elts[1], ast.Dict)
            and all(isinstance(key, ast.Constant) for key in node.elts[1].keys)
        ):
            found.setdefault(node.elts[0].value, set()).update(key.value for key in node.elts[1].keys)
    return found


def test_the_newest_definition_admits_the_five_kinds():
    assert set(allowed_by_kind()) == {"system_state", "override", "setpoint_observed", "esp32_log", "diagnostics"}


def test_diagnostics_spools_exactly_the_admitted_keys():
    """Every Diagnostics field is dumped, NULL included, so the model and the list must be equal."""
    assert set(Diagnostics.model_fields) - DIAGNOSTICS_EXCLUDED == allowed_by_kind()["diagnostics"]
    source = (ROOT / "ingestor/ingestor.py").read_text()
    assert 'diag.model_dump(mode="json", exclude={"ts", "greenhouse_id"})' in source


def test_every_hand_built_payload_spools_exactly_the_admitted_keys():
    allowed = allowed_by_kind()
    literals = spooled_literal_keys()
    for kind in ("system_state", "override", "setpoint_observed", "esp32_log"):
        assert literals.get(kind) == allowed[kind], kind
