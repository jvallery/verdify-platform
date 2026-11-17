// SPDX-License-Identifier: MIT
// Design system v2 §2 and §6 (docs/design/dashboard/v2/design-system.md): the tokens exist once, the light theme and
// both dark blocks define the same colour tokens, the two dark blocks are equal, every value is the one the design
// system names, and root.tsx loads the stylesheets in their fixed order.
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokensCss = uncommented(read("./styles/tokens.css"));
const design = read("../../docs/design/dashboard/v2/design-system.md");

/** The declarations of a block body, in order, as [name, value]. */
const declarations = (body: string) => [...body.matchAll(/(--[a-z0-9-]+|color-scheme)\s*:\s*([^;]+);?/g)].map((match) => [match[1], match[2].trim()] as const);
const blockAfter = (css: string, opener: string) => {
  const start = css.indexOf(opener);
  if (start < 0) return null;
  const open = css.indexOf("{", start + opener.length - 1);
  return css.slice(open + 1, css.indexOf("}", open));
};

const darkAttribute = ':root[data-theme="dark"]{';
const lightPart = tokensCss.slice(0, tokensCss.indexOf(darkAttribute));
const lightBlocks = [...lightPart.matchAll(/:root\{([^}]*)\}/g)].map((match) => declarations(match[1]));
const light = lightBlocks.flat();
const dark = declarations(blockAfter(tokensCss, darkAttribute) ?? "");
const mediaStart = tokensCss.indexOf("@media (prefers-color-scheme:dark)");
const media = declarations(blockAfter(tokensCss.slice(mediaStart), ':root:not([data-theme="light"]){') ?? "");

