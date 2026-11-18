// SPDX-License-Identifier: MIT
/**
 * Activity (dashboard v2 screens.md section 9, parity A-01 to A-04), the parts that are plain functions: the view the
 * URL holds, the alert groups, the page that explains each alert and its window in Graphs, the Alerts status line,
 * people's names, each log entry in one line, the log's facets, day headers and its CSV. `routes/activity.tsx` and
 * `routes/activity-log.tsx` render them.
 */
import { bandAnchorUnit, bandAnchorWords } from "./band-words";
import { dateShift, dayHeader, formatNumber, formatValue, localDate, localDayStart, localWallClock, sentenceStart, shortDateTime, shortTime } from "./format";
import { graphWindowUrl } from "./graph-link";
import { lineById, lineDisplayName } from "./lines";
import type { ActivityEntry, Actor, Alert, Me, Setting } from "./operator-api";
import { viewOf, type ViewId } from "./sections";
import { RETIRED_SETTING, settingLabel } from "./settings-context";
import { settingValueText, steppedNumber, withUnit } from "./setting-values";
import { ACTOR_SOURCE_PATTERN, isAiSource } from "./vocab";
import { HISTORICAL_ALERT_TYPES, words } from "./words";

// ---------------------------------------------------------------------------------------------------- the URL
/** The log filters, passed to API-17 as the URL holds them. */
export const LOG_FILTERS = ["source", "actor", "action", "target"] as const;
export type LogFilter = (typeof LOG_FILTERS)[number];
export type LogFilters = { readonly [K in LogFilter]?: string };
/** `resolved=24h`: the alerts resolved in the last 24 h show too (API-14 `status=recent`). */
export const RESOLVED_24H = "24h";
/** API-14's largest page: the open alerts and those resolved in the last 24 h fit in one. */
export const ALERT_LIMIT = 200;
/**
 * The one API-14 read of Activity → Alerts and Now's Needs someone, under one shared key: the open alerts and those
 * resolved in the last 24 h, so Now can count what was resolved (redesign §5.1) from the read Alerts lists.
 */
export const RECENT_ALERTS = { status: "recent", limit: ALERT_LIMIT } as const;
/** The log's date range (redesign §2.1, §5.9): `from` and `to`, America/Denver days, both included. */
export const DATE_FILTERS = ["from", "to"] as const;
export type DateFilter = (typeof DATE_FILTERS)[number];
export type LogDates = { readonly [K in DateFilter]?: string };
const DAY = /^\d{4}-\d\d-\d\d$/;
/** A calendar day as `<input type="date">` holds it ("2026-11-02"), and a real one. */
export const isDay = (value: string | null | undefined): value is string =>
  typeof value === "string" && DAY.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && dateShift(value, 0) === value;

/**
 * What Activity shows, all of it in the URL so a copied link reproduces the view: `alert=<id>` (the expanded alert),
 * `resolved=24h` (the resolved group open), the log filters and the log's dates.
 */
export type ActivityView = { readonly alert: string | null; readonly resolved: boolean; readonly filters: LogFilters; readonly dates: LogDates };

export function readView(params: URLSearchParams): ActivityView {
  const filters: { [K in LogFilter]?: string } = {};
  for (const name of LOG_FILTERS) {
    const value = params.get(name)?.trim();
    if (value) filters[name] = value;
  }
  const dates: { [K in DateFilter]?: string } = {};
  for (const name of DATE_FILTERS) {
    const value = params.get(name)?.trim();
    if (isDay(value)) dates[name] = value;
  }
  return { alert: params.get("alert")?.trim() || null, resolved: params.get("resolved") === RESOLVED_24H, filters, dates };
}

/** What API-17 is asked for: the filters as the URL holds them, and the dates as instants ([from's midnight, the midnight after to)). */
export function logQuery(view: Pick<ActivityView, "filters" | "dates">): LogFilters & { from?: string; to?: string } {
  return {
    ...view.filters,
    ...(view.dates.from ? { from: localDayStart(view.dates.from) } : {}),
    ...(view.dates.to ? { to: localDayStart(dateShift(view.dates.to, 1)) } : {}),
  };
}

