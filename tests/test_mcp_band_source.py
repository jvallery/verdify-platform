"""RULINGS AF2(b): MCP's get_setpoints takes the band from fn_band_setpoints, never from the settings ledger."""

import ast
from pathlib import Path

SOURCE = (Path(__file__).resolve().parents[1] / "mcp" / "server.py").read_text()


def _function(name):
    tree = ast.parse(SOURCE)
    node = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == name)
    return ast.get_source_segment(SOURCE, node)


def test_get_setpoints_reads_the_band_from_fn_band_setpoints_and_drops_the_ledger_band_rows():
    body = _function("get_setpoints")
    assert "FROM fn_band_setpoints(now())" in body
    assert "WHERE parameter <> ALL($2::text[])" in body
    assert "list(_SERVED_BAND_PARAMETERS)" in body
