// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// The theme (design-system sections 2 and 4): the cookie the server reads, data-theme on <html> at once, the
// theme-color metas, the verdify:theme event, and one state for every switch on the page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { THEME_COLORS, THEME_EVENT, themeColors, themeCookie, themeFromCookie, type Theme } from "../../lib/theme";
import { ThemeProvider, ThemeSwitch } from "./theme-switch";

const clearCookie = () => { document.cookie = "theme=; Max-Age=0; Path=/"; };
beforeEach(() => {
  clearCookie();
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = '<meta name="theme-color" media="(prefers-color-scheme: light)" content="x"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="x">';
});
afterEach(() => { cleanup(); clearCookie(); document.head.innerHTML = ""; });

test("the cookie chooses Light or Dark; anything else, or none, is System", () => {
  expect(themeFromCookie("__Host-verdify_session=abc; theme=dark")).toBe("dark");
  expect(themeFromCookie("theme=light")).toBe("light");
  for (const header of [null, "", "theme=blue", "themes=dark", "theme="]) expect(themeFromCookie(header), String(header)).toBe("system");
});

test("the cookie lasts a year at Path=/ with SameSite=Lax and Secure on https; System expires it", () => {
  expect(themeCookie("dark", true)).toBe("theme=dark; Max-Age=31536000; Path=/; SameSite=Lax; Secure");
  expect(themeCookie("light", false)).toBe("theme=light; Max-Age=31536000; Path=/; SameSite=Lax");
  expect(themeCookie("system", true)).toBe("theme=; Max-Age=0; Path=/; SameSite=Lax; Secure");
});

test("the theme-color metas name each scheme's surface for System, and the chosen theme's for both otherwise", () => {
  expect(themeColors("system")).toEqual([
    { media: "(prefers-color-scheme: light)", content: THEME_COLORS.light }, { media: "(prefers-color-scheme: dark)", content: THEME_COLORS.dark },
  ]);
  expect(themeColors("dark").map((meta) => meta.content)).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);
});

test("the theme-color values are --surface of tokens.css in light and in dark", () => {
  const tokens = readFileSync(join(process.cwd(), "app/styles/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const surface = (block: string) => /--surface:\s*([^;]+);/.exec(block)?.[1].trim().toLowerCase();
  const light = /:root\{([^}]*)\}/.exec(tokens)?.[1] ?? "";
  const dark = /:root\[data-theme="dark"\]\{([^}]*)\}/.exec(tokens)?.[1] ?? "";
  expect([surface(light), surface(dark)]).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
});

test("a choice applies at once: data-theme, the cookie, the metas and one verdify:theme event; every switch follows", () => {
  const events: unknown[] = [];
  const listen = (event: Event) => events.push((event as CustomEvent<Theme>).detail);
  document.addEventListener(THEME_EVENT, listen);
  render(<ThemeProvider initial="dark"><div data-testid="a"><ThemeSwitch /></div><div data-testid="b"><ThemeSwitch /></div></ThemeProvider>);
  const group = (id: string) => within(screen.getByTestId(id)).getByRole("group", { name: "Theme" });
  const radio = (id: string, name: string) => within(group(id)).getByRole<HTMLInputElement>("radio", { name });
  expect(within(group("a")).getAllByRole("radio").map((input) => input.closest("label")?.textContent)).toEqual(["System", "Light", "Dark"]);
  // The server already drew the cookie's theme: the switch starts on it and changes nothing until a choice.
  expect([radio("a", "Dark").checked, radio("b", "Dark").checked]).toEqual([true, true]);
  expect(events).toEqual([]);

  fireEvent.click(radio("a", "Light"));
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(document.cookie).toContain("theme=light");
  expect([...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content)).toEqual([THEME_COLORS.light, THEME_COLORS.light]);
  expect(radio("b", "Light").checked).toBe(true);
  expect(events).toEqual(["light"]);

  fireEvent.click(radio("b", "System"));
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(document.cookie).not.toContain("theme=");
  expect([...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content)).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
  expect(radio("a", "System").checked).toBe(true);
  expect(events).toEqual(["light", "system"]);
  document.removeEventListener(THEME_EVENT, listen);
  // Two switches on one page keep their radios apart.
  expect(new Set(screen.getAllByRole<HTMLInputElement>("radio").map((input) => input.name)).size).toBe(2);
});
