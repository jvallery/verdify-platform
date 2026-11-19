// SPDX-License-Identifier: MIT
/**
 * What the browser suite walks (#1128). `app/routes.test.ts` fails when `app/routes.ts` gains a path `ROUTES` lacks, so
 * a new screen cannot skip axe: an issue that adds a route adds its path here in the same PR.
 */
export const ROUTES = [
  "/", "/climate", "/band", "/climate/drying", "/water", "/water/schedules", "/water/history", "/water/soil", "/lights", "/lights/history",
  "/crops", "/crops/history", "/hydroponics", "/record", "/record/compliance", "/record/equipment", "/record/utilities", "/graphs",
  "/graphs/zones", "/review", "/activity", "/activity/log", "/equipment", "/system/controller", "/system/data", "/settings",
] as const;
export type RoutePath = (typeof ROUTES)[number];

/**
 * The paths app/routes.ts keeps only to redirect (dashboard v2 README section 3.1): each answers a redirect to `to`
 * with its query, so the suites walk `to` among ROUTES rather than the same page twice. layout.spec.ts checks each lands
 * where it says.
 */
export const REDIRECTS = [
  { path: "/plan", to: "/review" }, { path: "/planner", to: "/review" }, { path: "/planner/history", to: "/review" },
  { path: "/graphs/statistics", to: "/record" }, { path: "/graphs/scorecard", to: "/record" }, { path: "/graphs/lighting", to: "/lights/history" },
] as const;

/**
 * The SCR-09 cards the root renders, with no nav, role pill or banner. Each has its status and its one heading. Sign-in
 * is unavailable because `playwright.config.ts` points OIDC_ISSUER at a closed port, and the callback fails because the
 * ingress adds no cookie under `/auth/`, so there is no login cookie to open.
 */
export const CARD_PAGES = [
  { path: "/no-such-page", status: 404, heading: "Page not found" },
  { path: "/auth/callback?code=x&state=y", status: 400, heading: "Sign-in didn't complete" },
  { path: "/auth/login", status: 503, heading: "Sign-in is unavailable" },
] as const;

/**
 * The setting drawer with its chart drawn (#1139): the history with Revert. Dashboard v2's drawer draws the history only;
 * the band's preview lives on the Band page.
 */
export const SETTING_DRAWERS = [
  { path: "/settings?q=outdoor_staleness_max_s&edit=outdoor_staleness_max_s", fixture: "setting-history", charts: 1 },
] as const;

/**
 * The routes that hold a write control for an operator under the roles fixtures (`alerts-merged`, `l01-running`,
 * `mister-fault`), so a viewer's "no write control" means something there. Every route also has the top bar's Stop all
 * water for an operator above 860 px. The other routes write nothing of their own: Climate law, Record, Graphs, Review,
 * Data and the Activity log by design, and Crops because its writes (Plant…, Move…, Harvest…, Remove…, Edit…, Save
 * note) follow a selection or open from a planting's drawer; crops.spec.ts covers them, and the viewer check here still
 * finds none. Controller's Restart sits in a closed disclosure.
 */
export const WRITE_ROUTES: readonly RoutePath[] = [
  "/", "/band", "/climate/drying", "/water", "/water/schedules", "/water/history", "/water/soil", "/lights", "/activity", "/equipment",
  "/system/controller", "/settings",
];
