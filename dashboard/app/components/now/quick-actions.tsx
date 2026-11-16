// SPDX-License-Identifier: MIT
/** Immediate, time-limited operator actions; all commands retain shared readback and safety gates. */
import { Link } from "react-router";
import type { GlossaryId } from "../../lib/glossary";
import type { Equipment, IrrigationStatus, Setting } from "../../lib/operator-api";
import { useEquipmentRead, useSettingsRead, type PanelRead } from "../../lib/queries";
import { OperatorOnly } from "../../lib/session";
import { BURSTS, BURSTS_ARRIVE_TEXT, BurstButton, burstsIgnoredText } from "../burst-panel";
import { Button } from "../button";
import { LIGHTS, LightButtons, automationWords, lightsDiffer, manualUntil, manualUntilWords, useLightControl, type LightControl } from "../equipment/light-controls";
import { StopAllWater, type StopAllControl } from "../stop-all-water";
import { Term } from "../term";

const BURST_PURPOSE = {
  fans: { title: "Exchange air", detail: "Both fans on, vent open; both heaters stay off. Runs for 15 minutes." },
  humidify: { title: "Run the fogger", detail: "Fog on for 5 minutes. Water safeguards still apply." },
  vent_bypass: { title: "Circulate air", detail: "Both fans on, vent closed (house air); both heaters stay off. Runs for 10 minutes." },
} as const;

/** The shared burst button (Equipment's too): its name over its length on a phone, so three fit side by side. */
function QuickBurst({ burst }: { burst: (typeof BURSTS)[number] }) {
  const purpose = BURST_PURPOSE[burst.kind];
  return <div className="now-burst"><div><h4>{purpose.title}</h4><p className="meta">{purpose.detail}</p></div><BurstButton burst={burst} className="now-burst-button" label={`${purpose.title} · ${burst.minutes} min`} /></div>;
}

/** The bursts, or why they are not here yet: while the engine flag is unknown the row keeps its height. */
function Bursts({ irrigation, mode }: { irrigation: PanelRead<IrrigationStatus>; mode: string | null }) {
  if (irrigation.failed && !irrigation.data) {
    return <p className="meta now-actions-note">Can't tell whether the controller has the irrigation firmware yet. <Button onClick={irrigation.retry}>Retry</Button></p>;
  }
  const engine = irrigation.data?.engine ?? null;
  if (engine === null) return <div className="skeleton now-bursts-skeleton" aria-hidden="true" />;
  if (!engine) return <p className="meta now-actions-note" data-arrives="bursts">{BURSTS_ARRIVE_TEXT}</p>;
  const ignored = burstsIgnoredText(mode);
  return <>
    <div className="now-bursts">{BURSTS.map((burst) => <QuickBurst key={burst.kind} burst={burst} />)}</div>
    <p className="meta now-actions-term">Returns to automatic control when the timer ends. <Term id="bursts">Safety limits</Term></p>
    {ignored && <p className="fault now-actions-note" data-bursts="ignored">{ignored}</p>}
  </>;
}

/** Each light on Now, its glossary entry and its name. */
const LIGHT_NAMES: Readonly<Record<string, { readonly name: string; readonly term: GlossaryId }>> = {
  main: { name: "Main light", term: "main_light" },
  grow: { name: "Grow light", term: "grow_light" },
};
const settingOf = (rows: readonly Setting[] | undefined, param: string) => rows?.find((row) => row.param === param);

/** "off · Automatic", "on · Automation off", "on · by hand until 10:57 · the controller wants it off"; "—" until API-13 answers. */
export function lightStateWords(item: { readonly state: string; readonly intent?: string | null; readonly manual_until?: string | null } | undefined, setting: Pick<Setting, "readback"> | undefined): string {
  if (!item) return "—";
  const state = item.state === "on" || item.state === "off" ? item.state : "no current light report";
  const differs = lightsDiffer(item.intent, item.state) ? ` · the controller wants it ${item.intent}` : "";
  // A Turn on or Turn off still running (#1377's timer) reads its end, not the automation switch, which is still on.
  const until = manualUntil({ state: item.state, intent: item.intent ?? null, manual_until: item.manual_until ?? null });
  return `${state} · ${until !== null ? manualUntilWords(until) : automationWords(setting)}${differs}`;
}

/** One light: its name (a Term), its state in words, and the shared buttons. */
function QuickLight({ control, item, light }: { control: LightControl; item: Pick<Equipment["items"][number], "state" | "intent" | "manual_until"> | undefined; light: string }) {
  const { name, term } = LIGHT_NAMES[light];
  return <div className="now-light" data-light={light}>
    <p className="now-light-head"><Term id={term}>{name}</Term> <span className="meta" data-light-state="">{lightStateWords(item, control.setting)}</span></p>
    {item && <LightButtons compact control={control} item={{ label: name, state: item.state, intent: item.intent ?? null }} />}
  </div>;
}

/**
 * The lights group (#1342), mounted for operators only. The controls are held here, above each row, so a failed API-13
 * read loses no command in progress; while it fails the group says so with Retry and offers no button.
 */
function QuickLights() {
  const equipment = useEquipmentRead();
  const settings = useSettingsRead();
  const rows = settings.error ? undefined : settings.data?.items;
  const [main, grow] = LIGHTS;
  const controls = [useLightControl(main, settingOf(rows, main.autoParam)), useLightControl(grow, settingOf(rows, grow.autoParam))];
  const items = equipment.error ? null : equipment.data?.items ?? null;
  return <div className="now-lights" role="group" aria-label="Lights">
    {equipment.error && !equipment.data
      ? <p className="meta now-actions-note">Can't read the lights. <Button onClick={() => void equipment.refetch()}>Retry</Button></p>
      : items === null
        ? <div className="skeleton now-bursts-skeleton" aria-hidden="true" />
        : LIGHTS.map((light, index) => <QuickLight key={light.light} light={light.light} control={controls[index]} item={items.find((item) => item.equipment === light.equipment)} />)}
    <p className="meta now-lights-more">
      <Term id="light_timer">Turn on and off last 15 min</Term> · <Link to="/equipment#lights">Lights<span className="screen-reader"> in Equipment</span><span aria-hidden="true">{"\u00a0›"}</span></Link>
    </p>
  </div>;
}

export type QuickActionsProps = {
  /** The route's own `useStop`, so its reads speed up while the Stop confirms. */
  readonly stop: StopAllControl & { readonly confirming: boolean };
  readonly irrigation: PanelRead<IrrigationStatus>;
  /** API-02 `mode.code`, for "Bursts are ignored during emergency cooling". */
  readonly mode: string | null;
};

export function QuickActions({ stop, irrigation, mode }: QuickActionsProps) {
  return <OperatorOnly>
    <section className="now-actions" aria-label="Quick actions">
      <div className="now-stop">
        <StopAllWater wide control={stop} />
        {stop.confirming && <span className="meta">Waiting for the valves to read off</span>}
      </div>
      <div className="now-action-group"><h3>Adjust the air temporarily</h3><Bursts irrigation={irrigation} mode={mode} /></div>
      <div className="now-action-group"><h3>Lights</h3><p className="meta">Change a light for 15 minutes, then return it to automatic control.</p><QuickLights /></div>
    </section>
  </OperatorOnly>;
}
