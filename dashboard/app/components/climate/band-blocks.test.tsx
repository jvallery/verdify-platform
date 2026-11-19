// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// The Band page's other blocks (screens 2.2) against the fixture API in process: the proposal (block 1) with its changes,
// reason and price row by row, Load and Dismiss and `?proposal=`; the band on the controller (block 4) and its summary;
// the band's changes (block 5); how the band works (block 6) with the law's own offsets.
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { fixture } from "../../../e2e/fixtures/index.mjs";
import type { ActivityEntry, Setting } from "../../lib/operator-api";
import type { Session } from "../../lib/session";
import { NOW, OPERATOR, advance, renderWithApi, startFixtureApi, stopFixtureApi, type FixtureOptions } from "../../lib/test-fixture-api";
import { renderUi, text } from "../test-render";
import { BandDeliveryPanel, deliveryStatus, deliverySummary, edgeRows, inForceText } from "./band-delivery";
import { BandExplainer, diagramSteps } from "./band-explainer";
import { BandHistoryPanel, historyHead, historyLines } from "./band-history";
import { BandProposalPanel, proposalLines, proposalReview, requestedProposal, type BandProposalPanelProps } from "./band-proposal";

async function settle() {
  for (let pass = 0; pass < 4; pass++) {
    await advance(10);
    await act(async () => { await vi.dynamicImportSettled(); });
  }
}
async function mount(ui: React.ReactElement, options: FixtureOptions = {}, session: Partial<Session> = OPERATOR, path = "/band") {
  startFixtureApi(options);
  renderWithApi(ui, session, path);
  await settle();
}
const panel = (name: string) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;
afterEach(() => { cleanup(); stopFixtureApi(); });

const LAW_LINES = { heat1_on_above_low_f: 3.5, heat2_on_above_low_f: 0.5, cool_on_above_high_f: 0, fan2_on_above_high_f: 1.5, dry_on_above_vpd_low_kpa: 0.05, fog_on_above_vpd_high_kpa: 0, mist_on_above_vpd_high_kpa: 0.3 };

// ---------------------------------------------------------------------------------------------------- block 1
function proposalProps(overrides: Partial<BandProposalPanelProps> = {}): BandProposalPanelProps {
  return { requested: null, loaded: null, ready: true, onLoad: vi.fn(() => []), ...overrides };
}

test("requestedProposal reads a review id from ?proposal=, and nothing else", () => {
  expect(requestedProposal(new URLSearchParams("proposal=9"))).toBe(9);
  expect(requestedProposal(new URLSearchParams("proposal=nine"))).toBeNull();
  expect(requestedProposal(new URLSearchParams(""))).toBeNull();
});

test("proposalReview picks the review the URL names, else the waiting one; each change is named in words with its unit", () => {
  const page = fixture("review-proposal-waiting", { now: NOW })["API-34"];
  expect(proposalReview(page, null)?.id).toBe(page.proposal_waiting.review_id);
  expect(proposalReview(page, 999)).toBeNull();
  const lines = proposalLines(proposalReview(page, null)!.proposal!);
  expect(lines.map((line) => [line.words, line.current, line.proposed.replace(" ", " ")])).toEqual([
    ["Temperature low edge at sunrise", "62.5", "64.5 °F"],
    ["Temperature low edge at solar midnight", "60.7", "62.7 °F"],
  ]);
  expect(proposalLines({ changes: [{ param: "band_vpd_target_sm", label: "x", unit: "kPa", current: 1, proposed: 1.1 }] })[0].words).toBe("VPD middle line at solar noon");
});

test("a waiting proposal shows its changes, reason and price row by row; Load fills the editor and Dismiss hides it", async () => {
  const props = proposalProps();
  await mount(<BandProposalPanel {...props} />, { fixture: "review-proposal-waiting" });
  const block = panel("Proposal from the daily review");
  expect(text(block)).toContain("Waiting");
  expect(text(block)).toMatch(/The daily review of \d+ \w+ proposes a change:/);
  expect(within(block).getAllByRole("listitem").map((item) => text(item))).toContain("Temperature low edge at sunrise 62.5 → to  64.5 °F");
  expect(text(block)).toContain("Why: VPD ran below the band on most nights");
  // The price is one text in the stored form, one quoted price-list row a line: each line is its own row.
  const price = block.querySelector(".band-proposal-price ul") as HTMLElement;
  const rows = within(price).getAllByRole("listitem").map((item) => text(item));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatch(/^Low edge only, sunrise and midnight 2 F higher: Therms\/day \+0\.31 \/ \+0\.31; .*Nights dried \(of 100\) \+8 \/ \+13$/);
  expect(rows[1]).toMatch(/^Low edge only, sunrise and midnight 1 F higher: /);
  fireEvent.click(within(block).getByRole("button", { name: "Load into the editor" }));
  expect(props.onLoad).toHaveBeenCalledWith(9, expect.objectContaining({ changes: expect.any(Array) }));
  fireEvent.click(within(block).getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("heading", { name: "Proposal from the daily review" })).toBeNull();
});

