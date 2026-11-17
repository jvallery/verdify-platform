"""tasks.dispatcher — split from the monolithic tasks.py (issue #46).

Behaviour-preserving extraction; bodies are byte-identical to the
original module. The tasks package __init__ re-exports the public
surface so every `from tasks import X` still resolves.

Plain convergence (VD-62): an ordinary pass sends at most
``MAX_RECONNECT_COMMANDS`` commands, oldest difference first, and wakes the
next pass for the rest. It never stages, waits for an approval file or holds
on halted-run custody.

Desired state (VD-33): each pass also reads ``v_desired_state_current`` and,
through ``resolve_effective()``, lets a person's or an agent's value replace the
plan, band or default value of that parameter before the dedupe, through the
same fences; its pushes carry source ``manual``. A release with no plan, band or
dispatcher default returns the setting to its registry default.
"""

from entity_map import CFG_READBACK_MAP, SETPOINT_MAP
from esp32_push import (
    DeviceCommandOutcome,
    LifecyclePersistenceError,
    _experiment_hold_failure,
    component_bundle_hold,
    controller_omits_setting,
    delivery_failure_retryable,
    delivery_transition_prior_statuses,
    experiment_policy_hold,
    preserved_terminal_status,
    push_to_esp32_detailed,
)

# The readback comparators moved to verdify_schemas (VD-29). Callers still load
# both names from tasks.dispatcher, and ingestor.py takes readback_abs_tolerance
# through the tasks star import, so they stay importable from here.
from verdify_schemas.setting_values import (
    readback_abs_tolerance,  # noqa: F401 - re-exported for tasks.readback_abs_tolerance
    readback_matches,
    readback_values_equivalent,
    resolve_effective,
    within_relative_deadband,
)
from verdify_schemas.telemetry import SystemStateRow
from verdify_schemas.tunable_registry import (
    DRY_COST_LIMIT_OBJECT_ID,
    DRY_COST_LIMIT_PARAM,
    DRY_COST_LIMIT_READBACK_ID,
    desired_write_rule,
)

from . import band_anchors
from ._common import (
    _PHYSICS_INVARIANTS,
    BAND_DRIVEN_PARAMS,
    CROP_BAND_REG,
    DIRECT_WET_DEFAULTS,
    DIRECT_WET_POLICY_PARAMS,
    DIRECT_WET_REQUIRED_OBJECT_IDS,
    FIRMWARE_HAS_LIGHTING_TARGET_MINUTES,
    FIRMWARE_HAS_PER_CIRCUIT_LIGHTING,
    GREENHOUSE_ID,
    HEAP_DEFER_FREE_KB,
    HEAP_DEFER_LARGEST_BLOCK_KB,
    HOUSE_BAND_PARAMS,
    LIGHTING_CIRCUIT_DEFAULT_PARAMS,
    LIGHTING_CIRCUIT_LUX_PARAMS,
    LIGHTING_CIRCUIT_SUPPORT_SENTINELS,
    LIGHTING_POLICY_PARAMS,
    LIGHTING_TARGET_MINUTE_PARAMS,
    MISTER_DEFAULTS,
    PARAM_TO_ENTITY,
    QUIET_MODE_ENTITY,
    QUIET_STATE_ENTITIES,
    QUIET_UNTIL_ENTITY,
    RETIRED_UNROUTABLE_PARAMS,
    SECOND_READBACK_ABS_TOLERANCE_PARAMS,
    STATE_DIR,
    SWITCH_CONFIRM_EQUIPMENT,
    SWITCH_TO_ENTITY,
    UTC,
    AlertEnvelope,
    SetpointChange,
    ValidationError,
    _last_pushed,
    _last_sent_at,
    asyncio,
    asyncpg,
    build_validation_failed_envelope,
    datetime,
    get_tunable,
    json,
    log,
    math,
    quiet_expired_needs_restore,
    quiet_is_active,
    registry_value_error,
    shared,
)

# Reconnect restoration is intentionally small and explicit.  These are the
# only legacy safety controls in the old force-reconcile set. Every field has
# either a cfg_* diagnostic or native Number/Switch readback route, so this set
# is intentionally empty today. A future genuinely unobserved field is bounded
# here and by MAX_RECONNECT_COMMANDS instead of reopening a broad blind restore.
_RECONNECT_SAFETY_CANDIDATES = (
    LIGHTING_POLICY_PARAMS
    | LIGHTING_CIRCUIT_LUX_PARAMS
    | HOUSE_BAND_PARAMS
    | frozenset(p for p in CROP_BAND_REG if p.startswith("vpd_target_"))
)
_CURRENT_READBACK_PARAMS = frozenset(CFG_READBACK_MAP.values()) | frozenset(SETPOINT_MAP.values())
RECONNECT_UNOBSERVED_RESTORE_PARAMS = frozenset(_RECONNECT_SAFETY_CANDIDATES - _CURRENT_READBACK_PARAMS)
MAX_RECONNECT_COMMANDS = 12
# A value sent this long ago on the same connection is not sent again while
# its readback is pending: cfg_* sensors publish every 30 s (VD-62).
SENT_READBACK_WAIT_S = 90.0
DISPATCHER_STAGE_ENTITY = "dispatcher_stage"
HELD_READBACKS_STAGE = "held:readbacks"
# Stands in the stuck-delivery alert's params for a connection that enumerated no writable value.
NO_READBACK_INVENTORY = "no_cfg_readbacks_enumerated"
# Desired state (VD-33). crop_band values reach the controller through
# crop_band_anchors and the anchor sync, irrigation_site values through
# irrigation_sync: the dispatcher sends nothing for their desired rows.
DESIRED_OTHER_PATH_CLASSES = frozenset({"crop_band", "irrigation_site"})
# The per-circuit values the lighting circuit block of setpoint_dispatcher
# resolves from fn_lighting_minutes_policy, eight per circuit (the DLI targets
# stay in the DB policy since #1477 retired their entities). The wider
# LIGHTING_CIRCUIT_DEFAULT_PARAMS also holds the solar-phasing, offset and
# out-of-service values, which no dispatcher block resolves.
LIGHTING_CIRCUIT_RESOLVED_PARAMS = frozenset(
    f"{prefix}{circuit}_{field}"
    for circuit in ("main", "grow")
    for prefix, field in (
        ("gl_", "target_light_minutes"),
        ("gl_", "sunrise_hour"),
        ("gl_", "sunset_hour"),
        ("gl_", "lux_threshold"),
        ("gl_", "lux_hysteresis"),
        ("gl_", "min_on_s"),
        ("gl_", "min_off_s"),
        ("sw_gl_", "auto_mode"),
    )
)
# The values the dispatcher's own blocks resolve each pass: the band, the
# per-circuit lighting policy, the direct-wet gate defaults and the mister
# defaults. _dispatch_source() labels each of them band. A released
# parameter none of them resolves, and with no plan, returns to its registry
# default (architecture §5.2 Release, API-11).
DISPATCHER_DEFAULT_PARAMS = frozenset(
    CROP_BAND_REG
    | LIGHTING_POLICY_PARAMS
    | LIGHTING_CIRCUIT_RESOLVED_PARAMS
    | DIRECT_WET_POLICY_PARAMS
    | MISTER_DEFAULTS
)
# (parameter, reason) pairs already logged, so a skipped row logs once.
_DESIRED_SKIPS_LOGGED: set[tuple[str, str]] = set()


def _clock() -> datetime:
    """Wall clock for plain-convergence bookkeeping; tests substitute a fake."""
    return datetime.now(UTC)


def _upsert_change(changes: list[tuple[str, float]], param: str, value: float) -> None:
    """Add or replace a pending dispatcher change."""
    clean_value = float(value)
    for idx, (existing_param, _) in enumerate(changes):
        if existing_param == param:
            changes[idx] = (param, clean_value)
            return
    changes.append((param, clean_value))


def _same_value(param: str, observed: float, value: float, grid_params: frozenset[str] = frozenset()) -> bool:
    """Whether ``observed`` already is the outgoing ``value``.

    A desired-state value or a release to the registry default (``grid_params``,
    VD-33) uses the grid comparator ``readback_matches()``, so a one-step change
    such as ``site_pressure_hpa`` 845 -> 840 is a difference (architecture §5.5).
    Plan, band and default values keep ``readback_values_equivalent()``.
    """
    if param in grid_params:
        return readback_matches(param, observed, value)
    return readback_values_equivalent(param, observed, value)


