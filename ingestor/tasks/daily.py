"""tasks.daily — split from the monolithic tasks.py (issue #46).

Behaviour-preserving extraction; bodies are byte-identical to the
original module. The tasks package __init__ re-exports the public
surface so every `from tasks import X` still resolves.
"""

from partial_energy import refresh_partial_energy

from ._common import (
    GREENHOUSE_ID,
    SOIL_DRYOUT_MIN_DURATION_H,
    SOIL_DRYOUT_MIN_SAMPLES,
    SUPPRESSIBLE_ALERT_TYPES,
    THERM_BTU,
    _td,
    asyncpg,
    dataclass,
    log,
)


def _auto_close_disposition(
    alert_type: str, prior_disposition: str, resolution: str = "auto-resolved"
) -> tuple[str, str]:
    """Pick (disposition, resolution) for an alert that left the active set.

    A suppressible alert type that the operator already ACKNOWLEDGED is closed
    as 'suppressed' (accepted hardware/occupancy gap, not a recovery). Everything
    else resolves with ``resolution``, the caller's reason (VD-72: for example
    ``auto-resolved: probe reporting again``).
    """
    if alert_type in SUPPRESSIBLE_ALERT_TYPES and prior_disposition == "acknowledged":
        return "suppressed", "auto-suppressed: acknowledged hardware/occupancy gap, no recovery claimed"
    return "resolved", resolution


@dataclass
class SoilDryoutWindow:
    """Per-probe rollup over the dryout look-back window.

    Field semantics match the SQL aggregate in alert_monitor: counts/extrema of
    the NON-NULL soil-moisture samples in the window, plus the age of the oldest
    in-window sample (how long the probe has been reporting continuously).
    """

    column: str
    sensor_id: str
    zone: str
    samples: int
    min_pct: float | None
    max_pct: float | None
    latest_pct: float | None
    oldest_sample_age_h: float | None


def evaluate_soil_dryout(
    window: SoilDryoutWindow,
    wilt_pct: float | None,
    zone_occupied: bool,
    *,
    min_duration_h: float = SOIL_DRYOUT_MIN_DURATION_H,
    min_samples: int = SOIL_DRYOUT_MIN_SAMPLES,
) -> bool:
    """Decide whether a LIVE probe is in a paging soil-dryout condition.

    Fires (returns True) only when ALL hold:
      * the zone is occupied (an active crop) — empty/unpotted zones are
        suppressed, consistent with soil_sensor_offline occupancy semantics;
      * a wilt threshold is configured for the zone;
      * the window has enough samples to be "continuous" (>= min_samples) and
        the oldest in-window sample is at least min_duration_h old (the probe
        has been reading the whole >2h span, not just recently);
      * every in-window sample is below wilt (max_pct < wilt) — one reading at
        or above wilt breaks the "continuously below wilt" requirement;
      * the probe is LIVE, not stuck-zero/garbage (min_pct > 0): a stuck-zero or
        missing probe is owned by irrigation_feedback_gap / soil_sensor_offline,
        not this dryout rule.

    Pure function: no DB, no I/O, no device write. Unit-tested directly.
    """
    if not zone_occupied:
        return False
    if wilt_pct is None:
        return False
    if window.samples < min_samples:
        return False
    if window.min_pct is None or window.max_pct is None:
        return False
    if window.oldest_sample_age_h is None or window.oldest_sample_age_h < min_duration_h:
        return False
    if window.min_pct <= 0:
        return False
    return window.max_pct < wilt_pct


_MODELED_ELECTRIC_EQUIPMENT = (
    "heat1",
    "fan1",
    "fan2",
    "fog",
    "vent",
    "grow_light_main",
    "grow_light_grow",
)


# One definition of starts, run time and therms (RULINGS AF4, TEL-F1): for the six climate relays daily_summary takes
# the daily record's figures (migration 310: lost OFFs repaired, the same hours daily_record.therms_est uses). The
# record is stored by the band-curve refresh job (fn_refresh_daily_record, :02/:32, today and the two days before);
# it never reads daily_summary, so there is no circular read. A day the record does not cover (no daily_record row,
# a relay without a daily_relay_record row, or the record unreadable) keeps the equipment-state view's figures.
DAILY_RECORD_RELAYS = ("heat1", "heat2", "fan1", "fan2", "vent", "fog")


