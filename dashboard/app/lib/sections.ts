// SPDX-License-Identifier: MIT
/**
 * The information architecture of dashboard v2 (docs/design/dashboard/v2/README.md section 3): three groups and
 * fourteen sections, each with its views, in one order. The rail, the phone bar, the More sheet, a page's tabs, its
 * breadcrumb, its purpose line, its document title and Search all read this one model, so a label, a path or a title
 * changes in one place. A section owns every path under its views and its `aliases`, the old paths that redirect to
 * one of its views (README section 3.1).
 */

export type GroupId = "operate" | "understand" | "system";
export type SectionId =
  | "now" | "climate" | "water" | "lights" | "crops" | "hydro"
  | "record" | "graphs" | "review" | "activity"
  | "equipment" | "controller" | "data" | "settings";
export type ViewId =
  | "now"
  | "climate-law" | "climate-band" | "climate-drying"
  | "water-today" | "water-schedules" | "water-history" | "water-soil"
  | "lights-overview" | "lights-history"
  | "crops-map" | "crops-history"
  | "hydro-overview"
  | "record-days" | "record-compliance" | "record-equipment" | "record-utilities"
  | "graphs-explore" | "graphs-zones"
  | "review"
  | "activity-alerts" | "activity-log"
  | "system-equipment" | "system-controller" | "system-data" | "system-settings";
/**
 * The view ids of the first design, kept only so the route modules that still name them keep compiling while the
 * area lanes move them to v2 ids. Each resolves to the v2 view that took its place (`viewOf`). Do not use them in new
 * code; this alias list is deleted once no module names one.
 */
export type RetiredViewId =
  | "control-band" | "control-settings" | "control-equipment"
  | "graphs-climate" | "graphs-lighting" | "graphs-statistics"
  | "planner-plan" | "planner-history";

export type View = {
  readonly id: ViewId;
  readonly section: SectionId;
  /** The tab's label. */
  readonly tab: string;
  /** The page's h1 (a screen may name a focused state instead: "South zone"). */
  readonly title: string;
  readonly path: string;
  /** The page header's one line under the title: what the page is for (README section 3, "Question it answers"). */
  readonly purpose: string;
};
export type Section = {
  readonly id: SectionId;
  readonly group: GroupId;
  readonly label: string;
  /** The section's default view's path: where its nav link and its breadcrumb go. */
  readonly to: string;
  /** The views, the default first; a section with one view shows no tabs. */
  readonly views: readonly View[];
  /** Old paths it owns, each a redirect to one of its views (README section 3.1), by path. */
  readonly aliases?: Readonly<Record<string, ViewId>>;
};
export type Group = {
  readonly id: GroupId;
  readonly label: string;
  readonly sections: readonly Section[];
};

const view = (section: SectionId, id: ViewId, tab: string, title: string, path: string, purpose: string): View => ({ id, section, tab, title, path, purpose });
const section = (id: SectionId, group: GroupId, label: string, views: readonly View[], aliases?: Readonly<Record<string, ViewId>>): Section => ({
  id, group, label, to: views[0].path, views, ...(aliases ? { aliases } : {}),
});

/** README section 3, in its order. */
export const SECTIONS: readonly Section[] = [
  section("now", "operate", "Now", [view("now", "now", "Now", "Now", "/", "Whether the house is all right, and what needs you.")]),
  section("climate", "operate", "Climate", [
    view("climate", "climate-law", "Law", "Climate law", "/climate", "What the controller is doing to hold the band, and why."),
    view("climate", "climate-band", "Band", "Band", "/band", "The band you want the house held in."),
    view("climate", "climate-drying", "Drying", "Drying", "/climate/drying", "Whether drying the air is worth what it costs, and the price you set for it."),
  ]),
  section("water", "operate", "Water", [
    view("water", "water-today", "Today", "Water today", "/water", "What is being watered, and by what."),
    view("water", "water-schedules", "Schedules", "Schedules", "/water/schedules", "The schedules that water each line, and the limits they run under."),
    view("water", "water-history", "History", "Water history", "/water/history", "What was watered, when, and how much water it used."),
    view("water", "water-soil", "Soil", "Soil", "/water/soil", "Whether each zone's soil is where you want it."),
  ]),
  section("lights", "operate", "Lights", [
    view("lights", "lights-overview", "Lights", "Lights", "/lights", "Whether the lights are doing what you want."),
    view("lights", "lights-history", "History", "Light history", "/lights/history", "When each light was on, and why."),
  ], { "/graphs/lighting": "lights-history" }),
  section("crops", "operate", "Crops", [
    view("crops", "crops-map", "Map", "Crops", "/crops", "What is planted where."),
    view("crops", "crops-history", "History", "Crop history", "/crops/history", "Each planting from its first day to harvest."),
  ]),
  section("hydro", "operate", "Hydroponics", [view("hydro", "hydro-overview", "Hydroponics", "Hydroponics", "/hydroponics", "How the reservoir is, and what grows in it.")]),
  section("record", "understand", "Record", [
    view("record", "record-days", "Days", "Daily record", "/record", "How each day went, against the last week and month."),
    view("record", "record-compliance", "In band", "Time in band", "/record/compliance", "How much of each day the house spent inside the band."),
    view("record", "record-equipment", "Equipment", "Equipment record", "/record/equipment", "How often each relay started, and how long it ran, day by day."),
    view("record", "record-utilities", "Utilities", "Utilities", "/record/utilities", "The electricity, gas and water used each day."),
  ], { "/graphs/statistics": "record-days", "/graphs/scorecard": "record-days" }),
  section("graphs", "understand", "Graphs", [
    view("graphs", "graphs-explore", "Explore", "Graphs", "/graphs", "What happened, minute by minute."),
    view("graphs", "graphs-zones", "Zones", "Zones", "/graphs/zones", "How each zone compares, minute by minute."),
  ]),
  section("review", "understand", "Review", [view("review", "review", "Review", "Review", "/review", "What the daily review said, and whether a proposal is waiting for you.")],
    { "/plan": "review", "/planner": "review", "/planner/history": "review" }),
  section("activity", "understand", "Activity", [
    view("activity", "activity-alerts", "Alerts", "Alerts", "/activity", "What needs attention, and your response to it."),
    view("activity", "activity-log", "Log", "Activity log", "/activity/log", "Who changed what, and when."),
  ]),
  section("equipment", "system", "Equipment", [view("equipment", "system-equipment", "Equipment", "Equipment", "/equipment", "What every relay is doing, and running one by hand.")]),
  section("controller", "system", "Controller", [view("controller", "system-controller", "Controller", "Controller", "/system/controller", "Whether the controller is healthy.")]),
  section("data", "system", "Data", [view("data", "system-data", "Data", "Data", "/system/data", "Whether the record is complete, and whether the controller took what was sent.")]),
  section("settings", "system", "Settings", [view("settings", "system-settings", "Settings", "Settings", "/settings", "Every setting, and which ones matter.")]),
];

