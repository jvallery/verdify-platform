// SPDX-License-Identifier: MIT
/**
 * Lights (screens section 4.1, parity L-01 to L-09): the pure shaping of the Lights page. Each circuit as the switch
 * reports it against what the controller wants, its timer, whether the last switch was confirmed, its twelve settings in
 * four groups and its last seven days. The words here are the page's own; every code the API sends goes through
 * `words()`. No daily light integral: the house has no light sensor that can support one.
 */
import type { DailyBarDay } from "../../charts/daily-bars";
import { dateShift, formatValue, localDate, localDayStart, shortTime } from "../../lib/format";
import type { Equipment, LightingCircuit, LightingDay, LightingDays, Setting } from "../../lib/operator-api";
import { words } from "../../lib/words";
import type { LightId } from "../equipment/light-controls";
import { manualUntil } from "../equipment/light-controls";

export type LightItem = Equipment["items"][number];
export type Circuit = { readonly light: LightId; readonly equipment: string; readonly name: string; readonly token: string };

/** The two circuits in page order, with the chart colour each stands for (design-system 2.3). */
export const CIRCUITS: readonly Circuit[] = [
  { light: "main", equipment: "grow_light_main", name: "Main light", token: "--eq-light-main" },
  { light: "grow", equipment: "grow_light_grow", name: "Grow light", token: "--eq-light-grow" },
];

/** A Lutron reading older than this is not current: Home Assistant polls it about once a minute (API-13, `ha-down`). */
export const SWITCH_STALE_S = 600;

/** The timed switch's choices: 15 minutes, the API's default, up to its limit of 120 (`lights.py` MAX_MANUAL_MINUTES). */
export const HAND_MINUTES = [15, 30, 60, 120] as const;
export type HandMinutes = (typeof HAND_MINUTES)[number];

const known = (state: string | null | undefined): state is "on" | "off" => state === "on" || state === "off";

/** "on", "off" or "not reported", for a sentence. */
export const stateWord = (state: string | null | undefined): string => (known(state) ? state : "not reported");

/** The switch reading's age in seconds at `now` (epoch ms), or null without a time. */
export function switchAge(item: Pick<LightItem, "observed_at"> | null | undefined, now: number): number | null {
  const at = item?.observed_at ? Date.parse(item.observed_at) : Number.NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 1000)) : null;
}

/** The switch reading is missing or older than `SWITCH_STALE_S`. */
export function switchStale(item: Pick<LightItem, "observed_at"> | null | undefined, now: number): boolean {
  const age = switchAge(item, now);
  return age === null || age > SWITCH_STALE_S;
}

/**
 * What the controller wants and why, in one sentence: "The controller wants it off: enough daylight". The reason is the
 * controller's own (API-13 `auto_reason`, through `words("light_reason")`); its "On:" or "Off:" opening folds into the
 * sentence when it says the same as the intent.
 */
export function intentWords(item: Pick<LightItem, "intent" | "auto_reason">): string {
  if (!known(item.intent)) return "The controller has not reported what it wants";
  const want = `The controller wants it ${item.intent}`;
  if (!item.auto_reason) return want;
  const reason = words("light_reason", item.auto_reason);
  const opening = `${item.intent === "on" ? "On" : "Off"}: `;
  return reason.startsWith(opening) ? `${want}: ${reason.slice(opening.length)}` : `${want}. ${reason}`;
}

export type Mismatch = { readonly tone: "warn" | "info"; readonly text: string };
/**
 * The switch and the controller disagree. Expected while a timed switch runs (info, with when it ends); otherwise a
 * warning that names both sides. Null when they agree or either side is not reported.
 */
export function mismatch(item: Pick<LightItem, "intent" | "state" | "manual_until">): Mismatch | null {
  if (!known(item.intent) || !known(item.state) || item.intent === item.state) return null;
  const until = manualUntil(item);
  if (until !== null) return { tone: "info", text: `Switched ${item.state} by hand until ${shortTime(until)}; the controller wants it ${item.intent} and takes it back then.` };
  return { tone: "warn", text: `The switch reports ${item.state}, but the controller wants it ${item.intent}.` };
}

