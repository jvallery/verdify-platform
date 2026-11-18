// SPDX-License-Identifier: MIT
/**
 * Nothing retired stays on screen (dashboard v2 README principle 8, words.md section 3). This reads every source file
 * the app ships (tests, test helpers and the generated contract left out) with the TypeScript parser and fails on a
 * retired word inside text that renders: JSX text, and string and template literals outside the places that never
 * render (import paths, object keys, type positions, comparisons and `case` labels, the arguments of lookups such as
 * `words()` or `get()`, and the JSX attributes that hold names rather than words: `className`, `to`, `href`, `id`,
 * `key`, `data-*` and the like). A literal shaped like a code (no space, and lower case or upper snake case, or with
 * `_`, `.`, `/` or `:` in it) is a key or an API value, not copy. Each failure names the file, the line and the word.
 * The few legitimate uses are in `ALLOWED`, each by exact file and word with its reason.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

const ROOT = new URL("../", import.meta.url).pathname;

/** words.md section 3, as patterns. "manual" and "schedule" keep their narrowed meaning, so only the retired phrases are listed. */
const RETIRED: readonly (readonly [word: string, pattern: RegExp])[] = [
  ["plan", /\bplan(?:s|ned|ning)?\b/i],
  ["planner", /\bplanners?\b/i],
  ["waypoint", /\bwaypoints?\b/i],
  ["required trigger", /\brequired triggers?\b/i],
  ["Iris changed", /\bIris (?:changed|plans|leaves)\b/i],
  ["Let Iris change this", /\bLet Iris change\b/i],
  ["mode", /\bmodes?\b/i],
  ["stage", /\bstages?\b/i],
  ["In band, holding", /\bIn band, holding\b/i],
  ["target", /(?<!\bsoil (?:moisture )?)\btargets?\b(?! range)/i],
  ["width", /\bwidths?\b/i],
  ["bias", /\bbias(?:es)?\b/i],
  ["tunable", /\btunables?\b/i],
  ["cascade", /\bcascades?\b/i],
  ["zone band", /\bzone bands?\b/i],
  ["crop band", /\bcrop bands?\b/i],
  ["experiment", /\bexperiments?\b/i],
  ["study", /\b(?:study|studies)\b/i],
  ["forecast band", /\bforecast bands?\b/i],
  ["scorecard", /\bscorecards?\b/i],
  ["trust ledger", /\btrust ledger\b/i],
  ["dispatcher", /\bdispatchers?\b/i],
  ["burst", /\bbursts?\b/i],
  ["bypass", /\bbypass(?:es|ed)?\b/i],
  ["manual lock", /\bmanual cleared\b|\bso Iris\b/i],
  // As a badge on the band: the upper-case word only (a Graphs series' provenance is allowed by file below).
  ["DERIVED", /\bDERIVED\b/],
];

/**
 * The legitimate uses, by exact file (relative to `app/`) and word, each with its reason. Keep it short: a use that
 * only renders on a retired screen is an offender until that screen is deleted, never an entry here.
 */
const ALLOWED: readonly { readonly file: string; readonly word: string; readonly reason: string }[] = [
  { file: "lib/narrow.ts", word: "width", reason: "the 860 px CSS media query, never rendered" },
  { file: "root.tsx", word: "width", reason: "the viewport meta's content, never rendered" },
  { file: "lib/crops.ts", word: "stage", reason: "a planting's growth stage, a crop record field, not the controller's mist stage" },
  { file: "components/crops/drawers.tsx", word: "stage", reason: "a planting's growth stage, a crop record field, not the controller's mist stage" },
  { file: "components/system/data-blocks.tsx", word: "dispatcher", reason: "System → Data names the host's delivery stage by its name (words.md: dispatcher stays in Data)" },
  { file: "lib/words.ts", word: "planner", reason: "System → Data's delivery table names the retired settings writer of old rows \"The planner (retired)\" (manager's review B6)" },
  { file: "lib/graph-law.ts", word: "DERIVED", reason: "a Graphs series' provenance (API-03 `provenance`), not a badge on the band" },
  { file: "lib/graph-overlay.ts", word: "DERIVED", reason: "a Graphs series' provenance (API-03 `provenance`), not a badge on the band" },
  { file: "lib/graph-zones.ts", word: "DERIVED", reason: "a Graphs series' provenance (API-03 `provenance`), not a badge on the band" },
];

