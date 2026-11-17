// SPDX-License-Identifier: MIT
import { useCallback, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import type { Setting } from "../../lib/operator-api";
import { useSettingsRead } from "../../lib/queries";
import { useRole, useWritesEnabled } from "../../lib/session";
import { keptNumber, parseDecimal } from "../../lib/setting-values";
import { editableHere, groupLabel, settingEffect, settingLabel } from "../../lib/settings-context";
import { useShellNow, useShellStatus } from "../../lib/shell";
import { MANUAL_DEFAULT, errorFor, formError, useSettingWrite } from "../../lib/writes";
import { Button } from "../button";
import { EditDrawer, NumberField, Reason, Select, Switch } from "../forms";
import { SettingHistoryPanel } from "../setting-history";
import { ElsewhereLinks, SettingStatus, activityHref, valueInForce } from "../setting-row";
import { NO_EFFECT_TEXT, SettingHelpPanel, labelFor } from "./setting-help";

/**
 * The one setting drawer (dashboard v2 screens §10.4): Settings, Lights and Equipment open it in place from
 * `?edit=<param>`. It shows the value, what the controller reads back, the state, the allowed range and step and what
 * reads the setting; what the setting does; then, for an operator on a setting the drawer may change, the field, Reason,
 * Release and Save; then the change history with Revert and "Activity for this setting ›". Saves go through API-10 and
 * releases through API-11. The band's points and the drying cost limit are changed on their own pages, so their drawer
 * is read-only and links there; a setting nothing reads says so above its field.
 */

/**
 * Device readbacks are stale (API-02 `freshness.readback`), the controller is not reporting, or the dashboard API is
 * down, when no value on screen can be vouched for: values are muted and nothing reads Confirmed.
 */
export function useReadbackStale(): boolean {
  const shellNow = useShellNow();
  const status = useShellStatus();
  return shellNow.data?.freshness.readback.stale === true || status.controllerReporting === false || status.apiDown;
}

/** The page's URL with `changes` applied (null or "" removes a parameter). */
export function withParams(pathname: string, params: URLSearchParams, changes: Record<string, string | null>): string {
  const next = new URLSearchParams(params);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null || value === "") next.delete(name); else next.set(name, value);
  }
  const search = next.toString();
  return search ? `${pathname}?${search}` : pathname;
}

/**
 * The drawer's URL state on any page: the setting `?edit=` names, the link that opens one with the page's other URL state
 * kept, and closing, which drops `edit` and the history window `hist` and replaces the entry, so Back never reopens a
 * drawer that was closed.
 */
export function useSettingEdit() {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const editing = params.get("edit");
  const editTo = useCallback((param: string) => withParams(pathname, params, { edit: param, hist: null }), [pathname, params]);
  const close = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete("edit");
    next.delete("hist");
    return next;
  }, { replace: true, preventScrollReset: true }), [setParams]);
  return { editing, editTo, close };
}

/**
 * The drawer for `?edit=`: it reads API-09 only while a drawer is asked for, and opens once that row has loaded. A param
 * the API does not serve opens nothing.
 */
export function SettingDrawerHost() {
  const { editing, close } = useSettingEdit();
  return editing ? <EditingDrawer param={editing} onClose={close} /> : null;
}
function EditingDrawer({ param, onClose }: { param: string; onClose: () => void }) {
  const read = useSettingsRead();
  const row = read.data?.items.find((item) => item.param === param) ?? null;
  return row ? <SettingDrawer key={row.param} setting={row} onClose={onClose} /> : null;
}

/** The value in force as the field's text, as stored. */
function fieldText(setting: Setting): string {
  const value = valueInForce(setting);
  return value === null ? "" : keptNumber(value, setting.step);
}

/**
 * `?edit=<param>`: the drawer itself. A viewer, a row the API serves with `writable: false`, the band's points and the
 * drying cost limit get it read-only (the facts, what it does and the history); with changes switched off an operator's
 * Save, Release and Revert are disabled. A Band in force row is worked out by the host, so it has no history of its own.
 */
