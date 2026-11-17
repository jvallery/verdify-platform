// SPDX-License-Identifier: MIT
// Design system v2 §6: the list and order of the stylesheets under app/styles, each opening with its licence and its
// section name; no colour literal outside tokens.css; no :root and no theme rule outside tokens.css; one reduced-motion
// rule in base.css. charts/charts.css is loaded by chartLinks() and holds to the same colour rule.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
/** The fixed load order (root.tsx STYLESHEETS; styles.test.ts checks root.tsx against it too). */
const ORDER = [
  "tokens.css", "base.css", "primitives.css", "shell.css", "now-activity.css", "graphs.css", "water.css", "control.css", "crops.css",
  "experience.css", "climate.css", "record.css", "review.css", "system.css", "lights.css",
];
const sections = ORDER.map((name) => ({ name, text: read(`./${name}`) }));
const charts = { name: "charts.css", text: read("../charts/charts.css") };
const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
/** Every rule's selector list and declarations, rules inside @media included. */
const rules = (css: string) => [...uncommented(css).matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].trim().replace(/^@media[^{]*\{/, "").split(",").map((selector) => selector.trim()),
  properties: [...match[2].matchAll(/([a-z-]+)\s*:/g)].map((declaration) => declaration[1]),
}));

test("app/styles holds exactly the fifteen stylesheets, and root.tsx loads them in the fixed order", () => {
  const files = readdirSync(new URL("./", import.meta.url)).filter((name) => name.endsWith(".css"));
  expect([...files].sort()).toEqual([...ORDER].sort());
  const root = read("../root.tsx");
  const imported = new Map([...root.matchAll(/import (\w+) from "\.\/(styles\/[\w-]+\.css)\?url";/g)].map((match) => [match[1], match[2]]));
  const list = /export const STYLESHEETS = \[([^\]]+)\]/.exec(root)?.[1].split(",").map((name) => name.trim()).filter(Boolean).map((name) => imported.get(name));
  expect(list).toEqual(ORDER.map((name) => `styles/${name}`));
  // The chart stylesheet is not global: only chart routes add it.
  expect(root).not.toMatch(/charts\.css/);
});

test("each stylesheet opens with its licence and its section name", () => {
  for (const { name, text } of sections) expect(text, name).toMatch(/^\/\* SPDX-License-Identifier: MIT \*\/\n\/\* Section: [^*\n]+ \*\/\n/);
});

test("no stylesheet but tokens.css holds a colour literal, a :root or a theme rule", () => {
  for (const { name, text } of [...sections.slice(1), charts]) {
    const css = uncommented(text);
    expect([...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0]), name).toEqual([]);
    expect(css, name).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/);
    expect(css.match(/(?<![\w-])(?:white|black)(?![\w-])/g) ?? [], name).toEqual([]);
    expect(css, name).not.toMatch(/:root\b/);
    expect(css, name).not.toMatch(/prefers-color-scheme|data-theme/);
  }
});

test("no stylesheet but tokens.css sets a global token", () => {
  const tokens = uncommented(read("./tokens.css"));
  const globals = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
  expect(globals.size).toBeGreaterThan(100);
  for (const { name, text } of [...sections.slice(1), charts]) {
    const set = [...uncommented(text).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]);
    expect(set.filter((property) => globals.has(property)), name).toEqual([]);
  }
});

test("base.css holds the one reduced-motion rule, and only base.css sets the focus ring and input borders", () => {
  const base = uncommented(read("./base.css"));
  expect(base.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)/g)).toHaveLength(1);
  expect(base).toMatch(/:focus-visible\{outline:3px solid var\(--focus\);outline-offset:2px\}/);
  for (const { name, text } of [...sections.slice(2), charts]) {
    for (const rule of rules(text)) {
      for (const selector of rule.selectors) {
        const subject = selector.split(/[\s>+~]+/).at(-1) ?? "";
        if (subject === ":focus-visible") expect(rule.properties.filter((property) => property === "outline"), `${name}: ${selector}`).toEqual([]);
        if (/^(?:input|select|textarea)(?:\[[^\]]*\]|:[\w-]+)*$/.test(selector)) expect(rule.properties.filter((property) => property.startsWith("border")), `${name}: ${selector}`).toEqual([]);
      }
    }
  }
});

/** Every .ts and .tsx source under a directory, tests left out. */
function sources(directory: string): string[] {
  return readdirSync(new URL(directory, import.meta.url)).flatMap((name) => {
    const path = `${directory}${name}`;
    if (statSync(new URL(path, import.meta.url)).isDirectory()) return sources(`${path}/`);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test("every var() in the foundation stylesheets names a token, a property a rule sets, or one the code sets", () => {
  const files = [...sections.filter(({ name }) => name !== "shell.css" && name !== "experience.css"), charts];
  const all = [...sections, charts].map(({ text }) => uncommented(text)).join("\n");
  const defined = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
  // Set at run time through cssVars() or setProperty(): positions, widths and the shell's header height.
  const code = ["../components/", "../charts/", "../routes/"].flatMap(sources).map((file) => read(file)).join("\n");
  const runtime = new Set([...code.matchAll(/["'`](--[a-z0-9-]+)["'`]/g)].map((match) => match[1]));
  for (const { name, text } of files) {
    const used = [...uncommented(text).matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]);
    expect([...new Set(used.filter((token) => !defined.has(token) && !runtime.has(token)))], name).toEqual([]);
  }
});
