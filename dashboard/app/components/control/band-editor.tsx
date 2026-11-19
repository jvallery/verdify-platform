// SPDX-License-Identifier: MIT
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { formatValue, sentenceStart } from "../../lib/format";
import { useFreshRead } from "../../lib/graph-reads";
import { ApiError, type BandProfilePreview, type DesiredSetting, type ParamsOf, type ReviewProposal, type Setting } from "../../lib/operator-api";
import { panelRead, useSettingsRead } from "../../lib/queries";
import { OperatorOnly, useWritesEnabled } from "../../lib/session";
import { errorFor, formError, problemMessage, useBandWrite, type WriteError } from "../../lib/writes";
import { Button } from "../button";
import {
  ANCHOR_TIMES, AXES, AXIS_UNIT, EDGE_FIELDS, SIDES, axisAnchors, bandRowWords, changeLines, draftRequest, edgeFieldWords, inputOf, loadProposal, previewQuery,
  saveBody, setSplit, startDraft, type AnchorTime, type Axis, type ChangeLine, type Draft, type DraftRequest, type EdgeField, type Sent, type Side,
} from "../climate/band-draft";
import { FieldError } from "../forms/field";
import { useModalDialog } from "../forms/modal";
import { NumberField } from "../forms/number-field";
import { Reason } from "../forms/reason";
import { PREVIEW_DEBOUNCE_MS, PREVIEW_UNAVAILABLE } from "../band-preview";
import { Panel } from "../panel";

/**
 * The band editor (screens §2.2 blocks 3 and 4, API spec §4.1). The draft model is `climate/band-draft.ts`; this holds it
 * in state, previews it through API-23 300 ms after each edit (the same numbers Save would send, so the preview is the
 * server's and nothing is computed twice), and saves it as one API-24 write after a confirm sheet that lists, from that
 * preview, every anchor the write changes, old to new. The fields edit edges only; the target rows the law does not read
 * are never fields, and a proposal that names one lists it in the sheet on a line of its own.
 */

export type LastSave = { readonly at: string; readonly rows: readonly DesiredSetting[] };

/** API-09's row that gives an axis its push step: the low edge at solar noon. */
const stepRow = (axis: Axis) => `band_${axis}_low_sm`;

export type BandEditor = ReturnType<typeof useBandEditor>;

/**
 * The page's one band draft: the band as stored (API-23 with no draft), the draft, its request, its preview (API-23 with
 * the draft, debounced), the write and the last Save. `fresh` is true once the preview answers exactly the draft as it
 * stands; Save and the confirm sheet wait for it.
 */
