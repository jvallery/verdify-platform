// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { cls } from "../common";

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
