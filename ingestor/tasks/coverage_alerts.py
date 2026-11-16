"""Alert coverage, host release 2 (RULINGS N3c, Q4; contracts/alert-coverage.md).

Each check is one bounded read and one pure function. Every alert here is a warning (it does not page). A failing
read logs, skips its alert and keeps its open rows open; it never ends the monitor pass.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence

log = logging.getLogger("ingestor.alerts.coverage")

_READ_FAILED = object()


async def _read(conn, sql: str, *args, many: bool = False):
    try:
        return await (conn.fetch(sql, *args) if many else conn.fetchrow(sql, *args))
    except Exception as e:  # noqa: BLE001 - one failing read must not end the pass
        log.warning("coverage alert read failed: %s", e)
        return _READ_FAILED


def _warning(alert_type: str, sensor_id: str, category: str, message: str, details: dict, metric=None, threshold=None):
    return {
        "alert_type": alert_type,
        "severity": "warning",
        "category": category,
        "sensor_id": sensor_id,
        "zone": None,
        "message": message,
        "details": details,
        "metric_value": metric,
        "threshold_value": threshold,
    }


# ── Gap 2: a forbidden relay pair held 5 minutes ─────────────────────────────
# The furnace (heat2) with the vent open, or an exhaust fan with the vent closed, held 5 minutes (2 minutes would have
# opened one row in 14 days: fan2 ran 3 min before the vent opened, 2026-11-05). Latest state per relay; the pair
# has held since the later of the two edges.
FORBIDDEN_PAIR_HELD_S = 300.0
_PAIR_RELAYS = ["fan1", "fan2", "heat2", "vent"]
FORBIDDEN_PAIR_SQL = """
SELECT DISTINCT ON (equipment) equipment, state, EXTRACT(EPOCH FROM now() - ts)::double precision AS age_s
  FROM equipment_state
 WHERE equipment = ANY($1::text[]) AND ts > now() - interval '7 days'
 ORDER BY equipment, ts DESC
"""


def forbidden_pair_alert(rows: Sequence[Mapping]) -> dict | None:
    s = {r["equipment"]: (bool(r["state"]), float(r["age_s"])) for r in rows}
    if "vent" not in s:
        return None
    vent_open, vent_age = s["vent"]
    pairs = []
    if vent_open and s.get("heat2", (False, 0.0))[0]:
        pairs.append(("heat2", "vent open", min(vent_age, s["heat2"][1])))
    if not vent_open:
        for fan in ("fan1", "fan2"):
            if s.get(fan, (False, 0.0))[0]:
                pairs.append((fan, "vent closed", min(vent_age, s[fan][1])))
    held = [p for p in pairs if p[2] >= FORBIDDEN_PAIR_HELD_S]
    if not held:
        return None
    names = ", ".join(f"{relay} with the {vent}" for relay, vent, _ in held)
    return _warning(
        "relay_pair_forbidden",
        "equipment.relay_pair",
        "equipment",
        f"Forbidden relay pair held: {names}",
        {
            "pairs": [f"{relay}+{vent.replace(' ', '_')}" for relay, vent, _ in held],
            "held_s": round(max(p[2] for p in held), 1),
        },
        round(max(p[2] for p in held), 1),
        FORBIDDEN_PAIR_HELD_S,
    )


# ── Gap 3: no outdoor source for 15 minutes ──────────────────────────────────
OUTDOOR_NONE_AFTER_S = 900.0
OUTDOOR_SOURCE_SQL = """
WITH r AS (
    SELECT ts, value FROM system_state WHERE entity = 'outdoor_source' AND ts > now() - interval '2 hours'
), ok AS (SELECT max(ts) AS t FROM r WHERE value <> 'none')
SELECT (SELECT value FROM r ORDER BY ts DESC LIMIT 1) AS current,
       EXTRACT(EPOCH FROM now() - (SELECT max(ts) FROM r))::double precision AS newest_age_s,
       EXTRACT(EPOCH FROM now() - (SELECT min(r.ts) FROM r, ok
                                    WHERE r.value = 'none' AND r.ts > COALESCE(ok.t, '-infinity')))::double precision
           AS none_age_s
