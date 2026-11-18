// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState, type ReactNode } from "react";
import { headWithUnit } from "../components/table";
import { formatNumber } from "../lib/format";
import { fullTime } from "./time-axis";

/**
 * The keyboard and screen-reader equivalent of a chart (design system §7): a `<details>` "Data table · N rows" (or the
 * table named by its subject, "Climate table · 4,341 rows", where a card holds more than one) whose tables render only
 * once opened, in weather's focusable `.table-wrap` scroll region. Times carry their offset.
 */
export type DataTableBlock = {
  caption: string;
  headers: readonly string[];
  /** Built only while the disclosure is open. */
  rows: () => readonly (readonly ReactNode[])[];
  count: number;
};

export function DataTable({ tables, name = "Data table" }: { tables: readonly DataTableBlock[]; name?: string }) {
  const [open, setOpen] = useState(false);
  const count = tables.reduce((sum, table) => sum + table.count, 0);
  return <details className="chart-table" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{name} · {formatNumber(count)} {count === 1 ? "row" : "rows"}</summary>
    {open && tables.map((table) => <div key={table.caption} className="table-wrap" role="region" tabIndex={0} aria-label={table.caption}>
      <table>
        <caption>{table.caption}</caption>
        <thead><tr>{table.headers.map((header) => <th key={header} scope="col">{headWithUnit(header)}</th>)}</tr></thead>
        <tbody>{table.rows().map((cells, row) => <tr key={row}>{cells.map((cell, column) => (column === 0 ? <th key={column} scope="row">{cell}</th> : <td key={column}>{cell}</td>))}</tr>)}</tbody>
      </table>
    </div>)}
  </details>;
}

/** A local time with its offset, machine-readable in `dateTime`. */
export function TimeCell({ at }: { at: number }) {
  return <time dateTime={new Date(at * 1000).toISOString()}>{fullTime(at)}</time>;
}

/**
 * "CSV of this window": a Blob URL behind an `<a download>`, rebuilt when `version` changes and revoked when replaced or
 * unmounted. `build` runs in the effect, never during render. With `text` (a chart's foot: "CSV") the link shows those
 * words, styled as a link, and keeps `label` as its accessible name, which begins with them.
 */
export function CsvLink({ filename, build, version, label = "CSV of this window", text }: { filename: string; build: () => string; version: unknown; label?: string; text?: string }) {
  const latest = useRef(build);
  latest.current = build;
  const [href, setHref] = useState<string | undefined>(undefined);
  useEffect(() => {
    let url: string;
    try {
      url = URL.createObjectURL(new Blob([latest.current()], { type: "text/csv;charset=utf-8" }));
    } catch {
      // No Blob URLs here: the link stays without a target rather than breaking the chart.
      setHref(undefined);
      return;
    }
    setHref(url);
    return () => URL.revokeObjectURL(url);
  }, [version]);
  return text === undefined
    ? <a className="button-link" href={href} download={filename}>{label}</a>
    : <a className="chart-csv" href={href} download={filename} aria-label={label}>{text}</a>;
}

/** A chart's CSV: the file's name, how to build it, what rebuilds it, and its accessible name ("CSV of this chart"). */
export type ChartCsv = { readonly filename: string; readonly build: () => string; readonly version: unknown; readonly label?: string };

/**
 * The chart's one quiet line (A3): the "Data table · N rows" disclosure at its left, and at its right the chart's own
 * tools (Reset zoom) and "CSV", a link-style button with a 44 px target through its padding and no outline box. An
 * opened table unfolds under the line, across the chart's width. Every chart keeps its accessible table here.
 */
export function ChartFoot({ tables, name, csv, tools }: { tables?: readonly DataTableBlock[] | null; name?: string; csv?: ChartCsv | null; tools?: ReactNode }) {
  const hasTables = tables !== null && tables !== undefined && tables.length > 0;
  if (!hasTables && !csv && !tools) return null;
  return <div className="chart-foot">
    {hasTables && <DataTable name={name} tables={tables} />}
    {(csv || tools) && <div className="chart-foot-tools">
      {tools}
      {csv && <CsvLink filename={csv.filename} build={csv.build} version={csv.version} label={csv.label ?? "CSV of this chart"} text="CSV" />}
    </div>}
  </div>;
}
