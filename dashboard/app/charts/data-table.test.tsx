// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChartFoot, CsvLink, DataTable, TimeCell } from "./data-table";

const { createObjectURL, revokeObjectURL } = URL;
let made: string[] = [];
beforeEach(() => {
  made = [];
  URL.createObjectURL = vi.fn(() => { made.push(`blob:${made.length + 1}`); return made[made.length - 1]; });
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL; });

test("the data table states its rows, builds them only once opened, and heads each row with its time", async () => {
  const rows = vi.fn(() => [[<TimeCell key="t" at={1_793_518_200} />, "64.2 °F", "No data 02:10–02:40: controller connection lost"]]);
  const { container } = render(<DataTable tables={[{ caption: "Indoor temperature · America/Denver", headers: ["Time", "Indoor temperature (°F)", "Note"], rows, count: 1 }]} />);
  expect(container.querySelector("summary")!.textContent).toBe("Data table · 1 row");
  expect(rows).not.toHaveBeenCalled();
  const details = container.querySelector("details")!;
  act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  const region = screen.getByRole("region", { name: "Indoor temperature · America/Denver" });
  expect(region.getAttribute("tabindex")).toBe("0");
  const time = region.querySelector("tbody th[scope=row] time")!;
  expect(time.textContent).toBe("11/01/2026 01:30 GMT-06:00");
  expect(time.getAttribute("datetime")).toBe("2026-11-01T07:30:00.000Z");
});

test("a table in a card with another is named by its subject, and its count has thousands separators", () => {
  const { container } = render(<DataTable name="Climate table" tables={[{ caption: "Climate · America/Denver", headers: ["Time"], rows: () => [], count: 4341 }]} />);
  expect(container.querySelector("summary")!.textContent).toBe("Climate table · 4,341 rows");
});

test("CSV of this window is a Blob URL behind <a download>, replaced when the data changes and revoked on unmount", () => {
  const build = vi.fn(() => "time (America/Denver)\r\n");
  const version = {};
  const { rerender, unmount } = render(<CsvLink filename="verdify-graphs.csv" build={build} version={version} />);
  const link = screen.getByRole("link", { name: "CSV of this window" });
  expect([link.getAttribute("href"), link.getAttribute("download")]).toEqual(["blob:1", "verdify-graphs.csv"]);
  rerender(<CsvLink filename="verdify-graphs.csv" build={build} version={version} />);
  expect(build).toHaveBeenCalledTimes(1);
  rerender(<CsvLink filename="verdify-graphs.csv" build={build} version={{}} />);
  expect(link.getAttribute("href")).toBe("blob:2");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:2");
});

test("the chart's quiet line: the table's disclosure, then the tools and a link-style CSV named in full for a screen reader", () => {
  const tables = [{ caption: "Starts · America/Denver", headers: ["Day", "Starts"], rows: () => [], count: 30 }];
  const { container } = render(<ChartFoot tables={tables} csv={{ filename: "verdify-starts.csv", build: () => "day\r\n", version: 1 }} tools={<button type="button" className="chart-tool">Reset zoom</button>} />);
  const foot = container.querySelector(".chart-foot")!;
  expect([...foot.children].map((child) => child.className)).toEqual(["chart-table", "chart-foot-tools"]);
  expect(foot.querySelector("summary")?.textContent).toBe("Data table · 30 rows");
  const csv = screen.getByRole("link", { name: "CSV of this chart" });
  expect([csv.textContent, csv.className, csv.getAttribute("download")]).toEqual(["CSV", "chart-csv", "verdify-starts.csv"]);
  expect([...foot.querySelectorAll(".chart-foot-tools > *")].map((child) => child.textContent)).toEqual(["Reset zoom", "CSV"]);
  cleanup();
  // A table alone, a CSV alone, or nothing at all.
  expect(render(<ChartFoot tables={tables} />).container.querySelector(".chart-foot-tools")).toBeNull();
  cleanup();
  render(<ChartFoot csv={{ filename: "x.csv", build: () => "", version: 1, label: "CSV of this window" }} />);
  expect(screen.getByRole("link", { name: "CSV of this window" }).textContent).toBe("CSV");
  cleanup();
  expect(render(<ChartFoot tables={[]} csv={null} />).container.innerHTML).toBe("");
});
