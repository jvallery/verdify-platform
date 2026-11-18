// SPDX-License-Identifier: MIT
import { useId } from "react";
import { Form, Link, useSearchParams } from "react-router";
import { Chips } from "../components/chips";
import { usePlantingHref } from "../components/crops/map";
import { EmptyState, Panel, PanelError, type PanelState } from "../components/panel";
import { Table, type TableColumn } from "../components/table";
import { endReasonText, placeNames, placeText, recorderText } from "../lib/crops";
import { dayMonth, localDate } from "../lib/format";
import type { Planting } from "../lib/operator-api";
import { useApiRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";
import { useCropsOutlet } from "./crops";

export const meta = () => viewMeta("crops-history");

const PATH = "/crops/history";
const HISTORY_POLL_MS = 60_000;
const ZONE_WORDS: Readonly<Record<string, string>> = { center: "Center", east: "East", north: "North", south: "South", west: "West" };
const DATE = /^\d{4}-\d\d-\d\d$/;

/** The history's query: zone, crop and since kept in the URL, so a filtered view is a link. */
function historyUrl(params: URLSearchParams, change: Record<string, string | null>): string {
  const next = new URLSearchParams(params);
  for (const [name, value] of Object.entries(change)) if (value) next.set(name, value); else next.delete(name);
  next.delete("planting");
  next.delete("do");
  const search = next.toString();
  return search ? `${PATH}?${search}` : PATH;
}

/**
 * Crops → History (`/crops/history`, #1330): every planting, active first, then the ended ones newest first (API-CROP-02,
 * read as active and as ended), with its crop, variety, places (`EAST-HYDRO-1..10`), plants, planted and ended dates,
 * why it ended and who recorded it. Filters by zone (the server's: ever in that zone), crop and since (planted or ended
 * on or after) live in the URL. A row opens the planting's drawer, which holds every place it has been.
 */
export default function CropsHistory() {
  const { locations } = useCropsOutlet();
  const [params] = useSearchParams();
  const href = usePlantingHref();
  const cropId = useId();
  const sinceId = useId();
  const zone = params.get("zone");
  const crop = params.get("crop");
  const sinceParam = params.get("since");
  const since = sinceParam && DATE.test(sinceParam) ? sinceParam : null;
  const query = { ...(zone ? { zone } : {}), ...(since ? { since } : {}), limit: 500 };
  const active = useApiRead("API-CROP-02", { ...query, active: true }, { intervalMs: HISTORY_POLL_MS });
  const ended = useApiRead("API-CROP-02", { ...query, active: false }, { intervalMs: HISTORY_POLL_MS });
  const zones = (locations.data?.zones ?? []).filter((item) => (item.shelves ?? []).length > 0).map((item) => item.slug);
  const zoneChips = [{ key: "all", label: "All zones", to: historyUrl(params, { zone: null }), current: !zone, keepScroll: true },
    ...zones.map((slug) => ({ key: slug, label: ZONE_WORDS[slug] ?? slug, to: historyUrl(params, { zone: slug }), current: zone === slug, keepScroll: true }))];
  const retry = () => { void active.refetch(); void ended.refetch(); };
  const failed = active.isError && ended.isError && !active.data && !ended.data;
  const settled = (active.data || active.isError) && (ended.data || ended.isError);
  const all = [...(active.data?.items ?? []), ...(ended.data?.items ?? [])];
  const crops = [...new Set(all.map((item) => item.crop))].sort();
  const rows = crop ? all.filter((item) => item.crop === crop) : all;
  const state: PanelState = failed ? "error" : !settled ? "loading" : rows.length === 0 ? "empty" : "ready";
  const names = placeNames(locations.data);
  const columns: TableColumn<Planting>[] = [
    // Dates "28 Oct", places by name, "Imported" for the seed's records, an em dash for nothing (design review C4).
    { key: "crop", header: "Crop", rowHeader: true, cell: (row) => <Link to={href(row.id)} preventScrollReset>{row.crop}</Link> },
    { key: "variety", header: "Variety", cell: (row) => row.variety ?? "—" },
    { key: "where", header: "Places", cell: (row) => (row.where ? placeText(row.where, names) : row.active ? "—" : "Ended"), className: "crop-where" },
    { key: "count", header: "Plants", cell: (row) => (row.count === null || row.count === undefined ? "—" : String(row.count)), numeric: true },
    { key: "planted", header: "Planted", cell: (row) => dayMonth(row.planted_date) },
    { key: "ended", header: "Ended", cell: (row) => (row.ended_at ? dayMonth(localDate(row.ended_at)) : row.active ? "Active" : "—") },
    { key: "reason", header: "Why", cell: (row) => endReasonText(row.end_reason) || "—" },
    { key: "by", header: "Recorded by", cell: (row) => recorderText(row.recorded_by) },
  ];
  return <div className="crop-history-view">
    <div className="filters crop-filters">
      <Chips label="Zone" items={zoneChips} small />
      <Form className="crop-filter-form" method="get" action={PATH} preventScrollReset>
        {zone && <input type="hidden" name="zone" value={zone} />}
        <label htmlFor={cropId}>Crop
          <select id={cropId} name="crop" defaultValue={crop ?? ""} key={crop ?? ""}>
            <option value="">All crops</option>
            {crops.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label htmlFor={sinceId}>Since
          <input id={sinceId} type="date" name="since" defaultValue={since ?? ""} key={since ?? ""} />
        </label>
        <button type="submit" className="btn">Filter</button>
        {(crop || since) && <Link to={historyUrl(params, { crop: null, since: null })} preventScrollReset>Clear filters</Link>}
      </Form>
    </div>
    <Panel title="Planting records" thing="the planting history" state={state} onRetry={retry} reserve="lg"
      empty={<EmptyState message={crop || since || zone ? "No planting matches these filters." : "No planting is recorded yet."} />}
      foot={`${rows.filter((row) => row.active).length} active · ${rows.filter((row) => !row.active).length} ended in these results. Open a crop to see its places, harvests and notes.`}>
      {(active.isError || ended.isError) && <PanelError thing="part of the planting history" text="Planting history is incomplete or could not be refreshed. Records below may be out of date." onRetry={retry} />}
      <Table label="Plantings" caption={`${rows.length} planting${rows.length === 1 ? "" : "s"}`} captionHidden columns={columns} rows={rows} rowKey={(row) => String(row.id)} phone="list"
        empty={<p className="muted">No planting matches.</p>} />
    </Panel>
  </div>;
}
