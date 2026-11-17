// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Every screen's head (design-system section 3, Page): the breadcrumb of group and section, one h1, the purpose line,
// the reserved status line, at most two actions, and the section's underlined tabs from lib/sections.ts.
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderUi, text } from "../test-render";
import { PageHeader, SectionTabs, keptQuery } from "./page-header";

afterEach(cleanup);
const crumbs = () => screen.getByRole("navigation", { name: "Breadcrumb" });
const items = () => [...crumbs().querySelectorAll("li")].map((item) => text(item));

test("on a section's default view the breadcrumb is the group, then the section as the current page, not a link", () => {
  renderUi(<PageHeader view="water-today" />);
  expect(items()).toEqual(["Operate", "›Water"]);
  expect(within(crumbs()).queryByRole("link")).toBeNull();
  expect(crumbs().querySelector("[aria-current=page]")?.textContent).toBe("Water");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Water today");
  // The breadcrumb labels; it is never a heading. The separator is decoration.
  expect(screen.getAllByRole("heading")).toHaveLength(1);
  expect([...crumbs().querySelectorAll(".page-crumb-sep")].every((sep) => sep.getAttribute("aria-hidden") === "true")).toBe(true);
});

test("on another view the section links to its default view; the purpose line is the view's own", () => {
  renderUi(<PageHeader view="climate-band" />);
  expect(items()).toEqual(["Operate", "›Climate"]);
  expect(within(crumbs()).getByRole("link", { name: "Climate" }).getAttribute("href")).toBe("/climate");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Band");
  expect(text(document.querySelector(".page-description"))).toBe("The band you want the house held in.");
});

test("a retired view id draws the view that took its place", () => {
  renderUi(<PageHeader view="control-equipment" />);
  expect(items()).toEqual(["System", "›Equipment"]);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Equipment");
});

test("a focused state names itself in the h1 and adds the view after the section, both links", () => {
  renderUi(<PageHeader view="graphs-zones" title="South zone" />);
  expect(items()).toEqual(["Understand", "›Graphs", "›Zones"]);
  expect(within(crumbs()).getAllByRole("link").map((link) => [text(link), link.getAttribute("href")])).toEqual([["Graphs", "/graphs"], ["Zones", "/graphs/zones"]]);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("South zone");
});

test("a purpose can be replaced or left out", () => {
  renderUi(<PageHeader view="record-days" purpose="Thirty days of the record." />);
  expect(text(document.querySelector(".page-description"))).toBe("Thirty days of the record.");
  cleanup();
  renderUi(<PageHeader view="record-days" purpose={null} />);
  expect(document.querySelector(".page-description")).toBeNull();
});

test("the status line is a .meta line, kept while it loads (null) and absent when the page has none; a phone wording renders beside it", () => {
  renderUi(<PageHeader view="graphs-explore" status={null} />);
  expect(document.querySelector(".page-status")?.className).toBe("page-status meta");
  expect(text(document.querySelector(".page-status"))).toBe("");
  cleanup();
  renderUi(<PageHeader view="graphs-explore" />);
  expect(document.querySelector(".page-status")).toBeNull();
  cleanup();
  renderUi(<PageHeader view="water-today" status="Program rev 42 on controller · confirmed 2 min ago" statusShort="Rev 42 on controller · 2 min ago" />);
  expect([document.querySelector(".page-status")?.className, text(document.querySelector(".page-status"))]).toEqual(["page-status meta page-status-long", "Program rev 42 on controller · confirmed 2 min ago"]);
  expect([document.querySelector(".page-status-short")?.className, text(document.querySelector(".page-status-short"))]).toEqual(["page-status-short meta", "Rev 42 on controller · 2 min ago"]);
});

test("the tabs are a labelled nav.tabs of links, the current one aria-current=page; a one-view section has none", () => {
  renderUi(<PageHeader view="activity-log" actions={<button type="button">Export</button>} tabsEnd={<button type="button">Stop all</button>} stickyTabs />);
  const tabs = screen.getByRole("navigation", { name: "Activity views" });
  expect(tabs.className).toBe("tabs");
  expect(within(tabs).getAllByRole("link").map((link) => [text(link), link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
    ["Alerts", "/activity", null], ["Log", "/activity/log", "page"],
  ]);
  expect(document.querySelector(".page-tabs")?.className).toBe("page-tabs page-tabs-sticky");
  expect(text(document.querySelector(".page-tabs-end"))).toBe("Stop all");
  expect(text(document.querySelector(".page-actions"))).toBe("Export");
  expect(document.querySelector("[style]")).toBeNull();
  cleanup();
  renderUi(<PageHeader view="record-utilities" />);
  expect(within(screen.getByRole("navigation", { name: "Record views" })).getAllByRole("link").map(text)).toEqual(["Days", "In band", "Equipment", "Utilities"]);
  cleanup();
  renderUi(<><SectionTabs view="now" /><PageHeader view="system-controller" /></>);
  expect(screen.queryByRole("navigation", { name: /views$/ })).toBeNull();
  expect(document.querySelector(".page-tabs")).toBeNull();
});

test("a section that keeps a query (Record's window) carries it on every tab; other parameters and an unset one stay off", () => {
  expect(keptQuery("?days=90&alert=4", ["days"])).toBe("?days=90");
  expect(keptQuery("?alert=4", ["days"])).toBe("");
  expect(keptQuery("?days=90", undefined)).toBe("");
});
