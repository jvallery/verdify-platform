"""Alert coverage, host releases 2 and 3 (RULINGS N3c, Q4; contracts/alert-coverage.md).

Each check is one bounded read and one pure function. Every alert here is a warning (it does not page) except
reviewer_wrote_climate (gap 9, critical) and relay_counters_backstep (gap 19, info). A failing read logs, skips its
alert and keeps its open rows open; it never ends the monitor pass.
"""

from __future__ import annotations

import json
import logging
import statistics
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta

log = logging.getLogger("ingestor.alerts.coverage")

_READ_FAILED = object()


async def _read(conn, sql: str, *args, many: bool = False):
    try:
        return await (conn.fetch(sql, *args) if many else conn.fetchrow(sql, *args))
    except Exception as e:  # noqa: BLE001 - one failing read must not end the pass
        log.warning("coverage alert read failed: %s", e)
        return _READ_FAILED


def _warning(alert_type: str, sensor_id: str, category: str, message: str, details: dict, metric=None, threshold=None):
    return _alert("warning", alert_type, sensor_id, category, message, details, metric, threshold)


def _alert(severity, alert_type, sensor_id, category, message, details, metric=None, threshold=None):
    return {
        "alert_type": alert_type,
        "severity": severity,
        "category": category,
        "sensor_id": sensor_id,
        "zone": None,
        "message": message,
        "details": details,
        "metric_value": metric,
        "threshold_value": threshold,
    }


