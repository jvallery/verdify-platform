// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// A review's summary as prose (dashboard v2 screens section 8, row 2): paragraphs and simple lists only, and a long
// summary collapsed after about 12 lines with Read all, which opens it in place.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderUi } from "../test-render";
import { ReviewProse } from "./review-prose";

afterEach(cleanup);

test("a short summary shows whole, its paragraphs and list kept, with no Read all", () => {
  const { container } = renderUi(<ReviewProse summary={"First **part**.\n\n- one\n- two\n\nLast."} />);
  expect([...container.querySelectorAll(".rv-prose > *")].map((node) => `${node.tagName}:${node.textContent}`)).toEqual(["P:First part.", "UL:onetwo", "P:Last."]);
  expect(container.querySelector("[data-collapsed]")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

test("a long summary collapses and Read all opens it in place", () => {
  const summary = Array.from({ length: 8 }, (_, index) => `Paragraph ${index + 1}.`).join("\n\n");
  const { container } = renderUi(<ReviewProse summary={summary} />);
  const prose = container.querySelector(".rv-prose")!;
  expect(prose.className).toContain("rv-prose-collapsed");
  // The whole text stays in the document while collapsed.
  expect(prose.querySelectorAll("p")).toHaveLength(8);
  const button = screen.getByRole("button", { name: "Read all" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.getAttribute("aria-controls")).toBe(prose.id);
  fireEvent.click(button);
  expect(prose.className).not.toContain("rv-prose-collapsed");
  expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
});
