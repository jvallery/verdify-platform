// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
import { cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Skeleton } from "./skeleton";
import { renderUi, text } from "./test-render";

afterEach(cleanup);

test("a block at its reserved height, hidden from assistive technology, with the words said once", () => {
  const { container } = renderUi(<Skeleton size="lg" label="runs" />);
  const block = container.querySelector(".skeleton")!;
  expect(block.className).toBe("skeleton skeleton-lg");
  expect(block.getAttribute("aria-hidden")).toBe("true");
  expect(text(container.querySelector(".screen-reader"))).toBe("Loading runs");
  cleanup();
  expect(renderUi(<Skeleton label="water" />).container.querySelector(".skeleton")?.className).toBe("skeleton skeleton-md");
});

test("text lines instead of a block", () => {
  const { container } = renderUi(<Skeleton lines={3} label="the record" />);
  expect(container.querySelectorAll(".skeleton.skeleton-line")).toHaveLength(3);
  expect(container.querySelector("[aria-hidden=true] .skeleton-line")).not.toBeNull();
});
