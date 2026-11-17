// SPDX-License-Identifier: MIT
// The old paths of README section 3.1: each route module that serves one answers a 302 to its new view with the query
// kept, from the server loader and the client loader alike, and MOVED (from the sections' aliases) agrees with them.
import { expect, test } from "vitest";
import { REDIRECTS } from "../../e2e/routes";
import * as scorecard from "../routes/graphs-scorecard";
import * as lighting from "../routes/lighting-redirect";
import * as planner from "../routes/planner-redirect";
import { MOVED, movedHref } from "./redirects";

const MODULES: Record<string, { loader: (args: { request: Request }) => unknown; clientLoader: (args: { request: Request }) => unknown }> = {
  "/plan": planner, "/planner": planner, "/planner/history": planner,
  "/graphs/statistics": scorecard, "/graphs/scorecard": scorecard, "/graphs/lighting": lighting,
};

test("MOVED is REDIRECTS: six old paths, each to a v2 view", () => {
  expect(MOVED).toEqual(Object.fromEntries(REDIRECTS.map(({ path, to }) => [path, to])));
});

test("movedHref keeps the query and drops nothing else of the new path", () => {
  expect(movedHref("/review", "https://dashboard.verdify.ai/planner/history?day=2026-11-02&x=1")).toBe("/review?day=2026-11-02&x=1");
  expect(movedHref("/record", "https://dashboard.verdify.ai/graphs/statistics")).toBe("/record");
});

test.each(REDIRECTS.map(({ path, to }) => [path, to]))("%s answers 302 to %s with its query, on the server and in the browser", (path, to) => {
  const module = MODULES[path];
  for (const load of [module.loader, module.clientLoader]) {
    const response = load({ request: new Request(`https://dashboard.verdify.ai${path}?range=7d&line=L01`) }) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${to}?range=7d&line=L01`);
    // `replace`, so Back never lands on the old path.
    expect(response.headers.get("X-Remix-Replace")).toBe("true");
  }
});
