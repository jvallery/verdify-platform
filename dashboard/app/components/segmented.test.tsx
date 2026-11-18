// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Segmented } from "./segmented";
import { renderUi } from "./test-render";

afterEach(cleanup);

test("link segments: the selected one is the current page, and the group is named", () => {
  const { container } = renderUi(<Segmented label="Range" value="24h" segments={[{ value: "24h", label: "24 h", to: "?range=24h" }, { value: "7d", label: "7 days", to: "?range=7d" }]} />);
  const list = screen.getByRole("list", { name: "Range" });
  expect(list.className).toBe("segmented");
  expect(screen.getByRole("link", { name: "24 h" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "7 days" }).hasAttribute("aria-current")).toBe(false);
  expect(container.querySelectorAll("button")).toHaveLength(0);
});

test("button segments toggle with aria-pressed and report only a new choice; the small size", () => {
  const onChange = vi.fn();
  renderUi(<Segmented label="Show" size="sm" value="day" onChange={onChange} segments={[{ value: "day", label: "Day" }, { value: "night", label: "Night" }]} />);
  expect(screen.getByRole("list", { name: "Show" }).className).toBe("segmented segmented-sm");
  const day = screen.getByRole("button", { name: "Day" }), night = screen.getByRole("button", { name: "Night" });
  expect([day.getAttribute("aria-pressed"), night.getAttribute("aria-pressed")]).toEqual(["true", "false"]);
  fireEvent.click(day);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(night);
  expect(onChange).toHaveBeenCalledWith("night");
});

test("a count follows its label a gap apart, in the count style, never glued to it (\"All 135\")", () => {
  const { container } = renderUi(<Segmented label="Show" value="all" segments={[
    { value: "all", label: "All", count: 135, to: "?show=all" }, { value: "none", label: "Not used", count: 0, to: "?show=none" }, { value: "host", label: "Host", count: null, to: "?show=host" },
  ]} />);
  expect(screen.getByRole("link", { name: "All 135" }).querySelector(".segmented-count")?.textContent).toBe("135");
  expect(screen.getByRole("link", { name: "Not used 0" })).toBeTruthy();
  // Unknown: the label alone.
  expect(screen.getByRole("link", { name: "Host" }).querySelector(".segmented-count")).toBeNull();
  expect(container.querySelector(".segmented a")?.textContent).toBe("All 135");
});
