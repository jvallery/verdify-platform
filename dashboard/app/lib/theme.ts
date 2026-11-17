// SPDX-License-Identifier: MIT
/**
 * The theme (design-system section 2, section 4 "Theme switch"): System, Light or Dark. A chosen theme lives in the
 * `theme` cookie, which the root loader reads, so the server renders `data-theme` on `<html>` and the first paint is
 * right with no inline script. System clears the cookie and the attribute, and the stylesheet follows
 * `prefers-color-scheme`. A change dispatches `verdify:theme` on the document, so a chart that read its colours from
 * the tokens reads them again.
 */

export type Theme = "system" | "light" | "dark";
export const THEMES: readonly Theme[] = ["system", "light", "dark"];
export const THEME_COOKIE = "theme";
export const THEME_EVENT = "verdify:theme";
/** One year. */
export const THEME_MAX_AGE_S = 31_536_000;

/**
 * The browser's colour behind the top bar, one per theme: `--surface` of tokens.css in each theme (a meta tag cannot
 * read a custom property). `theme.test.tsx` holds these equal to tokens.css.
 */
export const THEME_COLORS: Readonly<Record<"light" | "dark", string>> = { light: "#ffffff", dark: "#111c22" };

/** The theme a `Cookie` header chose; System when it chose none or something unknown. */
export function themeFromCookie(header: string | null | undefined): Theme {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== THEME_COOKIE) continue;
    const value = rest.join("=").trim();
    if (value === "light" || value === "dark") return value;
  }
  return "system";
}

/**
 * The `Set-Cookie`-shaped string `document.cookie` takes for `theme`: a year for Light or Dark, an expired cookie for
 * System. Secure on https, which is every real page; the browser suite's http://localhost would drop a Secure cookie.
 */
export function themeCookie(theme: Theme, secure: boolean): string {
  const value = theme === "system" ? `${THEME_COOKIE}=; Max-Age=0` : `${THEME_COOKIE}=${theme}; Max-Age=${THEME_MAX_AGE_S}`;
  return `${value}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The two `theme-color` metas: one per colour scheme, both naming the chosen theme's colour when one is chosen. */
export function themeColors(theme: Theme): readonly { readonly media: string; readonly content: string }[] {
  return (["light", "dark"] as const).map((scheme) => ({ media: `(prefers-color-scheme: ${scheme})`, content: THEME_COLORS[theme === "system" ? scheme : theme] }));
}

/**
 * Applies `theme` at once: the cookie, `data-theme` on `<html>` (removed for System), the `theme-color` metas, then
 * the `verdify:theme` event (its `detail` is the theme).
 */
export function applyTheme(theme: Theme, doc: Document = document) {
  doc.cookie = themeCookie(theme, doc.location?.protocol === "https:");
  const root = doc.documentElement;
  if (theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme);
  const metas = [...doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  for (const { media, content } of themeColors(theme)) {
    metas.find((element) => element.getAttribute("media") === media)?.setAttribute("content", content);
  }
  doc.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
}
