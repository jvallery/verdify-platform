"""
tasks — Periodic background tasks absorbed from standalone cron scripts.

Each function is an async coroutine that takes an asyncpg.Pool and runs one
unit of work. Called by task_loop() in ingestor.py on defined intervals.

Replaces 10 cron jobs with a single in-process task scheduler.

This package was split from a single ~8050-line tasks.py module (issue #46).
It re-exports the unchanged public import surface so every
`from tasks import X` / `import tasks; tasks.X` continues to resolve.
Behaviour is identical: function bodies are byte-for-byte the originals.
"""

# Bind every submodule as a package attribute so `tasks.<submodule>` resolves
# even after a `sys.modules.pop("tasks"); import tasks` round-trip (the test
# suite does this, and the submodules stay cached). `from .X import *` alone does
# not rebind the submodule attribute when the submodule is already in sys.modules.
from . import (  # noqa: F401
    _common,
    alerts,
    band_anchors,
    confirmation,
    daily,
    dispatcher,
    forecast,
    ha,
    heartbeat,
    hydro,
    irrigation,
    liveness,
)
from ._common import *  # noqa: F401,F403
from ._common import (  # noqa: F401
    _DENVER,
    _FORECAST_STALE_SENSOR_ID,
    _FORECAST_STALE_THRESHOLD_S,
    _FORECAST_URL,
    _GL_SQL,
    _HA_STATE_FILE,
    _HYDRO_MAP,
    _LIGHT_ENTITIES,
    _OCCUPANCY_ENTITIES,
    _PHYSICS_INVARIANTS,
    _POPULATE_SITE_CONTENT_SCRIPT,
    _READBACKABLE_PARAMS,
    _SHELLY_ENTITIES,
    _SHELLY_PREFIX,
    _expected_firmware_version,
    _fetch_ha_batch,
    _fetch_ha_entity,
    _ha_prev_state,
    _ha_state,
    _last_pushed,
    _last_sent_at,
    _leak_counter,
    _leak_state,
    _load_token,
    _td,
)
from .alerts import *  # noqa: F401,F403
from .confirmation import *  # noqa: F401,F403
from .daily import *  # noqa: F401,F403
from .daily import (  # noqa: F401
    _auto_close_disposition,
    _electric_wattages,
    _refresh_daily_summary_for_date,
    _runtime_kwh_from_minutes,
)
from .dispatcher import *  # noqa: F401,F403
from .dispatcher import (  # noqa: F401
    _ai_moisture_stress_policy_supported,
    _apply_manual_overlay,
    _coerce_registry_value,
    _control_band_from_house_row,
    _direct_wet_defaults,
    _direct_wet_policy_supported,
    _dispatch_source,
    _fetch_quiet_state,
    _finite_positive,
    _heap_push_defer_active,
    _house_vpd_control_band,
    _median,
    _readback_drift,
    _record_quiet_mode,
    _should_skip,
    _upsert_change,
    _validate_physics,
    _write_clamp_audit_rows,
)
from .forecast import *  # noqa: F401,F403
from .forecast import (  # noqa: F401
    _fetch_forecast,
)
from .ha import *  # noqa: F401,F403
from .ha import (  # noqa: F401
    _load_site_content_populator,
    _refresh_site_content_corpus,
)
from .heartbeat import *  # noqa: F401,F403
from .heartbeat import (  # noqa: F401
    _normalize_hermes_run_status,
    daily_review,
    gather_review_context,
)
from .hydro import hydro_probe_sync  # noqa: F401
from .irrigation import irrigation_sync, record_engine_capability  # noqa: F401
from .liveness import ingestor_heartbeat  # noqa: F401
