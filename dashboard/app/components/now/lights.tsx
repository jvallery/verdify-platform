// SPDX-License-Identifier: MIT
/**
 * The two lights inside Run by hand on Now (dashboard v2 screens §1 block 5, #1342): each light's state in words and
 * Equipment's own buttons (API-20, Turn on or off for 15 min). Mounted for operators only. The controls are held here,
 * above each row, so a failed API-13 read loses no command in progress; while it fails the group says so with Retry and
 * offers no button. The lights do not wait for the irrigation firmware.
 */
import { Link } from "react-router";
import type { GlossaryId } from "../../lib/glossary";
import type { Equipment, Setting } from "../../lib/operator-api";
import { useEquipmentRead, useSettingsRead } from "../../lib/queries";
import { OperatorOnly } from "../../lib/session";
import { Button } from "../button";
import { LIGHTS, LightButtons, automationWords, lightsDiffer, manualUntil, manualUntilWords, useLightControl, type LightControl } from "../equipment/light-controls";
import { Term } from "../term";

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

function NowLight({ control, item, light }: { control: LightControl; item: Pick<Equipment["items"][number], "state" | "intent" | "manual_until"> | undefined; light: string }) {
  const { name, term } = LIGHT_NAMES[light];
  return <div className="now-light" data-light={light}>
    <p className="now-light-head"><Term id={term}>{name}</Term> <span className="meta" data-light-state="">{lightStateWords(item, control.setting)}</span></p>
    {item && <LightButtons compact control={control} item={{ label: name, state: item.state, intent: item.intent ?? null }} />}
  </div>;
}

function Lights() {
  const equipment = useEquipmentRead();
  const settings = useSettingsRead();
  const rows = settings.error ? undefined : settings.data?.items;
  const [main, grow] = LIGHTS;
  const controls = [useLightControl(main, settingOf(rows, main.autoParam)), useLightControl(grow, settingOf(rows, grow.autoParam))];
  const items = equipment.error ? null : equipment.data?.items ?? null;
  return <div className="now-lights" role="group" aria-label="Lights">
    <h3 className="now-sub">Lights</h3>
    {equipment.error && !equipment.data
      ? <p className="meta">Can't read the lights. <Button onClick={() => void equipment.refetch()}>Retry</Button></p>
      : items === null
        ? <div className="skeleton skeleton-sm" aria-hidden="true" />
        : LIGHTS.map((light, index) => <NowLight key={light.light} light={light.light} control={controls[index]} item={items.find((item) => item.equipment === light.equipment)} />)}
    <p className="meta now-lights-more">
      <Term id="light_timer">Turn on and off last 15 min</Term> · <Link to="/lights">Lights<span aria-hidden="true">{" ›"}</span></Link>
    </p>
  </div>;
}

/** The lights group, for operators only. */
export function NowLights() {
  return <OperatorOnly><Lights /></OperatorOnly>;
}
