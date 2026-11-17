// SPDX-License-Identifier: MIT
// The band editor's draft model (screens 2.2 block 3, API spec 4.1), pure: the draft starts from the band as stored, per
// axis as four edges or as eight anchors; what a draft sends is one value set that is both the preview's query and
// Save's body; a proposal loads through the anchor overrides; the change lines come from API-23's answer; findings name
// their edge in words.
import { expect, test } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import { parseBandProfilePreview, type BandProfilePreview } from "../../lib/operator-api";
import {
  EDGE_ANCHORS, NOT_A_NUMBER, axisAnchors, bandRowWords, changeLines, draftRequest, edgeFieldWords, edgeParam, findingDetail, findingSubject,
  inputOf, isBandParam, isEdgeAnchor, loadProposal, previewQuery, saveBody, setSplit, startDraft, storedEdges, type Draft,
} from "./band-draft";

const NOW = Date.parse("2026-11-02T17:42:00Z");
const live = (): BandProfilePreview => parseBandProfilePreview(fixture("in-band", { now: NOW })["API-23"]) as BandProfilePreview;
/** A stored state with sunrise and sunset halfway on both axes (as band.mjs `band-edges-simple` stores it). */
const simpleState = () => {
  const state = live().current;
  return { ...state, edges_simple: { temp: true, vpd: true } };
};

test("the eight edge fields map to the noon and midnight anchors, and the band's 24 rows are told apart", () => {
  expect(edgeParam("temp_low_day")).toBe("band_temp_low_sm");
  expect(edgeParam("vpd_high_night")).toBe("band_vpd_high_mid");
  expect(axisAnchors("temp")).toEqual(["band_temp_low_sr", "band_temp_low_sm", "band_temp_low_ss", "band_temp_low_mid", "band_temp_high_sr", "band_temp_high_sm", "band_temp_high_ss", "band_temp_high_mid"]);
  expect(EDGE_ANCHORS).toHaveLength(16);
  expect(isBandParam("band_temp_target_sr")).toBe(true);
  expect(isEdgeAnchor("band_temp_target_sr")).toBe(false);
  expect(isBandParam("dry_cost_limit_kwh_per_kg")).toBe(false);
  expect(edgeFieldWords("vpd_low_night")).toBe("VPD low edge at night");
  expect(edgeFieldWords("temp_high_day")).toBe("Temperature high edge by day");
});

test("the draft starts from the band as stored: the live band has sunrise and sunset apart on both axes, so both start split", () => {
  const state = live().current;
  expect(state.edges_simple).toEqual({ temp: false, vpd: false });
  const draft = startDraft(state);
  expect(draft.split).toEqual({ temp: true, vpd: true });
  expect(draft.edges.temp_low_day).toBe("71.8");
  expect(draft.edges.temp_low_night).toBe("60.7");
  // Stored values keep the decimals they carry, so an untouched field is never a change.
  expect(draft.anchors.band_vpd_low_sm).toBe("0.862");
  expect(draft.anchors.band_temp_low_sr).toBe("62.5");
  expect(draftRequest(draft, draft)).toEqual({ ok: true, sent: { edges: {}, anchors: {} }, empty: true });
  expect(startDraft(simpleState()).split).toEqual({ temp: false, vpd: false });
});

test("storedEdges falls back to the noon and midnight anchors on an API before the edge form", () => {
  const state = live().current;
  expect(storedEdges({ anchors: state.anchors, edges: null }).vpd_high_day).toBe(state.anchors.band_vpd_high_sm);
  expect(startDraft({ anchors: state.anchors, edges: null, edges_simple: null, simple: true }).split).toEqual({ temp: false, vpd: false });
});

test("an axis edited as edges sends all four of its edges once one changes; the other axis sends nothing", () => {
  const base = startDraft(simpleState());
  const draft: Draft = { ...base, edges: { ...base.edges, temp_low_night: "62.7" } };
  const request = draftRequest(draft, base);
  expect(request).toEqual({ ok: true, empty: false, sent: { edges: { temp_low_day: 71.8, temp_high_day: 85.8, temp_low_night: 62.7, temp_high_night: 70.7 }, anchors: {} } });
  if (!request.ok) throw new Error("not ok");
  // The preview's query and Save's body carry the same numbers.
  expect(previewQuery(request.sent)).toEqual({ temp_low_day: 71.8, temp_high_day: 85.8, temp_low_night: 62.7, temp_high_night: 70.7 });
  expect(saveBody(request.sent, "  Warmer nights ")).toEqual({ profile: { temp_low_day: 71.8, temp_high_day: 85.8, temp_low_night: 62.7, temp_high_night: 70.7 }, anchors: {}, reason: "Warmer nights" });
  expect(saveBody(request.sent, " ")).not.toHaveProperty("reason");
});

test("an axis stored split and switched to edges sends its four edges unchanged, which puts sunrise and sunset back halfway", () => {
  const base = startDraft(live().current);
  const draft = setSplit(base, base, "vpd", false);
  expect(draft.split).toEqual({ temp: true, vpd: false });
  const request = draftRequest(draft, base);
  expect(request.ok && request.sent.edges).toEqual({ vpd_low_day: 0.862, vpd_high_day: 1.39, vpd_low_night: 0.738, vpd_high_night: 1.27 });
  // Back to split: the axis starts again from the band as stored, so nothing is sent.
  expect(draftRequest(setSplit(draft, base, "vpd", true), base)).toMatchObject({ ok: true, empty: true });
});

