// SPDX-License-Identifier: MIT
import { useId } from "react";
import { lineDisplayName } from "../../lib/lines";
import type { IrrigationLine, IrrigationStatus, Schedule } from "../../lib/operator-api";
import { OperatorOnly, useApiDown } from "../../lib/session";
import { ZONE_CARD_WORDS, ZONE_KIND_WORDS, amountShort, dayClockWords, nextRunShort, vpdTodayWords, zoneLastAt, type ZoneSummary } from "../../lib/water";
import { cls } from "../common";
import { LineCard } from "../line-card";
import { LineEnable } from "../line-enable";
import { Menu } from "../menu";
import { MisterControls } from "../mister-association";
import { MinutesMeter } from "../schedule/day-timeline";
import type { DayBlock, LaneEpisode } from "../schedule/model";
import { DayStrip } from "./day-strip";

/** Today's window for the strips, and each line's blocks and valve episodes on it (`dayModel`); null before API-IRR-02 answers. */
export type TodayStrips = {
  readonly from: number;
  readonly to: number;
  readonly night: readonly { from: number; to: number }[];
  readonly byLine: ReadonlyMap<string, { readonly blocks: readonly DayBlock[]; readonly episodes: readonly LaneEpisode[]; readonly valveKnown: boolean }>;
};

const tokenOf = (kind: string) => (kind === "mister" ? "mister" : kind === "fert_drip" || kind === "fert_mister" ? "fert" : kind === "fog" ? "fog" : "water");

export type ZoneCardProps = {
  summary: ZoneSummary;
  status: Pick<IrrigationStatus, "engine" | "program"> & Partial<Pick<IrrigationStatus, "limits">>;
  today: string;
  /** Epoch ms. */
  now: number;
  strips: TodayStrips | null;
  /** API-IRR-02's schedules, for "Running · schedule · Wall MWF" and the next run's amount. */
  schedules: readonly Schedule[];
};

/** A card's kind, for its coloured edge (#1349): drip, mister or fog. */
export const zoneKind = (zone: string): "drip" | "mister" | "fog" => (zone === "fog" ? "fog" : zone === "wall" || zone === "center" ? "drip" : "mister");

/**
 * A row's visible name inside its zone card (design review C2): the zone already names the physical line, so its relays
 * read "Clean line" and "Fertilized line"; a line whose own name differs from the zone's keeps it; fog's one line reads
 * "Fog line".
 */
export function lineShortName(line: Pick<IrrigationLine, "line_id" | "kind"> & Partial<Pick<IrrigationLine, "name">>, zoneName: string): string {
  const name = lineDisplayName(line);
  if (line.kind === "fog") return "Fog line";
  if (name === zoneName) return "Clean line";
  if (name === `${zoneName} (fertilized)`) return "Fertilized line";
  return name;
}

/** A zone whose every line is reserved (no valve installed) and not running: one quiet row, never cards (design review C2). */
export const reservedZone = (lines: readonly Pick<IrrigationLine, "reserved" | "enabled" | "state">[]): boolean =>
  lines.length > 0 && lines.every((line) => line.reserved === true && line.enabled === false && line.state.code !== "running");

/** Something to draw on a line's today strip: a run scheduled today (a fallback window included) or the valve open today. */
export const stripHasDay = (own: { readonly blocks: readonly Pick<DayBlock, "part">[]; readonly episodes: readonly unknown[] } | undefined): boolean =>
  own !== undefined && (own.blocks.some((block) => block.part === "run") || own.episodes.length > 0);

/**
 * A physical line's card on Water → Today (redesign §5.2, #1336, #1349, design review C2): a coloured edge by kind, the
 * zone's name, its minutes today against the cap line's daily cap (planned minutes dashed) and when it last watered,
 * "running now" while one of its lines runs; then its relays as rows of the zone, indented ("Clean line", "Fertilized
 * line"), L03 under L02, the clean mister's row holding VPD control and Schedule (#1344), and "Fertilized line: not wired"
 * for a variant with no relay. A row's today strip shows only when something is scheduled or ran today; otherwise the
 * row says "Nothing scheduled today" with its next run, on one line. A line that is off is one quiet row, and a zone whose
 * lines are all reserved is one quiet row with no cards ("Center drip: reserved, not installed"), its ⋯ holding only the
 * switches that enable a line once it is installed (operators). The order never changes with state.
 */
