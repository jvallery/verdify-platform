// SPDX-License-Identifier: MIT
// Design system v2 §2.4 (docs/design/dashboard/v2/design-system.md): the WCAG ratio of every listed pair, computed
// from tokens.css in the light theme and in the dark theme, so a token edit that breaks a pair fails here. It also
// states that no component holds a colour literal or a style attribute: colours come only from the tokens.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("./tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
const design = read("../../../docs/design/dashboard/v2/design-system.md");

const darkOpener = ':root[data-theme="dark"]{';
const values = (body: string) => new Map([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)].map((match) => [match[1], match[2].trim()]));
const lightTokens = values(css.slice(0, css.indexOf(darkOpener)));
const darkStart = css.indexOf(darkOpener) + darkOpener.length;
const darkTokens = new Map([...lightTokens, ...values(css.slice(darkStart, css.indexOf("}", darkStart)))]);
const THEMES = { light: lightTokens, dark: darkTokens } as const;

function hex(theme: keyof typeof THEMES, token: string): string {
  const value = THEMES[theme].get(token);
  const reference = value && /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (reference) return hex(theme, reference[1]);
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${theme} ${token} is not a hex colour: ${value}`);
  return value;
}
function luminance(colour: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16) / 255).map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** The WCAG 2.2 contrast ratio of two colours. */
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

type Pair = readonly [foreground: string, background: string, minimum: number];
const STATUSES = ["ok", "warn", "serious", "critical", "info", "neutral"];
/** The chart colours of §2.3, read from its table, but the band's wash and the grid, which are areas, not marks. */
const chartTokens = (() => {
  const section = design.slice(design.indexOf("### 2.3"), design.indexOf("### 2.4"));
  return [...section.matchAll(/^\| `(--[a-z0-9-]+)` \|/gm)].map((match) => match[1]).filter((token) => token !== "--c-band-wash" && token !== "--c-grid");
})();
const PAIRS: readonly Pair[] = [
  ...["--text", "--text-2", "--text-3", "--accent"].flatMap((text) => ["--bg", "--surface", "--surface-2"].map((surface) => [text, surface, 4.5] as const)),
  ...["--accent", "--accent-hover", "--critical"].map((fill) => ["--on-accent", fill, 4.5] as const),
  ["--accent-text", "--accent-soft", 4.5],
  ...STATUSES.map((status) => [`--${status}-text`, `--${status}-soft`, 4.5] as const),
  ...STATUSES.map((status) => [`--${status}`, "--surface", 3] as const),
  ["--control-border", "--surface", 3], ["--control-border", "--bg", 3],
  ["--rail-text", "--rail", 4.5], ["--rail-muted", "--rail", 4.5], ["--rail-active-text", "--rail-active", 4.5],
  ["--hero-text", "--hero", 4.5], ["--hero-text-2", "--hero", 4.5], ["--hero-accent", "--hero", 4.5],
  ...chartTokens.flatMap((token) => [[token, "--surface", 3] as const, [token, "--bg", 3] as const]),
];

test("design system §2.4 lists the pairs this test computes", () => {
  // The 28 chart colours of §2.3 but the wash and the grid.
  expect(chartTokens.length).toBe(26);
  expect(PAIRS.length).toBe(12 + 3 + 1 + 6 + 6 + 2 + 3 + 3 + 52);
});

for (const theme of ["light", "dark"] as const) {
  test(`every §2.4 pair meets its ratio in the ${theme} theme`, () => {
    const failing = PAIRS.map(([foreground, background, minimum]) => ({ pair: `${foreground} on ${background}`, minimum, ratio: Number(contrast(hex(theme, foreground), hex(theme, background)).toFixed(2)) }))
      .filter(({ ratio, minimum }) => ratio < minimum);
    expect(failing).toEqual([]);
  });
}

/** Every .ts and .tsx source under a directory, tests and fixtures left out. */
function sources(directory: string): string[] {
  const url = new URL(directory, import.meta.url);
  return readdirSync(url).flatMap((name) => {
    const path = `${directory}${name}`;
    if (statSync(new URL(path, import.meta.url)).isDirectory()) return name === "fixtures" ? [] : sources(`${path}/`);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test("no component, chart or route holds a colour literal or a style attribute", () => {
  const files = ["../components/", "../charts/", "../routes/"].flatMap(sources);
  expect(files.length).toBeGreaterThan(100);
  const literal = /(["'`])#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\1|\b(?:rgba?|hsla?|hwb|oklch|oklab)\(|(["'`])(?:white|black)\2/gi;
  const offending = files.flatMap((file) => {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    return [...code.matchAll(literal), ...code.matchAll(/\sstyle=\{/g)].map((match) => `${file}: ${match[0]}`);
  });
  expect(offending).toEqual([]);
});
