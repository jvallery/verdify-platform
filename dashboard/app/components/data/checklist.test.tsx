// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderUi, text } from "../test-render";
import { Checklist } from "./checklist";

afterEach(cleanup);

test("rows of a mark, a statement and a detail; met is ok, unmet warn, unknown neutral, and each says so in words", () => {
  renderUi(<Checklist label="Drying" items={[
    { key: "dry", mark: "met", statement: "The air is wetter than the band's high edge.", detail: "VPD 0.62 kPa against 0.80 kPa" },
    { key: "cost", mark: "unmet", statement: "Drying costs less than the limit." },
    { key: "out", mark: "unknown", statement: "Outdoor air is drier.", detail: "No outdoor reading since 06:10" },
  ]} />);
  const rows = screen.getAllByRole("listitem");
  expect(screen.getByRole("list", { name: "Drying" }).className).toBe("checklist");
  expect(rows.map((row) => [row.className, row.getAttribute("data-mark")])).toEqual([
    ["checklist-row checklist-ok", "met"], ["checklist-row checklist-warn", "unmet"], ["checklist-row checklist-neutral", "unknown"],
  ]);
  expect(rows.map((row) => text(row.querySelector(".checklist-statement")))).toEqual([
    "Met: The air is wetter than the band's high edge.", "Not met: Drying costs less than the limit.", "Unknown: Outdoor air is drier.",
  ]);
  expect(rows.map((row) => row.querySelector(".checklist-detail") && text(row.querySelector(".checklist-detail")))).toEqual(["VPD 0.62 kPa against 0.80 kPa", null, "No outdoor reading since 06:10"]);
  expect(rows.every((row) => row.querySelector(".checklist-mark svg")?.getAttribute("aria-hidden") === "true")).toBe(true);
});

test("a row's tone overrides its default colour", () => {
  renderUi(<Checklist items={[{ mark: "unmet", statement: "The controller is reporting.", tone: "critical" }]} />);
  expect(screen.getByRole("listitem").className).toBe("checklist-row checklist-critical");
});
