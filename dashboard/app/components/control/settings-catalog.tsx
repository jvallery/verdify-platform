// SPDX-License-Identifier: MIT
import type { Setting } from "../../lib/operator-api";
import { groupLabel, groupRows } from "../../lib/settings-context";
import { SettingRow } from "../setting-row";

/**
 * The catalogue (dashboard v2 screens §10.4): one `<table>` with one `tbody` per group, in the fixed group order, each
 * under a sticky head with its name and count. Rows are `SettingRow`s. The card around it (its loading, empty, stale and
 * failed states) is the route's `Panel`.
 */

export { groupRows } from "../../lib/settings-context";

export type CatalogProps = {
  /** The rows to list, already filtered and searched. */
  rows: readonly Setting[];
  /** What the table is, for its hidden caption. */
  caption: string;
  readbackStale: boolean;
  editTo: (param: string) => string;
};

export function SettingsCatalog({ rows, caption, readbackStale, editTo }: CatalogProps) {
  return <table className="ctl-catalog-table">
    <caption className="screen-reader">{caption}</caption>
    <thead><tr>
      <th scope="col">Setting</th><th scope="col">Value</th><th scope="col">Controller reads</th><th scope="col">State</th>
      <th scope="col"><span className="screen-reader">Open</span></th>
    </tr></thead>
    {groupRows(rows).map(([group, list]) => <tbody key={group} data-group={group}>
      <tr className="table-group ctl-group-head">
        <th scope="rowgroup" colSpan={5}>
          {groupLabel(group)} <span className="table-group-count">· {list.length}</span>
        </th>
      </tr>
      {list.map((row) => <SettingRow key={row.param} setting={row} readbackStale={readbackStale} editTo={editTo(row.param)} />)}
    </tbody>)}
  </table>;
}