export type SwitchCheck = { readonly status: "ok" | "warn" | "neutral" | "info"; readonly label: string; readonly text: string };
/**
 * Whether the last switch was confirmed (L-09), from the switch's own reading: confirmed when the switch reads what the
 * controller (or a timed switch) asked for; not confirmed when it reads the other state; not reported when Home
 * Assistant has given no current reading.
 */
export function switchCheck(item: Pick<LightItem, "intent" | "state" | "manual_until" | "observed_at"> | null | undefined, now: number): SwitchCheck {
  if (!item) return { status: "neutral", label: "Not reported", text: "This light is not reported." };
  const age = switchAge(item, now);
  if (!known(item.state) || age === null || age > SWITCH_STALE_S) {
    const since = age === null ? "has not reported" : `has not reported for ${formatValue(Math.floor(age / 60), "min")}`;
    return { status: "warn", label: "Not reported", text: `The switch ${since}: Home Assistant or the network may be down. The light stays as it is until they are back.` };
  }
  if (manualUntil(item) !== null) return { status: "info", label: "By hand", text: `The switch reports ${item.state}, as switched by hand.` };
  if (!known(item.intent)) return { status: "neutral", label: "Not compared", text: `The switch reports ${item.state}; the controller has not said what it wants.` };
  if (item.intent === item.state) return { status: "ok", label: "Confirmed", text: `The switch reports ${item.state}, as the controller wants.` };
  return { status: "warn", label: "Not confirmed", text: `The controller wants it ${item.intent}, and the switch still reports ${item.state}.` };
}

// ---------------------------------------------------------------------------------------------------- the days (API-22)
/** API-22's window for the last seven local days, today included: stable within a day, so one cache entry a day. */
export function weekWindow(today: string): { from: string; to: string } {
  return { from: localDayStart(dateShift(today, -6)), to: localDayStart(dateShift(today, 1)) };
}
/** Today's local date at `now` (epoch ms). */
export const localToday = (now: number): string => localDate(new Date(now).toISOString());

/** "07:00–19:00", a window from its local start and cutoff hours; null without either. */
export function windowText(day: Pick<LightingDay, "start_hour" | "cutoff_hour"> | null | undefined): string | null {
  if (!day || day.start_hour === null || day.cutoff_hour === null) return null;
  const hour = (value: number) => `${String(Math.floor(value) % 24).padStart(2, "0")}:00`;
  return `${hour(day.start_hour)}–${hour(day.cutoff_hour)}`;
}

/** A circuit's newest day (today, while it runs). */
export const todayOf = (circuit: LightingCircuit | null | undefined): LightingDay | null => circuit?.days.at(-1) ?? null;

/** The circuit for `light` in an API-22 answer. */
export const circuitOf = (data: LightingDays | null | undefined, light: LightId): LightingCircuit | null => data?.circuits.find((item) => item.light === light) ?? null;

