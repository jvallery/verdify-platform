// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Table, headWithUnit, type TableColumn } from "./table";
import { renderUi, text } from "./test-render";

afterEach(cleanup);
type Row = { param: string; label: string; group: string };
const ROWS: Row[] = [
  { param: "sw_fog_enable", label: "Fog enable", group: "controller_safety" },
  { param: "mister_engage_kpa", label: "VPD Mister Engage", group: "planner_policy" },
  { param: "site_pressure_hpa", label: "Site pressure", group: "read_only" },
  { param: "mister_pulse_gap_s", label: "Mister pulse gap", group: "planner_policy" },
];
const COLUMNS: TableColumn<Row>[] = [{ key: "label", header: "Setting", rowHeader: true, cell: (row) => row.label }, { key: "param", header: "Key", cell: (row) => row.param }];
const ORDER = ["planner_policy", "scheduled_policy", "controller_safety"];
const table = (extra: Partial<Parameters<typeof Table<Row>>[0]> = {}) => <Table<Row> label="Settings" caption="Every setting" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.param}
  group={(row) => row.group} groupOrder={ORDER} filter={{ label: "Filter settings", text: (row) => `${row.label} ${row.param}` }} {...extra} />;
const rowHeaders = (container: HTMLElement) => [...container.querySelectorAll("tbody th[scope=row]")].map(text);

test("a focusable, labelled scroll region around a table with a caption", () => {
  const { container } = renderUi(table());
  const region = screen.getByRole("region", { name: "Settings" });
  expect(region.className).toBe("table-wrap table-sticky-first");
  expect(region.getAttribute("tabindex")).toBe("0");
  expect(text(container.querySelector("caption"))).toBe("Every setting");
  expect([...container.querySelectorAll("thead th")].map((th) => th.getAttribute("scope"))).toEqual(["col", "col"]);
});

test("rows keep a fixed group order, whatever order they arrive in; an unnamed group comes last", () => {
  const { container } = renderUi(table());
  expect([...container.querySelectorAll(".table-group th")].map(text)).toEqual(["planner_policy", "controller_safety", "read_only"]);
  expect([...container.querySelectorAll(".table-group th")].every((th) => th.getAttribute("scope") === "rowgroup" && th.getAttribute("colspan") === "2")).toBe(true);
  expect(rowHeaders(container)).toEqual(["VPD Mister Engage", "Mister pulse gap", "Fog enable", "Site pressure"]);
});

test("the text filter narrows the rows and says when nothing matches", () => {
  const { container } = renderUi(table());
  const filter = screen.getByLabelText("Filter settings");
  fireEvent.change(filter, { target: { value: "MISTER" } });
  expect(rowHeaders(container)).toEqual(["VPD Mister Engage", "Mister pulse gap"]);
  fireEvent.change(filter, { target: { value: "heat" } });
  expect(rowHeaders(container)).toEqual([]);
  expect(text(container)).toContain("Nothing matches “heat”.");
});

test("a controlled filter reports each change, so a screen can keep it in the URL", () => {
  const onChange = vi.fn();
  const { container } = renderUi(table({ filter: { label: "Filter settings", text: (row) => row.param, value: "fog", onChange } }));
  expect(rowHeaders(container)).toEqual(["Fog enable"]);
  fireEvent.change(screen.getByLabelText("Filter settings"), { target: { value: "site" } });
  expect(onChange).toHaveBeenCalledWith("site");
});

test("columns do not sort, and an empty table shows its empty words", () => {
  const { container } = renderUi(table());
  expect(container.querySelector("[aria-sort]")).toBeNull();
  expect(container.querySelector("thead button")).toBeNull();
  cleanup();
  expect(text(renderUi(table({ rows: [], empty: <p>No settings yet</p> })).container)).toContain("No settings yet");
});

