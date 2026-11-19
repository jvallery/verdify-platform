// SPDX-License-Identifier: MIT
/**
 * Climate → Law's blocks (screens §2.1): the rule ladders with their rules, the drying decision, the band in force,
 * running alone and the timing and constants. Each is a `Panel` with the four states of design-system §3, fed by the
 * page's one API-30 read.
 */
import { duration, formatValue } from "../../lib/format";
import { lawSentence } from "../../lib/law-sentence";
import type { LawRule, LawView } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { useShellNow } from "../../lib/shell";
import { words } from "../../lib/words";
import { Badge, StatusBadge, type BadgeKind, type BadgeStatus } from "../badge";
import { Checklist } from "../data/checklist";
import { Details } from "../details";
import { useNow } from "../freshness";
import { Kv } from "../kv";
import { EmptyState, Panel, type PanelState } from "../panel";
import { Table, type TableColumn } from "../table";
import {
  aloneChecks, bandSourceSentence, capital, constantsWords, dryingChecks, dryingVerdict, edgesText, hostSentence, lawStateOf, minSec, onRelays, relayGroups,
  repairedSentence, ruleState, ruleThresholds, rulesOf, unitOf, verdictTone, type RuleStateKind,
} from "./law";
import { RuleLadder } from "./rule-ladder";

/**
 * A law block's state from the one API-30 read: a skeleton until it answers, its error with Retry, empty while the
 * controller has never reported its law, stale (muted, with the record's age) when the newest record is older than
 * 120 s, else ready. `fresh` false keeps a block ready that does not come from the law record (running alone).
 */
export function lawPanelState(read: Pick<PanelRead<LawView>, "data" | "failed" | "pending">, fresh = true): PanelState {
  if (read.pending) return "loading";
  if (!read.data) return read.failed ? "error" : "loading";
  if (read.failed) return "stale";
  if (read.data.observed_at === null) return "empty";
  return fresh && !read.data.reporting ? "stale" : "ready";
}

const NOT_REPORTED = <EmptyState message="The controller has not reported its climate law yet." detail="Its rules, the band it uses and its drying decision appear here once it does." />;

// ---------------------------------------------------------------------------------------------------- the rules
const STATE_STATUS: Readonly<Record<RuleStateKind, BadgeStatus>> = { on: "ok", held_on: "info", waiting: "info", asked: "info", wanted: "info", off: "neutral", unknown: "neutral" };
const RELAY_BADGE: Readonly<Record<string, BadgeKind>> = { on: "on", off: "off", unknown: "unknown" };

/** The rule's state as a badge: "On since 09:12", "Waiting 2 min 10 s (minimum off time)", "Wanted", "Off". */
export function RuleStateBadge({ rule }: { rule: Pick<LawRule, "latched" | "requested" | "relays" | "hold"> }) {
  const state = ruleState(rule);
  return <StatusBadge status={STATE_STATUS[state.kind]} size="sm">{state.text}</StatusBadge>;
}

/** The relays a rule drives, grouped by state so the row stays one line: "Vent, Fan 1, Fan 2 · Off"; "Heat 1 (electric) · On". */
function RelayStates({ rule }: { rule: LawRule }) {
  if (!rule.relays.length) return <span className="muted">—</span>;
  return <ul className="law-relays">{relayGroups(rule.relays).map((group) => <li key={group.names}>
    <span>{group.names}</span> <Badge kind={RELAY_BADGE[group.state] ?? "unknown"} size="sm" />
  </li>)}</ul>;
}

/** The rules' columns: the units sit in the threshold headers ("On, °F"), so the cells are the direction and a bare number. */
function ruleColumns(unit: string): readonly TableColumn<LawRule>[] {
  return [
    { key: "rule", header: "Rule", rowHeader: true, className: "law-rule-name", cell: (rule) => words("law_rule", rule.id) },
    { key: "on", header: `On, ${unit}`, className: "law-rule-on", cell: (rule) => ruleThresholds(rule).on },
    { key: "off", header: `Off, ${unit}`, numeric: true, cell: (rule) => ruleThresholds(rule).off },
    { key: "state", header: "State", titleAside: true, cell: (rule) => <RuleStateBadge rule={rule} /> },
    { key: "relays", header: "Relays", cell: (rule) => <RelayStates rule={rule} /> },
  ];
}