def _critical(alert_type: str, sensor_id: str, category: str, message: str, details: dict, metric=None, threshold=None):
    return {**_warning(alert_type, sensor_id, category, message, details, metric, threshold), "severity": "critical"}


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
    # Critical, it pages (ruling AA1): the owner's safeguard 2 of the last-resort thermometer note.
    return _critical(
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
    h3_alerts, h3_failed = await coverage_cycle_h3(conn)
    return alerts + h3_alerts, frozenset(failed) | h3_failed


# ══ Host release 3 (RULINGS Q4: gap 9 critical; 4, 11 to 14, 18 warnings; 19 info) ══════════════════════════════
# Gap 15 (WiFi weak) is the Prometheus rule VerdifyControllerWifiWeak on verdify_controller_wifi_rssi_dbm, with the
# threshold of contracts/controller-hardware-budget.md (RULINGS V4); it needs no alert_log type.


def _law(value) -> dict | None:
    """A climate_law_state / climate_drying_meter / relay_counters payload of version 1, else None."""
    try:
        payload = json.loads(value) if isinstance(value, str) else value
    except ValueError:
        return None
    return payload if isinstance(payload, dict) and payload.get("v") == 1 else None


def restarted_between(earlier: datetime, later: datetime, boots: Sequence[Mapping]) -> bool:
    """True when a diagnostics row up to 2 min after ``later`` reports an uptime shorter than the time since
    ``earlier``: the controller booted in between, so its since-boot counters started again from 0."""
    for row in boots:
        ts, uptime = row["ts"], row["uptime_s"]
        if uptime is None or ts <= earlier or ts > later + timedelta(seconds=120):
            continue
        if float(uptime) < (ts - earlier).total_seconds():
            return True
    return False


def counter_backsteps(rows: Sequence[Mapping], keys: Sequence[str], boots: Sequence[Mapping]) -> dict[str, list]:
    """Keys whose value fell between consecutive rows with no restart between them: {key: [before, after]}."""
    out: dict[str, list] = {}
    ordered = [(r["ts"], _law(r["value"])) for r in sorted(rows, key=lambda r: r["ts"])]
    ordered = [(ts, payload) for ts, payload in ordered if payload is not None]
    for (t1, a), (t2, b) in zip(ordered, ordered[1:], strict=False):
        for key in keys:
            x, y = a.get(key), b.get(key)
            if isinstance(x, int | float) and isinstance(y, int | float) and y < x:
                if not restarted_between(t1, t2, boots):
                    out.setdefault(key, [x, y])
    return out


_BOOTS_SQL = """
SELECT ts, uptime_s FROM diagnostics WHERE ts > now() - interval '35 minutes' AND uptime_s IS NOT NULL ORDER BY ts
"""


# ── Gap 9: the reviewer wrote a climate value (CRITICAL, pages) ──────────────
# contracts/reviewer.md "Retired setpoint_changes sources": after the H3 sync no code writes source 'plan' or 'iris'.
# The cutover is the first ingestor_counters row in system_state, which only release 3 ingestor code writes (its
# liveness pass), plus a 10 minute grace: a plan row the release 2 dispatcher wrote before its pod stopped is never
# judged. The ingestor runtime role reads system_state and setpoint_changes; it cannot read schema_migrations
# (ALERTS-1). Before the first counters row nothing is judged. The marker is searched over 8 days, past the 7 days
# rows stay in view, so the read stays bounded on the (entity, ts) index.
REVIEWER_CUTOVER_ENTITY = "ingestor_counters"
REVIEWER_CUTOVER_GRACE = "10 minutes"
REVIEWER_WRITE_SQL = f"""
WITH cut AS (
    SELECT min(ts) + interval '{REVIEWER_CUTOVER_GRACE}' AS t FROM system_state
     WHERE entity = '{REVIEWER_CUTOVER_ENTITY}' AND ts > now() - interval '8 days'
)
SELECT (SELECT t FROM cut) AS cutover, count(c.ts)::int AS n, max(c.ts) AS newest,
       array_remove(array_agg(DISTINCT c.parameter), NULL) AS parameters,
       array_remove(array_agg(DISTINCT c.source), NULL) AS sources
  FROM cut JOIN setpoint_changes c
    ON c.source IN ('plan', 'iris') AND c.ts > cut.t AND c.ts > now() - interval '7 days'
"""


def reviewer_write_alert(row: Mapping | None) -> dict | None:
    if not row or row["cutover"] is None or not row["n"]:
        return None
    parameters = sorted(row["parameters"] or [])[:20]
    return _alert(
        "critical",
        "reviewer_wrote_climate",
        "setpoint.reviewer_write",
        "system",
        f"A retired writer wrote {row['n']} climate setting row(s) after the H3 cutover "
        f"(sources {', '.join(sorted(row['sources'] or []))}; {', '.join(parameters)}): the daily reviewer must "
        "never set a climate value",
        {
            "rows": int(row["n"]),
            "sources": sorted(row["sources"] or []),
            "parameters": parameters,
            "newest": row["newest"].isoformat(),
            "cutover": row["cutover"].isoformat(),
        },
        float(row["n"]),
        0.0,
    )


# ── Gap 4: the law's state record stale while the controller is connected ────
# Gated on the law firmware having been installed (a climate_law_state row in the last 7 days), on the controller
# being connected (a diagnostics row in 2 min) and on the 60 s boot grace being over (uptime past 240 s). The build
# running now is judged when it is the one that published the newest law record, or when it is new: first reported
# after that record. Only a build the controller reported before the newest law record and that is not the law build
# is left alone: a rollback to a build without the law (release 3 review ALERTS-4; #1734 C-2, so a new build that
# never publishes a law record raises). The rollback lookback is 30 days of diagnostics.
LAW_STALE_AFTER_S = 180.0
LAW_STATE_SQL = """
WITH law AS (
  SELECT max(s.ts) AS ts FROM system_state s
   WHERE s.entity = 'climate_law_state' AND s.ts > now() - interval '7 days'
), fw AS (
  SELECT (SELECT d.firmware_version FROM diagnostics d
           WHERE d.ts > now() - interval '7 days' AND d.firmware_version IS NOT NULL
           ORDER BY d.ts DESC LIMIT 1) AS fw_now,
         (SELECT d.firmware_version FROM diagnostics d, law
           WHERE d.firmware_version IS NOT NULL AND d.ts > now() - interval '8 days' AND d.ts <= law.ts
           ORDER BY d.ts DESC LIMIT 1) AS fw_law
)
SELECT (SELECT EXTRACT(EPOCH FROM now() - law.ts)::double precision FROM law) AS law_age_s,
       (SELECT EXTRACT(EPOCH FROM now() - d.ts)::double precision FROM diagnostics d
         WHERE d.ts > now() - interval '10 minutes' ORDER BY d.ts DESC LIMIT 1) AS diag_age_s,
       (SELECT d.uptime_s FROM diagnostics d
         WHERE d.ts > now() - interval '10 minutes' AND d.uptime_s IS NOT NULL ORDER BY d.ts DESC LIMIT 1) AS uptime_s,
       fw.fw_now,
       fw.fw_law,
       CASE WHEN fw.fw_now IS NOT NULL AND fw.fw_now IS DISTINCT FROM fw.fw_law THEN
         EXISTS (SELECT 1 FROM diagnostics d, law
                  WHERE d.firmware_version = fw.fw_now AND d.ts > now() - interval '30 days' AND d.ts <= law.ts)
       END AS fw_now_before_law
  FROM fw
"""


def law_state_alert(row: Mapping | None) -> dict | None:
    if not row or row["law_age_s"] is None or row["diag_age_s"] is None or row["uptime_s"] is None:
        return None
    if row["fw_now"] is None:
        return None  # no version reported: nothing says which build runs
    if row["fw_now"] != row["fw_law"] and row["fw_now_before_law"]:
        return None  # a build reported before the newest law record, not the law build: a rollback
    age = float(row["law_age_s"])
    if age <= LAW_STALE_AFTER_S or float(row["diag_age_s"]) > 120 or float(row["uptime_s"]) <= 240:
        return None
    return _warning(
        "law_state_stale",
        "system.climate_law_state",
        "system",
        f"No climate law state record for {int(age)} s while the controller is connected",
        {"age_s": round(age, 1), "uptime_s": float(row["uptime_s"])},
        round(age, 1),
        LAW_STALE_AFTER_S,
    )


# ── Gap 11: fog or misters running while house VPD is below the band ────────
WETTING_RELAYS = ["fog", "mister_south", "mister_west", "mister_center"]
WETTING_HELD_S = 300.0
WETTING_SQL = """
WITH b AS (SELECT fn_crop_band_value('house', 'vpd_low', now()) AS vlo),
r AS (SELECT vpd_avg FROM climate WHERE ts > now() - interval '5 minutes' AND vpd_avg IS NOT NULL),
s AS (SELECT DISTINCT ON (equipment) equipment, state, EXTRACT(EPOCH FROM now() - ts)::double precision AS age_s
        FROM equipment_state WHERE equipment = ANY($1::text[]) AND ts > now() - interval '7 days'
       ORDER BY equipment, ts DESC)
SELECT b.vlo, (SELECT count(*) FROM r)::int AS total, (SELECT count(*) FROM r WHERE r.vpd_avg < b.vlo)::int AS below,
       (SELECT max(r.vpd_avg) FROM r) AS vpd_max,
       (SELECT array_agg(s.equipment ORDER BY s.equipment) FROM s WHERE s.state AND s.age_s >= $2) AS running
  FROM b
"""


def wetting_alert(row: Mapping | None) -> dict | None:
    if not row or row["vlo"] is None or not row["running"] or row["total"] < 3 or row["below"] < row["total"]:
        return None
    return _warning(
        "wetting_below_vpd_band",
        "equipment.wetting",
        "climate",
        f"{', '.join(row['running'])} running for 5 minutes while house VPD (at most {float(row['vpd_max']):.2f} kPa) "
        f"is below the band's low edge {float(row['vlo']):.2f} kPa",
        {"relays": list(row["running"]), "vpd_max": float(row["vpd_max"]), "vpd_low": float(row["vlo"])},
        float(row["vpd_max"]),
        float(row["vlo"]),
    )


# ── Gap 12: the drying meter stepping back, or not growing during a drying run ─
DRYING_KEYS = ("s", "g", "wh", "rw")
LAW_RUN_BIT = 1 << 8  # climate_law_state l bit8: a drying run is on
DRYING_STALL_S = 600.0
DRYING_SQL = """
SELECT entity, ts, value FROM system_state
 WHERE entity IN ('climate_drying_meter', 'climate_law_state') AND ts > now() - interval '30 minutes'
 ORDER BY ts
"""


def drying_meter_alert(rows: Sequence[Mapping], boots: Sequence[Mapping]) -> dict | None:
    meter = [r for r in rows if r["entity"] == "climate_drying_meter"]
    law = [(r["ts"], _law(r["value"])) for r in rows if r["entity"] == "climate_law_state"]
    back = counter_backsteps(meter, DRYING_KEYS, boots)
    stalled = None
    if law and meter:
        newest = max(ts for ts, _ in law)
        recent = [p for ts, p in law if ts > newest - timedelta(minutes=15)]
        running = len(recent) >= 10 and all(
            p is not None and isinstance(p.get("l"), int) and p["l"] & LAW_RUN_BIT for p in recent
        )
        window = [r for r in meter if r["ts"] > newest - timedelta(minutes=15)]
        values = [(r["ts"], (_law(r["value"]) or {}).get("s")) for r in window]
        values = [(ts, s) for ts, s in values if isinstance(s, int | float)]
        if running and len(values) >= 2 and (values[-1][0] - values[0][0]).total_seconds() >= DRYING_STALL_S:
            if values[-1][1] <= values[0][1] and not restarted_between(values[0][0], values[-1][0], boots):
                stalled = (values[-1][0] - values[0][0]).total_seconds()
    if not back and stalled is None:
        return None
    parts = []
    if back:
        parts.append("stepped back with no restart (" + ", ".join(sorted(back)) + ")")
    if stalled is not None:
        parts.append(f"did not grow for {int(stalled)} s of a drying run")
    return _warning(
        "drying_meter_fault",
        "system.climate_drying_meter",
        "system",
        "Drying meter " + " and ".join(parts),
        {"backsteps": back, "stalled_s": stalled},
        stalled,
        DRYING_STALL_S,
    )


# ── Gap 19: relay counters stepping back with no restart (info) ──────────────
RELAY_COUNTER_KEYS = ("h1", "h2", "f1", "f2", "fg", "vt", "f1s", "f2s")
RELAY_COUNTERS_SQL = """
SELECT ts, value FROM system_state WHERE entity = 'relay_counters' AND ts > now() - interval '30 minutes' ORDER BY ts
"""


def relay_counters_alert(rows: Sequence[Mapping], boots: Sequence[Mapping]) -> dict | None:
    back = counter_backsteps(rows, RELAY_COUNTER_KEYS, boots)
    if not back:
        return None
    return _alert(
        "info",
        "relay_counters_backstep",
        "equipment.relay_counters",
        "equipment",
        "Relay counters stepped back with no restart: " + ", ".join(sorted(back)),
        {"backsteps": back},
        None,
        None,
    )


# ── Gap 13: yesterday's utilities against the 30-day baseline; drying refused for cost all day ─
UTILITY_FACTOR = 1.5
UTILITY_MIN_DAYS = 10
METER_COVERAGE_MIN_PCT = 70.0
UTILITY_COLUMNS = {"electric_kwh": "kwh_metered_24h", "gas_therm": "therms_est", "water_gal": "water_gal"}
UTILITY_SQL = """
SELECT (now() AT TIME ZONE 'America/Denver')::time >= time '06:00' AS after_six,
       (now() AT TIME ZONE 'America/Denver')::date - 1 AS yesterday, date, kwh_metered_24h, therms_est, water_gal, meter_coverage_pct
  FROM daily_record
 WHERE date BETWEEN (now() AT TIME ZONE 'America/Denver')::date - 31 AND (now() AT TIME ZONE 'America/Denver')::date - 1
 ORDER BY date
"""


def _p95(values: Sequence[float]) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(0.95 * (len(ordered) - 1)))]


