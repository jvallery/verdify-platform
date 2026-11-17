// SPDX-License-Identifier: MIT
import { useState } from "react";
import { StateLanesChart } from "../../charts/state-lanes";
import { panelRead, useLawHistoryRead, useStatesWindowRead } from "../../lib/queries";
import { EmptyState, Panel, type PanelState } from "../panel";
import { Segmented } from "../segmented";
import { LANE_GROUPS, LAW_WINDOWS, askedRows, latchRows, ranRows, windowOf, windowRange, type LawWindowId } from "./history";

/** Law's three windows (screens §2.1 block 6). */
const WINDOWS = LAW_WINDOWS.filter((item) => item.id !== "31d");

/**
 * Block 6, Asked and ran (screens §2.1): state lanes of what the law asked for over what the relays did, over 24 h,
 * 72 h or 7 d, from API-31 and API-05 on one window; gaps in the record are hatched, and the latches wait behind the
 * "As reported" fold. Its link opens Graphs on the same window.
 */
export function AskedAndRanPanel() {
  const [chosen, setChosen] = useState<LawWindowId>("24h");
  const window = windowOf(chosen);
  const law = panelRead(useLawHistoryRead(window.seconds));
  const states = panelRead(useStatesWindowRead(window.seconds));
  const pending = law.pending || states.pending;
  const state: PanelState = pending ? "loading" : !law.data || !states.data ? "error" : law.failed || states.failed ? "stale" : law.data.lanes.length ? "ready" : "empty";
  const range = law.data ? windowRange(law.data) : null;
  const rows = law.data && states.data && range ? [...askedRows(law.data, range), ...ranRows(states.data, range), ...latchRows(law.data, range)] : [];
  return <Panel title="Asked and ran" thing="the law's history" state={state} reserve="lg" onRetry={() => { law.retry(); states.retry(); }}
    actions={<Segmented label="Window" size="sm" value={chosen} onChange={(value) => setChosen(value as LawWindowId)} segments={WINDOWS.map((item) => ({ value: item.id, label: item.label }))} />}
    link={{ to: `/graphs?range=${window.graphs}&preset=law`, label: "Graphs" }}
    empty={<EmptyState message={`The law has no record in the last ${window.label}.`} />}
    foot="A hatched span has no law record: the controller was not reporting then.">
    {range && <StateLanesChart title={`What the law asked for and what ran, last ${window.label}`} rows={rows} groups={LANE_GROUPS} range={range} now={range.to} syncKey="law-lanes" />}
  </Panel>;
}
