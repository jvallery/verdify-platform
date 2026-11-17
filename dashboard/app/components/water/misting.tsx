// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import type { Equipment, LawView } from "../../lib/operator-api";
import { panelRead, useEquipmentRead, useLawRead } from "../../lib/queries";
import { ZONE_ORDER_TEXT, mistingRows, mistingState, type MistingRow } from "../../lib/water";
import { StatusBadge } from "../badge";
import { LocalTime } from "../common";
import { Details } from "../details";
import { Panel, type PanelState } from "../panel";

/** The rules' names as the Misting block heads them. */
const ROW_TITLE: Readonly<Record<MistingRow["id"], string>> = { mist: "Misters", fog: "Fog" };

/** One rule's answer: its state badge, the reason in VPD against its line, and the hold in force with its start. */
function MistingItem({ row }: { row: MistingRow }) {
  const state = mistingState(row);
  return <li className="wat-mist-row" data-rule={row.id} data-wanted={row.wanted === null ? "unknown" : String(row.wanted)}>
    <p className="wat-mist-head"><strong>{ROW_TITLE[row.id]}</strong> <StatusBadge status={state.tone} size="sm">{state.text}</StatusBadge></p>
    <p className="wat-mist-why">{row.why}</p>
    {row.hold && <p className="wat-mist-hold" data-hold="">Held: {row.hold.text}{row.hold.since && <span className="meta"> · since <LocalTime at={row.hold.since} /></span>}</p>}
  </li>;
}

/** The panel's state from its two reads: the law decides; a law that stopped reporting shows its last record as STALE. */
export function mistingPanelState(law: { data: LawView | null; failed: boolean; pending: boolean }, equipment: { data: Equipment | null; pending: boolean }): PanelState {
  if (law.data === null) return law.failed ? "error" : "loading";
  if (equipment.data === null && equipment.pending) return "loading";
  return law.data.reporting ? "ready" : "stale";
}

/**
 * Misting (screens section 3.1, parity W-30): why the misters and the fog are or are not running. For each, whether the
 * law wants it (VPD against its line, API-30 rules mist and fog), then the hold in force in words from the controller's
 * block reasons (API-13 `moisture_block_reason`, `fog_block_reason`). The zone order the controller uses sits collapsed
 * below. A law that stopped reporting shows its last record STALE with its age; a failed read says so with Retry.
 */
export function MistingPanel() {
  const law = panelRead(useLawRead());
  const equipment = panelRead(useEquipmentRead());
  const rows = useMemo(() => mistingRows(law.data, { moisture: equipment.data?.moisture_block_reason, fog: equipment.data?.fog_block_reason }), [law.data, equipment.data]);
  const state = mistingPanelState(law, equipment);
  return <Panel title="Misting" thing="why the misters run" state={state} reserve="sm" observedAt={law.data?.observed_at ?? null}
    onRetry={() => { law.retry(); equipment.retry(); }} link={{ to: "/climate", label: "Climate law" }}
    foot={equipment.data === null && !equipment.pending ? "What holds the misters could not be read." : undefined}>
    <ul className="wat-mist-list">{rows.map((row) => <MistingItem key={row.id} row={row} />)}</ul>
    <Details summary="How the controller picks a zone"><p>{ZONE_ORDER_TEXT}</p><p>A zone takes part only while its mister is on and its VPD control is on. The soft daily budget and the daily mist and fog limit count every zone together.</p></Details>
  </Panel>;
}
