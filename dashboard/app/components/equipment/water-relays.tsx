// SPDX-License-Identifier: MIT
import { LINES } from "../../lib/lines";
import type { Equipment, IrrigationStatus } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { words } from "../../lib/words";
import { Panel, type PanelState } from "../panel";
import { holdWords } from "./relay-why";
import { SinceWords, StateWord, runTime, startsWords, type EquipmentItem } from "./relay-state";

/** A line's state on the water side when it says more than the relay does: paused, disabled, waiting or can't run now. */
const TELLING = new Set(["paused", "disabled", "waiting", "blocked"]);
/** "Paused", "Can't run now: someone inside"; null for an idle or running line, or while API-IRR-01 has no answer. */
export function lineNote(irrigation: IrrigationStatus | null | undefined, lineId: string): string | null {
  const line = irrigation?.lines.find((row) => row.line_id === lineId);
  if (!line || !TELLING.has(line.state.code)) return null;
  const head = words("line_state", line.state.code);
  return line.state.reason ? `${head}: ${line.state.reason}` : head;
}

function WaterRelayRow({ lineId, equipment, item, note }: { lineId: string; equipment: string; item: EquipmentItem | null; note: string | null }) {
  const state = item?.state ?? "unknown";
  return <li className="sys-relay sys-relay-water" data-equipment={equipment} data-state={state}>
    <div className="sys-relay-head">
      <span className="sys-relay-name"><span className="sys-line-id">{lineId}</span> {item?.label ?? words("equipment", equipment)}</span>
      <StateWord equipment={equipment} state={state} />
    </div>
    <p className="sys-relay-facts">
      {item ? <SinceWords item={item} /> : "not in the equipment report"} · today {runTime(item?.runtime_today_s)} on, {startsWords(item?.cycles_today)}
      {note && <> · <span className="sys-line-note">{note}</span></>}
    </p>
  </li>;
}

export type WaterRelaysProps = { equipment: PanelRead<Equipment>; irrigation: PanelRead<IrrigationStatus>; state: PanelState; since?: string | null };

/**
 * Water relays (screens section 10.1, row 2): the eleven lines L01 to L11 in line order, each with its state and since,
 * minutes and starts today from API-13, and what API-IRR-01 says of a paused, disabled or held line. What holds the
 * misters off is API-13's `moisture_block_reason`, in words. Runs and schedules live on Water.
 */
export function WaterRelays({ equipment, irrigation, state, since }: WaterRelaysProps) {
  const items = new Map((equipment.data?.items ?? []).map((item) => [item.equipment, item]));
  const hold = holdWords("moisture_block_reason", equipment.data?.moisture_block_reason?.code);
  const water = irrigation.failed ? null : irrigation.data;
  const observed = (equipment.data?.items ?? []).filter((item) => item.group === "water").map((item) => item.observed_at).filter(Boolean).sort().at(-1) ?? null;
  return <Panel id="water-relays" title="Water relays" thing="the water relays" state={state} since={since} reserve="lg" observedAt={observed} onRetry={equipment.retry}
    link={{ to: "/water", label: "Water today" }}
    foot={<>Minutes and starts are today's, as the relays report them.{hold && <> Misters: {hold}</>}</>}>
    <ul className="sys-relays sys-relays-water">
      {LINES.map((line) => <WaterRelayRow key={line.id} lineId={line.id} equipment={line.equipment} item={items.get(line.equipment) ?? null} note={lineNote(water, line.id)} />)}
    </ul>
    {irrigation.failed && <p className="meta sys-note">The water lines' own state could not be read; the relays above are current.</p>}
  </Panel>;
}
