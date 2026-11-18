// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Needs you (dashboard v2 screens §1 block 3, US-ACT-02) against #1122's fixture API in process: a late or failed daily
// review and a waiting proposal, each with Open into Review; the top three unacknowledged alerts by severity then age with
// the one count in the head (unless the answer counts them); Acknowledge sends one API-15 request with one
// Idempotency-Key; a mister's latch with Clear fault, read once; the settings not confirmed, into System → Data; a fence
// breach pointing to Stop all water; "Nothing needs you." with what was resolved in the last 24 h (linked only when there
// is some); viewers get no Acknowledge.
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { RECENT_ALERTS } from "../../lib/activity";
import type { Alert } from "../../lib/operator-api";
import { nowAnswer } from "../../lib/now-answer";
import { panelRead, useApiRead, useNowRead } from "../../lib/queries";
import { UUID, advance, renderWithApi, startFixtureApi, stopFixtureApi, writes } from "../../lib/test-fixture-api";
import { text } from "../test-render";
import { NOT_CONFIRMED_HREF, NeedsYou, RESOLVED_HREF, emptyLine, faultText, needsTally, openAlertsOf, resolvedCount, reviewRow, topAlerts } from "./needs-someone";

afterEach(() => { cleanup(); stopFixtureApi(); });

/** Now's two reads for the panel: API-14 (Activity's, open alerts and those resolved in 24 h), and API-02 for the count and the freshness. */
function Harness({ apiFailed = false }: { apiFailed?: boolean }) {
  const alerts = panelRead(useApiRead("API-14", RECENT_ALERTS, { intervalMs: 15_000 }));
  const irrigation = panelRead(useApiRead("API-IRR-01", {}, { intervalMs: 15_000 }));
  const now = useNowRead();
  const answer = nowAnswer({ now: now.data ?? null, failed: apiFailed });
  return <NeedsYou alerts={alerts} now={now.data ?? null} answer={answer} apiFailed={apiFailed} openCount={now.data?.alerts.open ?? null} irrigation={irrigation} />;
}
const panel = () => document.querySelector<HTMLElement>("section.panel")!;
const rows = () => [...panel().querySelectorAll<HTMLElement>("li.alert-row")];
const title = () => text(within(panel()).getByRole("heading", { level: 2 }));

test("alerts-merged: the unacknowledged rows, warning before info, Details links and Acknowledge; the count in the head only when the answer has not given it", async () => {
  startFixtureApi({ fixture: "alerts-merged" });
  renderWithApi(<Harness />);
  await advance(0);
  // The answer reads "2 things need someone", so the head does not count again (redesign §2.5).
  expect(title()).toBe("Needs you");
  expect(rows().map((row) => row.getAttribute("data-severity"))).toEqual(["warning", "info"]);
  expect(rows().map((row) => text(row.querySelector("h3")))).toEqual(["Relay stuck", "Soil probe offline"]);
  expect(text(rows()[0].querySelector(".alert-facts"))).toBe("Fan 2 · ×3 since 06:02 · last 06:40");
  expect(within(rows()[0]).getByRole("link", { name: /^Details/ }).getAttribute("href")).toBe("/activity?alert=101");
  expect(within(panel()).getByRole("link", { name: /All alerts/ }).getAttribute("href")).toBe("/activity");
  expect(within(panel()).getAllByRole("button", { name: /^Acknowledge/ })).toHaveLength(2);
  // The acknowledged repeat (103) is not one that needs someone.
  expect(text(panel())).not.toContain("fog_rh_ceiling_pct");
});

test("Acknowledge sends one API-15 request with one key, then the row disappears and the count drops", async () => {
  const api = startFixtureApi({ fixture: "alerts-merged" });
  renderWithApi(<Harness />);
  await advance(0);
  fireEvent.click(within(rows()[0]).getByRole("button", { name: /^Acknowledge/ }));
  await advance(0);
  const sent = writes(api);
  expect(sent).toEqual([expect.objectContaining({ method: "POST", operationId: "API-15", path: "/api/v1/alerts/101/ack", body: null })]);
  expect(sent[0].idempotency_key).toMatch(UUID);
  expect(rows()).toHaveLength(1);
  expect(text(panel())).not.toContain("Acknowledged by jason");
  expect(within(rows()[0]).getByRole("button", { name: /^Acknowledge/ })).toBeTruthy();
  await advance(0);
  // One open now, and the answer still counts it ("1 thing needs someone").
  expect(title()).toBe("Needs you");
});

test("the head counts the open alerts when the answer says something else first: an out-of-band reading", async () => {
  startFixtureApi({ fixture: ["alerts-merged", "too-hot"] });
  renderWithApi(<Harness />);
  await advance(0);
  expect(title()).toBe("Needs you · 2");
});

