// SPDX-License-Identifier: MIT
/**
 * Test stand-ins for uPlot and a canvas, so the chart rules are checked without drawing: `vi.mock("uplot")` returns
 * `MockPlot`, which records the options and data handed to its constructor; `RecordingContext` records what the hooks
 * paint. Imported by vitest files only.
 */
import type uPlot from "uplot";

export type Stroke = { stroke: string; width: number; dash: number[]; path: [number, number][] };
export type Text = { text: string; x: number; y: number; color: string };

export class RecordingContext {
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  font = "";
  textAlign = "left";
  textBaseline = "alphabetic";
  strokes: Stroke[] = [];
  fills: { color: string; path: [number, number][] }[] = [];
  /** The globalAlpha of each fill, in the order of `fills` (a "so far" bar fills lighter). */
  fillAlphas: number[] = [];
  globalAlpha = 1;
  rects: { color: string; x: number; y: number; width: number; height: number }[] = [];
  /** clearRect calls: gaps cleared to the background (daily water use's stacked parts). */
  clears: { x: number; y: number; width: number; height: number }[] = [];
  /** strokeRect calls: outlines (sensed lanes, the planned minutes). */
  outlines: { color: string; width: number; dash: number[]; x: number; y: number; w: number; h: number }[] = [];
  texts: Text[] = [];
  halos: { text: string; x: number; y: number; color: string; width: number }[] = [];
  private dash: number[] = [];
  private path: [number, number][] = [];
  setLineDash(dash: number[]) { this.dash = [...dash]; }
  getLineDash() { return this.dash; }
  beginPath() { this.path = []; }
  moveTo(x: number, y: number) { this.path.push([x, y]); }
  lineTo(x: number, y: number) { this.path.push([x, y]); }
  arcTo(_x1: number, _y1: number, x2: number, y2: number) { this.path.push([x2, y2]); }
  closePath() {}
  /** save() depth: painting must leave it where it found it. */
  depth = 0;
  rect() {}
  clip() {}
  save() { this.depth++; }
  restore() { this.depth--; }
  stroke() { this.strokes.push({ stroke: this.strokeStyle, width: this.lineWidth, dash: this.dash, path: this.path }); }
  fill() { this.fills.push({ color: this.fillStyle, path: this.path }); this.fillAlphas.push(this.globalAlpha); }
  fillRect(x: number, y: number, width: number, height: number) { this.rects.push({ color: this.fillStyle, x, y, width, height }); }
  clearRect(x: number, y: number, width: number, height: number) { this.clears.push({ x, y, width, height }); }
  strokeRect(x: number, y: number, w: number, h: number) { this.outlines.push({ color: this.strokeStyle, width: this.lineWidth, dash: this.dash, x, y, w, h }); }
  fillText(text: string, x: number, y: number) { this.texts.push({ text, x, y, color: this.fillStyle }); }
  /** A label's halo, stroked under its words in the chart's background. */
  strokeText(text: string, x: number, y: number) { this.halos.push({ text, x, y, color: this.strokeStyle, width: this.lineWidth }); }
  measureText(text: string) { return { width: text.length * 6 }; }
}

type Hook = (plot: MockPlot, ...args: unknown[]) => void;
const syncs = new Map<string, { key: string; plots: MockPlot[] }>();

/** Every MockPlot created, in order. Tests reset it. */
export const created: MockPlot[] = [];

export class MockPlot {
  static pxRatio = 1;
  static tzDate(date: Date, zone: string) { MockPlot.zones.push(zone); return date; }
  static zones: string[] = [];
  static sync(key: string) {
    let entry = syncs.get(key);
    if (!entry) { entry = { key, plots: [] }; syncs.set(key, entry); }
    return entry;
  }
  static reset() { created.length = 0; syncs.clear(); MockPlot.zones = []; }
  /** uPlot.paths: the bars builder records its options. */
  static paths = {
    bars: (opts: unknown) => Object.assign(() => null, { bars: opts }),
  };

