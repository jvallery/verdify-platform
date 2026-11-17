// SPDX-License-Identifier: MIT
/**
 * The drying cost limit, the one price in the policy (words.md; screens §2.3 block 2 and §2.2 block 4a): one control that
 * Drying renders now and the Band page renders beside the band.
 *
 * ```tsx
 * <DryingLimit />                       // Drying: the limit, its source, the stepper, Save, the readback, what raising or lowering does
 * <DryingLimit variant="band" />        // Band: the same, with the price the controller pays now and a link to Drying
 * ```
 *
 * It reads its own data through the shared hooks (API-30 for the limit in force and its source, API-09 for the
 * registry's step, range and readback), so it adds no poll to a page that already reads them. Save writes API-10
 * `dry_cost_limit_kwh_per_kg` through `useSettingWrite`, which toasts and refetches API-09; the row then reads REQUESTED
 * every 5 s until the controller's readback confirms it. A viewer sees the limit and its source and no control; the API
 * refuses anyone but the owner.
 */
import { useEffect, useState, type FormEvent } from "react";
import { formatValue } from "../../lib/format";
import type { LawView, Setting } from "../../lib/operator-api";
import { panelRead, useLawRead, useSettingsRead, type PanelRead } from "../../lib/queries";
import { OperatorOnly } from "../../lib/session";
import { parseDecimal } from "../../lib/setting-values";
import { useSettingWrite } from "../../lib/writes";
import { words } from "../../lib/words";
import { ReadbackBadge } from "../badge";
import { Button } from "../button";
import { LocalTime } from "../common";
import { NumberField } from "../forms/number-field";
import { Panel, type PanelState } from "../panel";
import { StateReasonLine } from "../state-reason-line";

/** The registry row the limit is written to. */
export const DRYING_LIMIT_PARAM = "dry_cost_limit_kwh_per_kg";
export const LIMIT_UNIT = "kWh/kg";
/** Readback states the badge shows; any other shows nothing here. */
const SHOWN_STATES = new Set(["requested", "confirmed", "not_confirmed", "held"]);

export type DryingLimitProps = {
  /**
   * `drying` (default): Drying's block 2, with the two sentences on what raising or lowering the limit does. `band`:
   * the Band page's block 4a, with the price the controller pays now and a link to Drying for the evidence.
   */
  variant?: "drying" | "band";
  /** The panel's heading level: 2 on a page of panels (default), 3 inside a section. */
  headingLevel?: 2 | 3;
};

/** "0.70 kWh/kg, the controller's default": the limit in force and where it comes from. */
export function limitInForceWords(drying: Pick<LawView["drying"], "limit_kwh_per_kg" | "limit_source">): string {
  if (drying.limit_kwh_per_kg === null) return "Not reported";
  return `${formatValue(drying.limit_kwh_per_kg, LIMIT_UNIT)}, ${words("limit_source", drying.limit_source)}`;
}

/** The field's starting text: the newest value sent, else the limit in force, else the registry's readback. */
export function startingText(setting: Pick<Setting, "desired" | "readback"> | null, drying: Pick<LawView["drying"], "limit_kwh_per_kg"> | null): string {
  const value = setting?.desired?.value ?? drying?.limit_kwh_per_kg ?? setting?.readback?.value ?? null;
  return value === null ? "" : value.toFixed(2);
}

/** The panel's state from its two reads: the limit needs API-30; the form needs API-09's row. */
export function limitPanelState(law: Pick<PanelRead<LawView>, "data" | "failed" | "pending">): PanelState {
  if (law.pending) return "loading";
  if (!law.data) return "error";
  return law.failed || (law.data.observed_at !== null && !law.data.reporting) ? "stale" : "ready";
}