test("a latched mister reads once, on its alert's row with Clear fault; the settings not confirmed link to System → Data, unless the stuck banner says so", async () => {
  const api = startFixtureApi({ fixture: ["mister-fault", "settings-unconfirmed"] });
  renderWithApi(<Harness />);
  await advance(0);
  const faulted = rows().find((row) => text(row.querySelector("h3")) === "A mister zone faulted")!;
  expect(document.querySelectorAll("[data-water=fault]")).toHaveLength(0);
  fireEvent.click(within(faulted).getByRole("button", { name: "Clear fault on Center mister" }));
  await advance(0);
  expect(writes(api)).toEqual([expect.objectContaining({ operationId: "API-IRR-13", body: { line_id: "L04" } })]);
  const unconfirmed = within(panel()).getByRole("link", { name: /^2 settings not confirmed/ });
  expect(unconfirmed.getAttribute("href")).toBe("/system/data");
  cleanup();
  stopFixtureApi();
  // With no alert naming it, a latch has its own row; while delivery is stuck the banner says so and the link does not repeat it.
  startFixtureApi({ fixture: ["mister-fault", "stuck-delivery"] });
  renderWithApi(<Harness />);
  await advance(0);
  expect(within(panel()).queryByRole("link", { name: /not confirmed/ })).toBeNull();
});

test("a mister's fault in words: a back-off until its time, a latch until midnight, a code this build lacks raw", () => {
  const line = { line_id: "L07", name: "Mister • South Wall", fault_until: "2026-11-02T20:20:00Z" };
  expect(faultText({ ...line, fault: "backing_off" })).toBe("South mister: backing off until 13:20");
  expect(faultText({ ...line, fault: "mister_fault" })).toBe("South mister: faulted, no misting until midnight (watchdog)");
  expect(faultText({ ...line, fault: "brand_new" })).toBe("South mister: brand_new");
});

test("a fence breach in Needs you points to Stop all water under Water today instead of repeating it", async () => {
  startFixtureApi({ fixture: "fence-breach" });
  renderWithApi(<Harness />);
  await advance(0);
  expect(text(panel())).toContain("Stop all water is under Water today.");
  expect(within(panel()).queryByRole("button", { name: /Stop all water/ })).toBeNull();
  // A viewer has no Stop all water, so the row points at none.
  cleanup();
  stopFixtureApi();
  startFixtureApi({ fixture: ["fence-breach", "viewer-session"] });
  renderWithApi(<Harness />, { role: "viewer", writesEnabled: true });
  await advance(0);
  expect(rows().length).toBeGreaterThan(0);
  expect(text(panel())).not.toContain("Stop all water is under");
});

test("an optional note goes with the acknowledgement, at most 500 characters", async () => {
  const api = startFixtureApi({ fixture: "alerts-merged" });
  renderWithApi(<Harness />);
  await advance(0);
  const row = rows()[0];
  fireEvent.click(within(row).getByText("Add a note"));
  const note = within(row).getByLabelText("Note (optional)");
  expect(note.getAttribute("maxlength")).toBe("500");
  fireEvent.change(note, { target: { value: "Breaker reset" } });
  fireEvent.click(within(row).getByRole("button", { name: /^Acknowledge/ }));
  await advance(0);
  expect(writes(api)).toEqual([expect.objectContaining({ operationId: "API-15", body: { note: "Breaker reset" } })]);
});

test("Acknowledge is disabled while changes are switched off, and a viewer sees none", async () => {
  startFixtureApi({ fixture: ["alerts-merged", "writes-off"] });
  renderWithApi(<Harness />, { role: "operator", writesEnabled: false });
  await advance(0);
  expect(within(panel()).getAllByRole("button", { name: /^Acknowledge/ }).every((button) => button.hasAttribute("disabled"))).toBe(true);
  cleanup();
  stopFixtureApi();
  startFixtureApi({ fixture: ["alerts-merged", "viewer-session"] });
  renderWithApi(<Harness />, { role: "viewer", writesEnabled: false });
  await advance(0);
  expect(rows()).toHaveLength(2);
  expect(within(panel()).queryByRole("button", { name: /^Acknowledge/ })).toBeNull();
  expect(document.querySelectorAll("[data-write-control]")).toHaveLength(0);
});