@dataclass(frozen=True)
class DailyRecordDay:
    relays: dict[str, tuple[float, int]]  # equipment -> (run minutes, starts)
    therms: float | None


async def _daily_record_day(conn: asyncpg.Connection, target_day) -> DailyRecordDay | None:
    """The day's stored daily record, or None when it does not cover the day or cannot be read."""
    try:
        record = await conn.fetchrow("SELECT therms_est FROM daily_record WHERE date = $1", target_day)
        if record is None:
            return None
        rows = await conn.fetch(
            "SELECT equipment, run_s, starts FROM daily_relay_record WHERE date = $1 AND equipment = ANY($2::text[])",
            target_day,
            list(DAILY_RECORD_RELAYS),
        )
    except asyncpg.PostgresError as error:
        log.warning("daily record for %s unreadable (%s): equipment-state figures kept", target_day, error)
        return None
    therms = record["therms_est"]
    return DailyRecordDay(
        relays={row["equipment"]: (float(row["run_s"]) / 60.0, int(row["starts"])) for row in rows},
        therms=float(therms) if therms is not None else None,
    )


async def _electric_wattages(conn: asyncpg.Connection, target_day) -> dict[str, float | None]:
    """Return the coefficient revision valid at the start of ``target_day``.

    Migration 193 makes provenance and uncertainty first-class.  Missing schema
    or coefficients remain ``None``; falling back to current or hard-coded
    points would recreate the silent historical restatement fixed by #437.
    """
    rows = await conn.fetch(
        """
        WITH expected(equipment_slug) AS (
            SELECT unnest($2::text[])
        )
        SELECT x.equipment_slug, c.nominal_value AS coefficient_nominal
        FROM expected x
        LEFT JOIN equipment e
          ON e.greenhouse_id = 'vallery'
         AND e.slug = x.equipment_slug
         AND e.is_active
        LEFT JOIN LATERAL (
            SELECT rc.nominal_value
            FROM resource_coefficients rc
            WHERE rc.equipment_id = e.id
              AND rc.resource_kind = 'electric_watts'
              AND rc.valid_from <= ($1::date::timestamp AT TIME ZONE 'America/Denver')
              AND (
                  rc.valid_to IS NULL
                  OR rc.valid_to > ($1::date::timestamp AT TIME ZONE 'America/Denver')
              )
            ORDER BY rc.valid_from DESC, rc.id DESC
            LIMIT 1
        ) c ON true
        ORDER BY x.equipment_slug
        """,
        target_day,
        list(_MODELED_ELECTRIC_EQUIPMENT),
    )
    return {
        row["equipment_slug"]: (float(row["coefficient_nominal"]) if row["coefficient_nominal"] is not None else None)
        for row in rows
    }


async def _gas_btu_per_hour(conn: asyncpg.Connection, target_day) -> float | None:
    """Return an exact, date-valid heat2 nameplate coefficient or ``None``."""
    row = await conn.fetchrow(
        """
        SELECT rc.nominal_value, rc.lower_bound, rc.upper_bound
        FROM equipment e
        JOIN resource_coefficients rc ON rc.equipment_id = e.id
        WHERE e.greenhouse_id = 'vallery'
          AND e.slug = 'heat2'
          AND e.is_active
          AND rc.resource_kind = 'gas_btu_per_hour'
          AND rc.valid_from <= ($1::date::timestamp AT TIME ZONE 'America/Denver')
          AND (
              rc.valid_to IS NULL
              OR rc.valid_to > ($1::date::timestamp AT TIME ZONE 'America/Denver')
          )
        ORDER BY rc.valid_from DESC, rc.id DESC
        LIMIT 1
        """,
        target_day,
    )
    if not row or row["nominal_value"] is None:
        return None
    if row["lower_bound"] != row["upper_bound"]:
        return None
    return float(row["nominal_value"])


def _runtime_kwh_from_minutes(
    minutes_by_equipment: dict[str, float | None],
    wattages: dict[str, float | None],
) -> float | None:
    if set(minutes_by_equipment) != set(_MODELED_ELECTRIC_EQUIPMENT):
        return None
    if any(minutes_by_equipment[e] is None or wattages.get(e) is None for e in _MODELED_ELECTRIC_EQUIPMENT):
        return None
    return sum(float(minutes_by_equipment[e]) / 60.0 * float(wattages[e]) / 1000.0 for e in _MODELED_ELECTRIC_EQUIPMENT)


