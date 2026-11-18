// SPDX-License-Identifier: MIT
import { Fragment, useId, type ReactNode } from "react";
import { duration, formatValue, sentenceStart } from "../../lib/format";
import type { ControllerHealth, LawView } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { hasWords, unknownWords, words, wordsOrUnknown } from "../../lib/words";
import { StatusBadge, type BadgeStatus } from "../badge";
import { LocalTime, cls } from "../common";
import { Checklist, type CheckMark, type ChecklistItem } from "../data/checklist";
import { DataList } from "../data/data-list";
import { MetricTile, type TileState } from "../data/metric-tile";
import { finite } from "../data/viz";
import { Details } from "../details";
import { Panel, PanelError, type PanelState } from "../panel";
import { budgetItems, verdict, type BudgetItem, type BudgetLevel, type Verdict } from "./budget";
import { BudgetMeter } from "./budget-meter";

const NBSP = " ";

/** "3 d 3 h", "5 h 12 min", "12 min", "40 s": how long the controller had been up when it reported. */
export function uptimeWords(seconds: number | null | undefined): string {
  if (!finite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86_400), hours = Math.floor((seconds % 86_400) / 3600), minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}${NBSP}d${hours ? `${NBSP}${hours}${NBSP}h` : ""}`;
  if (hours > 0) return `${hours}${NBSP}h${minutes ? `${NBSP}${minutes}${NBSP}min` : ""}`;
  return minutes > 0 ? `${minutes}${NBSP}min` : `${Math.floor(seconds)}${NBSP}s`;
}

/** A version that may wrap only after its dots, never mid-number. */
function dotted(version: string): ReactNode {
  const parts = version.split(".");
  return parts.map((part, index) => <Fragment key={index}>{part}{index < parts.length - 1 && <>.<wbr /></>}</Fragment>);
}

/** The firmware against the pinned release, in words. */
export function firmwareWords(firmware: ControllerHealth["firmware"]): string {
  if (!firmware.version) return "Not reported.";
  if (!firmware.pinned) return "No release is pinned to compare against.";
  return firmware.matches === false ? `Differs from the pinned release ${firmware.pinned}.` : "Matches the pinned release.";
}

const LEVEL_TONE: Readonly<Record<BudgetLevel, BadgeStatus>> = { ok: "ok", warn: "warn", critical: "critical", unknown: "neutral" };
const tileState = (state: PanelState): TileState => (state === "ready" || state === "busy" ? "ready" : state === "ingestor_down" || state === "controller_not_reporting" ? "stale" : state);

export type ControllerBlockProps = { read: PanelRead<ControllerHealth>; state: PanelState; since?: string | null };

const lowerFirst = (text: string) => (text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);

/** The answer's sentence (A4, B7): "The controller is healthy: every part …", or the first limit crossed and how many more. */
export function verdictSentence(said: Verdict): string {
  if (said.level === "ok") return `The controller is healthy: ${lowerFirst(said.text)}`;
  if (said.more === 0) return said.text;
  return `${said.text} ${said.more === 1 ? "One more limit is crossed" : `${said.more} more limits are crossed`}; each is marked in the hardware budget.`;
}

/**
 * The page's first block (A4, B7): one pill and the verdict as a sentence, healthy or the first limit crossed and what
 * it means. While the controller is not reporting it says so with the time of its last values; a failed read is its own
 * error with Retry. The page header carries the uptime and the time of the report, once.
 */
export function ControllerAnswer({ read, state, since }: ControllerBlockProps) {
  const said = read.data ? verdict(read.data) : null;
  const silent = state === "ingestor_down" || state === "controller_not_reporting";
  return <section className={cls("card sys-answer", said?.level === "critical" && !silent && "tone-fault", said?.level === "warn" && !silent && "tone-warn")} aria-label="Verdict" data-state={state} data-level={said?.level}>
    {state === "error" ? <PanelError thing="the controller's health" onRetry={read.retry} />
      : state === "loading" || !said ? <p className="sys-answer-text">Reading the controller's health.</p>
      : silent ? <p className="sys-answer-head"><StatusBadge status="neutral">Not reporting</StatusBadge>
        <span className="sys-answer-text">The controller is not reporting{since ? <>; its last values are from <LocalTime at={since} date /></> : ""}.</span></p>
      : <p className="sys-answer-head"><StatusBadge status={LEVEL_TONE[said.level]}>{said.title}</StatusBadge><span className="sys-answer-text">{verdictSentence(said)}</span></p>}
  </section>;
}

function BudgetTile({ row, state, onRetry }: { row: BudgetItem; state: TileState; onRetry: () => void }) {
  return <MetricTile label={row.label} state={state} onRetry={onRetry} value={row.value === null ? null : row.text} reason="not reported"
    tone={state === "ready" && row.level === "critical" ? "fault" : state === "ready" && row.level === "warn" ? "warn" : undefined}
    visual={<BudgetMeter row={row} stale={state === "stale"} />}
    meta={<>{row.level !== "unknown" && row.level !== "ok" && <><StatusBadge size="sm" status={LEVEL_TONE[row.level]}>{crossedWords(row)}</StatusBadge><br /></>}
      {row.note && <>{row.note}<br /></>}{row.limits ? sentenceStart(row.limits) : ""}{row.meta && <><br />{row.meta}</>}</>}
    data={{ "data-budget": row.key, "data-level": row.level }} />;
}

/** "Below warning", "Above critical": which line the value has crossed, short enough for a tile's pill on a phone. */
export const crossedWords = (row: Pick<BudgetItem, "worse" | "level">) => `${row.worse === "lower" ? "Below" : "Above"} ${row.level === "critical" ? "critical" : "warning"}`;

/** The six budget keys in order, for skeleton tiles before API-35 answers. */
const SKELETON_LABELS = ["Free memory", "Largest free block", "Loop time", "Storage write", "Free stack", "Storage entries"];

/** Hardware budget (row 2): six stats, each with a meter against its warning and critical lines. Not a card: its tiles are. */
export function BudgetSection({ read, state }: ControllerBlockProps) {
  const id = useId();
  const tiles = tileState(state);
  return <section className="sys-budget" aria-labelledby={id} data-state={state}>
    <h2 id={id} className="sys-section-title">Hardware budget</h2>
    <div className="sys-tiles">
      {read.data && tiles !== "loading" && tiles !== "error"
        ? budgetItems(read.data).map((row) => <BudgetTile key={row.key} row={row} state={tiles} onRetry={read.retry} />)
        : SKELETON_LABELS.map((label) => <MetricTile key={label} label={label} value={null} state={tiles === "error" ? "error" : "loading"} onRetry={read.retry} />)}
    </div>
  </section>;
}

/** Identity and uptime (row 3): firmware against the pinned release, uptime, restarts with the last reset reason, last boot. */
export function IdentityPanel({ read, state, since }: ControllerBlockProps) {
  const health = read.data;
  return <Panel id="identity" title="Identity and uptime" thing="the controller's identity" state={state} since={since} reserve="sm" observedAt={health?.observed_at} onRetry={read.retry}>
    {health && <DataList items={[
      { key: "firmware", term: "Firmware", value: health.firmware.version ? <><span className="mono sys-firmware">{dotted(health.firmware.version)}</span><br /><span className="meta">{firmwareWords(health.firmware)}</span></> : null, reason: "not reported" },
      { key: "uptime", term: "Uptime", value: finite(health.uptime_s) ? uptimeWords(health.uptime_s) : null, reason: "not reported" },
      { key: "restarts", term: "Restarts", value: finite(health.restarts.count) ? formatValue(health.restarts.count, "count") : null, reason: "not reported" },
      { key: "reset", term: "Last reset", value: health.restarts.reset_reason ? sentenceStart(health.restarts.reset_reason) : null, reason: "not reported" },
      { key: "booted", term: "Booted", value: health.restarts.booted_at ? <LocalTime at={health.restarts.booted_at} date /> : null, reason: "not reported" },
    ]} />}
  </Panel>;
}

const yesNo = (value: boolean | null | undefined, yes: string, no: string) => (value === true ? yes : value === false ? no : null);

/** Links (row 4): Wi-Fi, the clock, the probes. */
export function LinksPanel({ read, state, since }: ControllerBlockProps) {
  const health = read.data;
  return <Panel id="links" title="Links" thing="the controller's links" state={state} since={since} reserve="sm" observedAt={health?.observed_at} onRetry={read.retry}>
    {health && <DataList items={[
      { key: "rssi", term: "Wi-Fi signal", value: finite(health.wifi.rssi_dbm) ? formatValue(health.wifi.rssi_dbm, "dBm") : null, reason: "not reported" },
      { key: "disconnects", term: "Wi-Fi disconnects", value: finite(health.wifi.disconnects) ? formatValue(health.wifi.disconnects, "count") : null, reason: "not reported" },
      { key: "clients", term: "API connections", value: finite(health.wifi.api_clients) ? formatValue(health.wifi.api_clients, "count") : null, reason: "not reported" },
      { key: "clock", term: "Clock", value: yesNo(health.clock.valid, "Set", "Not set"), reason: "not reported" },
      { key: "sync", term: "Last clock sync", value: finite(health.clock.sync_age_s) ? `${duration(health.clock.sync_age_s)} ago` : null, reason: "not reported" },
      { key: "probes", term: "Probes answering", value: finite(health.probes.active) ? `${formatValue(health.probes.active, "count")}${health.probes.degraded ? ", fewer than it needs" : ""}` : null, reason: "not reported" },
    ]} />}
  </Panel>;
}

const mark = (value: boolean | null | undefined): CheckMark => (value === true ? "met" : value === false ? "unmet" : "unknown");
const gapWords = (code: string | null | undefined) => (code ? (hasWords("gap_log", code) ? words("gap_log", code) : unknownWords(code)) : "not reported");

/** What the controller needs to run alone (K-12), from API-30 `alone`: clock, probes, host, gap log. */
export function aloneItems(law: LawView): ChecklistItem[] {
  const { clock, probes, host, gap_log: gap } = law.alone;
  return [
    { key: "clock", mark: mark(clock.valid), statement: "The clock is set.", detail: finite(clock.sync_age_s) ? `Last synced ${duration(clock.sync_age_s)} ago.` : "No sync reported." },
    { key: "probes", mark: probes.degraded === null || probes.degraded === undefined ? "unknown" : probes.degraded ? "unmet" : "met", statement: "Enough probes answer.", detail: finite(probes.active) ? `${probes.active} answering.` : "Not reported." },
    { key: "host", mark: mark(host.connected), statement: "The host is connected.", detail: finite(host.heartbeat_age_s) ? `Heartbeat ${duration(host.heartbeat_age_s)} ago.` : "No heartbeat reported." },
    { key: "gap", mark: gap === "armed" ? "met" : gap ? "unmet" : "unknown", statement: "The gap log is keeping a record.", detail: `Gap log ${gapWords(gap)}.` },
  ];
}

/** Law state (row 5): band source and gap log from API-35, constants match and running alone from API-30. */
export function LawStatePanel({ read, state, since, law }: ControllerBlockProps & { law: PanelRead<LawView> }) {
  const health = read.data;
  const lawNow = law.failed ? null : law.data;
  const constants = lawNow?.constants;
  const match = constants?.matches === true ? "Match this release." : constants?.matches === false ? "Differ from this release: the controller runs other constants." : "Not reported.";
  return <Panel id="law-state" title="Law state" thing="the law's state" state={state} since={since} reserve="md" observedAt={health?.observed_at} onRetry={read.retry}
    link={{ to: "/climate", label: "Climate law" }}>
    {health && <DataList items={[
      { key: "band", term: "Band source", value: health.band_source ? sentenceStart(wordsOrUnknown("band_source", health.band_source)) : null, reason: "not reported" },
      { key: "gap", term: "Gap log", value: health.gap_log ? sentenceStart(gapWords(health.gap_log)) : null, reason: "not reported" },
      { key: "constants", term: "Law constants", value: law.failed ? null : match, reason: "the law could not be read" },
    ]} />}
    {lawNow && <div className="card-section">
      <h3 className="sys-subtitle">Running alone</h3>
      <Checklist label="What the controller needs to run alone" items={aloneItems(lawNow)} />
    </div>}
    {constants && <Details summary="As reported" className="sys-as-reported">
      <DataList items={[
        { key: "hash", term: "Controller's constants", value: constants.hash ? <span className="mono sys-hash">{constants.hash}</span> : null, reason: "not reported" },
        { key: "release", term: "This release's constants", value: <span className="mono sys-hash">{constants.release_hash}</span> },
      ]} />
    </Details>}
  </Panel>;
}
