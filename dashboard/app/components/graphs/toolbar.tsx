// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Segmented } from "../segmented";

/**
 * Graphs' toolbar (screens.md section 7, design-system section 4): the range as the v2 segmented control, ‹ and › to
 * step the window by its own length, Zoom out (×2, centred) and Custom… (the From and To days) as secondary buttons,
 * then the page's own tools (Preset, Layers, + Metric, + Setting). Every control is a link the caller builds, so each
 * pushes history and Back restores the previous view. At 860 px and below it is two rows at most: the range (a `wide`
 * range and Zoom out left out), then ‹ ›, Custom… and the tools, so the first plot is on the first screen.
 */
export type GraphRange = {
  readonly id: string; readonly label: string; readonly href: string; readonly current: boolean;
  /** Left out at 860 px and below, so a phone's range fits one row (90 d). */
  readonly wide?: boolean;
};

export type GraphToolbarProps = {
  ranges: readonly GraphRange[];
  /** Where ‹ and › go; null where the window cannot step (the far end of what the API keeps, or into the future). */
  previous?: string | null;
  next?: string | null;
  /** The window's length in words, for the step buttons' names: "Previous 24 h", "Next 24 h". */
  span: string;
  /** Where Zoom out goes; null at the longest window; undefined leaves it out. */
  zoomOut?: string | null;
  /** The Custom… form (From and To days), in a disclosure. */
  custom?: ReactNode;
  /** True while the custom form is the window in force, so its disclosure starts open. */
  customOpen?: boolean;
  children?: ReactNode;
};

function Step({ to, label, children }: { to: string | null | undefined; label: string; children: ReactNode }) {
  if (!to) return <span className="btn btn-sm gr-step" aria-disabled="true" title={`${label}: not available`}><span aria-hidden="true">{children}</span><span className="screen-reader">{label}: not available</span></span>;
  return <Link className="btn btn-sm gr-step" to={to} preventScrollReset aria-label={label}><span aria-hidden="true">{children}</span></Link>;
}

export function GraphToolbar({ ranges, previous, next, span, zoomOut, custom, customOpen = false, children }: GraphToolbarProps) {
  const current = ranges.find((range) => range.current)?.id ?? "";
  return <div className="gr-tb">
    <Segmented label="Range" size="sm" className="gr-ranges" value={current}
      segments={ranges.map((range) => ({ value: range.id, label: range.wide ? <span className="gr-wide-range">{range.label}</span> : range.label, to: range.href, keepScroll: true }))} />
    <div className="gr-tb-row">
      <div className="gr-steps">
        <Step to={previous} label={`Previous ${span}`}>‹</Step>
        <Step to={next} label={`Next ${span}`}>›</Step>
        {zoomOut !== undefined && (zoomOut
          ? <Link className="btn btn-sm gr-zoom" to={zoomOut} preventScrollReset>Zoom out</Link>
          : <span className="btn btn-sm gr-zoom" aria-disabled="true">Zoom out</span>)}
      </div>
      {custom && <details className="gr-custom" open={customOpen || undefined}><summary className="btn btn-sm">Custom…</summary><div className="gr-custom-body">{custom}</div></details>}
      {children && <div className="gr-tools">{children}</div>}
    </div>
  </div>;
}
