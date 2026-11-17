// SPDX-License-Identifier: MIT
import { Link } from "react-router";
import type { Setting } from "../../lib/operator-api";
import { groupLabel, groupRows } from "../../lib/settings-context";
import { cls } from "../common";
import { Chevron } from "../layout/chevron";
import { SettingRow, settingState } from "../setting-row";

/**
 * The catalogue (dashboard v2 screens §10.4, review B5). In use, each group is a disclosure, closed by default, whose head
 * names the group with its count and a state summary ("16 confirmed", or "2 not confirmed" in the warning tone); a group
 * holding a value the controller has not confirmed opens by default, and so does every group a search or a filter
 * narrows to. The band's group carries "Edit on Band ›" and stays closed: its rows are the Band page's job. The settings
 * nothing reads are one table with a head per group (`CatalogTable` with `heads`). Rows are `SettingRow`s; the card
 * around them (its loading, empty, stale and failed states) is the route's `Panel`.
 */

export { groupRows } from "../../lib/settings-context";

/** A group head's state summary and its tone: what the reader must know without opening it. */
export type GroupSummary = { readonly text: string; readonly tone: "ok" | "warn" | "muted"; readonly pending: number };

/**
 * "16 confirmed"; "2 not confirmed" (warn) whenever one is; "Worked out by the host" for a group of derived rows; a mix
 * reads its parts ("12 confirmed · 4 not reported"). While readbacks are stale nothing reads confirmed: "Readbacks stale".
 */
export function groupSummary(rows: readonly Setting[], readbackStale = false): GroupSummary {
  const counts = { confirmed: 0, not_confirmed: 0, not_reported: 0, reported: 0, derived: 0 };
  for (const row of rows) counts[settingState(row).kind] += 1;
  if (counts.not_confirmed > 0) return { text: `${counts.not_confirmed} not confirmed`, tone: "warn", pending: counts.not_confirmed };
  if (counts.derived === rows.length) return { text: "Worked out by the host", tone: "muted", pending: 0 };
  if (readbackStale) return { text: "Readbacks stale", tone: "muted", pending: 0 };
  const parts = [
    counts.confirmed > 0 ? `${counts.confirmed} confirmed` : null,
    counts.reported > 0 ? `${counts.reported} reported` : null,
    counts.not_reported > 0 ? `${counts.not_reported} not reported` : null,
    counts.derived > 0 ? `${counts.derived} worked out by the host` : null,
  ].filter(Boolean);
  return { text: parts.join(" · "), tone: counts.confirmed === rows.length ? "ok" : "muted", pending: 0 };
}

/** The page that owns every row of a group, for its head's link: the band's points are changed on Band. */
const GROUP_OWNER: Readonly<Record<string, { readonly to: string; readonly label: string }>> = { crop_band: { to: "/band", label: "Edit on Band" } };

/** Whether a group starts open: a value not confirmed in it, or the reader narrowed the list (search, or one group). The band's group never does. */
export function groupOpen(group: string, summary: GroupSummary, narrowed: boolean): boolean {
  if (group === "crop_band" && !narrowed) return false;
  return summary.pending > 0 || narrowed;
}

type TableProps = { rows: readonly Setting[]; caption: string; readbackStale: boolean; editTo: (param: string) => string; heads?: boolean };

/** One table of rows: Setting, Value, Controller and the action; with `heads`, a head row per group. */
export function CatalogTable({ rows, caption, readbackStale, editTo, heads = false }: TableProps) {
  const groups = heads ? groupRows(rows) : [["", [...rows]] as [string, Setting[]]];
  return <table className="ctl-catalog-table">
    <caption className="screen-reader">{caption}</caption>
    <thead><tr>
      <th scope="col" className="ctl-col-name">Setting</th><th scope="col" className="ctl-col-value">Value</th><th scope="col" className="ctl-col-state">Controller</th>
      <th scope="col" className="ctl-col-action"><span className="screen-reader">Open</span></th>
    </tr></thead>
    {groups.map(([group, list]) => <tbody key={group || "rows"} data-group={heads ? group : undefined}>
      {heads && <tr className="table-group ctl-group-row"><th scope="rowgroup" colSpan={4}>{groupLabel(group)} <span className="table-group-count">{list.length}</span></th></tr>}
      {list.map((row) => <SettingRow key={row.param} setting={row} readbackStale={readbackStale} editTo={editTo(row.param)} />)}
    </tbody>)}
  </table>;
}

export type CatalogProps = {
  /** The rows to list, already filtered and searched. */
  rows: readonly Setting[];
  /** What the tables are, for their hidden captions. */
  caption: string;
  readbackStale: boolean;
  editTo: (param: string) => string;
  /** A search or a filter narrowed the list: every group with a row opens. */
  narrowed?: boolean;
};

/** The settings in use as group disclosures, in the fixed group order. */
export function SettingsCatalog({ rows, caption, readbackStale, editTo, narrowed = false }: CatalogProps) {
  const groups = groupRows(rows);
  const open = narrowed || groups.length === 1;
  return <div className="ctl-groups">
    {groups.map(([group, list]) => {
      const summary = groupSummary(list, readbackStale);
      const owner = GROUP_OWNER[group];
      return <section key={group} className={cls("ctl-group", owner && "has-link")} data-group={group} aria-label={groupLabel(group)}>
        <details open={groupOpen(group, summary, open)}>
          <summary className="ctl-group-head">
            <span className="ctl-group-name">{groupLabel(group)}</span> <span className="ctl-group-count">{list.length}</span>{" "}
            <span className={cls("ctl-group-state", `is-${summary.tone}`)}>{summary.text}</span>
          </summary>
          <CatalogTable rows={list} caption={`${groupLabel(group)}: ${caption}`} readbackStale={readbackStale} editTo={editTo} />
        </details>
        {owner && <Link className="ctl-group-link" to={owner.to}>{owner.label}<Chevron /></Link>}
      </section>;
    })}
  </div>;
}
