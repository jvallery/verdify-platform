// SPDX-License-Identifier: MIT
import { useId, useRef, useState, type ReactNode } from "react";
import { formatNumber } from "../lib/format";
import { cls } from "./common";

export type TableColumn<T> = {
  key: string;
  /** Short: at most two words a line, the unit after a comma ("Electricity, kWh"); the cells are then bare numbers. */
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** The row's header cell (`<th scope="row">`), usually the first column. On a phone list it is the card's title. */
  rowHeader?: boolean;
  /** A number: right-aligned in tabular figures, its header too (design system v2 §4). */
  numeric?: boolean;
  /**
   * Consecutive columns with the same group share one cell in a first header row ("In band, %" over Both, Temp and
   * VPD; `scope="colgroup"`); a column without a group spans both header rows. The phone list ignores groups.
   */
  headerGroup?: string;
  /** On a phone list, the cell sits on the card's title line at the right, without its label: a state pill. */
  titleAside?: boolean;
  className?: string;
};
/** The units a column head ends with, after a comma or in brackets ("Electricity, kWh", "Temperature (°F)"). */
const UNITS = String.raw`°F|°C|kPa|kWh/kg|kWh|gal|min|h|s|ms|kB|%|µS/cm|therms \(est\.\)|therms|kg|g|ppm|lux|dBm|W`;
const COMMA_UNIT = new RegExp(String.raw`^(.+, )((?:\d+ )?(?:${UNITS}))$`);
const BRACKET_UNIT = new RegExp(String.raw`^(.+ \()(${UNITS})(\))$`);

/**
 * A column head with its unit in a `.unit` span (design system §4, tables): the head's words stay the uppercase
 * micro-label and the unit keeps its case, so "kWh" never reads "KWH". A head that is not a string, or names no unit,
 * is returned as it is. Table and the charts' data tables pass every head through it.
 */
export function headWithUnit(head: ReactNode): ReactNode {
  if (typeof head !== "string") return head;
  const comma = COMMA_UNIT.exec(head);
  if (comma) return <>{comma[1]}<span className="unit">{comma[2]}</span></>;
  const bracket = BRACKET_UNIT.exec(head);
  return bracket ? <>{bracket[1]}<span className="unit">{bracket[2]}</span>{bracket[3]}</> : head;
}

export type TableFilter<T> = {
  label: string;
  /** The text a row is matched on, case-insensitively. */
  text: (row: T) => string;
  placeholder?: string;
  /** Controlled value, so a screen can keep the filter in its URL; otherwise the table keeps it. */
  value?: string;
  onChange?: (value: string) => void;
};
export type TableProps<T> = {
  /** Names the scroll region. */
  label: string;
  caption: ReactNode;
  captionHidden?: boolean;
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Groups render in `groupOrder`, a fixed order; a group it does not name follows, in the order first seen. */
  group?: (row: T) => string;
  groupOrder?: readonly string[];
  groupLabel?: (group: string) => ReactNode;
  filter?: TableFilter<T>;
  /** Shown when there are no rows at all. */
  empty?: ReactNode;
  /**
   * At 860 px and below (design system v2 §4): `scroll` (the default) scrolls inside its card with the first column
   * fixed; `list` turns each row into a small card: the row header is its title, then label and value pairs, the labels
   * from string headers.
   */
  phone?: "scroll" | "list";
  /**
   * Shows the first `maxRows` rows (in their order, groups included) and a "Show all N <rowNoun>" button under the table
   * that reveals the rest in place. A text filter always searches every row, and shows every match.
   */
  maxRows?: number;
  /** What a row is, for "Show all 30 days": "rows" by default. */
  rowNoun?: string;
};

function grouped<T>(rows: readonly T[], group: (row: T) => string, order: readonly string[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const name of order) groups.set(name, []);
  for (const row of rows) {
    const name = group(row);
    const list = groups.get(name);
    if (list) list.push(row); else groups.set(name, [row]);
  }
  return [...groups].filter(([, list]) => list.length > 0);
}

/** The first `limit` rows across the sections, in order; a section left with none is dropped. */
function limited<T>(sections: readonly [string | null, readonly T[]][], limit: number): [string | null, readonly T[]][] {
  let left = limit;
  const kept: [string | null, readonly T[]][] = [];
  for (const [name, list] of sections) {
    if (left <= 0) break;
    kept.push([name, list.slice(0, left)]);
    left -= list.length;
  }
  return kept;
}

/** A run of consecutive columns under one group (`name`), or one column without a group (`name` null). */
type HeadSpan<T> = { readonly name: string | null; readonly columns: readonly TableColumn<T>[] };
function headSpans<T>(columns: readonly TableColumn<T>[]): HeadSpan<T>[] {
  const spans: { name: string | null; columns: TableColumn<T>[] }[] = [];
  for (const column of columns) {
    const name = column.headerGroup ?? null;
    const last = spans[spans.length - 1];
    if (name !== null && last && last.name === name) last.columns.push(column);
    else spans.push({ name, columns: [column] });
  }
  return spans;
}