/** One signal's ladder and its rules as rows (screens §2.1 block 2). */
function SignalRules({ view, signal, label }: { view: LawView; signal: "temp" | "vpd"; label: string }) {
  const rules = rulesOf(view.rules, signal);
  const unit = unitOf(signal);
  const band = signal === "temp" ? { low: view.band.temp_low_f, high: view.band.temp_high_f } : { low: view.band.vpd_low_kpa, high: view.band.vpd_high_kpa };
  const reading = signal === "temp" ? view.inputs.temp_f : view.inputs.vpd_kpa;
  const ladderRules = rules.flatMap((rule) => (rule.on_at === null ? [] : [{
    id: rule.id, label: words("law_rule", rule.id), on: rule.on_at, off: rule.off_at, direction: rule.direction === "above" ? "above" as const : "below" as const,
    state: ruleState(rule).kind, limit: rule.id === "hot_limit" || rule.id === "cold_limit",
  }]));
  return <div className="law-signal">
    <h3>{label} <span className="muted">({unit})</span></h3>
    <RuleLadder label={label} unit={unit} band={band.low !== null && band.high !== null ? { low: band.low, high: band.high } : null} reading={reading} rules={ladderRules} />
    <Table label={`${label} rules`} caption={`${label} rules, in the law's order`} captionHidden columns={ruleColumns(unit)} rows={rules} rowKey={(rule) => rule.id} phone="list"
      empty={<EmptyState message={`No ${label} rules reported.`} />} />
  </div>;
}