export function useBandEditor() {
  const base = useFreshRead("API-23", {});
  const stored = base.data ?? null;
  const baseDraft = useMemo(() => (stored ? startDraft(stored.current) : null), [stored]);
  // No draft (null) follows the band as stored. An edit or a proposal sets one; a Save drops it once the read after
  // the Save brings the band it stored, so the fields start again from the band as stored.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedOver, setSavedOver] = useState<BandProfilePreview | null>(null);
  useEffect(() => {
    if (savedOver === null || !stored || stored === savedOver) return;
    setDraft(null);
    setSavedOver(null);
  }, [stored, savedOver]);
  const current = draft ?? baseDraft;
  const request: DraftRequest | null = useMemo(() => (current && baseDraft ? draftRequest(current, baseDraft) : null), [current, baseDraft]);
  const query: ParamsOf<"API-23"> | null = request?.ok && !request.empty ? previewQuery(request.sent) : null;
  const queryKey = JSON.stringify(query);
  const [settled, setSettled] = useState<{ key: string; query: ParamsOf<"API-23"> | null }>({ key: "null", query: null });
  const latestQuery = useRef(query);
  latestQuery.current = query;
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ key: queryKey, query: latestQuery.current }), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [queryKey]);
  const read = useFreshRead("API-23", settled.query);
  const edited = query !== null;
  const fresh = edited && settled.key === queryKey && read.isSuccess && !read.isPlaceholderData && !read.isFetching;
  const preview = edited && settled.query !== null ? read.data ?? stored : stored;
  const write = useBandWrite();
  const [lastSave, setLastSave] = useState<LastSave | null>(null);
  const settings = panelRead(useSettingsRead());

  const update = (change: (before: Draft) => Draft) => {
    write.clearError();
    setDraft((before) => {
      const from = before ?? baseDraft;
      return from ? change(from) : before;
    });
  };
  const setEdge = (field: EdgeField, text: string) => update((before) => ({ ...before, edges: { ...before.edges, [field]: text } }));
  const setAnchor = (param: string, text: string) => update((before) => ({ ...before, anchors: { ...before.anchors, [param]: text } }));
  const split = (axis: Axis, on: boolean) => baseDraft && update((before) => setSplit(before, baseDraft, axis, on));
  const reset = () => baseDraft && update(() => baseDraft);
  const loadInto = (reviewId: number, proposal: Pick<ReviewProposal, "changes">) => {
    if (!baseDraft) return [];
    const loaded = loadProposal(current ?? baseDraft, baseDraft, reviewId, proposal);
    update(() => loaded.draft);
    return loaded.ignored;
  };
  const save = async (sent: Sent, reason: string) => {
    const outcome = await write.save(saveBody(sent, reason));
    if (outcome.ok) {
      setLastSave({ at: new Date().toISOString(), rows: outcome.data.changed });
      setSavedOver(stored);
    }
    return outcome.ok;
  };
  const stepOf = (axis: Axis): Pick<Setting, "step" | "unit"> | null => settings.data?.items.find((row) => row.param === stepRow(axis)) ?? null;
  return { base, stored, baseDraft, draft: current, request, edited, fresh, read, preview, write, lastSave, save, setEdge, setAnchor, split, reset, loadInto, stepOf };
}

/** What a preview read's failure says: a refusal in the API's words, else that the preview is unavailable. */
export function previewProblem(error: unknown): { field: string | null; message: string } {
  if (error instanceof ApiError && (error.status === 422 || error.status === 400)) return { field: error.problem.field ?? null, message: problemMessage(error.problem) };
  return { field: null, message: PREVIEW_UNAVAILABLE };
}

/** The words beside one input: a number that does not read, a finding of the preview that names it, or a refusal. */
function inputErrors(editor: BandEditor): Map<string, string> {
  const out = new Map<string, string>();
  const split = editor.draft?.split ?? { temp: false, vpd: false };
  const put = (field: string | null | undefined, message: string) => {
    const input = inputOf(field, split);
    if (input && !out.has(input)) out.set(input, message);
  };
  if (editor.request && !editor.request.ok) out.set(editor.request.field, editor.request.message);
  if (editor.write.error) put(editor.write.error.field, editor.write.error.message);
  if (editor.edited && editor.read.isError) {
    const problem = previewProblem(editor.read.error);
    put(problem.field, problem.message);
  }
  if (editor.fresh && editor.read.data) for (const finding of editor.read.data.findings) if (finding.severity === "error") put(finding.field, finding.detail);
  return out;
}

/** "Stored 71.8 °F": the stored value beside a field whose draft differs from it. */
function storedHint(text: string, baseText: string | undefined, unit: string): string | null {
  return baseText === undefined || text === baseText ? null : `Stored ${baseText ? `${baseText}\u00a0${unit}` : "—"}`;
}

const AXIS_TITLE: Readonly<Record<Axis, string>> = { temp: "Temperature", vpd: "VPD" };
const SIDE_WORDS: Readonly<Record<Side, string>> = { low: "Low edge", high: "High edge" };

/** One row of an axis's fields: a time of day and its low and high input (an edge field, or an anchor param when split). */
export type FieldRow = { readonly key: string; readonly words: string; readonly note: string | null; readonly inputs: Readonly<Record<Side, string>> };
/**
 * The rows an axis shows, a time a row with its low and its high edge: by day and at night as edges, or sunrise, solar
 * noon, sunset and solar midnight as the eight anchors when sunrise and sunset are set separately.
 */