async def _apply_resource_cost_gate(
    conn: asyncpg.Connection,
    target_day,
    *,
    kwh: float | None,
    therms: float | None,
    water_gal: float | None,
) -> tuple[float | None, float | None, float | None, float | None]:
    """Persist only costs whose underlying evidence is scoring-eligible."""
    energy_available = bool(
        await conn.fetchval(
            """
            SELECT available_for_scoring
            FROM v_runtime_energy_daily
            WHERE date = $1 AND greenhouse_id = 'vallery'
            """,
            target_day,
        )
    )
    water_available = bool(
        await conn.fetchval(
            """
            SELECT available_for_scoring
            FROM v_water_attribution_daily
            WHERE date = $1 AND greenhouse_id = 'vallery'
            """,
            target_day,
        )
    )
    electric_cost = round(kwh * 0.111, 2) if energy_available and kwh is not None else None
    gas_cost = round(therms * 0.83, 2) if therms is not None else None
    water_cost = round(water_gal * 0.00484, 2) if water_available and water_gal is not None else None
    total_cost = (
        round(electric_cost + gas_cost + water_cost, 2)
        if electric_cost is not None and gas_cost is not None and water_cost is not None
        else None
    )
    await conn.execute(
        """
        UPDATE daily_summary
        SET cost_electric = $2,
            cost_gas = $3,
            cost_water = $4,
            cost_total = $5
        WHERE date = $1
        """,
        target_day,
        electric_cost,
        gas_cost,
        water_cost,
        total_cost,
    )
    return electric_cost, gas_cost, water_cost, total_cost