const GROUP_LABELS: Readonly<Record<GroupId, string>> = { operate: "Operate", understand: "Understand", system: "System" };
/** The three groups, each with its sections in order: what the rail and the More sheet list. */
export const GROUPS: readonly Group[] = (["operate", "understand", "system"] as const).map((id) => ({
  id, label: GROUP_LABELS[id], sections: SECTIONS.filter((item) => item.group === id),
}));

const VIEWS: ReadonlyMap<ViewId, View> = new Map(SECTIONS.flatMap((item) => item.views.map((entry) => [entry.id, entry] as const)));
/** Every view in order: what Search lists as pages. */
export const ALL_VIEWS: readonly View[] = [...VIEWS.values()];
const RETIRED: Readonly<Record<RetiredViewId, ViewId>> = {
  "control-band": "climate-band", "control-settings": "system-settings", "control-equipment": "system-equipment",
  "graphs-climate": "graphs-explore", "graphs-lighting": "lights-history", "graphs-statistics": "record-days",
  "planner-plan": "review", "planner-history": "review",
};
/** A v2 view id, or a retired one resolved to the view that took its place. */
export function currentViewId(id: ViewId | RetiredViewId): ViewId {
  return Object.hasOwn(RETIRED, id) ? RETIRED[id as RetiredViewId] : id as ViewId;
}

export function viewOf(id: ViewId | RetiredViewId): View {
  return VIEWS.get(currentViewId(id))!;
}
export function sectionOf(id: SectionId): Section {
  return SECTIONS.find((item) => item.id === id)!;
}
export function groupOf(id: GroupId): Group {
  return GROUPS.find((item) => item.id === id)!;
}

/** A path without its trailing slash ("/water/" is "/water"); "/" stays "/". */
export const normalPath = (path: string): string => path.replace(/\/+$/, "") || "/";
const under = (base: string, path: string) => path === base || path.startsWith(`${base}/`);

/**
 * The section that owns `path`: an old path's section first (Record owns `/graphs/statistics`, its redirect), then Now
 * for "/" alone, then the section with a view the path is at or under. Null for a path no section owns (`/auth/*`, a
 * page not found).
 */
export function sectionFor(path: string): Section | null {
  const at = normalPath(path);
  const aliased = SECTIONS.find((item) => item.aliases && Object.hasOwn(item.aliases, at));
  if (aliased) return aliased;
  if (at === "/") return SECTIONS[0];
  return SECTIONS.slice(1).find((item) => item.views.some((entry) => under(entry.path, at))) ?? null;
}

/** The view at `path`: the longest view path it is at or under ("/graphs/zones" is Zones, never Explore). */
export function viewFor(path: string): View | null {
  const at = normalPath(path);
  const owner = sectionFor(at);
  if (!owner) return null;
  if (owner.aliases && Object.hasOwn(owner.aliases, at)) return viewOf(owner.aliases[at]);
  if (owner.id === "now") return owner.views[0];
  const matches = owner.views.filter((entry) => under(entry.path, at)).sort((a, b) => b.path.length - a.path.length);
  return matches[0] ?? null;
}

/** Every old path and the path it redirects to (README section 3.1), keeping its query. */
export const MOVED: Readonly<Record<string, string>> = Object.fromEntries(
  SECTIONS.flatMap((item) => Object.entries(item.aliases ?? {}).map(([path, id]) => [path, viewOf(id).path] as const)),
);

/**
 * The document title: "Band · Climate · Verdify dashboard", or without the section when the title already names it
 * ("Climate law · Verdify dashboard", "Daily record · Verdify dashboard"). `title` names a focused state
 * ("South zone · Graphs · Verdify dashboard").
 */
export function documentTitle(id: ViewId | RetiredViewId, title?: string): string {
  const item = viewOf(id);
  const heading = title ?? item.title;
  const label = sectionOf(item.section).label;
  return heading.toLowerCase().includes(label.toLowerCase()) ? `${heading} · Verdify dashboard` : `${heading} · ${label} · Verdify dashboard`;
}
/** A route's `meta` for one view. */
export const viewMeta = (id: ViewId | RetiredViewId, title?: string) => [{ title: documentTitle(id, title) }];
