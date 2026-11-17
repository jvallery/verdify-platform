// SPDX-License-Identifier: MIT
import { useId } from "react";
import { Link, useSearchParams } from "react-router";
import { DailyBars } from "../../charts/daily-bars";
import { duration, formatValue, localDate } from "../../lib/format";
import type { DataContinuity, Delivery } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { hasWords, words } from "../../lib/words";
import { StatusBadge } from "../badge";
import { LocalTime } from "../common";
import { DataList } from "../data/data-list";
import { cssVars, finite } from "../data/viz";
import { Details } from "../details";
import { Panel } from "../panel";
import { Segmented } from "../segmented";
import { Table } from "../table";
import { CONTINUITY_DAYS, DELIVERY_HOURS, PROBE_LOST_S, continuityBars, type ContinuityDays, oldestWords, probeAge, probeWords, readbackWords, statusTotals, tableWords, type DeliveryHours } from "./data-words";
import { hostState } from "./states";

/** A code in words, or raw in mono when this build has none. */
function Coded({ family, code }: { family: string; code: string }) {
  return hasWords(family, code) ? <>{words(family, code)}</> : <code className="sys-raw">{code}</code>;
}
const ago = (seconds: number | null | undefined) => (finite(seconds) ? `${duration(seconds)} ago` : "—");
const count = (value: number | null | undefined) => formatValue(value, "count");

type Tables = DataContinuity["tables"][number];
type Probe = DataContinuity["probes"][number];

/** Flow (row 1): each stored table with its newest row's age and rows in the last five minutes; the ingestor's heartbeat. */
export function FlowPanel({ read }: { read: PanelRead<DataContinuity> }) {
  const data = read.data;
  return <Panel id="flow" title="Flow" thing="the data flow" state={hostState(read, (value) => value.tables.length === 0)} reserve="md" observedAt={data?.ingestor.observed_at} onRetry={read.retry}
    empty={<p className="meta">No stored table reported its newest row.</p>}>
    {data && <>
      <p className="sys-lead">Ingestor heartbeat <strong>{ago(data.ingestor.heartbeat_age_s)}</strong></p>
      <Table<Tables> label="Stored tables" caption="Each stored table's newest row" captionHidden rows={data.tables} rowKey={(row) => row.table} phone="list" columns={[
        { key: "table", header: "Table", rowHeader: true, cell: (row) => tableWords(row.table) ?? <code className="sys-raw">{row.table}</code> },
        { key: "age", header: "Newest row", numeric: true, cell: (row) => ago(row.last_row_age_s) },
        { key: "rows", header: "Rows in 5 min", numeric: true, cell: (row) => count(row.rows_5m) },
      ]} />
    </>}
  </Panel>;
}

/** Probes (row 2): each sensor with the age of its last answer; two hours or more reads "not seen in 2 h". */
export function ProbesPanel({ read }: { read: PanelRead<DataContinuity> }) {
  const data = read.data;
  const lost = data?.probes.filter((probe) => finite(probe.age_s) && probe.age_s >= PROBE_LOST_S).length ?? 0;
  return <Panel id="probes" title="Probes" thing="the probes" state={hostState(read, (value) => value.probes.length === 0)} reserve="md" onRetry={read.retry}
    tone={lost > 0 ? "warn" : undefined} empty={<p className="meta">No probe has reported.</p>}>
    {data && <>
      {lost > 0 && <p className="sys-lead">{lost === 1 ? "One probe has" : `${lost} probes have`} not answered in 2 hours.</p>}
      <Table<Probe> label="Probe ages" caption="When each probe last answered" captionHidden rows={data.probes} rowKey={(row) => row.sensor} phone="list" columns={[
        { key: "sensor", header: "Probe", rowHeader: true, cell: (row) => probeWords(row.sensor) ?? <code className="sys-raw">{row.sensor}</code> },
        { key: "age", header: "Last answer", numeric: true, cell: (row) => (finite(row.age_s) && row.age_s >= PROBE_LOST_S
          ? <StatusBadge size="sm" status="warn">{probeAge(row.age_s)}</StatusBadge> : probeAge(row.age_s)) },
      ]} />
    </>}
  </Panel>;
}

