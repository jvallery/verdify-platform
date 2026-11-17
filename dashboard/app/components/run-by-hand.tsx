// SPDX-License-Identifier: MIT
/**
 * Run by hand (dashboard v2 screens §1 block 5, and Equipment): the three timed runs the controller takes over from the
 * climate law for a while, each one API-IRR-12 `{kind, minutes}` with no dialog:
 * - Run the fans: both fans with the vent open, 15 min (`fans`).
 * - Humidify: the fogger, 5 min (`humidify`).
 * - Circulate: the fans with the vent closed, 10 min (`vent_bypass`).
 * What runs is only ever the controller's readback (API-02 `overrides`), never the command: a running run shows its
 * time left and Stop (API-IRR-12 `{kind: "clear"}`, which ends every run by hand). A protection limit (the law's hot
 * and cold limits) ends any run; while the controller has no temperature reading a fan run is capped at 15 minutes, and
 * the panel says so. It reads the law (API-02 `law`, API-30), never a mode label.
 *
 * Operators press; viewers read what runs and see no control. With changes switched off the buttons are disabled
 * (`Button write`). Before the irrigation firmware API-IRR-12 answers 503, so the panel says when runs arrive instead;
 * the engine flag is API-IRR-01's alone, and until it answers nothing is offered.
 *
 * Exports for the system lane (Equipment and Controller): `RunByHand` (the panel, with an optional `children` slot under
 * the runs, where Now puts the two lights) and `RestartController`.
 */
import { useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatValue, leftWords } from "../lib/format";
import type { BodyOf, Now, ParamsOf } from "../lib/operator-api";
import { READ_INTERVAL_MS, panelRead, useApiRead, useLawRead } from "../lib/queries";
import { OperatorOnly } from "../lib/session";
import { useShellNow, useShellStatus } from "../lib/shell";
import { hasWords, words } from "../lib/words";
import { newestNow, readback, useCommand, type CommandPhase, type Readback } from "../lib/writes";
import { Button } from "./button";
import { useNow } from "./freshness";
import { Panel, PanelError, type PanelState } from "./panel";

export type RunKind = "fans" | "humidify" | "vent_bypass";
/** The three runs by hand, in the order the panel lists them. */
export const RUNS: readonly { readonly kind: RunKind; readonly minutes: number; readonly name: string; readonly what: string }[] = [
  { kind: "fans", minutes: 15, name: words("run_by_hand", "fans"), what: "Both fans, vent open" },
  { kind: "humidify", minutes: 5, name: words("run_by_hand", "humidify"), what: "The fogger" },
  { kind: "vent_bypass", minutes: 10, name: words("run_by_hand", "vent_bypass"), what: "Both fans, vent closed" },
];
export const RUN_NAMES: Readonly<Record<string, string>> = Object.fromEntries(RUNS.map((run) => [run.kind, run.name]));
export const RUNS_ARRIVE_TEXT = "Runs by hand arrive with the irrigation firmware";
export const RESTART_SENT_TEXT = "Restart sent";
export const NOTHING_BY_HAND = "Nothing is running by hand.";
export const RUNS_UNKNOWN = "What runs by hand is not known: no current controller report.";
export const ENGINE_UNKNOWN = "Can't tell whether the controller has the irrigation firmware yet.";
export const FAN_CAP_TEXT = "No temperature reading: a fan run stops after 15 minutes.";
/** The law's protection limits when API-30 has not said them (`LawTiming`). */
const HOT_LIMIT_F = 100;
const COLD_LIMIT_F = 40;
/** The controller's uptime resets within this long of a restart. */
export const RESTART_WINDOW_MS = 180_000;

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const whole = (value: number) => formatValue(value, "°F").replace(".0", "");

/** "The hot limit (100 °F) and the cold limit (40 °F) end any run by hand." */
export function limitText(timing: { readonly hot_limit_f?: number | null; readonly cold_limit_f?: number | null } | null | undefined): string {
  const hot = finite(timing?.hot_limit_f) ? timing.hot_limit_f : HOT_LIMIT_F;
  const cold = finite(timing?.cold_limit_f) ? timing.cold_limit_f : COLD_LIMIT_F;
  return `The hot limit (${whole(hot)}) and the cold limit (${whole(cold)}) end any run by hand.`;
}