"""


def outdoor_source_alert(row: Mapping | None) -> dict | None:
    if not row or row["current"] != "none" or row["none_age_s"] is None or row["newest_age_s"] is None:
        return None
    if row["newest_age_s"] > 600 or row["none_age_s"] < OUTDOOR_NONE_AFTER_S:
        return None
    return _warning(
        "outdoor_source_none",
        "system.outdoor_source",
        "sensor",
        "No outdoor reading: neither the weather station nor the intake probe is valid",
        {"none_s": round(float(row["none_age_s"]), 1)},
        round(float(row["none_age_s"]), 1),
        OUTDOOR_NONE_AFTER_S,
    )


# ── Gap 6: running on the case sensor only ───────────────────────────────────
CASE_ONLY_SQL = """
SELECT count(*)::int AS rows,
       count(*) FILTER (WHERE COALESCE(temp_north, temp_south, temp_east, temp_west) IS NOT NULL)::int AS wall_rows,
       count(temp_case)::int AS case_rows
  FROM climate WHERE ts > now() - interval '10 minutes'
"""


def case_only_alert(row: Mapping | None) -> dict | None:
    if not row or row["rows"] < 3 or row["wall_rows"] > 0 or row["case_rows"] == 0:
        return None
    return _warning(
        "case_sensor_only",
        "climate.wall_probes",
        "sensor",
        "Every wall probe silent for 10 minutes: the controller runs on the case sensor only",
        {"rows": int(row["rows"]), "case_rows": int(row["case_rows"])},
        0.0,
        None,
    )


# ── Gap 16: a boot left the boot grace or the furnace wait stuck ─────────────
BOOT_STUCK_UPTIME_S = 300.0
BOOT_STUCK_SQL = """
SELECT (SELECT value FROM system_state WHERE entity = 'mode_reason' AND ts > now() - interval '7 days'
         ORDER BY ts DESC LIMIT 1) AS mode_reason,
       (SELECT uptime_s FROM diagnostics WHERE ts > now() - interval '10 minutes' AND uptime_s IS NOT NULL
         ORDER BY ts DESC LIMIT 1) AS uptime_s
"""


def boot_stuck_alert(row: Mapping | None) -> dict | None:
    if not row or row["mode_reason"] != "init" or row["uptime_s"] is None:
        return None
    if float(row["uptime_s"]) <= BOOT_STUCK_UPTIME_S:
        return None
    return _warning(
        "boot_stuck",
        "system.mode_reason",
        "system",
        f"Controller still in its boot state {int(row['uptime_s'])} s after starting",
        {"uptime_s": float(row["uptime_s"])},
        float(row["uptime_s"]),
        BOOT_STUCK_UPTIME_S,
    )


# ── Gap 5: the greenhouse power meters silent ────────────────────────────────
# Liveness, not usable samples: any sample not 'unavailable'. The meters report on change, so an idle circuit can
# go 35 min without an 'ok' sample (92 gaps over 15 min in 14 days); any-quality gaps peaked at 20 min (0 over 30).
POWER_STALE_AFTER_S = 1800.0
POWER_METER_SQL = """
SELECT EXTRACT(EPOCH FROM now() - max(ch0_source_ts) FILTER (WHERE ch0_quality IS DISTINCT FROM 'unavailable'))::double precision AS ch0_age_s,
       EXTRACT(EPOCH FROM now() - max(ch1_source_ts) FILTER (WHERE ch1_quality IS DISTINCT FROM 'unavailable'))::double precision AS ch1_age_s
  FROM energy WHERE ts > now() - interval '6 hours'
