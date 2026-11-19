// SPDX-License-Identifier: MIT
/**
 * The band editor's draft (screens §2.2 block 3, API spec §4.1), pure: the edge fields as typed, what one draft sends
 * (the API-23 query and the API-24 body come from the same function, so the preview is of exactly what Save sends), a
 * proposal loaded through the anchor overrides, the list of what a Save writes (from API-23's own answer, never
 * recomputed here) and the findings in words.
 *
 * Each axis is edited one of two ways. As edges (the default when the stored band's sunrise and sunset sit halfway
 * between day and night): four fields, the low and high edge by day (solar noon) and at night (solar midnight); a change
 * to any of them sends all four of that axis in the edge form, and the server puts sunrise and sunset halfway between.
 * Separately (the default when the stored band's sunrise and sunset do not sit halfway): the eight edge anchors of the
 * axis, sunrise, solar noon, sunset and solar midnight for the low and the high edge; each one changed is sent as a raw
 * anchor, so nothing the person did not type moves. The eight target anchors the law does not read are never fields;
 * a proposal that names one sends it as an anchor override, listed in the confirm sheet.
 */
import { bandAnchorUnit, bandAnchorWords } from "../../lib/band-words";
import { sentenceStart } from "../../lib/format";
import type { BandProfilePreview, BandProfileState, BodyOf, ParamsOf, ReviewProposal } from "../../lib/operator-api";
import { keptNumber, parseDecimal } from "../../lib/setting-values";

export type Axis = "temp" | "vpd";
export type Side = "low" | "high";
export type Time = "day" | "night";
export type EdgeField = `${Axis}_${Side}_${Time}`;
export type AnchorTime = "sr" | "sm" | "ss" | "mid";

export const AXES: readonly Axis[] = ["temp", "vpd"];
export const SIDES: readonly Side[] = ["low", "high"];
/** The edge form's fields in the API's order (a both-forms refusal names the first given). */
export const EDGE_FIELDS: readonly EdgeField[] = [
  "temp_low_day", "temp_high_day", "temp_low_night", "temp_high_night", "vpd_low_day", "vpd_high_day", "vpd_low_night", "vpd_high_night",
];
export const ANCHOR_TIMES: readonly AnchorTime[] = ["sr", "sm", "ss", "mid"];
const TIME_ANCHOR: Readonly<Record<Time, AnchorTime>> = { day: "sm", night: "mid" };
export const AXIS_UNIT: Readonly<Record<Axis, "°F" | "kPa">> = { temp: "°F", vpd: "kPa" };
const AXIS_WORD: Readonly<Record<Axis, string>> = { temp: "temperature", vpd: "VPD" };

const parts = (field: EdgeField) => field.split("_") as [Axis, Side, Time];
export const axisOfField = (field: EdgeField): Axis => parts(field)[0];
/** `temp_low_day` → `band_temp_low_sm`. */
export const edgeParam = (field: EdgeField): string => {
  const [axis, side, time] = parts(field);
  return `band_${axis}_${side}_${TIME_ANCHOR[time]}`;
};
/** The eight edge anchors of an axis, low then high, each at sunrise, solar noon, sunset and solar midnight. */
export const axisAnchors = (axis: Axis): string[] => SIDES.flatMap((side) => ANCHOR_TIMES.map((at) => `band_${axis}_${side}_${at}`));
/** The sixteen edge anchors the law reads. */
export const EDGE_ANCHORS: readonly string[] = AXES.flatMap(axisAnchors);
const BAND_PARAM = /^band_(temp|vpd)_(low|high|target)_(sr|sm|ss|mid)$/;
export const isBandParam = (param: string): boolean => BAND_PARAM.test(param);
export const isEdgeAnchor = (param: string): boolean => EDGE_ANCHORS.includes(param);
const axisOfParam = (param: string): Axis | null => (BAND_PARAM.exec(param)?.[1] as Axis | undefined) ?? null;
const ORDER = [...EDGE_ANCHORS, ...AXES.flatMap((axis) => ANCHOR_TIMES.map((at) => `band_${axis}_target_${at}`))];
const byBandOrder = (a: string, b: string) => ORDER.indexOf(a) - ORDER.indexOf(b);

/**
 * A band row in words, starting with a capital, as the shared words have it: an edge anchor ("Temperature low edge at
 * sunrise"), a stored row of the older form the law does not read ("Temperature middle line at sunrise"); null for a
 * key that is not one of the band's 24 rows.
 */
export function bandRowWords(param: string): string | null {
  const words = bandAnchorWords(param);
  return words === null ? null : sentenceStart(words);
}

/** "Temperature low edge by day" for a field; the screen-reader name of its input. */
export function edgeFieldWords(field: EdgeField): string {
  const [axis, side, time] = parts(field);
  return sentenceStart(`${AXIS_WORD[axis]} ${side} edge ${time === "day" ? "by day" : "at night"}`);
}

/** The text of a field for a stored value: as stored (more decimals than the unit's when it carries them). */
export const fieldText = (value: number | null | undefined, unit: string): string => (value === null || value === undefined || !Number.isFinite(value) ? "" : keptNumber(value, null, unit));