test("?proposal=<id> loads it on arrival once the editor has its band, and the button then reads Loaded", async () => {
  const onLoad = vi.fn(() => []);
  startFixtureApi({ fixture: "review-proposal-waiting" });
  const view = renderWithApi(<BandProposalPanel {...proposalProps({ requested: 9, ready: false, onLoad })} />, OPERATOR, "/band?proposal=9");
  await settle();
  expect(onLoad).not.toHaveBeenCalled();
  view.rerender(<BandProposalPanel {...proposalProps({ requested: 9, ready: true, onLoad })} />);
  await settle();
  expect(onLoad).toHaveBeenCalledTimes(1);
  view.rerender(<BandProposalPanel {...proposalProps({ requested: 9, ready: true, loaded: 9, onLoad })} />);
  expect((within(panel("Proposal from the daily review")).getByRole("button", { name: "Loaded" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onLoad).toHaveBeenCalledTimes(1);
});

test("a viewer reads the proposal with no control, and is never loaded into an editor", async () => {
  const props = proposalProps({ requested: 9 });
  await mount(<BandProposalPanel {...props} />, { fixture: ["review-proposal-waiting", "viewer-session"] }, { role: "viewer", writesEnabled: false });
  const block = panel("Proposal from the daily review");
  expect(within(block).queryByRole("button")).toBeNull();
  expect(text(block)).toContain("Only the owner loads a proposal into the editor and saves it.");
  expect(props.onLoad).not.toHaveBeenCalled();
});

test("with no proposal waiting the block is absent; a named review without one says so; a failed read is the error state", async () => {
  await mount(<BandProposalPanel {...proposalProps()} />);
  expect(screen.queryByRole("heading", { name: "Proposal from the daily review" })).toBeNull();
  cleanup(); stopFixtureApi();
  await mount(<BandProposalPanel {...proposalProps({ requested: 9 })} />);
  expect(panel("Proposal from the daily review").getAttribute("data-state")).toBe("empty");
  expect(text(panel("Proposal from the daily review"))).toMatch(/proposed no band change/);
  cleanup(); stopFixtureApi();
  await mount(<BandProposalPanel {...proposalProps()} />, { fail: { "API-34": 503 } });
  expect(panel("Proposal from the daily review").getAttribute("data-state")).toBe("error");
});

// ---------------------------------------------------------------------------------------------------- block 4
const settingRows = (): Setting[] => fixture("in-band", { now: NOW })["API-09"].items as Setting[];

test("the delivery summary counts the sixteen edges by their readback and says it in the header's words", () => {
  const rows = edgeRows(settingRows());
  expect(rows).toHaveLength(16);
  expect(rows[0].words).toBe("Temperature low edge at sunrise");
  const confirmed = deliverySummary(rows);
  expect(confirmed.state).toBe("confirmed");
  expect(deliveryStatus(confirmed, true)).toBe("Every edge confirmed");
  const waiting = rows.map((row, index) => (index < 2 ? { ...row, setting: { ...row.setting, state: "requested" } } : index === 2 ? { ...row, setting: { ...row.setting, state: "not_confirmed" } } : row));
  const summary = deliverySummary(waiting);
  expect(summary.state).toBe("not_confirmed");
  expect(deliveryStatus(summary)).toBe("1 edge not confirmed · 2 waiting for the controller");
  expect(deliveryStatus(deliverySummary([]))).toBe("The band's edges are not in the settings catalog");
});

test("the band in force reads the controller's four edges, and says when the host's band differs", () => {
  const band = { temp_low_f: 61.2, temp_high_f: 70, vpd_low_kpa: 0.45, vpd_high_kpa: 0.8, differs: false } as Parameters<typeof inForceText>[0];
  expect(inForceText(band).replaceAll(" ", " ")).toBe("In force on the controller now: 61.2–70.0 °F and 0.45–0.80 kPa.");
  expect(inForceText({ ...band, differs: true })).toMatch(/differs from the band the host is sending/);
});

test("the delivery panel: every edge read back, the band in force, the last save of this visit, and its error state", async () => {
  const lastSave = { at: "2026-11-02T17:40:00Z", rows: [{ param: "band_temp_low_sr" }, { param: "band_temp_target_sr" }] } as never;
  await mount(<BandDeliveryPanel lastSave={lastSave} />);
  const block = panel("On the controller");
  expect(block.getAttribute("data-state")).toBe("ready");
  expect(text(block)).toContain("The controller has read back all 16 edges");
  expect(text(block)).toMatch(/In force on the controller now: [\d.]+–[\d.]+ °F/);
  // Only edges count as sent; the stored row the law does not read is not one.
  expect(text(block)).toMatch(/You saved 1 edge at 10:40; the controller has confirmed it\./);
  cleanup(); stopFixtureApi();
  await mount(<BandDeliveryPanel lastSave={null} />, { fail: { "API-09": 503 } });
  expect(panel("On the controller").getAttribute("data-state")).toBe("error");
});

// ---------------------------------------------------------------------------------------------------- block 5
const ENTRY = {
  id: 7, ts: "2026-11-02T16:20:00Z", actor: { name: "Jason" }, action: "band.write", target: "house band", reason: "Warmer nights",
  detail: { changes: [{ param: "band_temp_low_mid", before: 60.7, value: 62.7 }, { param: "band_temp_target_mid", before: 65.7, value: 66.7 }, { param: "dry_cost_limit_kwh_per_kg", before: 0.7, value: 0.8 }] },
} as unknown as ActivityEntry;

test("a band save in history names each band row in words, old to new, and leaves out what is not the band", () => {
  expect(historyLines(ENTRY).map((line) => [line.words, line.before, line.after])).toEqual([
    ["Temperature low edge at solar midnight", 60.7, 62.7], ["Temperature middle line at solar midnight", 65.7, 66.7],
  ]);
  expect(historyHead(ENTRY)).toMatch(/^\w+ \d+, 09:20 · Jason · 2 changes$/);
});

test("the changes panel is empty with no save yet, and its error state offers Retry", async () => {
  await mount(<BandHistoryPanel />);
  expect(panel("Changes").getAttribute("data-state")).toBe("empty");
  expect(text(panel("Changes"))).toContain("No band change is recorded yet.");
  cleanup(); stopFixtureApi();
  await mount(<BandHistoryPanel />, { fail: { "API-17": 503 } });
  expect(within(panel("Changes")).getByRole("button", { name: /Retry/ })).toBeTruthy();
});

// ---------------------------------------------------------------------------------------------------- block 6
test("the explainer's ladders put each rule at the law's own offset, and say less without them", () => {
  const temp = diagramSteps("temp", LAW_LINES, { hot: 100, cold: 40 }).map((step) => step.text.replaceAll(" ", " "));
  expect(temp).toEqual([
    "Hot limit, 100.0 °F: cooling overrides everything", "The second fan joins 1.5 °F above the high edge", "Cooling starts at the high edge: vent and lead fan",
    "High edge", "Electric heat starts 3.5 °F above the low edge", "The gas furnace starts 0.5 °F above the low edge", "Low edge",
    "Cold limit, 40.0 °F: heating overrides everything",
  ]);
  const vpd = diagramSteps("vpd", null, { hot: null, cold: null }).map((step) => step.text);
  expect(vpd).toEqual(["The misters join near the high edge", "Fog starts near the high edge: the air is too dry", "High edge", "Drying is wanted near the low edge and below: the air is too humid", "Low edge"]);
});

test("the explainer is one collapsed disclosure with its prose and the two ladders", () => {
  renderUi(<BandExplainer lines={LAW_LINES} hotLimit={100} coldLimit={40} />);
  const details = document.querySelector("details.band-explainer") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(text(details.querySelector("summary"))).toBe("How the band works");
  expect(text(details)).toContain("electric heat, for example, starts 3.5 °F above the low edge");
  const group = within(details).getByRole("group", { name: "Where the law acts around the band" });
  expect(within(group).getAllByRole("list")).toHaveLength(2);
});