def utility_alert(rows: Sequence[Mapping]) -> dict | None:
    if not rows or not rows[-1]["after_six"]:
        return None
    day, base = rows[-1], rows[:-1]
    if day["date"] != day["yesterday"]:
        return None  # yesterday's record is missing: daily_record_missing speaks for it
    over: dict[str, list[float]] = {}
    for utility, column in UTILITY_COLUMNS.items():
        history = [float(r[column]) for r in base if r[column] is not None]
        if day[column] is None or len(history) < UTILITY_MIN_DAYS:
            continue
        limit = _p95(history) * UTILITY_FACTOR
        if float(day[column]) > limit > 0:
            over[utility] = [round(float(day[column]), 3), round(limit, 3)]
    coverage = None if day["meter_coverage_pct"] is None else float(day["meter_coverage_pct"])
    low = coverage is not None and coverage < METER_COVERAGE_MIN_PCT
    if not over and not low:
        return None
    parts = [f"{u} {v} above {lim}" for u, (v, lim) in sorted(over.items())]
    if low:
        parts.append(f"power meter covered {coverage:.0f} % of the day")
    return _warning(
        "utility_out_of_baseline",
        "system.daily_record",
        "system",
        f"Yesterday ({day['date']}): " + "; ".join(parts),
        {"day": day["date"].isoformat(), "over": over, "meter_coverage_pct": coverage},
        None,
        None,
    )


LAW_DRY_BIT = 1 << 6  # climate_law_state l bit6: drying wanted (VPD below the drying line)
DRYING_REFUSED_MIN_ROWS = 60
DRYING_REFUSED_SQL = """
SELECT (now() AT TIME ZONE 'America/Denver')::date - 1 AS day,
       count(*) FILTER (WHERE (value::jsonb ->> 'l')::int & 64 <> 0)::int AS wanted,
       count(*) FILTER (WHERE (value::jsonb ->> 'l')::int & 64 <> 0 AND value::jsonb ->> 'dr' = 'cost')::int AS cost
  FROM system_state
 WHERE entity = 'climate_law_state'
   AND ts >= ((now() AT TIME ZONE 'America/Denver')::date - 1)::timestamp AT TIME ZONE 'America/Denver'
   AND ts < ((now() AT TIME ZONE 'America/Denver')::date)::timestamp AT TIME ZONE 'America/Denver'
   AND value LIKE '{"v":1,%'
"""


