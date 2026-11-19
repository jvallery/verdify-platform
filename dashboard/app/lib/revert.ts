// SPDX-License-Identifier: MIT
/**
 * Revert on a setting's drawer (dashboard v2 screens §10.4): what one tap goes back to, worked out from API-12. Pure: the
 * write itself is the ordinary API-10 or API-11 through `useSettingWrite`, so registry bounds, snapping and attribution
 * all stay on the server, and there is no revert endpoint.
 *
 * The target is the desired row just before the newest one. `desired[]` is oldest first and starts with the row in force
 * at `from`, so a window that holds only the newest row may just be too short: read 90 days back once
 * (`needsLookback`), and with still no earlier row Revert releases, so the host sends the setting's own value again. A
 * setting with no desired row has nothing to revert.
 */
import { shownActor, type SignedIn } from "./activity";
import { monthDayClock } from "./format";
import type { DesiredSetting, SettingHistory } from "./operator-api";
import { keptValueText, type SettingShape } from "./setting-values";

export const REVERT_TO_DEFAULT = "Revert to default";

/** What Revert sends: API-10 `{value, manual, reason}`, or API-11 `?reason=`; `text` is the button, `reason` its prefill. */
export type RevertTarget =
  | { readonly kind: "value"; readonly value: number; readonly text: string; readonly reason: string }
  | { readonly kind: "release"; readonly text: string; readonly reason: string };

/** The window holds only the newest row: an earlier one may lie before it. */
export const needsLookback = (desired: readonly DesiredSetting[]): boolean => desired.length === 1;

/** The stored reason reads with plain spaces, though the button keeps its no-break space before the unit. */
const plain = (text: string): string => text.replaceAll(" ", " ");
const stamp = (who: string, at: string): string => `(${who}, ${monthDayClock(at)})`;

function toValue(value: number, shape: SettingShape, who: string, at: string): RevertTarget {
  const text = `Revert to ${keptValueText(value, shape)} ${stamp(who, at)}`;
  return { kind: "value", value, text, reason: plain(text) };
}
function toDefault(row: DesiredSetting | null, me: SignedIn): RevertTarget {
  return { kind: "release", text: REVERT_TO_DEFAULT, reason: row ? `${REVERT_TO_DEFAULT} ${stamp(shownActor(row.actor, me).name, row.created_at)}` : REVERT_TO_DEFAULT };
}

/**
 * What Revert does for this history, or null when it has nothing to go back to: no desired row at all (the button is
 * hidden), or a release with no value before it, where the setting already has its own value.
 */
export function revertTarget(history: Pick<SettingHistory, "desired">, shape: SettingShape, me: SignedIn): RevertTarget | null {
  const rows = history.desired;
  const newest = rows[rows.length - 1];
  if (!newest) return null;
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  if (previous && previous.value !== null) return toValue(previous.value, shape, shownActor(previous.actor, me).name, previous.created_at);
  if (newest.value === null) return null;
  return toDefault(previous, me);
}