  opts: uPlot.Options;
  data: uPlot.AlignedData;
  target: HTMLElement;
  over = document.createElement("div");
  ctx = new RecordingContext();
  bbox = { left: 0, top: 0, width: 1000, height: 300 };
  scales: Record<string, { min: number; max: number }>;
  series: { show: boolean; label?: string }[];
  cursor: { left: number; top: number; idx: number | null; event?: { type: string } | null } = { left: -10, top: -10, idx: null };
  destroyed = false;
  sizes: { width: number; height: number }[] = [];
  dataUpdates: uPlot.AlignedData[] = [];
  scaleCalls: { key: string; min: number; max: number }[] = [];
  seriesCalls: { index: number; show: boolean }[] = [];

  constructor(opts: uPlot.Options, data: uPlot.AlignedData, target: HTMLElement) {
    this.opts = opts;
    this.data = data;
    this.target = target;
    this.series = opts.series.map((series) => ({ show: series.show !== false, label: typeof series.label === "string" ? series.label : undefined }));
    const x = opts.scales?.x;
    this.scales = { x: { min: x?.min ?? 0, max: x?.max ?? 1 }, y: { min: 0, max: 1 } };
    const sync = opts.cursor?.sync?.key;
    if (sync) MockPlot.sync(sync).plots.push(this);
    created.push(this);
  }
  /** The hooks of one kind, the plugins' included, as uPlot would run them. */
  hooks(name: keyof uPlot.Hooks.Defs): Hook[] {
    const own = (this.opts.hooks?.[name] || []) as unknown as Hook[];
    const plugged = (this.opts.plugins || []).flatMap((plugin) => {
      const hook = plugin.hooks[name] as unknown;
      return (Array.isArray(hook) ? hook : hook ? [hook] : []) as Hook[];
    });
    return [...own, ...plugged];
  }
  fire(name: keyof uPlot.Hooks.Defs, ...args: unknown[]) { for (const hook of this.hooks(name)) hook(this, ...args); }
  /** Ranges y as uPlot would, from the shown series' data, then paints every layer. */
  draw() {
    const values = this.series.flatMap((series, index) => (index > 0 && series.show ? [...(this.data[index] as (number | null)[])].filter((value): value is number => value !== null) : []));
    const range = this.opts.scales?.y?.range as uPlot.Range.Function | undefined;
    const [min, max] = range ? range(this as unknown as uPlot, values.length ? Math.min(...values) : (null as unknown as number), values.length ? Math.max(...values) : (null as unknown as number), "y") : [0, 1];
    this.scales.y = { min: min ?? 0, max: max ?? 1 };
    this.ctx = new RecordingContext();
    this.fire("drawClear");
    this.fire("drawAxes");
    this.fire("draw");
  }
  valToPos(value: number, scale: string) {
    const { min, max } = this.scales[scale];
    const share = (value - min) / (max - min || 1);
    return scale === "x" ? this.bbox.left + share * this.bbox.width : this.bbox.top + (1 - share) * this.bbox.height;
  }
  posToVal(position: number, scale: string) {
    const { min, max } = this.scales[scale];
    return scale === "x" ? min + (position / this.bbox.width) * (max - min) : max - (position / this.bbox.height) * (max - min);
  }
  setSize(size: { width: number; height: number }) { this.sizes.push(size); }
  setData(data: uPlot.AlignedData) { this.data = data; this.dataUpdates.push(data); }
  setScale(key: string, limits: { min: number; max: number }) {
    this.scales[key] = { min: limits.min, max: limits.max };
    this.scaleCalls.push({ key, ...limits });
    this.fire("setScale", key);
  }
  setSeries(index: number, opts: { show?: boolean }) {
    if (opts.show !== undefined) { this.series[index].show = opts.show; this.seriesCalls.push({ index, show: opts.show }); }
  }
  /**
   * Moves the cursor to x (epoch seconds) at bucket `idx`, `top` CSS px down the plot, as a mousemove would; `synced`
   * moves it as another chart on the sync key does, with no event of its own.
   */
  hover(x: number, idx: number | null, top = 40, synced = false) {
    this.cursor = { left: this.valToPos(x, "x") - this.bbox.left, top, idx, event: synced ? null : { type: "mousemove" } };
    this.fire("setCursor");
  }
  batch(transaction: () => void) { transaction(); }
  redraw() {}
  destroy() {
    this.destroyed = true;
    for (const entry of syncs.values()) entry.plots = entry.plots.filter((plot) => plot !== this);
    this.fire("destroy");
  }
}

