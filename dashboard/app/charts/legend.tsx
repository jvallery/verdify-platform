// SPDX-License-Identifier: MIT
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useNarrow } from "./uplot-chart";

/**
 * A chart's legend (design system §5.3): one `<button aria-pressed>` per series that shows or hides it. One line above
 * the plot above 860 px (A3), inside a `<details>` at 860 px and below, and none on a single-series chart. The swatch takes its colour
 * from the token named in `data-token` (charts.css), never from a style attribute.
 */
/** `kind` draws the swatch as the line is drawn: an outdoor line dashed, a forecast dotted; a solid line by default. */
export type LegendItem = { key: string; label: string; token: string; shown: boolean; kind?: "dashed" | "dotted" };

export function Legend({ items, onToggle }: { items: readonly LegendItem[]; onToggle: (key: string) => void }) {
  const narrow = useNarrow();
  if (items.length < 2) return null;
  const buttons = <ul className="chart-legend-items">
    {items.map((item) => <li key={item.key}>
      <button type="button" aria-pressed={item.shown} onClick={() => onToggle(item.key)}>
        <span className="chart-swatch" data-token={item.token.replace(/^--/, "")} data-kind={item.kind} aria-hidden="true" />{item.label}
      </button>
    </li>)}
  </ul>;
  return narrow ? <details className="chart-legend"><summary>Legend</summary>{buttons}</details> : <div className="chart-legend">{buttons}</div>;
}

/**
 * A key for marks that are not series (the lanes' causes, hatching and outlines; the bars' causes, no-data days, the
 * planned outline and the cap): the same swatch-and-words items as the legend, without toggles, so colour, hatch and
 * line style always carry words.
 */
export type KeyItem = { key: string; label: string; token: string; kind: "fill" | "line" | "outline" | "hatch" | "dashed" | "dotted" | "band"; title?: string; /** What a hovered event touched (#1355). */ lit?: boolean };

export function ChartKey({ items, className, label = "Key" }: { items: readonly KeyItem[]; className?: string; label?: string }) {
  if (!items.length) return null;
  return <ul className={className ? `chart-key ${className}` : "chart-key"} aria-label={label}>
    {items.map((item) => <li key={item.key} title={item.title} data-lit={item.lit ? "" : undefined}>
      <span className="chart-key-swatch" data-token={item.token.replace(/^--/, "")} data-kind={item.kind} aria-hidden="true" />{item.label}
    </li>)}
  </ul>;
}

/** What a chart inside a `ChartGroup` hands it: its key, under its own id. */
type GroupKeys = { readonly set: (id: string, items: readonly KeyItem[]) => void; readonly remove: (id: string) => void };
const ChartGroupContext = createContext<GroupKeys | null>(null);

/**
 * Inside a `ChartGroup` a chart hands its key (and a series chart its legend, as key items) to the group and draws none
 * of its own: the hook returns true there, and the chart then renders only its title, its plot and its quiet line.
 * Outside a group it does nothing and returns false.
 */
export function useChartGroupKey(items: readonly KeyItem[]): boolean {
  const group = useContext(ChartGroupContext);
  const id = useId();
  // Items arrive as fresh arrays on every render: the group hears of them only when what they say changes.
  const latest = useRef(items);
  latest.current = items;
  const said = JSON.stringify(items.map((item) => [item.key, item.label, item.token, item.kind]));
  useEffect(() => {
    if (!group) return;
    group.set(id, latest.current);
    return () => group.remove(id);
  }, [group, id, said]);
  return group !== null;
}

/**
 * The group's key: every chart's items once, in the order first seen. An item two charts draw in different colours (each
 * relay's "lighter: so far") is one item in the neutral `--text-2`, since its colour is the chart's and its words say it.
 */
export function mergeGroupKeys(lists: readonly (readonly KeyItem[])[]): KeyItem[] {
  const merged = new Map<string, KeyItem>();
  for (const items of lists) {
    for (const item of items) {
      const id = `${item.key}|${item.label}|${item.kind}`;
      const seen = merged.get(id);
      if (!seen) merged.set(id, item);
      else if (seen.token !== item.token && seen.token !== "--text-2") merged.set(id, { ...seen, token: "--text-2" });
    }
  }
  return [...merged.values()];
}

/**
 * Small multiples (A3: Record → Equipment's relays, the probes): one legend for the group, one line above its first row,
 * and each chart inside keeps only its title, its plot and its quiet line. The key is the charts' own keys merged
 * (`mergeGroupKeys`), or `items` when given. `label` names the group for a screen reader.
 */
export function ChartGroup({ label, items, className, children }: { label: string; items?: readonly KeyItem[]; className?: string; children?: ReactNode }) {
  const [keys, setKeys] = useState<ReadonlyMap<string, readonly KeyItem[]>>(() => new Map());
  const value = useMemo<GroupKeys>(() => ({
    set: (id, list) => setKeys((previous) => new Map(previous).set(id, list)),
    remove: (id) => setKeys((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Map(previous);
      next.delete(id);
      return next;
    }),
  }), []);
  const shown = items ?? mergeGroupKeys([...keys.values()]);
  return <div className={className ? `chart-group ${className}` : "chart-group"} role="group" aria-label={label}>
    <ChartKey items={shown} className="chart-group-key" label={`${label}: key`} />
    <ChartGroupContext.Provider value={value}>{children}</ChartGroupContext.Provider>
  </div>;
}
