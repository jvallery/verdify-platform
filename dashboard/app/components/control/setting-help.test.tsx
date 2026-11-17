// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// What each setting does (dashboard v2 screens §10.4, issue C28): the rewritten texts, the no-effect text, the read-only
// words, and no retired word of words.md section 3 in any name, explanation or read-only reason Settings shows for the
// rows API-09 serves (the settings fixture rendered from verdify_schemas/tunable_registry.py).
import { cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import type { Setting } from "../../lib/operator-api";
import { settingLabel } from "../../lib/settings-context";
import { NOW } from "../../lib/test-fixture-api";
import { renderUi, text } from "../test-render";
import { EFFECT_WORDS, NO_EFFECT_TEXT, STATE_WORDS, SettingHelpPanel, SettingsLegend, readOnlyWords, settingHelp } from "./setting-help";

afterEach(cleanup);

/** API-09's rows; a fixture rendered before `Setting.effect` gets it the way the generator gives it. */
const ANCHORS = ["sr", "sm", "ss", "mid"], ZONES = ["center", "south", "west", "east"];
const UNUSED = new Set([
  "mister_engage_delay_s", "mister_min_off_s", "sw_direct_wet_gate_enabled", "mister_hysteresis_kpa", "site_pressure_hpa", "direct_wet_min_temp_f",
  ...ZONES.flatMap((zone) => ANCHORS.map((anchor) => `zone_vpd_target_${zone}_${anchor}`)),
  ...["below", "above"].flatMap((side) => ZONES.map((zone) => `zone_vpd_width_${side}_${zone}`)),
  ...["center", "south", "west"].map((zone) => `zone_priority_${zone}`),
  ...["temp", "vpd"].flatMap((axis) => ANCHORS.map((anchor) => `band_${axis}_target_${anchor}`)),
]);
const rows = (): Setting[] => (fixture("in-band", { now: NOW })["API-09"].items as Setting[]).map((row) => (row.effect ? row : {
  ...row, effect: row.group === "band_in_force" ? "host" : row.control_class === "retired" || UNUSED.has(row.param) ? "none" : "controller",
}));
const rowOf = (param: string) => rows().find((row) => row.param === param)!;

/** words.md section 3, as whole words. */
const RETIRED = /\b(plans?|planned|planner|waypoints?|modes?|stages?|targets?|widths?|bias|tunables?|cascade|zone band|crop band|experiments?|study|held|scorecard|dispatcher|bursts?|bypass|setpoints?|Iris)\b/i;

test("no name, explanation or read-only reason Settings shows carries a retired word", () => {
  const found = rows().flatMap((row) => {
    const help = settingHelp(row);
    const words = readOnlyWords(row);
    return [settingLabel(row), help?.summary, help?.effect, help?.raise, help?.lower, help?.caution, words?.label, words?.definition]
      .filter((part): part is string => typeof part === "string" && RETIRED.test(part)).map((part) => `${row.param}: ${part}`);
  });
  expect(found).toEqual([]);
  const own = [...Object.values(EFFECT_WORDS), ...Object.values(STATE_WORDS)].flatMap((entry) => [entry.label, entry.definition]);
  expect(own.filter((part) => RETIRED.test(part))).toEqual([]);
});

test("a setting nothing reads says so instead of its old text; the reference link stays", () => {
  const help = settingHelp(rowOf("zone_vpd_target_center_sm"))!;
  expect(help.summary).toBe("Stored on the controller; nothing on this controller reads it.");
  expect(help.effect).toContain("changing it changes nothing");
  expect([help.raise, help.lower]).toEqual([undefined, undefined]);
  expect(help.reference_url).toBe(rowOf("zone_vpd_target_center_sm").help?.reference_url ?? null);
  expect(readOnlyWords(rowOf("band_temp_target_sm"))).toEqual({ label: "Not used", definition: NO_EFFECT_TEXT });
  // A writable setting nothing reads is not read-only: its drawer says it has no effect instead.
  expect(readOnlyWords(rowOf("mister_engage_delay_s"))).toBeNull();
});

test("the band's points, the drying cost limit and the lights say what they do to the law now", () => {
  const low = settingHelp(rowOf("band_temp_low_sr"))!;
  expect(low.summary).toBe("The low edge of the temperature band at sunrise.");
  expect(low.effect).toContain("electric heat");
  expect(low.raise).toBe("Heating starts at a warmer temperature around sunrise: a warmer house, more heating.");
  expect(settingHelp(rowOf("band_vpd_high_mid"))!.effect).toContain("the law runs the fogger, and further above it the misters");
  expect(settingHelp(rowOf("dry_cost_limit_kwh_per_kg"))!.caution).toContain("Drying page");
  expect(settingHelp(rowOf("gl_grow_target_light_minutes"))!.summary).toBe("Minutes of light a day the grow light aims for, counting bright daylight and lamp time.");
  expect(readOnlyWords(rowOf("band_temp_low_sr"))?.label).toBe("Set on Band");
  expect(readOnlyWords(rowOf("dry_cost_limit_kwh_per_kg"))?.label).toBe("Set on Drying");
  expect(readOnlyWords(rowOf("band_house_temp_low"))?.label).toBe("Worked out by the host");
  // A setting whose served text is current keeps it.
  expect(settingHelp(rowOf("sw_occupancy_inhibit"))).toEqual(rowOf("sw_occupancy_inhibit").help);
});

test("the drawer's panel: summary, what it does, raising and lowering, why it is not changed here, and what it is worked out from", () => {
  const row = rowOf("band_house_temp_low");
  const { container } = renderUi(<SettingHelpPanel setting={row} editTo={(param) => `/settings?edit=${param}`} labelOf={(param) => settingLabel({ param, label: param })} />);
  expect(text(container.querySelector(".ctl-help-summary"))).toBe("The temperature band's low edge for the house at this minute.");
  expect(text(container.querySelector(".ctl-help-readonly"))).toBe("Worked out by the host. From the band's four points at this minute; change the band on the Band page.");
  expect([...container.querySelectorAll(".ctl-help-sources a")].map((link) => [text(link), link.getAttribute("href")])[0])
    .toEqual(["Temperature low edge at sunrise", "/settings?edit=band_temp_low_sr"]);
  cleanup();
  const lights = renderUi(<SettingHelpPanel setting={rowOf("sw_gl_main_auto_mode")} />).container;
  expect([...lights.querySelectorAll(".ctl-help-list dt")].map((node) => text(node))).toEqual(["What it does", "Turning it on", "Turning it off"]);
});

test("the legend defines the three filters and the states", () => {
  const { container } = renderUi(<SettingsLegend />);
  expect([...container.querySelectorAll("dt")].map((node) => text(node))).toEqual([
    "Read by the controller", "Used by the host", "Stored and not used", "Confirmed", "Not confirmed since", "Not reported", "Reported", "Worked out by the host",
  ]);
});
