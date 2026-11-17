// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// "+ Metric" and "+ Setting" (screens.md section 7.1): the dialogs list only what Graphs can draw (the daily keys too,
// last, D-UX-04), never a key or setting the law retired, every choice is a link that changes the URL, the picker stops
// at 8 metrics per window, a metric's registry note shows where it is offered, and the keys are API-03's.
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import { CAP_TEXT, parseGraphUrl, resolveView } from "../../lib/graph-url";
import type { MetricDef, Setting } from "../../lib/operator-api";
import { renderUi, text } from "../test-render";
import { MetricPicker, cadenceWords, metricFacts, pickerGroups } from "./metric-picker";
import { SettingChooser, chooserGroups, settingChipText } from "./setting-chooser";

const SET = fixture("in-band", { now: Date.parse("2026-11-02T17:42:00Z") });
const METRICS = SET["API-03"].items as MetricDef[];
const SETTINGS = SET["API-09"].items as Setting[];
const dialog = () => document.querySelector("dialog")!;
afterEach(cleanup);

function picker(search = "") {
  const resolved = resolveView(parseGraphUrl(search).view, METRICS, SETTINGS);
  renderUi(<MetricPicker view={resolved.view} metrics={METRICS} drawn={[...resolved.climate, ...resolved.picked]} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Metric" }));
}

test("groups every metric but the forecast and retired keys in the picker's order, the daily keys last, and the filter matches label, key, unit and note", () => {
  const groups = pickerGroups(METRICS);
  expect(groups.map((group) => group.group)).toEqual(["house climate", "zones", "water and soil", "light", "outdoor", "controller", "power", "daily"]);
  expect(groups.at(-1)!.items.map((metric) => metric.key)).toEqual(METRICS.filter((metric) => metric.group === "daily" && !metric.key.startsWith("daily.iris_")).map((metric) => metric.key));
  const listed = groups.flatMap((group) => group.items);
  expect(listed.some((metric) => metric.key.startsWith("forecast."))).toBe(false);
  expect(listed.some((metric) => metric.group === "targets" || metric.key.startsWith("daily.iris_"))).toBe(false);
  expect(pickerGroups(METRICS, "gal/min").flatMap((group) => group.items.map((metric) => metric.key))).toEqual(["climate.flow_gpm"]);
  expect(pickerGroups(METRICS, "SOUTH").flatMap((group) => group.items.map((metric) => metric.key))).toEqual(["climate.temp_south", "climate.rh_south", "climate.vpd_south", "climate.soil_moisture_south_1", "climate.soil_temp_south_1", "climate.soil_ec_south_1", "climate.soil_moisture_south_2", "climate.soil_temp_south_2"]);
  // A group the picker does not name follows the named ones, before the daily keys.
  const extra = { ...METRICS[0], key: "climate.hydro_ph", label: "Hydro pH", group: "hydro", unit: "pH" };
  expect(pickerGroups([...METRICS, extra]).map((group) => group.group).slice(-2)).toEqual(["hydro", "daily"]);
  expect([60, 300, 3600, 86_400, 45].map(cadenceWords)).toEqual(["every 60 s", "every 5 min", "every hour", "every day", "every 45 s"]);
  expect(metricFacts(METRICS.find((metric) => metric.key === "climate.flow_gpm")!)).toBe("climate.flow_gpm · gal/min · every 60 s · MEASURED");
});

test("a choice links to the view plus m=<key>; the climate traces and picked metrics read On the charts", () => {
  picker("range=7d&set=band_vpd_low_sm&m=climate.flow_gpm");
  const list = within(dialog());
  expect(document.activeElement).toBe(list.getByLabelText("Filter metrics"));
  expect(list.getByRole("link", { name: /South soil moisture 1/ }).getAttribute("href")).toBe("/graphs?range=7d&set=band_vpd_low_sm&m=climate.flow_gpm&m=climate.soil_moisture_south_1");
  expect(list.queryByRole("link", { name: /Site water flow/ })).toBeNull();
  expect(list.queryByRole("link", { name: /Indoor temperature/ })).toBeNull();
  expect(text(dialog())).toContain("Indoor temperatureclimate.temp_avg · °F · every 60 s · MEASUREDOn the charts");
  // A daily key is a choice like any other: one point per day, in a panel of its own.
  expect(list.getByRole("link", { name: /Water used/ }).getAttribute("href")).toBe("/graphs?range=7d&set=band_vpd_low_sm&m=climate.flow_gpm&m=daily.water_gal");
  fireEvent.change(list.getByLabelText("Filter metrics"), { target: { value: "controller free heap" } });
  expect(list.getAllByRole("link").map((link) => link.textContent)).toEqual(["Controller free heapdiagnostics.heap_free_kb · kB · every 60 s · MEASURED"]);
  fireEvent.change(list.getByLabelText("Filter metrics"), { target: { value: "ppfd" } });
  expect(text(dialog())).toContain("Nothing matches “ppfd”.");
});

test("a metric's registry note shows where it is offered", () => {
  const noted = METRICS.find((metric) => metric.note);
  if (!noted) return;
  picker();
  expect(text(dialog())).toContain(noted.note!);
});

test("at 8 metrics per window, the preset's climate traces included, the picker says so and offers no more", () => {
  picker(["climate.temp_south", "climate.soil_moisture_south_1", "climate.flow_gpm", "climate.outdoor_temp_f", "climate.outdoor_rh_pct"].map((key) => `m=${key}`).join("&"));
  expect(within(dialog()).getByRole("status").textContent).toBe(CAP_TEXT);
  expect(within(dialog()).queryAllByRole("link")).toHaveLength(0);
});

test("+ Setting lists numeric settings in an open panel's unit, never the Band in force or read-only rows, grouped by panel", () => {
  const units = ["°F", "kPa", "%"];
  const groups = chooserGroups(SETTINGS, units);
  // A panel is checked for its rows rather than listed in full: VD-12 makes API-09's base fixture the whole rendered registry.
  const listed = (unit: string) => groups.find((group) => group.unit === unit)?.items.map((row) => row.param) ?? [];
  expect(groups.map((group) => group.unit)).toEqual(units);
  expect(listed("°F")).toContain("band_temp_low_sm");
  expect(listed("°F")).not.toContain("direct_wet_min_temp_f");
  expect(listed("kPa")).toEqual(expect.arrayContaining(["band_vpd_low_sm", "band_vpd_high_ss"]));
  // A setting nothing reads is never offered.
  expect(listed("kPa")).not.toContain("mister_hysteresis_kpa");
  // The legacy wide limits and other read-only rows are left out, and only those: a numeric row outside the group stays.
  expect(SETTINGS.find((row) => row.param === "temp_low")?.group).toBe("read_only");
  expect(listed("°F")).not.toContain("temp_low");
  expect(listed("kPa")).not.toContain("vpd_low");
  expect(listed("%")).toEqual(["sched_mist_rh_max_pct"]);
  expect(SETTINGS.some((row) => row.group === "band_in_force")).toBe(true);
  expect(groups.flatMap((group) => group.items).filter((row) => row.group === "band_in_force" || row.group === "read_only" || row.kind !== "numeric")).toEqual([]);
  expect(chooserGroups(SETTINGS, ["kPa"], "low edge at solar noon").flatMap((group) => group.items.map((row) => row.param))).toEqual(["band_vpd_low_sm"]);
  expect(settingChipText(SETTINGS.find((row) => row.param === "band_vpd_low_sm")!)).toBe("VPD low edge at solar noon · VPD");
  const resolved = resolveView(parseGraphUrl("range=72h&set=band_vpd_low_sm").view, METRICS, SETTINGS);
  renderUi(<SettingChooser view={resolved.view} settings={SETTINGS} chosen={resolved.settings} units={resolved.units} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Setting" }));
  const list = within(dialog());
  expect(list.getByRole("link", { name: /Scheduled-mist RH ceiling/ }).getAttribute("href")).toBe("/graphs?range=72h&set=band_vpd_low_sm&set=sched_mist_rh_max_pct");
  expect(text(list.getByRole("link", { name: /Scheduled-mist RH ceiling/ }))).toMatch(/^Scheduled-mist RH ceilingsched_mist_rh_max_pct · % · device \d+\.0%$/);
  expect(text(dialog())).toContain("VPD low edge at solar noonband_vpd_low_sm · kPa · device 0.86 kPaOn the charts");
  expect(text(dialog())).not.toMatch(/band_house|band_center|sw_gl_main_auto_mode|mister_min_off_s/);
  fireEvent.click(list.getByRole("button", { name: "Close" }));
  expect(dialog().open).toBe(false);
});