/**
 * The table of design system v2 §4: a focusable scroll region (`role="region"`, `tabindex="0"`, labelled) around a
 * table with a caption, a sticky head (with an optional row of column groups), numbers right-aligned, row hover, rows in
 * fixed group order, an optional text filter and an optional row limit with "Show all". Columns do not sort. On a phone
 * it scrolls with its first column fixed, or becomes a list (`phone`).
 */
export function Table<T>({ label, caption, captionHidden = false, columns, rows, rowKey, group, groupOrder = [], groupLabel, filter, empty, phone = "scroll", maxRows, rowNoun = "rows" }: TableProps<T>) {
  const filterId = useId();
  const region = useRef<HTMLDivElement>(null);
  const [own, setOwn] = useState("");
  const [all, setAll] = useState(false);
  const query = filter?.value ?? own;
  const needle = query.trim().toLowerCase();
  const shown = filter && needle ? rows.filter((row) => filter.text(row).toLowerCase().includes(needle)) : rows;
  const sections: [string | null, readonly T[]][] = group ? grouped(shown, group, groupOrder) : [[null, shown]];
  const cut = maxRows !== undefined && !all && !needle && shown.length > maxRows;
  const drawn = cut ? limited(sections, Math.max(0, maxRows)) : sections;
  const list = phone === "list";
  const cellClass = (column: TableColumn<T>) => cls(column.numeric && "num", list && column.rowHeader && "table-title", list && column.titleAside && "table-aside", column.className);
  // The list form labels each value with its column's header where that header is plain words; its title and the pill
  // on the title line carry none.
  const dataLabel = (column: TableColumn<T>) => (list && !column.rowHeader && !column.titleAside && typeof column.header === "string" ? column.header : undefined);
  const cells = (row: T) => columns.map((column) => column.rowHeader
    ? <th key={column.key} scope="row" className={cellClass(column)} data-label={dataLabel(column)}>{column.cell(row)}</th>
    : <td key={column.key} className={cellClass(column)} data-label={dataLabel(column)}>{column.cell(row)}</td>);
  const headClass = (column: TableColumn<T>) => cls(column.numeric && "num", column.className);
  const spans = headSpans(columns);
  const twoRows = spans.some((span) => span.name !== null);
  const head = twoRows
    ? <thead className="table-head-grouped">
      <tr>{spans.map((span) => (span.name === null
        ? <th key={span.columns[0].key} scope="col" rowSpan={2} className={headClass(span.columns[0])}>{headWithUnit(span.columns[0].header)}</th>
        : <th key={`group:${span.columns[0].key}`} scope="colgroup" colSpan={span.columns.length} className="table-colgroup">{headWithUnit(span.name)}</th>))}</tr>
      <tr>{spans.flatMap((span) => (span.name === null ? [] : span.columns.map((column) => <th key={column.key} scope="col" className={headClass(column)}>{headWithUnit(column.header)}</th>)))}</tr>
    </thead>
    : <thead><tr>{columns.map((column) => <th key={column.key} scope="col" className={headClass(column)}>{headWithUnit(column.header)}</th>)}</tr></thead>;
  const reveal = () => {
    setAll(true);
    // The button goes with the rows it revealed: the keyboard carries on from the table.
    region.current?.focus({ preventScroll: true });
  };
  return <>
    {filter && <div className="filters"><label htmlFor={filterId}>{filter.label}<input id={filterId} type="search" value={query} placeholder={filter.placeholder}
      onChange={(event) => { setOwn(event.target.value); filter.onChange?.(event.target.value); }} /></label></div>}
    <div ref={region} className={cls("table-wrap", list ? "table-list" : "table-sticky-first")} role="region" tabIndex={0} aria-label={label}>
      <table>
        <caption className={cls(captionHidden && "screen-reader")}>{caption}</caption>
        {head}
        {drawn.map(([name, part]) => <tbody key={name ?? "rows"}>
          {name !== null && <tr className="table-group"><th scope="rowgroup" colSpan={columns.length}>{groupLabel ? groupLabel(name) : name}</th></tr>}
          {part.map((row) => <tr key={rowKey(row)}>{cells(row)}</tr>)}
        </tbody>)}
      </table>
    </div>
    {cut && <button type="button" className="table-more" onClick={reveal}>Show all {formatNumber(shown.length)} {rowNoun}</button>}
    {rows.length === 0 ? empty && <div className="table-empty">{empty}</div>
      : shown.length === 0 && <p className="muted">Nothing matches “{query.trim()}”.</p>}
  </>;
}