/** Minutes on per day, for DailyBars: today is drawn lighter and labelled "so far". */
export function minutesOnDays(circuit: LightingCircuit | null | undefined): DailyBarDay[] {
  return (circuit?.days ?? []).map((day) => ({ date: day.date, value: Number.isFinite(day.on_s) ? Math.round(day.on_s / 60) : null, ...(day.partial ? { partial: true, note: "so far" } : {}) }));
}
/** The mean of the complete days with a value, or null with none: the 7-day line covers complete days only. */
export function completeMean(days: readonly DailyBarDay[]): number | null {
  const values = days.filter((day) => !day.partial && day.value !== null).map((day) => day.value as number);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

// ---------------------------------------------------------------------------------------------------- the settings (API-09)
export type SettingFormat = "hour" | "switch" | "min" | "lx" | "s";
export type SettingDef = { readonly name: string; readonly label: string; readonly format: SettingFormat };
export type SettingGroup = { readonly key: string; readonly title: string; readonly settings: readonly SettingDef[] };

/**
 * The twelve settings of each circuit (`gl_<c>_*` and `sw_gl_<c>_*`), in four groups. `name` is the part after the
 * circuit; a switch's starts with `sw_`.
 */
export const SETTING_GROUPS: readonly SettingGroup[] = [
  { key: "window", title: "Window", settings: [
    { name: "sunrise_hour", label: "Window opens", format: "hour" },
    { name: "sunset_hour", label: "Window closes", format: "hour" },
    { name: "sw_solar_phasing", label: "Window follows the sun", format: "switch" },
    { name: "sunrise_offset_min", label: "Opening after sunrise", format: "min" },
    { name: "sunset_offset_min", label: "Closing after sunset", format: "min" },
    { name: "target_light_minutes", label: "Light minutes per day", format: "min" },
  ] },
  { key: "daylight", title: "Daylight thresholds", settings: [
    { name: "lux_threshold", label: "On when daylight is below", format: "lx" },
    { name: "lux_hysteresis", label: "Off again once it is brighter by", format: "lx" },
  ] },
  { key: "hold", title: "Hold times", settings: [
    { name: "min_on_s", label: "Minimum on time", format: "s" },
    { name: "min_off_s", label: "Minimum off time", format: "s" },
  ] },
  { key: "service", title: "Out of service", settings: [
    { name: "sw_out_of_service", label: "Out of service", format: "switch" },
    { name: "sw_auto_mode", label: "Automatic", format: "switch" },
  ] },
];

/** The setting's parameter name for a circuit: `gl_main_lux_threshold`, `sw_gl_grow_auto_mode`. */
export function paramOf(light: LightId, name: string): string {
  return name.startsWith("sw_") ? `sw_gl_${light}_${name.slice(3)}` : `gl_${light}_${name}`;
}
/** Where a setting row goes: the Settings page with that setting's drawer open. */
export const settingHref = (param: string): string => `/settings?edit=${encodeURIComponent(param)}`;

/** A setting's value in words: "07:00", "On", "40,000 lx", "2 min", "—" when not reported. */
export function settingValue(value: number | null | undefined, format: SettingFormat): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (format === "switch") return value === 0 ? "Off" : "On";
  if (format === "hour") return `${String(Math.floor(value) % 24).padStart(2, "0")}:${String(Math.round((value % 1) * 60)).padStart(2, "0")}`;
  if (format === "s") return value >= 120 ? formatValue(value / 60, "min") : `${Math.round(value)}\u00a0s`;
  return formatValue(value, format);
}

export type SettingRow = SettingDef & { readonly param: string; readonly value: string; readonly state: string | null };
/** One circuit's settings by group, each with its readback in words and its readback state; a row the API lacks reads "—". */
export function circuitSettings(light: LightId, items: readonly Setting[] | null | undefined): { group: SettingGroup; rows: SettingRow[] }[] {
  const byParam = new Map((items ?? []).map((item) => [item.param, item]));
  return SETTING_GROUPS.map((group) => ({
    group,
    rows: group.settings.map((def) => {
      const param = paramOf(light, def.name);
      const row = byParam.get(param);
      return { ...def, param, value: settingValue(row?.readback?.value, def.format), state: row?.state ?? null };
    }),
  }));
}
/** Whether API-09 serves any of the lighting settings. */
export const hasLightSettings = (items: readonly Pick<Setting, "param">[] | null | undefined): boolean => (items ?? []).some((item) => /^(sw_)?gl_(main|grow)_/.test(item.param));

// ---------------------------------------------------------------------------------------------------- the page's status line
/** The page's one sentence: which lights disagree with the controller, which run by hand, or that both agree. */
export function lightsStatus(items: readonly (LightItem | undefined)[], now: number): string {
  const parts = CIRCUITS.map((circuit, index) => {
    const item = items[index];
    if (!item) return `${circuit.name} not reported`;
    const until = manualUntil(item);
    if (until !== null) return `${circuit.name} ${stateWord(item.state)} by hand until ${shortTime(until)}`;
    if (switchStale(item, now) || !known(item.state)) return `${circuit.name} not reported`;
    if (!known(item.intent)) return `${circuit.name} ${item.state}, the controller has not said what it wants`;
    if (item.intent !== item.state) return `${circuit.name} ${item.state}, the controller wants it ${item.intent}`;
    return null;
  }).filter((part): part is string => part !== null);
  if (parts.length) return parts.join(" · ");
  const [main, grow] = items;
  return `Both lights are as the controller wants: main ${stateWord(main?.state)}, grow ${stateWord(grow?.state)}`;
}
