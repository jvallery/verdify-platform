"""Operator text for the planner rows of the settings catalog (see ``verdify_schemas.setting_help``)."""

from __future__ import annotations

from verdify_schemas.setting_help._entry import HelpEntry

ENTRIES: dict[str, HelpEntry] = {
    # controls.yaml: S1 engages after humid_s1_duration_ms >= MISTER_ENGAGE_DELAY_MS.
    "mister_engage_delay_s": HelpEntry(
        summary="Seconds of continuous humidifying demand before the first mister pulse.",
        effect="Not used since the band-edge climate law. Misting starts on the first pass the house VPD is high enough; there is no engage delay.",
        raise_="No effect: the controller does not read this setting.",
        lower="No effect: the controller does not read this setting.",
        refs=(
            "firmware/greenhouse/controls.yaml::const climate_law::MisterCommand mister_cmd = climate_law::mister_step(mister_law, mister_in);",
        ),
    ),
    # controls.yaml: climate_water_budget_block; irrigation engine soft_budget_centigal.
    "mister_water_budget_gal": HelpEntry(
        summary="Daily soft cap on mister water, in gallons.",
        effect=(
            "Once today's mister water reaches this cap, the controller stops climate misting. The irrigation "
            "program uses the same cap. A separate hard daily ceiling stops all wetting even in an emergency."
        ),
        raise_="More misting is allowed each day before the cap stops it.",
        lower="The cap stops misting and fog earlier on dry days, saving water but risking dry stress.",
        refs=(
            "firmware/greenhouse/controls.yaml::id(mister_water_today) >= pol(verdify_policy::kPF_mister_water_budget_gal",
            "firmware/greenhouse/controls.yaml::irr_in.soft_budget_centigal",
        ),
    ),
    # controls.yaml mister_zone_can_on; irrigation engine mister_min_off_s fence.
    "mister_min_off_s": HelpEntry(
        summary="Shortest time a mister zone must stay off before it may pulse again.",
        effect="Not used since the band-edge climate law. Each mister line rests a fixed 45 seconds after it closes.",
        raise_="No effect: the controller does not read this setting.",
        lower="No effect: the controller does not read this setting.",
        refs=(
            "firmware/lib/climate_law_constants_generated.h::MISTER_MIN_OFF_S",
            "firmware/greenhouse/controls.yaml::const uint32_t mister_min_off_ms = uint32_t(climate_law::MISTER_MIN_OFF_S",
        ),
    ),
    # Outdoor freshness gates the moisture-exchange estimator and the summer vent label.
    "outdoor_staleness_max_s": HelpEntry(
        summary="Oldest outdoor weather reading, in seconds, the controller still trusts.",
        effect=(
            "Outdoor temperature and humidity older than this are ignored: the controller then will not vent to dry "
            "or humidify based on outdoor air, and falls back to heat or does nothing for moisture."
        ),
        raise_="Older outdoor readings still count: venting for moisture continues through short weather-data gaps.",
        lower="Outdoor readings expire sooner: moisture venting stops quickly when weather data lags.",
        refs=(
            "firmware/lib/greenhouse_logic.h::&& in.outdoor_data_age_s < sp.outdoor_staleness_max_s;",
            "firmware/lib/greenhouse_logic.h::const bool outdoor_data_fresh = in.outdoor_data_age_s < sp.outdoor_staleness_max_s;",
        ),
    ),
    # Only feeds the moisture block-reason label in controls.yaml.
    "sw_direct_wet_gate_enabled": HelpEntry(
        summary="Older master switch for the daytime direct-wetting windows.",
        effect="Not used since the band-edge climate law. Each mister zone is allowed by the irrigation program's per-zone rule alone.",
        raise_="Turning it on changes nothing: the controller does not read this setting.",
        lower="Turning it off changes nothing: the controller does not read this setting.",
        refs=("firmware/greenhouse/controls.yaml::const bool center_wet_allowed = irr_climate_zone_allowed(",),
    ),
}
