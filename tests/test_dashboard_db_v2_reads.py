"""Release A's dashboard reads as the dashboard login, on a private database.

jvallery/agents#5994's campaign step runs each tests/test_dashboard_db_*.py file against a fresh loopback PostgreSQL with
TimescaleDB and hands it over in VERDIFY_ISOLATED_TEST_DSN; without one this file skips. test_dashboard_db_284's
``install`` builds the database, adds the diagnostics columns of 314 and 315 and runs migration 284's body. As the
owner, this file then adds what the new reads name, each from its own migration: daily_band_compliance (290, 305 and
311), daily_record and daily_relay_record (310 and 317), planner_review (313), the energy meter columns and
v_dashboard_energy with 312's grants (248 and 312), v_daily_scorecard with 285's grant (311), the gap ledger (314),
migration 320's three projections, and v_relay_counter_reconciliation_daily with 315's grant (317). A grant one of
these reads needs and production lacks fails here.

Each test seeds its rows inside one transaction, placed relative to that transaction's now() and shaped like the live
rows (the law's state record, the drying meter, the relay counters, the ingestor counters, a reviewer's token use),
reads as ``verdify_dashboard_runtime_login`` and rolls back. Covered: the law now and its history (API-30, API-31), the
daily record and the relay counter check (API-32, API-33), the reviews (API-34), the controller's health, data
continuity and delivery (API-35 to API-37), Now's law, review, outdoor source and controller fields (API-02), the new
diagnostics and energy series keys (API-04) and each setting's effect (API-09).
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

import irrigation_db_support as support
import pytest
from test_dashboard_db_284 import DSN, LOGIN, connect, install, run
from test_dashboard_db_projections_320 import body_320, table

from verdify_schemas import climate_law_constants as C
from verdify_schemas.setting_help import setting_label
from verdify_services import law, reads, record, reviews, series, settings, system_health

pytestmark = pytest.mark.skipif(DSN is None, reason="needs VERDIFY_ISOLATED_TEST_DSN (campaign private PostgreSQL)")

MIGRATIONS = support.REPO_ROOT / "db" / "migrations"
RECORD_MIGRATION = "317-served-band-readers-and-relay-record.sql"
DENVER = reads.DENVER
# The live record's band (temp low, temp high in F, VPD low, VPD high in kPa).
BAND = (67.4, 79.4, 0.81, 1.34)
ANCHORS = {
    "temp_low": 67.4,
    "temp_target": 73.4,
    "temp_high": 79.4,
    "vpd_low": 0.81,
    "vpd_target": 1.0,
    "vpd_high": 1.34,
}
FIRMWARE = "2026.11.17.0609.8c5cd3bf"
COUNTERS = json.dumps({"v": 1, "rc": 3, "pr": 1, "rj": {"climate": 2}, "fw": FIRMWARE, "gr": 0})
METER = json.dumps({"v": 1, "s": 120, "g": 247, "wh": 177, "rw": 22440})
EARLY_COUNTERS = json.dumps({"v": 1, "h1": 20, "h2": 20, "f1": 3, "f2": 3, "fg": 5, "vt": 8, "f1s": 1000, "f2s": 900})
LATE_COUNTERS = json.dumps({"v": 1, "h1": 25, "h2": 23, "f1": 5, "f2": 5, "fg": 6, "vt": 10, "f1s": 1500, "f2s": 1500})
CLEARED = (
    "climate",
    "diagnostics",
    "system_state",
    "equipment_state",
    "alert_log",
    "setpoint_changes",
    "activity_log",
    "energy",
    "data_gaps",
)


def law_record(latches: int, requests: int, refused: str, cost: float | None, repaired: int) -> str:
    return json.dumps(
        {"v": 1, "l": latches, "o": requests, "dr": refused, "e": cost, "lim": 0.7, "br": repaired, "b": list(BAND)}
    )


# Now: heat1 latched and requested, the outdoor air drier (latches h1 and air), the live record's cost. Earlier:
# drying wanted (the dry latch) and refused as too cold, with no price, on a band the controller repaired.
NOW_RECORD = law_record(1 | 1 << 7, 1, "none", 0.633, 0)
EARLIER_RECORD = law_record(1 << 6, 0, "too_cold", None, 1)


# ── The owner's objects ─────────────────────────────────────────────────────


def _text(name: str) -> str:
    return (MIGRATIONS / name).read_text()


def _alters(name: str, relation: str) -> list[str]:
    found = re.findall(rf"^ALTER TABLE public\.{relation}\b.*?;", _text(name), re.M | re.S)
    assert found, (name, relation)
    return found


def _quoted(name: str, tag: str) -> str:
    """One statement 317 carries as a dollar-quoted text and runs after its checks."""
    match = re.search(rf"\${tag}\$\n(.*?)\n\${tag}\$", _text(name), re.S)
    assert match, (name, tag)
    return match.group(1) + ";"


def _scorecard_view() -> str:
    text = _text("311-one-compliance-definition.sql")
    start = text.index("CREATE OR REPLACE VIEW public.v_daily_scorecard AS")
    end = "LEFT JOIN public.daily_band_compliance b ON b.date = d.date;"
    return text[start : text.index(end, start) + len(end)]


def _grant(name: str, relation: str) -> str:
    (line,) = re.findall(rf"^GRANT SELECT ON public\.{relation} TO [^;]*;", _text(name), re.M)
    return line


def owner_sql() -> str:
    return "\n".join(
        (
            table("290-band-compliance.sql", "daily_band_compliance"),
            *_alters("305-band-nightly-dryout.sql", "daily_band_compliance"),
            *_alters("311-one-compliance-definition.sql", "daily_band_compliance"),
            table("310-daily-record.sql", "daily_record"),
            _quoted(RECORD_MIGRATION, "record"),
            table("310-daily-record.sql", "daily_relay_record"),
            table("313-planner-review.sql", "planner_review"),
            support.energy_view_sql(),
            _scorecard_view(),
            _grant("285-daily-scorecard-view.sql", "v_daily_scorecard"),
            support.gap_ledger_sql(),
            body_320(),
            _quoted(RECORD_MIGRATION, "recon"),
            _grant("315-replayed-gaps-counter-check-and-health.sql", "v_relay_counter_reconciliation_daily"),
        )
    )


async def _build() -> None:
    await install()
    conn = await connect()
    try:
        await conn.execute("SET ROLE verdify")
        try:
            await conn.execute("SET search_path = pg_catalog, public, pg_temp;\n" + owner_sql())
            await conn.execute("RESET search_path")
        finally:
            await conn.execute("RESET ROLE")
    finally:
        await conn.close()


@pytest.fixture(scope="module")
def built() -> None:
    run(_build())


# ── The rows ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class World:
    at: datetime  # the transaction's now()

    @property
    def today(self) -> date:
        return self.at.astimezone(DENVER).date()

    @property
    def yesterday(self) -> date:
        return self.today - timedelta(days=1)

    def ago(self, **delta: float) -> datetime:
        return self.at - timedelta(**delta)

    @property
    def bucket(self) -> datetime:
        """A minute bucket about five minutes back: the series rows sit in it."""
        start = self.ago(minutes=5)
        return start.replace(second=0, microsecond=0)


def local(day: date, hour: int) -> datetime:
    return datetime.combine(day, time(hour), tzinfo=DENVER)


async def _state(conn, rows) -> None:
    await conn.executemany("INSERT INTO public.system_state (ts, entity, value) VALUES ($1, $2, $3)", rows)


async def _seed(conn, w: World) -> dict[str, int]:
    for name in CLEARED:
        await conn.execute(f"DELETE FROM public.{name}")
    await conn.execute(
        """UPDATE public.crop_band_anchors SET value = ($1::jsonb ->> series)::float8
            WHERE crop_type = 'house' AND greenhouse_id = 'vallery'""",
        json.dumps(ANCHORS),
    )

    # The law's records: the earlier key each minute from 60 to 31 minutes back, then the newer one to 30 s back.
    rows = [(w.ago(minutes=minute), "climate_law_state", EARLIER_RECORD) for minute in range(60, 30, -1)]
    rows += [(w.ago(minutes=minute), "climate_law_state", NOW_RECORD) for minute in range(30, 0, -1)]
    rows += [(w.ago(seconds=30), "climate_law_state", NOW_RECORD)]
    rows += [(w.ago(minutes=minute), "outdoor_source", "intake") for minute in (50, 45)]
    rows += [(w.ago(minutes=minute), "outdoor_source", "station") for minute in (40, 30, 20, 10)]
    rows += [
        (w.ago(seconds=30), "outdoor_source", "station"),
        (w.ago(seconds=10), "ingestor_heartbeat", "alive"),
        (w.ago(seconds=30), "climate_drying_meter", METER),
        (w.ago(seconds=30), "climate_law_constants", C.CONSTANTS_SHA256),
        (w.ago(seconds=30), "lead_fan", "Fan 1"),
        (w.ago(seconds=30), "ingestor_counters", COUNTERS),
        (w.ago(minutes=1), "setpoint_snapshot_pass", "stored=2 of=102"),
        (w.ago(minutes=1), "dispatcher_stage", "ordinary"),
    ]
    # Two relay counter samples of today, the second the live one (both after local midnight).
    midnight = local(w.today, 0)
    rows += [
        (max(w.ago(minutes=2), midnight), "relay_counters", EARLY_COUNTERS),
        (max(w.ago(minutes=1), midnight + timedelta(seconds=1)), "relay_counters", LATE_COUNTERS),
    ]
    await _state(conn, rows)

    await conn.execute(
        """INSERT INTO public.climate (ts, greenhouse_id, temp_avg, temp_control, vpd_avg, vpd_control, rh_avg,
                                      dew_point, outdoor_temp_f, outdoor_rh_pct, temp_intake, intake_rh, temp_north)
           VALUES ($1, 'vallery', 66, 66, 0.9, 0.9, 70, 55, 40, 30, 45, 35, 66)""",
        w.ago(seconds=20),
    )
    await conn.execute(
        """INSERT INTO public.diagnostics (ts, heap_bytes, heap_min_free_kb, heap_largest_free_block_kb, wifi_rssi,
               uptime_s, reset_reason, firmware_version, sntp_valid, sntp_miss_count, last_sntp_sync_age_s,
               active_probe_count, band_source, probe_health, heap_min_free_minute_kb,
               heap_largest_block_minute_low_kb, loop_worst_ms, restart_count, nvs_used_entries, nvs_free_entries,
               nvs_write_worst_ms, gap_log_state, sensor_degraded_active, loop_stack_high_water_b,
               wifi_disconnect_count, api_client_count)
           VALUES ($1, 41, 28, 20, -61, 86400, 'Software', $2, 1, 0, 120, 4, 'onchip_curve', 'ok', 31.5, 18, 42.5, 7,
                   120, 380, 12.5, 'off: nvs_full', 0, 1800, 2, 1)""",
        w.ago(seconds=30),
        FIRMWARE,
    )
    # The series rows: two in one minute bucket about five minutes back.
    await conn.executemany(
        "INSERT INTO public.diagnostics (ts, heap_min_free_minute_kb, loop_stack_high_water_b) VALUES ($1, $2, $3)",
        [(w.bucket + timedelta(seconds=1), 30.0, 1700), (w.bucket + timedelta(seconds=2), 33.0, 1900)],
    )
    await conn.executemany(
        "INSERT INTO public.energy (ts, ch0_power_w, ch1_power_w) VALUES ($1, $2, $3)",
        [(w.bucket + timedelta(seconds=1), 500.0, -1200.0), (w.bucket + timedelta(seconds=2), 700.0, -1000.0)],
    )
    # heat1 ran from 20 minutes back and stopped 2 minutes back.
    await conn.executemany(
        "INSERT INTO public.equipment_state (ts, equipment, state, greenhouse_id) VALUES ($1, 'heat1', $2, 'vallery')",
        [(w.ago(minutes=20), True), (w.ago(minutes=2), False)],
    )
    # The manual-run flags as the controller's reconnect snapshot stores them: no run holds a relay, so the host can
    # prove a minimum-time hold.
    await conn.executemany(
        "INSERT INTO public.equipment_state (ts, equipment, state, greenhouse_id) VALUES ($1, $2, false, 'vallery')",
        [(w.ago(hours=3), flag) for flag in ("fan_burst_active", "fog_burst_active", "vent_bypass_active")],
    )
    await conn.execute(
        """INSERT INTO public.desired_state (param, value, manual, source, actor, created_at)
           VALUES ('dry_cost_limit_kwh_per_kg', 0.7, true, 'dashboard', 'jason', $1)""",
        w.ago(hours=1),
    )

    # Pushes: two confirmed band pushes, two failed and one pending manual push, a failed retired name, and one
    # confirmed push older than the window.
    await conn.executemany(
        """INSERT INTO public.setpoint_changes (ts, parameter, value, source, delivery_status, confirmed_at)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        [
            (
                w.ago(minutes=60),
                "band_temp_low_sm",
                67.4,
                "band",
                "confirmed",
                w.ago(minutes=60) + timedelta(seconds=10),
            ),
            (
                w.ago(minutes=50),
                "band_temp_high_sm",
                79.4,
                "band",
                "confirmed",
                w.ago(minutes=50) + timedelta(seconds=30),
            ),
            (w.ago(minutes=40), "mister_engage_kpa", 1.4, "manual", "failed", None),
            (w.ago(minutes=30), "mister_engage_kpa", 1.4, "manual", "failed", None),
            (w.ago(minutes=20), "mister_engage_kpa", 1.5, "manual", None, None),
            (w.ago(minutes=10), "retired_param_x", 1.0, "plan", "failed", None),
            (w.ago(hours=30), "band_temp_low_sm", 67.0, "band", "confirmed", w.ago(hours=30) + timedelta(seconds=5)),
        ],
    )

    # A gap of an hour whose first quarter hour the gap log replayed.
    await conn.execute(
        """INSERT INTO public.data_gaps (id, start_ts, end_ts, duration_s, reason, backfill_status)
           VALUES (9001, $1, $2, 3600, 'esp32_disconnect', 'partial')""",
        w.ago(hours=4),
        w.ago(hours=3),
    )
    await conn.execute(
        """INSERT INTO public.gap_replay_quarters (boot, qseq, first_ts, last_ts, climate_rows, transition_rows,
                                                   format_version, received_at)
           VALUES (3, 7, $1, $2, 15, 2, 2, $3)""",
        w.ago(hours=4),
        w.ago(hours=4) + timedelta(minutes=14),
        w.ago(hours=2),
    )

    # Alerts: an info alert yesterday (its history starting the day before) and the open missed-review alert now.
    y = w.yesterday
    await conn.execute(
        """INSERT INTO public.alert_log (ts, created_at, alert_type, severity, message, disposition, resolved_at)
           VALUES ($1, $2, 'sensor_offline', 'info', 'fixture', 'resolved', $3)""",
        local(y, 12),
        local(y - timedelta(days=1), 12),
        local(y, 13),
    )
    await conn.execute(
        """INSERT INTO public.alert_log (ts, created_at, alert_type, severity, message)
           VALUES ($1, $1, $2, 'warning', 'fixture')""",
        w.at,
        reviews.MISSED_ALERT,
    )
    # The owner saved the band 36 hours back: between the first and the second written review.
    await conn.execute(
        """INSERT INTO public.activity_log (greenhouse_id, ts, source, actor, action, target)
           VALUES ('vallery', $1, 'dashboard', 'jason', $2, 'band')""",
        w.ago(hours=36),
        reviews.BAND_WRITE,
    )

    # The daily record: two complete days, one incomplete day, today; yesterday's relays and today's heat1.
    await conn.execute(
        """INSERT INTO public.daily_band_compliance (date, definition, graded_min, reconstructed_min,
               temp_graded_min, temp_in_min, temp_below_min, temp_above_min,
               vpd_graded_min, vpd_in_min, vpd_below_min, vpd_above_min, both_graded_min, both_in_min,
               day_temp_graded_min, day_temp_in_min, night_temp_graded_min, night_temp_in_min,
               day_vpd_graded_min, day_vpd_in_min, night_vpd_graded_min, night_vpd_in_min,
               day_both_graded_min, day_both_in_min, night_both_graded_min, night_both_in_min,
               night_dryout_graded_min, night_dryout_min, temp_above_full_cooling_min)
           VALUES ($1, 'served', 1440, 0, 1440, 1080, 180, 180, 1440, 720, 360, 360, 1440, 576,
                   720, 540, 720, 540, 720, 360, 720, 360, 720, 360, 720, 216, 420, 300, 60),
                  ($2, 'served', 1440, 0, 1440, 1440, 0, 0, 1440, 1440, 0, 0, 1440, 1440,
                   720, 720, 720, 720, 720, 720, 720, 720, 720, 720, 720, 720, 420, 0, 0)""",
        y,
        y - timedelta(days=1),
    )
    await conn.execute(
        """INSERT INTO public.daily_record (date, complete, kwh_metered, kwh_metered_24h, meter_coverage_pct,
               therms_est, water_gal, wetting_gal, planning_water_gal, house_water_gal, water_complete,
               counter_sample_pct, drying_s, drying_runs, furnace_starts_after_drying, dry_refusal, drying_water_g,
               drying_heat_wh, drying_meter_lower_bound)
           VALUES ($1, true, 20.0, 21.5, 96.0, 1.25, 140, 5, 30, 105, true, 99.5, 3600, 4, 1, $5::jsonb, 247, 177,
                   false),
                  ($2, true, 18.0, 18.5, 95.0, 0.75, 120, 4, 20, 96, true, 99.0, 1800, 2, 0, NULL, NULL, NULL, NULL),
                  ($3, false, 99.0, 99.0, 50.0, 9.0, 9, NULL, NULL, NULL, false, 40.0, 0, 0, 0, NULL, NULL, NULL,
                   NULL),
                  ($4, false, 3.0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 600, 1, 0, NULL, 50, 40,
                   true)""",
        y,
        y - timedelta(days=1),
        y - timedelta(days=2),
        w.today,
        json.dumps({"wanted_s": 5400, "refused_s": {"cost": 1200, "too_cold": 600}}),
    )
    await conn.executemany(
        """INSERT INTO public.daily_relay_record (date, equipment, starts, run_s, event_run_s, repaired_runs)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        [
            (y, "heat1", 10, 3600.0, 3600.0, 0),
            (y, "fan1", 4, 1800.0, 1900.0, 1),
            (y - timedelta(days=1), "heat1", 6, 7200.0, 7200.0, 0),
            (w.today, "heat1", 20, 1500.0, 1500.0, 0),
        ],
    )
    await conn.executemany("INSERT INTO public.daily_summary (date) VALUES ($1)", [(y,), (y - timedelta(days=1),)])

    # Reviews: two written ones with proposals, the newest written one with a proposal, then a failed manual run.
    ids: dict[str, int] = {}
    proposal = {"price": "One step of the price list.", "reason": "Nights ran dry."}
    for name, kind, day, status, requested, written, tokens, anchors, failure in (
        (
            "first",
            "daily",
            y - timedelta(days=2),
            "written",
            49,
            48,
            (290000, 20000, 310000),
            {"band_temp_low_sm": 71.0},
            None,
        ),
        (
            "second",
            "daily",
            y - timedelta(days=1),
            "written",
            25,
            24,
            (300000, 20000, 320000),
            {"band_vpd_high_sm": 1.3},
            None,
        ),
        (
            "newest",
            "daily",
            y,
            "written",
            2,
            1,
            (340590, 14538, 355128),
            {"band_temp_low_sm": 68.5, "zone_priority_center": 2.0},
            None,
        ),
        ("failed", "manual", y, "failed", 0.5, None, (None, None, None), None, "gateway_unreachable"),
    ):
        ids[name] = await conn.fetchval(
            """INSERT INTO public.planner_review (run_id, kind, review_date, requested_at, requested_by, status,
                   attempts, delivered_at, failure, run_finished_at, input_tokens, output_tokens, total_tokens,
                   written_at, summary, band_proposal)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
               RETURNING id""",
            uuid.uuid4(),
            kind,
            day,
            w.ago(hours=requested),
            "ingestor" if kind == "daily" else "jason",
            status,
            1 if status == "written" else 3,
            w.ago(hours=requested) if status == "written" else None,
            failure,
            w.ago(hours=written) if written is not None else None,
            *tokens,
            w.ago(hours=written) if written is not None else None,
            f"The {name} review." if status == "written" else None,
            json.dumps({"anchors": anchors, **proposal}) if anchors else None,
        )
    return ids


def scene(work):
    """``work(conn, world, ids)`` as the dashboard login after seeding, in one transaction that rolls back."""

    async def go():
        conn = await connect()
        transaction = conn.transaction()
        await transaction.start()
        try:
            world = World(await conn.fetchval("SELECT now()"))
            ids = await _seed(conn, world)
            await conn.execute(f"SET LOCAL ROLE {LOGIN}")
            return world, ids, await work(conn, world, ids)
        finally:
            await transaction.rollback()
            await conn.close()

    return run(go())


def approx(value: float) -> object:
    return pytest.approx(value, abs=1e-9)


# ── API-30: the law now ─────────────────────────────────────────────────────


def test_api30_reads_the_newest_record_with_its_rules_drying_checks_and_alone_state(built):
    w, _, view = scene(lambda conn, w, ids: law.law(conn))

    assert (view.server_time, view.observed_at, view.reporting) == (w.at, w.ago(seconds=30), True)
    assert (view.band.temp_low_f, view.band.temp_high_f, view.band.vpd_low_kpa, view.band.vpd_high_kpa) == BAND
    assert (view.band.repaired, view.band.source) == (False, "onchip_curve")
    # The host band is the house anchors, constant through the day, so the controller's band agrees with it.
    assert view.band.host.temp_low_f == pytest.approx(67.4) and view.band.host.vpd_high_kpa == pytest.approx(1.34)
    assert view.band.differs is False

    inputs = view.inputs
    assert (inputs.temp_f, inputs.vpd_kpa, inputs.rh_pct, inputs.dew_point_f, inputs.observed_at) == (
        66.0,
        0.9,
        70.0,
        55.0,
        w.ago(seconds=20),
    )
    assert inputs.outdoor.model_dump() == {"source": "station", "temp_f": 40.0, "rh_pct": 30.0, "dew_point_f": None}

    rules = {rule.id: rule for rule in view.rules}
    assert list(rules) == [
        "heat1",
        "heat2",
        "cooling",
        "second_fan",
        "fog",
        "mist",
        "drying",
        "hot_limit",
        "cold_limit",
    ]
    heat1 = rules["heat1"]
    assert heat1.on_at == approx(BAND[0] + C.HEAT1_ON_ABOVE_LOW_F)
    assert heat1.off_at == approx(BAND[0] + C.HEAT1_OFF_ABOVE_LOW_F)
    assert (heat1.latched, heat1.requested) == (True, True)
    assert [(relay.equipment, relay.state, relay.since) for relay in heat1.relays] == [
        ("heat1", "off", w.ago(minutes=2))
    ]
    # Requested and off 120 s after its switch, well after the boot a day back: its minimum off time holds it.
    assert heat1.hold.model_dump() == {"kind": "min_off", "remaining_s": C.HEAT_MIN_OFF_S - 120}
    drying_rule = rules["drying"]
    assert drying_rule.on_at == approx(BAND[2] + C.DRY_ON_ABOVE_VPD_LOW_KPA)
    assert drying_rule.off_at == approx(BAND[2] + C.DRY_OFF_ABOVE_VPD_LOW_KPA)
    assert (drying_rule.latched, drying_rule.requested) == (False, False)
    cooling = rules["cooling"]
    assert cooling.on_at == approx(BAND[1] + C.COOL_ON_ABOVE_HIGH_F)
    assert [relay.equipment for relay in cooling.relays] == ["vent", "fan1"]  # the lead fan is fan1
    assert (rules["hot_limit"].on_at, rules["hot_limit"].off_at) == (C.SAFETY_MAX_F, C.SAFETY_MAX_F)
    assert (rules["cold_limit"].latched, rules["cold_limit"].hold) == (False, None)

    drying = view.drying
    assert (drying.state, drying.wanted, drying.outdoor_drier, drying.refused_reason) == (
        "not_wanted",
        False,
        True,
        None,
    )
    assert (drying.cost_kwh_per_kg, drying.limit_kwh_per_kg, drying.limit_source) == (0.633, 0.7, "owner")
    assert drying.wanted_below_kpa == approx(BAND[2] + C.DRY_ON_ABOVE_VPD_LOW_KPA)
    assert drying.stop_above_kpa == approx(BAND[2] + C.DRY_OFF_ABOVE_VPD_LOW_KPA)
    assert drying.min_temp_f == approx(BAND[0] + C.DRY_START_ABOVE_LOW_F)
    # 66 F is under the start line; nothing cools and the furnace latch is off.
    assert {check.id: check.ok for check in drying.checks} == {
        "humid": False,
        "outdoor_drier": True,
        "worth_it": True,
        "warm_enough": False,
        "not_cooling": True,
        "furnace_off": True,
    }
    assert drying.meter.model_dump() == {
        "seconds": 120.0,
        "water_g": 247.0,
        "heat_wh": 177.0,
        "refused_seconds": 22440.0,
        "observed_at": w.ago(seconds=30),
    }
    assert drying.today.model_dump() == {
        "seconds": 600.0,
        "runs": 1,
        "water_g": 50.0,
        "heat_wh": 40.0,
        "lower_bound": True,
    }

    assert view.timing.furnace_boot_wait_s == C.HEAT_MIN_OFF_S
    assert view.lead_fan == "fan1"
    assert view.alone.model_dump() == {
        "clock": {"valid": True, "sync_age_s": 120.0},
        "probes": {"active": 4, "degraded": False},
        "host": {"connected": True, "heartbeat_age_s": 10.0},
        "gap_log": "nvs_full",
    }
    assert view.constants.model_dump() == {
        "hash": C.CONSTANTS_SHA256,
        "release_hash": C.CONSTANTS_SHA256,
        "matches": True,
        "observed_at": w.ago(seconds=30),
    }


# ── API-31: the law's history ───────────────────────────────────────────────


def test_api31_cuts_the_window_into_intervals_and_buckets_the_cost_and_band(built):
    def work(conn, w, ids):
        return law.history(conn, w.ago(hours=2), w.at, now=w.at)

    w, _, history = scene(work)
    start, earlier, newer, end = w.ago(hours=2), w.ago(minutes=60), w.ago(minutes=30), w.at

    assert (history.from_, history.to, history.first_record_at) == (start, end, earlier)
    lanes = {lane.key: [(i.start, i.end, i.state) for i in lane.intervals] for lane in history.lanes}
    assert list(lanes) == [key for key, _, _ in law.LANES]
    assert lanes["request.heat1"] == [(start, earlier, "unknown"), (earlier, newer, "off"), (newer, end, "on")]
    assert lanes["latch.dry"] == [(start, earlier, "unknown"), (earlier, newer, "on"), (newer, end, "off")]
    assert lanes["request.vent"] == [(start, earlier, "unknown"), (earlier, end, "off")]
    assert [(i.start, i.end, i.state, i.reason) for i in history.drying] == [
        (start, earlier, "unknown", None),
        (earlier, newer, "refused", "too_cold"),
        (newer, end, "not_wanted", None),
    ]
    assert [(i.start, i.end, i.source) for i in history.outdoor_source] == [
        (start, w.ago(minutes=50), "unknown"),
        (w.ago(minutes=50), w.ago(minutes=40), "intake"),
        (w.ago(minutes=40), end, "station"),
    ]
    assert [(span.start, span.end) for span in history.band_repaired] == [(earlier, newer)]

    cost, band = history.cost, history.band
    assert cost.bucket_s == band.bucket_s == 60 and cost.t == band.t

    def at(moment: datetime) -> int:
        return cost.t.index(int(moment.replace(second=0, microsecond=0).timestamp()))

    # The earlier records carry no price: their buckets have the limit and no cost.
    assert (cost.cost_kwh_per_kg[at(w.ago(minutes=45))], cost.limit_kwh_per_kg[at(w.ago(minutes=45))]) == (None, 0.7)
    assert cost.cost_kwh_per_kg[at(w.ago(minutes=10))] == approx(0.633)
    assert band.temp_low_f[at(w.ago(minutes=10))] == approx(BAND[0])
    assert band.vpd_high_kpa[at(w.ago(minutes=45))] == approx(BAND[3])
    assert (cost.limit_kwh_per_kg[at(w.ago(minutes=90))], band.temp_low_f[at(w.ago(minutes=90))]) == (None, None)


# ── API-32 and API-33: the daily record ─────────────────────────────────────


def test_api32_reads_each_day_from_its_rows_and_averages_the_complete_days(built):
    w, _, result = scene(lambda conn, w, ids: record.record_days(conn))
    y = w.yesterday

    assert (result.from_, result.to) == (w.today - timedelta(days=29), w.today)
    days = {day.date: day for day in result.days}
    assert sorted(days) == [day.date for day in result.days] and len(days) == 30

    day = days[y]
    assert day.complete is True
    assert day.band.model_dump() == {
        "both_pct": 40.0,
        "temp_pct": 75.0,
        "vpd_pct": 50.0,
        "both_day_pct": 50.0,
        "both_night_pct": 30.0,
        "temp_below_pct": 12.5,
        "temp_above_pct": 12.5,
        "vpd_below_pct": 25.0,
        "vpd_above_pct": 25.0,
        "graded_min": 1440,
        "night_dryout_min": 300,
        "night_dried": True,
        "above_full_cooling_min": 60,
    }
    assert {name: (relay.starts, relay.run_s, relay.repaired_runs) for name, relay in day.relays.items()} == {
        "heat1": (10, 3600.0, 0),
        "fan1": (4, 1800.0, 1),
    }
    assert (day.climate_starts, day.climate_run_s) == (14, 5400.0)
    assert (day.energy.kwh, day.energy.kwh_partial, day.energy.coverage_pct, day.gas.therms_est) == (
        21.5,
        20.0,
        96.0,
        1.25,
    )
    assert day.water.model_dump() == {
        "total_gal": 140.0,
        "crop_gal": 30.0,
        "wetting_gal": 5.0,
        "house_gal": 105.0,
        "complete": True,
    }
    assert day.drying.model_dump() == {
        "seconds": 3600.0,
        "runs": 4,
        "furnace_starts_after": 1,
        "water_g": 247.0,
        "heat_wh": 177.0,
        "lower_bound": False,
        "wanted_s": 5400.0,
        "refused_s": {"cost": 1200.0, "too_cold": 600.0},
    }
    assert day.counter_sample_pct == 99.5
    # The scorecard counts the info alert of yesterday; the day before has a history and no alert.
    assert day.alerts.model_dump() == {"critical": 0, "warning": 0, "info": 1}
    assert days[y - timedelta(days=1)].alerts.model_dump() == {"critical": 0, "warning": 0, "info": 0}
    assert days[y - timedelta(days=1)].drying.wanted_s is None
    # A day with no row is null throughout, never zero.
    empty = days[w.today - timedelta(days=20)]
    assert (empty.complete, empty.band, empty.relays, empty.climate_starts, empty.drying, empty.alerts) == (
        False,
        None,
        None,
        None,
        None,
        None,
    )
    today = days[w.today]
    assert (today.complete, today.relays["heat1"].starts, today.drying.seconds) == (False, 20, 600.0)

    # Both means cover yesterday and the day before (the incomplete day and today are left out).
    for means in (result.means.d7, result.means.d30):
        assert means.model_dump() == {
            "days": 2,
            "both_pct": 70.0,
            "temp_pct": 87.5,
            "vpd_pct": 75.0,
            "nights_dried": 1,
            "climate_starts": 10.0,
            "climate_run_h": 1.75,
            "heat1_run_h": 1.5,
            "heat2_run_h": None,
            "kwh": 20.0,
            "therms_est": 1.0,
            "crop_gal": 25.0,
            "drying_h": 0.75,
        }


def test_api33_compares_today_s_counters_with_the_record_and_calls_the_day_partial(built):
    w, _, result = scene(lambda conn, w, ids: record.relay_check(conn, 7))

    dates = [day.date for day in result.days]
    assert dates == sorted(dates, reverse=True) and dates[0] == w.today
    today = result.days[0]
    assert (today.comparison, today.boots) == ("partial", 0)
    relays = {relay.equipment: relay for relay in today.relays}
    assert list(relays) == list(record.COUNTED_RELAYS)
    assert relays["heat1"].model_dump() == {
        "equipment": "heat1",
        "counter_starts": 25,
        "record_starts": 20,
        "starts_difference": 5,
        "counter_run_s": None,
        "record_run_s": 1500.0,
        "run_s_difference": None,
    }
    assert (relays["fan1"].counter_starts, relays["fan1"].counter_run_s, relays["fan1"].record_starts) == (
        5,
        1500.0,
        None,
    )
    assert (relays["vent"].counter_starts, relays["fog"].counter_starts, relays["heat2"].counter_starts) == (10, 6, 23)


# ── API-34: the reviews ─────────────────────────────────────────────────────


def test_api34_pages_the_reviews_with_their_proposal_state_and_token_use(built):
    async def work(conn, w, ids):
        first = await reviews.page(conn, limit=2)
        return first, await reviews.page(conn, limit=2, cursor=first.next_cursor)

    w, ids, (first, second) = scene(work)

    assert [item.id for item in first.items] == [ids["failed"], ids["newest"]]
    assert [item.id for item in second.items] == [ids["second"], ids["first"]]
    assert first.next_cursor is not None and second.next_cursor is None
    failed, newest = first.items
    assert (failed.kind, failed.status, failed.failure, failed.attempts) == (
        "manual",
        "failed",
        "gateway_unreachable",
        3,
    )
    assert (failed.proposal, failed.proposal_state) == (None, None)
    assert (newest.input_tokens, newest.output_tokens, newest.total_tokens) == (340590, 14538, 355128)
    # A band write answered the first proposal; a newer review superseded the second; nothing answered the newest.
    assert [item.proposal_state for item in (newest, *second.items)] == ["waiting", "superseded", "answered"]
    assert newest.proposal.model_dump() == {
        "changes": [
            {
                "param": "band_temp_low_sm",
                "label": setting_label("band_temp_low_sm"),
                "unit": "°F",
                "current": 67.4,
                "proposed": 68.5,
            },
            {
                "param": "zone_priority_center",
                "label": setting_label("zone_priority_center"),
                "unit": None,
                "current": None,
                "proposed": 2.0,
            },
        ],
        "price": "One step of the price list.",
        "reason": "Nights ran dry.",
    }
    # The open missed alert does not make a written day missed.
    assert first.today.model_dump() == {
        "review_date": w.yesterday,
        "status": "written",
        "missed": False,
        "expected_after": "07:00",
        "late_after": "10:00",
    }
    assert first.proposal_waiting.model_dump() == {"review_id": ids["newest"], "review_date": w.yesterday}
    # The newest finished review against the two before it.
    assert first.tokens.model_dump() == {"last": 355128, "mean_7": 315000.0, "mean_30": 315000.0, "rise_pct": 12.7}


# ── API-35 to API-37: the controller, data continuity and delivery ──────────


def test_api35_reads_each_budget_value_against_its_limits(built):
    w, _, health = scene(lambda conn, w, ids: system_health.controller(conn))

    assert health.observed_at == w.ago(seconds=30)
    assert health.firmware.model_dump() == {"version": FIRMWARE, "pinned": FIRMWARE, "matches": True}
    assert (health.uptime_s, health.restarts.count, health.restarts.reset_reason) == (86400.0, 7, "Software")
    assert health.restarts.booted_at == w.ago(seconds=30) - timedelta(seconds=86400)
    assert health.heap.model_dump() == {
        "free_kb": 41.0,
        "min_free_kb": 28.0,
        "largest_block_kb": 20.0,
        "minute_low_kb": 31.5,
        "largest_block_minute_low_kb": 18.0,
    }
    assert health.loop.model_dump() == {"worst_ms": 42.5, "stack_free_min_b": 1800.0}
    assert health.nvs.model_dump() == {"used_entries": 120, "free_entries": 380, "write_worst_ms": 12.5}
    assert health.wifi.model_dump() == {"rssi_dbm": -61.0, "disconnects": 2, "api_clients": 1}
    assert health.clock.model_dump() == {"valid": True, "sync_age_s": 120.0, "misses": 0}
    assert health.probes.model_dump() == {"active": 4, "degraded": False, "health": "ok"}
    assert (health.band_source, health.gap_log) == ("onchip_curve", "nvs_full")
    assert health.limits == system_health.LIMITS and health.limits.stack_free_b == 1024.0


def test_api36_reads_the_unreplayed_outage_the_replayed_quarter_and_the_flow(built):
    w, _, result = scene(lambda conn, w, ids: system_health.data(conn, 1))

    assert (result.from_, result.to, result.gap_log) == (w.ago(days=1), w.at, "nvs_full")
    # The quarter replayed the gap's first 15 minutes (14 minutes of records plus one record interval).
    assert [item.model_dump() for item in result.outages] == [
        {
            "start": w.ago(hours=3, minutes=45),
            "end": w.ago(hours=3),
            "duration_s": 2700,
            "reason": "esp32_disconnect",
            "status": "partial",
        }
    ]
    assert [item.model_dump() for item in result.replayed] == [
        {
            "boot": 3,
            "qseq": 7,
            "first_at": w.ago(hours=4),
            "last_at": w.ago(hours=4) + timedelta(minutes=14),
            "received_at": w.ago(hours=2),
            "climate_rows": 15,
            "transition_rows": 2,
        }
    ]
    assert [day.date for day in result.by_day] == sorted(day.date for day in result.by_day)
    assert result.by_day[-1].date == w.today
    assert sum(day.outage_s for day in result.by_day) == 2700
    assert sum(day.replayed_min for day in result.by_day) == 15
    tables = {item.table: (item.last_row_age_s, item.rows_5m) for item in result.tables}
    assert list(tables) == list(system_health.FLOW_TABLES)
    assert tables["climate"] == (20.0, 1)
    assert tables["system_state"][0] == 10.0
    assert tables["diagnostics"][0] == 30.0
    assert tables["equipment_state"] == (120.0, 1)
    assert tables["setpoint_changes"] == (600.0, 0)
    probes = {item.sensor: item.age_s for item in result.probes}
    assert (probes["climate.temp_north"], probes["climate.lux"]) == (20.0, float(system_health.PROBE_WINDOW_S))
    assert result.ingestor.model_dump() == {
        "heartbeat_age_s": 10.0,
        "reconnects": 3,
        "payloads_rejected": 1,
        "replay_failures": 0,
        "rows_rejected": {"climate": 2},
        "observed_at": w.ago(seconds=30),
    }


def test_api37_counts_the_pushes_and_names_the_failing_settings(built):
    w, _, result = scene(lambda conn, w, ids: system_health.delivery(conn, 24))

    assert (result.from_, result.to) == (w.ago(hours=24), w.at)
    assert [(item.source, item.status, item.count) for item in result.by_status] == [
        ("band", "confirmed", 2),
        ("manual", "failed", 2),
        ("manual", "pending", 1),
        ("plan", "failed", 1),
    ]
    # The pending push waits; failed pushes are not waiting.
    assert result.oldest_unconfirmed_s == 1200.0
    assert result.latency.confirmed == 2
    assert (result.latency.p50_s, result.latency.p95_s) == (pytest.approx(20.0), pytest.approx(29.0))
    assert [item.model_dump() for item in result.failing] == [
        {
            "param": "mister_engage_kpa",
            "label": setting_label("mister_engage_kpa"),
            "failed": 2,
            "last_failed_at": w.ago(minutes=30),
            "last_confirmed_at": None,
        },
        {
            "param": "retired_param_x",
            "label": "retired_param_x",
            "failed": 1,
            "last_failed_at": w.ago(minutes=10),
            "last_confirmed_at": None,
        },
    ]
    assert result.dispatcher_stage == "ordinary"
    assert result.readback_pass.model_dump() == {"at": w.ago(minutes=1), "stored": 2, "of": 102}


# ── API-02, API-04 and API-09: Now, the series keys and each setting's effect ─


def test_now_carries_the_law_the_review_the_outdoor_source_and_the_controller_budget(built):
    w, _, now = scene(lambda conn, w, ids: reads.now(conn))

    assert now.law.model_dump() == {
        "observed_at": w.ago(seconds=30),
        "latches": ["h1", "air"],
        "requests": ["heat1"],
        "drying": "not_wanted",
        "drying_refused_reason": None,
        "drying_cost_kwh_per_kg": 0.633,
        "drying_cost_limit_kwh_per_kg": 0.7,
        "band_repaired": False,
        "band": {"temp_low_f": 67.4, "temp_high_f": 79.4, "vpd_low_kpa": 0.81, "vpd_high_kpa": 1.34},
    }
    assert now.review.model_dump() == {
        "review_date": w.yesterday,
        "status": "written",
        "missed": False,
        "written_at": w.ago(hours=1),
        "proposal_waiting": True,
    }
    assert now.outdoor.source == "station"
    assert (now.controller.heap_minute_low_kb, now.controller.restart_count, now.controller.gap_log) == (
        31.5,
        7,
        "nvs_full",
    )


def test_the_new_diagnostics_and_energy_keys_read_their_columns_and_ch1_as_a_magnitude(built):
    keys = [
        "diagnostics.heap_minute_low_kb",
        "diagnostics.loop_stack_free_min_b",
        "energy.ch0_power_w",
        "energy.ch1_power_w",
    ]

    def work(conn, w, ids):
        # The window ends a minute or more before the controller's newest diagnostics row (30 s back).
        return series.series(conn, keys, w.bucket - timedelta(minutes=10), w.bucket + timedelta(minutes=4), now=w.at)

    w, _, result = scene(work)
    assert result.bucket_s == 60 and len(result.t) == 14
    index = result.t.index(int(w.bucket.timestamp()))
    expected = {
        "diagnostics.heap_minute_low_kb": (31.5, 30.0, 33.0),
        "diagnostics.loop_stack_free_min_b": (1800.0, 1700.0, 1900.0),
        "energy.ch0_power_w": (600.0, 500.0, 700.0),
        # The reversed clamp reads negative; the key is its magnitude.
        "energy.ch1_power_w": (1100.0, 1000.0, 1200.0),
    }
    for key, (avg, low, high) in expected.items():
        column = result.series[key]
        assert (column.avg[index], column.min[index], column.max[index], column.count[index]) == (avg, low, high, 2)
        assert column.source == "raw"
        assert sum(column.count) == 2, key


def test_every_setting_row_carries_the_effect_the_settings_service_gives_it(built):
    _, _, result = scene(lambda conn, w, ids: reads.settings_rows(conn))

    effects = {item.param: item.effect for item in result.items}
    assert effects == {param: settings.setting_effect(param) for param in effects}
    assert (effects["band_temp_low_sr"], effects["mister_engage_delay_s"], effects["band_house_temp_low"]) == (
        "controller",
        "none",
        "host",
    )