async def grow_light_daily(pool: asyncpg.Pool) -> None:
    """Comprehensive daily_summary backfill — runtimes, cycles, energy, costs for yesterday."""
    async with pool.acquire() as conn:
        # The local day before today. The database clock is UTC, so its CURRENT_DATE minus one named the local day
        # still in progress whenever this 24 h task fired between 17:00 and 24:00 MST.
        yesterday = await conn.fetchval("SELECT (now() AT TIME ZONE 'America/Denver')::date - 1")
        rows = await conn.fetch(
            """
            SELECT equipment, on_minutes, cycles, is_deploy_gate_eligible
            FROM v_equipment_runtime_daily
            WHERE day = $1
            """,
            yesterday,
        )
        rt = {r["equipment"]: (float(r["on_minutes"] or 0), int(r["cycles"] or 0)) for r in rows}
        rt_eligible = {r["equipment"]: bool(r["is_deploy_gate_eligible"]) for r in rows}
        record = await _daily_record_day(conn, yesterday)
        if record is not None:
            rt.update(record.relays)

        # Runtimes
        rf1 = rt.get("fan1", (None, 0))[0]
        rf2 = rt.get("fan2", (None, 0))[0]
        rh1 = rt.get("heat1", (None, 0))[0]
        rh2 = rt.get("heat2", (None, 0))[0]
        rfg = rt.get("fog", (None, 0))[0]
        rv = rt.get("vent", (None, 0))[0]
        rms = rt.get("mister_south", (0, 0))[0] / 60.0
        rmw = rt.get("mister_west", (0, 0))[0] / 60.0
        rmc = rt.get("mister_center", (0, 0))[0] / 60.0
        rdw = rt.get("drip_wall", (0, 0))[0] / 60.0
        rdc = rt.get("drip_center", (0, 0))[0] / 60.0
        rgl = (
            rt["grow_light_main"][0] + rt["grow_light_grow"][0]
            if "grow_light_main" in rt and "grow_light_grow" in rt
            else None
        )

        # Energy. Electric cost uses published device watts × observed on-time;
        # Shelly metered kWh remains a diagnostic because its circuit coverage is partial.
        wattages = await _electric_wattages(conn, yesterday)
        electric_minutes = {
            e: (rt[e][0] if e in rt and rt_eligible.get(e, False) else None) for e in _MODELED_ELECTRIC_EQUIPMENT
        }
        kwh = _runtime_kwh_from_minutes(electric_minutes, wattages)
        gas_btu_per_hour = await _gas_btu_per_hour(conn, yesterday)
        therms = (
            record.therms
            if record is not None
            else (
                rh2 / 60.0 * gas_btu_per_hour / THERM_BTU
                if rh2 is not None and rt_eligible.get("heat2", False) and gas_btu_per_hour is not None
                else None
            )
        )
        # Water cost is planning water only (climate wetting + wall irrigation + wall fertigation, #1623).
        water_row = await conn.fetchrow(
            """
            SELECT planning_water_gal, available_for_scoring
            FROM v_water_attribution_daily
            WHERE date = $1 AND greenhouse_id = 'vallery'
            """,
            yesterday,
        )
        water_gal = (
            float(water_row["planning_water_gal"])
            if water_row and water_row["available_for_scoring"] and water_row["planning_water_gal"] is not None
            else None
        )
        cg = round(therms * 0.83, 2) if therms is not None else None

        await conn.execute(
            """
            UPDATE daily_summary SET
                runtime_fan1_min=$2, runtime_fan2_min=$3, runtime_heat1_min=$4, runtime_heat2_min=$5,
                runtime_fog_min=$6, runtime_vent_min=$7,
                runtime_mister_south_h=$8, runtime_mister_west_h=$9, runtime_mister_center_h=$10,
                runtime_drip_wall_h=$11, runtime_drip_center_h=$12, runtime_grow_light_min=$13,
                cycles_fan1=$14, cycles_fan2=$15, cycles_heat1=$16, cycles_heat2=$17,
                cycles_fog=$18, cycles_vent=$19,
                cycles_grow_light=$20,
                cycles_mister_south=$21, cycles_mister_west=$22, cycles_mister_center=$23,
                cycles_drip_wall=$24, cycles_drip_center=$25,
                kwh_estimated=$26, therms_estimated=$27,
                cost_electric=$28, cost_gas=$29, cost_water=$30, cost_total=$31
            WHERE date = $1
        """,
            yesterday,
            rf1,
            rf2,
            rh1,
            rh2,
            rfg,
            rv,
            rms,
            rmw,
            rmc,
            rdw,
            rdc,
            rgl,
            rt.get("fan1", (0, 0))[1],
            rt.get("fan2", (0, 0))[1],
            rt.get("heat1", (0, 0))[1],
            rt.get("heat2", (0, 0))[1],
            rt.get("fog", (0, 0))[1],
            rt.get("vent", (0, 0))[1],
            rt.get("grow_light_main", (0, 0))[1] + rt.get("grow_light_grow", (0, 0))[1],
            rt.get("mister_south", (0, 0))[1],
            rt.get("mister_west", (0, 0))[1],
            rt.get("mister_center", (0, 0))[1],
            rt.get("drip_wall", (0, 0))[1],
            rt.get("drip_center", (0, 0))[1],
            round(kwh, 2) if kwh is not None else None,
            round(therms, 3) if therms is not None else None,
            None,
            cg,
            None,
            None,
        )
        await conn.execute(
            """
            UPDATE daily_summary
            SET runtime_grow_light_main_min = $2,
                runtime_grow_light_grow_min = $3
            WHERE date = $1
            """,
            yesterday,
            rt.get("grow_light_main", (None, 0))[0],
            rt.get("grow_light_grow", (None, 0))[0],
        )
        ce, cg, cw, ct = await _apply_resource_cost_gate(
            conn,
            yesterday,
            kwh=kwh,
            therms=therms,
            water_gal=water_gal,
        )
        # Source-qualified partial-channel diagnostic, not whole-house energy.
        # Model/partial-meter ratios do not prove a measured undercount or waste.
        # Preserve missingness, including clearing stale derived summary values.
        await refresh_partial_energy(conn, yesterday, GREENHOUSE_ID)

    log.info(
        "Daily summary (%s): runtime-model kWh=%s, %.3f therms, eligible total cost=%s",
        yesterday,
        f"{kwh:.1f}" if kwh is not None else "unavailable",
        therms if therms is not None else 0.0,
        f"${ct:.2f}" if ct is not None else "unavailable",
    )

    # ── utility_cost monthly roll-up (idempotent) ──
    async with pool.acquire() as conn:
        month_start = yesterday.replace(day=1)
        row = await conn.fetchrow(
            """
            SELECT ROUND(SUM(cost_electric)::numeric, 2) AS ce,
                   ROUND(SUM(cost_gas)::numeric, 2)      AS cg,
                   ROUND(SUM(cost_water)::numeric, 2)    AS cw,
                   ROUND(SUM(kwh_estimated) FILTER (
                       WHERE cost_electric IS NOT NULL
                   )::numeric, 2) AS kwh,
                   ROUND(SUM(
                       COALESCE(mister_water_gal, 0) + COALESCE(irrigation_water_gal, 0)
                       + COALESCE(fertigation_water_gal, 0)
                   ) FILTER (
                       WHERE cost_water IS NOT NULL
                   )::numeric, 2) AS gal
            FROM daily_summary
            WHERE date >= $1 AND date < ($1 + INTERVAL '1 month')::date
        """,
            month_start,
        )
        if row and row["ce"] is not None:
            await conn.execute(
                """
                INSERT INTO utility_cost (month, category, amount_usd, kwh, notes)
                VALUES ($1, 'electric', $2, $3, 'Auto from daily_summary')
                ON CONFLICT (month, category) DO UPDATE SET
                    amount_usd = EXCLUDED.amount_usd, kwh = EXCLUDED.kwh, updated_at = now()
            """,
                month_start,
                row["ce"],
                row["kwh"],
            )
        if row and row["cg"] is not None:
            await conn.execute(
                """
                INSERT INTO utility_cost (month, category, amount_usd, notes)
                VALUES ($1, 'propane', $2, 'Auto from daily_summary')
                ON CONFLICT (month, category) DO UPDATE SET
                    amount_usd = EXCLUDED.amount_usd, updated_at = now()
            """,
                month_start,
                row["cg"],
            )
        if row and row["cw"] is not None:
            await conn.execute(
                """
                INSERT INTO utility_cost (month, category, amount_usd, gallons, notes)
                VALUES ($1, 'water', $2, $3, 'Auto from daily_summary')
                ON CONFLICT (month, category) DO UPDATE SET
                    amount_usd = EXCLUDED.amount_usd, gallons = EXCLUDED.gallons, updated_at = now()
            """,
                month_start,
                row["cw"],
                row["gal"],
            )
        log.info("utility_cost updated for %s", month_start)