test.each([
  ["in-band", "Nothing needs you. Nothing resolved in 24 h.", null],
  ["alert-resolved", "Nothing needs you.", "1 resolved in 24 h ›"],
  ["ingestor-not-running", "In-app alerts may be missing: ingestor not running since 10:38", null],
  ["controller-not-reporting", "In-app alerts may be missing: no data since 10:36", null],
])("%s with nothing open reads \"%s\", linking %s", async (name, expected, link) => {
  startFixtureApi({ fixture: name });
  renderWithApi(<Harness />);
  await advance(0);
  expect(text(panel().querySelector(".panel-empty p"))).toBe(expected);
  // Only an honest "Nothing needs you." offers the alerts resolved in the last 24 h, and only when there are some to open.
  const widen = panel().querySelector(".panel-empty a");
  expect(widen ? [text(widen), widen.getAttribute("href")] : null).toEqual(link ? [link, RESOLVED_HREF] : null);
  expect(RESOLVED_HREF).toBe("/activity?resolved=24h");
});

test("the resolved count: closed rows on a whole page, unknown on a cut one; the empty line links only to something there", () => {
  const row = (id: number, status: Alert["status"]) => ({ id, status }) as Alert;
  const page = { items: [row(1, "open"), row(2, "resolved"), row(3, "acknowledged"), row(4, "false_positive")], next_cursor: null };
  expect(resolvedCount(page)).toBe(2);
  expect(resolvedCount({ ...page, next_cursor: "c2" })).toBeNull();
  expect(resolvedCount(null)).toBeNull();
  const words = (line: ReturnType<typeof emptyLine>) => [line.message, line.widen ? text(renderWithApi(<>{line.widen.label}</>).container) : null];
  expect(words(emptyLine("No open alerts", 3))).toEqual(["Nothing needs you.", "3 resolved in 24 h ›"]);
  cleanup();
  expect(words(emptyLine("No open alerts", null))).toEqual(["Nothing needs you.", "Resolved in the last 24 h ›"]);
  cleanup();
  expect(emptyLine("No open alerts", 0)).toEqual({ message: "Nothing needs you. Nothing resolved in 24 h." });
  expect(emptyLine("In-app alerts may be missing: no data since 10:36", 3)).toEqual({ message: "In-app alerts may be missing: no data since 10:36" });
});