/** JSX attributes that hold names, paths or codes rather than words a person reads. */
const NAME_ATTRIBUTES = new Set([
  "className", "to", "href", "id", "key", "name", "type", "role", "rel", "target", "htmlFor", "src", "method", "action", "form", "value", "defaultValue",
  "autoComplete", "inputMode", "pattern", "as", "variant", "size", "kind", "tone", "status", "icon", "token", "view", "family", "operation", "state",
  "aria-controls", "aria-labelledby", "aria-describedby", "aria-current", "aria-haspopup", "aria-live", "aria-orientation", "lang", "download", "accept",
]);
/** Calls whose string arguments are keys, selectors or codes, never copy. */
const LOOKUP_CALLS = new Set([
  "words", "hasWords", "alertAbout", "apiGet", "useApiRead", "readKey", "viewMeta", "viewOf", "sectionOf", "currentViewId", "Error", "RegExp", "startsWith",
  "endsWith", "includes", "has", "get", "set", "delete", "getAll", "append", "getAttribute", "setAttribute", "removeAttribute", "querySelector",
  "querySelectorAll", "getElementById", "closest", "matches", "addEventListener", "removeEventListener", "dispatchEvent", "setProperty",
  "getPropertyValue", "removeProperty", "cls", "matchMedia", "require", "log", "warn", "error", "info", "debug", "localeCompare", "replace", "replaceAll",
  "split", "indexOf", "lastIndexOf", "createElement", "glossaryEntry", "lineById", "settingOf", "useOperation", "useCommand", "CustomEvent", "Event",
]);
/** A literal shaped like a code, a key or a path: no space, and lower case or upper snake case, or with a separator in it. */
const CODE_SHAPED = /^(?:[a-z0-9_.:\-/#?=&@%*+[\]{}()]*|[A-Z0-9_]+|\S*[_./:]\S*)$/;

type Hit = { readonly file: string; readonly line: number; readonly word: string; readonly text: string };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/(?:^|[-.])test[-.]/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

function calleeName(call: ts.CallExpression | ts.NewExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/** True when the literal at `node` never renders: a module path, a key, a type, a comparison, a lookup's argument or a name attribute. */
function neverRenders(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent) || ts.isImportTypeNode(parent)) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(parent.operatorToken.kind)) return true;
  // Up through the expressions that pass a literal on (a ternary, a template, parentheses, ??, ||, an array) to what takes it.
  let at: ts.Node = node;
  for (let up: ts.Node | undefined = parent; up; at = up, up = up.parent) {
    if ((ts.isCallExpression(up) || ts.isNewExpression(up)) && up.arguments?.some((argument) => argument === at)) {
      const name = calleeName(up);
      return name !== null && LOOKUP_CALLS.has(name);
    }
    if (ts.isJsxAttribute(up)) {
      const name = up.name.getText();
      return NAME_ATTRIBUTES.has(name) || name.startsWith("data-");
    }
    if (ts.isTemplateSpan(up) || ts.isTemplateExpression(up) || ts.isParenthesizedExpression(up) || ts.isConditionalExpression(up) || ts.isJsxExpression(up)
      || ts.isArrayLiteralExpression(up) || ts.isAsExpression(up) || ts.isSatisfiesExpression(up)
      || (ts.isBinaryExpression(up) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(up.operatorToken.kind))) continue;
    return false;
  }
  return false;
}

/** The text each rendered literal and JSX text of the file at `path` (or of `text`, read there) holds, with its line. */
function renderedTexts(path: string, text = readFileSync(path, "utf8")): { readonly line: number; readonly text: string }[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { line: number; text: string }[] = [];
  const add = (node: ts.Node, text: string) => out.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text });
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const value = node.text.replace(/\s+/g, " ").trim();
      if (value) add(node, value);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const literal = ts.isTemplateMiddle(node) || ts.isTemplateTail(node) ? node.parent.parent : ts.isTemplateHead(node) ? node.parent : node;
      const value = node.text;
      if (value.trim() && (/\bDERIVED\b/.test(value) || !CODE_SHAPED.test(value)) && !neverRenders(literal)) add(node, value);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Every retired word in rendered text under `app/`, less the allowed uses. */
function retiredWordHits(root = ROOT): Hit[] {
  return sources(root).flatMap((path) => {
    const file = relative(root, path);
    return renderedTexts(path).flatMap(({ line, text }) => RETIRED
      .filter(([word, pattern]) => pattern.test(text) && !ALLOWED.some((entry) => entry.file === file && entry.word === word))
      .map(([word]) => ({ file, line, word, text: text.length > 90 ? `${text.slice(0, 87)}...` : text })));
  });
}

test("no retired word of words.md section 3 renders anywhere in the app", () => {
  const hits = retiredWordHits();
  const report = hits.map((hit) => `${hit.file}:${hit.line}: "${hit.word}" in ${JSON.stringify(hit.text)}`);
  expect(report, `retired words on screen:\n${report.join("\n")}`).toEqual([]);
});

test("the scan reads the app and finds what it must: rendered text yes, keys, codes and lookups no", () => {
  expect(sources(ROOT).length).toBeGreaterThan(100);
  const sample = join(ROOT, "lib", "retired-words.sample.tsx");
  const lines = [
    "// SPDX-License-Identifier: MIT",
    'import { x } from "./plan";',
    'const TABLE = { "plan.write": "Plan", mode: "MODE_A" };',
    'const shown = <p className="plan-card" data-mode="IDLE">The mode is {words("mode", code)}</p>;',
    'const title = `${count} waypoints ahead`;',
    'const key = TABLE["planner"];',
    'if (state === "Held by a study") skip();',
    'const badge = <span title="DERIVED band">x</span>;',
    'const fine = "Soil moisture targets for the south zone, and the target range";',
  ];
  const texts = renderedTexts(sample, lines.join("\n"));
  expect(texts.map((entry) => [entry.line, entry.text])).toEqual([
    [3, "Plan"], [4, "The mode is"], [5, " waypoints ahead"], [8, "DERIVED band"], [8, "x"], [9, "Soil moisture targets for the south zone, and the target range"],
  ]);
  const words = texts.flatMap(({ text }) => RETIRED.filter(([, pattern]) => pattern.test(text)).map(([word]) => word));
  expect(words).toEqual(["plan", "mode", "waypoint", "DERIVED"]);
});