"""


def power_meter_alert(row: Mapping | None) -> dict | None:
    if not row:
        return None
    stale = {
        ch: (None if row[f"{ch}_age_s"] is None else round(float(row[f"{ch}_age_s"]), 1))
        for ch in ("ch0", "ch1")
        if row[f"{ch}_age_s"] is None or float(row[f"{ch}_age_s"]) > POWER_STALE_AFTER_S
    }
    if not stale:
        return None
    return _warning(
        "power_meter_stale",
        "energy.greenhouse_meters",
        "sensor",
        f"Greenhouse power meter channel(s) {', '.join(sorted(stale))} without a sample for 30 minutes "
        "(heat_no_power cannot judge the heater meanwhile)",
        {"channels": sorted(stale), "age_s": stale},
        None,
        POWER_STALE_AFTER_S,
    )


# ── Gap 8: yesterday's daily record or compliance row missing after 06:00 local ──
DAILY_RECORD_SQL = """
SELECT (now() AT TIME ZONE 'America/Denver')::time >= time '06:00' AS after_six,
       (now() AT TIME ZONE 'America/Denver')::date - 1 AS day,
       EXISTS (SELECT 1 FROM daily_record
                WHERE date = (now() AT TIME ZONE 'America/Denver')::date - 1) AS record,
       EXISTS (SELECT 1 FROM daily_band_compliance
                WHERE date = (now() AT TIME ZONE 'America/Denver')::date - 1) AS compliance
"""


def daily_record_alert(row: Mapping | None) -> dict | None:
    if not row or not row["after_six"] or (row["record"] and row["compliance"]):
        return None
    missing = [name for name in ("record", "compliance") if not row[name]]
    return _warning(
        "daily_record_missing",
        "system.daily_record",
        "system",
        f"Yesterday's ({row['day']}) daily {' and '.join(missing)} not written",
        {"day": row["day"].isoformat(), "missing": missing},
        None,
        None,
    )


# ── Gap 7: house temperature outside the band beyond a limit ─────────────────
# 90 % of the last 60 minutes' rows more than 3 F outside the served temperature band (house_band_drift reads VPD).
TEMP_BAND_MARGIN_F = 3.0
TEMP_BAND_MIN_ROWS = 30
TEMP_BAND_SQL = """
WITH b AS (SELECT fn_crop_band_value('house', 'temp_low', now()) AS lo,
                  fn_crop_band_value('house', 'temp_high', now()) AS hi),
r AS (SELECT temp_avg FROM climate WHERE ts > now() - interval '60 minutes' AND temp_avg IS NOT NULL)
SELECT b.lo, b.hi, count(r.*)::int AS total,
       count(*) FILTER (WHERE r.temp_avg < b.lo - $1)::int AS cold,
       count(*) FILTER (WHERE r.temp_avg > b.hi + $1)::int AS hot,
       avg(r.temp_avg) AS mean_f
  FROM b LEFT JOIN r ON true
 GROUP BY b.lo, b.hi
"""


def temp_band_alert(row: Mapping | None) -> dict | None:
    if not row or row["lo"] is None or row["hi"] is None or row["total"] < TEMP_BAND_MIN_ROWS:
        return None
    total = row["total"]
    side = "cold" if row["cold"] >= row["hot"] else "hot"
    frac = row[side] / total
    if frac < 0.9:
        return None
    return _warning(
        "house_temp_band_drift",
        "climate.temp_avg",
        "climate",
        f"House {'below' if side == 'cold' else 'above'} its temperature band by more than {TEMP_BAND_MARGIN_F:g} F "
        f"for most of the last hour (mean {float(row['mean_f']):.1f} F, band {float(row['lo']):.1f} to "
        f"{float(row['hi']):.1f} F)",
        {
            "side": side,
            "fraction": round(frac, 2),
            "band_low": round(float(row["lo"]), 2),
            "band_high": round(float(row["hi"]), 2),
        },
        round(float(row["mean_f"]), 2),
        TEMP_BAND_MARGIN_F,
    )


# ── Gap 1: relay starts per hour above the rollback criteria ─────────────────
RELAY_START_LIMITS = {"heat1": 12, "heat2": 12, "fan1": 12, "fan2": 12, "vent": 12, "fog": 15}
RELAY_STARTS_SQL = """
SELECT equipment, count(*)::int AS starts
  FROM (SELECT equipment, ts, state, lag(state) OVER (PARTITION BY equipment ORDER BY ts) AS prev
          FROM equipment_state
         WHERE equipment = ANY($1::text[]) AND ts > now() - interval '70 minutes') s
 WHERE state AND prev = false AND ts > now() - interval '60 minutes'
 GROUP BY equipment