def _without_equivalent_duration_candidates(
    changes: list[tuple[str, float]],
    readbacks: dict[str, float],
    grid_params: frozenset[str] = frozenset(),
) -> list[tuple[str, float]]:
    """Avoid repushing firmware-quantized seconds already equivalent on cfg."""
    return [
        (param, value)
        for param, value in changes
        if param not in SECOND_READBACK_ABS_TOLERANCE_PARAMS
        or param not in readbacks
        or not _same_value(param, readbacks[param], value, grid_params)
    ]


def _note_delivery_differences(
    candidates: list[tuple[str, float]],
    held_on_purpose: set[str],
    generation: int,
    now: datetime,
    grid_params: frozenset[str] = frozenset(),
) -> None:
    """Track since when each outgoing value has differed from the controller.

    A parameter enters ``shared.delivery_differing_since`` when its outgoing
    value first differs from ``_last_pushed`` or its readback (it is a
    candidate) and leaves when its readback matches or it is no longer a
    candidate. What the platform holds on purpose stays out: the parameters
    clamped in this pass and those under ``experiment_policy_hold``. A
    desired-state value leaves only when ``readback_matches()`` holds.
    """
    readbacks = shared.current_cfg_readbacks(generation)
    previous = dict(shared.delivery_differing_since)
    current: dict[str, datetime] = {}
    for param, value in candidates:
        if param in held_on_purpose or _experiment_hold_failure(param) == "experiment_policy_hold":
            continue
        observed = readbacks.get(param)
        if observed is not None and _same_value(param, observed, value, grid_params):
            continue
        current[param] = previous.get(param, now)
    shared.delivery_differing_since.clear()
    shared.delivery_differing_since.update(current)


def _sent_on_connection(
    param: str, value: float, generation: int, grid_params: frozenset[str] = frozenset()
) -> datetime | None:
    """When this same value was last sent on this connection, or None if it was not."""
    sent = _last_sent_at.get(param)
    if sent is None:
        return None
    sent_at, sent_generation, sent_value = sent
    if sent_generation != generation or not _same_value(param, sent_value, value, grid_params):
        return None
    return sent_at


def _sent_awaiting_readback(
    param: str, value: float, generation: int, now: datetime, grid_params: frozenset[str] = frozenset()
) -> bool:
    """True for the same value sent on this connection within SENT_READBACK_WAIT_S."""
    sent_at = _sent_on_connection(param, value, generation, grid_params)
    return sent_at is not None and 0.0 <= (now - sent_at).total_seconds() < SENT_READBACK_WAIT_S


def _pace_ordinary_changes(
    changes: list[tuple[str, float]],
    generation: int,
    now: datetime,
    grid_params: frozenset[str] = frozenset(),
) -> tuple[list[tuple[str, float]], list[tuple[str, float]], int, bool]:
    """Select one paced ordinary batch: (send now, left over, awaiting readback, wake).

    A value sent on this connection in the last 90 s whose readback has not
    caught up is not sent again, so a woken pass never repeats its batch. When
    more than 12 changes remain they go oldest difference first, then by name;
    a value already sent on this connection that the controller has not taken
    goes after every value not yet sent (least recently sent first), so resends
    never crowd out new values. ``wake`` asks for the next pass only while a
    left-over value has not been sent on this connection yet: resends wait for
    the 300 s cadence or a readback drift, so values the controller never takes
    cannot keep the dispatcher waking itself, however many there are.
    """
    eligible = [
        (param, value)
        for param, value in changes
        if not _sent_awaiting_readback(param, value, generation, now, grid_params)
    ]
    awaiting = len(changes) - len(eligible)
    if len(eligible) > MAX_RECONNECT_COMMANDS:
        not_sent = datetime.min.replace(tzinfo=UTC)
        newest = datetime.max.replace(tzinfo=UTC)
        eligible.sort(
            key=lambda item: (
                _sent_on_connection(item[0], item[1], generation, grid_params) or not_sent,
                shared.delivery_differing_since.get(item[0], newest),
                item[0],
            )
        )
    batch, left = eligible[:MAX_RECONNECT_COMMANDS], eligible[MAX_RECONNECT_COMMANDS:]
    wake = any(_sent_on_connection(param, value, generation, grid_params) is None for param, value in left)
    return batch, left, awaiting, wake


def _dispatcher_stage_value(*, heap_deferred: bool, lease_held: bool, sent: int, pending: int) -> str:
    """``ordinary``, ``paced <sent>/<pending>`` or ``held:<reason>`` for this pass."""
    if heap_deferred:
        return "held:heap"
    if not lease_held:
        return "held:lease"
    if pending > sent:
        return f"paced {sent}/{pending}"
    return "ordinary"


async def _record_dispatcher_stage(conn, stage: str) -> None:
    """Write one ``dispatcher_stage`` system_state row when the stage changes."""
    if stage == shared.dispatcher_stage:
        return
    try:
        row = SystemStateRow(ts=datetime.now(UTC), entity=DISPATCHER_STAGE_ENTITY, value=stage)
        await conn.execute(
            "INSERT INTO v_runtime_system_state_write (ts, entity, value) VALUES ($1, $2, $3)",
            row.ts,
            row.entity,
            row.value,
        )
    except Exception as error:  # the stage record never stops a dispatch pass
        log.warning("dispatcher_stage record failed stage=%r error=%s", stage, type(error).__name__)
        return
    log.info("dispatcher_stage stage=%r previous=%r", stage, shared.dispatcher_stage)
    shared.dispatcher_stage = stage


async def _record_blocked_readbacks(pool: asyncpg.Pool, missing: frozenset[str]) -> None:
    """Make a pass held on an incomplete readback replay visible (``held:readbacks``).

    Nothing is computed or sent until the replay completes, and one that never
    completes freezes the dispatcher: an empty inventory stays unready for good
    (``shared.note_transport_connected``). Each missing readback counts as a
    delivery difference, so alert_monitor raises setpoint_delivery_stuck after its
    usual 15 minutes. The first complete pass rebuilds the map, so they leave by
    themselves.
    """
    now = _clock()
    for param in missing or {NO_READBACK_INVENTORY}:
        shared.delivery_differing_since.setdefault(param, now)
    try:
        async with pool.acquire() as conn:
            await _record_dispatcher_stage(conn, HELD_READBACKS_STAGE)
    except Exception as error:  # the stage record never stops a dispatch pass
        log.warning("dispatcher_stage record failed stage=%r error=%s", HELD_READBACKS_STAGE, type(error).__name__)


def _apply_manual_overlay(changes: list[tuple[str, float]], overlay: dict[str, float]) -> set[str]:
    """Force an operator overlay into the dispatcher batch."""
    overlay_params: set[str] = set()
    for param, value in overlay.items():
        _upsert_change(changes, param, value)
        overlay_params.add(param)
    return overlay_params


def _direct_wet_policy_supported() -> bool:
    """Return true once the connected firmware exposes the direct-wet contract."""
    keys = shared.esp32.get("keys") or {}
    if keys:
        return DIRECT_WET_REQUIRED_OBJECT_IDS.issubset(set(keys))
    return any(param in shared.cfg_readback for param in DIRECT_WET_POLICY_PARAMS)


def _dry_cost_limit_supported() -> bool:
    """Whether the connected controller lists the drying cost limit's number entity and its readback (phase 3
    firmware). Until it does, a stored limit or its release is not sent, so an older build, or a rollback to one,
    raises no delivery failure for it."""
    keys = shared.esp32.get("keys") or {}
    return DRY_COST_LIMIT_OBJECT_ID in keys and DRY_COST_LIMIT_READBACK_ID in keys


def _direct_wet_defaults(lighting_row, lighting_circuit_rows) -> dict[str, float]:
    """The direct-wet gate defaults, sent while a lighting policy row exists.

    #1477 retired the activity mirror (activity_start_hour, activity_start_minute,
    activity_duration_min) these defaults used to travel with; nothing on the
    controller read it. The two gate values and their lighting-row condition are
    unchanged.
    """
    if not (lighting_circuit_rows or lighting_row):
        return {}
    return {param: float(value) for param, value in DIRECT_WET_DEFAULTS.items()}