def drying_refused_alert(row: Mapping | None) -> dict | None:
    if not row or row["wanted"] < DRYING_REFUSED_MIN_ROWS or row["cost"] < row["wanted"]:
        return None
    return _warning(
        "drying_refused_all_day",
        "system.climate_law_state",
        "climate",
        f"Yesterday ({row['day']}) the drying cost limit refused every one of {row['wanted']} wanted-drying records",
        {"day": row["day"].isoformat(), "wanted": int(row["wanted"]), "cost": int(row["cost"])},
        float(row["cost"]),
        None,
    )


# ── Gap 14: the wall probes disagreeing for 30 minutes ───────────────────────
# RULINGS (coordinator, 2026-11-16): 12 F spread sustained for 30 minutes, every probe included. The unshielded south
# probe reads up to about 10 F above the other walls on sunny mornings (a standing condition, recorded for the owner);
# a drifting or wild probe clears 12 F. 14-day backtest at 12 F: 0 of 673 half-hour windows (largest spread 14.4 F,
# never sustained). The off-median list only names the probe(s) to look at; it does not trigger.
PROBE_SPREAD_F = 12.0
PROBE_OFF_MEDIAN_F = 6.0
PROBE_MIN_ROWS = 20
WALL_PROBES = ("temp_north", "temp_south", "temp_east", "temp_west")
PROBES_SQL = """
SELECT temp_north, temp_south, temp_east, temp_west FROM climate WHERE ts > now() - interval '30 minutes'
"""


def probes_alert(rows: Sequence[Mapping]) -> dict | None:
    judged, bad, spreads, off = 0, 0, [], {}
    for row in rows:
        values = {p: float(row[p]) for p in WALL_PROBES if row[p] is not None}
        if len(values) < 3:
            continue
        judged += 1
        median = statistics.median(values.values())
        spread = max(values.values()) - min(values.values())
        outliers = [p for p, v in values.items() if abs(v - median) > PROBE_OFF_MEDIAN_F]
        if spread > PROBE_SPREAD_F:
            bad += 1
            spreads.append(spread)
            for p in outliers:
                off[p] = off.get(p, 0) + 1
    if judged < PROBE_MIN_ROWS or bad < 0.9 * judged:
        return None
    return _warning(
        "probes_disagree",
        "climate.wall_probes",
        "sensor",
        f"Wall temperature probes disagree for 30 minutes (spread up to {max(spreads):.1f} F"
        + (f"; off the median: {', '.join(sorted(off))}" if off else "")
        + ")",
        {"rows": judged, "disagreeing": bad, "max_spread_f": round(max(spreads), 2), "off_median": sorted(off)},
        round(max(spreads), 2),
        PROBE_SPREAD_F,
    )


# ── Gap 18: an owner-held value changed by something else ────────────────────
# The newest desired row for a setting (not an esp32 observation, not a smoke sentinel) is the owner's ('manual'),
# the controller confirmed it more than 15 minutes ago, and the readbacks have differed from it for 15 minutes: the
# newest readback differs and the first differing readback since the last matching one (or the confirmation) is over
# 15 minutes old. Readbacks are stored on change, so no count of rows in a window is required (release 3 review
# ALERTS-3).
# Held values older than 30 days are not watched (the dispatcher re-writes manual values in force). The four legacy
# band scalars are left out (unused under the on-chip band, K1).
OWNER_HELD_SQL = """
WITH held AS (
    SELECT DISTINCT ON (c.parameter) c.parameter, c.value, c.source, c.confirmed_at
      FROM setpoint_changes c
     WHERE c.ts > now() - interval '30 days' AND c.source <> 'esp32' AND c.source NOT LIKE 'smoke%'
       AND c.parameter NOT IN ('temp_low', 'temp_high', 'vpd_low', 'vpd_high')
       AND c.parameter IN (SELECT DISTINCT parameter FROM setpoint_changes
                            WHERE source = 'manual' AND ts > now() - interval '30 days')
     ORDER BY c.parameter, c.ts DESC
), judged AS (
    SELECT h.parameter, h.value AS held, d.first_differ, d.device
      FROM held h
     CROSS JOIN LATERAL (
            SELECT max(s.ts) AS last_same FROM setpoint_snapshot s
             WHERE s.parameter = h.parameter AND s.ts >= h.confirmed_at
               AND abs(s.value - h.value) <= greatest(0.001, abs(h.value) * 0.001)) m
     CROSS JOIN LATERAL (
            SELECT min(s.ts) AS first_differ, (array_agg(s.value ORDER BY s.ts DESC))[1] AS device
              FROM setpoint_snapshot s
             WHERE s.parameter = h.parameter AND s.ts >= h.confirmed_at AND s.ts > COALESCE(m.last_same, '-infinity')) d
     WHERE h.source = 'manual' AND h.confirmed_at < now() - interval '15 minutes'
)
SELECT parameter, held, device FROM judged
 WHERE first_differ < now() - interval '15 minutes' ORDER BY parameter LIMIT 20
"""


def owner_held_alert(rows: Sequence[Mapping]) -> dict | None:
    if not rows:
        return None
    changed = {r["parameter"]: [float(r["held"]), float(r["device"])] for r in rows}
    return _warning(
        "owner_value_changed",
        "setpoint.owner_held",
        "system",
        "Owner-held setting(s) changed on the controller by something else for 15 minutes: "
        + ", ".join(f"{k} held {v[0]:g}, reads {v[1]:g}" for k, v in sorted(changed.items())),
        {"changed": changed},
        float(len(changed)),
        None,
    )