type Outage = DataContinuity["outages"][number];
type Replayed = DataContinuity["replayed"][number];
const gapLogWords = (code: string | null | undefined) => (code ? (hasWords("gap_log", code) ? words("gap_log", code) : code) : "not reported");
const minutes = (value: number) => `${formatValue(value, "count")}${"\u00a0"}min`;

/**
 * Continuity (row 3): per local day over 1, 7 or 30 days (`?days=`), seconds without data and minutes the gap log
 * replayed as daily bars, today labelled so far; the outages (start, end, length, reason, whether replayed) and the
 * replayed quarters.
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
  return <Panel id="continuity" title="Continuity" thing="continuity" state={hostState(read)} reserve="lg" observedAt={data?.to} onRetry={read.retry}
    tone={data && data.gap_log && data.gap_log !== "armed" ? "warn" : undefined}
    actions={<Segmented label="Days" size="sm" value={String(days)} segments={CONTINUITY_DAYS.map((value) => ({ value: String(value), label: value === 1 ? "1 day" : `${value} days`, to: href(value), keepScroll: true }))} />}>
    {data && bars && <>
      <p className="sys-lead">Gap log <strong>{gapLogWords(data.gap_log)}</strong></p>
      <div className="sys-pair sys-continuity-bars">
        <DailyBars title="Seconds without data" unit="s" token="--warn" days={bars.outage} size="sm" syncKey={`verdify:continuity:${days}`} format={(value) => duration(value)} />
        <DailyBars title="Minutes replayed" unit="min" token="--accent" days={bars.replayed} size="sm" syncKey={`verdify:continuity:${days}`} format={minutes} />
      </div>
      <div className="card-section">
        <h3 className="sys-subtitle">Outages</h3>
        {data.outages.length === 0 ? <p className="meta">No outage in this window.</p>
          : <Table<Outage> label="Outages" caption="Each time the record stopped, newest first" captionHidden rows={data.outages} rowKey={(row) => row.start} phone="list" columns={[
            { key: "start", header: "Start", rowHeader: true, cell: (row) => <LocalTime at={row.start} date /> },
            { key: "end", header: "End", cell: (row) => (row.end ? <LocalTime at={row.end} /> : "still open") },
            { key: "length", header: "Length", numeric: true, cell: (row) => (finite(row.duration_s) ? duration(row.duration_s) : "—") },
            { key: "reason", header: "Reason", cell: (row) => (row.reason ? <Coded family="data_gap_reason" code={row.reason} /> : "—") },
            { key: "status", header: "Recovered", cell: (row) => (row.status ? <Coded family="data_gap_status" code={row.status} /> : "—") },
          ]} />}
      </div>
      <div className="card-section">
        <h3 className="sys-subtitle">Replayed quarters</h3>
        {data.replayed.length === 0 ? <p className="meta">The gap log replayed nothing in this window.</p>
          : <Table<Replayed> label="Replayed quarters" caption="Each quarter hour the gap log replayed, newest first" captionHidden rows={data.replayed} rowKey={(row) => `${row.boot}:${row.qseq}`} phone="list" columns={[
            { key: "span", header: "Quarter", rowHeader: true, cell: (row) => <><LocalTime at={row.first_at} date />–<LocalTime at={row.last_at} /></> },
            { key: "received", header: "Received", cell: (row) => <LocalTime at={row.received_at} /> },
            { key: "climate", header: "Readings", numeric: true, cell: (row) => count(row.climate_rows) },
            { key: "transitions", header: "Relay changes", numeric: true, cell: (row) => count(row.transition_rows) },
          ]} />}
      </div>
    </>}
  </Panel>;
}

type Failing = Delivery["failing"][number];
type ByStatus = Delivery["by_status"][number];

/** The pushes by outcome as a plain bar list: each status in words, its count and a bar of its share. */
function OutcomeBars({ rows }: { rows: Delivery["by_status"] }) {
  const totals = statusTotals(rows);
  return <ul className="sys-bars" aria-label="Pushes by outcome">
    {totals.map((row) => <li key={row.status} className="sys-bar" data-status={row.status}>
      <span className="sys-bar-label"><Coded family="delivery_status" code={row.status} /></span>
      <span className="sys-bar-count">{count(row.count)}</span>
      <span className="sys-bar-track" aria-hidden="true"><span className="sys-bar-fill" ref={cssVars({ "--share": `${row.share.toFixed(2)}%` })} /></span>
    </li>)}
  </ul>;
}

