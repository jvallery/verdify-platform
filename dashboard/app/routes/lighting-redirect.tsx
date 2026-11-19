// SPDX-License-Identifier: MIT
import { replace } from "react-router";
import { movedHref } from "../lib/redirects";

/**
 * The lighting graph's old path (README section 3.1): it answers a redirect to Lights → History with the same query,
 * from the server for a page load and in the browser for an in-app link, replacing the history entry, so Back never
 * lands on it again.
 */
export function loader({ request }: { request: Request }) {
  return replace(movedHref("/lights/history", request.url));
}
// Its own function, never `= loader`, and the href from a module rather than this one: the client build strips `loader`
// and splits `clientLoader` into a chunk of its own, where a name from this file would be undefined (`routes.test.ts`).
export function clientLoader({ request }: { request: Request }) {
  return replace(movedHref("/lights/history", request.url));
}

/** Never shown: both loaders redirect. */
export default function LightingRedirect() {
  return null;
}