export function fieldRows(axis: Axis, split: boolean): FieldRow[] {
  if (!split) {
    return (["day", "night"] as const).map((time) => ({
      key: time, words: time === "day" ? "By day" : "At night", note: time === "day" ? "solar noon" : "solar midnight",
      inputs: { low: `${axis}_low_${time}`, high: `${axis}_high_${time}` },
    }));
  }
  const words: Readonly<Record<AnchorTime, string>> = { sr: "Sunrise", sm: "Solar noon", ss: "Sunset", mid: "Solar midnight" };
  return ANCHOR_TIMES.map((at) => ({ key: at, words: words[at], note: null, inputs: { low: `band_${axis}_low_${at}`, high: `band_${axis}_high_${at}` } }));
}

/** The accessible name of an input: "Temperature low edge by day", "VPD high edge at sunset". */
export function inputName(input: string): string {
  if ((EDGE_FIELDS as readonly string[]).includes(input)) return edgeFieldWords(input as EdgeField);
  return bandRowWords(input) ?? input;
}

/** The limits beside an axis's fields: the narrowest band the law allows and the outer limits (API-23 `guardrails`). */
export function limitsText(axis: Axis, guardrails: BandProfilePreview["guardrails"]): string {
  const g = guardrails;
  if (axis === "temp") {
    const narrow = g.min_width_f === null ? "" : `At least ${formatValue(g.min_width_f, "°F")} wide at every hour of the day; `;
    return `${narrow}${narrow ? "at" : "At"} least ${formatValue(g.margin_f, "°F")} inside the ${formatValue(g.temp_min_f, "°F")} and ${formatValue(g.temp_max_f, "°F")} protection limits.`;
  }
  const narrow = g.min_width_kpa === null ? "" : `At least ${formatValue(g.min_width_kpa, "kPa")} wide at every hour; `;
  const drying = g.dry_on_above_vpd_low_kpa === null ? `the low edge stays at or above ${formatValue(g.night_vpd_floor_kpa, "kPa")} all night`
    : `at night the drying line (the low edge plus ${formatValue(g.dry_on_above_vpd_low_kpa, "kPa")}) stays at or above ${formatValue(g.night_vpd_floor_kpa, "kPa")}`;
  return sentenceStart(`${narrow}between ${formatValue(g.vpd_min_kpa, "kPa")} and ${formatValue(g.vpd_max_kpa, "kPa")}; ${drying}.`);
}

/**
 * One axis: its limits and step, then a row a time of day with its low and its high edge (the column heads name the
 * sides above 30 rem of width; below that each input carries its own), then the switch between edges and the eight
 * anchors. Each input's name says everything ("Temperature low edge by day"); its stored value shows under it only
 * when the draft differs.
 */