/** The stubs a mounted chart needs in jsdom: ResizeObserver, matchMedia (pointer and width) and Blob URLs. */
export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(public callback: ResizeObserverCallback) { FakeResizeObserver.instances.push(this); }
  observe(element: Element) { this.observed.push(element); }
  unobserve() {}
  disconnect() { this.disconnected = true; }
  trigger() { this.callback([], this as unknown as ResizeObserver); }
}

export function media({ narrow = false, fine = true }: { narrow?: boolean; fine?: boolean } = {}) {
  return (query: string) => ({
    matches: query === "(max-width: 860px)" ? narrow : query === "(pointer: fine)" ? fine : false,
    media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
}

/** The design-system token values (tokens.css, light theme) of every CHART_TOKENS entry, on :root as the stylesheet would set them. */
export const TOKENS: Readonly<Record<string, string>> = {
  "--text": "#0f1f2b", "--text-2": "#44525d", "--text-3": "#5d6a75", "--border": "#d9e2de",
  "--border-strong": "#b3c3bb", "--surface": "#ffffff", "--surface-2": "#edf1ef", "--bg": "#f4f6f5",
  "--accent": "#0e5a43", "--warn": "#a56a00", "--warn-text": "#5c4407", "--warn-soft": "#fbefd2",
  "--critical": "#b3261e", "--critical-text": "#8c1c16", "--c-temp": "#0f1f2b", "--c-vpd": "#7d3ab7",
  "--c-rh": "#0b84c9", "--c-outdoor": "#8a7a64", "--c-band-wash": "#dcebe4", "--c-band-edge": "#5f9485",
  "--c-grid": "#e3e9e6", "--c-requested": "#a56a00", "--eq-heat1": "#c97400", "--eq-heat2": "#b61f02",
  "--eq-fan1": "#12947f", "--eq-fan2": "#4b55b5", "--eq-vent": "#7f8f16", "--eq-fog": "#1695c4",
  "--eq-mister": "#a3279e", "--eq-light-main": "#4d9f45", "--eq-light-grow": "#2855ad", "--eq-water": "#2389e2",
  "--eq-fert": "#6331a0", "--eq-master": "#0e9580", "--cmp-in": "#3f9a78", "--cmp-below": "#2f6fb5",
  "--cmp-above": "#c5610f", "--c-day": "#b87a00", "--c-night": "#4a5aa8", "--cause-vpd": "#c2410c",
  "--cause-schedule": "#8a5a00", "--cause-prep": "#65731f",
};
export function setTokens(root: HTMLElement = document.documentElement) {
  for (const [token, value] of Object.entries(TOKENS)) root.style.setProperty(token, value);
}

/** A type with every field writable, arrays included: the API types are read-only, and a test edits its own copy. */
export type Writable<T> = T extends string | number | boolean | null | undefined ? T
  : T extends readonly (infer U)[] ? Writable<U>[] : { -readonly [K in keyof T]: Writable<T[K]> };
/** A fresh copy of a JSON fixture, typed, that the test may change. */
export const load = <T,>(value: unknown): Writable<T> => structuredClone(value) as Writable<T>;