def _dispatch_source(
    param: str,
    quiet_params: set[str],
    desired_params: frozenset[str] | set[str] = frozenset(),
    released_params: frozenset[str] | set[str] = frozenset(),
) -> str:
    """Return the setpoint_changes source for a dispatcher write.

    A desired-state value in force (``desired_params``, VD-33) is ``manual``;
    a release returned to its registry default (``released_params``) is
    ``band``, like the dispatcher's own defaults. Since climate refactor 4.2 no
    plan reaches the dispatcher, so every other push (the anchor sync's
    dawn/midday boost offsets included) is ``band``: the dispatcher never
    writes ``plan`` or ``iris`` (lane MONITORING pages on either after the
    cutover).
    """
    if param in quiet_params or param in desired_params:
        return "manual"
    if param in released_params:
        return "band"
    if param in BAND_DRIVEN_PARAMS:
        return "band"
    if param in LIGHTING_CIRCUIT_DEFAULT_PARAMS:
        return "band"
    if param in DIRECT_WET_POLICY_PARAMS:
        return "band"
    if param in MISTER_DEFAULTS:
        return "band"
    return "band"


def _log_desired_skip_once(param: str, reason: str, *, warning: bool = False) -> None:
    """Log a skipped desired_state row once per parameter and reason."""
    if (param, reason) in _DESIRED_SKIPS_LOGGED:
        return
    _DESIRED_SKIPS_LOGGED.add((param, reason))
    (log.warning if warning else log.info)("desired_state skipped param=%s reason=%s", param, reason)


def _log_not_sent_once(param: str, reason: str) -> None:
    """Log once per parameter and reason a setting the pass resolved (band, default or desired) but never sends.

    The generic skip of #1633 phase 4: the controller lists no entity for it. Not a desired_state skip, so it has its
    own message."""
    if (param, reason) in _DESIRED_SKIPS_LOGGED:
        return
    _DESIRED_SKIPS_LOGGED.add((param, reason))
    log.info("setting not sent param=%s reason=%s", param, reason)


def _dispatcher_resolves(param: str, *, lighting_circuit: bool) -> bool:
    """Whether a band, lighting-policy or default block of a pass resolves ``param``.

    The per-circuit lighting values are resolved on firmware with per-circuit
    lighting, the legacy shared ones only on firmware without it. A release of a
    parameter no block resolves (a lighting offset, solar phasing or
    out-of-service switch, or a legacy shared lighting value on per-circuit
    firmware) and with no plan goes to its registry default, not nowhere.
    """
    if param in LIGHTING_POLICY_PARAMS:
        return not lighting_circuit
    if param in LIGHTING_CIRCUIT_RESOLVED_PARAMS:
        return lighting_circuit
    return param in DISPATCHER_DEFAULT_PARAMS


async def _fetch_desired_state(conn: asyncpg.Connection) -> dict[str, object]:
    """The newest desired_state row per parameter, keyed by parameter (VD-33).

    Before migration 280 is applied, or without its SELECT grant, there is no
    desired state to apply: the pass goes on with plans, band and defaults
    (logged once). Any other error fails the pass, so a transient error can
    never hand a person's setting back to the plan for one pass.
    """
    try:
        rows = await conn.fetch(
            "SELECT param, value, manual, created_at FROM v_desired_state_current WHERE greenhouse_id = $1",
            GREENHOUSE_ID,
        )
    except (asyncpg.UndefinedTableError, asyncpg.InsufficientPrivilegeError) as error:
        _log_desired_skip_once("*", f"v_desired_state_current unreadable ({type(error).__name__})", warning=True)
        return {}
    return {str(row["param"]): row for row in rows or []}


def _desired_route_exists(param: str) -> bool:
    """Whether the dispatcher can address ``param`` as a number or switch entity."""
    if param.startswith("sw_"):
        return SWITCH_TO_ENTITY.get(param) is not None
    return PARAM_TO_ENTITY.get(param) is not None


def _desired_skip_reason(
    param: str,
    *,
    lighting_circuit: bool,
    lighting_target_minutes: bool,
    direct_wet: bool,
    dry_cost_limit: bool = False,
) -> str | None:
    """Why the dispatcher sends nothing for this desired_state row, or None.

    Architecture §5.2: a row that is not writable now (§5.3 step 1) is skipped,
    and so is every crop_band and irrigation_site row. A row the connected
    firmware has no route or entity for is skipped as a plan row would be. An
    unknown or retired parameter is skipped and never fails the pass.
    """
    writable, reason = desired_write_rule(param)
    if not writable:
        return f"not writable: {reason}"
    control_class = get_tunable(param).control_class
    if control_class in DESIRED_OTHER_PATH_CLASSES:
        return f"{control_class} reaches the controller by its own path"
    if param in RETIRED_UNROUTABLE_PARAMS or not _desired_route_exists(param):
        return "no dispatcher route"
    if param in LIGHTING_CIRCUIT_DEFAULT_PARAMS and not lighting_circuit:
        return "firmware has no per-circuit lighting"
    if param in LIGHTING_TARGET_MINUTE_PARAMS and not lighting_target_minutes:
        return "firmware has no lighting target minutes"
    if param in DIRECT_WET_POLICY_PARAMS and not direct_wet:
        return "firmware has no direct-wet policy"
    if param == DRY_COST_LIMIT_PARAM and not dry_cost_limit:
        return "firmware has no drying cost limit"
    return None


def _fenced_desired_value(param: str, requested: float, audit) -> float:
    """A desired value through the fences (architecture §5.2).

    The physics invariants and the forced-on guardrail (the VPD-high moisture
    guardrail is retired, climate refactor 4.2); each clamp is recorded through ``audit`` (``add_clamp_audit``),
    so ``setpoint_clamps`` shows the value held. The registry clamp
    (``_coerce_registry_value``) runs at push time, as for every change.
    """
    value, violation = _validate_physics(param, requested)
    if violation is not None:
        audit(param, requested, value, 0.0, 0.0, violation, from_plan=False)
        log.warning("FW-3 invariant: desired %s=%s clamped to %s (%s)", param, requested, value, violation)
    if param.startswith("sw_"):
        value = 1.0 if value > 0.5 else 0.0
    return float(value)


def _desired_differs(param: str, value: float, last: float | None, readback: float | None) -> bool:
    """Whether a desired value (or a release's registry default) needs a command.

    It does when it differs from ``_last_pushed`` or from the current readback
    under the grid comparator ``readback_matches()`` (architecture §5.5), not the
    1 % dead-band, so a one-step change is not hidden; with neither known, too.
    """
    known = [observed for observed in (last, readback) if observed is not None]
    return not known or not all(readback_matches(param, observed, value) for observed in known)


async def _fetch_quiet_state(conn: asyncpg.Connection) -> dict[str, str]:
    rows = await conn.fetch(
        """
        SELECT DISTINCT ON (entity) entity, value
        FROM system_state
        WHERE entity = ANY($1::text[])
        ORDER BY entity, ts DESC
        """,
        list(QUIET_STATE_ENTITIES),
    )
    return {row["entity"]: row["value"] for row in rows}


async def _record_quiet_mode(conn: asyncpg.Connection, mode: str) -> None:
    await conn.execute(
        "INSERT INTO v_runtime_system_state_write (ts, entity, value) VALUES (now(), $1, $2)",
        QUIET_MODE_ENTITY,
        mode,
    )


def _validate_physics(param: str, val: float) -> tuple[float, str | None]:
    """FW-3 (Sprint 18): clamp val to physical bounds if invariant violated.

    Returns (clamped_val, reason). reason is None when no clamp applied.
    Only clamps for parameters with invariants defined in _PHYSICS_INVARIANTS.
    Unknown params pass through unchanged (the band / dispatcher layers
    handle those).
    """
    bounds = _PHYSICS_INVARIANTS.get(param)
    if bounds is None:
        return val, None
    lo, hi = bounds
    if lo is not None and val < lo:
        return float(lo), f"invariant_violation:below_{lo}"
    if hi is not None and val > hi:
        return float(hi), f"invariant_violation:above_{hi}"
    return val, None


