"""Operator text for the controller safety and site water cap rows (see ``verdify_schemas.setting_help``)."""

from __future__ import annotations

from verdify_schemas.setting_help._entry import HelpEntry

_LOGIC = "firmware/lib/greenhouse_logic.h"
_TYPES = "firmware/lib/greenhouse_types.h"
_CONTROLS = "firmware/greenhouse/controls.yaml"
_TUNABLES = "firmware/greenhouse/tunables.yaml"
_SENSORS = "firmware/greenhouse/sensors.yaml"
_IRR = "firmware/lib/irrigation_program.h"
_DISPATCHER = "ingestor/tasks/dispatcher.py"

ENTRIES: dict[str, HelpEntry] = {
    "mister_hysteresis_kpa": HelpEntry(
        summary="Minimum VPD drop before the misters step down a stage.",
        effect="Not used since the band-edge climate law. Misting starts 0.3 kPa above the band's high VPD edge and stops 0.05 kPa above it, a fixed gap.",
        raise_="No effect: the controller does not read this setting.",
        lower="No effect: the controller does not read this setting.",
        refs=(
            "firmware/lib/climate_law_constants_generated.h::MIST_ON_ABOVE_VPD_HIGH_KPA",
            "firmware/lib/climate_law_constants_generated.h::MIST_OFF_ABOVE_VPD_HIGH_KPA",
        ),
    ),
    "sw_gl_main_out_of_service": HelpEntry(
        summary="Marks the main grow-light fixture as dead so its on-time is not counted as light.",
        effect=(
            "When on, time the main circuit is switched on no longer counts toward its daily light minutes or the "
            "light total; only real daylight does. Use it while the fixture is broken or unplugged."
        ),
        raise_="On: the main circuit's switch-on time stops counting as delivered light.",
        lower="Off: the main circuit's switch-on time counts as light again; use once the fixture works.",
        refs=(
            f"{_LOGIC}::const bool switch_on_qualifies = current_on && !sp.out_of_service;",
            f"{_CONTROLS}::.out_of_service = id(gl_main_out_of_service)",
        ),
    ),
    "sw_gl_grow_out_of_service": HelpEntry(
        summary="Marks the grow-light fixture as dead so its on-time is not counted as light.",
        effect=(
            "When on, time the grow circuit is switched on no longer counts toward its daily light minutes or the "
            "light total; only real daylight does. Use it while the fixture is broken or unplugged."
        ),
        raise_="On: the grow circuit's switch-on time stops counting as delivered light.",
        lower="Off: the grow circuit's switch-on time counts as light again; use once the fixture works.",
        refs=(
            f"{_LOGIC}::const bool switch_on_qualifies = current_on && !sp.out_of_service;",
            f"{_CONTROLS}::.out_of_service = id(gl_grow_out_of_service)",
        ),
    ),
    "site_pressure_hpa": HelpEntry(
        summary="Barometric pressure at the greenhouse's elevation, a site constant.",
        effect=(
            "Used to compute the heat content (enthalpy) of indoor and outdoor air, which the economiser compares "
            "to decide whether venting would bring in useful air. It is not used for VPD."
        ),
        raise_="Slightly lowers the computed moisture content of both airs; the economiser decision barely moves.",
        lower="Slightly raises the computed moisture content of both airs; the economiser decision barely moves.",
        caution="Set it once for the site's elevation; it is not a tuning knob.",
        refs=(f"{_SENSORS}::float P  = id(site_pressure_hpa);",),
    ),
    "dry_cost_limit_kwh_per_kg": HelpEntry(
        summary="The most electric reheat the controller may spend per kilogram of water a drying vent removes.",
        effect=(
            "When the house is too humid, the controller vents to dry it only while the cost of that drying is at "
            "or below this limit: the heat the vent loses, made up by the electric heater, for each kilogram of "
            "water the outdoor air carries away. Drier and warmer outdoor air costs less. Only you set it, from "
            "the dashboard; agents and the planner cannot change it."
        ),
        raise_="Dries more often, also on nights when it costs more heat: drier air, more electricity.",
        lower="Dries only when the outdoor air makes it cheap; at 0, only free drying: less electricity, wetter air.",
        caution="Takes effect once the controller runs a build that reports this setting; until then it is stored only.",
        refs=(
            "verdify_schemas/climate_law.yaml::dry_cost_limit_default_kwh_per_kg",
            "ingestor/tasks/dispatcher.py::firmware has no drying cost limit",
        ),
    ),
    "sw_occupancy_inhibit": HelpEntry(
        summary="Stops misting, fog and the fans while someone is in the greenhouse.",
        effect=(
            "When on and the cameras confirm someone inside, the controller blocks misting, fog and sealed misting, "
            "and turns the fans off. Emergency heating and cooling still run."
        ),
        raise_="On: people inside do not get misted or blown on; humidity control pauses while they are there.",
        lower="Off: misting, fog and fans run as normal with people inside.",
        refs=(
            f"{_LOGIC}::return sp.occupancy_inhibit && in.occupied;",
            f"{_LOGIC}::inline bool air_blocked_by_occupancy(",
        ),
    ),
    "mister_daily_volume_max_gal": HelpEntry(
        summary="Hard daily water ceiling for misting and fog.",
        effect=(
            "Sent to the controller in the irrigation program. Once the day's mist and fog water reaches this many "
            "gallons, all misting and fog stop for the rest of the day; only emergency cooling fog may still run."
        ),
        raise_="More water may be used for misting and fog on a hot, dry day before everything stops.",
        lower="Misting and fog stop sooner on a heavy day: less water used, more risk of dry stress late in the day.",
        refs=(
            f"{_IRR}::return e.rtc->water_centigal >= uint32_t(e.prog.saf4_gal) * 100u;",
            f"{_LOGIC}::mister_volume_hard_block",
        ),
    ),
    "sched_mist_rh_max_pct": HelpEntry(
        summary="Scheduled mist pulses are skipped when indoor humidity is at or above this.",
        effect=(
            "Sent to the controller in the irrigation program. A scheduled mist pulse is skipped while indoor "
            "relative humidity is at or above this percentage."
        ),
        raise_="Scheduled pulses run in more humid air: more wetting, more risk of wet leaves.",
        lower="Scheduled pulses are skipped more often in humid air: less water, drier leaves.",
        refs=(f"{_IRR}::e.in.rh_pct >= float(e.prog.rh_ceiling_pct)",),
    ),
    "climate_yield_min": HelpEntry(
        summary="How long a drip run waits before giving way to misting or fog.",
        effect=(
            "Sent to the controller in the irrigation program. When climate control keeps asking for water during "
            "a drip run, the drip pauses after this many continuous minutes for one mist pulse or up to 2 min of "
            "fog, then resumes."
        ),
        raise_="Drip runs finish with fewer interruptions; humidity control waits longer for water.",
        lower="Drip runs give way to misting or fog sooner; drip runs take longer to finish.",
        refs=(f"{_IRR}::if (r.yield_accum_ms >= uint32_t(e.prog.climate_yield_min) * 60000u) {{",),
    ),
}