export function SettingDrawer({ setting, onClose }: { setting: Setting; onClose: () => void }) {
  const operator = useRole() === "operator";
  const writesEnabled = useWritesEnabled();
  const status = useShellStatus();
  const editable = editableHere(setting);
  const readOnly = !editable || !operator;
  const write = useSettingWrite(setting, { onSaved: onClose });
  const [text, setText] = useState(() => fieldText(setting));
  const [choice, setChoice] = useState<number | null>(() => {
    const value = valueInForce(setting);
    // A switch with no known value starts unset, never OFF: Save sends nothing until ON or OFF is picked.
    return setting.kind === "switch" ? (value === 0 || value === 1 ? value : null) : value;
  });
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState<string | null>(null);
  // One write at a time from this drawer: Revert has its own hook, so Save and Release wait for it, as it waits for them.
  const [reverting, setReverting] = useState(false);
  // A guardrail saves on a second press, after its rule is shown.
  const guardrail = setting.help?.guardrail === true;
  const [confirming, setConfirming] = useState(false);
  const readbackStale = useReadbackStale();
  const { editTo } = useSettingEdit();
  const catalog = useSettingsRead();
  const labelOf = labelFor(catalog.data?.items);
  const save = () => {
    const value = setting.kind === "numeric" ? parseDecimal(text) : choice;
    if (value === null) {
      setTyped(setting.kind === "numeric" ? "Enter a number" : setting.kind === "switch" ? "Choose ON or OFF" : "Choose a value");
      return;
    }
    setTyped(null);
    if (guardrail && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    void write.save({ value, manual: MANUAL_DEFAULT, reason: reason.trim() || null });
  };
  const release = () => void write.release({ reason: reason.trim() || null });
  let field: ReactNode = null;
  if (!readOnly && setting.kind === "switch") {
    field = <Switch label="New value" checked={choice === 1} onChange={(on) => setChoice(on ? 1 : 0)} />;
  } else if (!readOnly && setting.kind === "enum") {
    field = <Select label="New value" value={choice} options={setting.options ?? []} onChange={setChoice} error={typed ?? errorFor(write.error, "value")} />;
  } else if (!readOnly) {
    field = <NumberField label="New value" value={text} onChange={setText} min={setting.min} max={setting.max} step={setting.step} unit={setting.unit}
      error={typed ?? errorFor(write.error, "value")} />;
  }
  // A Switch has no error slot of its own, so its refusal shows with the form.
  const switchError = setting.kind === "switch" ? typed : null;
  // Only while Save is live: with changes switched off it is disabled, and the shell's banner says so.
  const notReporting = !readOnly && writesEnabled && (status.ingestorRunning === false || status.controllerReporting === false);
  const host = setting.group === "band_in_force";
  const unused = settingEffect(setting) === "none";
  // Release drops an operator's value; with none standing there is nothing to release.
  const releasable = setting.desired !== null && setting.desired.value !== null && setting.state !== "released";
  return <EditDrawer open onClose={onClose} title={readOnly ? "Setting" : "Change setting"} eyebrow={groupLabel(setting.group)}
    heading={settingLabel(setting)} graph={host ? undefined : { param: setting.param, unit: setting.unit }} readOnly={!editable}
    status={<div className="drawer-setting">
      <p className="setting-param mono">{setting.param}</p>
      <SettingStatus setting={setting} readbackStale={readbackStale} />
      {unused && <p className="notice notice-info ctl-no-effect">{NO_EFFECT_TEXT}</p>}
      <p className="ctl-drawer-links"><ElsewhereLinks setting={setting} /></p>
      {notReporting && <p className="state-note">Save still works: the change applies when the controller reports again.</p>}
      <SettingHelpPanel setting={setting} editTo={editTo} labelOf={labelOf} />
    </div>}
    onSave={save} saving={write.sending} saveDisabled={reverting} saveLabel={confirming ? "Confirm guardrail change" : "Save"}
    error={switchError ?? formError(write.error, setting.kind === "switch" ? ["reason"] : ["value", "reason"])}
    actions={releasable ? <Button write onClick={release} disabled={write.sending || reverting}>Release</Button> : undefined}
    below={host ? undefined : <>
      <SettingHistoryPanel setting={setting} onReverted={onClose} busy={write.sending} onSending={setReverting} />
      <p className="ctl-drawer-links"><Link to={activityHref(setting.param)}>Activity for this setting<span aria-hidden="true"> ›</span></Link></p>
    </>}>
    {field}
    {!readOnly && releasable && <p className="state-note ctl-release-note">Release drops the value an operator set; the host then sends the setting's own value again.</p>}
    {!readOnly && <Reason value={reason} onChange={setReason} error={errorFor(write.error, "reason")} />}
    {confirming && <p className="notice notice-warn ctl-guardrail-confirm" role="alert">
      <strong>This is a hard guardrail.</strong> {setting.help?.caution} Press Confirm guardrail change to save it.
    </p>}
  </EditDrawer>;
}