const isColour = (value: string) => /^(#[0-9a-f]{6}|rgb\(.*\)|color-mix\(.*\))$/i.test(value);
const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

/** The 2.1 and 2.3 tables: | `--name` | `light` | `dark` | ... |, and the 2.2 status table expanded to its 18 tokens. */
function designTokens(): Map<string, { light: string; dark: string }> {
  const tokens = new Map<string, { light: string; dark: string }>();
  for (const [, name, lightValue, darkValue] of design.matchAll(/^\| `(--[a-z0-9-]+)` \| `([^`]+)` \| `([^`]+)` \|/gm)) tokens.set(name, { light: lightValue, dark: darkValue });
  for (const [, status, ...pairs] of design.matchAll(/^\| (ok|warn|serious|critical|info|neutral) \| `(#[0-9a-f]{6})` \/ `(#[0-9a-f]{6})` \| `(#[0-9a-f]{6})` \/ `(#[0-9a-f]{6})` \| `(#[0-9a-f]{6})` \/ `(#[0-9a-f]{6})` \|$/gm)) {
    tokens.set(`--${status}`, { light: pairs[0], dark: pairs[1] });
    tokens.set(`--${status}-soft`, { light: pairs[2], dark: pairs[3] });
    tokens.set(`--${status}-text`, { light: pairs[4], dark: pairs[5] });
  }
  return tokens;
}

test("every token is defined once in the light theme, and color-scheme follows the theme", () => {
  const names = light.map(([name]) => name);
  expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  expect(Object.fromEntries(light)["color-scheme"]).toBe("light");
  expect(Object.fromEntries(dark)["color-scheme"]).toBe("dark");
  expect(Object.fromEntries(media)["color-scheme"]).toBe("dark");
  for (const block of [dark, media]) {
    const own = block.map(([name]) => name);
    expect(own.filter((name, index) => own.indexOf(name) !== index)).toEqual([]);
  }
  // tokens.css is the only place a :root is set, and the dark theme has exactly its two blocks.
  expect(tokensCss.match(/:root\[data-theme="dark"\]\{/g)).toHaveLength(1);
  expect(tokensCss.match(/@media \(prefers-color-scheme:dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{/g)).toHaveLength(1);
});

test("the light theme and both dark blocks define the same colour tokens, and the two dark blocks are equal", () => {
  const colours = (block: readonly (readonly [string, string])[]) => block.filter(([name, value]) => name !== "color-scheme" && (isColour(value) || name.startsWith("--shadow"))).map(([name]) => name).sort();
  const themed = light.filter(([name, value]) => isColour(value) && !value.startsWith("color-mix") || name.startsWith("--shadow")).map(([name]) => name).sort();
  expect(colours(dark)).toEqual(themed);
  expect(colours(media)).toEqual(themed);
  expect(media).toEqual(dark);
});

test("every colour token of design system §2.1, §2.2 and §2.3 holds its value in light and in dark", () => {
  const tokens = designTokens();
  // 26 of §2.1, 18 of §2.2 and 28 of §2.3.
  expect(tokens.size).toBe(72);
  const lightValues = Object.fromEntries(light), darkValues = Object.fromEntries(dark);
  for (const [name, values] of tokens) {
    expect(norm(lightValues[name] ?? ""), `${name} light`).toBe(norm(values.light));
    expect(norm(darkValues[name] ?? ""), `${name} dark`).toBe(norm(values.dark));
  }
});

test("design system §2.5: type, space, shape, shadows, layout and stacking tokens", () => {
  const values = Object.fromEntries(light), darkValues = Object.fromEntries(dark);
  const family = (value: string) => value.replace(/\s*,\s*/g, ", ");
  expect(family(values["--font"])).toBe('"IBM Plex Sans", system-ui, sans-serif');
  expect(family(values["--mono"])).toBe('"IBM Plex Mono", ui-monospace, monospace');
  expect(["xs", "sm", "md", "lg", "xl", "2xl", "3xl"].map((size) => values[`--fs-${size}`])).toEqual([".75rem", ".8125rem", ".9375rem", "1.125rem", "1.5rem", "2rem", "2.75rem"]);
  expect([1, 2, 3, 4, 5, 6, 7, 8].map((step) => values[`--space-${step}`])).toEqual([".25rem", ".5rem", ".75rem", "1rem", "1.5rem", "2rem", "3rem", "4rem"]);
  expect(["--radius-sm", "--radius", "--radius-lg", "--radius-pill"].map((name) => values[name])).toEqual(["6px", "10px", "14px", "999px"]);
  expect(["--shadow-1", "--shadow-2", "--shadow-3"].map((name) => norm(values[name]))).toEqual(["0 1px 2px rgb(15 31 43 / 6%)", "0 4px 16px rgb(15 31 43 / 10%)", "0 16px 48px rgb(15 31 43 / 20%)"]);
  expect(darkValues["--shadow-1"]).toBe("none");
  expect(["--rail-w", "--content", "--gutter", "--tap", "--bar-h", "--topbar-h"].map((name) => values[name])).toEqual(["15rem", "88rem", "clamp(1rem, 3vw, 2rem)", "2.75rem", "3.5rem", "3.5rem"]);
  expect(["raised", "sticky", "nav", "popover", "dialog", "toast"].map((layer) => values[`--z-${layer}`])).toEqual(["3", "10", "20", "30", "40", "50"]);
});

test("root.tsx loads tokens, base, primitives, the frame and the sections, in that fixed order and nothing else", () => {
  const root = read("./root.tsx");
  const imported = new Map([...root.matchAll(/import (\w+) from "\.\/(styles(?:\/[\w-]+)?\.css)\?url";/g)].map((match) => [match[1], match[2]]));
  const list = /export const STYLESHEETS = \[([^\]]+)\]/.exec(root)?.[1].split(",").map((name) => name.trim()).filter(Boolean).map((name) => imported.get(name));
  expect(list).toEqual([
    "tokens.css", "base.css", "primitives.css", "shell.css", "now-activity.css", "graphs.css", "water.css", "control.css", "crops.css",
    "experience.css", "climate.css", "record.css", "review.css", "system.css", "lights.css",
  ].map((name) => `styles/${name}`));
});

test("both font faces load self-hosted Plex files that ship with their OFL notices", () => {
  const base = read("./styles/base.css");
  const fonts = [...base.matchAll(/url\("\/fonts\/([^"]+)"\)/g)].map((match) => match[1]);
  expect(fonts).toEqual(["ibm-plex-sans-latin-wght-normal.woff2", "ibm-plex-mono-latin-400-normal.woff2"]);
  for (const file of [...fonts, "OFL-sans.txt", "OFL-mono.txt"]) expect(existsSync(new URL(`../public/fonts/${file}`, import.meta.url)), file).toBe(true);
  expect(base).toMatch(/font-display:swap/);
});
