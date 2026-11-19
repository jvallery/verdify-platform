// SPDX-License-Identifier: MIT
import { useApiDown } from "../../lib/session";
import { cls } from "../common";
import { finite } from "../data/viz";
import type { BudgetItem } from "./budget";

/** The meter's scale: room past the value and past the lines, so each line sits inside the track. */
export function budgetScale(row: Pick<BudgetItem, "value" | "warning" | "critical" | "worse" | "unit">): number {
  if (row.unit === "%") return 100;
  const lines = [row.warning, row.critical].filter(finite);
  const top = Math.max(...lines, 0) * (row.worse === "lower" ? 2 : 1.25);
  return Math.max(top, finite(row.value) ? row.value * 1.15 : 0) || 1;
}
const pct = (value: number, scale: number) => `${Math.round(Math.min(100, Math.max(0, (value / scale) * 100)) * 100) / 100}%`;

/**
 * A hardware-budget meter (screens section 10.2, row 2): a `--surface-2` track, the value filled in `--text-2`
 * (`--warn` or `--critical` once it crosses that line), the warning line as a 2 px `--warn` tick and the critical line
 * as a 2 px `--critical` tick. A value not reported hatches nothing and fills nothing. The value and its limits stand
 * beside it in words, so it is `aria-hidden`; while the API is down it is neutral.
 */
export function BudgetMeter({ row, stale = false }: { row: BudgetItem; stale?: boolean }) {
  const apiDown = useApiDown();
  const scale = budgetScale(row);
  return <svg className={cls("sys-meter", `is-${row.level}`, stale && "is-stale", apiDown && "is-neutral")} width="100%" height="12" aria-hidden="true" focusable="false" data-level={row.level}>
    <rect className="sys-meter-track" x="0" y="3" width="100%" height="6" rx="3" />
    {finite(row.value) && row.value > 0 && <rect className="sys-meter-fill" x="0" y="3" width={pct(row.value, scale)} height="6" rx="3" />}
    {finite(row.warning) && <line className="sys-meter-warn" x1={pct(row.warning, scale)} x2={pct(row.warning, scale)} y1="0" y2="12" />}
    {finite(row.critical) && <line className="sys-meter-critical" x1={pct(row.critical, scale)} x2={pct(row.critical, scale)} y1="0" y2="12" />}
  </svg>;
}