# ── Safeguard 2 of contracts/last-resort-thermometer.md (RULINGS AA1; host release 3) ─────────────────────────────
# The note's table (section 4): "Outdoor source none | `Outdoor Source` = `none` | none | **page** when combined with
# any indoor degradation; warning alone", and the first failure it pairs with: "Indoor running on the case probe only
# (walls lost) | `sensor_degraded_active` true; each wall probe's columns go stale | ... | **page** on
# `sensor_degraded_active` for 10 min, or two or more wall probes stale". "Any indoor degradation" is read here as
# fewer than the full set of wall probes valid (Active Probe Count below 4, the firmware's count of fresh wall probes
# behind Avg Temp, on every diagnostics row of the 10 minutes) or the case probe alone (no wall probe value in the
# 10 minutes of climate rows). `sensor_degraded_active` is stored since release 3 (diagnostics.sensor_degraded_active)
# and pages on its own through monitoring-stack's VerdifyControllerSensorDegraded (critical, 1 for 10 minutes), so it
# is not judged again here. The page needs both held 10 minutes; the
# warning alone (outdoor_source_none) and the case-only page (case_sensor_only, HOST-LAW) stay as they are.
# No row opens while a reading is absent or unknown: the newest outdoor_source row must be at most 600 s old (it is
# stored on every receipt, every 300 s) with a value the contract names, and every diagnostics row of the window must
# carry a probe count (a reconnect or a build before phase 2 publishes nothing, so nothing opens).
OUTDOOR_SOURCES = ("station", "intake", "none")
OUTDOOR_FRESH_S = 600.0
BLIND_HELD_S = 600.0
OUTDOOR_BLIND_SQL = """
WITH r AS (
    SELECT ts, value FROM system_state WHERE entity = 'outdoor_source' AND ts > now() - interval '2 hours'
), ok AS (SELECT max(ts) AS t FROM r WHERE value <> 'none'),
d AS (SELECT count(*)::int AS diag_rows,
             count(*) FILTER (WHERE active_probe_count IS NULL)::int AS diag_unknown,
             count(*) FILTER (WHERE active_probe_count < 4)::int AS diag_short,
             min(active_probe_count)::int AS fewest
        FROM diagnostics WHERE ts > now() - interval '10 minutes'),
c AS (SELECT count(*)::int AS rows,
             count(*) FILTER (WHERE COALESCE(temp_north, temp_south, temp_east, temp_west) IS NOT NULL)::int AS wall_rows,
             count(temp_case)::int AS case_rows
        FROM climate WHERE ts > now() - interval '10 minutes')
SELECT (SELECT value FROM r ORDER BY ts DESC LIMIT 1) AS current,
       EXTRACT(EPOCH FROM now() - (SELECT max(ts) FROM r))::double precision AS newest_age_s,
       EXTRACT(EPOCH FROM now() - (SELECT min(r.ts) FROM r, ok
                                    WHERE r.value = 'none' AND r.ts > COALESCE(ok.t, '-infinity')))::double precision
           AS none_age_s,
       d.diag_rows, d.diag_unknown, d.diag_short, d.fewest, c.rows, c.wall_rows, c.case_rows
  FROM d, c
"""


def _outdoor_known(row: Mapping) -> bool:
    return (
        row["current"] in OUTDOOR_SOURCES
        and row["newest_age_s"] is not None
        and float(row["newest_age_s"]) <= OUTDOOR_FRESH_S
    )


def outdoor_blind_alert(row: Mapping | None) -> dict | None:
    if not row or not _outdoor_known(row) or row["current"] != "none" or row["none_age_s"] is None:
        return None
    if float(row["none_age_s"]) < BLIND_HELD_S:
        return None
    walls_short = row["diag_rows"] >= 3 and row["diag_unknown"] == 0 and row["diag_short"] == row["diag_rows"]
    case_only = row["rows"] >= 3 and row["wall_rows"] == 0 and row["case_rows"] > 0
    if not (walls_short or case_only):
        return None
    fewest = None if row["diag_unknown"] or row["fewest"] is None else int(row["fewest"])
    which = "case probe only" if case_only else f"{fewest} of 4 wall probes valid"
    return _alert(
        "critical",
        "outdoor_none_indoor_degraded",
        "system.outdoor_source",
        "sensor",
        "No outdoor reading and the indoor probes degraded for 10 minutes: one more failure leaves the controller "
        + f"blind ({which})",
        {"none_s": round(float(row["none_age_s"]), 1), "fewest_wall_probes": fewest, "case_only": case_only},
        round(float(row["none_age_s"]), 1),
        BLIND_HELD_S,
    )


# The note's table: "Outdoor on the intake probe only (station lost) | `Outdoor Source` = `intake` | none | warning
# after 30 min (the station or WiFi path is down, so only the bus is left)".
INTAKE_ONLY_AFTER_S = 1800.0
INTAKE_ONLY_SQL = """
WITH r AS (
    SELECT ts, value FROM system_state WHERE entity = 'outdoor_source' AND ts > now() - interval '2 hours'
), other AS (SELECT max(ts) AS t FROM r WHERE value <> 'intake')
SELECT (SELECT value FROM r ORDER BY ts DESC LIMIT 1) AS current,
       EXTRACT(EPOCH FROM now() - (SELECT max(ts) FROM r))::double precision AS newest_age_s,
       EXTRACT(EPOCH FROM now() - (SELECT min(r.ts) FROM r, other
                                    WHERE r.value = 'intake' AND r.ts > COALESCE(other.t, '-infinity')))::double precision
           AS intake_age_s
"""


