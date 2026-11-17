// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { EmptyState as FromPanel } from "./panel";
import { renderUi, text } from "./test-render";

afterEach(cleanup);

test("a plain sentence, what would appear here, and one way on", () => {
  const { container } = renderUi(<EmptyState message="No runs today." detail="A run shows here when a line waters." widen={{ to: "/water?range=7d", label: "Show the last 7 days" }} />);
  const box = container.querySelector(".empty-state")!;
  expect([...box.querySelectorAll("p")].map(text)).toEqual(["No runs today.", "A run shows here when a line waters.", "Show the last 7 days"]);
  expect(screen.getByRole("link", { name: "Show the last 7 days" }).getAttribute("href")).toBe("/water?range=7d");
  expect(box.getAttribute("role")).toBeNull();
});

test("one control instead of a link; the panel re-exports the same component", () => {
  renderUi(<EmptyState message="No line is set up." action={<Button>Add a line</Button>} />);
  expect(screen.getByRole("button", { name: "Add a line" })).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
  expect(FromPanel).toBe(EmptyState);
});
