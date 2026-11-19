// SPDX-License-Identifier: MIT
import { replace } from "react-router";
import { movedHref } from "../lib/redirects";

/**
 * The old statistics paths (README section 3.1): /graphs/statistics and /graphs/scorecard each answer a redirect to
 * Record → Days with the same query, from the server for a page load and in the browser for an in-app link, replacing
 * the history entry, so Back never lands on them again.
 */
export function loader({ request }: { request: Request }) {
  return replace(movedHref("/record", request.url));
}
// Its own function, never `= loader`, and the href from a module rather than this one: the client build strips `loader`
// and splits `clientLoader` into a chunk of its own, where a name from this file would be undefined (`routes.test.ts`).
export function clientLoader({ request }: { request: Request }) {
  return replace(movedHref("/record", request.url));
}

/** Never shown: both loaders redirect. */
export default function RecordRedirect() {
  return null;
}