def _coerce_registry_value(param: str, val: float) -> tuple[float | None, str | None]:
    """Clamp numeric registry drift, reject other registry violations."""
    error = registry_value_error(param, val)
    if error is None:
        return float(val), None

    spec = get_tunable(param)
    try:
        numeric = float(val)
    except (TypeError, ValueError):
        log.error("Rejecting dispatcher setpoint %s=%s: %s", param, val, error)
        return None, error
    if spec and spec.kind == "numeric":
        if spec.min is not None and numeric < spec.min:
            return float(spec.min), error
        if spec.max is not None and numeric > spec.max:
            return float(spec.max), error

    log.error("Rejecting dispatcher setpoint %s=%s: %s", param, val, error)
    return None, error


def _should_skip(last: float | None, val: float, rel: float = 0.01, abs_floor: float = 1e-3) -> bool:
    """DI-1 (Sprint 18): proportional dead-band for dispatcher.

    Return True if `val` is within `rel` (default 1%) of the previously-pushed
    value, relative to the magnitude of `val`. An `abs_floor` protects against
    setpoints at or near zero where any absolute threshold would be arbitrary.

    Replaces the previous absolute 0.1/0.05/0.02/0.01 thresholds that were
    scale-inappropriate — 0.05 on a 0.8 kPa VPD setpoint was 6% (too coarse),
    while the same 0.05 on a 75°F temp setpoint was 0.07% (fine). 1% relative
    is the right choice across the whole setpoint range. The rule itself is
    `verdify_schemas.setting_values.within_relative_deadband`, its one copy.
    """
    if last is None:
        return False
    return within_relative_deadband(last, val, rel, abs_floor)


def _heap_push_defer_active(
    heap_alert_open: bool,
    heap_free_kb: float | None,
    heap_largest_free_block_kb: float | None,
) -> bool:
    """Return true when the full ESP32 setpoint snapshot should be deferred."""

    if heap_free_kb is None:
        return heap_alert_open
    if heap_free_kb < HEAP_DEFER_FREE_KB:
        return True
    if heap_largest_free_block_kb is not None and heap_largest_free_block_kb < HEAP_DEFER_LARGEST_BLOCK_KB:
        return True
    return False


def _readback_drift(param: str, desired: float) -> bool:
    """True when ESP32 cfg_* readback disagrees with the desired value."""
    readback = shared.current_cfg_readbacks().get(param)
    if readback is None:
        return False
    return not readback_values_equivalent(param, readback, desired)


def _unchanged_anchor_dispatch_count(changes: list[tuple[str, float, str]]) -> int:
    """Count anchor commands whose canonical cfg readback already matches."""
    current_readbacks = shared.current_cfg_readbacks()
    return sum(
        param in band_anchors.ANCHOR_SYNC_PARAMS
        and param in current_readbacks
        and readback_values_equivalent(param, current_readbacks[param], value)
        for param, value, _source in changes
    )


def _persisted_delivery_status(outcome: DeviceCommandOutcome, final_attempt: bool) -> str:
    """Map one physical queue outcome onto the durable lifecycle vocabulary."""
    if outcome.status == "failed" and not final_attempt and delivery_failure_retryable(outcome):
        return "retrying"
    return outcome.status


def _dispatch_trigger_completed(final_failures: list[tuple[str, str]]) -> bool:
    """A reconnect/drift generation is complete only when no command failed."""
    return not final_failures


async def _write_clamp_audit_rows(
    conn: asyncpg.Connection,
    clamp_rows: list[dict[str, object]],
    dispatched_params: set[str],
) -> int:
    """Persist dispatcher guardrail decisions, including unchanged holds.

    Historically `setpoint_clamps` only recorded rows that also produced a
    `setpoint_changes` push. That hid the important case where the planner
    requested a transition, the guardrail kept the already-applied value, and no
    ESP32 write was needed. These rows make that hold traceable to a plan
    transition without changing the relay/control path.
    """
    written = 0
    for row in clamp_rows:
        param = str(row["parameter"])
        reason = str(row["reason"])
        if param in dispatched_params:
            status = "guardrailed"
        elif reason in {"vpd_high_moisture_guardrail", "forced_on_guardrail"} or "guardrail" in reason:
            status = "held_by_guardrail"
        else:
            status = "rejected"
        await conn.execute(
            """
            INSERT INTO v_runtime_setpoint_clamps_write
              (parameter, requested, applied, band_lo, band_hi, reason,
               status, plan_id, plan_ts, trigger_id, planner_instance)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid, $11)
            """,
            param,
            float(row["requested"]),
            float(row["applied"]),
            float(row["band_lo"]),
            float(row["band_hi"]),
            reason,
            status,
            row.get("plan_id"),
            row.get("plan_ts"),
            row.get("trigger_id"),
            row.get("planner_instance"),
        )
        written += 1
    return written