/** Block 2: the two rule ladders, each with its rules under it. */
export function RulesPanel({ read }: { read: PanelRead<LawView> }) {
  const view = read.data;
  return <Panel title="Rules at the band's edges" thing="the climate law" state={lawPanelState(read)} reserve="lg" observedAt={view?.observed_at} onRetry={read.retry} empty={NOT_REPORTED}
    foot="Each rule turns its equipment on past one value and off past another; the controller checks them every second.">
    {view && <div className="law-signals">
      <SignalRules view={view} signal="temp" label="Temperature" />
      <div className="card-section"><SignalRules view={view} signal="vpd" label="VPD" /></div>
    </div>}
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- the answer (A4)
/**
 * The page's answer, first (screens rules, A4): what the controller is doing and why in Now's words (`lawSentence`, fed
 * from API-30 through `lawStateOf`), with the drying verdict when drying is wanted, and each relay that is on as a chip
 * with how long. A run by hand comes from the shell's API-02, which every page already polls.
 */
export function LawAnswerPanel({ read }: { read: PanelRead<LawView> }) {
  const view = read.data;
  const clock = useNow();
  const shell = useShellNow().data;
  const byHand = (shell?.overrides ?? []).filter((run) => !run.held_reason).map((run) => run.kind);
  const running = view ? onRelays(view) : [];
  const law = view ? lawStateOf(view) : null;
  const said = view ? lawSentence({ law, running, temp: view.inputs.temp_f ?? null, vpd: view.inputs.vpd_kpa ?? null, byHand }) : null;
  const state = lawPanelState(read);
  return <Panel title="What the controller is doing" thing="what the controller is doing" state={state === "empty" ? "ready" : state} reserve="sm" observedAt={view?.observed_at} onRetry={read.retry}>
    {view && said && <div className="law-answer">
      <p className="law-answer-text" data-doing={view.observed_at ? said.kind : "never"}>
        {view.observed_at ? said.sentences.join(" ") : "The controller has not reported its climate law yet, so what it is doing is not known."}
      </p>
      {law && running.length > 0 && <ul className="chips law-answer-relays" aria-label="On now">
        {running.map((relay) => {
          const since = relay.since ? Date.parse(relay.since) : Number.NaN;
          return <li key={relay.equipment}><span className="chip chip-static">{words("law_relay", relay.equipment)}{Number.isFinite(since) ? ` · ${duration(Math.max(0, Math.floor((clock - since) / 1000)))}` : ""}</span></li>;
        })}
      </ul>}
    </div>}
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- the drying decision
/** The verdict in one word for the head's pill (Running, Refused, Not wanted); the line under the checks gives the reason. */
const verdictWord = (state: LawView["drying"]["state"]): string => dryingVerdict({ state, refused_reason: null });

/** Block 3: the drying decision in the law's order, then its verdict (screens §2.1 block 3). */
export function DryingDecisionPanel({ read }: { read: PanelRead<LawView> }) {
  const view = read.data;
  const verdict = view ? dryingVerdict(view.drying) : null;
  return <Panel title="Drying decision" thing="the drying decision" state={lawPanelState(read)} observedAt={view?.observed_at} onRetry={read.retry} empty={NOT_REPORTED}
    pill={view ? <StatusBadge status={verdictTone(view.drying.state)} size="sm">{verdictWord(view.drying.state)}</StatusBadge> : undefined}
    link={{ to: "/climate/drying", label: "Drying" }}>
    {view && <>
      <Checklist label="The drying decision, in the law's order" items={dryingChecks(view)} />
      <p className="law-verdict"><span className="eyebrow">Verdict</span> {verdict}</p>
    </>}
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- the band in force
/** Block 4: the four edges the controller is using, where they came from, repaired or not, and the host's difference. */
export function BandInForcePanel({ read }: { read: PanelRead<LawView> }) {
  const view = read.data;
  const band = view?.band;
  const flagged = band && (band.repaired === true || band.differs === true);
  return <Panel title="Band in force" thing="the band in force" state={lawPanelState(read)} observedAt={view?.observed_at} onRetry={read.retry} empty={NOT_REPORTED}
    tone={flagged ? "warn" : undefined} link={{ to: "/band", label: "Band" }}>
    {band && <>
      <Kv items={[
        { key: "temp", term: "Temperature", value: edgesText(band.temp_low_f, band.temp_high_f, "°F") },
        { key: "vpd", term: "VPD", value: edgesText(band.vpd_low_kpa, band.vpd_high_kpa, "kPa") },
      ]} />
      <ul className="law-notes">
        <li>{bandSourceSentence(band)}</li>
        <li>{repairedSentence(band)}</li>
        <li>{hostSentence(band)}{band.differs && band.host && <> {edgesText(band.host.temp_low_f, band.host.temp_high_f, "°F")}, {edgesText(band.host.vpd_low_kpa, band.host.vpd_high_kpa, "kPa")}.</>}</li>
      </ul>
    </>}
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- running alone
/** Block 5: what the controller needs to hold the band without the host, and what it does instead (screens §2.1 block 5). */
export function RunningAlonePanel({ read }: { read: PanelRead<LawView> }) {
  const view = read.data;
  const items = view ? aloneChecks(view.alone) : [];
  return <Panel title="Running alone" thing="running alone" state={lawPanelState(read, false)} observedAt={view?.observed_at} onRetry={read.retry}
    tone={items.some((item) => item.mark === "unmet") ? "warn" : undefined}>
    {view && <Checklist label="What the controller needs to run without the host" items={items} />}
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- timing and constants
/** The first 12 characters of a hash, or "not reported". */
const shortHash = (hash: string | null | undefined) => (hash ? hash.slice(0, 12) : "not reported");

/** Block 7 (disclosure): the minimum times, the mister pulse, the protection limits, the lead fan and the constants' hash. */
export function TimingPanel({ read }: { read: PanelRead<LawView> }) {
  const view = read.data;
  if (!view) return null;
  const { timing, constants } = view;
  return <Details className="card law-timing" summary="Timing and constants">
      <Kv items={[
        { key: "relay", term: "Relays: minimum on, minimum off", value: `${minSec(timing.relay_min_on_s)}, ${minSec(timing.relay_min_off_s)}` },
        { key: "fog", term: "Fogger: minimum on, minimum off", value: `${minSec(timing.fog_min_on_s)}, ${minSec(timing.fog_min_off_s)}` },
        { key: "furnace", term: "Gas furnace: wait after start", value: minSec(timing.furnace_boot_wait_s) },
        { key: "mist", term: "Misters: pulse, gap", value: `${minSec(timing.mist_pulse_s)}, ${minSec(timing.mist_gap_s)}` },
        { key: "hot", term: "Hot limit", value: formatValue(timing.hot_limit_f, "°F") },
        { key: "cold", term: "Cold limit", value: formatValue(timing.cold_limit_f, "°F") },
        { key: "lead", term: "Lead fan", value: view.lead_fan ? words("law_relay", view.lead_fan) : null, reason: "not reported" },
        { key: "hash", term: "Constants on the controller", value: <code>{shortHash(constants.hash)}</code> },
        { key: "release", term: "Constants of this release", value: <code>{shortHash(constants.release_hash)}</code> },
      ]} />
      <p className="meta">{capital(`the controller says ${constantsWords(constants)}.`)}</p>
  </Details>;
}

/** The page's status line (screens §2.1 block 1): reporting or not, the record's age, the constants against the release. */
export function lawStatusParts(view: LawView): { reporting: string; constants: string } {
  return { reporting: view.reporting ? "Reporting" : view.observed_at ? "Not reporting" : "Has not reported", constants: capital(constantsWords(view.constants)) };
}
