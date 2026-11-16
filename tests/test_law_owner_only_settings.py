"""Climate refactor package 1.5b: the drying cost limit, and the rule that only the owner writes it and the band.

The registry row takes its default, range and step from the constants module; the dispatcher sends it only to a
controller that lists its entity; and verdify_services.settings refuses a write or release of it, or of any band row,
from every actor but a signed-in dashboard operator (``forbidden``), which covers API-10/11, MCP set_setting and the
band editor's API-24. MCP set_tunable's refusal is in tests/test_mcp_settings_tools.py. No database.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from test_verdify_services_settings import AGENT, IRIS, PERSON, FakeDB, refusal, release, run, write

from verdify_schemas import climate_law_constants as K
from verdify_schemas.setting_help import setting_help
from verdify_schemas.tunable_registry import (
    DRY_COST_LIMIT_OBJECT_ID,
    DRY_COST_LIMIT_PARAM,
    DRY_COST_LIMIT_READBACK_ID,
    OWNER_ONLY_PARAMS,
    PLANNER_PUSHABLE_REG,
    REGISTRY,
    desired_write_rule,
)
from verdify_services import settings
from verdify_services.actor import Actor
from verdify_services.problems import ServiceError

ROOT = Path(__file__).resolve().parents[1]
LIMIT = DRY_COST_LIMIT_PARAM
NOT_OWNERS = [AGENT, IRIS, Actor.agent("admin"), Actor.system("planner_study"), Actor.person("caretaker", "viewer")]


def test_the_row_takes_its_numbers_from_the_constants_module():
    spec = REGISTRY[LIMIT]
    assert (spec.default, spec.min, spec.max, spec.step) == (
        K.DRY_COST_LIMIT_DEFAULT_KWH_PER_KG,
        K.DRY_COST_LIMIT_MIN_KWH_PER_KG,
        K.DRY_COST_LIMIT_MAX_KWH_PER_KG,
        K.DRY_COST_LIMIT_STEP_KWH_PER_KG,
    )
    assert (spec.default, spec.min, spec.max) == (0.7, 0.0, 1.5)
    assert (spec.label, spec.unit, spec.control_class) == ("Drying Cost Limit", "kWh/kg", "controller_safety")
    assert (spec.esp_object_id, spec.cfg_readback_object_id) == (
        "dry_cost_limit_kwh_per_kg",
        "cfg_dry_cost_limit_kwh_per_kg",
    )  # the phase 3 build's names
    assert desired_write_rule(LIMIT) == (True, None)
    assert setting_help(LIMIT) is not None


def test_the_owner_only_set_is_the_limit_and_every_band_row_and_none_is_planner_pushable():
    band = {name for name, spec in REGISTRY.items() if spec.control_class == "crop_band"}
    assert {"band_temp_low_sr", "band_vpd_low_mid", "zone_vpd_width_below_center"} <= band
    assert OWNER_ONLY_PARAMS == band | {LIMIT}
    assert not OWNER_ONLY_PARAMS & PLANNER_PUSHABLE_REG


def test_the_owner_writes_the_limit_on_its_step():
    db = FakeDB()
    stored = write(db, PERSON, LIMIT, 0.83, True).value
    assert (stored.param, stored.value, stored.manual) == (LIMIT, 0.85, True)
    assert db.activity[-1]["action"] == "setting.write"


@pytest.mark.parametrize("value", [-0.05, 1.55])
def test_the_limit_outside_its_range_is_refused(value):
    with pytest.raises(ServiceError) as excinfo:
        write(FakeDB(), PERSON, LIMIT, value, False)
    problem = refusal(excinfo)
    assert (problem.code, problem.min, problem.max) == ("out_of_range", 0.0, 1.5)


@pytest.mark.parametrize("actor", NOT_OWNERS, ids=lambda actor: f"{actor.source}:{actor.name}")
def test_anyone_but_the_owner_is_refused_and_nothing_is_stored(actor):
    db = FakeDB()
    house = db.add_anchor("house", "temp_low", "sr", "all", 62.5)
    for param, value in ((LIMIT, 0.5), ("band_temp_low_sr", 63.0)):
        with pytest.raises(ServiceError) as excinfo:
            write(db, actor, param, value, False)
        problem = refusal(excinfo)
        # A viewer is refused before this rule, by the role check, with the same code.
        assert (problem.code, problem.status) == ("forbidden", 403)
        with pytest.raises(ServiceError) as excinfo:
            release(db, actor, param)
        assert refusal(excinfo).code == "forbidden"
    assert house["value"] == 62.5
    assert db.activity == [] and not [row for row in db.desired if row["param"] in (LIMIT, "band_temp_low_sr")]


def test_an_agent_still_writes_a_setting_that_is_not_owner_only():
    db = FakeDB()
    assert write(db, AGENT, "mister_engage_kpa", 1.5, False).value.value == 1.5


def test_the_owner_releases_the_limit():
    db = FakeDB()
    write(db, PERSON, LIMIT, 0.5, True)
    assert release(db, PERSON, LIMIT).value.state == "released"


def test_the_preview_check_refuses_an_agent_too():
    with pytest.raises(ServiceError) as excinfo:
        run(settings.validate(FakeDB(), AGENT, LIMIT, 0.5))
    assert refusal(excinfo).code == "forbidden"


# ── the dispatcher sends it only to a controller that lists its entity ──────


@pytest.fixture(scope="module")
def dispatcher():
    for key, value in {
        "DB_USER": "t",
        "DB_PASSWORD": "t",
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_NAME": "t",
    }.items():
        os.environ.setdefault(key, value)
    sys.path.insert(0, str(ROOT / "ingestor"))
    from tasks import dispatcher as module

    return module


def skip(dispatcher, param, **flags):
    return dispatcher._desired_skip_reason(
        param, lighting_circuit=True, lighting_target_minutes=True, direct_wet=True, ai_moisture_stress=True, **flags
    )


def test_the_limit_is_not_sent_until_the_controller_lists_its_entity(dispatcher, monkeypatch):
    assert skip(dispatcher, LIMIT) == "firmware has no drying cost limit"
    assert skip(dispatcher, LIMIT, dry_cost_limit=False) == "firmware has no drying cost limit"
    assert skip(dispatcher, LIMIT, dry_cost_limit=True) is None
    assert skip(dispatcher, "mister_engage_kpa") is None
    monkeypatch.setitem(dispatcher.shared.esp32, "keys", {"mister_engage_kpa": 7})
    assert dispatcher._dry_cost_limit_supported() is False
    monkeypatch.setitem(dispatcher.shared.esp32, "keys", {DRY_COST_LIMIT_OBJECT_ID: 9})
    assert dispatcher._dry_cost_limit_supported() is False
    monkeypatch.setitem(dispatcher.shared.esp32, "keys", {DRY_COST_LIMIT_OBJECT_ID: 9, DRY_COST_LIMIT_READBACK_ID: 10})
    assert dispatcher._dry_cost_limit_supported() is True
    monkeypatch.setitem(dispatcher.shared.esp32, "keys", None)
    assert dispatcher._dry_cost_limit_supported() is False


def test_its_route_and_readback_are_in_the_entity_map(dispatcher):
    import entity_map

    assert entity_map.PARAM_TO_ENTITY[LIMIT] == DRY_COST_LIMIT_OBJECT_ID
    assert entity_map.CFG_READBACK_MAP[REGISTRY[LIMIT].cfg_readback_object_id] == LIMIT


def test_the_readback_confirms_the_binary32_value_and_not_the_next_step():
    import struct

    from verdify_schemas.setting_values import readback_matches

    reported = struct.unpack("f", struct.pack("f", 0.7))[0]
    assert readback_matches(LIMIT, reported, 0.7)
    assert not readback_matches(LIMIT, 0.75, 0.7)
