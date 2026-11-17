// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { useApiDown } from "../lib/session";
import type { EquipmentState, LineKind, ReadbackVia } from "../lib/vocab";
import { LocalTime, cls } from "./common";

/** The six statuses of design system v2 §2.2. A status means state and nothing else, and always carries its word. */
export type BadgeStatus = "ok" | "warn" | "serious" | "critical" | "info" | "neutral";
export const BADGE_STATUSES: readonly BadgeStatus[] = ["ok", "warn", "serious", "critical", "info", "neutral"];

/**
 * The badges (design system v2 §4): each a status of §2.2 drawn as its soft background, its text colour and a dot in its
 * solid, with its word, so colour is never the only cue. `ok` marks the green family, which turns neutral while the
 * dashboard API is down, so nothing green shows then. `dot` names another token for the dot (CLEAN and FERT show the
 * water and fertiliser colours on a neutral badge). A manual hold is `info`.
 */
export const BADGES = {
  requested: { status: "warn", text: "Requested" },
  confirmed: { status: "ok", text: "Confirmed" },
  not_confirmed: { status: "serious", text: "Not confirmed" },
  held: { status: "info", text: "Held" },
  no_readback: { status: "neutral", text: "No readback" },
  manual: { status: "info", text: "Manual" },
  ai: { status: "neutral", text: "AI" },
  planned: { status: "neutral", text: "Planned" },
  superseded: { status: "neutral", text: "Superseded" },
  stale: { status: "warn", text: "Stale" },
  clean: { status: "neutral", text: "Clean", dot: "clean" },
  fert: { status: "neutral", text: "Fert", dot: "fert" },
  running: { status: "ok", text: "Running" },
  idle: { status: "neutral", text: "Idle" },
  disabled: { status: "neutral", text: "Disabled" },
  on: { status: "ok", text: "On" },
  off: { status: "neutral", text: "Off" },
  unknown: { status: "neutral", text: "Not reported" },
} as const satisfies Record<string, { status: BadgeStatus; text: string; dot?: "clean" | "fert" }>;
export type BadgeKind = keyof typeof BADGES;
export type BadgeSize = "md" | "sm";

/** The classes of a badge of `status` (and of `size`), for a screen that draws one around its own words. */
export function badgeClass(status: BadgeStatus, size: BadgeSize = "md", extra?: string | false | null): string {
  return cls("badge", `badge-${status}`, size === "sm" && "badge-sm", extra) ?? "badge";
}

/** A status badge around any words: the dot in the status solid, then the words. */
export function StatusBadge({ status, children, size = "md", title, className }: { status: BadgeStatus; children: ReactNode; size?: BadgeSize; title?: string; className?: string }) {
  const apiDown = useApiDown();
  const shown = status === "ok" && apiDown ? "neutral" : status;
  return <span className={badgeClass(shown, size, className)} data-status={shown} title={title}><span className="badge-dot" aria-hidden="true" />{children}</span>;
}

export function Badge({ kind, children, title, size = "md" }: { kind: BadgeKind; children?: ReactNode; title?: string; size?: BadgeSize }) {
  const apiDown = useApiDown();
  const badge: { status: BadgeStatus; text: string; dot?: "clean" | "fert" } = BADGES[kind];
  const status = badge.status === "ok" && apiDown ? "neutral" : badge.status;
  return <span className={badgeClass(status, size, badge.dot && `badge-${badge.dot}`)} data-badge={kind} data-status={status} title={title}>
    <span className="badge-dot" aria-hidden="true" />{children ?? badge.text}
  </span>;
}

/** A code this build does not know, shown raw in a neutral badge. */
function RawBadge({ code }: { code: string }) {
  return <span className={badgeClass("neutral")} data-badge="raw" data-status="neutral"><span className="badge-dot" aria-hidden="true" />{code}</span>;
}

const READBACK_BADGES: Readonly<Record<string, BadgeKind>> = { requested: "requested", confirmed: "confirmed", not_confirmed: "not_confirmed", held: "held", no_readback: "no_readback" };
/**
 * A setting's or program item's `ReadbackState` (architecture §5.5). `overridden` is AI with "Iris changed this at
 * HH:MM" (the time of the plan that won, when known); `released` has no badge. HELD, the override and released follow
 * the state, because they say who or what applies; otherwise NO READBACK also shows when the API says the setting has
 * none (`readback_via: none`). A state this build does not know shows raw.
 */
export function ReadbackBadge({ state, readbackVia, overriddenAt }: { state: string; readbackVia?: ReadbackVia | (string & {}) | null; overriddenAt?: string | null }) {
  if (state === "released") return null;
  if (state === "overridden") return <><Badge kind="ai" /> <span className="state-note">Iris changed this{overriddenAt ? <> at <LocalTime at={overriddenAt} /></> : null}</span></>;
  if (state !== "held" && (readbackVia === "none" || state === "no_readback")) return <Badge kind="no_readback" />;
  const kind = Object.hasOwn(READBACK_BADGES, state) ? READBACK_BADGES[state] : undefined;
  return kind ? <Badge kind={kind} /> : <RawBadge code={state} />;
}

/** The chemistry of a line kind: the fertilizer lines and the fertilizer master valve (L03) are FERT. */
export function lineChemistry(kind: LineKind | (string & {})): "clean" | "fert" | null {
  if (kind === "fert_drip" || kind === "fert_mister" || kind === "master") return "fert";
  if (kind === "drip" || kind === "mister" || kind === "fog") return "clean";
  return null;
}
/** CLEAN or FERT: a neutral badge whose dot is `--eq-water` or `--eq-fert`. */
export function ChemistryBadge({ chemistry }: { chemistry: "clean" | "fert" | null | undefined }) {
  return chemistry ? <Badge kind={chemistry} /> : null;
}

/** An actuator's state as the API sends it: ON, OFF or UNKNOWN. Unknown comes only from the API, never from an age. */
const EQUIPMENT_STATES: readonly string[] = ["on", "off", "unknown"] satisfies EquipmentState[];
export function EquipmentStateBadge({ state }: { state: EquipmentState | (string & {}) }) {
  return EQUIPMENT_STATES.includes(state) ? <Badge kind={state as EquipmentState} /> : <RawBadge code={state} />;
}
