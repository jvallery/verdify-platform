import { expect, test } from "vitest";
import { matchesSettingSearch } from "./settings-context";

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