def intake_only_alert(row: Mapping | None) -> dict | None:
    if not row or not _outdoor_known(row) or row["current"] != "intake" or row["intake_age_s"] is None:
        return None
    if float(row["intake_age_s"]) < INTAKE_ONLY_AFTER_S:
        return None
    return _warning(
        "outdoor_intake_only",
        "system.outdoor_source",
        "sensor",
        "Weather station broadcast missing for 30 minutes: the outdoor reading comes from the intake probe only, on "
        "the same sensor bus as every indoor probe",
        {"intake_s": round(float(row["intake_age_s"]), 1)},
        round(float(row["intake_age_s"]), 1),
        INTAKE_ONLY_AFTER_S,
    )


# The note's third row ("Bus watchdog restarts | uptime resets, logs | none | warning on two restarts within an
# hour") is not built: the host cannot tell a sensor-bus watchdog restart from any other software restart. Every
# restart path (the bus watchdog, the doubly blind restart, an OTA, the restart button, the heap guard) goes through
# esp_restart()/App.safe_reboot(), so Reset Reason reads "Software reset" for all of them, and the watchdog's
# ESP_LOGE line is written just before the restart and is not stored (esp32_logs holds WARN lines only). The missing
# reading is a restart cause the controller keeps across the restart and publishes after boot. Note also that the
# firmware cannot make two bus restarts within one hour: the plain rule waits 3,600 s, the doubly blind rule 10 min
# for the first and 60 min for each next one (lib/running_alone.h).


# ── vp#1670: the gas furnace cannot hold the band (RULINGS AA6; host release 3) ──────────────────────────────────
# https://github.com/jvallery/verdify-platform/issues/1670 . One warning when heat2 (the gas furnace, the backup
# behind the electric heat1) was on for at least 90 % of the last hour and the house's 10-minute mean is more than 1 F
# below the served band's low edge. heat2 rows are stored on change, so the state at the start of the hour comes
# from the newest row before it (within 7 days, else unknown and nothing opens), and the controller must be
# reporting (3 or more climate rows in 10 minutes), so a dark controller's last "on" does not count as running.
# Backtest (2026-11-16, 5-minute ticks): 2026-01-23 to 01-26, 199 of 1,153 ticks in 9 episodes; the 30 days to
# 2026-11-16, none of 8,641.
FURNACE_ON_FRACTION = 0.9
FURNACE_BELOW_BAND_F = 1.0
FURNACE_SQL = """
WITH prior AS (
    SELECT state FROM equipment_state
     WHERE equipment = 'heat2' AND ts <= now() - interval '1 hour' AND ts > now() - interval '7 days'
     ORDER BY ts DESC LIMIT 1
), ev AS (
    SELECT now() - interval '1 hour' AS ts, state FROM prior
    UNION ALL
    SELECT ts, state FROM equipment_state WHERE equipment = 'heat2' AND ts > now() - interval '1 hour'
), iv AS (SELECT ts, state, COALESCE(lead(ts) OVER (ORDER BY ts), now()) AS nxt FROM ev),
h AS (SELECT avg(temp_avg) AS house, count(*)::int AS house_rows
        FROM climate WHERE ts > now() - interval '10 minutes' AND temp_avg IS NOT NULL)
SELECT EXISTS (SELECT 1 FROM prior) AS known,
       (COALESCE((SELECT sum(EXTRACT(EPOCH FROM nxt - ts)) FROM iv WHERE state), 0) / 3600.0)::double precision
           AS on_fraction,
       fn_crop_band_value('house', 'temp_low', now()) AS lo, h.house, h.house_rows
  FROM h
"""


def furnace_alert(row: Mapping | None) -> dict | None:
    if not row or not row["known"] or row["lo"] is None or row["house"] is None or row["house_rows"] < 3:
        return None
    frac, house, lo = float(row["on_fraction"]), float(row["house"]), float(row["lo"])
    if frac < FURNACE_ON_FRACTION or house >= lo - FURNACE_BELOW_BAND_F:
        return None
    return _warning(
        "furnace_saturated",
        "equipment.heat2",
        "equipment",
        f"Gas furnace on {frac:.0%} of the last hour and the house still {lo - house:.1f} F below the band's low "
        f"edge ({house:.1f} F, band low {lo:.1f} F)",
        {"on_fraction": round(min(frac, 1.0), 3), "house_f": round(house, 2), "band_low_f": round(lo, 2)},
        round(lo - house, 2),
        FURNACE_BELOW_BAND_F,
    )


# ── Controller restarts (RULINGS AF8, verification finding OBS-F3; host release 3) ──────────────────────────────────
# A restart is a diagnostics row whose uptime is below the previous row's, or below the time since it (the controller
# booted after the previous report). Its boot time is the row's ts minus its uptime. The firmware version is the
# newest non-NULL one before the boot (24 h) and the first after it (30 min): the same version before and after is an
# unplanned restart, whatever the reset reason (the heap guard, the bus watchdog and the restart button all report
# "Software reset"); a changed version is a flash and stays quiet. A restart whose version after the boot is not
# stored yet, or with none stored in the 24 h before it, is not judged (the next pass judges it once the version
# arrives). One restart in the last 60 minutes warns; three or more page.
REBOOT_WINDOW_MIN = 60
REBOOT_CRITICAL_COUNT = 3
REBOOT_SQL = """
WITH d AS (
    SELECT ts, uptime_s, lag(ts) OVER w AS prev_ts, lag(uptime_s) OVER w AS prev_up
      FROM diagnostics
     WHERE ts > now() - interval '3 hours' AND uptime_s IS NOT NULL
    WINDOW w AS (ORDER BY ts)
), r AS (
    SELECT ts, ts - make_interval(secs => uptime_s) AS boot_ts, uptime_s
      FROM d
     WHERE prev_ts IS NOT NULL AND ts > now() - make_interval(mins => $1)
       AND (uptime_s < prev_up OR uptime_s + 30 < EXTRACT(EPOCH FROM ts - prev_ts))
)
SELECT r.ts, r.boot_ts, r.uptime_s,
       (SELECT firmware_version FROM diagnostics
         WHERE firmware_version IS NOT NULL AND ts < r.boot_ts AND ts > r.boot_ts - interval '24 hours'
         ORDER BY ts DESC LIMIT 1) AS fw_before,
       (SELECT firmware_version FROM diagnostics
         WHERE firmware_version IS NOT NULL AND ts >= r.boot_ts AND ts <= r.boot_ts + interval '30 minutes'
         ORDER BY ts LIMIT 1) AS fw_after,
       (SELECT reset_reason FROM diagnostics
         WHERE reset_reason IS NOT NULL AND ts >= r.boot_ts AND ts <= r.boot_ts + interval '30 minutes'
         ORDER BY ts LIMIT 1) AS reset_reason
  FROM r
 ORDER BY r.ts
"""