export type Draft = {
  /** Per axis: edited as its eight edge anchors (true) or as four edges (false). */
  readonly split: Readonly<Record<Axis, boolean>>;
  /** The eight edge fields as typed. */
  readonly edges: Readonly<Record<EdgeField, string>>;
  /** The sixteen edge anchors as typed. */
  readonly anchors: Readonly<Record<string, string>>;
  /** Overrides no field shows: a proposal's target anchors, sent as they are. */
  readonly extra: Readonly<Record<string, number>>;
  /** The review whose proposal is loaded, if one is. */
  readonly proposal: number | null;
};

/** The stored edges: the API's `edges`, or (from an API before the edge form) the noon and midnight anchors. */
export function storedEdges(state: Pick<BandProfileState, "edges" | "anchors">): Record<EdgeField, number | null> {
  return Object.fromEntries(EDGE_FIELDS.map((field) => [field, state.edges?.[field] ?? state.anchors[edgeParam(field)] ?? null])) as Record<EdgeField, number | null>;
}

/** The draft as the band is stored: each axis split when its stored sunrise and sunset do not sit halfway (`edges_simple`). */
export function startDraft(state: Pick<BandProfileState, "edges" | "edges_simple" | "anchors" | "simple">): Draft {
  const edges = storedEdges(state);
  const simple = (axis: Axis) => state.edges_simple?.[axis] ?? state.simple;
  return {
    split: { temp: !simple("temp"), vpd: !simple("vpd") },
    edges: Object.fromEntries(EDGE_FIELDS.map((field) => [field, fieldText(edges[field], AXIS_UNIT[axisOfField(field)])])) as Record<EdgeField, string>,
    anchors: Object.fromEntries(EDGE_ANCHORS.map((param) => [param, fieldText(state.anchors[param], bandAnchorUnit(param) ?? "")])),
    extra: {},
    proposal: null,
  };
}

/** The draft with one axis edited the other way; the axis's fields start again from `base`, and its overrides go. */
export function setSplit(draft: Draft, base: Draft, axis: Axis, split: boolean): Draft {
  const edges = { ...draft.edges };
  for (const field of EDGE_FIELDS) if (axisOfField(field) === axis) edges[field] = base.edges[field];
  const anchors = { ...draft.anchors };
  for (const param of axisAnchors(axis)) anchors[param] = base.anchors[param];
  const extra = Object.fromEntries(Object.entries(draft.extra).filter(([param]) => axisOfParam(param) !== axis));
  return { ...draft, split: { ...draft.split, [axis]: split }, edges, anchors, extra };
}

export type Sent = {
  /** The edge form's fields, each axis given as all four of its edges or none. */
  readonly edges: Readonly<Partial<Record<EdgeField, number>>>;
  /** Raw anchors by param. */
  readonly anchors: Readonly<Record<string, number>>;
};
export type DraftRequest =
  | { readonly ok: true; readonly sent: Sent; readonly empty: boolean }
  | { readonly ok: false; readonly field: string; readonly message: string };

export const NOT_A_NUMBER = "Enter a number";

/**
 * What the draft sends, against the band as stored (`base`): for an axis edited as edges, all four of its edges once any
 * one differs or once the axis leaves the stored split; for an axis edited separately, each anchor that differs; and
 * every override. A changed field that does
 * not read as a number makes the draft invalid, naming that field (an edge field or an anchor param).
 */
export function draftRequest(draft: Draft, base: Draft): DraftRequest {
  const edges: Partial<Record<EdgeField, number>> = {};
  const anchors: Record<string, number> = {};
  for (const axis of AXES) {
    if (draft.split[axis]) {
      for (const param of axisAnchors(axis)) {
        const text = draft.anchors[param] ?? "";
        if (text === base.anchors[param]) continue;
        const value = parseDecimal(text);
        if (value === null) return { ok: false, field: param, message: NOT_A_NUMBER };
        anchors[param] = value;
      }
      continue;
    }
    const fields = EDGE_FIELDS.filter((field) => axisOfField(field) === axis);
    // An axis stored with sunrise and sunset set apart and now edited as edges sends its four edges even unchanged: that
    // is what puts its sunrise and sunset back halfway.
    if (!base.split[axis] && fields.every((field) => draft.edges[field] === base.edges[field])) continue;
    for (const field of fields) {
      const value = parseDecimal(draft.edges[field] ?? "");
      if (value === null) return { ok: false, field, message: NOT_A_NUMBER };
      edges[field] = value;
    }
  }
  for (const [param, value] of Object.entries(draft.extra)) anchors[param] = value;
  return { ok: true, sent: { edges, anchors }, empty: Object.keys(edges).length === 0 && Object.keys(anchors).length === 0 };
}

/** API-23's query for what a draft sends (`anchor` as `param:value`, in the band's order). */
export function previewQuery(sent: Sent): ParamsOf<"API-23"> {
  const anchor = Object.keys(sent.anchors).sort(byBandOrder).map((param) => `${param}:${sent.anchors[param]}`);
  return { ...sent.edges, ...(anchor.length ? { anchor } : {}) } as ParamsOf<"API-23">;
}

