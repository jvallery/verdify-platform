// SPDX-License-Identifier: MIT
import { lineKindToken } from "../../charts/palette";
import { formatValue, localTime, sinceClock } from "../../lib/format";
import { lineByEquipment } from "../../lib/lines";
import type { Equipment } from "../../lib/operator-api";
import { useApiDown } from "../../lib/session";
import { cls } from "../common";
import { useNow } from "../freshness";

/** One API-13 item: a relay or a light, with the label the API serves (`EQUIPMENT_LABELS`). */
export type EquipmentItem = Equipment["items"][number];

/**
 * API-13 reads each relay's edges over this many days (`STATE_WINDOW` in verdify_services/reads.py, #1167): a known
 * state with a null `since` has not changed in that window, so its run began before it.
 */
export const SINCE_WINDOW_DAYS = 31;

export const known = (state: string | null | undefined): state is "on" | "off" => state === "on" || state === "off";

/** The equipment's own colour token without its dashes (design system section 2.3), for its On dot and its lane; null when not known. */
export function equipmentToken(equipment: string): string | null {
  if (["fan1", "fan2", "vent", "heat1", "heat2", "fog"].includes(equipment)) return `eq-${equipment}`;
  if (equipment === "grow_light_main") return "eq-light-main";
  if (equipment === "grow_light_grow") return "eq-light-grow";
  const line = lineByEquipment(equipment);
  return line ? lineKindToken(line.kind)?.replace(/^--/, "") ?? null : null;
}

/** "On", "Off", "Open", "Closed" (the vent) or "Not reported", exactly as API-13 sends the state. */
export function stateWord(equipment: string, state: string): string {
  const vent = equipment === "vent";
  if (state === "on") return vent ? "Open" : "On";
  if (state === "off") return vent ? "Closed" : "Off";
  return "Not reported";
}

/**
 * The state as a word with a dot: On's dot in the equipment's token, Off a quiet ring, Not reported a hatched dot and
 * muted words. While the dashboard API is down the dot is neutral. `data-state` keeps the state for tests and styles.
 */
export function StateWord({ equipment, state }: { equipment: string; state: string }) {
  const apiDown = useApiDown();
  const kind = known(state) ? state : "unknown";
  return <span className={cls("sys-state", `is-${kind}`, apiDown && "is-neutral")} data-state={kind}>
    <span className="sys-dot" data-token={kind === "on" ? equipmentToken(equipment) ?? undefined : undefined} aria-hidden="true" />{stateWord(equipment, state)}
  </span>;
}

/** When the current run began: "08:31" today, "Oct 27, 04:26" before, on the server's clock, the full time in `title`. */
export function Since({ at }: { at: string }) {
  const now = useNow();
  return <time dateTime={at} title={Number.isFinite(Date.parse(at)) ? localTime(at) : undefined}>{sinceClock(at, now)}</time>;
}

/** Since, or why there is none: a known state unchanged in API-13's window, or no report at all. */
export function SinceWords({ item }: { item: Pick<EquipmentItem, "since" | "state"> }) {
  if (item.since) return <>since <Since at={item.since} /></>;
  return <>{known(item.state) ? `unchanged in ${SINCE_WINDOW_DAYS} days` : "since —"}</>;
}

/** Run time in minutes ("2 h 10 min" from 120 min), or "—" when not known; never 0 for unknown. */
export const runTime = (seconds: number | null | undefined): string => (seconds === null || seconds === undefined ? "—" : formatValue(seconds / 60, "min"));
/** "1 start", "6 starts", or "— starts" when not known. */
export const startsWords = (starts: number | null | undefined): string => (starts === null || starts === undefined ? "— starts" : `${starts} ${starts === 1 ? "start" : "starts"}`);
