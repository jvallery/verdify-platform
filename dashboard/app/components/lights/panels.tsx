// SPDX-License-Identifier: MIT
/**
 * The blocks of Lights (screens section 4.1): each circuit, By hand, How they are switched, the settings and the last
 * seven days. Every block is a `Panel` with its four states; a viewer sees every read and no write control.
 */
import { Link } from "react-router";
import { DailyBars } from "../../charts/daily-bars";
import { ChartGroup } from "../../charts/legend";
import { formatValue, leftWords, shortTime } from "../../lib/format";
import type { LightingCircuit, Setting } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { Badge, StatusBadge } from "../badge";
import { StatusIcon } from "../banner";
import { Kv } from "../kv";
import { EmptyState, Panel, type PanelState } from "../panel";
import { Segmented } from "../segmented";
import { LightButtons, manualUntil, type LightControl } from "../equipment/light-controls";
import {
  CIRCUITS, HAND_MINUTES, circuitSettings, completeMean, hasLightSettings, intentWords, minutesOnDays, mismatch, settingHref, stateWord, switchCheck, switchStale, todayOf, windowText,
  type Circuit, type HandMinutes, type LightItem,
} from "./model";

/** A read's panel state: the skeleton until it first answers, its error with Retry, then `ready`. */
export function readState(read: Pick<PanelRead<unknown>, "data" | "failed" | "pending">): PanelState {
  if (read.data !== null) return "ready";
  if (read.failed) return "error";
  return "loading";
}

// ---------------------------------------------------------------------------------------------------- a circuit
/**
 * One circuit (L-01, L-04, L-08): on or off as the switch reports it, what the controller wants and why, a mismatch
 * called out, the timer, and today's window and time on (API-22, or API-13's run time until it answers).
 */