test("an axis edited split sends each anchor that differs, as `param:value` in the band's order", () => {
  const base = startDraft(live().current);
  const draft: Draft = { ...base, anchors: { ...base.anchors, band_temp_high_mid: "71.5", band_temp_low_sr: "63" } };
  const request = draftRequest(draft, base);
  expect(request).toEqual({ ok: true, empty: false, sent: { edges: {}, anchors: { band_temp_high_mid: 71.5, band_temp_low_sr: 63 } } });
  if (!request.ok) throw new Error("not ok");
  expect(previewQuery(request.sent)).toEqual({ anchor: ["band_temp_low_sr:63", "band_temp_high_mid:71.5"] });
  expect(saveBody(request.sent, "")).toEqual({ profile: {}, anchors: { band_temp_high_mid: 71.5, band_temp_low_sr: 63 } });
});

test("a changed field that does not read as a number makes the draft invalid, naming that field", () => {
  const base = startDraft(simpleState());
  expect(draftRequest({ ...base, edges: { ...base.edges, vpd_high_day: "dry" } }, base)).toEqual({ ok: false, field: "vpd_high_day", message: NOT_A_NUMBER });
  const split = startDraft(live().current);
  expect(draftRequest({ ...split, anchors: { ...split.anchors, band_vpd_low_ss: "" } }, split)).toEqual({ ok: false, field: "band_vpd_low_ss", message: NOT_A_NUMBER });
});

test("a proposal loads through the anchor overrides: exactly what it names, edges into fields, targets as overrides, the rest left out", () => {
  const base = startDraft(simpleState());
  const { draft, ignored } = loadProposal(base, base, 9, {
    changes: [
      { param: "band_temp_low_sr", label: "Band Temp Low SR", unit: "°F", current: 62.5, proposed: 64.5 },
      { param: "band_temp_target_mid", label: "Band Temp Target MID", unit: "°F", current: 65.7, proposed: 66.7 },
      { param: "mister_engage_kpa", label: "Mister engage", unit: "kPa", current: 1.2, proposed: 1.3 },
    ],
  });
  expect(ignored).toEqual(["mister_engage_kpa"]);
  expect(draft.proposal).toBe(9);
  // Only the axis it names opens split; the field shows the proposed edge, the target is an override no field shows.
  expect(draft.split).toEqual({ temp: true, vpd: false });
  expect(draft.anchors.band_temp_low_sr).toBe("64.5");
  expect(draft.extra).toEqual({ band_temp_target_mid: 66.7 });
  const request = draftRequest(draft, base);
  expect(request.ok && request.sent).toEqual({ edges: {}, anchors: { band_temp_low_sr: 64.5, band_temp_target_mid: 66.7 } });
  // Switching the axis back to edges drops its overrides with it.
  expect(setSplit(draft, base, "temp", false).extra).toEqual({});
});

test("the change lines come from API-23's answer for the draft: edges first in the band's order, then the stored target rows", () => {
  const preview = live();
  const current = preview.current.anchors;
  const lines = changeLines({
    changed: ["band_temp_target_sr", "band_temp_low_mid", "band_temp_low_sr", "dry_cost_limit_kwh_per_kg"],
    current: preview.current,
    draft: { ...preview.current, anchors: { ...current, band_temp_low_sr: 64.5, band_temp_low_mid: 62.7, band_temp_target_sr: 68 } },
  });
  expect(lines.edges.map((line) => [line.words, line.before, line.after, line.unit])).toEqual([
    ["Temperature low edge at sunrise", 62.5, 64.5, "°F"],
    ["Temperature low edge at solar midnight", 60.7, 62.7, "°F"],
  ]);
  expect(lines.targets.map((line) => line.param)).toEqual(["band_temp_target_sr"]);
});

test("a finding or a refusal lands on its input: the edge field, or that edge's noon or midnight anchor when the axis is split", () => {
  expect(inputOf("temp_low_night", { temp: false, vpd: false })).toBe("temp_low_night");
  expect(inputOf("temp_low_night", { temp: true, vpd: false })).toBe("band_temp_low_mid");
  expect(inputOf("band_vpd_high_ss", { temp: false, vpd: true })).toBe("band_vpd_high_ss");
  expect(inputOf("vpd_below_night", { temp: false, vpd: false })).toBeNull();
  expect(inputOf(null, { temp: false, vpd: false })).toBeNull();
});

test("findings name their edge in words, never a field or series name", () => {
  expect(findingSubject("vpd_low_night")).toBe("VPD low edge at night");
  expect(findingSubject("band_temp_low_sr")).toBe("Temperature low edge at sunrise");
  expect(findingSubject("temp_width_night")).toBe("Temperature band at night");
  expect(findingSubject("anchor")).toBeNull();
  expect(findingDetail("temp_low leaves its anchor range by 1.5 °F")).toBe("The temperature low edge leaves its anchor range by 1.5 °F");
  expect(findingDetail("vpd_target crosses vpd_high")).toBe("The stored VPD middle line crosses the VPD high edge");
  expect(bandRowWords("band_temp_target_mid")).toBe("Temperature middle line at solar midnight");
  expect(bandRowWords("band_vpd_high_ss")).toBe("VPD high edge at sunset");
  expect(bandRowWords("dry_cost_limit_kwh_per_kg")).toBeNull();
});
