// SPDX-License-Identifier: MIT
import { Fragment, memo, type ReactNode } from "react";
import { Link } from "react-router";
import { TIME_UNAVAILABLE, duration } from "../lib/format";
import type { Actor, Setting } from "../lib/operator-api";
import { rangeText, settingDisplay, settingUnit, steppedNumber, withUnit } from "../lib/setting-values";
import { editableHere, isLightSetting, ownerPage, settingEffect, settingLabel } from "../lib/settings-context";
import { useRole } from "../lib/session";
import { words } from "../lib/words";
import { StatusBadge, type BadgeStatus } from "./badge";
import { LocalTime, cls } from "./common";
import { BoundsBar } from "./control/bounds-bar";
import { STATE_WORDS } from "./control/setting-help";
import { AgeLabel, useNow } from "./freshness";
import { Chevron } from "./layout/chevron";

/**
 * Settings' rows and the drawer's facts (dashboard v2 screens §10.4, review B5). Each row is the setting's name, its
 * value with its unit, and the controller's side in words.md's words: Confirmed, Not confirmed since HH:MM with what it
 * reads, Not reported; a Band in force row is worked out by the host. Everything comes from API-09 as served: the row
 * never compares a readback with a value or decides writability.
 */

export { SETTING_GROUPS, groupLabel } from "../lib/settings-context";

/**
 * A setting key that wraps only after its underscores ("sw_direct_wet_<wbr>gate_<wbr>enabled"), never in the middle of a
 * word: identifiers keep `overflow-wrap: normal` (control.css), and each `<wbr>` adds no text.
 */
export function breakableKey(key: string): ReactNode {
  const parts = key.split("_");
  return parts.map((part, index) => <Fragment key={index}>{part}{index < parts.length - 1 && <>_<wbr /></>}</Fragment>);
}

/** Who wrote, by the name they are known by. */
export const actorName = (actor: Actor): string => actor.name;

/** `/activity/log?target=<param>`: every write to the setting. */
export const activityHref = (param: string): string => `/activity/log?target=${encodeURIComponent(param)}`;

/** "0.50–2.50 kPa in steps of 0.05"; a switch ON or OFF; an enum its options; "—" when nothing bounds it. */
export function boundsText(setting: Pick<Setting, "kind" | "min" | "max" | "step" | "options" | "unit" | "param">): string {
  if (setting.kind === "switch") return "ON or OFF";
  if (setting.kind === "enum" && setting.options?.length) return setting.options.map((option) => option.label).join(", ");
  const { min, max, step } = setting;
  const unit = settingUnit(setting);
  const known = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value);
  const range = known(min) && known(max) ? rangeText(min, max, unit, step) : known(min) ? `at least ${withUnit(steppedNumber(min, step), unit)}` : known(max) ? `at most ${withUnit(steppedNumber(max, step), unit)}` : null;
  const grid = known(step) && step > 0 ? `in steps of ${steppedNumber(step, step)}` : null;
  return [range, grid].filter(Boolean).join(" ") || "—";
}

const finite = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value);

/**
 * The value in force: an operator's value while it stands (the newest desired row, not released), else what the
 * controller reports, else, for a Band in force row, what the host worked out. Null when none is known.
 */
export function valueInForce(setting: Pick<Setting, "desired" | "readback" | "state">): number | null {
  const desired = setting.desired?.value;
  if (finite(desired) && setting.state !== "released" && setting.state !== "overridden") return desired;
  const read = setting.readback?.value;
  return finite(read) ? read : null;
}

// ---------------------------------------------------------------------------------------------------- the state
export type SettingStateKind = "confirmed" | "not_confirmed" | "not_reported" | "reported" | "derived";
/** A row's state as Settings words it, the badge's status, and for a value not confirmed, when it was sent and why. */
export type SettingStateView = {
  readonly kind: SettingStateKind; readonly status: BadgeStatus; readonly since: string | null; readonly reason: string | null;
};
const PENDING: readonly string[] = ["requested", "not_confirmed", "held"];

/**
 * The API's readback state in the page's words. requested, not_confirmed and held read "Not confirmed since" the time the
 * value was sent (the newest desired row's, else the reason's); no_readback reads Not reported; a row whose newest write
 * is a release has nothing to confirm, so it reads Reported while the controller reports a value. A Band in force row is
 * worked out by the host. A legacy wide limit (`read_only_kind` "legacy_wide_limit") has nothing to confirm: the host
 * stopped sending it when the band-edge law went live, so its last push can never be confirmed and it reads Reported or
 * Not reported by its readback alone (the API's state for these rows is corrected at the source in its next release).
 */
