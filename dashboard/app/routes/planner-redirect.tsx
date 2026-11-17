// SPDX-License-Identifier: MIT
import { replace } from "react-router";
import { movedHref } from "../lib/redirects";

/**
 * The old daily-review paths (README section 3.1): /plan, /planner and /planner/history each answer a redirect to
 * Review with the same query, from the server for a page load and in the browser for an in-app link, replacing the
 * history entry, so Back never lands on them.
 */
export function loader({ request }: { request: Request }) {
  return replace(movedHref("/review", request.url));
}
// Its own function, never `= loader`, and the href from a module rather than this one: the client build strips `loader`
// and splits `clientLoader` into a chunk of its own, where a name from this file would be undefined (`routes.test.ts`).
export function clientLoader({ request }: { request: Request }) {
  return replace(movedHref("/review", request.url));
}

/** Never shown: both loaders redirect. */
export default function ReviewRedirect() {
  return null;
}