/**
 * `/activity` (or `base`, the log at `/activity/log`) with some parameters changed (null or "" removes one) and the
 * others kept, so the rest of the view stays.
 */
export function activityHref(current: URLSearchParams, changes: Readonly<Record<string, string | null>>, base: "/activity" | "/activity/log" = "/activity"): string {
  const next = new URLSearchParams(current);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null || value === "") next.delete(name);
    else next.set(name, value);
  }
  const search = next.toString();
  return search ? `${base}?${search}` : base;
}
/** The log's own address with some parameters changed: `/activity/log?…` (redesign §2.1, D-UX-03). */
export const logHref = (current: URLSearchParams, changes: Readonly<Record<string, string | null>>): string => activityHref(current, changes, "/activity/log");

/**
 * Where an old log link lands (D-UX-03): `/activity` with any log filter is the log now, at `/activity/log` with the same
 * query; anything else (`?alert=7`, `?resolved=24h`) stays on Alerts, and null says so.
 */
export function logRedirect(url: URL): string | null {
  return LOG_FILTERS.some((name) => url.searchParams.has(name)) ? `/activity/log${url.search}` : null;
}

/** The alert id `alert=<id>` names, or null when it names nothing an alert id could be. */
export function alertIdOf(value: string | null): number | null {
  if (value === null || !/^\d{1,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

// ---------------------------------------------------------------------------------------------------- alerts
const CLOSED = new Set<string>(["resolved", "false_positive", "suppressed"]);
/** Resolved, marked a false positive or suppressed: no longer open. */
export const isClosed = (alert: Pick<Alert, "status">): boolean => CLOSED.has(alert.status);

export type AlertGroups = { readonly open: Alert[]; readonly acknowledged: Alert[]; readonly closed: Alert[] };
/**
 * API-14's rows in its own order (severity, then age), in three groups: nobody has acknowledged it (status open, or a
 * status this build does not know), acknowledged and still open, and closed. The API merges repeats and gives the one
 * count (API-02 `alerts.open`); this only sorts its rows into groups.
 */
export function groupAlerts(rows: readonly Alert[]): AlertGroups {
  const groups: AlertGroups = { open: [], acknowledged: [], closed: [] };
  for (const row of rows) (row.status === "acknowledged" ? groups.acknowledged : isClosed(row) ? groups.closed : groups.open).push(row);
  return groups;
}

// ---------------------------------------------------------------------------------------------------- where an alert is explained
/**
 * The v2 view that explains each alert type (parity A-02): drying to Drying; the law, the band and the house's climate
 * to the climate law; relays to Equipment; the controller and its firmware to Controller; data, gaps, delivery and
 * values not confirmed to Data; the counters to the equipment record; utilities to Utilities; the review to Review;
 * water, soil and lights to theirs. A retired check, and the lab site's, have no page.
 */
const ALERT_VIEW: Readonly<Record<string, ViewId>> = {
  drying_meter_fault: "climate-drying", drying_refused_all_day: "climate-drying",
  law_state_stale: "climate-law", band_device_db_divergence: "climate-law", band_anchor_db_read_failed: "climate-law", band_fn_null: "climate-law",
  house_temp_band_drift: "climate-law", house_band_drift: "climate-law", temp_safety: "climate-law", vpd_extreme: "climate-law",
  wetting_below_vpd_band: "climate-law", furnace_saturated: "climate-law", heat_staging_inversion: "climate-law", sensor_fault: "climate-law",
  outdoor_source_none: "climate-law", outdoor_intake_only: "climate-law", outdoor_none_indoor_degraded: "climate-law", climate_action_proof_stale: "climate-law",
  relay_stuck: "system-equipment", relay_pair_forbidden: "system-equipment", relay_starts_high: "system-equipment", heat_no_power: "system-equipment",
  heat_manual_override: "system-equipment",
  esp32_reboot: "system-controller", heap_pressure_warning: "system-controller", heap_pressure_critical: "system-controller", firmware_version_mismatch: "system-controller",
  law_constants_mismatch: "system-controller", clock_unconfirmed: "system-controller", boot_stuck: "system-controller", firmware_relief_ceiling: "system-controller",
  firmware_vent_latched: "system-controller", deploy_override: "system-controller",
  setpoint_unconfirmed: "system-data", setpoint_delivery_stuck: "system-data", esp32_push_failed: "system-data", owner_value_changed: "system-data",
  daily_record_missing: "system-data", writer_absent: "system-data", telemetry_stall: "system-data", power_meter_stale: "system-data",
  payload_rejected: "system-data", alert_validation_failed: "system-data", sensor_offline: "system-data", case_sensor_only: "system-data",
  probes_disagree: "system-data",
  relay_counter_mismatch: "record-equipment", relay_counters_backstep: "record-equipment",
  utility_out_of_baseline: "record-utilities",
  daily_review_missed: "review", reviewer_wrote_climate: "review", mcp_unreachable: "review", planner_tool_dependency_failed: "review",
  leak_detected: "water-today", irrigation_fence_breach: "water-today", irrigation_run_missed: "water-today", irrigation_line_faulted: "water-today",
  irrigation_feedback_gap: "water-today",
  soil_dryout: "water-soil", soil_sensor_offline: "water-soil",
  lighting_cfg_threshold_drift: "lights-overview",
};
/** A type this build does not know goes by its category; `system` names too many things to send it anywhere. */
const CATEGORY_VIEW: Readonly<Record<string, ViewId>> = { climate: "climate-law", equipment: "system-equipment", sensor: "system-data", water: "water-today" };

export type AlertPage = { readonly to: string; readonly label: string };
/** The page that explains `alert` ("Drying", `/climate/drying`), or null for a retired check and a type with no page. */
export function alertPage(alert: Pick<Alert, "alert_type" | "category">): AlertPage | null {
  if (HISTORICAL_ALERT_TYPES.has(alert.alert_type) || alert.alert_type === "site_content_stale") return null;
  const id = Object.hasOwn(ALERT_VIEW, alert.alert_type) ? ALERT_VIEW[alert.alert_type] : Object.hasOwn(CATEGORY_VIEW, alert.category ?? "") ? CATEGORY_VIEW[alert.category ?? ""] : null;
  if (!id) return null;
  const view = viewOf(id);
  return { to: view.path, label: view.title };
}

/** The margin either side of an alert's span in Graphs, and the longest window opened (Graphs refuses a longer one). */
const WINDOW_MARGIN_MS = 2 * 3_600_000;
const WINDOW_MAX_MS = 7 * 86_400_000;
export type AlertWindow = { readonly from: number; readonly to: number; readonly href: string };
/**
 * The alert's window in Graphs (screens.md "A link that leaves the page for evidence opens Graphs on the same time
 * window"): from 2 h before it was first seen to 2 h after it was resolved, or last seen while open, at most 7 days
 * from its start. Null when its first-seen time is not a time.
 */
export function alertWindow(alert: Pick<Alert, "first_seen_at" | "last_seen_at" | "resolved_at">): AlertWindow | null {
  const first = Date.parse(alert.first_seen_at);
  if (!Number.isFinite(first)) return null;
  const ends = [alert.resolved_at, alert.last_seen_at].map((value) => (value ? Date.parse(value) : Number.NaN)).find(Number.isFinite) ?? first;
  const from = first - WINDOW_MARGIN_MS;
  const to = Math.min(Math.max(ends, first) + WINDOW_MARGIN_MS, from + WINDOW_MAX_MS);
  const href = graphWindowUrl(from, to);
  return href ? { from, to, href } : null;
}

/** A string field of an alert's `details`, or null. */
export function detailText(details: Alert["details"], key: string): string | null {
  const value = details?.[key];
  return typeof value === "string" && value ? value : null;
}

// ---------------------------------------------------------------------------------------------------- people
export type SignedIn = Pick<Me, "username" | "display_name"> | null;
/**
 * A person as the page names them. The API names people by their Authentik username (`Actor.name`, `acknowledged_by`,
 * `resolved_by`); the signed-in person reads by their display name from API-01 ("Jason"), and anyone else by the
 * username the API gives.
 */
export function personName(name: string, me: SignedIn): string {
  return me && me.display_name && name === me.username ? me.display_name : name;
}
/** The writer as a row names it: a dashboard person through `personName`; the reviewer, the agents and the host as they are. */
export function shownActor(actor: Actor, me: SignedIn): Actor {
  return actor.source === "dashboard" ? { source: actor.source, name: personName(actor.name, me) } : actor;
}

// ---------------------------------------------------------------------------------------------------- the log in words
/** What a row needs from API-09 to name a setting and print its values. */
export type SettingInfo = Pick<Setting, "label" | "kind" | "unit" | "step" | "options">;
export type Catalog = ReadonlyMap<string, SettingInfo>;
export function catalogOf(items: readonly Setting[] | null | undefined): Catalog {
  return new Map((items ?? []).map((row) => [row.param, row]));
}

type Detail = { readonly [key: string]: unknown };
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRecord = (value: unknown): value is Detail => typeof value === "object" && value !== null && !Array.isArray(value);
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d/;
const isTime = (value: unknown): value is string => typeof value === "string" && ISO_TIME.test(value) && Number.isFinite(Date.parse(value));

/** A value in a row: a setting's with its unit, ON or OFF for a switch, a time as America/Denver; null is "—". */
function valueText(value: unknown, setting?: SettingInfo, unit?: string | null): string {
  if (isNumber(value)) return setting ? settingValueText(value, setting) : unit ? withUnit(formatNumber(value), unit) : formatNumber(value);
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (isTime(value)) return shortDateTime(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
/** The value before a change: the number alone where the value after it carries the unit ("1.60 → 1.55 kPa"). */
function beforeText(value: unknown, setting?: SettingInfo, unit?: string | null): string {
  if (isNumber(value) && setting && setting.kind !== "switch" && setting.kind !== "enum") return steppedNumber(value, setting.step);
  if (isNumber(value) && !setting && unit) return formatNumber(value);
  return valueText(value, setting, unit);
}
/** "1.60 → 1.55 kPa", or only the value when there is no before (`before` undefined). */
export function changeText(before: unknown, after: unknown, setting?: SettingInfo, unit?: string | null): string {
  return before === undefined ? valueText(after, setting, unit) : `${beforeText(before, setting, unit)} → ${valueText(after, setting, unit)}`;
}

/**
 * "set by hand" when the write marked the item as set by a person (the reviewer may not change it); "no longer set by
 * hand" when it took that mark off.
 */
export function manualText(manual: unknown): string | null {
  if (manual === true) return "set by hand";
  if (!isRecord(manual)) return null;
  if (manual.before === true && manual.after === false) return "no longer set by hand";
  return manual.after === true ? "set by hand" : null;
}

export type ListedChange = { readonly param: string; readonly value: number | null; readonly before?: number | null; readonly ts: string | null };
/**
 * A row's `detail.changes`: the band's save (`band.write`, each edge with `param`, `before` and `value`) and the retired
 * `plan.write` rows, whose two writers stored `ts`, `param` and `value` (#1171) or `param`, `before` and `value` (#1178).
 * An entry without a param is left out.
 */
export function listedChanges(detail: Detail | undefined): ListedChange[] {
  const list = detail?.changes;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item): ListedChange[] => {
    if (!isRecord(item) || typeof item.param !== "string" || !item.param) return [];
    const ts = typeof item.ts === "string" ? item.ts : typeof item.at === "string" ? item.at : null;
    const change = { param: item.param, value: isNumber(item.value) ? item.value : null, ts };
    return ["before" in item ? { ...change, before: isNumber(item.before) ? item.before : null } : change];
  });
}
/**
 * A setting as a row names it (A8): a band edge in words ("Temperature low edge at sunrise", `bandAnchorWords`), else
 * its catalog label (`settingLabel`); a key the catalog no longer has reads "Retired setting (key)", and while the
 * catalog is not loaded "—". Never the raw key, nor the catalog's label of a band key ("Band Temp Low SR").
 */
export function settingWords(param: string, catalog: Catalog): string {
  const setting = catalog.get(param);
  if (setting) return settingLabel({ param, label: setting.label });
  const anchor = bandAnchorWords(param);
  if (anchor) return sentenceStart(anchor);
  return catalog.size ? `${RETIRED_SETTING} (${param})` : "—";
}

/**
 * One change in words, with the setting's name (`settingWords`) and its unit: "Temperature low edge at sunrise 60 → 58
 * °F" (with its before), "VPD Mister Engage 1.70 kPa from 13:00" (an old row with a time), the date added when that
 * time is on another day than `day`. A band edge the catalog does not list still takes its unit from its key.
 */
export function listedChangeText(change: ListedChange, catalog: Catalog, day?: string): string {
  const setting = catalog.get(change.param);
  const when = change.ts && isTime(change.ts) ? ` from ${day !== undefined && localDate(change.ts) !== day ? shortDateTime(change.ts) : shortTime(change.ts)}` : "";
  return `${settingWords(change.param, catalog)} ${changeText(change.before, change.value, setting, setting ? undefined : bandAnchorUnit(change.param))}${when}`;
}

/**
 * The target as a row names it: a setting's label, an alert's title, "every line" for `all`, a line's name (never its
 * relay code), a light's name; nothing for the band's save and the retired settings rows, whose words say it all; else
 * as the API gives it.
 */
function targetLabel(entry: ActivityEntry, catalog: Catalog): string {
  const { action, target } = entry;
  const detail: Detail = entry.detail ?? {};
  if (action.startsWith("setting.")) return settingWords(target, catalog);
  if (action === "plan.write" || action === "band.write") return "";
  if (action.startsWith("alert.")) return typeof detail.alert_type === "string" ? `“${words("alert_type", detail.alert_type)}”` : `alert ${target}`;
  if (action.startsWith("irrigation.") && target === "all") return "every line";
  if (lineById(target)) return lineDisplayName(target);
  if (action.startsWith("light.")) return words("light_target", target);
  return target;
}
/** A row's title: the action in words, then its target ("Set VPD Mister Engage"). An action this build lacks reads raw. */
export function entryTitle(entry: ActivityEntry, catalog: Catalog): string {
  const label = targetLabel(entry, catalog);
  return label ? `${words("activity_action", entry.action)} ${label}` : words("activity_action", entry.action);
}

/** The unit a schedule, line or run field counts in, from its name (`daily_cap_min`, `on_s`). */
const fieldUnit = (field: string): string | null => (field.endsWith("_min") ? "min" : field.endsWith("_s") ? "s" : null);
/** Keys of an irrigation write's `detail` that are not fields of the item it changed. */
const NOT_FIELDS = new Set(["before", "value", "manual", "line_id", "command_id", "stopped", "reason", "ref", "trigger_id", "planner_instance", "args"]);
function fieldText(field: string, before: unknown, after: unknown): string | null {
  if (Array.isArray(after) || isRecord(after)) return null;
  if (field === "paused_until") return after === null ? "resumed" : `paused until ${valueText(after)}`;
  if (field === "checked") return after === true ? "check recorded" : null;
  return `${words("irrigation_field", field)} ${changeText(before, after, undefined, fieldUnit(field))}`;
}
/**
 * A schedule or line update in words: each field that differs between `detail.before` and `detail.value`
 * ("Daily cap 60 → 45 min"), or, when the row carries only the request, each field it set ("Enabled off").
 */
function fieldChanges(detail: Detail): string[] {
  const out: string[] = [];
  if (isRecord(detail.before) || isRecord(detail.value)) {
    const before = isRecord(detail.before) ? detail.before : {};
    const after = isRecord(detail.value) ? detail.value : {};
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (NOT_FIELDS.has(field) || JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
      const text = fieldText(field, field in before ? before[field] : undefined, field in after ? after[field] : null);
      if (text) out.push(text);
    }
    return out;
  }
  for (const [field, value] of Object.entries(detail)) {
    const text = NOT_FIELDS.has(field) ? null : fieldText(field, undefined, value);
    if (text) out.push(text);
  }
  return out;
}
/**
 * A run's length: "12 min", or a mister's "4 × 45 s, 60 s apart", with any prewet and flush. The fields sit in the
 * detail itself (the L01 bridge's `minutes`) or in the command's `args`.
 */
function runText(written: Detail): string | null {
  const detail: Detail = isRecord(written.args) ? { ...written, ...written.args } : written;
  const parts: string[] = [];
  if (isNumber(detail.minutes)) parts.push(formatValue(detail.minutes, "min"));
  if (isNumber(detail.on_s)) {
    const pulses = isNumber(detail.count) ? `${formatNumber(detail.count)} × ` : "";
    const gap = isNumber(detail.gap_s) ? `, ${withUnit(formatNumber(detail.gap_s), "s")} apart` : "";
    parts.push(`${pulses}${withUnit(formatNumber(detail.on_s), "s")}${gap}`);
  }
  for (const field of ["prewet_s", "flush_s"] as const) if (isNumber(detail[field])) parts.push(`${words("irrigation_field", field).toLowerCase()} ${withUnit(formatNumber(detail[field]), "s")}`);
  return parts.length ? parts.join(", ") : null;
}

/**
 * What a row changed, after its writer: before → after, with "requested 1.53" when the server snapped the value (the
 * service stores `requested` on every write, so only one that differs from `value` says so); the band's one changed
 * edge; an old settings row's one change with the forecast rule by name (its id only when it has no name); a run's
 * length; a schedule or line update's fields; a light command Lutron did not confirm, in the words of its result; and
 * "set by hand" or "no longer set by hand".
 */
export function entryFacts(entry: ActivityEntry, catalog: Catalog): string[] {
  const detail: Detail = entry.detail ?? {};
  const { action } = entry;
  const facts: string[] = [];
  if (action === "plan.write" || action === "band.write") {
    const changes = listedChanges(detail);
    if (changes.length === 1) facts.push(listedChangeText(changes[0], catalog, localDate(entry.ts)));
    const ruleId = isNumber(detail.rule_id) || typeof detail.rule_id === "string" ? String(detail.rule_id) : null;
    if (typeof detail.rule === "string" && detail.rule) facts.push(`rule “${detail.rule}”`);
    else if (ruleId) facts.push(`rule ${ruleId}`);
  } else if (action.startsWith("setting.")) {
    if (action === "setting.release" || detail.value === null) facts.push("back to its default");
    else if ("value" in detail) facts.push(changeText("before" in detail ? detail.before : undefined, detail.value, catalog.get(entry.target)));
    if (isNumber(detail.requested) && detail.requested !== detail.value) facts.push(`requested ${formatNumber(detail.requested)}`);
  } else if (action === "irrigation.run") {
    const run = runText(detail);
    if (run) facts.push(run);
  } else if (action.startsWith("irrigation.")) {
    if (typeof detail.line_id === "string" && detail.line_id !== entry.target) facts.push(lineDisplayName(detail.line_id));
    if (action.endsWith(".update")) facts.push(...fieldChanges(detail));
  } else if (action.startsWith("light.")) {
    if (typeof detail.result === "string" && detail.result !== "confirmed") facts.push(words("light_result", detail.result));
  } else if (!action.startsWith("alert.") && "value" in detail && !isRecord(detail.value)) {
    facts.push(changeText("before" in detail ? detail.before : undefined, detail.value));
  }
  const manual = manualText(detail.manual);
  if (manual) facts.push(manual);
  return facts;
}

// ---------------------------------------------------------------------------------------------------- the log's facets
/** A facet: its URL value (API-17's `source`, or an `action` prefix) and its words. */
export type Facet = readonly [value: string, label: string];
/**
 * Who wrote, on API-17 `source`: people are the dashboard's writes; the reviewer writes as `iris` (its irrigation writes
 * in a daily review); `agent` is any agent; the host is `system`.
 */
export const WHO_FACETS: readonly Facet[] = [["dashboard", "People"], ["iris", "Reviewer"], ["agent", "Agents"], ["system", "Host"]];
/**
 * What changed, on API-17 `action`'s prefix match: the band's saves, settings, water, lights, crops and alerts, and the
 * runs by hand (`irrigation.override`, which Water's prefix also holds).
 */
export const WHAT_FACETS: readonly Facet[] = [
  ["band.", "Band"], ["setting.", "Settings"], ["irrigation.", "Water"], ["irrigation.override", "Run by hand"], ["light.", "Lights"], ["planting.", "Crops"],
  ["alert.", "Alerts"],
];
/** The facets plus the URL's own value when it is none of them (`agent:steward`, an old `action`), so the filter in force always shows. */
export function facetsWith(facets: readonly Facet[], current: string | undefined): Facet[] {
  if (!current || facets.some(([value]) => value === current)) return [...facets];
  const agent = current.startsWith("agent:") ? `${current.slice("agent:".length)} · agent` : current;
  return [...facets, [current, agent]];
}

// ---------------------------------------------------------------------------------------------------- the log, one line an entry
/** A day header: "Today", "Yesterday", else "Mon 3 Nov" (and the year when it is not this one; lib/format's `dayHeader`). */
export function dayHeading(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === dateShift(today, -1)) return "Yesterday";
  return dayHeader(date, today.slice(0, 4));
}
/** The entries by America/Denver day, newest first as API-17 gives them. */
export function entriesByDay(entries: readonly ActivityEntry[]): { readonly date: string; readonly entries: readonly ActivityEntry[] }[] {
  const days: { date: string; entries: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const date = localDate(entry.ts);
    const last = days.at(-1);
    if (last && last.date === date) last.entries.push(entry);
    else days.push({ date, entries: [entry] });
  }
  return days;
}

/** A host writer's key in words (A8): "forecast-engine" reads "Forecast engine". */
export const hostWriterWords = (name: string): string => sentenceStart(name.replace(/[-_]+/g, " ").trim()) || name;

/**
 * Who wrote, in text (R4, words.md section 1: name who decided, never "the system"): `dashboard` "Jason · dashboard"
 * (the signed-in person by name); `iris` "Iris · reviewer" with AI; `agent:<name>` "<name> · agent" with AI; `system`
 * "<name> · host" with the writer's name in words ("Forecast engine · host", never its key), never AI. A source this
 * build does not know shows raw, without AI.
 */
export function actorWords(actor: Actor, me: SignedIn): { readonly text: string; readonly ai: boolean } {
  const { source, name } = actor;
  if (source === "iris") return { text: "Iris · reviewer", ai: true };
  if (source === "dashboard") return { text: `${personName(name, me)} · dashboard`, ai: false };
  if (source === "system") return { text: `${hostWriterWords(name)} · host`, ai: false };
  if (source.startsWith("agent:") && ACTOR_SOURCE_PATTERN.test(source)) return { text: `${source.slice("agent:".length)} · agent`, ai: isAiSource(source) };
  return { text: `${name} · ${source}`, ai: false };
}

/**
 * Why an automatic entry happened, in words: a run's schedule ("Schedule “Wall MWF”"), the reviewer's write inside a
 * daily review ("Daily review", its `trigger_id` the review run), the forecast engine's "Forecast rule", else the host
 * writer's own name. Null for a person or an agent, whose own name says it.
 */
export function causeOf(entry: ActivityEntry): string | null {
  const detail: Detail = entry.detail ?? {};
  const label = typeof detail.schedule_label === "string" && detail.schedule_label ? detail.schedule_label : typeof detail.label === "string" && entry.action === "irrigation.run" ? detail.label : null;
  if (label) return `Schedule “${label}”`;
  if (entry.actor.source === "iris") return typeof detail.trigger_id === "string" && detail.trigger_id ? "Daily review" : null;
  if (entry.actor.source !== "system") return null;
  return entry.actor.name === "forecast-engine" ? "Forecast rule" : entry.actor.name;
}

/** One entry's line: what happened, with its changes; a row of several changes lists them (`changes`) for its disclosure. */
export type EntryLine = { readonly text: string; readonly changes: readonly ListedChange[] };
/**
 * One entry in one line: the object and what changed, then the facts: "VPD Mister Engage 1.60 → 1.55 kPa · requested
 * 1.53 · set by hand", "Changed the band · 4 changes" (whose changes expand), "Forecast rule “hot afternoon” · Mister
 * Pulse Gap 45 → 60 s", "Daily review · Ran Wall drip · 12 min". An automatic entry leads with its cause; an old
 * settings row reads "Settings written before the climate law".
 */
export function entryLine(entry: ActivityEntry, catalog: Catalog): EntryLine {
  const detail: Detail = entry.detail ?? {};
  const join = (parts: readonly (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");
  if (entry.action === "plan.write" || entry.action === "band.write") {
    const changes = listedChanges(detail);
    const day = localDate(entry.ts);
    const rule = typeof detail.rule === "string" && detail.rule ? `Forecast rule “${detail.rule}”` : "Forecast rule";
    const head = entry.action === "plan.write" && entry.actor.source === "system" ? rule : words("activity_action", entry.action);
    if (changes.length > 1) return { text: join([head, `${changes.length} changes`]), changes };
    return { text: join([head, changes.length ? listedChangeText(changes[0], catalog, day) : "no changes"]), changes: [] };
  }
  const facts = entryFacts(entry, catalog);
  const cause = causeOf(entry);
  const lead = cause && cause !== entry.actor.name ? cause : null;
  if (entry.action.startsWith("setting.")) {
    const label = settingWords(entry.target, catalog);
    const [change, ...rest] = facts;
    return { text: join([lead, change ? `${label} ${change}` : label, ...rest]), changes: [] };
  }
  return { text: join([lead, entryTitle(entry, catalog), ...facts]), changes: [] };
}

// ---------------------------------------------------------------------------------------------------- CSV
/** RFC 4180: a cell with a comma, quote or line break is quoted, its quotes doubled. */
export function csvCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export const LOG_CSV_HEADERS = ["time (America/Denver)", "who", "source", "action", "target", "what", "reason", "outcome", "confirmed (America/Denver)", "request id"] as const;
/**
 * "CSV of these entries": exactly the entries loaded, newest first, one row each, with the byte-order mark spreadsheets
 * need to read the units' UTF-8. A row of several changes lists them in its "what" cell, one per line.
 */
export function logCsv(entries: readonly ActivityEntry[], catalog: Catalog, me: SignedIn): string {
  const time = (instant: string | null | undefined) => (instant && Number.isFinite(Date.parse(instant)) ? localWallClock(Date.parse(instant)).replace("T", " ") : "");
  const rows = entries.map((entry) => {
    const line = entryLine(entry, catalog);
    const what = line.changes.length ? [line.text, ...line.changes.map((change) => listedChangeText(change, catalog, localDate(entry.ts)))].join("\n") : line.text;
    return [time(entry.ts), actorWords(entry.actor, me).text, entry.actor.source, entry.action, entry.target, what, entry.reason ?? "", entry.state ?? "", time(entry.confirmed_at), entry.request_id ?? ""];
  });
  return `\uFEFF${[[...LOG_CSV_HEADERS], ...rows].map((row) => row.map((cell) => csvCell(String(cell))).join(",")).join("\r\n")}\r\n`;
}
/** "verdify-activity-2026-11-02.csv", after the newest entry's day. */
export const logCsvName = (entries: readonly ActivityEntry[]): string => `verdify-activity-${entries[0] ? localDate(entries[0].ts) : "empty"}.csv`;

// ---------------------------------------------------------------------------------------------------- the Alerts status line
/**
 * Alerts' status line (redesign §5.8): "2 open · 1 acknowledged · 3 resolved in 24 h"; on a phone (`short`) "2 open · 1
 * ack · 3 resolved". With none open it starts with what an empty list may honestly say (`coverage`: "No open alerts", or
 * why in-app alerts may be missing), so the page states the count once.
 */
export function alertsStatus({ open, acknowledged, resolved, coverage, short = false }: { open: number; acknowledged: number; resolved: number; coverage: string; short?: boolean }): string {
  return [
    open > 0 ? `${open} open` : coverage,
    acknowledged > 0 ? `${acknowledged} ${short ? "ack" : "acknowledged"}` : null,
    resolved > 0 ? `${resolved} resolved${short ? "" : " in 24 h"}` : null,
  ].filter(Boolean).join(" · ");
}
