// SPDX-License-Identifier: MIT
import { useEffect, useMemo, useState } from "react";
import { replace, useSearchParams } from "react-router";
import { ChartStack, type StackPanel } from "../charts/chart-stack";
import { EquipmentLanes, MANUAL_LEAD_S } from "../charts/equipment-lanes";
import { localDay } from "../charts/time-axis";
import { buildTimeSeriesModel, chartNotes } from "../charts/time-series";
import type { Series, SettingHistory, SettingSteps } from "../charts/types";
import { chartLinks } from "../charts/uplot-chart";
import { EmptyState } from "../components/empty-state";
import { useClockValue } from "../components/freshness";
import { ChartChips, DrawnChips, GraphNotices, LayersMenu, PresetChips, PresetMenu, RangeForm, rangeDays, viewFields } from "../components/graphs/controls";
import { EVENTS_PAGE, WRITE_SOURCES, chartEvents, shownSources } from "../components/graphs/event-marks";
import { ControllerCharts, DryingCharts, LawLanes } from "../components/graphs/law-charts";
import { MetricPicker } from "../components/graphs/metric-picker";
import { RecordGaps, recordGapItems } from "../components/graphs/record-gaps";
import { ResolutionLine, elapsedText } from "../components/graphs/resolution-line";
import { SettingChooser } from "../components/graphs/setting-chooser";
import { StoryLine } from "../components/graphs/story-line";
import { GraphToolbar } from "../components/graphs/toolbar";
import { PageHeader } from "../components/layout/page-header";
import { PanelError } from "../components/panel";
import { Skeleton } from "../components/skeleton";
import { CONTROLLER_PANELS, DRYING_LINE_KEY, DRYING_LINE_METRIC, controllerCharts, dryingOffset, withDryingLine } from "../lib/graph-law";
import { NO_OVERLAY, OUTDOOR_TEMP_KEY, forecastSpan, outdoorOverlay, outdoorSource, withOutdoor } from "../lib/graph-overlay";
import { GRAPH_POLL_MS, identity, readFailure, slotRead, useGraphClock, useWindowReads, type WindowRead } from "../lib/graph-reads";
import { climateDimensions, climateStory, windowWords } from "../lib/graph-story";
import {
  CLIMATE_PANEL_IDS, COMPARES, LANES_TEXT, RANGES, dayCount, graphHref, graphWindow, isoOf, lanesAllowed, legacyPresetHref, panelPlans, parseGraphUrl, presetOf,
  rangeSeconds, resolveView, seriesPoints, stepSpec, windowKey, withWindow, within400, zoomOutSpec, type GraphView, type GraphWindow, type LaneGroup, type PanelPlan,
  type WindowSpec,
} from "../lib/graph-url";
import type { StateLanes } from "../lib/operator-api";
import { useControllerHealthRead, useLawRead, useSettingsRead } from "../lib/queries";
import { settingLabel } from "../lib/settings-context";
import { viewMeta } from "../lib/sections";
import { useApiDown } from "../lib/session";
import { unitLabel } from "../lib/setting-values";
import { useShellNow } from "../lib/shell";

export const meta = () => viewMeta("graphs-explore");
export const links = () => chartLinks();

/** An old preset id (README section 3.1 keeps links working): the same view under its v2 name, replacing the entry. */
export function loader({ request }: { request: Request }) {
  const to = legacyPresetHref(request.url);
  return to ? replace(to) : null;
}
// Its own function, never `= loader`: the client build splits `clientLoader` into a chunk of its own (`routes.test.ts`).
export function clientLoader({ request }: { request: Request }) {
  const to = legacyPresetHref(request.url);
  return to ? replace(to) : null;
}

/**
 * A setting history in its panel's unit, with the retired planner's waypoints taken off (screens.md section 7.1: no plan
 * layer), so only the controller's readback and the requests on their way draw. One copy per answer.
 */
const unitFixed = new WeakMap<SettingHistory, SettingHistory>();
function inPanelUnit(history: SettingHistory): SettingHistory {
  let fixed = unitFixed.get(history);
  if (!fixed) { fixed = { ...history, unit: unitLabel(history.unit), plan: [] }; unitFixed.set(history, fixed); }
  return fixed;
}

