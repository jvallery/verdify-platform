// SPDX-License-Identifier: MIT
import { useId, useState, type ReactNode } from "react";
import { cls } from "./common";

export type TableColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** The row's header cell (`<th scope="row">`), usually the first column. */
  rowHeader?: boolean;
  /** A number: right-aligned in tabular figures, its header too (design system v2 §4). */
  numeric?: boolean;
  className?: string;
};
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
   * fixed; `list` turns each row into a small card of label and value pairs, the labels from string headers.
   */
  phone?: "scroll" | "list";
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

/**
 * The table of design system v2 §4: a focusable scroll region (`role="region"`, `tabindex="0"`, labelled) around a
 * table with a caption, a sticky head, numbers right-aligned, row hover, rows in fixed group order and an optional text
 * filter. Columns do not sort. On a phone it scrolls with its first column fixed, or becomes a list (`phone`).
 */
export function Table<T>({ label, caption, captionHidden = false, columns, rows, rowKey, group, groupOrder = [], groupLabel, filter, empty, phone = "scroll" }: TableProps<T>) {
  const filterId = useId();
  const [own, setOwn] = useState("");
  const query = filter?.value ?? own;
  const needle = query.trim().toLowerCase();
  const shown = filter && needle ? rows.filter((row) => filter.text(row).toLowerCase().includes(needle)) : rows;
  const sections: [string | null, readonly T[]][] = group ? grouped(shown, group, groupOrder) : [[null, shown]];
  const cellClass = (column: TableColumn<T>) => cls(column.numeric && "num", column.className);
  // The list form labels each value with its column's header where that header is plain words.
  const dataLabel = (column: TableColumn<T>) => (phone === "list" && typeof column.header === "string" ? column.header : undefined);
  const cells = (row: T) => columns.map((column) => column.rowHeader
    ? <th key={column.key} scope="row" className={cellClass(column)} data-label={dataLabel(column)}>{column.cell(row)}</th>
    : <td key={column.key} className={cellClass(column)} data-label={dataLabel(column)}>{column.cell(row)}</td>);
  return <>
    {filter && <div className="filters"><label htmlFor={filterId}>{filter.label}<input id={filterId} type="search" value={query} placeholder={filter.placeholder}
      onChange={(event) => { setOwn(event.target.value); filter.onChange?.(event.target.value); }} /></label></div>}
    <div className={cls("table-wrap", phone === "list" ? "table-list" : "table-sticky-first")} role="region" tabIndex={0} aria-label={label}>
      <table>
        <caption className={cls(captionHidden && "screen-reader")}>{caption}</caption>
        <thead><tr>{columns.map((column) => <th key={column.key} scope="col" className={cellClass(column)}>{column.header}</th>)}</tr></thead>
        {sections.map(([name, list]) => <tbody key={name ?? "rows"}>
          {name !== null && <tr className="table-group"><th scope="rowgroup" colSpan={columns.length}>{groupLabel ? groupLabel(name) : name}</th></tr>}
          {list.map((row) => <tr key={rowKey(row)}>{cells(row)}</tr>)}
        </tbody>)}
      </table>
    </div>
    {rows.length === 0 ? empty && <div className="table-empty">{empty}</div>
      : shown.length === 0 && <p className="muted">Nothing matches “{query.trim()}”.</p>}
  </>;
}