"""


def relay_starts_alert(rows: Sequence[Mapping]) -> dict | None:
    over = {
        r["equipment"]: int(r["starts"])
        for r in rows
        if int(r["starts"]) > RELAY_START_LIMITS.get(r["equipment"], 10**6)
    }
    if not over:
        return None
    return _warning(
        "relay_starts_high",
        "equipment.relay_starts",
        "equipment",
        "Relay starts in the last hour above the rollback criteria: "
        + ", ".join(f"{k} {v} (limit {RELAY_START_LIMITS[k]})" for k, v in sorted(over.items())),
        {"starts": over},
        float(max(over.values())),
        None,
    )


COVERAGE_TYPES = (
    "relay_pair_forbidden",
    "outdoor_source_none",
    "case_sensor_only",
    "boot_stuck",
    "power_meter_stale",
    "daily_record_missing",
    "house_temp_band_drift",
    "relay_starts_high",
)

_CHECKS = (
    ("relay_pair_forbidden", FORBIDDEN_PAIR_SQL, (_PAIR_RELAYS,), True, forbidden_pair_alert),
    ("outdoor_source_none", OUTDOOR_SOURCE_SQL, (), False, outdoor_source_alert),
    ("case_sensor_only", CASE_ONLY_SQL, (), False, case_only_alert),
    ("boot_stuck", BOOT_STUCK_SQL, (), False, boot_stuck_alert),
    ("power_meter_stale", POWER_METER_SQL, (), False, power_meter_alert),
    ("daily_record_missing", DAILY_RECORD_SQL, (), False, daily_record_alert),
    ("house_temp_band_drift", TEMP_BAND_SQL, (TEMP_BAND_MARGIN_F,), False, temp_band_alert),
    ("relay_starts_high", RELAY_STARTS_SQL, (sorted(RELAY_START_LIMITS),), True, relay_starts_alert),
)


async def coverage_cycle(conn) -> tuple[list[dict], frozenset[str]]:
    """Every coverage check once. Returns the envelopes and the types to keep open because their read failed."""
    alerts, failed = [], set()
    for alert_type, sql, args, many, judge in _CHECKS:
        got = await _read(conn, sql, *args, many=many)
        if got is _READ_FAILED:
            failed.add(alert_type)
            continue
        envelope = judge(got)
        if envelope is not None:
            alerts.append(envelope)
    return alerts, frozenset(failed)


# ── soil_dryout: hysteresis and offline probes (contracts/alert-coverage.md, Noise) ──
SOIL_DRYOUT_RESOLVE_ABOVE_WILT = 1.0
SOIL_OPEN_ROWS_SQL = """
SELECT alert_type, sensor_id FROM alert_log
 WHERE alert_type IN ('soil_dryout', 'soil_sensor_offline', 'sensor_offline')
   AND resolved_at IS NULL AND disposition IN ('open', 'acknowledged')
"""


def soil_probe_offline(open_rows: Sequence[Mapping], probe_sensor_id: str, col: str) -> bool:
    """True when the probe (``soil.south_1``) or its column has an open offline row: no dryout judgement then."""
    names = {probe_sensor_id, f"{probe_sensor_id}.{col}", f"climate.{col}"}
    return any(r["alert_type"] != "soil_dryout" and r["sensor_id"] in names for r in open_rows)


def soil_dryout_hold(
    open_rows: Sequence[Mapping], key_sensor_id: str, latest_pct: float | None, wilt_pct: float
) -> bool:
    """An open soil_dryout row stays open until the probe reads at least 1 point above wilt (no flap at the line)."""
    is_open = any(r["alert_type"] == "soil_dryout" and r["sensor_id"] == key_sensor_id for r in open_rows)
    return is_open and latest_pct is not None and latest_pct < wilt_pct + SOIL_DRYOUT_RESOLVE_ABOVE_WILT
