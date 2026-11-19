// SPDX-License-Identifier: MIT
import { Component, useId, type ReactNode } from "react";
import { Link } from "react-router";
import { duration } from "../lib/format";
import { useApiDown } from "../lib/session";
import { Badge } from "./badge";
import { Button } from "./button";
import { LocalTime, cls } from "./common";
import { EmptyState } from "./empty-state";
import { AgeLabel, FreshnessDot } from "./freshness";
import { Chevron } from "./layout/chevron";
import { Skeleton } from "./skeleton";
import { reasonParts } from "./state-reason-line";

export { EmptyState } from "./empty-state";

/**
 * What a panel shows (screens §1.5). `loading` is the first fetch only: while a refetch runs, pass the state of the
 * data already shown, so the old render stays. A viewer has no state of its own: write controls render only inside
 * `<OperatorOnly>`, so a viewer's panel simply has none.
 */
export type PanelState = "ready" | "loading" | "empty" | "stale" | "ingestor_down" | "controller_not_reporting" | "error" | "busy";
const DEVICE_STALE: readonly PanelState[] = ["stale", "ingestor_down", "controller_not_reporting"];

/** "Couldn't load runs." with Retry, in the failing panel only: a critical soft box, one sentence and one action. */
export function PanelError({ thing, text, onRetry }: { thing: string; text?: ReactNode; onRetry?: () => void }) {
  return <div className="panel-error"><p className="fault">{text ?? `Couldn't load ${thing}.`}</p>{onRetry && <Button onClick={onRetry}>Retry</Button>}</div>;
}

/** Catches a render failure inside one panel, so the other panels keep working. Retry renders it again. */
export class PanelErrorBoundary extends Component<{ thing: string; text?: ReactNode; onRetry?: () => void; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  retry = () => { this.setState({ failed: false }); this.props.onRetry?.(); };
  render() {
    return this.state.failed ? <PanelError thing={this.props.thing} text={this.props.text} onRetry={this.retry} /> : this.props.children;
  }
}

function ReasonSince({ code, since }: { code: "writer_down" | "controller_not_reporting"; since: string | null | undefined }) {
  return <span>{reasonParts({ code, since }).map((part, index) => (typeof part === "string" ? part : <LocalTime key={index} at={part.time} />))}</span>;
}

/** The "All … ›" link at a card head's right (redesign §3.5, §4.1). */
export type HeadLink = {
  readonly to: string;
  readonly label: ReactNode;
  /**
   * The link's whole name as `aria-label`, where its label carries a hidden suffix that starts with punctuation ("Why" +
   * ": the climate law"): a browser names it with a space before the hidden span ("Why : the climate law").
   */
  readonly name?: string;
};
/** The head's right side: the as-of time, the actions, then the "All … ›" link, then the ⋯ menu. */
export function HeadEnd({ asOf, actions, link, menu }: { asOf?: ReactNode; actions?: ReactNode; link?: HeadLink; menu?: ReactNode }) {
  if (!asOf && !actions && !link && !menu) return null;
  return <div className="card-head-end">{asOf && <span className="card-asof">{asOf}</span>}{actions}{link && <Link className="card-link-all" to={link.to} aria-label={link.name}>{link.label}<Chevron /></Link>}{menu}</div>;
}