export const settingEditHref = (param: string) => `/settings?edit=${encodeURIComponent(param)}`;

/**
 * Delivery (row 4): what the host pushed over 24 h or 7 d (`?hours=`) by outcome, the oldest value still unconfirmed,
 * time to confirm, the settings whose pushes failed (each linking to its drawer on Settings) and the last readback pass.
 */
export function DeliveryPanel({ read, hours }: { read: PanelRead<Delivery>; hours: DeliveryHours }) {
  const [params] = useSearchParams();
  const data = read.data;
  const href = (value: number) => {
    const next = new URLSearchParams(params);
    next.set("hours", String(value));
    return `?${next.toString()}`;
  };
  const waiting = finite(data?.oldest_unconfirmed_s) && data.oldest_unconfirmed_s > 0;
  return <Panel id="delivery" title="Delivery" thing="delivery" state={hostState(read)} reserve="lg" observedAt={data?.to} onRetry={read.retry}
    tone={data && (data.failing.length > 0 || waiting) ? "warn" : undefined}
    actions={<Segmented label="Range" size="sm" value={String(hours)} segments={DELIVERY_HOURS.map((value) => ({ value: String(value), label: value === 24 ? "24 h" : "7 d", to: href(value), keepScroll: true }))} />}>
    {data && <>
      <DataList items={[
        { key: "oldest", term: "Oldest unconfirmed", value: oldestWords(data.oldest_unconfirmed_s) },
        { key: "p50", term: "Time to confirm, median", value: finite(data.latency.p50_s) ? formatValue(data.latency.p50_s, "s") : null, reason: "none confirmed" },
        { key: "p95", term: "Time to confirm, 95th", value: finite(data.latency.p95_s) ? formatValue(data.latency.p95_s, "s") : null, reason: "none confirmed" },
        { key: "confirmed", term: "Confirmed", value: count(data.latency.confirmed) },
        { key: "pass", term: "Last readback pass", value: data.readback_pass.at ? <><LocalTime at={data.readback_pass.at} />: {readbackWords(data.readback_pass)}</> : null, reason: "not reported" },
        { key: "stage", term: "Dispatcher", value: data.dispatcher_stage ? <code className="sys-raw">{data.dispatcher_stage}</code> : null, reason: "not reported" },
      ]} />
      <div className="card-section">
        <h3 className="sys-subtitle">Outcomes</h3>
        {data.by_status.length === 0 ? <p className="meta">Nothing was pushed in this window.</p> : <>
          <OutcomeBars rows={data.by_status} />
          <Table<ByStatus> label="Pushes by source and outcome" caption="Pushes by who sent them and how they ended" captionHidden rows={data.by_status}
            rowKey={(row) => `${row.source}:${row.status}`} phone="list" columns={[
              { key: "source", header: "Sent by", rowHeader: true, cell: (row) => <Coded family="delivery_source" code={row.source} /> },
              { key: "status", header: "Outcome", cell: (row) => <Coded family="delivery_status" code={row.status} /> },
              { key: "count", header: "Pushes", numeric: true, cell: (row) => count(row.count) },
            ]} />
        </>}
      </div>
      <div className="card-section">
        <h3 className="sys-subtitle">Settings not taken</h3>
        {data.failing.length === 0 ? <p className="meta">No push failed in this window.</p>
          : <Table<Failing> label="Settings whose pushes failed" caption="Settings whose pushes failed, worst first" captionHidden rows={data.failing} rowKey={(row) => row.param} phone="list" columns={[
            { key: "setting", header: "Setting", rowHeader: true, cell: (row) => <Link to={settingEditHref(row.param)}>{row.label}</Link> },
            { key: "failed", header: "Failed", numeric: true, cell: (row) => count(row.failed) },
            { key: "last", header: "Last failed", cell: (row) => <LocalTime at={row.last_failed_at} date /> },
            { key: "confirmed", header: "Last confirmed", cell: (row) => (row.last_confirmed_at ? <LocalTime at={row.last_confirmed_at} date /> : "not in this window") },
          ]} />}
      </div>
    </>}
  </Panel>;
}

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
            : <ul className="sys-plain-list">{rejected.map(([table, rows]) => <li key={table}>{tableWords(table) ?? <code className="sys-raw">{table}</code>}: {count(rows)}</li>)}</ul>}
        </>}
    </Details>
  </section>;
}