def reboot_alert(rows: Sequence[Mapping]) -> dict | None:
    unplanned = [r for r in rows if r["fw_before"] and r["fw_after"] and r["fw_before"] == r["fw_after"]]
    if not unplanned:
        return None
    newest = unplanned[-1]
    count = len(unplanned)
    reason = newest["reset_reason"] or "unknown"
    severity = "critical" if count >= REBOOT_CRITICAL_COUNT else "warning"
    return _alert(
        severity,
        "esp32_reboot",
        "diag.uptime_s",
        "system",
        f"Controller restarted without a flash ({reason}); {count} in the last {REBOOT_WINDOW_MIN} minutes on "
        f"{newest['fw_after']}",
        {
            "uptime_s": max(float(newest["uptime_s"]), 0.0),
            "reset_reason": reason,
            "restarts_60m": count,
            "firmware_version": newest["fw_after"],
        },
        float(count),
        float(REBOOT_CRITICAL_COUNT),
    )


async def reboot_check(conn) -> tuple[dict | None, frozenset[str]]:
    """The esp32_reboot envelope for alert_monitor block 6, and the types to keep open because the read failed."""
    rows = await _read(conn, REBOOT_SQL, REBOOT_WINDOW_MIN, many=True)
    if rows is _READ_FAILED:
        return None, frozenset({"esp32_reboot"})
    return reboot_alert(rows), frozenset()


# ── band_device_db_divergence, law-record branch (verification OBS-46/47; decision 6, plan 9) ─────────────────────
# Once the law runs, the band the controller enforces is climate_law_state `b` (temp low, temp high F; VPD low,
# high kPa), and the third flash removes the target entities the older branches read. Each of the newest three law
# records of the last 10 minutes is compared with fn_band_setpoints at its own time; the warning opens when all three
# are off by more than 1.0 F or 0.10 kPa (the OBS-47 tolerance), so one record at a curve knot does not open it.
# No climate_law_state row (every build before the law flash) or a newest record over 180 s old: this branch is
# silent and returns law_present False, and the target and edge branches judge as before.
LAW_BAND_TEMP_F = 1.0
LAW_BAND_VPD_KPA = 0.10
LAW_BAND_RECORDS = 3
LAW_BAND_FRESH_S = 180.0
LAW_BAND_SQL = """
SELECT s.ts, s.value, EXTRACT(EPOCH FROM now() - s.ts)::double precision AS age_s,
       b.temp_low, b.temp_high, b.vpd_low, b.vpd_high
  FROM (SELECT ts, value FROM system_state
         WHERE entity = 'climate_law_state' AND ts > now() - interval '10 minutes'
         ORDER BY ts DESC LIMIT 3) s
  CROSS JOIN LATERAL fn_band_setpoints(s.ts) b
 ORDER BY s.ts DESC
"""


def law_band_alert(rows: Sequence[Mapping]) -> tuple[dict | None, bool]:
    """(the law-branch band_device_db_divergence warning or None, whether a fresh law record exists)."""
    diffs = []
    for row in rows:
        law = _law(row["value"])
        band = law.get("b") if law else None
        edges = (row["temp_low"], row["temp_high"], row["vpd_low"], row["vpd_high"])
        if not isinstance(band, (list, tuple)) or len(band) != 4 or any(e is None for e in edges):
            continue
        try:
            t = max(abs(float(band[0]) - float(edges[0])), abs(float(band[1]) - float(edges[1])))
            v = max(abs(float(band[2]) - float(edges[2])), abs(float(band[3]) - float(edges[3])))
        except (TypeError, ValueError):
            continue
        diffs.append((t, v, float(row["age_s"])))
    if not diffs or diffs[0][2] > LAW_BAND_FRESH_S:
        return None, False
    off = [d for d in diffs if d[0] > LAW_BAND_TEMP_F or d[1] > LAW_BAND_VPD_KPA]
    if len(diffs) < LAW_BAND_RECORDS or len(off) < LAW_BAND_RECORDS:
        return None, True
    temp_d, vpd_d = max(d[0] for d in off), max(d[1] for d in off)
    return (
        _warning(
            "band_device_db_divergence",
            None,
            "climate",
            f"Band the controller enforces (law record) differs from the database band: max ΔT {temp_d:.2f} °F / "
            f"ΔVPD {vpd_d:.3f} kPa on the last {LAW_BAND_RECORDS} records (a clock fault or an unsynced band)",
            {
                "max_temp_abs_diff": round(temp_d, 3),
                "max_vpd_abs_diff": round(vpd_d, 3),
                "device_age_s": round(max(diffs[0][2], 0.0), 1),
            },
            round(max(temp_d / LAW_BAND_TEMP_F, vpd_d / LAW_BAND_VPD_KPA), 3),
            1.0,
        )
        | {"zone": "house"},
        True,
    )