export type PanelProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  headingLevel?: 2 | 3;
  id?: string;
  /** The panel's own controls, beside the heading. */
  actions?: ReactNode;
  /** The one state pill of the head (redesign §4.4, D-UX-07), after the title. */
  pill?: ReactNode;
  /** "All alerts ›" at the head's right. */
  link?: HeadLink;
  /** The ⋯ `Menu`, last in the head. */
  menu?: ReactNode;
  /** Abnormal: a 3 px `--warn` or `--critical` rule at the left edge; the surface stays calm. Dropped while the API is down. */
  tone?: "warn" | "fault";
  /** The foot: a `.meta` line (source, age, resolution) or a "Details ›" link, shown with the data. */
  foot?: ReactNode;
  /** What the panel loads, for "Couldn't load <thing>." and the empty default ("No <thing>."). */
  thing: string;
  state: PanelState;
  /** The skeleton's reserved height while loading. */
  reserve?: "sm" | "md" | "lg";
  /**
   * When the panel's newest data was observed: a stale panel shows "Last data N min ago (HH:MM)", and a ready or busy
   * one "Updated N s ago" when `age` is "always".
   */
  observedAt?: string | null;
  /**
   * One observation time a page (A2): the page header states how fresh the page is, so a ready or busy panel shows no
   * "Updated" line ("auto", the default). "always" shows it, for a panel whose live read (a relay, a probe, the
   * controller) is not the header's. Panels of daily or historical data never pass it. Stale, not reporting and failed
   * panels say so either way.
   */
  age?: "auto" | "always";
  /** ingestor_down: the newest heartbeat; controller_not_reporting: the newest climate row. */
  since?: string | null;
  /** busy: the `Retry-After` seconds. */
  retryInS?: number | null;
  /** error, and the boundary's Retry. */
  onRetry?: () => void;
  /** Replaces "Couldn't load <thing>." (an alert list reads "Alerts unavailable."). */
  errorText?: ReactNode;
  /** empty: what would appear here (`EmptyState`). */
  empty?: ReactNode;
  children?: ReactNode;
};

/**
 * A card that loads one thing and says honestly how it is: a skeleton at its reserved height while loading; its age
 * when ready only where asked (`age`); the empty words; STALE with "Last data N min ago (HH:MM)" and no verdict; the ingestor or controller
 * line with device values STALE; its own error and Retry; "Busy, retrying in N s" over the old render. A render
 * failure inside stays here. Its head (redesign §4.1) holds the eyebrow, the title with at most one pill, then the
 * actions, an "All … ›" link and the ⋯ menu; an abnormal panel has a 3 px rule on its left, and its foot a meta line.
 */
export function Panel({ title, eyebrow, headingLevel = 2, id, actions, pill, link, menu, tone, foot, thing, state, reserve = "md", observedAt, age: showAge = "auto", since, retryInS, onRetry, errorText, empty, children }: PanelProps) {
  const headingId = useId();
  const apiDown = useApiDown();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const stale = DEVICE_STALE.includes(state);
  // The words are separate elements in a flex row; the spaces keep them apart for a screen reader too.
  const age = observedAt === undefined || showAge !== "always" ? null : <><FreshnessDot stale={false} /><AgeLabel observedAt={observedAt} stale={false} /></>;
  const line = state === "stale" ? <><FreshnessDot stale /><Badge kind="stale" /> <AgeLabel observedAt={observedAt} stale /></>
    : state === "ingestor_down" || state === "controller_not_reporting" ? <><FreshnessDot stale notReporting /><Badge kind="stale" /> <ReasonSince code={state === "ingestor_down" ? "writer_down" : "controller_not_reporting"} since={since} /></>
    : state === "busy" ? <><span>Busy, retrying {retryInS !== null && retryInS !== undefined && Number.isFinite(retryInS) ? <>in {duration(Math.max(0, retryInS))}</> : "shortly"}</span>{age && <> {age}</>}</>
    : state === "ready" ? age
    : null;
  const body = state === "loading" ? <Skeleton size={reserve} label={thing} />
    : state === "error" ? <PanelError thing={thing} text={errorText} onRetry={onRetry} />
    : state === "empty" ? empty ?? <EmptyState message={`No ${thing}.`} />
    : <PanelErrorBoundary thing={thing} text={errorText} onRetry={onRetry}>{stale ? <div className="panel-muted">{children}</div> : children}</PanelErrorBoundary>;
  return <section id={id} className={cls("card", "panel", tone && !apiDown && `tone-${tone}`)} aria-labelledby={headingId} aria-busy={state === "loading" || undefined} data-state={state}>
    <div className="card-head">
      <div className="card-title">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<div className="card-title-row"><Heading id={headingId}>{title}</Heading>{pill}</div></div>
      <HeadEnd actions={actions} link={link} menu={menu} />
    </div>
    {line && <p className="panel-state">{line}</p>}
    {body}
    {foot && (state === "ready" || state === "busy" || DEVICE_STALE.includes(state)) && <div className="card-foot meta">{foot}</div>}
  </section>;
}
