// SPDX-License-Identifier: MIT
import { Link, useLocation } from "react-router";
import { sectionFor, type Section } from "../lib/sections";
import type { AlertSeverity } from "../lib/shell";

export { RolePill, SignOutForm } from "./account-menu";

/**
 * The V of the lockup: the `verdify-v-glyph` group of site/quartz/static/brand/verdify-wordmark.svg (leaf, ink stroke
 * and mint dot), without its style and text, coloured by `.brand-leaf`, `.brand-mark` and `.brand-dot`. Never animated.
 */
export function BrandGlyph() {
  return <svg className="brand-glyph" viewBox="30 22 100 127" aria-hidden="true" focusable="false">
    <g transform="translate(-10.500,4.200) scale(0.300000,0.400000)">
      <path className="brand-leaf" d="M410 98 C416 99 419 106 415 114 L301 318 C291 334 276 339 261 336 C252 334 246 328 244 320 C279 262 337 172 396 106 C400 101 405 97 410 98Z" />
      <path className="brand-mark" d="M160 196 C172 194 181 199 187 209 L264 322 C270 328 278 332 292 325 C286 337 276 347 263 352 C245 360 225 351 212 338 L142 237 C135 227 139 213 147 205 C152 200 156 197 160 196Z" />
      <circle className="brand-dot" cx="444.0" cy="68.0" r="21.0" />
    </g>
  </svg>;
}

/**
 * The lockup: the glyph is the V, so "erdify" follows it with no gap (on its baseline, kerned as the wordmark sets it),
 * then " · DASHBOARD". `reloadDocument` makes it a full page load, for the pages outside the shell.
 */
export function Brand({ reloadDocument = false, className }: { reloadDocument?: boolean; className?: string }) {
  return <Link className={className ? `brand ${className}` : "brand"} to="/" reloadDocument={reloadDocument} aria-label="Verdify dashboard, home">
    <span className="brand-word"><BrandGlyph /><span>erdify<small> · Dashboard</small></span></span>
  </Link>;
}

/**
 * The one open-alert count after Activity in the rail and on Alerts in the phone bar: API-02 `alerts.open` as a pill
 * coloured by the worst open severity. Nothing until API-02 answers, and nothing while the API is down, when the last
 * count is old news. Zero draws no pill, so the quiet state is quiet; a screen reader still hears "0 open alerts", and
 * "N open alerts" otherwise.
 */
export function CountPill({ count, severity }: { count: number | null; severity: AlertSeverity | null }) {
  if (count === null) return null;
  return <>{" "}{count > 0 ? <span className="nav-count" data-severity={severity ?? "info"}>{count}</span> : <span className="screen-reader">{count}</span>}<span className="screen-reader"> open alerts</span></>;
}

/** The section the page is in, from the path (an old path's section while it redirects). */
export function useCurrentSection(): Section | null {
  return sectionFor(useLocation().pathname);
}

/**
 * The header of the sign-in and error pages: the lockup alone, with no navigation and no tools. Its link is a full page
 * load: the root's data (a sign-in refusal) never revalidates on a client navigation, so a client navigation from a
 * refusal card would draw the same card at /, and the BFF must see the request to start a sign-in.
 */
export function PlainHeader() {
  return <header className="plain-header"><Brand reloadDocument /></header>;
}
