// SPDX-License-Identifier: MIT
// The information architecture of dashboard v2 (README section 3): three groups, fourteen sections, each view at its
// path with its tab, h1, purpose line and document title, which section and view own a path, and the old paths.
import { expect, test } from "vitest";
import {
  ALL_VIEWS, GROUPS, MOVED, SECTIONS, currentViewId, documentTitle, groupOf, normalPath, sectionFor, viewFor, viewMeta, viewOf, type ViewId,
} from "./sections";

test("three groups and fourteen sections in README section 3's order, each defaulting to its first view", () => {
  expect(GROUPS.map((group) => [group.label, group.sections.map((section) => section.label)])).toEqual([
    ["Operate", ["Now", "Climate", "Water", "Lights", "Crops", "Hydroponics"]],
    ["Understand", ["Record", "Graphs", "Review", "Activity"]],
    ["System", ["Equipment", "Controller", "Data", "Settings"]],
  ]);
  expect(GROUPS.flatMap((group) => group.sections)).toEqual(SECTIONS);
  expect(SECTIONS.map((section) => section.to)).toEqual([
    "/", "/climate", "/water", "/lights", "/crops", "/hydroponics", "/record", "/graphs", "/review", "/activity", "/equipment", "/system/controller", "/system/data", "/settings",
  ]);
  for (const section of SECTIONS) {
    expect(section.views[0].path, section.id).toBe(section.to);
    expect(groupOf(section.group).sections, section.id).toContain(section);
  }
});

test("every view's tab, h1 and path, in order, and its document title; a title that names its section drops it", () => {
  const table: [ViewId, string, string, string, string][] = [
    ["now", "Now", "Now", "/", "Now · Verdify dashboard"],
    ["climate-law", "Law", "Climate law", "/climate", "Climate law · Verdify dashboard"],
    ["climate-band", "Band", "Band", "/band", "Band · Climate · Verdify dashboard"],
    ["climate-drying", "Drying", "Drying", "/climate/drying", "Drying · Climate · Verdify dashboard"],
    ["water-today", "Today", "Water today", "/water", "Water today · Verdify dashboard"],
    ["water-schedules", "Schedules", "Schedules", "/water/schedules", "Schedules · Water · Verdify dashboard"],
    ["water-history", "History", "Water history", "/water/history", "Water history · Verdify dashboard"],
    ["water-soil", "Soil", "Soil", "/water/soil", "Soil · Water · Verdify dashboard"],
    ["lights-overview", "Lights", "Lights", "/lights", "Lights · Verdify dashboard"],
    ["lights-history", "History", "Light history", "/lights/history", "Light history · Lights · Verdify dashboard"],
    ["crops-map", "Map", "Crops", "/crops", "Crops · Verdify dashboard"],
    ["crops-history", "History", "Crop history", "/crops/history", "Crop history · Crops · Verdify dashboard"],
    ["hydro-overview", "Hydroponics", "Hydroponics", "/hydroponics", "Hydroponics · Verdify dashboard"],
    ["record-days", "Days", "Daily record", "/record", "Daily record · Verdify dashboard"],
    ["record-compliance", "In band", "Time in band", "/record/compliance", "Time in band · Record · Verdify dashboard"],
    ["record-equipment", "Equipment", "Equipment record", "/record/equipment", "Equipment record · Verdify dashboard"],
    ["record-utilities", "Utilities", "Utilities", "/record/utilities", "Utilities · Record · Verdify dashboard"],
    ["graphs-explore", "Explore", "Graphs", "/graphs", "Graphs · Verdify dashboard"],
    ["graphs-zones", "Zones", "Zones", "/graphs/zones", "Zones · Graphs · Verdify dashboard"],
    ["review", "Review", "Review", "/review", "Review · Verdify dashboard"],
    ["activity-alerts", "Alerts", "Alerts", "/activity", "Alerts · Activity · Verdify dashboard"],
    ["activity-log", "Log", "Activity log", "/activity/log", "Activity log · Verdify dashboard"],
    ["system-equipment", "Equipment", "Equipment", "/equipment", "Equipment · Verdify dashboard"],
    ["system-controller", "Controller", "Controller", "/system/controller", "Controller · Verdify dashboard"],
    ["system-data", "Data", "Data", "/system/data", "Data · Verdify dashboard"],
    ["system-settings", "Settings", "Settings", "/settings", "Settings · Verdify dashboard"],
  ];
  expect(ALL_VIEWS.map((view) => view.id)).toEqual(table.map(([id]) => id));
  for (const [id, tab, h1, path, title] of table) {
    expect([viewOf(id).tab, viewOf(id).title, viewOf(id).path], id).toEqual([tab, h1, path]);
    expect(documentTitle(id), id).toBe(title);
  }
  // A focused zone names itself; the section stays.
  expect(documentTitle("graphs-zones", "South zone")).toBe("South zone · Graphs · Verdify dashboard");
  expect(viewMeta("water-schedules")).toEqual([{ title: "Schedules · Water · Verdify dashboard" }]);
});

