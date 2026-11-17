// SPDX-License-Identifier: MIT
import { useEffect, useId, useState } from "react";
import { Link, useLocation, useNavigationType, useSearchParams } from "react-router";
import { chartLinks } from "../charts/uplot-chart";
import { Banner } from "../components/banner";
import { SettingsSearch } from "../components/control/find-setting";
import { SettingsCatalog } from "../components/control/settings-catalog";
import { SettingDrawerHost, useReadbackStale, useSettingEdit, withParams } from "../components/control/setting-drawer";
import { EFFECT_WORDS, SettingsLegend, labelFor, settingHelp } from "../components/control/setting-help";
import { SettingsGlossary } from "../components/control/settings-glossary";
import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/layout/page-header";
import { Panel, PanelErrorBoundary, type PanelState } from "../components/panel";
import { Segmented } from "../components/segmented";
import { settingState } from "../components/setting-row";
import { GlossaryList } from "../components/term";
import { GLOSSARY } from "../lib/glossary";
import type { Setting } from "../lib/operator-api";
import { useSettingsRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";
import { SETTING_EFFECTS, matchesSettingSearch, settingEffect, settingLabel, type SettingEffect } from "../lib/settings-context";
import { useShellNow } from "../lib/shell";

export const meta = () => viewMeta("system-settings");
export const links = () => chartLinks();

/**
 * Settings (`/settings`, dashboard v2 screens §10.4): every setting API-09 serves, grouped by what it is for and filtered
 * by what reads it (`Setting.effect`). The answer first: how many settings there are, how many the controller reads, and
 * any value the controller has not confirmed. Then the settings in use, each row with its value, the controller's
 * readback, its state and its age; then the settings nothing reads, folded and worded read-only. The band's points link
 * to Band, the drying cost limit to Drying, a lighting setting to Lights. `?edit=<param>` opens the setting drawer
 * (`components/control/setting-drawer.tsx`), which saves through API-10 and releases through API-11. The search (`q`),
 * the filter (`show`), the glossary of every setting (`view=glossary`), the open drawer (`edit`) and its history window
 * (`hist`) are in the URL; `#glossary` opens the words the pages use. No greenhouse data renders in SSR.
 */

// ---------------------------------------------------------------------------------------------------- the shaping
export type SettingsFilter = "all" | SettingEffect;
export const SETTINGS_FILTERS: readonly SettingsFilter[] = ["all", ...SETTING_EFFECTS];
/** The filter the URL names (`show=`); anything else is All. */
export const filterOf = (value: string | null): SettingsFilter => (SETTINGS_FILTERS as readonly string[]).includes(value ?? "") ? value as SettingsFilter : "all";
/** A filter's name, as its segment reads. */
export const filterLabel = (filter: SettingsFilter): string => (filter === "all" ? "All" : EFFECT_WORDS[filter].label);

/** Search over the name shown, the API's label, the key and the explanation shown. */
export const matchesSearch = (row: Setting, query: string): boolean =>
  matchesSettingSearch({ param: row.param, label: `${settingLabel(row)} ${row.label}`, help: settingHelp(row) }, query);

/** A value the controller has not confirmed: requested, not confirmed or held, in the API's own state. */
export const notConfirmed = (row: Setting): boolean => settingState(row).kind === "not_confirmed";

/** The rows by what reads them, in the API's order. */
export function byEffect(rows: readonly Setting[]): Record<SettingEffect, Setting[]> {
  const out: Record<SettingEffect, Setting[]> = { controller: [], host: [], none: [] };
  for (const row of rows) out[settingEffect(row)].push(row);
  return out;
}

/**
 * The status line: "135 settings · 56 read by the controller · 0 not confirmed"; on a phone (`short`) "135 settings ·
 * 0 not confirmed". Null until API-09 first answers.
 */
export function settingsStatus(items: readonly Setting[] | null, short = false): string | null {
  if (!items) return null;
  const total = `${items.length} ${items.length === 1 ? "setting" : "settings"}`;
  const pending = `${items.filter(notConfirmed).length} not confirmed`;
  if (short) return `${total} · ${pending}`;
  return `${total} · ${byEffect(items).controller.length} read by the controller · ${pending}`;
}

/** The fold over the settings nothing reads: changing one changes nothing on this controller. */
export const UNUSED_SUMMARY = "Nothing on this controller reads these settings: changing one changes nothing.";

/** A panel's state from its read, what it would list, and whether the readbacks can be vouched for. */
function panelState(loaded: boolean, failed: boolean, rows: readonly Setting[], stale: boolean): PanelState {
  if (!loaded) return failed ? "error" : "loading";
  if (rows.length === 0) return "empty";
  return stale ? "stale" : "ready";
}

// ---------------------------------------------------------------------------------------------------- the page
export default function Settings() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { pathname } = location;
  const navigationType = useNavigationType();
  const searchOrigin = useId();
  const urlQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  // Typing is immediate local state. Our own deferred URL commits must not
  // overwrite newer keystrokes; links and browser history still restore the URL.
  useEffect(() => {
    if (navigationType === "POP" || location.state?.settingsSearch !== searchOrigin) setQuery(urlQuery);
  }, [urlQuery, location.key, location.state, navigationType, searchOrigin]);
  const read = useSettingsRead();
  const items = read.data?.items ?? null;
  const filter = filterOf(params.get("show"));
  const glossary = params.get("view") === "glossary";
  const readbackStale = useReadbackStale();
  const shellNow = useShellNow();
  const { editTo } = useSettingEdit();
  const searched = query.trim();
  const matched = items ? items.filter((row) => matchesSearch(row, query)) : [];
  const groups = byEffect(matched);
  const counts = items ? byEffect(items) : null;
  const inUse = filter === "all" ? [...groups.controller, ...groups.host] : filter === "none" ? [] : groups[filter];
  const search = (text: string) => {
    setQuery(text);
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (text) next.set("q", text); else next.delete("q");
      return next;
    }, { replace: true, preventScrollReset: true, state: { settingsSearch: searchOrigin } });
  };
  const link = (changes: Record<string, string | null>) => withParams(pathname, params, { ...changes, edit: null, hist: null });
  const count = (key: SettingsFilter) => (counts ? key === "all" ? items!.length : counts[key].length : null);
  const segments = SETTINGS_FILTERS.map((key) => {
    const n = count(key);
    return { value: key, to: link({ show: key === "all" ? null : key }), keepScroll: true, label: <>{filterLabel(key)}{n !== null && <span className="ctl-filter-count"> {n}</span>}</> };
  });
  const loaded = items !== null;
  const observedAt = shellNow.data?.freshness.readback.observed_at ?? null;
  const retry = () => { void read.refetch(); };
  const emptyAction = searched
    ? <EmptyState message={`No setting matches “${searched}”.`} widen={{ to: withParams(pathname, params, { q: null }), label: "Clear search" }} />
    : <EmptyState message="No setting of this kind." widen={{ to: link({ show: null }), label: "Show all" }} />;
  const pending = items ? items.filter(notConfirmed) : [];
  const inUseTitle = filter === "all" ? "Settings in use" : filter === "none" ? null : EFFECT_WORDS[filter].label;
  return <>
    <PageHeader view="system-settings" status={settingsStatus(items)} statusShort={settingsStatus(items, true)} actions={<SettingsSearch value={query} onChange={search} />} />
    {pending.length > 0 && <Banner tone="warn">
      {pending.length === 1 ? "1 setting is" : `${pending.length} settings are`} not confirmed by the controller:{" "}
      {pending.slice(0, 3).map((row, index) => <span key={row.param}>{index > 0 && ", "}<Link to={editTo(row.param)} preventScrollReset>{settingLabel(row)}</Link></span>)}
      {pending.length > 3 && `, and ${pending.length - 3} more`}.
    </Banner>}
    <div className="ctl-settings-tools">
      <Segmented label="Show" segments={segments} value={filter} />
      <p className="meta ctl-filter-note">{filter === "all" ? "Every setting, grouped by what it is for." : EFFECT_WORDS[filter].definition}</p>
    </div>
    {glossary
      ? <PanelErrorBoundary thing="the settings explained" onRetry={retry}>
        <Panel title="Every setting explained" thing="settings" state={loaded ? "ready" : read.isError ? "error" : "loading"} onRetry={retry} reserve="lg"
          link={{ to: link({ view: null }), label: "Back to the settings" }}>
          <SettingsGlossary rows={items ? matched : null} failed={read.isError} onRetry={retry} editTo={editTo} labelOf={labelFor(items)} empty={emptyAction} />
        </Panel>
      </PanelErrorBoundary>
      : <>
        {inUseTitle && <PanelErrorBoundary thing="settings" onRetry={retry}>
          <Panel id="settings-in-use" title={inUseTitle} thing="settings" reserve="lg" state={panelState(loaded, read.isError, inUse, readbackStale)} observedAt={observedAt}
            onRetry={retry} empty={emptyAction} link={{ to: link({ view: "glossary" }), label: "Every setting explained" }} foot={<SettingsLegend />}>
            <SettingsCatalog rows={inUse} caption={`${inUseTitle}: each setting's value, what the controller reads back and its state`} readbackStale={readbackStale} editTo={editTo} />
          </Panel>
        </PanelErrorBoundary>}
        {(filter === "all" || filter === "none") && (filter === "none" || !searched || groups.none.length > 0) && <PanelErrorBoundary thing="settings nothing reads" onRetry={retry}>
          <Panel id="settings-unused" title={`${EFFECT_WORDS.none.label}${counts ? ` · ${searched ? groups.none.length : counts.none.length}` : ""}`} thing="settings nothing reads"
            state={panelState(loaded, read.isError, groups.none, false)} onRetry={retry} empty={emptyAction}>
            <details className="ctl-unused" open={filter === "none" || searched !== ""}>
              <summary>{UNUSED_SUMMARY}</summary>
              <SettingsCatalog rows={groups.none} caption="Settings nothing on this controller reads: their stored value, readback and state" readbackStale={readbackStale} editTo={editTo} />
            </details>
          </Panel>
        </PanelErrorBoundary>}
      </>}
    <GlossaryPanel />
    <SettingDrawerHost />
  </>;
}

/** The glossary, from the one table every page's `Term` reads, so docs and MCP can cite `/settings#glossary`. */
const GLOSSARY_ENTRIES = Object.entries(GLOSSARY).map(([id, entry]) => ({ id, ...entry }));

/**
 * The glossary folded under its count, so its definitions never read as the page's own state while data is missing; a
 * link to `#glossary` or one term's `#term-<id>` opens it.
 */
function GlossaryPanel() {
  const { hash } = useLocation();
  const linked = hash === "#glossary" || hash.startsWith("#term-");
  return <Panel id="glossary" title="Words on the pages" thing="the words on the pages" state="ready">
    <details className="glossary" open={linked}>
      <summary>{GLOSSARY_ENTRIES.length} terms the pages use</summary>
      <GlossaryList entries={GLOSSARY_ENTRIES} />
    </details>
  </Panel>;
}