const valued = (value: number | null | undefined) => value !== null && value !== undefined && Number.isFinite(value);
/** True when the Series has no value at all for `keys`. */
const noValues = (series: Series, keys: readonly string[]) => keys.every((key) => !(series.series[key]?.avg ?? []).some(valued));
const REGISTRY = [{ id: "registry", params: {} }] as const;
/** The drying line draws as a reference line, not a palette trace. */
const REFERENCE_KEYS = [DRYING_LINE_KEY] as const;
/** The preset's climate panels before API-03 answers: their frames at their reserved heights, nothing to read yet. */
const FRAMES: readonly PanelPlan[] = [
  { id: "temperature", name: "Temperature", unit: "°F", metrics: [], daily: false },
  { id: "vpd", name: "VPD", unit: "kPa", metrics: [], daily: false },
  { id: "rh", name: "RH", unit: "%", metrics: [], daily: false },
];
const FRAME_OF = { temp: "temperature", vpd: "vpd", rh: "rh" } as const;

/** The step buttons' words for the window's length: "24 h", "7 d", "day". */
function spanOf(spec: WindowSpec, window: GraphWindow | null): string {
  if (spec.kind === "range") return spec.range === "today" ? "day" : spec.range.replace(/(\d+)([hd])$/, "$1 $2");
  if (spec.kind === "days") {
    const days = dayCount(spec.from, spec.to);
    return days === 1 ? "day" : `${days} d`;
  }
  return window ? elapsedText(window.length) : "window";
}

