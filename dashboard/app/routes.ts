// SPDX-License-Identifier: MIT
import { index, route, type RouteConfig } from "@react-router/dev/routes";
// Dashboard v2 (docs/design/dashboard/v2/README.md section 3): every view of lib/sections.ts at its own path, in that
// order. Band, Settings, Equipment, Activity, Water, Crops, Hydroponics and Graphs keep their paths, so bookmarks, drawer
// links and alert links keep working. The old paths of section 3.1 answer a redirect with their query from one module
// per destination (a route id each). Water's four views share its layout (the page head, the program banner and Stop
// all water); Crops' Map and History share theirs. SCR-09's sign-in pages render through the root at /auth/* (the BFF
// answers sign-in itself), and the catch-all answers 404.
export default [
  index("routes/now.tsx"),
  route("climate", "routes/climate.tsx"),
  route("band", "routes/band.tsx"),
  route("climate/drying", "routes/climate-drying.tsx"),
  route("water", "routes/water.tsx", [
    index("routes/water-board.tsx"),
    route("schedules", "routes/water-schedules.tsx"),
    route("history", "routes/water-history.tsx"),
    route("soil", "routes/water-soil.tsx"),
  ]),
  route("lights", "routes/lights.tsx"),
  route("lights/history", "routes/graphs.lighting.tsx"),
  route("crops", "routes/crops.tsx", [
    index("routes/crops-map.tsx"),
    route("history", "routes/crops-history.tsx"),
  ]),
  route("hydroponics", "routes/hydroponics.tsx", [index("routes/hydroponics-overview.tsx")]),
  route("record", "routes/record.tsx"),
  route("record/compliance", "routes/record-compliance.tsx"),
  route("record/equipment", "routes/record-equipment.tsx"),
  route("record/utilities", "routes/record-utilities.tsx"),
  route("graphs", "routes/graphs.tsx"),
  route("graphs/zones", "routes/graphs.zones.tsx"),
  route("review", "routes/review.tsx"),
  route("activity", "routes/activity.tsx"),
  route("activity/log", "routes/activity-log.tsx"),
  route("equipment", "routes/equipment.tsx"),
  route("system/controller", "routes/system-controller.tsx"),
  route("system/data", "routes/system-data.tsx"),
  route("settings", "routes/settings.tsx"),
  route("plan", "routes/planner-redirect.tsx", { id: "redirect-plan" }),
  route("planner", "routes/planner-redirect.tsx", { id: "redirect-planner" }),
  route("planner/history", "routes/planner-redirect.tsx", { id: "redirect-planner-history" }),
  route("graphs/statistics", "routes/graphs-scorecard.tsx", { id: "redirect-graphs-statistics" }),
  route("graphs/scorecard", "routes/graphs-scorecard.tsx", { id: "redirect-graphs-scorecard" }),
  route("graphs/lighting", "routes/lighting-redirect.tsx", { id: "redirect-graphs-lighting" }),
  route("auth/*", "routes/auth.tsx"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
