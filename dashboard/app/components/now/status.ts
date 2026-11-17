// SPDX-License-Identifier: MIT
/**
 * Now's shared phrases (dashboard v2 screens §1): occupancy in one short phrase, and the line names and states the water
 * card and the controller block read. Pure, so the tests check them without a page.
 */
import { duration, localDate, shortDateTime, shortTime } from "../../lib/format";
import { lineDisplayName } from "../../lib/lines";
import type { NowAnswer } from "../../lib/now-answer";
import type { IrrigationLine, IrrigationStatus } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";

const validTime = (value: string | null | undefined): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Rows 1 to 3 of the answer: the greenhouse data is out of reach, the ingestor is down or the controller is quiet. */
export const deviceUnknown = (answer: Pick<NowAnswer, "row">): boolean => answer.row >= 1 && answer.row <= 3;

/** "since 05:10" today, else with the date ("Oct 30, 05:10"). */
function clockOrDate(value: string, clock: number): string {
  return localDate(value) === localDate(new Date(clock).toISOString()) ? shortTime(value) : shortDateTime(value);
}

/**
 * The occupancy phrase from API-IRR-01 `occupancy`, the first that holds: the hold switched off; someone inside (Frigate
 * saw them N min ago); nobody seen (last person at HH:MM); unknown. While API-IRR-01 fails or has not answered it reads
 * "Occupancy unknown", and the water card says why. Unknown occupancy never holds mist (D-IRP-10).
 */
export function occupancyText(irrigation: PanelRead<IrrigationStatus>, clock: number): string {
  if (irrigation.failed || !irrigation.data) return "Occupancy unknown";
  const { occupied, seen_at: seenAt, hold_enabled: hold } = irrigation.data.occupancy;
  if (hold === false) return "Occupancy mist hold is off: misters may run";
  if (occupied === true) {
    const ago = validTime(seenAt) ? `, ${duration(Math.max(0, Math.floor((clock - Date.parse(seenAt)) / 1000)))} ago` : "";
    return `Someone inside: misters wait (Frigate${ago})`;
  }
  if (occupied === false) return `Nobody seen: misters may run${validTime(seenAt) ? ` (last person ${clockOrDate(seenAt, clock)})` : ""}`;
  return "Occupancy unknown: misters may run";
}

/**
 * The line states are not known: an enabled line reads unknown (the controller is not reporting) or, with the
 * irrigation firmware, `irr_state` is stale. Before that firmware no `irr_state` exists (a source never seen reads
 * stale), and the relay states stand alone (irrigation §9: `irr_state`'s age alone never makes a line unknown).
 */
export function lineStatesUnknown(status: Pick<IrrigationStatus, "engine" | "lines" | "freshness">): boolean {
  return status.lines.some((line) => line.enabled && line.state.code === "unknown") || (status.engine === true && status.freshness.stale);
}

/** A line's plain name ("Center mister"), never its relay code (#1341). */
export function lineName(line: Pick<IrrigationLine, "line_id" | "name">): string {
  return lineDisplayName(line);
}
