// SPDX-License-Identifier: MIT
import { formatNumber, formatValue } from "../../lib/format";
import type { ControllerHealth } from "../../lib/operator-api";
import { finite } from "../data/viz";

/**
 * The controller's hardware budget against its limits (screens section 10.2, rows 1 and 2), from API-35 alone: each
 * value, its warning and critical lines from `limits` (the one definition the estate alerts read too), and what
 * crossing one means, in words. Lower is worse for memory, the largest block, stack and free storage; higher is worse
 * for loop and storage write times. A value not reported is unknown, never inside its limit.
 */
export type BudgetLevel = "ok" | "warn" | "critical" | "unknown";
export type BudgetKey = "memory" | "block" | "loop" | "write" | "stack" | "entries";
export type BudgetItem = {
  readonly key: BudgetKey;
  readonly label: string;
  /** The value the meter draws, in `unit`. */
  readonly value: number | null;
  readonly unit: string;
  /** The value in words with its unit ("37 kB", "12,023 free of 13,734"). */
  readonly text: string;
  readonly worse: "lower" | "higher";
  readonly warning: number | null;
  readonly critical: number | null;
  readonly level: BudgetLevel;
  /** The limits in words: "warning under 25 kB, critical under 15 kB". */
  readonly limits: string;
  /** What crossing the line means, as the verdict says it; null while inside or unknown. */
  readonly crossed: string | null;
  /** A second line under the value: the companion reading. */
  readonly meta: string | null;
  /** What the value is, when the short label leaves it out: "Lowest in the last minute". */
  readonly note: string | null;
};

type Limits = ControllerHealth["limits"];

/** The level of `value` against its lines; unknown while the value is. */
export function levelOf(value: number | null | undefined, worse: "lower" | "higher", warning: number | null, critical: number | null): BudgetLevel {
  if (!finite(value)) return "unknown";
  const past = (line: number | null) => finite(line) && (worse === "lower" ? value < line : value > line);
  if (past(critical)) return "critical";
  if (past(warning)) return "warn";
  return "ok";
}

function limitWords(worse: "lower" | "higher", warning: number | null, critical: number | null, unit: string): string {
  const side = worse === "lower" ? "under" : "over";
  const show = (value: number) => (unit === "%" ? `${formatNumber(value)}% free` : formatValue(value, unit));
  const parts = [finite(warning) ? `warning ${side} ${show(warning)}` : null, finite(critical) ? `critical ${side} ${show(critical)}` : null].filter(Boolean);
  return parts.join(", ");
}

type Spec = {
  key: BudgetKey; label: string; value: number | null; unit: string; text?: string; worse: "lower" | "higher";
  warning: number | null; critical: number | null; meaning: { warn: string; critical?: string }; meta?: string | null; note?: string; what: (text: string, line: string) => string;
};
function item(spec: Spec): BudgetItem {
  const level = levelOf(spec.value, spec.worse, spec.warning, spec.critical);
  const text = spec.text ?? formatValue(spec.value, spec.unit);
  const lineValue = level === "critical" ? spec.critical : spec.warning;
  const lineText = finite(lineValue) ? (spec.unit === "%" ? `${formatNumber(lineValue)}%` : formatValue(lineValue, spec.unit)) : "";
  const crossed = level === "warn" || level === "critical"
    ? `${spec.what(text, `${level === "critical" ? "critical" : "warning"} line of ${lineText}`)}: ${level === "critical" ? spec.meaning.critical ?? spec.meaning.warn : spec.meaning.warn}.`
    : null;
  return {
    key: spec.key, label: spec.label, value: finite(spec.value) ? spec.value : null, unit: spec.unit, text, worse: spec.worse, warning: spec.warning,
    critical: spec.critical, level, limits: limitWords(spec.worse, spec.warning, spec.critical, spec.unit), crossed, meta: spec.meta ?? null, note: spec.note ?? null,
  };
}

/** Free storage entries as a share of all of them; null while either count is unknown. */
export function freeShare(used: number | null | undefined, free: number | null | undefined): number | null {
  if (!finite(used) || !finite(free) || used + free <= 0) return null;
  return (free / (used + free)) * 100;
}