export function ZoneCard({ summary, status, today, now, strips, schedules }: ZoneCardProps) {
  const headingId = useId();
  const apiDown = useApiDown();
  const { zone, lines, master, mister, minutes, planned, cap, capLine, reserve, running, unwired } = summary;
  const name = ZONE_CARD_WORDS[zone];
  // The zone's minutes count every purpose (the cap does); its mister's VPD misting is said apart (#1348).
  const vpd = vpdTodayWords(mister?.today);
  // Today's valve starts (API-05) stand in for a `last_water` the API has not filed yet once today's minutes are above 0.
  const lastAt = zoneLastAt(summary, lines.flatMap((line) => strips?.byLine.get(line.line_id)?.episodes.map((episode) => episode.start) ?? []), today);
  const labels = new Map(schedules.flatMap((schedule) => (schedule.label ? [[schedule.slot_id, schedule.label] as const] : [])));
  const bySlot = new Map(schedules.map((schedule) => [schedule.slot_id, schedule]));
  if (reservedZone(lines) && status.engine) {
    return <section className={cls("wat-zone", "water-line-section", "is-off", "is-reserved")} data-zone={zone} data-kind={zoneKind(zone)} aria-labelledby={headingId}>
      <div className="wat-zone-reserved">
        <h3 id={headingId} className="wat-zone-name">{name}<span className="wat-zone-kind">: reserved, not installed</span></h3>
        <OperatorOnly><Menu name={`More for ${name}`}>
          {lines.map((line) => <div key={line.line_id} className="wat-menu-switch" data-menu-keep=""><LineEnable line={line} /></div>)}
        </Menu></OperatorOnly>
      </div>
    </section>;
  }
  const amountOf = (line: IrrigationLine) => {
    const schedule = line.next_run ? bySlot.get(line.next_run.slot_id) : undefined;
    return schedule ? amountShort(schedule, line.kind) : null;
  };
  const nextOf = (line: IrrigationLine) => (status.engine && line.kind !== "fog" ? nextRunShort(line.next_run, today, amountOf(line)) : undefined);
  // The hour ticks ride on the zone's first strip that draws.
  const axisLine = lines.find((line) => stripHasDay(strips?.byLine.get(line.line_id)))?.line_id ?? null;
  const strip = (line: IrrigationLine) => {
    const own = strips?.byLine.get(line.line_id);
    if (!strips || !own) return null;
    const next = nextOf(line);
    if (!stripHasDay(own)) {
      return <p className="meta wat-day-none" data-line={line.line_id}>Nothing scheduled today{next ? <> · {next}</> : null}</p>;
    }
    return <DayStrip name={lineDisplayName(line)} from={strips.from} to={strips.to} night={strips.night} blocks={own.blocks} episodes={own.episodes} valveKnown={own.valveKnown} now={now}
      token={tokenOf(line.kind)} axis={line.line_id === axisLine} next={next} />;
  };
  const off = zone !== "fog" && lines.length > 0 && lines.every((line) => line.enabled === false) && !running;
  return <section className={cls("wat-zone", "water-line-section", off && "is-off", apiDown && "is-neutral")} data-zone={zone} data-kind={zoneKind(zone)} aria-labelledby={headingId}>
    <div className="wat-zone-head">
      <h3 id={headingId} className="wat-zone-name">{name}{(off || ZONE_KIND_WORDS[zone]) && <span className="wat-zone-kind">{off ? "off" : ZONE_KIND_WORDS[zone]}</span>}</h3>
      <div className="wat-zone-today" data-limit={capLine ?? undefined}>
        {cap !== null
          ? <MinutesMeter label={`${name} minutes today`} done={minutes} planned={planned ?? 0} cap={cap} kind={mister?.kind ?? lines[0]?.kind ?? "drip"} />
          : <span className="wat-zone-minutes">{minutes === null ? "—" : `${Math.round(minutes)}\u00a0min`} today</span>}
        {vpd && <span className="meta wat-zone-vpd" data-water="vpd">{vpd}</span>}
        <span className="meta wat-zone-last">{reserve !== null && <>{reserve}{"\u00a0"}min kept for VPD · </>}{running ? <span className="wat-zone-running">running now</span>
          : lastAt ? <>last <time dateTime={lastAt}>{dayClockWords(lastAt, today)}</time></> : "no water recorded"}</span>
      </div>
    </div>
    <div className="wat-zone-lines">
      {lines.map((line) => <LineCard key={line.line_id} line={line} master={line.line_id === "L02" ? master : null} engine={status.engine} program={status.program}
        today={today} scheduleLabels={labels} strip={strip(line)} shortName={lineShortName(line, name)} controls={line === mister ? <MisterControls line={line} status={status} /> : undefined} />)}
      {unwired.map((variant) => <p key={variant} className="meta wat-unwired" data-variant={variant}>{variant === "clean" ? "Clean line" : "Fertilized line"}: not wired</p>)}
    </div>
  </section>;
}
