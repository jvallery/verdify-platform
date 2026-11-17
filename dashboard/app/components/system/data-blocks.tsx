// SPDX-License-Identifier: MIT
import { useId } from "react";
import { Link, useSearchParams } from "react-router";
import { DailyBars } from "../../charts/daily-bars";
import { ChartGroup } from "../../charts/legend";
import { duration, formatValue, localDate, sentenceStart } from "../../lib/format";
import type { DataContinuity, Delivery, Setting } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { settingName } from "../../lib/settings-context";
import { hasWords, sendingWords, unknownWords, words } from "../../lib/words";
import { StatusBadge } from "../badge";
import { LocalTime, cls } from "../common";
import { DataList } from "../data/data-list";
import { finite } from "../data/viz";
import { Details } from "../details";
import { Panel } from "../panel";
import { Segmented } from "../segmented";
import { Table } from "../table";
import {
  CONTINUITY_DAYS, DELIVERY_HOURS, type ContinuityDays, type DeliveryHours, type FailingRow, type ProbeSummary, type SenderRow, type StateLine,
  STANDING_WORDS, confirmTimeWords, continuityBars, failingRows, oldestWaiting, oldestWords, probeAge, readbackWords, senderRows, tableWords,
} from "./data-words";
import { hostState } from "./states";

/** A code in words standing alone (A8): its words with a capital, or "Unknown (code)" muted when this build has none. */
function Coded({ family, code }: { family: string; code: string }) {
  return hasWords(family, code) ? <>{sentenceStart(words(family, code))}</> : <span className="word-unknown">{unknownWords(code)}</span>;
}
const ago = (seconds: number | null | undefined) => (finite(seconds) ? `${duration(seconds)} ago` : "—");
const count = (value: number | null | undefined) => formatValue(value, "count");
const tableName = (table: string) => tableWords(table) ?? <span className="word-unknown">{unknownWords(table)}</span>;

// ---------------------------------------------------------------------------------------------------- the answer
/** One of the answer's lines: the block's name linking to it, a dot in its tone, its state in words. */
function AnswerLine({ to, name, line }: { to: string; name: string; line: StateLine | null }) {
  return <li className={cls("sys-answer-line", line && `is-${line.tone}`)} data-tone={line?.tone}>
    <span className="sys-dot" aria-hidden="true" /><a href={to}>{name}</a><span>{line ? line.text : "—"}</span>
  </li>;
}

/**
 * The page's first block (A4, B6): the sentence of what was lost and what the gap log replayed, then three short lines,
 * flow, probes and delivery, each with its state and a link to its block. While a read has not answered its line is a
 * dash; a failed read says so.
 */
export function DataAnswer({ sentence, flow, probes, delivery, failed }: { sentence: string | null; flow: StateLine | null; probes: StateLine | null; delivery: StateLine | null; failed: boolean }) {
  return <section className="card sys-answer" aria-label="Answer">
    <p className="sys-answer-text">{sentence ?? (failed ? "The record's continuity could not be read." : "Reading the record's continuity.")}</p>
    <ul className="sys-answer-lines">
      <AnswerLine to="#flow" name="Flow" line={flow} />
      <AnswerLine to="#probes" name="Probes" line={probes} />
      <AnswerLine to="#delivery" name="Delivery" line={delivery} />
    </ul>
  </section>;
}

// ---------------------------------------------------------------------------------------------------- flow
type Tables = DataContinuity["tables"][number];

