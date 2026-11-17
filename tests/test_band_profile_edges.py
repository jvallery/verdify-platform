"""The band as edges (API-23 and API-24, spec section 4.1), with no database.

Each low or high series given an edge compiles with midpoint shoulders on the push step, an edge left out keeping
the band's own value, and a series given no edge keeps its anchors; the axis's target series stays when its curve lies
between the new edges' curves all day and otherwise moves to their midpoint at every anchor in the same Save; one axis in both forms is refused; the existing band checks judge the result and name the edge fields; both
states carry their edges and whether each axis is simple in edges; the preview carries the law's switching offsets.
"""

from __future__ import annotations

import asyncio
import importlib
import sys
from datetime import date
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from test_band_profile import LIVE as LIVE_1105
from test_band_profile import NOW, PROFILE, Conn, SaveHarness, save
from test_operator_api_auth import SETTINGS, FakeDb, add_session, signed_in
from test_operator_api_auth import FakePool as SessionPool
from test_verdify_services_series import FakePool

from verdify_schemas import climate_law_constants as K
from verdify_schemas.band_profile import HOUSE_PARAMS, compile_profile, findings, is_simple, snap
from verdify_schemas.band_rows import ANCHOR_KEYS
from verdify_services import band_profile as bp
from verdify_services import series as s
from verdify_services.activity import WriteResult
from verdify_services.problems import ServiceError

ROOT = Path(__file__).resolve().parents[1]
API = str(ROOT / "api")
if API not in sys.path:
    sys.path.append(API)
# A simple band: temperature 73.8-83.8 °F at noon and 60.7-70.7 °F at midnight, VPD 0.86-1.29 and 0.74-1.20 kPa.
SIMPLE = compile_profile(PROFILE)
# The live house anchors of 2026-11-17 (discovery live-db C.5): sunrise and sunset are not the midpoints.
LIVE_SERIES = {
    "temp_low": (62.5, 71.8, 70.0, 60.7),
    "temp_target": (67.5, 78.79, 77.0, 65.7),
    "temp_high": (72.5, 85.8, 84.0, 70.7),
    "vpd_low": (0.755, 0.862, 0.845, 0.738),
    "vpd_target": (0.935, 1.042, 1.025, 0.83),
    "vpd_high": (1.29, 1.39, 1.37, 1.27),
}
LIVE = {
    f"band_{series}_{anchor}": value
    for series, values in LIVE_SERIES.items()
    for anchor, value in zip(ANCHOR_KEYS, values, strict=True)
}


def draft(anchors, overrides=None, **edges):
    return bp.draft_anchors(anchors, bp.BandProfilePatch(**edges), overrides)


def points(anchors, series):
    return tuple(anchors[f"band_{series}_{anchor}"] for anchor in ANCHOR_KEYS)


def refused(anchors, **fields):
    with pytest.raises(ServiceError) as caught:
        draft(anchors, **fields)
    return caught.value.problem


def preview(anchors, patch=None, overrides=None):
    conn = AnchorsConn(anchors)
    return asyncio.run(bp.preview(conn, patch, overrides, date(2026, 11, 5), now=NOW))


class AnchorsConn(Conn):
    """The band profile tests' fake connection, over any anchor set."""

    def __init__(self, anchors):
        super().__init__([index * 4.0 / 144 for index in range(144)])
        self.anchors = anchors

    async def fetch(self, sql, *args):
        if sql == s.ANCHOR_ROWS_SQL:
            return [
                {"series": name.split("_", 1)[1].rsplit("_", 1)[0], "anchor": name.rsplit("_", 1)[1], "season": "all"}
                | {"value": value, "current_season": "fall", "width_below": None, "width_above": None}
                for name, value in self.anchors.items()
            ]
        return await super().fetch(sql, *args)


# ── the edge form ───────────────────────────────────────────────────────────


def test_one_axis_in_edge_form_compiles_its_low_and_high_with_midpoint_shoulders_and_leaves_the_other_axis():
    anchors = draft(SIMPLE, temp_low_day=72.0, temp_high_day=84.0, temp_low_night=62.0, temp_high_night=70.0)
    assert points(anchors, "temp_low") == (67.0, 72.0, 67.0, 62.0)
    assert points(anchors, "temp_high") == (77.0, 84.0, 77.0, 70.0)
    assert all(anchors[name] == SIMPLE[name] for name in HOUSE_PARAMS if "_vpd_" in name)
    assert all(name.startswith("band_temp_") for name in bp.changed_params(SIMPLE, anchors))
    assert findings(anchors) == []


