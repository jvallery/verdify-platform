// SPDX-License-Identifier: MIT

export type SkeletonSize = "sm" | "md" | "lg";

/**
 * A card's loading state (design system v2 §3): a block of its final height (sm 5rem, md 10rem, lg 20rem), or `lines`
 * text lines, with a quiet sweep that stops under reduced motion. It is hidden from assistive technology; "Loading
 * <label>" is said once in words instead.
 */
export function Skeleton({ size = "md", lines, label }: { size?: SkeletonSize; lines?: number; label: string }) {
  const block = lines && lines > 0
    ? <div aria-hidden="true">{Array.from({ length: lines }, (_, index) => <span key={index} className="skeleton skeleton-line" />)}</div>
    : <div className={`skeleton skeleton-${size}`} aria-hidden="true" />;
  return <>{block}<p className="screen-reader">Loading {label}</p></>;
}
