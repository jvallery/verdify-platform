// SPDX-License-Identifier: MIT
/** A thin space and the chevron: "Climate law ›". */
export const CHEVRON = "\u2009›";

/**
 * The link chevron (A9): one thin space and "›" after a link's words, hidden from a screen reader, which hears the
 * link's words alone. Every "X ›" link renders it: the panel head's link, a section's link and an inline link.
 */
export function Chevron() {
  return <span className="chev" aria-hidden="true">{CHEVRON}</span>;
}