def test_a_vpd_axis_in_edge_form_leaves_temperature_alone():
    anchors = draft(SIMPLE, vpd_low_night=0.8, vpd_high_day=1.4)
    assert points(anchors, "vpd_low") == (0.83, 0.86, 0.83, 0.8)
    assert points(anchors, "vpd_high") == (1.3, 1.4, 1.3, 1.2)
    assert all(anchors[name] == SIMPLE[name] for name in HOUSE_PARAMS if "_temp_" in name)


def test_a_partial_axis_recompiles_only_the_series_given_an_edge():
    # On the live band only the night low moves: the low series gets midpoint shoulders, and the high series keeps
    # its own shoulders (sunrise 72.5, sunset 84.0), which the operator did not ask to change.
    anchors = draft(LIVE, temp_low_night=61.0)
    assert points(anchors, "temp_low") == (66.4, 71.8, 66.4, 61.0)
    assert points(anchors, "temp_high") == (72.5, 85.8, 84.0, 70.7)
    assert all(anchors[name] == LIVE[name] for name in HOUSE_PARAMS if "_vpd_" in name)
    assert bp.changed_params(LIVE, anchors) == ["band_temp_low_sr", "band_temp_low_ss", "band_temp_low_mid"]


@pytest.mark.parametrize(
    ("edges", "kept"),
    [({"temp_high_day": 86.5}, "temp_low"), ({"vpd_high_day": 1.25}, "vpd_low"), ({"vpd_low_night": 0.74}, "vpd_high")],
)
def test_an_edit_to_one_series_leaves_the_other_series_of_its_axis_as_stored(edges, kept):
    anchors = draft(LIVE, **edges)
    assert points(anchors, kept) == points(LIVE, kept)
    assert not any(name.startswith(f"band_{kept}_") for name in bp.changed_params(LIVE, anchors))
    assert errors(LIVE, **edges) == []


def test_every_edge_and_shoulder_is_on_the_push_step():
    anchors = draft(SIMPLE, temp_low_day=72.04, temp_high_night=70.96, vpd_high_night=1.234, vpd_low_day=0.8571)
    assert anchors["band_temp_low_sm"] == 72.0 and anchors["band_temp_high_mid"] == 71.0
    assert anchors["band_vpd_high_mid"] == 1.23 and anchors["band_vpd_low_sm"] == 0.86
    assert anchors["band_temp_low_sr"] == snap((72.0 + 60.7) / 2, "temp")
    assert anchors["band_vpd_high_ss"] == snap((1.29 + 1.23) / 2, "vpd")
    # A kept edge of a recompiled series that sits off the step (the live 0.862) is snapped as well.
    assert draft(LIVE, vpd_low_night=0.74)["band_vpd_low_sm"] == 0.86
    for name in HOUSE_PARAMS:
        axis = "temp" if "_temp_" in name else "vpd"
        if "_target_" not in name:
            assert anchors[name] == snap(anchors[name], axis)


@pytest.mark.parametrize(
    ("fields", "field"),
    [
        ({"temp_day": 78.0, "temp_low_day": 72.0}, "temp_low_day"),
        ({"temp_width_night": 6.0, "temp_high_night": 72.0}, "temp_high_night"),
        ({"vpd_below_night": 0.1, "vpd_high_day": 1.4}, "vpd_high_day"),
    ],
)
def test_one_axis_in_both_forms_is_refused_naming_the_edge_field(fields, field):
    problem = refused(SIMPLE, **fields)
    assert (problem.code, problem.field) == ("invalid_request", field)


def test_each_axis_may_use_its_own_form():
    anchors = draft(SIMPLE, temp_night=66.7, vpd_low_night=0.8)
    assert anchors["band_temp_low_mid"] == 61.7 and anchors["band_vpd_low_mid"] == 0.8


def test_raw_anchor_overrides_still_apply_last():
    anchors = draft(SIMPLE, {"band_temp_low_sr": 64.04}, temp_low_night=62.0)
    assert anchors["band_temp_low_sr"] == 64.0 and anchors["band_temp_low_ss"] == snap((73.8 + 62.0) / 2, "temp")


# ── target rows ─────────────────────────────────────────────────────────────