test("a numeric column is right-aligned, its header too; the phone list form labels each cell with its header", () => {
  const numeric: TableColumn<Row>[] = [COLUMNS[0], { key: "n", header: "Minutes", numeric: true, cell: () => "14" }];
  const { container } = renderUi(<Table<Row> label="Runs" caption="Runs" columns={numeric} rows={ROWS} rowKey={(row) => row.param} phone="list" />);
  expect(screen.getByRole("region", { name: "Runs" }).className).toBe("table-wrap table-list");
  expect(container.querySelector("thead th:last-child")?.className).toBe("num");
  const cell = container.querySelector("tbody td")!;
  expect(cell.className).toBe("num");
  expect(cell.getAttribute("data-label")).toBe("Minutes");
});

test("the phone list: the row header is the card's title, with no label, and a titleAside cell sits on its line", () => {
  const columns: TableColumn<Row>[] = [
    COLUMNS[0],
    { key: "state", header: "State", titleAside: true, cell: () => <span className="badge">On</span> },
    { key: "param", header: "Key", cell: (row) => row.param },
  ];
  const { container } = renderUi(<Table<Row> label="Rules" caption="Rules" columns={columns} rows={ROWS} rowKey={(row) => row.param} phone="list" />);
  const title = container.querySelector("tbody th")!;
  expect(title.className).toBe("table-title");
  expect(title.hasAttribute("data-label")).toBe(false);
  const aside = container.querySelector("tbody td")!;
  expect(aside.className).toBe("table-aside");
  expect(aside.hasAttribute("data-label")).toBe(false);
  expect(container.querySelector("tbody td:last-child")?.getAttribute("data-label")).toBe("Key");
  cleanup();
  // On a wide table they are ordinary cells.
  const wide = renderUi(<Table<Row> label="Rules" caption="Rules" columns={columns} rows={ROWS} rowKey={(row) => row.param} />).container;
  expect(wide.querySelector("tbody th")?.className).toBe("");
  expect(wide.querySelector("tbody td")?.className).toBe("");
  expect(wide.querySelector("[data-label]")).toBeNull();
});

type Day = { date: string; both: number; temp: number; vpd: number; starts: number };
const DAYS: Day[] = Array.from({ length: 20 }, (_, index) => ({ date: `2026-11-${String(20 - index).padStart(2, "0")}`, both: 60 + index, temp: 90, vpd: 70, starts: 100 + index }));
const DAY_COLUMNS: TableColumn<Day>[] = [
  { key: "date", header: "Day", rowHeader: true, cell: (day) => day.date },
  { key: "both", header: "Both", headerGroup: "In band, %", numeric: true, cell: (day) => day.both },
  { key: "temp", header: "Temp", headerGroup: "In band, %", numeric: true, cell: (day) => day.temp },
  { key: "vpd", header: "VPD", headerGroup: "In band, %", numeric: true, cell: (day) => day.vpd },
  { key: "starts", header: "Starts", numeric: true, cell: (day) => day.starts },
];
const dayHeaders = (container: HTMLElement) => [...container.querySelectorAll("tbody th[scope=row]")].map(text);

test("headerGroup: consecutive columns share one colgroup cell in a first header row; a column without one spans both", () => {
  const { container } = renderUi(<Table<Day> label="Days" caption="Day by day" columns={DAY_COLUMNS} rows={DAYS.slice(0, 2)} rowKey={(day) => day.date} />);
  const [first, second] = container.querySelectorAll("thead tr");
  expect([...first.children].map((th) => [text(th), th.getAttribute("scope"), th.getAttribute("colspan"), th.getAttribute("rowspan")])).toEqual([
    ["Day", "col", null, "2"], ["In band, %", "colgroup", "3", null], ["Starts", "col", null, "2"],
  ]);
  expect([...second.children].map((th) => [text(th), th.getAttribute("scope"), th.className])).toEqual([["Both", "col", "num"], ["Temp", "col", "num"], ["VPD", "col", "num"]]);
  cleanup();
  // A table without groups keeps one header row; the phone list ignores groups and labels each value by its own header.
  const list = renderUi(<Table<Day> label="Days" caption="Day by day" columns={DAY_COLUMNS} rows={DAYS.slice(0, 1)} rowKey={(day) => day.date} phone="list" />).container;
  expect([...list.querySelectorAll("tbody td")].map((td) => td.getAttribute("data-label"))).toEqual(["Both", "Temp", "VPD", "Starts"]);
  cleanup();
  expect(renderUi(table()).container.querySelectorAll("thead tr")).toHaveLength(1);
});