async def setpoint_dispatcher(pool: asyncpg.Pool) -> None:
    global _last_pushed
    reconnect_generation = int(shared.transport_generation)
    reconnect_pending = reconnect_generation > int(shared.reconciled_transport_generation)
    drift_versions = dict(shared.cfg_drift_versions)
    if reconnect_pending:
        dispatch_reason = "transport_reconnect"
    elif drift_versions:
        dispatch_reason = "cfg_drift"
    else:
        dispatch_reason = "desired_change"

    if reconnect_pending and not shared.transport_readbacks_ready(reconnect_generation):
        missing = shared.missing_transport_cfg_readbacks(reconnect_generation)
        log.warning(
            "writer_reconcile reason=transport_reconnect generation=%d "
            "action=blocked_readbacks_incomplete expected=%d missing=%d missing_params=%s",
            reconnect_generation,
            len(shared.transport_expected_cfg_readbacks),
            len(missing),
            ",".join(sorted(missing)),
        )
        await _record_blocked_readbacks(pool, missing)
        return

    def complete_dispatch_trigger() -> None:
        if reconnect_pending:
            shared.mark_transport_reconciled(reconnect_generation)
        shared.clear_cfg_drift(drift_versions)

    # Rebuild the comparison cache only from callbacks belonging to this exact
    # connection. Readback-routed controls, including restore_value:no fields,
    # are delta-repaired from live truth. Any future control with no observable
    # route is deliberately forgotten and conservatively restored below.
    reconnect_event_set = False
    if shared.force_setpoint_push.is_set():
        reconnect_event_set = True
    if reconnect_event_set and reconnect_pending:
        current_readbacks = shared.current_cfg_readbacks(reconnect_generation)
        for param in RECONNECT_UNOBSERVED_RESTORE_PARAMS:
            _last_pushed.pop(param, None)
        seeded = 0
        for param, val in current_readbacks.items():
            _last_pushed[param] = float(val)
            seeded += 1
        if SWITCH_CONFIRM_EQUIPMENT:
            async with pool.acquire() as seed_conn:
                equipment_rows = await seed_conn.fetch(
                    """
                    SELECT DISTINCT ON (equipment) equipment, state
                      FROM equipment_state
                     WHERE equipment = ANY($1::text[])
                     ORDER BY equipment, ts DESC
                    """,
                    list(SWITCH_CONFIRM_EQUIPMENT.values()),
                )
            equipment_state = {row["equipment"]: bool(row["state"]) for row in equipment_rows}
            for param, equipment in SWITCH_CONFIRM_EQUIPMENT.items():
                if param in current_readbacks:
                    continue
                if equipment in equipment_state:
                    _last_pushed[param] = 1.0 if equipment_state[equipment] else 0.0
                    seeded += 1
        log.info(
            "writer_reconcile reason=transport_reconnect generation=%d seeded=%d "
            "unobserved_restore_limit=%d comparison=current_generation_readbacks",
            reconnect_generation,
            seeded,
            len(RECONNECT_UNOBSERVED_RESTORE_PARAMS),
        )
    async with pool.acquire() as conn:
        # The served band (fn_band_setpoints, the one band source: all four edges, #1734 CTL-26) and the
        # crop-driven lighting policy used by firmware.
        band_row = await conn.fetchrow("SELECT * FROM fn_band_setpoints(now())")
        lighting_row = await conn.fetchrow("SELECT * FROM fn_lighting_policy(now())")
        lighting_circuit_rows = await conn.fetch("SELECT * FROM fn_lighting_minutes_policy(now()) ORDER BY light_key")

        # Firmware-v2 deterministic band (contract B2/B6/B7). The solar context
        # and the per-zone band-audit emission are unconditional (compliance
        # history accumulates before any flip); anchor pushes and the legacy
        # band cutover are gated by VERDIFY_BAND_SOURCE (default: anchors;
        # legacy is the rollback hatch).
        anchors_mode = band_anchors.band_source() == band_anchors.BAND_SOURCE_ANCHORS
        solar_ctx = band_anchors.local_solar_context()
        anchor_values, anchor_origin = await band_anchors.crop_band_anchor_values(conn)
        anchor_pushes = band_anchors.desired_anchor_pushes(anchor_values)
        anchors_live = (
            anchors_mode and band_anchors.anchors_supported() and band_anchors.anchors_confirmed(anchor_pushes)
        )
        audit_rows = await band_anchors.emit_band_audit(conn, anchor_values, solar_ctx)
        if audit_rows:
            log.info(
                "Dispatcher: emitted %d per-zone band audit row(s) (source=%s phase=%.3f)",
                audit_rows,
                anchor_origin,
                solar_ctx.phase,
            )

        # Climate refactor 4.2: no plan is read. The planner writes no climate value; what goes to the
        # controller is the band, the dispatcher's defaults and desired_state (the dashboard and named agents).
        lighting_circuit_supported = FIRMWARE_HAS_PER_CIRCUIT_LIGHTING or any(
            param in shared.cfg_readback or param in _last_pushed for param in LIGHTING_CIRCUIT_SUPPORT_SENTINELS
        )
        lighting_target_minutes_supported = FIRMWARE_HAS_LIGHTING_TARGET_MINUTES or all(
            param in shared.cfg_readback for param in LIGHTING_TARGET_MINUTE_PARAMS
        )
        direct_wet_supported = _direct_wet_policy_supported()
        dry_cost_limit_supported = _dry_cost_limit_supported()
        quiet_state = await _fetch_quiet_state(conn)
        quiet_mode = quiet_state.get(QUIET_MODE_ENTITY)
        quiet_until = quiet_state.get(QUIET_UNTIL_ENTITY)
        quiet_active = quiet_is_active(quiet_mode, quiet_until)
        quiet_restore_due = quiet_expired_needs_restore(quiet_mode, quiet_until)
        quiet_params: set[str] = set()

        # FW-3 (Sprint 18): desired values pass the physics invariants below;
        # violations are logged in setpoint_clamps for audit.
        changes = []
        clamps_to_log: list[dict[str, object]] = []

        def add_clamp_audit(
            param: str,
            requested: float,
            applied: float,
            band_lo: float,
            band_hi: float,
            reason: str,
            *,
            from_plan: bool = False,
        ) -> None:
            # No clamp names a plan any more (climate refactor 4.2).
            meta: dict[str, object] = {}
            clamps_to_log.append(
                {
                    "parameter": param,
                    "requested": float(requested),
                    "applied": float(applied),
                    "band_lo": float(band_lo),
                    "band_hi": float(band_hi),
                    "reason": reason,
                    "plan_id": meta.get("plan_id"),
                    "plan_ts": meta.get("plan_ts"),
                    "trigger_id": meta.get("trigger_id"),
                    "planner_instance": meta.get("planner_instance"),
                }
            )

        # Band-driven params: the band's own values.
        # Once VERDIFY_BAND_SOURCE=anchors AND every anchor tunable is confirmed
        # by its cfg_* readback (anchors_live), the on-chip curve owns these four
        # values and the dispatcher stops pushing them (contract B2 — they become
        # read-only readbacks of the computed band). Until confirmation, both
        # paths run so the device never sees a band gap.
        if band_row and not anchors_live:
            for param in ("temp_low", "temp_high", "vpd_low", "vpd_high"):
                val = float(band_row[param])
                val = round(val, 1 if param.startswith("temp") else 2)
                if _should_skip(_last_pushed.get(param), val) and not _readback_drift(param, val):
                    continue
                changes.append((param, val))

        # The per-zone VPD targets are no longer pushed: the controller draws its zone bands from the anchor curves,
        # and the third flash deleted the four number entities (RULINGS AE7a).

        # Anchor-table sync (contract B7): push the 56 anchor/width/priority/
        # window tunables only when a value differs from the last confirmed
        # cfg_* readback. Anchors are NVS-persisted on the device, so steady
        # state is zero pushes; a crop_band_anchors change re-syncs within one
        # cycle. Gated on the firmware actually exposing the v2 entities so a
        # pre-OTA flip cannot strand forever-unconfirmed setpoint_changes rows.
        #
        # FAIL-CLOSED (data-path review F1, 2026-06-16): when the crop_band_anchors
        # read FAILED (origin == table-error), `anchor_pushes` are the registry
        # fallback envelope, which has historically lagged the live band (the
        # 2026-06-15 wet-night orchid regression). The device is offline-first and
        # already holds the correct band in NVS, so pushing a stale fallback over
        # it is strictly worse than holding. Skip the anchor push this cycle and
        # surface the held state as an alert instead of silently re-commanding a
        # researched default. (table-absent cold-start still seeds normally.)
        anchor_db_error = anchor_origin == band_anchors.ANCHOR_ORIGIN_TABLE_ERROR
        if anchor_db_error and anchors_mode and band_anchors.anchors_supported():
            log.warning(
                "Dispatcher: crop_band_anchors read failed (origin=%s) — holding device NVS band, skipping anchor push",
                anchor_origin,
            )
            existing_alert = await conn.fetchval(
                "SELECT id FROM alert_log WHERE alert_type = 'band_anchor_db_read_failed' AND disposition = 'open' LIMIT 1"
            )
            if existing_alert is None:
                await conn.execute(
                    "INSERT INTO alert_log (alert_type, severity, category, message, details, source) "
                    "VALUES ('band_anchor_db_read_failed', 'warning', 'system', $1, $2, 'dispatcher')",
                    "crop_band_anchors unreadable; dispatcher held the device NVS band (no fallback push)",
                    json.dumps({"origin": anchor_origin}),
                )
        if band_anchors.anchor_push_allowed(anchors_mode, band_anchors.anchors_supported(), anchor_origin):
            for param, val in anchor_pushes.items():
                readback = shared.cfg_readback.get(param)
                if readback is not None and readback_values_equivalent(param, readback, val):
                    continue
                if _should_skip(_last_pushed.get(param), val) and not _readback_drift(param, val):
                    continue
                changes.append((param, val))

        # #1477: the legacy shared lighting values (gl_dli_target, gl_sunrise_hour,
        # gl_sunset_hour, gl_lux_threshold, gl_lux_hysteresis, sw_gl_auto_mode),
        # sent only to firmware without per-circuit lighting, left the firmware
        # and the registry; the per-circuit block below is the lighting delivery.

        # Per-circuit lighting state machines: crop policy + Tempest history
        # seed both circuits (no plan row diverges them since climate refactor 4.2;
        # a desired_state row still does, below).
        # Under VERDIFY_BAND_SOURCE=anchors the per-circuit photoperiod minutes +
        # DLI come from the DB lighting policy (fn_lighting_minutes_policy — the
        # single AI-tunable source; gl_main and gl_grow are differentiated there),
        # and ONLY the start/cutoff windows are sunrise-anchored from the
        # ephemeris instead of the policy table's fixed hours.
        anchor_lighting: dict[str, float] = {}
        circuit_minutes: dict[str, float] = {}
        if anchors_mode and lighting_circuit_rows:
            circuit_minutes = {
                row["light_key"]: float(int(row["target_light_minutes"])) for row in lighting_circuit_rows
            }
            anchor_lighting = band_anchors.lighting_circuit_overrides(solar_ctx.times, circuit_minutes)
        for row in lighting_circuit_rows or []:
            if not lighting_circuit_supported:
                continue
            key = row["light_key"]
            circuit_defaults = {
                f"gl_{key}_target_light_minutes": float(int(row["target_light_minutes"])),
                f"gl_{key}_sunrise_hour": float(int(row["start_hour"])),
                f"gl_{key}_sunset_hour": float(int(row["cutoff_hour"])),
                f"gl_{key}_lux_threshold": round(float(row["lux_on_threshold"]), 0),
                f"gl_{key}_lux_hysteresis": round(float(row["lux_hysteresis"]), 0),
                f"gl_{key}_min_on_s": float(int(row["min_on_s"])),
                f"gl_{key}_min_off_s": float(int(row["min_off_s"])),
                f"sw_gl_{key}_auto_mode": 1.0 if row["auto_enabled"] else 0.0,
            }
            for param in circuit_defaults:
                if param in anchor_lighting:
                    circuit_defaults[param] = anchor_lighting[param]
            for param, val in circuit_defaults.items():
                if param in LIGHTING_TARGET_MINUTE_PARAMS and not lighting_target_minutes_supported:
                    continue
                if _should_skip(_last_pushed.get(param), val) and not _readback_drift(param, val):
                    continue
                changes.append((param, val))

        # Direct-wet gate defaults (#1477 retired the activity mirror that rode with them).
        direct_wet_defaults: dict[str, float] = {}
        if direct_wet_supported:
            direct_wet_defaults = _direct_wet_defaults(lighting_row, lighting_circuit_rows)
            for param, val in direct_wet_defaults.items():
                if _should_skip(_last_pushed.get(param), val) and not _readback_drift(param, val):
                    continue
                changes.append((param, val))

        # The safety limits are not dispatched: the controller compiles 40 F and 100 F, and the third flash deleted
        # their number entities (RULINGS AE7a).

        # Mister tuning default: the engage delay is the one mister setting left (release 4 deleted the engage and
        # all-zone thresholds, the all-zone delay and the center penalty with the third flash).
        mister_defaults = {}
        if band_row:
            mister_defaults = {"mister_engage_delay_s": 30}
            for param, val in mister_defaults.items():
                if _should_skip(_last_pushed.get(param), val) and not _readback_drift(param, val):
                    continue
                changes.append((param, val))

        if quiet_active:
            log.info(
                "Dispatcher: recording quiet mode active until %s; no setpoint overlay applied",
                quiet_until,
            )
        elif quiet_restore_due:
            await _record_quiet_mode(conn, "expired_no_overlay")
            log.info("Dispatcher: recording quiet mode expired; no restore overlay applied")

        # Desired state (VD-33, architecture §5.2). A person's or an agent's
        # value replaces what the band and default blocks above put in changes
        # for its parameter, through the same fences, before the dedupe and the
        # 12-command limit. resolve_effective() with no plan row: a value is in
        # force, NULL releases (climate refactor 4.2: no plan competes).
        desired_rows = await _fetch_desired_state(conn)
        desired_readbacks = shared.current_cfg_readbacks(reconnect_generation)
        policy_hold_active, policy_hold_params = experiment_policy_hold()
        bundle_hold_active, bundle_hold_params = component_bundle_hold()
        # param -> the value this block put in changes: a desired value, or a
        # release's registry default.
        desired_values: dict[str, float] = {}
        released_values: dict[str, float] = {}
        desired_held: list[str] = []
        for param, desired in sorted(desired_rows.items()):
            skip = _desired_skip_reason(
                param,
                lighting_circuit=lighting_circuit_supported,
                lighting_target_minutes=lighting_target_minutes_supported,
                direct_wet=direct_wet_supported,
                dry_cost_limit=dry_cost_limit_supported,
            )
            if skip is None and desired["value"] is not None and not math.isfinite(float(desired["value"])):
                skip = "non-finite value"
            if skip is not None:
                _log_desired_skip_once(param, skip)
                continue
            resolved = resolve_effective(desired, None)
            if resolved is None:
                # Released: the band or dispatcher default above applies.
                # With neither the setting returns to its registry default.
                if _dispatcher_resolves(param, lighting_circuit=lighting_circuit_supported):
                    continue
                released = True
                requested = float(get_tunable(param).default)
            else:
                released = False
                requested = resolved.value
            changes = [(name, change) for name, change in changes if name != param]
            if (policy_hold_active and param in policy_hold_params) or (
                bundle_hold_active and param in bundle_hold_params
            ):
                # The armed vector or a component bundle owns it: it reads held
                # and goes out on the first pass after the hold ends. Nothing is
                # fenced, so no clamp row claims a guardrail held it.
                desired_held.append(param)
                continue
            value = _fenced_desired_value(param, requested, add_clamp_audit)
            if not _desired_differs(param, value, _last_pushed.get(param), desired_readbacks.get(param)):
                continue
            changes.append((param, value))
            (released_values if released else desired_values)[param] = value
        if desired_held:
            log.info("desired_state held params=%s reason=experiment_hold", ",".join(desired_held))
        grid_params = frozenset(desired_values) | frozenset(released_values)

        # Multiple policy layers can resolve the same parameter.  One physical
        # command and one lifecycle row per parameter keeps ordering explicit.
        deduped_changes: dict[str, float] = {}
        for param, value in changes:
            deduped_changes[param] = float(value)
        changes = list(deduped_changes.items())

        # DISPATCHER-02: a setting the connected controller does not list (#1633 phase 4) never gets a readback.
        # Left in, it would keep the oldest difference, sort first and fill every paced batch, so band, anchor and
        # lighting changes would never go out. Drop them before the difference bookkeeping and pacing; the skip in
        # the send loop below stays as a backstop.
        kept_changes: list[tuple[str, float]] = []
        for param, value in changes:
            if controller_omits_setting(param):
                _log_not_sent_once(param, "controller lists no setting entity")
            else:
                kept_changes.append((param, value))
        changes = kept_changes

        # Only current-generation cfg values may suppress an equivalent
        # duration. Apply this before pacing.
        changes = _without_equivalent_duration_candidates(
            changes, shared.current_cfg_readbacks(reconnect_generation), grid_params
        )

        # Plain convergence (VD-62): the complete candidate set is what still
        # differs from the controller. Record since when, for pacing order and
        # for alert_monitor's setpoint_delivery_stuck.
        pass_started = _clock()
        _note_delivery_differences(
            changes,
            {str(row["parameter"]) for row in clamps_to_log},
            reconnect_generation,
            pass_started,
            grid_params,
        )

        # Where the 12-command check stood: an ordinary pass sends at most
        # MAX_RECONNECT_COMMANDS, oldest difference first, and wakes the next
        # pass for the rest. Nothing is staged, approved or halted.
        changes, paced_unsent, awaiting_readback, paced_wake = _pace_ordinary_changes(
            changes, reconnect_generation, pass_started, grid_params
        )
        pending_count = len(changes) + len(paced_unsent)
        if paced_unsent or awaiting_readback:
            log.info(
                "writer_reconcile reason=paced generation=%d action=paced trigger=%s "
                "command_count=%d pending=%d awaiting_readback=%d limit=%d",
                reconnect_generation,
                dispatch_reason,
                len(changes),
                pending_count,
                awaiting_readback,
                MAX_RECONNECT_COMMANDS,
            )

        if not changes:
            clamp_rows_written = await _write_clamp_audit_rows(conn, clamps_to_log, set())
            if clamp_rows_written:
                log.info(
                    "Dispatcher: wrote %d guardrail hold/audit row(s) with no ESP32 push",
                    clamp_rows_written,
                )
            log.info(
                "writer_dispatch reason=%s generation=%d command_count=0 anchor_count=0 "
                "unchanged_anchor_count=0 comparison=desired_vs_observed",
                dispatch_reason,
                reconnect_generation,
            )
            # Values still awaiting their readback wait for the 300 s cadence
            # or a readback drift; this pass does not wake itself for them.
            complete_dispatch_trigger()
            await _record_dispatcher_stage(conn, "ordinary")
            (STATE_DIR / "setpoint-dispatcher.log").touch()
            return

        heap_guard = await conn.fetchrow(
            """
            SELECT heap_bytes, heap_min_free_kb, heap_largest_free_block_kb
              FROM diagnostics
             WHERE heap_bytes IS NOT NULL
             ORDER BY ts DESC
             LIMIT 1
            """
        )
        heap_alert_open = await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1
                 FROM alert_log
                 WHERE disposition = 'open'
                   AND alert_type IN ('heap_pressure_warning', 'heap_pressure_critical')
            )
            """
        )
        heap_free = float(heap_guard["heap_bytes"]) if heap_guard and heap_guard["heap_bytes"] is not None else None
        heap_largest = (
            float(heap_guard["heap_largest_free_block_kb"])
            if heap_guard and heap_guard["heap_largest_free_block_kb"] is not None
            else None
        )
        heap_defer_active = _heap_push_defer_active(bool(heap_alert_open), heap_free, heap_largest)

        # A command is a desired-state value (source manual, past
        # component_authority_hold, no plan trigger) or a release (source band)
        # only when it carries the very value the desired-state block resolved
        # (VD-33).
        outgoing = {param: float(value) for param, value in changes}
        outgoing_desired = frozenset(param for param, value in desired_values.items() if outgoing.get(param) == value)
        outgoing_released = frozenset(param for param, value in released_values.items() if outgoing.get(param) == value)

        dispatchable_changes: list[tuple[str, float, str]] = []
        delivery_records: list[dict[str, object]] = []
        prequeue_failures: list[tuple[str, str]] = []
        skipped_heap_deferred = 0
        for param, val in changes:
            if controller_omits_setting(param):
                # The connected controller has no entity for this setting (#1633 phase 4): no request row, no
                # delivery failure. A controller that lists it again (a rollback) receives it on the next pass.
                _log_not_sent_once(param, "controller lists no setting entity")
                continue
            source = _dispatch_source(param, quiet_params, outgoing_desired, outgoing_released)
            plan_owned = False  # no plan writes a setting (climate refactor 4.2)

            requested_val = float(val)
            registry_val, registry_violation = _coerce_registry_value(param, requested_val)
            if registry_val is None:
                prequeue_failures.append((param, registry_violation or "registry_violation"))
                add_clamp_audit(
                    param,
                    requested_val,
                    requested_val,
                    0.0,
                    0.0,
                    registry_violation or "registry_violation",
                    from_plan=plan_owned,
                )
                continue
            if registry_violation is not None:
                add_clamp_audit(param, requested_val, registry_val, 0.0, 0.0, registry_violation, from_plan=plan_owned)
                log.warning(
                    "Dispatcher registry guard: %s=%s clamped to %s (%s)",
                    param,
                    requested_val,
                    registry_val,
                    registry_violation,
                )
            val = registry_val

            # Sprint 24.9 (G-2): validate through SetpointChange before INSERT.
            # Defense-in-depth: MCP's PlanTransition.params already validates
            # at write time, but a regression there would silently corrupt
            # setpoint_changes. Drift-surface the mismatch here where it's
            # cheap (one row at a time) vs. downstream where it blows up a
            # grafana panel or planner scorecard.
            try:
                change_trigger_id = None
                change_planner_instance = None
                SetpointChange(
                    ts=(requested_at := datetime.now(UTC)),
                    parameter=param,
                    value=float(val),
                    source=source,
                    trigger_id=change_trigger_id,
                    planner_instance=change_planner_instance,
                    delivery_status="requested",
                )
            except ValidationError as e:
                prequeue_failures.append((param, "setpoint_change_validation_failed"))
                log.error(
                    "dispatcher setpoint_change skipped (validation failed: %s): param=%s value=%s source=%s",
                    e,
                    param,
                    val,
                    source,
                )
                continue
            if heap_defer_active:
                # A deferred row is truthful request evidence, not sent state.
                # No other path pushes a setpoint_changes row (the NOTIFY push
                # handler is retired, #1656), so this deferred state cannot
                # bypass the heap hold; no recently_pushed cache moves. This is the lifecycle
                # equivalent of the legacy UPDATE clause
                # delivery_status = 'deferred_heap_pressure', now set at INSERT.
                await conn.execute(
                    "INSERT INTO v_runtime_setpoint_changes_write "
                    "(ts, parameter, value, source, trigger_id, planner_instance, delivery_status) "
                    "VALUES ($1, $2, $3, $4, $5::uuid, $6, 'deferred_heap_pressure')",
                    requested_at,
                    param,
                    val,
                    source,
                    change_trigger_id,
                    change_planner_instance,
                )
                skipped_heap_deferred += 1
                _last_pushed.pop(param, None)
                continue
            # Separate request ownership from physical-sent evidence. The
            # dispatcher is the only path that sends a setpoint_changes row (the
            # NOTIFY push handler is retired, #1656), so this explicit requested
            # state cannot be double-delivered. recently_pushed/_last_pushed
            # move only after the API command returns successfully.
            # Lifecycle migration from the old pre-delivery row shape:
            # VALUES (now(), $1, $2, $3, $4::uuid, $5, 'pending')
            # The explicit requested timestamp below is the immutable command
            # identity used by queued/sent/cancelled outcome updates.
            await conn.execute(
                "INSERT INTO v_runtime_setpoint_changes_write "
                "(ts, parameter, value, source, trigger_id, planner_instance, delivery_status) "
                "VALUES ($1, $2, $3, $4, $5::uuid, $6, 'requested')",
                requested_at,
                param,
                val,
                source,
                change_trigger_id,
                change_planner_instance,
            )
            if param in RETIRED_UNROUTABLE_PARAMS:
                # Pre-#450 rows can still surface here (e.g. reconnect re-seeds).
                # Expire them quietly — they are not delivery failures.
                await conn.execute(
                    """
                    UPDATE v_runtime_setpoint_changes_write
                       SET delivery_status = 'superseded', expired_at = now()
                     WHERE ts = $1 AND parameter = $2 AND confirmed_at IS NULL
                    """,
                    requested_at,
                    param,
                )
                log.info("writer_delivery phase=persisted status=superseded reason=retired_param param=%s", param)
                continue
            if param.startswith("sw_"):
                entity_id = SWITCH_TO_ENTITY.get(param)
                route = (entity_id, float(val), "switch") if entity_id else None
            elif param in band_anchors.ANCHOR_SYNC_PARAMS:
                route = (param, float(val), "service")
            else:
                entity_id = PARAM_TO_ENTITY.get(param)
                route = (entity_id, float(val), "number") if entity_id else None

            if route is None:
                await conn.execute(
                    """
                    UPDATE v_runtime_setpoint_changes_write
                       SET delivery_status = 'failed', expired_at = now()
                     WHERE ts = $1 AND parameter = $2 AND confirmed_at IS NULL
                    """,
                    requested_at,
                    param,
                )
                log.error(
                    "writer_delivery phase=persisted status=failed reason=unroutable param=%s generation=%d attempt=0",
                    param,
                    reconnect_generation,
                )
                prequeue_failures.append((param, "unroutable"))
                continue

            dispatchable_changes.append((param, float(val), source))
            delivery_records.append(
                {
                    "parameter": param,
                    "value": float(val),
                    "source": source,
                    "requested_at": requested_at,
                    "route": route,
                }
            )
        if skipped_heap_deferred:
            log.warning(
                "Dispatcher: held full %d-row setpoint snapshot during active heap pressure",
                skipped_heap_deferred,
            )
        # Desired-state values pass component_authority_hold at the physical
        # chokepoint (VD-33).
        desired_push = frozenset(param for param, _value, _source in dispatchable_changes if param in outgoing_desired)
        # Tier 1 #2: persist guardrail audit. Rows are written even when the
        # guardrail intentionally holds an unchanged applied value and no
        # setpoint_changes row is emitted.
        dispatched_params = {param for param, _value, _source in dispatchable_changes}
        clamp_rows_written = await _write_clamp_audit_rows(conn, clamps_to_log, dispatched_params)
        if clamp_rows_written:
            log.info(
                "Dispatcher: wrote %d clamp/audit row(s) (%s)",
                clamp_rows_written,
                ", ".join(f"{row['parameter']}={row['requested']}->{row['applied']}" for row in clamps_to_log),
            )
        # Registry clamps are applied above; a clamped value is held on purpose.
        for row in clamps_to_log:
            shared.delivery_differing_since.pop(str(row["parameter"]), None)
        dispatcher_stage = _dispatcher_stage_value(
            heap_deferred=heap_defer_active,
            lease_held=shared.writer_lease_held(),
            sent=len(changes),
            pending=pending_count,
        )
        await _record_dispatcher_stage(conn, dispatcher_stage)
        # Legacy tuple iteration remains conceptually: for param, val, _source in dispatchable_changes:
        anchor_count = sum(param in band_anchors.ANCHOR_SYNC_PARAMS for param, _value, _source in dispatchable_changes)
        unchanged_anchor_count = _unchanged_anchor_dispatch_count(dispatchable_changes)
        log.info(
            "writer_dispatch reason=%s generation=%d command_count=%d anchor_count=%d "
            "unchanged_anchor_count=%d comparison=desired_vs_observed",
            dispatch_reason,
            reconnect_generation,
            len(dispatchable_changes),
            anchor_count,
            unchanged_anchor_count,
        )

    async def persist_delivery_states(
        records: list[dict[str, object]],
        outcomes: tuple[DeviceCommandOutcome, ...],
        *,
        final_attempt: bool,
    ) -> None:
        for outcome in outcomes:
            record = records[outcome.index]
            param = str(record["parameter"])
            value = float(record["value"])
            status = _persisted_delivery_status(outcome, final_attempt)
            allowed = list(delivery_transition_prior_statuses(status))
            async with pool.acquire() as state_conn:
                persisted = await state_conn.fetchval(
                    """
                    UPDATE v_runtime_setpoint_changes_write
                       SET delivery_status = $1,
                           expired_at = CASE
                               WHEN $1 IN ('failed', 'cancelled', 'superseded')
                               THEN COALESCE(expired_at, now())
                               ELSE expired_at
                           END
                     WHERE ts = $2
                       AND parameter = $3
                       AND confirmed_at IS NULL
                       AND COALESCE(delivery_status, 'pending') = ANY($4::text[])
                    RETURNING delivery_status
                    """,
                    status,
                    record["requested_at"],
                    param,
                    allowed,
                )
                if persisted is None:
                    current = await state_conn.fetchval(
                        "SELECT delivery_status FROM setpoint_changes WHERE ts = $1 AND parameter = $2",
                        record["requested_at"],
                        param,
                    )
                    if current != status:
                        preserved = preserved_terminal_status(current, status)
                        if preserved is None:
                            raise RuntimeError(f"illegal delivery transition {current!r} -> {status!r} for {param}")
                        status = preserved
            if outcome.status == "sent":
                # Advance the desired/sent cache only after the corresponding
                # durable terminal callback succeeded. Confirmation remains an
                # independent cfg/equipment readback transition.
                _last_pushed[param] = value
                _last_sent_at[param] = (_clock(), outcome.connection_generation, value)
            log.info(
                "writer_delivery phase=persisted status=%s reason=%s param=%s generation=%d attempt=%d",
                status,
                outcome.reason,
                param,
                outcome.connection_generation,
                outcome.attempt,
            )

    pending_records = list(delivery_records)
    terminal_failures: list[tuple[str, str]] = []
    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        if not pending_records:
            break

        if attempt > 1:
            current_records: list[dict[str, object]] = []
            async with pool.acquire() as state_conn:
                for record in pending_records:
                    newer_ts = await state_conn.fetchval(
                        """
                        SELECT min(ts) FROM setpoint_changes
                         WHERE parameter = $1
                           AND COALESCE(source, '') <> 'esp32'
                           AND ts > $2
                        """,
                        record["parameter"],
                        record["requested_at"],
                    )
                    if newer_ts is None:
                        current_records.append(record)
                        continue
                    persisted = await state_conn.fetchval(
                        """
                        UPDATE v_runtime_setpoint_changes_write
                           SET delivery_status = 'superseded',
                               superseded_by_ts = $3,
                               expired_at = COALESCE(expired_at, $3)
                         WHERE ts = $1 AND parameter = $2 AND confirmed_at IS NULL
                           AND COALESCE(delivery_status, 'pending') = ANY($4::text[])
                        RETURNING delivery_status
                        """,
                        record["requested_at"],
                        record["parameter"],
                        newer_ts,
                        list(delivery_transition_prior_statuses("superseded")),
                    )
                    if persisted is None:
                        raise RuntimeError(
                            f"failed to supersede stale retry for {record['parameter']} at {record['requested_at']}"
                        )
                    log.info(
                        "writer_delivery phase=persisted status=superseded reason=newer_db_request param=%s",
                        record["parameter"],
                    )
            pending_records = current_records
            if not pending_records:
                break

        async def on_state(
            outcomes: tuple[DeviceCommandOutcome, ...],
            records: list[dict[str, object]] = pending_records,
            is_final: bool = attempt == max_attempts,
        ) -> None:
            await persist_delivery_states(records, outcomes, final_attempt=is_final)

        result = await push_to_esp32_detailed(
            [record["route"] for record in pending_records],
            attempt=attempt,
            on_state=on_state,
            command_versions=[record["requested_at"].timestamp() for record in pending_records],
            expected_connection_generation=reconnect_generation,
            desired_params=desired_push,
        )
        if result.fatal_error:
            raise LifecyclePersistenceError(result.fatal_error)
        failed_records: list[dict[str, object]] = []
        for outcome in result.outcomes:
            if outcome.status != "failed":
                continue
            record = pending_records[outcome.index]
            if delivery_failure_retryable(outcome) and attempt < max_attempts:
                failed_records.append(record)
            else:
                terminal_failures.append((str(record["parameter"]), outcome.reason))
        if not failed_records:
            break
        if attempt < max_attempts:
            log.warning(
                "writer_dispatch reason=retry generation=%d attempt %d/%d failed_count=%d",
                reconnect_generation,
                attempt + 1,
                max_attempts,
                len(failed_records),
            )
            pending_records = failed_records
            await asyncio.sleep(0.5 * attempt)

    final_failures = [*prequeue_failures, *terminal_failures]
    if final_failures:
        # This block must NEVER raise: an exception here aborts the
        # dispatch-state cleanup below and locks the writer into a full
        # re-dispatch loop (the 2026-07-10/11 crash loop, ~18k rows/day).
        try:
            async with pool.acquire() as alert_conn:
                existing = await alert_conn.fetchval(
                    "SELECT id FROM alert_log WHERE alert_type = 'esp32_push_failed' AND disposition = 'open' LIMIT 1"
                )
                if existing is None:
                    failure_reasons = sorted({reason for _param, reason in final_failures})
                    payload = {
                        "alert_type": "esp32_push_failed",
                        "severity": "warning",
                        "category": "system",
                        "message": f"ESP32 direct push reached terminal failure for {len(final_failures)} command(s)",
                        "details": {
                            "failure_reasons": failure_reasons,
                            "parameters": sorted(param for param, _reason in final_failures),
                            "change_count": len(final_failures),
                        },
                    }
                    try:
                        alert = AlertEnvelope.model_validate(payload)
                    except ValidationError as e:
                        log.error("esp32_push_failed payload failed validation; writing fallback: %s", e)
                        alert = build_validation_failed_envelope(payload, e, producer="dispatcher")
                    await alert_conn.execute(
                        "INSERT INTO alert_log (alert_type, severity, category, message, details, source) "
                        "VALUES ($1, $2, 'system', $3, $4, 'dispatcher')",
                        alert.alert_type,
                        alert.severity,
                        alert.message,
                        json.dumps(alert.details),
                    )
        except Exception:
            log.exception("terminal-failure alert write failed; continuing to dispatch cleanup")

    if not _dispatch_trigger_completed(final_failures):
        shared.defer_failed_dispatch(reconnect_generation, drift_versions)
        log.error(
            "writer_reconcile reason=%s generation=%d action=incomplete failure_count=%d",
            dispatch_reason,
            reconnect_generation,
            len(final_failures),
        )
    else:
        # Completing the trigger also stops the next pass from reseeding
        # _last_pushed from readbacks that have not caught up yet.
        complete_dispatch_trigger()
        if paced_wake and dispatcher_stage.startswith("paced "):
            # After the completion, because clear_cfg_drift clears the event:
            # the task loop launches the next paced pass on its next tick.
            shared.setpoint_dispatch_requested.set()
            log.info(
                "writer_reconcile reason=paced generation=%d action=wake remaining=%d",
                reconnect_generation,
                len(paced_unsent),
            )
        elif paced_unsent and dispatcher_stage.startswith("paced "):
            # Every left-over value was already sent on this connection and not
            # taken: it waits for the 300 s cadence or a readback drift.
            log.info(
                "writer_reconcile reason=paced generation=%d action=wait remaining=%d",
                reconnect_generation,
                len(paced_unsent),
            )
    (STATE_DIR / "setpoint-dispatcher.log").touch()
