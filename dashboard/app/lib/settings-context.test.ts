// SPDX-License-Identifier: MIT
// Settings' catalogue facts (dashboard v2 screens §10.4), pure: what reads a setting, its group, its plain name, the page
// that owns it, and search.
import { expect, test } from "vitest";
import { SETTING_GROUPS, editableHere, groupLabel, groupRows, isLightSetting, matchesSettingSearch, ownerPage, settingEffect, settingLabel } from "./settings-context";

const setting = {
  param: "gl_main_lux_threshold", label: "Main light threshold",
  help: { summary: "Daylight level for the main light", effect: "Turns on the main light when daylight falls below the threshold.",
    raise: "Turns the light on sooner.", lower: "Waits for darker conditions.", caution: "Does not extend the lighting window." },
};

test("finds a setting by its effect and a multi-word question, without requiring the controller key", () => {
  expect(matchesSettingSearch(setting, "daylight darker")).toBe(true);
  expect(matchesSettingSearch(setting, "  MAIN light  ")).toBe(true);
  expect(matchesSettingSearch(setting, "gl_main_lux")).toBe(true);
  expect(matchesSettingSearch(setting, "main lux")).toBe(true);
  expect(matchesSettingSearch(setting, "daylight irrigation")).toBe(false);
});

test("missing help remains searchable and an empty query includes every row", () => {
  expect(matchesSettingSearch({ param: "fan_delay_s", label: "Fan delay" }, "fan delay")).toBe(true);
  expect(matchesSettingSearch({ param: "fan_delay_s", label: "Fan delay" }, "daylight")).toBe(false);
  expect(matchesSettingSearch(setting, " \t ")).toBe(true);
});

test("what reads a setting: the served effect, else worked out the way the API does", () => {
  expect(settingEffect({ group: "planner_policy", control_class: "planner_policy", effect: "none" })).toBe("none");
  expect(settingEffect({ group: "band_in_force", control_class: "crop_band", effect: "host" })).toBe("host");
  // A server before dashboard v2 sends no effect.
  expect(settingEffect({ group: "band_in_force", control_class: "crop_band" })).toBe("host");
  expect(settingEffect({ group: "read_only", control_class: "retired" })).toBe("none");
  expect(settingEffect({ group: "scheduled_policy", control_class: "scheduled_policy", effect: "brand_new" })).toBe("controller");
});

test("groups follow the fixed order by what a setting is for, an unknown group after them under its code", () => {
  expect(SETTING_GROUPS.map(([group]) => group)).toEqual(["crop_band", "controller_safety", "scheduled_policy", "planner_policy", "site_water_caps", "band_in_force", "read_only"]);
  expect(SETTING_GROUPS.map(([, label]) => label)).toEqual(["The band", "Limits and holds", "Lights", "Misting and outdoor readings", "Water limits", "Band in force", "For reference"]);
  const rows = [{ group: "read_only", n: 1 }, { group: "new_group", n: 2 }, { group: "crop_band", n: 3 }, { group: "read_only", n: 4 }];
  expect(groupRows(rows).map(([group, list]) => [group, list.map((row) => row.n)])).toEqual([["crop_band", [3]], ["read_only", [1, 4]], ["new_group", [2]]]);
  expect(groupLabel("new_group")).toBe("new_group");
});

test("plain names for the band's points, the band in force, the lights and the retired words; any other label as served", () => {
  const name = (param: string, label = "Served label") => settingLabel({ param, label });
  expect(name("band_temp_low_sr")).toBe("Temperature low edge at sunrise");
  expect(name("band_vpd_high_mid")).toBe("VPD high edge at solar midnight");
  expect(name("band_temp_target_sm")).toBe("Temperature middle at solar noon");
  expect(name("band_house_vpd_target")).toBe("House VPD middle now");
  expect(name("band_center_temp_low")).toBe("Center temperature low edge now");
  expect(name("zone_vpd_target_south_ss")).toBe("South VPD middle at sunset");
  expect(name("zone_vpd_width_below_west")).toBe("West VPD spread below");
  expect(name("gl_main_target_light_minutes")).toBe("Main light: minutes of light a day");
  expect(name("sw_gl_grow_auto_mode")).toBe("Grow light: switched automatically");
  expect(name("mister_daily_volume_max_gal")).toBe("Daily mist and fog limit");
  expect(name("outdoor_staleness_max_s", "Outdoor Staleness Max")).toBe("Outdoor Staleness Max");
  expect(name("gl_main_brand_new", "GL Main Brand New")).toBe("GL Main Brand New");
});

test("the band's points and the drying cost limit are changed on their own pages; a lighting setting also links to Lights", () => {
  const row = (param: string, group: string, writable = true) => ({ param, group, control_class: group, writable });
  expect(ownerPage(row("band_temp_low_sr", "crop_band"))).toEqual({ to: "/band", page: "Band" });
  expect(ownerPage(row("band_house_temp_low", "band_in_force", false))).toEqual({ to: "/band", page: "Band" });
  expect(ownerPage(row("dry_cost_limit_kwh_per_kg", "controller_safety"))).toEqual({ to: "/climate/drying", page: "Drying" });
  expect(ownerPage(row("gl_main_lux_threshold", "scheduled_policy"))).toBeNull();
  expect([editableHere(row("band_temp_low_sr", "crop_band")), editableHere(row("dry_cost_limit_kwh_per_kg", "controller_safety"))]).toEqual([false, false]);
  expect([editableHere(row("gl_main_lux_threshold", "scheduled_policy")), editableHere(row("outdoor_temp_f", "read_only", false))]).toEqual([true, false]);
  expect(["gl_main_lux_threshold", "sw_gl_grow_auto_mode", "sw_occupancy_inhibit"].map(isLightSetting)).toEqual([true, true, false]);
});