test("while the ingestor is not running the rows show with a note that more may be missing; a failed read reads Alerts unavailable", async () => {
  startFixtureApi({ fixture: ["alerts-merged", "ingestor-not-running"] });
  renderWithApi(<Harness />);
  await advance(0);
  expect(rows()).toHaveLength(2);
  expect(text(panel().querySelector("[data-alerts=coverage]"))).toBe("In-app alerts may be missing: ingestor not running since 10:38");
  cleanup();
  stopFixtureApi();
  startFixtureApi({ fixture: "alerts-merged", fail: { "API-14": 503 } });
  renderWithApi(<Harness />);
  await advance(0);
  expect(text(panel().querySelector(".panel-error"))).toBe("Alerts unavailableRetry");
  expect(within(panel()).getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(text(panel())).not.toContain("Nothing needs you");
});

test("with API-02 failing an empty list cannot vouch for itself", async () => {
  startFixtureApi({ fixture: "in-band" });
  renderWithApi(<Harness apiFailed />);
  await advance(0);
  expect(text(panel().querySelector(".panel-empty p"))).toBe("In-app alerts may be missing: can't reach the greenhouse data");
});

test("the top three: critical, warning, info, each in API-14's order; acknowledged and successfully dismissed rows never return", () => {
  const alert = (id: number, severity: string, firstSeen: string, status = "open"): Alert => ({
    id, alert_type: "relay_stuck", category: "system", severity, message: "", zone: null, metric_value: null, threshold_value: null, status,
    first_seen_at: firstSeen, last_seen_at: null, count: 1, acknowledged_at: null, acknowledged_by: null, notes: null, resolved_at: null, resolved_by: null,
    resolution: null, runbook: null,
  });
  const items = [
    alert(1, "info", "2026-11-02T10:00:00Z"), alert(2, "warning", "2026-11-02T12:00:00Z"), alert(3, "critical", "2026-11-02T14:00:00Z"),
    alert(4, "warning", "2026-11-02T11:00:00Z"), alert(5, "critical", "2026-11-02T09:00:00Z", "acknowledged"),
  ];
  // Within a severity the API's order stands (it sorts by last seen, newest first), never Now's own idea of age.
  expect(topAlerts(items).map((item) => item.id)).toEqual([3, 2, 4]);
  expect(topAlerts(items, new Map([[5, items[4]]])).map((item) => item.id)).toEqual([3, 2, 4]);
  expect(topAlerts(items, new Map([[3, items[2]]])).map((item) => item.id)).toEqual([2, 4, 1]);
  const recurring = items.map((item) => item.id === 3 ? { ...item, count: 2, last_seen_at: "2026-11-02T14:05:00Z" } : item);
  expect(topAlerts(recurring, new Map([[3, items[2]]])).map((item) => item.id)).toEqual([3, 2, 4]);
  // The read holds what was resolved in the last 24 h: none shows, not even one acknowledged here and resolved since.
  const resolved = [...items, alert(6, "critical", "2026-11-02T08:00:00Z", "resolved")];
  expect(topAlerts(resolved, new Map([[6, resolved[5]]])).map((item) => item.id)).toEqual([3, 2, 4]);
  expect(topAlerts(items.map((item) => (item.id === 5 ? { ...item, status: "resolved" } : item)), new Map([[5, items[4]]])).map((item) => item.id)).toEqual([3, 2, 4]);
});

test("a late daily review: one row with Open into Review, and its daily_review_missed alert is not listed again", async () => {
  startFixtureApi({ fixture: "review-missed" });
  renderWithApi(<Harness />);
  await advance(0);
  const row = panel().querySelector<HTMLElement>("[data-needs=review]")!;
  expect(text(row.querySelector("h3"))).toMatch(/^Daily review late for /);
  expect(within(row).getByRole("link", { name: /^Open/ }).getAttribute("href")).toBe("/review");
  expect(rows().some((alert) => alert.getAttribute("data-type") === "daily_review_missed" || /review/i.test(text(alert.querySelector("h3"))))).toBe(false);
});

test("a failed review reads failed; a waiting proposal has its own row with Open into Review", async () => {
  startFixtureApi({ fixture: "review-failed" });
  renderWithApi(<Harness />);
  await advance(0);
  expect(text(panel().querySelector("[data-needs=review] h3"))).toMatch(/^Daily review failed for /);
  cleanup();
  stopFixtureApi();
  startFixtureApi({ fixture: "review-proposal-waiting" });
  renderWithApi(<Harness />);
  await advance(0);
  const proposal = panel().querySelector<HTMLElement>("[data-needs=proposal]")!;
  expect(text(proposal.querySelector("h3"))).toBe("A band proposal is waiting for you");
  expect(within(proposal).getByRole("link", { name: /^Open/ }).getAttribute("href")).toBe("/review");
  expect(NOT_CONFIRMED_HREF).toBe("/system/data");
});

test("the review row: late or failed only", () => {
  const review = { missed: false, proposal_waiting: false, review_date: "2026-11-02", status: "written", written_at: "2026-11-02T14:10:00Z" } as const;
  expect(reviewRow(review)).toBeNull();
  expect(reviewRow(null)).toBeNull();
  expect(reviewRow({ ...review, missed: true, status: "due" })?.title).toBe("Daily review late for Nov 2");
  expect(reviewRow({ ...review, status: "failed" })?.tone).toBe("fault");
});

test("needsTally counts what the panel lists, so the hero's headline agrees with it (B11)", () => {
  const alert = (id: number, alertType: string, status = "open", details: Record<string, unknown> | null = null): Alert => ({
    id, alert_type: alertType, category: "system", severity: "warning", message: "", zone: null, metric_value: null, threshold_value: null, status,
    first_seen_at: "2026-11-02T10:00:00Z", last_seen_at: null, count: 1, acknowledged_at: null, acknowledged_by: null, notes: null, resolved_at: null,
    resolved_by: null, resolution: null, runbook: null, details,
  } as Alert);
  const items = [alert(1, "relay_stuck"), alert(2, "relay_stuck"), alert(3, "relay_stuck"), alert(4, "relay_stuck"), alert(5, "relay_stuck", "acknowledged"), alert(6, "relay_stuck", "resolved")];
  const page = { items, next_cursor: null } as never;
  // Every open, unacknowledged alert counts, past the three the panel shows; acknowledged and resolved ones do not.
  expect(openAlertsOf(items)).toHaveLength(4);
  expect(needsTally({ alerts: page, review: null, lines: [] })).toBe(4);
  // One acknowledged here drops out at once, as it does from the list.
  expect(needsTally({ alerts: page, review: null, lines: [], dismissed: new Map([[1, items[0]]]) })).toBe(3);
  // A late review is one row, its own alert folded into it; a waiting proposal is one more.
  const late = { review_date: "2026-11-01", status: "missed", missed: true, proposal_waiting: true } as never;
  const missed = { items: [alert(7, "daily_review_missed")], next_cursor: null } as never;
  expect(needsTally({ alerts: missed, review: late, lines: [] })).toBe(2);
  // A mister fault no open alert names is a row; a latch its alert names is that alert's row.
  const latched = { items: [alert(8, "irrigation_line_faulted", "open", { line_id: "L05" })], next_cursor: null } as never;
  const lines = [{ line_id: "L05", fault: "mister_fault" }, { line_id: "L06", fault: "backing_off" }, { line_id: "L01", fault: null }] as never;
  expect(needsTally({ alerts: latched, review: null, lines })).toBe(2);
  // Before the read answers the hero counts API-02's alerts instead.
  expect(needsTally({ alerts: null, review: null, lines: [] })).toBeNull();
});