# ═════════════════════════════════════════════════════════════════
# 13. LIVE DAILY SUMMARY (every 1800s = 30 min)
# ═════════════════════════════════════════════════════════════════
async def _refresh_daily_summary_for_date(
    conn: asyncpg.Connection,
    target_day,
) -> tuple[float | None, float, float]:
    """Refresh daily_summary derived aggregates for a local greenhouse day."""
    # Ensure row exists
    await conn.execute("INSERT INTO daily_summary (date) VALUES ($1) ON CONFLICT (date) DO NOTHING", target_day)

    # Climate aggregates.
    #
    # mister_water_gal (B12 / M1): `mister_water_today` is a firmware-side daily
    # accumulator that resets to 0 at local midnight AND on every ESP32 reboot.
    # MAX() over the day is therefore wrong on any day with a mid-day reset — a
    # post-reboot peak BELOW the pre-reboot peak undercounts (we lose the water
    # misted before the reboot), and a noisy counter can leave a spurious high
    # MAX that over-counts. Verified over 30d: MAX-based 5679 gal vs reset-aware
    # 3142 gal (the ~1211-vs-949 B12 discrepancy at scale). The fix is a
    # reset-aware delta sum: add only the POSITIVE step between consecutive
    # readings (a negative step = a reset, contributing 0), which is monotonic-
    # safe and reboot-safe. The first reading of the day seeds from 0 (the
    # midnight reset), so its full value is counted.
    climate = await conn.fetchrow(
        """
        WITH day_climate AS (
            SELECT temp_avg, vpd_avg, rh_avg, outdoor_temp_f, co2_ppm,
                   mister_water_today,
                   LAG(mister_water_today) OVER (ORDER BY ts) AS prev_mister
            FROM climate
            WHERE ts >= $1::date::timestamp AT TIME ZONE 'America/Denver'
              AND ts < ($1::date + 1)::timestamp AT TIME ZONE 'America/Denver'
              AND temp_avg IS NOT NULL
        )
        SELECT MIN(temp_avg) AS temp_min, MAX(temp_avg) AS temp_max, AVG(temp_avg) AS temp_avg,
               MIN(vpd_avg) AS vpd_min, MAX(vpd_avg) AS vpd_max, AVG(vpd_avg) AS vpd_avg,
               MIN(rh_avg) AS rh_min, MAX(rh_avg) AS rh_max, AVG(rh_avg) AS rh_avg,
               MIN(outdoor_temp_f) AS outdoor_temp_min, MAX(outdoor_temp_f) AS outdoor_temp_max,
               AVG(co2_ppm) AS co2_avg,
               SUM(GREATEST(mister_water_today - COALESCE(prev_mister, 0), 0)) AS mister_water_gal
        FROM day_climate
    """,
        target_day,
    )

    # Time in band, its whole-day shares and the below/above stress hours come from the database's one
    # definition (migration 290, #1358): verdify_matview_refresh_runtime.fn_refresh_band_compliance grades
    # each 5-minute bucket against the band the controller served and copies the day into daily_summary's
    # compliance_pct, temp_/vpd_compliance_pct and stress_hours_* columns. That served house band is the only
    # temperature/VPD measurement basis (#1623); this task writes none of them.

    # Dew point margin (condensation risk)
    dp = await conn.fetchrow(
        """
        SELECT min_margin_f, COALESCE(risk_hours, 0) AS risk_hours
        FROM v_dew_point_risk WHERE date = $1
    """,
        target_day,
    )

    _RT_EQUIP = (
        "fan1",
        "fan2",
        "fog",
        "heat1",
        "heat2",
        "vent",
        "grow_light_main",
        "grow_light_grow",
        "mister_south",
        "mister_west",
        "mister_center",
        "drip_wall",
        "drip_center",
        "drip_wall_fert",
        "drip_center_fert",
        "mister_south_fert",
        "mister_west_fert",
        "fert_master_valve",
    )
    rt_rows = await conn.fetch(
        """
        SELECT equipment, on_minutes, cycles, is_deploy_gate_eligible
        FROM v_equipment_runtime_daily
        WHERE day = $1
          AND equipment = ANY($2::text[])
    """,
        target_day,
        list(_RT_EQUIP),
    )
    rt = {r["equipment"]: float(r["on_minutes"] or 0) for r in rt_rows}
    cycles = {r["equipment"]: int(r["cycles"] or 0) for r in rt_rows}
    rt_eligible = {r["equipment"]: bool(r["is_deploy_gate_eligible"]) for r in rt_rows}
    record = await _daily_record_day(conn, target_day)
    if record is not None:
        for equipment, (minutes, starts) in record.relays.items():
            rt[equipment] = minutes
            cycles[equipment] = starts

    wattages = await _electric_wattages(conn, target_day)
    electric_minutes = {
        e: (rt[e] if e in rt and rt_eligible.get(e, False) else None) for e in _MODELED_ELECTRIC_EQUIPMENT
    }
    kwh = _runtime_kwh_from_minutes(electric_minutes, wattages)
    gas_btu_per_hour = await _gas_btu_per_hour(conn, target_day)
    therms = (
        record.therms
        if record is not None
        else (
            rt["heat2"] / 60.0 * gas_btu_per_hour / THERM_BTU
            if "heat2" in rt and rt_eligible.get("heat2", False) and gas_btu_per_hour is not None
            else None
        )
    )

    water_evidence = await conn.fetchrow(
        """
        SELECT quality_filtered_meter_gal,
               climate_wetting_gal,
               wall_irrigation_gal,
               wall_fertigation_gal,
               planning_water_gal,
               available_for_scoring
        FROM v_water_attribution_daily
        WHERE date = $1 AND greenhouse_id = 'vallery'
        """,
        target_day,
    )
    water_available = bool(water_evidence and water_evidence["available_for_scoring"])
    # water_used_gal stays the quality-filtered meter total (reporting). Water cost is planning water only:
    # climate wetting + wall irrigation + wall fertigation; house/hose use is never a planning input (#1623).
    water_gal = float(water_evidence["quality_filtered_meter_gal"]) if water_available else None
    planning_water_gal = (
        float(water_evidence["planning_water_gal"])
        if water_available and water_evidence["planning_water_gal"] is not None
        else None
    )
    mister_water_gal = float(water_evidence["climate_wetting_gal"]) if water_available else None

    cg = round(therms * 0.83, 2) if therms is not None else None

    gl_min = (
        rt["grow_light_main"] + rt["grow_light_grow"] if "grow_light_main" in rt and "grow_light_grow" in rt else None
    )
    fert_runtime_h = (
        rt.get("drip_wall_fert", 0)
        + rt.get("drip_center_fert", 0)
        + rt.get("mister_south_fert", 0)
        + rt.get("mister_west_fert", 0)
    ) / 60.0
    clean_irrigation_runtime_h = (
        rt.get("drip_wall", 0)
        + rt.get("drip_center", 0)
        + rt.get("mister_south", 0)
        + rt.get("mister_west", 0)
        + rt.get("mister_center", 0)
    ) / 60.0
    irrigation_water_gal = float(water_evidence["wall_irrigation_gal"]) if water_available else None
    fertigation_water_gal = float(water_evidence["wall_fertigation_gal"]) if water_available else None

    await conn.execute(
        """
        UPDATE daily_summary SET
            temp_min=$2, temp_max=$3, temp_avg=$4,
            vpd_min=$5, vpd_max=$6, vpd_avg=$7,
            rh_min=$8, rh_max=$9, rh_avg=$10,
            co2_avg=$11,
            outdoor_temp_min=$12, outdoor_temp_max=$13,
            runtime_fan1_min=$14, runtime_fan2_min=$15,
            runtime_heat1_min=$16, runtime_heat2_min=$17,
            runtime_fog_min=$18, runtime_vent_min=$19,
            runtime_grow_light_min=$20,
            runtime_mister_south_h=$21, runtime_mister_west_h=$22, runtime_mister_center_h=$23,
            runtime_drip_wall_h=$24, runtime_drip_center_h=$25,
            kwh_estimated=$26, therms_estimated=$27,
            cost_electric=$28, cost_gas=$29, cost_water=$30, cost_total=$31,
            water_used_gal=$32, mister_water_gal=$33,
            min_dp_margin_f=$34, dp_risk_hours=$35,
            cycles_mister_south=$36,
            cycles_mister_west=$37,
            cycles_mister_center=$38,
            cycles_drip_wall=$39,
            cycles_drip_center=$40,
            cycles_fan1=$41, cycles_fan2=$42, cycles_heat1=$43, cycles_heat2=$44,
            cycles_fog=$45, cycles_vent=$46, cycles_grow_light=$47,
            captured_at=now()
        WHERE date = $1
    """,
        target_day,
        climate["temp_min"] if climate else None,
        climate["temp_max"] if climate else None,
        climate["temp_avg"] if climate else None,
        climate["vpd_min"] if climate else None,
        climate["vpd_max"] if climate else None,
        climate["vpd_avg"] if climate else None,
        climate["rh_min"] if climate else None,
        climate["rh_max"] if climate else None,
        climate["rh_avg"] if climate else None,
        climate["co2_avg"] if climate else None,
        climate["outdoor_temp_min"] if climate else None,
        climate["outdoor_temp_max"] if climate else None,
        rt.get("fan1"),
        rt.get("fan2"),
        rt.get("heat1"),
        rt.get("heat2"),
        rt.get("fog"),
        rt.get("vent"),
        gl_min,
        rt.get("mister_south", 0) / 60.0,
        rt.get("mister_west", 0) / 60.0,
        rt.get("mister_center", 0) / 60.0,
        rt.get("drip_wall", 0) / 60.0,
        rt.get("drip_center", 0) / 60.0,
        round(kwh, 2) if kwh is not None else None,
        round(therms, 3) if therms is not None else None,
        None,
        cg,
        None,
        None,
        water_gal,
        mister_water_gal,
        float(dp["min_margin_f"]) if dp and dp["min_margin_f"] is not None else None,
        float(dp["risk_hours"]) if dp else 0,
        cycles.get("mister_south", 0),
        cycles.get("mister_west", 0),
        cycles.get("mister_center", 0),
        cycles.get("drip_wall", 0),
        cycles.get("drip_center", 0),
        # The firmware counters write_daily_summary snapshots reset at local midnight and on every
        # reboot; the transition view is the cycle authority for every refreshed local day, as it
        # already is for the runtimes above. A missing equipment row stays NULL, never 0.
        cycles.get("fan1"),
        cycles.get("fan2"),
        cycles.get("heat1"),
        cycles.get("heat2"),
        cycles.get("fog"),
        cycles.get("vent"),
        (
            cycles["grow_light_main"] + cycles["grow_light_grow"]
            if "grow_light_main" in cycles and "grow_light_grow" in cycles
            else None
        ),
    )
    await conn.execute(
        """
        UPDATE daily_summary
        SET runtime_grow_light_main_min = $2,
            runtime_grow_light_grow_min = $3
        WHERE date = $1
        """,
        target_day,
        rt.get("grow_light_main"),
        rt.get("grow_light_grow"),
    )
    await conn.execute(
        """
        UPDATE daily_summary SET
            runtime_drip_wall_fert_h=$2,
            runtime_drip_center_fert_h=$3,
            runtime_mister_south_fert_h=$4,
            runtime_mister_west_fert_h=$5,
            runtime_fert_master_h=$6,
            runtime_irrigation_clean_h=$7,
            runtime_irrigation_fert_h=$8,
            runtime_irrigation_total_h=$9,
            cycles_drip_wall_fert=$10,
            cycles_drip_center_fert=$11,
            cycles_mister_south_fert=$12,
            cycles_mister_west_fert=$13,
            cycles_fert_master=$14,
            irrigation_water_gal=$15,
            fertigation_water_gal=$16,
            captured_at=now()
        WHERE date = $1
        """,
        target_day,
        rt.get("drip_wall_fert", 0) / 60.0,
        rt.get("drip_center_fert", 0) / 60.0,
        rt.get("mister_south_fert", 0) / 60.0,
        rt.get("mister_west_fert", 0) / 60.0,
        rt.get("fert_master_valve", 0) / 60.0,
        clean_irrigation_runtime_h,
        fert_runtime_h,
        clean_irrigation_runtime_h + fert_runtime_h,
        cycles.get("drip_wall_fert", 0),
        cycles.get("drip_center_fert", 0),
        cycles.get("mister_south_fert", 0),
        cycles.get("mister_west_fert", 0),
        cycles.get("fert_master_valve", 0),
        irrigation_water_gal,
        fertigation_water_gal,
    )
    _, _, _, ct = await _apply_resource_cost_gate(
        conn,
        target_day,
        kwh=kwh,
        therms=therms,
        water_gal=planning_water_gal,
    )
    # Partial-channel diagnostic only; no whole-house or model-subtraction claim.
    # A corrected NULL/no-row must clear an older unqualified summary value.
    await refresh_partial_energy(conn, target_day, GREENHOUSE_ID)

    temp_max = float(climate["temp_max"]) if climate and climate["temp_max"] else 0.0
    # The band refresh (migration 290) owns compliance_pct; report its latest copy.
    compliance_pct = await conn.fetchval("SELECT compliance_pct FROM daily_summary WHERE date = $1", target_day)
    return ct, temp_max, (float(compliance_pct) if compliance_pct is not None else None)