/** API-24's body for what a draft sends: the same numbers as the preview's query, with the reason. */
export function saveBody(sent: Sent, reason: string): BodyOf<"API-24"> {
  const trimmed = reason.trim();
  return { profile: { ...sent.edges }, anchors: { ...sent.anchors }, ...(trimmed ? { reason: trimmed } : {}) } as BodyOf<"API-24">;
}

export type LoadedProposal = { readonly draft: Draft; readonly ignored: readonly string[] };
/**
 * A proposal loaded into the draft through the anchor overrides: every axis it names is edited separately, so exactly
 * the anchors it names are sent with their proposed values and nothing else moves. An edge anchor shows in its field;
 * a target anchor is an override no field shows. A param that is not one of the band's 24 is left out and returned.
 */
export function loadProposal(draft: Draft, base: Draft, reviewId: number, proposal: Pick<ReviewProposal, "changes">): LoadedProposal {
  let next: Draft = { ...draft, extra: {} };
  const ignored: string[] = [];
  const named = proposal.changes.filter((change) => {
    if (isBandParam(change.param) && Number.isFinite(change.proposed)) return true;
    ignored.push(change.param);
    return false;
  });
  for (const axis of AXES) {
    if (named.some((change) => axisOfParam(change.param) === axis)) next = setSplit(next, base, axis, true);
  }
  const anchors = { ...next.anchors };
  const extra: Record<string, number> = {};
  for (const change of named) {
    if (isEdgeAnchor(change.param)) anchors[change.param] = fieldText(change.proposed, bandAnchorUnit(change.param) ?? "");
    else extra[change.param] = change.proposed;
  }
  return { draft: { ...next, anchors, extra, proposal: reviewId }, ignored };
}

export type ChangeLine = { readonly param: string; readonly words: string; readonly unit: string; readonly before: number | null; readonly after: number | null };
/**
 * What a Save writes, from API-23's answer for exactly that draft: each anchor in `changed` with its stored and its new
 * value as the server computed them, edges first, then the stored target rows the law does not read.
 */
export function changeLines(preview: Pick<BandProfilePreview, "changed" | "current" | "draft">): { readonly edges: ChangeLine[]; readonly targets: ChangeLine[] } {
  const lines = [...preview.changed].filter(isBandParam).sort(byBandOrder).map((param): ChangeLine => ({
    param, words: bandRowWords(param) ?? param, unit: bandAnchorUnit(param) ?? "",
    before: preview.current.anchors[param] ?? null, after: preview.draft.anchors[param] ?? null,
  }));
  return { edges: lines.filter((line) => isEdgeAnchor(line.param)), targets: lines.filter((line) => !isEdgeAnchor(line.param)) };
}

/** The input a finding or a refusal belongs to: an edge field, or in split mode that edge's anchor; a band anchor as is. */
export function inputOf(field: string | null | undefined, split: Readonly<Record<Axis, boolean>>): string | null {
  if (!field) return null;
  if ((EDGE_FIELDS as readonly string[]).includes(field)) {
    const edge = field as EdgeField;
    return split[axisOfField(edge)] ? edgeParam(edge) : edge;
  }
  return isEdgeAnchor(field) ? field : null;
}

/** The profile fields the band checks name when an axis is not given as edges, as the thing they are about. */
const PROFILE_SUBJECT: Readonly<Record<string, string>> = {
  temp_day: "Temperature band by day", temp_night: "Temperature band at night", temp_width_day: "Temperature band by day", temp_width_night: "Temperature band at night",
  vpd_day: "VPD band by day", vpd_night: "VPD band at night", vpd_above_day: "VPD band by day", vpd_above_night: "VPD band at night",
  vpd_below_day: "VPD low edge by day", vpd_below_night: "VPD low edge at night",
};
/** What a finding is about, in words: an edge field, a band anchor or a profile field; null when it names none. */
export function findingSubject(field: string): string | null {
  if ((EDGE_FIELDS as readonly string[]).includes(field)) return edgeFieldWords(field as EdgeField);
  return bandRowWords(field) ?? PROFILE_SUBJECT[field] ?? null;
}

/** A series' words: "the temperature low edge", "the stored VPD middle line" (the rows the law does not read). */
function seriesWords(axis: Axis, side: string): string {
  const name = (bandRowWords(`band_${axis}_${side}_sm`) ?? `${axis} ${side}`).replace(/ at solar noon$/, "");
  const lower = axis === "vpd" ? name : `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
  return side === "low" || side === "high" ? `the ${lower}` : `the stored ${lower}`;
}
/** The API's detail with the series it names in words (`temp_low` → "the temperature low edge"), starting with a capital. */
export function findingDetail(detail: string): string {
  return sentenceStart(detail.replace(/\b(temp|vpd)_(low|high|target)\b/g, (_match, axis: Axis, side: string) => seriesWords(axis, side)));
}