/** The stepper, Save and the readback (operators only; the API holds the limit to the owner). */
function LimitForm({ setting, drying }: { setting: Setting; drying: LawView["drying"] | null }) {
  const write = useSettingWrite(setting);
  const [text, setText] = useState(() => startingText(setting, drying));
  const [saved, setSaved] = useState<{ value: number; snappedFrom: number | null } | null>(null);
  // A value confirmed elsewhere refills an untouched field.
  const start = startingText(setting, drying);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) setText(start); }, [start, touched]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = parseDecimal(text);
    if (value === null) return;
    const outcome = await write.save({ value });
    if (outcome.ok) {
      setSaved({ value: outcome.data.value ?? value, snappedFrom: outcome.data.snapped_from ?? null });
      setTouched(false);
    }
  };
  const error = write.error ? (write.error.field === "value" || write.error.field === null ? write.error.message : null) : null;
  return <form className="drying-limit-form" onSubmit={(event) => { void submit(event); }}>
    <NumberField label="New limit" value={text} onChange={(next) => { setText(next); setTouched(true); setSaved(null); write.clearError(); }}
      min={setting.min} max={setting.max} step={setting.step} unit={setting.unit ?? LIMIT_UNIT} error={error} saved={saved}
      hint="Only the owner sets the limit" />
    <Button type="submit" variant="primary" write busy={write.sending} disabled={parseDecimal(text) === null}>Save</Button>
  </form>;
}

/** What the controller has taken: the readback badge, the value sent and when, and why it is not confirmed yet. */
function Readback({ setting }: { setting: Setting }) {
  const desired = setting.desired;
  if (!desired || !SHOWN_STATES.has(setting.state)) return null;
  return <p className="drying-limit-readback">
    <ReadbackBadge state={setting.state} readbackVia={setting.readback_via} />{" "}
    <span className="state-note">Sent {formatValue(desired.value, LIMIT_UNIT)} at <LocalTime at={desired.created_at} />
      {setting.state === "confirmed" && desired.confirmed_at ? <>; the controller confirmed it at <LocalTime at={desired.confirmed_at} /></> : null}.</span>
    <StateReasonLine state={setting.state} reason={desired.state_reason} requestedAt={desired.created_at} unit={LIMIT_UNIT} />
  </p>;
}

/**
 * The drying cost limit (see the module's comment): the limit in force on the controller and its source, the price now
 * (Band), the stepper on the registry's step and range with Save for operators, the readback, and what raising or
 * lowering it does (Drying).
 */
export function DryingLimit({ variant = "drying", headingLevel = 2 }: DryingLimitProps) {
  const law = panelRead(useLawRead());
  const settings = panelRead(useSettingsRead());
  const drying = law.data?.drying ?? null;
  const setting = settings.data?.items.find((item) => item.param === DRYING_LIMIT_PARAM) ?? null;
  return <Panel title="Drying cost limit" headingLevel={headingLevel} thing="the drying cost limit" state={limitPanelState(law)} observedAt={law.data?.observed_at}
    onRetry={() => { law.retry(); settings.retry(); }} link={variant === "band" ? { to: "/climate/drying", label: "Drying" } : undefined}>
    <p className="drying-limit-value"><span className="drying-limit-number">{drying ? formatValue(drying.limit_kwh_per_kg, LIMIT_UNIT) : "—"}</span>
      <span className="meta"> in force on the controller{drying?.limit_kwh_per_kg !== null && drying ? `, ${words("limit_source", drying.limit_source)}` : ""}</span></p>
    {variant === "band" && drying && <p className="meta">{drying.cost_kwh_per_kg === null ? "No price now: there is no outdoor reading."
      : `The controller would pay ${formatValue(drying.cost_kwh_per_kg, LIMIT_UNIT)} to dry the air now.`}</p>}
    <p className="meta">The most the owner will pay in heat for each kilogram of water drying removes.</p>
    {setting ? <>
      <Readback setting={setting} />
      <OperatorOnly><LimitForm setting={setting} drying={drying} /></OperatorOnly>
      {variant === "drying" && (setting.help?.raise || setting.help?.lower) && <ul className="drying-limit-effects">
        {setting.help?.raise && <li><strong>Raise it:</strong> {setting.help.raise}</li>}
        {setting.help?.lower && <li><strong>Lower it:</strong> {setting.help.lower}</li>}
      </ul>}
    </> : settings.pending ? null : <p className="meta">{settings.failed ? "The setting's range and readback could not be read." : "The setting is not in the catalog."}</p>}
  </Panel>;
}