test("a head's unit keeps its case in a .unit span, after a comma or in brackets; other heads are left as they are", () => {
  const unit = (head: string) => {
    const { container } = renderUi(<table><thead><tr><th>{headWithUnit(head)}</th></tr></thead></table>);
    const out = [text(container.querySelector("th")), container.querySelector(".unit")?.textContent ?? null];
    cleanup();
    return out;
  };
  expect(unit("In band, %")).toEqual(["In band, %", "%"]);
  expect(unit("Electricity, kWh")).toEqual(["Electricity, kWh", "kWh"]);
  expect(unit("Gas, therms (est.)")).toEqual(["Gas, therms (est.)", "therms (est.)"]);
  expect(unit("Rows, 5 min")).toEqual(["Rows, 5 min", "5 min"]);
  expect(unit("Temperature (°F)")).toEqual(["Temperature (°F)", "°F"]);
  expect(unit("Day")).toEqual(["Day", null]);
  expect(unit("Starts a day")).toEqual(["Starts a day", null]);
  // The headerGroup's unit too.
  const { container } = renderUi(<Table<Day> label="Days" caption="Day by day" columns={DAY_COLUMNS} rows={DAYS.slice(0, 1)} rowKey={(day) => day.date} />);
  expect(container.querySelector("th[scope=colgroup] .unit")?.textContent).toBe("%");
});

test("maxRows: the first rows, then \"Show all N days\" reveals the rest in place and hands the keyboard to the table", () => {
  const { container } = renderUi(<Table<Day> label="Days" caption="Day by day" columns={DAY_COLUMNS} rows={DAYS} rowKey={(day) => day.date} maxRows={14} rowNoun="days" />);
  expect(dayHeaders(container)).toEqual(DAYS.slice(0, 14).map((day) => day.date));
  const more = screen.getByRole("button", { name: "Show all 20 days" });
  expect(more.className).toBe("table-more");
  more.focus();
  fireEvent.click(more);
  expect(dayHeaders(container)).toEqual(DAYS.map((day) => day.date));
  expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("region", { name: "Days" }));
  cleanup();
  // No button when every row fits; the noun defaults to rows.
  expect(renderUi(<Table<Day> label="Days" caption="Days" columns={DAY_COLUMNS} rows={DAYS.slice(0, 14)} rowKey={(day) => day.date} maxRows={14} />).container.querySelector(".table-more")).toBeNull();
  cleanup();
  renderUi(<Table<Day> label="Days" caption="Days" columns={DAY_COLUMNS} rows={DAYS} rowKey={(day) => day.date} maxRows={5} />);
  expect(screen.getByRole("button", { name: "Show all 20 rows" })).toBeTruthy();
});

test("maxRows counts rows across groups in their order, and a text filter searches every row", () => {
  const { container } = renderUi(table({ maxRows: 3 }));
  expect(rowHeaders(container)).toEqual(["VPD Mister Engage", "Mister pulse gap", "Fog enable"]);
  expect([...container.querySelectorAll(".table-group th")].map(text)).toEqual(["planner_policy", "controller_safety"]);
  // "Site pressure" is past the limit, and the filter still finds it.
  fireEvent.change(screen.getByLabelText("Filter settings"), { target: { value: "site" } });
  expect(rowHeaders(container)).toEqual(["Site pressure"]);
  expect(container.querySelector(".table-more")).toBeNull();
  fireEvent.change(screen.getByLabelText("Filter settings"), { target: { value: "" } });
  expect(rowHeaders(container)).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Show all 4 rows" })).toBeTruthy();
});