def test_a_target_still_between_its_new_edges_is_kept():
    anchors = draft(SIMPLE, temp_low_night=63.0, temp_high_night=71.0)
    assert points(anchors, "temp_target") == points(SIMPLE, "temp_target")
    assert not any("_target_" in name for name in bp.changed_params(SIMPLE, anchors))


def test_a_target_outside_its_new_edges_moves_to_their_midpoint_at_every_anchor():
    anchors = draft(SIMPLE, temp_low_night=66.0, temp_high_night=74.0)
    assert anchors["band_temp_target_mid"] == 70.0  # 65.7 fell under the new 66.0
    for anchor in ANCHOR_KEYS:
        low, target, high = (anchors[f"band_temp_{series}_{anchor}"] for series in ("low", "target", "high"))
        assert target == snap((low + high) / 2, "temp")
    assert "band_temp_target_mid" in bp.changed_params(SIMPLE, anchors)
    assert findings(anchors) == []


@pytest.mark.parametrize(
    ("edges", "axis"),
    [
        # The live target's own shoulders (sunset 77.0, noon 78.79) sit inside 66.2-77.0 and 71.8-79.0 at the
        # anchors, but its curve rises above the new high between them.
        ({"temp_low_day": 71.8, "temp_low_night": 60.7, "temp_high_day": 79.0, "temp_high_night": 75.0}, "temp"),
        # The live VPD target's noon 1.042 is just above the new 1.04 low, but its curve falls below it by day.
        ({"vpd_low_day": 1.04, "vpd_high_day": 1.45}, "vpd"),
    ],
)
def test_a_target_inside_its_edges_at_every_anchor_but_outside_between_them_moves(edges, axis):
    anchors = draft(LIVE, **edges)
    target = f"{axis}_target"
    for anchor in ANCHOR_KEYS:
        low, high = (anchors[f"band_{axis}_{side}_{anchor}"] for side in ("low", "high"))
        assert low - 1e-9 <= LIVE[f"band_{target}_{anchor}"] <= high + 1e-9  # inside at the anchor
        assert anchors[f"band_{target}_{anchor}"] == snap((low + high) / 2, axis)
    # Kept as stored, the target would cross an edge on the curve: the order check the write applies.
    kept = dict(anchors, **{f"band_{target}_{anchor}": LIVE[f"band_{target}_{anchor}"] for anchor in ANCHOR_KEYS})
    assert any(item.code == "band_order" for item in findings(kept))
    assert errors(LIVE, **edges) == []
    assert {f"band_{target}_{anchor}" for anchor in ANCHOR_KEYS} <= set(bp.changed_params(LIVE, anchors))
    assert all(anchors[name] == LIVE[name] for name in HOUSE_PARAMS if not name.startswith(f"band_{axis}_"))


def test_a_target_inside_its_new_edges_all_day_keeps_its_own_shoulders():
    anchors = draft(LIVE, temp_high_day=86.0)
    assert points(anchors, "temp_target") == points(LIVE, "temp_target")


def test_a_target_on_an_edge_is_between_it():
    anchors = draft(SIMPLE, vpd_high_night=SIMPLE["band_vpd_target_mid"])
    assert anchors["band_vpd_target_mid"] == SIMPLE["band_vpd_target_mid"]


def test_a_moved_target_is_written_and_audited_in_the_same_save(monkeypatch):
    harness = SaveHarness(monkeypatch)

    async def current(tx):
        return dict(SIMPLE)

    monkeypatch.setattr(bp, "_current_anchors", current)
    result = save(bp.BandProfilePatch(temp_low_night=66.0, temp_high_night=74.0))
    written = [write[0] for write in harness.writes]
    assert "band_temp_target_mid" in written and written == bp.changed_params(
        SIMPLE, draft(SIMPLE, temp_low_night=66.0, temp_high_night=74.0)
    )
    detail = harness.logged["detail"]
    moved = next(change for change in detail["changes"] if change["param"] == "band_temp_target_mid")
    assert moved["before"] == 65.7 and moved["value"] == 70.0
    assert detail["desired_ids"] == [row.id for row in result.value.changed]
    assert detail["edges"]["temp_low_night"] == 66.0 and detail["edges_simple"] == {"temp": True, "vpd": True}
    assert harness.logged["request"]["profile"] == {"temp_low_night": 66.0, "temp_high_night": 74.0}


# ── validation ──────────────────────────────────────────────────────────────


