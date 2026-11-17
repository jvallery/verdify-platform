// SPDX-License-Identifier: MIT
import type { Setting } from "./operator-api";

/**
 * What Settings (`/settings`, dashboard v2 screens §10.4) knows about a setting beyond its value: what reads it
 * (`Setting.effect`), the group it is listed in, the plain name it is shown by, the page that owns it, and search. Pure,
 * so Settings, its drawer, the glossary and Search say the same thing.
 */

// ---------------------------------------------------------------------------------------------------- what reads it
/** `Setting.effect`: the connected controller's control loop reads it, a host task reads it, or nothing does. */
export type SettingEffect = "controller" | "host" | "none";
export const SETTING_EFFECTS: readonly SettingEffect[] = ["controller", "host", "none"];

/**
 * The served `effect`; a server from before dashboard v2 sends none, so it is worked out the way the API does: a Band in
 * force row is the host's, a retired row is read by nothing, every other row reaches the controller.
 */
export function settingEffect(row: Pick<Setting, "group" | "control_class"> & { readonly effect?: string | null }): SettingEffect {
  if (row.effect === "controller" || row.effect === "host" || row.effect === "none") return row.effect;
  if (row.group === "band_in_force") return "host";
  return row.control_class === "retired" ? "none" : "controller";
}

// ---------------------------------------------------------------------------------------------------- groups
/**
 * The registry's groups in the order Settings lists them, each named by what its settings are for. A group this build
 * does not know follows, under its raw code.
 */
export const SETTING_GROUPS: readonly (readonly [string, string])[] = [
  ["crop_band", "The band"],
  ["controller_safety", "Limits and holds"],
  ["scheduled_policy", "Lights"],
  ["planner_policy", "Misting and outdoor readings"],
  ["site_water_caps", "Water limits"],
  ["band_in_force", "Band in force"],
  ["read_only", "For reference"],
];
const GROUP_WORDS: Readonly<Record<string, string>> = Object.fromEntries(SETTING_GROUPS);
/** A group's heading; a group this build does not know reads raw. */
export const groupLabel = (group: string): string => GROUP_WORDS[group] ?? group;

/** The rows by group, in the fixed order; a group this build does not know follows, in the order first seen. */
export function groupRows<T extends Pick<Setting, "group">>(rows: readonly T[]): [string, T[]][] {
  const groups = new Map<string, T[]>(SETTING_GROUPS.map(([group]) => [group, []]));
  for (const row of rows) {
    const list = groups.get(row.group);
    if (list) list.push(row); else groups.set(row.group, [row]);
  }
  return [...groups].filter(([, list]) => list.length > 0);
}

// ---------------------------------------------------------------------------------------------------- names
const AXES: Readonly<Record<string, string>> = { temp: "Temperature", vpd: "VPD" };
const ANCHORS: Readonly<Record<string, string>> = { sr: "sunrise", sm: "solar noon", ss: "sunset", mid: "solar midnight" };
const PLACES: Readonly<Record<string, string>> = { house: "House", center: "Center", south: "South", west: "West", east: "East" };
const SIDES: Readonly<Record<string, string>> = { low: "low edge", high: "high edge", target: "middle" };
const LIGHTS: Readonly<Record<string, string>> = { main: "Main light", grow: "Grow light" };
const LIGHT_PARTS: Readonly<Record<string, string>> = {
  target_light_minutes: "minutes of light a day", lux_threshold: "daylight threshold", lux_hysteresis: "daylight margin",
  sunrise_hour: "window opens, hour", sunset_hour: "window closes, hour", sunrise_offset_min: "sunrise offset", sunset_offset_min: "sunset offset",
  min_on_s: "shortest time on", min_off_s: "shortest time off", solar_phasing: "window follows the sun", auto_mode: "switched automatically",
  out_of_service: "out of service",
};
const NAMES: Readonly<Record<string, string>> = { mister_daily_volume_max_gal: "Daily mist and fog limit" };