export function CircuitPanel({ circuit, item, equipment, today, now }: {
  circuit: Circuit; item: LightItem | undefined; equipment: PanelRead<unknown>; today: LightingCircuit | null; now: number;
}) {
  const base = readState(equipment);
  const state: PanelState = base !== "ready" ? base : !item ? "empty" : switchStale(item, now) ? "stale" : "ready";
  const day = todayOf(today);
  const until = item ? manualUntil(item) : null;
  const differ = item ? mismatch(item) : null;
  const onSeconds = day?.on_s ?? item?.runtime_today_s ?? null;
  const starts = day?.starts ?? item?.cycles_today ?? null;
  return <Panel title={circuit.name} thing={`the ${circuit.name.toLowerCase()}`} state={state} onRetry={equipment.retry} observedAt={item?.observed_at ?? null}
    pill={item && <Badge kind={item.state === "on" ? "on" : item.state === "off" ? "off" : "unknown"} />}
    empty={<EmptyState message={`The ${circuit.name.toLowerCase()} is not reported.`} />}>
    {item && <div className="lights-circuit" data-light={circuit.light}>
      <p className="lights-answer">{item.state === "on" || item.state === "off"
        ? <>The switch reports it <strong>{item.state}</strong>{item.since ? <> since {shortTime(item.since)}</> : null}.</>
        : <>The switch has <strong>not reported</strong> whether it is on.</>}</p>
      <p className="lights-intent" data-light-reason={item.auto_reason ?? undefined}>{intentWords(item)}.</p>
      {differ && <p className={`lights-mismatch lights-mismatch-${differ.tone}`} role="note"><StatusIcon tone={differ.tone} className="banner-icon" />{differ.text}</p>}
      {until !== null && <p className="lights-timer" data-light-until="">By hand until {shortTime(until)}{leftWords(until, now) ? ` (${leftWords(until, now)})` : ""}, then back to automatic.</p>}
      <div className="card-section">
        <h3 className="eyebrow">Today</h3>
        <Kv className="lights-today" items={[
          { key: "window", term: "Light window", value: windowText(day), reason: "not reported" },
          { key: "on", term: "Time on", value: onSeconds === null ? null : `${formatValue(Math.round(onSeconds / 60), "min")}${day?.partial ? " so far" : ""}`, reason: "not reported" },
          { key: "starts", term: "Starts", value: starts === null ? null : String(starts), reason: "not reported" },
        ]} />
      </div>
    </div>}
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- by hand
/**
 * By hand (L-02, L-03): one length for both lights (15 minutes, up to 120), then each light's buttons, which turn it on
 * or off for that long, show the time left, and take it Back to automatic. Operators only: the caller renders it inside
 * `OperatorOnly`.
 */
export function ByHandPanel({ controls, items, equipment, minutes, setMinutes, now }: {
  controls: readonly LightControl[]; items: readonly (LightItem | undefined)[]; equipment: PanelRead<unknown>; minutes: HandMinutes; setMinutes: (minutes: HandMinutes) => void; now: number;
}) {
  const state = readState(equipment);
  return <Panel title="By hand" thing="the lights" state={state} onRetry={equipment.retry}
    foot="When the time is up, each light goes back to what the controller wants.">
    <div className="lights-hand">
      <Segmented label="How long" size="sm" value={String(minutes)} onChange={(value) => setMinutes(Number(value) as HandMinutes)}
        segments={HAND_MINUTES.map((value) => ({ value: String(value), label: value < 60 ? `${value} min` : `${value / 60} h` }))} />
      <div className="l-cols-2">
        {CIRCUITS.map((circuit, index) => {
          const item = items[index];
          const until = item ? manualUntil(item) : null;
          return <section key={circuit.light} className="lights-hand-row" aria-label={`${circuit.name} by hand`}>
            <h3>{circuit.name} <span className="meta">{stateWord(item?.state)}</span></h3>
            <p className="meta">{until !== null ? `By hand until ${shortTime(until)}${leftWords(until, now) ? `, ${leftWords(until, now)}` : ""}` : "Automatic"}</p>
            {item ? <LightButtons control={controls[index]} item={{ ...item, label: circuit.name }} minutes={minutes} />
              : <p className="meta">Not reported, so it cannot be switched from here.</p>}
          </section>;
        })}
      </div>
    </div>
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- how they are switched
/** How they are switched (L-09): through Home Assistant, what happens when it is down, and whether each switch confirmed. */
export function SwitchingPanel({ items, equipment, now }: { items: readonly (LightItem | undefined)[]; equipment: PanelRead<unknown>; now: number }) {
  const state = readState(equipment);
  return <Panel title="How they are switched" thing="the switches" state={state} onRetry={equipment.retry}>
    <p>The controller decides; Home Assistant switches the Lutron switches. If Home Assistant or the network is down, the lights stay as they are until it is back.</p>
    <ul className="lights-checks">
      {CIRCUITS.map((circuit, index) => {
        const check = switchCheck(items[index], now);
        return <li key={circuit.light} data-light={circuit.light}>
          <span className="lights-check-head">{circuit.name} <StatusBadge status={check.status} size="sm">{check.label}</StatusBadge></span>
          <span className="meta">{check.text}</span>
        </li>;
      })}
    </ul>
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- settings
const PENDING: Readonly<Record<string, "requested" | "not_confirmed" | "held">> = { requested: "requested", not_confirmed: "not_confirmed", held: "held" };

/** The twelve settings of each circuit (L-05, L-06) in four groups; each row opens that setting's drawer on Settings. */
export function SettingsPanel({ items, read }: { items: readonly Setting[] | null; read: PanelRead<unknown> }) {
  const base = readState(read);
  const state: PanelState = base === "ready" && !hasLightSettings(items) ? "empty" : base;
  return <Panel title="Settings" thing="the light settings" state={state} onRetry={read.retry} link={{ to: "/settings", label: "All settings" }}
    empty={<EmptyState message="The light settings are not served." />}
    foot="Values as the controller reports them. Open a setting to see its history or change it.">
    <div className="l-cols-2 lights-settings">
      {CIRCUITS.map((circuit) => <section key={circuit.light} aria-label={`${circuit.name} settings`}>
        <h3>{circuit.name}</h3>
        {circuitSettings(circuit.light, items).map(({ group, rows }) => <div key={group.key} className="lights-setting-group">
          <h4 className="eyebrow">{group.title}</h4>
          <ul className="lights-setting-rows">
            {rows.map((row) => <li key={row.param}>
              <Link to={settingHref(row.param)} className="lights-setting" data-param={row.param}>
                <span className="lights-setting-label">{row.label}</span>
                <span className="lights-setting-value">{row.value}{row.state && Object.hasOwn(PENDING, row.state) && <> <Badge kind={PENDING[row.state]} size="sm" /></>}</span>
              </Link>
            </li>)}
          </ul>
        </div>)}
      </section>)}
    </div>
  </Panel>;
}

// ---------------------------------------------------------------------------------------------------- the last 7 days
/** The last 7 days (L-07): minutes on per day for each circuit as daily bars, today drawn lighter as "so far". */
export function WeekPanel({ circuits, read }: { circuits: readonly (LightingCircuit | null)[]; read: PanelRead<unknown> }) {
  const base = readState(read);
  const state: PanelState = base === "ready" && circuits.every((circuit) => !circuit || circuit.days.length === 0) ? "empty" : base;
  return <Panel title="Last 7 days" thing="the light days" state={state} onRetry={read.retry} reserve="lg" link={{ to: "/lights/history", label: "Light history" }}
    empty={<EmptyState message="No light days are recorded for this week." />}
    foot="Time on as the switch reports it. A day with no record is a gap.">
    {/* The two circuits' charts are small multiples: one key above them (design review A3). */}
    <ChartGroup label="Time on per day">
      <div className="l-cols-2">
        {CIRCUITS.map((circuit, index) => {
          const days = minutesOnDays(circuits[index]);
          return <DailyBars key={circuit.light} title={`${circuit.name}: time on per day`} unit="min" token={circuit.token} days={days} mean7={completeMean(days)}
            format={(value) => formatValue(value, "min")} size="sm" syncKey="lights:week" />;
        })}
      </div>
    </ChartGroup>
  </Panel>;
}