/** Notes the panels share, said once: "Temperature, VPD and RH: STALE · last data 10:36". */
function joinNotes(byPanel: readonly { name: string; notes: readonly string[] }[]): string[] {
  const panels = new Map<string, string[]>();
  for (const { name, notes } of byPanel) for (const note of notes) panels.set(note, [...(panels.get(note) ?? []), name]);
  const named = (names: readonly string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
  return [...panels].map(([note, names]) => (byPanel.length > 1 && names.length < byPanel.length && !note.includes(": ") ? `${named(names)}: ${note}` : note));
}

/** API-05's lanes of the groups a preset shows; every lane when it shows every group. */
const lanesOf = new WeakMap<StateLanes, Map<string, StateLanes>>();
function shownLanes(states: StateLanes | null, groups: readonly LaneGroup[] | null): StateLanes | null {
  if (!states || groups === null) return states;
  const key = groups.join();
  const byGroups = lanesOf.get(states) ?? new Map<string, StateLanes>();
  lanesOf.set(states, byGroups);
  let kept = byGroups.get(key);
  if (!kept) { kept = { ...states, lanes: states.lanes.filter((lane) => (groups as readonly string[]).includes(lane.group)) }; byGroups.set(key, kept); }
  return kept;
}

/**
 * Graphs → Explore (screens.md section 7.1, parity R-13, R-15, R-16, K-13, K-14, S-08): the preset's panels as one chart
 * stack on one time axis, with the band and its excursions shaded, the outdoor and forecast overlay on the climate
 * panels, the min–max envelope, a comparison with yesterday or last week, the event rail and the equipment lanes, all
 * over the window the URL names; then the preset's own charts (the law's requests, the price of drying and the drying
 * decision, the hardware budget). The band ahead of now is the stored band; a gap in the record is drawn as a gap and
 * listed. The story line states the window's time in band and its worst excursions. One API-04 request per panel, so a
 * slow panel fails alone. A window that includes now follows the clock every 60 s; a closed window reads once. Graphs
 * writes nothing, so a viewer sees the same page. No greenhouse data renders in SSR: the page knows now only in the
 * browser.
 */
export default function Graphs() {
  const [params] = useSearchParams();
  const search = params.toString();
  const parsed = useMemo(() => parseGraphUrl(search), [search]);
  const apiDown = useApiDown();
  const registry = slotRead(useWindowReads("API-03", REGISTRY, null), "registry");
  const catalog = useSettingsRead();
  const metricsCatalog = registry.data?.items ?? null;
  const settingsCatalog = catalog.data?.items ?? null;
  const resolved = useMemo(() => resolveView(parsed.view, metricsCatalog, settingsCatalog), [parsed.view, metricsCatalog, settingsCatalog]);
  const view = resolved.view;
  const preset = presetOf(view.preset);
  const [failing, setFailing] = useState(false);
  const now = useGraphClock(true, failing);
  const spec = view.window;
  const window = useMemo(() => (now === null ? null : graphWindow(spec, now)), [spec, now]);
  const key = window?.key ?? windowKey(spec);
  const syncKey = `verdify:graphs:${key}`;
  const frames = useMemo(() => preset.climate.map((trace) => FRAMES.find((frame) => frame.id === FRAME_OF[trace])!), [preset]);
  const plans = useMemo(() => (resolved.ready ? panelPlans([...resolved.climate, ...resolved.picked]) : frames), [resolved.ready, resolved.climate, resolved.picked, frames]);
  const climatePlans = plans.filter((plan) => !plan.daily && CLIMATE_PANEL_IDS.includes(plan.id));
  const banded = climatePlans.some((plan) => plan.id !== "rh");
  const allowed = window !== null && lanesAllowed(window);

  // What each read asks for. Series, lanes and marks read the measured window, which moves with the clock while it
  // reaches now; the band and the setting steps read the whole x range, which moves only for a chip, so a custom or exact
  // window that reaches now polls them every 60 s instead.
  const measured = window?.measured ? within400(window.measured) : null;
  const marks = window ? within400(window.x) : null;
  const marksPoll = window?.live && spec.kind !== "range" ? GRAPH_POLL_MS : null;
  const keysOf = (plan: PanelPlan) => plan.metrics.map((metric) => metric.key);
  // From 7 days with the envelope on, hourly buckets, each with its min–max; the outdoor and compare reads match them.
  const points = window ? seriesPoints(window, view.envelope) : undefined;
  const pointed = points === undefined ? {} : { points };
  const seriesSlots = resolved.ready && measured ? plans.map((plan) => ({ id: `${key}|${plan.id}|${keysOf(plan).join(",")}|${points ?? ""}`, params: { metric: keysOf(plan), from: isoOf(measured.from), to: isoOf(measured.to), ...pointed } })) : [];
  const seriesReads = useWindowReads("API-04", seriesSlots, null);
  const compared = view.compare ? COMPARES[view.compare] : null;
  const compareSlots = compared && resolved.ready && measured ? plans.map((plan) => ({
    id: `${key}|${view.compare}|${plan.id}|${points ?? ""}`, params: { metric: [plan.metrics[0].key], from: isoOf(measured.from - compared.shift), to: isoOf(measured.to - compared.shift), ...pointed },
  })) : [];
  const compareReads = useWindowReads("API-04", compareSlots, null);
  // The one house band, in force and, ahead of now, as stored.
  const band = slotRead(useWindowReads("API-06", resolved.ready && banded && marks ? [{ id: key, params: { zone: "house" as const, from: isoOf(marks.from), to: isoOf(marks.to) } }] : [], marksPoll), key);
  const historySlots = marks ? resolved.settings.map((row) => ({ id: `${key}|${row.param}`, params: { param: row.param, from: isoOf(marks.from), to: isoOf(marks.to) } })) : [];
  const historyReads = useWindowReads("API-12", historySlots, marksPoll);
  const lanesOn = preset.lanes !== false && allowed;
  const lanesWindow = lanesOn ? window.measured : null;
  const lanes = slotRead(useWindowReads("API-05", lanesWindow ? [{ id: key, params: { from: isoOf(lanesWindow.from), to: isoOf(lanesWindow.to) } }] : [], null), key);
  // The light switches, whatever the rail shows, from a timer's length before the window: the light lanes read manual or automatic.
  const switchesId = `${key}|light-switches`;
  const lightLanes = preset.lanes === null || (preset.lanes !== false && (preset.lanes as readonly string[]).includes("light"));
  const switches = slotRead(useWindowReads("API-17", lanesWindow && lightLanes ? [{ id: switchesId, params: { from: isoOf(lanesWindow.from - MANUAL_LEAD_S), to: isoOf(lanesWindow.to), action: "light.", limit: EVENTS_PAGE } }] : [], null), switchesId);
  // The overlay reads what API-03 lists and draws only on the climate panels, so an Outdoor or Water preset never doubles it.
  const overlayOn = view.outdoor && preset.climate.length > 0;
  const overlay = useMemo(() => (overlayOn ? outdoorOverlay(metricsCatalog) : NO_OVERLAY), [overlayOn, metricsCatalog]);
  const outdoorId = `${key}|outdoor|${points ?? ""}`, forecastId = `${key}|forecast`;
  const outdoor = slotRead(useWindowReads("API-04", measured && overlay.keys.length ? [{ id: outdoorId, params: { metric: [...overlay.keys], from: isoOf(measured.from), to: isoOf(measured.to), ...pointed } }] : [], null), outdoorId);
  const ahead = window && now !== null && overlay.forecast.length ? forecastSpan(window, now) : null;
  const forecastRead = slotRead(useWindowReads("API-04", ahead ? [{ id: forecastId, params: { metric: overlay.forecast.map((metric) => metric.key), from: isoOf(ahead.from), to: isoOf(ahead.to), points: ahead.points } }] : [], null), forecastId);
  const forecast = useMemo(() => ({ metrics: overlay.forecast, series: forecastRead.data }), [overlay.forecast, forecastRead.data]);
  const outdoorReading = useShellNow().data?.outdoor.temp_f ?? null;
  const outdoorCadence = overlay.metrics.find((metric) => metric.key === OUTDOOR_TEMP_KEY)?.cadence_s ?? null;
  const outdoorWords = useClockValue((clock) => outdoorSource(outdoorReading, outdoorCadence, clock));

  // The law's record (API-31) for the Law and equipment and Drying presets, and API-30's drying offset for the line.
  const lawOn = (preset.extra === "law" || preset.extra === "drying") && allowed && measured !== null;
  const lawId = `${key}|law`;
  const lawHistory = slotRead(useWindowReads("API-31", lawOn ? [{ id: lawId, params: { from: isoOf(measured.from), to: isoOf(measured.to) } }] : [], null), lawId);
  const lawNow = useLawRead();
  const offset = preset.extra === "drying" ? dryingOffset(lawNow.data) : null;
  // The Controller preset: its budget keys in one API-04 read, against API-35's limits.
  const controllerOn = preset.extra === "controller";
  const health = useControllerHealthRead();
  const controllerKeys = metricsCatalog ? CONTROLLER_PANELS.map((panel) => panel.key).filter((item) => metricsCatalog.some((metric) => metric.key === item)) : [];
  const controllerId = `${key}|controller|${points ?? ""}`;
  const controller = slotRead(useWindowReads("API-04", controllerOn && measured && controllerKeys.length ? [{ id: controllerId, params: { metric: controllerKeys, from: isoOf(measured.from), to: isoOf(measured.to), ...pointed } }] : [], null), controllerId);
  const charts = useMemo(() => (metricsCatalog ? controllerCharts(metricsCatalog, health.data?.limits ?? null) : null), [metricsCatalog, health.data]);

  // The event rail: writes from the activity log, alerts raised and resolved, and runs for windows up to 31 days.
  const stacked = plans.length > 0;
  const sources = shownSources(view.events);
  const marked = measured && stacked && sources.length > 0 ? measured : null;
  const activityId = `${key}|activity`, runsId = `${key}|runs`;
  const activity = slotRead(useWindowReads("API-17", marked && sources.some((source) => WRITE_SOURCES.includes(source))
    ? [{ id: activityId, params: { from: isoOf(marked.from), to: isoOf(marked.to), limit: EVENTS_PAGE } }] : [], null), activityId);
  const alerts = slotRead(useWindowReads("API-14", marked && sources.includes("alerts") ? [{ id: "alerts", params: { status: "recent" as const, limit: EVENTS_PAGE } }] : [], window?.live ? GRAPH_POLL_MS : null), "alerts");
  const runs = slotRead(useWindowReads("API-IRR-11", marked && allowed && sources.includes("runs") ? [{ id: runsId, params: { from: isoOf(marked.from), to: isoOf(marked.to), limit: EVENTS_PAGE } }] : [], null), runsId);
  const events = useMemo(() => (now === null ? [] : chartEvents({ activity: activity.data?.items, alerts: alerts.data?.items, runs: runs.data?.items, settings: settingsCatalog, sources, now })),
    [activity.data, alerts.data, runs.data, settingsCatalog, sources, now]);
  const eventsRead = [activity, alerts, runs].some((read) => read.data !== null);

  const panelReads = seriesSlots.map((slot) => seriesReads.get(slot.id)!);
  const compareList = compareSlots.map((slot) => compareReads.get(slot.id)!);
  const historyList = historySlots.map((slot) => historyReads.get(slot.id)!);
  const reads: WindowRead<unknown>[] = [registry, band, lanes, switches, outdoor, forecastRead, activity, alerts, runs, lawHistory, controller, ...panelReads, ...compareList, ...historyList];
  // A failing read slows the clock to every second minute, as the polls back off.
  const anyError = reads.some((read) => read.error !== null);
  useEffect(() => { setFailing(anyError); }, [anyError]);

  const steps: SettingSteps[] = resolved.settings.flatMap((row, index) => {
    const history = historyList[index]?.data;
    return history ? [{ history: inPanelUnit(history), label: settingLabel(row) || row.param }] : [];
  });
  const panels: StackPanel[] = plans.map((plan, index) => {
    const read = panelReads[index];
    const climatePanel = !plan.daily && CLIMATE_PANEL_IDS.includes(plan.id);
    const overlaid = climatePanel ? overlay.metrics.filter((metric) => metric.unit === plan.unit) : [];
    const drying = preset.extra === "drying" && plan.id === "vpd" && offset !== null;
    const message = read?.data ? undefined : read?.error ? readFailure(read.error, `the ${plan.name} chart`) : registry.error !== null && !resolved.ready ? "Couldn't load the metric list." : `Loading ${plan.name}…`;
    const series = climatePanel ? withOutdoor(read?.data ?? null, plan.unit, outdoor.data) : read?.data ?? null;
    return {
      id: plan.id, name: plan.name, unit: plan.unit, metrics: [...plan.metrics, ...overlaid, ...(drying ? [DRYING_LINE_METRIC] : [])],
      series: drying ? withDryingLine(series, lawHistory.data, offset) : series, compare: compareList[index]?.data ?? null, message,
    };
  });
  // With the dashboard API down the charts keep what they read, but grade nothing: no band, so no "in band" and no shading.
  const shownBand = apiDown ? null : band.data;

  // The notes the stack's panels carry (daily summaries, retention, STALE, the forecast's issue), each said once, and the
  // registry's note on every metric drawn (an unreliable sensor says so on its panel, R-16).
  const seriesKey = panels.map((panel) => `${panel.id}:${identity(panel.series)}:${panel.metrics.map((metric) => metric.key).join("+")}`).join(",");
  const notes = useMemo(() => {
    if (window === null || now === null) return [];
    const byPanel = panels.filter((panel) => panel.series).map((panel) => ({
      name: panel.name,
      notes: chartNotes(buildTimeSeriesModel({ series: panel.series, metrics: panel.metrics, unit: panel.unit, band: shownBand, forecast, now, xRange: window.x })),
    }));
    return joinNotes(byPanel);
  }, [seriesKey, shownBand, forecast, now, window]);
  const metricNotes = [...new Set(plans.flatMap((plan) => plan.metrics).flatMap((metric) => (metric.note ? [`${metric.label}: ${metric.note}`] : [])))];
  const firstRead = panelReads[0]?.data ?? null;
  const gaps = useMemo(() => recordGapItems(firstRead, plans[0]?.metrics[0]?.key ?? null, measured), [firstRead, plans, measured?.from, measured?.to]);
  const climateReads = panelReads.filter((_, index) => CLIMATE_PANEL_IDS.includes(plans[index]?.id ?? ""));
  const bucketSeconds = (climateReads.length ? climateReads : panelReads).find((read) => read.data)?.data?.bucket_s ?? null;
  const daily = (climateReads.length ? climateReads : panelReads).some((read) => Object.values(read.data?.series ?? {}).some((columns) => columns.source === "daily_summary"));
  const outdoorEmpty = !outdoor.data || noValues(outdoor.data, overlay.keys);
  const empty = outdoorEmpty && panelReads.length > 0 && panelReads.every((read, index) => read.current && read.data && noValues(read.data, keysOf(plans[index])));
  const failed = [registry, band, lanes, switches, outdoor, forecastRead, activity, alerts, runs, ...panelReads, ...compareList, ...historyList].filter((read) => read.error !== null && read.data === null);
  const notices = [...parsed.notices, ...resolved.notices];
  const lanesMessage = window === null ? "Loading equipment…"
    : !lanesOn ? LANES_TEXT
    : lanes.data ? undefined
    : lanes.error !== null ? readFailure(lanes.error, "the equipment lanes")
    : lanesWindow ? "Loading equipment…" : undefined;
  const last24h = spec.kind === "range" && spec.range === "24h" ? undefined : { to: graphHref(withWindow(view, { kind: "range", range: "24h" })), label: "Last 24 h" };
  const markNotes = [
    ...(activity.data?.next_cursor ? [`The rail marks the newest ${EVENTS_PAGE} changes in this window`] : []),
    ...(runs.data?.next_cursor ? [`The rail marks the newest ${EVENTS_PAGE} runs in this window`] : []),
    ...(window && stacked && !allowed && sources.includes("runs") ? ["Runs are marked for windows up to 31 days"] : []),
  ];

  // The story line: the climate panels' own reads, once they and the band have answered.
  const lead = windowWords(spec, window);
  const temperatureRead = panelReads[plans.findIndex((plan) => plan.id === "temperature")];
  const vpdRead = panelReads[plans.findIndex((plan) => plan.id === "vpd")];
  const storyReady = now !== null && !apiDown && banded && (temperatureRead?.data || vpdRead?.data) && (!temperatureRead || temperatureRead.data) && (!vpdRead || vpdRead.data) && (band.data !== null || band.error !== null);
  const story = useMemo(() => (storyReady ? climateStory(temperatureRead?.data, vpdRead?.data, band.data, now!) : null), [storyReady, temperatureRead?.data, vpdRead?.data, band.data, now]);
  const dimensions = useMemo(() => (storyReady ? climateDimensions(temperatureRead?.data, vpdRead?.data, band.data, now!).filter((item) => (item.metric === "temp" ? temperatureRead : vpdRead)) : undefined),
    [storyReady, temperatureRead?.data, vpdRead?.data, band.data, now]);
  const withDates = window !== null && localDay(window.x.from) !== localDay(window.x.to - 1);
  const plain = window ? `${lead} · ${preset.label}` : null;

  const previous = window && now !== null ? stepSpec(spec, window, -1, now) : null;
  const next = window && now !== null ? stepSpec(spec, window, 1, now) : null;
  const zoomOut = window && now !== null ? zoomOutSpec(spec, window, now) : null;
  const long = window !== null ? !lanesAllowed(window) : spec.kind === "range" && (rangeSeconds(spec.range) ?? 0) > 31 * 86_400;
  const xRange = window?.x ?? { from: 0, to: 1 };
  const drawn = [...resolved.climate, ...resolved.picked];
  const states = shownLanes(lanes.data, preset.lanes === false ? null : preset.lanes);
  const relayLanes = preset.lanes === false ? null
    : <EquipmentLanes states={states} xRange={xRange} syncKey={syncKey} now={now ?? undefined} message={lanesMessage} zoomControl={false} lightWrites={switches.data?.items ?? null} />;
  const lawRead = { data: lawHistory.data, error: lawHistory.error, refetch: lawHistory.refetch };

  return <>
    <PageHeader view="graphs-explore" status={story ? <StoryLine lead={lead} story={story} view={view} withDates={withDates} dimensions={dimensions} /> : banded ? null : plain}
      statusShort={story ? <StoryLine lead={lead} story={story} view={view} withDates={withDates} dimensions={dimensions} short /> : banded ? null : plain} />
    <GraphNotices notices={notices} />
    <div className="page-toolbar gr-toolbar">
      {/* On a phone the toolbar is two rows: the range, then ‹ ›, Custom…, Layers and + Metric; Preset, the settings drawn
          as steps with + Setting, and the added metrics move into the Layers sheet. */}
      <GraphToolbar
        ranges={RANGES.map((range) => ({ id: range.id, label: range.label, href: graphHref(withWindow(view, { kind: "range", range: range.id })), current: spec.kind === "range" && spec.range === range.id, wide: range.id === "90d" }))}
        previous={previous && graphHref(withWindow(view, previous))} next={next && graphHref(withWindow(view, next))} span={spanOf(spec, window)}
        zoomOut={zoomOut && graphHref(withWindow(view, zoomOut))} customOpen={spec.kind === "days"}
        custom={<RangeForm initial={rangeDays(spec, window)} action="/graphs" hidden={viewFields(view)} href={(from, to) => graphHref(withWindow(view, { kind: "days", from, to }))} />}>
        <PresetMenu view={view} catalog={metricsCatalog} />
        <LayersMenu view={view} long={long} phone={<>
          <PresetChips view={view} catalog={metricsCatalog} />
          <DrawnChips view={view} settings={resolved.settings} picked={resolved.picked} catalog={metricsCatalog}
            chooser={<SettingChooser view={view} settings={settingsCatalog} failed={catalog.data === undefined && catalog.error !== null} chosen={resolved.settings} units={resolved.units} />} />
        </>} />
        <MetricPicker view={view} metrics={metricsCatalog} failed={registry.error !== null} drawn={drawn} />
        <SettingChooser view={view} settings={settingsCatalog} failed={catalog.data === undefined && catalog.error !== null} chosen={resolved.settings} units={resolved.units} className="gr-setting-add" />
      </GraphToolbar>
    </div>
    <ChartChips view={view} settings={resolved.settings} picked={resolved.picked} catalog={metricsCatalog} />
    {failed.length > 0 && <PanelError thing="part of this window" text={registry.error !== null && !metricsCatalog ? "Couldn't load the metric list." : "Couldn't load part of this window."}
      onRetry={() => { for (const read of failed) read.refetch(); }} />}
    {empty && <EmptyState message="No data in this window" widen={last24h} />}
    {(notes.length > 0 || markNotes.length > 0 || metricNotes.length > 0 || overlay.metrics.length > 0) && window && <ul className="chart-notes gr-notes" aria-label="About this window">
      {overlay.metrics.length > 0 && <li>Outdoor · {outdoorWords}</li>}
      {[...notes, ...metricNotes, ...markNotes].map((note) => <li key={note} className={note.includes("STALE") ? "chart-note-stale" : undefined}>{note}</li>)}
    </ul>}
    {window && <RecordGaps gaps={gaps} />}
    {stacked
      ? <ChartStack label={`${preset.label}, ${lead.charAt(0).toLowerCase()}${lead.slice(1)}`} panels={panels} band={shownBand} settings={steps} forecast={forecast} reference={REFERENCE_KEYS}
        now={now ?? 0} xRange={xRange} syncKey={syncKey} excursions={!apiDown} envelope={view.envelope}
        compare={compared} events={eventsRead && sources.length > 0 ? events : null} csvName="graphs" tableName={`${preset.label} table`}
        lanesName={preset.lanes === false ? undefined : "lanesName" in preset ? preset.lanesName : undefined}
        lanes={preset.extra === "law"
          ? <><LawLanes history={lawRead} allowed={allowed} range={xRange} now={now} syncKey={syncKey} />{relayLanes}</>
          : relayLanes ?? undefined}
        foot={<ResolutionLine window={window} bucketSeconds={bucketSeconds} daily={daily} now={now} />} />
      : !resolved.ready && preset.extra !== "controller" && <div className="card gr-waiting"><Skeleton size="lg" label={preset.label} /></div>}
    {preset.extra === "drying" && <DryingCharts history={lawRead} allowed={allowed} range={xRange} now={now} syncKey={syncKey} />}
    {controllerOn && <ControllerCharts charts={charts} series={{ data: controller.data, error: controller.error ?? (metricsCatalog ? null : registry.error), refetch: metricsCatalog ? controller.refetch : registry.refetch }} limitsFailed={health.data === undefined && health.error !== null}
      range={xRange} syncKey={syncKey} />}
  </>;
}

export type { GraphView };