export function settingState(setting: Pick<Setting, "group" | "state" | "desired" | "readback" | "read_only_kind">): SettingStateView {
  if (setting.group === "band_in_force") return { kind: "derived", status: "neutral", since: null, reason: null };
  if (setting.read_only_kind === "legacy_wide_limit") {
    return { kind: finite(setting.readback?.value) ? "reported" : "not_reported", status: "neutral", since: null, reason: null };
  }
  if (setting.state === "confirmed") return { kind: "confirmed", status: "ok", since: null, reason: null };
  if (PENDING.includes(setting.state)) {
    const since = setting.desired?.created_at ?? setting.desired?.state_reason?.since ?? null;
    return { kind: "not_confirmed", status: setting.state === "requested" ? "warn" : "serious", since, reason: setting.desired?.state_reason?.code ?? null };
  }
  if (setting.state === "no_readback" || !finite(setting.readback?.value)) return { kind: "not_reported", status: "neutral", since: null, reason: null };
  return { kind: "reported", status: "neutral", since: null, reason: null };
}

/** The state as a small badge, with the time a value not confirmed was sent. */
export function SettingStateBadge({ state }: { state: SettingStateView }) {
  const label = STATE_WORDS[state.kind].label;
  const since = state.since && Number.isFinite(Date.parse(state.since)) ? state.since : null;
  return <StatusBadge status={state.status} size="sm" title={STATE_WORDS[state.kind].definition}>
    {state.kind === "not_confirmed" ? since ? <>{label} <LocalTime at={since} /></> : "Not confirmed" : label}
  </StatusBadge>;
}

// ---------------------------------------------------------------------------------------------------- small parts
/** "2 min ago", ticking silently. */
function Ago({ at }: { at: string | null | undefined }) {
  const now = useNow();
  const time = at ? Date.parse(at) : Number.NaN;
  return <span className="age">{Number.isFinite(time) ? `${duration(Math.max(0, Math.floor((now - time) / 1000)))} ago` : TIME_UNAVAILABLE}</span>;
}

/** The value with its unit, or an em dash. */
export function valueText(value: number | null, setting: Setting): string {
  return value === null ? "—" : settingDisplay(value, setting);
}

/**
 * What the controller reads back, with when: "1.55 kPa · 2 min ago"; "Last data 14 min ago (06:02)" while readbacks are
 * stale; "—" with the API's reason when there is none. A Band in force row has nothing on the controller to read.
 */
export function ReadbackText({ setting, readbackStale = false }: { setting: Setting; readbackStale?: boolean }) {
  const reading = setting.readback;
  if (setting.group === "band_in_force") {
    return <span className="setting-readback-text" data-readback="host">— <span className="state-note">worked out <Ago at={reading?.observed_at} /></span></span>;
  }
  if (!reading || !finite(reading.value)) {
    return <span className="setting-readback-text" data-readback="none">—{reading?.reason && <> <span className="state-note">{reading.reason}</span></>}</span>;
  }
  const text = settingDisplay(reading.value, setting);
  if (readbackStale && setting.readback_via !== "none") {
    return <span className="setting-readback-text" data-readback="stale"><span className="value-muted">{text}</span> <AgeLabel observedAt={reading.observed_at} stale /></span>;
  }
  return <span className="setting-readback-text" data-readback="reported"><span className="setting-readback-value">{text}</span> <span className="ctl-sep" aria-hidden="true">·</span> <Ago at={reading.observed_at} /></span>;
}

/** The reason a value is not confirmed, in words, once it is known. */
function ReasonText({ state }: { state: SettingStateView }) {
  return state.kind === "not_confirmed" && state.reason ? <> <span className="setting-state-reason">{words("state_reason", state.reason)}</span></> : null;
}

/** The page that owns a setting, and Lights for a lighting setting: links beside the row's own. */
export function ElsewhereLinks({ setting }: { setting: Pick<Setting, "param" | "group" | "control_class"> & { readonly effect?: string | null } }) {
  const owner = settingEffect(setting) === "none" ? null : ownerPage(setting);
  const lights = isLightSetting(setting.param);
  if (!owner && !lights) return null;
  return <>
    {owner && <Link className="setting-elsewhere" to={owner.to}>Change on {owner.page}<Chevron /></Link>}
    {lights && <Link className="setting-elsewhere" to="/lights">Lights<Chevron /></Link>}
  </>;
}

// ---------------------------------------------------------------------------------------------------- the drawer's facts
/**
 * The setting's facts above the drawer's field: the value in force, what the controller reads back and when, the state
 * (and why a value is not confirmed), the allowed range and step with the bounds bar, and what reads it.
 */
