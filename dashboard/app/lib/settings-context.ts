// SPDX-License-Identifier: MIT
import type { Setting } from "./operator-api";

/** Search the operator's question as well as the controller identifier. Values and actor names are deliberately
 * excluded: a changing readback must not make a search result appear and disappear during editing. */
export function matchesSettingSearch(row: Pick<Setting, "param" | "label"> & Partial<Pick<Setting, "help">>, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const help = row.help;
  const text = [row.param, row.param.replaceAll("_", " "), row.label,
    help?.summary, help?.effect, help?.raise, help?.lower, help?.caution].filter(Boolean).join(" ").toLocaleLowerCase();
  const tokens = text.split(/[^\p{L}\p{N}_]+/u);
  return words.every((word) => tokens.some((token) => token.startsWith(word)) || (word.length > 1 && row.param.toLocaleLowerCase().includes(word)));
}