function AxisFields({ editor, axis, errors, disabled }: { editor: BandEditor; axis: Axis; errors: Map<string, string>; disabled: boolean }) {
  const draft = editor.draft;
  const base = editor.baseDraft;
  const toggleId = useId();
  if (!draft || !base) return null;
  const unit = AXIS_UNIT[axis];
  const step = editor.stepOf(axis)?.step ?? null;
  const split = draft.split[axis];
  const text = (input: string) => (split ? draft.anchors[input] ?? "" : draft.edges[input as EdgeField]);
  const baseText = (input: string) => (split ? base.anchors[input] : base.edges[input as EdgeField]);
  const change = (input: string, value: string) => (split ? editor.setAnchor(input, value) : editor.setEdge(input as EdgeField, value));
  return <fieldset className="band-axis" disabled={disabled}>
    <legend>{AXIS_TITLE[axis]}, {unit}</legend>
    {editor.stored && <p className="meta band-limits">{limitsText(axis, editor.stored.guardrails)}{step ? ` Steps of ${formatValue(step, unit)}.` : ""}</p>}
    <div className="band-rows">
      <div className="band-row band-row-heads" aria-hidden="true"><span /><span>{SIDE_WORDS.low}</span><span>{SIDE_WORDS.high}</span></div>
      {fieldRows(axis, split).map((row) => <div key={row.key} className="band-row">
        <p className="band-row-time" aria-hidden="true">{row.words}{row.note && <span className="band-row-note">{row.note}</span>}</p>
        {SIDES.map((side) => {
          const input = row.inputs[side];
          const hint = storedHint(text(input), baseText(input), unit);
          return <div key={side} className="band-cell" data-changed={hint ? "" : undefined}>
            <NumberField label={<><span className="screen-reader">{inputName(input)}</span><span className="band-cell-label" aria-hidden="true">{SIDE_WORDS[side]}</span></>}
              value={text(input)} onChange={(value) => change(input, value)} step={step} disabled={disabled} hint={hint} error={errors.get(input) ?? null} />
          </div>;
        })}
      </div>)}
    </div>
    <label className="check field-check band-split-toggle" htmlFor={toggleId}>
      <input id={toggleId} type="checkbox" checked={split} disabled={disabled} onChange={(event) => editor.split(axis, event.target.checked)} />
      <span>Set sunrise and sunset separately</span>
    </label>
    <p className="meta band-split-note">{split
      ? "Each time is sent as you set it. Turning this off puts sunrise and sunset halfway between day and night again, from the band as stored."
      : "Sunrise and sunset sit halfway between day and night."}</p>
  </fieldset>;
}

/** A change in words: "Temperature low edge at solar noon 71.8 → 72.0 °F" (a screen reader hears "to"). */
export function ChangeItem({ line }: { line: ChangeLine }) {
  const number = (value: number | null) => formatValue(value, line.unit).replace(/\s?(°F|kPa)$/, "");
  return <li><span className="band-change-name">{line.words}</span> <span className="band-change-values num">{number(line.before)} <span aria-hidden="true">→</span><span className="screen-reader"> to </span> {formatValue(line.after, line.unit)}</span></li>;
}

export type Pending = { readonly sent: Sent; readonly edges: readonly ChangeLine[]; readonly targets: readonly ChangeLine[]; readonly reason: string };