# ── relay_counter_mismatch (RULINGS AF7): the controller's own relay counters against the stored edges ──────────────
# v_relay_counter_reconciliation_daily (migration 315) holds, per local day and relay, the starts (fans: and run
# seconds) summed from relay_counters deltas beside daily_relay_record's figures from the stored edges. The daily
# record stays the source; this only says the two disagree. Yesterday's complete rows only, so each relay warns at
# most once a day and the row closes at the next local midnight. Tolerance: the live data from the phase 2 flash
# (2026-11-16 19:48Z to 21:58Z: fog 3 and 3, heat1 1 and 1, the rest 0 and 0, fan run 0 and 0) agreed exactly; the
# allowance covers a start or a run that straddles midnight against the counters' sample cadence (about 25 min)
# and a restart's lost increments. Each controller boot of the day (317's `boots`) adds one start: a relay that is on
# across a reboot comes back off and is switched on again, a start the stored edges never show (#1734 C-10). A day
# whose record was computed before the day ended reads 'record_early' (317) and, like every other comparison but
# 'complete', is not judged. A day with fewer than 2 counter rows is not judged.
COUNTER_STARTS_ABS = 2
COUNTER_RUN_S_ABS = 1800
COUNTER_REL = 0.10
COUNTER_MIN_ROWS = 2
COUNTER_RECONCILE_SQL = """
SELECT date, equipment, counter_starts, record_starts, starts_difference,
       counter_run_s, record_run_s, run_s_difference, counter_rows, boots
  FROM v_relay_counter_reconciliation_daily
 WHERE greenhouse_id = 'vallery' AND comparison = 'complete'
   AND date = (now() AT TIME ZONE 'America/Denver')::date - 1
 ORDER BY equipment
"""


def counter_mismatch_alerts(rows: Sequence[Mapping]) -> list[dict]:
    """One relay_counter_mismatch warning per relay whose counter figures for yesterday are outside the tolerance."""
    out = []
    for r in rows:
        if r["counter_rows"] is None or int(r["counter_rows"]) < COUNTER_MIN_ROWS or r["record_starts"] is None:
            continue
        rec_starts = int(r["record_starts"])
        d_starts = abs(int(r["starts_difference"] or 0))
        starts_tol = max(COUNTER_STARTS_ABS, COUNTER_REL * rec_starts) + int(r.get("boots") or 0)
        d_run = abs(float(r["run_s_difference"])) if r["run_s_difference"] is not None else 0.0
        run_tol = max(COUNTER_RUN_S_ABS, COUNTER_REL * float(r["record_run_s"] or 0))
        if d_starts <= starts_tol and d_run <= run_tol:
            continue
        day, eq = str(r["date"]), str(r["equipment"])
        run = (
            f"; run {int(r['counter_run_s'])} s against {round(float(r['record_run_s'] or 0))} s"
            if r["counter_run_s"] is not None
            else ""
        )
        out.append(
            _warning(
                "relay_counter_mismatch",
                f"equipment.{eq}.counters.{day}",
                "equipment",
                f"{eq} on {day}: the controller counted {int(r['counter_starts'])} starts, the stored edges "
                f"{rec_starts}{run} (missed or extra relay events in the record)",
                {
                    "day": day,
                    "equipment": eq,
                    "counter_starts": int(r["counter_starts"]),
                    "record_starts": rec_starts,
                    "counter_run_s": int(r["counter_run_s"]) if r["counter_run_s"] is not None else None,
                    "record_run_s": round(float(r["record_run_s"]), 1) if r["record_run_s"] is not None else None,
                },
                round(max(d_starts / starts_tol, d_run / run_tol), 3),
                1.0,
            )
        )
    return out


H3_TYPES = (
    "reviewer_wrote_climate",
    "law_state_stale",
    "wetting_below_vpd_band",
    "drying_meter_fault",
    "relay_counters_backstep",
    "utility_out_of_baseline",
    "drying_refused_all_day",
    "probes_disagree",
    "owner_value_changed",
    "outdoor_none_indoor_degraded",
    "outdoor_intake_only",
    "furnace_saturated",
    "relay_counter_mismatch",
)


async def coverage_cycle_h3(conn) -> tuple[list[dict], frozenset[str]]:
    """The host release 3 checks; the counter checks share one read of the controller's boots."""
    alerts, failed = [], set()

    def judge(alert_type, got, fn, *extra):
        if got is _READ_FAILED:
            failed.add(alert_type)
            return
        envelope = fn(got, *extra)
        if envelope is not None:
            alerts.append(envelope)

    judge("reviewer_wrote_climate", await _read(conn, REVIEWER_WRITE_SQL), reviewer_write_alert)
    judge("law_state_stale", await _read(conn, LAW_STATE_SQL), law_state_alert)
    judge("wetting_below_vpd_band", await _read(conn, WETTING_SQL, WETTING_RELAYS, WETTING_HELD_S), wetting_alert)
    boots = await _read(conn, _BOOTS_SQL, many=True)
    for alert_type, sql, fn in (
        ("drying_meter_fault", DRYING_SQL, drying_meter_alert),
        ("relay_counters_backstep", RELAY_COUNTERS_SQL, relay_counters_alert),
    ):
        if boots is _READ_FAILED:
            failed.add(alert_type)
            continue
        judge(alert_type, await _read(conn, sql, many=True), fn, boots)
    judge("utility_out_of_baseline", await _read(conn, UTILITY_SQL, many=True), utility_alert)
    judge("drying_refused_all_day", await _read(conn, DRYING_REFUSED_SQL), drying_refused_alert)
    judge("probes_disagree", await _read(conn, PROBES_SQL, many=True), probes_alert)
    judge("owner_value_changed", await _read(conn, OWNER_HELD_SQL, many=True), owner_held_alert)
    judge("outdoor_none_indoor_degraded", await _read(conn, OUTDOOR_BLIND_SQL), outdoor_blind_alert)
    judge("outdoor_intake_only", await _read(conn, INTAKE_ONLY_SQL), intake_only_alert)
    judge("furnace_saturated", await _read(conn, FURNACE_SQL), furnace_alert)
    counters = await _read(conn, COUNTER_RECONCILE_SQL, many=True)
    if counters is _READ_FAILED:
        failed.add("relay_counter_mismatch")
    else:
        alerts.extend(counter_mismatch_alerts(counters))
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
