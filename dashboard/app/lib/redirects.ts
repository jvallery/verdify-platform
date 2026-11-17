// SPDX-License-Identifier: MIT
/**
 * The old paths of README section 3.1 (`MOVED`, from the sections' aliases in lib/sections.ts) answer a redirect that
 * keeps the query string: a 302 from the route module's loader on a page load, and a client redirect on an in-app
 * navigation (`replace`, so Back never lands on the old path).
 */
export { MOVED } from "./sections";

/** `to` with the query of the request at `url`. */
export function movedHref(to: string, url: string): string {
  return `${to}${new URL(url).search}`;
}
