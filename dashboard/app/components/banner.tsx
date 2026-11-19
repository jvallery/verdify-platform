// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { Link } from "react-router";

/** A banner's status (design system v2 §2.2): `fault` is the critical status, kept by its first name. */
export type BannerTone = "fault" | "critical" | "serious" | "warn" | "info" | "ok";

/** The status icon: a triangle for a fault or a warning, a circle with "i" for information, a check for ok. */
export function StatusIcon({ tone, className }: { tone: BannerTone; className?: string }) {
  const path = tone === "ok" ? "M5 12.5l4.5 4.5L19 7.5"
    : tone === "info" ? "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5"
    : "M12 3.5L2.5 20h19L12 3.5zM12 10v4.5M12 17.5v.5";
  return <svg className={className} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d={path} /></svg>;
}

/**
 * One line under the header (design system v2 §4): a status soft background, its icon, one sentence and one action,
 * linking to the page that explains it (screens §1.2). The shell decides which banner shows; this only draws one.
 */
export function Banner({ tone, children, link }: { tone: BannerTone; children: ReactNode; link?: { to: string; label: ReactNode } }) {
  return <p className={`notice notice-${tone} banner`} data-banner={tone}>
    <StatusIcon tone={tone} className="banner-icon" />
    <span>{children}</span>
    {link && <> <Link to={link.to}>{link.label}<span aria-hidden="true"> ›</span></Link></>}
  </p>;
}
