// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import type { BadgeStatus } from "../badge";

/** Whether a condition holds: met, unmet, or unknown (no answer, never read as unmet). */
export type CheckMark = "met" | "unmet" | "unknown";

export type ChecklistItem = {
  readonly key?: string;
  readonly mark: CheckMark;
  /** The condition as a plain sentence: "The air is drier than the band's high edge." */
  readonly statement: ReactNode;
  /** Its evidence or why it is unknown: "VPD 1.42 kPa against 1.30 kPa, 06:42." */
  readonly detail?: ReactNode;
  /** The row's status colour (design system v2 §2.2); by default met is ok, unmet warn and unknown neutral. */
  readonly tone?: BadgeStatus;
};

/** The words a screen reader hears before each statement, since the mark is a picture. */
export const MARK_WORDS: Readonly<Record<CheckMark, string>> = { met: "Met:", unmet: "Not met:", unknown: "Unknown:" };
const DEFAULT_TONE: Readonly<Record<CheckMark, BadgeStatus>> = { met: "ok", unmet: "warn", unknown: "neutral" };

function MarkIcon({ mark }: { mark: CheckMark }) {
  const path = mark === "met" ? "M5 12.5l4.5 4.5L19 7.5" : mark === "unmet" ? "M7 7l10 10M17 7L7 17" : "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.5";
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={path} /></svg>;
}

/**
 * Checklist (design system v2 §4): rows of a met, unmet or unknown mark, a statement and a detail, for the drying
 * decision and for running alone. The mark is never the only cue: each row says "Met:", "Not met:" or "Unknown:" to a
 * screen reader, and the statement says the condition in words.
 */
export function Checklist({ items, label, className }: { items: readonly ChecklistItem[]; label?: string; className?: string }) {
  return <ul className={className ? `checklist ${className}` : "checklist"} aria-label={label}>
    {items.map((item, index) => <li key={item.key ?? index} className={`checklist-row checklist-${item.tone ?? DEFAULT_TONE[item.mark]}`} data-mark={item.mark}>
      <span className="checklist-mark"><MarkIcon mark={item.mark} /></span>
      <p className="checklist-statement"><span className="screen-reader">{MARK_WORDS[item.mark]} </span>{item.statement}</p>
      {item.detail && <p className="checklist-detail">{item.detail}</p>}
    </li>)}
  </ul>;
}