async def daily_summary_live(pool: asyncpg.Pool) -> None:
    """Update recent daily_summary rows with live running aggregates.

    Two-writer contract (paired with ingestor.py::write_daily_summary):
      - `write_daily_summary` owns the midnight UPSERT of raw ESP32 accumulators.
      - This function owns the 30-min UPDATE of derived aggregates:
        climate min/max/avg, min_dp_margin_f, dp_risk_hours, kwh_estimated, therms_estimated,
        cost_electric/gas/water/total. It also rewrites cycles/runtimes
        computed from equipment_state transitions — which overrides the
        midnight ESP32-accumulator values for the current day (intentional:
        equipment-state-derived is the higher-fidelity source).

      Temperature/VPD compliance and stress hours are the database's served-band grade (migration 290);
      this task does not write them. Water cost uses planning water only (#1623).
    """
    async with pool.acquire() as conn:
        today = await conn.fetchval("SELECT (now() AT TIME ZONE 'America/Denver')::date")
        refreshed = []
        for offset in (0, 1):
            day = today - _td(days=offset)
            ct, temp_max, compliance_pct = await _refresh_daily_summary_for_date(conn, day)
            refreshed.append((day, ct, temp_max, compliance_pct))

    latest_day, ct, temp_max, compliance_pct = refreshed[0]
    log.info(
        "Daily summary live: %s eligible-cost=%s, %.1f°F max, compliance %s (yesterday also refreshed)",
        latest_day,
        f"${ct:.2f}" if ct is not None else "unavailable",
        temp_max,
        f"{compliance_pct:.1f}%" if compliance_pct is not None else "unavailable",
    )