def errors(anchors, **edges):
    patch = bp.BandProfilePatch(**edges)
    drafted = bp.draft_anchors(anchors, patch, None)
    found = [bp.ProfileFinding(**vars(item)) for item in findings(drafted)]
    return [(item.code, item.field) for item in bp._named_for_edges(found, drafted, patch) if item.severity == "error"]


@pytest.mark.parametrize(
    ("edges", "expected"),
    [
        ({"temp_low_night": 44.0}, [("guardrail", "temp_low_night")]),
        ({"temp_high_day": 96.0}, [("guardrail", "temp_high_day")]),
        ({"vpd_high_day": 3.2}, [("guardrail", "vpd_high_day")]),
        ({"vpd_low_night": 0.6}, [("night_floor", "vpd_low_night")]),
    ],
)
def test_an_edge_outside_the_outer_limits_is_found_on_its_edge_field(edges, expected):
    assert errors(SIMPLE, **edges) == expected


def test_a_band_narrower_than_the_law_allows_is_found_on_the_edge_given():
    exact = round(SIMPLE["band_temp_low_mid"] + K.BAND_MIN_WIDTH_F, 1)
    assert errors(SIMPLE, temp_high_night=exact) == [("band_width", "temp_high_night")]
    assert errors(SIMPLE, temp_high_night=exact + 0.1) == []
    assert errors(SIMPLE, vpd_low_day=round(SIMPLE["band_vpd_high_sm"] - 0.3, 2)) == [("band_width", "vpd_low_day")]


def test_a_low_edge_over_its_high_edge_is_refused():
    found = errors(SIMPLE, temp_low_day=85.0)
    assert ("band_width", "temp_low_day") in found and found[0] == ("band_order", "temp_low_day")


def test_a_high_edge_given_alone_against_a_low_series_with_its_own_shoulders_is_judged_on_the_curve():
    # The live low keeps its sunset 70.0 while the high's sunset drops to the midpoint 77.0: the curve narrows below
    # the law's minimum between the anchors, and the finding names the edge given.
    assert errors(LIVE, temp_high_day=79.0, temp_high_night=75.0) == [("band_width", "temp_high_day")]


@pytest.mark.parametrize(
    ("series", "values", "field"),
    [
        # The VPD target falls below a raised low by day: the low edge, by day.
        ("vpd_low", (0.89, 1.04, 0.89, 0.74), "vpd_low_day"),
        # The temperature target rises above a lowered high by day: the high edge, by day.
        ("temp_high", (77.0, 79.0, 77.0, 75.0), "temp_high_day"),
        # The temperature target falls below a raised night low: the low edge, at night.
        ("temp_low", (68.0, 71.8, 68.0, 66.0), "temp_low_night"),
    ],
)
def test_an_order_finding_names_the_edge_the_target_crossed(series, values, field):
    anchors = dict(
        LIVE, **{f"band_{series}_{anchor}": value for anchor, value in zip(ANCHOR_KEYS, values, strict=True)}
    )
    order = [item for item in findings(anchors) if item.code == "band_order"]
    assert len(order) == 1
    given = {f"{series.split('_')[0]}_low_day", f"{series.split('_')[0]}_high_day"}  # both given: no tie-break
    assert bp.edge_field(order[0], anchors, given) == field


@pytest.mark.parametrize(
    ("edges", "field"),
    [({"temp_low_night": 44.0}, "temp_low_night"), ({"temp_high_night": 66.0}, "temp_high_night")],
)
def test_a_save_that_breaks_a_rule_is_refused_on_the_edge_field_and_writes_nothing(monkeypatch, edges, field):
    harness = SaveHarness(monkeypatch)

    async def current(tx):
        return dict(SIMPLE)

    monkeypatch.setattr(bp, "_current_anchors", current)
    with pytest.raises(ServiceError) as caught:
        save(bp.BandProfilePatch(**edges))
    assert (caught.value.problem.code, caught.value.problem.field) == ("out_of_range", field)
    assert harness.writes == []


def test_a_save_in_both_forms_is_refused_before_any_write(monkeypatch):
    harness = SaveHarness(monkeypatch)
    with pytest.raises(ServiceError) as caught:
        save(bp.BandProfilePatch(temp_night=66.0, temp_low_night=61.0))
    assert (caught.value.problem.code, caught.value.problem.field) == ("invalid_request", "temp_low_night")
    assert harness.writes == []


