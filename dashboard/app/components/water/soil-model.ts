// SPDX-License-Identifier: MIT
/**
 * Water → Soil's shaping (screens section 3.4, parity SO-01 to SO-03), kept apart from the components so each rule is
 * tested on its own: each probe zone's metric keys from its target row, the newest reading of each with its time, whether
 * the probe answers, is silent or has not reported, and where the moisture sits against the zone's range. A probe that has
 * not reported is said so and never drawn or counted as zero.
 */
import { formatValue } from "../../lib/format";
import type { MetricDef, Series, SoilTarget } from "../../lib/operator-api";

/** A probe that has not answered for this long is silent (the soil_sensor_offline rule's own horizon, screens section 3.4). */
export const SILENT_AFTER_S = 2 * 3600;
/** The chart's window and the window that says whether a probe has reported at all. */
export const SOIL_WINDOW_S = 7 * 86_400;
/** The window the "now" values are read from, at minute resolution. */
export const SOIL_NOW_S = 3 * 3600;

export type SoilMeasure = "moisture" | "ec" | "temp";
/** Each measure's words, in the order a zone shows them. */
export const SOIL_MEASURES: readonly { readonly measure: SoilMeasure; readonly label: string }[] = [
  { measure: "moisture", label: "Moisture" }, { measure: "ec", label: "Conductivity" }, { measure: "temp", label: "Temperature" },
];

/** "South 1" from `south_1`: the zone as the probe names it, never a crop. */
export const zoneLabel = (zone: string): string => zone.split("_").map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part)).join(" ");

/**
 * The metric keys of a zone's probe, from its target row's probe column (`soil_moisture_south_1`): the moisture column and
 * its conductivity and temperature siblings, each kept only when the registry (API-03) serves it, since API-04 refuses a key
 * it does not know. A measure the probe does not have is absent, not unknown.
 */
export function soilKeys(target: Pick<SoilTarget, "probe">, registry: readonly Pick<MetricDef, "key">[]): Partial<Record<SoilMeasure, string>> {
  const probe = target.probe;
  if (!probe || !probe.includes("moisture")) return {};
  const served = new Set(registry.map((metric) => metric.key));
  const keys: Partial<Record<SoilMeasure, string>> = {};
  const candidates: Record<SoilMeasure, string> = {
    moisture: `climate.${probe}`, ec: `climate.${probe.replace("moisture", "ec")}`, temp: `climate.${probe.replace("moisture", "temp")}`,
  };
  for (const measure of ["moisture", "ec", "temp"] as const) if (served.has(candidates[measure])) keys[measure] = candidates[measure];
  return keys;
}

/** The newest measured bucket of `key`: its average and when that bucket ended (epoch s, never after `now`); null with none. */
export function newestReading(series: Series | null | undefined, key: string | undefined, now: number): { readonly value: number; readonly at: number } | null {
  const values = key ? series?.series[key]?.avg : undefined;
  if (!series || !values) return null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    const start = series.t[index];
    if (typeof value === "number" && Number.isFinite(value) && Number.isFinite(start)) return { value, at: Math.min(start + series.bucket_s, now) };
  }
  return null;
}

export type ProbeState = "reporting" | "silent" | "never" | "unknown";
/**
 * Whether the probe answers: "reporting" with a reading inside 2 hours; "silent" with an older one inside the 7 days;
 * "never" when the probe has no moisture key or no reading in 7 days; "unknown" while the reads have not answered.
 */
export function probeState(lastAt: number | null, now: number, loaded: boolean, hasKey: boolean): ProbeState {
  if (!hasKey) return "never";
  if (lastAt === null) return loaded ? "never" : "unknown";
  return now - lastAt > SILENT_AFTER_S ? "silent" : "reporting";
}

export type RangeRelation = { readonly status: "ok" | "warn" | "critical" | "neutral"; readonly text: string };
const pct = (value: number) => formatValue(value, "%");
/**
 * Where moisture sits against the zone's range: below wilt (critical), below min or above max (warn, with by how much),
 * or in range. A silent probe's last reading is said as such with no verdict; a probe that has not reported reads "No
 * reading", never in range by default.
 */
export function rangeRelation(moisture: number | null, target: Pick<SoilTarget, "wilt_pct" | "min_pct" | "max_pct">, state: ProbeState): RangeRelation {
  if (moisture === null || state === "never" || state === "unknown") return { status: "neutral", text: "No reading" };
  const where: RangeRelation = moisture < target.wilt_pct ? { status: "critical", text: `below wilt by ${pct(target.wilt_pct - moisture)}` }
    : moisture < target.min_pct ? { status: "warn", text: `${pct(target.min_pct - moisture)} below the range` }
    : moisture > target.max_pct ? { status: "warn", text: `${pct(moisture - target.max_pct)} above the range` }
    : { status: "ok", text: "in range" };
  if (state === "silent") return { status: "neutral", text: `Last reading ${where.text}` };
  return { status: where.status, text: `${where.text.charAt(0).toUpperCase()}${where.text.slice(1)}` };
}

/** The probe's state in words: when it last answered, or that it has not. */
export function probeWords(state: ProbeState, lastAt: number | null, ago: (seconds: number) => string, now: number): string {
  if (state === "unknown") return "Checking the probe";
  if (state === "never" || lastAt === null) return "This probe has not reported in the last 7 days.";
  const age = ago(Math.max(0, now - lastAt));
  return state === "silent" ? `Silent: the probe last answered ${age}, over 2 hours ago.` : `The probe last answered ${age}.`;
}

/** The status line's summary for the page: "3 probe zones · 1 reporting · 1 outside its range". */
export function soilSummary(zones: readonly { readonly state: ProbeState; readonly relation: RangeRelation }[]): string | null {
  if (!zones.length) return null;
  const reporting = zones.filter((zone) => zone.state === "reporting").length;
  const outside = zones.filter((zone) => zone.state === "reporting" && (zone.relation.status === "warn" || zone.relation.status === "critical")).length;
  const parts = [`${zones.length} probe ${zones.length === 1 ? "zone" : "zones"}`, `${reporting} reporting`];
  if (outside) parts.push(`${outside} outside ${outside === 1 ? "its" : "their"} range`);
  return parts.join(" · ");
}

/** The moisture column for the chart: the bucket starts and their averages; null stays null, never zero. */
export function moistureLine(series: Series | null | undefined, key: string | undefined): { readonly t: readonly number[]; readonly values: readonly (number | null)[] } | null {
  const column = key ? series?.series[key] : undefined;
  if (!series || !column) return null;
  return { t: series.t, values: column.avg.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null)) };
}
