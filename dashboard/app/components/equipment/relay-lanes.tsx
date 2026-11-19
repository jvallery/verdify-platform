// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { StateLanesChart, spansFromIntervals, type StateLaneGroup, type StateLaneRow } from "../../charts/state-lanes";
import { epochOf } from "../../charts/time-axis";
import type { XRange } from "../../charts/types";
import { RANGES, RangeChips, type RangeId } from "../../charts/range-chips";
import type { StateLanes } from "../../lib/operator-api";
import { panelRead, useStatesWindowRead } from "../../lib/queries";
import { words } from "../../lib/words";
import { Panel } from "../panel";
import { equipmentToken } from "./relay-state";

export const LANE_RANGES = ["24h", "72h"] as const satisfies readonly RangeId[];
/** `?range=`: 72h, else the default 24h. */
export const lanesRange = (value: string | null): (typeof LANE_RANGES)[number] => (value === "72h" ? "72h" : "24h");

export const LANE_GROUPS: readonly StateLaneGroup[] = [
  { key: "climate", label: "Climate" },
  { key: "water", label: "Water" },
  { key: "light", label: "Lights" },
  { key: "flag", label: "Flags" },
];
const GROUP_ORDER = LANE_GROUPS.map((group) => group.key);

/**
 * API-05's lanes as state-lane rows: one row per relay in its group, in the API's order within a group, coloured by
 * the equipment's token, with the API's own unknown spans hatched (never drawn as off). A light's controller-intent
 * lane is not a relay and is left out; the flags follow the relays; a group the lanes do not list sorts last.
 */
export function laneRows(data: StateLanes, range: XRange): StateLaneRow[] {
  return data.lanes
    .filter((lane) => !lane.equipment.endsWith("_intent"))
    .map((lane) => ({
      key: lane.equipment,
      label: lane.label || words("equipment", lane.equipment),
      token: `--${equipmentToken(lane.equipment) ?? "text-3"}`,
      group: lane.group,
      spans: spansFromIntervals(lane.intervals, range, (interval) => (interval.state === "unknown" ? "not reported" : undefined)),
    }))
    .sort((a, b) => rank(a.group) - rank(b.group));
}
const rank = (group: string | undefined) => {
  const index = GROUP_ORDER.indexOf(group ?? "");
  return index < 0 ? GROUP_ORDER.length : index;
};

/**
 * Last 24 h or 72 h (screens section 10.1, row 6): every relay's on and off spans from API-05 as state lanes, the range in
 * the URL (`?range=`), read every 60 s on a window that ends at the server's now.
 */
export function RelayLanes() {
  const [params] = useSearchParams();
  const range = RANGES.find((item) => item.id === lanesRange(params.get("range")))!;
  const read = panelRead(useStatesWindowRead(range.seconds));
  const href = (id: RangeId) => {
    const next = new URLSearchParams(params);
    next.set("range", id);
    return `?${next.toString()}`;
  };
  const data = read.failed ? null : read.data;
  const from = epochOf(data?.from), to = epochOf(data?.to);
  const rows = useMemo(() => (data && from !== null && to !== null ? laneRows(data, { from, to }) : null), [data, from, to]);
  // An answer with no window to draw is as unusable as a failed read.
  const state = read.failed || (data && (from === null || to === null)) ? "error" : read.pending ? "loading" : rows && rows.length === 0 ? "empty" : "ready";
  return <Panel id="relay-lanes" title={`Last ${range.label}`} thing="the relay lanes" state={state} reserve="lg" observedAt={data?.to} onRetry={read.retry}
    actions={<RangeChips only={LANE_RANGES} current={range.id} href={href} />}
    empty={<p className="meta">No relay reported in this window.</p>}>
    {rows && from !== null && to !== null && <StateLanesChart title={`Relays, last ${range.label}`} rows={rows} groups={LANE_GROUPS} range={{ from, to }} now={to}
      syncKey={`verdify:equipment:${range.id}`} />}
  </Panel>;
}