# ── edges and edges_simple ──────────────────────────────────────────────────


def test_a_simple_band_reads_as_its_edges_and_is_simple_on_both_axes():
    state = bp.state_of(SIMPLE)
    assert state.edges.model_dump() == {
        "temp_low_day": 73.8,
        "temp_high_day": 83.8,
        "temp_low_night": 60.7,
        "temp_high_night": 70.7,
        "vpd_low_day": 0.86,
        "vpd_high_day": 1.29,
        "vpd_low_night": 0.74,
        "vpd_high_night": 1.2,
    }
    assert state.edges_simple.model_dump() == {"temp": True, "vpd": True}
    assert state.simple and state.profile == bp.decompose(SIMPLE)


def test_a_band_with_its_own_shoulders_is_not_simple_in_edges_on_that_axis():
    anchors = dict(SIMPLE, band_vpd_high_sr=1.3)
    assert bp.edges_simple(anchors).model_dump() == {"temp": True, "vpd": False}
    assert bp.edges_simple(LIVE_1105).model_dump() == {"temp": False, "vpd": False}
    # Off by less than half a step still reads as the midpoint, as is_simple compares.
    assert bp.edges_simple(dict(SIMPLE, band_temp_low_sr=SIMPLE["band_temp_low_sr"] + 0.04)).temp


def test_a_target_off_its_midpoint_does_not_make_the_edges_unsimple():
    anchors = dict(SIMPLE, band_temp_target_mid=62.0)
    assert bp.edges_simple(anchors).temp and not is_simple(anchors)


def test_the_live_band_reads_as_its_edges_and_is_not_simple_in_edges():
    state = bp.state_of(LIVE)
    assert state.edges.model_dump() == {
        "temp_low_day": 71.8,
        "temp_high_day": 85.8,
        "temp_low_night": 60.7,
        "temp_high_night": 70.7,
        "vpd_low_day": 0.862,
        "vpd_high_day": 1.39,
        "vpd_low_night": 0.738,
        "vpd_high_night": 1.27,
    }
    assert state.edges_simple.model_dump() == {"temp": False, "vpd": False}
    # Saving the live band's own edges makes it simple in edges and moves only shoulders.
    drafted = draft(LIVE, **state.edges.model_dump())
    assert bp.edges_simple(drafted).model_dump() == {"temp": True, "vpd": True}
    assert all(name.endswith(("_sr", "_ss")) for name in bp.changed_params(LIVE, drafted))


@pytest.mark.parametrize("anchors", [SIMPLE, compile_profile(PROFILE.model_copy(update={"temp_width_night": 4.5}))])
def test_a_draft_built_from_a_simple_band_s_own_edges_is_that_band(anchors):
    edges = bp.state_of(anchors).edges.model_dump()
    drafted = draft(anchors, **edges)
    assert drafted == anchors
    assert bp.changed_params(anchors, drafted) == []


# ── API-23 ──────────────────────────────────────────────────────────────────


def test_the_preview_serves_edges_in_both_states_and_the_law_lines_from_the_constants():
    answer = preview(SIMPLE, bp.BandProfilePatch(temp_low_night=62.0))
    assert answer.current.edges.temp_low_night == 60.7 and answer.draft.edges.temp_low_night == 62.0
    assert answer.current.edges_simple.temp and answer.draft.edges_simple.temp
    assert answer.changed == ["band_temp_low_sr", "band_temp_low_ss", "band_temp_low_mid"]
    assert answer.law_lines.model_dump() == {
        "heat1_on_above_low_f": K.HEAT1_ON_ABOVE_LOW_F,
        "heat2_on_above_low_f": K.HEAT2_ON_ABOVE_LOW_F,
        "cool_on_above_high_f": K.COOL_ON_ABOVE_HIGH_F,
        "fan2_on_above_high_f": K.FAN2_ON_ABOVE_HIGH_F,
        "dry_on_above_vpd_low_kpa": K.DRY_ON_ABOVE_VPD_LOW_KPA,
        "fog_on_above_vpd_high_kpa": K.FOG_ON_ABOVE_VPD_HIGH_KPA,
        "mist_on_above_vpd_high_kpa": K.MIST_ON_ABOVE_VPD_HIGH_KPA,
    }
    dumped = answer.model_dump(mode="json")
    assert set(dumped["current"]) == {"profile", "anchors", "simple", "edges", "edges_simple"}


