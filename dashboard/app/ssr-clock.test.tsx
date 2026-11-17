// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
/**
 * Every route's server render names no time. The BFF renders at its own clock and the browser hydrates at its own: a
 * skewed phone, or the browser suite, which pins the page to the screens' 10:42 while the BFF runs days later. A time in
 * the markup's text then fails hydration (React error #418, reported as a page error), as Now's track hours did. So each
 * route, in the shell, renders the same text at two clocks; attributes are left out, because hydration does not compare
 * them.
 */
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoutesStub } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { ROUTES } from "../e2e/routes";
import { AppShell } from "./components/app-shell";
import { ToastProvider } from "./components/toast";
import Activity from "./routes/activity";
import ActivityLog from "./routes/activity-log";
import Band from "./routes/band";
import Climate from "./routes/climate";
import ClimateDrying from "./routes/climate-drying";
import Crops from "./routes/crops";
import CropsHistory from "./routes/crops-history";
import CropsMap from "./routes/crops-map";
import Equipment from "./routes/equipment";
import Graphs from "./routes/graphs";
import GraphsZones from "./routes/graphs.zones";
import LightHistory from "./routes/graphs.lighting";
import Hydroponics from "./routes/hydroponics";
import HydroponicsOverview from "./routes/hydroponics-overview";
import Lights from "./routes/lights";
import Now from "./routes/now";
import Record from "./routes/record";
import RecordCompliance from "./routes/record-compliance";
import RecordEquipment from "./routes/record-equipment";
import RecordUtilities from "./routes/record-utilities";
import Review from "./routes/review";
import Settings from "./routes/settings";
import SystemController from "./routes/system-controller";
import SystemData from "./routes/system-data";
import Water from "./routes/water";
import WaterBoard from "./routes/water-board";
import WaterHistory from "./routes/water-history";
import WaterSchedules from "./routes/water-schedules";
import WaterSoil from "./routes/water-soil";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const BUILD = "fedcba9876543210fedcba9876543210fedcba98";
const CHILDREN = [
  { index: true, Component: Now },
  { path: "climate", Component: Climate },
  { path: "band", Component: Band },
  { path: "climate/drying", Component: ClimateDrying },
  {
    path: "water", Component: Water,
    children: [{ index: true, Component: WaterBoard }, { path: "schedules", Component: WaterSchedules }, { path: "history", Component: WaterHistory }, { path: "soil", Component: WaterSoil }],
  },
  { path: "lights", Component: Lights },
  { path: "lights/history", Component: LightHistory },
  { path: "crops", Component: Crops, children: [{ index: true, Component: CropsMap }, { path: "history", Component: CropsHistory }] },
  { path: "hydroponics", Component: Hydroponics, children: [{ index: true, Component: HydroponicsOverview }] },
  { path: "record", Component: Record },
  { path: "record/compliance", Component: RecordCompliance },
  { path: "record/equipment", Component: RecordEquipment },
  { path: "record/utilities", Component: RecordUtilities },
  { path: "graphs", Component: Graphs },
  { path: "graphs/zones", Component: GraphsZones },
  { path: "review", Component: Review },
  { path: "activity", Component: Activity },
  { path: "activity/log", Component: ActivityLog },
  { path: "equipment", Component: Equipment },
  { path: "system/controller", Component: SystemController },
  { path: "system/data", Component: SystemData },
  { path: "settings", Component: Settings },
];
type Child = { index?: boolean; path?: string; children?: readonly Child[] };
/** Every path the stub mounts: the index and each child's path under its parent's. */
const paths = (children: readonly Child[], base = ""): string[] => children.flatMap((child) => {
  const at = child.index ? base || "/" : `${base}/${child.path}`;
  return child.children ? paths(child.children, at) : [at];
});
const TESTED = paths(CHILDREN);

/** The page's server render at `instant`, its text and tags without attributes. */
function serverText(path: string, instant: string): string {
  vi.setSystemTime(new Date(instant));
  const client = new QueryClient();
  const Stub = createRoutesStub([{
    path: "/", Component: () => <QueryClientProvider client={client}><ToastProvider><AppShell build={BUILD} authError={null} /></ToastProvider></QueryClientProvider>,
    children: CHILDREN,
  }]);
  return renderToString(<Stub initialEntries={[path]} />).replace(/<(\w+)[^>]*>/g, "<$1>");
}

test("every route is here", () => {
  expect([...TESTED].sort()).toEqual([...ROUTES].sort());
});

test.each(TESTED)("%s renders the same text on the server at any clock: the server's days later, the page's at the screens' 10:42", (path) => {
  vi.stubGlobal("fetch", vi.fn());
  vi.useFakeTimers();
  const later = serverText(path, "2026-11-05T01:05:00Z");
  expect(later).toContain("<h1>");
  expect(later).toBe(serverText(path, "2026-11-02T17:42:00Z"));
});
