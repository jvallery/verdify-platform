"""Keep the SEN0604 wire settings, published entities and storage bindings aligned."""

import hashlib
import json

import pytest
from test_par_meter import ROOT, SENSORS, _controllers, _sensor

from verdify_schemas.telemetry import ClimateRow
from verdify_services.series import METRICS


@pytest.mark.parametrize(
    ("controller", "address", "prefixes", "zone"),
    [
        ("south_wall_soil_probe", "7", ("south_1", "south_wall"), "south_1"),
        ("west_soil_probe", "9", ("west", "west_wall"), "west"),
    ],
)
def test_wall_probe_registers_have_end_to_end_bindings(controller, address, prefixes, zone):
    from entity_map import CLIMATE_MAP

    soil_probes = [probe for probe in _controllers() if "soil_probe" in probe["id"]]
    assert {probe["address"] for probe in soil_probes} == {"7", "9"}
    assert (probe := next(probe for probe in soil_probes if probe["id"] == controller))["address"] == address
    assert probe["modbus_id"] == "modbus_main"
    assert SENSORS.count(f"modbus_controller_id: {controller}\n") == 6
    for field, register, measurement_prefix, scale in (
        ("moisture", 0, prefixes[0], True),
        ("temp", 1, prefixes[0], False),
        ("ec", 2, prefixes[0] if zone == "south_1" else prefixes[1], False),
        ("ph", 3, prefixes[1], True),
        ("salinity", 7, prefixes[1], False),
        ("tds", 8, prefixes[1], False),
    ):
        entity_id = f"{measurement_prefix}_soil_{field}"
        config = _sensor(entity_id)
        assert f"modbus_controller_id: {controller}" in config
        assert f"address: 0x{register:04X}" in config
        assert "register_type: holding" in config
        assert "- timeout: 300s" in config
        assert ("- multiply: 0.1" in config) == scale
        assert f"value_type: {'S_WORD' if field == 'temp' else 'U_WORD'}" in config
        name = config.split('name: "', 1)[1].split('"', 1)[0]
        object_id = "".join(c if c in "abcdefghijklmnopqrstuvwxyz0123456789_" else "_" for c in name.lower())
        column = f"soil_{field}_{zone}"
        assert CLIMATE_MAP[object_id] == column
        assert column in ClimateRow.model_fields
        assert METRICS[f"climate.{column}"].raw.column == column


def test_native_qualification_is_bound_to_exact_migration():
    migration = ROOT / "db/migrations/322-sen0604-wall-soil-telemetry.sql"
    receipt = json.loads(
        (ROOT / "tests/fixtures/322-sen0604-wall-soil-telemetry-native-qualification.json").read_text()
    )
    assert receipt["exact_final_migration_sha256"] == hashlib.sha256(migration.read_bytes()).hexdigest()
    assert receipt["native_fixture"]["all_passed"]
    assert receipt["final_migration_rollback_verified"]
    assert receipt["before"] == receipt["after_rollback"]