def test_the_preview_names_an_edge_form_finding_by_its_edge_and_a_profile_form_finding_as_before():
    edge = preview(SIMPLE, bp.BandProfilePatch(temp_low_night=44.0))
    assert [(item.code, item.field) for item in edge.findings if item.severity == "error"] == [
        ("guardrail", "temp_low_night")
    ]
    profile = preview(SIMPLE, bp.BandProfilePatch(temp_width_night=21.0))
    assert ("guardrail", "temp_width_night") in [(item.code, item.field) for item in profile.findings]


def test_the_preview_refuses_both_forms_on_one_axis():
    with pytest.raises(ServiceError) as caught:
        preview(SIMPLE, bp.BandProfilePatch(vpd_night=0.9, vpd_low_night=0.8))
    assert (caught.value.problem.code, caught.value.problem.field) == ("invalid_request", "vpd_low_night")


def series_client(conn) -> TestClient:
    app = FastAPI()
    app.include_router(importlib.import_module("operator_routes.series").router, prefix="/v1")
    app.state.pool = FakePool(conn)

    @app.exception_handler(ServiceError)
    async def _problem(request, exc):
        return JSONResponse(exc.problem.model_dump(mode="json", exclude_none=True), status_code=exc.problem.status)

    return TestClient(app)


def test_the_api_23_route_passes_the_eight_edges_to_the_draft():
    query = {
        "day": "2026-11-05",
        "temp_low_day": 72.0,
        "temp_high_day": 84.0,
        "temp_low_night": 62.0,
        "temp_high_night": 72.0,
        "vpd_low_day": 0.9,
        "vpd_high_day": 1.3,
        "vpd_low_night": 0.8,
        "vpd_high_night": 1.2,
    }
    response = series_client(AnchorsConn(SIMPLE)).get("/v1/band/profile", params=query)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["draft"]["edges"] == {name: value for name, value in query.items() if name != "day"}
    assert body["draft"]["edges_simple"] == {"temp": True, "vpd": True}
    assert body["law_lines"]["mist_on_above_vpd_high_kpa"] == K.MIST_ON_ABOVE_VPD_HIGH_KPA


def test_the_api_23_route_refuses_both_forms_on_one_axis():
    response = series_client(AnchorsConn(SIMPLE)).get(
        "/v1/band/profile", params={"temp_day": 78.0, "temp_high_day": 84.0}
    )
    assert response.status_code == 400
    assert (response.json()["code"], response.json()["field"]) == ("invalid_request", "temp_high_day")


# ── API-24's body ───────────────────────────────────────────────────────────


def test_the_api_24_body_takes_the_edges_beside_the_profile_fields_and_nothing_else():
    writes = importlib.import_module("operator_routes.writes")
    body = writes.BandSave.model_validate({"profile": {"temp_low_night": 62.0, "vpd_day": 1.0}, "reason": "Warmer"})
    assert body.profile.model_dump(exclude_none=True) == {"temp_low_night": 62.0, "vpd_day": 1.0}
    with pytest.raises(ValueError):
        writes.BandSave.model_validate({"profile": {"temp_low_noon": 62.0}})
    with pytest.raises(ValueError):
        writes.BandSave.model_validate({"profile": {"temp_low_night": float("nan")}})


def test_the_api_24_route_passes_the_edges_to_the_band_write(monkeypatch):
    operator_api = importlib.import_module("operator_api")
    calls = []

    async def write(conn, actor, patch, overrides, manual, reason, key):
        calls.append((patch.model_dump(exclude_none=True), overrides, manual, reason))
        return WriteResult(value=bp.BandWrite(changed=[]), replayed=False)

    monkeypatch.setattr(bp, "write", write)
    db = FakeDb()
    headers = signed_in(add_session(db, role="operator", username="jason"))
    body = {"profile": {"temp_low_night": 62.0, "temp_high_night": 72.0}, "reason": "Warmer nights"}
    with TestClient(operator_api.create_app(settings=SETTINGS, pool=SessionPool(db))) as client:
        response = client.put("/v1/band/profile", headers=headers, json=body)
        assert response.status_code == 200, response.text
        assert calls == [({"temp_low_night": 62.0, "temp_high_night": 72.0}, {}, True, "Warmer nights")]
        unknown = client.put("/v1/band/profile", headers=headers, json={"profile": {"temp_low_noon": 62.0}})
        assert unknown.status_code == 400 and len(calls) == 1
