// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { Link } from "react-router";

export type EmptyStateProps = {
  /** The plain sentence: "No runs today." */
  message: ReactNode;
  /** What would appear here, or why there is nothing. */
  detail?: ReactNode;
  /** A link that widens what is asked for ("Show the last 7 days"). */
  widen?: { to: string; label: ReactNode };
  /** At most one control instead of a link (a `Button`). */
  action?: ReactNode;
};

/**
 * A card's empty state (design system v2 §3): a plain sentence when there is nothing to show, what would appear here,
 * and at most one way on. It sits where the data would, on a quiet dashed inset, never as an error.
 */
export function EmptyState({ message, detail, widen, action }: EmptyStateProps) {
  return <div className="empty-state panel-empty">
    <p>{message}</p>
    {detail && <p className="muted">{detail}</p>}
    {widen && <p><Link to={widen.to}>{widen.label}</Link></p>}
    {action}
  </div>;
}
