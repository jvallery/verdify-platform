// SPDX-License-Identifier: MIT
import { Link } from "react-router";
import type { DailyRecord, Equipment, LawView, RecordDay } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { words } from "../../lib/words";
import { StatusBadge } from "../badge";
import { Panel, type PanelState } from "../panel";
import { CLIMATE_RELAYS, WHY_STATUS_TONE, WHY_STATUS_WORDS, holdWords, relayWhy, type RelayWhy } from "./relay-why";
import { SinceWords, StateWord, runTime, startsWords, type EquipmentItem } from "./relay-state";

/** Today's row of the daily record (API-32): the one day not yet complete; null when the record has none. */
/** The sentence already opens with the status word ("Asked for by …", "Not needed. …"): the badge would say it twice. */
const sayItTwice = (why: RelayWhy) => why.text.toLowerCase().startsWith(WHY_STATUS_WORDS[why.status].toLowerCase());

export function todayRecord(record: DailyRecord | null | undefined): RecordDay | null {
  return [...(record?.days ?? [])].reverse().find((day) => !day.complete) ?? null;
}

/**
 * Run time and starts today, from today's daily record row, labelled "so far" because the day is still running. While
 * the record read fails or has no row for today the words say so; a relay the row omits reads "—", never 0.
 */
export function todayWords(equipment: string, record: PanelRead<DailyRecord>): string {
  if (record.failed && !record.data) return "today: the daily record is not available";
  if (!record.data) return "today: —";
  const day = todayRecord(record.data);
  if (!day) return "today: no record yet";
  const relay = day.relays?.[equipment];
  return `today so far: ${runTime(relay?.run_s)} on, ${startsWords(relay?.starts)}`;
}

/** The law read as a row sees it: still loading, failed (never its old answer), or its newest answer. */
export type LawRead = { readonly status: "pending" | "failed" | "ready"; readonly law: LawView | null };
export function lawRead(law: PanelRead<LawView>): LawRead {
  if (law.failed) return { status: "failed", law: null };
  return law.data ? { status: "ready", law: law.data } : { status: "pending", law: null };
}
/** Why, from the law read: its words once it answers, else what the page knows. */
export function whyOf(equipment: string, state: string, read: LawRead, block: string | null): RelayWhy {
  if (read.status === "ready") return relayWhy(equipment, state, read.law, block);
  const hold = equipment === "fog" ? holdWords("fog_block_reason", block) : null;
  return { status: "unknown", text: read.status === "failed" ? "The law could not be read, so why is not known." : "Reading the law.", rule: null, hold };
}

/** The label API-13 serves, or the words table's name for a relay it omitted. */
const nameOf = (equipment: string, item: EquipmentItem | null) => item?.label ?? words("equipment", equipment);

function ClimateRelayRow({ equipment, item, law, block, record }: { equipment: string; item: EquipmentItem | null; law: LawRead; block: string | null; record: PanelRead<DailyRecord> }) {
  const state = item?.state ?? "unknown";
  const name = nameOf(equipment, item);
  const why = whyOf(equipment, state, law, block);
  return <li className="sys-relay" data-equipment={equipment} data-state={state}>
    <div className="sys-relay-head">
      <span className="sys-relay-name">{name}</span>
      <StateWord equipment={equipment} state={state} />
    </div>
    <p className="sys-relay-facts">{item ? <SinceWords item={item} /> : "not in the equipment report"} · {todayWords(equipment, record)}</p>
    <p className="sys-relay-why" data-why={why.status}>
      {!sayItTwice(why) && <><StatusBadge size="sm" status={WHY_STATUS_TONE[why.status]}>{WHY_STATUS_WORDS[why.status]}</StatusBadge>{" "}</>}
      <span>{why.text}</span>{why.hold && <> <span className="sys-relay-hold">{why.hold}</span></>}{" "}
      <Link className="sys-relay-link" to="/climate">Climate law<span className="screen-reader">: the rules behind {name}</span><span aria-hidden="true"> ›</span></Link>
    </p>
  </li>;
}

export type ClimateRelaysProps = {
  equipment: PanelRead<Equipment>;
  law: PanelRead<LawView>;
  record: PanelRead<DailyRecord>;
  /** The page's state of the equipment read: loading, error, ready, or stale while the controller is not reporting. */
  state: PanelState;
  since?: string | null;
};

/**
 * Climate relays (screens section 10.1, row 1): heat 1, heat 2, fan 1, fan 2, the vent and fog, each with its state and
 * since from API-13, run time and starts so far today from API-32, and why in the law's words from API-30, linking to
 * Climate. Fog's hold is API-13's `fog_block_reason`. The law's own read failing leaves the states and says why is not known.
 */
export function ClimateRelays({ equipment, law, record, state, since }: ClimateRelaysProps) {
  const items = new Map((equipment.data?.items ?? []).map((item) => [item.equipment, item]));
  // A failed law read is never its old answer: the rows say why is not known.
  const lawNow = lawRead(law);
  const block = equipment.data?.fog_block_reason?.code ?? null;
  const observed = (equipment.data?.items ?? []).filter((item) => item.group === "climate").map((item) => item.observed_at).filter(Boolean).sort().at(-1) ?? null;
  return <Panel id="climate-relays" title="Climate relays" thing="the climate relays" state={state} since={since} reserve="lg" observedAt={observed} onRetry={equipment.retry}
    link={{ to: "/climate", label: "Climate law" }}
    foot={law.failed ? "The law could not be read, so why each relay is on or off is not shown." : "Why is the law's own account: the rule that drives each relay and what it is waiting for."}>
    <ul className="sys-relays">
      {CLIMATE_RELAYS.map((key) => <ClimateRelayRow key={key} equipment={key} item={items.get(key) ?? null} law={lawNow} block={key === "fog" ? block : null} record={record} />)}
    </ul>
  </Panel>;
}
