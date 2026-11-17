// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";

/**
 * Text marks: AI and NO READBACK sit after a value or a name in muted mono, never as pills, so a row carries at most one
 * state badge. Each keeps its `data-badge` hook.
 */
export type MarkKind = "ai" | "no_readback";
const MARK_WORDS: Readonly<Record<MarkKind, string>> = { ai: "AI", no_readback: "No readback" };

/** A text mark: "AI", "NO READBACK" in muted mono (the stylesheet uppercases it). */
export function Mark({ kind, children, title }: { kind: MarkKind; children?: ReactNode; title?: string }) {
  return <span className="ctl-mark" data-badge={kind} title={title}>{children ?? MARK_WORDS[kind]}</span>;
}