/** The six budget items in screens order, each against its limits. */
export function budgetItems(health: ControllerHealth): BudgetItem[] {
  const limits: Limits = health.limits;
  const memory = health.heap.minute_low_kb ?? health.heap.free_kb;
  const block = health.heap.largest_block_minute_low_kb ?? health.heap.largest_block_kb;
  const share = freeShare(health.nvs.used_entries, health.nvs.free_entries);
  const entries = finite(health.nvs.used_entries) && finite(health.nvs.free_entries)
    ? `${formatNumber(health.nvs.free_entries, 0)} of ${formatNumber(health.nvs.used_entries + health.nvs.free_entries, 0)} entries free`
    : null;
  return [
    item({
      key: "memory", label: "Free memory", note: "Lowest in the last minute", value: memory, unit: "kB", worse: "lower", warning: limits.heap_warning_kb, critical: limits.heap_critical_kb,
      what: (text, line) => `Free memory fell to ${text} in the last minute, under the ${line}`,
      meaning: { warn: "memory is running short", critical: "the controller is close to running out of memory and may restart" },
      meta: `Now ${formatValue(health.heap.free_kb, "kB")} · lowest since restart ${formatValue(health.heap.min_free_kb, "kB")}`,
    }),
    item({
      key: "block", label: "Largest free block", note: "Lowest in the last minute", value: block, unit: "kB", worse: "lower", warning: limits.largest_block_kb, critical: null,
      what: (text, line) => `The largest free block is ${text}, under the ${line}`,
      meaning: { warn: "memory is broken into pieces too small for a large message" },
      meta: `Now ${formatValue(health.heap.largest_block_kb, "kB")}`,
    }),
    item({
      key: "loop", label: "Loop time", note: "The slowest loop", value: health.loop.worst_ms, unit: "ms", worse: "higher", warning: limits.loop_worst_ms, critical: null,
      what: (text, line) => `The slowest control loop took ${text}, over the ${line}`,
      meaning: { warn: "the law reacts late while the loop is this slow" },
    }),
    item({
      key: "write", label: "Storage write", note: "The slowest write", value: health.nvs.write_worst_ms, unit: "ms", worse: "higher", warning: limits.nvs_write_ms, critical: null,
      what: (text, line) => `A storage write took ${text}, over the ${line}`,
      meaning: { warn: "the gap log stops keeping a record while storage is this slow" },
    }),
    item({
      key: "stack", label: "Free stack", note: "The lowest the control loop reached", value: health.loop.stack_free_min_b, unit: "B", worse: "lower", warning: limits.stack_free_b, critical: null,
      what: (text, line) => `The control loop's free stack fell to ${text}, under the ${line}`,
      meaning: { warn: "the control loop is close to running out of stack" },
    }),
    item({
      key: "entries", label: "Storage entries", value: share, unit: "%", text: share === null ? "—" : `${formatNumber(share, 1)}% free`, worse: "lower", warning: limits.nvs_arm_free_pct, critical: limits.nvs_stop_free_pct,
      what: (_text, line) => `Only ${formatNumber(share, 1)}% of the storage entries are free, under the ${line}`,
      meaning: { warn: "the gap log does not arm with this little storage free", critical: "the gap log stops: storage is nearly full" },
      meta: entries,
    }),
  ];
}

export type Verdict = { readonly level: BudgetLevel; readonly title: string; readonly text: string; readonly more: number };

/**
 * The controller's health in words (screens section 10.2, row 1): not reporting; the first limit crossed, critical
 * before warning, and what it means; or healthy. Too little memory for an update over the air is a warning too.
 */
export function verdict(health: ControllerHealth): Verdict {
  if (!health.observed_at) return { level: "unknown", title: "Not reporting", text: "The controller has not reported its health in the last 15 minutes.", more: 0 };
  const items = budgetItems(health);
  const crossed = [...items.filter((row) => row.level === "critical"), ...items.filter((row) => row.level === "warn")].map((row) => ({ level: row.level, text: row.crossed! }));
  const free = health.heap.free_kb;
  if (finite(free) && free < health.limits.ota_free_kb) {
    crossed.push({ level: "warn", text: `Free memory is ${formatValue(free, "kB")}, under the ${formatValue(health.limits.ota_free_kb, "kB")} an update over the air needs: an update may fail until memory recovers.` });
  }
  if (crossed.length > 0) {
    const [first] = crossed;
    return { level: first.level, title: first.level === "critical" ? "Critical" : "Warning", text: first.text, more: crossed.length - 1 };
  }
  const unknown = items.filter((row) => row.level === "unknown").length;
  if (unknown > 0) return { level: "ok", title: "Healthy", text: `Every reported part of the hardware budget is inside its limits; ${unknown} ${unknown === 1 ? "value is" : "values are"} not reported.`, more: 0 };
  return { level: "ok", title: "Healthy", text: "Every part of the hardware budget is inside its limits.", more: 0 };
}