/**
 * The controller has no temperature reading: the law refuses drying with `no_temperature` (API-02 `law` or API-30), or
 * API-02 serves no indoor temperature. Only then is a fan run capped at 15 minutes.
 */
export function noTemperature(now: Pick<Now, "law" | "indoor"> | null | undefined, lawRefusal: string | null | undefined): boolean {
  if (lawRefusal === "no_temperature" || now?.law?.drying_refused_reason === "no_temperature") return true;
  return now ? !finite(now.indoor.temp_f.value) : false;
}

/** Why the controller holds a run off, mid-sentence: the words table's line in lower case; an unknown code raw. */
function heldWords(code: string): string {
  const text = words("fog_block_reason", code);
  return hasWords("fog_block_reason", code) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
/** One running run in words: "Run the fans · 12 min left", the name alone with no end, or "Humidify held off: someone inside". */
export function runWords(run: Now["overrides"][number], clock: number): string {
  const name = RUN_NAMES[run.kind] ?? run.kind;
  if (run.held_reason) return `${name} held off: ${heldWords(run.held_reason)}`;
  const left = leftWords(run.ends_at, clock);
  return left ? `${name} · ${left}` : name;
}

/** A run's readback is its flag on in API-02 `overrides`; Stop's is none left on. */
export function overrideReadback(_params: ParamsOf<"API-IRR-12">, body: BodyOf<"API-IRR-12">): Readback | null {
  if (body.kind === "clear") return readback({ operationId: "API-02", done: (now) => now.overrides.length === 0, reason: () => "The controller still reports a run by hand" });
  return readback({ operationId: "API-02", done: (now) => now.overrides.some((run) => run.kind === body.kind) });
}
/** One run's command (or Stop's): API-IRR-12 with its readback, one request per press. */
export function useRunCommand() {
  return useCommand({ operation: "API-IRR-12", readback: overrideReadback });
}

/** What a command says after its 202: waiting on the readback, or within its window why nothing changed. */
export function CommandNote({ phase, message, error }: { phase: CommandPhase; message: string | null; error: { readonly message: string } | null }) {
  return <>
    {phase === "waiting" && <span className="state-note">Waiting for the controller</span>}
    {phase === "late" && <span className="state-note">{message}</span>}
    {error && <span className="field-error" role="alert">{error.message}</span>}
  </>;
}

/**
 * Restart controller: API-IRR-12 `{kind: "restart"}`. It reads "Restart sent" until API-02 `controller.uptime_s` drops
 * below its last read, the one held at the press included, within 3 min; with none held, until it reads under 3 min.
 */
export function RestartController() {
  const client = useQueryClient();
  const last = useRef<number | null>(null);
  const check = () => readback({
    operationId: "API-02", windowMs: RESTART_WINDOW_MS, reason: () => "The controller has not restarted",
    done: (now) => {
      const uptime = now.controller?.uptime_s;
      if (uptime === null || uptime === undefined) return false;
      const dropped = uptime < (last.current ?? RESTART_WINDOW_MS / 1000);
      last.current = uptime;
      return dropped;
    },
  });
  const command = useCommand({ operation: "API-IRR-12", readback: check });
  const press = () => {
    last.current = newestNow(client)?.controller?.uptime_s ?? null;
    void command.send({}, { kind: "restart" });
  };
  const waiting = command.phase === "waiting";
  return <div className="actions run-restart">
    <Button write wide busy={command.sending} disabled={waiting} onClick={press}>{waiting ? RESTART_SENT_TEXT : "Restart controller"}</Button>
    {command.phase === "done" && <span className="state-note">The controller restarted</span>}
    {command.phase === "late" && <span className="state-note">{command.message}</span>}
    {command.error && <span className="field-error" role="alert">{command.error.message}</span>}
  </div>;
}

/** Stop: API-IRR-12 `{kind: "clear"}`, which ends every run by hand. */
// The run buttons carry their whole name as aria-label as well as in a hidden span: a browser works a name out of the
// content with a space around the hidden span ("Run the fans , 15 min"), and the label is the name as it is written.
function StopRuns({ name, label = "Stop" }: { name?: string; label?: string }) {
  const command = useRunCommand();
  return <span className="run-stop">
    <Button write variant="stop" busy={command.sending} aria-label={name && !command.sending ? `${label}: ${name}` : undefined} onClick={() => void command.send({}, { kind: "clear" })}>{label}{name && <span className="screen-reader">{`: ${name}`}</span>}</Button>
    <CommandNote phase={command.phase} message={command.message} error={command.error} />
  </span>;
}
function StartRun({ run }: { run: (typeof RUNS)[number] }) {
  const command = useRunCommand();
  return <span className="run-start">
    <Button write busy={command.sending} aria-label={command.sending ? undefined : `${run.name}, ${run.minutes} min`} onClick={() => void command.send({}, { kind: run.kind, minutes: run.minutes })}>{run.name}<span className="screen-reader">, {run.minutes} min</span></Button>
    <CommandNote phase={command.phase} message={command.message} error={command.error} />
  </span>;
}

/**
 * What runs by hand, from the controller's readback alone: null while the page cannot vouch for it (no answer yet, a
 * failed read, the ingestor or the controller not reporting), never "none".
 */
function useRunning(): Now["overrides"] | null {
  const shell = useShellNow();
  const status = useShellStatus();
  const now = shell.data;
  if (!now || shell.error || status.ingestorRunning === false || status.controllerReporting === false) return null;
  return now.overrides;
}

function RunRow({ run, active, engine, clock }: { run: (typeof RUNS)[number]; active: Now["overrides"][number] | undefined; engine: boolean; clock: number }) {
  return <li className="run-row" data-run={run.kind} data-running={active ? "" : undefined}>
    <div className="run-what">
      <span className="run-name">{run.name}</span>
      <span className="meta">{run.what} · {run.minutes} min</span>
      {active && <span className="run-left" data-run-left="">{runWords(active, clock)}</span>}
    </div>
    {engine && <OperatorOnly>{active ? <StopRuns name={run.name} /> : <StartRun run={run} />}</OperatorOnly>}
  </li>;
}

export type RunByHandProps = {
  /** Under the runs: Now puts the two lights here. */
  readonly children?: ReactNode;
  readonly id?: string;
  readonly headingLevel?: 2 | 3;
};

export function RunByHand({ children, id = "run-by-hand", headingLevel = 2 }: RunByHandProps) {
  // The engine flag changes only with an OTA, so this reads the shared API-IRR-01 entry at the slow cadence.
  const irrigation = panelRead(useApiRead("API-IRR-01", {}, { intervalMs: READ_INTERVAL_MS.settings }));
  const law = panelRead(useLawRead());
  const shell = useShellNow();
  const running = useRunning();
  const clock = useNow();
  const engine = irrigation.failed ? null : irrigation.data?.engine ?? null;
  const failed = irrigation.failed && !irrigation.data;
  const state: PanelState = engine === null && !failed ? "loading" : "ready";
  const capped = noTemperature(shell.data, law.data?.drying.refused_reason ?? null);
  const known = running !== null;
  return <Panel id={id} title="Run by hand" headingLevel={headingLevel} thing="the runs by hand" state={state} reserve="sm">
    {/* A failed engine read offers no button, and what runs still shows. */}
    {failed && <PanelError thing="the runs by hand" text={ENGINE_UNKNOWN} onRetry={irrigation.retry} />}
    {engine === false && <p className="state-note" data-arrives="runs">{RUNS_ARRIVE_TEXT}</p>}
    <ul className="run-list">
      {RUNS.map((run) => <RunRow key={run.kind} run={run} engine={engine === true} clock={clock} active={running?.find((item) => item.kind === run.kind)} />)}
    </ul>
    {!known && <p className="state-note" data-runs="unknown">{RUNS_UNKNOWN}</p>}
    {/* While what runs is unknown, Stop stays: something may be running. */}
    {!known && engine === true && <OperatorOnly><StopRuns label="Stop every run by hand" /></OperatorOnly>}
    {known && running.length === 0 && <p className="meta" data-runs="none">{NOTHING_BY_HAND}</p>}
    {known && running.length > 1 && <p className="meta" data-runs="stop-all">Stop ends every run by hand.</p>}
    <p className="meta" data-runs="limits">{limitText(law.data?.timing)} When a run ends the controller goes back to the law.</p>
    {capped && <p className="fault" data-runs="no-temperature">{FAN_CAP_TEXT}</p>}
    {children}
  </Panel>;
}
