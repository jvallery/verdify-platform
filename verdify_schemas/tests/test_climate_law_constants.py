"""The climate law constants file (plan section 9): generated outputs are current, law sources carry no literal."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from verdify_schemas import climate_law_constants as K

REPO_ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "gen_climate_law", REPO_ROOT / "scripts" / "gen-climate-law-constants.py"
)
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)


def test_generated_outputs_current_and_law_sources_literal_free():
    assert gen.check(gen.load_constants()) == []


def test_python_module_equals_source():
    constants = gen.load_constants()
    for key, c in constants.items():
        assert getattr(K, key.upper()) == c["value"], key
    assert gen.constants_sha256(constants) == K.CONSTANTS_SHA256


def test_derived_band_widths():
    # Section 4.1: the heater's off line at or below the cooling off line, the drying off line at or below the fog off line.
    assert K.BAND_MIN_WIDTH_F == K.HEAT1_OFF_ABOVE_LOW_F + K.COOL_OFF_BELOW_HIGH_F == 6.5
    assert K.BAND_MIN_WIDTH_KPA == 0.35


def test_law_ordering_invariants():
    # The furnace swing sits below the electric heater's line, so the heater stays on through furnace cycles (4.6).
    assert K.HEAT2_ON_ABOVE_LOW_F < K.HEAT2_OFF_ABOVE_LOW_F <= K.HEAT1_ON_ABOVE_LOW_F < K.HEAT1_OFF_ABOVE_LOW_F
    # A drying run stops above the furnace's on line and starts above its stop line (4.5).
    assert K.HEAT2_ON_ABOVE_LOW_F < K.DRY_STOP_ABOVE_LOW_F < K.DRY_START_ABOVE_LOW_F
    assert K.DRY_DEWPOINT_STOP_MARGIN_F < K.DRY_DEWPOINT_START_MARGIN_F
    assert K.MIST_OFF_ABOVE_VPD_HIGH_KPA < K.MIST_ON_ABOVE_VPD_HIGH_KPA
    assert K.DRY_COST_LIMIT_MIN_KWH_PER_KG <= K.DRY_COST_LIMIT_DEFAULT_KWH_PER_KG <= K.DRY_COST_LIMIT_MAX_KWH_PER_KG
    assert K.SAFETY_MIN_F < K.BAND_TEMP_MIN_F < K.BAND_TEMP_MAX_F < K.SAFETY_MAX_F


def test_hash_changes_with_a_value():
    constants = gen.load_constants()
    before = gen.constants_sha256(constants)
    constants["heat1_on_above_low_f"]["value"] = 3.4
    assert gen.constants_sha256(constants) != before


def test_literal_detector():
    src = """
#pragma once
#include "climate_law_constants_generated.h"
// a comment with 3.5 is fine
/* so is 4.5 in a block */
inline bool f(double t, double low) {
  const char* s = "100 F";
  if (t < low + 3.5) return true;
  int n = 2; double z = 0.0; float o = 1.0f;
  return t > 40;
}
"""
    found = gen.literal_violations(src)
    assert [lit for _, lit in found] == ["3.5", "40"]
    assert [line for line, _ in found] == [8, 10]


def test_literal_detector_ignores_identifiers():
    assert gen.literal_violations("double x = HEAT1_ON_ABOVE_LOW_F + k2; uint32_t y = a1b;") == []


# -- Negative tests of the gate itself (#1690 verification, RULINGS P3): a copy of the generator and its inputs
# and outputs in a scratch tree, then `--check` run there as CI runs it.
def _gate_tree(tmp_path: Path) -> Path:
    import shutil

    rels = [
        Path("scripts/gen-climate-law-constants.py"),
        gen.SOURCE.relative_to(REPO_ROOT),
        *(path.relative_to(REPO_ROOT) for path in gen.outputs(gen.load_constants())),
        *(Path(rel) for rel in gen.LAW_SOURCES if (REPO_ROOT / rel).exists()),
    ]
    for rel in rels:
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO_ROOT / rel, tmp_path / rel)
    return tmp_path


def _run_check(tree: Path):
    import subprocess
    import sys

    return subprocess.run(
        [sys.executable, str(tree / "scripts/gen-climate-law-constants.py"), "--check"],
        capture_output=True,
        text=True,
        check=False,
    )


def test_gate_passes_on_an_unchanged_copy(tmp_path):
    result = _run_check(_gate_tree(tmp_path))
    assert result.returncode == 0, result.stderr


def test_gate_fails_on_a_stale_generated_output(tmp_path):
    tree = _gate_tree(tmp_path)
    header = tree / gen.OUT_HEADER.relative_to(REPO_ROOT)
    header.write_text(
        header.read_text().replace("constexpr double SAFETY_MAX_F = 100.0;", "constexpr double SAFETY_MAX_F = 101.0;")
    )
    assert "SAFETY_MAX_F = 101.0" in header.read_text()
    result = _run_check(tree)
    assert result.returncode == 1
    assert "climate_law_constants_generated.h is stale" in result.stderr


def test_gate_fails_on_a_typed_literal_in_the_law(tmp_path):
    tree = _gate_tree(tmp_path)
    law = tree / "firmware/lib/climate_law.h"
    text = law.read_text()
    marker = "inline Output step(State& s, const Inputs& u) noexcept {\n"
    assert text.count(marker) == 1
    law.write_text(text.replace(marker, marker + "    const double typed_limit = 42.5;\n    (void)typed_limit;\n"))
    result = _run_check(tree)
    assert result.returncode == 1
    assert "numeric literal 42.5" in result.stderr
