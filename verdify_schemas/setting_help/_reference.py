"""Operator text for the reference rows of the settings catalog: retired and readback-context settings.

See ``verdify_schemas.setting_help``. Every row here is read-only, so none carries raise or lower text.
"""

from __future__ import annotations

from verdify_schemas.setting_help._entry import HelpEntry

_REG = "verdify_schemas/tunable_registry.py"
_CONTROLS = "firmware/greenhouse/controls.yaml"
_LOGIC = "firmware/lib/greenhouse_logic.h"
_TYPES = "firmware/lib/greenhouse_types.h"

_IRRIGATION_RETIRED = (
    "The controller ignores it and it stays at zero. Scheduled dawn and midday watering is retired; "
    "the center misters now follow only the normal VPD-driven misting."
)
_IRRIGATION_REFS = (f"{_REG}::Retired irrigation compatibility readback; ignored by firmware and fixed at zero.",)
_MICROPULSE_RETIRED = (
    "The overnight micro-pulse path was removed from the controller, so nothing reads this value. "
    "Night wetting now follows the night VPD band and the Night Stress Min Dew Margin."
)
_MICROPULSE_REFS = (
    "firmware/greenhouse/globals.yaml::CYC-4 overnight micro-pulse path DELETED",
    f"{_REG}::the CYC-4 overnight micro-pulse path was deleted from the firmware",
)

ENTRIES: dict[str, HelpEntry] = {
    # ── Retired ──────────────────────────────────────────────────────────────
    "mister_on_s": HelpEntry(
        summary="Old fixed ON time of the mister duty cycle.",
        effect="The controller no longer uses it. Misting now runs in pulses set by Mister Pulse ON and Mister Pulse Gap.",
        refs=(f"{_REG}::Current pulse controller does not consume it",),
    ),
    "mister_off_s": HelpEntry(
        summary="Old fixed OFF time of the mister duty cycle.",
        effect="The controller no longer uses it. Misting now runs in pulses set by Mister Pulse ON and Mister Pulse Gap.",
        refs=(f"{_REG}::Current pulse controller does not consume it",),
    ),
    "mister_all_on_s": HelpEntry(
        summary="Old fixed ON time when every mister zone ran together.",
        effect=(
            "The controller no longer uses it. All-zone misting uses the same pulses as single-zone misting "
            "(Mister Pulse ON and Mister Pulse Gap)."
        ),
        refs=(f"{_REG}::Deprecated legacy all-zone duty-cycle ON duration",),
    ),
    "mister_all_off_s": HelpEntry(
        summary="Old fixed OFF time when every mister zone ran together.",
        effect=(
            "The controller no longer uses it. All-zone misting uses the same pulses as single-zone misting "
            "(Mister Pulse ON and Mister Pulse Gap)."
        ),
        refs=(f"{_REG}::Deprecated legacy all-zone duty-cycle OFF duration",),
    ),
    "sw_arbiter_zone_enabled": HelpEntry(
        summary="Old switch that turned zone ranking for misting on or off.",
        effect=(
            "The controller no longer reads it. Whenever more than one mister zone may run, it always picks the "
            "zone by the Zone Priority settings and how far each zone's VPD is above its target."
        ),
        refs=("firmware/lib/irrigation_program.h::whatever sw_arbiter_zone_enabled says",),
    ),
    "feed_start_hour": HelpEntry(
        label="Feed Start Hour",
        summary="Start hour of the old fertigation window.",
        effect="The controller ignores it and it stays at zero. Watering and feeding now run from the irrigation program.",
        refs=(f'{_REG}::"feed_start_hour"',),
    ),
    "feed_end_hour": HelpEntry(
        label="Feed End Hour",
        summary="End hour of the old fertigation window.",
        effect="The controller ignores it and it stays at zero. Watering and feeding now run from the irrigation program.",
        refs=(f'{_REG}::"feed_end_hour"',),
    ),
    # ── Readback context ─────────────────────────────────────────────────────
    "sw_onchip_band_enabled": HelpEntry(
        summary="Whether the controller computes the climate band itself from the crop band anchors.",
        effect=(
            "ON (normal): the controller draws the temperature and VPD band from the Crop band anchors and the sun, "
            "so it keeps running the full daily program even offline. OFF: it falls back to the legacy wide "
            "limits (Set Temp Low/High, Set VPD Low/High)."
        ),
        caution="Read-only here because it decides which side owns the band. An alert fires when it is OFF.",
        refs=(f"{_CONTROLS}::if (id(sw_onchip_band_enabled)) {{", f"{_REG}::Decides which side owns the band"),
    ),
    "fallback_window_s": HelpEntry(
        label="Probe Watchdog Window",
        summary="How long every climate probe may be silent before the controller reboots itself.",
        effect=(
            "Checked once a minute: if no external probe has reported for longer than this, the controller "
            "restarts to recover the sensors. It ships at one hour and nothing sets it."
        ),
        refs=(f"{_CONTROLS}::> id(fallback_window_s)", f"{_CONTROLS}::App.safe_reboot();"),
    ),
    "outdoor_temp_f": HelpEntry(
        label="Outdoor Temp",
        summary="Outdoor air temperature the controller uses, from the weather station.",
        effect=(
            "Used to judge venting: the summer vent opens only when outside is cooler, the cold-vent guard "
            "holds back venting when outside is far below the band low edge, and the moisture estimate mixes "
            "in outdoor air."
        ),
        refs=(f"{_LOGIC}::outdoor_cold_for_vent", f"{_LOGIC}::const bool outdoor_cooler"),
    ),
    "outdoor_dewpoint_f": HelpEntry(
        label="Outdoor Dew Point",
        summary="Outdoor dew point the controller works out from outdoor temperature and humidity.",
        effect=(
            "Used to tell whether outside air is drier than inside. The summer vent opens only when the "
            "outdoor dew point is lower than inside by at least Vent Prefer DP Delta."
        ),
        refs=(f"{_LOGIC}::const bool outdoor_drier_dp", f"{_CONTROLS}::.outdoor_dewpoint_f = outdoor_dp,"),
    ),
}
