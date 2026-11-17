// SPDX-License-Identifier: MIT
/**
 * What Search finds (README section 3.2, design-system section 4): pages from lib/sections.ts, settings from the
 * settings read (label and name), relays and water lines by the names every page uses, and the glossary's terms. Pure,
 * so the dialog and its test share it.
 */
import { GLOSSARY, GLOSSARY_PATH } from "../../lib/glossary";
import { LINES } from "../../lib/lines";
import { ALL_VIEWS, sectionOf } from "../../lib/sections";
import { settingLabel } from "../../lib/settings-context";
import { WORDS } from "../../lib/words";

export type ResultGroup = "pages" | "settings" | "relays" | "lines" | "terms";
export type SearchItem = {
  readonly id: string;
  readonly group: ResultGroup;
  readonly label: string;
  /** One line under the label: a page's purpose, a setting's name, a term's definition. */
  readonly detail?: string;
  /** Where choosing it goes: a path with its query or hash. */
  readonly to: string;
  /** Other words it answers to. */
  readonly keywords?: string;
};
export type SearchGroup = { readonly group: ResultGroup; readonly label: string; readonly items: readonly SearchItem[] };

export const GROUP_LABELS: Readonly<Record<ResultGroup, string>> = { pages: "Pages", settings: "Settings", relays: "Relays", lines: "Water lines", terms: "Terms" };
const ORDER: readonly ResultGroup[] = ["pages", "settings", "relays", "lines", "terms"];
/** At most this many results in each group. */
export const PER_GROUP = 8;

/** Every view of every section; a section's breadcrumb words are among its keywords. */
export const PAGE_ITEMS: readonly SearchItem[] = ALL_VIEWS.map((view) => {
  const label = sectionOf(view.section).label;
  return { id: `page:${view.id}`, group: "pages", label: view.title, detail: view.purpose, to: view.path, keywords: `${label} ${view.tab} ${view.path}` };
});

const LINE_EQUIPMENT = new Set(LINES.map((line) => line.equipment));
/** The relays Equipment shows that are not water lines: fans, vent, heat and the lights (the controller's own switches left out). */
export const RELAY_ITEMS: readonly SearchItem[] = Object.entries(WORDS.equipment)
  .filter(([key]) => !LINE_EQUIPMENT.has(key) && !key.endsWith("_intent"))
  .map(([key, name]) => ({ id: `relay:${key}`, group: "relays", label: name, detail: "Relay", to: "/equipment", keywords: `${key} relay` }));

/** The eleven water lines by name, their code as the detail. */
export const LINE_ITEMS: readonly SearchItem[] = LINES.map((line) => ({
  id: `line:${line.id}`, group: "lines", label: line.name, detail: line.id, to: "/water", keywords: `${line.id} ${line.zone} ${line.kind}`,
}));

/** Each glossary term, its definition shown in place; choosing it opens the glossary on Settings. */
export const TERM_ITEMS: readonly SearchItem[] = Object.entries(GLOSSARY).map(([id, entry]) => ({
  id: `term:${id}`, group: "terms", label: entry.term, detail: entry.definition, to: GLOSSARY_PATH,
}));

/** A setting as the settings read (API-09) lists it; opening one opens its drawer on Settings. */
export function settingItems(settings: readonly { readonly param: string; readonly label: string }[] | null | undefined): SearchItem[] {
  return (settings ?? []).map((setting) => ({
    id: `setting:${setting.param}`, group: "settings", label: settingLabel(setting) || setting.param, detail: setting.param,
    to: `/settings?${new URLSearchParams({ edit: setting.param })}`, keywords: `${setting.label} ${setting.param.replace(/_/g, " ")}`,
  }));
}

const fold = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * The results for `query`, grouped in a fixed order (pages, settings, relays, water lines, terms), at most
 * `PER_GROUP` each, empty groups left out. Every word of the query must appear in the label, the detail or the
 * keywords; a label that starts with the query ranks first, then one that holds it, then the rest, each in its list's
 * order. An empty query finds nothing.
 */
export function searchResults(query: string, items: readonly SearchItem[]): SearchGroup[] {
  const wanted = fold(query.trim());
  if (!wanted) return [];
  const words = wanted.split(/\s+/);
  const ranked = items.flatMap((item, index) => {
    const label = fold(item.label);
    const haystack = `${label} ${fold(item.detail ?? "")} ${fold(item.keywords ?? "")}`;
    if (!words.every((word) => haystack.includes(word))) return [];
    const rank = label.startsWith(wanted) ? 0 : label.includes(wanted) ? 1 : 2;
    return [{ item, rank, index }];
  }).sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ORDER.map((group) => ({ group, label: GROUP_LABELS[group], items: ranked.filter((entry) => entry.item.group === group).slice(0, PER_GROUP).map((entry) => entry.item) }))
    .filter((group) => group.items.length > 0);
}