/** The confirm sheet: every anchor the Save writes, old to new, from the preview of exactly what it sends. */
export function BandConfirm({ pending, onCancel, onSave, sending, error }: { pending: Pending | null; onCancel: () => void; onSave: () => void; sending: boolean; error: WriteError | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const errorId = useId();
  const open = pending !== null;
  const { onKeyDown, onCancel: onDialogCancel } = useModalDialog(ref, open, onCancel, (dialog) => dialog.querySelector<HTMLElement>(".dialog-actions .btn"));
  const count = pending?.edges.length ?? 0;
  return <dialog ref={ref} className="confirm-dialog band-confirm" aria-labelledby={titleId} aria-modal="true" onKeyDown={onKeyDown} onCancel={onDialogCancel}>
    {pending && <form className="dialog-form" onSubmit={(event) => { event.preventDefault(); if (!sending) onSave(); }}>
      <h2 id={titleId}>Save the band?</h2>
      {count > 0 && <>
        <p className="dialog-facts">Changes {count} {count === 1 ? "edge" : "edges"} in one change:</p>
        <ul className="band-changes">{pending.edges.map((line) => <ChangeItem key={line.param} line={line} />)}</ul>
      </>}
      {pending.targets.length > 0 && <>
        <p className="dialog-facts">Also changes {pending.targets.length} stored {pending.targets.length === 1 ? "row" : "rows"} the law does not read:</p>
        <ul className="band-changes band-changes-quiet">{pending.targets.map((line) => <ChangeItem key={line.param} line={line} />)}</ul>
      </>}
      <p className="dialog-note">{pending.reason.trim() ? <>Reason: {pending.reason.trim()}</> : "No reason given."} The controller takes each edge at the next delivery; the page then shows each one as the controller confirms it.</p>
      {error && <FieldError id={errorId}>{error.message}</FieldError>}
      <div className="dialog-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button write variant="primary" type="submit" busy={sending}>Save band</Button>
      </div>
    </form>}
  </dialog>;
}

/** The form's status line: what Save would do, or why it cannot yet. */
function saveStatus(editor: BandEditor, errors: Map<string, string>, preview: BandProfilePreview | null): string {
  if (!editor.edited) return editor.request && !editor.request.ok ? "Enter a number in every field you changed." : "No change yet.";
  if (errors.size > 0) return "Fix the marked edge to save.";
  if (!editor.fresh || !preview) return editor.read.isError ? "The draft could not be checked." : "Checking the draft…";
  const { edges, targets } = changeLines(preview);
  if (!edges.length && !targets.length) return "This draft changes nothing as stored.";
  const more = targets.length ? ` and ${targets.length} stored ${targets.length === 1 ? "row" : "rows"} the law does not read` : "";
  return `Save writes ${edges.length} ${edges.length === 1 ? "edge" : "edges"}${more} in one change.`;
}

/** Block 3, for operators: the fields of each axis, their limits, the reason and Save with its confirm sheet. */
export function BandEditorPanel({ editor }: { editor: BandEditor }) {
  const writesEnabled = useWritesEnabled();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const errors = inputErrors(editor);
  const preview = editor.fresh ? editor.read.data ?? null : null;
  const changes = preview ? changeLines(preview) : null;
  const findingsBlock = preview?.findings.some((finding) => finding.severity === "error") ?? false;
  const canSave = editor.request?.ok === true && editor.fresh && changes !== null && changes.edges.length + changes.targets.length > 0 && !findingsBlock && errors.size === 0;
  const open = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || !changes || !editor.request?.ok) return;
    editor.write.clearError();
    setPending({ sent: editor.request.sent, edges: changes.edges, targets: changes.targets, reason });
  };
  const confirm = async () => {
    if (!pending) return;
    if (await editor.save(pending.sent, pending.reason)) {
      setPending(null);
      setReason("");
    }
  };
  const fields = [...EDGE_FIELDS, ...AXES.flatMap(axisAnchors), "reason", "anchor"];
  const loaded = editor.draft?.proposal ?? null;
  const state = editor.stored ? "ready" : editor.base.isError ? "error" : "loading";
  return <OperatorOnly>
    <Panel title="Set the band" thing="the band" state={state} onRetry={() => void editor.base.refetch()}
      actions={editor.edited ? <Button variant="quiet" size="sm" onClick={editor.reset}>Start again</Button> : undefined}>
      <form className="band-form" onSubmit={open} noValidate>
        {loaded !== null && <p className="band-loaded">The daily review's proposal is loaded: each edge it changes shows its stored value under it. Nothing changes until you save.</p>}
        <div className="band-axes">{AXES.map((axis) => <AxisFields key={axis} editor={editor} axis={axis} errors={errors} disabled={!writesEnabled} />)}</div>
        <Reason value={reason} onChange={setReason} error={errorFor(editor.write.error, "reason")} disabled={!writesEnabled} />
        {!pending && formError(editor.write.error, fields) && <p className="fault" role="alert">{formError(editor.write.error, fields)}</p>}
        <div className="band-save">
          <Button type="submit" variant="primary" write disabled={!canSave}>Save band…</Button>
          <p className="meta" role="status">{writesEnabled ? `${saveStatus(editor, errors, preview)} Only the owner saves the band.` : "Changes are switched off, so the band cannot be saved now."}</p>
        </div>
      </form>
      <BandConfirm pending={pending} onCancel={() => setPending(null)} onSave={() => void confirm()} sending={editor.write.sending} error={pending ? editor.write.error : null} />
    </Panel>
  </OperatorOnly>;
}
