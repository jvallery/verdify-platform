// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import type { ViewId } from "../../lib/sections";
import { cls } from "../common";
import { PageHeader } from "./page-header";

/**
 * Page (design-system section 3): every screen's outer stack, its page header, then its blocks. The page width is the
 * content column's (`--content`) on every route, so switching views never moves the page's edges.
 */
export function Page({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cls("page", className)}>{children}</div>;
}

/**
 * The `.l-scroll-x` region: a labelled, focusable horizontal scroll area for a wide table, the week matrix or a long
 * strip, so the page itself never scrolls sideways.
 */
export function ScrollRegion({ label, children, className }: { label: string; children?: ReactNode; className?: string }) {
  return <div className={cls("l-scroll-x", className)} role="region" tabIndex={0} aria-label={label}>{children}</div>;
}

/** The one paragraph a page that has not shipped yet shows under its header. */
export const ARRIVING_TEXT = "This page arrives with the v2 release of the dashboard.";

/**
 * A v2 page whose body has not shipped: its frame (breadcrumb, title, purpose, tabs) and one paragraph, so every path
 * answers and every navigation link works. `header` false leaves the header to a layout that draws it (Water's).
 */
export function ArrivingPage({ view, header = true }: { view: ViewId; header?: boolean }) {
  return <Page className="page-arriving">
    {header && <PageHeader view={view} />}
    <p className="page-arriving-text">{ARRIVING_TEXT}</p>
  </Page>;
}
