// SPDX-License-Identifier: MIT
import { useState } from "react";
import { formatValue } from "../../lib/format";
import type { SoilTarget } from "../../lib/operator-api";
import { OperatorOnly } from "../../lib/session";
import { parseDecimal } from "../../lib/setting-values";
import { errorFor, formError, useSoilTargetWrite } from "../../lib/writes";
import { Button } from "../button";
import { LocalTime } from "../common";
import { NumberField, Reason } from "../forms";
import { actorName } from "../setting-row";
import { zoneLabel } from "./soil-model";

/** The four thresholds in their stored order, with the words the range and its form use. */
export const SOIL_FIELDS = [
  { key: "wilt_pct", label: "Wilt", hint: "A page goes out when the probe stays below this for over 2 hours" },
  { key: "min_pct", label: "Low end of the range" },
  { key: "max_pct", label: "High end of the range" },
  { key: "saturation_pct", label: "Saturation" },
] as const;
type SoilKey = (typeof SOIL_FIELDS)[number]["key"];
type Draft = Record<SoilKey, string> & { notes: string; reason: string };
const draftOf = (target: SoilTarget): Draft => ({
  wilt_pct: String(target.wilt_pct), min_pct: String(target.min_pct), max_pct: String(target.max_pct), saturation_pct: String(target.saturation_pct),
  notes: target.notes ?? "", reason: "",
});

/**
 * A zone's moisture range (API-SOIL-01, the soil target row): the range from its low to its high end, wilt and saturation beside it, its note,
 * and who changed it last; Edit for an operator opens the form in place (API-SOIL-02), and a viewer sees no Edit.
 */
export function SoilRange({ target }: { target: SoilTarget }) {
  const [editing, setEditing] = useState(false);
  const name = zoneLabel(target.zone);
  return <div className="wat-soil-range card-section">
    <div className="wat-soil-range-head">
      <h4>Moisture range</h4>
      <OperatorOnly>{!editing && <Button size="sm" write onClick={() => setEditing(true)} aria-label={`Edit ${name} moisture range`}>Edit</Button>}</OperatorOnly>
    </div>
    <dl className="kv wat-soil-range-kv">
      <dt>Range</dt><dd>{formatValue(target.min_pct, "%")} to {formatValue(target.max_pct, "%")}</dd>
      <dt>Wilt</dt><dd>{formatValue(target.wilt_pct, "%")}</dd>
      <dt>Saturation</dt><dd>{formatValue(target.saturation_pct, "%")}</dd>
    </dl>
    {target.notes && <p className="meta">{target.notes}</p>}
    <p className="meta">{target.updated_at ? <>Changed <LocalTime at={target.updated_at} date />{target.updated_by && <> by {actorName(target.updated_by)}</>}</> : "Not changed since it was set up"}</p>
    {editing && <SoilTargetForm target={target} onDone={() => setEditing(false)} />}
  </div>;
}

/**
 * One zone's thresholds and note (API-SOIL-02), sending only what changed, with the reason; the server keeps 0 ≤ wilt <
 * low < high < saturation ≤ 100 and names the field it refuses. The zone's read shows the saved values once it refreshes.
 */
export function SoilTargetForm({ target, onDone }: { target: SoilTarget; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(target));
  const write = useSoilTargetWrite();
  const fields = [...SOIL_FIELDS.map((field) => field.key), "notes", "reason"];
  const set = (key: keyof Draft) => (text: string) => { write.clearError(); setDraft((current) => ({ ...current, [key]: text })); };
  const save = async () => {
    const body: Record<string, number | string> = {};
    for (const field of SOIL_FIELDS) {
      const value = parseDecimal(draft[field.key]);
      if (value !== null && value !== target[field.key]) body[field.key] = value;
    }
    if (draft.notes !== (target.notes ?? "")) body.notes = draft.notes;
    if (!Object.keys(body).length) { onDone(); return; }
    if (draft.reason.trim()) body.reason = draft.reason.trim();
    const outcome = await write.send(target.zone, body);
    if (outcome.ok) onDone();
  };
  const problem = formError(write.error, fields);
  return <form className="wat-soil-form" aria-label={`Edit ${zoneLabel(target.zone)} moisture range`} onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <p className="meta">Keep wilt below the low end, the low end below the high end and the high end below saturation, all from 0 to 100%.</p>
    <div className="wat-soil-fields">
      {SOIL_FIELDS.map((field) => <NumberField key={field.key} label={field.label} value={draft[field.key]} onChange={set(field.key)} min={0} max={100} step={1}
        unit="%" hint={"hint" in field ? field.hint : undefined} error={errorFor(write.error, field.key)} disabled={write.sending} />)}
    </div>
    <Reason label="Note (optional)" value={draft.notes} onChange={set("notes")} error={errorFor(write.error, "notes")} disabled={write.sending} />
    <Reason value={draft.reason} onChange={set("reason")} error={errorFor(write.error, "reason")} disabled={write.sending} />
    {problem && <p className="fault" role="alert">{problem}</p>}
    <div className="wat-soil-actions">
      <Button type="submit" variant="primary" busy={write.sending} write>Save</Button>
      <Button onClick={onDone} disabled={write.sending}>Cancel</Button>
    </div>
  </form>;
}
