// SPDX-License-Identifier: MIT
import { Link } from "react-router";
import type { Setting } from "../../lib/operator-api";
import { settingDisplay } from "../../lib/setting-values";
import { isManual } from "./marks";
import { STATE_WORDS } from "./setting-help";

/** Use API states, never infer confirmation by comparing numbers in the browser. */
export function settingsAttention(rows: readonly Setting[]): Setting[] {
  const priority: Readonly<Record<string, number>> = { not_confirmed: 0, held: 1, requested: 2 };
  return rows.filter((row) => row.control_class !== "retired" && Object.hasOwn(priority, row.state))
    .sort((a, b) => priority[a.state] - priority[b.state] || a.label.localeCompare(b.label));
}

export function SettingsOverview({ rows, failed, stale, editTo }: {
  rows: readonly Setting[] | null; failed: boolean; stale: boolean; editTo: (param: string) => string;
}) {
  if (!rows || failed) return null;
  const active = rows.filter((row) => row.control_class !== "retired");
  const manual = active.filter(isManual);
  const attention = settingsAttention(active);
  return <section className="settings-overview" aria-labelledby="settings-overview-title">
    <div className="settings-overview-heading">
      <div><p className="eyebrow">CONTROL DESK</p><h2 id="settings-overview-title">Understand a change before making it.</h2></div>
      <p>Device values show what was reported. Treat a saved request as applied only after its readback confirms it.</p>
    </div>
    <div className="settings-overview-columns">
      <div className="settings-authority">
        <h3>Manual control</h3>
        <strong>{manual.length} {manual.length === 1 ? "setting" : "settings"}</strong>
        <p>Iris leaves these manual settings alone. Open a setting to review its owner, change it or release it to automatic control.</p>
        <Link to="/settings?filter=manual">Review manual settings →</Link>
      </div>
      <div className="settings-attention">
        <h3>{attention.length ? `${attention.length} ${attention.length === 1 ? "change needs" : "changes need"} a look` : "No pending setting changes"}</h3>
        {stale && <p className="notice notice-warn">Readbacks are stale. Check controller connectivity before relying on a reported value.</p>}
        {attention.length === 0
          ? <p>No waiting, held or unconfirmed changes in the latest settings response. This does not grade greenhouse conditions.</p>
          : <ul>{attention.slice(0, 4).map((row) => <li key={row.param}>
            <Link to={editTo(row.param)} preventScrollReset><strong>{row.label}</strong><span>{STATE_WORDS[row.state]?.label ?? row.state}</span></Link>
            <span className="meta">Reported: {row.readback?.value != null ? settingDisplay(row.readback.value, row) : "Unknown"}{stale ? " · stale" : ""}</span>
          </li>)}</ul>}
        {attention.length > 4 && <p><Link to="/settings?filter=attention">Review all {attention.length} pending changes →</Link></p>}
      </div>
    </div>
  </section>;
}