export function SettingStatus({ setting, readbackStale = false }: { setting: Setting; readbackStale?: boolean }) {
  const state = settingState(setting);
  const value = valueInForce(setting);
  const numeric = setting.kind === "numeric" && setting.group !== "band_in_force";
  return <dl className="ctl-setting-status">
    <div><dt>Value</dt><dd className="setting-value-text">{valueText(value, setting)}</dd></div>
    <div><dt>Controller reads</dt><dd><ReadbackText setting={setting} readbackStale={readbackStale} /></dd></div>
    <div><dt>State</dt><dd><SettingStateBadge state={state} /><ReasonText state={state} /></dd></div>
    {setting.group !== "band_in_force" && <div><dt>Allowed</dt><dd>
      <span className="setting-bounds-text">{boundsText(setting)}</span>
      {numeric && <BoundsBar min={setting.min} max={setting.max} step={setting.step} unit={setting.unit} value={setting.readback?.value}
        requested={state.kind === "not_confirmed" ? value : null} stale={readbackStale} />}
    </dd></div>}
    <div><dt>In use</dt><dd>{sentence(words("setting_effect", settingEffect(setting)))}</dd></div>
  </dl>;
}
const sentence = (text: string): string => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : text);

// ---------------------------------------------------------------------------------------------------- the row
export type SettingRowProps = {
  setting: Setting;
  /** Device readbacks are stale (API-02 `freshness.readback`), or the controller is not reporting. */
  readbackStale?: boolean;
  /** The drawer's URL: `?edit=<param>` with the page's other URL state. */
  editTo: string;
};

/**
 * The row's Controller cell (B5): one quiet "Confirmed" mark when the controller reads the value in force; what it reads
 * and since when the value was sent while it is not confirmed (with the reason once known); "Not reported" muted; the
 * readback muted with its stale age while readbacks are stale, never Confirmed; "Worked out by the host" for a Band in
 * force row. A released value the controller reports reads "Reported": the Value cell already shows it.
 */
export function RowState({ setting, state, readbackStale = false }: { setting: Setting; state: SettingStateView; readbackStale?: boolean }) {
  if (state.kind === "derived") return <span className="setting-mark is-muted">{STATE_WORDS.derived.label}</span>;
  if (readbackStale && setting.readback_via !== "none" && finite(setting.readback?.value)) {
    return <span className="setting-readback"><ReadbackText setting={setting} readbackStale /></span>;
  }
  if (state.kind === "confirmed") return <span className="setting-mark is-ok" title={STATE_WORDS.confirmed.definition}>{STATE_WORDS.confirmed.label}</span>;
  if (state.kind === "not_confirmed") {
    const read = setting.readback?.value;
    return <>
      <SettingStateBadge state={state} />
      {finite(read) && <span className="setting-readback" data-readback="reported"> reads {settingDisplay(read, setting)}</span>}
      <ReasonText state={state} />
    </>;
  }
  return <span className="setting-mark is-muted" title={STATE_WORDS[state.kind].definition}>{STATE_WORDS[state.kind].label}</span>;
}

/**
 * One setting, one line at 1440 px (B5): its name with the key under it in small mono, the value in force, the
 * controller's side (`RowState`) and one action. An operator on a row the drawer may change gets Edit; everyone else
 * Details, which opens the same drawer read-only. What it does, the page that owns it and its history are the drawer's.
 * At 860 px and below the row is a small card whose action covers it. Memoized: a poll re-renders only the rows whose
 * data changed.
 */
export const SettingRow = memo(function SettingRow({ setting, readbackStale = false, editTo }: SettingRowProps) {
  const operator = useRole() === "operator";
  const state = settingState(setting);
  const label = settingLabel(setting);
  const editable = editableHere(setting);
  return <tr className={cls("setting-row", !editable && "setting-read-only")} data-param={setting.param} data-state={state.kind}>
    <th scope="row" className="setting-name">
      <span className="setting-label">{label}</span> <span className="setting-param mono">{breakableKey(setting.param)}</span>
    </th>
    <td className="setting-value">
      <span className="setting-cell-label">Value </span><span className="setting-value-text">{valueText(valueInForce(setting), setting)}</span>
    </td>
    <td className="setting-state"><RowState setting={setting} state={state} readbackStale={readbackStale} /></td>
    <td className="setting-actions">
      {operator && editable
        ? <Link className="setting-edit ctl-row-link" to={editTo} preventScrollReset aria-label={`Edit ${label}`} data-write-control="true">Edit</Link>
        : <Link className="ctl-details ctl-row-link" to={editTo} preventScrollReset aria-label={`Details of ${label}`}>Details</Link>}
    </td>
  </tr>;
});