/** Flow (row 1): each stored table with its newest row's age and rows in the last five minutes; the ingestor's heartbeat. */
export function FlowPanel({ read }: { read: PanelRead<DataContinuity> }) {
  const data = read.data;
  return <Panel id="flow" title="Flow" thing="the data flow" state={hostState(read, (value) => value.tables.length === 0)} reserve="md" onRetry={read.retry}
    empty={<p className="meta">No stored table reported its newest row.</p>}>
    {data && <>
      <p className="sys-lead">Ingestor heartbeat <strong>{ago(data.ingestor.heartbeat_age_s)}</strong></p>
      <Table<Tables> label="Stored tables" caption="Each stored table's newest row" captionHidden rows={data.tables} rowKey={(row) => row.table} phone="list" columns={[
        { key: "table", header: "Table", rowHeader: true, cell: (row) => tableName(row.table) },
        { key: "age", header: "Newest row", numeric: true, cell: (row) => ago(row.last_row_age_s) },
        { key: "rows", header: "Rows, 5 min", numeric: true, cell: (row) => count(row.rows_5m) },
      ]} />
    </>}
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- probes
type Probe = DataContinuity["probes"][number];

/**
 * Probes (row 2, B6): the probes not answering first, grouped where several of one kind went quiet on the same day; one
 * that stopped within the day is a warning, one silent for longer is known and muted. Then "16 probes answering", which
 * opens the full list with each probe's last answer.
 */
export function ProbesPanel({ read, summary }: { read: PanelRead<DataContinuity>; summary: ProbeSummary | null }) {
  const recent = summary?.stoppedToday ?? 0;
  return <Panel id="probes" title="Probes" thing="the probes" state={hostState(read, (value) => value.probes.length === 0)} reserve="md" onRetry={read.retry}
    tone={recent > 0 ? "warn" : undefined} empty={<p className="meta">No probe has reported.</p>}>
    {summary && <>
      {summary.silent.length > 0 && <ul className="sys-silent" aria-label="Probes not answering">
        {summary.silent.map((line) => <li key={line.key} className={cls("sys-silent-line", line.recent ? "is-recent" : "is-known")} data-sensors={line.sensors.join(" ")}>
          {line.recent && <StatusBadge size="sm" status="warn">Stopped today</StatusBadge>}<span>{line.text}</span>
        </li>)}
      </ul>}
      <Details className="sys-answering" summary={summary.answering.length === 0 ? "No probe is answering" : `${summary.answering.length} ${summary.answering.length === 1 ? "probe" : "probes"} answering`}>
        {summary.answering.length > 0 && <Table<Probe> label="Probes answering" caption="When each probe answering last answered" captionHidden rows={summary.answering} rowKey={(row) => row.sensor} phone="list" columns={[
          { key: "sensor", header: "Probe", rowHeader: true, cell: (row) => (hasWords("probe", row.sensor) ? words("probe", row.sensor) : <span className="word-unknown">{unknownWords(row.sensor)}</span>) },
          { key: "age", header: "Last answer", numeric: true, cell: (row) => probeAge(row.age_s) },
        ]} />}
      </Details>
    </>}
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- continuity
type Outage = DataContinuity["outages"][number];
type Replayed = DataContinuity["replayed"][number];
const gapLogWords = (code: string | null | undefined) => (code ? (hasWords("gap_log", code) ? words("gap_log", code) : unknownWords(code)) : "not reported");
const minutes = (value: number) => `${formatValue(value, "count")}${" "}min`;

/**
 * Continuity (row 3): per local day over 1, 7 or 30 days (`?days=`), seconds without data and minutes the gap log
 * replayed as two daily bars under one key, today labelled so far; the outages (start, end, length, reason, whether
 * replayed) and the replayed quarters, five rows each before Show all.
 */
export function ContinuityPanel({ read, days }: { read: PanelRead<DataContinuity>; days: ContinuityDays }) {
  const [params] = useSearchParams();
  const data = read.data;
  const href = (value: number) => {
    const next = new URLSearchParams(params);
    next.set("days", String(value));
    return `?${next.toString()}`;
  };
  const bars = data ? continuityBars(data.by_day, localDate(data.to)) : null;
  return <Panel id="continuity" title="Continuity" thing="continuity" state={hostState(read)} reserve="lg" onRetry={read.retry}
    tone={data && data.gap_log && data.gap_log !== "armed" ? "warn" : undefined}
    actions={<Segmented label="Days" size="sm" value={String(days)} segments={CONTINUITY_DAYS.map((value) => ({ value: String(value), label: value === 1 ? "1 day" : `${value} days`, to: href(value), keepScroll: true }))} />}>
    {data && bars && <>
      <p className="sys-lead">Gap log <strong>{gapLogWords(data.gap_log)}</strong></p>
      <ChartGroup label="Continuity by day" className="sys-continuity-bars">
        <div className="sys-pair">
          <DailyBars title="Seconds without data" unit="s" token="--warn" days={bars.outage} size="sm" syncKey={`verdify:continuity:${days}`} format={(value) => duration(value)} />
          <DailyBars title="Minutes replayed" unit="min" token="--accent" days={bars.replayed} size="sm" syncKey={`verdify:continuity:${days}`} format={minutes} />
        </div>
      </ChartGroup>
      <div className="card-section">
        <h3 className="sys-subtitle">Outages</h3>
        {data.outages.length === 0 ? <p className="meta">No outage in this window.</p>
          : <Table<Outage> label="Outages" caption="Each time the record stopped, newest first" captionHidden rows={data.outages} rowKey={(row) => row.start} phone="list" maxRows={5} rowNoun="outages" columns={[
            { key: "start", header: "Start", rowHeader: true, cell: (row) => <LocalTime at={row.start} date /> },
            { key: "end", header: "End", cell: (row) => (row.end ? <LocalTime at={row.end} /> : "Still open") },
            { key: "length", header: "Length", numeric: true, cell: (row) => (finite(row.duration_s) ? duration(row.duration_s) : "—") },
            { key: "reason", header: "Reason", className: "cell-text", cell: (row) => (row.reason ? <Coded family="data_gap_reason" code={row.reason} /> : "—") },
            { key: "status", header: "On return", cell: (row) => (row.status ? <Coded family="data_gap_status" code={row.status} /> : "—") },
          ]} />}
      </div>
      <div className="card-section">
        <h3 className="sys-subtitle">Replayed quarters</h3>
        {data.replayed.length === 0 ? <p className="meta">The gap log replayed nothing in this window.</p>
          : <Table<Replayed> label="Replayed quarters" caption="Each quarter hour the gap log replayed, newest first" captionHidden rows={data.replayed} rowKey={(row) => `${row.boot}:${row.qseq}`} phone="list" maxRows={5} rowNoun="quarters" columns={[
            { key: "span", header: "Quarter", rowHeader: true, cell: (row) => <><LocalTime at={row.first_at} date />–<LocalTime at={row.last_at} /></> },
            { key: "received", header: "Received", cell: (row) => <LocalTime at={row.received_at} /> },
            { key: "climate", header: "Readings", numeric: true, cell: (row) => count(row.climate_rows) },
            { key: "transitions", header: "Relay changes", numeric: true, cell: (row) => count(row.transition_rows) },
          ]} />}
      </div>
    </>}
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- delivery
export const settingEditHref = (param: string) => `/settings?edit=${encodeURIComponent(param)}`;

/**
 * A setting named by the catalogue (A8): its label, or "Retired setting" with its key under it. A setting the catalogue
 * no longer has (`retired`) is its key alone, with no link: it has no drawer on Settings.
 */
function SettingName({ param, catalog, retired = false }: { param: string; catalog: readonly Setting[] | null; retired?: boolean }) {
  if (retired) return <span className="key-mono">{param}</span>;
  const name = settingName(param, catalog);
  return <Link to={settingEditHref(param)}>{name.label}{name.retired && <span className="key-mono">{name.key}</span>}</Link>;
}

/**
 * Delivery (row 4, B6): what the host pushed over 24 h or 7 d (`?hours=`) by who sent it and how it ended (the
 * controller's own reports are not pushes and stay out); the oldest value still unconfirmed, time to confirm, the last
 * readback pass and how the host is sending; then the settings whose pushes failed, each as it stands against the
 * catalogue (failing, in force, recovered or retired; `failingRows`), failing first, each linking to its drawer on
 * Settings, ten rows before Show all. That table waits until the catalogue read settles (`catalogSettled`), so a count it
 * would clear never shows. The panel is a warning only while a setting is failing now.
 */
export function DeliveryPanel({ read, hours, catalog, catalogSettled = true }: { read: PanelRead<Delivery>; hours: DeliveryHours; catalog: readonly Setting[] | null; catalogSettled?: boolean }) {
  const [params] = useSearchParams();
  const data = read.data;
  const href = (value: number) => {
    const next = new URLSearchParams(params);
    next.set("hours", String(value));
    return `?${next.toString()}`;
  };
  const senders = data ? senderRows(data.by_status) : [];
  const failing = data && catalogSettled ? failingRows(data.failing, catalog) : [];
  const failingNow = failing.some((row) => row.now);
  const waiting = senders.some((row) => row.counts.waiting > 0);
  const sending = data ? sendingWords(data.dispatcher_stage) : null;
  return <Panel id="delivery" title="Delivery" thing="delivery" state={hostState(read)} reserve="lg" onRetry={read.retry}
    tone={failingNow ? "warn" : undefined}
    actions={<Segmented label="Range" size="sm" value={String(hours)} segments={DELIVERY_HOURS.map((value) => ({ value: String(value), label: value === 24 ? "24 h" : "7 d", to: href(value), keepScroll: true }))} />}>
    {data && <>
      <DataList items={[
        { key: "oldest", term: "Oldest unconfirmed", value: oldestWords(oldestWaiting(data)) },
        { key: "latency", term: "Time to confirm", value: confirmTimeWords(data.latency), reason: "none confirmed" },
        { key: "pass", term: "Last readback pass", value: data.readback_pass.at ? <><LocalTime at={data.readback_pass.at} />: {readbackWords(data.readback_pass)}</> : null, reason: "not reported" },
        { key: "stage", term: "Sending", value: sending ? sentenceStart(sending) : null, reason: "not reported" },
      ]} />
      <div className="card-section">
        <h3 className="sys-subtitle">Pushes by sender</h3>
        {senders.length === 0 ? <p className="meta">Nothing was pushed in this window.</p>
          : <Table<SenderRow> label="Pushes by sender" caption="Pushes by who sent them and how they ended" captionHidden rows={senders} rowKey={(row) => row.sender} columns={[
            { key: "sender", header: "Sent by", rowHeader: true, cell: (row) => row.name },
            { key: "confirmed", header: "Confirmed", numeric: true, headerGroup: "Pushes", cell: (row) => count(row.counts.confirmed) },
            { key: "failed", header: "Not taken", numeric: true, headerGroup: "Pushes", cell: (row) => count(row.counts.failed) },
            { key: "cancelled", header: "Cancelled", numeric: true, headerGroup: "Pushes", cell: (row) => count(row.counts.cancelled) },
            { key: "superseded", header: "Replaced", numeric: true, headerGroup: "Pushes", cell: (row) => count(row.counts.superseded) },
            ...(waiting ? [{ key: "waiting", header: "Waiting", numeric: true, headerGroup: "Pushes", cell: (row: SenderRow) => count(row.counts.waiting) }] : []),
          ]} />}
      </div>
      <div className="card-section">
        <h3 className="sys-subtitle">Settings whose pushes failed</h3>
        {!catalogSettled ? <p className="meta">Reading the settings catalogue…</p>
          : failing.length === 0 ? <p className="meta">No push failed in this window.</p>
          : <>{!failingNow && <p className="meta sys-none-failing">None is failing now.</p>}<Table<FailingRow> label="Settings whose pushes failed" caption="Settings whose pushes failed, failing now first" captionHidden rows={failing} rowKey={(row) => row.param} phone="list" maxRows={10} rowNoun="settings" columns={[
            { key: "setting", header: "Setting", rowHeader: true, cell: (row) => <SettingName param={row.param} catalog={catalog} retired={row.standing === "retired"} /> },
            { key: "state", header: "State", titleAside: true, cell: (row) => <StatusBadge size="sm" status={STANDING_WORDS[row.standing].status}>{STANDING_WORDS[row.standing].label}</StatusBadge> },
            { key: "failed", header: "Failures", numeric: true, cell: (row) => count(row.failed) },
            { key: "last", header: "Last failed", cell: (row) => <LocalTime at={row.last_failed_at} date /> },
            { key: "confirmed", header: "Last confirmed", cell: (row) => (row.last_confirmed_at ? <LocalTime at={row.last_confirmed_at} date />
              : row.standing === "in_force" && row.readbackAt ? <>read back <LocalTime at={row.readbackAt} date /></> : "—") },
          ]} /></>}
      </div>
    </>}
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- ingestor counters
/** Ingestor counters (row 5, a disclosure): reconnects, rejected payloads, replay failures and rejected rows by table. */
export function IngestorCounters({ read }: { read: PanelRead<DataContinuity> }) {
  const id = useId();
  const ingestor = read.data?.ingestor;
  const rejected = Object.entries(ingestor?.rows_rejected ?? {});
  return <section className="card sys-counters" aria-labelledby={id}>
    <Details summary={<span id={id}>Ingestor counters</span>}>
      {read.failed ? <p className="fault">Couldn't load the ingestor counters.</p>
        : !ingestor ? <p className="meta">Loading the ingestor counters.</p>
        : <>
          <DataList items={[
            { key: "reconnects", term: "Reconnects", value: finite(ingestor.reconnects) ? count(ingestor.reconnects) : null, reason: "not reported" },
            { key: "payloads", term: "Payloads rejected", value: finite(ingestor.payloads_rejected) ? count(ingestor.payloads_rejected) : null, reason: "not reported" },
            { key: "replay", term: "Replay failures", value: finite(ingestor.replay_failures) ? count(ingestor.replay_failures) : null, reason: "not reported" },
            { key: "observed", term: "Counted", value: ingestor.observed_at ? <LocalTime at={ingestor.observed_at} /> : null, reason: "not reported" },
          ]} />
          <h3 className="sys-subtitle">Rows rejected by table</h3>
          {rejected.length === 0 ? <p className="meta">{ingestor.rows_rejected === null ? "Not reported." : "No row was rejected."}</p>
            : <ul className="sys-plain-list">{rejected.map(([table, rows]) => <li key={table}>{tableName(table)}: {count(rows)}</li>)}</ul>}
        </>}
    </Details>
  </section>;
}
