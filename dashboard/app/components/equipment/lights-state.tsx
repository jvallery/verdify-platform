// SPDX-License-Identifier: MIT
import type { Equipment } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { words } from "../../lib/words";
import { StatusBadge } from "../badge";
import { Panel, type PanelState } from "../panel";
import { SinceWords, StateWord, known, type EquipmentItem } from "./relay-state";

export const LIGHT_KEYS = ["grow_light_main", "grow_light_grow"] as const;

/** What the controller wants, in words: "the controller wants it on", or that it has not said. */
export function intentWords(intent: string | null | undefined): string {
  if (intent === "on" || intent === "off") return `the controller wants it ${intent}`;
  return "the controller has not said what it wants";
}
/** The switch and the controller disagree: both known and different. An unknown side never marks a difference. */
export const lightsDiffer = (intent: string | null | undefined, state: string | null | undefined): boolean => known(intent) && known(state) && intent !== state;

function LightRow({ equipment, item }: { equipment: string; item: EquipmentItem | null }) {
  const state = item?.state ?? "unknown";
  return <li className="sys-relay" data-equipment={equipment} data-state={state}>
    <div className="sys-relay-head">
      <span className="sys-relay-name">{item?.label ?? words("equipment", equipment)}</span>
      <StateWord equipment={equipment} state={state} />
    </div>
    <p className="sys-relay-facts">
      {item ? <SinceWords item={item} /> : "not in the equipment report"} · {intentWords(item?.intent)}
      {lightsDiffer(item?.intent, state) && <> <StatusBadge size="sm" status="warn">Differ</StatusBadge></>}
    </p>
  </li>;
}

/**
 * Lights (screens section 10.1, row 3): both circuits as state only, the switch's readback beside what the controller
 * wants, from API-13. The controls and the light window live on Lights.
 */
export function LightsState({ equipment, state, since }: { equipment: PanelRead<Equipment>; state: PanelState; since?: string | null }) {
  const items = new Map((equipment.data?.items ?? []).map((item) => [item.equipment, item]));
  return <Panel id="lights" title="Lights" thing="the lights" state={state} since={since} reserve="sm" onRetry={equipment.retry}
    link={{ to: "/lights", label: "Light controls" }}
    foot="The state is what the light switch reports; switch a light or change its window on Lights.">
    <ul className="sys-relays">
      {LIGHT_KEYS.map((key) => <LightRow key={key} equipment={key} item={items.get(key) ?? null} />)}
    </ul>
  </Panel>;
}