/** The anchor, axis and side of a band row, in words; null for any other key. */
export const anchorWords = (anchor: string): string | undefined => ANCHORS[anchor];

/**
 * The name a setting is shown by. The registry's labels name the band's points by code ("Band Temp Low SR"), the lights
 * by prefix ("GL Main …") and a few rows by words the law retired; those read in plain words here. Every other row keeps
 * the label the API serves.
 */
export function settingLabel(row: Pick<Setting, "param" | "label">): string {
  const { param } = row;
  if (Object.hasOwn(NAMES, param)) return NAMES[param];
  let match = /^band_(temp|vpd)_(low|high|target)_(sr|sm|ss|mid)$/.exec(param);
  if (match) return `${AXES[match[1]]} ${SIDES[match[2]]} at ${ANCHORS[match[3]]}`;
  match = /^band_(house|center|south|west|east)_(temp|vpd)_(low|high|target)$/.exec(param);
  if (match) return `${PLACES[match[1]]} ${AXES[match[2]].toLowerCase().replace("vpd", "VPD")} ${SIDES[match[3]]} now`;
  match = /^zone_vpd_target_(center|south|west|east)_(sr|sm|ss|mid)$/.exec(param);
  if (match) return `${PLACES[match[1]]} VPD middle at ${ANCHORS[match[2]]}`;
  match = /^zone_vpd_width_(below|above)_(center|south|west|east)$/.exec(param);
  if (match) return `${PLACES[match[2]]} VPD spread ${match[1]}`;
  match = /^(?:sw_)?gl_(main|grow)_(.+)$/.exec(param);
  if (match && Object.hasOwn(LIGHT_PARTS, match[2])) return `${LIGHTS[match[1]]}: ${LIGHT_PARTS[match[2]]}`;
  return row.label;
}

// ---------------------------------------------------------------------------------------------------- whose it is
/** The owner's two settings live on their own pages, beside their evidence (README principle 5). */
export const DRYING_LIMIT = "dry_cost_limit_kwh_per_kg";
export type OwnerPage = { readonly to: string; readonly page: string };
/**
 * The page where a setting is changed instead of here: the band's points on Band, the drying cost limit on Drying. Null
 * for every other row, which changes in the drawer.
 */
export function ownerPage(row: Pick<Setting, "param" | "group" | "control_class">): OwnerPage | null {
  if (row.param === DRYING_LIMIT) return { to: "/climate/drying", page: "Drying" };
  if (row.group === "crop_band" || row.group === "band_in_force" || /^band_(temp|vpd)_(low|high)_(sr|sm|ss|mid)$/.test(row.param)) return { to: "/band", page: "Band" };
  return null;
}
/** A lighting setting: its row also links to Lights. */
export const isLightSetting = (param: string): boolean => /^(?:sw_)?gl_(?:main|grow)_/.test(param);
/** The drawer may change it: the API takes the write, and no other page owns it. */
export const editableHere = (row: Pick<Setting, "param" | "group" | "control_class" | "writable">): boolean => row.writable && ownerPage(row) === null;

// ---------------------------------------------------------------------------------------------------- search
/**
 * Search the operator's question as well as the controller identifier: the name shown, the key, and the explanation the
 * page shows. Values and actor names are deliberately excluded: a changing readback must not make a search result
 * appear and disappear during editing.
 */
export function matchesSettingSearch(row: Pick<Setting, "param" | "label"> & { readonly help?: Partial<Record<"summary" | "effect" | "raise" | "lower" | "caution", string | null>> | null }, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const help = row.help;
  const text = [row.param, row.param.replaceAll("_", " "), row.label,
    help?.summary, help?.effect, help?.raise, help?.lower, help?.caution].filter(Boolean).join(" ").toLocaleLowerCase();
  const tokens = text.split(/[^\p{L}\p{N}_]+/u);
  return words.every((word) => tokens.some((token) => token.startsWith(word)) || (word.length > 1 && row.param.toLocaleLowerCase().includes(word)));
}