test("every view states its purpose in one sentence, with none of the retired words", () => {
  for (const view of ALL_VIEWS) {
    expect(view.purpose, view.id).toMatch(/^[A-Z][^.?]*\.$/);
    expect(view.purpose, view.id).not.toMatch(/\b(plan|planner|waypoint|mode|target|tunable)s?\b/i);
  }
  expect(viewOf("climate-law").purpose).toBe("What the controller is doing to hold the band, and why.");
  expect(viewOf("review").purpose).toBe("What the daily review said, and whether a proposal is waiting for you.");
});

test("a retired view id resolves to the v2 view that took its place, so modules that still name one keep working", () => {
  expect(([
    "control-band", "control-settings", "control-equipment", "graphs-climate", "graphs-lighting", "graphs-statistics", "planner-plan", "planner-history",
  ] as const).map(currentViewId)).toEqual(["climate-band", "system-settings", "system-equipment", "graphs-explore", "lights-history", "record-days", "review", "review"]);
  expect(viewOf("control-band").path).toBe("/band");
  expect(documentTitle("graphs-lighting")).toBe("Light history · Lights · Verdify dashboard");
});

test("a section owns every path under its views and its old paths; the longest view path wins; nothing else is owned", () => {
  const owned: [string, string | null, ViewId | null][] = [
    ["/", "now", "now"], ["/climate", "climate", "climate-law"], ["/climate/drying", "climate", "climate-drying"], ["/band", "climate", "climate-band"],
    ["/water", "water", "water-today"], ["/water/", "water", "water-today"], ["/water/soil", "water", "water-soil"], ["/water/schedules", "water", "water-schedules"],
    ["/lights", "lights", "lights-overview"], ["/lights/history", "lights", "lights-history"], ["/crops/history", "crops", "crops-history"],
    ["/hydroponics", "hydro", "hydro-overview"], ["/record", "record", "record-days"], ["/record/utilities", "record", "record-utilities"],
    ["/graphs", "graphs", "graphs-explore"], ["/graphs/zones", "graphs", "graphs-zones"], ["/review", "review", "review"],
    ["/activity/log", "activity", "activity-log"], ["/equipment", "equipment", "system-equipment"], ["/system/controller", "controller", "system-controller"],
    ["/system/data", "data", "system-data"], ["/settings", "settings", "system-settings"],
    // The old paths belong to the section they redirect to.
    ["/plan", "review", "review"], ["/planner", "review", "review"], ["/planner/history", "review", "review"],
    ["/graphs/statistics", "record", "record-days"], ["/graphs/scorecard", "record", "record-days"], ["/graphs/lighting", "lights", "lights-history"],
    ["/planner/experiments", null, null], ["/system", null, null], ["/more", null, null], ["/plants", null, null], ["/auth/login", null, null], ["/waterfall", null, null],
  ];
  for (const [path, section, view] of owned) {
    expect(sectionFor(path)?.id ?? null, path).toBe(section);
    expect(viewFor(path)?.id ?? null, path).toBe(view);
  }
  expect(normalPath("/water///")).toBe("/water");
  expect(normalPath("/")).toBe("/");
});

test("each old path redirects to the view its section names for it, query kept by the route modules", () => {
  expect(MOVED).toEqual({
    "/plan": "/review", "/planner": "/review", "/planner/history": "/review",
    "/graphs/statistics": "/record", "/graphs/scorecard": "/record", "/graphs/lighting": "/lights/history",
  });
  for (const [from, to] of Object.entries(MOVED)) expect(sectionFor(from), from).toBe(sectionFor(to));
});
